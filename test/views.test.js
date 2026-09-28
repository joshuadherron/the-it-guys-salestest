import { screens, sectionFor, requiredProgress } from "../src/discovery-ui.js";
import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import {
  schema,
  ownership,
  emptyAnswers,
  format,
  answer,
  majorFlagOrder,
} from "../src/discovery-rules.js";
import { fields, outcomes, weeklyHeaders } from "../src/pipeline.js";
import {
  services,
  frequencies,
  prices,
  stages,
  opportunity,
  lanes,
} from "../src/config.js";
import { platforms, oneOffItems, priceQuote } from "../src/pricing.js";
import { prefill } from "../src/quotes.js";
import { plainResult } from "../src/sharepoint.js";
const p = {
  id: 1,
  opp: "OPP-0001",
  business_name: "<script>alert(1)</script>",
  contact_name: "Example",
  stage: "Qualified",
  owner: "alanna@theitguys.us",
  hold: false,
};
const d = { answers: emptyAnswers(), flags: [], revision: 0, status: "Draft" };
import { structuredFields, statusChoices } from "../src/prospect-data.js";
import { importNames, needsLane } from "../src/sales-import.js";
const common = {
  structuredFields,
  importNames,
  needsLane,
  statusChoices,
  selectedStatus: "",
  user: { email: "josh@theitguys.us", role: "owner" },
  mode: "dryrun",
  csrf: "token",
  p,
  d,
};
for (let screen = 1; screen <= 3; screen++)
  test(`discovery screen ${screen} renders safely`, async () => {
    const html = await ejs.renderFile("views/discovery.ejs", {
      ...common,
      screen,
      schema,
      screens,
      sectionFor,
      progress: requiredProgress(d.answers),
      ownership,
      format,
      answer,
      majorFlagOrder,
      notifications: [],
      missing: ["Company & contact"],
      readonly: false,
    });
    assert.ok(html.includes(screens[screen - 1].replaceAll("&", "&amp;")));
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(html.includes(`Section ${screen} of 3`));
    for (const q of schema)
      assert.equal(
        html.includes(`data-question="${q.id}"`),
        sectionFor(q) === screen,
      );
    assert.ok(html.includes("Change status"));
    assert.ok(html.includes('value="not_sure"'));
    assert.ok(html.includes('value="not_discussed"'));
    assert.ok(!/class="answer-fields"[^>]*hidden/.test(html));
    assert.ok(
      !/<details[^>]*open[^>]*>\s*<summary>Question guidance/.test(html),
    );
    assert.ok(!/<script(?![^>]*src=)/.test(html));
  });
const input = prefill(d.answers),
  calculation = priceQuote(input, prices);
const fixtures = {
  pipeline: {
    rows: [p],
    stages: stages.map((name) => ({ name })),
    search: "",
    opportunity,
    today: true,
  },
  "prospect-form": {
    fields,
    frequencies,
    services,
    stages: stages.map((name) => ({ name })),
    owners: [{ email: "alanna@theitguys.us" }],
  },
  prospect: {
    activities: [],
    outcomes,
    requests: [],
    notifications: [],
    json: JSON.parse,
  },
  weekly: {
    week: "2026-09-21",
    metrics: {
      calls: 1,
      conversations: 1,
      qualified: 0,
      proposals: 0,
      recurring: 0,
      hourly: 0,
    },
    historical: null,
    weeklyHeaders,
  },
  import: {
    preview: null,
    headers: { pipeline: fields.map((x) => x[1]), weekly: weeklyHeaders },
  },
  quotes: {
    quotes: [],
    selected: null,
    input,
    calculation,
    platforms,
    oneOffItems,
    stops: [],
  },
  "quote-print": {
    q: { id: 1, status: "Draft", total: calculation.total },
    inputs: input,
    lines: calculation.lines,
  },
  handoff: {
    clientRecord: null,
    client: null,
    error: null,
    schema: { errors: ["Not configured"] },
    missing: ["Company & contact"],
    approved: false,
    ready: false,
    requests: [],
    json: JSON.parse,
    plainResult,
    lanes,
  },
  admin: {
    prices: [],
    stages: [],
    stops: [],
    allowlist: [],
    logs: [],
    schema: { errors: [] },
  },
  error: { message: "Try again" },
};
for (const [view, data] of Object.entries(fixtures))
  test(`${view} renders`, async () => {
    const html = await ejs.renderFile(`views/${view}.ejs`, {
      ...common,
      ...data,
    });
    assert.ok(html.includes("DRYRUN"));
    assert.ok(!html.includes("<script>alert(1)</script>"));
  });
