import { json } from "../db.js";
import { quoteLane, quoteFillMode } from "./policy.js";
import { buildManagedFill, buildBiiFill } from "./quote-fields.js";
import { assertTagset } from "./tagsets.js";
import { listTags, fillDocx } from "./fill-docx.js";
import { buildProjectFill } from "./project-fields.js";
import { genericPricing } from "../engagement-types.js";

// One bounded step per POST. The browser polls only after an explicit Save click.
// Request identities are committed before dispatch; uncertain requests are never replayed.
export class ProposalPreparation {
  constructor({store,resolver,delivery,prices,env=process.env}) { Object.assign(this,{store,resolver,delivery,prices,env}); }
  async advance(id,user) {
    const ctx=await this.store.acquire(id,user);
    try {
      if(quoteFillMode(this.env)!=="live")
        throw new Error("Save proposal requires live quote fill mode. Ask Josh to configure it; download a draft meanwhile.");
      const quote={...ctx.q,inputs:json(ctx.q.inputs),line_items:json(ctx.q.line_items)};
      const lane=quoteLane(quote.inputs,undefined,this.env),key=lane.key;
      const data=genericPricing(quote.inputs)?buildProjectFill({quote,prospect:ctx.p}):key==="COM-PRP"?buildManagedFill({quote,prospect:ctx.p,owner:json(quote.document_facts)||{}})
        :buildBiiFill({quote,prospect:ctx.p,owner:json(quote.document_facts)||{},prices:await this.prices()});
      const master=await this.resolver.master(key);
      assertTagset(key,await listTags(master.content));
      await fillDocx(master.content,data); // Includes the existing RATE and document-field checks before any request.
      await this.store.validate(ctx,lane);
      for(const [field,label,step] of [["record_request_id","SharePoint record","record_requested"],["record_sync_request_id","Sales Prospects record sync","record_ready"],["copy_request_id","Quote working copy","copy_requested"]]) {
        if(ctx.state[field] && !await this.wait(ctx,field,label))return {step,waiting:true,manualRequestId:ctx.manualRequestId||null};
      }
      const previous=await this.store.latestFill(id);
      if(previous?.status==="Succeeded" && previous.mode==="live" && previous.snapshot_hash===ctx.hash) {
        await this.resolver.working(ctx.p,key,undefined,previous.item_id);
        await this.store.save(ctx,{step:"filled",fill_id:previous.id});
        return {step:"filled",done:true};
      }
      let record=await this.store.record(ctx);
      if(!record) {
        if(ctx.state.record_request_id) {
          if(!await this.wait(ctx,"record_request_id","SharePoint record")) return {step:"record_requested",waiting:true};
          record=await this.store.record(ctx);
          if(!record) return {step:"record_requested",waiting:true};
        } else {
          await this.store.request(ctx,"CreateClient",lane,{discovery:await this.store.discovery(ctx)},"record_request_id");
          return {step:"record_requested",waiting:true};
        }
      }
      await this.store.link(ctx,record);
      await this.store.save(ctx,{step:"record_ready"});
      if(ctx.state.record_sync_request_id && !await this.wait(ctx,"record_sync_request_id","Sales Prospects record sync"))return {step:"record_ready",waiting:true};
      let copy=await this.store.copy(ctx,lane);
      if(!copy) {
        if(ctx.state.copy_request_id) {
          if(!await this.wait(ctx,"copy_request_id","Quote working copy")) return {step:"copy_requested",waiting:true};
          copy=await this.store.copy(ctx,lane);
          if(!copy) return {step:"copy_requested",waiting:true};
        } else {
          await this.store.request(ctx,"CreateWorkingCopy",lane,{workflowId:lane.workflow,instanceRef:String(id)},"copy_request_id");
          return {step:"copy_requested",waiting:true};
        }
      }
      await this.store.save(ctx,{step:"copy_ready",working_item_id:copy.id});
      await this.store.renew(ctx);
      const result=await this.delivery.fill(id,user,{instanceRef:copy.instanceRef?String(id):undefined});
      const fill=await this.store.latestFill(id);
      await this.store.save(ctx,{step:"filled",fill_id:fill.id});
      return {step:"filled",done:true,...result};
    } catch(e) {
      await this.store.save(ctx,{error_message:e.message});
      throw Object.assign(e,{status:e.status||409});
    } finally { await this.store.release(ctx); }
  }
  async wait(ctx,field,label) {
    const r=await this.store.requestStatus(ctx.state[field]);
    if(r.waiting){ctx.manualRequestId=r.manualRequestId||null;return false;}
    if(r.status==="Done") return true;
    if(["Rejected","Failed"].includes(r.status)) {
      await this.store.save(ctx,{[field]:null});
      throw new Error(`${label} request was ${r.status}: ${r.message || "No reason supplied by the flow"}. Fix the prospect details or workflow definition and click Save again. Existing records and copies will be checked before retrying.`);
    }
    if(["Unknown","Preparing"].includes(r.status))
      throw new Error(`${label} request needs reconciliation: ${r.message || r.status}. Josh must reconcile the existing request on SharePoint actions & history before retrying.`);
    return false;
  }
}
