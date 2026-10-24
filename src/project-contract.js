import { genericEngagement,projectLane } from "./engagement-types.js";
import { missingIntake } from "./engagement-intake.js";
import { json } from "./db.js";
import { fail } from "./security.js";
import { projectQuoteMaster } from "./docfill/master-names.js";

// Document contracts do not assert that the live SharePoint masters are Approved.
export const projectDocumentKeys=["ENG-PRJ","ENG-HRLY"];
export const projectTags=["ENG.BusinessName","ENG.Contact","ENG.QuoteId","ENG.IssueDate","ENG.EngagementType","ENG.Scope","ENG.Exclusions","ENG.Assumptions","ENG.Terms","ENG.OneTimeTotal","ENG.MonthlyTotal","ENG.EstimatedHours","ENG.HourlyRate","ENG.MinimumHours","REPEAT.Line","Line.Description","Line.Kind","Line.Quantity","Line.UnitPrice","Line.Amount","Line.Billing"].sort();
export function projectDocument(key,env=process.env) {
  if(!projectDocumentKeys.includes(key))fail("Unsupported project document key.");
  if(key==="ENG-PRJ")return {...projectQuoteMaster,lane:projectLane};
  const prefix="HOURLY_QUOTE";
  const name=env[prefix+"_MASTER_FILENAME"],workflow=env[prefix+"_WORKFLOW_ID"];
  if(!name||!workflow||!env[prefix+"_TEMPLATE_VERSION"])fail(`An owner-approved ${key} template is required. Configure ${prefix}_MASTER_FILENAME, ${prefix}_WORKFLOW_ID and ${prefix}_TEMPLATE_VERSION after approving its tags and flow routing.`,503);
  if(!/^[^\\/]+\.docx$/i.test(name)||!/^PRJ-[A-Z0-9-]+$/.test(workflow))fail("Project template filename or PRJ workflow ID is invalid.",503);
  return {key,name,workflow,template:env[prefix+"_TEMPLATE_VERSION"],label:"Hourly Estimate / Work Authorization",lane:projectLane};
}
export function projectCapability(schema) {
  const errors=[];
  const definitions=(schema.definitions||[]).filter(d=>d.id==="PRJ-05");
  if(definitions.length!==1||definitions[0].lane!==projectLane||!definitions[0].active||!definitions[0].createCopy)
    errors.push("Activate PRJ-05 in Client Workflow Definitions (Active = Yes, Create Client Copy = Yes) after the project flows are deployed.");
  for(const [kind,label] of [["requests","Service Lane"],["clients","Service Lanes"]])
    if(!schema.maps?.[kind]?.[label]?.choice?.choices?.includes(projectLane))errors.push(`${kind} ${label} needs the ${projectLane} choice.`);
  if(!schema.businessColumn)errors.push("Clients needs a unique, indexed text TIG_SalesBusinessID column for project business identity.");
  return errors;
}
export function assertProjectCapability(schema) {
  const errors=projectCapability(schema);
  if(errors.length)fail(errors.join(" "),409);
}
export function projectDiscovery(p,intake,quote) {
  if(!genericEngagement(p)||p.hold)fail("Only a project/hourly opportunity without a hold can open a project record.",409);
  if(!p.business_id)fail("Link this opportunity to a business before opening SharePoint.",409);
  const answers=intake?json(intake.answers)||{}:{};
  const snapshot={contractVersion:"project-v1",businessId:String(p.business_id),opportunityId:p.opp,engagementType:p.engagement_type,
    revision:intake?.revision??0,answers,flags:intake?json(intake.flags)||[]:[],capturedBy:intake?.updated_by??null,
    intakeComplete:!!intake?.complete&&!missingIntake(p.engagement_type,answers,p).length};
  if(quote){
    if(quote.status!=="Approved"||String(quote.prospect_id)!==String(p.id))fail("Quote context requires this opportunity's approved quote.",409);
    const input=json(quote.inputs);
    snapshot.quoteContext={scope:input.scope??null,exclusions:input.exclusions??null,assumptions:input.assumptions??null,terms:input.terms??null,contactName:p.contact_name??null,contactEmail:p.email??null};
  }
  return snapshot;
}
