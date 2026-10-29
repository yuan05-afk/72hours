import { beforeEach, describe, expect, it } from 'vitest';
import { EvidenceService } from './evidence';
import { IncidentError, IncidentService } from './incidents';
import { MemoryStore } from '../store/memory';
import type { UserJira } from '../jira/port';
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
  nis2SignificantIncident: false,
  nis2TrustServiceProvider: false,
  secRegistrant: false,
};

const KEY = 'SEC-142';
let store: MemoryStore;
let incidents: IncidentService;
let evidence: EvidenceService;
const now = () => new Date('2026-10-29T07:12:00Z');

beforeEach(async () => {
  store = new MemoryStore();
  incidents = new IncidentService(store, now);
  evidence = new EvidenceService(store, incidents, now);
  await incidents.start({ issueKey: KEY, scope, awareAt: '2026-10-29T09:30:00+08:00', timeZone: 'Asia/Manila', actor: 'acc-mara' });
});

const expectError = async (p: Promise<unknown>, code: IncidentError['code']) => {
  await expect(p).rejects.toBeInstanceOf(IncidentError);
  await expect(p).rejects.toMatchObject({ code });
};

class FakeJira implements UserJira {
  calls: Parameters<UserJira['createTask']>[0][] = [];
  async createTask(input: Parameters<UserJira['createTask']>[0]) {
    this.calls.push(input);
    return { key: `SEC-${200 + this.calls.length}`, linked: true };
  }
}

describe('evidence board', () => {
  it('lists every field the applicable notices need, all as gaps at first', async () => {
    const board = await evidence.board(KEY);
    expect(board.scoped).toBe(true);
    const stages = board.notices.map((n) => n.stageKey);
    expect(stages).toEqual(expect.arrayContaining(['gdpr-33-authority', 'npc-commission', 'npc-full-report']));
    const nature = board.fields.find((f) => f.key === 'nature');
    expect(nature).toMatchObject({ state: 'gap', blocking: true });
    expect(nature?.neededBy.map((n) => n.stageKey)).toEqual(expect.arrayContaining(['gdpr-33-authority', 'npc-commission']));
    // Only needed if the notice is late, so it never blocks.
    expect(board.fields.find((f) => f.key === 'delayReasons')).toMatchObject({ state: 'gap', blocking: false });
    const gdpr = board.notices.find((n) => n.stageKey === 'gdpr-33-authority');
    expect(gdpr).toMatchObject({ required: 8, ready: 0 });
  });

  it('counts a field as ready only once a person has filled or accepted it', async () => {
    await evidence.setField({ issueKey: KEY, fieldKey: 'nature', value: 'Export job copied invoices.', actor: 'acc-mara' });
    await evidence.setField({ issueKey: KEY, fieldKey: 'consequences', value: 'Identity fraud risk.', actor: 'app:clerk', draft: true });
    let gdpr = (await evidence.board(KEY)).notices.find((n) => n.stageKey === 'gdpr-33-authority');
    expect(gdpr?.ready).toBe(1);
    expect(gdpr?.missing).toContain('consequences');

    await evidence.acceptDraft({ issueKey: KEY, fieldKey: 'consequences', actor: 'acc-mara' });
    gdpr = (await evidence.board(KEY)).notices.find((n) => n.stageKey === 'gdpr-33-authority');
    expect(gdpr?.ready).toBe(2);
    const audit = await incidents.auditTrail(KEY);
    expect(audit.map((a) => a.action)).toEqual(['clock.started', 'evidence.set', 'evidence.set', 'evidence.accepted']);
    expect(audit[3]).toMatchObject({ actor: 'acc-mara', detail: { field: 'consequences', draftBy: 'app:clerk' } });
  });

  it('keeps the previous value in the audit trail when a field changes', async () => {
    await evidence.setField({ issueKey: KEY, fieldKey: 'peopleCount', value: 'About 1,000', actor: 'acc-ana' });
    await evidence.setField({ issueKey: KEY, fieldKey: 'peopleCount', value: 'About 1,200', actor: 'acc-ana' });
    const last = (await incidents.auditTrail(KEY)).at(-1);
    expect(last?.detail).toMatchObject({ from: { value: 'About 1,000' }, to: { value: 'About 1,200', state: 'filled' } });
  });

  it('rejects unknown fields, empty values and non-https source links', async () => {
    await expectError(evidence.setField({ issueKey: KEY, fieldKey: 'favouriteColour', value: 'x', actor: 'a' }), 'INVALID_INPUT');
    await expectError(evidence.setField({ issueKey: KEY, fieldKey: 'nature', value: '   ', actor: 'a' }), 'INVALID_INPUT');
    await expectError(
      evidence.setField({ issueKey: KEY, fieldKey: 'nature', value: 'x', actor: 'a', sources: [{ kind: 'jira', label: 'SEC-1', url: 'javascript:alert(1)' }] }),
      'INVALID_INPUT',
    );
    await expectError(evidence.acceptDraft({ issueKey: KEY, fieldKey: 'nature', actor: 'a' }), 'CONFLICT');
  });

  it('refuses evidence for an issue with no incident', async () => {
    await expectError(evidence.setField({ issueKey: 'SEC-9', fieldKey: 'nature', value: 'x', actor: 'a' }), 'NOT_FOUND');
  });
});

