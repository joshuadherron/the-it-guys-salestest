# Project quote DOCX implementation guide

October 24 Quick Quote update: Project now uses **choose/add business → build
quote → Preview → Send**, including the shared PDF/email transport. The quote
path has no separate approval, folder, preparation or fill clicks. Partial intake
and PRJ-05 readiness rules remain; customer authorization still requires complete
current intake. Apply migration 014 before deployment. See [QUICK-QUOTE.md](QUICK-QUOTE.md)
for progress persistence, email behavior and the full gate audit. The older manual
preparation forms described below remain troubleshooting paths.

Prepared: October 22, 2026. Repository: `joshuadherron/the-it-guys-salestest`.

## 1. Current implementation and retired configuration message

The message asking for PROJECT_QUOTE_MASTER_FILENAME,
PROJECT_QUOTE_WORKFLOW_ID and PROJECT_QUOTE_TEMPLATE_VERSION belongs to an older
build. Those three variables are no longer read for ENG-PRJ. Existing settings
with those names may be removed; they cannot override the pinned master.

`src/docfill/master-names.js` now holds ENG-PRJ alongside the unchanged COM-PRP
and BII-QSOW master filenames:

| Code constant | Pinned value |
| --- | --- |
| Document key | `ENG-PRJ` |
| Filename | `The_IT_Guys_Project_Quote_SOW_Template_v1.0.docx` |
| Workflow ID | `PRJ-05` |
| Template version | `v1.0` |
| SharePoint lane (`projectLane`) | `Business Technology Projects` |

There is no Project-Based SharePoint choice to add. Use the existing Business
Technology Projects lane. Pinning metadata in code does not promote the master
or enable live writes: the exact file must still resolve as Approved in
SharePoint and pass tag validation. Hourly template configuration remains separate.

The app-side estimates, pricing approval, document fill and SharePoint preparation
already exist. The supplied template is bundled as the immutable test fixture
`test/fixtures/ENG-PRJ-v1.0.docx`; the live resolver still reads the SharePoint
master, not this test file. Owner-supplied setup information reports the schema,
PRJ-05 definition and flow branches as completed externally. This code change
does not independently verify or modify that deployment.

The printable estimate remains available without SharePoint DOCX setup. For the
current example: `/quotes/19/project-print`; its opportunity is OPP-0086.

## 2. Scope and approval boundaries

- A project quote describes only its explicitly approved scope, prices and terms.
- It does not enroll the business in Managed IT or BII or grant ongoing support,
  monitoring, security, backup coverage or operational responsibility.
- Internal pricing approval and the local sales status Won do not authorize work.
  Actual customer acceptance and the sales handoff are recorded separately.
- Sales preparation, opening the SharePoint business record and saving a proposal
  do not require completed intake or an earlier pipeline stage. Live writes retain
  hold, identity, request and flow-readiness checks. Customer work authorization
  and handoff still require complete current intake and actual acceptance.
- Project delivery stays in the existing delivery systems. This implementation
  adds no invoicing, payment, accounting, tax, time tracking, tasks or ticketing.
- ENG-PRJ is a standalone Project Quote / SOW: no MSA or PSA is required. Its
  master has Signature Required = No; sending remains manual.
- Owner approval of the app's gate audit is separate from approval of a specific
  template's legal language, layout, tags and Power Automate routing.

## 3. Deliverables and responsibility

| Deliverable | Responsible party | Completion evidence |
| --- | --- | --- |
| Project Quote / SOW Word master | Template author, then owner | Approved language/layout and versioned DOCX |
| Exact content-control tags | Template author/developer | Tag validation and filled sample reviewed in Word |
| SharePoint master metadata and promotion | SharePoint administrator/owner | Exactly one matching Approved master |
| Project proposal workflow definition | SharePoint administrator | Active Business Technology Projects PRJ definition tied to ENG-PRJ |
| Record and working-copy flow branches | Power Automate administrator | Staging request results, reuse and uncertainty tests |
| Instance-reference setting and connection refresh | Hostinger/app administrator | Verified instance column and successful connection check; project readiness uses the PRJ-05 row |
| End-to-end acceptance and production enablement | Owner and implementer | Approved results and explicit production rollout approval |

