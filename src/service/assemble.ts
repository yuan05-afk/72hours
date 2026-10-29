// Evidence assembly: gather what the organisation already wrote down (the incident, its comments and linked work,
// Confluence pages, and Teamwork Graph context), then let Claude (hosted by Atlassian) propose values for the notice
// fields that are still empty. Every proposal must cite the numbered sources it came from and is saved as a draft that
// a person accepts. The model never decides deadlines, never overwrites a value, and is ignored if its output does not
// validate.
import { DateTime } from 'luxon';
import { FIELDS, isFieldKey } from '../notice/fields';
import type { FieldKey } from '../notice/fields';
import type { GraphPort, IssueContext, LlmPort, UserConfluence, UserJiraContext } from '../jira/port';
import type { EvidenceSource } from '../store/types';
import type { EvidenceService } from './evidence';
import { IncidentError, IncidentService } from './incidents';

export interface ContextSource {
  id: string;
  kind: 'jira' | 'confluence' | 'graph';
  label: string;
  url?: string;
  text: string;
}

export interface Proposal {
  key: FieldKey;
  value: string;
  sourceIds: string[];
}

const MAX_SOURCE_CHARS = 2000;
const MAX_TOTAL_CHARS = 14000;
const MAX_VALUE = 1500;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

export const SYSTEM_PROMPT = [
  'You help a privacy team fill in a personal-data breach notice.',
  'Use ONLY the numbered sources you are given. For each requested field that the sources clearly state, write a',
  'short factual value (at most three sentences, plain language) and list the ids of the sources you used.',
  'If the sources do not state a field, leave it out. Never guess, never estimate numbers that are not in the sources,',
  'never state legal conclusions (whether to notify, which law applies), and never invent names, dates or systems.',
  'Reply with JSON only, no prose, in this exact shape:',
  '{"fields":[{"key":"<field key>","value":"<text>","sources":["S1"]}]}',
].join(' ');

/** The numbered source list, trimmed to a budget so the prompt stays small and fast. */
export function sourcesFrom(issue: IssueContext, pages: { title: string; url: string; excerpt: string }[], related: ContextSource[]): ContextSource[] {
  const sources: ContextSource[] = [];
  const add = (s: Omit<ContextSource, 'id'>) => {
    const text = s.text.trim();
    if (text) sources.push({ ...s, id: `S${sources.length + 1}`, text: text.slice(0, MAX_SOURCE_CHARS) });
  };
  add({ kind: 'jira', label: issue.key, text: `Incident ${issue.key}: ${issue.summary}\n${issue.description}` });
  for (const c of issue.comments.slice(-15)) add({ kind: 'jira', label: `${issue.key} comment by ${c.author}`, text: `${c.created}: ${c.text}` });
  if (issue.links.length) {
    add({ kind: 'jira', label: `Work linked to ${issue.key}`, text: issue.links.map((l) => `${l.key} (${l.status}): ${l.summary}`).join('\n') });
  }
  for (const p of pages) add({ kind: 'confluence', label: p.title, url: p.url, text: `${p.title}\n${p.excerpt}` });
  for (const r of related) add(r);
  let total = 0;
  return sources.filter((s) => (total += s.text.length) <= MAX_TOTAL_CHARS);
}

export function userPrompt(missing: FieldKey[], sources: ContextSource[]): string {
  const fields = missing.map((key) => `- ${key}: ${FIELDS[key].label}. ${FIELDS[key].prompt}`).join('\n');
  const list = sources.map((s) => `[${s.id}] (${s.kind}: ${s.label})\n${s.text}`).join('\n\n');
  return `Fields to fill:\n${fields}\n\nSources:\n${list}`;
}

/** Pure: keeps only well-formed proposals for requested fields that cite real sources. */
export function parseProposals(raw: string, allowed: Set<FieldKey>, sourceIds: Set<string>): Proposal[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const fields = (parsed as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  const seen = new Set<string>();
  const proposals: Proposal[] = [];
  for (const f of fields) {
    const { key, value, sources } = (f ?? {}) as { key?: unknown; value?: unknown; sources?: unknown };
    if (typeof key !== 'string' || !isFieldKey(key) || !allowed.has(key) || seen.has(key)) continue;
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_VALUE) continue;
    const cited = Array.isArray(sources) ? sources.filter((s): s is string => typeof s === 'string' && sourceIds.has(s)) : [];
    if (!cited.length) continue;
    seen.add(key);
    proposals.push({ key, value: value.trim(), sourceIds: [...new Set(cited)] });
  }
  return proposals;
}

/** Facts the app knows itself, used when no model is available: never invented, always sourced. */
export function fallbackProposals(issue: IssueContext, awareAt: string, timeZone: string, missing: Set<FieldKey>): { key: FieldKey; value: string }[] {
  const out: { key: FieldKey; value: string }[] = [];
  const when = (iso: string) => DateTime.fromISO(iso, { setZone: true }).setZone(timeZone).toFormat("d LLL yyyy, HH:mm '(" + timeZone + ")'");
  if (missing.has('nature') && issue.description) out.push({ key: 'nature', value: issue.description.slice(0, MAX_VALUE) });
  if (missing.has('chronology')) {
    out.push({ key: 'chronology', value: `Incident ${issue.key} opened ${when(issue.created)}. Awareness recorded as ${when(awareAt)}.` });
  }
  return out;
}

