// The rulebook: one entry per regime, one stage per notice. Quotes are verbatim from the primary source and were
// checked on `lastVerified`. Change a rule only together with its quote, its test and docs/RULEBOOK.md.
import type { IncidentScope, Regime } from './types';

const VERIFIED = '2026-10-29';

/** EU member states plus the EEA countries that apply the GDPR (Iceland, Liechtenstein, Norway). */
export const EEA = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
]);

const livesIn = (scope: IncidentScope, codes: Set<string> | string[]) => {
  const set = codes instanceof Set ? codes : new Set(codes);
  return scope.subjectCountries.some((c) => set.has(c.toUpperCase()));
};

const GDPR_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679';
const UK_GDPR_URL = 'https://www.legislation.gov.uk/eur/2016/679/article/33';
const NIS2_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022L2555';
const NPC_URL = 'https://privacy.gov.ph/wp-content/uploads/2022/01/sgd-npc-circular-16-03-personal-data-breach-management.pdf';
const HIPAA_URL = 'https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D';
const SEC_URL = 'https://www.sec.gov/files/form8-k.pdf';
const PDPA_URL = 'https://sso.agc.gov.sg/Act/PDPA2012?ProvIds=P16A-';
const PDPC_GUIDE_URL =
  'https://www.pdpc.gov.sg/-/media/files/pdpc/pdf-files/other-guides/guide-on-managing-and-notifying-data-breaches-under-the-pdpa-15-mar-2021.pdf';

const GDPR_33_QUOTE =
  'In the case of a personal data breach, the controller shall without undue delay and, where feasible, not later than ' +
  '72 hours after having become aware of it, notify the personal data breach to the supervisory authority competent in ' +
  'accordance with Article 55, unless the personal data breach is unlikely to result in a risk to the rights and ' +
  'freedoms of natural persons. Where the notification to the supervisory authority is not made within 72 hours, it ' +
  'shall be accompanied by reasons for the delay.';

const GDPR_34_QUOTE =
  'When the personal data breach is likely to result in a high risk to the rights and freedoms of natural persons, the ' +
  'controller shall communicate the personal data breach to the data subject without undue delay.';

