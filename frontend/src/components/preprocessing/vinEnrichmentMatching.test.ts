import {expect,test} from "vitest";
import {matchDiagnosticToTransaction} from "./vinEnrichmentMatching";
test("duplicate source ordinals are ambiguous even with a convenient stock number",()=>{
 expect(matchDiagnosticToTransaction([{id:1,source_row_number:3,stock_number:"A"},{id:2,source_row_number:3,stock_number:"B"}],3,"A")).toEqual({status:"ambiguous"});
});
