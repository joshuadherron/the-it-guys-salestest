import { randomUUID } from "node:crypto";
import { query,transaction,audit,json } from "./db.js";
import { prospect } from "./pipeline.js";
import { canQuote } from "./quote-permissions.js";
import { fail } from "./security.js";
import { snapshot } from "./docfill/delivery-store.js";
import { combinedManagedQuote,priceConfig } from "./quotes.js";
import { priceQuote } from "./pricing.js";
import { priceProject } from "./project-pricing.js";
import { assertBiiApprovalInputs } from "./bii-options.js";
import { genericPricing } from "./engagement-types.js";
import { quoteLane } from "./docfill/policy.js";

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export function quickCalculation(input,prices){
  if(genericPricing(input))return priceProject(input);
  if(input.pricingMode==="managed_v20")return combinedManagedQuote(input,prices);
  assertBiiApprovalInputs(input);return priceQuote(input,prices);
}
export const mayApprove=user=>user?.role==="owner"||canQuote(user,"quote.approve");
const eligible=(p,actor)=>{
  if(!canQuote(actor,"quote.send"))fail("Send permission is required. Ask an administrator to enable quote.send.",403);
  if(p.hold)fail("This opportunity is on security hold. Ask Josh to resolve the hold before sending; draft and preview remain available.",409);
  if(p.stage==="Closed Lost"||p.status==="Lost")fail("Reopen the lost opportunity before sending a quote.",409);
};
export class QuickSend {
  constructor({run=query,tx=transaction,log=audit,getProspect=prospect,prices=priceConfig,prepare,delivery,sp,env=process.env,now=()=>new Date()}={}){
    Object.assign(this,{run,tx,log,getProspect,prices,prepare,delivery,sp,env,now});
  }
  async state(id){return (await this.run("SELECT * FROM quote_quick_sends WHERE quote_id=?",[id]))[0];}
  async start(id,user,hash,options={}){
    return this.tx(async c=>{
      const [initial]=await this.run("SELECT * FROM quotes WHERE id=?",[id],c);if(!initial)fail("Quote not found.",404);
      const p=await this.getProspect(initial.prospect_id,c);
      let [q]=await this.run("SELECT * FROM quotes WHERE id=? FOR UPDATE",[id],c);
      const [actor]=await this.run("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[user.email],c);eligible(p,actor);
      const [job]=await this.run("SELECT * FROM quote_quick_sends WHERE quote_id=? FOR UPDATE",[id],c);
      if(job&&job.status!=="WaitingApproval"){
        if(job.snapshot_hash!==snapshot(q))fail("This quote changed after Send. Create and review a revised quote before sending again.",409);
        return job;
      }
      if(q.status==="Sent")fail("This quote has already been sent. Create a new draft revision for changes.",409);
      if(hash!==snapshot(q))fail("The quote changed after preview. Open Preview again before sending.",409);
      if(job&&job.snapshot_hash!==snapshot(q))fail("The quote changed while waiting for approval. Preview and request approval for a revised quote.",409);
      const input={...json(q.inputs),confirmed:true},calculation=quickCalculation(input,await this.prices(c));
      if(calculation.pending.length)fail("Review pricing: "+calculation.pending.join("; "),409);
      if(Math.abs(Number(q.total)-calculation.total)>.005||JSON.stringify(canonical(json(q.line_items)))!==JSON.stringify(canonical(calculation.lines)))
        fail("Saved pricing differs from current prices. Save a revised draft and preview it before sending.",409);
      // Josh approves the exact requested selections; incoming fields cannot replace them.
      const settings=job?json(job.options_json):{...options};
      const approved=mayApprove(actor);
      if(approved&&q.status==="Draft"){
        const stops=await this.run("SELECT * FROM config_stop_conditions ORDER BY id",[],c);
        const review=stops.map(s=>({id:s.id,label:s.label,status:s.status,selected:settings["stop_"+s.id]==="yes",acknowledged:settings["stop_"+s.id]==="yes"}));
        await this.run("UPDATE quotes SET status='Approved',approved_by=?,approved_at=UTC_TIMESTAMP(),stop_review=?,inputs=? WHERE id=?",[actor.email,JSON.stringify(review),JSON.stringify(input),id],c);
        await this.log(c,actor,"approve and send quote","quote",id);
        [q]=await this.run("SELECT * FROM quotes WHERE id=?",[id],c);
      }else if(approved&&Object.keys(settings).some(key=>/^stop_\d+$/.test(key)&&settings[key]==="yes")){
        const stops=await this.run("SELECT * FROM config_stop_conditions ORDER BY id",[],c),prior=json(q.stop_review)||[];
        const review=stops.map(s=>({id:s.id,label:s.label,status:s.status,selected:settings["stop_"+s.id]==="yes"||prior.some?.(v=>v.id===s.id&&v.selected)||false,acknowledged:settings["stop_"+s.id]==="yes"||prior.some?.(v=>v.id===s.id&&v.acknowledged)||false}));
        await this.run("UPDATE quotes SET stop_review=? WHERE id=?",[JSON.stringify(review),id],c);
        await this.log(c,actor,"acknowledge findings for quote send","quote",id);
      }
      const status=approved?"Queued":"WaitingApproval";
      await this.run("INSERT INTO quote_quick_sends (quote_id,status,snapshot_hash,requested_by,options_json) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),snapshot_hash=VALUES(snapshot_hash),requested_by=VALUES(requested_by),options_json=VALUES(options_json),error_message=NULL",[id,status,snapshot(q),actor.email,JSON.stringify(settings)],c);
      await this.log(c,actor,approved?"queue quote send":"request Josh quote approval","quote",id);
      return {quote_id:id,status};
    });
  }
  async advance(id,viewer){
    if(!canQuote(viewer,"quote.send"))fail("Send permission is required.",403);
    const claim=await this.tx(async c=>{
      const [job]=await this.run("SELECT *,lease_until>UTC_TIMESTAMP() AS busy FROM quote_quick_sends WHERE quote_id=? FOR UPDATE",[id],c);
      if(!job)fail("Preview this quote and click Send first.",409);
      if(["Sending","Failed"].includes(job.status)&&!job.busy){
        const [sentQuote]=await this.run("SELECT * FROM quotes WHERE id=?",[id],c);
        if(sentQuote?.status==="Sent"&&snapshot(sentQuote)===job.snapshot_hash){
          await this.run("UPDATE quote_quick_sends SET status='Sent',operation_token=NULL,lease_until=NULL WHERE quote_id=?",[id],c);
          return {job:{...job,status:"Sent"}};
        }
      }
      if(["WaitingApproval","Sent","Dryrun","ReadySignature","Failed"].includes(job.status)||job.busy)return {job};
      if(job.status==="Sending"){
        fail("Email delivery was interrupted or is uncertain. Ask an administrator to reconcile Commercial and Sent Items; no email was replayed.",409);
      }
      const token=randomUUID();
      await this.run("UPDATE quote_quick_sends SET operation_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE) WHERE quote_id=?",[token,id],c);
      return {job,token};
    });
    if(!claim.token)return this.progress(claim.job);
    const {job,token}=claim;
    try{
      const [q]=await this.run("SELECT * FROM quotes WHERE id=?",[id]);
      const p=await this.getProspect(q.prospect_id);
      const [actor]=await this.run("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[job.requested_by]);eligible(p,actor);
      if(q.status!=="Approved"||snapshot(q)!==job.snapshot_hash)fail("Approval or saved quote changed. Preview and approve a revised quote before sending.",409);
      const key=quoteLane(json(q.inputs),undefined,this.env).key;
      if(job.status!=="Prepared"){
        const result=await this.prepare.advance(id,actor);
        if(!result.done)return {...this.progress(job),step:result.step,manualRequestId:result.manualRequestId||null};
        if(key==="BII-QSOW"){
          await this.run("UPDATE quote_quick_sends SET status='ReadySignature',error_message=NULL WHERE quote_id=? AND operation_token=?",[id,token]);
          return this.progress({...job,status:"ReadySignature"});
        }
        await this.run("UPDATE quote_quick_sends SET status='Prepared' WHERE quote_id=? AND operation_token=?",[id,token]);
        return {...this.progress({...job,status:"Prepared"}),step:"filled"};
      }
      // Persist intent BEFORE delivery. A process crash cannot silently replay an email.
      await this.run("UPDATE quote_quick_sends SET status='Sending' WHERE quote_id=? AND operation_token=?",[id,token]);
      const sent=await this.delivery.send(id,actor,json(job.options_json));
      const status=sent.mode==="live"?"Sent":"Dryrun";
      await this.run("UPDATE quote_quick_sends SET status=?,error_message=NULL WHERE quote_id=? AND operation_token=?",[status,id,token]);
      return this.progress({...job,status});
    }catch(error){
      await this.run("UPDATE quote_quick_sends SET status='Failed',error_message=? WHERE quote_id=? AND operation_token=?",[error.message,id,token]);
      throw Object.assign(error,{status:error.status&&error.status<500?error.status:409});
    }finally{
      await this.run("UPDATE quote_quick_sends SET operation_token=NULL,lease_until=NULL WHERE quote_id=? AND operation_token=?",[id,token]);
    }
  }
  progress(job){return {status:job.status,done:["Sent","Dryrun","ReadySignature"].includes(job.status),waitingApproval:job.status==="WaitingApproval",error:job.error_message||null};}
  async resume(id,user){
    await this.tx(async c=>{
      const [q]=await this.run("SELECT * FROM quotes WHERE id=? FOR UPDATE",[id],c);if(!q)fail("Quote not found.",404);
      const [actor]=await this.run("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[user.email],c),p=await this.getProspect(q.prospect_id,c);eligible(p,actor);
      const [job]=await this.run("SELECT * FROM quote_quick_sends WHERE quote_id=? FOR UPDATE",[id],c);
      const attempts=await this.run("SELECT id FROM quote_send_attempts WHERE quote_id=?",[id],c);
      if(job?.status!=="Failed"||attempts.length)fail("Email delivery must be reconciled through delivery history before retrying. No email was replayed.",409);
      if(q.status!=="Approved"||snapshot(q)!==job.snapshot_hash)fail("This quote changed. Preview and approve a revised quote.",409);
      await this.run("UPDATE quote_quick_sends SET status='Queued',error_message=NULL WHERE quote_id=?",[id],c);
      await this.log(c,actor,"resume quote preparation after refusal","quote",id);
    });
  }
  async signatureDocuments(id){
    const [q]=await this.run("SELECT * FROM quotes WHERE id=?",[id]);if(!q)fail("Quote not found.",404);
    const p=await this.getProspect(q.prospect_id),items=await this.sp.workItems(p.client_id,true);
    const definitions=this.sp.ready().definitions||[];
    // The deployed definition is authoritative: old blueprints call BII-14 MSA.
    const psaIds=new Set(definitions.filter(d=>d.lane==="Business IT Integration"&&/\bPSA\b|Project Services Agreement/i.test(d.document||"")).map(d=>d.id));
    const psa=items.filter(i=>psaIds.has(i.workflowId)||/\bPSA\b|Project Services Agreement/i.test(i.document||""));
    const signed=psa.some(i=>i.signatureStatus==="Signed"||i.signedAt);
    return {quote:items.filter(i=>i.workflowId==="BII-05"&&String(i.instanceRef)===String(id)),psa:signed?[]:psa.filter(i=>!["Cancelled","Not Required"].includes(i.status)),psaSigned:signed,psaMissing:!signed&&!psa.length};
  }
  async markSignatureSent(id,user){
    await this.tx(async c=>{
      const [q]=await this.run("SELECT * FROM quotes WHERE id=? FOR UPDATE",[id],c);if(!q)fail("Quote not found.",404);
      const [actor]=await this.run("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[user.email],c),p=await this.getProspect(q.prospect_id,c);eligible(p,actor);
      const [job]=await this.run("SELECT * FROM quote_quick_sends WHERE quote_id=? FOR UPDATE",[id],c);
      if(job?.status!=="ReadySignature"||q.status!=="Approved"||snapshot(q)!==job.snapshot_hash)fail("Complete the current BII quote fill before recording signature delivery.",409);
      await this.run("UPDATE quotes SET status='Sent',sent_at=UTC_TIMESTAMP(),sent_by=? WHERE id=?",[actor.email,id],c);
      await this.run("UPDATE quote_quick_sends SET status='Sent' WHERE quote_id=?",[id],c);
      await this.log(c,actor,"BII marked sent for signature","quote",id);
    });
  }
}
