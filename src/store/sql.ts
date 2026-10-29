// Forge SQL implementation of the Store. Timestamps are stored as the ISO strings the user entered (VARCHAR), so
// offsets survive unchanged; the rules engine does all date maths.
import { migrationRunner, sql } from '@forge/sql';
import type { UpdateQueryResponse } from '@forge/sql';
import type { AuditEntry, EvidenceRecord, IncidentRecord, NewQuestion, NoticeRecord, QuestionRecord, ReminderKey, Store } from './types';

const migrations = migrationRunner
  .enqueue(
    'v001_create_incidents',
    `CREATE TABLE IF NOT EXISTS incidents (
      issue_key VARCHAR(64) PRIMARY KEY,
      scope_json TEXT NOT NULL,
      aware_at VARCHAR(40) NOT NULL,
      time_zone VARCHAR(64) NOT NULL,
      materiality_at VARCHAR(40) NULL,
      assessment_at VARCHAR(40) NULL,
      nis2_submitted_at VARCHAR(40) NULL,
      status VARCHAR(16) NOT NULL,
      created_by VARCHAR(128) NOT NULL,
      created_at VARCHAR(40) NOT NULL
    )`,
  )
  .enqueue(
    'v002_create_audit_log',
    `CREATE TABLE IF NOT EXISTS audit_log (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      issue_key VARCHAR(64) NOT NULL,
      actor VARCHAR(128) NOT NULL,
      action VARCHAR(64) NOT NULL,
      detail_json TEXT NOT NULL,
      at VARCHAR(40) NOT NULL,
      INDEX idx_audit_issue (issue_key, id)
    )`,
  )
  .enqueue(
    'v003_create_evidence',
    `CREATE TABLE IF NOT EXISTS evidence (
      issue_key VARCHAR(64) NOT NULL,
      field_key VARCHAR(64) NOT NULL,
      value_text TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      state VARCHAR(16) NOT NULL,
      updated_by VARCHAR(128) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      PRIMARY KEY (issue_key, field_key)
    )`,
  )
  .enqueue(
    'v004_create_questions',
    `CREATE TABLE IF NOT EXISTS questions (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      issue_key VARCHAR(64) NOT NULL,
      field_key VARCHAR(64) NULL,
      question TEXT NOT NULL,
      why TEXT NULL,
      owner_account_id VARCHAR(128) NULL,
      task_key VARCHAR(64) NULL,
      task_done TINYINT NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL,
      answer TEXT NULL,
      created_by VARCHAR(128) NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      resolved_by VARCHAR(128) NULL,
      resolved_at VARCHAR(40) NULL,
      INDEX idx_questions_issue (issue_key, id),
      INDEX idx_questions_task (task_key)
    )`,
  )
  .enqueue(
    'v005_create_reminders',
    `CREATE TABLE IF NOT EXISTS reminders (
      issue_key VARCHAR(64) NOT NULL,
      stage_key VARCHAR(64) NOT NULL,
      threshold VARCHAR(16) NOT NULL,
      due_at VARCHAR(40) NOT NULL,
      claimed_at VARCHAR(40) NOT NULL,
      PRIMARY KEY (issue_key, stage_key, threshold, due_at)
    )`,
  )
  .enqueue('v006_index_incident_status', 'CREATE INDEX idx_incidents_status ON incidents (status)')
  .enqueue('v007_incident_mode', "ALTER TABLE incidents ADD COLUMN mode VARCHAR(16) NOT NULL DEFAULT 'real'")
  .enqueue('v008_incident_closed_at', 'ALTER TABLE incidents ADD COLUMN closed_at VARCHAR(40) NULL')
  .enqueue(
    'v009_create_notices',
    `CREATE TABLE IF NOT EXISTS notices (
      issue_key VARCHAR(64) NOT NULL,
      stage_key VARCHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL,
      page_id VARCHAR(64) NULL,
      page_url TEXT NULL,
      drafted_by VARCHAR(128) NULL,
      drafted_at VARCHAR(40) NULL,
      signed_by VARCHAR(128) NULL,
      signed_at VARCHAR(40) NULL,
      sign_note TEXT NULL,
      filed_by VARCHAR(128) NULL,
      filed_at VARCHAR(40) NULL,
      filed_reference TEXT NULL,
      PRIMARY KEY (issue_key, stage_key)
    )`,
  )
  .enqueue(
    'v010_create_settings',
    `CREATE TABLE IF NOT EXISTS settings (
      name VARCHAR(64) PRIMARY KEY,
      value_text TEXT NULL
    )`,
  );

