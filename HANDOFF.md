# v1 handoff

The six implementation milestones are complete in local source, with separate M1–M6 commits. **Not deployed. SHAREPOINT_WRITE_MODE defaults to dryrun.**

## Implemented

- Express/EJS app, MySQL migrations/seeds, Entra authorization-code sign-in, two seeded roles, session store, CSRF, Helmet/CSP and sign-in limiting.
- Prospect quick-add/edit, sequential OPP identifiers, Today and stage views, search, activities, weekly totals, CSV preview/commit and export.
- Nine discovery screens and 43 frozen question records, independent answer states, inline follow-ups, autosave/revision conflicts, append-only answer versions, all flag rules, corrected MVD gate, review lock/reopen, urgent hold/email and owner release note.
- BII worksheet, config-driven prices, platform/device counting, owner one-offs, stop checklist, approval/Sent states and internal print view.
- SharePoint display-name schema resolution, required-choice checks, exact stored request bodies, dryrun behavior, Pending/Processing refusal, persistent uncertain-delivery protection/reconciliation, status polling and client-stage reads.
- Owner configuration and audit views. No client-facing documents, hardware calculator, Managed IT calculator, customer logins or SharePoint document writes.

## Resolved by owner

- Discovery v0.4 correction: Q1.5 Primary location is required in group 1. Not sure counts; Not discussed does not.
- Leave network-equipment age flagging off. Explicit internet/Wi-Fi and network-management rules remain.

## Disabled and open

Mark Lost is intentionally disabled until its exact request payload is confirmed. Stop conditions remain TODO-OWNER until Josh finalizes them. Missing Source=Sales App, unsupported/missing column types, or absent verified person lookup IDs block handoff. Call Tracker v2 headers and legacy stage mapping are implemented; Technical Assessment rows need an explicit lane choice during preview. Weekly Notes are preserved, Legend is ignored, and the named fictional sample is skipped. Apply migration 003 before using the updated weekly importer. See OPEN_QUESTIONS.md.

No authentication or Graph adapter is stubbed in the production application. The test Graph is a fake and the temporary visual preview used only synthetic data. No real emails or SharePoint writes were performed.

## Run

Use Node 22.13+ within 22.x and MySQL 8. Configure `.env` from `.env.example`, then run `npm ci`, `npm run migrate`, `npm run seed`, and `npm start`. README.md contains the Entra grant commands, Hostinger deployment procedure, environment settings, live switch and nightly backup approach.

## Verification and remaining integration checks

- Offline Node tests cover every flag and negatives, all eight MVD groups, Q1.5 correction, urgent holds, price example ($4,585) and edges, exact payloads, active-request refusal, role guards, CSRF, dryrun writes, and all EJS page templates.
- Test and lint commands were verified under Node 22.23.3; dependency audit reported zero vulnerabilities after patched dependency resolution.
- Desktop pipeline and 390-pixel discovery layout were visually reviewed with synthetic records. This was a rendering review, not an authenticated database end-to-end test.
- No MySQL service, Entra credentials, Hostinger account or SharePoint tenant access was available. Migrations, real authentication, person lookup mappings, mail policy enforcement and live Power Automate round trips remain **unverified**.

Before operational use, Josh should:

1. Apply migrations/seeds to a non-production MySQL 8 database. Verify prospect/activity/import writes, reload persistence and simultaneous-tab conflict handling.
2. Sign in as both allowlisted users and an unlisted tenant account. Confirm owner-only operations are refused for Alanna and cookies are Secure over production HTTPS.
3. Run the SharePoint connection check and confirm Source, column types, exact lane/stage choices and Requested By identity mapping. Verify dryrun request JSON and would-email records.
4. Exercise Q6.3b=Yes, failed-mail visibility, hold-release note, Send to Josh locking and owner reopen. Test pricing/stop checklist with Josh's finalized rules.
5. Confirm the Exchange restriction grants Josh and denies Alanna. Submit one owner-authorized live test request only after Josh switches mode; confirm Power Automate completion, Client ID linking and client-stage reads.
6. Complete a backup/restore drill and verify production proxy/cookie behavior before real prospect data entry.
