// Deterministic deadline engine. Pure functions: same scope + events in, same clocks out. No AI, no I/O.
import { DateTime } from 'luxon';
import { isUsBusinessDay } from './holidays';
import { REGIMES } from './regimes';
import type { Clock, Duration, IncidentEvents, IncidentScope, Regime, Stage, Trigger } from './types';

const TRIGGER_WORDS: Record<Trigger, string> = {
  awareness: 'awareness',
  materiality: 'the materiality determination',
  notifiableAssessment: 'the notifiable-breach assessment',
  nis2Notification: 'the incident notification',
  yearEndOfAwareness: 'the end of the calendar year of discovery',
};

function parseInstant(value: string, field: string): DateTime {
  const dt = DateTime.fromISO(value, { setZone: true });
  if (!dt.isValid) throw new Error(`${field} is not a valid ISO 8601 timestamp: ${value}`);
  return dt;
}

function describe(duration: Duration, trigger: Trigger): string {
  const from = TRIGGER_WORDS[trigger];
  switch (duration.kind) {
    case 'hours':
      return `${duration.amount} hours after ${from}`;
    case 'calendarDaysEndOfDay':
      return `${duration.amount} calendar days after ${from}`;
    case 'businessDaysCutoff':
      return `${duration.amount} business days after ${from} (${duration.cutoff} ${duration.zone})`;
    case 'months':
      return `${duration.amount} month${duration.amount === 1 ? '' : 's'} after ${from}`;
    case 'asap':
      return `Without undue delay after ${from}`;
  }
}

/** Applies a duration to the trigger instant. Calendar rules use the organisation's local dates. */
export function applyDuration(start: DateTime, duration: Duration, timeZone: string): DateTime | null {
  switch (duration.kind) {
    case 'hours':
      return start.toUTC().plus({ hours: duration.amount });
    case 'calendarDaysEndOfDay':
      return start.setZone(timeZone).startOf('day').plus({ days: duration.amount }).endOf('day').toUTC();
    case 'businessDaysCutoff': {
      let day = start.setZone(duration.zone).startOf('day');
      let counted = 0;
      while (counted < duration.amount) {
        day = day.plus({ days: 1 });
        if (isUsBusinessDay(day)) counted += 1;
      }
      const [hour, minute] = duration.cutoff.split(':').map(Number);
      return day.set({ hour, minute, second: 0, millisecond: 0 }).toUTC();
    }
    case 'months':
      return start.toUTC().plus({ months: duration.amount });
    case 'asap':
      return null;
  }
}

/** Checks the time zone and every timestamp; throws on the first invalid one. Returns the awareness instant. */
export function validateEvents(events: IncidentEvents): DateTime {
  if (!DateTime.local().setZone(events.timeZone).isValid) {
    throw new Error(`timeZone is not a valid IANA zone: ${events.timeZone}`);
  }
  const awareAt = parseInstant(events.awareAt, 'awareAt');
  for (const field of ['materialityDeterminedAt', 'notifiableAssessmentAt', 'nis2NotificationSubmittedAt'] as const) {
    const value = events[field];
    if (value) parseInstant(value, field);
  }
  return awareAt;
}

/** Regimes and stages that apply to this incident, before any dates are computed. */
export function applicableStages(scope: IncidentScope, regimes: Regime[] = REGIMES) {
  return regimes
    .filter((regime) => regime.appliesWhen(scope))
    .map((regime) => ({ regime, stages: regime.stages.filter((s) => !s.appliesWhen || s.appliesWhen(scope)) }))
    .filter((r) => r.stages.length > 0);
}

/**
 * Computes every notification clock for an incident.
 * Clocks are sorted by deadline; stages without a fixed deadline or still waiting for their trigger come last.
 */
export function computeClocks(scope: IncidentScope, events: IncidentEvents, regimes: Regime[] = REGIMES): Clock[] {
  const awareAt = validateEvents(events);
  const optional = (value: string | undefined, field: string) => (value ? parseInstant(value, field) : null);
  const materiality = optional(events.materialityDeterminedAt, 'materialityDeterminedAt');
  const assessment = optional(events.notifiableAssessmentAt, 'notifiableAssessmentAt');
  const nis2Submitted = optional(events.nis2NotificationSubmittedAt, 'nis2NotificationSubmittedAt');

  const clocks: Clock[] = [];
  for (const { regime, stages } of applicableStages(scope, regimes)) {
    const dueByKey = new Map<string, DateTime | null>();
    for (const stage of stages) {
      const extraAssumptions: string[] = [];
      let start: DateTime | null;
      switch (stage.trigger) {
        case 'awareness':
          start = awareAt;
          break;
        case 'materiality':
          start = materiality;
          break;
        case 'notifiableAssessment':
          start = assessment;
          break;
        case 'yearEndOfAwareness':
          start = awareAt.setZone(events.timeZone).endOf('year').startOf('day');
          break;
        case 'nis2Notification': {
          const notificationDue = dueByKey.get('nis2-incident-notification') ?? dueByKey.get('nis2-incident-notification-tsp');
          start = nis2Submitted ?? notificationDue ?? null;
          if (!nis2Submitted && start) extraAssumptions.push('Counted from the incident notification deadline because no submission time is recorded yet.');
          break;
        }
      }

      const due = start ? applyDuration(start, stage.duration, events.timeZone) : null;
      dueByKey.set(stage.key, due);
      clocks.push(toClock(regime, stage, start, due, extraAssumptions));
    }
  }

  return clocks.sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return 0;
  });
}

function toClock(regime: Regime, stage: Stage, start: DateTime | null, due: DateTime | null, extra: string[]): Clock {
  const status = stage.duration.kind === 'asap' ? 'asap' : start ? 'running' : 'waitingForTrigger';
  return {
    regimeId: regime.id,
    regimeName: regime.name,
    stageKey: stage.key,
    action: stage.action,
    recipient: stage.recipient,
    status,
    dueAt: due ? (due.toUTC().toISO({ suppressMilliseconds: false }) as string) : null,
    basis: describe(stage.duration, stage.trigger),
    citation: stage.citation,
    lastVerified: regime.lastVerified,
    assumptions: [...(stage.assumptions ?? []), ...extra],
  };
}
