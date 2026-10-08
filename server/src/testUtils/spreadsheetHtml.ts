/** Test-only decoder for the exported HTML table; never a production presenter oracle. */
export type HtmlCell = {value:string|number|null; formula?:string; numeric:boolean; text:boolean; colspan:number};
export function decodeHtml(value:string):string {
 return value.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n:string)=>String.fromCodePoint(n[0].toLowerCase()==="x"?parseInt(n.slice(1),16):Number(n))).replace(/&(lt|gt|quot|apos|amp);/g,(_,name:string)=>({lt:"<",gt:">",quot:'"',apos:"'",amp:"&"}[name]!));
}
export function readSpreadsheetHtml(html:string){
 const rows:HtmlCell[][]=[];
 for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells:HtmlCell[]=[];
  for(const cell of row[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)){
   const attr=cell[1],numeric=/\bx:num\b/.test(attr),text=/\bx:str\b/.test(attr);
   const raw=decodeHtml(cell[2].replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]*>/g,""));
   const value=numeric?Number(raw.replace(/,/g,"").replace(/^\((.*)\)$/,"-$1")):raw||null;
   const formula=attr.match(/\bx:fmla="([^"]*)"/)?.[1];
   const colspan=Number(attr.match(/\bcolspan="(\d+)"/)?.[1]??1);
   cells.push({value,numeric,text,colspan,...(formula?{formula:decodeHtml(formula).replace(/^=/,"")}:{})});
   for(let i=1;i<colspan;i++)cells.push({value:null,numeric:false,text:false,colspan:0});
  }
  rows.push(cells);
 }
 const getCell=(address:string|number,column?:number):HtmlCell=>{
  let r:number,c:number;
  if(typeof address==="number"){r=address;c=column!;}else{const match=/^([A-Z]+)(\d+)$/.exec(address)!;r=Number(match[2]);c=[...match[1]].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0);}
  return rows[r-1]?.[c-1]??{value:null,numeric:false,text:false,colspan:1};
 };
 const names=[...html.matchAll(/<x:ExcelWorksheet>\s*<x:Name>(.*?)<\/x:Name>/g)].map(m=>decodeHtml(m[1]));
 const print=decodeHtml(html.match(/<x:Name>Print_Area<\/x:Name>\s*<x:Formula>(.*?)<\/x:Formula>/)?.[1]??"").replace(/\$/g,"");
 return {rows,getCell,names,print,html};
}
