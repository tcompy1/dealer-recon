import { expect, test } from "vitest";
import { parseVinEnrichmentRequest } from "./requestParsers.js";
const valid={vin:"1ZZAA11A1ZA100001",expected_revision:0,confirmed:true};
test.each([{}, {source:null,reason:null,dms_reference:null},{source:" ",reason:" ",dms_reference:" "}])("optional fields are absent or blank without invented text", fields => {
  expect(parseVinEnrichmentRequest({...valid,...fields})).toEqual({...valid,source:null,reason:null,dms_reference:null});
});
test.each([{expected_revision:-1},{expected_revision:0.5},{expected_revision:"0"},{expected_revision:2147483648},{source:"unknown"},{reason:123},{dms_reference:7},{confirmed:"true"}])("rejects malformed supplied field",fields=>{
  expect(parseVinEnrichmentRequest({...valid,...fields})).toHaveProperty("error");
});
