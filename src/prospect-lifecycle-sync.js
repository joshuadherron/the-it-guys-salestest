import { query } from "./db.js";
import { dispatchProspectSync } from "./prospect-sync.js";
// Called only after a successful work-items read and current Clients stage read.
export async function observeLifecycle(p,stage,deps={query,sync:dispatchProspectSync}) {
  if(!p.client_id || !stage || p.sharepoint_stage===stage)return;
  await deps.query("UPDATE prospects SET sharepoint_record_id=?,sharepoint_stage=? WHERE id=?",[p.client_id,stage,p.id]);
  Object.assign(p,{sharepoint_record_id:p.client_id,sharepoint_stage:stage});
  await deps.sync(p,deps.actor || {email:"system"});
}
