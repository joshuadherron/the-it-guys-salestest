# Quick Quote copy visibility and content edits — v2

## Migration before deployment

Run **015_quote_content_tags_and_copy_timing.sql** manually before merging this
release into main (Hostinger deploys main automatically). It adds:

- Nullable `quote_fills.ctag VARCHAR(500)` alongside the existing eTag.
- Nullable `sp_requests.done_at DATETIME`, recorded in UTC.

There is no new configuration, table or flow change. Existing fill rows remain
null for cTag; do not backfill them from the current Word file, because that
would silently approve any edits made since the original fill.

## Wait for the copy's metadata

The Q-24/Q-25/Q-26 live walkthrough supplied the root cause: the flow can report
Create Working Copy Done before Client ID, Workflow ID and Instance Reference
are visible to Graph/indexed filtering. A zero-match lookup is a typed visibility
condition, not approval to select another instance or create another copy.

Proposal preparation and the pre-effect Send lookup now wait on the existing
copy request. The same bounded wait applies to an explicitly requested PSA whose
instance is temporarily blank or absent. The worker keeps its normal 30-second
cycle and shows “Waiting for SharePoint to finish the copy…”. More than one match,
a different linked client/file, and other validation failures still refuse.
Previously numbered copies cannot fall back through a cached list row to another
Quote ID, and unscoped legacy resolution excludes numbered copies.

`done_at` is persisted once from the Workflow Request's last-modified timestamp
when Done is observed. If older records have no remote timestamp, the first
observation supplies the timestamp. Subsequent polls, restarts and Try again
preserve that deadline. At ten minutes, the error is:

> SharePoint created the copy but its Instance Reference is still empty after 10 minutes. Check the Create Working Copy flow writes TIG_InstanceRef.

Unknown requests keep the existing exact-title reconciliation path. They are
never recreated merely because a row is temporarily missing. If a Send already
created an email attempt or saved a PDF, a missing lookup stays a failure requiring
the existing delivery-history reconciliation; it does not enter automatic retry.

## Content tags and Word review

A successful new live fill records the **post-write** cTag and eTag. The PUT's
drive-item result supplies the tags; if it omits cTag, the code reads the exact
drive item with `$select=id,eTag,cTag` and verifies its identity and tags before
recording Succeeded. The pre-fill template's cTag is never used as the completed
fill baseline. File replacement still uses eTag for If-Match.

For a fill with cTag, Send explicitly reads the current drive tags and compares
cTag against the saved fill. A metadata-only eTag change proceeds. A real content
change requires the checkbox “I reviewed the Word edits; send the current Word
file” on Quick Quote's Failed/Try again form. The same control appears on the
quote/business status surface. Its explicit `reviewed_edits: "yes"` is persisted
for the queued Send and audited; another retry without checking it clears the
previous flag. Pricing/snapshot, permissions, hold, recipient and PDF-text checks
remain mandatory. PDF conversion compares before/after cTags; a concurrent content
edit refuses even when review was checked. Legacy null-cTag fills retain the
previous eTag comparisons, including the PDF conversion check.

Review does not authorize replay of an existing/uncertain email attempt. Those
remain on the established saved-PDF/admin reconciliation path.

## Existing Q-24, Q-25 and Q-26

After migration and deployment, use **Try again** on the existing quote. Its saved
proposal state/request IDs and working file are reused; do not create new copies.
An older successful fill (such as Q-26) retains its null-cTag/eTag baseline, so it
may require reviewing Word and ticking the new checkbox once. There is no silent
re-fill, cTag backfill, pricing revision or Quote ID replacement.

No production retry was performed in development. Tests cover delayed copy polls,
timeout and persisted timing, PSA visibility, duplicate/wrong instances, actual
live-delivery metadata/content comparisons, review controls/options and the
uncertain-email guard. Flow contracts, pricing, templates/tags and PSA selection,
creation and eSignature requirements are unchanged.
