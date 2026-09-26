import { query, transaction, audit, json } from "./db.js";
import { text, integer, choice, date, fail } from "./security.js";
import { frequencies, tiers, opportunity } from "./config.js";
import { parse } from "csv-parse/sync";
export const fields = [
  ["business_name", "Business Name"],
  ["contact_name", "Contact Name"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["first_contact", "Date First Contacted"],
  ["employee_count", "Employee Count"],
  ["current_it", "Current IT Situation"],
  ["key_dependency", "Key Dependency"],
  ["call_frequency", "Call Frequency Signal"],
  ["likely_tier", "Likely Tier"],
  ["red_flag", "Red Flag (existing MSP?)"],
  ["stage", "Stage"],
  ["follow_up", "Follow-Up Date"],
  ["notes", "Notes"],
  ["owner", "Owner"],
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
export const weeklyHeaders = [
  "Week Start",
  "Calls Made",
  "Conversations Had",
  "Qualified Opportunities",
  "Proposals Sent",
  "Recurring Contracts Signed",
  "Hourly/Project Jobs Picked Up",
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
  return result;
}
async function insert(body, user, c) {
  const p = await validate(body, c);
  if (p.stage === "Closed Lost" && user.role !== "owner")
    fail("Owner access required.", 403);
  const keys = fields.map((x) => x[0]);
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
        fields.map((x) => x[1]),
        ...p.map((r) => fields.map(([k]) => r[k])),
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
        ]);
      }
    }
    res
      .type("text/csv")
      .attachment(kind + ".csv")
      .send(csv(rows));
  });
  app.get("/import", (req, res) =>
    res.render("import", {
      preview: null,
      headers: { pipeline: fields.map((x) => x[1]), weekly: weeklyHeaders },
    }),
  );
  app.post("/import/preview", async (req, res) => {
    const kind = choice(req.body.kind, ["pipeline", "weekly"]);
    const rows = parse(text(req.body.csv, 1500000), {
      bom: true,
      skip_empty_lines: true,
    });
    const expected =
      kind === "pipeline" ? fields.map((x) => x[1]) : weeklyHeaders;
    if (JSON.stringify(rows[0]) !== JSON.stringify(expected))
      fail("CSV headers must exactly match the displayed template.");
    if (rows.length > 2001) fail("Import at most 2,000 rows.");
    const data = [];
    for (const row of rows.slice(1)) {
      if (row.length !== expected.length)
        fail("CSV row width does not match the template.");
      if (kind === "pipeline") {
        data.push(
          await validate(
            Object.fromEntries(fields.map(([k], i) => [k, row[i]])),
          ),
        );
      } else {
        if (monday(row[0]) !== row[0]) fail("Week Start must be a Monday.");
        data.push([date(row[0]), ...row.slice(1).map((v) => integer(v))]);
      }
    }
    req.session.importPreview = { kind, data };
    res.render("import", {
      preview: { kind, rows: rows.slice(1) },
      headers: { pipeline: fields.map((x) => x[1]), weekly: weeklyHeaders },
    });
  });
  app.post("/import/commit", async (req, res) => {
    const preview = req.session.importPreview;
    if (!preview) fail("Preview the CSV first.");
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
            "INSERT INTO weekly_imports (week_start,calls,conversations,qualified,proposals,recurring,hourly) VALUES (?,?,?,?,?,?,?)",
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
