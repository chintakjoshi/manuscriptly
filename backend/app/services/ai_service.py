from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any
from uuid import UUID

from anthropic import Anthropic
from anthropic import APIConnectionError, APIError, APITimeoutError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent_tools import ToolExecutionError, ToolExecutionRouter, ToolRegistry, build_default_tool_registry
from app.core.config import Config
from app.models import Conversation, Message, User, UserProfile

BASE_SYSTEM_PROMPT = """
You are Kaka Writer, an AI content strategist and writer assistant.

Your goals:
1. Understand the user's blog/content objective.
2. Provide high-quality, practical writing guidance.
3. Ask concise clarification questions only when critical information is missing.
4. Keep tone and style consistent with user/company context when provided.
5. Use available tools when the user requests plan creation, plan updates, or full content generation.

Current constraints:
- When tool output is available, incorporate it and clearly summarize what changed.
- Keep responses concise and actionable.
- Do not fabricate user/company details that were not provided.
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
    def __init__(self, db: Session) -> None:
        self.db = db
        self._client: Anthropic | None = None
        self.tool_registry: ToolRegistry = build_default_tool_registry()
        self.tool_router = ToolExecutionRouter(registry=self.tool_registry)

    def generate_assistant_reply(
        self,
        conversation_id: UUID,
        event_callback: Callable[[str, dict[str, Any]], None] | None = None,
    ) -> tuple[str, dict[str, Any], dict[str, Any] | None, dict[str, Any] | None]:
        conversation = self.db.get(Conversation, conversation_id)
        if conversation is None:
            raise ConversationNotFoundError("Session not found.")

        history = self._build_anthropic_history(conversation_id)
        if not history:
            raise AICompletionError("Conversation history is empty. Add a user message before requesting completion.")

        user_context = self._build_user_context(conversation.user_id)
        system_prompt = self._build_system_prompt(user_context)
        tool_calls_log: list[dict[str, Any]] = []
        tool_results_log: list[dict[str, Any]] = []
        conversation_messages: list[dict[str, Any]] = list(history)

        for iteration in range(1, Config.ANTHROPIC_MAX_TOOL_ITERATIONS + 1):
            try:
                response = self._get_client().messages.create(
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
                raise AICompletionError(f"Anthropic completion failed: {exc}") from exc
            except Exception as exc:
                raise AICompletionError(f"Unexpected AI completion failure: {exc}") from exc

            parsed = self._parse_response_blocks(response)
            if not parsed["tool_uses"]:
                assistant_text = parsed["text"].strip()
                if not assistant_text:
                    raise AICompletionError("Anthropic response did not include assistant text.")

                context_used = {
                    "provider": "anthropic",
                    "model": Config.ANTHROPIC_MODEL,
                    "user_context": user_context,
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
                tool_call_entry = {
                    "id": tool_use["id"],
                    "name": tool_use["name"],
                    "input": tool_use["input"],
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
                        },
                    )

                try:
                    execution = self.tool_router.execute(tool_use["name"], tool_use["input"])
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
                            },
                        )

                tool_result_entry = {
                    "tool_use_id": tool_use["id"],
                    "name": tool_use["name"],
                    "status": tool_status,
                    "result": tool_result_payload,
                    "iteration": iteration,
                }
                tool_results_log.append(tool_result_entry)

                result_block: dict[str, Any] = {
                    "type": "tool_result",
                    "tool_use_id": tool_use["id"],
                    "content": json.dumps(tool_result_payload, default=str),
                }
                if is_error:
                    result_block["is_error"] = True
                tool_result_blocks.append(result_block)

            conversation_messages.append({"role": "user", "content": tool_result_blocks})

        raise AICompletionError(
            f"Tool execution loop exceeded {Config.ANTHROPIC_MAX_TOOL_ITERATIONS} iterations without final text."
        )

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
    def _build_system_prompt(user_context: dict[str, Any]) -> str:
        context_lines = [
            f"- User Name: {user_context.get('user_name') or 'Unknown'}",
            f"- Company Name: {user_context.get('company_name') or 'Unknown'}",
            f"- Industry: {user_context.get('industry') or 'Unknown'}",
            f"- Target Audience: {user_context.get('target_audience') or 'Unknown'}",
            f"- Brand Voice: {user_context.get('brand_voice') or 'Unknown'}",
            f"- Additional Context: {user_context.get('additional_context') or 'None'}",
            f"- Content Preferences: {user_context.get('content_preferences') or 'None'}",
        ]
        return "\n\n".join([BASE_SYSTEM_PROMPT, "User and Company Context:\n" + "\n".join(context_lines)])

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
