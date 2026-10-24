# BII Quote and SOW v1.7

October 24 Quick Quote update: use **choose/add business → build BII quote →
Preview → Send**. Optional findings are on preview; Send anyway records their
acknowledgement without a separate review/Continue Anyway form. Send prepares
automatically and stops at Ready for signature, retaining eSignature. No email is
sent automatically for BII. See [QUICK-QUOTE.md](QUICK-QUOTE.md) for migration 014,
PSA creation limitations and live-flow completeness checks. The manual approval
route described below remains a legacy troubleshooting path.

Owner decisions: October 23, 2026. Business-rule reference:
`The_IT_Guys_Business_IT_Integration_Standard_v1.5_Pass10.docx`.
The supplied Standard has no content-control tags. The actual tagged artifact is
`The_IT_Guys_BII_Short_Form_Quote_SOW_Template_v1.7.docx`, also found in the supplied
Downloads location. It is copied byte-for-byte to `test/fixtures/BII-QSOW-v1.7.docx`.

SHA-256: `c21451d63870a9058db311ec12ed7380de48dde719bf5299332fbea85314fa55`.

## Deployment prerequisites

No schema migration or manual seed is needed. After the HTTP listener starts,
a handled background check inserts the three missing rows below into the existing
`config_prices` table. A startup database failure is logged without terminating
the web server. The entry point avoids top-level await for launcher compatibility.
Price loading also repairs missing rows before returning persisted prices, so a
BII fill cannot fail solely because these defaults were absent. `INSERT IGNORE`
preserves every existing value, including owner edits and concurrent inserts.
The following SQL is an optional diagnostic/manual equivalent:

```sql
INSERT IGNORE INTO config_prices (name, amount) VALUES
  ('regulatedBase', 500),
  ('regulatedUser', 25),
  ('regulatedIncludedUsers', 5);

SELECT name, amount FROM config_prices
WHERE name IN ('regulatedBase', 'regulatedUser', 'regulatedIncludedUsers');
```

Alternatively, the existing `npm run seed` inserts missing defaults from
`src/config.js` without overwriting edits. It also seeds the app's other missing
defaults; the SQL above is the narrowly scoped alternative. Neither command was
executed against production during implementation. Review existing rows if
`INSERT IGNORE` finds values already present; it deliberately does not overwrite them.

Promote the owner-approved v1.7 master in Operational Standards & Templates with
Document Key `BII-QSOW` and Status `Approved`. The resolver accepts only
`BII-QSOW-v1.7.docx` or
`The_IT_Guys_BII_Short_Form_Quote_SOW_Template_v1.7.docx` and rejects duplicates,
older versions, draft variants or tag mismatches. The BII-05 route is unchanged.
The old v1.6 file remains an archive fixture, not an active master candidate.

No new request payload, SharePoint column or Power Automate change is required
for these inputs: they are stored in the quote's existing JSON inputs and filled
into the existing working-copy mechanism. Existing permission, hold, intake,
approval, snapshot, request, eTag and signature protections remain. No live-write
mode or production environment setting is enabled by this code.

## Pricing

BII starts at $3,750 and scales with complexity. Foundation, $75 additional user,
$130 additional straightforward mailbox, $185 additional device and $260 New Dell
deployment labor are unchanged. Personal/BYOD phones are still excluded.

The optional Regulated Data Package is a separate one-time line:

```text
regulatedBase + regulatedUser × max(0, users − regulatedIncludedUsers)
```

| Package | In-scope users | Package amount |
| --- | ---: | ---: |
| On | 3 | $500 |
| On | 5 | $500 |
| On | 6 | $525 |
| On | 15 | $750 |
| On | 100 | $2,875 |
| Off | Any | $0; no package price line |

Use the Foundation's user count. The checkbox defaults from Business Discovery
Q7.1 `Patient/medical information`: the same `FLAG-HEALTH-DATA` returned by
`flags()` that Send to Quoting uses for `prepareBaa`. Other regulated-data answers
do not automatically enable it. Josh can turn it off or on in the quote worksheet.
Saving records the choice; existing approved quotes are not automatically repriced.

