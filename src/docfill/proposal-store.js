import { intakeSelect } from "../engagement-intake.js";
import { randomUUID, createHash } from "node:crypto";
import { query,transaction,audit,json } from "../db.js";
import { prospect } from "../pipeline.js";
import { discovery } from "../discovery.js";
import { discoverySnapshot } from "../discovery-export.js";
import { mvd } from "../discovery-rules.js";
import { canQuote } from "../quote-permissions.js";
import { buildFields,assertNoPending,submitRequest } from "../sharepoint.js";
import { lookupId } from "../sharepoint-runtime.js";
import { snapshot } from "./delivery-store.js";
import { servicePlan } from "../service-plan.js";
import { duplicateClients } from "../existing-client-rules.js";
import { dispatchProspectSync } from "../prospect-sync.js";
import { genericEngagement,projectLane } from "../engagement-types.js";
import { assertProjectCapability,projectDiscovery } from "../project-contract.js";
import { linkBusinessRecord,lockBusinessRequests } from "../businesses.js";
import { assertProjectApproval } from "../project-quotes.js";
import { requestMatchesQuote,isProspectSync } from "../quote-request-scope.js";
import { psaDefinition,psaItems,signedPsa } from '../bii-psa.js';
import { COPY_TIMEOUT_MESSAGE,missingCopy,utcTime } from './copy-visibility.js';

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
// Preparation binds approved commercial data. Quote numbering and editable Word
// facts are checked separately by the existing, stricter fill/send snapshot.
export const proposalApprovalSnapshot = q => createHash("sha256").update(JSON.stringify([
  canonical(json(q.inputs)), canonical(json(q.line_items)), String(q.total), String(q.approved_at),
])).digest("hex");

