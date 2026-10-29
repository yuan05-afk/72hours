// @forge/api implementations of the Jira ports. Every route uses the `route` tag, which escapes path parameters.
import api, { route } from '@forge/api';
import { chat } from '@forge/llm';
import type { AppJira, GraphPort, LlmPort, UserConfluence, UserJira, UserJiraContext } from './port';

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

/** Atlassian Document Format for plain paragraphs; Jira's v3 API takes rich text only as ADF. */
const adf = (text: string) => ({
  type: 'doc',
  version: 1,
  content: text.split('\n\n').map((paragraph) => ({ type: 'paragraph', content: [{ type: 'text', text: paragraph }] })),
});

async function failure(what: string, response: { status: number; text(): Promise<string> }) {
  const body = await response.text().catch(() => '');
  return new Error(`${what} failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
}

const projectKeyOf = (issueKey: string) => issueKey.slice(0, issueKey.lastIndexOf('-'));

export const userJira: UserJira = {
  async createTask({ incidentKey, summary, description, assigneeAccountId }) {
    const jira = api.asUser();
    const projectKey = projectKeyOf(incidentKey);

    // Prefer a standard "Task" type; otherwise a sub-task of the incident, which every template that has one allows.
    const metaResponse = await jira.requestJira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes?maxResults=200`, {
      headers: { Accept: 'application/json' },
    });
    if (!metaResponse.ok) throw await failure('Reading issue types', metaResponse);
    const { issueTypes = [] } = (await metaResponse.json()) as { issueTypes?: { id: string; name: string; subtask: boolean }[] };
    const task = issueTypes.find((t) => !t.subtask && t.name.toLowerCase() === 'task');
    const subtask = issueTypes.find((t) => t.subtask);
    const type = task ?? subtask;
    if (!type) throw new Error(`Project ${projectKey} has no Task or sub-task issue type.`);

    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      issuetype: { id: type.id },
      summary,
      description: adf(description),
      ...(assigneeAccountId ? { assignee: { accountId: assigneeAccountId } } : {}),
      ...(type === subtask ? { parent: { key: incidentKey } } : {}),
    };
    const created = await jira.requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ fields }),
    });
    if (!created.ok) throw await failure('Creating the task', created);
    const { key } = (await created.json()) as { key: string };
    if (type === subtask) return { key, linked: true };

    const link = await jira.requestJira(route`/rest/api/3/issueLink`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: { name: 'Relates' }, inwardIssue: { key }, outwardIssue: { key: incidentKey } }),
    });
    if (!link.ok) console.warn((await failure(`Linking ${key} to ${incidentKey}`, link)).message);
    return { key, linked: link.ok };
  },
};

/** Plain text from Atlassian Document Format: paragraphs on their own lines, marks and media dropped. */
export function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text') return n.text ?? '';
  const inner = (n.content ?? []).map(adfToText).join(n.type === 'doc' || n.type === 'bulletList' || n.type === 'orderedList' ? '\n' : '');
  return ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'].includes(n.type ?? '') ? `${inner}\n` : inner;
}

export const userJiraContext: UserJiraContext = {
  async getIssueContext(issueKey) {
    const response = await api
      .asUser()
      .requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description,created,reporter,assignee,issuelinks,comment`, {
        headers: { Accept: 'application/json' },
      });
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw await failure(`Reading ${issueKey}`, response);
    const { key, fields } = (await response.json()) as {
      key: string;
      fields: {
        summary: string;
        description: unknown;
        created: string;
        reporter?: { accountId: string } | null;
        assignee?: { accountId: string } | null;
        issuelinks?: { inwardIssue?: LinkedIssue; outwardIssue?: LinkedIssue }[];
        comment?: { comments?: { id: string; created: string; body: unknown; author?: { displayName?: string; accountType?: string } }[] };
      };
    };
    return {
      key,
      summary: fields.summary,
      description: adfToText(fields.description).trim(),
      created: fields.created,
      reporterAccountId: fields.reporter?.accountId ?? null,
      assigneeAccountId: fields.assignee?.accountId ?? null,
      // App comments (including this app's own notices) are not evidence; people's comments are.
      comments: (fields.comment?.comments ?? [])
        .filter((c) => c.author?.accountType !== 'app')
        .map((c) => ({ id: c.id, author: c.author?.displayName ?? 'Someone', created: c.created, text: adfToText(c.body).trim() })),
      links: (fields.issuelinks ?? [])
        .map((l) => l.inwardIssue ?? l.outwardIssue)
        .filter((i): i is LinkedIssue => Boolean(i))
        .map((i) => ({ key: i.key, summary: i.fields?.summary ?? '', status: i.fields?.status?.name ?? '' })),
    };
  },

  async canView(issueKey) {
    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary`, {
      headers: { Accept: 'application/json' },
    });
    return response.ok;
  },
};

interface LinkedIssue {
  key: string;
  fields?: { summary?: string; status?: { name?: string } };
}

/** Persisted Cypher query registered for this app (keys are per app, so it works on every site the app is on). */
const RELATED_WORK_QUERY_KEY = 'fb60e8ad-a99a-4249-b7a5-9a8a4966bc73';
export const RELATED_WORK_QUERY = `query hours72_relatedWork($queryKey: String!, $queryParams: CypherRequestParams) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 8) {
    edges { node { columns { key value {
      __typename
      ... on CypherQueryResultNode { id data { __typename
        ... on ConfluencePage { title webUrl }
        ... on JiraWorkItem { key summary } } }
    } } } }
  }
}`;

