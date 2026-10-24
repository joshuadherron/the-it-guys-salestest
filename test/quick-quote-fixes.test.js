import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ejs from 'ejs';
import { SharePointQuotes } from '../src/docfill/sharepoint-quotes.js';
import { WorkReader } from '../src/sharepoint-work.js';
import { QuoteDelivery } from '../src/docfill/delivery.js';
import { quoteDocumentSamples } from '../scripts/lib/quote-document-samples.js';
import { snapshot } from '../src/docfill/delivery-store.js';
import { validateProjectQuote,priceProject } from '../src/project-pricing.js';
import { prices } from '../src/config.js';
import { projectLane } from '../src/engagement-types.js';
import { ProposalStore } from '../src/docfill/proposal-store.js';
import { ProposalPreparation } from '../src/docfill/proposals.js';
import { QuickSend } from '../src/quick-send.js';
import { startQuickSendWorker } from '../src/quick-send-worker.js';
import { quickQuoteRoutes } from '../src/quick-quote-routes.js';
import { previewSections,missingProposalFacts } from '../src/quick-quote-preview.js';
import { waitingForJosh } from '../src/guided-workflow.js';
import { isProspectSync } from '../src/quote-request-scope.js';
import { dispatchProspectSync } from '../src/prospect-sync.js';
import { required,requiredChoices,validateSchema } from '../src/sharepoint.js';

const actor={email:'owner@example.test',role:'owner',enabled:1,quote_send:1,quote_approve:1,display_name:'Josh',sender_title:'Owner',sender_phone:'555'};
const facts={legalName:'Example LLC',preparedName:'Pat',preparedTitle:'Owner',preparedEmail:'pat@example.test',backupContact:'Admin',siteCount:1,domain:'example.test',serviceStartMode:'after_contracts',summary:'Provide the selected services for the quantities stated in this proposal.',deviceKinds:['computers','phones','tablets'],onboardingMode:'standard',onboardingFee:350,onsiteMode:'block',onsiteHours:1,clientTerms:'None.',sizingMode:'today'};