export interface AssembleResult {
  sources: ContextSource[];
  drafted: { key: FieldKey; label: string; sources: string[] }[];
  usedModel: boolean;
  note: string | null;
}

export class AssembleService {
  constructor(
    private incidents: IncidentService,
    private evidence: EvidenceService,
  ) {}

  /** Teamwork Graph context: what the people on this incident have been working on. Failures degrade to empty. */
  async related(issue: IssueContext, graph: GraphPort, extraPeople: string[] = []): Promise<{ accountId: string; items: Awaited<ReturnType<GraphPort['relatedWork']>> }[]> {
    const people = [...new Set([issue.assigneeAccountId, issue.reporterAccountId, ...extraPeople].filter((p): p is string => Boolean(p)))].slice(0, 4);
    const results = [];
    for (const accountId of people) {
      try {
        const items = (await graph.relatedWork(accountId)).filter((i) => i.key !== issue.key).slice(0, 6);
        results.push({ accountId, items });
      } catch (error) {
        console.warn('Teamwork Graph context unavailable', (error as Error).message);
        results.push({ accountId, items: [] });
      }
    }
    return results;
  }

  async assemble(
    input: { issueKey: string; actor: string },
    deps: { jira: UserJiraContext; confluence: UserConfluence; graph: GraphPort; llm: LlmPort | null },
  ): Promise<AssembleResult> {
    const view = await this.incidents.get(input.issueKey);
    if (!view) throw new IncidentError('NOT_FOUND', `No breach clock is running for ${input.issueKey}.`);
    if (view.incident.status === 'closed') throw new IncidentError('CLOSED', `${input.issueKey} is closed.`);
    const issue = await deps.jira.getIssueContext(input.issueKey);
    if (!issue) throw new IncidentError('NOT_FOUND', `You cannot see ${input.issueKey}.`);

    const board = await this.evidence.board(input.issueKey);
    const missing = board.fields.filter((f) => f.state === 'gap').map((f) => f.key);
    if (!missing.length) return { sources: [], drafted: [], usedModel: false, note: 'Every field already has a value or a draft.' };

    // Confluence: pages that mention the incident, and the org's breach playbook (DPO, contacts).
    const pages = [];
    for (const cql of [`type=page AND text ~ "${issue.key}"`, 'type=page AND (title ~ "breach" OR title ~ "playbook" OR label = "breach-playbook")']) {
      try {
        pages.push(...(await deps.confluence.searchPages(cql, 3)));
      } catch (error) {
        console.warn('Confluence search unavailable', (error as Error).message);
      }
    }
    const uniquePages = [...new Map(pages.map((p) => [p.id, p])).values()];
    const related = await this.related(issue, deps.graph);
    const graphSources: ContextSource[] = related
      .filter((r) => r.items.length)
      .map((r) => ({
        id: '',
        kind: 'graph' as const,
        label: 'Teamwork Graph: related work',
        text: r.items.map((i) => `${i.kind === 'jira' ? i.key : 'Page'}: ${i.title}`).join('\n'),
      }));
    const sources = sourcesFrom(issue, uniquePages, graphSources);
    const byId = new Map(sources.map((s) => [s.id, s]));
    const toEvidenceSource = (s: ContextSource): EvidenceSource => ({
      kind: s.kind,
      label: s.kind === 'jira' && ISSUE_KEY.test(s.label) ? s.label : s.label.slice(0, 200),
      ...(s.url ? { url: s.url } : {}),
    });

    let proposals: { key: FieldKey; value: string; sources: EvidenceSource[] }[] = [];
    let usedModel = false;
    let note: string | null = null;
    if (deps.llm) {
      try {
        const raw = await deps.llm.complete(SYSTEM_PROMPT, userPrompt(missing, sources));
        usedModel = true;
        proposals = parseProposals(raw, new Set(missing), new Set(byId.keys())).map((p) => ({
          key: p.key,
          value: p.value,
          sources: p.sourceIds.map((id) => toEvidenceSource(byId.get(id) as ContextSource)),
        }));
      } catch (error) {
        console.warn('Forge LLM unavailable, using deterministic drafts', (error as Error).message);
        note = 'Clerk could not be reached, so only facts the app knows itself were drafted.';
      }
    }
    if (!usedModel) {
      proposals = fallbackProposals(issue, view.incident.awareAt, view.incident.timeZone, new Set(missing)).map((p) => ({
        ...p,
        sources: [{ kind: 'jira', label: issue.key }],
      }));
    }

    const drafted: AssembleResult['drafted'] = [];
    // Re-read right before writing: a person may have filled a field while the model was working. Never overwrite.
    const stillMissing = new Set((await this.evidence.board(input.issueKey)).fields.filter((f) => f.state === 'gap').map((f) => f.key));
    for (const p of proposals) {
      if (!stillMissing.has(p.key)) continue;
      await this.evidence.setField({ issueKey: input.issueKey, fieldKey: p.key, value: p.value, sources: p.sources, actor: 'app:clerk', draft: true });
      drafted.push({ key: p.key, label: FIELDS[p.key].label, sources: p.sources.map((s) => s.label) });
    }
    return { sources, drafted, usedModel, note };
  }
}
