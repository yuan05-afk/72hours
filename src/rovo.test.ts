import { beforeEach, describe, expect, it } from 'vitest';
import * as rovo from './rovo';
import type { RovoServices } from './rovo';
import { AssembleService } from './service/assemble';
import { EvidenceService } from './service/evidence';
import { IncidentService } from './service/incidents';
import { NoticeService } from './service/notices';
import { MemoryStore } from './store/memory';
import type { IncidentScope } from './rules';

const scope: IncidentScope = {
  subjectCountries: ['IE', 'PH'],
  approxSubjects: 1200,
  riskLevel: 'high',
  sensitiveData: true,
  identityFraudRisk: false,
  hipaaCoveredEntity: false,
  hipaaBusinessAssociate: false,
  moreThan500InOneState: false,
  nis2SignificantIncident: false,
  nis2TrustServiceProvider: false,
  secRegistrant: false,
};

let s: RovoServices;
const visible = new Set(['SEC-142']);

beforeEach(async () => {
  const store = new MemoryStore();
  const incidents = new IncidentService(store);
  const evidence = new EvidenceService(store, incidents);
  const notices = new NoticeService(store, incidents, evidence);
  const assemble = new AssembleService(incidents, evidence);
  const jira = { getIssueContext: async () => null, canView: async (key: string) => visible.has(key) };
  s = {
    store,
    incidents,
    evidence,
    notices,
    assemble,
    jira,
    assembleDeps: { jira, confluence: {} as never, graph: { relatedWork: async () => [] }, llm: null },
  };
  await incidents.start({ issueKey: 'SEC-142', scope, awareAt: '2026-10-29T09:30:00+08:00', timeZone: 'Asia/Manila', actor: 'acc-mara' });
  await incidents.start({ issueKey: 'HR-7', scope, awareAt: '2026-10-29T09:30:00+08:00', timeZone: 'Asia/Manila', actor: 'acc-hr' });
});

describe('Clerk actions', () => {
  it('report status only for incidents the caller can see', async () => {
    const text = await rovo.status(s, { issueKey: 'sec-142' });
    expect(text).toContain('SEC-142: running.');
    expect(text).toContain('Notify the lead supervisory authority (GDPR, GDPR Art. 33(1)): due Sun 1 Nov, 09:30 (Asia/Manila); not drafted');
    expect(await rovo.status(s, { issueKey: 'HR-7' })).toBe('HR-7 does not exist or you cannot see it.');
    expect(await rovo.listIncidents(s)).not.toContain('HR-7');
  });

  it('falls back to the issue the user is viewing, and asks when there is none', async () => {
    expect(await rovo.status(s, { issueKey: 'the breach', context: { jira: { issueKey: 'SEC-142' } } })).toContain('SEC-142');
    expect(await rovo.status(s, {})).toContain('Which incident?');
  });

  it('records questions as the signed-in user, never as someone named in the input', async () => {
    const reply = await rovo.askQuestion(s, { issueKey: 'SEC-142', question: 'Were backups affected?', field: 'measures' }, { principal: { accountId: 'acc-joy' } });
    expect(reply).toContain('Added the open question');
    const board = await s.evidence.board('SEC-142');
    expect(board.questions[0]).toMatchObject({ createdBy: 'acc-joy', fieldKey: 'measures' });
    expect(await rovo.askQuestion(s, { issueKey: 'SEC-142', question: 'x?' }, {})).toBe('No signed-in user.');
  });

  it('drafts the notice the user names, by regulator or action', async () => {
    const npc = await rovo.draftNotice(s, { issueKey: 'SEC-142', notice: 'NPC' });
    expect(npc).toContain('Notify the National Privacy Commission');
    expect(npc).toContain('DRAFT, not filed');
    expect(await rovo.draftNotice(s, { issueKey: 'SEC-142', notice: 'SEC 8-K' })).toContain('No notice on SEC-142 matches');
  });
});
