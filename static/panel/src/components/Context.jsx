// Context from Teamwork Graph: the people on this incident and what they have been working on, plus linked work.
// Loaded on demand, because it reads across Jira and Confluence.
import React, { useState } from 'react';
import { call, loadNames, nameOf, openExternal, openIssue } from '../api.js';

export default function Context() {
  const [state, setState] = useState({ status: 'idle' });

  async function load() {
    setState({ status: 'loading' });
    try {
      const data = await call('getContext');
      await loadNames(data.people.map((p) => p.accountId));
      setState({ status: 'ready', data });
    } catch (e) {
      setState({ status: 'error', message: e.message });
    }
  }

  return (
    <section className="card" aria-labelledby="context-title">
      <div className="card-head">
        <h2 className="section-title grow" id="context-title">Context</h2>
        {state.status !== 'ready' && (
          <button type="button" className="btn small quiet" disabled={state.status === 'loading'} onClick={load}>
            {state.status === 'loading' ? 'Reading…' : 'Show context'}
          </button>
        )}
      </div>
      {state.status === 'idle' && <p className="meta">From Teamwork Graph: who is on this incident, what they have been working on, and linked work.</p>}
      {state.status === 'error' && <p className="error" role="alert">{state.message}</p>}
      {state.status === 'ready' && (
        <>
          {state.data.links.length > 0 && (
            <div className="item" style={{ flexDirection: 'column', gap: 4 }}>
              <span className="caption">Linked work</span>
              {state.data.links.map((l) => (
                <span key={l.key}>
                  <button type="button" className="link" onClick={() => openIssue(l.key)}>{l.key}</button> {l.summary} <span className="caption">· {l.status}</span>
                </span>
              ))}
            </div>
          )}
          {state.data.people.map((p) => (
            <div className="item" key={p.accountId} style={{ flexDirection: 'column', gap: 4 }}>
              <span className="caption">{nameOf(p.accountId)} has been working on</span>
              {p.items.length === 0 && <span className="muted">Nothing else recorded in Teamwork Graph.</span>}
              {p.items.map((item, i) => (
                <span key={`${item.title}-${i}`}>
                  {item.kind === 'jira' ? (
                    <button type="button" className="link" onClick={() => openIssue(item.key)}>{item.key}</button>
                  ) : (
                    <button type="button" className="link" onClick={() => openExternal(item.url)}>Page</button>
                  )}{' '}
                  {item.title}
                </span>
              ))}
            </div>
          ))}
          {!state.data.links.length && !state.data.people.length && <p className="meta">No linked work or people with recorded activity yet.</p>}
        </>
      )}
    </section>
  );
}
