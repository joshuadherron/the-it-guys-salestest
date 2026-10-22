import test, { before, after } from "node:test";
const oldMode = process.env.SHAREPOINT_WRITE_MODE;
before(() => { process.env.SHAREPOINT_WRITE_MODE = "dryrun"; });
after(() => { if(oldMode === undefined) delete process.env.SHAREPOINT_WRITE_MODE; else process.env.SHAREPOINT_WRITE_MODE = oldMode; });
import assert from "node:assert/strict";
import ejs from "ejs";
import { existingClientRoutes } from "../src/existing-clients.js";
import { handoffRoutes } from "../src/handoff.js";
import { SharePoint, validateSchema, required, requiredChoices, payload } from "../src/sharepoint.js";
import { clientSummary, additionalAnswers, duplicateClients, assertExistingTransition } from "../src/existing-client-rules.js";
import { nextStep } from "../src/next-step.js";
import { emptyAnswers, groups } from "../src/discovery-rules.js";
function connection() {
  const columns = kind => required[kind].map((displayName, n) => ({displayName,
    name: displayName === "Title" ? "Title" : displayName === "Opportunity ID" ? "TIG_SalesOpportunityID" : `${kind}_${n}`,
    ...(requiredChoices[kind][displayName] ? {choice:{choices:requiredChoices[kind][displayName]}} : displayName === "Client" ? {lookup:{}} : {text:{}}),
  }));
  return {...validateSchema(columns("requests"), columns("clients")),siteId:"site",requestListId:"requests"};
}
function harness({existing=true, linked=true, active=false, missing=false, role="owner", additional=true,engagementType,quoted=false,savedDiscovery=false}={}) {
  const s=connection(), writes=[], routes=new Map(), records=[];
  const p={id:46,opp:"OPP-0046",business_name:"Golden Triangle ABA",stage:"Qualified",engagement_type:engagementType,service_lane:"Managed IT",relationship_type:existing?"existing_client":"new_client",...(linked?{client_id:"CL-0007",client_item_id:"17"}:{})};
  const values={Title:"Golden Triangle ABA","Client ID":"CL-0007","Current Stage":"Acceptance","Stage Status":"Complete","Service Lanes":active?["Business IT Integration","Managed IT"]:["Business IT Integration"],"Next Action":"Review additional service"};
  const row={id:"17",fields:Object.fromEntries(Object.entries(values).map(([k,v])=>[s.maps.clients[k].name,v]))};
  const answers=emptyAnswers();
  if(!existing) {for(const [,ids] of groups) for(const id of ids) answers[id]={state:"not_sure",value:null};answers["Q1.3"]={state:"not_sure",value:null};}
  const query=async(sql, params=[])=>{
    writes.push({sql,params});
    if(sql.startsWith("SELECT * FROM allowlist"))return [{role,email:role==="owner"?"josh@theitguys.us":"alanna@theitguys.us",enabled:1}];
    if(sql.startsWith("SELECT id FROM quotes"))return quoted?[{id:77}]:[];
    if(sql.startsWith("SELECT * FROM discoveries"))return savedDiscovery?[{answers:JSON.stringify(answers),revision:2,status:"Ready for Review",flags:"[]"}]:[];
    if(sql.startsWith("SELECT complete FROM additional")) return [{complete:additional}];
    if(sql.startsWith("SELECT * FROM additional")) return [];
    if(sql.includes("action='TechnicalAssessment' AND status='Done'")) return records.filter(r=>r.status==="Done"&&r.action==="TechnicalAssessment");
    if(sql.startsWith("SELECT id FROM sp_requests")) return records.filter(r=>["Preparing","Pending","Processing","Unknown"].includes(r.status)).map(r=>({id:r.id}));
    if(sql.startsWith("SELECT id,action,status FROM sp_requests"))return records;
    if(sql.startsWith("SELECT * FROM sp_requests")) return records;
    if(sql.startsWith("INSERT INTO sp_requests")){records.push({id:records.length+1,action:params[1],body:JSON.parse(params[2]),status:"Preparing"});return {insertId:records.length};}
    if(sql.startsWith("UPDATE sp_requests SET status=?,item_id")){records[params[2]-1].status=params[0];return [];}
    if(sql.startsWith("UPDATE prospects SET relationship_type")){[p.relationship_type,p.client_id,p.client_item_id,p.service_lane,p.engagement_type]=params;return [];}
    return [];
  };
  const sp={cache:s,ready:()=>s,clients:async()=>missing?[]:[row],client:async()=>missing?null:row,requests:async()=>[]};
  const deps={query,transaction:async fn=>fn({}),audit:async()=>{},prospect:async()=>({...p}),sp,discovery:async()=>({answers,revision:0,status:existing?"Draft":"Ready for Review"}),refresh:async()=>missing?null:clientSummary(row,s),graph:{createWorkflowRequest:()=>assert.fail("No Graph write permitted")}};
  const app={get:(path,...f)=>routes.set("GET "+path,f),post:(path,...f)=>routes.set("POST "+path,f)};
  existingClientRoutes(app,deps);handoffRoutes(app,deps);
  const session={user:{role,email:role==="owner"?"josh@theitguys.us":"alanna@theitguys.us"}};
  let rendered;
  const res={render:(view,data)=>{rendered={view,data};},redirect:()=>{},status(code){this.code=code;return this;},send(message){throw Object.assign(new Error(message),{status:this.code});}};
  return {p,s,row,sp,records,writes,session,deps, async call(path,body={},q={}){
    for(const fn of routes.get(path)) await fn({params:{id:p.id},body,query:q,session},res,()=>{});
    return rendered;
  }};
}
test("EC1 explicit existing-client selection stores the stable link and shows live context",async()=>{
 const h=harness({existing:false,linked:false});
 const selection=await h.call("GET /prospects/:id/relationship",{}, {q:"Golden"});
 assert.equal(selection.data.clients[0]["Client ID"],"CL-0007");
 await h.call("POST /prospects/:id/relationship",{relationship_type:"existing_client",client_id:"CL-0007",service_lane:"Managed IT"});
 assert.equal(h.p.client_id,"CL-0007");assert.equal(h.p.client_item_id,"17");assert.equal(h.p.relationship_type,"existing_client");
 const page=await h.call("GET /prospects/:id/handoff");
 const html=await ejs.renderFile("views/handoff.ejs",{...page.data,csrf:"token",user:h.session.user,mode:"dryrun"});
 assert.ok(html.includes("Existing SharePoint Client"));assert.ok(html.includes("Acceptance"));assert.ok(!html.includes('value="CreateClient"'));
 await assert.rejects(()=>h.call("POST /prospects/:id/handoff",{action:"CreateClient",service_lane:"Managed IT"}),/never create/);
});
test("EC2 existing clients use additional discovery and skip full MVD",async()=>{
 const h=harness();const page=await h.call("GET /prospects/:id/additional-discovery");
 assert.equal(page.view,"additional-discovery");
 const step=nextStep({...h.p,additional_discovery_complete:false},null,[],clientSummary(h.row,h.s),[],[],"owner");
 assert.equal(step.title,"Additional Service Discovery");
 await assert.rejects(()=>harness({additional:false}).call("POST /prospects/:id/handoff",{action:"TechnicalAssessment"}),/Additional Service Discovery/);
});
test("EC3 existing BII to Managed IT dryrun sends exact Start Stage and zero Create Client",async()=>{
 const before=process.env.SHAREPOINT_WRITE_MODE;process.env.SHAREPOINT_WRITE_MODE="dryrun";
 try {const h=harness();await h.call("POST /prospects/:id/handoff",{action:"TechnicalAssessment"});
 const fields=h.records[0].body.fields,m=h.s.maps.requests;
 assert.equal(fields[m["Request Type"].name],"Start Stage");
 assert.deepEqual(JSON.parse(fields[m.Payload.name]),{clientId:"CL-0007",stage:"Technical Assessment",serviceLane:"Managed IT"});
 assert.equal(h.records[0].status,"Dryrun");assert.ok(!h.records.some(r=>r.action==="CreateClient"));
 }finally{if(before===undefined)delete process.env.SHAREPOINT_WRITE_MODE;else process.env.SHAREPOINT_WRITE_MODE=before;}
});
test("EC4 duplicate name requires review and explicit different-company confirmation",async()=>{
 const h=harness({existing:false,linked:false});h.sp.client=async()=>null;
 assert.equal(duplicateClients({business_name:"Golden-Triangle ABA"},[h.row],h.s).length,1);
 await assert.rejects(()=>h.call("POST /prospects/:id/handoff",{action:"CreateClient",service_lane:"Managed IT"}),/Possible existing client/);
 const page=await h.call("GET /prospects/:id/handoff");assert.equal(page.data.duplicates.length,1);
 const html=await ejs.renderFile("views/handoff.ejs",{...page.data,csrf:"token",user:h.session.user,mode:"dryrun"});assert.ok(html.includes("This is a different company"));assert.ok(html.includes("Use existing client"));
 await h.call("POST /prospects/:id/handoff",{action:"CreateClient",service_lane:"Managed IT",confirm_different:"yes"});
 assert.equal(h.records[0].action,"CreateClient");
});
test("EC5 multiple independent opportunities can select the same client",async()=>{
 const a=harness({existing:false,linked:false}),b=harness({existing:false,linked:false});b.p.id=91;b.p.opp="OPP-0091";
 for(const h of [a,b])await h.call("POST /prospects/:id/relationship",{relationship_type:"existing_client",client_id:"CL-0007",service_lane:"Managed IT"});
 assert.equal(a.p.client_id,b.p.client_id);assert.notEqual(a.p.opp,b.p.opp);
 assert.ok(a.writes.some(w=>w.sql.startsWith("UPDATE prospects SET relationship_type")&&w.params.at(-1)===46));
 assert.ok(b.writes.some(w=>w.sql.startsWith("UPDATE prospects SET relationship_type")&&w.params.at(-1)===91));
});
test("EC6 missing client blocks transition and never falls back to opportunity lookup",async()=>{
 const h=harness({missing:true});await assert.rejects(()=>h.call("POST /prospects/:id/handoff",{action:"TechnicalAssessment"}),/unavailable/);assert.equal(h.records.length,0);
 const reader=new SharePoint({});reader.cache=h.s;reader.clients=async()=>[{id:"99",fields:{[h.s.maps.clients["Opportunity ID"].name]:h.p.opp,[h.s.maps.clients["Client ID"].name]:"CL-WRONG"}}];
 assert.equal(await reader.client(h.p),undefined);assert.equal(await reader.client({...h.p,client_id:null}),undefined);
});
test("EC7 pending requests block repeat handoff and client-wide request lock is taken",async()=>{
 const h=harness();h.records.push({id:1,status:"Pending"});await assert.rejects(()=>h.call("POST /prospects/:id/handoff",{action:"TechnicalAssessment"}),/already active/);assert.equal(h.records.length,1);
 assert.ok(h.writes.some(w=>w.sql.includes("client_request_locks")&&w.params[0]==="CL-0007"));
});
test("EC8 already active Managed IT and unsupported states cannot transition",async()=>{
 const h=harness({active:true});await assert.rejects(()=>h.call("POST /prospects/:id/handoff",{action:"TechnicalAssessment"}),/already active/);assert.equal(h.records.length,0);
 const c=clientSummary(h.row,h.s);assert.throws(()=>assertExistingTransition(h.p,{...c,"Current Stage":"Operations","Service Lanes":["Business IT Integration"]},true),/Acceptance/);
});
test("EC9 new-client payload remains unchanged; linked/existing payload generation blocks creation",()=>{
 const h=harness({existing:false,linked:false});const snapshot={synthetic:true};
 assert.deepEqual(payload("CreateClient",h.p,"Managed IT",{discovery:snapshot}),{opportunityId:"OPP-0046",client:"Golden Triangle ABA",stage:"Sales Discovery",serviceLane:"Managed IT",discovery:snapshot});
 assert.throws(()=>payload("CreateClient",{...h.p,relationship_type:"existing_client"},"Managed IT",{discovery:snapshot}),/cannot create/);
});
test("EC10 sales cannot link or start transition; may save additional sales context",async()=>{
 const h=harness({role:"sales"});await assert.rejects(()=>h.call("POST /prospects/:id/relationship",{relationship_type:"existing_client",client_id:"CL-0007"}),/Owner/);
 await assert.rejects(()=>h.call("POST /prospects/:id/handoff",{action:"TechnicalAssessment"}),/Owner/);
 await h.call("POST /prospects/:id/additional-discovery",{revision:0,service:"Managed IT",reason:"Expansion",decision_maker:"Owner",timeframe:"This quarter",complete:"yes"});
 assert.ok(h.writes.some(w=>w.sql.startsWith("INSERT INTO additional_service_discoveries")));
 assert.throws(()=>additionalAnswers({},true),/Complete service/);
});

