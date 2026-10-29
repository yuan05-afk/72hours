# 72 Hours privacy policy

Last updated: 29 October 2026. Contact: admin@yuanmariano.dev

72 Hours is a Forge app that runs entirely on Atlassian's platform ("Runs on Atlassian"). It has no servers of its own
and makes no calls to services outside Atlassian.

## What the app stores, and where

In the Forge SQL database of your own installation (one database per installation, hosted by Atlassian, following your
data residency settings):

- incidents you start or flag: the issue key, the scoping answers, awareness and event times, status;
- notice evidence your team enters or accepts, with its sources;
- open questions, their owners (Atlassian account IDs) and answers;
- notice status (drafted, signed off, filed), who signed and filed, and the Confluence page ID of each draft;
- an append-only audit trail of every change (account ID, time, before and after values, reason);
- two settings: the Confluence space for drafts and the Teamwork Graph connection ID.

## What the app reads

Only when a user of your site asks it to, and only with that user's own Jira and Confluence permissions: the incident
issue (summary, description, comments, linked issues), Confluence pages that mention the incident or look like a breach
playbook, and, through Teamwork Graph, pages and work items created by the people on the incident.

## AI

Evidence drafts are produced by Claude through Forge LLMs, which Atlassian hosts. Prompts and responses stay within
Atlassian's platform. The model only proposes values for empty fields; people accept or replace them. Deadlines are
never computed by AI.

## What the app writes in your site

Internal comments on incidents (detection and deadline reminders), Jira tasks for open questions (created as the user
who clicks), Confluence notice drafts (created as the user who clicks), and, if an organisation admin connects the
connector, Teamwork Graph objects containing notice status only, visible only to the people who worked on the incident.

## Sharing, retention and deletion

The developer has no access to your data and receives none of it. Nothing is sold or shared. Data is kept until you
uninstall the app; Forge deletes an installation's storage after uninstallation according to Atlassian's platform
policy. To ask a question about this policy, email admin@yuanmariano.dev.
