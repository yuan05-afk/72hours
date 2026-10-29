# 72 Hours demo film, version 2: note

`72-hours-demo.mp4` (v2): 1920x1080, 60 fps, H.264, 2 min 38 s. Remotion composition `FilmV2` (`src/v2/`), narration
`audio/vo3.mp3`. Script and reasoning: `SCRIPT-v2.md`. Version 1 (1:39) is kept in `72hours/videos versions/`.

## What changed from version 1, and why

| Problem in v1 | v2 |
|---|---|
| The app was named at 0:20 and never defined | 0:29 says it plainly: "A Forge app for Jira Service Management, for privacy and security teams who must report a breach", then three real crops of what it does |
| No map of the workflow | Five steps (Detect, Scope, Evidence, Notice, File) build on screen, then stay as a chapter rail; each step opens with its number and name. The app's panel now shows the same strip, so the map in the film is the map in the product |
| Fast shots (2-3x), no orientation | One caption per beat under the rail; one callout at a time on the footage; footage mostly 1-2x |
| "Not by AI" read as a contradiction | The trust model is said positively and the same everywhere: deadlines calculated by code from the law's text; AI drafts with sources; people accept, sign off and file |
| Soft, zoomed footage | Every take re-captured at 2x pixel density (3840x2160, headless Chrome with a forced device scale); crops are downscaled, never blown up |
| "Ask Ken", an invented person | The real owner (Yuan Mariano) and the real task (SEC-10) |

## Flow

| Time | Beat | Picture |
|---|---|---|
| 0:00 | Problem | The 72:00:00 clock; the three regulator clocks (GDPR, NPC, NIS2); the facts each notice needs, marked missing; the real ticket, comment, playbook and owner, scattered |
| 0:29 | What and who | "72 Hours", the one-line definition, who it is for; three pillars (deadlines, facts with sources, notices); "People make every decision"; the five steps |
| 0:50 | 1 Detect | Label added; the panel flips to Flagged with the strip; awareness time; the internal note |
| 1:01 | 2 Scope | The scoping form with its answers listed beside it; the deadline board; a deadline opened on the law's own words |
| 1:20 | 3 Evidence | Assemble evidence; Clerk's drafts with sources; review and Accept; a question becomes a Jira task; the owner answers on the task; the answer is back in the evidence |
| 1:48 | 4 Notice | Drafted in Confluence; the DRAFT page; sign-off |
| 2:00 | 5 File | Mark as filed; the clock stops on the board ("Filed 2d 14h early"); the audit trail |
| 2:10 | Across Atlassian | Rovo (Clerk's live answer), MCP (the four tools in Rovo Studio), Teamwork Graph (context read live; the status object it publishes) |
| 2:27 | Drill and end | The sample drill with its score; "Deadlines calculated by code. Drafts written by AI. Decisions made by people." |

## Real versus designed

Real: every app screen is live footage of 72hours.atlassian.net (development environment), incident SEC-9, task
SEC-10, drill SEC-11, recorded in real time by `tools/capture.mjs` (headless Chrome, 2x, a drawn cursor because headless
frames have none). Clerk's draft text and the Rovo answer are the model's real output on that run.

Designed:
1. The opening (the clock, regulator rows, the facts checklist, the floating cards). Card text is SEC-9's real ticket and
   comment, the real Confluence playbook, and the rulebook's real deadlines.
2. The step rail, captions, callouts, answer cards beside the scoping form, chapter titles and end card.
3. The Teamwork Graph "published object" card: a rendering of the fields the connector writes (`src/connector.ts`),
   labelled on screen as an illustration.

Notes for honesty:
- "Ask the person who knows" shows Yuan Mariano because the site has one user; the app assigns whoever is named.
- When SEC-10 was moved to Done in the UI, the app did not register that event (product events are not guaranteed); the
  transition was sent again over REST and the answer arrived. The footage of the answer is that real result.
- Off camera, the remaining drafts were accepted and two GDPR facts typed (records count, likely consequences) so the
  GDPR notice could be signed off. On screen that is described as what it is: people accepting facts.

## App changes made for this version (all tested, deployed to development)

- Five-step progress strip with a "Next" hint at the top of the panel (`static/panel/src/progress.js`, 8 tests).
- The panel reloads when the issue changes (Forge `JIRA_ISSUE_CHANGED`), so adding the label flips it to Flagged at once.
- A question's task: its owner answers in a comment and marks it Done; the answer is drafted into the field (2 tests).
- A filed notice's clock stops on the board and shows how early it was filed (2 tests).
- "Not by AI" wording replaced everywhere by "Calculated from the cited law".

## Rules check (Codegeist 2026)

- Under 5 minutes, and inside the 3 minutes judges commit to.
- Footage of the project functioning in Jira Service Management, Confluence and Rovo.
- No third-party trademarks: Atlassian products only; Rovo Studio is filmed on the app's own four tools.
- No music; synthesised sound and the narration. Fonts: Inter and Instrument Serif (SIL OFL).
- English.

## Gates

On the delivered file (1920x1080, 60 fps, 9474 frames, 158.0 s), MotionMaxxing look.py:
- G0 render exists: PASS (duration matches, audio present). G2 no empty frame: PASS.
- G3 end hold: flagged (7.7 s), but this is a measurement limit, not a frozen ending: look.py compares 96x54
  thumbnails, where the end card's three small lines landing (2:33, 2:35, 2:36) do not register as change. The last
  element lands at 2:36.9; the film ends at 2:37.9, a 1.0 s hold.
- Glitch scan (`tools/glitches.py`, every frame at 30 fps): 0 corrupted frames. The 2:14 Rovo glitch the user found
  came from screenshots taken during recording; 32 such frames were removed from that take, and the capture script
  no longer screenshots while recording.
- Loudness: -14.1 LUFS integrated, true peak -1.4 dBFS.
- G1/G4 by eye on 2-fps sheets of the whole film; fixes from that pass: the Rovo glitch; the empty "required facts"
  card (its rows now arrive with it); stray Jira layout behind the label shot (framed on the sidebar only); shots
  arriving behind the chapter titles (each now starts after its title); an empty Studio frame before the tools load;
  Clerk's reading moment now pushes in; the accept shot ends on the pressed button instead of the panel jumping.
