// Deadline reminders, run hourly by a scheduled trigger. Each reminder is an internal comment on the incident, so it
// reaches watchers through Jira's own notifications. A claim row per (incident, stage, threshold, deadline) makes each
// reminder go out once, even when the schedule runs twice.
import { DateTime } from 'luxon';
import type { AppJira } from '../jira/port';
import type { Clock } from '../rules';
import type { IncidentRecord, ReminderKey, Store } from '../store/types';
import { buildBoard } from './evidence';
import { IncidentService } from './incidents';

const HOUR = 3_600_000;
const ACTOR = 'app:reminders';
/** Past this, an overdue deadline is old news and no longer reminded. */
const OVERDUE_WINDOW_HOURS = 48;
/** Once the NIS2 incident notification is recorded as submitted, its own and the early warning's reminders stop. */
const DONE_WHEN_NIS2_SUBMITTED = new Set(['nis2-early-warning', 'nis2-incident-notification', 'nis2-incident-notification-tsp']);

export type Threshold = ReminderKey['threshold'];

/**
 * Pure: which reminder (if any) is due for a clock now. Only the most urgent threshold is sent, and a threshold only
 * fires if the incident was already tracked when it was crossed, so a clock started late does not send stale notices.
 */
export function dueThreshold(clock: Clock, incident: IncidentRecord, now: Date): Threshold | null {
  if (clock.status !== 'running' || !clock.dueAt) return null;
  if (incident.nis2NotificationSubmittedAt && DONE_WHEN_NIS2_SUBMITTED.has(clock.stageKey)) return null;
  const due = Date.parse(clock.dueAt);
  const tracked = Date.parse(incident.createdAt);
  const left = due - now.getTime();
  if (left <= 0) return -left <= OVERDUE_WINDOW_HOURS * HOUR ? 'overdue' : null;
  if (left <= 6 * HOUR) return tracked < due - 6 * HOUR ? '6h' : null;
  if (left <= 24 * HOUR) return tracked < due - 24 * HOUR ? '24h' : null;
  return null;
}

/** missing: open required fields, or null when no field checklist is mapped for this notice. */
export function reminderText(clock: Clock, threshold: Threshold, timeZone: string, missing: number | null): string {
  const when = DateTime.fromISO(clock.dueAt as string).setZone(timeZone).toFormat("ccc d LLL, HH:mm '(" + timeZone + ")'");
  const what = `${clock.action} (${clock.regimeName}, ${clock.citation.label})`;
  const lead =
    threshold === 'overdue'
      ? `72 Hours: the deadline for "${what}" passed at ${when}. If the notice has not gone out, send it as soon as possible and record the reasons for the delay.`
      : `72 Hours reminder: "${what}" is due ${when}, in about ${threshold === '6h' ? '6' : '24'} hours.`;
  const gaps =
    missing === null
      ? " Use the regulator's own form; the deadline is tracked in the 72 Hours panel."
      : missing > 0
      ? ` ${missing} required notice field${missing === 1 ? ' is' : 's are'} still open in the 72 Hours panel.`
      : ' All required notice fields are filled; it needs DPO review before filing.';
  return lead + (threshold === 'overdue' ? '' : gaps);
}

export class ReminderService {
  constructor(
    private store: Store,
    private incidents: IncidentService,
    private jira: AppJira,
    private now: () => Date = () => new Date(),
  ) {}

  async run(): Promise<{ sent: number; failed: number }> {
    const now = this.now();
    let sent = 0;
    let failed = 0;
    for (const record of await this.store.listRunningIncidents()) {
      // Drills are practice: no reminders. Filed notices are done: no reminders for them.
      if (record.mode === 'drill') continue;
      const view = await this.incidents.get(record.issueKey);
      if (!view) continue;
      const filed = new Set((await this.store.listNotices(record.issueKey)).filter((n) => n.status === 'filed').map((n) => n.stageKey));
      const due = view.clocks
        .filter((clock) => !filed.has(clock.stageKey))
        .map((clock) => ({ clock, threshold: dueThreshold(clock, view.incident, now) }))
        .filter((d): d is { clock: Clock; threshold: Threshold } => d.threshold !== null);
      if (!due.length) continue;

      const board = buildBoard(view.clocks, await this.store.listEvidence(record.issueKey), [], true);
      for (const { clock, threshold } of due) {
        const key: ReminderKey = { issueKey: record.issueKey, stageKey: clock.stageKey, threshold, dueAt: clock.dueAt as string };
        if (!(await this.store.claimReminder(key, now.toISOString()))) continue;
        const missing = board.notices.find((n) => n.stageKey === clock.stageKey)?.missing.length ?? null;
        try {
          await this.jira.addInternalComment(record.issueKey, reminderText(clock, threshold, view.incident.timeZone, missing));
        } catch (error) {
          // Release the claim so the next hourly run tries again.
          await this.store.releaseReminder(key);
          console.error(`Reminder for ${record.issueKey} ${clock.stageKey} failed`, error);
          failed += 1;
          continue;
        }
        await this.store.appendAudit({
          issueKey: record.issueKey,
          actor: ACTOR,
          action: 'reminder.sent',
          detail: { stage: clock.stageKey, threshold, dueAt: clock.dueAt, missingFields: missing },
          at: now.toISOString(),
        });
        sent += 1;
      }
    }
    return { sent, failed };
  }
}
