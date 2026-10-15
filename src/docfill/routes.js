import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";
import {query,audit,json,transaction} from "../db.js";
import {ownerOnly,integer,fail} from "../security.js";
import {prospect} from "../pipeline.js";
import {priceConfig} from "../quotes.js";
import {quoteLane,quoteFillMode} from "./policy.js";
import {buildManagedFill,buildBiiFill} from "./quote-fields.js";
import {documentPrefill} from "./prefill.js";

const root=join(dirname(fileURLToPath(import.meta.url)),"../..");
const templateNames={"COM-PRP":"COM-PRP-v1.8.docx","BII-QSOW":"BII-QSOW-v1.6.docx"};
const ownerFields=["legalName","preparedFor","backupContact","locations","location","domain","serviceStart","targetTiming","summary","deviceKinds","deviceTypes","assignedDevices","onboardingText","clientTerms","sizedFor","signer","exceptions","deviceNote","hardwareText","locationText","regulatedText","extraExclusions","extraAssumption","lobExclusion"];
function cleanOwner(body){
 const owner={};
 for(const key of ownerFields){
  const value=body[key];
  if(value!==undefined){if(typeof value!=="string"||value.length>4000)fail("Invalid quote field: "+key);owner[key]=value.trim();}
 }
 owner.hipaa=body.hipaa==="yes";
 return owner;
}
export function quoteDocumentRoutes(app){
 app.get("/quotes/:id/document",ownerOnly,async(req,res)=>{
  if(quoteFillMode()==="off")fail("Document fill is disabled.",403);
  const [q]=await query("SELECT * FROM quotes WHERE id=?",[integer(req.params.id)]);
  if(!q)fail("Quote not found.",404);
  if(q.status!=="Approved")fail("Only approved quotes can generate contractual documents.");
  const p=await prospect(q.prospect_id);
  if(p.hold)fail("Prospect is on hold.");
  const input=json(q.inputs);
  const lane=quoteLane(input,req.query.lane);
  res.render("quote-document",{q,p,lane,prefill:documentPrefill(p,input,lane.key),csrf:res.locals.csrf});
 });
 app.post("/quotes/:id/document",ownerOnly,async(req,res)=>{
  const mode=quoteFillMode();
  if(mode==="off")fail("Document fill is disabled.",403);
  // Browser downloads remain dry-run. Live writes require the separate
  // SharePoint workflow with its own eligibility and eTag checks.
  const [q]=await query("SELECT * FROM quotes WHERE id=?",[integer(req.params.id)]);
  if(!q)fail("Quote not found.",404);
  if(q.status!=="Approved")fail("Only approved quotes can generate contractual documents.");
  const p=await prospect(q.prospect_id);
  if(p.hold)fail("Prospect is on hold.");
  const input=json(q.inputs);
  const lane=quoteLane(input,req.body.lane);
  const owner=cleanOwner(req.body);
  const quote={...q,inputs:input,line_items:json(q.line_items)};
  const prices=await priceConfig();
  const data=lane.key==="COM-PRP"?
   buildManagedFill({quote,prospect:p,owner,prices}):
   buildBiiFill({quote,prospect:p,owner,prices});
  const templatePath=join(root,"test","fixtures",templateNames[lane.key]);
  let template;
  try{template=await readFile(templatePath)}catch(e){
   if(e.code==="ENOENT")fail("Approved DOCX master has not been installed on this server.",503);
   throw e;
  }
  // Dynamic loading allows the rest of the app to run until DOCX dependencies
  // and binary masters have been deployed together.
  const {assertTagset}=await import("./tagsets.js");
  const {listTags,fillDocx}=await import("./fill-docx.js");
  assertTagset(lane.key,await listTags(template));
  const {buffer,report}=await fillDocx(template,data);
  await transaction(async c=>{await audit(c,req.session.user,"dryrun quote document "+lane.key,"quote",q.id)});
  res.set("Cache-Control","no-store");
  res.set("Content-Type","application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.set("Content-Disposition",'attachment; filename="TIG-'+lane.key+'-Quote-'+q.id+'-DRAFT.docx"');
  res.set("X-Quote-Unfilled-Count",String(report.unfilled.length));
  res.send(buffer);
 });
}
