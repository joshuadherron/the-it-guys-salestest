# Universal sales pipeline — review and rollout

## Scope and decisions

This remains a CRM, discovery, estimating and sales handoff app. Projects and hourly repairs can enter the existing pipeline without selecting MIT or BII. Sales ends at accepted/won and handoff to existing delivery systems. There are no invoices, payments, taxes, accounting calculations, timers, timesheets, stock records, tasks, tickets, dispatch, work execution statuses or PSA integrations.

- A **business** is the shared identity/customer relationship. A **prospect/OPP** remains an individual opportunity with its existing primary key. One business can have several opportunity types and quotes.
- Existing `discoveries` and `discovery_versions` store lightweight project/hourly intake and its history. Detailed MIT/BII discovery remains unchanged. Owners may correct an open opportunity's type after discovery by archiving the old questionnaire and reviewing the new draft, before quoting or starting SharePoint workflows. Quotes/started workflows retain their commercial-history protections. See [OPPORTUNITY-TYPE-CORRECTION.md](OPPORTUNITY-TYPE-CORRECTION.md).
- Existing `quotes` store simple fixed/itemized project estimates and hourly estimates (hours × proposed rate, with a configured minimum). Owner approval is mandatory for custom prices. Monthly lines require explicit confirmation and represent only their stated scope. No managed service pricing or obligations are implied. Managed IT remains $125/user/month including security; its standardization gates are unchanged.
- Existing `activities` store the customer's acceptance and handoff as `Work authorized / handoff`. Notes contain the approved Quote ID/number, snapshot hash, acceptance kind/reference, destination/reference and sales notes. The opportunity row lock makes repeated acceptance submissions safe. No engagement-management table or execution lifecycle is added.
- Customer status is separate from the opportunity outcome and Managed IT coverage. Another open opportunity under an existing customer stays open. Accepting a project marks only that sale won and the business a customer. Losing a project does not close the shared SharePoint customer or other opportunities.
- Shared-client request locks, preparation leases, durable Unknown states, quote-specific instance references, approved-master validation and If-Match eTags are reused. Unknown deliveries cannot be replayed blindly. Automated email remains Managed IT-only.

## Files and affected modules

| Area | Main changes |
|---|---|
| Business/opportunity identity | `migrations/013_universal_pipeline.sql`, `src/businesses.js`, `src/pipeline.js`, business views and opportunity form |
| Types/intake | `src/engagement-types.js`, `src/engagement-intake.js`, `src/universal-routes.js`, `src/engagement-guard.js`, intake/opportunity views |
| Estimates and sales outcome | `src/project-pricing.js`, `src/project-quotes.js`, `src/sales-handoff.js`, project estimate/config/print views and form scripts |
| SharePoint records | `src/project-sharepoint.js`, `src/project-contract.js`, `src/sharepoint.js`, shared-business linkage in handoff/existing-client/proposal store |
| DOCX | `src/docfill/project-fields.js`, `project-routes.js`, shared policy/tagsets/resolver/preparation/delivery adapters |
| Lifecycle/navigation | `src/prospect-lifecycle.js`, `prospect-lifecycle-sync.js`, server registration, header/admin/prospect views, discovery/quotes route redirects |
| Validation | `test/universal-pipeline.test.js`, updated import/view regression fixtures, `scripts/check-build.js`, `package.json` |

## Database migration — manual, after approval

Apply **013_universal_pipeline.sql** once, after 001–012, to a backed-up staging database before production. This task has not run any database migration.

The migration adds only `businesses`, a small `business_identity_locks` mutex table, and three opportunity columns: `business_id`, `engagement_type`, `opportunity_title`. It seeds an unset/default estimate minimum through existing `config_prices`; no hourly rate is invented. Discovery, revisions, quotes, sales handoffs, permissions and audit reuse existing tables.

Backfill groups only exact nonempty existing Client IDs. Unlinked legacy OPPs retain separate identities even when their names match, avoiding unsafe historical name merges. Blank Client IDs become null on the new business identity only. Existing opportunity IDs, discovery, quotes, approval history, audit and SharePoint references remain intact. Legacy import rows also retain separate identities when company names are ambiguous. New interactive duplicate-name entries require explicitly selecting an existing business. An admin can link an opportunity to another business before it has quotes/SharePoint requests or acceptance; conflicts after commercial history require deliberate reconciliation.

Review after migration:

```sql
SELECT COUNT(*) AS unlinked FROM prospects WHERE business_id IS NULL;
SELECT engagement_type, COUNT(*) FROM prospects GROUP BY engagement_type;
SELECT client_id, COUNT(*) FROM businesses
WHERE client_id IS NOT NULL GROUP BY client_id HAVING COUNT(*) > 1;
SELECT name,COUNT(*) FROM businesses GROUP BY name HAVING COUNT(*) > 1;
```

