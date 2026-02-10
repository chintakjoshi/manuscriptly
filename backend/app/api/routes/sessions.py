from __future__ import annotations

from uuid import UUID

from flask import Blueprint, jsonify, request
from pydantic import ValidationError
from sqlalchemy import select

from app.api.schemas import SessionCreateRequest
from app.api.utils import error_response, to_json_value, validation_error_response
from app.db.session import SessionLocal
from app.models import Conversation, User

sessions_bp = Blueprint("sessions", __name__, url_prefix="/api/v1/sessions")


def serialize_session(session: Conversation) -> dict:
    return {
        "id": to_json_value(session.id),
        "user_id": to_json_value(session.user_id),
        "title": session.title,
        "status": session.status,
        "created_at": to_json_value(session.created_at),
        "updated_at": to_json_value(session.updated_at),
    }


@sessions_bp.post("")
def create_session():
    """
    Create session
    ---
    tags:
      - Sessions
    parameters:
      - in: body
        name: body
        required: true
        schema:
          $ref: '#/definitions/SessionCreateRequest'
    responses:
      201:
        description: Session created.
        schema:
          $ref: '#/definitions/Session'
      400:
        description: Validation error.
        schema:
          $ref: '#/definitions/ErrorResponse'
      404:
        description: User not found.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    payload = request.get_json(silent=True)
    if payload is None:
        return error_response("Request body must be valid JSON.", 400)

    try:
        body = SessionCreateRequest.model_validate(payload)
    except ValidationError as exc:
        return validation_error_response(exc)

    db = SessionLocal()
    try:
        user = db.get(User, body.user_id)
        if user is None:
            return error_response("User not found.", 404)

        session = Conversation(
            user_id=body.user_id,
            title=body.title,
            status=body.status,
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return jsonify(serialize_session(session)), 201
    finally:
        db.close()


@sessions_bp.get("")
def list_sessions():
    """
    List sessions
    ---
    tags:
      - Sessions
    parameters:
      - in: query
        name: user_id
        required: false
        type: string
        format: uuid
        description: Optional filter by user ID.
    responses:
      200:
        description: Sessions list.
        schema:
          $ref: '#/definitions/SessionListResponse'
      400:
        description: Invalid query parameter.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    user_id = request.args.get("user_id")

    db = SessionLocal()
    try:
        query = select(Conversation).order_by(Conversation.created_at.desc())
        if user_id:
            try:
                user_uuid = UUID(user_id)
            except ValueError:
                return error_response("Invalid user_id query parameter.", 400)
            query = query.where(Conversation.user_id == user_uuid)

        sessions = db.execute(query).scalars().all()
        return jsonify(
            {
                "items": [serialize_session(session) for session in sessions],
                "count": len(sessions),
            }
        )
    finally:
        db.close()


@sessions_bp.get("/<uuid:session_id>")
def get_session(session_id):
    """
    Get session
    ---
    tags:
      - Sessions
    parameters:
      - in: path
        name: session_id
        required: true
        type: string
        format: uuid
    responses:
      200:
        description: Session details.
        schema:
          $ref: '#/definitions/Session'
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
        return jsonify(serialize_session(session))
    finally:
        db.close()
