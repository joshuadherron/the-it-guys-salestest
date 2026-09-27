import { fail } from "./security.js";
import { needsLane } from "./sales-import.js";
export async function commitImport(
  preview,
  user,
  { transaction, query, insert, audit },
) {
  if (
    !preview ||
    !preview.data.length ||
    !["pipeline", "weekly", "current_sales"].includes(preview.kind)
  )
    fail("Preview a nonempty CSV first.");
  if (preview.kind !== "weekly" && preview.data.some(needsLane))
    fail(
      "Choose BII or Managed IT for each technical row and review the mapping first.",
    );
  try {
    return await transaction(async (c) => {
      // The primary key on imports.kind is the atomic reservation. No records are inserted before it succeeds.
      await query(
        "INSERT INTO imports (kind,actor) VALUES (?,?)",
        [preview.kind, user.email],
        c,
      );
      for (const row of preview.data) {
        if (preview.kind === "weekly")
          await query(
            "INSERT INTO weekly_imports (week_start,calls,conversations,qualified,proposals,recurring,hourly,notes) VALUES (?,?,?,?,?,?,?,?)",
            row,
            c,
          );
        else await insert(row, user, c);
      }
      await audit(c, user, "commit import", preview.kind, preview.data.length);
    });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      fail(
        "This import source or week has already been committed. Nothing was imported again.",
        409,
      );
    throw e;
  }
}
