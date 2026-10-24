import { fail, text } from "./security.js";
export const isExisting = (p) => p.relationship_type === "existing_client";
export const additionalFields = [
  ["service", "Service being considered"], ["reason", "Reason for request / why now"],
  ["decision_maker", "Decision maker or approver"], ["timeframe", "Desired timeframe"],
  ["changes", "Material changes since the prior engagement"],
  ["users_devices", "Approximate affected users/devices"], ["locations", "New locations"],
  ["infrastructure", "Major infrastructure changes"],
  ["concerns", "Relevant business/security concerns"], ["notes", "Notes"],
];
export function additionalAnswers(input, complete) {
  const result = Object.fromEntries(additionalFields.map(([k]) => [k, text(input[k] || "", 5000)]));
  if (complete && ["service", "reason", "decision_maker", "timeframe"].some(k => !result[k]))
    fail("Complete service, reason, decision maker and timeframe before marking discovery complete.");
  return result;
}
export function clientSummary(row, schema) {
  if (!row) return null;
  return { itemId: String(row.id), ...Object.fromEntries(
    ["Title", "Client ID", "Current Stage", "Stage Status", "Service Lanes", "Next Action"]
      .map(k => [k, row.fields[schema.maps.clients[k].name] ?? ""])),
  };
}
export function selectClient(rows, id, schema) {
  const matches = rows.filter(r => r.fields[schema.maps.clients["Client ID"].name] === id);
  if (!id || matches.length !== 1) fail("Select a unique existing SharePoint Client. The client may be missing or ambiguous.");
  return clientSummary(matches[0], schema);
}
export const normalizedName = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
export function duplicateClients(p, rows, schema) {
  const name = normalizedName(p.business_name);
  return rows.map(r => clientSummary(r, schema)).filter(r => name && normalizedName(r.Title) === name);
}
export function assertExistingTransition(p, client, complete) {
  if (!isExisting(p) || !p.client_id || !client || client["Client ID"] !== p.client_id)
    fail("The linked SharePoint client is unavailable. Josh must resolve the existing-client link; no new client will be created.");
  if (!complete) fail("Complete Additional Service Discovery first.");
  const lanes = Array.isArray(client["Service Lanes"]) ? client["Service Lanes"] : [client["Service Lanes"]];
  if (p.service_lane !== "Managed IT" || !lanes.includes("Business IT Integration"))
    fail("This additional-service workflow is not supported yet. Only BII to Managed IT is currently supported.");
  if (lanes.includes("Managed IT")) fail("Managed IT is already active or in progress for this client.");
  if (client["Current Stage"] !== "Acceptance")
    fail("Managed IT transition requires the existing BII client to be at Acceptance.");
}
export async function lockClientRequests(p, run, c, quoteId) {
  if (!String(p.client_id||"").trim()) {
    const pending=await run("SELECT id FROM sp_requests WHERE prospect_id=? AND status IN ('Preparing','Pending','Processing','Unknown') FOR UPDATE",[p.id],c);
    if(pending.length)fail("A request for this opportunity is already active or needs reconciliation.");
    return;
  }
  await run("INSERT IGNORE INTO client_request_locks (client_id) VALUES (?)", [p.client_id], c);
  await run("SELECT client_id FROM client_request_locks WHERE client_id=? FOR UPDATE", [p.client_id], c);
  const operations = await run("SELECT client_id FROM quote_operation_locks WHERE client_id=? FOR UPDATE",[p.client_id],c);
  if(operations.length)fail("A quote fill/send is active or uncertain. Reconcile it before another workflow action.");
  const pending = await run("SELECT id,prospect_id,request_json FROM sp_requests WHERE prospect_id IN (SELECT id FROM prospects WHERE client_id=?) AND status IN ('Preparing','Pending','Processing','Unknown') FOR UPDATE", [p.client_id], c);
  if (pending.some(r=>!quoteId||String(r.prospect_id)===String(p.id)||requestMatchesQuote(r.request_json,p,quoteId))) fail("A request for this client is already active or needs reconciliation.");
}
import { requestMatchesQuote } from "./quote-request-scope.js";
