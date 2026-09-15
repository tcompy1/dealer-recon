import { formatCents } from "../domain/money.js";
import { neutralizeSpreadsheetText } from "../spreadsheetText.js";
import type {
  NewReconciliationArtifact,
  ReconciliationArtifactMetadata,
  ReconciliationArtifactType,
  ReconciliationRun,
  SourceFile,
  Transaction,
} from "../domain/types.js";
import type { TransactionRepository } from "../repositories/transactionRepository.js";
import {
  REQUIRED_RECONCILIATION_ARTIFACT_TYPES,
  ROOFTOP_PROFILES,
  type RooftopProfile,
} from "../config/storeWorkflowConfig.js";
import { buildMergedFloorplanArtifact } from "./mergedFloorplanExport.js";
import {
  buildHurstFpRecWorkbook,
  toHurstFpRecFilename,
  toHurstFpRecXlsHtml,
} from "../presenters/hurstFpRec.js";

type CsvScalar = string | number | null;
type CsvCell = CsvScalar | { value: CsvScalar; preservePlainNumericText?: boolean };

export const REQUIRED_HURST_V1_ARTIFACT_TYPES = REQUIRED_RECONCILIATION_ARTIFACT_TYPES;

export class ReconciliationArtifactPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconciliationArtifactPersistenceError";
  }
}

export type PersistReconciliationRunArtifactsInput = {
  repository: TransactionRepository;
  dealershipId: number;
  run: ReconciliationRun;
  rooftopProfile: RooftopProfile;
  boaSourceFile: SourceFile;
  dealertrackSourceFile: SourceFile;
  boaTransactions: Transaction[];
  dealertrackTransactions: Transaction[];
  uploadedByUserId: number | null;
};

export async function persistReconciliationRunArtifacts({
  repository,
  dealershipId,
  run,
  rooftopProfile,
  boaSourceFile,
  dealertrackSourceFile,
  boaTransactions,
  dealertrackTransactions,
  uploadedByUserId,
}: PersistReconciliationRunArtifactsInput): Promise<ReconciliationArtifactMetadata[]> {
  const persistedProfile = resolvePersistedRunProfile(run, rooftopProfile);
  const detail = await repository.getReconciliationRunDetail(dealershipId, run.id);
  if (!detail) {
    throw new ReconciliationArtifactPersistenceError(
      `Cannot persist artifacts for reconciliation run ${run.id}: run detail is unavailable.`,
    );
  }

  if (!run.accounting_month) {
    throw new ReconciliationArtifactPersistenceError(
      `Cannot persist artifacts for reconciliation run ${run.id}: accounting month is unavailable.`,
    );
  }
  const accountingMonth = run.accounting_month;
  const base = {
    reconciliation_run_id: run.id,
    store_id: run.dealership_store_id,
    accounting_month: accountingMonth,
    uploaded_by: uploadedByUserId,
  };
  const artifacts: NewReconciliationArtifact[] = [
    ...await rawArtifacts(
      repository,
      dealershipId,
      base,
      boaSourceFile,
      dealertrackSourceFile,
    ),
    cleanedArtifact(base, "CLEANED_BOA", cleanedFilename(boaSourceFile, accountingMonth), boaTransactions),
    cleanedArtifact(
      base,
      "CLEANED_DEALERTRACK",
      cleanedFilename(dealertrackSourceFile, accountingMonth),
      dealertrackTransactions,
    ),
  ];

  const mergedArtifact = buildMergedFloorplanArtifact(detail, persistedProfile);
  const fpRecWorkbook = buildHurstFpRecWorkbook(detail, persistedProfile);
  const fpRecHtml = toHurstFpRecXlsHtml(fpRecWorkbook);
  artifacts.push(
    {
      ...base,
      artifact_type: "MERGED_FLOORPLAN",
      filename: mergedArtifact.filename,
      content_type: mergedArtifact.contentType,
      content: Buffer.from(mergedArtifact.html, "utf8"),
    },
    {
      ...base,
      artifact_type: "FP_REC",
      filename: toHurstFpRecFilename(fpRecWorkbook),
      content_type: "application/vnd.ms-excel",
      content: Buffer.from(fpRecHtml, "utf8"),
    },
  );

  assertRequiredArtifacts(
    artifacts.map((artifact) => artifact.artifact_type),
    persistedProfile.requiredArtifactTypes,
    run.id,
    persistedProfile,
  );

  const created = await repository.createReconciliationArtifactBatch(dealershipId, artifacts);
  assertRequiredArtifacts(
    created.map((artifact) => artifact.artifact_type),
    persistedProfile.requiredArtifactTypes,
    run.id,
    persistedProfile,
  );
  return created;
}

