# Codex task: build v1 of the The IT Guys sales app (sales.theitguys.us)

You're building the first working version of an internal sales app for **The IT Guys LLC**, a two-person MSP in Southeast Texas.
- **Alanna** (sales) uses it on her phone and laptop while prospecting and running discovery calls.
- **Josh** (owner, sole technician) uses it to review what Alanna captured, approve quotes and push qualified clients into the company's SharePoint workflow.

Read everything in `docs/` before writing code:
- `docs/01-business-discovery-form-v0.3.md`: **frozen spec.** Implement it exactly. Don't add, remove or reword questions.
- `docs/02-sharepoint-workflow-contract.md`: how the app talks to SharePoint (through one list only).
- `docs/03-commercial-rules.md`: the only prices and counting rules you may use.

If the repo already contains code, inspect it first and extend it; don't rewrite working parts. If it's empty, scaffold from scratch.

## Fixed decisions (do not change)
1. **Stack:** Node.js 22, a single Express server (`server.js` entry), MySQL 8 (`mysql2/promise`, parameterized queries only), server-rendered views (EJS) plus small vanilla-JS enhancements. No SPA framework, no ORM, no TypeScript build step. Keep dependencies few and mainstream (express, ejs, mysql2, express-session + a MySQL session store, helmet, csrf protection, @azure/msal-node, dotenv, and a CSV parser). Justify anything else in the README.
2. **Hosting:** Hostinger Node.js hosting, with a Hostinger MySQL database. It must run with `npm start`, read `PORT` from env, and have no native build steps.
3. **Secrets:** Microsoft Graph credentials live **only** in server-side environment variables (`.env` locally, the Hostinger env panel in production). Never send tokens or secrets to the browser, and never commit them. Ship `.env.example`.
4. **Sign-in:** Microsoft Entra ID sign-in (MSAL Node, auth-code flow) for the theitguys.us tenant, plus an **allowlist** in config: `alanna@theitguys.us` = role `sales`, `josh@theitguys.us` = role `owner`. Everyone else is refused after sign-in. No local passwords.
5. **SharePoint is the system of record for clients and documents.** The app's only SharePoint write is **creating items in the Workflow Requests list** (see docs/02). It never creates, edits or moves files, and never edits the Clients, Definitions or library items. Power Automate flows do all the document work.
6. **Graph permissions (least privilege):**
   - An app registration with application permission **Sites.Selected**, granted write on the TheITGuysOperations site only.
   - **Mail.Send**, restricted with an Exchange application access policy to josh@theitguys.us as the sender.
   - Document in the README the exact admin steps Josh must run for both grants. Don't request Sites.ReadWrite.All.
7. **Safety switch:** `SHAREPOINT_WRITE_MODE=dryrun|live`, defaulting to **dryrun**.
   - In dryrun, the app builds and stores the exact request it would send, shows it and does **not** call Graph for writes.
   - Reads (list columns, choice values, request status) may still run when credentials exist.
   - Josh flips it to live himself.
8. **No new SaaS:** no HubSpot/CRM, no SignWell API, no Zapier. eSignature happens by hand in Microsoft 365 and isn't part of this app.

## What v1 must do
### A. Pipeline (replaces the Call Tracker spreadsheet)
- **Prospect record fields:** Business Name, Contact Name, Phone, Email, Date First Contacted, Employee Count, Current IT Situation, Key Dependency, Call Frequency Signal (Often / Sometimes / Rarely / Not sure), Likely Tier (Monitoring & Maintenance / Essentials / Standard / BII only / Not sure; a *signal*, labeled as such), Red Flag (existing MSP?), Stage, Follow-Up Date, Notes, Owner (default Alanna).
- **Auto-generated Opportunity ID:** `OPP-0001`, sequential and never reused.
- **Stages:** Prospecting → Qualified → Discovery → Proposal Sent → Closed Won → Closed Lost. Technical Assessment appears only for Managed IT. Keep this list in a config table.
- **Views:** "Today" (overdue and due follow-ups first), pipeline by stage, search, and a mobile-first quick-add. Alanna adds a prospect standing in a parking lot.
- **Call log:** per-prospect activity entries (call / visit / email / note, with an outcome) that feed the **Weekly Tracker** metrics, computed automatically per week: Calls Made, Conversations Had, Qualified Opportunities, Proposals Sent, Recurring Contracts Signed, Hourly/Project Jobs Picked Up. Include a weekly view.
- **Import:** a one-time CSV import of the existing Call Tracker Pipeline tab (the columns above, in that order) and Weekly Tracker tab, with a preview before commit.
- **Export:** CSV of both.

