from __future__ import annotations

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID, uuid4

from flask import Flask

from app.agent_tools import ToolExecutionRouter
from app.api.routes.content import content_bp
from app.api.routes.plans import plans_bp
from app.api.routes.sessions import sessions_bp
from app.api.routes.users import users_bp
from app.models import ContentItem, ContentPlan, Conversation, Message, User, UserProfile

from tests.fakes import InMemoryDbSession


class _FakeScalarResult:
    def __init__(self, values: list[object]) -> None:
        self._values = values

    def all(self) -> list[object]:
        return list(self._values)

    def one_or_none(self) -> object | None:
        return self._values[0] if self._values else None

    def scalar_one_or_none(self) -> object | None:
        return self.one_or_none()


class _FakeExecuteResult:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def all(self) -> list[object]:
        return list(self._rows)

    def first(self) -> object | None:
        return self._rows[0] if self._rows else None

    def scalars(self) -> _FakeScalarResult:
        values: list[object] = []
        for row in self._rows:
            if isinstance(row, tuple):
                values.append(row[0])
            else:
                values.append(row)
        return _FakeScalarResult(values)

    def scalar_one_or_none(self) -> object | None:
        row = self.first()
        if row is None:
            return None
        if isinstance(row, tuple):
            return row[0]
        return row


class _Phase10Step29Db(InMemoryDbSession):
    def __init__(self) -> None:
        super().__init__()
        self.user_profiles_by_user_id: dict[UUID, UserProfile] = {}
        self.messages: dict[UUID, Message] = {}

    def add(self, obj):  # noqa: ANN001
        now = datetime.now(timezone.utc)
        if isinstance(obj, User):
            if getattr(obj, "id", None) is None:
                obj.id = uuid4()
            if getattr(obj, "created_at", None) is None:
                obj.created_at = now
            obj.updated_at = now
            self.users[obj.id] = obj
            return

        if isinstance(obj, UserProfile):
            if getattr(obj, "id", None) is None:
                obj.id = uuid4()
            if getattr(obj, "created_at", None) is None:
                obj.created_at = now
            obj.updated_at = now
            self.user_profiles[obj.id] = obj
            self.user_profiles_by_user_id[obj.user_id] = obj
            return

        if isinstance(obj, Message):
            if getattr(obj, "id", None) is None:
                obj.id = uuid4()
            if getattr(obj, "created_at", None) is None:
                obj.created_at = now
            self.messages[obj.id] = obj
            return

        super().add(obj)

    def get(self, model, key):  # noqa: ANN001
        if model is User:
            return self.users.get(key)
        if model is UserProfile:
            if key in self.user_profiles:
                return self.user_profiles.get(key)
            return self.user_profiles_by_user_id.get(key)
        if model is Message:
            return self.messages.get(key)
        return super().get(model, key)

    def execute(self, statement):  # noqa: ANN001
        column_descriptions = getattr(statement, "column_descriptions", [])
        entities = [description.get("entity") for description in column_descriptions]

        if UserProfile in entities:
            return _FakeExecuteResult(list(self.user_profiles_by_user_id.values()))
        if Conversation in entities:
            return _FakeExecuteResult(list(self.conversations.values()))
        if ContentPlan in entities and ContentItem in entities:
            rows: list[tuple[ContentItem, UUID | None]] = []
            for content_item in self.content_items.values():
                plan = self.plans.get(content_item.content_plan_id)
                rows.append((content_item, plan.conversation_id if plan else None))
            return _FakeExecuteResult(rows)
        if ContentPlan in entities:
            return _FakeExecuteResult(list(self.plans.values()))
        if Message in entities:
            return _FakeExecuteResult(list(self.messages.values()))

        return _FakeExecuteResult([])


