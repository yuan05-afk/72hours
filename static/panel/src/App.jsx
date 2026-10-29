// 72 Hours issue panel. One screen at a time: the overview (deadlines, evidence, questions, notices) or a single task
// sheet. All data comes from one resolver call and is reloaded after every change.
import React, { useCallback, useEffect, useState } from 'react';
import { events, rovo } from '@forge/bridge';
import { ApiError, call, firstName, loadNames } from './api.js';
import { formatWhen, viewerZone, zoneLabel } from './time.js';
import Board from './components/Board.jsx';
import Evidence from './components/Evidence.jsx';
import Questions from './components/Questions.jsx';
import ScopeForm from './components/ScopeForm.jsx';
import Audit from './components/Audit.jsx';
import Notices from './components/Notices.jsx';
import Summary from './components/Summary.jsx';
import Context from './components/Context.jsx';
import Progress from './components/Progress.jsx';
import { AnswerForm, AskForm, AssignForm, CorrectTime, FieldEditor } from './components/Forms.jsx';
import { CloseForm, FileForm, NoticePreview, SignOff, SpacePicker } from './components/NoticeForms.jsx';

const REFRESH_MS = 60_000;
const ISSUE_CHANGE_RELOAD_MS = 4_000;
const CLERK = { type: 'forge', agentName: 'Clerk', agentKey: 'clerk' };

/** Ticks once a second while deadlines are on screen, so the countdown stays live. */
function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Loading() {
  return (
    <div className="app" aria-busy="true" aria-label="Loading 72 Hours">
      <div className="skeleton" style={{ width: '30%' }} />
      <div className="board" style={{ height: 180 }} />
      <div className="card"><div className="skeleton" style={{ width: '60%' }} /><div className="skeleton" style={{ width: '80%', marginTop: 12 }} /></div>
    </div>
  );
}

function Empty({ onStart, onDrill, busy }) {
  return (
    <section className="empty">
      <h2 className="section-title">No breach clock on this issue</h2>
      <p className="meta">
        If personal data may be involved, start the clock now. Regulators count from when your team became aware, not
        from when someone opens a form.
      </p>
      <div className="actions fill">
        <button type="button" className="btn primary" onClick={onStart}>Start breach clock</button>
      </div>
      <p className="caption">Adding the label <span className="chip plain">personal-data-involved</span> flags the issue automatically.</p>
      <div className="item" style={{ alignItems: 'center' }}>
        <span className="grow caption">New here? Run a practice breach on this issue with sample data. It is labelled as a drill and sends no reminders.</span>
        <button type="button" className="btn small quiet" disabled={busy} onClick={onDrill}>{busy ? 'Starting…' : 'Try a sample breach'}</button>
      </div>
    </section>
  );
}

