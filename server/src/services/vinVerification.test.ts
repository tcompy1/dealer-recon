import {expect,test} from "vitest";
import type {Transaction} from "../domain/types.js";
import {LINEAGE_RAW_DATA_KEY} from "./preprocessing/types.js";
import {assessVin,getVinRevision,prepareVinCorrection} from "./vinVerification.js";
const base:Transaction={id:1,dealership_id:1,source_file_id:1,source_type:"boa",transaction_date:null,post_date:null,amount_cents:12500,reference_number:null,description:"Invented",account:null,account_type:"floorplan",account_identifier:"floorplan",stock_number:null,vin:null,raw_data:{},vin_revision:0};
test.each([[null,"missing"],["1ZZAA11A","incomplete"],["invalid!","invalid"],["1ZZAA11A1ZA100001",null]] as const)("assesses only claimed VIN evidence",(vin,flag)=>{
 expect(assessVin({...base,vin}).flags).toEqual(flag?[flag]:[]);
});
test("flags distinct full description identity without changing normalized identity",()=>{
 expect(assessVin({...base,vin:"1ZZAA11A1ZA100001",description:"Invented 1ZZAA11A1ZA100002"}).flags).toEqual(["conflicting"]);
 expect(assessVin({...base,description:"an arbitrary 123 account"}).flags).toEqual(["missing"]);
});
test.each([undefined,-1,0.5,2147483648])("rejects corrupted or absent current revision",vin_revision=>{
 expect(()=>getVinRevision({...base,vin_revision})).toThrow();
});
test("rejects contradictory lineage revision",()=>{
 expect(()=>getVinRevision({...base,raw_data:{[LINEAGE_RAW_DATA_KEY]:{vin_revision:1}}})).toThrow();
});
test("correction preserves raw input and increments revision with audit linkage",()=>{
 const original={...base,raw_data:{description:"untouched"}};
 const change=prepareVinCorrection(original,{id:1,dealership_id:1,dealership_store_id:1,file_hash:"synthetic"}, {expectedRevision:0,vin:"1ZZAA11A1ZA100001",actorUserId:7,actorLabel:"test",confirmedAt:"2026-10-05T00:00:00Z",operatorSource:null,reason:null,reference:null,expectedStoreId:1},12);
 expect(change.transaction.vin_revision).toBe(1);expect(change.transaction.raw_data.description).toBe("untouched");
 expect(change.audit.new_state).toMatchObject({vin_revision:1,source:null,reason:null});
 expect(getVinRevision(change.transaction)).toBe(1);expect(assessVin(change.transaction).operatorConfirmed).toBe(true);
 expect(original).toEqual({...base,raw_data:{description:"untouched"}});
});
test.each([
 {vin_revision:0,raw_data:{[LINEAGE_RAW_DATA_KEY]:{vin_confirmation:{revision:0}}}},
 {vin_revision:0,raw_data:{[LINEAGE_RAW_DATA_KEY]:{vin_enrichment_history:"corrupt"}}},
 {vin_revision:1,vin:"1ZZAA11A1ZA100001",raw_data:{[LINEAGE_RAW_DATA_KEY]:{vin_revision:1,vin_confirmation:{revision:1,vin:"1ZZAA11A1ZA100001",audit_event_id:12}}}},
])("rejects incoherent confirmation provenance",partial=>{
 expect(()=>getVinRevision({...base,...partial})).toThrow("VIN revision metadata is invalid");
});
test("preserves non-string raw values and missing legacy ordinal during correction",()=>{
 const raw={amount:12500,missing:null,nested:{entries:[1,"test"]}};
 const result=prepareVinCorrection({...base,raw_data:raw},{id:1,dealership_id:1,dealership_store_id:1,file_hash:"synthetic"},{expectedRevision:0,vin:"1ZZAA11A1ZA100001",actorUserId:7,actorLabel:"test",confirmedAt:"2026-10-05T00:00:00Z",operatorSource:null,reason:null,reference:null,expectedStoreId:1},12);
 const { [LINEAGE_RAW_DATA_KEY]:saved,...actual}=result.transaction.raw_data;
 expect(actual).toEqual(raw);
 expect(saved).toMatchObject({raw_row_snapshot:raw,source_row_number:null});
});

test("malformed transformation history fails safely before correction",()=>{
 expect(()=>getVinRevision({...base,raw_data:{[LINEAGE_RAW_DATA_KEY]:{transformations:"bad"}}})).toThrow("VIN revision metadata is invalid");
});

test("assesses incomplete and invalid imported source evidence without restoring it as identity",async()=>{
 const {preprocessUpload}=await import("./preprocessing/index.js");const {ROOFTOP_PROFILES}=await import("../config/storeWorkflowConfig.js");const {parseAccountingMonth}=await import("../domain/accountingMonth.js");
 for(const [source,csv,flag] of [
  ["dealertrack","Control,Description,2100,2101,2101S\nT1,Invented short VIN: 1ZZAA11A1ZA10000,-125,0,0\n","incomplete"],
  ["boa","Serial,Stock Number,Description,Ending Balance,Maturity Date\n1ZZAA11A1ZA10000,T1,Invented short,125,2027-01-01\n","incomplete"],
  ["boa","Serial,Stock Number,Description,Ending Balance,Maturity Date\n1ZZAA11A1ZA10000Q,T1,Invented invalid,125,2027-01-01\n","invalid"],
 ] as const){const decision=preprocessUpload(Buffer.from(csv),source,`${source}-2026-04.csv`,{accountingMonth:parseAccountingMonth("2026-04")!,rooftopProfile:ROOFTOP_PROFILES.fw});expect(decision.kind).toBe("preprocessed");if(decision.kind!=="preprocessed")return;expect(decision.output.transactions).toHaveLength(1);const imported={...base,...decision.output.transactions[0],id:1,dealership_id:1,source_file_id:1,vin_revision:0};expect(imported.vin).toBeNull();expect(assessVin(imported).flags,`${source}/${flag}`).toContain(flag);expect(imported.vin).toBeNull();}
});

test.each(["BAD",null,"1ZZAA11A1ZA10000Q"])("rejects malformed confirmed identity even with matching metadata",vin=>{
 const change=prepareVinCorrection(base,{id:1,dealership_id:1,dealership_store_id:1,file_hash:"synthetic"},{expectedRevision:0,vin:"1ZZAA11A1ZA100001",actorUserId:7,actorLabel:"test",confirmedAt:"2026-10-05T00:00:00Z",operatorSource:null,reason:null,reference:null,expectedStoreId:1},12).transaction;
 const saved=change.raw_data[LINEAGE_RAW_DATA_KEY] as Record<string,unknown>;
 (saved.vin_confirmation as Record<string,unknown>).vin=vin;Object.assign(saved.vin_provenance as object,{vin,vin6:vin?.slice(-6)});change.vin=vin;
 expect(()=>getVinRevision(change)).toThrow("VIN revision metadata is invalid");
});

test.each(["Payment reference REF12345","Part code PART12345678"])("does not claim unrelated prose as incomplete VIN",description=>{expect(assessVin({...base,description}).flags).toEqual(["missing"]);});
