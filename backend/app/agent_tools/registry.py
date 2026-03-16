from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from pydantic import BaseModel

ToolHandler = Callable[[BaseModel], dict[str, Any]]


class ToolRegistryError(Exception):
    pass


class DuplicateToolError(ToolRegistryError):
    pass


class ToolNotRegisteredError(ToolRegistryError):
    pass


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    input_model: type[BaseModel]
    handler: ToolHandler

    def to_anthropic_tool(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_model.model_json_schema(),
        }

    def to_openai_tool(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_model.model_json_schema(),
            },
        }


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}

    def register(self, definition: ToolDefinition) -> None:
        if definition.name in self._tools:
            raise DuplicateToolError(f"Tool '{definition.name}' is already registered.")
        self._tools[definition.name] = definition

    def get(self, tool_name: str) -> ToolDefinition:
        definition = self._tools.get(tool_name)
        if definition is None:
            raise ToolNotRegisteredError(f"Tool '{tool_name}' is not registered.")
        return definition

    def list(self) -> list[ToolDefinition]:
        return list(self._tools.values())

    def list_anthropic_tools(self) -> list[dict[str, Any]]:
        return [tool.to_anthropic_tool() for tool in self._tools.values()]

    def list_openai_tools(self) -> list[dict[str, Any]]:
        return [tool.to_openai_tool() for tool in self._tools.values()]
