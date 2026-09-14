import { ValidationError as HttpValidationError } from "../errors/HttpError.js";

export type RooftopValidationErrorCode =
  | "ACCOUNTING_MONTH_REQUIRED"
  | "INVALID_ACCOUNTING_MONTH"
  | "ROOFTOP_PROFILE_UNSUPPORTED"
  | "SOURCE_FORMAT_UNSUPPORTED"
  | "SOURCE_TYPE_UNCERTAIN"
  | "SOURCE_PERIOD_MISMATCH"
  | "SOURCE_PERIOD_CONTRADICTORY"
  | "REQUIRED_COLUMNS_MISSING"
  | "ACURA_ACCOUNT_324_EMPTY"
  | "STRUCTURALLY_INVALID_TRANSACTIONS";

export type RooftopFailureDetails = {
  source: "boa" | "dealertrack" | null;
  accounting_month: string | null;
  rooftop_profile_id: string | null;
  evidence?: Record<string, string | number | boolean | null>;
  recovery: string;
};

export function rooftopValidationError(
  code: string,
  message: string,
  details: RooftopFailureDetails,
): HttpValidationError {
  return new HttpValidationError(message, code, details);
}
