import { discoverySnapshot } from "./discovery-export.js";
import {
  businessNameError,
  canMarkLost,
  lostReasons,
} from "./workflow-contract.js";
import { graph } from "./graph.js";
import {
  SharePoint,
  buildFields,
  assertNoPending,
  submitRequest,
  plainResult,
} from "./sharepoint.js";
import { query, transaction, audit, json } from "./db.js";
import { prospect } from "./pipeline.js";
import { discovery } from "./discovery.js";
import { mvd } from "./discovery-rules.js";
import { ownerOnly, integer, choice, text, fail } from "./security.js";
import { lanes } from "./config.js";
export const sp = new SharePoint(graph);
export const lookupId = (email) =>
  email === "alanna@theitguys.us"
    ? process.env.SP_ALANNA_USER_LOOKUP_ID
    : email === "josh@theitguys.us"
      ? process.env.SP_JOSH_USER_LOOKUP_ID
      : undefined;
export async function refresh(
  p,
  dependencies = { sp, query, transaction, audit },
) {
  const { sp, query, transaction, audit } = dependencies;
  const s = sp.ready();
  const rows = await query(
    "SELECT * FROM sp_requests WHERE prospect_id=? AND item_id IS NOT NULL AND (status IN ('Preparing','Pending','Processing','Unknown') OR (action='CreateClient' AND status='Done' AND ? IS NULL))",
    [p.id, p.client_id || null],
  );
  for (const r of rows) {
    let remote;
    try {
      remote = await sp.request(r.item_id);
    } catch (e) {
      if (e?.status === 404) {
        await applyRequestStatus(
          p,
          r,
          "Failed",
          "The SharePoint Workflow Request no longer exists (HTTP 404). No retry was sent automatically.",
          { query, transaction, audit },
        );
        console.warn("SharePoint workflow request missing:", {
          localRequestId: r.id,
          remoteItemId: r.item_id,
          action: r.action,
        });
        continue;
      }
      throw e;
    }
    const status = remote.fields[s.maps.requests["Processing Status"].name];
    const message = remote.fields[s.maps.requests["Result Message"].name] || "";
    if (["Done", "Rejected"].includes(status) && status !== r.status)
      sp.invalidateWorkItems?.(p.client_id);
    if (
      status !== r.status ||
      message !== (r.result_message || "") ||
      (status === "Done" && r.action === "MarkLost")
    )
      await applyRequestStatus(p, r, status, message, {
        query,
        transaction,
        audit,
      });
    if (status === "Done" && r.action === "CreateClient") {
      const client = await sp.client(p);
      if (client) {
        const id = client.fields[s.maps.clients["Client ID"].name];
        if (
          id &&
          (p.client_id !== id || String(p.client_item_id) !== String(client.id))
        ) {
          await transaction(async (c) => {
            await query(
              "UPDATE prospects SET client_id=?,client_item_id=? WHERE id=?",
              [id, client.id, p.id],
              c,
            );
            await audit(
              c,
              { email: "system" },
              "link SharePoint client",
              "prospect",
              p.id,
            );
          });
          p.client_id = id;
          p.client_item_id = client.id;
        }
      }
    }
  }
  const client = await sp.client(p);
  if (!client) return null;
  return Object.fromEntries(
    ["Client ID", "Current Stage", "Stage Status", "Next Action"].map((k) => [
      k,
      client.fields[s.maps.clients[k].name] ?? "Not supplied",
    ]),
  );
}
export async function applyRequestStatus(
  p,
  r,
  status,
  message,
  dependencies = { query, transaction, audit },
) {
  const { query, transaction, audit } = dependencies;
  await transaction(async (c) => {
    await query("SELECT id FROM prospects WHERE id=? FOR UPDATE", [p.id], c);
    await query(
      "UPDATE sp_requests SET status=?,result_message=? WHERE id=?",
      [status, message, r.id],
      c,
    );
    if (status !== r.status || message !== (r.result_message || ""))
      await audit(
        c,
        { email: "system" },
        "SharePoint status " + status,
        "sp_request",
        r.id,
      );
    if (status === "Done" && r.action === "TechnicalAssessment") {
      await query(
        "UPDATE prospects SET service_lane='Managed IT' WHERE id=?",
        [p.id],
        c,
      );
      p.service_lane = "Managed IT";
    }
    if (status === "Done" && r.action === "MarkLost") {
      const applied = await query(
        "SELECT id FROM audit_log WHERE action='apply Mark Lost' AND entity='sp_request' AND entity_id=?",
        [String(r.id)],
        c,
      );
      if (!applied.length) {
        await query(
          "UPDATE prospects SET stage='Closed Lost' WHERE id=?",
          [p.id],
          c,
        );
        await audit(
          c,
          { email: "system" },
          "apply Mark Lost",
          "sp_request",
          r.id,
        );
        p.stage = "Closed Lost";
      }
    }
  });
}
export function handoffRoutes(
  app,
  dependencies = {
    query,
    transaction,
    audit,
    prospect,
    discovery,
    sp,
    graph,
    refresh,
  },
) {
  const { query, transaction, audit, prospect, discovery, sp, graph, refresh } =
    dependencies;

  app.get("/prospects/:id/handoff", async (req, res) => {
    const p = await prospect(req.params.id);
    let client = null,
      error = null;
    try {
      client = await refresh(p);
    } catch {
      error =
        "SharePoint status could not be refreshed. Check the connection before acting.";
    }
    const d = await discovery(p.id);
    const schema = sp.cache;
    const missing = mvd(d.answers);
    const approved =
      (
        await query(
          "SELECT id FROM quotes WHERE prospect_id=? AND status IN ('Approved','Sent')",
          [p.id],
        )
      ).length > 0;
    const ready = !schema.errors.length && !p.hold;
    const expectedStage = client?.["Current Stage"];
    req.session.lostReviews ||= {};
    req.session.lostReviews[p.id] = expectedStage || null;
    const configuredReasons = await query(
      "SELECT reason FROM config_lost_reasons WHERE enabled=TRUE ORDER BY sort_order",
    );
    res.render("handoff", {
      p,
      clientRecord: client,
      nameError: businessNameError(p.business_name),
      expectedStage,
      canMarkLost: canMarkLost(expectedStage),
      lostReasons: configuredReasons.filter((r) =>
        lostReasons.includes(r.reason),
      ),
      error,
      schema,
      missing,
      approved,
      ready,
      requests: await query(
        "SELECT * FROM sp_requests WHERE prospect_id=? ORDER BY id DESC",
        [p.id],
      ),
      json,
      plainResult,
      lanes,
    });
  });
  const handoff = async (req, res) => {
    const action = choice(req.body.action, [
      "CreateClient",
      "Quoting",
      "TechnicalAssessment",
      "MarkLost",
    ]);
    if (action !== "CreateClient" && req.session.user.role !== "owner")
      fail("Owner access required.", 403);
    let body, schema, id;
    const mode = process.env.SHAREPOINT_WRITE_MODE || "dryrun";
    await transaction(async (c) => {
      await query(
        "SELECT id FROM prospects WHERE id=? FOR UPDATE",
        [integer(req.params.id)],
        c,
      );
      const p = await prospect(req.params.id, c);
      if (p.hold) fail("On Hold — Pending Josh Review");
      schema = sp.ready();
      if (
        (
          await query(
            "SELECT id FROM sp_requests WHERE prospect_id=? AND status IN ('Preparing','Pending','Processing','Unknown')",
            [p.id],
            c,
          )
        ).length
      )
        fail("A request is already active or needs reconciliation.");
      const lane = choice(
        action === "CreateClient"
          ? req.body.service_lane
          : action === "TechnicalAssessment"
            ? "Managed IT"
            : action === "Quoting"
              ? "Business IT Integration"
              : p.service_lane,
        lanes,
      );
      const d = await discovery(p.id, c);
      const options = {};
      if (action === "CreateClient") {
        if (p.client_id)
          fail("This opportunity already has a SharePoint client.");
        if (
          ![
            "Qualified",
            "Discovery",
            "Proposal Sent",
            "Closed Won",
            "Technical Assessment",
          ].includes(p.stage) ||
          mvd(d.answers).length
        )
          fail("Qualify the opportunity and complete discovery first.");
        if (await sp.client(p))
          fail(
            "A SharePoint client already exists for this opportunity; Josh must reconcile it before resubmission.",
          );
      }
      if (action === "CreateClient") {
        const [capture] = await query(
          "SELECT actor FROM discovery_versions WHERE prospect_id=? AND revision=?",
          [p.id, d.revision],
          c,
        );
        const [release] = p.hold
          ? []
          : await query(
              "SELECT actor,notes FROM activities WHERE prospect_id=? AND type='note' AND notes LIKE 'Release hold: %' ORDER BY id DESC LIMIT 1",
              [p.id],
              c,
            );
        options.discovery = discoverySnapshot(p, d, {
          capturedBy: capture?.actor || null,
          releasedBy: release?.actor || null,
          releaseNote: release?.notes?.slice("Release hold: ".length) || null,
        });
      }
      if (action === "MarkLost") {
        if (!p.client_id) fail("Create the SharePoint client first.");
        if (schema.actionErrors?.MarkLost?.length)
          fail(schema.actionErrors.MarkLost.join(" "));
        const expectedStage = req.session.lostReviews?.[p.id];
        if (!expectedStage || req.body.expectedStage !== expectedStage)
          fail(
            "Reload the handoff page to review the current client stage.",
            409,
          );
        const client = await sp.client(p);
        const currentStage =
          client?.fields[schema.maps.clients["Current Stage"].name];
        if (currentStage !== expectedStage)
          fail("The client stage changed. Reload before marking lost.", 409);
        if (!canMarkLost(currentStage))
          fail("Signed clients must use Start Offboarding in SharePoint.");
        const reason = choice(req.body.reason, lostReasons);
        if (
          !(
            await query(
              "SELECT reason FROM config_lost_reasons WHERE reason=? AND enabled=TRUE",
              [reason],
              c,
            )
          ).length
        )
          fail("This lost reason is disabled. Choose an enabled reason.");
        Object.assign(options, {
          reason,
          notes: req.body.notes || "",
          expectedStage,
        });
      }
      if (
        action === "Quoting" &&
        !(
          await query(
            "SELECT id FROM quotes WHERE prospect_id=? AND status IN ('Approved','Sent')",
            [p.id],
            c,
          )
        ).length
      )
        fail("An Approved quote is required.");
      if (action === "TechnicalAssessment" && p.service_lane !== "Managed IT") {
        const client = await sp.client(p);
        const currentStage =
          client?.fields[schema.maps.clients["Current Stage"].name];
        if (currentStage !== "Acceptance")
          fail(
            "Managed IT follow-up can start from completed BII Acceptance only.",
          );
      }
      try {
        assertNoPending(await sp.requests(), schema, p);
        body = buildFields(
          schema,
          action,
          p,
          lane,
          req.session.user.email,
          new Date(),
          lookupId(req.session.user.email),
          options,
        );
      } catch (e) {
        fail(e.message);
      }
      const result = await query(
        "INSERT INTO sp_requests (prospect_id,action,request_json,status) VALUES (?,?,?,?)",
        [p.id, action, JSON.stringify(body), "Preparing"],
        c,
      );
      id = result.insertId;
      if (action !== "TechnicalAssessment" || p.service_lane === lane)
        await query(
          "UPDATE prospects SET service_lane=? WHERE id=?",
          [lane, p.id],
          c,
        );
      await audit(c, req.session.user, "prepare handoff", "sp_request", id);
    });
    await transaction(async (c) => {
      await query(
        "SELECT id FROM prospects WHERE id=? FOR UPDATE",
        [integer(req.params.id)],
        c,
      );
      const current = await prospect(req.params.id, c);
      if (current.hold) {
        await query(
          "UPDATE sp_requests SET status='Failed',result_message=? WHERE id=?",
          ["Cancelled before delivery because an urgent hold was placed.", id],
          c,
        );
        return;
      }
      try {
        sp.invalidateWorkItems?.(current.client_id);
        const result = await submitRequest(graph, mode, schema, body);
        await query(
          "UPDATE sp_requests SET status=?,item_id=? WHERE id=?",
          [result.status, result.itemId, id],
          c,
        );
        await audit(
          c,
          req.session.user,
          "dispatch " + result.status,
          "sp_request",
          id,
        );
      } catch {
        await query(
          "UPDATE sp_requests SET status='Unknown',result_message=? WHERE id=?",
          [
            "Delivery could not be confirmed. Search the exact Title in SharePoint before any retry.",
            id,
          ],
          c,
        );
        await audit(
          c,
          req.session.user,
          "delivery uncertain",
          "sp_request",
          id,
        );
      }
    });
    res.redirect(`/prospects/${req.params.id}`);
  };
  app.post("/prospects/:id/handoff", handoff);
  app.post("/prospects/:id/mark-lost", ownerOnly, (req, res) => {
    req.body.action = "MarkLost";
    return handoff(req, res);
  });
  app.get("/prospects/:id/sharepoint-status", async (req, res) => {
    const p = await prospect(req.params.id);
    try {
      const client = await refresh(p);
      const requests = await query(
        "SELECT id,status,result_message FROM sp_requests WHERE prospect_id=? ORDER BY id DESC",
        [p.id],
      );
      res.json({
        client,
        requests: requests.map((r) => ({ ...r, plain: plainResult(r.status) })),
      });
    } catch {
      res.status(503).json({
        error:
          "SharePoint status unavailable. Josh can check the connection in Admin.",
      });
    }
  });
  app.post("/requests/:id/reconcile", ownerOnly, async (req, res) => {
    const note = text(req.body.note || "");
    if (!note) fail("Document the reconciliation.");
    let pid;
    await transaction(async (c) => {
      const [r] = await query(
        "SELECT *,TIMESTAMPDIFF(SECOND,created_at,CURRENT_TIMESTAMP) AS age_seconds FROM sp_requests WHERE id=?",
        [integer(req.params.id)],
        c,
      );
      if (!r) fail("Request not found.", 404);
      pid = r.prospect_id;
      await query("SELECT id FROM prospects WHERE id=? FOR UPDATE", [pid], c);
      if (!["Unknown", "Preparing"].includes(r.status))
        fail("Only uncertain submissions need reconciliation.");
      if (Number(r.age_seconds) < 120)
        fail("Wait two minutes for the in-flight submission to finish.");
      const schema = sp.ready();
      const title = json(r.request_json).fields[
        schema.maps.requests.Title.name
      ];
      const matches = (await sp.requests(false)).filter(
        (item) => item.fields[schema.maps.requests.Title.name] === title,
      );
      if (matches.length > 1)
        fail("Multiple requests share this title. Resolve them in SharePoint.");
      if (matches.length) {
        const item = matches[0];
        await query(
          "UPDATE sp_requests SET item_id=?,status=?,result_message=? WHERE id=?",
          [
            item.id,
            item.fields[schema.maps.requests["Processing Status"].name],
            item.fields[schema.maps.requests["Result Message"].name] || "",
            r.id,
          ],
          c,
        );
      } else {
        if (req.body.confirm_absent !== "yes")
          fail(
            "No matching request was found. Confirm absence explicitly before enabling retry.",
          );
        await query(
          "UPDATE sp_requests SET status='Failed',result_message=? WHERE id=?",
          ["Owner reconciled: no remote request found. " + note, r.id],
          c,
        );
      }
      await audit(c, req.session.user, "reconcile request", "sp_request", r.id);
    });
    res.redirect(`/prospects/${pid}/handoff`);
  });
}
