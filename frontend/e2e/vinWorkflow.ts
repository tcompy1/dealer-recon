import {expect,type Page} from "@playwright/test";
export const originalVin="1ZZAA11A1ZA100001",correctedVin="1ZZAA11A1ZA100003";
export async function loadSyntheticWorkflow(page:Page,key:"fw"|"hurst"|"acura",tag:string,offset=false){
 await page.goto("/");const label={fw:"Hiley Cars Fort Worth",hurst:"Hiley Mazda of Hurst",acura:"Hiley Acura"}[key];
 await page.getByRole("combobox",{name:"Store",exact:true}).selectOption({label:`${label} — Enabled`});await page.getByLabel("Accounting month").fill("2026-04");
 const boa=`Dealer Billing Statement for: April 2026\nSerial,Stock Number,Description,Ending Balance,Maturity Date\n${originalVin},T1,${tag} original ${originalVin},125,2027-01-01\n`;
 const dt=key==="fw"?`Control,Description,2100,2101,2101S,2110\nT1,${tag} original ${originalVin},-120,-3,-2,0\n${offset?`T2,${tag} offset,123,-123,,0\n`:""}`:`Control,Description,${key==="acura"?"324":"2100"}\nT1,${tag} original ${originalVin},-125\n`;
 await page.getByLabel("BOA input file").setInputFiles({name:`${tag}-boa-2026-04.csv`,mimeType:"text/csv",buffer:Buffer.from(boa)});
 await page.getByRole("button",{name:"Upload",exact:true}).nth(0).click();await expect(page.getByText(/source_file_id:/)).toHaveCount(1);
 await page.getByLabel("Dealertrack input file").setInputFiles({name:`${tag}-dt-2026-04.csv`,mimeType:"text/csv",buffer:Buffer.from(dt)});
 await page.getByRole("button",{name:"Upload",exact:true}).nth(1).click();await expect(page.getByText(/source_file_id:/)).toHaveCount(2);
}
export async function openCorrection(page:Page,side:0|1){
 await page.getByRole("button",{name:/Review current source VINs/}).nth(side).click();
 const panel=page.getByRole("button",{name:/Review current source VINs/}).nth(side).locator("..");
 await panel.getByRole("button",{name:"Verify or correct VIN"}).first().click();await expect(page.getByRole("dialog")).toBeVisible();await expect(page.getByRole("dialog").getByText("Revision being reviewed")).toBeVisible();
}
export async function propose(page:Page,vin:string){await page.getByRole("textbox",{name:"Proposed VIN",exact:true}).fill(vin);await expect(page.getByRole("button",{name:"Confirm VIN correction"})).toBeDisabled();await page.getByRole("checkbox").check();}
export async function confirm(page:Page){await page.getByRole("button",{name:"Confirm VIN correction"}).click();await expect(page.getByText(/VIN corrected. Re-run reconciliation/).first()).toBeVisible();const close=page.getByRole("button",{name:"Close",exact:true});if(await close.count())await close.click();}
export async function download(page:Page,name:string){const [file]=await Promise.all([page.waitForEvent("download"),page.getByRole("link",{name,exact:true}).click()]);const stream=await file.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));return {name:file.suggestedFilename(),bytes:Buffer.concat(chunks)};}
