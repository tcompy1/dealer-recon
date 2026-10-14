import {useEffect,useState} from "react";
import {listSourceFileTransactions,type SourceFileTransaction} from "../../api/vinEnrichment";
import {VinEnrichmentModal} from "./VinEnrichmentModal";
export function VinVerificationPanel(props:{sourceFileId:number;canModify:boolean;onCorrected:()=>void}) {
 return <Panel key={props.sourceFileId} {...props}/>;
}
function Panel({sourceFileId,canModify,onCorrected}:{sourceFileId:number;canModify:boolean;onCorrected:()=>void}) {
 const [open,setOpen]=useState(false);
 const [rows,setRows]=useState<SourceFileTransaction[]>([]);
 const [error,setError]=useState<string|null>(null);
 const [page,setPage]=useState(0);
 const [corrected,setCorrected]=useState(false);
 const [query,setQuery]=useState("");
 const [revision,setRevision]=useState(0);
 const [loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!open)return;
  let cancelled=false;setLoading(true);setError(null);
  void listSourceFileTransactions(sourceFileId).then(value=>{if(!cancelled)setRows(value);}).catch((err:unknown)=>{if(!cancelled)setError(err instanceof Error?err.message:"Could not load transactions.");}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[open,sourceFileId,revision]);
 const matching=rows.filter(row=>`${row.vin??""} ${row.stock_number??""} ${row.source_row_number??""}`.toLowerCase().includes(query.toLowerCase()));
 return <section className="forge-panel forge-panel-muted p-3">
  <button type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>Review current source VINs (file {sourceFileId})</button>
  {corrected && <p role="status">VIN corrected. Re-run reconciliation to use the current identities. Previous runs remain unchanged.</p>}
  {open && <div className="grid gap-2"><p>These are current source identities. Saved reconciliation results remain unchanged.</p>
   <label>Find VIN, stock or row<input className="forge-control" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label>
   {error?<p role="alert">{error}</p>:loading?<p>Loading…</p>:<><p>{matching.length} rows; page {page+1}.</p><ul>{matching.slice(page*50,(page+1)*50).map(row=><li key={row.id} className="border-t py-2"><span>{row.vin??"Missing VIN"}</span> · {row.stock_number??"No stock"} · row {row.source_row_number??"unknown"} · {row.assessment.flags.join(", ")||"Valid format"}{row.assessment.operatorConfirmed?"; operator confirmed":""}{canModify && <VinEnrichmentModal transactionId={row.id} onSuccess={()=>{setCorrected(true);onCorrected();setRevision(n=>n+1);}}/>}</li>)}</ul><div><button type="button" disabled={page===0} onClick={()=>setPage(n=>n-1)}>Previous rows</button><button type="button" disabled={(page+1)*50>=matching.length} onClick={()=>setPage(n=>n+1)}>Next rows</button></div></>}
  </div>}
 </section>;
}
