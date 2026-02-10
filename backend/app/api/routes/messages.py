from __future__ import annotations

from flask import Blueprint, jsonify, request
from pydantic import ValidationError
from sqlalchemy import select

from app.api.schemas import MessageCreateRequest
from app.api.utils import error_response, to_json_value, validation_error_response
from app.core.sse import sse_manager
from app.db.session import SessionLocal
from app.models import Conversation, Message

messages_bp = Blueprint("messages", __name__, url_prefix="/api/v1")


def serialize_message(message: Message) -> dict:
    return {
        "id": to_json_value(message.id),
        "conversation_id": to_json_value(message.conversation_id),
        "role": message.role,
        "content": message.content,
        "tool_calls": to_json_value(message.tool_calls),
        "tool_results": to_json_value(message.tool_results),
        "context_used": to_json_value(message.context_used),
        "created_at": to_json_value(message.created_at),
    }


@messages_bp.post("/messages")
def create_message():
    """
    Create message
    ---
    tags:
      - Messages
    parameters:
      - in: body
        name: body
        required: true
        schema:
          $ref: '#/definitions/MessageCreateRequest'
    responses:
      201:
        description: Message created.
        schema:
          $ref: '#/definitions/Message'
      400:
        description: Validation error.
        schema:
          $ref: '#/definitions/ErrorResponse'
      404:
        description: Session not found.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    payload = request.get_json(silent=True)
    if payload is None:
        return error_response("Request body must be valid JSON.", 400)

    try:
        body = MessageCreateRequest.model_validate(payload)
    except ValidationError as exc:
        return validation_error_response(exc)

    db = SessionLocal()
    try:
        conversation = db.get(Conversation, body.conversation_id)
        if conversation is None:
            return error_response("Session not found.", 404)

        message = Message(
            conversation_id=body.conversation_id,
            role=body.role,
            content=body.content,
            tool_calls=body.tool_calls,
            tool_results=body.tool_results,
            context_used=body.context_used,
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        payload = serialize_message(message)
        sse_manager.publish("message.created", payload, session_id=str(message.conversation_id))
        return jsonify(payload), 201
    finally:
        db.close()


@messages_bp.get("/sessions/<uuid:session_id>/messages")
def list_messages_by_session(session_id):
    """
    List messages by session
    ---
    tags:
      - Messages
    parameters:
      - in: path
        name: session_id
        required: true
        type: string
        format: uuid
    responses:
      200:
        description: Messages list for a session.
        schema:
          $ref: '#/definitions/MessageListResponse'
      404:
        description: Session not found.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    db = SessionLocal()
    try:
        session = db.get(Conversation, session_id)
        if session is None:
            return error_response("Session not found.", 404)

        query = (
            select(Message)
            .where(Message.conversation_id == session_id)
            .order_by(Message.created_at.asc())
        )
        messages = db.execute(query).scalars().all()
        return jsonify(
            {
                "items": [serialize_message(message) for message in messages],
                "count": len(messages),
            }
        )
    finally:
        db.close()
