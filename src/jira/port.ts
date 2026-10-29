// What the services need from Jira, as interfaces, so the services are tested with fakes and run on @forge/api.

/** Calls made as the signed-in user, so Jira's own permissions apply (resolvers). */
export interface UserJira {
  /** Creates a task linked to the incident. `linked` is false when Jira refused the link but the task exists. */
  createTask(input: {
    incidentKey: string;
    summary: string;
    description: string;
    assigneeAccountId: string | null;
  }): Promise<{ key: string; linked: boolean }>;
}

/** What the incident issue itself says, read as the user (so their Jira permissions apply). */
export interface IssueContext {
  key: string;
  summary: string;
  description: string;
  created: string;
  reporterAccountId: string | null;
  assigneeAccountId: string | null;
  comments: { id: string; author: string; created: string; text: string }[];
  links: { key: string; summary: string; status: string }[];
}

export interface UserJiraContext {
  getIssueContext(issueKey: string): Promise<IssueContext | null>;
  /** True when the signed-in user can see the issue. Used to authorise Rovo and MCP calls. */
  canView(issueKey: string): Promise<boolean>;
}

/** Teamwork Graph: what people on the incident have been working on (persisted Cypher query, read as the user). */
export interface GraphPort {
  relatedWork(accountId: string): Promise<{ kind: 'jira' | 'confluence'; title: string; key?: string; url?: string }[]>;
}

/** Atlassian-hosted LLM: one prompt in, text out. */
export interface LlmPort {
  complete(system: string, user: string): Promise<string>;
}

/** Confluence calls made as the signed-in user, so space and page permissions apply. */
export interface UserConfluence {
  listSpaces(): Promise<{ id: string; key: string; name: string }[]>;
  createPage(input: { spaceId: string; title: string; storage: string }): Promise<{ id: string; url: string }>;
  updatePage(input: { id: string; title: string; storage: string }): Promise<{ id: string; url: string }>;
  /** Pages matching a CQL query, with a short plain-text excerpt. */
  searchPages(cql: string, limit: number): Promise<{ id: string; title: string; url: string; excerpt: string }[]>;
}

/** Calls made as the app, where no user is present (event and scheduled triggers). */
export interface AppJira {
  getIssue(issueKey: string): Promise<{ labels: string[]; created: string } | null>;
  /** The user's IANA time zone, or null when the profile hides it. */
  getUserTimeZone(accountId: string): Promise<string | null>;
  /** Posts a comment that only the team sees (internal on JSM requests). */
  addInternalComment(issueKey: string, text: string): Promise<void>;
  /** The newest comment written by a person (not an app) on an issue, as plain text, or null. */
  getLatestHumanComment(issueKey: string): Promise<{ text: string; authorAccountId: string } | null>;
}
