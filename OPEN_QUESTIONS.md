# Open questions

1. Josh must finalize pre-quote stop conditions; initial rows are TODO-OWNER.

2. RESOLVED BY OWNER (2026-09-28): Source must be Sales App. Josh will rename Sales app in SharePoint; the app keeps exact spelling and diagnoses the mismatch.

4. Confirm long-term client-creation permissions; both roles allowed in v1.

5. RESOLVED BY OWNER: Call Tracker v2 Technical Assessment maps to Discovery for BII and remains Technical Assessment for Managed IT. The CSV has no lane column, so preview requires an explicit per-row lane choice; Historical tier values are archived only; current Likely Service also never determines a workflow lane.

6. RESOLVED BY OWNER — discovery-form v0.4 correction: Q1.5 Primary location belongs in MVD group 1. Not sure satisfies it; Not discussed does not. The omission in section 4 was a drafting error.

7. RESOLVED BY OWNER: leave age-based network flagging off. Explicit network concern rules remain active.

8. Confirm live Requested By column type and identity mapping. Text and single-person columns are supported. Person columns require owner-verified SharePoint user lookup IDs in server environment settings; missing mappings or unsupported types block submission.

9. RESOLVED BY OWNER: use the exact Call Tracker v2 headers (14 Pipeline columns without Owner; 8 Weekly Tracker columns including Week Of and Notes). Ignore Legend. Skip the fictional Golden Triangle Orthodontics / Dr. Sarah Lee pair.

10. The user requires Not discussed as every initial state; this takes precedence over the Q4.5-specific Not sure default in the original document.

11. RESOLVED BY OWNER (2026-09-27): current commercial choices are Managed IT, Managed IT + Security, BII, Project and Other. Missing choices stay unset. Workflow lanes remain unchanged and separate.

12. RESOLVED BY OWNER: Current Sales App Export uses its exact 25-column header and separate `current_sales` import source. Contacted/Follow-Up/Nurture default to Prospecting with source stage and status retained. Technical Discovery requires explicit lane review. The actual technical prospect's lane remains a per-record owner choice at preview; no global mapping decision is outstanding.

## v1.1 owner resolutions — 2026-09-28

- Mark Lost payload confirmed: clientId, one of seven exact reasons, optional notes (500 characters), and expectedStage. Owner only, linked clients before activation; Done closes locally. Former open item 3 is removed.
- Create Client includes a one-time internal discovery snapshot, all questions/states and flags, with a 60,000-character payload limit. Later edits stay local.
- Business names must satisfy the live folder-name restrictions before handoff and when edited; no existing names are rewritten and the rename lock remains.
- Advance Stage is not built in v1. Josh performs it in SharePoint.
- Source spelling is resolved above; Josh's SharePoint rename remains an operational step, not an app schema change.