function Detected({ onScope }) {
  return (
    <section className="empty">
      <span className="status"><span className="dot urgent" aria-hidden="true" />Flagged: personal data involved</span>
      <p>Notification deadlines may already be running from the awareness time above. Answer a few questions to see which ones.</p>
      <div className="actions fill"><button type="button" className="btn primary" onClick={onScope}>Answer scoping questions</button></div>
    </section>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [screen, setScreen] = useState({ name: 'home' });
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rovoOn, setRovoOn] = useState(false);

  const load = useCallback(async () => {
    try {
      const panel = await call('getPanel');
      const ids = [
        ...(panel.board?.questions ?? []).flatMap((q) => [q.ownerAccountId, q.resolvedBy]),
        ...(panel.board?.fields ?? []).map((f) => f.updatedBy),
        ...(panel.notices ?? []).flatMap((n) => [n.record?.signedBy, n.record?.filedBy]),
        ...panel.audit.map((a) => a.actor),
        ...panel.audit.map((a) => a.detail?.to).filter((v) => typeof v === 'string' && !v.includes('T')),
      ];
      await loadNames(ids.filter(Boolean));
      setData(panel);
      setLoadError(null);
    } catch (e) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    rovo.isEnabled().then(setRovoOn).catch(() => setRovoOn(false));
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
    // Reload when the issue changes (a label added, a comment posted), so the panel follows the team without waiting
    // for the next minute's refresh. Detection runs in a backend trigger a moment after the label is saved, so reload
    // once more a few seconds later; the detector's own internal note then fires this event again.
    const later = [];
    const subscription = events
      .on('JIRA_ISSUE_CHANGED', () => {
        load();
        later.push(setTimeout(load, ISSUE_CHANGE_RELOAD_MS));
      })
      .catch(() => null);
    return () => {
      clearInterval(timer);
      later.forEach(clearTimeout);
      subscription.then((s) => s?.unsubscribe?.());
    };
  }, [load]);

  const incident = data?.view?.incident ?? null;
  const running = incident?.status === 'running';
  const closed = incident?.status === 'closed';
  const drill = incident?.mode === 'drill';
  const now = useNow(running && screen.name === 'home');

  // Reload before leaving the sheet, so the overview never opens on stale data (the sheet keeps "Saving…" meanwhile).
  const home = async (message) => {
    await load();
    setScreen({ name: 'home' });
    setNotice(message ?? null);
  };

  /** Runs a one-click action from the overview with a busy state and a message. */
  async function act(work, message) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await work();
      await home(typeof message === 'function' ? message(result) : message);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NEEDS_SETUP') setScreen({ name: 'space', after: work, message });
      else setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }

  const createTask = (question) =>
    act(() => call('createTask', { id: question.id }), (updated) => `${updated.taskKey} created and assigned to ${firstName(question.ownerAccountId)}.`);

  const assemble = () =>
    act(
      () => call('assembleEvidence'),
      (r) =>
        r.drafted.length
          ? `Clerk drafted ${r.drafted.length} field${r.drafted.length === 1 ? '' : 's'} from ${r.sources.length} sources. Review them under To review.${r.note ? ` ${r.note}` : ''}`
          : r.note ?? `Clerk read ${r.sources.length} sources and found nothing new to draft.`,
    );

  const draftNotice = (n) =>
    act(() => call('draftNotice', { stageKey: n.stageKey }), `${n.regimeName} draft ${n.status === 'none' ? 'created' : 'updated'} in Confluence.`);

  const askClerk = () =>
    rovo.open({ ...CLERK, prompt: `What is still missing before we can send the notices for ${data.issueKey}?` }).catch(() => setNotice('Rovo could not be opened here.'));

  if (!data && !loadError) return <Loading />;
  if (!data) {
    return (
      <div className="app">
        <section className="empty" role="alert">
          <h2 className="section-title">72 Hours could not load</h2>
          <p className="meta">{loadError}</p>
          <div className="actions"><button type="button" className="btn quiet" onClick={() => { setLoadError(null); load(); }}>Try again</button></div>
        </section>
      </div>
    );
  }

  const { issueKey, board, audit } = data;
  const zone = incident?.timeZone ?? 'UTC';
  const back = () => setScreen({ name: 'home' });
  const fieldLabel = (key) => board?.fields.find((f) => f.key === key)?.label;

  let content;
  switch (screen.name) {
    case 'scope':
      content = <ScopeForm issueKey={issueKey} incident={incident} onCancel={back} onDone={() => home(running ? 'Scope updated. Deadlines recalculated.' : 'Breach clock started.')} />;
      break;
    case 'correct':
      content = <CorrectTime issueKey={issueKey} incident={incident} onBack={back} onDone={() => home('Awareness time corrected. Deadlines moved with it.')} />;
      break;
    case 'field':
      content = (
        <FieldEditor
          issueKey={issueKey}
          field={screen.field}
          onBack={back}
          onAsk={(fieldKey) => setScreen({ name: 'ask', fieldKey })}
          onDone={() => home(`${screen.field.label} saved.`)}
        />
      );
      break;
    case 'ask':
      content = <AskForm issueKey={issueKey} fields={board?.fields ?? []} fieldKey={screen.fieldKey} onBack={back} onDone={() => home('Question added.')} />;
      break;
    case 'assign':
      content = <AssignForm issueKey={issueKey} question={screen.question} onBack={back} onDone={() => home('Question assigned.')} />;
      break;
    case 'answer':
      content = (
        <AnswerForm
          issueKey={issueKey}
          question={screen.question}
          fieldLabel={fieldLabel(screen.question.fieldKey)}
          onBack={back}
          onDone={(result) => home(result?.fieldDrafted ? 'Answer saved and drafted into its field for review.' : 'Saved.')}
        />
      );
      break;
    case 'space':
      content = (
        <SpacePicker
          issueKey={issueKey}
          onBack={back}
          onDone={async () => {
            setScreen({ name: 'home' });
            if (screen.after) await act(screen.after, screen.message);
            else await home('Space saved.');
          }}
        />
      );
      break;
    case 'preview':
      content = <NoticePreview issueKey={issueKey} notice={screen.notice} onBack={back} />;
      break;
    case 'signoff':
      content = <SignOff issueKey={issueKey} notice={screen.notice} onBack={back} onDone={() => home(`${screen.notice.regimeName} notice signed off. Ready to file.`)} />;
      break;
    case 'file':
      content = <FileForm issueKey={issueKey} notice={screen.notice} zone={zone} onBack={back} onDone={() => home(`${screen.notice.regimeName} notice recorded as filed.`)} />;
      break;
    case 'close':
      content = <CloseForm issueKey={issueKey} drill={drill} onBack={back} onDone={() => home(drill ? 'Drill ended.' : 'Incident closed.')} />;
      break;
    case 'audit':
      content = <Audit issueKey={issueKey} entries={audit} zone={zone} onBack={back} />;
      break;
    default:
      content = (
        <>
          <header className="stack">
            <div className="row">
              <span className="title grow">72 Hours</span>
              {running && rovoOn && (
                <button type="button" className="btn small tint" style={{ marginRight: 12 }} onClick={askClerk}>Ask Clerk</button>
              )}
              {running && <span className="status"><span className="dot breach" aria-hidden="true" />{drill ? 'Drill running' : 'Clock running'}</span>}
              {closed && <span className="status"><span className="dot idle" aria-hidden="true" />{drill ? 'Drill ended' : 'Closed'}</span>}
            </div>
            {incident && (
              <span className="meta">
                Aware since {formatWhen(incident.awareAt, zone)} {zoneLabel(zone)}
                {!closed && (
                  <>
                    {' · '}
                    <button type="button" className="link" onClick={() => setScreen({ name: 'correct' })}>Correct</button>
                  </>
                )}
              </span>
            )}
          </header>
          {incident && <Progress data={data} />}
          {drill && !closed && (
            <div className="banner" role="note">
              <span className="grow">Drill: a practice run on sample data. No reminders; nothing is sent.</span>
              <button type="button" className="link" onClick={() => setScreen({ name: 'close' })}>End drill</button>
            </div>
          )}
          {notice && <p className="meta" role="status">{notice}</p>}
          {!incident && (
            <Empty
              busy={busy}
              onStart={() => setScreen({ name: 'scope' })}
              onDrill={() => act(() => call('startDrill', { timeZone: viewerZone() }), 'Drill started. Try Assemble evidence, the open questions and the notices.')}
            />
          )}
          {incident?.status === 'detected' && <Detected onScope={() => setScreen({ name: 'scope' })} />}
          {(closed || drill) && data.summary && <Summary summary={data.summary} zone={zone} closed={closed} />}
          {running && (
            <Board
              clocks={data.view.clocks}
              zone={zone}
              now={now}
              filed={Object.fromEntries((data.notices ?? []).filter((n) => n.status === 'filed' && n.record?.filedAt).map((n) => [n.stageKey, n.record.filedAt]))}
            />
          )}
          {(running || closed) && board && (
            <Evidence
              // Re-mount when the number of drafts changes, so new drafts open on "To review".
              key={board.fields.filter((f) => f.state === 'draft').length}
              board={board}
              readOnly={closed} assembling={busy} onAssemble={assemble} onOpenField={(field) => !closed && setScreen({ name: 'field', field })} />
          )}
          {incident && board && !closed && (
            <Questions
              questions={board.questions}
              busy={busy}
              onAsk={(fieldKey) => setScreen({ name: 'ask', fieldKey })}
              onCreateTask={createTask}
              onAnswer={(question) => setScreen({ name: 'answer', question })}
              onAssign={(question) => setScreen({ name: 'assign', question })}
            />
          )}
          {(running || closed) && (
            <Notices
              notices={data.notices}
              zone={zone}
              readOnly={closed}
              busy={busy}
              onDraft={draftNotice}
              onPreview={(n) => setScreen({ name: 'preview', notice: n })}
              onSignOff={(n) => setScreen({ name: 'signoff', notice: n })}
              onFile={(n) => setScreen({ name: 'file', notice: n })}
            />
          )}
          {incident && <Context />}
          {incident && (
            <div className="row meta" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              {running ? <button type="button" className="link" onClick={() => setScreen({ name: 'scope' })}>Change scope</button> : <span />}
              <span className="row" style={{ gap: 16 }}>
                {incident && !closed && !drill && (
                  <button type="button" className="link" onClick={() => setScreen({ name: 'close' })}>Close incident</button>
                )}
                <button type="button" className="link" onClick={() => setScreen({ name: 'audit' })}>Audit trail ({audit.length})</button>
              </span>
            </div>
          )}
        </>
      );
  }

  return <main className="app">{content}</main>;
}
