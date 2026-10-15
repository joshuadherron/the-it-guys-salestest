# Quote DOCX rollout checklist

## Current integration state
- Owner-only route: `GET/POST /quotes/:id/document`.
- Approved quote required. Browser POST returns **draft DOCX only**, never a SharePoint write.
- Templates are pinned by exact document key: `COM-PRP-v1.8.docx` and `BII-QSOW-v1.6.docx`.
- Both original binary masters are installed under `test/fixtures/`, imported using `scripts/import-quote-templates.py` from `TIG_Quote_Fill_Codex_Package_v1.zip`. Their bytes are unchanged. `test/fixtures/quote-masters.json` records the source ZIP and master SHA-256 hashes. Real-master integration tests verify those hashes and the exact approved tag sets (62 Managed IT / 60 BII).
- Required runtime modules `jszip` and `@xmldom/xmldom` are present in both `package.json` and `package-lock.json`. Clean installation has been verified with Node 22.23.3.
- The local deployment prerequisites are complete. Deploy masters, application code and the lockfile together. A missing master still returns HTTP 503. A real owner browser download against the deployed database remains a deployment acceptance check.
- Do not enable SharePoint live writes as a workaround.

## Acceptance gates
1. `npm ci` succeeds from a clean checkout, then `npm test` and `npm run lint` pass.
2. Exact tagset validation passes against both binary approved masters.
3. An owner downloads a real DOCX from an Approved Managed IT quote; Word opens it without repair prompts and the document is visually reviewed.
4. An owner downloads a real DOCX from an Approved BII quote with the same validation.
5. Draft, non-owner, On Hold, and incompatible quote-lane requests are rejected.
6. Rates, monthly/one-time pricing, 50/50 BII payment terms, and client-specific narrative fields are checked against the approved quote and signed-off master.
7. Combined Managed+BII quotes are **not** permitted to generate an unpriced BII contract. First capture a separate approved BII scope.
8. The internal printable worksheet remains unchanged.
9. SharePoint live writes require a separate integration acceptance: exactly one approved master, exactly one open working copy, no pending requests, client ID, eTag, audit record, and both explicit live environment gates.

## Security notes
The preview route never invokes Graph mutation. The server must not expose an arbitrary template path or permit unapproved quotes. The draft must not be sent for signature without a human review. Maintain `QUOTE_FILL_MODE=dryrun` until the acceptance gates pass.


## Local verification on October 15 2026

- `npm ci`, `npm test` and `npm run lint` pass with Node 22.23.3.
- Generate synthetic examples with `node scripts/generate-quote-samples.js`; the default destination is ignored `.tmp/quote-docx-samples`. This script cannot contact Graph or a database and does not load environment configuration.
- Managed IT sample: $590 monthly and $350 onboarding. BII sample: $4,790 one-time. Both have zero unresolved content controls. Pricing is calculated by the unchanged pricing engine.
- Both samples opened read-only in Microsoft Word with OpenAndRepair disabled, and were exported to PDF. All three pages of each sample were visually reviewed. The packaged LibreOffice renderer was unavailable on this Windows host; Word provided the opening and rendering verification.
- The BII master contains a valid XML byte-order mark. The filler removes it from the parser input only, without changing either approved master, its tags, or fixed contract text. Integration tests check all generated XML parts, ZIP integrity, unchanged non-content package parts, filled totals, rate mismatch rejection and absence of remaining content controls.
- Existing regression fixtures were brought up to date with the current workflow labels, inherited discovery fields and separate BII approval policy. Discovery's resume storage was moved from an inline script blocked by Helmet CSP into the existing same-origin browser module. No pricing rules or contractual clauses were changed.
- No production configuration was modified, and no live SharePoint write was enabled or executed. Server deployment and a real approved-quote browser download have not been performed here. The separate live integration gates below remain required before any future working-copy overwrite.


## Managed IT review follow-up

The Managed IT master/reference are now sourced from package v1.1 with the same 62 tags and the revised How to accept wording. Apply migration 009 for stored quote numbers and document facts before deploying the structured generation form. See [review corrections](QUOTE-FILL-REVIEW-1.md). The existing standalone sample generator and BII regression checks remain available.
