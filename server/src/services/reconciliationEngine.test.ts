import { describe, expect, test, vi } from "vitest";

import { MemoryTransactionRepository } from "../repositories/transactionRepository.js";
import { reconcileTransactions } from "./reconciliationEngine.js";
import { normalizeTransactionsFromCsv } from "./transactionNormalizer.js";

const boaFloorplanCsv = [
  "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
  '2026-04-28,2026-04-28,"$25,000.00",551240,BOA floorplan advance 551240/M20500 VIN 1FTFW1E80PFA11111,Floorplan Payable,M20500,1FTFW1E80PFA11111',
  '2026-04-29,2026-04-29,"$18,450.00",382882,BOA floorplan advance 382882/M20657 VIN 5NPE24AF7KH700001,Floorplan Payable,M20657,5NPE24AF7KH700001',
  '2026-04-29,2026-04-29,"$21,100.00",708021,BOA floorplan advance 708021/M20450 VIN 3FA6P0H75HR200002,Floorplan Payable,M20450,3FA6P0H75HR200002',
  '2026-04-30,2026-04-30,"$17,750.00",999111,BOA floorplan advance 999111/M20999 VIN 2T3WFREV8HW300003,Floorplan Payable,M20999,2T3WFREV8HW300003',
].join("\n");

const dealertrackFloorplanCsv = [
  'M20500,"BOA FLOORPLAN",-25000,0',
  'M20657,"BOA FLOORPLAN",-18450,0',
  'M20450,"BOA FLOORPLAN",-21100,0',
  'M20450,"BOA FLOORPLAN DUPLICATE",-21100,0',
  'M20888,"BOA FLOORPLAN",-22600,0',
].join("\n");

