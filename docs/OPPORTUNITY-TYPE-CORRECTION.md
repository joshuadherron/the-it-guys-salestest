# Opportunity type correction and SharePoint routing

## Confirmed cause

The reported screen was `/prospects/86/handoff`. The user confirmed that OPP-0086 was saved as **BII / Standardization**. The MIT/BII service choices were therefore the expected legacy handoff template for its saved classification. This was not evidence that a correctly classified Project/Hourly opportunity rendered the MIT/BII form. The public universal-pipeline scripts matched main commit 6ddb7f6, although asset checks alone do not identify a running server process. Migration 013 conservatively classifies legacy opportunities as BII unless their saved lane was Managed IT.

The attempt to correct the saved type exposed a separate implementation restriction: editing rejected all type changes once discovery existed. A further routing issue sent generic `/handoff` GET links to the overview before the dedicated Business Technology Projects route could handle them.

## Changes

- The owner can correct an open opportunity before quotes or service workflow history exists. Completed/unsuccessful CRM-only syncs are not service enrollment and do not lock the type. Shared customer identity is retained. Closed sales, recorded authorization, quote history, started workflows and an opportunity's own existing client linkage remain protected. Existing-customer opportunities explicitly linked through the shared business may be corrected without replacing that customer.
- The correction and normal opportunity edit run in one transaction under the opportunity row lock, with a fresh enabled-owner check. The form records its original type, so a stale type selection is rejected.
- Existing discovery is archived in an appended `discovery_versions` revision, including its original answers, status, flags and original revision number. No old revision is overwritten/deleted. The active discovery gets a new revision and Draft status. Compatible fields remain when changing within a questionnaire family; changing between detailed MIT/BII and lightweight Project/Hourly starts the appropriate fresh questionnaire.
- Earlier flags are retained as historical concerns, displayed with a discovery history link, and cannot be stripped by posting client-controlled fields. The prospect hold is never cleared by changing type. Normal owner hold-review and quote-approval protections remain in force.
- The previous service plan is saved in an activity before stale lane/sequence selections are cleared. The new service lane derives from the saved opportunity type. Project/Hourly always uses Business Technology Projects and never submits MIT/BII enrollment requests. Any Managed IT-only Technical Assessment pipeline selection is returned to Discovery when correcting to another service type, subject to the existing hold restriction.
- Generic `/handoff` GET links now lead directly to `/project-sharepoint`. Legacy handoff POST commands remain blocked for generic opportunities. Managed IT/BII retain their existing service choices.
- SharePoint screens show the saved type. Project/Hourly identifies the automatically selected Business Technology Projects lane and the existing-record reuse behavior. Missing schema/flow configuration is displayed explicitly and disables the unavailable button while the server continues enforcing the same prerequisites.
- The Customer relationship screen also offers Business Technology Projects in its new-service lane list. Selecting it for an open MIT/BII prospect invokes this same protected type correction to One-Time Project before saving the relationship, within one transaction. It does not silently mismatch the lane and stored type. Project/Hourly prospects keep Business Technology Projects locked automatically, including against forged Managed IT values. Selecting an existing customer reuses that identity and creates no Workflow Request. Other lane corrections use the same quote/workflow/history guards.

## Data and deployment

No new migration, SharePoint schema edit, Power Automate edit or production data correction is performed by this patch. It reuses `discoveries`, `discovery_versions`, `activities` and the business identity introduced in migration 013. Existing Business Technology Projects prerequisites from UNIVERSAL-PIPELINE-ROLLOUT.md still apply; this patch does not bypass them or implement live flow changes.

After deploying this patch, Josh can open OPP-0086 → Edit opportunity, select One-Time Project or Hourly / Break-Fix, and save, provided it still has no quotes or started SharePoint workflow. Review the new intake and any earlier concerns, complete its required questions, then open SharePoint. The screen should show Business Technology Projects with no MIT/BII service selector. If the business has a record, the existing identity is reused. Missing Business Technology Projects configuration remains visible and blocks new requests until resolved.

Tests cover archive preservation, compatible/incompatible questionnaire changes, old risk preservation, stale edits, permissions, commercial-history restrictions, shared identity, rollback, correct GET routing, rejected legacy POSTs, configuration messaging and escaped discovery history. The full test suite, lint and production source/view validation are required before release.

## Completed CRM sync history correction

The user then reported the workflow-history guard blocking OPP-0086 and supplied request history showing `UpsertProspect · Done`, with results confirming updates to Sales Prospects. The guard incorrectly treated every non-dry-run request as service workflow history. Both the opportunity edit and relationship selection paths now use an action-aware check:

- Dry-run requests remain nonblocking.
- `UpsertProspect` with Done, Failed or Rejected is CRM-only history and does not block classification changes or relationship linking.
- Preparing, Pending, Processing, Unknown and unrecognized CRM states still block until completed or reconciled.
- Non-dry-run service requests still protect type changes, including Done/Failed/Rejected service work that may have created records. Errors now identify the exact request ID, action, status and handoff path instead of the blanket history message.
- The existing owner ability to reconcile a failed service attempt by linking an existing client without changing type is preserved. If that relationship submission also changes type, the stricter service-history check runs again.

No history is deleted or marked successful to bypass a guard. No migration, production record changes or live workflow actions are part of this patch.

Verified locally, including the relationship lane and CRM sync follow-ups: all **508 tests passed**, lint passed, and the production validation checked 94 JavaScript sources, 36 EJS views and both pinned legacy DOCX masters. No production records or external workflows were changed during these checks.
