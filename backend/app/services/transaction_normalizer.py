import csv
import io
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.schemas.transaction import SourceType


@dataclass(frozen=True)
class NormalizedTransaction:
    source_type: str
    transaction_date: date | None
    post_date: date | None
    amount: Decimal
    reference_number: str | None
    description: str | None
    account: str | None
    stock_number: str | None
    vin: str | None
    raw_data: dict[str, Any]


ValidationError = dict[str, int | str | None]

MONEY_PATTERN = re.compile(r"^\(?\$?\s*-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\)?$")
REFERENCE_PATTERN = re.compile(r"^\d{5,9}$")
STOCK_PATTERN = re.compile(r"\bM\d{4,6}\b", re.IGNORECASE)
VIN_PATTERN = re.compile(
    r"\b(?=[A-Z0-9]{17}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{17}\b",
    re.IGNORECASE,
)

COLUMN_ALIASES = {
    "transaction_date": ["transaction_date", "transaction date", "date", "trans date"],
    "post_date": ["post_date", "post date", "posted date", "posting date"],
    "amount": ["amount", "transaction amount", "payment amount", "deposit amount"],
    "reference_number": [
        "reference_number",
        "reference number",
        "reference",
        "ref",
        "check number",
        "check #",
        "deposit number",
    ],
    "description": ["description", "memo", "details", "transaction description"],
    "account": ["account", "gl account", "account number"],
    "stock_number": ["stock_number", "stock number", "stock #", "stock"],
    "vin": ["vin", "vehicle identification number"],
}

DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d")


def normalize_transactions_from_csv(
    content: bytes,
    source_type: SourceType,
) -> tuple[list[NormalizedTransaction], list[ValidationError]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], [
            {
                "row": None,
                "field": "file",
                "message": "CSV must be encoded as UTF-8.",
            }
        ]

    if source_type == SourceType.boa:
        return _normalize_boa_transactions_from_csv(text, source_type)

    if source_type == SourceType.dealertrack:
        return _normalize_dealertrack_transactions_from_csv(text, source_type)

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return [], [
            {
                "row": None,
                "field": "file",
                "message": "CSV file is empty or missing a header row.",
            }
        ]

    header_lookup = {_normalize_header(header): header for header in reader.fieldnames}
    transactions: list[NormalizedTransaction] = []
    validation_errors: list[ValidationError] = []

    for row_number, row in enumerate(reader, start=2):
        normalized, row_errors = _normalize_row(row, row_number, header_lookup, source_type)
        validation_errors.extend(row_errors)

        if normalized is not None:
            transactions.append(normalized)

    return transactions, validation_errors


def _normalize_boa_transactions_from_csv(
    text: str,
    source_type: SourceType,
) -> tuple[list[NormalizedTransaction], list[ValidationError]]:
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return [], [
            {
                "row": None,
                "field": "file",
                "message": "CSV file is empty.",
            }
        ]

    header = rows[0] if _looks_like_header(rows[0]) else None
    transactions: list[NormalizedTransaction] = []
    validation_errors: list[ValidationError] = []
    rows_scanned = 0
    rows_accepted = 0
    rows_skipped = 0
    sample_accepted_rows: list[list[str]] = []

    for row_number, row in enumerate(rows, start=1):
        rows_scanned += 1
        if header is not None and row_number == 1:
            rows_skipped += 1
            continue

        cleaned_row = [_clean_cell(value) for value in row]
        if not _is_boa_transaction_row(cleaned_row):
            rows_skipped += 1
            continue

        rows_accepted += 1
        if len(sample_accepted_rows) < 3:
            sample_accepted_rows.append(cleaned_row)

        normalized, row_errors = _normalize_boa_row(cleaned_row, row_number, source_type, header)
        validation_errors.extend(row_errors)

        if normalized is not None:
            transactions.append(normalized)

    _print_parser_debug("BOA", rows_scanned, rows_accepted, rows_skipped, sample_accepted_rows)

    return transactions, validation_errors


def _normalize_dealertrack_transactions_from_csv(
    text: str,
    source_type: SourceType,
) -> tuple[list[NormalizedTransaction], list[ValidationError]]:
    rows = list(csv.reader(io.StringIO(text)))
    transactions: list[NormalizedTransaction] = []
    rows_scanned = 0
    rows_accepted = 0
    rows_skipped = 0
    sample_accepted_rows: list[list[str]] = []

    for row in rows:
        rows_scanned += 1
        cleaned_row = [_clean_cell(value) for value in row]
        if not _is_dealertrack_transaction_row(cleaned_row):
            rows_skipped += 1
            continue

        rows_accepted += 1
        if len(sample_accepted_rows) < 3:
            sample_accepted_rows.append(cleaned_row)

        transactions.append(_normalize_dealertrack_row(cleaned_row, source_type))

    _print_parser_debug(
        "Dealertrack",
        rows_scanned,
        rows_accepted,
        rows_skipped,
        sample_accepted_rows,
    )

    return transactions, []


