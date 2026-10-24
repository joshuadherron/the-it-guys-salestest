import { createHash } from "node:crypto";
import { query,audit } from "./db.js";
import { integer,fail } from "./security.js";
export const businessNameKey = name => createHash("sha256").update(String(name).trim().toLowerCase()).digest("hex");

// Caller holds an opportunity transaction. Names are duplicate-review signals,
// never authority to silently combine two existing companies.
export async function attachBusiness(p,requestedId,user,c,storage={query,audit}) {
  const run=storage.query;
  let business;
  if(requestedId) {
    [business]=await run("SELECT * FROM businesses WHERE id=? FOR UPDATE",[integer(requestedId)],c);
    if(!business)fail("Business not found. Select an existing business or create a new one.",404);
    if(p.business_id&&String(p.business_id)!==String(business.id)&&p.client_id)fail("A linked opportunity retains its business identity. Open a new opportunity under the correct business.",409);
    if(p.client_id&&business.client_id&&p.client_id!==business.client_id)fail("These opportunities have different SharePoint customer IDs. An admin must reconcile them before linking.",409);
  } else {
    const key=businessNameKey(p.business_name);
    await run("INSERT IGNORE INTO business_identity_locks (name_key) VALUES (?)",[key],c);
    await run("SELECT name_key FROM business_identity_locks WHERE name_key=? FOR UPDATE",[key],c);
    const matches=await run("SELECT id FROM businesses WHERE name_key=?",[key],c);
    if(matches.length&&!storage.legacyImport)fail("A business with this name already exists. Select it in Existing business to add another opportunity; do not create a duplicate.",409);
    const r=await run("INSERT INTO businesses (name,name_key,contact_name,email,phone,street_address,city,state,zip,client_id,client_item_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",[p.business_name,key,p.contact_name||"",p.email||"",p.phone||"",p.street_address||null,p.city||null,p.state||null,p.zip||null,p.client_id||null,p.client_item_id||null],c);
    business={id:r.insertId,name:p.business_name,client_id:p.client_id||null,client_item_id:p.client_item_id||null};
    await storage.audit(c,user,"create business","business",business.id);
  }
  await run("UPDATE prospects SET business_id=?,business_name=?,client_id=COALESCE(client_id,?),client_item_id=COALESCE(client_item_id,?),sharepoint_record_id=COALESCE(sharepoint_record_id,?),relationship_type=CASE WHEN ? IS NOT NULL THEN 'existing_client' ELSE relationship_type END WHERE id=?",[business.id,business.name,business.client_id||null,business.client_item_id||null,business.client_id||null,business.client_id||null,p.id],c);
  await storage.audit(c,user,"link opportunity to business "+business.id,"prospect",p.id);
  if(p.client_id&&!business.client_id)await linkBusinessRecord({...p,business_id:business.id},p.client_id,p.client_item_id,c,run);
  return business;
}

export async function linkBusinessRecord(p,clientId,itemId,c,run=query) {
  if(!p.business_id)return;
  const [business]=await run("SELECT * FROM businesses WHERE id=? FOR UPDATE",[p.business_id],c);
  if(!business)fail("Business identity is missing.",409);
  if(business.client_id&&business.client_id!==clientId)fail("Business is already linked to a different SharePoint customer. Reconcile the relationship.",409);
  const conflicts=await run("SELECT id FROM businesses WHERE client_id=? AND id<>?",[clientId,p.business_id],c);
  if(conflicts.length)fail("This SharePoint customer belongs to another business in the app. Select that business for the opportunity before linking; an admin must reconcile commercial history first.",409);
  await run("UPDATE businesses SET client_id=?,client_item_id=? WHERE id=?",[clientId,itemId,p.business_id],c);
  await run("UPDATE prospects SET client_id=?,client_item_id=?,sharepoint_record_id=? WHERE business_id=? AND NULLIF(client_id,'') IS NULL",[clientId,itemId,clientId,p.business_id],c);
}

export async function lockBusinessRequests(p,run,c,own=[],quoteId) {
  if(!p.business_id)return;
  const [b]=await run("SELECT * FROM businesses WHERE id=? FOR UPDATE",[p.business_id],c);
  if(!b)fail("Business identity is missing.",409);
  if(b.client_id&&!p.client_id)Object.assign(p,{client_id:b.client_id,client_item_id:b.client_item_id,sharepoint_record_id:b.client_id});
  const active=await run("SELECT r.id,r.prospect_id,r.action,r.request_json FROM sp_requests r JOIN prospects p ON p.id=r.prospect_id WHERE p.business_id=? AND (r.status IN ('Preparing','Pending','Processing','Unknown') OR (r.action='CreateClient' AND r.status='Done' AND NULLIF(p.client_id,'') IS NULL))",[p.business_id],c);
  if(active.some(r=>r.action!=='UpsertProspect'&&(!quoteId||!r.prospect_id||String(r.prospect_id)===String(p.id)||requestMatchesQuote(r.request_json,p,quoteId)||(!p.client_id&&r.action==='CreateClient'))&&!own.some(id=>String(id)===String(r.id))))fail("A SharePoint request for this business is active, uncertain or awaiting linkage. Reconcile it before continuing.",409);
}
import { requestMatchesQuote } from "./quote-request-scope.js";
