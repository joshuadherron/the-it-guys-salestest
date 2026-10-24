import { createHash } from "node:crypto";
import { query, transaction, audit } from "./db.js";
import { adminOnly, canQuote } from "./quote-permissions.js";
import { integer, fail } from "./security.js";
import { opportunity } from "./config.js";

const children = [
  ["activities", "Activities"], ["discoveries", "Discovery records"],
  ["discovery_versions", "Discovery revisions"], ["additional_service_discoveries", "Additional-service discovery"],
  ["notifications", "Local notification history"], ["sp_requests", "Local SharePoint request history"],
  ["quotes", "Quotes (including approved and sent)"],
];
async function summary(id, run, c) {
  const rows=[];
  for(const [table,label] of children) {
    const [count]=await run(`SELECT COUNT(*) AS total FROM ${table} WHERE prospect_id=?`,[id],c);
    rows.push({label,count:Number(count.total)});
  }
  for(const [table,label] of [["quote_fills","Quote fill history"],["quote_send_attempts","Quote delivery history"],["quote_proposal_states","Proposal preparation records"]]) {
    const [count]=await run(`SELECT COUNT(*) AS total FROM ${table} WHERE quote_id IN (SELECT id FROM quotes WHERE prospect_id=?)`,[id],c);
    rows.push({label,count:Number(count.total)});
  }
  return rows;
}
const reviewHash=(p,rows)=>createHash("sha256").update(JSON.stringify([p.id,p.business_name,p.client_id,p.updated_at,rows])).digest("hex");

export async function deletionBlock(p, run=query, c) {
  const [request]=await run("SELECT id FROM sp_requests WHERE prospect_id=? AND status IN ('Preparing','Pending','Processing','Unknown') LIMIT 1",[p.id],c);
  if(request)return "A SharePoint request is active or uncertain. Finish or reconcile it before deleting this prospect.";
  const [notification]=await run("SELECT id FROM notifications WHERE prospect_id=? AND status='Queued' LIMIT 1",[p.id],c);
  if(notification)return "A notification is queued or being delivered. Let it finish before deleting this prospect.";
  const [preparation]=await run("SELECT s.quote_id FROM quote_proposal_states s JOIN quotes q ON q.id=s.quote_id WHERE q.prospect_id=? AND s.operation_token IS NOT NULL LIMIT 1",[p.id],c);
  if(preparation)return "Proposal preparation is active or interrupted. Resume or reconcile it before deleting this prospect.";
  const [fill]=await run("SELECT f.id FROM quote_fills f JOIN quotes q ON q.id=f.quote_id WHERE q.prospect_id=? AND f.status IN ('Preparing','Unknown') LIMIT 1",[p.id],c);
  if(fill)return "A quote fill is active or uncertain. Reconcile it before deleting this prospect.";
  const [send]=await run("SELECT a.id FROM quote_send_attempts a JOIN quotes q ON q.id=a.quote_id WHERE q.prospect_id=? AND (a.status IN ('Preparing','PdfSaved','Sending','Unknown') OR (a.status='Failed' AND a.pdf_item_id IS NOT NULL)) LIMIT 1",[p.id],c);
  if(send)return "A quote delivery needs completion or reconciliation before deleting this prospect.";
  if(String(p.client_id||"").trim()) {
    const [operation]=await run("SELECT client_id FROM quote_operation_locks WHERE client_id=? LIMIT 1",[p.client_id],c);
    if(operation)return "A quote operation for this SharePoint record is active or uncertain. Reconcile it before deletion.";
  }
  return null;
}

export function prospectDeleteRoutes(app,deps={query,transaction,audit}) {
  const {query,transaction,audit}=deps;
  app.get("/prospects/:id/delete",adminOnly,async(req,res)=>{
    const id=integer(req.params.id),[p]=await query("SELECT * FROM prospects WHERE id=?",[id]);
    if(!p)fail("Prospect not found.",404);
    p.opp=opportunity(p.id);
    const rows=await summary(id,query),reason=await deletionBlock(p,query);
    req.session.prospectDeleteReviews ||= {};
    req.session.prospectDeleteReviews[id]=reviewHash(p,rows);
    res.render("prospect-delete",{p,rows,reason});
  });
  app.post("/prospects/:id/delete",adminOnly,async(req,res)=>{
    const id=integer(req.params.id);
    await transaction(async c=>{
      const [p]=await query("SELECT * FROM prospects WHERE id=? FOR UPDATE",[id],c);
      if(!p)fail("Prospect not found.",404);
      const [actor]=await query("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[req.session.user.email],c);
      if(!canQuote(actor,"admin"))fail("Admin permission is required.",403);
      p.opp=opportunity(p.id);
      if(req.body.confirmation!==p.opp||req.body.confirm_history!=="yes")fail("Enter the opportunity ID and confirm deletion of its local history.");
      if(p.client_id) {
        await query("INSERT IGNORE INTO client_request_locks (client_id) VALUES (?)",[p.client_id],c);
        await query("SELECT client_id FROM client_request_locks WHERE client_id=? FOR UPDATE",[p.client_id],c);
      }
      await query("SELECT id FROM quotes WHERE prospect_id=? ORDER BY id FOR UPDATE",[id],c);
      const reason=await deletionBlock(p,query,c);
      if(reason)fail(reason,409);
      const rows=await summary(id,query,c);
      if(req.session.prospectDeleteReviews?.[id]!==reviewHash(p,rows))fail("The prospect or its history changed. Reload the deletion page and review it again.",409);
      // Keep the audit trail outside the deleted dependency graph.
      await audit(c,actor,("delete prospect "+p.opp+" "+p.business_name).slice(0,100),"prospect",id);
      await audit(c,actor,("delete local history "+rows.map(r=>r.count).join("/")).slice(0,100),"prospect",id);
      // Delete in FK order; all statements are local and use the same transaction.
      for(const table of ["quote_quick_sends","quote_send_attempts","quote_proposal_states","quote_fills"])
        await query(`DELETE FROM ${table} WHERE quote_id IN (SELECT id FROM quotes WHERE prospect_id=?)`,[id],c);
      for(const [table] of children)
        await query(`DELETE FROM ${table} WHERE prospect_id=?`,[id],c);
      await query("DELETE FROM prospects WHERE id=?",[id],c);
    });
    if(req.session.prospectDeleteReviews)delete req.session.prospectDeleteReviews[id];
    res.redirect("/pipeline");
  });
}
