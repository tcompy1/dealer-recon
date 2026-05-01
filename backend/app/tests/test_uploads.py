from decimal import Decimal

from app.models.transaction import Transaction
from app.schemas.transaction import SourceType
from app.services.transaction_normalizer import normalize_transactions_from_csv


def test_successful_csv_upload(client, db_session_factory) -> None:
    csv_content = "\n".join(
        [
            "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
            "2026-04-30,2026-05-01,1234.56,DEP-1001,Daily deposit,1000,STK123,1HGCM82633A004352",
        ]
    )

    response = client.post(
        "/upload",
        data={"source_type": "bank"},
        files={"file": ("bank_transactions.csv", csv_content, "text/csv")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "source_type": "bank",
        "filename": "bank_transactions.csv",
        "transaction_count": 1,
        "validation_errors": [],
    }

    db = db_session_factory()
    try:
        transaction = db.query(Transaction).one()
        assert transaction.source_type == "bank"
        assert transaction.amount == Decimal("1234.56")
        assert transaction.reference_number == "DEP-1001"
        assert transaction.description == "Daily deposit"
        assert transaction.account == "1000"
        assert transaction.stock_number == "STK123"
        assert transaction.vin == "1HGCM82633A004352"
        assert transaction.raw_data["reference_number"] == "DEP-1001"
    finally:
        db.close()


def test_upload_rejects_invalid_source_type(client) -> None:
    response = client.post(
        "/upload",
        data={"source_type": "crm"},
        files={"file": ("transactions.csv", "transaction_date,amount\n2026-04-30,10.00\n", "text/csv")},
    )

    assert response.status_code == 422


def test_upload_requires_file(client) -> None:
    response = client.post("/upload", data={"source_type": "bank"})

    assert response.status_code == 422


def test_boa_upload_parses_real_floorplan_row_shape(client, db_session_factory) -> None:
    csv_content = "\n".join(
        [
            "Report generated,5/1/2026,,,,,,,,,,",
            ',,,9/26/2025,382882,,M20657,,7MMVABAM8SN382882,,"$31,525.00",',
        ]
    )

    response = client.post(
        "/upload",
        data={"source_type": "boa"},
        files={"file": ("BillingStatementMarch2026.csv", csv_content, "text/csv")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "source_type": "boa",
        "filename": "BillingStatementMarch2026.csv",
        "transaction_count": 1,
        "validation_errors": [],
    }

    db = db_session_factory()
    try:
        transaction = db.query(Transaction).one()
        assert transaction.source_type == "boa"
        assert transaction.transaction_date.isoformat() == "2025-09-26"
        assert transaction.amount == Decimal("31525.00")
        assert transaction.reference_number == "382882"
        assert transaction.stock_number == "M20657"
        assert transaction.vin == "7MMVABAM8SN382882"
        assert transaction.raw_data["column_10"] == "$31,525.00"
    finally:
        db.close()


def test_boa_parser_filters_mixed_non_transaction_rows(capsys) -> None:
    csv_content = "\n".join(
        [
            "Report generated,5/1/2026,,,,,,,,,,",
            "Customer Name,Account,Floorplan Report,,,,,,,,",
            'Subtotal,,,,M20657,,,,,,"$31,525.00",',
            ",,,,,,,,,,,",
            "Notes,row,without,numbers,,,,,,,",
            ',,,9/26/2025,382882,,M20657,,7MMVABAM8SN382882,,"$31,525.00",',
            'Total,,,,,,,,,,"$31,525.00",',
            ',,,10/01/2025,708021,,M20450,,,, "$0.00",',
            ',,,10/01/2025,708021,,,,7MMVABAM8SN382882,, "$0.00",',
            ',,,10/02/2025,,,,,,, "$0.00",',
        ]
    )

    transactions, validation_errors = normalize_transactions_from_csv(
        content=csv_content.encode(),
        source_type=SourceType.boa,
    )
    debug_output = capsys.readouterr().err

    assert validation_errors == []
    assert len(transactions) == 2
    assert [transaction.reference_number for transaction in transactions] == ["382882", "708021"]
    assert [transaction.stock_number for transaction in transactions] == ["M20657", None]
    assert transactions[0].amount == Decimal("31525.00")
    assert transactions[1].amount == Decimal("0.00")
    assert "rows_scanned=10" in debug_output
    assert "rows_accepted=2" in debug_output
    assert "rows_skipped=8" in debug_output


def test_dealertrack_upload_parses_positional_row(client, db_session_factory) -> None:
    csv_content = "\n".join(
        [
            'M20450,"BOA FLOORPLAN",-32558,0',
            'M00000,"ZERO ROW",0,0',
            'BAD,"BOA FLOORPLAN",-111,0',
        ]
    )

    response = client.post(
        "/upload",
        data={"source_type": "dealertrack"},
        files={"file": ("dealertrack.csv", csv_content, "text/csv")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "source_type": "dealertrack",
        "filename": "dealertrack.csv",
        "transaction_count": 1,
        "validation_errors": [],
    }

    db = db_session_factory()
    try:
        transaction = db.query(Transaction).one()
        assert transaction.source_type == "dealertrack"
        assert transaction.transaction_date is None
        assert transaction.amount == Decimal("-32558.00")
        assert transaction.stock_number == "M20450"
        assert transaction.description == "BOA FLOORPLAN"
        assert transaction.raw_data["column_0"] == "M20450"
        assert transaction.raw_data["column_3"] == "0"
    finally:
        db.close()
