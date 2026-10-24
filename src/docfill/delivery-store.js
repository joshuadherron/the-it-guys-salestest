import { randomUUID, createHash } from "node:crypto";
import { query, transaction, audit, json } from "../db.js";
import { prospect } from "../pipeline.js";
import { canQuote } from "../quote-permissions.js";
import { lockClientRequests } from "../existing-client-rules.js";
import { genericEngagement } from "../engagement-types.js";
import { assertProjectApproval } from "../project-quotes.js";
export const snapshot = q => createHash("sha256").update(JSON.stringify([q.quote_number,json(q.inputs),json(q.line_items),String(q.total),String(q.approved_at),q.document_facts?json(q.document_facts):null])).digest("hex");
export class DeliveryStore {
  constructor(deps={query,transaction,audit,prospect}){Object.assign(this,deps);}
  async checkMailbox(mailbox){if((await this.query("SELECT email FROM allowlist WHERE email=?",[mailbox])).length)throw new Error("QUOTE_SENDER_MAILBOX belongs to an app user. Configure a dedicated shared mailbox instead.");}
  async begin(id,user,operation,retryId){
    return this.transaction(async c=>{
      const [initial]=await this.query("SELECT * FROM quotes WHERE id=?",[id],c);
      if(!initial)throw new Error("Quote not found.");
      const p=await this.prospect(initial.prospect_id,c);
      const [q]=await this.query("SELECT * FROM quotes WHERE id=? FOR UPDATE",[id],c);
      const [actor]=await this.query("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[user.email],c);
      if(!canQuote(actor,"quote.send"))throw new Error("Permission quote.send is required.");
      if(q.status!=="Approved"||p.hold||p.stage==="Closed Lost"||p.status==="Lost")throw new Error("Quote must be Approved and the opportunity must not be On Hold or Lost.");
      if(genericEngagement(p)) {
        await assertProjectApproval(p,q);
      }
      if(!p.client_id)throw new Error("Save proposal to SharePoint first to create the opportunity record and quote copy.");
      await lockClientRequests(p,this.query,c,id);
      const pending=await this.query("SELECT id FROM quote_send_attempts WHERE client_id=? AND (status IN ('Preparing','PdfSaved','Sending','Unknown') OR (status='Failed' AND pdf_item_id IS NOT NULL)) FOR UPDATE",[p.client_id],c);
      if(pending.some(a=>String(a.id)!==String(retryId||"")))throw new Error("A saved/active quote send needs reconciliation or email-only retry before another fill/send.");
      let attempt;
      if(retryId){
        [attempt]=await this.query("SELECT * FROM quote_send_attempts WHERE id=? AND quote_id=? FOR UPDATE",[retryId,id],c);
        if(!attempt||attempt.status!=="Failed"||attempt.phase!=="Email"||!attempt.pdf_item_id)throw new Error("Only a failed email with its saved PDF can be retried.");
        if(attempt.snapshot_hash!==snapshot(q))throw new Error("Quote changed after the saved PDF. Ask an admin to reconcile it.");
      }
      const token=randomUUID();
      await this.query("INSERT INTO quote_operation_locks (client_id,token,operation) VALUES (?,?,?)",[p.client_id,token,operation],c);
      return {q,p,actor,token,attempt,hash:snapshot(q)};
    });
  }
  async current(ctx){
    const [q]=await this.query("SELECT * FROM quotes WHERE id=?",[ctx.q.id]);
    const p=await this.prospect(ctx.p.id);
    const [actor]=await this.query("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[ctx.actor.email]);
    if(!q||q.status!=="Approved"||snapshot(q)!==ctx.hash||p.hold||p.stage==="Closed Lost"||p.status==="Lost"||p.client_id!==ctx.p.client_id||String(p.email||"").toLowerCase()!==String(ctx.p.email||"").toLowerCase()||!canQuote(actor,"quote.send"))throw new Error("Quote approval, hold, linkage, sales loss or sender permission changed. Reload before acting.");
    if(genericEngagement(p)) {
      await assertProjectApproval(p,q);
    }
    return {q,p,actor};
  }
  async release(ctx,unknown=false){if(!unknown)await this.query("DELETE FROM quote_operation_locks WHERE client_id=? AND token=?",[ctx.p.client_id,ctx.token]);}
  async latestFill(id){const [row]=await this.query("SELECT * FROM quote_fills WHERE quote_id=? ORDER BY id DESC LIMIT 1",[id]);return row;}
  async createFill(ctx,key,working,data,mode){
    const result=await this.query("INSERT INTO quote_fills (quote_id,client_id,document_key,snapshot_hash,drive_id,item_id,etag,report,fields_json,mode,status,actor,web_url) VALUES (?,?,?,?,?,?,?,?,?,?,'Preparing',?,?)",[ctx.q.id,ctx.p.client_id,key,ctx.hash,working.driveId,working.itemId,working.eTag,JSON.stringify(data.report),JSON.stringify(data.fields),mode,ctx.actor.email,working.webUrl||null]);
    return result.insertId;
  }
  async filled(id,status,etag){await this.query("UPDATE quote_fills SET status=?,etag=COALESCE(?,etag) WHERE id=?",[status,etag||null,id]);}
  async createAttempt(ctx,data){
    const r=await this.query("INSERT INTO quote_send_attempts (quote_id,client_id,fill_id,snapshot_hash,status,phase,mode,actor,mailbox,sent_to,sent_cc,pdf_name,pdf_bytes,email_json,correlation_id) VALUES (?,?,?,?,'Preparing','SavePdf',?,?,?,?,?,?,?,?,?)",[ctx.q.id,ctx.p.client_id,data.fill.id,ctx.hash,data.mode,ctx.actor.email,data.mailbox,data.to,data.cc,data.name,data.pdf,JSON.stringify(data.message),data.correlationId]);await this.audit(undefined,ctx.actor,"prepare quote send "+data.mode,"quote_send_attempt",r.insertId);return r.insertId;
  }
  async savedPdf(id,itemId){await this.query("UPDATE quote_send_attempts SET pdf_item_id=?,status='PdfSaved' WHERE id=?",[itemId,id]);}
  async sending(id,actor,message,correlationId){await this.query("UPDATE quote_send_attempts SET status='Sending',phase='Email',actor=?,email_json=?,correlation_id=? WHERE id=?",[actor.email,JSON.stringify(message),correlationId,id]);await this.audit(undefined,actor,"quote send explicitly clicked","quote_send_attempt",id);}
  async failed(id,status,phase,error){await this.query("UPDATE quote_send_attempts SET status=?,phase=?,error_message=? WHERE id=?",[status,phase,String(error.message||error).slice(0,2000),id]);}
  async sent(ctx,id,data,result){
    await this.transaction(async c=>{
      await this.query("UPDATE quote_send_attempts SET status=?,sent_at=UTC_TIMESTAMP(),email_request_id=?,email_message_id=?,error_message=NULL WHERE id=?",[data.mode==="live"?"Sent":"Dryrun",result.requestId||null,result.messageId||null,id],c);
      if(data.mode==="live")await this.query("UPDATE quotes SET status='Sent',sent_at=UTC_TIMESTAMP(),sent_by=?,sent_to=?,sent_cc=?,sent_pdf_item_id=?,email_message_id=? WHERE id=?",[ctx.actor.email,data.to,data.cc,data.pdfItemId,result.messageId||null,ctx.q.id],c);
      await this.audit(c,ctx.actor,data.mode==="live"?"quote email accepted by Graph":"dryrun quote email accepted by Graph","quote_send_attempt",id);
    });
  }
  async log(ctx,action,id){await this.audit(undefined,ctx.actor,action,"quote_delivery",id);}
}
