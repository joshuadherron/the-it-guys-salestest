import { query,transaction,audit,json } from "./db.js";
import { prospect,insertProspect } from "./pipeline.js";
import { quoteSend } from "./quote-permissions.js";
import { integer,fail,text } from "./security.js";
import { validateManagedInputs,validateInputs,priceConfig } from "./quotes.js";
import { validateProjectQuote } from "./project-pricing.js";
import { projectConfig } from "./project-quotes.js";
import { oneOffItems } from "./pricing.js";
import { managedOwnerFacts,formattedQuoteNumber } from "./docfill/managed-facts.js";
import { cleanOwner } from "./docfill/routes.js";
import { documentPrefill } from "./docfill/prefill.js";
import { snapshot } from "./docfill/delivery-store.js";
import { quickCalculation,mayApprove } from "./quick-send.js";
import { quickQuoteDocument } from "./quick-quote-document.js";
import { missingProposalFacts,money,previewSections } from './quick-quote-preview.js';

export function quickQuoteRoutes(app,{run=query,tx=transaction,log=audit,getProspect=prospect,insert=insertProspect,prices=priceConfig,document=quickQuoteDocument,service:provided,warn=console.warn}={}){
  const service=async()=>provided||(await import("./quick-send-runtime.js")).quickSend;
  const safe=fn=>async(req,res)=>{
    try{return await fn(req,res);}catch(error){
      if(error.code?.startsWith("ER_"))throw error;
      warn("Quick Quote refused:",{quoteId:req.params.id,status:error.status||409,message:error.message});
      const status=error.status&&error.status<500?error.status:409;
      res.status(status);
      if(req.accepts(["json","html"])==="json")return res.json({error:error.message});
      return res.render("error",{message:error.message,returnUrl:req.params.id?`/quick-quote/${(req.path||'').includes('/opportunities/')?'opportunities':'quotes'}/${integer(req.params.id)}`:"/quick-quote"});
    }
  };
  async function context(id){
    const [q]=await run("SELECT * FROM quotes WHERE id=?",[integer(id)]);if(!q)fail("Quote not found.",404);
    if(!q.quote_number){q.quote_number=formattedQuoteNumber(q);await run("UPDATE quotes SET quote_number=? WHERE id=? AND quote_number IS NULL",[q.quote_number,q.id]);}
    return {q,p:await getProspect(q.prospect_id)};
  }
  app.get("/quick-quote",quoteSend,safe(async(req,res)=>{
    const businesses=await run("SELECT id,name,contact_name,email,phone FROM businesses ORDER BY name");
    res.render("quick-quote-client",{businesses,selected:req.query.business_id||""});
  }));
  app.post("/quick-quote",quoteSend,safe(async(req,res)=>{
    const id=await tx(async c=>{
      const body=req.body.business_mode==="new"?{...req.body,business_id:undefined}:req.body;
      if(!body.business_id&&(!text(body.business_name||"")||!text(body.contact_name||"")||!text(body.email||"")))fail("Enter the business name, contact name and email.");
      return insert({...body,engagement_type:"project",owner:req.session.user.email,stage:"Prospecting"},req.session.user,c,{query:run,audit:log});
    });
    res.redirect(`/quick-quote/opportunities/${id}`);
  }));
  app.get("/quick-quote/opportunities/:id",quoteSend,safe(async(req,res)=>{
    const p=await getProspect(req.params.id);
    const [q]=req.query.quote?await run("SELECT * FROM quotes WHERE id=? AND prospect_id=?",[integer(req.query.quote),p.id]):[];
    const savedType=q?(json(q.inputs).pricingMode==='managed_v20'?'managed_it':json(q.inputs).pricingMode==='project_v1'?'project':'bii'):null;
    const type=req.query.type||savedType,useSaved=q&&type===savedType;
    if(!type)return res.render('quick-quote-type',{p});
    if(!["managed_it","bii","project"].includes(type))fail("Choose Managed IT, BII or Project. Hourly estimates retain their existing workflow.");
    const input=useSaved?json(q.inputs):type==="managed_it"?validateManagedInputs({}):type==="bii"?Object.fromEntries(["users","windows","mac","ios","android","unallocated","mailboxes","dell","phones","locations"].map(k=>[k,k==='locations'?1:0])):{};
    const prefill={...documentPrefill(p,input,type==="managed_it"?"COM-PRP":"BII-QSOW"),...(useSaved&&q.document_facts?json(q.document_facts):{})};
    res.render("quick-quote-form",{p,type,input,prefill,q,oneOffItems,config:await projectConfig(run)});
  }));
  app.post("/quick-quote/opportunities/:id",quoteSend,safe(async(req,res)=>{
    let id;
    await tx(async c=>{
      const p=await getProspect(req.params.id,c),type=req.body.type;
      if(!["managed_it","bii","project"].includes(type))fail("Choose a supported quote type.");
      if(type!==p.engagement_type){
        const history=await run("SELECT id FROM quotes WHERE prospect_id=? LIMIT 1",[p.id],c);
        const workflows=await run("SELECT id FROM sp_requests WHERE prospect_id=? AND action<>'UpsertProspect' LIMIT 1",[p.id],c);
        if(history.length||workflows.length)fail("This opportunity already has a service history. Use New quote under this business to select a different type.",409);
        const lane={managed_it:"Managed IT",bii:"Business IT Integration",project:"Business Technology Projects"}[type];
        await run("UPDATE prospects SET engagement_type=?,service_lane=? WHERE id=?",[type,lane,p.id],c);
      }
      const body={...req.body,includeBii:type==="bii"?"yes":type==="managed_it"?req.body.includeBii:undefined};
      const input=type==="project"?validateProjectQuote(body,type,await projectConfig(run,c)):type==="managed_it"?validateManagedInputs(body):validateInputs(body);
      const calculation=quickCalculation(input,await prices(c));
      const facts=type==="managed_it"?managedOwnerFacts(body):type==="bii"?cleanOwner(body):{};
      const result=await run("INSERT INTO quotes (prospect_id,inputs,line_items,total,document_facts) VALUES (?,?,?,?,?)",[p.id,JSON.stringify(input),JSON.stringify(calculation.lines),calculation.total,JSON.stringify(facts)],c);id=result.insertId;
      await run("UPDATE quotes SET quote_number=CONCAT('Q-',YEAR(created_at),'-',LPAD(id,GREATEST(3,CHAR_LENGTH(id)),'0')) WHERE id=?",[id],c);
      await log(c,req.session.user,"create Quick Quote draft","quote",id);
    });
    res.redirect(`/quick-quote/quotes/${id}`);
  }));
  app.get("/quick-quote/quotes/:id",quoteSend,safe(async(req,res)=>{
    const {q,p}=await context(req.params.id),send=await service(),job=await send.state(q.id);
    const input=json(q.inputs),type=input.pricingMode==='managed_v20'?'managed_it':input.includeBii?'bii':'project',missing=missingProposalFacts(type,json(q.document_facts));
    let preview=null,error=missing.length?'Missing proposal facts: '+missing.join('; '):null;
    if(!missing.length)try{preview=await document(q,p,await prices());}catch(e){error=e.message;}
    const stops=await run("SELECT * FROM config_stop_conditions ORDER BY id");
    const documents=job?.status==='ReadySignature'?await send.signatureDocuments(q.id):null;
    res.render("quick-quote-preview",{q,p,input,lines:json(q.line_items),hash:snapshot(q),preview,error,job,documents,stops,canApprove:mayApprove(req.session.user),money,sections:previewSections(input,json(q.line_items))});
  }));
  app.get("/quick-quote/quotes/:id/word",quoteSend,safe(async(req,res)=>{
    const {q,p}=await context(req.params.id),preview=await document(q,p,await prices());
    res.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document");res.set("Content-Disposition",`attachment; filename="${q.quote_number}-PREVIEW.docx"`);res.send(preview.buffer);
  }));
  app.post("/quick-quote/quotes/:id/send",quoteSend,safe(async(req,res)=>{
    const {q,p}=await context(req.params.id),preview=await document(q,p,await prices());
    if(preview.report.unfilled.length)fail("Complete these quote fields before Send: "+preview.report.unfilled.join(", ")+". Return to the quote to edit its facts.",409);
    const options={};for(const [key,value] of Object.entries(req.body))if(/^stop_\d+$/.test(key)&&value==="yes")options[key]="yes";
    options.cc=text(req.body.cc||"",254);options.internal_test=req.body.internal_test==="yes"?"yes":"no";
    await (await service()).start(q.id,req.session.user,req.body.hash,options);
    res.redirect(`/quick-quote/quotes/${q.id}/progress`);
  }));
  app.get("/quick-quote/quotes/:id/progress",quoteSend,safe(async(req,res)=>{
    const {q,p}=await context(req.params.id),send=await service(),job=await send.state(q.id);
    if(!job)return res.redirect(`/quick-quote/quotes/${q.id}`);
    const documents=job.status==="ReadySignature"?await send.signatureDocuments(q.id):null;
    res.render("quick-quote-progress",{q,p,job,documents,canApprove:mayApprove(req.session.user)});
  }));
  app.post("/quick-quote/quotes/:id/progress",quoteSend,safe(async(req,res)=>res.json(await (await service()).advance(integer(req.params.id),req.session.user))));
  app.get('/quick-quote/quotes/:id/status',quoteSend,safe(async(req,res)=>{
    const send=await service(),job=await send.state(integer(req.params.id));
    if(!job)fail('Send job not found.',404);
    res.json(send.progress(job));
  }));
  app.post("/quick-quote/quotes/:id/resume",quoteSend,safe(async(req,res)=>{
    await (await service()).resume(integer(req.params.id),req.session.user,{reviewed_edits:req.body.reviewed_edits==='yes'?'yes':'no'});res.redirect(`/quick-quote/quotes/${req.params.id}/progress`);
  }));
  app.post("/quick-quote/quotes/:id/signature-sent",quoteSend,safe(async(req,res)=>{
    if(req.body.confirm!=="yes")fail("Confirm that you actually sent the eSignature request.");
    await (await service()).markSignatureSent(integer(req.params.id),req.session.user);res.redirect(`/quick-quote/quotes/${req.params.id}/progress`);
  }));
}
