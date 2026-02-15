from __future__ import annotations

from flasgger import Swagger

SWAGGER_TEMPLATE = {
    "swagger": "2.0",
    "info": {
        "title": "manuscriptly-the-writer API",
        "description": "Backend API for users, sessions, plans, messages, stream, and agent chat.",
        "version": "1.0.0",
    },
    "basePath": "/",
    "schemes": ["http"],
    "consumes": ["application/json"],
    "produces": ["application/json"],
    "definitions": {
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
        "UserProfile": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "format": "uuid", "nullable": True},
                "user_id": {"type": "string", "format": "uuid"},
                "company_name": {"type": "string", "nullable": True},
                "industry": {"type": "string", "nullable": True},
                "target_audience": {"type": "string", "nullable": True},
                "brand_voice": {"type": "string", "nullable": True},
                "content_preferences": {"type": "object", "nullable": True},
                "additional_context": {"type": "string", "nullable": True},
                "created_at": {"type": "string", "format": "date-time", "nullable": True},
                "updated_at": {"type": "string", "format": "date-time", "nullable": True},
            },
        },
        "UserContext": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "format": "uuid"},
                "user_name": {"type": "string"},
                "email": {"type": "string"},
                "created_at": {"type": "string", "format": "date-time"},
                "updated_at": {"type": "string", "format": "date-time"},
                "profile": {"$ref": "#/definitions/UserProfile"},
            },
        },
        "UserOnboardingRequest": {
            "type": "object",
            "required": ["user_name"],
            "properties": {
                "user_id": {"type": "string", "format": "uuid"},
                "user_name": {"type": "string"},
                "company_name": {"type": "string"},
                "industry": {"type": "string"},
                "target_audience": {"type": "string"},
                "brand_voice": {"type": "string"},
                "content_preferences": {"type": "object"},
                "additional_context": {"type": "string"},
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
        "StartSessionFromPlanRequest": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "status": {"type": "string", "example": "active"},
            },
        },
        "StartSessionFromPlanResponse": {
            "type": "object",
            "properties": {
                "session": {"$ref": "#/definitions/Session"},
                "plan": {"$ref": "#/definitions/Plan"},
            },
        },
        "ContentItem": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "format": "uuid"},
                "content_plan_id": {"type": "string", "format": "uuid"},
                "conversation_id": {"type": "string", "format": "uuid"},
                "user_id": {"type": "string", "format": "uuid"},
                "title": {"type": "string"},
                "content": {"type": "string"},
                "html_content": {"type": "string"},
                "markdown_content": {"type": "string"},
                "meta_description": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "word_count": {"type": "integer"},
                "status": {"type": "string"},
                "version": {"type": "integer"},
                "created_at": {"type": "string", "format": "date-time"},
                "updated_at": {"type": "string", "format": "date-time"},
            },
        },
        "ContentListResponse": {
            "type": "object",
            "properties": {
                "items": {"type": "array", "items": {"$ref": "#/definitions/ContentItem"}},
                "count": {"type": "integer"},
            },
        },
        "ContentUpdateRequest": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "content": {"type": "string"},
                "meta_description": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "status": {"type": "string"},
                "change_description": {"type": "string"},
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
        "ConversationHistoryMessage": {
            "type": "object",
            "properties": {
                "role": {"type": "string", "example": "user"},
                "content": {"type": "string"},
                "tool_calls": {"type": "object"},
                "tool_results": {"type": "object"},
                "context_used": {"type": "object"},
            },
        },
        "ConversationHistoryResponse": {
            "type": "object",
            "properties": {
                "format": {"type": "string", "example": "model"},
                "items": {
                    "type": "array",
                    "items": {"$ref": "#/definitions/ConversationHistoryMessage"},
                },
                "count": {"type": "integer"},
            },
        },
        "ConversationTranscriptResponse": {
            "type": "object",
            "properties": {
                "format": {"type": "string", "example": "transcript"},
                "transcript": {"type": "string"},
            },
        },
        "AgentChatRequest": {
            "type": "object",
            "required": ["conversation_id", "content"],
            "properties": {
                "conversation_id": {"type": "string", "format": "uuid"},
                "content": {"type": "string"},
            },
        },
        "AgentChatResponse": {
            "type": "object",
            "properties": {
                "user_message": {"$ref": "#/definitions/Message"},
                "assistant_message": {"$ref": "#/definitions/Message"},
                "model": {"type": "string", "example": "claude-haiku-4-5-20251001"},
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
        "title": "manuscriptly-the-writer API Docs",
        "uiversion": 3,
    }
    Swagger(app, template=SWAGGER_TEMPLATE)
