import { beforeEach, describe, expect, it } from 'vitest';
import { EvidenceService } from './evidence';
import { IncidentError, IncidentService } from './incidents';
import { NoticeService } from './notices';
import { startDrill, summarize } from './drill';
import { ReminderService } from './reminders';
import { MemoryStore } from '../store/memory';
import { requirementFor } from '../notice/fields';
import type { AppJira, UserConfluence } from '../jira/port';
import type { IncidentScope } from '../rules';

const scope: IncidentScope = {
  subjectCountries: ['IE'],
  approxSubjects: 340,
  riskLevel: 'risk',
  sensitiveData: false,
  identityFraudRisk: false,
  hipaaCoveredEntity: false,
  hipaaBusinessAssociate: false,
  moreThan500InOneState: false,
  nis2SignificantIncident: true,
  nis2TrustServiceProvider: false,
  secRegistrant: false,
};

const KEY = 'SEC-142';
let store: MemoryStore;
let incidents: IncidentService;
let evidence: EvidenceService;
let notices: NoticeService;
let clock: Date;
const now = () => clock;

class FakeConfluence implements UserConfluence {
  pages = new Map<string, { title: string; storage: string; version: number }>();
  async listSpaces() {
    return [{ id: '65538', key: 'SEC', name: 'Security' }];
  }
  async createPage({ title, storage }: { spaceId: string; title: string; storage: string }) {
    const id = String(1000 + this.pages.size);
    this.pages.set(id, { title, storage, version: 1 });
    return { id, url: `https://example.atlassian.net/wiki/pages/${id}` };
  }
  async updatePage({ id, title, storage }: { id: string; title: string; storage: string }) {
    const page = this.pages.get(id)!;
    this.pages.set(id, { title, storage, version: page.version + 1 });
    return { id, url: `https://example.atlassian.net/wiki/pages/${id}` };
  }
  async searchPages() {
    return [];
  }
}

const expectError = async (p: Promise<unknown>, code: IncidentError['code']) => {
  await expect(p).rejects.toBeInstanceOf(IncidentError);
  await expect(p).rejects.toMatchObject({ code });
};

/** Fills and accepts every required field of a stage. */
async function fillAll(stageKey: string) {
  for (const [key, need] of Object.entries(requirementFor(stageKey)!.fields)) {
    if (need === 'required') await evidence.setField({ issueKey: KEY, fieldKey: key, value: `Known: ${key}`, actor: 'acc-mara' });
  }
}

beforeEach(async () => {
  clock = new Date('2026-10-29T03:00:00Z');
  store = new MemoryStore();
  incidents = new IncidentService(store, now);
  evidence = new EvidenceService(store, incidents, now);
  notices = new NoticeService(store, incidents, evidence, now);
  await incidents.start({ issueKey: KEY, scope, awareAt: '2026-10-29T09:30:00+08:00', timeZone: 'Asia/Manila', actor: 'acc-mara' });
});

