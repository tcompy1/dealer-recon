/**
 * Source parser router.
 *
 * Pure module-level routing layer that maps `(detectedFormat, sourceType)`
 * onto one of the parser modules. The router itself does not yet touch the
 * upload route or change matching rules — that is intentional. Wiring will
 * land in a follow-up patch after the title-clerk call clarifies which
 * source is authoritative.
 */

import type { SourceType } from "../../domain/types.js";
import type { DetectedFileFormat } from "../fileFormatDetector.js";
import { parseBoaHtmlXls } from "./boaHtmlXlsParser.js";
import { parseDealertrackXml } from "./dealertrackXmlParser.js";
import type { ParsedTable } from "./types.js";

export type ParserRoute =
  | { kind: "csv"; format: "csv" }
  | { kind: "dealertrack_xml"; format: "xml_spreadsheet" }
  | { kind: "boa_html"; format: "html_table_xls" }
  | { kind: "xlsx_native"; format: "xlsx_ooxml" }
  | { kind: "unsupported"; format: DetectedFileFormat };

export function resolveParserRoute(
  detectedFormat: DetectedFileFormat,
  sourceType: SourceType,
): ParserRoute {
  if (detectedFormat === "csv") {
    return { kind: "csv", format: "csv" };
  }
  if (detectedFormat === "xml_spreadsheet") {
    if (sourceType === "dealertrack") {
      return { kind: "dealertrack_xml", format: "xml_spreadsheet" };
    }
    return { kind: "unsupported", format: detectedFormat };
  }
  if (detectedFormat === "html_table_xls") {
    if (sourceType === "boa") {
      return { kind: "boa_html", format: "html_table_xls" };
    }
    return { kind: "unsupported", format: detectedFormat };
  }
  if (detectedFormat === "xlsx_ooxml") {
    return { kind: "xlsx_native", format: "xlsx_ooxml" };
  }
  return { kind: "unsupported", format: detectedFormat };
}

export function parseWithRoute(
  route: ParserRoute,
  buffer: Buffer | string,
): ParsedTable | null {
  switch (route.kind) {
    case "dealertrack_xml":
      return parseDealertrackXml(buffer);
    case "boa_html":
      return parseBoaHtmlXls(buffer);
    case "csv":
    case "xlsx_native":
    case "unsupported":
      return null;
  }
}
