from __future__ import annotations

from flask import Blueprint, jsonify, request
from pydantic import ValidationError

from app.api.schemas import AgentChatRequest, MessageCreateRequest
from app.api.utils import error_response, validation_error_response
from app.core.config import Config
from app.core.sse import sse_manager
from app.db.session import SessionLocal
from app.services import MessageService, NotFoundError
from app.services.ai_service import (
    AICompletionError,
    AIConfigurationError,
    AIService,
    ConversationNotFoundError,
)
from app.services.message_formatters import format_message_for_api

agent_bp = Blueprint("agent", __name__, url_prefix="/api/v1/agent")


@agent_bp.post("/chat")
def chat_with_agent():
    """
    Create user message and generate assistant reply via Anthropic
    ---
    tags:
      - Agent
    parameters:
      - in: body
        name: body
        required: true
        schema:
          $ref: '#/definitions/AgentChatRequest'
    responses:
      201:
        description: User and assistant messages created.
        schema:
          $ref: '#/definitions/AgentChatResponse'
      400:
        description: Validation error.
        schema:
          $ref: '#/definitions/ErrorResponse'
      404:
        description: Session not found.
        schema:
          $ref: '#/definitions/ErrorResponse'
      500:
        description: Anthropic configuration missing.
        schema:
          $ref: '#/definitions/ErrorResponse'
      502:
        description: Anthropic completion failed.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    payload = request.get_json(silent=True)
    if payload is None:
        return error_response("Request body must be valid JSON.", 400)

    try:
        body = AgentChatRequest.model_validate(payload)
    except ValidationError as exc:
        return validation_error_response(exc)

    db = SessionLocal()
    try:
        message_service = MessageService(db)
        ai_service = AIService(db)

        try:
            user_message = message_service.create_message(
                MessageCreateRequest(
                    conversation_id=body.conversation_id,
                    role="user",
                    content=body.content,
                )
            )
        except NotFoundError as exc:
            return error_response(str(exc), 404)

        user_payload = format_message_for_api(user_message)
        session_id = str(user_message.conversation_id)
        sse_manager.publish("message.created", user_payload, session_id=session_id)
        sse_manager.publish(
            "agent.response.started",
            {"conversation_id": session_id, "model": Config.ANTHROPIC_MODEL},
            session_id=session_id,
        )

        try:
            assistant_text, context_used = ai_service.generate_assistant_reply(body.conversation_id)
        except ConversationNotFoundError as exc:
            return error_response(str(exc), 404)
        except AIConfigurationError as exc:
            sse_manager.publish(
                "agent.response.failed",
                {"conversation_id": session_id, "error": str(exc)},
                session_id=session_id,
            )
            return error_response(str(exc), 500)
        except AICompletionError as exc:
            sse_manager.publish(
                "agent.response.failed",
                {"conversation_id": session_id, "error": str(exc)},
                session_id=session_id,
            )
            return error_response(str(exc), 502)

        try:
            assistant_message = message_service.create_message(
                MessageCreateRequest(
                    conversation_id=body.conversation_id,
                    role="assistant",
                    content=assistant_text,
                    context_used=context_used,
                )
            )
        except NotFoundError as exc:
            sse_manager.publish(
                "agent.response.failed",
                {"conversation_id": session_id, "error": str(exc)},
                session_id=session_id,
            )
            return error_response(str(exc), 404)
        assistant_payload = format_message_for_api(assistant_message)
        sse_manager.publish("message.created", assistant_payload, session_id=session_id)
        sse_manager.publish(
            "agent.response.completed",
            {
                "conversation_id": session_id,
                "assistant_message_id": assistant_payload["id"],
                "model": Config.ANTHROPIC_MODEL,
            },
            session_id=session_id,
        )

        return (
            jsonify(
                {
                    "user_message": user_payload,
                    "assistant_message": assistant_payload,
                    "model": Config.ANTHROPIC_MODEL,
                }
            ),
            201,
        )
    finally:
        db.close()
