"""create transactions table

Revision ID: 20260501_0001
Revises:
Create Date: 2026-05-01
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260501_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=20), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("post_date", sa.Date(), nullable=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("reference_number", sa.String(length=100), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("account", sa.String(length=100), nullable=True),
        sa.Column("stock_number", sa.String(length=100), nullable=True),
        sa.Column("vin", sa.String(length=32), nullable=True),
        sa.Column("raw_data", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_transactions_id"), "transactions", ["id"], unique=False)
    op.create_index(op.f("ix_transactions_source_type"), "transactions", ["source_type"], unique=False)
    op.create_index(
        op.f("ix_transactions_transaction_date"),
        "transactions",
        ["transaction_date"],
        unique=False,
    )
    op.create_index(op.f("ix_transactions_amount"), "transactions", ["amount"], unique=False)
    op.create_index(
        op.f("ix_transactions_reference_number"),
        "transactions",
        ["reference_number"],
        unique=False,
    )
    op.create_index(op.f("ix_transactions_account"), "transactions", ["account"], unique=False)
    op.create_index(
        op.f("ix_transactions_stock_number"),
        "transactions",
        ["stock_number"],
        unique=False,
    )
    op.create_index(op.f("ix_transactions_vin"), "transactions", ["vin"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_transactions_vin"), table_name="transactions")
    op.drop_index(op.f("ix_transactions_stock_number"), table_name="transactions")
    op.drop_index(op.f("ix_transactions_account"), table_name="transactions")
    op.drop_index(op.f("ix_transactions_reference_number"), table_name="transactions")
    op.drop_index(op.f("ix_transactions_amount"), table_name="transactions")
    op.drop_index(op.f("ix_transactions_transaction_date"), table_name="transactions")
    op.drop_index(op.f("ix_transactions_source_type"), table_name="transactions")
    op.drop_index(op.f("ix_transactions_id"), table_name="transactions")
    op.drop_table("transactions")
