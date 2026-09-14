import { describe, expect, test } from "vitest";

import { ValidationError as HttpValidationError } from "../errors/HttpError.js";
import {
  rooftopValidationError,
  type RooftopValidationErrorCode,
} from "./rooftopValidation.js";

const STABLE_ROOFTOP_VALIDATION_CODES = [
  "ACCOUNTING_MONTH_REQUIRED",
  "INVALID_ACCOUNTING_MONTH",
  "ROOFTOP_PROFILE_UNSUPPORTED",
  "SOURCE_FORMAT_UNSUPPORTED",
  "SOURCE_TYPE_UNCERTAIN",
  "SOURCE_PERIOD_MISMATCH",
  "SOURCE_PERIOD_CONTRADICTORY",
  "REQUIRED_COLUMNS_MISSING",
  "ACURA_ACCOUNT_324_EMPTY",
  "STRUCTURALLY_INVALID_TRANSACTIONS",
] as const satisfies readonly RooftopValidationErrorCode[];

describe("rooftopValidationError", () => {
  test("returns the shared structured 422 rooftop failure contract", () => {
    const error = rooftopValidationError(
      "ROOFTOP_PROFILE_UNSUPPORTED",
      "The selected store is not enabled for floorplan reconciliation.",
      {
        source: null,
        accounting_month: "2026-04",
        rooftop_profile_id: null,
        recovery: "Select an enabled rooftop or complete that rooftop's evidence onboarding.",
      },
    );

    expect(error).toBeInstanceOf(HttpValidationError);
    expect(error.statusCode).toBe(422);
    expect(error.toJSON()).toEqual({
      error: {
        code: "ROOFTOP_PROFILE_UNSUPPORTED",
        message: "The selected store is not enabled for floorplan reconciliation.",
        details: {
          source: null,
          accounting_month: "2026-04",
          rooftop_profile_id: null,
          recovery: "Select an enabled rooftop or complete that rooftop's evidence onboarding.",
        },
      },
    });
  });

  test.each(STABLE_ROOFTOP_VALIDATION_CODES)(
    "preserves the stable %s code in the serialized API contract",
    (code) => {
      const error = rooftopValidationError(code, "Safe explanation.", {
        source: "boa",
        accounting_month: "2026-04",
        rooftop_profile_id: "acura-v1",
        recovery: "Correct the source and upload it again.",
      });

      expect(error.toJSON()).toEqual({
        error: {
          code,
          message: "Safe explanation.",
          details: {
            source: "boa",
            accounting_month: "2026-04",
            rooftop_profile_id: "acura-v1",
            recovery: "Correct the source and upload it again.",
          },
        },
      });
    },
  );
});
