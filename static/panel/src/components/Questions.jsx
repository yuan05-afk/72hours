// Open questions: the facts nobody has yet, each with the person best placed to answer and one clear next step.
import React, { useState } from 'react';
import { firstName, nameOf, openIssue } from '../api.js';

function initials(accountId) {
  if (!accountId) return '';
  return nameOf(accountId)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

function Avatar({ accountId }) {
  return accountId ? (
    <span className="avatar" aria-hidden="true">{initials(accountId)}</span>
  ) : (
    <span className="avatar none" aria-hidden="true" />
  );
}

export default function Questions({ questions, busy, onAsk, onCreateTask, onAnswer, onAssign }) {
  const [showClosed, setShowClosed] = useState(false);
  const open = questions.filter((q) => q.status === 'open');
  const closed = questions.filter((q) => q.status !== 'open');

  return (
    <section className="card" aria-labelledby="questions-title">
      <div className="card-head">
        <h2 className="section-title grow" id="questions-title">
          Open questions <span className="meta" style={{ fontWeight: 400 }}>· {open.length}</span>
        </h2>
        <button type="button" className="btn small quiet" onClick={() => onAsk(null)}>Ask a question</button>
      </div>
      {open.length === 0 && <p className="meta">Nothing open. Ask a question when a fact is missing; it can become a Jira task.</p>}
      {open.map((q) => {
        const who = q.ownerAccountId ? nameOf(q.ownerAccountId) : 'No owner yet';
        const why = [who, q.why].filter(Boolean).join(' · ');
        return (
          <div className="item" key={q.id} style={{ alignItems: 'center' }}>
            <Avatar accountId={q.ownerAccountId} />
            <div className="grow stack">
              <span style={{ fontWeight: 500 }}>{q.question}</span>
              <span className="caption">{why}</span>
              {q.taskKey && (
                <span className="caption">
                  <button type="button" className="link" onClick={() => openIssue(q.taskKey)}>{q.taskKey}</button>
                  {q.taskDone ? ' is done. Record the answer.' : ' is open.'}
                </span>
              )}
            </div>
            {q.taskKey ? (
              <button type="button" className="btn small tint" aria-label={`Record answer: ${q.question}`} onClick={() => onAnswer(q)}>Record answer</button>
            ) : q.ownerAccountId ? (
              <button type="button" className="btn small tint" disabled={busy} aria-label={`Ask ${nameOf(q.ownerAccountId)} in a Jira task: ${q.question}`} onClick={() => onCreateTask(q)}>
                Ask {firstName(q.ownerAccountId)}
              </button>
            ) : (
              <button type="button" className="btn small tint" aria-label={`Assign: ${q.question}`} onClick={() => onAssign(q)}>Assign</button>
            )}
          </div>
        );
      })}
      {closed.length > 0 && (
        <>
          <button type="button" className="link meta" style={{ paddingTop: 6 }} aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? 'Hide' : 'Show'} {closed.length} answered or dismissed
          </button>
          {showClosed &&
            closed.map((q) => (
              <div className="item" key={q.id}>
                <div className="grow stack">
                  <span className="muted">{q.question}</span>
                  <span className="caption">
                    {q.status === 'answered' ? `Answered by ${nameOf(q.resolvedBy)}: ` : `Dismissed by ${nameOf(q.resolvedBy)}: `}
                    {q.answer}
                  </span>
                </div>
              </div>
            ))}
        </>
      )}
    </section>
  );
}
