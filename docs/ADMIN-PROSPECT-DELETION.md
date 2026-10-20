# Admin prospect deletion

Admins see Delete prospect below the business name on the prospect page. The confirmation page shows counts of the local records to be removed. The admin types the opportunity ID and explicitly confirms deleting the prospect and all listed local history, including approved/sent quotes. Success returns to the pipeline.

Deletion is permanent in the sales database. It includes activities, both discovery types and discovery revisions, local notifications and SharePoint request logs, quotes, preparation states, fill history and send-attempt history. It does not delete SharePoint Clients/Sales Prospects rows, folders, DOCX/PDF files, previously sent emails, website source leads or the audit log. It does not issue Mark Lost or any Graph request. The existing website importer normally leaves its imported source lead marked imported; source-system records are outside this action.

The route requires the explicit is_admin permission, independently of owner/sales role, on both GET and POST. It rechecks the current enabled allowlist row in the deletion transaction, as well as the server's normal authenticated-user and CSRF middleware. The preview fingerprint is retained in the session and revalidated against the locked prospect and local record counts; a changed prospect/history requires a fresh preview.

Active/uncertain Workflow Requests, queued notifications, active/interrupted preparation leases, preparing/unknown fills, unresolved sends (including a failed email with a saved PDF), and client operation locks block deletion. Finish or reconcile those operations first. The existing client request mutex and prospect/quote row locks coordinate with workflow and quote routes. Completed linked engagements are not blocked solely because they have a Client ID: the page explicitly explains that external records remain.

Child records are deleted in foreign-key order and the prospect last, within one transaction. Two audit entries retain who deleted the prospect, its opportunity ID/name, and the ordered local-history counts. Any failure rolls back deletion and its audit entries together. Shared client mutex rows and unrelated opportunities are retained. No migration or production configuration change is required.

Tests cover admin permissions and revocation, forged/missing confirmation, stale previews, each operation blocker, local dependency cleanup/FK order, transactional rollback, name escaping and external-record scope. No live prospects are deleted during development or verification.
