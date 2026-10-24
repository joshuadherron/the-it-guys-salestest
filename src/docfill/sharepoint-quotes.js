import { quoteLane } from "./policy.js";
import { assertNoPending } from "../sharepoint.js";
import { assertTagset } from "./tagsets.js";
import { listTags } from "./fill-docx.js";
import { projectDocument,projectDocumentKeys,assertProjectCapability } from "../project-contract.js";
import { masterNames } from "./master-names.js";
import { missingCopy } from './copy-visibility.js';
export class SharePointQuotes {
  constructor(sp,graph,env=process.env,debug=console.debug){this.sp=sp;this.graph=graph;this.env=env;this.debug=details=>{if(env.LOG_LEVEL==='debug')debug('quote working copy',details);};}
  async working(prospect,key,quoteId,itemId){
    const schema=this.sp.ready();
    if(!prospect.client_id||!await this.sp.client(prospect))throw new Error("The linked SharePoint client could not be read.");
    const generic=projectDocumentKeys.includes(key);
    if(generic)assertProjectCapability(schema);
    const workflow=generic?projectDocument(key,this.env).workflow:key==="COM-PRP"?"MIT-05":"BII-05";
    const allItems=await this.sp.workItems(prospect.client_id,true);
    let items=allItems;
    for(const [filter,predicate] of [['workflow',i=>i.workflowId===workflow],['client',i=>i.clientId===prospect.client_id],['status',i=>!["Complete","Cancelled","Not Required"].includes(i.status)]]){
      items=items.filter(predicate);this.debug({workflow,quoteId,filter,count:items.length});
    }
    const open=items;
    items=items.filter(i=>quoteId?String(i.instanceRef)===String(quoteId):!i.instanceRef);
    this.debug({workflow,quoteId,filter:'instance',count:items.length});
    // Instance identity is authoritative. Only genuinely unnumbered legacy files
    // may fall back to the saved drive item; never adopt a different Quote ID.
    if(itemId&&(!quoteId||!items.length)){
      const found=[];
      for(const item of open.filter(i=>!i.instanceRef)){
        const row=await this.graph.read(`/sites/${schema.siteId}/lists/${schema.clientOpsId}/items/${encodeURIComponent(item.id)}?$expand=fields,driveItem`);
        this.debug({filter:'legacy drive item',listItemId:item.id,driveItemId:row.driveItem?.id,savedItemId:itemId});
        if(String(row.driveItem?.id)===String(itemId))found.push(item);
      }
      items=found;
    }
    if(!items.length)throw missingCopy();
    if(items.length!==1)throw new Error("Expected exactly one open quote working copy for this client.");
    const item=items[0];
    const instance=quoteId||item.instanceRef;
    const pending=(await this.sp.requests()).filter(r=>!isProspectSync(r,schema));
    assertNoPending(instance?pending.filter(r=>requestMatchesQuote({fields:r.fields},prospect,instance,item.id)):pending,schema,{...prospect,work_item_ids:[item.id]});
    if(key==="BII-QSOW"&&item.signatureStatus!=="Preparing")throw new Error("BII quote signature preparation has already started.");
    const row=await this.graph.read(`/sites/${schema.siteId}/lists/${schema.clientOpsId}/items/${encodeURIComponent(item.id)}?$expand=fields,driveItem`);
    if(!row.fields?.TIG_ClientID||!row.fields?.TIG_WorkflowID)throw missingCopy();
    if(row.fields?.TIG_ClientID!==prospect.client_id||row.fields?.TIG_WorkflowID!==workflow||["Complete","Cancelled","Not Required"].includes(row.fields?.TIG_CompletionStatus))throw new Error("Quote working copy changed or belongs to another client.");
    if(item.instanceRef&&quoteId&&schema.quoteInstanceColumn&&!row.fields?.[schema.quoteInstanceColumn])throw missingCopy();
    if(item.instanceRef && quoteId && (!schema.quoteInstanceColumn || String(row.fields?.[schema.quoteInstanceColumn])!==String(quoteId)))throw new Error("Quote instance reference changed. Check the verified Client Operations instance reference column.");
    if(!item.instanceRef&&schema.quoteInstanceColumn&&row.fields?.[schema.quoteInstanceColumn])throw new Error("Legacy quote acquired a different instance reference. Reload and review.");
    if(key==="BII-QSOW"&&row.fields?.TIG_SignatureStatus!=="Preparing")throw new Error("BII signature preparation started before fill. Reload and review.");
    const drive=row.driveItem;
    this.debug({filter:'resolved drive item',listItemId:item.id,driveItemId:drive?.id,savedItemId:itemId});
    if(itemId&&String(drive?.id)!==String(itemId))throw new Error("The working quote differs from the latest fill.");
    if(!drive?.id||!drive.parentReference?.driveId||!drive.name?.toLowerCase().endsWith(".docx"))throw new Error("Working quote is missing its resolved Word drive item.");
    const fresh=await this.graph.read(`/drives/${encodeURIComponent(drive.parentReference.driveId)}/items/${encodeURIComponent(drive.id)}`);
    const folder=await this.graph.read(`/drives/${encodeURIComponent(drive.parentReference.driveId)}/items/${encodeURIComponent(fresh.parentReference?.id)}`);
    if(!folder.folder||folder.name!=="Commercial")throw new Error("The quote must be in the client's Commercial folder.");
    if(!fresh.eTag)throw new Error("The working quote is missing its eTag.");
    const fields=Object.fromEntries(['Title','TIG_ClientID','TIG_WorkflowID',schema.quoteInstanceColumn].filter(Boolean).map(key=>[key,row.fields[key]??'']));
    const fieldsPath=`/sites/${schema.siteId}/lists/${schema.clientOpsId}/items/${encodeURIComponent(item.id)}/fields`;
    return {...fresh,driveId:drive.parentReference.driveId,itemId:drive.id,folderId:folder.id,workflowId:workflow,status:"Open",signatureStatus:item.signatureStatus,sharepoint:{fieldsPath,fields}};
  }
  async resolve(quote,prospect,key,quoteId){
    quoteLane(quote.inputs,key,this.env);
    const working=await this.working(prospect,key,quoteId);
    return {working,master:await this.master(key)};
  }
  async master(key){
    const names=key==="ENG-HRLY"?[projectDocument(key,this.env).name]:masterNames[key];
    if(!names)throw new Error("Unsupported quote master key.");
    const schema=this.sp.ready();
    const lists=await this.graph.all(`/sites/${schema.siteId}/lists?$select=id,displayName`);
    const matches=lists.filter(l=>l.displayName==="Operational Standards & Templates");
    if(matches.length!==1)throw new Error("Approved master library is missing or ambiguous.");
    const list=matches[0],columns=await this.graph.all(`/sites/${schema.siteId}/lists/${list.id}/columns`);
    const column=(configured,display)=>{
      const found=columns.filter(c=>configured?c.name===configured:c.displayName===display);
      if(found.length!==1)throw new Error(`Master ${display} column is missing or ambiguous. Configure its verified internal column name.`);
      return found[0].name;
    };
    const keyColumn=column(this.env.QUOTE_MASTER_KEY_COLUMN,"Document Key"),statusColumn=column(this.env.QUOTE_MASTER_STATUS_COLUMN,"Status");
    const candidates=(await this.graph.all(`/sites/${schema.siteId}/lists/${list.id}/items?$expand=fields,driveItem`)).filter(r=>r.fields?.[keyColumn]===key&&r.fields?.[statusColumn]==="Approved");
    const rows=candidates.filter(r=>names.includes(r.driveItem?.name));
    if(rows.length!==1)throw new Error(`Expected exactly one promoted Approved ${key} master of the pinned quote version; found ${rows.length}. Expected filename: ${names.join(" or ")}. Approved filenames found: ${candidates.map(r=>r.driveItem?.name||"(no drive item)").join(", ")||"none"}.`);
    const row=rows[0],d=row.driveItem;
    if(!d.id||!d.parentReference?.driveId)throw new Error("Approved master drive item is unavailable.");
    const content=await this.graph.quoteContent(d.parentReference.driveId,d.id);
    assertTagset(key,await listTags(content));
    return {documentKey:key,status:"Approved",name:d.name,content};
  }
}
import { requestMatchesQuote,isProspectSync } from "../quote-request-scope.js";
