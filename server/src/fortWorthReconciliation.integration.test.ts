import { createTestPool as createPool } from "./testUtils/testPostgresPool.js";
import {expect,test,vi,describe} from "vitest";
import request from "supertest";
import {createApp} from "./app.js";
import {MemoryTransactionRepository,type TransactionRepository} from "./repositories/transactionRepository.js";
import {ROOFTOP_PROFILES} from "./config/storeWorkflowConfig.js";
import {FW_SANITIZED_FIXTURE_PATHS,readFwSyntheticFixture} from "./testFixtures/fw/index.js";
import * as writers from "./presenters/fpRec.js";
const XLSX_MIME="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME="application/vnd.ms-excel";
async function workflow(repository:TransactionRepository=new MemoryTransactionRepository(),key:"fw"|"hurst"|"acura"="fw"){
 const app=createApp(repository,[],1,async()=>{}, {nodeEnv:"test",allowDevDealershipFallback:true});
 const store=(await repository.listDealershipStores(1)).find(s=>s.name===ROOFTOP_PROFILES[key].displayName) ?? await repository.createDealershipStore(1,{name:ROOFTOP_PROFILES[key].displayName});
 const files:number[]=[];
 for(const source of ["boa","dealertrack"] as const){const response=await request(app).post("/upload").field("store_id",String(store.id)).field("source_type",source).field("accounting_month","2026-04").attach("file",Buffer.from(source==="dealertrack"&&key!=="fw" ? `Control,Description,${ROOFTOP_PROFILES[key].dealertrackAccountColumn}\nT1,Invented vehicle 1ZZAA11A1ZA100001,-125\nT2,Invented vehicle 1ZZAA11A1ZA100002,-230\n` : readFwSyntheticFixture(FW_SANITIZED_FIXTURE_PATHS.core[source]).replace("Invented test vehicle","Invented vehicle 1ZZAA11A1ZA100001")),`${source}-2026-04.csv`);expect(response.status).toBe(200);files.push(response.body.source_file_id);}
 const run=()=>request(app).post("/reconcile").send({dealership_store_id:store.id,boa_source_file_id:files[0],dealertrack_source_file_id:files[1],accounting_month:"2026-04"});
 return {app,repository,run};
}
async function enabled(assertion:()=>Promise<void>){const prior=ROOFTOP_PROFILES.fw.enabled;ROOFTOP_PROFILES.fw.enabled=true;try{await assertion();}finally{ROOFTOP_PROFILES.fw.enabled=prior;}}
test("FW stores six artifacts, HTML binary selectors and JSON retain exact outcomes",async()=>enabled(async()=>{
 const {app,repository,run}=await workflow();const response=await run();expect(response.status).toBe(200);const id=response.body.reconciliation_run_id;
 expect(response.body.matched_count).toBe(2);const artifacts=await repository.listReconciliationArtifacts(1,id);expect(artifacts).toHaveLength(6);
 for(const [route,type] of [["merged-floorplan","MERGED_FLOORPLAN"],["fp-rec","FP_REC"]] as const){
  const artifact=await repository.findReconciliationArtifact(1,id,type);expect(artifact?.content_type).toBe(XLS_MIME);expect(artifact?.content.toString()).toContain("<!DOCTYPE html>");
  for(const format of [undefined,"xls"]){const res=await request(app).get(`/reconciliation-runs/${id}/${route}`).buffer(true).parse(binary).query(format?{format}:{});expect(res.status).toBe(200);expect(res.headers["content-type"]).toContain(XLS_MIME);expect((res.body as Buffer).equals(artifact!.content)).toBe(true);}
  expect((await request(app).get(`/reconciliation-runs/${id}/${route}`).query({format:"xlsx"})).status).toBe(422);
  expect((await request(app).get(`/reconciliation-runs/${id}/${route}`).query({format:"json"})).body.rows).toHaveLength(2);
 }
}));
test("second writer failure leaves no partial artifact batch and prior run stays downloadable",async()=>enabled(async()=>{
 const {app,repository,run}=await workflow();const first=await run();expect(first.status).toBe(200);const original=await repository.findReconciliationArtifact(1,first.body.reconciliation_run_id,"FP_REC");
 const spy=vi.spyOn(writers,"toFpRecXlsHtml").mockImplementation(()=>{throw new Error("synthetic serialization failure");});
 try {expect((await run()).status).toBe(500);}finally{spy.mockRestore();}
 const runs=await repository.listReconciliationRuns(1);const failed=runs.find(r=>r.reconciliation_run_id!==first.body.reconciliation_run_id)!;expect(failed.status).toBe("artifact_failed");expect(await repository.listReconciliationArtifacts(1,failed.reconciliation_run_id)).toEqual([]);
 const old=await request(app).get(`/artifacts/${original!.id}/download`).buffer(true).parse(binary);expect(old.status).toBe(200);expect((old.body as Buffer).equals(original!.content)).toBe(true);
}));

