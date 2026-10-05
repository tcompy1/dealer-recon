import {expect,test} from "vitest";
import ExcelJS from "exceljs";
import {writeFortWorthMergedXlsx,writeFortWorthFpRecXlsx} from "./fortWorthXlsx.js";
import {buildFortWorthFpRecWorkbook} from "./fpRec.js";
import {ROOFTOP_PROFILES} from "../config/storeWorkflowConfig.js";
import {syntheticFwRow,syntheticFwWorkbook} from "../testFixtures/fw/workbooks.js";
async function reopen(buffer:Buffer){expect(buffer.subarray(0,2).toString()).toBe("PK");const book=new ExcelJS.Workbook();await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);expect(book.worksheets).toHaveLength(1);return book;}
const offset=syntheticFwRow({classification:"dealertrack_only",dealertrack_account_amount_cents:0,dealertrack_description:"=literal source",dealertrack_control:"000123",review:{label:"Offsetting account balances—review.",components:{"2100":12300,"2101":-12300,"2101S":0}}});
test("merged native types, literal text, review components, caches and fitted landscape range",async()=>{
 const model=syntheticFwWorkbook([offset,syntheticFwRow({ending_balance_cents:12345,store_description:"+literal",serial_no_vin:"1ZZAA11A1ZA100001",boa_vin6:"000001"})]);
 const book=await reopen(await writeFortWorthMergedXlsx(model)),sheet=book.getWorksheet("MERGED")!;
 expect(sheet.getCell("G2").value).toBe("=literal source");expect(sheet.getCell("H2").value).toBe("000123");expect(sheet.getCell("C3").value).toBe("000001");
 expect(sheet.getCell("E2").value).toBe(0);expect(sheet.getCell("J2").value).toBe(123);expect(sheet.getCell("K2").value).toBe(-123);expect(sheet.getCell("L2").value).toBe(0);expect(sheet.getCell("I3").value).toBeNull();
 expect(sheet.getCell("D4").value).toEqual({formula:"SUM(D2:D3)",result:123.45});expect(sheet.getCell("E4").value).toMatchObject({formula:"SUM(E2:E3)"});expect(sheet.getCell("G4").value).toBe("Final Totals:");
 expect(sheet.pageSetup).toMatchObject({orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0,printArea:"A1:L4",printTitlesRow:"1:1"});
 expect(sheet.views[0]).toMatchObject({state:"frozen",ySplit:1});
});
test("empty merged totals use zero formula without self-reference and eight columns",async()=>{
 const sheet=(await reopen(await writeFortWorthMergedXlsx(syntheticFwWorkbook()))).worksheets[0];
 expect(sheet.getCell("D2").formula).toBe("0");expect(sheet.getCell("E2").formula).toBe("0");expect(sheet.columnCount).toBe(8);expect(sheet.pageSetup.printArea).toBe("A1:H2");
});
test.each([[0,0,10,13,15],[1,1,11,15,17],[38,107,48,158,160],[39,108,49,160,162],[150,200,160,363,365]])("FP REC native formulas and notes n=%i m=%i",async(n,m,s,t,v)=>{
 const model=buildFortWorthFpRecWorkbook(syntheticFwWorkbook([...Array.from({length:n},()=>offset),...Array.from({length:m},()=>syntheticFwRow({ending_balance_cents:100,serial_no_vin:"1ZZAA11A1ZA100001"}))]),ROOFTOP_PROFILES.fw);
 const book=await reopen(await writeFortWorthFpRecXlsx(model)),sheet=book.getWorksheet("APR26")!;
 expect(sheet.getCell("A1").value).toBe("Floorplan Reconciliation - Hiley Cars Fort Worth");expect(sheet.getCell("A2").value).toEqual(new Date("2026-04-30T00:00:00Z"));expect(sheet.getCell("A3").value).toBe("Outstanding on STMT");
 expect(sheet.getCell("B6").formula).toBe("SUM(B5)");expect(sheet.getCell("B7").formula).toBe("B6+B3");expect(sheet.getCell(`B${s}`).formula).toBe(`SUM(B9:B${s-1})`);expect(sheet.getCell(`B${t}`).formula).toBe(`SUM(B${s+2}:B${t-1})`);expect(sheet.getCell(`B${t+1}`).formula).toBe(`B${t}+B${s}`);expect(sheet.getCell(`B${v}`).formula).toBe(`B${t+1}-B7`);
 expect(sheet.getCell(`C${s+1}`).value).toBe("BOA FLOORED");expect(sheet.getCell("C8").value).toBe("GL FLOORED");
 expect(sheet.pageSetup).toMatchObject({orientation:"portrait",paperSize:1,fitToPage:true,fitToWidth:1,fitToHeight:0,printArea:`A1:F${v}`});
 for(let row=9;row<v;row++)if(row!==s+1){expect(sheet.getCell(`C${row}`).value).toBeNull();expect(sheet.getCell(`D${row}`).value).toBeNull();}
 if(n){expect(sheet.getCell("A9").value).toContain("Offsetting account balances—review.");expect(sheet.getCell("B9").value).toBe(0);expect(sheet.getRow(9).height).toBeGreaterThan(45);}
 expect(sheet.model.merges).toEqual(["A1:D1"]);
});

test("serialized OOXML requests full recalculation, fitted print and zero caches without macros, external links or sheet protection",async()=>{
 const {default:JSZip}=await import("jszip");
 for(const bytes of [await writeFortWorthMergedXlsx(syntheticFwWorkbook()),await writeFortWorthFpRecXlsx(buildFortWorthFpRecWorkbook(syntheticFwWorkbook([offset]),ROOFTOP_PROFILES.fw))]){
  const zip=await JSZip.loadAsync(bytes);const xml=await zip.file("xl/worksheets/sheet1.xml")!.async("string");const workbook=await zip.file("xl/workbook.xml")!.async("string");
  expect(xml).toContain('fitToPage="1"');expect(xml).toContain('<v>0</v>');expect(xml).not.toContain("sheetProtection");expect(workbook).toContain('fullCalcOnLoad="1"');
  expect(Object.keys(zip.files).some(name=>/externalLinks|vbaProject/i.test(name))).toBe(false);
 }
});
test("full selected leap-year accounting month survives model and native date",async()=>{
 const {parseAccountingMonth}=await import("../domain/accountingMonth.js");const merged=syntheticFwWorkbook();merged.accounting_month=parseAccountingMonth("1996-02")!;merged.period_date="02-29-96";
 const sheet=(await reopen(await writeFortWorthFpRecXlsx(buildFortWorthFpRecWorkbook(merged,ROOFTOP_PROFILES.fw)))).worksheets[0];expect(sheet.getCell("A2").value).toEqual(new Date("1996-02-29T00:00:00Z"));expect(sheet.name).toBe("FEB96");
});
