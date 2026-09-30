import schema from "./discovery-schema.json" with { type: "json" };
export { schema };
export const screens = [
  "Company & Contact",
  "People, Locations & Devices",
  "Current IT & Priorities",
  "Accounts, Email & Data",
  "Critical Applications",
  "Security & Network",
  "Regulatory & Timeline",
  "Decision & Interest",
  "Review & Send",
];
export const ownership = [
  "Business owns/controls it and has access",
  "Outside IT/vendor manages it, but the business retains access/control",
  "Outside party appears to control it, and the business may not have independent access",
  "We don't have our own domain",
];
export const emptyAnswers = () =>
  Object.fromEntries(
    schema.map((q) => [q.id, { state: "not_discussed", value: null }]),
  );
export const value = (answers, id) =>
  answers[id]?.state === "answered" ? answers[id].value : undefined;
export const unknown = (answers, id) => answers[id]?.state === "not_sure";
const base = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? v.answer : v;
export const answer = (a, id) => base(value(a, id));
export function flags(a) {
  const result = [];
  const add = (flag, condition, detail) => {
    if (condition) result.push({ code: flag, ...(detail ? { detail } : {}) });
  };
  const v = (id) => answer(a, id);
  const has = (id, option) => Array.isArray(v(id)) && v(id).includes(option);
  add(
    "FLAG-MULTI-LOCATION",
    v("Q2.4") === "Yes" && Number(value(a, "Q2.4")?.detail) > 1,
  );
  add("FLAG-CONTRACTORS", v("Q2.6") === "Yes");
  add(
    "FLAG-BYOD-MOBILE",
    v("Q2.7") === "Yes" &&
      ["phones", "both"].includes(value(a, "Q2.7")?.detail),
  );
  add(
    "FLAG-PERSONAL-COMPUTERS-BUSINESS",
    v("Q2.7") === "Yes" &&
      ["computers", "both"].includes(value(a, "Q2.7")?.detail),
  );
  add("FLAG-HARDWARE-REPLACEMENT", v("Q2.8") === "Yes");
  add("FLAG-SERVER-REPORTED", v("Q2.9") === "Yes");
  add(
    "FLAG-CURRENT-PROVIDER",
    ["A local IT company/MSP", "A break-fix provider"].includes(v("Q3.1")),
  );
  for (const [row, prefix] of [
    ["domain", "DOMAIN"],
    ["admin", "MS-ADMIN"],
  ]) {
    const cell = value(a, "Q4.1")?.[row];
    const val = cell?.state === "answered" ? cell.value : null;
    add(`FLAG-${prefix}-VENDOR-MANAGED`, val === ownership[1]);
    add(`FLAG-${prefix}-ACCESS-CONCERN`, val === ownership[2]);
    add(
      `FLAG-${prefix}-UNKNOWN`,
      unknown(a, "Q4.1") || cell?.state === "not_sure",
    );
    if (row === "domain") add("FLAG-DOMAIN-NO-DOMAIN", val === ownership[3]);
  }
  add(
    "FLAG-FORMER-VENDOR-ACCESS",
    has(
      "Q4.2",
      "A former employee or past IT provider might still have access to something",
    ),
  );
  add(
    "FLAG-PERSONAL-ACCOUNTS-BUSINESS",
    has(
      "Q4.2",
      "Company email or files are stored in someone's personal Gmail/Microsoft account",
    ),
  );
  add(
    "FLAG-SHARED-STORAGE",
    has("Q4.4", "A server") || has("Q4.4", "A NAS/shared drive"),
  );
  add("FLAG-DATA-SIZE-UNKNOWN", unknown(a, "Q4.5"));
  for (const app of value(a, "Q5.1")?.entries || [])
    add("FLAG-LOB-APP", Boolean(app.name), app.name);
  add(
    "FLAG-SHARED-PASSWORDS",
    v("Q6.2") === "Yes" || has("Q3.4", "Shared passwords"),
  );
  add("FLAG-BACKUP-UNKNOWN", v("Q4.7") === "No" || unknown(a, "Q4.7"));
  add(
    "FLAG-NETWORK-CONCERN",
    v("Q6.4") === "Yes" || v("Q6.5") === "No" || unknown(a, "Q6.5"),
  );
  add("FLAG-SECURITY-HISTORY", v("Q6.3a") === "Yes");
  add(
    "FLAG-HEALTH-DATA",
    has("Q7.1", "Patient/medical information"),
  );
  add(
    "FLAG-REGULATORY",
    [
      "Patient/medical information",
      "Government work or contracts",
      "Financial-services regulation",
      "Other named regulatory or contractual requirement",
    ].some((x) => has("Q7.1", x)),
  );
  add(
    "FLAG-SENSITIVE-DATA",
    has(
      "Q7.1",
      "Legal/privileged or other sensitive/confidential client data (no specific regulation, but sensitive)",
    ),
  );
  add(
    "FLAG-PAYMENT-CARDS-STANDARD",
    has("Q7.1", "We accept credit/debit card payments"),
  );
  add("FLAG-DEADLINE", v("Q7.3") === "Yes");
  add("FLAG-DOWNTIME-INTOLERANT", v("Q7.4") === "Little to none");
  add("URGENT SECURITY REVIEW", v("Q6.3b") === "Yes");
  return result;
}
export const groups = [
  ["Company & contact", ["Q1.1", "Q1.2a", "Q1.5"]],
  [
    "People, computers, integration users & locations",
    ["Q2.1", "Q2.2", "Q2.3", "Q2.4"],
  ],
  ["Reason for looking", ["Q3.3"]],
  ["Biggest problem", ["Q3.5"]],
  ["Current IT arrangement", ["Q3.1"]],
  ["Critical software", ["Q5.1"]],
  ["Desired timeframe", ["Q7.2"]],
  ["Project approver", ["Q8.1a"]],
];
export function discussed(a, id) {
  const cell = a[id];
  if (cell?.state === "not_sure") return true;
  if (cell?.state !== "answered") return false;
  const v = cell.value;
  if (id === "Q5.1")
    return (
      v?.none === true ||
      v?.entries?.some((e) => typeof e.name === "string" && e.name.trim())
    );
  return v !== null && v !== undefined && v !== "";
}
export function mvd(a) {
  return groups
    .filter(
      ([, ids], i) =>
        !ids.every((id) => discussed(a, id)) ||
        (i === 0 && !["Q1.3", "Q1.4"].some((id) => discussed(a, id))),
    )
    .map(([name]) => name);
}
export function holdTransition({ hold, before, after, action, note, role }) {
  if (action === "release") {
    if (role !== "owner" || !note?.trim())
      throw new Error("Owner and release note required.");
    return { hold: false, notify: false };
  }
  const newlyUrgent =
    answer(after, "Q6.3b") === "Yes" && answer(before, "Q6.3b") !== "Yes";
  return { hold: Boolean(hold || newlyUrgent), notify: newlyUrgent };
}
export const majorFlagOrder = [
  "URGENT SECURITY REVIEW",
  "FLAG-CURRENT-PROVIDER",
  "FLAG-DOMAIN-ACCESS-CONCERN",
  "FLAG-MS-ADMIN-ACCESS-CONCERN",
  "FLAG-MULTI-LOCATION",
  "FLAG-HEALTH-DATA",
  "FLAG-REGULATORY",
  "FLAG-SENSITIVE-DATA",
  "FLAG-SECURITY-HISTORY",
];
export function format(cell) {
  if (!cell || cell.state === "not_discussed") return "Not discussed";
  if (cell.state === "not_sure") return "Not sure";
  const v = cell.value;
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return v.join("; ");
  if (v.none) return "None that I can think of";
  if (v.same) return "same as approver";
  if (v.entries)
    return v.entries
      .map((e) => `${e.name} — ${e.use} (${e.hosting})`)
      .join("; ");
  if (v.domain)
    return `Business email domain: ${format(v.domain)}; Microsoft 365 / email admin account: ${format(v.admin)}`;
  if (v.amount !== undefined) return `${v.amount} ${v.unit}`;
  if (v.answer !== undefined)
    return `${v.answer}${v.detail !== "" && v.detail !== undefined ? " — " + v.detail : ""}`;
  return JSON.stringify(v);
}
