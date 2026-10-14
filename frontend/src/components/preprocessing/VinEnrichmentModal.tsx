import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { applyVinEnrichment, getVinVerification, listSourceFileTransactions, type SourceFileTransaction } from "../../api/vinEnrichment";
import { ApiError } from "../../api/errorMessage";
import { matchDiagnosticToTransaction, UNSAFE_DIAGNOSTIC_MATCH_MESSAGE } from "./vinEnrichmentMatching";

type Props = ({transactionId: number} | {
  sourceFileId: number; sourceRowNumber: number | null; stockNumber: string | null;
  currentVin6?: string | null; currentVinStatus?: string;
}) & {onSuccess?: () => void};

export function VinEnrichmentModal(props: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const key = "transactionId" in props ? `id:${props.transactionId}` : `${props.sourceFileId}:${props.sourceRowNumber}:${props.stockNumber}`;
  return <>{isOpen ? <CorrectionForm key={key} {...props} close={()=>setIsOpen(false)}/> :
    <button type="button" className="forge-button-secondary" onClick={()=>setIsOpen(true)}>Verify or correct VIN</button>}</>;
}

function CorrectionForm(props: Props & {close:()=>void}) {
  const [current,setCurrent]=useState<SourceFileTransaction|null>(null);
  const [vin,setVin]=useState("");
  const [confirmed,setConfirmed]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [refresh,setRefresh]=useState(0);
  const [stale,setStale]=useState(false);
  const [busy,setBusy]=useState(false);
  const [success,setSuccess]=useState(false);
  const alive=useRef(true);
  const inputId=useId();
  const exactId="transactionId" in props ? props.transactionId : null;
  const fileId="sourceFileId" in props ? props.sourceFileId : null;
  const row="sourceRowNumber" in props ? props.sourceRowNumber : null;
  const stock="stockNumber" in props ? props.stockNumber : null;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let cancelled=false;
    setCurrent(null);setVin("");setConfirmed(false);setError(null);setStale(false);
    async function load() {
      let id=exactId;
      if(id===null && fileId!==null) {
        const match=matchDiagnosticToTransaction(await listSourceFileTransactions(fileId),row,stock);
        if(match.status!=="matched") throw new Error(UNSAFE_DIAGNOSTIC_MATCH_MESSAGE);
        id=match.transaction.id;
      }
      if(id===null) throw new Error(UNSAFE_DIAGNOSTIC_MATCH_MESSAGE);
      const value=await getVinVerification(id);
      if(!cancelled) setCurrent(value);
    }
    void load().catch((err:unknown)=>{if(!cancelled)setError(err instanceof Error?err.message:"Could not load current VIN.");});
    return()=>{cancelled=true;};
  },[exactId,fileId,row,stock,refresh]);
  const proposed=vin.trim().toUpperCase();
  const valid=/^[A-HJ-NPR-Z0-9]{17}$/.test(proposed);
  const ready=current && Number.isInteger(current.vin_enrichment_revision) && valid && proposed!==current.vin && confirmed && !stale && !busy;
  async function submit(event:FormEvent) {
    event.preventDefault();
    if(!ready || !current) return;
    setBusy(true);setError(null);
    try {
      await applyVinEnrichment(current.id,{vin:proposed,expected_revision:current.vin_enrichment_revision,confirmed:true});
      if(alive.current){setSuccess(true);props.onSuccess?.();}
    } catch(err) {
      if(alive.current){setError(err instanceof Error?err.message:"Correction failed.");if(err instanceof ApiError && (err.status===409 || err.code==="VIN_ENRICHMENT_REVISION_REQUIRED")){setStale(true);setConfirmed(false);}}
    } finally {if(alive.current)setBusy(false);}
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Verify or correct VIN">
    <div className="forge-panel forge-panel-pad w-full max-w-lg">
      <h3>Verify or correct VIN</h3>
      <p>Verify identity independently. Keep supporting research and notes in the exported spreadsheet.</p>
      {current ? <dl className="my-4 grid gap-1"><dt>Source / row</dt><dd>{current.source_type} / {current.source_row_number??"unknown"}</dd><dt>Stock / control</dt><dd>{current.stock_number??"—"}</dd><dt>Existing VIN</dt><dd>{current.vin??"Missing"}</dd><dt>Revision being reviewed</dt><dd>{current.vin_enrichment_revision}</dd><dt>Assessment</dt><dd>{current.assessment.flags.join(", ")||"Valid format"}{current.assessment.operatorConfirmed?"; operator confirmed":""}</dd></dl> : <p>Loading current identity…</p>}
      {error && <p role="alert" className="forge-notice forge-notice-danger">{error}</p>}
      {success ? <><p role="status">VIN corrected. Re-run reconciliation to apply the corrected VIN. Previous runs remain unchanged.</p><button type="button" onClick={props.close}>Close</button></> :
      <form onSubmit={submit} className="grid gap-3">
        <label htmlFor={inputId}>Proposed VIN</label><input id={inputId} className="forge-control" value={vin} maxLength={17} disabled={busy||stale||!current} onChange={e=>{setVin(e.target.value.toUpperCase());setConfirmed(false);}}/>
        <p>Proposed identity: {proposed||"—"}</p>
        <label><input type="checkbox" checked={confirmed} disabled={busy||stale||!valid||!current} onChange={e=>setConfirmed(e.target.checked)}/> I independently verified this change from the existing VIN to the proposed VIN.</label>
        {stale && <button type="button" onClick={()=>setRefresh(n=>n+1)}>Refresh and review</button>}
        <div className="flex gap-2"><button type="button" className="forge-button-secondary" disabled={busy} onClick={props.close}>Cancel</button><button type="submit" className="forge-button-accent" disabled={!ready}>Confirm VIN correction</button></div>
      </form>}
    </div>
  </div>;
}
