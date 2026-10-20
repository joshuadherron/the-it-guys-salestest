import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SharePointQuotes } from "../src/docfill/sharepoint-quotes.js";
const names={
  "COM-PRP":["COM-PRP-v1.8.docx","The_IT_Guys_Managed_IT_Quote_Template_v1.8.docx"],
  "BII-QSOW":["BII-QSOW-v1.6.docx","The_IT_Guys_BII_Short_Form_Quote_SOW_Template_v1.6.docx"],
};
function harness(key,name) {
  const rows=[{fields:{TIG_DocumentKey:key,TIG_Status:"Approved"},driveItem:{id:"template",name,parentReference:{driveId:"masters"}}}];
  const events=[];
  const graph={all:async path=>path.endsWith("/columns")?[{name:"TIG_DocumentKey",displayName:"Document Key"},{name:"TIG_Status",displayName:"Status"}]:path.includes("/items?")?rows:[{id:"library",displayName:"Operational Standards & Templates"}],quoteContent:async(drive,id)=>{events.push([drive,id]);return readFile(new URL(`./fixtures/${names[key][0]}`,import.meta.url));}};
  const resolver=new SharePointQuotes({ready:()=>({siteId:"site"})},graph,{});
  return {rows,graph,events,resolver};
}
for(const [key,aliases] of Object.entries(names)) {
  for(const name of aliases)test(`resolves the approved pinned ${name} with tag validation`,async()=>{
    const h=harness(key,name),master=await h.resolver.master(key);
    assert.equal(master.name,name);assert.equal(master.documentKey,key);assert.deepEqual(h.events,[["masters","template"]]);
  });
  test(`${key} refuses duplicates across the long and package filenames`,async()=>{
    const h=harness(key,aliases[0]);h.rows.push({...h.rows[0],driveItem:{...h.rows[0].driveItem,id:"duplicate",name:aliases[1]}});
    await assert.rejects(()=>h.resolver.master(key),/found 2/);assert.equal(h.events.length,0);
  });
  test(`${key} refuses Draft despite a matching pinned filename`,async()=>{
    const h=harness(key,aliases[1]);h.rows[0].fields.TIG_Status="Draft";
    await assert.rejects(()=>h.resolver.master(key),/found 0/);assert.equal(h.events.length,0);
  });
  test(`${key} refuses older and unapproved filename variants`,async()=>{
    for(const name of [aliases[1].replace(key==="COM-PRP"?"v1.8":"v1.6","v1.5"),aliases[1].replace(".docx","_DRAFT.docx")]){
      const h=harness(key,name);await assert.rejects(()=>h.resolver.master(key),/Expected filename/);assert.equal(h.events.length,0);
    }
  });
  test(`${key} still rejects a different tag set in an Approved matching filename`,async()=>{
    const h=harness(key,aliases[1]);h.graph.quoteContent=async()=>readFile(new URL(`./fixtures/${names[key==="COM-PRP"?"BII-QSOW":"COM-PRP"][0]}`,import.meta.url));
    await assert.rejects(()=>h.resolver.master(key),/tag/i);
  });
}
