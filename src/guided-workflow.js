import { isExisting, lockClientRequests } from "./existing-client-rules.js";
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
  completionFlags,
  yes,
  definitionsFor,
} from "./work-items.js";
import { choice, integer, fail, ownerOnly } from "./security.js";
import { lanes } from "./config.js";
import { observeLifecycle } from "./prospect-lifecycle-sync.js";

export function clientData(row, schema) {
  if (!row) return null;
  return { HIPAA: yes(row.fields[schema.maps.clients.HIPAA?.name]), ...Object.fromEntries(
    [
      "Client ID",
      "Current Stage",
      "Stage Status",
      "Next Action",
      "Service Lanes",
    ].map((k) => [k, row.fields[schema.maps.clients[k].name]]),
  ) };
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
      "SELECT p.id,p.business_name,q.id quote_id,q.created_at since,s.status quick_status FROM quotes q JOIN prospects p ON p.id=q.prospect_id LEFT JOIN discoveries d ON d.prospect_id=p.id LEFT JOIN quote_quick_sends s ON s.quote_id=q.id WHERE q.status='Draft' AND (d.status='Ready for Review' OR s.status='WaitingApproval') ORDER BY q.created_at,q.id",
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
      label: r.quick_status==="WaitingApproval"?"Quote waiting for Approve & Send":"BII quote ready for approval",
      href: r.quick_status==="WaitingApproval"?`/quick-quote/quotes/${r.quote_id}`:`/prospects/${r.id}/quotes?quote=${r.quote_id}`,
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
  if (isExisting(p)) {
    const [additional] = await query("SELECT complete FROM additional_service_discoveries WHERE prospect_id=?", [p.id]);
    p.additional_discovery_complete = Boolean(additional?.complete);
  }
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
  if (p.client_id || requests.some((r) => r.item_id)) {
    try {
      await refresh(p);
    } catch (e) {
      console.error("SharePoint request reconciliation failed:", {
        name: e?.name,
        message: e?.message,
        status: e?.status,
      });
      error =
        "A SharePoint request status could not be reconciled. Live client status will still be loaded.";
    }
    if (p.client_id) {
      try {
        client = clientData(await sp.client(p), sp.ready());
      } catch (e) {
        console.error("SharePoint client read failed:", {
          name: e?.name,
          message: e?.message,
          status: e?.status,
        });
        error =
          "SharePoint client status could not be refreshed. Check the connection before acting.";
      }
      try {
        remote = await sp.requests();
      } catch (e) {
        console.error("SharePoint pending-request read failed:", {
          name: e?.name,
          message: e?.message,
          status: e?.status,
        });
        error ||= "Pending SharePoint requests could not be refreshed.";
      }
      try {
        items = await sp.workItems(p.client_id, freshItems);
        if(client)await observeLifecycle(p,client["Current Stage"],{query,actor:user,sync:async (...args)=>{
          const {dispatchProspectSync}=await import("./prospect-sync.js");
          return dispatchProspectSync(...args);
        }});
      } catch (e) {
        console.error("SharePoint work-item read failed:", {
          name: e?.name,
          message: e?.message,
          status: e?.status,
        });
        error ||= "SharePoint work items could not be refreshed.";
      }
    }
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
    ).filter(
      (d) =>
        d.createCopy &&
        (!currentStage || !d.stage || d.stage === currentStage),
    ),
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
    if (!p.client_id) fail("Open the SharePoint record first.");
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
    if (!p.client_id) fail("Open the SharePoint record first.");
    if (p.hold) fail("On Hold — Pending Josh Review");
    schema = sp.ready();
    await lockClientRequests(p, query, c);
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
      cancelProposal: false,
      allowedStages: schema.maps.clients["Current Stage"].choice.choices,
    };
    if (["ItemCompleted", "NotRequired", "RequestException"].includes(action)) {
      const item = items.find(
        (i) => i.id === String(integer(input.itemId, 2147483647)),
      );
      if (!item || item.clientId !== p.client_id || !openItem(item))
        fail("Select an open work item for this client.");
      lane = choice(item.lane, clientLanes(client));
      if(action==="ItemCompleted" && input.supersede==="yes") {
        if(user.email!=="josh@theitguys.us"||user.role!=="owner"||input.confirm!=="yes")fail("Josh must explicitly confirm superseding the previous proposal.",403);
        if(!["MIT-05","BII-05"].includes(item.workflowId)||item.signatureStatus!=="Preparing")fail("Only an open proposal that has not started signing can be superseded.");
        if(!schema.workChoices?.TIG_CompletionStatus?.includes("Cancelled"))fail("Client Operations Completion Status needs the Cancelled choice. Josh must update SharePoint.");
        const [replacement]=await query("SELECT q.id FROM quotes q JOIN quote_proposal_states s ON s.quote_id=q.id WHERE q.id=? AND q.prospect_id=? AND q.status='Approved' AND s.step='filled'",[integer(input.replacementQuoteId),p.id],c);
        if(!replacement||!item.instanceRef||Number(replacement.id)<=Number(item.instanceRef))fail("Save an approved newer quote first and enter its Quote ID. The old copy must have a verified quote instance reference.");
        options.cancelProposal=true;
      }
      if (action === "ItemCompleted" && !options.cancelProposal) {
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
        options.outcomeFlags = completionFlags(
          schema.definitions, schema.workChoices?.TIG_OutcomeFlags || [],
          item, client, user, options.outcomeFlags,
        );
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
      ).filter(
        (d) =>
          d.createCopy &&
          (!client["Current Stage"] ||
            !d.stage ||
            d.stage === client["Current Stage"]),
      );
      if (eligible.filter((d) => d.id === input.workflowId).length !== 1)
        fail(
          "Select a unique active working-copy definition for the client's current stage.",
        );
      const definition = eligible.find((d) => d.id === input.workflowId);
      if (
        ["BII-10", "BII-17"].includes(definition.id) &&
        !String(input.instanceRef || "").trim()
      )
        fail("Enter the device name as the instance reference.");
      lane = choice(definition.lane, clientLanes(client));
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
      if (isExisting(p) && input.stage === "Technical Assessment")
        fail("Use Start Managed IT Transition on SharePoint actions & history.");
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
