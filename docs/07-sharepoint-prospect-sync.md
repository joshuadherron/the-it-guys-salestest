# SharePoint Prospect Sync Contract

## Owner decision

A prospect is written to SharePoint when the Sales App creates it. A prospect is **not** a Client yet.

Do not use Create Client for raw prospects. For a qualified opportunity it opens the existing engagement record at Sales Discovery, including the Client ID and Commercial folder. This does not convert the opportunity into a paying client. Save proposal can perform this preparation after quote approval.

## SharePoint object

Create a dedicated list named **Sales Prospects** in The IT Guys Operations site.

Minimum columns:

| Display name | Type | Purpose |
|---|---|---|
| Title | Single line text | Business name |
| Opportunity ID | Single line text, unique/indexed | Sales App OPP-xxxx key |
| Contact Name | Single line text | Primary contact |
| Phone | Single line text | Primary phone |
| Email | Single line text | Primary email |
| Address | Single line text | Street address |
| City | Single line text | City |
| State | Single line text | State |
| ZIP | Single line text | ZIP |
| Employee Count | Number | Approximate employee count |
| Stage | Choice | Sales pipeline stage |
| Status | Choice | Active / Nurture / Lost |
| Owner | Single line text or Person | Sales owner |
| Likely Service | Choice or single line text | Sales signal only |
| Next Action | Multiple lines text | Next action |
| Next Action Date | Date | Follow-up date |
| Source | Choice | Include Sales App |
| Sales App Record ID | Number | Local prospect id |
| Last Synced UTC | Date/time | Sync timestamp |

Opportunity ID is the immutable cross-system key. Business name may change while the record is still a prospect.

## Sync behavior

1. POST /prospects validates and commits the local MySQL prospect first.
2. The app creates or updates exactly one Sales Prospects row keyed by Opportunity ID.
3. A SharePoint failure does not delete the local prospect. The app records sync state and shows a visible retry/reconcile action.
4. Editing a prospect updates the same Sales Prospects row.
5. Discovery does not duplicate prospect basics. Business name, contact, phone, email, primary location and employee count are inherited from the prospect record.
6. When Create Client completes, store the separate SharePoint Record ID without marking Converted. Only a successful work-items read that observes Client Activation or a known later stage may sync Converted plus Converted Client ID. Mark Lost syncs Lost, never Converted. The prospect is not deleted.
7. Existing-client opportunities remain linked to the existing Clients row and do not create a new client.

## Write-path rule

Prefer the existing Workflow Requests pattern for durability and auditing:

- Add Request Type: **Upsert Prospect**
- Payload contains the fields above plus opportunityId.
- Power Automate upserts Sales Prospects by Opportunity ID.
- Use the existing Upsert Prospect payload status and convertedClientId for conversion bookkeeping; remove any premature Create Client conversion step.

Until the list and flow exist, do not repurpose Clients or silently write raw prospects there.

Migration 011 adds sharepoint_record_id and the observed SharePoint stage locally. The setup script adds TIGP_SharePointRecordID only with explicit --apply; connection check resolves the exact internal text column, otherwise field sync is disabled. See [deployment and acceptance](PROSPECT-PROPOSALS.md) for flow mappings and retry behavior.
