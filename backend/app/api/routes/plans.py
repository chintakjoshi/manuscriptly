from __future__ import annotations

from uuid import UUID

from flask import Blueprint, jsonify, request
from pydantic import ValidationError
from sqlalchemy import select

from app.api.schemas import PlanCreateRequest, PlanUpdateRequest
from app.api.utils import error_response, to_json_value, validation_error_response
from app.db.session import SessionLocal
from app.models import ContentPlan, Conversation, User

plans_bp = Blueprint("plans", __name__, url_prefix="/api/v1/plans")


def serialize_plan(plan: ContentPlan) -> dict:
    return {
        "id": to_json_value(plan.id),
        "conversation_id": to_json_value(plan.conversation_id),
        "user_id": to_json_value(plan.user_id),
        "title": plan.title,
        "description": plan.description,
        "target_keywords": plan.target_keywords,
        "outline": to_json_value(plan.outline),
        "research_notes": plan.research_notes,
        "status": plan.status,
        "created_at": to_json_value(plan.created_at),
        "updated_at": to_json_value(plan.updated_at),
    }


@plans_bp.post("")
def create_plan():
    """
    Create plan
    ---
    tags:
      - Plans
    parameters:
      - in: body
        name: body
        required: true
        schema:
          $ref: '#/definitions/PlanCreateRequest'
    responses:
      201:
        description: Plan created.
        schema:
          $ref: '#/definitions/Plan'
      400:
        description: Validation error or mismatched session/user.
        schema:
          $ref: '#/definitions/ErrorResponse'
      404:
        description: User or session not found.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    payload = request.get_json(silent=True)
    if payload is None:
        return error_response("Request body must be valid JSON.", 400)

    try:
        body = PlanCreateRequest.model_validate(payload)
    except ValidationError as exc:
        return validation_error_response(exc)

    db = SessionLocal()
    try:
        user = db.get(User, body.user_id)
        if user is None:
            return error_response("User not found.", 404)

        conversation = db.get(Conversation, body.conversation_id)
        if conversation is None:
            return error_response("Session not found.", 404)
        if conversation.user_id != body.user_id:
            return error_response("Session does not belong to the provided user.", 400)

        plan = ContentPlan(
            conversation_id=body.conversation_id,
            user_id=body.user_id,
            title=body.title,
            description=body.description,
            target_keywords=body.target_keywords,
            outline=body.outline,
            research_notes=body.research_notes,
            status=body.status,
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
        return jsonify(serialize_plan(plan)), 201
    finally:
        db.close()


@plans_bp.get("")
def list_plans():
    """
    List plans
    ---
    tags:
      - Plans
    parameters:
      - in: query
        name: conversation_id
        required: false
        type: string
        format: uuid
        description: Optional filter by session/conversation.
      - in: query
        name: user_id
        required: false
        type: string
        format: uuid
        description: Optional filter by user.
    responses:
      200:
        description: Plans list.
        schema:
          type: object
          properties:
            items:
              type: array
              items:
                $ref: '#/definitions/Plan'
            count:
              type: integer
      400:
        description: Invalid query parameter.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    conversation_id = request.args.get("conversation_id")
    user_id = request.args.get("user_id")

    db = SessionLocal()
    try:
        query = select(ContentPlan).order_by(ContentPlan.updated_at.desc(), ContentPlan.created_at.desc())

        if conversation_id:
            try:
                conversation_uuid = UUID(conversation_id)
            except ValueError:
                return error_response("Invalid conversation_id query parameter.", 400)
            query = query.where(ContentPlan.conversation_id == conversation_uuid)

        if user_id:
            try:
                user_uuid = UUID(user_id)
            except ValueError:
                return error_response("Invalid user_id query parameter.", 400)
            query = query.where(ContentPlan.user_id == user_uuid)

        plans = db.execute(query).scalars().all()
        return jsonify({"items": [serialize_plan(plan) for plan in plans], "count": len(plans)})
    finally:
        db.close()


@plans_bp.get("/<uuid:plan_id>")
def get_plan(plan_id):
    """
    Get plan
    ---
    tags:
      - Plans
    parameters:
      - in: path
        name: plan_id
        required: true
        type: string
        format: uuid
    responses:
      200:
        description: Plan details.
        schema:
          $ref: '#/definitions/Plan'
      404:
        description: Plan not found.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    db = SessionLocal()
    try:
        plan = db.get(ContentPlan, plan_id)
        if plan is None:
            return error_response("Plan not found.", 404)
        return jsonify(serialize_plan(plan))
    finally:
        db.close()


@plans_bp.patch("/<uuid:plan_id>")
def update_plan(plan_id):
    """
    Update plan
    ---
    tags:
      - Plans
    parameters:
      - in: path
        name: plan_id
        required: true
        type: string
        format: uuid
      - in: body
        name: body
        required: true
        schema:
          $ref: '#/definitions/PlanUpdateRequest'
    responses:
      200:
        description: Updated plan.
        schema:
          $ref: '#/definitions/Plan'
      400:
        description: Validation error.
        schema:
          $ref: '#/definitions/ErrorResponse'
      404:
        description: Plan not found.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    payload = request.get_json(silent=True)
    if payload is None:
        return error_response("Request body must be valid JSON.", 400)

    try:
        body = PlanUpdateRequest.model_validate(payload)
    except ValidationError as exc:
        return validation_error_response(exc)

    changes = body.model_dump(exclude_unset=True)

    db = SessionLocal()
    try:
        plan = db.get(ContentPlan, plan_id)
        if plan is None:
            return error_response("Plan not found.", 404)

        for field_name, field_value in changes.items():
            setattr(plan, field_name, field_value)

        db.commit()
        db.refresh(plan)
        return jsonify(serialize_plan(plan))
    finally:
        db.close()


@plans_bp.delete("/<uuid:plan_id>")
def delete_plan(plan_id):
    """
    Delete plan
    ---
    tags:
      - Plans
    parameters:
      - in: path
        name: plan_id
        required: true
        type: string
        format: uuid
    responses:
      200:
        description: Plan deleted.
        schema:
          type: object
          properties:
            status:
              type: string
              example: deleted
            id:
              type: string
              format: uuid
      404:
        description: Plan not found.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    db = SessionLocal()
    try:
        plan = db.get(ContentPlan, plan_id)
        if plan is None:
            return error_response("Plan not found.", 404)
        db.delete(plan)
        db.commit()
        return jsonify({"status": "deleted", "id": str(plan_id)})
    finally:
        db.close()
