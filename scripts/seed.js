import { db, query, transaction } from "../src/db.js";
import { schema } from "../src/discovery-rules.js";
import { prices, stages, stops } from "../src/config.js";
try {
  await transaction(async (c) => {
    for (const q of schema)
      await query(
        "INSERT IGNORE INTO config_discovery (id,definition) VALUES (?,?)",
        [q.id, JSON.stringify(q)],
        c,
      );
    for (const [name, amount] of Object.entries(prices))
      await query(
        "INSERT IGNORE INTO config_prices (name,amount) VALUES (?,?)",
        [name, amount],
        c,
      );
    for (const [order, name] of stages.entries())
      await query(
        "INSERT IGNORE INTO config_stages (name,sort_order,managed_only) VALUES (?,?,?)",
        [name, order, name === "Technical Assessment"],
        c,
      );
    for (const label of stops)
      await query(
        "INSERT IGNORE INTO config_stop_conditions (label) VALUES (?)",
        [label],
        c,
      );
    for (const [email, role] of [
      ["alanna@theitguys.us", "sales"],
      ["josh@theitguys.us", "owner"],
    ])
      await query(
        "INSERT IGNORE INTO allowlist (email,role,is_admin,quote_approve,quote_send,display_name,sender_title,sender_phone) VALUES (?,?,?,?,?,?,?,?)",
        [email,role,role==="owner",role==="owner",true,role==="owner"?"Joshua Herron":"Alanna Herron",role==="owner"?"Owner / Technical Lead":"",role==="owner"?"409-937-2798":""],
        c,
      );
  });
  console.log("Configuration seeded without overwriting edits.");
} finally {
  await db.end();
}
