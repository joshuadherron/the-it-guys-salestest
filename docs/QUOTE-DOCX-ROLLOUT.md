# Quote DOCX rollout checklist

## Current integration state
- Owner-only route: `GET/POST /quotes/:id/document`.
- Approved quote required. Browser POST returns **draft DOCX only**, never a SharePoint write.
- Templates are pinned by exact document key: `COM-PRP-v1.8.docx` and `BII-QSOW-v1.6.docx`.
- The original ZIP package includes both masters under `test/fixtures/`. Run `python3 scripts/import-quote-templates.py path/to/TIG_Quote_Fill_Codex_Package_v1.zip` and commit the resulting binary files.
- Required runtime modules `jszip` and `@xmldom/xmldom` are **not yet present** in `package.json` or `package-lock.json`. Install both and commit the manifest and lockfile together before attempting browser generation.
- Until the masters and dependencies are deployed, browser generation is **not ready**. A missing master returns HTTP 503.
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
