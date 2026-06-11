import type { StoreWorkflowConfig } from "../config/storeWorkflowConfig.js";
import type { ReconciliationRunDetail } from "../domain/types.js";
import {
  buildMergedFloorplanWorkbookFromReconciliationDetail,
  type MergedFloorplanWorkbook,
  toMergedFloorplanFilename,
  toMergedFloorplanXlsHtml,
} from "../presenters/mergedFloorplan.js";

export type MergedFloorplanArtifact = {
  workbook: MergedFloorplanWorkbook;
  filename: string;
  contentType: string;
  html: string;
};

export function buildMergedFloorplanArtifact(
  detail: ReconciliationRunDetail,
  storeConfig: StoreWorkflowConfig,
): MergedFloorplanArtifact {
  const workbook = buildMergedFloorplanWorkbookFromReconciliationDetail(detail, storeConfig);

  return {
    workbook,
    filename: toMergedFloorplanFilename(workbook),
    contentType: "application/vnd.ms-excel",
    html: toMergedFloorplanXlsHtml(workbook),
  };
}