test("selection rejects missing clients and keeps existing links immutable",async()=>{
 const h=harness({existing:false,linked:false});
 await assert.rejects(()=>h.call("POST /prospects/:id/relationship",{relationship_type:"existing_client",client_id:"CL-WRONG",service_lane:"Managed IT"}),/unique existing/);
 assert.equal(h.p.client_id,undefined);
 await assert.rejects(()=>harness().call("POST /prospects/:id/relationship",{relationship_type:"new_client"}),/cannot be reassigned/);
});
test("duplicate check fails closed when SharePoint cannot be read",async()=>{
 const h=harness({existing:false,linked:false});h.sp.clients=async()=>{throw new Error("SharePoint unavailable");};
 const page=await h.call("GET /prospects/:id/handoff");assert.equal(page.data.ready,false);
 await assert.rejects(()=>h.call("POST /prospects/:id/handoff",{action:"CreateClient",service_lane:"Managed IT",confirm_different:"yes"}),/unavailable/);
 assert.equal(h.records.length,0);
});
test("completed transition cannot be restarted while SharePoint state catches up",async()=>{
 const h=harness();h.records.push({id:1,status:"Done",action:"TechnicalAssessment"});
 await assert.rejects(()=>h.call("POST /prospects/:id/handoff",{action:"TechnicalAssessment"}),/already requested/);
 assert.equal(h.records.length,1);
});
test("additional discovery and relationship views render current client details",async()=>{
 const h=harness({existing:false,linked:false});
 const relationship=await h.call("GET /prospects/:id/relationship");
 const html=await ejs.renderFile("views/client-relationship.ejs",{...relationship.data,csrf:"token",user:h.session.user,mode:"dryrun"});
 assert.ok(html.includes("CL-0007"));assert.ok(html.includes("Acceptance"));
 const existing=harness();const discovery=await existing.call("GET /prospects/:id/additional-discovery");
 const form=await ejs.renderFile("views/additional-discovery.ejs",{...discovery.data,csrf:"token",user:existing.session.user,mode:"dryrun"});
 assert.ok(form.includes("Major infrastructure changes"));assert.ok(form.includes("BII-08"));
});

