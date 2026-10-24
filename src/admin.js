import { reconcileQuoteDelivery } from "./docfill/reconcile.js";
import { adminOnly } from "./quote-permissions.js";
import { DEFAULT_SUBJECT, DEFAULT_BODY, validateEmailTemplate } from "./docfill/send-policy.js";
import { lostReasons } from "./workflow-contract.js";
import { query, transaction, audit } from "./db.js";
import { choice, text, integer, fail } from "./security.js";
import { sp } from "./handoff.js";
import { dispatchProspectSync, prospectSyncEnabled } from "./prospect-sync.js";
import { projectCapability } from "./project-contract.js";
export function adminRoutes(app) {
  app.get("/admin", adminOnly, async (req, res) =>
    res.render("admin", {
      quoteEmail: (await query("SELECT * FROM config_quote_email WHERE id=1"))[0] || {subject_template:DEFAULT_SUBJECT,body_template:DEFAULT_BODY},
      quoteMailbox: process.env.QUOTE_SENDER_MAILBOX || "Not configured",
      uncertainFills: await query("SELECT id,quote_id,client_id FROM quote_fills WHERE status='Unknown' ORDER BY id DESC"),
      uncertainSends: await query("SELECT id,quote_id,client_id,phase,pdf_item_id FROM quote_send_attempts WHERE status='Unknown' ORDER BY id DESC"),
      lostReasons: await query(
        "SELECT * FROM config_lost_reasons ORDER BY sort_order",
      ),
      prices: await query("SELECT * FROM config_prices ORDER BY name"),
      stages: await query("SELECT * FROM config_stages ORDER BY sort_order"),
      stops: await query("SELECT * FROM config_stop_conditions ORDER BY id"),
      allowlist: await query("SELECT * FROM allowlist ORDER BY email"),
      logs: await query("SELECT * FROM audit_log ORDER BY id DESC LIMIT 200"),
      schema: sp.cache,
      projectPrerequisites: projectCapability(sp.cache),
      prospectSyncEnabled: prospectSyncEnabled(),
      prospectCount: (await query("SELECT COUNT(*) count FROM prospects"))[0].count,
      prospectSyncSummary: await query(
        "SELECT status,COUNT(*) count FROM sp_requests WHERE action='UpsertProspect' GROUP BY status ORDER BY status",
      ),
    }),
  );
  app.post("/admin/prospect-backfill", adminOnly, async (req, res) => {
    if (!prospectSyncEnabled())
      fail("Prospect sync is disabled. Configure SharePoint, then set PROSPECT_SYNC_ENABLED=true.");
    const prospects = await query("SELECT * FROM prospects ORDER BY id");
    for (const p of prospects)
      await dispatchProspectSync(p, req.session.user);
    await audit(
      undefined,
      req.session.user,
      "backfill prospects to SharePoint",
      "prospect",
      String(prospects.length),
    );
    res.redirect("/admin");
  });
  app.post("/admin/lost-reasons", adminOnly, async (req, res) => {
    const reason = choice(req.body.reason, lostReasons);
    await transaction(async (c) => {
      await query(
        "UPDATE config_lost_reasons SET sort_order=?,enabled=? WHERE reason=?",
        [integer(req.body.sort_order), req.body.enabled === "yes", reason],
        c,
      );
      await audit(
        c,
        req.session.user,
        "configure lost reason",
        "config_lost_reasons",
        reason,
      );
    });
    res.redirect("/admin");
  });
  app.post("/admin/check", adminOnly, async (req, res) => {
    await sp.check();
    await audit(
      undefined,
      req.session.user,
      "check SharePoint",
      "connection",
      "site",
    );
    res.redirect("/admin");
  });
  app.post("/admin/prices", adminOnly, async (req, res) => {
    const name = text(req.body.name, 80),
      amount = text(req.body.amount, 30);
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) > 100000000)
      fail("Invalid price.");
    if (name.startsWith("included_")) integer(amount);
    await transaction(async (c) => {
      await query(
        "UPDATE config_prices SET amount=? WHERE name=?",
        [amount, name],
        c,
      );
      await query(
        "UPDATE quotes SET status='Draft',approved_by=NULL,approved_at=NULL WHERE status='Approved'",
        [],
        c,
      );
      await audit(
        c,
        req.session.user,
        "update price and invalidate approvals",
        "config_prices",
        name,
      );
    });
    res.redirect("/admin");
  });
  app.post("/admin/stages", adminOnly, async (req, res) => {
    await transaction(async (c) => {
      await query(
        "UPDATE config_stages SET sort_order=? WHERE name=?",
        [integer(req.body.sort_order), text(req.body.name, 80)],
        c,
      );
      await audit(
        c,
        req.session.user,
        "reorder stage",
        "config_stages",
        req.body.name,
      );
    });
    res.redirect("/admin");
  });
  app.post("/admin/stops", adminOnly, async (req, res) => {
    const label = text(req.body.label, 200);
    if (!label) fail("Stop condition needs a label.");
    await transaction(async (c) => {
      if (req.body.id)
        await query(
          "UPDATE config_stop_conditions SET label=?,status=? WHERE id=?",
          [
            label,
            choice(req.body.status, ["TODO-OWNER", "Owner confirmed"]),
            integer(req.body.id),
          ],
          c,
        );
      else
        await query(
          "INSERT INTO config_stop_conditions (label,status) VALUES (?,'Owner confirmed')",
          [label],
          c,
        );
      await query(
        "UPDATE quotes SET status='Draft',approved_by=NULL,approved_at=NULL WHERE status='Approved'",
        [],
        c,
      );
      await audit(
        c,
        req.session.user,
        "update stop condition",
        "config_stop_conditions",
        req.body.id || "new",
      );
    });
    res.redirect("/admin");
  });
  app.post("/admin/quote-reconcile", adminOnly, async(req,res)=>{
    await reconcileQuoteDelivery(req.body,req.session.user,{query,transaction,audit});
    res.redirect("/admin");
  });
  app.post("/admin/quote-email", adminOnly, async(req,res)=>{
    const subject=text(req.body.subject_template||"",250),body=text(req.body.body_template||"",12000);
    validateEmailTemplate(subject,body);
    await transaction(async c=>{
      await query("UPDATE config_quote_email SET subject_template=?,body_template=? WHERE id=1",[subject,body],c);
      await audit(c,req.session.user,"configure quote email template","config_quote_email",1);
    });
    res.redirect("/admin");
  });
  app.post("/admin/allowlist", adminOnly, async (req, res) => {
    const email = text(req.body.email, 254).toLowerCase();
    if (!/^[^\s@]+@theitguys\.us$/.test(email))
      fail("Use a theitguys.us account.");
    const role = choice(req.body.role, ["sales", "owner"]);
    const enabled = req.body.enabled === "yes";
    if (email === req.session.user.email && (!enabled || req.body.is_admin !== "yes"))
      fail("Do not remove your own admin access.");
    await transaction(async (c) => {
      await query(
        "INSERT INTO allowlist (email,role,enabled,is_admin,quote_approve,quote_send,display_name,sender_title,sender_phone) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role),enabled=VALUES(enabled),is_admin=VALUES(is_admin),quote_approve=VALUES(quote_approve),quote_send=VALUES(quote_send),display_name=VALUES(display_name),sender_title=VALUES(sender_title),sender_phone=VALUES(sender_phone)",
        [email, role, enabled,req.body.is_admin==="yes",req.body.quote_approve==="yes",req.body.quote_send==="yes",text(req.body.display_name||"",200),text(req.body.sender_title||"",200),text(req.body.sender_phone||"",80)],
        c,
      );
      await audit(c, req.session.user, "update allowlist", "allowlist", email);
    });
    if (req.get("Accept")?.includes("application/json")) return res.json({ok:true,email,displayName:text(req.body.display_name||"",200),role});
    res.redirect("/admin#user-permissions");
  });
}
