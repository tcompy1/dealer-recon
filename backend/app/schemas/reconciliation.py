from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.schemas.transaction import SourceType


class ReconciliationRequest(BaseModel):
    left_source_type: SourceType = SourceType.boa
    right_source_type: SourceType = SourceType.dealertrack


class TransactionSummary(BaseModel):
    id: int
    source_type: SourceType
    transaction_date: date | None
    post_date: date | None
    amount: Decimal
    reference_number: str | None
    description: str | None
    account: str | None
    stock_number: str | None
    vin: str | None

    model_config = ConfigDict(from_attributes=True)


class MatchGroup(BaseModel):
    match_reason: str
    confidence_score: float
    transactions: list[TransactionSummary]


class ReconciliationException(BaseModel):
    exception_type: str
    source_type: SourceType
    transaction: TransactionSummary
    description: str


class ReconciliationResponse(BaseModel):
    matched_count: int
    exception_count: int
    duplicate_count: int
    match_groups: list[MatchGroup]
    exceptions: list[ReconciliationException]
