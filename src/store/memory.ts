// In-memory Store for tests and local reasoning. Mirrors the SQL store's semantics.
import type { AuditEntry, EvidenceRecord, IncidentRecord, NewQuestion, NoticeRecord, QuestionRecord, ReminderKey, Store } from './types';

const reminderId = (k: ReminderKey) => [k.issueKey, k.stageKey, k.threshold, k.dueAt].join('|');

export class MemoryStore implements Store {
  private incidents = new Map<string, IncidentRecord>();
  private audit: AuditEntry[] = [];
  private evidence = new Map<string, EvidenceRecord>();
  private questions: QuestionRecord[] = [];
  private reminders = new Set<string>();
  private notices = new Map<string, NoticeRecord>();
  private settings = new Map<string, string>();

  async getIncident(issueKey: string) {
    const found = this.incidents.get(issueKey);
    return found ? structuredClone(found) : null;
  }

  async insertIncident(incident: IncidentRecord) {
    if (this.incidents.has(incident.issueKey)) throw new Error(`duplicate incident ${incident.issueKey}`);
    this.incidents.set(incident.issueKey, structuredClone(incident));
  }

  async updateIncident(issueKey: string, changes: Partial<IncidentRecord>) {
    const current = this.incidents.get(issueKey);
    if (!current) throw new Error(`no incident ${issueKey}`);
    this.incidents.set(issueKey, { ...current, ...structuredClone(changes) });
  }

  async appendAudit(entry: AuditEntry) {
    this.audit.push(structuredClone(entry));
  }

  async listAudit(issueKey: string) {
    return this.audit.filter((e) => e.issueKey === issueKey).map((e) => structuredClone(e));
  }

  async listRunningIncidents() {
    return [...this.incidents.values()].filter((i) => i.status === 'running').map((i) => structuredClone(i));
  }

  async listEvidence(issueKey: string) {
    return [...this.evidence.values()].filter((e) => e.issueKey === issueKey).map((e) => structuredClone(e));
  }

  async getEvidence(issueKey: string, fieldKey: string) {
    const found = this.evidence.get(`${issueKey}|${fieldKey}`);
    return found ? structuredClone(found) : null;
  }

  async putEvidence(evidence: EvidenceRecord) {
    this.evidence.set(`${evidence.issueKey}|${evidence.fieldKey}`, structuredClone(evidence));
  }

  async listQuestions(issueKey: string) {
    return this.questions.filter((q) => q.issueKey === issueKey).map((q) => structuredClone(q));
  }

  async getQuestion(issueKey: string, id: number) {
    const found = this.questions.find((q) => q.id === id && q.issueKey === issueKey);
    return found ? structuredClone(found) : null;
  }

  async insertQuestion(question: NewQuestion) {
    const id = this.questions.length + 1;
    this.questions.push({ ...structuredClone(question), id });
    return id;
  }

  async updateQuestion(issueKey: string, id: number, changes: Partial<QuestionRecord>) {
    const index = this.questions.findIndex((q) => q.id === id && q.issueKey === issueKey);
    if (index < 0) throw new Error(`no question ${id} on ${issueKey}`);
    this.questions[index] = { ...this.questions[index], ...structuredClone(changes), id, issueKey };
  }

  async findQuestionsByTask(taskKey: string) {
    return this.questions.filter((q) => q.taskKey === taskKey).map((q) => structuredClone(q));
  }

  async claimReminder(key: ReminderKey) {
    const id = reminderId(key);
    if (this.reminders.has(id)) return false;
    this.reminders.add(id);
    return true;
  }

  async releaseReminder(key: ReminderKey) {
    this.reminders.delete(reminderId(key));
  }

  async listNotices(issueKey: string) {
    return [...this.notices.values()].filter((n) => n.issueKey === issueKey).map((n) => structuredClone(n));
  }

  async getNotice(issueKey: string, stageKey: string) {
    const found = this.notices.get(`${issueKey}|${stageKey}`);
    return found ? structuredClone(found) : null;
  }

  async putNotice(notice: NoticeRecord) {
    this.notices.set(`${notice.issueKey}|${notice.stageKey}`, structuredClone(notice));
  }

  async getSetting(name: string) {
    return this.settings.get(name) ?? null;
  }

  async setSetting(name: string, value: string | null) {
    if (value === null) this.settings.delete(name);
    else this.settings.set(name, value);
  }
}
