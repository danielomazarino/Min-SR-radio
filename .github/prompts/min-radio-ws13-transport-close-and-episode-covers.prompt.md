---
name: WS13 — close button to the transport row, and the iTunes album cover for episodes
description: Three owner-reported items. (A) Move the expanded player's close button down to the transport row at the right end, matching the minimised bar, leaving a width-only spacer in the header so the text column holds. (B) Extend the iTunes album-cover lookup to episodes, which the previous brief wrongly ruled out on a mis-tested premise. (C) The mid player's podcast name row is confirmed correct — verify it, change nothing. Then commit AND PUSH so the owner can verify on their iPhone.
applyTo: "**"
---

# WS13 — transport-row close button, episode album covers

## 0. The owner is away. The push is the deliverable.

They will check on their **iPhone**. There is no CI here — `.github/` holds only
`agents/` and `prompts/`. **Pages serves the repository root of `main`, so the
push IS the deployment.** Commit, build, push, verify, report. Do not stop at a
commit.

**The owner could not be reached to answer clarifying questions**, so §3 records
the judgement calls you are being asked to make on their behalf. Make them
defensibly, state them plainly in your report, and do not present them as the
owner's decisions.

## 0.0 iPhone first — UX/UI claims require the owner, not inference

> "you have to request my support for all ux and ui related questions. iphone
> comes first"

**The iPhone is the reference device. Desktop Chromium is not.** That is
established: WS11a reported "no overflow at 390px and 340px" from a **5-button
non-DVR** channel, while the owner's screen was the **7-button DVR** case where the
text column measured **0px**.

- Never state how something looks on the owner's phone as fact. You have no
  device. Report what you measured, where, at what viewport, in what player state
  — labelled Chromium.
- Never invent a visual justification for a change.
- **When a UX/UI question cannot be settled by measurement, stop and ask.** One
  message costs far less than a wrong assumption. But see §0.1: the owner is away,
  so if asking would block the whole workstream, make the defensible choice, write
  down that you did, and flag it for review. Do not simply guess silently.

## 0.1 Measure your own baseline — trust nothing written in this prompt

Run `npm test` yourself first and record the real counts. **No count, line number
or state description in this prompt is a live measurement.** An earlier prompt
carried a hardcoded baseline that went stale within minutes and the agent
correctly refused to act on it.

**Find things by TEXT, not line number** — the files are edited as you work.

## 1. Part A — move the close button to the transport row

### What the owner said

> "the mid player close button now is back to the left above the miniture image
> and not to the right on a row above the title to mimic the ui for the minimised
> player. this issue is both on radio channel playing and podcasts"

"mimic the ui for the minimised player" is the specification. The minimised bar
reads: **thumb · text · play · chevron · close** — the close button is the last
item, on the same row as the play and chevron controls.

This is the same end state WS11a aimed for. **WS11a was not wrong in its
mechanism — it was wrong about who asked for it.** It was authorised by a brief
that said "on the same row as the transport buttons", which was a transcription
error in the brief, not the owner's intent. Now it *is* the owner's request, so do
it.

### The trap, and why it has bitten twice

`.player-header .player-btn-close` is sized `var(--player-art)` and **doubles as
the artwork-column spacer**. The header is a flex row with `gap: var(--player-gap)`,
so that button's width plus the gap lands `.player-title` and `.player-sub` on the
artwork's right edge — the same left edge as `.player-quality` and
`.now-playing-line`.

**Deleting the button removes the thing that CREATES the space, not the space.**
The text column collapses to 0 and every existing test still passes. This has
happened once already.

Required:

- `closeBtn` moves to `.player-controls`, at the right-hand end, after the
  transport buttons and **after** `expandBtn`, so the order is
  `… transport · chevron · close` — matching the minimised bar.
- The header keeps a **width-only spacer** in the button's place: an element
  sized `var(--player-art)`, `flex: none`, **with no height**, so the header still
  collapses and the text column still starts on the artwork's right edge.
- **The spacer width must derive from `var(--player-art)`, never a pixel
  literal.** A hardcoded `44px` drifts the moment that value changes, which is the
  one thing this design exists to prevent.
- The chevron currently has `margin-left: auto` in `.player-header` to push it to
  the far right. Once the header holds only the spacer and the texts, that rule is
  either dead or must be re-derived — decide by measurement, and say which.
- Delete the now-dead `.player-header .player-btn-close` / `.player-expand-btn`
  rules, or restore them deliberately. A rule that does nothing is worse than no
  rule, because it silently re-applies if a button ever returns.

