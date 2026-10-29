// The scoping check: a few rough answers decide which regulators' deadlines apply. A live preview shows exactly
// which deadlines will start before anyone commits. Every answer can be changed later, with a reason, and is logged.
import React, { useEffect, useMemo, useState } from 'react';
import { call } from '../api.js';
import { COUNTRIES, countryName } from '../countries.js';
import { formatWhen, fromLocalInput, isValidZone, span, toLocalInput, viewerZone, zoneLabel } from '../time.js';

const RISKS = [
  { value: 'unlikely', label: 'Unlikely to harm anyone' },
  { value: 'risk', label: 'Some risk' },
  { value: 'high', label: 'High risk' },
];

const ORG_FLAGS = [
  { key: 'nis2SignificantIncident', label: 'We are an essential or important entity under NIS2, and this is a significant incident' },
  { key: 'nis2TrustServiceProvider', label: 'We are a trust service provider under NIS2' },
  { key: 'hipaaCoveredEntity', label: 'US health information is involved and we are a HIPAA covered entity' },
  { key: 'hipaaBusinessAssociate', label: 'We are a HIPAA business associate' },
  { key: 'moreThan500InOneState', label: 'More than 500 residents of one US State are affected', onlyFor: 'US' },
  { key: 'secRegistrant', label: 'We file reports with the SEC (Form 8-K)' },
];

const ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

const blankScope = {
  subjectCountries: [],
  approxSubjects: '',
  riskLevel: 'risk',
  sensitiveData: false,
  identityFraudRisk: false,
  hipaaCoveredEntity: false,
  hipaaBusinessAssociate: false,
  moreThan500InOneState: false,
  nis2SignificantIncident: false,
  nis2TrustServiceProvider: false,
  secRegistrant: false,
};

function CountryPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return COUNTRIES.filter((c) => !value.includes(c.code) && (c.name.toLowerCase().startsWith(q) || c.code.toLowerCase() === q)).slice(0, 6);
  }, [query, value]);
  const add = (code) => {
    onChange([...value, code]);
    setQuery('');
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="tags">
        {value.map((code) => (
          <span className="tag" key={code}>
            {countryName(code)}
            <button type="button" aria-label={`Remove ${countryName(code)}`} onClick={() => onChange(value.filter((c) => c !== code))}>×</button>
          </span>
        ))}
        <label htmlFor="country" className="visually-hidden">Add a country</label>
        <input
          id="country"
          type="text"
          autoComplete="off"
          placeholder={value.length ? 'Add another country' : 'Type a country'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) {
              e.preventDefault();
              add(matches[0].code);
            }
            if (e.key === 'Backspace' && !query && value.length) onChange(value.slice(0, -1));
          }}
        />
      </div>
      {matches.length > 0 && (
        <div className="suggestions" role="listbox" aria-label="Matching countries">
          {matches.map((c) => (
            <button type="button" role="option" aria-selected="false" key={c.code} onClick={() => add(c.code)}>{c.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Check({ checked, onChange, children }) {
  return (
    <label className="check">
      <span className="grow">{children}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Preview({ clocks, awareAt, zone, error }) {
  if (error) return <p className="hint">{error}</p>;
  if (!clocks) return null;
  return (
    <section className="preview" aria-label="Deadlines that will start" aria-live="polite">
      <div className="preview-head">
        {clocks.length ? `These deadlines will start, counted from ${formatWhen(awareAt, zone)}` : 'No notification deadline applies to these answers.'}
      </div>
      {clocks.map((c) => {
        const length = c.dueAt ? span(awareAt, c.dueAt) : c.status === 'asap' ? 'ASAP' : 'Later';
        const urgent = c.dueAt && Date.parse(c.dueAt) - Date.parse(awareAt) <= 24 * 3_600_000;
        return (
          <div className="preview-row" key={c.stageKey}>
            <span className={`span ${urgent ? 'urgent' : ''}`}>{length}</span>
            <span className="grow stack" style={{ gap: 2 }}>
              <span>{c.action}</span>
              <span className="cite">
                {c.citation.label.startsWith(c.regimeName.split(' ')[0]) ? c.citation.label : `${c.regimeName} · ${c.citation.label}`}
              </span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

export default function ScopeForm({ issueKey, incident, onDone, onCancel }) {
  const updating = incident?.status === 'running';
  const [scope, setScope] = useState(() => (incident?.scope ? { ...incident.scope } : { ...blankScope }));
  const [zone, setZone] = useState(() => incident?.timeZone ?? viewerZone());
  const [aware, setAware] = useState(() => toLocalInput(incident?.awareAt ?? new Date().toISOString(), incident?.timeZone ?? viewerZone()));
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // Opened once if any organisation answer is already yes; after that the user controls it.
  const [orgOpen] = useState(() => ORG_FLAGS.some((f) => incident?.scope?.[f.key]));

  const set = (key, value) => setScope((s) => ({ ...s, [key]: value }));
  const awareAt = updating ? incident.awareAt : isValidZone(zone) ? fromLocalInput(aware, zone) : null;
  const approx = Number(scope.approxSubjects);
  const payloadScope = { ...scope, approxSubjects: approx, moreThan500InOneState: scope.subjectCountries.includes('US') && scope.moreThan500InOneState };
  const complete = scope.subjectCountries.length > 0 && Number.isInteger(approx) && approx > 0 && awareAt;
  const previewKey = complete ? JSON.stringify([payloadScope, awareAt, zone]) : null;

  // Live preview, debounced so typing a number does not send a request per keystroke.
  useEffect(() => {
    if (!previewKey) {
      setPreview(null);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      call('previewClocks', { scope: payloadScope, awareAt, timeZone: updating ? incident.timeZone : zone })
        .then((clocks) => live && (setPreview(clocks), setPreviewError(null)))
        .catch((e) => live && setPreviewError(e.message));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // previewKey captures every input of the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    if (!complete) {
      setError('Add at least one country, a rough number of people, and a valid awareness time.');
      return;
    }
    if (updating && reason.trim().length < 5) {
      setError('Say briefly why the scope changed (at least 5 characters). It goes in the audit trail.');
      return;
    }
    setSaving(true);
    try {
      const view = updating
        ? await call('updateScope', { scope: payloadScope, reason })
        : await call('startClock', { scope: payloadScope, awareAt, timeZone: zone });
      onDone(view);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }


  return (
    <form className="sheet" onSubmit={submit} noValidate>
      <div className="sheet-head">
        <button type="button" className="back" onClick={onCancel}>‹ Back</button>
        <span className="meta">{issueKey} · {updating ? 'Change scope' : 'Start breach clock'}</span>
        <h1 className="sheet-title">{updating ? 'Change the answers that set the deadlines' : 'A few answers set the deadlines'}</h1>
        <span className="meta">Rough answers are fine. You can change them later, and every change is logged.</span>
      </div>

      <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="legend" style={{ paddingBottom: 6 }}>What kind of data was involved?</legend>
        <div className="group">
          <Check checked={scope.sensitiveData} onChange={(v) => set('sensitiveData', v)}>
            Health, government ID, financial or other sensitive information
          </Check>
          <Check checked={scope.identityFraudRisk} onChange={(v) => set('identityFraudRisk', v)}>
            Anything usable for identity fraud: ID or account numbers, passwords
          </Check>
        </div>
        <span className="hint">Leave both unticked for contact details or other ordinary personal data.</span>
      </fieldset>

      <div className="field">
        <span className="legend">Where do the affected people live?</span>
        <CountryPicker value={scope.subjectCountries} onChange={(v) => set('subjectCountries', v)} />
      </div>

      <div className="field">
        <label htmlFor="approx">Roughly how many people?</label>
        <input
          id="approx"
          className="input"
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          placeholder="e.g. 1200"
          value={scope.approxSubjects}
          onChange={(e) => set('approxSubjects', e.target.value)}
        />
        <span className="hint">500 or more changes some rules (HIPAA, Singapore).</span>
      </div>

      <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="legend" style={{ paddingBottom: 6 }}>How serious is it for the people affected?</legend>
        <div className="segmented">
          {RISKS.map((r) => (
            <label key={r.value} className={scope.riskLevel === r.value ? 'on' : ''}>
              <input type="radio" name="risk" value={r.value} checked={scope.riskLevel === r.value} onChange={() => set('riskLevel', r.value)} />
              {r.label}
            </label>
          ))}
        </div>
        <span className="hint">“Unlikely” means GDPR and UK GDPR do not require notifying the regulator. The DPO confirms.</span>
      </fieldset>

      <details className="org" open={orgOpen}>
        <summary>About your organisation</summary>
        {ORG_FLAGS.filter((f) => !f.onlyFor || scope.subjectCountries.includes(f.onlyFor)).map((f) => (
          <Check key={f.key} checked={scope[f.key]} onChange={(v) => set(f.key, v)}>{f.label}</Check>
        ))}
      </details>

      {updating ? (
        <div className="field">
          <label htmlFor="reason">Why are the answers changing?</label>
          <input id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Billing count confirmed 340 people in Ireland" />
          <span className="hint">Awareness stays {formatWhen(incident.awareAt, incident.timeZone)} ({zoneLabel(incident.timeZone)}). Correct it from the panel.</span>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="aware">When did the team become aware?</label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input id="aware" className="input" style={{ flex: '1 1 200px' }} type="datetime-local" value={aware} onChange={(e) => setAware(e.target.value)} />
            <label htmlFor="zone" className="visually-hidden">Time zone</label>
            <select id="zone" className="select" style={{ flex: '1 1 200px' }} value={zone} onChange={(e) => setZone(e.target.value)}>
              {(ZONES.includes(zone) ? ZONES : [zone, ...ZONES]).map((z) => (
                <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <span className="hint">
            {incident?.status === 'detected'
              ? 'Pre-filled with when the issue was flagged. If the team knew earlier, use the earlier time.'
              : 'The earliest moment the team was reasonably sure personal data was affected.'}
          </span>
        </div>
      )}

      <Preview clocks={preview} awareAt={awareAt} zone={updating ? incident.timeZone : zone} error={previewError} />

      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className="btn quiet" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : updating ? 'Save changes' : 'Start breach clock'}
        </button>
      </div>
    </form>
  );
}
