// The deadline board: one row per notification deadline, counting down in the organisation's time zone.
// Tap a row for its legal basis. Deadlines come from the rulebook, never from AI, and the board says so.
import React, { useState } from 'react';
import { openExternal } from '../api.js';
import { earlyBy, formatDue, formatStamp, remaining, zoneLabel } from '../time.js';

const VISIBLE = 4;
const DAY = 24 * 3_600_000;

function Countdown({ clock, now }) {
  if (clock.status === 'asap') return <span className="digits"><span className="word">No fixed limit</span></span>;
  if (!clock.dueAt) return <span className="digits"><span className="word">Waiting</span></span>;
  const left = remaining(clock.dueAt, now);
  const tone = left.overdue ? 'overdue' : left.ms < DAY ? 'urgent' : '';
  const label = `${clock.regimeName}, ${clock.action}: ${left.overdue ? 'overdue by' : ''} ${left.h} hours ${left.m} minutes${left.overdue ? '' : ' left'}`;
  return (
    <span className={`digits ${tone}`} role="img" aria-label={label}>
      {left.overdue && <span className="word">Overdue&nbsp;</span>}
      {left.h >= 100 ? (
        // Past 99 hours, days read faster than a long hour count.
        <span className="hm">{Math.floor(left.h / 24)}d {left.h % 24}h</span>
      ) : (
        <>
          <span className="hm">{left.hm}</span>
          <span className="s">:{left.s}</span>
        </>
      )}
    </span>
  );
}

function dotFor(clock, now, filedAt) {
  if (filedAt) return 'running';
  if (!clock.dueAt) return 'idle';
  const ms = Date.parse(clock.dueAt) - now;
  if (ms < 0) return 'breach';
  return ms < DAY ? 'urgent' : 'running';
}

/** A filed notice's clock has stopped: say when it was filed and how much time was left. */
function Filed({ clock, filedAt }) {
  const early = earlyBy(clock.dueAt, filedAt);
  return (
    <span className="digits filed" role="img" aria-label={`${clock.regimeName}, ${clock.action}: filed${early ? `, ${early} early` : ''}`}>
      <span className="hm">✓ Filed</span>
      {early && <span className="s">&nbsp;{early} early</span>}
    </span>
  );
}

function Row({ clock, now, zone, open, onToggle, filedAt }) {
  const id = `clock-${clock.stageKey}`;
  const sub = filedAt
    ? `${clock.regimeName} · Filed ${formatStamp(filedAt, zone)}${clock.dueAt ? ` · was due ${formatDue(clock.dueAt, zone)}` : ''}`
    : clock.dueAt
    ? `${clock.regimeName} · Due ${formatDue(clock.dueAt, zone)}`
    : clock.status === 'asap'
      ? `${clock.regimeName} · ${clock.basis}`
      : `${clock.regimeName} · ${clock.basis}; starts when that happens`;
  return (
    <>
      <button type="button" className="board-row" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span className={`dot small ${dotFor(clock, now, filedAt)}`} aria-hidden="true" />
        <span className="grow">
          <span className="board-name">{clock.action}</span>
          <span className="board-sub">{sub}</span>
        </span>
        {filedAt ? <Filed clock={clock} filedAt={filedAt} /> : <Countdown clock={clock} now={now} />}
      </button>
      {open && (
        <div className="board-detail" id={id}>
          <span className="board-sub">{clock.basis}. To: {clock.recipient}.</span>
          <span className="quote">“{clock.citation.quote}”</span>
          <span className="board-sub">
            <button type="button" className="link" onClick={() => openExternal(clock.citation.url)}>{clock.citation.label}</button>
            {' '}· checked {clock.lastVerified}
          </span>
          {clock.assumptions.map((a) => (
            <span key={a} className="board-sub">Assumption: {a}</span>
          ))}
        </div>
      )}
    </>
  );
}

/** `filed` maps a stage key to when its notice was filed; those clocks show as stopped. */
export default function Board({ clocks, zone, now, filed = {} }) {
  const [open, setOpen] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? clocks : clocks.slice(0, VISIBLE);
  const hidden = clocks.length - shown.length;
  return (
    <section className="board" aria-label="Deadlines">
      {shown.map((clock) => (
        <Row
          key={clock.stageKey}
          clock={clock}
          now={now}
          zone={zone}
          filedAt={filed[clock.stageKey]}
          open={open === clock.stageKey}
          onToggle={() => setOpen(open === clock.stageKey ? null : clock.stageKey)}
        />
      ))}
      <div className="board-foot">
        {hidden > 0 ? (
          <button type="button" className="link" onClick={() => setShowAll(true)}>
            {hidden} later deadline{hidden === 1 ? '' : 's'} ›
          </button>
        ) : showAll && clocks.length > VISIBLE ? (
          <button type="button" className="link" onClick={() => setShowAll(false)}>Show fewer</button>
        ) : (
          <span />
        )}
        <span className="caption">Calculated from the cited law · {zoneLabel(zone)}</span>
      </div>
    </section>
  );
}
