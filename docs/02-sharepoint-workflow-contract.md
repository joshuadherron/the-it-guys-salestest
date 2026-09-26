# SharePoint Operations: Workflow Contract for the Sales App

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
| **Create Client** | `{"opportunityId":"OPP-xxxx","client":"<Business Name>","stage":"Sales Discovery","serviceLane":"Business IT Integration" \| "Managed IT"}` | Alanna or Josh, once the opportunity is qualified |
| **Start Stage** | `{"clientId":"CL-xxxx","stage":"Quoting","serviceLane":"Business IT Integration"}`. Optional `dueDate` (yyyy-MM-dd). | **Josh only** (owner role) |
| **Advance Stage** | `{"clientId":"CL-xxxx","serviceLane":"...","expectedStage":"<current>"}` | Josh only |
| **Mark Lost** | `{"clientId":"CL-xxxx"}` or `{"opportunityId":"OPP-xxxx"}` | Josh, or Alanna for clients she owns (confirm payload with Josh; see open questions) |

**Not in v1:**
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
