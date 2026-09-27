---
name: Min Radio WS9 — the programme and song must follow the PLAYHEAD, not "on air now"
description: After any seek the player keeps showing the currently-broadcast programme and song, because both are resolved from "now" and never re-resolved. Fixes it by making both position-aware, and adds the DVR window readout the owner needs to diagnose the skip bug.
applyTo: "**"
---

# WS9 — position-aware programme and song metadata

## 0. Why this workstream exists (read before touching anything)

The forward programme-skip button has now failed on the owner's iPhone **five
times** across WS2, WS4, WS6 and WS7. Every one of those fixes was validated
**offline**, and every offline model had to *assume* the DVR window length.
That assumption is unverifiable from the repo — the message
`'Programmet liger utanför spolbart område (3 timmar).'` is a **hardcoded
string**, so nothing in the app records the real window.

**So this workstream is a DIAGNOSTIC first and a bug fix second.** The owner
asked for it precisely because a correct programme title makes the skip bug
visible in a screenshot. Do not treat the skip bug as solved here, and do not
change any seek behaviour.

> ### If you were asked about WS8 — here is the answer, do not go and read it
>
> A previous agent analysed **WS8** (`min-radio-ws8-window-bound.prompt.md`) and
> stopped before implementing, then reported a conclusion. **The owner has
> since directed this WS9 instead, and that WS8 conclusion has been checked and
> found partly wrong.** Specifically:
>
> - That agent concluded a stale button can **never** be refused, so stale wiring
>   cannot cause the toast. **Wrong.** It tested only *backward* seeks. Testing
>   both directions over 1,131,520 combinations found ~24,947 cases where a
>   stale target **is** refused while a recomputed one would serve. Staleness
>   *can* cause the toast; whether it did on the phone is still unknown.
> - It also concluded the owner's DVR window is probably much shorter than 3 h.
>   **Unsupported** — that came from a simulation whose window length was
>   assumed. The owner states it is 3 h per the provider spec.
>
> **Therefore: ignore WS8 entirely, do not open that file, do not reuse its
> reasoning, and do not "helpfully" implement any part of it.** Part C of this
> workstream is what will actually settle the window length — on the device, not
> on a desktop. If you believe something in *this* file is wrong, say so and
> stop rather than implementing your own reading.

## 1. Root cause 1 — the programme title is "on air", not "at the playhead"

`resolveProgramTitle()` (app.js:1060-1072):

```js
const now = Date.now();
const ev = schedule.find((e) => now >= e.startMs && now < e.endMs);
if (ev?.title) { cur._srProgramTitle = ev.title; paintProgramTitle(); }
```

Two defects, both confirmed by reading the code:

1. It resolves **what is broadcasting right now** — not the programme containing
   the playhead. For a DVR listener these differ.
2. It is called **exactly once per track load** (app.js:1154) and **never after a
   seek**. So the title is stale from the first skip onwards.

Required: the title must be derived from the **playhead's position**, and must
re-resolve on every seek. There is already a helper for the position —
`liveEdgeWallMs()` (app.js:2508) — and an existing, correct, position-aware
pattern for episode tracks (a `timeupdate` updater that selects the track whose
`[start, end)` contains the current time). **Follow the existing pattern rather
than inventing one.**

**Performance constraint:** do **not** re-fetch the schedule on every seek.
`fetchSchedule` is cached for 10 minutes, so a re-resolve from cache is cheap,
but a `timeupdate`-driven re-resolve every ~250 ms must not thrash. Resolve on
seek completion, and cheaply guard the common case.

## 2. Root cause 2 — the song data needed is being thrown away

`fetchNowPlaying()` parses **only** `playlist.song` and discards
`previoussong` and `nextsong`. Those identifiers appear in `app.js` **four
times (373, 828, 918, 4113) and every occurrence is inside a comment** — two
whole-line comments, one trailing comment on `lastRightNowRaw: null,`, and one
inside the string literal of a diagnostics `note` field. **No code anywhere
reads either field.** A test can assert that directly: there is no executable
reference to `previoussong` or `nextsong`.

**Verified against the live API** — the discarded fields carry timestamps:

```
ch163   song          Fred Åkerström  Natt I En Stad        11:51:30-11:54:19
        previoussong  Sabine Meyer    Gi Konsert...        11:46:40-11:51:20
        nextsong      Mercedes Sosa   G Gracias A La Vida  11:54:30-11:58:54
```

Every one of those carries `starttimeutc` and `stoptimeutc`, so **a song can be
matched to any DVR position**. The data required to fix this is already
delivered and discarded. `META_DIAG.lastRightNowRaw` (app.js:921) even
documents that it retains the raw body precisely because previous/next would
otherwise be "unobservable" — so the capability was known and left unwired.

Required: hold previous/next alongside the current song and select by the
playhead's position, using the same `[start, end)` containment rule as the
programme title.

