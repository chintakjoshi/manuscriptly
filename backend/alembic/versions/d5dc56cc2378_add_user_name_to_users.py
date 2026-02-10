"""add user_name to users

Revision ID: d5dc56cc2378
Revises: 61db56a21797
Create Date: 2026-02-10 00:47:55.995935

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5dc56cc2378'
down_revision: Union[str, None] = '61db56a21797'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("user_name", sa.String(length=100), nullable=True))
    op.execute(
        """
        UPDATE users
        SET user_name = split_part(email, '@', 1)
        WHERE user_name IS NULL
        """
    )
    op.alter_column("users", "user_name", existing_type=sa.String(length=100), nullable=False)
    op.create_index("idx_users_user_name", "users", ["user_name"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_users_user_name", table_name="users")
    op.drop_column("users", "user_name")
