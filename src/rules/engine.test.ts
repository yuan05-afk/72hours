import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { computeClocks, usFederalHolidays, isUsBusinessDay } from './index';
import type { IncidentEvents, IncidentScope } from './types';

const baseScope: IncidentScope = {
  subjectCountries: [],
  approxSubjects: 100,
  riskLevel: 'risk',
  sensitiveData: false,
  identityFraudRisk: false,
  hipaaCoveredEntity: false,
  hipaaBusinessAssociate: false,
  moreThan500InOneState: false,
  nis2SignificantIncident: false,
  nis2TrustServiceProvider: false,
  secRegistrant: false,
};

const scope = (overrides: Partial<IncidentScope>): IncidentScope => ({ ...baseScope, ...overrides });
const clock = (clocks: ReturnType<typeof computeClocks>, key: string) => {
  const found = clocks.find((c) => c.stageKey === key);
  if (!found) throw new Error(`no clock ${key}; got ${clocks.map((c) => c.stageKey).join(', ')}`);
  return found;
};

describe('GDPR', () => {
  const events: IncidentEvents = { awareAt: '2026-03-27T10:00:00+01:00', timeZone: 'Europe/Berlin' };

  it('counts 72 elapsed hours from awareness, unaffected by the DST change on 29 March', () => {
    const clocks = computeClocks(scope({ subjectCountries: ['DE'] }), events);
    const c = clock(clocks, 'gdpr-33-authority');
    expect(c.dueAt).toBe('2026-03-30T09:00:00.000Z');
    expect(c.status).toBe('running');
    expect(c.citation.label).toBe('GDPR Art. 33(1)');
    expect(c.basis).toBe('72 hours after awareness');
  });

  it('computes no authority notice when the risk is unlikely', () => {
    const clocks = computeClocks(scope({ subjectCountries: ['FR'], riskLevel: 'unlikely' }), events);
    expect(clocks.find((c) => c.regimeId === 'gdpr')).toBeUndefined();
  });

  it('adds the Art. 34 data subject notice only for high risk, as "without undue delay"', () => {
    expect(computeClocks(scope({ subjectCountries: ['IE'] }), events).some((c) => c.stageKey === 'gdpr-34-subjects')).toBe(false);
    const c = clock(computeClocks(scope({ subjectCountries: ['IE'], riskLevel: 'high' }), events), 'gdpr-34-subjects');
    expect(c.status).toBe('asap');
    expect(c.dueAt).toBeNull();
  });

  it('applies to EEA countries outside the EU but not to the UK', () => {
    expect(computeClocks(scope({ subjectCountries: ['NO'] }), events).some((c) => c.regimeId === 'gdpr')).toBe(true);
    const uk = computeClocks(scope({ subjectCountries: ['GB'] }), events);
    expect(uk.some((c) => c.regimeId === 'gdpr')).toBe(false);
    expect(clock(uk, 'uk-33-commission').dueAt).toBe('2026-03-30T09:00:00.000Z');
  });
});

describe('Philippines NPC Circular 16-03', () => {
  const events: IncidentEvents = { awareAt: '2026-10-29T09:30:00+08:00', timeZone: 'Asia/Manila' };

  it('starts 72-hour commission and data subject clocks and a 5-day full report for sensitive data', () => {
    const clocks = computeClocks(scope({ subjectCountries: ['PH'], sensitiveData: true }), events);
    expect(clock(clocks, 'npc-commission').dueAt).toBe('2026-11-01T01:30:00.000Z');
    expect(clock(clocks, 'npc-subjects').dueAt).toBe('2026-11-01T01:30:00.000Z');
    expect(clock(clocks, 'npc-full-report').dueAt).toBe('2026-11-03T01:30:00.000Z');
  });

  it('applies when the data could enable identity fraud', () => {
    const clocks = computeClocks(scope({ subjectCountries: ['PH'], identityFraudRisk: true }), events);
    expect(clocks.some((c) => c.regimeId === 'ph-npc')).toBe(true);
  });

  it('does not apply without sensitive or identity-fraud data, or when the risk is unlikely', () => {
    expect(computeClocks(scope({ subjectCountries: ['PH'] }), events)).toHaveLength(0);
    expect(computeClocks(scope({ subjectCountries: ['PH'], sensitiveData: true, riskLevel: 'unlikely' }), events)).toHaveLength(0);
  });
});

