# Demo video (version 2)

File: `docs/video/72-hours-demo.mp4`, 1920x1080, 60 fps, 2 min 38 s, -14 LUFS. Source: `codegeist/72hours-video`
(Remotion composition `FilmV2`). Why it was rebuilt, what is real and what is designed: `docs/video/NOTE.md`. Version 1
(1:39) is kept in `videos versions/`.

Narration: ElevenLabs **Brian** (`nPczCjzI2devNBz1zQrb`), model **eleven_v4**, take A, time-stretched to 1.1x without
changing pitch. Sound is synthesised; no music.

| Time | Step | On screen | Narration |
| --- | --- | --- | --- |
| 0:00 | Problem | The 72:00:00 clock; GDPR, NPC and NIS2 clocks; the facts a notice needs, marked missing; the facts scattered across a ticket, a comment, a page and a person | When personal data leaks, the law starts a clock. Under GDPR, the regulator must hear from you within seventy-two hours. The Philippines' privacy commission: also seventy-two. And under NIS2, an early warning is due in twenty-four. Each regulator wants specific facts: what happened, whose data, how many people, and what you've done about it. On day one, those facts are scattered across tickets, comments, Confluence pages and people's heads. |
| 0:29 | What, who | "72 Hours: a Forge app for Jira Service Management, for privacy and security teams"; three real crops; the five steps | 72 Hours is a Forge app for Jira Service Management, built for the privacy and security teams who have to report a breach. It tracks every legal deadline, gathers the facts with their sources, and drafts each notice, while people make every decision. It works in five steps: detect, scope, evidence, notice, and file. |
| 0:50 | 1 Detect | Label added; Flagged with the step strip; awareness time; internal note | Step one: detect. The team adds one label to the incident. 72 Hours starts the clock from the moment the team became aware, and leaves an internal note so they can confirm that time. |
| 1:01 | 2 Scope | Scoping form with its answers; the deadline board; the law's own words | Step two: scope. A few quick answers, like where the affected people live, how many there are, and how serious it is, decide which laws apply. Every deadline lands on one board, counting down. Each one is calculated by code from the law's own text. Open it, and you see the exact article it comes from. |
| 1:20 | 3 Evidence | Assemble; drafts with sources; Accept; question to Jira task; the answer back | Step three: evidence. Press Assemble evidence, and Clerk, the app's AI assistant, reads the incident, its comments, linked work and Confluence pages, then drafts each fact the regulators need, with its source. Clerk runs on Claude, hosted by Atlassian, so the data stays on the platform. A person reviews every draft and accepts it. When a fact is still unknown, ask the person who knows. The question becomes a Jira task, and the answer flows back into the evidence. |
| 1:48 | 4 Notice | Draft in Confluence; the DRAFT page; sign-off | Step four: notice. 72 Hours drafts each regulator's notice in Confluence, with its sources and assumptions. Sign-off unlocks only when every required fact has been accepted. |
| 2:00 | 5 File | Mark as filed; the clock stops ("Filed 2d 14h early"); the audit trail | Step five: file. The team files with the regulator, then records it here. That clock stops, its reminders end, and the audit trail keeps who did what, and when. |
| 2:10 | Across Atlassian | Rovo (Clerk), MCP tools in Rovo Studio, Teamwork Graph context and published status | 72 Hours works across Atlassian too. Ask Clerk in Rovo what's still missing. Call the same tools from any AI agent over MCP. And through Teamwork Graph, it finds what the people on the incident have been working on, and publishes each notice's status back to the graph. |
| 2:27 | Drill, end | The drill and its score; the end card | Before a real breach, teams can rehearse with a sample drill. 72 Hours. Deadlines calculated by code. Drafts written by AI. Decisions made by people. |
