import { describe, expect, test } from "vitest";

import {
  buildAcuraArtifactsFromEvidence,
  compareFpRecSemantics,
  compareMergedSemantics,
  readExpectedFpRecSemantics,
  readExpectedMergedSemantics,
  resolveAprilAcuraEvidence,
} from "./acuraEvidence.js";

const evidenceRoot = process.env.ACURA_EVIDENCE_DIR;

describe.runIf(Boolean(evidenceRoot))("approved Acura April evidence", () => {
  test("matches merged and FP REC business semantics", async () => {
    const paths = resolveAprilAcuraEvidence(evidenceRoot as string);
    const actual = await buildAcuraArtifactsFromEvidence(paths);
    const expectedMerged = readExpectedMergedSemantics(paths.mergedCsv);
    const expectedFpRec = await readExpectedFpRecSemantics(paths.goalWorkbook, "APR26");

    expect({
      matched: actual.merged.rows.filter((row) => row.classification === "matched").length,
      boaOnly: actual.merged.rows.filter((row) => row.classification === "boa_only").length,
      dealertrackOnly: actual.merged.rows.filter((row) => row.classification === "dealertrack_only").length,
      boaCents: actual.merged.boa_total_amount_cents,
      dealertrackCents: actual.merged.dealertrack_total_amount_cents,
      differenceCents: actual.fpRec.summary.difference_amount_cents,
      varianceCents: actual.fpRec.variance_amount_cents,
    }).toEqual({
      matched: 199,
      boaOnly: 0,
      dealertrackOnly: 9,
      boaCents: 1_005_665_140,
      dealertrackCents: -1_039_411_200,
      differenceCents: -33_746_060,
      varianceCents: 0,
    });
    expect(expectedMerged.totals).toEqual({
      boaCents: 1_005_665_140,
      dealertrackCents: -1_039_411_200,
    });
    expect(expectedFpRec.summary).toEqual({
      outstandingStatementCents: 1_005_665_140,
      totalGlCents: -1_039_411_200,
      differenceCents: -33_746_060,
      netAdjustmentsCents: -33_746_060,
      varianceCents: 0,
    });
    expect(compareMergedSemantics(actual.merged, expectedMerged)).toEqual([]);
    expect(compareFpRecSemantics(actual.fpRec, expectedFpRec)).toEqual([]);
  });
});