class Phase10Step29EndToEndTests(unittest.TestCase):
    def setUp(self) -> None:
        app = Flask(__name__)
        app.register_blueprint(users_bp)
        app.register_blueprint(sessions_bp)
        app.register_blueprint(plans_bp)
        app.register_blueprint(content_bp)
        self.client = app.test_client()

    @patch("app.agent_tools.handlers._generate_blog_fields")
    @patch("app.agent_tools.handlers._generate_plan_fields")
    @patch("app.agent_tools.handlers.SessionLocal")
    @patch("app.api.routes.content.SessionLocal")
    @patch("app.api.routes.plans.SessionLocal")
    @patch("app.api.routes.sessions.SessionLocal")
    @patch("app.api.routes.users.SessionLocal")
    def test_end_to_end_journey_onboarding_to_content_generation_and_manual_edit(
        self,
        users_session_local_mock,
        sessions_session_local_mock,
        plans_session_local_mock,
        content_session_local_mock,
        handlers_session_local_mock,
        generate_plan_fields_mock,
        generate_blog_fields_mock,
    ) -> None:
        db = _Phase10Step29Db()
        users_session_local_mock.return_value = db
        sessions_session_local_mock.return_value = db
        plans_session_local_mock.return_value = db
        content_session_local_mock.return_value = db
        handlers_session_local_mock.return_value = db

        generate_plan_fields_mock.return_value = {
            "title": "Practical AI Blogging Workflow",
            "description": "A complete workflow from idea to publish-ready draft.",
            "target_keywords": ["ai blogging", "content workflow"],
            "outline": {
                "sections": [
                    {"heading": "Research", "key_points": ["Collect sources", "Validate claims"]},
                    {"heading": "Draft", "key_points": ["Write clearly", "Edit for flow"]},
                ]
            },
            "research_notes": "Use credible sources and concrete examples.",
            "status": "draft",
        }
        generate_blog_fields_mock.return_value = {
            "title": "Practical AI Blogging Workflow",
            "content": "# Practical AI Blogging Workflow\n\nUse AI to improve speed and quality.",
            "meta_description": "How to build an AI-assisted writing workflow.",
            "tags": ["ai blogging", "workflow"],
        }

        onboarding_response = self.client.post(
            "/api/v1/users/onboarding",
            json={
                "user_name": "Step29 Tester",
                "company_name": "Manuscriptly Labs",
                "industry": "Media",
                "target_audience": "Writers and marketers",
                "brand_voice": "Clear and practical",
                "additional_context": "Prioritize trustworthy guidance.",
            },
        )
        self.assertEqual(onboarding_response.status_code, 201)
        user_payload = onboarding_response.get_json()
        user_id = user_payload["id"]
        self.assertEqual(len(db.users), 1)
        self.assertEqual(len(db.user_profiles_by_user_id), 1)

        create_session_response = self.client.post(
            "/api/v1/sessions",
            json={"user_id": user_id, "title": "Phase 10 Step 29 Session"},
        )
        self.assertEqual(create_session_response.status_code, 201)
        session_payload = create_session_response.get_json()
        conversation_id = session_payload["id"]
        self.assertEqual(len(db.conversations), 1)

        router = ToolExecutionRouter()
        create_plan_result = router.execute(
            "create_content_idea",
            {
                "conversation_id": conversation_id,
                "user_request": "Create a practical blog workflow for AI-assisted writing.",
            },
        )
        plan_id = create_plan_result["result"]["plan"]["id"]
        self.assertEqual(create_plan_result["result"]["status"], "success")
        self.assertEqual(len(db.plans), 1)

        update_plan_result = router.execute(
            "update_content_plan",
            {
                "conversation_id": conversation_id,
                "plan_id": plan_id,
                "status": "approved",
            },
        )
        self.assertEqual(update_plan_result["result"]["status"], "success")
        self.assertIn("status", update_plan_result["result"]["updated_fields"])

        execute_result = router.execute(
            "execute_plan",
            {
                "conversation_id": conversation_id,
                "plan_id": plan_id,
                "output_format": "markdown",
                "writing_instructions": "Keep it practical and concise.",
            },
        )
        self.assertEqual(execute_result["result"]["status"], "success")
        self.assertEqual(execute_result["result"]["plan"]["status"], "executed")
        self.assertEqual(len(db.content_items), 1)
        self.assertEqual(len(db.content_versions), 1)
        self.assertEqual(len(db.tool_executions), 3)
        self.assertTrue(all(execution.execution_status == "completed" for execution in db.tool_executions))

        content_item_id = execute_result["result"]["content_item"]["id"]
        manual_edit_response = self.client.patch(
            f"/api/v1/content/{content_item_id}",
            json={
                "content": "# Practical AI Blogging Workflow\n\nUpdated draft with stronger examples.",
                "change_description": "Manual polish after generation.",
            },
        )
        self.assertEqual(manual_edit_response.status_code, 200)
        edited_payload = manual_edit_response.get_json()
        self.assertEqual(edited_payload["version"], 2)
        self.assertIn("Updated draft", edited_payload["markdown_content"])
        self.assertEqual(len(db.content_versions), 2)
        self.assertEqual(db.content_versions[-1].changed_by, "user")

        persisted_plan = db.get(ContentPlan, UUID(plan_id))
        self.assertIsNotNone(persisted_plan)
        self.assertEqual(persisted_plan.status, "executed")
        self.assertGreaterEqual(db.commits, 5)


if __name__ == "__main__":
    unittest.main()
