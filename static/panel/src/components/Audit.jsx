// The audit trail in plain words: who changed what, when, and why. Append-only on the server; read-only here.
import React from 'react';
import { nameOf } from '../api.js';
import { formatStamp, formatWhen, zoneLabel } from '../time.js';

const FIELD = (d) => String(d.field ?? '').replace(/([A-Z])/g, ' $1').toLowerCase();

function describe(entry, zone) {
  const d = entry.detail ?? {};
  switch (entry.action) {
    case 'incident.detected':
      return `flagged the incident (label added). Awareness recorded as ${formatWhen(d.awareAt, zone)}.`;
    case 'clock.started':
      return `started the clocks for ${(d.regimes ?? []).join(', ').toUpperCase() || 'no regime'}, aware since ${formatWhen(d.awareAt, zone)}.`;
    case 'awareness.corrected':
      return `corrected awareness from ${formatWhen(d.from, zone)} to ${formatWhen(d.to, zone)}. Reason: ${d.reason}`;
    case 'scope.updated':
      return `changed the scope. Reason: ${d.reason}`;
    case 'evidence.set':
      return `${d.to?.state === 'draft' ? 'drafted' : 'filled'} “${FIELD(d)}”.`;
    case 'evidence.accepted':
      return `accepted the draft of “${FIELD(d)}”.`;
    case 'question.asked':
      return `asked: ${d.question}`;
    case 'question.assigned':
      return `assigned a question to ${nameOf(d.to)}.`;
    case 'question.answered':
      return `answered a question: ${d.answer}`;
    case 'question.dismissed':
      return `dismissed a question. Reason: ${d.reason}`;
    case 'question.taskCreated':
      return `created task ${d.taskKey}.`;
    case 'question.taskDone':
      return `noted that ${d.taskKey} is done.`;
    case 'drill.started':
      return 'started a drill on sample data.';
    case 'drill.ended':
      return `ended the drill. Reason: ${d.reason}`;
    case 'incident.closed':
      return `closed the incident. Reason: ${d.reason}`;
    case 'notice.drafted':
      return `${d.updated ? 'updated' : 'created'} the Confluence draft for ${d.stage}${d.missing?.length ? ` (${d.missing.length} items missing)` : ''}.`;
    case 'notice.signedOff':
      return `signed off ${d.stage}${d.note ? `. Note: ${d.note}` : ''}.`;
    case 'notice.filed':
      return `recorded ${d.stage} as filed${d.reference ? ` (ref ${d.reference})` : ''}.`;
    case 'reminder.sent':
      return `posted a ${d.threshold === 'overdue' ? 'deadline passed' : `${d.threshold} reminder`} (${d.stage}).`;
    default:
      return entry.action.startsWith('event.') ? `recorded ${entry.action.slice(6)} at ${formatWhen(d.to, zone)}.` : entry.action;
  }
}

export default function Audit({ issueKey, entries, zone, onBack }) {
  return (
    <div className="sheet">
      <div className="sheet-head">
        <button type="button" className="back" onClick={onBack}>‹ Back</button>
        <span className="meta">{issueKey} · Audit trail</span>
        <h1 className="sheet-title">Every change, who made it and why</h1>
        <span className="meta">Entries cannot be edited or deleted. Times in {zoneLabel(zone)}.</span>
      </div>
      <section className="card" aria-label="Audit trail">
        {entries.length === 0 && <p className="meta">Nothing recorded yet.</p>}
        {entries.map((entry, i) => (
          <div className="audit-item" key={`${entry.at}-${i}`}>
            <span className="caption">{formatStamp(entry.at, zone)}</span>
            <span><strong style={{ fontWeight: 500 }}>{nameOf(entry.actor)}</strong> {describe(entry, zone)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
