from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from app.agent_tools import handlers
from app.models import ContentPlan


def _build_plan() -> ContentPlan:
    return ContentPlan(
        id=uuid4(),
        conversation_id=uuid4(),
        user_id=uuid4(),
        title="The Rich Tapestry of North Indian Cuisine",
        description="A narrative guide to traditional dishes, history, and culinary heritage.",
        target_keywords=["north indian cuisine", "traditional dishes", "culinary heritage"],
        outline={
            "sections": [
                {
                    "heading": "Section",
                    "key_points": [
                        "Overview of North Indian culinary diversity",
                        "Why regional traditions continue to inspire modern cooks",
                    ],
                },
                {
                    "heading": "Section",
                    "key_points": [
                        "Historical roots and Mughal influence",
                        "How food traditions are preserved in homes and local communities",
                    ],
                },
            ]
        },
        research_notes="Focus on traditions and story-driven writing.",
        status="draft",
    )


class BlogGenerationQualityTests(unittest.TestCase):
    def test_coerce_blog_payload_from_plain_markdown_text(self) -> None:
        plan = _build_plan()
        body = " ".join(
            [
                "North Indian cuisine carries centuries of stories, migration, and craftsmanship.",
                "Each dish reflects a blend of regional climate, community values, and inherited technique.",
                "From bustling city kitchens to family celebrations, flavor and memory travel together.",
            ]
            * 18
        )
        text = f"# Inspired North Indian Traditions\n\n{body}"

        payload = handlers._coerce_blog_payload_from_text(text, plan)

        self.assertIsNotNone(payload)
        self.assertEqual(payload["title"], "Inspired North Indian Traditions")
        self.assertIn("North Indian cuisine carries centuries of stories", payload["content"])

    def test_generate_blog_fallback_expands_sections_without_template_markers(self) -> None:
        plan = _build_plan()

        generated = handlers._generate_blog_fallback(
            plan,
            writing_instructions="Write for food enthusiasts with an inspirational, story-driven tone.",
            output_format="markdown",
        )

        self.assertEqual(generated["generation_mode"], "fallback")
        self.assertNotIn("\n## Section\n", generated["content"])
        self.assertNotIn("Writing notes:", generated["content"])
        self.assertGreater(handlers._count_words(generated["content"]), 180)

    def test_coerce_blog_payload_rejects_json_like_text_without_valid_json(self) -> None:
        plan = _build_plan()
        malformed = (
            "```json\n"
            "{\n"
            '  "title": "How AI is Transforming Online Shopping",\n'
            '  "meta_description": "Example",\n'
            '  "content": "# How AI is Transforming Online Shopping\\n\\nThis is partial content"\n'
        )

        payload = handlers._coerce_blog_payload_from_text(malformed, plan)
        self.assertIsNone(payload)

    @patch("app.agent_tools.handlers._build_user_context", return_value={})
    @patch("app.agent_tools.handlers._generate_blog_with_ai")
    def test_generate_blog_fields_replaces_template_like_ai_content(
        self,
        generate_blog_with_ai_mock,
        build_user_context_mock,
    ) -> None:
        del build_user_context_mock
        plan = _build_plan()
        conversation = SimpleNamespace(user_id=uuid4())
        generate_blog_with_ai_mock.return_value = {
            "title": plan.title,
            "content": (
                "## Section\n\n- Overview point one\n- Overview point two\n\n"
                "## Section\n\n- Historical point one\n- Historical point two\n"
            ),
            "meta_description": plan.description,
            "tags": plan.target_keywords,
        }

        generated = handlers._generate_blog_fields(
            db=object(),
            conversation=conversation,
            plan=plan,
            writing_instructions="Inspiration and traditions.",
            output_format="markdown",
        )

        self.assertEqual(generated["generation_mode"], "fallback")
        self.assertNotIn("\n## Section\n", generated["content"])
        self.assertGreaterEqual(generated["content"].count("\n## "), 2)


if __name__ == "__main__":
    unittest.main()
