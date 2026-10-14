import {afterEach,expect,test,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {VinVerificationPanel} from "./VinVerificationPanel";
import {listSourceFileTransactions,getVinVerification,applyVinEnrichment} from "../../api/vinEnrichment";
vi.mock("../../api/vinEnrichment",()=>({listSourceFileTransactions:vi.fn(),getVinVerification:vi.fn(),applyVinEnrichment:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
test.each(["boa","dealertrack"])("%s valid rows remain correctable; read-only view has no action",async source=>{
 vi.mocked(listSourceFileTransactions).mockResolvedValue([{id:7,source_type:source,source_file_id:1,dealership_store_id:1,vin:"1ZZAA11A1ZA100001",stock_number:null,source_row_number:2,vin_enrichment_revision:0,assessment:{flags:[],operatorConfirmed:false}}]);
 const view=render(<VinVerificationPanel sourceFileId={1} canModify onCorrected={()=>{}}/>);
 fireEvent.click(screen.getByRole("button",{name:/Review current source VINs/}));await screen.findByText("1ZZAA11A1ZA100001");expect(screen.getByRole("button",{name:"Verify or correct VIN"})).toBeEnabled();
 view.rerender(<VinVerificationPanel sourceFileId={1} canModify={false} onCorrected={()=>{}}/>);expect(screen.queryByRole("button",{name:"Verify or correct VIN"})).not.toBeInTheDocument();
});
test("all duplicate identities are accessible across pages",async()=>{
 vi.mocked(listSourceFileTransactions).mockResolvedValue(Array.from({length:51},(_,n)=>({id:n+1,source_type:"boa",source_file_id:1,dealership_store_id:1,vin:"1ZZAA11A1ZA100001",stock_number:null,source_row_number:null,vin_enrichment_revision:0,assessment:{flags:[],operatorConfirmed:false}})));
 render(<VinVerificationPanel sourceFileId={1} canModify onCorrected={()=>{}}/>);fireEvent.click(screen.getByRole("button",{name:/Review current source VINs/}));await screen.findAllByText("1ZZAA11A1ZA100001");fireEvent.click(screen.getByRole("button",{name:"Next rows"}));expect(screen.getAllByRole("button",{name:"Verify or correct VIN"})).toHaveLength(1);
});

test("success remains visible while refreshed source rows load",async()=>{
 const row={id:7,source_type:"boa",source_file_id:1,dealership_store_id:1,vin:"1ZZAA11A1ZA100001",stock_number:null,source_row_number:2,vin_enrichment_revision:0,assessment:{flags:[],operatorConfirmed:false}};
 vi.mocked(listSourceFileTransactions).mockResolvedValueOnce([row]).mockImplementationOnce(()=>new Promise(()=>{}));
 vi.mocked(getVinVerification).mockResolvedValue(row);
 vi.mocked(applyVinEnrichment).mockResolvedValue({transaction:{id:7,vin:"1ZZAA11A1ZA100002",source_type:"boa"},enrichment_applied:true,vin6:"100002",source:null,audit_event_id:1,requires_rerun:true});
 render(<VinVerificationPanel sourceFileId={1} canModify onCorrected={()=>{}}/>);fireEvent.click(screen.getByRole("button",{name:/Review current source VINs/}));fireEvent.click(await screen.findByRole("button",{name:"Verify or correct VIN"}));await screen.findByText("Revision being reviewed");
 fireEvent.change(screen.getByLabelText("Proposed VIN"),{target:{value:"1ZZAA11A1ZA100002"}});fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Confirm VIN correction"}));await waitFor(()=>expect(listSourceFileTransactions).toHaveBeenCalledTimes(2));expect(screen.getByText(/VIN corrected. Re-run reconciliation/)).toBeInTheDocument();
});