function binary(response:request.Response,callback:(error:Error|null,body:Buffer)=>void){const chunks:Buffer[]=[];response.on("data",chunk=>chunks.push(Buffer.from(chunk)));response.on("end",()=>callback(null,Buffer.concat(chunks)));response.on("error",error=>callback(error,Buffer.alloc(0)));}
test("later correction changes rerun only; stored and regenerated original workbook identities agree",async()=>enabled(async()=>{
 const {app,repository,run}=await workflow();const first=await run();expect(first.status).toBe(200);const id=first.body.reconciliation_run_id;
 const old=await repository.findReconciliationArtifact(1,id,"MERGED_FLOORPLAN");const transactions=await repository.listBySource(1,"dealertrack");
 const corrected=await request(app).post(`/transactions/${transactions[0].id}/vin-enrichment`).send({vin:"1ZZAA11A1ZA100003",expected_revision:0,confirmed:true});expect(corrected.status).toBe(200);
 expect((await repository.getTransactionById(1,transactions[0].id))?.description).toBe(transactions[0].description);
 const rerun=await run();expect(rerun.status).toBe(200);expect(rerun.body.matched_count).toBe(1);
 const originalDetail=await request(app).get(`/reconciliation-runs/${id}`);expect(originalDetail.status).toBe(200);expect(originalDetail.body.matched_count).toBe(2);
 const stored=await request(app).get(`/reconciliation-runs/${id}/merged-floorplan`).buffer(true).parse(binary);expect((stored.body as Buffer).equals(old!.content)).toBe(true);
 const regenerated=await request(app).get(`/reconciliation-runs/${id}/merged-floorplan`).query({store_key:"fw",format:"xls"}).buffer(true).parse(binary);expect(regenerated.status).toBe(200);
 expect((regenerated.body as Buffer).equals(old!.content)).toBe(true);
 const override=await request(app).get(`/reconciliation-runs/${id}/merged-floorplan`).query({store_key:"acura",format:"xlsx"});expect(override.status).toBe(422);
}));
test("batch persistence failure leaves failed run empty and old artifact intact",async()=>enabled(async()=>{
 const {repository,run}=await workflow();const first=await run();const old=await repository.findReconciliationArtifact(1,first.body.reconciliation_run_id,"FP_REC");
 const spy=vi.spyOn(repository,"createReconciliationArtifactBatch").mockRejectedValueOnce(new Error("synthetic batch failure"));
 try{expect((await run()).status).toBe(500);}finally{spy.mockRestore();}
 const failed=(await repository.listReconciliationRuns(1)).find(r=>r.reconciliation_run_id!==first.body.reconciliation_run_id)!;
 expect(failed.status).toBe("artifact_failed");expect(await repository.listReconciliationArtifacts(1,failed.reconciliation_run_id)).toEqual([]);expect((await repository.findReconciliationArtifact(1,first.body.reconciliation_run_id,"FP_REC"))?.content.equals(old!.content)).toBe(true);
}));

