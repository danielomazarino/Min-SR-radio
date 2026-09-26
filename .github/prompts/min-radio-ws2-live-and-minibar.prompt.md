---
name: Min Radio — WS2 Swipe Panel, Back-to-Live & Mini-Bar Fixes
description: Workstream 2 for Min Radio. Fix three confirmed bugs: swipe-up opens an expand panel showing the wrong channel, the "Till Direkt" button does nothing as the final step back to live, and a fresh channel sometimes starts as a minimised mini-bar.
argument-hint: "Runs Workstream 2 only — swipe panel (primary), back-to-live, mini-bar. Three confirmed bugs."
agent: agent
---

You are the Min Radio coding assistant. This is **Workstream 2 only**. It fixes
exactly three bugs, all confirmed or reproduced against real evidence.

Bug 3 is the most important: on iPhone the owner opens the expanded player by
**swiping up**, never by tapping the chevron, so the swipe path is the primary
path on the device that matters. Fix it first.

This is the shortest and most valuable workstream so far. Both bugs have an
identified mechanism. Do not expand the scope, do not refactor, and do not
"improve" anything you notice in passing.

## Progress reporting — required throughout

The product owner is not a technical expert and is following this from outside.
They find a stream of near-continuous updates noisy rather than reassuring.

**Post one short status update roughly every five minutes of working time —
and no more often than that.** Do not post one before or after every single
step. If less than five minutes have passed since your last update, stay quiet
and keep working. Five minutes is a target, not a floor: several minutes with no
update is fine and expected, and one message covering several completed steps is
better than three messages covering one step each.

Write each update in plain Swedish or plain English (match the language of the
request), a few lines at most, covering:

- what you are doing right now,
- what you have finished since the last update,
- anything you found that contradicts this brief, and
- what you will do next.

Do not paste raw tool output into status updates — summarise it, and keep raw
output for the final report. **Post the status and then continue working.**
Never stop to ask permission on a routine step, and never wait for a reply.

## Read first

1. `README.md` — architecture, build/test commands, Pages deployment model.
2. The active work queue at the top of `ENHANCEMENTS.md`.
3. `/memories/repo/sr-pwa-app.md`, especially the WS1 and WS2 sections.
4. The regions of `app.js` named below, in full, before writing anything.

## Verified context (checked 2026-09-27 — trust this, do not re-derive)

Repo: `/home/lm/Dev/SR pwa app`. `npm test` reports **126 passing, 0 failing**.
That is your baseline. If your run differs, stop and report before changing
anything.

`HEAD` is `f71512d` ("Fix unbounded timeupdate listener leak in renderPlayer").
The live site serves `app.ddd0127b.js` with service-worker cache
`minradio-c0abe328`.

### How deployment works — there is NO CI

There is no GitHub Actions workflow in this repository and there never was; some
older notes claim otherwise and are wrong. GitHub Pages serves the **repository
root of `main`**. `npm run build` runs `scripts/build-pages.mjs`, which writes
`dist/` and then **copies the built artifacts back into the repository root**.
The hashed bundles are tracked in git.

So the deploy sequence is: edit → `npm test` → `npm run build` → `git add` the
changed root artifacts → `git commit` → `git push`. **A commit without a fresh
`npm run build` deploys nothing at all** while looking completely successful.

---

## Bug 1 — "Till Direkt" does nothing as the final step back to live

### What the owner observed

On a DVR live channel: skipping back to an earlier programme works. Skipping
forward to a later programme works. **Only the final step back to live does
nothing.** The button is present and visible after one skip back. Pressing it
twice does not help either. This is on a real iPhone.

### Mechanism (identified, not yet proven at runtime)

`seekToLive()` at `app.js:1495`:

```js
function seekToLive() {
  const cur = state.current;
  if (!cur) return;
  const end = cur.dvrAvailable ? cur.seekableEnd : null;
  if (!Number.isFinite(end)) return;
  audioEl.currentTime = end;
  updateSeekableState();
  renderPlayer();
}
```

It seeks to `cur.seekableEnd` — the **exact end of the buffered range**, which
is the live edge. Safari and native HLS treat a seek to the buffered boundary as
a no-op or refuse it, so nothing visibly happens. Programme-skip seeks work
precisely because they target a position in the *middle* of the buffer, not the
boundary.

A second, compounding problem: `updateSeekableState()` (`app.js:733`,
`LIVE_EDGE_TOLERANCE_S = 10`) computes
`atLiveEdge = distanceFromLiveEdge <= LIVE_EDGE_TOLERANCE_S`. Landing exactly on
the end leaves zero distance, which is *within* tolerance, so the UI should
settle — but if the seek is ignored, the distance never changes and the button
state never resolves either.

