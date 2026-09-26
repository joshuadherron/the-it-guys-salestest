# BII Business Discovery Form — v0.3 (Freeze Candidate)

> **App note (2026-09-26, price-first workflow):** the final action in §3 Section 9 and §4, "Send to Technical Assessment", is implemented in the app as **"Send to Josh"**. BII opportunities go to Josh for a commercial quote, and Managed IT opportunities go to Josh for technical assessment scheduling. The MVD gate, flags and hold behavior are unchanged. Everything below is the frozen spec, unedited.

## 1. Design Principles

- Alanna records what the customer says or believes. She never verifies, diagnoses, or classifies.
- Every ownership/technical-adjacent question offers **Not sure**, and every question (or whole section) the conversation never reaches is recorded as **Not discussed** — two different, both-valid states, never collapsed into one.
- Flags are internal and never shown to, or implied to, the customer.
- This form routes; it never scopes, classifies, or prices anything.
- One topic per screen; conditional follow-ups expand inline, never on a separate screen.

**Not sure vs. Not discussed:**
- *Not sure* = Alanna asked; the customer doesn't know.
- *Not discussed* = the conversation didn't reach this question.
Both are legitimate everywhere except MVD REQUIRED fields (§4), which need a real answer — including "Not sure," but not "Not discussed" — before handoff.

Every question below is labeled **MVD REQUIRED** or **DISCOVERY OPTIONAL**. There is no third category.

## 2. Section Order (9 screens)

| # | Screen | Contains |
|---|---|---|
| 1 | Company & Contact | Company basics, contact, industry |
| 2 | People, Locations & Devices | Headcount, integration-user count, locations, device use, hardware/server awareness |
| 3 | Current IT & Priorities | Current arrangement, priorities, transition notes |
| 4 | Accounts, Email & Data | Ownership matrix, email, files, data volume, backup |
| 5 | Critical Applications | Line-of-business software |
| 6 | Security & Network | MFA, shared passwords, security history, current concern, network |
| 7 | Regulatory & Timeline | Regulatory/sensitive data, timing, downtime |
| 8 | Decision & Interest | Approver/billing, services of interest |
| 9 | Review & Send | Summary + handoff |

Sections 1–3 are always presented in order. Sections 4–8 can follow the live conversation's natural order. Section 9 gates on MVD completeness (§4), not on "every section visited."

## 3. Questions

### Section 1 — Company & Contact
- **Q1.1 Business name** — *"What's the business called?"* · Free text · **MVD REQUIRED**
- **Q1.2a Contact name** — asked with Q1.2b: *"Who am I speaking with, and what's your role there?"* · free text · **MVD REQUIRED**
- **Q1.2b Contact role** — free text · **DISCOVERY OPTIONAL**
- **Q1.3 Phone** — *"Best phone number to reach you?"* · Phone · **MVD REQUIRED** (at least one of Q1.3/Q1.4)
- **Q1.4 Email** — *"Best email for you?"* · Email · **MVD REQUIRED** (at least one of Q1.3/Q1.4)
- **Q1.5 Primary location** — *"Where's your main office located?"* · Free text (city/state) · **MVD REQUIRED**
- **Q1.6 Industry** — *"What kind of business is this?"* · single-select: Professional services, Medical/healthcare, Legal, Retail, Construction/trades, Manufacturing, Nonprofit, Government/municipal, Financial services, Hospitality, Other (+free text) · **DISCOVERY OPTIONAL**

### Section 2 — People, Locations & Devices
- **Q2.1 Employee count** — *"Roughly how many people work there?"* · Number · **MVD REQUIRED**
- **Q2.2 Computer count** — *"About how many computers does the business use day-to-day?"* · Number · **MVD REQUIRED**
- **Q2.3 Integration-user count** — *"About how many people need their own company email address or login?"* · Same as employee count / Different (number) / Not sure · **MVD REQUIRED**
- **Q2.4 Locations** — *"Do you operate out of more than one location?"* · Yes/No → if Yes *"How many?"* · **MVD REQUIRED** · Flag **FLAG-MULTI-LOCATION** if >1
- **Q2.5 Work pattern** — *"Is everyone on-site, or does some/all of the team work remotely?"* · Everyone on-site / Some remote / Fully remote / Not sure · **DISCOVERY OPTIONAL**
- **Q2.6 Contractors** — *"Any contractors or outside workers who need company email or system access?"* · Yes/No → number · **DISCOVERY OPTIONAL** · **FLAG-CONTRACTORS** if Yes
- **Q2.7 Personal-device use** — *"Does anyone use their own personal phone or computer for company work?"* · Yes / No / Not sure; if Yes *"Is that mostly phones, computers, or both?"* · **DISCOVERY OPTIONAL** · **FLAG-BYOD-MOBILE** / **FLAG-PERSONAL-COMPUTERS-BUSINESS**
- **Q2.8 Hardware replacement awareness** — *"Are any of those computers old, unreliable, or likely to be replaced as part of this project?"* · Yes / No / Not sure; if Yes *"About how many?"* · **DISCOVERY OPTIONAL** · **FLAG-HARDWARE-REPLACEMENT** (customer-reported only; never implies replacement is necessary)
- **Q2.9 Server awareness** — *"Do you have any server or dedicated computer that other computers or business software depend on?"* Helper: *"No worries if you're not sure — a lot of owners aren't, and that's totally fine to tell me."* · Yes / No / Not sure · **DISCOVERY OPTIONAL** · **FLAG-SERVER-REPORTED** if Yes

