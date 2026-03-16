from __future__ import annotations

import json
import re
from time import perf_counter
from typing import Any

from openai import APIConnectionError, APIError, APITimeoutError, OpenAI
from sqlalchemy.orm import Session

from app.agent_tools.schemas import CreateContentIdeaInput, ExecutePlanInput, UpdateContentPlanInput, WebSearchInput
from app.core.config import Config
from app.db.session import SessionLocal
from app.models import ContentItem, ContentPlan, ContentVersion, Conversation, ToolExecution, User, UserProfile
from app.services.web_search_service import WebSearchService, WebSearchServiceError


class ToolHandlerError(Exception):
    pass


class ToolNotFoundError(ToolHandlerError):
    pass


class ToolValidationError(ToolHandlerError):
    pass


def _get_ai_client() -> OpenAI | None:
    api_key = Config.NIM_API_KEY.strip()
    if not api_key or api_key == "your_nvidia_nim_api_key":
        return None
    return OpenAI(api_key=api_key, base_url=Config.NIM_BASE_URL)


def handle_create_content_idea(payload: CreateContentIdeaInput) -> dict[str, Any]:
    return _run_tool("create_content_idea", payload, _create_content_idea)


def handle_update_content_plan(payload: UpdateContentPlanInput) -> dict[str, Any]:
    return _run_tool("update_content_plan", payload, _update_content_plan)


def handle_execute_plan(payload: ExecutePlanInput) -> dict[str, Any]:
    return _run_tool("execute_plan", payload, _execute_plan)


def handle_web_search(payload: WebSearchInput) -> dict[str, Any]:
    return _run_tool("web_search", payload, _web_search)


def _run_tool(tool_name: str, payload: Any, operation: Any) -> dict[str, Any]:
    db = SessionLocal()
    started = perf_counter()
    try:
        conversation = _get_conversation_or_raise(db, payload.conversation_id)
        result = operation(db, conversation, payload)
        elapsed_ms = int((perf_counter() - started) * 1000)
        db.add(
            ToolExecution(
                conversation_id=conversation.id,
                tool_name=tool_name,
                input_params=payload.model_dump(mode="json"),
                output_result=result,
                execution_status="completed",
                execution_time_ms=elapsed_ms,
            )
        )
        db.commit()
        return result
    except ToolHandlerError as exc:
        db.rollback()
        _record_failed_execution(db, tool_name, payload, str(exc), started)
        raise
    except Exception as exc:
        db.rollback()
        error_message = f"Unexpected failure while running '{tool_name}'."
        _record_failed_execution(db, tool_name, payload, f"{error_message} {exc}", started)
        raise ToolHandlerError(error_message) from exc
    finally:
        db.close()


def _create_content_idea(db: Session, conversation: Conversation, payload: CreateContentIdeaInput) -> dict[str, Any]:
    generated = _generate_plan_fields(db, conversation, payload.user_request, payload.constraints)
    plan = ContentPlan(
        conversation_id=conversation.id,
        user_id=conversation.user_id,
        title=generated["title"],
        description=generated["description"],
        target_keywords=generated["target_keywords"],
        outline=generated["outline"],
        research_notes=generated["research_notes"],
        status=generated["status"],
    )
    db.add(plan)
    db.flush()
    return {
        "status": "success",
        "plan": _serialize_plan(plan),
    }


def _update_content_plan(db: Session, conversation: Conversation, payload: UpdateContentPlanInput) -> dict[str, Any]:
    plan = db.get(ContentPlan, payload.plan_id)
    if plan is None:
        raise ToolNotFoundError("Plan not found.")
    if plan.conversation_id != conversation.id:
        raise ToolValidationError("Plan does not belong to the provided conversation.")

    changes = payload.model_dump(exclude_none=True)
    changes.pop("conversation_id", None)
    changes.pop("plan_id", None)
    if not changes:
        raise ToolValidationError("At least one plan field must be provided for update.")

    for field_name, field_value in changes.items():
        setattr(plan, field_name, field_value)

    db.flush()
    return {
        "status": "success",
        "updated_fields": sorted(changes.keys()),
        "plan": _serialize_plan(plan),
    }


