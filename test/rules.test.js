import test from "node:test";
import assert from "node:assert/strict";
import {
  flags,
  mvd,
  emptyAnswers,
  groups,
  holdTransition,
  ownership,
  schema,
} from "../src/discovery-rules.js";
import { validateAnswer } from "../src/discovery-validation.js";
import { priceQuote } from "../src/pricing.js";
import { prices } from "../src/config.js";
const cell = (value) => ({ state: "answered", value });
const unsure = { state: "not_sure", value: null };
const flagCases = [
  [
    "FLAG-MULTI-LOCATION",
    { "Q2.4": cell({ answer: "Yes", detail: 2 }) },
    { "Q2.4": cell({ answer: "Yes", detail: 1 }) },
  ],
  [
    "FLAG-CONTRACTORS",
    { "Q2.6": cell({ answer: "Yes", detail: 1 }) },
    { "Q2.6": cell({ answer: "No" }) },
  ],
  [
    "FLAG-BYOD-MOBILE",
    { "Q2.7": cell({ answer: "Yes", detail: "phones" }) },
    { "Q2.7": cell({ answer: "Yes", detail: "computers" }) },
  ],
  [
    "FLAG-PERSONAL-COMPUTERS-BUSINESS",
    { "Q2.7": cell({ answer: "Yes", detail: "computers" }) },
    { "Q2.7": cell({ answer: "Yes", detail: "phones" }) },
  ],
  [
    "FLAG-HARDWARE-REPLACEMENT",
    { "Q2.8": cell({ answer: "Yes", detail: 2 }) },
    { "Q2.8": cell({ answer: "No" }) },
  ],
  ["FLAG-SERVER-REPORTED", { "Q2.9": cell("Yes") }, { "Q2.9": unsure }],
  [
    "FLAG-CURRENT-PROVIDER",
    { "Q3.1": cell("A local IT company/MSP") },
    { "Q3.1": cell("We handle it ourselves") },
  ],
  ...["domain", "admin"].flatMap((row) => {
    const prefix = row === "domain" ? "DOMAIN" : "MS-ADMIN";
    return [
      [
        `FLAG-${prefix}-VENDOR-MANAGED`,
        { "Q4.1": cell({ [row]: cell(ownership[1]) }) },
        { "Q4.1": cell({ [row]: cell(ownership[0]) }) },
      ],
      [
        `FLAG-${prefix}-ACCESS-CONCERN`,
        { "Q4.1": cell({ [row]: cell(ownership[2]) }) },
        { "Q4.1": cell({ [row]: cell(ownership[1]) }) },
      ],
      [
        `FLAG-${prefix}-UNKNOWN`,
        { "Q4.1": cell({ [row]: unsure }) },
        { "Q4.1": cell({ [row]: cell(ownership[0]) }) },
      ],
    ];
  }),
  [
    "FLAG-DOMAIN-NO-DOMAIN",
    { "Q4.1": cell({ domain: cell(ownership[3]) }) },
    { "Q4.1": cell({ domain: cell(ownership[0]) }) },
  ],
  [
    "FLAG-FORMER-VENDOR-ACCESS",
    {
      "Q4.2": cell([
        "A former employee or past IT provider might still have access to something",
      ]),
    },
    { "Q4.2": cell(["Neither that I know of"]) },
  ],
  [
    "FLAG-PERSONAL-ACCOUNTS-BUSINESS",
    {
      "Q4.2": cell([
        "Company email or files are stored in someone's personal Gmail/Microsoft account",
      ]),
    },
    { "Q4.2": cell(["Neither that I know of"]) },
  ],
  [
    "FLAG-SHARED-STORAGE",
    { "Q4.4": cell(["A NAS/shared drive"]) },
    { "Q4.4": cell(["Microsoft OneDrive"]) },
  ],
  [
    "FLAG-DATA-SIZE-UNKNOWN",
    { "Q4.5": unsure },
    { "Q4.5": cell({ amount: 999, unit: "TB" }) },
  ],
  [
    "FLAG-LOB-APP",
    { "Q5.1": cell({ entries: [{ name: "QuickBooks" }] }) },
    { "Q5.1": cell({ none: true, entries: [] }) },
  ],
  ["FLAG-SHARED-PASSWORDS", { "Q6.2": cell("Yes") }, { "Q6.2": cell("No") }],
  [
    "FLAG-BACKUP-UNKNOWN",
    { "Q4.7": cell({ answer: "No" }) },
    { "Q4.7": cell({ answer: "Yes", detail: "Vendor" }) },
  ],
  [
    "FLAG-NETWORK-CONCERN",
    { "Q6.5": unsure },
    { "Q6.5": cell({ answer: "Yes", detail: "100 years old" }) },
  ],
  [
    "FLAG-SECURITY-HISTORY",
    { "Q6.3a": cell({ answer: "Yes", detail: "Reported" }) },
    { "Q6.3a": cell({ answer: "No" }) },
  ],
  [
    "FLAG-REGULATORY",
    { "Q7.1": cell(["Patient/medical information"]) },
    { "Q7.1": cell(["We accept credit/debit card payments"]) },
  ],
  [
    "FLAG-SENSITIVE-DATA",
    {
      "Q7.1": cell([
        "Legal/privileged or other sensitive/confidential client data (no specific regulation, but sensitive)",
      ]),
    },
    { "Q7.1": cell(["None that I know of"]) },
  ],
  [
    "FLAG-PAYMENT-CARDS-STANDARD",
    { "Q7.1": cell(["We accept credit/debit card payments"]) },
    { "Q7.1": cell(["None that I know of"]) },
  ],
  [
    "FLAG-DEADLINE",
    { "Q7.3": cell({ answer: "Yes", detail: "Move" }) },
    { "Q7.3": cell({ answer: "No" }) },
  ],
  [
    "FLAG-DOWNTIME-INTOLERANT",
    { "Q7.4": cell("Little to none") },
    { "Q7.4": cell("Some is fine") },
  ],
  [
    "URGENT SECURITY REVIEW",
    { "Q6.3b": cell({ answer: "Yes", detail: "" }) },
    { "Q6.3a": cell({ answer: "Yes", detail: "Past incident" }) },
  ],
];
for (const [code, yes, no] of flagCases) {
  test(`${code}: positive and negative`, () => {
    assert.ok(flags(yes).some((f) => f.code === code));
    assert.ok(!flags(no).some((f) => f.code === code));
    assert.ok(!flags(emptyAnswers()).some((f) => f.code === code));
  });
}
test("flag inventory contains every frozen flag; deleted flag absent", () => {
  assert.equal(new Set(flagCases.map((x) => x[0])).size, 29);
  assert.ok(!flagCases.some((x) => x[0] === "FLAG-PROFILE-MIGRATION-LIKELY"));
});
test("flags cover alternate triggers and combined categories", () => {
  const codes = flags({
    "Q2.7": cell({ answer: "Yes", detail: "both" }),
    "Q3.4": cell(["Shared passwords"]),
    "Q3.1": cell("A break-fix provider"),
    "Q4.4": cell(["A server"]),
    "Q4.7": unsure,
    "Q6.4": cell("Yes"),
    "Q7.1": cell([
      "Government work or contracts",
      "We accept credit/debit card payments",
    ]),
  }).map((x) => x.code);
  for (const f of [
    "FLAG-BYOD-MOBILE",
    "FLAG-PERSONAL-COMPUTERS-BUSINESS",
    "FLAG-CURRENT-PROVIDER",
    "FLAG-SHARED-PASSWORDS",
    "FLAG-SHARED-STORAGE",
    "FLAG-BACKUP-UNKNOWN",
    "FLAG-NETWORK-CONCERN",
    "FLAG-REGULATORY",
    "FLAG-PAYMENT-CARDS-STANDARD",
  ])
    assert.ok(codes.includes(f));
  assert.equal(
    flags({ "Q5.1": cell({ entries: [{ name: "A" }, { name: "B" }] }) }).length,
    2,
  );
  assert.ok(
    !flags({ "Q6.3b": unsure }).some(
      (x) => x.code === "URGENT SECURITY REVIEW",
    ),
  );
});
const complete = () => Object.fromEntries(schema.map((q) => [q.id, unsure]));
for (const [index, [name, ids]] of groups.entries())
  test(`MVD group ${index + 1}: ${name}`, () => {
    const a = complete();
    assert.deepEqual(mvd(a), []);
    a[ids[0]] = { state: "not_discussed", value: null };
    assert.ok(mvd(a).includes(name));
    a[ids[0]] = unsure;
    assert.deepEqual(mvd(a), []);
  });