### Required fix

Seek to a position slightly **behind** the live edge rather than exactly onto
it. Use `LIVE_EDGE_TOLERANCE_S` (`app.js:733`) as the basis — for example
`Math.max(cur.seekableStart, cur.seekableEnd - LIVE_EDGE_TOLERANCE_S)` — so
the result is still considered "at live" by `updateSeekableState()` while
giving the browser a real, non-boundary target.

Requirements:

- **Never seek outside the buffered range.** Clamp against `seekableStart`. If
  `seekableStart` is null or not finite, bail out exactly as the current code
  does.
- **Preserve the paused/playing state.** The function's contract is a seek only:
  do not reload the stream, do not create a new HLS session, do not call
  `play()`.
- Keep the `updateSeekableState(); renderPlayer();` sequence so the DVR UI
  follows the new position.
- Do not change `updateSeekableState`, the tolerance constant, or the
  programme-skip buttons.

If you find evidence that this reasoning is wrong — for example that the seek
*does* land but the UI simply does not refresh — say so in your report and
explain what you observed instead. Do not force the change to fit this brief.

---

## Bug 2 — a fresh channel sometimes starts as a minimised mini-bar

### What the owner observed

Starting a new channel sometimes opens the compact mini-bar instead of the full
player. It was seen on P2 and P3.

### Mechanism (identified, not yet proven at runtime)

`renderPlayer()` at `app.js:1652` branches on the module-scope flag:

```js
$player.classList.toggle('minimized', playerMinimized);
```

and `app.js:1662` returns a completely different, minimal layout when
`playerMinimized` is true.

The flag is set true only in `minimizePlayer()` (`app.js:2379-2384`, guarded by
`if (playerMinimized || !state.current) return;`) and cleared in
`restorePlayer()` (`app.js:2393-2394`) and inside `stopAndClosePlayer()`
(`app.js:1224`, with the comment *"a fresh play must never open as mini-bar"*).

**`playTrack()` (`app.js:1064` onward) does not reset it.** It calls
`stopEpisodeTracks()` and `stopNowPlayingPoll()` and assigns `state.current`,
but never sets `playerMinimized = false`. So if the owner swipes the player
down to the mini-bar and then taps a *different* channel, the new playback
renders in the minimised layout — contradicting the intent stated in the
comment at `app.js:1224`.

### Required fix

Make a fresh playback always start from the full player. The cleanest approach
matching the existing intent is to reset `playerMinimized = false` in
`playTrack()` alongside the other per-session resets (`stopEpisodeTracks()`,
`stopNowPlayingPoll()`, `state.current = track`), so every new session starts
un-minimised regardless of what the previous one was doing.

Requirements:

- Do **not** remove the reset in `stopAndClosePlayer()`.
- Do not change `minimizePlayer()` or `restorePlayer()` semantics.
- Do not change the mini-bar layout, styling, or gesture handling.

---

## Bug 3 — swipe-up opens an expand panel showing the WRONG channel (PRIMARY BUG)

**This is the most important bug in this workstream.** On a real iPhone the
owner never taps the chevron — swipe-up is the only way they open the panel. So
this is the primary path on the device that matters, not an edge case.

### What the owner observed

- Tapping the **chevron** always shows the correct channel.
- **Swiping up** on the player shows the **previous** channel's card. It never
  self-corrects — not after 45 seconds, not after several minutes.
- Visible on a phone screenshot: player header and highlighted tile both show
  **P2**, while the expansion card shows **P3** with P3's artwork.
- Channels with a saved favourite and artwork can look correct by coincidence.
  Talk/speech channels, which use the fallback branch, expose it clearly.

### Mechanism — REPRODUCED in Chromium, do not re-derive

There are two independent code paths that create the panel, and only one of
them maintains its state:

1. **Chevron tap** — the `expandBtn` click handler (`app.js:1826`) creates the
   panel *and* sets `aria-expanded="true"` and the `open` class together.
2. **Swipe up** — `enablePlayerGestures()`'s `onExpand` callback
   (`app.js:2284`), reached from the drag handler at `app.js:2327-2330`, which
   does `if (!panel) onExpand()` **during the drag**.

In `finish()` the two outcomes are handled asymmetrically:

- The **spring-back** branch (`app.js:2364-2370`, dragged up but under
  threshold) correctly does `panel.remove()` and resets
  `aria-expanded`/`open`.
- The **commit-expand** branch (`app.js:2352-2356`) only does
  `if (panel) panel.style.height = ''` and returns. It **never sets
  `aria-expanded="true"` or the `open` class, and never verifies the panel it
  kept belongs to the current channel.**

