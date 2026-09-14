import type { ReconciliationArtifactType } from "../domain/types.js";
import type { DetectedFileFormat } from "../services/fileFormatDetector.js";

export const STORE_KEYS = ["hurst", "acura", "fw"] as const;

export type StoreKey = (typeof STORE_KEYS)[number];

export type DtOnlyPlacementRule = "after_boa_rows" | "interleave_by_amount";

export type StoreWorkflowConfig = {
  storeKey: StoreKey;
  displayName: string;
  dealershipStoreNameAliases: string[];
  mergedSheetLabel: string;
  mergedSheetLabelAliases: string[];
  dealertrackAccountColumn: string;
  dealertrackAmountColumns: string[];
  dealertrackExcludedAccountColumns: string[];
  dealertrackAccountLabel: string;
  outputFilenamePrefix: string;
  boaDescriptionColumnBehavior: "description_under_store_label";
  totalsRowLabels: {
    boaTotalLabel: string;
    dealertrackTotalLabel: string;
    varianceLabel: string;
  };
  dtOnlyPlacementRule: DtOnlyPlacementRule;
};

export type RooftopProfileId = "hurst-v1" | "acura-v1" | "fw-v0";

export type ParserIdentity = {
  name: "boa-csv" | "boa-html-xls" | "dealertrack-csv" | "dealertrack-spreadsheetml";
  version: string;
  format: DetectedFileFormat;
};

export type PreprocessorIdentity = {
  name: "boa-floorplan" | "dealertrack-floorplan";
  version: string;
};

export type RooftopProfile = StoreWorkflowConfig & {
  profileId: RooftopProfileId;
  profileVersion: string;
  enabled: boolean;
  supportedSourceFormats: Record<"boa" | "dealertrack", readonly DetectedFileFormat[]>;
  parserIdentities: Record<"boa" | "dealertrack", readonly ParserIdentity[]>;
  preprocessorIdentities: Record<"boa" | "dealertrack", PreprocessorIdentity>;
  requiredArtifactTypes: readonly ReconciliationArtifactType[];
  presenterId: "hurst-fp-rec-v1" | "acura-fp-rec-v1";
  goldenFixtureIds: readonly string[];
};

export const REQUIRED_RECONCILIATION_ARTIFACT_TYPES = [
  "RAW_BOA",
  "RAW_DEALERTRACK",
  "CLEANED_BOA",
  "CLEANED_DEALERTRACK",
  "MERGED_FLOORPLAN",
  "FP_REC",
] as const satisfies readonly ReconciliationArtifactType[];

