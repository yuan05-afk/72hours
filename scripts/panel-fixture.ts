// Builds the panel's preview data with the real services and an in-memory store, so the local preview shows exactly
// what the resolvers would return. Demo organisation "Lumen Health" is invented. Run: npm run preview:fixture
import { writeFileSync } from 'node:fs';
import { EvidenceService } from '../src/service/evidence';
import { IncidentService } from '../src/service/incidents';
import { NoticeService } from '../src/service/notices';
import { MemoryStore } from '../src/store/memory';
import type { IncidentScope } from '../src/rules';

const out = process.argv[2];
const KEY = 'SEC-142';
const MARA = 'acc-mara';
const now = new Date();
// Aware 5 h 41 min ago, so the board looks like an incident in its first day.
const awareAt = new Date(now.getTime() - (5 * 60 + 41) * 60_000).toISOString();

const scope: IncidentScope = {
  subjectCountries: ['PH', 'IE'],
  approxSubjects: 1200,
  riskLevel: 'high',
  sensitiveData: true,
  identityFraudRisk: true,
  hipaaCoveredEntity: false,
  hipaaBusinessAssociate: false,
  moreThan500InOneState: false,
  nis2SignificantIncident: true,
  nis2TrustServiceProvider: false,
  secRegistrant: false,
};

// Same shape as the getPanel resolver in src/index.ts.
async function panel(store: MemoryStore, incidents: IncidentService, evidence: EvidenceService, notices: NoticeService, issueKey: string) {
  const view = await incidents.get(issueKey);
  if (!view) return { issueKey, view: null, board: null, audit: [], notices: [], summary: null };
  const audit = await incidents.auditTrail(issueKey);
  return { issueKey, view, board: await evidence.board(issueKey), audit: audit.slice(-50).reverse(), notices: await notices.list(issueKey), summary: null };
}

async function main() {
  const store = new MemoryStore();
  const incidents = new IncidentService(store);
  const evidence = new EvidenceService(store, incidents);
  const notices = new NoticeService(store, incidents, evidence);

  await incidents.start({ issueKey: KEY, scope, awareAt, timeZone: 'Asia/Manila', actor: MARA });
  const fill = (fieldKey: string, value: string, sources: { kind: 'jira' | 'manual' | 'person'; label: string }[], draft = false) =>
    evidence.setField({ issueKey: KEY, fieldKey, value, sources, actor: draft ? 'app:clerk' : MARA, draft });
  await fill('nature', 'An export job ran under a leaked service-account key and copied invoice files to an outside storage bucket.', [
    { kind: 'jira', label: 'SEC-142' },
    { kind: 'manual', label: 'SIEM alert 8812' },
  ]);
  await fill('peopleCount', 'About 1,200 patients: 860 in the Philippines, 340 in Ireland.', [{ kind: 'manual', label: 'billing database count' }]);
  await fill('recordCategories', 'Invoices with names, addresses, PhilHealth numbers and diagnosis codes.', [{ kind: 'manual', label: 'data map' }]);
  await fill('dpoContact', 'Mara Lim · dpo@lumenhealth.example', [{ kind: 'manual', label: 'breach playbook' }]);
  await fill('measures', 'Key revoked at 11:40, bucket blocked, export job disabled.', [{ kind: 'jira', label: 'SEC-145' }]);
  await fill('consequences', 'Risk of identity fraud from PhilHealth numbers and disclosure of health conditions.', [{ kind: 'manual', label: 'Clerk draft' }], true);

  const backups = await evidence.askQuestion({
    issueKey: KEY, question: 'Were the nightly backups in the same bucket?', why: 'Owns the backup service', fieldKey: 'measures', ownerAccountId: 'acc-ken', actor: MARA,
  });
  await store.updateQuestion(KEY, backups.id, { taskKey: 'SEC-151' });
  await evidence.askQuestion({ issueKey: KEY, question: 'When was the leaked key first used?', why: 'Owns the SIEM alert', fieldKey: 'chronology', ownerAccountId: 'acc-joy', actor: MARA });
  await evidence.askQuestion({ issueKey: KEY, question: 'Which Dublin clinic systems were in scope?', why: 'No owner found yet', actor: MARA });
  const answered = await evidence.askQuestion({ issueKey: KEY, question: 'Was the bucket public?', ownerAccountId: 'acc-ana', actor: MARA });
  await evidence.answerQuestion({ issueKey: KEY, id: answered.id, answer: 'No. Private bucket in an unknown account.', actor: 'acc-ana' });

  await incidents.detect({ issueKey: 'SEC-160', detectedAt: awareAt, timeZone: 'Asia/Manila', actor: 'app:detector', detail: { flaggedBy: MARA } });

  const fixture = {
    running: await panel(store, incidents, evidence, notices, KEY),
    detected: await panel(store, incidents, evidence, notices, 'SEC-160'),
    none: await panel(store, incidents, evidence, notices, 'SEC-170'),
    preview: incidents.preview({ scope, awareAt, timeZone: 'Asia/Manila' }),
    users: { [MARA]: 'Mara Lim', 'acc-ken': 'Ken Ocampo', 'acc-joy': 'Joy Tan', 'acc-ana': 'Ana Reyes' },
  };
  writeFileSync(out, JSON.stringify(fixture, null, 2));
  console.log(`Wrote ${out}`);
}

main();
