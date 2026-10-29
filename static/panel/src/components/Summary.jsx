// Drill scoreboard and post-incident summary: readiness against each deadline, and what was still unknown.
import React from 'react';
import { formatStamp } from '../time.js';

function margin(hours) {
  if (hours === null) return null;
  const abs = Math.abs(hours);
  const text = abs >= 48 ? `${Math.round(abs / 24)} days` : `${abs} h`;
  return hours >= 0 ? `${text} early` : `${text} late`;
}

export default function Summary({ summary, zone, closed }) {
  const drill = summary.mode === 'drill';
  return (
    <section className="card" aria-labelledby="summary-title">
      <div className="card-head">
        <h2 className="section-title grow" id="summary-title">{closed ? (drill ? 'Drill result' : 'Post-incident summary') : 'Drill score'}</h2>
        {drill && <span className="score" aria-label={`Score ${summary.score} out of 100`}>{summary.score}<span className="caption">/100</span></span>}
      </div>
      <div className="stats">
        <div><span className="stat">{summary.requiredReady}/{summary.requiredTotal}</span><span className="caption">required facts accepted</span></div>
        <div><span className="stat">{summary.notices.filter((n) => n.signedAt).length}/{summary.notices.length}</span><span className="caption">notices signed off</span></div>
        <div><span className="stat">{summary.questionsAnswered}/{summary.questionsAsked}</span><span className="caption">questions answered</span></div>
      </div>
      {summary.notices.filter((n) => n.filedAt).map((n) => (
        <div className="item" key={n.stageKey}>
          <span className="grow">{n.action} <span className="caption">· {n.regimeName}</span></span>
          <span className="caption">Filed {formatStamp(n.filedAt, zone)} · {margin(n.marginHours)}</span>
        </div>
      ))}
      {summary.stillOpen.length > 0 && (
        <p className="caption" style={{ paddingTop: 6 }}>
          {closed ? 'Never answered: ' : 'Still open: '}
          {summary.stillOpen.join(' · ')}
        </p>
      )}
      {drill && !closed && <p className="caption" style={{ paddingTop: 6 }}>Score: half for accepted facts, half for notices signed off before their deadline.</p>}
    </section>
  );
}
