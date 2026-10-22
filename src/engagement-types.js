import { choice } from "./security.js";
export const engagementTypes = Object.freeze({managed_it:"Managed IT",bii:"BII / Standardization",project:"One-Time Project",hourly:"Hourly / Break-Fix"});
export const genericEngagement = p => ["project","hourly"].includes(p?.engagement_type);
export const engagementType = value => choice(value || "bii",Object.keys(engagementTypes));
export const projectLane = "Project-Based";
export const genericPricing = input => ["project_v1","hourly_v1"].includes(input?.pricingMode);
export function intakeLink(p) { return `/prospects/${p.id}/${genericEngagement(p)?"intake":"discovery/resume"}`; }