describe('NIS2 Article 23', () => {
  const events: IncidentEvents = { awareAt: '2027-01-28T08:00:00Z', timeZone: 'Europe/Brussels' };

  it('runs a 24-hour early warning and a 72-hour incident notification', () => {
    const clocks = computeClocks(scope({ nis2SignificantIncident: true }), events);
    expect(clock(clocks, 'nis2-early-warning').dueAt).toBe('2027-01-29T08:00:00.000Z');
    expect(clock(clocks, 'nis2-incident-notification').dueAt).toBe('2027-01-31T08:00:00.000Z');
  });

  it('counts the final report one month after the notification deadline, clamped to the end of February', () => {
    const c = clock(computeClocks(scope({ nis2SignificantIncident: true }), events), 'nis2-final-report');
    expect(c.dueAt).toBe('2027-02-28T08:00:00.000Z');
    expect(c.assumptions.join(' ')).toMatch(/no submission time is recorded/);
  });

  it('counts the final report from the actual submission once it is recorded', () => {
    const c = clock(
      computeClocks(scope({ nis2SignificantIncident: true }), { ...events, nis2NotificationSubmittedAt: '2027-01-29T12:00:00Z' }),
      'nis2-final-report',
    );
    expect(c.dueAt).toBe('2027-02-28T12:00:00.000Z');
    expect(c.assumptions.join(' ')).not.toMatch(/no submission time is recorded/);
  });

  it('gives trust service providers 24 hours for the incident notification', () => {
    const clocks = computeClocks(scope({ nis2SignificantIncident: true, nis2TrustServiceProvider: true }), events);
    expect(clocks.some((c) => c.stageKey === 'nis2-incident-notification')).toBe(false);
    expect(clock(clocks, 'nis2-incident-notification-tsp').dueAt).toBe('2027-01-29T08:00:00.000Z');
    expect(clock(clocks, 'nis2-final-report').dueAt).toBe('2027-02-28T08:00:00.000Z');
  });
});

describe('HIPAA Breach Notification Rule', () => {
  const events: IncidentEvents = { awareAt: '2026-11-15T16:00:00-06:00', timeZone: 'America/Chicago' };

  it('gives individuals until the end of the 60th calendar day after discovery, in local time', () => {
    const c = clock(computeClocks(scope({ hipaaCoveredEntity: true }), events), 'hipaa-individuals');
    expect(c.dueAt).toBe('2027-01-15T05:59:59.999Z'); // 2027-01-14 23:59:59.999 CST
  });

  it('reports breaches under 500 people to HHS within 60 days after the end of the calendar year', () => {
    const clocks = computeClocks(scope({ hipaaCoveredEntity: true, approxSubjects: 120 }), events);
    expect(clock(clocks, 'hipaa-hhs-under-500').dueAt).toBe('2027-03-02T05:59:59.999Z'); // 2027-03-01 end of day CST
    expect(clocks.some((c) => c.stageKey === 'hipaa-hhs-500')).toBe(false);
  });

  it('lands on 29 February in a leap year', () => {
    const c = clock(
      computeClocks(scope({ hipaaCoveredEntity: true }), { awareAt: '2027-06-01T12:00:00-05:00', timeZone: 'America/Chicago' }),
      'hipaa-hhs-under-500',
    );
    expect(c.dueAt).toBe('2028-03-01T05:59:59.999Z'); // 2028-02-29 end of day CST
  });

  it('notifies HHS with the individual notice and the media when thresholds are met', () => {
    const clocks = computeClocks(scope({ hipaaCoveredEntity: true, approxSubjects: 1200, moreThan500InOneState: true }), events);
    expect(clock(clocks, 'hipaa-hhs-500').dueAt).toBe(clock(clocks, 'hipaa-individuals').dueAt);
    expect(clock(clocks, 'hipaa-media').dueAt).toBe('2027-01-15T05:59:59.999Z');
  });

  it('has a business associate notify the covered entity instead', () => {
    const clocks = computeClocks(scope({ hipaaBusinessAssociate: true }), events);
    expect(clocks.map((c) => c.stageKey)).toEqual(['hipaa-ba-to-ce']);
  });
});

