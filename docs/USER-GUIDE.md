# 72 Hours: user guide

72 Hours helps privacy, security and IT teams meet personal-data breach notification deadlines in Jira Service
Management (plain Jira works too). Support: admin@yuanmariano.dev. Not legal advice.

This guide is for the Marketplace edition, which runs entirely in Jira: each notice draft is kept in the Jira panel,
ready to preview and copy.

## Install

A site admin installs the app from the Atlassian Marketplace. No configuration is needed. Open any issue and click the
**72 Hours** icon in the row of quick-add buttons under the summary to open the panel. On Jira Service Management
service requests, app panels are shown to agents.

## The five steps

The strip at the top of the panel shows which step you are on and the one thing to do next.

1. **Detect.** Add the label `personal-data-involved` to the incident (or press **Start breach clock**). The awareness
   time is recorded at once, and an internal note asks the team to confirm it. Use **Correct** to change it, with a
   reason.
2. **Scope.** Click **Answer scoping questions**: what kind of data, where the affected people live, roughly how many,
   how serious, and a few facts about your organisation. A live preview shows which deadlines will start. Each
   deadline appears on the board, counting down; click one to read the law's own words, its link, and the
   assumptions behind it.
3. **Evidence.** Click **Assemble evidence**. Clerk, an AI assistant (Claude, hosted by Atlassian), reads the
   incident, its comments, linked work and Teamwork Graph context, and drafts each fact a regulator needs with its
   source. Open each draft with **Review** and press **Accept draft**, or edit it. For a fact nobody has yet, use
   **Ask a question**, name the person who knows, and turn it into a Jira task; when they answer in a comment and mark
   the task Done, the answer comes back as a draft.
4. **Notice.** For each regulator, press **Prepare draft**, then **Preview** to read it and **Copy text** to use it in
   the regulator's form. **Sign off** unlocks only when every required fact is accepted.
5. **File.** File with the regulator yourself, then press **Mark as filed** and add the reference. That deadline's
   clock stops and its reminders end. **Audit trail** shows who did what, and when.

Reminders arrive as internal comments 24 hours and 6 hours before a deadline and when it is overdue.

## Rovo, MCP and Teamwork Graph

- **Rovo:** press **Ask Clerk** in the panel, or choose the agent **Clerk** in Rovo chat, and ask what is still
  missing. Clerk uses your own Jira permissions.
- **MCP:** the same actions are tools in Rovo Studio (Tools, Connected apps) for any AI agent.
- **Teamwork Graph:** **Show context** lists linked work and what the people on the incident have been working on. An
  organisation admin can add the connector **72 Hours breach notices** (Atlassian Administration, Connectors) to
  publish each notice's status, visible only to the people on that incident.

## Practise

On any issue without a breach clock, press **Try a sample breach**: a labelled drill on sample data, with no reminders,
and a readiness score.

## Privacy

Data stays in your site and in the app's storage on Atlassian's platform. See the privacy policy:
https://gist.github.com/yuan05-afk/19ec438bc7e2447f4d6b2090cd6d4c71
