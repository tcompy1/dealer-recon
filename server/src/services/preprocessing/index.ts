/**
 * Floorplan preprocessing orchestrator.
 *
 * Public entry point used by the upload route. Given an upload buffer plus
 * the operator-declared sourceType, this module:
 *
 *   1. sniffs the file format via the existing fileFormatDetector
 *   2. routes through the existing parser modules
 *   3. invokes the deterministic per-source preprocessor
 *   4. for unsupported formats (or general legacy CSV uploads where no
 *      source-specific preprocessor applies), returns a fallback decision
 *      so the caller can use the legacy CSV normalizer.
 *
 * BOA and Dealertrack CSV uploads go through the source-specific CSV
 * routes (`boa_csv` / `dealertrack_csv`) so they receive the same
 * deterministic preprocessing as the SpreadsheetML / HTML-as-XLS variants.
 */

import type { ParserIdentity } from "../../config/storeWorkflowConfig.js";
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
import {
  deriveBoaPeriodEvidence,
  deriveDealertrackPeriodEvidence,
  type SourcePeriodValidation,
} from "../sourcePeriodEvidence.js";
import { preprocessBoa } from "./boaPreprocessor.js";
import { preprocessDealertrack } from "./dealertrackPreprocessor.js";
import type {
  PreprocessingDiagnostic,
  PreprocessingResult,
  PreprocessingSummary,
  PreprocessUploadOptions,
} from "./types.js";

export type { PreprocessUploadOptions } from "./types.js";

export type PreprocessingOrchestrationOutput = {
  transactions: NewTransaction[];
  validationErrors: ValidationError[];
  diagnostics: PreprocessingDiagnostic[];
  summary: PreprocessingSummary;
  detection: FileFormatDetection;
  route: ParserRoute;
  periodValidation: SourcePeriodValidation;
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
  originalFilename: string | null,
  options: PreprocessUploadOptions,
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

  const fatalParserWarning = parsed.warnings.find((warning) => warning.fatal);
  if (fatalParserWarning) {
    return {
      kind: "unsupported",
      detection,
      route,
      reason: fatalParserWarning.message,
    };
  }

  if (sourceType !== "boa" && sourceType !== "dealertrack") {
    return {
      kind: "unsupported",
      detection,
      route,
      reason: `Preprocessing not implemented for source_type=${sourceType}.`,
    };
  }
  const parserIdentity = resolveParserIdentity(
    options,
    sourceType,
    route.format,
  );
  if (!parserIdentity) {
    return {
      kind: "unsupported",
      detection,
      route,
      reason: `Detected format ${route.format} is not configured for ${sourceType} in rooftop profile ${options.rooftopProfile.profileId}.`,
    };
  }
  const periodValidation = sourceType === "boa"
    ? deriveBoaPeriodEvidence(parsed, originalFilename, options.accountingMonth)
    : deriveDealertrackPeriodEvidence(parsed, originalFilename, options.accountingMonth);
  const preprocessing = runProfiledPreprocessor(
    sourceType,
    parsed,
    options,
    parserIdentity,
  );
  preprocessing.summary.period_evidence = periodValidation.evidence;
  return {
    kind: "preprocessed",
    output: { ...preprocessing, detection, route, periodValidation },
  };
}

function runProfiledPreprocessor(
  sourceType: "boa" | "dealertrack",
  parsed: ParsedTable,
  options: PreprocessUploadOptions,
  parserIdentity: ParserIdentity,
): PreprocessingResult {
  if (sourceType === "boa") {
    return preprocessBoa(parsed, {
      accountingMonth: options.accountingMonth,
      parserIdentity,
      preprocessorIdentity: options.rooftopProfile.preprocessorIdentities.boa,
    });
  }
  return preprocessDealertrack(parsed, {
    accountingMonth: options.accountingMonth,
    parserIdentity,
    preprocessorIdentity: options.rooftopProfile.preprocessorIdentities.dealertrack,
    amountColumns: options.rooftopProfile.dealertrackAmountColumns,
    accountColumn: options.rooftopProfile.dealertrackAccountColumn,
    accountLabel: options.rooftopProfile.dealertrackAccountLabel,
    excludedAccountColumns: options.rooftopProfile.dealertrackExcludedAccountColumns,
  });
}

function resolveParserIdentity(
  options: PreprocessUploadOptions,
  sourceType: "boa" | "dealertrack",
  format: ParserRoute["format"],
): ParserIdentity | null {
  return options.rooftopProfile.parserIdentities[sourceType].find(
    (identity) => identity.format === format,
  ) ?? null;
}

export { detectFileFormat } from "../fileFormatDetector.js";
export type { DetectedFileFormat } from "../fileFormatDetector.js";
