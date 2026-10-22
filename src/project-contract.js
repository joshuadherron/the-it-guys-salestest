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
export function projectCapability(schema,env=process.env) {
  const errors=[];
  if(env.PROJECT_WORKFLOW_CONTRACT!=="v1")errors.push(`Deploy and verify the ${projectLane} v1 Power Automate contract, then have Josh enable the project workflow contract in Hostinger.`);
  for(const [kind,label] of [["requests","Service Lane"],["clients","Service Lanes"]])
    if(!schema.maps?.[kind]?.[label]?.choice?.choices?.includes(projectLane))errors.push(`${kind} ${label} needs the ${projectLane} choice.`);
  if(!schema.businessColumn)errors.push("Clients needs a unique, indexed text TIG_SalesBusinessID column for project business identity.");
  return errors;
}
export function assertProjectCapability(schema,env=process.env) {
  const errors=projectCapability(schema,env);
  if(errors.length)fail(errors.join(" "),503);
}
export function projectDiscovery(p,intake) {
  const answers=intake?json(intake.answers):{};
  const missing=missingIntake(p.engagement_type,answers,p);
  if(!genericEngagement(p)||p.hold||!intake?.complete||missing.length)fail("Complete project/hourly intake and resolve holds before opening SharePoint: "+missing.map(m=>m.label+" ("+m.href+")").join("; "),409);
  if(!p.business_id)fail("Link this opportunity to a business before opening SharePoint.",409);
  return {contractVersion:"project-v1",businessId:String(p.business_id),opportunityId:p.opp,engagementType:p.engagement_type,revision:intake.revision,answers,flags:json(intake.flags)||[],capturedBy:intake.updated_by};
}
