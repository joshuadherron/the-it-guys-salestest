import { query, transaction, audit, json } from "./db.js";
import { discovery } from "./discovery.js";
import { prospect } from "./pipeline.js";
import { sp, refresh, lookupId } from "./handoff.js";
import { graph } from "./graph.js";
import { buildFields, assertNoPending, submitRequest } from "./sharepoint.js";
import { nextStep } from "./next-step.js";
import { mvd } from "./discovery-rules.js";
import {
  actionTypes,
  openItem,
  mayComplete,
  availableFlags,
  definitionsFor,
} from "./work-items.js";
import { choice, integer, fail, ownerOnly } from "./security.js";
import { lanes } from "./config.js";

export function clientData(row, schema) {
  if (!row) return null;
  return Object.fromEntries(
    [
      "Client ID",
      "Current Stage",
      "Stage Status",
      "Next Action",
      "Service Lanes",
    ].map((k) => [k, row.fields[schema.maps.clients[k].name]]),
  );
}
export function clientLanes(client) {
  const value = client?.["Service Lanes"];
  return Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
}
export async function waitingForJosh(run = query) {
  const [discoveries, quotes, requests] = await Promise.all([
    run(
      "SELECT p.id,p.business_name,p.hold,d.status,COALESCE((SELECT MIN(a.created_at) FROM audit_log a WHERE a.entity='discovery' AND a.entity_id=CAST(p.id AS CHAR) AND a.action='send to Josh'),p.created_at) since FROM prospects p LEFT JOIN discoveries d ON d.prospect_id=p.id WHERE p.hold=TRUE OR (d.status='Ready for Review' AND p.client_id IS NULL) ORDER BY since,p.id",
    ),
    run(
      "SELECT p.id,p.business_name,q.id quote_id,q.created_at since FROM quotes q JOIN prospects p ON p.id=q.prospect_id JOIN discoveries d ON d.prospect_id=p.id WHERE q.status='Draft' AND d.status='Ready for Review' ORDER BY q.created_at,q.id",
    ),
    run(
      "SELECT p.id,p.business_name,r.id request_id,r.status,r.result_message,r.created_at since FROM sp_requests r JOIN prospects p ON p.id=r.prospect_id WHERE r.status IN ('Rejected','Failed','Unknown') AND r.created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 14 DAY) AND r.acknowledged_at IS NULL ORDER BY r.created_at,r.id",
    ),
  ]);
  return [
    ...discoveries.map((r) => ({
      ...r,
      label: r.hold ? "On Hold" : "Discovery ready for review",
      href: `/prospects/${r.id}/discovery/summary`,
    })),
    ...quotes.map((r) => ({
      ...r,
      label: "BII quote ready for approval",
      href: `/prospects/${r.id}/quotes?quote=${r.quote_id}`,
    })),
    ...requests.map((r) => ({
      ...r,
      label: `SharePoint ${r.status}`,
      href: `/prospects/${r.id}/handoff`,
    })),
  ].sort((a, b) => String(a.since).localeCompare(String(b.since)));
}
export async function guidedData(
  p,
  user,
  session,
  dependencies = { query, discovery, refresh, sp },
  freshItems = false,
) {
  const { query, discovery, refresh, sp } = dependencies;
  const d = await discovery(p.id);
  const quotes = await query(
    "SELECT id,status FROM quotes WHERE prospect_id=? ORDER BY id DESC",
    [p.id],
  );
  let requests = await query(
    "SELECT * FROM sp_requests WHERE prospect_id=? ORDER BY id DESC",
    [p.id],
  );
  let client = null,
    items = null,
    remote = [],
    error = null;
  if (p.client_id || requests.some((r) => r.item_id))
    try {
      await refresh(p);
      if (p.client_id) {
        client = clientData(await sp.client(p), sp.ready());
        remote = await sp.requests();
        items = await sp.workItems(p.client_id, freshItems);
      }
    } catch {
      error =
        "SharePoint work status could not be refreshed. Check the connection before acting.";
    }
  requests = await query(
    "SELECT * FROM sp_requests WHERE prospect_id=? ORDER BY id DESC",
    [p.id],
  );
  const pending = requests.filter((r) =>
    ["Pending", "Processing", "Preparing", "Unknown"].includes(r.status),
  );
  for (const r of remote) {
    try {
      const s = sp.cache,
        body = JSON.parse(r.fields[s.maps.requests.Payload.name] || "{}");
      if (
        body.clientId === p.client_id ||
        body.opportunityId === p.opp ||
        (body.itemId && items?.some((i) => i.id === String(body.itemId))) ||
        (p.client_item_id &&
          String(r.fields[s.maps.requests.Client.name + "LookupId"]) ===
            String(p.client_item_id))
      ) {
        if (!pending.some((local) => String(local.item_id) === String(r.id)))
          pending.push({
            status: r.fields[s.maps.requests["Processing Status"].name],
          });
      }
    } catch {
      error =
        "A pending request has an unreadable payload. Josh must check SharePoint.";
    }
  }
  const step = nextStep(
    p,
    d.exists === false ? null : d,
    quotes,
    client,
    items,
    pending,
    user.role,
  );
  if (error && p.client_id && step.action?.form) step.action = null;
  if (
    pending.some((r) => ["Preparing", "Unknown"].includes(r.status)) &&
    p.client_id
  ) {
    step.title = "A request needs confirmation";
    step.detail = "Review SharePoint actions & history before retrying.";
    step.action = {
      label: "Review request history",
      href: `/prospects/${p.id}/handoff`,
    };
    step.waitingOn = "Josh";
  }
  const schema = sp.cache;
  const currentStage = client?.["Current Stage"];
  session.stageReviews ||= {};
  session.stageReviews[p.id] = currentStage || null;
  const stageGateNotice =
    user.role === "owner" &&
    p.client_id &&
    !schema.stageGateConfirmed &&
    !session.stageGateNoticeShown;
  if (stageGateNotice) session.stageGateNoticeShown = true;
  const itemGroups = [
    {
      label: "Current stage",
      items: (items || []).filter(
        (i) => openItem(i) && i.stage === currentStage,
      ),
    },
    {
      label: "Other open",
      items: (items || []).filter(
        (i) => openItem(i) && i.stage !== currentStage,
      ),
    },
    {
      label: "Completed/closed",
      items: (items || []).filter((i) => !openItem(i)),
    },
  ];
  return {
    p,
    d,
    step,
    // Avoid EJS' reserved "client" render option; truthy values disable include().
    clientRecord: client,
    items,
    itemGroups,
    requests,
    pending,
    error,
    schema,
    currentStage,
    stageGateNotice,
    completedGroups: 8 - mvd(d.answers).length,
    hasAnswers: Object.values(d.answers).some(
      (a) => a.state !== "not_discussed",
    ),
    flags: availableFlags(schema.definitions || [], clientLanes(client)),
    definitions: definitionsFor(
      schema.definitions || [],
      clientLanes(client),
    ).filter((d) => d.createCopy),
    mayComplete,
    openItem,
    stageChoices: (
      schema.maps?.clients?.["Current Stage"]?.choice?.choices || []
    ).filter((s) => !s.startsWith("Closed")),
    actionErrors: schema.actionErrors || {},
    json,
  };
}

