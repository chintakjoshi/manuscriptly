from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SessionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: UUID
    title: str | None = Field(default=None, max_length=500)
    status: str = Field(default="active", max_length=50)


class UserOnboardingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: UUID | None = None
    user_name: str = Field(min_length=1, max_length=100)
    company_name: str | None = Field(default=None, max_length=255)
    industry: str | None = Field(default=None, max_length=255)
    target_audience: str | None = None
    brand_voice: str | None = None
    content_preferences: dict[str, Any] | None = None
    additional_context: str | None = None

    @model_validator(mode="after")
    def normalize_optional_text_fields(self) -> "UserOnboardingRequest":
        self.user_name = self.user_name.strip()
        if not self.user_name:
            raise ValueError("user_name is required.")

        optional_text_fields = ("company_name", "industry", "target_audience", "brand_voice", "additional_context")
        for field_name in optional_text_fields:
            raw_value = getattr(self, field_name)
            if isinstance(raw_value, str):
                normalized = raw_value.strip()
                setattr(self, field_name, normalized or None)
        return self


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


class StartSessionFromPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=500)
    status: str = Field(default="active", max_length=50)


class ContentUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=500)
    content: str | None = Field(default=None, min_length=1)
    meta_description: str | None = Field(default=None, max_length=500)
    tags: list[str] | None = None
    status: str | None = Field(default=None, max_length=50)
    change_description: str | None = None

    @model_validator(mode="after")
    def validate_non_empty_update(self) -> "ContentUpdateRequest":
        payload = self.model_dump()
        payload.pop("change_description", None)
        if all(value is None for value in payload.values()):
            raise ValueError("At least one content field is required for update.")
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
    preferred_plan_id: UUID | None = None
