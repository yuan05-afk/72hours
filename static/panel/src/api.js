// Calls to the app's resolvers and to Jira. Resolvers answer { ok, data } or { ok: false, code, message }.
import { invoke, requestJira, router } from '@forge/bridge';

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function call(name, payload) {
  const result = await invoke(name, payload);
  if (!result || !result.ok) {
    throw new ApiError(result?.code ?? 'INTERNAL', result?.message ?? 'Something went wrong. Try again.');
  }
  return result.data;
}

// Display names for Atlassian account ids, cached for the life of the panel.
const nameCache = new Map();

export async function loadNames(accountIds) {
  const missing = [...new Set(accountIds.filter((id) => id && !id.startsWith('app:') && !nameCache.has(id)))];
  for (let i = 0; i < missing.length; i += 50) {
    const query = missing.slice(i, i + 50).map((id) => `accountId=${encodeURIComponent(id)}`).join('&');
    try {
      const response = await requestJira(`/rest/api/3/user/bulk?${query}&maxResults=50`);
      if (!response.ok) continue;
      const { values = [] } = await response.json();
      for (const user of values) nameCache.set(user.accountId, user.displayName);
    } catch {
      // Names are a nicety; the panel still works with fallbacks.
    }
  }
}

const APP_ACTORS = { 'app:detector': '72 Hours (detection)', 'app:reminders': '72 Hours (reminders)', 'app:clerk': 'Clerk' };

export function nameOf(accountId) {
  if (!accountId) return 'Unknown';
  return APP_ACTORS[accountId] ?? nameCache.get(accountId) ?? 'Someone';
}

export const firstName = (accountId) => nameOf(accountId).split(' ')[0];

export async function searchUsers(query) {
  const response = await requestJira(`/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=8`);
  if (!response.ok) return [];
  const users = await response.json();
  return users
    .filter((u) => u.accountType === 'atlassian' && u.active)
    .map((u) => {
      nameCache.set(u.accountId, u.displayName);
      return { accountId: u.accountId, displayName: u.displayName };
    });
}

/** Opens a Jira issue in the same tab, as a normal Jira link would. */
export const openIssue = (key) => router.navigate(`/browse/${encodeURIComponent(key)}`);

/** Opens an outside page (a law's text) in a new tab; Jira asks the user to confirm. */
export const openExternal = (url) => router.open(url);
