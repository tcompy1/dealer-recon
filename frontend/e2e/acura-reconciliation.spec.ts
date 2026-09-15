import { expect, test, type Page } from "@playwright/test";

import { ACURA_SANITIZED_FIXTURE_PATHS } from "../../server/src/testFixtures/acura/index.ts";

test("completes the Acura April workflow and explains a March period mismatch", async ({
  page,
}) => {
  await page.goto("/");

  const storeSelect = page.getByRole("combobox", { name: "Store", exact: true });
  await expect(storeSelect).toHaveAccessibleName("Store");
  await storeSelect.selectOption({ label: "Hiley Acura — Enabled" });
  await expect(page.getByText("ACURA profile enabled")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Reconciliation Task" })).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({ hasText: /^Floorplan Reconciliation$/ }),
  ).toBeVisible();
  const accountingMonth = page.getByLabel("Accounting month");
  await expect(accountingMonth).toHaveAccessibleName("Accounting month");
  await expect(accountingMonth).toHaveAttribute("required", "");
  await accountingMonth.fill("2026-04");

  const boaInput = page.getByLabel("BOA input file");
  const dealertrackInput = page.getByLabel("Dealertrack input file");
  await expect(boaInput).toHaveAccessibleName("BOA input file");
  await expect(dealertrackInput).toHaveAccessibleName("Dealertrack input file");
  await boaInput.setInputFiles(ACURA_SANITIZED_FIXTURE_PATHS.boaCsv);
  await dealertrackInput.setInputFiles(ACURA_SANITIZED_FIXTURE_PATHS.dealertrackCsv);

  const uploadButtons = page.getByRole("button", { name: "Upload", exact: true });
  await uploadButtons.nth(0).click();
  await expect(page.getByText(/source_file_id:/)).toHaveCount(1);
  await uploadButtons.nth(1).click();
  await expect(page.getByText(/source_file_id:/)).toHaveCount(2);

  const runWorkflow = page.getByRole("button", { name: "Run Workflow" });
  await expect(runWorkflow).toBeEnabled();
  await runWorkflow.click();
  await expect(page.getByText(/ACURA · Apr 2026 · Run #\d+/).first()).toBeVisible();

  const mergedFilename = await expectArtifactDownload(page, {
    accessibleName: "Download Merged Export",
    suggestedFilename: /^acura-merged-floorplan-2026-04\.xls$/,
    requiredContent: [
      "<title>Merged Floorplan - Hiley Acura</title>",
      "<th>ACURA</th><th>Serial No/VIN</th><th>VIN6</th><th>Ending Balance</th><th>324</th><th>VIN6</th><th>Description</th><th>Control</th>",
    ],
    forbiddenContent: ["<x:ExcelWorksheet>", "Outstanding STMT"],
  });
  const fpRecFilename = await expectArtifactDownload(page, {
    accessibleName: "Download FP REC",
    suggestedFilename: /^floorplan-reconciliation-hiley-acura-2026-04\.xls$/,
    requiredContent: [
      "<title>Floorplan Reconciliation - Hiley Acura</title>",
      "<x:Name>APR26</x:Name>",
      "<x:Name>Print_Area</x:Name>",
      "Outstanding STMT",
      "Net adjustments",
      "Variance",
    ],
    forbiddenContent: ["Merged Floorplan - Hiley Acura", "<th>Serial No/VIN</th>"],
  });
  expect(mergedFilename).not.toBe(fpRecFilename);

  await accountingMonth.fill("2026-03");
  await expect(page.getByRole("link", { name: "Download Merged Export" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Download FP REC" })).toHaveCount(0);

  await page.getByLabel("BOA input file").setInputFiles(ACURA_SANITIZED_FIXTURE_PATHS.boaCsv);
  await page.getByRole("button", { name: "Upload", exact: true }).nth(0).click();

  await expect(
    page.getByText("The BOA statement period does not match the selected accounting month."),
  ).toBeVisible();
  await expect(
    page.getByText("Select 2026-04 or upload the BOA statement for 2026-03."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Download Merged Export" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Download FP REC" })).toHaveCount(0);
});

type ArtifactDownloadExpectation = {
  accessibleName: string;
  suggestedFilename: RegExp;
  requiredContent: string[];
  forbiddenContent: string[];
};

async function expectArtifactDownload(
  page: Page,
  expectation: ArtifactDownloadExpectation,
): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: expectation.accessibleName }).click(),
  ]);
  const suggestedFilename = download.suggestedFilename();
  expect(suggestedFilename).toMatch(expectation.suggestedFilename);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const artifact = Buffer.concat(chunks);
  expect(artifact.byteLength).toBeGreaterThan(0);

  const artifactText = artifact.toString("utf8");
  for (const marker of expectation.requiredContent) {
    expect(artifactText).toContain(marker);
  }
  for (const marker of expectation.forbiddenContent) {
    expect(artifactText).not.toContain(marker);
  }

  return suggestedFilename;
}
