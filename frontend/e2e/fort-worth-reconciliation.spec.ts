import {expect,test} from "@playwright/test";
import {loadSyntheticWorkflow,openCorrection,propose,confirm,download,correctedVin} from "./vinWorkflow";
test("FW exports unresolved offsets, corrects both sources, reruns and rejects mismatched period",async({page})=>{
 await loadSyntheticWorkflow(page,"fw","browser-fw",true);await page.getByRole("button",{name:"Run Workflow"}).click();await expect(page.getByRole("link",{name:"Download FP REC"})).toBeVisible();
 const merged=await download(page,"Download Merged Export"),fp=await download(page,"Download FP REC");expect(merged.name).toBe("fw-merged-floorplan-2026-04.xls");expect(fp.name).toBe("fw-fp-rec-2026-04.xls");expect(merged.bytes.toString()).toContain("<th x:str>FORT WORTH</th>");expect(fp.bytes.toString()).toContain("Outstanding on STMT");expect(fp.bytes.toString()).toContain('x:fmla="=B6+B3"');
 await openCorrection(page,0);await propose(page,correctedVin);await confirm(page);await expect(page.getByTestId("reconciliation-stale-banner")).toBeVisible();
 const unchanged=await download(page,"Download FP REC");expect(unchanged.bytes.equals(fp.bytes)).toBe(true);
 await page.getByRole("button",{name:"Run Workflow"}).click();await expect(page.getByTestId("reconciliation-stale-banner")).toHaveCount(0);
 await openCorrection(page,1);await propose(page,correctedVin);await confirm(page);await page.getByRole("button",{name:"Run Workflow"}).click();await expect(page.getByTestId("reconciliation-stale-banner")).toHaveCount(0);
 expect((await download(page,"Download FP REC")).bytes.subarray(0,2).toString()).toBe("PK");
 await page.getByLabel("Accounting month").fill("2026-03");
 await page.getByLabel("BOA input file").setInputFiles({name:"wrong-period-2026-04.csv",mimeType:"text/csv",buffer:Buffer.from("Dealer Billing Statement for: April 2026\nSerial,Stock Number,Description,Ending Balance,Maturity Date\n1ZZAA11A1ZA100001,T1,Invented period case,125,2027-01-01\n")});
 await page.getByRole("button",{name:"Upload",exact:true}).nth(0).click();
 await expect(page.getByText("The BOA statement period does not match the selected accounting month.")).toBeVisible();
 await expect(page.getByText("Select 2026-04 or upload the BOA statement for 2026-03.")).toBeVisible();
 await expect(page.getByRole("link",{name:"Download FP REC"})).toHaveCount(0);await expect(page.getByRole("link",{name:"Download Merged Export"})).toHaveCount(0);
});
