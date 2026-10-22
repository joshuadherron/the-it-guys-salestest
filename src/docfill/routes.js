import { quoteSend } from "../quote-permissions.js";
import { managedOwnerFacts, formattedQuoteNumber } from "./managed-facts.js";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";
import {query,audit,json,transaction} from "../db.js";
import {integer,fail} from "../security.js";
import {prospect} from "../pipeline.js";
import {priceConfig} from "../quotes.js";
import {quoteLane,quoteFillMode} from "./policy.js";
import {buildManagedFill,buildBiiFill} from "./quote-fields.js";
import {documentPrefill} from "./prefill.js";
import { genericEngagement } from "../engagement-types.js";

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
export function quoteDocumentRoutes(app,dependencies={query,audit,json,transaction,prospect,priceConfig}){
 const {query,audit,json,transaction,prospect,priceConfig}=dependencies;
 app.get("/quotes/:id/document",quoteSend,async(req,res)=>{
  if(quoteFillMode()==="off")fail("Document fill is disabled.",403);
  const [q]=await query("SELECT * FROM quotes WHERE id=?",[integer(req.params.id)]);
  if(!q)fail("Quote not found.",404);
  if(q.status!=="Approved")fail("Only approved quotes can generate contractual documents.");
  const p=await prospect(q.prospect_id);
  if(genericEngagement(p))return res.redirect(`/quotes/${q.id}/project-document`);

  if(!q.quote_number){q.quote_number=formattedQuoteNumber(q);await query("UPDATE quotes SET quote_number=? WHERE id=? AND quote_number IS NULL",[q.quote_number,q.id]);}
  const input=json(q.inputs);
  const lane=quoteLane(input,req.query.lane);
  res.render("quote-document",{q,p,lane,fillMode:quoteFillMode(),prefill:{...documentPrefill(p,input,lane.key),...Object.fromEntries(Object.entries(q.document_facts?json(q.document_facts):{}).filter(([,v])=>v!=="" && v!==null && v!==undefined && !(typeof v==="string" && ["none","none.","null","undefined","n/a","unknown"].includes(v.trim().toLowerCase())))),onboardingFee:Number(input.onboarding||0),onsiteHours:Number(input.onsiteHours||0),quoteComputers:Number(input.computers||0)},csrf:res.locals.csrf});
 });
 app.post("/quotes/:id/document",quoteSend,async(req,res)=>{
  const mode=quoteFillMode();
  if(mode==="off")fail("Document fill is disabled.",403);
  // Browser downloads remain dry-run. Live writes require the separate
  // SharePoint workflow with its own eligibility and eTag checks.
  const [q]=await query("SELECT * FROM quotes WHERE id=?",[integer(req.params.id)]);
  if(!q)fail("Quote not found.",404);
  if(q.status!=="Approved")fail("Only approved quotes can generate contractual documents.");
  const p=await prospect(q.prospect_id);
  if(genericEngagement(p))fail("Use the project/hourly proposal form.",409);

  if(!q.quote_number){q.quote_number=formattedQuoteNumber(q);await query("UPDATE quotes SET quote_number=? WHERE id=? AND quote_number IS NULL",[q.quote_number,q.id]);}
  const input=json(q.inputs);
  const lane=quoteLane(input,req.body.lane);
  const owner=lane.key==="COM-PRP"?managedOwnerFacts(req.body):cleanOwner(req.body);
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
  await transaction(async c=>{
    await prospect(q.prospect_id,c);
    const [current]=await query("SELECT * FROM quotes WHERE id=? FOR UPDATE",[q.id],c);
    if(current?.status!=="Approved"||JSON.stringify(json(current.inputs))!==JSON.stringify(input)||JSON.stringify(json(current.line_items))!==JSON.stringify(quote.line_items))
      fail("Quote approval or quantities changed. Reload the quote before generating.",409);
    await query("UPDATE quotes SET document_facts=? WHERE id=?",[JSON.stringify(owner),q.id],c);
    await audit(c,req.session.user,"dryrun quote document "+lane.key,"quote",q.id);
  });
  if(req.body.action==="FillSharePoint"){
    req.session.proposalRuns ||= {};
    req.session.proposalRuns[q.id]=true;
    return res.redirect(`/quotes/${q.id}/preparation?run=yes`);
  }
  res.set("Cache-Control","no-store");
  res.set("Content-Type","application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.set("Content-Disposition",'attachment; filename="TIG-'+lane.key+'-Quote-'+q.id+'-DRAFT.docx"');
  res.set("X-Quote-Unfilled-Count",String(report.unfilled.length));
  res.send(buffer);
 });
}
