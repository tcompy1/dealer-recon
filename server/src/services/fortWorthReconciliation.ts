import type {ReconciliationResult,Transaction} from "../domain/types.js";
import {reconcileTransactionSets,buildVinPresenceDiagnostics} from "./reconciliationEngine.js";
import {readLineage} from "./preprocessing/types.js";
export const FORT_WORTH_ENGINE_VERSION="fw-v1-offset-review";
export const OFFSET_REVIEW_LABEL="Offsetting account balances—review.";
export function reconcileFortWorthTransactions(boa:Transaction[],dealertrack:Transaction[]):ReconciliationResult {
 const offsets=dealertrack.filter(transaction=>readLineage(transaction.raw_data)?.offsetting_components!==undefined);
 const ids=new Set(offsets.map(transaction=>transaction.id));
 const result=reconcileTransactionSets(boa,dealertrack.filter(transaction=>!ids.has(transaction.id)));
 // Reuse the engine's ordinary unmatched summary, never its matching pass, for offset rows.
 const offsetResult=reconcileTransactionSets([],offsets);
 result.exceptions.push(...offsetResult.exceptions.map(exception=>({...exception,description:OFFSET_REVIEW_LABEL,exception_category:"unclassified" as const})));
 result.exception_count=result.exceptions.length;
 result.vin_presence_diagnostics=buildVinPresenceDiagnostics(boa,dealertrack,result.match_groups,result.exceptions,"boa","dealertrack");
 return result;
}
