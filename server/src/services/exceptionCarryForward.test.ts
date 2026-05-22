import { describe, expect, test } from "vitest";

import {
  applyCarryForwardToDetail,
  buildCarryForwardKey,
  computeCarryForward,
  groupPriorExceptionsByKey,
  type PriorExceptionRecord,
} from "./exceptionCarryForward.js";
import type { ReconciliationRunDetail } from "../domain/types.js";

function detailFixture(
  overrides: Partial<ReconciliationRunDetail> = {},
): ReconciliationRunDetail {
  return {
    reconciliation_run_id: 10,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Mazda of Hurst",
    dealer_group_id: 1,
    dealer_group_name: "Hiley Mazda Group",
    boa_source_file_id: 1,
    dealertrack_source_file_id: 2,
    boa_filename: "boa.csv",
    dealertrack_filename: "dt.xml",
    matched_count: 0,
    exception_count: 0,
    duplicate_count: 0,
    status: "completed",
    created_at: "2026-05-22T00:00:00.000Z",
    boa_source_file: {
      source_file_id: 1,
      dealership_id: 1,
      dealership_store_id: 1,
      store_name: "Hiley Mazda of Hurst",
      source_type: "boa",
      filename: "boa.csv",
      row_count: 0,
      validation_error_count: 0,
      created_at: "2026-05-22T00:00:00.000Z",
    },
    dealertrack_source_file: {
      source_file_id: 2,
      dealership_id: 1,
      dealership_store_id: 1,
      store_name: "Hiley Mazda of Hurst",
      source_type: "dealertrack",
      filename: "dt.xml",
      row_count: 0,
      validation_error_count: 0,
      created_at: "2026-05-22T00:00:00.000Z",
    },
    match_groups: [],
    exceptions: [],
    ...overrides,
  };
}

function exceptionFixture(
  partial: Partial<ReconciliationRunDetail["exceptions"][number]>,
): ReconciliationRunDetail["exceptions"][number] {
  return {
    exception_id: 1,
    dealership_id: 1,
    exception_type: "missing_in_dealertrack",
    exception_category: "missing_in_dealertrack",
    status: "unresolved",
    note: "",
    review_status: "unreviewed",
    assigned_to: null,
    review_notes: "",
    boa_notes: "",
    gl_notes: "",
    reviewed_at: null,
    reviewed_by: null,
    source_type: "boa",
    reason: "BOA-only transaction.",
    created_at: "2026-05-22T00:00:00.000Z",
    transaction: {
      id: 100,
      dealership_id: 1,
      source_type: "boa",
      transaction_date: "2026-05-01",
      post_date: null,
      amount: "5000.00",
      amount_cents: 500_000,
      reference_number: null,
      description: "2024 FORD F150 1FTFW1E80PFA11111",
      account: null,
      stock_number: "M12345",
      vin: "1FTFW1E80PFA11111",
    },
    ...partial,
  };
}

function priorFixture(partial: Partial<PriorExceptionRecord>): PriorExceptionRecord {
  return {
    exception_id: 1,
    reconciliation_run_id: 5,
    dealership_store_id: 1,
    source_type: "boa",
    amount_cents: 500_000,
    vin: "1FTFW1E80PFA11111",
    stock_number: "M12345",
    reference_number: null,
    description: "2024 FORD F150",
    boa_notes: "",
    gl_notes: "",
    review_notes: "",
    created_at: "2026-04-01T00:00:00.000Z",
    ...partial,
  };
}

