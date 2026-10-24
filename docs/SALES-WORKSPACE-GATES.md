# Sales workspace and governed lifecycle audit

October 24 Quick Quote supersedes the sales click sequence below: **choose/add
business → build quote → Preview → Send**. See [QUICK-QUOTE.md](QUICK-QUOTE.md)
for each removed gate and its current Send or acceptance/authorization protection,
durable progress, migration 014, and external flow/PSA verification limits.

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
| Pre-quote assessment findings block pricing approval | Surface implementation risk | Optional preview selections; Send becomes Send anyway and records acknowledgement without a second checkbox. Conditions are never auto-ticked. BT-7.32 is optional and never a stop condition |
| Manually sent project proposal requires successful live SharePoint fill | Prove proposal storage | Remove; explicit actual-send confirmation and audit remain |
| Qualified stage required for opening project SharePoint record | Enforce pipeline order | Remove stage and complete-intake prerequisites; keep hold, identity and flow checks at this external boundary |
| Legacy CreateClient requires completed discovery and qualified stage | Create initial governed structure | Removed from proposal Send: available discovery plus discoveryComplete; acceptance/work authorization retains discovery and lifecycle gates. Legacy admin handoff remains separate; deployed flow acceptance of partial discovery needs verification |
| Project CreateClient requires completed intake | Establish governed project record | Removed. Send a partial snapshot with intakeComplete and approved quoteContext when a quote is involved; enforce complete current intake at customer work authorization/handoff |
| Discovery submit/completion checks | Define the meaning of a completed questionnaire | Preserve; drafts can be updated without marking complete; history and revision checks remain |
| Existing-customer transition requires linked client and service context | Prevent wrong-client/service activation | Preserve for lifecycle transition, not quote preparation |
| Sales won/lost/hold status | Describe a sales outcome | Allow explicit local actions independently of SharePoint; never create work authorization or activate services |
| Approved quote and valid scope/pricing/terms required for contractual documents | Prevent inaccurate customer commitments | Preserve; project master approval/configuration is a real prerequisite |
| Project customer authorization requires current intake, no hold/loss, approved snapshot and actual acceptance evidence | Authorize work and hand off | Preserve; internal pricing approval and local Won status cannot satisfy it |
| Duplicate clients, business identity locks, active/uncertain requests | Prevent duplicate or ambiguous external writes | Preserve |
| Existing Business Technology Projects record reuse requires new-record flow configuration | Ensure new-record routing | Remove for verified existing-record reuse; keep before creating any new external record |
| Quote instance references, eTags, immutable hashes, unresolved fields, send/PDF reconciliation | Prevent wrong documents, overwrites and duplicate email | Preserve |
| Separate approval / record / preparation / fill buttons | Review and prepare accurate documents | Removed from Quick Quote. Preview → Send records permitted approval and automatically runs the existing preparation/delivery checks |
| Confirm-counts and mandatory reviewed-every-condition boxes | Affirm pricing review | Removed from Quick Quote. Preview is the review; price/line/config, document rate and snapshot validation remain mandatory at Send |
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
Power Automate changes are made by this implementation. Managed IT/BII CreateClient
flows still receive their existing complete versioned snapshots.
Business Technology Projects receives available intake (revision 0 and empty
answers/flags if absent), intakeComplete, and quoteContext when an approved quote
is involved. Only those two fields are added to the existing flow contract; flows
ignore them. A partial snapshot never authorizes work. Project readiness requires
exactly one PRJ-05 definition in Business Technology Projects with Active = Yes
and Create Client Copy = Yes, plus the existing lane-choice and unique business
key checks. Josh activates the definition after deploying the flows; there is no
project-specific environment opt-in. Verified existing business records are reused.
ENG-PRJ/ENG-HRLY approved master and routing prerequisites remain.

This work adds no invoicing, tax, payment, timesheet, inventory, ticketing or
project execution system. Deployment requires the owner's approval.

## Verification

582 tests pass; ESLint and production build validation pass. The build checks
98 JavaScript sources, 40 EJS views and all three pinned DOCX masters. Added
route tests cover held/early-stage draft pricing, assessment acknowledgement,
approved previews without discovery, manual send recording, local outcomes,
record reuse without creation configuration, and retained live-write and work
authorization guards. No live database, SharePoint or Power Automate writes were
performed. Production rollout and authenticated browser verification are separate
from these local checks.

October 24 project sales updates additionally verify missing/partial intake
snapshots, approved quote context, no-intake proposal preparation, PRJ-05 readiness
without an environment switch, retained work-authorization intake refusal and
friendly prepare refusals with warning-level logging.
