import { quoteLane } from "./policy.js";
import { assertNoPending } from "../sharepoint.js";
export class SharePointQuotes {
  constructor(sp,graph,env=process.env){this.sp=sp;this.graph=graph;this.env=env;}
  async working(prospect,key,quoteId,itemId){
    const schema=this.sp.ready();
    if(!prospect.client_id||!await this.sp.client(prospect))throw new Error("The linked SharePoint client could not be read.");
    const workflow=key==="COM-PRP"?"MIT-05":"BII-05";
    const allItems=await this.sp.workItems(prospect.client_id,true);
    assertNoPending(await this.sp.requests(),schema,{...prospect,work_item_ids:allItems.map(i=>i.id)});
    const items=allItems.filter(i=>i.workflowId===workflow&&i.clientId===prospect.client_id&&!["Complete","Cancelled","Not Required"].includes(i.status) && (!quoteId || String(i.instanceRef)===String(quoteId)));
    if(itemId){
      const found=[];
      for(const item of items){
        const row=await this.graph.read(`/sites/${schema.siteId}/lists/${schema.clientOpsId}/items/${encodeURIComponent(item.id)}?$expand=fields,driveItem`);
        if(row.driveItem?.id===itemId)found.push(item);
      }
      items.splice(0,items.length,...found);
    }
    if(items.length!==1)throw new Error("Expected exactly one open quote working copy for this client.");
    const item=items[0];
    if(key==="BII-QSOW"&&item.signatureStatus!=="Preparing")throw new Error("BII quote signature preparation has already started.");
    const row=await this.graph.read(`/sites/${schema.siteId}/lists/${schema.clientOpsId}/items/${encodeURIComponent(item.id)}?$expand=fields,driveItem`);
    if(row.fields?.TIG_ClientID!==prospect.client_id||row.fields?.TIG_WorkflowID!==workflow||["Complete","Cancelled","Not Required"].includes(row.fields?.TIG_CompletionStatus))throw new Error("Quote working copy changed or belongs to another client.");
    if(quoteId && (!schema.quoteInstanceColumn || String(row.fields?.[schema.quoteInstanceColumn])!==String(quoteId)))throw new Error("Quote instance reference changed. Check the verified Client Operations instance reference column.");
    if(key==="BII-QSOW"&&row.fields?.TIG_SignatureStatus!=="Preparing")throw new Error("BII signature preparation started before fill. Reload and review.");
    const drive=row.driveItem;
    if(!drive?.id||!drive.parentReference?.driveId||!drive.name?.toLowerCase().endsWith(".docx"))throw new Error("Working quote is missing its resolved Word drive item.");
    const fresh=await this.graph.read(`/drives/${encodeURIComponent(drive.parentReference.driveId)}/items/${encodeURIComponent(drive.id)}`);
    const folder=await this.graph.read(`/drives/${encodeURIComponent(drive.parentReference.driveId)}/items/${encodeURIComponent(fresh.parentReference?.id)}`);
    if(!folder.folder||folder.name!=="Commercial")throw new Error("The quote must be in the client's Commercial folder.");
    if(!fresh.eTag)throw new Error("The working quote is missing its eTag.");
    return {...fresh,driveId:drive.parentReference.driveId,itemId:drive.id,folderId:folder.id,workflowId:workflow,status:"Open",signatureStatus:item.signatureStatus};
  }
  async resolve(quote,prospect,key,quoteId){
    quoteLane(quote.inputs,key);
    const working=await this.working(prospect,key,quoteId);
    return {working,master:await this.master(key)};
  }
  async master(key){
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
    const rows=(await this.graph.all(`/sites/${schema.siteId}/lists/${list.id}/items?$expand=fields,driveItem`)).filter(r=>r.fields?.[keyColumn]===key&&r.fields?.[statusColumn]==="Approved"&&r.driveItem?.name===(key==="COM-PRP"?"COM-PRP-v1.8.docx":"BII-QSOW-v1.6.docx"));
    if(rows.length!==1)throw new Error("Expected exactly one promoted Approved master of the pinned quote version.");
    const row=rows[0],d=row.driveItem;
    if(!d.id||!d.parentReference?.driveId)throw new Error("Approved master drive item is unavailable.");
    const content=await this.graph.quoteContent(d.parentReference.driveId,d.id);
    return {documentKey:key,status:"Approved",name:d.name,content};
  }
}
