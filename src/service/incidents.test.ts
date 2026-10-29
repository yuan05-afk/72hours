import { beforeEach, describe, expect, it } from 'vitest';
import { IncidentError, IncidentService } from './incidents';
import { MemoryStore } from '../store/memory';
import type { IncidentScope } from '../rules';

const scope: IncidentScope = {
  subjectCountries: ['PH', 'IE'],
  approxSubjects: 1200,
  riskLevel: 'high',
  sensitiveData: true,
  identityFraudRisk: true,
  hipaaCoveredEntity: false,
  hipaaBusinessAssociate: false,
  moreThan500InOneState: false,
  nis2SignificantIncident: true,
  nis2TrustServiceProvider: false,
  secRegistrant: false,
};

const START = { issueKey: 'SEC-142', scope, awareAt: '2026-10-29T09:30:00+08:00', timeZone: 'Asia/Manila', actor: 'acc-mara' };

let store: MemoryStore;
let service: IncidentService;
let clock = new Date('2026-10-29T07:12:00Z');

beforeEach(() => {
  store = new MemoryStore();
  clock = new Date('2026-10-29T07:12:00Z');
  service = new IncidentService(store, () => clock);
});

const expectError = async (p: Promise<unknown>, code: IncidentError['code']) => {
  await expect(p).rejects.toBeInstanceOf(IncidentError);
  await expect(p).rejects.toMatchObject({ code });
};

describe('starting a breach clock', () => {
  it('stores the incident, returns its clocks and audits who started it', async () => {
    const view = await service.start(START);
    expect(view.incident.status).toBe('running');
    expect(view.clocks.map((c) => c.stageKey)).toContain('gdpr-33-authority');
    expect(view.clocks.find((c) => c.stageKey === 'nis2-early-warning')?.dueAt).toBe('2026-10-30T01:30:00.000Z');

    const audit = await service.auditTrail('SEC-142');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: 'acc-mara', action: 'clock.started', at: '2026-10-29T07:12:00.000Z' });
    expect(audit[0].detail.regimes).toEqual(expect.arrayContaining(['gdpr', 'ph-npc', 'nis2']));
  });

  it('refuses a second clock on the same incident', async () => {
    await service.start(START);
    await expectError(service.start(START), 'ALREADY_RUNNING');
  });

  it('rejects an invalid awareness time without storing anything', async () => {
    await expectError(service.start({ ...START, awareAt: 'this morning' }), 'INVALID_INPUT');
    expect(await service.get('SEC-142')).toBeNull();
    expect(await service.auditTrail('SEC-142')).toEqual([]);
  });

  it('rejects an unknown time zone', async () => {
    await expectError(service.start({ ...START, timeZone: 'Asia/Atlantis' }), 'INVALID_INPUT');
  });
});

describe('correcting the awareness time', () => {
  it('moves every clock and records the old value, the new value and the reason', async () => {
    await service.start({ ...START, awareAt: '2026-10-29T11:05:00+08:00' });
    clock = new Date('2026-10-29T07:02:00Z');
    const view = await service.correctAwareness({ issueKey: 'SEC-142', awareAt: '2026-10-29T09:30:00+08:00', reason: 'SOC alert timestamp', actor: 'acc-mara' });

    expect(view.clocks.find((c) => c.stageKey === 'gdpr-33-authority')?.dueAt).toBe('2026-11-01T01:30:00.000Z');
    expect((await service.get('SEC-142'))?.incident.awareAt).toBe('2026-10-29T09:30:00+08:00');
    const last = (await service.auditTrail('SEC-142')).at(-1);
    expect(last).toMatchObject({
      action: 'awareness.corrected',
      detail: { from: '2026-10-29T11:05:00+08:00', to: '2026-10-29T09:30:00+08:00', reason: 'SOC alert timestamp' },
    });
  });

  it('requires a real reason', async () => {
    await service.start(START);
    await expectError(service.correctAwareness({ issueKey: 'SEC-142', awareAt: START.awareAt, reason: ' ok ', actor: 'acc-mara' }), 'INVALID_INPUT');
  });

  it('fails clearly when no clock is running', async () => {
    await expectError(service.correctAwareness({ issueKey: 'SEC-9', awareAt: START.awareAt, reason: 'typo fix', actor: 'a' }), 'NOT_FOUND');
  });
});

