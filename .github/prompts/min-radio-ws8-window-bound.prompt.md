---
name: Min Radio WS8 — never offer a target the buffer cannot serve
description: The forward-skip button picks a programme boundary without checking the DVR window, so it offers targets that are out of range and the press is refused. Constrain candidates to the window and fall back to Till Direkt. Also fixes the lying "3 timmar" message.
applyTo: "**"
---

> ## ⚠️ STATUS 2026-09-27 — DO NOT IMPLEMENT THIS FILE
>
> **WS8 is SUPERSEDED. If a coding agent is reading this: stop, do not write any
> code, and report back that WS8 is superseded instead.**
>
> **Why:** a previous agent ran WS8's analysis and stopped before implementing,
> which was correct. It then produced a conclusion that **I checked and found
> wrong** — see the corrections below. Meanwhile the owner changed direction.
>
> **Corrections to this file's reasoning (all verified, not assumed):**
>
> 1. **The "−19 min toast is a stale-wiring problem" premise is UNPROVEN, and
>    the evidence is now contradictory in both directions.** The agent that
>    analysed this claimed staleness could never cause a refusal (it tested only
>    *backward* seeks). I tested both directions over 1,131,520 combinations and
>    found ~24,947 cases where a stale target **is** refused while a recomputed
>    one would serve. So: a stale target can be refused, but whether that is
>    what happened on the owner's phone is still unknown.
> 2. **The "your window is probably much shorter than 3 h" claim is UNSUPPORTED.**
>    It came from a simulation whose window length was an assumption. **The owner
>    states the window is exactly 3 hours per the provider spec, and I have no
>    counter-evidence.** Do not build anything on the assumption that it is short.
> 3. **Part D's justification is now known to be partly wrong**, though the
>    underlying staleness (the button is not re-wired after a seek) is real and
>    still worth fixing on its own merits.
>
> **What happens instead:** **WS9** (`min-radio-ws9-position-aware-metadata.prompt.md`)
> is the active workstream. Its purpose is to make the programme title follow the
> playhead and to **show the real DVR window on screen** — which is the missing
> measurement. Once that is deployed, the owner can send a screenshot that
> establishes the window length and the playhead position **as measured on the
> device**, instead of modelled on a desktop.
>
> **The parts of this file that remain sound and may be reused in a later
> workstream:** Part A (constrain the candidate to the window) is a correct,
> provable safety property; Part B (the hardcoded "3 timmar" string) is a real
> defect; Part D (re-wire the button after a seek) is a real defect. None of them
> should be implemented until WS9 has produced device evidence.

---

# WS8 — the forward skip must never offer an unservable target

## 0. What we now know from the device (do not re-derive, do not doubt)

The owner tested WS7 on the iPhone on 2026-09-27 and reported:

- **Backwards skip works correctly** — including toasting when the target is
  genuinely beyond the 3-hour window. Do not touch it.
- **Forwards skip shows the toast**, and WS7 made it **worse than WS6**, not
  better. The owner's words: "after WS7 we get the toast when skipping forward
  even if we are just at −19 minutes… if I have backed several programmes the
  white banner now comes up immediately when I try to click in the other
  direction. So that makes the function of the forward skip now having more bugs
  in it than after WS6."
- The clock label is **CORRECT** (the owner confirmed: 08:16 is exactly live 11:16
  minus the 3-hour window; the slider reaches that far). At the live edge the pill
  reads LIVE. **There is no wall-clock/media skew. An earlier version of this
  brief was wrong about that and has been corrected — do not reintroduce it.**

**What this settles.** The press reaches `seekToProgramTime()` and is refused at
the `target < start` guard. So the button is offering a target the buffer cannot
serve.

**What we verified by reproduction, and what remains unexplained.** Against the
real P1 schedule at −19 min, the WS7 lookup returns **null → "Till Direkt" →
`seekToLive()`**, a path that can never toast. So a toast at −19 min means the
button's wiring was **stale** — it was still holding a target computed for an
earlier playhead position. See Part D. That is the mechanism to fix, and it is
**not** a clock problem.

## 1. Root cause

Nothing between the lookup and the press ever checks the candidate against the
DVR window.

The lookup at `app.js:2584` picks the nearest started boundary after the
playhead:

```js
const startedNext = schedule.find((ev) => ev.startMs > playheadMs
  && ev.startMs <= nowMs);
```

That is the right *schedule* boundary. But it is chosen purely on time. If that
boundary is older than `seekableEnd - seekableStart`, the resulting target is
outside the buffer and the press is refused:

```js
// app.js:1812-1826
const target = end - behindMs / 1000;
if (target < start) {
  showToast('Programmet liger utanför spolbart område (3 timmar).');
  return;
}
```

Note the first screenshot: the user was **3 h 01 min** behind live. Any started
boundary ahead of that playhead can be up to 3 h 01 min old — at or past the
window's own reach. The button is *asked* for something the buffer cannot serve.

