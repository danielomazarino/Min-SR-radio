---
description: WS75 — more vertical room in BOTH player views, make the cover square the same size as the channel/podcast icons, and stop the player covering the build number when it is closed.
---

# WS75 — player: more vertical room, cover square, and the build number

**This is a brief, not a summary. It is a contract.** Read `AGENTS.md` first.
The owner wrote it on 2026-10-08; a previous session received it, measured one
number, and then the machine was restarted. **No code was written.** The working
tree is clean at `93130e5`; the live site serves build `83daf23`.

## The owner's words, verbatim — do not paraphrase or widen

> "On the iphone I'm thinking that we should strive to increase the vertical
> space more on both the base and the extendended player for a profesional look.
> the album covers could get excatly the same pixel width and heigt as the
> channel and podcast icons, and the extended player could cover the build
> number exactly. can you make a pass to make the heights between different rows
> and what you see visually to make that happen. wehn done i will come back with
> adaptations on size changes on the elements taht are visual. but i want to see
> vertical changes first. so keep everything else the same. Make sure to not
> overthink and deploy. i see that for each iteration testing takes longer and
> longer, so make sure for this that you are only testing what is needed to test
> and not the full suite."

And the follow-up correction (2026-10-08, ~19:00 CET):

> "the new vertical border for the extended player could become to the build
> number [so that on] iphone [it] is just below the border so the build number
> is not seen when playing."

## What each request means, in the code

The player has **two views**, and the owner means **both**:

| owner's term | code | where |
|---|---|---|
| **base player** (aka mid/mini player) | the compact `.player` with header row + transport + song row + seek bar | `styles.css` `.player`, `.player-row`, `.player-meta` |
| **extended player** | the same `.player` with the program-info panel `.player-expand` open | `styles.css` `.player-expand`, `app.js` `player-expand` |
| **album cover** | the artwork square `.player-thumb` | `styles.css` `--player-art` |
| **channel/podcast icons** | the `.stream-icon` squares in the home rows | `styles.css` `.icon-scroller .stream-icon` |
| **build number** | the `.build-line` paragraph under NYHETER | `styles.css` `.build-line`, `app.js` `APP_BUILD` |

## Acceptance criteria (each measured on the rendered DOM, iPhone-13 width)

**C1 — the cover square matches the channel/podcast icons.**
The artwork square `.player-thumb` must be the **same pixel width and height** as
one channel icon. Measured on the live site at 390px **with the scrollbar
suppressed** (see the trap below): `.stream-icon` = **77.0 × 77.0px**, so the
cover must become **77 × 77**, up from the current **44 × 44**.

- Drive `getBoundingClientRect()` on `.icon-scroller .stream-icon` and on
  `.player .player-thumb`; assert both are equal to within 0.5px on both axes.
- The live `.player-thumb` today is `width: var(--player-art); height:
  var(--player-art)` with `--player-art: 44px`. **Do not hardcode 77.** The icon
  size is viewport-derived (`.icon-scroller .stream-icon { flex: 0 0 calc((100% -
  42px) / 4); aspect-ratio: 1 }`), so at 390px it is 77 and at another width it
  is not. Confirm the value the app actually computes at 390px and make the cover
  equal it. If you derive `--player-art` from the same arithmetic the icons use,
  say so and prove the equality in the driven test.
- **The row height must follow.** `.player-row` height is driven by its tallest
  child; a 77px cover in the same row raises the transport row's height. Verify
  the transport buttons/seek bar do not clip and the row does not overflow at
  390px.

**C2 — the extended player's bottom edge reaches the build number, and the build
number is NOT visible while the player is open.**
At 390px with the expanded player open, the player's bottom edge is the viewport
bottom (it is `position: fixed; bottom: 0`). The build number must be **behind**
the player, i.e. `.build-line`'s rect must be fully covered by `.player`'s rect —
**`.build-line.getBoundingClientRect().bottom <= player.getBoundingClientRect().top`
must be false** (it must be overlapped), and `.build-line` must not be visible in
the region above the player.

- Simplest mechanism to satisfy both halves: **size the expanded player so its
  top edge sits at or above the build line.** Today the expanded player top is
  ~611px and the build bottom was ~462px in one state — i.e. the build line can
  already be above the player, which is the owner's complaint that it is "just
  below the border and not seen". Confirm on the *built* page what the real
  numbers are before choosing the mechanism, and **prove the build line is not
  readable while the player is open** (covered or scrolled out) — the owner's
  words are that it should not be *seen*, not merely that it is close.
