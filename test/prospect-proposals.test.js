import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ejs from "ejs";
import JSZip from "jszip";
import { ProposalPreparation } from "../src/docfill/proposals.js";
import { ProposalStore, proposalApprovalSnapshot } from "../src/docfill/proposal-store.js";
import { quoteDocumentSamples } from "../scripts/lib/quote-document-samples.js";
import { prices } from "../src/config.js";
import { snapshot } from "../src/docfill/delivery-store.js";
import { isActivated,relationshipLabel,prospectLifecycle } from "../src/prospect-lifecycle.js";
import { observeLifecycle } from "../src/prospect-lifecycle-sync.js";
import { buildFields,required } from "../src/sharepoint.js";
import { canQuote } from "../src/quote-permissions.js";
import { workPayload } from "../src/work-items.js";
import { SharePointQuotes } from "../src/docfill/sharepoint-quotes.js";
import { executeWorkAction } from "../src/guided-workflow.js";
const actor={email:"alanna@theitguys.us",quote_send:1,enabled:1};
const facts={legalName:"Example Services LLC",preparedName:"Sample Owner",preparedTitle:"Director",preparedEmail:"owner@example.test",backupContact:"Administrator",siteCount:1,domain:"example.test",serviceStartMode:"after_contracts",summary:"Provide the selected services for the quantities listed in this quote.",deviceKinds:["computers","phones","tablets"],onboardingMode:"standard",onboardingFee:350,onsiteMode:"block",onsiteHours:1,clientTerms:"None.",sizingMode:"today",location:"One office",targetTiming:"This quarter",deviceTypes:"Windows computers",preparedFor:"Owner",exceptions:"None",signer:"Owner, Director"};
function harness({bii=false,linked=false}={}) {
  const sample=quoteDocumentSamples()[bii?1:0],q={...sample.quote,prospect_id:80,document_facts:{...facts}};
  const p={id:80,opp:"OPP-0080",business_name:"Example Services LLC",stage:"Qualified",hold:false,client_id:linked?"CL-80":null};
  const state={},requests=[],copies=[],events=[];let leased=false,record=linked?{id:"80",clientId:"CL-80"}:null,fill=null;
  const store={
    acquire:async(id,user)=>{if(!canQuote(user,"quote.send"))throw new Error("quote.send required");if(q.status!=="Approved"||p.hold)throw new Error("Approved and not On Hold required");if(leased)throw new Error("operation active");leased=true;return {q,p,actor:user,hash:snapshot(q),state,token:"lease"};},
    save:async(ctx,values)=>Object.assign(state,values),release:async()=>{leased=false;},
    renew:async()=>{},
    validate:async()=>{if(state.block)throw new Error("Pending request");},
    latestFill:async()=>fill,
    record:async()=>record,
    link:async(ctx,r)=>{p.client_id=r.clientId;p.sharepoint_record_id=r.clientId;},
    copy:async(ctx,lane)=>copies.find(c=>c.workflowId===lane.workflow&&c.instanceRef===String(ctx.q.id)),
    discovery:async()=>({opportunityId:p.opp}),
    request:async(ctx,action,lane,options,field)=>{const r={id:requests.length+1,status:"Pending",action,lane,options};requests.push(r);state[field]=r.id;events.push(action);},
    requestStatus:async id=>requests.find(r=>r.id===id),
  };
  const resolver={master:async()=>({content:await readFile(new URL(`./fixtures/${sample.name}`,import.meta.url))}),working:async()=>({itemId:"docx"})};
  const delivery={fill:async(id,user,options)=>{events.push("fill");assert.equal(options.instanceRef,String(q.id));if(state.etagFail)throw Object.assign(new Error("Working quote changed (412)"),{status:409});fill={id:1,mode:"live",status:"Succeeded",snapshot_hash:snapshot(q),item_id:"docx"};return {mode:"live"};}};
  const service=new ProposalPreparation({store,resolver,delivery,prices:async()=>prices,env:{QUOTE_FILL_MODE:"live",SHAREPOINT_WRITE_MODE:"live"}});
  const done=()=>{const r=requests.at(-1);r.status="Done";if(r.action==="CreateClient")record={id:"80",clientId:"CL-80"};else copies.push({id:String(copies.length+1),instanceRef:r.options.instanceRef,workflowId:r.options.workflowId,status:"Open",signatureStatus:"Preparing"});};
  return {service,store,resolver,q,p,state,requests,copies,events,done};
}
test("OPP-0080 creates one opportunity record and one quote-specific copy then fills without conversion",async()=>{
  const h=harness();
  assert.equal((await h.service.advance(h.q.id,actor)).step,"record_requested");
  await h.service.advance(h.q.id,actor);assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].options.discovery.opportunityId,"OPP-0080");h.done();
  assert.equal((await h.service.advance(h.q.id,actor)).step,"copy_requested");
  assert.deepEqual(h.requests[1].options,{workflowId:"MIT-05",instanceRef:String(h.q.id)});
  await h.service.advance(h.q.id,actor);assert.equal(h.requests.length,2);h.done();
  assert.ok((await h.service.advance(h.q.id,actor)).done);
  await h.service.advance(h.q.id,actor);assert.deepEqual(h.events,["CreateClient","CreateWorkingCopy","fill"]);
  assert.equal(h.p.sharepoint_record_id,"CL-80");assert.equal(prospectLifecycle(h.p).status,"Active");
});
test("existing opportunity record is reused, including two separately identified quotes",async()=>{
  const h=harness({linked:true});await h.service.advance(h.q.id,actor);assert.equal(h.requests[0].action,"CreateWorkingCopy");h.done();await h.service.advance(h.q.id,actor);
  const next=harness({linked:true});next.q.id++;await next.service.advance(next.q.id,actor);
  assert.notEqual(next.requests[0].options.instanceRef,h.requests[0].options.instanceRef);
});
test("concurrent Save clicks run one operation",async()=>{
  const h=harness();const results=await Promise.allSettled([h.service.advance(h.q.id,actor),h.service.advance(h.q.id,actor)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(h.requests.length,1);
});
for(const step of ["CreateClient","CreateWorkingCopy"])test(`${step} Rejected surfaces flow reason and retries only the rejected step`,async()=>{
  const h=harness({linked:step==="CreateWorkingCopy"});await h.service.advance(h.q.id,actor);
  h.requests[0].status="Rejected";h.requests[0].message="Definition must be Active";
  await assert.rejects(()=>h.service.advance(h.q.id,actor),/Rejected: Definition must be Active/);
  assert.equal(h.state[step==="CreateClient"?"record_request_id":"copy_request_id"],null);
  await h.service.advance(h.q.id,actor);assert.equal(h.requests.length,2);assert.equal(h.requests[1].action,step);
});
for(const status of ["Preparing","Unknown"])test(`${status} request is never blindly duplicated`,async()=>{
  const h=harness();await h.service.advance(h.q.id,actor);h.requests[0].status=status;
  await assert.rejects(()=>h.service.advance(h.q.id,actor),/reconciliation/);assert.equal(h.requests.length,1);
});
test("412 fill failure resumes the same copy without duplicate requests",async()=>{
  const h=harness({linked:true});await h.service.advance(h.q.id,actor);h.done();h.state.etagFail=true;
  await assert.rejects(()=>h.service.advance(h.q.id,actor),/412/);delete h.state.etagFail;
  await h.service.advance(h.q.id,actor);assert.equal(h.requests.length,1);assert.equal(h.state.step,"filled");
});
for(const [label,change,pattern] of [
  ["unapproved",h=>h.q.status="Draft",/Approved/],
  ["On Hold",h=>h.p.hold=true,/On Hold/],
  ["stale pricing",h=>h.q.line_items[0]={...h.q.line_items[0],amount:1},/pricing/],
  ["blocking pricing",h=>h.q.inputs.users=0,/users/],
  ["pending request",h=>h.state.block=true,/Pending/],
  ["missing BII facts",h=>{h.q.document_facts.legalName="";},/Missing owner/],
])test(`${label} is refused before a SharePoint request`,async()=>{
  const h=harness({bii:label==="missing BII facts"});change(h);
  await assert.rejects(()=>h.service.advance(h.q.id,actor),pattern);assert.equal(h.requests.length,0);
});
test("unauthorised user cannot create a record",async()=>{
  const h=harness();await assert.rejects(()=>h.service.advance(h.q.id,{...actor,quote_send:0}),/quote.send/);assert.equal(h.requests.length,0);
});
test("unapproved master tag set is refused before creating a record",async()=>{
  const h=harness(),zip=await JSZip.loadAsync((await h.resolver.master()).content);
  const xml=await zip.file("word/document.xml").async("string");zip.file("word/document.xml",xml.replaceAll("MIT.ClientShortName","MIT.WrongTag"));
  h.resolver.master=async()=>({content:await zip.generateAsync({type:"nodebuffer"})});
  await assert.rejects(()=>h.service.advance(h.q.id,actor),/tag/i);assert.equal(h.requests.length,0);
});
test("BII prepares BII-05 with Preparing signatures and offers eSignature guidance without email form",async()=>{
  const h=harness({bii:true,linked:true});await h.service.advance(h.q.id,actor);assert.equal(h.requests[0].options.workflowId,"BII-05");h.done();await h.service.advance(h.q.id,actor);
  assert.equal(h.copies[0].signatureStatus,"Preparing");
  const html=await ejs.renderFile("views/quote-delivery.ejs",{q:h.q,p:h.p,fill:{mode:"live",status:"Succeeded",document_key:"BII-QSOW"},attempts:[],reason:"BII uses eSignature",report:{unfilled:[]},sendMode:"live",csrf:"token",user:actor});
  assert.match(html,/Ready to send/);assert.doesNotMatch(html,/<form[^>]+action="\/quotes\/\d+\/send"/);
});
test("conversion requires activation, Mark Lost never converts, and unknown stages stay opportunities",()=>{
  const p={id:80,opp:"OPP-0080",client_id:"CL-80"};
  for(const stage of ["Sales Discovery","Quoting","Contracting","Unknown","Closed - Lost"]){assert.equal(isActivated(stage),false);assert.notEqual(prospectLifecycle({...p,sharepoint_stage:stage}).status,"Converted");}
  assert.equal(relationshipLabel({...p,sharepoint_stage:"Contracting"}),"Opportunity in SharePoint (OPP-0080 · CL-80)");
  assert.equal(relationshipLabel({...p,sharepoint_stage:"Client Activation"}),"Client");
  assert.equal(prospectLifecycle({...p,sharepoint_stage:"Client Activation"}).convertedClientId,"CL-80");
  assert.deepEqual(prospectLifecycle({...p,sharepoint_stage:"Operations",stage:"Closed Lost"}),{status:"Lost",convertedClientId:null});
  assert.deepEqual(prospectLifecycle({...p,sharepoint_stage:"Operations",status:"Lost"}),{status:"Lost",convertedClientId:null});
});

test("BII delivery before its first fill offers no email Send form",async()=>{
  const h=harness({bii:true});
  const html=await ejs.renderFile("views/quote-delivery.ejs",{q:h.q,p:h.p,fill:null,documentKey:"BII-QSOW",attempts:[],reason:"Save the proposal first",report:null,sendMode:"live",csrf:"token",user:actor});
  assert.doesNotMatch(html,/<form[^>]+action="\/quotes\/\d+\/send"/);
});

test("record-ID prospect sync is polled before creating the copy instead of blocking its own preparation",async()=>{
  const h=harness({linked:true});let synced=false;
  h.store.link=async()=>{if(!synced){synced=true;h.requests.push({id:1,status:"Pending",action:"UpsertProspect"});h.state.record_sync_request_id=1;}};
  assert.equal((await h.service.advance(h.q.id,actor)).step,"record_ready");
  await h.service.advance(h.q.id,actor);assert.equal(h.requests.length,1);
  h.requests[0].status="Done";await h.service.advance(h.q.id,actor);
  assert.equal(h.requests[1].action,"CreateWorkingCopy");
});
test("successful stage observation syncs conversion once and uses the actual signed-in actor",async()=>{
  const p={id:80,client_id:"CL-80"},events=[];
  const deps={query:async()=>events.push("update"),sync:async(row,user)=>events.push([prospectLifecycle(row).status,user.email]),actor};
  await observeLifecycle(p,"Sales Discovery",deps);await observeLifecycle(p,"Client Activation",deps);await observeLifecycle(p,"Client Activation",deps);
  assert.deepEqual(events,["update",["Active",actor.email],"update",["Converted",actor.email]]);
});
function schema(){return {siteId:"site",requestListId:"requests",quoteInstanceColumn:"VerifiedInstance",definitions:[{id:"MIT-05",active:true,createCopy:true,lane:"Managed IT"}],maps:{requests:Object.fromEntries(required.requests.map(name=>[name,{name:name.replaceAll(" ",""),text:{}}])),clients:{"Client ID":{name:"ClientID"},"Current Stage":{name:"Stage"}}}};}
test("record ID payload field is disabled without a verified Sales Prospects column",()=>{
  const p={id:80,opp:"OPP-0080",sharepoint_record_id:"CL-80",client_id:"CL-80",sharepoint_stage:"Quoting"};
  const s=schema(),parse=()=>JSON.parse(buildFields(s,"UpsertProspect",p,null,actor.email).fields.Payload);
  assert.equal(parse().sharepointRecordId,undefined);assert.equal(parse().convertedClientId,null);
  s.prospectRecordColumn="TIGP_SharePointRecordID";assert.equal(parse().sharepointRecordId,"CL-80");
  p.sharepoint_stage="Client Activation";assert.equal(parse().status,"Converted");assert.equal(parse().convertedClientId,"CL-80");
});
test("SQL request store persists request ID before dispatch; timeout leaves resumable Unknown",async()=>{
  const h=harness({linked:true}),s=schema(),events=[],state={operation_token:"lease",valid:1};
  const ctx={q:h.q,p:h.p,actor,hash:snapshot(h.q),token:"lease",state:{}};
  const store=new ProposalStore({env:{SHAREPOINT_WRITE_MODE:"live"},sp:{ready:()=>s},graph:{createWorkflowRequest:async()=>{events.push("graph");throw new Error("timeout");}},deliveryStore:{},getProspect:async()=>h.p,tx:async fn=>fn({}),log:async()=>{},run:async(sql,args)=>{
    if(sql.startsWith("SELECT * FROM quotes"))return [h.q];if(sql.startsWith("SELECT * FROM allowlist"))return [actor];
    if(sql.startsWith("SELECT operation_token"))return [state];
    if(sql.startsWith("INSERT INTO sp_requests")){events.push("persist request");return {insertId:17};}
    if(sql.startsWith("UPDATE quote_proposal_states")){events.push("persist state");return {affectedRows:1};}
    if(sql.includes("status='Unknown'")){events.push("unknown");return {affectedRows:1};}
    if(sql.includes("client_request_locks"))return [];
    throw new Error(sql+args);
  }});
  store.validate=async()=>{};
  await assert.rejects(()=>store.request(ctx,"CreateWorkingCopy",{key:"COM-PRP",workflow:"MIT-05"},{workflowId:"MIT-05",instanceRef:String(h.q.id)},"copy_request_id"),/uncertain/);
  assert.deepEqual(events,["persist request","persist state","graph","unknown"]);assert.equal(ctx.state.copy_request_id,17);
});
test("legacy unambiguous open copy is reused; a claimed copy cannot be reused for another quote",async()=>{
  const h=harness({linked:true}),legacy={id:"41",workflowId:"MIT-05",status:"Open"},s=schema();let claimed=false;
  const store=new ProposalStore({sp:{ready:()=>s,workItems:async()=>[legacy]},graph:{},deliveryStore:{},run:async sql=>sql.includes("quote_proposal_states")&&claimed?[{working_item_id:"41"}]:[]});
  const ctx={q:h.q,p:h.p,state:{}};
  assert.equal((await store.copy(ctx,{workflow:"MIT-05"})).id,"41");claimed=true;
  assert.equal(await store.copy(ctx,{workflow:"MIT-05"}),undefined);
});
test("Item Completed cancellation payload is explicit; normal completion remains Complete",()=>{
  const p={client_id:"CL-80"};
  assert.deepEqual(workPayload("ItemCompleted",p,"Managed IT",{itemId:41,cancelProposal:true}),{itemId:41,completionStatus:"Cancelled",outcomeFlags:[]});
  assert.equal(workPayload("ItemCompleted",p,"Managed IT",{itemId:41,completionStatus:"Cancelled"}).completionStatus,"Complete");
});

test("real SQL lease acquisition refuses a second click, revoked permission, and a changed approved snapshot",async()=>{
  const h=harness();let state,enabled=true,approvedHash=proposalApprovalSnapshot(h.q);
  const run=async(sql,args)=>{
    if(sql.startsWith("SELECT * FROM quotes"))return [h.q];
    if(sql.startsWith("SELECT * FROM allowlist"))return [{...actor,quote_send:enabled?1:0}];
    if(sql.startsWith("INSERT IGNORE INTO quote_proposal_states")){state ||= {snapshot_hash:args[1],busy:0};return {affectedRows:1};}
    if(sql.startsWith("SELECT *,lease_until"))return [state];
    if(sql.startsWith("UPDATE quote_proposal_states SET operation_token")){state.operation_token=args[0];state.busy=1;return {affectedRows:1};}
    throw new Error(sql);
  };
  const store=new ProposalStore({sp:{},graph:{},deliveryStore:{},getProspect:async()=>h.p,run,tx:async fn=>fn({})});
  const ctx=await store.acquire(h.q.id,actor);assert.equal(state.snapshot_hash,approvedHash);assert.equal(ctx.hash,snapshot(h.q));
  await assert.rejects(()=>store.acquire(h.q.id,actor),/already active/);
  state.operation_token=null;state.busy=0;state.snapshot_hash="different";
  await assert.rejects(()=>store.acquire(h.q.id,actor),/pricing snapshot differs/);
  enabled=false;await assert.rejects(()=>store.acquire(h.q.id,actor),/quote.send/);
});

test("fresh resolver selects the correct quote instance and sending selects the recorded drive item",async()=>{
  const p={client_id:"CL-80"},s={...schema(),clientOpsId:"ops"};
  const items=[1,2].map(n=>({id:String(n),clientId:p.client_id,workflowId:"MIT-05",status:"Open",instanceRef:String(n)}));
  const graph={read:async path=>{
    const row=path.match(/lists\/ops\/items\/(\d+)/);
    if(row)return {fields:{TIG_ClientID:p.client_id,TIG_WorkflowID:"MIT-05",TIG_CompletionStatus:"Open",VerifiedInstance:row[1]},driveItem:{id:"doc"+row[1],name:"Quote.docx",parentReference:{driveId:"drive"}}};
    if(path.endsWith("/commercial"))return {id:"commercial",name:"Commercial",folder:{}};
    return {id:path.endsWith("doc2")?"doc2":"doc1",name:"Quote.docx",eTag:"current",parentReference:{id:"commercial"}};
  }};
  const resolver=new SharePointQuotes({ready:()=>s,client:async()=>({}),workItems:async()=>items,requests:async()=>[]},graph);
  assert.equal((await resolver.working(p,"COM-PRP","2")).itemId,"doc2");
  assert.equal((await resolver.working(p,"COM-PRP",undefined,"doc1")).itemId,"doc1");
  await assert.rejects(()=>resolver.working(p,"COM-PRP","3"),/exactly one/);
});

test("a failed request with partial record creation resumes by reusing the output",async()=>{
  const h=harness();await h.service.advance(h.q.id,actor);h.done();h.requests[0].status="Failed";h.requests[0].message="Post-create notification failed";
  await assert.rejects(()=>h.service.advance(h.q.id,actor),/Failed: Post-create/);
  await h.service.advance(h.q.id,actor);
  assert.deepEqual(h.events,["CreateClient","CreateWorkingCopy"]);
});

test("only Josh can explicitly supersede a prior proposal via existing Item Completed",async()=>{
  const p={id:80,client_id:"CL-80",service_lane:"Managed IT"},item={id:"41",clientId:"CL-80",workflowId:"MIT-05",status:"Open",signatureStatus:"Preparing",lane:"Managed IT",instanceRef:"1"};
  const s=schema();s.maps.clients=Object.fromEntries(["Client ID","Current Stage","Stage Status","Next Action","Service Lanes"].map(k=>[k,{name:k,choice:{choices:["Quoting"]}}]));s.workChoices={TIG_CompletionStatus:["Open","Complete","Cancelled"]};
  let submitted;
  const deps={transaction:async fn=>fn({}),audit:async()=>{},prospect:async()=>p,
    sp:{ready:()=>s,client:async()=>({fields:{"Client ID":"CL-80","Current Stage":"Quoting","Service Lanes":["Managed IT"]}}),workItems:async()=>[item],requests:async()=>[],invalidateWorkItems:()=>{}},graph:{},
    query:async(sql,args)=>{if(sql.startsWith("SELECT q.id"))return [{id:2}];if(sql.startsWith("INSERT INTO sp_requests")){submitted=JSON.parse(args[2]);return {insertId:17};}return [];}};
  const input={action:"ItemCompleted",itemId:41,supersede:"yes",confirm:"yes",replacementQuoteId:2};
  await assert.rejects(()=>executeWorkAction(80,input,{...actor,role:"sales"},null,deps),/Josh/);
  await executeWorkAction(80,input,{email:"josh@theitguys.us",role:"owner",quote_send:1},null,deps);
  assert.deepEqual(JSON.parse(submitted.fields.Payload),{itemId:41,completionStatus:"Cancelled",outcomeFlags:[]});
  item.signatureStatus="Signed";
  await assert.rejects(()=>executeWorkAction(80,input,{email:"josh@theitguys.us",role:"owner"},null,deps),/not started signing/);
});


test("quote preparation honors a BII-first plan instead of choosing Managed IT from the quote", async()=>{
  const h=harness(),s=schema();
  h.p.planned_service_lanes=JSON.stringify(["Business IT Integration","Managed IT"]);
  h.p.starting_service_lane="Business IT Integration";
  const ctx={q:h.q,p:h.p,actor,hash:snapshot(h.q),token:"lease",state:{}};
  let fields;
  const store=new ProposalStore({env:{SHAREPOINT_WRITE_MODE:"live"},sp:{ready:()=>s,client:async()=>null,clients:async()=>[]},graph:{createWorkflowRequest:async(site,list,f)=>{fields=f;return {id:"remote"};}},deliveryStore:{},getProspect:async()=>h.p,tx:async fn=>fn({}),log:async()=>{},run:async sql=>{
    if(sql.startsWith("SELECT * FROM quotes"))return [h.q];
    if(sql.startsWith("SELECT * FROM allowlist"))return [actor];
    if(sql.startsWith("SELECT operation_token"))return [{operation_token:"lease",valid:1}];
    if(sql.startsWith("INSERT INTO sp_requests"))return {insertId:18};
    return {affectedRows:1};
  }});
  store.validate=async()=>{};
  await store.request(ctx,"CreateClient",{key:"COM-PRP",workflow:"MIT-05"},{discovery:{servicePlan:{services:["Business IT Integration","Managed IT"],startingLane:"Business IT Integration"}}},"record_request_id");
  assert.equal(fields.ServiceLane,"Business IT Integration");
  assert.equal(JSON.parse(fields.Payload).serviceLane,"Business IT Integration");
  assert.equal(JSON.parse(fields.Payload).stage,"Sales Discovery");
});
