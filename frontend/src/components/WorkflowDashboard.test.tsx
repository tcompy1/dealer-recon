import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ApiError } from "../api/errorMessage";
import {
  getReconciliationRun,
  listReconciliationArtifacts,
  reconcileSourceFiles,
  replayReconciliationRun,
} from "../api/reconciliation";
import { listDealerGroups, listDealershipStores } from "../api/stores";
import { uploadSourceFile } from "../api/uploads";
import type {
  ReconciliationResponse,
  ReconciliationReplayResponse,
  ReconciliationRunDetail,
} from "../types/reconciliation";
import type { UploadResponse } from "../types/sourceFile";
import type { DealershipStoreWithRooftopSupport } from "../types/store";
import { WorkflowDashboard } from "./WorkflowDashboard";

vi.mock("../api/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/stores")>();
  return {
    ...actual,
    createDealershipStore: vi.fn(),
    listDealerGroups: vi.fn(),
    listDealershipStores: vi.fn(),
  };
});

vi.mock("../api/uploads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/uploads")>();
  return { ...actual, uploadSourceFile: vi.fn() };
});

vi.mock("../api/reconciliation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/reconciliation")>();
  return {
    ...actual,
    getReconciliationRun: vi.fn(),
    listReconciliationArtifacts: vi.fn(),
    reconcileSourceFiles: vi.fn(),
    replayReconciliationRun: vi.fn(),
  };
});

const stores: DealershipStoreWithRooftopSupport[] = [
  {
    id: 1,
    dealership_id: 1,
    dealer_group_id: 1,
    name: "Hiley Acura",
    created_at: "2026-01-01T00:00:00.000Z",
    rooftop_profile: { id: "acura-v1", version: "1", enabled: true },
  },
  {
    id: 2,
    dealership_id: 1,
    dealer_group_id: 1,
    name: "Hiley Buick GMC",
    created_at: "2026-01-01T00:00:00.000Z",
    rooftop_profile: { id: "hurst-v1", version: "1", enabled: true },
  },
  {
    id: 3,
    dealership_id: 1,
    dealer_group_id: 1,
    name: "Arlington",
    created_at: "2026-01-01T00:00:00.000Z",
    rooftop_profile: null,
  },
];

