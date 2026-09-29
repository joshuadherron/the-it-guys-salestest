# SharePoint Operations: Workflow Contract for the Sales App

**v1.1 alignment (2026-09-28):** The owner-supplied live-flow contract takes precedence over the frozen blueprint below. No live flows or SharePoint schema were changed by the app.

**Source:** The IT Guys SharePoint Operations Blueprint v1 (frozen 2026-09-22) and the flow readmes (Create Client, Start Stage, Stage Gate, eSignature, BII price-first rows). Condensed for app builders. Where this conflicts with a live SharePoint list, **the live list wins**. The app must read column names and choice values at runtime and stop with a clear error if something it needs is missing. Never guess.

## Site and lists
- **Site:** `https://theitguys713.sharepoint.com/sites/TheITGuysOperations`
- **Clients** (list): one row per client. It includes Title (client name = folder name), Client ID (`CL-xxxx`), Opportunity ID, Current Stage, Stage Status, Service Lanes (multi), Client Owner, Technical Owner, Next Action, Open Blocking Items, Go-Live Date and Record Type.
- **Workflow Requests** (list): **the ONLY thing the sales app writes to.** Columns include:
  - Title
  - Request Type (choice)
  - Processing Status (Pending / Processing / Done / Rejected / Failed)
  - Source (choice; currently Manual and Flow; **the app needs a "Sales App" value, and if it's missing the app must stop and tell Josh**)
  - Requested By
  - Client (lookup)
  - Service Lane
  - Payload (plain JSON text)
  - Result Message
- **Client Workflow Definitions** (list): the workflow rows (MIT-xx, BII-xx). Read-only for the app.
- **Client Operations** (library): the client folders and working copies. **The app never writes files here.** Flows do. The Sales App may update only the narrow signature-control metadata needed to trigger or record the Microsoft 365 eSignature handoff: Internal Notes Removed, Signature Status, and (when present) Signature Sent Date.
- **Operational Standards & Templates** (library): masters. **The app never touches it.**

## How work happens
The app creates a Workflow Request item with **Processing Status = Pending**, **Source = Sales App**, a Request Type and a JSON Payload. Power Automate flows pick it up, one at a time, and set Processing Status to Done, Rejected or Failed with a Result Message. The app polls the item and shows the result in plain language. Rejected is a normal business outcome with a reason (show it); Failed means a real error (show it and tell Josh).

### Request types the app may create
| Request Type | Payload | Who may trigger it in the app |
|---|---|---|
| **Create Client** | `{"opportunityId":"OPP-xxxx","client":"<Business Name>","stage":"Sales Discovery","serviceLane":"Business IT Integration" \| "Managed IT","discovery":{...}}` | Alanna or Josh, once the opportunity is qualified |
| **Start Stage** | `{"clientId":"CL-xxxx","stage":"Quoting","serviceLane":"Business IT Integration"}`. Optional `dueDate` (yyyy-MM-dd). | **Josh only** (owner role) |
| **Start Stage** | `{"clientId":"CL-xxxx","stage":"Technical Assessment","serviceLane":"Managed IT"}` | **Josh only** (owner role) |
| **Mark Lost** | `{"clientId":"CL-0007","reason":"Chose another provider","notes":"optional","expectedStage":"Quoting"}` | **Josh only**, linked clients before Client Activation |

**v1.2:** Advance Stage, Item Completed, Create Working Copy and Request Exception are available through Workflow Requests. No library fields are written by the app.

**Still outside the app:**
- Microsoft 365 eSignature's actual **Request signatures / Send** click is always performed by a person in Microsoft 365. The Sales App now owns the surrounding metadata handoff: **Prepare for signature** sets Internal Notes Removed = Yes and Signature Status = Ready to send; after the user actually sends the eSignature request, **Mark sent for signature** records Sent - awaiting signature and Signature Sent Date when that column exists.

### Stage values (Clients → Current Stage choice, lifecycle order)
Sales Discovery → Technical Assessment → Risk Review → Quoting → Contracting → Client Activation → Onboarding → Go-Live → Operations → … → Project Delivery → Acceptance → Offboarding → Closed (Closed - Lost / Closed - Former Client). **Read the exact values from the list.** Don't hard-code beyond display order.

### Lanes
"Managed IT" and "Business IT Integration" (read the exact values from the list).

### BII lane (price-first, owner decision 2026-09-26)
Sales Discovery (BII-01 Business Discovery Form) → **Quoting** (BII-05 short-form Quote/SOW + BII-14 MSA, both signed with Microsoft 365 eSignature) → **Project Delivery** (TRA, DMP, implementation) → **Acceptance**.
- There is **no Technical Assessment before the quote** unless Josh chooses a targeted pre-quote assessment because a stop condition exists.
- The sales app therefore hands a BII opportunity to Josh for a **commercial quote**, not "to Technical Assessment".

### Managed IT lane
Sales Discovery → Technical Assessment (MIT-02, started by Josh with Start Stage) → Risk Review → Quoting → Contracting → Client Activation → Onboarding → Go-Live → Operations.

### Rules the app must respect
- Owners: Client Owner defaults to Alanna and Technical Owner to Josh. The flow fills them only if blank.
- Rename safety: the client folder name = Clients Title. The app must never rename a client once it's created in SharePoint.
- One request at a time per client. Don't submit a new stage request while one for that client is Pending or Processing (read the list first).
- Idempotency: the app stores the Workflow Request ID it created and never resubmits automatically. The user must explicitly retry.


## Discovery snapshot on Create Client

Create Client retains opportunityId, client, stage and serviceLane and adds a JSON object named discovery. It contains form (`BII Business Discovery Form v0.3 + v0.4 corrections`), opportunityId, status, revision, capturedBy (actor for the saved revision), exportedAt (UTC ISO timestamp), mvdComplete, flag codes, hold metadata, and every question in schema order. State keys remain answered / not_sure / not_discussed. Non-answer values remain null. Answered values use the summary's format(); repeatable app entries are full arrays of objects, not the summary's three-entry excerpt. Explicit None retains the summary text. Stored discovery answers are unchanged.

The flow writes the snapshot once to `Client Operations/<Client>/Assessments/<Client> - Discovery Handoff - <yyyy-MM-dd>.json`. It is internal, including flags; the app does not send these to any other destination. Later app edits do not resync. The complete JSON payload must be at most 60,000 characters; larger payloads are refused, never truncated. Dryrun stores the full request body locally without Graph writes.

## Mark Lost

Only these exact reasons are accepted: Price; Chose another provider; Staying with current IT; No decision / went dark; Not a fit (disqualified); Timing (revisit later); Other. Migration 005 seeds config_lost_reasons. Admin lets the owner enable/disable and reorder these values; it cannot introduce unsupported free text. Notes are optional, up to 500 characters.

expectedStage is the Clients Current Stage shown when the handoff page was loaded, retained in the authenticated session. The app checks the live stage before submitting and sends the reviewed stage to the flow for its own stale-stage check. Allowed pre-activation stages are Sales Discovery, Technical Assessment, Risk Review, Quoting and Contracting. Client Activation and later (including Project Delivery, Acceptance and Operations), closed states and unknown stages are blocked; signed clients require Start Offboarding in SharePoint.

Mark Lost uses Request Type Mark Lost, the prospect's lane, known Client lookup and the normal SALESAPP-<OPP>-MarkLost-<stamp> title. Local active/uncertain requests and remote Pending/Processing requests block another submission. Done closes the local pipeline and records an audit marker in one transaction; repeated polling or reconciliation cannot apply it twice. Rejected retains the local stage and shows the flow's Result Message. Linked prospects cannot be newly set to Closed Lost through plain pipeline editing; unlinked prospects retain the local owner-only action.

## Schema and name checks

Source must be exactly `Sales App`. `Sales app` is not accepted; the checker tells Josh to rename it in Workflow Requests settings. A missing Mark Lost Request Type disables only Mark Lost; missing shared columns or choices still block all handoffs. Title resolves by internal name Title on both lists, and the Clients opportunity column by TIG_SalesOpportunityID regardless of display labels.

Create Client and prospect edits reject business names containing `" * : < > ? / \ | # %` or a leading/trailing period. Existing data is not rewritten. The client-name rename lock remains in force after SharePoint creation. Create Client still requires Qualified-or-later plus complete MVD; Quoting remains owner-only with an Approved quote and BII lane; Technical Assessment remains owner-only and Managed IT only. Stop conditions remain TODO-OWNER pending Josh's list.


## Guided workflow v1.2 — 2026-09-28

The prospect page is the primary workflow surface. Its next-step function follows the ordered discovery, pending-request, sales-stage, blocking-item, exception and advance-stage rules. The dedicated `/prospects/:id/discovery/summary` page exposes the full Josh summary. Today shows the owner a review queue; sales sees its count. Acknowledging an unsuccessful request updates local review metadata only and never clears an uncertain delivery or enables a retry.

| Request Type | Exact payload | Permission |
|---|---|---|
| Item Completed | `{"itemId":41,"completionStatus":"Complete","outcomeFlags":[]}` | Owner, or Alanna when resolved as the assignee; never unsigned signature items |
| Item Completed | `{"itemId":41,"completionStatus":"Not Required"}` | Owner, explicit confirmation |
| Request Exception | `{"itemId":41,"reason":"At least ten characters","reference":"Risk Acknowledgment file or approval note"}` | Owner; open blocking item with Exception Status None or Rejected |
| Create Working Copy | `{"clientId":"CL-0001","workflowId":"BII-05","instanceRef":"Branch 2","dueDate":"2026-10-01"}` | Owner; instanceRef and dueDate are optional |
| Advance Stage | `{"clientId":"CL-0001","serviceLane":"Business IT Integration","expectedStage":"Quoting"}` | Owner; includes the stage reviewed on the page |
| Start Stage | `{"clientId":"CL-0001","stage":"Project Delivery","serviceLane":"Business IT Integration"}` | Owner; stage choices come from Clients, excluding Closed stages |

Existing BII Quoting approval and Managed IT Technical Assessment rules also apply in the More menu. Pending/Processing requests, including flow-created follow-ups, block every action. Item-level requests are matched through their client lookup or their item's membership in the client library records. Local Preparing/Unknown records block retry until reconciliation. Each request is stored and audited before dispatch; target_item_id identifies item actions. Dryrun stores the complete body and calls no Graph write method.

Stage Gate v1.1 makes the explicit outcomeFlags array authoritative, including `[]`. The exact allowed values are Material findings; Risk Acknowledgment required; Data Migration Preflight required; Network Integration referral; Advanced Technology Assessment required; Quote-ready; Not quote-ready; Separate project required; Client Service Schedule required. Only flags backed by an active Outcome flag definition in the client's lanes and present in the live library choices can be selected. Their labels identify the working copies they will issue. Connection checks look for a Done Item Completed request containing outcomeFlags as deployment evidence. Without evidence the owner sees a one-time session notice; this does not block the action.

Connection checks resolve Client Operations and Client Workflow Definitions by exact display name and verify their confirmed internal column names. Missing new request choices disable only their actions. Missing required Client Operations columns disable the work-item panel and identify the column. Missing definitions disable definition-dependent actions, while file-name fallback still permits reading items. Definitions refresh on connection check. Items cache for 30 seconds per client and invalidate on dispatch and observed Done/Rejected transitions. Every POST rereads current items before authorization.

Library item reads filter by TIG_ClientID and pending request reads filter by the resolved Processing Status column, both with `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly`. If Graph rejects the filter, the reader pages the full result and filters locally with a sanitized warning. Permission failures are not treated as filter failures.

Assignees resolve from TIG_AssignedToLookupId via the site's User Information List fields.EMail, cached for the process lifetime. Only configured verified environment mappings are used as fallback. Unresolved or conflicting fallback mappings display Assigned (unknown), with completion restricted to the owner.

Signature-required unsigned items complete through the signing flow. The app exposes owner-only signature controls so SharePoint metadata does not need to be edited manually: **Prepare for signature** updates only TIG_InternalNotesRemoved = true and TIG_SignatureStatus = Ready to send; **Mark sent for signature** updates only TIG_SignatureStatus = Sent - awaiting signature and the sent-date field when exactly one column has displayName Signature Sent Date. The actual Microsoft 365 eSignature send click remains manual. Signed Copy, Signed Date and Signed status are still owned by the signed-copy return flow. Missing, ambiguous or blank sent-date values produce Out for signature without a date or an error. TIG_SignedDate is the confirmed signed-date field.
