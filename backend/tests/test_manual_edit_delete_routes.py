from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

from flask import Flask

from app.api.routes.content import content_bp
from app.api.routes.plans import plans_bp
from app.models import ContentItem, ContentPlan

from tests.fakes import InMemoryDbSession


class ManualEditDeleteRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        app = Flask(__name__)
        app.register_blueprint(plans_bp)
        app.register_blueprint(content_bp)
        self.client = app.test_client()

    @patch("app.api.routes.plans.SessionLocal")
    def test_patch_plan_manual_edit_updates_fields(self, session_local_mock) -> None:
        db = InMemoryDbSession()
        plan = ContentPlan(
            id=uuid4(),
            conversation_id=uuid4(),
            user_id=uuid4(),
            title="Initial Title",
            description="Initial description",
            target_keywords=["initial"],
            outline={"sections": [{"heading": "Intro"}]},
            research_notes="Initial notes",
            status="draft",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(plan)
        session_local_mock.return_value = db

        response = self.client.patch(
            f"/api/v1/plans/{plan.id}",
            json={"title": "Edited Title", "status": "approved"},
        )
        self.assertEqual(response.status_code, 200)

        body = response.get_json()
        self.assertEqual(body["title"], "Edited Title")
        self.assertEqual(body["status"], "approved")
        self.assertEqual(db.get(ContentPlan, plan.id).title, "Edited Title")

    @patch("app.api.routes.plans.SessionLocal")
    def test_delete_plan_manual_delete_removes_plan(self, session_local_mock) -> None:
        db = InMemoryDbSession()
        plan = ContentPlan(
            id=uuid4(),
            conversation_id=uuid4(),
            user_id=uuid4(),
            title="Delete Me",
            description=None,
            target_keywords=None,
            outline={"sections": []},
            research_notes=None,
            status="draft",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(plan)
        session_local_mock.return_value = db

        delete_response = self.client.delete(f"/api/v1/plans/{plan.id}")
        self.assertEqual(delete_response.status_code, 200)
        self.assertIsNone(db.get(ContentPlan, plan.id))

        missing_response = self.client.delete(f"/api/v1/plans/{plan.id}")
        self.assertEqual(missing_response.status_code, 404)

    @patch("app.api.routes.content.SessionLocal")
    def test_patch_content_manual_edit_bumps_version(self, session_local_mock) -> None:
        db = InMemoryDbSession()
        content_item = ContentItem(
            id=uuid4(),
            content_plan_id=uuid4(),
            user_id=uuid4(),
            title="Draft Title",
            content="Initial content text",
            markdown_content="Initial content text",
            html_content=None,
            meta_description=None,
            tags=["draft"],
            word_count=3,
            status="draft",
            version=1,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(content_item)
        session_local_mock.return_value = db

        response = self.client.patch(
            f"/api/v1/content/{content_item.id}",
            json={
                "content": "Updated content text with practical examples.",
                "change_description": "Manual content edit from UI.",
            },
        )
        self.assertEqual(response.status_code, 200)

        body = response.get_json()
        self.assertEqual(body["version"], 2)
        self.assertEqual(body["content"], "Updated content text with practical examples.")
        self.assertEqual(body["markdown_content"], "Updated content text with practical examples.")
        self.assertGreater(body["word_count"], 3)
        self.assertEqual(len(db.content_versions), 1)
        self.assertEqual(db.content_versions[0].changed_by, "user")


if __name__ == "__main__":
    unittest.main()
