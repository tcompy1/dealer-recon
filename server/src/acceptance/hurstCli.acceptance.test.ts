import { requireHurstEvidencePath } from "./hurstEvidence.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  buildHurstFpRecFixtureExport,
  parseGoldenFpRecRows,
  writeHurstFpRecFixtureExports,
} from "../cli/generateHurstFpRecExport.js";

describe.runIf(Boolean(process.env.HURST_EVIDENCE_DIR))("protected historical Hurst CLI export", () => {
  test("builds a FEB26 draft workpaper export from the golden fixture", async () => {
    const csvText = await readFile(requireHurstEvidencePath(process.env.HURST_EVIDENCE_DIR, "golden_dataset.csv"), "utf8");
    const rows = parseGoldenFpRecRows(csvText);
    const exportResult = buildHurstFpRecFixtureExport("FEB26", rows);

    expect(exportResult.counts).toEqual({
      matched: 238,
      boaOnly: 0,
      dealertrackOnly: 16,
    });
    expect(exportResult.workbook.store_name).toBe("Hiley Mazda of Hurst");
    expect(exportResult.workbook.boa_total_amount_cents).toBe(908_887_700);
    expect(exportResult.workbook.dealertrack_total_amount_cents).toBe(-966_204_500);
    expect(exportResult.workbook.schedule_not_on_statement.total_amount_cents).toBe(-57_316_800);
    expect(exportResult.workbook.statement_not_on_gl.total_amount_cents).toBe(0);
    expect(exportResult.workbook.net_adjustments_amount_cents).toBe(-57_316_800);
    expect(exportResult.workbook.variance_amount_cents).toBe(0);
    expect(exportResult.html.includes("Outstanding per stmt")).toBe(true);
    expect(exportResult.html.includes("GL Balances")).toBe(true);
    expect(exportResult.html.includes("<td>2100</td>")).toBe(true);
    expect(exportResult.html.includes("On schedule-not on statement")).toBe(true);
    expect(exportResult.html.includes("On statement-not on GL")).toBe(true);
    expect(exportResult.html.includes('x:fmla="=B5"')).toBe(true);
    expect(exportResult.html.includes('x:fmla="=SUM(B3+B6)"')).toBe(true);
    expect(exportResult.html.includes("9,088,877.00")).toBe(true);
    expect(exportResult.html.includes("(9,662,045.00)")).toBe(true);
    expect(exportResult.html.includes("(573,168.00)")).toBe(true);
  });

  test("writes requested export formats to disk", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "hurst-fp-rec-export-"));
    try {
      const [written] = await writeHurstFpRecFixtureExports({
        months: ["MAR26"],
        goldenCsvPath: requireHurstEvidencePath(process.env.HURST_EVIDENCE_DIR, "golden_dataset.csv"),
        outDir,
        formats: ["html"],
      });

      expect(written.month).toBe("MAR26");
      expect(written.files).toHaveLength(1);
      expect(written.files[0]).toMatch(/mar26\.html$/);

      const html = await readFile(written.files[0], "utf8");
      expect(html.includes("Floorplan Reconciliation - Hiley Mazda of Hurst")).toBe(true);
      expect(html.includes("On schedule-not on statement")).toBe(true);
      expect(html.includes("On statement-not on GL")).toBe(true);
      expect(html.includes("8,606,561.00")).toBe(true);
      expect(html.includes("(8,470,803.00)")).toBe(true);
      expect(html.includes("135,758.00")).toBe(true);
      expect(html.includes('x:fmla="=B30-B7"')).toBe(true);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
