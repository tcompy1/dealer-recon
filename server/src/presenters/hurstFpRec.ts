import {
  ROOFTOP_PROFILES,
  type RooftopProfile,
  type StoreWorkflowConfig,
} from "../config/storeWorkflowConfig.js";
import type { ReconciliationRunDetail } from "../domain/types.js";
import {
  buildFpRecWorkbook,
  buildFpRecWorkbookFromMergedFloorplan as buildProfiledFpRecWorkbookFromMergedFloorplan,
  toFpRecFilename,
  toFpRecXlsHtml,
  type HurstFpRecWorkbook,
} from "./fpRec.js";
import type { MergedFloorplanWorkbook } from "./mergedFloorplan.js";

export type {
  HurstFpRecClerkRow,
  HurstFpRecRow,
  HurstFpRecRowClassification,
  HurstFpRecSection,
  HurstFpRecSummary,
  HurstFpRecWorkbook,
} from "./fpRec.js";

export function buildHurstFpRecWorkbook(
  detail: ReconciliationRunDetail,
  storeConfig: StoreWorkflowConfig = ROOFTOP_PROFILES.hurst,
): HurstFpRecWorkbook {
  return buildFpRecWorkbook(detail, hurstCompatibilityProfile(storeConfig));
}

export function buildFpRecWorkbookFromMergedFloorplan(
  mergedWorkbook: MergedFloorplanWorkbook,
): HurstFpRecWorkbook {
  return buildProfiledFpRecWorkbookFromMergedFloorplan(
    mergedWorkbook,
    hurstCompatibilityProfile(mergedWorkbook.store_config),
  );
}

export function toHurstFpRecXlsHtml(workbook: HurstFpRecWorkbook): string {
  return toFpRecXlsHtml(workbook);
}

export function toHurstFpRecFilename(workbook: HurstFpRecWorkbook): string {
  return toFpRecFilename(workbook);
}

function hurstCompatibilityProfile(storeConfig: StoreWorkflowConfig): RooftopProfile {
  return {
    ...ROOFTOP_PROFILES.hurst,
    ...storeConfig,
    presenterId: "hurst-fp-rec-v1",
  };
}
