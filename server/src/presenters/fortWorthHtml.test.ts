import {expect,test} from "vitest";
import {toMergedFloorplanXlsHtml} from "./mergedFloorplan.js";
import {buildFortWorthFpRecWorkbook,toFpRecXlsHtml} from "./fpRec.js";
import {ROOFTOP_PROFILES} from "../config/storeWorkflowConfig.js";
import {syntheticFwRow,syntheticFwWorkbook} from "../testFixtures/fw/workbooks.js";
import {readSpreadsheetHtml} from "../testUtils/spreadsheetHtml.js";
const offset=syntheticFwRow({classification:"dealertrack_only",dealertrack_account_amount_cents:0,dealertrack_description:"=literal <source> & data",dealertrack_control:"000123",review:{label:"Offsetting account balances—review.",components:{"2100":12300,"2101":-12300,"2101S":0}}});
test("merged HTML retains literal identifiers, offset components and dynamic totals in landscape",()=>{
 const model=syntheticFwWorkbook([offset,syntheticFwRow({ending_balance_cents:12345,store_description:"+literal",serial_no_vin:"1ZZAA11A1ZA100001",boa_vin6:"000001"})]);
 const sheet=readSpreadsheetHtml(toMergedFloorplanXlsHtml(model));
 expect(sheet.names).toEqual(["MERGED"]);expect(sheet.rows).toHaveLength(4);expect(sheet.rows[0]).toHaveLength(12);
 expect(sheet.getCell("G2").value).toBe("'=literal <source> & data");expect(sheet.getCell("G2").formula).toBeUndefined();expect(sheet.getCell("H2")).toMatchObject({value:"000123",text:true});expect(sheet.getCell("C3")).toMatchObject({value:"000001",text:true});
 expect(sheet.getCell("E2")).toMatchObject({value:0,numeric:true});expect(sheet.getCell("J2").value).toBe(123);expect(sheet.getCell("K2").value).toBe(-123);expect(sheet.getCell("L2").value).toBe(0);expect(sheet.getCell("I3").value).toBeNull();
 expect(sheet.getCell("D4")).toMatchObject({formula:"SUM(D2:D3)",value:123.45});expect(sheet.getCell("E4")).toMatchObject({formula:"SUM(E2:E3)",value:0});expect(sheet.getCell("G4").value).toBe("Final Totals:");
 expect(sheet.print).toBe("='MERGED'!A1:L4");expect(sheet.html).toContain('mso-page-orientation:landscape');expect(sheet.html).toContain('<x:FitWidth>1</x:FitWidth>');expect(sheet.html).toContain('Print_Titles');expect(sheet.html).not.toContain('<source>');
});
test("empty merged totals use zero formula, no self-reference or variance row",()=>{
 const sheet=readSpreadsheetHtml(toMergedFloorplanXlsHtml(syntheticFwWorkbook()));expect(sheet.rows).toHaveLength(2);expect(sheet.rows[0]).toHaveLength(8);expect(sheet.getCell("D2")).toMatchObject({formula:"0",value:0});expect(sheet.getCell("E2")).toMatchObject({formula:"0",value:0});expect(sheet.print).toBe("='MERGED'!A1:H2");
});
test.each([[0,0,10,13,15],[1,1,11,15,17],[38,107,48,158,160],[39,108,49,160,162],[150,200,160,363,365]])("FW HTML workpaper layout and formulas n=%i m=%i",(n,m,s,t,v)=>{
 const model=buildFortWorthFpRecWorkbook(syntheticFwWorkbook([...Array.from({length:n},()=>offset),...Array.from({length:m},()=>syntheticFwRow({ending_balance_cents:100,serial_no_vin:"1ZZAA11A1ZA100001"}))]),ROOFTOP_PROFILES.fw);
 const sheet=readSpreadsheetHtml(toFpRecXlsHtml(model));expect(sheet.names).toEqual(["APR26"]);expect(sheet.rows).toHaveLength(v);
 expect(sheet.getCell("A1").value).toBe("Floorplan Reconciliation - Hiley Cars Fort Worth");expect(sheet.getCell("A2").value).toBe("04/30/2026");expect(sheet.getCell("A3").value).toBe("Outstanding on STMT");
 for(const [address,formula] of Object.entries({B6:"SUM(B5)",B7:"B6+B3",[`B${s}`]:`SUM(B9:B${s-1})`,[`B${t}`]:`SUM(B${s+2}:B${t-1})`,[`B${t+1}`]:`B${t}+B${s}`,[`B${v}`]:`B${t+1}-B7`}))expect(sheet.getCell(address).formula).toBe(formula);
 expect(sheet.getCell(`C${s+1}`).value).toBe("BOA FLOORED");expect(sheet.getCell("C8").value).toBe("GL FLOORED");
 for(let row=9;row<v;row++)if(row!==s+1){expect(sheet.getCell(row,3).value).toBeNull();expect(sheet.getCell(row,4).value).toBeNull();}
 for(const row of [s-1,t-1])expect(sheet.rows[row-1].every(cell=>cell.value===null)).toBe(true);
 expect(sheet.rows.every(row=>row.length===4)).toBe(true);expect(sheet.print).toBe(`='APR26'!A1:F${v}`);expect(sheet.html).toContain('mso-page-orientation:portrait');expect(sheet.html).toContain('white-space:pre-wrap');expect(sheet.html).not.toContain('#fff2cc');expect(sheet.html).not.toMatch(/ProtectContents|Password|<script/i);
 if(n){expect(sheet.getCell("A9").value).toContain("\nOffsetting account balances—review.\n2100: 123.00; 2101: -123.00; 2101S: 0.00");expect(sheet.getCell("B9")).toMatchObject({value:0,numeric:true});}
});
test("full selected leap-year period is retained as readable date",async()=>{
 const {parseAccountingMonth}=await import("../domain/accountingMonth.js");const merged=syntheticFwWorkbook();merged.accounting_month=parseAccountingMonth("1996-02")!;merged.period_date="02-29-96";
 const sheet=readSpreadsheetHtml(toFpRecXlsHtml(buildFortWorthFpRecWorkbook(merged,ROOFTOP_PROFILES.fw)));expect(sheet.getCell("A2").value).toBe("02/29/1996");expect(sheet.names).toEqual(["FEB96"]);
});