No live SharePoint inspection or external configuration change is performed by
creating this document. Verify current tenant settings before applying changes.

## 4. Word master: ENG-PRJ

Use the owner-supplied **Project Quote / Statement of Work** `.docx`:

```text
The_IT_Guys_Project_Quote_SOW_Template_v1.0.docx
```

It is copied unchanged to `test/fixtures/ENG-PRJ-v1.0.docx`. SHA-256:

```text
63b1dd08131d0f9d179562630a173db50dfa2b7c3275887ac140cff96712bfe7
```

Do not overwrite this approved-version candidate or change its contract text or
21-tag contract as part of app setup. A new revision requires deliberate owner
review, promotion and a corresponding update to the pinned code constants/tests.

The owner must approve the final customer-facing wording, including scope,
exclusions, assumptions, estimate/fixed-price basis, acceptance requirements and
any optional recurring charges. The app supplies the saved quote's terms; this
guide supplies no new contract terms or prices.

### Required content-control tags

Use Word Developer content controls. Set their **Tag** property exactly as shown;
the Title property or visible placeholder text does not substitute for Tag.

| Tag | App value |
| --- | --- |
| `ENG.BusinessName` | Opportunity's business name |
| `ENG.Contact` | Contact name; email fallback; otherwise blank |
| `ENG.QuoteId` | Formatted quote number; numeric Quote ID fallback |
| `ENG.IssueDate` | America/Chicago calendar day of approval, formatted YYYY-MM-DD |
| `ENG.EngagementType` | One-Time Project plus saved estimate/fixed basis |
| `ENG.Scope` | Approved quote scope |
| `ENG.Exclusions` | Approved exclusions, or blank |
| `ENG.Assumptions` | Approved assumptions/dependencies, or blank |
| `ENG.Terms` | Owner-approved terms saved in the quote |
| `ENG.OneTimeTotal` | Calculated one-time amount, formatted as US dollars with thousands separators and two decimals |
| `ENG.MonthlyTotal` | Calculated explicitly scoped monthly amount |
| `ENG.EstimatedHours` | Estimated hours, or 0 for an ordinary project quote |
| `ENG.HourlyRate` | Hourly rate as dollars, or $0.00 when unused |
| `ENG.MinimumHours` | Saved minimum hours, or 0 |
| `REPEAT.Line` | Block containing the repeatable item row/paragraph |
| `Line.Description` | Saved item description |
| `Line.Kind` | labor, materials, equipment, deliverable or other |
| `Line.Quantity` | Item quantity |
| `Line.UnitPrice` | Unit price formatted as US dollars with thousands separators and two decimals |
| `Line.Amount` | Extended item amount formatted as US dollars with thousands separators and two decimals |
| `Line.Billing` | One-time or Monthly (explicit scope only) |

There are **21 distinct required tags**: 14 ENG tags, one repeat tag and six Line
tags. Both project and hourly contracts currently require this same tag set.

### Required structure and layout constraints

1. Put each ENG control inline inside a Word paragraph. In a table, it must be
   inside a paragraph inside a cell.
2. Put all six Line controls inline within a single repeatable row or paragraph.
3. Wrap that complete row/paragraph in a block control tagged `REPEAT.Line`.
   Keep the table heading outside the repeat block.
4. Include every required tag even when its value is normally unused for a
   one-time project. Arrange the hourly/minimum fields in the supplied,
   owner-reviewed area; the current filler does not conditionally hide them.
5. Do not add `IF.*`, `RATE.*`, legacy MIT/QSOW tags, untagged content controls,
   renamed tags or additional custom tags. These are outside this contract.
6. Optional blank text is removed by the filler. Check the resulting labels,
   spacing and table cells when exclusions or assumptions are blank.

Validation compares distinct tag sets, including document, header and footer XML.
It does not enforce occurrence counts or prove correct Word nesting/layout.
Do not mistake a passing tag check for a complete template review. For the
initial template, use each tag once unless repeated placement is deliberately
reviewed. Test long scope/terms, line wrapping, pagination and multiline content
in the actual generated Word file.

