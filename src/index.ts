// Forge entry points. Resolvers are thin: they read the caller from the Forge context (never from the payload) and
// delegate to the services, which validate, persist and audit. Triggers run as the app, without a user. Rovo actions
// (also exposed as MCP tools) authorise the caller by reading the issue as that user.
import Resolver from '@forge/resolver';
import { appJira, graph, llm, userConfluence, userJira, userJiraContext } from './jira/client';
import { CONNECTION_SETTING, SITE_SETTING, handleConnectionChange, publishIncident } from './connector';
import * as rovo from './rovo';
import type { RovoContext, RovoPayload, RovoServices } from './rovo';
import type { Deps } from './rovo-deps';
import { AssembleService } from './service/assemble';
import { DetectionService } from './service/detection';
import type { IssueEvent } from './service/detection';
import { startDrill, summarize } from './service/drill';
import { EvidenceService } from './service/evidence';
import { IncidentError, IncidentService } from './service/incidents';
import type { TriggerEvent } from './service/incidents';
import { NoticeService, SPACE_SETTING } from './service/notices';
import { ReminderService } from './service/reminders';
import { SqlStore } from './store/sql';

const store = new SqlStore();
const service = new IncidentService(store);
const evidence = new EvidenceService(store, service);
const notices = new NoticeService(store, service, evidence);
const assemble = new AssembleService(service, evidence);
const detection = new DetectionService(service, evidence, appJira);
const reminders = new ReminderService(store, service, appJira);
const assembleDeps: Deps = { jira: userJiraContext, confluence: userConfluence, graph, llm };
const resolver = new Resolver();

interface Ctx {
  accountId?: string;
  siteUrl?: string;
  timezone?: string;
  extension?: { issue?: { key?: string } };
}

/** The issue comes from where the panel is rendered, so a user cannot act on an issue they are not viewing. */
function issueKeyOf(context: Ctx): string {
  const key = context.extension?.issue?.key;
  if (!key) throw new IncidentError('INVALID_INPUT', 'This action must be run from a Jira issue.');
  return key;
}

function actorOf(context: Ctx): string {
  if (!context.accountId) throw new IncidentError('INVALID_INPUT', 'No signed-in user.');
  return context.accountId;
}

/** Resolver results are plain objects; known errors become a stable shape the UI can show. */
async function respond<T>(work: () => Promise<T>) {
  try {
    return { ok: true as const, data: await work() };
  } catch (error) {
    if (error instanceof IncidentError) return { ok: false as const, code: error.code, message: error.message };
    // Forge turns this one into the "Allow access" consent prompt; it must reach the platform unchanged.
    if ((error as Error)?.name === 'NEEDS_AUTHENTICATION_ERR') throw error;
    console.error('Unexpected resolver error', error);
    return { ok: false as const, code: 'INTERNAL', message: 'Something went wrong. Try again, or check the app logs.' };
  }
}

type ActionArgs = { issueKey: string; actor: string; payload: Record<string, unknown>; context: Ctx };

/** Defines a resolver that acts on the viewed issue as the signed-in user. */
function defineAction(name: string, work: (args: ActionArgs) => Promise<unknown>) {
  resolver.define(name, ({ payload, context }) =>
    respond(() =>
      work({
        issueKey: issueKeyOf(context as Ctx),
        actor: actorOf(context as Ctx),
        payload: (payload ?? {}) as Record<string, unknown>,
        context: context as Ctx,
      }),
    ),
  );
}

/** After a notice changes, refresh its status in Teamwork Graph (no-op until an admin connects the connector). */
const publish = (issueKey: string) => publishIncident({ store, incidents: service, notices }, issueKey);

resolver.define('getIncident', ({ context }) => respond(() => service.get(issueKeyOf(context as Ctx))));