describe("buildCarryForwardKey", () => {
  test("uses VIN6 + amount + store + side", () => {
    const a = buildCarryForwardKey({
      dealership_store_id: 1,
      source_type: "boa",
      vin: "1FTFW1E80PFA11111",
      stock_number: null,
      reference_number: null,
      description: null,
      amount_cents: 100,
    });
    const b = buildCarryForwardKey({
      dealership_store_id: 1,
      source_type: "boa",
      vin: "ZZZFW1E80PFA11111",
      stock_number: null,
      reference_number: null,
      description: null,
      amount_cents: 100,
    });
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });

  test("never matches across stores", () => {
    const a = buildCarryForwardKey({
      dealership_store_id: 1,
      source_type: "boa",
      vin: "1FTFW1E80PFA11111",
      stock_number: null,
      reference_number: null,
      description: null,
      amount_cents: 100,
    });
    const b = buildCarryForwardKey({
      dealership_store_id: 2,
      source_type: "boa",
      vin: "1FTFW1E80PFA11111",
      stock_number: null,
      reference_number: null,
      description: null,
      amount_cents: 100,
    });
    expect(a).not.toEqual(b);
  });

  test("never matches across sides", () => {
    const a = buildCarryForwardKey({
      dealership_store_id: 1,
      source_type: "boa",
      vin: "1FTFW1E80PFA11111",
      stock_number: null,
      reference_number: null,
      description: null,
      amount_cents: 100,
    });
    const b = buildCarryForwardKey({
      dealership_store_id: 1,
      source_type: "dealertrack",
      vin: "1FTFW1E80PFA11111",
      stock_number: null,
      reference_number: null,
      description: null,
      amount_cents: 100,
    });
    expect(a).not.toEqual(b);
  });

  test("falls back to stock number when VIN is missing", () => {
    const key = buildCarryForwardKey({
      dealership_store_id: 1,
      source_type: "boa",
      vin: null,
      stock_number: "M12345",
      reference_number: null,
      description: null,
      amount_cents: 100,
    });
    expect(key).toMatch(/stock:M12345/);
  });

  test("returns null when no identifier is available", () => {
    const key = buildCarryForwardKey({
      dealership_store_id: 1,
      source_type: "boa",
      vin: null,
      stock_number: null,
      reference_number: null,
      description: null,
      amount_cents: 100,
    });
    expect(key).toBeNull();
  });
});

describe("computeCarryForward", () => {
  test("marks not carried forward when no prior matches", () => {
    const exception = exceptionFixture({});
    const priorsByKey = groupPriorExceptionsByKey([]);
    const result = computeCarryForward(exception, 1, priorsByKey);
    expect(result.carried_forward).toBe(false);
    expect(result.previous_run_id).toBeNull();
    expect(result.occurrence_count).toBe(1);
  });

  test("links prior unresolved exception by VIN6 + amount + store + side", () => {
    const exception = exceptionFixture({});
    const priors = [
      priorFixture({
        exception_id: 7,
        reconciliation_run_id: 5,
        boa_notes: "April: rep promised to mail check",
        created_at: "2026-04-01T00:00:00.000Z",
      }),
      priorFixture({
        exception_id: 8,
        reconciliation_run_id: 6,
        boa_notes: "May 1: still waiting on title",
        created_at: "2026-05-01T00:00:00.000Z",
      }),
    ];
    const priorsByKey = groupPriorExceptionsByKey(priors);
    const result = computeCarryForward(exception, 1, priorsByKey);
    expect(result.carried_forward).toBe(true);
    expect(result.previous_run_id).toBe(6);
    expect(result.first_seen_run_id).toBe(5);
    expect(result.occurrence_count).toBe(3);
    expect(result.prior_boa_notes).toContain("April:");
    expect(result.prior_boa_notes).toContain("May 1:");
    expect(result.prior_gl_notes).toBe("");
  });

  test("does not cross-link different stores", () => {
    const exception = exceptionFixture({});
    const priors = [
      priorFixture({
        dealership_store_id: 2,
        boa_notes: "different store",
      }),
    ];
    const priorsByKey = groupPriorExceptionsByKey(priors);
    const result = computeCarryForward(exception, 1, priorsByKey);
    expect(result.carried_forward).toBe(false);
  });
});

describe("applyCarryForwardToDetail", () => {
  test("attaches carry_forward to each exception", () => {
    const detail = detailFixture({
      exceptions: [
        exceptionFixture({}),
        exceptionFixture({
          exception_id: 2,
          source_type: "dealertrack",
          transaction: {
            id: 200,
            dealership_id: 1,
            source_type: "dealertrack",
            transaction_date: null,
            post_date: null,
            amount: "1000.00",
            amount_cents: 100_000,
            reference_number: null,
            description: "DT row no VIN",
            account: null,
            stock_number: "M99999",
            vin: null,
          },
        }),
      ],
    });
    const priors = [
      priorFixture({
        boa_notes: "carried note",
      }),
    ];
    const enriched = applyCarryForwardToDetail(detail, priors);
    expect(enriched.exceptions[0].carry_forward?.carried_forward).toBe(true);
    expect(enriched.exceptions[0].carry_forward?.prior_boa_notes).toBe("carried note");
    expect(enriched.exceptions[1].carry_forward?.carried_forward).toBe(false);
  });
});