test("owner v0.4 location correction and alternate contact", () => {
  const a = complete();
  a["Q1.5"] = { state: "not_discussed" };
  assert.deepEqual(mvd(a), ["Company & contact"]);
  a["Q1.5"] = unsure;
  a["Q1.3"] = { state: "not_discussed" };
  assert.deepEqual(mvd(a), []);
  a["Q1.4"] = { state: "not_discussed" };
  assert.deepEqual(mvd(a), ["Company & contact"]);
});
test("critical software none or entry; blank and not discussed fail", () => {
  const a = complete();
  a["Q5.1"] = cell({ none: true });
  assert.deepEqual(mvd(a), []);
  a["Q5.1"] = cell({ entries: [{ name: "App" }] });
  assert.deepEqual(mvd(a), []);
  a["Q5.1"] = cell({ entries: [] });
  assert.ok(mvd(a).includes("Critical software"));
});
test("urgent hold persists, alerts once, owner release with note", () => {
  const urgent = { "Q6.3b": cell({ answer: "Yes", detail: "" }) };
  assert.deepEqual(holdTransition({ hold: false, before: {}, after: urgent }), {
    hold: true,
    notify: true,
  });
  assert.deepEqual(
    holdTransition({ hold: true, before: urgent, after: urgent }),
    { hold: true, notify: false },
  );
  assert.deepEqual(holdTransition({ hold: true, before: urgent, after: {} }), {
    hold: true,
    notify: false,
  });
  assert.deepEqual(
    holdTransition({ action: "release", role: "owner", note: "Reviewed" }),
    { hold: false, notify: false },
  );
  assert.throws(() =>
    holdTransition({ action: "release", role: "sales", note: "Reviewed" }),
  );
  assert.throws(() =>
    holdTransition({ action: "release", role: "owner", note: " " }),
  );
  assert.deepEqual(
    holdTransition({ hold: false, before: urgent, after: urgent }),
    { hold: false, notify: false },
  );
});
test("validation preserves states, rejects unknown options and invalid counts", () => {
  assert.deepEqual(validateAnswer("Q1.1", unsure), unsure);
  assert.throws(() => validateAnswer("Q2.1", cell(-1)));
  assert.throws(() => validateAnswer("Q3.1", cell("invented")));
  assert.throws(() => validateAnswer("Q999", unsure));
  assert.equal(
    validateAnswer("Q6.3b", cell({ answer: "Yes", detail: "" })).value.answer,
    "Yes",
  );
});
test("pricing worked example $4,585; platform equivalence and phones excluded", () => {
  const result = priceQuote(
    {
      users: 7,
      windows: 6,
      mac: 1,
      ios: 1,
      mailboxes: 6,
      phones: 2,
      locations: 1,
    },
    prices,
  );
  assert.equal(result.total, 4585);
  assert.equal(result.devices, 8);
  assert.equal(
    priceQuote(
      { users: 7, android: 8, mailboxes: 6, phones: 99999, locations: 1 },
      prices,
    ).total,
    4585,
  );
});
test("pricing included amounts, zero devices, many devices, Dell labor", () => {
  for (const n of [0, 1, 5])
    assert.equal(
      priceQuote(
        { users: n, windows: n, mailboxes: n, phones: 200, locations: 1 },
        prices,
      ).total,
      3750,
    );
  assert.equal(priceQuote({ windows: 1000 }, prices).total, 3750 + 995 * 185);
  assert.equal(priceQuote({ dell: 2 }, prices).total, 4270);
  assert.throws(() => priceQuote({ windows: -1 }, prices));
  assert.throws(() => priceQuote({}, {}));
});
test("mirrored additional locations use 30 percent of applicable repeatable labor base", () => {
  const input = {
    locations: 2,
    locationLaborBase: null,
    oneOff: { "Complex migration": { selected: true, amount: null } },
  };
  const pending = priceQuote(input, prices);
  assert.deepEqual(pending.pending, [
    "Complex migration",
    "Additional locations — repeatable implementation labor base",
  ]);
  assert.equal(pending.total, 3750);

  input.locationLaborBase = 1000;
  input.oneOff["Complex migration"].amount = 250;
  const result = priceQuote(input, prices);
  assert.equal(result.total, 4300);
  assert.ok(
    result.lines.some(
      (line) =>
        line.label.includes("Additional mirrored location fee") &&
        line.amount === 300,
    ),
  );

  assert.equal(
    priceQuote({ locations: 1, locationLaborBase: 1000 }, prices).total,
    3750,
  );
});
