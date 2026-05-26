import type {
  PreprocessingDiagnostic,
  PreprocessingDiagnosticKind,
  UploadPreprocessingMetadata,
} from "../../types/sourceFile";

export type DiagnosticGroupId =
  | "removed_automatically"
  | "needs_attention"
  | "vin_cleanup"
  | "amount_warnings"
  | "parser_warnings";

export type DiagnosticGroup = {
  id: DiagnosticGroupId;
  /** Heading shown to the clerk. */
  title: string;
  /** One-line plain-language description of what this section means. */
  blurb: string;
  /** Visual urgency tier — drives styling. */
  tone: "info" | "calm" | "attention" | "urgent";
  diagnostics: PreprocessingDiagnostic[];
};

const KIND_TO_GROUP: Record<PreprocessingDiagnosticKind, DiagnosticGroupId> = {
  banner_row_removed: "removed_automatically",
  header_row_detected: "removed_automatically",
  zero_balance_row_removed: "removed_automatically",
  straightline_row_removed: "removed_automatically",
  row_skipped_unknown_structure: "removed_automatically",
  row_skipped_malformed: "removed_automatically",
  sort_applied: "removed_automatically",

  manual_enrichment_required: "needs_attention",
  missing_vin: "needs_attention",
  missing_amount: "needs_attention",

  untrusted_vin: "vin_cleanup",
  duplicate_vin: "vin_cleanup",
  manual_enrichment_applied: "vin_cleanup",

  ambiguous_amount_column: "amount_warnings",

  parser_warning: "parser_warnings",
  maturity_date_attached: "parser_warnings",
};

const GROUP_TEMPLATES: Record<DiagnosticGroupId, Omit<DiagnosticGroup, "diagnostics">> = {
  removed_automatically: {
    id: "removed_automatically",
    title: "Removed automatically",
    blurb:
      "Rows the system pulled out so they don't reach reconciliation. These do not need clerk action.",
    tone: "calm",
  },
  needs_attention: {
    id: "needs_attention",
    title: "Needs your attention",
    blurb: "Rows that could not be processed cleanly and require clerk review before reconciliation.",
    tone: "urgent",
  },
  vin_cleanup: {
    id: "vin_cleanup",
    title: "VIN cleanup needed",
    blurb: "Rows where the VIN is dirty, untrusted, or appears more than once.",
    tone: "attention",
  },
  amount_warnings: {
    id: "amount_warnings",
    title: "Amount / source-column warnings",
    blurb: "Rows where the system had to make a judgment call about which amount column to use.",
    tone: "attention",
  },
  parser_warnings: {
    id: "parser_warnings",
    title: "Parser / file warnings",
    blurb: "File-level notes from the parser about formatting or metadata.",
    tone: "info",
  },
};

const GROUP_ORDER: DiagnosticGroupId[] = [
  "removed_automatically",
  "needs_attention",
  "vin_cleanup",
  "amount_warnings",
  "parser_warnings",
];

export function groupDiagnostics(diagnostics: PreprocessingDiagnostic[]): DiagnosticGroup[] {
  const buckets = new Map<DiagnosticGroupId, PreprocessingDiagnostic[]>();
  for (const id of GROUP_ORDER) {
    buckets.set(id, []);
  }
  for (const diagnostic of diagnostics) {
    const groupId = KIND_TO_GROUP[diagnostic.kind];
    if (!groupId) {
      continue;
    }
    buckets.get(groupId)?.push(diagnostic);
  }
  return GROUP_ORDER.map((id) => ({
    ...GROUP_TEMPLATES[id],
    diagnostics: buckets.get(id) ?? [],
  }));
}

