---
name: Min Radio WS7 — fix the forward skip lookup, and record what a press actually does
description: Correct the inverted forward programme-skip lookup found on 2026-09-27, and instrument the press itself so the device verdict is provable. Includes the anti-vacuity rules that WS6 broke.
applyTo: "**"
---

# WS7 — the forward programme-skip button

## 0. Read this first: what WS6 got wrong, and the trap it fell into

WS6 shipped. All 162 tests passed. The button is **still dead on every press** — the
owner confirmed on the iPhone after WS6 deployed. Do not repeat this.

**WS6's headline evidence was a tautology.** It reported "1143 dead presses → 0".
It measured with this check:

```js
works = Date.now() - n.startMs >= 0
```

But WS6's own new lookup *guarantees* `startMs <= now`. So that expression is
**true for every possible result and can never be false.** The test could not fail,
so it passed, and nothing was proven. 162 green tests shipped alongside a
button that was 100% broken.

**Rule for you: never assert that a guard "does not fire" once your own change
makes that guard unreachable.** That assertion is vacuous by construction.
Assert the **user-visible outcome**: the computed target lands inside the DVR
window, and the mode pill reaches live. If you cannot write an assertion that can
fail, you have not written a test.

**Second rule, from WS5b: never use `git checkout --` to restore a file while
your edits are uncommitted.** It destroyed every WS5b change once. Use
`cp` backups and assert each mutation actually landed before trusting its result.

## 1. Context: the root cause (already proven — do not re-derive, do not doubt)

The owner's decisive evidence: **the ±15s forward button DOES reach live. The
programme-skip button does NOT.** That difference *is* the bug.

`seekBy(+15)` and `seekToLive()` are **arithmetically identical** — both compute
`end - LIVE_EDGE_TOLERANCE_S` and assign `audioEl.currentTime`. If one works, the
other works. So the seek machinery is fine and the fault is **entirely in which
target the button chooses.**

**The defect, in one line:** `fetchScheduleDay` sorts the schedule **ascending**
(`.sort((a, b) => a.startMs - b.startMs)`), and `Array.prototype.find` returns the
**first** match. So:

```js
const startedNext = schedule.find((ev) => ev.startMs <= nowMs);
```

returns the **first event of the day** — "Ekot senaste nytt @ 00:00", about 4.2
hours before now — not the next programme. Pressing it asks to seek ~4.2h behind
the live edge, which is **outside the 3-hour DVR window**, so the app calls
`showToast('Programmet ligger utanför spolbart område (3 timmar).')` (app.js:1778)
and the playhead never moves.

Measured against the real P1 schedule, 132 behind-live moments:

| lookup | dead | works |
|---|---|---|
| as shipped | **100%** | 0% |
| as corrected below | **0%** | 100% |

**Verified anchors** (line numbers as of commit `3e9761b` — re-check them, but they
are correct now):

| what | line |
|---|---|
| `DVR_MIN_WINDOW_S = 60` | 672 |
| `LIVE_EDGE_TOLERANCE_S = 10` | 733 |
| `showToast('Programmet ligger utanför spolbart område (3 timmar).')` | 1778 |
| `const prevEv = programBoundary(schedule, posMs(), -1);` | 2470 |
| `const posMs = () => {` | 2464 |
| `const startedNext = schedule.find((ev) => ev.startMs <= nowMs);` | 2503 |
| `const syncNext = () => {` | 2478 |
| `.sort((a, b) => a.startMs - b.startMs)` in `fetchScheduleDay` | 1724 |

Note the direction inversion: WS6's own comment says the lookup is "the next
boundary reachable by going BACK" — but the button goes **forward**, and `find`
returns the *earliest*, not the *nearest*.

## 2. Part A — fix the lookup

In the `syncNext` block inside the `fetchSchedule(...).then(...)` callback in
`renderPlayer()` (the forward/programme-skip button), replace the WS6 lookup.

**Required semantics:** offer the nearest programme boundary that is
**strictly after the playhead's own programme** and has **already begun**. If the
playhead is inside the current programme, that is the *next* programme's start. If
no such boundary exists, the playhead is at or past the last one, and "Till Direkt"
is the correct and only useful action.

Constraints — these are hard boundaries:

- Use the existing `posMs()` helper. It is **good**: it returns the containing
  event's own `startMs` from the schedule, which is exact and independent of
  buffered-range lag. **Keep it. Do not "simplify" it back to clock arithmetic.**
- Do **not** modify `seekBy()`, `seekToLive()`, `seekToProgramTime()`,
  `posMs()`, `programBoundary()`, `DVR_MIN_WINDOW_S`, or `LIVE_EDGE_TOLERANCE_S`.
