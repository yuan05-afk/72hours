import { describe, expect, it } from 'vitest';
import { progressOf } from './progress.js';

const req = (key, state) => ({ key, state, neededBy: [{ need: 'required' }] });
const notice = (regimeName, status, extra = {}) => ({ regimeName, status, mapped: true, missing: [], dueAt: '2026-11-01T05:23:00Z', ...extra });
const panel = ({ status = 'running', fields = [], notices = [] } = {}) => ({
  view: { incident: { status }, clocks: [] },
  board: { fields, questions: [] },
  notices,
});
const states = (p) => p.steps.map((s) => `${s.key}:${s.state}`).join(' ');

describe('progressOf', () => {
  it('shows nothing to do before an incident exists', () => {
    const p = progressOf({ view: { incident: null }, board: null, notices: [] });
    expect(states(p)).toBe('detect:current scope:todo evidence:todo notice:todo file:todo');
    expect(p.next).toBeNull();
  });

  it('asks for scoping right after detection', () => {
    const p = progressOf(panel({ status: 'detected' }));
    expect(states(p)).toBe('detect:done scope:current evidence:todo notice:todo file:todo');
    expect(p.next).toMatch(/scoping questions/);
  });

  it('points at drafts to review before anything else', () => {
    const p = progressOf(panel({ fields: [req('nature', 'draft'), req('count', 'gap'), req('dpo', 'filled')], notices: [notice('GDPR', 'none')] }));
    expect(states(p)).toBe('detect:done scope:done evidence:current notice:todo file:todo');
    expect(p.steps[2].detail).toBe('1 of 3 accepted');
    expect(p.next).toBe('Review 1 drafted fact under Evidence and accept what is right.');
  });

  it('names the missing facts when nothing is waiting for review', () => {
    const p = progressOf(panel({ fields: [req('count', 'gap'), req('dpo', 'gap')], notices: [notice('GDPR', 'none')] }));
    expect(p.next).toMatch(/^2 required facts still missing/);
  });

  it('moves to the earliest notice once the evidence is accepted', () => {
    const p = progressOf(
      panel({
        fields: [req('nature', 'filled')],
        notices: [notice('NPC', 'none', { dueAt: '2026-11-02T00:00:00Z' }), notice('GDPR', 'draft', { dueAt: '2026-11-01T00:00:00Z' })],
      }),
    );
    expect(states(p)).toBe('detect:done scope:done evidence:done notice:current file:todo');
    expect(p.next).toBe('Draft the NPC notice in Confluence.');
  });

  it('asks for sign-off, then filing, then closing', () => {
    const fields = [req('nature', 'filled')];
    expect(progressOf(panel({ fields, notices: [notice('GDPR', 'draft')] })).next).toBe('Sign off the GDPR notice.');
    const ready = progressOf(panel({ fields, notices: [notice('GDPR', 'ready')] }));
    expect(states(ready)).toBe('detect:done scope:done evidence:done notice:done file:current');
    expect(ready.next).toBe('File the GDPR notice with the regulator, then mark it filed here.');
    const all = progressOf(panel({ fields, notices: [notice('GDPR', 'filed')] }));
    expect(all.steps.every((s) => s.state === 'done')).toBe(true);
    expect(all.next).toMatch(/Close the incident/);
  });

  it('counts notices without a checklist only for filing', () => {
    const p = progressOf(panel({ fields: [req('nature', 'filled')], notices: [notice('GDPR', 'ready'), notice('HIPAA', 'none', { mapped: false })] }));
    expect(p.steps[3]).toMatchObject({ state: 'done', detail: '1 of 1 signed' });
    expect(p.steps[4]).toMatchObject({ state: 'current', detail: '0 of 2 filed' });
  });

  it('shows no next step once the incident is closed', () => {
    const p = progressOf(panel({ status: 'closed', fields: [req('nature', 'filled')], notices: [notice('GDPR', 'filed')] }));
    expect(p.next).toBeNull();
    expect(p.steps.some((s) => s.state === 'current')).toBe(false);
  });
});
