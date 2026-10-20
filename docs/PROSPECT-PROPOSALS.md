# Prospect proposals

Save proposal to SharePoint ensures the existing Clients engagement row at Sales Discovery, ensures a quote-specific MIT-05/BII-05 working copy, and fills it. It never activates the client or sends email. No parallel library is created.

## Deployment prerequisites

1. Apply `migrations/011_prospect_proposals.sql` after 010 **before starting this version**. It adds prospects.sharepoint_record_id, the last observed SharePoint stage, and one durable quote_proposal_states row per quote. Existing links are backfilled. Quotes, quote_fills, quote_send_attempts and quote_operation_locks are preserved; delivery history still requires real client IDs. The proposal state hash covers approved pricing; current document facts are validated and included in each fill's full snapshot.
2. A read-only live inspection on 2026-10-19 confirmed MIT-05 (definition row 5) and BII-05 (row 22) both have Active = Yes and Create Client Copy = Yes. No definition rows were changed. Runtime still checks those values; refresh Admin connection check after any definition change.
3. Verify Create Working Copy accepts an explicit workflowId without changing Current Stage and deduplicates by clientId + workflowId + instanceRef. It must write instanceRef into a **text column on Client Operations**. Set QUOTE_INSTANCE_REF_COLUMN to that column's verified internal name. Without an override, connection check accepts a unique text column displayed as Instance Reference or Instance Ref. If missing, Josh must add it and map the flow's instanceRef into it. This column and flow mapping could not be verified through the connector; they were not changed. New-copy preparation stops without a verified column. Existing unambiguous legacy copies remain usable.
4. Run `node scripts/setup-prospect-proposals.js` with app credentials to check Sales Prospects. It is read-only by default. After operator review, `node scripts/setup-prospect-proposals.js --apply` adds only the missing TIGP_SharePointRecordID text column. Run Admin connection check afterward. Runtime omits sharepointRecordId from Upsert Prospect unless this exact internal text column is verified. No setup script was run against SharePoint here.
5. Update the existing Upsert Prospect flow to map payload.sharepointRecordId when supplied, payload.status, and payload.convertedClientId (clear Converted Client ID when null). Status must include Converted and Lost. Remove any Create Client step that prematurely marks Sales Prospects Converted. Only successful work-items reads observing Client Activation or a known later stage produce Converted; Mark Lost produces Lost and no Converted Client ID. These are instructions for Josh; no live list or flow was modified.
6. Preserve current modes. Creating missing records/copies requires SHAREPOINT_WRITE_MODE=live. Filling an existing copy continues to use QUOTE_FILL_MODE independently. No modes were enabled. Send remains a separate click; its existing dryrun still emails the signed-in user.

## Progress and retry

Preparation approval hashes bind inputs, priced line items, total and approval timestamp, using canonical JSON key order. Quote-number assignment and editable document facts do not count as pricing changes; the separate full fill/send snapshot still checks both. Matching legacy hashes upgrade in place without changing request/copy IDs. A mismatched baseline can be refreshed only for an untouched record_requested/record_ready state with no request IDs, working copy, fill ID, fill/send history or client operation lock; it is audited and all pricing/master checks still run before any external action. After progress, a mismatch returns HTTP 409 and requires a revised quote or reconciliation. No migration or deletion of proposal history is needed for this recovery.

Review document facts, then click Save proposal to SharePoint. Browser polling makes one bounded POST per step and shows Pending/Processing progress. Leaving stops polling; Resume continues from saved request IDs. A GET alone cannot start preparation: automatic continuation requires a session marker set by the document-facts POST.

The durable state tracks record_requested, record_ready, copy_requested, copy_ready, filled, request IDs (including record-ID prospect sync), working item ID, fill ID, errors and timestamps. Its own prospect-sync request is polled before copy creation so it does not block preparation as an unrelated request. A 120-second per-quote lease excludes concurrent clicks. Request identity is committed before Graph dispatch; the prospect row and client request mutex serialize creation against other quotes/workflow actions. Preparing/Unknown submissions require exact-title reconciliation and are never blindly replayed. Confirmed Rejected/Failed requests surface the flow reason; the next explicit click rechecks record/copy existence before retrying. Done requests with outputs not yet readable stay waiting. ETag fill failure reuses the same copy; uncertain fills retain the existing durable client operation lock for reconciliation.

