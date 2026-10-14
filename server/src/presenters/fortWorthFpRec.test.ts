import {expect,test} from "vitest";
import {fortWorthSectionRows} from "./fortWorthFpRec.js";
test.each([[0,0,10,13,15],[1,1,11,15,17],[38,107,48,158,160],[39,108,49,160,162],[150,200,160,363,365]])("FW row equations n=%i m=%i",(n,m,s,t,v)=>{
 expect(fortWorthSectionRows(n,m)).toEqual({scheduleSubtotal:s,statementHeader:s+1,statementSubtotal:t,netAdjustments:t+1,variance:v});
});
import {buildFortWorthFpRecWorkbook} from "./fpRec.js";
import {ROOFTOP_PROFILES} from "../config/storeWorkflowConfig.js";
import {syntheticFwRow,syntheticFwWorkbook} from "../testFixtures/fw/workbooks.js";
test("FW preserves merged subsequences, signed totals, confirmed tail and blank notes including offset zero",()=>{
 const offset=syntheticFwRow({classification:"dealertrack_only",dealertrack_account_amount_cents:0,dealertrack_description:"original 1ZZAA11A1ZA100001",dealertrack_vin6:"100002",confirmed_dealertrack_vin:"1ZZAA11A1ZA100002",review:{label:"Offsetting account balances—review.",components:{"2100":12300,"2101":-12300,"2101S":0}}});
 const merged=syntheticFwWorkbook([offset,syntheticFwRow({classification:"boa_only",ending_balance_cents:-100,serial_no_vin:"1ZZAA11A1ZA100003"}),syntheticFwRow({classification:"dealertrack_only",dealertrack_account_amount_cents:75,dealertrack_description:"second"})]);
 const model=buildFortWorthFpRecWorkbook(merged,ROOFTOP_PROFILES.fw);
 expect(model.summary.difference_amount_cents).toBe(-25);expect(model.net_adjustments_amount_cents).toBe(-25);expect(model.variance_amount_cents).toBe(0);
 expect(model.schedule_not_on_statement.rows.map(r=>r.amount_cents)).toEqual([0,75]);expect(model.schedule_not_on_statement.rows[0].unit_reference).toBe("ZA100002\nOffsetting account balances—review.\n2100: 123.00; 2101: -123.00; 2101S: 0.00");
 expect(model.schedule_not_on_statement.rows.every(r=>r.gl_floored_note===""&&r.boa_floored_note==="")).toBe(true);expect(model.rows[0].dt_description).toBe(offset.dealertrack_description);
});
