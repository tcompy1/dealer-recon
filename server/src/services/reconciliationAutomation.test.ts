import { describe, expect, test } from "vitest";

import type { NewReconciliationArtifact, NewTransaction, SourceFile } from "../domain/types.js";
import { MemoryTransactionRepository } from "../repositories/transactionRepository.js";
import { createReconciliationRunFromSourceFiles } from "./reconciliationAutomation.js";

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