/** Everything the issue panel shows, in one round trip. */
resolver.define('getPanel', ({ context }) =>
  respond(async () => {
    const ctx = context as Ctx;
    const issueKey = issueKeyOf(ctx);
    if (ctx.siteUrl && (await store.getSetting(SITE_SETTING)) !== ctx.siteUrl) await store.setSetting(SITE_SETTING, ctx.siteUrl);
    const view = await service.get(issueKey);
    const spaceSet = Boolean(await store.getSetting(SPACE_SETTING));
    const graphConnected = Boolean(await store.getSetting(CONNECTION_SETTING));
    if (!view) return { issueKey, view: null, board: null, audit: [], notices: [], summary: null, spaceSet, graphConnected };
    const [board, audit, noticeList, records] = await Promise.all([
      evidence.board(issueKey),
      service.auditTrail(issueKey),
      notices.list(issueKey),
      store.listNotices(issueKey),
    ]);
    const summary = view.incident.scope ? summarize(view, board, records, audit) : null;
    return { issueKey, view, board, audit: audit.slice(-80).reverse(), notices: noticeList, summary, spaceSet, graphConnected };
  }),
);

/** The deadlines a scope would start; nothing is stored. Still requires the panel context, like every resolver. */
defineAction('previewClocks', async ({ payload }) =>
  service.preview({ scope: payload.scope, awareAt: payload.awareAt as string, timeZone: payload.timeZone as string }),
);

defineAction('startClock', ({ issueKey, actor, payload }) =>
  service.start({ issueKey, actor, scope: payload.scope, awareAt: payload.awareAt as string, timeZone: payload.timeZone as string }),
);

defineAction('startDrill', ({ issueKey, actor, payload, context }) =>
  startDrill(
    { incidents: service, evidence, now: () => new Date() },
    { issueKey, actor, timeZone: typeof payload.timeZone === 'string' ? payload.timeZone : context.timezone ?? 'UTC' },
  ),
);

defineAction('closeIncident', async ({ issueKey, actor, payload }) => {
  const view = await service.close({ issueKey, actor, reason: payload.reason as string });
  await publish(issueKey);
  return view;
});

defineAction('correctAwareness', ({ issueKey, actor, payload }) =>
  service.correctAwareness({ issueKey, actor, awareAt: payload.awareAt as string, reason: payload.reason as string }),
);

defineAction('updateScope', ({ issueKey, actor, payload }) =>
  service.updateScope({ issueKey, actor, scope: payload.scope, reason: payload.reason as string }),
);

defineAction('recordEvent', ({ issueKey, actor, payload }) =>
  service.recordEvent({ issueKey, actor, event: payload.event as TriggerEvent, at: payload.at as string }),
);

resolver.define('auditTrail', ({ context }) => respond(() => service.auditTrail(issueKeyOf(context as Ctx))));

resolver.define('getEvidence', ({ context }) => respond(() => evidence.board(issueKeyOf(context as Ctx))));

defineAction('setField', ({ issueKey, actor, payload }) =>
  evidence.setField({ issueKey, actor, fieldKey: payload.fieldKey, value: payload.value, sources: payload.sources }),
);

defineAction('acceptDraft', ({ issueKey, actor, payload }) => evidence.acceptDraft({ issueKey, actor, fieldKey: payload.fieldKey }));

defineAction('assembleEvidence', ({ issueKey, actor }) => assemble.assemble({ issueKey, actor }, assembleDeps));

/** Teamwork Graph context: what the people on this incident have been working on. */
defineAction('getContext', async ({ issueKey }) => {
  const issue = await userJiraContext.getIssueContext(issueKey);
  if (!issue) throw new IncidentError('NOT_FOUND', `You cannot see ${issueKey}.`);
  const board = await evidence.board(issueKey).catch(() => null);
  const owners = (board?.questions ?? []).map((q) => q.ownerAccountId).filter((id): id is string => Boolean(id));
  return { people: await assemble.related(issue, graph, owners), links: issue.links };
});

defineAction('askQuestion', ({ issueKey, actor, payload }) =>
  evidence.askQuestion({
    issueKey,
    actor,
    question: payload.question,
    why: payload.why,
    fieldKey: payload.fieldKey,
    ownerAccountId: payload.ownerAccountId,
  }),
);