describe('notice drafts', () => {
  it('composes a cited draft that marks itself unfiled and lists what is missing', async () => {
    await evidence.setField({ issueKey: KEY, fieldKey: 'nature', value: 'Export job <copied> invoices & more', actor: 'acc-mara', sources: [{ kind: 'jira', label: 'SEC-145' }] });
    const draft = await notices.compose(KEY, 'gdpr-33-authority');
    expect(draft.title).toBe('SEC-142 · GDPR: Notify the lead supervisory authority (draft)');
    expect(draft.storage).toContain('DRAFT, not filed');
    expect(draft.storage).toContain('Export job &lt;copied&gt; invoices &amp; more');
    expect(draft.storage).toContain('GDPR Art. 33(1)');
    expect(draft.text).toContain('Export job <copied> invoices & more [SEC-145]');
    expect(draft.missing).toContain('dpoContact');
    expect(draft.missing).not.toContain('nature');
    expect(draft.missing).not.toContain('delayReasons');
    expect(draft.text).toContain('due Sun 1 Nov 2026, 09:30 (Asia/Manila)');
  });

  it('asks for a Confluence space once, then creates the page and updates it on redraft', async () => {
    const confluence = new FakeConfluence();
    await expectError(notices.draft({ issueKey: KEY, stageKey: 'gdpr-33-authority', actor: 'acc-mara' }, confluence), 'NEEDS_SETUP');
    await notices.setSpace({ spaceId: '65538', actor: 'acc-mara' });
    const first = await notices.draft({ issueKey: KEY, stageKey: 'gdpr-33-authority', actor: 'acc-mara' }, confluence);
    const second = await notices.draft({ issueKey: KEY, stageKey: 'gdpr-33-authority', actor: 'acc-mara' }, confluence);
    expect(second.pageId).toBe(first.pageId);
    expect(confluence.pages.get(first.pageId!)?.version).toBe(2);
    expect((await notices.list(KEY)).find((n) => n.stageKey === 'gdpr-33-authority')?.status).toBe('draft');
  });

  it('rejects notices that do not apply to the incident', async () => {
    await expectError(notices.compose(KEY, 'hipaa-individuals'), 'INVALID_INPUT');
  });
});

describe('sign-off and filing', () => {
  beforeEach(() => notices.setSpace({ spaceId: '65538', actor: 'acc-mara' }));

  it('only signs off once every required item is accepted, and freezes the draft after', async () => {
    const confluence = new FakeConfluence();
    await expectError(notices.signOff({ issueKey: KEY, stageKey: 'gdpr-33-authority', actor: 'acc-dpo' }), 'CONFLICT');
    await notices.draft({ issueKey: KEY, stageKey: 'gdpr-33-authority', actor: 'acc-mara' }, confluence);
    await expectError(notices.signOff({ issueKey: KEY, stageKey: 'gdpr-33-authority', actor: 'acc-dpo' }), 'CONFLICT');
    await fillAll('gdpr-33-authority');
    // A draft that is not yet accepted still blocks sign-off.
    await evidence.setField({ issueKey: KEY, fieldKey: 'consequences', value: 'Clerk guess', actor: 'app:clerk', draft: true });
    await expectError(notices.signOff({ issueKey: KEY, stageKey: 'gdpr-33-authority', actor: 'acc-dpo' }), 'CONFLICT');
    await evidence.acceptDraft({ issueKey: KEY, fieldKey: 'consequences', actor: 'acc-dpo' });
    const signed = await notices.signOff({ issueKey: KEY, stageKey: 'gdpr-33-authority', note: 'Reviewed with counsel', actor: 'acc-dpo' });
    expect(signed).toMatchObject({ status: 'ready', signedBy: 'acc-dpo', signNote: 'Reviewed with counsel' });
    await expectError(notices.draft({ issueKey: KEY, stageKey: 'gdpr-33-authority', actor: 'acc-mara' }, confluence), 'CONFLICT');
    const audit = (await store.listAudit(KEY)).map((a) => a.action);
    expect(audit).toContain('notice.signedOff');
  });

  it('records filing, starts the NIS2 final-report clock, and stops reminders for filed notices', async () => {
    const confluence = new FakeConfluence();
    await notices.draft({ issueKey: KEY, stageKey: 'nis2-incident-notification', actor: 'acc-mara' }, confluence);
    await fillAll('nis2-incident-notification');
    await expectError(notices.markFiled({ issueKey: KEY, stageKey: 'nis2-incident-notification', actor: 'acc-dpo' }), 'CONFLICT');
    await notices.signOff({ issueKey: KEY, stageKey: 'nis2-incident-notification', actor: 'acc-dpo' });
    await notices.markFiled({ issueKey: KEY, stageKey: 'nis2-incident-notification', filedAt: '2026-10-30T10:00:00Z', reference: 'CSIRT-4411', actor: 'acc-dpo' });
    const view = await incidents.get(KEY);
    expect(view?.incident.nis2NotificationSubmittedAt).toBe('2026-10-30T10:00:00Z');
    expect(view?.clocks.find((c) => c.stageKey === 'nis2-final-report')?.dueAt).toBe('2026-11-30T10:00:00.000Z');

    // Six hours before the 72-hour deadlines: GDPR is reminded, the filed NIS2 notification is not.
    const comments: string[] = [];
    const jira: AppJira = { getIssue: async () => null, getUserTimeZone: async () => null, addInternalComment: async (_k, text) => void comments.push(text), getLatestHumanComment: async () => null };
    clock = new Date('2026-10-31T20:00:00Z');
    await new ReminderService(store, incidents, jira, now).run();
    expect(comments.some((c) => c.includes('GDPR'))).toBe(true);
    expect(comments.some((c) => c.includes('incident notification'))).toBe(false);
  });
});

