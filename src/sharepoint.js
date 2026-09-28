import {
  validateBusinessName,
  lostPayload,
  serializePayload,
} from "./workflow-contract.js";
import { lanes } from "./config.js";
export const sitePath =
  "/sites/theitguys713.sharepoint.com:/sites/TheITGuysOperations";
export const required = {
  requests: [
    "Title",
    "Request Type",
    "Processing Status",
    "Source",
    "Requested By",
    "Client",
    "Service Lane",
    "Payload",
    "Result Message",
  ],
  clients: [
    "Title",
    "Client ID",
    "Opportunity ID",
    "Current Stage",
    "Stage Status",
    "Service Lanes",
    "Next Action",
  ],
};
export const requiredChoices = {
  requests: {
    "Request Type": ["Create Client", "Start Stage", "Mark Lost"],
    "Processing Status": [
      "Pending",
      "Processing",
      "Done",
      "Rejected",
      "Failed",
    ],
    Source: ["Sales App"],
    "Service Lane": lanes,
  },
  clients: {
    "Service Lanes": lanes,
    "Current Stage": ["Sales Discovery", "Quoting", "Technical Assessment"],
  },
};
// These internal names are the contract; SharePoint display names can be renamed.
const requiredInternalNames = {
  requests: { Title: "Title" },
  clients: { Title: "Title", "Opportunity ID": "TIG_SalesOpportunityID" },
};
export function validateSchema(requestColumns, clientColumns) {
  const errors = [];
  const maps = {};
  const actionErrors = { MarkLost: [] };
  for (const [kind, columns] of [
    ["requests", requestColumns],
    ["clients", clientColumns],
  ]) {
    maps[kind] = {};
    for (const name of required[kind]) {
      const internalName = requiredInternalNames[kind][name];
      const matches = columns.filter((c) =>
        internalName ? c.name === internalName : c.displayName === name,
      );
      if (matches.length !== 1)
        errors.push(
          `${kind}: required column ${internalName || name} is missing or ambiguous.`,
        );
      else maps[kind][name] = matches[0];
    }
    for (const [name, choices] of Object.entries(requiredChoices[kind]))
      for (const choice of choices)
        if (!maps[kind][name]?.choice?.choices?.includes(choice)) {
          if (
            kind === "requests" &&
            name === "Request Type" &&
            choice === "Mark Lost"
          )
            actionErrors.MarkLost.push(
              'Workflow Requests Request Type is missing choice "Mark Lost".',
            );
          else if (
            kind === "requests" &&
            name === "Source" &&
            maps[kind][name]?.choice?.choices?.includes("Sales app")
          )
            errors.push(
              'Source has "Sales app"; rename it to "Sales App" in the Workflow Requests list settings.',
            );
          else errors.push(`${kind}: ${name} is missing choice "${choice}".`);
        }
  }
  const by = maps.requests["Requested By"];
  if (by && !by.text && !by.personOrGroup)
    errors.push("Requested By must be text or a single person column.");
  if (by?.personOrGroup?.allowMultipleSelection)
    errors.push("Requested By must allow one person only.");
  if (maps.requests.Client && !maps.requests.Client.lookup)
    errors.push("Workflow Requests Client must be a lookup column.");
  return { errors, maps, actionErrors };
}
export function payload(action, p, lane, options = {}) {
  const body = payloadData(action, p, lane, options);
  serializePayload(body);
  return body;
}
function payloadData(action, p, lane, options) {
  if (!lanes.includes(lane)) throw new Error("Choose a service lane.");
  if (action === "CreateClient") {
    validateBusinessName(p.business_name);
    if (
      !options.discovery ||
      typeof options.discovery !== "object" ||
      Array.isArray(options.discovery)
    )
      throw new Error("A discovery snapshot is required to create the client.");
    return {
      opportunityId: p.opp,
      client: p.business_name,
      stage: "Sales Discovery",
      serviceLane: lane,
      discovery: options.discovery,
    };
  }
  if (action === "MarkLost") return lostPayload(p, options);
  if (!p.client_id) throw new Error("Create the SharePoint client first.");
  if (action === "Quoting" && lane === "Business IT Integration")
    return { clientId: p.client_id, stage: "Quoting", serviceLane: lane };
  if (action === "TechnicalAssessment" && lane === "Managed IT")
    return {
      clientId: p.client_id,
      stage: "Technical Assessment",
      serviceLane: lane,
    };
  throw new Error("Action is not enabled.");
}
export function buildFields(
  schema,
  action,
  p,
  lane,
  email,
  at = new Date(),
  userLookupId,
  options = {},
) {
  if (action === "MarkLost" && schema.actionErrors?.MarkLost?.length)
    throw new Error(schema.actionErrors.MarkLost.join(" "));
  const body = payload(action, p, lane, options);
  const f = {};
  const map = schema.maps.requests;
  const put = (name, value) => {
    if (!map[name]) throw new Error(`Missing ${name}`);
    f[map[name].name] = value;
  };
  put(
    "Title",
    `SALESAPP-${p.opp}-${action}-${at.toISOString().replace(/[-:T]/g, "").slice(0, 14)}`,
  );
  put(
    "Request Type",
    action === "CreateClient"
      ? "Create Client"
      : action === "MarkLost"
        ? "Mark Lost"
        : "Start Stage",
  );
  put("Processing Status", "Pending");
  put("Source", "Sales App");
  put("Service Lane", lane);
  put("Payload", serializePayload(body));
  if (map["Requested By"].personOrGroup) {
    if (!/^\d+$/.test(String(userLookupId)))
      throw new Error(
        "Requested By needs a verified SharePoint user lookup ID.",
      );
    f[map["Requested By"].name + "LookupId"] = String(userLookupId);
  } else put("Requested By", email);
  if (p.client_item_id)
    f[map.Client.name + "LookupId"] = String(p.client_item_id);
  return { fields: f };
}
export function assertNoPending(items, schema, p) {
  const map = schema.maps.requests;
  for (const item of items) {
    const f = item.fields || {};
    if (!["Pending", "Processing"].includes(f[map["Processing Status"].name]))
      continue;
    let body;
    try {
      body = JSON.parse(f[map.Payload.name] || "{}");
    } catch {
      throw new Error(
        "A pending Workflow Request has unreadable Payload. Josh must check SharePoint.",
      );
    }
    if (
      body.opportunityId === p.opp ||
      (p.client_id && body.clientId === p.client_id) ||
      (p.client_item_id &&
        String(f[map.Client.name + "LookupId"]) === String(p.client_item_id))
    )
      throw new Error(
        "A request for this opportunity/client is already Pending or Processing.",
      );
  }
}
export async function submitRequest(adapter, mode, schema, body) {
  if (mode !== "live") return { status: "Dryrun", itemId: null };
  const item = await adapter.createWorkflowRequest(
    schema.siteId,
    schema.requestListId,
    body.fields,
  );
  return { status: "Pending", itemId: item.id };
}
export function plainResult(status) {
  return (
    {
      Done: "SharePoint completed this request.",
      Rejected:
        "SharePoint declined this request. Review the reason below before taking another action.",
      Failed:
        "SharePoint could not complete this request. Josh needs to investigate.",
      Pending: "Waiting for the SharePoint workflow.",
      Processing: "SharePoint is processing this request.",
      Dryrun: "Would create this Workflow Request. Nothing was sent.",
      Preparing: "Submission is being prepared.",
      Unknown:
        "Delivery is uncertain. Josh must reconcile the exact request title in SharePoint before any retry.",
    }[status] || "Status is unavailable. Check SharePoint."
  );
}
export class SharePoint {
  constructor(graph) {
    this.graph = graph;
    this.cache = { errors: ["SharePoint connection has not been checked."] };
  }
  async check() {
    try {
      const site = await this.graph.read(sitePath);
      const lists = await this.graph.all(
        `/sites/${site.id}/lists?$select=id,displayName`,
      );
      const find = (name) => {
        const found = lists.filter((x) => x.displayName === name);
        if (found.length !== 1)
          throw new Error(`Required list "${name}" missing or ambiguous.`);
        return found[0].id;
      };
      const requestListId = find("Workflow Requests"),
        clientListId = find("Clients");
      const [requests, clients] = await Promise.all([
        this.graph.all(`/sites/${site.id}/lists/${requestListId}/columns`),
        this.graph.all(`/sites/${site.id}/lists/${clientListId}/columns`),
      ]);
      const schema = validateSchema(requests, clients);
      if (schema.maps.requests["Requested By"]?.personOrGroup) {
        for (const key of [
          "SP_ALANNA_USER_LOOKUP_ID",
          "SP_JOSH_USER_LOOKUP_ID",
        ])
          if (!/^\d+$/.test(process.env[key] || ""))
            schema.errors.push(
              `Requested By is a person column: configure verified ${key}.`,
            );
      }
      this.cache = {
        ...schema,
        siteId: site.id,
        requestListId,
        clientListId,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      console.error("SharePoint schema check failed:", {
        name: e?.name,
        message: e?.message,
        code: e?.code,
      });
      this.cache = {
        errors: [
          e.message.startsWith("Required list")
            ? e.message
            : "Could not read the SharePoint site and list schemas. Check tenant credentials, Sites.Selected grant and connectivity.",
        ],
        checkedAt: new Date().toISOString(),
      };
    }
    return this.cache;
  }
  ready() {
    if (this.cache.errors.length) throw new Error(this.cache.errors.join(" "));
    return this.cache;
  }
  async requests() {
    const s = this.ready();
    return this.graph.all(
      `/sites/${s.siteId}/lists/${s.requestListId}/items?$expand=fields`,
    );
  }
  async request(id) {
    const s = this.ready();
    return this.graph.read(
      `/sites/${s.siteId}/lists/${s.requestListId}/items/${encodeURIComponent(id)}?$expand=fields`,
    );
  }
  async clients() {
    const s = this.ready();
    return this.graph.all(
      `/sites/${s.siteId}/lists/${s.clientListId}/items?$expand=fields`,
    );
  }
  async client(p) {
    const s = this.ready();
    const m = s.maps.clients;
    const rows = await this.clients();
    const matches = rows.filter(
      (row) =>
        (p.client_id && row.fields[m["Client ID"].name] === p.client_id) ||
        row.fields[m["Opportunity ID"].name] === p.opp,
    );
    if (matches.length > 1)
      throw new Error(
        "Multiple Clients rows match this opportunity. Josh must resolve the duplicate.",
      );
    return matches[0];
  }
}