function graphFixture(key){
  const workflow=key==='COM-PRP'?'MIT-05':key==='BII-QSOW'?'BII-05':'PRJ-05',sample=quoteDocumentSamples()[key==='BII-QSOW'?1:0];
  const q={...sample.quote,id:23,prospect_id:109,quote_number:'Q-2026-023',document_facts:{...facts,preparedFor:'Pat, Owner',location:'Beaumont',targetTiming:'Next month',deviceTypes:'Windows computers',exceptions:'None',signer:'Pat, Owner'},status:'Approved'};
  if(key==='ENG-PRJ'){
    q.inputs=validateProjectQuote({scope:'Repair email',terms:'Accept in writing.',basis:'fixed',lines:[{label:'Email repair',quantity:1,unitPrice:300,kind:'labor'}]},'project');
    const priced=priceProject(q.inputs);q.line_items=priced.lines;q.total=priced.total;
  }
  const p={id:109,opp:'OPP-0109',client_id:'CL-109',business_name:'Example LLC',contact_name:'Pat',email:'pat@example.test'};
  const s={siteId:'site',clientOpsId:'ops',quoteInstanceColumn:'TIG_InstanceRef',businessColumn:'BusinessID',
    definitions:[{id:workflow,lane:key==='ENG-PRJ'?projectLane:key==='COM-PRP'?'Managed IT':'Business IT Integration',active:true,createCopy:true}],
    maps:{requests:{'Request Type':{name:'RequestType'},Payload:{name:'Payload'},'Processing Status':{name:'Status'},Client:{name:'Client'},'Service Lane':{choice:{choices:[projectLane]}}},
      clients:{'Service Lanes':{choice:{choices:[projectLane]}}}},
  };
  const row={id:'533',fields:{TIG_ClientID:p.client_id,TIG_WorkflowID:workflow,TIG_CompletionStatus:'Not Started',TIG_InstanceRef:'23',TIG_SignatureStatus:'Preparing'},driveItem:{id:'FILE-23',name:'Quote.docx',webUrl:'https://example.sharepoint.com/Commercial/Quote.docx',parentReference:{driveId:'drive'}}};
  const unrelated={...row,id:'532',fields:{...row.fields,TIG_InstanceRef:'22'},driveItem:{...row.driveItem,id:'FILE-22'}};
  let etag='before',ctag='content-before',fill;const reads=[],events=[],debug=[];
  const graph={
    all:async()=>[row,unrelated],
    read:async path=>{
      reads.push(path);
      if(path.includes('/lists/ops/items/533'))return row;
      if(path.includes('/lists/ops/items/532'))return unrelated;
      if(path.endsWith('/commercial'))return {id:'commercial',name:'Commercial',folder:{}};
      return {...row.driveItem,eTag:etag,cTag:ctag,parentReference:{id:'commercial'}};
    },
    replaceQuoteWorkingCopy:async(d,id,old)=>{assert.equal(id,'FILE-23');assert.equal(old,etag);etag='filled';ctag='content-filled';return {id,eTag:etag,cTag:ctag};},
    quoteContent:async()=>Buffer.from('%PDF fixture'),
    createSentQuotePdf:async()=>{events.push('PDF');return {id:'sent-pdf'};},
    sendQuoteMail:async()=>{events.push('mail');return {requestId:'mail-request'};},
  };
  const sp={graph,ready:()=>s,client:async()=>({id:'client'}),requests:async()=>[{fields:{RequestType:'Upsert Prospect',Payload:JSON.stringify({opportunityId:p.opp}),Status:'Pending'}}]};
  const reader=new WorkReader(sp);sp.workItems=(id,fresh)=>reader.items(id,fresh);
  const resolver=new SharePointQuotes(sp,graph,{LOG_LEVEL:'debug'},(_message,data)=>debug.push(data));
  const masterName={'COM-PRP':'COM-PRP-v1.8.docx','ENG-PRJ':'ENG-PRJ-v1.0.docx','BII-QSOW':'BII-QSOW-v1.7.docx'}[key];
  resolver.master=async()=>({documentKey:key,status:'Approved',name:masterName,content:await readFile('test/fixtures/'+masterName)});
  const ctx=()=>({q,p,actor,hash:snapshot(q)});
  const store={checkMailbox:async()=>{},begin:async()=>ctx(),current:async()=>ctx(),release:async()=>{},log:async()=>{},latestFill:async()=>fill,
    createFill:async(c,k,w,data,mode)=>{fill={id:1,document_key:k,drive_id:w.driveId,item_id:w.itemId,web_url:w.webUrl,snapshot_hash:c.hash,mode,report:JSON.stringify(data.report),fields_json:JSON.stringify(data.fields)};return 1;},
    filled:async(id,status,value,content)=>Object.assign(fill,{status,etag:value,ctag:content}),createAttempt:async()=>1,savedPdf:async()=>{},sending:async()=>{},sent:async()=>{q.status='Sent';},failed:async()=>{},
  };
  const delivery=new QuoteDelivery({store,resolver,graph,prices:async()=>prices,config:async()=>({}),extractText:async()=>'Approved quote without placeholders',env:{QUOTE_FILL_MODE:'live',QUOTE_SEND_MODE:'live',QUOTE_SENDER_MAILBOX:'sales@theitguys.us'}});
  return {q,p,s,row,unrelated,sp,graph,resolver,delivery,reads,events,debug};
}

for(const key of ['COM-PRP','ENG-PRJ'])test(`Graph-shaped ${key}: fill then send uses the same client/workflow/instance and verifies saved drive/item`,async()=>{
  const h=graphFixture(key);
  await h.delivery.fill(23,actor,{instanceRef:'23'});
  await h.delivery.send(23,actor);
  assert.equal(h.q.status,'Sent');assert.deepEqual(h.events,['PDF','mail']);
  assert.ok(!h.reads.some(path=>path.includes('/items/532')),'other quote instances are never scanned by drive ID');
  assert.deepEqual(h.debug.filter(d=>['workflow','client','status','instance'].includes(d.filter)).slice(0,4).map(d=>d.count),[2,2,2,1]);
  assert.ok(h.debug.some(d=>d.driveItemId==='FILE-23'&&d.savedItemId==='FILE-23'));
});

