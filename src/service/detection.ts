// Incident detection from Jira issue events. Adding the label starts a "detected" incident: the awareness time is
// recorded at once (deadlines may already be running), and the team is told, in an internal comment, to scope it.
import { DateTime } from 'luxon';
import type { AppJira } from '../jira/port';
import type { EvidenceService } from './evidence';
import type { IncidentService } from './incidents';

/** Jira labels cannot contain spaces, so "Personal data involved" is spelled as one label. */
export const PERSONAL_DATA_LABEL = 'personal-data-involved';

const ACTOR = 'app:detector';

interface ChangelogItem {
  field?: string;
  fromString?: string | null;
  toString?: string | null;
}

export interface IssueEvent {
  eventType: string;
  atlassianId?: string;
  issue: {
    key: string;
    fields?: { created?: string; updated?: string; status?: { statusCategory?: { key?: string } } };
  };
  changelog?: { items?: ChangelogItem[] };
}

const labelsOf = (value: string | null | undefined) => (value ?? '').toLowerCase().split(/\s+/).filter(Boolean);

/** True when this change added the label (it was not there before). */
export function labelAdded(items: ChangelogItem[] = []): boolean {
  return items.some(
    (item) =>
      item.field === 'labels' &&
      labelsOf(item.toString).includes(PERSONAL_DATA_LABEL) &&
      !labelsOf(item.fromString).includes(PERSONAL_DATA_LABEL),
  );
}

export function movedToDone(event: IssueEvent): boolean {
  return (
    (event.changelog?.items ?? []).some((item) => item.field === 'status') &&
    event.issue.fields?.status?.statusCategory?.key === 'done'
  );
}

/** Jira timestamps look like 2026-10-29T09:30:00.000+0800; store them as ISO 8601 with a colon offset. */
export function normaliseJiraTime(value: string | undefined, fallback: Date): string {
  const parsed = value ? DateTime.fromISO(value, { setZone: true }) : null;
  return parsed?.isValid ? (parsed.toISO() as string) : fallback.toISOString();
}

const show = (iso: string, zone: string) => DateTime.fromISO(iso).setZone(zone).toFormat("ccc d LLL yyyy, HH:mm '(" + zone + ")'");

export function detectionComment(awareAt: string, timeZone: string, issueCreatedAt: string | null): string {
  const earlier =
    issueCreatedAt && DateTime.fromISO(issueCreatedAt) < DateTime.fromISO(awareAt)
      ? ` This issue was opened at ${show(issueCreatedAt, timeZone)}; if the team knew personal data was involved by then, correct the time in the panel and give the reason.`
      : ' If the team knew earlier, correct the time in the panel and give the reason.';
  return [
    `72 Hours: this incident is flagged as involving personal data (label "${PERSONAL_DATA_LABEL}"). ` +
      'Breach notification deadlines may already be running, counted from when the organisation became aware.',
    `Awareness is recorded as ${show(awareAt, timeZone)}, the time the label was added.${earlier}`,
    'Next: open the 72 Hours panel on this issue and answer the scoping questions. The deadlines appear once scoped.',
  ].join('\n\n');
}

export class DetectionService {
  constructor(
    private incidents: IncidentService,
    private evidence: EvidenceService,
    private jira: AppJira,
    private now: () => Date = () => new Date(),
  ) {}

  /** Handles avi:jira:created:issue and avi:jira:updated:issue. Returns what it did, for logs and tests. */
  async handle(event: IssueEvent): Promise<'detected' | 'already-tracked' | 'task-done' | 'ignored'> {
    const issueKey = event.issue.key;
    let flaggedAt: string | undefined;
    let createdAt: string | undefined = event.issue.fields?.created;

    if (event.eventType === 'avi:jira:updated:issue') {
      if (movedToDone(event)) {
        const flagged = await this.evidence.taskDone(issueKey, ACTOR, () => this.jira.getLatestHumanComment(issueKey));
        if (flagged > 0 && !labelAdded(event.changelog?.items)) return 'task-done';
      }
      if (!labelAdded(event.changelog?.items)) return 'ignored';
      flaggedAt = event.issue.fields?.updated;
    } else if (event.eventType === 'avi:jira:created:issue') {
      // The created event carries no labels, so read them.
      const issue = await this.jira.getIssue(issueKey);
      if (!issue || !issue.labels.map((l) => l.toLowerCase()).includes(PERSONAL_DATA_LABEL)) return 'ignored';
      flaggedAt = issue.created;
      createdAt = issue.created;
    } else {
      return 'ignored';
    }

    const timeZone = (event.atlassianId && (await this.jira.getUserTimeZone(event.atlassianId))) || 'UTC';
    const awareAt = normaliseJiraTime(flaggedAt, this.now());
    const issueCreatedAt = createdAt ? normaliseJiraTime(createdAt, this.now()) : null;
    const { created } = await this.incidents.detect({
      issueKey,
      detectedAt: awareAt,
      timeZone,
      actor: ACTOR,
      detail: { source: `label:${PERSONAL_DATA_LABEL}`, flaggedBy: event.atlassianId ?? null, issueCreatedAt },
    });
    if (!created) return 'already-tracked';
    await this.jira.addInternalComment(issueKey, detectionComment(awareAt, timeZone, issueCreatedAt));
    return 'detected';
  }
}
