// Quote document generation is deliberately read-only until explicitly enabled.
export const quoteFillMode = (env = process.env) => {
  const mode = env.QUOTE_FILL_MODE || "dryrun";
  if (!["off", "dryrun", "live"].includes(mode)) throw new Error("Invalid QUOTE_FILL_MODE; expected off, dryrun or live.");
  return mode === "live" && env.SHAREPOINT_WRITE_MODE === "live" ? "live" : mode === "off" ? "off" : "dryrun";
};
export const quoteLane = (input) => {
  if (input?.pricingMode === "managed_v20") {
    if (input.serviceTier !== "managed") throw new Error("Only Managed IT quotes are supported by the Managed IT document template.");
    return { key:"COM-PRP", workflow:"MIT-05", label:"Managed IT Quote", template:"v1.8" };
  }
  if (input?.includeBii === true) return { key:"BII-QSOW", workflow:"BII-05", label:"BII Quote & SOW", template:"v1.6" };
  throw new Error("Select BII Integration or Managed IT before generating a quote document.");
};
export function assertQuoteFillEligible({role,status,clientId,workingCopies,requestsPending=false,signatureStatus,completionStatus}) {
  if(role !== "owner") throw new Error("Only the owner can generate contractual quote documents.");
  if(status !== "Approved") throw new Error("Approve the quote before generating its document.");
  if(!clientId) throw new Error("Create or link the SharePoint client first.");
  if(requestsPending) throw new Error("Wait for pending SharePoint Workflow Requests to finish.");
  if(!Array.isArray(workingCopies) || workingCopies.length !== 1) throw new Error("Expected exactly one open working Quote/SOW copy.");
  const copy=workingCopies[0];
  if(!String(copy.name || "").toLowerCase().endsWith(".docx")) throw new Error("The working quote must be a Word .docx file.");
  if(completionStatus !== "Open") throw new Error("The working quote must be open.");
  if(signatureStatus !== undefined && signatureStatus !== "Preparing") throw new Error("The BII quote must have Signature Status Preparing.");
  return copy;
}
