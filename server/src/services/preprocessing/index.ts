/**
 * Floorplan preprocessing orchestrator.
 *
 * Public entry point used by the upload route. Given an upload buffer plus
 * the operator-declared sourceType, this module:
 *
 *   1. sniffs the file format via the existing fileFormatDetector
 *   2. routes through the existing parser modules
 *   3. invokes the deterministic per-source preprocessor
 *   4. for unsupported formats (or CSV uploads, which keep the legacy
 *      transactionNormalizer path), returns null so the caller can fall back
 *
 * The orchestrator is intentionally narrow: it only wires what already
 * exists. It does not invent new parser abstractions.
 */

import type { NewTransaction, SourceType, ValidationError } from "../../domain/types.js";
import {
  type FileFormatDetection,
  detectFileFormat,
} from "../fileFormatDetector.js";
import {
  type ParserRoute,
  parseWithRoute,
  resolveParserRoute,
} from "../parsers/sourceParserRouter.js";
import type { ParsedTable } from "../parsers/types.js";
import { preprocessBoa } from "./boaPreprocessor.js";
import { preprocessDealertrack } from "./dealertrackPreprocessor.js";
import type { PreprocessingDiagnostic, PreprocessingResult, PreprocessingSummary } from "./types.js";

export type PreprocessingOrchestrationOutput = {
  transactions: NewTransaction[];
  validationErrors: ValidationError[];
  diagnostics: PreprocessingDiagnostic[];
  summary: PreprocessingSummary;
  detection: FileFormatDetection;
  route: ParserRoute;
};

export type PreprocessingOrchestrationDecision =
  | { kind: "preprocessed"; output: PreprocessingOrchestrationOutput }
  | {
      kind: "fallback_legacy_csv";
      detection: FileFormatDetection;
      route: ParserRoute;
    }
  | {
      kind: "unsupported";
      detection: FileFormatDetection;
      route: ParserRoute;
      reason: string;
    };

export function preprocessUpload(
  buffer: Buffer,
  sourceType: SourceType,
  originalFilename: string | null = null,
): PreprocessingOrchestrationDecision {
  const detection = detectFileFormat(buffer, originalFilename);
  const route = resolveParserRoute(detection.format, sourceType);

  if (route.kind === "csv") {
    return { kind: "fallback_legacy_csv", detection, route };
  }

  if (route.kind === "unsupported" || route.kind === "xlsx_native") {
    return {
      kind: "unsupported",
      detection,
      route,
      reason:
        route.kind === "xlsx_native"
          ? "OOXML native parser not yet implemented; resubmit as CSV or SpreadsheetML export."
          : `Detected format ${detection.format} cannot be used for ${sourceType} uploads.`,
    };
  }

  const parsed = parseWithRoute(route, buffer);
  if (!parsed) {
    return {
      kind: "unsupported",
      detection,
      route,
      reason: "Parser route resolved but parser returned no table.",
    };
  }

  const preprocessing = runPreprocessor(sourceType, parsed);
  return {
    kind: "preprocessed",
    output: { ...preprocessing, detection, route },
  };
}

function runPreprocessor(sourceType: SourceType, parsed: ParsedTable): PreprocessingResult {
  if (sourceType === "boa") {
    return preprocessBoa(parsed);
  }
  if (sourceType === "dealertrack") {
    return preprocessDealertrack(parsed);
  }
  // For non-floorplan source types we don't currently preprocess. This
  // branch exists to keep the function total — the orchestrator's route
  // resolution will only pick `boa_html` / `dealertrack_xml` for floorplan
  // sources, so in practice this is unreachable.
  return {
    transactions: [],
    validationErrors: [],
    diagnostics: [
      {
        kind: "row_skipped_unknown_structure",
        message: `Preprocessing not implemented for source_type=${sourceType}.`,
        source_row_number: null,
      },
    ],
    summary: {
      source_kind: "boa",
      preprocessing_version: "preprocessing-v1",
      parser_version: null,
      parser_format: null,
      rows_scanned: 0,
      rows_accepted: 0,
      rows_removed_zero_balance: 0,
      rows_removed_straightline: 0,
      rows_removed_banner: 0,
      rows_skipped_unknown: 0,
      rows_requiring_manual_enrichment: 0,
      duplicate_vin6_count: 0,
      preprocessed_at: new Date().toISOString(),
    },
  };
}

export { detectFileFormat } from "../fileFormatDetector.js";
export type { DetectedFileFormat } from "../fileFormatDetector.js";