def _normalize_boa_row(
    row: list[str],
    row_number: int,
    source_type: SourceType,
    header: list[str] | None,
) -> tuple[NormalizedTransaction | None, list[ValidationError]]:
    transaction_date = _find_boa_transaction_date(row)
    post_date = _find_boa_post_date(row, transaction_date)
    amount = _find_boa_amount(row, header)
    reference_number = _find_boa_reference_number(row, header)
    stock_number = _find_pattern_value(row, STOCK_PATTERN)
    vin = _find_pattern_value(row, VIN_PATTERN)

    errors: list[ValidationError] = []
    if transaction_date is None:
        errors.append(
            {
                "row": row_number,
                "field": "transaction_date",
                "message": "BOA transaction date is missing or invalid.",
            }
        )

    if amount is None:
        errors.append(
            {
                "row": row_number,
                "field": "amount",
                "message": "BOA amount is missing or invalid.",
            }
        )

    if errors:
        return None, errors

    return (
        NormalizedTransaction(
            source_type=source_type.value,
            transaction_date=transaction_date,
            post_date=post_date,
            amount=amount,
            reference_number=reference_number,
            description=_build_boa_description(row),
            account=None,
            stock_number=stock_number,
            vin=vin,
            raw_data=_build_raw_data(row, header),
        ),
        [],
    )


def _normalize_dealertrack_row(
    row: list[str],
    source_type: SourceType,
) -> NormalizedTransaction:
    return NormalizedTransaction(
        source_type=source_type.value,
        transaction_date=None,
        post_date=None,
        amount=_parse_amount(row[2]),
        reference_number=None,
        description=row[1] or None,
        account=None,
        stock_number=row[0].upper(),
        vin=None,
        raw_data=_build_raw_data(row, None),
    )


def _normalize_row(
    row: dict[str, str | None],
    row_number: int,
    header_lookup: dict[str, str],
    source_type: SourceType,
) -> tuple[NormalizedTransaction | None, list[ValidationError]]:
    errors: list[ValidationError] = []

    transaction_date = _parse_date(_get_value(row, header_lookup, "transaction_date"))
    if transaction_date is None:
        errors.append(
            {
                "row": row_number,
                "field": "transaction_date",
                "message": "Transaction date is required and must be a valid date.",
            }
        )

    post_date = _parse_date(_get_value(row, header_lookup, "post_date"))
    amount = _parse_amount(_get_value(row, header_lookup, "amount"))
    if amount is None:
        errors.append(
            {
                "row": row_number,
                "field": "amount",
                "message": "Amount is required and must be a valid number.",
            }
        )

    if errors:
        return None, errors

    return (
        NormalizedTransaction(
            source_type=source_type.value,
            transaction_date=transaction_date,
            post_date=post_date,
            amount=amount,
            reference_number=_get_value(row, header_lookup, "reference_number"),
            description=_get_value(row, header_lookup, "description"),
            account=_get_value(row, header_lookup, "account"),
            stock_number=_get_value(row, header_lookup, "stock_number"),
            vin=_get_value(row, header_lookup, "vin"),
            raw_data={key: value for key, value in row.items()},
        ),
        [],
    )


def _get_value(
    row: dict[str, str | None],
    header_lookup: dict[str, str],
    field: str,
) -> str | None:
    for alias in COLUMN_ALIASES[field]:
        header = header_lookup.get(_normalize_header(alias))
        if header is None:
            continue

        value = row.get(header)
        if value is None:
            return None

        value = value.strip()
        return value or None

    return None


def _is_boa_transaction_row(values: list[str]) -> bool:
    if not any(values):
        return False

    row_text = " ".join(values).lower()
    if "subtotal" in row_text or "total" in row_text:
        return False

    if not any(character.isdigit() for value in values for character in value):
        return False

    has_vin = _find_pattern_value(values, VIN_PATTERN) is not None
    stock_number = _find_pattern_value(values, STOCK_PATTERN)
    currency_amount = _find_currency_amount(values)

    if currency_amount is None:
        return False

    if currency_amount == Decimal("0") and not has_vin:
        return False

    return has_vin or stock_number is not None


def _is_dealertrack_transaction_row(values: list[str]) -> bool:
    if len(values) < 3:
        return False

    stock_number = values[0]
    amount = _parse_amount(values[2])

    return bool(
        stock_number
        and STOCK_PATTERN.fullmatch(stock_number)
        and amount is not None
        and amount != Decimal("0")
    )


