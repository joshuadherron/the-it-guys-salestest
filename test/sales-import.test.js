import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ejs from "ejs";
import { parse } from "csv-parse/sync";
import {
  parseImport,
  parseSalesExport,
  liveHeaders,
  liveFields,
  needsLane,
  reviewLane,
  importNames,
} from "../src/sales-import.js";
import { services, lanes, stages } from "../src/config.js";
import { service, structuredFields } from "../src/prospect-data.js";
import { commitImport } from "../src/import-commit.js";
import {
  csv,
  fields,
  pipelineExportFields,
  insertProspect,
  validateProspect,
} from "../src/pipeline.js";
import { trackerHeaders } from "../src/tracker-import.js";
// Only synthetic data belongs here. No production export is read by this suite.
const example = {
  businessName: "Synthetic Fabrication, LLC",
  contactName: "Synthetic Contact",
  phone: "555-0100",
  email: "synthetic@example.test",
  city: "Test City",
  employeeCount: "7",
  currentIT: "Internal, part time",
  keyDependency: "Synthetic ERP",
  icp: "B",
  stage: "Prospecting",
  nextAction: "Synthetic follow-up",
  nextActionDate: "2026-10-02",
  nextActionTime: "09:05",
  nextActionMethod: "Call",
  meetingDate: "2026-10-05",
  meetingTime: "13:30:15",
  meetingType: "Discovery",
  meetingLocation: "Synthetic office",
  meetingDuration: "30",
  teamsScheduled: "false",
  teamsJoinUrl: "https://example.test/synthetic-meeting",
  estMonthlyRevenue: "250.75",
  joshNeeded: "true",
  status: "Active",
  notes: 'Quoted "detail", retained\nSecond line'.replace("\\n", "\n"),
};
const encode = (rows) =>
  rows
    .map((row) =>
      row
        .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
        .join(","),
    )
    .join("\r\n");
const source = (overrides = {}) =>
  encode([
    liveHeaders,
    liveHeaders.map((k) => ({ ...example, ...overrides })[k]),
  ]);
const parsed = (overrides = {}) => parseSalesExport(source(overrides)).data[0];
const fakeLookup = async (sql) =>
  sql.includes("allowlist")
    ? [{ email: "alanna@theitguys.us" }]
    : sql.includes("config_stages")
      ? stages.map((name) => ({
          name,
          managed_only: name === "Technical Assessment",
        }))
      : assert.fail("Unexpected database read");
test("exact 25-column header is detected automatically and from Pipeline selection", () => {
  assert.deepEqual(
    liveHeaders,
    "businessName,contactName,phone,email,city,employeeCount,currentIT,keyDependency,icp,stage,nextAction,nextActionDate,nextActionTime,nextActionMethod,meetingDate,meetingTime,meetingType,meetingLocation,meetingDuration,teamsScheduled,teamsJoinUrl,estMonthlyRevenue,joshNeeded,status,notes".split(
      ",",
    ),
  );
  for (const kind of ["auto", "current_sales", "pipeline"])
    assert.equal(parseImport(kind, source()).kind, "current_sales");
  assert.equal(parseImport("auto", "\uFEFF" + source()).data.length, 1);
});
test("partial, reordered, additional and renamed headers are rejected", () => {
  for (const header of [
    liveHeaders.slice(0, -1),
    [...liveHeaders, "extra"],
    [liveHeaders[1], liveHeaders[0], ...liveHeaders.slice(2)],
    liveHeaders.map((h) => (h === "city" ? "City" : h)),
  ])
    assert.throws(
      () => parseImport("auto", encode([header, header.map(() => "")])),
      /headers/,
    );
});
test("every live source field survives mapping with typed values and full notes", async () => {
  const row = parsed();
  const normalized = await validateProspect(row, null, fakeLookup);
  const expected = {
    ...Object.fromEntries(liveFields.map(([from, to]) => [to, example[from]])),
    employee_count: 7,
    meeting_duration: 30,
    teams_scheduled: false,
    josh_needed: true,
  };
  for (const [, key] of liveFields)
    assert.equal(normalized[key], expected[key], key);
  assert.equal(row.follow_up, example.nextActionDate);
  assert.equal(row.import_source, "current_sales");
  assert.equal(row.first_contact, null);
  assert.equal(row.likely_service, null);
  assert.equal(row.service_lane, null);
  assert.equal(row.notes, example.notes);
  assert.ok(row.notes.includes("\n"));
});
for (const [sourceStage, target] of [
  ["Prospecting", "Prospecting"],
  ["Qualified", "Qualified"],
  ["Closed Lost", "Closed Lost"],
  ["Contacted", "Prospecting"],
  ["Follow-Up", "Prospecting"],
  ["Nurture", "Prospecting"],
])
  test(`${sourceStage} preserves source/status and maps to ${target}`, () => {
    const status =
      sourceStage === "Nurture"
        ? "Nurture"
        : sourceStage === "Closed Lost"
          ? "Lost"
          : "Active";
    const row = parsed({ stage: sourceStage, status });
    assert.equal(row.stage, target);
    assert.equal(row.legacy_stage, sourceStage);
    assert.equal(row.status, status);
    assert.equal(row.next_action, example.nextAction);
    assert.equal(row.next_action_date, example.nextActionDate);
    assert.equal(row.next_action_time, example.nextActionTime);
    assert.equal(row.next_action_method, example.nextActionMethod);
  });