## 5. SharePoint master library

Use the existing **Operational Standards & Templates** library in the configured
operations site. The app resolves that library by its display name.

| Metadata | Required value / intent |
| --- | --- |
| Document Key | `ENG-PRJ` |
| Status | `Approved`, after owner review and the existing promotion process |
| Filename | Exact versioned `.docx` basename pinned in code |
| Version label | `v1.0` |
| Usage | Client Copy Template |
| Target Client Folder | `Commercial` |
| Signature Required | No |
| Lifecycle Stage | Quoting |
| Service lane | Business Technology Projects, using the tenant's relevant metadata field |

The resolver must find exactly one item matching **Document Key + Approved
status + code-pinned filename**, with a readable Word drive item. It validates the
file's tag set before use. A folder named Approved alone is insufficient.

If labels differ or column discovery is ambiguous, configure the verified
internal names through `QUOTE_MASTER_KEY_COLUMN` and
`QUOTE_MASTER_STATUS_COLUMN`. Do not guess internal names from display labels.

The app reads the master and replaces only the resolved customer working copy.
It must never fill or overwrite the master itself.

## 6. SharePoint schema and proposal definition

Josh/Claude report that the SharePoint schema, PRJ-05 definition and flow packages
have been prepared externally. Verify these real values in the connected tenant:

- Workflow Requests → Service Lane: existing `Business Technology Projects` choice.
- Clients → Service Lanes: existing `Business Technology Projects` choice.
- Clients → `TIG_SalesBusinessID`: exact internal name, single-line text, indexed,
  unique. Store the decimal app Business ID, not an OPP or Quote ID.
- Client Operations → `TIG_InstanceRef`: existing single-line text, indexed.
  Configure `QUOTE_INSTANCE_REF_COLUMN=TIG_InstanceRef` in Hostinger.
- Preserve all existing MIT/BII choices, definitions, masters and metadata.

The Client Workflow Definitions project row is:

| Field | Value |
| --- | --- |
| Workflow ID / Title | `PRJ-05` |
| Service Lane | `Business Technology Projects` |
| Workflow Stage | Quoting |
| Trigger Mode | On demand (per instance) |
| Required Document | Project Quote / SOW |
| Document Key | `ENG-PRJ` |
| Active / Create Client Copy | Yes / Yes, after the existing activation checks |
| Target Client Folder | `Commercial` |
| Blocking | No |
| Signature Required on master | No |
| Operational effects | No managed onboarding, delivery tasks or service activation |

Do not create another definition, substitute MIT-05/BII-05 or add a new lane
choice. The app uses the shared `projectLane` constant in capability checks,
request construction and lane UI. PRJ-05 must resolve uniquely, be active and
permit client copies; the flow validates its lane, document key and target folder.

**Legacy customer identity:** before a project copy request, deliberately set the
Clients row's Sales Business ID to the verified app Business ID. The flow rejects
a blank or different key. Selecting/linking a customer in the sales app does not
automatically populate this SharePoint field. Reconcile a conflicting identity;
do not overwrite it to get past the check.

## 7. Power Automate implementation

Use the existing Workflow Requests processor and normal audit/result fields.
The repository contains app-side contracts, not exported production flow
definitions. The owner-supplied package notes report these branches as deployed
externally; validate them in staging rather than importing or changing them again
from this task.

### A. Create Client / Business Technology Projects

Route this before the existing MIT/BII branches. An example payload is:

```json
{
  "opportunityId": "OPP-0086",
  "client": "Example Business",
  "stage": "Sales Discovery",
  "serviceLane": "Business Technology Projects",
  "contractVersion": "project-v1",
  "businessId": "9",
  "engagementType": "project",
  "discovery": {
    "contractVersion": "project-v1",
    "businessId": "9",
    "opportunityId": "OPP-0086",
    "engagementType": "project",
    "revision": 0,
    "answers": {},
    "flags": [],
    "capturedBy": null,
    "intakeComplete": false
  }
}
```

