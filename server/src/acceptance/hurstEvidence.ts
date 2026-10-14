import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const expectedHashes = {
  "golden_dataset.csv": "75b20187b42e521d10cb3554d687871ccb66062fc51076d78a483c8dc221f580",
  "clerk-contract-detail.json": "0cb8a74b9a5e71a8d3460edb460a364cbdd0c74beac54496372d7cabd6f9e8ae"
} as const;
export type HurstEvidenceFile = keyof typeof expectedHashes;

export function requireHurstEvidencePath(root: string | undefined, file: HurstEvidenceFile): string {
  if (!root || !isAbsolute(root)) throw new Error("HURST_EVIDENCE_DIR must explicitly name an absolute protected evidence directory.");
  const path = realpathSync(join(root, file));
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (hash !== expectedHashes[file]) throw new Error("Protected Hurst evidence hash mismatch.");
  return path;
}
export function readHurstEvidence(root: string | undefined, file: HurstEvidenceFile): string {
  return readFileSync(requireHurstEvidencePath(root, file), "utf8");
}
