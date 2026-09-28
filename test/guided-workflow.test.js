import { renderDiscoverySummary, discoveryRoutes } from "../src/discovery.js";
import { Graph } from "../src/graph.js";
import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import { nextStep } from "../src/next-step.js";
import {
  emptyAnswers,
  groups,
  schema,
  format,
  answer,
  majorFlagOrder,
} from "../src/discovery-rules.js";
import {
  actionTypes,
  workColumns,
  definitionColumns,
  outcomeFlags,
  openItem,
  mayComplete,
  workPayload,
  availableFlags,
  normalizeItem,
} from "../src/work-items.js";
import {
  SharePoint,
  validateSchema,
  required,
  requiredChoices,
  payload,
  buildFields,
  submitRequest,
} from "../src/sharepoint.js";
import { filteredRead } from "../src/sharepoint-work.js";
import {
  executeWorkAction,
  waitingForJosh,
  guidedRoutes,
  guidedData,
} from "../src/guided-workflow.js";

const p = {
  id: 1,
  opp: "OPP-0001",
  business_name: "Synthetic business",
  client_id: "CL-0001",
  client_item_id: "10",
  service_lane: "Business IT Integration",
};
const complete = () => {
  const a = emptyAnswers();
  for (const [, ids] of groups)
    for (const id of ids) a[id] = { state: "not_sure", value: null };
  a["Q1.3"] = { state: "not_sure", value: null };
  return a;
};
const d = {
  exists: true,
  status: "Ready for Review",
  answers: complete(),
  flags: [],
  revision: 7,
};
const client = {
  "Current Stage": "Quoting",
  "Stage Status": "In progress",
  "Service Lanes": [p.service_lane],
  "Next Action": "Resolve approval",
};
const item = {
  id: "41",
  clientId: p.client_id,
  workflowId: "BII-05",
  document: "Quote",
  stage: "Quoting",
  lane: p.service_lane,
  status: "",
  blocking: true,
  assignee: "Alanna",
  assigneeEmail: "alanna@theitguys.us",
  signatureRequired: false,
  exceptionStatus: "None",
  url: "https://example.test/quote",
};
const owner = { role: "owner", email: "josh@theitguys.us" },
  sales = { role: "sales", email: "alanna@theitguys.us" };
