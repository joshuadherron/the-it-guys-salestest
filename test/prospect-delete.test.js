import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import { prospectDeleteRoutes } from "../src/prospect-delete.js";
const tables=["activities","discoveries","discovery_versions","additional_service_discoveries","notifications","sp_requests","quotes","quote_fills","quote_send_attempts","quote_proposal_states"];
function harness(options={}) {
  let data={counts:Object.fromEntries(tables.map(t=>[t,t==="quotes"?2:1])),deleted:false,audits:[]};
  const p={id:80,business_name:"Example <script>bad</script>",client_id:options.linked?"CL-80":null,updated_at:"2026-10-20 12:00:00"};
  const user={email:"admin@example.test",role:"sales",is_admin:1,enabled:1,...options.user};
  const queries=[],routes=new Map(),deletes=[];
  const query=async(sql,args,c)=>{
    queries.push(sql);
    if(sql.startsWith("SELECT * FROM prospects"))return data.deleted?[]:[p];
    if(sql.startsWith("SELECT * FROM allowlist"))return options.revoked?[]:[user];
    if(sql.startsWith("SELECT COUNT(*)")){const table=sql.match(/FROM (\w+)/)[1];return [{total:data.counts[table]}];}
    if(sql.startsWith("SELECT id FROM sp_requests"))return options.block==="request"?[{id:1}]:[];
    if(sql.startsWith("SELECT id FROM notifications"))return options.block==="notification"?[{id:1}]:[];
    if(sql.startsWith("SELECT s.quote_id"))return options.block==="preparation"?[{quote_id:11}]:[];
    if(sql.startsWith("SELECT f.id"))return options.block==="fill"?[{id:1}]:[];
    if(sql.startsWith("SELECT a.id"))return options.block==="send"?[{id:1}]:[];
    if(sql.startsWith("SELECT client_id FROM quote_operation_locks"))return options.block==="lock"?[{client_id:"CL-80"}]:[];
    if(sql.startsWith("SELECT id FROM quotes"))return [{id:11},{id:12}];
    if(sql.includes("client_request_locks"))return [];
    if(sql.startsWith("DELETE FROM")) {
      assert.ok(c,"deletions must use a transaction");assert.deepEqual(args,[80]);
      const table=sql.match(/DELETE FROM (\w+)/)[1];deletes.push(table);
      if(table===options.failTable)throw new Error("database failure");
      if(table==="quote_fills")assert.equal(data.counts.quote_send_attempts,0);
      if(table==="quotes")for(const t of ["quote_fills","quote_send_attempts","quote_proposal_states"])assert.equal(data.counts[t],0);
      if(table==="prospects"){for(const t of tables)assert.equal(data.counts[t],0);data.deleted=true;}
      else data.counts[table]=0;
      return {affectedRows:1};
    }
    throw new Error("Unexpected query: "+sql);
  };
  prospectDeleteRoutes({get:(path,...handlers)=>routes.set("GET "+path,handlers),post:(path,...handlers)=>routes.set("POST "+path,handlers)}, {
    query,transaction:async fn=>{const before=structuredClone(data);try{return await fn({transaction:true});}catch(e){data=before;throw e;}},
    audit:async(c,actor,action,entity,id)=>{assert.ok(c);data.audits.push({actor:actor.email,action,entity,id});},
  });
  const req={params:{id:"80"},session:{user},body:{}},res={code:200,status(code){this.code=code;return this;},send(message){this.message=message;},render(view,locals){this.view=view;this.locals=locals;},redirect(url){this.redirected=url;}};
  const call=async method=>{for(const handler of routes.get(method+" /prospects/:id/delete")){let next=false;await handler(req,res,()=>{next=true;});if(!next)break;}};
  const review=async()=>{await call("GET");req.body={confirmation:"OPP-0080",confirm_history:"yes"};};
  return {req,res,call,review,queries,deletes,options,p,get data(){return data;}};
}