def _execute_plan(db: Session, conversation: Conversation, payload: ExecutePlanInput) -> dict[str, Any]:
    plan = db.get(ContentPlan, payload.plan_id)
    if plan is None:
        raise ToolNotFoundError("Plan not found.")
    if plan.conversation_id != conversation.id:
        raise ToolValidationError("Plan does not belong to the provided conversation.")

    generated = _generate_blog_fields(db, conversation, plan, payload.writing_instructions, payload.output_format)
    content_text = generated["content"]
    output_format = payload.output_format.strip().lower()
    content_item = ContentItem(
        content_plan_id=plan.id,
        user_id=conversation.user_id,
        title=generated["title"],
        content=content_text,
        html_content=content_text if output_format == "html" else None,
        markdown_content=content_text if output_format == "markdown" else None,
        meta_description=generated["meta_description"],
        tags=generated["tags"],
        word_count=_count_words(content_text),
        status="draft",
    )
    db.add(content_item)
    db.flush()

    db.add(
        ContentVersion(
            content_item_id=content_item.id,
            version=1,
            title=content_item.title,
            content=content_item.content,
            changed_by="agent",
            change_description="Initial draft generated from execute_plan tool.",
        )
    )
    plan.status = "executed"
    db.flush()

    return {
        "status": "success",
        "generation_mode": generated.get("generation_mode", "ai"),
        "content_item": _serialize_content_item(content_item),
        "plan": _serialize_plan(plan),
    }


def _web_search(db: Session, conversation: Conversation, payload: WebSearchInput) -> dict[str, Any]:
    del db, conversation
    try:
        return WebSearchService().search(payload.query, payload.max_results)
    except WebSearchServiceError as exc:
        raise ToolValidationError(str(exc)) from exc


def _get_conversation_or_raise(db: Session, conversation_id: Any) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise ToolNotFoundError("Session not found.")
    return conversation


def _record_failed_execution(db: Session, tool_name: str, payload: Any, error_message: str, started: float) -> None:
    try:
        conversation = db.get(Conversation, payload.conversation_id)
        if conversation is None:
            return
        db.add(
            ToolExecution(
                conversation_id=conversation.id,
                tool_name=tool_name,
                input_params=payload.model_dump(mode="json"),
                execution_status="failed",
                error_message=error_message,
                execution_time_ms=int((perf_counter() - started) * 1000),
            )
        )
        db.commit()
    except Exception:
        db.rollback()


def _generate_plan_fields(
    db: Session,
    conversation: Conversation,
    user_request: str,
    constraints: dict[str, Any] | None,
) -> dict[str, Any]:
    user_context = _build_user_context(db, conversation.user_id)
    ai_fields = _generate_plan_with_ai(user_request, constraints, user_context)
    if ai_fields is None:
        return _generate_plan_fallback(user_request, constraints)

    return {
        "title": _coerce_string(ai_fields.get("title"), _derive_title_from_request(user_request), 500),
        "description": _coerce_nullable_string(ai_fields.get("description"), max_len=4000),
        "target_keywords": _normalize_keywords(ai_fields.get("target_keywords"), user_request),
        "outline": _normalize_outline(ai_fields.get("outline"), user_request),
        "research_notes": _coerce_nullable_string(
            ai_fields.get("research_notes"),
            fallback="Validate claims with high-quality sources and include practical examples.",
            max_len=8000,
        ),
        "status": _coerce_string(ai_fields.get("status"), "draft", 50),
    }


