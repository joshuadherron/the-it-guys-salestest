import { intakeSelect } from "./engagement-intake.js";
import { randomUUID } from "node:crypto";
import { query,transaction,audit } from "./db.js";
import { prospect } from "./pipeline.js";
import { graph } from "./graph.js";
import { sp,lookupId } from "./sharepoint-runtime.js";
import { refresh } from "./handoff.js";
import { quoteSend,canQuote } from "./quote-permissions.js";
import { fail,integer } from "./security.js";
import { genericEngagement,projectLane,engagementTypes } from "./engagement-types.js";
import { assertProjectCapability,projectCapability,projectDiscovery } from "./project-contract.js";
import { buildFields,assertNoPending,submitRequest } from "./sharepoint.js";
import { duplicateClients } from "./existing-client-rules.js";
import { linkBusinessRecord,lockBusinessRequests } from "./businesses.js";

export function projectSharePointRoutes(app,deps={query,transaction,audit,prospect,sp,graph,refresh,env:process.env}) {
  const {query,transaction,audit,prospect,sp,graph,refresh,env}=deps;
  app.get("/prospects/:id/project-sharepoint",quoteSend,async(req,res)=>{
    const p=await prospect(req.params.id);if(!genericEngagement(p))return res.redirect(`/prospects/${p.id}/handoff`);
    let error=null,record=null,prerequisites=[];
    try {const s=sp.ready();await refresh(p,{sp,query,transaction,audit});record=await sp.client(p);if(!record)prerequisites=projectCapability(s);}catch(e){error=e.message;}
    const requests=await query("SELECT * FROM sp_requests WHERE prospect_id IN (SELECT id FROM prospects WHERE business_id=?) ORDER BY id DESC LIMIT 30",[p.business_id]);
    const quoteId=req.query.quote?integer(req.query.quote):null;
    res.render("project-sharepoint",{p,record,error,prerequisites,requests,engagementTypes,projectLane,quoteId});
  });
  app.post("/prospects/:id/project-sharepoint",quoteSend,async(req,res)=>{
    let body,id;
    const schema=sp.ready();
    await transaction(async c=>{
      const p=await prospect(req.params.id,c);
      if(!genericEngagement(p)||p.hold||p.stage==="Closed Lost")fail("Only a project/hourly opportunity without a hold or loss can open a project record.",409);
      const [actor]=await query("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[req.session.user.email],c);
      if(!canQuote(actor,"quote.send"))fail("Permission quote.send is required.",403);
      await lockBusinessRequests(p,query,c);
      const existing=await sp.client(p);
      if(existing) {
        const clientId=existing.fields[schema.maps.clients["Client ID"].name];
        if(!clientId)fail("The existing record is awaiting its Client ID. Wait for the flow.",409);
        await linkBusinessRecord(p,clientId,existing.id,c,query);
        await audit(c,actor,"reuse SharePoint business record","prospect",p.id);
        return;
      }
      if(p.client_id)fail("The linked SharePoint record could not be verified. Reconcile the existing ID; another record will not be created.",409);
      assertProjectCapability(schema);
      const [intake]=await query(intakeSelect,[p.id],c);
      let quote;
      if(req.body.quote_id){
        [quote]=await query("SELECT * FROM quotes WHERE id=? AND prospect_id=?",[integer(req.body.quote_id),p.id],c);
        if(!quote)fail("Quote not found for this opportunity.",404);
      }
      const discovery=projectDiscovery(p,intake,quote);
      if(duplicateClients(p,await sp.clients(),schema).length)fail("A possible SharePoint customer already exists. Link it on Customer relationship before creating a record.",409);
      assertNoPending(await sp.requests(),schema,p);
      if(env.SHAREPOINT_WRITE_MODE!=="live")fail("Project SharePoint creation is disabled until Workflow Requests live mode is explicitly configured. Nothing was sent.",409);
      body=buildFields(schema,"CreateClient",p,projectLane,actor.email,new Date(),lookupId(actor.email),{discovery},env);
      body.fields[schema.maps.requests.Title.name]=`SALESAPP-${p.opp}-BUSINESS-${p.business_id}-${randomUUID()}`;
      const r=await query("INSERT INTO sp_requests (prospect_id,action,request_json,status) VALUES (?,'CreateClient',?,'Preparing')",[p.id,JSON.stringify(body)],c);id=r.insertId;
      await audit(c,actor,"prepare "+projectLane+" business record","sp_request",id);
    });
    if(body)try {
      const result=await submitRequest(graph,env.SHAREPOINT_WRITE_MODE,schema,body);
      await query("UPDATE sp_requests SET status=?,item_id=? WHERE id=?",[result.status,result.itemId,id]);
    }catch(e){await query("UPDATE sp_requests SET status='Unknown',result_message=? WHERE id=?",["Delivery uncertain; reconcile the exact request title. "+e.message,id]);fail("SharePoint delivery is uncertain. Reconcile the existing request before retrying.",409);}
    res.redirect(`/prospects/${req.params.id}/project-sharepoint`);
  });
}