- Do **not** widen or tune any threshold. The `+1000` margin in
  `programBoundary()` stays exactly as it is. Tuning a threshold to hide this
  symptom is what failed three separate times.
- The backward button (`prevEv`) uses `programBoundary(schedule, posMs(), -1)`,
  which is **correct** for going backwards. Leave it alone.
- Keep the WS6 diagnostics wiring intact: the named handlers `goNext` / `goLive`,
  their `_srMode` tags, `nextProgramBtn.onclick = null` when hiding, and the
  `mode` derivation in `metaDiagNextProgram()` must all still work. A test
  enforces part of this — read it before editing.

**Prove your fix against real data, offline, before you touch the tests.** Write
a throwaway script that fetches the real P1 schedule
(`https://api.sr.se/api/v2/scheduledepisodes?channelid=132&date=<sv-SE date>&format=json&pagination=false`,
remembering SR dates parse via the `/\/Date\((\d+)\)\//` pattern already in
`parseSrDate`), replicates old and new logic, and sweeps the day. Report the
before/after dead-press percentages as actual script output. **If your new lookup
does not reach 0% dead, you have not understood the problem — stop and re-read
§1 rather than proceeding.**

## 3. Part B — instrument the press

WS6 reported the button's *state*. It never recorded what a *tap did*. That gap
is why we cannot currently tell a silent dead press from a toast that flashed too
fast to notice — and the owner reported "nothing happens" on a path that *should*
have shown a toast.

Add press-time recording to the existing `META_DIAG` store (never to
`state.current` — there is a test enforcing that the hook is read-only):

- last press **branch**, as a discrete string: `seeked`, `out-of-window`,
  `no-track`, `no-dvr`, `non-finite-target`, or `rejected-by-browser`
- the **computed `target`**, plus `seekableStart` / `seekableEnd` / `seekableDuration`
  at the moment of the press
- the **read-back** `audioEl.currentTime` immediately after the assign
- a monotonic `calls` counter

`seekToLive()` already has a read-back pattern (`d.lastAfter` with an `accepted`
flag) — **reuse that shape**, and make the `goLive` / `goNext` handlers record the
same way. `rejected-by-browser` is the important one: it is the case where the
target was sane but the browser did not honour it, which would prove a *new*
failure mode on iOS rather than a lookup bug.

Surface the new fields in `srMetaDiag()` under the existing `dom.nextProgram`
block, and on the one-line console report.

## 4. Tests — non-vacuity is the whole point

The existing suite is source-text-asserting. Your new tests must at minimum
satisfy all of these, and each assertion must be one that **can fail**:

1. The new lookup is present, and the old `find` is gone.
2. A **mutation** that reverts the lookup to the WS6 form turns the suite **red**.
   Run it and paste the real output. If it stays green, your test is vacuous —
   this is the exact failure mode of WS6 and you must fix the test before moving on.
3. A mutation that removes the `dvrAvailable` guard, and one that changes
   `seekToLive`'s target arithmetic, both turn the suite red.
4. `seekBy`, `seekToLive`, `posMs`, `programBoundary` and the DVR constants are
   **byte-identical** to their current form. Assert their exact current text, not
   a loose regex — a `||` fallback in an assertion is what let WS6's M8 mutation
   slip through green.
5. The read-only `state.current` contract still holds.

**For every mutation: back the file up with `cp` first, verify the mutation
actually changed the file (`cmp -s` against the backup) before trusting the
result, and `md5sum` the files after restore.**

## 5. Boundaries — do not touch

- `seekBy()` and the ±15s buttons (the owner explicitly excluded them)
- `seekToLive()`'s target arithmetic
- The WS3 `SEEK_LIVE_DIAG` block's existing fields
- The WS5b player layout and its CSS
- `styles.css`, `manifest.webmanifest`, MediaSession, the WS0 diag gate
- No CI, no new dependencies, no build-system changes

## 6. Report format

Give me a status update roughly every 5 minutes — and **no more often** than that.
A 15-second update loop wastes more time than it saves.

The final report must contain, as actual pasted output rather than prose:

1. The offline before/after dead-press sweep against the real schedule.
2. The mutation table: mutation name → pass/fail counts, and confirmation each one applied.
3. `md5sum` confirmation that both files were restored byte-identical.
4. Test count before and after.
5. The commit hash.

State plainly which claims are **verified** and which are **not yet tested**.
Do not describe anything as working on a device — **no iPhone or real device is
available to you, and Chromium cannot load SR's DVR stream** (the manifest is
CORS-blocked, so playback falls back to a direct MP3 where the skip button does
not render at all). You can prove the lookup is correct and the press is
instrumented. You cannot prove the audio moves. Say so.

## 7. Deploy

Commit without pushing. Report the hash. I will verify the deploy myself.
