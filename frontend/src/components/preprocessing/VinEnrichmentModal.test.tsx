import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {VinEnrichmentModal} from "./VinEnrichmentModal";
import * as api from "../../api/vinEnrichment";
import {ApiError} from "../../api/errorMessage";
vi.mock("../../api/vinEnrichment",()=>({listSourceFileTransactions:vi.fn(),getVinVerification:vi.fn(),applyVinEnrichment:vi.fn()}));
const current={id:7,source_type:"boa",source_file_id:2,dealership_store_id:1,stock_number:"TEST",vin:"1ZZAA11A1ZA100001",source_row_number:4,vin_enrichment_revision:3,assessment:{flags:[],operatorConfirmed:true},vin_provenance:null};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(api.getVinVerification).mockResolvedValue(current);vi.mocked(api.listSourceFileTransactions).mockResolvedValue([current]);});
afterEach(cleanup);
async function open(){fireEvent.click(screen.getByRole("button",{name:"Verify or correct VIN"}));await screen.findByText(current.vin);}
async function fill(){fireEvent.change(screen.getByLabelText("Proposed VIN"),{target:{value:"1ZZAA11A1ZA100002"}});fireEvent.click(screen.getByRole("checkbox"));}
test("valid full VIN replacement requires explicit confirmation and sends the displayed revision without narrative",async()=>{
 vi.mocked(api.applyVinEnrichment).mockResolvedValue({transaction:{id:7,vin:"1ZZAA11A1ZA100002",source_type:"boa"},enrichment_applied:true,vin6:"100002",source:null,audit_event_id:9,requires_rerun:true});
 render(<VinEnrichmentModal transactionId={7}/>);await open();
 fireEvent.change(screen.getByLabelText("Proposed VIN"),{target:{value:"1ZZAA11A1ZA100002"}});
 expect(screen.getByRole("button",{name:"Confirm VIN correction"})).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Confirm VIN correction"}));
 await screen.findByText(/Re-run reconciliation/);
 expect(api.applyVinEnrichment).toHaveBeenCalledWith(7,{vin:"1ZZAA11A1ZA100002",expected_revision:3,confirmed:true});
});
test("conflict disables stale submit until explicit refresh clears proposal and confirmation",async()=>{
 vi.mocked(api.applyVinEnrichment).mockRejectedValue(new ApiError("Refresh required",{status:409,code:"VIN_ENRICHMENT_REVISION_CONFLICT"}));
 render(<VinEnrichmentModal transactionId={7}/>);await open();await fill();fireEvent.click(screen.getByRole("button",{name:"Confirm VIN correction"}));
 await screen.findByText("Refresh required");expect(screen.getByRole("button",{name:"Confirm VIN correction"})).toBeDisabled();
 vi.mocked(api.getVinVerification).mockResolvedValue({...current,vin_enrichment_revision:4});fireEvent.click(screen.getByRole("button",{name:"Refresh and review"}));
 await waitFor(()=>expect(screen.getByLabelText("Proposed VIN")).toHaveValue(""));expect(screen.getByRole("checkbox")).not.toBeChecked();expect(api.applyVinEnrichment).toHaveBeenCalledTimes(1);
});
test("closing and reopening clears confirmation and loads a new revision",async()=>{
 render(<VinEnrichmentModal transactionId={7}/>);await open();await fill();fireEvent.click(screen.getByRole("button",{name:"Cancel"}));await open();
 expect(screen.getByLabelText("Proposed VIN")).toHaveValue("");expect(screen.getByRole("checkbox")).not.toBeChecked();
});
test("428 requires refresh and fresh confirmation",async()=>{
 vi.mocked(api.applyVinEnrichment).mockRejectedValue(new ApiError("Client must refresh",{status:428,code:"VIN_ENRICHMENT_REVISION_REQUIRED"}));
 render(<VinEnrichmentModal transactionId={7}/>);await open();await fill();fireEvent.click(screen.getByRole("button",{name:"Confirm VIN correction"}));await screen.findByText("Client must refresh");
 expect(screen.getByRole("checkbox")).not.toBeChecked();expect(screen.getByRole("button",{name:"Confirm VIN correction"})).toBeDisabled();expect(screen.getByRole("button",{name:"Refresh and review"})).toBeEnabled();
});
test("changing exact target clears proposal and confirmation",async()=>{
 const view=render(<VinEnrichmentModal transactionId={7}/>);await open();await fill();
 view.rerender(<VinEnrichmentModal transactionId={8}/>);await waitFor(()=>expect(api.getVinVerification).toHaveBeenCalledWith(8));
 expect(screen.getByLabelText("Proposed VIN")).toHaveValue("");expect(screen.getByRole("checkbox")).not.toBeChecked();
});
test("ambiguous diagnostic refresh cannot submit",async()=>{
 vi.mocked(api.listSourceFileTransactions).mockResolvedValue([current,{...current,id:8}]);
 render(<VinEnrichmentModal sourceFileId={2} sourceRowNumber={4} stockNumber="TEST"/>);fireEvent.click(screen.getByRole("button",{name:"Verify or correct VIN"}));
 await screen.findByText(/Could not safely identify/);expect(api.getVinVerification).not.toHaveBeenCalled();expect(screen.getByRole("button",{name:"Confirm VIN correction"})).toBeDisabled();
});