Identifiers are illustrative. No intake is allowed for sales storage: revision 0,
answers {}, flags [], capturedBy null and intakeComplete false. Existing partial
intake keeps its answers, revision, flags and capturedBy. Completed intake sets
intakeComplete true only when the required fields are present. A quote-related
request also adds discovery.quoteContext with the approved scope, exclusions,
assumptions and terms, and the prospect's contactName and contactEmail. No values
are inferred; Open/reuse from a quote passes its explicit Quote ID, and proposal
save uses the approved quote it already locked. The two additive fields are ignored
by the flows; all existing envelope fields and routing remain unchanged. Complete
current intake remains required for customer work authorization/handoff.

The flow must:

1. Validate contractVersion, Business Technology Projects lane, project/hourly type and matching
   business/opportunity identities in the versioned intake snapshot.
2. Query Clients by `TIG_SalesBusinessID` before allocating anything. Reuse one
   exact match; reject multiple/conflicting matches for reconciliation.
3. Handle concurrent/repeated requests through serialized allocation or the
   unique business key and a reread after a uniqueness conflict.
4. For a new business record, allocate the normal Client ID/folder, store the
   Business ID and originating OPP, set Base Tier to `Project only (no recurring)`,
   and provide a `Commercial` folder. Capture
   the intake using the existing discovery export mechanism.
5. For an existing customer, preserve Client ID, folder and operational stage.
   A legacy customer must have its Sales Business ID deliberately set to the
   verified app Business ID. Blank/different values reject project copy requests;
   app linkage alone is insufficient. Never merge by company-name similarity.
6. Return the normal result/link fields. Mark Done only when the identity and
   storage are available to the app's existing reconciliation/linkage path. On
   Done, the deployed flow marks that opportunity's Sales Prospects row Converted
   with the Client ID. This external CRM label is not work authorization or
   Managed IT activation.
7. Do not issue MIT/BII proposal copies, managed contracts or onboarding tasks.

The app already attempts verified business-record reuse before creating a new
record. Reuse alone does not require new-record flow configuration. New creation
requires no hold/loss and verified identity/flow configuration, with partial intake
allowed. It does not authorize work.

### B. Create Working Copy / Business Technology Projects

Example for numeric app Quote ID 19:

```json
{
  "clientId": "CL-0009",
  "workflowId": "PRJ-05",
  "instanceRef": "19",
  "contractVersion": "project-v1",
  "serviceLane": "Business Technology Projects",
  "businessId": "9",
  "opportunityId": "OPP-0086",
  "engagementType": "project"
}
```

The flow must resolve the existing customer, verify business identity and the
approved PRJ definition/master mapping. Reject a blank or different customer Sales
Business ID, missing/wrong project-v1 contract, nonnumeric instance reference, or a
PRJ definition requested outside the explicit project contract. Then:

- Find/reuse a copy by **Client ID + Workflow ID + Instance Reference**.
- Reject duplicate exact matches rather than selecting an arbitrary copy.
- Copy the approved master into that customer's **Commercial** folder only.
- Populate `TIG_ClientID`, `TIG_WorkflowID`, the verified Instance Reference
  column, applicable lane/stage metadata and `TIG_CompletionStatus = Open`.
- Use the numeric quote row ID as text for Instance Reference (`19`), not the
  formatted quote number (`Q-2026-019`) or OPP (`OPP-0086`).
- Ensure Client Operations exposes a resolvable Word drive item with its drive
  ID, item ID and eTag. A URL without that relationship is insufficient.
- Preserve the customer's current operational stage and existing service lanes;
  the deployed flow may add Business Technology Projects without removing other lanes.
- Finish through the normal Processing Status / Result Message / Result Link
  fields. Reconcile Unknown requests by exact request title before retrying.

The existing preparation process subsequently fills the working copy with an
If-Match eTag and records its snapshot/audit history. Do not activate a service,
send an eSignature request or email the proposal as a side effect of this branch.

## 8. Hostinger environment configuration

ENG-PRJ no longer needs a filename, workflow ID or version environment variable.
Those values are pinned in `src/docfill/master-names.js`. Changes require code
review/deployment, just as the legacy master filename pins do.

The instance-reference setting remains necessary:

