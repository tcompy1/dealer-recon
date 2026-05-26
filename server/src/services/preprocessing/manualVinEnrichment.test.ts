import { describe, expect, test } from "vitest";

import type { Transaction } from "../../domain/types.js";
import {
  applyManualVinEnrichment,
  collectEnrichmentCandidates,
} from "./manualVinEnrichment.js";
import { LINEAGE_RAW_DATA_KEY, type RawDataLineage } from "./types.js";

function baseTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    dealership_id: 1,
    source_file_id: 1,
    source_type: "dealertrack",
    transaction_date: null,
    post_date: null,
    amount_cents: -10_000_00,
    reference_number: null,
    description: "FLOORPLAN ADV NO VIN",
    account: null,
    account_type: "floorplan",
    account_identifier: "floorplan",
    stock_number: "M10001",
    vin: null,
    raw_data: {
      Control: "M10001",
      Description: "FLOORPLAN ADV NO VIN",
      [LINEAGE_RAW_DATA_KEY]: {
        source_kind: "dealertrack",
        preprocessing_version: "preprocessing-v1",
        source_row_number: 5,
        raw_row_snapshot: { Control: "M10001", Description: "FLOORPLAN ADV NO VIN" },
        transformations: [{ stage: "raw_parsed" }, { stage: "vin_enrichment_required" }],
        retained_reason: "non_zero_amount",
        vin_provenance: {
          source: "untrusted",
          vin: null,
          vin6: null,
          trusted: false,
          note: "No VIN parsed.",
        },
        maturity_date: null,
      } satisfies RawDataLineage,
    },
    ...overrides,
  };
}

describe("applyManualVinEnrichment", () => {
  test("accepts a valid 17-character VIN and stamps lineage", () => {
    const transaction = baseTransaction();
    const result = applyManualVinEnrichment(transaction, {
      vin: "1FAKEVN0000A0001X",
      source: "manual_enrichment",
      enriched_by: "title-clerk@hiley",
      enriched_at: "2026-05-26T10:00:00.000Z",
      note: "Looked up in Reynolds",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vin).toBe("1FAKEVN0000A0001X");
    expect(result.vin6).toBe("A0001X");
    expect(result.vin_provenance.trusted).toBe(true);
    const lineage = result.raw_data[LINEAGE_RAW_DATA_KEY] as RawDataLineage;
    expect(lineage.transformations.map((t) => t.stage)).toContain("vin_enriched");
    expect(lineage.vin_provenance?.note).toContain("title-clerk@hiley");
  });

  test("rejects invalid VINs", () => {
    const transaction = baseTransaction();
    const result = applyManualVinEnrichment(transaction, {
      vin: "BAD-VIN",
      source: "manual_enrichment",
      enriched_by: "x",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_vin");
  });

  test("rejects no-op when VIN unchanged", () => {
    const transaction = baseTransaction({ vin: "1FAKEVN0000A0001X" });
    const result = applyManualVinEnrichment(transaction, {
      vin: "1FAKEVN0000A0001X",
      source: "manual_enrichment",
      enriched_by: "x",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_change");
  });

  test("is deterministic given a fixed enriched_at", () => {
    const t = baseTransaction();
    const a = applyManualVinEnrichment(t, {
      vin: "1FAKEVN0000A0001X",
      source: "dms_assisted_reconstruction",
      enriched_by: "dms:reynolds",
      enriched_at: "2026-05-26T10:00:00.000Z",
    });
    const b = applyManualVinEnrichment(t, {
      vin: "1FAKEVN0000A0001X",
      source: "dms_assisted_reconstruction",
      enriched_by: "dms:reynolds",
      enriched_at: "2026-05-26T10:00:00.000Z",
    });
    expect(a).toEqual(b);
  });
});

describe("collectEnrichmentCandidates", () => {
  test("returns only untrusted-VIN transactions", () => {
    const trusted = baseTransaction({
      id: 2,
      vin: "1FAKEVN0000A0001X",
      raw_data: {
        [LINEAGE_RAW_DATA_KEY]: {
          source_kind: "dealertrack",
          preprocessing_version: "preprocessing-v1",
          source_row_number: 9,
          raw_row_snapshot: {},
          transformations: [],
          retained_reason: "non_zero_amount",
          vin_provenance: {
            source: "raw_vin_column",
            vin: "1FAKEVN0000A0001X",
            vin6: "0A0001",
            trusted: true,
            note: null,
          },
          maturity_date: null,
        } satisfies RawDataLineage,
      },
    });
    const untrusted = baseTransaction({ id: 3 });
    const candidates = collectEnrichmentCandidates([trusted, untrusted]);
    expect(candidates.map((c) => c.transaction_id)).toEqual([3]);
    expect(candidates[0].reason).toBe("missing_vin");
  });
});
