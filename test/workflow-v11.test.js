import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import {
  payload,
  buildFields,
  validateSchema,
  required,
  requiredChoices,
  submitRequest,
} from "../src/sharepoint.js";
import { discoverySnapshot } from "../src/discovery-export.js";
import {
  lostReasons,
  lostPayload,
  canMarkLost,
  businessNameError,
  guardPipelineEdit,
  serializePayload,
} from "../src/workflow-contract.js";
import {
  schema as questions,
  emptyAnswers,
  groups,
  format,
} from "../src/discovery-rules.js";
import { handoffRoutes, applyRequestStatus } from "../src/handoff.js";
import { adminRoutes } from "../src/admin.js";
import { json } from "../src/db.js";

const oldMode = process.env.SHAREPOINT_WRITE_MODE;
before(() => {
  process.env.SHAREPOINT_WRITE_MODE = "dryrun";
});
after(() => {
  if (oldMode === undefined) delete process.env.SHAREPOINT_WRITE_MODE;
  else process.env.SHAREPOINT_WRITE_MODE = oldMode;
});
const prospect = {
  id: 42,
  opp: "OPP-0042",
  business_name: "ABC Dental",
  stage: "Qualified",
  service_lane: "Business IT Integration",
  hold: false,
};
function discovery() {
  const answers = emptyAnswers();
  for (const [, ids] of groups)
    for (const id of ids) answers[id] = { state: "not_sure", value: null };
  answers["Q1.3"] = { state: "not_sure", value: null };
  answers["Q1.1"] = { state: "answered", value: "ABC Dental" };
  answers["Q3.1"] = { state: "answered", value: "A local IT company/MSP" };
  answers["Q5.1"] = {
    state: "answered",
    value: {
      none: false,
      entries: [
        { name: "Example App", use: "Scheduling", hosting: "Cloud-based" },
      ],
    },
  };
  return { answers, status: "Ready for Review", revision: 7 };
}
function connection() {
  const columns = (kind) =>
    required[kind].map((displayName, index) => ({
      displayName,
      name:
        displayName === "Title"
          ? "Title"
          : displayName === "Opportunity ID"
            ? "TIG_SalesOpportunityID"
            : `internal_${kind}_${index}`,
      ...(requiredChoices[kind][displayName]
        ? { choice: { choices: [...requiredChoices[kind][displayName]] } }
        : displayName === "Client"
          ? { lookup: {} }
          : { text: {} }),
    }));
  return {
    ...validateSchema(columns("requests"), columns("clients")),
    siteId: "site",
    requestListId: "requests",
  };
}

test("Create Client exports every question in order, all states, summary values and internal flags", () => {
  const d = discovery();
  const snapshot = discoverySnapshot(prospect, d, {
    capturedBy: "alanna@theitguys.us",
    at: new Date("2026-10-02T14:15:03Z"),
  });
  const body = payload("CreateClient", prospect, prospect.service_lane, {
    discovery: snapshot,
  });
  assert.deepEqual(body, {
    opportunityId: "OPP-0042",
    client: "ABC Dental",
    stage: "Sales Discovery",
    serviceLane: "Business IT Integration",
    discovery: {
      form: "BII Business Discovery Form v0.3 + v0.4 corrections",
      opportunityId: "OPP-0042",
      status: "Ready for Review",
      revision: 7,
      capturedBy: "alanna@theitguys.us",
      exportedAt: "2026-10-02T14:15:03.000Z",
      mvdComplete: true,
      flags: ["FLAG-CURRENT-PROVIDER", "FLAG-LOB-APP"],
      hold: { onHold: false, releasedBy: null, releaseNote: null },
      answers: snapshot.answers,
    },
  });
  assert.deepEqual(
    Object.keys(snapshot.answers),
    questions.map((q) => q.id),
  );
  const copy = JSON.parse(JSON.stringify(body)).discovery;
  assert.deepEqual(copy.answers["Q1.1"], {
    label: "Business name",
    state: "answered",
    value: "ABC Dental",
  });
  assert.equal(copy.answers["Q2.3"].state, "not_sure");
  assert.equal(copy.answers["Q6.2"].state, "not_discussed");
  assert.equal(copy.answers["Q6.2"].value, null);
  assert.deepEqual(copy.answers["Q5.1"].value, d.answers["Q5.1"].value.entries);
  assert.equal(copy.answers["Q3.1"].value, format(d.answers["Q3.1"]));
  assert.throws(
    () => payload("CreateClient", prospect, prospect.service_lane),
    /snapshot/,
  );
});

