import { ValidationError as HttpValidationError } from "../errors/HttpError.js";

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
