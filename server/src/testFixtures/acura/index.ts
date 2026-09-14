import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AcuraSanitizedContract = {
  profileId: "acura-v1";
  accountingMonth: "2026-04";
  counts: {
    boaAccepted: number;
    dealertrackAccepted: number;
    matched: number;
    boaOnly: number;
    dealertrackOnly: number;
    duplicateCandidates: number;
    amountMismatchRows: number;
  };
  totals: {
    boaCents: number;
    dealertrackCents: number;
    differenceCents: number;
    netAdjustmentsCents: number;
    varianceCents: number;
  };
  rowOrder: string[];
  mergedHeaders: ["ACURA", "Serial No/VIN", "VIN6", "Ending Balance", "324", "VIN6", "Description", "Control"];
  fpRec: {
    statementLabel: "Outstanding STMT";
    glLabel: "Total GL";
    differenceFormula: "statement_plus_gl";
    netAdjustmentsFormula: "schedule_only_plus_statement_only";
    varianceFormula: "net_adjustments_minus_difference";
  };
};

export const SANITIZED_ACURA_FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));

export const ACURA_SANITIZED_FIXTURE_PATHS = {
  boaCsv: join(SANITIZED_ACURA_FIXTURE_ROOT, "boa-april-2026-sanitized.csv"),
  dealertrackCsv: join(SANITIZED_ACURA_FIXTURE_ROOT, "dealertrack-april-2026-sanitized.csv"),
  mergedCsv: join(SANITIZED_ACURA_FIXTURE_ROOT, "merged-april-2026-sanitized.csv"),
  contractJson: join(SANITIZED_ACURA_FIXTURE_ROOT, "acura-april-2026-contract.json"),
} as const;

export function loadAcuraSanitizedContract(): AcuraSanitizedContract {
  return JSON.parse(readFileSync(ACURA_SANITIZED_FIXTURE_PATHS.contractJson, "utf8")) as AcuraSanitizedContract;
}