describe("WorkflowDashboard rooftop workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDealerGroups).mockResolvedValue([
      {
        id: 1,
        dealership_id: 1,
        name: "Hiley",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(listDealershipStores).mockResolvedValue(stores);
    vi.mocked(uploadSourceFile).mockImplementation(async ({ sourceType }) =>
      buildUploadResponse(sourceType as "boa" | "dealertrack"),
    );
    vi.mocked(reconcileSourceFiles).mockResolvedValue(reconciliationResponse);
    vi.mocked(getReconciliationRun).mockResolvedValue(reconciliationRun);
    vi.mocked(listReconciliationArtifacts).mockResolvedValue([]);
    vi.mocked(replayReconciliationRun).mockResolvedValue(replayResponse);
  });

  afterEach(cleanup);

  test("distinguishes enabled Hurst and Acura rooftops from unsupported stores", async () => {
    render(<WorkflowDashboard />);

    const storeSelect = await screen.findByLabelText("Store");
    expect(within(storeSelect).getByRole("option", { name: "Hiley Acura — Enabled" })).toBeInTheDocument();
    expect(within(storeSelect).getByRole("option", { name: "Hiley Buick GMC — Enabled" })).toBeInTheDocument();
    expect(within(storeSelect).getByRole("option", { name: "Arlington — Unsupported" })).toBeInTheDocument();

    fireEvent.change(storeSelect, { target: { value: "3" } });
    expect(screen.getByText("This store is not enabled for floorplan reconciliation.")).toBeInTheDocument();
  });

  test("requires a valid accounting month and enabled profile before uploads or reconciliation", async () => {
    render(<WorkflowDashboard />);

    const monthInput = await screen.findByLabelText("Accounting month");
    expect(monthInput).toHaveAttribute("type", "month");
    expect(monthInput).toBeRequired();

    fireEvent.change(screen.getByLabelText("BOA input file"), {
      target: { files: [new File(["boa"], "boa.csv", { type: "text/csv" })] },
    });
    fireEvent.change(screen.getByLabelText("Dealertrack input file"), {
      target: { files: [new File(["dealertrack"], "dealertrack.csv", { type: "text/csv" })] },
    });

    for (const button of screen.getAllByRole("button", { name: "Upload" })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Run Workflow" })).toBeDisabled();

    fireEvent.change(monthInput, { target: { value: "2026-04" } });
    fireEvent.change(screen.getByLabelText("BOA input file"), {
      target: { files: [new File(["boa"], "boa.csv", { type: "text/csv" })] },
    });
    fireEvent.change(screen.getByLabelText("Dealertrack input file"), {
      target: { files: [new File(["dealertrack"], "dealertrack.csv", { type: "text/csv" })] },
    });
    for (const button of screen.getAllByRole("button", { name: "Upload" })) {
      expect(button).toBeEnabled();
    }
  });

  test("displays the selected accounting month in an operator-facing format", async () => {
    render(<WorkflowDashboard />);

    const monthInput = await screen.findByLabelText("Accounting month");
    fireEvent.change(monthInput, { target: { value: "2026-04" } });

    const monthStation = screen.getByText("Month").closest(".forge-step-card");
    expect(monthInput).toHaveValue("2026-04");
    expect(within(monthStation as HTMLElement).getByRole("heading", { name: "Apr 2026" }))
      .toBeInTheDocument();
  });

  test("sends one selected month through both uploads and reconciliation and renders final outputs", async () => {
    render(<WorkflowDashboard />);
    await prepareAprilInputs();

    const uploadButtons = screen.getAllByRole("button", { name: "Upload" });
    fireEvent.click(uploadButtons[0]);
    fireEvent.click(uploadButtons[1]);

    await waitFor(() => expect(uploadSourceFile).toHaveBeenCalledTimes(2));
    expect(vi.mocked(uploadSourceFile).mock.calls.map(([input]) => input.accountingMonth)).toEqual([
      "2026-04",
      "2026-04",
    ]);

    fireEvent.click(await screen.findByRole("button", { name: "Run Workflow" }));

    expect((await screen.findAllByText("ACURA · Apr 2026 · Run #42")).length).toBeGreaterThan(0);
    expect(reconcileSourceFiles).toHaveBeenCalledWith({
      boaSourceFileId: 101,
      dealertrackSourceFileId: 102,
      dealershipStoreId: 1,
      accountingMonth: "2026-04",
    });
    expect(getReconciliationRun).toHaveBeenCalledWith(42);
    expect(screen.getByRole("link", { name: "Download Merged Export" })).toHaveAttribute(
      "href",
      "http://localhost:8000/reconciliation-runs/42/merged-floorplan",
    );
    expect(screen.getByRole("link", { name: "Download FP REC" })).toHaveAttribute(
      "href",
      "http://localhost:8000/reconciliation-runs/42/fp-rec",
    );
  });

  test("clears selected uploads and the active run when the month or store changes", async () => {
    render(<WorkflowDashboard />);
    await prepareAprilInputs();

    for (const button of screen.getAllByRole("button", { name: "Upload" })) {
      fireEvent.click(button);
    }
    expect((await screen.findAllByText("source_file_id:", { exact: false })).length).toBe(2);

    fireEvent.change(screen.getByLabelText("Store"), { target: { value: "2" } });
    expect(screen.queryByText("source_file_id:", { exact: false })).not.toBeInTheDocument();

    vi.mocked(getReconciliationRun).mockResolvedValue({
      ...reconciliationRun,
      dealership_store_id: 2,
      store_name: "Hiley Buick GMC",
      rooftop_profile_id: "hurst-v1",
    });

    fireEvent.change(screen.getByLabelText("Accounting month"), { target: { value: "2026-04" } });
    fireEvent.change(screen.getByLabelText("BOA input file"), {
      target: { files: [new File(["boa"], "boa.csv", { type: "text/csv" })] },
    });
    fireEvent.change(screen.getByLabelText("Dealertrack input file"), {
      target: { files: [new File(["dealertrack"], "dealertrack.csv", { type: "text/csv" })] },
    });
    for (const button of screen.getAllByRole("button", { name: "Upload" })) {
      fireEvent.click(button);
    }
    fireEvent.click(await screen.findByRole("button", { name: "Run Workflow" }));
    expect((await screen.findAllByText("HURST · Apr 2026 · Run #42")).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Accounting month"), { target: { value: "2026-05" } });
    expect(screen.queryByText("HURST · Apr 2026 · Run #42")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download FP REC" })).not.toBeInTheDocument();
    expect(screen.queryByText("source_file_id:", { exact: false })).not.toBeInTheDocument();
  });

  test("does not restore an in-flight upload after the accounting month changes", async () => {
    const pendingUpload = deferred<UploadResponse>();
    vi.mocked(uploadSourceFile).mockReturnValueOnce(pendingUpload.promise);
    render(<WorkflowDashboard />);
    fireEvent.change(await screen.findByLabelText("Accounting month"), {
      target: { value: "2026-04" },
    });
    fireEvent.change(screen.getByLabelText("BOA input file"), {
      target: { files: [new File(["boa"], "boa.csv", { type: "text/csv" })] },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Upload" })[0]);
    await waitFor(() => expect(uploadSourceFile).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Accounting month"), { target: { value: "2026-05" } });
    await act(async () => {
      pendingUpload.resolve(buildUploadResponse("boa"));
      await pendingUpload.promise;
    });

    expect(screen.queryByText("source_file_id:", { exact: false })).not.toBeInTheDocument();
  });

  test("does not attach stale upload success or error after either source file is replaced", async () => {
    const pendingBoaUpload = deferred<UploadResponse>();
    const pendingDealertrackUpload = deferred<UploadResponse>();
    vi.mocked(uploadSourceFile)
      .mockReturnValueOnce(pendingBoaUpload.promise)
      .mockReturnValueOnce(pendingDealertrackUpload.promise);
    render(<WorkflowDashboard />);
    await prepareAprilInputs();

    for (const button of screen.getAllByRole("button", { name: "Upload" })) {
      fireEvent.click(button);
    }
    await waitFor(() => expect(uploadSourceFile).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText("BOA input file"), {
      target: { files: [new File(["new boa"], "replacement-boa.csv", { type: "text/csv" })] },
    });
    fireEvent.change(screen.getByLabelText("Dealertrack input file"), {
      target: {
        files: [new File(["new dt"], "replacement-dealertrack.csv", { type: "text/csv" })],
      },
    });

    await act(async () => {
      pendingBoaUpload.resolve(buildUploadResponse("boa"));
      pendingDealertrackUpload.reject(new ApiError("Old Dealertrack upload failed.", {
        status: 422,
        details: {
          source: "dealertrack",
          accounting_month: "2026-04",
          rooftop_profile_id: "acura-v1",
          recovery: "Upload the replacement Dealertrack file.",
        },
      }));
      await Promise.allSettled([pendingBoaUpload.promise, pendingDealertrackUpload.promise]);
    });

    expect(screen.queryByText("source_file_id:", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText("Old Dealertrack upload failed.")).not.toBeInTheDocument();
    expect(screen.queryByText("Upload the replacement Dealertrack file.")).not.toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "Upload" })) {
      expect(button).toBeEnabled();
    }
  });

  test("keeps a new reconciliation pending when an older context request finishes", async () => {
    const aprilReconciliation = deferred<ReconciliationResponse>();
    const mayReconciliation = deferred<ReconciliationResponse>();
    vi.mocked(reconcileSourceFiles)
      .mockReturnValueOnce(aprilReconciliation.promise)
      .mockReturnValueOnce(mayReconciliation.promise);
    vi.mocked(getReconciliationRun).mockImplementation(async (runId) =>
      runId === 43 ? buildReconciliationRun(43, "2026-05") : reconciliationRun,
    );
    render(<WorkflowDashboard />);
    await prepareAprilInputs();
    await uploadBothInputs(2);

    fireEvent.click(screen.getByRole("button", { name: "Run Workflow" }));
    await waitFor(() => expect(reconcileSourceFiles).toHaveBeenCalledTimes(1));

    await prepareInputsForMonth("2026-05");
    await uploadBothInputs(4);
    fireEvent.click(screen.getByRole("button", { name: "Run Workflow" }));
    await waitFor(() => expect(reconcileSourceFiles).toHaveBeenCalledTimes(2));

    await act(async () => {
      aprilReconciliation.resolve(reconciliationResponse);
      await aprilReconciliation.promise;
    });

    const pendingButton = screen.getByRole("button", { name: "Running workflow..." });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);
    expect(reconcileSourceFiles).toHaveBeenCalledTimes(2);
    expect(getReconciliationRun).not.toHaveBeenCalled();

    await act(async () => {
      mayReconciliation.resolve(buildReconciliationResponse(43, "2026-05"));
      await mayReconciliation.promise;
    });
    expect((await screen.findAllByText("ACURA · May 2026 · Run #43")).length).toBeGreaterThan(0);
  });

  test("keeps a new replay pending when a replay from an older context finishes", async () => {
    const aprilReplay = deferred<ReconciliationReplayResponse>();
    const mayReplay = deferred<ReconciliationReplayResponse>();
    vi.mocked(replayReconciliationRun)
      .mockReturnValueOnce(aprilReplay.promise)
      .mockReturnValueOnce(mayReplay.promise);
    vi.mocked(reconcileSourceFiles)
      .mockResolvedValueOnce(reconciliationResponse)
      .mockResolvedValueOnce(buildReconciliationResponse(43, "2026-05"));
    vi.mocked(getReconciliationRun).mockImplementation(async (runId) =>
      runId === 43 ? buildReconciliationRun(43, "2026-05") : reconciliationRun,
    );
    render(<WorkflowDashboard />);
    await prepareAprilInputs();
    await uploadBothInputs(2);
    fireEvent.click(screen.getByRole("button", { name: "Run Workflow" }));
    await screen.findByRole("button", { name: "Replay Snapshot" });

    fireEvent.click(screen.getByRole("button", { name: "Replay Snapshot" }));
    await waitFor(() => expect(replayReconciliationRun).toHaveBeenCalledTimes(1));

    await prepareInputsForMonth("2026-05");
    await uploadBothInputs(4);
    fireEvent.click(screen.getByRole("button", { name: "Run Workflow" }));
    await screen.findByText("ACURA · May 2026 · Run #43", { selector: "p" });
    fireEvent.click(screen.getByRole("button", { name: "Replay Snapshot" }));
    await waitFor(() => expect(replayReconciliationRun).toHaveBeenCalledTimes(2));

    await act(async () => {
      aprilReplay.resolve({ ...replayResponse, results_changed: true });
      await aprilReplay.promise;
    });

    const pendingButton = screen.getByRole("button", { name: "Replaying..." });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);
    expect(replayReconciliationRun).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Results changed")).not.toBeInTheDocument();

    await act(async () => {
      mayReplay.resolve({ ...replayResponse, reconciliation_run_id: 43 });
      await mayReplay.promise;
    });
    expect(await screen.findByText("Results unchanged")).toBeInTheDocument();
  });

  test("ignores a replay error after its run context is replaced", async () => {
    const pendingReplay = deferred<ReconciliationReplayResponse>();
    vi.mocked(replayReconciliationRun).mockReturnValueOnce(pendingReplay.promise);
    render(<WorkflowDashboard />);
    await prepareAprilInputs();
    await uploadBothInputs(2);
    fireEvent.click(screen.getByRole("button", { name: "Run Workflow" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replay Snapshot" }));
    await waitFor(() => expect(replayReconciliationRun).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Accounting month"), { target: { value: "2026-05" } });
    await act(async () => {
      pendingReplay.reject(new Error("Old replay failed."));
      await pendingReplay.promise.catch(() => undefined);
    });

    expect(screen.queryByText("Old replay failed.")).not.toBeInTheDocument();
  });

  test("renders the server explanation and structured recovery for a period mismatch", async () => {
    vi.mocked(uploadSourceFile).mockRejectedValueOnce(
      new ApiError(
        "The BOA statement period does not match the selected accounting month.",
        {
          status: 422,
          code: "SOURCE_PERIOD_MISMATCH",
          details: {
            source: "boa",
            accounting_month: "2026-03",
            rooftop_profile_id: "acura-v1",
            evidence: { explicit_month: "2026-04" },
            recovery: "Select April 2026 and upload the BOA file again.",
          },
        },
      ),
    );
    render(<WorkflowDashboard />);
    const monthInput = await screen.findByLabelText("Accounting month");
    fireEvent.change(monthInput, { target: { value: "2026-03" } });
    fireEvent.change(screen.getByLabelText("BOA input file"), {
      target: { files: [new File(["boa"], "boa.csv", { type: "text/csv" })] },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Upload" })[0]);

    expect(
      await screen.findByText(
        "The BOA statement period does not match the selected accounting month.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Select April 2026 and upload the BOA file again."),
    ).toBeInTheDocument();
  });

  test("keeps the existing Hurst task, upload, and output labels", async () => {
    render(<WorkflowDashboard />);
    fireEvent.change(await screen.findByLabelText("Store"), { target: { value: "2" } });

    expect(screen.getByText("Floorplan Reconciliation", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("BOA input")).toBeInTheDocument();
    expect(screen.getByText("Dealertrack input")).toBeInTheDocument();
    expect(
      screen.getByText(/Generates the merged export and FP REC final workpaper/i),
    ).toBeInTheDocument();
    expect(screen.getByText("HURST profile enabled")).toBeInTheDocument();
    expect(screen.getByLabelText("Accounting month")).toBeInTheDocument();
  });
});

async function prepareAprilInputs() {
  await prepareInputsForMonth("2026-04");
}

async function prepareInputsForMonth(accountingMonth: string) {
  fireEvent.change(await screen.findByLabelText("Accounting month"), {
    target: { value: accountingMonth },
  });
  fireEvent.change(screen.getByLabelText("BOA input file"), {
    target: { files: [new File(["boa"], "boa.csv", { type: "text/csv" })] },
  });
  fireEvent.change(screen.getByLabelText("Dealertrack input file"), {
    target: { files: [new File(["dealertrack"], "dealertrack.csv", { type: "text/csv" })] },
  });
}

async function uploadBothInputs(expectedUploadCallCount: number) {
  for (const button of screen.getAllByRole("button", { name: "Upload" })) {
    fireEvent.click(button);
  }
  await waitFor(() => expect(uploadSourceFile).toHaveBeenCalledTimes(expectedUploadCallCount));
  await waitFor(() =>
    expect(screen.getAllByText("source_file_id:", { exact: false })).toHaveLength(2),
  );
}

function buildUploadResponse(sourceType: "boa" | "dealertrack"): UploadResponse {
  const sourceFileId = sourceType === "boa" ? 101 : 102;
  return {
    source_file_id: sourceFileId,
    dealership_store_id: 1,
    store_name: "Hiley Acura",
    source_type: sourceType,
    filename: `${sourceType}.csv`,
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
    parser_name: sourceType === "boa" ? "boa-csv" : "dealertrack-csv",
    parser_version: "1",
    preprocessor_name: sourceType === "boa" ? "boa-floorplan" : "dealertrack-floorplan",
    preprocessor_version: "1",
    preprocessing: {
      detected_format: "csv",
      detection_confidence: "high",
      detection_reason: "CSV structure detected.",
      parser_route: `${sourceType}-csv`,
      preprocessing_version: "preprocessing-v1",
      summary: {
        source_kind: sourceType,
        preprocessing_version: "preprocessing-v1",
        parser_name: sourceType === "boa" ? "boa-csv" : "dealertrack-csv",
        parser_version: "1",
        parser_format: "csv",
        preprocessor_name: sourceType === "boa" ? "boa-floorplan" : "dealertrack-floorplan",
        preprocessor_version: "1",
        period_evidence: {
          source: sourceType,
          selectedMonth: "2026-04",
          explicitMonths: sourceType === "boa" ? ["2026-04"] : [],
          observedDateRange: null,
          filenameHint: null,
          status: sourceType === "boa" ? "confirmed" : "compatible_incomplete",
          safeEvidence: {},
        },
        rows_scanned: 1,
        rows_accepted: 1,
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
    },
  };
}

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

function buildReconciliationResponse(
  reconciliationRunId: number,
  accountingMonth: string,
): ReconciliationResponse {
  return {
    ...reconciliationResponse,
    reconciliation_run_id: reconciliationRunId,
    accounting_month: accountingMonth,
  };
}

const sourceSummary = (sourceType: "boa" | "dealertrack") => ({
  source_file_id: sourceType === "boa" ? 101 : 102,
  dealership_id: 1,
  dealership_store_id: 1,
  store_name: "Hiley Acura",
  source_type: sourceType,
  filename: `${sourceType}.csv`,
  row_count: 1,
  validation_error_count: 0,
  accounting_month: "2026-04",
  rooftop_profile_id: "acura-v1" as const,
  rooftop_profile_version: "1",
  parser_name: sourceType === "boa" ? "boa-csv" : "dealertrack-csv",
  parser_version: "1",
  preprocessor_name: sourceType === "boa" ? "boa-floorplan" : "dealertrack-floorplan",
  preprocessor_version: "1",
  preprocessing_metadata: buildUploadResponse(sourceType).preprocessing,
  created_at: "2026-04-30T00:00:00.000Z",
});

const reconciliationRun: ReconciliationRunDetail = {
  reconciliation_run_id: 42,
  dealership_id: 1,
  dealership_store_id: 1,
  store_name: "Hiley Acura",
  dealer_group_id: 1,
  dealer_group_name: "Hiley",
  boa_source_file_id: 101,
  dealertrack_source_file_id: 102,
  boa_filename: "boa.csv",
  dealertrack_filename: "dealertrack.csv",
  matched_count: 0,
  exception_count: 0,
  duplicate_count: 0,
  status: "completed",
  accounting_month: "2026-04",
  rooftop_profile_id: "acura-v1",
  rooftop_profile_version: "1",
  created_at: "2026-04-30T00:00:00.000Z",
  boa_source_file: sourceSummary("boa"),
  dealertrack_source_file: sourceSummary("dealertrack"),
  match_groups: [],
  exceptions: [],
};

function buildReconciliationRun(
  reconciliationRunId: number,
  accountingMonth: string,
): ReconciliationRunDetail {
  return {
    ...reconciliationRun,
    reconciliation_run_id: reconciliationRunId,
    accounting_month: accountingMonth,
  };
}

const replayResponse: ReconciliationReplayResponse = {
  reconciliation_run_id: 42,
  results_changed: false,
  original: { matched_count: 0, exception_count: 0 },
  replayed: { matched_count: 0, exception_count: 0 },
  matched_count_delta: 0,
  exception_count_delta: 0,
  newly_matched: [],
  newly_unmatched: [],
  engine_version_difference: {
    original: "engine-v1",
    current: "engine-v1",
    differs: false,
  },
  parser_version_difference: [
    { side: "boa", original: "1", current: "1", differs: false },
    { side: "dealertrack", original: "1", current: "1", differs: false },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
