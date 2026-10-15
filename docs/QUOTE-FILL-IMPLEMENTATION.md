# Quote/SOW document generation — approved implementation decisions

Owner approval: Managed IT Quote Template v1.8 is approved. The owner authorized the narrowly scoped working-copy file-content write described in the supplied handoff. **Contractual documents remain separate:** BII-QSOW v1.6 and COM-PRP v1.8. Never merge the agreements.

## Deployment gates
- QUOTE_FILL_MODE=off hides generation; dryrun (default) generates downloadable previews only; live may replace the one matching working copy only.
- SHAREPOINT_WRITE_MODE=dryrun forces quote fill into dryrun, even if QUOTE_FILL_MODE=live.
- Owner-only; Approved quote; linked SharePoint Client ID; exactly one open working copy; no pending workflow requests; exact approved master tagset and rates; BII Signature Status Preparing.
- Graph content replacement must use If-Match with the working-copy eTag and fail on 412. Never change metadata, workflows, library files other than the single approved working copy, or quote status.
- Narrative content must be owner-entered. Missing fields remain visible for review; never fabricate scope or legal terms.

## Work still required before enabling UI/live
Import supplied tagged binary DOCX masters into test fixtures and promote approved masters in SharePoint; port the supplied reference filler (CommonJS -> this ES module repo), tagsets and field builders; implement approved-master lookup, working-copy resolver, download-only route, eTag-protected write, quote_fills migration, audit and comprehensive offline tests. Do not enable the Fill button before these checks exist.

Reference source: TIG_Quote_Fill_Codex_Package_v1.zip, CODEX-PROMPT-quote-fill-v1.md.
