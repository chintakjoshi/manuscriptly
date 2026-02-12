from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from typing import Any
from uuid import UUID

from anthropic import Anthropic
from anthropic import APIConnectionError, APIError, APITimeoutError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent_tools import ToolExecutionError, ToolExecutionRouter, ToolRegistry, build_default_tool_registry
from app.core.config import Config
from app.models import ContentPlan, Conversation, Message, User, UserProfile
from app.services.memory_service import AgentMemoryService

BASE_SYSTEM_PROMPT = """
You are Kaka Writer, an AI content strategist and writer assistant.

Your goals:
1. Understand the user's blog/content objective.
2. Provide high-quality, practical writing guidance.
3. Ask concise clarification questions only when critical information is missing.
4. Keep tone and style consistent with user/company context when provided.
5. Always use available tools when needed for planning, updates, full content generation, or current-web research.
6. When using tools, ensure inputs are complete and accurate, and incorporate tool results into your response.
7. Avoid unnecessary back-and-forth; use tools to get information or perform tasks whenever possible instead of asking the user for details you can obtain through tools or memory.
8. If you don't know the answer to a question, use web_search to find the information instead of making up an answer or asking the user.
9. When generating mutiple different plan or content in same session, always run agents with the most recent plan_id to ensure you have the latest context, and if no plan_id is provided, try to infer it from conversation history or memory.

Current constraints:
- When tool output is available, incorporate it and clearly summarize what changed.
- Keep responses concise and actionable.
- Do not fabricate user/company details that were not provided.
- Reuse known memory before asking clarification questions.
- If the user needs current or factual external information, use web_search before answering.
- Internal resource IDs are hidden; never ask users for raw UUIDs like plan_id or message IDs.
""".strip()


class AIServiceError(Exception):
    pass


class AIConfigurationError(AIServiceError):
    pass


class AICompletionError(AIServiceError):
    pass


class ConversationNotFoundError(AIServiceError):
    pass


