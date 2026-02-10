from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CreateContentIdeaInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: UUID
    user_request: str = Field(min_length=1, max_length=8000)
    constraints: dict[str, Any] | None = None


class UpdateContentPlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: UUID
    plan_id: UUID
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None
    target_keywords: list[str] | None = None
    outline: dict[str, Any] | None = None
    research_notes: str | None = None
    status: str | None = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def validate_non_empty_update(self) -> "UpdateContentPlanInput":
        updates = (
            self.title,
            self.description,
            self.target_keywords,
            self.outline,
            self.research_notes,
            self.status,
        )
        if all(value is None for value in updates):
            raise ValueError("At least one plan field must be provided for update.")
        return self


class ExecutePlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: UUID
    plan_id: UUID
    writing_instructions: str | None = Field(default=None, min_length=1, max_length=4000)
    output_format: str = Field(default="markdown", min_length=1, max_length=50)
