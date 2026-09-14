import { describe, expect, test } from "vitest";

import type { RooftopProfileId } from "../config/storeWorkflowConfig.js";
import {
  parseAccountingMonth,
  type AccountingMonth,
} from "../domain/accountingMonth.js";
import type {
  NewReconciliationArtifact,
  NewTransaction,
  ProfiledNewSourceFile,
  SourceFile,
} from "../domain/types.js";
import { MemoryTransactionRepository } from "../repositories/transactionRepository.js";
import {
  createReconciliationRunFromSourceFiles,
  findLatestSourceFilePair,
} from "./reconciliationAutomation.js";
import type { UploadPreprocessingMetadata } from "./preprocessing/types.js";

class FailingArtifactRepository extends MemoryTransactionRepository {
  private artifactWrites = 0;

  override async createReconciliationArtifact(
    dealershipId: number,
    artifact: NewReconciliationArtifact,
  ) {
    this.artifactWrites += 1;
    if (this.artifactWrites === 2) {
      throw new Error("artifact write failed");
    }
    return super.createReconciliationArtifact(dealershipId, artifact);
  }
}

describe("createReconciliationRunFromSourceFiles", () => {
  test("marks the run artifact_failed when artifact persistence fails", async () => {
    const repository = new FailingArtifactRepository();
    const { boaSourceFile, dealertrackSourceFile } = await seedHurstSourcePair(repository, true);

    await expect(
      createReconciliationRunFromSourceFiles({
        repository,
        dealershipId: 1,
        boaSourceFile,
        dealertrackSourceFile,
        automated: false,
      }),
    ).rejects.toThrow("artifact write failed");

    const runs = await repository.listReconciliationRuns(1);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "artifact_failed" });
  });

  test("requires raw BOA and Dealertrack artifacts for Hurst v1 runs", async () => {
    const repository = new MemoryTransactionRepository();
    const { boaSourceFile, dealertrackSourceFile } = await seedHurstSourcePair(repository, false);

    await expect(
      createReconciliationRunFromSourceFiles({
        repository,
        dealershipId: 1,
        boaSourceFile,
        dealertrackSourceFile,
        automated: false,
      }),
    ).rejects.toThrow("RAW_BOA");

    const runs = await repository.listReconciliationRuns(1);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "artifact_failed" });
    await expect(
      repository.listReconciliationArtifacts(1, runs[0].reconciliation_run_id),
    ).resolves.toEqual([]);
  });
});

describe("findLatestSourceFilePair", () => {
  test("pairs only sources with the exact non-null accounting period and profile identity", async () => {
    const repository = new MemoryTransactionRepository();
    const april = accountingMonth("2026-04");
    const may = accountingMonth("2026-05");
    const boa = await seedProfiledSource(repository, "boa", april, "hurst-v1", "1");
    await seedProfiledSource(repository, "dealertrack", may, "hurst-v1", "1");
    await seedProfiledSource(repository, "dealertrack", april, "hurst-v1", "2");
    await repository.createSourceFileWithTransactions(
      1,
      {
        dealership_store_id: 1,
        source_type: "dealertrack",
        original_filename: "legacy-dealertrack.csv",
        stored_filename: null,
        file_hash: "legacy-dealertrack-hash",
        row_count: 1,
        validation_error_count: 0,
      },
      [sourceTransaction("dealertrack", -25_000_00)],
    );

    await expect(
      findLatestSourceFilePair(repository, 1, 1, april, "hurst-v1", "1"),
    ).resolves.toBeNull();

    const dealertrack = await seedProfiledSource(
      repository,
      "dealertrack",
      april,
      "hurst-v1",
      "1",
    );

    await expect(
      findLatestSourceFilePair(repository, 1, 1, april, "hurst-v1", "1"),
    ).resolves.toEqual({
      boa: expect.objectContaining({
        source_file_id: boa.id,
        accounting_month: "2026-04",
        rooftop_profile_id: "hurst-v1",
        rooftop_profile_version: "1",
      }),
      dealertrack: expect.objectContaining({
        source_file_id: dealertrack.id,
        accounting_month: "2026-04",
        rooftop_profile_id: "hurst-v1",
        rooftop_profile_version: "1",
      }),
    });
  });
});

