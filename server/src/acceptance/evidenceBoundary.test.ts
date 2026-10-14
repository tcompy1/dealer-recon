import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import ts from "typescript";
import { requireHurstEvidencePath } from "./hurstEvidence.js";
import { resolveAprilAcuraEvidence } from "./acuraEvidence.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const self = "server/src/acceptance/evidenceBoundary.test.ts";
const legacy = (path: string) => /^(docs\/discovery\/floorplan\/(acura|hurst)\/.*\.(csv|xlsx?)|server\/src\/services\/__fixtures__\/DT HURST APRIL \(1\)\.csv|(?:sample-data|server\/src\/services\/__fixtures__)\/golden_dataset\.csv)$/.test(path);
function files(): string[] {
  return [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0"))].filter(path => path && existsSync(join(root,path)));
}
function protectedDependency(source: string): boolean {
  const file = ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, true);
  const strings: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) strings.push(node.text);
    if (ts.isPropertyAccessExpression(node)) strings.push(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  const value = strings.join("/");
  return /hiley-artifacts|EVIDENCE_DIR|(?:^|\/)acceptance(?:\/|$)|discovery\/floorplan|golden_dataset\.csv/.test(value);
}
test("known evidence paths cannot return to the current tree", () => {
  const inventory = JSON.parse(readFileSync(join(root,"docs/development/client-evidence-inventory.json"),"utf8")) as { entries: Array<{tracked_path:string}> };
  const restored = inventory.entries.map(entry => entry.tracked_path).filter(legacy).filter(path => existsSync(join(root,path)));
  expect([...new Set([...files().filter(legacy), ...restored])]).toEqual([]);
});
test("ordinary executable code cannot depend on protected acceptance or legacy evidence", () => {
  const offenders = files().filter(path => /\.(?:[cm]?js|tsx?|sh)$/.test(path) && !path.startsWith("server/src/acceptance/") && path !== self)
    .filter(path => protectedDependency(readFileSync(join(root,path), "utf8")));
  expect(offenders).toEqual([]);
});
test("dependency scan catches direct paths, environment access and acceptance imports", () => {
  for (const source of ['readFile("docs/discovery/floorplan/hurst/source.csv")', 'process.env.HURST_EVIDENCE_DIR', 'import { x } from "../acceptance/hurstEvidence.js"', 'readFile("hiley-artifacts" + "/hurst")', 'readFile(`${root}/docs/discovery/hiley-artifacts/hurst/input.csv`)']) expect(protectedDependency(source)).toBe(true);
  expect(protectedDependency('readFile("../sample-data/hurst-synthetic.csv")')).toBe(false);
});
test("known client identities are absent from tracked text, reporting paths only", () => {
  const known = new Set<string>(JSON.parse(readFileSync(join(root,"server/src/testFixtures/known-client-identity-hashes.json"),"utf8")));
  const offenders = files().filter(path => /\.(?:csv|json|md|tsx?|[cm]?js|html|ya?ml|txt)$/.test(path)).filter(path => {
    const tokens = readFileSync(join(root,path),"utf8").match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? [];
    return tokens.some(token => known.has(createHash("sha256").update(token).digest("hex")));
  });
  expect(offenders).toEqual([]);
});
test("Hurst evidence rejects unset, relative, missing and synthetic roots without fallback", () => {
  expect(() => requireHurstEvidencePath(undefined, "golden_dataset.csv")).toThrow("HURST_EVIDENCE_DIR");
  expect(() => requireHurstEvidencePath("", "golden_dataset.csv")).toThrow("HURST_EVIDENCE_DIR");
  expect(() => requireHurstEvidencePath("relative", "golden_dataset.csv")).toThrow("HURST_EVIDENCE_DIR");
  const directory = mkdtempSync(join(tmpdir(), "protected-root-negative-"));
  try {
    expect(() => requireHurstEvidencePath(directory, "golden_dataset.csv")).toThrow();
    writeFileSync(join(directory,"golden_dataset.csv"), "invented substitute");
    expect(() => requireHurstEvidencePath(directory, "golden_dataset.csv")).toThrow("hash mismatch");
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
test("Acura remains explicit opt-in and cannot default its evidence root", () => {
  expect(() => resolveAprilAcuraEvidence(undefined as unknown as string)).toThrow();
  const source = readFileSync(join(root,"server/src/acceptance/acuraEvidence.acceptance.test.ts"),"utf8");
  expect(source).toContain("const evidenceRoot = process.env.ACURA_EVIDENCE_DIR;");
  expect(source).toContain("describe.runIf(Boolean(evidenceRoot))");
  for (const file of ["hurstReconciliation.acceptance.test.ts", "hurstPresenter.acceptance.test.ts", "hurstCli.acceptance.test.ts"]) {
    const text = readFileSync(join(root,"server/src/acceptance",file),"utf8");
    expect(text).toContain("describe.runIf(Boolean(");
    expect(text).toContain("process.env.HURST_EVIDENCE_DIR");
  }
});
