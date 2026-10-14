import type {ReconciliationRunDetail} from "../domain/types.js";
import type {RooftopProfile} from "../config/storeWorkflowConfig.js";
import {buildMergedFloorplanArtifact} from "./mergedFloorplanExport.js";
import {type MergedFloorplanWorkbook} from "../presenters/mergedFloorplan.js";
import {buildFpRecWorkbook,toFpRecFilename,toFpRecXlsHtml,type FpRecWorkbook} from "../presenters/fpRec.js";
export type BinaryFloorplanArtifact<T>={workbook:T;filename:string;contentType:string;content:Buffer};
export async function buildFloorplanExports(detail:ReconciliationRunDetail,profile:RooftopProfile):Promise<{merged:BinaryFloorplanArtifact<MergedFloorplanWorkbook>;fpRec:BinaryFloorplanArtifact<FpRecWorkbook>}> {
 const merged=buildMergedFloorplanArtifact(detail,profile),fpRec=buildFpRecWorkbook(detail,profile);
 return {merged:{workbook:merged.workbook,filename:merged.filename,contentType:merged.contentType,content:Buffer.from(merged.html,"utf8")},fpRec:{workbook:fpRec,filename:toFpRecFilename(fpRec),contentType:"application/vnd.ms-excel",content:Buffer.from(toFpRecXlsHtml(fpRec),"utf8")}};
}
