export type StoreKey = "hurst" | "acura";

export type DtOnlyPlacementRule = "after_boa_rows" | "interleave_by_amount";

export type StoreWorkflowConfig = {
  storeKey: StoreKey;
  displayName: string;
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
