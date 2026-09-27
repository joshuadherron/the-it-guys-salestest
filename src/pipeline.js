import { query, transaction, audit, json } from "./db.js";
import { text, integer, choice, date, fail } from "./security.js";
import { frequencies, tiers, opportunity } from "./config.js";
import {
  pipelineFields,
  weeklyHeaders,
  trackerHeaders,
  parseTracker,
  resolveLegacyStage,
} from "./tracker-import.js";
import { lanes } from "./config.js";
export { weeklyHeaders };
export const fields = [...pipelineFields, ["owner", "Owner"]];
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
              .replace(/^[=+@\-\t\r]/, "'$&") +
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
async function validate(body, c) {
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
  result.call_frequency = choice(
    result.call_frequency || "Not sure",
    frequencies,
  );
  result.likely_tier = choice(result.likely_tier || "Not sure", tiers);
  result.owner = result.owner || "alanna@theitguys.us";
  if (
    !(
      await query(
        "SELECT email FROM allowlist WHERE email=? AND enabled=TRUE",
        [result.owner],
        c,
      )
    ).length
  )
    fail("Owner must be an enabled user.");
  const stages = await query("SELECT * FROM config_stages", [], c);
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
  return result;
}
async function insert(body, user, c) {
  const p = await validate(body, c);
  if (p.stage === "Closed Lost" && user.role !== "owner")
    fail("Owner access required.", 403);
  const keys = [...fields.map((x) => x[0]), "service_lane"];
  const r = await query(
    `INSERT INTO prospects (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    keys.map((k) => p[k]),
    c,
  );
  await audit(c, user, "create", "prospect", r.insertId);
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
    const rows = await query(
      `SELECT * FROM prospects WHERE business_name LIKE ? OR contact_name LIKE ? ORDER BY ${req.path === "/" ? "follow_up IS NULL,follow_up ASC,id DESC" : "stage,id DESC"}`,
      ["%" + search + "%", "%" + search + "%"],
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
    });
  });
  app.get("/prospects/new", async (req, res) =>
    res.render("prospect-form", {
      p: {},
      fields,
      frequencies,
      tiers,
      stages: await query("SELECT * FROM config_stages ORDER BY sort_order"),
      owners: await query("SELECT email FROM allowlist WHERE enabled=TRUE"),
    }),
  );
  app.post("/prospects", async (req, res) => {
    const id = await transaction((c) => insert(req.body, req.session.user, c));
    res.redirect(`/prospects/${id}`);
  });
  app.get("/prospects/:id", async (req, res) => {
    const p = await prospect(req.params.id);
    const activities = await query(
      "SELECT * FROM activities WHERE prospect_id=? ORDER BY occurred_on DESC,id DESC",
      [p.id],
    );
    const requests = await query(
      "SELECT * FROM sp_requests WHERE prospect_id=? ORDER BY id DESC",
      [p.id],
    );
    const notifications = await query(
      "SELECT kind,status FROM notifications WHERE prospect_id=? ORDER BY id DESC LIMIT 10",
      [p.id],
    );
    res.render("prospect", {
      p,
      activities,
      outcomes,
      requests,
      notifications,
      json,
    });
  });
  app.get("/prospects/:id/edit", async (req, res) =>
    res.render("prospect-form", {
      p: await prospect(req.params.id),
      fields,
      frequencies,
      tiers,
      stages: await query("SELECT * FROM config_stages ORDER BY sort_order"),
      owners: await query("SELECT email FROM allowlist WHERE enabled=TRUE"),
    }),
  );
  app.post("/prospects/:id", async (req, res) => {
    await transaction(async (c) => {
      const p = await prospect(req.params.id, c);
      const body = { ...req.body, service_lane: p.service_lane };
      const data = await validate(body, c);
      if (p.client_id && data.business_name !== p.business_name)
        fail("Client name is locked after SharePoint creation.");
      if (p.hold && data.stage !== p.stage)
        fail("Release the urgent hold before changing stage.");
      if (data.stage === "Closed Lost" && req.session.user.role !== "owner")
        fail("Owner access required.", 403);
      const keys = fields.map((x) => x[0]);
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
        trackerHeaders.pipeline,
        ...p.map((r) => pipelineFields.map(([k]) => r[k])),
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
  const showPreview = (res, preview) =>
    res.render("import", {
      headers: trackerHeaders,
      preview: preview
        ? {
            ...preview,
            needsLanes:
              preview.kind === "pipeline" &&
              preview.data.some(
                (r) => r.stage === "Technical Assessment" && !r.service_lane,
              ),
            rows:
              preview.kind === "pipeline"
                ? preview.data.map((r) => pipelineFields.map(([k]) => r[k]))
                : preview.data,
          }
        : null,
    });
  app.get("/import", (_req, res) => showPreview(res, null));
  app.post("/import/preview", async (req, res) => {
    delete req.session.importPreview;
    const preview = parseTracker(req.body.kind, req.body.csv);
    if (preview.kind === "pipeline")
      for (const row of preview.data) {
        // Validate all source values; unresolved lane mapping is reviewed separately.
        await validate({
          ...row,
          stage: row.stage === "Technical Assessment" ? "Discovery" : row.stage,
        });
      }
    if (!preview.ignored && preview.data.length)
      req.session.importPreview = preview;
    showPreview(res, preview);
  });
  app.post("/import/review", async (req, res) => {
    const preview = req.session.importPreview;
    if (!preview || preview.kind !== "pipeline")
      fail("Preview the Pipeline CSV first.");
    const mapped = [];
    for (const [i, row] of preview.data.entries()) {
      const resolved =
        row.stage === "Technical Assessment" && !row.service_lane
          ? resolveLegacyStage(row, req.body["lane_" + i])
          : row;
      mapped.push(await validate(resolved));
    }
    req.session.importPreview = { ...preview, data: mapped };
    showPreview(res, req.session.importPreview);
  });
  app.post("/import/commit", async (req, res) => {
    const preview = req.session.importPreview;
    if (!preview || !preview.data.length) fail("Preview a nonempty CSV first.");
    if (
      preview.kind === "pipeline" &&
      preview.data.some(
        (r) => r.stage === "Technical Assessment" && !r.service_lane,
      )
    )
      fail(
        "Choose BII or Managed IT for each Technical Assessment row and review the mapping first.",
      );
    await transaction(async (c) => {
      await query(
        "INSERT INTO imports (kind,actor) VALUES (?,?)",
        [preview.kind, req.session.user.email],
        c,
      );
      for (const row of preview.data) {
        if (preview.kind === "pipeline") await insert(row, req.session.user, c);
        else
          await query(
            "INSERT INTO weekly_imports (week_start,calls,conversations,qualified,proposals,recurring,hourly,notes) VALUES (?,?,?,?,?,?,?,?)",
            row,
            c,
          );
      }
      await audit(
        c,
        req.session.user,
        "commit import",
        preview.kind,
        preview.data.length,
      );
    });
    delete req.session.importPreview;
    res.redirect(preview.kind === "pipeline" ? "/pipeline" : "/weekly");
  });
}