describe('recording trigger events', () => {
  it('starts the SEC clock once materiality is determined', async () => {
    await service.start({ ...START, scope: { ...scope, secRegistrant: true } });
    const before = (await service.get('SEC-142'))!.clocks.find((c) => c.stageKey === 'sec-8k-105');
    expect(before?.status).toBe('waitingForTrigger');

    const view = await service.recordEvent({ issueKey: 'SEC-142', event: 'materiality', at: '2026-11-23T10:00:00-05:00', actor: 'acc-cfo' });
    expect(view.clocks.find((c) => c.stageKey === 'sec-8k-105')?.dueAt).toBe('2026-11-30T22:30:00.000Z');
    expect((await service.auditTrail('SEC-142')).at(-1)).toMatchObject({ action: 'event.materiality', actor: 'acc-cfo' });
  });

  it('moves the NIS2 final report to one month after the actual submission (31 Oct clamps to 30 Nov)', async () => {
    await service.start(START);
    const view = await service.recordEvent({ issueKey: 'SEC-142', event: 'nis2NotificationSubmitted', at: '2026-10-31T09:00:00+08:00', actor: 'acc-mara' });
    expect(view.clocks.find((c) => c.stageKey === 'nis2-final-report')?.dueAt).toBe('2026-11-30T01:00:00.000Z');
  });

  it('rejects an unknown event name', async () => {
    await service.start(START);
    await expectError(service.recordEvent({ issueKey: 'SEC-142', event: 'filedEarly' as never, at: START.awareAt, actor: 'a' }), 'INVALID_INPUT');
  });
});

describe('updating the scope', () => {
  it('adds regimes when the answers change and keeps the history', async () => {
    await service.start({ ...START, scope: { ...scope, subjectCountries: ['PH'], nis2SignificantIncident: false } });
    const view = await service.updateScope({ issueKey: 'SEC-142', scope, reason: 'Dublin patients found in export', actor: 'acc-ana' });
    expect(new Set(view.clocks.map((c) => c.regimeId))).toEqual(new Set(['ph-npc', 'gdpr', 'nis2']));
    const last = (await service.auditTrail('SEC-142')).at(-1)!;
    expect(last.action).toBe('scope.updated');
    expect((last.detail.from as IncidentScope).subjectCountries).toEqual(['PH']);
  });
});

describe('checking the scope sent by the browser', () => {
  it('rejects missing countries, bad counts, unknown risk levels and missing answers without storing anything', async () => {
    await expectError(service.start({ ...START, scope: { ...scope, subjectCountries: [] } }), 'INVALID_INPUT');
    await expectError(service.start({ ...START, scope: { ...scope, subjectCountries: ['Ireland'] } }), 'INVALID_INPUT');
    await expectError(service.start({ ...START, scope: { ...scope, approxSubjects: 0 } }), 'INVALID_INPUT');
    await expectError(service.start({ ...START, scope: { ...scope, approxSubjects: '1200' } }), 'INVALID_INPUT');
    await expectError(service.start({ ...START, scope: { ...scope, riskLevel: 'medium' } }), 'INVALID_INPUT');
    const { secRegistrant: _omitted, ...missing } = scope;
    await expectError(service.start({ ...START, scope: missing }), 'INVALID_INPUT');
    await expectError(service.start({ ...START, scope: null }), 'INVALID_INPUT');
    expect(await service.get('SEC-142')).toBeNull();
  });

  it('keeps only known answers, with country codes upper-cased and de-duplicated', async () => {
    const view = await service.start({ ...START, scope: { ...scope, subjectCountries: ['ph', 'IE', 'PH'], extra: 'ignored' } });
    expect(view.incident.scope).toEqual({ ...scope, subjectCountries: ['PH', 'IE'] });
  });

  it('previews the deadlines a scope would start without storing anything', async () => {
    const clocks = service.preview({ scope, awareAt: START.awareAt, timeZone: START.timeZone });
    expect(clocks.find((c) => c.stageKey === 'nis2-early-warning')?.dueAt).toBe('2026-10-30T01:30:00.000Z');
    expect(await service.get('SEC-142')).toBeNull();
    expect(() => service.preview({ scope, awareAt: 'soon', timeZone: START.timeZone })).toThrow(IncidentError);
  });
});