export const ROOFTOP_PROFILES: Record<StoreKey, RooftopProfile> = {
  hurst: {
    profileId: "hurst-v1",
    profileVersion: "1",
    enabled: true,
    storeKey: "hurst",
    displayName: "Hiley Mazda of Hurst",
    dealershipStoreNameAliases: ["hiley mazda of hurst", "hurst"],
    mergedSheetLabel: "HURST",
    mergedSheetLabelAliases: ["HURST"],
    dealertrackAccountColumn: "2100",
    dealertrackAmountColumns: ["2100"],
    dealertrackExcludedAccountColumns: ["2110"],
    dealertrackAccountLabel: "2100",
    outputFilenamePrefix: "hurst",
    boaDescriptionColumnBehavior: "description_under_store_label",
    totalsRowLabels: {
      boaTotalLabel: "BOA total",
      dealertrackTotalLabel: "2100 total",
      varianceLabel: "Variance",
    },
    dtOnlyPlacementRule: "after_boa_rows",
    supportedSourceFormats: {
      boa: ["csv", "html_table_xls"],
      dealertrack: ["csv", "xml_spreadsheet"],
    },
    parserIdentities: {
      boa: [
        { name: "boa-csv", version: "1", format: "csv" },
        { name: "boa-html-xls", version: "1", format: "html_table_xls" },
      ],
      dealertrack: [
        { name: "dealertrack-csv", version: "1", format: "csv" },
        { name: "dealertrack-spreadsheetml", version: "1", format: "xml_spreadsheet" },
      ],
    },
    preprocessorIdentities: {
      boa: { name: "boa-floorplan", version: "preprocessing-v1" },
      dealertrack: { name: "dealertrack-floorplan", version: "preprocessing-v1" },
    },
    requiredArtifactTypes: REQUIRED_RECONCILIATION_ARTIFACT_TYPES,
    presenterId: "hurst-fp-rec-v1",
    goldenFixtureIds: ["hurst-feb-2026", "hurst-mar-2026", "hurst-april-2026"],
  },
  acura: {
    profileId: "acura-v1",
    profileVersion: "1",
    enabled: true,
    storeKey: "acura",
    displayName: "Acura",
    dealershipStoreNameAliases: ["hiley acura", "acura"],
    mergedSheetLabel: "ACURA",
    mergedSheetLabelAliases: ["ACURA"],
    dealertrackAccountColumn: "324",
    dealertrackAmountColumns: ["324"],
    dealertrackExcludedAccountColumns: [],
    dealertrackAccountLabel: "324",
    outputFilenamePrefix: "acura",
    boaDescriptionColumnBehavior: "description_under_store_label",
    totalsRowLabels: {
      boaTotalLabel: "BOA total",
      dealertrackTotalLabel: "324 total",
      varianceLabel: "Variance",
    },
    dtOnlyPlacementRule: "interleave_by_amount",
    supportedSourceFormats: {
      boa: ["csv"],
      dealertrack: ["csv"],
    },
    parserIdentities: {
      boa: [{ name: "boa-csv", version: "1", format: "csv" }],
      dealertrack: [{ name: "dealertrack-csv", version: "1", format: "csv" }],
    },
    preprocessorIdentities: {
      boa: { name: "boa-floorplan", version: "preprocessing-v1" },
      dealertrack: { name: "dealertrack-floorplan", version: "preprocessing-v1" },
    },
    requiredArtifactTypes: REQUIRED_RECONCILIATION_ARTIFACT_TYPES,
    presenterId: "acura-fp-rec-v1",
    goldenFixtureIds: ["acura-april-2026-sanitized"],
  },
  fw: {
    profileId: "fw-v0",
    profileVersion: "0",
    enabled: false,
    storeKey: "fw",
    displayName: "Hiley Cars Fort Worth",
    dealershipStoreNameAliases: ["hiley cars fort worth", "fort worth", "fw"],
    mergedSheetLabel: "FW",
    mergedSheetLabelAliases: ["FW", "FORT WORTH"],
    dealertrackAccountColumn: "2100",
    dealertrackAmountColumns: ["2100", "2101", "2101S"],
    dealertrackExcludedAccountColumns: ["2110"],
    dealertrackAccountLabel: "2100",
    outputFilenamePrefix: "fw",
    boaDescriptionColumnBehavior: "description_under_store_label",
    totalsRowLabels: {
      boaTotalLabel: "BOA total",
      dealertrackTotalLabel: "2100 total",
      varianceLabel: "Variance",
    },
    dtOnlyPlacementRule: "after_boa_rows",
    supportedSourceFormats: {
      boa: ["csv", "html_table_xls"],
      dealertrack: ["csv", "xml_spreadsheet"],
    },
    parserIdentities: {
      boa: [
        { name: "boa-csv", version: "1", format: "csv" },
        { name: "boa-html-xls", version: "1", format: "html_table_xls" },
      ],
      dealertrack: [
        { name: "dealertrack-csv", version: "1", format: "csv" },
        { name: "dealertrack-spreadsheetml", version: "1", format: "xml_spreadsheet" },
      ],
    },
    preprocessorIdentities: {
      boa: { name: "boa-floorplan", version: "preprocessing-v1" },
      dealertrack: { name: "dealertrack-floorplan", version: "preprocessing-v1" },
    },
    requiredArtifactTypes: REQUIRED_RECONCILIATION_ARTIFACT_TYPES,
    presenterId: "hurst-fp-rec-v1",
    goldenFixtureIds: [],
  },
};

export const STORE_WORKFLOW_CONFIGS: Record<StoreKey, StoreWorkflowConfig> = ROOFTOP_PROFILES;

export function getRooftopProfile(storeKey: StoreKey): RooftopProfile {
  return ROOFTOP_PROFILES[storeKey];
}

export function getStoreWorkflowConfig(storeKey: StoreKey): StoreWorkflowConfig {
  return getRooftopProfile(storeKey);
}

export function parseStoreKey(value: unknown): StoreKey | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return STORE_KEYS.includes(normalized as StoreKey) ? (normalized as StoreKey) : null;
}

/**
 * Store workflow config is resolved from persisted dealership store identity:
 * uploads keep dealership_store_id, reconciliation runs keep that store id, and
 * run details expose the current store name. Store ids vary by environment, so
 * the workflow matrix maps store names/aliases to the pilot store config.
 */
export function resolveStoreWorkflowConfigFromStoreName(
  storeName: string | null | undefined,
): StoreWorkflowConfig | null {
  return resolveRooftopProfileFromStoreName(storeName);
}

export function resolveRooftopProfileFromStoreName(
  storeName: string | null | undefined,
): RooftopProfile | null {
  const normalizedStoreName = normalizeStoreName(storeName);
  if (!normalizedStoreName) {
    return null;
  }

  return (
    STORE_KEYS.map((storeKey) => ROOFTOP_PROFILES[storeKey]).find((config) =>
      config.dealershipStoreNameAliases.some((alias) =>
        normalizedStoreName.includes(normalizeStoreName(alias)),
      ),
    ) ?? null
  );
}

export function resolveEnabledRooftopProfileFromStoreName(
  storeName: string | null | undefined,
): RooftopProfile | null {
  const profile = resolveRooftopProfileFromStoreName(storeName);
  return profile?.enabled ? profile : null;
}

function normalizeStoreName(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}
