// Evidence and open questions: the facts each notice needs, where each came from, and who is finding the rest.
// Like IncidentService, every change is validated and written to the append-only audit trail.
import { FIELDS, isFieldKey, requirementFor } from '../notice/fields';
import type { FieldKey, Need } from '../notice/fields';
import type { Citation, Clock } from '../rules';
import type { UserJira } from '../jira/port';
import type { AuditEntry, EvidenceRecord, EvidenceSource, QuestionRecord, Store } from '../store/types';
import { IncidentError, IncidentService } from './incidents';

const MAX_VALUE = 4000;
const MAX_QUESTION = 500;
const MAX_SOURCES = 10;
const MAX_SUMMARY = 250;
const MIN_REASON = 5;
const SOURCE_KINDS: EvidenceSource['kind'][] = ['jira', 'confluence', 'graph', 'person', 'question', 'manual', 'clerk'];

export interface BoardField {
  key: FieldKey;
  label: string;
  prompt: string;
  state: 'filled' | 'draft' | 'gap';
  value: string | null;
  sources: EvidenceSource[];
  updatedBy: string | null;
  updatedAt: string | null;
  neededBy: { stageKey: string; regimeName: string; need: Need }[];
  /** A gap that a notice cannot go out without. */
  blocking: boolean;
}

export interface BoardNotice {
  stageKey: string;
  regimeName: string;
  action: string;
  dueAt: string | null;
  citation: Citation;
  lastVerified: string;
  required: number;
  /** Required fields filled and accepted by a person. */
  ready: number;
  /** Required fields still missing (drafts count as missing until accepted). */
  missing: FieldKey[];
}

export interface EvidenceBoard {
  scoped: boolean;
  fields: BoardField[];
  notices: BoardNotice[];
  questions: QuestionRecord[];
}

/** Pure: lays out every field the incident's notices need, with what is known so far. */
export function buildBoard(clocks: Clock[], evidence: EvidenceRecord[], questions: QuestionRecord[], scoped: boolean): EvidenceBoard {
  const byField = new Map(evidence.map((e) => [e.fieldKey, e]));
  const neededBy = new Map<FieldKey, BoardField['neededBy']>();
  const notices: BoardNotice[] = [];

  for (const clock of clocks) {
    const requirement = requirementFor(clock.stageKey);
    if (!requirement) continue;
    const required: FieldKey[] = [];
    for (const [key, need] of Object.entries(requirement.fields) as [FieldKey, Need][]) {
      neededBy.set(key, [...(neededBy.get(key) ?? []), { stageKey: clock.stageKey, regimeName: clock.regimeName, need }]);
      if (need === 'required') required.push(key);
    }
    const missing = required.filter((key) => byField.get(key)?.state !== 'filled');
    notices.push({
      stageKey: clock.stageKey,
      regimeName: clock.regimeName,
      action: clock.action,
      dueAt: clock.dueAt,
      citation: requirement.citation,
      lastVerified: requirement.lastVerified,
      required: required.length,
      ready: required.length - missing.length,
      missing,
    });
  }

  const fields: BoardField[] = (Object.keys(FIELDS) as FieldKey[])
    .filter((key) => neededBy.has(key) || byField.has(key))
    .map((key) => {
      const known = byField.get(key);
      const needs = neededBy.get(key) ?? [];
      const state = known ? known.state : 'gap';
      return {
        key,
        label: FIELDS[key].label,
        prompt: FIELDS[key].prompt,
        state,
        value: known?.value ?? null,
        sources: known?.sources ?? [],
        updatedBy: known?.updatedBy ?? null,
        updatedAt: known?.updatedAt ?? null,
        neededBy: needs,
        blocking: state === 'gap' && needs.some((n) => n.need === 'required'),
      };
    });

  return { scoped, fields, notices, questions };
}

function requireText(value: unknown, what: string, max: number, min = 1): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min) throw new IncidentError('INVALID_INPUT', `${what} is required.`);
  if (text.length > max) throw new IncidentError('INVALID_INPUT', `${what} is too long (at most ${max} characters).`);
  return text;
}

