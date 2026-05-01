from __future__ import annotations

import argparse
import sys
from dataclasses import asdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.models import Base  # noqa: E402
from app.models.transaction import Transaction  # noqa: E402
from app.schemas.reconciliation import ReconciliationException, ReconciliationResponse  # noqa: E402
from app.schemas.transaction import SourceType  # noqa: E402
from app.services.reconciliation_engine import reconcile_transactions  # noqa: E402
from app.services.transaction_normalizer import normalize_transactions_from_csv  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run local-only BOA vs Dealertrack floorplan reconciliation."
    )
    parser.add_argument("--boa-file", required=True, help="Path to BOA billing statement CSV.")
    parser.add_argument(
        "--dealertrack-file",
        required=True,
        help="Path to Dealertrack floorplan CSV. Convert XLSX exports to CSV first.",
    )
    args = parser.parse_args()

    boa_file = Path(args.boa_file).expanduser()
    dealertrack_file = Path(args.dealertrack_file).expanduser()

    try:
        _validate_csv_path(boa_file, "BOA")
        _validate_csv_path(dealertrack_file, "Dealertrack")

        result = run_reconciliation(boa_file=boa_file, dealertrack_file=dealertrack_file)
    except LocalReconError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    print_reconciliation_result(result)
    return 0


def run_reconciliation(boa_file: Path, dealertrack_file: Path) -> ReconciliationResponse:
    engine = create_engine("sqlite:///:memory:")
    session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    db = session_local()
    try:
        _load_file(db, boa_file, SourceType.boa)
        _load_file(db, dealertrack_file, SourceType.dealertrack)
        return reconcile_transactions(db)
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def print_reconciliation_result(result: ReconciliationResponse) -> None:
    boa_only = _exceptions_by_type(result, "missing_in_dealertrack")
    dealertrack_only = _exceptions_by_type(result, "missing_in_boa")
    duplicate_dealertrack = _exceptions_by_type(result, "duplicate_transaction")

    print(f"matched count: {result.matched_count}")
    print(f"exceptions count: {result.exception_count}")
    print(f"duplicates count: {result.duplicate_count}")
    print()

    print("matches:")
    if result.match_groups:
        for group in result.match_groups:
            boa_transaction = group.transactions[0]
            dealertrack_transaction = group.transactions[1]
            print(
                "  "
                f"{_row_label(boa_transaction)} <-> {_row_label(dealertrack_transaction)} | "
                f"reason={group.match_reason} | confidence={group.confidence_score:.2f}"
            )
    else:
        print("  none")

    print()
    _print_exception_section("BOA-only rows", boa_only)
    _print_exception_section("Dealertrack-only rows", dealertrack_only)
    _print_exception_section("duplicate Dealertrack rows", duplicate_dealertrack)


def _load_file(db, file_path: Path, source_type: SourceType) -> None:
    transactions, validation_errors = normalize_transactions_from_csv(
        content=file_path.read_bytes(),
        source_type=source_type,
    )

    if validation_errors:
        formatted_errors = "; ".join(
            f"row {error.get('row')}: {error.get('message')}" for error in validation_errors
        )
        raise LocalReconError(f"{source_type.value} file has validation errors: {formatted_errors}")

    db.add_all(Transaction(**asdict(transaction)) for transaction in transactions)
    db.commit()


def _validate_csv_path(file_path: Path, label: str) -> None:
    if not file_path.exists():
        raise LocalReconError(f"{label} file does not exist: {file_path}")
    if file_path.suffix.lower() in {".xlsx", ".xls"}:
        raise LocalReconError(
            f"{label} file is an Excel workbook. Convert it to CSV first; see "
            "scripts/convert_xlsx_to_csv.md."
        )
    if file_path.suffix.lower() != ".csv":
        raise LocalReconError(f"{label} file must be a CSV file: {file_path}")


def _exceptions_by_type(
    result: ReconciliationResponse,
    exception_type: str,
) -> list[ReconciliationException]:
    return [
        exception for exception in result.exceptions if exception.exception_type == exception_type
    ]


def _print_exception_section(title: str, exceptions: list[ReconciliationException]) -> None:
    print(f"{title}: {len(exceptions)}")
    if not exceptions:
        print("  none")
        print()
        return

    for exception in exceptions:
        print(f"  {_row_label(exception.transaction)} | {exception.description}")
    print()


def _row_label(transaction) -> str:
    return (
        f"{transaction.source_type.value.upper()} "
        f"id={transaction.id} "
        f"stock={transaction.stock_number or 'n/a'} "
        f"vin={transaction.vin or 'n/a'} "
        f"ref={transaction.reference_number or 'n/a'} "
        f"amount={transaction.amount}"
    )


class LocalReconError(Exception):
    pass


if __name__ == "__main__":
    raise SystemExit(main())
