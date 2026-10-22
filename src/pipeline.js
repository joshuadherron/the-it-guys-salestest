import { waitingForJosh, guidedData } from "./guided-workflow.js";
import { guardPipelineEdit } from "./workflow-contract.js";
import { query, transaction, audit, json } from "./db.js";
import { text, integer, choice, date, fail } from "./security.js";
import { frequencies, services, opportunity } from "./config.js";
import {
  pipelineFields,
  weeklyHeaders,
  trackerHeaders,
} from "./tracker-import.js";
import { lanes } from "./config.js";
export { weeklyHeaders };
import {
  structuredFields,
  locationFields,
  validateLocation,
  validateStructured,
  service,
  sourceText,
  statusChoices,
} from "./prospect-data.js";
import {
  parseImport,
  importNames,
  liveHeaders,
  needsLane,
  reviewLane,
} from "./sales-import.js";
import { commitImport } from "./import-commit.js";
import { dispatchProspectSync, syncStatus } from "./prospect-sync.js";
import { relationshipLabel } from "./prospect-lifecycle.js";
import { servicePlan } from "./service-plan.js";
import { engagementType, genericEngagement, projectLane, engagementTypes } from "./engagement-types.js";
import { attachBusiness } from "./businesses.js";
import { salesHandoff } from "./sales-handoff.js";
import { changeOpportunityType } from "./opportunity-type.js";
export const fields = [
  ...pipelineFields.map(([key, label]) =>
    key === "likely_tier" ? ["likely_service", "Likely Service"] : [key, label],
  ),
  ["owner", "Owner"],
];
export const pipelineExportFields = [
  ["opp", "Opportunity ID"],
  ...fields.slice(0, 4),
  ...locationFields,
  ...fields.slice(4),
  ...structuredFields,
  ["service_lane", "Workflow lane"],
  ["legacy_stage", "Source stage"],
  ["import_source", "Import source"],
  ["likely_tier", "Historical tier (source only)"],
];
export const outcomes = [
  "No answer",
  "Conversation",
  "Qualified Opportunity",
  "Proposal Sent",
  "Recurring Contract Signed",
  "Hourly/Project Job Picked Up",
  "Other",
];
export function csv(rows) {
  return rows
    .map((row) =>
      row
        .map(
          (v) =>
            '"' +
            String(v ?? "")
              .replaceAll('"', '""')
              .replace(/^(?=[\s]*[=+@-]|[\t\r\n])/, "'") +
            '"',
        )
        .join(","),
    )
    .join("\r\n");
}
export function monday(value = new Date().toISOString().slice(0, 10)) {
  const d = new Date(date(value) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export async function prospect(id, c) {
  const [p] = await query(
    "SELECT * FROM prospects WHERE id=?" + (c ? " FOR UPDATE" : ""),
    [integer(id)],
    c,
  );
  if (!p) fail("Opportunity not found.", 404);
  if(p.business_id) {
    const [business]=await query("SELECT * FROM businesses WHERE id=?",[p.business_id],c);
    if(!business)fail("The opportunity's business identity is missing. Ask an admin to reconcile it.",409);
    p.business_relationship_status=business.relationship_status;
    p.client_id ||= business.client_id;
    p.client_item_id ||= business.client_item_id;
    p.sharepoint_record_id ||= business.client_id;
  }
  if(genericEngagement(p)) {
    p.sales_authorized=!!await salesHandoff(p.id,c);
  }
  p.opp = opportunity(p.id);
  return p;
}
export async function validateProspect(body, c, runQuery = query) {
  const result = {};
  for (const [key] of fields)
    result[key] = text(
      String(body[key] ?? ""),
      ["notes", "current_it", "key_dependency"].includes(key)
        ? 10000
        : key === "phone"
          ? 80
          : key === "email" || key === "owner"
            ? 254
            : 255,
    );
  if (!result.business_name) fail("Business Name is required.");
  result.first_contact = date(result.first_contact);
  result.follow_up = date(result.follow_up);
  result.employee_count =
    result.employee_count === "" ? null : integer(result.employee_count);
  result.call_frequency = choice(result.call_frequency, ["", ...frequencies]);
  result.likely_service = service(result.likely_service);
  result.notes = sourceText(body.notes || "");
  result.owner = result.owner || "alanna@theitguys.us";
  if (
    !(
      await runQuery(
        "SELECT email FROM allowlist WHERE email=? AND enabled=TRUE",
        [result.owner],
        c,
      )
    ).length
  )
    fail("Owner must be an enabled user.");
  const stages = await runQuery("SELECT * FROM config_stages", [], c);
  const stage = stages.find((x) => x.name === (result.stage || "Prospecting"));
  if (!stage) fail("Unknown pipeline stage.");
  if (stage.managed_only && body.service_lane !== "Managed IT")
    fail("Technical Assessment is only available for Managed IT.");
  result.stage = stage.name;
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))
    fail("Enter a valid email address.");
  result.engagement_type=engagementType(body.engagement_type || (body.service_lane==="Managed IT"?"managed_it":"bii"));
  result.opportunity_title=text(body.opportunity_title||"",255);
  result.service_lane = genericEngagement(result) ? projectLane : body.engagement_type ? (result.engagement_type==="managed_it"?"Managed IT":"Business IT Integration") : body.service_lane
    ? choice(body.service_lane, lanes)
    : null;
  result.legacy_stage = body.legacy_stage ? text(body.legacy_stage, 80) : null;
  result.import_source = body.import_source
    ? choice(body.import_source, ["pipeline", "current_sales"])
    : null;
  result.likely_tier = body.likely_tier ? sourceText(body.likely_tier, 80) : "";
  return {
    ...result,
    ...validateLocation(body),
    ...validateStructured(body),
  };
}
export async function insertProspect(
  body,
  user,
  c,
  storage = { query, audit },
) {
  if(body.business_id) {
    const [business]=await storage.query("SELECT * FROM businesses WHERE id=? FOR UPDATE",[integer(body.business_id)],c);
    if(!business)fail("Business not found.",404);
    body={...body,business_name:business.name,contact_name:body.contact_name||business.contact_name,email:body.email||business.email,phone:body.phone||business.phone};
  }
  const p = await validateProspect(body, c, storage.query);
  if (p.stage === "Closed Lost" && user.role !== "owner")
    fail("Owner access required.", 403);
  const keys = [
    ...fields.map((x) => x[0]),
    ...locationFields.map(([key]) => key),
    ...structuredFields.map(([key]) => key),
    "service_lane",
    "legacy_stage",
    "import_source",
    "likely_tier",
    "engagement_type",
    "opportunity_title",
  ];
  const r = await storage.query(
    `INSERT INTO prospects (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    keys.map((k) => p[k]),
    c,
  );
  await storage.audit(c, user, "create", "prospect", r.insertId);
  await attachBusiness({...p,id:r.insertId},body.business_id,user,c,{...storage,legacyImport:!body.engagement_type&&!body.business_id});
  return r.insertId;
}
export async function weekly(week) {
  return (
    await query(
      `SELECT COUNT(CASE WHEN type='call' THEN 1 END) calls,COUNT(CASE WHEN outcome='Conversation' THEN 1 END) conversations,COUNT(CASE WHEN outcome='Qualified Opportunity' THEN 1 END) qualified,COUNT(CASE WHEN outcome='Proposal Sent' THEN 1 END) proposals,COUNT(CASE WHEN outcome='Recurring Contract Signed' THEN 1 END) recurring,COUNT(CASE WHEN outcome='Hourly/Project Job Picked Up' THEN 1 END) hourly FROM activities WHERE occurred_on>=? AND occurred_on<DATE_ADD(?,INTERVAL 7 DAY)`,
      [week, week],
    )
  )[0];
}
export function pipelineRoutes(app) {
  app.get(["/", "/pipeline"], async (req, res) => {
    const search = text(String(req.query.q || ""), 200);
    const selectedStatus = req.query.status
      ? choice(req.query.status, statusChoices)
      : "";
    const sortOptions = [
      ["newest", "Newest added"],
      ["oldest", "Oldest added"],
      ["name_asc", "Business name (A–Z)"],
      ["name_desc", "Business name (Z–A)"],
      ["status", "Status (A–Z)"],
      ["stage", "Pipeline stage (A–Z)"],
      ["followup_asc", "Follow-up (soonest first)"],
      ["followup_desc", "Follow-up (latest first)"],
      ["interest", "Interest / service (A–Z)"],
    ];
    const sortColumns = {
      newest: "id DESC",
      oldest: "id ASC",
      name_asc: "business_name ASC,id DESC",
      name_desc: "business_name DESC,id DESC",
      status: "status IS NULL,status ASC,business_name ASC,id DESC",
      stage: "stage ASC,business_name ASC,id DESC",
      followup_asc: "follow_up IS NULL,follow_up ASC,id DESC",
      followup_desc: "follow_up IS NULL,follow_up DESC,id DESC",
      interest: "likely_service IS NULL,likely_service ASC,business_name ASC,id DESC",
    };
    const selectedSort = req.path === "/pipeline" && Object.hasOwn(sortColumns, String(req.query.sort || ""))
      ? String(req.query.sort) : "newest";
    const where = ["(business_name LIKE ? OR contact_name LIKE ?)"];
    const params = ["%" + search + "%", "%" + search + "%"];

    if (selectedStatus) {
      where.push("status=?");
      params.push(selectedStatus);
    }

    const rows = await query(
      `SELECT * FROM prospects
   WHERE ${where.join(" AND ")}
   ORDER BY ${
     req.path === "/"
       ? "follow_up IS NULL,follow_up ASC,id DESC"
       : sortColumns[selectedSort]
   }`,
      params,
    );
    const stages = await query(
      "SELECT * FROM config_stages ORDER BY sort_order",
    );
    res.render("pipeline", {
      rows,
      engagementTypes,
      stages,
      search,
      opportunity,
      today: req.path === "/",
      waiting: req.path === "/" ? await waitingForJosh() : [],
      selectedStatus,
      statusChoices,
      selectedSort,
      sortOptions,
    });
  });
  app.get("/prospects/new", async (req, res) => {
    const businesses=await query("SELECT * FROM businesses ORDER BY name,id");
    const business=req.query.business_id?businesses.find(b=>String(b.id)===String(integer(req.query.business_id))):null;
    if(req.query.business_id&&!business)fail("Business not found.",404);
    res.render("prospect-form", {
      p: business?{...business,business_id:business.id,business_name:business.name,id:undefined,engagement_type:choice(req.query.engagement_type||"project",Object.keys(engagementTypes))}: {engagement_type:choice(req.query.engagement_type||"project",Object.keys(engagementTypes))},
      businesses,
      engagementTypes,
      fields,
      frequencies,
      services,
      locationFields,
      structuredFields,
      stages: await query("SELECT * FROM config_stages ORDER BY sort_order"),
      owners: await query("SELECT email FROM allowlist WHERE enabled=TRUE"),
    });
  });
  app.get("/zip-lookup/:zip", async (req, res) => {
    const zip = String(req.params.zip || "").trim();
    if (!/^\d{5}$/.test(zip))
      return res.status(400).json({ error: "Enter a 5-digit ZIP code." });
    try {
      const response = await fetch(`https://api.zippopotam.us/us/${zip}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      });
      if (response.status === 404)
        return res.status(404).json({ error: "ZIP code not found." });
      if (!response.ok) throw new Error("ZIP lookup failed.");
      const data = await response.json();
      const place = data.places?.[0];
      if (!place) return res.status(404).json({ error: "ZIP code not found." });
      res.json({
        city: place["place name"],
        state: place["state abbreviation"],
      });
    } catch {
      res.status(503).json({ error: "ZIP lookup is temporarily unavailable." });
    }
  });

  app.post("/prospects", async (req, res) => {
    const id = await transaction((c) =>
      insertProspect(
        {
          ...req.body,
          legacy_stage: null,
          import_source: null,
          likely_tier: "",
        },
        req.session.user,
        c,
      ),
    );
    const created = await prospect(id);
    await dispatchProspectSync(created, req.session.user);
    res.redirect(`/prospects/${id}`);
  });
  app.get("/prospects/:id", async (req, res) => {
    const p = await prospect(req.params.id);
    if(genericEngagement(p))return res.redirect(`/prospects/${p.id}/work`);
    const activities = await query(
      "SELECT * FROM activities WHERE prospect_id=? ORDER BY occurred_on DESC,id DESC",
      [p.id],
    );
    const notifications = await query(
      "SELECT kind,status FROM notifications WHERE prospect_id=? ORDER BY id DESC LIMIT 10",
      [p.id],
    );
    res.render("prospect", {
      ...(await guidedData(p, req.session.user, req.session, undefined, true)),
      p,
      activities,
      outcomes,
      structuredFields,
      notifications,
      sync: await syncStatus(p.id),
      relationshipLabel,
      servicePlan: servicePlan(p),
      json,
    });
  });
  app.get("/prospects/:id/edit", async (req, res) =>
    res.render("prospect-form", {
      p: await prospect(req.params.id),
      engagementTypes,
      fields,
      frequencies,
      services,
      locationFields,
      structuredFields,
      stages: await query("SELECT * FROM config_stages ORDER BY sort_order"),
      owners: await query("SELECT email FROM allowlist WHERE enabled=TRUE"),
    }),
  );
  app.post("/prospects/:id", async (req, res) => {
    await transaction(async (c) => {
      const p = await prospect(req.params.id, c);
      const body = {
        ...p,
        ...req.body,
        service_lane: p.service_lane,
        legacy_stage: p.legacy_stage,
        import_source: p.import_source,
        likely_tier: p.likely_tier,
      };
      const data = await validateProspect(body, c);
      const typeChanged=data.engagement_type!==p.engagement_type;
      if(typeChanged&&data.service_lane!=="Managed IT"&&data.stage==="Technical Assessment")data.stage="Discovery";
      if ((p.client_id||p.business_id) && data.business_name !== p.business_name)
        fail("Client name is locked after SharePoint creation.");
      if(genericEngagement(p)&&data.stage!==p.stage&&["Closed Won","Closed Lost"].includes(data.stage))fail("Use explicit work authorization or Mark opportunity lost; editing the stage cannot authorize work.",409);
      if(genericEngagement(p)&&((p.sales_authorized&&data.stage!==p.stage)||(data.status==="Lost"&&p.status!=="Lost")))fail("Use the sales outcome workflow. Recorded acceptance and handoff cannot be changed by editing pipeline fields.",409);
      guardPipelineEdit(p, data);

      if (data.stage === "Closed Lost" && req.session.user.role !== "owner")
        fail("Owner access required.", 403);
      if(typeChanged)await changeOpportunityType(p,data.engagement_type,req.session.user,c,{query,audit},req.body.original_engagement_type);
      const keys = [
        ...fields.map((x) => x[0]),
        ...locationFields.map(([key]) => key),
        ...structuredFields.map(([key]) => key),
        "engagement_type","opportunity_title","service_lane",
      ];
      await query(
        `UPDATE prospects SET ${keys.map((k) => k + "=?").join(",")} WHERE id=?`,
        [...keys.map((k) => data[k]), p.id],
        c,
      );
      await audit(c, req.session.user, "update", "prospect", p.id);
    });
    const updated = await prospect(req.params.id);
    await dispatchProspectSync(updated, req.session.user);
    res.redirect(`/prospects/${req.params.id}`);
  });
  app.post("/prospects/:id/sync", async (req, res) => {
    const p = await prospect(req.params.id);
    await dispatchProspectSync(p, req.session.user);
    res.redirect(`/prospects/${p.id}`);
  });
  app.post("/prospects/:id/activities", async (req, res) => {
    const p = await prospect(req.params.id);
    await transaction(async (c) => {
      await query(
        "INSERT INTO activities (prospect_id,type,outcome,notes,occurred_on,actor) VALUES (?,?,?,?,?,?)",
        [
          p.id,
          choice(req.body.type, ["call", "visit", "email", "note"]),
          choice(req.body.outcome, outcomes),
          text(req.body.notes || ""),
          date(req.body.occurred_on) || new Date().toISOString().slice(0, 10),
          req.session.user.email,
        ],
        c,
      );
      if (p.switch_review_new) {
        await query("UPDATE prospects SET switch_review_new=NULL WHERE id=?", [p.id], c);
      }
      await audit(c, req.session.user, "create activity", "prospect", p.id);
    });
    res.redirect(`/prospects/${p.id}`);
  });
  app.get("/weekly", async (req, res) => {
    const week = monday(req.query.week);
    const metrics = await weekly(week);
    const [historical] = await query(
      "SELECT * FROM weekly_imports WHERE week_start=?",
      [week],
    );
    res.render("weekly", { week, metrics, historical, weeklyHeaders });
  });
  app.get("/export/:kind", async (req, res) => {
    const kind = choice(req.params.kind, ["pipeline", "weekly"]);
    let rows;
    if (kind === "pipeline") {
      const p = await query("SELECT * FROM prospects ORDER BY id");
      rows = [
        pipelineExportFields.map(([, label]) => label),
        ...p.map((r) =>
          pipelineExportFields.map(([k]) =>
            k === "opp" ? opportunity(r.id) : r[k],
          ),
        ),
      ];
    } else {
      const weeks = await query(
        "SELECT DISTINCT DATE_SUB(occurred_on,INTERVAL WEEKDAY(occurred_on) DAY) week FROM activities UNION SELECT week_start week FROM weekly_imports ORDER BY week",
      );
      rows = [weeklyHeaders];
      for (const { week } of weeks) {
        const metrics = await weekly(week);
        const [h] = await query(
          "SELECT * FROM weekly_imports WHERE week_start=?",
          [week],
        );
        rows.push([
          week,
          ...[
            "calls",
            "conversations",
            "qualified",
            "proposals",
            "recurring",
            "hourly",
          ].map((k) => Number(metrics[k]) + Number(h?.[k] || 0)),
          h?.notes || "",
        ]);
      }
    }
    res
      .type("text/csv")
      .attachment(kind + ".csv")
      .send(csv(rows));
  });
  const previewColumns = [
    ["business_name", "Business"],
    ["contact_name", "Contact"],
    ["legacy_stage", "Source stage"],
    ["stage", "Proposed operational stage"],
    ["status", "Status"],
    ["next_action", "Next action"],
    ["next_action_date", "Next action date"],
    ["next_action_time", "Next action time"],
    ["next_action_method", "Next action method"],
    ["likely_service", "Likely Service"],
    ["service_lane", "Workflow lane"],
  ];
  const showPreview = (res, preview) =>
    res.render("import", {
      headers: { ...trackerHeaders, current_sales: liveHeaders },
      importNames,
      preview: preview
        ? {
            ...preview,
            needsLanes:
              preview.kind !== "weekly" && preview.data.some(needsLane),
            displayHeaders:
              preview.kind === "weekly"
                ? trackerHeaders.weekly
                : previewColumns.map(([, label]) => label),
            rows:
              preview.kind === "weekly"
                ? preview.data
                : preview.data.map((r) =>
                    previewColumns.map(([key]) =>
                      needsLane(r) && key === "stage"
                        ? "Review required"
                        : (r[key] ?? ""),
                    ),
                  ),
          }
        : null,
      needsLane,
      structuredFields,
    });
  app.get("/import", (_req, res) => showPreview(res, null));
  app.post("/import/preview", async (req, res) => {
    delete req.session.importPreview;
    const preview = parseImport(req.body.kind, req.body.csv);
    if (preview.kind !== "weekly" && !preview.ignored)
      for (const row of preview.data) {
        await validateProspect({
          ...row,
          stage: needsLane(row) ? "Discovery" : row.stage,
        });
      }
    if (!preview.ignored && preview.data.length)
      req.session.importPreview = preview;
    showPreview(res, preview);
  });
  app.post("/import/review", async (req, res) => {
    const preview = req.session.importPreview;
    if (!preview || !["pipeline", "current_sales"].includes(preview.kind))
      fail("Preview a prospect CSV first.");
    const mapped = [];
    for (const [i, row] of preview.data.entries())
      mapped.push(
        await validateProspect(
          needsLane(row) ? reviewLane(row, req.body["lane_" + i]) : row,
        ),
      );
    req.session.importPreview = { ...preview, data: mapped };
    showPreview(res, req.session.importPreview);
  });
  app.post("/import/commit", async (req, res) => {
    const preview = req.session.importPreview;
    await commitImport(preview, req.session.user, {
      transaction,
      query,
      insert: insertProspect,
      audit,
    });
    delete req.session.importPreview;
    res.redirect(preview.kind === "weekly" ? "/weekly" : "/pipeline");
  });
}

