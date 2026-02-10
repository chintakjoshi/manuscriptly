from __future__ import annotations

from typing import Any
from uuid import UUID

from anthropic import Anthropic
from anthropic import APIConnectionError, APIError, APITimeoutError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Config
from app.models import Conversation, Message, User, UserProfile

BASE_SYSTEM_PROMPT = """
You are Kaka Writer, an AI content strategist and writer assistant.

Your goals:
1. Understand the user's blog/content objective.
2. Provide high-quality, practical writing guidance.
3. Ask concise clarification questions only when critical information is missing.
4. Keep tone and style consistent with user/company context when provided.

Current constraints:
- Tools are not enabled yet.
- Respond with normal assistant text only.
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

    def generate_assistant_reply(self, conversation_id: UUID) -> tuple[str, dict[str, Any]]:
        conversation = self.db.get(Conversation, conversation_id)
        if conversation is None:
            raise ConversationNotFoundError("Session not found.")

        history = self._build_anthropic_history(conversation_id)
        if not history:
            raise AICompletionError("Conversation history is empty. Add a user message before requesting completion.")

        user_context = self._build_user_context(conversation.user_id)
        system_prompt = self._build_system_prompt(user_context)

        try:
            response = self._get_client().messages.create(
                model=Config.ANTHROPIC_MODEL,
                max_tokens=Config.ANTHROPIC_MAX_TOKENS,
                temperature=Config.ANTHROPIC_TEMPERATURE,
                system=system_prompt,
                messages=history,
            )
        except AIConfigurationError:
            raise
        except (APIError, APIConnectionError, APITimeoutError) as exc:
            raise AICompletionError(f"Anthropic completion failed: {exc}") from exc
        except Exception as exc:
            raise AICompletionError(f"Unexpected AI completion failure: {exc}") from exc

        assistant_text = self._extract_text(response)
        context_used = {
            "provider": "anthropic",
            "model": Config.ANTHROPIC_MODEL,
            "user_context": user_context,
        }
        return assistant_text, context_used

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
            history.append({"role": message.role, "content": message.content})
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
