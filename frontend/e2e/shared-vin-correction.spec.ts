import {expect,test} from "@playwright/test";
import {loadSyntheticWorkflow,openCorrection,propose,confirm,download,correctedVin} from "./vinWorkflow";
for(const key of ["hurst","acura"] as const)test(`${key} rejects delayed stale form and keeps legacy downloads`,async({page,context})=>{
 const tag=`browser-stale-${key}`;await loadSyntheticWorkflow(page,key,tag);await page.getByRole("button",{name:"Run Workflow"}).click();await expect(page.getByRole("link",{name:"Download FP REC"})).toBeVisible();const old=await download(page,"Download FP REC");expect(old.name).toMatch(/\.xls$/);
 const other=await context.newPage();await loadSyntheticWorkflow(other,key,tag);
 await openCorrection(page,0);await propose(page,correctedVin);await openCorrection(other,0);await propose(other,"1ZZAA11A1ZA100004");await confirm(page);
 await other.getByRole("button",{name:"Confirm VIN correction"}).click();await expect(other.getByRole("button",{name:"Refresh and review"})).toBeVisible();await expect(other.getByRole("button",{name:"Confirm VIN correction"})).toBeDisabled();await other.getByRole("button",{name:"Refresh and review"}).click();await expect(other.getByRole("textbox",{name:"Proposed VIN",exact:true})).toHaveValue("");await expect(other.getByRole("checkbox")).not.toBeChecked();
 await propose(other,"1ZZAA11A1ZA100004");await confirm(other);expect((await download(page,"Download FP REC")).bytes.equals(old.bytes)).toBe(true);await other.close();
});
