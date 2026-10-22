import { query,json } from "./db.js";
export const handoffOutcome="Work authorized / handoff";
// Sales evidence only. Delivery, tasks, time and billing belong in existing systems.
export async function salesHandoff(id,c,run=query) {
  const [row]=await run("SELECT * FROM activities WHERE prospect_id=? AND outcome=? ORDER BY id DESC LIMIT 1",[id,handoffOutcome],c);
  return row?{...json(row.notes),activity_id:row.id,actor:row.actor,occurred_on:row.occurred_on}:null;
}