Observed end state after a single short up-swipe, in Chromium:

```
.player-expand nodes in DOM : 1     (VISIBLE, showing the PREVIOUS channel)
.player-expand-btn aria     : "false"
.player-expand-btn .open    : absent
.player-title               : correct current channel
```

A visible panel whose button claims it is closed, showing a stale channel.

**Why it never self-corrects:** the panel is still a child of `$player`, so
`paintNowPlaying()` and `paintProgramTitle()` — which locate it with
`$player.querySelector('.player-expand')` at `app.js:1022` and `app.js:1043` —
do find it and do call `_srRepaint()`. But `renderSongView` re-renders from the
`cur` variable **captured in the closure when the panel was built**, which is
the channel that was playing *at swipe time*. It never re-reads live state.

### Required fix — two parts, both are needed

**Part 1 — make the commit-expand branch consistent.** When the gesture commits
to expanding, the panel must end up in the same state the chevron path
produces: `aria-expanded="true"` and the `open` class set. Whatever invariant
the spring-back branch maintains, the commit branch must maintain too. A single
shared helper for "open panel" / "close panel" state is preferable to two
copies drifting apart again.

**Part 2 — this is the one that actually satisfies the owner's requirement.**
The owner asked, in effect: *if the expansion is not showing what is playing,
it must show the correct channel.* So the panel must never be able to display a
previous channel, **regardless of how it was opened**.

`renderSongView` must derive the channel identity from **live state**
(`state.current`) at paint time, not from the `cur` captured in the closure.
Read the current track when rendering, not when building.

Requirements:

- Do not change what the panel *displays* — the same artwork, label, song and
  artist content. Only the source of truth for *which channel* is changing.
- A repaint must be able to correct an already-visible stale panel, without the
  user having to close and reopen it.
- Do not break the chevron path. It currently works and must keep working.
- Do not change the panel's layout, styling, grab-zone, or swipe-to-fold
  gesture.

### Also fix while you are in this code — a listener leak

`enablePlayerGestures($player, {...})` is called from `renderPlayer()`
(`app.js:2284`) on the **singleton** `$player`, and it registers
`touchstart`/`touchmove`/`touchend`/`touchcancel` listeners with **no matching
removal**. `renderPlayer()` runs on every `playTrack`, `advanceCandidate`,
buffering event, quality change, watchdog fire, minimize and restore — so the
gesture listeners accumulate for the life of the page. One swipe can then be
handled by several stacked handlers, which is a plausible contributor to the
inconsistent behaviour above.

This is the same class of defect as the WS1 `timeupdate` leak, in the same
file. Apply the same fix pattern the file already uses for `audioEl._srUpd` /
`audioEl._srDvrUpd` (`app.js:1909-1912`, `2012-2015`): store the handler on the
element, remove it before re-adding, and pair the removal with the matching
`metaDiagCount*` call so the WS0 counters keep telling the truth.

Note that `enablePlayerGestures` uses `touchstart`/`touchmove`/`touchend`/
`touchcancel` — the WS0 counters may only be instrumented for `audioEl`. If
there is no appropriate counter, use whatever mechanism keeps the existing
counters consistent; do not invent a new global.

---

## Explicitly OUT of scope — do not touch

- **The chevron expand path.** It works correctly today. Bug 3 changes shared
  state handling, so re-verify the chevron still works — but do not redesign
  it.
- **The channel-mismatch / stale-metadata investigation.** No root cause has
  been established for the compact header. Do not go looking. Bug 3 is a
  distinct, already-reproduced defect.
- **`scheduleCache`.** It is never cleared and has a 10-minute TTL. Noted, not
  to be changed here.
- **`armPlaybackWatchdog`.** It calls `advanceCandidate()` whenever
  `readyState < 3` with no visible "candidates exhausted" guard. That may be a
  real problem, but it is a separate workstream. Report it, do not fix it.
- No refactoring of `renderPlayer()`. No renaming. No drive-by cleanups.

## Tests

Add tests to `tests/metadata-diag.test.mjs`, following that file's existing
idiom.

The suite asserts on **source text**, and `app.js` is heavily commented with
comments that name identifiers an assertion is trying to prove the code does
*not* use. The file already has a string-aware `stripComments()`; **reuse it**
and assert on comment-stripped source, or your test will match its own
documentation. Region markers often live inside comments: slice the **raw** file
to find a region, then slice the **stripped** source inside it for assertions.

What the new tests must establish:

**Bug 1 — back-to-live:**
1. `seekToLive()` targets a position behind `seekableEnd`, not exactly
   `seekableEnd`.