describe("reconcileTransactions", () => {
  test("matches BOA positive and Dealertrack negative amounts by explicit VIN and absolute amount", async () => {
    const repository = new MemoryTransactionRepository();
    await repository.insertMany(
      normalizeTransactionsFromCsv(
        [
          "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
          '2026-03-23,2026-03-23,"$40,516.00",107718,BOA floorplan,Floorplan Payable,M21330,JM3KMEHA6T0107718',
        ].join("\n"),
        "boa",
      ).transactions,
    );
    await repository.insertMany([
      {
        source_file_id: null,
        source_type: "dealertrack",
        transaction_date: "2026-03-24",
        post_date: null,
        amount_cents: -4051600,
        reference_number: null,
        description: "Dealertrack floorplan",
        account: "Floorplan Payable",
        stock_number: "M99999",
        vin: "JM3KMEHA6T0107718",
        raw_data: {},
      },
    ]);

    const result = await reconcileTransactions(repository);

    expect(result).toMatchObject({
      matched_count: 1,
      exception_count: 0,
      duplicate_count: 0,
    });
    expect(result.match_groups[0]).toMatchObject({
      match_reason: "vin_abs_amount",
      confidence_score: 1,
    });
  });

  test("matches Dealertrack VIN embedded in description by absolute amount", async () => {
    const repository = new MemoryTransactionRepository();
    await repository.insertMany(
      normalizeTransactionsFromCsv(
        [
          "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
          '2026-03-23,2026-03-23,"$30,493.00",112612,BOA floorplan,Floorplan Payable,M20945,3MVDMBCL9TM112612',
        ].join("\n"),
        "boa",
      ).transactions,
    );
    await repository.insertMany([
      {
        source_file_id: null,
        source_type: "dealertrack",
        transaction_date: null,
        post_date: null,
        amount_cents: -3049300,
        reference_number: null,
        description: "2026 MAZDA CX-30 10/27/25 3MVDMBCL9TM112612",
        account: "Floorplan Payable",
        stock_number: "M21473",
        vin: null,
        raw_data: {},
      },
    ]);

    const result = await reconcileTransactions(repository);

    expect(result).toMatchObject({
      matched_count: 1,
      exception_count: 0,
      duplicate_count: 0,
    });
    expect(result.match_groups[0]).toMatchObject({
      match_reason: "derived_vin_abs_amount",
      confidence_score: 0.98,
    });
    expect(result.vin_presence_diagnostics.extracted_vin_sets.dealertrack).toEqual([
      {
        vin: "3MVDMBCL9TM112612",
        stored_vin_count: 0,
        extracted_vin_count: 1,
        transaction_ids: [2],
      },
    ]);
  });

  test("does not auto-match by stock and amount alone when no VIN6 is available", async () => {
    const repository = new MemoryTransactionRepository();
    await repository.insertMany(
      normalizeTransactionsFromCsv(
        [
          "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
          '2026-03-23,2026-03-23,"$31,051.00",116411,BOA floorplan,Floorplan Payable,M21055,',
        ].join("\n"),
        "boa",
      ).transactions,
    );
    await repository.insertMany(
      normalizeTransactionsFromCsv('M21055,"BOA FLOORPLAN",-31051,0', "dealertrack")
        .transactions,
    );

    const result = await reconcileTransactions(repository);

    expect(result.matched_count).toBe(0);
    expect(result.match_groups).toHaveLength(0);
    expect(result.exceptions).toHaveLength(2);
    expect(result.exceptions.map((exception) => exception.exception_type).sort()).toEqual([
      "missing_in_boa",
      "missing_in_dealertrack",
    ]);
    expect(result.exceptions.map((exception) => exception.exception_category).sort()).toEqual([
      "missing_in_boa",
      "missing_in_dealertrack",
    ]);
  });

  test("reserves high-confidence identity matches before weak amount context fallback", async () => {
    const repository = new MemoryTransactionRepository();
    await repository.insertMany(
      normalizeTransactionsFromCsv(
        [
          "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
          '2026-03-01,2026-03-01,"$31,020.00",WEAK-1,BOA FLOORPLAN CX30 shared context,Floorplan Payable,M21000,3MVDMBCL1TM000001',
          '2026-03-03,2026-03-03,"$31,020.00",STRONG-1,BOA floorplan exact unit,Floorplan Payable,M21408,3MVDMBCL5TM139404',
        ].join("\n"),
        "boa",
      ).transactions,
    );
    await repository.insertMany([
      {
        source_file_id: null,
        source_type: "dealertrack",
        transaction_date: "2026-03-02",
        post_date: null,
        amount_cents: -3102000,
        reference_number: null,
        description: "BOA FLOORPLAN CX30 3/02/26 3MVDMBCL5TM139404",
        account: "Floorplan Payable",
        stock_number: "M21408",
        vin: null,
        raw_data: {},
      },
    ]);

    const result = await reconcileTransactions(repository);

    expect(result).toMatchObject({
      matched_count: 1,
      exception_count: 1,
      duplicate_count: 0,
    });
    expect(result.match_groups[0]).toMatchObject({
      match_reason: "derived_vin_abs_amount",
    });
    expect(result.match_groups[0].transactions[0]).toMatchObject({
      reference_number: "STRONG-1",
      vin: "3MVDMBCL5TM139404",
    });
    expect(result.exceptions).toEqual([
      expect.objectContaining({
        exception_type: "missing_in_dealertrack",
        transaction: expect.objectContaining({
          reference_number: "WEAK-1",
          vin: "3MVDMBCL1TM000001",
        }),
      }),
    ]);
    expect(result.vin_presence_diagnostics.transaction_unmatched_shared_vins).toEqual([]);
  });

  test("reports VIN-presence diagnostics separately from transaction amount matching", async () => {
    const repository = new MemoryTransactionRepository();
    await repository.insertMany(
      normalizeTransactionsFromCsv(
        [
          "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
          '2026-03-23,2026-03-23,"$100.00",AMT-1,BOA floorplan,Floorplan Payable,M50001,1FTFW1E80PFA11111',
        ].join("\n"),
        "boa",
      ).transactions,
    );
    await repository.insertMany([
      {
        source_file_id: null,
        source_type: "dealertrack",
        transaction_date: null,
        post_date: null,
        amount_cents: -20000,
        reference_number: null,
        description: "BOA FLOORPLAN 1FTFW1E80PFA11111",
        account: "Floorplan Payable",
        stock_number: "M50001",
        vin: null,
        raw_data: {},
      },
    ]);

    const result = await reconcileTransactions(repository);

    expect(result).toMatchObject({
      matched_count: 0,
      exception_count: 2,
      duplicate_count: 0,
    });
    expect(result.vin_presence_diagnostics.vin_presence_exceptions).toEqual({
      dealertrack_not_in_boa: [],
      boa_not_in_dealertrack: [],
    });
    expect(result.vin_presence_diagnostics.transaction_unmatched_shared_vins).toEqual([
      {
        vin: "1FTFW1E80PFA11111",
        likely_reason: "amount_mismatch",
        boa_transaction_ids: [1],
        dealertrack_transaction_ids: [2],
        unmatched_boa_transaction_ids: [1],
        unmatched_dealertrack_transaction_ids: [2],
      },
    ]);
  });

  test("reports manual Hiley DT-only VIN universe before transaction matching", async () => {
    const repository = new MemoryTransactionRepository();
    const manualDealertrackOnlyVins = [
      "7MMVABCYXTN476280",
      "JM1NDAM72T0702171",
      "JM1NDAM76T0700438",
      "JM1NDAM71T0700847",
      "JM1NDAD70T0700998",
      "7MMVABDL6TN486632",
      "7MMVABALXTN487349",
    ];

    await repository.insertMany(
      normalizeTransactionsFromCsv(
        [
          "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
          '2026-03-23,2026-03-23,"$25,000.00",551240,BOA floorplan,Floorplan Payable,M20500,1FTFW1E80PFA11111',
        ].join("\n"),
        "boa",
      ).transactions,
    );
    await repository.insertMany(
      manualDealertrackOnlyVins.map((vin, index) => ({
        source_file_id: null,
        source_type: "dealertrack" as const,
        transaction_date: null,
        post_date: null,
        amount_cents: -10000 - index,
        reference_number: null,
        description: `HILEY FLOORPLAN ${vin}`,
        account: "Floorplan Payable",
        stock_number: `M90${String(index).padStart(3, "0")}`,
        vin: null,
        raw_data: {},
      })),
    );

    const result = await reconcileTransactions(repository);

    expect(result.vin_presence_diagnostics.vin_presence_exceptions.dealertrack_not_in_boa).toEqual(
      [...manualDealertrackOnlyVins].sort(),
    );
    expect(result.vin_presence_diagnostics.extracted_vin_sets.dealertrack.map((entry) => entry.vin)).toEqual(
      [...manualDealertrackOnlyVins].sort(),
    );
    expect(
      result.vin_presence_diagnostics.extracted_vin_sets.dealertrack.every(
        (entry) => entry.stored_vin_count === 0 && entry.extracted_vin_count === 1,
      ),
    ).toBe(true);
  });

  test("does not emit duplicate business exceptions for amount-only repeated values across different units", async () => {
    const repository = new MemoryTransactionRepository();
    await repository.insertMany(
      normalizeTransactionsFromCsv(
        [
          "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
          '2026-03-23,2026-03-23,"$31,051.00",116411,BOA floorplan CX-30,Floorplan Payable,M21055,3MVDMBCL8TM116411',
        ].join("\n"),
        "boa",
      ).transactions,
    );
    await repository.insertMany([
      {
        source_file_id: null,
        source_type: "dealertrack",
        transaction_date: "2026-03-23",
        post_date: null,
        amount_cents: -3105100,
        reference_number: null,
        description: "BOA FLOORPLAN CX-30 FIRST DIFFERENT VIN 3MVDMBCL8TM116411",
        account: "Floorplan Payable",
        stock_number: "M21055",
        vin: null,
        raw_data: {},
      },
      {
        source_file_id: null,
        source_type: "dealertrack",
        transaction_date: "2026-03-23",
        post_date: null,
        amount_cents: -3105100,
        reference_number: null,
        description: "BOA FLOORPLAN CX-30 SECOND DIFFERENT VIN 3MVDMBXL6TM128759",
        account: "Floorplan Payable",
        stock_number: "M21286",
        vin: null,
        raw_data: {},
      },
    ]);

    const result = await reconcileTransactions(repository);

    expect(result.duplicate_count).toBe(0);
    expect(result.exceptions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exception_type: "duplicate_transaction" }),
      ]),
    );
  });

  test("routes stock-only floorplan rows to Hiley placement instead of auto-confirming", async () => {
    const repository = await loadFloorplanSamples();
    const result = await reconcileTransactions(repository);

    // BOA rows have full VINs but their Dealertrack counterparts do not.
    // Hiley rules do not allow amount/stock-only review explanations, so all
    // rows fall into the two worksheet placements.
    expect(result.matched_count).toBe(0);
    expect(result.duplicate_count).toBe(0);

    expect(result.exceptions).toHaveLength(9);
    expect(
      result.exceptions.every((exception) => exception.exception_type.startsWith("missing_in_")),
    ).toBe(true);
  });

  test("does not emit duplicate business exceptions for stock-only Dealertrack repeats", async () => {
    const repository = await loadFloorplanSamples();
    const result = await reconcileTransactions(repository);
    const duplicateExceptions = result.exceptions.filter(
      (exception) => exception.exception_type === "duplicate_transaction",
    );

    expect(result.duplicate_count).toBe(0);
    expect(duplicateExceptions).toHaveLength(0);
  });

  test("uses strict cent equality with no rounding tolerance", async () => {
    const repository = new MemoryTransactionRepository();
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await repository.insertMany(
      normalizeTransactionsFromCsv(
        [
          "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
          '2026-04-28,2026-04-28,"$100.01",551240,BOA floorplan,Floorplan Payable,M50001,1FTFW1E80PFA11111',
          '2026-04-28,2026-04-28,"$100.02",551241,BOA floorplan,Floorplan Payable,M50002,1FTFW1E80PFA11112',
        ].join("\n"),
        "boa",
      ).transactions,
    );
    await repository.insertMany(
      normalizeTransactionsFromCsv(
        ['M50001,"BOA FLOORPLAN",-100.01,0', 'M50002,"BOA FLOORPLAN",-100.01,0'].join("\n"),
        "dealertrack",
      ).transactions,
    );

    const result = await reconcileTransactions(repository);

    // No auto-match because the Dealertrack rows have no VIN and no 17-char
    // VIN in description. Amount/stock-only links stay as worksheet
    // placements, and one-cent differences must not collapse into a match.
    expect(result.matched_count).toBe(0);

    const missing = result.exceptions.filter((exception) =>
      exception.exception_type.startsWith("missing_in_"),
    );
    expect(missing.map((exception) => exception.transaction.stock_number).sort()).toEqual([
      "M50001",
      "M50001",
      "M50002",
      "M50002",
    ]);
    stderr.mockRestore();
  });

  test("puts every transaction in exactly one reconciliation bucket", async () => {
    const repository = await loadFloorplanSamples();
    const transactions = [
      ...(await repository.listBySource(1, "boa")),
      ...(await repository.listBySource(1, "dealertrack")),
    ];
    const result = await reconcileTransactions(repository);
    const bucketCounts = new Map<number, number>();

    for (const group of result.match_groups) {
      for (const transaction of group.transactions) {
        bucketCounts.set(transaction.id, (bucketCounts.get(transaction.id) ?? 0) + 1);
      }
    }
    for (const exception of result.exceptions) {
      bucketCounts.set(exception.transaction.id, (bucketCounts.get(exception.transaction.id) ?? 0) + 1);
    }

    expect(bucketCounts.size).toBe(transactions.length);
    expect([...bucketCounts.values()].every((count) => count === 1)).toBe(true);
  });

  test("amount-mismatch pair: VIN6 matches but amounts differ -> two exceptions, never merged", async () => {
    // April ground-truth case: BOA shows $32,283 for JM1BPBLL0T1870612, but the
    // Dealertrack 2100 entry for the same VIN is -$31,771 (a $512 curtailment
    // delta). The clerk does NOT merge these onto one matched row - each side is
    // surfaced as its own exception.
    const repository = new MemoryTransactionRepository();
    await repository.insertMany(
      normalizeTransactionsFromCsv(
        [
          "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
          '2026-04-30,2026-04-30,"$32,283.00",,2026 Mazda M3H CE XA,Floorplan Payable,,JM1BPBLL0T1870612',
        ].join("\n"),
        "boa",
      ).transactions,
    );
    await repository.insertMany([
      {
        source_file_id: null,
        source_type: "dealertrack",
        transaction_date: "2026-03-11",
        post_date: null,
        amount_cents: -3177100,
        reference_number: "M21326",
        description: "2026 MAZDA MAZDA3 HAT   3/11/26  JM1BPBLL0T1870612",
        account: "Floorplan Payable",
        stock_number: null,
        vin: null,
        raw_data: {},
      },
    ]);

    const result = await reconcileTransactions(repository);

    // Must NOT be classified as matched.
    expect(result.matched_count).toBe(0);
    expect(result.match_groups).toHaveLength(0);

    // Exactly one exception for the BOA side and one for the Dealertrack side.
    const boaExceptions = result.exceptions.filter(
      (exception) => exception.source_type === "boa",
    );
    const dealertrackExceptions = result.exceptions.filter(
      (exception) => exception.source_type === "dealertrack",
    );
    expect(boaExceptions).toHaveLength(1);
    expect(dealertrackExceptions).toHaveLength(1);

    // Both sides are tagged as the VIN6-match/amount-mismatch pair so the
    // worksheet can link them while keeping them on separate rows.
    expect(boaExceptions[0].exception_type).toBe("needs_review_vin6_only");
    expect(boaExceptions[0].exception_category).toBe("vin6_match_amount_mismatch");
    expect(dealertrackExceptions[0].exception_type).toBe("needs_review_vin6_only");
    expect(dealertrackExceptions[0].exception_category).toBe("vin6_match_amount_mismatch");

    // The amounts are preserved unmodified - nothing is collapsed.
    expect(boaExceptions[0].transaction.amount_cents).toBe(3228300);
    expect(dealertrackExceptions[0].transaction.amount_cents).toBe(-3177100);
  });
});

async function loadFloorplanSamples() {
  const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const repository = new MemoryTransactionRepository();
  await repository.insertMany(normalizeTransactionsFromCsv(boaFloorplanCsv, "boa").transactions);
  await repository.insertMany(
    normalizeTransactionsFromCsv(dealertrackFloorplanCsv, "dealertrack").transactions,
  );
  stderr.mockRestore();
  return repository;
}
