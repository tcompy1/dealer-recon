const SPREADSHEET_FORMULA_PREFIX_RE = /^[\u0000-\u001F=+\-@]/;
const PLAIN_NUMERIC_TEXT_RE = /^-?\d+(?:\.\d+)?$/;

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
  return SPREADSHEET_FORMULA_PREFIX_RE.test(value) ? `'${value}` : value;
}