const cases = [
  [
    "hold wins",
    { p: { ...p, hold: true } },
    "On hold, waiting for Josh's review",
    "Josh",
    true,
    false,
  ],
  ["no discovery", { d: null }, "Start discovery", "Alanna", true, true],
  [
    "draft incomplete",
    { d: { ...d, status: "Draft", answers: emptyAnswers() } },
    "Continue discovery",
    "Alanna",
    true,
    true,
  ],
  [
    "draft complete",
    { d: { ...d, status: "Draft" } },
    "Send to Josh",
    "Alanna",
    true,
    true,
  ],
  [
    "unlinked",
    { p: { ...p, client_id: null } },
    ["Review discovery", "With Josh for review"],
    "Josh",
    true,
    false,
  ],
  [
    "pending",
    { pending: [{ status: "Processing" }, { status: "Pending" }] },
    "SharePoint is working (2 requests)",
    "SharePoint",
    false,
    false,
  ],
  [
    "BII no quote",
    { client: { ...client, "Current Stage": "Sales Discovery" } },
    "Build BII quote",
    "Alanna",
    true,
    true,
  ],
  [
    "BII draft quote",
    {
      client: { ...client, "Current Stage": "Sales Discovery" },
      quotes: [{ id: 2, status: "Draft" }],
    },
    "Approve quote",
    "Josh",
    true,
    false,
  ],
  [
    "BII approved quote",
    {
      client: { ...client, "Current Stage": "Sales Discovery" },
      quotes: [{ id: 2, status: "Approved" }],
    },
    "Send to Quoting",
    "Josh",
    true,
    false,
  ],
  [
    "Managed IT",
    {
      p: { ...p, service_lane: "Managed IT" },
      client: { ...client, "Current Stage": "Sales Discovery" },
    },
    "Start Technical Assessment",
    "Josh",
    true,
    false,
  ],
  [
    "closed lost",
    { client: { ...client, "Current Stage": "Closed - Lost" } },
    "Closed",
    null,
    false,
    false,
  ],
  [
    "closed former",
    { client: { ...client, "Current Stage": "Closed - Former Client" } },
    "Closed",
    null,
    false,
    false,
  ],
  [
    "signature preparing",
    {
      items: [
        { ...item, signatureRequired: true, signatureStatus: "Preparing" },
      ],
    },
    "Prepare for signature: set Internal Notes Removed and Ready to send",
    "Josh",
    true,
    false,
  ],
  [
    "signature awaiting",
    {
      items: [
        {
          ...item,
          signatureRequired: true,
          signatureStatus: "Sent - awaiting signature",
          sentAt: "2026-09-28",
        },
      ],
    },
    "Out for signature since 2026-09-28",
    "Client",
    false,
    false,
  ],
  [
    "earliest blocking",
    {
      items: [
        { ...item, id: "43", document: "Later", dueDate: "2026-12-01" },
        { ...item, dueDate: "2026-10-01" },
      ],
    },
    "Complete Quote",
    "Alanna",
    true,
    true,
  ],
  [
    "blocked",
    { client: { ...client, "Stage Status": "Blocked" } },
    "Resolve approval",
    "Josh",
    true,
    false,
  ],
  [
    "exception pending",
    { client: { ...client, "Stage Status": "Exception pending" } },
    "Resolve approval",
    "Josh",
    true,
    false,
  ],
  ["clear", {}, ["Advance stage", "Waiting for Josh"], "Josh", true, false],
  [
    "client read fails",
    { client: null },
    "SharePoint status unavailable",
    "Josh",
    true,
    false,
  ],
  [
    "work read fails",
    { items: null },
    "Work items unavailable",
    "Josh",
    true,
    false,
  ],
];
for (const [
  label,
  overrides,
  title,
  waitingOn,
  ownerAction,
  salesAction,
] of cases)
  for (const role of ["owner", "sales"])
    test(`nextStep ${label}: ${role}`, () => {
      const a = {
        p,
        d,
        client,
        items: [],
        quotes: [],
        pending: [],
        ...overrides,
      };
      const step = nextStep(
        a.p,
        a.d,
        a.quotes,
        a.client,
        a.items,
        a.pending,
        role,
      );
      assert.equal(
        step.title,
        Array.isArray(title) ? title[role === "owner" ? 0 : 1] : title,
      );
      assert.equal(step.waitingOn, waitingOn);
      assert.equal(
        Boolean(step.action),
        role === "owner" ? ownerAction : salesAction,
      );
    });

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
  const s = validateSchema(columns("requests"), columns("clients"));
  s.maps.clients["Current Stage"].choice.choices = [
    "Sales Discovery",
    "Quoting",
    "Technical Assessment",
    "Project Delivery",
    "Closed - Lost",
  ];
  return {
    ...s,
    siteId: "site",
    requestListId: "requests",
    clientOpsId: "ops",
    workErrors: [],
    definitionErrors: [],
    workChoices: { TIG_OutcomeFlags: outcomeFlags },
    definitions: [
      {
        id: "BII-05",
        document: "Quote",
        active: true,
        createCopy: true,
        lane: p.service_lane,
        triggerMode: "Outcome flag",
        triggerFlag: "Material findings",
      },
    ],
  };
}
const inputs = {
  ItemCompleted: { itemId: 41, outcomeFlags: [] },
  NotRequired: { itemId: 41, confirm: "yes" },
  RequestException: {
    itemId: 41,
    reason: "Approved alternate approach",
    reference: "Risk Acknowledgment.docx",
  },
  CreateWorkingCopy: {
    workflowId: "BII-05",
    instanceRef: "Branch 2",
    dueDate: "2026-10-01",
  },
  AdvanceStage: { expectedStage: "Quoting" },
  StartStage: { stage: "Project Delivery" },
};
const expected = {
  ItemCompleted: { itemId: 41, completionStatus: "Complete", outcomeFlags: [] },
  NotRequired: { itemId: 41, completionStatus: "Not Required" },
  RequestException: {
    itemId: 41,
    reason: inputs.RequestException.reason,
    reference: inputs.RequestException.reference,
  },
  CreateWorkingCopy: { clientId: p.client_id, ...inputs.CreateWorkingCopy },
  AdvanceStage: {
    clientId: p.client_id,
    serviceLane: p.service_lane,
    expectedStage: "Quoting",
  },
  StartStage: {
    clientId: p.client_id,
    stage: "Project Delivery",
    serviceLane: p.service_lane,
  },
};
for (const action of Object.keys(actionTypes))
  test(`${action} exact JSON, fields and dryrun`, async () => {
    const s = connection(),
      options = {
        ...inputs[action],
        allowedStages: s.maps.clients["Current Stage"].choice.choices,
      };
    assert.deepEqual(
      payload(action, p, p.service_lane, options),
      expected[action],
    );
    const body = buildFields(
      s,
      action,
      p,
      p.service_lane,
      owner.email,
      new Date("2026-09-28"),
      undefined,
      options,
    );
    assert.equal(
      body.fields[s.maps.requests["Request Type"].name],
      actionTypes[action],
    );
    assert.deepEqual(
      JSON.parse(body.fields[s.maps.requests.Payload.name]),
      expected[action],
    );
    assert.equal(
      (
        await submitRequest(
          { createWorkflowRequest: () => assert.fail("Graph write") },
          "dryrun",
          s,
          body,
        )
      ).status,
      "Dryrun",
    );
  });