test.each(["hurst","acura"] as const)("%s rejects unsupported native selector and retains legacy stored MIME",async key=>{
 const {app,run}=await workflow(new MemoryTransactionRepository(),key);const response=await run();expect(response.status).toBe(200);
 for(const route of ["merged-floorplan","fp-rec"]){const url=`/reconciliation-runs/${response.body.reconciliation_run_id}/${route}`;expect((await request(app).get(url).query({format:"xlsx"})).status).toBe(422);const legacy=await request(app).get(url);expect(legacy.status).toBe(200);expect(legacy.headers["content-type"]).toContain("application/vnd.ms-excel");}
});
test("absent stored FP REC regenerates saved identity after later correction",async()=>enabled(async()=>{
 const {app,repository,run}=await workflow();const first=await run();const id=first.body.reconciliation_run_id;const old=await repository.findReconciliationArtifact(1,id,"FP_REC");
 const t=(await repository.listBySource(1,"boa"))[0];expect((await request(app).post(`/transactions/${t.id}/vin-enrichment`).send({vin:"1ZZAA11A1ZA100004",expected_revision:0,confirmed:true})).status).toBe(200);
 const spy=vi.spyOn(repository,"findReconciliationArtifact").mockResolvedValueOnce(null);let response;try{response=await request(app).get(`/reconciliation-runs/${id}/fp-rec`).buffer(true).parse(binary);}finally{spy.mockRestore();}expect(response.status).toBe(200);
 expect((response.body as Buffer).equals(old!.content)).toBe(true);
}));
test("legacy stored FW xls is served unchanged even with unavailable profile and no snapshot",async()=>enabled(async()=>{
 const {app,repository,run}=await workflow();const first=await run();const prior=await repository.getReconciliationRunMetadata(1,first.body.reconciliation_run_id);
 const old=await repository.createReconciliationRun({dealership_id:1,dealership_store_id:prior!.dealership_store_id,boa_source_file_id:prior!.boa_source_file_id,dealertrack_source_file_id:prior!.dealertrack_source_file_id,accounting_month:prior!.accounting_month,rooftop_profile_id:"fw-v0",rooftop_profile_version:"0",status:"artifact_pending",result:first.body});
 const bytes=Buffer.from("<table><tr><td>invented legacy file</td></tr></table>");
 await repository.createReconciliationArtifactBatch(1,[{reconciliation_run_id:old.id,store_id:prior!.dealership_store_id,accounting_month:prior!.accounting_month!,uploaded_by:null,artifact_type:"FP_REC",filename:"legacy-fw.xls",content_type:"application/vnd.ms-excel",content:bytes}]);
 await repository.updateReconciliationRunStatus(1,old.id,"completed");
 for(const format of ["xls"]){const response=await request(app).get(`/reconciliation-runs/${old.id}/fp-rec`).query({format}).buffer(true).parse(binary);expect(response.status).toBe(200);expect(response.headers["content-disposition"]).toContain("legacy-fw.xls");expect(response.headers["content-type"]).toContain("application/vnd.ms-excel");expect((response.body as Buffer).equals(bytes)).toBe(true);}
}));

const databaseUrl=process.env.DATABASE_URL;
(databaseUrl?describe:describe.skip)("shared correction and immutable artifacts in disposable PostgreSQL",()=>{
 test.each(["hurst","acura","fw"] as const)("%s both sources preserve raw descriptions and old artifacts through reruns",async key=>enabled(async()=>{
  const {withDisposablePostgresDatabase}=await import("./testUtils/disposablePostgresDatabase.js");const {migrate}=await import("./db/migrate.js");const {PostgresTransactionRepository}=await import("./repositories/postgresTransactionRepository.js");
  await withDisposablePostgresDatabase(databaseUrl!,async url=>{
   await migrate(url);const pool=createPool(url);const repository=new PostgresTransactionRepository(pool);
   try {
    const {app,run}=await workflow(repository,key);const first=await run();expect(first.status).toBe(200);const id=first.body.reconciliation_run_id;
    const original=await repository.findReconciliationArtifact(1,id,"FP_REC");
    for(const [index,source] of (["boa","dealertrack"] as const).entries()){
     const t=(await repository.listBySource(1,source)).find(t=>t.vin==="1ZZAA11A1ZA100001")!;expect(t.description).toContain("1ZZAA11A1ZA100001");
     const get=await request(app).get(`/transactions/${t.id}/vin-verification`);expect(get.status).toBe(200);expect(get.body.vin_enrichment_revision).toBe(0);
     const correction=await request(app).post(`/transactions/${t.id}/vin-enrichment`).send({vin:"1ZZAA11A1ZA100003",expected_revision:0,confirmed:true});expect(correction.status).toBe(200);
     const live=await repository.getTransactionById(1,t.id);expect(live?.vin_revision).toBe(1);expect(live?.description).toBe(t.description);expect((live?.raw_data.__lineage as Record<string,unknown>).raw_row_snapshot).toEqual((t.raw_data.__lineage as Record<string,unknown>).raw_row_snapshot);
     expect((await request(app).post(`/transactions/${t.id}/vin-enrichment`).send({vin:"1ZZAA11A1ZA100004",expected_revision:0,confirmed:true})).status).toBe(409);
     const next=await run();expect(next.status).toBe(200);expect(next.body.matched_count).toBe(index===0?1:2);
     expect((await repository.getReconciliationRunDetail(1,id))?.matched_count).toBe(2);expect((await repository.findReconciliationArtifact(1,id,"FP_REC"))?.content.equals(original!.content)).toBe(true);
    }
    const corrections=(await repository.listAuditEvents(1)).filter(event=>event.action_type==="vin_enrichment_applied");expect(corrections).toHaveLength(2);
   }finally{await pool.end();}
  });
 }),30000);
});