export async function executeSignatureAction(
  id,
  input,
  user,
  deps = { transaction, audit, prospect, sp, graph },
) {
  if (user.role !== "owner") fail("Owner access required.", 403);
  const { transaction, audit, prospect, sp, graph } = deps;
  const action = choice(input.action, ["PrepareSignature", "SignatureSent"]);
  const itemId = String(integer(input.itemId, 2147483647));
  let p, schema, item;
  await transaction(async (tx) => {
    p = await prospect(id, tx);
    if (!p.client_id) fail("Create the SharePoint client first.");
    if (p.hold) fail("On Hold — Pending Josh Review");
    schema = sp.ready();
    const items = await sp.workItems(p.client_id, true);
    item = items.find((i) => i.id === itemId);
    if (!item || item.clientId !== p.client_id || !openItem(item))
      fail("Select an open work item for this client.");
    if (!item.signatureRequired) fail("This item does not require a signature.");
    if (action === "PrepareSignature") {
      if (item.signatureStatus === "Sent - awaiting signature")
        fail("This item is already out for signature.");
      if (item.signatureStatus === "Signed")
        fail("This item is already signed.");
      if (item.signingPdf)
        fail("A signing PDF already exists. Open it and mark the request sent.");
      if (input.confirm !== "yes")
        fail("Confirm that the document was reviewed and internal notes were removed.");
    } else {
      if (!item.signingPdf)
        fail("Prepare the signing PDF before marking the request sent.");
      if (item.signatureStatus === "Sent - awaiting signature")
        fail("This item is already marked sent.");
      if (item.signatureStatus === "Signed")
        fail("This item is already signed.");
      if (input.confirm !== "yes")
        fail("Confirm that the Microsoft 365 eSignature request was actually sent.");
    }
  });

  const fields =
    action === "PrepareSignature"
      ? {
          TIG_InternalNotesRemoved: true,
          TIG_SignatureStatus: "Ready to send",
        }
      : {
          TIG_SignatureStatus: "Sent - awaiting signature",
          ...(schema.signatureSentColumn
            ? { [schema.signatureSentColumn]: new Date().toISOString() }
            : {}),
        };

  await graph.updateListItemFields(
    schema.siteId,
    schema.clientOpsId,
    itemId,
    fields,
  );
  sp.invalidateWorkItems(p.client_id);

  await transaction(async (tx) => {
    await audit(
      tx,
      user,
      action === "PrepareSignature"
        ? "prepare signature"
        : "mark signature sent",
      "client_operation",
      itemId,
    );
  });
}

