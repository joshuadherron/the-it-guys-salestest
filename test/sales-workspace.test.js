import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ejs from "ejs";
import { quotesRoutes,validateManagedInputs } from "../src/quotes.js";
import { priceManagedServices } from "../src/pricing.js";
import { quoteDocumentRoutes } from "../src/docfill/routes.js";
import { projectDocumentRoutes } from "../src/docfill/project-routes.js";
import { DeliveryStore } from "../src/docfill/delivery-store.js";
import { ProposalStore } from "../src/docfill/proposal-store.js";
import { json } from "../src/db.js";
import { engagementGuard } from "../src/engagement-guard.js";

const actor={email:"owner@example.test",role:"owner",quote_send:true,quote_approve:true};
const business={id:1,business_id:1,opp:"OPP-0001",business_name:"Example LLC",engagement_type:"managed_it",stage:"Prospecting",hold:true};
const body={users:"10",computers:"10",onboarding:"350",confirmed:"yes"};
const inputs=validateManagedInputs(body),calc=priceManagedServices(inputs);
const quote={id:10,prospect_id:1,quote_number:"Q-2026-010",status:"Approved",inputs,line_items:calc.lines,total:calc.total,approved_at:"2026-10-22 12:00:00"};
function harness(register,options={}){
  const routes=new Map(),writes=[];
  const q=structuredClone(options.q||quote),p={...business,...options.p};
  const query=async(sql,args=[])=>{
    if(sql.startsWith("SELECT * FROM quotes"))return [q];
    if(sql.startsWith("SELECT * FROM allowlist"))return [actor];
    if(sql.startsWith("SELECT * FROM config_stop_conditions"))return [{id:1,label:"Backup uncertainty",status:"Review"}];
    if(sql.startsWith("SELECT d.*"))return [];
    if(sql.startsWith("SELECT id FROM prospects"))return [{id:1}];
    if(sql.startsWith("INSERT")||sql.startsWith("UPDATE")){writes.push({sql,args});return {insertId:20,affectedRows:1};}
    throw new Error("Unexpected query: "+sql);
  };
  const deps={query,audit:async()=>{},transaction:async f=>f({}),prospect:async()=>p,discovery:async()=>({answers:{},revision:0,status:"Draft"}),priceConfig:async()=>({}),json,env:{QUOTE_FILL_MODE:"dryrun"},resolver:{master:async()=>{throw new Error("No approved master configured");}}};
  register({get:(path,...f)=>routes.set("GET "+path,f),post:(path,...f)=>routes.set("POST "+path,f)},deps);
  const req={params:{id:10},body:{},query:{},session:{user:actor}};
  const res={locals:{csrf:"test"},render(view,data){this.view=view;this.data=data;},redirect(url){this.url=url;},set(){},send(buffer){this.buffer=buffer;},type(){}};
  const call=async path=>{for(const f of routes.get(path)){let next=false;await f(req,res,()=>{next=true;});if(!next)break;}};
  return {req,res,call,writes,deps};
}

test("Managed IT pricing can be calculated, saved and revised while held in Prospecting without discovery",async()=>{
  for(const path of ["/prospects/:id/quotes/managed/calculate","/prospects/:id/quotes/managed","/quotes/:id/edit"]){
    const h=harness(quotesRoutes);h.req.body=body;await h.call("POST "+path);
    if(path.endsWith("calculate"))assert.equal(h.res.data.calculation.total,calc.total);
    else assert.ok(h.writes.some(w=>w.sql.startsWith("INSERT INTO quotes")));
    assert.ok(!h.writes.some(w=>w.sql.includes("approved_at=NULL")));
  }
});

