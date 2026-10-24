import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import ejs from "ejs";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { prices } from "../src/config.js";
import { ensureRegulatedPrices,loadPriceConfig,startRegulatedPriceBackfill } from "../src/price-config.js";
import { priceQuote,regulatedPackagePrice } from "../src/pricing.js";
import { biiOptions,biiApprovalMissing,biiPlanLength,regulatedDataText,optionalAssessmentHint } from "../src/bii-options.js";
import { prefill,validateInputs,quotesRoutes } from "../src/quotes.js";
import { flags } from "../src/discovery-rules.js";
import { buildBiiFill } from "../src/docfill/quote-fields.js";
import { listTags,fillDocx } from "../src/docfill/fill-docx.js";
import { assertTagset } from "../src/docfill/tagsets.js";
import { quoteLane } from "../src/docfill/policy.js";
import { masterNames } from "../src/docfill/master-names.js";

const raw={users:"7",windows:"6",mac:"1",ios:"1",android:"0",unallocated:"0",mailboxes:"6",dell:"0",phones:"2",locations:"1",includeBii:"yes",confirmed:"yes"};
const base=()=>validateInputs(raw);
const plan={operatingBusiness:true,pilotGroup:"Front desk",waveCount:3,waveBasis:"department and location",waveDates:"October 26, 27 and 28",afterHoursWindows:"none",assessed:true,assessmentDate:"2026-10-23"};
const owner={legalName:"Example Health LLC",preparedFor:"Pat Owner",backupContact:"Administrator",location:"Beaumont",domain:"example.test",targetTiming:"Dated plan",summary:"Integrate the listed business environment",deviceTypes:"Six Windows PCs, one Mac and one company iPad",exceptions:"None",signer:"Pat Owner, Director",hardwareText:"Hardware quoted separately",locationText:"Second location scope"};
function sample(changes={}){
  const input={...base(),...changes},calc=priceQuote(input,prices);
  return {quote:{id:17,inputs:input,total:calc.total,approved_at:"2026-10-24T01:33:00Z"},prospect:{business_name:"Example Health"},owner,prices};
}
const fixture=()=>readFile(new URL("./fixtures/BII-QSOW-v1.7.docx",import.meta.url));
function priceDatabase(initial){
  const rows=new Map(Object.entries(initial)),writes=[];
  const run=async(sql,args,connection)=>{
    if(sql.startsWith("SELECT * FROM config_prices"))return [...rows].map(([name,amount])=>({name,amount}));
    assert.equal(sql,"INSERT IGNORE INTO config_prices (name,amount) VALUES (?,?)");
    writes.push({args,connection});
    if(!rows.has(args[0]))rows.set(args[0],args[1]);
    return {affectedRows:1};
  };
  return {rows,writes,run};
}
test("existing database without regulated prices is backfilled and produces a complete BII DOCX",async()=>{
  const old={...prices};for(const key of ["regulatedBase","regulatedUser","regulatedIncludedUsers"])delete old[key];
  const db=priceDatabase(old),config=await loadPriceConfig(undefined,db.run);
  assert.deepEqual(config,prices);assert.equal(db.writes.length,3);
  const args=sample({regulatedPackage:true});args.prices=config;
  const result=await fillDocx(await fixture(),buildBiiFill(args));
  assert.deepEqual(result.report.unfilled,[]);
  assert.ok((await outputText(result.buffer)).includes("$5,135"));
  await loadPriceConfig(undefined,db.run);assert.equal(db.writes.length,3);
});
test("startup seed is idempotent and partial backfill never overwrites existing owner prices",async()=>{
  const db=priceDatabase({foundation:4200,regulatedBase:650,regulatedUser:30});
  await Promise.all([ensureRegulatedPrices(db.run),ensureRegulatedPrices(db.run)]);
  assert.deepEqual(Object.fromEntries(db.rows),{foundation:4200,regulatedBase:650,regulatedUser:30,regulatedIncludedUsers:5});
  const partial=priceDatabase({regulatedBase:650}),connection={};
  const config=await loadPriceConfig(connection,partial.run);
  assert.deepEqual(config,{regulatedBase:650,regulatedUser:25,regulatedIncludedUsers:5});
  assert.ok(partial.writes.every(w=>w.connection===connection));
});
test("startup backfill failure is handled and price loading retries successfully after database recovery",async()=>{
  const error=Object.assign(new Error("Database unavailable"),{code:"ECONNREFUSED"}),reported=[];
  await startRegulatedPriceBackfill(async()=>{throw error;},e=>reported.push(e));
  assert.deepEqual(reported,[error]);
  const old={...prices};for(const key of ["regulatedBase","regulatedUser","regulatedIncludedUsers"])delete old[key];
  const db=priceDatabase(old);
  assert.deepEqual(await loadPriceConfig(undefined,db.run),prices);
});
test("Hostinger CommonJS launcher can synchronously load the server module graph",()=>{
  // Stop at the first config check, before any listener or database/network work.
  // Top-level await would fail earlier with ERR_REQUIRE_ASYNC_MODULE instead.
  const result=spawnSync(process.execPath,["-e",'require("node:assert/strict").throws(()=>require("./server.js"),{message:"Invalid SHAREPOINT_WRITE_MODE"})'],{
    cwd:new URL("..",import.meta.url),env:{...process.env,SHAREPOINT_WRITE_MODE:"launcher-test-invalid"},encoding:"utf8",timeout:15000
  });
  assert.equal(result.status,0,result.stderr||result.error?.message);
});
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
async function outputText(buffer){const zip=await JSZip.loadAsync(buffer),doc=new DOMParser().parseFromString(await zip.file("word/document.xml").async("string"),"text/xml");return Array.from(doc.getElementsByTagNameNS(W,"t")).map(t=>t.textContent).join(" ");}