- Do not move the build line in the DOM or change its text. The build id is
  load-bearing (WS73b) and the owner reads it to know which build they are on.

**C3 — more vertical room in BOTH views.**
Increase the vertical breathing room of the base player **and** the extended
panel, in the same vertical-only discipline WS68/WS73/WS74 used: `padding-block`,
`line-height`, `row-gap` — **never a horizontal value and never an explicit
height** (see the `.player` comment block, which states why). Current values to
build on: `.player` padding `16px 16px calc(var(--safe-bottom) + 18px)`,
`--player-row-gap: 11px`, `.player-meta-row { min-height: 30px; line-height:
1.65 }`, `.player-title`/`.player-sub` `line-height: 1.65`, `.player-controls {
gap: 12px }`.

- The owner has now reported **twice** that a step was "not visible" (WS73 → WS74
  and again). Take a **visible** step, not a marginal one. State the measured
  before/after height of the base player and the expanded panel.
- Note the measured horizontal ceiling: `.player-controls` is `flex: none` and
  shares the row with the text column, so widening the transport gap steals from
  the title/pill. WS74 measured 12px as the largest safe value at 390px. **This
  task is vertical; do not touch `.player-controls` gap unless the wider cover
  (C1) forces a re-measure, and if it does, re-measure the pill at 390px.**

**C4 — "keep everything else the same."**
No change to: the transport logic, the poll, the schedule, the news rows, the
favourites, station logos, the DVR programme-skip buttons' behaviour, or any
horizontal alignment except what C1 forces. Spot-check the neighbours and say so.

## Method and traps (§14, §2)

- **Suppress the scrollbar or every number is wrong.** At 390px the classic
  scrollbar occupies ~15px; the *previous* session measured the icon as **73.3px**
  because it did not suppress it. With the scrollbar suppressed the icon is
  **77.0px** — this is the number that matches the owner's own iPhone-13 report.
  Inject `*{scrollbar-width:none} ::-webkit-scrollbar{display:none}` before
  measuring, or measure at the owner's exact device metrics.
- **Assert on the rendered DOM, not on source text.** This is a geometry task;
  a source-text assertion cannot tell you whether the cover is 77px.
- **Only five pixels of the cover are geometry; the rest is a picture.** The
  cover is `.player-thumb` with an `<img>`. Changing `--player-art` moves the
  text column (`.player-header-spacer`, `.player-time-row`, `.now-playing-line`
  all use `var(--player-col) = --player-art + --player-gap`), so the title, the
  pill and the song line will all shift right by (77 − 44) = **33px**. That is
  *forced* by C1 and is in scope; anything *else* that moves horizontally is a
  defect — measure the text column before and after and account for the 33px.
- **Test only what this change touches.** The owner asked explicitly. Run the
  guards for `.player`, `.icon-scroller`, and the build id; skip the DVR/seek
  suites. Report the count you ran.

## Deliverables

1. The CSS change (and any `app.js` change only if the cover size cannot be
   derived in CSS).
2. Focused guards: (a) cover square == icon square at 390px; (b) the build line
   is covered while the player is open; (c) the base player and expanded panel
   are measurably taller than before. Restate any existing guard the change
   supersedes **per `AGENTS.md` §7b**, naming what it asserted and what it now
   asserts — do not delete or weaken.
3. A `SESSION-STATUS.md` block (format in `AGENTS.md` §13), **append-only**.
4. `npm run build`, then commit **source + tests in one commit**, **artifacts in
   a second**, then **push**, then the four deploy checks (§15), each reported
   PASS/FAIL individually.

## Deploy: yes

**Push when done.** The owner explicitly wrote "Make sure to not overthink and
deploy" and will look at the live site. This brief says *push* because the owner
asked for a deploy.

## Report back to the owner (plain English, not technical)

- Which build id the line under NYHETER should now read.
- The measured before/after: cover size, base player height, expanded panel
  height.
- What you could **not** prove offline (the iPhone is the reference device).
- Ask the owner to open the live site on the iPhone 13 and confirm the cover is
  the same size as the channel icons and the build number is hidden while playing.

## Known blind spot to state, not hide

At **375px** with a five-button DVR row the quality pill already clips (WS74
measured this). Raising `--player-art` to 77 steals a further 33px from the text
column, so the pill's ceiling moves. **Measure the pill at 390px (the owner's
device) and state honestly what happens at 375px** — do not claim it is fine.