test("flags, instanceRef and exception validation", () => {
  for (const flag of outcomeFlags)
    assert.deepEqual(
      workPayload("ItemCompleted", p, p.service_lane, {
        itemId: 41,
        outcomeFlags: [flag],
      }).outcomeFlags,
      [flag],
    );
  assert.throws(() =>
    workPayload("ItemCompleted", p, p.service_lane, {
      itemId: 41,
      outcomeFlags: ["Forged flag"],
    }),
  );
  for (const c of '/\\:*?"<>|#%')
    assert.throws(() =>
      workPayload("CreateWorkingCopy", p, p.service_lane, {
        workflowId: "BII-05",
        instanceRef: "A" + c + "B",
      }),
    );
  assert.throws(() =>
    workPayload("CreateWorkingCopy", p, p.service_lane, {
      workflowId: "BII-05",
      instanceRef: "x".repeat(41),
    }),
  );
  assert.equal(
    workPayload("CreateWorkingCopy", p, p.service_lane, {
      workflowId: "BII-05",
      instanceRef: "x".repeat(40),
    }).instanceRef.length,
    40,
  );
  assert.throws(() =>
    workPayload("CreateWorkingCopy", p, p.service_lane, {
      workflowId: "BII-05",
      dueDate: "2026-02-30",
    }),
  );
  for (const input of [
    { reason: "Too short", reference: "Note" },
    { reason: "Long enough reason", reference: " " },
  ])
    assert.throws(() =>
      workPayload("RequestException", p, p.service_lane, {
        itemId: 41,
        ...input,
      }),
    );
  assert.throws(() =>
    workPayload("StartStage", p, p.service_lane, {
      stage: "Closed - Lost",
      allowedStages: ["Closed - Lost"],
    }),
  );
});
test("open definition and assignee permissions are conservative", () => {
  for (const status of ["", "In progress", "Not started"])
    assert.ok(openItem({ status }));
  for (const status of ["Complete", "Not Required", "Cancelled"])
    assert.ok(!openItem({ status }));
  assert.ok(mayComplete(item, sales));
  assert.ok(!mayComplete({ ...item, assigneeEmail: null }, sales));
  assert.ok(!mayComplete({ ...item, assigneeEmail: owner.email }, sales));
  assert.ok(mayComplete({ ...item, assigneeEmail: null }, owner));
  assert.ok(
    !mayComplete(
      { ...item, signatureRequired: true, signatureStatus: "Preparing" },
      owner,
    ),
  );
  assert.ok(
    mayComplete(
      { ...item, signatureRequired: true, signatureStatus: "Signed" },
      owner,
    ),
  );
  const def = connection().definitions[0];
  assert.equal(
    availableFlags(
      [def, { ...def, active: false }, { ...def, lane: "Managed IT" }],
      [p.service_lane],
    ).length,
    1,
  );
});

