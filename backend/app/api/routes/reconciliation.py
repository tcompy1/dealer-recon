from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.reconciliation import ReconciliationRequest, ReconciliationResponse
from app.services.reconciliation_engine import reconcile_transactions

router = APIRouter(tags=["reconciliation"])


@router.post("/reconcile", response_model=ReconciliationResponse)
def reconcile(
    request: ReconciliationRequest = Body(default=ReconciliationRequest()),
    db: Session = Depends(get_db),
) -> ReconciliationResponse:
    return reconcile_transactions(
        db=db,
        left_source_type=request.left_source_type,
        right_source_type=request.right_source_type,
    )