def _find_boa_transaction_date(values: list[str]) -> date | None:
    return _find_first_date(values)


def _find_boa_post_date(values: list[str], transaction_date: date | None) -> date | None:
    for value in values:
        parsed_date = _parse_date(value)
        if parsed_date is not None and parsed_date != transaction_date:
            return parsed_date
    return None


def _find_first_date(values: list[str]) -> date | None:
    for value in values:
        parsed_date = _parse_date(value)
        if parsed_date is not None:
            return parsed_date
    return None


def _find_boa_amount(values: list[str], header: list[str] | None) -> Decimal | None:
    if header is not None:
        header_lookup = {_normalize_header(name): index for index, name in enumerate(header)}
        for alias in COLUMN_ALIASES["amount"]:
            index = header_lookup.get(_normalize_header(alias))
            if index is not None and index < len(values):
                parsed_amount = _parse_amount(values[index])
                if parsed_amount is not None:
                    return parsed_amount

    for value in values:
        if _looks_like_money(value):
            parsed_amount = _parse_amount(value)
            if parsed_amount is not None:
                return parsed_amount

    for value in values:
        if _parse_date(value) is not None or REFERENCE_PATTERN.fullmatch(value):
            continue

        parsed_amount = _parse_amount(value)
        if parsed_amount is not None and "." in value:
            return parsed_amount

    return None


def _find_currency_amount(values: list[str]) -> Decimal | None:
    for value in values:
        if _looks_like_money(value):
            return _parse_amount(value)
    return None


def _print_parser_debug(
    source_name: str,
    rows_scanned: int,
    rows_accepted: int,
    rows_skipped: int,
    sample_accepted_rows: list[list[str]],
) -> None:
    print(
        f"{source_name} parser debug: "
        f"rows_scanned={rows_scanned} "
        f"rows_accepted={rows_accepted} "
        f"rows_skipped={rows_skipped} "
        f"sample_accepted_rows={sample_accepted_rows[:3]}",
        file=sys.stderr,
    )


def _find_boa_reference_number(values: list[str], header: list[str] | None) -> str | None:
    if header is not None:
        header_lookup = {_normalize_header(name): index for index, name in enumerate(header)}
        for alias in COLUMN_ALIASES["reference_number"]:
            index = header_lookup.get(_normalize_header(alias))
            if index is not None and index < len(values):
                value = values[index]
                return value or None

    for value in values:
        if REFERENCE_PATTERN.fullmatch(value):
            return value

    return None


def _find_pattern_value(values: list[str], pattern: re.Pattern[str]) -> str | None:
    for value in values:
        match = pattern.search(value)
        if match:
            return match.group(0).upper()
    return None


def _build_boa_description(values: list[str]) -> str | None:
    meaningful_values = [
        value
        for value in values
        if value
        and _parse_date(value) is None
        and not _looks_like_money(value)
        and not VIN_PATTERN.search(value)
    ]
    return " | ".join(meaningful_values[:6]) or None


def _build_raw_data(values: list[str], header: list[str] | None) -> dict[str, str]:
    if header is None:
        return {f"column_{index}": value for index, value in enumerate(values)}

    raw_data: dict[str, str] = {}
    for index, value in enumerate(values):
        key = header[index].strip() if index < len(header) and header[index].strip() else None
        raw_data[key or f"column_{index}"] = value
    return raw_data


def _looks_like_header(row: list[str]) -> bool:
    normalized_values = {_normalize_header(value) for value in row if value}
    known_headers = {
        _normalize_header(alias)
        for aliases in COLUMN_ALIASES.values()
        for alias in aliases
    }
    return bool(normalized_values.intersection(known_headers))


def _looks_like_money(value: str) -> bool:
    return bool(value and ("$" in value or "," in value) and MONEY_PATTERN.fullmatch(value))


def _clean_cell(value: str | None) -> str:
    return (value or "").strip().strip('"').strip()


def _normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _parse_date(value: str | None) -> date | None:
    if value is None:
        return None

    for date_format in DATE_FORMATS:
        try:
            return datetime.strptime(value, date_format).date()
        except ValueError:
            continue

    return None


def _parse_amount(value: str | None) -> Decimal | None:
    if value is None:
        return None

    normalized = value.strip().replace("$", "").replace(",", "").strip()
    if normalized.startswith("(") and normalized.endswith(")"):
        normalized = f"-{normalized[1:-1]}"

    try:
        return Decimal(normalized)
    except InvalidOperation:
        return None