### B. Business Discovery (docs/01, implemented exactly)
- 9 screens with conversational, one-topic-per-screen layout, readable and tappable on a phone. Inline conditionals.
- Every question stores one of three states: an answer, **Not sure**, or **Not discussed** (the default). Never collapse them.
- Autosave on every change. The discovery links to its pipeline record. Back-navigation never loses data.
- **MVD gate:** the "Send to Josh" button is disabled until the 8 groups in §4 are satisfied. Show exactly which groups are missing.
- **Flag engine:** a pure function (answers → flags) with unit tests for every flag in §6, including the negative cases:
  - card payments alone ≠ regulatory
  - Q6.3a alone ≠ urgent
  - vendor-managed ≠ concern
  - FLAG-PROFILE-MIGRATION-LIKELY must not exist
- Flags and summaries are visible to **Josh and Alanna only**, never in anything customer-facing.
- **URGENT SECURITY REVIEW** (Q6.3b = Yes):
  1. Immediately email Josh via Graph `sendMail` (in dryrun, log it and show "would email").
  2. Mark the record **On Hold — Pending Josh Review**.
  3. Block quote and handoff actions until Josh clicks "Release hold" with a note.
  4. Show Alanna the §5 in-call guidance text.
- **Josh summary** exactly per §7: a condensed default view plus expandable full detail, including the Not sure / Not discussed inventory.
- **"Send to Josh":** marks the discovery Ready for Review and emails Josh a link (dryrun-safe). The discovery then becomes read-only for Alanna unless Josh reopens it. Keep a version history of answers (append-only audit table).

### C. BII quick quote (internal worksheet, Josh-approved)
- Inputs, prefilled from discovery and editable by Josh: users, managed business devices (split by platform for display; each counted once), mailboxes, new Dell deployments, personal phones (counted as 0), locations, plus checkboxes for owner-one-off items.
- The engine reads prices from a config table seeded from docs/03 and computes exactly per docs/03. Unit-test the worked example ($4,585) plus edge cases: at or below the included amounts = $3,750; zero devices; many devices; phones never counted.
- Owner-one-off items and additional locations show **"Priced by Josh"** with a free-entry amount only Josh can set, labeled `OWNER ONE-OFF — NOT STANDARD UNIT PRICE`.
- Hardware shows **"Quoted separately"**. No hardware math.
- **Status flow:** Draft (Alanna or Josh) → Approved (Josh only; stores approver + timestamp) → Sent (Josh marks it after sending the Quote/SOW from SharePoint).
  - A quote can't be approved while the discovery is on hold.
  - **Stop-condition review:** before approving, Josh sees a checklist of pre-quote stop conditions from a config table (seed it with the placeholder rows below, marked `TODO-OWNER`). If he ticks any, the quote can't be approved; the UI says "targeted assessment first".
  - Seed rows: urgent security hold; domain/admin access concern; server reported; regulatory data; multiple locations; data in personal accounts; existing MSP with a transition concern; non-Microsoft email platform.
- **Printable internal worksheet** (HTML print view) showing inputs, line items and the total. **No** client-facing document generation in v1: Josh fills the Short-Form Quote/SOW in SharePoint from this worksheet.

### D. SharePoint handoff (docs/02)
- **At startup, and on a "Check SharePoint connection" admin page (Josh only):**
  - Resolve the site and the Workflow Requests / Clients lists by display name.
  - Read their columns and choice values (Request Type, Processing Status, Source, Service Lane, Current Stage).
  - If a required column or choice value is missing (for example Source = "Sales App"), show a clear error naming it and disable the handoff buttons. **Never guess a name.**
  - Map display name → internal name at runtime and cache it.
- **Actions:**
  - **"Create client in SharePoint":** available to Alanna and Josh when the prospect is Qualified or later and has a completed discovery. It sends Create Client with the payload from docs/02. It picks the service lane from a required radio (BII / Managed IT), with no default.
  - **"Send to Quoting" (BII):** Josh only, requires an Approved quote. Sends Start Stage `{clientId, stage:"Quoting", serviceLane:"Business IT Integration"}`.
  - **"Start Technical Assessment" (Managed IT):** Josh only. Sends Start Stage `{clientId, stage:"Technical Assessment", serviceLane:"Managed IT"}`.
  - **"Mark Lost":** Josh only in v1.
