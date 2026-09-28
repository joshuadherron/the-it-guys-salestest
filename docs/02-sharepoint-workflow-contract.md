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
- **Client Operations** (library): the client folders and working copies. **The app never writes files here.** Flows do.
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

**Not in v1:**
- Advance Stage is not built in v1; Josh advances stages in SharePoint.
- Item Completed, Create Working Copy and Request Exception: technical and document steps Josh does in SharePoint.
- eSignature: the send click is always by hand in Microsoft 365.

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
