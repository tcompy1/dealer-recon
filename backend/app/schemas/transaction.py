from enum import Enum

from pydantic import BaseModel


class SourceType(str, Enum):
    bank = "bank"
    boa = "boa"
    dealertrack = "dealertrack"
    dms = "dms"
    gl = "gl"
    oem = "oem"


class UploadValidationError(BaseModel):
    row: int | None = None
    field: str | None = None
    message: str


class UploadResponse(BaseModel):
    source_type: SourceType
    filename: str
    transaction_count: int
    validation_errors: list[UploadValidationError]
