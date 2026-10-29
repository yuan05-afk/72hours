// What each notice must contain. One shared field vocabulary, so a fact gathered once fills every notice that needs
// it. Requirements are keyed by rulebook stage and quote the primary source verbatim (checked on VERIFIED).
import type { Citation } from '../rules';

const VERIFIED = '2026-10-29';

export const FIELDS = {
  nature: { label: 'Nature of the breach', prompt: 'What happened, in a few sentences?' },
  howItHappened: { label: 'How it happened', prompt: 'How did the breach occur, and which weakness allowed it?' },
  chronology: { label: 'Timeline', prompt: 'When did the breach start, when was it discovered, and what happened in between?' },
  peopleCategories: { label: 'Categories of people', prompt: 'Whose data is it: patients, customers, staff?' },
  peopleCount: { label: 'Approximate number of people', prompt: 'About how many people are affected, and where do they live?' },
  recordCategories: { label: 'Categories of records', prompt: 'Which kinds of data were involved?' },
  recordCount: { label: 'Approximate number of records', prompt: 'About how many records were involved?' },
  sensitiveData: { label: 'Sensitive personal information', prompt: 'Which sensitive data (health, financial, government IDs) was involved?' },
  identityFraudData: { label: 'Data that could enable identity fraud', prompt: 'Which data could be used for identity fraud?' },
  dpoContact: { label: 'DPO contact', prompt: 'Name and contact details of the DPO or contact point.' },
  consequences: { label: 'Likely consequences', prompt: 'What could happen to the people affected?' },
  measures: { label: 'Measures taken', prompt: 'What has been done, or is planned, to address the breach and limit harm?' },
  recovery: { label: 'Securing the data', prompt: 'What is being done to secure or recover the compromised data?' },
  subjectsInformed: { label: 'Informing the people affected', prompt: 'How are affected people being told, or why is that delayed?' },
  preventRecurrence: { label: 'Preventing a recurrence', prompt: 'What will stop this from happening again?' },
  delayReasons: { label: 'Reasons for a delay', prompt: 'Why is the notice later than its deadline?' },
  maliciousCause: { label: 'Suspected malicious cause', prompt: 'Is the incident suspected of being caused by unlawful or malicious acts?' },
  crossBorder: { label: 'Cross-border impact', prompt: 'Could the incident have an impact in other countries?' },
  severityImpact: { label: 'Severity and impact', prompt: 'Initial assessment of how severe the incident is and what it affects.' },
  indicators: { label: 'Indicators of compromise', prompt: 'Known indicators of compromise (IPs, hashes, accounts), if any.' },
  rootCause: { label: 'Threat or root cause', prompt: 'Which threat or root cause most likely triggered the incident?' },
  protectiveSteps: { label: 'Steps people should take', prompt: 'What should affected people do to protect themselves?' },
  contactProcedures: { label: 'How people can reach us', prompt: 'Toll-free number, email, website or postal address for questions.' },
  harmReduction: { label: 'Reducing harm to people', prompt: 'What is being done to reduce the harm or negative consequences for the people affected?' },
  assistance: { label: 'Help offered to people', prompt: 'What assistance will be given to the people affected (helpline, credit monitoring, replacement IDs)?' },
  affectedIndividuals: { label: 'Who exactly is affected', prompt: 'Identification of each individual whose information was involved (a list kept outside the notice).' },
  materialImpact: { label: 'Material impact on the company', prompt: 'The material or reasonably likely material impact, including on financial condition and results of operations.' },
} as const;

export type FieldKey = keyof typeof FIELDS;

/**
 * required: the source asks for it (including "where possible" and "where applicable"; the DPO can answer "not known"
 * or "not applicable"). ifAvailable: asked for only when known. ifLate: only when the notice misses its deadline.
 */
export type Need = 'required' | 'ifAvailable' | 'ifLate';

export interface NoticeRequirement {
  stageKey: string;
  fields: Partial<Record<FieldKey, Need>>;
  citation: Citation;
  lastVerified: string;
}

