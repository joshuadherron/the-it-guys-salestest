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

The server runs one bounded step per queued job every 30 seconds: client folder →
quote copy → fill → delivery (plus unsigned PSA copy for BII). CRM sync is dispatched
but never holds the quote. Browser polling reads status only. The worker starts
after SharePoint schema startup, uses the saved sender, and rechecks current
permission/hold/hash. A durable DB lease serializes app instances and authenticated
manual progress requests. Closing the page does not pause an authorized Send.

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

Read-only inspection on October 24 found Client Workflow Definitions row 31:
**BII-14 / Project Services Agreement / BII-PSA**, BII lane, Active and Create
Client Copy both Yes. The old MSA wording in the repository contract is historical.
When no signed or open PSA exists, Send requests its copy with the existing
CreateWorkingCopy contract and numeric quote instance. The request is persisted
in sp_requests and resumed by exact title; an uncertain request is never replayed.
No definitions or flows were modified. The signature screen uses actual working
file webUrls and names BII-PSA explicitly if configuration is missing.

The owner's live walkthrough confirmed Create Client accepted all three quote
types without discovery. This behavior is retained. Flow rejections still surface
their result messages and request history. See [walkthrough fixes and validation](QUICK-QUOTE-WALKTHROUGH-FIXES.md).

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
