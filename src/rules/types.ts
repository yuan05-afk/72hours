// Types for the 72 Hours rulebook: regimes, their notification stages, and the clocks computed from them.
// Deadlines are produced by code, never by AI. Every stage carries the citation it is derived from.

/** ISO 3166-1 alpha-2 country code, e.g. "PH", "DE", "GB", "SG", "US". */
export type CountryCode = string;

/** How bad the breach is for the people affected, as assessed by the team (GDPR Art. 33/34 vocabulary). */
export type RiskLevel = 'unlikely' | 'risk' | 'high';

/** Answers from the scoping check. Everything a rule needs to decide whether it applies. */
export interface IncidentScope {
  /** Countries where the affected people live. */
  subjectCountries: CountryCode[];
  /** Approximate number of people affected. */
  approxSubjects: number;
  riskLevel: RiskLevel;
  /** Sensitive personal information (health, financial, government IDs, ...) is involved. */
  sensitiveData: boolean;
  /** The data could be used to enable identity fraud (PH NPC Circular 16-03). */
  identityFraudRisk: boolean;
  /** US protected health information is involved and the organisation is a HIPAA covered entity. */
  hipaaCoveredEntity: boolean;
  /** The organisation is a HIPAA business associate (it notifies the covered entity, not HHS). */
  hipaaBusinessAssociate: boolean;
  /** More than 500 residents of a single US State or jurisdiction are affected (HIPAA media notice). */
  moreThan500InOneState: boolean;
  /** The organisation is an essential or important entity under NIS2 and the incident is significant. */
  nis2SignificantIncident: boolean;
  /** The organisation is a qualified or non-qualified trust service provider (NIS2 Art. 23(4) derogation). */
  nis2TrustServiceProvider: boolean;
  /** The organisation is an SEC registrant (files Form 8-K). */
  secRegistrant: boolean;
}

/** Timestamps that start or move clocks. All are ISO 8601 strings with an offset or Z. */
export interface IncidentEvents {
  /** When the organisation became aware (GDPR), had knowledge or reasonable belief (NPC), or discovered (HIPAA). */
  awareAt: string;
  /** IANA time zone of the organisation, used for calendar-day and end-of-day rules. */
  timeZone: string;
  /** SEC: when the registrant determined the incident was material. */
  materialityDeterminedAt?: string;
  /** Singapore PDPA: when the organisation assessed the breach as notifiable. */
  notifiableAssessmentAt?: string;
  /** NIS2: when the incident notification (72h stage) was actually submitted. */
  nis2NotificationSubmittedAt?: string;
}

export type Trigger = 'awareness' | 'materiality' | 'notifiableAssessment' | 'nis2Notification' | 'yearEndOfAwareness';

/**
 * How a stage's deadline is counted.
 * - hours: exact elapsed hours from the trigger instant (time zone independent).
 * - calendarDaysEndOfDay: the end of the Nth calendar day after the trigger's local date.
 * - businessDaysCutoff: the Nth business day after the trigger's local date, at a cutoff time in a given zone.
 * - months: calendar months after the trigger instant (same day-of-month, clamped to month end).
 * - asap: "without undue delay" with no fixed outer limit; shown as a target, not a deadline.
 */
export type Duration =
  | { kind: 'hours'; amount: number }
  | { kind: 'calendarDaysEndOfDay'; amount: number }
  | { kind: 'businessDaysCutoff'; amount: number; zone: string; cutoff: string; calendar: 'us-federal' }
  | { kind: 'months'; amount: number }
  | { kind: 'asap' };

export interface Citation {
  /** Short label shown on chips, e.g. "GDPR Art. 33(1)". */
  label: string;
  url: string;
  /** Verbatim text the stage is derived from. */
  quote: string;
}

export interface Stage {
  key: string;
  /** Plain-language action, e.g. "Notify the lead supervisory authority". */
  action: string;
  /** Who receives the notice. */
  recipient: string;
  trigger: Trigger;
  duration: Duration;
  citation: Citation;
  /** Returns true when this stage applies to the scoped incident. Defaults to always. */
  appliesWhen?: (scope: IncidentScope) => boolean;
  /** Interpretation choices the engine made for this stage; surfaced in the Assumptions ledger. */
  assumptions?: string[];
}

export interface Regime {
  id: string;
  name: string;
  jurisdiction: string;
  /** Date (YYYY-MM-DD) the citations were last checked against the primary source. */
  lastVerified: string;
  appliesWhen: (scope: IncidentScope) => boolean;
  stages: Stage[];
}

export type ClockStatus = 'running' | 'waitingForTrigger' | 'asap';

export interface Clock {
  regimeId: string;
  regimeName: string;
  stageKey: string;
  action: string;
  recipient: string;
  status: ClockStatus;
  /** UTC ISO deadline; null when the trigger has not happened yet or the stage has no fixed limit. */
  dueAt: string | null;
  /** Plain-language basis, e.g. "72 hours after awareness". */
  basis: string;
  citation: Citation;
  lastVerified: string;
  assumptions: string[];
}
