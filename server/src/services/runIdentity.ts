import type { ReconciliationRunDetail, ReconciliationRunInputSnapshot, Transaction, TransactionSummary } from "../domain/types.js";
import {formatCents} from "../domain/money.js";
import {ConflictError} from "../errors/HttpError.js";
import {categorizeRunDetailExceptions} from "./exceptionCategorizer.js";
import {LINEAGE_RAW_DATA_KEY} from "./preprocessing/types.js";
import {getVinRevision} from "./vinVerification.js";
export class HistoricalIdentityUnavailableError extends ConflictError {
 constructor(){super("The original run identity snapshot is unavailable. Stored downloads remain available.","HISTORICAL_IDENTITY_UNAVAILABLE");}
}
export function validateSavedTransaction(value:unknown):asserts value is Transaction {
 if(!value || typeof value!=="object" || Array.isArray(value)) throw new HistoricalIdentityUnavailableError();
 const t=value as Transaction;
 if(!Number.isInteger(t.id) || t.id<=0 || !Number.isInteger(t.dealership_id) || !Number.isInteger(t.source_file_id) || !Number.isSafeInteger(t.amount_cents) || !["boa","dealertrack","bank","dms","gl","oem"].includes(t.source_type) || !t.raw_data || typeof t.raw_data!=="object" || Array.isArray(t.raw_data)) throw new HistoricalIdentityUnavailableError();
 for(const key of ["vin","description","stock_number","reference_number","account","transaction_date","post_date"] as const) if(t[key]!==null && typeof t[key]!=="string") throw new HistoricalIdentityUnavailableError();
 if(typeof t.account_type!=="string" || typeof t.account_identifier!=="string") throw new HistoricalIdentityUnavailableError();
 try { if(t.vin_revision!==undefined) getVinRevision(t); }catch{throw new HistoricalIdentityUnavailableError();}
}
export function hydrateRunIdentity(detail:ReconciliationRunDetail,snapshot:ReconciliationRunInputSnapshot|null):ReconciliationRunDetail {
 if(!snapshot || snapshot.reconciliation_run_id!==detail.reconciliation_run_id || !Array.isArray(snapshot.inputs) || snapshot.inputs.length!==2) throw new HistoricalIdentityUnavailableError();
 const saved=new Map<number,{transaction:Transaction;side:string}>();
 const sides=new Set<string>();
 for(const input of snapshot.inputs){
  if(!input || !["boa","dealertrack"].includes(input.side) || sides.has(input.side) || input.source_file_id!==(input.side==="boa"?detail.boa_source_file_id:detail.dealertrack_source_file_id) || !Array.isArray(input.transactions)) throw new HistoricalIdentityUnavailableError();
  sides.add(input.side);
  for(const transaction of input.transactions){
   validateSavedTransaction(transaction);
   if(!transaction || saved.has(transaction.id) || transaction.dealership_id!==detail.dealership_id || transaction.source_file_id!==input.source_file_id || transaction.source_type!==input.source_type || !Number.isSafeInteger(transaction.amount_cents)) throw new HistoricalIdentityUnavailableError();
   saved.set(transaction.id,{transaction,side:input.side});
  }
 }
 const summary=(current:TransactionSummary,side?:string):TransactionSummary=>{
  const entry=saved.get(current.id);
  if(!entry || entry.transaction.source_type!==current.source_type || (side && entry.side!==side)) throw new HistoricalIdentityUnavailableError();
  const t=entry.transaction;
  const raw=t.raw_data?.[LINEAGE_RAW_DATA_KEY];
  const lineage=raw && typeof raw==="object" && !Array.isArray(raw)?raw as Record<string,unknown>:null;
  let revision:number|null=null;
  try{if(t.vin_revision!==undefined) revision=getVinRevision(t);}catch{throw new HistoricalIdentityUnavailableError();}
  const ordinal=lineage?.source_row_number;
  const sourceRow=Number.isInteger(ordinal) && Number(ordinal)>0?Number(ordinal):null;
  if(String(detail.rooftop_profile_id)==="fw-v1" && sourceRow===null) throw new HistoricalIdentityUnavailableError();
  const result:TransactionSummary={id:t.id,dealership_id:t.dealership_id,source_type:t.source_type,transaction_date:t.transaction_date,post_date:t.post_date,amount:formatCents(t.amount_cents),amount_cents:t.amount_cents,reference_number:t.reference_number,description:t.description,account:t.account,account_type:t.account_type,account_identifier:t.account_identifier,stock_number:t.stock_number,vin:t.vin,
   source_identity:{source_row_number:sourceRow,vin_revision:revision,operator_confirmed_vin:revision!==null && revision>0}};
  const components=lineage?.offsetting_components;
  if(components!==undefined){
    if(!components || typeof components!=="object" || Array.isArray(components)) throw new HistoricalIdentityUnavailableError();
    const values=["2100","2101","2101S"].map(key=>(components as Record<string,unknown>)[key]);
    if(values.some(value=>!Number.isSafeInteger(value)) || values.reduce<number>((sum,value)=>sum+Number(value),0)!==0 || !values.some(value=>value!==0) || t.amount_cents!==0 || t.source_type!=="dealertrack") throw new HistoricalIdentityUnavailableError();
    result.source_identity!.offsetting_components=components as Record<"2100"|"2101"|"2101S",number>;
  }
  return result;
 };
 const hydrated={...detail,match_groups:detail.match_groups.map(group=>({...group,transactions:group.transactions.map(link=>({...link,transaction:summary(link.transaction,link.side==="left"?"boa":link.side==="right"?"dealertrack":link.side)}))})),exceptions:detail.exceptions.map(exception=>({...exception,transaction:summary(exception.transaction)}))};
 return {...hydrated,exceptions:categorizeRunDetailExceptions(hydrated,snapshot.inputs.find(i=>i.side==="boa")!.transactions,snapshot.inputs.find(i=>i.side==="dealertrack")!.transactions).map(exception=>exception.transaction.source_identity?.offsetting_components ? {...exception,exception_category:"unclassified" as const} : exception)};
}