- **Every request:**
  - Title `SALESAPP-<OPP-id>-<action>-<yyyyMMddHHmmss>`, Processing Status Pending, Source "Sales App", Requested By = the signed-in user.
  - Refuse to send if a request for that client/opportunity is already Pending or Processing (read the list first).
  - Store the created item ID and poll for its status every 30 s while the page is open, and on page load.
  - Show Done / Rejected / Failed with the Result Message, rewritten into plain English at the top and the raw text below.
  - When Create Client finishes, read the Clients row and store the returned **Client ID** on the prospect.
- Show the client's Current Stage, Stage Status and Next Action (read-only from the Clients list) on the prospect page. The app never writes the Clients list.

### E. Admin (Josh only)
- Config tables: prices, stages, stop conditions, allowlist.
- An audit log of every create/update/approve/handoff.
- The SharePoint connection check.
- A dryrun/live indicator banner on every page.

## Data and security requirements
- MySQL schema via numbered SQL migration files plus a tiny migration runner (`npm run migrate`). Seed data via `npm run seed`, from docs/03 and the discovery option lists.
- **Tables (suggested):** users/allowlist, prospects, activities, discoveries (answers as JSON **plus** state per question), discovery_versions, flags, quotes, quote_lines, config_prices, config_stages, config_stop_conditions, sp_requests, audit_log, sessions.
- **Security:**
  - helmet + CSP (no inline scripts)
  - CSRF on every POST
  - secure, httpOnly, SameSite=Lax cookies
  - server-side role checks on every route (the UI hiding a button isn't enough)
  - input validation
  - rate limiting on sign-in routes
  - no PII in logs
- **Backups:** document a nightly `mysqldump` approach for Hostinger in the README.

## Tests and quality bar
- `npm test` with Node's built-in `node:test`, **no network**. Graph is behind one module with a fake for tests.
- Required tests:
  - every flag rule and its negatives
  - the MVD gate: each group, "Not sure" counts, "Not discussed" doesn't
  - the urgent-hold state machine
  - the pricing engine (the docs/03 example and edge cases)
  - request payload builders (exact JSON per docs/02)
  - the refusal when a Pending request exists
  - role enforcement on owner-only routes
  - dryrun never calling Graph write methods
- `npm run lint` (eslint, basic config).
- **README:**
  - local setup
  - Entra app registration steps (redirect URI, Sites.Selected site grant command, Mail.Send + application access policy commands)
  - Hostinger deployment steps
  - environment variables
  - how to switch to live
  - known limits

## Out of scope for v1 (don't build)
- Public website pricing calculator (a separate project).
- Managed IT pricing.
- Client-facing documents or PDFs.
- eSignature.
- MSP Manager/ticketing integration.
- Technical Readiness Assessment.
- Any write to SharePoint other than Workflow Requests.
- Customer logins.

## How to work
1. Plan first. Write `PLAN.md` with the milestones below. Then implement them in order, committing after each one with a clear message:
   - M1 skeleton + auth + DB
   - M2 pipeline + activities + weekly + CSV import/export
   - M3 discovery + flags + MVD + urgent hold + summary
   - M4 BII quick quote
   - M5 SharePoint handoff (dryrun default) + connection check
   - M6 tests, lint, README
2. **Stop and ask instead of guessing** about anything that affects money, a SharePoint name, a legal or customer-facing statement, or a flag rule. Put those in `OPEN_QUESTIONS.md`, implement the safest behavior (disabled / dryrun / "Priced by Josh") and continue.
3. **Don't invent prices, stages, flags, question wording or SharePoint column names.**
4. **When done:**
   - `npm test` and `npm run lint` pass.
   - Summarize in `HANDOFF.md`: what works, what's stubbed, how to run it, and the open questions.

## Open questions already known (put them in OPEN_QUESTIONS.md; don't block on them)
1. The exact list of pre-quote stop conditions (seeded as TODO-OWNER placeholders).
2. Whether the Workflow Requests "Source" choice already has "Sales App" (Josh adds it if not).
3. The exact Mark Lost request payload and whether Alanna may trigger it.
4. Whether Alanna may create the SharePoint client, or only Josh (v1: both).
5. Pipeline stage names vs the old tracker (Technical Assessment removed for BII under price-first).
