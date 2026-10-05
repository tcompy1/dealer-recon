import ExcelJS from "exceljs";
import type {MergedFloorplanWorkbook} from "./mergedFloorplan.js";
import type {FpRecWorkbook,HurstFpRecRow} from "./fpRec.js";
import {fortWorthSectionRows} from "./fortWorthFpRec.js";
import {accountingMonthEndDate,parseAccountingMonth} from "../domain/accountingMonth.js";
const MONEY='#,##0.00;(#,##0.00);0.00';
const margins={left:0.25,right:0.25,top:0.25,bottom:0.25,header:0.1,footer:0.1};
function dollars(cents:number):number {if(!Number.isSafeInteger(cents))throw new Error("Invalid integer monetary value.");return cents/100;}
function setup(book:ExcelJS.Workbook,name:string,orientation:"portrait"|"landscape") {
 book.calcProperties.fullCalcOnLoad=true;
 const sheet=book.addWorksheet(name,{pageSetup:{orientation,paperSize:1 as ExcelJS.PaperSize,fitToPage:true,fitToWidth:1,fitToHeight:0,margins}});
 return sheet;
}
function finish(sheet:ExcelJS.Worksheet) {
 sheet.eachRow(row=>{
  row.eachCell({includeEmpty:true},cell=>{cell.font={name:"Calibri",size:12,bold:cell.font?.bold??false};cell.alignment={...cell.alignment,vertical:"top"};});
 });
}
function formula(sheet:ExcelJS.Worksheet,address:string,text:string,cents:number){sheet.getCell(address).value={formula:text,result:dollars(cents)};sheet.getCell(address).numFmt=MONEY;}
export async function writeFortWorthMergedXlsx(model:MergedFloorplanWorkbook):Promise<Buffer> {
 if(model.store_config.storeKey!=="fw")throw new Error("Fort Worth model required.");
 const book=new ExcelJS.Workbook(),sheet=setup(book,"MERGED","landscape");
 const reviews=model.rows.some(row=>row.review!==undefined);
 const widths=[32,22,12,18,18,12,48,18,...(reviews?[42,18,18,18]:[])];
 sheet.columns=widths.map(width=>({width}));
 sheet.addRow([...model.headers,...(reviews?["Review","2100 component","2101 component","2101S component"]:[])]).font={bold:true};
 for(const data of model.rows){
  const row=sheet.addRow([data.store_description,data.serial_no_vin,data.boa_vin6,data.ending_balance_cents===null?null:dollars(data.ending_balance_cents),data.dealertrack_account_amount_cents===null?null:dollars(data.dealertrack_account_amount_cents),data.dealertrack_vin6,data.dealertrack_description,data.dealertrack_control,...(reviews?(data.review?[data.review.label,dollars(data.review.components["2100"]),dollars(data.review.components["2101"]),dollars(data.review.components["2101S"])]:[null,null,null,null]):[])]);
  for(const column of [1,7,...(reviews?[9]:[])])row.getCell(column).alignment={wrapText:true};
  const lines=Math.max(...[data.store_description,data.dealertrack_description,data.review?.label??""].map(text=>text.split("\n").reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length/35)),0)));
  row.height=Math.max(18,lines*16);
 }
 const last=model.rows.length+2;
 for(const column of [4,5,...(reviews?[10,11,12]:[])])sheet.getColumn(column).numFmt=MONEY;
 formula(sheet,`D${last}`,model.rows.length?`SUM(D2:D${last-1})`:"0",model.boa_total_amount_cents);
 formula(sheet,`E${last}`,model.rows.length?`SUM(E2:E${last-1})`:"0",model.dealertrack_total_amount_cents);
 sheet.getCell(`G${last}`).value="Final Totals:";sheet.getRow(last).font={bold:true};
 sheet.views=[{state:"frozen",ySplit:1}];sheet.pageSetup.printArea=`A1:${reviews?"L":"H"}${last}`;sheet.pageSetup.printTitlesRow="1:1";
 finish(sheet);return Buffer.from(await book.xlsx.writeBuffer());
}
export async function writeFortWorthFpRecXlsx(model:FpRecWorkbook):Promise<Buffer> {
 if(model.store_config.storeKey!=="fw")throw new Error("Fort Worth model required.");
 const month=model.presentation?.accounting_month??null;
 const parsed=parseAccountingMonth(month);if(!parsed)throw new Error("Selected accounting period required.");
 const date=new Date(`${accountingMonthEndDate(parsed)}T00:00:00Z`);
 const name=`${["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(-2)}`;
 const book=new ExcelJS.Workbook(),sheet=setup(book,name,"portrait");
 sheet.columns=[20.71,16.86,26.71,32.57,2,2].map(width=>({width}));sheet.getColumn(2).numFmt=MONEY;
 sheet.mergeCells("A1:D1");sheet.getCell("A1").value="Floorplan Reconciliation - Hiley Cars Fort Worth";sheet.getCell("A1").font={bold:true};
 sheet.getCell("A2").value=date;sheet.getCell("A2").numFmt="mm/dd/yyyy";
 sheet.getCell("A3").value="Outstanding on STMT";sheet.getCell("B3").value=dollars(model.boa_total_amount_cents);
 sheet.getCell("A4").value="GL Balances";sheet.getCell("A5").value="2100";sheet.getCell("B5").value=dollars(model.dealertrack_total_amount_cents);
 sheet.getCell("A6").value="Total GL";formula(sheet,"B6","SUM(B5)",model.dealertrack_total_amount_cents);
 sheet.getCell("A7").value="Difference";formula(sheet,"B7","B6+B3",model.summary.difference_amount_cents);
 const schedule=model.schedule_not_on_statement.rows,statement=model.statement_not_on_gl.rows;
 const positions=fortWorthSectionRows(schedule.length,statement.length);
 function header(row:number,label:string,c:string,d:string){sheet.getCell(`A${row}`).value=label;sheet.getCell(`C${row}`).value=c;sheet.getCell(`D${row}`).value=d;sheet.getRow(row).font={bold:true};}
 header(8,"On schedule-not on statement","GL FLOORED","BOA FLOORED");header(positions.statementHeader,"On statement-not on GL","BOA FLOORED","GL FLOORED");
 function detail(row:number,item:HurstFpRecRow){sheet.getCell(`A${row}`).value=item.unit_reference;sheet.getCell(`B${row}`).value=dollars(item.amount_cents);}
 schedule.forEach((item,index)=>detail(9+index,item));statement.forEach((item,index)=>detail(positions.statementHeader+1+index,item));
 const s=positions.scheduleSubtotal,t=positions.statementSubtotal;
 formula(sheet,`B${s}`,`SUM(B9:B${s-1})`,model.schedule_not_on_statement.total_amount_cents);
 formula(sheet,`B${t}`,`SUM(B${s+2}:B${t-1})`,model.statement_not_on_gl.total_amount_cents);
 sheet.getCell(`A${t+1}`).value="Net adjustments";formula(sheet,`B${t+1}`,`B${t}+B${s}`,model.net_adjustments_amount_cents);
 sheet.getCell(`A${t+2}`).value="Variance";formula(sheet,`B${t+2}`,`B${t+1}-B7`,model.variance_amount_cents);
 for(let row=1;row<=positions.variance;row++){
  for(const col of [1,3,4])sheet.getCell(row,col).alignment={wrapText:true};
  const text=String(sheet.getCell(row,1).value??"");
  const lines=row===1?1:text.split("\n").reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length/18)),0);
  sheet.getRow(row).height=Math.max(18,lines*16);
 }
 for(const row of [8,positions.statementHeader,s,t,t+1,t+2])for(let col=1;col<=4;col++)sheet.getCell(row,col).border={bottom:{style:"thin"}};
 sheet.pageSetup.printArea=`A1:F${positions.variance}`;finish(sheet);return Buffer.from(await book.xlsx.writeBuffer());
}
