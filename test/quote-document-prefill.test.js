import test from "node:test";
import assert from "node:assert/strict";
import {documentPrefill} from "../src/docfill/prefill.js";

test("BII document prefills known prospect and approved device counts only",()=>{
 const fields=documentPrefill({business_name:"Example Dental",contact_name:"Jane Doe",email:"jane@exampledental.com",street_address:"123 Main",city:"Beaumont",state:"TX",zip:"77701"},{users:10,windows:3,mac:1,unallocated:2},"BII-QSOW");
 assert.equal(fields.preparedFor,"Jane Doe");
 assert.equal(fields.domain,"exampledental.com");
 assert.equal(fields.location,"123 Main, Beaumont TX 77701");
 assert.equal(fields.deviceTypes,"3 Windows; 1 Mac; 2 Platform not yet assigned");
 assert.equal(fields.legalName,"Example Dental");
 assert.equal(fields.signer,"");
 assert.equal(fields.summary,"");
});
test("Never infer a business domain from public mail or an authorized signer",()=>{
 const fields=documentPrefill({business_name:"ABC",email:"owner@gmail.com"},{users:5,computers:5},"COM-PRP");
 assert.equal(fields.domain,"");
 assert.equal(fields.legalName,"ABC");
 assert.equal(fields.assignedSummary,"5 computers");
 assert.deepEqual(fields.deviceKinds,["computers","phones","tablets"]);
 assert.equal(fields.serviceStartMode,"after_contracts");
});
