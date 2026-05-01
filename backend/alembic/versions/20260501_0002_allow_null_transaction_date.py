"""allow null transaction date

Revision ID: 20260501_0002
Revises: 20260501_0001
Create Date: 2026-05-01
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260501_0002"
down_revision: str | None = "20260501_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "transactions",
        "transaction_date",
        existing_type=sa.Date(),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "transactions",
        "transaction_date",
        existing_type=sa.Date(),
        nullable=False,
    )
