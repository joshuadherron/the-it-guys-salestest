import { emptyAnswers } from "./discovery-rules.js";

const answered = (value) => ({ state: "answered", value });

export function primaryLocation(p) {
  const locality = [p.city, p.state].filter(Boolean).join(", ");
  return [p.street_address, locality, p.zip].filter(Boolean).join(" ").trim();
}

export function prospectDiscoveryPrefill(p, answers = emptyAnswers()) {
  const result = structuredClone(answers);
  const set = (id, value) => {
    if (value === null || value === undefined || value === "") return;
    result[id] = answered(value);
  };

  // These are the same facts already captured on the prospect record.
  // The prospect record is authoritative so Discovery never asks for them again.
  set("Q1.1", p.business_name);
  set("Q1.2a", p.contact_name);
  set("Q1.3", p.phone);
  set("Q1.4", p.email);
  set("Q1.5", primaryLocation(p));

  if (p.employee_count !== null && p.employee_count !== undefined)
    set("Q2.1", Number(p.employee_count));

  return result;
}

export const inheritedQuestionIds = [
  "Q1.1",
  "Q1.2a",
  "Q1.3",
  "Q1.4",
  "Q1.5",
  "Q2.1",
];

export function knownProspectFacts(p) {
  return [
    ["Business", p.business_name],
    ["Contact", p.contact_name],
    ["Phone", p.phone],
    ["Email", p.email],
    ["Primary location", primaryLocation(p)],
    [
      "Employees",
      p.employee_count === null || p.employee_count === undefined
        ? ""
        : String(p.employee_count),
    ],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");
}
