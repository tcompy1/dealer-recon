import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { ReconciliationRunDetail } from "../domain/types.js";
import { buildHurstFpRecFixtureExport, parseGoldenFpRecRows } from "../cli/generateHurstFpRecExport.js";
import { buildHurstFpRecWorkbook, toHurstFpRecXlsHtml } from "../presenters/hurstFpRec.js";
import { readHurstEvidence } from "./hurstEvidence.js";

const root = process.env.HURST_EVIDENCE_DIR;
describe.runIf(Boolean(root))("protected historical Hurst workpapers", () => {
  test("preserves the original clerk-detail HTML byte checksum", () => {
    const detail = JSON.parse(readHurstEvidence(root, "clerk-contract-detail.json")) as ReconciliationRunDetail;
    const html = toHurstFpRecXlsHtml(buildHurstFpRecWorkbook(detail));
    expect(createHash("sha256").update(html).digest("hex")).toBe("fd2f02b03ec1d62eece7d509e1d055a80f3eb1170938abe8c1cd6896192e9ebb");
  });
  test.each([
    ["FEB26", 16, 0, -57_316_800, 0, -57_316_800],
    ["MAR26", 6, 10, -22_475_800, 36_051_600, 13_575_800],
    ["APRIL26", 2, 4, -6_354_200, 13_576_500, 7_222_300],
  ] as const)("preserves %s historical rendered sections and totals", (month, scheduleCount, statementCount, scheduleTotal, statementTotal, net) => {
    const { workbook, html } = buildHurstFpRecFixtureExport(month, parseGoldenFpRecRows(readHurstEvidence(root, "golden_dataset.csv")));
    expect(workbook.schedule_not_on_statement.rows.length).toBe(scheduleCount);
    expect(workbook.statement_not_on_gl.rows.length).toBe(statementCount);
    expect(workbook.schedule_not_on_statement.total_amount_cents).toBe(scheduleTotal);
    expect(workbook.statement_not_on_gl.total_amount_cents).toBe(statementTotal);
    expect(workbook.net_adjustments_amount_cents).toBe(net);
    expect(workbook.variance_amount_cents).toBe(0);
    // Count serialized detail rows independently of the workbook model. No client cells in diagnostics.
    const rows = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g), match =>
      Array.from(match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g), cell => cell[1].replace(/<[^>]+>/g, "").trim()));
    for (const [title, expected] of [["On schedule-not on statement", scheduleCount], ["On statement-not on GL", statementCount]] as const) {
      const start = rows.findIndex(row => row[0] === title);
      expect(start >= 0).toBe(true);
      const after = rows.slice(start + 1);
      const subtotal = after.findIndex(row => !row[0] && Boolean(row[1]));
      expect(subtotal >= 0).toBe(true);
      expect(after.slice(0, subtotal).filter(row => Boolean(row[0])).length).toBe(expected);
    }
  });
});
