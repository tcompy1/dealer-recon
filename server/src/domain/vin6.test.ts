import { describe, expect, test } from "vitest";

import { computeVin6, extractVin6FromDescription } from "./vin6.js";

describe("computeVin6", () => {
  test("returns last six characters of a valid 17-character VIN", () => {
    expect(computeVin6("1FTFW1E80PFA11111")).toBe("A11111");
  });

  test("lower-cases input is normalized to upper case", () => {
    expect(computeVin6("1ftfw1e80pfa11111")).toBe("A11111");
  });

  test("returns the last six characters of a short serial that is not a full VIN", () => {
    expect(computeVin6("ABC123456")).toBe("123456");
  });

  test("returns null for missing or empty input", () => {
    expect(computeVin6(null)).toBeNull();
    expect(computeVin6(undefined)).toBeNull();
    expect(computeVin6("")).toBeNull();
    expect(computeVin6("   ")).toBeNull();
  });

  test("returns null for inputs shorter than six characters", () => {
    expect(computeVin6("12345")).toBeNull();
  });
});

describe("extractVin6FromDescription", () => {
  test("extracts VIN6 from a free-text description", () => {
    expect(
      extractVin6FromDescription("BOA FLOORPLAN 1FTFW1E80PFA11111 2024 F150"),
    ).toBe("A11111");
  });

  test("returns null when no VIN is present", () => {
    expect(extractVin6FromDescription("no vin here")).toBeNull();
    expect(extractVin6FromDescription(null)).toBeNull();
  });
});
