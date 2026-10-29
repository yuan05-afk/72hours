// Incident service: the only place that changes incident state. Every change is validated by the rules engine and
// written to the append-only audit trail with who, when and why.
//
// Lifecycle: detected (flagged, awareness time recorded, not scoped) -> running (scoped, clocks counting) -> closed.
import { computeClocks, validateEvents } from '../rules';
import type { Clock, IncidentEvents, IncidentScope } from '../rules';
import type { AuditEntry, IncidentRecord, IncidentStore } from '../store/types';

export class IncidentError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'ALREADY_RUNNING' | 'INVALID_INPUT' | 'CLOSED' | 'NOT_SCOPED' | 'CONFLICT' | 'NEEDS_SETUP',
    message: string,
  ) {
    super(message);
  }
}

export type TriggerEvent = 'materiality' | 'notifiableAssessment' | 'nis2NotificationSubmitted';

const EVENT_FIELD = {
  materiality: 'materialityDeterminedAt',
  notifiableAssessment: 'notifiableAssessmentAt',
  nis2NotificationSubmitted: 'nis2NotificationSubmittedAt',
} as const;

const MIN_REASON = 5;

export const eventsOf = (i: IncidentRecord): IncidentEvents => ({
  awareAt: i.awareAt,
  timeZone: i.timeZone,
  materialityDeterminedAt: i.materialityDeterminedAt ?? undefined,
  notifiableAssessmentAt: i.notifiableAssessmentAt ?? undefined,
  nis2NotificationSubmittedAt: i.nis2NotificationSubmittedAt ?? undefined,
});

/** Runs the rules engine to validate inputs; turns engine errors into INVALID_INPUT. No scope yet means no clocks. */
function validated(scope: IncidentScope | null, events: IncidentEvents): Clock[] {
  try {
    if (!scope) {
      validateEvents(events);
      return [];
    }
    return computeClocks(scope, events);
  } catch (error) {
    throw new IncidentError('INVALID_INPUT', (error as Error).message);
  }
}

const SCOPE_FLAGS = [
  'sensitiveData',
  'identityFraudRisk',
  'hipaaCoveredEntity',
  'hipaaBusinessAssociate',
  'moreThan500InOneState',
  'nis2SignificantIncident',
  'nis2TrustServiceProvider',
  'secRegistrant',
] as const;
const RISK_LEVELS = ['unlikely', 'risk', 'high'];

/** Scope arrives from the browser; check its shape before the rules engine trusts it. */
export function validateScope(value: unknown): IncidentScope {
  const s = (value ?? {}) as Record<string, unknown>;
  const countries = s.subjectCountries;
  if (!Array.isArray(countries) || !countries.length || countries.length > 250 || !countries.every((c) => typeof c === 'string' && /^[A-Za-z]{2}$/.test(c))) {
    throw new IncidentError('INVALID_INPUT', 'Choose at least one country where affected people live.');
  }
  const approx = s.approxSubjects;
  if (typeof approx !== 'number' || !Number.isInteger(approx) || approx < 1 || approx > 10_000_000_000) {
    throw new IncidentError('INVALID_INPUT', 'Give a rough number of people affected (a whole number, at least 1).');
  }
  if (typeof s.riskLevel !== 'string' || !RISK_LEVELS.includes(s.riskLevel)) {
    throw new IncidentError('INVALID_INPUT', 'Choose how serious the risk to people is.');
  }
  const scope = {
    subjectCountries: [...new Set(countries.map((c: string) => c.toUpperCase()))],
    approxSubjects: approx,
    riskLevel: s.riskLevel,
  } as Partial<IncidentScope>;
  for (const flag of SCOPE_FLAGS) {
    if (typeof s[flag] !== 'boolean') throw new IncidentError('INVALID_INPUT', `Missing answer: ${flag}.`);
    scope[flag] = s[flag] as boolean;
  }
  return scope as IncidentScope;
}

