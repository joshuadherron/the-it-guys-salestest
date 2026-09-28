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
export const fields = [
  ...pipelineFields.map(([key, label]) =>
    key === "likely_tier" ? ["likely_service", "Likely Service"] : [key, label],
  ),
  ["owner", "Owner"],
];
export const pipelineExportFields = [
  ["opp", "Opportunity ID"],
  ...fields,
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
  result.service_lane = body.service_lane
    ? choice(body.service_lane, lanes)
    : null;
  result.legacy_stage = body.legacy_stage ? text(body.legacy_stage, 80) : null;
  result.import_source = body.import_source
    ? choice(body.import_source, ["pipeline", "current_sales"])
    : null;
  result.likely_tier = body.likely_tier ? sourceText(body.likely_tier, 80) : "";
  return { ...result, ...validateStructured(body) };
}
export async function insertProspect(
  body,
  user,
  c,
  storage = { query, audit },
) {
  const p = await validateProspect(body, c, storage.query);
  if (p.stage === "Closed Lost" && user.role !== "owner")
    fail("Owner access required.", 403);
  const keys = [
    ...fields.map((x) => x[0]),
    ...structuredFields.map(([key]) => key),
    "service_lane",
    "legacy_stage",
    "import_source",
    "likely_tier",
  ];
  const r = await storage.query(
    `INSERT INTO prospects (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    keys.map((k) => p[k]),
    c,
  );
  await storage.audit(c, user, "create", "prospect", r.insertId);
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
       : "stage,id DESC"
   }`,
      params,
    );
    const stages = await query(
      "SELECT * FROM config_stages ORDER BY sort_order",
    );
    res.render("pipeline", {
      rows,
      stages,
      search,
      opportunity,
      today: req.path === "/",
      waiting: req.path === "/" ? await waitingForJosh() : [],
      selectedStatus,
      statusChoices,
    });
  });
  app.get("/prospects/new", async (req, res) =>
    res.render("prospect-form", {
      p: {},
      fields,
      frequencies,
      services,
      structuredFields,
      stages: await query("SELECT * FROM config_stages ORDER BY sort_order"),
      owners: await query("SELECT email FROM allowlist WHERE enabled=TRUE"),
    }),
  );
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
    res.redirect(`/prospects/${id}`);
  });
  app.get("/prospects/:id", async (req, res) => {
    const p = await prospect(req.params.id);
    const activities = await query(
      "SELECT * FROM activities WHERE prospect_id=? ORDER BY occurred_on DESC,id DESC",
      [p.id],
    );
    const notifications = await query(
      "SELECT kind,status FROM notifications WHERE prospect_id=? ORDER BY id DESC LIMIT 10",
      [p.id],
    );
    res.render("prospect", {
      ...(await guidedData(p, req.session.user, req.session)),
      p,
      activities,
      outcomes,
      structuredFields,
      notifications,
      json,
    });
  });
  app.get("/prospects/:id/edit", async (req, res) =>
    res.render("prospect-form", {
      p: await prospect(req.params.id),
      fields,
      frequencies,
      services,
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
      if (p.client_id && data.business_name !== p.business_name)
        fail("Client name is locked after SharePoint creation.");
      guardPipelineEdit(p, data);
      if (p.hold && data.stage !== p.stage)
        fail("Release the urgent hold before changing stage.");
      if (data.stage === "Closed Lost" && req.session.user.role !== "owner")
        fail("Owner access required.", 403);
      const keys = [
        ...fields.map((x) => x[0]),
        ...structuredFields.map(([key]) => key),
      ];
      await query(
        `UPDATE prospects SET ${keys.map((k) => k + "=?").join(",")} WHERE id=?`,
        [...keys.map((k) => data[k]), p.id],
        c,
      );
      await audit(c, req.session.user, "update", "prospect", p.id);
    });
    res.redirect(`/prospects/${req.params.id}`);
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
