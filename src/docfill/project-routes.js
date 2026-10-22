import { query,transaction,audit,json } from "../db.js";
import { prospect } from "../pipeline.js";
import { integer,fail } from "../security.js";
import { quoteSend,canQuote } from "../quote-permissions.js";
import { genericEngagement } from "../engagement-types.js";
import { quoteLane,quoteFillMode } from "./policy.js";
import { snapshot } from "./delivery-store.js";
import { buildProjectFill } from "./project-fields.js";
import { assertTagset } from "./tagsets.js";
import { listTags,fillDocx } from "./fill-docx.js";
import { SharePointQuotes } from "./sharepoint-quotes.js";
import { sp } from "../sharepoint-runtime.js";
import { graph } from "../graph.js";
import { assertProjectApproval } from "../project-quotes.js";
export function projectDocumentRoutes(app,deps={query,transaction,audit,prospect,resolver:new SharePointQuotes(sp,graph),env:process.env}) {
  const {query,transaction,audit,prospect,resolver,env}=deps;
  async function context(req) {
    const [q]=await query("SELECT * FROM quotes WHERE id=?",[integer(req.params.id)]);
    if(!q)fail("Quote not found.",404);
    const p=await prospect(q.prospect_id);
    if(!genericEngagement(p))fail("Use the Managed IT/BII document workflow.");
    if(q.status!=="Approved")fail("Approve the project/hourly quote before preparing a document.",409);
    await assertProjectApproval(p,q);
    return {q,p};
  }
  app.get("/quotes/:id/project-document",quoteSend,async(req,res)=>{
    const {q,p}=await context(req);let lane=null,error=null;
    try {lane=quoteLane(json(q.inputs),undefined,env);}catch(e){error=e.message;}
    res.render("project-document",{q,p,lane,error,fillMode:quoteFillMode(env)});
  });
  app.post("/quotes/:id/project-document",quoteSend,async(req,res)=>{
    if(quoteFillMode(env)==="off")fail("Document fill is disabled.",403);
    const {q,p}=await context(req),lane=quoteLane(json(q.inputs),undefined,env),hash=snapshot(q);
    // No generic template is bundled or represented as approved. Always read the
    // exact configured Approved master; previews never write to SharePoint.
    const master=await resolver.master(lane.key);
    assertTagset(lane.key,await listTags(master.content));
    const {buffer,report}=await fillDocx(master.content,buildProjectFill({quote:{...q,inputs:json(q.inputs)},prospect:p}));
    if(report.unfilled.length)fail("The proposed template has unresolved fields: "+report.unfilled.join(", "),409);
    await transaction(async c=>{
      await prospect(p.id,c);
      const [current]=await query("SELECT * FROM quotes WHERE id=? FOR UPDATE",[q.id],c);
      const [actor]=await query("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[req.session.user.email],c);
      if(current?.status!=="Approved"||snapshot(current)!==hash||!canQuote(actor,"quote.send"))fail("Approval, pricing or permission changed. Reload before preparing.",409);
      await audit(c,actor,"preview project document "+lane.key,"quote",q.id);
    });
    if(req.body.action==="FillSharePoint") {
      req.session.proposalRuns ||= {};req.session.proposalRuns[q.id]=true;
      return res.redirect(`/quotes/${q.id}/preparation?run=yes`);
    }
    res.set("Cache-Control","no-store");
    res.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.set("Content-Disposition",`attachment; filename="TIG-${lane.key}-${q.id}-REVIEW.docx"`);
    res.send(buffer);
  });
}
