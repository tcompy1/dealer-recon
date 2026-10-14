/** Physical detail rows, one reserved blank row per section, then dynamic totals. */
export function fortWorthSectionRows(n:number,m:number) {
 if(!Number.isSafeInteger(n)||!Number.isSafeInteger(m)||n<0||m<0)throw new Error("Invalid section count.");
 const scheduleSubtotal=10+n,statementSubtotal=scheduleSubtotal+3+m;
 return {scheduleSubtotal,statementHeader:scheduleSubtotal+1,statementSubtotal,netAdjustments:statementSubtotal+1,variance:statementSubtotal+2};
}