### Section 3 — Current IT & Priorities
- **Q3.1 Who handles IT today** — single-select: An employee who also does other jobs / A local IT company/MSP / A break-fix provider / Nobody in particular / We handle it ourselves / Other · **MVD REQUIRED** · **FLAG-CURRENT-PROVIDER** if MSP or break-fix
- **Q3.2 Management style** (only if outside provider) — *"Does your current IT company actively manage and monitor the computers, or do they mostly help when something breaks?"* · Actively managed / Mostly called when needed / Not sure · **DISCOVERY OPTIONAL**
- **Q3.3 Reason for looking** — *"What's making you look at a change now?"* · Free text · **MVD REQUIRED**
- **Q3.4 Pain points** — *"What's been frustrating? Pick everything that applies."* · multi-select: Computer problems, Email issues, Slow/unreliable systems, Shared passwords, Unclear ownership, Poor support, Recurring outages, Files hard to find, Remote-work problems, Security concerns, Backup concerns, Old computers, Vendor coordination problems, No standard onboarding/offboarding, Growth outpacing IT, New location coming, Other · **DISCOVERY OPTIONAL** · **FLAG-SHARED-PASSWORDS** if selected
- **Q3.5 Biggest problem** — *"If we could fix one thing first, what would it be?"* · Free text · **MVD REQUIRED**
- **Q3.6 Transition considerations** (only if outside provider) — *"Anything we should know about transitioning away from them — contract, notice period, or access concerns?"* · free text · **DISCOVERY OPTIONAL**

### Section 4 — Accounts, Email & Data
- **Q4.1 Ownership control matrix** — *"Quick check on two things — who's actually in control of these right now?"* · **DISCOVERY OPTIONAL**
  - Row A, Business email domain: Business owns/controls it and has access / Outside IT/vendor manages it, but the business retains access/control / Outside party appears to control it, and the business may not have independent access / We don't have our own domain / Not sure
  - Row B, Microsoft 365 / email admin account: Business owns/controls it and has access / Outside IT/vendor manages it, but the business retains access/control / Outside party appears to control it, and the business may not have independent access / Not sure
  - Flags per row: vendor-managed → **FLAG-DOMAIN-VENDOR-MANAGED** / **FLAG-MS-ADMIN-VENDOR-MANAGED** (informational); outside control → **FLAG-DOMAIN-ACCESS-CONCERN** / **FLAG-MS-ADMIN-ACCESS-CONCERN**; no domain → **FLAG-DOMAIN-NO-DOMAIN**; Not sure → **FLAG-DOMAIN-UNKNOWN** / **FLAG-MS-ADMIN-UNKNOWN**; owns → no flag. *Alanna reads these options roughly as written; show them verbatim.*
- **Q4.2 Ownership follow-up** — *"Do either of these apply?"* · multi-select: A former employee or past IT provider might still have access to something / Company email or files are stored in someone's personal Gmail/Microsoft account / Neither that I know of · **DISCOVERY OPTIONAL** · **FLAG-FORMER-VENDOR-ACCESS**, **FLAG-PERSONAL-ACCOUNTS-BUSINESS**
- **Q4.3 Email platform** — Microsoft 365 / Google Workspace / Something else / Not sure · **DISCOVERY OPTIONAL**
- **Q4.4 Where files live** — multi-select: Individual computers, A server, A NAS/shared drive, Microsoft OneDrive, SharePoint/Teams, Google Drive, Dropbox, USB/external drives, Other, Not sure · **DISCOVERY OPTIONAL** · **FLAG-SHARED-STORAGE** if server or NAS
- **Q4.5 Approximate data volume** — optional number + GB/TB, or **Not sure** (default) · **DISCOVERY OPTIONAL** · **FLAG-DATA-SIZE-UNKNOWN** if Not sure. No size threshold; stated amounts are data only.
- **Q4.6 Irreplaceable data** — *"Is there anything you absolutely could not afford to lose?"* · Free text · **DISCOVERY OPTIONAL**
- **Q4.7 Backup belief** — *"Do you believe your business data is backed up somewhere?"* · Yes / No / Not sure; if Yes *"What do you think is backed up, and by whom?"* · **DISCOVERY OPTIONAL** · **FLAG-BACKUP-UNKNOWN** if No or Not sure

