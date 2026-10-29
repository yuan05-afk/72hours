// Teamwork Graph connector: publishes each regulator notice's status (drafted, signed off, filed, and its deadline) as a
// document in Teamwork Graph, so Rovo search and agents across the organisation can answer "where are we on the breach
// notices?". Only status is published, never the breach facts, and each object is visible only to the people who
// worked on that incident (user principals mapped to their Atlassian accounts).
import { graph } from '@forge/teamwork-graph';
import { DateTime } from 'luxon';
import type { NoticeService } from './service/notices';
import type { IncidentService } from './service/incidents';
import type { Store } from './store/types';

export const CONNECTION_SETTING = 'graph.connectionId';
export const SITE_SETTING = 'site.url';

const STATUS_WORDS = { none: 'not drafted', draft: 'drafted, awaiting sign-off', ready: 'signed off, ready to file', filed: 'filed' } as const;

/** Called by Teamwork Graph when an admin adds, updates or removes the connector. */
export async function handleConnectionChange(
  store: Store,
  request: { action?: string; connectionId?: string },
  publishAll: () => Promise<number>,
) {
  if (!request.connectionId) return { success: false };
  if (request.action === 'DELETED') {
    if ((await store.getSetting(CONNECTION_SETTING)) === request.connectionId) await store.setSetting(CONNECTION_SETTING, null);
    return { success: true };
  }
  await store.setSetting(CONNECTION_SETTING, request.connectionId);
  const published = await publishAll();
  console.log(`Teamwork Graph connection ${request.action}: published ${published} notice objects`);
  return { success: true };
}

/** People who worked on the incident: the only ones who may see its notice status in Teamwork Graph. */
async function viewers(store: Store, issueKey: string): Promise<string[]> {
  const actors = (await store.listAudit(issueKey)).map((a) => a.actor).filter((a) => !a.startsWith('app:'));
  return [...new Set(actors)].slice(0, 400);
}

/** Pushes the current status of every notice on the incident. Best effort: never blocks the user's action. */
export async function publishIncident(deps: { store: Store; incidents: IncidentService; notices: NoticeService }, issueKey: string): Promise<number> {
  try {
    const connectionId = await deps.store.getSetting(CONNECTION_SETTING);
    if (!connectionId) return 0;
    const view = await deps.incidents.get(issueKey);
    if (!view?.incident.scope) return 0;
    const people = await viewers(deps.store, issueKey);
    if (!people.length) return 0;
    const now = Date.now();
    await graph.mapUsers({
      connectionId,
      directMappings: people.map((accountId) => ({ externalId: accountId, accountId, updateSequenceNumber: now, updatedAt: now })),
    });
    const site = (await deps.store.getSetting(SITE_SETTING)) ?? '';
    const zone = view.incident.timeZone;
    const iso = new Date(now).toISOString();
    const objects = (await deps.notices.list(issueKey)).map((n) => {
      const due = n.dueAt ? DateTime.fromISO(n.dueAt).setZone(zone).toFormat("ccc d LLL yyyy, HH:mm '(" + zone + ")'") : 'no fixed deadline';
      const drill = view.incident.mode === 'drill' ? '[Drill] ' : '';
      const text = [
        `${drill}${issueKey}: ${n.action} (${n.regimeName}, ${n.citationLabel}).`,
        `Status: ${STATUS_WORDS[n.status]}. Deadline: ${due}.`,
        n.missing.length ? `${n.missing.length} required item(s) still missing.` : 'All required items accepted.',
        'Deadlines calculated by the 72 Hours rulebook from the cited law.',
      ].join(' ');
      return {
        schemaVersion: '1.0',
        id: `notice-${issueKey}-${n.stageKey}`,
        updateSequenceNumber: now,
        displayName: `${drill}${issueKey} · ${n.regimeName} notice: ${STATUS_WORDS[n.status]}`,
        description: `${n.action}, due ${due}`,
        url: n.record?.pageUrl || (site ? `${site}/browse/${issueKey}` : `https://atlassian.net/browse/${issueKey}`),
        createdAt: view.incident.createdAt,
        lastUpdatedAt: iso,
        permissions: [{ accessControls: [{ principals: people.map((id) => ({ type: 'USER', id })) }] }],
        'atlassian:document': {
          type: { category: 'OTHER', mimeType: 'text/plain' },
          content: { mimeType: 'text/plain', text },
        },
      };
    });
    if (!objects.length) return 0;
    // The SDK's object union is wide; the shape above matches atlassian:document as ingested in the day-one spike.
    const result = await graph.setObjects({ connectionId, objects: objects as never });
    if (!result.success || result.results?.rejected?.length) console.warn('Teamwork Graph rejected objects', JSON.stringify(result).slice(0, 500));
    return result.results?.accepted?.length ?? 0;
  } catch (error) {
    console.warn(`Publishing ${issueKey} to Teamwork Graph failed`, (error as Error).message);
    return 0;
  }
}