test("BII seed defaults add only the owner-decided regulated amounts; original worked example stays $4,585",()=>{
  assert.deepEqual([prices.regulatedBase,prices.regulatedUser,prices.regulatedIncludedUsers],[500,25,5]);
  assert.deepEqual([prices.foundation,prices.additional_user,prices.additional_mailbox,prices.additional_device,prices.dell_deployment],[3750,75,130,185,260]);
  assert.equal(priceQuote(base(),prices).total,4585);
});
for(const [users,expected] of [[3,500],[5,500],[6,525],[15,750],[100,2875]])test(`regulated package uses Foundation user count: ${users} users costs $${expected}`,()=>{
  const input={...base(),users,regulatedPackage:true};
  const result=priceQuote(input,prices),line=result.lines.find(l=>l.label==="Regulated Data Package");
  assert.equal(line.amount,expected);assert.equal(result.total-priceQuote({...input,regulatedPackage:false},prices).total,expected);
  assert.equal(regulatedPackagePrice(users,prices),expected);
});
test("package off creates no price line; missing config never invents a package rate",()=>{
  for(const users of [0,3,5,100])assert.ok(!priceQuote({...base(),users,regulatedPackage:false},withOldPrices()).lines.some(l=>l.label==="Regulated Data Package"));
  for(const key of ["regulatedBase","regulatedUser","regulatedIncludedUsers"]){const config={...prices};delete config[key];assert.throws(()=>priceQuote({...base(),regulatedPackage:true},config),new RegExp(key));}
  function withOldPrices(){const config={...prices};for(const key of ["regulatedBase","regulatedUser","regulatedIncludedUsers"])delete config[key];return config;}
});

test("patient discovery defaults match prepareBaa's FLAG-HEALTH-DATA signal and Josh can override it",()=>{
  for(const [answer,expected] of [["Patient/medical information",true],["Financial-services regulation",false],["We accept credit/debit card payments",false]]){
    const discovery={"Q7.1":{state:"answered",value:[answer]}};
    assert.equal(prefill(discovery).regulatedPackage,expected);
    assert.equal(prefill(discovery).regulatedPackage,flags(discovery).some(f=>f.code==="FLAG-HEALTH-DATA"));
  }
  assert.equal(validateInputs({...raw,regulatedPackage:"yes"}).regulatedPackage,true);
  assert.equal(validateInputs(raw).regulatedPackage,false);
  assert.equal(prefill({}).operatingBusiness,false);
});

