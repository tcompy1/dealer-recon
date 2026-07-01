const SPREADSHEET_FORMULA_PREFIXES = new Set(["=", "+", "-", "@"]);
const PLAIN_NUMERIC_TEXT_RE = /^-?\d+(?:\.\d+)?$/;

function startsWithSpreadsheetFormulaPrefix(value: string): boolean {
  const firstCharCode = value.charCodeAt(0);
  return firstCharCode <= 0x1f || SPREADSHEET_FORMULA_PREFIXES.has(value[0] ?? "");
}

export type SpreadsheetTextNeutralizeOptions = {
  preservePlainNumericText?: boolean;
};

export function neutralizeSpreadsheetText(
  value: string,
  options: SpreadsheetTextNeutralizeOptions = {},
): string {
  if (value.length === 0) {
    return value;
  }
  if (options.preservePlainNumericText && PLAIN_NUMERIC_TEXT_RE.test(value)) {
    return value;
  }
  return startsWithSpreadsheetFormulaPrefix(value) ? `'${value}` : value;
}
