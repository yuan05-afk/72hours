import { beforeEach, describe, expect, it } from 'vitest';
import { ReminderService, dueThreshold, reminderText } from './reminders';
import { EvidenceService } from './evidence';
import { IncidentService } from './incidents';
import { MemoryStore } from '../store/memory';
import type { AppJira } from '../jira/port';
import type { Clock, IncidentScope } from '../rules';
import type { IncidentRecord } from '../store/types';

const scope: IncidentScope = {
  subjectCountries: ['IE'],
  approxSubjects: 340,
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

// Aware 09:30 Manila (01:30Z) on 29 Oct: the GDPR 72-hour deadline is 01:30Z on 1 Nov.
const AWARE = '2026-10-29T09:30:00+08:00';
const DUE = '2026-11-01T01:30:00.000Z';

class FakeAppJira implements AppJira {
  comments: { issueKey: string; text: string }[] = [];
  failNext = false;
  async getIssue() {
    return null;
  }
  async getUserTimeZone() {
    return null;
  }
  async getLatestHumanComment() {
    return null;
  }
  async addInternalComment(issueKey: string, text: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Jira is down');
    }
    this.comments.push({ issueKey, text });
  }
}

const clock = (dueAt: string | null, stageKey = 'gdpr-33-authority', status: Clock['status'] = 'running'): Clock => ({
  regimeId: 'gdpr',
  regimeName: 'GDPR',
  stageKey,
  action: 'Notify the lead supervisory authority',
  recipient: 'Lead supervisory authority',
  status,
  dueAt,
  basis: '72 hours after awareness',
  citation: { label: 'GDPR Art. 33(1)', url: 'https://example.org', quote: 'q' },
  lastVerified: '2026-10-29',
  assumptions: [],
});

const incident = (createdAt = '2026-10-29T01:35:00Z', extra: Partial<IncidentRecord> = {}): IncidentRecord => ({
  issueKey: 'SEC-142',
  scope,
  awareAt: AWARE,
  timeZone: 'Asia/Manila',
  materialityDeterminedAt: null,
  notifiableAssessmentAt: null,
  nis2NotificationSubmittedAt: null,
  status: 'running',
  mode: 'real',
  closedAt: null,
  createdBy: 'acc-mara',
  createdAt,
  ...extra,
});

describe('which reminder is due', () => {
  const at = (iso: string) => new Date(iso);

  it('sends nothing while more than 24 hours remain', () => {
    expect(dueThreshold(clock(DUE), incident(), at('2026-10-30T23:00:00Z'))).toBeNull();
  });

  it('sends the 24-hour, then the 6-hour reminder, then overdue', () => {
    expect(dueThreshold(clock(DUE), incident(), at('2026-10-31T02:00:00Z'))).toBe('24h');
    expect(dueThreshold(clock(DUE), incident(), at('2026-10-31T20:00:00Z'))).toBe('6h');
    expect(dueThreshold(clock(DUE), incident(), at('2026-11-01T02:00:00Z'))).toBe('overdue');
  });

  it('stops reminding about a deadline that passed more than two days ago', () => {
    expect(dueThreshold(clock(DUE), incident(), at('2026-11-03T02:00:00Z'))).toBeNull();
  });

  it('skips a threshold that had already passed when the incident was first tracked', () => {
    // Tracked 10 hours before the deadline: no "24 hours left" notice, only the 6-hour one later.
    const late = incident('2026-10-31T15:30:00Z');
    expect(dueThreshold(clock(DUE), late, at('2026-10-31T16:00:00Z'))).toBeNull();
    expect(dueThreshold(clock(DUE), late, at('2026-10-31T20:00:00Z'))).toBe('6h');
  });

  it('ignores clocks without a running deadline, and NIS2 notices already submitted', () => {
    expect(dueThreshold(clock(null, 'gdpr-34-subjects', 'asap'), incident(), at('2026-10-31T20:00:00Z'))).toBeNull();
    const submitted = incident(undefined, { nis2NotificationSubmittedAt: '2026-10-30T01:00:00Z' });
    expect(dueThreshold(clock(DUE, 'nis2-incident-notification'), submitted, at('2026-10-31T20:00:00Z'))).toBeNull();
  });

  it('words the reminder in the organisation\'s time zone, with the open field count', () => {
    const text = reminderText(clock(DUE), '6h', 'Asia/Manila', 3);
    expect(text).toContain('due Sun 1 Nov, 09:30 (Asia/Manila), in about 6 hours');
    expect(text).toContain('GDPR Art. 33(1)');
    expect(text).toContain('3 required notice fields are still open');
    expect(reminderText(clock(DUE), 'overdue', 'Asia/Manila', 3)).toContain('reasons for the delay');
    // A notice with no mapped checklist must not claim its fields are complete.
    const unmapped = reminderText(clock(DUE, 'npc-subjects'), '24h', 'Asia/Manila', null);
    expect(unmapped).not.toContain('All required notice fields are filled');
    expect(unmapped).toContain("regulator's own form");
  });
});

describe('running the reminder schedule', () => {
  let store: MemoryStore;
  let jira: FakeAppJira;
  let current: Date;
  let service: ReminderService;

  beforeEach(async () => {
    store = new MemoryStore();
    jira = new FakeAppJira();
    current = new Date('2026-10-29T01:35:00Z');
    const incidents = new IncidentService(store, () => current);
    await incidents.start({ issueKey: 'SEC-142', scope, awareAt: AWARE, timeZone: 'Asia/Manila', actor: 'acc-mara' });
    await new EvidenceService(store, incidents, () => current).setField({ issueKey: 'SEC-142', fieldKey: 'nature', value: 'x', actor: 'a' });
    service = new ReminderService(store, incidents, jira, () => current);
  });

  it('posts each reminder once, even if the schedule runs twice in the window', async () => {
    current = new Date('2026-10-31T02:00:00Z');
    expect(await service.run()).toEqual({ sent: 1, failed: 0 });
    expect(await service.run()).toEqual({ sent: 0, failed: 0 });
    expect(jira.comments).toHaveLength(1);
    expect(jira.comments[0].text).toContain('7 required notice fields are still open');
    const audit = await store.listAudit('SEC-142');
    expect(audit.at(-1)).toMatchObject({ actor: 'app:reminders', action: 'reminder.sent', detail: { threshold: '24h', missingFields: 7 } });
  });

  it('retries on the next run when Jira refuses the comment', async () => {
    current = new Date('2026-10-31T20:00:00Z');
    jira.failNext = true;
    expect(await service.run()).toEqual({ sent: 0, failed: 1 });
    expect(await service.run()).toEqual({ sent: 1, failed: 0 });
  });
});
