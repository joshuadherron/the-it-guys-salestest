# Existing customer opportunities

An Opportunity ID identifies a sales record. The existing `client_id` and `client_item_id` fields link that opportunity to the operational SharePoint Client. Multiple opportunities may reference the same client. SharePoint remains the source of live client name, stage, lanes, status and next action.

## Migration and compatibility

Apply migration `008_existing_clients.sql` using the existing migration runner after reviewing it against staging. It adds `relationship_type` with default `new_client`, a nonunique client-ID index, a separate Additional Service Discovery table, and a small client request lock table. Existing opportunities retain their IDs, links and full discovery history. No historical records are automatically matched or reclassified. A previously created and linked new-customer opportunity remains a new-customer opportunity with an established client; it must not create another client.

The migration has not been applied by this change. Back up the database and use the normal migration process before running this code. MySQL DDL is not transactional. There are no new credentials or Graph permissions. Keep `SHAREPOINT_WRITE_MODE=dryrun` during validation.

## Linking an existing client

Save a new sales opportunity, or open the existing Managed IT opportunity. Josh opens **Customer relationship / Link existing client**, searches the live SharePoint Clients list, chooses **Existing customer / additional service**, explicitly selects the matching Client ID, and selects the new workflow lane. The selector shows live name, Client ID, current stage, service lanes, stage status and next action. Linking writes only the relationship and identifiers to MySQL; it does not change SharePoint. Existing linked opportunities cannot be reassigned through this control. Opportunities with unreconciled or delivered requests cannot be relinked.

Additional Service Discovery records service, reason, approver, timing, changes, users/devices, locations, infrastructure, concerns and notes. Service, reason, approver and timing are required to mark it complete. Josh and Alanna may capture it; after completion Josh can edit/reopen it. Revision checks reject concurrent saves. Existing first-client discovery and its versions are untouched. BII-08 remains a separate operational assessment owned by Power Automate.

## Supported transition

For an existing BII client at Acceptance, a Managed IT opportunity with complete additional discovery exposes **Start Managed IT Transition**. Josh submits it from SharePoint actions & history. The server rereads the live client and checks existing lanes and active requests. Managed IT already present, missing/deleted clients, unavailable SharePoint state, unsupported source lanes/stages and incomplete additional discovery block submission. The app never silently falls back to Create Client. Only BII to Managed IT is enabled now; the relationship schema supports future services without implementing their workflows.

The request is `Start Stage` with exactly:

```json
{"clientId":"CL-0007","stage":"Technical Assessment","serviceLane":"Managed IT"}
```

Power Automate adds/uses the lane, issues BII-08 and owns subsequent stages and folders. The app does not update Clients or working-copy metadata to start this transition. The existing signature preparation controls retain their prior behavior.

## Duplicate checks and request safety

Before Create Client, the app compares normalized company names against the live Clients list (case, punctuation and spacing ignored). It uses company names because no reliable domain/email columns are part of the current Clients schema contract. This is a candidate warning, never an automatic merge. Josh can link the existing client, or the user can explicitly confirm **This is a different company** after reviewing the current match list. If the match list changes, confirmation must be reviewed again. A failed Clients read blocks creation. The existing new-client discovery and Create Client JSON remain unchanged.

Requests retain durable Preparing/Pending/Unknown records and the existing reconciliation process. A client-ID lock serializes preparations across opportunities sharing a client, and active/uncertain local or remote client requests block another action. A completed Managed IT transition request also blocks restarting it while live state catches up. Dryrun creates reviewable local request history without Graph writes; dryrun previews do not count as completed live transitions.

## Validation

`test/existing-clients.test.js` covers EC1-EC10: selection, separate discovery, exact transition dryrun, duplicate review, independent opportunities, missing client, repeat/pending guard, active Managed IT, new-client payload and role authorization. Existing new-client route fixtures include the Clients read used by the new duplicate check.

No database migration, real client linkage, Power Automate change or live SharePoint request was performed during implementation.

Synthetic review examples are saved in [new-customer dryrun](examples/new-customer-dryrun.json) and [existing-client transition dryrun](examples/existing-client-transition-dryrun.json). They show the request type and payload; the actual Workflow Request envelope uses the live mapped SharePoint columns.