```dotenv
QUOTE_INSTANCE_REF_COLUMN=TIG_InstanceRef
```

Project readiness uses the SharePoint definition, with no project-specific
environment switch. Exactly one PRJ-05 row must have Service Lane = Business
Technology Projects, Active = Yes and Create Client Copy = Yes. Josh activates
that row only after the project flows are deployed and verified. The existing
request/client lane choices and unique indexed TIG_SalesBusinessID text column
are also required. Admin → Check SharePoint connection refreshes these checks.

For a separately approved live save, the running environment must also have
`QUOTE_FILL_MODE` and `SHAREPOINT_WRITE_MODE` set to `live` as applicable. Do not
change these modes merely to remove a configuration message. Existing identity,
Graph access and mailbox settings remain unchanged. Project sending is manual;
enabling `QUOTE_SEND_MODE` is not required.

- Preview/download needs an approved quote, quote-send permission, the exact
  Approved master with the pinned filename and its unchanged tag contract.
  It does not need completed intake or the three retired variables. Fill mode
  must not be off; the download never writes to SharePoint.
- Saving to SharePoint uses the existing approved quote, hold/loss, request,
  identity, working-copy, version and eTag checks. Creating a missing record or
  copy also requires the verified lane/schema/flow capability and write mode.
- After code/environment deployment, restart as required and run the app's
  administrator Check SharePoint connection action to refresh cached capabilities.
- Old errors mentioning the retired variables indicate an older deployed build.
  An Approved-master error after this update points to SharePoint metadata,
  promotion, exact filename or tag resolution, not missing project pin settings.

## 9. Validation and rollout checklist

### Local and template verification

From the repository root with supported Node 22 and installed dependencies:

```sh
npm ci
npm test
npm run lint
npm run build
```

Validate an actual candidate template in PowerShell, using a local file path:

```powershell
$env:PROJECT_TEMPLATE_PATH = 'C:\path\to\candidate-project-template.docx'
@'
import { readFile } from 'node:fs/promises';
import { listTags } from './src/docfill/fill-docx.js';
import { assertTagset } from './src/docfill/tagsets.js';
const bytes = await readFile(process.env.PROJECT_TEMPLATE_PATH);
const tags = await listTags(bytes);
assertTagset('ENG-PRJ', tags);
console.log(`PASS: ${tags.length} distinct required tags`);
console.log(tags.join('\n'));
'@ | node --input-type=module
```

Expected: 21 distinct tags. This command reads the candidate; it does not approve,
promote or modify it. Structural review and generated Word samples remain required.

### Staging acceptance

- [ ] Owner approves exact master language, layout, tag contract and pinned version.
- [ ] Candidate tag validation passes; filled sample opens in Word without repair.
- [ ] Review long/multiple line items, blank optional fields, dollar amounts,
  monthly versus one-time labels, page breaks and unused hourly fields.
- [ ] A project quote can be drafted and approved without completed intake.
- [ ] Preview uses the saved approved scope/prices/terms and writes no master.
- [ ] Opening a project record and saving a proposal work with no/partial intake;
  snapshots include intakeComplete and approved quoteContext when applicable.
- [ ] A hold, absent business ID or unready PRJ-05 still refuses new live writes.
- [ ] First approved live save produces one business record and one quote copy.
- [ ] Repeated save reuses the same copy; another Quote ID produces another copy.
- [ ] A second opportunity for the same business reuses the Client ID/folder.
- [ ] An existing Managed IT customer requesting a project keeps its service stage.
- [ ] Incorrect business keys, duplicate copies, missing instance references and
  uncertain requests stop safely for reconciliation.
- [ ] Hold/loss blocks live save/delivery and actual work authorization.
- [ ] Project sending remains manual. Record sent only after actually sending;
  this record does not require a successful prior SharePoint fill.
- [ ] Actual acceptance evidence and current completed intake are required for
  work authorization/handoff. Plain sales Won cannot satisfy that requirement.
- [ ] No managed/BII enrollment, task creation or delivery activation occurs.
- [ ] Existing Managed IT/BII quote and lifecycle regression checks pass.