const KIND_LABELS: Record<PreprocessingDiagnosticKind, string> = {
  banner_row_removed: "Banner/subtotal row removed",
  header_row_detected: "Header row detected",
  zero_balance_row_removed: "Zero-balance row removed",
  straightline_row_removed: "Straightline row removed",
  missing_amount: "Missing amount",
  missing_vin: "Missing VIN",
  duplicate_vin: "Duplicate VIN6",
  untrusted_vin: "Untrusted / dirty VIN",
  manual_enrichment_required: "Needs manual VIN enrichment",
  manual_enrichment_applied: "Manual VIN enrichment applied",
  row_skipped_unknown_structure: "Row skipped (unrecognized structure)",
  row_skipped_malformed: "Row skipped (malformed)",
  maturity_date_attached: "Maturity date attached",
  ambiguous_amount_column: "Ambiguous amount column",
  parser_warning: "Parser warning",
  sort_applied: "Sort applied",
};

export function labelForKind(kind: PreprocessingDiagnosticKind): string {
  return KIND_LABELS[kind] ?? kind;
}

/**
 * Summary counts presented as top-line metrics in the trust panel.
 * Pulled from `summary` when available, with fallbacks calculated from the
 * diagnostics array so the panel degrades gracefully on legacy responses.
 */
export type DiagnosticHeadlineMetrics = {
  rows_scanned: number | null;
  rows_accepted: number | null;
  rows_removed_total: number | null;
  rows_removed_straightline: number | null;
  rows_removed_zero_balance: number | null;
  rows_skipped_unknown: number | null;
  rows_requiring_manual_enrichment: number;
  missing_vin_count: number;
  untrusted_vin_count: number;
  duplicate_vin6_count: number | null;
  ambiguous_amount_count: number;
  parser_warning_count: number;
};

export function computeHeadlineMetrics(
  preprocessing: UploadPreprocessingMetadata,
): DiagnosticHeadlineMetrics {
  const summary = preprocessing.summary;
  const diagnostics = preprocessing.diagnostics ?? [];
  const countByKind = (kind: PreprocessingDiagnosticKind): number =>
    diagnostics.filter((diagnostic) => diagnostic.kind === kind).length;

  const rowsRemovedTotal =
    summary === null
      ? null
      : summary.rows_removed_banner +
        summary.rows_removed_zero_balance +
        summary.rows_removed_straightline +
        summary.rows_skipped_unknown;

  return {
    rows_scanned: summary?.rows_scanned ?? null,
    rows_accepted: summary?.rows_accepted ?? null,
    rows_removed_total: rowsRemovedTotal,
    rows_removed_straightline: summary?.rows_removed_straightline ?? null,
    rows_removed_zero_balance: summary?.rows_removed_zero_balance ?? null,
    rows_skipped_unknown: summary?.rows_skipped_unknown ?? null,
    rows_requiring_manual_enrichment:
      summary?.rows_requiring_manual_enrichment ?? countByKind("manual_enrichment_required"),
    missing_vin_count: countByKind("missing_vin") + countByKind("manual_enrichment_required"),
    untrusted_vin_count: countByKind("untrusted_vin"),
    duplicate_vin6_count: summary?.duplicate_vin6_count ?? countByKind("duplicate_vin"),
    ambiguous_amount_count: countByKind("ambiguous_amount_column"),
    parser_warning_count: countByKind("parser_warning"),
  };
}

/**
 * Plain-language answer to "did the system use the right column?" — used as
 * a reassurance line that swaps in for BOA vs. Dealertrack.
 */
export function describeAmountColumnChoice(
  preprocessing: UploadPreprocessingMetadata,
): string | null {
  const summary = preprocessing.summary;
  if (!summary) {
    return null;
  }
  const ambiguous = (preprocessing.diagnostics ?? []).some(
    (diagnostic) => diagnostic.kind === "ambiguous_amount_column",
  );
  if (summary.source_kind === "boa") {
    return ambiguous
      ? "Used BOA Ending Balance where available; fell back to Original Amount on some rows (see warnings below)."
      : "Used BOA Ending Balance for every row.";
  }
  if (summary.source_kind === "dealertrack") {
    return ambiguous
      ? "Used Dealertrack account 2100 amount where available; fell back to another column on some rows (see warnings below)."
      : "Used Dealertrack account 2100 amount for every row.";
  }
  return null;
}
