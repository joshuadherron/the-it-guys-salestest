import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ejs from "ejs";
import JSZip from "jszip";
import { validateProspect,insertProspect } from "../src/pipeline.js";
import { engagementTypes } from "../src/engagement-types.js";
import { validateIntake,missingIntake,intakeFlags,intakeFields,riskFields } from "../src/engagement-intake.js";
import { validateProjectQuote,priceProject } from "../src/project-pricing.js";
import { projectQuoteRoutes,assertProjectApproval,assertProjectAuthorization } from "../src/project-quotes.js";
import { universalRoutes } from "../src/universal-routes.js";
import { projectSharePointRoutes } from "../src/project-sharepoint.js";
import { projectDocument,projectTags,projectDiscovery,projectCapability } from "../src/project-contract.js";
import { buildProjectFill } from "../src/docfill/project-fields.js";
import { assertTagset } from "../src/docfill/tagsets.js";
import { fillDocx,listTags } from "../src/docfill/fill-docx.js";
import { quoteLane } from "../src/docfill/policy.js";
import { payload,buildFields } from "../src/sharepoint.js";
import { SharePointQuotes } from "../src/docfill/sharepoint-quotes.js";
import { attachBusiness,businessNameKey,lockBusinessRequests } from "../src/businesses.js";
import { handoffOutcome } from "../src/sales-handoff.js";
import { applyRequestStatus } from "../src/handoff.js";
import { engagementGuard } from "../src/engagement-guard.js";
import { prospectLifecycle,relationshipLabel } from "../src/prospect-lifecycle.js";

const owner={email:"owner@example.test",role:"owner",quote_approve:1,quote_send:1,is_admin:1,enabled:1};
const p={id:17,opp:"OPP-0017",business_id:9,business_name:"Example Technology",contact_name:"Pat",engagement_type:"project",service_lane:"Project-Based",stage:"Qualified",hold:false};
const answers=validateIntake({contact:"Pat",issue:"Email errors",scope:"Migrate two mailboxes",deliverables:"Mailboxes available",dependencies:"Admin consent",schedule:"Saturday",authorization:"Pat, owner",access:"Remote session",rate_authorization:"Two hours approved at the quoted rate"});
const intake={answers,complete:1,revision:3,flags:[],updated_by:owner.email};
const quoteBody={scope:"Migrate mailboxes",terms:"Written acceptance required; limited to the stated deliverables.",basis:"fixed",lines:[{label:"Migration",kind:"deliverable",quantity:1,unitPrice:3000,billing:"one_time"}]};
const config={hourly_rate:150,minimum_hours:1};
const input=validateProjectQuote(quoteBody,"project",config);
const q={id:51,prospect_id:17,quote_number:"Q-2026-051",inputs:input,line_items:priceProject(input).lines,total:"3000.00",status:"Approved",approved_at:"2026-10-21 12:00:00",stop_review:{intakeRevision:3}};
const env={PROJECT_WORKFLOW_CONTRACT:"v1",SHAREPOINT_WRITE_MODE:"live",PROJECT_QUOTE_MASTER_FILENAME:"Owner-approved-project-v1.docx",PROJECT_QUOTE_WORKFLOW_ID:"PRJ-05",PROJECT_QUOTE_TEMPLATE_VERSION:"v1",HOURLY_QUOTE_MASTER_FILENAME:"Owner-approved-hourly-v1.docx",HOURLY_QUOTE_WORKFLOW_ID:"PRJ-06",HOURLY_QUOTE_TEMPLATE_VERSION:"v1"};
const schema={siteId:"test",requestListId:"requests",businessColumn:"TIG_SalesBusinessID",maps:{
  requests:Object.fromEntries(["Title","Request Type","Processing Status","Source","Requested By","Client","Payload","Result Message","Service Lane"].map(name=>[name,{name,choice:{choices:name==="Service Lane"?["Project-Based"]:[]},...(name==="Client"?{lookup:{}}:{text:{}})}])),
  clients:{"Service Lanes":{name:"Service Lanes",choice:{choices:["Project-Based"]}},"Client ID":{name:"Client ID"},"Opportunity ID":{name:"Opportunity ID"},"Current Stage":{name:"Current Stage"},Title:{name:"Title"}},
}};
const lookup=async sql=>sql.includes("allowlist")?[{email:owner.email}]:[{name:"Qualified"},{name:"Prospecting"}];

