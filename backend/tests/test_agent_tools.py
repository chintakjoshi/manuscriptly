from __future__ import annotations

import unittest
from uuid import uuid4

from pydantic import ValidationError
from pydantic import BaseModel

from app.agent_tools import (
    CreateContentIdeaInput,
    ToolDefinition,
    ToolExecutionError,
    ToolRegistry,
    ToolExecutionRouter,
    ToolInputValidationError,
    UpdateContentPlanInput,
    build_default_tool_registry,
)


class ToolSchemaValidationTests(unittest.TestCase):
    def test_create_content_idea_accepts_valid_payload(self) -> None:
        payload = CreateContentIdeaInput.model_validate(
            {
                "conversation_id": str(uuid4()),
                "user_request": "I want a data-driven post about AI in customer support.",
            }
        )
        self.assertTrue(str(payload.conversation_id))
        self.assertEqual(payload.user_request, "I want a data-driven post about AI in customer support.")

    def test_create_content_idea_rejects_empty_user_request(self) -> None:
        with self.assertRaises(ValidationError):
            CreateContentIdeaInput.model_validate(
                {
                    "conversation_id": str(uuid4()),
                    "user_request": "",
                }
            )

    def test_update_content_plan_requires_fields_to_update(self) -> None:
        with self.assertRaises(ValidationError):
            UpdateContentPlanInput.model_validate(
                {
                    "conversation_id": str(uuid4()),
                    "plan_id": str(uuid4()),
                }
            )


class ToolRegistryAndRouterTests(unittest.TestCase):
    def test_default_registry_includes_expected_tools(self) -> None:
        registry = build_default_tool_registry()
        names = [tool.name for tool in registry.list()]
        self.assertEqual(
            names,
            ["create_content_idea", "update_content_plan", "execute_plan"],
        )

    def test_router_rejects_invalid_tool_payload(self) -> None:
        router = ToolExecutionRouter()
        with self.assertRaises(ToolInputValidationError):
            router.execute(
                "update_content_plan",
                {
                    "conversation_id": str(uuid4()),
                    "plan_id": str(uuid4()),
                },
            )

    def test_router_dispatches_registered_handler(self) -> None:
        class EchoToolInput(BaseModel):
            value: int

        registry = ToolRegistry()
        registry.register(
            ToolDefinition(
                name="echo_tool",
                description="Echo value",
                input_model=EchoToolInput,
                handler=lambda payload: {"echo": payload.value},
            )
        )
        router = ToolExecutionRouter(registry=registry)
        response = router.execute(
            "echo_tool",
            {
                "value": 7,
            },
        )
        self.assertEqual(response["tool_name"], "echo_tool")
        self.assertEqual(response["result"]["echo"], 7)

    def test_router_rejects_unknown_tool(self) -> None:
        router = ToolExecutionRouter(registry=ToolRegistry())
        with self.assertRaises(ToolExecutionError):
            router.execute("missing_tool", {})


if __name__ == "__main__":
    unittest.main()
