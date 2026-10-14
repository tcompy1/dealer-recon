import { mkdtempSync, writeFileSync, symlinkSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { FW_SANITIZED_FIXTURE_PATHS, FW_SYNTHETIC_ROOT, loadFwSanitizedContract, readFwSyntheticFixture } from "./index.js";

test("reads only invented fixtures through the validated loader", () => {
  for (const paths of Object.values(FW_SANITIZED_FIXTURE_PATHS)) {
    for (const path of Object.values(paths)) expect(readFwSyntheticFixture(path).length).toBeGreaterThan(0);
  }
  expect(loadFwSanitizedContract().cases.core.matched).toBe(2);
});
test("rejects_fixture_escape_and_symlinks", () => {
  const directory = mkdtempSync(join(tmpdir(), "fw-fixture-safety-"));
  const outside = join(directory, "invented.txt");
  const link = join(FW_SYNTHETIC_ROOT, "escape-test-link");
  writeFileSync(outside, "invented");
  try {
    symlinkSync(outside, link);
    expect(() => readFwSyntheticFixture(outside)).toThrow("outside approved root");
    expect(() => readFwSyntheticFixture(link)).toThrow("outside approved root");
  } finally { unlinkSync(link); rmSync(directory, { recursive:true }); }
});