for(const type of ["project","hourly"])test(`${type} prospect has an independent lane and no Managed IT/BII prerequisite`,async()=>{
  const value=await validateProspect({business_name:p.business_name,owner:owner.email,engagement_type:type},null,lookup);
  assert.equal(value.engagement_type,type);assert.equal(value.service_lane,"Project-Based");assert.equal(value.stage,"Prospecting");
});
test("legacy Managed IT/BII opportunities preserve their inferred types and lanes",async()=>{
  for(const [lane,type] of [["Managed IT","managed_it"],["Business IT Integration","bii"]]) {
    const value=await validateProspect({business_name:p.business_name,owner:owner.email,service_lane:lane},null,lookup);
    assert.equal(value.engagement_type,type);assert.equal(value.service_lane,lane);
  }
});
test("existing BII-to-Managed IT transition keeps the new opportunity classification consistent",async()=>{
  const opportunity={...p,engagement_type:"bii",service_lane:"Business IT Integration"},queries=[];
  await applyRequestStatus(opportunity,{id:2,status:"Pending",action:"TechnicalAssessment"},"Done","",{query:async sql=>{queries.push(sql);return [];},transaction:async fn=>fn({}),audit:async()=>{}});
  assert.equal(opportunity.service_lane,"Managed IT");assert.equal(opportunity.engagement_type,"managed_it");assert.ok(queries.some(sql=>sql.includes("engagement_type='managed_it'")));
});
test("project discovery reports exact question anchors; hourly does not require managed/project discovery",()=>{
  const missing=missingIntake("project",{},p);assert.equal(missing.length,7);assert.match(missing.find(m=>m.key==="deliverables").href,/#intake-deliverables$/);
  const hourly=Object.fromEntries(["contact","issue","scope","access","rate_authorization"].map(k=>[k,answers[k]]));
  assert.deepEqual(missingIntake("hourly",hourly,p),[]);assert.ok(missingIntake("project",hourly,p).length);
  assert.equal(intakeFlags(validateIntake({urgent_security:"yes"}))[0].urgent,true);
});
test("project estimates itemize scope without accounting or tax calculations",()=>{
  const draft=validateProjectQuote({...quoteBody,confirm_recurring:"yes",lines:[{label:"Equipment",kind:"equipment",quantity:2,unitPrice:100,taxable:true},{label:"Archive",kind:"other",quantity:1,unitPrice:15,billing:"monthly",taxable:true}]},"project",{...config,tax_rate:8.25,tax_label:"Ignored accounting settings"});
  const result=priceProject(draft);assert.equal(result.oneTimeTotal,200);assert.equal(result.monthlyTotal,15);assert.equal(result.total,215);assert.equal(result.lines.length,2);assert.equal(draft.taxRate,undefined);
  assert.throws(()=>validateProjectQuote({...quoteBody,lines:draft.lines},"project",config),/Explicitly confirm/);
});
test("hourly estimate honors the configured minimum and captures proposed rate without inventing one",()=>{
  const result=priceProject(validateProjectQuote({scope:"Repair Outlook",terms:"Time and materials subject to customer authorization.",estimatedHours:0.5,hourlyRate:150,lines:[]},"hourly",{...config,minimum_hours:2}));
  assert.equal(result.total,300);assert.equal(result.lines[0].quantity,2);
  assert.throws(()=>validateProjectQuote({estimatedHours:1,lines:[]},"hourly",{minimum_hours:0}),/hourly rate/);
});
test("invalid, negative, nonfinite and over-limit saved prices are rejected",()=>{
  for(const value of [-1,"NaN",Infinity,10000001])assert.throws(()=>priceProject({...input,lines:[{...input.lines[0],unitPrice:value}]}));
  assert.throws(()=>priceProject({...input,lines:[]}),/at least one/);
});
test("commercial approval is independent of intake and holds; authorization preserves lifecycle checks",async()=>{
  assert.equal((await assertProjectApproval(p,q,intake)).total,3000);
  assert.equal((await assertProjectApproval({...p,hold:true,stage:"Prospecting"},q,null)).total,3000);
  assert.equal((await assertProjectApproval(p,q,{...intake,revision:4})).total,3000);
  await assert.rejects(()=>assertProjectAuthorization({...p,hold:true},q,intake),/On Hold/);
  await assert.rejects(()=>assertProjectAuthorization({...p,stage:"Closed Lost"},q,intake),/lost/);
  assert.equal((await assertProjectAuthorization(p,q,{...intake,revision:4})).total,3000);
  await assert.rejects(()=>assertProjectAuthorization(p,q,{...intake,complete:0}),/Complete the appropriate intake/);
  await assert.rejects(()=>assertProjectApproval({...p,engagement_type:"hourly"},q,intake),/quote type differs/);
});
test("Project-Based client payload is independent of managed enrollment and rejects legacy actions",()=>{
  const discovery=projectDiscovery(p,intake),body=payload("CreateClient",p,"Project-Based",{discovery});
  assert.equal(body.businessId,"9");assert.equal(body.stage,"Sales Discovery");assert.equal(body.contractVersion,"project-v1");assert.equal(body.engagementType,"project");assert.ok(!JSON.stringify(body).includes("MIT-05"));
  assert.throws(()=>payload("CreateClient",{...p,client_id:"CL-1"},"Project-Based",{discovery}),/another SharePoint client/);
  assert.throws(()=>payload("TechnicalAssessment",p,"Project-Based",{}),/project request contract/);
  assert.throws(()=>payload("CreateClient",{...p,engagement_type:"managed_it"},"Project-Based",{discovery}),/project request contract/);
  assert.throws(()=>payload("CreateClient",p,"Project-Based",{discovery:{}}),/versioned project intake/);
});
test("optional project capability fails closed without altering existing required lane choices",()=>{
  assert.equal(projectCapability(schema,env).length,0);assert.equal(projectCapability(schema,{}).length,1);
  assert.throws(()=>buildFields(schema,"CreateClient",p,"Project-Based",owner.email,new Date(),null,{discovery:projectDiscovery(p,intake)},{}),/Power Automate/);
  const fields=buildFields(schema,"CreateClient",p,"Project-Based",owner.email,new Date(),null,{discovery:projectDiscovery(p,intake)},env);
  assert.equal(fields.fields["Request Type"],"Create Client");assert.equal(JSON.parse(fields.fields.Payload).businessId,"9");
});
test("no generic document pretends to be an existing approved master",()=>{
  assert.throws(()=>quoteLane(input,undefined,{}),/owner-approved ENG-PRJ template/);
  assert.equal(quoteLane(input,undefined,env).workflow,"PRJ-05");
  assert.equal(quoteLane({pricingMode:"hourly_v1"},undefined,env).key,"ENG-HRLY");
  assert.throws(()=>quoteLane(input,"COM-PRP",env),/match the approved engagement/);
  assert.throws(()=>projectDocument("COM-PRP",env),/Unsupported project/);
});

// Synthetic test-only content controls exercise the proposed contract; this is
// not a customer template and is never promoted or saved as an approved master.
async function syntheticMaster() {
  const zip=new JSZip(),inline=tag=>`<w:sdt><w:sdtPr><w:tag w:val="${tag}"/></w:sdtPr><w:sdtContent><w:r><w:t>[value]</w:t></w:r></w:sdtContent></w:sdt>`;
  const fields=projectTags.filter(t=>!t.startsWith("Line.")&&!t.startsWith("REPEAT."));
  zip.file("word/document.xml",`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${fields.map(inline).join("")}</w:p><w:sdt><w:sdtPr><w:tag w:val="REPEAT.Line"/></w:sdtPr><w:sdtContent><w:p>${projectTags.filter(t=>t.startsWith("Line.")).map(inline).join("")}</w:p></w:sdtContent></w:sdt></w:body></w:document>`);
  return zip.generateAsync({type:"nodebuffer"});
}
for(const type of ["project","hourly"])test(`${type} DOCX contract fills all proposed fields from the approved snapshot`,async()=>{
  const inputs=type==="project"?input:validateProjectQuote({scope:"Repair",terms:"Authorized time and materials only",estimatedHours:2,hourlyRate:150,lines:[]},"hourly",config);
  const source=await syntheticMaster(),key=type==="project"?"ENG-PRJ":"ENG-HRLY";
  assertTagset(key,await listTags(source));
  const result=await fillDocx(source,buildProjectFill({quote:{...q,inputs},prospect:p}));
  assert.deepEqual(result.report.unfilled,[]);
  const xml=await (await JSZip.loadAsync(result.buffer)).file("word/document.xml").async("string");
  assert.ok(xml.includes(type==="project"?"3000.00":"300.00"));assert.ok(!xml.includes("[value]"));assert.ok(!xml.includes("MIT."));
});
test("SharePoint project master resolution requires the exact configured approved filename",async()=>{
  const source=await syntheticMaster();let promoted=false;
  const resolver=new SharePointQuotes({ready:()=>schema},{all:async path=>path.endsWith("/columns")?[{name:"Key",displayName:"Document Key"},{name:"Status",displayName:"Status"}]:path.includes("/items?")?[{fields:{Key:"ENG-PRJ",Status:"Approved"},driveItem:{id:"doc",parentReference:{driveId:"drive"},name:promoted?env.PROJECT_QUOTE_MASTER_FILENAME:"unapproved-version.docx"}}]:[{id:"library",displayName:"Operational Standards & Templates"}],quoteContent:async()=>source},env);
  await assert.rejects(()=>resolver.master("ENG-PRJ"),/Expected exactly one promoted Approved/);
  promoted=true;assert.equal((await resolver.master("ENG-PRJ")).name,env.PROJECT_QUOTE_MASTER_FILENAME);
});

function harness(register,options={}) {
  const routes=new Map(),writes=[],audits=[];let handoff=null,pending=options.pending||[];
  const business={id:9,name:p.business_name,client_id:options.clientId||null,client_item_id:options.clientId?"12":null};
  const quote=structuredClone(options.quote||q),opportunity={...p,...options.p},record={...intake,...options.intake};
  const query=async(sql,args=[],c)=>{
    if(sql.startsWith("SELECT * FROM allowlist"))return options.revoked?[]:[{...owner,...options.actor}];
    if(sql.startsWith("SELECT name,amount FROM config_prices"))return [{name:"project_hourly_rate",amount:150},{name:"project_minimum_hours",amount:1}];
    if(sql.startsWith("SELECT d.*"))return [record];
    if(sql.startsWith("SELECT * FROM businesses"))return [business];
    if(sql.startsWith("SELECT * FROM activities WHERE prospect_id=? AND outcome=?"))return handoff?[handoff]:[];
    if(sql.startsWith("SELECT r.id FROM sp_requests"))return pending;
    if(sql.startsWith("SELECT * FROM sp_requests"))return pending;
    if(sql.startsWith("SELECT id FROM quotes"))return [];
    if(sql.startsWith("SELECT id FROM businesses WHERE client_id"))return [];
    if(sql.startsWith("SELECT * FROM quotes"))return options.noQuote?[]:[quote];
    if(sql.startsWith("SELECT * FROM quote_fills"))return [];
    if(sql.startsWith("INSERT")||sql.startsWith("UPDATE")) {
      assert.ok(c||sql.startsWith("UPDATE sp_requests"),"writes use a transaction");writes.push({sql,args});
      if(sql.startsWith("INSERT INTO activities")&&args[1]===handoffOutcome)handoff={id:1,notes:args[2],actor:owner.email};
      if(sql.startsWith("INSERT INTO sp_requests"))pending=[{id:88}];
      if(sql.startsWith("UPDATE quotes SET status='Approved'"))Object.assign(quote,{status:"Approved",stop_review:JSON.parse(args[3])});
      return {insertId:88,affectedRows:1};
    }
    throw new Error("Unexpected query: "+sql);
  };
  const graphCalls=[];
  const sp={ready:()=>schema,client:async()=>options.remoteRecord,clients:async()=>[],requests:async()=>[]};
  register({get:(path,...handlers)=>routes.set("GET "+path,handlers),post:(path,...handlers)=>routes.set("POST "+path,handlers)},{query,transaction:async fn=>fn({transaction:true}),audit:async(...args)=>audits.push(args),prospect:async()=>({...opportunity}),sp,graph:{createWorkflowRequest:async(...args)=>{graphCalls.push(args);if(options.transportError)throw new Error("timeout");return {id:"remote-88"};}},refresh:async()=>{},env:{...env,...options.env}});
  const req={params:{id:"17"},body:{},query:{},session:{user:{...owner,...options.actor}}},res={status(){return this;},send(v){this.sent=v;},render(view,data){this.view=view;this.data=data;},redirect(v){this.redirected=v;}};
  const call=async key=>{for(const handler of routes.get(key)){let proceed=false;await handler(req,res,()=>{proceed=true;});if(!proceed)break;}};
  return {req,res,call,writes,audits,graphCalls,quote,record,opportunity,routes};
}
test("lightweight intake reuses discovery revisions and exposes no execution-management routes",async()=>{
  const h=harness(universalRoutes);h.req.body={...answers,revision:"3",complete:"yes"};await h.call("POST /prospects/:id/intake");
  assert.ok(h.writes.some(w=>w.sql.startsWith("INSERT INTO discoveries")));
  const version=h.writes.find(w=>w.sql.startsWith("INSERT INTO discovery_versions"));assert.equal(version.args[1],4);assert.equal(JSON.parse(version.args[2])._intake_complete,true);
  assert.ok(![...h.routes.keys()].some(path=>/\/engagement$|invoice|timesheet|dispatch|ticket|tasks/.test(path)));
  assert.ok(!h.writes.some(w=>/engagements|engagement_intakes/.test(w.sql)));
});
test("stale lightweight intake submissions cannot overwrite a newer discovery revision",async()=>{
  const h=harness(universalRoutes);h.req.body={...answers,revision:"2",complete:"yes"};await assert.rejects(()=>h.call("POST /prospects/:id/intake"),/another tab/);assert.equal(h.writes.length,0);
});
test("saving corrected intake cannot discard prior discovery concerns through posted fields",async()=>{
  const prior=[{code:"URGENT SECURITY REVIEW"}],h=harness(universalRoutes,{intake:{answers:{...answers,_prior_discovery_flags:prior}}});
  h.req.body={...answers,revision:"3",complete:"yes",_prior_discovery_flags:[]};await h.call("POST /prospects/:id/intake");
  const saved=JSON.parse(h.writes.find(w=>w.sql.startsWith("INSERT INTO discoveries")).args[1]);assert.deepEqual(saved._prior_discovery_flags,prior);assert.equal(saved._opportunity_type,"project");
});
test("project quotes save a new draft and never invalidate historical approvals",async()=>{
  const h=harness(projectQuoteRoutes);h.req.body={...quoteBody,revise_id:"51"};await h.call("POST /prospects/:id/project-quotes");
  assert.equal(h.writes.filter(w=>w.sql.startsWith("INSERT INTO quotes")).length,1);assert.ok(!h.writes.some(w=>w.sql.includes("approved_at=NULL")));assert.match(h.res.redirected,/quote=88/);
});
test("project approval captures intake revision and requires an owner with approval permission",async()=>{
  const h=harness(projectQuoteRoutes,{quote:{...q,status:"Draft"}});h.req.params.id="51";h.req.body={reviewed:"yes"};await h.call("POST /quotes/:id/project-approve");
  assert.equal(h.quote.status,"Approved");assert.equal(h.quote.stop_review.intakeRevision,3);assert.ok(!h.writes.some(w=>w.sql.includes("businesses")||w.sql.includes("engagements")));
  const denied=harness(projectQuoteRoutes,{quote:{...q,status:"Draft"},actor:{role:"sales"}});denied.req.body={reviewed:"yes"};await assert.rejects(()=>denied.call("POST /quotes/:id/project-approve"),/Owner approval/);
});

test("early held project can save and approve commercial pricing without completed intake",async()=>{
  const options={p:{hold:true,stage:"Prospecting"},intake:{complete:0,answers:{}},quote:{...q,status:"Draft"}};
  const draft=harness(projectQuoteRoutes,options);draft.req.body=quoteBody;
  await draft.call("POST /prospects/:id/project-quotes");
  assert.ok(draft.writes.some(w=>w.sql.startsWith("INSERT INTO quotes")));
  const approval=harness(projectQuoteRoutes,options);approval.req.body={reviewed:"yes"};
  await approval.call("POST /quotes/:id/project-approve");
  assert.equal(approval.quote.stop_review.customPricingReviewed,true);
  assert.ok(!approval.writes.some(w=>/activities|businesses|sp_requests/.test(w.sql)));
});

test("commercial approval survives intake edits; current complete intake remains required for authorization",async()=>{
  const commercial={...q,stop_review:{customPricingReviewed:true,intakeRevision:3}};
  assert.equal((await assertProjectAuthorization(p,commercial,{...intake,revision:4})).total,3000);
  await assert.rejects(()=>assertProjectAuthorization(p,commercial,{...intake,complete:0,revision:4}),/before authorizing work/);
});

test("manual project send records actual send without SharePoint fill and does not reopen a closed sale",async()=>{
  const h=harness(projectQuoteRoutes,{p:{hold:true,stage:"Closed Lost"},intake:{complete:0,answers:{}}});
  h.req.body={confirm:"yes"};await h.call("POST /quotes/:id/project-sent");
  assert.ok(h.writes.some(w=>w.sql.startsWith("UPDATE quotes SET status='Sent'")));
  assert.ok(h.writes.some(w=>w.sql.includes("stage NOT IN ('Closed Won','Closed Lost')")));
  assert.equal(h.graphCalls.length,0);
  const unconfirmed=harness(projectQuoteRoutes);await assert.rejects(()=>unconfirmed.call("POST /quotes/:id/project-sent"),/actually sent/);
  assert.equal(unconfirmed.writes.length,0);
});

test("sales outcomes need no intake, quote or SharePoint request; Won is not work authorization",async()=>{
  for(const outcome of ["Won","Lost","On hold"]){
    const h=harness(universalRoutes,{p:{stage:"Prospecting",hold:true},noQuote:true,intake:{complete:0,answers:{}}});
    h.req.body={outcome,note:"Customer discussed this outcome"};await h.call("POST /prospects/:id/sales-outcome");
    assert.equal(h.graphCalls.length,0);
    assert.ok(!h.writes.some(w=>/sp_requests|businesses|hold=FALSE|service_lane/.test(w.sql)));
    const note=h.writes.find(w=>w.sql.startsWith("INSERT INTO activities"));assert.equal(note.args[1],"Sales status: "+outcome);assert.notEqual(note.args[1],handoffOutcome);
  }
  const denied=harness(universalRoutes,{actor:{role:"sales"}});denied.req.body={outcome:"Won",note:"Do not allow"};
  await denied.call("POST /prospects/:id/sales-outcome");assert.match(denied.res.sent,/Owner/);
  assert.equal(denied.writes.length,0);
});

test("project SharePoint creation accepts early sales stage but still requires complete intake and no hold",async()=>{
  const h=harness(projectSharePointRoutes,{p:{stage:"Prospecting"}});await h.call("POST /prospects/:id/project-sharepoint");assert.equal(h.graphCalls.length,1);
  for(const options of [{p:{hold:true}},{intake:{complete:0,answers:{}}}]){
    const blocked=harness(projectSharePointRoutes,options);await assert.rejects(()=>blocked.call("POST /prospects/:id/project-sharepoint"));assert.equal(blocked.graphCalls.length,0);
  }
});
test("work authorization accepts reordered MySQL JSON keys, records a customer and never activates Managed IT",async()=>{
  const reordered={...q,line_items:q.line_items.map(l=>Object.fromEntries(Object.entries(l).reverse()))};
  const h=harness(universalRoutes,{quote:reordered});h.req.body={quote_id:"51",confirm:"yes",authorization_kind:"Written acceptance",authorization_reference:"Email from Pat dated 2026-10-21"};await h.call("POST /prospects/:id/authorize");
  assert.ok(h.writes.some(w=>w.sql.startsWith("INSERT INTO activities")));assert.ok(h.writes.some(w=>w.sql.includes("relationship_status='Customer'")));assert.ok(h.writes.some(w=>w.sql.includes("stage='Closed Won'")));
  const note=JSON.parse(h.writes.find(w=>w.sql.startsWith("INSERT INTO activities")).args[2]);assert.equal(note.quote_id,51);assert.equal(note.authorization_reference,"Email from Pat dated 2026-10-21");assert.equal(note.snapshot_hash.length,64);
  assert.ok(!h.writes.some(w=>/Managed IT|Client Activation|Onboarding|service_lane=/.test(w.sql)));
  await assert.rejects(()=>h.call("POST /prospects/:id/authorize"),/already has a recorded authorization/);
});
test("authorization rejects absent evidence, changed pricing, incomplete current intake and revoked permissions",async()=>{
  for(const options of [{},{quote:{...q,total:"1.00"}},{intake:{complete:0,revision:4}},{revoked:true}]) {
    const h=harness(universalRoutes,options);h.req.body={quote_id:"51",confirm:"yes",authorization_kind:"Written acceptance",authorization_reference:Object.keys(options).length?"Actual acceptance email":""};
    await assert.rejects(()=>h.call("POST /prospects/:id/authorize"));assert.equal(h.writes.length,0);
  }
});
test("project-only record creation sends only Project-Based v1 identity and intake",async()=>{
  const h=harness(projectSharePointRoutes);await h.call("POST /prospects/:id/project-sharepoint");
  assert.equal(h.graphCalls.length,1);const fields=h.graphCalls[0][2],body=JSON.parse(fields.Payload);
  assert.equal(fields["Service Lane"],"Project-Based");assert.equal(body.businessId,"9");assert.equal(body.stage,"Sales Discovery");assert.ok(!JSON.stringify(fields).includes("MIT-05"));
});
test("second project reuses the shared customer's SharePoint identity without creating or enrolling anything",async()=>{
  const remoteRecord={id:"12",fields:{"Client ID":"CL-9"}};
  const h=harness(projectSharePointRoutes,{clientId:"CL-9",remoteRecord});await h.call("POST /prospects/:id/project-sharepoint");
  assert.equal(h.graphCalls.length,0);assert.ok(h.writes.some(w=>w.sql.startsWith("UPDATE businesses SET client_id")));assert.ok(h.writes.some(w=>w.sql.includes("WHERE business_id=?")));
});

test("existing business record reuse does not depend on unneeded new-record flow configuration",async()=>{
  const remoteRecord={id:"12",fields:{"Client ID":"CL-9"}};
  const h=harness(projectSharePointRoutes,{clientId:"CL-9",remoteRecord,env:{PROJECT_WORKFLOW_CONTRACT:"",SHAREPOINT_WRITE_MODE:"dryrun"}});
  await h.call("GET /prospects/:id/project-sharepoint");assert.deepEqual(h.res.data.prerequisites,[]);
  await h.call("POST /prospects/:id/project-sharepoint");assert.equal(h.graphCalls.length,0);
  assert.ok(h.writes.some(w=>w.sql.startsWith("UPDATE businesses SET client_id")));
});
test("duplicate prevention blocks simultaneous and uncertain business requests before dispatch",async()=>{
  for(const status of ["Preparing","Pending","Processing","Unknown"]) {
    const h=harness(projectSharePointRoutes,{pending:[{id:99,status}]});await assert.rejects(()=>h.call("POST /prospects/:id/project-sharepoint"),/Reconcile/);assert.equal(h.graphCalls.length,0);
  }
  const h=harness(projectSharePointRoutes);await h.call("POST /prospects/:id/project-sharepoint");await assert.rejects(()=>h.call("POST /prospects/:id/project-sharepoint"),/Reconcile/);assert.equal(h.graphCalls.length,1);
});
test("uncertain SharePoint transport is recorded Unknown and never blindly replayed",async()=>{
  const h=harness(projectSharePointRoutes,{transportError:true});await assert.rejects(()=>h.call("POST /prospects/:id/project-sharepoint"),/uncertain/);
  assert.ok(h.writes.some(w=>w.sql.includes("status='Unknown'")));await assert.rejects(()=>h.call("POST /prospects/:id/project-sharepoint"),/Reconcile/);assert.equal(h.graphCalls.length,1);
});
test("missing project flow opt-in blocks requests with no remote or local writes",async()=>{
  const h=harness(projectSharePointRoutes,{env:{PROJECT_WORKFLOW_CONTRACT:""}});await assert.rejects(()=>h.call("POST /prospects/:id/project-sharepoint"),/Power Automate/);assert.equal(h.writes.length,0);assert.equal(h.graphCalls.length,0);
});
test("business request lock hydrates an existing identity and permits only its own preparation requests",async()=>{
  const opportunity={...p},run=async sql=>sql.startsWith("SELECT * FROM businesses")?[{id:9,client_id:"CL-9",client_item_id:"12"}]:[{id:51}];
  await assert.rejects(()=>lockBusinessRequests(opportunity,run,{}),/Reconcile/);await lockBusinessRequests(opportunity,run,{},[51]);assert.equal(opportunity.client_id,"CL-9");
});
test("business selection permits multiple opportunities without duplicate customer records; same-name implicit merges are refused",async()=>{
  const writes=[],business={id:9,name:p.business_name,client_id:"CL-9",client_item_id:"12"};
  const storage={audit:async()=>{},query:async(sql,args)=>{if(sql.startsWith("SELECT * FROM businesses"))return [business];if(sql.startsWith("SELECT id FROM businesses"))return [{id:9}];writes.push({sql,args});return [];}};
  await attachBusiness({...p,id:17},9,owner,{},storage);await attachBusiness({...p,id:18},9,owner,{},storage);
  assert.equal(writes.filter(w=>w.sql.startsWith("UPDATE prospects")).length,2);assert.ok(!writes.some(w=>w.sql.startsWith("INSERT INTO businesses")));
  await assert.rejects(()=>attachBusiness(p,null,owner,{},storage),/already exists/);assert.equal(businessNameKey(" Example Technology "),businessNameKey("example technology"));
});
test("new opportunity under an existing business persists its canonical name and shared identity",async()=>{
  let inserted,linked;
  const storage={audit:async()=>{},query:async(sql,args)=>{
    if(sql.startsWith("SELECT * FROM businesses"))return [{id:9,name:p.business_name,client_id:"CL-9",client_item_id:"12"}];
    if(sql.startsWith("INSERT INTO prospects")){inserted=Object.fromEntries(sql.match(/\((.*?)\) VALUES/)[1].split(",").map((key,i)=>[key,args[i]]));return {insertId:18};}
    if(sql.startsWith("UPDATE prospects SET business_id")){linked=args;return {};}
    return lookup(sql);
  }};
  assert.equal(await insertProspect({business_id:"9",business_name:"Ignored duplicate name",owner:owner.email,engagement_type:"hourly"},owner,{},storage),18);
  assert.equal(inserted.business_name,p.business_name);assert.equal(inserted.engagement_type,"hourly");assert.equal(linked[0],9);assert.equal(linked[2],"CL-9");
});
test("generic customers remain distinct from active Managed IT and from quote approval",()=>{
  assert.equal(prospectLifecycle({...p,client_id:"CL-9",sharepoint_stage:"Operations"}).status,"Active");
  assert.equal(prospectLifecycle({...p,client_id:"CL-9",business_relationship_status:"Customer"}).status,"Active");
  assert.equal(prospectLifecycle({...p,client_id:"CL-9",business_relationship_status:"Customer",sales_authorized:true}).status,"Converted");
  assert.match(relationshipLabel({...p,business_relationship_status:"Customer"}),/no Managed IT coverage/);
});
test("legacy command guard blocks managed activation commands for generic opportunities but preserves legacy paths",async()=>{
  const guard=engagementGuard({prospect:async()=>p,query:async()=>[q]});
  for(const path of ["/prospects/17/handoff","/prospects/17/work-items","/prospects/17/signature","/quotes/51/approve","/prospects/17/discovery/release"])await assert.rejects(()=>guard({path,method:"POST"},{},()=>{}),e=>e.status===409);
  let next=false;await engagementGuard({prospect:async()=>({...p,engagement_type:"managed_it"}),query:async()=>[]})({path:"/prospects/17/handoff",method:"POST"},{},()=>{next=true;});assert.equal(next,true);
});
test("migration is additive and preserves existing opportunity IDs, quote/audit rows and exact Client ID groups",async()=>{
  const sql=await readFile("migrations/013_universal_pipeline.sql","utf8");
  assert.ok(!/\b(DROP|DELETE|TRUNCATE|RENAME)\b/i.test(sql));assert.ok(!/UPDATE\s+(quotes|audit_log|discoveries|discovery_versions)\b/i.test(sql));
  assert.match(sql,/GROUP BY CASE WHEN NULLIF\(client_id,''\)/);assert.match(sql,/ELSE CONCAT\('OPP:',id\)/);assert.match(sql,/DEFAULT 'bii'/);assert.ok(!/CREATE TABLE engagements/i.test(sql));
});

test("all universal views render escaped business data, appropriate forms and missing-question links",async()=>{
  const unsafe={...p,business_name:"<script>unsafe</script>"},common={p:unsafe,user:owner,csrf:"test",mode:"dryrun",engagementTypes};
  const cases={
    businesses:{businesses:[{id:9,name:unsafe.business_name,relationship_status:"Prospect",opportunities:2}],search:""},
    business:{business:{id:9,name:unsafe.business_name,relationship_status:"Customer"},opportunities:[unsafe],},
    opportunity:{intake,handoff:null,quotes:[q],missing:[],flags:[],canSend:true},
    "engagement-intake":{intakeFields,riskFields,answers:{},revision:0,complete:false,missing:missingIntake("project",{},unsafe),flags:[],error:null},
    "project-quotes":{quotes:[q],selected:q,input,json:v=>v,config,canApprove:true,canSend:true,intakeComplete:true,missing:[]},
    "project-quote-print":{q,input,lines:q.line_items,calculation:priceProject(input)},
    "project-pricing-config":{config},"project-sharepoint":{record:null,error:null,prerequisites:[],requests:[{id:88,prospect_id:17,action:"CreateClient",status:"Unknown",result_message:"Delivery uncertain"}]},
    "project-document":{q,lane:projectDocument("ENG-PRJ",env),error:null,fillMode:"dryrun"},
  };
  for(const [view,locals] of Object.entries(cases)){const html=await ejs.renderFile(`views/${view}.ejs`,{...common,...locals});assert.ok(!html.includes("<script>unsafe</script>"),view);assert.ok(html.includes('name="_csrf"')||["businesses","business","project-quote-print"].includes(view),view);}
});
