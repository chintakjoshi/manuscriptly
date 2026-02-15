from __future__ import annotations

import re
from uuid import uuid4

from flask import Blueprint, jsonify, request
from pydantic import ValidationError
from sqlalchemy import select
from werkzeug.security import generate_password_hash

from app.api.schemas import UserOnboardingRequest
from app.api.utils import error_response, to_json_value, validation_error_response
from app.db.session import SessionLocal
from app.models import User, UserProfile

users_bp = Blueprint("users", __name__, url_prefix="/api/v1/users")


def serialize_user_context(user: User, profile: UserProfile | None) -> dict:
    return {
        "id": to_json_value(user.id),
        "user_name": user.user_name,
        "email": user.email,
        "created_at": to_json_value(user.created_at),
        "updated_at": to_json_value(user.updated_at),
        "profile": {
            "id": to_json_value(profile.id) if profile else None,
            "user_id": to_json_value(profile.user_id) if profile else to_json_value(user.id),
            "company_name": profile.company_name if profile else None,
            "industry": profile.industry if profile else None,
            "target_audience": profile.target_audience if profile else None,
            "brand_voice": profile.brand_voice if profile else None,
            "content_preferences": to_json_value(profile.content_preferences) if profile else None,
            "additional_context": profile.additional_context if profile else None,
            "created_at": to_json_value(profile.created_at) if profile else None,
            "updated_at": to_json_value(profile.updated_at) if profile else None,
        },
    }


def _build_generated_email(user_name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", user_name.lower()).strip("-")
    if not slug:
        slug = "writer"
    return f"{slug}-{uuid4().hex[:10]}@local.manuscriptly"


@users_bp.post("/onboarding")
def upsert_user_onboarding():
    """
    Create or update onboarding context
    ---
    tags:
      - Users
    parameters:
      - in: body
        name: body
        required: true
        schema:
          $ref: '#/definitions/UserOnboardingRequest'
    responses:
      200:
        description: User context updated.
        schema:
          $ref: '#/definitions/UserContext'
      201:
        description: User context created.
        schema:
          $ref: '#/definitions/UserContext'
      400:
        description: Validation error.
        schema:
          $ref: '#/definitions/ErrorResponse'
      404:
        description: User not found for provided user_id.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    payload = request.get_json(silent=True)
    if payload is None:
        return error_response("Request body must be valid JSON.", 400)

    try:
        body = UserOnboardingRequest.model_validate(payload)
    except ValidationError as exc:
        return validation_error_response(exc)

    db = SessionLocal()
    try:
        created = False
        if body.user_id:
            user = db.get(User, body.user_id)
            if user is None:
                return error_response("User not found.", 404)
        else:
            user = User(
                user_name=body.user_name,
                email=_build_generated_email(body.user_name),
                password_hash=generate_password_hash(uuid4().hex),
            )
            db.add(user)
            db.flush()
            created = True

        user.user_name = body.user_name

        profile = db.execute(select(UserProfile).where(UserProfile.user_id == user.id)).scalar_one_or_none()
        if profile is None:
            profile = UserProfile(user_id=user.id)
            db.add(profile)

        profile.company_name = body.company_name
        profile.industry = body.industry
        profile.target_audience = body.target_audience
        profile.brand_voice = body.brand_voice
        profile.content_preferences = body.content_preferences
        profile.additional_context = body.additional_context

        db.commit()
        db.refresh(user)
        db.refresh(profile)
        status_code = 201 if created else 200
        return jsonify(serialize_user_context(user, profile)), status_code
    finally:
        db.close()


@users_bp.get("/<uuid:user_id>")
def get_user_context(user_id):
    """
    Get user context
    ---
    tags:
      - Users
    parameters:
      - in: path
        name: user_id
        required: true
        type: string
        format: uuid
    responses:
      200:
        description: User context details.
        schema:
          $ref: '#/definitions/UserContext'
      404:
        description: User not found.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None:
            return error_response("User not found.", 404)
        profile = db.execute(select(UserProfile).where(UserProfile.user_id == user.id)).scalar_one_or_none()
        return jsonify(serialize_user_context(user, profile))
    finally:
        db.close()
