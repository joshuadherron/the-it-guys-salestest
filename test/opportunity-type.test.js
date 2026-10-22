import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import { changeOpportunityType } from "../src/opportunity-type.js";
import { emptyAnswers,mvd } from "../src/discovery-rules.js";
import { missingIntake } from "../src/engagement-intake.js";
import { engagementTypes } from "../src/engagement-types.js";
import { engagementGuard } from "../src/engagement-guard.js";
const owner={email:"josh@example.test",role:"owner",enabled:1};
const prospect={id:86,opp:"OPP-0086",business_id:9,business_name:"Example business",contact_name:"Pat",engagement_type:"bii",service_lane:"Business IT Integration",stage:"Qualified",hold:true,planned_service_lanes:'["Business IT Integration","Managed IT"]',starting_service_lane:"Managed IT",service_sequence_reason:"Prior timing exception"};
function harness(options={}) {
  let data={record:options.noDiscovery?null:{prospect_id:86,answers:JSON.stringify({...emptyAnswers(),"Q6.3b":{state:"answered",value:"Yes"}}),flags:JSON.stringify([{code:"URGENT SECURITY REVIEW"}]),status:"Ready for Review",revision:7,...options.record},versions:[{revision:7,answers:"original revision"}],activities:[],audits:[],plansCleared:false};
  const sql=[];
  const storage={audit:async(...args)=>data.audits.push(args),query:async(statement,args,c)=>{
    assert.ok(c,"every check and write belongs to the edit transaction");sql.push(statement);
    if(statement.startsWith("SELECT * FROM allowlist"))return options.actor===null?[]:[options.actor||owner];
    if(statement.startsWith("SELECT id FROM quotes"))return options.quotes?[{id:1}]:[];
    if(statement.startsWith("SELECT id,action,status FROM sp_requests"))return Array.isArray(options.requests)?options.requests:options.requests?[{id:2,action:"CreateClient",status:"Pending"}]:[];
    if(statement.startsWith("SELECT * FROM discoveries"))return data.record?[data.record]:[];
    if(statement.startsWith("INSERT INTO discovery_versions")) {
      assert.ok(!data.versions.some(v=>v.revision===args[1]),"revision identities must remain unique");
      data.versions.push({revision:args[1],answers:args[2],actor:args[3]});return {insertId:data.versions.length};
    }
    if(statement.startsWith("UPDATE discoveries")) {if(options.failUpdate)throw new Error("database failure");Object.assign(data.record,{answers:args[0],revision:args[1],status:"Draft",flags:args[2]});return {affectedRows:1};}
    if(statement.startsWith("INSERT INTO activities")){data.activities.push(JSON.parse(args[1]));return {insertId:1};}
    if(statement.startsWith("UPDATE prospects SET planned_service_lanes=NULL")){data.plansCleared=true;return {affectedRows:1};}
    throw new Error("Unexpected SQL: "+statement);
  }};
  const p={...prospect,...options.p};
  const change=async(next="project",expected="bii")=>{
    const before=structuredClone(data);
    try{return await changeOpportunityType(p,next,owner,{transaction:true},storage,expected);}catch(e){data=before;throw e;}
  };
  return {p,change,sql,get data(){return data;}};
}
for(const target of ["project","hourly"])test(`legacy OPP-0086 can change from BII to ${target} with discovery preserved`,async()=>{
  const h=harness(),previous=structuredClone(h.data.record);await h.change(target);
  assert.equal(h.p.id,86);assert.equal(h.p.business_id,9);assert.equal(h.p.hold,true);
  assert.equal(h.data.versions[0].answers,"original revision");assert.equal(h.data.versions[1].revision,8);
  const archived=JSON.parse(h.data.versions[1].answers),answers=JSON.parse(h.data.record.answers);
  assert.deepEqual(archived["Q6.3b"],JSON.parse(previous.answers)["Q6.3b"]);
  assert.equal(archived._type_archive.status,"Ready for Review");assert.equal(archived._type_archive.from,"bii");assert.equal(archived._type_archive.to,target);
  assert.deepEqual(archived._type_archive.flags,JSON.parse(previous.flags));
  assert.equal(h.data.record.revision,9);assert.equal(h.data.record.status,"Draft");assert.equal(answers.contact,"Pat");assert.equal(answers._opportunity_type,target);
  assert.deepEqual(answers._prior_discovery_flags,[{code:"URGENT SECURITY REVIEW"}]);assert.ok(missingIntake(target,answers,h.p).length>0);
  assert.equal(h.data.plansCleared,true);assert.equal(h.data.activities[0].previousPlan,prospect.planned_service_lanes);
  assert.ok(!h.sql.some(sql=>/DELETE|hold=|client_id=|business_id=|status='Approved'/.test(sql)));
});
test("project/hourly correction retains applicable answers but requires a fresh completion review",async()=>{
  const h=harness({p:{engagement_type:"project",service_lane:"Project-Based"},record:{answers:JSON.stringify({contact:"Pat",issue:"Mail issue",scope:"Repair",deliverables:"Working Outlook",access:"Remote"}),flags:"[]"}});
  await h.change("hourly","project");const answers=JSON.parse(h.data.record.answers);
  assert.equal(answers.issue,"Mail issue");assert.equal(answers.access,"Remote");assert.equal(h.data.record.status,"Draft");assert.ok(missingIntake("hourly",answers,h.p).some(m=>m.key==="rate_authorization"));
});
test("changing a generic opportunity to Managed IT starts the detailed questionnaire without fabricating standardization",async()=>{
  const h=harness({p:{engagement_type:"hourly",service_lane:"Project-Based"},record:{answers:JSON.stringify({contact:"Pat",issue:"Repair",scope:"Outlook"}),flags:"[]"}});
  await h.change("managed_it","hourly");const answers=JSON.parse(h.data.record.answers);
  assert.ok(mvd(answers).length);assert.equal(h.data.record.status,"Draft");assert.ok(!h.sql.some(s=>/Client Activation|TechnicalAssessment|CreateClient/.test(s)));
});
test("same-family Managed IT/BII correction retains detailed answers and resets review",async()=>{
  const h=harness();await h.change("managed_it");assert.equal(JSON.parse(h.data.record.answers)["Q6.3b"].value,"Yes");assert.equal(h.data.record.status,"Draft");
});
for(const status of ["Done","Failed","Rejected"])test(`terminal CRM sync ${status} does not lock opportunity type`,async()=>{
  const requests=[{id:202,action:"UpsertProspect",status},{id:201,action:"UpsertProspect",status:"Done"}],h=harness({requests});
  await h.change();assert.equal(h.data.record.status,"Draft");assert.equal(h.data.versions.length,3);assert.equal(requests[0].status,status);assert.ok(!h.sql.some(sql=>/UPDATE sp_requests|DELETE FROM sp_requests/.test(sql)));
});
for(const status of ["Preparing","Pending","Processing","Unknown","Unexpected"])test(`CRM sync ${status} remains blocked with the exact request identity`,async()=>{
  const h=harness({requests:[{id:202,action:"UpsertProspect",status}]}),before=structuredClone(h.data);
  await assert.rejects(()=>h.change(),error=>error.status===409&&error.message.includes(`#202 (UpsertProspect / ${status})`)&&error.message.includes("/prospects/86/handoff"));assert.deepEqual(h.data,before);
});
for(const status of ["Done","Failed","Rejected","Unknown"])test(`service request ${status} is not mistaken for routine CRM history`,async()=>{
  const h=harness({requests:[{id:202,action:"UpsertProspect",status:"Done"},{id:190,action:"CreateClient",status}]}),before=structuredClone(h.data);
  await assert.rejects(()=>h.change(),error=>error.status===409&&error.message.includes(`#190 (CreateClient / ${status})`));assert.deepEqual(h.data,before);
});
test("dry-run service request history remains safe to correct",async()=>{
  const h=harness({requests:[{id:12,action:"CreateClient",status:"Dryrun"}]});await h.change();assert.equal(h.data.record.status,"Draft");
});
for(const [name,options,pattern] of [
  ["revoked user",{actor:null},/Owner access/],
  ["sales account",{actor:{role:"sales"}},/Owner access/],
  ["quoted opportunity",{quotes:true},/has quotes/],
  ["started workflow",{requests:true},/SharePoint request #2 \(CreateClient \/ Pending\)/],
  ["own linked record",{p:{client_id:"CL-86",relationship_type:"new_client"}},/already opened a SharePoint record/],
  ["won sale",{p:{stage:"Closed Won"}},/sale is closed/],
  ["lost sale",{p:{stage:"Closed Lost"}},/sale is closed/],
  ["authorized sale",{p:{sales_authorized:true}},/sale is closed/],
])test(`${name} cannot be silently reclassified`,async()=>{
  const h=harness(options),before=structuredClone(h.data);await assert.rejects(()=>h.change(),pattern);assert.deepEqual(h.data,before);
});
test("an existing customer's new opportunity can be corrected without replacing its shared identity",async()=>{
  const h=harness({p:{client_id:"CL-9",relationship_type:"existing_client"}});await h.change();assert.equal(h.p.client_id,"CL-9");assert.ok(!h.sql.some(s=>/SET client_id|INSERT INTO businesses/.test(s)));
});
test("same type edit performs no archive or plan reset",async()=>{
  const h=harness();assert.equal(await h.change("bii"),false);assert.equal(h.sql.length,0);
});
test("stale type edits are rejected before archiving anything",async()=>{
  const h=harness();await assert.rejects(()=>h.change("project","managed_it"),/another tab/);assert.equal(h.sql.length,0);
});
test("type correction before discovery needs no invented answers or schema migration",async()=>{
  const h=harness({noDiscovery:true});await h.change();assert.equal(h.data.versions.length,1);assert.equal(h.data.activities[0].discoveryArchived,false);
});
test("failed reset rolls the archive and audit back with the edit transaction",async()=>{
  const h=harness({failUpdate:true}),before=structuredClone(h.data);await assert.rejects(()=>h.change(),/database failure/);assert.deepEqual(h.data,before);
});
for(const type of ["project","hourly"])test(`${type} handoff GET goes directly to Project-Based while POST refuses legacy lane commands`,async()=>{
  const guard=engagementGuard({prospect:async()=>({...prospect,engagement_type:type}),query:async()=>[]}),res={redirect(url){this.url=url;}};
  await guard({path:"/prospects/86/handoff",method:"GET"},res,()=>assert.fail("must redirect"));assert.equal(res.url,"/prospects/86/project-sharepoint");
  await assert.rejects(()=>guard({path:"/prospects/86/handoff",method:"POST"},res,()=>assert.fail("must refuse")),e=>e.status===409);
});
test("legacy handoff still receives Managed IT/BII opportunities",async()=>{
  for(const type of ["bii","managed_it"]) {let next=false;await engagementGuard({prospect:async()=>({...prospect,engagement_type:type}),query:async()=>[]})({path:"/prospects/86/handoff",method:"GET"},{},()=>{next=true;});assert.equal(next,true);}
});
test("SharePoint UI shows the actual type, locked Project-Based lane, record reuse and configuration blockers",async()=>{
  for(const type of ["project","hourly"]) {
    const html=await ejs.renderFile("views/project-sharepoint.ejs",{p:{...prospect,engagement_type:type,client_id:"CL-9"},engagementTypes,user:owner,csrf:"csrf",mode:"dryrun",record:{id:9},error:null,prerequisites:["Clients needs a unique business identity column."],requests:[]});
    assert.ok(html.includes(engagementTypes[type]));assert.ok(html.includes("Project-Based</strong> (selected automatically)"));assert.ok(html.includes("will be reused"));assert.ok(html.includes("Clients needs a unique business identity column."));assert.match(html,/<button disabled/);assert.ok(!html.includes('name="service_scope"'));
  }
});
test("prior flags and archived answers are visible and HTML-escaped",async()=>{
  const html=await ejs.renderFile("views/discovery-history.ejs",{p:prospect,user:owner,csrf:"csrf",mode:"dryrun",engagementTypes,json:JSON.parse,versions:[{revision:8,actor:owner.email,created_at:"2026-10-21",answers:JSON.stringify({answer:"<script>bad</script>",_type_archive:{from:"bii",to:"project",status:"Ready for Review"}})}]});
  assert.ok(html.includes("Archived before type correction"));assert.ok(!html.includes("<script>bad</script>"));
  const flags=await ejs.renderFile("views/prior-discovery.ejs",{p:prospect,discoveryAnswers:{_prior_discovery_flags:[{code:"URGENT SECURITY REVIEW"}]}});assert.ok(flags.includes("URGENT SECURITY REVIEW"));assert.ok(flags.includes("does not resolve a security hold"));
});