describe('SEC Form 8-K Item 1.05', () => {
  it('waits for the materiality determination before starting', () => {
    const c = clock(computeClocks(scope({ secRegistrant: true }), { awareAt: '2026-11-20T15:00:00Z', timeZone: 'America/New_York' }), 'sec-8k-105');
    expect(c.status).toBe('waitingForTrigger');
    expect(c.dueAt).toBeNull();
  });

  it('counts four US business days, skipping Thanksgiving, to 17:30 New York time', () => {
    const c = clock(
      computeClocks(scope({ secRegistrant: true }), {
        awareAt: '2026-11-20T15:00:00Z',
        materialityDeterminedAt: '2026-11-23T10:00:00-05:00', // Monday
        timeZone: 'America/New_York',
      }),
      'sec-8k-105',
    );
    // Tue 24 (1), Wed 25 (2), Thu 26 Thanksgiving (skip), Fri 27 (3), Mon 30 (4)
    expect(c.dueAt).toBe('2026-11-30T22:30:00.000Z');
    expect(c.status).toBe('running');
  });

  it('skips weekends', () => {
    const c = clock(
      computeClocks(scope({ secRegistrant: true }), {
        awareAt: '2026-10-01T15:00:00Z',
        materialityDeterminedAt: '2026-10-29T16:00:00-04:00', // Thursday
        timeZone: 'America/New_York',
      }),
      'sec-8k-105',
    );
    // Fri 30 (1), Mon 2 Nov (2), Tue 3 (3), Wed 4 (4); EST from 1 Nov so 17:30 = 22:30Z
    expect(c.dueAt).toBe('2026-11-04T22:30:00.000Z');
  });
});

describe('Singapore PDPA', () => {
  const events: IncidentEvents = { awareAt: '2026-10-29T09:00:00+08:00', timeZone: 'Asia/Singapore' };

  it('targets the assessment within 30 calendar days and waits for it before the PDPC clock', () => {
    const clocks = computeClocks(scope({ subjectCountries: ['SG'] }), events);
    expect(clock(clocks, 'pdpa-assessment').dueAt).toBe('2026-11-28T15:59:59.999Z');
    expect(clock(clocks, 'pdpa-commission').status).toBe('waitingForTrigger');
  });

  it('gives the PDPC until the end of the third calendar day after the assessment day', () => {
    const c = clock(
      computeClocks(scope({ subjectCountries: ['SG'] }), { ...events, notifiableAssessmentAt: '2026-11-02T10:00:00+08:00' }),
      'pdpa-commission',
    );
    expect(c.dueAt).toBe('2026-11-05T15:59:59.999Z');
  });

  it('treats 500 or more people as significant scale even when the risk is unlikely', () => {
    const clocks = computeClocks(scope({ subjectCountries: ['SG'], riskLevel: 'unlikely', approxSubjects: 500 }), events);
    expect(clocks.some((c) => c.stageKey === 'pdpa-commission')).toBe(true);
  });
});

describe('a multi-regime incident', () => {
  it('sorts clocks by deadline, with open-ended and waiting clocks last', () => {
    const clocks = computeClocks(
      scope({ subjectCountries: ['PH', 'DE', 'SG'], sensitiveData: true, riskLevel: 'high', nis2SignificantIncident: true, secRegistrant: true }),
      { awareAt: '2026-10-29T01:30:00Z', timeZone: 'Asia/Manila' },
    );
    expect(clocks[0].stageKey).toBe('nis2-early-warning');
    const dated = clocks.filter((c) => c.dueAt);
    expect(dated.map((c) => c.dueAt)).toEqual([...dated.map((c) => c.dueAt)].sort());
    expect(clocks.slice(dated.length).every((c) => c.dueAt === null)).toBe(true);
    expect(clocks.every((c) => c.citation.url.startsWith('https://') && c.citation.quote.length > 40)).toBe(true);
  });

  it('returns no clocks when nothing applies', () => {
    expect(computeClocks(scope({ subjectCountries: ['JP'] }), { awareAt: '2026-10-29T01:30:00Z', timeZone: 'Asia/Tokyo' })).toEqual([]);
  });

  it('rejects invalid timestamps and time zones', () => {
    expect(() => computeClocks(baseScope, { awareAt: 'yesterday', timeZone: 'UTC' })).toThrow(/awareAt/);
    expect(() => computeClocks(baseScope, { awareAt: '2026-10-29T01:30:00Z', timeZone: 'Mars/Olympus' })).toThrow(/timeZone/);
  });
});

describe('US federal holidays', () => {
  it('lists the 2026 holidays with Saturday observance', () => {
    expect([...usFederalHolidays(2026)].sort()).toEqual([
      '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03',
      '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
    ]);
  });

  it('observes New Year 2028 (a Saturday) on 31 December 2027', () => {
    expect(usFederalHolidays(2027).has('2027-12-31')).toBe(true);
    expect(isUsBusinessDay(DateTime.fromISO('2027-12-31'))).toBe(false);
    expect(isUsBusinessDay(DateTime.fromISO('2027-12-30'))).toBe(true);
  });
});
