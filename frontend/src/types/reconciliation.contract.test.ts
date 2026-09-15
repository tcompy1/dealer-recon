import { describe, expect, test } from "vitest";

import type {
  ReconciledTransaction,
  ReconciliationRunDetailException,
} from "./reconciliation";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

type AmountMatchesServer = Expect<Equal<ReconciledTransaction["amount"], string>>;
type TransactionDealershipMatchesServer = Expect<
  Equal<Pick<ReconciledTransaction, "dealership_id">, { dealership_id: number }>
>;
type ExceptionDealershipMatchesServer = Expect<
  Equal<Pick<ReconciliationRunDetailException, "dealership_id">, { dealership_id: number }>
>;
const serverTypeAssertions: [
  AmountMatchesServer,
  TransactionDealershipMatchesServer,
  ExceptionDealershipMatchesServer,
] = [true, true, true];

describe("reconciliation response type contract", () => {
  test("requires the server dealership identity and decimal amount fields", () => {
    const transaction: ReconciledTransaction = {
      id: 11,
      dealership_id: 7,
      source_type: "boa",
      transaction_date: "2026-04-30",
      post_date: null,
      amount: "123.45",
      amount_cents: 12345,
      reference_number: "REF-11",
      description: "Synthetic contract row",
      account: "324",
      stock_number: "STK-11",
      vin: null,
    };
    const exception: ReconciliationRunDetailException = {
      exception_id: 9,
      dealership_id: 7,
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
      reason: "Synthetic contract exception",
      created_at: "2026-04-30T00:00:00.000Z",
      transaction,
    };

    expect(exception.dealership_id).toBe(7);
    expect(exception.transaction.amount).toBe("123.45");
    expect(serverTypeAssertions).toEqual([true, true, true]);
  });
});
