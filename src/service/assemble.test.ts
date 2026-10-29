import { beforeEach, describe, expect, it } from 'vitest';
import { AssembleService, fallbackProposals, parseProposals, sourcesFrom, userPrompt } from './assemble';
import { EvidenceService } from './evidence';
import { IncidentService } from './incidents';
import { MemoryStore } from '../store/memory';
import type { GraphPort, IssueContext, LlmPort, UserConfluence, UserJiraContext } from '../jira/port';
import type { FieldKey } from '../notice/fields';
import type { IncidentScope } from '../rules';

const issue: IssueContext = {
  key: 'SEC-142',
  summary: 'Patient billing records exported by a service account',
  description: 'An export job ran under a leaked key and copied invoice files to an outside bucket.',
  created: '2026-10-29T08:05:00.000+0800',
  reporterAccountId: 'acc-mara',
  assigneeAccountId: 'acc-ken',
  comments: [{ id: '1', author: 'Ana Reyes', created: '2026-10-29T10:00:00.000+0800', text: 'Billing DB count: 860 PH, 340 IE patients.' }],
  links: [{ key: 'SEC-145', summary: 'Revoke the service-account key', status: 'Done' }],
};

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

describe('model output is validated before anything is saved', () => {
  const allowed = new Set<FieldKey>(['nature', 'peopleCount']);
  const ids = new Set(['S1', 'S2']);

  it('keeps cited proposals for requested fields only', () => {
    const raw = 'Here you go: {"fields":[{"key":"peopleCount","value":"About 1,200 patients.","sources":["S2"]},' +
      '{"key":"dpoContact","value":"Invented","sources":["S1"]},' +
      '{"key":"nature","value":"Uncited claim","sources":[]},' +
      '{"key":"nature","value":"Cited","sources":["S9","S1"]}]}';
    expect(parseProposals(raw, allowed, ids)).toEqual([
      { key: 'peopleCount', value: 'About 1,200 patients.', sourceIds: ['S2'] },
      { key: 'nature', value: 'Cited', sourceIds: ['S1'] },
    ]);
  });

  it('returns nothing for malformed or empty output', () => {
    expect(parseProposals('no json here', allowed, ids)).toEqual([]);
    expect(parseProposals('{"fields": "nope"}', allowed, ids)).toEqual([]);
    expect(parseProposals('{"fields":[{"key":"nature","value":"   ","sources":["S1"]}]}', allowed, ids)).toEqual([]);
  });

  it('numbers every source and keeps the prompt within budget', () => {
    const sources = sourcesFrom(issue, [{ title: 'Breach playbook', url: 'https://x/wiki/1', excerpt: 'DPO: Mara Lim' }], []);
    expect(sources.map((s) => s.id)).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(sources[3]).toMatchObject({ kind: 'confluence', url: 'https://x/wiki/1' });
    const prompt = userPrompt(['nature', 'dpoContact'], sources);
    expect(prompt).toContain('[S2] (jira: SEC-142 comment by Ana Reyes)');
    expect(prompt).toContain('- dpoContact: DPO contact.');
  });

  it('falls back to facts the app knows, never invented ones', () => {
    const out = fallbackProposals(issue, '2026-10-29T09:30:00+08:00', 'Asia/Manila', new Set<FieldKey>(['nature', 'chronology', 'dpoContact']));
    expect(out.map((o) => o.key)).toEqual(['nature', 'chronology']);
    expect(out[1].value).toBe('Incident SEC-142 opened 29 Oct 2026, 08:05 (Asia/Manila). Awareness recorded as 29 Oct 2026, 09:30 (Asia/Manila).');
  });
});

describe('assembling evidence', () => {
  let store: MemoryStore;
  let incidents: IncidentService;
  let evidence: EvidenceService;
  let service: AssembleService;
  const jira: UserJiraContext = { getIssueContext: async () => issue, canView: async () => true };
  const confluence: UserConfluence = {
    listSpaces: async () => [],
    createPage: async () => ({ id: '1', url: '' }),
    updatePage: async () => ({ id: '1', url: '' }),
    searchPages: async () => [{ id: '7', title: 'Breach playbook', url: 'https://x/wiki/7', excerpt: 'DPO: Mara Lim, dpo@lumen.example' }],
  };
  const graph: GraphPort = { relatedWork: async () => [{ kind: 'jira', title: 'Backup migration', key: 'OPS-9' }] };

  beforeEach(async () => {
    store = new MemoryStore();
    incidents = new IncidentService(store);
    evidence = new EvidenceService(store, incidents);
    service = new AssembleService(incidents, evidence);
    await incidents.start({ issueKey: 'SEC-142', scope, awareAt: '2026-10-29T09:30:00+08:00', timeZone: 'Asia/Manila', actor: 'acc-mara' });
    await evidence.setField({ issueKey: 'SEC-142', fieldKey: 'nature', value: 'Written by a person', actor: 'acc-mara' });
  });

  it('saves cited drafts for empty fields only, never touching what people wrote', async () => {
    let prompt = '';
    const model: LlmPort = {
      complete: async (_s, user) => {
        prompt = user;
        return JSON.stringify({
          fields: [
            { key: 'nature', value: 'Model rewrite', sources: ['S1'] },
            { key: 'dpoContact', value: 'Mara Lim, dpo@lumen.example', sources: ['S4'] },
            { key: 'peopleCount', value: 'About 1,200: 860 in the Philippines, 340 in Ireland.', sources: ['S2'] },
          ],
        });
      },
    };
    const result = await service.assemble({ issueKey: 'SEC-142', actor: 'acc-mara' }, { jira, confluence, graph, llm: model });
    expect(prompt).not.toContain('- nature:');
    expect(result.usedModel).toBe(true);
    expect(result.drafted.map((d) => d.key).sort()).toEqual(['dpoContact', 'peopleCount']);
    const board = await evidence.board('SEC-142');
    expect(board.fields.find((f) => f.key === 'nature')).toMatchObject({ state: 'filled', value: 'Written by a person' });
    const dpo = board.fields.find((f) => f.key === 'dpoContact');
    expect(dpo).toMatchObject({ state: 'draft', updatedBy: 'app:clerk' });
    expect(dpo?.sources[0]).toMatchObject({ kind: 'confluence', label: 'Breach playbook', url: 'https://x/wiki/7' });
  });

  it('still drafts known facts when the model is unavailable', async () => {
    await incidents.start({ issueKey: 'SEC-143', scope, awareAt: '2026-10-29T09:30:00+08:00', timeZone: 'Asia/Manila', actor: 'acc-mara' });
    const down: LlmPort = { complete: async () => { throw new Error('LLM offline'); } };
    const result = await service.assemble({ issueKey: 'SEC-143', actor: 'acc-mara' }, { jira, confluence, graph, llm: down });
    expect(result.usedModel).toBe(false);
    expect(result.note).toContain('could not be reached');
    // GDPR needs the nature of the breach; the incident description is a sourced fact the app already has.
    expect(result.drafted).toEqual([{ key: 'nature', label: 'Nature of the breach', sources: ['SEC-142'] }]);
  });
});