def _generate_blog_fields(
    db: Session,
    conversation: Conversation,
    plan: ContentPlan,
    writing_instructions: str | None,
    output_format: str,
) -> dict[str, Any]:
    fallback_fields = _generate_blog_fallback(plan, writing_instructions, output_format)
    user_context = _build_user_context(db, conversation.user_id)
    ai_fields = _generate_blog_with_ai(plan, writing_instructions, output_format, user_context)
    if ai_fields is None:
        return fallback_fields

    content = _coerce_string(ai_fields.get("content"), "", 200000)
    if not content.strip() or _looks_like_template_content(content):
        return fallback_fields
    return {
        "title": _coerce_string(ai_fields.get("title"), plan.title, 500),
        "content": content,
        "meta_description": _coerce_nullable_string(
            ai_fields.get("meta_description"),
            fallback=_derive_meta_description_from_content(content, plan.description),
            max_len=500,
        ),
        "tags": _normalize_tags(ai_fields.get("tags"), plan.target_keywords),
        "generation_mode": "ai",
    }


def _generate_plan_with_ai(
    user_request: str,
    constraints: dict[str, Any] | None,
    user_context: dict[str, Any],
) -> dict[str, Any] | None:
    client = _get_ai_client()
    if client is None:
        return None

    prompt = (
        "Generate a content plan as strict JSON.\n"
        "Return ONLY a JSON object with keys: title, description, target_keywords, outline, research_notes, status.\n"
        "Rules:\n"
        "- target_keywords must be an array of strings.\n"
        "- outline must be an object with a sections array.\n"
        "- status should be 'draft'.\n\n"
        f"User request:\n{user_request}\n\n"
        f"Constraints (JSON):\n{json.dumps(constraints or {}, ensure_ascii=True)}\n\n"
        f"User context (JSON):\n{json.dumps(user_context, ensure_ascii=True)}"
    )

    try:
        response = client.chat.completions.create(
            model=Config.NIM_MODEL,
            max_tokens=Config.AI_MAX_TOKENS,
            temperature=Config.AI_TEMPERATURE,
            messages=[
                {"role": "system", "content": "You are a precise content strategist. Follow output format exactly."},
                {"role": "user", "content": prompt},
            ],
        )
        text = _extract_text_from_response(response)
        return _parse_json_from_text(text)
    except (APIError, APIConnectionError, APITimeoutError, ToolHandlerError, json.JSONDecodeError):
        return None


def _generate_blog_with_ai(
    plan: ContentPlan,
    writing_instructions: str | None,
    output_format: str,
    user_context: dict[str, Any],
) -> dict[str, Any] | None:
    client = _get_ai_client()
    if client is None:
        return None

    prompt = (
        "Generate full blog content from this plan and return strict JSON only.\n"
        "Required keys: title, content, meta_description, tags.\n"
        "- tags must be an array of short strings.\n"
        f"- content must be in {output_format} format.\n"
        "- Write complete, publication-ready prose with clear section headings.\n"
        "- Do not return placeholders like 'Section' headings, bullet-only scaffolds, or writing notes.\n"
        "- The blog must be strictly less than 1800 words.\n\n"
        "If JSON cannot be followed, return a complete article in plain markdown text.\n\n"
        f"Plan (JSON):\n{json.dumps(_serialize_plan(plan), ensure_ascii=True)}\n\n"
        f"Writing instructions:\n{writing_instructions or 'None provided.'}\n\n"
        f"User context (JSON):\n{json.dumps(user_context, ensure_ascii=True)}"
    )

    try:
        response = client.chat.completions.create(
            model=Config.NIM_MODEL,
            max_tokens=Config.AI_MAX_TOKENS,
            temperature=Config.AI_TEMPERATURE,
            messages=[
                {"role": "system", "content": "You are a senior blog writer. Follow output format exactly."},
                {"role": "user", "content": prompt},
            ],
        )
        text = _extract_text_from_response(response)
        parsed = _coerce_blog_payload_from_text(text, plan)
        if parsed is not None:
            return parsed

        markdown_retry = _generate_blog_markdown_retry_with_ai(
            client=client,
            plan=plan,
            writing_instructions=writing_instructions,
            user_context=user_context,
        )
        if markdown_retry is None:
            return None
        return _coerce_blog_payload_from_text(markdown_retry, plan)
    except (APIError, APIConnectionError, APITimeoutError, ToolHandlerError):
        return None