export class ProposalStore {
  constructor({sp,graph,deliveryStore,env=process.env,run=query,tx=transaction,getProspect=prospect,getDiscovery=discovery,log=audit,sync=dispatchProspectSync,clock=()=>Date.now()}) { Object.assign(this,{sp,graph,deliveryStore,env,query:run,transaction:tx,prospect:getProspect,discoveryData:getDiscovery,audit:log,sync,clock}); }
  async acquire(id,user) {
    return this.transaction(async c=>{
      const [initial]=await this.query("SELECT * FROM quotes WHERE id=?",[id],c);
      if(!initial)throw new Error("Quote not found.");
      const p=await this.prospect(initial.prospect_id,c); // prospect() locks when given a transaction
      const [q]=await this.query("SELECT * FROM quotes WHERE id=? FOR UPDATE",[id],c);
      const [actor]=await this.query("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[user.email],c);
      if(!canQuote(actor,"quote.send"))throw new Error("Permission quote.send is required.");
      if(q.status!=="Approved"||p.hold||p.stage==="Closed Lost"||p.status==="Lost")throw new Error("Save proposal requires an Approved quote and an opportunity that is not On Hold or Lost.");
      if(genericEngagement(p)) {
        await assertProjectApproval(p,q);
      }
      const hash=snapshot(q);
      const approvalHash=proposalApprovalSnapshot(q);
      await this.query("INSERT IGNORE INTO quote_proposal_states (quote_id,snapshot_hash) VALUES (?,?)",[id,approvalHash],c);
      const [state]=await this.query("SELECT *,lease_until>UTC_TIMESTAMP() AS busy FROM quote_proposal_states WHERE quote_id=? FOR UPDATE",[id],c);
      if(state.operation_token&&state.busy)throw new Error("A Save proposal operation is already active. Wait for its progress.");
      if(state.snapshot_hash!==approvalHash) {
        const legacyHash=snapshot({...q,document_facts:null});
        let safe=state.snapshot_hash===legacyHash;
        if(!safe && ["record_requested","record_ready"].includes(state.step) &&
          ![state.record_request_id,state.record_sync_request_id,state.copy_request_id,state.working_item_id,state.fill_id].some(Boolean)) {
          const fills=await this.query("SELECT id FROM quote_fills WHERE quote_id=? LIMIT 1",[id],c);
          const sends=await this.query("SELECT id FROM quote_send_attempts WHERE quote_id=? LIMIT 1",[id],c);
          const operations=p.client_id ? await this.query("SELECT client_id FROM quote_operation_locks WHERE client_id=?",[p.client_id],c) : [];
          safe=!fills.length&&!sends.length&&!operations.length;
        }
        if(!safe)throw Object.assign(new Error("The approved pricing snapshot differs from an existing proposal operation. Approve a revised quote with a new Quote ID or ask Josh to reconcile the existing operation."),{status:409});
        await this.query("UPDATE quote_proposal_states SET snapshot_hash=? WHERE quote_id=?",[approvalHash,id],c);
        await this.audit(c,actor,"refresh proposal approval baseline","quote",id);
        state.snapshot_hash=approvalHash;
      }
      const token=randomUUID();
      await this.query("UPDATE quote_proposal_states SET operation_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 120 SECOND),error_message=NULL WHERE quote_id=?",[token,id],c);
      return {q,p,actor,hash,state,token};
    });
  }
  latestFill(id) { return this.deliveryStore.latestFill(id); }
  async save(ctx,values) {
    const allowed=["step","record_request_id","record_sync_request_id","copy_request_id","working_item_id","fill_id","error_message"];
    const keys=Object.keys(values);
    if(keys.some(k=>!allowed.includes(k)))throw new Error("Invalid proposal state field.");
    await this.query(`UPDATE quote_proposal_states SET ${keys.map(k=>k+"=?").join(",")} WHERE quote_id=? AND operation_token=?`,[...keys.map(k=>values[k]),ctx.q.id,ctx.token]);
    Object.assign(ctx.state,values);
  }
  async release(ctx) { await this.query("UPDATE quote_proposal_states SET operation_token=NULL,lease_until=NULL WHERE quote_id=? AND operation_token=?",[ctx.q.id,ctx.token]); }
  async renew(ctx) {
    const result=await this.query("UPDATE quote_proposal_states SET lease_until=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 120 SECOND) WHERE quote_id=? AND operation_token=? AND lease_until>UTC_TIMESTAMP()",[ctx.q.id,ctx.token]);
    if(!result.affectedRows)throw new Error("Save proposal operation expired. Resume from the progress page.");
  }
  async validate(ctx,lane) {
    const s=this.sp.ready();
    if(genericEngagement(ctx.p))assertProjectCapability(s);
    if(s.workErrors?.length||s.definitionErrors?.length)throw new Error([...(s.workErrors||[]),...(s.definitionErrors||[])].join(" "));
    const definitions=s.definitions.filter(d=>d.id===lane.workflow&&d.lane===(lane.lane||(lane.key==="COM-PRP"?"Managed IT":"Business IT Integration")));
    if(definitions.length!==1||!definitions[0].active||!definitions[0].createCopy)
      throw new Error(`Set ${lane.workflow} in Client Workflow Definitions to Active = Yes and Create Client Copy = Yes. Josh must change the SharePoint row before Save can continue.`);
    // Existing successful legacy fills have their own unambiguous drive-item linkage.
    const old=await this.latestFill(ctx.q.id);
    if(!s.quoteInstanceColumn && !ctx.p.client_id && !(old?.mode==="live"&&old.status==="Succeeded"&&old.snapshot_hash===ctx.hash))
      throw new Error("Client Operations needs a verified text Instance Reference column populated by Create Working Copy. Configure QUOTE_INSTANCE_REF_COLUMN to its actual internal name and check the connection.");
    const own=[ctx.state.record_request_id,ctx.state.record_sync_request_id,ctx.state.copy_request_id,...await this.psaRequests(ctx)].filter(Boolean);
    const clientId=String(ctx.p.client_id||"").trim();
    const active=clientId?await this.query("SELECT id,prospect_id,request_json FROM sp_requests WHERE (prospect_id=? OR prospect_id IN (SELECT id FROM prospects WHERE client_id=?)) AND action<>'UpsertProspect' AND status IN ('Preparing','Pending','Processing','Unknown')",[ctx.p.id,clientId])
      :await this.query("SELECT id,prospect_id,request_json FROM sp_requests WHERE prospect_id=? AND action<>'UpsertProspect' AND status IN ('Preparing','Pending','Processing','Unknown')",[ctx.p.id]);
    const relevant=active.filter(r=>!isProspectSync(r,s)&&(String(r.prospect_id)===String(ctx.p.id)||!r.prospect_id||this.sameInstance(r.request_json,s,ctx)));
    if(relevant.some(r=>!own.some(id=>String(id)===String(r.id))))throw new Error("Another Workflow Request for this opportunity is active or uncertain. Reconcile it first.");
    const ownRemote=[];
    for(const id of own){const [r]=await this.query("SELECT item_id FROM sp_requests WHERE id=?",[id]);if(r?.item_id)ownRemote.push(String(r.item_id));}
    assertNoPending((await this.sp.requests()).filter(r=>!isProspectSync(r,s)&&!ownRemote.includes(String(r.id))&&(this.sameInstance({fields:r.fields},s,ctx)||this.requestOpportunity(r.fields,s)===ctx.p.opp)),s,ctx.p);
    const operations=clientId?await this.query("SELECT client_id FROM quote_operation_locks WHERE client_id=?",[clientId]):[];
    if(operations.length)throw new Error("A quote fill/send is active or uncertain. Reconcile it before saving.");
  }
  requestOpportunity(fields,s){try{return JSON.parse(fields?.[s.maps.requests.Payload.name]||"{}").opportunityId;}catch{return null;}}
  sameInstance(raw,_schema,ctx){
    return requestMatchesQuote(raw,ctx.p,ctx.q.id,ctx.state.working_item_id);
  }
  async psaRequests(ctx){
    const rows=await this.query("SELECT id,request_json FROM sp_requests WHERE prospect_id=? AND action='CreateWorkingCopy' AND (status NOT IN ('Failed','Rejected') OR acknowledged_at IS NULL) ORDER BY id DESC",[ctx.p.id]);
    const title=this.sp.ready().maps.requests.Title.name;
    return rows.filter(r=>String(json(r.request_json)?.fields?.[title]||'').startsWith(`SALESAPP-${ctx.p.opp}-QUOTE-${ctx.q.id}-PSA-`)).map(r=>r.id);
  }
  async preparePsa(ctx,lane){
    const definition=psaDefinition(this.sp.ready().definitions||[]);
    if(!definition)return {done:true}; // Explicit missing-configuration message in signature UI.
    const items=psaItems(await this.sp.workItems(ctx.p.client_id,true),definition);
    if(signedPsa(items))return {done:true};
    const open=items.filter(i=>!['Complete','Cancelled','Not Required'].includes(i.status));
    if(open.length>1)throw new Error('Multiple unsigned PSA copies exist. Reconcile them before signature delivery.');
    const [requestId]=await this.psaRequests(ctx);
    if(requestId){
      const r=await this.requestStatus(requestId);
      if(['Failed','Rejected'].includes(r.status))throw new Error('PSA request '+r.status+': '+(r.message||'Check request history.'));
      if(r.status!=='Done')return {step:'psa_requested',waiting:true,manualRequestId:r.manualRequestId||null};
      if(!open.some(i=>String(i.instanceRef)===String(ctx.q.id)))return this.waitForCopy(ctx,requestId,'psa_waiting');
    }
    if(open.length)return {done:true};
    await this.request(ctx,'CreateWorkingCopy',lane,{workflowId:definition.id,instanceRef:String(ctx.q.id)},null);
    return {step:'psa_requested',waiting:true};
  }
  async waitForCopy(ctx,requestId=ctx.state.copy_request_id,step='copy_waiting'){
    if(!requestId)throw missingCopy();
    const result=await this.requestStatus(requestId);
    if(['Failed','Rejected'].includes(result.status))throw new Error('Working copy request '+result.status+': '+(result.message||'Check request history.'));
    if(result.status==='Done'){
      const done=utcTime(result.doneAt);
      if(!Number.isFinite(done))throw new Error('Copy completion time is unavailable. Check the saved request history.');
      if(this.clock()-done>=10*60*1000)throw Object.assign(new Error(COPY_TIMEOUT_MESSAGE),{code:'QUOTE_COPY_TIMEOUT',status:409});
    }
    return {step,waiting:true,message:'Waiting for SharePoint to finish the copy…',manualRequestId:result.manualRequestId||null};
  }
  async doneTime(request,remote){
    if(request.done_at)return request.done_at;
    const modified=remote?.lastModifiedDateTime||remote?.fields?.Modified;
    const observed=modified&&Number.isFinite(utcTime(modified))?utcTime(modified):this.clock();
    const doneAt=new Date(observed).toISOString().slice(0,19).replace('T',' ');
    await this.query('UPDATE sp_requests SET done_at=COALESCE(done_at,?) WHERE id=?',[doneAt,request.id]);
    return doneAt;
  }
  async record(ctx) { return this.sp.client(ctx.p); }
  async link(ctx,row) {
    const s=this.sp.ready(),clientId=row.fields[s.maps.clients["Client ID"].name];
    if(!clientId)throw new Error("SharePoint record has no Client ID. Wait for the flow to finish.");
    const stage=row.fields[s.maps.clients["Current Stage"].name]||null;
    if(String(stage).startsWith("Closed"))throw new Error("This SharePoint engagement is closed. Josh must review it before saving a proposal.");
    // A sales copy does not enroll this business in the quoted service lane.
    // Acceptance/activation paths still enforce service readiness.
    const changed=ctx.p.client_id!==clientId||ctx.p.sharepoint_record_id!==clientId||String(ctx.p.client_item_id)!==String(row.id);
    if(changed)await this.transaction(async c=>{
      await this.query("UPDATE prospects SET client_id=?,sharepoint_record_id=?,client_item_id=? WHERE id=?",[clientId,clientId,row.id,ctx.p.id],c);
      await linkBusinessRecord(ctx.p,clientId,row.id,c,this.query);
      await this.audit(c,ctx.actor,"link SharePoint opportunity record","prospect",ctx.p.id);
    });
    Object.assign(ctx.p,{client_id:clientId,sharepoint_record_id:clientId,client_item_id:row.id});
    if(changed) {
      const result=await this.sync(ctx.p,ctx.actor);
      if(result?.requestId)await this.save(ctx,{record_sync_request_id:result.requestId});
    }
  }
  async copy(ctx,lane) {
    const all=(await this.sp.workItems(ctx.p.client_id,true)).filter(i=>i.workflowId===lane.workflow);
    let items=all.filter(i=>String(i.instanceRef)===String(ctx.q.id));
    if(!items.length&&ctx.state.working_item_id&&!ctx.state.copy_request_id)items=all.filter(i=>!i.instanceRef&&String(i.id)===String(ctx.state.working_item_id));
    if(!items.length&&!ctx.state.copy_request_id&&!genericEngagement(ctx.p)) {
      const legacy=all.filter(i=>!i.instanceRef&&!["Complete","Cancelled","Not Required"].includes(i.status));
      const claims=await this.query("SELECT working_item_id FROM quote_proposal_states WHERE working_item_id IS NOT NULL AND quote_id<>?",[ctx.q.id]);
      const fills=await this.query("SELECT item_id FROM quote_fills WHERE client_id=? AND quote_id<>? AND status='Succeeded'",[ctx.p.client_id,ctx.q.id]);
      if(legacy.length===1&&!claims.some(c=>String(c.working_item_id)===String(legacy[0].id))&&!fills.length)items=legacy;
    }
    if(!items.length&&!this.sp.ready().quoteInstanceColumn)throw new Error("A new quote copy needs a verified Instance Reference text column populated by the flow. Configure QUOTE_INSTANCE_REF_COLUMN and check the connection.");
    if(items.length>1)throw new Error("Duplicate quote instance references exist. Josh must reconcile them in SharePoint.");
    if(items[0]&&["Complete","Cancelled","Not Required"].includes(items[0].status))throw new Error("This proposal copy is closed. Approve a revised quote with a new Quote ID.");
    return items[0];
  }
  async discovery(ctx) {
    if(genericEngagement(ctx.p)) {
      const [intake]=await this.query(intakeSelect,[ctx.p.id]);
      return projectDiscovery(ctx.p,intake,ctx.q);
    }
    const d=await this.discoveryData(ctx.p.id);
    const [capture]=await this.query("SELECT actor FROM discovery_versions WHERE prospect_id=? AND revision=?",[ctx.p.id,d.revision]);
    const [release]=await this.query("SELECT actor,notes FROM activities WHERE prospect_id=? AND type='note' AND notes LIKE 'Release hold: %' ORDER BY id DESC LIMIT 1",[ctx.p.id]);
    return {...discoverySnapshot(ctx.p,d,{capturedBy:capture?.actor||null,releasedBy:release?.actor||null,releaseNote:release?.notes?.slice(14)||null}),discoveryComplete:d.status==="Ready for Review"&&mvd(d.answers).length===0};
  }
  async request(ctx,action,lane,options,field) {
    if(this.env.SHAREPOINT_WRITE_MODE!=="live")throw new Error("Creating the missing SharePoint record or quote copy requires Workflow Requests live mode. Ask Josh to configure it; nothing was sent.");
    const s=this.sp.ready(); let body,id;
    await this.transaction(async c=>{
      const p=await this.prospect(ctx.p.id,c);
      if(p.business_id)await lockBusinessRequests(p,this.query,c,[ctx.state.record_request_id,ctx.state.record_sync_request_id,ctx.state.copy_request_id].filter(Boolean),ctx.q.id);
      Object.assign(ctx.p,{client_id:p.client_id,client_item_id:p.client_item_id});
      const [q]=await this.query("SELECT * FROM quotes WHERE id=? FOR UPDATE",[ctx.q.id],c);
      const [actor]=await this.query("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[ctx.actor.email],c);
      if(p.hold||p.stage==="Closed Lost"||p.status==="Lost"||q.status!=="Approved"||snapshot(q)!==ctx.hash||!canQuote(actor,"quote.send"))throw new Error("Approval, hold or permission changed. Reload before saving.");
      if(genericEngagement(p)) {
        await assertProjectApproval(p,q);
      }
      const [lease]=await this.query("SELECT operation_token,lease_until>UTC_TIMESTAMP() AS valid FROM quote_proposal_states WHERE quote_id=? FOR UPDATE",[q.id],c);
      if(lease?.operation_token!==ctx.token||!lease.valid)throw new Error("Save proposal operation expired. Resume from the progress page.");
      if(p.client_id) {
        await this.query("INSERT IGNORE INTO client_request_locks (client_id) VALUES (?)",[p.client_id],c);
        await this.query("SELECT client_id FROM client_request_locks WHERE client_id=? FOR UPDATE",[p.client_id],c);
      }
      if(field===null){
        const definition=psaDefinition(s.definitions||[]);
        if(!definition||definition.id!==options.workflowId)throw new Error('The active BII-PSA workflow definition changed. Review before trying again.');
        const copies=psaItems(await this.sp.workItems(p.client_id,true),definition);
        if(signedPsa(copies)||copies.some(i=>!['Complete','Cancelled','Not Required'].includes(i.status)))return;
        const pending=await this.query("SELECT r.request_json FROM sp_requests r JOIN prospects p ON p.id=r.prospect_id WHERE p.client_id=? AND r.action='CreateWorkingCopy' AND r.status IN ('Preparing','Pending','Processing','Unknown') FOR UPDATE",[p.client_id],c);
        if(pending.some(r=>json(json(r.request_json)?.fields?.[s.maps.requests.Payload.name])?.workflowId===definition.id))throw new Error('A PSA copy request for this business is already active or uncertain. Wait for it or reconcile request history; no duplicate was created.');
      }
      await this.validate(ctx,lane);
      if(action==="CreateClient") {

        if(await this.sp.client(p))throw new Error("A SharePoint record just became available. Click Save again to reuse it.");
        if(duplicateClients(p,await this.sp.clients(),s).length)throw new Error("Possible existing customer found. Josh must review and link the existing record on Customer relationship before saving.");
      }
      const planned=servicePlan(p);
      const requestLane=genericEngagement(p)?projectLane:action==="CreateClient"&&p.planned_service_lanes?planned.startingLane:lane.key==="COM-PRP"?"Managed IT":"Business IT Integration";
      body=buildFields(s,action,p,requestLane,actor.email,new Date(),lookupId(actor.email),options,this.env);
      // Stable, quote-specific title supports exact reconciliation after transport uncertainty.
      body.fields[s.maps.requests.Title.name]=`SALESAPP-${p.opp}-QUOTE-${q.id}-${field===null?'PSA-':''}${action}-${randomUUID()}`;
      const r=await this.query("INSERT INTO sp_requests (prospect_id,action,request_json,status) VALUES (?,?,?,'Preparing')",[p.id,action,JSON.stringify(body)],c);id=r.insertId;
      if(field)await this.query(`UPDATE quote_proposal_states SET ${field}=?,step=? WHERE quote_id=? AND operation_token=?`,[id,field==="record_request_id"?"record_requested":"copy_requested",q.id,ctx.token],c);
      await this.audit(c,actor,"prepare proposal "+action,"sp_request",id);
    });
    if(!body)return;
    if(field)ctx.state[field]=id;
    try {
      const result=await submitRequest(this.graph,this.env.SHAREPOINT_WRITE_MODE,s,body);
      await this.query("UPDATE sp_requests SET status=?,item_id=? WHERE id=?",[result.status,result.itemId,id]);
    } catch(e) {
      await this.query("UPDATE sp_requests SET status='Unknown',result_message=? WHERE id=?",["Delivery uncertain. Reconcile the exact request title before retrying. "+e.message,id]);
      throw new Error("Proposal request delivery is uncertain. Reconcile it on SharePoint actions & history before retrying.");
    }
  }
  async requestStatus(id) {
    const [r]=await this.query("SELECT * FROM sp_requests WHERE id=?",[id]);
    if(!r)throw new Error("Proposal request history is missing. Ask Josh to reconcile it.");
    if(!r.item_id){
      if(["Unknown","Preparing"].includes(r.status)){
        const created=typeof r.created_at==="string"&&/^\d{4}-\d{2}-\d{2} /.test(r.created_at)?r.created_at.replace(" ","T")+"Z":r.created_at;
        const age=(Date.now()-new Date(created).getTime())/1000;
        if(age>=120){
          const title=json(r.request_json).fields[this.sp.ready().maps.requests.Title.name];
          if(!title)throw new Error("Saved request title is missing. Ask Josh to reconcile this request.");
          const s=this.sp.ready(),matches=(await this.sp.requests(false)).filter(item=>item.fields[s.maps.requests.Title.name]===title);
          if(matches.length>1)throw new Error("Multiple requests have this exact title. Josh must reconcile them in SharePoint.");
          if(matches.length){
            const item=matches[0],status=item.fields[s.maps.requests["Processing Status"].name],message=item.fields[s.maps.requests["Result Message"].name]||"";
            await this.query("UPDATE sp_requests SET item_id=?,status=?,result_message=? WHERE id=?",[item.id,status,message,id]);
            await this.audit(undefined,{email:"system"},"auto reconcile exact request title","sp_request",id);
            return {status,message,...(status==='Done'?{doneAt:await this.doneTime(r,item)}:{})};
          }
          return {status:r.status,message:r.result_message,waiting:true,manualRequestId:age>=600?id:null};
        }
        return {status:r.status,message:r.result_message,waiting:true};
      }
      return {status:r.status,message:r.result_message,...(r.status==='Done'?{doneAt:await this.doneTime(r)}:{})};
    }
    const remote=await this.sp.request(r.item_id),s=this.sp.ready();
    const status=remote.fields[s.maps.requests["Processing Status"].name],message=remote.fields[s.maps.requests["Result Message"].name]||"";
    await this.query("UPDATE sp_requests SET status=?,result_message=? WHERE id=?",[status,message,id]);
    return {status,message,...(status==='Done'?{doneAt:await this.doneTime(r,remote)}:{})};
  }
}