export const REGIMES: Regime[] = [
  {
    id: 'gdpr',
    name: 'GDPR',
    jurisdiction: 'European Union / EEA',
    lastVerified: VERIFIED,
    appliesWhen: (s) => livesIn(s, EEA),
    stages: [
      {
        key: 'gdpr-33-authority',
        action: 'Notify the lead supervisory authority',
        recipient: 'EU supervisory authority (Art. 55)',
        trigger: 'awareness',
        duration: { kind: 'hours', amount: 72 },
        appliesWhen: (s) => s.riskLevel !== 'unlikely',
        citation: { label: 'GDPR Art. 33(1)', url: GDPR_URL, quote: GDPR_33_QUOTE },
        assumptions: [
          'GDPR is treated as applying when any affected person lives in the EU/EEA (Art. 3 territorial scope is a legal question for the DPO).',
          'If the team rates the risk as "unlikely", no authority notice is computed, but Art. 33(5) still requires the breach to be documented.',
        ],
      },
      {
        key: 'gdpr-34-subjects',
        action: 'Tell the affected people',
        recipient: 'Data subjects',
        trigger: 'awareness',
        duration: { kind: 'asap' },
        appliesWhen: (s) => s.riskLevel === 'high',
        citation: { label: 'GDPR Art. 34(1)', url: GDPR_URL, quote: GDPR_34_QUOTE },
        assumptions: ['Art. 34(3) exemptions (e.g. encryption) are a DPO decision and are not applied automatically.'],
      },
    ],
  },
  {
    id: 'uk-gdpr',
    name: 'UK GDPR',
    jurisdiction: 'United Kingdom',
    lastVerified: VERIFIED,
    appliesWhen: (s) => livesIn(s, ['GB', 'UK']),
    stages: [
      {
        key: 'uk-33-commission',
        action: 'Notify the Information Commission',
        recipient: 'Information Commission (formerly the ICO)',
        trigger: 'awareness',
        duration: { kind: 'hours', amount: 72 },
        appliesWhen: (s) => s.riskLevel !== 'unlikely',
        citation: {
          label: 'UK GDPR Art. 33(1)',
          url: UK_GDPR_URL,
          quote:
            'In the case of a personal data breach, the controller shall without undue delay and, where feasible, not ' +
            'later than 72 hours after having become aware of it, notify the personal data breach to the Commission, ' +
            'unless the personal data breach is unlikely to result in a risk to the rights and freedoms of natural persons.',
        },
      },
      {
        key: 'uk-34-subjects',
        action: 'Tell the affected people',
        recipient: 'Data subjects',
        trigger: 'awareness',
        duration: { kind: 'asap' },
        appliesWhen: (s) => s.riskLevel === 'high',
        citation: { label: 'UK GDPR Art. 34(1)', url: UK_GDPR_URL.replace('/33', '/34'), quote: GDPR_34_QUOTE },
      },
    ],
  },
  {
    id: 'ph-npc',
    name: 'Philippines Data Privacy Act',
    jurisdiction: 'Philippines',
    lastVerified: VERIFIED,
    // Circular 16-03 Section 11: sensitive personal information or information that may enable identity fraud,
    // reasonably believed acquired by an unauthorized person, likely to give rise to a real risk of serious harm.
    appliesWhen: (s) => livesIn(s, ['PH']) && (s.sensitiveData || s.identityFraudRisk) && s.riskLevel !== 'unlikely',
    stages: [
      {
        key: 'npc-commission',
        action: 'Notify the National Privacy Commission',
        recipient: 'National Privacy Commission (NPC)',
        trigger: 'awareness',
        duration: { kind: 'hours', amount: 72 },
        citation: {
          label: 'NPC Circular 16-03, Notification of the Commission',
          url: NPC_URL,
          quote:
            'The Commission shall be notified within seventy-two (72) hours upon knowledge of or the reasonable belief ' +
            'by the personal information controller or personal information processor that a personal data breach has occurred.',
        },
      },
      {
        key: 'npc-subjects',
        action: 'Notify the affected people',
        recipient: 'Data subjects',
        trigger: 'awareness',
        duration: { kind: 'hours', amount: 72 },
        citation: {
          label: 'NPC Circular 16-03, Notification of data subjects',
          url: NPC_URL,
          quote:
            'The data subjects shall be notified within seventy-two (72) hours upon knowledge of or reasonable belief by ' +
            'the personal information controller or personal information processor that a personal data breach has occurred.',
        },
        assumptions: ['Postponing or omitting data subject notice needs NPC approval; the clock is shown until the DPO records that approval.'],
      },
      {
        key: 'npc-full-report',
        action: 'Send the full breach report to the NPC',
        recipient: 'National Privacy Commission (NPC)',
        trigger: 'awareness',
        duration: { kind: 'hours', amount: 120 },
        citation: {
          label: 'NPC Circular 16-03, Notification of the Commission',
          url: NPC_URL,
          quote:
            'The full report of the personal data breach must be submitted within five (5) days, unless the personal ' +
            'information controller is granted additional time by the Commission to comply.',
        },
        assumptions: ['"Within five (5) days" is counted as 120 hours from awareness, the earliest reading.'],
      },
    ],
  },
  {
    id: 'nis2',
    name: 'NIS2',
    jurisdiction: 'European Union',
    lastVerified: VERIFIED,
    appliesWhen: (s) => s.nis2SignificantIncident,
    stages: [
      {
        key: 'nis2-early-warning',
        action: 'Send the early warning',
        recipient: 'National CSIRT or competent authority',
        trigger: 'awareness',
        duration: { kind: 'hours', amount: 24 },
        citation: {
          label: 'NIS2 Art. 23(4)(a)',
          url: NIS2_URL,
          quote:
            'without undue delay and in any event within 24 hours of becoming aware of the significant incident, an early ' +
            'warning, which, where applicable, shall indicate whether the significant incident is suspected of being caused ' +
            'by unlawful or malicious acts or could have a cross-border impact;',
        },
        assumptions: ['Member State transposition laws can add detail; the national law of the lead CSIRT is not yet modelled.'],
      },
      {
        key: 'nis2-incident-notification',
        action: 'Send the incident notification',
        recipient: 'National CSIRT or competent authority',
        trigger: 'awareness',
        duration: { kind: 'hours', amount: 72 },
        appliesWhen: (s) => !s.nis2TrustServiceProvider,
        citation: {
          label: 'NIS2 Art. 23(4)(b)',
          url: NIS2_URL,
          quote:
            'without undue delay and in any event within 72 hours of becoming aware of the significant incident, an ' +
            'incident notification, which, where applicable, shall update the information referred to in point (a) and ' +
            'indicate an initial assessment of the significant incident, including its severity and impact, as well as, ' +
            'where available, the indicators of compromise;',
        },
      },
      {
        key: 'nis2-incident-notification-tsp',
        action: 'Send the incident notification (trust service provider)',
        recipient: 'National CSIRT or competent authority',
        trigger: 'awareness',
        duration: { kind: 'hours', amount: 24 },
        appliesWhen: (s) => s.nis2TrustServiceProvider,
        citation: {
          label: 'NIS2 Art. 23(4) second subparagraph',
          url: NIS2_URL,
          quote:
            'a trust service provider shall, with regard to significant incidents that have an impact on the provision of ' +
            'its trust services, notify the CSIRT or, where applicable, the competent authority, without undue delay and ' +
            'in any event within 24 hours of becoming aware of the significant incident.',
        },
      },
      {
        key: 'nis2-final-report',
        action: 'Send the final report',
        recipient: 'National CSIRT or competent authority',
        trigger: 'nis2Notification',
        duration: { kind: 'months', amount: 1 },
        citation: {
          label: 'NIS2 Art. 23(4)(d)',
          url: NIS2_URL,
          quote:
            'a final report not later than one month after the submission of the incident notification under point (b)',
        },
        assumptions: [
          'Until the incident notification is recorded as submitted, the final report is counted from that notification\'s deadline.',
          'If the incident is still ongoing at that time, Art. 23(4)(e) replaces it with a progress report; not yet modelled.',
        ],
      },
    ],
  },
  {
    id: 'hipaa',
    name: 'HIPAA Breach Notification Rule',
    jurisdiction: 'United States (health)',
    lastVerified: VERIFIED,
    appliesWhen: (s) => s.hipaaCoveredEntity || s.hipaaBusinessAssociate,
    stages: [
      {
        key: 'hipaa-individuals',
        action: 'Notify the affected individuals',
        recipient: 'Individuals',
        trigger: 'awareness',
        duration: { kind: 'calendarDaysEndOfDay', amount: 60 },
        appliesWhen: (s) => s.hipaaCoveredEntity,
        citation: {
          label: '45 CFR 164.404(b)',
          url: HIPAA_URL,
          quote:
            'a covered entity shall provide the notification required by paragraph (a) of this section without ' +
            'unreasonable delay and in no case later than 60 calendar days after discovery of a breach.',
        },
        assumptions: ['Discovery is the first day the breach was known or, with reasonable diligence, would have been known (164.404(a)(2)); correct the awareness time if needed.'],
      },
      {
        key: 'hipaa-hhs-500',
        action: 'Notify HHS (500 or more people)',
        recipient: 'Secretary of HHS',
        trigger: 'awareness',
        duration: { kind: 'calendarDaysEndOfDay', amount: 60 },
        appliesWhen: (s) => s.hipaaCoveredEntity && s.approxSubjects >= 500,
        citation: {
          label: '45 CFR 164.408(b)',
          url: HIPAA_URL,
          quote:
            'For breaches of unsecured protected health information involving 500 or more individuals, a covered entity ' +
            'shall ... provide the notification required by paragraph (a) of this section contemporaneously with the ' +
            'notice required by § 164.404(a)',
        },
        assumptions: ['"Contemporaneously with" individual notice is shown with the individual-notice deadline.'],
      },
      {
        key: 'hipaa-hhs-under-500',
        action: 'Log the breach and report it to HHS',
        recipient: 'Secretary of HHS',
        trigger: 'yearEndOfAwareness',
        duration: { kind: 'calendarDaysEndOfDay', amount: 60 },
        appliesWhen: (s) => s.hipaaCoveredEntity && s.approxSubjects < 500,
        citation: {
          label: '45 CFR 164.408(c)',
          url: HIPAA_URL,
          quote:
            'For breaches of unsecured protected health information involving less than 500 individuals, a covered ' +
            'entity shall maintain a log or other documentation of such breaches and, not later than 60 days after the ' +
            'end of each calendar year, provide the notification required by paragraph (a) of this section',
        },
      },
      {
        key: 'hipaa-media',
        action: 'Notify prominent media outlets',
        recipient: 'Media serving the affected State',
        trigger: 'awareness',
        duration: { kind: 'calendarDaysEndOfDay', amount: 60 },
        appliesWhen: (s) => s.hipaaCoveredEntity && s.moreThan500InOneState,
        citation: {
          label: '45 CFR 164.406',
          url: HIPAA_URL,
          quote:
            'For a breach of unsecured protected health information involving more than 500 residents of a State or ' +
            'jurisdiction, a covered entity shall ... notify prominent media outlets serving the State or jurisdiction.',
        },
      },
      {
        key: 'hipaa-ba-to-ce',
        action: 'Notify the covered entity',
        recipient: 'Covered entity',
        trigger: 'awareness',
        duration: { kind: 'calendarDaysEndOfDay', amount: 60 },
        appliesWhen: (s) => s.hipaaBusinessAssociate,
        citation: {
          label: '45 CFR 164.410(b)',
          url: HIPAA_URL,
          quote:
            'a business associate shall provide the notification required by paragraph (a) of this section without ' +
            'unreasonable delay and in no case later than 60 calendar days after discovery of a breach.',
        },
      },
    ],
  },
  {
    id: 'sec',
    name: 'SEC Form 8-K Item 1.05',
    jurisdiction: 'United States (listed companies)',
    lastVerified: VERIFIED,
    appliesWhen: (s) => s.secRegistrant,
    stages: [
      {
        key: 'sec-8k-105',
        action: 'File Form 8-K Item 1.05',
        recipient: 'SEC (EDGAR)',
        trigger: 'materiality',
        duration: { kind: 'businessDaysCutoff', amount: 4, zone: 'America/New_York', cutoff: '17:30', calendar: 'us-federal' },
        citation: {
          label: 'Form 8-K Item 1.05; General Instruction B.1',
          url: SEC_URL,
          quote:
            'If the registrant experiences a cybersecurity incident that is determined by the registrant to be material, ' +
            'describe the material aspects of the nature, scope, and timing of the incident ... A registrant\'s ' +
            'materiality determination regarding a cybersecurity incident must be made without unreasonable delay after ' +
            'discovery of the incident.',
        },
        assumptions: [
          'The report is due four business days after the materiality determination (General Instruction B.1).',
          'Business days exclude weekends and US federal holidays; the deadline is shown at 17:30 New York time, the conservative EDGAR same-day cutoff. Confirm with counsel.',
          'An Attorney General national-security delay (Item 1.05(c)) is not applied automatically.',
        ],
      },
    ],
  },
  {
    id: 'sg-pdpa',
    name: 'Singapore PDPA',
    jurisdiction: 'Singapore',
    lastVerified: VERIFIED,
    appliesWhen: (s) => livesIn(s, ['SG']),
    stages: [
      {
        key: 'pdpa-assessment',
        action: 'Finish assessing whether the breach is notifiable',
        recipient: 'Internal (DPO)',
        trigger: 'awareness',
        duration: { kind: 'calendarDaysEndOfDay', amount: 30 },
        citation: {
          label: 'PDPC Guide on Managing and Notifying Data Breaches',
          url: PDPC_GUIDE_URL,
          quote:
            'the organisation is required to take reasonable and expeditious steps to assess whether the data breach is ' +
            'notifiable under the PDPA within 30 calendar days.',
        },
        assumptions: ['The 30-day assessment window comes from PDPC guidance; it is shown as a target the team should not exceed.'],
      },
      {
        key: 'pdpa-commission',
        action: 'Notify the PDPC',
        recipient: 'Personal Data Protection Commission (PDPC)',
        trigger: 'notifiableAssessment',
        duration: { kind: 'calendarDaysEndOfDay', amount: 3 },
        appliesWhen: (s) => s.riskLevel !== 'unlikely' || s.approxSubjects >= 500,
        citation: {
          label: 'PDPA s26D(1)',
          url: PDPA_URL,
          quote:
            'Where an organisation assesses, in accordance with section 26C, that a data breach is a notifiable data ' +
            'breach, the organisation must notify the Commission as soon as is practicable, but in any case no later ' +
            'than 3 calendar days after the day the organisation makes that assessment.',
        },
        assumptions: ['A breach is treated as possibly notifiable when risk is not "unlikely" or 500 or more people are affected (significant harm or significant scale).'],
      },
      {
        key: 'pdpa-individuals',
        action: 'Notify the affected individuals',
        recipient: 'Affected individuals',
        trigger: 'notifiableAssessment',
        duration: { kind: 'asap' },
        appliesWhen: (s) => s.riskLevel === 'high',
        citation: {
          label: 'PDPA s26D(2)',
          url: PDPC_GUIDE_URL,
          quote:
            'Section 26D(2) of the PDPA prescribes that organisations must notify affected individuals as soon as ' +
            'practicable, at the same time or after notifying the Commission.',
        },
      },
    ],
  },
];
