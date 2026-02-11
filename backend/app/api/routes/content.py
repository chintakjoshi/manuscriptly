from __future__ import annotations

import re
from uuid import UUID

from flask import Blueprint, jsonify, request
from pydantic import ValidationError
from sqlalchemy import select

from app.api.schemas import ContentUpdateRequest
from app.api.utils import error_response, to_json_value, validation_error_response
from app.db.session import SessionLocal
from app.models import ContentItem, ContentPlan, ContentVersion

content_bp = Blueprint("content", __name__, url_prefix="/api/v1/content")


def _count_words(text: str) -> int:
    return len(re.findall(r"\b\w+\b", text or ""))


def serialize_content_item(content_item: ContentItem, conversation_id: UUID | None = None) -> dict:
    resolved_conversation_id = conversation_id
    if resolved_conversation_id is None and getattr(content_item, "content_plan", None) is not None:
        resolved_conversation_id = content_item.content_plan.conversation_id

    return {
        "id": to_json_value(content_item.id),
        "content_plan_id": to_json_value(content_item.content_plan_id),
        "conversation_id": to_json_value(resolved_conversation_id),
        "user_id": to_json_value(content_item.user_id),
        "title": content_item.title,
        "content": content_item.content,
        "html_content": content_item.html_content,
        "markdown_content": content_item.markdown_content,
        "meta_description": content_item.meta_description,
        "tags": content_item.tags,
        "word_count": content_item.word_count,
        "status": content_item.status,
        "version": content_item.version,
        "created_at": to_json_value(content_item.created_at),
        "updated_at": to_json_value(content_item.updated_at),
    }


@content_bp.get("")
def list_content_items():
    """
    List content items
    ---
    tags:
      - Content
    parameters:
      - in: query
        name: conversation_id
        required: false
        type: string
        format: uuid
      - in: query
        name: content_plan_id
        required: false
        type: string
        format: uuid
      - in: query
        name: user_id
        required: false
        type: string
        format: uuid
    responses:
      200:
        description: Content list.
        schema:
          $ref: '#/definitions/ContentListResponse'
      400:
        description: Invalid query parameter.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    conversation_id = request.args.get("conversation_id")
    content_plan_id = request.args.get("content_plan_id")
    user_id = request.args.get("user_id")

    db = SessionLocal()
    try:
        query = (
            select(ContentItem, ContentPlan.conversation_id)
            .join(ContentPlan, ContentPlan.id == ContentItem.content_plan_id)
            .order_by(ContentItem.updated_at.desc(), ContentItem.created_at.desc())
        )

        if conversation_id:
            try:
                conversation_uuid = UUID(conversation_id)
            except ValueError:
                return error_response("Invalid conversation_id query parameter.", 400)
            query = query.where(ContentPlan.conversation_id == conversation_uuid)

        if content_plan_id:
            try:
                plan_uuid = UUID(content_plan_id)
            except ValueError:
                return error_response("Invalid content_plan_id query parameter.", 400)
            query = query.where(ContentItem.content_plan_id == plan_uuid)

        if user_id:
            try:
                user_uuid = UUID(user_id)
            except ValueError:
                return error_response("Invalid user_id query parameter.", 400)
            query = query.where(ContentItem.user_id == user_uuid)

        rows = db.execute(query).all()
        items = [serialize_content_item(content_item, conversation_id=row_conversation_id) for content_item, row_conversation_id in rows]
        return jsonify({"items": items, "count": len(items)})
    finally:
        db.close()


@content_bp.get("/<uuid:content_item_id>")
def get_content_item(content_item_id):
    """
    Get content item
    ---
    tags:
      - Content
    parameters:
      - in: path
        name: content_item_id
        required: true
        type: string
        format: uuid
    responses:
      200:
        description: Content item details.
        schema:
          $ref: '#/definitions/ContentItem'
      404:
        description: Content item not found.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    db = SessionLocal()
    try:
        row = (
            db.execute(
                select(ContentItem, ContentPlan.conversation_id)
                .join(ContentPlan, ContentPlan.id == ContentItem.content_plan_id)
                .where(ContentItem.id == content_item_id)
            )
            .first()
        )
        if row is None:
            return error_response("Content item not found.", 404)
        content_item, conversation_id = row
        return jsonify(serialize_content_item(content_item, conversation_id=conversation_id))
    finally:
        db.close()


@content_bp.patch("/<uuid:content_item_id>")
def update_content_item(content_item_id):
    """
    Update content item
    ---
    tags:
      - Content
    parameters:
      - in: path
        name: content_item_id
        required: true
        type: string
        format: uuid
      - in: body
        name: body
        required: true
        schema:
          $ref: '#/definitions/ContentUpdateRequest'
    responses:
      200:
        description: Updated content item.
        schema:
          $ref: '#/definitions/ContentItem'
      400:
        description: Validation error.
        schema:
          $ref: '#/definitions/ErrorResponse'
      404:
        description: Content item not found.
        schema:
          $ref: '#/definitions/ErrorResponse'
    """
    payload = request.get_json(silent=True)
    if payload is None:
        return error_response("Request body must be valid JSON.", 400)

    try:
        body = ContentUpdateRequest.model_validate(payload)
    except ValidationError as exc:
        return validation_error_response(exc)

    changes = body.model_dump(exclude_unset=True)
    change_description = changes.pop("change_description", None)

    db = SessionLocal()
    try:
        content_item = db.get(ContentItem, content_item_id)
        if content_item is None:
            return error_response("Content item not found.", 404)

        version_needs_bump = False
        for field_name, field_value in changes.items():
            if field_name in {"title", "content"} and getattr(content_item, field_name) != field_value:
                version_needs_bump = True
            setattr(content_item, field_name, field_value)

        if "content" in changes:
            output_format = "markdown" if content_item.markdown_content is not None else "html" if content_item.html_content is not None else None
            if output_format == "markdown":
                content_item.markdown_content = content_item.content
                content_item.html_content = None
            elif output_format == "html":
                content_item.html_content = content_item.content
                content_item.markdown_content = None
            content_item.word_count = _count_words(content_item.content)

        if version_needs_bump:
            next_version = (content_item.version or 1) + 1
            content_item.version = next_version
            db.add(
                ContentVersion(
                    content_item_id=content_item.id,
                    version=next_version,
                    title=content_item.title,
                    content=content_item.content,
                    changed_by="user",
                    change_description=change_description or "Manual content edit.",
                )
            )

        db.commit()
        db.refresh(content_item)
        return jsonify(serialize_content_item(content_item))
    finally:
        db.close()
