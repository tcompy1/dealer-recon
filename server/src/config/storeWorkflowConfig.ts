export const STORE_KEYS = ["hurst", "acura"] as const;

export type StoreKey = (typeof STORE_KEYS)[number];

export type DtOnlyPlacementRule = "after_boa_rows" | "interleave_by_amount";

export type StoreWorkflowConfig = {
  storeKey: StoreKey;
  displayName: string;
  dealershipStoreNameAliases: string[];
  mergedSheetLabel: string;
  dealertrackAccountColumn: string;
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

export const STORE_WORKFLOW_CONFIGS: Record<StoreKey, StoreWorkflowConfig> = {
  hurst: {
    storeKey: "hurst",
    displayName: "Hiley Mazda of Hurst",
    dealershipStoreNameAliases: ["hiley mazda of hurst", "hurst"],
    mergedSheetLabel: "HURST",
    dealertrackAccountColumn: "2100",
    dealertrackAccountLabel: "2100",
    outputFilenamePrefix: "hurst",
    boaDescriptionColumnBehavior: "description_under_store_label",
    totalsRowLabels: {
      boaTotalLabel: "BOA total",
      dealertrackTotalLabel: "2100 total",
      varianceLabel: "Variance",
    },
    dtOnlyPlacementRule: "after_boa_rows",
  },
  acura: {
    storeKey: "acura",
    displayName: "Acura",
    dealershipStoreNameAliases: ["hiley acura", "acura"],
    mergedSheetLabel: "ACURA",
    dealertrackAccountColumn: "324",
    dealertrackAccountLabel: "324",
    outputFilenamePrefix: "acura",
    boaDescriptionColumnBehavior: "description_under_store_label",
    totalsRowLabels: {
      boaTotalLabel: "BOA total",
      dealertrackTotalLabel: "324 total",
      varianceLabel: "Variance",
    },
    dtOnlyPlacementRule: "interleave_by_amount",
  },
};

export function getStoreWorkflowConfig(storeKey: StoreKey): StoreWorkflowConfig {
  return STORE_WORKFLOW_CONFIGS[storeKey];
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
  const normalizedStoreName = normalizeStoreName(storeName);
  if (!normalizedStoreName) {
    return null;
  }

  return (
    STORE_KEYS.map((storeKey) => STORE_WORKFLOW_CONFIGS[storeKey]).find((config) =>
      config.dealershipStoreNameAliases.some((alias) =>
        normalizedStoreName.includes(normalizeStoreName(alias)),
      ),
    ) ?? null
  );
}

function normalizeStoreName(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}
