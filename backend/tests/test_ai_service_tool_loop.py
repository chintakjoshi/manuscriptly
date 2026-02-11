from __future__ import annotations

import unittest
from types import SimpleNamespace
from uuid import uuid4

import httpx
from anthropic import APIConnectionError
from pydantic import BaseModel

from app.agent_tools import ToolDefinition, ToolExecutionRouter, ToolRegistry
from app.core.config import Config
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
    def __init__(self, responses: list[FakeResponse | Exception]) -> None:
        self._responses = list(responses)
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if not self._responses:
            raise RuntimeError("No fake response configured.")
        next_item = self._responses.pop(0)
        if isinstance(next_item, Exception):
            raise next_item
        return next_item


class FakeClient:
    def __init__(self, responses: list[FakeResponse | Exception]) -> None:
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


class ConversationBoundToolInput(BaseModel):
    conversation_id: str
    topic: str


class CreateIdeaToolInput(BaseModel):
    conversation_id: str
    user_request: str


class AIToolLoopTests(unittest.TestCase):
    def _make_service(self, responses: list[FakeResponse | Exception], registry: ToolRegistry) -> AIService:
        conversation = SimpleNamespace(id=uuid4(), user_id=uuid4())
        service = AIService(FakeDB(conversation))
        service._client = FakeClient(responses)
        service.tool_registry = registry
        service.tool_router = ToolExecutionRouter(registry=registry)
        service._build_anthropic_history = lambda conversation_id: [{"role": "user", "content": "Help me"}]
        service._build_user_context = lambda user_id: {"user_name": "Tester"}
        service._build_agent_memory = lambda conversation_id, user_id, user_context: {
            "known_profile_fields": [],
            "inferred_facts": [],
            "current_session_intents": [],
            "cross_session_intents": [],
            "recent_plan_memory": [],
        }
        return service

    def test_build_system_prompt_contains_memory_guardrails(self) -> None:
        prompt = AIService._build_system_prompt(
            {
                "user_name": "Avery",
                "company_name": "Acme Labs",
                "industry": "SaaS",
                "target_audience": "Founders",
                "brand_voice": "Practical",
                "content_preferences": None,
                "additional_context": "Launching a new product.",
            },
            {
                "known_profile_fields": [
                    {"field": "company_name", "label": "Company Name", "value": "Acme Labs"},
                ],
                "inferred_facts": [
                    {"fact": "topic_focus", "label": "Topic Focus", "value": "PLG onboarding"},
                ],
                "current_session_intents": ["Need a launch post outline"],
                "cross_session_intents": ["Prior request about onboarding strategy"],
                "recent_plan_memory": [{"title": "PLG onboarding checklist", "keywords": ["PLG", "onboarding"]}],
            },
        )

        self.assertIn("Agent Memory Snapshot", prompt)
        self.assertIn("Memory Guardrails", prompt)
        self.assertIn("Do not ask again for details that are already known", prompt)
        self.assertIn("Acme Labs", prompt)
        self.assertIn("Need a launch post outline", prompt)

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

    def test_generate_reply_injects_conversation_id_for_tool_payload(self) -> None:
        registry = ToolRegistry()
        registry.register(
            ToolDefinition(
                name="conversation_bound_tool",
                description="Needs conversation id",
                input_model=ConversationBoundToolInput,
                handler=lambda payload: {
                    "conversation_id": payload.conversation_id,
                    "topic": payload.topic,
                },
            )
        )
        wrong_conversation_id = str(uuid4())
        responses = [
            FakeResponse(
                [
                    FakeBlock(
                        "tool_use",
                        id="toolu_1",
                        name="conversation_bound_tool",
                        input={"conversation_id": wrong_conversation_id, "topic": "future of ai"},
                    ),
                ]
            ),
            FakeResponse([FakeBlock("text", text="Done")]),
        ]
        service = self._make_service(responses, registry)
        run_conversation_id = uuid4()
        _, _, tool_calls, tool_results = service.generate_assistant_reply(run_conversation_id)

        self.assertEqual(tool_calls["items"][0]["input"]["conversation_id"], str(run_conversation_id))
        self.assertEqual(tool_results["items"][0]["result"]["conversation_id"], str(run_conversation_id))

    def test_generate_reply_normalizes_create_content_idea_user_request(self) -> None:
        registry = ToolRegistry()
        registry.register(
            ToolDefinition(
                name="create_content_idea",
                description="Create content idea",
                input_model=CreateIdeaToolInput,
                handler=lambda payload: {"user_request": payload.user_request},
            )
        )
        responses = [
            FakeResponse(
                [
                    FakeBlock(
                        "tool_use",
                        id="toolu_1",
                        name="create_content_idea",
                        input={"topic": "future of AI"},
                    ),
                ]
            ),
            FakeResponse([FakeBlock("text", text="Done")]),
        ]
        service = self._make_service(responses, registry)
        _, _, tool_calls, tool_results = service.generate_assistant_reply(uuid4())

        self.assertIn("user_request", tool_calls["items"][0]["input"])
        self.assertIn("future of AI", tool_calls["items"][0]["input"]["user_request"])
        self.assertIn("future of AI", tool_results["items"][0]["result"]["user_request"])

    def test_generate_reply_retries_transient_provider_error(self) -> None:
        registry = ToolRegistry()
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        responses: list[FakeResponse | Exception] = [
            APIConnectionError(message="Connection dropped.", request=request),
            FakeResponse([FakeBlock("text", text="Recovered after retry.")]),
        ]
        service = self._make_service(responses, registry)
        events: list[str] = []

        original_attempts = Config.ANTHROPIC_RETRY_MAX_ATTEMPTS
        original_base_delay = Config.ANTHROPIC_RETRY_BASE_DELAY_SECONDS
        original_max_delay = Config.ANTHROPIC_RETRY_MAX_DELAY_SECONDS
        Config.ANTHROPIC_RETRY_MAX_ATTEMPTS = 2
        Config.ANTHROPIC_RETRY_BASE_DELAY_SECONDS = 0.0
        Config.ANTHROPIC_RETRY_MAX_DELAY_SECONDS = 0.0
        try:
            text, _, _, _ = service.generate_assistant_reply(
                uuid4(),
                event_callback=lambda event_name, payload: events.append(event_name),
            )
        finally:
            Config.ANTHROPIC_RETRY_MAX_ATTEMPTS = original_attempts
            Config.ANTHROPIC_RETRY_BASE_DELAY_SECONDS = original_base_delay
            Config.ANTHROPIC_RETRY_MAX_DELAY_SECONDS = original_max_delay

        self.assertEqual(text, "Recovered after retry.")
        self.assertEqual(len(service._client.messages.calls), 2)
        self.assertIn("agent.response.retrying", events)


if __name__ == "__main__":
    unittest.main()
