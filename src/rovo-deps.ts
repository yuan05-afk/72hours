// The outside services evidence assembly needs, bundled so the panel and Rovo pass the same set.
import type { GraphPort, LlmPort, UserConfluence, UserJiraContext } from './jira/port';

export interface Deps {
  jira: UserJiraContext;
  confluence: UserConfluence;
  graph: GraphPort;
  llm: LlmPort | null;
}