test("admin with sales role can delete the local prospect and dependent history in FK order",async()=>{
  const h=harness({linked:true});await h.review();await h.call("POST");
  assert.equal(h.data.deleted,true);assert.equal(h.res.redirected,"/pipeline");assert.equal(h.data.audits.length,2);
  assert.match(h.data.audits[0].action,/delete prospect OPP-0080/);
  assert.ok(h.queries.includes("SELECT client_id FROM client_request_locks WHERE client_id=? FOR UPDATE"));
  assert.equal(h.deletes.at(-1),"prospects");
  assert.ok(!h.deletes.includes("audit_log"));assert.ok(!h.deletes.includes("client_request_locks"));
});
for(const user of [{is_admin:0,role:"owner"},{is_admin:0,role:"sales"},{is_admin:1,enabled:0}])test(`non-admin/disabled account is denied for both methods: ${JSON.stringify(user)}`,async()=>{
  const h=harness({user});await h.call("GET");assert.equal(h.res.code,403);await h.call("POST");assert.equal(h.queries.length,0);assert.equal(h.data.deleted,false);
});
test("permission revocation between confirmation page and POST is enforced",async()=>{
  const options={},h=harness(options);await h.review();options.revoked=true;
  await assert.rejects(()=>h.call("POST"),e=>e.status===403);assert.equal(h.deletes.length,0);
});
for(const body of [{confirmation:"OPP-0081",confirm_history:"yes"},{confirmation:"OPP-0080"},{confirmation:["OPP-0080"],confirm_history:"yes"}])test(`confirmation is checked server-side: ${JSON.stringify(body)}`,async()=>{
  const h=harness();await h.review();h.req.body=body;await assert.rejects(()=>h.call("POST"),/confirm deletion/);assert.equal(h.deletes.length,0);
});
for(const block of ["request","notification","preparation","fill","send","lock"])test(`active or uncertain ${block} prevents deletion even after a clean preview`,async()=>{
  const options={linked:true},h=harness(options);await h.review();options.block=block;
  await assert.rejects(()=>h.call("POST"),e=>e.status===409);assert.equal(h.deletes.length,0);assert.equal(h.data.deleted,false);
});
test("new history after preview requires a fresh review",async()=>{
  const h=harness();await h.review();h.data.counts.quotes++;
  await assert.rejects(()=>h.call("POST"),/history changed/);assert.equal(h.deletes.length,0);
});
test("direct POST without reviewing the scope is refused",async()=>{
  const h=harness();h.req.body={confirmation:"OPP-0080",confirm_history:"yes"};
  await assert.rejects(()=>h.call("POST"),/Reload the deletion page/);assert.equal(h.deletes.length,0);
});
test("database failure rolls back child deletions and audit writes",async()=>{
  const h=harness({failTable:"quotes"});await h.review();const counts={...h.data.counts};
  await assert.rejects(()=>h.call("POST"),/database failure/);
  assert.deepEqual(h.data.counts,counts);assert.equal(h.data.audits.length,0);assert.equal(h.data.deleted,false);
});
test("confirmation page escapes names and explains app-only deletion",async()=>{
  const h=harness();await h.review();
  const html=await ejs.renderFile("views/prospect-delete.ejs",{...h.res.locals,user:h.req.session.user,csrf:"token",mode:"dryrun"});
  assert.ok(!html.includes("<script>bad</script>"));assert.match(html,/SharePoint records, documents and previously sent emails remain/);
  assert.match(html,/including any approved or sent quotes/);assert.match(html,/name="_csrf"/);
});
test("blocked confirmation page offers no usable delete submission",async()=>{
  const h=harness({block:"request"});await h.review();
  const html=await ejs.renderFile("views/prospect-delete.ejs",{...h.res.locals,user:h.req.session.user,csrf:"token"});
  assert.match(html,/<button disabled>Permanently delete prospect/);
});