### The checks that actually catch this

At 390px, in the **7-button DVR state**, measure:
- `.player-title`, `.player-quality`, `.now-playing-line` left edges and **the
  spread between them (must be 0px)**
- `.player-meta` width and the player's total height

**The 7-button state cannot be reached naturally in Chromium** — SR's DVR stream is
CORS-blocked, so the programme-skip buttons never render. Construct it: inject two
real 44×44 buttons into the real `.player-controls` of the real player with the
real app CSS, measure, then remove them. **Say that you constructed it.**

**`document.documentElement.scrollWidth` is useless here** — it stays under the
viewport even while a flex row overflows internally. Use
`row.scrollWidth > row.clientWidth` and `meta.getBoundingClientRect().width`.

## 2. Part B — the iTunes album cover for episodes

### ⚠️ The previous brief ruled this out on a premise that was WRONG. It is withdrawn.

The earlier brief said the lookup "is keyed on the track title" and that for an
episode the title is the *episode* name, so it would not match. **That
mis-described the code.** `refreshNowPlayingArtwork()` searches:

```js
const q = encodeURIComponent(`${song.artist} ${song.title}`.slice(0, 180));
```

and for an episode `song` is `episodeCurrentTrack`, which is built from the
episode's **per-song track list** — so the search input is `artist + title` of an
actual *song*, not the podcast name. The earlier brief tested the podcast name,
got nonsense hits, and drew a conclusion about a code path it had not read.

### Measured, on real data

Against one Finnish-language podcast's actual track list: **6 of 18 tracks hit,
and every hit returned the correct artist.** The earlier brief's examples
("P3 Soul" → PARTYNEXTDOOR) were podcast-name searches, not track searches — they
say nothing about this path.

**But P3 Soul (id 2680) currently returns ZERO tracks** from
`web-api.sr.se/v1/player/ondemand`, so for that podcast there is nothing to search
with. Several other podcasts return tracks whose `relativeStartTime` /
`relativeEndTime` are `null`, so `updateEpisodeTrack`'s containment test can never
match and no song resolves. **That is upstream data, not this change.**

### Required

- Let the episode path run the same `refreshNowPlayingArtwork()` lookup the live
  path runs. Reuse the existing `artworkSeq` / `nowPlayingSeq` guards and the
  existing `artworkCache` — do not invent a second mechanism, and do not remove a
  guard because "episodes do not poll".
- **Fall back to `live.artwork` (the programme image) when there is no song cover.**
  The user asked for the album cover "as it does for radio channels"; where no
  album cover can be resolved, the programme image is the correct thing to show
  and is what the no-song branch already uses. **Never show an unrelated cover and
  never a broken image.**
- **Do not extend the iTunes lookup to any non-song title.** Guard it: only run the
  lookup when a track with a real `artist` and `title` resolved. An empty artist
  produces a garbage search — that is how the earlier bad hits happened.
- The mid-player thumbnail and the podcast's own image are **not** in question. The
  owner has confirmed those are correct.

### Report the real hit rate

Measure the hit/miss rate across **several real podcasts** and paste the raw
numbers. A single anecdote is not evidence — the earlier brief's error was
generalising from too few samples. If the rate on real track data is poor, say so
plainly; do not present a partial success as a working feature.

## 3. Part C — the mid player. CONFIRMED CORRECT. Change nothing.

The owner reported: *"for the mid player i see that the podcast show name is now
on the row under the episode name as you see attached it it is on the minimised
player."* Their screenshot shows the minimised bar with title / programme / song
stacked.

**This is the WS12 Part C change working as intended.** It was a report, not a
complaint. **Do not modify the mini-bar, the mid player, or the three-line stack.**

Your only task here is **verification**: prove it still holds and say so. If you
find it broken, report that rather than fixing it.

## 4. Judgement calls you are making on the owner's behalf

The owner was unavailable. State each of these in your report as **your** decision,
so it can be reversed cheaply if it was wrong:

1. **The close button goes to the transport row** — the reading that matches
   "mimic the ui for the minimised player" most directly.
2. **The mid player is already correct**, so no change.
3. **Part B ships with a programme-image fallback** rather than being deferred
   until SR restores track data, because the request was explicit and the
   fallback is strictly better than today's behaviour.

## 5. Order of operations

1. `npm test` — record your own baseline.
2. Implement A, B. Verify C.
3. Mutation-test every new guard. **Compare md5 before and after each mutation** —
   a harness that only checks the anchor reports no-op mutations as green, which
   produced four false results in WS11.
