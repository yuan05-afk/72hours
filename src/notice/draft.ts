// Composes a regulator notice draft from the evidence board. Pure: same inputs, same draft. The draft is always marked
// "DRAFT, not filed", shows where each fact came from, lists what is missing, and carries the assumptions it rests on.
import { DateTime } from 'luxon';
import { FIELDS, requirementFor } from './fields';
import type { FieldKey, Need } from './fields';
import type { Clock, IncidentScope } from '../rules';
import type { EvidenceBoard } from '../service/evidence';

export interface ComposedNotice {
  title: string;
  /** Confluence storage format (XHTML). */
  storage: string;
  /** Plain text, for Rovo and copy-paste. */
  text: string;
  missing: FieldKey[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NEED_NOTE: Record<Need, string> = {
  required: '',
  ifAvailable: ' (only where available)',
  ifLate: ' (only if the notice is sent after its deadline)',
};

function scopeFacts(scope: IncidentScope | null): string[] {
  if (!scope) return [];
  const facts = [
    `Affected people live in: ${scope.subjectCountries.join(', ')}.`,
    `About ${scope.approxSubjects.toLocaleString('en-US')} people affected.`,
    `Risk to people assessed as: ${scope.riskLevel === 'high' ? 'high' : scope.riskLevel === 'risk' ? 'some risk' : 'unlikely'}.`,
  ];
  if (scope.sensitiveData) facts.push('Sensitive personal information is involved.');
  if (scope.identityFraudRisk) facts.push('The data could enable identity fraud.');
  if (scope.nis2SignificantIncident) facts.push('The organisation is a NIS2 essential or important entity and the incident is significant.');
  if (scope.hipaaCoveredEntity) facts.push('The organisation is a HIPAA covered entity.');
  if (scope.secRegistrant) facts.push('The organisation is an SEC registrant.');
  return facts;
}

export function composeNotice(input: {
  issueKey: string;
  clock: Clock;
  board: EvidenceBoard;
  scope: IncidentScope | null;
  timeZone: string;
  generatedAt: Date;
  drill?: boolean;
}): ComposedNotice {
  const { issueKey, clock, board, timeZone } = input;
  const requirement = requirementFor(clock.stageKey);
  const entries = Object.entries(requirement?.fields ?? {}) as [FieldKey, Need][];
  const byKey = new Map(board.fields.map((f) => [f.key, f]));
  const due = clock.dueAt ? DateTime.fromISO(clock.dueAt).setZone(timeZone).toFormat("ccc d LLL yyyy, HH:mm '(" + timeZone + ")'") : null;
  const generated = DateTime.fromJSDate(input.generatedAt).setZone(timeZone).toFormat("d LLL yyyy, HH:mm '(" + timeZone + ")'");
  const title = `${input.drill ? '[DRILL] ' : ''}${issueKey} · ${clock.regimeName}: ${clock.action} (draft)`;
  const missing: FieldKey[] = [];

  const html: string[] = [];
  const text: string[] = [];

  const banner = `${input.drill ? 'DRILL. ' : ''}DRAFT, not filed. Prepared by 72 Hours from the evidence recorded on ${issueKey}. A named person must review and sign off before anything is sent; filing stays with your team.`;
  html.push(`<ac:structured-macro ac:name="warning"><ac:rich-text-body><p>${esc(banner)}</p></ac:rich-text-body></ac:structured-macro>`);
  text.push(title, '', banner, '');

  html.push('<h2>Deadline</h2>');
  const deadline = due
    ? `${clock.action}, to ${clock.recipient}, due ${due}. ${clock.basis}.`
    : `${clock.action}, to ${clock.recipient}. ${clock.basis}.`;
  html.push(`<p>${esc(deadline)}</p>`);
  html.push(`<p><a href="${esc(clock.citation.url)}">${esc(clock.citation.label)}</a> · checked ${esc(clock.lastVerified)}</p>`);
  html.push(`<blockquote><p>${esc(clock.citation.quote)}</p></blockquote>`);
  text.push('DEADLINE', deadline, `${clock.citation.label} (${clock.citation.url})`, '');

  html.push('<h2>Notice content</h2>');
  text.push('NOTICE CONTENT');
  if (requirement) {
    html.push(`<p><em>${esc(`Required by ${requirement.citation.label}.`)}</em></p>`);
  } else {
    html.push('<p><em>No field checklist is mapped for this notice yet; use the regulator\'s form.</em></p>');
  }
  for (const [key, need] of entries) {
    const field = byKey.get(key);
    const label = FIELDS[key].label + NEED_NOTE[need];
    html.push(`<h3>${esc(label)}</h3>`);
    if (!field || field.state === 'gap') {
      if (need === 'required') missing.push(key);
      html.push(`<p><em>${esc(`Missing: ${FIELDS[key].prompt}`)}</em></p>`);
      text.push(`- ${label}: MISSING (${FIELDS[key].prompt})`);
      continue;
    }
    if (field.state === 'draft' && need === 'required') missing.push(key);
    const sources = field.sources.map((s) => s.label).join(', ');
    const note = field.state === 'draft' ? 'Draft, not yet accepted by a person. ' : '';
    html.push(`<p>${esc(field.value ?? '')}</p>`);
    html.push(`<p><sub>${esc(`${note}${sources ? `Source: ${sources}.` : ''}`)}</sub></p>`);
    text.push(`- ${label}: ${field.value}${sources ? ` [${sources}]` : ''}${field.state === 'draft' ? ' (draft)' : ''}`);
  }
  text.push('');

  const assumptions = [...scopeFacts(input.scope), ...clock.assumptions];
  html.push('<h2>Assumptions this draft rests on</h2>');
  html.push(`<ul>${assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`);
  text.push('ASSUMPTIONS', ...assumptions.map((a) => `- ${a}`), '');

  const signoff = missing.length
    ? `Not ready: ${missing.length} required item${missing.length === 1 ? ' is' : 's are'} missing or not yet accepted.`
    : 'Every required item is filled and accepted. Ready for review and sign-off in the 72 Hours panel.';
  html.push('<h2>Sign-off</h2>');
  html.push(`<p>${esc(signoff)}</p>`);
  html.push(`<p><sub>${esc(`Generated ${generated}. Deadlines are calculated by code from the cited law; AI only drafts wording, and people approve it. This is not legal advice.`)}</sub></p>`);
  text.push('SIGN-OFF', signoff, `Generated ${generated}. Deadlines are calculated by code from the cited law; AI only drafts wording, and people approve it. This is not legal advice.`);

  return { title, storage: html.join(''), text: text.join('\n'), missing };
}
