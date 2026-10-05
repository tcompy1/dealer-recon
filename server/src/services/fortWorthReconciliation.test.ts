import {expect,test} from "vitest";
import {reconcileFortWorthTransactions} from "./fortWorthReconciliation.js";
import type {Transaction} from "../domain/types.js";
function tx(id:number,source:"boa"|"dealertrack",amount:number,offset=false):Transaction{return {id,dealership_id:1,source_file_id:source==="boa"?1:2,source_type:source,transaction_date:null,post_date:null,amount_cents:amount,reference_number:null,description:"1ZZAA11A1ZA100001",account:null,account_type:"floorplan",account_identifier:"floorplan",stock_number:"M12345",vin:"1ZZAA11A1ZA100001",raw_data:offset?{__lineage:{offsetting_components:{"2100":12300,"2101":-12300,"2101S":0}}}:{}};}
test("each offset stays one exception even against zero BOA and duplicate offsets",()=>{
 const result=reconcileFortWorthTransactions([tx(1,"boa",0)],[tx(2,"dealertrack",0,true),tx(3,"dealertrack",0,true)]);
 expect(result.matched_count).toBe(0);expect(result.exception_count).toBe(3);expect(result.exceptions.filter(e=>e.source_type==="dealertrack").every(e=>e.exception_category==="unclassified")).toBe(true);expect(result.exceptions.filter(e=>e.description==="Offsetting account balances—review.").map(e=>e.transaction.id)).toEqual([2,3]);
});
test("same VIN differing values stays two exceptions; distinct duplicate transactions survive",()=>{
 const result=reconcileFortWorthTransactions([tx(1,"boa",100),tx(4,"boa",200)],[tx(2,"dealertrack",101),tx(3,"dealertrack",101)]);
 expect(result.matched_count).toBe(0);expect(result.exceptions.map(e=>e.transaction.id).sort()).toEqual([1,2,3,4]);
});
test("offset diagnostic presence uses full populations without duplicate VIN summaries",()=>{
 const result=reconcileFortWorthTransactions([tx(1,"boa",100)],[tx(2,"dealertrack",0,true),tx(3,"dealertrack",101)]);
 expect(result.vin_presence_diagnostics.extracted_vin_sets.dealertrack).toHaveLength(1);
 expect(result.vin_presence_diagnostics.extracted_vin_sets.dealertrack[0].transaction_ids.sort()).toEqual([2,3]);
 const only=reconcileFortWorthTransactions([tx(1,"boa",100)],[tx(2,"dealertrack",0,true)]);
 expect(only.vin_presence_diagnostics.vin_presence_exceptions.boa_not_in_dealertrack).toEqual([]);
 expect(only.vin_presence_diagnostics.transaction_unmatched_shared_vins).toHaveLength(1);
});
