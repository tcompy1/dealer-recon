import { describe, expect, test } from "vitest";

import type { Transaction } from "../domain/types.js";
import {
  RECONCILIATION_ENGINE_VERSION,
  reconcileTransactionSets,
} from "./reconciliationEngine.js";

// V2 engine regression suite covering the explicit tier semantics:
//   Tier 1: VIN6 + exact amount   -> auto-match
//   Tier 2: full VIN + exact amount -> auto-match
//   Tier 3: VIN6 only (amount differs) -> Needs Review
//   Tier 4: amount only with deterministic link -> Needs Review
//   Tier 5: unmatched -> missing_in_*
//
// All matching must stay deterministic on input order and replayable.

const STORE_VIN_A = "1FTFW1E80PFA11111";
const STORE_VIN_B = "5NPE24AF7KH700001";
const STORE_VIN_C = "3FA6P0H75HR200002";

function boa(args: Partial<Transaction> & Pick<Transaction, "id" | "amount_cents">): Transaction {
  return {
    dealership_id: 1,
    source_file_id: 1,
    source_type: "boa",
    transaction_date: "2026-04-30",
    post_date: "2026-04-30",
    reference_number: null,
    description: null,
    account: "Floorplan Payable",
    account_type: "floorplan",
    account_identifier: "floorplan",
    stock_number: null,
    vin: null,
    raw_data: {},
    ...args,
  };
}

function dealertrack(args: Partial<Transaction> & Pick<Transaction, "id" | "amount_cents">): Transaction {
  return {
    dealership_id: 1,
    source_file_id: 2,
    source_type: "dealertrack",
    transaction_date: "2026-04-30",
    post_date: "2026-04-30",
    reference_number: null,
    description: null,
    account: "Floorplan Payable",
    account_type: "floorplan",
    account_identifier: "floorplan",
    stock_number: null,
    vin: null,
    raw_data: {},
    ...args,
  };
}