const GDPR_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679';
const UK_GDPR_URL = 'https://www.legislation.gov.uk/eur/2016/679/article/33';
const NPC_URL = 'https://privacy.gov.ph/wp-content/uploads/2022/01/sgd-npc-circular-16-03-personal-data-breach-management.pdf';
const NIS2_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022L2555';
const HIPAA_404_URL = 'https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D/section-164.404';

const GDPR_33_3_QUOTE =
  'The notification referred to in paragraph 1 shall at least: (a) describe the nature of the personal data breach ' +
  'including where possible, the categories and approximate number of data subjects concerned and the categories and ' +
  'approximate number of personal data records concerned; (b) communicate the name and contact details of the data ' +
  'protection officer or other contact point where more information can be obtained; (c) describe the likely ' +
  'consequences of the personal data breach; (d) describe the measures taken or proposed to be taken by the controller ' +
  'to address the personal data breach, including, where appropriate, measures to mitigate its possible adverse ' +
  'effects. [Art. 33(1):] Where the notification to the supervisory authority is not made within 72 hours, it shall be ' +
  'accompanied by reasons for the delay.';

const GDPR_33_FIELDS: NoticeRequirement['fields'] = {
  nature: 'required',
  peopleCategories: 'required',
  peopleCount: 'required',
  recordCategories: 'required',
  recordCount: 'required',
  dpoContact: 'required',
  consequences: 'required',
  measures: 'required',
  delayReasons: 'ifLate',
};

const NPC_CONTENT_QUOTE =
  'D. Content of Notification. The notification shall include, but not be limited to: 1. Nature of the Breach a. ' +
  'description of how the breach occurred and the vulnerability of the data processing system that allowed the breach; ' +
  'b. a chronology of the events leading up to the loss of control over the personal data; c. approximate number of ' +
  'data subjects or records involved; d. description or nature of the personal data breach; e. description of the ' +
  'likely consequences of the personal data breach; and f. name and contact details of the data protection officer or ' +
  'any other accountable persons. 2. Personal Data Possibly Involved a. description of sensitive personal information ' +
  'involved; and b. description of other information involved that may be used to enable identity fraud. 3. Measures ' +
  'Taken to Address the Breach a. description of the measures taken or proposed to be taken to address the breach; b. ' +
  'actions being taken to secure or recover the personal data that were compromised; c. actions performed or proposed ' +
  'to mitigate possible harm or negative consequences, and limit the damage or distress to those affected by the ' +
  'incident; d. action being taken to inform the data subjects affected by the incident, or reasons for any delay in ' +
  'the notification; e. the measures being taken to prevent a recurrence of the incident.';

const NPC_FIELDS: NoticeRequirement['fields'] = {
  howItHappened: 'required',
  chronology: 'required',
  peopleCount: 'required',
  recordCount: 'required',
  nature: 'required',
  consequences: 'required',
  dpoContact: 'required',
  sensitiveData: 'required',
  identityFraudData: 'required',
  measures: 'required',
  recovery: 'required',
  subjectsInformed: 'required',
  preventRecurrence: 'required',
};

const NIS2_A_QUOTE =
  '(a) without undue delay and in any event within 24 hours of becoming aware of the significant incident, an early ' +
  'warning, which, where applicable, shall indicate whether the significant incident is suspected of being caused by ' +
  'unlawful or malicious acts or could have a cross-border impact;';

const NIS2_B_QUOTE =
  '(b) without undue delay and in any event within 72 hours of becoming aware of the significant incident, an incident ' +
  'notification, which, where applicable, shall update the information referred to in point (a) and indicate an ' +
  'initial assessment of the significant incident, including its severity and impact, as well as, where available, ' +
  'the indicators of compromise;';

const NIS2_D_QUOTE =
  '(d) a final report not later than one month after the submission of the incident notification under point (b), ' +
  'including the following: (i) a detailed description of the incident, including its severity and impact; (ii) the ' +
  'type of threat or root cause that is likely to have triggered the incident; (iii) applied and ongoing mitigation ' +
  'measures; (iv) where applicable, the cross-border impact of the incident;';

