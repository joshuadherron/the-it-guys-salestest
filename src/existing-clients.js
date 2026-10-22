import { query, transaction, audit, json } from "./db.js";
import { prospect } from "./pipeline.js";
import { sp } from "./handoff.js";
import { ownerOnly, text, choice, integer, fail } from "./security.js";
import { lanes } from "./config.js";
import { isExisting, additionalFields, additionalAnswers, clientSummary, selectClient } from "./existing-client-rules.js";
import { genericEngagement,projectLane } from "./engagement-types.js";
import { linkBusinessRecord } from "./businesses.js";
export function existingClientRoutes(app, deps = { query, transaction, audit, prospect, sp }) {
  const { query, transaction, audit, prospect, sp } = deps;
  app.get("/prospects/:id/relationship", ownerOnly, async (req, res) => {
    const p = await prospect(req.params.id);
    const q = text(String(req.query.q || ""), 200);
    let clients = [], error = null;
    try {
      const schema = sp.ready();
      clients = (await sp.clients()).map(r => clientSummary(r, schema)).filter(r =>
        !q || `${r.Title} ${r["Client ID"]}`.toLowerCase().includes(q.toLowerCase()));
    } catch { error = "SharePoint clients could not be loaded. Check the connection before linking."; }
    res.render("client-relationship", { p, q, clients, error, lanes:genericEngagement(p)?[projectLane]:lanes });
  });
  app.post("/prospects/:id/relationship", ownerOnly, async (req, res) => {
    await transaction(async c => {
      const p = await prospect(req.params.id, c);
      if (p.hold) fail("Release the urgent hold before changing the relationship.");
      if (p.client_id) fail("This opportunity already has a client. Its relationship cannot be reassigned.");
      if ((await query("SELECT id FROM sp_requests WHERE prospect_id=? AND status NOT IN ('Failed','Rejected','Dryrun')", [p.id], c)).length)
        fail("Reconcile existing SharePoint requests before linking a client.");
      const type = choice(req.body.relationship_type, ["new_client", "existing_client"]);
      const client = type === "existing_client" ? selectClient(await sp.clients(), text(req.body.client_id || "", 80), sp.ready()) : null;
      const lane = genericEngagement(p)?projectLane:type === "existing_client" ? choice(req.body.service_lane, lanes) : p.service_lane;
      await query("UPDATE prospects SET relationship_type=?,client_id=?,client_item_id=?,service_lane=? WHERE id=?", [type, client?.["Client ID"] || null, client?.itemId || null, lane, p.id], c);
      if(client)await linkBusinessRecord(p,client["Client ID"],client.itemId,c,query);
      await audit(c, req.session.user, "set customer relationship", "prospect", p.id);
    });
    res.redirect(`/prospects/${req.params.id}`);
  });
  app.get("/prospects/:id/additional-discovery", async (req, res) => {
    const p = await prospect(req.params.id);
    if (!isExisting(p)) fail("Additional Service Discovery is for existing customers.");
    const [record] = await query("SELECT * FROM additional_service_discoveries WHERE prospect_id=?", [p.id]);
    let client = null, error = null;
    try { client = clientSummary(await sp.client(p), sp.ready()); } catch { error = "Live SharePoint client status is unavailable."; }
    res.render("additional-discovery", { p, fields: additionalFields, answers: record ? json(record.answers) : {}, revision: record?.revision || 0, complete: Boolean(record?.complete), clientRecord: client, error });
  });
  app.post("/prospects/:id/additional-discovery", async (req, res) => {
    await transaction(async c => {
      const p = await prospect(req.params.id, c);
      if (!isExisting(p) || !p.client_id) fail("Link an existing SharePoint client first.");
      if (p.hold) fail("Release the urgent hold before editing discovery.");
      const [record] = await query("SELECT * FROM additional_service_discoveries WHERE prospect_id=?", [p.id], c);
      if (record?.complete && req.session.user.role !== "owner") fail("Josh must reopen Additional Service Discovery before editing.", 403);
      if (integer(req.body.revision) !== (record?.revision || 0)) fail("Discovery changed in another tab. Reload first.", 409);
      const complete = req.body.complete === "yes";
      const answers = additionalAnswers(req.body, complete);
      await query("INSERT INTO additional_service_discoveries (prospect_id,answers,revision,complete,updated_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE answers=VALUES(answers),revision=VALUES(revision),complete=VALUES(complete),updated_by=VALUES(updated_by)", [p.id, JSON.stringify(answers), (record?.revision || 0) + 1, complete, req.session.user.email], c);
      await audit(c, req.session.user, complete ? "complete additional discovery" : "save additional discovery", "prospect", p.id);
    });
    res.redirect(`/prospects/${req.params.id}`);
  });
}
