import { describe, expect, test } from "vitest";

import {
  accountingMonthEndDate,
  formatAccountingMonth,
  parseAccountingMonth,
} from "./accountingMonth.js";

describe("accounting month", () => {
  test("accepts a canonical month and renders its stable English label", () => {
    const month = parseAccountingMonth("2026-04");

    expect(month).toBe("2026-04");
    expect(month && formatAccountingMonth(month)).toBe("Apr 2026");
    expect(month && accountingMonthEndDate(month)).toBe("2026-04-30");
  });

  test("returns the leap-year February month end without local-time parsing", () => {
    const month = parseAccountingMonth("2024-02");

    expect(month && accountingMonthEndDate(month)).toBe("2024-02-29");
  });

  test.each([
    "2026-4",
    "26-04",
    "2026-00",
    "2026-13",
    "0000-01",
    "2026-02-01",
    "2026-04T00:00:00Z",
    " 2026-04 ",
    "",
    null,
    undefined,
    202604,
  ])("rejects non-canonical accounting month %j", (value) => {
    expect(parseAccountingMonth(value)).toBeNull();
  });
});
