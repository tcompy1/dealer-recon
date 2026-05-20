export type ParserWarningKind =
  | "header_not_detected"
  | "header_partial_match"
  | "row_truncated"
  | "row_skipped"
  | "row_limit_exceeded"
  | "empty_document"
  | "unrecognized_construct"
  | "malformed_xml_recovered";

export type ParserWarning = {
  kind: ParserWarningKind;
  message: string;
  count?: number;
};

export type ParsedTable = {
  header: string[] | null;
  rows: string[][];
  warnings: ParserWarning[];
};

export const MAX_PARSED_ROWS = 50_000;