test("operating plan fields are optional in drafts but individually required for approval",()=>{
  const draft=biiOptions({operatingBusiness:"yes"});assert.equal(draft.afterHoursWindows,"none");
  assert.equal(biiApprovalMissing(draft).length,4);
  for(const [key,label] of [["pilotGroup","Pilot group"],["waveCount","Wave count"],["waveBasis","Wave basis"],["waveDates","Wave dates"],["afterHoursWindows","After-hours windows"]])assert.ok(biiApprovalMissing({...plan,assessed:false,[key]:key==="waveCount"?null:""}).some(x=>x.includes(label)),key);
  assert.deepEqual(biiApprovalMissing(plan),[]);
  assert.deepEqual(biiApprovalMissing({...biiOptions({}),assessed:false}),[]);
  assert.throws(()=>biiOptions({waveCount:0}),/at least 1/);assert.throws(()=>biiOptions({waveCount:"2.5"}),/whole number/);assert.throws(()=>biiOptions({waveBasis:"size"}),/valid option/);
});

test("operating schedule has no size cap or price effect, and after-hours adds no price line",()=>{
  for(const waveCount of [1,3,100001]){
    const input={...base(),...plan,waveCount,afterHoursWindows:"Saturday 8pm"};
    assert.equal(biiPlanLength(input),12+waveCount);assert.deepEqual(priceQuote(input,prices),priceQuote(base(),prices));
  }
  assert.equal(biiPlanLength({waveCount:null}),null);
});

test("assessment date is required only for an actually completed assessment and optional assessment never stops approval",()=>{
  assert.ok(biiApprovalMissing({...base(),assessed:true}).includes("Assessment date"));
  assert.deepEqual(biiApprovalMissing({...base(),operatingBusiness:true,...plan,assessed:false,assessmentDate:null}),[]);
  assert.throws(()=>biiOptions({assessmentDate:"2026-02-30"}),/Invalid date/);
  const data=buildBiiFill(sample({...plan}));assert.equal(data.fields["QSOW.AssessmentDate"],"October 23, 2026");assert.equal(data.fields["QSOW.IssueDate"],"October 23, 2026");
  const sql=sample({...plan});sql.quote.approved_at="2026-10-24 01:33:00";assert.equal(buildBiiFill(sql).fields["QSOW.IssueDate"],"October 23, 2026");
});

test("v1.7 fixture has exactly 74 tags, preserves the old 60 tags and is the only active BII version",async()=>{
  const tags=await listTags(await fixture()),old=await listTags(await readFile(new URL("./fixtures/BII-QSOW-v1.6.docx",import.meta.url)));
  assert.equal(old.length,60);assert.equal(tags.length,74);assertTagset("BII-QSOW",tags);
  for(const tag of old)assert.ok(tags.includes(tag),tag);
  assert.equal(tags.filter(t=>!old.includes(t)).length,14);
  assert.equal(quoteLane({includeBii:true}).template,"v1.7");
  assert.deepEqual(masterNames["BII-QSOW"],["BII-QSOW-v1.7.docx","The_IT_Guys_BII_Short_Form_Quote_SOW_Template_v1.7.docx"]);
});

test("all BII flags true fill the new master without unfilled tags; original master bytes stay unchanged",async()=>{
  const master=await fixture(),before=Buffer.from(master),data=buildBiiFill(sample({...plan,regulatedPackage:true,dell:1}));
  for(const flag of Object.keys(data.flags))data.flags[flag]=true;
  const result=await fillDocx(master,data);assert.deepEqual(result.report.unfilled,[]);assert.deepEqual(await listTags(result.buffer),[]);assert.deepEqual(master,before);
  const text=await outputText(result.buffer);assert.ok(text.includes("Business already operating."));assert.ok(text.includes("Front desk"));assert.ok(text.includes("Assessment basis."));assert.ok(text.includes("October 23, 2026"));assert.ok(text.includes("7 users"));assert.ok(text.includes("$550"));
});

