import {parseAccountingMonth} from "../../domain/accountingMonth.js";
import {ROOFTOP_PROFILES} from "../../config/storeWorkflowConfig.js";
import type {MergedFloorplanRow,MergedFloorplanWorkbook} from "../../presenters/mergedFloorplan.js";
import {formatCents} from "../../domain/money.js";
/** Independently invented writer/model inputs, never a client workbook. */
export function syntheticFwRow(overrides:Partial<MergedFloorplanRow>={}):MergedFloorplanRow {
 return {store_description:"",serial_no_vin:"",boa_vin6:"",ending_balance_cents:null,dealertrack_account_amount_cents:null,dealertrack_vin6:"",dealertrack_description:"",dealertrack_control:"",classification:"boa_only",...overrides};
}
export function syntheticFwWorkbook(rows:MergedFloorplanRow[]=[]):MergedFloorplanWorkbook {
 const boa=rows.reduce((sum,row)=>sum+(row.ending_balance_cents??0),0),dt=rows.reduce((sum,row)=>sum+(row.dealertrack_account_amount_cents??0),0);
 return {accounting_month:parseAccountingMonth("2026-04")!,store_config:ROOFTOP_PROFILES.fw,store_name:"Hiley Cars Fort Worth",period_date:"04-30-26",headers:["FORT WORTH","Serial No/VIN","VIN6","Ending Balance","2100","VIN6","Description","Control"],rows,boa_total_amount:formatCents(boa),boa_total_amount_cents:boa,dealertrack_total_amount:formatCents(dt),dealertrack_total_amount_cents:dt,variance_amount:formatCents(boa+dt),variance_amount_cents:boa+dt};
}
