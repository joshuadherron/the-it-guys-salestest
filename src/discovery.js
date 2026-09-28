import { screens, sectionFor, requiredProgress } from "./discovery-ui.js";
import { query, transaction, audit, json } from "./db.js";
import { prospect } from "./pipeline.js";
import {
  schema,
  ownership,
  emptyAnswers,
  flags,
  mvd,
  holdTransition,
  format,
  majorFlagOrder,
  answer,
} from "./discovery-rules.js";
import { validateAnswer } from "./discovery-validation.js";
import { integer, ownerOnly, text, fail } from "./security.js";
import { queueNotice, deliverNotice } from "./notifications.js";
export async function discovery(id, c) {
  const [d] = await query(
    "SELECT * FROM discoveries WHERE prospect_id=?",
    [id],
    c,
  );
  return d
    ? { ...d, exists: true, answers: json(d.answers), flags: json(d.flags) }
    : {
        exists: false,
        prospect_id: id,
        answers: emptyAnswers(),
        status: "Draft",
        revision: 0,
        flags: [],
      };
}
export async function renderDiscoverySummary(
  req,
  res,
  loaders = { prospect, discovery },
) {
  const p = await loaders.prospect(req.params.id),
    d = await loaders.discovery(p.id);
  res.render("discovery-summary", {
    p,
    d,
    schema,
    format,
    answer,
    majorFlagOrder,
    completedGroups: 8 - mvd(d.answers).length,
  });
}
export function discoveryRoutes(app) {
  app.get("/prospects/:id/discovery/summary", (req, res) =>
    renderDiscoverySummary(req, res),
  );
  app.get("/prospects/:id/discovery/:screen", async (req, res) => {
    const p = await prospect(req.params.id);
    const d = await discovery(p.id);
    const screen = integer(req.params.screen, 9);
    if (screen < 1) fail("Unknown screen.");
    if (screen > 3) return res.redirect(`/prospects/${p.id}/discovery/3`);
    res.render("discovery", {
      p,
      d,
      screen,
      schema,
      screens,
      sectionFor,
      progress: requiredProgress(d.answers),
      ownership,
      format,
      answer,
      majorFlagOrder,
      notifications: await query(
        "SELECT kind,status FROM notifications WHERE prospect_id=? ORDER BY id DESC LIMIT 5",
        [p.id],
      ),
      missing: mvd(d.answers),
      readonly:
        d.status === "Ready for Review" && req.session.user.role !== "owner",
    });
  });
  app.post("/prospects/:id/discovery/save", async (req, res) => {
    let notice;
    const result = await transaction(async (c) => {
      const [locked] = await query(
        "SELECT id FROM prospects WHERE id=? FOR UPDATE",
        [integer(req.params.id)],
        c,
      );
      if (!locked) fail("Opportunity not found.", 404);
      const p = await prospect(req.params.id, c);
      const d = await discovery(p.id, c);
      if (d.status === "Ready for Review" && req.session.user.role !== "owner")
        fail("Josh must reopen discovery before editing.", 403);
      if (integer(req.body.revision) !== d.revision)
        fail(
          "This discovery changed in another tab. Reload before continuing.",
          409,
        );
      const a = {
        ...d.answers,
        [req.body.question]: validateAnswer(req.body.question, req.body.answer),
      };
      const state = holdTransition({
        hold: p.hold,
        before: d.answers,
        after: a,
      });
      const revision = d.revision + 1;
      const f = flags(a);
      await query(
        "INSERT INTO discoveries (prospect_id,answers,flags,revision) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE answers=VALUES(answers),flags=VALUES(flags),revision=VALUES(revision)",
        [p.id, JSON.stringify(a), JSON.stringify(f), revision],
        c,
      );
      await query(
        "INSERT INTO discovery_versions (prospect_id,revision,answers,actor) VALUES (?,?,?,?)",
        [p.id, revision, JSON.stringify(a), req.session.user.email],
        c,
      );
      await query(
        "UPDATE prospects SET hold=? WHERE id=?",
        [state.hold, p.id],
        c,
      );
      await query(
        "UPDATE quotes SET status='Draft',approved_by=NULL,approved_at=NULL WHERE prospect_id=? AND status='Approved'",
        [p.id],
        c,
      );
      await audit(c, req.session.user, "save discovery", "prospect", p.id);
      if (state.notify)
        notice = await queueNotice(c, p, "URGENT SECURITY REVIEW");
      return {
        revision,
        hold: state.hold,
        missing: mvd(a),
        progress: requiredProgress(a),
      };
    });
    const notification = await deliverNotice(notice);
    res.json({ ...result, notification });
  });
  app.post("/prospects/:id/discovery/send", async (req, res) => {
    let notice;
    await transaction(async (c) => {
      await query(
        "SELECT id FROM prospects WHERE id=? FOR UPDATE",
        [integer(req.params.id)],
        c,
      );
      const p = await prospect(req.params.id, c);
      const d = await discovery(p.id, c);
      if (p.hold) fail("On Hold — Pending Josh Review");
      if (mvd(d.answers).length) fail("Complete the missing MVD groups first.");
      if (d.status === "Ready for Review") fail("Already sent to Josh.");
      await query(
        "UPDATE discoveries SET status='Ready for Review' WHERE prospect_id=?",
        [p.id],
        c,
      );
      await audit(c, req.session.user, "send to Josh", "discovery", p.id);
      notice = await queueNotice(c, p, "Ready for Review");
    });
    await deliverNotice(notice);
    res.redirect(`/prospects/${req.params.id}/discovery/summary`);
  });
  app.post("/prospects/:id/discovery/reopen", ownerOnly, async (req, res) => {
    await transaction(async (c) => {
      await query(
        "UPDATE discoveries SET status='Draft' WHERE prospect_id=?",
        [integer(req.params.id)],
        c,
      );
      await audit(c, req.session.user, "reopen", "discovery", req.params.id);
    });
    res.redirect(`/prospects/${req.params.id}/discovery/summary`);
  });
  app.post("/prospects/:id/discovery/release", ownerOnly, async (req, res) => {
    const note = text(req.body.note || "");
    holdTransition({ action: "release", role: req.session.user.role, note });
    await transaction(async (c) => {
      await query(
        "UPDATE prospects SET hold=FALSE WHERE id=?",
        [integer(req.params.id)],
        c,
      );
      await query(
        "INSERT INTO activities (prospect_id,type,outcome,notes,occurred_on,actor) VALUES (?,'note','Other',?,UTC_DATE(),?)",
        [
          integer(req.params.id),
          "Release hold: " + note,
          req.session.user.email,
        ],
        c,
      );
      await audit(
        c,
        req.session.user,
        "release urgent hold",
        "prospect",
        req.params.id,
      );
    });
    res.redirect(`/prospects/${req.params.id}/discovery/summary`);
  });
}