test("relationship lane list offers Project-Based alongside the existing Managed IT/BII choices",async()=>{
  const h=harness({existing:false,linked:false,engagementType:"bii"});h.p.service_lane="Business IT Integration";
  const page=await h.call("GET /prospects/:id/relationship"),html=await ejs.renderFile("views/client-relationship.ejs",{...page.data,csrf:"token",user:h.session.user,mode:"dryrun"});
  assert.deepEqual(page.data.lanes,["Business IT Integration","Managed IT","Project-Based"]);assert.ok(html.includes('value="Project-Based"'));assert.ok(html.includes("Project-Based (Project / Hourly)"));assert.ok(html.includes("BII / Standardization"));
});

test("selecting Project-Based corrects a BII opportunity and links the existing client without creating a record",async()=>{
  const h=harness({existing:false,linked:false,engagementType:"bii",savedDiscovery:true});h.p.service_lane="Business IT Integration";
  await h.call("POST /prospects/:id/relationship",{relationship_type:"existing_client",client_id:"CL-0007",service_lane:"Project-Based",original_engagement_type:"bii"});
  assert.equal(h.p.engagement_type,"project");assert.equal(h.p.service_lane,"Project-Based");assert.equal(h.p.client_id,"CL-0007");assert.equal(h.records.length,0);
  assert.equal(h.writes.filter(w=>w.sql.startsWith("INSERT INTO discovery_versions")).length,2);assert.ok(h.writes.some(w=>w.sql.startsWith("UPDATE discoveries")&&w.sql.includes("status='Draft'")));assert.ok(!h.writes.some(w=>w.sql.startsWith("INSERT INTO sp_requests")));
});