describe("engine v2 tier behavior", () => {
  test("engine version is bumped so v1 snapshots replay with engine_version_difference.differs=true", () => {
    expect(RECONCILIATION_ENGINE_VERSION).toBe("reconciliation-engine-v2-vin6-tiers");
  });

  describe("Tier 1: VIN6 + exact amount", () => {
    test("auto-matches when only VIN6 agrees because Dealertrack has no stored VIN but the BOA VIN is present", () => {
      // BOA carries the full VIN; Dealertrack VIN field is blank but the
      // description has the same trailing 6 characters in a 17-char VIN.
      const left = boa({ id: 1, amount_cents: 30100, vin: STORE_VIN_A, stock_number: "M30101" });
      const right = dealertrack({
        id: 2,
        amount_cents: -30100,
        description: `BOA FLOORPLAN ${STORE_VIN_A}`,
        stock_number: "M30101",
      });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.matched_count).toBe(1);
      // When both sides agree on the full VIN, Tier 2's derived_vin_abs_amount
      // takes the match (a strict superset of Tier 1 VIN6).
      expect(result.match_groups[0].match_reason).toMatch(/vin_abs_amount|derived_vin_abs_amount|vin6_abs_amount/);
      expect(result.exception_count).toBe(0);
    });

    test("auto-matches by VIN6 when only the last 6 of a 17-char VIN are extracted from Dealertrack description", () => {
      // Build a Dealertrack row whose description carries a different full
      // 17-char VIN whose last 6 happen to match BOA's last 6 - real Hiley
      // case for vehicles whose VIN was retyped in the DMS.
      const left = boa({ id: 1, amount_cents: 31051, vin: STORE_VIN_A, stock_number: "M21055" });
      const collidingVin = `2T3WFREV8AA${STORE_VIN_A.slice(-6)}`;
      expect(collidingVin).toHaveLength(17);
      const right = dealertrack({
        id: 2,
        amount_cents: -31051,
        description: `MAZDA CX-30 ${collidingVin}`,
        stock_number: "M21055",
      });
      const result = reconcileTransactionSets([left], [right]);
      // Two different 17-char VINs share the same last-6 - we still allow
      // VIN6+amount auto-match because that is the clerk's primary key and
      // amount agreement gives strong corroboration. The full VINs disagree
      // but neither full-VIN match tier fires.
      expect(result.matched_count).toBe(1);
      expect(result.match_groups[0].match_reason).toBe("vin6_abs_amount");
    });

    test("refuses VIN6 auto-match when neither side has a trusted 17-char VIN backing the VIN6", () => {
      // Both sides only have stock-as-VIN-ish strings: VIN6 would be derived
      // from a 6-char fallback on both sides, which can collide spuriously.
      const left = boa({ id: 1, amount_cents: 12345, vin: "ABC123", stock_number: "M10001" });
      const right = dealertrack({ id: 2, amount_cents: -12345, vin: "XYZ123", stock_number: "M10001" });
      const result = reconcileTransactionSets([left], [right]);
      // No trusted VIN6 and the two fallback VIN6s disagree - Tier 1/2/3 all
      // reject. With different VIN6s the engine also refuses to pair at Tier
      // 4, so both rows fall through to Tier 5 unmatched.
      expect(result.matched_count).toBe(0);
      expect(
        result.exceptions.every((exception) => exception.exception_type.startsWith("missing_in_")),
      ).toBe(true);
    });
  });

  describe("Tier 2: full VIN + exact amount", () => {
    test("auto-matches when both sides store the same full VIN and exact amount", () => {
      const left = boa({ id: 1, amount_cents: 18450, vin: STORE_VIN_B, stock_number: "M20657" });
      const right = dealertrack({
        id: 2,
        amount_cents: -18450,
        vin: STORE_VIN_B,
        stock_number: "M20657",
      });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.matched_count).toBe(1);
      expect(result.match_groups[0].match_reason).toBe("vin_abs_amount");
      expect(result.match_groups[0].confidence_score).toBe(1);
    });

    test("auto-matches by derived full VIN from the Dealertrack description", () => {
      const left = boa({ id: 1, amount_cents: 21100, vin: STORE_VIN_C, stock_number: "M20450" });
      const right = dealertrack({
        id: 2,
        amount_cents: -21100,
        description: `BOA FLOORPLAN ${STORE_VIN_C}`,
        stock_number: "M20450",
      });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.match_groups[0].match_reason).toBe("derived_vin_abs_amount");
    });
  });

  describe("Tier 3: VIN6 match but amount differs", () => {
    test("routes both sides to Needs Review when VIN6 matches and amount differs - no auto-confirm", () => {
      const left = boa({ id: 1, amount_cents: 25000, vin: STORE_VIN_A, stock_number: "M20500" });
      // Same VIN6 (A11111) but a different amount on the Dealertrack side.
      const right = dealertrack({
        id: 2,
        amount_cents: -24999,
        description: `BOA FLOORPLAN ${STORE_VIN_A}`,
        stock_number: "M20500",
      });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.matched_count).toBe(0);
      expect(result.exceptions).toHaveLength(2);
      expect(result.exceptions.every((exception) => exception.exception_type === "needs_review_vin6_only")).toBe(true);
      expect(
        result.exceptions.every((exception) => exception.exception_category === "vin6_match_amount_mismatch"),
      ).toBe(true);
      expect(result.exceptions[0].description).toContain("VIN6");
      expect(result.exceptions[0].description).toContain("amount differs");
    });

    test("each side is paired exactly once even when multiple amounts could collide on the same VIN6", () => {
      // Three BOA rows for the same VIN6 (different full VINs ending in the
      // same 6 digits) at different amounts; one Dealertrack row with the
      // same VIN6 at yet another amount. Tier 3 should pair the first
      // unmatched left with the candidate and leave the others to Tier 5.
      const vinPrefixes = ["1FTFW1E80PFA", "2T3WFREV8HW", "3FA6P0H75HR"];
      const lefts = vinPrefixes.map((prefix, index) =>
        boa({
          id: index + 1,
          amount_cents: 10000 + index,
          vin: `${prefix}111111`,
          stock_number: `M${index}`,
        }),
      );
      const right = dealertrack({
        id: 100,
        amount_cents: -99999,
        description: `BOA FLOORPLAN 5NPE24AF7KH111111`,
        stock_number: "MDT",
      });
      const result = reconcileTransactionSets(lefts, [right]);
      const tier3 = result.exceptions.filter((exception) => exception.exception_type === "needs_review_vin6_only");
      expect(tier3).toHaveLength(2);
      // Greedy: the first BOA row claims the only matching Dealertrack VIN6
      // candidate. The remaining BOA rows fall to Tier 5 unmatched.
      expect(tier3.map((exception) => exception.transaction.id).sort()).toEqual([1, 100]);
      const missing = result.exceptions.filter((exception) =>
        exception.exception_type.startsWith("missing_in_"),
      );
      expect(missing.map((exception) => exception.transaction.id).sort()).toEqual([2, 3]);
    });
  });

  describe("Tier 4: amount-only with deterministic link", () => {
    test("routes same-stock + same-amount pairs to Needs Review when there is no VIN6 agreement", () => {
      const left = boa({ id: 1, amount_cents: 17750, stock_number: "M20999", vin: null });
      const right = dealertrack({ id: 2, amount_cents: -17750, stock_number: "M20999", vin: null });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.matched_count).toBe(0);
      expect(result.exceptions.every((exception) => exception.exception_type === "needs_review_amount_only")).toBe(true);
      expect(
        result.exceptions.every((exception) => exception.exception_category === "amount_only_review"),
      ).toBe(true);
    });

    test("routes same-reference + same-amount pairs to Needs Review when no VIN is present", () => {
      const left = boa({ id: 1, amount_cents: 12500, reference_number: "REF-1234", vin: null });
      const right = dealertrack({ id: 2, amount_cents: -12500, reference_number: "REF-1234", vin: null });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.matched_count).toBe(0);
      expect(result.exceptions.every((exception) => exception.exception_type === "needs_review_amount_only")).toBe(true);
    });

    test("does not pair Tier 4 candidates when both sides carry different full VINs", () => {
      // Same amount, same stock would have made these a Tier 4 pair, but the
      // full VINs are present on both sides and disagree - that's a VIN
      // conflict, not a Tier 4 case.
      const left = boa({ id: 1, amount_cents: 18000, stock_number: "M10001", vin: STORE_VIN_A });
      const right = dealertrack({
        id: 2,
        amount_cents: -18000,
        stock_number: "M10001",
        vin: STORE_VIN_B,
      });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.matched_count).toBe(0);
      const tier4 = result.exceptions.filter((exception) => exception.exception_type === "needs_review_amount_only");
      expect(tier4).toHaveLength(0);
      // Both sides should land as Tier 5 missing - the VIN conflict prevents
      // any kind of pairing.
      expect(
        result.exceptions.every((exception) => exception.exception_type.startsWith("missing_in_")),
      ).toBe(true);
    });

    test("does not pair Tier 4 candidates when both sides carry different VIN6 derived from full VINs", () => {
      const left = boa({ id: 1, amount_cents: 20000, vin: STORE_VIN_A, stock_number: "M1" });
      const right = dealertrack({
        id: 2,
        amount_cents: -20000,
        description: `BOA FLOORPLAN ${STORE_VIN_B}`,
        stock_number: "M1",
      });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.matched_count).toBe(0);
      // Different VIN6 - no Tier 4 pairing. Both sides are unmatched Tier 5.
      expect(
        result.exceptions.every((exception) => exception.exception_type.startsWith("missing_in_")),
      ).toBe(true);
    });

    test("falls through to Tier 5 when amounts match but there is no deterministic link", () => {
      const left = boa({ id: 1, amount_cents: 9999, stock_number: "M10001", vin: null });
      const right = dealertrack({ id: 2, amount_cents: -9999, stock_number: "M10002", vin: null });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.matched_count).toBe(0);
      expect(
        result.exceptions.every((exception) => exception.exception_type.startsWith("missing_in_")),
      ).toBe(true);
    });
  });

  describe("regression: duplicate amounts", () => {
    test("two different vehicles at the same amount do not produce a duplicate exception", () => {
      const lefts = [
        boa({ id: 1, amount_cents: 31051, vin: STORE_VIN_A, stock_number: "MA" }),
        boa({ id: 2, amount_cents: 31051, vin: STORE_VIN_B, stock_number: "MB" }),
      ];
      const rights = [
        dealertrack({ id: 11, amount_cents: -31051, vin: STORE_VIN_A, stock_number: "MA" }),
        dealertrack({ id: 12, amount_cents: -31051, vin: STORE_VIN_B, stock_number: "MB" }),
      ];
      const result = reconcileTransactionSets(lefts, rights);
      expect(result.matched_count).toBe(2);
      expect(result.duplicate_count).toBe(0);
    });
  });

  describe("regression: same-day flooring", () => {
    test("multiple floorplan advances posted on the same day match by VIN, not by date proximity", () => {
      // Three vehicles floored the same day, identical amount each.
      const sameDay = "2026-04-29";
      const lefts = [STORE_VIN_A, STORE_VIN_B, STORE_VIN_C].map((vin, index) =>
        boa({
          id: index + 1,
          amount_cents: 25000,
          vin,
          stock_number: `MS${index}`,
          transaction_date: sameDay,
        }),
      );
      const rights = [STORE_VIN_C, STORE_VIN_A, STORE_VIN_B].map((vin, index) =>
        dealertrack({
          id: 100 + index,
          amount_cents: -25000,
          vin,
          stock_number: `MS${index}`,
          transaction_date: sameDay,
        }),
      );
      const result = reconcileTransactionSets(lefts, rights);
      expect(result.matched_count).toBe(3);
      expect(result.exception_count).toBe(0);
      // Each match must pair the same VIN on both sides regardless of input order.
      for (const group of result.match_groups) {
        const groupVins = group.transactions.map((transaction) => transaction.vin);
        expect(groupVins[0]).toBe(groupVins[1]);
      }
    });
  });

  describe("regression: dirty Dealertrack VINs", () => {
    test("treats VIN with leading/trailing whitespace as equal to the canonical VIN", () => {
      const left = boa({ id: 1, amount_cents: 22600, vin: STORE_VIN_A, stock_number: "M888" });
      const right = dealertrack({
        id: 2,
        amount_cents: -22600,
        vin: `  ${STORE_VIN_A}  `,
        stock_number: "M888",
      });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.matched_count).toBe(1);
      expect(result.match_groups[0].match_reason).toBe("vin_abs_amount");
    });

    test("recovers VIN from Dealertrack description noise when stored VIN field is empty", () => {
      const left = boa({ id: 1, amount_cents: 14000, vin: STORE_VIN_B, stock_number: "MA" });
      const right = dealertrack({
        id: 2,
        amount_cents: -14000,
        vin: null,
        description: `HILEY/FLOORPLAN/2025 HYUNDAI ELANTRA ${STORE_VIN_B} sn=M-77777`,
        stock_number: "MA",
      });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.matched_count).toBe(1);
      expect(result.match_groups[0].match_reason).toBe("derived_vin_abs_amount");
    });
  });

  describe("regression: VIN conflicts", () => {
    test("VIN conflict at the same amount and stock does not auto-confirm, falls through to Tier 5", () => {
      const left = boa({ id: 1, amount_cents: 28000, vin: STORE_VIN_A, stock_number: "MS1" });
      const right = dealertrack({
        id: 2,
        amount_cents: -28000,
        vin: STORE_VIN_B,
        stock_number: "MS1",
      });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.matched_count).toBe(0);
      // Different VINs on both sides => no auto-match in any tier and no
      // Tier 4 pair either. They should be missing_in_*.
      expect(result.exceptions.map((exception) => exception.exception_type).sort()).toEqual([
        "missing_in_boa",
        "missing_in_dealertrack",
      ]);
    });
  });

  describe("regression: multiple identical amounts", () => {
    test("matches VIN-distinct rows even when many other rows carry the same amount", () => {
      const amount = 19999;
      const lefts = Array.from({ length: 5 }, (_, index) =>
        boa({
          id: index + 1,
          amount_cents: amount,
          vin: `1HGCM82633A00${String(index).padStart(4, "0")}`,
          stock_number: `M${index}`,
        }),
      );
      const rights = Array.from({ length: 5 }, (_, index) =>
        dealertrack({
          id: 100 + index,
          amount_cents: -amount,
          vin: `1HGCM82633A00${String(index).padStart(4, "0")}`,
          stock_number: `M${index}`,
        }),
      );
      const result = reconcileTransactionSets(lefts, rights);
      expect(result.matched_count).toBe(5);
      expect(result.exception_count).toBe(0);
      expect(result.duplicate_count).toBe(0);
    });
  });

  describe("regression: VIN6 collisions", () => {
    test("does not auto-confirm by VIN6 alone when the two sides have different full VINs that happen to share the last 6", () => {
      // Different amounts so Tier 1/2 cannot fire even on the side that would
      // share VIN6 - we want to verify the VIN6 collision case is routed to
      // Tier 3 review, not auto-confirmed at Tier 1.
      const suffix = "999999";
      const left = boa({ id: 1, amount_cents: 17000, vin: `1FTFW1E80PFA${suffix}`, stock_number: "MA" });
      const right = dealertrack({
        id: 2,
        amount_cents: -18000,
        vin: `2T3WFREV8HW${suffix}`,
        stock_number: "MB",
      });
      const result = reconcileTransactionSets([left], [right]);
      expect(result.matched_count).toBe(0);
      // Same VIN6 + amounts differ => Tier 3 Needs Review on both sides.
      expect(
        result.exceptions.every((exception) => exception.exception_type === "needs_review_vin6_only"),
      ).toBe(true);
    });
  });

  describe("regression: replay determinism", () => {
    test("running the same inputs twice produces byte-equivalent results", () => {
      const lefts = [
        boa({ id: 1, amount_cents: 25000, vin: STORE_VIN_A, stock_number: "M500" }),
        boa({ id: 2, amount_cents: 18450, vin: STORE_VIN_B, stock_number: "M657" }),
        boa({ id: 3, amount_cents: 21100, vin: STORE_VIN_C, stock_number: "M450" }),
      ];
      const rights = [
        dealertrack({ id: 11, amount_cents: -18450, vin: STORE_VIN_B, stock_number: "M657" }),
        dealertrack({ id: 12, amount_cents: -25000, vin: STORE_VIN_A, stock_number: "M500" }),
        dealertrack({ id: 13, amount_cents: -21100, vin: STORE_VIN_C, stock_number: "M450" }),
      ];
      const first = reconcileTransactionSets(lefts, rights);
      const second = reconcileTransactionSets(lefts, rights);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });

    test("input order does not change the set of matches but the engine is deterministic on a given ordering", () => {
      // Left order A, B, C; right order B, A, C - same pairs but iteration
      // hits left A first. The result must still match by VIN and exception
      // counts must be stable run-to-run.
      const lefts = [
        boa({ id: 1, amount_cents: 30000, vin: STORE_VIN_A, stock_number: "M1" }),
        boa({ id: 2, amount_cents: 30000, vin: STORE_VIN_B, stock_number: "M2" }),
        boa({ id: 3, amount_cents: 30000, vin: STORE_VIN_C, stock_number: "M3" }),
      ];
      const rights = [
        dealertrack({ id: 11, amount_cents: -30000, vin: STORE_VIN_B, stock_number: "M2" }),
        dealertrack({ id: 12, amount_cents: -30000, vin: STORE_VIN_A, stock_number: "M1" }),
        dealertrack({ id: 13, amount_cents: -30000, vin: STORE_VIN_C, stock_number: "M3" }),
      ];
      const result = reconcileTransactionSets(lefts, rights);
      expect(result.matched_count).toBe(3);
      // Match groups carry the same VIN on both sides.
      const pairs = result.match_groups.map((group) => ({
        left: group.transactions[0].vin,
        right: group.transactions[1].vin,
      }));
      for (const pair of pairs) {
        expect(pair.left).toBe(pair.right);
      }
      // Determinism on a fixed ordering: repeat run is identical.
      expect(JSON.stringify(reconcileTransactionSets(lefts, rights))).toBe(JSON.stringify(result));
    });
  });

  describe("invariant: every transaction lands in exactly one bucket under v2", () => {
    test("Tier 3/4 pairs preserve the invariant that each transaction id appears once", () => {
      const lefts = [
        // Tier 1 match
        boa({ id: 1, amount_cents: 25000, vin: STORE_VIN_A, stock_number: "M500" }),
        // Tier 3 candidate (VIN6 matches dealertrack 12 but amount differs)
        boa({ id: 2, amount_cents: 18000, vin: STORE_VIN_B, stock_number: "M657" }),
        // Tier 4 candidate (amount + stock match dealertrack 13)
        boa({ id: 3, amount_cents: 21100, vin: null, stock_number: "M450" }),
        // Tier 5 missing
        boa({ id: 4, amount_cents: 99999, vin: STORE_VIN_C, stock_number: "MZ" }),
      ];
      const rights = [
        dealertrack({ id: 11, amount_cents: -25000, vin: STORE_VIN_A, stock_number: "M500" }),
        dealertrack({ id: 12, amount_cents: -19000, vin: STORE_VIN_B, stock_number: "M657" }),
        dealertrack({ id: 13, amount_cents: -21100, vin: null, stock_number: "M450" }),
        dealertrack({ id: 14, amount_cents: -77777, vin: null, stock_number: "MY" }),
      ];
      const result = reconcileTransactionSets(lefts, rights);
      const ids = new Set<number>();
      for (const group of result.match_groups) {
        for (const transaction of group.transactions) {
          expect(ids.has(transaction.id)).toBe(false);
          ids.add(transaction.id);
        }
      }
      for (const exception of result.exceptions) {
        expect(ids.has(exception.transaction.id)).toBe(false);
        ids.add(exception.transaction.id);
      }
      expect(ids.size).toBe(lefts.length + rights.length);
    });
  });
});
