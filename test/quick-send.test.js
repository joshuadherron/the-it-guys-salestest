import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ejs from "ejs";
import { QuickSend,quickCalculation } from "../src/quick-send.js";
import { quickQuoteDocument } from "../src/quick-quote-document.js";
import { quickQuoteRoutes } from "../src/quick-quote-routes.js";
import { snapshot } from "../src/docfill/delivery-store.js";
import { ProposalPreparation } from "../src/docfill/proposals.js";
import { ProposalStore } from "../src/docfill/proposal-store.js";
import { quoteDocumentSamples } from "../scripts/lib/quote-document-samples.js";
import { validateProjectQuote } from "../src/project-pricing.js";
import { prices } from "../src/config.js";
import { lockClientRequests } from "../src/existing-client-rules.js";
import { requestMatchesQuote } from "../src/quote-request-scope.js";
import { quoteEmail } from "../src/docfill/send-policy.js";
import { runInNewContext } from "node:vm";
import { startQuickSendWorker } from '../src/quick-send-worker.js';

const owner={email:"josh@example.test",role:"owner",enabled:1,quote_send:1,quote_approve:1,display_name:"Josh",sender_title:"Owner",sender_phone:"555-555-0100"};
const sales={...owner,email:"sales@example.test",role:"sales",quote_approve:0};
const facts={legalName:"Example Services LLC",preparedName:"Pat",preparedTitle:"Owner",preparedEmail:"pat@example.test",preparedFor:"Pat, Owner",backupContact:"Pat",siteCount:1,domain:"example.test",serviceStartMode:"after_contracts",summary:"Provide the selected managed services for the quantities listed in this quote.",deviceKinds:["computers","phones","tablets"],onboardingMode:"standard",onboardingFee:350,onsiteMode:"block",onsiteHours:1,clientTerms:"None.",sizingMode:"today",location:"Beaumont",targetTiming:"October",deviceTypes:"Windows computers",exceptions:"None",signer:"Pat, Owner"};
function fixture(type){
  const source=quoteDocumentSamples()[type==="bii"?1:0];
  const inputs=type==="project"?validateProjectQuote({scope:"Repair email",terms:"Accept by email referencing the Quote ID.",basis:"fixed",lines:[{label:"Repair",quantity:1,unitPrice:300,kind:"labor"}]},"project"):source.quote.inputs;
  const calc=quickCalculation({...inputs,confirmed:true},prices);
  return {...source.quote,id:19,quote_number:"Q-2026-019",prospect_id:86,status:"Draft",approved_at:null,approved_by:null,inputs,line_items:calc.lines,total:calc.total,document_facts:type==="project"?{}:{...facts}};
}
function harness(type="managed_it"){
  const q=fixture(type),p={id:86,opp:"OPP-0086",business_id:9,business_name:"Example Services LLC",contact_name:"Pat",email:"pat@example.test",engagement_type:type,stage:"Prospecting",hold:false,client_id:null};
  let job=null,fill=null,record=null;const events=[],audits=[],requests=[],copies=[];
  const users=new Map([[owner.email,owner],[sales.email,sales]]);
  const run=async(sql,args=[])=>{
    if(sql.startsWith("SELECT * FROM quotes"))return [q];
    if(sql.startsWith("SELECT * FROM allowlist"))return users.has(args[0])?[users.get(args[0])]:[];
    if(sql.startsWith("SELECT * FROM config_stop"))return [{id:1,label:"Disputed access",status:"Review"}];
    if(sql.includes("FROM quote_quick_sends"))return job?[{...job,busy:!!job.operation_token}]:[];
    if(sql.startsWith("SELECT id FROM quote_send_attempts"))return [];
    if(sql.startsWith('SELECT id,request_json FROM sp_requests'))return [];
    if(sql.startsWith("UPDATE quotes SET status='Approved'")){Object.assign(q,{status:"Approved",approved_by:args[0],approved_at:"2026-10-24 12:00:00",stop_review:JSON.parse(args[1]),inputs:JSON.parse(args[2])});events.push("Approve");return {};}
    if(sql.startsWith("INSERT INTO quote_quick_sends")){job={quote_id:args[0],status:args[1],snapshot_hash:args[2],requested_by:args[3],options_json:JSON.parse(args[4]),operation_token:null};return {};}
    if(sql.startsWith("UPDATE quote_quick_sends")){
      if(sql.includes("SET operation_token=?"))job.operation_token=args[0];
      if(sql.includes("SET operation_token=NULL"))job.operation_token=null;
      const status=sql.match(/SET status='([^']+)'/);if(status)job.status=status[1];
      if(sql.includes("SET status=?"))job.status=args[0];
      if(job.status==="Failed")job.error_message=args[0];
      return {};
    }
    throw new Error("Unexpected query: "+sql);
  };
  const log=async(...args)=>audits.push(args),ctx=()=>({q,p,actor:owner,state,token:"lease",hash:snapshot(q)}),state={};
  const discoveryStore=new ProposalStore({sp:{},graph:{},deliveryStore:{},run:async sql=>sql.startsWith("SELECT d.*")?[]:[]});
  discoveryStore.discoveryData=async()=>({status:"Draft",revision:0,answers:{}});
  const prepStore={
    acquire:async()=>ctx(),save:async(_ctx,values)=>Object.assign(state,values),release:async()=>{},renew:async()=>{},validate:async()=>{},latestFill:async()=>fill,preparePsa:async()=>({done:true}),
    record:async()=>record,
    link:async()=>{p.client_id="CL-9";if(!state.record_sync_request_id){events.push("Sync");requests.push({id:2,action:"Sync"});state.record_sync_request_id=2;}},
    discovery:async c=>discoveryStore.discovery(c),
    request:async(_ctx,action,lane,options,field)=>{events.push(action);const id=action==="CreateClient"?1:3;requests.push({id,action,options,lane});state[field]=id;},
    requestStatus:async id=>{const r=requests.find(r=>r.id===id);if(r.action==="CreateClient")record={id:"9"};if(r.action==="CreateWorkingCopy"&&!copies.length)copies.push({id:"41",instanceRef:"19",workflowId:r.lane.workflow});return {status:"Done"};},
    copy:async()=>copies[0]
  };
  const resolver={master:async key=>({content:await readFile("test/fixtures/"+({"COM-PRP":"COM-PRP-v1.8.docx","BII-QSOW":"BII-QSOW-v1.7.docx","ENG-PRJ":"ENG-PRJ-v1.0.docx"}[key]))}),working:async()=>({})};
  const delivery={fill:async()=>{events.push("Fill");fill={id:5,status:"Succeeded",mode:"live",snapshot_hash:snapshot(q)};return {};},send:async()=>{events.push("PDF email");q.status="Sent";return {mode:"live"};}};
  const prepare=new ProposalPreparation({store:prepStore,resolver,delivery,prices:async()=>prices,env:{QUOTE_FILL_MODE:"live"}});
  const service=new QuickSend({run,tx:async fn=>fn({}),log,getProspect:async()=>p,prices:async()=>prices,prepare,delivery,sp:{workItems:async()=>copies,ready:()=>({definitions:[]})}});
  return {service,q,p,events,audits,requests,state,run,users,prepare,delivery,get job(){return job;}};
}
for(const type of ["managed_it","project","bii"])test(`Quick Quote ${type}: Send records approval and automatically prepares then delivers with no extra user clicks`,async()=>{
  const h=harness(type);await h.service.start(19,owner,snapshot(h.q),{});
  let progress;for(let i=0;i<8;i++){progress=await h.service.advance(19,owner);if(progress.done)break;}
  assert.ok(progress.done);assert.equal(h.q.approved_by,owner.email);assert.ok(h.q.approved_at);
  assert.deepEqual(h.events,type==="bii"?["Approve","CreateClient","Sync","CreateWorkingCopy","Fill"]:["Approve","CreateClient","Sync","CreateWorkingCopy","Fill","PDF email"]);
  assert.equal(progress.status,type==="bii"?"ReadySignature":"Sent");
  const discovery=h.requests.find(r=>r.action==="CreateClient").options.discovery;
  if(type==="project"){assert.equal(discovery.intakeComplete,false);assert.equal(discovery.revision,0);assert.deepEqual(discovery.answers,{});assert.equal(discovery.quoteContext.scope,"Repair email");}
  else assert.equal(discovery.discoveryComplete,false);
  const before=h.events.length;await h.service.advance(19,owner);assert.equal(h.events.length,before,"completed Send cannot replay");
});
test("non-approver Send waits for Josh; approver with send permission completes the saved request",async()=>{
  const h=harness("project");const hash=snapshot(h.q);
  await h.service.start(19,sales,hash,{stop_1:"yes"});assert.equal(h.job.status,"WaitingApproval");assert.equal(h.q.status,"Draft");
  assert.equal((await h.service.advance(19,sales)).waitingApproval,true);assert.deepEqual(h.events,[]);
  await h.service.start(19,owner,hash,{});assert.equal(h.job.status,"Queued");assert.equal(h.q.stop_review[0].selected,true);assert.equal(h.q.stop_review[0].acknowledged,true);
  for(let i=0;i<8;i++)if((await h.service.advance(19,sales)).done)break;
  assert.equal(h.job.status,"Sent");assert.equal(h.job.requested_by,owner.email);
});
test("stop conditions are optional; selected flags acknowledge Send anyway and none are auto-ticked",async()=>{
  for(const options of [{},{stop_1:"yes"}]){const h=harness();await h.service.start(19,owner,snapshot(h.q),options);assert.equal(h.q.stop_review[0].selected,!!options.stop_1);assert.equal(h.q.stop_review[0].acknowledged,!!options.stop_1);}
});
test("hold refuses Send before approval while the same saved quote still previews",async()=>{
  const h=harness();h.p.hold=true;
  await assert.rejects(()=>h.service.start(19,owner,snapshot(h.q)),/security hold/);assert.equal(h.q.status,"Draft");assert.equal(h.job,null);
  const preview=await quickQuoteDocument(h.q,h.p,prices);assert.ok(preview.buffer.length);
});
test("Send refuses changed preview, changed pricing and revoked permission",async()=>{
  const h=harness();await assert.rejects(()=>h.service.start(19,owner,"stale"),/changed after preview/);
  h.q.total++;await assert.rejects(()=>h.service.start(19,owner,snapshot(h.q)),/differs from current prices/);
  h.users.set(owner.email,{...owner,quote_send:0});await assert.rejects(()=>h.service.start(19,owner,snapshot(h.q)),/Send permission/);
});
test("a sales user with approve and send permissions can approve in Send",async()=>{
  const h=harness("project"),approver={...sales,quote_approve:1};h.users.set(sales.email,approver);
  await h.service.start(19,approver,snapshot(h.q));assert.equal(h.job.status,"Queued");assert.equal(h.q.approved_by,sales.email);
});
test("a changed approved snapshot refuses progress before any external preparation",async()=>{
  const h=harness();await h.service.start(19,owner,snapshot(h.q));h.q.inputs={...h.q.inputs,users:h.q.inputs.users+1};
  await assert.rejects(()=>h.service.advance(19,owner),/saved quote changed/);assert.deepEqual(h.events,["Approve"]);assert.equal(h.job.status,"Failed");
});
test("Send polls serialize through durable leases and never replay interrupted email delivery",async()=>{
  const h=harness();await h.service.start(19,owner,snapshot(h.q));h.job.operation_token="someone-else";
  await h.service.advance(19,owner);assert.deepEqual(h.events,["Approve"]);
  h.job.operation_token=null;h.job.status="Sending";
  const interrupted=await h.service.advance(19,owner);assert.equal(interrupted.status,'Failed');assert.match(interrupted.error,/no email was replayed/);assert.deepEqual(h.events,["Approve"]);
});
test("a durable Sent quote repairs a lagging job status without sending again",async()=>{
  const h=harness();await h.service.start(19,owner,snapshot(h.q));h.q.status="Sent";h.job.status="Failed";
  const result=await h.service.advance(19,owner);assert.equal(result.status,"Sent");assert.ok(!h.events.includes("PDF email"));
});
test("blank client IDs isolate unrelated prospects' active requests and skip blank operation locks",async()=>{
  const queries=[],s={definitions:[{id:"MIT-05",lane:"Managed IT",active:true,createCopy:true}],quoteInstanceColumn:"Verified",maps:{requests:{Payload:{name:"Payload"},Title:{name:"Title"},"Processing Status":{name:"Status"},Client:{name:"Client"}}}};
  const run=async(sql,args)=>{queries.push({sql,args});if(sql.includes("FROM sp_requests"))return args[0]===1?[{id:9,prospect_id:1}]:[];return [];};
  const store=new ProposalStore({sp:{ready:()=>s,requests:async()=>[]},graph:{},deliveryStore:{latestFill:async()=>null},run});
  await store.validate({p:{id:2,client_id:""},q:{id:19},state:{}},{key:"COM-PRP",workflow:"MIT-05"});
  await lockClientRequests({id:2,client_id:""},run,{});
  assert.ok(queries.every(r=>!r.args.includes("")));assert.ok(!queries.some(r=>r.sql.includes("FROM quote_operation_locks")));
  assert.ok(queries.filter(r=>r.sql.includes("FROM sp_requests")).every(r=>r.args[0]===2));
  const h=harness();h.prepare.store.validate=(ctx,lane)=>store.validate(ctx,lane);
  await h.service.start(19,owner,snapshot(h.q));for(let i=0;i<8;i++)if((await h.service.advance(19,owner)).done)break;
  assert.equal(h.job.status,"Sent","an unrelated blank-ID request must not stop the complete Send");
});
test("another opportunity's request only matches the same nonblank client and quote instance",()=>{
  const raw=instance=>({fields:{InternalPayload:JSON.stringify({clientId:"CL-9",instanceRef:instance})}});
  assert.equal(requestMatchesQuote(raw("19"),{client_id:"CL-9"},19),true);
  assert.equal(requestMatchesQuote(raw("20"),{client_id:"CL-9"},19),false);
  assert.equal(requestMatchesQuote(raw("19"),{client_id:""},19),false);
});
test("preparation ignores other-opportunity requests for another instance but refuses the same instance",async()=>{
  const s={definitions:[{id:"MIT-05",lane:"Managed IT",active:true,createCopy:true}],quoteInstanceColumn:"Verified",maps:{requests:{Payload:{name:"Payload"},Title:{name:"Title"},"Processing Status":{name:"Status"},Client:{name:"Client"}}}};
  let instance="20";
  const fields=()=>({Payload:JSON.stringify({clientId:"CL-9",instanceRef:instance,opportunityId:"OPP-OTHER"}),Status:"Pending"});
  const store=new ProposalStore({sp:{ready:()=>s,requests:async()=>[{id:8,fields:fields()}]},graph:{},deliveryStore:{latestFill:async()=>null},run:async sql=>sql.includes("FROM sp_requests")?[{id:8,prospect_id:85,request_json:{fields:fields()}}]:[]});
  const ctx={p:{id:86,opp:"OPP-0086",client_id:"CL-9"},q:{id:19},state:{}};
  await store.validate(ctx,{key:"COM-PRP",workflow:"MIT-05"});instance="19";
  await assert.rejects(()=>store.validate(ctx,{key:"COM-PRP",workflow:"MIT-05"}),/active or uncertain/);
});
for(const [minutes,found,expected,manual] of [[1,true,"Unknown",null],[3,true,"Done",undefined],[3,false,"Unknown",null],[11,false,"Unknown",99]])test(`uncertain request ${minutes} minutes / exact match ${found} reconciles without replay`,async()=>{
  const updates=[],s={maps:{requests:{Title:{name:"Title"},"Processing Status":{name:"Status"},"Result Message":{name:"Message"}}}},r={id:99,status:"Unknown",created_at:new Date(Date.now()-minutes*60000),request_json:{fields:{Title:"EXACT-99"}}};
  const store=new ProposalStore({sp:{ready:()=>s,requests:async()=>found?[{id:"remote-99",fields:{Title:"EXACT-99",Status:"Done"}}]:[{id:"other",fields:{Title:"EXACT-OTHER",Status:"Done"}}]},graph:{createWorkflowRequest:()=>assert.fail("must not replay")},deliveryStore:{},run:async(sql,args)=>{if(sql.startsWith("SELECT"))return [r];updates.push({sql,args});return {};},log:async()=>{}});
  const result=await store.requestStatus(99);assert.equal(result.status,expected);assert.equal(result.manualRequestId??null,manual??null);
  assert.equal(updates.length,minutes>=2&&found?1:0);
});
test("project email uses approved project fields, never Managed IT monthly/contract promises",()=>{
  const message=quoteEmail({quote:{quote_number:"Q-2026-019"},prospect:{contact_name:"Pat"},actor:owner,fields:{"ENG.QuoteId":"Q-2026-019","ENG.Scope":"Repair email","ENG.Terms":"Email acceptance","ENG.OneTimeTotal":"$300.00"},mode:"live",to:"pat@example.test",pdf:Buffer.from("pdf"),name:"quote.pdf",requestId:"request"});
  assert.match(message.message.body.content,/referencing Q-2026-019/);assert.ok(!message.message.body.content.includes("Master Services Agreement"));
});
test("all three builder views and preview render without a separate approve/prepare control",async()=>{
  for(const type of ["managed_it","bii","project"]){
    const h=harness(type),input=h.q.inputs;
    const html=await ejs.renderFile("views/quick-quote-form.ejs",{user:owner,mode:"dryrun",csrf:"test",p:h.p,type,input,prefill:{...facts,quoteComputers:1},q:h.q,oneOffItems:[],config:{}});
    assert.ok(html.includes(">Preview</button>"));assert.ok(!html.includes('name="confirmed"'));
    const preview=await ejs.renderFile("views/quick-quote-preview.ejs",{user:owner,mode:"dryrun",csrf:"test",q:h.q,p:h.p,input,lines:h.q.line_items,hash:snapshot(h.q),preview:{report:{unfilled:[]}},error:null,job:null,stops:[{id:1,label:"Access concern"}],canApprove:true});
    assert.match(preview,/<input type="checkbox" name="stop_1" value="yes">/);assert.ok(!preview.includes('name="reviewed"'));assert.ok(!preview.includes("Open SharePoint record"));
  }
});
test("BII signature view finds the actual PSA definition and excludes it once signed",async()=>{
  const h=harness("bii"),psa={id:"42",workflowId:"PSA-ID",document:"Project Services Agreement",signatureStatus:"Preparing",url:"https://example.test/psa"};
  h.service.sp={workItems:async()=>[{id:"41",workflowId:"BII-05",instanceRef:"19"},psa],ready:()=>({definitions:[{id:"PSA-ID",active:true,createCopy:true,lane:"Business IT Integration",document:"Project Services Agreement"}]})};
  assert.equal((await h.service.signatureDocuments(19)).psa.length,1);psa.signatureStatus="Signed";
  assert.equal((await h.service.signatureDocuments(19)).psaSigned,true);assert.deepEqual((await h.service.signatureDocuments(19)).psa,[]);
});
test("Quick Quote refusals render a standard message and warn without leaking stack traces",async()=>{
  const paths=new Map(),warnings=[];
  quickQuoteRoutes({get:(p,...f)=>paths.set(p,f),post(){}},{run:async()=>[],warn:(...args)=>warnings.push(args),service:{}});
  const req={params:{id:"19"},path:"/quick-quote/quotes/19",session:{user:owner},accepts:()=>"html"},res={status(n){this.code=n;return this;},render(view,data){this.view=view;this.data=data;}};
  for(const handler of paths.get("/quick-quote/quotes/:id")){let next=false;await handler(req,res,()=>{next=true;});if(!next)break;}
  assert.equal(res.code,404);assert.equal(res.view,"error");assert.equal(warnings.length,1);assert.ok(!("stack" in warnings[0][1]));
});