describe('closing and drills', () => {
  it('closes an incident with a reason and makes it read-only', async () => {
    await expectError(incidents.close({ issueKey: KEY, reason: 'no', actor: 'acc-mara' }), 'INVALID_INPUT');
    const view = await incidents.close({ issueKey: KEY, reason: 'All notices filed', actor: 'acc-mara' });
    expect(view.incident).toMatchObject({ status: 'closed', closedAt: '2026-10-29T03:00:00.000Z' });
    await expectError(evidence.setField({ issueKey: KEY, fieldKey: 'nature', value: 'x', actor: 'a' }), 'CLOSED');
    await expectError(notices.signOff({ issueKey: KEY, stageKey: 'gdpr-33-authority', actor: 'a' }), 'CLOSED');
  });

  it('seeds a labelled drill with sample evidence and questions, and never reminds it', async () => {
    const view = await startDrill({ incidents, evidence, now }, { issueKey: 'SEC-900', actor: 'acc-judge', timeZone: 'Europe/Dublin' });
    expect(view.incident).toMatchObject({ mode: 'drill', status: 'running', timeZone: 'Europe/Dublin' });
    const board = await evidence.board('SEC-900');
    expect(board.fields.filter((f) => f.state === 'draft').length).toBe(2);
    expect(board.questions.length).toBe(3);
    expect((await store.listAudit('SEC-900'))[0].action).toBe('drill.started');
    await expectError(startDrill({ incidents, evidence, now }, { issueKey: 'SEC-900', actor: 'a', timeZone: 'UTC' }), 'ALREADY_RUNNING');

    const comments: string[] = [];
    const jira: AppJira = { getIssue: async () => null, getUserTimeZone: async () => null, addInternalComment: async (_k, text) => void comments.push(text), getLatestHumanComment: async () => null };
    clock = new Date(clock.getTime() + 60 * 3_600_000);
    await new ReminderService(store, incidents, jira, now).run();
    expect(comments.filter((c) => c.includes('SEC-900'))).toEqual([]);
  });

  it('summarises readiness and filing against each deadline', async () => {
    const confluence = new FakeConfluence();
    await notices.setSpace({ spaceId: '65538', actor: 'a' });
    await notices.draft({ issueKey: KEY, stageKey: 'gdpr-33-authority', actor: 'acc-mara' }, confluence);
    await fillAll('gdpr-33-authority');
    await notices.signOff({ issueKey: KEY, stageKey: 'gdpr-33-authority', actor: 'acc-dpo' });
    await notices.markFiled({ issueKey: KEY, stageKey: 'gdpr-33-authority', filedAt: '2026-10-31T01:30:00Z', actor: 'acc-dpo' });
    const view = (await incidents.get(KEY))!;
    const s = summarize(view, await evidence.board(KEY), await store.listNotices(KEY), await store.listAudit(KEY));
    const gdpr = s.notices.find((n) => n.stageKey === 'gdpr-33-authority');
    expect(gdpr).toMatchObject({ filedAt: '2026-10-31T01:30:00Z', marginHours: 24 });
    expect(s.requiredReady).toBeGreaterThanOrEqual(8);
    expect(s.score).toBeGreaterThan(0);
  });
});
