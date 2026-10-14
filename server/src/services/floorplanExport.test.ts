import {expect,test,vi} from "vitest";
import type {ReconciliationRunDetail} from "../domain/types.js";
import {parseAccountingMonth} from "../domain/accountingMonth.js";
import {ROOFTOP_PROFILES} from "../config/storeWorkflowConfig.js";
import {buildFloorplanExports} from "./floorplanExport.js";
import {buildMergedFloorplanArtifact} from "./mergedFloorplanExport.js";
import {buildFpRecWorkbook,toFpRecXlsHtml} from "../presenters/fpRec.js";
import * as writers from "../presenters/fpRec.js";
const detail={accounting_month:parseAccountingMonth("2026-04")!,store_name:"Hiley Cars Fort Worth",created_at:"2026-04-30T00:00:00Z",match_groups:[],exceptions:[]} as unknown as ReconciliationRunDetail;
test("Fort Worth creates two shared HTML buffers and precise filename/MIME",async()=>{
 const exports=await buildFloorplanExports({...detail,rooftop_profile_id:"fw-v1",rooftop_profile_version:"1"},ROOFTOP_PROFILES.fw);
 for(const [key,name] of [["merged","fw-merged-floorplan-2026-04.xls"],["fpRec","fw-fp-rec-2026-04.xls"]] as const){expect(exports[key].content.toString()).toContain("<!DOCTYPE html>");expect(exports[key].filename).toBe(name);expect(exports[key].contentType).toBe("application/vnd.ms-excel");}
});
test.each(["hurst","acura"] as const)("%s bytes remain identical to existing builders",async key=>{
 const profile=ROOFTOP_PROFILES[key],exports=await buildFloorplanExports(detail,profile);
 expect(exports.merged.content.toString()).toBe(buildMergedFloorplanArtifact(detail,profile).html);
 expect(exports.fpRec.content.toString()).toBe(toFpRecXlsHtml(buildFpRecWorkbook(detail,profile)));
 expect(exports.fpRec.filename).toMatch(/\.xls$/);expect(exports.fpRec.contentType).toBe("application/vnd.ms-excel");
});
test("failure of second serializer rejects whole pair",async()=>{
 const spy=vi.spyOn(writers,"toFpRecXlsHtml").mockImplementation(()=>{throw new Error("synthetic writer failure");});
 try{await expect(buildFloorplanExports(detail,ROOFTOP_PROFILES.fw)).rejects.toThrow("synthetic writer failure");}finally{spy.mockRestore();}
});
