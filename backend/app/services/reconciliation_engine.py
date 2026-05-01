from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.transaction import Transaction
from app.schemas.reconciliation import (
    MatchGroup,
    ReconciliationException,
    ReconciliationResponse,
    TransactionSummary,
)
from app.schemas.transaction import SourceType


VIN_EXACT_REASON = "vin_exact"
STOCK_AMOUNT_REASON = "stock_number_amount"
AMOUNT_CONTEXT_REASON = "amount_reference_context"


def reconcile_transactions(
    db: Session,
    left_source_type: SourceType = SourceType.boa,
    right_source_type: SourceType = SourceType.dealertrack,
) -> ReconciliationResponse:
    left_transactions = _get_transactions(db, left_source_type)
    right_transactions = _get_transactions(db, right_source_type)

    matched_right_ids: set[int] = set()
    duplicate_right_ids: set[int] = set()
    match_groups: list[MatchGroup] = []
    exceptions: list[ReconciliationException] = []

    for left_transaction in left_transactions:
        candidates = [
            right_transaction
            for right_transaction in right_transactions
            if right_transaction.id not in matched_right_ids
            and right_transaction.id not in duplicate_right_ids
        ]
        matching_candidates = _find_matching_candidates(left_transaction, candidates)

        if not matching_candidates:
            exceptions.append(
                _build_exception(
                    exception_type=f"missing_in_{right_source_type.value}",
                    transaction=left_transaction,
                    description=(
                        f"{left_source_type.value} transaction has no matching "
                        f"{right_source_type.value} transaction."
                    ),
                )
            )
            continue

        match = matching_candidates[0]
        duplicate_matches = matching_candidates[1:]
        matched_right_ids.add(match["transaction"].id)
        match_groups.append(
            MatchGroup(
                match_reason=match["match_reason"],
                confidence_score=match["confidence_score"],
                transactions=[
                    TransactionSummary.model_validate(left_transaction),
                    TransactionSummary.model_validate(match["transaction"]),
                ],
            )
        )

        for duplicate_match in duplicate_matches:
            duplicate_transaction = duplicate_match["transaction"]
            duplicate_right_ids.add(duplicate_transaction.id)
            exceptions.append(
                _build_exception(
                    exception_type="duplicate_transaction",
                    transaction=duplicate_transaction,
                    description=(
                        f"Duplicate {right_source_type.value} transaction matches "
                        f"{left_source_type.value} transaction {left_transaction.id} by "
                        f"{duplicate_match['match_reason']}."
                    ),
                )
            )

    for right_transaction in right_transactions:
        if right_transaction.id in matched_right_ids or right_transaction.id in duplicate_right_ids:
            continue

        exceptions.append(
            _build_exception(
                exception_type=f"missing_in_{left_source_type.value}",
                transaction=right_transaction,
                description=(
                    f"{right_source_type.value} transaction has no matching "
                    f"{left_source_type.value} transaction."
                ),
            )
        )

    duplicate_count = len(duplicate_right_ids)

    return ReconciliationResponse(
        matched_count=len(match_groups),
        exception_count=len(exceptions),
        duplicate_count=duplicate_count,
        match_groups=match_groups,
        exceptions=exceptions,
    )


def _get_transactions(db: Session, source_type: SourceType) -> list[Transaction]:
    return list(
        db.scalars(
            select(Transaction)
            .where(Transaction.source_type == source_type.value)
            .order_by(Transaction.id)
        )
    )


def _find_matching_candidates(
    left_transaction: Transaction,
    right_transactions: list[Transaction],
) -> list[dict[str, Transaction | str | float]]:
    matchers = [
        (VIN_EXACT_REASON, 1.0, _is_vin_match),
        (STOCK_AMOUNT_REASON, 0.92, _is_stock_amount_match),
        (AMOUNT_CONTEXT_REASON, 0.72, _is_amount_context_match),
    ]

    for match_reason, confidence_score, matcher in matchers:
        matches = [
            {
                "transaction": right_transaction,
                "match_reason": match_reason,
                "confidence_score": confidence_score,
            }
            for right_transaction in right_transactions
            if matcher(left_transaction, right_transaction)
        ]
        if matches:
            return matches

    return []


def _is_vin_match(left_transaction: Transaction, right_transaction: Transaction) -> bool:
    return bool(
        left_transaction.vin
        and right_transaction.vin
        and _clean(left_transaction.vin) == _clean(right_transaction.vin)
    )


def _is_stock_amount_match(left_transaction: Transaction, right_transaction: Transaction) -> bool:
    return bool(
        left_transaction.stock_number
        and right_transaction.stock_number
        and _clean(left_transaction.stock_number) == _clean(right_transaction.stock_number)
        and _amounts_match(left_transaction.amount, right_transaction.amount)
    )


def _is_amount_context_match(left_transaction: Transaction, right_transaction: Transaction) -> bool:
    if not _amounts_match(left_transaction.amount, right_transaction.amount):
        return False

    left_reference = _clean(left_transaction.reference_number)
    right_reference = _clean(right_transaction.reference_number)
    if left_reference and right_reference and left_reference == right_reference:
        return True

    left_context = _context(left_transaction)
    right_context = _context(right_transaction)

    return bool(left_context.intersection(right_context))


def _amounts_match(left_amount: Decimal, right_amount: Decimal) -> bool:
    return abs(left_amount) == abs(right_amount)


def _context(transaction: Transaction) -> set[str]:
    values = [
        transaction.reference_number,
        transaction.stock_number,
        transaction.vin,
        transaction.description,
    ]
    tokens: set[str] = set()
    for value in values:
        if not value:
            continue
        tokens.update(token for token in _clean(value).split() if len(token) >= 4)
    return tokens


def _clean(value: str | None) -> str:
    if value is None:
        return ""
    return " ".join(value.upper().replace("/", " ").replace("-", " ").split())


def _build_exception(
    exception_type: str,
    transaction: Transaction,
    description: str,
) -> ReconciliationException:
    return ReconciliationException(
        exception_type=exception_type,
        source_type=SourceType(transaction.source_type),
        transaction=TransactionSummary.model_validate(transaction),
        description=description,
    )
