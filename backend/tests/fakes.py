from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.models import (
    ContentItem,
    ContentPlan,
    ContentVersion,
    Conversation,
    ToolExecution,
    User,
    UserProfile,
)


class _NoopQuery:
    def filter(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return self

    def one_or_none(self):
        return None


class InMemoryDbSession:
    def __init__(self) -> None:
        self.users: dict = {}
        self.user_profiles: dict = {}
        self.conversations: dict = {}
        self.plans: dict = {}
        self.content_items: dict = {}
        self.content_versions: list[ContentVersion] = []
        self.tool_executions: list[ToolExecution] = []
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def get(self, model, key):  # noqa: ANN001
        if model is User:
            return self.users.get(key)
        if model is UserProfile:
            return self.user_profiles.get(key)
        if model is Conversation:
            return self.conversations.get(key)
        if model is ContentPlan:
            return self.plans.get(key)
        if model is ContentItem:
            return self.content_items.get(key)
        return None

    def add(self, obj):  # noqa: ANN001
        if isinstance(obj, Conversation):
            if getattr(obj, "id", None) is None:
                obj.id = uuid4()
            self.conversations[obj.id] = obj
            return

        if isinstance(obj, ContentPlan):
            if getattr(obj, "id", None) is None:
                obj.id = uuid4()
            if getattr(obj, "created_at", None) is None:
                obj.created_at = datetime.now(timezone.utc)
            obj.updated_at = datetime.now(timezone.utc)
            self.plans[obj.id] = obj
            return

        if isinstance(obj, ContentItem):
            if getattr(obj, "id", None) is None:
                obj.id = uuid4()
            if getattr(obj, "created_at", None) is None:
                obj.created_at = datetime.now(timezone.utc)
            obj.updated_at = datetime.now(timezone.utc)
            self.content_items[obj.id] = obj
            return

        if isinstance(obj, ContentVersion):
            if getattr(obj, "id", None) is None:
                obj.id = uuid4()
            if getattr(obj, "created_at", None) is None:
                obj.created_at = datetime.now(timezone.utc)
            self.content_versions.append(obj)
            return

        if isinstance(obj, ToolExecution):
            if getattr(obj, "id", None) is None:
                obj.id = uuid4()
            if getattr(obj, "created_at", None) is None:
                obj.created_at = datetime.now(timezone.utc)
            self.tool_executions.append(obj)

    def delete(self, obj):  # noqa: ANN001
        if isinstance(obj, ContentPlan):
            self.plans.pop(obj.id, None)
        elif isinstance(obj, ContentItem):
            self.content_items.pop(obj.id, None)

    def flush(self) -> None:
        return

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        self.closed = True

    def refresh(self, obj):  # noqa: ANN001
        return obj

    def query(self, model):  # noqa: ANN001
        return _NoopQuery()
