# Quick Quote walkthrough fixes — October 24, 2026

This records the v1 implementation. The later live walkthrough confirmed
eventual SharePoint metadata visibility and metadata-only eTag changes; see
[v2 timing/content fixes and migration 015](QUICK-QUOTE-TIMING-V2.md).

## Send identity and diagnostics

The confirmed code defect was divergent copy identity: fill used Client ID +
workflow + Quote ID instance, while Send and successful-fill reuse dropped the
instance and rescanned all open lane copies by saved drive item ID. That made a
successful fill insufficient to guarantee the later selection used its identity.
Both paths now use the same instance lookup, then verify the saved drive and item
IDs. Only copies with no instance can use legacy drive-item fallback. A different
or duplicate instance is refused, including before the final email side effect.

With LOG_LEVEL=debug, logs report counts after workflow, client, completion status
and instance filtering, plus resolved driveItem.id and saved fill item ID. No
recipients or document content are logged. The specific live filter/Graph response
which eliminated Q-21/Q-23 cannot be reconstructed without deployed logs and their
database fills; the new diagnostics make that observable without weakening identity
checks. Graph-shaped tests exercise actual WorkReader normalization, resolver,
DOCX fill and PDF/email delivery for MIT-05 and PRJ-05.

## PSA definition verified through read-only SharePoint access

[Client Workflow Definitions row 31](https://theitguys713.sharepoint.com/sites/TheITGuysOperations/Lists/ClientWorkflowDefinitions/31_.000):

- Workflow: **BII-14**.
- Document: **Project Services Agreement**.
- Document Key: **BII-PSA**.
- Lane: **Business IT Integration**.
- Active: **Yes**; Create Client Copy: **Yes**; target folder: **Commercial**.

The app requests CreateWorkingCopy for this live definition when no signed or
open PSA is present, using the current numeric Quote ID instance and existing
request contract. PSA request IDs are recovered from persisted, quote-specific
PSA request titles in sp_requests; no additional table or migration is needed.
Pending/unknown requests are waited/reconciled, never replayed. Shared client
request locks prevent competing PSA creation. Signed PSA copies are reused.
The Ready for signature screen shows the quote and unsigned PSA working-file
webUrls. Actual eSignature dispatch remains a separate deliberate confirmation.
Missing definitions name BII-PSA and the required lane/copy/active settings.

## Worker, status and retries

An in-process worker starts after SharePoint startup and scans existing Queued,
Prepared and Sending jobs every 30 seconds. It calls the existing advance/send
pipeline with the saved sender; the current allowlist, hold and approval snapshot
are checked on each step. The durable per-job transaction lease prevents a second
process or manual progress call from running the step concurrently. Browser polls
are GET status reads only. WaitingApproval and Failed jobs never auto-retry.

Expired Sending becomes Failed with an uncertainty explanation; a durably Sent
quote can repair its lagging job without another email. Try again requires the
same approved snapshot and no email attempt. Saved or uncertain email attempts
continue through existing delivery-history reconciliation, never automatic replay.
Quote, business/opportunity and dashboard attention surfaces expose failures.
UpsertProspect blocks only another sync for the same prospect, not quote work.

## Form and preview

- New quotes require an explicit Managed IT, BII Project or Project choice.
- Domain is entered by the salesperson; it is never inferred from contact email.
- BII starts at one location. Required proposal facts are marked; Preview lists
  missing facts before Word generation or Send.
- Monthly and one-time Managed IT amounts are separate. Onboarding comes from
  inputs.onboarding (the engine intentionally returns it separately from monthly
  line_items); displaying it does not change prices, saved totals or approval hashes.
- Preview money uses separators and two decimals; zero lines are hidden. BII
  previews include regulated user count and the saved operating-business plan.
- Pricing Sheet Rev. 21 was read from the approved SharePoint library. Its $300–$750
  onboarding range and reference profiles match the existing advisory table; no
  fee is inferred for five users/five computers without the required complexity
  context. Guidance updates as quantities change and never sets the fee.
- Assessment warnings are collapsed and unticked; Send anyway acknowledgement
  is retained. Test email wording explicitly excludes the client.
- New quote is the main business action; other actions are under More. Linked
  SharePoint records no longer display the create-record form.

No pricing rules, RATE checks, templates, tag sets, flow contracts or production
settings were changed. No live requests, files, fills or emails were written in
development. Migration 014 is reused; no new migration or environment switch is
required. PR #6 (Today dashboard) is separate from these fixes.
