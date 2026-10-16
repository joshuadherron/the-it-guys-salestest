import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ejs from "ejs";
import { buildManagedFill } from "../src/docfill/quote-fields.js";
import { priceManagedServices } from "../src/pricing.js";
import { validateManagedInputs } from "../src/quotes.js";
import { documentPrefill } from "../src/docfill/prefill.js";
import { DEFAULT_MANAGED_SUMMARY, formattedQuoteNumber } from "../src/docfill/managed-facts.js";
import { fillDocx, listTags } from "../src/docfill/fill-docx.js";
import { quoteDocumentRoutes } from "../src/docfill/routes.js";
const reference=createRequire(import.meta.url)("./reference/quote-fields.reference.js");
const prospect={id:1,business_name:"Example LLC",contact_name:"Jane Doe",email:"jane@example.test",city:"Beaumont"};
const baseInput={pricingMode:"managed_v20",serviceTier:"managed",users:10,computers:10,assignedPhones:4,assignedTablets:0,extraDevices:20,servers:0,backupUsers:0,onsiteHours:0,onboarding:350,workstationBackups:0,serverBackups:0,includeBii:false};
const baseOwner={...documentPrefill(prospect,baseInput,"COM-PRP"),legalName:"Example LLC",preparedName:"Jane Doe",preparedTitle:"Director",preparedEmail:"jane@example.test",backupContact:"Backup Administrator"};
function quote(input={}){const inputs={...baseInput,...input};const calc=priceManagedServices(inputs);return {id:10,prospect_id:1,status:"Approved",created_at:"2026-10-15 10:00:00",approved_at:"2026-10-15 12:00:00",inputs,line_items:calc.lines,total:calc.total};}
const fill=(owner={},input={})=>buildManagedFill({quote:quote(input),prospect,owner:{...baseOwner,...owner}});
test("sites row maps counts and cities without street addresses",()=>{
 assert.equal(fill().fields["MIT.Locations"],"Single office");
 assert.equal(fill({siteCount:2,siteCities:"Beaumont, Houston"}).fields["MIT.Locations"],"2 locations (Beaumont, Houston)");
 assert.throws(()=>fill({siteCount:2,siteCities:"123 Main St"}),/city names only/);
});
test("domain row validates Microsoft 365 domains",()=>{
 assert.equal(fill({domain:"EXAMPLE.TEST"}).fields["MIT.Domain"],"example.test");
 for(const domain of ["services","http://services.com","a b.com","joe@services.com"])
  assert.throws(()=>fill({domain}),/domain/);
});
test("prepared-for row joins name title and email, prefilling contact facts",()=>{
 assert.equal(fill().fields["MIT.PreparedFor"],"Jane Doe, Director \u2014 jane@example.test");
 const p=documentPrefill(prospect,baseInput,"COM-PRP");assert.equal(p.preparedName,"Jane Doe");assert.equal(p.preparedEmail,"jane@example.test");
 assert.equal(fill({preparedName:""}).fields["MIT.PreparedFor"],undefined);
 assert.equal(fill({preparedTitle:""}).fields["MIT.PreparedFor"],undefined);
});
test("service-start row uses a long date or explicit after-contracts choice",()=>{
 assert.equal(fill({serviceStartMode:"date",serviceStartDate:"2026-12-01"}).fields["MIT.ServiceStart"],"December 1, 2026");
 assert.equal(fill().fields["MIT.ServiceStart"],"After contracts are signed");
 assert.throws(()=>fill({serviceStartMode:"date",serviceStartDate:"2026-02-30"}),/valid service start/);
});
test("summary row uses the reference default and rejects short replacement text",()=>{
 assert.equal(fill().fields["MIT.SummaryText"],reference.mitFields({users:10,computers:10,date:"2026-10-15",onboarding:350}).fields["MIT.SummaryText"]);
 assert.equal(fill().fields["MIT.SummaryText"],DEFAULT_MANAGED_SUMMARY);
 assert.throws(()=>fill({summary:"Managed IT"}),/40 characters/);
});
test("device-kinds row uses selected kinds rather than free text",()=>{
 assert.equal(fill().fields["MIT.DeviceKinds"],"computers, phones and tablets");
 assert.equal(fill({deviceKinds:["computers","tablets"]}).fields["MIT.DeviceKinds"],"computers and tablets");
 assert.equal(fill({deviceKinds:[]}).fields["MIT.DeviceKinds"],undefined);
});
test("assigned quantities row comes only from approved counts, separate from shared devices",()=>{
 const result=fill({assignedDevices:"20 shared devices",computers:999});
 assert.equal(result.fields["MIT.AssignedDevices"],"10 computers, 4 phones");
 assert.equal(result.fields["MIT.DevicesSummary"],"10 computers, 4 phones");
 assert.match(result.fields["MIT.DevicesCoveredNote"],/10 computers, 4 phones/);
 assert.equal(result.fields["MIT.SharedCalc"],"20 shared devices \u00d7 $15");
});
test("onboarding scope row uses the exact standard or after-BII reference sentence",()=>{
 for(const [onboardingMode,integrationFirst] of [["standard",false],["after_bii",true]]){
  const result=fill({onboardingMode,hipaa:true}),ref=reference.mitFields({users:10,computers:10,date:"2026-10-15",onboarding:350,integrationFirst,hipaa:true});
  for(const key of ["MIT.OnboardingText","MIT.IntegrationNote","MIT.BAANote","MIT.BAAAccept"])assert.equal(result.fields[key],ref.fields[key]);
 }
});
test("client-specific terms row defaults to None. and accepts owner terms",()=>{
 assert.equal(fill().fields["MIT.ClientTerms"],"None.");
 assert.equal(fill({clientTerms:"Scheduled work requires the director's approval."}).fields["MIT.ClientTerms"],"Scheduled work requires the director's approval.");
});
test("sizing row maps today opening and Other facts",()=>{
 assert.equal(fill().fields["MIT.SizedFor"],"your business as it is today");
 assert.equal(fill({sizingMode:"opening"}).fields["MIT.SizedFor"],"your business as it opens");
 assert.equal(fill({sizingMode:"other",sizingOther:"two locations"}).fields["MIT.SizedFor"],"two locations");
 assert.equal(fill({sizingMode:"other",sizingOther:""}).fields["MIT.SizedFor"],undefined);
});
test("onboarding fee row blocks zero unless explicitly waived with a note",()=>{
 assert.throws(()=>fill({onboardingFee:0},{onboarding:0}),/Waive onboarding/);
 assert.throws(()=>fill({onboardingFee:0,waiveOnboarding:true},{onboarding:0}),/waiver note/);
 assert.equal(fill({onboardingFee:0,waiveOnboarding:true,waiverNote:"Owner waived the fee for this engagement."},{onboarding:0}).fields["MIT.Onboarding"],"Waived");
 assert.throws(()=>fill({onboardingFee:500}),/approved worksheet/);
});
test("on-site row uses the exact hourly and block reference wording",()=>{
 assert.equal(fill().fields["MIT.OnSiteText"],"On-site visits, when needed, are billed at $125/hour in 30-minute increments.");
 const result=fill({onsiteMode:"block",onsiteHours:2},{onsiteHours:2});
 const ref=reference.mitFields({users:10,computers:10,date:"2026-10-15",onboarding:350,onSiteBlockHours:2});
 assert.equal(result.fields["MIT.OnSiteText"],ref.fields["MIT.OnSiteText"]);assert.equal(result.flags["IF.OnSiteBlock"],true);
 assert.throws(()=>fill({onsiteMode:"block",onsiteHours:5},{onsiteHours:2}),/approved worksheet/);
});
test("LOB and exclusions row uses optional facts inside reference contract wording",()=>{
 const result=fill({lobPrefix:"dental practice-management or other ",extraExclusions:"custom software"});
 assert.equal(result.fields["MIT.LOBPrefix"],"dental practice-management or other ");
 assert.equal(result.fields["MIT.ExtraExclusions"],"; custom software");
});
test("Quote 10 regression: formatted number, breakdown, long dates and conditional minimum",()=>{
 const fields=fill({serviceStartMode:"date",serviceStartDate:"2026-12-01"}).fields;
 assert.equal(fields["MIT.QuoteId"],"Q-2026-010");assert.equal(fields["MIT.Breakdown"],"10 users \u00d7 $125, 20 shared devices \u00d7 $15");
 assert.equal(fields["MIT.ServiceStart"],"December 1, 2026");assert.doesNotMatch(fields["MIT.Breakdown"],/minimum/);
 assert.match(fill({}, {users:2,computers:2,assignedPhones:0}).fields["MIT.Breakdown"],/3-user minimum/);
 assert.doesNotMatch(fill({}, {users:3,computers:3,assignedPhones:0}).fields["MIT.Breakdown"],/minimum/);
 assert.equal(formattedQuoteNumber({...quote(),id:1000}),"Q-2026-1000");
});
test("zero computers requires explicit confirmation and never prints 0 computers",()=>{
 assert.throws(()=>fill({}, {computers:0}),/No company computers/);
 const result=fill({noCompanyComputers:true},{computers:0,assignedPhones:0});
 assert.equal(result.fields["MIT.AssignedDevices"],"Users on shared devices only");
 assert.ok(!Object.values(result.fields).some(v=>String(v).includes("0 computers")));
});
test("missing facts stay unfilled and sentinel text never becomes contract content",async()=>{
 const owner={onboardingFee:350,siteCount:"",deviceKinds:[],preparedName:"",summary:"",backupContact:"",domain:"",serviceStartMode:"",legalName:""};
 const result=buildManagedFill({quote:quote(),prospect:{},owner});
 for(const key of ["MIT.ClientLegalName","MIT.PreparedFor","MIT.BackupContact","MIT.Locations","MIT.Domain","MIT.ServiceStart","MIT.SummaryText","MIT.DeviceKinds"])
  assert.equal(result.fields[key],undefined,key);
 const master=await readFile(new URL("./fixtures/COM-PRP-v1.8.docx",import.meta.url));
 const generated=await fillDocx(master,result);assert.ok(generated.report.unfilled.includes("MIT.Domain"));assert.ok((await listTags(generated.buffer)).includes("MIT.Domain"));
 for(const bad of ["None","null","undefined","IDK","0","None."])assert.throws(()=>fill({domain:bad}),/real value/);
});
test("generation form exposes structured facts and excludes free-text contract controls",async()=>{
 const html=await ejs.renderFile("views/quote-document.ejs",{p:prospect,q:quote(),lane:{key:"COM-PRP",label:"Managed IT Quote"},prefill:baseOwner,csrf:"token",user:{role:"owner"},mode:"dryrun"});
 for(const name of ["siteCount","siteCities","preparedName","preparedTitle","preparedEmail","serviceStartDate","deviceKinds","onboardingMode","onboardingFee","waiveOnboarding","waiverNote","onsiteMode","onsiteHours","sizingMode","lobPrefix","extraExclusions"])
  assert.ok(html.includes(`name="${name}"`),name);
 for(const name of ["assignedDevices","onboardingText","locations","serviceStart"])assert.ok(!html.includes(`name="${name}"`),name);
});
test("worksheet keeps assigned company phones/tablets separate and applies the three-device allowance",()=>{
 const input=validateManagedInputs({...baseInput,includeBii:"",assignedPhones:"4",assignedTablets:"2"});
 assert.equal(input.assignedPhones,4);assert.equal(input.assignedTablets,2);
 assert.equal(priceManagedServices({...baseInput,users:3,computers:3,assignedPhones:3,assignedTablets:3}).pending.length,0);
 assert.match(priceManagedServices({...baseInput,users:3,computers:3,assignedPhones:4,assignedTablets:3}).pending.join(" "),/3 assigned/);
});
test("document route stores formatted identity and owner facts including waiver audit context",async()=>{
 const routes=new Map(),q=quote({onboarding:0});q.inputs=JSON.stringify(q.inputs);q.line_items=JSON.stringify(q.line_items);const writes=[];
 const query=async(sql,params)=>{writes.push({sql,params});if(sql.startsWith("SELECT * FROM quotes"))return [q];return [];};
 quoteDocumentRoutes({get:(path,...handlers)=>routes.set("GET "+path,handlers),post:(path,...handlers)=>routes.set("POST "+path,handlers)},{query,json:v=>typeof v==="string"?JSON.parse(v):v,transaction:async f=>f({}),audit:async()=>{},prospect:async()=>prospect,priceConfig:async()=>({})});
 const req={params:{id:10},query:{lane:"COM-PRP"},body:{...baseOwner,lane:"COM-PRP",onboardingFee:0,waiveOnboarding:"yes",waiverNote:"Owner waiver for test."},session:{user:{role:"owner",quote_send:true}}};
 let downloaded;
 const res={locals:{csrf:"token"},render:()=>{},set:()=>{},send:b=>{downloaded=b;}};
 for(const f of routes.get("GET /quotes/:id/document"))await f(req,res,()=>{});
 for(const f of routes.get("POST /quotes/:id/document"))await f(req,res,()=>{});
 assert.equal(q.quote_number,"Q-2026-010");assert.ok(Buffer.isBuffer(downloaded));
 const saved=writes.find(w=>w.sql.startsWith("UPDATE quotes SET document_facts"));assert.equal(JSON.parse(saved.params[0]).waiverNote,"Owner waiver for test.");
});