function requireField(fieldKey: unknown): FieldKey {
  if (typeof fieldKey !== 'string' || !isFieldKey(fieldKey)) {
    throw new IncidentError('INVALID_INPUT', `Unknown notice field ${String(fieldKey)}.`);
  }
  return fieldKey;
}

/** Sources are shown as links, so only https URLs are kept; anything else is rejected rather than rendered. */
function requireSources(sources: unknown): EvidenceSource[] {
  if (sources === undefined) return [];
  if (!Array.isArray(sources) || sources.length > MAX_SOURCES) {
    throw new IncidentError('INVALID_INPUT', `Give up to ${MAX_SOURCES} sources.`);
  }
  return sources.map((s) => {
    const source = s as Partial<EvidenceSource>;
    if (!source || !SOURCE_KINDS.includes(source.kind as EvidenceSource['kind'])) {
      throw new IncidentError('INVALID_INPUT', 'Each source needs a known kind.');
    }
    const label = requireText(source.label, 'A source label', 200);
    if (source.url !== undefined && !/^https:\/\/[^\s]+$/.test(source.url)) {
      throw new IncidentError('INVALID_INPUT', 'Source links must be https URLs.');
    }
    return { kind: source.kind as EvidenceSource['kind'], label, ...(source.url ? { url: source.url } : {}) };
  });
}

export class EvidenceService {
  constructor(
    private store: Store,
    private incidents: IncidentService,
    private now: () => Date = () => new Date(),
  ) {}

  private async audit(issueKey: string, actor: string, action: string, detail: AuditEntry['detail']) {
    await this.store.appendAudit({ issueKey, actor, action, detail, at: this.now().toISOString() });
  }

  /** The incident must exist and still be open for evidence and questions to change. */
  private async requireOpen(issueKey: string) {
    const view = await this.incidents.get(issueKey);
    if (!view) throw new IncidentError('NOT_FOUND', `No breach clock is running for ${issueKey}.`);
    if (view.incident.status === 'closed') throw new IncidentError('CLOSED', `${issueKey} is closed.`);
    return view;
  }

  private async requireQuestion(issueKey: string, id: unknown, mustBeOpen = true) {
    const questionId = Number(id);
    if (!Number.isInteger(questionId) || questionId < 1) throw new IncidentError('INVALID_INPUT', 'Unknown question.');
    const question = await this.store.getQuestion(issueKey, questionId);
    if (!question) throw new IncidentError('NOT_FOUND', `Question ${questionId} is not on ${issueKey}.`);
    if (mustBeOpen && question.status !== 'open') {
      throw new IncidentError('CONFLICT', 'This question is already answered or dismissed.');
    }
    return question;
  }

  async board(issueKey: string): Promise<EvidenceBoard> {
    const view = await this.incidents.get(issueKey);
    if (!view) throw new IncidentError('NOT_FOUND', `No breach clock is running for ${issueKey}.`);
    const [evidence, questions] = await Promise.all([this.store.listEvidence(issueKey), this.store.listQuestions(issueKey)]);
    return buildBoard(view.clocks, evidence, questions, view.incident.scope !== null);
  }

  /** People fill fields directly; Clerk, collectors and answered questions write drafts that a person accepts. */
  async setField(input: {
    issueKey: string;
    fieldKey: unknown;
    value: unknown;
    sources?: unknown;
    actor: string;
    draft?: boolean;
  }): Promise<EvidenceRecord> {
    const fieldKey = requireField(input.fieldKey);
    const value = requireText(input.value, FIELDS[fieldKey].label, MAX_VALUE);
    const sources = requireSources(input.sources);
    await this.requireOpen(input.issueKey);
    const previous = await this.store.getEvidence(input.issueKey, fieldKey);
    const record: EvidenceRecord = {
      issueKey: input.issueKey,
      fieldKey,
      value,
      sources,
      state: input.draft ? 'draft' : 'filled',
      updatedBy: input.actor,
      updatedAt: this.now().toISOString(),
    };
    await this.store.putEvidence(record);
    await this.audit(input.issueKey, input.actor, 'evidence.set', {
      field: fieldKey,
      from: previous ? { value: previous.value, state: previous.state } : null,
      to: { value, state: record.state },
      sources,
    });
    return record;
  }

