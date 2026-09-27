import { parse } from "csv-parse/sync";
import { choice, fail, text, integer, date } from "./security.js";
import { stages, lanes } from "./config.js";
export const pipelineFields = [
  ["business_name", "Business Name"],
  ["contact_name", "Contact Name"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["first_contact", "Date First Contacted"],
  ["employee_count", "Employee Count"],
  ["current_it", "Current IT Situation"],
  ["key_dependency", "Key Dependency (QuickBooks/etc.)"],
  ["call_frequency", "Call Frequency Signal"],
  ["likely_tier", "Likely Tier"],
  ["red_flag", "Red Flag (existing MSP?)"],
  ["stage", "Stage"],
  ["follow_up", "Follow-Up Date"],
  ["notes", "Notes"],
];
export const weeklyHeaders = [
  "Week Of",
  "Calls Made",
  "Conversations Had",
  "Qualified Opportunities",
  "Proposals Sent",
  "Recurring Contracts Signed",
  "Hourly/Project Jobs Picked Up",
  "Notes",
];
export const trackerHeaders = {
  pipeline: pipelineFields.map(([, label]) => label),
  weekly: weeklyHeaders,
};
export function resolveLegacyStage(row, lane) {
  if (row.stage !== "Technical Assessment") return { ...row };
  choice(lane, lanes);
  return {
    ...row,
    service_lane: lane,
    stage:
      lane === "Business IT Integration" ? "Discovery" : "Technical Assessment",
  };
}
export function parseTracker(kind, content) {
  choice(kind, ["pipeline", "weekly", "legend"]);
  if (kind === "legend") return { kind, data: [], skipped: 0, ignored: true };
  let rows;
  try {
    rows = parse(text(content, 1500000), { bom: true, skip_empty_lines: true });
  } catch (e) {
    if (e.status) throw e;
    fail("Invalid CSV. Check quoting and column counts.");
  }
  const expected = trackerHeaders[kind];
  if (JSON.stringify(rows[0]) !== JSON.stringify(expected))
    fail("CSV headers must exactly match the Call Tracker v2 template.");
  if (rows.length > 2001) fail("Import at most 2,000 rows.");
  const data = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    if (row.length !== expected.length)
      fail("CSV row width does not match the template.");
    if (kind === "pipeline") {
      if (
        row[0].trim().toLowerCase() === "golden triangle orthodontics" &&
        row[1].trim().toLowerCase() === "dr. sarah lee"
      ) {
        skipped++;
        continue;
      }
      const prospect = Object.fromEntries(
        pipelineFields.map(([key], i) => [key, row[i]]),
      );
      prospect.stage = prospect.stage.trim() || "Prospecting";
      choice(prospect.stage, stages);
      data.push({ ...prospect, owner: "alanna@theitguys.us" });
    } else {
      const week = date(row[0]);
      if (!week || new Date(week + "T12:00:00Z").getUTCDay() !== 1)
        fail("Week Of must be a Monday in YYYY-MM-DD format.");
      if (data.some((existing) => existing[0] === week))
        fail("Duplicate Week Of in this CSV. Keep one row per week.");
      data.push([
        week,
        ...row.slice(1, 7).map((v) => integer(v)),
        text(row[7], 10000),
      ]);
    }
  }
  return { kind, data, skipped, ignored: false };
}
