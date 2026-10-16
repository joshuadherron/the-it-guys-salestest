import test from "node:test";
import assert from "node:assert/strict";
import {quoteLane,quoteFillMode} from "../src/docfill/policy.js";
import {buildManagedFill,buildBiiFill} from "../src/docfill/quote-fields.js";

const managedInput={pricingMode:"managed_v20",serviceTier:"managed",users:3,computers:3,servers:1,extraDevices:1,backupUsers:2,onsiteHours:0,onboarding:350,workstationBackups:0,serverBackups:0,includeBii:false};
const managedOwner={legalName:"Example LLC",preparedName:"Owner",preparedTitle:"Director",preparedEmail:"owner@example.test",backupContact:"Administrator",siteCount:1,domain:"example.test",serviceStartMode:"after_contracts",summary:"The IT Guys will support the selected staff and protect the listed business devices.",deviceKinds:["computers","phones","tablets"],onboardingMode:"standard",onboardingFee:350,onsiteMode:"hourly",onsiteHours:0,clientTerms:"None.",sizingMode:"today"};
test("Managed quote fields reconcile and use saved approved totals",()=>{
 const q={id:12,status:"Approved",inputs:managedInput,line_items:[
 {label:"Managed IT users (minimum $375)",amount:375},
 {label:"Shared/additional devices",amount:15},
 {label:"Managed servers",amount:75},
 {label:"Microsoft 365 backup users",amount:10}]};
 const result=buildManagedFill({quote:q,prospect:{business_name:"Example"},owner:managedOwner});
 assert.equal(result.fields["MIT.MonthlyTotal"],"$475");
 assert.equal(result.flags["IF.Servers"],true);
 assert.equal(result.flags["IF.OnSiteBlock"],false);
 assert.equal(result.rates["RATE.User"],"$125/month");
});
test("Managed quote refuses mismatch with approved line items",()=>{
 const q={id:12,inputs:managedInput,line_items:[{label:"Incorrect",amount:999}]};
 assert.throws(()=>buildManagedFill({quote:q,prospect:{business_name:"Example"},owner:managedOwner}),/does not match/);
});
test("Combined quote has two independently selectable contractual lanes",()=>{
 const combined={...managedInput,includeBii:true};
 assert.equal(quoteLane(combined,"COM-PRP").key,"COM-PRP");
 assert.throws(()=>quoteLane(combined,"BII-QSOW"),/separately approved/);
});
test("BII generation from a combined managed quote refuses unpriced scope",()=>{
 assert.throws(()=>buildBiiFill({quote:{inputs:{...managedInput,includeBii:true}},prospect:{business_name:"Example"},prices:{}}),/separately priced/);
});
test("Explicit quote fill gate controls only quote content writes",()=>{
 assert.equal(quoteFillMode({QUOTE_FILL_MODE:"live",SHAREPOINT_WRITE_MODE:"dryrun"}),"live");
 assert.equal(quoteFillMode({QUOTE_FILL_MODE:"live",SHAREPOINT_WRITE_MODE:"live"}),"live");
});

test("BII-only quote cannot be routed into Managed IT template",()=>{
 assert.throws(()=>quoteLane({includeBii:true,users:2},"COM-PRP"),/requires a Managed IT quote/);
});
