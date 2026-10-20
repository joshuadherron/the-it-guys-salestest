import "dotenv/config";
import { graph } from "../src/graph.js";
import { sitePath } from "../src/sharepoint.js";
// Explicit operator-run setup only; no startup/deployment writes.
const site=await graph.read(sitePath);
const lists=(await graph.all(`/sites/${site.id}/lists?$select=id,displayName`)).filter(l=>l.displayName==="Sales Prospects");
if(lists.length!==1)throw new Error("Expected one Sales Prospects list.");
const path=`/sites/${site.id}/lists/${lists[0].id}/columns`;
const columns=await graph.all(path);
const existing=columns.filter(c=>c.name==="TIGP_SharePointRecordID");
if(existing.length===1&&existing[0].text)console.log("Verified TIGP_SharePointRecordID text column.");
else if(existing.length)throw new Error("TIGP_SharePointRecordID exists with the wrong type. Josh must review it.");
else if(!process.argv.includes("--apply"))console.log("Missing TIGP_SharePointRecordID. Review the flow instructions, then rerun with --apply to add the text column.");
else {
  const column=await graph.request(path,"POST",{name:"TIGP_SharePointRecordID",displayName:"SharePoint Record ID",text:{allowMultipleLines:false,maxLength:80}});
  if(column?.name!=="TIGP_SharePointRecordID")throw new Error("SharePoint returned a different internal name. Review it before enabling field sync.");
  console.log("Created TIGP_SharePointRecordID. Run Admin connection check before field sync.");
}
