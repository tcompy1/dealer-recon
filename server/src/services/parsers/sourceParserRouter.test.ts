import { describe, expect, test } from "vitest";

import { parseWithRoute, resolveParserRoute } from "./sourceParserRouter.js";

describe("resolveParserRoute", () => {
  test("routes Dealertrack SpreadsheetML to the XML parser", () => {
    const route = resolveParserRoute("xml_spreadsheet", "dealertrack");
    expect(route.kind).toBe("dealertrack_xml");
  });

  test("routes BOA HTML-as-XLS to the BOA parser", () => {
    const route = resolveParserRoute("html_table_xls", "boa");
    expect(route.kind).toBe("boa_html");
  });

  test("rejects Dealertrack file marked as BOA upload", () => {
    const route = resolveParserRoute("xml_spreadsheet", "boa");
    expect(route.kind).toBe("unsupported");
  });

  test("keeps CSV uploads on the existing path", () => {
    const route = resolveParserRoute("csv", "boa");
    expect(route.kind).toBe("csv");
  });

  test("native xlsx is acknowledged but not yet parsed", () => {
    const route = resolveParserRoute("xlsx_ooxml", "dealertrack");
    expect(route.kind).toBe("xlsx_native");
    expect(parseWithRoute(route, Buffer.from(""))).toBeNull();
  });

  test("unknown formats return unsupported", () => {
    const route = resolveParserRoute("unknown", "boa");
    expect(route.kind).toBe("unsupported");
    expect(parseWithRoute(route, Buffer.from(""))).toBeNull();
  });
});