async function rawArtifacts(
  repository: TransactionRepository,
  dealershipId: number,
  base: ArtifactBase,
  boaSourceFile: SourceFile,
  dealertrackSourceFile: SourceFile,
): Promise<NewReconciliationArtifact[]> {
  const [boaUpload, dealertrackUpload] = await Promise.all([
    repository.getSourceFileUploadContent(dealershipId, boaSourceFile.id),
    repository.getSourceFileUploadContent(dealershipId, dealertrackSourceFile.id),
  ]);
  const artifacts: NewReconciliationArtifact[] = [];
  if (boaUpload) {
    artifacts.push({
      ...base,
      artifact_type: "RAW_BOA",
      filename: boaUpload.filename,
      content_type: boaUpload.content_type,
      file_size: boaUpload.file_size,
      content: boaUpload.content,
    });
  } else {
    throw new ReconciliationArtifactPersistenceError(
      `Cannot persist required reconciliation artifact RAW_BOA for source file ${boaSourceFile.id}: raw upload content is unavailable.`,
    );
  }
  if (dealertrackUpload) {
    artifacts.push({
      ...base,
      artifact_type: "RAW_DEALERTRACK",
      filename: dealertrackUpload.filename,
      content_type: dealertrackUpload.content_type,
      file_size: dealertrackUpload.file_size,
      content: dealertrackUpload.content,
    });
  } else {
    throw new ReconciliationArtifactPersistenceError(
      `Cannot persist required reconciliation artifact RAW_DEALERTRACK for source file ${dealertrackSourceFile.id}: raw upload content is unavailable.`,
    );
  }
  return artifacts;
}

function assertRequiredArtifacts(
  artifactTypes: readonly ReconciliationArtifactType[],
  requiredArtifactTypes: readonly ReconciliationArtifactType[],
  reconciliationRunId: number,
  rooftopProfile: RooftopProfile,
): void {
  const present = new Set(artifactTypes);
  const missing = requiredArtifactTypes.filter((artifactType) => !present.has(artifactType));
  const unexpected = artifactTypes.filter((artifactType) => !requiredArtifactTypes.includes(artifactType));
  const duplicate = artifactTypes.length !== present.size;
  if (missing.length > 0 || unexpected.length > 0 || duplicate) {
    throw new ReconciliationArtifactPersistenceError(
      `Cannot complete ${rooftopProfile.profileId} reconciliation run ${reconciliationRunId}: artifact set does not match the required profile artifacts.`,
    );
  }
}

function resolvePersistedRunProfile(
  run: ReconciliationRun,
  rooftopProfile: RooftopProfile,
): RooftopProfile {
  if (!run.rooftop_profile_id || !run.rooftop_profile_version) {
    throw new ReconciliationArtifactPersistenceError(
      `Cannot persist artifacts for reconciliation run ${run.id}: rooftop profile identity is unavailable.`,
    );
  }
  if (
    rooftopProfile.profileId !== run.rooftop_profile_id ||
    rooftopProfile.profileVersion !== run.rooftop_profile_version
  ) {
    throw new ReconciliationArtifactPersistenceError(
      `Cannot persist artifacts for reconciliation run ${run.id}: supplied rooftop profile does not match the persisted run identity.`,
    );
  }

  const persistedProfile = Object.values(ROOFTOP_PROFILES).find(
    (profile) =>
      profile.enabled &&
      profile.profileId === run.rooftop_profile_id &&
      profile.profileVersion === run.rooftop_profile_version,
  );
  if (!persistedProfile) {
    throw new ReconciliationArtifactPersistenceError(
      `Cannot persist artifacts for reconciliation run ${run.id}: persisted rooftop profile ${run.rooftop_profile_id}@${run.rooftop_profile_version} is unsupported.`,
    );
  }
  return persistedProfile;
}

type ArtifactBase = Pick<
  NewReconciliationArtifact,
  "reconciliation_run_id" | "store_id" | "accounting_month" | "uploaded_by"
>;

function cleanedArtifact(
  base: ArtifactBase,
  artifactType: Extract<ReconciliationArtifactType, "CLEANED_BOA" | "CLEANED_DEALERTRACK">,
  filename: string,
  transactions: Transaction[],
): NewReconciliationArtifact {
  const csv = toCleanedTransactionsCsv(transactions);
  return {
    ...base,
    artifact_type: artifactType,
    filename,
    content_type: "text/csv; charset=utf-8",
    content: Buffer.from(csv, "utf8"),
  };
}

function cleanedFilename(sourceFile: SourceFile, accountingMonth: string): string {
  const source = sourceFile.source_type === "dealertrack" ? "dealertrack" : sourceFile.source_type;
  const stem = sourceFile.original_filename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${stem || source}-cleaned-${accountingMonth}.csv`;
}

function toCleanedTransactionsCsv(transactions: Transaction[]): string {
  const headers = [
    "transaction_id",
    "source_file_id",
    "source_type",
    "transaction_date",
    "post_date",
    "amount",
    "amount_cents",
    "reference_number",
    "description",
    "account",
    "account_type",
    "account_identifier",
    "stock_number",
    "vin",
  ];
  const rows = transactions.map((transaction) => [
    transaction.id,
    transaction.source_file_id,
    transaction.source_type,
    transaction.transaction_date,
    transaction.post_date,
    { value: formatCents(transaction.amount_cents), preservePlainNumericText: true },
    transaction.amount_cents,
    transaction.reference_number,
    transaction.description,
    transaction.account,
    transaction.account_type,
    transaction.account_identifier,
    transaction.stock_number,
    transaction.vin,
  ]);
  return [headers, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n") + "\n";
}

function toCsvCell(cell: CsvCell): string {
  const value = isCsvCellOptions(cell) ? cell.value : cell;
  const preservePlainNumericText = isCsvCellOptions(cell)
    ? cell.preservePlainNumericText
    : false;
  if (value === null) {
    return "";
  }
  const text = typeof value === "number"
    ? String(value)
    : neutralizeSpreadsheetText(value, { preservePlainNumericText });
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function isCsvCellOptions(cell: CsvCell): cell is { value: CsvScalar; preservePlainNumericText?: boolean } {
  return typeof cell === "object" && cell !== null && "value" in cell;
}
