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
import type { RooftopValidationErrorCode } from "../rooftopValidation.js";
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
  validationFailure: ProfiledUploadValidationFailure | null;
};

export type ProfiledUploadValidationFailure = {
  code: RooftopValidationErrorCode;
  message: string;
  evidence: Record<string, string | number | boolean | null>;
  recovery: string;
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
      validationFailure?: ProfiledUploadValidationFailure;
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
    const sourceTypeUncertain =
      route.kind === "unsupported" &&
      ((sourceType === "boa" && detection.format === "xml_spreadsheet") ||
        (sourceType === "dealertrack" && detection.format === "html_table_xls"));
    return {
      kind: "unsupported",
      detection,
      route,
      reason:
        route.kind === "xlsx_native"
          ? "OOXML native parser not yet implemented; resubmit as CSV or SpreadsheetML export."
          : `Detected format ${detection.format} cannot be used for ${sourceType} uploads.`,
      validationFailure: sourceTypeUncertain
        ? {
            code: "SOURCE_TYPE_UNCERTAIN",
            message: "The detected source structure does not match the selected source type.",
            evidence: detectionEvidence(detection, route),
            recovery: "Select the matching source type or upload the correct source export.",
          }
        : {
            code: "SOURCE_FORMAT_UNSUPPORTED",
            message: "The uploaded source format is not supported for this rooftop.",
            evidence: detectionEvidence(detection, route),
            recovery: "Export the source in a format supported by the selected rooftop and upload it again.",
          },
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
      validationFailure: {
        code: "STRUCTURALLY_INVALID_TRANSACTIONS",
        message: fatalParserWarning.message,
        evidence: {
          ...detectionEvidence(detection, route),
          parser_warning_kind: fatalParserWarning.kind,
          parser_warning_count: fatalParserWarning.count ?? null,
        },
        recovery: "Correct the malformed source export and upload it again.",
      },
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
      validationFailure: {
        code: "SOURCE_FORMAT_UNSUPPORTED",
        message: "The uploaded source format is not supported for this rooftop.",
        evidence: detectionEvidence(detection, route),
        recovery: "Export the source in a format supported by the selected rooftop and upload it again.",
      },
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
  const validationFailure = validateProfiledPreprocessing(
    parsed,
    sourceType,
    options,
    preprocessing,
    periodValidation,
  );
  return {
    kind: "preprocessed",
    output: {
      ...preprocessing,
      detection,
      route,
      periodValidation,
      validationFailure,
    },
  };
}

function validateProfiledPreprocessing(
  parsed: ParsedTable,
  sourceType: "boa" | "dealertrack",
  options: PreprocessUploadOptions,
  preprocessing: PreprocessingResult,
  periodValidation: SourcePeriodValidation,
): ProfiledUploadValidationFailure | null {
  const missingColumns = findMissingRequiredColumns(parsed, sourceType, options);
  if (missingColumns.length > 0) {
    return {
      code: "REQUIRED_COLUMNS_MISSING",
      message: `The uploaded ${sourceType.toUpperCase()} source is missing required columns.`,
      evidence: {
        missing_columns: missingColumns.join(","),
        missing_column_count: missingColumns.length,
      },
      recovery: `Export ${sourceType.toUpperCase()} with the required rooftop columns and upload it again.`,
    };
  }

  if (!periodValidation.ok) {
    const isBoaMismatch =
      sourceType === "boa" && periodValidation.code === "SOURCE_PERIOD_MISMATCH";
    return {
      code: periodValidation.code,
      message: isBoaMismatch
        ? "The BOA statement period does not match the selected accounting month."
        : "The source contains accounting-period evidence that contradicts the selected month.",
      evidence: periodValidation.evidence.safeEvidence,
      recovery: periodValidation.recovery,
    };
  }

  if (preprocessing.transactions.length === 0) {
    if (options.rooftopProfile.profileId === "hurst-v1") {
      return null;
    }
    const evidence = {
      rows_scanned: preprocessing.summary.rows_scanned,
      rows_accepted: preprocessing.summary.rows_accepted,
      rows_skipped_unknown: preprocessing.summary.rows_skipped_unknown,
      validation_error_count: preprocessing.validationErrors.length,
    };
    if (sourceType === "dealertrack" && options.rooftopProfile.profileId === "acura-v1") {
      return {
        code: "ACURA_ACCOUNT_324_EMPTY",
        message: "The Acura Dealertrack source contains no usable account 324 rows.",
        evidence: {
          ...evidence,
          account_column: options.rooftopProfile.dealertrackAccountColumn,
        },
        recovery: "Export Dealertrack with non-zero account 324 detail rows and upload it again.",
      };
    }
    return {
      code: "STRUCTURALLY_INVALID_TRANSACTIONS",
      message: "The uploaded source did not produce any structurally valid transactions.",
      evidence,
      recovery: "Correct the malformed or empty transaction rows and upload the source again.",
    };
  }

  return null;
}

function findMissingRequiredColumns(
  parsed: ParsedTable,
  sourceType: "boa" | "dealertrack",
  options: PreprocessUploadOptions,
): string[] {
  const header = sourceType === "boa" ? findBoaHeader(parsed) : parsed.header;
  if (
    sourceType === "dealertrack" &&
    options.rooftopProfile.profileId !== "acura-v1"
  ) {
    return [];
  }
  if (!header) {
    return sourceType === "boa"
      ? ["Serial No/VIN", "Ending Balance"]
      : ["Control", "Description", ...options.rooftopProfile.dealertrackAmountColumns];
  }
  const normalized = new Set(header.map(normalizeHeader));
  if (sourceType === "boa") {
    const missing: string[] = [];
    if (!hasAnyColumn(normalized, [
      "serialnovin",
      "vinserialnumber",
      "vin",
      "serialnumber",
      "serial",
    ])) {
      missing.push("Serial No/VIN");
    }
    if (!hasAnyColumn(normalized, ["endingbalance", "endingbal", "endbalance"])) {
      missing.push("Ending Balance");
    }
    return missing;
  }

  const missing: string[] = [];
  if (!hasAnyColumn(normalized, ["control", "stock", "stocknumber"])) {
    missing.push("Control");
  }
  if (!hasAnyColumn(normalized, ["description", "memo", "details"])) {
    missing.push("Description");
  }
  for (const amountColumn of options.rooftopProfile.dealertrackAmountColumns) {
    if (!normalized.has(normalizeHeader(amountColumn))) {
      missing.push(amountColumn);
    }
  }
  return missing;
}

function findBoaHeader(parsed: ParsedTable): string[] | null {
  if (parsed.header) {
    return parsed.header;
  }
  const candidates = parsed.rows.slice(0, 25);
  let best: { header: string[]; score: number } | null = null;
  for (const row of candidates) {
    const normalized = new Set(row.map(normalizeHeader));
    const score = [
      hasAnyColumn(normalized, [
        "serialnovin",
        "vinserialnumber",
        "vin",
        "serialnumber",
        "serial",
      ]),
      hasAnyColumn(normalized, ["endingbalance", "endingbal", "endbalance"]),
      hasAnyColumn(normalized, ["stockleaseno", "stocknumber", "stock"]),
      hasAnyColumn(normalized, ["originalamount"]),
    ].filter(Boolean).length;
    if (!best || score > best.score) {
      best = { header: row, score };
    }
  }
  return best && best.score > 0 ? best.header : null;
}

function hasAnyColumn(columns: Set<string>, aliases: string[]): boolean {
  return aliases.some((alias) => columns.has(alias));
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function detectionEvidence(
  detection: FileFormatDetection,
  route: ParserRoute,
): Record<string, string | number | boolean | null> {
  return {
    detected_format: detection.format,
    detection_confidence: detection.confidence,
    parser_route: route.kind,
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
