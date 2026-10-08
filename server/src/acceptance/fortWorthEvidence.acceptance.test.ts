import {describe,expect,test,vi} from "vitest";
import {buildOriginalAprilOracle,buildFortWorthActual,compareFortWorthSemantics,loadOriginalApril,requireCorrectionEvidence,parseCorrectionAttestation} from "./fortWorthEvidence.js";
import * as fpWriter from "../presenters/fpRec.js";
import * as mergedWriter from "../presenters/mergedFloorplan.js";
import {createHash} from "node:crypto";
import * as engine from "../services/fortWorthReconciliation.js";
const boa="Dealer Billing Statement for: April 2026\nSerial,Stock Number,Description,Ending Balance,Maturity Date\n1ZZAA11A1ZA100001,T1,Invented first,125,2027-01-01\n1ZZAA11A1ZA100002,T2,Invented second,125,2027-01-01\n";
const dt="Control,Description,2100,2101,2101S,2110\nT1,Invented 1ZZAA11A1ZA100001,-125,0,0,0\nT2,Invented 1ZZAA11A1ZA100002,-125,0,0,0\n";
describe("FW safe independent acceptance comparator",()=>{
 test("accepts independently calculated membership, ordering, totals and serialized HTML semantics",async()=>{expect(compareFortWorthSemantics(await buildFortWorthActual(boa,dt),buildOriginalAprilOracle(boa,dt))).toEqual([]);});
 test("rejects wrong pairs with unchanged counts and totals without serializing identities",async()=>{
  const original=engine.reconcileFortWorthTransactions;
  const spy=vi.spyOn(engine,"reconcileFortWorthTransactions").mockImplementation((boa,dt)=>{const result=original(boa,dt);const groups=result.match_groups;const indices=groups.map(g=>g.transactions.findIndex(t=>t.source_type==="dealertrack"));[groups[0].transactions[indices[0]],groups[1].transactions[indices[1]]]=[groups[1].transactions[indices[1]],groups[0].transactions[indices[0]]];return result;});
  try{const expected=buildOriginalAprilOracle(boa,dt),actual=await buildFortWorthActual(boa,dt);
   expect(actual.summary).toEqual(expected.summary);expect(compareFortWorthSemantics(actual,expected)).toContain("membership.matches");expect(JSON.stringify({actual,expected})).not.toMatch(/1ZZ|Invented|T1/);
  }finally{spy.mockRestore();}
 });
 test("retains duplicate multiplicity independently and leaves ambiguous groups unmatched",()=>{
  const expected=buildOriginalAprilOracle(boa+boa.split("\n")[2]+"\n",dt);
  expect(expected.summary).toMatchObject({boa:3,dt:2,matches:1,boaOnly:2,dtOnly:1,ambiguous:1});
 });
 test("rejects serialized formula corruption with coordinate-only diagnostics",async()=>{
  const original=fpWriter.toFpRecXlsHtml;
  const spy=vi.spyOn(fpWriter,"toFpRecXlsHtml").mockImplementation(model=>original(model).replace('x:fmla="=B6+B3"','x:fmla="=1+1"'));
  try{expect(compareFortWorthSemantics(await buildFortWorthActual(boa,dt),buildOriginalAprilOracle(boa,dt))).toContain("fp_rec.B7");}finally{spy.mockRestore();}
 });
 test.each(["suffix","header","extra-row"])("rejects %s mutation",async kind=>{
  const original=mergedWriter.toMergedFloorplanXlsHtml,originalFp=fpWriter.toFpRecXlsHtml;
  const spy=kind==="suffix"?vi.spyOn(mergedWriter,"toMergedFloorplanXlsHtml").mockImplementation(model=>original(model).replace('>100001<','>999999<')):vi.spyOn(fpWriter,"toFpRecXlsHtml").mockImplementation(model=>kind==="header"?originalFp(model).replace('>GL FLOORED<','>Invented bad layout<'):originalFp(model).replace('</tbody>','<tr><td>Invented bad layout</td></tr></tbody>'));
  try{expect(compareFortWorthSemantics(await buildFortWorthActual(boa,dt),buildOriginalAprilOracle(boa,dt)).length).toBeGreaterThan(0);}finally{spy.mockRestore();}
 });
 test("verified synthetic attestation changes exactly its source identity through confirmed API",async()=>{
  const damaged=dt.replace("1ZZAA11A1ZA100001","1ZZAA11A1ZA10000");
  const attestation=parseCorrectionAttestation(JSON.stringify({boa_sha256:createHash("sha256").update(boa).digest("hex"),dealertrack_sha256:createHash("sha256").update(damaged).digest("hex"),source_side:"dealertrack",source_row_number:2,previous_vin:null,verified_vin:"1ZZAA11A1ZA100001",verified_by:"Synthetic operator",verified_at:"2026-10-05T12:00:00Z",verification_reference:"Invented independent DMS record",independent_of_goal:true}));
  const expected=buildOriginalAprilOracle(boa,damaged,attestation),actual=await buildFortWorthActual(boa,damaged,attestation);
  expect(actual.summary.matches).toBe(2);expect(compareFortWorthSemantics(actual,expected)).toEqual([]);expect(JSON.stringify(attestation)).toBe('{}');
  await expect(buildFortWorthActual(boa,dt,attestation)).rejects.toThrow("CORRECTION_EVIDENCE_MISMATCH");
 });
 test("invalid CSV and missing evidence errors do not echo raw input or paths",()=>{
  expect(()=>buildOriginalAprilOracle('"secret raw malformed',dt)).toThrow("EVIDENCE_PARSE_INVALID");
  expect(()=>loadOriginalApril("/private/tmp/not-an-approved-root")).toThrow("EVIDENCE_PATH_INVALID");
  expect(()=>requireCorrectionEvidence(undefined)).toThrow("BLOCKED_EVIDENCE_MISSING");
 });
});
const mode=process.env.FW_ACCEPTANCE_MODE;
if(!mode) test("A/C not evaluated without explicit protected acceptance mode",()=>{expect(mode).toBeUndefined();});
else test("explicit protected Fort Worth acceptance",async()=>{
 if(mode!=="original"&&mode!=="corrected")throw new Error("ACCEPTANCE_MODE_INVALID");
 const correction=mode==="corrected"?requireCorrectionEvidence(process.env.FW_VERIFIED_CORRECTION_FILE):undefined;
 const {boaCsv,dtCsv}=loadOriginalApril(process.env.FW_EVIDENCE_DIR);
 const expected=buildOriginalAprilOracle(boaCsv,dtCsv,correction),actual=await buildFortWorthActual(boaCsv,dtCsv,correction);
 if(mode==="corrected"){expect(expected.sectionTotals).toEqual({dealertrackOnlyCents:-168956209,boaOnlyCents:604073564});expect(expected.summary).toMatchObject({boa:794,dt:725,matches:687,boaOnly:107,dtOnly:38,exceptions:145,merged:832,boaCents:4034820196,dtCents:-3599702841,difference:435117355,net:435117355,variance:0,ambiguous:0});}
 else expect(expected.summary).toEqual({boa:794,dt:725,matches:686,boaOnly:108,dtOnly:39,exceptions:147,merged:833,boaCents:4034820196,dtCents:-3599702841,difference:435117355,net:435117355,variance:0,ambiguous:0});
 expect(compareFortWorthSemantics(actual,expected)).toEqual([]);
},30000);
