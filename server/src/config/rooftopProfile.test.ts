import { describe, expect, test } from "vitest";

import {
  getRooftopProfile,
  REQUIRED_RECONCILIATION_ARTIFACT_TYPES,
  resolveEnabledRooftopProfileFromStoreName,
  resolveRooftopProfileFromStoreName,
  type RooftopProfile,
} from "./storeWorkflowConfig.js";
import {
  ACURA_SANITIZED_FIXTURE_PATHS,
  loadAcuraSanitizedContract,
} from "../testFixtures/acura/index.js";

const ALL_ARTIFACT_TYPES = [
  "RAW_BOA",
  "RAW_DEALERTRACK",
  "CLEANED_BOA",
  "CLEANED_DEALERTRACK",
  "MERGED_FLOORPLAN",
  "FP_REC",
] as const;

describe("rooftop profiles", () => {
  test("Acura resolves to the enabled versioned CSV profile", () => {
    const sanitizedContract = loadAcuraSanitizedContract();
    const profile: RooftopProfile = getRooftopProfile("acura");

    expect(profile).toMatchObject({
      profileId: "acura-v1",
      profileVersion: "1",
      enabled: true,
      dealertrackAccountColumn: "324",
      dealertrackAmountColumns: ["324"],
      dealertrackExcludedAccountColumns: [],
      presenterId: "acura-fp-rec-v1",
      supportedSourceFormats: {
        boa: ["csv"],
        dealertrack: ["csv"],
      },
    });
    expect(profile.requiredArtifactTypes).toEqual(ALL_ARTIFACT_TYPES);
    expect(profile.profileId).toBe(sanitizedContract.profileId);
    expect(profile.goldenFixtureIds).toContain("acura-april-2026-sanitized");
    expect(Object.values(ACURA_SANITIZED_FIXTURE_PATHS)).toHaveLength(4);
  });

  test("Hurst retains its account, exclusion, ordering, and presenter behavior", () => {
    expect(getRooftopProfile("hurst")).toMatchObject({
      profileId: "hurst-v1",
      profileVersion: "1",
      enabled: true,
      dealertrackAccountColumn: "2100",
      dealertrackAmountColumns: ["2100"],
      dealertrackExcludedAccountColumns: ["2110"],
      dtOnlyPlacementRule: "after_boa_rows",
      presenterId: "hurst-fp-rec-v1",
    });
  });

  test("Fort Worth keeps parsing configuration but remains disabled", () => {
    expect(getRooftopProfile("fw")).toMatchObject({
      profileId: "fw-v0",
      enabled: false,
      supportedSourceFormats: {
        boa: ["csv", "html_table_xls"],
        dealertrack: ["csv", "xml_spreadsheet"],
      },
    });
  });

  test.each([
    "Hiley Mazda of Arlington",
    "Hiley Mazda of Burleson",
    "Hiley Mazda of Huntsville",
    "HSV",
    "Hiley Mazda of West",
    "Unknown Motors",
    null,
    undefined,
  ])("%s resolves to no enabled rooftop profile", (storeName) => {
    expect(resolveEnabledRooftopProfileFromStoreName(storeName)).toBeNull();
  });

  test("profile resolution keeps store-name aliases at the profile boundary", () => {
    expect(resolveRooftopProfileFromStoreName("Hiley Acura")?.profileId).toBe("acura-v1");
    expect(resolveRooftopProfileFromStoreName("Hiley Mazda of Hurst")?.profileId).toBe("hurst-v1");
    expect(resolveEnabledRooftopProfileFromStoreName("Fort Worth")).toBeNull();
    expect(REQUIRED_RECONCILIATION_ARTIFACT_TYPES).toEqual(ALL_ARTIFACT_TYPES);
  });
});
