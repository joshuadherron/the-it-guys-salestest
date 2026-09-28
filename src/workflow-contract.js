import { choice, text, fail } from "./security.js";

export const lostReasons = [
  "Price",
  "Chose another provider",
  "Staying with current IT",
  "No decision / went dark",
  "Not a fit (disqualified)",
  "Timing (revisit later)",
  "Other",
];
const salesStages = [
  "Sales Discovery",
  "Technical Assessment",
  "Risk Review",
  "Quoting",
  "Contracting",
];
export const canMarkLost = (stage) => salesStages.includes(stage);
export const nameMessage = `Business name can't contain " * : < > ? / \\ | # % or start/end with a period, because it becomes the SharePoint folder name. Example: use 'A-C Pros', not 'A/C Pros'.`;
export function businessNameError(name) {
  return !name?.trim() ||
    /["*:<>?/\\|#%]/.test(name) ||
    name.startsWith(".") ||
    name.endsWith(".")
    ? nameMessage
    : null;
}
export function validateBusinessName(name) {
  const error = businessNameError(name);
  if (error) fail(error);
}
export function guardPipelineEdit(previous, next) {
  if (
    previous.client_id &&
    next.stage === "Closed Lost" &&
    previous.stage !== "Closed Lost"
  )
    fail(
      "This prospect has a SharePoint client. Use Mark Lost on the handoff page so SharePoint closes it too.",
    );
  validateBusinessName(next.business_name);
}
export function lostPayload(p, { reason, notes = "", expectedStage } = {}) {
  if (!p.client_id) fail("Create the SharePoint client first.");
  if (!canMarkLost(expectedStage))
    fail(
      "Mark Lost is available only before Client Activation. Signed clients must use Start Offboarding in SharePoint.",
    );
  return {
    clientId: p.client_id,
    reason: choice(reason, lostReasons),
    notes: text(notes, 500),
    expectedStage,
  };
}
export function serializePayload(body) {
  const serialized = JSON.stringify(body);
  if (serialized.length > 60000)
    fail(
      "The SharePoint payload exceeds 60,000 characters. Shorten the discovery before creating the client; nothing was truncated or sent.",
    );
  return serialized;
}
