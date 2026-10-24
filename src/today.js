import { query } from "./db.js";
import { chicagoDate, chicagoLongDate } from "./docfill/chicago-date.js";

export function todaySchedule(rows, day) {
  const entries=[];
  for(const p of rows) {
    const add=(kind,time,description,method)=>entries.push({p,kind,time:time||null,description,method});
    if(p.meeting_date===day)add("Meeting",p.meeting_time,p.meeting_type||"Scheduled meeting",p.meeting_location);
    if(p.next_action_date===day)add("Next action",p.next_action_time,p.next_action||"Scheduled next action",p.next_action_method);
    // Imports often save the same next-action date in follow_up. Show it once.
    if(p.follow_up===day&&p.next_action_date!==day)add("Follow-up",null,"Scheduled follow-up",null);
  }
  return entries.sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99")||a.p.business_name.localeCompare(b.p.business_name)||Number(a.p.id)-Number(b.p.id)||a.kind.localeCompare(b.kind));
}
export function todayRoutes(app,{run=query,now=()=>new Date()}={}) {
  app.get("/today",async(req,res)=>{
    const instant=now(),day=chicagoDate(instant),mine=req.query.scope==="mine";
    const rows=await run(`SELECT * FROM prospects WHERE (meeting_date=? OR next_action_date=? OR follow_up=?)${mine?" AND owner=?":""}`,[day,day,day,...(mine?[req.session.user.email]:[])]);
    res.render("today",{day,label:chicagoLongDate(instant),mine,entries:todaySchedule(rows,day)});
  });
}