function harness({ user = owner, target = item, pending = false } = {}) {
  const s = connection(),
    writes = [],
    audits = [],
    invalidations = [];
  const deps = {
    query: async (sql, values) => {
      writes.push({ sql, values });
      if (sql.startsWith("SELECT id FROM sp_requests")) return [];
      if (sql.startsWith("INSERT INTO sp_requests")) return { insertId: 9 };
      return [];
    },
    transaction: async (fn) => fn({}),
    audit: async (...args) => audits.push(args),
    prospect: async () => ({ ...p }),
    sp: {
      ready: () => s,
      client: async () => ({
        fields: Object.fromEntries(
          Object.entries(client).map(([key, value]) => [
            s.maps.clients[key].name,
            value,
          ]),
        ),
      }),
      workItems: async () => [target],
      requests: async () =>
        pending
          ? [
              {
                fields: {
                  [s.maps.requests["Processing Status"].name]: "Processing",
                  [s.maps.requests.Payload.name]: JSON.stringify({
                    clientId: p.client_id,
                  }),
                  [s.maps.requests.Source.name]: "Flow",
                },
              },
            ]
          : [],
      invalidateWorkItems: (id) => invalidations.push(id),
    },
    graph: {
      createWorkflowRequest: () => assert.fail("Dryrun wrote to Graph"),
    },
  };
  return {
    s,
    deps,
    writes,
    audits,
    invalidations,
    run: (action, overrides = {}) =>
      executeWorkAction(
        p.id,
        { action, ...inputs[action], ...overrides },
        user,
        "Quoting",
        deps,
      ),
  };
}
for (const action of Object.keys(actionTypes))
  test(`${action} pending guard, dryrun storage and role guard`, async () => {
    const before = process.env.SHAREPOINT_WRITE_MODE;
    process.env.SHAREPOINT_WRITE_MODE = "dryrun";
    try {
      const h = harness();
      await h.run(action);
      const stored = h.writes.find((w) =>
        w.sql.startsWith("INSERT INTO sp_requests"),
      );
      assert.deepEqual(
        JSON.parse(
          JSON.parse(stored.values[2]).fields[h.s.maps.requests.Payload.name],
        ),
        expected[action],
      );
      assert.equal(stored.values[3], inputs[action].itemId || null);
      assert.ok(h.audits.length >= 2);
      assert.deepEqual(h.invalidations, [p.client_id]);
      await assert.rejects(
        harness({ pending: true }).run(action),
        /already Pending or Processing/,
      );
      if (action !== "ItemCompleted")
        await assert.rejects(
          harness({ user: sales }).run(action),
          (e) => e.status === 403,
        );
    } finally {
      if (before === undefined) delete process.env.SHAREPOINT_WRITE_MODE;
      else process.env.SHAREPOINT_WRITE_MODE = before;
    }
  });
test("completion enforces assignment/signature/client membership and allowed active flags on POST", async () => {
  for (const target of [
    { ...item, assigneeEmail: null },
    { ...item, signatureRequired: true, signatureStatus: "Preparing" },
    { ...item, clientId: "CL-other" },
  ])
    await assert.rejects(harness({ user: sales, target }).run("ItemCompleted"));
  await assert.rejects(
    harness().run("ItemCompleted", { outcomeFlags: ["Quote-ready"] }),
  );
  await assert.rejects(harness().run("NotRequired", { confirm: "no" }));
  await assert.rejects(
    harness().run("CreateWorkingCopy", { workflowId: "MIT-other" }),
  );
  await assert.rejects(
    harness().run("AdvanceStage", { expectedStage: "Contracting" }),
    /stage changed/,
  );
});

