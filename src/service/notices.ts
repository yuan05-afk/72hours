// Notices: draft each regulator notice into Confluence, let a named person sign it off once every required fact is
// accepted, and record when it was filed. The app never files anything itself.
import { composeNotice } from '../notice/draft';
import type { ComposedNotice } from '../notice/draft';
import { requirementFor } from '../notice/fields';
import type { FieldKey } from '../notice/fields';
import type { UserConfluence } from '../jira/port';
import type { Clock } from '../rules';
import type { AuditEntry, NoticeRecord, Store } from '../store/types';
import type { EvidenceService } from './evidence';
import { IncidentError, IncidentService } from './incidents';
import type { IncidentView } from './incidents';

export const SPACE_SETTING = 'confluence.spaceId';
const NIS2_NOTIFICATIONS = new Set(['nis2-incident-notification', 'nis2-incident-notification-tsp']);
const MAX_NOTE = 500;

export interface NoticeView {
  stageKey: string;
  regimeName: string;
  action: string;
  recipient: string;
  dueAt: string | null;
  citationLabel: string;
  /** Whether a field checklist is mapped for this notice (drafting works either way). */
  mapped: boolean;
  missing: FieldKey[];
  status: 'none' | NoticeRecord['status'];
  record: NoticeRecord | null;
}

const blankNotice = (issueKey: string, stageKey: string): NoticeRecord => ({
  issueKey,
  stageKey,
  status: 'draft',
  pageId: null,
  pageUrl: null,
  draftedBy: null,
  draftedAt: null,
  signedBy: null,
  signedAt: null,
  signNote: null,
  filedBy: null,
  filedAt: null,
  filedReference: null,
});

export class NoticeService {
  constructor(
    private store: Store,
    private incidents: IncidentService,
    private evidence: EvidenceService,
    private now: () => Date = () => new Date(),
  ) {}

  private async audit(issueKey: string, actor: string, action: string, detail: AuditEntry['detail']) {
    await this.store.appendAudit({ issueKey, actor, action, detail, at: this.now().toISOString() });
  }

  /** Every notice the incident's scope calls for, with its draft, sign-off and filing state. */
  async list(issueKey: string): Promise<NoticeView[]> {
    const view = await this.incidents.get(issueKey);
    if (!view || !view.incident.scope) return [];
    const [board, records] = await Promise.all([this.evidence.board(issueKey), this.store.listNotices(issueKey)]);
    const byStage = new Map(records.map((r) => [r.stageKey, r]));
    return view.clocks.map((clock) => {
      const record = byStage.get(clock.stageKey) ?? null;
      return {
        stageKey: clock.stageKey,
        regimeName: clock.regimeName,
        action: clock.action,
        recipient: clock.recipient,
        dueAt: clock.dueAt,
        citationLabel: clock.citation.label,
        mapped: Boolean(requirementFor(clock.stageKey)),
        missing: board.notices.find((n) => n.stageKey === clock.stageKey)?.missing ?? [],
        status: record?.status ?? 'none',
        record,
      };
    });
  }

  private async load(issueKey: string, stageKey: unknown): Promise<{ view: IncidentView; clock: Clock }> {
    const view = await this.incidents.get(issueKey);
    if (!view) throw new IncidentError('NOT_FOUND', `No breach clock is running for ${issueKey}.`);
    if (!view.incident.scope) throw new IncidentError('NOT_SCOPED', `Answer the scoping questions for ${issueKey} first.`);
    const clock = view.clocks.find((c) => c.stageKey === stageKey);
    if (!clock) throw new IncidentError('INVALID_INPUT', 'That notice does not apply to this incident.');
    return { view, clock };
  }

  private requireOpen(view: IncidentView) {
    if (view.incident.status === 'closed') throw new IncidentError('CLOSED', `${view.incident.issueKey} is closed.`);
  }

  /** The current draft, composed from the latest evidence. Read-only. */
  async compose(issueKey: string, stageKey: unknown): Promise<ComposedNotice> {
    const { view, clock } = await this.load(issueKey, stageKey);
    const board = await this.evidence.board(issueKey);
    return composeNotice({
      issueKey,
      clock,
      board,
      scope: view.incident.scope,
      timeZone: view.incident.timeZone,
      generatedAt: this.now(),
      drill: view.incident.mode === 'drill',
    });
  }

  async setSpace(input: { spaceId: unknown; actor: string }) {
    if (typeof input.spaceId !== 'string' || !/^\d+$/.test(input.spaceId)) throw new IncidentError('INVALID_INPUT', 'Choose a space.');
    await this.store.setSetting(SPACE_SETTING, input.spaceId);
    return { spaceId: input.spaceId };
  }