test('instance mismatch, duplicate instance and changed saved file all refuse; legacy fallback only accepts blank instance',async()=>{
  const h=graphFixture('COM-PRP');
  await assert.rejects(()=>h.resolver.working(h.p,'COM-PRP','99','FILE-23'),/exactly one/);
  await assert.rejects(()=>h.resolver.working(h.p,'COM-PRP','23','FILE-22'),/differs/);
  h.unrelated.fields.TIG_InstanceRef='23';await assert.rejects(()=>h.resolver.working(h.p,'COM-PRP','23'),/exactly one/);
  h.unrelated.fields.TIG_InstanceRef='22';h.row.fields.TIG_InstanceRef='';
  assert.equal((await h.resolver.working(h.p,'COM-PRP','23','FILE-23')).itemId,'FILE-23');
});

function psaFixture(){
  const definition={id:'BII-14',document:'Project Services Agreement',documentKey:'BII-PSA',active:true,createCopy:true,lane:'Business IT Integration'},items=[],requests=[];
  const ctx={q:{id:22},p:{id:108,opp:'OPP-0108',client_id:'CL-108'},state:{}};
  const store=new ProposalStore({sp:{ready:()=>({definitions:[definition]}),workItems:async()=>items},graph:{},deliveryStore:{}});
  store.psaRequests=async()=>requests.map(r=>r.id);store.requestStatus=async id=>requests.find(r=>r.id===id);
  store.request=async(c,action,lane,options,field)=>{assert.equal(field,null);requests.push({id:1,status:'Pending',action,options});};
  return {definition,ctx,items,requests,store};
}
test('PSA uses live BII-14/BII-PSA definition, waits for the same request and never replays uncertainty',async()=>{
  const h=psaFixture();
  assert.equal((await h.store.preparePsa(h.ctx,{})).step,'psa_requested');
  assert.deepEqual(h.requests[0].options,{workflowId:'BII-14',instanceRef:'22'});
  h.requests[0].status='Unknown';h.requests[0].waiting=true;h.requests[0].manualRequestId=1;
  assert.equal((await h.store.preparePsa(h.ctx,{})).manualRequestId,1);assert.equal(h.requests.length,1);
  h.requests[0].status='Done';h.items.push({workflowId:'BII-14',instanceRef:'22',status:'Not Started',signatureStatus:'Preparing'});
  assert.equal((await h.store.preparePsa(h.ctx,{})).done,true);assert.equal(h.requests.length,1);
});
test('signed PSA prevents another copy and missing definition gives BII-PSA configuration message',async()=>{
  const h=psaFixture();h.items.push({workflowId:'BII-14',signatureStatus:'Signed'});
  assert.equal((await h.store.preparePsa(h.ctx,{})).done,true);assert.equal(h.requests.length,0);
  const service=new QuickSend({run:async()=>[{id:22,prospect_id:108}],getProspect:async()=>h.ctx.p,sp:{ready:()=>({definitions:[]}),workItems:async()=>[]},delivery:{}});
  const docs=await service.signatureDocuments(22);assert.equal(docs.psaConfigurationMissing,true);assert.match(docs.psaMessage,/BII-PSA/);assert.match(docs.psaMessage,/Create Client Copy = Yes/);
});
test('BII ready screen exposes actual working-file links and deliberate signature dispatch',async()=>{
  const h=graphFixture('BII-QSOW');h.s.definitions.push({id:'BII-14',documentKey:'BII-PSA',document:'Project Services Agreement',lane:'Business IT Integration',active:true,createCopy:true});
  const psa={...h.row,id:'534',fields:{...h.row.fields,TIG_WorkflowID:'BII-14'},driveItem:{...h.row.driveItem,id:'PSA',webUrl:'https://example.sharepoint.com/Commercial/PSA.docx'}};
  h.graph.all=async()=>[h.row,psa];
  const service=new QuickSend({run:async()=>[h.q],getProspect:async()=>h.p,sp:h.sp,delivery:h.delivery});
  const documents=await service.signatureDocuments(23);assert.equal(documents.psaMissing,false);assert.match(documents.quote[0].url,/Quote.docx/);assert.match(documents.psa[0].url,/PSA.docx/);
  const html=await ejs.renderFile('views/quick-quote-progress.ejs',{q:h.q,p:h.p,documents,job:{status:'ReadySignature'},user:actor,csrf:'test',mode:'dryrun',canApprove:true});
  assert.match(html,/Open Quote\/SOW in SharePoint/);assert.match(html,/Open PSA in SharePoint/);assert.match(html,/I actually sent/);
});

