import { actionTypes, workPayload } from "./work-items.js";
import { WorkReader, filteredRead } from "./sharepoint-work.js";
import {
  validateBusinessName,
  lostPayload,
  serializePayload,
} from "./workflow-contract.js";
import { lanes } from "./config.js";
import { prospectLifecycle } from "./prospect-lifecycle.js";
import { genericEngagement,projectLane } from "./engagement-types.js";
import { assertProjectCapability,projectDocument } from "./project-contract.js";
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
    "Request Type": [
      "Create Client",
      "Upsert Prospect",
      "Start Stage",
      "Mark Lost",
      "Item Completed",
      "Request Exception",
      "Create Working Copy",
      "Advance Stage",
    ],
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
  const actionErrors = Object.fromEntries(
    ["MarkLost", "UpsertProspect", ...Object.keys(actionTypes)].map((key) => [key, []]),
  );
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
            [
              "Mark Lost",
              "Item Completed",
              "Request Exception",
              "Create Working Copy",
              "Advance Stage",
              "Upsert Prospect",
            ].includes(choice)
          ) {
            for (const [key, type] of Object.entries({
              MarkLost: "Mark Lost",
              UpsertProspect: "Upsert Prospect",
              ...actionTypes,
            }))
              if (type === choice)
                actionErrors[key].push(
                  `Workflow Requests Request Type is missing choice "${choice}".`,
                );
          } else if (
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
  const hipaa = clientColumns.filter((c) => c.displayName === "HIPAA" && c.boolean);
  if (hipaa.length === 1) maps.clients.HIPAA = hipaa[0];
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
  if (action === "UpsertProspect") {
    return {
      opportunityId: p.opp,
      salesAppRecordId: p.id,
      businessName: p.business_name,
      contactName: p.contact_name || "",
      phone: p.phone || "",
      email: p.email || "",
      streetAddress: p.street_address || "",
      city: p.city || "",
      state: p.state || "",
      zip: p.zip || "",
      employeeCount: p.employee_count ?? null,
      stage: p.stage,
      status: prospectLifecycle(p).status,
      convertedClientId:prospectLifecycle(p).convertedClientId,
      owner: p.owner || "",
      likelyService: p.likely_service || "",
      currentIt: p.current_it || "",
      keyDependency: p.key_dependency || "",
      notes: p.notes || "",
      firstContact: p.first_contact || null,
      followUp: p.follow_up || null,
      nextAction: p.next_action || "",
      nextActionDate: p.next_action_date || null,
      source: "Sales App",
      syncedAt: new Date().toISOString(),
    };
  }
  const project=lane===projectLane;
  if(project&&(!genericEngagement(p)||!p.business_id||!["CreateClient","CreateWorkingCopy"].includes(action)))throw new Error(`${projectLane} requests require a linked project/hourly opportunity and the project request contract.`);
  if(project&&action==="CreateWorkingCopy"&&(!/^PRJ-[A-Z0-9-]+$/.test(options.workflowId||"")||!/^\d+$/.test(options.instanceRef||"")))throw new Error("Project working copies require a PRJ workflow and a quote-specific numeric instance reference.");
  if (!lanes.includes(lane)&&!project) throw new Error("Choose a service lane.");
  if (action === "CreateClient") {
    if (p.client_id || p.relationship_type === "existing_client")
      throw new Error("Existing or linked customers cannot create another SharePoint client.");
    validateBusinessName(p.business_name);
    if (
      !options.discovery ||
      typeof options.discovery !== "object" ||
      Array.isArray(options.discovery)
    )
      throw new Error("A discovery snapshot is required to create the client.");
    if(project&&(options.discovery.contractVersion!=="project-v1"||String(options.discovery.businessId)!==String(p.business_id)))throw new Error("Project creation requires the versioned project intake snapshot.");
    return {
      opportunityId: p.opp,
      client: p.business_name,
      stage: "Sales Discovery",
      serviceLane: lane,
      discovery: options.discovery,
      ...(project?{contractVersion:"project-v1",businessId:String(p.business_id),engagementType:p.engagement_type}:{}),
    };
  }
  if (action === "MarkLost") return lostPayload(p, options);
  if (actionTypes[action]) return {...workPayload(action, p, lane, options),...(project?{contractVersion:"project-v1",serviceLane:projectLane,businessId:String(p.business_id),opportunityId:p.opp,engagementType:p.engagement_type}: {})};
  if (!p.client_id) throw new Error("Open the SharePoint record first.");
  if (action === "Quoting" && lane === "Business IT Integration")
    return {
      clientId: p.client_id,
      stage: "Quoting",
      serviceLane: lane,
      prepareBaa: Boolean(options.prepareBaa),
    };
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
  env=process.env,
) {
  if(lane===projectLane)assertProjectCapability(schema);
  if(lane===projectLane&&action==="CreateWorkingCopy"&&options.workflowId!==projectDocument(p.engagement_type==="hourly"?"ENG-HRLY":"ENG-PRJ",env).workflow)throw new Error("The project working-copy workflow must match the approved quote type.");
  if (schema.actionErrors?.[action]?.length)
    throw new Error(schema.actionErrors[action].join(" "));
  const body = payload(action, p, lane, options);
  if(action==="UpsertProspect" && schema.prospectRecordColumn && p.sharepoint_record_id)
    body.sharepointRecordId=p.sharepoint_record_id;
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
    actionTypes[action] ||
      (action === "CreateClient"
        ? "Create Client"
        : action === "MarkLost"
          ? "Mark Lost"
          : action === "UpsertProspect"
            ? "Upsert Prospect"
            : "Start Stage"),
  );
  put("Processing Status", "Pending");
  put("Source", "Sales App");
  if (action !== "UpsertProspect") put("Service Lane", lane);
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
      (body.itemId &&
        (!p.work_item_ids || p.work_item_ids.includes(String(body.itemId)))) ||
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
    this.work = new WorkReader(this);
    this.cache = { errors: ["SharePoint connection has not been checked."] };
  }
  async check() {
    try {
      const site = await this.graph.read(sitePath);
      const lists = await this.graph.all(
        `/sites/${site.id}/lists?$select=id,displayName,system`,
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
        businessColumn:clients.find(c=>c.name==="TIG_SalesBusinessID"&&c.text&&c.enforceUniqueValues&&c.indexed)?.name||null,
      };
      await this.work.check(lists);
      this.cache.prospectRecordColumn=null;
      const prospects=lists.filter(l=>l.displayName==="Sales Prospects");
      if(prospects.length===1) {
        try {
          const columns=await this.graph.all(`/sites/${site.id}/lists/${prospects[0].id}/columns`);
          const matches=columns.filter(c=>c.name==="TIGP_SharePointRecordID" && c.text);
          if(matches.length===1)this.cache.prospectRecordColumn=matches[0].name;
        } catch { /* Optional field sync is disabled until schema is verified. */ }
      }
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
  async requests(pendingOnly = true) {
    const s = this.ready();
    const path = `/sites/${s.siteId}/lists/${s.requestListId}/items?$expand=fields`;
    if (!pendingOnly) return this.graph.all(path);
    const status = s.maps.requests["Processing Status"].name;
    return filteredRead(
      this.graph,
      path,
      `fields/${status} eq 'Pending' or fields/${status} eq 'Processing'`,
      (r) => ["Pending", "Processing"].includes(r.fields?.[status]),
    );
  }
  async workItems(clientId, fresh = false) {
    return this.work.items(clientId, fresh);
  }
  invalidateWorkItems(clientId) {
    this.work.itemsCache.delete(clientId);
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
        (p.client_id ? row.fields[m["Client ID"].name] === p.client_id :
          (s.businessColumn&&p.business_id&&String(row.fields[s.businessColumn])===String(p.business_id)) ||
          p.relationship_type !== "existing_client" && row.fields[m["Opportunity ID"].name] === p.opp),
    );
    if (matches.length > 1)
      throw new Error(
        "Multiple Clients rows match this opportunity. Josh must resolve the duplicate.",
      );
    return matches[0];
  }
}
