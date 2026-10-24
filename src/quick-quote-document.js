import { readFile } from "node:fs/promises";
import { json } from "./db.js";
import { quoteLane } from "./docfill/policy.js";
import { buildManagedFill,buildBiiFill } from "./docfill/quote-fields.js";
import { buildProjectFill } from "./docfill/project-fields.js";
import { assertTagset } from "./docfill/tagsets.js";
import { listTags,fillDocx } from "./docfill/fill-docx.js";

export async function quickQuoteDocument(q,p,prices){
  // A draft preview is not approval and performs no external write. Date is labelled
  // provisional in the UI; real Send records its own approval timestamp.
  const quote={...q,approved_at:q.approved_at||new Date().toISOString(),inputs:json(q.inputs),line_items:json(q.line_items)};
  const lane=quoteLane(quote.inputs),owner=q.document_facts?json(q.document_facts):{};
  const data=lane.key==="ENG-PRJ"?buildProjectFill({quote,prospect:p}):lane.key==="COM-PRP"?buildManagedFill({quote,prospect:p,owner}):buildBiiFill({quote,prospect:p,owner,prices});
  const filename={"COM-PRP":"COM-PRP-v1.8.docx","BII-QSOW":"BII-QSOW-v1.7.docx","ENG-PRJ":"ENG-PRJ-v1.0.docx"}[lane.key];
  if(!filename)throw new Error("Use the existing approved hourly template preview for hourly estimates.");
  const master=await readFile(new URL("../test/fixtures/"+filename,import.meta.url));
  assertTagset(lane.key,await listTags(master));
  return {...await fillDocx(master,data),data,lane};
}
