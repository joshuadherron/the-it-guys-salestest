import { intakeSelect } from "./engagement-intake.js";
import { query,transaction,audit,json } from "./db.js";
import { prospect } from "./pipeline.js";
import { integer,text,choice,fail,ownerOnly } from "./security.js";
import { quoteSend,adminOnly,canQuote } from "./quote-permissions.js";
import { engagementTypes,genericEngagement } from "./engagement-types.js";
import { intakeFields,riskFields,validateIntake,missingIntake,intakeFlags } from "./engagement-intake.js";
import { attachBusiness } from "./businesses.js";
import { projectConfig,assertProjectApproval } from "./project-quotes.js";
import { snapshot } from "./docfill/delivery-store.js";
import { isDeepStrictEqual } from "node:util";
import { salesHandoff,handoffOutcome } from "./sales-handoff.js";
import { dispatchProspectSync } from "./prospect-sync.js";
export function universalRoutes(app,deps={query,transaction,audit,prospect,sync:dispatchProspectSync}) {
  const {query,transaction,audit,prospect,sync=async()=>{}}=deps;
  app.get("/businesses",async(req,res)=>{
    const search=text(req.query.q||"",200);
    const businesses=await query("SELECT b.*,(SELECT COUNT(*) FROM prospects p WHERE p.business_id=b.id) AS opportunities FROM businesses b WHERE b.name LIKE ? ORDER BY b.name,b.id",["%"+search+"%"]);
    res.render("businesses",{businesses,search});
  });
  app.get("/businesses/:id",async(req,res)=>{
    const [business]=await query("SELECT * FROM businesses WHERE id=?",[integer(req.params.id)]);
    if(!business)fail("Business not found.",404);
    const opportunities=await query("SELECT p.* FROM prospects p WHERE business_id=? ORDER BY id DESC",[business.id]);
    res.render("business",{business,opportunities,engagementTypes});
  });
  app.post("/prospects/:id/business",ownerOnly,async(req,res)=>{
    await transaction(async c=>{
      const p=await prospect(req.params.id,c);
      if(p.hold)fail("Release the urgent hold before changing business identity.");
      if(await salesHandoff(p.id,c,query))fail("Authorized sales retain their business identity. Open a new opportunity instead.",409);
      if((await query("SELECT id FROM quotes WHERE prospect_id=? LIMIT 1",[p.id],c)).length||(await query("SELECT id FROM sp_requests WHERE prospect_id=? LIMIT 1",[p.id],c)).length)fail("This opportunity already has commercial history. Open a new opportunity under the correct business instead.",409);
      await attachBusiness(p,integer(req.body.business_id),req.session.user,c,{query,audit});
    });
    res.redirect(`/prospects/${req.params.id}`);
  });
  app.get("/prospects/:id/work",async(req,res)=>{
    const p=await prospect(req.params.id);
    if(!genericEngagement(p))return res.redirect(`/prospects/${p.id}`);
    const [intake]=await query(intakeSelect,[p.id]);
    const handoff=await salesHandoff(p.id,undefined,query);
    const quotes=await query("SELECT * FROM quotes WHERE prospect_id=? ORDER BY id DESC",[p.id]);
    res.render("opportunity",{p,intake,handoff,quotes,engagementTypes,missing:missingIntake(p.engagement_type,intake?json(intake.answers):{},p),flags:intake?json(intake.flags):[],canSend:canQuote(req.session.user,"quote.send")});
  });
  const intakePage=async(req,res,override)=>{
    const p=await prospect(req.params.id);
    if(!genericEngagement(p))return res.redirect(`/prospects/${p.id}/discovery/resume`);
    const [record]=await query(intakeSelect,[p.id]);
    const answers=override?.answers|| (record?json(record.answers):{contact:p.contact_name||""});
    res.render("engagement-intake",{p,engagementTypes,intakeFields,riskFields,answers,revision:record?.revision||0,complete:!!record?.complete,missing:missingIntake(p.engagement_type,answers,p),flags:intakeFlags(answers),error:override?.error||null});
  };
  app.get("/prospects/:id/intake",intakePage);
  app.post("/prospects/:id/intake",async(req,res)=>{
    const answers=validateIntake(req.body);
    try {
      await transaction(async c=>{
        const p=await prospect(req.params.id,c);
        if(!genericEngagement(p))fail("Use the detailed Managed IT/BII discovery.");
        if(p.sales_authorized)fail("This opportunity is already handed off. Open a new opportunity for additional discovery or scope.",409);
        const [record]=await query(intakeSelect+" FOR UPDATE",[p.id],c);
        if(integer(req.body.revision)!==(record?.revision||0))fail("Intake changed in another tab. Reload before saving.",409);
        if(record?.complete&&req.session.user.role!=="owner")fail("Josh must revise completed intake.",403);
        const complete=req.body.complete==="yes",missing=missingIntake(p.engagement_type,answers,p),flags=intakeFlags(answers);
        if(complete&&missing.length)throw Object.assign(new Error("Complete the required questions listed below."),{status:422,intakeMissing:true});
        if(complete&&(p.hold||answers.urgent_security))fail("Resolve the urgent hold before completing intake.",409);
        const revision=(record?.revision||0)+1;
        const versionAnswers={...answers,_intake_complete:complete};
        await query("INSERT INTO discoveries (prospect_id,answers,revision,status,flags) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE answers=VALUES(answers),revision=VALUES(revision),status=VALUES(status),flags=VALUES(flags)",[p.id,JSON.stringify(versionAnswers),revision,complete?"Ready for Review":"Draft",JSON.stringify(flags)],c);
        await query("INSERT INTO discovery_versions (prospect_id,revision,answers,actor) VALUES (?,?,?,?)",[p.id,revision,JSON.stringify(versionAnswers),req.session.user.email],c);
        if(answers.urgent_security)await query("UPDATE prospects SET hold=TRUE WHERE id=?",[p.id],c);
        if(complete)await query("UPDATE prospects SET stage='Qualified' WHERE id=? AND stage IN ('Prospecting','Discovery')",[p.id],c);
        await audit(c,req.session.user,complete?"complete "+p.engagement_type+" intake":"save "+p.engagement_type+" intake","prospect",p.id);
      });
    }catch(e){if(e.intakeMissing){res.status(422);return intakePage(req,res,{answers,error:e.message});}throw e;}
    res.redirect(`/prospects/${req.params.id}/work`);
  });
  app.post("/prospects/:id/intake/release-hold",ownerOnly,async(req,res)=>{
    const note=text(req.body.note||"",1000);if(note.length<10)fail("Record how the security concern was reviewed (at least 10 characters).");
    await transaction(async c=>{
      const p=await prospect(req.params.id,c);if(!genericEngagement(p))fail("Use the existing discovery hold workflow.");
      await query("UPDATE prospects SET hold=FALSE WHERE id=?",[p.id],c);
      await query("INSERT INTO activities (prospect_id,type,outcome,notes,occurred_on,actor) VALUES (?,'note','Hold reviewed',?,UTC_DATE(),?)",[p.id,"Release hold: "+note,req.session.user.email],c);
      await audit(c,req.session.user,"release generic intake security hold","prospect",p.id);
    });res.redirect(`/prospects/${req.params.id}/intake`);
  });
  app.post("/prospects/:id/authorize",quoteSend,async(req,res)=>{
    await transaction(async c=>{
      const p=await prospect(req.params.id,c);
      const [actor]=await query("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[req.session.user.email],c);
      if(!canQuote(actor,"quote.send"))fail("Work authorization permission was revoked.",403);
      if(!genericEngagement(p)||!p.business_id)fail("Generic work authorization requires a linked business and a project/hourly opportunity.");
      if(await salesHandoff(p.id,c,query))fail("This opportunity already has a recorded authorization and sales handoff. Open another opportunity for additional work.",409);
      const [q]=await query("SELECT * FROM quotes WHERE id=? AND prospect_id=? FOR UPDATE",[integer(req.body.quote_id),p.id],c);
      if(!q||!["Approved","Sent"].includes(q.status)||!q.approved_at)fail("Select an approved quote belonging to this opportunity.");
      const [intake]=await query(intakeSelect,[p.id],c);
      const calc=await assertProjectApproval(p,q,intake);
      if(calc.total!==Number(q.total)||!isDeepStrictEqual(calc.lines,json(q.line_items)))fail("Approved pricing differs from the saved snapshot. Approve a new revision.",409);
      const reference=text(req.body.authorization_reference||"",2000);if(reference.length<10||req.body.confirm!=="yes")fail("Record the actual customer authorization reference and confirm it was received. Approval alone is not authorization.");
      const kind=choice(req.body.authorization_kind,["Written acceptance","Signed statement of work","Purchase order","Rate authorization"]);
      const destination=text(req.body.handoff_destination||"Existing delivery systems",200),notes=text(req.body.handoff_notes||"",2000);
      await query("INSERT INTO activities (prospect_id,type,outcome,notes,occurred_on,actor) VALUES (?,'note',?,?,UTC_DATE(),?)",[p.id,handoffOutcome,JSON.stringify({quote_id:q.id,quote_number:q.quote_number,snapshot_hash:snapshot(q),authorization_kind:kind,authorization_reference:reference,handoff_destination:destination,handoff_notes:notes}),actor.email],c);
      await query("UPDATE businesses SET relationship_status='Customer' WHERE id=?",[p.business_id],c);
      await query("UPDATE prospects SET stage='Closed Won' WHERE id=?",[p.id],c);
      await audit(c,actor,"record customer work authorization","prospect",p.id);
    });
    await sync(await prospect(req.params.id),req.session.user);
    res.redirect(`/prospects/${req.params.id}/work`);
  });
  app.post("/prospects/:id/project-lost",ownerOnly,async(req,res)=>{
    await transaction(async c=>{
      const p=await prospect(req.params.id,c);if(!genericEngagement(p))fail("Use the existing Mark Lost workflow.");
      if(await salesHandoff(p.id,c,query))fail("A won and authorized sale cannot be marked lost. Review its handoff in the delivery system.",409);
      const reason=text(req.body.reason||"",1000);if(reason.length<5)fail("Record why this opportunity was lost.");
      await query("UPDATE prospects SET stage='Closed Lost',status='Lost' WHERE id=?",[p.id],c);
      await audit(c,req.session.user,("project opportunity lost: "+reason).slice(0,100),"prospect",p.id);
    });
    await sync(await prospect(req.params.id),req.session.user);
    res.redirect(`/prospects/${req.params.id}/work`);
  });
  app.get("/admin/project-pricing",adminOnly,async(_req,res)=>{
    const config=await projectConfig(query);res.render("project-pricing-config",{config});
  });
  app.post("/admin/project-pricing",adminOnly,async(req,res)=>{
    const optional=(value,max,places=2)=>{if(value===""||value===undefined)return null;if(!new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(String(value))||Number(value)>max)fail("Enter valid configured rates.");return Number(value);};
    const rate=optional(req.body.hourly_rate,10000000),minimum=optional(req.body.minimum_hours,999999.99)||0;
    await transaction(async c=>{await query("INSERT INTO config_prices (name,amount) VALUES ('project_minimum_hours',?) ON DUPLICATE KEY UPDATE amount=VALUES(amount)",[minimum],c);if(rate===null)await query("DELETE FROM config_prices WHERE name='project_hourly_rate'",[],c);else await query("INSERT INTO config_prices (name,amount) VALUES ('project_hourly_rate',?) ON DUPLICATE KEY UPDATE amount=VALUES(amount)",[rate],c);await audit(c,req.session.user,"configure project/hourly pricing","config_prices","project_estimates");});res.redirect("/admin/project-pricing");
  });
}