test("missing new request types only disable their actions", () => {
  for (const type of [
    "Item Completed",
    "Request Exception",
    "Create Working Copy",
    "Advance Stage",
  ]) {
    const s = connection();
    s.maps.requests["Request Type"].choice.choices = s.maps.requests[
      "Request Type"
    ].choice.choices.filter((c) => c !== type);
    const result = validateSchema(
      Object.values(s.maps.requests),
      Object.values(s.maps.clients),
    );
    assert.deepEqual(result.errors, []);
    for (const [action, requestType] of Object.entries(actionTypes))
      assert.equal(
        Boolean(result.actionErrors[action].length),
        requestType === type,
      );
  }
});
test("Graph fallback carries Prefer, filters locally, sanitizes warning and does not fall back on access failure", async () => {
  const calls = [],
    warnings = [];
  const graph = {
    all: async (path, headers) => {
      calls.push({ path, headers });
      if (path.includes("$filter"))
        throw Object.assign(new Error("private client details"), {
          status: 400,
        });
      return [
        { fields: { TIG_ClientID: "CL-1" } },
        { fields: { TIG_ClientID: "CL-2" } },
      ];
    },
  };
  const rows = await filteredRead(
    graph,
    "/items?$expand=fields",
    "fields/TIG_ClientID eq 'CL-1'",
    (r) => r.fields.TIG_ClientID === "CL-1",
    (m) => warnings.push(m),
  );
  assert.equal(rows.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      (c) =>
        c.headers.Prefer === "HonorNonIndexedQueriesWarningMayFailRandomly",
    ),
  );
  assert.ok(!warnings[0].includes("private"));
  await assert.rejects(
    filteredRead(
      {
        all: async () => {
          throw Object.assign(new Error("Denied"), { status: 403 });
        },
      },
      "/items?x=1",
      "x",
      () => true,
    ),
  );
});
test("work item cache, assignee lookup and definition fallback", async () => {
  let reads = 0,
    userReads = 0;
  const sp = new SharePoint({
    all: async () => {
      reads++;
      return [
        {
          id: "41",
          driveItem: {
            name: "Fallback.docx",
            webUrl: "https://example.test/file",
          },
          fields: { TIG_ClientID: p.client_id, TIG_AssignedToLookupId: "7" },
        },
      ];
    },
    read: async () => {
      userReads++;
      return { fields: { EMail: "alanna@theitguys.us", Title: "Alanna" } };
    },
  });
  sp.cache = { ...connection(), userInfoId: "users" };
  const first = await sp.workItems(p.client_id);
  await sp.workItems(p.client_id);
  assert.equal(reads, 1);
  assert.equal(first[0].document, "Fallback.docx");
  assert.equal(first[0].assigneeEmail, sales.email);
  sp.invalidateWorkItems(p.client_id);
  await sp.workItems(p.client_id);
  assert.equal(reads, 2);
  assert.equal(userReads, 1);
  await sp.workItems(p.client_id, true);
  assert.equal(reads, 3);
});
test("connection check resolves optional libraries and names a missing column without blocking base handoff", async () => {
  const s = connection();
  const fake = {
    read: async () => ({ id: "site" }),
    all: async (path) => {
      if (path.includes("lists?$select"))
        return [
          { id: "requests", displayName: "Workflow Requests" },
          { id: "clients", displayName: "Clients" },
          { id: "ops", displayName: "Client Operations" },
          { id: "defs", displayName: "Client Workflow Definitions" },
        ];
      if (path.endsWith("requests/columns"))
        return Object.values(s.maps.requests);
      if (path.endsWith("clients/columns"))
        return Object.values(s.maps.clients);
      if (path.endsWith("ops/columns"))
        return workColumns
          .filter((name) => name !== "TIG_DueDate")
          .map((name) => ({ name }));
      if (path.endsWith("defs/columns"))
        return definitionColumns.map((name) => ({ name }));
      return [];
    },
  };
  const sp = new SharePoint(fake),
    checked = await sp.check();
  assert.deepEqual(checked.errors, []);
  assert.ok(checked.workErrors.some((e) => e.includes("TIG_DueDate")));
  await assert.rejects(sp.workItems(p.client_id), /TIG_DueDate/);
  assert.equal(checked.stageGateConfirmed, false);
});
test("summary full page renders both roles with owner-only controls and expanded inventory", async () => {
  for (const user of [owner, sales]) {
    const html = await ejs.renderFile("views/discovery-summary.ejs", {
      p: { ...p, hold: true },
      d,
      schema,
      format,
      answer,
      majorFlagOrder,
      completedGroups: 8,
      user,
      mode: "dryrun",
      csrf: "token",
    });
    assert.ok(html.includes("8 of 8 groups"));
    assert.equal(html.includes("Reopen for Alanna"), user.role === "owner");
    assert.equal(html.includes("Release hold</button>"), user.role === "owner");
    assert.equal(
      /<details class="card" open>/.test(html),
      user.role === "owner",
    );
  }
});
test("Today queue selects the requested cohorts and sorts oldest first", async () => {
  const queries = [];
  const queue = await waitingForJosh(async (sql) => {
    queries.push(sql);
    return sql.includes("LEFT JOIN discoveries")
      ? [{ id: 1, business_name: "A", hold: true, since: "2026-09-01" }]
      : sql.includes("FROM quotes")
        ? [{ id: 2, business_name: "B", since: "2026-09-02" }]
        : [
            {
              id: 3,
              business_name: "C",
              request_id: 9,
              status: "Rejected",
              since: "2026-09-03",
            },
          ];
  });
  assert.deepEqual(
    queue.map((r) => r.id),
    [1, 2, 3],
  );
  assert.ok(queries[0].includes("p.client_id IS NULL"));
  assert.ok(queries[1].includes("q.status='Draft'"));
  assert.ok(queries[2].includes("INTERVAL 14 DAY"));
  assert.ok(queries[2].includes("acknowledged_at IS NULL"));
  for (const user of [owner, sales]) {
    const html = await ejs.renderFile("views/pipeline.ejs", {
      user,
      mode: "dryrun",
      csrf: "token",
      today: true,
      waiting: queue,
      rows: [],
      stages: [],
      search: "",
      statusChoices: [],
      selectedStatus: "",
      opportunity: () => "",
    });
    assert.equal(html.includes("Acknowledge</button>"), user.role === "owner");
    if (user.role === "sales")
      assert.ok(html.includes("3 items waiting on Josh"));
  }
});
test("unsigned signature row never renders completion and safe URLs reject executable links", async () => {
  const unsigned = {
    ...item,
    signatureRequired: true,
    signatureStatus: "Preparing",
  };
  const html = await ejs.renderFile("views/workflow-panel.ejs", {
    user: owner,
    mode: "dryrun",
    csrf: "token",
    p,
    d,
    step: nextStep(p, d, [], client, [unsigned], [], "owner"),
    client,
    items: [unsigned],
    itemGroups: [{ label: "Current stage", items: [unsigned] }],
    requests: [],
    pending: [],
    error: null,
    schema: connection(),
    currentStage: "Quoting",
    stageGateNotice: true,
    completedGroups: 8,
    hasAnswers: true,
    flags: [],
    definitions: [],
    mayComplete,
    openItem,
    stageChoices: [],
    actionErrors: {},
  });
  assert.ok(!html.includes("Mark complete</button>"));
  assert.ok(html.includes("Completes automatically when signed"));
  assert.ok(html.includes("Confirm Stage Gate v1.1"));
  assert.equal(
    normalizeItem(
      { id: "1", fields: {}, driveItem: { webUrl: "javascript:alert(1)" } },
      [],
      null,
    ).url,
    null,
  );
});

