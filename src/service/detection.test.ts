import { beforeEach, describe, expect, it } from 'vitest';
import { DetectionService, detectionComment, labelAdded, normaliseJiraTime } from './detection';
import type { IssueEvent } from './detection';
import { EvidenceService } from './evidence';
import { IncidentError, IncidentService } from './incidents';
import { MemoryStore } from '../store/memory';
import type { AppJira } from '../jira/port';
import type { IncidentScope } from '../rules';

class FakeAppJira implements AppJira {
  comments: { issueKey: string; text: string }[] = [];
  issues = new Map<string, { labels: string[]; created: string }>();
  zones = new Map<string, string>([['acc-mara', 'Asia/Manila']]);
  async getIssue(key: string) {
    return this.issues.get(key) ?? null;
  }
  async getUserTimeZone(accountId: string) {
    return this.zones.get(accountId) ?? null;
  }
  async addInternalComment(issueKey: string, text: string) {
    this.comments.push({ issueKey, text });
  }
  latest = new Map<string, { text: string; authorAccountId: string }>();
  async getLatestHumanComment(issueKey: string) {
    return this.latest.get(issueKey) ?? null;
  }
}

const labelled = (key = 'SEC-142', from = 'phishing', to = 'phishing personal-data-involved'): IssueEvent => ({
  eventType: 'avi:jira:updated:issue',
  atlassianId: 'acc-mara',
  issue: { key, fields: { created: '2026-10-29T08:05:00.000+0800', updated: '2026-10-29T09:30:00.000+0800' } },
  changelog: { items: [{ field: 'labels', fromString: from, toString: to }] },
});

let store: MemoryStore;
let incidents: IncidentService;
let evidence: EvidenceService;
let jira: FakeAppJira;
let detection: DetectionService;
const now = () => new Date('2026-10-29T01:31:00Z');

beforeEach(() => {
  store = new MemoryStore();
  incidents = new IncidentService(store, now);
  evidence = new EvidenceService(store, incidents, now);
  jira = new FakeAppJira();
  detection = new DetectionService(incidents, evidence, jira, now);
});

describe('label changes', () => {
  it('detects the label only when it is newly added, in any case', () => {
    expect(labelAdded(labelled().changelog?.items)).toBe(true);
    expect(labelAdded([{ field: 'labels', fromString: null, toString: 'Personal-Data-Involved' }])).toBe(true);
    expect(labelAdded([{ field: 'labels', fromString: 'personal-data-involved', toString: 'personal-data-involved vip' }])).toBe(false);
    expect(labelAdded([{ field: 'labels', fromString: 'personal-data-involved', toString: '' }])).toBe(false);
    expect(labelAdded([{ field: 'summary', fromString: 'a', toString: 'personal-data-involved' }])).toBe(false);
  });

  it('normalises Jira timestamps to ISO 8601 with a colon offset', () => {
    expect(normaliseJiraTime('2026-10-29T09:30:00.000+0800', new Date(0))).toBe('2026-10-29T09:30:00.000+08:00');
    expect(normaliseJiraTime('not a date', new Date('2026-10-29T00:00:00Z'))).toBe('2026-10-29T00:00:00.000Z');
  });
});

