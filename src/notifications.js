import { query, audit } from "./db.js";
import { graph, writeMail } from "./graph.js";
export async function queueNotice(c, p, kind) {
  const message = {
    message: {
      subject: `${kind}: ${p.opp}`,
      body: {
        contentType: "Text",
        content: `Review this internal opportunity: ${process.env.APP_URL}/prospects/${p.id}/discovery/9`,
      },
      toRecipients: [{ emailAddress: { address: "josh@theitguys.us" } }],
    },
    saveToSentItems: true,
  };
  const r = await query(
    "INSERT INTO notifications (prospect_id,kind,message_json,status) VALUES (?,?,?,?)",
    [p.id, kind, JSON.stringify(message), "Queued"],
    c,
  );
  await audit(c,{email:"system"},"queue notification", "notification",r.insertId);
  return { id: r.insertId, message };
}
export async function deliverNotice(notice) {
  if (!notice) return;
  try {
    const result = await writeMail(
      graph,
      process.env.SHAREPOINT_WRITE_MODE || "dryrun",
      notice.message,
    );
    await query("UPDATE notifications SET status=? WHERE id=?", [
      result.status,
      notice.id,
    ]);
    await audit(undefined,{email:"system"},result.status,"notification",notice.id);
    return result.status;
  } catch {
    await query("UPDATE notifications SET status=? WHERE id=?", [
      "Delivery failed — Josh must review",
      notice.id,
    ]);
    return "Delivery failed — contact Josh directly";
  }
}