Expected: no unlinked legacy OPPs, no duplicate nonempty Client IDs. Duplicate names are review candidates, not authority to merge unrelated companies. MySQL DDL is not transactionally reversible: if a manual run stops, inspect applied statements rather than blindly rerunning the file. The normal migration runner records successful filenames in `schema_migrations`; keep that ledger consistent with manual application. Rollback code does not require dropping these additive structures.

## SharePoint schema prerequisites

These changes are **proposed and not applied**. Existing MIT/BII connections continue without Project-Based support; project writes fail with configuration guidance until verified.

1. Add **Project-Based** to Workflow Requests → Service Lane and Clients → Service Lanes. Preserve all existing choices.
2. Add Clients **TIG_SalesBusinessID**, optional single-line text, indexed with unique values enforced. It holds the stable decimal app Business ID. Do not put an OPP or quote ID here. Existing clients can retain a blank value until verified linking; never overwrite another business key.
3. Verify Client Operations has a single text **Instance Reference** column. Set `QUOTE_INSTANCE_REF_COLUMN` to its actual internal name; the copy flow must populate it with the app's Quote ID.
4. After approving templates, add distinct **PRJ-…** definitions in Client Workflow Definitions for project and hourly proposals, lane Project-Based, Active Yes, Create Client Copy Yes. They create only proposal working copies in `/Commercial`. No managed/BII onboarding tasks or stage gates are attached to these definitions.
5. Promote the new owner-approved templates with the exact document keys and filenames below. Existing MIT/BII definitions, masters and tags stay intact.

## Power Automate routing contract v1

The repository has the app-side dispatcher and validations, but no exported deployed-flow definitions. The live flows were not modified or claimed as tested. Implement and test the following branches in the existing Workflow Request processor in staging before opting in.

### Create Client — Project-Based branch

Use the resolved **Request Type = Create Client** and **Service Lane = Project-Based** fields to select this branch, before MIT/BII stage routing. Parse this payload (example identifiers only):

```json
{
  "opportunityId": "OPP-0017",
  "client": "Example Technology",
  "stage": "Sales Discovery",
  "serviceLane": "Project-Based",
  "contractVersion": "project-v1",
  "businessId": "9",
  "engagementType": "project",
  "discovery": {
    "contractVersion": "project-v1",
    "businessId": "9",
    "opportunityId": "OPP-0017",
    "engagementType": "project",
    "revision": 3,
    "answers": {},
    "flags": [],
    "capturedBy": "owner@example.test"
  }
}
```

The actual app supplies the completed appropriate answers; `{}` above illustrates structure only. Reject missing/mismatched contract/business IDs, unexpected types (only `project`/`hourly`), missing intake, or a lane other than Project-Based. Query Clients by `TIG_SalesBusinessID` before allocation. Reuse a single exact match. Serialize client allocation or use the unique business column and reread after a duplicate-key conflict. Multiple matches must reject for owner review. Repeated requests for one Business ID must yield one Client ID/folder, even across different OPPs.

For a new identity allocate the existing Client ID/folder convention, store `TIG_SalesBusinessID`, keep the originating OPP, set Sales Discovery and Project-Based, and create storage including `/Commercial`. Store the versioned discovery snapshot through the existing discovery export mechanism. Return the existing normal result fields and Client link, with Processing Status Done only after identity and storage are available. A reused business must preserve its Client ID, folder and current operational stage. This branch must not run MIT-05/BII-05, issue managed contracts, enroll any service, or activate support/security/backup responsibility.

### Create Working Copy — Project-Based branch

```json
{
  "clientId": "CL-0009",
  "workflowId": "PRJ-05",
  "instanceRef": "51",
  "contractVersion": "project-v1",
  "serviceLane": "Project-Based",
  "businessId": "9",
  "opportunityId": "OPP-0017",
  "engagementType": "project"
}
```

Resolve the exact existing Client ID and verify its business key (or deliberately link a blank legacy key after owner selection). Reject conflicting keys, absent clients, wrong lane, a MIT/BII workflow ID, or a workflow that differs from the configured project/hourly definition. Require an active Create Client Copy definition and the approved pinned master. Reuse a copy only by **Client ID + Workflow ID + Instance Reference**; duplicates reject. New copies go only in that customer's `/Commercial`, populate Instance Reference, Client ID, Workflow ID and Open completion status, and keep the client stage unchanged. App work creation stops at the proposal copy. This is not a project-task branch. Preserve existing MIT/BII routing and the normal result/audit/error behavior. Unknown requests must be reconciled by their exact unique title before retries.

After staging tests and owner approval, set `PROJECT_WORKFLOW_CONTRACT=v1` in the deployment environment. This is an operator assertion that these branches are installed; the app additionally reads the schema, unique business column, active definition and instance-reference capability. Do not set this variable solely to bypass the prerequisite messages. Keep the existing write modes unchanged until explicitly approved.

## New DOCX templates — owner approval required

No project/hourly master is bundled or assumed approved. Synthetic test controls are test-only and are not customer documents. Approve the language/layout separately, then promote:

| Document key | Purpose | Required deployment variables |
|---|---|---|
| `ENG-PRJ` | Project quote / statement of work | `PROJECT_QUOTE_MASTER_FILENAME`, `PROJECT_QUOTE_WORKFLOW_ID`, `PROJECT_QUOTE_TEMPLATE_VERSION` |
| `ENG-HRLY` | Hourly estimate / work authorization | `HOURLY_QUOTE_MASTER_FILENAME`, `HOURLY_QUOTE_WORKFLOW_ID`, `HOURLY_QUOTE_TEMPLATE_VERSION` |

Workflow IDs must be distinct PRJ-… IDs, filenames must pin an exact `.docx` version, and keys must resolve to exactly one Approved master in Operational Standards & Templates. `…_TEMPLATE_VERSION` labels that pinned version; select its immutable/versioned filename when promoting. Quotes never select arbitrary files or drive IDs. Masters are always read-only; working-copy replacement keeps the existing If-Match and delivery audit safeguards.

Both proposed masters require this exact unique content-control tag set:

```text
ENG.BusinessName ENG.Contact ENG.QuoteId ENG.IssueDate ENG.EngagementType
ENG.Scope ENG.Exclusions ENG.Assumptions ENG.Terms
ENG.OneTimeTotal ENG.MonthlyTotal ENG.EstimatedHours ENG.HourlyRate ENG.MinimumHours
REPEAT.Line Line.Description Line.Kind Line.Quantity Line.UnitPrice Line.Amount Line.Billing
```

Use inline controls for ENG.*. Put the six inline Line.* controls inside a block `REPEAT.Line` control containing a paragraph/table row. No static managed rate tags or implied managed clauses are copied. Terms come from the owner's approved estimate snapshot. Preserve the existing Managed IT and BII template contracts. Project/hourly previews require the new configured Approved master, while the printable app estimate works before these templates are installed. Saving to SharePoint uses the existing bounded preparation flow. Nothing automatically emails a project/hourly proposal.

## Rollout and acceptance after approval

Local verification: `npm ci` succeeded (0 reported vulnerabilities) for the universal-pipeline release. With the opportunity-type and relationship lane corrections, all **491 tests** passed (462 previous + 29 added), `npm run lint` passed, and `npm run build` validated 94 JavaScript sources, 36 EJS views and both pinned legacy DOCX tag sets. New views are also rendered with escaped fixture data in tests. Migration execution, actual Word layout for new owner templates, and real Power Automate end-to-end behavior require staging verification; synthetic DOCX tests validate the proposed fill contract only.

1. Review the feature branch and take backups. Apply migration 013 manually in staging. Verify backfill counts and existing Client ID groups. Test against the actual supported MySQL/MariaDB version; no database server was available in this workspace for executing the migration.
2. Install with `npm ci`, run tests/lint/build, and start the app against isolated staging settings. The build validates source syntax, all EJS templates and both pinned legacy DOCX tag sets; this Node app requires no transpilation.
3. Test CRM intake, estimates and acceptance/handoff with SharePoint writes disabled. Configure an owner-approved proposed hourly default/minimum if desired. No tax or accounting settings exist in this feature.
4. Implement the SharePoint schema and flow branches above in staging, approve/promote the new templates, configure the exact master/definition/instance names, refresh the connection, and then opt in to Project-Based v1. Verify repeat requests and an uncertain delivery before authorizing production rollout.
5. Acceptance example: create **Southeast Cable Construction — Outlook repair**, Hourly / Break-Fix. Supply contact, issue, work description, access needs and rate-authorization requirements. Confirm no Managed IT questions appear. Check missing-field links and an urgent hold/release.
6. Create a two-hour custom estimate, approve as owner, and confirm internal approval leaves the business a prospect and the sale open. Revise intake and confirm it requires a new approval. Confirm no accounting, time entry or task controls appear.
7. Open/reuse its SharePoint business record. Verify Project-Based only, one Client ID/folder and no MIT/BII copies/onboarding. Prepare the approved hourly DOCX in Commercial, review it, and send manually. Record sent only after actually sending.
8. Record the actual customer acceptance reference and handoff destination (for example MSP Manager) on the opportunity. Verify only this sale becomes Closed Won, a handoff activity is retained, and the business is a customer with no Managed IT coverage implied. Continue delivery outside this app. Repeated submission must not duplicate acceptance.
9. Open a second opportunity from the business page for a migration, type One-Time Project. Estimate labor/deliverables/equipment, approve and save another proposal with a different Quote ID/Instance Reference. Confirm the same Client ID and no second folder. Mark this second opportunity lost and verify the first handoff/customer remains intact.
10. Run existing MIT and BII discovery, price, approval, proposal and stage-gate acceptance tests. A future Managed IT sale still requires its existing standardization/activation process; a prior repair is not standardization evidence.

Production migration, new SharePoint choices/column, flow routing, approved project/hourly templates and a real staging end-to-end run remain rollout prerequisites. No production settings, schema, records, flows or files were changed by this task. Merge/deploy requires approval.