### Section 5 — Critical Applications
- **Q5.1 Critical software** — *"What software could your business not operate without tomorrow?"* Helper: "Think QuickBooks, industry-specific software, scheduling, point-of-sale — anything the business truly depends on." · repeatable entries: application name, what it's used for, Cloud-based / Installed on computers or a server / Not sure · at least one entry or an explicit "None that I can think of" toggle · **MVD REQUIRED** · **FLAG-LOB-APP** per entry

### Section 6 — Security & Network
- **Q6.1 MFA prompts** — *"When employees sign in to email or company accounts, do they ever get a phone prompt or an authenticator app code?"* · Yes / No / Not sure · **DISCOVERY OPTIONAL**
- **Q6.2 Shared passwords** — *"Do employees ever share logins or passwords with each other?"* · Yes / No / Not sure · **DISCOVERY OPTIONAL** · **FLAG-SHARED-PASSWORDS** if Yes
- **Q6.3a Security history** — *"Has the business had a known security incident or compromised account recently?"* · Yes / No / Not sure; if Yes *"Can you tell me briefly what happened?"* · **DISCOVERY OPTIONAL** · **FLAG-SECURITY-HISTORY** (does NOT hold progression)
- **Q6.3b Current concern** — *"Is anything happening right now that makes you think an account, computer, or email system may currently be compromised?"* · Yes / No / Not sure; if Yes *"Can you tell me briefly what's concerning you?"* · **DISCOVERY OPTIONAL** · **Only "Yes" fires URGENT SECURITY REVIEW** (§5)
- **Q6.4 Internet/Wi-Fi** — *"Any problems with internet reliability or Wi-Fi coverage — including recurring outages?"* · Yes / No / Not sure · **DISCOVERY OPTIONAL**
- **Q6.5 Network management knowledge** — *"Do you know who manages your firewall/network equipment, and roughly how old it is?"* · Yes (free text) / No / Not sure · **DISCOVERY OPTIONAL** · **FLAG-NETWORK-CONCERN** if No, Not sure, Q6.4 = Yes, or the stated age suggests aging hardware

### Section 7 — Regulatory & Timeline
- **Q7.1 Regulatory / sensitive data** — *"Does your business handle information or contracts with special security, privacy, or compliance requirements?"* · multi-select: Patient/medical information; Government work or contracts; Financial-services regulation; Other named regulatory or contractual requirement; Legal/privileged or other sensitive/confidential client data (no specific regulation, but sensitive); We accept credit/debit card payments; None that I know of; Not sure; Other · **DISCOVERY OPTIONAL**
  - **FLAG-REGULATORY**: medical, government, financial regulation or another named requirement
  - **FLAG-SENSITIVE-DATA**: the legal/privileged/sensitive line
  - **FLAG-PAYMENT-CARDS-STANDARD**: card payments alone. Low weight; never escalates on its own. Combined with another category, that category's flag still applies.
- **Q7.2 Desired timeframe** — As soon as possible / Within a month / 1–3 months / No specific deadline / Other · **MVD REQUIRED**
- **Q7.3 Driving event** — *"Is there a move, opening, or deadline driving the timing?"* · Yes (free text) / No · **DISCOVERY OPTIONAL** · **FLAG-DEADLINE**
- **Q7.4 Downtime tolerance** — Little to none / Some is fine / Evenings/weekends are fine / Not sure · **DISCOVERY OPTIONAL** · **FLAG-DOWNTIME-INTOLERANT** if Little to none

### Section 8 — Decision & Interest
- **Q8.1a Project approver** — asked with Q8.1b: *"Who can approve moving forward with a project like this?"* · free text · **MVD REQUIRED**
- **Q8.1b Billing contact** — *"And who handles billing, if that's someone different?"* · free text + "Billing contact same as approver" toggle · **DISCOVERY OPTIONAL**
- **Q8.2 Services of interest** — multi-select: Rebuilding the technology foundation (Business IT Integration), Ongoing IT support (Managed IT), New/replacement computers, Network/Wi-Fi improvements, Backup, Security, Microsoft 365 setup/cleanup, Other project work · **DISCOVERY OPTIONAL** · routing signal only