After evidence is reviewed, obtain approval to enable the tested production
configuration and perform a controlled end-to-end verification. No new SQL
migration is required just to install/configure the project master. This assumes
the app's existing quote/proposal tables and migration 013 are already installed;
verify the database ledger instead of rerunning migrations blindly.

## 10. Troubleshooting

| Message / symptom | Check |
| --- | --- |
| Old message requesting the three project template variables | Deploy the code containing ENG-PRJ constants; these variables are no longer read |
| Expected exactly one promoted Approved master | Exact library, Document Key ENG-PRJ, Approved status, pinned filename and unique matching drive item |
| Tags differ from approved master | Compare all 21 distinct tags; remove extra/untagged controls; inspect headers/footers too |
| Unresolved fields remain | Check inline/repeat nesting and supported controls; missing values are not the only possible cause |
| Activate PRJ-05 in Client Workflow Definitions | After deploying project flows, activate exactly one PRJ-05 row in Business Technology Projects with Create Client Copy = Yes; refresh the connection and verify lane choices and the unique business key |
| Active / Create Client Copy definition required | Exact PRJ workflow ID, Business Technology Projects lane and both flags |
| Verified Instance Reference column required | `QUOTE_INSTANCE_REF_COLUMN=TIG_InstanceRef`; flow must populate it with numeric Quote ID text |
| Business identity mismatch | Deliberately populate the legacy Clients Sales Business ID with the correct app Business ID; blank/different keys are rejected |
| Expected exactly one open working copy | Client/workflow/instance identity, duplicate rows, completion status and real drive-item linkage |
| Working quote must be in Commercial | Actual resolved parent folder must be named Commercial |
| Save proposal requires live fill mode | Preview remains available; enabling live save is a separate deployment decision |
| Active or uncertain request / operation | Reconcile existing request/fill before retrying; do not create replacement records blindly |

## 11. Optional hourly implementation

Hourly / Break-Fix is separate from ENG-PRJ. If needed, approve an **ENG-HRLY**
master with the same 21-tag contract, use a distinct PRJ workflow definition and
configure `HOURLY_QUOTE_MASTER_FILENAME`, `HOURLY_QUOTE_WORKFLOW_ID` and
`HOURLY_QUOTE_TEMPLATE_VERSION`. Estimated labor uses proposed hours/rate and the
saved minimum; it is an estimate, not an invoice or time-tracking system.

## 12. Source of truth

Local verification for this change: 532 tests, ESLint and production build checks
pass. The build validates 95 JavaScript sources, 39 EJS views, both unchanged
legacy masters and the exact supplied ENG-PRJ v1.0 fixture. Automated checks cover
the 21-tag contract, three repeated rows, blank exclusions, master-byte integrity,
multiline Word breaks, US currency formatting, Chicago approval dates, pinned
metadata and the existing lane/capability safeguards. Live flow behavior and final
customer-facing Word layout still require the staging acceptance review above.

Implementation was checked against these repository files:

- `src/docfill/master-names.js`: immutable project pins and existing legacy filenames.
- `src/project-contract.js`: project spec, hourly variables, tag list, capabilities and intake snapshot.
- `src/docfill/project-fields.js`: exact field mappings and calculated repeat lines.
- `src/docfill/tagsets.js` and `fill-docx.js`: tag and content-control behavior.
- `src/docfill/project-routes.js`: preview/download behavior and permission checks.
- `src/docfill/sharepoint-quotes.js`: approved-master and working-copy resolution.
- `src/docfill/proposals.js`, `proposal-store.js`, `delivery.js` and
  `delivery-store.js`: requests, locks, leases, snapshot checks and fill auditing.
- `src/project-sharepoint.js`, `src/sharepoint.js`, `src/sharepoint-work.js`:
  record reuse, payloads, schema/instance checks and request routing.
- `src/project-quotes.js` and `src/universal-routes.js`: approval, manual sent record,
  work authorization and sales outcomes.
- [Sales workspace gate audit](SALES-WORKSPACE-GATES.md): current sales/lifecycle split.

The older universal-pipeline rollout document describes the original launch.
For discovery-versus-pricing gates, this guide and the current gate audit reflect
the later flexible-sales implementation.
