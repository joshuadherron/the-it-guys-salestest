import { readdir, readFile } from "node:fs/promises";
import { db, query } from "../src/db.js";
try {
  await query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
  );
  for (const name of (await readdir("migrations"))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    if (
      (await query("SELECT name FROM schema_migrations WHERE name=?", [name]))
        .length
    )
      continue;
    for (const sql of (await readFile(`migrations/${name}`, "utf8"))
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await query(sql);
    await query("INSERT INTO schema_migrations (name) VALUES (?)", [name]);
    console.log(`Applied ${name}`);
  }
} finally {
  await db.end();
}
