// One-task sheets: correct the awareness time, fill or review a field, ask/assign/answer a question.
// Each validates before sending, shows the server's message on failure, and returns to the panel on success.
import React, { useEffect, useState } from 'react';
import { call, nameOf, searchUsers } from '../api.js';
import { formatWhen, fromLocalInput, toLocalInput, zoneLabel } from '../time.js';
import { SourceLinks } from './Evidence.jsx';

function Sheet({ kicker, title, intro, onBack, children }) {
  return (
    <div className="sheet">
      <div className="sheet-head">
        <button type="button" className="back" onClick={onBack}>‹ Back</button>
        {kicker && <span className="meta">{kicker}</span>}
        <h1 className="sheet-title">{title}</h1>
        {intro && <span className="meta">{intro}</span>}
      </div>
      {children}
    </div>
  );
}

/** Runs a save: blocks double submits, shows the error message, calls onDone with the result. */
function useSave(onDone) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const run = async (work) => {
    setError(null);
    setSaving(true);
    try {
      onDone(await work());
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };
  return { saving, error, setError, run };
}

function Footer({ saving, error, onBack, label, extra }) {
  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        {extra}
        <button type="button" className="btn quiet" onClick={onBack}>Cancel</button>
        <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : label}</button>
      </div>
    </>
  );
}

export function CorrectTime({ issueKey, incident, onDone, onBack }) {
  const [value, setValue] = useState(() => toLocalInput(incident.awareAt, incident.timeZone));
  const [reason, setReason] = useState('');
  const { saving, error, setError, run } = useSave(onDone);
  const submit = (e) => {
    e.preventDefault();
    const awareAt = fromLocalInput(value, incident.timeZone);
    if (!awareAt) return setError('Enter a valid date and time.');
    if (reason.trim().length < 5) return setError('Give the reason (at least 5 characters). It goes in the audit trail.');
    return run(() => call('correctAwareness', { awareAt, reason }));
  };
  return (
    <form onSubmit={submit} noValidate>
      <Sheet
        kicker={`${issueKey} · Correct awareness time`}
        title="When did the team become aware?"
        intro={`Now recorded as ${formatWhen(incident.awareAt, incident.timeZone)}, ${zoneLabel(incident.timeZone)}. Every deadline moves with it.`}
        onBack={onBack}
      >
        <div className="field">
          <label htmlFor="aware">Awareness time ({zoneLabel(incident.timeZone)})</label>
          <input id="aware" className="input" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="reason">Reason</label>
          <input id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. SOC alert timestamp" />
        </div>
        <Footer saving={saving} error={error} onBack={onBack} label="Save time" />
      </Sheet>
    </form>
  );
}

