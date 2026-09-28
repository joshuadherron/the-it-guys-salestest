import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSchema,
  required,
  requiredChoices,
  payload,
  buildFields,
  assertNoPending,
  submitRequest,
  SharePoint,
} from "../src/sharepoint.js";
import { writeMail } from "../src/graph.js";
export function fixture() {
  const columns = (kind) =>
    required[kind].map((displayName, i) => ({
      displayName,
      name:
        displayName === "Title"
          ? "Title"
          : kind === "clients" && displayName === "Opportunity ID"
            ? "TIG_SalesOpportunityID"
            : `internal_${kind}_${i}`,
      ...(requiredChoices[kind][displayName]
        ? { choice: { choices: requiredChoices[kind][displayName] } }
        : displayName === "Client"
          ? { lookup: { listId: "clients" } }
          : { text: {} }),
    }));
  return {
    ...validateSchema(columns("requests"), columns("clients")),
    siteId: "site",
    requestListId: "requests",
    clientListId: "clients",
  };
}
const p = {
  opp: "OPP-0001",
  business_name: "Example",
  client_id: "CL-0001",
  client_item_id: "5",
};
class FakeGraph {
  writes = [];
  async createWorkflowRequest(...args) {
    this.writes.push(args);
    return { id: "42" };
  }
  async sendMail(message) {
    this.writes.push(message);
  }
}
for (const [kind, key, internalName, displayName] of [
  ["requests", "Title", "Title", "Request ID"],
  ["clients", "Title", "Title", "Client Name"],
  [
    "clients",
    "Opportunity ID",
    "TIG_SalesOpportunityID",
    "Sales Opportunity ID",
  ],
]) {
  test(`${kind}.${key} resolves the live internal name regardless of display names`, () => {
    const s = fixture();
    const columns = {
      requests: Object.values(s.maps.requests),
      clients: Object.values(s.maps.clients),
    };
    const live = columns[kind].find((c) => c.name === internalName);
    live.displayName = displayName;
    // Neither duplicate live labels nor the old required label may override it.
    columns[kind].push(
      { name: "UnrelatedLiveLabel", displayName },
      { name: "UnrelatedOldLabel", displayName: key },
    );
    const result = validateSchema(columns.requests, columns.clients);
    assert.deepEqual(result.errors, []);
    assert.equal(result.maps[kind][key], live);

    columns[kind] = columns[kind].filter((c) => c !== live);
    let invalid = validateSchema(columns.requests, columns.clients);
    assert.ok(
      invalid.errors.some((e) =>
        e.includes(`required column ${internalName} is missing or ambiguous`),
      ),
    );
    assert.equal(invalid.maps[kind][key], undefined);

    // Matching display names and case-insensitive internal names are not fallbacks.
    columns[kind].push({ ...live, name: internalName.toLowerCase() });
    invalid = validateSchema(columns.requests, columns.clients);
    assert.ok(invalid.errors.length);
    assert.equal(invalid.maps[kind][key], undefined);

    columns[kind].push(live, { ...live, displayName: "Another label" });
    invalid = validateSchema(columns.requests, columns.clients);
    assert.ok(invalid.errors.length);
    assert.equal(invalid.maps[kind][key], undefined);
    const sp = new SharePoint({});
    sp.cache = invalid;
    assert.throws(() => sp.ready(), /missing or ambiguous/);
  });
}

