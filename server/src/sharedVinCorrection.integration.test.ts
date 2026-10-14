import { createTestPool as createPool } from "./testUtils/testPostgresPool.js";
import {describe,expect,test} from "vitest";
import {migrate} from "./db/migrate.js";
import {PostgresTransactionRepository} from "./repositories/postgresTransactionRepository.js";
import {withDisposablePostgresDatabase} from "./testUtils/disposablePostgresDatabase.js";
import type {NewTransaction} from "./domain/types.js";
import {LINEAGE_RAW_DATA_KEY} from "./services/preprocessing/types.js";
const base=process.env.DATABASE_URL;
const suite=base?describe:describe.skip;
const synthetic:NewTransaction={source_file_id:null,source_type:"boa",transaction_date:null,post_date:null,amount_cents:12500,reference_number:null,description:"Original synthetic description",account:null,stock_number:"TEST1",vin:"1ZZAA11A1ZA100001",raw_data:{original:"synthetic"}};
suite("shared correction in validated disposable PostgreSQL",()=>{
 test("migration, concurrency, audit failure and down guard preserve identity",async()=>{
  await withDisposablePostgresDatabase(base!,async url=>{
   await migrate(url);
   const pool=createPool(url);const repository=new PostgresTransactionRepository(pool);
   try {
    const store=await repository.createDealershipStore(1,{name:"Synthetic test store"});
    const {transactions}=await repository.createSourceFileWithTransactions(1,{source_type:"boa",dealership_store_id:store.id,original_filename:"synthetic.csv",stored_filename:null,file_hash:"synthetic",row_count:1,validation_error_count:0},[synthetic]);
    const id=transactions[0].id;
    expect(transactions[0].vin_revision).toBe(0);
    const input={expectedRevision:0,vin:"1ZZAA11A1ZA100002",actorUserId:null,actorLabel:"test operator",confirmedAt:"2026-10-05T00:00:00Z",operatorSource:null,reason:null,reference:null,expectedStoreId:store.id};
    const outcomes=await Promise.allSettled([repository.confirmTransactionVinEnrichment(1,id,input),repository.confirmTransactionVinEnrichment(1,id,{...input,vin:"1ZZAA11A1ZA100003"})]);
    expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(outcomes.filter(r=>r.status==="rejected")).toHaveLength(1);
    const current=await repository.getTransactionById(1,id);
    expect(current?.vin_revision).toBe(1);expect(await repository.listAuditEvents(1)).toHaveLength(1);
    await expect(repository.confirmTransactionVinEnrichment(1,id,{...input,vin:current!.vin!})).rejects.toMatchObject({code:"VIN_ENRICHMENT_REVISION_CONFLICT"});
    await pool.query("CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected audit failure'; END $$; CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_test_audit()");
    await expect(repository.confirmTransactionVinEnrichment(1,id,{...input,expectedRevision:1,vin:"1ZZAA11A1ZA100004"})).rejects.toThrow("Injected audit failure");
    expect(await repository.getTransactionById(1,id)).toEqual(current);expect(await repository.listAuditEvents(1)).toHaveLength(1);
    await pool.query("DROP TRIGGER reject_test_audit ON audit_events; DROP FUNCTION reject_test_audit()");
    await expect(migrate(url,1,"down")).rejects.toThrow();
    expect((await repository.getTransactionById(1,id))?.vin_revision).toBe(1);
   } finally {await pool.end();}
  });
 },30000);
 test.each([0,4,"bad"])("preflight refuses existing revision metadata %s without resetting it",async revision=>{
  await withDisposablePostgresDatabase(base!,async url=>{
   await migrate(url);await migrate(url,1,"down");
   const pool=createPool(url);
   try {
    await new PostgresTransactionRepository(pool).createSourceFileWithTransactions(1,{source_type:"boa",original_filename:"synthetic.csv",stored_filename:null,file_hash:"legacy-synthetic",row_count:1,validation_error_count:0},[{...synthetic,raw_data:{[LINEAGE_RAW_DATA_KEY]:{vin_revision:revision}}}]);
    await expect(migrate(url)).rejects.toThrow();
    const data=await pool.query("SELECT raw_data FROM transactions");
    expect(data.rows[0].raw_data[LINEAGE_RAW_DATA_KEY].vin_revision).toBe(revision);
    const columns=await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='vin_revision'");expect(columns.rows).toHaveLength(0);
   } finally {await pool.end();}
  });
 },30000);
 test("preflight rejects revision-bearing historical audit",async()=>{
  await withDisposablePostgresDatabase(base!,async url=>{
   await migrate(url);await migrate(url,1,"down");
   const pool=createPool(url);
   try {
    await new PostgresTransactionRepository(pool).createAuditEvent(1,{actor_user_id:null,action_type:"vin_enrichment_applied",entity_type:"transaction",entity_id:"1",previous_state:{vin_revision:4},new_state:null});
    await expect(migrate(url)).rejects.toThrow();
    expect((await pool.query("SELECT previous_state FROM audit_events")).rows[0].previous_state).toEqual({vin_revision:4});
   }finally{await pool.end();}
  });
 },30000);

 test("ordinary legacy transactions and audits survive migration up and unused down unchanged",async()=>{
  await withDisposablePostgresDatabase(base!,async url=>{
   await migrate(url);await migrate(url,1,"down");const pool=createPool(url),repository=new PostgresTransactionRepository(pool);
   try{
    await repository.createSourceFileWithTransactions(1,{source_type:"boa",original_filename:"synthetic.csv",stored_filename:null,file_hash:"legacy-ordinary",row_count:1,validation_error_count:0},[{...synthetic,raw_data:{original:"invented",__lineage:{transformations:[{stage:"vin_enriched"}],vin_provenance:{source:"manual_enrichment",vin:synthetic.vin,trusted:true}}}}]);
    await repository.createAuditEvent(1,{actor_user_id:null,action_type:"vin_enrichment_applied",entity_type:"transaction",entity_id:"1",previous_state:{vin:null},new_state:{vin:synthetic.vin}});
    const values=async()=>({transactions:(await pool.query("SELECT id,vin,raw_data,amount_cents FROM transactions ORDER BY id")).rows,audits:(await pool.query("SELECT id,previous_state,new_state FROM audit_events ORDER BY id")).rows});
    const before=await values();await migrate(url);expect(await values()).toEqual(before);expect((await pool.query("SELECT vin_revision FROM transactions")).rows[0].vin_revision).toBe(0);
    await migrate(url,1,"down");expect(await values()).toEqual(before);
   }finally{await pool.end();}
  });
 },30000);

});
