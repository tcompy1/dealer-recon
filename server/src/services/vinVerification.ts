import type { NewAuditEvent, SourceFile, Transaction } from "../domain/types.js";
import { ConflictError, ValidationError } from "../errors/HttpError.js";
import type { VinEnrichmentSource } from "../validators/requestParsers.js";
import { applyManualVinEnrichment } from "./preprocessing/manualVinEnrichment.js";
import { LINEAGE_RAW_DATA_KEY } from "./preprocessing/types.js";

const FULL_VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const MAX_REVISION = 2_147_483_647;
export type VinCorrectionInput = {
  expectedRevision:number; vin:string; actorUserId:number|null; actorLabel:string;
  confirmedAt:string; operatorSource:VinEnrichmentSource|null; reason:string|null;
  reference:string|null; expectedStoreId:number;
};
function lineage(transaction:Transaction):Record<string,unknown>|null {
  const value=transaction.raw_data[LINEAGE_RAW_DATA_KEY];
  if(value === undefined) return null;
  if(!value || typeof value!=="object" || Array.isArray(value)) invalidState();
  return value as Record<string,unknown>;
}
function invalidState():never { throw new ConflictError("VIN revision metadata is invalid; no correction was saved.","VIN_REVISION_STATE_INVALID"); }
export function getVinRevision(transaction:Transaction):number {
  const revision=transaction.vin_revision;
  if(!Number.isInteger(revision) || revision!<0 || revision!>MAX_REVISION) invalidState();
  const saved=lineage(transaction);
  if(saved && Object.hasOwn(saved,"transformations") && (!Array.isArray(saved.transformations) || saved.transformations.some(entry=>!entry || typeof entry!=="object" || typeof entry.stage!=="string"))) invalidState();
  if(saved && Object.hasOwn(saved,"vin_revision") && saved.vin_revision!==revision) invalidState();
  if(saved && Object.hasOwn(saved,"vin_enrichment_history")) invalidState();
  if(revision===0 && saved && Object.hasOwn(saved,"vin_confirmation")) invalidState();
  if(revision!>0) {
    if(typeof transaction.vin!=="string" || !FULL_VIN.test(transaction.vin))invalidState();
    const confirmation=saved?.vin_confirmation as Record<string,unknown>|undefined;
    if(!saved || saved.vin_revision!==revision || !confirmation || confirmation.revision!==revision || confirmation.vin!==transaction.vin || !Number.isInteger(confirmation.audit_event_id) || Number(confirmation.audit_event_id)<=0) invalidState();
    const provenance=saved.vin_provenance as Record<string,unknown>|undefined;
    if(!provenance || provenance.trusted!==true || provenance.vin!==transaction.vin || provenance.vin6!==transaction.vin?.slice(-6) || !["manual_enrichment","dms_assisted_reconstruction","stock_number_lookup"].includes(String(provenance.source))) invalidState();
    if(typeof confirmation.confirmed_at!=="string" || !Number.isFinite(Date.parse(confirmation.confirmed_at)) || !(confirmation.actor_user_id===null || Number.isInteger(confirmation.actor_user_id))) invalidState();
    if(!Array.isArray(saved.transformations) || !saved.transformations.some(entry=>entry && typeof entry==="object" && entry.stage==="vin_enriched")) invalidState();
  }
  return revision!;
}
export function assessVin(transaction:Transaction):{flags:Array<"missing"|"incomplete"|"invalid"|"conflicting">;operatorConfirmed:boolean} {
  const revision=getVinRevision(transaction);
  const vin=transaction.vin?.trim().toUpperCase() ?? "";
  const flags:Array<"missing"|"incomplete"|"invalid"|"conflicting">=[];
  if(!vin) {
    const raw=lineage(transaction)?.raw_row_snapshot;
    const claimed=raw&&typeof raw==="object"&&!Array.isArray(raw)?Object.entries(raw).filter(([key])=>["vin","serial","serialnovin","serialnumber","serialno"].includes(key.toLowerCase().replace(/[^a-z0-9]/g,""))).map(([,value])=>typeof value==="string"?value.trim().toUpperCase():"").filter(Boolean):[];
    const short=/\b(?=[A-HJ-NPR-Z0-9]{8,16}\b)(?=[A-HJ-NPR-Z0-9]*[A-Z])(?=[A-HJ-NPR-Z0-9]*\d)[A-HJ-NPR-Z0-9]{8,16}\b/;
    if(claimed.some(value=>!FULL_VIN.test(value)&&!short.test(value)))flags.push("invalid");
    else if(claimed.some(value=>short.test(value)) || short.test(transaction.description?.toUpperCase().match(/\bVIN\s*[:#=-]?\s*([A-Z0-9]+)/)?.[1]??""))flags.push("incomplete");
    else flags.push("missing");
  }
  else if(!FULL_VIN.test(vin)) flags.push(/^(?=.*[A-Z])(?=.*\d)[A-HJ-NPR-Z0-9]{8,16}$/.test(vin)?"incomplete":"invalid");
  const tokens=transaction.description?.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? [];
  if(FULL_VIN.test(vin) && tokens.some(token=>token!==vin)) flags.push("conflicting");
  return {flags,operatorConfirmed:revision>0};
}
export function prepareVinCorrection(transaction:Transaction, source:Pick<SourceFile,"id"|"dealership_id"|"dealership_store_id"|"file_hash">|null, input:VinCorrectionInput,auditId:number):{transaction:Transaction;audit:NewAuditEvent} {
  if(!source || source.id!==transaction.source_file_id || source.dealership_id!==transaction.dealership_id || source.dealership_store_id===null || source.dealership_store_id!==input.expectedStoreId) {
    throw new ConflictError("Transaction source scope is unavailable or changed.","VIN_SOURCE_SCOPE_UNAVAILABLE");
  }
  if(transaction.source_type!=="boa" && transaction.source_type!=="dealertrack") throw new ValidationError("VIN correction supports BOA and Dealertrack transactions.","UNSUPPORTED_SOURCE_TYPE");
  const revision=getVinRevision(transaction);
  if(revision!==input.expectedRevision) throw new ConflictError("This transaction changed. Refresh, review and confirm again.","VIN_ENRICHMENT_REVISION_CONFLICT");
  if(revision===MAX_REVISION) throw new ConflictError("VIN revision limit reached.","VIN_REVISION_EXHAUSTED");
  const result=applyManualVinEnrichment(transaction,{vin:input.vin,source:input.operatorSource ?? "manual_enrichment",enriched_by:input.actorLabel,enriched_at:input.confirmedAt,...(input.reason?{note:input.reason}:{})});
  if(!result.ok) {
    if(result.reason==="no_change") throw new ConflictError("VIN is already set to the requested value.","VIN_NO_CHANGE");
    throw new ValidationError("Invalid VIN.","INVALID_VIN");
  }
  const saved=lineage(transaction);
  const nextLineage=result.raw_data[LINEAGE_RAW_DATA_KEY] as Record<string,unknown>;
  nextLineage.vin_revision=revision+1;
  nextLineage.vin_confirmation={revision:revision+1,vin:result.vin,audit_event_id:auditId,actor_user_id:input.actorUserId,confirmed_at:input.confirmedAt,operator_source:input.operatorSource,reason:input.reason,reference:input.reference};
  // Unknown legacy source ordinals are never manufactured as row zero.
  const originalRaw=structuredClone(transaction.raw_data);
  delete originalRaw[LINEAGE_RAW_DATA_KEY];
  if(!saved) { nextLineage.source_row_number=null; nextLineage.raw_row_snapshot=originalRaw; }
  const preservedRaw={...structuredClone(transaction.raw_data),[LINEAGE_RAW_DATA_KEY]:nextLineage};
  return {
    transaction:{...transaction,vin:result.vin,vin_revision:revision+1,raw_data:preservedRaw},
    audit:{actor_user_id:input.actorUserId,action_type:"vin_enrichment_applied",entity_type:"transaction",entity_id:String(transaction.id),
      previous_state:{vin:transaction.vin,vin_revision:revision,lineage_summary:saved?{source_kind:saved.source_kind,source_row_number:saved.source_row_number,retained_reason:saved.retained_reason,vin_provenance:saved.vin_provenance,transformations_count:Array.isArray(saved.transformations)?saved.transformations.length:0}:null},
      new_state:{transaction_id:transaction.id,source_file_id:source.id,source_file_hash:source.file_hash,dealership_store_id:source.dealership_store_id,vin:result.vin,vin6:result.vin6,vin_revision:revision+1,source:input.operatorSource,reason:input.reason,dms_reference:input.reference,confirmed_at:input.confirmedAt,actor_label:input.actorLabel}},
  };
}