test("payload size accepts 60,000 and refuses 60,001 characters without truncation", () => {
  assert.equal(serializePayload("x".repeat(59998)).length, 60000);
  assert.throws(() => serializePayload("x".repeat(59999)), /60,000/);
  const options = { discovery: { padding: "" } };
  const size = JSON.stringify(
    payload("CreateClient", prospect, prospect.service_lane, options),
  ).length;
  options.discovery.padding = "x".repeat(60000 - size);
  assert.equal(
    JSON.stringify(
      payload("CreateClient", prospect, prospect.service_lane, options),
    ).length,
    60000,
  );
  options.discovery.padding += "x";
  assert.throws(
    () => payload("CreateClient", prospect, prospect.service_lane, options),
    /60,000/,
  );
});

test("Mark Lost exact payload and fields, reason whitelist and notes limit", async () => {
  const p = { ...prospect, client_id: "CL-0007", client_item_id: "17" },
    s = connection();
  const options = {
    reason: "Chose another provider",
    notes: "optional",
    expectedStage: "Quoting",
  };
  const body = buildFields(
    s,
    "MarkLost",
    p,
    p.service_lane,
    "josh@theitguys.us",
    new Date("2026-10-02T14:15:03Z"),
    undefined,
    options,
  );
  const m = s.maps.requests;
  assert.deepEqual(JSON.parse(body.fields[m.Payload.name]), {
    clientId: "CL-0007",
    ...options,
  });
  assert.equal(body.fields[m["Request Type"].name], "Mark Lost");
  assert.equal(body.fields.Title, "SALESAPP-OPP-0042-MarkLost-20261002141503");
  assert.equal(body.fields[m.Client.name + "LookupId"], "17");
  assert.equal(body.fields[m["Service Lane"].name], p.service_lane);
  for (const reason of lostReasons)
    assert.equal(lostPayload(p, { ...options, reason }).reason, reason);
  for (const reason of ["price", "Custom", "", null])
    assert.throws(() => lostPayload(p, { ...options, reason }));
  assert.equal(
    lostPayload(p, { ...options, notes: "x".repeat(500) }).notes.length,
    500,
  );
  assert.throws(() => lostPayload(p, { ...options, notes: "x".repeat(501) }));
  assert.throws(() => lostPayload(p, { ...options, expectedStage: undefined }));
  await submitRequest(
    { createWorkflowRequest: () => assert.fail("dryrun wrote") },
    "dryrun",
    s,
    body,
  );
});

for (const character of '\"*:<>?/\\|#%')
  test(`business name rejects ${character}`, () =>
    assert.ok(businessNameError(`A${character}C Pros`)));
test("business name periods, valid names, and linked pipeline guard", () => {
  for (const name of [".ABC", "ABC."]) assert.ok(businessNameError(name));
  assert.equal(businessNameError("A-C Pros"), null);
  assert.throws(
    () =>
      guardPipelineEdit(
        { ...prospect, client_id: "CL-1" },
        { ...prospect, stage: "Closed Lost" },
      ),
    /Use Mark Lost/,
  );
  assert.doesNotThrow(() =>
    guardPipelineEdit(prospect, { ...prospect, stage: "Closed Lost" }),
  );
  assert.throws(
    () =>
      guardPipelineEdit(prospect, { ...prospect, business_name: "A/C Pros" }),
    /SharePoint folder/,
  );
});

