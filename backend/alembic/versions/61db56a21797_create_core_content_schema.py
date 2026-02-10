"""create core content schema

Revision ID: 61db56a21797
Revises: 6ed166cec9ba
Create Date: 2026-02-10 00:08:09.129276

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as psql


# revision identifiers, used by Alembic.
revision: str = '61db56a21797'
down_revision: Union[str, None] = '6ed166cec9ba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "users",
        sa.Column("id", psql.UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("email"),
    )
    op.create_index("idx_users_email", "users", ["email"], unique=False)

    op.create_table(
        "user_profiles",
        sa.Column("id", psql.UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", psql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("company_name", sa.String(length=255), nullable=True),
        sa.Column("industry", sa.String(length=255), nullable=True),
        sa.Column("target_audience", sa.Text(), nullable=True),
        sa.Column("brand_voice", sa.Text(), nullable=True),
        sa.Column("content_preferences", psql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("additional_context", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("user_id", name="uq_user_profiles_user_id"),
    )
    op.create_index("idx_user_profiles_user_id", "user_profiles", ["user_id"], unique=False)

    op.create_table(
        "conversations",
        sa.Column("id", psql.UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", psql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default=sa.text("'active'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("idx_conversations_user_id", "conversations", ["user_id"], unique=False)
    op.execute("CREATE INDEX idx_conversations_created_at ON conversations(created_at DESC)")

    op.create_table(
        "messages",
        sa.Column("id", psql.UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("conversation_id", psql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("tool_calls", psql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("tool_results", psql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("context_used", psql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("idx_messages_conversation_id", "messages", ["conversation_id"], unique=False)
    op.create_index("idx_messages_created_at", "messages", ["created_at"], unique=False)

    op.create_table(
        "content_plans",
        sa.Column("id", psql.UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("conversation_id", psql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", psql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("target_keywords", psql.ARRAY(sa.Text()), nullable=True),
        sa.Column("outline", psql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("research_notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("idx_content_plans_user_id", "content_plans", ["user_id"], unique=False)
    op.create_index("idx_content_plans_conversation_id", "content_plans", ["conversation_id"], unique=False)
    op.create_index("idx_content_plans_status", "content_plans", ["status"], unique=False)

    op.create_table(
        "content_items",
        sa.Column("id", psql.UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("content_plan_id", psql.UUID(as_uuid=True), sa.ForeignKey("content_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", psql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("html_content", sa.Text(), nullable=True),
        sa.Column("markdown_content", sa.Text(), nullable=True),
        sa.Column("meta_description", sa.String(length=500), nullable=True),
        sa.Column("tags", psql.ARRAY(sa.Text()), nullable=True),
        sa.Column("word_count", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("idx_content_items_user_id", "content_items", ["user_id"], unique=False)
    op.create_index("idx_content_items_plan_id", "content_items", ["content_plan_id"], unique=False)
    op.create_index("idx_content_items_status", "content_items", ["status"], unique=False)

    op.create_table(
        "content_versions",
        sa.Column("id", psql.UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("content_item_id", psql.UUID(as_uuid=True), sa.ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("changed_by", sa.String(length=50), nullable=False),
        sa.Column("change_description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("content_item_id", "version", name="uq_content_versions_item_version"),
    )
    op.create_index("idx_content_versions_item_id", "content_versions", ["content_item_id"], unique=False)

    op.create_table(
        "tool_executions",
        sa.Column("id", psql.UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("message_id", psql.UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("conversation_id", psql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tool_name", sa.String(length=100), nullable=False),
        sa.Column("input_params", psql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("output_result", psql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("execution_status", sa.String(length=50), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("execution_time_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("idx_tool_executions_conversation_id", "tool_executions", ["conversation_id"], unique=False)
    op.create_index("idx_tool_executions_tool_name", "tool_executions", ["tool_name"], unique=False)
    op.execute("CREATE INDEX idx_tool_executions_created_at ON tool_executions(created_at DESC)")


def downgrade() -> None:
    op.drop_index("idx_tool_executions_created_at", table_name="tool_executions")
    op.drop_index("idx_tool_executions_tool_name", table_name="tool_executions")
    op.drop_index("idx_tool_executions_conversation_id", table_name="tool_executions")
    op.drop_table("tool_executions")

    op.drop_index("idx_content_versions_item_id", table_name="content_versions")
    op.drop_table("content_versions")

    op.drop_index("idx_content_items_status", table_name="content_items")
    op.drop_index("idx_content_items_plan_id", table_name="content_items")
    op.drop_index("idx_content_items_user_id", table_name="content_items")
    op.drop_table("content_items")

    op.drop_index("idx_content_plans_status", table_name="content_plans")
    op.drop_index("idx_content_plans_conversation_id", table_name="content_plans")
    op.drop_index("idx_content_plans_user_id", table_name="content_plans")
    op.drop_table("content_plans")

    op.drop_index("idx_messages_created_at", table_name="messages")
    op.drop_index("idx_messages_conversation_id", table_name="messages")
    op.drop_table("messages")

    op.drop_index("idx_conversations_created_at", table_name="conversations")
    op.drop_index("idx_conversations_user_id", table_name="conversations")
    op.drop_table("conversations")

    op.drop_index("idx_user_profiles_user_id", table_name="user_profiles")
    op.drop_table("user_profiles")

    op.drop_index("idx_users_email", table_name="users")
    op.drop_table("users")
