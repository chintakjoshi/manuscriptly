from __future__ import annotations

from flask import Blueprint, jsonify, request
from pydantic import ValidationError

from app.api.schemas import MessageCreateRequest
from app.api.utils import error_response, validation_error_response
from app.core.sse import sse_manager
from app.db.session import SessionLocal
from app.services import MessageService, NotFoundError
from app.services.message_formatters import format_message_for_api

messages_bp = Blueprint("messages", __name__, url_prefix="/api/v1")


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
        service = MessageService(db)
        try:
            message = service.create_message(body)
        except NotFoundError as exc:
            return error_response(str(exc), 404)

        payload = format_message_for_api(message)
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
        service = MessageService(db)
        try:
            messages = service.list_messages_by_session(session_id)
        except NotFoundError as exc:
            return error_response(str(exc), 404)

        return jsonify({"items": [format_message_for_api(message) for message in messages], "count": len(messages)})
    finally:
        db.close()


@messages_bp.get("/sessions/<uuid:session_id>/history")
def get_session_history(session_id):
    """
    Get conversation history (model format)
    ---
    tags:
      - Messages
    parameters:
      - in: path
        name: session_id
        required: true
        type: string
        format: uuid
      - in: query
        name: format
        required: false
        type: string
        enum: [model, transcript]
        description: model (role/content payload) or transcript (user/assistant text).
    responses:
      200:
        description: Conversation history for model context.
        schema:
          $ref: '#/definitions/ConversationHistoryResponse'
      400:
        description: Invalid format option.
        schema:
          $ref: '#/definitions/ErrorResponse'
      404:
        description: Session not found.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    output_format = request.args.get("format", "model")

    db = SessionLocal()
    try:
        service = MessageService(db)
        if output_format == "transcript":
            try:
                transcript = service.get_conversation_transcript(session_id)
            except NotFoundError as exc:
                return error_response(str(exc), 404)
            return jsonify({"format": "transcript", "transcript": transcript})

        if output_format != "model":
            return error_response("Invalid format. Use 'model' or 'transcript'.", 400)

        try:
            history = service.get_conversation_history(session_id)
        except NotFoundError as exc:
            return error_response(str(exc), 404)

        return jsonify({"format": "model", "items": history, "count": len(history)})
    finally:
        db.close()
