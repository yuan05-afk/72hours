// Local preview only: stands in for @forge/bridge with fixture data from scripts/panel-fixture.ts.
// URL parameters: ?state=running|detected|none  &theme=light|dark
import fixture from './fixture.json';

const params = new URLSearchParams(window.location.search);
const state = params.get('state') ?? 'running';
const later = (data) => new Promise((resolve) => setTimeout(() => resolve(data), 150));
const ok = (data) => later({ ok: true, data });

export const view = {
  theme: {
    enable: async () => document.documentElement.setAttribute('data-color-mode', params.get('theme') ?? 'light'),
  },
};

export async function invoke(name) {
  switch (name) {
    case 'getPanel':
      return ok(fixture[state]);
    case 'previewClocks':
      return ok(fixture.preview);
    case 'createTask':
      return ok({ taskKey: 'SEC-152' });
    default:
      return ok({});
  }
}

export async function requestJira(path) {
  const ids = [...path.matchAll(/accountId=([^&]+)/g)].map((m) => decodeURIComponent(m[1]));
  const values = ids.filter((id) => fixture.users[id]).map((id) => ({ accountId: id, displayName: fixture.users[id] }));
  if (path.includes('/user/search')) {
    const q = decodeURIComponent(path.match(/query=([^&]+)/)?.[1] ?? '').toLowerCase();
    const users = Object.entries(fixture.users)
      .filter(([, name]) => name.toLowerCase().includes(q))
      .map(([accountId, displayName]) => ({ accountId, displayName, accountType: 'atlassian', active: true }));
    return { ok: true, json: async () => users };
  }
  return { ok: true, json: async () => ({ values }) };
}

export const router = { navigate: () => {}, open: () => {} };

// Rovo is on in the preview, so "Ask Clerk" renders; opening chat does nothing here.
export const rovo = { isEnabled: async () => true, open: async () => {} };

// Issue-change events never fire in the preview.
export const events = { on: async () => ({ unsubscribe: () => {} }) };
