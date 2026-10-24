import { query } from "../db.js";
import { integer } from "../security.js";
import { quoteSend } from "../quote-permissions.js";
export function proposalRoutes(app,{run:read=query,advance=async(...args)=>{
  const {proposalPreparation}=await import("./proposal-runtime.js");
  return proposalPreparation.advance(...args);
},warn=console.warn}={}) {
  app.get("/quotes/:id/preparation",quoteSend,async(req,res)=>{
    const id=integer(req.params.id),[q]=await read("SELECT * FROM quotes WHERE id=?",[id]);
    if(!q)throw Object.assign(new Error("Quote not found."),{status:404});
    const [state]=await read("SELECT step,error_message FROM quote_proposal_states WHERE quote_id=?",[id]);
    const run=req.query.run==="yes" && req.session.proposalRuns?.[id]===true;
    if(req.session.proposalRuns)delete req.session.proposalRuns[id];
    res.render("quote-preparation",{q,state:state||null,run});
  });
  app.post("/quotes/:id/prepare",quoteSend,async(req,res)=>{
    const id=integer(req.params.id);
    let result;
    try {result=await advance(id,req.session.user);}
    catch(error){
      if(!Number.isInteger(error.status)||error.status<400||error.status>=500)throw error;
      warn("Quote preparation refused:",{quoteId:id,status:error.status,message:error.message});
      res.status(error.status);
      if(req.accepts(["json","html"])==="json")return res.json({error:error.message});
      return res.render("error",{message:error.message,returnUrl:`/quotes/${id}/preparation`});
    }
    if(req.accepts(["json","html"])==="json")return res.json(result);
    res.redirect(result.done?`/quotes/${req.params.id}/delivery`:`/quotes/${req.params.id}/preparation?run=yes`);
  });
}