test("Technical Discovery has no inferred lane; explicit lane resolves operational stage only", () => {
  const row = parsed({
    stage: "Technical Discovery",
    notes: "Managed IT + Security BII words are not a decision",
  });
  assert.ok(needsLane(row));
  assert.equal(row.service_lane, null);
  assert.throws(() => reviewLane(row, ""));
  for (const [lane, stage] of [
    ["Business IT Integration", "Discovery"],
    ["Managed IT", "Technical Assessment"],
  ]) {
    const reviewed = reviewLane(row, lane);
    assert.equal(reviewed.stage, stage);
    assert.equal(reviewed.service_lane, lane);
    assert.equal(reviewed.legacy_stage, "Technical Discovery");
    assert.equal(reviewed.likely_service, null);
    assert.equal(needsLane(reviewed), false);
  }
});
test("missing optional values stay empty/null; zeros and false stay distinct", () => {
  const blanks = Object.fromEntries(liveHeaders.map((k) => [k, ""]));
  const row = parsed({
    ...blanks,
    businessName: "Synthetic empty fields",
    stage: "Prospecting",
  });
  for (const key of [
    "likely_service",
    "service_lane",
    "first_contact",
    "follow_up",
    "employee_count",
    ...structuredFields.map(([key]) => key),
  ])
    assert.equal(row[key], null, key);
  for (const key of ["phone", "email", "notes", "call_frequency", "red_flag"])
    assert.equal(row[key], "");
  const zeros = parsed({
    employeeCount: "0",
    meetingDuration: "0",
    teamsScheduled: "0",
    estMonthlyRevenue: "0",
    joshNeeded: "false",
  });
  assert.equal(zeros.employee_count, 0);
  assert.equal(zeros.meeting_duration, 0);
  assert.equal(zeros.est_monthly_revenue, "0.00");
  assert.equal(zeros.josh_needed, false);
  assert.equal(zeros.teams_scheduled, false);
});
test("invalid types and impossible dates are rejected without echoing records", () => {
  for (const overrides of [
    { employeeCount: "-1" },
    { employeeCount: "1e3" },
    { meetingDuration: "2.5" },
    { teamsScheduled: "not false" },
    { joshNeeded: "yes please" },
    { estMonthlyRevenue: "1,000" },
    { estMonthlyRevenue: "NaN" },
    { estMonthlyRevenue: "2.555" },
    { nextActionDate: "2026-02-30" },
    { meetingDate: "2026-13-01" },
    { nextActionTime: "25:00" },
    { meetingTime: "09:61" },
    { status: "Unknown" },
    { stage: "Invented" },
    { teamsJoinUrl: "javascript:alert(1)" },
  ])
    assert.throws(
      () => parsed(overrides),
      (e) => e.status === 400 && !e.message.includes(example.businessName),
    );
});
test("exact current commercial services and unchanged SharePoint lanes", () => {
  assert.deepEqual(services, [
    "Managed IT",
    "Managed IT + Security",
    "BII",
    "Project",
    "Other",
  ]);
  assert.deepEqual(lanes, ["Business IT Integration", "Managed IT"]);
  assert.equal(service(""), null);
  for (const s of services) assert.equal(service(s), s);
  for (const old of [
    "Monitoring & Maintenance",
    "Essentials",
    "Standard",
    "BII only",
    "Not sure",
  ])
    assert.throws(() => service(old));
  assert.ok(
    fields.some(
      ([key, label]) => key === "likely_service" && label === "Likely Service",
    ),
  );
  assert.ok(!fields.some(([key]) => key === "likely_tier"));
});
test("legacy exact headers remain recognized and obsolete tier is archival only", () => {
  const legacy = trackerHeaders.pipeline.map(
    (h) =>
      ({
        "Business Name": "Synthetic Legacy",
        Stage: "Technical Assessment",
        "Likely Tier": "BII only",
      })[h] || "",
  );
  const preview = parseImport(
    "auto",
    encode([trackerHeaders.pipeline, legacy]),
  );
  assert.equal(preview.kind, "pipeline");
  assert.equal(preview.data[0].likely_tier, "BII only");
  assert.equal(preview.data[0].likely_service, null);
  assert.ok(needsLane(preview.data[0]));
  assert.equal(
    reviewLane(preview.data[0], "Business IT Integration").stage,
    "Discovery",
  );
  assert.equal(
    parseImport(
      "auto",
      encode([
        trackerHeaders.weekly,
        ["2026-09-21", 1, 1, 0, 0, 0, 0, "Synthetic notes"],
      ]),
    ).kind,
    "weekly",
  );
  assert.equal(parseImport("legend", "ignored").ignored, true);
});
test("prepared SQL persistence retains every structured value after review", async () => {
  let inserted;
  const storage = {
    audit: async () => {},
    query: async (sql, values) => {
      if (sql.startsWith("INSERT INTO prospects")) {
        const columns = sql.match(/\((.*?)\) VALUES/)[1].split(",");
        assert.equal(new Set(columns).size, columns.length);
        assert.equal((sql.match(/\?/g) || []).length, values.length);
        inserted = Object.fromEntries(
          columns.map((key, i) => [key, values[i]]),
        );
        return { insertId: 1 };
      }
      return fakeLookup(sql);
    },
  };
  const row = reviewLane(
    parsed({ stage: "Technical Discovery" }),
    "Managed IT",
  );
  await insertProspect(
    row,
    { email: "josh@theitguys.us", role: "owner" },
    null,
    storage,
  );
  for (const [key] of structuredFields)
    assert.equal(inserted[key], row[key], key);
  assert.equal(inserted.legacy_stage, "Technical Discovery");
  assert.equal(inserted.stage, "Technical Assessment");
  assert.equal(inserted.service_lane, "Managed IT");
  assert.equal(inserted.notes, example.notes);
  assert.equal(inserted.likely_service, null);
  assert.equal(inserted.import_source, "current_sales");
});
function fakeDatabase() {
  const state = { kinds: new Set(), rows: [] };
  let tail = Promise.resolve();
  let failNext = false;
  const storage = {
    transaction: async (fn) => {
      const before = tail;
      let release;
      tail = new Promise((resolve) => (release = resolve));
      await before;
      const snapshot = { kinds: new Set(state.kinds), rows: [...state.rows] };
      try {
        return await fn({});
      } catch (e) {
        state.kinds = snapshot.kinds;
        state.rows = snapshot.rows;
        throw e;
      } finally {
        release();
      }
    },
    query: async (sql, params) => {
      assert.ok(sql.startsWith("INSERT INTO imports"));
      if (state.kinds.has(params[0]))
        throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      state.kinds.add(params[0]);
    },
    insert: async (row) => {
      state.rows.push({ ...row });
      if (failNext) {
        failNext = false;
        throw new Error("synthetic failure");
      }
    },
    audit: async () => {},
  };
  return {
    state,
    storage,
    failOnce: () => {
      failNext = true;
    },
  };
}
const owner = { email: "josh@theitguys.us", role: "owner" };
test("same source commits once under concurrent or repeated requests; legacy kind is independent", async () => {
  const db = fakeDatabase(),
    preview = parseImport("auto", source());
  const outcomes = await Promise.allSettled([
    commitImport(preview, owner, db.storage),
    commitImport(preview, owner, db.storage),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal(
    outcomes.find((o) => o.status === "rejected").reason.status,
    409,
  );
  assert.equal(db.state.rows.length, 1);
  await assert.rejects(
    commitImport(preview, owner, db.storage),
    (e) => e.status === 409,
  );
  await commitImport({ ...preview, kind: "pipeline" }, owner, db.storage);
  assert.equal(db.state.rows.length, 2);
});
test("failed commit rolls back reservation and rows; unresolved technical lane performs no database calls", async () => {
  const db = fakeDatabase();
  db.failOnce();
  const preview = parseImport("auto", source());
  await assert.rejects(
    commitImport(preview, owner, db.storage),
    /synthetic failure/,
  );
  assert.equal(db.state.rows.length, 0);
  assert.equal(db.state.kinds.size, 0);
  await commitImport(preview, owner, db.storage);
  assert.equal(db.state.rows.length, 1);
  await assert.rejects(
    commitImport(
      parseImport("auto", source({ stage: "Technical Discovery" })),
      owner,
      { transaction: () => assert.fail("Must not touch DB") },
    ),
    /Choose BII/,
  );
});
test("CSV expressions stay inert source text and are neutralized only on export", () => {
  const note = " =SUM(1,2)\nSynthetic second line";
  const row = parsed({ notes: note });
  assert.equal(row.notes, note);
  const output = parse(csv([[row.notes, "+123", "@cmd", "-1", "\tvalue"]]));
  for (const value of output[0]) assert.ok(value.startsWith("'"));
  for (const key of [
    ...liveFields.map(([, key]) => key),
    "likely_service",
    "service_lane",
    "legacy_stage",
    "import_source",
  ])
    assert.ok(
      pipelineExportFields.some(([column]) => column === key),
      key,
    );
});
test("preview shows source, target, status, full details, lane review and escaped data", async () => {
  const row = parsed({
    stage: "Technical Discovery",
    businessName: "<script>synthetic</script>",
  });
  const html = await ejs.renderFile("views/import.ejs", {
    user: owner,
    csrf: "synthetic",
    mode: "dryrun",
    headers: { ...trackerHeaders, current_sales: liveHeaders },
    importNames,
    needsLane,
    preview: {
      kind: "current_sales",
      data: [row],
      rows: [
        [row.business_name, row.legacy_stage, "Review required", row.status],
      ],
      displayHeaders: [
        "Business",
        "Source stage",
        "Proposed operational stage",
        "Status",
      ],
      needsLanes: true,
    },
  });
  assert.match(html, /Current Sales App export detected/);
  assert.match(html, /Technical Discovery/);
  assert.match(html, /Review required/);
  assert.match(html, /button disabled>Commit/);
  assert.ok(!html.includes("<script>synthetic</script>"));
  assert.match(html, /Full preserved details/);
});
test("migration 004 adds live fields and leaves existing tier values unconverted", async () => {
  const sql = await readFile("migrations/004_live_sales_migration.sql", "utf8");
  for (const key of [
    "likely_service",
    ...structuredFields.map(([key]) => key),
    "legacy_stage",
    "import_source",
  ])
    assert.ok(sql.includes("ADD COLUMN " + key), key);
  assert.ok(
    !/DROP|DELETE|UPDATE\s+prospects|CHANGE COLUMN\s+likely_tier/i.test(sql),
  );
});
