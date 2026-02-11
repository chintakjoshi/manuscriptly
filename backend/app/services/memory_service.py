from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Config
from app.models import ContentPlan, Conversation, Message


class AgentMemoryService:
    FACT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
        ("company_name", re.compile(r"(?:company(?:\s+name)?|brand)\s*(?:is|=|:)\s*(.+)", re.IGNORECASE)),
        ("target_audience", re.compile(r"(?:target audience|audience)\s*(?:is|=|:)\s*(.+)", re.IGNORECASE)),
        ("brand_voice", re.compile(r"(?:brand voice|tone|writing style)\s*(?:is|=|:)\s*(.+)", re.IGNORECASE)),
        ("primary_goal", re.compile(r"(?:goal|objective)\s*(?:is|=|:)\s*(.+)", re.IGNORECASE)),
        ("topic_focus", re.compile(r"(?:topic|blog idea|post idea)\s*(?:is|=|:)\s*(.+)", re.IGNORECASE)),
    )

    PROFILE_FIELD_LABELS = {
        "user_name": "User Name",
        "company_name": "Company Name",
        "industry": "Industry",
        "target_audience": "Target Audience",
        "brand_voice": "Brand Voice",
        "additional_context": "Additional Context",
    }

    def __init__(self, db: Session) -> None:
        self.db = db

    def build_snapshot(self, conversation_id: UUID, user_id: UUID, user_context: dict[str, Any]) -> dict[str, Any]:
        current_session_inputs = self._fetch_recent_user_messages(
            conversation_id=conversation_id,
            limit=Config.AGENT_MEMORY_SESSION_MESSAGE_LIMIT,
        )
        cross_session_inputs = self._fetch_cross_session_user_messages(
            user_id=user_id,
            exclude_conversation_id=conversation_id,
            limit=Config.AGENT_MEMORY_CROSS_SESSION_MESSAGE_LIMIT,
        )
        recent_plans = self._fetch_recent_plans(user_id=user_id, limit=Config.AGENT_MEMORY_PLAN_LIMIT)
        known_profile_fields = self._extract_known_profile_fields(user_context)
        inferred_facts = self._extract_message_facts([*reversed(cross_session_inputs), *reversed(current_session_inputs)])

        return {
            "known_profile_fields": known_profile_fields,
            "inferred_facts": inferred_facts,
            "current_session_intents": current_session_inputs,
            "cross_session_intents": cross_session_inputs,
            "recent_plan_memory": recent_plans,
        }

    def _fetch_recent_user_messages(self, conversation_id: UUID, limit: int) -> list[str]:
        rows = (
            self.db.execute(
                select(Message.content)
                .where(Message.conversation_id == conversation_id, Message.role == "user")
                .order_by(Message.created_at.desc())
                .limit(max(limit, 0))
            )
            .scalars()
            .all()
        )
        return self._dedupe_preserve_order([self._compact_text(value) for value in rows if value], limit)

    def _fetch_cross_session_user_messages(
        self,
        user_id: UUID,
        exclude_conversation_id: UUID,
        limit: int,
    ) -> list[str]:
        rows = (
            self.db.execute(
                select(Message.content)
                .join(Conversation, Conversation.id == Message.conversation_id)
                .where(
                    Conversation.user_id == user_id,
                    Message.role == "user",
                    Message.conversation_id != exclude_conversation_id,
                )
                .order_by(Message.created_at.desc())
                .limit(max(limit, 0))
            )
            .scalars()
            .all()
        )
        return self._dedupe_preserve_order([self._compact_text(value) for value in rows if value], limit)

    def _fetch_recent_plans(self, user_id: UUID, limit: int) -> list[dict[str, Any]]:
        rows = (
            self.db.execute(
                select(ContentPlan.title, ContentPlan.target_keywords)
                .where(ContentPlan.user_id == user_id)
                .order_by(ContentPlan.updated_at.desc())
                .limit(max(limit, 0))
            )
            .all()
        )

        plans: list[dict[str, Any]] = []
        for row in rows:
            title = self._compact_text(str(row.title), max_length=120)
            keywords = row.target_keywords if isinstance(row.target_keywords, list) else None
            entry: dict[str, Any] = {"title": title}
            if keywords:
                trimmed_keywords = [self._compact_text(str(keyword), max_length=40) for keyword in keywords[:5]]
                entry["keywords"] = trimmed_keywords
            plans.append(entry)
        return plans

    def _extract_known_profile_fields(self, user_context: dict[str, Any]) -> list[dict[str, str]]:
        known_fields: list[dict[str, str]] = []
        for field_name, label in self.PROFILE_FIELD_LABELS.items():
            raw_value = user_context.get(field_name)
            if not raw_value:
                continue
            normalized = self._compact_text(str(raw_value))
            if not normalized:
                continue
            known_fields.append({"field": field_name, "label": label, "value": normalized})
        return known_fields

    def _extract_message_facts(self, messages: list[str]) -> list[dict[str, str]]:
        facts: dict[str, str] = {}
        for message in messages:
            for fact_name, pattern in self.FACT_PATTERNS:
                match = pattern.search(message)
                if not match:
                    continue
                raw_value = match.group(1).strip(" .,!;:")
                normalized = self._compact_text(raw_value, max_length=160)
                if not normalized:
                    continue
                facts[fact_name] = normalized

        entries: list[dict[str, str]] = []
        for fact_name, value in facts.items():
            label = self.PROFILE_FIELD_LABELS.get(fact_name, fact_name.replace("_", " ").title())
            entries.append({"fact": fact_name, "label": label, "value": value})
        return entries

    @staticmethod
    def _compact_text(value: str, max_length: int = 220) -> str:
        normalized = " ".join(value.split())
        if len(normalized) <= max_length:
            return normalized
        return f"{normalized[: max_length - 3].rstrip()}..."

    @staticmethod
    def _dedupe_preserve_order(values: list[str], limit: int) -> list[str]:
        seen: set[str] = set()
        deduped: list[str] = []
        for value in values:
            key = value.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(value)
            if len(deduped) >= max(limit, 0):
                break
        return deduped
