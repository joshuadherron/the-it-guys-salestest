import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ejs from "ejs";
import { QuoteDelivery } from "../src/docfill/delivery.js";
import { Graph } from "../src/graph.js";
import { snapshot,DeliveryStore } from "../src/docfill/delivery-store.js";
import { canQuote,quoteSend,quoteApprove,adminOnly } from "../src/quote-permissions.js";
import { senderMailbox,quoteEmail,DEFAULT_BODY,DEFAULT_SUBJECT,inspectPdfText } from "../src/docfill/send-policy.js";
import { quoteDocumentSamples } from "../scripts/lib/quote-document-samples.js";
import { SharePointQuotes } from "../src/docfill/sharepoint-quotes.js";
const qSample=quoteDocumentSamples()[0];
const profile={email:"alanna@theitguys.us",role:"sales",quote_send:1,quote_approve:0,display_name:"Alanna Herron",sender_title:"Co-owner",sender_phone:"409-555-0100"};
const owner={legalName:"Example Services LLC",preparedName:"Example Owner",preparedTitle:"Director",preparedEmail:"owner@example.test",backupContact:"Administrator",siteCount:1,domain:"example.test",serviceStartMode:"after_contracts",summary:"The IT Guys will support the selected users and the listed business devices.",deviceKinds:["computers","phones","tablets"],onboardingMode:"standard",onboardingFee:350,onsiteMode:"block",onsiteHours:1,clientTerms:"None.",sizingMode:"today",hipaa:true};
function harness(options={}){
 const q={...qSample.quote,quote_number:"Q-2026-010",document_facts:owner},p={id:1,client_id:"CL-1",contact_name:"Jane Doe",business_name:"Example Services LLC",email:"jane@example.test"};
 const working={name:"Example Managed Quote.docx",driveId:"drive",itemId:"item",folderId:"commercial",eTag:"etag",webUrl:"https://example.sharepoint.com/Commercial/quote.docx",status:"Open"};
 const actor={...profile},events=[],attempts=[];
 let leased=false;
 const fill={id:1,document_key:"COM-PRP",mode:"live",status:"Succeeded",snapshot_hash:snapshot(q),drive_id:"drive",item_id:"item",etag:"etag",fields_json:JSON.stringify(qSample.data.fields),report:JSON.stringify({unfilled:[]})};
 const store={
  checkMailbox:async()=>{},
  begin:async(id,user,op,retryId)=>{if(!canQuote(actor,"quote.send"))throw new Error("quote.send");if(q.status!=="Approved"||p.hold)throw new Error("Approved and not On Hold");if(leased)throw new Error("already active");leased=true;const attempt=retryId?attempts.find(a=>a.id===retryId):null;if(retryId&&(!attempt||attempt.status!=="Failed"||!attempt.pdf_item_id))throw new Error("No saved failed PDF");return {q,p,actor,hash:snapshot(q),token:"lock",attempt};},
  current:async()=>{if(q.status!=="Approved"||p.hold||!canQuote(actor,"quote.send"))throw new Error("permission or approval changed");return {q,p,actor};},
  release:async(ctx,unknown)=>{events.push(["release",unknown]);if(!unknown)leased=false;},
  latestFill:async()=>options.noFill?null:fill,
  createFill:async(ctx,key,w,data,mode)=>{events.push(["fill",mode]);fill.report=JSON.stringify(data.report);return 1;},
  filled:async(id,status,etag)=>{events.push(["filled",status]);fill.status=status;fill.etag=etag;},
  log:async()=>events.push(["audit"]),
  createAttempt:async(ctx,data)=>{const a={...data,id:attempts.length+1,status:"Preparing",phase:"SavePdf",mode:data.mode,mailbox:data.mailbox,sent_to:data.to,sent_cc:data.cc,pdf_name:data.name,pdf_bytes:data.pdf,snapshot_hash:ctx.hash};attempts.push(a);events.push(["attempt"]);return a.id;},
  savedPdf:async(id,item)=>{attempts[id-1].pdf_item_id=item;events.push(["pdfSaved"]);},
  sending:async(id,who,message)=>{attempts[id-1].phase="Email";attempts[id-1].email=message;events.push(["sending",who.email]);},
  sent:async(ctx,id,data,result)=>{attempts[id-1].status=data.mode==="live"?"Sent":"Dryrun";events.push(["audit",ctx.actor.email]);if(data.mode==="live")Object.assign(q,{status:"Sent",sent_by:ctx.actor.email,sent_to:data.to,sent_cc:data.cc,sent_pdf_item_id:data.pdfItemId,email_message_id:result.messageId});},
  failed:async(id,status,phase,error)=>{Object.assign(attempts[id-1],{status,phase,error:error.message});},
 };
 const graph={
  quoteContent:async()=>Buffer.from("%PDF-verified sample"),
  read:async()=>({id:"sent-pdf",parentReference:{id:"commercial"}}),
  replaceQuoteWorkingCopy:async(d,i,etag)=>{events.push(["put",etag]);if(options.putFail)throw Object.assign(new Error("changed"),{status:409});return {id:i,eTag:"new-etag"};},
  createSentQuotePdf:async(d,folder,name)=>{events.push(["savePdf",folder,name]);if(options.pdfFail)throw Object.assign(new Error("PDF conflict"),{status:409});return {id:"sent-pdf"};},
  sendQuoteMail:async(box,message,correlation)=>{events.push(["mail",box,message,correlation]);if(options.mailFail)throw Object.assign(new Error("Access policy refused"),{status:403});if(options.timeout)throw new Error("timeout");return {messageId:null,requestId:"graph-request"};},
 };
 const resolver={working:async()=>{if(options.pending)throw new Error("client Pending Workflow Request");if(options.closed)throw new Error("Working copy Complete/Cancelled");return working;},resolve:async()=>({working,master:{documentKey:"COM-PRP",status:"Approved",name:"COM-PRP-v1.8.docx",content:await readFile(new URL("./fixtures/COM-PRP-v1.8.docx",import.meta.url))}})};
 const env={QUOTE_FILL_MODE:"live",QUOTE_SEND_MODE:options.mode||"live",QUOTE_SENDER_MAILBOX:"sales@theitguys.us"};
 const service=new QuoteDelivery({store,resolver,graph,env,extractText:async()=>options.text===undefined?"Verified Managed IT quote":options.text,prices:async()=>({}),config:async()=>({subject_template:DEFAULT_SUBJECT,body_template:DEFAULT_BODY})});
 return {service,store,resolver,graph,env,q,p,actor,working,fill,events,attempts,options};
}
test("configurable quote permissions let Alanna send but not approve; role alone grants nothing",()=>{
 assert.equal(canQuote(profile,"quote.send"),true);assert.equal(canQuote(profile,"quote.approve"),false);assert.equal(canQuote({role:"owner"},"quote.send"),false);
 for(const guard of [quoteApprove,adminOnly]){let denied;guard({session:{user:profile}},{status:s=>({send:()=>{denied=s;}})},()=>assert.fail());assert.equal(denied,403);}
 let passed=false;quoteSend({session:{user:profile}},{},()=>{passed=true;});assert.ok(passed);
});
test("live fill uses eTag and dryrun never PUTs; 412-style refusal is retained",async()=>{
 const h=harness();await h.service.fill(h.q.id,profile);assert.deepEqual(h.events.find(e=>e[0]==="put"),["put","etag"]);
 const dry=harness();dry.env.QUOTE_FILL_MODE="dryrun";await dry.service.fill(dry.q.id,profile);assert.ok(!dry.events.some(e=>e[0]==="put"));
 const bad=harness({putFail:true});await assert.rejects(()=>bad.service.fill(bad.q.id,profile),/changed/);assert.ok(bad.events.some(e=>e[0]==="filled"&&e[1]==="Failed"));
});
for(const [label,change,match] of [
 ["unapproved quote",h=>h.q.status="Draft",/Approved/],
 ["hold",h=>h.p.hold=true,/On Hold/],
 ["missing live fill",h=>h.options.noFill=true,/successful live fill/],
 ["failed latest fill",h=>h.fill.status="Failed",/successful live fill/],
 ["dryrun fill",h=>h.fill.mode="dryrun",/successful live fill/],
 ["stale approved snapshot",h=>h.fill.snapshot_hash="stale",/successful live fill/],
 ["closed copy",h=>h.options.closed=true,/Complete/],
 ["pending workflow",h=>h.options.pending=true,/Pending/],
 ["missing profile",h=>h.actor.sender_phone="",/profile/],
 ["invalid recipient",h=>h.p.email="bad",/primary contact/],
 ["internal recipient",h=>h.p.email="someone@theitguys.us",/Internal recipient/],
 ["multiple CCs",()=>{},/single CC/],
 ["Word edits",h=>h.working.eTag="changed",/reviewed the Word edits/],
 ["unfilled last report",h=>h.fill.report=JSON.stringify({unfilled:["MIT.Domain"]}),/unfilled/],
 ["bracket PDF",h=>h.options.text="Quote [missing]",/placeholder/],
 ["template PDF",h=>h.options.text="TEMPLATE text",/placeholder/],
 ["dryrun PDF",h=>h.options.text="DRYRUN quote",/placeholder/],
 ["empty PDF text",h=>h.options.text="",/could not be verified/],
 ["mailbox unset",h=>delete h.env.QUOTE_SENDER_MAILBOX,/QUOTE_SENDER_MAILBOX/],
 ["flow mailbox",h=>h.env.QUOTE_SENDER_MAILBOX="workflow@theitguys.us",/forbidden/],
 ])test("send refuses "+label+" before any PDF save/email",async()=>{
 const h=harness();change(h);await assert.rejects(()=>h.service.send(h.q.id,profile,label==="multiple CCs"?{cc:"a@example.test,b@example.test"}:{}),match);
 assert.ok(!h.events.some(e=>["savePdf","mail"].includes(e[0])));
});
test("live send saves one PDF before shared-mailbox email and records Sent attribution/audit",async()=>{
 const h=harness();await h.service.send(h.q.id,profile,{cc:"one@example.test"});
 const saved=h.events.find(e=>e[0]==="savePdf"),mail=h.events.find(e=>e[0]==="mail");
 assert.match(saved[2],/ - SENT \d{4}-\d{2}-\d{2}\.pdf$/);assert.ok(h.events.indexOf(saved)<h.events.indexOf(mail));
 assert.equal(mail[1],"sales@theitguys.us");assert.equal(mail[2].saveToSentItems,true);assert.equal(mail[2].message.toRecipients[0].emailAddress.address,"jane@example.test");assert.equal(mail[2].message.ccRecipients.length,1);assert.match(mail[2].message.body.content,/Alanna Herron, Co-owner/);
 assert.deepEqual([h.q.status,h.q.sent_by,h.q.sent_to,h.q.sent_cc,h.q.sent_pdf_item_id],["Sent",profile.email,"jane@example.test","one@example.test","sent-pdf"]);assert.ok(h.events.some(e=>e[0]==="audit"));
});
test("dryrun sends only to clicking user, drops CC, prefixes subject and saves no PDF",async()=>{
 const h=harness({mode:"dryrun"});await h.service.send(h.q.id,profile,{cc:"external@example.test"});
 const mail=h.events.find(e=>e[0]==="mail")[2];assert.match(mail.message.subject,/^\[DRYRUN\]/);assert.equal(mail.message.toRecipients[0].emailAddress.address,profile.email);assert.deepEqual(mail.message.ccRecipients,[]);assert.ok(!h.events.some(e=>e[0]==="savePdf"));assert.equal(h.q.status,"Approved");
});
test("explicit Word-edit review and internal-test checkbox allow the checked current PDF",async()=>{
 const h=harness();h.working.eTag="changed";h.p.email="test@theitguys.us";await h.service.send(h.q.id,profile,{reviewed_edits:"yes",internal_test:"yes"});assert.equal(h.q.status,"Sent");
});
test("PDF save failure sends nothing; failed email retries only the original PDF",async()=>{
 const bad=harness({pdfFail:true});await assert.rejects(()=>bad.service.send(bad.q.id,profile),/PDF conflict/);assert.ok(!bad.events.some(e=>e[0]==="mail"));
 const h=harness({mailFail:true});await assert.rejects(()=>h.service.send(h.q.id,profile),/Access policy/);assert.equal(h.attempts[0].status,"Failed");assert.equal(h.attempts[0].pdf_item_id,"sent-pdf");
 h.options.mailFail=false;await h.service.send(h.q.id,profile,{retryId:1});assert.equal(h.events.filter(e=>e[0]==="savePdf").length,1);assert.equal(h.events.filter(e=>e[0]==="mail").length,2);assert.equal(h.q.status,"Sent");
});
test("uncertain email keeps operation blocked instead of automatically retrying",async()=>{
 const h=harness({timeout:true});await assert.rejects(()=>h.service.send(h.q.id,profile),/timeout/);assert.equal(h.attempts[0].status,"Unknown");await assert.rejects(()=>h.service.send(h.q.id,profile,{retryId:1}),/already active/);
});
test("email BAA phrase is present only for HIPAA fills",()=>{
 const base={quote:{quote_number:"Q-2026-010"},prospect:{contact_name:"Jane Doe"},actor:profile,fields:qSample.data.fields,mode:"live",to:"client@example.test",pdf:Buffer.from("pdf"),name:"quote.pdf",requestId:"id"};
 assert.match(quoteEmail(base).message.body.content,/, plus a Business Associate Agreement,/);
 assert.ok(!quoteEmail({...base,fields:{...base.fields,"MIT.BAAAccept":""}}).message.body.content.includes("Business Associate Agreement"));
});
test("Graph PUT preserves If-Match, 412 refuses, PDF upload uses conflict=fail, email always uses configured mailbox",async()=>{
 const calls=[];let failPut=false;
 const graph=new Graph({token:async()=>"token",fetchImpl:async(url,options)=>{calls.push({url,options});if(url.includes("sendMail"))return new Response(null,{status:202,headers:{"request-id":"graph-id"}});if(failPut)return new Response(null,{status:412});return Response.json({id:"item",eTag:"new"},{status:201});}});
 await graph.replaceQuoteWorkingCopy("d","i","etag",Buffer.from("docx"));assert.equal(calls[0].options.headers["If-Match"],"etag");
 failPut=true;await assert.rejects(()=>graph.replaceQuoteWorkingCopy("d","i","etag",Buffer.from("docx")),e=>e.status===409);failPut=false;
 graph.request=async(path,method,body)=>{assert.match(path,/createUploadSession$/);assert.equal(body.item["@microsoft.graph.conflictBehavior"],"fail");return {uploadUrl:"https://example.sharepoint.com/upload"};};
 await graph.createSentQuotePdf("d","folder","quote - SENT 2026-10-15.pdf",Buffer.from("pdf"));
 const result=await graph.sendQuoteMail("sales@theitguys.us",{saveToSentItems:true},"request-id");assert.equal(result.messageId,null);assert.match(calls.at(-1).url,/users\/sales%40theitguys.us\/sendMail$/);
 await assert.rejects(()=>graph.sendQuoteMail("workflow@theitguys.us",{},"id"),/forbidden/);
});
test("SharePoint resolver fails closed on unpromoted/missing masters",async()=>{
 const h=harness();const resolver=new SharePointQuotes({ready:()=>({siteId:"site"})},{all:async()=>[]});resolver.working=async()=>h.working;
 await assert.rejects(()=>resolver.resolve({...h.q,inputs:h.q.inputs},h.p,"COM-PRP"),/master library/);
});
test("database sent transition persists all delivery identifiers and audit in one transaction",async()=>{
 const writes=[],logs=[],store=new DeliveryStore({query:async(sql,args)=>writes.push({sql,args}),transaction:async fn=>fn({}),audit:async(...args)=>logs.push(args)});
 await store.sent({q:{id:10},actor:profile},1,{mode:"live",to:"client@example.test",cc:null,pdfItemId:"pdf"},{requestId:"request",messageId:null});
 assert.ok(writes.some(w=>w.sql.includes("sent_at=UTC_TIMESTAMP()")&&w.sql.includes("sent_pdf_item_id")));assert.equal(logs[0][1].email,profile.email);
});
test("delivery view disables Send with a named missing-mailbox reason and renders retry/checklist",async()=>{
 const html=await ejs.renderFile("views/quote-delivery.ejs",{q:{id:10},p:{id:1,email:"client@example.test"},fill:{mode:"live",status:"Succeeded",document_key:"COM-PRP",web_url:"https://example.sharepoint.com/q.docx"},report:{unfilled:["MIT.Domain"]},attempts:[],reason:"QUOTE_SENDER_MAILBOX is not configured",sendMode:"dryrun",csrf:"token",user:profile,mode:"dryrun"});
 assert.ok(html.includes("QUOTE_SENDER_MAILBOX"));assert.ok(html.includes("MIT.Domain"));assert.match(html,/<button disabled>Send quote to client/);
});
test("PDF placeholder inspector refuses brackets and reserved words",()=>{for(const value of ["[x]", "TEMPLATE", "dryrun",""])assert.throws(()=>inspectPdfText(value));assert.equal(senderMailbox({QUOTE_SENDER_MAILBOX:"sales@theitguys.us"}),"sales@theitguys.us");});