function requireReason(reason: string | undefined) {
  if (!reason || reason.trim().length < MIN_REASON) {
    throw new IncidentError('INVALID_INPUT', `A reason of at least ${MIN_REASON} characters is required.`);
  }
  return reason.trim();
}

export interface IncidentView {
  incident: IncidentRecord;
  clocks: Clock[];
}

export class IncidentService {
  constructor(private store: IncidentStore, private now: () => Date = () => new Date()) {}

  private async audit(issueKey: string, actor: string, action: string, detail: AuditEntry['detail']) {
    await this.store.appendAudit({ issueKey, actor, action, detail, at: this.now().toISOString() });
  }

  private async load(issueKey: string): Promise<IncidentRecord> {
    const incident = await this.store.getIncident(issueKey);
    if (!incident) throw new IncidentError('NOT_FOUND', `No breach clock is running for ${issueKey}.`);
    return incident;
  }

  /** Loads an incident that may still change; closed incidents are read-only. */
  private async loadOpen(issueKey: string): Promise<IncidentRecord> {
    const incident = await this.load(issueKey);
    if (incident.status === 'closed') throw new IncidentError('CLOSED', `${issueKey} is closed.`);
    return incident;
  }

  /** Loads an incident whose clocks are running; a detected incident must be scoped first. */
  private async loadScoped(issueKey: string): Promise<IncidentRecord & { scope: IncidentScope }> {
    const incident = await this.loadOpen(issueKey);
    if (!incident.scope) {
      throw new IncidentError('NOT_SCOPED', `Answer the scoping questions for ${issueKey} first; that starts its clocks.`);
    }
    return incident as IncidentRecord & { scope: IncidentScope };
  }

  /** The clocks a scope would start, without storing anything (the scoping check's live preview). */
  preview(input: { scope: unknown; awareAt: string; timeZone: string }): Clock[] {
    return validated(validateScope(input.scope), { awareAt: input.awareAt, timeZone: input.timeZone });
  }

  async get(issueKey: string): Promise<IncidentView | null> {
    const incident = await this.store.getIncident(issueKey);
    return incident ? { incident, clocks: validated(incident.scope, eventsOf(incident)) } : null;
  }

  /**
   * Records that an issue was flagged as involving personal data. The flag time is the provisional awareness time;
   * people correct it (with a reason) if they knew earlier. Does nothing if the issue already has an incident.
   */
  async detect(input: {
    issueKey: string;
    detectedAt: string;
    timeZone: string;
    actor: string;
    detail: AuditEntry['detail'];
  }): Promise<{ created: boolean; view: IncidentView }> {
    const existing = await this.get(input.issueKey);
    if (existing) return { created: false, view: existing };
    const incident: IncidentRecord = {
      issueKey: input.issueKey,
      scope: null,
      awareAt: input.detectedAt,
      timeZone: input.timeZone,
      materialityDeterminedAt: null,
      notifiableAssessmentAt: null,
      nis2NotificationSubmittedAt: null,
      status: 'detected',
      mode: 'real',
      closedAt: null,
      createdBy: input.actor,
      createdAt: this.now().toISOString(),
    };
    validated(null, eventsOf(incident));
    await this.store.insertIncident(incident);
    await this.audit(input.issueKey, input.actor, 'incident.detected', {
      awareAt: input.detectedAt,
      timeZone: input.timeZone,
      ...input.detail,
    });
    return { created: true, view: { incident, clocks: [] } };
  }