test("assessment warning needs explicit acknowledgement and preserves selected findings with approval",async()=>{
  const denied=harness(quotesRoutes,{q:{...quote,status:"Draft"}});denied.req.body={reviewed:"yes",stop_1:"yes"};
  await assert.rejects(()=>denied.call("POST /quotes/:id/approve"),/Continue Anyway/);assert.equal(denied.writes.length,0);
  const h=harness(quotesRoutes,{q:{...quote,status:"Draft"}});h.req.body={reviewed:"yes",stop_1:"yes",continue_anyway:"yes"};await h.call("POST /quotes/:id/approve");
  const saved=h.writes.find(w=>w.sql.startsWith("UPDATE quotes SET status='Approved'"));
  assert.equal(JSON.parse(saved.args[1])[0].selected,true);assert.equal(JSON.parse(saved.args[1])[0].acknowledged,true);
  assert.ok(!h.writes.some(w=>/sp_requests|activities|businesses/.test(w.sql)));
});

test("approved Managed IT document previews download on hold without SharePoint; unapproved quotes remain blocked",async()=>{
  const h=harness(quoteDocumentRoutes);h.req.query={lane:"COM-PRP"};await h.call("GET /quotes/:id/document");assert.equal(h.res.view,"quote-document");
  h.req.body={lane:"COM-PRP",onboardingFee:350};await h.call("POST /quotes/:id/document");assert.ok(Buffer.isBuffer(h.res.buffer));
  assert.ok(!h.writes.some(w=>w.sql.includes("sp_requests")));
  const draft=harness(quoteDocumentRoutes,{q:{...quote,status:"Draft"}});
  await assert.rejects(()=>draft.call("GET /quotes/:id/document"),/Only approved/);
});

test("project preview reaches template configuration without intake, hold or stage prerequisite",async()=>{
  const input={pricingMode:"project_v1",scope:"Repair Outlook",terms:"Written authorization",lines:[{label:"Repair",kind:"labor",quantity:1,unitPrice:150,billing:"one_time"}]};
  const h=harness(projectDocumentRoutes,{p:{engagement_type:"project",stage:"Closed Lost"},q:{...quote,inputs:input}});
  await h.call("GET /quotes/:id/project-document");assert.equal(h.res.view,"project-document");assert.match(h.res.data.error,/owner-approved ENG-PRJ/);
  await assert.rejects(()=>h.call("POST /quotes/:id/project-document"),/owner-approved ENG-PRJ/);
});

test("live preparation and delivery retain holds and lost-opportunity hard stops",async()=>{
  for(const p of [{hold:true},{hold:false,stage:"Closed Lost"},{hold:false,status:"Lost"}]){
    const h=harness(quotesRoutes,{p});
    const delivery=new DeliveryStore(h.deps);
    await assert.rejects(()=>delivery.begin(10,actor,"fill"),/On Hold or Lost/);
    const proposal=new ProposalStore({sp:{},graph:{},deliveryStore:delivery,run:h.deps.query,tx:h.deps.transaction,getProspect:h.deps.prospect});
    await assert.rejects(()=>proposal.acquire(10,actor),/On Hold or Lost/);
    assert.equal(h.writes.length,0);
  }
});

test("project common Quote action opens the project worksheet directly",async()=>{
  let target;
  await engagementGuard({prospect:async()=>({...business,engagement_type:"project"})})({path:"/prospects/1/quotes",method:"GET"},{redirect:url=>{target=url;}},()=>{});
  assert.equal(target,"/prospects/1/project-quotes");
});

test("common sales actions and warnings remain visible across types and stages",async()=>{
  for(const type of ["managed_it","bii","project","hourly"]){
    const html=await ejs.renderFile("views/sales-actions.ejs",{p:{...business,engagement_type:type}});
    for(const label of ["New quote / proposal","Discovery","New project","BII opportunity","Prepare Managed IT","Notes / activity"])assert.ok(html.includes(label),label);
    assert.ok(!html.includes("disabled"));
  }
  const html=await ejs.renderFile("views/sales-notices.ejs",{p:business});assert.match(html,/continue sales preparation/);
});

test("discovery revisions never revoke independent approved commercial snapshots",async()=>{
  const source=await readFile("src/discovery.js","utf8");
  assert.ok(source.includes("INSERT INTO discovery_versions"));
  assert.ok(!source.includes("UPDATE quotes SET status='Draft'"));
});
