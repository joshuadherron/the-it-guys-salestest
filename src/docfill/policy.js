import { genericPricing } from "../engagement-types.js";
import { projectDocument } from "../project-contract.js";
// Quote document generation is deliberately read-only until explicitly enabled.
export const quoteFillMode = (env = process.env) => {
  const mode = env.QUOTE_FILL_MODE || "dryrun";
  if (!["off", "dryrun", "live"].includes(mode)) throw new Error("Invalid QUOTE_FILL_MODE; expected off, dryrun or live.");
  return mode;
};
export const quoteLane = (input, requestedKey, env=process.env) => {
  if(genericPricing(input)) {
    const key=input.pricingMode==="hourly_v1"?"ENG-HRLY":"ENG-PRJ";
    if(requestedKey&&requestedKey!==key)throw new Error("The document must match the approved engagement type.");
    return projectDocument(key,env);
  }
  if (requestedKey && !["COM-PRP", "BII-QSOW"].includes(requestedKey)) throw new Error("Unsupported quote document key.");
  if (requestedKey === "COM-PRP" && input?.pricingMode !== "managed_v20") throw new Error("Managed IT template requires a Managed IT quote.");
  if (requestedKey === "BII-QSOW" && input?.pricingMode === "managed_v20") throw new Error("Combined quotes require a separately approved and priced BII scope before BII document generation.");
  if (requestedKey === "BII-QSOW" && input?.includeBii === true) return { key:"BII-QSOW", workflow:"BII-05", label:"BII Quote & SOW", template:"v1.6" };
  if (requestedKey === "BII-QSOW") throw new Error("This quote does not include BII.");
  if (input?.pricingMode === "managed_v20" && requestedKey !== "BII-QSOW") {
    if (input.serviceTier !== "managed") throw new Error("Only Managed IT quotes are supported by the Managed IT document template.");
    return { key:"COM-PRP", workflow:"MIT-05", label:"Managed IT Quote", template:"v1.8" };
  }
  if (input?.includeBii === true) return { key:"BII-QSOW", workflow:"BII-05", label:"BII Quote & SOW", template:"v1.6" };
  throw new Error("Select BII Integration or Managed IT before generating a quote document.");
};
export function assertQuoteFillEligible({canSend,status,clientId,workingCopies,requestsPending=false,signatureStatus,completionStatus}) {
  if(canSend !== true) throw new Error("Permission quote.send is required to fill quote documents.");
  if(status !== "Approved") throw new Error("Approve the quote before generating its document.");
  if(!clientId) throw new Error("Save proposal to SharePoint to create or link the opportunity record.");
  if(requestsPending) throw new Error("Wait for pending SharePoint Workflow Requests to finish.");
  if(!Array.isArray(workingCopies) || workingCopies.length !== 1) throw new Error("Expected exactly one open working Quote/SOW copy.");
  const copy=workingCopies[0];
  if(!String(copy.name || "").toLowerCase().endsWith(".docx")) throw new Error("The working quote must be a Word .docx file.");
  if(completionStatus !== "Open") throw new Error("The working quote must be open.");
  if(signatureStatus !== undefined && signatureStatus !== "Preparing") throw new Error("The BII quote must have Signature Status Preparing.");
  return copy;
}