def _generate_blog_markdown_retry_with_ai(
    client: OpenAI,
    plan: ContentPlan,
    writing_instructions: str | None,
    user_context: dict[str, Any],
) -> str | None:
    prompt = (
        "Write a complete blog article in plain markdown only.\n"
        "Do not return JSON. Do not wrap in code fences.\n"
        "Requirements:\n"
        "- Use a single H1 title, then section headings with ##.\n"
        "- Write complete prose paragraphs (not bullet-only scaffolds).\n"
        "- The blog must be strictly less than 1800 words.\n"
        "- Keep it concise enough to fit a normal blog draft in one response.\n\n"
        f"Plan (JSON):\n{json.dumps(_serialize_plan(plan), ensure_ascii=True)}\n\n"
        f"Writing instructions:\n{writing_instructions or 'None provided.'}\n\n"
        f"User context (JSON):\n{json.dumps(user_context, ensure_ascii=True)}"
    )
    try:
        response = client.chat.completions.create(
            model=Config.NIM_MODEL,
            max_tokens=Config.AI_MAX_TOKENS,
            temperature=Config.AI_TEMPERATURE,
            messages=[
                {"role": "system", "content": "You are a senior blog writer. Return markdown only."},
                {"role": "user", "content": prompt},
            ],
        )
        return _extract_text_from_response(response)
    except (APIError, APIConnectionError, APITimeoutError, ToolHandlerError):
        return None


def _generate_plan_fallback(user_request: str, constraints: dict[str, Any] | None) -> dict[str, Any]:
    keywords = _extract_keywords(user_request)
    title = _derive_title_from_request(user_request)
    return {
        "title": title,
        "description": f"Content plan generated from request: {user_request.strip()}",
        "target_keywords": keywords,
        "outline": {
            "sections": [
                {"heading": "Introduction", "key_points": ["Set context", "State the core problem"]},
                {"heading": "Main Insights", "key_points": ["Explain best practices", "Add practical examples"]},
                {"heading": "Action Plan", "key_points": ["Provide next steps", "Highlight measurable outcomes"]},
                {"heading": "Conclusion", "key_points": ["Summarize value", "Provide a clear call-to-action"]},
            ],
            "constraints": constraints or {},
        },
        "research_notes": "Validate statistics, cite authoritative sources, and include one real-world case study.",
        "status": "draft",
    }


def _generate_blog_fallback(
    plan: ContentPlan,
    writing_instructions: str | None,
    output_format: str,
) -> dict[str, Any]:
    sections = _extract_outline_sections(plan.outline)
    intro = _coerce_string(
        plan.description,
        "This article translates the approved plan into a complete, reader-friendly draft with practical context and clear narrative flow.",
        2000,
    )
    lines: list[str] = []
    if output_format.strip().lower() == "markdown":
        lines.append(f"# {plan.title}")
        lines.append("")
        lines.append(intro)
        lines.append("")
        for index, section in enumerate(sections, start=1):
            lines.append(f"## {section['heading']}")
            lines.append("")
            lines.append(_expand_outline_section(plan, section, index, len(sections), writing_instructions))
            lines.append("")
    else:
        lines.append(plan.title)
        lines.append("")
        lines.append(intro)
        lines.append("")
        for index, section in enumerate(sections, start=1):
            lines.append(section["heading"])
            lines.append(_expand_outline_section(plan, section, index, len(sections), writing_instructions))
            lines.append("")

    fallback_content = "\n".join(lines).strip()
    return {
        "title": plan.title,
        "content": fallback_content,
        "meta_description": _derive_meta_description_from_content(fallback_content, plan.description),
        "tags": _normalize_tags(plan.target_keywords, plan.target_keywords),
        "generation_mode": "fallback",
    }


