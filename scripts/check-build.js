// This application runs directly on Node. Build verifies deployable sources and
// templates; it neither starts the server nor contacts MySQL/SharePoint.
import { readdir,readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import ejs from "ejs";
import { assertTagset } from "../src/docfill/tagsets.js";
import { listTags } from "../src/docfill/fill-docx.js";
async function files(dir) {
  const result=[];
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const path=join(dir,entry.name);
    if(entry.isDirectory())result.push(...await files(path));else result.push(path);
  }
  return result;
}
const sources=["server.js",...await files("src"),...await files("public"),...await files("scripts")].filter(p=>p.endsWith(".js"));
for(const path of sources)execFileSync(process.execPath,["--check",path],{stdio:"pipe"});
const views=(await files("views")).filter(p=>p.endsWith(".ejs"));
for(const path of views)ejs.compile(await readFile(path,"utf8"),{filename:path});
for(const [key,name] of [["COM-PRP","COM-PRP-v1.8.docx"],["BII-QSOW","BII-QSOW-v1.6.docx"],["ENG-PRJ","ENG-PRJ-v1.0.docx"]])assertTagset(key,await listTags(await readFile(join("test","fixtures",name))));
console.log(`Production validation passed: ${sources.length} JavaScript sources, ${views.length} EJS views, both pinned legacy DOCX masters and ENG-PRJ v1.0. No transpilation is required.`);