  async acceptDraft(input: { issueKey: string; fieldKey: unknown; actor: string }): Promise<EvidenceRecord> {
    const fieldKey = requireField(input.fieldKey);
    await this.requireOpen(input.issueKey);
    const draft = await this.store.getEvidence(input.issueKey, fieldKey);
    if (!draft || draft.state !== 'draft') throw new IncidentError('CONFLICT', `${FIELDS[fieldKey].label} has no draft to accept.`);
    const accepted: EvidenceRecord = { ...draft, state: 'filled', updatedBy: input.actor, updatedAt: this.now().toISOString() };
    await this.store.putEvidence(accepted);
    await this.audit(input.issueKey, input.actor, 'evidence.accepted', { field: fieldKey, draftBy: draft.updatedBy, value: draft.value });
    return accepted;
  }

  async askQuestion(input: {
    issueKey: string;
    question: unknown;
    why?: unknown;
    fieldKey?: unknown;
    ownerAccountId?: unknown;
    actor: string;
  }): Promise<QuestionRecord> {
    const question = requireText(input.question, 'The question', MAX_QUESTION, 3);
    const why = input.why === undefined || input.why === null || input.why === '' ? null : requireText(input.why, 'The reason', MAX_QUESTION);
    const fieldKey = input.fieldKey === undefined || input.fieldKey === null ? null : requireField(input.fieldKey);
    const ownerAccountId = typeof input.ownerAccountId === 'string' && input.ownerAccountId ? input.ownerAccountId : null;
    await this.requireOpen(input.issueKey);
    const record = {
      issueKey: input.issueKey,
      fieldKey,
      question,
      why,
      ownerAccountId,
      taskKey: null,
      taskDone: false,
      status: 'open' as const,
      answer: null,
      createdBy: input.actor,
      createdAt: this.now().toISOString(),
      resolvedBy: null,
      resolvedAt: null,
    };
    const id = await this.store.insertQuestion(record);
    await this.audit(input.issueKey, input.actor, 'question.asked', { id, question, why, field: fieldKey, owner: ownerAccountId });
    return { ...record, id };
  }

  async assignQuestion(input: { issueKey: string; id: unknown; ownerAccountId: unknown; actor: string }): Promise<QuestionRecord> {
    if (typeof input.ownerAccountId !== 'string' || !input.ownerAccountId) {
      throw new IncidentError('INVALID_INPUT', 'Choose a person to ask.');
    }
    await this.requireOpen(input.issueKey);
    const question = await this.requireQuestion(input.issueKey, input.id);
    await this.store.updateQuestion(input.issueKey, question.id, { ownerAccountId: input.ownerAccountId });
    await this.audit(input.issueKey, input.actor, 'question.assigned', { id: question.id, from: question.ownerAccountId, to: input.ownerAccountId });
    return { ...question, ownerAccountId: input.ownerAccountId };
  }

  /**
   * Records the answer. If the question belongs to a field that is still empty or a draft, the answer becomes that
   * field's draft for a person to accept; an accepted value is never overwritten by an answer.
   */
  async answerQuestion(input: { issueKey: string; id: unknown; answer: unknown; actor: string }): Promise<{
    question: QuestionRecord;
    fieldDrafted: boolean;
  }> {
    const answer = requireText(input.answer, 'The answer', MAX_VALUE);
    await this.requireOpen(input.issueKey);
    const question = await this.requireQuestion(input.issueKey, input.id);
    const at = this.now().toISOString();
    const changes = { status: 'answered' as const, answer, resolvedBy: input.actor, resolvedAt: at };
    await this.store.updateQuestion(input.issueKey, question.id, changes);
    await this.audit(input.issueKey, input.actor, 'question.answered', { id: question.id, answer });

    let fieldDrafted = false;
    if (question.fieldKey && isFieldKey(question.fieldKey)) {
      const current = await this.store.getEvidence(input.issueKey, question.fieldKey);
      if (!current || current.state === 'draft') {
        await this.setField({
          issueKey: input.issueKey,
          fieldKey: question.fieldKey,
          value: answer,
          sources: [{ kind: 'question', label: question.taskKey ? `Answer on ${question.taskKey}` : `Answer to: ${question.question.slice(0, 150)}` }],
          actor: input.actor,
          draft: true,
        });
        fieldDrafted = true;
      }
    }
    return { question: { ...question, ...changes }, fieldDrafted };
  }