def _extract_text_from_response(response: Any) -> str:
    choices = getattr(response, "choices", None)
    if isinstance(choices, list) and choices:
        message = getattr(choices[0], "message", None)
        text = (getattr(message, "content", None) or "").strip() if message is not None else ""
        if text:
            return text

    text_parts: list[str] = []
    for block in getattr(response, "content", []):
        if getattr(block, "type", None) == "text":
            value = getattr(block, "text", None)
            if value:
                text_parts.append(value)
    text = "\n".join(text_parts).strip()
    if not text:
        raise ToolHandlerError("AI response did not contain text output.")
    return text


def _parse_json_from_text(text: str) -> dict[str, Any]:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise json.JSONDecodeError("No JSON object found.", text, 0)
    return json.loads(text[start : end + 1])


def _coerce_blog_payload_from_text(text: str, plan: ContentPlan) -> dict[str, Any] | None:
    sanitized = _strip_code_fence(text)
    if not sanitized:
        return None

    try:
        parsed = _parse_json_from_text(sanitized)
    except json.JSONDecodeError:
        parsed = None

    if isinstance(parsed, dict):
        return parsed

    if _looks_like_jsonish_text(sanitized):
        return None

    if _count_words(sanitized) < 120:
        return None
    return {
        "title": _extract_title_from_content(sanitized, plan.title),
        "content": sanitized,
        "meta_description": _derive_meta_description_from_content(sanitized, plan.description),
        "tags": _normalize_tags(plan.target_keywords, plan.target_keywords),
    }


def _strip_code_fence(text: str) -> str:
    normalized = text.strip()
    if normalized.startswith("```"):
        normalized = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", normalized)
    normalized = re.sub(r"\s*```\s*$", "", normalized)
    return normalized.strip()


def _looks_like_jsonish_text(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    if stripped.startswith("{") or stripped.startswith("["):
        return True
    if re.search(r'(?m)^\s*"title"\s*:\s*', stripped):
        return True
    if re.search(r'(?m)^\s*"content"\s*:\s*', stripped):
        return True
    if re.search(r'(?i)\A(?:json\s+)?\{', stripped):
        return True
    return False


def _extract_title_from_content(content: str, fallback_title: str) -> str:
    markdown_title = re.search(r"(?m)^\s*#\s+(.+?)\s*$", content)
    if markdown_title:
        return _coerce_string(markdown_title.group(1), fallback_title, 500)

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if (
            not line
            or line.startswith(("-", "*", ">", "#", "`", "{", "}", "[", "]"))
            or line.startswith('"')
            or line.endswith("{")
            or ":" in line[:30]
        ):
            continue
        if len(line) <= 120:
            return _coerce_string(line, fallback_title, 500)
    return fallback_title[:500]


def _derive_meta_description_from_content(content: str, fallback: str | None) -> str | None:
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("#", "-", "*", ">")):
            continue
        return _coerce_nullable_string(line, fallback=fallback, max_len=500)
    return _coerce_nullable_string(fallback, max_len=500)


def _build_user_context(db: Session, user_id: Any) -> dict[str, Any]:
    profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).one_or_none()
    user = db.get(User, user_id)
    return {
        "user_name": getattr(user, "user_name", None),
        "company_name": getattr(profile, "company_name", None),
        "industry": getattr(profile, "industry", None),
        "target_audience": getattr(profile, "target_audience", None),
        "brand_voice": getattr(profile, "brand_voice", None),
        "content_preferences": getattr(profile, "content_preferences", None),
        "additional_context": getattr(profile, "additional_context", None),
    }


def _extract_keywords(text: str) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}", text.lower())
    filtered = [word for word in words if word not in {"with", "from", "that", "this", "about", "your", "into"}]
    unique: list[str] = []
    for word in filtered:
        if word not in unique:
            unique.append(word)
        if len(unique) == 8:
            break
    return unique or ["content-strategy", "blog-planning"]


