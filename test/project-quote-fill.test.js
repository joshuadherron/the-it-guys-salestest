import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { fillDocx,listTags } from "../src/docfill/fill-docx.js";
import { assertTagset } from "../src/docfill/tagsets.js";
import { buildProjectFill } from "../src/docfill/project-fields.js";
import { projectDocument,projectCapability } from "../src/project-contract.js";
import { projectLane } from "../src/engagement-types.js";
import { masterNames,projectQuoteMaster } from "../src/docfill/master-names.js";
import { SharePointQuotes } from "../src/docfill/sharepoint-quotes.js";

const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const fixture=new URL("./fixtures/ENG-PRJ-v1.0.docx",import.meta.url);
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const nodes=(node,name)=>Array.from(node.getElementsByTagNameNS(W,name));
const text=node=>nodes(node,"t").map(t=>t.textContent).join("");
async function documentXml(bytes){const zip=await JSZip.loadAsync(bytes);return new DOMParser().parseFromString(await zip.file("word/document.xml").async("string"),"text/xml");}
const sample={
  prospect:{business_name:"Example Project Customer",contact_name:"Pat Owner"},
  quote:{id:19,quote_number:"Q-2026-019",approved_at:"2026-10-16T01:33:00Z",inputs:{
    pricingMode:"project_v1",basis:"fixed",scope:"First deliverable\r\nSecond deliverable",
    exclusions:"",assumptions:"Admin access\nApproved maintenance window",
    terms:"Owner-approved sample terms\nWritten acceptance required",
    lines:[
      {label:"Assessment",kind:"labor",quantity:1,unitPrice:1118,billing:"one_time"},
      {label:"Deployment",kind:"deliverable",quantity:2,unitPrice:1234.5,billing:"one_time"},
      {label:"Archive access",kind:"other",quantity:1,unitPrice:5000,billing:"monthly"},
    ],
  }},
};

test("ENG-PRJ fixture is the exact supplied master and has the approved 21 distinct tags",async()=>{
  const bytes=await readFile(fixture);
  assert.equal(hash(bytes),"63b1dd08131d0f9d179562630a173db50dfa2b7c3275887ac140cff96712bfe7");
  const tags=await listTags(bytes);assert.equal(tags.length,21);assertTagset("ENG-PRJ",tags);
});

test("supplied project master fills completely, repeats three rows and never changes its original bytes",async()=>{
  const master=await readFile(fixture),original=Buffer.from(master);
  const data=buildProjectFill(sample),result=await fillDocx(master,data);
  assert.deepEqual(result.report.unfilled,[]);assert.deepEqual(await listTags(result.buffer),[]);
  assert.ok(result.report.repeated.includes("REPEAT.Line x3"));
  const doc=await documentXml(result.buffer),rows=nodes(doc,"tr");
  for(const line of sample.quote.inputs.lines)assert.equal(rows.filter(r=>nodes(r,"t").some(t=>t.textContent===line.label)).length,1,line.label);
  assert.equal(rows.filter(r=>sample.quote.inputs.lines.some(l=>nodes(r,"t").some(t=>t.textContent===l.label))).length,3);
  assert.ok(text(doc).includes("$3,587.00"));assert.ok(text(doc).includes("$5,000.00"));assert.ok(!text(doc).includes("$$"));
  assert.deepEqual(master,original);assert.deepEqual(await readFile(fixture),original);
});

test("blank project exclusions remove only their paragraph, preserving heading and fixed sentence",async()=>{
  const master=await readFile(fixture);
  const original=await documentXml(master),originalParagraphs=nodes(original,"p");
  const exclusionIndex=originalParagraphs.findIndex(p=>nodes(p,"tag").some(t=>t.getAttributeNS(W,"val")==="ENG.Exclusions"));
  assert.equal(text(originalParagraphs[exclusionIndex-1]),"Not included");
  const fixedSentence=text(originalParagraphs[exclusionIndex+1]);assert.ok(fixedSentence.startsWith("Unless it appears in the quote lines above"));
  const blank=await documentXml((await fillDocx(master,buildProjectFill(sample))).buffer);
  const data=buildProjectFill(sample);data.fields["ENG.Exclusions"]="CUSTOM EXCLUSION SENTINEL";
  const populated=await documentXml((await fillDocx(master,data)).buffer);
  assert.equal(nodes(blank,"p").length,nodes(populated,"p").length-1);
  const paragraphs=nodes(blank,"p").map(text),heading=paragraphs.indexOf("Not included");
  assert.equal(paragraphs[heading+1],fixedSentence);assert.ok(!text(blank).includes("[Approved exclusions]"));
});

test("inline fills emit real line breaks in one styled run and preserve empty lines and escaping",async()=>{
  const zip=new JSZip();zip.file("word/document.xml",`<w:document xmlns:w="${W}"><w:body><w:p><w:sdt><w:sdtPr><w:tag w:val="MIT.SummaryText"/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:b/><w:color w:val="123456"/></w:rPr><w:t>placeholder</w:t></w:r></w:sdtContent></w:sdt></w:p></w:body></w:document>`);
  const result=await fillDocx(await zip.generateAsync({type:"nodebuffer"}),{fields:{"MIT.SummaryText":"First <&>\r\nSecond\n\nFourth\n"}});
  const doc=await documentXml(result.buffer),runs=nodes(doc,"r");assert.equal(runs.length,1);
  assert.deepEqual(nodes(runs[0],"t").map(t=>t.textContent),["First <&>","Second","","Fourth",""]);
  assert.equal(nodes(runs[0],"br").length,4);assert.equal(nodes(runs[0],"b").length,1);
  assert.equal(nodes(runs[0],"color")[0].getAttributeNS(W,"val"),"123456");
  for(const t of nodes(runs[0],"t"))assert.equal(t.getAttribute("xml:space"),"preserve");
});

