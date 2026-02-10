from __future__ import annotations

from flasgger import Swagger

SWAGGER_TEMPLATE = {
    "swagger": "2.0",
    "info": {
        "title": "kaka-the-writer API",
        "description": "Backend API for sessions, plans, messages, and health checks.",
        "version": "1.0.0",
    },
    "basePath": "/",
    "schemes": ["http"],
    "consumes": ["application/json"],
    "produces": ["application/json"],
    "definitions": {
        "HealthResponse": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "example": "ok"},
            },
        },
        "ErrorResponse": {
            "type": "object",
            "properties": {
                "error": {"type": "string", "example": "Validation failed."},
            },
        },
        "Session": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "format": "uuid"},
                "user_id": {"type": "string", "format": "uuid"},
                "title": {"type": "string", "nullable": True},
                "status": {"type": "string"},
                "created_at": {"type": "string", "format": "date-time"},
                "updated_at": {"type": "string", "format": "date-time"},
            },
        },
        "SessionCreateRequest": {
            "type": "object",
            "required": ["user_id"],
            "properties": {
                "user_id": {"type": "string", "format": "uuid"},
                "title": {"type": "string"},
                "status": {"type": "string", "example": "active"},
            },
        },
        "SessionListResponse": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {"$ref": "#/definitions/Session"},
                },
                "count": {"type": "integer"},
            },
        },
        "Plan": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "format": "uuid"},
                "conversation_id": {"type": "string", "format": "uuid"},
                "user_id": {"type": "string", "format": "uuid"},
                "title": {"type": "string"},
                "description": {"type": "string"},
                "target_keywords": {"type": "array", "items": {"type": "string"}},
                "outline": {"type": "object"},
                "research_notes": {"type": "string"},
                "status": {"type": "string"},
                "created_at": {"type": "string", "format": "date-time"},
                "updated_at": {"type": "string", "format": "date-time"},
            },
        },
        "PlanCreateRequest": {
            "type": "object",
            "required": ["conversation_id", "user_id", "title", "outline"],
            "properties": {
                "conversation_id": {"type": "string", "format": "uuid"},
                "user_id": {"type": "string", "format": "uuid"},
                "title": {"type": "string"},
                "description": {"type": "string"},
                "target_keywords": {"type": "array", "items": {"type": "string"}},
                "outline": {"type": "object"},
                "research_notes": {"type": "string"},
                "status": {"type": "string", "example": "draft"},
            },
        },
        "PlanUpdateRequest": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string"},
                "target_keywords": {"type": "array", "items": {"type": "string"}},
                "outline": {"type": "object"},
                "research_notes": {"type": "string"},
                "status": {"type": "string"},
            },
        },
        "Message": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "format": "uuid"},
                "conversation_id": {"type": "string", "format": "uuid"},
                "role": {"type": "string"},
                "content": {"type": "string"},
                "tool_calls": {"type": "object"},
                "tool_results": {"type": "object"},
                "context_used": {"type": "object"},
                "created_at": {"type": "string", "format": "date-time"},
            },
        },
        "MessageCreateRequest": {
            "type": "object",
            "required": ["conversation_id", "role", "content"],
            "properties": {
                "conversation_id": {"type": "string", "format": "uuid"},
                "role": {"type": "string"},
                "content": {"type": "string"},
                "tool_calls": {"type": "object"},
                "tool_results": {"type": "object"},
                "context_used": {"type": "object"},
            },
        },
        "MessageListResponse": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {"$ref": "#/definitions/Message"},
                },
                "count": {"type": "integer"},
            },
        },
        "StreamTestRequest": {
            "type": "object",
            "properties": {
                "message": {"type": "string"},
                "session_id": {"type": "string", "format": "uuid"},
            },
        },
        "StreamTestResponse": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "example": "sent"},
                "deliveries": {"type": "integer", "example": 1},
            },
        },
    },
}


def init_swagger(app) -> None:
    app.config["SWAGGER"] = {
        "title": "kaka-the-writer API Docs",
        "uiversion": 3,
    }
    Swagger(app, template=SWAGGER_TEMPLATE)
