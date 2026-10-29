// Sheets for notices and closing: choose the Confluence space, preview a draft, sign off, record filing, close.
import React, { useEffect, useState } from 'react';
import { call } from '../api.js';
import { formatDue, fromLocalInput, toLocalInput, zoneLabel } from '../time.js';

function Head({ kicker, title, intro, onBack }) {
  return (
    <div className="sheet-head">
      <button type="button" className="back" onClick={onBack}>‹ Back</button>
      {kicker && <span className="meta">{kicker}</span>}
      <h1 className="sheet-title">{title}</h1>
      {intro && <span className="meta">{intro}</span>}
    </div>
  );
}

function useSave(onDone) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const run = async (work) => {
    setError(null);
    setSaving(true);
    try {
      await onDone(await work());
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };
  return { saving, error, setError, run };
}

function Actions({ saving, error, onBack, label, danger }) {
  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className="btn quiet" onClick={onBack}>Cancel</button>
        <button type="submit" className={`btn ${danger ? 'quiet danger' : 'primary'}`} disabled={saving}>{saving ? 'Saving…' : label}</button>
      </div>
    </>
  );
}

export function SpacePicker({ issueKey, onDone, onBack }) {
  const [spaces, setSpaces] = useState(null);
  const [choice, setChoice] = useState('');
  const { saving, error, setError, run } = useSave(onDone);
  useEffect(() => {
    call('listSpaces')
      .then((list) => {
        setSpaces(list);
        if (list[0]) setChoice(list[0].id);
      })
      .catch((e) => setError(e.message));
  }, [setError]);
  const submit = (e) => {
    e.preventDefault();
    if (!choice) return setError('Choose a space.');
    return run(() => call('setSpace', { spaceId: choice }));
  };
  return (
    <form className="sheet" onSubmit={submit} noValidate>
      <Head kicker={`${issueKey} · Notices`} title="Where should notice drafts go?" intro="One Confluence space for every incident's drafts. Page permissions follow the space." onBack={onBack} />
      {spaces === null && !error && <p className="meta">Loading spaces…</p>}
      {spaces && spaces.length === 0 && <p className="meta">No Confluence spaces you can write to. Create one in Confluence first.</p>}
      {spaces && spaces.length > 0 && (
        <div className="field">
          <label htmlFor="space">Confluence space</label>
          <select id="space" className="select" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.key})</option>
            ))}
          </select>
        </div>
      )}
      <Actions saving={saving} error={error} onBack={onBack} label="Use this space" />
    </form>
  );
}

export function NoticePreview({ issueKey, notice, onBack }) {
  const [text, setText] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    call('composeNotice', { stageKey: notice.stageKey }).then((c) => setText(c.text)).catch((e) => setError(e.message));
  }, [notice.stageKey]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError('Copy is blocked here. Select the text and copy it instead.');
    }
  };
  return (
    <div className="sheet">
      <Head kicker={`${issueKey} · ${notice.regimeName}`} title={notice.action} intro="The current draft, built from the evidence as it stands. Nothing is sent." onBack={onBack} />
      {error && <p className="error" role="alert">{error}</p>}
      {text === null && !error && <p className="meta">Composing…</p>}
      {text && <pre className="notice-text">{text}</pre>}
      <div className="actions">
        {text && <button type="button" className="btn quiet" onClick={copy}>{copied ? 'Copied' : 'Copy text'}</button>}
        <button type="button" className="btn primary" onClick={onBack}>Done</button>
      </div>
    </div>
  );
}

export function SignOff({ issueKey, notice, onDone, onBack }) {
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const { saving, error, setError, run } = useSave(onDone);
  const submit = (e) => {
    e.preventDefault();
    if (!confirmed) return setError('Confirm that you reviewed the draft.');
    return run(() => call('signOffNotice', { stageKey: notice.stageKey, note }));
  };
  return (
    <form className="sheet" onSubmit={submit} noValidate>
      <Head kicker={`${issueKey} · ${notice.regimeName} · Sign-off`} title={notice.action} intro="Your name and the time go in the audit trail. The draft is frozen as signed; filing stays with your team." onBack={onBack} />
      <label className="group check" style={{ padding: '0 16px' }}>
        <span className="grow">I reviewed the draft in Confluence and it is ready to file.</span>
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
      </label>
      <div className="field">
        <label htmlFor="note">Note (optional)</label>
        <input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Reviewed with counsel" />
      </div>
      <Actions saving={saving} error={error} onBack={onBack} label="Sign off" />
    </form>
  );
}

export function FileForm({ issueKey, notice, zone, onDone, onBack }) {
  const [when, setWhen] = useState(() => toLocalInput(new Date().toISOString(), zone));
  const [reference, setReference] = useState('');
  const { saving, error, setError, run } = useSave(onDone);
  const submit = (e) => {
    e.preventDefault();
    const filedAt = fromLocalInput(when, zone);
    if (!filedAt) return setError('Enter a valid date and time.');
    return run(() => call('markNoticeFiled', { stageKey: notice.stageKey, filedAt, reference }));
  };
  return (
    <form className="sheet" onSubmit={submit} noValidate>
      <Head
        kicker={`${issueKey} · ${notice.regimeName}`}
        title="Record the filing"
        intro={`${notice.action}${notice.dueAt ? `, due ${formatDue(notice.dueAt, zone)}` : ''}. Reminders for this notice stop.`}
        onBack={onBack}
      />
      <div className="field">
        <label htmlFor="filed">Filed at ({zoneLabel(zone)})</label>
        <input id="filed" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ref">Regulator reference (optional)</label>
        <input id="ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={500} placeholder="e.g. case number from the portal" />
      </div>
      <Actions saving={saving} error={error} onBack={onBack} label="Mark as filed" />
    </form>
  );
}

export function CloseForm({ issueKey, drill, onDone, onBack }) {
  const [reason, setReason] = useState('');
  const { saving, error, setError, run } = useSave(onDone);
  const submit = (e) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Give the reason (at least 5 characters).');
    return run(() => call('closeIncident', { reason }));
  };
  return (
    <form className="sheet" onSubmit={submit} noValidate>
      <Head
        kicker={`${issueKey} · ${drill ? 'End drill' : 'Close incident'}`}
        title={drill ? 'End the drill' : 'Close the incident'}
        intro="Reminders stop and everything becomes read-only. The summary and audit trail stay."
        onBack={onBack}
      />
      <div className="field">
        <label htmlFor="close-reason">Reason</label>
        <input id="close-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={drill ? 'e.g. Practice finished' : 'e.g. All notices filed'} />
      </div>
      <Actions saving={saving} error={error} onBack={onBack} label={drill ? 'End drill' : 'Close incident'} />
    </form>
  );
}