test("missing Mark Lost choice isolates action; Source spelling is exact", () => {
  const s = connection(),
    r = Object.values(s.maps.requests),
    c = Object.values(s.maps.clients);
  s.maps.requests["Request Type"].choice.choices = [
    "Create Client",
    "Start Stage",
  ];
  let checked = validateSchema(r, c);
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.actionErrors.MarkLost.length, 1);
  assert.throws(
    () =>
      buildFields(
        checked,
        "MarkLost",
        { ...prospect, client_id: "CL-7" },
        prospect.service_lane,
        "josh@theitguys.us",
      ),
    /missing choice/,
  );
  s.maps.requests.Source.choice.choices = ["Sales app"];
  checked = validateSchema(r, c);
  assert.ok(
    checked.errors.includes(
      'Source has "Sales app"; rename it to "Sales App" in the Workflow Requests list settings.',
    ),
  );
});

function routeHarness({
  linked = false,
  role = "owner",
  stage = "Quoting",
  pending = false,
  enabled = true,
} = {}) {
  const s = connection(),
    p = {
      ...prospect,
      ...(linked ? { client_id: "CL-0007", client_item_id: "17" } : {}),
    },
    d = discovery(),
    routes = new Map(),
    writes = [],
    audits = [];
  const query = async (sql, values) => {
    writes.push({ sql, values });
    if (sql.startsWith("SELECT id FROM sp_requests"))
      return pending ? [{ id: 1 }] : [];
    if (sql.startsWith("SELECT reason FROM config_lost_reasons"))
      return enabled ? lostReasons.map((reason) => ({ reason })) : [];
    if (sql.startsWith("SELECT actor FROM discovery_versions"))
      return [{ actor: "alanna@theitguys.us" }];
    if (sql.startsWith("INSERT INTO sp_requests")) return { insertId: 3 };
    return [];
  };
  const sp = {
    cache: s,
    ready: () => s,
    requests: async () => [],
    client: async () =>
      linked
        ? {
            id: "17",
            fields: { [s.maps.clients["Current Stage"].name]: stage },
          }
        : null,
  };
  handoffRoutes(
    {
      get: (path, ...handlers) => routes.set("GET " + path, handlers),
      post: (path, ...handlers) => routes.set("POST " + path, handlers),
    },
    {
      query,
      transaction: async (fn) => fn({}),
      audit: async (...args) => audits.push(args),
      prospect: async () => p,
      discovery: async () => d,
      sp,
      graph: {
        createWorkflowRequest: () => assert.fail("No Graph writes in dryrun"),
      },
      refresh: async () => (linked ? { "Current Stage": stage } : null),
    },
  );
  const req = {
    params: { id: 42 },
    body: {},
    session: {
      user: { email: "josh@theitguys.us", role },
      lostReviews: { 42: "Quoting" },
    },
  };
  let rendered, redirected;
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    send(message) {
      throw Object.assign(new Error(message), { status: this.code });
    },
    redirect(url) {
      redirected = url;
    },
    render: (_view, locals) => {
      rendered = locals;
    },
  };
  return {
    writes,
    audits,
    p,
    d,
    sp,
    req,
    s,
    get redirected() {
      return redirected;
    },
    async call(path, body = {}) {
      req.body = body;
      const handlers = routes.get(path);
      for (const fn of handlers) await fn(req, res, () => {});
      return rendered;
    },
  };
}

test("Create Client dryrun stores the full discovery body before dispatch", async () => {
  const h = routeHarness();
  await h.call("POST /prospects/:id/handoff", {
    action: "CreateClient",
    service_lane: prospect.service_lane,
  });
  const record = h.writes.find((w) =>
    w.sql.startsWith("INSERT INTO sp_requests"),
  );
  const body = JSON.parse(record.values[2]);
  const snapshot = JSON.parse(
    body.fields[h.s.maps.requests.Payload.name],
  ).discovery;
  assert.equal(snapshot.capturedBy, "alanna@theitguys.us");
  assert.equal(Object.keys(snapshot.answers).length, questions.length);
  assert.ok(snapshot.flags.includes("FLAG-LOB-APP"));
  assert.ok(
    h.writes.some(
      (w) =>
        w.sql.startsWith("UPDATE sp_requests SET status=?,item_id") &&
        w.values[0] === "Dryrun",
    ),
  );
});

