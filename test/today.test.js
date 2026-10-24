import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import { todayRoutes,todaySchedule } from "../src/today.js";

const day="2026-10-24";
const base={id:86,business_name:"Example",owner:"sales@example.test",stage:"Discovery"};

test("Today excludes overdue, future and unscheduled dates and avoids imported duplicate follow-ups",()=>{
  const entries=todaySchedule([
    {...base,meeting_date:day,meeting_time:"14:30:00",next_action_date:day,next_action_time:"09:00:00",next_action:"Call Pat",follow_up:day},
    {...base,id:87,business_name:"Another",follow_up:day},
    {...base,id:88,follow_up:"2026-10-23",meeting_date:"2026-10-25",next_action_date:"2026-10-26"},
    {...base,id:89},
  ],day);
  assert.deepEqual(entries.map(e=>[e.p.id,e.kind]),[[86,"Next action"],[86,"Meeting"],[87,"Follow-up"]]);
  assert.equal(entries[0].description,"Call Pat");
});

test("Today route uses Chicago date across UTC midnight and filters Mine by signed-in user",async()=>{
  for(const scope of ["all","mine"]){
    let handler,sql,args,rendered;
    todayRoutes({get(path,fn){assert.equal(path,"/today");handler=fn;}},{now:()=>new Date("2026-10-25T02:00:00Z"),run:async(s,a)=>{sql=s;args=a;return [{...base,follow_up:day}];}});
    await handler({query:{scope},session:{user:{email:base.owner}}},{render(view,data){rendered={view,...data};}});
    assert.equal(rendered.view,"today");assert.equal(rendered.day,day);assert.equal(rendered.entries.length,1);
    assert.deepEqual(args,scope==="mine"?[day,day,day,base.owner]:[day,day,day]);
    assert.equal(sql.includes("AND owner=?"),scope==="mine");assert.ok(!sql.includes("CURDATE"));
  }
});

test("Today follows Chicago daylight-saving calendar boundaries",async()=>{
  for(const [instant,expected] of [["2026-01-02T05:59:00Z","2026-01-01"],["2026-01-02T06:00:00Z","2026-01-02"],["2026-07-02T04:59:00Z","2026-07-01"],["2026-07-02T05:00:00Z","2026-07-02"]]){
    let handler;
    todayRoutes({get(_path,fn){handler=fn;}},{now:()=>new Date(instant),run:async(_sql,args)=>{assert.equal(args[0],expected);return [];}});
    await handler({query:{},session:{user:{email:base.owner}}},{render(){}});
  }
});

test("Today renders schedule visibly with contact details and safe meeting links, separate navigation and empty state",async()=>{
  const locals={user:{email:base.owner,role:"sales"},csrf:"test",mode:"dryrun",day,label:"October 24, 2026",mine:false};
  const html=await ejs.renderFile("views/today.ejs",{...locals,entries:todaySchedule([{...base,business_name:"<Example>",meeting_date:day,meeting_time:"14:30:00",teams_join_url:"https://teams.example.test/meeting",contact_name:"Pat",phone:"555",email:"pat@example.test",hold:true}],day)});
  assert.match(html,/2:30 PM/);assert.match(html,/&lt;Example&gt;/);assert.match(html,/Join meeting/);assert.match(html,/On Hold/);assert.match(html,/pat@example.test/);
  assert.equal((html.match(/href="\/today"/g)||[]).length,2);assert.ok(!html.includes("<details class=\"card"));
  const unsafe=await ejs.renderFile("views/today.ejs",{...locals,entries:todaySchedule([{...base,meeting_date:day,teams_join_url:"javascript:alert(1)"}],day)});
  assert.ok(!unsafe.includes("javascript:"));assert.match(unsafe,/No time set/);
  const empty=await ejs.renderFile("views/today.ejs",{...locals,mine:true,entries:[]});
  assert.match(empty,/Nothing scheduled for today/);assert.match(empty,/assigned to you/);
});
