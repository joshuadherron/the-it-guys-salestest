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
import { quoteLane } from "./policy.js";
import { servicePlan } from "../service-plan.js";
import { duplicateClients } from "../existing-client-rules.js";
import { dispatchProspectSync } from "../prospect-sync.js";
import { genericEngagement,projectLane } from "../engagement-types.js";
import { assertProjectCapability,projectDiscovery } from "../project-contract.js";
import { linkBusinessRecord,lockBusinessRequests } from "../businesses.js";
import { assertProjectApproval } from "../project-quotes.js";

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
// Preparation binds approved commercial data. Quote numbering and editable Word
// facts are checked separately by the existing, stricter fill/send snapshot.
export const proposalApprovalSnapshot = q => createHash("sha256").update(JSON.stringify([
  canonical(json(q.inputs)), canonical(json(q.line_items)), String(q.total), String(q.approved_at),
])).digest("hex");

export class ProposalStore {
  constructor({sp,graph,deliveryStore,env=process.env,run=query,tx=transaction,getProspect=prospect,getDiscovery=discovery,log=audit,sync=dispatchProspectSync}) { Object.assign(this,{sp,graph,deliveryStore,env,query:run,transaction:tx,prospect:getProspect,discoveryData:getDiscovery,audit:log,sync}); }
  async acquire(id,user) {
    return this.transaction(async c=>{
      const [initial]=await this.query("SELECT * FROM quotes WHERE id=?",[id],c);
      if(!initial)throw new Error("Quote not found.");
      const p=await this.prospect(initial.prospect_id,c); // prospect() locks when given a transaction
      const [q]=await this.query("SELECT * FROM quotes WHERE id=? FOR UPDATE",[id],c);
      const [actor]=await this.query("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[user.email],c);
      if(!canQuote(actor,"quote.send"))throw new Error("Permission quote.send is required.");
      if(q.status!=="Approved"||p.hold||p.stage==="Closed Lost")throw new Error("Save proposal requires an Approved quote and an opportunity that is not On Hold or Lost.");
      if(genericEngagement(p)) {
        const [intake]=await this.query(intakeSelect,[p.id],c);
        await assertProjectApproval(p,q,intake);
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
    if(genericEngagement(ctx.p))assertProjectCapability(s,this.env);
    if(s.workErrors?.length||s.definitionErrors?.length)throw new Error([...(s.workErrors||[]),...(s.definitionErrors||[])].join(" "));
    const definitions=s.definitions.filter(d=>d.id===lane.workflow&&d.lane===(lane.lane||(lane.key==="COM-PRP"?"Managed IT":"Business IT Integration")));
    if(definitions.length!==1||!definitions[0].active||!definitions[0].createCopy)
      throw new Error(`Set ${lane.workflow} in Client Workflow Definitions to Active = Yes and Create Client Copy = Yes. Josh must change the SharePoint row before Save can continue.`);
    // Existing successful legacy fills have their own unambiguous drive-item linkage.
    const old=await this.latestFill(ctx.q.id);
    if(!s.quoteInstanceColumn && !ctx.p.client_id && !(old?.mode==="live"&&old.status==="Succeeded"&&old.snapshot_hash===ctx.hash))
      throw new Error("Client Operations needs a verified text Instance Reference column populated by Create Working Copy. Configure QUOTE_INSTANCE_REF_COLUMN to its actual internal name and check the connection.");
    const own=[ctx.state.record_request_id,ctx.state.record_sync_request_id,ctx.state.copy_request_id].filter(Boolean);
    const active=await this.query("SELECT id FROM sp_requests WHERE (prospect_id=? OR prospect_id IN (SELECT id FROM prospects WHERE client_id=?)) AND status IN ('Preparing','Pending','Processing','Unknown')",[ctx.p.id,ctx.p.client_id||""]);
    if(active.some(r=>!own.some(id=>String(id)===String(r.id))))throw new Error("Another Workflow Request for this opportunity is active or uncertain. Reconcile it first.");
    const ownRemote=[];
    for(const id of own){const [r]=await this.query("SELECT item_id FROM sp_requests WHERE id=?",[id]);if(r?.item_id)ownRemote.push(String(r.item_id));}
    assertNoPending((await this.sp.requests()).filter(r=>!ownRemote.includes(String(r.id))),s,ctx.p);
    const operations=await this.query("SELECT client_id FROM quote_operation_locks WHERE client_id=?",[ctx.p.client_id||""]);
    if(operations.length)throw new Error("A quote fill/send is active or uncertain. Reconcile it before saving.");
  }
  async record(ctx) { return this.sp.client(ctx.p); }
  async link(ctx,row) {
    const s=this.sp.ready(),clientId=row.fields[s.maps.clients["Client ID"].name];
    if(!clientId)throw new Error("SharePoint record has no Client ID. Wait for the flow to finish.");
    const stage=row.fields[s.maps.clients["Current Stage"].name]||null;
    if(String(stage).startsWith("Closed"))throw new Error("This SharePoint engagement is closed. Josh must review it before saving a proposal.");
    const spec=quoteLane(json(ctx.q.inputs),undefined,this.env);
    const lane=spec.lane||(spec.key==="COM-PRP"?"Managed IT":"Business IT Integration");
    const configured=s.maps.clients["Service Lanes"];
    if(configured) {
      const value=row.fields[configured.name],lanes=Array.isArray(value)?value:[value];
      if(!lanes.includes(lane)&&!genericEngagement(ctx.p))throw new Error("The quote lane is not enabled on this SharePoint record. Complete the existing additional-service transition before creating its proposal copy.");
    }
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
    if(!items.length&&ctx.state.working_item_id)items=all.filter(i=>String(i.id)===String(ctx.state.working_item_id));
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
      return projectDiscovery(ctx.p,intake);
    }
    const d=await this.discoveryData(ctx.p.id);
    if(mvd(d.answers).length)throw new Error("Complete discovery before opening the SharePoint record.");
    const [capture]=await this.query("SELECT actor FROM discovery_versions WHERE prospect_id=? AND revision=?",[ctx.p.id,d.revision]);
    const [release]=await this.query("SELECT actor,notes FROM activities WHERE prospect_id=? AND type='note' AND notes LIKE 'Release hold: %' ORDER BY id DESC LIMIT 1",[ctx.p.id]);
    return discoverySnapshot(ctx.p,d,{capturedBy:capture?.actor||null,releasedBy:release?.actor||null,releaseNote:release?.notes?.slice(14)||null});
  }
  async request(ctx,action,lane,options,field) {
    if(this.env.SHAREPOINT_WRITE_MODE!=="live")throw new Error("Creating the missing SharePoint record or quote copy requires Workflow Requests live mode. Ask Josh to configure it; nothing was sent.");
    const s=this.sp.ready(); let body,id;
    await this.transaction(async c=>{
      const p=await this.prospect(ctx.p.id,c);
      if(p.business_id)await lockBusinessRequests(p,this.query,c,[ctx.state.record_request_id,ctx.state.record_sync_request_id,ctx.state.copy_request_id].filter(Boolean));
      Object.assign(ctx.p,{client_id:p.client_id,client_item_id:p.client_item_id});
      const [q]=await this.query("SELECT * FROM quotes WHERE id=? FOR UPDATE",[ctx.q.id],c);
      const [actor]=await this.query("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[ctx.actor.email],c);
      if(p.hold||p.stage==="Closed Lost"||q.status!=="Approved"||snapshot(q)!==ctx.hash||!canQuote(actor,"quote.send"))throw new Error("Approval, hold or permission changed. Reload before saving.");
      if(genericEngagement(p)) {
        const [intake]=await this.query(intakeSelect,[p.id],c);
        await assertProjectApproval(p,q,intake);
      }
      const [lease]=await this.query("SELECT operation_token,lease_until>UTC_TIMESTAMP() AS valid FROM quote_proposal_states WHERE quote_id=? FOR UPDATE",[q.id],c);
      if(lease?.operation_token!==ctx.token||!lease.valid)throw new Error("Save proposal operation expired. Resume from the progress page.");
      if(p.client_id) {
        await this.query("INSERT IGNORE INTO client_request_locks (client_id) VALUES (?)",[p.client_id],c);
        await this.query("SELECT client_id FROM client_request_locks WHERE client_id=? FOR UPDATE",[p.client_id],c);
      }
      await this.validate(ctx,lane);
      if(action==="CreateClient") {
        if(!["Qualified","Discovery","Proposal Sent","Closed Won","Technical Assessment"].includes(p.stage))throw new Error("Qualify the opportunity and complete discovery before opening its SharePoint record.");
        if(await this.sp.client(p))throw new Error("A SharePoint record just became available. Click Save again to reuse it.");
        if(duplicateClients(p,await this.sp.clients(),s).length)throw new Error("Possible existing customer found. Josh must review and link the existing record on Customer relationship before saving.");
      }
      const planned=servicePlan(p);
      const requestLane=genericEngagement(p)?projectLane:action==="CreateClient"&&p.planned_service_lanes?planned.startingLane:lane.key==="COM-PRP"?"Managed IT":"Business IT Integration";
      body=buildFields(s,action,p,requestLane,actor.email,new Date(),lookupId(actor.email),options,this.env);
      // Stable, quote-specific title supports exact reconciliation after transport uncertainty.
      body.fields[s.maps.requests.Title.name]=`SALESAPP-${p.opp}-QUOTE-${q.id}-${action}-${randomUUID()}`;
      const r=await this.query("INSERT INTO sp_requests (prospect_id,action,request_json,status) VALUES (?,?,?,'Preparing')",[p.id,action,JSON.stringify(body)],c);id=r.insertId;
      await this.query(`UPDATE quote_proposal_states SET ${field}=?,step=? WHERE quote_id=? AND operation_token=?`,[id,field==="record_request_id"?"record_requested":"copy_requested",q.id,ctx.token],c);
      await this.audit(c,actor,"prepare proposal "+action,"sp_request",id);
    });
    ctx.state[field]=id;
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
    if(!r.item_id)return {status:r.status,message:r.result_message};
    const remote=await this.sp.request(r.item_id),s=this.sp.ready();
    const status=remote.fields[s.maps.requests["Processing Status"].name],message=remote.fields[s.maps.requests["Result Message"].name]||"";
    await this.query("UPDATE sp_requests SET status=?,result_message=? WHERE id=?",[status,message,id]);
    return {status,message};
  }
}
