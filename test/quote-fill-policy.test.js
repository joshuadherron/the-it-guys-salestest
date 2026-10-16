import test from "node:test";
import assert from "node:assert/strict";
import {quoteFillMode,quoteLane,assertQuoteFillEligible} from "../src/docfill/policy.js";
test("defaults to download-only dryrun",()=>assert.equal(quoteFillMode({}),"dryrun"));
test("explicit live fill is independent of Workflow Requests dryrun",()=>assert.equal(quoteFillMode({QUOTE_FILL_MODE:"live",SHAREPOINT_WRITE_MODE:"dryrun"}),"live"));
test("requires both flags for live writes",()=>assert.equal(quoteFillMode({QUOTE_FILL_MODE:"live",SHAREPOINT_WRITE_MODE:"live"}),"live"));
test("routes approved lanes to separate contractual documents",()=>{
 assert.equal(quoteLane({includeBii:true}).key,"BII-QSOW");
 assert.equal(quoteLane({pricingMode:"managed_v20",serviceTier:"managed"}).key,"COM-PRP");
 assert.throws(()=>quoteLane({pricingMode:"managed_v20",serviceTier:"managed",includeBii:true},"BII-QSOW"),/separately approved/);
 assert.throws(()=>quoteLane({pricingMode:"managed_v20",serviceTier:"managed",includeBii:false},"BII-QSOW"));
 assert.throws(()=>quoteLane({pricingMode:"managed_v20",serviceTier:"monitoring"}));
});
test("requires owner approval and exactly one open copy",()=>{
 const base={canSend:true,status:"Approved",clientId:"CL-0001",workingCopies:[{name:"quote.docx"}],completionStatus:"Open",signatureStatus:"Preparing"};
 assert.equal(assertQuoteFillEligible(base).name,"quote.docx");
 for(const changes of [{canSend:false},{status:"Draft"},{clientId:null},{workingCopies:[]},{requestsPending:true},{signatureStatus:"Ready to send"}])
 assert.throws(()=>assertQuoteFillEligible({...base,...changes}));
});