test("adding a Quick Quote client creates only local business/prospect data and advances to the builder",async()=>{
  const paths=new Map(),inserts=[];
  quickQuoteRoutes({get(){},post:(path,...handlers)=>paths.set(path,handlers)},{tx:async fn=>fn({transaction:true}),run:async()=>[],log:async()=>{},insert:async(body,user,c)=>{inserts.push({body,user,c});return 86;},service:{}});
  const req={body:{business_name:"New client",contact_name:"Pat",email:"pat@example.test"},params:{},session:{user:owner},accepts:()=>"html"},res={redirect(url){this.url=url;}};
  for(const handler of paths.get("/quick-quote")){let next=false;await handler(req,res,()=>{next=true;});if(!next)break;}
  assert.equal(res.url,"/quick-quote/opportunities/86");assert.equal(inserts.length,1);assert.equal(inserts[0].body.stage,"Prospecting");assert.ok(inserts[0].c.transaction);
  assert.ok(!("discovery" in inserts[0].body));assert.ok(!("intake" in inserts[0].body));
});

test("progress browser polls status without advancing or writing any step",async()=>{
  const callbacks=[],calls=[],status={textContent:""},error={textContent:""},form={dataset:{statusUrl:"/quick-quote/quotes/19/status"}};let reloads=0;
  const document={querySelector:()=>null,getElementById:id=>id==="quick-progress-form"?form:id==="quick-progress"?status:error};
  const results=[{step:"copy_requested"},{step:"filled"},{done:true,status:"Sent"}];
  runInNewContext(await readFile("public/quick-quote.js","utf8"),{document,URLSearchParams,FormData:class extends Array{constructor(){super(["_csrf","test"]);}},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>results.shift()};},setTimeout:fn=>callbacks.push(fn),window:{location:{reload:()=>reloads++}}});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  await flush();assert.equal(calls.length,1);assert.equal(status.textContent,"Creating quote copy…");
  callbacks.shift()();await flush();assert.equal(status.textContent,"Sending…");
  callbacks.shift()();await flush();assert.equal(reloads,1);assert.equal(calls.length,3);assert.ok(calls.every(c=>!c.options.method&&c.url.endsWith('/status')));
});