async function seedHurstSourcePair(
  repository: MemoryTransactionRepository,
  includeRawUploads: boolean,
): Promise<{ boaSourceFile: SourceFile; dealertrackSourceFile: SourceFile }> {
  const boaImport = await repository.createSourceFileWithTransactions(
    1,
    {
      dealership_store_id: 1,
      source_type: "boa",
      original_filename: "hurst-boa.csv",
      stored_filename: null,
      file_hash: "boa-hash",
      row_count: 1,
      validation_error_count: 0,
    },
    [sourceTransaction("boa", 25_000_00)],
    includeRawUploads
      ? {
          filename: "hurst-boa.csv",
          content_type: "text/csv",
          content: Buffer.from("boa raw"),
        }
      : undefined,
  );
  const dealertrackImport = await repository.createSourceFileWithTransactions(
    1,
    {
      dealership_store_id: 1,
      source_type: "dealertrack",
      original_filename: "hurst-dealertrack.csv",
      stored_filename: null,
      file_hash: "dealertrack-hash",
      row_count: 1,
      validation_error_count: 0,
    },
    [sourceTransaction("dealertrack", -25_000_00)],
    includeRawUploads
      ? {
          filename: "hurst-dealertrack.csv",
          content_type: "text/csv",
          content: Buffer.from("dealertrack raw"),
        }
      : undefined,
  );
  return {
    boaSourceFile: boaImport.sourceFile,
    dealertrackSourceFile: dealertrackImport.sourceFile,
  };
}

function sourceTransaction(sourceType: "boa" | "dealertrack", amountCents: number): NewTransaction {
  return {
    source_file_id: null,
    source_type: sourceType,
    transaction_date: "2026-04-01",
    post_date: null,
    amount_cents: amountCents,
    reference_number: "REF-1",
    description: "Floorplan vehicle",
    account: null,
    stock_number: "H123",
    vin: "1HGCM82633A004352",
    raw_data: { sourceType },
  };
}

function accountingMonth(value: string): AccountingMonth {
  const month = parseAccountingMonth(value);
  if (!month) {
    throw new Error(`Invalid accounting month in test: ${value}`);
  }
  return month;
}

async function seedProfiledSource(
  repository: MemoryTransactionRepository,
  sourceType: "boa" | "dealertrack",
  month: AccountingMonth,
  profileId: RooftopProfileId,
  profileVersion: string,
): Promise<SourceFile> {
  const identity: {
    parser_name: "boa-csv" | "dealertrack-csv";
    preprocessor_name: "boa-floorplan" | "dealertrack-floorplan";
  } = sourceType === "boa"
    ? {
        parser_name: "boa-csv",
        preprocessor_name: "boa-floorplan",
      }
    : {
        parser_name: "dealertrack-csv",
        preprocessor_name: "dealertrack-floorplan",
      };
  const sourceFile: ProfiledNewSourceFile = {
    dealership_store_id: 1,
    source_type: sourceType,
    original_filename: `${sourceType}-${month}-${profileVersion}.csv`,
    stored_filename: null,
    file_hash: `${sourceType}-${month}-${profileVersion}-hash`,
    row_count: 1,
    validation_error_count: 0,
    accounting_month: month,
    rooftop_profile_id: profileId,
    rooftop_profile_version: profileVersion,
    parser_name: identity.parser_name,
    parser_version: "1",
    preprocessor_name: identity.preprocessor_name,
    preprocessor_version: "preprocessing-v1",
    preprocessing_metadata: profiledReceipt(
      sourceType,
      month,
      identity.parser_name,
      identity.preprocessor_name,
    ),
  };
  const result = await repository.createSourceFileWithTransactions(
    1,
    sourceFile,
    [sourceTransaction(sourceType, sourceType === "boa" ? 25_000_00 : -25_000_00)],
  );
  return result.sourceFile;
}

function profiledReceipt(
  sourceType: "boa" | "dealertrack",
  month: AccountingMonth,
  parserName: "boa-csv" | "dealertrack-csv",
  preprocessorName: "boa-floorplan" | "dealertrack-floorplan",
): UploadPreprocessingMetadata {
  return {
    detected_format: "csv",
    detection_confidence: "high",
    detection_reason: "Synthetic profiled source receipt.",
    parser_route: sourceType === "boa" ? "boa_csv" : "dealertrack_csv",
    preprocessing_version: "preprocessing-v1",
    summary: {
      source_kind: sourceType,
      preprocessing_version: "preprocessing-v1",
      parser_name: parserName,
      parser_version: "1",
      parser_format: "csv",
      preprocessor_name: preprocessorName,
      preprocessor_version: "preprocessing-v1",
      period_evidence: {
        source: sourceType,
        selectedMonth: month,
        explicitMonths: [],
        observedDateRange: null,
        filenameHint: null,
        status: "compatible_incomplete",
        safeEvidence: { filename_hint_present: false },
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
  };
}
