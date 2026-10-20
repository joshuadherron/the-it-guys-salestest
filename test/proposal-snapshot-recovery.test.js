import test from "node:test";
import assert from "node:assert/strict";
import { ProposalStore, proposalApprovalSnapshot } from "../src/docfill/proposal-store.js";
import { snapshot } from "../src/docfill/delivery-store.js";

function harness(options={}) {
  const q={id:80,prospect_id:1,status:"Approved",quote_number:"Q-2026-080",inputs:{users:3,pricingMode:"managed_v20"},line_items:[{label:"Managed IT",amount:300}],total:"300.00",approved_at:"2026-10-20 10:00:00",document_facts:{legalName:"Example"}};
  const p={id:1,client_id:options.lock?"CL-1":null,hold:options.hold||false};
  const actor={email:"josh@theitguys.us",quote_send:1};
  const state={step:"record_requested",snapshot_hash:"stale-initial-baseline",...options.state};
  const queries=[],audits=[];
  if(options.unapproved)q.status="Draft";
  const store=new ProposalStore({sp:{},graph:{},deliveryStore:{},getProspect:async()=>p,tx:async fn=>fn({}),log:async(_c,_actor,action)=>audits.push(action),run:async(sql,args)=>{
    queries.push(sql);
    if(sql.startsWith("SELECT * FROM quotes"))return [q];
    if(sql.startsWith("SELECT * FROM allowlist"))return [actor];
    if(sql.startsWith("SELECT *,lease_until"))return [state];
    if(sql.startsWith("SELECT id FROM quote_fills"))return options.fills?[{id:1}]:[];
    if(sql.startsWith("SELECT id FROM quote_send_attempts"))return options.sends?[{id:2}]:[];
    if(sql.startsWith("SELECT client_id FROM quote_operation_locks"))return options.lock?[{client_id:"CL-1"}]:[];
    if(sql.startsWith("UPDATE quote_proposal_states SET snapshot_hash"))state.snapshot_hash=args[0];
    return {affectedRows:1};
  }});
  return {store,q,p,actor,state,queries,audits};
}

test("approval snapshot excludes quote-number assignment and editable Word facts",()=>{
  const h=harness(),hash=proposalApprovalSnapshot(h.q);
  h.q.quote_number="Q-2026-080-RENUMBERED";h.q.document_facts.legalName="Updated legal name";
  assert.equal(proposalApprovalSnapshot(h.q),hash);
  assert.notEqual(snapshot(h.q),snapshot({...h.q,quote_number:null}));
});
test("approval snapshot ignores JSON object key order but binds every pricing/approval field",()=>{
  const h=harness(),hash=proposalApprovalSnapshot(h.q);
  assert.equal(proposalApprovalSnapshot({...h.q,inputs:{pricingMode:"managed_v20",users:3},line_items:[{amount:300,label:"Managed IT"}]}),hash);
  for(const change of [{inputs:{...h.q.inputs,users:4}},{line_items:[{label:"Managed IT",amount:400}]},{total:"400.00"},{approved_at:"2026-10-20 11:00:00"}])
    assert.notEqual(proposalApprovalSnapshot({...h.q,...change}),hash);
});
test("an untouched failed initial preparation recovers without a new quote or deleting state",async()=>{
  const h=harness(),ctx=await h.store.acquire(h.q.id,h.actor);
  assert.equal(ctx.q.id,80);assert.equal(h.state.snapshot_hash,proposalApprovalSnapshot(h.q));
  assert.deepEqual(h.audits,["refresh proposal approval baseline"]);
  assert.ok(!h.queries.some(sql=>/DELETE|UPDATE quotes|INSERT INTO sp_requests/.test(sql)));
});
test("matching legacy pricing baseline upgrades while preserving all request/copy identities",async()=>{
  const h=harness({state:{step:"copy_ready",record_request_id:11,copy_request_id:12,working_item_id:"41"}});
  h.state.snapshot_hash=snapshot({...h.q,document_facts:null});
  await h.store.acquire(h.q.id,h.actor);
  assert.equal(h.state.snapshot_hash,proposalApprovalSnapshot(h.q));
  assert.equal(h.state.record_request_id,11);assert.equal(h.state.copy_request_id,12);assert.equal(h.state.working_item_id,"41");
  assert.ok(!h.queries.some(sql=>sql.startsWith("SELECT id FROM quote_fills")));
});
test("numbering changes after progress do not invalidate the new pricing baseline",async()=>{
  const h=harness({state:{step:"copy_ready",working_item_id:"41"}});
  h.state.snapshot_hash=proposalApprovalSnapshot(h.q);h.q.quote_number="Q-2026-999";
  await h.store.acquire(h.q.id,h.actor);assert.equal(h.audits.length,0);
});
for(const state of [
  {record_request_id:11},{record_sync_request_id:12},{copy_request_id:13},{working_item_id:"41"},{fill_id:14},{step:"filled"},
])test(`mismatch with existing progress ${JSON.stringify(state)} is refused with HTTP 409`,async()=>{
  const h=harness({state});
  await assert.rejects(()=>h.store.acquire(h.q.id,h.actor),e=>e.status===409&&/reconcile/.test(e.message));
  assert.equal(h.state.snapshot_hash,"stale-initial-baseline");assert.equal(h.audits.length,0);
});
for(const condition of ["fills","sends","lock"])test(`incomplete local flags cannot hide existing ${condition} history`,async()=>{
  const h=harness({[condition]:true});
  await assert.rejects(()=>h.store.acquire(h.q.id,h.actor),e=>e.status===409);
  assert.equal(h.audits.length,0);
});
for(const condition of ["hold","unapproved"])test(`recovery preserves ${condition} guard`,async()=>{
  const h=harness({[condition]:true});
  await assert.rejects(()=>h.store.acquire(h.q.id,h.actor),/Approved/);
  assert.equal(h.audits.length,0);assert.equal(h.state.snapshot_hash,"stale-initial-baseline");
});
