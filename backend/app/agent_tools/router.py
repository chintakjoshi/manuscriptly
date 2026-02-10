from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from app.agent_tools.handlers import (
    handle_create_content_idea,
    handle_execute_plan,
    handle_update_content_plan,
    ToolHandlerError,
)
from app.agent_tools.registry import ToolDefinition, ToolNotRegisteredError, ToolRegistry
from app.agent_tools.schemas import CreateContentIdeaInput, ExecutePlanInput, UpdateContentPlanInput


class ToolExecutionError(Exception):
    pass


class ToolInputValidationError(ToolExecutionError):
    def __init__(self, tool_name: str, message: str, *, errors: list[dict[str, Any]] | None = None) -> None:
        super().__init__(f"Tool '{tool_name}' input validation failed: {message}")
        self.tool_name = tool_name
        self.errors = errors or []


def build_default_tool_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        ToolDefinition(
            name="create_content_idea",
            description="Generate a content plan from the user's request for a specific session.",
            input_model=CreateContentIdeaInput,
            handler=handle_create_content_idea,
        )
    )
    registry.register(
        ToolDefinition(
            name="update_content_plan",
            description="Update an existing content plan for an individual session.",
            input_model=UpdateContentPlanInput,
            handler=handle_update_content_plan,
        )
    )
    registry.register(
        ToolDefinition(
            name="execute_plan",
            description="Generate full blog content using an approved plan.",
            input_model=ExecutePlanInput,
            handler=handle_execute_plan,
        )
    )
    return registry


class ToolExecutionRouter:
    def __init__(self, registry: ToolRegistry | None = None) -> None:
        self.registry = registry or build_default_tool_registry()

    def execute(self, tool_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            definition = self.registry.get(tool_name)
        except ToolNotRegisteredError as exc:
            raise ToolExecutionError(str(exc)) from exc
        try:
            validated_payload = definition.input_model.model_validate(payload)
        except ValidationError as exc:
            raise ToolInputValidationError(
                tool_name,
                "Invalid payload.",
                errors=exc.errors(include_url=False),
            ) from exc

        try:
            result = definition.handler(validated_payload)
        except ToolHandlerError as exc:
            raise ToolExecutionError(str(exc)) from exc
        except Exception as exc:
            raise ToolExecutionError(f"Tool '{tool_name}' execution failed: {exc}") from exc

        return {
            "tool_name": tool_name,
            "input": validated_payload.model_dump(mode="json"),
            "result": result,
        }
