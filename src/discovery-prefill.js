import { emptyAnswers } from "./discovery-rules.js";

const answered = (value) => ({ state: "answered", value });

function primaryLocation(p) {
  const parts = [
    p.street_address,
    [p.city, p.state].filter(Boolean).join(", "),
    p.zip,
  ].filter(Boolean);
  return parts.join(" ").trim();
}

export function prospectDiscoveryPrefill(p, answers = emptyAnswers()) {
  const result = structuredClone(answers);
  const set = (id, value) => {
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      result[id]?.state !== "not_discussed"
    )
      return;
    result[id] = answered(value);
  };

  set("Q1.1", p.business_name);
  set("Q1.2a", p.contact_name);
  set("Q1.3", p.phone);
  set("Q1.4", p.email);
  set("Q1.5", primaryLocation(p));

  if (p.employee_count !== null && p.employee_count !== undefined)
    set("Q2.1", Number(p.employee_count));

  const currentItChoices = [
    "An employee who also does other jobs",
    "A local IT company/MSP",
    "A break-fix provider",
    "Nobody in particular",
    "We handle it ourselves",
    "Other",
  ];
  if (currentItChoices.includes(p.current_it)) set("Q3.1", p.current_it);

  if (p.key_dependency) {
    set("Q5.1", {
      none: false,
      entries: [
        {
          name: p.key_dependency,
          use: "",
          hosting: "Not discussed",
        },
      ],
    });
  }

  return result;
}

export function prospectPrefillIds(p) {
  const seeded = prospectDiscoveryPrefill(p);
  return Object.entries(seeded)
    .filter(([, cell]) => cell.state === "answered")
    .map(([id]) => id);
}
