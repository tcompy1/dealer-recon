import { describe, expect, test } from "vitest";

import { ValidationError as HttpValidationError } from "../errors/HttpError.js";
import { rooftopValidationError } from "./rooftopValidation.js";

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
});
