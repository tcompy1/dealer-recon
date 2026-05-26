import { describe, expect, test } from "vitest";

import type {
  ReconciliationRunDetail,
  ReconciliationRunInputSnapshot,
  Transaction,
} from "../domain/types.js";
import { replaySnapshot } from "./reconciliationReplay.js";

describe("replaySnapshot", () => {
  test("reports deterministic replay deltas when persisted results differ", () => {
    const detail = runDetail({
      matched_count: 0,
      exception_count: 1,
      exceptions: [
        {
          ...exception(boaTransaction()),
          exception_id: 1,
        },
      ],
    });
    const snapshot = snapshotWithTransactions([boaTransaction()], [dealertrackTransaction()]);

    const replay = replaySnapshot(detail, snapshot);

    expect(replay.results_changed).toBe(true);
    expect(replay.matched_count_delta).toBe(1);
    expect(replay.exception_count_delta).toBe(-1);
    expect(replay.newly_matched).toEqual([
      "boa|101|JM1NDAM72T0702171|REF101|M30101|120000",
    ]);
    expect(replay.newly_unmatched).toEqual([]);
  });

  test("reports parser and engine version differences without reparsing source files", () => {
    const detail = runDetail();
    const snapshot = snapshotWithTransactions([boaTransaction()], [dealertrackTransaction()], {
      engineVersion: "legacy-engine",
      parserVersion: "legacy-parser",
    });

    const replay = replaySnapshot(detail, snapshot);

    expect(replay.engine_version_difference).toMatchObject({
      original: "legacy-engine",
      differs: true,
    });
    expect(replay.parser_version_difference).toEqual([
      expect.objectContaining({ side: "boa", original: "legacy-parser", differs: true }),
      expect.objectContaining({ side: "dealertrack", original: "legacy-parser", differs: true }),
    ]);
  });
});

function snapshotWithTransactions(
  boaTransactions: Transaction[],
  dealertrackTransactions: Transaction[],
  versions: { engineVersion?: string; parserVersion?: string } = {},
): ReconciliationRunInputSnapshot {
  return {
    reconciliation_run_id: 1,
    engine_version: versions.engineVersion ?? "reconciliation-engine-v1",
    inputs: [
      {
        side: "boa",
        source_type: "boa",
        source_file_id: 11,
        parser_version: versions.parserVersion ?? "transaction-normalizer-v1",
        parser_metadata: { source_type: "boa" },
        transactions: boaTransactions,
      },
      {
        side: "dealertrack",
        source_type: "dealertrack",
        source_file_id: 12,
        parser_version: versions.parserVersion ?? "transaction-normalizer-v1",
        parser_metadata: { source_type: "dealertrack" },
        transactions: dealertrackTransactions,
      },
    ],
  };
}

function runDetail(overrides: Partial<ReconciliationRunDetail> = {}): ReconciliationRunDetail {
  return {
    reconciliation_run_id: 1,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Mazda of Hurst",
    dealer_group_id: 1,
    dealer_group_name: "Hiley Mazda Group",
    boa_source_file_id: 11,
    dealertrack_source_file_id: 12,
    boa_filename: "boa.csv",
    dealertrack_filename: "dealertrack.csv",
    matched_count: 1,
    exception_count: 0,
    duplicate_count: 0,
    status: "completed",
    created_at: "2026-05-14T00:00:00.000Z",
    boa_source_file: sourceFile("boa"),
    dealertrack_source_file: sourceFile("dealertrack"),
    match_groups: [],
    exceptions: [],
    ...overrides,
  };
}

function sourceFile(sourceType: "boa" | "dealertrack") {
  return {
    source_file_id: sourceType === "boa" ? 11 : 12,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Mazda of Hurst",
    source_type: sourceType,
    filename: `${sourceType}.csv`,
    row_count: 1,
    validation_error_count: 0,
    created_at: "2026-05-14T00:00:00.000Z",
  };
}

function exception(transaction: Transaction): ReconciliationRunDetail["exceptions"][number] {
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
    source_type: transaction.source_type,
    reason: "BOA transaction has no matching dealertrack transaction.",
    created_at: "2026-05-14T00:00:00.000Z",
    transaction: {
      id: transaction.id,
      dealership_id: transaction.dealership_id,
      source_type: transaction.source_type,
      transaction_date: transaction.transaction_date,
      post_date: transaction.post_date,
      amount: "1200.00",
      amount_cents: transaction.amount_cents,
      reference_number: transaction.reference_number,
      description: transaction.description,
      account: transaction.account,
      account_type: transaction.account_type,
      account_identifier: transaction.account_identifier,
      stock_number: transaction.stock_number,
      vin: transaction.vin,
    },
  };
}

function boaTransaction(): Transaction {
  return transaction({
    id: 101,
    source_file_id: 11,
    source_type: "boa",
    reference_number: "REF101",
    description: "Floorplan advance",
    stock_number: "M30101",
    vin: "JM1NDAM72T0702171",
  });
}

function dealertrackTransaction(): Transaction {
  return transaction({
    id: 201,
    source_file_id: 12,
    source_type: "dealertrack",
    reference_number: "REF201",
    description: "BOA FLOORPLAN JM1NDAM72T0702171",
    stock_number: "M30101",
    vin: null,
  });
}

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: 1,
    dealership_id: 1,
    source_file_id: 1,
    source_type: "boa",
    transaction_date: "2026-05-14",
    post_date: null,
    amount_cents: 120000,
    reference_number: null,
    description: null,
    account: "floorplan",
    account_type: "floorplan",
    account_identifier: "floorplan",
    stock_number: null,
    vin: null,
    raw_data: {},
    ...overrides,
  };
}
