# 72 Hours rulebook (verified 2026-10-29)

Deadlines are computed by code in `src/rules/` (data in `regimes.ts`, engine in `engine.ts`, tests in
`engine.test.ts`). This sheet is the human-readable index. Quotes are verbatim in `regimes.ts`; when a rule changes,
update the quote, the test and this table together. **This is not legal advice: the DPO decides.**

Principle: when a text can be read more than one way, the engine uses the **earliest** reasonable deadline and records
the choice as an assumption (shown in the app's Assumptions ledger).

| Regime | Applies when (scoping answers) | Notice | Deadline as computed | Source |
| --- | --- | --- | --- | --- |
| GDPR | Affected people live in the EU/EEA | Lead supervisory authority | 72 h after awareness, unless risk is "unlikely" | [GDPR Art. 33(1)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679) |
| GDPR | as above, risk "high" | Data subjects | Without undue delay (no fixed limit) | GDPR Art. 34(1) |
| UK GDPR | Affected people live in the UK | Information Commission (formerly ICO) | 72 h after awareness, unless risk is "unlikely" | [UK GDPR Art. 33(1)](https://www.legislation.gov.uk/eur/2016/679/article/33) |
| UK GDPR | as above, risk "high" | Data subjects | Without undue delay | UK GDPR Art. 34(1) |
| Philippines DPA | People in PH; sensitive data or identity-fraud data; risk not "unlikely" | National Privacy Commission | 72 h after knowledge or reasonable belief | [NPC Circular 16-03](https://privacy.gov.ph/wp-content/uploads/2022/01/sgd-npc-circular-16-03-personal-data-breach-management.pdf) (Section 11; Notification of the Commission) |
| Philippines DPA | as above | Data subjects | 72 h after knowledge or reasonable belief | NPC Circular 16-03 (Notification of data subjects) |
| Philippines DPA | as above | NPC full report | 5 days, counted as 120 h after awareness | NPC Circular 16-03 |
| NIS2 | Essential/important entity, significant incident | CSIRT / competent authority: early warning | 24 h after awareness | [NIS2 Art. 23(4)(a)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022L2555) |
| NIS2 | as above | Incident notification | 72 h after awareness (24 h for trust service providers) | NIS2 Art. 23(4)(b) and second subparagraph |
| NIS2 | as above | Final report | 1 month after the incident notification (from its deadline until a submission time is recorded) | NIS2 Art. 23(4)(d) |
| HIPAA | Covered entity, unsecured PHI | Individuals | End of the 60th calendar day after discovery (local time) | [45 CFR 164.404(b)](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D) |
| HIPAA | Covered entity, 500 or more people | HHS | With the individual notice | 45 CFR 164.408(b) |
| HIPAA | Covered entity, under 500 people | HHS | 60 days after the end of the calendar year of discovery (1 March, or 29 February in a leap year) | 45 CFR 164.408(c) |
| HIPAA | More than 500 residents of one State | Media | 60 calendar days after discovery | 45 CFR 164.406 |
| HIPAA | Business associate | Covered entity | 60 calendar days after discovery | 45 CFR 164.410(b) |
| SEC | SEC registrant | Form 8-K Item 1.05 | 4 US business days after the materiality determination, shown at 17:30 New York time | [Form 8-K](https://www.sec.gov/files/form8-k.pdf) Item 1.05; General Instruction B.1 |
| Singapore PDPA | People in SG | Assessment (internal) | 30 calendar days after awareness (PDPC guidance, a target) | [PDPC guide](https://www.pdpc.gov.sg/-/media/files/pdpc/pdf-files/other-guides/guide-on-managing-and-notifying-data-breaches-under-the-pdpa-15-mar-2021.pdf) |
| Singapore PDPA | Notifiable (risk not "unlikely", or 500 or more people) | PDPC | End of the 3rd calendar day after the day of the assessment | [PDPA s26D(1)](https://sso.agc.gov.sg/Act/PDPA2012?ProvIds=P16A-) |
| Singapore PDPA | as above, risk "high" | Affected individuals | As soon as practicable, at or after the PDPC notice | PDPA s26D(2) |

## Counting rules
- **Hours**: exact elapsed time from the trigger instant; daylight-saving changes do not shift them.
- **Calendar days**: the organisation's local date of the trigger plus N days, deadline at the end of that local day.
- **Business days (SEC)**: weekdays that are not US federal holidays (5 U.S.C. 6103, Saturday holidays observed on
  Friday, Sunday holidays on Monday), counted from the day after the determination.
- **Months (NIS2)**: same day next month, clamped to the last day (31 Jan → 28/29 Feb).

## What each notice must contain (verified 2026-10-29)

Notice fields are in `src/notice/fields.ts` (one shared vocabulary, so a fact gathered once fills every notice that needs
it); verbatim quotes are kept there. "Where possible" and "where applicable" items count as required; the DPO can answer
"not known" or "not applicable".

| Notice (stage) | Fields | Source |
| --- | --- | --- |
| GDPR / UK GDPR authority | Nature, categories and approx. number of people and records, DPO contact, likely consequences, measures taken or proposed; reasons for delay only if later than 72 h | GDPR / UK GDPR Art. 33(3), 33(1) |
| NPC notification and full report | How it happened, timeline, approx. number of people or records, nature, likely consequences, DPO contact, sensitive data, identity-fraud data, measures, securing the data, informing people (or reasons for delay), preventing a recurrence | NPC Circular 16-03, D. Content of Notification |
| NIS2 early warning | Suspected malicious cause, cross-border impact | NIS2 Art. 23(4)(a) |
| NIS2 incident notification | The above, plus severity and impact; indicators of compromise where available | NIS2 Art. 23(4)(b) |
| NIS2 final report | Detailed description, severity and impact, threat or root cause, mitigation, cross-border impact | NIS2 Art. 23(4)(d) |
| HIPAA notice to individuals | What happened with dates of breach and discovery, types of PHI, steps people should take, what the entity is doing, contact procedures | 45 CFR 164.404(c)(1) |
| HIPAA notice to the media | Same content as the notice to individuals | 45 CFR 164.406(c) |
| HIPAA business associate to covered entity | Identification of each affected individual; other 164.404(c) facts where available | 45 CFR 164.410(c) |
| GDPR / UK GDPR notice to people | Nature in clear and plain language, contact point, likely consequences, measures | GDPR / UK GDPR Art. 34(2) |
| NPC notice to data subjects | Nature, personal data involved, measures, reducing harm, the controller's representative and contact, assistance offered | NPC Circular 16-03, notification of data subjects: Content of Notification |
| SEC Form 8-K Item 1.05 | Nature, scope and timing; material or reasonably likely material impact | Form 8-K Item 1.05(a) |

Not mapped (deadlines still computed): HIPAA reports to HHS (filed through the HHS breach portal form) and Singapore
PDPA notices (content set by the PDP (Notification of Data Breaches) Regulations, not yet verified).

## Open items to verify before launch
- SEC same-day EDGAR cutoff (17:30 ET used) and the "business day" definition: confirm with counsel/EDGAR Filer Manual.
- NIS2: national transposition laws may add detail per CSIRT; not modelled.
- NPC: newer circulars (e.g. NPC Circular 2022-01 on fines) do not change these timings per the NPC's breach-reporting
  page (checked 2026-10-29), but recheck before submission.
- DORA (financial entities) is not yet in the rulebook.