test("all three new flags false remove package row, operating paragraph and assessment paragraph completely",async()=>{
  const data=buildBiiFill(sample({regulatedPackage:false,operatingBusiness:false,assessed:false}));
  const result=await fillDocx(await fixture(),data),text=await outputText(result.buffer);
  assert.deepEqual(result.report.unfilled,[]);assert.deepEqual(await listTags(result.buffer),[]);
  assert.ok(!text.includes("Regulated Data Package (patient data)"));assert.ok(!text.includes("Business already operating."));assert.ok(!text.includes("Staff keep working throughout."));assert.ok(!text.includes("Assessment basis."));assert.ok(!text.includes("The Regulated Data Package adds"));
  assert.ok(text.includes("$4,585"));
});

test("regulated paragraph and price row are controlled together and use the exact new default",()=>{
  const data=buildBiiFill(sample({regulatedPackage:true}));
  assert.equal(data.flags["IF.Regulated"],true);assert.equal(data.flags["IF.RegulatedPackage"],true);
  assert.equal(data.fields["QSOW.RegulatedText"],regulatedDataText);assert.equal(data.fields["QSOW.RegulatedCost"],"$550");assert.equal(data.fields["QSOW.Total"],"$5,135");
  assert.equal(data.fields["QSOW.AddonsNote"],"+ add-ons and scope listed in §2");
  assert.equal(buildBiiFill(sample({users:5,windows:5,mac:0,ios:0,mailboxes:5,regulatedPackage:false})).fields["QSOW.AddonsNote"],"");
  assert.equal(buildBiiFill(sample({users:1,regulatedPackage:true})).fields["QSOW.RegulatedUsers"],"1 user");
  const oldNarrative=sample();oldNarrative.owner={...owner,regulatedText:"Prior custom narrative"};
  assert.equal(buildBiiFill(oldNarrative).flags["IF.Regulated"],false);
});

test("printed regulated rates are exactly $500 and $25; config drift fails even with the package off",async()=>{
  const master=await fixture();
  for(const regulatedPackage of [true,false]){
    const data=buildBiiFill(sample({regulatedPackage}));
    assert.equal(data.rates["RATE.RegulatedBase"],"$500");assert.equal(data.rates["RATE.RegulatedUser"],"$25");
    for(const [key,rate] of [["regulatedBase","RATE.RegulatedBase"],["regulatedUser","RATE.RegulatedUser"]]){
      const args=sample({regulatedPackage});args.prices={...prices,[key]:prices[key]+1};args.quote.total=priceQuote(args.quote.inputs,args.prices).total;
      await assert.rejects(()=>fillDocx(master,buildBiiFill(args)),new RegExp("template rate "+rate));
    }
  }
});

test("every IF flag must be supplied, including all new flags",async()=>{
  const master=await fixture(),tags=(await listTags(master)).filter(t=>t.startsWith("IF."));
  const data=buildBiiFill(sample({...plan,regulatedPackage:true}));
  assert.deepEqual(Object.keys(data.flags).sort(),tags.sort());
  for(const flag of tags){const incomplete=structuredClone(data);delete incomplete.flags[flag];await assert.rejects(()=>fillDocx(master,incomplete),new RegExp("missing flag "+flag));}
});

