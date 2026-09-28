import { choice, date, integer, text, fail } from "./security.js";

export const outcomeFlags = [
  "Material findings",
  "Risk Acknowledgment required",
  "Data Migration Preflight required",
  "Network Integration referral",
  "Advanced Technology Assessment required",
  "Quote-ready",
  "Not quote-ready",
  "Separate project required",
  "Client Service Schedule required",
];
export const actionTypes = {
  ItemCompleted: "Item Completed",
  NotRequired: "Item Completed",
  RequestException: "Request Exception",
  CreateWorkingCopy: "Create Working Copy",
  AdvanceStage: "Advance Stage",
  StartStage: "Start Stage",
};
export const workColumns = [
  "TIG_ClientID",
  "TIG_WorkflowID",
  "TIG_WorkflowStage",
  "TIG_ServiceLaneSingle",
  "TIG_CompletionStatus",
  "TIG_DueDate",
  "TIG_AssignedTo",
  "TIG_Blocking",
  "TIG_SignatureRequired",
  "TIG_SignatureStatus",
  "TIG_SigningPDF",
  "TIG_SignedCopy",
  "TIG_ExceptionStatus",
  "TIG_OutcomeFlags",
  "TIG_FinalDisposition",
  "TIG_MSPManagerTicket",
  "TIG_SourceDocumentKey",
  "Title",
];
export const definitionColumns = [
  "Title",
  "TIG_RequiredDocument",
  "TIG_ServiceLaneSingle",
  "TIG_WorkflowStage",
  "TIG_TriggerMode",
  "TIG_TriggerFlag",
  "TIG_CreateClientCopy",
  "TIG_Active",
];
export const yes = (value) =>
  value === true || value === 1 || value === "Yes" || value === "true";
export const openItem = (item) =>
  !["Complete", "Not Required", "Cancelled"].includes(item.status);
export const unsigned = (item) =>
  item.signatureRequired && item.signatureStatus !== "Signed";
export const mayComplete = (item, user) =>
  openItem(item) &&
  !unsigned(item) &&
  (user.role === "owner" ||
    (user.role === "sales" &&
      user.email === "alanna@theitguys.us" &&
      item.assigneeEmail === "alanna@theitguys.us"));
export function safeLink(value) {
  const link = typeof value === "object" ? value?.Url || value?.url : value;
  return typeof link === "string" && /^https:\/\//i.test(link) ? link : null;
}
export function columnErrors(columns, required, label) {
  return required
    .filter((name) => columns.filter((c) => c.name === name).length !== 1)
    .map(
      (name) =>
        `${label}: required internal column ${name} is missing or ambiguous.`,
    );
}
export function definitionsFor(definitions, lanes) {
  return definitions.filter((d) => d.active && lanes.includes(d.lane));
}
export function availableFlags(definitions, lanes) {
  return definitionsFor(definitions, lanes).filter(
    (d) =>
      d.triggerMode === "Outcome flag" && outcomeFlags.includes(d.triggerFlag),
  );
}
export function normalizeDefinition(row) {
  const f = row.fields;
  return {
    id: f.Title,
    document: f.TIG_RequiredDocument,
    lane: f.TIG_ServiceLaneSingle,
    stage: f.TIG_WorkflowStage,
    triggerMode: f.TIG_TriggerMode,
    triggerFlag: f.TIG_TriggerFlag,
    createCopy: yes(f.TIG_CreateClientCopy),
    active: yes(f.TIG_Active),
  };
}
export function normalizeItem(
  row,
  definitions,
  assignee,
  signatureSentColumn = null,
) {
  const f = row.fields;
  const definition = definitions.find(
    (d) => d.id === f.TIG_WorkflowID && d.lane === f.TIG_ServiceLaneSingle,
  );
  return {
    id: String(row.id),
    clientId: f.TIG_ClientID,
    workflowId: f.TIG_WorkflowID,
    document:
      definition?.document ||
      row.driveItem?.name ||
      f.Title ||
      "Untitled document",
    stage: f.TIG_WorkflowStage,
    lane: f.TIG_ServiceLaneSingle,
    status: f.TIG_CompletionStatus || "",
    dueDate: f.TIG_DueDate || null,
    assigneeEmail: assignee?.email || null,
    assignee: assignee?.name || assignee?.email || "Assigned (unknown)",
    blocking: yes(f.TIG_Blocking),
    signatureRequired: yes(f.TIG_SignatureRequired),
    signatureStatus: f.TIG_SignatureStatus || "Preparing",
    sentAt:
      signatureSentColumn && f[signatureSentColumn]
        ? String(f[signatureSentColumn]).slice(0, 10)
        : null,
    signedAt: f.TIG_SignedDate ? String(f.TIG_SignedDate).slice(0, 10) : null,
    signingPdf: safeLink(f.TIG_SigningPDF),
    signedCopy: safeLink(f.TIG_SignedCopy),
    exceptionStatus: f.TIG_ExceptionStatus || "",
    ticket: f.TIG_MSPManagerTicket,
    url: safeLink(row.driveItem?.webUrl),
    outcomeFlags: f.TIG_OutcomeFlags,
    finalDisposition: f.TIG_FinalDisposition,
    sourceDocumentKey: f.TIG_SourceDocumentKey,
  };
}
export function workPayload(action, p, lane, options) {
  if (!p.client_id) fail("Create the SharePoint client first.");
  if (["ItemCompleted", "NotRequired", "RequestException"].includes(action)) {
    const itemId = integer(options.itemId, 2147483647);
    if (!itemId) fail("Select a work item.");
    if (action === "NotRequired")
      return { itemId, completionStatus: "Not Required" };
    if (action === "RequestException") {
      const reason = text(options.reason || "", 5000),
        reference = text(options.reference || "", 1000);
      if (reason.length < 10 || !reference)
        fail(
          "Exception reason needs at least 10 characters and an approval reference is required.",
        );
      return { itemId, reason, reference };
    }
    const flags = options.outcomeFlags ?? [];
    if (!Array.isArray(flags)) fail("Select valid outcome flags.");
    return {
      itemId,
      completionStatus: "Complete",
      outcomeFlags: [...new Set(flags.map((f) => choice(f, outcomeFlags)))],
    };
  }
  if (action === "CreateWorkingCopy") {
    const workflowId = text(options.workflowId || "", 100);
    if (!workflowId) fail("Choose a workflow definition.");
    const instanceRef = text(options.instanceRef || "", 40);
    if (/[\/\\:*?"<>|#%]/.test(instanceRef))
      fail("Instance reference contains a forbidden character.");
    const dueDate = date(options.dueDate);
    return {
      clientId: p.client_id,
      workflowId,
      ...(instanceRef ? { instanceRef } : {}),
      ...(dueDate ? { dueDate } : {}),
    };
  }
  if (action === "AdvanceStage") {
    const expectedStage = choice(
      options.expectedStage,
      options.allowedStages || [],
    );
    return { clientId: p.client_id, serviceLane: lane, expectedStage };
  }
  if (action === "StartStage")
    return {
      clientId: p.client_id,
      stage: choice(
        options.stage,
        (options.allowedStages || []).filter((s) => !s.startsWith("Closed")),
      ),
      serviceLane: lane,
    };
  fail("Unknown workflow action.");
}