test("assigned sales completion reaches dryrun; unresolved assignment is owner-only", async () => {
  const mode = process.env.SHAREPOINT_WRITE_MODE;
  process.env.SHAREPOINT_WRITE_MODE = "dryrun";
  try {
    const h = harness({ user: sales });
    await h.run("ItemCompleted");
    assert.ok(
      h.writes.some((w) => w.sql.startsWith("INSERT INTO sp_requests")),
    );
    await assert.rejects(
      harness({ user: sales, target: { ...item, assigneeEmail: null } }).run(
        "ItemCompleted",
      ),
      (e) => e.status === 403,
    );
  } finally {
    if (mode === undefined) delete process.env.SHAREPOINT_WRITE_MODE;
    else process.env.SHAREPOINT_WRITE_MODE = mode;
  }
});

test("signature sent date resolves uniquely by display name, signed date uses confirmed internal name", async () => {
  for (const matches of [0, 1, 2]) {
    const s = connection();
    const sp = new SharePoint({
      all: async (path) => {
        if (path.endsWith("ops/columns"))
          return [
            ...workColumns.map((name) => ({ name })),
            ...Array.from({ length: matches }, (_, i) => ({
              name: `UnconfirmedInternal${i}`,
              displayName: "Signature Sent Date",
            })),
          ];
        if (path.endsWith("defs/columns"))
          return definitionColumns.map((name) => ({ name }));
        return [];
      },
    });
    sp.cache = s;
    await sp.work.check([
      { id: "ops", displayName: "Client Operations" },
      { id: "defs", displayName: "Client Workflow Definitions" },
    ]);
    assert.deepEqual(s.workErrors, []);
    assert.equal(
      s.signatureSentColumn,
      matches === 1 ? "UnconfirmedInternal0" : null,
    );
    const row = {
      id: "1",
      fields: {
        UnconfirmedInternal0: "2026-09-27T13:00:00Z",
        TIG_SignedDate: "2026-09-28T10:00:00Z",
      },
    };
    const normalized = normalizeItem(row, [], null, s.signatureSentColumn);
    assert.equal(normalized.sentAt, matches === 1 ? "2026-09-27" : null);
    assert.equal(normalized.signedAt, "2026-09-28");
    row.fields.UnconfirmedInternal0 = "";
    assert.equal(
      normalizeItem(row, [], null, s.signatureSentColumn).sentAt,
      null,
    );
  }
});

