import { query } from "../db.js";
import { integer } from "../security.js";
import { quoteSend } from "../quote-permissions.js";
export function proposalRoutes(app) {
  app.get("/quotes/:id/preparation",quoteSend,async(req,res)=>{
    const id=integer(req.params.id),[q]=await query("SELECT * FROM quotes WHERE id=?",[id]);
    if(!q)throw Object.assign(new Error("Quote not found."),{status:404});
    const [state]=await query("SELECT step,error_message FROM quote_proposal_states WHERE quote_id=?",[id]);
    const run=req.query.run==="yes" && req.session.proposalRuns?.[id]===true;
    if(req.session.proposalRuns)delete req.session.proposalRuns[id];
    res.render("quote-preparation",{q,state:state||null,run});
  });
  app.post("/quotes/:id/prepare",quoteSend,async(req,res)=>{
    const {proposalPreparation}=await import("./proposal-runtime.js");
    const result=await proposalPreparation.advance(integer(req.params.id),req.session.user);
    if(req.accepts(["json","html"])==="json")return res.json(result);
    res.redirect(result.done?`/quotes/${req.params.id}/delivery`:`/quotes/${req.params.id}/preparation?run=yes`);
  });
}
