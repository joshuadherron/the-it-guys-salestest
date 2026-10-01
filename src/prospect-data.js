import { choice, date, fail, integer } from "./security.js";
import { services } from "./config.js";
export const locationFields = [
  ["street_address", "Address"],
  ["zip", "ZIP"],
  ["city", "City"],
  ["state", "State"],
];
export const structuredFields = [
  ["icp", "ICP"],
  ["next_action", "Next action"],
  ["next_action_date", "Next action date"],
  ["next_action_time", "Next action time"],
  ["next_action_method", "Next action method"],
  ["meeting_date", "Meeting date"],
  ["meeting_time", "Meeting time"],
  ["meeting_type", "Meeting type"],
  ["meeting_location", "Meeting location"],
  ["meeting_duration", "Meeting duration"],
  ["teams_scheduled", "Teams scheduled"],
  ["teams_join_url", "Teams join URL"],
  ["est_monthly_revenue", "Estimated monthly revenue (source value)"],
  ["josh_needed", "Josh needed"],
  ["status", "Status"],
];
export const statusChoices = ["Active", "Nurture", "Lost"];
export const blank = (value) =>
  value === null || value === undefined || value === "";
export function service(value) {
  return blank(value) ? null : choice(value, services);
}
export function sourceText(value, max = 10000) {
  if (blank(value)) return "";
  if (typeof value !== "string" || value.length > max)
    fail("Invalid text value.");
  return value;
}
export function optionalBoolean(value) {
  if (blank(value)) return null;
  if (value === true || value === 1 || value === "1" || value === "true")
    return true;
  if (value === false || value === 0 || value === "0" || value === "false")
    return false;
  fail("Use true, false, 1 or 0 for boolean fields.");
}
export function optionalTime(value) {
  if (blank(value)) return null;
  if (
    typeof value !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
  )
    fail("Use HH:mm or HH:mm:ss for times.");
  return value;
}
export function optionalNumber(value) {
  return blank(value) ? null : integer(value);
}
export function optionalRevenue(value) {
  if (blank(value)) return null;
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(String(value)))
    fail(
      "Invalid estimated monthly revenue. Use a nonnegative amount with at most two decimals.",
    );
  return Number(value).toFixed(2);
}
export function validateLocation(body) {
  const result = {
    street_address: blank(body.street_address)
      ? null
      : sourceText(body.street_address, 500),
    city: blank(body.city) ? null : sourceText(body.city, 500),
    state: blank(body.state) ? null : sourceText(body.state, 80),
    zip: blank(body.zip) ? null : sourceText(String(body.zip).trim(), 10),
  };
  if (result.zip && !/^\d{5}(?:-\d{4})?$/.test(result.zip))
    fail("ZIP must be 5 digits or ZIP+4.");
  if (result.state && /^[A-Za-z]{2}$/.test(result.state))
    result.state = result.state.toUpperCase();
  return result;
}
export function validateStructured(body) {
  const result = {};
  const limits = {
    icp: 80,
    next_action: 10000,
    next_action_method: 255,
    meeting_type: 255,
    meeting_location: 1000,
    teams_join_url: 2048,
  };
  for (const [key, max] of Object.entries(limits))
    result[key] = blank(body[key]) ? null : sourceText(body[key], max);
  for (const key of ["next_action_date", "meeting_date"])
    result[key] = date(body[key]);
  for (const key of ["next_action_time", "meeting_time"])
    result[key] = optionalTime(body[key]);
  for (const key of ["teams_scheduled", "josh_needed"])
    result[key] = optionalBoolean(body[key]);
  result.meeting_duration = optionalNumber(body.meeting_duration);
  result.est_monthly_revenue = optionalRevenue(body.est_monthly_revenue);
  result.status = blank(body.status)
    ? null
    : choice(body.status, statusChoices);
  if (result.teams_join_url) {
    let url;
    try {
      url = new URL(result.teams_join_url);
    } catch {
      fail("Invalid Teams join URL.");
    }
    if (!["https:", "http:"].includes(url.protocol))
      fail("Teams join URL must use HTTP or HTTPS.");
  }
  return result;
}