const NIS2_B_FIELDS: NoticeRequirement['fields'] = {
  maliciousCause: 'required',
  crossBorder: 'required',
  severityImpact: 'required',
  indicators: 'ifAvailable',
};

const HIPAA_404_C_QUOTE =
  'The notification required by paragraph (a) of this section shall include, to the extent possible: (A) A brief ' +
  'description of what happened, including the date of the breach and the date of the discovery of the breach, if ' +
  'known; (B) A description of the types of unsecured protected health information that were involved in the breach ' +
  '(such as whether full name, social security number, date of birth, home address, account number, diagnosis, ' +
  'disability code, or other types of information were involved); (C) Any steps individuals should take to protect ' +
  'themselves from potential harm resulting from the breach; (D) A brief description of what the covered entity ' +
  'involved is doing to investigate the breach, to mitigate harm to individuals, and to protect against any further ' +
  'breaches; and (E) Contact procedures for individuals to ask questions or learn additional information, which shall ' +
  'include a toll-free telephone number, an e-mail address, Web site, or postal address.';

const GDPR_34_2_QUOTE =
  'The communication to the data subject referred to in paragraph 1 of this Article shall describe in clear and plain ' +
  'language the nature of the personal data breach and contain at least the information and measures referred to in ' +
  'points (b), (c) and (d) of Article 33(3).';

const GDPR_34_FIELDS: NoticeRequirement['fields'] = {
  nature: 'required',
  dpoContact: 'required',
  consequences: 'required',
  measures: 'required',
};

const NPC_SUBJECTS_QUOTE =
  'Content of Notification. The notification shall include, but not be limited to: nature of the breach; personal data ' +
  'possibly involved; measures taken to address the breach; measures taken to reduce the harm or negative consequences ' +
  'of the breach; representative of the personal information controller, including his or her contact details, from ' +
  'whom the data subject can obtain additional information regarding the breach; and any assistance to be provided to ' +
  'the affected data subjects.';

const HIPAA_406_C_QUOTE =
  '(c) Implementation specifications: Content of notification. The notification required by paragraph (a) of this ' +
  'section shall meet the requirements of § 164.404(c).';

const HIPAA_410_C_QUOTE =
  '(1) The notification required by paragraph (a) of this section shall include, to the extent possible, the ' +
  'identification of each individual whose unsecured protected health information has been, or is reasonably believed ' +
  'by the business associate to have been, accessed, acquired, used, or disclosed during the breach. (2) A business ' +
  'associate shall provide the covered entity with any other available information that the covered entity is ' +
  'required to include in notification to the individual under § 164.404(c) at the time of the notification required ' +
  'by paragraph (a) of this section or promptly thereafter as information becomes available.';

const SEC_105_QUOTE =
  '(a) If the registrant experiences a cybersecurity incident that is determined by the registrant to be material, ' +
  'describe the material aspects of the nature, scope, and timing of the incident, and the material impact or ' +
  'reasonably likely material impact on the registrant, including its financial condition and results of operations.';

const HIPAA_INDIVIDUAL_FIELDS: NoticeRequirement['fields'] = {
  nature: 'required',
  chronology: 'required',
  recordCategories: 'required',
  protectiveSteps: 'required',
  measures: 'required',
  preventRecurrence: 'required',
  contactProcedures: 'required',
};

const HIPAA_406_URL = 'https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D/section-164.406';
const HIPAA_410_URL = 'https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D/section-164.410';
const SEC_URL = 'https://www.sec.gov/files/form8-k.pdf';

const requirement = (stageKey: string, fields: NoticeRequirement['fields'], citation: Citation): NoticeRequirement => ({
  stageKey,
  fields,
  citation,
  lastVerified: VERIFIED,
});

