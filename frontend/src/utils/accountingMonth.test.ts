import { describe, expect, test } from "vitest";

import { isAccountingMonth, formatAccountingMonth } from "./accountingMonth";
import { formatRunIdentity } from "./formatRunId";

describe("accounting month display", () => {
  test("accepts only canonical YYYY-MM values", () => {
    expect(isAccountingMonth("2026-04")).toBe(true);
    expect(isAccountingMonth("0001-01")).toBe(true);

    for (const value of ["2026-4", "2026-00", "2026-13", "0000-01", "2026-04-01", ""]) {
      expect(isAccountingMonth(value)).toBe(false);
    }
  });

  test("formats a canonical accounting month without local-time parsing", () => {
    expect(formatAccountingMonth("2026-04")).toBe("Apr 2026");
    expect(formatAccountingMonth("2026-12")).toBe("Dec 2026");
  });

  test("formats the returned numeric run identity with profile and month", () => {
    expect(formatRunIdentity("acura-v1", "2026-04", 42)).toBe(
      "ACURA · Apr 2026 · Run #42",
    );
    expect(formatRunIdentity("hurst-v1", "2026-03", 7)).toBe(
      "HURST · Mar 2026 · Run #7",
    );
  });
});