  /** Starts the clocks: either fresh, or by scoping an incident that detection already recorded. */
  async start(input: {
    issueKey: string;
    scope: unknown;
    awareAt: string;
    timeZone: string;
    actor: string;
    mode?: IncidentRecord['mode'];
  }): Promise<IncidentView> {
    const scope = validateScope(input.scope);
    const existing = await this.store.getIncident(input.issueKey);
    if (existing && existing.status !== 'detected') {
      throw new IncidentError('ALREADY_RUNNING', `A breach clock is already running for ${input.issueKey}.`);
    }
    const incident: IncidentRecord = {
      issueKey: input.issueKey,
      scope,
      awareAt: input.awareAt,
      timeZone: input.timeZone,
      materialityDeterminedAt: null,
      notifiableAssessmentAt: null,
      nis2NotificationSubmittedAt: null,
      status: 'running',
      mode: input.mode ?? existing?.mode ?? 'real',
      closedAt: null,
      createdBy: existing?.createdBy ?? input.actor,
      createdAt: existing?.createdAt ?? this.now().toISOString(),
    };
    const clocks = validated(incident.scope, eventsOf(incident));
    if (existing) {
      await this.store.updateIncident(input.issueKey, {
        scope,
        awareAt: input.awareAt,
        timeZone: input.timeZone,
        status: 'running',
      });
    } else {
      await this.store.insertIncident(incident);
    }
    await this.audit(input.issueKey, input.actor, incident.mode === 'drill' ? 'drill.started' : 'clock.started', {
      awareAt: input.awareAt,
      timeZone: input.timeZone,
      scope,
      regimes: [...new Set(clocks.map((c) => c.regimeId))],
      ...(existing ? { detectedAwareAt: existing.awareAt } : {}),
    });
    return { incident, clocks };
  }

  async correctAwareness(input: { issueKey: string; awareAt: string; reason: string; actor: string }): Promise<IncidentView> {
    const reason = requireReason(input.reason);
    const incident = await this.loadOpen(input.issueKey);
    const updated = { ...incident, awareAt: input.awareAt };
    const clocks = validated(updated.scope, eventsOf(updated));
    await this.store.updateIncident(input.issueKey, { awareAt: input.awareAt });
    await this.audit(input.issueKey, input.actor, 'awareness.corrected', { from: incident.awareAt, to: input.awareAt, reason });
    return { incident: updated, clocks };
  }

  async updateScope(input: { issueKey: string; scope: unknown; reason: string; actor: string }): Promise<IncidentView> {
    const reason = requireReason(input.reason);
    const scope = validateScope(input.scope);
    const incident = await this.loadScoped(input.issueKey);
    const updated = { ...incident, scope };
    const clocks = validated(updated.scope, eventsOf(updated));
    await this.store.updateIncident(input.issueKey, { scope });
    await this.audit(input.issueKey, input.actor, 'scope.updated', { from: incident.scope, to: scope, reason });
    return { incident: updated, clocks };
  }

  async recordEvent(input: { issueKey: string; event: TriggerEvent; at: string; actor: string }): Promise<IncidentView> {
    const field = EVENT_FIELD[input.event];
    if (!field) throw new IncidentError('INVALID_INPUT', `Unknown event ${input.event}.`);
    const incident = await this.loadScoped(input.issueKey);
    const updated = { ...incident, [field]: input.at };
    const clocks = validated(updated.scope, eventsOf(updated));
    await this.store.updateIncident(input.issueKey, { [field]: input.at });
    await this.audit(input.issueKey, input.actor, `event.${input.event}`, { from: incident[field], to: input.at });
    return { incident: updated, clocks };
  }

  /** Closes the incident: clocks stop being reminded, everything becomes read-only. The reason is audited. */
  async close(input: { issueKey: string; reason: string; actor: string }): Promise<IncidentView> {
    const reason = requireReason(input.reason);
    const incident = await this.loadOpen(input.issueKey);
    const closedAt = this.now().toISOString();
    await this.store.updateIncident(input.issueKey, { status: 'closed', closedAt });
    await this.audit(input.issueKey, input.actor, incident.mode === 'drill' ? 'drill.ended' : 'incident.closed', { reason });
    const updated = { ...incident, status: 'closed' as const, closedAt };
    return { incident: updated, clocks: validated(updated.scope, eventsOf(updated)) };
  }

  async auditTrail(issueKey: string) {
    return this.store.listAudit(issueKey);
  }
}
