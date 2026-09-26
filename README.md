# The IT Guys sales app

Internal Express/EJS application for Alanna and Josh at `sales.theitguys.us`. Node.js **22.13 or later within 22.x**, MySQL 8, no compilation/native build, no SPA, no ORM. SharePoint remains the client/document system of record. The only SharePoint write path creates items in **Workflow Requests**.

## Local setup

1. Install Node 22 and MySQL 8. Create an empty `utf8mb4` database and a dedicated database account. For setup, the account needs CREATE/ALTER plus normal SELECT/INSERT/UPDATE/DELETE privileges. Use a separate migration account in production if practical.
2. Copy `.env.example` to `.env` and fill the database and Entra settings. Generate a session secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. Never commit `.env`.
3. Run:

```sh
npm ci
npm run migrate
npm run seed
npm test
npm run lint
npm start
```

Open `http://localhost:3000`. Microsoft sign-in is required; there is no development password or authentication bypass. Without Entra configuration, sign-in shows a setup error. Without SharePoint access, the app can still serve local data once MySQL/auth are configured, but handoff stays disabled. Tests require no database, credentials or network.

Migrations run in filename order. MySQL DDL is not transactional: after a failed migration, inspect/reconcile the partially applied schema before retrying. Seeds use INSERT IGNORE and preserve owner edits. The session table is migration-managed.

## Environment

| Variable | Meaning |
|---|---|
| `NODE_ENV` | `development` locally; **production** on Hostinger |
| `PORT` | Hosting-provided port; local default 3000 |
| `APP_URL` | Exact origin, e.g. `https://sales.theitguys.us`; used in Josh's notification links |
| `SESSION_SECRET` | At least 32 random characters; rotating signs out existing sessions |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Hostinger MySQL connection details; port default 3306 |
| `ENTRA_TENANT_ID` | The tenant's GUID, not its domain name |
| `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Server-only confidential app credentials |
| `ENTRA_REDIRECT_URI` | Exact registered Web callback URI |
| `SHAREPOINT_WRITE_MODE` | `dryrun` (default) or `live`; invalid values stop startup |
| `SP_ALANNA_USER_LOOKUP_ID`, `SP_JOSH_USER_LOOKUP_ID` | Needed only when Requested By is a person column: verified numeric SharePoint site-user IDs, not Entra object IDs |

Production requires HTTPS, including the hosting proxy forwarding `X-Forwarded-Proto`. The app trusts one proxy hop. Session cookies are Secure in production, HttpOnly, SameSite=Lax, with an eight-hour lifetime. Local HTTP development omits Secure so Microsoft callback sessions work. Do not enable verbose `DEBUG` logging on production dependencies.

## Entra registration

In the theitguys.us tenant, register **TIG Sales App** as single-tenant. Add Web redirect URIs `http://localhost:3000/auth/callback` and `https://sales.theitguys.us/auth/callback`. Do not enable implicit grant. Create a client secret, record its expiry, and put the value only in server environment settings. Sign-in uses authorization code + PKCE, state, nonce and tenant checks. Only enabled accounts in the MySQL allowlist enter; seeds are Alanna/sales and Josh/owner. Disabling a user takes effect on their next authenticated request.

Add Microsoft Graph **application** permissions `Sites.Selected` and `Mail.Send`, then grant tenant admin consent. No `Sites.ReadWrite.All` permission is requested. OpenID scopes `openid profile email` support interactive sign-in. Graph app tokens stay on the server and are not saved in browser sessions.

### Grant access to the operations site only

A SharePoint/tenant administrator runs this once from an administrative workstation. This elevated **administrator session** grants a site permission; the sales application's permission remains Sites.Selected. Replace the two placeholder GUIDs:

```powershell
Install-Module Microsoft.Graph.Authentication -Scope CurrentUser
Connect-MgGraph -TenantId '<tenant-guid>' -Scopes 'Sites.FullControl.All'
$appId = '<sales-app-client-guid>'
$site = Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/v1.0/sites/theitguys713.sharepoint.com:/sites/TheITGuysOperations'
$permission = @{
    roles = @('write')
    grantedToIdentities = @(@{
        application = @{ id = $appId; displayName = 'TIG Sales App' }
    })
} | ConvertTo-Json -Depth 6
Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/sites/$($site.id)/permissions" -Body $permission -ContentType 'application/json'
Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/sites/$($site.id)/permissions"
Disconnect-MgGraph
```