**Design decision you must make deliberately, and justify in the report:**
`NOW_PLAYING_INTERVAL_MS = 45000` (app.js:124), so a poll cannot drive a
seek-responsive title. A seek must re-render from **already-held** data. With
only song + previous + next held, the reachable range is roughly one song either
side — so a user who skips further than that sees nothing. Decide between:

- widening the held set (e.g. retain the last N polls' entries, deduped by
  start time), and
- triggering a re-poll on seek and accepting a short delay.

State which you chose, what the reachable range then is, and what it costs. Do
not silently pick one. **Note that channels with `song: null` (talk radio) have
no song line at all — the programme title is the only metadata there, which
raises the cost of getting the title wrong.**

## 3. Part C — surface the DVR window (the actual point of this workstream)

The owner needs to see, on screen, in one screenshot:

- the programme **containing the playhead**,
- the **start and end of the seekable window** as clock times, and
- the window's **real length** (not a hardcoded "3 timmar").

The seek row already shows the left-hand clock label; the window's left edge is
the oldest time the slider can reach. Derive the readout from
`cur.seekableStart` / `cur.seekableEnd` — **never from a literal.** When the
window is unknown, show nothing rather than a guess.

Keep it small and in the existing player. This is instrumentation, not a
redesign: the WS5b layout (`title` / quality pill / song line aligned at
left=72) must not move, and the 165 existing tests must stay green.

## 4. Part D — also fix the channel-switch case

`ENHANCEMENTS.md:239` and `:251` (owner-verified 2026-09-24) report **two** cases:

- **Channel switch** (P1 → P2): the expanded player keeps showing the old
  channel's programme (`Europapodden / P1` while controls say `P2 / Nottur`).
- **Programme skip**: the old song and programme title linger.

Cover both. The `state.current !== cur` superseded guard in
`resolveProgramTitle` is the existing defence against late responses — respect
it and confirm it still works, because a channel switch is exactly the race it
was written for.

## 5. Boundaries — do not touch

- **Any seek behaviour.** No changes to `seekBy`, `seekToLive`,
  `seekToProgramTime`, `posMs`, `liveEdgeWallMs`, `programBoundary`, the
  programme-skip lookup, or the DVR constants. The forward-skip bug is a
  separate workstream and is **not** fixed here.
- `styles.css` beyond what Part C strictly needs; the WS5b layout
- `manifest.webmanifest`, MediaSession, the WS0 diag gate
- No new dependencies, no build-system changes, no CI

## 6. Anti-vacuity rules (three have bitten this project)

1. **Never assert a guard "does not fire" once your own change makes it
   unreachable.** WS6 shipped 162 green tests over a 100%-dead button for
   exactly this reason.
2. **A negative result scoped to one direction is not a negative result.** The
   WS8 agent tested only backward seeks, concluded "staleness can never cause a
   refusal", and was wrong — 24,947 counterexamples exist in the forward
   direction. Sweep both directions before claiming monotonicity.
3. **"0 rescued" is only meaningful if the sample can produce a rescue.** The
   same agent's first sweep found 0 rescues because it tested one dense channel;
   across the channel set it does rescue cases. If a metric is 0, prove the
   sample could have been non-zero.

## 7. Tests and evidence

The existing suite asserts on **source text**, using `region(start, end, src)`
plus a string-aware `stripComments()`. Two traps from this project: a pattern
sliced from the wrong region silently checks nothing, and a comment that merely
mentions an identifier can trip a write-detector — `HOOK` is the raw slice with
comments intact.

Required:

- Assert the programme lookup is keyed on the **playhead**, not `Date.now()`,
  and that re-resolution happens on seek.
- Assert previous/next song data is **retained and used**, not just captured.
- **Mutations, each of which must turn the suite red**, with the count pasted:
  revert the playhead-keyed lookup; remove the seek-time re-resolve; drop the
  previous-song match; hardcode the window length instead of deriving it;
  duplicate the `timeupdate` listener; break the superseded guard.
- Assert the WS5b layout pieces and all out-of-scope seek functions are
  **byte-identical**. No `||` fallbacks between assertions — an `||` between two
  assertions has twice let a mutation slip through green.
- The read-only `state.current` contract still holds.

**For every mutation: `cp` the files first, verify with `cmp -s` that it
actually applied before trusting the result, and `md5sum` both files after
restore.** Never use `git checkout --` to restore while edits are uncommitted —
it destroyed an entire workstream once.

Browser-verifiable: the title must change when the playhead crosses a programme
boundary, on P1 and on a music channel. Note that Chromium cannot load SR's DVR
stream (manifest is CORS-blocked), so the DVR path is unreachable there — say so
rather than claiming it is verified.

## 8. Report format

A status update roughly every 5 minutes, **and no more often**.

The final report must paste, as real output: the mutation table; `md5sum`
confirmation of restore; test count before and after; the commit hash; and your
decision on the held-song-set question from §2 with its reachable range.

State plainly what is **verified** and what is **not tested**. No iPhone or real
device is available to you, and you cannot prove the audio moves. Do not describe
the forward-skip button as fixed.

## 9. Deploy

Commit **without** pushing. Report the hash. I will verify the deploy myself.
