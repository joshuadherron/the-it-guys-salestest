import {assertTagset} from "./tagsets.js";
import {assertQuoteFillEligible,quoteFillMode} from "./policy.js";
import {listTags,fillDocx} from "./fill-docx.js";

/**
 * Shared orchestration for a single contractual document.
 * Callers must resolve master and working copy through approved SharePoint
 * filters, never from user-submitted drive/item identifiers.
 */
export async function prepareQuoteDocument({
  role, quote, clientId, workingCopies, requestsPending, signatureStatus,
  completionStatus, masterCopies, expectedKey, data
}) {
  if(!quote || !["BII-QSOW","COM-PRP"].includes(expectedKey))
    throw new Error("Unsupported quote document.");
  const working = assertQuoteFillEligible({
    role,status:quote.status,clientId,workingCopies,requestsPending,
    signatureStatus,completionStatus
  });
  if(!Array.isArray(masterCopies)||masterCopies.length!==1)
    throw new Error("Expected exactly one Approved SharePoint master template.");
  const master=masterCopies[0];
  if(master.documentKey!==expectedKey || master.status!=="Approved" ||
    !String(master.name||"").toLowerCase().endsWith(".docx") ||
    !Buffer.isBuffer(master.content))
    throw new Error("The approved master document does not match this quote lane.");
  assertTagset(expectedKey,await listTags(master.content));
  const {buffer,report}=await fillDocx(master.content,data);
  if(report.unfilled.length) throw new Error("Quote document contains unfilled fields: "+report.unfilled.join(", "));
  return {buffer,report,master,working,quoteId:quote.id,documentKey:expectedKey};
}

/** Does not write unless both feature flags explicitly permit it. */
export async function deliverQuoteDocument({prepared,graph,env=process.env}) {
  const mode=quoteFillMode(env);
  if(mode==="off") throw new Error("Quote document generation is disabled.");
  if(mode==="dryrun") return {mode,buffer:prepared.buffer,report:prepared.report};
  const w=prepared.working;
  if(!w.driveId||!w.itemId||!w.eTag)
    throw new Error("Working copy is missing a resolved drive, item ID or eTag.");
  const result=await graph.replaceQuoteWorkingCopy(w.driveId,w.itemId,w.eTag,prepared.buffer);
  return {mode,report:prepared.report,item:result};
}
