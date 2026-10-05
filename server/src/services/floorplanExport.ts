import type {ReconciliationRunDetail} from "../domain/types.js";
import type {RooftopProfile} from "../config/storeWorkflowConfig.js";
import {buildMergedFloorplanArtifact} from "./mergedFloorplanExport.js";
import {buildMergedFloorplanWorkbookFromReconciliationDetail,type MergedFloorplanWorkbook} from "../presenters/mergedFloorplan.js";
import {buildFortWorthFpRecWorkbook,buildFpRecWorkbook,toFpRecFilename,toFpRecXlsHtml,type FpRecWorkbook} from "../presenters/fpRec.js";
import {writeFortWorthMergedXlsx,writeFortWorthFpRecXlsx} from "../presenters/fortWorthXlsx.js";
export type BinaryFloorplanArtifact<T>={workbook:T;filename:string;contentType:string;content:Buffer};
export const XLSX_MIME="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export async function buildFloorplanExports(detail:ReconciliationRunDetail,profile:RooftopProfile):Promise<{merged:BinaryFloorplanArtifact<MergedFloorplanWorkbook>;fpRec:BinaryFloorplanArtifact<FpRecWorkbook>}> {
 if(profile.profileId==="fw-v1"){
  const merged=buildMergedFloorplanWorkbookFromReconciliationDetail(detail,profile),fpRec=buildFortWorthFpRecWorkbook(merged,profile);
  const mergedBytes=await writeFortWorthMergedXlsx(merged),fpRecBytes=await writeFortWorthFpRecXlsx(fpRec);
  return {merged:{workbook:merged,filename:`fw-merged-floorplan-${merged.accounting_month}.xlsx`,contentType:XLSX_MIME,content:mergedBytes},fpRec:{workbook:fpRec,filename:`fw-fp-rec-${merged.accounting_month}.xlsx`,contentType:XLSX_MIME,content:fpRecBytes}};
 }
 const merged=buildMergedFloorplanArtifact(detail,profile),fpRec=buildFpRecWorkbook(detail,profile);
 return {merged:{workbook:merged.workbook,filename:merged.filename,contentType:merged.contentType,content:Buffer.from(merged.html,"utf8")},fpRec:{workbook:fpRec,filename:toFpRecFilename(fpRec),contentType:"application/vnd.ms-excel",content:Buffer.from(toFpRecXlsHtml(fpRec),"utf8")}};
}
