import mysql from 'mysql2/promise';
import { db } from './db.js';
import { createGraphMailer } from '../lib/graph-mail.js';
import { runPickup } from '../lib/switch-review-import.js';

export function startSwitchPickup(env = process.env) {
  if (env.SWITCH_PICKUP_ENABLED !== 'true') return;
  const required = ['SWFORM_DB_HOST','SWFORM_DB_NAME','SWFORM_DB_USER','SWFORM_DB_PASS'];
  if (required.some(key => !env[key]) || env.SWFORM_DB_NAME === env.DB_NAME) {
    console.error('[switch-review] database_config_invalid');
    return;
  }
  const inbox = mysql.createPool({host:env.SWFORM_DB_HOST,port:Number(env.SWFORM_DB_PORT || 3306),
    database:env.SWFORM_DB_NAME,user:env.SWFORM_DB_USER,password:env.SWFORM_DB_PASS,
    connectionLimit:3,charset:'utf8mb4',timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,
    ssl:env.SWFORM_DB_SSL === 'true' ? {} : undefined});
  const transport = createGraphMailer(env);
  const mailer = {enabled:transport.enabled,send:message => transport.send({from:env.MAIL_FROM_WEBSITE,...message})};
  const recipients = String(env.MAIL_TO_LEADS || env.MAIL_FROM_WEBSITE || '').split(',').map(x=>x.trim()).filter(Boolean);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { console.info('[switch-review] pickup_complete',await runPickup(db,inbox,mailer,recipients)); }
    catch { console.error('[switch-review] pickup_failed'); }
    finally { running = false; }
  };
  const timer = setInterval(tick,5*60*1000);
  timer.unref();
  void tick();
  return {stop:async () => {clearInterval(timer);await inbox.end();}};
}