export const graph: GraphPort = {
  async relatedWork(accountId) {
    const response = await api.asUser().requestTeamworkGraph(RELATED_WORK_QUERY, {
      queryKey: RELATED_WORK_QUERY_KEY,
      queryParams: { userId: `ari:cloud:identity::user/${accountId}` },
    });
    if (!response.ok) throw await failure('Reading Teamwork Graph', response);
    const body = (await response.json()) as {
      errors?: unknown[];
      data?: { customQuery?: { edges?: { node?: { columns?: { value?: { data?: Record<string, string> } }[] } }[] } };
    };
    if (body.errors?.length) throw new Error(`Teamwork Graph query failed: ${JSON.stringify(body.errors).slice(0, 300)}`);
    const items: Awaited<ReturnType<GraphPort['relatedWork']>> = [];
    for (const edge of body.data?.customQuery?.edges ?? []) {
      for (const column of edge.node?.columns ?? []) {
        const data = column.value?.data;
        if (!data) continue;
        if (data.__typename === 'ConfluencePage') items.push({ kind: 'confluence', title: data.title, url: data.webUrl });
        if (data.__typename === 'JiraWorkItem') items.push({ kind: 'jira', title: data.summary, key: data.key });
      }
    }
    return items;
  },
};

/** Claude, hosted by Atlassian through Forge LLMs: breach details never leave Atlassian's platform. */
const LLM_MODEL = 'claude-haiku-4-5-20251001';

export const llm: LlmPort = {
  async complete(system, user) {
    const response = await chat({
      model: LLM_MODEL,
      max_completion_tokens: 2000,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const content = response.choices?.[0]?.message?.content;
    return Array.isArray(content) ? content.map((part) => part.text).join('') : (content ?? '');
  },
};

/** Turns Confluence's relative web links into absolute URLs. */
const absolute = (base: string | undefined, webui: string | undefined) => (webui ? `${base ?? ''}${webui}` : '');

const stripTags = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

export const userConfluence: UserConfluence = {
  async listSpaces() {
    const response = await api.asUser().requestConfluence(route`/wiki/api/v2/spaces?limit=50&status=current&sort=name`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw await failure('Listing Confluence spaces', response);
    const { results = [] } = (await response.json()) as { results?: { id: string; key: string; name: string }[] };
    return results.map(({ id, key, name }) => ({ id, key, name }));
  },

  async createPage({ spaceId, title, storage }) {
    const response = await api.asUser().requestConfluence(route`/wiki/api/v2/pages`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ spaceId, status: 'current', title, body: { representation: 'storage', value: storage } }),
    });
    if (!response.ok) throw await failure('Creating the Confluence page', response);
    const page = (await response.json()) as { id: string; _links?: { base?: string; webui?: string } };
    return { id: page.id, url: absolute(page._links?.base, page._links?.webui) };
  },

  async updatePage({ id, title, storage }) {
    const current = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${id}`, { headers: { Accept: 'application/json' } });
    if (!current.ok) throw await failure('Reading the Confluence page', current);
    const { version } = (await current.json()) as { version: { number: number } };
    const response = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${id}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        id,
        status: 'current',
        title,
        body: { representation: 'storage', value: storage },
        version: { number: version.number + 1, message: 'Updated by 72 Hours from the latest evidence' },
      }),
    });
    if (!response.ok) throw await failure('Updating the Confluence page', response);
    const page = (await response.json()) as { id: string; _links?: { base?: string; webui?: string } };
    return { id: page.id, url: absolute(page._links?.base, page._links?.webui) };
  },

  async searchPages(cql, limit) {
    const response = await api.asUser().requestConfluence(route`/wiki/rest/api/search?cql=${cql}&limit=${String(limit)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw await failure('Searching Confluence', response);
    const data = (await response.json()) as {
      _links?: { base?: string };
      results?: { content?: { id: string; title: string; _links?: { webui?: string } }; excerpt?: string; url?: string }[];
    };
    return (data.results ?? [])
      .filter((r) => r.content?.id)
      .map((r) => ({
        id: r.content!.id,
        title: r.content!.title,
        url: absolute(data._links?.base, r.content!._links?.webui ?? r.url),
        excerpt: stripTags(r.excerpt ?? '').slice(0, 600),
      }));
  },
};

export const appJira: AppJira = {
  async getIssue(issueKey) {
    const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}?fields=labels,created`, {
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await failure(`Reading ${issueKey}`, response);
    const { fields } = (await response.json()) as { fields: { labels?: string[]; created: string } };
    return { labels: fields.labels ?? [], created: fields.created };
  },

  async getUserTimeZone(accountId) {
    const response = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const { timeZone } = (await response.json()) as { timeZone?: string };
    return timeZone ?? null;
  },

  async addInternalComment(issueKey, text) {
    // Without the sd.public.comment property a comment on a JSM request is public: the customer would see breach
    // details in the portal. With it, JSM shows the comment to agents only; other project types ignore it.
    const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ body: adf(text), properties: [{ key: 'sd.public.comment', value: { internal: true } }] }),
    });
    if (!response.ok) throw await failure(`Commenting on ${issueKey}`, response);
    const { jsdPublic } = (await response.json()) as { jsdPublic?: boolean };
    if (jsdPublic === true) console.error(`Comment on ${issueKey} came back public; check the sd.public.comment property.`);
  },

  async getLatestHumanComment(issueKey) {
    const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment?orderBy=-created&maxResults=20`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const { comments = [] } = (await response.json()) as {
      comments?: { body: unknown; author?: { accountId?: string; accountType?: string } }[];
    };
    // accountType "atlassian" is a person; apps (including this one) post as "app".
    for (const c of comments) {
      if (c.author?.accountType !== 'atlassian' || !c.author.accountId) continue;
      const text = adfToText(c.body).trim();
      if (text) return { text, authorAccountId: c.author.accountId };
    }
    return null;
  },
};