defineAction('assignQuestion', ({ issueKey, actor, payload }) =>
  evidence.assignQuestion({ issueKey, actor, id: payload.id, ownerAccountId: payload.ownerAccountId }),
);

defineAction('answerQuestion', ({ issueKey, actor, payload }) =>
  evidence.answerQuestion({ issueKey, actor, id: payload.id, answer: payload.answer }),
);

defineAction('dismissQuestion', ({ issueKey, actor, payload }) =>
  evidence.dismissQuestion({ issueKey, actor, id: payload.id, reason: payload.reason }),
);

defineAction('createTask', ({ issueKey, actor, payload }) => evidence.createTask({ issueKey, actor, id: payload.id }, userJira));

defineAction('composeNotice', ({ issueKey, payload }) => notices.compose(issueKey, payload.stageKey));

defineAction('listSpaces', () => userConfluence.listSpaces());

defineAction('setSpace', ({ actor, payload }) => notices.setSpace({ spaceId: payload.spaceId, actor }));

defineAction('draftNotice', async ({ issueKey, actor, payload }) => {
  const record = await notices.draft({ issueKey, actor, stageKey: payload.stageKey }, userConfluence);
  await publish(issueKey);
  return record;
});

defineAction('signOffNotice', async ({ issueKey, actor, payload }) => {
  const record = await notices.signOff({ issueKey, actor, stageKey: payload.stageKey, note: payload.note });
  await publish(issueKey);
  return record;
});

defineAction('markNoticeFiled', async ({ issueKey, actor, payload }) => {
  const record = await notices.markFiled({ issueKey, actor, stageKey: payload.stageKey, filedAt: payload.filedAt, reference: payload.reference });
  await publish(issueKey);
  return record;
});

export const handler = resolver.getDefinitions();

/** Product event trigger: issue created or updated (labels or status changed). */
export async function onIssueEvent(event: IssueEvent) {
  try {
    const outcome = await detection.handle(event);
    // Only actions, and moves to Done (which may answer a question), are logged: every issue on the site reaches here.
    const status = event.changelog?.items?.find((i) => i.field === 'status');
    const category = event.issue?.fields?.status?.statusCategory?.key ?? 'none';
    if (outcome !== 'ignored' || (status && category === 'done')) {
      console.log(`Issue event ${event.eventType} on ${event.issue?.key}: ${outcome}${status ? ` (status to "${status.toString}", category ${category})` : ''}`);
    }
  } catch (error) {
    // Event triggers are not retried on error; log enough to act on it.
    console.error(`Detection failed for ${event.issue?.key}`, error);
  }
}

/** Scheduled trigger, hourly: posts due deadline reminders. */
export async function sendReminders() {
  const { sent, failed } = await reminders.run();
  if (sent || failed) console.log(`Reminders: ${sent} sent, ${failed} failed`);
}

// Rovo actions for the Clerk agent; the same actions are the app's MCP tools.
const rovoServices: RovoServices = { store, incidents: service, evidence, notices, assemble, jira: userJiraContext, assembleDeps };

export const rovoStatus = (payload: RovoPayload) => rovo.status(rovoServices, payload);
export const rovoList = () => rovo.listIncidents(rovoServices);
export const rovoAsk = (payload: RovoPayload, context: RovoContext) => rovo.askQuestion(rovoServices, payload, context);
export const rovoDraft = (payload: RovoPayload) => rovo.draftNotice(rovoServices, payload);
export const rovoAssemble = (payload: RovoPayload, context: RovoContext) => rovo.assembleEvidence(rovoServices, payload, context);

/** Teamwork Graph connector lifecycle: remember the connection and publish every running incident's notices. */
export async function onConnectionChange(request: { action?: string; connectionId?: string }) {
  return handleConnectionChange(store, request, async () => {
    let total = 0;
    for (const incident of await store.listRunningIncidents()) total += await publish(incident.issueKey);
    return total;
  });
}
