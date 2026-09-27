# Open questions

1. Josh must finalize pre-quote stop conditions; initial rows are TODO-OWNER.

2. Confirm Workflow Requests Source includes Sales App. Missing values block handoff.

3. Confirm Mark Lost payload. Action remains disabled; owner only in v1.

4. Confirm long-term client-creation permissions; both roles allowed in v1.

5. RESOLVED BY OWNER: Call Tracker v2 Technical Assessment maps to Discovery for BII and remains Technical Assessment for Managed IT. The CSV has no lane column, so preview requires an explicit per-row lane choice; Historical tier values are archived only; current Likely Service also never determines a workflow lane.

6. RESOLVED BY OWNER — discovery-form v0.4 correction: Q1.5 Primary location belongs in MVD group 1. Not sure satisfies it; Not discussed does not. The omission in section 4 was a drafting error.

7. RESOLVED BY OWNER: leave age-based network flagging off. Explicit network concern rules remain active.

8. Confirm live Requested By column type and identity mapping. Text and single-person columns are supported. Person columns require owner-verified SharePoint user lookup IDs in server environment settings; missing mappings or unsupported types block submission.

9. RESOLVED BY OWNER: use the exact Call Tracker v2 headers (14 Pipeline columns without Owner; 8 Weekly Tracker columns including Week Of and Notes). Ignore Legend. Skip the fictional Golden Triangle Orthodontics / Dr. Sarah Lee pair.

10. The user requires Not discussed as every initial state; this takes precedence over the Q4.5-specific Not sure default in the original document.

11. RESOLVED BY OWNER (2026-09-27): current commercial choices are Managed IT, Managed IT + Security, BII, Project and Other. Missing choices stay unset. Workflow lanes remain unchanged and separate.

12. RESOLVED BY OWNER: Current Sales App Export uses its exact 25-column header and separate `current_sales` import source. Contacted/Follow-Up/Nurture default to Prospecting with source stage and status retained. Technical Discovery requires explicit lane review. The actual technical prospect's lane remains a per-record owner choice at preview; no global mapping decision is outstanding.
