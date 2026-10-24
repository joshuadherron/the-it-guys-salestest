import {assertTagset} from "./tagsets.js";
import {assertQuoteFillEligible,quoteFillMode} from "./policy.js";
import {listTags,fillDocx} from "./fill-docx.js";
import {cleanDocumentProperties} from './document-properties.js';

/**
 * Shared orchestration for a single contractual document.
 * Callers must resolve master and working copy through approved SharePoint
 * filters, never from user-submitted drive/item identifiers.
 */
export async function prepareQuoteDocument({
  canSend, quote, clientId, workingCopies, requestsPending, signatureStatus,
  completionStatus, masterCopies, expectedKey, data
}) {
  if(!quote || !["BII-QSOW","COM-PRP","ENG-PRJ","ENG-HRLY"].includes(expectedKey))
    throw new Error("Unsupported quote document.");
  const working = assertQuoteFillEligible({
    canSend,status:quote.status,clientId,workingCopies,requestsPending,
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
  const cleaned=await cleanDocumentProperties(master.content,working.sharepoint?.fields.Title);
  const {buffer,report}=await fillDocx(cleaned.buffer,data);
  report.preservedBoundProperties=cleaned.skipped;
  // In dryrun, preserve owner-editable bracketed narrative placeholders and report them.
  // In live mode the caller must reject unresolved fields before overwriting SharePoint.
  return {buffer,report,master,working,quoteId:quote.id,documentKey:expectedKey};
}

/** Writes quote content only when the dedicated QUOTE_FILL_MODE is live. */
export async function deliverQuoteDocument({prepared,graph,env=process.env}) {
  const mode=quoteFillMode(env);
  if(mode==="off") throw new Error("Quote document generation is disabled.");
  if(mode==="dryrun") return {mode,buffer:prepared.buffer,report:prepared.report};
  // Unfilled controls remain editable in Word; the current PDF is checked before sending.
  const w=prepared.working;
  if(!w.driveId||!w.itemId||!w.eTag)
    throw new Error("Working copy is missing a resolved drive, item ID or eTag.");
  if(!w.sharepoint?.fieldsPath||!w.sharepoint.fields)
    throw new Error('Working copy SharePoint fields could not be verified before fill.');
  const {fieldsPath,fields}=w.sharepoint;
  const before=await graph.read(fieldsPath);
  if(Object.entries(fields).some(([key,value])=>(before[key]??'')!==value))throw Object.assign(new Error('Working copy SharePoint columns changed before fill. Reload and review.'),{status:409});
  const result=await graph.replaceQuoteWorkingCopy(w.driveId,w.itemId,w.eTag,prepared.buffer);
  const current=await graph.read(fieldsPath);
  const changes=Object.fromEntries(Object.entries(fields).filter(([key,value])=>(current[key]??'')!==value));
  if(Object.keys(changes).length){
    try{
      await graph.request(fieldsPath,'PATCH',changes);
      const restored=await graph.read(fieldsPath);
      if(Object.entries(fields).some(([key,value])=>(restored[key]??'')!==value))throw new Error('Restored values could not be verified.');
    }catch(e){throw Object.assign(new Error('Quote upload changed SharePoint columns and they could not be restored. Reconcile this working copy before retrying.',{cause:e}),{status:409});}
  }
  return {mode,report:prepared.report,item:result};
}
