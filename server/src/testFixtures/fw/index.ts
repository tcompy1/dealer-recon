import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const FW_SYNTHETIC_ROOT = dirname(fileURLToPath(import.meta.url));
export const FW_SANITIZED_FIXTURE_PATHS = Object.fromEntries(
  (["core", "mismatch", "enrichment"] as const).map((name) => [name, {
    boa: join(FW_SYNTHETIC_ROOT, `boa-${name}-sanitized.csv`),
    dealertrack: join(FW_SYNTHETIC_ROOT, `dealertrack-${name}-sanitized.csv`),
    merged: join(FW_SYNTHETIC_ROOT, `merged-${name === "enrichment" ? "enrichment-confirmed" : name}-sanitized.csv`),
  }]),
) as Readonly<Record<"core" | "mismatch" | "enrichment", {boa:string;dealertrack:string;merged:string}>>;

export function readFwSyntheticFixture(path: string): string {
  const actual = realpathSync(path);
  const inside = relative(realpathSync(FW_SYNTHETIC_ROOT), actual);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new Error("Synthetic fixture path outside approved root");
  return readFileSync(actual, "utf8");
}
export type FwSanitizedContract = {
  headers: string[];
  cases: Record<"core" | "mismatch" | "enrichment", {
    matched:number;boaOnly:number;dealertrackOnly:number;boaCents:number;dealertrackCents:number;
  }>;
  fpRec: {title:string;difference:string;netAdjustments:string;variance:string};
};
export function loadFwSanitizedContract(): FwSanitizedContract {
  return JSON.parse(readFwSyntheticFixture(join(FW_SYNTHETIC_ROOT, "fp-rec-contract.json"))) as FwSanitizedContract;
}