Check for an existing app grant before running POST again. Do not give the sales app the administrator session's permission. Microsoft documents the two independent requirements—Entra consent and a resource grant—in [Selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview).

### Restrict Mail.Send to Josh

An Exchange Online administrator creates a mail-enabled security group containing **only Josh**, then applies the requested application access policy:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline
$appId = '<sales-app-client-guid>'
New-DistributionGroup -Name 'TIG Sales App Mail Scope' -Alias 'TIGSalesAppMailScope' -Type Security -PrimarySmtpAddress 'TIGSalesAppMailScope@theitguys.us'
Add-DistributionGroupMember -Identity 'TIGSalesAppMailScope@theitguys.us' -Member 'josh@theitguys.us'
New-ApplicationAccessPolicy -AppId $appId -PolicyScopeGroupId 'TIGSalesAppMailScope@theitguys.us' -AccessRight RestrictAccess -Description 'TIG Sales App may send only as Josh'
Get-DistributionGroupMember -Identity 'TIGSalesAppMailScope@theitguys.us'
Test-ApplicationAccessPolicy -AppId $appId -Identity 'josh@theitguys.us'
Test-ApplicationAccessPolicy -AppId $appId -Identity 'alanna@theitguys.us'
Disconnect-ExchangeOnline -Confirm:$false
```

Josh must be granted and Alanna denied. Reuse the existing group/policy if already configured; check membership before changing anything. Allow propagation before live testing. Microsoft labels this policy mechanism legacy and recommends application RBAC for new designs; this implementation documents the policy specifically required by the project. See [Application Access Policies](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-access-policies) and [New-ApplicationAccessPolicy](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-applicationaccesspolicy?view=exchange-ps). The app always sends **from Josh to Josh**.

## SharePoint schema check and switching to live

Startup and **Admin → Check SharePoint connection** resolve the fixed site URL, exact list display names, column internal names and required choices. Missing `Source = Sales App`, required stages/lanes, or columns block handoff. Read-only schema details appear in Admin. The app never modifies list definitions.

Requested By supports text and single-person columns. For a person column, Josh must verify Alanna's/Josh's SharePoint site-user lookup IDs from the existing site records and fill the two environment settings. The app never creates site users or guesses IDs. Unsupported field types block handoff. Lookup serialization follows Microsoft's [fieldValueSet contract](https://learn.microsoft.com/en-us/graph/api/resources/fieldvalueset?view=graph-rest-1.0). Adding more allowlisted users later requires extending the person-ID mapping before they can submit requests to a person-type Requested By field.

1. Leave `SHAREPOINT_WRITE_MODE=dryrun`. Sign in as both roles and check the connection as Josh.
2. Test a synthetic opportunity with the live tenant's read access. Complete the corrected eight MVD groups and review the exact stored `{fields: ...}` request. Dryrun records have no SharePoint item ID and never become live automatically.
3. Verify the Mail.Send restriction, finalize the TODO-OWNER stop conditions, and confirm Power Automate accepts the contract in docs/02.
4. **Josh** changes the hosting environment value to `live` and restarts/redeploys. All pages show the mode. This assistant has not changed the mode or deployed anything.
5. Explicitly submit a new action. Old dryrun requests are not replayed. Set `dryrun` and restart to stop future Graph writes/mail; already queued SharePoint workflows are outside this app's control.

Pending/Processing requests block another request for the opportunity/client. A local Preparing reservation survives a crash. Unknown delivery is not retried automatically. After two minutes Josh can reconcile the exact request title in the handoff UI; a found remote request is linked, while confirmed absence requires a note and explicit checkbox before a fresh manual submission. There remains a cross-system race if someone submits a competing request directly in SharePoint after the app's read; Power Automate must enforce its contract too.

## Hostinger deployment

Use a Node.js-capable Hostinger plan, select Node 22, connect the repository or upload the application source with package-lock.json, and choose `server.js` / `npm start` as the entry/start command. There is no build output directory or native build step. Add a Hostinger MySQL database/user and put its values in the environment panel. Set `NODE_ENV=production`, the production origin/callback, and a fresh session secret. Let hosting provide PORT. Configure `sales.theitguys.us` and HTTPS.

Run migrations and seeds against that database before starting. Where the managed deployment interface supports a custom build command, use `npm ci --omit=dev && npm run migrate && npm run seed`; all three steps use only runtime dependencies. Do not assume Node/npm can be run over SSH on managed Business/Cloud plans. If the deployment command cannot be customized, run migration/seed from a trusted workstation with temporary authorized remote-MySQL access, then remove that access. Keep secrets out of uploaded source/build output. Redeploy after environment changes.

Hostinger's current guides: [Node.js deployment](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/), [environment variables](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/), and [MySQL connection](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/).

## Backup and restore

Use a nightly job on a trusted host with the MySQL client and authorized access to the Hostinger database. Keep a credential file outside the web root/repository with permissions 0600:

```ini
[client]
host=HOSTINGER_DATABASE_HOST
user=BACKUP_DATABASE_USER
password=BACKUP_DATABASE_PASSWORD
```

Example POSIX backup command (replace paths and database name):

```sh
umask 077
mysqldump --defaults-extra-file=/secure/tig-backup.cnf --single-transaction --no-tablespaces --set-gtid-purged=OFF tig_sales > /secure/backups/tig-sales-$(date +%F).sql
```

Schedule it nightly with the host's scheduler/cron, check exit status, encrypt backups at rest, and copy to an owner-approved backup location. If managed hosting lacks mysqldump or scheduling, use a trusted external machine; do not install a new SaaS. Choose retention with Josh. Test restoring periodically into an isolated database using `mysql --defaults-extra-file=/secure/tig-restore.cnf tig_sales_restore < backup.sql`, then compare record counts and discovery history. Never restore over production without an owner-approved recovery plan. Exclude session rows on a production restore or purge them so old sessions cannot resume.

## Behavior and known limits

- Discovery spec stays frozen in docs/01. Owner corrections are in docs/04: Q1.5 joins group 1; network-age flagging is off. All 43 question records preserve answer / Not sure / Not discussed; ownership rows preserve their own states too. The explicit user requirement makes Not discussed the initial state, including Q4.5 (the original document calls its default Not sure).
- Discovery autosaves on change with revision conflict detection. Do not close the browser while it says unsaved; there is no offline mode. Alanna cannot edit after Send to Josh until Josh reopens. Urgent hold persists until owner release, even if the answer changes. A subsequent No→Yes starts a new hold. Notifications are attempted immediately after durable save. A failed/uncertain email is visible in the record; contact Josh directly and do not assume delivery. Notification rows are an audit trail, not a background retry worker.
- Weekly metrics use explicit activity types/outcomes. Calls count call entries; the other five metrics count their matching outcome entries. Logging the same event twice counts twice. Imports are one committed batch per tab, up to 2,000 rows. Historical weekly totals must not overlap app activity periods. Header templates are shown in Import and the export uses those exact headers. No historical workbook was supplied for mapping validation.
- Quotes are immutable saved draft snapshots; editing creates a new draft. New discovery answers, price changes and stop-condition changes invalidate approved drafts. Josh confirms counts because discovery does not capture mailbox/platform/deployment quantities. Unassigned devices avoid inventing a platform. Selected unresolved owner one-offs are excluded from the displayed provisional total and block approval. Sent quotes remain historical records. No hardware math, recurring pricing or client-facing output exists.
- Mark Lost remains disabled pending an exact payload decision. Local Closed Lost stage updates are owner-only. All other planned Graph actions have real adapters; tests substitute a fake.
- Connection checks need real credentials even in dryrun because the app must not invent field names. List scans paginate; this is intended for the small two-person workload. The UI polls only while open; there is no background SharePoint status worker.
- Exact quote/hold/permission checks are enforced server-side. A process-local sign-in limiter fits the specified single-server deployment. Scale-out would require a shared limiter and additional operational review.
- Migrations and real Entra/SharePoint/Hostinger flows have not been run here because no database or tenant credentials were supplied. Complete the live integration checklist in HANDOFF before operational use.

## Code and validation

`server.js` composes middleware and route modules. `src/discovery-rules.js`, `src/pricing.js`, and `src/sharepoint.js` contain the testable rules. `src/graph.js` is the sole Graph transport. Database values use bound parameters; the few generated SQL column names come from fixed code arrays, never user input. EJS escapes displayed answers and JSON. Helmet restricts scripts to same-origin external files; every POST checks a session-bound synchronizer CSRF token using a timing-safe comparison.

Dependencies are the requested mainstream packages. CSRF and sign-in limiting use small built-in implementations rather than extra packages. ESLint is development-only. A mysql2 override prevents express-mysql-session from resolving its older vulnerable nested driver. All Graph tests use a fake; tests do not contact the network. Formatting was performed with a temporary formatter, not an application dependency.
