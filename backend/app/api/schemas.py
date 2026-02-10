from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SessionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: UUID
    title: str | None = Field(default=None, max_length=500)
    status: str = Field(default="active", max_length=50)


class PlanCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: UUID
    user_id: UUID
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    target_keywords: list[str] | None = None
    outline: dict[str, Any]
    research_notes: str | None = None
    status: str = Field(default="draft", max_length=50)


class PlanUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None
    target_keywords: list[str] | None = None
    outline: dict[str, Any] | None = None
    research_notes: str | None = None
    status: str | None = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def validate_non_empty_update(self) -> "PlanUpdateRequest":
        payload = self.model_dump()
        if all(value is None for value in payload.values()):
            raise ValueError("At least one field is required for update.")
        return self


class MessageCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: UUID
    role: str = Field(min_length=1, max_length=50)
    content: str = Field(min_length=1)
    tool_calls: dict[str, Any] | None = None
    tool_results: dict[str, Any] | None = None
    context_used: dict[str, Any] | None = None


class AgentChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: UUID
    content: str = Field(min_length=1)