def _derive_title_from_request(user_request: str) -> str:
    cleaned = re.sub(r"\s+", " ", user_request).strip()
    if not cleaned:
        return "New Content Idea"
    words = cleaned.split(" ")
    short = " ".join(words[:10]).strip(" .,:;!?")
    if not short:
        return "New Content Idea"
    return short[:500]


def _normalize_outline(raw_outline: Any, user_request: str) -> dict[str, Any]:
    if isinstance(raw_outline, dict) and raw_outline:
        return raw_outline
    fallback = _generate_plan_fallback(user_request, None)
    return fallback["outline"]


def _normalize_keywords(raw_keywords: Any, user_request: str) -> list[str]:
    if isinstance(raw_keywords, list):
        values = [str(item).strip() for item in raw_keywords if str(item).strip()]
        if values:
            return values[:12]
    return _extract_keywords(user_request)


def _normalize_tags(raw_tags: Any, fallback_keywords: list[str] | None) -> list[str] | None:
    if isinstance(raw_tags, list):
        tags = [str(item).strip() for item in raw_tags if str(item).strip()]
        if tags:
            return tags[:12]
    if fallback_keywords:
        return [str(item).strip() for item in fallback_keywords if str(item).strip()][:12] or None
    return None


def _coerce_string(value: Any, fallback: str, max_len: int) -> str:
    if value is None:
        return fallback[:max_len]
    text = str(value).strip()
    if not text:
        return fallback[:max_len]
    return text[:max_len]


def _coerce_nullable_string(value: Any, fallback: str | None = None, max_len: int = 4000) -> str | None:
    if value is None:
        return fallback[:max_len] if fallback else None
    text = str(value).strip()
    if not text:
        return fallback[:max_len] if fallback else None
    return text[:max_len]


def _extract_outline_sections(outline: dict[str, Any]) -> list[dict[str, Any]]:
    sections_raw = outline.get("sections") if isinstance(outline, dict) else None
    if not isinstance(sections_raw, list):
        return [
            {
                "heading": "Core Ideas",
                "key_points": [
                    "Explain the central idea in plain language.",
                    "Give one practical example readers can visualize.",
                    "Connect the insight to a real decision or outcome.",
                ],
            }
        ]

    sections: list[dict[str, Any]] = []
    for index, item in enumerate(sections_raw, start=1):
        if isinstance(item, dict):
            raw_heading = _coerce_string(item.get("heading"), "", 200)
            key_points = item.get("key_points")
            normalized_points = (
                [str(point).strip() for point in key_points if str(point).strip()]
                if isinstance(key_points, list)
                else []
            )
            body_text = _coerce_nullable_string(item.get("body"), max_len=2000)
            if body_text:
                normalized_points.append(body_text)
            heading = _normalize_section_heading(raw_heading, normalized_points, index)
            sections.append({"heading": heading, "key_points": normalized_points})
        elif isinstance(item, str) and item.strip():
            heading = _normalize_section_heading(item.strip()[:200], [], index)
            sections.append({"heading": heading, "key_points": []})

    if not sections:
        return [
            {
                "heading": "Core Ideas",
                "key_points": [
                    "Explain the central idea in plain language.",
                    "Give one practical example readers can visualize.",
                    "Connect the insight to a real decision or outcome.",
                ],
            }
        ]
    return sections


def _normalize_section_heading(raw_heading: str, key_points: list[str], index: int) -> str:
    heading = raw_heading.strip()
    if heading.lower() in {"section", "main section", "section heading"}:
        heading = ""

    if not heading and key_points:
        first_point = re.sub(r"\s+", " ", key_points[0]).strip(" .,:;!-")
        if first_point:
            words = first_point.split(" ")
            heading = " ".join(words[:8]).title()

    if not heading:
        heading = f"Key Insight {index}"
    return heading[:200]