test("preview selections switch the button to Send anyway without auto-selecting a finding",async()=>{
  let selected=false;const button={textContent:"Send",dataset:{sendLabel:"Send"}},listeners={},form={querySelector:s=>s==="button"?button:selected?{}:null,addEventListener:(event,fn)=>listeners[event]=fn};
  runInNewContext(await readFile("public/quick-quote.js","utf8"),{document:{querySelector:s=>s==='[data-quick-send]'?form:null,getElementById:()=>null}});
  assert.equal(button.textContent,"Send");selected=true;listeners.change();assert.equal(button.textContent,"Send anyway");selected=false;listeners.change();assert.equal(button.textContent,"Send");
});
test("hourly estimates keep their existing approve and manual-send controls",async()=>{
  const h=harness("project");
  for(const status of ["Draft","Approved"]){
    const q={...h.q,status},html=await ejs.renderFile("views/project-quotes.ejs",{user:owner,csrf:"test",mode:"dryrun",p:{...h.p,engagement_type:"hourly"},engagementTypes:{hourly:"Hourly / Break-Fix"},quotes:[q],selected:q,input:q.inputs,json:value=>typeof value==='string'?JSON.parse(value):value,config:{minimum_hours:1,hourly_rate:150},canSend:true,canApprove:true,intakeComplete:false,missing:[]});
    assert.ok(html.includes(status==="Draft"?"Approve hourly estimate":"Record proposal sent manually"));
  }
});

