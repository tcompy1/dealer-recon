from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import Date, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    transaction_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    post_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, index=True)
    reference_number: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    account: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    stock_number: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    vin: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    raw_data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