for(const type of ["project","hourly"])test(`${type} relationship locks Project-Based and ignores a forged Managed IT lane`,async()=>{
  const h=harness({existing:false,linked:false,engagementType:type});h.p.service_lane="Project-Based";
  const page=await h.call("GET /prospects/:id/relationship"),html=await ejs.renderFile("views/client-relationship.ejs",{...page.data,csrf:"token",user:h.session.user,mode:"dryrun"});
  assert.deepEqual(page.data.lanes,["Project-Based"]);assert.match(html,/<select name="service_lane" disabled/);assert.ok(html.includes("selected automatically"));
  await h.call("POST /prospects/:id/relationship",{relationship_type:"existing_client",client_id:"CL-0007",service_lane:"Managed IT"});
  assert.equal(h.p.service_lane,"Project-Based");assert.equal(h.p.engagement_type,type);assert.equal(h.p.client_id,"CL-0007");assert.equal(h.records.length,0);
});

test("Project-Based lane selection cannot bypass protected quote history or a stale type",async()=>{
  for(const [quoted,original,pattern] of [[true,"bii",/has quotes/],[false,"managed_it",/another tab/]]) {
    const h=harness({existing:false,linked:false,engagementType:"bii",quoted});h.p.service_lane="Business IT Integration";
    await assert.rejects(()=>h.call("POST /prospects/:id/relationship",{relationship_type:"existing_client",client_id:"CL-0007",service_lane:"Project-Based",original_engagement_type:original}),pattern);
    assert.equal(h.p.client_id,undefined);assert.equal(h.p.engagement_type,"bii");assert.equal(h.records.length,0);assert.ok(!h.writes.some(w=>w.sql.startsWith("UPDATE prospects SET relationship_type")));
  }
});
test("relationship Project-Based selection accepts completed CRM sync history and creates no external requests",async()=>{
  const h=harness({existing:false,linked:false,engagementType:"bii",savedDiscovery:true});h.p.service_lane="Business IT Integration";
  h.records.push({id:202,action:"UpsertProspect",status:"Done"},{id:201,action:"UpsertProspect",status:"Done"});
  await h.call("POST /prospects/:id/relationship",{relationship_type:"existing_client",client_id:"CL-0007",service_lane:"Project-Based",original_engagement_type:"bii"});
  assert.equal(h.p.engagement_type,"project");assert.equal(h.p.client_id,"CL-0007");assert.equal(h.records.length,2);assert.ok(h.records.every(r=>r.action==="UpsertProspect"&&r.status==="Done"));
});
test("relationship type correction still blocks a completed service request among CRM syncs",async()=>{
  const h=harness({existing:false,linked:false,engagementType:"bii"});h.p.service_lane="Business IT Integration";
  h.records.push({id:202,action:"UpsertProspect",status:"Done"},{id:190,action:"CreateClient",status:"Done"});
  await assert.rejects(()=>h.call("POST /prospects/:id/relationship",{relationship_type:"existing_client",client_id:"CL-0007",service_lane:"Project-Based"}),/#190 \(CreateClient \/ Done\)/);assert.equal(h.p.client_id,undefined);assert.equal(h.p.engagement_type,"bii");
});
test("failed service history can still be reconciled by linking an existing customer without changing its type",async()=>{
  const h=harness({existing:false,linked:false,engagementType:"managed_it"});h.records.push({id:190,action:"CreateClient",status:"Failed"});
  await h.call("POST /prospects/:id/relationship",{relationship_type:"existing_client",client_id:"CL-0007",service_lane:"Managed IT"});
  assert.equal(h.p.client_id,"CL-0007");assert.equal(h.p.engagement_type,"managed_it");assert.equal(h.records.length,1);
});
test("failed service history is not a bypass for a relationship type correction",async()=>{
  const h=harness({existing:false,linked:false,engagementType:"bii"});h.p.service_lane="Business IT Integration";h.records.push({id:190,action:"CreateClient",status:"Failed"});
  await assert.rejects(()=>h.call("POST /prospects/:id/relationship",{relationship_type:"existing_client",client_id:"CL-0007",service_lane:"Project-Based"}),/#190 \(CreateClient \/ Failed\)/);assert.equal(h.p.client_id,undefined);assert.equal(h.p.engagement_type,"bii");
});
