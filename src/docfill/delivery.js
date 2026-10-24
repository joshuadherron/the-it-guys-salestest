import { randomUUID } from "node:crypto";
import { json } from "../db.js";
import { quoteLane,quoteFillMode } from "./policy.js";
import { buildManagedFill,buildBiiFill } from "./quote-fields.js";
import { prepareQuoteDocument,deliverQuoteDocument } from "./service.js";
import { inspectPdfText,senderMailbox,senderProfile,sendMode,recipients,quoteEmail } from "./send-policy.js";
import { chicagoDate } from "./chicago-date.js";
import { buildProjectFill } from "./project-fields.js";
import { genericPricing } from "../engagement-types.js";
const uncertain=e=>!e.status||e.status>=500||e.status===408;
export class QuoteDelivery {
  constructor({store,resolver,graph,extractText,prices,config,env=process.env}){Object.assign(this,{store,resolver,graph,extractText,prices,config,env});}
  async contentTags(working){
    const tags=await this.graph.read(`/drives/${encodeURIComponent(working.driveId)}/items/${encodeURIComponent(working.itemId)}?$select=id,eTag,cTag`);
    if(tags?.id!==working.itemId||!tags.eTag||!tags.cTag)throw new Error('The working Word file content tag could not be verified. Check Graph file access before sending.');
    return {...working,eTag:tags.eTag,cTag:tags.cTag};
  }
  async fill(id,user,{instanceRef}={}){
    const ctx=await this.store.begin(id,user,"Fill");let fillId,writing=false;
    try{
      const mode=quoteFillMode(this.env);if(mode==="off")throw new Error("Quote fill is disabled.");
      const quote={...ctx.q,inputs:json(ctx.q.inputs),line_items:json(ctx.q.line_items)},key=quoteLane(quote.inputs,undefined,this.env).key;
      const {working,master}=await this.resolver.resolve(quote,ctx.p,key,instanceRef);
      const owner=ctx.q.document_facts?json(ctx.q.document_facts):{};
      const data=genericPricing(quote.inputs)?buildProjectFill({quote,prospect:ctx.p}):key==="COM-PRP"?buildManagedFill({quote,prospect:ctx.p,owner}):buildBiiFill({quote,prospect:ctx.p,owner,prices:await this.prices()});
      const prepared=await prepareQuoteDocument({canSend:true,quote,clientId:ctx.p.client_id,workingCopies:[working],requestsPending:false,completionStatus:"Open",signatureStatus:key==="BII-QSOW"?working.signatureStatus:undefined,masterCopies:[master],expectedKey:key,data});
      fillId=await this.store.createFill(ctx,key,working,{report:prepared.report,fields:data.fields},mode);
      await this.store.current(ctx);
      writing=mode==="live";
      const result=await deliverQuoteDocument({prepared,graph:this.graph,env:this.env});
      let etag=result.item?.eTag||working.eTag,ctag=result.item?.cTag;
      if(mode==="live"&&!result.item?.eTag)throw new Error("Live fill succeeded without a confirmed resulting eTag; reconciliation is required.");
      if(mode==='live'&&!ctag){const tags=await this.contentTags(working);etag=tags.eTag;ctag=tags.cTag;}
      await this.store.filled(fillId,"Succeeded",etag,ctag);
      await this.store.log(ctx,"quote fill "+mode,fillId);
      await this.store.release(ctx);
      return {mode,report:prepared.report,url:working.webUrl,next:key==="BII-QSOW"?"Review in Word -> set Signature Status = Ready to send -> send the eSignature request from the email Flow 7 sends you.":"Review the quote in Word before sending."};
    }catch(e){const unknown=writing&&uncertain(e);if(fillId)await this.store.filled(fillId,unknown?"Unknown":"Failed");await this.store.release(ctx,unknown);throw e;}
  }
  async send(id,user,input={}){
    const mode=sendMode(this.env);if(mode==="off")throw new Error("Quote send is disabled.");
    const mailbox=senderMailbox(this.env);
    await this.store.checkMailbox(mailbox);
    const ctx=await this.store.begin(id,user,"Send",input.retryId);let attemptId,phase="Checks",effect=false,pdfItemId;
    try{
      senderProfile(ctx.actor);
      const quote={...ctx.q,inputs:json(ctx.q.inputs),line_items:json(ctx.q.line_items)};
      const key=quoteLane(quote.inputs,undefined,this.env).key;
      if(!["COM-PRP","ENG-PRJ"].includes(key))throw new Error("BII uses manual eSignature; automated sending supports Managed IT and Project quotes.");
      const fill=await this.store.latestFill(id);
      if(!fill||fill.document_key!==key||fill.mode!=="live"||fill.status!=="Succeeded"||fill.snapshot_hash!==ctx.hash)throw new Error("A current successful live fill is required before sending.");
      let working=await this.resolver.working(ctx.p,key,id,fill.item_id);
      if(fill.drive_id!==working.driveId||fill.item_id!==working.itemId)throw new Error("The working quote differs from the latest fill.");
      if(fill.ctag)working=await this.contentTags(working);
      const fields=json(fill.fields_json),config=await this.config();
      let pdf,name,to,cc;
      const correlationId=randomUUID();
      if(ctx.attempt){
        const a=ctx.attempt;
        if(mode!==a.mode||mailbox!==a.mailbox)throw new Error("Retry must use the original mode and shared mailbox.");
        if(mode==="live"&&ctx.p.email?.toLowerCase()!==a.sent_to)throw new Error("The primary recipient changed; reconcile the saved send attempt first.");
        const saved=await this.graph.read(`/drives/${encodeURIComponent(fill.drive_id)}/items/${encodeURIComponent(a.pdf_item_id)}`);
        if(saved.parentReference?.id!==working.folderId)throw new Error("The saved sent PDF is missing from Commercial.");
        pdf=Buffer.from(a.pdf_bytes);name=a.pdf_name;to=a.sent_to;cc=a.sent_cc;pdfItemId=a.pdf_item_id;attemptId=a.id;
      }else{
        const sameContent=fill.ctag?working.cTag===fill.ctag:working.eTag===fill.etag;
        if(!sameContent&&input.reviewed_edits!=="yes")throw new Error("The Word copy changed. Tick I reviewed the Word edits before sending.");
        if(sameContent&&json(fill.report).unfilled.length)throw new Error("The live fill still has unfilled fields. Complete them in Word first.");
        ({to,cc}=recipients(ctx.p,ctx.actor,mode,input));
        const before=fill.ctag?working.cTag:working.eTag;
        pdf=await this.graph.quoteContent(working.driveId,working.itemId,true);
        inspectPdfText(await this.extractText(pdf));
        let after=await this.resolver.working(ctx.p,key,id,fill.item_id);
        if(fill.ctag)after=await this.contentTags(after);
        if((fill.ctag?after.cTag:after.eTag)!==before)throw new Error("The Word file changed during PDF conversion. Review and try again.");
        if(!Buffer.isBuffer(pdf)||pdf.length>3*1000*1000)throw new Error("Quote PDF exceeds the email attachment limit.");
        name=working.name.replace(/\.docx$/i,"")+" - SENT "+chicagoDate()+".pdf";
      }
      // Re-read sender profile/permissions immediately before every external side effect.
      let current=await this.store.current(ctx);senderProfile(current.actor);ctx.actor=current.actor;
      const message=quoteEmail({quote,prospect:ctx.p,actor:ctx.actor,fields,config,mode,to,cc,pdf,name,requestId:correlationId});
      if(!attemptId)attemptId=await this.store.createAttempt(ctx,{fill,mode,mailbox,to,cc,name,pdf,message,correlationId});
      if(mode==="live"&&!pdfItemId){
        phase="SavePdf";effect=true;
        const saved=await this.graph.createSentQuotePdf(working.driveId,working.folderId,name,pdf);
        pdfItemId=saved.id;await this.store.savedPdf(attemptId,pdfItemId);effect=false;
      }
      phase="Email";
      current=await this.store.current(ctx);senderProfile(current.actor);
      if(current.actor.display_name!==ctx.actor.display_name||current.actor.sender_title!==ctx.actor.sender_title||current.actor.sender_phone!==ctx.actor.sender_phone)throw new Error("Sender profile changed. Review before sending.");
      const final=await this.resolver.working(ctx.p,key,id,fill.item_id);
      if(final.driveId!==fill.drive_id||final.itemId!==fill.item_id)throw new Error("The working quote differs from the latest fill.");
      await this.store.sending(attemptId,ctx.actor,message,correlationId);effect=true;
      const result=await this.graph.sendQuoteMail(mailbox,message,correlationId);
      await this.store.sent(ctx,attemptId,{mode,to,cc,pdfItemId},result);
      await this.store.release(ctx);
      return {mode,attemptId,status:mode==="live"?"Sent":"Dryrun",requestId:result.requestId};
    }catch(e){const unknown=effect&&uncertain(e);if(attemptId)await this.store.failed(attemptId,unknown?"Unknown":"Failed",phase,e);await this.store.release(ctx,unknown);if(e.code==='QUOTE_COPY_NOT_VISIBLE')e.safeToWaitForCopy=!attemptId&&!effect&&!ctx.attempt;throw e;}
  }
}
