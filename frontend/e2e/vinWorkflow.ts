import {expect,type Page} from "@playwright/test";
export const originalVin="1ZZAA11A1ZA100001",correctedVin="1ZZAA11A1ZA100003";
export async function loadSyntheticWorkflow(page:Page,key:"fw"|"hurst"|"acura",tag:string,offset=false){
 await page.goto("/");const label={fw:"Hiley Cars Fort Worth",hurst:"Hiley Mazda of Hurst",acura:"Hiley Acura"}[key];
 await page.getByRole("combobox",{name:"Store",exact:true}).selectOption({label:`${label} — Enabled`});await expect(page.getByText(`${key.toUpperCase()} profile enabled`)).toBeVisible();
 const storeId=Number(await page.getByRole("combobox",{name:"Store",exact:true}).inputValue());
 await page.getByLabel("Accounting month").fill("2026-04");
 const boa=`Dealer Billing Statement for: April 2026\nSerial,Stock Number,Description,Ending Balance,Maturity Date\n${originalVin},T1,${tag} original ${originalVin},125,2027-01-01\n`;
 const dt=key==="fw"?`Control,Description,2100,2101,2101S,2110\nT1,${tag} original ${originalVin},-120,-3,-2,0\n${offset?`T2,${tag} offset,123,-123,,0\n`:""}`:`Control,Description,${key==="acura"?"324":"2100"}\nT1,${tag} original ${originalVin},-125\n`;
 await page.getByLabel("BOA input file").setInputFiles({name:`${tag}-boa-2026-04.csv`,mimeType:"text/csv",buffer:Buffer.from(boa)});
 const boaResponse=page.waitForResponse(r=>new URL(r.url()).pathname==="/upload" && r.request().method()==="POST");
 await page.getByRole("button",{name:"Upload",exact:true}).nth(0).click();await expect(page.getByText(/source_file_id:/)).toHaveCount(1);
 const boaResult=await boaResponse;expect(boaResult.status()).toBe(200);const boaUpload=await boaResult.json();
 await page.getByLabel("Dealertrack input file").setInputFiles({name:`${tag}-dt-2026-04.csv`,mimeType:"text/csv",buffer:Buffer.from(dt)});
 const dtResponse=page.waitForResponse(r=>new URL(r.url()).pathname==="/upload" && r.request().method()==="POST");
 await page.getByRole("button",{name:"Upload",exact:true}).nth(1).click();await expect(page.getByText(/source_file_id:/)).toHaveCount(2);
 const dtResult=await dtResponse;expect(dtResult.status()).toBe(200);const dtUpload=await dtResult.json();
 for(const upload of [boaUpload,dtUpload])expect(upload).toMatchObject({dealership_store_id:storeId,rooftop_profile_id:`${key}-v1`,accounting_month:"2026-04"});
 await expect(page.getByRole("combobox",{name:"Store",exact:true})).toHaveValue(String(storeId));
 return {storeId,boaUpload,dtUpload};
}
export async function openCorrection(page:Page,side:0|1){
 await page.getByRole("button",{name:/Review current source VINs/}).nth(side).click();
 const panel=page.getByRole("button",{name:/Review current source VINs/}).nth(side).locator("..");
 const verification=page.waitForResponse(r=>r.url().endsWith("/vin-verification") && r.request().method()==="GET");
 await panel.getByRole("button",{name:"Verify or correct VIN"}).first().click();await expect(page.getByRole("dialog")).toBeVisible();await expect(page.getByRole("dialog").getByText("Revision being reviewed")).toBeVisible();
 const response=await verification;expect(response.status()).toBe(200);return response.json();
}
export async function propose(page:Page,vin:string){await page.getByRole("textbox",{name:"Proposed VIN",exact:true}).fill(vin);await expect(page.getByRole("button",{name:"Confirm VIN correction"})).toBeDisabled();await page.getByRole("checkbox").check();}
export async function confirm(page:Page){const pending=page.waitForResponse(r=>r.url().endsWith("/vin-enrichment") && r.request().method()==="POST");await page.getByRole("button",{name:"Confirm VIN correction"}).click();await expect(page.getByText(/VIN corrected. Re-run reconciliation/).first()).toBeVisible();const close=page.getByRole("button",{name:"Close",exact:true});if(await close.count())await close.click();const response=await pending;expect(response.status()).toBe(200);return response;}
export async function download(page:Page,name:string){const href=await page.getByRole("link",{name,exact:true}).getAttribute("href");expect(href).toMatch(/\/reconciliation-runs\/\d+\/(merged-floorplan|fp-rec)$/);const stored=await page.request.get(href!);expect(stored.status()).toBe(200);expect(stored.headers()["content-type"]).toContain("application/vnd.ms-excel");const [file]=await Promise.all([page.waitForEvent("download"),page.getByRole("link",{name,exact:true}).click()]);const stream=await file.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));const bytes=Buffer.concat(chunks);expect(bytes.equals(await stored.body())).toBe(true);return {name:file.suggestedFilename(),bytes};}
