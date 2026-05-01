from dataclasses import asdict

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.transaction import Transaction
from app.schemas.transaction import SourceType, UploadResponse
from app.services.transaction_normalizer import normalize_transactions_from_csv

router = APIRouter(tags=["uploads"])


@router.post("/upload", response_model=UploadResponse)
async def upload_transactions(
    source_type: SourceType = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> UploadResponse:
    content = await file.read()
    normalized_transactions, validation_errors = normalize_transactions_from_csv(
        content=content,
        source_type=source_type,
    )

    transactions = [
        Transaction(**asdict(normalized_transaction))
        for normalized_transaction in normalized_transactions
    ]

    db.add_all(transactions)
    db.commit()

    return UploadResponse(
        source_type=source_type,
        filename=file.filename or "upload.csv",
        transaction_count=len(transactions),
        validation_errors=validation_errors,
    )
