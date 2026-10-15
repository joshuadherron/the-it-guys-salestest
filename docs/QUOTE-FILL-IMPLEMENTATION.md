# Quote/SOW document generation — approved implementation decisions

Owner approval: Managed IT Quote Template v1.8 is approved (confirmed 2026-10-15). The owner authorized the narrowly scoped working-copy file-content write described in the supplied handoff. **Contractual documents remain separate:** BII-QSOW v1.6 and COM-PRP v1.8. Never merge the agreements.

## Deployment gates
- QUOTE_FILL_MODE=off hides generation; dryrun (default) generates downloadable previews only; live may replace the one matching working copy only.
- SHAREPOINT_WRITE_MODE=dryrun forces quote fill into dryrun, even if QUOTE_FILL_MODE=live.
- Owner-only; Approved quote; linked SharePoint Client ID; exactly one open working copy; no pending workflow requests; exact approved master tagset and rates; BII Signature Status Preparing.
- Graph content replacement must use If-Match with the working-copy eTag and fail on 412. Never change metadata, workflows, library files other than the single approved working copy, or quote status.
- Narrative content must be owner-entered. Missing fields remain visible for review; never fabricate scope or legal terms.

## Work still required before enabling UI/live
Import supplied tagged binary DOCX masters into test fixtures and promote approved masters in SharePoint; port the supplied reference filler (CommonJS -> this ES module repo), tagsets and field builders; implement approved-master lookup, working-copy resolver, download-only route, eTag-protected write, quote_fills migration, audit and comprehensive offline tests. Do not enable the Fill button before these checks exist.

Reference source: TIG_Quote_Fill_Codex_Package_v1.zip, CODEX-PROMPT-quote-fill-v1.md.

## Source package received
Received `TIG_Quote_Fill_Codex_Package_v1(1).zip` containing the tested CommonJS `src/docfill/fill-docx.js`, BII-QSOW-v1.6.docx and COM-PRP-v1.8.docx tagged binary masters, reference field builders and tests, `docs/04-managed-it-commercial-rules.md`, and `docs/05-quote-fill-tag-map.md`.

**Do not substitute generated templates for the supplied tagged masters.** Filler requires `jszip` and `@xmldom/xmldom`; repo uses ES modules, so adapt with `createRequire` or convert carefully. Keep the fixtures binary-identical. Import source package and test before enabling a UI action. The owner approved the SharePoint single-working-copy content-write exception; live operation still gated behind `QUOTE_FILL_MODE=live` and `SHAREPOINT_WRITE_MODE=live` and all checks.