New quotes use Quote ID as instanceRef. Fresh resolution validates client, workflow, exact instance, open status, drive metadata, Commercial folder, and BII Preparing status. Sending selects the drive item recorded by the selected quote's latest fill, allowing multiple open quotes. A single unreferenced legacy copy may be claimed only when no other quote claims it or has a successful fill for that client. Approved revisions get new IDs/copies; old documents stay.

Josh may explicitly choose Supersede previous proposal on a referenced open MIT-05/BII-05 item. He must enter a newer approved Quote ID already saved to SharePoint. The existing Item Completed request carries completionStatus Cancelled and outcomeFlags []; the old document stays. Signing/signed copies are refused. Verify the existing flow accepts Cancelled and that the library choice exists before using this action. Save and Send never supersede automatically.

## Audit of client_id assumptions

All current source references were reviewed, grouped by component:

| Files | Finding |
|---|---|
| docfill/delivery-store.js, delivery.js, policy.js, sharepoint-quotes.js | Delivery needs a real Clients row; preparation now ensures it first. The old single-open-copy assumption becomes exact instance selection or selection by the latest fill's drive item. No placeholder IDs. |
| handoff.js, sharepoint.js, workflow-contract.js | IDs identify operational engagement records, not conversion. Create completion also stores sharepoint_record_id; request payloads and Mark Lost remain on existing workflows. |
| work-items.js, guided-workflow.js, sharepoint-work.js | Operational reads/actions still require the real ID. Successful work-item/stage reads trigger conversion bookkeeping. Only a schema-verified instance column is normalized. |
| next-step.js, pipeline.js | Approved opportunities can Save without manual record-creation steps. The status label distinguishes Prospect, Opportunity in SharePoint and Client. Linked-record edit/name protections remain. |
| existing-clients.js, existing-client-rules.js | Existing-customer links, additional discovery, transitions and client request mutex stay enforced. No second record is created for existing customers. |
| admin.js, docfill/reconcile.js | Existing uncertain fill/send reconciliation still uses actual client IDs and durable locks. |
| prospect-lifecycle.js, prospect-lifecycle-sync.js, prospect-sync.js | A record ID alone never implies Converted. Activation observation controls conversion; Lost overrides prior activation. Existing sync retry is retained. |
| Views and migration 011 | UI terminology changes without SharePoint renames; existing links get the separate record ID field. |

## OPP-0080 acceptance on salestest

Run after migration and operator flow/schema checks. This procedure intentionally creates live Workflow Requests and fills the approved working copy. No email is sent unless a person separately clicks Send.

1. Sign in with quote.send, open OPP-0080's Approved quote, verify current prices/document facts, completed discovery, and no hold.
2. Click Save proposal to SharePoint. Observe record_requested, copy_requested, filled. Verify exactly one Create Client at Sales Discovery when missing, then Create Working Copy with workflowId MIT-05 and instanceRef = Quote ID. An existing OPP Clients row must be reused.
3. Verify Current Stage did not advance to Client Activation. Sales Prospects should contain SharePoint Record ID, remain Active, and have no Converted Client ID. Open in Word and inspect the unfilled checklist and pricing.
4. While Pending, leave/reopen and Resume; try two tabs. Verify request IDs are reused, concurrent Save is refused, and only one copy exists per Quote ID.
5. In a controlled test, reject a request with a clear reason. Verify the named step/reason, fix the cause, then Save again. Verify existing record/copy reuse. Use fakes for transport-uncertainty tests rather than disrupting live requests.
6. Approve a revised quote and Save. Verify a separate instance/copy and preserved previous file. If Josh chooses, explicitly supersede the previous proposal using the newer ID; verify Item Completed Cancelled, not deletion.
7. On a separate BII test opportunity verify BII-05, its Quote ID instance, Signature Status Preparing, Word checklist and eSignature guidance. No email Send form should appear. Leave Flow 7/8 and Stage Gate unchanged.
8. With controlled records, observe conversion only when work-items read sees Client Activation or a known later stage. Mark Lost must sync Lost, never Converted. Unknown stages never imply conversion. Restore test data through owner workflows.

Real migration, mailbox/eSignature behavior and deployed-host acceptance cannot be certified by fake-Graph tests.
