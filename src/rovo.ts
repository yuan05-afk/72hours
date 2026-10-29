// Rovo actions for the Clerk agent, also exposed as MCP tools. Each action authorises the caller by reading the issue
// as that user (Rovo inputs are model-extracted and never trusted for authorisation), then reuses the same services
// as the panel, so the agent can never do anything the panel would not allow.
import { DateTime } from 'luxon';
import { FIELDS } from './notice/fields';
import type { UserJiraContext } from './jira/port';
import type { AssembleService } from './service/assemble';
import type { EvidenceService } from './service/evidence';
import { IncidentError } from './service/incidents';
import type { IncidentService } from './service/incidents';
import type { NoticeService } from './service/notices';
import type { Deps as AssembleDeps } from './rovo-deps';
import type { Store } from './store/types';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

export interface RovoPayload {
  issueKey?: string;
  question?: string;
  field?: string;
  notice?: string;
  context?: { jira?: { issueKey?: string } };
}

export interface RovoContext {
  principal?: { accountId?: string };
}

export interface RovoServices {
  store: Store;
  incidents: IncidentService;
  evidence: EvidenceService;
  notices: NoticeService;
  assemble: AssembleService;
  jira: UserJiraContext;
  assembleDeps: AssembleDeps;
}

const when = (iso: string, zone: string) => DateTime.fromISO(iso, { setZone: true }).setZone(zone).toFormat("ccc d LLL, HH:mm '(" + zone + ")'");

/** The issue from the input if it looks like a key, else from the page the user is on. */
function issueKeyFrom(payload: RovoPayload): string | null {
  const typed = payload.issueKey?.trim().toUpperCase();
  if (typed && ISSUE_KEY.test(typed)) return typed;
  const fromContext = String(payload.context?.jira?.issueKey ?? '').toUpperCase();
  return ISSUE_KEY.test(fromContext) ? fromContext : null;
}

async function authorised(s: RovoServices, payload: RovoPayload): Promise<string> {
  const key = issueKeyFrom(payload);
  if (!key) throw new IncidentError('INVALID_INPUT', 'Which incident? Give its Jira key, for example SEC-142.');
  if (!(await s.jira.canView(key))) throw new IncidentError('NOT_FOUND', `${key} does not exist or you cannot see it.`);
  return key;
}

/** Errors become plain sentences the agent can relay; nothing internal leaks. */
async function answer(work: () => Promise<string>): Promise<string> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof IncidentError) return error.message;
    console.error('Rovo action failed', error);
    return 'Something went wrong in 72 Hours. Open the 72 Hours panel on the issue, or check the app logs.';
  }
}

export function status(s: RovoServices, payload: RovoPayload) {
  return answer(async () => {
    const key = await authorised(s, payload);
    const view = await s.incidents.get(key);
    if (!view) return `${key} has no breach clock. Start one from the 72 Hours panel on the issue if personal data may be involved.`;
    const { incident, clocks } = view;
    const zone = incident.timeZone;
    const lines = [
      `${key}${incident.mode === 'drill' ? ' (DRILL, practice only)' : ''}: ${incident.status === 'detected' ? 'flagged, not yet scoped' : incident.status}.`,
      `Awareness: ${when(incident.awareAt, zone)}.`,
    ];
    if (!incident.scope) {
      lines.push('Deadlines appear once someone answers the scoping questions in the 72 Hours panel.');
      return lines.join('\n');
    }
    const notices = await s.notices.list(key);
    lines.push('Notification deadlines (calculated by the rulebook from the cited law):');
    for (const n of notices) {
      const due = n.dueAt ? `due ${when(n.dueAt, zone)}` : 'no fixed deadline';
      const state = n.status === 'none' ? 'not drafted' : n.status === 'draft' ? 'drafted' : n.status === 'ready' ? 'signed off, ready to file' : 'filed';
      const gaps = n.missing.length ? `; missing: ${n.missing.map((k) => FIELDS[k].label).join(', ')}` : '';
      lines.push(`- ${n.action} (${n.regimeName}, ${n.citationLabel}): ${due}; ${state}${gaps}.`);
    }
    const board = await s.evidence.board(key);
    const open = board.questions.filter((q) => q.status === 'open');
    if (open.length) lines.push(`Open questions: ${open.map((q) => q.question + (q.taskKey ? ` (${q.taskKey})` : '')).join('; ')}.`);
    lines.push(`Clocks: ${clocks.length}. The DPO decides; this is not legal advice.`);
    return lines.join('\n');
  });
}

