import { describe, expect, test } from "vitest";

import type { ReconciliationException, TransactionSummary } from "../domain/types.js";
import { categorizeReconciliationException } from "./exceptionCategorizer.js";

describe("categorizeReconciliationException", () => {
  test("classifies Dealertrack-only rows as missing in BOA when no counterpart exists", () => {
    expect(
      category(
        exception("missing_in_boa", dealertrackTransaction({ vin: "1FTFW1E80PFA11111" })),
        [],
        [],
      ),
    ).toBe("missing_in_boa");
  });

  test("classifies BOA-only rows as missing in Dealertrack when no counterpart exists", () => {
    expect(
      category(
        exception("missing_in_dealertrack", boaTransaction({ vin: "1FTFW1E80PFA11111" })),
        [],
        [],
      ),
    ).toBe("missing_in_dealertrack");
  });

  test("classifies shared VIN exceptions with different amounts as amount mismatch", () => {
    const boa = boaTransaction({ amount_cents: 10_000, vin: "1FTFW1E80PFA11111" });
    const dealertrack = dealertrackTransaction({
      amount_cents: -20_000,
      vin: "1FTFW1E80PFA11111",
    });

    expect(category(exception("missing_in_dealertrack", boa), [boa], [dealertrack])).toBe(
      "amount_mismatch",
    );
  });

  test("classifies same signed shared VIN amounts as sign mismatch", () => {
    const boa = boaTransaction({ amount_cents: 10_000, vin: "1FTFW1E80PFA11111" });
    const dealertrack = dealertrackTransaction({
      amount_cents: 10_000,
      vin: "1FTFW1E80PFA11111",
    });

    expect(category(exception("missing_in_dealertrack", boa), [boa], [dealertrack])).toBe(
      "sign_mismatch",
    );
  });

  test("classifies duplicate exceptions as duplicate or one-to-many", () => {
    expect(
      category(
        exception("duplicate_transaction", dealertrackTransaction({ vin: "1FTFW1E80PFA11111" })),
        [],
        [],
      ),
    ).toBe("duplicate_or_one_to_many");
  });

  test("classifies repeated same-side VIN amount structure as duplicate or one-to-many", () => {
    const boa = boaTransaction({ id: 1, amount_cents: 10_000, vin: "1FTFW1E80PFA11111" });
    const secondBoa = boaTransaction({ id: 2, amount_cents: 10_000, vin: "1FTFW1E80PFA11111" });
    const dealertrack = dealertrackTransaction({
      amount_cents: -20_000,
      vin: "1FTFW1E80PFA11111",
    });

    expect(category(exception("missing_in_dealertrack", boa), [boa, secondBoa], [dealertrack])).toBe(
      "duplicate_or_one_to_many",
    );
  });

  test("classifies shared VIN absolute-amount rows with different stocks as stock mismatch", () => {
    const boa = boaTransaction({
      amount_cents: 10_000,
      stock_number: "M10001",
      vin: "1FTFW1E80PFA11111",
    });
    const dealertrack = dealertrackTransaction({
      amount_cents: -10_000,
      stock_number: "M20002",
      vin: "1FTFW1E80PFA11111",
    });

    expect(category(exception("missing_in_dealertrack", boa), [boa], [dealertrack])).toBe(
      "stock_number_mismatch",
    );
  });

  test("classifies missing VIN rows with stock and amount counterpart as VIN missing but reference match", () => {
    const boa = boaTransaction({ amount_cents: 10_000, stock_number: "M10001", vin: null });
    const dealertrack = dealertrackTransaction({
      amount_cents: -10_000,
      stock_number: "M10001",
      vin: "1FTFW1E80PFA11111",
    });

    expect(category(exception("missing_in_dealertrack", boa), [boa], [dealertrack])).toBe(
      "vin_missing_but_reference_match",
    );
  });

  test("classifies nearby shared VIN rows with different amounts as possible timing issue", () => {
    const boa = boaTransaction({
      amount_cents: 10_000,
      transaction_date: "2026-03-01",
      vin: "1FTFW1E80PFA11111",
    });
    const dealertrack = dealertrackTransaction({
      amount_cents: -20_000,
      transaction_date: "2026-03-15",
      vin: "1FTFW1E80PFA11111",
    });

    expect(category(exception("missing_in_dealertrack", boa), [boa], [dealertrack])).toBe(
      "possible_timing_issue",
    );
  });

  test("falls back to unclassified when exception shape is unknown", () => {
    expect(category(exception("unexpected", boaTransaction({ vin: null })), [], [])).toBe(
      "unclassified",
    );
  });
});

function category(
  reconciliationException: ReconciliationException,
  boaTransactions: TransactionSummary[],
  dealertrackTransactions: TransactionSummary[],
) {
  return categorizeReconciliationException(reconciliationException, {
    boaTransactions,
    dealertrackTransactions,
  });
}

function exception(
  exceptionType: string,
  transaction: TransactionSummary,
): ReconciliationException {
  return {
    exception_type: exceptionType,
    exception_category: "unclassified",
    source_type: transaction.source_type,
    transaction,
    description: "diagnostic test exception",
  };
}

function boaTransaction(overrides: Partial<TransactionSummary>): TransactionSummary {
  return transaction({
    id: 1,
    source_type: "boa",
    amount_cents: 10_000,
    amount: "100.00",
    stock_number: "M10001",
    vin: "1FTFW1E80PFA11111",
    ...overrides,
  });
}

function dealertrackTransaction(overrides: Partial<TransactionSummary>): TransactionSummary {
  return transaction({
    id: 101,
    source_type: "dealertrack",
    amount_cents: -10_000,
    amount: "-100.00",
    stock_number: "M10001",
    vin: "1FTFW1E80PFA11111",
    ...overrides,
  });
}

function transaction(overrides: Partial<TransactionSummary>): TransactionSummary {
  return {
    id: 1,
    dealership_id: 1,
    source_type: "boa",
    transaction_date: "2026-03-01",
    post_date: null,
    amount: "100.00",
    amount_cents: 10_000,
    reference_number: null,
    description: null,
    account: null,
    account_type: "floorplan",
    account_identifier: "floorplan",
    stock_number: null,
    vin: null,
    ...overrides,
  };
}