The unchanged worked example with the package off is $4,585. With the package on
for its seven users, the package is $550 and its total is $5,135.

Printed rate checks are exactly `$500` for `RATE.RegulatedBase` and `$25` for
`RATE.RegulatedUser`, with no `each`. As with the existing rates, a difference
between price configuration and printed template rate rejects the fill, even if
the package is off. Missing prices do not receive hard-coded fallbacks.

## Saved inputs and approval

| Input | Default / rule |
| --- | --- |
| `regulatedPackage` | Boolean; defaults from Q7.1 patient/medical data on a new worksheet; owner override |
| `operatingBusiness` | Boolean, false; Josh selects when staff already work in Microsoft 365 |
| `pilotGroup` | Text; required for operating-business approval |
| `waveCount` | Whole number at least 1; may be absent in a draft |
| `waveBasis` | `department`, `location`, or `department and location` |
| `waveDates` | Text containing the dated wave plan |
| `afterHoursWindows` | Text, default `none`; blank is missing when operating |
| `assessed` | Boolean, false; records an actually completed assessment |
| `assessmentDate` | Valid calendar date; required only when assessed is true |

An operating-business plan runs preparation, one sign-in window, a one-week pilot,
then W team days. The read-only display is `Plan length: 11 + W + 1 = N business days`.
There is no new business-size cap. W determines the plan length; it does not add
price. Scheduled after-hours windows use the normal project rate, with no premium
and no separate price line.

Drafts can save with missing plan fields. Approval lists the exact missing fields.
The operating plan's five fields are all required for approval; an assessment
date is additionally required if assessed is true. A complete plan with assessed
false is approvable without an assessment date. The worksheet and saved review
show: `A free read-only assessment is available before quoting (BT-7.32).`

BT-7.30 findings are pricing warnings for both BII and Managed IT. An owner-ticked
condition requires Continue Anyway before approval, with the same warning message
and `acknowledged` audit value in both lanes. Stop conditions are never ticked
automatically. Approval does not authorize work or service activation. The checklist states:

> The free scripted assessment (BT-7.32) is optional and is not a stop condition.

Neither selecting an operating business nor leaving the free assessment undone
automatically selects a stop condition.

Assessment dates are displayed in the same long America/Chicago calendar format
as `QSOW.IssueDate`, using the existing Chicago helper. Date-picker values retain
their chosen calendar day; approval timestamps are interpreted in UTC before
Chicago conversion. For example an October 24 01:33 UTC approval prints October
23, 2026. An assessment selected for October 23 also prints October 23, 2026.

## Fill mapping

The existing 60 tags remain. The following 14 tags are added:

| Tag | Value |
| --- | --- |
| `IF.RegulatedPackage` | Saved package boolean |
| `QSOW.RegulatedUsers` | `N users`, or `1 user` |
| `QSOW.RegulatedCost` | Config-calculated package amount in existing BII money format |
| `RATE.RegulatedBase` | Verify printed `$500`; do not rewrite master rate |
| `RATE.RegulatedUser` | Verify printed `$25`; do not rewrite master rate |
| `IF.Operating` | Saved operating-business boolean |
| `LABEL.Operating` | `Business already operating.` |
| `QSOW.PilotGroup` | Saved pilot group |
| `QSOW.WaveCount` | Saved W |
| `QSOW.WaveBasis` | Saved basis |
| `QSOW.WaveDates` | Saved dated plan |
| `QSOW.AfterHoursWindows` | Saved windows or `none` |
| `IF.Assessed` | Saved assessed boolean |
| `QSOW.AssessmentDate` | Formatted assessment date |

`IF.Regulated` now follows the same package boolean, so the regulated paragraph
and price row appear together. `QSOW.Total` includes the package when selected.
The new default for `QSOW.RegulatedText` is exactly:

> The Regulated Data Package adds secure (encrypted) email for outside recipients, an automatic screen lock after 15 minutes, a block on USB storage drives, retention and audit logging, and a HIPAA safeguards map in the Business Technology Record. A Business Associate Agreement is put in place before any access to patient information. These controls support the Client's HIPAA safeguards; they are not a compliance certification.

