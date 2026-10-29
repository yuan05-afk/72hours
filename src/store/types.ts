// Storage contract for incidents and the audit trail. The service layer depends on this interface only, so it can be
// tested with an in-memory store and run in production on Forge SQL.
import type { IncidentScope } from '../rules';

export interface IncidentRecord {
  issueKey: string;
  /** Null while the incident is detected but not yet scoped; clocks start once the scoping check is answered. */
  scope: IncidentScope | null;
  /** ISO 8601 with offset, as entered; never re-serialised, so the original offset is kept for the audit trail. */
  awareAt: string;
  timeZone: string;
  materialityDeterminedAt: string | null;
  notifiableAssessmentAt: string | null;
  nis2NotificationSubmittedAt: string | null;
  status: 'detected' | 'running' | 'closed';
  /** drill: a practice run on sample data; no reminders, clearly labelled everywhere. */
  mode: 'real' | 'drill';
  closedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AuditEntry {
  issueKey: string;
  /** Atlassian account id of the person, or "app:<module>" for automated changes. */
  actor: string;
  action: string;
  /** JSON-serialisable details: old and new values, reasons. */
  detail: Record<string, unknown>;
  at: string;
}

export interface IncidentStore {
  getIncident(issueKey: string): Promise<IncidentRecord | null>;
  insertIncident(incident: IncidentRecord): Promise<void>;
  updateIncident(issueKey: string, changes: Partial<Omit<IncidentRecord, 'issueKey' | 'createdBy' | 'createdAt'>>): Promise<void>;
  /** Append-only: there is deliberately no update or delete for audit entries. */
  appendAudit(entry: AuditEntry): Promise<void>;
  listAudit(issueKey: string): Promise<AuditEntry[]>;
  /** Incidents whose clocks are running, for the reminder schedule. */
  listRunningIncidents(): Promise<IncidentRecord[]>;
}

/** Where a piece of evidence came from; shown as a chip that opens the source. */
export interface EvidenceSource {
  kind: 'jira' | 'confluence' | 'graph' | 'person' | 'question' | 'manual' | 'clerk';
  label: string;
  url?: string;
}

export interface EvidenceRecord {
  issueKey: string;
  fieldKey: string;
  value: string;
  sources: EvidenceSource[];
  /** draft: written by Clerk, a collector or an answered question; a person must accept it. */
  state: 'filled' | 'draft';
  updatedBy: string;
  updatedAt: string;
}

export interface QuestionRecord {
  id: number;
  issueKey: string;
  /** The notice field the answer fills, if any. */
  fieldKey: string | null;
  question: string;
  why: string | null;
  ownerAccountId: string | null;
  taskKey: string | null;
  taskDone: boolean;
  status: 'open' | 'answered' | 'dismissed';
  answer: string | null;
  createdBy: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export type NewQuestion = Omit<QuestionRecord, 'id'>;

export interface ReminderKey {
  issueKey: string;
  stageKey: string;
  threshold: '24h' | '6h' | 'overdue';
  /** Part of the key, so a corrected awareness time (a new deadline) gets its own reminders. */
  dueAt: string;
}

export interface EvidenceStore {
  listEvidence(issueKey: string): Promise<EvidenceRecord[]>;
  getEvidence(issueKey: string, fieldKey: string): Promise<EvidenceRecord | null>;
  putEvidence(evidence: EvidenceRecord): Promise<void>;
  listQuestions(issueKey: string): Promise<QuestionRecord[]>;
  getQuestion(issueKey: string, id: number): Promise<QuestionRecord | null>;
  insertQuestion(question: NewQuestion): Promise<number>;
  updateQuestion(issueKey: string, id: number, changes: Partial<Omit<QuestionRecord, 'id' | 'issueKey'>>): Promise<void>;
  findQuestionsByTask(taskKey: string): Promise<QuestionRecord[]>;
}

export interface ReminderStore {
  /** Records a reminder as claimed. Returns false when it was already claimed (sent or in flight). */
  claimReminder(key: ReminderKey, at: string): Promise<boolean>;
  /** Releases a claim whose comment could not be posted, so the next run retries it. */
  releaseReminder(key: ReminderKey): Promise<void>;
}

/** One regulator notice for one incident: drafted in Confluence, signed off by a person, then marked as filed. */
export interface NoticeRecord {
  issueKey: string;
  stageKey: string;
  status: 'draft' | 'ready' | 'filed';
  pageId: string | null;
  pageUrl: string | null;
  draftedBy: string | null;
  draftedAt: string | null;
  signedBy: string | null;
  signedAt: string | null;
  signNote: string | null;
  filedBy: string | null;
  filedAt: string | null;
  filedReference: string | null;
}

export interface NoticeStore {
  listNotices(issueKey: string): Promise<NoticeRecord[]>;
  getNotice(issueKey: string, stageKey: string): Promise<NoticeRecord | null>;
  putNotice(notice: NoticeRecord): Promise<void>;
}

/** Small installation-wide settings, e.g. the Confluence space for notice drafts. */
export interface SettingsStore {
  getSetting(name: string): Promise<string | null>;
  setSetting(name: string, value: string | null): Promise<void>;
}

export type Store = IncidentStore & EvidenceStore & ReminderStore & NoticeStore & SettingsStore;
