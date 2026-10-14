import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import {
  buildHurstFpRecFixtureExport,
  parseGoldenFpRecRows,
  writeHurstFpRecFixtureExports,
} from "./generateHurstFpRecExport.js";

describe("generateHurstFpRecExport", () => {
  test("builds a FEB26 draft workpaper export from the invented fixture", async () => {
    const csvText = await readFile(resolve("../sample-data/hurst-synthetic.csv"), "utf8");
    const rows = parseGoldenFpRecRows(csvText);
    const exportResult = buildHurstFpRecFixtureExport("FEB26", rows);

    expect(exportResult.counts).toEqual({
      matched: 2,
      boaOnly: 0,
      dealertrackOnly: 1,
    });
    expect(exportResult.workbook.store_name).toBe("Hiley Mazda of Hurst");
    expect(exportResult.workbook.boa_total_amount_cents).toBe(300_000);
    expect(exportResult.workbook.dealertrack_total_amount_cents).toBe(-330_000);
    expect(exportResult.workbook.schedule_not_on_statement.total_amount_cents).toBe(-30_000);
    expect(exportResult.workbook.statement_not_on_gl.total_amount_cents).toBe(0);
    expect(exportResult.workbook.net_adjustments_amount_cents).toBe(-30_000);
    expect(exportResult.workbook.variance_amount_cents).toBe(0);
    expect(exportResult.html).toContain("Outstanding per stmt");
    expect(exportResult.html).toContain("GL Balances");
    expect(exportResult.html).toContain("<td>2100</td>");
    expect(exportResult.html).toContain("On schedule-not on statement");
    expect(exportResult.html).toContain("On statement-not on GL");
    expect(exportResult.html).toContain('x:fmla="=B5"');
    expect(exportResult.html).toContain('x:fmla="=SUM(B3+B6)"');
    expect(exportResult.html).toContain("3,000.00");
    expect(exportResult.html).toContain("(3,300.00)");
    expect(exportResult.html).toContain("(300.00)");
  });

  test("writes requested export formats to disk", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "hurst-fp-rec-export-"));
    try {
      const [written] = await writeHurstFpRecFixtureExports({
        months: ["MAR26"],
        goldenCsvPath: resolve("../sample-data/hurst-synthetic.csv"),
        outDir,
        formats: ["html"],
      });

      expect(written.month).toBe("MAR26");
      expect(written.files).toHaveLength(1);
      expect(written.files[0]).toMatch(/mar26\.html$/);

      const html = await readFile(written.files[0], "utf8");
      expect(html).toContain("Floorplan Reconciliation - Hiley Mazda of Hurst");
      expect(html).toContain("On schedule-not on statement");
      expect(html).toContain("On statement-not on GL");
      expect(html).toContain("1,900.00");
      expect(html).toContain("(1,600.00)");
      expect(html).toContain("300.00");
      expect(html).toContain('x:fmla="=B16-B7"');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

test("ordinary CLI defaults to independently invented Hurst data", async () => {
  const { execFileSync } = await import("node:child_process");
  const outDir = await mkdtemp(join(tmpdir(), "hurst-synthetic-default-"));
  try {
    const summary = execFileSync(process.execPath, ["--import", "tsx", "src/cli/generateHurstFpRecExport.ts", "--month", "FEB26", "--format", "html", "--out-dir", outDir], { encoding: "utf8" });
    expect(summary.split("\n")[0]).toBe("FEB26: matched=2 boa_only=0 dealertrack_only=1 boa_total=3000.00 dt_2100_total=-3300.00 variance=0.00");
  } finally { await rm(outDir, { recursive: true, force: true }); }
});