Explicit owner-entered regulated narrative remains supported; it cannot enable
the regulated paragraph while the package is off. The eight IF flags are all
supplied, even when false. Missing any flag rejects the fill. COM-PRP and ENG-PRJ
builders, tags, master files and outputs are unchanged.

## Exact 74-tag contract

```text
Deliverable.Text
Exclusion.Text
IF.Assessed
IF.DataMigration
IF.Hardware
IF.Locations
IF.NewDell
IF.Operating
IF.Regulated
IF.RegulatedPackage
LABEL.Hardware
LABEL.Locations
LABEL.Operating
LABEL.Regulated
NOTE
PricedLine.Desc
PricedLine.Label
PricedLine.Price
QSOW.AddonsNote
QSOW.AfterHoursWindows
QSOW.AssessmentDate
QSOW.BackupContact
QSOW.ClientLegalName
QSOW.ClientShortName
QSOW.DeviceNote
QSOW.DeviceTypes
QSOW.Devices
QSOW.DevicesCost
QSOW.DevicesDesc
QSOW.DevicesIncludedUsed
QSOW.Exceptions
QSOW.ExtraAssumption
QSOW.ExtraExclusions
QSOW.HardwareText
QSOW.IssueDate
QSOW.LOBExclusion
QSOW.Location
QSOW.LocationText
QSOW.Mailboxes
QSOW.MailboxesCost
QSOW.MigrationCost
QSOW.MigrationItem
QSOW.MigrationRow
QSOW.MigrationSource
QSOW.NewDellCost
QSOW.NewDellLabel
QSOW.NewDellQty
QSOW.PilotGroup
QSOW.PreparedFor
QSOW.PrimaryDomain
QSOW.PrimaryLocationQty
QSOW.QuoteId
QSOW.RegulatedCost
QSOW.RegulatedText
QSOW.RegulatedUsers
QSOW.SignerNameTitle
QSOW.SummaryText
QSOW.TargetTiming
QSOW.Total
QSOW.Users
QSOW.UsersCost
QSOW.WaveBasis
QSOW.WaveCount
QSOW.WaveDates
RATE.Device
RATE.Foundation
RATE.Mailbox
RATE.NewDell
RATE.RegulatedBase
RATE.RegulatedUser
RATE.User
REPEAT.Deliverable
REPEAT.Exclusion
REPEAT.PricedLine
```

## Validation and remaining deployment work

`test/bii-v17.test.js` covers all requested package prices, exact discovery default,
owner overrides, the unchanged $4,585 example, drafts, approval errors, schedule
math/neutral pricing, assessment dates, stop behavior, UI fields/hint, all-true and
all-false template fills, matching flags, rate mismatches, master immutability and
the 60-to-74-tag extension. Existing master-resolution, provenance, XML/package,
Managed IT, ENG-PRJ and gate regressions remain in the full test suite.

Local results: **566 tests pass**, including 34 new BII v1.7 tests. A subprocess
regression verifies Hostinger's CommonJS launcher can load the server module graph
without `ERR_REQUIRE_ASYNC_MODULE`. Tests cover an
existing database missing all three defaults through a successful BII DOCX fill,
partial backfill, concurrent/idempotent seeding, preservation of edited prices,
each missing plan field at approval, assessed without a date, incomplete draft
saves, all operating/assessed combinations without owner-selected stops, warning
refusal without Continue Anyway and approval with audited acknowledgement when
it is ticked. Both lanes show the override. `QSOW.AddonsNote` uses the v1.7 wording
`+ add-ons and scope listed in §2` when add-ons apply.
The database-state tests use an injectable query double, not a live MySQL server.
ESLint and production build validation pass. Build validation checks 98 JavaScript sources,
40 EJS views, COM-PRP v1.8, BII-QSOW v1.7 and ENG-PRJ v1.0. Both unaffected lanes'
existing fill tests pass unchanged.

Deploy code and the supplied fixture together, review the automatically seeded configuration
rows, promote the exact master, refresh the connection and verify an approved BII
download in staging. Live SharePoint/Power Automate behavior and owner review of
the final customer-facing Word file are separate rollout checks. No production
write, migration, master promotion or deployment is performed by implementation.
