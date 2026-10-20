import { lanes } from "./config.js";
import { choice, fail, text } from "./security.js";
export const bothServices = "BII + Managed IT";

export function servicePlan(p) {
  let selected = p.planned_service_lanes;
  if (typeof selected === "string") selected = JSON.parse(selected);
  const services = Array.isArray(selected) && selected.length ? selected : p.service_lane ? [p.service_lane] : [];
  const startingLane = p.starting_service_lane || p.service_lane || "Business IT Integration";
  return { services, scope: services.length === 2 ? bothServices : services[0] || "", startingLane, reason: p.service_sequence_reason || "" };
}

export function validateServicePlan(body, user) {
  const scope = choice(body.service_scope || body.service_lane, [...lanes, bothServices]);
  if (scope !== bothServices) return { services: [scope], startingLane: scope, reason: "" };
  const startingLane = choice(body.starting_service_lane || "Business IT Integration", lanes);
  const reason = text(body.service_sequence_reason || "", 1000);
  if (startingLane === "Managed IT") {
    if (user.role !== "owner") fail("Josh must choose Managed IT first when both services are planned.", 403);
    if (reason.length < 10) fail("Explain why Managed IT must start before BII (at least 10 characters).");
  }
  return { services: [...lanes], startingLane, reason: startingLane === "Managed IT" ? reason : "" };
}

export function applyServicePlan(p, plan) {
  return { ...p, planned_service_lanes: JSON.stringify(plan.services), starting_service_lane: plan.startingLane, service_sequence_reason: plan.reason };
}
