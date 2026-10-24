# Live quote fill and explicit Managed IT send

This change implements the October 15 live-write/send prompt. It does not configure production, change Power Automate, send a real message or enable any live mode.

## Migration and permissions

Apply `010_quote_delivery.sql` after migrations 001-009 before deploying. It adds allowlist permissions and sender profiles, editable email templates, durable fill/send history, client operation locks and sent attribution on quotes. Existing Josh receives admin, quote.approve and quote.send. Existing Alanna receives quote.send only. Her name is seeded, but title and phone stay blank for Josh to verify and enter. The regular seed script preserves existing rows and uses the same defaults for new installations.

Admin is an explicit allowlist flag, separate from the existing sales/owner role. Only an admin can edit permissions, profiles or quote-email configuration. Existing role-based permissions on unrelated sales actions remain in force. The server rereads the enabled allowlist row on every authenticated request. All new routes enforce quote.send; approval enforces quote.approve. MIT-05 completion uses quote.send while retaining the existing written-acceptance confirmation and /Commercial instructions.

## Configuration without changing production defaults

- `QUOTE_FILL_MODE=off|dryrun|live`, default dryrun. This flag governs the quote-content exception independently of SHAREPOINT_WRITE_MODE, which continues governing Workflow Requests.
- `QUOTE_SEND_MODE=off|dryrun|live`, default dryrun. A dryrun Send is a real shared-mailbox email addressed only to the authorized sender, with [DRYRUN] in the subject, zero CC recipients and no PDF saved to SharePoint. It requires an explicit Send; the worker may finish that queued operation after the page closes.
- `QUOTE_SENDER_MAILBOX` must name the dedicated shared mailbox, such as sales@theitguys.us. Missing configuration disables Send with a named reason. workflow@ and the known personal sender mailboxes are rejected. Do not use a personal mailbox as this configuration.
- Masters resolve only from Operational Standards & Templates, using a unique Approved row, the exact document key, a pinned versioned filename and the approved tag set. Managed IT accepts COM-PRP-v1.8.docx or The_IT_Guys_Managed_IT_Quote_Template_v1.8.docx. BII accepts BII-QSOW-v1.6.docx or The_IT_Guys_BII_Short_Form_Quote_SOW_Template_v1.6.docx. The long names were verified in the live library on 2026-10-20. If both aliases are Approved, resolution refuses the duplicate rather than choosing one. Older versions and DRAFT suffixes are not accepted; downloaded contents must pass the exact tag-set check before the resolver returns a master. The key and status columns resolve by exact display names Document Key and Status by default. If production uses other labels, set `QUOTE_MASTER_KEY_COLUMN` and `QUOTE_MASTER_STATUS_COLUMN` to their verified internal names. Missing or ambiguous columns fail closed. No approval is inferred from a local fixture.

## Quick Quote sales entry point

Use **choose/add business → build quote → Preview → Send**. Approval and automatic
preparation now run inside Send; the manual forms below are retained for history,
diagnosis and email-only retry. Managed IT and Project share the PDF/email
transport; BII remains eSignature. Apply migration 014 before deployment. See
[QUICK-QUOTE.md](QUICK-QUOTE.md) for the 30-second worker, optional findings,
Waiting for Josh, uncertain-request matching and PSA definition/copy handling.

## Shared mailbox and Exchange scope

Josh must create the shared mailbox and give the team normal shared-mailbox access. Keep application Mail.Send scoped to Josh's existing notification mailbox plus the new shared quote mailbox, and denied for other mailboxes. Quote sends use `/users/{QUOTE_SENDER_MAILBOX}/sendMail`; existing internal notifications retain their prior Josh-only transport. They never use workflow@.

Using the existing mail-enabled policy group, verify its current membership and add only the shared mailbox, then test the application's access policy against the shared mailbox, Josh and an unrelated mailbox. For the README's group name, the administrator command is `Add-DistributionGroupMember -Identity TIGSalesAppMailScope@theitguys.us -Member sales@theitguys.us`; substitute the real configured shared mailbox. Do not create a duplicate policy or broaden it to all mailboxes. Exchange policy propagation and real application Mail.Send testing are deployment acceptance checks, not work performed here.

## Fill flow

A person with quote.send reviews the existing document-facts form and clicks Fill Quote/SOW in SharePoint. Saved facts are validated against the approved pricing snapshot. The service freshly resolves the client, pending Workflow Requests, exactly one open MIT-05/BII-05 working copy in Commercial and the unique Approved pinned master. The master tag set and rate values are mandatory checks. Live writes replace only that existing DOCX content using If-Match. A 412 refuses rather than overwriting edits. Dryrun never PUTs. Unfilled controls can be completed in Word; the latest checklist and Open in Word link appear on the delivery page.

