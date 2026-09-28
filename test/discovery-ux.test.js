import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { inferredState } from "../public/discovery-state.js";
import { requiredProgress, sectionFor } from "../src/discovery-ui.js";
import { schema, emptyAnswers, mvd, groups } from "../src/discovery-rules.js";
import { validateAnswer } from "../src/discovery-validation.js";

for (const [type, value, empty] of [
  ["text", "Example", ""],
  ["number", "0", ""],
  ["date", "2026-09-27", ""],
  ["select", "Yes", ""],
  ["multi", ["A"], []],
  ["billing", { same: true }, { same: false, answer: "" }],
  ["volume", { amount: "0", unit: "GB" }, { amount: "", unit: "GB" }],
  ["apps", { none: true, entries: [] }, { none: false, entries: [] }],
  [
    "matrix",
    { domain: { state: "not_sure" } },
    { domain: { state: "not_discussed" } },
  ],
])
  test(`${type} answers automatically and clears without losing explicit states`, () => {
    assert.equal(inferredState(type, value), "answered");
    assert.equal(inferredState(type, empty), "not_discussed");
    assert.equal(inferredState(type, empty, "not_sure"), "not_sure");
  });

test("required progress uses the existing MVD requirements and phone/email alternative", () => {
  const a = emptyAnswers();
  assert.equal(requiredProgress(a).complete, 0);
  for (const [, ids] of groups)
    for (const id of ids) a[id] = { state: "not_sure", value: null };
  a["Q1.3"] = { state: "not_sure", value: null };
  assert.deepEqual(mvd(a), []);
  assert.equal(requiredProgress(a).complete, requiredProgress(a).total);
  const before = requiredProgress(a);
  a["Q1.4"] = { state: "not_sure", value: null };
  assert.deepEqual(requiredProgress(a), before);
  for (const [, ids] of groups)
    for (const id of ids) {
      const missing = { ...a, [id]: { state: "not_discussed", value: null } };
      assert.ok(mvd(missing).length);
      assert.equal(requiredProgress(missing).complete, before.total - 1);
    }
  assert.deepEqual(new Set(schema.map(sectionFor)), new Set([1, 2, 3]));
});

// Execute the actual browser controller with a small DOM/HTTP harness.
async function browser(
  saved = emptyAnswers(),
  startingRevision = 0,
  conflict = false,
) {
  const listeners = {},
    docEvents = {},
    nodes = {};
  const state = { value: saved["Q1.1"].state };
  const input = { value: saved["Q1.1"].value || "", matches: () => false };
  const questionStatus = {};
  const q = {
    dataset: { question: "Q1.1", type: "text" },
    querySelector: (s) =>
      ({
        ".answer-state": state,
        ".answer-value": input,
        ".question-status": questionStatus,
      })[s],
    querySelectorAll: (s) => (s.includes("input") ? [input] : []),
    addEventListener: (event, handler) => {
      listeners[event] = handler;
    },
  };
  const discovery = {
    dataset: { id: "1", revision: startingRevision },
    querySelectorAll: () => [q],
  };
  for (const id of [
    "#save-status",
    "#required-progress",
    "#urgent-guidance",
    "#missing-groups",
  ])
    nodes[id] = { replaceChildren() {}, append() {} };
  nodes["#discovery"] = discovery;
  nodes['meta[name="csrf-token"]'] = { content: "csrf" };
  const requests = [],
    location = {};
  let revision = startingRevision;
  const context = vm.createContext({
    inferredState,
    setTimeout,
    clearTimeout,
    location,
    document: {
      querySelector: (s) => nodes[s],
      addEventListener: (e, f) => {
        docEvents[e] = f;
      },
      createElement: () => ({}),
    },
    window: { addEventListener() {} },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (conflict)
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: "Reload before continuing." }),
        };
      assert.equal(body.revision, revision);
      saved[body.question] = validateAnswer(body.question, body.answer);
      revision++;
      return {
        ok: true,
        json: async () => ({
          revision,
          hold: false,
          missing: mvd(saved),
          progress: requiredProgress(saved),
        }),
      };
    },
  });
  vm.runInContext(
    readFileSync("public/app.js", "utf8").replace(/^import .*;\r?\n/, ""),
    context,
  );
  return {
    state,
    input,
    requests,
    saved,
    listeners,
    location,
    async navigate() {
      await docEvents.click({
        target: { closest: () => ({ href: "/prospects/1/discovery/2" }) },
        preventDefault() {},
      });
    },
  };
}

test("typing flushes autosave before section navigation, preserves revision and survives reload", async () => {
  const b = await browser();
  b.input.value = "Example Business";
  b.listeners.input({ target: { matches: () => true } });
  await b.navigate();
  assert.equal(b.location.href, "/prospects/1/discovery/2");
  assert.equal(b.requests[0].answer.state, "answered");
  const loaded = await browser(b.saved, 1);
  assert.equal(loaded.input.value, "Example Business");
  loaded.input.value = "";
  loaded.listeners.change({ target: { matches: () => false } });
  await loaded.navigate();
  assert.equal(loaded.requests[0].revision, 1);
  assert.equal(loaded.saved["Q1.1"].state, "not_discussed");
  loaded.state.value = "not_sure";
  loaded.listeners.change({ target: { matches: () => true } });
  await loaded.navigate();
  assert.equal(loaded.saved["Q1.1"].state, "not_sure");
});

test("revision conflicts block navigation and subsequent queued saves", async () => {
  const b = await browser(emptyAnswers(), 0, true);
  b.input.value = "First";
  b.listeners.change({ target: { matches: () => false } });
  b.input.value = "Second";
  b.listeners.change({ target: { matches: () => false } });
  await b.navigate();
  assert.equal(b.location.href, undefined);
  assert.equal(b.requests.length, 1);
  assert.equal(b.saved["Q1.1"].state, "not_discussed");
});

test("invalid answers remain unsaved and block section navigation", async () => {
  const b = await browser();
  b.input.value = "x".repeat(10001);
  b.listeners.change({ target: { matches: () => false } });
  await b.navigate();
  assert.equal(b.location.href, undefined);
  assert.equal(b.saved["Q1.1"].state, "not_discussed");
});
