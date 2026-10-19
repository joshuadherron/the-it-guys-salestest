import test from 'node:test';
import assert from 'node:assert/strict';
import { importOne, followupDate, sendPending, runPickup } from '../lib/switch-review-import.js';
import { createGraphMailer } from '../lib/graph-mail.js';

const sample = () => ({ id:'lead-1',business_name:'Example',contact_name:'Alex',email:'alex@example.test',phone:null,
  employee_range:'5–15',renewal_window:'3–6 months',concerns:'["Slow response"]',other_concern:null,
  consent_at:'2026-10-19 12:00:00',utm_source:'facebook',utm_campaign:'switch-review',fbclid:'click',
  outside_target_size:0,status:'new',email_status:'pending',email_attempts:0 });
class Pool {
  constructor() { this.row=sample();this.prospects=[];this.operations=[];this.now=0;this.locked=false; }
  async getConnection() {
    const pool=this;
    let snapshot;
    return {
      async beginTransaction(){ snapshot=structuredClone({row:pool.row,prospects:pool.prospects});pool.operations.push('begin'); },
      async commit(){ pool.operations.push('commit'); },
      async rollback(){ pool.row=snapshot.row;pool.prospects=snapshot.prospects;pool.operations.push('rollback'); },
      query:(sql,args)=>pool.query(sql,args),execute:(sql,args)=>pool.execute(sql,args),release(){},
    };
  }
  async query(sql) {
    if(sql.includes('GET_LOCK')) { if(this.locked)return [[{acquired:0}]];this.locked=true;return [[{acquired:1}]]; }
    if(sql.includes('RELEASE_LOCK')) { this.locked=false;return [[{released:1}]]; }
    if(sql.includes("status='new'")) return [[...(this.row.status==='new'?[structuredClone(this.row)]:[])]];
    if(sql.includes("email_status IN")) return [[...(this.row.status==='imported' && this.row.email_status!=='sent' && this.row.email_attempts<3 && (!this.row.due || this.row.due<=this.now)?[structuredClone(this.row)]:[])]];
    throw new Error('unexpected SQL');
  }
  async execute(sql,args=[]) {
    this.operations.push({sql,args});
    if(sql.includes('prospects')) throw new Error('sales access attempted on swform connection');
    if(sql.includes("SET status='imported'")) { if(this.failImport)throw new Error('DB failure');this.row.status='imported';this.row.prospect_id=args[0];return [{affectedRows:1}]; }
    if(sql.includes('email_attempts=email_attempts+1')) { this.row.email_attempts++;this.row.claim=args[0];return [{affectedRows:1}]; }
    if(sql.includes("SET email_status='sent'")) { this.row.email_status='sent';return [{affectedRows:1}]; }
    if(sql.includes('SET email_status=\'failed\',last_email_error=?')) { this.row.email_status='failed';this.row.due=this.now+args[1];return [{affectedRows:1}]; }
    if(sql.includes("mail_attempt_interrupted"))return [{affectedRows:0}];
    throw new Error('unexpected SQL');
  }
}
class SalesPool {
  constructor(){this.prospects=[];this.operations=[];}
  async execute(sql,args){
    this.operations.push({sql,args});
    if(sql.includes('switch_review_leads'))throw new Error('inbox access attempted on sales connection');
    if(sql.startsWith('SELECT id FROM prospects'))return [this.prospects.filter(p=>p[7]===args[0]).map(p=>({id:p[0]}))];
    if(sql.includes('INSERT INTO prospects')){
      if(this.failInsert)throw new Error('sales unavailable');
      if(this.race){this.race=false;this.prospects.push(['racing-prospect',...args]);throw Object.assign(new Error('duplicate'),{code:'ER_DUP_ENTRY'});}
      if(this.unrelatedDuplicate)throw Object.assign(new Error('duplicate'),{code:'ER_DUP_ENTRY'});
      if(this.prospects.some(p=>p[7]===args[6]))throw Object.assign(new Error('duplicate'),{code:'ER_DUP_ENTRY'});
      this.prospects.push(['101',...args]);return [{affectedRows:1,insertId:101}];
    }
    throw new Error('unexpected sales SQL');
  }
}
test('renewal followups are +2/+30/+90 days',()=>{
  const now=new Date('2026-10-19T12:00:00Z');
  assert.equal(followupDate('3–6 months',now),'2026-11-18');
  assert.equal(followupDate('6–12 months',now),'2027-01-17');
  for(const r of ['Within 3 months','Not sure','No contract'])assert.equal(followupDate(r,now),'2026-10-21');
});
test('separate databases: one prospect and lead marked imported; rerun is empty',async()=>{
  const pool=new Pool(),sales=new SalesPool();
  assert.equal(await importOne(sales,pool),true);
  assert.equal(pool.row.status,'imported');
  assert.equal(sales.prospects.length,1);
  assert.equal(await importOne(sales,pool),false);
  assert.equal(sales.prospects.length,1);
  const insert=sales.operations.find(o=>o.sql?.includes('INSERT INTO prospects'));
  assert.match(insert.sql,/'Switch Review'/);
  assert.match(insert.sql,/employee_count/); assert.match(insert.sql,/,NULL,'',''/);
  assert.equal(JSON.parse(insert.args[5]).utm_source,'facebook');
  assert.equal(insert.args[4],'5–15');
  assert.match(insert.sql,/switch_lead_id/);
});
test('status update fails after prospect commit: next run reuses prospect',async()=>{
  const pool=new Pool(),sales=new SalesPool();pool.failImport=true;
  await assert.rejects(()=>importOne(sales,pool),/switch_review_import_failed/);
  assert.equal(sales.prospects.length,1);assert.equal(pool.row.status,'new');
  pool.failImport=false;
  await importOne(sales,pool);
  assert.equal(sales.prospects.length,1);assert.equal(pool.row.status,'imported');
  assert.equal(pool.row.prospect_id,sales.prospects[0][0]);
});
test('sales INSERT failure leaves lead new and no prospect',async()=>{
  const pool=new Pool(),sales=new SalesPool();sales.failInsert=true;
  await assert.rejects(()=>importOne(sales,pool));
  assert.equal(sales.prospects.length,0);assert.equal(pool.row.status,'new');
});
test('concurrent duplicate lead insertion recovers winner ID',async()=>{
  const pool=new Pool(),sales=new SalesPool();sales.race=true;
  await importOne(sales,pool);
  assert.equal(sales.prospects.length,1);assert.equal(pool.row.prospect_id,'racing-prospect');
});
test('unrelated duplicate key never marks lead imported',async()=>{
  const pool=new Pool(),sales=new SalesPool();sales.unrelatedDuplicate=true;
  await assert.rejects(()=>importOne(sales,pool));assert.equal(pool.row.status,'new');
});
test('mail off: prospect still imports with New lead marker, no transport call',async()=>{
  const pool=new Pool(),sales=new SalesPool();
  await runPickup(sales,pool,{enabled:false,send(){throw new Error('must not send');}},[]);
  assert.equal(pool.row.status,'imported');
  assert.equal(pool.row.email_attempts,0);
  assert.match(sales.operations.find(o=>o.sql?.includes('INSERT INTO prospects')).sql,/switch_review_new/);
});
test('mail failure retries with 5m then 15m backoff, max three; no reimport',async()=>{
  const pool=new Pool(),sales=new SalesPool();await importOne(sales,pool);
  let calls=0;
  const mailer={enabled:true,async send(){calls++;throw Object.assign(new Error('secret response'),{code:'mail_send_http_503'});}};
  await sendPending(pool,mailer,['notifications@example.test']);
  assert.equal(calls,1);assert.equal(pool.row.due,5);
  await sendPending(pool,mailer,['notifications@example.test']);assert.equal(calls,1);
  pool.now=5;await sendPending(pool,mailer,['notifications@example.test']);assert.equal(pool.row.due,20);
  pool.now=20;await sendPending(pool,mailer,['notifications@example.test']);
  pool.now=200;await sendPending(pool,mailer,['notifications@example.test']);
  assert.equal(calls,3);assert.equal(pool.row.email_attempts,3);assert.equal(sales.prospects.length,1);
  assert.equal(pool.row.status,'imported');
});
test('successful mail is not resent',async()=>{
  const pool=new Pool();await importOne(new SalesPool(),pool);let count=0;
  const mailer={enabled:true,async send(message){count++;assert.match(message.text,/facebook/);return {accepted:true};}};
  assert.equal(await sendPending(pool,mailer,['leads@example.test']),1);
  await sendPending(pool,mailer,['leads@example.test']);assert.equal(count,1);
});
test('concurrent scheduled worker exits while advisory lock held',async()=>{
  const pool=new Pool();pool.locked=true;
  assert.deepEqual(await runPickup(new SalesPool(),pool,{enabled:false},[]),{skipped:true});assert.equal(pool.prospects.length,0);
});
test('Graph disabled by default; configurable sender per feature and token reuse',async()=>{
  let calls=[];
  const transport=async(url,options)=>{calls.push({url,options});return url.includes('/token')?{ok:true,json:async()=>({access_token:'mock',expires_in:3600})}:{ok:true,status:202};};
  const off=createGraphMailer({},transport);assert.deepEqual(await off.send({}),{disabled:true});assert.equal(calls.length,0);
  const on=createGraphMailer({SALES_MAIL_ENABLED:'true',SALES_MAIL_TENANT_ID:'tenant',SALES_MAIL_CLIENT_ID:'client',SALES_MAIL_CLIENT_SECRET:'test-only'},transport);
  for(const from of ['website@example.test','quotes@example.test'])await on.send({from,to:['leads@example.test'],subject:'Review',text:'Review details'});
  assert.equal(calls.length,3);
  assert.match(calls[1].url,/website%40example.test\/sendMail/);assert.match(calls[2].url,/quotes%40example.test\/sendMail/);
  assert.equal(JSON.parse(calls[1].options.body).message.body.contentType,'Text');
});
test('Graph errors carry only sanitized codes',async()=>{
  const mailer=createGraphMailer({SALES_MAIL_ENABLED:'true',SALES_MAIL_TENANT_ID:'tenant',SALES_MAIL_CLIENT_ID:'client',SALES_MAIL_CLIENT_SECRET:'test-only'},async()=>({ok:false,status:403}));
  await assert.rejects(()=>mailer.send({from:'from@example.test',to:['to@example.test'],subject:'Review',text:'Text'}),{code:'mail_auth_http_403'});
});

