# Managed IT quote review corrections

The generation form captures structured client facts. `src/docfill/managed-reference.js` is the ESM Managed IT portion of the supplied v1.1 reference builder. The unchanged source reference is retained at `test/reference/quote-fields.reference.js`. The Managed IT binary master is imported byte-for-byte from `TIG_Quote_Fill_Codex_Package_v1.1.zip`; its 62-tag contract is unchanged. The revised How to accept sentence and HIPAA acceptance fragment come from that package. BII remains unchanged.

## Database deployment

Apply migration `009_quote_document_facts.sql` before running this version. It adds a unique, stored `quote_number` and `document_facts` JSON field to quotes. Existing quote IDs stay unchanged; the new number is `Q-YYYY-NNN` using the creation year and the numeric quote ID padded to at least three digits. The migration backfills existing numbers, and both quote-creation paths assign numbers for new records. Opening a legacy document page also fills a missing number idempotently. The migration has not been applied during this task.

Document facts are stored only after successful owner-only generation and a transaction rechecks that the quote is still Approved, its inputs and approved line items are unchanged, and the opportunity is not On Hold. Waivers and waiver notes are saved in those facts with the existing document-generation audit event. Reopening the form restores the saved facts.

## Form and commercial safeguards

- Sites use a count and optional cities, never the saved street address. Prepared-for uses name, title and email, prefilling only known contact facts. Blank required facts remain unresolved content controls in the draft instead of printing invented answers.
- Domains reject spaces, URLs, email addresses and names without a dot. Dates use a date picker and long formatting, or the explicit After contracts are signed choice. The standard service summary is prefilled and owner edits require at least 40 characters.
- Device kinds are checkboxes. Assigned computers, company phones and company tablets come from saved worksheet quantities. Shared devices remain separate and priced separately. Assigned quantities over three devices per user require correction/review, consistent with the supplied master and commercial rules. No per-user, shared-device, server, backup or on-site rate was changed.
- A zero computer quantity with users requires explicit No company computers - users on shared devices only confirmation. Personal phones remain excluded.
- Onboarding uses the exact reference Standard or After BII sentence. Onboarding fees must match the approved worksheet. Zero fees require the explicit waiver and a real note, and render as Waived. To change a commercial amount or on-site block hours, save and approve revised worksheet pricing first; the document form cannot silently rewrite approved prices.
- Hourly and block on-site wording comes exactly from the reference builder. Client terms default to None.; sizing has today/opening/Other choices. LOB prefix and extra exclusions are optional facts inserted into the reference wording.
- Missing facts stay undefined and reported as unfilled. Sentinel answers such as None, null, undefined, IDK and 0 are rejected as factual text. Genuine numeric zero quantities and reference-generated coverage cells retain their approved meaning.

## Validation

`test/managed-quote-review.test.js` covers every form row, Quote 10 regressions, minimum-fee wording, waiver and computer guards, domain rejection, missing placeholders, exact reference sentences, form controls and persistence. Existing real-master DOCX tests still verify hashes, exact tag sets, package/XML integrity and rate mismatch refusal. The standalone sample generator remains dryrun-only.

No production configuration, database schema or live SharePoint state was changed during implementation.

Local verification: 286 tests and lint pass on Node 22.23.3. Regenerated Managed IT and BII samples both opened in Microsoft Word with repair disabled; all three pages of each were visually inspected. Managed IT retains 62 approved tags, BII retains 60. Only the v1.1 package replaced the Managed IT master; no tags were added or removed.
