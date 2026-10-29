// Evidence: every notice field the applicable regulators require, what is known, and where it came from.
// Gaps stay visible until someone fills them; drafts (from Clerk or answered questions) wait for a person to accept.
import React, { useState } from 'react';
import { nameOf, openExternal, openIssue } from '../api.js';

const COLLAPSED = 6;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

export function SourceLinks({ sources }) {
  if (!sources.length) return null;
  return (
    <span className="caption">
      From{' '}
      {sources.map((source, i) => (
        <React.Fragment key={`${source.label}-${i}`}>
          {i > 0 && ', '}
          {source.url ? (
            <button type="button" className="link" onClick={() => openExternal(source.url)}>{source.label}</button>
          ) : source.kind === 'jira' && ISSUE_KEY.test(source.label) ? (
            <button type="button" className="link" onClick={() => openIssue(source.label)}>{source.label}</button>
          ) : (
            source.label
          )}
        </React.Fragment>
      ))}
    </span>
  );
}

const TABS = [
  { key: 'draft', label: 'To review' },
  { key: 'gap', label: 'Missing' },
  { key: 'filled', label: 'Filled' },
];

/** Blocking gaps before the "only if late" ones; otherwise rulebook order. */
const byNeed = (a, b) => Number(b.blocking) - Number(a.blocking);

function FilledRow({ field, onOpen }) {
  return (
    <div className="item">
      <div className="grow stack">
        <span className="row">
          <span className="caption grow">{field.label}</span>
          {field.state === 'draft' && <span className="chip draft">Draft · review</span>}
        </span>
        <span>{field.value}</span>
        {field.sources.length ? <SourceLinks sources={field.sources} /> : <span className="caption">Entered by {nameOf(field.updatedBy)}</span>}
      </div>
      <button type="button" className="btn small tint" onClick={() => onOpen(field)} aria-label={`${field.state === 'draft' ? 'Review' : 'Edit'} ${field.label}`}>
        {field.state === 'draft' ? 'Review' : 'Edit'}
      </button>
    </div>
  );
}

function GapRow({ field, onOpen }) {
  return (
    <div className="item" style={{ alignItems: 'center', padding: '6px 0' }}>
      <span className={`dot small ${field.blocking ? 'idle' : ''}`} aria-hidden="true" style={field.blocking ? undefined : { opacity: 0 }} />
      <span className="grow">
        {field.label}
        {!field.blocking && (
          <span className="caption">
            {field.neededBy.some((n) => n.need === 'ifAvailable') ? ' · where available' : ' · only if the notice is late'}
          </span>
        )}
      </span>
      <button type="button" className="btn small tint" onClick={() => onOpen(field)} aria-label={`Add ${field.label}`}>Add</button>
    </div>
  );
}

export default function Evidence({ board, onOpenField, onAssemble, assembling, readOnly }) {
  const required = board.fields.filter((f) => f.neededBy.some((n) => n.need === 'required'));
  const ready = required.filter((f) => f.state === 'filled').length;
  const pct = required.length ? Math.round((ready / required.length) * 100) : 0;
  const groups = {
    draft: board.fields.filter((f) => f.state === 'draft'),
    gap: board.fields.filter((f) => f.state === 'gap').sort(byNeed),
    filled: board.fields.filter((f) => f.state === 'filled'),
  };
  const [tab, setTab] = useState(() => (groups.draft.length ? 'draft' : groups.gap.length ? 'gap' : 'filled'));
  const [expanded, setExpanded] = useState(false);
  const list = groups[tab];
  const shown = expanded ? list : list.slice(0, COLLAPSED);

  return (
    <section className="card" aria-labelledby="evidence-title">
      <div className="card-head">
        <h2 className="section-title" id="evidence-title">Evidence</h2>
        <span className="meta">{ready} of {required.length} ready</span>
        <div className="progress" role="img" aria-label={`${pct} percent of required fields filled and accepted`}>
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
      {!readOnly && groups.gap.length > 0 && (
        <div className="row" style={{ justifyContent: 'space-between', paddingBottom: 8, flexWrap: 'wrap' }}>
          <span className="caption grow">Clerk reads the incident, its comments, linked work and Confluence, then drafts what it finds, with sources.</span>
          <button type="button" className="btn small tint" disabled={assembling} onClick={onAssemble}>
            {assembling ? 'Reading sources…' : 'Assemble evidence'}
          </button>
        </div>
      )}
      {board.fields.length === 0 ? (
        <p className="meta">No notice fields apply yet. Answer the scoping questions to see them.</p>
      ) : (
        <>
          <div className="segmented" role="radiogroup" aria-label="Show evidence fields" style={{ marginBottom: 6 }}>
            {TABS.map((t) => (
              <label key={t.key} className={tab === t.key ? 'on' : ''}>
                <input
                  type="radio"
                  name="evidence-tab"
                  checked={tab === t.key}
                  onChange={() => {
                    setTab(t.key);
                    setExpanded(false);
                  }}
                />
                {t.label} {groups[t.key].length}
              </label>
            ))}
          </div>
          {list.length === 0 && (
            <p className="meta" style={{ padding: '8px 0' }}>
              {tab === 'draft' ? 'No drafts waiting for review.' : tab === 'gap' ? 'Nothing missing. Every field has a value.' : 'Nothing filled yet.'}
            </p>
          )}
          {shown.map((field) =>
            tab === 'gap' ? <GapRow key={field.key} field={field} onOpen={onOpenField} /> : <FilledRow key={field.key} field={field} onOpen={onOpenField} />,
          )}
          {list.length > COLLAPSED && (
            <button type="button" className="link meta" style={{ paddingTop: 6 }} onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show fewer' : `Show all ${list.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