2. The target is clamped so it can never fall below `seekableStart`.
3. The existing guards survive: the `!cur` early return, and the
   non-finite-`end` early return.
4. The paused/playing state is untouched — no `play()`, no `src` assignment, no
   HLS re-attach inside `seekToLive()`.

**Bug 2 — mini-bar:**
5. `playTrack()` resets `playerMinimized = false`.
6. The reset in `stopAndClosePlayer()` is still present.

**Bug 3 — swipe panel (the important ones):**
7. The commit-expand branch of the gesture `finish()` handler sets
   `aria-expanded="true"` and the `open` class, matching the chevron path.
8. `renderSongView` derives the channel identity from live state
   (`state.current`) rather than only from a closure-captured `cur`, so a
   visible stale panel can correct itself on repaint.
9. `enablePlayerGestures` removes its previous `touchstart`/`touchmove`/
   `touchend`/`touchcancel` listeners before re-adding them (no accumulation
   on the singleton `$player`).

Then **prove the tests have teeth.** Mutate `app.js` at least three ways — one
per bug is best — show the suite going red each time, and restore the file
between runs. Examples: make `seekToLive()` seek to `end` exactly again; delete
the `playerMinimized` reset from `playTrack()`; delete the
`aria-expanded="true"` assignment from the commit-expand branch. Use a `/tmp`
backup and prove with `git status` that `app.js` is byte-identical to its
pre-mutation state when you finish. **Paste the actual output.**

## Verify in the built-in browser

Serve the app (`npm start`, which serves `public/` or `dist/` on :3000) and use
the built-in browser.

- **The swipe-expand panel, reproduced before your fix.** This is the key
  test. Start a channel, **swipe up** on the player to open the panel, then
  switch to a different channel **while the panel is visible**. The panel must
  never display the previous channel. Confirm via the count of
  `.player-expand` nodes, the `.player-expand-btn` `aria-expanded` attribute
  and `.open` class, and the `.expand-title` / `.expand-sub` text versus
  `.player-title`.
- **Back-to-live:** start a DVR live channel, wait for the seekable window to
  grow past `DVR_MIN_WINDOW_S`, skip back a programme, then press "Till
  Direkt". Confirm `currentTime` moves to just behind `seekableEnd` and that
  `distanceFromLiveEdge` drops within tolerance. The diagnostics hook
  (`window.srMetaDiag()`) reports `dvr` fields for this.
- **Mini-bar:** start a channel, swipe the player down to the mini-bar, then
  tap a *different* channel. Confirm it opens as the **full** player, not the
  mini-bar.

**Be honest about the limit.** Chromium is not Safari. It is entirely possible
that a seek Chromium accepts is one Safari ignores. If your browser test passes,
say clearly that it does not prove the iPhone is fixed — the owner will retest
on the phone, and that retest is the real verification. Do not describe a
desktop pass as "fixed".

## Hard boundaries

- **Do not change any behaviour beyond the two fixes above.**
- **Do not touch the expand panel** (see Out of scope).
- Never claim a deploy succeeded without checking all four of:
  1. the live `index.html` references the new hashed bundle name,
  2. the live `sw.js` has a new `CACHE_NAME` and lists the new bundle,
  3. the **new local bundle** contains the fix (grep it),
  4. the **served** bundle contains the fix (curl it and grep).
- If anything in this brief turns out to be false, stop and say so. A brief that
  disagrees with the code is worth more than a change that matches it.

## Final report format

Plain English, for a product owner who will not read raw tool output:

1. What you changed, in one paragraph per bug (Bug 1 back-to-live, Bug 2
   mini-bar, Bug 3 swipe panel).
2. The final test count, and confirmation the pre-change baseline was 126.
3. The mutation-test results — actual output, not a summary.
4. The browser verification: what you did, what the values actually were
   (`currentTime`, `seekableEnd`, `distanceFromLiveEdge`, the panel and `aria`
   values), and whether each bug reproduced before your fix.
5. The commit hash and the files it changed.
6. The deploy verification: new bundle name, old and new `CACHE_NAME`, and
   confirmation the served artifacts contain the fix.
7. What you did **not** verify — specifically, that no iPhone or real device
   was used, and that Safari's boundary-seek behaviour specifically was not
   reproduced. The owner will retest on the phone.
8. Any defect you noticed but deliberately did not fix, as a hypothesis with
   the evidence supporting it.

Do not describe these fixes as fixing the long-standing channel-mismatch
report for the compact player header. Bug 3 is a distinct, already-reproduced
defect in the expanded panel. The two are related in area but are not the same
bug, and the header's own root cause is still unknown.
