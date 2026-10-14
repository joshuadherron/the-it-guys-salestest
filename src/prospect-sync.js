import { graph } from "./graph.js";
import { sp, lookupId } from "./sharepoint-runtime.js";
import { buildFields, submitRequest } from "./sharepoint.js";
import { query, transaction, audit } from "./db.js";
import { opportunity } from "./config.js";

export const prospectSyncEnabled = () =>
  String(process.env.PROSPECT_SYNC_ENABLED || "").toLowerCase() === "true";

function withOpportunity(p) {
  return { ...p, opp: p.opp || opportunity(p.id) };
}

export async function dispatchProspectSync(
  prospect,
  user,
  dependencies = { sp, graph, query, transaction, audit },
) {
  const { sp, graph, query, transaction, audit } = dependencies;
  if (!prospectSyncEnabled())
    return { ok: false, status: "Disabled", error: "Prospect sync is not enabled." };
  const p = withOpportunity(prospect);
  const mode = process.env.SHAREPOINT_WRITE_MODE || "dryrun";
  let body;
  let requestId;

  try {
    const schema = sp.ready();
    body = buildFields(
      schema,
      "UpsertProspect",
      p,
      null,
      user.email,
      new Date(),
      lookupId(user.email),
    );

    await transaction(async (c) => {
      const result = await query(
        "INSERT INTO sp_requests (prospect_id,action,request_json,status) VALUES (?,'UpsertProspect',?,'Preparing')",
        [p.id, JSON.stringify(body)],
        c,
      );
      requestId = result.insertId;
      await audit(c, user, "prepare prospect sync", "sp_request", requestId);
    });

    try {
      const result = await submitRequest(graph, mode, schema, body);
      await transaction(async (c) => {
        await query(
          "UPDATE sp_requests SET status=?,item_id=?,result_message=NULL WHERE id=?",
          [result.status, result.itemId, requestId],
          c,
        );
        await audit(
          c,
          user,
          "dispatch prospect sync " + result.status,
          "sp_request",
          requestId,
        );
      });
      return { ok: true, requestId, status: result.status };
    } catch {
      await transaction(async (c) => {
        await query(
          "UPDATE sp_requests SET status='Unknown',result_message=? WHERE id=?",
          [
            "Prospect sync delivery could not be confirmed. Check the exact request title in SharePoint before retrying.",
            requestId,
          ],
          c,
        );
        await audit(c, user, "prospect sync uncertain", "sp_request", requestId);
      });
      return { ok: false, requestId, status: "Unknown" };
    }
  } catch (error) {
    await transaction(async (c) => {
      const result = await query(
        "INSERT INTO sp_requests (prospect_id,action,request_json,status,result_message) VALUES (?,'UpsertProspect',?,'Failed',?)",
        [
          p.id,
          JSON.stringify({ opportunityId: p.opp }),
          String(error.message || "Prospect sync could not be prepared.").slice(0, 10000),
        ],
        c,
      );
      requestId = result.insertId;
      await audit(c, user, "prospect sync failed", "sp_request", requestId);
    });
    return {
      ok: false,
      requestId,
      status: "Failed",
      error: error.message || "Prospect sync could not be prepared.",
    };
  }
}

export async function syncStatus(prospectId, runQuery = query) {
  const [row] = await runQuery(
    "SELECT id,status,result_message,created_at FROM sp_requests WHERE prospect_id=? AND action='UpsertProspect' ORDER BY id DESC LIMIT 1",
    [prospectId],
  );
  return row || null;
}
