/** Excel-compatible HTML metadata shared by scoped spreadsheet presentation policies. */
export function spreadsheetPrintMetadata(name:string,lastColumn:string,lastRow:number,orientation:"portrait"|"landscape",repeatHeader=false):string {
 const sheet=escapeSpreadsheetHtml(name);
 return `<!--[if gte mso 9]><xml>
<x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${sheet}</x:Name>
<x:WorksheetOptions><x:Selected/><x:PageSetup><x:Layout x:Orientation="${orientation}"/><x:PageMargins x:Bottom="0.25" x:Left="0.25" x:Right="0.25" x:Top="0.25"/></x:PageSetup><x:FitToPage/><x:Print><x:PaperSizeIndex>1</x:PaperSizeIndex><x:FitWidth>1</x:FitWidth><x:FitHeight>0</x:FitHeight></x:Print></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets><x:ExcelNames>
<x:ExcelName><x:Name>Print_Area</x:Name><x:Formula>=&apos;${sheet}&apos;!$A$1:$${lastColumn}$${lastRow}</x:Formula></x:ExcelName>
${repeatHeader?`<x:ExcelName><x:Name>Print_Titles</x:Name><x:Formula>=&apos;${sheet}&apos;!$1:$1</x:Formula></x:ExcelName>`:""}
</x:ExcelNames></x:ExcelWorkbook></xml><![endif]-->`;
}
export function spreadsheetPageStyle(orientation:"portrait"|"landscape"):string {
 return `@page { size:8.5in 11in; margin:0.25in; mso-page-orientation:${orientation}; }`;
}
export function escapeSpreadsheetHtml(text:string):string {
 return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
