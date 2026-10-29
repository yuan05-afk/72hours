// The five steps of a breach response, worked out from the panel data, so the panel can show where the team is and
// what to do next. Pure functions: no React, no bridge calls, so they can be unit-tested.
//
// Detect   the clock starts from the awareness time
// Scope    a few answers decide which laws (and deadlines) apply
// Evidence every fact a regulator requires is drafted and accepted by a person
// Notice   each notice is drafted in Confluence and signed off
// File     the team files with the regulator and records it here

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * @param {object} data the getPanel result: { view: { incident, clocks }, board, notices }
 * @returns {{ steps: Array<{ key: string, label: string, state: 'done'|'current'|'todo', detail: string }>, next: string|null }}
 */
export function progressOf(data) {
  const incident = data?.view?.incident ?? null;
  const fields = data?.board?.fields ?? [];
  const notices = data?.notices ?? [];
  const scoped = incident && incident.status !== 'detected';
  const closed = incident?.status === 'closed';

  const required = fields.filter((f) => f.neededBy?.some((n) => n.need === 'required'));
  const accepted = required.filter((f) => f.state === 'filled').length;
  const toReview = fields.filter((f) => f.state === 'draft').length;
  const missing = required.filter((f) => f.state === 'gap').length;

  // Only notices with a field checklist are drafted and signed off here; the rest use the regulator's own form and
  // only need filing.
  const drafted = notices.filter((n) => n.mapped);
  const signed = drafted.filter((n) => n.status === 'ready' || n.status === 'filed').length;
  const filed = notices.filter((n) => n.status === 'filed').length;

  const done = {
    detect: Boolean(incident),
    scope: Boolean(scoped),
    evidence: Boolean(scoped) && required.length > 0 && accepted === required.length,
    notice: Boolean(scoped) && signed === drafted.length && drafted.length > 0,
    file: Boolean(scoped) && notices.length > 0 && filed === notices.length,
  };
  const detail = {
    detect: incident ? 'Clock started' : 'Not started',
    scope: scoped ? plural(notices.length, 'notice') : 'Which laws apply',
    evidence: scoped ? `${accepted} of ${required.length} accepted` : 'Facts with sources',
    notice: scoped ? `${signed} of ${drafted.length} signed` : 'Drafted in Confluence',
    file: scoped ? `${filed} of ${notices.length} filed` : 'With the regulator',
  };
  const labels = { detect: 'Detect', scope: 'Scope', evidence: 'Evidence', notice: 'Notice', file: 'File' };
  const order = ['detect', 'scope', 'evidence', 'notice', 'file'];
  const current = closed ? null : order.find((k) => !done[k]) ?? null;
  const steps = order.map((key) => ({
    key,
    label: labels[key],
    state: done[key] ? 'done' : key === current ? 'current' : 'todo',
    detail: detail[key],
  }));

  return { steps, next: closed ? null : nextStep({ incident, current, toReview, missing, notices }) };
}

/** One plain sentence: the single most useful thing to do now. */
function nextStep({ incident, current, toReview, missing, notices }) {
  if (!incident) return null;
  if (current === 'scope') return 'Answer the scoping questions to see which deadlines apply.';
  if (current === 'evidence') {
    if (toReview) return `Review ${plural(toReview, 'drafted fact')} under Evidence and accept what is right.`;
    if (missing) return `${plural(missing, 'required fact')} still missing: press Assemble evidence, add it, or ask who knows.`;
  }
  // Earliest deadline first: that notice is the one to move.
  const byDue = [...notices].sort((a, b) => String(a.dueAt ?? '').localeCompare(String(b.dueAt ?? '')));
  if (current === 'evidence' || current === 'notice') {
    const undrafted = byDue.find((n) => n.mapped && n.status === 'none');
    if (undrafted) return `Draft the ${undrafted.regimeName} notice in Confluence.`;
    const signable = byDue.find((n) => n.mapped && n.status === 'draft' && !n.missing?.length);
    if (signable) return `Sign off the ${signable.regimeName} notice.`;
    const blocked = byDue.find((n) => n.mapped && n.status === 'draft');
    if (blocked) return `Accept the ${plural(blocked.missing.length, 'missing fact')} the ${blocked.regimeName} notice needs, then sign it off.`;
  }
  const toFile = byDue.find((n) => n.status !== 'filed');
  if (toFile) return `File the ${toFile.regimeName} notice with the regulator, then mark it filed here.`;
  return 'Every notice is filed. Close the incident when the work is done.';
}
