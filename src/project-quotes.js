import { intakeSelect } from "./engagement-intake.js";
import { query,transaction,audit,json } from "./db.js";
import { prospect } from "./pipeline.js";
import { integer,fail } from "./security.js";
import { quoteApprove,quoteSend,canQuote } from "./quote-permissions.js";
import { genericEngagement,engagementTypes } from "./engagement-types.js";
import { missingIntake } from "./engagement-intake.js";
import { validateProjectQuote,priceProject } from "./project-pricing.js";
import { snapshot } from "./docfill/delivery-store.js";

export async function projectConfig(run=query,c) {
  const rows=await run("SELECT name,amount FROM config_prices WHERE name IN ('project_hourly_rate','project_minimum_hours')",[],c);
  return {hourly_rate:rows.find(r=>r.name==="project_hourly_rate")?.amount??null,minimum_hours:rows.find(r=>r.name==="project_minimum_hours")?.amount??0};
}
export async function assertProjectApproval(p,q,intake) {
  if(!genericEngagement(p))fail("Use the existing Managed IT or BII quote workflow.");
  if(p.hold)fail("On Hold — Pending Josh Review.",409);
  if(p.stage==="Closed Lost"||p.status==="Lost")fail("This opportunity is lost. Open a new opportunity before authorizing work.",409);
  const missing=missingIntake(p.engagement_type,intake?.answers?json(intake.answers):{},p);
  if(!intake?.complete||missing.length)fail("Complete the appropriate intake before approval: "+(missing.map(m=>m.label+" ("+m.href+")").join("; ")||`review /prospects/${p.id}/intake`));
  const input=json(q.inputs);
  if(["Approved","Sent"].includes(q.status)&&json(q.stop_review)?.intakeRevision!==intake.revision)fail("Intake changed after approval. Create and approve a new quote revision before preparing or authorizing work.",409);
  if(input.pricingMode!==(p.engagement_type==="hourly"?"hourly_v1":"project_v1"))fail("The saved quote type differs from this opportunity.",409);
  const calculation=priceProject(input);
  if(calculation.pending.length)fail(calculation.pending.join(" "));
  return calculation;
}
export function projectQuoteRoutes(app,deps={query,transaction,audit,prospect}) {
  const {query,transaction,audit,prospect}=deps;
  app.get("/prospects/:id/project-quotes",async(req,res)=>{
    const p=await prospect(req.params.id);
    if(!genericEngagement(p))return res.redirect(`/prospects/${p.id}/quotes`);
    const quotes=await query("SELECT * FROM quotes WHERE prospect_id=? ORDER BY id DESC",[p.id]);
    const selected=req.query.quote?quotes.find(q=>String(q.id)===String(integer(req.query.quote))):null;
    if(req.query.quote&&!selected)fail("Quote not found for this opportunity.",404);
    const [intake]=await query(intakeSelect,[p.id]);
    res.render("project-quotes",{p,engagementTypes,quotes,selected,input:selected?json(selected.inputs):null,json,config:await projectConfig(query),canApprove:canQuote(req.session.user,"quote.approve")&&req.session.user.role==="owner",canSend:canQuote(req.session.user,"quote.send"),missing:missingIntake(p.engagement_type,intake?json(intake.answers):{},p),intakeComplete:!!intake?.complete});
  });
  app.post("/prospects/:id/project-quotes",async(req,res)=>{
    let id;
    await transaction(async c=>{
      const p=await prospect(req.params.id,c);
      if(!genericEngagement(p))fail("Use the Managed IT/BII pricing worksheet.");
      if(p.hold)fail("On Hold — Pending Josh Review.",409);
      if(p.stage==="Closed Lost"||p.status==="Lost")fail("Open a new opportunity before quoting lost work.",409);
      if(p.sales_authorized||p.stage==="Closed Won")fail("This sale is already won. Open a new opportunity for additional scope.",409);
      if(req.body.revise_id) {
        const [old]=await query("SELECT * FROM quotes WHERE id=? AND prospect_id=? FOR UPDATE",[integer(req.body.revise_id),p.id],c);
        if(!old)fail("Quote revision source not found.",404);
      }
      const input=validateProjectQuote(req.body,p.engagement_type,await projectConfig(query,c)),calc=priceProject(input);
      const r=await query("INSERT INTO quotes (prospect_id,inputs,line_items,total) VALUES (?,?,?,?)",[p.id,JSON.stringify(input),JSON.stringify(calc.lines),calc.total],c);id=r.insertId;
      await query("UPDATE quotes SET quote_number=CONCAT('Q-',YEAR(created_at),'-',LPAD(id,GREATEST(3,CHAR_LENGTH(id)),'0')) WHERE id=?",[id],c);
      await audit(c,req.session.user,req.body.revise_id?"create project revision of quote "+integer(req.body.revise_id):"create "+p.engagement_type+" draft","quote",id);
    });
    res.redirect(`/prospects/${req.params.id}/project-quotes?quote=${id}`);
  });
  app.post("/quotes/:id/project-approve",quoteApprove,async(req,res)=>{
    let pid;
    await transaction(async c=>{
      const [initial]=await query("SELECT * FROM quotes WHERE id=?",[integer(req.params.id)],c);
      if(!initial)fail("Quote not found.",404);pid=initial.prospect_id;
      const p=await prospect(pid,c),[q]=await query("SELECT * FROM quotes WHERE id=? FOR UPDATE",[initial.id],c);
      const [actor]=await query("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[req.session.user.email],c);
      if(!canQuote(actor,"quote.approve"))fail("Quote approval permission was revoked.",403);
      if(actor.role!=="owner")fail("Owner approval is required for project/hourly custom pricing.",403);
      if(q.status!=="Draft")fail("Only a draft can be approved.",409);
      if(req.body.reviewed!=="yes")fail("Confirm scope, custom prices, risks and estimate/authorization terms before approval.");
      const [intake]=await query(intakeSelect,[pid],c);
      const calc=await assertProjectApproval(p,q,intake);
      await query("UPDATE quotes SET status='Approved',approved_by=?,approved_at=UTC_TIMESTAMP(),line_items=?,total=?,stop_review=? WHERE id=?",[actor.email,JSON.stringify(calc.lines),calc.total,JSON.stringify({engagement_type:p.engagement_type,customPricingReviewed:true,intakeRevision:intake.revision}),q.id],c);
      await audit(c,actor,"approve "+p.engagement_type+" pricing snapshot","quote",q.id);
    });
    res.redirect(`/prospects/${pid}/project-quotes?quote=${req.params.id}`);
  });
  app.get("/quotes/:id/project-print",async(req,res)=>{
    const [q]=await query("SELECT * FROM quotes WHERE id=?",[integer(req.params.id)]);
    if(!q)fail("Quote not found.",404);
    const p=await prospect(q.prospect_id);
    if(!genericEngagement(p))fail("Use the existing quote worksheet.");
    res.render("project-quote-print",{q,p,input:json(q.inputs),lines:json(q.line_items),calculation:priceProject(json(q.inputs))});
  });
  app.post("/quotes/:id/project-sent",quoteSend,async(req,res)=>{
    let pid;
    await transaction(async c=>{
      const [initial]=await query("SELECT * FROM quotes WHERE id=?",[integer(req.params.id)],c);
      if(!initial)fail("Quote not found.",404);pid=initial.prospect_id;
      const p=await prospect(pid,c),[q]=await query("SELECT * FROM quotes WHERE id=? FOR UPDATE",[initial.id],c);
      const [actor]=await query("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[req.session.user.email],c);
      if(!canQuote(actor,"quote.send"))fail("Quote send permission was revoked.",403);
      if(!genericEngagement(p)||p.hold||q.status!=="Approved")fail("Only an approved project/hourly quote without a hold can be recorded as sent.");
      if(p.stage==="Closed Lost"||p.stage==="Closed Won")fail("This opportunity is already closed. Sending cannot reopen it.",409);
      const [intake]=await query(intakeSelect,[p.id],c);
      await assertProjectApproval(p,q,intake);
      if(req.body.confirm!=="yes")fail("Confirm that you actually sent this proposal; the app does not send it automatically.");
      const [fill]=await query("SELECT * FROM quote_fills WHERE quote_id=? ORDER BY id DESC LIMIT 1",[q.id],c);
      if(!fill||fill.status!=="Succeeded"||fill.mode!=="live"||fill.snapshot_hash!==snapshot(q))fail("Save the current approved proposal to SharePoint before recording it as sent.");
      await query("UPDATE quotes SET status='Sent',sent_at=UTC_TIMESTAMP(),sent_by=? WHERE id=?",[req.session.user.email,q.id],c);
      await query("UPDATE prospects SET stage='Proposal Sent' WHERE id=?",[pid],c);
      await audit(c,req.session.user,"record manually sent project proposal","quote",q.id);
    });
    res.redirect(`/prospects/${pid}/project-quotes?quote=${req.params.id}`);
  });
}