test("overlapping run creation and correction retain one consistent saved identity",async()=>enabled(async()=>{
 const {app,repository,run}=await workflow();const transaction=(await repository.listBySource(1,"boa"))[0];
 let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});const pause=new Promise<void>(resolve=>{release=resolve;});
 const original=repository.createReconciliationRun.bind(repository);
 const spy=vi.spyOn(repository,"createReconciliationRun").mockImplementationOnce(async input=>{entered();await pause;return original(input);});
 const pending=run().then(response=>response);await waiting;
 try{expect((await request(app).post(`/transactions/${transaction.id}/vin-enrichment`).send({vin:"1ZZAA11A1ZA100003",expected_revision:0,confirmed:true})).status).toBe(200);}finally{release();}
 const response=await pending;spy.mockRestore();expect(response.status).toBe(200);expect(response.body.matched_count).toBe(2);
 const detail=await repository.getReconciliationRunDetail(1,response.body.reconciliation_run_id);expect(detail?.match_groups.flatMap(g=>g.transactions).find(t=>t.transaction.id===transaction.id)?.transaction.vin).toBe(transaction.vin);
 expect((await run()).body.matched_count).toBe(1);
}));

async function unavailablePriorDoesNotBlockCurrent(repository:TransactionRepository){
 const {app,run}=await workflow(repository);const t=(await repository.listBySource(1,"boa"))[0];
 expect((await request(app).post(`/transactions/${t.id}/vin-enrichment`).send({vin:"1ZZAA11A1ZA100003",expected_revision:0,confirmed:true})).status).toBe(200);
 const prior=await run();expect(prior.status).toBe(200);expect(prior.body.exception_count).toBe(2);
 await new Promise(resolve=>setTimeout(resolve,5));const current=await run();expect(current.status).toBe(200);
 const get=repository.getReconciliationRunSnapshot.bind(repository);const spy=vi.spyOn(repository,"getReconciliationRunSnapshot").mockImplementation((dealership,id)=>id===prior.body.reconciliation_run_id?Promise.resolve(null):get(dealership,id));
 try{expect((await request(app).get(`/reconciliation-runs/${prior.body.reconciliation_run_id}`)).status).toBe(409);expect((await request(app).get(`/reconciliation-runs/${current.body.reconciliation_run_id}`)).status).toBe(200);}finally{spy.mockRestore();}
}
test("missing prior snapshot cannot block current memory run",async()=>enabled(()=>unavailablePriorDoesNotBlockCurrent(new MemoryTransactionRepository())));
test.skipIf(!databaseUrl)("missing prior snapshot cannot block current PostgreSQL run",async()=>enabled(async()=>{
 const {withDisposablePostgresDatabase}=await import("./testUtils/disposablePostgresDatabase.js"),{migrate}=await import("./db/migrate.js"),{PostgresTransactionRepository}=await import("./repositories/postgresTransactionRepository.js");
 await withDisposablePostgresDatabase(databaseUrl!,async url=>{await migrate(url);const pool=createPool(url);try{await unavailablePriorDoesNotBlockCurrent(new PostgresTransactionRepository(pool));}finally{await pool.end();}});
}),30000);


test.each(["merged-floorplan","fp-rec"])("stored native %s remains byte-identical and xlsx never returns HTML",async route=>enabled(async()=>{
 const {app,repository,run}=await workflow();const first=await run(),id=first.body.reconciliation_run_id;
 const original=await repository.findReconciliationArtifact(1,id,route==="fp-rec"?"FP_REC":"MERGED_FLOORPLAN");
 const {default:ExcelJS}=await import("exceljs");const book=new ExcelJS.Workbook();book.addWorksheet("Stored").getCell("A1").value="Invented historical artifact";const bytes=Buffer.from(await book.xlsx.writeBuffer());
 const find=vi.spyOn(repository,"findReconciliationArtifact").mockResolvedValue({...original!,filename:"stored-fw.xlsx",content_type:XLSX_MIME,content:bytes});
 const detail=vi.spyOn(repository,"getReconciliationRunDetail").mockRejectedValue(new Error("historical snapshot unavailable"));
 try{
  for(const format of [undefined,"xls","xlsx"]){const response=await request(app).get(`/reconciliation-runs/${id}/${route}`).query(format?{format}:{}).buffer(true).parse(binary);expect(response.status).toBe(200);expect(response.headers["content-type"]).toContain(XLSX_MIME);expect(response.headers["content-disposition"]).toContain("stored-fw.xlsx");expect((response.body as Buffer).equals(bytes)).toBe(true);}
  expect((await request(app).get(`/reconciliation-runs/${id}/${route}`).query({format:"xlsx",store_key:"acura"})).status).toBe(422);
 }finally{find.mockRestore();detail.mockRestore();}
 const absent=vi.spyOn(repository,"findReconciliationArtifact").mockResolvedValue(null);
 try{expect((await request(app).get(`/reconciliation-runs/${id}/${route}`).query({format:"xlsx"})).status).toBe(422);}finally{absent.mockRestore();}
}));
