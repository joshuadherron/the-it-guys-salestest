import "dotenv/config";
import mysql from "mysql2/promise";
export const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 8,
  dateStrings: true,
  timezone: "Z",
  multipleStatements: false,
});
export async function query(sql, values = [], executor = db) {
  const [rows] = await executor.execute(sql, values);
  return rows;
}
export async function transaction(fn) {
  const c = await db.getConnection();
  try {
    await c.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await c.beginTransaction();
    const result = await fn(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export async function audit(c, user, action, entity, id) {
  await query(
    "INSERT INTO audit_log (actor,action,entity,entity_id) VALUES (?,?,?,?)",
    [user.email, action, entity, String(id)],
    c,
  );
}
export const json = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