test("adding a prospect defaults to new business; existing identity is an explicit alternative",async()=>{
  const html=await ejs.renderFile("views/business-choice.ejs",{p:{},businesses:[{id:9,name:"Existing Co",contact_name:"Pat",email:"pat@example.test"}]});
  assert.match(html,/value="new" checked/);assert.match(html,/<div data-existing-business hidden>/);assert.match(html,/name="business_id" disabled/);
  const existing=await ejs.renderFile("views/business-choice.ejs",{p:{business_id:9},businesses:[{id:9,name:"Existing Co"}]});
  assert.match(existing,/value="existing" checked/);assert.match(existing,/name="business_id" required/);
});

test("business chooser prefills existing contacts and restores the unsaved new prospect on switching back",async()=>{
  const fields=Object.fromEntries(["business_name","contact_name","email","phone"].map(id=>[id,{value:id==="business_name"?"New Co":""}]));
  const listeners={},modes=[{value:"new",checked:true},{value:"existing",checked:false}];
  modes.forEach(mode=>mode.addEventListener=(_,fn)=>listeners[mode.value]=fn);
  const business={value:"",selectedOptions:[{dataset:{businessName:"Existing Co",contactName:"Pat",email:"pat@example.test",phone:"555"}}],addEventListener:(_,fn)=>listeners.select=fn},chooser={};
  runInNewContext(await readFile("public/opportunity-form.js","utf8"),{document:{querySelector:s=>s.includes("business_id")?business:chooser,querySelectorAll:()=>modes,getElementById:id=>fields[id]}});
  assert.equal(business.disabled,true);assert.equal(chooser.hidden,true);
  modes[0].checked=false;modes[1].checked=true;listeners.existing();business.value="9";listeners.select();
  assert.equal(fields.business_name.value,"Existing Co");assert.equal(fields.contact_name.value,"Pat");assert.equal(fields.email.value,"pat@example.test");assert.equal(fields.business_name.readOnly,true);
  modes[0].checked=true;modes[1].checked=false;listeners.new();
  assert.equal(fields.business_name.value,"New Co");assert.equal(fields.contact_name.value,"");assert.equal(fields.business_name.readOnly,false);assert.equal(business.value,"");assert.equal(business.disabled,true);
});

