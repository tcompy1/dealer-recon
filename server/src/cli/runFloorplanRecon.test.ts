import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test, vi } from "vitest";

import { formatReconciliationResult, runLocalFloorplanRecon } from "./runFloorplanRecon.js";

describe("runLocalFloorplanRecon", () => {
  test("runs against committed sample data", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boaFile = resolve("../sample-data/boa_floorplan_sample.csv");
    const dealertrackFile = resolve("../sample-data/dealertrack_floorplan_sample.csv");

    await expect(readFile(boaFile)).resolves.toBeTruthy();
    const result = await runLocalFloorplanRecon({ boaFile, dealertrackFile });
    const output = formatReconciliationResult(result);

    // BOA rows have full VINs, Dealertrack rows do not, so no tier can
    // auto-confirm stock-only pairs. Hiley rules keep amount/stock-only rows
    // in the two worksheet placements.
    expect(output).toContain("matched count: 0");
    expect(output).toContain("exceptions count: 9");
    expect(output).toContain("duplicates count: 0");
    expect(output).toContain("On statement-not on GL: 4");
    expect(output).toContain("On schedule-not on statement: 5");
    expect(output).toContain("Needs manual review: 0");
    expect(output).toContain("stock=M20657");
    expect(output).toContain("stock=M20450");
    stderr.mockRestore();
  });
});
