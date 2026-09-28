import {
  workColumns,
  definitionColumns,
  columnErrors,
  normalizeDefinition,
  normalizeItem,
} from "./work-items.js";
const prefer = { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" };
export async function filteredRead(
  graph,
  path,
  filter,
  predicate,
  warn = console.warn,
) {
  let rows;
  try {
    rows = await graph.all(
      path + "&$filter=" + encodeURIComponent(filter),
      prefer,
    );
  } catch (e) {
    if (![400, 422, 500].includes(e.status)) throw e;
    warn("SharePoint filtered read refused; using paged local filtering.");
    rows = await graph.all(path, prefer);
  }
  return rows.filter(predicate);
}
export class WorkReader {
  constructor(sp) {
    this.sp = sp;
    this.itemsCache = new Map();
    this.users = new Map();
  }
  async check(lists) {
    const s = this.sp.cache,
      graph = this.sp.graph;
    this.itemsCache.clear();
    s.workErrors = [];
    s.definitionErrors = [];
    s.definitions = [];
    s.stageGateConfirmed = false;
    s.signatureSentColumn = null;
    const resolve = (name, errors) => {
      const rows = lists.filter((l) => l.displayName === name);
      if (rows.length !== 1) {
        errors.push(
          `Required list or library "${name}" is missing or ambiguous.`,
        );
        return null;
      }
      return rows[0].id;
    };
    s.clientOpsId = resolve("Client Operations", s.workErrors);
    s.definitionsId = resolve(
      "Client Workflow Definitions",
      s.definitionErrors,
    );
    s.userInfoId =
      lists.filter((l) => l.displayName === "User Information List").length ===
      1
        ? lists.find((l) => l.displayName === "User Information List").id
        : null;
    if (s.clientOpsId) {
      try {
        const columns = await graph.all(
          `/sites/${s.siteId}/lists/${s.clientOpsId}/columns`,
        );
        s.workErrors.push(
          ...columnErrors(columns, workColumns, "Client Operations"),
        );
        const sentColumns = columns.filter(
          (c) => c.displayName === "Signature Sent Date",
        );
        s.signatureSentColumn =
          sentColumns.length === 1 ? sentColumns[0].name : null;
        s.workChoices = Object.fromEntries(
          columns
            .filter((c) => c.choice)
            .map((c) => [c.name, c.choice.choices]),
        );
      } catch {
        s.workErrors.push("Could not read Client Operations columns.");
      }
    }
    if (s.definitionsId) {
      try {
        const columns = await graph.all(
          `/sites/${s.siteId}/lists/${s.definitionsId}/columns`,
        );
        s.definitionErrors.push(
          ...columnErrors(
            columns,
            definitionColumns,
            "Client Workflow Definitions",
          ),
        );
        if (!s.definitionErrors.length)
          s.definitions = (
            await graph.all(
              `/sites/${s.siteId}/lists/${s.definitionsId}/items?$expand=fields`,
            )
          ).map(normalizeDefinition);
      } catch {
        s.definitionErrors.push("Could not read Client Workflow Definitions.");
      }
    }
    const requireChoice = (action, column, value) => {
      if (!s.workChoices?.[column]?.includes(value))
        s.actionErrors[action].push(
          `Client Operations ${column} is missing choice "${value}".`,
        );
    };
    requireChoice("ItemCompleted", "TIG_CompletionStatus", "Complete");
    requireChoice("NotRequired", "TIG_CompletionStatus", "Not Required");
    requireChoice("RequestException", "TIG_ExceptionStatus", "None");
    requireChoice("RequestException", "TIG_ExceptionStatus", "Rejected");
    try {
      const status = s.maps.requests["Processing Status"].name,
        type = s.maps.requests["Request Type"].name,
        payload = s.maps.requests.Payload.name;
      const done = await filteredRead(
        graph,
        `/sites/${s.siteId}/lists/${s.requestListId}/items?$expand=fields`,
        `fields/${status} eq 'Done' and fields/${type} eq 'Item Completed'`,
        (r) =>
          r.fields?.[status] === "Done" &&
          r.fields?.[type] === "Item Completed",
      );
      s.stageGateConfirmed = done.some((r) => {
        try {
          return Object.hasOwn(JSON.parse(r.fields[payload]), "outcomeFlags");
        } catch {
          return false;
        }
      });
    } catch {
      /* The evidence is advisory, never a write permission. */
    }
  }
  async assignee(id) {
    if (!id) return null;
    const s = this.sp.cache,
      key = `${s.siteId}:${id}`;
    if (this.users.has(key)) return this.users.get(key);
    let user = null;
    if (s.userInfoId)
      try {
        const row = await this.sp.graph.read(
          `/sites/${s.siteId}/lists/${s.userInfoId}/items/${encodeURIComponent(id)}?$expand=fields`,
        );
        if (row.fields?.EMail)
          user = {
            email: row.fields.EMail.toLowerCase(),
            name: row.fields.Title || row.fields.EMail,
          };
      } catch {
        /* Use only owner-configured identity mappings below. */
      }
    if (!user) {
      const matches = [
        ["SP_JOSH_USER_LOOKUP_ID", "josh@theitguys.us"],
        ["SP_ALANNA_USER_LOOKUP_ID", "alanna@theitguys.us"],
      ].filter(
        ([env]) =>
          /^\d+$/.test(process.env[env] || "") &&
          String(id) === process.env[env],
      );
      if (matches.length === 1)
        user = { email: matches[0][1], name: matches[0][1] };
    }
    this.users.set(key, user);
    return user;
  }
  async items(clientId, fresh) {
    const s = this.sp.ready();
    if (s.workErrors?.length || !s.clientOpsId)
      throw new Error(
        (s.workErrors || ["Client Operations has not been checked."]).join(" "),
      );
    const cached = this.itemsCache.get(clientId);
    if (!fresh && cached && cached.until > Date.now()) return cached.items;
    const escaped = String(clientId).replaceAll("'", "''");
    const rows = await filteredRead(
      this.sp.graph,
      `/sites/${s.siteId}/lists/${s.clientOpsId}/items?$expand=fields,driveItem($select=name,webUrl)&$top=500`,
      `fields/TIG_ClientID eq '${escaped}'`,
      (r) => r.fields?.TIG_ClientID === clientId,
    );
    const items = await Promise.all(
      rows.map(async (r) =>
        normalizeItem(
          r,
          s.definitions || [],
          await this.assignee(r.fields.TIG_AssignedToLookupId),
          s.signatureSentColumn,
        ),
      ),
    );
    this.itemsCache.set(clientId, { items, until: Date.now() + 30000 });
    return items;
  }
}
