# 72 Hours design system (2026-10-29)

Mockups: https://claude.ai/artifact/UL29AZkcSba9brHKwBcKvR (6 screens, reviewed with gstack /design-review).
Mode: OPERATE (app UI inside Jira). Goal: calm, premium, native to Atlassian; one accent; nothing competes with the
deadlines.

## Principles
- One accent (blue). Status is a 7–8 px dot plus words, never a coloured pill or a colour on its own.
- Hairlines and spacing separate content; cards only for the three surfaces (Deadlines, Evidence, Open questions).
- Lists, not tile grids. No stripes, gradients, glows, emoji or icon-in-circle decoration.
- Deadlines are counted by rules, not AI; the UI says so once ("Counted by rules, not AI").
- Copy is plain and specific: "Ask Ken", "Draft notices", "Correct time". Sentence case everywhere.

## Type (Atlassian Sans in Jira; Inter in mockups; one family only)
| Role | Size / line | Weight | Tracking |
| --- | --- | --- | --- |
| Page title | 28 / 34 | 600 | -0.5 px |
| Section title | 17 / 22 | 600 | 0 |
| Body | 15 / 22 (14 / 20 in the narrow panel) | 400 | -0.1 px |
| Label, meta | 13 / 18 | 400–500 | 0 |
| Caption, citation | 12 / 16 (minimum) | 400 | 0 |
| Clock digits | 46 / 50 (24 / 28 in panel), seconds 20 / 13 | 600 | -1.6 px / -0.6 px |
All numbers use `font-variant-numeric: tabular-nums`. No monospace font.

## Colour (custom properties layered on ADS tokens via `html[data-color-mode]`)
| Token | Light | Dark (Jira dark surface) |
| --- | --- | --- |
| ground | #F5F5F7 | #1F1F21 |
| card | #FFFFFF | #2B2C2F |
| raised (nodes, inner) | #F2F2F7 | #3A3B3F |
| text | #1D1D1F | #F5F5F7 |
| secondary text | #6E6E73 (4.6:1 on ground) | #A9AAAF / #B5B6BB on raised |
| hairline | rgba(0,0,0,0.08) | rgba(255,255,255,0.08–0.10) |
| accent | #0B5CD5 | #0A72EF (buttons), #6CADFF (links) |
| tinted button | #EAF2FF / #0B5CD5 | rgba(10,132,255,0.20) / #8CC0FF |
| clock board | #1C1C1E | #141416 + hairline |
| clock tile | #2C2C2E | #2C2C2E |
| urgent (< 24 h) | #FF9F0A | #FF9F0A |
| running | #9BD35A dot | #9BD35A dot |
| breach running | #E5484D dot | #E5484D dot |
| AI draft | #7A3DB8 on #F3ECFB | #D7B8FF on rgba(191,90,242,0.18) |
| decision | #FFD60A dot | #FFD60A dot |

## Shape and space
- 4 px grid. Card padding 24–28 desktop, 16 panel. Row padding 14 / 10.
- Radius: board 22, cards 18–20, clock tiles 16, buttons 10–12, chips 6–8.
- Shadow (light only): `0 1px 2px rgba(0,0,0,.04), 0 6px 24px rgba(0,0,0,.04)`; board `0 12px 32px rgba(0,0,0,.12)`.
- Buttons 36 px desktop, 44 px panel (touch); icon-free.
