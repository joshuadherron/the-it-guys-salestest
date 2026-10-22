# Sales workspace and governed lifecycle audit

The workspace stores sales context, estimates and outcomes. SharePoint owns the
governed service lifecycle. Pipeline stage describes sales progress; it is not an
authorization to deliver services. Internal quote approval approves prices and
terms, not work. Existing authentication, CSRF, roles and quote permissions apply.

## Gate inventory and decision (2026-10-22)

| Existing enforcement | Purpose | Decision |
| --- | --- | --- |
| Hold checks in quote calculation, draft creation/editing and preview routes; disabled quote forms | Stop activity during security review | Informational for preparation; preserve holds for live delivery and work authorization |
| Project approval and document generation require complete intake and unchanged intake revision | Ensure delivery context | Informational for sales; validate complete current intake at work authorization instead |
| Discovery edits and new drafts revoke existing approved quotes | Keep pricing current | Remove automatic revocation; saved approved commercial snapshots stay immutable; explicit revisions need approval |
| Corrected opportunity discovery required for internal quote approval | Avoid stale service context | Advisory; quote type, saved scope and prices still validated |
| Pre-quote assessment findings block pricing approval | Surface implementation risk | Warning with explicit Continue Anyway acknowledgement, recorded with selected findings |
| Manually sent project proposal requires successful live SharePoint fill | Prove proposal storage | Remove; explicit actual-send confirmation and audit remain |
| Qualified stage required for opening project SharePoint record | Enforce pipeline order | Remove stage prerequisite; keep complete intake, hold, identity and flow checks at this external boundary |
| Legacy CreateClient requires completed discovery and qualified stage | Create initial governed structure, may start existing flows | Preserve discovery until existing flow contract separates record creation from service activation; remove only local stage prerequisite |
| Project CreateClient requires completed intake | Establish governed project record | Preserve until project flow supports partial snapshots; client creation can occur without MIT/BII |
| Discovery submit/completion checks | Define the meaning of a completed questionnaire | Preserve; drafts can be updated without marking complete; history and revision checks remain |
| Existing-customer transition requires linked client and service context | Prevent wrong-client/service activation | Preserve for lifecycle transition, not quote preparation |
| Sales won/lost/hold status | Describe a sales outcome | Allow explicit local actions independently of SharePoint; never create work authorization or activate services |
| Approved quote and valid scope/pricing/terms required for contractual documents | Prevent inaccurate customer commitments | Preserve; project master approval/configuration is a real prerequisite |
| Project customer authorization requires current intake, no hold/loss, approved snapshot and actual acceptance evidence | Authorize work and hand off | Preserve; internal pricing approval and local Won status cannot satisfy it |
| Duplicate clients, business identity locks, active/uncertain requests | Prevent duplicate or ambiguous external writes | Preserve |
| Existing Business Technology Projects record reuse requires new-record flow configuration | Ensure new-record routing | Remove for verified existing-record reuse; keep before creating any new external record |
| Quote instance references, eTags, immutable hashes, unresolved fields, send/PDF reconciliation | Prevent wrong documents, overwrites and duplicate email | Preserve |
| Signed agreements, BAA flags, stage blockers, standardization and transition checks in guided-workflow/work-items/SharePoint | Contractual, compliance and managed responsibility | Preserve |
| Client identity/type changes with commercial or workflow history; completed discovery owner controls | Preserve identity and reviewed history | Preserve permissions, archives and reconciliation |

## Architecture and deployment

Use the existing quotes, discoveries, activities and prospects tables. Separate
project commercial validation from work authorization validation; preparation
never depends on intake revision. Intake completion and acceptance are checked
at authorization. Local sales outcomes write prospects/activities and CRM sync
only, never submit lifecycle requests. Common actions remain visible regardless
of the recommended next step. Holds stay visible and cannot be released through
the sales status form.

No migration or production configuration change is required. No SharePoint or
Power Automate changes are made by this implementation. Existing CreateClient
flows still receive complete versioned snapshots; their hard boundary is retained
because record creation can issue operational documents. Business Technology Projects requires
the existing verified project-v1 flow/schema contract and reuses shared business
records. ENG-PRJ/ENG-HRLY approved master and routing prerequisites remain.

This work adds no invoicing, tax, payment, timesheet, inventory, ticketing or
project execution system. Deployment requires the owner's approval.

## Verification

522 tests pass; ESLint and production build validation pass. The build checks
94 JavaScript sources, 39 EJS views and both pinned legacy DOCX masters. Added
route tests cover held/early-stage draft pricing, assessment acknowledgement,
approved previews without discovery, manual send recording, local outcomes,
record reuse without creation configuration, and retained live-write and work
authorization guards. No live database, SharePoint or Power Automate writes were
performed. Production rollout and authenticated browser verification are separate
from these local checks.