  /** Creates the draft page, or updates it with the latest evidence. Signed-off and filed notices are not redrafted. */
  async draft(input: { issueKey: string; stageKey: unknown; actor: string }, confluence: UserConfluence): Promise<NoticeRecord> {
    const { view, clock } = await this.load(input.issueKey, input.stageKey);
    this.requireOpen(view);
    const existing = await this.store.getNotice(input.issueKey, clock.stageKey);
    if (existing && existing.status !== 'draft') {
      throw new IncidentError('CONFLICT', 'This notice is already signed off. Its draft is frozen as signed.');
    }
    const spaceId = await this.store.getSetting(SPACE_SETTING);
    if (!spaceId && !existing?.pageId) throw new IncidentError('NEEDS_SETUP', 'Choose the Confluence space for notice drafts.');
    const composed = await this.compose(input.issueKey, clock.stageKey);
    const page = existing?.pageId
      ? await confluence.updatePage({ id: existing.pageId, title: composed.title, storage: composed.storage })
      : await confluence.createPage({ spaceId: spaceId as string, title: composed.title, storage: composed.storage });
    const record: NoticeRecord = {
      ...(existing ?? blankNotice(input.issueKey, clock.stageKey)),
      status: 'draft',
      pageId: page.id,
      pageUrl: page.url,
      draftedBy: input.actor,
      draftedAt: this.now().toISOString(),
    };
    await this.store.putNotice(record);
    await this.audit(input.issueKey, input.actor, 'notice.drafted', {
      stage: clock.stageKey,
      pageId: page.id,
      updated: Boolean(existing?.pageId),
      missing: composed.missing,
    });
    return record;
  }

  /** A named person confirms the notice is ready to file. Only possible once every required fact is accepted. */
  async signOff(input: { issueKey: string; stageKey: unknown; note?: unknown; actor: string }): Promise<NoticeRecord> {
    const { view, clock } = await this.load(input.issueKey, input.stageKey);
    this.requireOpen(view);
    const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, MAX_NOTE) : null;
    const existing = await this.store.getNotice(input.issueKey, clock.stageKey);
    if (!existing?.pageId) throw new IncidentError('CONFLICT', 'Draft the notice first, so the sign-off refers to a document.');
    if (existing.status !== 'draft') throw new IncidentError('CONFLICT', 'This notice is already signed off.');
    const board = await this.evidence.board(input.issueKey);
    const missing = board.notices.find((n) => n.stageKey === clock.stageKey)?.missing ?? [];
    if (missing.length) {
      throw new IncidentError('CONFLICT', `${missing.length} required item${missing.length === 1 ? ' is' : 's are'} missing or not yet accepted.`);
    }
    const record: NoticeRecord = { ...existing, status: 'ready', signedBy: input.actor, signedAt: this.now().toISOString(), signNote: note };
    await this.store.putNotice(record);
    await this.audit(input.issueKey, input.actor, 'notice.signedOff', { stage: clock.stageKey, note, pageId: existing.pageId });
    return record;
  }

  /** Records that the team filed the notice. For the NIS2 incident notification this also starts the final-report clock. */
  async markFiled(input: { issueKey: string; stageKey: unknown; filedAt?: unknown; reference?: unknown; actor: string }): Promise<NoticeRecord> {
    const { view, clock } = await this.load(input.issueKey, input.stageKey);
    this.requireOpen(view);
    const existing = await this.store.getNotice(input.issueKey, clock.stageKey);
    if (!existing || existing.status !== 'ready') throw new IncidentError('CONFLICT', 'Sign the notice off before marking it as filed.');
    const filedAt = typeof input.filedAt === 'string' && input.filedAt ? input.filedAt : this.now().toISOString();
    if (Number.isNaN(Date.parse(filedAt))) throw new IncidentError('INVALID_INPUT', 'The filing time is not a valid date.');
    const reference = typeof input.reference === 'string' && input.reference.trim() ? input.reference.trim().slice(0, MAX_NOTE) : null;
    const record: NoticeRecord = { ...existing, status: 'filed', filedBy: input.actor, filedAt, filedReference: reference };
    await this.store.putNotice(record);
    await this.audit(input.issueKey, input.actor, 'notice.filed', { stage: clock.stageKey, filedAt, reference, dueAt: clock.dueAt });
    if (NIS2_NOTIFICATIONS.has(clock.stageKey) && !view.incident.nis2NotificationSubmittedAt) {
      await this.incidents.recordEvent({ issueKey: input.issueKey, event: 'nis2NotificationSubmitted', at: filedAt, actor: input.actor });
    }
    return record;
  }
}