describe('open questions', () => {
  it('asks, assigns and answers; the answer becomes a draft of its field', async () => {
    const q = await evidence.askQuestion({ issueKey: KEY, question: 'Were the nightly backups in the same bucket?', fieldKey: 'measures', actor: 'acc-mara' });
    await evidence.assignQuestion({ issueKey: KEY, id: q.id, ownerAccountId: 'acc-ken', actor: 'acc-mara' });
    const { question, fieldDrafted } = await evidence.answerQuestion({ issueKey: KEY, id: q.id, answer: 'No, backups are in a separate account.', actor: 'acc-ken' });
    expect(question).toMatchObject({ status: 'answered', ownerAccountId: 'acc-ken', resolvedBy: 'acc-ken' });
    expect(fieldDrafted).toBe(true);
    const field = (await evidence.board(KEY)).fields.find((f) => f.key === 'measures');
    expect(field).toMatchObject({ state: 'draft', value: 'No, backups are in a separate account.' });
    expect(field?.sources[0].kind).toBe('question');
  });

  it('never overwrites an accepted field with an answer', async () => {
    await evidence.setField({ issueKey: KEY, fieldKey: 'measures', value: 'Key revoked at 11:40.', actor: 'acc-mara' });
    const q = await evidence.askQuestion({ issueKey: KEY, question: 'Was the bucket blocked?', fieldKey: 'measures', actor: 'acc-mara' });
    const { fieldDrafted } = await evidence.answerQuestion({ issueKey: KEY, id: q.id, answer: 'Yes, at 11:45.', actor: 'acc-joy' });
    expect(fieldDrafted).toBe(false);
    expect((await evidence.board(KEY)).fields.find((f) => f.key === 'measures')?.value).toBe('Key revoked at 11:40.');
  });

  it('only acts on questions of the viewed issue, and only while they are open', async () => {
    const q = await evidence.askQuestion({ issueKey: KEY, question: 'When was the key first used?', actor: 'acc-mara' });
    await incidents.start({ issueKey: 'SEC-7', scope, awareAt: '2026-10-29T09:30:00+08:00', timeZone: 'Asia/Manila', actor: 'acc-mara' });
    await expectError(evidence.answerQuestion({ issueKey: 'SEC-7', id: q.id, answer: 'x', actor: 'a' }), 'NOT_FOUND');
    await evidence.dismissQuestion({ issueKey: KEY, id: q.id, reason: 'Not needed for this notice', actor: 'acc-mara' });
    await expectError(evidence.answerQuestion({ issueKey: KEY, id: q.id, answer: 'x', actor: 'a' }), 'CONFLICT');
    await expectError(evidence.dismissQuestion({ issueKey: KEY, id: q.id, reason: 'no', actor: 'a' }), 'INVALID_INPUT');
  });

  it('creates one Jira task per question, assigned to its owner, and flags it when the task is done', async () => {
    const jira = new FakeJira();
    const q = await evidence.askQuestion({
      issueKey: KEY,
      question: 'Were the nightly backups in the same bucket?',
      why: 'Ken Ocampo owns the backup service',
      ownerAccountId: 'acc-ken',
      actor: 'acc-mara',
    });
    const withTask = await evidence.createTask({ issueKey: KEY, id: q.id, actor: 'acc-mara' }, jira);
    expect(withTask.taskKey).toBe('SEC-201');
    expect(jira.calls[0]).toMatchObject({ incidentKey: KEY, assigneeAccountId: 'acc-ken' });
    expect(jira.calls[0].summary).toBe('Breach notice for SEC-142: Were the nightly backups in the same bucket?');
    expect(jira.calls[0].description).toContain('Context: Ken Ocampo owns the backup service');
    await expectError(evidence.createTask({ issueKey: KEY, id: q.id, actor: 'acc-mara' }, jira), 'CONFLICT');

    expect(await evidence.taskDone('SEC-201', 'app:detector')).toBe(1);
    expect((await evidence.board(KEY)).questions[0]).toMatchObject({ taskDone: true, status: 'open' });
    expect(await evidence.taskDone('SEC-201', 'app:detector')).toBe(0);
    expect((await incidents.auditTrail(KEY)).map((a) => a.action)).toContain('question.taskCreated');
  });

  it('keeps long task summaries within Jira limits', async () => {
    const jira = new FakeJira();
    const q = await evidence.askQuestion({ issueKey: KEY, question: 'x'.repeat(480), actor: 'acc-mara' });
    await evidence.createTask({ issueKey: KEY, id: q.id, actor: 'acc-mara' }, jira);
    expect(jira.calls[0].summary.length).toBeLessThanOrEqual(250);
  });
});

describe('a detected incident before scoping', () => {
  it('has a board with no notices yet, but accepts evidence and questions', async () => {
    await incidents.detect({ issueKey: 'SEC-300', detectedAt: '2026-10-29T10:00:00+08:00', timeZone: 'Asia/Manila', actor: 'app:detector', detail: {} });
    await evidence.setField({ issueKey: 'SEC-300', fieldKey: 'nature', value: 'Laptop stolen.', actor: 'acc-mara' });
    const board = await evidence.board('SEC-300');
    expect(board).toMatchObject({ scoped: false, notices: [] });
    expect(board.fields.map((f) => f.key)).toEqual(['nature']);
  });
});
