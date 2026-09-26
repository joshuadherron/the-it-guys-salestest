# Commercial Rules the Sales App May Use (owner-approved as of 2026-09-26)

**Source hierarchy:** signed client docs > Pricing Sheet v15 / BII Standard v1.5 (Pass 7) > this file. The pricing engine reads **all** numbers from a config table (seeded from this file). Never hard-code them in logic, and never invent a number that isn't here.

## Business IT Integration (BII): one-time project
| Item | Rule |
|---|---|
| Foundation | **$3,750** flat |
| Included | 5 users · 5 managed business devices · 5 straightforward mailbox migrations · 1 domain / 1 location · 1 STANDARD data migration workload |
| Additional user | $75 / user |
| Additional managed business device | **$185 / device**, the same on every platform (Windows, Mac, iPhone/iPad, Android). Each device counted once. |
| Personal / BYOD phones | **Never counted** as devices. Included with the user. |
| Additional straightforward mailbox | $130 / mailbox |
| New Dell device deployment | $260 / device labor. Hardware separate at cost + 20%. **The app does not price hardware** (show "hardware quoted separately"). |
| Additional location | Mirrored = +30% of repeatable labor, **owner-reviewed only; do not automate**. Show "Josh prices additional locations". |
| Complex migration, profile migration, specialized/shared/kiosk devices, LOB apps, tenant-to-tenant, additional STANDARD workloads | **Owner one-off.** The app shows "priced by Josh" and never computes a number. |
| Price-first rule | The standard BII quote is issued from Business Discovery for commercial acceptance. Technical verification (TRA) happens **after** signing. A targeted pre-quote assessment happens only when a stop condition exists (the stop-condition list is config; see open questions). |
| Website phrase | "Business IT Integration projects start at $3,750." |

**Worked example (for tests):** 7 users, 8 managed devices (6 PCs, 1 Mac, 1 company iPad), 6 mailboxes, 2 personal phones, 1 location → $3,750 + 2×$75 + 3×$185 + 1×$130 = **$4,585**. The phones are not counted.

## Managed IT: recurring (v1 shows a *signal*, not a price)
Tiers: Monitoring & Maintenance · Essentials · Standard. The Call Tracker "Likely Tier" and "Call Frequency Signal" fields are *signals for Josh, not decisions*. **Do not build a Managed IT price calculator in v1.** The public website calculator (V3/V4 spec) is a separate project.

## Language rules
- Client-facing text uses full names, no nicknames.
- Client-facing output never mentions internal LAB/release status, artifact names, flags or scores.
- No "breach-proof", "100% secure" or compliance-certification claims.
