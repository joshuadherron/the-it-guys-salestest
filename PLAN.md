# Implementation plan

Implement the frozen documents in order, preserving question wording and keeping Graph writes dryrun by default.

- M1 skeleton + Entra authentication + MySQL migrations and seed configuration.
- M2 pipeline + activities + weekly metrics + previewed CSV import/export.
- M3 nine-screen discovery + flags + eight-group MVD + urgent hold + internal summary.
- M4 internal BII quote + owner approval and stop-condition review.
- M5 restricted SharePoint handoff + schema discovery + polling.
- M6 offline tests, lint, deployment README and HANDOFF.

Commit each milestone. Validate pure rules offline, then route authorization and rendering. Live Entra, MySQL and SharePoint validation requires owner-provided infrastructure; never substitute local passwords or fabricated remote success.

## Completion record

M1–M5 implemented and committed in sequence. M6 includes offline rule/security/render tests, lint, dependency remediation, Node 22 verification, responsive rendering review and operating documentation. Live integration validation is explicitly deferred to provisioned MySQL/Entra/SharePoint/Hostinger infrastructure; see HANDOFF.md.