class AIService:
    _REDACTED_TOKEN = "[redacted]"
    _SENSITIVE_ID_FIELDS = {
        "id",
        "conversation_id",
        "user_id",
        "plan_id",
        "content_plan_id",
        "content_item_id",
        "assistant_message_id",
    }

    def __init__(self, db: Session) -> None:
        self.db = db
        self._client: Anthropic | None = None
        self.tool_registry: ToolRegistry = build_default_tool_registry()
        self.tool_router = ToolExecutionRouter(registry=self.tool_registry)
        self.memory_service = AgentMemoryService(db)

    def generate_assistant_reply(
        self,
        conversation_id: UUID,
        event_callback: Callable[[str, dict[str, Any]], None] | None = None,
        preferred_plan_id: UUID | None = None,
    ) -> tuple[str, dict[str, Any], dict[str, Any] | None, dict[str, Any] | None]:
        conversation = self.db.get(Conversation, conversation_id)
        if conversation is None:
            raise ConversationNotFoundError("Session not found.")

        history = self._build_anthropic_history(conversation_id)
        if not history:
            raise AICompletionError("Conversation history is empty. Add a user message before requesting completion.")

        user_context = self._build_user_context(conversation.user_id)
        memory_snapshot = self._build_agent_memory(
            conversation_id=conversation.id,
            user_id=conversation.user_id,
            user_context=user_context,
        )
        system_prompt = self._build_system_prompt(user_context, memory_snapshot)
        tool_calls_log: list[dict[str, Any]] = []
        tool_results_log: list[dict[str, Any]] = []
        conversation_messages: list[dict[str, Any]] = list(history)
        auto_tool_attempted = False

        for iteration in range(1, Config.ANTHROPIC_MAX_TOOL_ITERATIONS + 1):
            try:
                response = self._create_completion_with_retry(
                    system_prompt=system_prompt,
                    conversation_messages=conversation_messages,
                    conversation_id=conversation_id,
                    iteration=iteration,
                    event_callback=event_callback,
                )
            except AIConfigurationError:
                raise
            except Exception as exc:
                raise AICompletionError(f"Unexpected AI completion failure: {exc}") from exc

            parsed = self._parse_response_blocks(response)
            assistant_text_candidate = parsed["text"].strip()
            if not parsed["tool_uses"]:
                if not auto_tool_attempted:
                    auto_triggered = self._maybe_autorun_intent_tool(
                        conversation_id=conversation_id,
                        conversation_messages=conversation_messages,
                        preferred_plan_id=preferred_plan_id,
                        tool_calls_log=tool_calls_log,
                        tool_results_log=tool_results_log,
                        iteration=iteration,
                        assistant_text_hint=assistant_text_candidate,
                        event_callback=event_callback,
                    )
                    if auto_triggered:
                        auto_tool_attempted = True
                        continue

                assistant_text = assistant_text_candidate
                if not assistant_text:
                    raise AICompletionError("Anthropic response did not include assistant text.")

                context_used = {
                    "provider": "anthropic",
                    "model": Config.ANTHROPIC_MODEL,
                    "user_context": user_context,
                    "memory_snapshot": memory_snapshot,
                    "registered_tools": [tool["name"] for tool in self.tool_registry.list_anthropic_tools()],
                    "tool_calls_count": len(tool_calls_log),
                    "tool_results_count": len(tool_results_log),
                    "tool_iterations": iteration,
                }
                tool_calls_payload = (
                    {"count": len(tool_calls_log), "items": tool_calls_log} if tool_calls_log else None
                )
                tool_results_payload = (
                    {"count": len(tool_results_log), "items": tool_results_log} if tool_results_log else None
                )
                return assistant_text, context_used, tool_calls_payload, tool_results_payload

            if event_callback:
                event_callback(
                    "agent.tools.detected",
                    {
                        "conversation_id": str(conversation_id),
                        "iteration": iteration,
                        "count": len(parsed["tool_uses"]),
                    },
                )

            conversation_messages.append({"role": "assistant", "content": parsed["assistant_blocks"]})
            tool_result_blocks: list[dict[str, Any]] = []
            for tool_use in parsed["tool_uses"]:
                normalized_tool_input = self._normalize_tool_input(
                    tool_name=tool_use["name"],
                    tool_input=tool_use["input"],
                    conversation_id=conversation_id,
                    preferred_plan_id=preferred_plan_id,
                )
                tool_call_entry = {
                    "id": tool_use["id"],
                    "name": tool_use["name"],
                    "input": self._sanitize_tool_payload(normalized_tool_input),
                    "iteration": iteration,
                }
                tool_calls_log.append(tool_call_entry)

                if event_callback:
                    event_callback(
                        "agent.tool.started",
                        {
                            "conversation_id": str(conversation_id),
                            "tool_use_id": tool_use["id"],
                            "tool_name": tool_use["name"],
                            "iteration": iteration,
                            "activity_message": self._build_tool_activity_message(
                                tool_use["name"], normalized_tool_input
                            ),
                        },
                    )

                try:
                    execution = self.tool_router.execute(tool_use["name"], normalized_tool_input)
                    tool_result_payload = execution["result"]
                    tool_status = "completed"
                    is_error = False
                    if event_callback:
                        event_callback(
                            "agent.tool.completed",
                            {
                                "conversation_id": str(conversation_id),
                                "tool_use_id": tool_use["id"],
                                "tool_name": tool_use["name"],
                                "iteration": iteration,
                                "activity_message": self._build_tool_result_message(
                                    tool_use["name"], tool_result_payload
                                ),
                            },
                        )
                except ToolExecutionError as exc:
                    tool_result_payload = {"error": str(exc)}
                    tool_status = "failed"
                    is_error = True
                    if event_callback:
                        event_callback(
                            "agent.tool.failed",
                            {
                                "conversation_id": str(conversation_id),
                                "tool_use_id": tool_use["id"],
                                "tool_name": tool_use["name"],
                                "iteration": iteration,
                                "error": str(exc),
                                "activity_message": self._build_tool_failure_message(
                                    tool_use["name"], str(exc)
                                ),
                            },
                        )

                tool_result_entry = {
                    "tool_use_id": tool_use["id"],
                    "name": tool_use["name"],
                    "status": tool_status,
                    "result": self._sanitize_tool_payload(tool_result_payload),
                    "iteration": iteration,
                }
                tool_results_log.append(tool_result_entry)

                tool_result_payload_for_model = self._sanitize_tool_payload(tool_result_payload)
                result_block: dict[str, Any] = {
                    "type": "tool_result",
                    "tool_use_id": tool_use["id"],
                    "content": json.dumps(tool_result_payload_for_model, default=str),
                }
                if is_error:
                    result_block["is_error"] = True
                tool_result_blocks.append(result_block)

            conversation_messages.append({"role": "user", "content": tool_result_blocks})

        raise AICompletionError(
            f"Tool execution loop exceeded {Config.ANTHROPIC_MAX_TOOL_ITERATIONS} iterations without final text."
        )

    def _create_completion_with_retry(
        self,
        system_prompt: str,
        conversation_messages: list[dict[str, Any]],
        conversation_id: UUID,
        iteration: int,
        event_callback: Callable[[str, dict[str, Any]], None] | None = None,
    ) -> Any:
        max_attempts = max(Config.ANTHROPIC_RETRY_MAX_ATTEMPTS, 1)
        base_delay = max(Config.ANTHROPIC_RETRY_BASE_DELAY_SECONDS, 0.0)
        max_delay = max(Config.ANTHROPIC_RETRY_MAX_DELAY_SECONDS, 0.0)
        last_error: Exception | None = None

        for attempt in range(1, max_attempts + 1):
            try:
                return self._get_client().messages.create(
                    model=Config.ANTHROPIC_MODEL,
                    max_tokens=Config.ANTHROPIC_MAX_TOKENS,
                    temperature=Config.ANTHROPIC_TEMPERATURE,
                    system=system_prompt,
                    messages=conversation_messages,
                    tools=self.tool_registry.list_anthropic_tools(),
                )
            except AIConfigurationError:
                raise
            except (APIError, APIConnectionError, APITimeoutError) as exc:
                last_error = exc
                if attempt >= max_attempts or not self._is_retriable_provider_error(exc):
                    break

                delay_seconds = min(base_delay * (2 ** (attempt - 1)), max_delay) if base_delay > 0 else 0
                if event_callback:
                    event_callback(
                        "agent.response.retrying",
                        {
                            "conversation_id": str(conversation_id),
                            "iteration": iteration,
                            "attempt": attempt,
                            "max_attempts": max_attempts,
                            "retry_in_seconds": round(delay_seconds, 2),
                            "error": str(exc),
                        },
                    )
                if delay_seconds > 0:
                    time.sleep(delay_seconds)

        if last_error is not None:
            raise AICompletionError(
                "The AI provider is temporarily unavailable. Please try again in a moment."
            ) from last_error
        raise AICompletionError("The AI provider did not return a response.")

    @staticmethod
    def _is_retriable_provider_error(exc: Exception) -> bool:
        if isinstance(exc, (APIConnectionError, APITimeoutError)):
            return True

        if isinstance(exc, APIError):
            status_code = getattr(exc, "status_code", None)
            if isinstance(status_code, int):
                return status_code in {408, 409, 425, 429, 500, 502, 503, 504}
            return True
        return False

    def _normalize_tool_input(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        conversation_id: UUID,
        preferred_plan_id: UUID | None = None,
    ) -> dict[str, Any]:
        normalized: dict[str, Any] = dict(tool_input or {})

        if tool_name == "create_content_idea":
            user_request = self._extract_tool_user_request(normalized)
            if not user_request:
                user_request = self._build_recent_user_request(conversation_id)
            if user_request:
                normalized["user_request"] = user_request

        if tool_name in {"update_content_plan", "execute_plan"}:
            if preferred_plan_id is not None:
                normalized["plan_id"] = str(preferred_plan_id)
            else:
                normalized_plan_id = self._normalize_uuid_text(normalized.get("plan_id"))
                if normalized_plan_id:
                    normalized["plan_id"] = normalized_plan_id
                else:
                    inferred_plan_id = self._infer_latest_executable_plan_id(conversation_id)
                    if inferred_plan_id is None:
                        inferred_plan_id = self._infer_latest_plan_id(conversation_id)
                    if inferred_plan_id:
                        normalized["plan_id"] = inferred_plan_id
                    else:
                        normalized.pop("plan_id", None)

        if tool_name == "web_search":
            if not isinstance(normalized.get("query"), str) or not str(normalized.get("query")).strip():
                inferred_query = self._extract_tool_user_request(normalized) or self._build_recent_user_request(
                    conversation_id
                )
                if inferred_query:
                    normalized["query"] = inferred_query
            if not isinstance(normalized.get("max_results"), int):
                normalized["max_results"] = Config.WEB_SEARCH_MAX_RESULTS

        try:
            definition = self.tool_registry.get(tool_name)
            if "conversation_id" in definition.input_model.model_fields:
                normalized["conversation_id"] = str(conversation_id)
        except Exception:
            pass

        return normalized

    @staticmethod
    def _extract_tool_user_request(tool_input: dict[str, Any]) -> str | None:
        direct = tool_input.get("user_request")
        if isinstance(direct, str) and direct.strip():
            return direct.strip()

        for key in ("request", "content_request", "prompt", "brief", "description", "idea"):
            value = tool_input.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        topic = tool_input.get("topic")
        if isinstance(topic, str) and topic.strip():
            return f"Create a content plan about {topic.strip()}."
        return None

    @staticmethod
    def _build_tool_activity_message(tool_name: str, tool_input: dict[str, Any]) -> str:
        if tool_name == "web_search":
            query = tool_input.get("query")
            if isinstance(query, str) and query.strip():
                return f"Searching web for: {AIService._truncate_text(query.strip(), 140)}"
            return "Searching the web."
        return f"Running {tool_name}."

    @staticmethod
    def _build_tool_result_message(tool_name: str, tool_result: Any) -> str:
        if tool_name == "web_search":
            result_count = tool_result.get("result_count") if isinstance(tool_result, dict) else None
            if isinstance(result_count, int):
                return f"Web search completed with {result_count} result{'s' if result_count != 1 else ''}."
            return "Web search completed."
        return f"{tool_name} completed."

    @staticmethod
    def _build_tool_failure_message(tool_name: str, error: str) -> str:
        if tool_name == "web_search":
            return f"Web search failed: {AIService._truncate_text(error, 180)}"
        return f"{tool_name} failed."

    @staticmethod
    def _truncate_text(value: str, max_len: int) -> str:
        if len(value) <= max_len:
            return value
        return f"{value[: max_len - 1]}..."

    @staticmethod
    def _normalize_uuid_text(value: Any) -> str | None:
        if isinstance(value, UUID):
            return str(value)
        if isinstance(value, str):
            candidate = value.strip()
            if not candidate or candidate == AIService._REDACTED_TOKEN:
                return None
            try:
                return str(UUID(candidate))
            except ValueError:
                return None
        return None

    @classmethod
    def _sanitize_tool_payload(cls, value: Any) -> Any:
        if isinstance(value, dict):
            sanitized: dict[str, Any] = {}
            for key, nested_value in value.items():
                if key in cls._SENSITIVE_ID_FIELDS:
                    sanitized[key] = cls._REDACTED_TOKEN
                else:
                    sanitized[key] = cls._sanitize_tool_payload(nested_value)
            return sanitized
        if isinstance(value, list):
            return [cls._sanitize_tool_payload(item) for item in value]
        return value

    def _build_recent_user_request(self, conversation_id: UUID) -> str | None:
        try:
            rows = (
                self.db.execute(
                    select(Message.content)
                    .where(Message.conversation_id == conversation_id, Message.role == "user")
                    .order_by(Message.created_at.desc())
                    .limit(4)
                )
                .scalars()
                .all()
            )
        except Exception:
            return None

        snippets = [value.strip() for value in reversed(rows) if isinstance(value, str) and value.strip()]
        if not snippets:
            return None
        return " ".join(snippets)

    def _infer_latest_plan_id(self, conversation_id: UUID) -> str | None:
        try:
            plan = (
                self.db.execute(
                    select(ContentPlan.id)
                    .where(ContentPlan.conversation_id == conversation_id)
                    .order_by(ContentPlan.updated_at.desc())
                    .limit(1)
                )
                .scalar_one_or_none()
            )
        except Exception:
            return None

        return str(plan) if plan else None

    def _infer_latest_executable_plan_id(self, conversation_id: UUID) -> str | None:
        try:
            plan = (
                self.db.execute(
                    select(ContentPlan.id)
                    .where(
                        ContentPlan.conversation_id == conversation_id,
                        ContentPlan.status != "executed",
                    )
                    .order_by(ContentPlan.updated_at.desc())
                    .limit(1)
                )
                .scalar_one_or_none()
            )
        except Exception:
            return None

        return str(plan) if plan else None

    def get_registered_tools(self) -> list[dict[str, Any]]:
        return self.tool_registry.list_anthropic_tools()

    def _get_client(self) -> Anthropic:
        if self._client is not None:
            return self._client
        api_key = Config.ANTHROPIC_API_KEY.strip()
        if not api_key or api_key == "your_anthropic_api_key":
            raise AIConfigurationError("ANTHROPIC_API_KEY is not configured.")
        self._client = Anthropic(api_key=api_key)
        return self._client

    def _build_anthropic_history(self, conversation_id: UUID) -> list[dict[str, Any]]:
        rows = (
            self.db.execute(
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.created_at.asc())
            )
            .scalars()
            .all()
        )

        history: list[dict[str, Any]] = []
        for message in rows:
            if message.role not in {"user", "assistant"}:
                continue
            content = message.content
            tool_history = self._format_tool_metadata_for_history(message)
            if tool_history:
                content = f"{content}\n\n{tool_history}".strip()
            history.append({"role": message.role, "content": content})
        return history

    @staticmethod
    def _build_system_prompt(user_context: dict[str, Any], memory_snapshot: dict[str, Any]) -> str:
        context_lines = [
            f"- User Name: {user_context.get('user_name') or 'Unknown'}",
            f"- Company Name: {user_context.get('company_name') or 'Unknown'}",
            f"- Industry: {user_context.get('industry') or 'Unknown'}",
            f"- Target Audience: {user_context.get('target_audience') or 'Unknown'}",
            f"- Brand Voice: {user_context.get('brand_voice') or 'Unknown'}",
            f"- Additional Context: {user_context.get('additional_context') or 'None'}",
            f"- Content Preferences: {user_context.get('content_preferences') or 'None'}",
        ]
        memory_lines = AIService._format_memory_snapshot_for_prompt(memory_snapshot)
        guardrail_lines = [
            "- Before asking any question, check known context and memory first.",
            "- Do not ask again for details that are already known unless the user asks to change them.",
            "- Ask follow-up questions only when missing details are required to complete the current request.",
        ]

        return "\n\n".join(
            [
                BASE_SYSTEM_PROMPT,
                "User and Company Context:\n" + "\n".join(context_lines),
                "Agent Memory Snapshot:\n" + "\n".join(memory_lines),
                "Memory Guardrails:\n" + "\n".join(guardrail_lines),
            ]
        )

    def _build_user_context(self, user_id: UUID) -> dict[str, Any]:
        profile = self.db.execute(select(UserProfile).where(UserProfile.user_id == user_id)).scalar_one_or_none()
        user = self.db.get(User, user_id)
        return {
            "user_name": getattr(user, "user_name", None),
            "company_name": getattr(profile, "company_name", None),
            "industry": getattr(profile, "industry", None),
            "target_audience": getattr(profile, "target_audience", None),
            "brand_voice": getattr(profile, "brand_voice", None),
            "content_preferences": getattr(profile, "content_preferences", None),
            "additional_context": getattr(profile, "additional_context", None),
        }

    def _build_agent_memory(
        self,
        conversation_id: UUID,
        user_id: UUID,
        user_context: dict[str, Any],
    ) -> dict[str, Any]:
        try:
            return self.memory_service.build_snapshot(
                conversation_id=conversation_id,
                user_id=user_id,
                user_context=user_context,
            )
        except Exception:
            return {
                "known_profile_fields": [],
                "inferred_facts": [],
                "current_session_intents": [],
                "cross_session_intents": [],
                "recent_plan_memory": [],
            }

    @staticmethod
    def _extract_text(response: Any) -> str:
        text_parts: list[str] = []
        for block in getattr(response, "content", []):
            block_type = getattr(block, "type", None)
            block_text = getattr(block, "text", None)
            if block_type == "text" and block_text:
                text_parts.append(block_text)

        text = "\n".join(text_parts).strip()
        if not text:
            raise AICompletionError("Anthropic response did not include assistant text.")
        return text

    @staticmethod
    def _format_tool_metadata_for_history(message: Message) -> str:
        lines: list[str] = []
        tool_calls = message.tool_calls or {}
        tool_results = message.tool_results or {}
        call_items = tool_calls.get("items") if isinstance(tool_calls, dict) else None
        result_items = tool_results.get("items") if isinstance(tool_results, dict) else None
        if isinstance(call_items, list) and call_items:
            names = [str(item.get("name")) for item in call_items if isinstance(item, dict) and item.get("name")]
            if names:
                lines.append(f"Tool calls: {', '.join(names)}")
        if isinstance(result_items, list) and result_items:
            statuses = [
                f"{item.get('name')}={item.get('status')}"
                for item in result_items
                if isinstance(item, dict) and item.get("name")
            ]
            if statuses:
                lines.append(f"Tool results: {', '.join(statuses)}")
        return "\n".join(lines)

    @staticmethod
    def _format_memory_snapshot_for_prompt(memory_snapshot: dict[str, Any]) -> list[str]:
        lines: list[str] = []

        known_profile_fields = memory_snapshot.get("known_profile_fields")
        if isinstance(known_profile_fields, list) and known_profile_fields:
            labels = [
                f"{item.get('label')}: {item.get('value')}"
                for item in known_profile_fields
                if isinstance(item, dict) and item.get("label") and item.get("value")
            ]
            if labels:
                lines.append(f"- Known profile facts: {'; '.join(labels)}")

        inferred_facts = memory_snapshot.get("inferred_facts")
        if isinstance(inferred_facts, list) and inferred_facts:
            labels = [
                f"{item.get('label')}: {item.get('value')}"
                for item in inferred_facts
                if isinstance(item, dict) and item.get("label") and item.get("value")
            ]
            if labels:
                lines.append(f"- Inferred facts from prior chat: {'; '.join(labels)}")

        current_session_intents = memory_snapshot.get("current_session_intents")
        if isinstance(current_session_intents, list) and current_session_intents:
            entries = [str(item) for item in current_session_intents if item]
            if entries:
                lines.append(f"- Recent current-session user requests: {' | '.join(entries)}")

        cross_session_intents = memory_snapshot.get("cross_session_intents")
        if isinstance(cross_session_intents, list) and cross_session_intents:
            entries = [str(item) for item in cross_session_intents if item]
            if entries:
                lines.append(f"- Relevant requests from earlier sessions: {' | '.join(entries)}")

        recent_plan_memory = memory_snapshot.get("recent_plan_memory")
        if isinstance(recent_plan_memory, list) and recent_plan_memory:
            plan_lines: list[str] = []
            for item in recent_plan_memory:
                if not isinstance(item, dict):
                    continue
                title = item.get("title")
                if not title:
                    continue
                keywords = item.get("keywords")
                if isinstance(keywords, list) and keywords:
                    plan_lines.append(f"{title} (keywords: {', '.join(str(keyword) for keyword in keywords)})")
                else:
                    plan_lines.append(str(title))
            if plan_lines:
                lines.append(f"- Recent plans: {' | '.join(plan_lines)}")

        if not lines:
            return ["- No prior memory available yet."]
        return lines

    @staticmethod
    def _parse_response_blocks(response: Any) -> dict[str, Any]:
        tool_uses: list[dict[str, Any]] = []
        assistant_blocks: list[dict[str, Any]] = []
        text_parts: list[str] = []

        for idx, block in enumerate(getattr(response, "content", [])):
            block_type = getattr(block, "type", None)
            if block_type == "text":
                block_text = getattr(block, "text", None)
                if block_text:
                    text_parts.append(block_text)
                    assistant_blocks.append({"type": "text", "text": block_text})
                continue

            if block_type == "tool_use":
                tool_name = getattr(block, "name", None)
                if not tool_name:
                    raise AICompletionError("Anthropic tool block missing tool name.")
                tool_input = getattr(block, "input", {})
                if tool_input is None:
                    tool_input = {}
                if not isinstance(tool_input, dict):
                    raise AICompletionError("Anthropic tool input must be a JSON object.")
                tool_use_id = str(getattr(block, "id", f"tool_use_{idx + 1}"))
                tool_use = {"id": tool_use_id, "name": str(tool_name), "input": tool_input}
                tool_uses.append(tool_use)
                assistant_blocks.append(
                    {
                        "type": "tool_use",
                        "id": tool_use_id,
                        "name": str(tool_name),
                        "input": tool_input,
                    }
                )

        text = "\n".join(text_parts).strip()
        if not assistant_blocks:
            raise AICompletionError("Anthropic response did not include recognized content blocks.")
        return {"text": text, "tool_uses": tool_uses, "assistant_blocks": assistant_blocks}

    def _maybe_autorun_intent_tool(
        self,
        conversation_id: UUID,
        conversation_messages: list[dict[str, Any]],
        preferred_plan_id: UUID | None,
        tool_calls_log: list[dict[str, Any]],
        tool_results_log: list[dict[str, Any]],
        iteration: int,
        assistant_text_hint: str | None = None,
        event_callback: Callable[[str, dict[str, Any]], None] | None = None,
    ) -> bool:
        latest_user_text = self._extract_latest_user_text(conversation_messages)
        tool_name = self._select_autorun_tool_name(latest_user_text)
        if tool_name is None and self._should_autorun_create_plan_from_clarifications(
            conversation_messages,
            latest_user_text,
            assistant_text_hint=assistant_text_hint,
        ):
            tool_name = "create_content_idea"
        if tool_name is None:
            return False
        if self._has_completed_tool(tool_results_log, tool_name):
            return False

        seed_input = self._build_autorun_seed_input(tool_name, latest_user_text)
        normalized_tool_input = self._normalize_tool_input(
            tool_name=tool_name,
            tool_input=seed_input,
            conversation_id=conversation_id,
            preferred_plan_id=preferred_plan_id,
        )
        if tool_name == "execute_plan" and "plan_id" not in normalized_tool_input:
            return False
        if tool_name == "create_content_idea" and not str(normalized_tool_input.get("user_request") or "").strip():
            return False

        tool_use_id = f"auto_{tool_name}_{iteration}"
        if event_callback:
            event_callback(
                "agent.tools.detected",
                {
                    "conversation_id": str(conversation_id),
                    "iteration": iteration,
                    "count": 1,
                },
            )
            event_callback(
                "agent.tool.started",
                {
                    "conversation_id": str(conversation_id),
                    "tool_use_id": tool_use_id,
                    "tool_name": tool_name,
                    "iteration": iteration,
                    "activity_message": self._build_tool_activity_message(
                        tool_name,
                        normalized_tool_input,
                    ),
                },
            )

        tool_call_entry = {
            "id": tool_use_id,
            "name": tool_name,
            "input": self._sanitize_tool_payload(normalized_tool_input),
            "iteration": iteration,
        }
        tool_calls_log.append(tool_call_entry)

        tool_status = "completed"
        is_error = False
        try:
            execution = self.tool_router.execute(tool_name, normalized_tool_input)
            tool_result_payload = execution["result"]
            if event_callback:
                event_callback(
                    "agent.tool.completed",
                    {
                        "conversation_id": str(conversation_id),
                        "tool_use_id": tool_use_id,
                        "tool_name": tool_name,
                        "iteration": iteration,
                        "activity_message": self._build_tool_result_message(
                            tool_name,
                            tool_result_payload,
                        ),
                    },
                )
        except ToolExecutionError as exc:
            tool_result_payload = {"error": str(exc)}
            tool_status = "failed"
            is_error = True
            if event_callback:
                event_callback(
                    "agent.tool.failed",
                    {
                        "conversation_id": str(conversation_id),
                        "tool_use_id": tool_use_id,
                        "tool_name": tool_name,
                        "iteration": iteration,
                        "error": str(exc),
                        "activity_message": self._build_tool_failure_message(tool_name, str(exc)),
                    },
                )

        tool_result_entry = {
            "tool_use_id": tool_use_id,
            "name": tool_name,
            "status": tool_status,
            "result": self._sanitize_tool_payload(tool_result_payload),
            "iteration": iteration,
        }
        tool_results_log.append(tool_result_entry)

        tool_result_payload_for_model = self._sanitize_tool_payload(tool_result_payload)
        result_block: dict[str, Any] = {
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": json.dumps(tool_result_payload_for_model, default=str),
        }
        if is_error:
            result_block["is_error"] = True

        conversation_messages.append(
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": tool_use_id,
                        "name": tool_name,
                        "input": normalized_tool_input,
                    }
                ],
            }
        )
        conversation_messages.append({"role": "user", "content": [result_block]})
        return True

    @staticmethod
    def _has_completed_tool(tool_results_log: list[dict[str, Any]], tool_name: str) -> bool:
        for item in tool_results_log:
            if item.get("name") == tool_name and item.get("status") == "completed":
                return True
        return False

    @staticmethod
    def _build_autorun_seed_input(tool_name: str, latest_user_text: str) -> dict[str, Any]:
        if tool_name == "create_content_idea":
            return {"user_request": latest_user_text}
        if tool_name == "web_search":
            return {"query": latest_user_text}
        return {}

    @staticmethod
    def _extract_latest_user_text(conversation_messages: list[dict[str, Any]]) -> str:
        for message in reversed(conversation_messages):
            if message.get("role") != "user":
                continue
            extracted = AIService._extract_message_text(message.get("content"))
            if extracted:
                return extracted
        return ""

    @staticmethod
    def _extract_latest_assistant_text(conversation_messages: list[dict[str, Any]]) -> str:
        for message in reversed(conversation_messages):
            if message.get("role") != "assistant":
                continue
            extracted = AIService._extract_message_text(message.get("content"))
            if extracted:
                return extracted
        return ""

    @classmethod
    def _extract_message_text(cls, content: Any) -> str:
        if isinstance(content, str):
            return content.strip()
        if not isinstance(content, list):
            return ""
        text_blocks = [
            str(block.get("text")).strip()
            for block in content
            if isinstance(block, dict) and block.get("type") == "text" and block.get("text")
        ]
        if text_blocks:
            return "\n".join(text_blocks)
        return ""

    @classmethod
    def _should_autorun_create_plan_from_clarifications(
        cls,
        conversation_messages: list[dict[str, Any]],
        latest_user_text: str,
        assistant_text_hint: str | None = None,
    ) -> bool:
        normalized_user_text = latest_user_text.lower().strip()
        if not normalized_user_text:
            return False
        if cls._is_create_content_idea_intent(latest_user_text):
            return False

        latest_assistant_text = cls._extract_latest_assistant_text(conversation_messages)
        normalized_assistant_text = latest_assistant_text.lower().strip()
        if assistant_text_hint:
            normalized_assistant_text = (
                f"{normalized_assistant_text}\n{assistant_text_hint.lower().strip()}"
                if normalized_assistant_text
                else assistant_text_hint.lower().strip()
            )
        if not normalized_assistant_text:
            return False
        if not cls._looks_like_plan_clarification_prompt(normalized_assistant_text):
            return False
        if not cls._looks_like_plan_clarification_answer(normalized_user_text):
            return False
        if not cls._has_prior_blog_request_before_latest_assistant(conversation_messages):
            return False
        return True

    @classmethod
    def _has_prior_blog_request_before_latest_assistant(cls, conversation_messages: list[dict[str, Any]]) -> bool:
        latest_assistant_index = None
        for idx in range(len(conversation_messages) - 1, -1, -1):
            if conversation_messages[idx].get("role") == "assistant":
                latest_assistant_index = idx
                break
        if latest_assistant_index is None:
            return False

        for message in reversed(conversation_messages[:latest_assistant_index]):
            if message.get("role") != "user":
                continue
            candidate_text = cls._extract_message_text(message.get("content"))
            if cls._looks_like_blog_request(candidate_text):
                return True
        return False

    @staticmethod
    def _looks_like_plan_clarification_prompt(normalized_text: str) -> bool:
        if not normalized_text:
            return False
        cues = (
            "quick clarification",
            "clarification",
            "specific angle",
            "target audience",
            "blog goal",
            "what aspect",
            "once you provide",
            "once you share",
            "content plan",
            "build the perfect",
        )
        matches = sum(1 for cue in cues if cue in normalized_text)
        return matches >= 2

    @staticmethod
    def _looks_like_plan_clarification_answer(normalized_text: str) -> bool:
        if not normalized_text:
            return False
        segments = [segment.strip() for segment in re.split(r"[\n,;|]+", normalized_text) if segment.strip()]
        if len(segments) >= 2:
            return True
        cues = (
            "target audience",
            "audience",
            "educate",
            "inform",
            "thought leadership",
            "drive traffic",
            "seo",
            "angle",
            "focus",
            "goal",
            "students",
            "researchers",
            "professionals",
            "patients",
        )
        cue_hits = sum(1 for cue in cues if cue in normalized_text)
        return cue_hits >= 2

    @staticmethod
    def _looks_like_blog_request(user_text: str) -> bool:
        normalized = user_text.lower().strip()
        if not normalized:
            return False
        has_blog_context = bool(re.search(r"\b(blog|article|post|content)\b", normalized))
        has_request_verb = bool(re.search(r"\b(create|generate|write|draft|plan|outline|brainstorm|want|need)\b", normalized))
        return has_blog_context and has_request_verb

    @classmethod
    def _select_autorun_tool_name(cls, user_text: str) -> str | None:
        if cls._is_execute_intent(user_text):
            return "execute_plan"
        if cls._is_create_content_idea_intent(user_text):
            return "create_content_idea"
        if cls._is_web_search_intent(user_text):
            return "web_search"
        return None

    @staticmethod
    def _is_execute_intent(user_text: str) -> bool:
        normalized = user_text.lower().strip()
        if not normalized:
            return False
        if re.search(r"\b(don't|do not|not now|later)\b.*\b(execute|generate|write|create)\b", normalized):
            return False
        execute_patterns = (
            r"\bexecute\b",
            r"\bgenerate\b.*\b(full|complete)\b.*\b(blog|content|article|post)\b",
            r"\bwrite\b.*\b(full|complete)\b.*\b(blog|article|post)\b",
            r"\bcreate\b.*\b(full|complete)\b.*\b(blog|article|post)\b",
            r"\bready to publish\b",
        )
        return any(re.search(pattern, normalized) for pattern in execute_patterns)

    @staticmethod
    def _is_create_content_idea_intent(user_text: str) -> bool:
        normalized = user_text.lower().strip()
        if not normalized:
            return False
        if re.search(r"\b(don't|do not|not now|later)\b.*\b(create|generate|make|build)\b", normalized):
            return False

        explicit_patterns = (
            r"\b(create|generate|make|build|draft)\b.*\b(content\s+idea|plan|outline|blog\s+plan|article\s+plan)\b",
            r"\bhelp me\b.*\b(plan|outline)\b",
            r"\bbrainstorm\b.*\b(blog|article|post|idea)\b",
        )
        if any(re.search(pattern, normalized) for pattern in explicit_patterns):
            return True

        has_blog_context = bool(re.search(r"\b(blog|article|post|content)\b", normalized))
        specification_cues = (
            "target audience",
            "audience",
            "tone",
            "style",
            "focus",
            "angle",
            "word",
            "length",
            "keywords",
        )
        cue_count = sum(1 for cue in specification_cues if cue in normalized)
        return has_blog_context and cue_count >= 2

    @staticmethod
    def _is_web_search_intent(user_text: str) -> bool:
        normalized = user_text.lower().strip()
        if not normalized:
            return False
        explicit_patterns = (
            r"\b(search|look up|find)\b.*\b(web|internet|online)\b",
            r"\bsearch\b.*\bfor\b",
            r"\bwhat are\b.*\bcurrent trends\b",
            r"\blatest\b.*\b(trends|news|updates|statistics|stats)\b",
        )
        return any(re.search(pattern, normalized) for pattern in explicit_patterns)
