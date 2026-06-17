import { describe, expect, test } from "vitest";

import { neutralizeSpreadsheetText } from "./spreadsheetText.js";

const riskySpreadsheetText = [
  "=SUM(1+1)",
  "+SUM(1+1)",
  "-SUM(1+1)",
  "@SUM(1+1)",
  "\tSUM(1+1)",
  "\rSUM(1+1)",
  "\nSUM(1+1)",
  "\u0001SUM(1+1)",
];

describe("neutralizeSpreadsheetText", () => {
  test.each(riskySpreadsheetText)("prefixes spreadsheet-risky text starting with %#", (value) => {
    expect(neutralizeSpreadsheetText(value)).toBe(`'${value}`);
  });

  test("can preserve plain numeric amount strings when explicitly requested", () => {
    expect(neutralizeSpreadsheetText("-123.45", { preservePlainNumericText: true })).toBe("-123.45");
    expect(neutralizeSpreadsheetText("-SUM(1+1)", { preservePlainNumericText: true })).toBe(
      "'-SUM(1+1)",
    );
  });
});
