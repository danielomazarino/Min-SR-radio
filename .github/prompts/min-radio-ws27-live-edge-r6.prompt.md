# WS27 — the two halves must agree AT THE LIVE EDGE (R6)

**Priority 1 of the open queue. Start here.**

---

## 0. Before anything else

1. **Read `AGENTS.md` in full.** It is 12 sections of rules earned by failure.
   Especially §3 (one field, one writer), §7a (is the new code REACHABLE?),
   §7b (classify a failing test before touching it), and §12 (the owner's
   actual specification).
2. **Read the LAST TWO entries in `ENHANCEMENTS.md`**: the WS26 entry and the
   entry titled *"2026-09-29 (late, owner device result)"*.
3. **Run `npm test` yourself and record the real counts.** Do not copy a number
   from any entry. The expected starting state is **217/217**.

**Immediately write your first status report to `SESSION-STATUS.md`** (format is
in `AGENTS.md` §13). Report the baseline test count there. If it is not 217/217,
**stop and classify every failure before writing any code** — do not work
around them and do not "fix" them silently.

---

## 1. What the owner saw

Owner, verbatim in substance: on the iPhone 13, P3, 02:50, **at the live edge**
(pill reading `LIVE`), the two halves of the player panel named **different
songs at the same instant**:

| surface | showed |
|---|---|
| expanded card (cover + title + artist) | "More!" / Robin Bengtsson |
| row 4, the small line under the player | "Depeche Mode – Enjoy The Silence" |

This is **R6** — "the two halves of the panel must never disagree". Everything
verified before WS26 was *behind* live. This is the live-edge case, and it is
the cheapest and most important check in `AGENTS.md` §12.

**This is the owner's device report. It is a measurement. Do not explain it
away.**

---

## 2. The mechanism — LOCATED, but NOT YET CONFIRMED

In `app.js`, `resolvePlayheadMeta()` (~line 1023):

```js
song: atLiveEdge ? (nowPlaying.song || hit) : (hit || null),
```

Row 4 uses `hit` unconditionally. So whenever the poll's `nowPlaying.song` and
the timeline entry covering the same wall-clock moment differ, the two surfaces
show different songs. The comment beside that line claims *"the timeline entry
is the same song by construction"*. **That comment is falsified by the owner's
screenshot. Correct it in place.**

### Your FIRST job: establish WHICH way they diverge. Do not assume.

There are two candidate causes and **they need different fixes**. Pick the right
one by measurement, not by reading.

| hypothesis | how to confirm it | why the fix differs |
|---|---|---|
| **A — the timeline holds a DIFFERENT entry covering now.** Part 3 merges SR per-episode tracks into the same timeline (`mergeTimelineEntries`), and `pickByPosition` returns the **first** containing entry in a `startMs`-sorted array. A merged track with an earlier `startMs` that also spans the live edge would **shadow** the polled song. | Drive `resolvePlayheadMeta()` with a timeline holding a merged entry that overlaps the edge, and check which song wins. | This is a *duplicate-entry* defect. Fixing the preference alone would hide it; the overlap itself is the bug. |
| **B — the timeline has NO entry at the live edge** (no poll landed yet, or the window just opened), and something else supplied row 4's value. | Same harness, timeline empty at the edge. | Then preferring the timeline would **blank the card**, which is a worse regression. |

**Prove which one it is, with a canary counter the extracted function itself
increments.** If you cannot tell, say so in the status report and stop — do not
ship a guess. An unverified cause has cost this repo three sessions already.

### Note on why this could not be measured from the tech lead's side

**CORRECTION — an earlier draft of this brief said `api.sr.se` was in an outage.
That was WRONG and is withdrawn.** The owner reported on 2026-09-29 that the API
was up and the app showed live song data. Re-probed: `api.sr.se` returns HTTP
500 from the tech lead's machine on every path, while `web-api.sr.se` returns
200 — and enumerating the request differences (bare, iPhone User-Agent, `Origin`
set, forced IPv4) changed nothing. The owner's phone reaches the same URLs and
renders live data, so **this is not an SR outage.** It is local to one
environment and its cause is **not established**.

**Consequences, and they matter:**
- The song poll cannot be observed from here. Settle A vs B with **fixtures**.
- **Draw no conclusion in either direction from the 500.** It is not evidence
  for A and not evidence for B.
- **Do not** build a fallback or workaround for the 500.

---

## 3. The requirement

From `AGENTS.md` §12, which is not negotiable:

> Whatever the playhead is sitting on, the whole panel must describe that same
> moment. Live-programme and current-song information belong in the panel **only
> when the playhead is at the live edge**.

**R6 is the cheapest and most important.** If row 4 says one song and the header
says another, that is a defect even when each half is individually correct.

**R4 (row 4 follows the playhead) WORKS.** Do not "re-fix" it. Its behaviour
*behind live* must be preserved **byte-identically in behaviour** — assert that
with a driven test, not by inspection.

---

## 4. The shape of the fix

**One integrated change. One source of truth for the live edge too.**

The defect is that the edge is the one case where the two halves take
*different branches*. So the fix is to give them the **same expression at the
edge**, not to pick a winner and hope.

