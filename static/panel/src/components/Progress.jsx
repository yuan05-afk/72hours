// The five-step strip at the top of the panel: where the team is in the breach response, and the one thing to do next.
import React from 'react';
import { progressOf } from '../progress.js';

export default function Progress({ data }) {
  const { steps, next } = progressOf(data);
  return (
    <nav className="progress-steps" aria-label="Breach response steps">
      <ol>
        {steps.map((s, i) => (
          <li key={s.key} className={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
            <span className="step-mark" aria-hidden="true">{s.state === 'done' ? '✓' : i + 1}</span>
            <span className="step-text">
              <span className="step-label">{s.label}</span>
              <span className="step-detail">{s.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      {next && (
        <p className="step-next">
          <span className="step-next-kicker">Next</span> {next}
        </p>
      )}
    </nav>
  );
}
