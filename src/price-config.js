import { query } from "./db.js";
import { prices } from "./config.js";

const regulatedKeys = ["regulatedBase", "regulatedUser", "regulatedIncludedUsers"];

// INSERT IGNORE preserves owner edits and is safe when app instances start together.
export async function ensureRegulatedPrices(run = query, connection) {
  for (const key of regulatedKeys) {
    await run("INSERT IGNORE INTO config_prices (name,amount) VALUES (?,?)", [key, prices[key]], connection);
  }
}

export async function loadPriceConfig(connection, run = query) {
  const sql = "SELECT * FROM config_prices" + (connection ? " FOR UPDATE" : "");
  let rows = await run(sql, [], connection);
  if (regulatedKeys.some(key => !rows.some(row => row.name === key))) {
    await ensureRegulatedPrices(run, connection);
    // Read persisted values, including any concurrent owner edits, rather than merging defaults.
    rows = await run(sql, [], connection);
  }
  return Object.fromEntries(rows.map(row => [row.name, Number(row.amount)]));
}
