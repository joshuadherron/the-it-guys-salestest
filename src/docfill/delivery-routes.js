import { query,json } from "../db.js";
import { prospect } from "../pipeline.js";
import { integer } from "../security.js";
import { quoteSend } from "../quote-permissions.js";
import { quoteDelivery,deliveryStore } from "./delivery-runtime.js";
import { sendMode,senderMailbox,senderProfile } from "./send-policy.js";
import { quoteLane } from "./policy.js";
import { genericEngagement } from "../engagement-types.js";
export function quoteDeliveryRoutes(app,deps={query,prospect,delivery:quoteDelivery,store:deliveryStore}){
  const {query,prospect,delivery,store}=deps;
  app.get("/quotes/:id/delivery",quoteSend,async(req,res)=>{
    const [q]=await query("SELECT * FROM quotes WHERE id=?",[integer(req.params.id)]);
    if(!q)throw new Error("Quote not found.");
    const p=await prospect(q.prospect_id),fill=await store.latestFill(q.id);
    if(genericEngagement(p)&&json(q.inputs).pricingMode==="hourly_v1")return res.redirect(`/prospects/${p.id}/project-quotes?quote=${q.id}`);
    const attempts=await query("SELECT id,status,phase,mode,actor,sent_to,sent_cc,pdf_item_id,error_message,created_at FROM quote_send_attempts WHERE quote_id=? ORDER BY id DESC",[q.id]);
    const documentKey=quoteLane(json(q.inputs)).key;
    let reason=null;
    try{if(sendMode()==="off")throw new Error("QUOTE_SEND_MODE is off.");senderMailbox();senderProfile(req.session.user);if(q.status!=="Approved"||p.hold)throw new Error("Quote must be Approved and not On Hold.");if(!fill||fill.mode!=="live"||fill.status!=="Succeeded")throw new Error("A successful live fill is required.");if(!["COM-PRP","ENG-PRJ"].includes(fill?.document_key))throw new Error("BII sending remains manual eSignature.");}catch(e){reason=e.message;}
    res.render("quote-delivery",{q,p,fill,attempts,reason,documentKey,report:fill?json(fill.report):null,sendMode:sendMode()});
  });
  app.post("/quotes/:id/send",quoteSend,async(req,res)=>{
    await delivery.send(integer(req.params.id),req.session.user,{...req.body,retryId:req.body.retryId?integer(req.body.retryId):undefined});
    res.redirect(`/quotes/${req.params.id}/delivery`);
  });
}
