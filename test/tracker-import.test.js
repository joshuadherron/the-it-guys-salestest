import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import {
  parseTracker,
  resolveLegacyStage,
  pipelineFields,
  trackerHeaders,
} from "../src/tracker-import.js";
import { csv, pipelineRoutes } from "../src/pipeline.js";
const record = (overrides = {}) => {
  const values = {
    business_name: "Example Business",
    contact_name: "Example Contact",
    stage: "Prospecting",
    ...overrides,
  };
  return pipelineFields.map(([key]) => values[key] || "");
};
const input = (rows) => csv([trackerHeaders.pipeline, ...rows]);
test("v2 Pipeline matches all 14 exact headers and defaults owner", () => {
  assert.equal(trackerHeaders.pipeline.length, 14);
  assert.equal(trackerHeaders.pipeline[7], "Key Dependency (QuickBooks/etc.)");
  assert.equal(trackerHeaders.pipeline.at(-1), "Notes");
  const result = parseTracker(
    "pipeline",
    input([
      record({ key_dependency: "QuickBooks", notes: "Called, left message" }),
    ]),
  );
  assert.equal(result.data[0].owner, "alanna@theitguys.us");
  assert.equal(result.data[0].key_dependency, "QuickBooks");
  assert.equal(result.data[0].notes, "Called, left message");
  assert.throws(
    () =>
      parseTracker(
        "pipeline",
        csv([
          [...trackerHeaders.pipeline, "Owner"],
          [...record(), "alanna@theitguys.us"],
        ]),
      ),
    /headers/,
  );
});
test("skip only the fictional business/contact pair, before validation", () => {
  const result = parseTracker(
    "pipeline",
    input([
      record({
        business_name: "Golden Triangle Orthodontics",
        contact_name: "Dr. Sarah Lee",
        stage: "sample only",
      }),
      record({
        business_name: "Golden Triangle Orthodontics",
        contact_name: "Someone else",
      }),
      record({
        business_name: "Another business",
        contact_name: "Dr. Sarah Lee",
      }),
    ]),
  );
  assert.equal(result.skipped, 1);
  assert.equal(result.data.length, 2);
});
test("Technical Assessment mapping requires explicit lane, preserving other values", () => {
  const row = parseTracker(
    "pipeline",
    input([record({ stage: "Technical Assessment", likely_tier: "BII only" })]),
  ).data[0];
  assert.equal(row.stage, "Technical Assessment");
  assert.equal(row.service_lane, undefined);
  assert.throws(() => resolveLegacyStage(row, undefined), /valid option/);
  const bii = resolveLegacyStage(row, "Business IT Integration");
  assert.equal(bii.stage, "Discovery");
  assert.equal(bii.service_lane, "Business IT Integration");
  assert.equal(bii.likely_tier, "BII only");
  const managed = resolveLegacyStage(row, "Managed IT");
  assert.equal(managed.stage, "Technical Assessment");
  assert.equal(managed.service_lane, "Managed IT");
  assert.equal(row.stage, "Technical Assessment");
  for (const stage of [
    "Prospecting",
    "Qualified",
    "Discovery",
    "Proposal Sent",
    "Closed Won",
    "Closed Lost",
  ])
    assert.equal(
      resolveLegacyStage({ ...row, stage }, "Business IT Integration").stage,
      stage,
    );
  assert.throws(
    () => parseTracker("pipeline", input([record({ stage: "Invented" })])),
    /valid option/,
  );
});
test("Weekly v2 retains Notes and Week Of, rejects duplicate weeks", () => {
  assert.deepEqual(trackerHeaders.weekly, [
    "Week Of",
    "Calls Made",
    "Conversations Had",
    "Qualified Opportunities",
    "Proposals Sent",
    "Recurring Contracts Signed",
    "Hourly/Project Jobs Picked Up",
    "Notes",
  ]);
  const row = [
    "2026-09-21",
    10,
    4,
    2,
    1,
    0,
    1,
    "First line, with comma\nSecond line",
  ];
  const parsed = parseTracker("weekly", csv([trackerHeaders.weekly, row]));
  assert.deepEqual(parsed.data[0], row);
  assert.throws(
    () => parseTracker("weekly", csv([trackerHeaders.weekly, row, row])),
    /Duplicate Week Of/,
  );
  assert.throws(
    () =>
      parseTracker(
        "weekly",
        csv([trackerHeaders.weekly, ["2026-09-22", 1, 1, 1, 1, 1, 1, ""]]),
      ),
    /Monday/,
  );
});
test("Legend is ignored without parsing or importing", () =>
  assert.deepEqual(parseTracker("legend", "not even CSV"), {
    kind: "legend",
    data: [],
    skipped: 0,
    ignored: true,
  }));
test("commit rejects unresolved lane before database access", async () => {
  const routes = [];
  const app = {
    get: () => {},
    post: (path, ...handlers) => routes.push({ path, handlers }),
  };
  pipelineRoutes(app);
  const commit = routes.find((r) => r.path === "/import/commit").handlers[0];
  await assert.rejects(
    commit(
      {
        session: {
          importPreview: parseTracker(
            "pipeline",
            input([record({ stage: "Technical Assessment" })]),
          ),
        },
      },
      {},
    ),
    /Choose BII or Managed IT/,
  );
});
test("lane-review preview renders choices and disables commit", async () => {
  const parsed = parseTracker(
    "pipeline",
    input([record({ stage: "Technical Assessment" })]),
  );
  const html = await ejs.renderFile("views/import.ejs", {
    user: { role: "owner" },
    mode: "dryrun",
    csrf: "token",
    headers: trackerHeaders,
    preview: {
      ...parsed,
      needsLanes: true,
      rows: [record({ stage: "Technical Assessment" })],
    },
  });
  assert.match(html, /Review mapped rows/);
  assert.match(html, /BII — map to Discovery/);
  assert.match(html, /button disabled>Commit/);
});