test("exact Create Client and Start Stage JSON", () => {
  assert.deepEqual(
    payload("CreateClient", p, "Business IT Integration", {
      discovery: { answers: {} },
    }),
    {
      discovery: { answers: {} },
      opportunityId: "OPP-0001",
      client: "Example",
      stage: "Sales Discovery",
      serviceLane: "Business IT Integration",
    },
  );
  assert.deepEqual(payload("Quoting", p, "Business IT Integration"), {
    clientId: "CL-0001",
    stage: "Quoting",
    serviceLane: "Business IT Integration",
  });
  assert.deepEqual(payload("TechnicalAssessment", p, "Managed IT"), {
    clientId: "CL-0001",
    stage: "Technical Assessment",
    serviceLane: "Managed IT",
  });
  assert.throws(() => payload("MarkLost", p, "Managed IT"));
  assert.throws(() => payload("Quoting", p, "Managed IT"));
  assert.throws(() => payload("CreateClient", p, ""));
});
test("maps exact internal names, title, source, actor, status and lookup ID", () => {
  const s = fixture();
  const body = buildFields(
    s,
    "Quoting",
    p,
    "Business IT Integration",
    "josh@theitguys.us",
    new Date("2026-09-26T12:34:56Z"),
  );
  const f = body.fields,
    m = s.maps.requests;
  assert.equal(f[m.Title.name], "SALESAPP-OPP-0001-Quoting-20260926123456");
  assert.equal(f[m.Source.name], "Sales App");
  assert.equal(f[m["Requested By"].name], "josh@theitguys.us");
  assert.equal(f[m["Processing Status"].name], "Pending");
  assert.equal(f[m.Client.name + "LookupId"], "5");
  assert.deepEqual(
    JSON.parse(f[m.Payload.name]),
    payload("Quoting", p, "Business IT Integration"),
  );
});
test("missing columns and choice values are explicit errors", () => {
  const s = fixture();
  const r = Object.values(s.maps.requests);
  const c = Object.values(s.maps.clients);
  assert.deepEqual(s.errors, []);
  assert.match(
    validateSchema(
      r.filter((x) => x.displayName !== "Payload"),
      c,
    ).errors.join(" "),
    /Payload/,
  );
  r.find((x) => x.displayName === "Source").choice.choices = ["Manual"];
  assert.match(validateSchema(r, c).errors.join(" "), /Source.*Sales App/);
});
test("Pending and Processing refuse same opportunity, client ID or lookup", () => {
  const s = fixture(),
    m = s.maps.requests;
  for (const status of ["Pending", "Processing"])
    for (const data of [{ opportunityId: p.opp }, { clientId: p.client_id }])
      assert.throws(
        () =>
          assertNoPending(
            [
              {
                fields: {
                  [m["Processing Status"].name]: status,
                  [m.Payload.name]: JSON.stringify(data),
                },
              },
            ],
            s,
            p,
          ),
        /already/,
      );
  assert.throws(() =>
    assertNoPending(
      [
        {
          fields: {
            [m["Processing Status"].name]: "Pending",
            [m.Client.name + "LookupId"]: "5",
          },
        },
      ],
      s,
      p,
    ),
  );
  assert.doesNotThrow(() =>
    assertNoPending(
      [
        {
          fields: {
            [m["Processing Status"].name]: "Done",
            [m.Payload.name]: JSON.stringify({ clientId: p.client_id }),
          },
        },
      ],
      s,
      p,
    ),
  );
  assert.throws(
    () =>
      assertNoPending(
        [
          {
            fields: {
              [m["Processing Status"].name]: "Pending",
              [m.Payload.name]: "invalid",
            },
          },
        ],
        s,
        p,
      ),
    /unreadable/,
  );
});
test("dryrun never calls Graph writes; live only writes Workflow Requests and mail", async () => {
  const fake = new FakeGraph();
  const s = fixture(),
    body = buildFields(
      s,
      "Quoting",
      p,
      "Business IT Integration",
      "josh@theitguys.us",
    );
  assert.equal((await submitRequest(fake, "dryrun", s, body)).status, "Dryrun");
  assert.equal(
    (await writeMail(fake, "dryrun", { message: {} })).status,
    "would email",
  );
  assert.deepEqual(fake.writes, []);
  await submitRequest(fake, "live", s, body);
  assert.deepEqual(fake.writes[0], ["site", "requests", body.fields]);
  await writeMail(fake, "live", { message: {} });
  assert.equal(fake.writes.length, 2);
});
test("Requested By person column requires explicit verified lookup mapping", () => {
  const s = fixture();
  s.maps.requests["Requested By"].personOrGroup = {
    allowMultipleSelection: false,
  };
  assert.throws(
    () =>
      buildFields(
        s,
        "Quoting",
        p,
        "Business IT Integration",
        "josh@theitguys.us",
      ),
    /verified/,
  );
  const b = buildFields(
    s,
    "Quoting",
    p,
    "Business IT Integration",
    "josh@theitguys.us",
    new Date(),
    12,
  );
  assert.equal(
    b.fields[s.maps.requests["Requested By"].name + "LookupId"],
    "12",
  );
});
test("connection failure closes handoff; display-name resolution does not guess", async () => {
  const fake = { read: async () => ({ id: "site" }), all: async () => [] };
  const sp = new SharePoint(fake);
  await sp.check();
  assert.match(sp.cache.errors.join(" "), /Workflow Requests/);
  assert.throws(() => sp.ready());
});
