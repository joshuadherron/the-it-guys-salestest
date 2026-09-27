# Current Sales App migration — staging only

Owner instructions dated 2026-09-27 supersede the old commercial-tier model. This work applies only to this new/staging repository, never the existing production `the-it-guys-sales` application.

## New migration 004

`004_live_sales_migration.sql` is additive against the already-applied 001–003 schema. It changes neither past migrations nor the quote/auth fixes present in the working tree. It adds these nullable prospect fields:

| Columns | SQL type |
|---|---|
| likely_service | VARCHAR(80), CHECK limited to the five current services or NULL |
| city | VARCHAR(500) |
| icp | VARCHAR(80) |
| next_action | TEXT |
| next_action_date, meeting_date | DATE |
| next_action_time, meeting_time | TIME |
| next_action_method, meeting_type | VARCHAR(255) |
| meeting_location | VARCHAR(1000) |
| meeting_duration | INT UNSIGNED |
| teams_scheduled, josh_needed | BOOLEAN |
| teams_join_url | VARCHAR(2048) |
| est_monthly_revenue | DECIMAL(12,2) |
| status | VARCHAR(40) |
| legacy_stage | VARCHAR(80) |
| import_source | VARCHAR(30) |

The existing likely_tier column stays historical. There is no UPDATE that interprets or converts its values, no deleted/recreated database, and no automatic import. Application forms now use likely_service. Existing rows get NULL in the added columns. No price computation is performed on est_monthly_revenue; it is retained source data.

MySQL DDL commits independently; back up before applying and inspect partial schema state if application fails. Migration 004 was created, not executed, in this task. Do not apply it to production.

## Detection and flow

Only an exact 25-column header identifies Current Sales App Export:

```text
businessName,contactName,phone,email,city,employeeCount,currentIT,keyDependency,icp,stage,nextAction,nextActionDate,nextActionTime,nextActionMethod,meetingDate,meetingTime,meetingType,meetingLocation,meetingDuration,teamsScheduled,teamsJoinUrl,estMonthlyRevenue,joshNeeded,status,notes
```

BOM is accepted. Wrong, partial, reordered or additional columns are rejected. Auto detection also recognizes the existing exact Call Tracker v2 Pipeline and Weekly headers. Legend is ignored only when explicitly selected. The fictional sample skip applies to the legacy Call Tracker path, not indiscriminately to the live export.

Upload/paste → parse → preview → choose required lanes → review mapped rows → explicit commit. The preview displays business/contact, original stage, proposed operational stage, status, next action/date/time/method, Likely Service and workflow lane. Expand full details to inspect every retained field, including notes and meeting metadata. Unknown stages/status values are rejected for review rather than guessed.

## Stage mapping

| Original stage | Operational stage |
|---|---|
| Prospecting | Prospecting |
| Qualified | Qualified |
| Closed Lost | Closed Lost |
| Contacted | Prospecting |
| Follow-Up | Prospecting |
| Nurture | Prospecting |
| Technical Discovery | Review required; BII lane → Discovery; Managed IT lane → Technical Assessment |

Every source stage is retained in legacy_stage. Status remains Active, Nurture, Lost, or unset exactly as supplied; operational stage mapping never changes it. In particular, Nurture remains visible as Nurture in the preview, prospect details, pipeline and Today, with a status filter. Next-action details are retained independently; follow_up initially copies nextActionDate. Source status and stage can therefore explain a conservative Prospecting mapping. Source history stays read-only during ordinary prospect edits.

Technical Discovery does not infer a lane from notes, old tier or service interest. The required select has no default. The preview initially says Review required; commit is disabled and rejected server-side until a valid lane selection is reviewed. Likely Service stays NULL even after a lane is selected. Legacy Technical Assessment rows retain the previously implemented equivalent lane review.

## Commercial model

Likely Service accepts exactly Managed IT, Managed IT + Security, BII, Project and Other. Unset is absence, not another service. Workflow service_lane still accepts only Business IT Integration or Managed IT. Managed IT + Security never implicitly sets Managed IT. Old tier values are retained only in historical source storage/display, not offered in the service dropdown.

## Preservation and safety

All 25 source values have structured destinations. businessName/contactName/currentIT/keyDependency and other existing fields map to their snake_case counterparts; stage maps to legacy_stage and separately to the operational stage. Absent Date First Contacted, Call Frequency Signal, Red Flag and Likely Service are not invented. Owner defaults to Alanna as in the existing application.

Booleans accept true/false and 1/0, with blanks stored NULL. Empty numeric fields stay NULL, while zero stays zero. Counts require nonnegative integers, estimated revenue a nonnegative plain decimal with at most two fractional places, dates YYYY-MM-DD, and times HH:mm or HH:mm:ss. Invalid values stop preview with a row number and no record dump. Join URLs accept HTTP/HTTPS, not executable schemes. Quoted commas, quotes and multiline notes use the CSV parser and escaped HTML output. Export formula protection remains enabled, including leading-whitespace formulas. Notes are stored as text and never evaluated.

The `current_sales` import key is distinct from `pipeline` and `weekly`. Its unique database key is reserved before prospect inserts in the same transaction; repeated/concurrent commits cannot duplicate the import. Errors roll back the whole transaction. The preview occupies the authenticated session temporarily, then is removed on successful commit or replaced by a new preview; there is no permanent duplicate JSON snapshot.

Pipeline export now includes Likely Service, all structured fields, workflow lane and original stage/source alongside existing prospect fields. That full staging report is intentionally distinct from the known source import schemas; it is not a backup restore format. Weekly CSV keeps its existing format. Do not commit exports to Git; CSV files are ignored.

## Validation and execution boundary

Automated tests construct synthetic CSV strings. They cover exact detection, legacy compatibility, source-field preservation through SQL parameter binding, stage decisions, blank values, booleans/numbers/dates, malicious formula strings, escaped preview rendering, unresolved-lane refusal and transactional duplicate prevention/rollback. No tests read the real customer export or call the staging database/Graph. The database transaction fake tests the reservation contract; a live database run of migration 004 remains unverified.

The owner reports staging migrations 001–003 and Entra login already work. This change does not perform the real 44-record import, deploy, alter production, or change dryrun. After reviewing code and migration 004, apply the migration in staging, then inspect the real CSV in preview. The only remaining per-record decision is the Technical Discovery workflow lane. No further commercial or global stage-mapping decision is needed.
