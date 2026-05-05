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
  test("matches stock number patterns and detects duplicates", async () => {
    const repository = await loadFloorplanSamples();
    const result = await reconcileTransactions(repository);

    expect(result.matched_count).toBe(3);
    expect(result.exception_count).toBe(3);
    expect(result.duplicate_count).toBe(1);

    const stockMatches = result.match_groups.filter(
      (group) => group.match_reason === "stock_number_amount",
    );
    expect(stockMatches).toHaveLength(3);
    expect(
      stockMatches.map((group) => [
        group.transactions[0].reference_number,
        group.transactions[0].stock_number,
        group.transactions[1].stock_number,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["382882", "M20657", "M20657"],
        ["708021", "M20450", "M20450"],
      ]),
    );
  });

  test("proves VIN-only matching would fail for stock-number-only Dealertrack rows", async () => {
    const repository = await loadFloorplanSamples();
    const result = await reconcileTransactions(repository);
    const stockMatches = result.match_groups.filter(
      (group) => group.match_reason === "stock_number_amount",
    );

    expect(stockMatches).toHaveLength(3);
    expect(stockMatches.every((group) => group.transactions[1].vin === null)).toBe(true);
  });

  test("detects duplicate Dealertrack entry", async () => {
    const repository = await loadFloorplanSamples();
    const result = await reconcileTransactions(repository);
    const duplicateExceptions = result.exceptions.filter(
      (exception) => exception.exception_type === "duplicate_transaction",
    );

    expect(result.duplicate_count).toBe(1);
    expect(duplicateExceptions).toHaveLength(1);
    expect(duplicateExceptions[0].source_type).toBe("dealertrack");
    expect(duplicateExceptions[0].transaction.stock_number).toBe("M20450");
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

    expect(result.matched_count).toBe(1);
    expect(result.match_groups[0].transactions.map((transaction) => transaction.amount_cents)).toEqual([
      10001,
      -10001,
    ]);
    expect(result.exceptions.map((exception) => exception.transaction.stock_number)).toEqual(
      expect.arrayContaining(["M50002"]),
    );
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