test("Graph PDF conversion follows a preauthenticated redirect without forwarding the bearer token",async()=>{
 const calls=[];const graph=new Graph({token:async()=>"secret",fetchImpl:async(url,options)=>{calls.push({url,options});return calls.length===1?new Response(null,{status:302,headers:{location:"https://example.sharepoint.com/pdf-download"}}):new Response("%PDF-verified");}});
 await graph.quoteContent("d","item",true);assert.match(calls[0].url,/content\?format=pdf$/);assert.equal(calls[0].options.headers.Authorization,"Bearer secret");assert.equal(calls[1].options.headers,undefined);
});
test("database mailbox check refuses personal app-user mailboxes",async()=>{
 const store=new DeliveryStore({query:async()=>[{email:"person@theitguys.us"}]});await assert.rejects(()=>store.checkMailbox("person@theitguys.us"),/dedicated shared/);
});
test("admin reconciliation requires evidence and permits only an explicit later email-only retry",async()=>{
 const {reconcileQuoteDelivery}=await import("../src/docfill/reconcile.js");const calls=[],logs=[];
 const deps={transaction:async fn=>fn({}),audit:async(...args)=>logs.push(args),query:async(sql,args)=>{calls.push({sql,args});if(sql.includes("FROM quote_send_attempts"))return [{id:1,status:"Unknown",phase:"Email",pdf_item_id:"pdf",client_id:"CL-1",age_seconds:180}];if(sql.includes("FROM quote_operation_locks"))return [{token:"lease",operation:"Send"}];return [];}};
 await assert.rejects(()=>reconcileQuoteDelivery({attempt_id:1,note:"checked all records"},profile,deps),/Check Commercial/);
 await reconcileQuoteDelivery({attempt_id:1,note:"No message exists in shared Sent Items.",confirm_checked:"yes",decision:"not_sent"},{...profile,is_admin:1},deps);
 assert.ok(calls.some(c=>c.sql.includes("status='Failed'")));assert.ok(calls.some(c=>c.sql.startsWith("DELETE FROM quote_operation_locks")));assert.equal(logs.length,1);
});

