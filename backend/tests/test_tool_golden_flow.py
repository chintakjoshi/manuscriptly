from __future__ import annotations

import unittest
from unittest.mock import patch
from uuid import UUID, uuid4

from app.agent_tools import ToolExecutionRouter
from app.models import ContentPlan, Conversation

from tests.fakes import InMemoryDbSession


class ToolGoldenFlowTests(unittest.TestCase):
    @patch("app.agent_tools.handlers._generate_blog_fields")
    @patch("app.agent_tools.handlers._generate_plan_fields")
    @patch("app.agent_tools.handlers.SessionLocal")
    def test_router_executes_create_update_execute_plan_flow(
        self,
        session_local_mock,
        generate_plan_fields_mock,
        generate_blog_fields_mock,
    ) -> None:
        db = InMemoryDbSession()
        conversation = Conversation(
            id=uuid4(),
            user_id=uuid4(),
            title="Golden flow session",
            status="active",
        )
        db.add(conversation)

        session_local_mock.return_value = db
        generate_plan_fields_mock.return_value = {
            "title": "AI Content Strategy Playbook",
            "description": "Plan for a practical content strategy article.",
            "target_keywords": ["content strategy", "ai writing"],
            "outline": {"sections": [{"heading": "Intro", "key_points": ["Context", "Problem"]}]},
            "research_notes": "Use practical examples and cite authoritative sources.",
            "status": "draft",
        }
        generate_blog_fields_mock.return_value = {
            "title": "AI Content Strategy Playbook",
            "content": "# AI Content Strategy Playbook\n\nA practical guide.",
            "meta_description": "A practical guide to AI-assisted content strategy.",
            "tags": ["content strategy", "ai writing"],
        }

        router = ToolExecutionRouter()

        create_response = router.execute(
            "create_content_idea",
            {
                "conversation_id": str(conversation.id),
                "user_request": "Create a practical article on AI content strategy.",
            },
        )
        created_plan_id = create_response["result"]["plan"]["id"]
        self.assertEqual(create_response["result"]["status"], "success")

        update_response = router.execute(
            "update_content_plan",
            {
                "conversation_id": str(conversation.id),
                "plan_id": created_plan_id,
                "title": "AI Content Strategy Playbook (Updated)",
                "status": "approved",
            },
        )
        self.assertEqual(update_response["result"]["status"], "success")
        self.assertIn("title", update_response["result"]["updated_fields"])
        self.assertIn("status", update_response["result"]["updated_fields"])

        execute_response = router.execute(
            "execute_plan",
            {
                "conversation_id": str(conversation.id),
                "plan_id": created_plan_id,
                "output_format": "markdown",
                "writing_instructions": "Keep it concise and practical.",
            },
        )

        self.assertEqual(execute_response["result"]["status"], "success")
        self.assertEqual(execute_response["result"]["plan"]["status"], "executed")
        self.assertEqual(len(db.content_items), 1)
        self.assertEqual(len(db.content_versions), 1)
        self.assertEqual(len(db.tool_executions), 3)
        self.assertTrue(all(entry.execution_status == "completed" for entry in db.tool_executions))

        persisted_plan = db.get(ContentPlan, UUID(created_plan_id))
        self.assertIsNotNone(persisted_plan)
        self.assertEqual(persisted_plan.status, "executed")
        self.assertEqual(persisted_plan.title, "AI Content Strategy Playbook (Updated)")

    @patch("app.agent_tools.handlers.WebSearchService.search")
    @patch("app.agent_tools.handlers.SessionLocal")
    def test_router_executes_web_search_tool(
        self,
        session_local_mock,
        web_search_mock,
    ) -> None:
        db = InMemoryDbSession()
        conversation = Conversation(
            id=uuid4(),
            user_id=uuid4(),
            title="Research session",
            status="active",
        )
        db.add(conversation)
        session_local_mock.return_value = db
        web_search_mock.return_value = {
            "status": "success",
            "engine": "duckduckgo",
            "query": "latest AI content marketing trends 2026",
            "result_count": 2,
            "results": [
                {
                    "title": "Trends report",
                    "snippet": "A summary of current trends.",
                    "url": "https://example.com/report",
                    "source": "Example",
                },
                {
                    "title": "Industry analysis",
                    "snippet": "Deep dive into AI writing patterns.",
                    "url": "https://example.com/analysis",
                    "source": "Example",
                },
            ],
        }

        router = ToolExecutionRouter()
        response = router.execute(
            "web_search",
            {
                "conversation_id": str(conversation.id),
                "query": "latest AI content marketing trends 2026",
                "max_results": 2,
            },
        )

        self.assertEqual(response["tool_name"], "web_search")
        self.assertEqual(response["result"]["status"], "success")
        self.assertEqual(response["result"]["result_count"], 2)
        self.assertEqual(len(response["result"]["results"]), 2)
        web_search_mock.assert_called_once_with("latest AI content marketing trends 2026", 2)
        self.assertEqual(len(db.tool_executions), 1)
        self.assertEqual(db.tool_executions[0].tool_name, "web_search")


if __name__ == "__main__":
    unittest.main()
