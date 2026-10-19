import { randomUUID } from 'node:crypto';

export function followupDate(renewal, now = new Date()) {
  const days = { 'Within 3 months': 2, '3–6 months': 30, '6–12 months': 90, 'Not sure': 2, 'No contract': 2 }[renewal];
  if (days === undefined) throw new Error('invalid_renewal');
  const date = new Date(now); date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function reviewMetadata(row) {
  return { renewal_window: row.renewal_window, concerns: typeof row.concerns === 'string' ? JSON.parse(row.concerns) : row.concerns,
    other_concern: row.other_concern, outside_target_size: Boolean(row.outside_target_size), consent_at: row.consent_at,
    utm_source: row.utm_source, utm_medium: row.utm_medium, utm_campaign: row.utm_campaign, utm_content: row.utm_content, fbclid: row.fbclid };
}
export async function importOne(salesPool, swformPool, now = new Date()) {
  let id;
  try {
    const [rows] = await swformPool.query("SELECT * FROM switch_review_leads WHERE status='new' ORDER BY created_at,id LIMIT 1");
    if (!rows.length) return false;
    const row = rows[0]; id = row.id;
    let [existing] = await salesPool.execute('SELECT id FROM prospects WHERE switch_lead_id=? LIMIT 1',[row.id]);
    let prospect = existing[0]?.id;
    if (!prospect) {
      const metadata = reviewMetadata(row);
      const notes = [row.outside_target_size ? 'Outside target size' : '', `Switch review: renews ${row.renewal_window}`, ...metadata.concerns, row.other_concern].filter(Boolean).join('\n');
      try {
        // Single autocommitted INSERT. The unique lead ID is the durable recovery key.
        // Live sales uses an auto-increment ID and nullable numeric employee count.
        const followup = followupDate(row.renewal_window,now);
        const [inserted] = await salesPool.execute(`INSERT INTO prospects
      (business_name,contact_name,email,phone,source,employee_range,switch_review_data,switch_lead_id,switch_review_new,
       stage,next_action,next_action_date,next_action_method,notes,follow_up,employee_count,current_it,key_dependency)
      VALUES (?,?,?,?,'Switch Review',?,?,?,1,'Prospecting','Contact about switch review',?,'Call',?,?,NULL,'','')`,
      [row.business_name,row.contact_name,row.email,row.phone || '',row.employee_range,JSON.stringify(metadata),row.id,
        followup,notes,followup]);
        prospect = String(inserted.insertId);
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        // A concurrent worker may have won the unique-key race. Only recover
        // when this exact lead has a prospect; unrelated collisions still fail.
        [existing] = await salesPool.execute('SELECT id FROM prospects WHERE switch_lead_id=? LIMIT 1',[row.id]);
        if (!existing.length) throw error;
        prospect = existing[0].id;
      }
    }
    // Separate autocommit to swform. If it fails, retry reuses the prospect above.
    const [updated] = await swformPool.execute("UPDATE switch_review_leads SET status='imported',prospect_id=?,imported_at=UTC_TIMESTAMP(3) WHERE id=? AND status='new'",[prospect,row.id]);
    if (updated.affectedRows !== 1) {
      const [current] = await swformPool.execute('SELECT status,prospect_id FROM switch_review_leads WHERE id=?',[row.id]);
      if (current[0]?.status !== 'imported' || String(current[0]?.prospect_id) !== String(prospect)) throw new Error('import_status_conflict');
    }
    return true;
  } catch {
    console.error('[switch-review] import_failed', { leadId: id || null });
    throw new Error('switch_review_import_failed');
  }
}
function notification(row) {
  const details = reviewMetadata(row);
  return { subject: `New switch review – ${row.business_name} (${row.employee_range}, renews ${row.renewal_window})`,
    text: [`Business: ${row.business_name}`,`Name: ${row.contact_name}`,`Email: ${row.email}`,`Phone: ${row.phone || '(not provided)'}`,
      `Staff: ${row.employee_range}`,`Renewal: ${row.renewal_window}`,`Concerns: ${details.concerns.join('; ') || '(none selected)'}`,
      `Other: ${row.other_concern || ''}`,`Consent: ${row.consent_at}`,`Outside target size: ${Boolean(row.outside_target_size)}`,
      ...['utm_source','utm_medium','utm_campaign','utm_content','fbclid'].map(key => `${key}: ${row[key] || ''}`),
      `Lead ID: ${row.id}`,`Prospect ID: ${row.prospect_id}`].join('\n') };
}
export async function sendPending(pool, mailer, to) {
  if (!mailer.enabled) return 0; // Imports and visible markers never depend on mail.
  if (!to.length) throw new Error('notification_recipient_missing');
  let sent = 0;
  // A worker may die during its final attempt. Do not leave exhausted claims pending.
  await pool.execute(`UPDATE switch_review_leads SET email_status='failed',last_email_error='mail_attempt_interrupted',
    email_claim_token=NULL,email_claim_until=NULL WHERE status='imported' AND email_status<>'sent'
    AND email_attempts>=3 AND email_claim_until<=UTC_TIMESTAMP(3)`);
  for (let i = 0; i < 100; i++) {
    const connection = await pool.getConnection();
    let row;
    const claim = randomUUID();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(`SELECT * FROM switch_review_leads WHERE status='imported'
        AND email_status IN ('pending','failed') AND email_attempts<3
        AND (next_email_at IS NULL OR next_email_at<=UTC_TIMESTAMP(3))
        AND (email_claim_until IS NULL OR email_claim_until<=UTC_TIMESTAMP(3))
        ORDER BY created_at,id LIMIT 1 FOR UPDATE`);
      row=rows[0];
      if (!row) { await connection.commit(); break; }
      await connection.execute(`UPDATE switch_review_leads SET email_attempts=email_attempts+1,
        last_email_at=UTC_TIMESTAMP(3),email_claim_token=?,email_claim_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE),
        next_email_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE) WHERE id=?`,[claim,row.id]);
      await connection.commit();
    } catch { await connection.rollback();throw new Error('mail_claim_failed'); }
    finally { connection.release(); }
    const attempts = Number(row.email_attempts) + 1;
    try {
      const result = await mailer.send({to,...notification(row)});
      if (!result.accepted) throw new Error('mail_not_accepted');
      await pool.execute(`UPDATE switch_review_leads SET email_status='sent',last_email_error=NULL,
        email_claim_token=NULL,email_claim_until=NULL,next_email_at=NULL WHERE id=? AND email_claim_token=?`,[row.id,claim]);
      sent++;
    } catch (error) {
      const code = /^mail_[a-z0-9_]+$/.test(error.code || '') ? error.code : 'mail_delivery_failed';
      // 5m after first failure, 15m after second, stop after third total attempt.
      const delay = attempts === 1 ? 5 : 15;
      await pool.execute(`UPDATE switch_review_leads SET email_status='failed',last_email_error=?,
        email_claim_token=NULL,email_claim_until=NULL,next_email_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MINUTE)
        WHERE id=? AND email_claim_token=?`,[code,delay,row.id,claim]);
      console.error('[switch-review] email_failed',{leadId:row.id,attempt:attempts,code});
    }
  }
  return sent;
}
export async function runPickup(salesPool, swformPool, mailer, to) {
  const lock = await swformPool.getConnection();
  let acquired = false;
  try {
    const [result] = await lock.query("SELECT GET_LOCK(CONCAT('switch-review:',LEFT(SHA2(DATABASE(),256),32)),0) AS acquired");
    acquired = Number(result[0].acquired) === 1;
    if (!acquired) return { skipped: true };
    let imported = 0;
    let importFailed = false;
    try {
      for (let i = 0; i < 100; i++) {
        if (!await importOne(salesPool,swformPool)) break;
        imported++;
      }
    } catch { importFailed = true; } // Still retry email for already-imported leads.
    const sent = await sendPending(swformPool,mailer,to);
    return { imported, sent, mailEnabled: mailer.enabled, importFailed };
  } finally {
    try { if (acquired) await lock.query("SELECT RELEASE_LOCK(CONCAT('switch-review:',LEFT(SHA2(DATABASE(),256),32)))"); }
    finally { lock.release(); }
  }
}
