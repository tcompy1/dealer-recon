import { afterEach, describe, expect, test, vi } from "vitest";

import { reconcileSourceFiles } from "./reconciliation";
import { UploadError, uploadSourceFile } from "./uploads";
import type { ReconciliationResponse } from "../types/reconciliation";
import type { UploadPreprocessingMetadata, UploadResponse } from "../types/sourceFile";

describe("rooftop API request contracts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("serializes exact store and accounting-month fields in upload FormData", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(uploadResponse, 200));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["synthetic"], "boa.csv", { type: "text/csv" });

    await uploadSourceFile({
      sourceType: "boa",
      file,
      dealershipStoreId: 17,
      accountingMonth: "2026-04",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/upload");
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    const body = init.body as FormData;
    expect(Array.from(body.keys()).sort()).toEqual([
      "accounting_month",
      "file",
      "source_type",
      "store_id",
    ]);
    expect(body.get("source_type")).toBe("boa");
    expect(body.get("store_id")).toBe("17");
    expect(body.get("accounting_month")).toBe("2026-04");
    expect(body.get("file")).toBe(file);
  });

  test("serializes exact store and accounting-month fields in reconciliation JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(reconciliationResponse, 200));
    vi.stubGlobal("fetch", fetchMock);

    await reconcileSourceFiles({
      boaSourceFileId: 101,
      dealertrackSourceFileId: 102,
      dealershipStoreId: 17,
      accountingMonth: "2026-04",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/reconcile",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boa_source_file_id: 101,
          dealertrack_source_file_id: 102,
          dealership_store_id: 17,
          accounting_month: "2026-04",
        }),
      }),
    );
  });

  test("preserves structured upload errors and preprocessing diagnostics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: {
        code: "SOURCE_PERIOD_MISMATCH",
        message: "The BOA statement period does not match the selected accounting month.",
        details: {
          source: "boa",
          accounting_month: "2026-04",
          rooftop_profile_id: "acura-v1",
          evidence: { explicit_month: "2026-03" },
          recovery: "Select March 2026 or upload the April statement.",
        },
      },
      preprocessing,
    }, 422)));

    const error = await captureUploadError();

    expect(error).toBeInstanceOf(UploadError);
    expect(error).toMatchObject({
      message: "The BOA statement period does not match the selected accounting month.",
      status: 422,
      code: "SOURCE_PERIOD_MISMATCH",
      details: {
        source: "boa",
        accounting_month: "2026-04",
        rooftop_profile_id: "acura-v1",
        recovery: "Select March 2026 or upload the April statement.",
      },
      preprocessing,
    });
  });

  test("returns a structured fallback UploadError for malformed error bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 500 })));

    const error = await captureUploadError();

    expect(error).toBeInstanceOf(UploadError);
    expect(error).toMatchObject({
      message: "Upload failed: 500",
      status: 500,
      code: null,
      details: null,
      preprocessing: null,
    });
  });
});

async function captureUploadError(): Promise<unknown> {
  try {
    await uploadSourceFile({
      sourceType: "boa",
      file: new File(["synthetic"], "boa.csv", { type: "text/csv" }),
      dealershipStoreId: 17,
      accountingMonth: "2026-04",
    });
    throw new Error("Expected uploadSourceFile to reject.");
  } catch (error) {
    return error;
  }
}

const preprocessing: UploadPreprocessingMetadata = {
  detected_format: "csv",
  detection_confidence: "high",
  detection_reason: "CSV structure detected.",
  parser_route: "boa-csv",
  preprocessing_version: "preprocessing-v1",
  summary: {
    source_kind: "boa",
    preprocessing_version: "preprocessing-v1",
    parser_name: "boa-csv",
    parser_version: "1",
    parser_format: "csv",
    preprocessor_name: "boa-floorplan",
    preprocessor_version: "1",
    period_evidence: {
      source: "boa",
      selectedMonth: "2026-04",
      explicitMonths: ["2026-03"],
      observedDateRange: null,
      filenameHint: null,
      status: "contradictory",
      safeEvidence: { explicit_month: "2026-03" },
    },
    rows_scanned: 1,
    rows_accepted: 0,
    rows_removed_zero_balance: 0,
    rows_removed_straightline: 0,
    rows_removed_banner: 0,
    rows_skipped_unknown: 0,
    rows_requiring_manual_enrichment: 0,
    duplicate_vin6_count: 0,
    preprocessed_at: "2026-04-30T00:00:00.000Z",
  },
  diagnostics: [],
  removed_rows: [],
  legacy_csv_path: false,
  unsupported_reason: null,
};

const uploadResponse: UploadResponse = {
  source_file_id: 101,
  dealership_store_id: 17,
  store_name: "Hiley Acura",
  source_type: "boa",
  filename: "boa.csv",
  transaction_count: 1,
  stored_row_count: 1,
  stored_validation_error_count: 0,
  validation_errors: [],
  automated_reconciliation_run_id: null,
  reused_existing_file: false,
  source_file_health: {
    status: "healthy",
    healthy: true,
    reasons: [],
    transaction_count: 1,
    row_count: 1,
    validation_error_count: 0,
  },
  warnings: [],
  accounting_month: "2026-04",
  rooftop_profile_id: "acura-v1",
  rooftop_profile_version: "1",
  parser_name: "boa-csv",
  parser_version: "1",
  preprocessor_name: "boa-floorplan",
  preprocessor_version: "1",
  preprocessing: {
    ...preprocessing,
    summary: preprocessing.summary
      ? {
          ...preprocessing.summary,
          period_evidence: {
            ...preprocessing.summary.period_evidence,
            explicitMonths: ["2026-04"],
            status: "confirmed",
          },
          rows_accepted: 1,
        }
      : null,
  },
};

const reconciliationResponse: ReconciliationResponse = {
  reconciliation_run_id: 42,
  accounting_month: "2026-04",
  rooftop_profile_id: "acura-v1",
  rooftop_profile_version: "1",
  matched_count: 0,
  exception_count: 0,
  duplicate_count: 0,
  match_groups: [],
  exceptions: [],
  vin_presence_diagnostics: {
    extracted_vin_sets: { boa: [], dealertrack: [] },
    vin_presence_exceptions: { dealertrack_not_in_boa: [], boa_not_in_dealertrack: [] },
    transaction_unmatched_shared_vins: [],
  },
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