export function listIncidents(s: RovoServices) {
  return answer(async () => {
    const running = await s.store.listRunningIncidents();
    const visible = [];
    for (const incident of running.slice(0, 25)) {
      if (await s.jira.canView(incident.issueKey)) visible.push(incident);
    }
    if (!visible.length) return 'No breach clocks are running on incidents you can see.';
    const lines = [];
    for (const incident of visible) {
      const view = await s.incidents.get(incident.issueKey);
      const next = view?.clocks.filter((c) => c.dueAt).sort((a, b) => (a.dueAt as string).localeCompare(b.dueAt as string))[0];
      lines.push(
        `- ${incident.issueKey}${incident.mode === 'drill' ? ' (drill)' : ''}: ${
          next ? `next deadline ${next.action} (${next.regimeName}) ${when(next.dueAt as string, incident.timeZone)}` : 'no fixed deadline'
        }.`,
      );
    }
    return `Running breach clocks:\n${lines.join('\n')}`;
  });
}

export function askQuestion(s: RovoServices, payload: RovoPayload, context: RovoContext) {
  return answer(async () => {
    const key = await authorised(s, payload);
    const actor = context.principal?.accountId;
    if (!actor) throw new IncidentError('INVALID_INPUT', 'No signed-in user.');
    const fieldKey = payload.field && payload.field in FIELDS ? payload.field : null;
    const q = await s.evidence.askQuestion({ issueKey: key, question: payload.question, fieldKey, actor });
    return `Added the open question to ${key}: "${q.question}". Assign it or turn it into a Jira task from the 72 Hours panel.`;
  });
}

/** Finds the notice the user means: a stage key, a regulator name ("GDPR", "NPC") or words from its action. */
export function matchNotice<T extends { stageKey: string; regimeName: string; action: string; citationLabel: string }>(notices: T[], query: string | undefined): T | null {
  if (!notices.length) return null;
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return notices[0];
  return (
    notices.find((n) => n.stageKey === q) ??
    notices.find((n) => `${n.regimeName} ${n.citationLabel}`.toLowerCase().includes(q)) ??
    notices.find((n) => n.action.toLowerCase().includes(q)) ??
    null
  );
}

export function draftNotice(s: RovoServices, payload: RovoPayload) {
  return answer(async () => {
    const key = await authorised(s, payload);
    const notices = await s.notices.list(key);
    if (!notices.length) return `${key} has no scoped breach clock, so there is no notice to draft yet.`;
    const notice = matchNotice(notices, payload.notice);
    if (!notice) return `No notice on ${key} matches "${payload.notice}". Options: ${notices.map((n) => `${n.regimeName}: ${n.action}`).join('; ')}.`;
    const composed = await s.notices.compose(key, notice.stageKey);
    return composed.text;
  });
}

export function assembleEvidence(s: RovoServices, payload: RovoPayload, context: RovoContext) {
  return answer(async () => {
    const key = await authorised(s, payload);
    const actor = context.principal?.accountId;
    if (!actor) throw new IncidentError('INVALID_INPUT', 'No signed-in user.');
    const result = await s.assemble.assemble({ issueKey: key, actor }, s.assembleDeps);
    if (!result.drafted.length) return result.note ?? `Nothing new to draft for ${key}: the sources did not state any missing field.`;
    return [
      `Drafted ${result.drafted.length} field${result.drafted.length === 1 ? '' : 's'} on ${key} for review (a person must accept each one):`,
      ...result.drafted.map((d) => `- ${d.label} (from ${d.sources.join(', ')})`),
      result.note ?? '',
    ]
      .filter(Boolean)
      .join('\n');
  });
}