test("handoff submissions return to the prospect workspace", async () => {
  const h = routeHarness();
  await h.call("POST /prospects/:id/handoff", {
    action: "CreateClient",
    service_lane: prospect.service_lane,
  });
  assert.equal(h.redirected, "/prospects/42");
});

test("Mark Lost route is owner only, validates stale stage/reasons and respects pending requests", async () => {
  const body = { reason: "Price", notes: "", expectedStage: "Quoting" };
  const valid = routeHarness({ linked: true });
  await valid.call("POST /prospects/:id/mark-lost", { ...body });
  assert.ok(
    valid.writes.some(
      (w) =>
        w.sql.startsWith("INSERT INTO sp_requests") &&
        w.values[1] === "MarkLost",
    ),
  );
  for (const options of [
    { linked: true, role: "sales" },
    { linked: true, stage: "Client Activation" },
    { linked: true, pending: true },
    { linked: true, enabled: false },
    {},
  ]) {
    const h = routeHarness(options);
    await assert.rejects(h.call("POST /prospects/:id/mark-lost", { ...body }));
    assert.ok(
      !h.writes.some((w) => w.sql.startsWith("INSERT INTO sp_requests")),
    );
  }
  const h = routeHarness({ linked: true });
  await assert.rejects(
    h.call("POST /prospects/:id/mark-lost", {
      ...body,
      expectedStage: "Contracting",
    }),
    /Reload/,
  );
  const sales = routeHarness({ linked: true, role: "sales" });
  await assert.rejects(
    sales.call("POST /prospects/:id/handoff", { ...body, action: "MarkLost" }),
    /Owner/,
  );
});

test("Mark Lost UI hides action for signed, unknown and unlinked clients and nonowners", async () => {
  const render = async (options) => {
    const h = routeHarness(options),
      locals = await h.call("GET /prospects/:id/handoff");
    return ejs.renderFile("views/handoff.ejs", {
      ...locals,
      user: h.req.session.user,
      mode: "dryrun",
      csrf: "token",
      json,
    });
  };
  for (const stage of [
    "Client Activation",
    "Onboarding",
    "Go-Live",
    "Operations",
    "Project Delivery",
    "Acceptance",
    "Offboarding",
    "Closed - Lost",
    "New stage",
    "",
  ]) {
    assert.equal(canMarkLost(stage), false);
    const html = await render({ linked: true, stage });
    assert.ok(!html.includes('action="/prospects/42/mark-lost"'));
    assert.ok(html.includes("Start Offboarding"));
  }
  for (const options of [{ linked: false }, { linked: true, role: "sales" }])
    assert.ok(
      !(await render(options)).includes('action="/prospects/42/mark-lost"'),
    );
  assert.ok(
    (await render({ linked: true })).includes(
      'action="/prospects/42/mark-lost"',
    ),
  );
});

test("Done closes locally and audits once, including reconciliation; Rejected preserves stage and message", async () => {
  const p = { ...prospect },
    r = { id: 7, action: "MarkLost", status: "Done" },
    queries = [],
    events = [];
  let applied = false;
  const deps = {
    transaction: async (fn) => fn({}),
    query: async (sql, values) => {
      queries.push([sql, values]);
      return sql.startsWith("SELECT id FROM audit_log") && applied
        ? [{ id: 1 }]
        : [];
    },
    audit: async (_c, _u, action) => {
      events.push(action);
      if (action === "apply Mark Lost") applied = true;
    },
  };
  await applyRequestStatus(p, r, "Done", "Closed", deps);
  await applyRequestStatus(p, r, "Done", "Closed", deps);
  assert.equal(p.stage, "Closed Lost");
  assert.equal(events.filter((e) => e === "apply Mark Lost").length, 1);
  assert.equal(
    queries.filter(([sql]) => sql.startsWith("UPDATE prospects SET stage"))
      .length,
    1,
  );
  const rejected = { ...prospect };
  await applyRequestStatus(
    rejected,
    { ...r, status: "Pending" },
    "Rejected",
    "Stage changed",
    deps,
  );
  assert.equal(rejected.stage, "Qualified");
  assert.ok(
    queries.some(
      ([sql, values]) =>
        sql.startsWith("UPDATE sp_requests") && values[1] === "Stage changed",
    ),
  );
});