test('Graph-shaped BII Send fills the quote, waits for its PSA request, then reaches ReadySignature with both file links',async()=>{
  const h=graphFixture('BII-QSOW'),psa=psaFixture();
  h.s.definitions.push(psa.definition);let copied=false;
  const agreement={...h.row,id:'534',fields:{...h.row.fields,TIG_WorkflowID:'BII-14'},driveItem:{...h.row.driveItem,id:'PSA',webUrl:'https://example.sharepoint.com/Commercial/PSA.docx'}};
  h.graph.all=async()=>copied?[h.row,agreement]:[h.row];
  const state={},ctx={q:h.q,p:h.p,state,hash:snapshot(h.q)},requests=[];
  const prepStore={acquire:async()=>ctx,release:async()=>{},renew:async()=>{},save:async(_c,value)=>Object.assign(state,value),validate:async()=>{},record:async()=>({id:'client'}),link:async()=>{},copy:async()=>({id:h.row.id,instanceRef:'23'}),latestFill:()=>h.delivery.store.latestFill(23),sp:h.sp,
    psaRequests:async()=>requests.map(r=>r.id),requestStatus:async()=>requests[0],request:async(_c,_a,_l,options)=>{requests.push({id:1,status:'Pending',options});},
  };
  prepStore.preparePsa=ProposalStore.prototype.preparePsa.bind(prepStore);
  const prepare=new ProposalPreparation({store:prepStore,resolver:h.resolver,delivery:h.delivery,prices:async()=>prices,env:{QUOTE_FILL_MODE:'live'}});
  const job={quote_id:23,status:'Queued',snapshot_hash:snapshot(h.q),requested_by:actor.email,options_json:{}};
  const run=async(sql,args=[])=>{
    if(sql.startsWith('SELECT * FROM quotes'))return [h.q];
    if(sql.startsWith('SELECT * FROM allowlist'))return [actor];
    if(sql.includes('FROM quote_quick_sends'))return [{...job,busy:!!job.operation_token}];
    if(sql.includes('SET operation_token=?'))job.operation_token=args[0];
    if(sql.includes('SET operation_token=NULL'))job.operation_token=null;
    const match=sql.match(/SET status='([^']+)'/);if(match)job.status=match[1];return {};
  };
  const service=new QuickSend({run,tx:async fn=>fn({}),getProspect:async()=>h.p,prepare,delivery:h.delivery,sp:h.sp});
  assert.equal((await service.advance(23)).step,'psa_requested');assert.equal(requests.length,1);
  assert.equal((await service.advance(23)).step,'psa_requested');assert.equal(requests.length,1);
  copied=true;requests[0].status='Done';
  assert.equal((await service.advance(23)).status,'ReadySignature');
  const docs=await service.signatureDocuments(23);assert.match(docs.quote[0].url,/Quote.docx/);assert.match(docs.psa[0].url,/PSA.docx/);
  assert.ok(!h.events.includes('mail'),'BII remains deliberate eSignature dispatch');
});

test('server worker advances without a browser and isolates failures between jobs',async()=>{
  const calls=[],warnings=[];let callback,period;
  const worker=startQuickSendWorker({run:async()=>[{quote_id:21},{quote_id:23}],service:{advance:async id=>{calls.push(id);if(id===21)throw new Error('Refused');}},interval:(fn,ms)=>{callback=fn;period=ms;return {unref(){}};},clear:()=>{},warn:(...args)=>warnings.push(args)});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[21,23]);assert.equal(period,30000);
  callback();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[21,23,21,23]);assert.equal(warnings.length,2);worker.stop();
});