export const NOTICE_REQUIREMENTS: NoticeRequirement[] = [
  requirement('gdpr-33-authority', GDPR_33_FIELDS, { label: 'GDPR Art. 33(3)', url: GDPR_URL, quote: GDPR_33_3_QUOTE }),
  requirement('uk-33-commission', GDPR_33_FIELDS, { label: 'UK GDPR Art. 33(3)', url: UK_GDPR_URL, quote: GDPR_33_3_QUOTE }),
  requirement('npc-commission', NPC_FIELDS, { label: 'NPC Circular 16-03, Content of Notification', url: NPC_URL, quote: NPC_CONTENT_QUOTE }),
  requirement('npc-full-report', NPC_FIELDS, { label: 'NPC Circular 16-03, Content of Notification', url: NPC_URL, quote: NPC_CONTENT_QUOTE }),
  requirement(
    'nis2-early-warning',
    { maliciousCause: 'required', crossBorder: 'required' },
    { label: 'NIS2 Art. 23(4)(a)', url: NIS2_URL, quote: NIS2_A_QUOTE },
  ),
  requirement('nis2-incident-notification', NIS2_B_FIELDS, { label: 'NIS2 Art. 23(4)(b)', url: NIS2_URL, quote: NIS2_B_QUOTE }),
  requirement('nis2-incident-notification-tsp', NIS2_B_FIELDS, { label: 'NIS2 Art. 23(4)(b)', url: NIS2_URL, quote: NIS2_B_QUOTE }),
  requirement(
    'nis2-final-report',
    { nature: 'required', severityImpact: 'required', rootCause: 'required', measures: 'required', crossBorder: 'required' },
    { label: 'NIS2 Art. 23(4)(d)', url: NIS2_URL, quote: NIS2_D_QUOTE },
  ),
  requirement('hipaa-individuals', HIPAA_INDIVIDUAL_FIELDS, { label: '45 CFR 164.404(c)(1)', url: HIPAA_404_URL, quote: HIPAA_404_C_QUOTE }),
  requirement('hipaa-media', HIPAA_INDIVIDUAL_FIELDS, { label: '45 CFR 164.406(c)', url: HIPAA_406_URL, quote: HIPAA_406_C_QUOTE }),
  requirement(
    'hipaa-ba-to-ce',
    {
      affectedIndividuals: 'required',
      nature: 'ifAvailable',
      chronology: 'ifAvailable',
      recordCategories: 'ifAvailable',
      protectiveSteps: 'ifAvailable',
      measures: 'ifAvailable',
    },
    { label: '45 CFR 164.410(c)', url: HIPAA_410_URL, quote: HIPAA_410_C_QUOTE },
  ),
  requirement('gdpr-34-subjects', GDPR_34_FIELDS, { label: 'GDPR Art. 34(2)', url: GDPR_URL, quote: GDPR_34_2_QUOTE }),
  requirement('uk-34-subjects', GDPR_34_FIELDS, {
    label: 'UK GDPR Art. 34(2)',
    url: UK_GDPR_URL.replace('/33', '/34'),
    quote: GDPR_34_2_QUOTE,
  }),
  requirement(
    'npc-subjects',
    {
      nature: 'required',
      recordCategories: 'required',
      measures: 'required',
      harmReduction: 'required',
      dpoContact: 'required',
      assistance: 'required',
    },
    { label: 'NPC Circular 16-03, notification of data subjects: Content of Notification', url: NPC_URL, quote: NPC_SUBJECTS_QUOTE },
  ),
  requirement(
    'sec-8k-105',
    { nature: 'required', severityImpact: 'required', chronology: 'required', materialImpact: 'required' },
    { label: 'Form 8-K Item 1.05(a)', url: SEC_URL, quote: SEC_105_QUOTE },
  ),
];

const BY_STAGE = new Map(NOTICE_REQUIREMENTS.map((r) => [r.stageKey, r]));

export const requirementFor = (stageKey: string) => BY_STAGE.get(stageKey);

export const isFieldKey = (key: string): key is FieldKey => Object.prototype.hasOwnProperty.call(FIELDS, key);
