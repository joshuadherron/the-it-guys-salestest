# Universal pipeline: audit and implementation plan

## Existing architecture

- `prospects` is the current opportunity record, not a shared business identity. OPP IDs come from its primary key. Names/contact details are copied on each opportunity, and `client_id` is attached per opportunity. `existing-clients.js` can link an operational Clients row but supports only the BII-to-Managed IT additional-service path.
- `quotes.js` persists immutable approved quote snapshots and revisions, but assumes two pricing modes. `pricing.js` owns existing Managed IT/BII pricing. The Managed IT model remains $125/user/month including security; this expansion does not alter it.
- `discovery.js`, `discovery-rules.js` and `discovery-schema.json` implement detailed managed/BII discovery, flags, revisions and holds. These remain intact; lightweight work reuses the existing discovery/revision tables inside its own opportunity.
- `sharepoint.js` requires managed/BII lane choices for normal operations. `handoff.js` creates a SharePoint client identity at Sales Discovery, and `docfill/proposal-store.js`/`proposals.js` assume MIT-05/BII-05. Project-Based must be an optional separately verified capability, never a new required choice that breaks existing connections.
- `quote_fills`, `quote_send_attempts`, `quote_proposal_states` and client request locks protect live quote operations. These are reused for approved project documents. Automated email remains Managed IT-only; generic acceptance and sales handoff are explicit recorded activities.
- `prospect-lifecycle.js` currently equates customer status with operational activation stages. Generic customer relationships need an independent business/customer status and explicit accepted sales; neither implies Managed IT coverage.
- `prospect-delete.js` permanently deletes an opportunity and local child history, preserving audit and external records. Shared businesses and other opportunities must survive deletion; new child records need FK-ordered cleanup.
- `package.json` has start, migrate, seed, test and lint scripts, but no production build script. Validation will include the full suite, lint and production dependency installation/source/view checks; no build result will be invented.

## Implementation decisions

1. Keep all existing prospect/opportunity IDs and quotes. Add shared businesses, a business FK on opportunities and explicit engagement types. Reuse activities for acceptance and sales handoff. Backfill linked legacy opportunities by exact Client ID; preserve unlinked legacy rows without unsafe name merges. New duplicate-name matches require selecting the existing business. New opportunities under a selected business reuse its customer identity.
2. Default legacy rows/API calls to their existing discovery behavior. New UI supports Managed IT, BII, project and hourly work. Detailed managed/BII intake, risk holds and pricing remain unchanged. Generic intake shows exact missing fields with section links and retains revisions/security flags.
3. Add itemized/fixed and estimated-hour quote modes with estimate arithmetic and configured hourly minimums only, immutable approvals and revisions. Approval is separate from explicit customer authorization; estimates are not invoices.
4. Introduce optional Project-Based routing with verified request/list choices, workflow definitions and an operator-confirmed flow contract. Existing managed/BII checks must continue without any new live configuration. Supply operator routing, idempotency and document tag contracts; do not pretend unapproved templates exist.
5. Add business/opportunity navigation, explicit project/hourly customer acceptance and sales handoff, and preserve the existing pipeline. SharePoint record creation allocates identity/storage only, not managed coverage or onboarding.

## Work sequence and boundaries

Implement schema/domain rules, business navigation/intake, generic quote lifecycle, optional SharePoint/document adapters, sales acceptance/handoff, UI integration and regression tests in that order. Finish with rollout prerequisites and a project-only acceptance procedure. No live database/schema/flow edits, live document writes, mail, merge or deployment are authorized by this task. Migration 012 has a pre-existing local working-tree marker with no textual diff; preserve it and exclude it from feature commits.

## Scope clarification applied before completion

The user clarified this is CRM, discovery, quoting and sales handoff, not a PSA or accounting replacement. Removed the initially drafted engagement execution table, start/complete-work controls and tax engine. Generic discovery now reuses discoveries/discovery_versions, estimate defaults reuse config_prices, and customer acceptance/handoff reuses activities. Only the shared business identity and opportunity classification require migration 013. No task, time, inventory, billing, invoice, payment or tax functionality is introduced. Detailed rollout prerequisites and acceptance steps are in UNIVERSAL-PIPELINE-ROLLOUT.md.

Follow-up: owners may correct an open opportunity's type after discovery, before commercial workflow activity, with an archived questionnaire and a new draft review. See OPPORTUNITY-TYPE-CORRECTION.md for the confirmed OPP-0086 diagnosis and preserved-history safeguards.
