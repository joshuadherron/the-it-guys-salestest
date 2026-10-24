# Quick Quote — October 24, 2026

The sales flow is **choose/add business → build quote → Preview → Send**.
Use Quick Quote on the dashboard or New quote / proposal on a business workspace.
An existing business gets another local opportunity under its shared identity.
Adding a business creates local business/prospect records only. New businesses
need business name, contact name and email; phone is optional.

The separate Add prospect form defaults to New prospect / business and requires
only the business name. Contact details are visible; opportunity, address and
other details are collapsed and optional. Existing-business selection is an
explicit alternative that reuses its identity and prefills contact details.
Switching back restores the unsaved new-prospect fields. Save and build a quote
creates local records and opens the builder without a SharePoint sync step.

Managed IT, BII and Project use the existing validators, pricing engines, template
fields and pinned DOCX binaries. Preview downloads draft Word and shows saved
lines/terms; it does not approve or write to SharePoint. Missing facts stay visible.
Holds permit drafts/previews but refuse Send. Hourly estimates retain their existing
approved template and manual-send workflow.

## Approval and delivery

Send requires authenticated CSRF-protected POST and freshly rechecked quote.send.
An owner or quote.approve user records approver, UTC timestamp and snapshot hash.
The preview hash and current price/line match are mandatory. There is no separate
Approve form, confirm-counts checkbox or mandatory stop-review checkbox in Quick
Quote. Preview is the review. Optional stop conditions are never auto-ticked;
selecting one changes Send to Send anyway and records its acknowledgement.

A sender without approval permission creates Waiting for Josh with no approval
or external write. The dashboard lists it. Josh's one Approve & Send action
preserves the requester's quote and selected findings; incoming fields cannot
replace a pending request's options.

- Managed IT: existing live PDF conversion, text/eTag checks, Commercial save and
  scoped shared mailbox, governed by QUOTE_SEND_MODE.
- Project: same transport, retries, permissions and hash checks with ENG-PRJ
  fields and project email referencing the Quote ID. Never uses Managed IT monthly
  amounts or MSA/CSS promises. The approved document retains its scope and terms.
- BII: fill ends at Ready for signature. Shows the Quote/SOW and unsigned PSA copy
  when available, with SharePoint links and Mark sent for signature. No automatic
  email or signature metadata write. Mark sent records actual eSignature dispatch,
  never customer acceptance, signature completion or work authorization.

## Persistence, resume and migration

Apply **014_quick_quote_sends.sql** manually before deployment. It adds one small
queue/lease table keyed by Quote ID. Existing quote/proposal/fill/send records
retain approval data, workflow identities, copy linkage and delivery history.
No new environment setting is required; global write/send modes remain unchanged.

The progress page automatically polls POSTs: client folder → CRM sync → quote
copy → fill → delivery. No intermediate clicks are required. Opening the saved
Quick Quote URL resumes its job for any user with send permission. **No background
worker is added**: closing all quote pages pauses progress between bounded steps;
an already running request may finish. Reopening resumes with the saved actor,
not the viewer's identity. Database leases serialize simultaneous tabs/users.

Approval, hold/loss, sender permission and hash are rechecked while advancing.
Email intent is persisted before delivery. Interrupted Sending is never replayed.
Resume after a configuration refusal can continue preparation only if there is
no email attempt; email failures use existing saved-PDF retry/admin reconciliation.
Dryrun emails the saved actor only and displays Test email sent.

Own Preparing/Unknown requests older than two minutes are reconciled by exact
saved title against fresh SharePoint requests. An exact match supplies its real
status. No match continues waiting; only after ten minutes does the progress UI
show the owner's existing confirm-absent reconciliation form. There is no automatic
replay. Other opportunities' copy requests match only the same nonblank Client ID
and quote instance. Shared business allocation locks remain to prevent duplicate
customer creation. Null/empty IDs never produce a blank-client join/operation query.

## External flow inspection and remaining checks

The repository's `docs/02-sharepoint-workflow-contract.md` documents **Start Stage /
Quoting** creating BII-05 plus **BII-14 MSA**, both signed. The newer owner prompt
calls the companion agreement PSA. Current proposal preparation submits Create
Client and Create Working Copy for BII-05 only: **it does not submit Start Stage
or create a PSA**. The signature screen reads the live definition's PSA / Project
Services Agreement name; it does not silently treat an MSA as a PSA. A missing
PSA is reported for Josh to review in Quoting/Start Stage. No flows were changed.

No deployed Power Automate export is present in this repository or available in
local app configuration. The exact live BII/MIT Create Client expression that may
reject incomplete discovery therefore **cannot be verified**. The app submits
available discovery plus discoveryComplete false, without claiming live-flow
acceptance. Josh must inspect that flow's discovery-completeness condition and
verify staging requests, and confirm the actual PSA definition/creation branch.
Flow rejections are surfaced with their result message and request history.

Project readiness is exactly one PRJ-05 / Business Technology Projects definition
with Active and Create Client Copy enabled, plus lane choices and the unique
indexed TIG_SalesBusinessID column. Project snapshots allow partial/no intake,
with intakeComplete and approved quoteContext. Legacy snapshots add
discoveryComplete. Qualified sales stage is not required by proposal preparation.
Admin/troubleshooting record/preparation routes remain available separately.

## Removed gates and retained protection

| Removed sales gate/step | Protection now lives |
| --- | --- |
| Separate Approve form | Send/Approve & Send transaction, permission, timestamp/hash and audit |
| Confirm counts / reviewed-every-condition boxes | Preview and explicit Send; saved pricing and document/rate validation |
| Second Continue Anyway checkbox | Optional preview findings; Send anyway records acknowledgement |
| Complete project intake before folder/proposal | Partial snapshot; complete current intake at customer authorization/handoff |
| Complete MIT/BII discovery before proposal record | Available discovery plus discoveryComplete; agreements/discovery/BAA/stage gates remain at acceptance/authorization |
| Qualified stage before proposal record | Hold/loss checks at Send and governed lifecycle boundaries |
| Open record / Save proposal / Fill clicks | Automatic ProposalPreparation with identity, instance, request and eTag checks |
| Project-specific environment opt-in | Live PRJ-05 definition plus existing schema checks |
| Service lane already enrolled before quoting reused client | Quote definition/routing checks; enrollment remains a governed acceptance action |
| Blank Client ID joins unrelated prospects | Prospect-only lookup without Client ID; no blank operation-lock lookup |
| Broad unrelated-opportunity Workflow Request blocking | Actual client/instance match; shared business allocation locks remain |
| Immediate manual reconciliation for own uncertain request | Automatic exact-title lookup after two minutes; owner confirm-absent only after ten |

Local tests perform no live SharePoint writes. Production flow acceptance, mail
transport and signature routing need staging verification. Merge/deployment
require owner approval after migration 014.
