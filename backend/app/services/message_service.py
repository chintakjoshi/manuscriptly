from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import MessageCreateRequest
from app.models import Conversation, Message
from app.services.message_formatters import format_messages_as_transcript, format_messages_for_history


class MessageServiceError(Exception):
    pass


class NotFoundError(MessageServiceError):
    pass


class MessageService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create_message(self, payload: MessageCreateRequest) -> Message:
        conversation = self.db.get(Conversation, payload.conversation_id)
        if conversation is None:
            raise NotFoundError("Session not found.")

        message = Message(
            conversation_id=payload.conversation_id,
            role=payload.role,
            content=payload.content,
            tool_calls=payload.tool_calls,
            tool_results=payload.tool_results,
            context_used=payload.context_used,
        )
        self.db.add(message)
        self.db.commit()
        self.db.refresh(message)
        return message

    def list_messages_by_session(self, session_id: UUID) -> list[Message]:
        conversation = self.db.get(Conversation, session_id)
        if conversation is None:
            raise NotFoundError("Session not found.")

        query = (
            select(Message)
            .where(Message.conversation_id == session_id)
            .order_by(Message.created_at.asc())
        )
        return self.db.execute(query).scalars().all()

    def get_conversation_history(self, session_id: UUID) -> list[dict]:
        messages = self.list_messages_by_session(session_id)
        return format_messages_for_history(messages)

    def get_conversation_transcript(self, session_id: UUID) -> str:
        messages = self.list_messages_by_session(session_id)
        return format_messages_as_transcript(messages)