export function FieldEditor({ issueKey, field, onDone, onBack, onAsk }) {
  const [value, setValue] = useState(field.value ?? '');
  const [sourceLabel, setSourceLabel] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const { saving, error, setError, run } = useSave(onDone);
  const needs = [...new Set(field.neededBy.map((n) => n.regimeName))].join(', ');

  const submit = (e) => {
    e.preventDefault();
    if (!value.trim()) return setError('Write what is known, or ask someone instead.');
    if (sourceUrl && !/^https:\/\/\S+$/.test(sourceUrl.trim())) return setError('Links must start with https://');
    const added = sourceLabel.trim() ? [{ kind: sourceUrl.trim() ? 'manual' : /^[A-Z][A-Z0-9_]+-\d+$/.test(sourceLabel.trim()) ? 'jira' : 'manual', label: sourceLabel.trim(), ...(sourceUrl.trim() ? { url: sourceUrl.trim() } : {}) }] : [];
    // Editing keeps the sources already recorded; a new source is added to them.
    const sources = value.trim() === field.value ? [...field.sources, ...added] : added.length ? added : field.sources;
    return run(() => call('setField', { fieldKey: field.key, value, sources }));
  };

  const accept = () => run(() => call('acceptDraft', { fieldKey: field.key }));

  return (
    <form onSubmit={submit} noValidate>
      <Sheet kicker={`${issueKey} · Evidence`} title={field.label} intro={field.prompt} onBack={onBack}>
        {field.state === 'draft' && (
          <div className="card">
            <span className="row"><span className="chip draft">Draft · review</span><span className="caption">by {nameOf(field.updatedBy)}</span></span>
            <span>{field.value}</span>
            <SourceLinks sources={field.sources} />
            <div className="actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn small primary" disabled={saving} onClick={accept}>Accept draft</button>
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="value">{field.state === 'draft' ? 'Or edit it' : 'What is known'}</label>
          <textarea id="value" className="textarea" value={value} onChange={(e) => setValue(e.target.value)} maxLength={4000} />
          {needs && <span className="hint">Needed by: {needs}.</span>}
        </div>
        <div className="field">
          <label htmlFor="source">Where it comes from (optional)</label>
          <input id="source" className="input" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="e.g. SEC-145, billing database count, Ana Reyes" />
          <label htmlFor="source-url" className="visually-hidden">Link to the source</label>
          <input id="source-url" className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Link (optional), https://…" inputMode="url" />
        </div>
        <Footer
          saving={saving}
          error={error}
          onBack={onBack}
          label="Save"
          extra={<button type="button" className="btn quiet" style={{ marginRight: 'auto' }} onClick={() => onAsk(field.key)}>Ask someone</button>}
        />
      </Sheet>
    </form>
  );
}

/** Search people in Jira; picks one account id. */
function PersonPicker({ value, onChange, label = 'Who can answer?' }) {
  const [query, setQuery] = useState(value ? nameOf(value) : '');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || (value && q === nameOf(value))) {
      setResults([]);
      return undefined;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchUsers(q)
        .then((users) => live && setResults(users))
        .finally(() => live && setSearching(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, value]);
  return (
    <div className="field">
      <label htmlFor="person">{label}</label>
      <input
        id="person"
        className="input"
        autoComplete="off"
        value={query}
        placeholder="Type a name"
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange(null);
        }}
      />
      {searching && <span className="hint">Searching…</span>}
      {results.length > 0 && (
        <div className="suggestions" role="listbox" aria-label="People">
          {results.map((u) => (
            <button
              type="button"
              role="option"
              aria-selected={value === u.accountId}
              key={u.accountId}
              onClick={() => {
                onChange(u.accountId);
                setQuery(u.displayName);
                setResults([]);
              }}
            >
              {u.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AskForm({ issueKey, fields, fieldKey, onDone, onBack }) {
  const [question, setQuestion] = useState(() => (fieldKey ? fields.find((f) => f.key === fieldKey)?.prompt ?? '' : ''));
  const [why, setWhy] = useState('');
  const [field, setField] = useState(fieldKey ?? '');
  const [owner, setOwner] = useState(null);
  const { saving, error, setError, run } = useSave(onDone);
  const submit = (e) => {
    e.preventDefault();
    if (question.trim().length < 3) return setError('Write the question.');
    return run(() => call('askQuestion', { question, why: why || null, fieldKey: field || null, ownerAccountId: owner }));
  };
  return (
    <form onSubmit={submit} noValidate>
      <Sheet kicker={`${issueKey} · Open question`} title="Ask a question" intro="It stays visible until someone answers it. You can turn it into a Jira task for the person who knows." onBack={onBack}>
        <div className="field">
          <label htmlFor="question">Question</label>
          <input id="question" className="input" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} />
        </div>
        <div className="field">
          <label htmlFor="why">Why this person, or why it matters (optional)</label>
          <input id="why" className="input" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} placeholder="e.g. Owns the backup service" />
        </div>
        <div className="field">
          <label htmlFor="field-key">The answer fills (optional)</label>
          <select id="field-key" className="select" value={field} onChange={(e) => setField(e.target.value)}>
            <option value="">No specific field</option>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>
        <PersonPicker value={owner} onChange={setOwner} />
        <Footer saving={saving} error={error} onBack={onBack} label="Add question" />
      </Sheet>
    </form>
  );
}

export function AssignForm({ issueKey, question, onDone, onBack }) {
  const [owner, setOwner] = useState(question.ownerAccountId);
  const { saving, error, setError, run } = useSave(onDone);
  const submit = (e) => {
    e.preventDefault();
    if (!owner) return setError('Choose a person from the list.');
    return run(() => call('assignQuestion', { id: question.id, ownerAccountId: owner }));
  };
  return (
    <form onSubmit={submit} noValidate>
      <Sheet kicker={`${issueKey} · Open question`} title={question.question} onBack={onBack}>
        <PersonPicker value={owner} onChange={setOwner} />
        <Footer saving={saving} error={error} onBack={onBack} label="Assign" />
      </Sheet>
    </form>
  );
}

export function AnswerForm({ issueKey, question, fieldLabel, onDone, onBack }) {
  const [answer, setAnswer] = useState('');
  const [dismissing, setDismissing] = useState(false);
  const { saving, error, setError, run } = useSave(onDone);
  const submit = (e) => {
    e.preventDefault();
    if (dismissing) {
      if (answer.trim().length < 5) return setError('Say why it is no longer needed (at least 5 characters).');
      return run(() => call('dismissQuestion', { id: question.id, reason: answer }));
    }
    if (!answer.trim()) return setError('Write the answer.');
    return run(() => call('answerQuestion', { id: question.id, answer }));
  };
  return (
    <form onSubmit={submit} noValidate>
      <Sheet
        kicker={`${issueKey} · Open question${question.taskKey ? ` · ${question.taskKey}` : ''}`}
        title={question.question}
        intro={fieldLabel && !dismissing ? `The answer becomes a draft of “${fieldLabel}” for review.` : null}
        onBack={onBack}
      >
        <div className="segmented" role="radiogroup" aria-label="Answer or dismiss">
          <label className={!dismissing ? 'on' : ''}><input type="radio" name="mode" checked={!dismissing} onChange={() => setDismissing(false)} />Answer</label>
          <label className={dismissing ? 'on' : ''}><input type="radio" name="mode" checked={dismissing} onChange={() => setDismissing(true)} />No longer needed</label>
        </div>
        <div className="field">
          <label htmlFor="answer">{dismissing ? 'Why it is no longer needed' : 'Answer'}</label>
          <textarea id="answer" className="textarea" value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={4000} />
          {!dismissing && <span className="hint">Say how you know. This can end up in a regulator notice.</span>}
        </div>
        <Footer saving={saving} error={error} onBack={onBack} label={dismissing ? 'Dismiss question' : 'Save answer'} />
      </Sheet>
    </form>
  );
}