**Why the ±15s buttons are immune.** They are pure media-time arithmetic
(`currentTime ± 15`) with no wall clock anywhere. They cannot be handed a
target the buffer lacks. That is exactly why the owner reaches live with +15 s
and never with the skip button. Do not "fix" this by making the skip button
call `seekBy()` — that would delete the programme-skip feature.

## 2. Part A — constrain the candidate to the DVR window

In `syncNext` (`app.js:2577`+), after computing `playheadMs` and `nowMs`:

1. Keep the WS7 lookup semantics exactly as they are. It is correct.
2. **Additionally require the candidate to be inside the buffered range.** A
   boundary `T` is servable iff the target it would produce satisfies
   `target >= seekableStart`, where
   `target = seekableEnd - (Date.now() - T) / 1000`.
   Express this as a bound on `T` and apply it **in the same `find` predicate**,
   so the nearest servable boundary is chosen — not "the nearest, then reject it".
3. If no servable boundary exists, the button must be **"Till Direkt"**
   (`seekToLive()`), which is always valid. That is already the existing
   `else if (behindLive)` branch — make the unreachable case fall into it.

Write the predicate so the intent is legible and the bound is derived from
`cur.seekableStart` / `cur.seekableEnd` — **not** from a hardcoded number.

## 3. Part B — stop the message from lying

`'Programmet ligger utanför spolbart område (3 timmar).'` is a **hardcoded
string** (`app.js:1821`). The `3` is not derived from the actual window. The
owner's own window may be far shorter, and the message is currently
misinformation.

Compute the real length from `cur.seekableEnd - cur.seekableStart` and render it
in the message (round sensibly — minutes under an hour, hours and minutes
above). Keep the Swedish wording natural. If the window is unknown, omit the
parenthetical rather than assert a number.

**Do not change the guard's behaviour** — if the target is out of range, refusing
is correct. Only the message text changes here.

## 4. Part D — the wiring goes stale after every seek (the −19 min regression)

This is the specific regression the owner reported, and it is a **separate
defect** from Parts A and C.

`syncNext` is bound to `timeupdate` (`app.js:2639`) and is called directly exactly
once (`app.js:2634`, guarded by `if (prevEv)`). **No seek path re-runs it.**
`seekToProgramTime()` and `seekBy()` call `updateSeekableState()` and
`renderPlayer()` — never `syncNext()`. `seekToLive()` does not even do those.

So after any seek, the button keeps the `onclick`, title and mode it was given
for the *previous* playhead position, until the next `timeupdate` arrives. On a
fast seek that is ~250 ms. On a slow HLS seek on a phone it can be far longer —
which matches the owner pressing the button "immediately" after a skip and
getting a refusal computed for a position they had already left.

Required:

- After a successful programme skip, the forward button's wiring must be
  recomputed **synchronously**, not left to the next `timeupdate`.
- The same for `seekBy()` and the slider commit path, and for `seekToLive()`.
- Guard against the obvious hazard: `syncNext` re-registers a `timeupdate`
  listener. Calling it after a seek must **not** add a second listener, or the
  WS1 leak returns. The existing `_srNextUpd` remove/add pair is the mechanism to
  respect — reuse it, or split the computation from the registration cleanly.
- Also consider: `renderPlayer()` rebuilds the player subtree. Check whether the
  button node survives that, and whether the fresh `syncNext` closure still
  refers to a button that is actually in the document. **This has bitten the
  project before** — see the `document.contains(prevProgramBtn)` guard
  (`app.js:2481`) in the `fetchSchedule` callback.

**This is the highest-value part of WS8.** Parts A and C stop the button offering
an unservable target; Part D stops it offering a *stale* one. Both are needed.

## 5. Part C — the fallback must be reachable, and observable

After Part A, the "Till Direkt" path becomes the common case. Confirm and test:

- The button shows **"Till Direkt"** whenever no servable programme boundary
  exists, and pressing it reaches live.
- When a servable boundary exists, the button shows the programme title and
  seeks to it.
- `recordSkipPress` (`app.js:1791`) already records `lastBranch` including
  `out-of-window`. With Part A in place, **`out-of-window` should become rare or
  impossible from this button.** Keep the branch recorded — it is still the
  correct reaction if a target ever is refused, and it is how the next device
  test will be judged.
- Keep the `_srMode` tags, `nextProgramBtn.onclick = null` when hidden, and the
  `mode` derivation in `metaDiagNextProgram()` intact. Tests depend on them.

**Verified anchors** (line numbers as of `8c7f7aa` — re-check, but correct now):

| what | line |
|---|---|
| `const DVR_MIN_WINDOW_S = 60;` | 672 |
| `const SKIP_PRESS_DIAG = {` | 1779 |
| `function recordSkipPress(programmeStartMs) {` | 1791 |
| `const target = end - behindMs / 1000;` | 1818 |
| `if (target < start) {` | 1820 |
| `showToast('Programmet ligger utanför spolbart område (3 timmar).');` | 1842 |
| `function seekToProgramTime(startMs) {` | 1832 |
| `const liveEdgeWallMs = () => {` | 2508 |
| `document.contains(prevProgramBtn)` (the stale-node guard) | 2481 |
| `const startedNext = schedule.find(…` | 2584 |
| `const goNext = () => {` | 2597 |
| `const goLive = () => {` | 2612 |
| `if (prevEv) syncNext();` | 2634 |
| `audioEl.addEventListener('timeupdate', syncNext);` | 2639 |
| `audioEl._srNextUpd = syncNext;` | 2640 |