test("Graph pagination forwards Prefer on every page", async () => {
  const graph = new Graph(),
    reads = [];
  graph.read = async (path, headers) => {
    reads.push({ path, headers });
    return reads.length === 1
      ? {
          value: [{ id: 1 }],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/page2",
        }
      : { value: [{ id: 2 }] };
  };
  assert.equal(
    (
      await graph.all("/page1", {
        Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly",
      })
    ).length,
    2,
  );
  assert.equal(reads[1].headers.Prefer, reads[0].headers.Prefer);
});

test("pending request reads are filtered but reconciliation can request full history", async () => {
  const reads = [],
    sp = new SharePoint({
      all: async (path, headers) => {
        reads.push({ path, headers });
        return [];
      },
    });
  sp.cache = connection();
  await sp.requests();
  assert.ok(decodeURIComponent(reads[0].path).includes("eq 'Pending' or"));
  assert.equal(
    reads[0].headers.Prefer,
    "HonorNonIndexedQueriesWarningMayFailRandomly",
  );
  await sp.requests(false);
  assert.ok(!reads[1].path.includes("$filter"));
});

test("assignee fallback only trusts a unique configured lookup mapping", async () => {
  const beforeJosh = process.env.SP_JOSH_USER_LOOKUP_ID,
    beforeAlanna = process.env.SP_ALANNA_USER_LOOKUP_ID;
  process.env.SP_JOSH_USER_LOOKUP_ID = "10";
  process.env.SP_ALANNA_USER_LOOKUP_ID = "11";
  try {
    const sp = new SharePoint({
      read: async () => {
        throw new Error("Access refused");
      },
    });
    sp.cache = { ...connection(), userInfoId: "users" };
    assert.equal((await sp.work.assignee("11")).email, sales.email);
    assert.equal(await sp.work.assignee("12"), null);
    process.env.SP_ALANNA_USER_LOOKUP_ID = "10";
    assert.equal(await sp.work.assignee("10"), null);
  } finally {
    if (beforeJosh === undefined) delete process.env.SP_JOSH_USER_LOOKUP_ID;
    else process.env.SP_JOSH_USER_LOOKUP_ID = beforeJosh;
    if (beforeAlanna === undefined) delete process.env.SP_ALANNA_USER_LOOKUP_ID;
    else process.env.SP_ALANNA_USER_LOOKUP_ID = beforeAlanna;
  }
});

