// Breach drills and the post-incident summary.
// A drill runs the real flow on sample data (mode "drill": labelled everywhere, never reminded), so a team can rehearse
// and a first-time visitor sees every part of the app on an empty site. The summary turns the audit trail into a
// review: when each notice was ready and filed against its deadline, and which questions slowed the team down.
import type { IncidentScope } from '../rules';
import type { AuditEntry, NoticeRecord } from '../store/types';
import type { EvidenceBoard, EvidenceService } from './evidence';
import { IncidentError, IncidentService } from './incidents';
import type { IncidentView } from './incidents';

export const DRILL_SCOPE: IncidentScope = {
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

const SAMPLE = { kind: 'manual' as const, label: 'Sample data (drill)' };
const DRILL_HEAD_START_HOURS = 2;

/** Sample facts: some accepted, some drafted for review, the rest left as gaps for the team to find. */
const SAMPLE_FIELDS: { key: string; value: string; draft: boolean }[] = [
  { key: 'nature', value: 'An export job ran under a leaked service-account key and copied invoice files to an outside storage bucket.', draft: false },
  { key: 'peopleCount', value: 'About 1,200 patients: 860 in the Philippines, 340 in Ireland.', draft: false },
  { key: 'recordCategories', value: 'Invoices with names, billing addresses, health insurance numbers and diagnosis codes.', draft: false },
  { key: 'consequences', value: 'Risk of identity fraud from insurance numbers, and disclosure of health conditions.', draft: true },
  { key: 'measures', value: 'Service-account key revoked, bucket access blocked, export job disabled.', draft: true },
];

const SAMPLE_QUESTIONS = [
  { question: 'Were the nightly backups stored in the same bucket?', why: 'Decides whether more people are affected', fieldKey: 'peopleCount' },
  { question: 'When was the leaked key first used?', why: 'Needed for the timeline in the NPC notice', fieldKey: 'chronology' },
  { question: 'Who is the DPO contact for the notices?', why: 'Every notice must name a contact point', fieldKey: 'dpoContact' },
];

export async function startDrill(
  deps: { incidents: IncidentService; evidence: EvidenceService; now: () => Date },
  input: { issueKey: string; actor: string; timeZone: string },
): Promise<IncidentView> {
  if (await deps.incidents.get(input.issueKey)) {
    throw new IncidentError('ALREADY_RUNNING', `${input.issueKey} already has a breach clock. Try the drill on another issue.`);
  }
  const awareAt = new Date(deps.now().getTime() - DRILL_HEAD_START_HOURS * 3_600_000).toISOString();
  const view = await deps.incidents.start({
    issueKey: input.issueKey,
    scope: DRILL_SCOPE,
    awareAt,
    timeZone: input.timeZone,
    actor: input.actor,
    mode: 'drill',
  });
  for (const field of SAMPLE_FIELDS) {
    await deps.evidence.setField({
      issueKey: input.issueKey,
      fieldKey: field.key,
      value: field.value,
      sources: [SAMPLE],
      actor: field.draft ? 'app:clerk' : input.actor,
      draft: field.draft,
    });
  }
  for (const q of SAMPLE_QUESTIONS) {
    await deps.evidence.askQuestion({ issueKey: input.issueKey, ...q, actor: input.actor });
  }
  return view;
}

export interface NoticeOutcome {
  stageKey: string;
  regimeName: string;
  action: string;
  dueAt: string | null;
  signedAt: string | null;
  filedAt: string | null;
  /** Hours filed before (positive) or after (negative) the deadline; null when not filed or no fixed deadline. */
  marginHours: number | null;
}

export interface Summary {
  mode: 'real' | 'drill';
  awareAt: string;
  startedAt: string;
  closedAt: string | null;
  requiredReady: number;
  requiredTotal: number;
  notices: NoticeOutcome[];
  questionsAsked: number;
  questionsAnswered: number;
  tasksCreated: number;
  /** The open questions that were still open at the end: what slowed the team. */
  stillOpen: string[];
  /** Simple readiness score out of 100 for drills: half evidence, half notices signed on time. */
  score: number;
}

/** Pure: the review of an incident or drill, from its current state and audit trail. */
export function summarize(view: IncidentView, board: EvidenceBoard, notices: NoticeRecord[], audit: AuditEntry[]): Summary {
  const required = board.fields.filter((f) => f.neededBy.some((n) => n.need === 'required'));
  const requiredReady = required.filter((f) => f.state === 'filled').length;
  const byStage = new Map(notices.map((n) => [n.stageKey, n]));
  const outcomes: NoticeOutcome[] = view.clocks
    .filter((c) => c.dueAt)
    .map((c) => {
      const n = byStage.get(c.stageKey);
      const filedAt = n?.filedAt ?? null;
      return {
        stageKey: c.stageKey,
        regimeName: c.regimeName,
        action: c.action,
        dueAt: c.dueAt,
        signedAt: n?.signedAt ?? null,
        filedAt,
        marginHours: filedAt && c.dueAt ? Math.round(((Date.parse(c.dueAt) - Date.parse(filedAt)) / 3_600_000) * 10) / 10 : null,
      };
    });
  const started = audit.find((a) => a.action === 'clock.started' || a.action === 'drill.started');
  const signedOnTime = outcomes.filter((o) => o.signedAt && o.dueAt && Date.parse(o.signedAt) <= Date.parse(o.dueAt)).length;
  const evidenceScore = required.length ? requiredReady / required.length : 0;
  const noticeScore = outcomes.length ? signedOnTime / outcomes.length : 0;
  return {
    mode: view.incident.mode,
    awareAt: view.incident.awareAt,
    startedAt: started?.at ?? view.incident.createdAt,
    closedAt: view.incident.closedAt,
    requiredReady,
    requiredTotal: required.length,
    notices: outcomes,
    questionsAsked: board.questions.length,
    questionsAnswered: board.questions.filter((q) => q.status === 'answered').length,
    tasksCreated: board.questions.filter((q) => q.taskKey).length,
    stillOpen: board.questions.filter((q) => q.status === 'open').map((q) => q.question),
    score: Math.round((evidenceScore * 50 + noticeScore * 50)),
  };
}
