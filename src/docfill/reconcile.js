import { integer,text,fail } from "../security.js";
export async function reconcileQuoteDelivery(input,actor,{query,transaction,audit}) {
  if(input.confirm_checked!=="yes")fail("Check Commercial and shared Sent Items before reconciling.");
  const note=text(input.note||"",2000);if(note.length<10)fail("Record what you verified in at least ten characters.");
  const fillId=input.fill_id?integer(input.fill_id):null,attemptId=input.attempt_id?integer(input.attempt_id):null;
  if(Boolean(fillId)===Boolean(attemptId))fail("Select one uncertain fill or send attempt.");
  await transaction(async c=>{
    let row,operation;
    if(fillId){
      [row]=await query("SELECT *,TIMESTAMPDIFF(SECOND,created_at,CURRENT_TIMESTAMP) age_seconds FROM quote_fills WHERE id=? FOR UPDATE",[fillId],c);operation="Fill";
      if(!row||row.status!=="Unknown")fail("Only an uncertain fill can be reconciled here.");
    }else{
      [row]=await query("SELECT *,TIMESTAMPDIFF(SECOND,created_at,CURRENT_TIMESTAMP) age_seconds FROM quote_send_attempts WHERE id=? FOR UPDATE",[attemptId],c);operation="Send";
      if(!row||row.status!=="Unknown"||row.phase!=="Email"||!row.pdf_item_id)fail("This send requires separate PDF/transport reconciliation; do not automatically retry it.");
      if(!["not_sent","sent"].includes(input.decision))fail("Confirm whether the email was sent or definitely absent.");
    }
    if(Number(row.age_seconds)<120)fail("Wait at least two minutes before reconciling an uncertain operation.");
    const [lock]=await query("SELECT * FROM quote_operation_locks WHERE client_id=? FOR UPDATE",[row.client_id],c);
    if(!lock||lock.operation!==operation)fail("The client operation lock does not match. Stop and inspect the database.");
    if(fillId)await query("UPDATE quote_fills SET status='Failed' WHERE id=?",[fillId],c);
    else if(input.decision==="not_sent")await query("UPDATE quote_send_attempts SET status='Failed',error_message=? WHERE id=?",["Admin verified no email accepted: "+note,attemptId],c);
    else {
      await query("UPDATE quote_send_attempts SET status='Sent',sent_at=UTC_TIMESTAMP(),error_message=? WHERE id=?",["Admin verified Sent Items: "+note,attemptId],c);
      if(row.mode==="live")await query("UPDATE quotes SET status='Sent',sent_at=UTC_TIMESTAMP(),sent_by=?,sent_to=?,sent_cc=?,sent_pdf_item_id=?,email_message_id=? WHERE id=?",[row.actor,row.sent_to,row.sent_cc,row.pdf_item_id,row.email_message_id,row.quote_id],c);
    }
    await query("DELETE FROM quote_operation_locks WHERE client_id=? AND token=?",[row.client_id,lock.token],c);
    await audit(c,actor,"reconcile quote "+operation+": "+note,"quote_delivery",fillId||attemptId);
  });
}