test("Admin lost-reason configuration is owner-only", () => {
  const routes = new Map();
  adminRoutes({
    get() {},
    post: (path, ...handlers) => routes.set(path, handlers),
  });
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    send(message) {
      this.message = message;
    },
  };
  routes.get("/admin/lost-reasons")[0](
    { session: { user: { role: "sales" } } },
    res,
    () => assert.fail("Sales passed owner guard"),
  );
  assert.equal(res.code, 403);
});

test("Create Client still requires qualification and MVD and blocks unsafe names before writing", async () => {
  for (const change of [
    (h) => {
      h.p.stage = "Prospecting";
    },
    (h) => {
      h.d.answers["Q1.5"] = { state: "not_discussed", value: null };
    },
    (h) => {
      h.p.business_name = "A/C Pros";
    },
    (h) => {
      h.p.hold = true;
    },
  ]) {
    const h = routeHarness();
    change(h);
    await assert.rejects(
      h.call("POST /prospects/:id/handoff", {
        action: "CreateClient",
        service_lane: prospect.service_lane,
      }),
    );
    assert.ok(
      !h.writes.some((w) => w.sql.startsWith("INSERT INTO sp_requests")),
    );
  }
  const h = routeHarness();
  h.p.business_name = "A/C Pros";
  const locals = await h.call("GET /prospects/:id/handoff");
  const html = await ejs.renderFile("views/handoff.ejs", {
    ...locals,
    user: h.req.session.user,
    mode: "dryrun",
    csrf: "token",
    json,
  });
  assert.match(html, /<button\s+disabled\s*>\s*Create client in SharePoint/);
  assert.ok(html.includes("SharePoint folder name"));
});

test("missing Mark Lost choice leaves Create Client usable and prevents Mark Lost", async () => {
  const h = routeHarness();
  h.s.actionErrors.MarkLost = ["Mark Lost choice missing"];
  await h.call("POST /prospects/:id/handoff", {
    action: "CreateClient",
    service_lane: prospect.service_lane,
  });
  const linked = routeHarness({ linked: true });
  linked.s.actionErrors.MarkLost = ["Mark Lost choice missing"];
  await assert.rejects(
    linked.call("POST /prospects/:id/mark-lost", {
      reason: "Price",
      expectedStage: "Quoting",
    }),
    /choice missing/,
  );
});

test("Mark Lost refuses remote Pending and Processing requests for the client", async () => {
  for (const status of ["Pending", "Processing"]) {
    const h = routeHarness({ linked: true }),
      m = h.s.maps.requests;
    h.sp.requests = async () => [
      {
        fields: {
          [m["Processing Status"].name]: status,
          [m.Payload.name]: JSON.stringify({ clientId: "CL-0007" }),
        },
      },
    ];
    await assert.rejects(
      h.call("POST /prospects/:id/mark-lost", {
        reason: "Price",
        expectedStage: "Quoting",
      }),
      /already Pending or Processing/,
    );
    assert.ok(
      !h.writes.some((w) => w.sql.startsWith("INSERT INTO sp_requests")),
    );
  }
});

test("Start Stage gates retain approved BII quoting and Managed IT assessment rules", async () => {
  const h = routeHarness({ linked: true });
  await assert.rejects(
    h.call("POST /prospects/:id/handoff", { action: "Quoting" }),
    /Approved quote/,
  );
  await assert.rejects(
    h.call("POST /prospects/:id/handoff", { action: "TechnicalAssessment" }),
    /not enabled/,
  );
  h.p.service_lane = "Managed IT";
  await h.call("POST /prospects/:id/handoff", {
    action: "TechnicalAssessment",
  });
  const stored = h.writes.find((w) =>
    w.sql.startsWith("INSERT INTO sp_requests"),
  );
  assert.deepEqual(
    JSON.parse(
      JSON.parse(stored.values[2]).fields[h.s.maps.requests.Payload.name],
    ),
    {
      clientId: "CL-0007",
      stage: "Technical Assessment",
      serviceLane: "Managed IT",
    },
  );
});