test("BII automation is refused even for quote.send users",async()=>{
 const h=harness();h.q.inputs=quoteDocumentSamples()[1].quote.inputs;
 await assert.rejects(()=>h.service.send(h.q.id,profile),/manual eSignature/);assert.ok(!h.events.some(e=>["savePdf","mail"].includes(e[0])));
});
test("only an exact promoted Approved master is selected, never a Draft BII master",async()=>{
 let status="Draft",downloads=0;
 const graph={all:async path=>path.endsWith("/columns")?[{name:"key",displayName:"Document Key"},{name:"state",displayName:"Status"}]:path.includes("/items?")?[{fields:{key:"BII-QSOW",state:status},driveItem:{id:"master",name:"BII-QSOW-v1.6.docx",parentReference:{driveId:"master-drive"}}}]:[{id:"masters",displayName:"Operational Standards & Templates"}],quoteContent:async()=>{downloads++;return readFile(new URL("./fixtures/BII-QSOW-v1.6.docx",import.meta.url));}};
 const resolver=new SharePointQuotes({ready:()=>({siteId:"site"})},graph);resolver.working=async()=>({itemId:"working"});
 await assert.rejects(()=>resolver.resolve(quoteDocumentSamples()[1].quote,{client_id:"CL-1"},"BII-QSOW"),/promoted Approved/);assert.equal(downloads,0);
 status="Approved";const resolved=await resolver.resolve(quoteDocumentSamples()[1].quote,{client_id:"CL-1"},"BII-QSOW");assert.equal(resolved.master.status,"Approved");assert.ok(Buffer.isBuffer(resolved.master.content));
});
test("disabled accounts cannot retain quote permissions",()=>{assert.equal(canQuote({...profile,enabled:0},"quote.send"),false);});
