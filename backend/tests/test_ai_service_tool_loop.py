from __future__ import annotations

import unittest
from types import SimpleNamespace
from uuid import uuid4

from pydantic import BaseModel

from app.agent_tools import ToolDefinition, ToolExecutionRouter, ToolRegistry
from app.services.ai_service import AIService


class FakeBlock:
    def __init__(self, block_type: str, **kwargs) -> None:
        self.type = block_type
        for key, value in kwargs.items():
            setattr(self, key, value)


class FakeResponse:
    def __init__(self, content: list[FakeBlock]) -> None:
        self.content = content


class FakeMessagesAPI:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self._responses = list(responses)
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if not self._responses:
            raise RuntimeError("No fake response configured.")
        return self._responses.pop(0)


class FakeClient:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.messages = FakeMessagesAPI(responses)


class FakeDB:
    def __init__(self, conversation) -> None:
        self._conversation = conversation

    def get(self, model, key):
        if model.__name__ == "Conversation":
            return self._conversation
        return None


class DummyToolInput(BaseModel):
    topic: str


class AIStep12LoopTests(unittest.TestCase):
    def _make_service(self, responses: list[FakeResponse], registry: ToolRegistry) -> AIService:
        conversation = SimpleNamespace(id=uuid4(), user_id=uuid4())
        service = AIService(FakeDB(conversation))
        service._client = FakeClient(responses)
        service.tool_registry = registry
        service.tool_router = ToolExecutionRouter(registry=registry)
        service._build_anthropic_history = lambda conversation_id: [{"role": "user", "content": "Help me"}]
        service._build_user_context = lambda user_id: {"user_name": "Tester"}
        return service

    def test_generate_reply_executes_tool_and_returns_final_text(self) -> None:
        registry = ToolRegistry()
        registry.register(
            ToolDefinition(
                name="dummy_tool",
                description="Dummy tool for tests",
                input_model=DummyToolInput,
                handler=lambda payload: {"status": "ok", "topic": payload.topic},
            )
        )
        responses = [
            FakeResponse(
                [
                    FakeBlock("text", text="Calling a tool now."),
                    FakeBlock("tool_use", id="toolu_1", name="dummy_tool", input={"topic": "ai"}),
                ]
            ),
            FakeResponse([FakeBlock("text", text="Plan created successfully.")]),
        ]
        service = self._make_service(responses, registry)
        events: list[str] = []
        text, context, tool_calls, tool_results = service.generate_assistant_reply(
            uuid4(),
            event_callback=lambda event_name, payload: events.append(event_name),
        )

        self.assertEqual(text, "Plan created successfully.")
        self.assertEqual(context["tool_calls_count"], 1)
        self.assertEqual(context["tool_results_count"], 1)
        self.assertEqual(tool_calls["count"], 1)
        self.assertEqual(tool_calls["items"][0]["name"], "dummy_tool")
        self.assertEqual(tool_results["items"][0]["status"], "completed")
        self.assertIn("agent.tools.detected", events)
        self.assertIn("agent.tool.started", events)
        self.assertIn("agent.tool.completed", events)

    def test_generate_reply_handles_tool_failure_and_continues(self) -> None:
        registry = ToolRegistry()
        responses = [
            FakeResponse(
                [
                    FakeBlock("tool_use", id="toolu_1", name="unknown_tool", input={}),
                ]
            ),
            FakeResponse([FakeBlock("text", text="I could not run that tool, but here is guidance.")]),
        ]
        service = self._make_service(responses, registry)
        events: list[str] = []
        text, _, _, tool_results = service.generate_assistant_reply(
            uuid4(),
            event_callback=lambda event_name, payload: events.append(event_name),
        )

        self.assertEqual(text, "I could not run that tool, but here is guidance.")
        self.assertEqual(tool_results["items"][0]["status"], "failed")
        self.assertIn("agent.tool.failed", events)


if __name__ == "__main__":
    unittest.main()