Required properties — state in your report how each is met:

1. **One decision, both surfaces.** Row 4 and the expand panel must resolve
   "which song describes the playhead" through **one shared function**, at the
   edge as well as behind it. The panel header already calls
   `resolvePlayheadMeta()`; row 4 currently inlines its own
   `pickByPosition(nowPlaying.timeline, playheadWallMs())`. Bring them together
   **without** changing what row 4 does *behind* live.
2. **The empty case is the edge case.** If the timeline is empty at the live
   edge, the card must fall back to the poll's song — **never blank**. State
   which source wins and why, in one sentence, in the code comment.
3. **No new constant, no fudge factor.** (`AGENTS.md` §5. The "10 seconds" that
   became folklore is the reason.)
4. **Do not touch:** `NOW_PLAYING_INTERVAL_MS`, `NOW_PLAYING_TIMELINE_MAX`,
   `LIVE_EDGE_TOLERANCE_S`, `SEEK_ARTWORK_DEBOUNCE_MS`, `SEEK_TRACKS_DEBOUNCE_MS`,
   the `Spelas just nu` label (**the owner decided on 2026-09-29: leave it**),
   and the byte-identical block listed in `SESSION-HANDOFF.md`.

---

## 5. Tests — this is where the workstream can still fail

`AGENTS.md` §2: *the suite asserts on source text; it cannot prove the screen
shows the right thing.* The WS26 R6 test was **driven** — real functions
extracted from `app.js` by brace matching, executed through a real sequence. **Do
the same.** Never re-type the logic into a script; that is how two workstreams
reached confident wrong answers.

Required:

1. **A driven R6 test at the live edge** that fails on today's code. Prove it
   can go red: revert your change, confirm red, restore **by checksum**.
   Report the checksum before and after.
2. **A driven test that row 4 is UNCHANGED behind live** — same input, same
   output as before your change. This is the regression guard for R4.
3. **A driven test for the empty-timeline-at-the-edge fallback.** A guard that
   cannot fail is not a test.
4. **If hypothesis A is confirmed**, a test for the overlapping-entry case too.
5. Strip comments before negative source assertions (WS26 hit this: a
   `nowPlaying.song` inside a *comment* failed a negative assertion).
6. **No mutation may report NO-OP.** A mutation that reports green because it
   never applied is worse than no test. Report `NO-OP` as a hard failure.

### Use the built-in browser where it can actually prove something

Do not default to asking the owner to test on the iPhone. The suite and a
headless browser can cover a lot:

- The panel is DOM. Load the app, drive the state, and assert on the **rendered
  text of both surfaces**, not on the source.
- Chromium **cannot** load SR's DVR-capable HLS (CORS). So the *stream* is
  untestable there — but the *panel's two halves agreeing* is a pure state
  question and **is** testable. Drive the timeline and the poll into a
  disagreement, then read both surfaces.
- `scripts/cdp-eval.mjs` exists for evaluating expressions in a running Edge /
  Chrome on port 9222. `window.__srSeekable()` is a debug handle already in
  `app.js`.
- Say plainly in the report **what the browser run proved and what it did not.**
  Never let "the browser looked right" stand in for the iPhone.

Only the things below genuinely need the phone.

---

## 6. Deploy gate — DO NOT PUSH

**The owner decided on 2026-09-29: you stop after tests. The tech lead reviews,
then the build and push happen.**

So:

- Commit **source and its tests together, in ONE commit** (`AGENTS.md` §8).
- **Do NOT run `npm run build`.** It rewrites tracked root artifacts.
- **Do NOT push.** Not to `main`, not to a branch.
- Leave the working tree clean and report the commit id.

---

## 7. Status reporting — REQUIRED, and I am monitoring it

**Write to `SESSION-STATUS.md`. Do not just tell me in chat.** The format is in
`AGENTS.md` §13. Update it:

- **at the start** (baseline test count, plan, scope),
- **after every milestone or decision** — especially the moment you confirm
  hypothesis A vs B,
- **at the end** (the full report).

I read that file to check the workstream was handled as briefed. A report that
only exists in chat is a report I cannot audit.

---

## 8. The final report

Separate these. Never blur them (`AGENTS.md` §9):

- **CODE CHANGE** — file and function. Also name the files you did **not**
  change that a reader might assume were involved.
- **MEASURED** — the number, how it was obtained, and **what it does not
  prove**. Distinguish browser / fixture / code evidence. Never write
  "verified" for anything not observed on the device.
- **NOT DONE** — recommended work you did not perform, named as not done. A
  silent omission reads as "not needed".

### What still needs the owner's iPhone after you are done

1. **The live-edge mismatch** (this bug) — does the card now agree with row 4
   at the live edge, and if it ever disagrees, is one consistently ahead?
2. **Does the cover follow the song?** Once the song agrees, the cover should.
3. **Historical titles: right, not just present.** Scrub to a song you can
   identify by ear and check the title belongs to *that* song. A neighbouring
   song's title means the time-axis anchoring is off.
4. **Wait 60 s after a scrub** — the cover must stay on the scrubbed-to song.
5. **Talk radio (P1)** — the song line may empty naturally, but the programme
   name must remain.