BII has no automated send. Its next step remains: Review in Word -> set Signature Status = Ready to send -> send the eSignature request from the email Flow 7 sends you. Existing signature controls are unchanged; no new signature or operational metadata write is introduced here.

## Send flow and persistence

Send quote to client is an explicit authenticated POST protected by CSRF and quote.send. The quote must still be Approved, not On Hold, have a successful live fill of the same snapshot, and retain the same open MIT-05 copy. There can be no local or remote pending/uncertain client operation. A changed eTag requires I reviewed the Word edits. Graph converts the current copy to PDF; the server extracts real PDF text and rejects empty/unreadable text, square brackets, TEMPLATE or DRYRUN. It rereads the file eTag after conversion to refuse concurrent edits. Files over 3 MB are refused before saving/sending.

Live recipients are the current prospect primary email plus at most one explicit CC. A theitguys.us primary recipient requires Internal test. No automatic CC exists. Sender name/title/phone must be complete. The configurable plain-text template retains quote, pricing and sender-profile tokens, and uses the same HIPAA BAA phrase as the filled document.

The server durably stores the checked PDF bytes, exact email payload, actor, recipient, mode, correlation ID and snapshot before effects. Live mode creates `<working-copy stem> - SENT <Chicago yyyy-MM-dd>.pdf` in the same Commercial folder using an upload session with conflictBehavior=fail. It never overwrites or renames an existing PDF. Only after a confirmed saved PDF does it email that PDF from the shared mailbox with saveToSentItems=true. Success records Sent, sent_at/by/to/cc, PDF item ID and Graph request ID with an audit entry. The working MIT-05 stays open for written acceptance.

Microsoft Graph sendMail returns 202 Accepted with no response body or message ID. `email_message_id` therefore remains null with this Mail.Send-only API; the actual Graph request ID and generated correlation ID are stored instead. No message ID is invented and no extra Mail.ReadWrite permission is requested. Sent means accepted for processing by Graph, not a delivery receipt.

## Failures and reconciliation

A failed PDF creation sends nothing. A definite email rejection after PDF save leaves the original PDF and a Failed attempt; Retry email only reuses its exact saved bytes and existing PDF item, with the current clicking person's profile. It never creates a second PDF. Changed approval, permissions, client state, mailbox or mode prevent a retry.

Timeouts or uncertain transport/DB outcomes retain Unknown/Sending state and the durable client lock. They are never automatically retried. Admin can reconcile an Unknown fill or an Unknown email with a known saved PDF after waiting at least two minutes, checking Word/Commercial and shared Sent Items, and recording a verification note. Reconciliation sends no email: it records Sent or permits a later explicit email-only retry. An uncertain PDF creation with no confirmed item ID, or a process crash that left Preparing/Sending without a confirmed outcome, requires manual evidence-based database reconciliation; the app intentionally offers no blind retry or automatic lock expiry.

## Verification and deployment gates

On 2026-10-20 the two live Approved long-name quote masters were downloaded read-only and checked with the exact tag sets and synthetic Managed IT/BII fill data. Both passed RATE/fill validation with no unfilled controls. No live file content, metadata or email was changed. This validates master selection and filling, not the later workflow-request or send operations.

Tests use a fake Graph transport; no customer email or SharePoint mutation is performed. They cover content If-Match/412, dryrun, permissions, sender configuration/profile, all pre-send checks, bracket/reserved-word refusal, internal recipients, dryrun targeting, fail-before-email PDF creation, email-only retry, uncertain-result blocking, sent attribution/audit, BAA rendering and admin-only reconciliation. The PDF extractor is also checked locally against an actual generated sample PDF.

Before enabling the dedicated live flags, verify migration 010, actual promoted-master column mapping, a unique client working copy under Commercial, the shared mailbox and Exchange application policy, both sender profiles, a deliberate internal dryrun send and then a deliberate live test. Actual production validation is not performed by this change. Do not enable BII automation, CSS/MSA/BAA generation or scheduled sends.

Local verification on October 15: clean npm ci succeeded with zero reported dependency vulnerabilities, all 327 tests passed and lint passed on Node 22.23.3. The real generated sample PDF extractor read 11,378 characters successfully. Production configuration and all live endpoints remained untouched.