4. `node --check` all sources.
5. `git add` **source and its tests in the SAME commit**, then commit. A previous
   workstream committed tests without the `app.js` they test, which left HEAD
   failing (`start marker not found: $main.appendChild(el('p', {`) — one commit
   later, pushed on schedule, that would have deployed a failing state.
6. **`npm run build`.** It writes `dist/` *and* copies the hashed bundles back
   into the repo root. **A commit without a fresh build deploys nothing.**
7. `git add -A` the artifacts, commit.
8. `git push origin main`.
9. **The four deploy checks (§7).**

**Build-id ordering is forced:** the id is derived from the last commit that
touched `app.js`, so commit the source, *then* build, *then* commit the artifacts.
Building first names the parent commit and shows the owner an id that resolves to
a real commit but not the one they are running.

## 6. Boundaries — do not touch

- **Seek behaviour.** `seekBy`, `seekToLive`, `seekToProgramTime`, `posMs`,
  `liveEdgeWallMs`, `playheadWallMs`, `pickByPosition`, `resolveMetadataForPosition`,
  the programme-skip lookup, and every DVR constant. **The forward-skip button
  works on the owner's phone.** Byte-identical to `git show 745493c:app.js`; prove it.
- The minimised bar's structure and its three buttons (Part C is verification only).
- The podcast thumbnail / programme image.
- Do not restore `1.5.0`, do not add a version injection, do not bump
  `package.json`, do not touch `sw.js`'s caching or the manifest.
- Do not restore the DVR window readout or the WS5 attribution footer.
- The build number stays under NYHETER. Do not put it back in the topbar.
- No new dependencies. No CI. No new files other than test edits.
- **Do not fix anything you notice in passing.** Report it. Scope creep turns a
  reviewed change into an unreviewed one.

## 7. The four deploy checks — all four, then report raw output

1. Live `index.html` references the new hashed bundle.
2. Live `sw.js` has a new `CACHE_NAME`.
3. The new **local** bundle contains the change.
4. The **served** bundle contains the change.

`index.html` loads the **hashed** bundle, not `app.js`. Checking `app.js` proves
nothing about what is served.

**Re-read the served `index.html` AFTER your wait loop.** A hash captured
mid-deploy has drifted before and was reported as a success. Then verify the
served bundle carries each Part A and Part B change, and that the header spacer is
present with no `closeBtn` left in the header.

**Also clone `origin/main` into a scratch directory and run the suite at the tip.**
That is the check that would have caught the broken-commit incident, and a green
working tree is not the same thing as a green tip.

Then tell the owner:

> På telefonen: avregistrera service workern eller hard-reload. En gammal service
> worker fortsätter att servera den gamla layouten och låter en bra deploy se ut
> som trasig.

## 8. Anti-vacuity rules — this project has been bitten by every one

1. **Never assert a guard "does not fire" once your change makes it unreachable.**
2. **A negative result scoped to one direction is not a negative result.**
3. **A pattern containing a comment can never match a `stripComments()`ed slice.**
4. **Assert the specific promise, not a proxy.** A reviewer checked the *header*
   alignment and declared the layout intact while the seek row had a third flex
   child.
5. **Never use `git checkout --`** to restore uncommitted work. It destroyed WS5b.
6. **Mutation harnesses must compare md5 BEFORE AND AFTER each mutation.**
7. **`region()` searches FORWARD** — a region opened on the wrong declaration
   silently begins *after* the element under test.
8. **A check that cannot fail is not evidence.**
9. **An unverified claim, duplicated, becomes indistinguishable from an observed
   one.** Do not copy a rationale into more than one place without asking whether
   it was ever true. One copy can be corrected; four read as consensus.

## 9. Honesty requirements

**Do not describe anything you did not measure as measured, and nothing about the
iPhone as verified — you have no device.**

State which parts were measured in Chromium (viewport, player state), which were
constructed, and which are unverified. Desktop Chromium green is **not** device
correct; that has happened three times here.

Report honestly if:
- the iTunes hit rate on real track data is poor,
- the 7-button figures are constructed rather than observed,
- P3 Soul still shows the programme image because SR returns no tracks for it,
- anything in Part C is not as described.

A partial success reported as a working feature is the exact failure this project
keeps paying for.

## 10. Status updates

**Roughly every 5 minutes, and no more often.** Do not report every step; do not
go silent for longer than about 5 minutes. If blocked, say what you are blocked on
rather than retrying. Lead with what changed, what you measured, and whether it is
**live** — and if the push has not happened, say so plainly.
