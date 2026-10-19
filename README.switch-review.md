# Switch Review pickup

Production repository: joshuadherron/the-it-guys-salestest. Existing quote delivery is unchanged.

The public PHP handler uses only u809002269_swform. The sales app uses its existing sales connection and a second swform pool. No automatic migrations run here. Apply reviewed 003 to swform and additive 004 to sales manually (already reported complete). The unique prospects.switch_lead_id is required before activation.

## Hosting configuration

In the sales Node app environment, add:

```dotenv
SWITCH_PICKUP_ENABLED=false
SWFORM_DB_HOST=localhost
SWFORM_DB_PORT=3306
SWFORM_DB_NAME=u809002269_swform
SWFORM_DB_USER=u809002269_swform_insert
SWFORM_DB_PASS=
SALES_MAIL_ENABLED=false
MAIL_FROM_WEBSITE=website@theitguys.us
MAIL_TO_LEADS=
```

Enter the password privately. Never commit it. Optional SWFORM_DB_SSL=true enables certificate-validated TLS. Set SWITCH_PICKUP_ENABLED=true and redeploy only after both schemas and credentials are ready. The server runs pickup immediately and every five minutes; overlapping processes use a database advisory lock. There is no public pickup endpoint. Keep the Node app running; restarts recover pending work.

The importer uses the live auto-increment prospect ID. It sets source to Switch Review, employee_range verbatim, employee_count NULL, and a New lead marker visible in the pipeline and prospect header. Renewal, concerns, consent, attribution and size flag are stored in switch_review_data JSON; concerns are also in notes. No existing columns are repurposed. Follow-up and next-action dates are +2 days for within 3 months/not sure/no contract, +30 for 3–6 months, +90 for 6–12 months.

Prospect creation commits in sales first, using the unique lead ID. Only then is the inbox marked imported. A failure between those steps reuses the saved prospect on retry. Email starts only for imported rows, remains pending while disabled, and never causes prospect recreation. Failures retry after 5 then 15 minutes, maximum three attempts. Logs contain event codes and lead IDs only. Graph acceptance followed by a database outage may result in duplicate notification mail; it cannot duplicate the prospect.

The reusable lib/graph-mail.js accepts a sender per call and contains no feature mailbox. Website runtime supplies MAIL_FROM_WEBSITE, with MAIL_TO_LEADS defaulting to the same address. Dedicated application credentials SALES_MAIL_TENANT_ID, SALES_MAIL_CLIENT_ID, SALES_MAIL_CLIENT_SECRET are required only when enabling SALES_MAIL_ENABLED. This does not alter the existing quote mail configuration.

Run `node --test tests/switch-review.test.js` for the 12 validation checks of import recovery, concurrency, mail configuration and retry behavior. Mock tests do not verify hosting credentials or Exchange policy. Verify a clearly labeled test submission appears once in sales before considering activation complete.
## Microsoft admin setup — administrator performs these steps

Do not enable mail until restriction tests pass. No admin actions were performed.

1. In Microsoft Entra admin center, App registrations → New registration, create
   a dedicated single-tenant **server mail** app. Keep the existing sales browser
   sign-in/calendar app unchanged. Record tenant ID and application/client ID.
2. API permissions → Add a permission → Microsoft Graph → Application permissions
   → Mail.Send → Add permissions. A tenant administrator grants admin consent.
   Do not add delegated Mail.Send or unnecessary read permissions.
3. Certificates & secrets → create a client secret, store its **value** only in
   the private sales environment as SALES_MAIL_CLIENT_SECRET. Record its expiry
   in your operational credential rotation process.
4. In Exchange Online, verify website@theitguys.us is the intended shared mailbox.
   Create a **mail-enabled security group** containing only this mailbox; then
   restrict the dedicated app using the requested application access policy:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline
$mailAppId = '<DEDICATED-MAIL-APP-CLIENT-ID>'
$scopeGroup = 'WebsiteLeadMailScope@theitguys.us'
New-DistributionGroup -Name 'Website Lead Mail Scope' -Alias 'WebsiteLeadMailScope' -Type Security -PrimarySmtpAddress $scopeGroup
Add-DistributionGroupMember -Identity $scopeGroup -Member 'website@theitguys.us'
New-ApplicationAccessPolicy -AppId $mailAppId -PolicyScopeGroupId $scopeGroup -AccessRight RestrictAccess -Description 'Website lead sender only'
Test-ApplicationAccessPolicy -Identity 'website@theitguys.us' -AppId $mailAppId
Test-ApplicationAccessPolicy -Identity '<ANOTHER-EXISTING-MAILBOX>' -AppId $mailAppId
Disconnect-ExchangeOnline -Confirm:$false
```

5. Expected policy results: website mailbox Granted, unrelated mailbox Denied.
   Allow policy propagation (Microsoft says this can exceed one hour), and have
   the admin verify real Graph calls are restricted before setting the flag true.
   Confirm recipient override in approved production without sending to real leads.
6. Set SALES_MAIL_ENABLED=true only in the approved approved production sales environment,
   run pickup and verify a notification reaches the configured destination.
   Adding a future quote mailbox requires a separately authorized scope/app;
   changing a sender variable alone cannot bypass Exchange restrictions.

Application access policies are Microsoft's legacy mechanism; the commands above
implement the explicitly requested policy. Microsoft's current replacement is
Application RBAC; migrating access models is outside this change.

Sources: [application access policies](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-access-policies),
[New-ApplicationAccessPolicy](https://learn.microsoft.com/en-us/powershell/module/exchange/new-applicationaccesspolicy),
[Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail).