let schemaReady: Promise<unknown> | null = null;

/** Applies pending migrations once per function instance. Idempotent: migrationRunner skips applied operations. */
export function ensureSchema() {
  schemaReady ??= migrations.run().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

interface IncidentRow {
  issue_key: string;
  scope_json: string;
  aware_at: string;
  time_zone: string;
  materiality_at: string | null;
  assessment_at: string | null;
  nis2_submitted_at: string | null;
  status: IncidentRecord['status'];
  mode: IncidentRecord['mode'] | null;
  closed_at: string | null;
  created_by: string;
  created_at: string;
}

const COLUMNS: Record<keyof Omit<IncidentRecord, 'issueKey' | 'createdBy' | 'createdAt'>, string> = {
  scope: 'scope_json',
  awareAt: 'aware_at',
  timeZone: 'time_zone',
  materialityDeterminedAt: 'materiality_at',
  notifiableAssessmentAt: 'assessment_at',
  nis2NotificationSubmittedAt: 'nis2_submitted_at',
  status: 'status',
  mode: 'mode',
  closedAt: 'closed_at',
};

const toRecord = (row: IncidentRow): IncidentRecord => ({
  issueKey: row.issue_key,
  scope: JSON.parse(row.scope_json),
  awareAt: row.aware_at,
  timeZone: row.time_zone,
  materialityDeterminedAt: row.materiality_at,
  notifiableAssessmentAt: row.assessment_at,
  nis2NotificationSubmittedAt: row.nis2_submitted_at,
  status: row.status,
  mode: row.mode ?? 'real',
  closedAt: row.closed_at ?? null,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

interface EvidenceRow {
  issue_key: string;
  field_key: string;
  value_text: string;
  sources_json: string;
  state: EvidenceRecord['state'];
  updated_by: string;
  updated_at: string;
}

const toEvidence = (row: EvidenceRow): EvidenceRecord => ({
  issueKey: row.issue_key,
  fieldKey: row.field_key,
  value: row.value_text,
  sources: JSON.parse(row.sources_json),
  state: row.state,
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
});

interface QuestionRow {
  id: number | string;
  issue_key: string;
  field_key: string | null;
  question: string;
  why: string | null;
  owner_account_id: string | null;
  task_key: string | null;
  task_done: number | string | boolean;
  status: QuestionRecord['status'];
  answer: string | null;
  created_by: string;
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
}

const toQuestion = (row: QuestionRow): QuestionRecord => ({
  id: Number(row.id),
  issueKey: row.issue_key,
  fieldKey: row.field_key,
  question: row.question,
  why: row.why,
  ownerAccountId: row.owner_account_id,
  taskKey: row.task_key,
  taskDone: row.task_done === true || Number(row.task_done) === 1,
  status: row.status,
  answer: row.answer,
  createdBy: row.created_by,
  createdAt: row.created_at,
  resolvedBy: row.resolved_by,
  resolvedAt: row.resolved_at,
});

const QUESTION_COLUMNS: Record<keyof Omit<QuestionRecord, 'id' | 'issueKey'>, string> = {
  fieldKey: 'field_key',
  question: 'question',
  why: 'why',
  ownerAccountId: 'owner_account_id',
  taskKey: 'task_key',
  taskDone: 'task_done',
  status: 'status',
  answer: 'answer',
  createdBy: 'created_by',
  createdAt: 'created_at',
  resolvedBy: 'resolved_by',
  resolvedAt: 'resolved_at',
};

export class SqlStore implements Store {
  async getIncident(issueKey: string) {
    await ensureSchema();
    const { rows } = await sql.prepare<IncidentRow>('SELECT * FROM incidents WHERE issue_key = ?').bindParams(issueKey).execute();
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async insertIncident(i: IncidentRecord) {
    await ensureSchema();
    await sql
      .prepare(
        `INSERT INTO incidents (issue_key, scope_json, aware_at, time_zone, materiality_at, assessment_at,
          nis2_submitted_at, status, mode, closed_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bindParams(
        i.issueKey, JSON.stringify(i.scope), i.awareAt, i.timeZone, i.materialityDeterminedAt, i.notifiableAssessmentAt,
        i.nis2NotificationSubmittedAt, i.status, i.mode, i.closedAt, i.createdBy, i.createdAt,
      )
      .execute();
  }

  async updateIncident(issueKey: string, changes: Partial<IncidentRecord>) {
    await ensureSchema();
    const entries = Object.entries(changes).filter(([key]) => key in COLUMNS) as [keyof typeof COLUMNS, unknown][];
    if (!entries.length) return;
    // Column names come from the fixed COLUMNS map, never from input; values are bound parameters.
    const assignments = entries.map(([key]) => `${COLUMNS[key]} = ?`).join(', ');
    const values = entries.map(([key, value]) => (key === 'scope' ? JSON.stringify(value) : value));
    await sql.prepare(`UPDATE incidents SET ${assignments} WHERE issue_key = ?`).bindParams(...values, issueKey).execute();
  }

  async appendAudit(e: AuditEntry) {
    await ensureSchema();
    await sql
      .prepare('INSERT INTO audit_log (issue_key, actor, action, detail_json, at) VALUES (?, ?, ?, ?, ?)')
      .bindParams(e.issueKey, e.actor, e.action, JSON.stringify(e.detail), e.at)
      .execute();
  }

  async listAudit(issueKey: string) {
    await ensureSchema();
    const { rows } = await sql
      .prepare<{ issue_key: string; actor: string; action: string; detail_json: string; at: string }>(
        'SELECT issue_key, actor, action, detail_json, at FROM audit_log WHERE issue_key = ? ORDER BY id ASC',
      )
      .bindParams(issueKey)
      .execute();
    return rows.map((r) => ({ issueKey: r.issue_key, actor: r.actor, action: r.action, detail: JSON.parse(r.detail_json), at: r.at }));
  }

  async listRunningIncidents() {
    await ensureSchema();
    const { rows } = await sql.prepare<IncidentRow>('SELECT * FROM incidents WHERE status = ?').bindParams('running').execute();
    return rows.map(toRecord);
  }

  async listEvidence(issueKey: string) {
    await ensureSchema();
    const { rows } = await sql.prepare<EvidenceRow>('SELECT * FROM evidence WHERE issue_key = ?').bindParams(issueKey).execute();
    return rows.map(toEvidence);
  }

  async getEvidence(issueKey: string, fieldKey: string) {
    await ensureSchema();
    const { rows } = await sql
      .prepare<EvidenceRow>('SELECT * FROM evidence WHERE issue_key = ? AND field_key = ?')
      .bindParams(issueKey, fieldKey)
      .execute();
    return rows[0] ? toEvidence(rows[0]) : null;
  }

  async putEvidence(e: EvidenceRecord) {
    await ensureSchema();
    await sql
      .prepare(
        `INSERT INTO evidence (issue_key, field_key, value_text, sources_json, state, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE value_text = VALUES(value_text), sources_json = VALUES(sources_json),
          state = VALUES(state), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      )
      .bindParams(e.issueKey, e.fieldKey, e.value, JSON.stringify(e.sources), e.state, e.updatedBy, e.updatedAt)
      .execute();
  }

  async listQuestions(issueKey: string) {
    await ensureSchema();
    const { rows } = await sql
      .prepare<QuestionRow>('SELECT * FROM questions WHERE issue_key = ? ORDER BY id ASC')
      .bindParams(issueKey)
      .execute();
    return rows.map(toQuestion);
  }

  async getQuestion(issueKey: string, id: number) {
    await ensureSchema();
    const { rows } = await sql
      .prepare<QuestionRow>('SELECT * FROM questions WHERE issue_key = ? AND id = ?')
      .bindParams(issueKey, id)
      .execute();
    return rows[0] ? toQuestion(rows[0]) : null;
  }

  async insertQuestion(q: NewQuestion) {
    await ensureSchema();
    const { rows } = await sql
      .prepare<UpdateQueryResponse>(
        `INSERT INTO questions (issue_key, field_key, question, why, owner_account_id, task_key, task_done, status, answer,
          created_by, created_at, resolved_by, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bindParams(
        q.issueKey, q.fieldKey, q.question, q.why, q.ownerAccountId, q.taskKey, q.taskDone ? 1 : 0, q.status, q.answer,
        q.createdBy, q.createdAt, q.resolvedBy, q.resolvedAt,
      )
      .execute();
    return Number(rows.insertId);
  }

  async updateQuestion(issueKey: string, id: number, changes: Partial<QuestionRecord>) {
    await ensureSchema();
    const entries = Object.entries(changes).filter(([key]) => key in QUESTION_COLUMNS) as [keyof typeof QUESTION_COLUMNS, unknown][];
    if (!entries.length) return;
    // Column names come from the fixed QUESTION_COLUMNS map, never from input; values are bound parameters.
    const assignments = entries.map(([key]) => `${QUESTION_COLUMNS[key]} = ?`).join(', ');
    const values = entries.map(([key, value]) => (key === 'taskDone' ? (value ? 1 : 0) : value));
    await sql
      .prepare(`UPDATE questions SET ${assignments} WHERE issue_key = ? AND id = ?`)
      .bindParams(...values, issueKey, id)
      .execute();
  }

  async findQuestionsByTask(taskKey: string) {
    await ensureSchema();
    const { rows } = await sql.prepare<QuestionRow>('SELECT * FROM questions WHERE task_key = ?').bindParams(taskKey).execute();
    return rows.map(toQuestion);
  }

  /** INSERT IGNORE on the primary key makes the claim atomic: a duplicate run affects no rows. */
  async claimReminder(k: ReminderKey, at: string) {
    await ensureSchema();
    const { rows } = await sql
      .prepare<UpdateQueryResponse>(
        'INSERT IGNORE INTO reminders (issue_key, stage_key, threshold, due_at, claimed_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bindParams(k.issueKey, k.stageKey, k.threshold, k.dueAt, at)
      .execute();
    return rows.affectedRows > 0;
  }

  async releaseReminder(k: ReminderKey) {
    await ensureSchema();
    await sql
      .prepare('DELETE FROM reminders WHERE issue_key = ? AND stage_key = ? AND threshold = ? AND due_at = ?')
      .bindParams(k.issueKey, k.stageKey, k.threshold, k.dueAt)
      .execute();
  }

  async listNotices(issueKey: string) {
    await ensureSchema();
    const { rows } = await sql.prepare<NoticeRow>('SELECT * FROM notices WHERE issue_key = ?').bindParams(issueKey).execute();
    return rows.map(toNotice);
  }

  async getNotice(issueKey: string, stageKey: string) {
    await ensureSchema();
    const { rows } = await sql
      .prepare<NoticeRow>('SELECT * FROM notices WHERE issue_key = ? AND stage_key = ?')
      .bindParams(issueKey, stageKey)
      .execute();
    return rows[0] ? toNotice(rows[0]) : null;
  }

  async putNotice(n: NoticeRecord) {
    await ensureSchema();
    await sql
      .prepare(
        `INSERT INTO notices (issue_key, stage_key, status, page_id, page_url, drafted_by, drafted_at, signed_by, signed_at,
          sign_note, filed_by, filed_at, filed_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE status = VALUES(status), page_id = VALUES(page_id), page_url = VALUES(page_url),
          drafted_by = VALUES(drafted_by), drafted_at = VALUES(drafted_at), signed_by = VALUES(signed_by),
          signed_at = VALUES(signed_at), sign_note = VALUES(sign_note), filed_by = VALUES(filed_by),
          filed_at = VALUES(filed_at), filed_reference = VALUES(filed_reference)`,
      )
      .bindParams(
        n.issueKey, n.stageKey, n.status, n.pageId, n.pageUrl, n.draftedBy, n.draftedAt, n.signedBy, n.signedAt, n.signNote,
        n.filedBy, n.filedAt, n.filedReference,
      )
      .execute();
  }

  async getSetting(name: string) {
    await ensureSchema();
    const { rows } = await sql
      .prepare<{ value_text: string | null }>('SELECT value_text FROM settings WHERE name = ?')
      .bindParams(name)
      .execute();
    return rows[0]?.value_text ?? null;
  }

  async setSetting(name: string, value: string | null) {
    await ensureSchema();
    await sql
      .prepare('INSERT INTO settings (name, value_text) VALUES (?, ?) ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)')
      .bindParams(name, value)
      .execute();
  }
}

interface NoticeRow {
  issue_key: string;
  stage_key: string;
  status: NoticeRecord['status'];
  page_id: string | null;
  page_url: string | null;
  drafted_by: string | null;
  drafted_at: string | null;
  signed_by: string | null;
  signed_at: string | null;
  sign_note: string | null;
  filed_by: string | null;
  filed_at: string | null;
  filed_reference: string | null;
}

function toNotice(row: NoticeRow): NoticeRecord {
  return {
    issueKey: row.issue_key,
    stageKey: row.stage_key,
    status: row.status,
    pageId: row.page_id,
    pageUrl: row.page_url,
    draftedBy: row.drafted_by,
    draftedAt: row.drafted_at,
    signedBy: row.signed_by,
    signedAt: row.signed_at,
    signNote: row.sign_note,
    filedBy: row.filed_by,
    filedAt: row.filed_at,
    filedReference: row.filed_reference,
  };
}