describe('detecting an incident', () => {
  it('records awareness at the time of the label in the flagger\'s zone, and tells the team internally', async () => {
    expect(await detection.handle(labelled())).toBe('detected');
    const view = await incidents.get('SEC-142');
    expect(view?.incident).toMatchObject({ status: 'detected', scope: null, awareAt: '2026-10-29T09:30:00.000+08:00', timeZone: 'Asia/Manila' });
    expect(view?.clocks).toEqual([]);
    expect(jira.comments).toHaveLength(1);
    expect(jira.comments[0].text).toContain('Thu 29 Oct 2026, 09:30 (Asia/Manila)');
    expect(jira.comments[0].text).toContain('opened at Thu 29 Oct 2026, 08:05');
    const audit = await incidents.auditTrail('SEC-142');
    expect(audit[0]).toMatchObject({ actor: 'app:detector', action: 'incident.detected', detail: { flaggedBy: 'acc-mara' } });
  });

  it('does nothing more when the label is added again', async () => {
    await detection.handle(labelled());
    expect(await detection.handle(labelled('SEC-142', '', 'personal-data-involved'))).toBe('already-tracked');
    expect(jira.comments).toHaveLength(1);
  });

  it('reads labels for new issues, since the created event does not carry them', async () => {
    jira.issues.set('SEC-150', { labels: ['personal-data-involved'], created: '2026-10-29T11:00:00.000+0800' });
    jira.issues.set('SEC-151', { labels: ['network'], created: '2026-10-29T11:00:00.000+0800' });
    const created = (key: string): IssueEvent => ({ eventType: 'avi:jira:created:issue', atlassianId: 'acc-unknown', issue: { key } });
    expect(await detection.handle(created('SEC-151'))).toBe('ignored');
    expect(await detection.handle(created('SEC-150'))).toBe('detected');
    // No visible time zone on the profile: fall back to UTC rather than guess.
    expect((await incidents.get('SEC-150'))?.incident).toMatchObject({ timeZone: 'UTC', awareAt: '2026-10-29T11:00:00.000+08:00' });
  });

  it('ignores unrelated updates without calling Jira', async () => {
    const event: IssueEvent = { ...labelled(), changelog: { items: [{ field: 'summary', fromString: 'a', toString: 'b' }] } };
    expect(await detection.handle(event)).toBe('ignored');
    expect(jira.comments).toEqual([]);
  });

  it('flags open questions when their task moves to done', async () => {
    await detection.handle(labelled());
    const q = await evidence.askQuestion({ issueKey: 'SEC-142', question: 'Were backups affected?', actor: 'acc-mara' });
    await store.updateQuestion('SEC-142', q.id, { taskKey: 'SEC-201' });
    const done: IssueEvent = {
      eventType: 'avi:jira:updated:issue',
      issue: { key: 'SEC-201', fields: { status: { statusCategory: { key: 'done' } } } },
      changelog: { items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }] },
    };
    expect(await detection.handle(done)).toBe('task-done');
    expect((await evidence.board('SEC-142')).questions[0].taskDone).toBe(true);
  });

  it("takes the answer from the task's newest comment and drafts it into the field", async () => {
    await detection.handle(labelled());
    const q = await evidence.askQuestion({ issueKey: 'SEC-142', question: 'Were backups in the same bucket?', fieldKey: 'measures', ownerAccountId: 'acc-ken', actor: 'acc-mara' });
    await store.updateQuestion('SEC-142', q.id, { taskKey: 'SEC-201' });
    jira.latest.set('SEC-201', { text: 'No. Backups go to a separate account.', authorAccountId: 'acc-ken' });
    const done: IssueEvent = {
      eventType: 'avi:jira:updated:issue',
      issue: { key: 'SEC-201', fields: { status: { statusCategory: { key: 'done' } } } },
      changelog: { items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }] },
    };
    expect(await detection.handle(done)).toBe('task-done');
    const board = await evidence.board('SEC-142');
    expect(board.questions[0]).toMatchObject({ status: 'answered', answer: 'No. Backups go to a separate account.', resolvedBy: 'acc-ken' });
    expect(board.fields.find((f) => f.key === 'measures')).toMatchObject({
      state: 'draft',
      value: 'No. Backups go to a separate account.',
      sources: [{ kind: 'question', label: 'Answer on SEC-201' }],
    });
  });

  it('does not read comments of Done issues that no question is waiting on', async () => {
    let calls = 0;
    jira.getLatestHumanComment = async () => {
      calls++;
      return null;
    };
    const done: IssueEvent = {
      eventType: 'avi:jira:updated:issue',
      issue: { key: 'OPS-9', fields: { status: { statusCategory: { key: 'done' } } } },
      changelog: { items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }] },
    };
    expect(await detection.handle(done)).toBe('ignored');
    expect(calls).toBe(0);
  });
});

describe('scoping a detected incident', () => {
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

  it('starts the clocks from the confirmed awareness time and keeps the detected time in the audit', async () => {
    await detection.handle(labelled());
    await expect(incidents.updateScope({ issueKey: 'SEC-142', scope, reason: 'More known now', actor: 'acc-mara' })).rejects.toMatchObject({
      code: 'NOT_SCOPED',
    });
    const view = await incidents.start({ issueKey: 'SEC-142', scope, awareAt: '2026-10-29T08:05:00+08:00', timeZone: 'Asia/Manila', actor: 'acc-mara' });
    expect(view.incident.status).toBe('running');
    expect(view.clocks.find((c) => c.stageKey === 'gdpr-33-authority')?.dueAt).toBe('2026-11-01T00:05:00.000Z');
    const started = (await incidents.auditTrail('SEC-142')).at(-1);
    expect(started).toMatchObject({ action: 'clock.started', detail: { detectedAwareAt: '2026-10-29T09:30:00.000+08:00' } });
    await expect(incidents.start({ issueKey: 'SEC-142', scope, awareAt: '2026-10-29T08:05:00+08:00', timeZone: 'Asia/Manila', actor: 'a' })).rejects.toBeInstanceOf(
      IncidentError,
    );
  });

  it('lets people correct the awareness time before scoping', async () => {
    await detection.handle(labelled());
    const view = await incidents.correctAwareness({ issueKey: 'SEC-142', awareAt: '2026-10-29T08:05:00+08:00', reason: 'SOC alert time', actor: 'acc-mara' });
    expect(view).toMatchObject({ incident: { awareAt: '2026-10-29T08:05:00+08:00', status: 'detected' }, clocks: [] });
  });
});

describe('the detection comment', () => {
  it('does not suggest an earlier time when the label was added at creation', () => {
    const text = detectionComment('2026-10-29T09:30:00.000+08:00', 'Asia/Manila', '2026-10-29T09:30:00.000+08:00');
    expect(text).not.toContain('was opened at');
    expect(text).toContain('If the team knew earlier');
  });
});
