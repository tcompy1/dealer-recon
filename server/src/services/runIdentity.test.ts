import {expect,test} from "vitest";
import type {TransactionSummary,Transaction,SourceType,ReconciliationRunDetail,ReconciliationRunInputSnapshot} from "../domain/types.js";
import {hydrateRunIdentity} from "./runIdentity.js";
function inputs():{detail:ReconciliationRunDetail;snapshot:ReconciliationRunInputSnapshot} {
 const t:Transaction={...transaction({vin:"1ZZAA11A1ZA100001"}),source_file_id:1,account_type:"floorplan",account_identifier:"floorplan",raw_data:{}};
 const detail=fwEmptyDetail({exceptions:[fwException({transaction:transaction({vin:"1ZZAA11A1ZA100002"})})]});
 return {detail,snapshot:{reconciliation_run_id:detail.reconciliation_run_id,engine_version:"legacy",inputs:[
  {side:"boa",source_type:"boa",source_file_id:1,parser_version:"legacy",parser_metadata:{},transactions:[t]},
  {side:"dealertrack",source_type:"dealertrack",source_file_id:2,parser_version:"legacy",parser_metadata:{},transactions:[]},
 ]}};
}
test("legacy snapshot without revision preserves its identity and reports unknown revision",()=>{
 const {detail,snapshot}=inputs();
 const result=hydrateRunIdentity(detail,snapshot);
 expect(result.exceptions[0].transaction.vin).toBe("1ZZAA11A1ZA100001");
 expect(result.exceptions[0].transaction.source_identity).toEqual({source_row_number:null,vin_revision:null,operator_confirmed_vin:false});
 expect(snapshot.inputs[0].transactions[0]).not.toHaveProperty("vin_revision");
});
test("missing or mismatched snapshot never falls back to current identity",()=>{
 const {detail,snapshot}=inputs();
 expect(()=>hydrateRunIdentity(detail,null)).toThrow("original run identity snapshot is unavailable");
 expect(()=>hydrateRunIdentity(detail,{...snapshot,reconciliation_run_id:999})).toThrow();
 snapshot.inputs[0].transactions[0].dealership_id=9;
 expect(()=>hydrateRunIdentity(detail,snapshot)).toThrow();
});
test("duplicate and wrong-source snapshot membership is rejected",()=>{
 const {detail,snapshot}=inputs();
 snapshot.inputs[0].transactions.push({...snapshot.inputs[0].transactions[0]});
 expect(()=>hydrateRunIdentity(detail,snapshot)).toThrow();
 snapshot.inputs[0].transactions.pop();snapshot.inputs[0].transactions[0].source_file_id=2;
 expect(()=>hydrateRunIdentity(detail,snapshot)).toThrow();
});

function transaction(overrides: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: 1,
    dealership_id: 1,
    source_type: "boa",
    transaction_date: "2026-04-30",
    post_date: null,
    amount: "29855.00",
    amount_cents: 2_985_500,
    reference_number: null,
    description: "2025 Mazda CX5",
    account: null,
    account_type: "floorplan",
    account_identifier: "floorplan",
    stock_number: null,
    vin: "JM3KFBAL0S0764873",
    ...overrides,
  };
}

function fwEmptyDetail(overrides: Partial<ReconciliationRunDetail> = {}): ReconciliationRunDetail {
  return {
    reconciliation_run_id: 42,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Cars Fort Worth",
    dealer_group_id: null,
    dealer_group_name: null,
    boa_source_file_id: 1,
    dealertrack_source_file_id: 2,
    boa_filename: "boa.csv",
    dealertrack_filename: "dealertrack.csv",
    matched_count: 0,
    exception_count: 0,
    duplicate_count: 0,
    status: "completed",
    accounting_month: null,
    rooftop_profile_id: null,
    rooftop_profile_version: null,
    created_at: "2026-05-22T00:00:00.000Z",
    boa_source_file: fwSourceFile(1, "boa"),
    dealertrack_source_file: fwSourceFile(2, "dealertrack"),
    match_groups: [],
    exceptions: [],
    ...overrides,
  };
}

function fwSourceFile(source_file_id: number, source_type: SourceType) {
  return {
    source_file_id,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Cars Fort Worth",
    source_type,
    filename: `${source_type}.csv`,
    row_count: 0,
    validation_error_count: 0,
    accounting_month: null,
    rooftop_profile_id: null,
    rooftop_profile_version: null,
    parser_name: null,
    parser_version: null,
    preprocessor_name: null,
    preprocessor_version: null,
    preprocessing_metadata: null,
    created_at: "2026-05-22T00:00:00.000Z",
  };
}

function fwException(
  partial: Partial<ReconciliationRunDetail["exceptions"][number]>,
): ReconciliationRunDetail["exceptions"][number] {
  return {
    exception_id: 1,
    dealership_id: 1,
    exception_type: "missing_in_dealertrack",
    exception_category: "missing_in_dealertrack",
    status: "unresolved",
    note: "",
    review_status: "unreviewed",
    assigned_to: null,
    review_notes: "",
    boa_notes: "",
    gl_notes: "",
    reviewed_at: null,
    reviewed_by: null,
    source_type: "boa",
    reason: "BOA-only transaction.",
    created_at: "2026-05-22T00:00:00.000Z",
    transaction: transaction(),
    ...partial,
  };
}
test.each([null,{side:"boa",transactions:null}])("malformed snapshot input produces explicit historical error",input=>{
 const {detail,snapshot}=inputs();snapshot.inputs[0]=input as unknown as ReconciliationRunInputSnapshot["inputs"][number];
 expect(()=>hydrateRunIdentity(detail,snapshot)).toThrow("original run identity snapshot is unavailable");
});
test.each(["vin","description"] as const)("malformed %s in any saved transaction produces historical error",field=>{
 const {detail,snapshot}=inputs();
 snapshot.inputs[0].transactions.push({...snapshot.inputs[0].transactions[0],id:99,[field]:12} as unknown as Transaction);
 expect(()=>hydrateRunIdentity(detail,snapshot)).toThrow("original run identity snapshot is unavailable");
});