export async function executeWorkAction(
  id,
  input,
  user,
  reviewedStage,
  deps = { query, transaction, audit, prospect, sp, graph },
) {
  const { query, transaction, audit, prospect, sp, graph } = deps;
  const action = choice(input.action, Object.keys(actionTypes));
  if (action !== "ItemCompleted" && user.role !== "owner")
    fail("Owner access required.", 403);
  let body, schema, requestId, p;
  await transaction(async (c) => {
    p = await prospect(id, c);
    if (!p.client_id) fail("Create the SharePoint client first.");
    if (p.hold) fail("On Hold — Pending Josh Review");
    schema = sp.ready();
    if (schema.actionErrors?.[action]?.length)
      fail(schema.actionErrors[action].join(" "));
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
    const client = clientData(await sp.client(p), schema);
    if (!client) fail("Client status is unavailable.");
    let lane = choice(p.service_lane, lanes);
    if (!clientLanes(client).includes(lane))
      fail("The prospect lane does not match the client's live Service Lanes.");
    const items = await sp.workItems(p.client_id, true);
    p.work_item_ids = items.map((i) => i.id);
    assertNoPending(await sp.requests(), schema, p);
    const options = {
      ...input,
      allowedStages: schema.maps.clients["Current Stage"].choice.choices,
    };
    if (["ItemCompleted", "NotRequired", "RequestException"].includes(action)) {
      const item = items.find(
        (i) => i.id === String(integer(input.itemId, 2147483647)),
      );
      if (!item || item.clientId !== p.client_id || !openItem(item))
        fail("Select an open work item for this client.");
      lane = choice(item.lane, clientLanes(client));
      if (action === "ItemCompleted") {
        if (!mayComplete(item, user))
          fail(
            "Only the owner or assigned Alanna can complete this item. Unsigned signature items complete automatically when signed.",
            403,
          );
        if (schema.definitionErrors?.length)
          fail(schema.definitionErrors.join(" "));
        options.outcomeFlags =
          input.outcomeFlags === undefined
            ? []
            : Array.isArray(input.outcomeFlags)
              ? input.outcomeFlags
              : [input.outcomeFlags];
        const allowed = availableFlags(schema.definitions, clientLanes(client))
          .map((d) => d.triggerFlag)
          .filter((f) => schema.workChoices?.TIG_OutcomeFlags?.includes(f));
        for (const flag of options.outcomeFlags) choice(flag, allowed);
      }
      if (action === "NotRequired" && input.confirm !== "yes")
        fail("Confirm that this item is not required.");
      if (
        action === "RequestException" &&
        (!item.blocking || !["None", "Rejected"].includes(item.exceptionStatus))
      )
        fail("This item is not eligible for an exception request.");
    }
    if (action === "CreateWorkingCopy") {
      if (schema.definitionErrors?.length)
        fail(schema.definitionErrors.join(" "));
      const eligible = definitionsFor(
        schema.definitions,
        clientLanes(client),
      ).filter((d) => d.createCopy);
      if (eligible.filter((d) => d.id === input.workflowId).length !== 1)
        fail(
          "Select a unique active working-copy definition in the client's lanes.",
        );
      lane = choice(
        eligible.find((d) => d.id === input.workflowId).lane,
        clientLanes(client),
      );
    }
    if (action === "AdvanceStage") {
      if (
        !reviewedStage ||
        input.expectedStage !== reviewedStage ||
        client["Current Stage"] !== reviewedStage
      )
        fail("The client stage changed. Reload before advancing.", 409);
    }
    if (action === "StartStage") {
      if (input.stage === "Technical Assessment" && lane !== "Managed IT")
        fail("Technical Assessment is Managed IT only.");
      if (
        input.stage === "Quoting" &&
        lane === "Business IT Integration" &&
        !(
          await query(
            "SELECT id FROM quotes WHERE prospect_id=? AND status='Approved'",
            [p.id],
            c,
          )
        ).length
      )
        fail("An Approved quote is required.");
    }
    body = buildFields(
      schema,
      action,
      p,
      lane,
      user.email,
      new Date(),
      lookupId(user.email),
      options,
    );
    const r = await query(
      "INSERT INTO sp_requests (prospect_id,action,request_json,status,target_item_id) VALUES (?,?,?,'Preparing',?)",
      [
        p.id,
        action,
        JSON.stringify(body),
        options.itemId ? integer(options.itemId, 2147483647) : null,
      ],
      c,
    );
    requestId = r.insertId;
    await audit(c, user, "prepare " + action, "sp_request", requestId);
  });
  await transaction(async (c) => {
    const current = await prospect(id, c);
    if (current.hold) {
      await query(
        "UPDATE sp_requests SET status='Failed',result_message=? WHERE id=?",
        ["Cancelled because an urgent hold was placed.", requestId],
        c,
      );
      await audit(c, user, "cancel held request", "sp_request", requestId);
      return;
    }
    try {
      const result = await submitRequest(
        graph,
        process.env.SHAREPOINT_WRITE_MODE || "dryrun",
        schema,
        body,
      );
      await query(
        "UPDATE sp_requests SET status=?,item_id=? WHERE id=?",
        [result.status, result.itemId, requestId],
        c,
      );
      await audit(
        c,
        user,
        "dispatch " + result.status,
        "sp_request",
        requestId,
      );
    } catch {
      await query(
        "UPDATE sp_requests SET status='Unknown',result_message=? WHERE id=?",
        [
          "Delivery uncertain. Reconcile the exact request title before retrying.",
          requestId,
        ],
        c,
      );
      await audit(c, user, "delivery uncertain", "sp_request", requestId);
    } finally {
      sp.invalidateWorkItems(p.client_id);
    }
  });
}
export function guidedRoutes(
  app,
  dependencies = {
    query,
    transaction,
    audit,
    prospect,
    guidedData,
    executeWorkAction,
    executeSignatureAction,
  },
) {
  const {
    query,
    transaction,
    audit,
    prospect,
    guidedData,
    executeWorkAction,
    executeSignatureAction,
  } = dependencies;
  app.get("/prospects/:id/workflow-panel", async (req, res) =>
    res.render(
      "workflow-panel",
      await guidedData(
        await prospect(req.params.id),
        req.session.user,
        req.session,
        undefined,
        true,
      ),
    ),
  );
  app.post("/prospects/:id/work-items", async (req, res) => {
    await executeWorkAction(
      req.params.id,
      req.body,
      req.session.user,
      req.session.stageReviews?.[req.params.id],
    );
    res.redirect(`/prospects/${req.params.id}`);
  });
  app.post("/prospects/:id/signature", async (req, res) => {
    await executeSignatureAction(
      req.params.id,
      req.body,
      req.session.user,
    );
    res.redirect(`/prospects/${req.params.id}`);
  });
  app.post("/requests/:id/acknowledge", ownerOnly, async (req, res) => {
    await transaction(async (c) => {
      const result = await query(
        "UPDATE sp_requests SET acknowledged_at=UTC_TIMESTAMP(),acknowledged_by=? WHERE id=? AND acknowledged_at IS NULL AND status IN ('Rejected','Failed','Unknown')",
        [req.session.user.email, integer(req.params.id)],
        c,
      );
      if (result.affectedRows)
        await audit(
          c,
          req.session.user,
          "acknowledge request",
          "sp_request",
          req.params.id,
        );
    });
    res.redirect("/");
  });
}
