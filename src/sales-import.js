import { parse } from "csv-parse/sync";
import { choice, fail, text } from "./security.js";
import { lanes } from "./config.js";
import {
  parseTracker,
  trackerHeaders,
  resolveLegacyStage,
} from "./tracker-import.js";
import {
  optionalNumber,
  sourceText,
  validateStructured,
} from "./prospect-data.js";
export const liveFields = [
  ["businessName", "business_name"],
  ["contactName", "contact_name"],
  ["phone", "phone"],
  ["email", "email"],
  ["city", "city"],
  ["employeeCount", "employee_count"],
  ["currentIT", "current_it"],
  ["keyDependency", "key_dependency"],
  ["icp", "icp"],
  ["stage", "legacy_stage"],
  ["nextAction", "next_action"],
  ["nextActionDate", "next_action_date"],
  ["nextActionTime", "next_action_time"],
  ["nextActionMethod", "next_action_method"],
  ["meetingDate", "meeting_date"],
  ["meetingTime", "meeting_time"],
  ["meetingType", "meeting_type"],
  ["meetingLocation", "meeting_location"],
  ["meetingDuration", "meeting_duration"],
  ["teamsScheduled", "teams_scheduled"],
  ["teamsJoinUrl", "teams_join_url"],
  ["estMonthlyRevenue", "est_monthly_revenue"],
  ["joshNeeded", "josh_needed"],
  ["status", "status"],
  ["notes", "notes"],
];
export const liveHeaders = liveFields.map(([header]) => header);
export const importNames = {
  current_sales: "Current Sales App Export",
  pipeline: "Call Tracker v2 Pipeline",
  weekly: "Call Tracker v2 Weekly Tracker",
  legend: "Legend (ignored)",
};
export function readCsv(content) {
  try {
    return parse(text(content, 1500000), { bom: true, skip_empty_lines: true });
  } catch (e) {
    if (e.status) throw e;
    fail("Invalid CSV. Check quoting and column counts.");
  }
}
export function parseSalesExport(content) {
  const rows = readCsv(content);
  if (JSON.stringify(rows[0]) !== JSON.stringify(liveHeaders))
    fail("CSV headers must exactly match Current Sales App Export.");
  if (rows.length > 2001) fail("Import at most 2,000 rows.");
  const allowed = [
    "Prospecting",
    "Qualified",
    "Closed Lost",
    "Contacted",
    "Follow-Up",
    "Nurture",
    "Technical Discovery",
  ];
  const data = rows.slice(1).map((values, index) => {
    try {
      if (values.length !== liveHeaders.length)
        fail("CSV row width does not match the template.");
      const mapped = Object.fromEntries(
        liveFields.map(([, key], i) => [key, values[i]]),
      );
      choice(mapped.legacy_stage, allowed);
      const stage = ["Prospecting", "Qualified", "Closed Lost"].includes(
        mapped.legacy_stage,
      )
        ? mapped.legacy_stage
        : "Prospecting";
      return {
        ...mapped,
        ...validateStructured(mapped),
        business_name: sourceText(mapped.business_name, 255),
        employee_count: optionalNumber(mapped.employee_count),
        notes: sourceText(mapped.notes),
        stage,
        follow_up: mapped.next_action_date || null,
        first_contact: null,
        call_frequency: "",
        red_flag: "",
        likely_service: null,
        likely_tier: "",
        service_lane: null,
        owner: "alanna@theitguys.us",
        import_source: "current_sales",
      };
    } catch (e) {
      if (e.status) fail(`CSV data row ${index + 1}: ${e.message}`);
      throw e;
    }
  });
  return { kind: "current_sales", data, skipped: 0, ignored: false };
}
export function needsLane(row) {
  return (
    !row.service_lane &&
    (row.legacy_stage === "Technical Discovery" ||
      row.stage === "Technical Assessment")
  );
}
export function reviewLane(row, lane) {
  if (!needsLane(row)) return { ...row };
  choice(lane, lanes);
  if (row.legacy_stage === "Technical Discovery")
    return {
      ...row,
      service_lane: lane,
      stage:
        lane === "Business IT Integration"
          ? "Discovery"
          : "Technical Assessment",
    };
  return resolveLegacyStage(row, lane);
}
export function parseImport(kind, content) {
  choice(kind, ["auto", "current_sales", "pipeline", "weekly", "legend"]);
  if (kind === "legend") return parseTracker(kind, content);
  const header = readCsv(content)[0];
  const matches = (headers) =>
    JSON.stringify(header) === JSON.stringify(headers);
  // Recognize only an exact known header, even if the upload control defaults to Pipeline.
  if (matches(liveHeaders)) return parseSalesExport(content);
  if (kind === "current_sales")
    fail("CSV headers must exactly match Current Sales App Export.");
  if (kind === "auto") {
    kind = Object.keys(trackerHeaders).find((k) => matches(trackerHeaders[k]));
    if (!kind) fail("CSV headers do not match any supported exact schema.");
  }
  const preview = parseTracker(kind, content);
  if (kind === "pipeline")
    preview.data = preview.data.map((row) => ({
      ...row,
      legacy_stage: row.stage,
      import_source: "pipeline",
      likely_service: null,
    }));
  return preview;
}
