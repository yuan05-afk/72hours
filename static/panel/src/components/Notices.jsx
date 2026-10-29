// Notices: one row per regulator notice the scope calls for. Draft it into Confluence, sign it off once every required
// fact is accepted, then record when your team filed it. The app drafts; people decide and file.
import React from 'react';
import { nameOf, openExternal } from '../api.js';
import { formatDue, formatStamp } from '../time.js';

const STATUS = {
  none: { dot: 'idle', label: 'Not drafted' },
  draft: { dot: 'urgent', label: 'Drafted' },
  ready: { dot: 'running', label: 'Signed off · ready to file' },
  filed: { dot: 'running', label: 'Filed' },
};

export default function Notices({ notices, zone, readOnly, busy, onDraft, onPreview, onSignOff, onFile }) {
  if (!notices.length) return null;
  return (
    <section className="card" aria-labelledby="notices-title">
      <div className="card-head">
        <h2 className="section-title grow" id="notices-title">Notices</h2>
        <span className="meta">Drafts only. People sign off and file.</span>
      </div>
      {notices.map((n) => {
        const status = STATUS[n.status];
        const r = n.record;
        const detail =
          n.status === 'filed'
            ? `Filed ${formatStamp(r.filedAt, zone)} by ${nameOf(r.filedBy)}${r.filedReference ? ` · ref ${r.filedReference}` : ''}`
            : n.status === 'ready'
              ? `Signed off by ${nameOf(r.signedBy)} ${formatStamp(r.signedAt, zone)}`
              : n.missing.length
                ? `${n.missing.length} required item${n.missing.length === 1 ? '' : 's'} still missing`
                : n.mapped
                  ? 'Every required item accepted'
                  : 'Use the regulator’s own form; deadline tracked here';
        return (
          <div className="item" key={n.stageKey} style={{ flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span className={`dot small ${status.dot}`} aria-hidden="true" style={{ marginTop: 6 }} />
              <div className="grow stack">
                <span style={{ fontWeight: 500 }}>{n.action}</span>
                <span className="caption">
                  {n.citationLabel.startsWith(n.regimeName.split(' ')[0]) ? n.citationLabel : `${n.regimeName} · ${n.citationLabel}`}
                  {n.dueAt ? ` · due ${formatDue(n.dueAt, zone)}` : ''}
                </span>
                <span className="caption">
                  {status.label}. {detail}.
                  {r?.pageUrl && (
                    <>
                      {' '}
                      <button type="button" className="link" onClick={() => openExternal(r.pageUrl)}>Open draft</button>
                    </>
                  )}
                </span>
              </div>
            </div>
            {!readOnly && n.status !== 'filed' && (
              <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" className="btn small quiet" aria-label={`Preview ${n.regimeName}: ${n.action}`} onClick={() => onPreview(n)}>Preview</button>
                {(n.status === 'none' || n.status === 'draft') && (
                  <button type="button" className="btn small tint" disabled={busy} aria-label={`${n.status === 'none' ? 'Draft' : 'Update draft of'} ${n.regimeName}: ${n.action} in Confluence`} onClick={() => onDraft(n)}>
                    {n.status === 'none' ? 'Draft in Confluence' : 'Update draft'}
                  </button>
                )}
                {n.status === 'draft' && (
                  <button type="button" className="btn small primary" disabled={n.missing.length > 0} title={n.missing.length ? 'Fill and accept every required item first' : undefined} aria-label={`Sign off ${n.regimeName}: ${n.action}`} onClick={() => onSignOff(n)}>
                    Sign off
                  </button>
                )}
                {n.status === 'ready' && (
                  <button type="button" className="btn small primary" aria-label={`Mark ${n.regimeName}: ${n.action} as filed`} onClick={() => onFile(n)}>Mark as filed</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