test("summary route precedes screen matching and loads saved answers for either role", async () => {
  const registered = [];
  discoveryRoutes({ get: (path) => registered.push(path), post() {} });
  assert.ok(
    registered.indexOf("/prospects/:id/discovery/summary") <
      registered.indexOf("/prospects/:id/discovery/:screen"),
  );
  for (const user of [owner, sales]) {
    let locals;
    await renderDiscoverySummary(
      { params: { id: 1 }, session: { user } },
      {
        render: (view, data) => {
          assert.equal(view, "discovery-summary");
          locals = data;
        },
      },
      { prospect: async () => p, discovery: async () => d },
    );
    assert.equal(locals.completedGroups, 8);
    assert.equal(locals.d, d);
  }
});

test("acknowledgement is owner-only, changes only local review metadata and audits once", async () => {
  const routes = new Map(),
    calls = [],
    audits = [];
  guidedRoutes(
    { get() {}, post: (path, ...handlers) => routes.set(path, handlers) },
    {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { affectedRows: calls.length === 1 ? 1 : 0 };
      },
      transaction: async (fn) => fn({}),
      audit: async (...args) => audits.push(args),
    },
  );
  const handlers = routes.get("/requests/:id/acknowledge");
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    send() {},
    redirect() {},
  };
  handlers[0]({ session: { user: sales } }, res, () =>
    assert.fail("Sales passed"),
  );
  assert.equal(res.code, 403);
  const req = { params: { id: "9" }, session: { user: owner } };
  await handlers[1](req, res);
  await handlers[1](req, res);
  assert.ok(calls[0].sql.includes("acknowledged_at IS NULL"));
  assert.ok(calls[0].sql.includes("acknowledged_by=?"));
  assert.equal(audits.length, 1);
});

test("prospect refresh picks up Create Client completion and shows the new client's items", async () => {
  const current = { ...p, client_id: null, client_item_id: null },
    s = connection();
  let linked = false;
  const data = await guidedData(
    current,
    owner,
    {},
    {
      discovery: async () => d,
      query: async (sql) =>
        sql.includes("FROM sp_requests")
          ? [
              {
                id: 4,
                item_id: "44",
                action: "CreateClient",
                status: linked ? "Done" : "Pending",
              },
            ]
          : [],
      refresh: async (record) => {
        record.client_id = p.client_id;
        record.client_item_id = "10";
        linked = true;
      },
      sp: {
        cache: s,
        ready: () => s,
        client: async () => ({
          fields: Object.fromEntries(
            Object.entries(client).map(([k, v]) => [s.maps.clients[k].name, v]),
          ),
        }),
        requests: async () => [],
        workItems: async () => [item],
      },
    },
  );
  assert.equal(data.p.client_id, p.client_id);
  assert.equal(data.items.length, 1);
  assert.equal(data.requests[0].status, "Done");
  assert.equal(data.step.title, "Complete Quote");
});

test("missing optional work schema leaves discovery review available and disables advancing", async () => {
  const s = connection();
  s.workErrors = [
    "Client Operations: required internal column TIG_DueDate is missing or ambiguous.",
  ];
  const data = await guidedData(
    { ...p },
    owner,
    {},
    {
      discovery: async () => d,
      query: async () => [],
      refresh: async () => null,
      sp: {
        cache: s,
        ready: () => s,
        client: async () => ({
          fields: Object.fromEntries(
            Object.entries(client).map(([k, v]) => [s.maps.clients[k].name, v]),
          ),
        }),
        requests: async () => [],
        workItems: async () => {
          throw new Error("Missing column");
        },
      },
    },
  );
  assert.equal(data.step.title, "Work items unavailable");
  assert.equal(data.completedGroups, 8);
  assert.ok(data.error);
  assert.equal(data.items, null);
});

test("Stage Gate evidence detects a Done Item Completed payload with an authoritative empty array", async () => {
  const s = connection();
  const sp = new SharePoint({
    all: async (path) =>
      path.includes("$filter")
        ? [
            {
              fields: {
                [s.maps.requests["Processing Status"].name]: "Done",
                [s.maps.requests["Request Type"].name]: "Item Completed",
                [s.maps.requests.Payload.name]: JSON.stringify({
                  itemId: 1,
                  outcomeFlags: [],
                }),
              },
            },
          ]
        : [],
  });
  sp.cache = s;
  await sp.work.check([]);
  assert.equal(s.stageGateConfirmed, true);
  assert.deepEqual(s.errors, []);
});