test('preview separates entered onboarding and BII from monthly charges, formats money, hides zeros and shows operating plan',async()=>{
  const input={pricingMode:'managed_v20',onboarding:500},lines=[{label:'Monthly users',quantity:5,amount:625},{label:'Standard BII Integration',quantity:1,amount:3750,billing:'one_time'},{label:'Zero placeholder',quantity:0,amount:0}];
  const sections=previewSections(input,lines);assert.deepEqual(sections.map(s=>s.total),[625,4250]);
  const render=(input,lines,sections,job=null)=>ejs.renderFile('views/quick-quote-preview.ejs',{q:{id:23,status:'Draft',total:4375},p:{id:109,business_name:'Example'},input,lines,sections,job,preview:null,error:null,hash:'hash',stops:[{id:1,label:'Full owner-maintained assessment warning'}],canApprove:true,user:actor,csrf:'test',mode:'dryrun'});
  const html=await render(input,lines,sections);assert.match(html,/Monthly total: \$625.00 \/ month/);assert.match(html,/One-time total: \$4,250.00/);assert.match(html,/\$500.00/);assert.ok(!html.includes('Zero placeholder'));
  const bii={users:8,operatingBusiness:true,pilotGroup:'Reception',waveCount:2,waveBasis:'department',waveDates:'Oct 26, Oct 27',afterHoursWindows:'none'},regulated=[{label:'Regulated Data Package',quantity:1,amount:575}];
  const biiHtml=await render(bii,regulated,previewSections(bii,regulated));assert.match(biiHtml,/Regulated Data Package \(8 users\)/);assert.match(biiHtml,/Reception/);assert.match(biiHtml,/Oct 26, Oct 27/);
  assert.match(html,/<details><summary>Assessment warnings \(optional\)<\/summary>/);assert.match(html,/Full owner-maintained assessment warning/);assert.match(html,/client gets nothing/);assert.ok(!html.includes('preserves the requester'));
  const failed=await render(input,lines,sections,{status:'Failed',error_message:'Plain failure',quote_id:23});assert.match(failed,/Plain failure/);assert.match(failed,/>Try again<\/button>/);assert.ok(!failed.includes('data-quick-send'));
});

test('type selection has no default and BII starts at one location; required facts are listed at Preview',async()=>{
  const handlers=new Map(),p={id:108,business_name:'New client',engagement_type:'project'};
  quickQuoteRoutes({get:(path,...f)=>handlers.set(path,f),post(){}},{getProspect:async()=>p,run:async()=>[],service:{},prices:async()=>prices});
  const call=async query=>{let result;for(const fn of handlers.get('/quick-quote/opportunities/:id')){let next=false;await fn({params:{id:108},query,session:{user:actor}},{render:(view,data)=>{result={view,data};}},()=>next=true);if(!next)break;}return result;};
  assert.equal((await call({})).view,'quick-quote-type');const bii=await call({type:'bii'});assert.equal(bii.data.input.locations,1);assert.equal(bii.data.prefill.domain,'');
  assert.deepEqual(missingProposalFacts('bii',{legalName:'Name'}),['Prepared for','Backup contact','Primary location','Primary domain','Target timing','Project summary','Device types','Exceptions','Authorized signer name and title']);
});

test('onboarding guidance updates for quantity changes and never fills the entered fee',async()=>{
  const fields=Object.fromEntries(Object.entries({users:5,computers:5,servers:0,onboarding:500,onboardingFee:0,onboardingComplexity:'standard'}).map(([k,value])=>[k,{value:String(value)}])),guidance={},fee={},listeners={};
  const form={elements:{namedItem:k=>fields[k]},querySelector:s=>s==='[data-onboarding-guidance]'?guidance:s==='#approved-onboarding-fee'?fee:null,addEventListener:(event,fn)=>listeners[event]=fn};
  runInNewContext(await readFile('public/quick-quote.js','utf8'),{document:{querySelector:s=>s==='[data-quick-quote]'?form:null,getElementById:()=>null}});
  assert.match(guidance.textContent,/\$300–\$750/);assert.equal(fee.value,'$500.00');fields.servers.value='1';listeners.input();assert.match(guidance.textContent,/\$450–\$600/);assert.equal(fields.onboarding.value,'500');
});

