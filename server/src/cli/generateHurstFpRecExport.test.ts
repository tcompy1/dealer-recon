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
  test("builds a FEB26 clerk-grid export from the golden fixture", async () => {
    const csvText = await readFile(resolve("../sample-data/golden_dataset.csv"), "utf8");
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
    expect(exportResult.workbook.variance_amount_cents).toBe(-57_316_800);
    expect(exportResult.html).toContain("<th>HURST</th>");
    expect(exportResult.html).toContain("<th>Serial No/VIN</th>");
    expect(exportResult.html).toContain("<th>Ending Balance</th>");
    expect(exportResult.html).toContain("<th>2100</th>");
    expect(exportResult.html).toContain("<td>Total</td>");
    expect(exportResult.html).toContain("9,088,877.00");
    expect(exportResult.html).toContain("(9,662,045.00)");
    expect(exportResult.html).toContain("(573,168.00)");
  });

  test("writes requested export formats to disk", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "hurst-fp-rec-export-"));
    try {
      const [written] = await writeHurstFpRecFixtureExports({
        months: ["MAR26"],
        goldenCsvPath: resolve("../sample-data/golden_dataset.csv"),
        outDir,
        formats: ["html"],
      });

      expect(written.month).toBe("MAR26");
      expect(written.files).toHaveLength(1);
      expect(written.files[0]).toMatch(/mar26\.html$/);

      const html = await readFile(written.files[0], "utf8");
      expect(html).toContain("Floorplan Reconciliation - Hiley Mazda of Hurst");
      expect(html).toContain("<th>Control</th>");
      expect(html).toContain("8,606,561.00");
      expect(html).toContain("(8,470,803.00)");
      expect(html).toContain("135,758.00");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