### Section 9 — Review & Send
The condensed summary (§7) with an expandable full-detail view. Back-navigation to any section never discards data. Final action (app): **"Send to Josh"**.

## 4. MVD handoff gate
"Send" unlocks once all eight groups have a real answer ("Not sure" counts; "Not discussed" doesn't):
1. Q1.1, Q1.2a, and at least one of Q1.3/Q1.4
2. Q2.1, Q2.2, Q2.3, Q2.4
3. Q3.3
4. Q3.5
5. Q3.1
6. Q5.1 (≥1 entry or the "none" toggle)
7. Q7.2
8. Q8.1a

Everything else may stay "Not discussed" forever. URGENT SECURITY REVIEW overrides the gate (§5).

## 5. URGENT SECURITY REVIEW
- **Trigger:** Q6.3b = Yes only.
- **Immediate:** Josh is notified immediately (not batched).
- **Hold:** the record is marked **On Hold — Pending Josh Review**. Normal progression pauses: no scheduling, pricing or timeline talk until Josh releases it.
- **Alanna, in the moment:** no diagnosing, no reassurance about severity, no speculation. She records what was said, thanks the customer, tells them "someone will follow up on that specifically and quickly", and may keep gathering MVD fields if the customer is comfortable.
- It is a routing signal, not an incident-response tool.

## 6. Flags (internal, never shown to the customer)
FLAG-MULTI-LOCATION, FLAG-CONTRACTORS, FLAG-BYOD-MOBILE, FLAG-PERSONAL-COMPUTERS-BUSINESS, FLAG-HARDWARE-REPLACEMENT, FLAG-SERVER-REPORTED, FLAG-CURRENT-PROVIDER, FLAG-DOMAIN-VENDOR-MANAGED (informational), FLAG-DOMAIN-ACCESS-CONCERN, FLAG-DOMAIN-NO-DOMAIN, FLAG-DOMAIN-UNKNOWN, FLAG-MS-ADMIN-VENDOR-MANAGED (informational), FLAG-MS-ADMIN-ACCESS-CONCERN, FLAG-MS-ADMIN-UNKNOWN, FLAG-FORMER-VENDOR-ACCESS, FLAG-PERSONAL-ACCOUNTS-BUSINESS, FLAG-SHARED-STORAGE, FLAG-DATA-SIZE-UNKNOWN, FLAG-LOB-APP (per entry), FLAG-SHARED-PASSWORDS, FLAG-BACKUP-UNKNOWN, FLAG-NETWORK-CONCERN, FLAG-SECURITY-HISTORY, FLAG-REGULATORY, FLAG-SENSITIVE-DATA, FLAG-PAYMENT-CARDS-STANDARD (low weight), FLAG-DEADLINE, FLAG-DOWNTIME-INTOLERANT, **URGENT SECURITY REVIEW**.
**Deleted — do not implement:** FLAG-PROFILE-MIGRATION-LIKELY.

## 7. Summary for Josh (condensed default view, expandable full detail)
1. Company & size: name, contact (name + role), industry, approximate users/devices/logins/locations
2. Why they're looking (Q3.3)
3. Biggest problem (Q3.5)
4. Major systems: Q3.1/Q3.2, email platform, top 1–3 critical apps, server/hardware awareness if reported
5. Major flags: URGENT SECURITY REVIEW first (visually distinct, with hold status), then CURRENT-PROVIDER, DOMAIN-ACCESS-CONCERN, MS-ADMIN-ACCESS-CONCERN, MULTI-LOCATION, REGULATORY, SENSITIVE-DATA, SECURITY-HISTORY. Vendor-managed flags are omitted from the default view.
6. Timing: timeframe, driving event, downtime tolerance
7. Decision & billing: approver, billing contact (or "same as approver")
8. Josh's verification list: the most relevant Not sure / Not discussed items (ownership, backup, network, security)

Full detail: every answer, every flag and the full Not sure / Not discussed inventory. Nothing is discarded.

## 8. What Alanna should and should not ask
- **Asks about:** the business, headcount/devices/locations, who supports IT and how, frustrations, what they *believe* about ownership/backup/security, where files *seem* to live, the software they depend on, timing, and who approves/pays.
- **Never asks about:** Conditional Access, GDAP, Intune, BitLocker/LAPS/TPM, build numbers, DNS/SPF/DKIM/DMARC, firewall firmware, EDR/RMM state, backup configuration, KFM, SharePoint permissions, compliance policy, or migration classification.
- **The form never scopes, classifies or prices.**
