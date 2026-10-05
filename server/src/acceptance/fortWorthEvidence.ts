/** Opt-in, read-only acceptance. Private objects deliberately cannot serialize client rows. */
import {readFileSync,realpathSync} from "node:fs";
import {resolve,sep} from "node:path";
import {createHash} from "node:crypto";
import {parse} from "csv-parse/sync";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {preprocessUpload} from "../services/preprocessing/index.js";
import {MemoryTransactionRepository} from "../repositories/transactionRepository.js";
import {createReconciliationRunFromSourceFiles} from "../services/reconciliationAutomation.js";
import {buildFloorplanExports} from "../services/floorplanExport.js";
import {ROOFTOP_PROFILES} from "../config/storeWorkflowConfig.js";
import {parseAccountingMonth} from "../domain/accountingMonth.js";
import type {ReconciliationRunDetail,SourceFile} from "../domain/types.js";
import type {MergedFloorplanWorkbook} from "../presenters/mergedFloorplan.js";
const ROOT="/Users/tcompy/Developer/dealer-recon/docs/discovery/hiley-artifacts/fw";
const full=/^[A-HJ-NPR-Z0-9]{17}$/;
type Row={ordinal:number;vin:string;description:string;control:string;cents:number;offset:boolean};
type Pair={boa:Row|null;dt:Row|null};
type Summary={boa:number;dt:number;matches:number;boaOnly:number;dtOnly:number;exceptions:number;merged:number;boaCents:number;dtCents:number;difference:number;net:number;variance:number;ambiguous:number};
type State={pairs:string[];exceptions:string[];ordered:Pair[];merged?:MergedFloorplanWorkbook;books?:ExcelJS.Workbook[];xml?:string[]};
const state=new WeakMap<OriginalAprilOracle,State>();
export class OriginalAprilOracle {
 constructor(readonly summary:Summary,privateState:State){state.set(this,privateState);}
 get sectionTotals(){const rows=state.get(this)!.ordered;return {dealertrackOnlyCents:rows.filter(p=>!p.boa).reduce((sum,p)=>sum+p.dt!.cents,0),boaOnlyCents:rows.filter(p=>!p.dt).reduce((sum,p)=>sum+p.boa!.cents,0)};}
 toJSON(){return {summary:this.summary};}
}
function fail(code:string):never{throw new Error(code);}
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const trim=(text:string|undefined)=>(text??"").trim();
function cents(text:string):number {
 let value=text.trim().replace(/[$,\s]/g,"");if(!value)return 0;
 if(/^\(.*\)$/.test(value))value="-"+value.slice(1,-1);
 if(!/^[+-]?\d+(\.\d{1,2})?$/.test(value))fail("EVIDENCE_AMOUNT_INVALID");
 const negative=value.startsWith("-");value=value.replace(/^[+-]/,"");const [whole,fraction=""]=value.split(".");
 const result=BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));const signed=Number(negative?-result:result);
 if(!Number.isSafeInteger(signed))fail("EVIDENCE_AMOUNT_INVALID");return signed;
}
function independentRows(csv:string,side:"boa"|"dt"):Row[]{
 let table:string[][];try{table=parse(csv,{relax_column_count:true,skip_empty_lines:false,bom:true}) as string[][];}catch{fail("EVIDENCE_PARSE_INVALID");}
 const header=table.findIndex(row=>side==="boa"?row.some(v=>trim(v).toLowerCase()==="ending balance"):row.some(v=>trim(v).toLowerCase()==="control"));
 if(header<0)fail("EVIDENCE_HEADER_INVALID");const names=table[header].map(v=>trim(v).toLowerCase());
 const index=(aliases:string[])=>{const matches=names.flatMap((v,i)=>aliases.includes(v)?[i]:[]);if(matches.length!==1)fail("EVIDENCE_HEADER_INVALID");return matches[0];};
 const description=index(["description"]),amount=side==="boa"?index(["ending balance"]):-1;
 const identity=index(side==="boa"?["serial","serial no/vin","serial no.","serial number"]:["control"]);
 const accounts=side==="dt"?[index(["2100"]),index(["2101"]),index(["2101s"])]:[];
 const rows:Row[]=[];
 for(let i=header+1;i<table.length;i++){
  const cells=table[i];if(cells.every(v=>!trim(v)))continue;
  const text=cells.join(" ").toLowerCase();if(side==="boa"&&(/straight\s*line/.test(text)||/\b(subtotal|total)\b/.test(text)))continue;
  if(side==="dt"&&!trim(cells[identity]))continue;
  if(cells.length<names.length)fail("EVIDENCE_ROW_INVALID");
  const components=side==="dt"?accounts.map(n=>cents(cells[n])):[];
  const value=side==="boa"?cents(cells[amount]):components.reduce((a,b)=>a+b,0);
  const offset=value===0&&components.some(v=>v!==0);if(value===0&&!offset)continue;
  const desc=cells[description]??"";
  const candidate=side==="boa"?trim(cells[identity]).toUpperCase():(desc.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g)?.at(-1)??"");
  rows.push({ordinal:i+1,vin:full.test(candidate)?candidate:"",description:desc,control:side==="dt"?trim(cells[identity]):"",cents:value,offset});
 }
 return rows;
}
function codepoint(a:string,b:string){const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)!-y[i].codePointAt(0)!;if(d)return d;}return x.length-y.length;}
function ordered(pairs:Pair[]):Pair[]{return [...pairs].sort((a,b)=>{
 const amount=(a.boa?.cents??Math.abs(a.dt!.cents))-(b.boa?.cents??Math.abs(b.dt!.cents));if(amount)return amount;
 const tuple=(p:Pair)=>[p.boa?.vin??"",p.dt?.vin??"",p.dt?.control??"",p.boa?(p.dt?0:1):2,p.boa?.ordinal??-1,p.dt?.ordinal??-1];
 const x=tuple(a),y=tuple(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return typeof x[i]==="string"?codepoint(String(x[i]),String(y[i])):Number(x[i])-Number(y[i]);return 0;
 });}
function summarize(boa:Row[],dt:Row[],pairs:Pair[],ambiguous=0):Summary{
 const matches=pairs.filter(p=>p.boa&&p.dt).length,boaOnly=pairs.filter(p=>p.boa&&!p.dt).length,dtOnly=pairs.filter(p=>!p.boa&&p.dt).length;
 const boaCents=boa.reduce((s,r)=>s+r.cents,0),dtCents=dt.reduce((s,r)=>s+r.cents,0),difference=boaCents+dtCents;
 const net=pairs.filter(p=>!p.boa||!p.dt).reduce((s,p)=>s+(p.boa?.cents??p.dt!.cents),0);
 return {boa:boa.length,dt:dt.length,matches,boaOnly,dtOnly,exceptions:boaOnly+dtOnly,merged:pairs.length,boaCents,dtCents,difference,net,variance:net-difference,ambiguous};
}
function membership(pairs:Pair[],boaHash:string,dtHash:string){return {pairs:pairs.filter(p=>p.boa&&p.dt).map(p=>`${boaHash}:${p.boa!.ordinal}/${dtHash}:${p.dt!.ordinal}`).sort(),exceptions:pairs.filter(p=>!p.boa||!p.dt).map(p=>p.boa?`boa:${boaHash}:${p.boa.ordinal}`:`dt:${dtHash}:${p.dt!.ordinal}`).sort()};}
/** Independent CSV arithmetic and grouping. Does not call any application parser/normalizer/engine. */
export function buildOriginalAprilOracle(boaCsv:string,dtCsv:string,correction?:VerifiedCorrection):OriginalAprilOracle{
 const boa=independentRows(boaCsv,"boa"),dt=independentRows(dtCsv,"dt");const attestation=checkedAttestation(correction,boaCsv,dtCsv);
 if(attestation){const target=(attestation.source_side==="boa"?boa:dt).filter(r=>r.ordinal===attestation.source_row_number);if(target.length!==1||(target[0].vin||null)!==attestation.previous_vin||target[0].vin===attestation.verified_vin)fail("CORRECTION_EVIDENCE_MISMATCH");target[0].vin=attestation.verified_vin;}
 const groups=new Map<string,{boa:Row[];dt:Row[]}>();
 for(const [side,rows] of [["boa",boa],["dt",dt]] as const)for(const row of rows){if(!row.vin||row.offset)continue;const key=`${row.vin}/${Math.abs(row.cents)}`;const group=groups.get(key)??{boa:[],dt:[]};group[side].push(row);groups.set(key,group);}
 const paired=new Set<Row>(),pairs:Pair[]=[];let ambiguous=0;
 for(const group of groups.values()){if(group.boa.length===1&&group.dt.length===1){pairs.push({boa:group.boa[0],dt:group.dt[0]});paired.add(group.boa[0]);paired.add(group.dt[0]);}else if(group.boa.length&&group.dt.length)ambiguous++;}
 for(const row of boa)if(!paired.has(row))pairs.push({boa:row,dt:null});for(const row of dt)if(!paired.has(row))pairs.push({boa:null,dt:row});
 return new OriginalAprilOracle(summarize(boa,dt,pairs,ambiguous),{...membership(pairs,hash(boaCsv),hash(dtCsv)),ordered:ordered(pairs)});
}
export function loadOriginalApril(root:string|undefined):{boaCsv:string;dtCsv:string}{
 try{if(!root||realpathSync(root)!==realpathSync(ROOT))fail("EVIDENCE_PATH_INVALID");
  const read=(name:string)=>{const path=realpathSync(resolve(root,name));if(!path.startsWith(realpathSync(ROOT)+sep))fail("EVIDENCE_PATH_INVALID");return readFileSync(path,"utf8");};
  return {boaCsv:read("FW BOA APRIL.csv"),dtCsv:read("FW DT APRIL.csv")};
 }catch{fail("EVIDENCE_PATH_INVALID");}
}
type Attestation={boa_sha256:string;dealertrack_sha256:string;source_side:"boa"|"dealertrack";source_row_number:number;previous_vin:string|null;verified_vin:string;verified_by:string;verified_at:string;verification_reference:string;independent_of_goal:true};
const attestations=new WeakMap<VerifiedCorrection,Attestation>();
export class VerifiedCorrection {toJSON(){return {};}}
/** Human-supplied independent attestation is a protected test prerequisite, never an identity inference. */
export function parseCorrectionAttestation(text:string):VerifiedCorrection {
 let a:Attestation;try{a=JSON.parse(text) as Attestation;}catch{fail("CORRECTION_EVIDENCE_INVALID");}
 if(!a||a.independent_of_goal!==true||!["boa","dealertrack"].includes(a.source_side)||!Number.isInteger(a.source_row_number)||a.source_row_number<=0||!full.test(a.verified_vin)||!(a.previous_vin===null||typeof a.previous_vin==="string")||![a.boa_sha256,a.dealertrack_sha256].every(v=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v))||![a.verified_by,a.verification_reference,a.verified_at].every(v=>typeof v==="string"&&v.trim().length>0)||!Number.isFinite(Date.parse(a.verified_at)))fail("CORRECTION_EVIDENCE_INVALID");
 const result=new VerifiedCorrection();attestations.set(result,a);return result;
}
export function requireCorrectionEvidence(path:string|undefined):VerifiedCorrection {
 if(!path)fail("BLOCKED_EVIDENCE_MISSING");
 try{const real=realpathSync(path);if(!real.startsWith(realpathSync(ROOT)+sep)||!real.endsWith(".json"))fail("CORRECTION_EVIDENCE_INVALID");return parseCorrectionAttestation(readFileSync(real,"utf8"));}catch{fail("CORRECTION_EVIDENCE_INVALID");}
}
function checkedAttestation(correction:VerifiedCorrection|undefined,boaCsv:string,dtCsv:string):Attestation|undefined{
 if(!correction)return undefined;const a=attestations.get(correction);
 if(!a||a.boa_sha256!==hash(boaCsv)||a.dealertrack_sha256!==hash(dtCsv))fail("CORRECTION_EVIDENCE_MISMATCH");return a;
}
/** Application parser -> engine -> persisted in-memory snapshot -> models -> native XLSX. No DB or filesystem writes. */
export async function buildFortWorthActual(boaCsv:string,dtCsv:string,correction?:VerifiedCorrection):Promise<OriginalAprilOracle>{
 const attestation=checkedAttestation(correction,boaCsv,dtCsv);
 const priorEnabled=ROOFTOP_PROFILES.fw.enabled;ROOFTOP_PROFILES.fw.enabled=true;let phase="parse";try{
  const profile={...ROOFTOP_PROFILES.fw,enabled:true},month=parseAccountingMonth("2026-04")!;
  const repository=new MemoryTransactionRepository();const store=await repository.createDealershipStore(1,{name:profile.displayName});const sources:SourceFile[]=[];
  for(const [side,csv] of [["boa",boaCsv],["dealertrack",dtCsv]] as const){
   const decision=preprocessUpload(Buffer.from(csv),side,`${side}-2026-04.csv`,{accountingMonth:month,rooftopProfile:profile});
   if(decision.kind!=="preprocessed"||decision.output.validationFailure||decision.output.validationErrors.length)fail("ACTUAL_INPUT_REJECTED");
   const output=decision.output;
   const imported=await repository.createSourceFileWithTransactions(1,{source_type:side,dealership_store_id:store.id,original_filename:`${side}-2026-04.csv`,stored_filename:null,file_hash:hash(csv),row_count:output.transactions.length,validation_error_count:0,accounting_month:month,rooftop_profile_id:profile.profileId,rooftop_profile_version:profile.profileVersion,parser_name:"csv",parser_version:"1",preprocessor_name:side,preprocessor_version:"1",preprocessing_metadata:{detected_format:"csv",detection_confidence:"high",detection_reason:"acceptance",parser_route:"csv",preprocessing_version:"1",summary:output.summary,diagnostics:[],removed_rows:[],legacy_csv_path:false,unsupported_reason:null}},output.transactions,{filename:`${side}-2026-04.csv`,content_type:"text/csv",content:Buffer.from(csv)});
   sources.push(imported.sourceFile);
  }
  if(attestation){
   phase="correction";
   const transactions=await repository.listBySource(1,attestation.source_side);
   const targets=transactions.filter(t=>(t.raw_data.__lineage as {source_row_number?:number})?.source_row_number===attestation.source_row_number);
   if(targets.length!==1||targets[0].vin!==attestation.previous_vin)fail("CORRECTION_EVIDENCE_MISMATCH");
   const {MemoryAuthRepository}=await import("../auth.js"),{createApp}=await import("../app.js"),{default:request}=await import("supertest"),{randomBytes}=await import("node:crypto");
   const auth=new MemoryAuthRepository(),password=randomBytes(24).toString("hex");await auth.addUser({email:"protected-acceptance@example.invalid",password,dealership_id:1,role:"accounting_user",store_ids:[store.id]});
   const app=createApp(repository,[],1,async()=>{}, {authRepository:auth,sessionSecret:randomBytes(32).toString("hex"),allowDevDealershipFallback:false});const agent=request.agent(app);
   if((await agent.post("/login").send({email:"protected-acceptance@example.invalid",password})).status!==200)fail("CORRECTION_AUTH_FAILED");
   const baseline=await agent.get(`/transactions/${targets[0].id}/vin-verification`);if(baseline.status!==200||baseline.body.vin!==attestation.previous_vin)fail("CORRECTION_BASELINE_INVALID");
   const response=await agent.post(`/transactions/${targets[0].id}/vin-enrichment`).send({vin:attestation.verified_vin,expected_revision:baseline.body.vin_enrichment_revision,confirmed:true});if(response.status!==200)fail("CORRECTION_FAILED");
   const after=await repository.listBySource(1,attestation.source_side);if(after.filter((t,i)=>t.vin!==transactions[i].vin).length!==1||after.some((t,i)=>t.amount_cents!==transactions[i].amount_cents||t.description!==transactions[i].description))fail("CORRECTION_SCOPE_INVALID");
  }
  phase="run";const {run}=await createReconciliationRunFromSourceFiles({repository,dealershipId:1,boaSourceFile:sources[0],dealertrackSourceFile:sources[1],accountingMonth:month,rooftopProfile:profile,automated:false});
  phase="detail";const detail=(await repository.getReconciliationRunDetail(1,run.id))!;
  const row=(t:ReconciliationRunDetail["exceptions"][number]["transaction"]):Row=>({ordinal:t.source_identity!.source_row_number!,vin:t.vin??"",description:t.description??"",control:t.reference_number?.trim()||t.stock_number?.trim()||"",cents:t.amount_cents,offset:!!t.source_identity?.offsetting_components});
  const pairs:Pair[]=detail.match_groups.map(g=>({boa:row(g.transactions.find(t=>t.transaction.source_type==="boa")!.transaction),dt:row(g.transactions.find(t=>t.transaction.source_type==="dealertrack")!.transaction)}));
  for(const exception of detail.exceptions)pairs.push(exception.source_type==="boa"?{boa:row(exception.transaction),dt:null}:{boa:null,dt:row(exception.transaction)});
  phase="export";const exports=await buildFloorplanExports(detail,profile),books:ExcelJS.Workbook[]=[],xml:string[]=[];
  for(const artifact of [exports.merged,exports.fpRec]){const book=new ExcelJS.Workbook();await book.xlsx.load(artifact.content as unknown as ExcelJS.Buffer);books.push(book);const zip=await JSZip.loadAsync(artifact.content);xml.push(await zip.file("xl/worksheets/sheet1.xml")!.async("string"));}
  return new OriginalAprilOracle(summarize(pairs.flatMap(p=>p.boa?[p.boa]:[]),pairs.flatMap(p=>p.dt?[p.dt]:[]),pairs),{...membership(pairs,hash(boaCsv),hash(dtCsv)),ordered:ordered(pairs),merged:exports.merged.workbook,books,xml});
 }catch{fail(`ACTUAL_PIPELINE_FAILED.${phase}`);}finally{ROOFTOP_PROFILES.fw.enabled=priorEnabled;}
}
function same(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
export function compareFortWorthSemantics(actual:OriginalAprilOracle,expected:OriginalAprilOracle):string[]{
 const a=state.get(actual)!,e=state.get(expected)!,errors:string[]=[];
 const check=(condition:boolean,code:string)=>{if(!condition)errors.push(code);};
 for(const key of Object.keys(expected.summary) as Array<keyof Summary>)check(actual.summary[key]===expected.summary[key],`summary.${key}`);
 check(same(a.pairs,e.pairs),"membership.matches");check(same(a.exceptions,e.exceptions),"membership.exceptions");
 if(!a.merged||!a.books)return [...errors,"actual.workbooks_missing"];
 const merged=a.merged,ms=a.books[0].worksheets[0],fp=a.books[1].worksheets[0];
 check(merged.rows.length===e.ordered.length,"merged.row_count");
 e.ordered.forEach((pair,i)=>{
  const row=merged.rows[i],b=pair.boa,d=pair.dt;const rank=b?(d?"matched":"boa_only"):"dealertrack_only";
  check(!!row&&row.classification===rank&&row.store_description===(b?.description??"")&&row.serial_no_vin===(b?.vin??"")&&row.boa_vin6===(b?.vin.slice(-6)??"")&&row.dealertrack_vin6===(d?.vin.slice(-6)??"")&&row.ending_balance_cents===(b?.cents??null)&&row.dealertrack_account_amount_cents===(d?.cents??null)&&row.dealertrack_description===(d?.description??"")&&row.dealertrack_control===(d?.control??""),`merged.row.${i+2}`);
  if(row){const cells=[row.store_description,row.serial_no_vin,row.boa_vin6,row.ending_balance_cents===null?null:row.ending_balance_cents/100,row.dealertrack_account_amount_cents===null?null:row.dealertrack_account_amount_cents/100,row.dealertrack_vin6,row.dealertrack_description,row.dealertrack_control];check(cells.every((value,col)=>ms.getCell(i+2,col+1).value===value),`merged.cells.${i+2}`);}
 });
 const sum=expected.summary,last=e.ordered.length+2;
 const formula=(sheet:ExcelJS.Worksheet,address:string,formula:string,result:number,prefix:string)=>{const serialized=a.xml![prefix==="merged"?0:1];const cell=serialized.match(new RegExp(`<c r="${address}"[^>]*>([\\s\\S]*?)</c>`))?.[1]??"";const cache=cell.match(/<v>([^<]+)<\/v>/)?.[1];check(sheet.getCell(address).formula===formula&&cache!==undefined&&Number(cache)===result/100,`${prefix}.${address}`);};
 formula(ms,`D${last}`,last===2?"0":`SUM(D2:D${last-1})`,sum.boaCents,"merged");formula(ms,`E${last}`,last===2?"0":`SUM(E2:E${last-1})`,sum.dtCents,"merged");
 const schedule=e.ordered.filter(p=>!p.boa),statement=e.ordered.filter(p=>!p.dt),s=10+schedule.length,t=s+3+statement.length;
 check(a.books[0].worksheets.length===1&&ms.name==="MERGED"&&a.books[1].worksheets.length===1&&fp.name==="APR26","sheet.names");
 check(fp.getCell("A2").value instanceof Date&&(fp.getCell("A2").value as Date).toISOString()==="2026-04-30T00:00:00.000Z","fp_rec.A2");
 check(fp.getCell("B3").value===sum.boaCents/100&&fp.getCell("B5").value===sum.dtCents/100,"fp_rec.balances");
 formula(fp,"B6","SUM(B5)",sum.dtCents,"fp_rec");formula(fp,"B7","B6+B3",sum.difference,"fp_rec");
 formula(fp,`B${s}`,`SUM(B9:B${s-1})`,schedule.reduce((n,p)=>n+p.dt!.cents,0),"fp_rec");formula(fp,`B${t}`,`SUM(B${s+2}:B${t-1})`,statement.reduce((n,p)=>n+p.boa!.cents,0),"fp_rec");formula(fp,`B${t+1}`,`B${t}+B${s}`,sum.net,"fp_rec");formula(fp,`B${t+2}`,`B${t+1}-B7`,sum.variance,"fp_rec");
 function section(rows:Pair[],start:number){rows.forEach((p,i)=>{const r=p.boa??p.dt!;const token=r.vin||r.description.toUpperCase().trim().split(/\s+/).at(-1)||"";const tail=token.length>=8?token.slice(-8):"";const reference=p.boa?(tail||r.description):[r.control,tail].filter(Boolean).join(" - ")||r.description;
  check(fp.getCell(start+i,1).value===reference&&fp.getCell(start+i,2).value===r.cents/100,`fp_rec.detail.${start+i}`);
  check([3,4,5,6].every(col=>fp.getCell(start+i,col).value===null),`fp_rec.blank.${start+i}`);
 });}
 section(schedule,9);section(statement,s+2);
 for(const row of [s-1,t-1])check([1,2,3,4,5,6].every(col=>fp.getCell(row,col).value===null),`fp_rec.reserved.${row}`);
 const labels:Record<string,string>={A1:"Floorplan Reconciliation - Hiley Cars Fort Worth",A3:"Outstanding on STMT",A4:"GL Balances",A5:"2100",A6:"Total GL",A7:"Difference",A8:"On schedule-not on statement",C8:"GL FLOORED",D8:"BOA FLOORED",[`A${s+1}`]:"On statement-not on GL",[`C${s+1}`]:"BOA FLOORED",[`D${s+1}`]:"GL FLOORED",[`A${t+1}`]:"Net adjustments",[`A${t+2}`]:"Variance"};
 for(const [address,label] of Object.entries(labels))check(fp.getCell(address).value===label,`fp_rec.label.${address}`);
 check(same(fp.model.merges,["A1:D1"]),"fp_rec.merges");
 for(const [sheet,maxRow,maxCol,name] of [[fp,t+2,4,"fp_rec"],[ms,last,8,"merged"]] as const)sheet.eachRow((row,r)=>row.eachCell((cell,c)=>{if((r>maxRow||c>maxCol)&&cell.value!==null)check(false,`${name}.boundary.${cell.address}`);}));
 check(same(ms.getRow(1).values,[undefined,"FORT WORTH","Serial No/VIN","VIN6","Ending Balance","2100","VIN6","Description","Control"]),"merged.headers");
 check(fp.pageSetup.printArea===`A1:F${t+2}`&&fp.pageSetup.orientation==="portrait"&&fp.pageSetup.fitToPage===true&&fp.pageSetup.fitToWidth===1&&fp.pageSetup.fitToHeight===0,"fp_rec.print");
 check(ms.pageSetup.printArea===`A1:H${last}`&&ms.pageSetup.orientation==="landscape"&&ms.pageSetup.fitToPage===true,"merged.print");
 return errors;
}