function routes(input){
  const paths=new Map(),writes=[],audits=[],q={id:19,prospect_id:86,status:"Draft",inputs:input};
  const run=async(sql,args=[])=>{
    if(sql.startsWith("SELECT * FROM quotes"))return [q];if(sql.startsWith("SELECT id FROM prospects"))return [{id:86}];
    if(sql.startsWith("SELECT * FROM config_stop_conditions"))return [{id:1,label:"Known ownership dispute",status:"Review"}];
    if(sql.startsWith("UPDATE")||sql.startsWith("INSERT")){writes.push({sql,args});return {insertId:20};}throw new Error(sql);
  };
  quotesRoutes({get:(p,...handlers)=>paths.set("GET "+p,handlers),post:(p,...handlers)=>paths.set("POST "+p,handlers)},{query:run,transaction:async f=>f({}),audit:async(...args)=>{audits.push(args);},prospect:async()=>({id:86,engagement_type:"bii"}),discovery:async()=>({answers:{}}),priceConfig:async()=>prices});
  const req={params:{id:19},body:{reviewed:"yes"},session:{user:{role:"owner",email:"josh@example.test",quote_approve:true}}};
  const res={redirect(){}};
  return {req,writes,audits,async call(path){for(const handler of paths.get("POST "+path)){let next=false;await handler(req,res,()=>{next=true;});if(!next)break;}}};
}
test("BII approval names every missing plan field and requires an assessment date only when assessed",async()=>{
  const incomplete=routes({...base(),operatingBusiness:true,afterHoursWindows:"",assessed:true});
  await assert.rejects(()=>incomplete.call("/quotes/:id/approve"),e=>["Pilot group","Wave count","Wave basis","Wave dates","After-hours windows","Assessment date"].every(label=>e.message.includes(label)));assert.equal(incomplete.writes.length,0);
  const ready=routes({...base(),...plan,assessed:false,assessmentDate:null});await ready.call("/quotes/:id/approve");assert.ok(ready.writes.some(w=>w.sql.startsWith("UPDATE quotes SET status='Approved'")));
});
for(const [key,label] of [["pilotGroup","Pilot group"],["waveCount","Wave count"],["waveBasis","Wave basis"],["waveDates","Wave dates"],["afterHoursWindows","After-hours windows"]])test(`approval refuses an operating BII quote missing only ${key} and names it`,async()=>{
  const h=routes({...base(),...plan,[key]:key==="waveCount"?null:""});
  await assert.rejects(()=>h.call("/quotes/:id/approve"),e=>e.message.includes(label)&&!e.message.includes("BT-7.30"));
  assert.equal(h.writes.length,0);
});
test("approval refuses assessed BII quote without a date even when not operating",async()=>{
  const h=routes({...base(),operatingBusiness:false,assessed:true,assessmentDate:null});
  await assert.rejects(()=>h.call("/quotes/:id/approve"),/Assessment date/);assert.equal(h.writes.length,0);
});
test("operating and assessed never auto-select BT-7.30 stop conditions",async()=>{
  for(const operatingBusiness of [true,false])for(const assessed of [true,false]){
    const h=routes({...base(),...plan,operatingBusiness,assessed});await h.call("/quotes/:id/approve");
    const update=h.writes.find(w=>w.sql.startsWith("UPDATE quotes SET status='Approved'"));
    assert.ok(update);assert.equal(JSON.parse(update.args[1])[0].selected,false);
  }
  const view=await readFile("views/quick-quote-preview.ejs","utf8");
  const stop=view.match(/<input[^>]*name="stop_[\s\S]*?value="yes"[^>]*>/);
  assert.ok(stop);assert.ok(!stop[0].includes("checked"));
});
test("BII BT-7.30 warning requires Continue Anyway and records the owner acknowledgement",async()=>{
  const blocked=routes(base());blocked.req.body={reviewed:"yes",stop_1:"yes"};
  await assert.rejects(()=>blocked.call("/quotes/:id/approve"),{message:"Assessment findings need review. Select Continue Anyway to approve pricing only; this does not authorize work or service activation."});
  assert.equal(blocked.writes.length,0);assert.equal(blocked.audits.length,0);
  const acknowledged=routes(base());acknowledged.req.body={reviewed:"yes",stop_1:"yes",continue_anyway:"yes"};await acknowledged.call("/quotes/:id/approve");
  const update=acknowledged.writes.find(w=>w.sql.startsWith("UPDATE quotes SET status='Approved'"));
  assert.deepEqual(JSON.parse(update.args[1]),[{id:1,label:"Known ownership dispute",status:"Review",selected:true,acknowledged:true}]);
  assert.deepEqual(acknowledged.audits[0].slice(2),["approve","quote",19]);
  const optional=routes({...base(),...plan,assessed:false});await optional.call("/quotes/:id/approve");assert.ok(optional.writes.length);
});
test("BII drafts can save incomplete plans and retain the new inputs for owner review",async()=>{
  const h=routes(base());h.req.params.id=86;h.req.body={...raw,operatingBusiness:"yes",assessed:"yes",regulatedPackage:"yes"};await h.call("/prospects/:id/quotes");
  const write=h.writes.find(w=>w.sql.startsWith("INSERT INTO quotes")),saved=JSON.parse(write.args[1]);
  assert.equal(saved.operatingBusiness,true);assert.equal(saved.assessed,true);assert.equal(saved.regulatedPackage,true);assert.equal(saved.waveCount,null);
});
test("both lanes show optional unticked findings on preview with Send and retain optional assessment wording",async()=>{
  for(const pricingMode of ["managed_v20",undefined]){
    const html=await ejs.renderFile("views/quick-quote-preview.ejs",{q:{id:19,status:"Draft",total:100},p:{id:86,business_name:"Example"},input:{...plan,pricingMode},lines:[],hash:"test",preview:{report:{unfilled:[]}},error:null,job:null,stops:[{id:1,label:"Review finding",status:"Review"}],canApprove:true,user:{role:"owner"},mode:"dryrun",csrf:"test"});
    assert.ok(html.includes('data-send-label="Send"'));assert.ok(!html.includes('name="continue_anyway"'));assert.ok(!html.includes('name="reviewed"'));
    assert.match(html,/<input type="checkbox" name="stop_1" value="yes">/);
    assert.ok(html.includes("The free scripted assessment (BT-7.32) is optional and is not a stop condition."));
  }
});

test("plan UI keeps draft fields optional, displays plan length and the non-blocking assessment hint",async()=>{
  const html=await ejs.renderFile("views/bii-plan-fields.ejs",{biiInput:{...base(),...plan,assessed:false}});
  for(const name of ["regulatedPackage","operatingBusiness","pilotGroup","waveCount","waveBasis","waveDates","afterHoursWindows","assessed","assessmentDate"])assert.ok(html.includes(`name="${name}"`),name);
  assert.ok(!html.includes(" required"));assert.ok(html.includes("Plan length: 11 + W + 1 = 15 business days"));assert.ok(html.includes(optionalAssessmentHint));assert.ok(html.includes("no premium or additional price line"));
});

test("plan UI updates read-only schedule and assessment hint without making assessment mandatory",async()=>{
  const elements={"[data-operating-business]":{checked:true},"[data-assessed]":{checked:false},"[data-wave-count]":{value:"3"},"[data-operating-fields]":{},"[data-assessment-date]":{},"[data-assessment-hint]":{},"[data-bii-plan-length]":{}};
  const listeners={},panel={querySelector:s=>elements[s],addEventListener:(type,fn)=>{listeners[type]=fn;}};
  runInNewContext(await readFile("public/bii-quote-plan.js","utf8"),{document:{querySelectorAll:()=>[panel]}});
  assert.equal(elements["[data-bii-plan-length]"].textContent,"Plan length: 11 + W + 1 = 15 business days");
  assert.equal(elements["[data-assessment-hint]"].hidden,false);assert.equal(elements["[data-assessment-date]"].hidden,true);
  elements["[data-assessed]"].checked=true;elements["[data-wave-count]"].value="20";listeners.change();
  assert.equal(elements["[data-assessment-hint]"].hidden,true);assert.equal(elements["[data-assessment-date]"].hidden,false);
  assert.equal(elements["[data-bii-plan-length]"].textContent,"Plan length: 11 + W + 1 = 32 business days");
  elements["[data-operating-business]"].checked=false;listeners.input();assert.equal(elements["[data-operating-fields]"].hidden,true);
});
