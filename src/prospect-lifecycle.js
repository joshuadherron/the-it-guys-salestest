// Use explicit known lifecycle stages; unknown/closed stages never imply conversion.
export const activatedStages = ["Client Activation", "Onboarding", "Go-Live", "Stabilization", "Operations", "Monthly Review", "Quarterly Review", "Project Delivery", "Acceptance", "Offboarding"];
export const isActivated = stage => activatedStages.includes(stage);
export function prospectLifecycle(p) {
  const lost = p.stage === "Closed Lost" || p.status === "Lost" || String(p.sharepoint_stage || "").includes("Lost");
  return { status: lost ? "Lost" : isActivated(p.sharepoint_stage) ? "Converted" : p.status || "Active",
    convertedClientId: !lost && isActivated(p.sharepoint_stage) ? p.client_id : null };
}
export function relationshipLabel(p, stage = p.sharepoint_stage) {
  if (!p.client_id) return "Prospect";
  return isActivated(stage) && prospectLifecycle(p).status!=="Lost" ? "Client" : `Opportunity in SharePoint (${p.opp} · ${p.client_id})`;
}