Note: `seekToProgramTime` **starts** at 1832 and the `showToast` inside it is at
1842 — the toast line comes after the function header, not before.

## 6. Boundaries — do not touch

- `seekBy()` and the ±15s buttons (owner-excluded)
- `seekToLive()`'s target arithmetic and the WS3 `SEEK_LIVE_DIAG` block
- `posMs()`, `liveEdgeWallMs()`, `scheduleNowMs()`, `programBoundary()` and its
  `+1000` margin
- `DVR_MIN_WINDOW_S`, `LIVE_EDGE_TOLERANCE_S`
- The backwards button's `programBoundary(schedule, posMs(), -1)` lookup
- `styles.css`, `manifest.webmanifest`, MediaSession, the WS0 diag gate, WS5b layout

## 7. Anti-vacuity rules (two have already bitten this project)

1. **Never assert that a guard "does not fire" once your own change makes that
   guard unreachable.** WS6 shipped 162 green tests over a button that was 100%
   dead because its headline check was true by construction. Assert the
   **outcome**: for a given DVR window and playhead, the button either offers a
   target ≥ `seekableStart` or offers "Till Direkt".
2. **A metric that two different implementations both pass is not a test.** The
   WS6 and WS7 lookups both satisfied "0% dead presses" while behaving very
   differently. If your before/after numbers do not separate the good
   implementation from a deliberately broken one, the measurement is worthless.

## 8. Tests and evidence

**Prove it offline first, against the real schedule**, before editing tests.
Sweep behind-live distances from 0 to the full window, and for each:

- what the current code offers, and whether the press is refused;
- what Part A offers, and whether the press is servable.

Report as actual script output. **Required: a case where the current code is
refused and Part A is not.** If Part A never rescues a refused press, you have
misread the problem — stop and re-read §1.

**Also required for Part D:** a *sequence* simulation, not a sweep. Reproduce
what the owner did: press the backwards button (or the slider), then immediately
press the forwards button, and show what the forwards button is wired to at that
instant under the current code versus under Part D. The current code should be
shown offering a target computed for the *previous* position.

Also include, explicitly:

- a case where the **DVR window is short** (e.g. 30 min, not 3 h) and show the
  button correctly falls back to "Till Direkt" instead of toasting.
- ~~a skewed playhead estimate~~ — **withdrawn**, the owner confirmed the clock is
  correct. Do not build a fix on skew, and do not present a skew case as evidence.

Then, in the test suite:

- Reverting the window constraint must turn the suite **red**. Run it, paste the
  output. If it stays green the test is vacuous — fix the test.
- **Part D must be tested by an assertion that can fail.** Specifically: assert
  that a seek path triggers recomputation of the button wiring, and that it does
  **not** add a second `timeupdate` listener. A mutation that removes the
  recomputation must go red; a mutation that duplicates the listener
  registration must also go red. The listener-count property is the one that
  actually protects against re-introducing the WS1 leak, so assert it explicitly
  (the WS0 `META_DIAG` counters already make listener counts observable — use them
  rather than asserting on prose).
- Mutating the "Till Direkt" fallback, `seekToLive`'s target arithmetic, and the
  message text must each turn the suite red.
- Assert `seekBy`, `seekToLive`, `posMs`, `liveEdgeWallMs`, `programBoundary` and
  both DVR constants are **byte-identical**. No `||` fallbacks in assertions —
  an `||` between two assertions is what let a mutation slip through green twice.
- The read-only `state.current` contract still holds.

**For every mutation: `cp` the files first, verify with `cmp -s` that the
mutation actually applied before trusting the result, and `md5sum` both files
after restore.** Never use `git checkout --` to restore while your edits are
uncommitted — it destroyed an entire workstream once.

## 9. Report format

A status update roughly every 5 minutes, **and no more often**. A 15-second
loop wastes more time than it saves.

The final report must paste, as real output:

1. The offline sweep: current vs Part A, with at least one rescued case.
2. **The Part D sequence simulation (backwards-then-immediately-forwards).**
3. The short-window case.
4. The mutation table (name → pass/fail counts, each confirmed applied).
5. `md5sum` confirmation both files were restored byte-identical.
6. Test count before and after, and the commit hash.

State plainly what is **verified** and what is **not tested**. **No iPhone or
real device is available to you, and Chromium cannot load SR's DVR stream**
(manifest is CORS-blocked; playback falls back to a direct MP3 where the skip
button does not render). You can prove the button never offers an unservable
target. **You cannot prove the audio moves.** Say so explicitly.

## 10. Deploy

Commit **without** pushing. Report the hash. I will verify the deploy myself.
