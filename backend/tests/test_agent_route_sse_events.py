from __future__ import annotations

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from flask import Flask

from app.api.routes.agent import agent_bp
from app.services.ai_service import AICompletionError


class _FakeDbSession:
    def rollback(self) -> None:
        return

    def close(self) -> None:
        return


class _FakeMessageService:
    def __init__(self, db) -> None:  # noqa: ANN001
        self.db = db

    def create_message(self, payload):  # noqa: ANN001
        return SimpleNamespace(
            id=uuid4(),
            conversation_id=payload.conversation_id,
            role=payload.role,
            content=payload.content,
            tool_calls=getattr(payload, "tool_calls", None),
            tool_results=getattr(payload, "tool_results", None),
            context_used=getattr(payload, "context_used", None),
            created_at=datetime.now(timezone.utc),
        )


class _FakeAIServiceSuccess:
    def __init__(self, db) -> None:  # noqa: ANN001
        self.db = db

    def generate_assistant_reply(self, conversation_id, event_callback=None, preferred_plan_id=None):  # noqa: ANN001
        _ = preferred_plan_id
        if event_callback:
            event_callback(
                "agent.tools.detected",
                {"conversation_id": str(conversation_id), "iteration": 1, "count": 1},
            )
            event_callback(
                "agent.tool.started",
                {
                    "conversation_id": str(conversation_id),
                    "tool_use_id": "toolu_1",
                    "tool_name": "create_content_idea",
                    "iteration": 1,
                },
            )
            event_callback(
                "agent.tool.completed",
                {
                    "conversation_id": str(conversation_id),
                    "tool_use_id": "toolu_1",
                    "tool_name": "create_content_idea",
                    "iteration": 1,
                },
            )
        return (
            "Assistant response",
            {"provider": "anthropic", "model": "test"},
            {"count": 1, "items": [{"id": "toolu_1", "name": "create_content_idea"}]},
            {"count": 1, "items": [{"tool_use_id": "toolu_1", "name": "create_content_idea", "status": "completed"}]},
        )


class _FakeAIServiceFailure:
    def __init__(self, db) -> None:  # noqa: ANN001
        self.db = db

    def generate_assistant_reply(self, conversation_id, event_callback=None, preferred_plan_id=None):  # noqa: ANN001
        _ = conversation_id, event_callback, preferred_plan_id
        raise AICompletionError("Provider timeout")


class AgentRouteSSEEventTests(unittest.TestCase):
    def setUp(self) -> None:
        app = Flask(__name__)
        app.register_blueprint(agent_bp)
        self.client = app.test_client()

    @patch("app.api.routes.agent.SessionLocal")
    @patch("app.api.routes.agent.MessageService", _FakeMessageService)
    @patch("app.api.routes.agent.AIService", _FakeAIServiceSuccess)
    def test_chat_route_emits_consistent_sse_events_on_success(self, session_local_mock) -> None:
        session_local_mock.return_value = _FakeDbSession()
        published_events: list[str] = []

        def publish_spy(event_name, payload, session_id=None):  # noqa: ANN001
            published_events.append(event_name)
            return 1

        with patch("app.api.routes.agent.sse_manager.publish", side_effect=publish_spy):
            conversation_id = str(uuid4())
            response = self.client.post(
                "/api/v1/agent/chat",
                json={"conversation_id": conversation_id, "content": "Help me draft a content plan."},
            )

        self.assertEqual(response.status_code, 201)
        body = response.get_json()
        self.assertEqual(body["user_message"]["role"], "user")
        self.assertEqual(body["assistant_message"]["role"], "assistant")
        self.assertEqual(
            published_events,
            [
                "message.created",
                "agent.response.started",
                "agent.tools.detected",
                "agent.tool.started",
                "agent.tool.completed",
                "message.created",
                "agent.response.completed",
            ],
        )

    @patch("app.api.routes.agent.SessionLocal")
    @patch("app.api.routes.agent.MessageService", _FakeMessageService)
    @patch("app.api.routes.agent.AIService", _FakeAIServiceFailure)
    def test_chat_route_emits_failed_event_and_returns_502_on_ai_error(self, session_local_mock) -> None:
        session_local_mock.return_value = _FakeDbSession()
        published_events: list[str] = []

        def publish_spy(event_name, payload, session_id=None):  # noqa: ANN001
            published_events.append(event_name)
            return 1

        with patch("app.api.routes.agent.sse_manager.publish", side_effect=publish_spy):
            response = self.client.post(
                "/api/v1/agent/chat",
                json={"conversation_id": str(uuid4()), "content": "Generate a plan."},
            )

        self.assertEqual(response.status_code, 502)
        body = response.get_json()
        self.assertIn("Provider timeout", body["error"])
        self.assertEqual(
            published_events,
            [
                "message.created",
                "agent.response.started",
                "agent.response.failed",
            ],
        )


if __name__ == "__main__":
    unittest.main()