test('a queued job reaches Sent through the worker with no page or viewer identity',async()=>{
  const h=harness('project');await h.service.start(19,owner,snapshot(h.q));
  const worker=startQuickSendWorker({run:async()=>['Queued','Prepared','Sending'].includes(h.job.status)?[{quote_id:19}]:[],service:h.service,interval:()=>({unref(){}}),clear:()=>{},warn:(...args)=>assert.fail(JSON.stringify(args))});
  await worker.ready;
  for(let i=0;i<8&&h.job.status!=='Sent';i++)await worker.tick();
  assert.equal(h.job.status,'Sent');assert.equal(h.events.filter(e=>e==='PDF email').length,1);worker.stop();
});

test('worker and browser advancement cannot run one leased step concurrently',async()=>{
  const h=harness('project');await h.service.start(19,owner,snapshot(h.q));
  let release,entered;const ready=new Promise(resolve=>entered=resolve),paused=new Promise(resolve=>release=resolve);let calls=0;
  h.service.prepare={advance:async()=>{calls++;entered();await paused;return {step:'record_requested'};}};
  const first=h.service.advance(19);await ready;
  await h.service.advance(19,owner);assert.equal(calls,1);release();await first;
});

test('Try again resumes a failure before any email attempt while preserving snapshot and sender',async()=>{
  const h=harness('project');await h.service.start(19,owner,snapshot(h.q));h.job.status='Failed';
  await h.service.resume(19,owner);assert.equal(h.job.status,'Queued');assert.equal(h.job.snapshot_hash,snapshot(h.q));assert.equal(h.job.requested_by,owner.email);
});

test('worker rechecks saved sender permission and security hold after queuing',async()=>{
  for(const reason of ['hold','revoked']){
    const h=harness('project');await h.service.start(19,owner,snapshot(h.q));
    if(reason==='hold')h.p.hold=true;else h.users.set(owner.email,{...owner,quote_send:0});
    await assert.rejects(()=>h.service.advance(19),reason==='hold'?/security hold/:/Send permission/);
    assert.equal(h.job.status,'Failed');assert.deepEqual(h.events,['Approve']);
  }
});
