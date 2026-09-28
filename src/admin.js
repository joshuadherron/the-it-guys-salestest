import { lostReasons } from "./workflow-contract.js";
import { query, transaction, audit } from "./db.js";
import { ownerOnly, choice, text, integer, fail } from "./security.js";
import { sp } from "./handoff.js";
export function adminRoutes(app) {
  app.get("/admin", ownerOnly, async (req, res) =>
    res.render("admin", {
      lostReasons: await query(
        "SELECT * FROM config_lost_reasons ORDER BY sort_order",
      ),
      prices: await query("SELECT * FROM config_prices ORDER BY name"),
      stages: await query("SELECT * FROM config_stages ORDER BY sort_order"),
      stops: await query("SELECT * FROM config_stop_conditions ORDER BY id"),
      allowlist: await query("SELECT * FROM allowlist ORDER BY email"),
      logs: await query("SELECT * FROM audit_log ORDER BY id DESC LIMIT 200"),
      schema: sp.cache,
    }),
  );
  app.post("/admin/lost-reasons", ownerOnly, async (req, res) => {
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
  app.post("/admin/check", ownerOnly, async (req, res) => {
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
  app.post("/admin/prices", ownerOnly, async (req, res) => {
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
  app.post("/admin/stages", ownerOnly, async (req, res) => {
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
  app.post("/admin/stops", ownerOnly, async (req, res) => {
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
  app.post("/admin/allowlist", ownerOnly, async (req, res) => {
    const email = text(req.body.email, 254).toLowerCase();
    if (!/^[^\s@]+@theitguys\.us$/.test(email))
      fail("Use a theitguys.us account.");
    const role = choice(req.body.role, ["sales", "owner"]);
    const enabled = req.body.enabled === "yes";
    if (email === req.session.user.email && (!enabled || role !== "owner"))
      fail("Do not remove your own owner access.");
    await transaction(async (c) => {
      await query(
        "INSERT INTO allowlist (email,role,enabled) VALUES (?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role),enabled=VALUES(enabled)",
        [email, role, enabled],
        c,
      );
      await audit(c, req.session.user, "update allowlist", "allowlist", email);
    });
    res.redirect("/admin");
  });
}
