import {createHash} from 'node:crypto';
import {expect,test} from 'vitest';
import {buildFpRecWorkbookFromMergedFloorplan} from './fpRec.js';
import {toMergedFloorplanXlsHtml} from './mergedFloorplan.js';
import {toFpRecXlsHtml} from './fpRec.js';
import {ROOFTOP_PROFILES} from '../config/storeWorkflowConfig.js';
import {syntheticFwRow,syntheticFwWorkbook} from '../testFixtures/fw/workbooks.js';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
// Frozen from starting-commit serializers, not calculated by the implementation under test.
const baselines=[{"key": "hurst", "count": 0, "merged": "145445da4699cb0f0e72b9da7af4830f74d9dd12e194576e00fae7bb82768229", "fpRec": "50d89d2a149296888ca4268b642645465e71d2851f2e6f5c51badeb10237f452"}, {"key": "hurst", "count": 1, "merged": "f546508cf2bfdcd5e720f1b9ad0ea28c8350b07f95226d4c813311d2093afd3f", "fpRec": "d95c92e26c6335698834a18533cbf9aaa803c9a5c82f2cfac9e36f0073f3cf76"}, {"key": "hurst", "count": 20, "merged": "b97cc0287d9dad884268b97744f838c4c8a52c1b68daf6b690f1d460a539828b", "fpRec": "c7a6aa38431d17e5d736853a0caed4d57639280ec2b6c7d7969336abf22e44ef"}, {"key": "acura", "count": 0, "merged": "f299761281bf699ce8978ef236f1f1d0fd672d417ba947a9d873eaec46d93929", "fpRec": "85413e7f184e500827275fb876e7ae27c0fce72defb312cb8d8c89d57c1b84c3"}, {"key": "acura", "count": 1, "merged": "d210c642fc53cbfddcefaf5c93a8bdb812dd0bff5b978c2720ed9159685f205b", "fpRec": "946b17dfa0d328ec3d331114797dbe8dddb6942a34a4788a62eca996e9bc7cfb"}, {"key": "acura", "count": 20, "merged": "0108a76fd6fb6a1c1e318d4092b3e89d880b840d9d35c0ce7737d02b88dc0450", "fpRec": "dec004be97aecc05962cc55ab90f028a2836e6306c3a442e6cfe1b10e7cee6fc"}];
test.each(baselines)('$key keeps starting-commit bytes for $count detail rows',({key,count,merged:expectedMerged,fpRec:expectedFp})=>{
 const profile=ROOFTOP_PROFILES[key as "hurst"|"acura"];
 const merged={...syntheticFwWorkbook(Array.from({length:count},(_,i)=>syntheticFwRow(i%2?{classification:'dealertrack_only',dealertrack_account_amount_cents:-12345,dealertrack_description:'Invented <literal> 1ZZAA11A1ZA100001',dealertrack_control:'000123'}:{ending_balance_cents:12345,serial_no_vin:'1ZZAA11A1ZA100002',store_description:'=Invented text',boa_vin6:'100002'}))),store_config:profile,store_name:profile.displayName};
 const fp=buildFpRecWorkbookFromMergedFloorplan(merged,profile);
 expect(digest(toMergedFloorplanXlsHtml(merged))).toBe(expectedMerged);
 expect(digest(toFpRecXlsHtml(fp))).toBe(expectedFp);
});