test("project fixture scope, assumptions and terms retain multiline values as Word breaks",async()=>{
  const result=await fillDocx(await readFile(fixture),buildProjectFill(sample));
  const doc=await documentXml(result.buffer);
  for(const [first,second] of [["First deliverable","Second deliverable"],["Admin access","Approved maintenance window"],["Owner-approved sample terms","Written acceptance required"]]){
    const p=nodes(doc,"p").find(p=>nodes(p,"t").some(t=>t.textContent===first));
    assert.ok(p,first);assert.equal(nodes(p,"br").length,1);assert.ok(nodes(p,"t").some(t=>t.textContent===second));
  }
});

test("all ENG and Line money fields use US thousands separators and two decimals",()=>{
  const data=buildProjectFill(sample);
  assert.equal(data.fields["ENG.OneTimeTotal"],"$3,587.00");assert.equal(data.fields["ENG.MonthlyTotal"],"$5,000.00");
  assert.equal(data.repeats["REPEAT.Line"][0]["Line.UnitPrice"],"$1,118.00");assert.equal(data.repeats["REPEAT.Line"][0]["Line.Amount"],"$1,118.00");
  assert.equal(data.repeats["REPEAT.Line"][1]["Line.UnitPrice"],"$1,234.50");assert.equal(data.repeats["REPEAT.Line"][1]["Line.Amount"],"$2,469.00");
  const hourly=buildProjectFill({...sample,quote:{...sample.quote,inputs:{...sample.quote.inputs,pricingMode:"hourly_v1",estimatedHours:2,hourlyRate:1118.5,minimumHours:3,lines:[]}}});
  assert.equal(hourly.fields["ENG.HourlyRate"],"$1,118.50");assert.equal(hourly.fields["ENG.OneTimeTotal"],"$3,355.50");assert.equal(hourly.fields["ENG.MonthlyTotal"],"$0.00");
});

test("project issue date uses Chicago evening date for ISO and UTC SQL timestamps across DST",()=>{
  for(const approved_at of ["2026-10-16T01:33:00Z","2026-10-16 01:33:00",new Date("2026-10-16T01:33:00Z")])assert.equal(buildProjectFill({...sample,quote:{...sample.quote,approved_at}}).fields["ENG.IssueDate"],"2026-10-15");
  assert.equal(buildProjectFill({...sample,quote:{...sample.quote,approved_at:"2026-12-16 05:33:00"}}).fields["ENG.IssueDate"],"2026-12-15");
  for(const approved_at of [undefined,null,"","invalid date"])assert.throws(()=>buildProjectFill({...sample,quote:{...sample.quote,approved_at}}),/Invalid quote/);
});

test("ENG-PRJ metadata is pinned with legacy master names and ignores retired environment overrides",()=>{
  assert.equal(projectLane,"Business Technology Projects");
  const spec=projectDocument("ENG-PRJ",{PROJECT_QUOTE_MASTER_FILENAME:"wrong.docx",PROJECT_QUOTE_WORKFLOW_ID:"MIT-05",PROJECT_QUOTE_TEMPLATE_VERSION:"v99"});
  assert.equal(spec.name,"The_IT_Guys_Project_Quote_SOW_Template_v1.0.docx");assert.equal(spec.workflow,"PRJ-05");assert.equal(spec.template,"v1.0");assert.equal(spec.lane,projectLane);
  assert.deepEqual(masterNames["ENG-PRJ"],[spec.name]);assert.equal(projectQuoteMaster.name,spec.name);
});

test("capability checks require the existing Business Technology Projects choice, not the old invented lane",()=>{
  const schema=lane=>({definitions:[{id:"PRJ-05",lane:projectLane,active:true,createCopy:true}],businessColumn:"TIG_SalesBusinessID",maps:{requests:{"Service Lane":{choice:{choices:[lane]}}},clients:{"Service Lanes":{choice:{choices:[lane]}}}}});
  assert.deepEqual(projectCapability(schema(projectLane)),[]);
  assert.equal(projectCapability(schema("Project-Based")).filter(e=>e.includes("choice")).length,2);
  assert.ok(projectCapability({...schema(projectLane),definitions:[]}).some(e=>e.includes("Activate PRJ-05")));
});

test("pinned project resolver reads only its exact Approved master and rejects draft, wrong-version and duplicate candidates",async()=>{
  const master=await readFile(fixture);
  const row={fields:{Key:"ENG-PRJ",Status:"Approved"},driveItem:{id:"doc",name:projectQuoteMaster.name,parentReference:{driveId:"drive"}}};
  let rows=[row],reads=0;
  const resolver=new SharePointQuotes({ready:()=>({siteId:"site"})},{all:async path=>path.endsWith("/columns")?[{name:"Key",displayName:"Document Key"},{name:"Status",displayName:"Status"}]:path.includes("/items?")?rows:[{id:"library",displayName:"Operational Standards & Templates"}],quoteContent:async()=>{reads++;return master;}},{});
  assert.equal((await resolver.master("ENG-PRJ")).name,projectQuoteMaster.name);
  for(const invalid of [[{...row,fields:{Key:"ENG-PRJ",Status:"Draft"}}],[{...row,driveItem:{...row.driveItem,name:"unapproved.docx"}}],[row,{...row,driveItem:{...row.driveItem,id:"other"}}]]){
    rows=invalid;await assert.rejects(()=>resolver.master("ENG-PRJ"),/Expected exactly one/);
  }
  assert.equal(reads,1);
});