def _looks_like_template_content(content: str) -> bool:
    if re.search(r"(?im)^##\s*section\s*$", content):
        return True
    if re.search(r"(?i)\badd supporting details\b|\badd clear arguments\b|\bexpand this section\b", content):
        return True

    section_placeholders = len(re.findall(r"(?im)^##\s*section\s*$", content))
    bullet_lines = len(re.findall(r"(?m)^\s*[-*]\s+", content))
    if section_placeholders >= 2:
        return True
    if _count_words(content) < 260 and bullet_lines >= 10:
        return True
    return False


def _expand_outline_section(
    plan: ContentPlan,
    section: dict[str, Any],
    section_index: int,
    section_count: int,
    writing_instructions: str | None,
) -> str:
    heading = _coerce_string(section.get("heading"), f"Key Insight {section_index}", 200)
    raw_points = section.get("key_points")
    points = [str(point).strip() for point in raw_points if str(point).strip()] if isinstance(raw_points, list) else []
    if not points:
        points = [
            f"Explain why {heading.lower()} matters for the reader.",
            "Provide a practical example with visible outcomes.",
            "Highlight a common mistake and how to avoid it.",
        ]

    core_sentences = [_ensure_sentence(point) for point in points[:4]]
    opening = (
        f"{heading} gives this topic real shape and momentum. "
        f"It helps readers connect the big idea in '{plan.title}' to decisions, behaviors, and outcomes they can recognize."
    )
    development = " ".join(core_sentences[:2]).strip()
    practical = (
        "To keep the section useful, pair each insight with context: what changed, why it worked, and what the audience can apply next."
    )
    supporting = " ".join(core_sentences[2:]).strip()

    tone_hint = ""
    if writing_instructions:
        instruction_text = writing_instructions.strip().lower()
        if "inspiration" in instruction_text or "story" in instruction_text:
            tone_hint = " A short, concrete story can make this section far more memorable."
        elif "practical" in instruction_text or "actionable" in instruction_text:
            tone_hint = " End this section with one clear action the reader can take immediately."

    position_hint = ""
    if section_index == section_count:
        position_hint = " This final section should close with a confident takeaway that reinforces the article's central message."

    paragraph = f"{opening} {development} {practical}"
    if supporting:
        paragraph = f"{paragraph} {supporting}"
    return re.sub(r"\s+", " ", f"{paragraph}{tone_hint}{position_hint}").strip()


def _ensure_sentence(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip(" -")
    if not cleaned:
        return ""
    if cleaned[-1] not in ".!?":
        cleaned = f"{cleaned}."
    return cleaned[0].upper() + cleaned[1:]


def _count_words(text: str) -> int:
    return len(re.findall(r"\b\w+\b", text))


def _serialize_plan(plan: ContentPlan) -> dict[str, Any]:
    return {
        "id": str(plan.id),
        "conversation_id": str(plan.conversation_id),
        "user_id": str(plan.user_id),
        "title": plan.title,
        "description": plan.description,
        "target_keywords": plan.target_keywords,
        "outline": plan.outline,
        "research_notes": plan.research_notes,
        "status": plan.status,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
        "updated_at": plan.updated_at.isoformat() if plan.updated_at else None,
    }


def _serialize_content_item(content_item: ContentItem) -> dict[str, Any]:
    return {
        "id": str(content_item.id),
        "content_plan_id": str(content_item.content_plan_id),
        "user_id": str(content_item.user_id),
        "title": content_item.title,
        "content": content_item.content,
        "html_content": content_item.html_content,
        "markdown_content": content_item.markdown_content,
        "meta_description": content_item.meta_description,
        "tags": content_item.tags,
        "word_count": content_item.word_count,
        "status": content_item.status,
        "version": content_item.version,
        "created_at": content_item.created_at.isoformat() if content_item.created_at else None,
        "updated_at": content_item.updated_at.isoformat() if content_item.updated_at else None,
    }
