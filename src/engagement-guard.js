import { prospect } from "./pipeline.js";
import { query,json } from "./db.js";
import { genericEngagement,genericPricing } from "./engagement-types.js";
import { fail } from "./security.js";
// Existing endpoints remain available to historical opportunities. Generic
// opportunities cannot submit legacy lane commands against a shared customer.
export function engagementGuard(deps={prospect,query}) {
  return async(req,res,next)=>{
    const match=req.path.match(/^\/prospects\/(\d+)\/(discovery(?:\/.*)?|quotes(?:\/.*)?|handoff|mark-lost|additional-discovery|work-items|signature|workflow-panel)$/);
    if(match&&genericEngagement(await deps.prospect(match[1]))) {
      if(req.method==="POST")fail("Use the project/hourly intake, quote and authorization workflow for this opportunity.",409);
      if(req.method==="GET")return res.redirect(`/prospects/${match[1]}/${match[2]==="handoff"?"project-sharepoint":match[2]==="quotes"?"project-quotes":"work"}`);
    }
    const quote=req.path.match(/^\/quotes\/(\d+)\/(approve|edit|print)$/);
    if(quote) {
      const [q]=await deps.query("SELECT * FROM quotes WHERE id=?",[Number(quote[1])]);
      if(q&&genericPricing(json(q.inputs))) {
        if(req.method==="GET"&&quote[2]==="print")return res.redirect(`/quotes/${q.id}/project-print`);
        if(req.method==="POST")fail("Use the project/hourly quote workflow; approved snapshots require a new draft revision.",409);
      }
    }
    next();
  };
}
