import { query,audit,json } from "./db.js";
import { fail } from "./security.js";
import { engagementTypes,genericEngagement } from "./engagement-types.js";
import { emptyAnswers,flags } from "./discovery-rules.js";
import { validateIntake,intakeFlags } from "./engagement-intake.js";

// Caller holds the opportunity row in the same transaction as the final edit.
// Archive the current discovery before changing questionnaire families. Nothing
// external is submitted and existing revisions are never replaced or deleted.
export async function changeOpportunityType(p,next,user,c,storage={query,audit},expectedType) {
  if(next===p.engagement_type)return false;
  if(!engagementTypes[next])fail("Select a valid opportunity type.");
  if(expectedType!==undefined&&expectedType!==p.engagement_type)fail("The opportunity type changed in another tab. Reload before saving.",409);
  const run=storage.query;
  const [actor]=await run("SELECT * FROM allowlist WHERE email=? AND enabled=TRUE",[user.email],c);
  if(actor?.role!=="owner")fail("Owner access is required to change an opportunity type.",403);
  if(p.sales_authorized||["Closed Won","Closed Lost"].includes(p.stage))fail("This sale is closed. Open a new opportunity under the same business for different work.",409);
  if((await run("SELECT id FROM quotes WHERE prospect_id=? LIMIT 1",[p.id],c)).length)fail("This opportunity has quotes. Preserve their pricing and approvals by opening a new opportunity, or remove unneeded drafts before correcting the type.",409);
  if((await run("SELECT id FROM sp_requests WHERE prospect_id=? AND status<>'Dryrun' LIMIT 1",[p.id],c)).length)fail("This opportunity has SharePoint workflow history. Reconcile it before changing its service type; no workflow was started.",409);
  if(p.client_id&&p.relationship_type!=="existing_client")fail("This opportunity already opened a SharePoint record. Review its workflow before changing type, or open another opportunity under the business.",409);
  const [record]=await run("SELECT * FROM discoveries WHERE prospect_id=? FOR UPDATE",[p.id],c);
  if(record) {
    const old=json(record.answers),oldFlags=json(record.flags)||[],revision=record.revision+1;
    const archive={...old,_type_archive:{from:p.engagement_type,to:next,status:record.status,flags:oldFlags,originalRevision:record.revision}};
    await run("INSERT INTO discovery_versions (prospect_id,revision,answers,actor) VALUES (?,?,?,?)",[p.id,revision,JSON.stringify(archive),actor.email],c);
    const target={engagement_type:next},sameFamily=genericEngagement(p)===genericEngagement(target);
    const answers=genericEngagement(target)?validateIntake(sameFamily?old:{contact:p.contact_name||""}):sameFamily?{...old}:emptyAnswers();
    const prior=[...(old._prior_discovery_flags||[]),...oldFlags];
    answers._prior_discovery_flags=[...new Map(prior.map(flag=>[JSON.stringify(flag),flag])).values()];
    answers._opportunity_type=next;
    const nextFlags=genericEngagement(target)?intakeFlags(answers):flags(answers);
    await run("UPDATE discoveries SET answers=?,revision=?,status='Draft',flags=? WHERE prospect_id=?",[JSON.stringify(answers),revision+1,JSON.stringify(nextFlags),p.id],c);
    await run("INSERT INTO discovery_versions (prospect_id,revision,answers,actor) VALUES (?,?,?,?)",[p.id,revision+1,JSON.stringify(answers),actor.email],c);
  }
  await run("INSERT INTO activities (prospect_id,type,outcome,notes,occurred_on,actor) VALUES (?,'note','Opportunity type corrected',?,UTC_DATE(),?)",[p.id,JSON.stringify({from:p.engagement_type,to:next,discoveryArchived:!!record,previousPlan:p.planned_service_lanes||null,previousStartingLane:p.starting_service_lane||null,previousSequenceReason:p.service_sequence_reason||null}),actor.email],c);
  await run("UPDATE prospects SET planned_service_lanes=NULL,starting_service_lane=NULL,service_sequence_reason=NULL WHERE id=?",[p.id],c);
  await storage.audit(c,actor,`correct opportunity type ${p.engagement_type} to ${next}`,"prospect",p.id);
  return true;
}
