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

    expect(output).toContain("matched count: 3");
    expect(output).toContain("exceptions count: 3");
    expect(output).toContain("duplicates count: 1");
    expect(output).toContain("BOA-only rows: 1");
    expect(output).toContain("Dealertrack-only rows: 1");
    expect(output).toContain("duplicate Dealertrack rows: 1");
    expect(output).toContain("reason=stock_number_amount | confidence=0.92");
    expect(output).toContain("stock=M20657");
    expect(output).toContain("stock=M20450");
    stderr.mockRestore();
  });
});