test('failed Sends are in dashboard attention with error and quote link',async()=>{
  const rows=await waitingForJosh(async sql=>sql.includes('FROM quote_quick_sends')?[{id:109,quote_id:23,business_name:'Example',result_message:'Send failed plainly',since:'2026-10-24'}]:[]);
  assert.equal(rows.length,1);assert.equal(rows[0].href,'/quick-quote/quotes/23');assert.equal(rows[0].result_message,'Send failed plainly');
});
test('pending UpsertProspect is excluded from quote blockers while real copy requests remain blocking',async()=>{
  const s={maps:{requests:{'Request Type':{name:'Type'}}}};
  assert.equal(isProspectSync({fields:{Type:'Upsert Prospect'}},s),true);assert.equal(isProspectSync({action:'UpsertProspect'},s),true);
  const h=graphFixture('COM-PRP');await h.resolver.working(h.p,'COM-PRP','23');
  h.sp.requests=async()=>[{fields:{RequestType:'Create Working Copy',Status:'Pending',Payload:JSON.stringify({clientId:h.p.client_id,instanceRef:'23'})}}];
  await assert.rejects(()=>h.resolver.working(h.p,'COM-PRP','23'),/pending/i);
});

test('local pending prospect sync does not block proposal validation; a pending working-copy request still does',async()=>{
  const h=graphFixture('COM-PRP');h.s.maps.requests.Title={name:'Title'};
  const ctx={q:h.q,p:h.p,state:{},hash:snapshot(h.q)};let copyPending=false;
  const store=new ProposalStore({sp:h.sp,graph:h.graph,deliveryStore:{latestFill:async()=>null},run:async sql=>{
    if(sql.startsWith('SELECT id,request_json'))return [];
    if(sql.includes('FROM sp_requests'))return copyPending||!sql.includes("action<>'UpsertProspect'")?[{id:9,prospect_id:h.p.id}]:[];
    return [];
  }});
  await store.validate(ctx,{key:'COM-PRP',workflow:'MIT-05'});
  copyPending=true;await assert.rejects(()=>store.validate(ctx,{key:'COM-PRP',workflow:'MIT-05'}),/Another Workflow Request/);
});

test('an active sync blocks only another sync of its own prospect, without sending a duplicate request',async()=>{
  const old=process.env.PROSPECT_SYNC_ENABLED;process.env.PROSPECT_SYNC_ENABLED='true';
  try{
    const columns=kind=>required[kind].map((displayName,n)=>({displayName,name:displayName==='Title'?'Title':'F'+n,...(requiredChoices[kind][displayName]?{choice:{choices:requiredChoices[kind][displayName]}}:displayName==='Client'?{lookup:{}}:{text:{}})}));
    const schema=validateSchema(columns('requests'),columns('clients')),queries=[];
    const result=await dispatchProspectSync({id:109,business_name:'Example'},actor,{sp:{ready:()=>schema},graph:{createWorkflowRequest:()=>assert.fail('must not dispatch another sync')},transaction:async fn=>fn({}),audit:async()=>{},query:async(sql,args)=>{queries.push({sql,args});return sql.includes("action='UpsertProspect'")?[{id:77,status:'Pending'}]:[];}});
    assert.ok(result.ok,result.error);assert.equal(result.requestId,77);assert.equal(result.existing,true);assert.ok(queries.find(q=>q.sql.includes("action='UpsertProspect'")).sql.includes('prospect_id=?'));assert.ok(!queries.some(q=>q.sql.startsWith('INSERT')));
  }finally{if(old===undefined)delete process.env.PROSPECT_SYNC_ENABLED;else process.env.PROSPECT_SYNC_ENABLED=old;}
});