  async dismissQuestion(input: { issueKey: string; id: unknown; reason: unknown; actor: string }): Promise<QuestionRecord> {
    const reason = requireText(input.reason, 'A reason', MAX_QUESTION, MIN_REASON);
    await this.requireOpen(input.issueKey);
    const question = await this.requireQuestion(input.issueKey, input.id);
    const changes = { status: 'dismissed' as const, answer: reason, resolvedBy: input.actor, resolvedAt: this.now().toISOString() };
    await this.store.updateQuestion(input.issueKey, question.id, changes);
    await this.audit(input.issueKey, input.actor, 'question.dismissed', { id: question.id, reason });
    return { ...question, ...changes };
  }

  /** Turns an open question into a Jira task for its owner, created as the signed-in user. */
  async createTask(input: { issueKey: string; id: unknown; actor: string }, jira: UserJira): Promise<QuestionRecord> {
    await this.requireOpen(input.issueKey);
    const question = await this.requireQuestion(input.issueKey, input.id);
    if (question.taskKey) throw new IncidentError('CONFLICT', `This question already has task ${question.taskKey}.`);
    const summary = `Breach notice for ${input.issueKey}: ${question.question}`;
    const description = [
      question.question,
      question.why ? `Context: ${question.why}` : null,
      `The answer goes into the regulator notice for ${input.issueKey}, so please be precise and say how you know. ` +
        `Answer in a comment here, then mark this task Done: your answer goes back to ${input.issueKey} as a draft for review.`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const { key, linked } = await jira.createTask({
      incidentKey: input.issueKey,
      summary: summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY - 1)}…` : summary,
      description,
      assigneeAccountId: question.ownerAccountId,
    });
    await this.store.updateQuestion(input.issueKey, question.id, { taskKey: key });
    await this.audit(input.issueKey, input.actor, 'question.taskCreated', { id: question.id, taskKey: key, linked, owner: question.ownerAccountId });
    return { ...question, taskKey: key };
  }

  /**
   * Called when a task is resolved in Jira. The task asks its owner to answer in a comment, so the newest comment by a
   * person becomes the answer: recorded as theirs and drafted into the question's field for review, like an answer
   * typed in the panel. With no usable comment, the question is flagged so someone records the answer.
   * `latestAnswer` is only called when the task has open questions, so other Done issues cost no Jira call.
   */
  async taskDone(
    taskKey: string,
    actor: string,
    latestAnswer: () => Promise<{ text: string; authorAccountId: string } | null> = async () => null,
  ): Promise<number> {
    const questions = (await this.store.findQuestionsByTask(taskKey)).filter((q) => q.status === 'open' && !q.taskDone);
    if (!questions.length) return 0;
    const answer = await latestAnswer().catch(() => null);
    for (const question of questions) {
      await this.audit(question.issueKey, actor, 'question.taskDone', { id: question.id, taskKey });
      if (answer) {
        try {
          await this.answerQuestion({ issueKey: question.issueKey, id: question.id, answer: answer.text, actor: answer.authorAccountId });
          continue;
        } catch (e) {
          // A closed incident or an over-long comment: fall back to asking someone to record the answer.
          if (!(e instanceof IncidentError)) throw e;
        }
      }
      await this.store.updateQuestion(question.issueKey, question.id, { taskDone: true });
    }
    return questions.length;
  }
}
