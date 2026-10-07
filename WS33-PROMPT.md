# WS33 — the two-source panel still leaks the playhead's own distance into the "offset"

**Read `AGENTS.md` first, especially §2 (tests check shape, not behaviour), §3
(one field, one writer), §5 (never hardcode a number to make a report go away),
§7a (is the new code reachable?) and §7b (classify a failing test before
touching it).**

**You are the coding agent. The tech lead has written this brief; the owner will
send it to you. You have authority over the code. Anything here that you find to
be wrong, say so and change the brief's course — but do it in your report, not
silently.**

---

## 0. Baseline first, by your own run

**Do not copy any number from this brief.** The tree may have moved. Run
`npm test` FIRST and record your own counts. That output — not anything written
here — is your reference.

Re-run immediately before you commit. A test count quoted from a log is not a
baseline, and a fix with no new tests cannot fail on the defect it fixes.

---

## 1. What you are fixing

### The defect, in one sentence

**The new timing panel measures the playhead's distance from the live edge and
reports it as a clock offset.** With a *perfectly accurate* device clock it
would read `−1800 s` while the true clock bias is `0 s`.

### The proof — three expressions, transcribed verbatim from the current `app.js`

Read them from the source yourself; do not take my transcription on trust.

1. `streamEdgeWallMs()` returns
   `Date.now() - (end - audioEl.currentTime) * 1000`
2. `updateSeekableState()` stores
   `distanceFromLiveEdge = Math.max(0, end - audioEl.currentTime)`
3. `sampleStreamEdgeClock()` computes
   `STREAM_EDGE_PROBE.offsetS = (appEdgeWallMs - trueEdgeWallMs) / 1000`

Substituting (1) into (3), the `currentTime` term does **not** cancel — it
survives as `-distanceFromLiveEdge`. So:

```
offsetS_shown  =  clockBias  -  distanceFromLiveEdge
```

**This is the same defect class WS30 was created to eliminate, in the same
field.** WS29's `edgeMinusNowS` cancelled to `distanceFromLiveEdge` and was a
tautology; the replacement removed the `Date.now()` cancellation but kept the
`currentTime` term, so it is *still* reading the playhead — it just now also adds
a clock term to it. Two sources, yes; but one of them is not a clock.

### Why it is worse than a cosmetic error

**The panel's number is wrong by exactly the quantity the owner would most want
to compare it against.** If they read it while scrubbed back 30 minutes, it
reads about `−1800 s`, and the real clock bias is buried inside a term they
cannot see.

And the correctness of the diagnosis matters more than the diagnosis itself: a
device reading taken behind live **cannot be compared to my desktop reading**,
because mine was taken at the live edge. The instrument is only valid at one
playhead position, and nothing on screen says so.

### Measured, by arithmetic — not by a device

Transcribing the three expressions above verbatim and substituting a **perfect**
clock (`trueEdge === Date.now()`, zero bias):

| playhead behind live | panel reads | true clock bias |
|---|---|---|
| 0 s | `0.0 s` | `0.0 s` |
| 10 s | `−10.0 s` | `0.0 s` |
| 600 s | `−600.0 s` | `0.0 s` |
| 1800 s | `−1800.0 s` | `0.0 s` |

**State plainly what result would have made this table come out differently** —
`AGENTS.md` §2 requires it before any number is published. Here: if the
`currentTime` term did cancel, every row would read `0.0 s`. It does not.

**What this does NOT prove:** anything about the owner's iPhone, and it does not
prove the app mis-seeks. It is arithmetic over the app's own expressions.

### The correct comparison

Both operands must be wall clocks, and neither may involve `currentTime`:

```
offsetS_true = (Date.now() - trueEdgeWallMs) / 1000
```

This is a genuine two-source reading: the device's clock against the stream's
own `#EXT-X-PROGRAM-DATE-TIME` + `sum(#EXTINF)` clock.

**That number is also the one that predicts the seek.** Transcribing
`seekToProgramTime`'s `target = end - (Date.now() - startMs) / 1000` and
comparing against the correct position, the landing error is **independent of
the playhead position** — `−offsetS_true` at every position behind live, because
`seekableEnd` appears on both sides and cancels. So one reading is valid
anywhere on the timeline, which is exactly what the current panel is not.

**Verify this independence yourself with arithmetic before you rely on it.** If
it does not hold, that is a finding worth more than this fix, and you must
report it rather than proceed.

---

## 2. Scope

**In scope — exactly one behavioural change:**

Make `offsetS` a pure clock comparison: `(Date.now() - trueEdgeWallMs) / 1000`,
sampled in the same breath as the stream's clock so both describe one instant
(keep that property — it is what makes the subtraction meaningful).

**You will also need to decide, and to state your reasoning:** whether the
playhead-distance information that is currently (incorrectly) carried in this
field should still be shown **separately and labelled correctly**. It is real
information — `distanceFromLiveEdge` is a legitimate thing to display — it just
must not be presented as a clock offset. My recommendation is yes, shown under
its own label, but this is your call to argue.

**Explicitly OUT of scope. Do not touch:**

- `seekToProgramTime`, `seekBy`, `seekToLive` — no behaviour change
- `playheadWallMs` — note it is *nearly* identical to `streamEdgeWallMs` but
  returns `Date.now()` where the other returns `null`. Read it; do not
  "deduplicate" it without a reason you can defend, and say so if you do.
- `distanceFromLiveEdge`, `atLiveEdge`, `dvrAvailable`, `updateSeekableState`
- all 7 timing constants: `LIVE_EDGE_TOLERANCE_S=10`,
  `META_DIAG_READOUT_INTERVAL_MS=2000`, `NOW_PLAYING_INTERVAL_MS=45000`,
  `NOW_PLAYING_TIMELINE_MAX=60`, `SEEK_ARTWORK_DEBOUNCE_MS=400`,
  `SEEK_LIVE_MARGIN_S=1`, `SEEK_TRACKS_DEBOUNCE_MS=250`
- `metaDiagGateOpen()` — byte-identical, gate must yield nothing on a shared link
- the `Spelas just nu` label — **owner's decision 2026-09-29, option A. Leave it.**
- R5 (pre-midnight programme title), the false `DATERANGE` comment, Android,
  E1b, global podcast search, the lock-screen-wrong-PWA item
- **`styles.css` / `index.html` / `sw.js`** — no CSS or markup change unless a
  label genuinely cannot fit. If it cannot, report it instead of redesigning.

### And the one thing you must NOT add

**No correction constant. Zero.** Not `-28`, not `+10`, not a median of
observations. The measured bias **drifts ~5.5 s over minutes** (WS30, 9
samples), so any constant is wrong within minutes. This brief ships a correct
*measurement*; the fix that consumes it is a later workstream, gated on a device
reading.

---

## 3. Reachability — answer this before you call it done (`AGENTS.md` §7a)

Name the call site and prove it runs on the path the owner uses. The panel is
opened via the Info sheet: **cog → Info → switch on**. `startReadout()` already
fires a fresh sample on open, and a 20 s refresh interval resamples. Confirm
both still hold after your change, and that **the interval exists before the
first paint** — a panel that opens stale is indistinguishable from "no offset",
which is the exact failure the reachability argument exists to prevent.

**Prove the old text is gone is NOT sufficient.** Proving the old branch was
contaminated does not prove the new one runs. Assert the new path is *reached*.

---

## 4. Tests — and they must be able to go red

`AGENTS.md` §2: **a test that proves the wrong property is worse than no test.**

For each new test, state **what the user-visible failure would be if this
regressed.** If you cannot state it, do not write the test.

**Required coverage:**

1. **`offsetS` is independent of the playhead position.** Two states, same
   stream clock, different `currentTime` → **identical** `offsetS`. This is the
   test that fails on today's code.
2. **The invariant, as arithmetic, not as a comment.** Show that the
   `currentTime` term cannot reach the reported value. Derive it; do not assert
   a string.
3. **The panel renders the corrected quantity** — drive the real rendered text,
   not source text, and assert on the DOM.
4. **Every non-numeric state still shows no number** — the WS30 states
   (`Mäter…`, `Kunde inte läsa strömmens klocka`, `Startar mätning…`) must be
   preserved, and none may render a `0` that means "unknown".
5. **A failed sample leaves no stale number visible.** WS30 established this;
   do not lose it in a rewrite.

**Then prove they can fail.** Revert your change, confirm red, restore **by
checksum**. A mutation that reports green because it never applied is worse
than no test. **Report `NO-OP` as a hard failure, never as "missed".** Run at
least: the old contaminated formula restored; the `currentTime` term removed
from the comparison; a correction constant planted; the panel falling back to
the WS29 tautology.

**Your test count must go UP.** Record before and after.

---

## 5. Drive it in the built-in browser, and assert on the DOM

`AGENTS.md` §14: state questions are testable offline. Playback is not.

- Load the app, drive the state, assert on **rendered text and attributes**.
- **Verify you are running YOUR code.** `index.html` loads the **hashed**
  bundle. Grep the **served** file for your own symbol before you believe
  anything. A previous agent's first browser run executed pre-change code and
  nearly invalidated a whole session.
- Expect **direct MP3**, not HLS: Chromium falls back, so `seekableEnd` is null
  and the real comparison cannot be exercised end-to-end there. **If you cannot
  exercise it, say so — do not present a fallback as a verification.**
- Say what you drove, what you read back, and **what the run did not cover.**

---

## 6. Report — `SESSION-STATUS.md`, append-only

Write a block using the format in `AGENTS.md` §13. **Append; never rewrite an
earlier block.** This is the contract: a report that exists only in chat cannot
be audited, and it has happened.

Baseline (yours) · scope · decision · test count before → after · **MEASURED**
(the number, how obtained, **what it does not prove**) · **NOT DONE**, named as
not done · the mutations you ran and their results · what your browser run did
not cover.

**Never write "verified" for anything you proved offline.** Use *code-proven*,
*fixture-proven*, *browser-driven*, or *device-verified by the owner*.

---

## 7. Commit discipline (`AGENTS.md` §8)

- **Source and its tests in ONE commit.**
- **Commit BEFORE building.** A build rewrites tracked root artifacts.
- Never `git checkout --` a file with uncommitted edits. Recover from a backup.
- **Do not build, do not deploy, do not push.** You commit and stop. The tech
  lead reviews and deploys. That is a reviewed step with a checklist, not a
  silent consequence of a green suite.

---

## 8. The question only the owner can answer — do NOT resolve it yourself

The owner reports the programme skip **"lands early"**. The arithmetic says the
app should land roughly 25 s **late** into the programme (skipping too little).
**These disagree.**

**A disagreement is a useful answer.** Do not pick the side that fits the
arithmetic (`AGENTS.md` §10, §11). Put this to the owner in plain language, in
your report, as a question — not a leading one:

> When you skip to a programme, does the audio start **at the beginning** or
> **partway in**? And is the **title** wrong, or only the **audio**?

Until that is answered, **the direction of the defect is not established**, and
this brief deliberately ships no fix for it.

---

## 9. Acceptance criteria

Report each **individually as PASS / FAIL**. A check not run is reported as
**NOT RUN** — never as PASS.

| # | criterion |
|---|---|
| AC1 | `npm test` run by you; green; **count went up**; before → after recorded |
| AC2 | `offsetS` no longer depends on `currentTime`; **proved by an arithmetic test** |
| AC3 | the seek-error independence claim checked, with its result reported either way |
| AC4 | every non-numeric state still shows no number |
| AC5 | a failed sample leaves no stale number visible |
| AC6 | **at least 4 mutations, all red**, restores checksum-verified; no NO-OP |
| AC7 | driven in the browser on the **served** file; DOM asserted; coverage gaps named |
| AC8 | `metaDiagGateOpen()` byte-identical; all 7 constants unchanged; **zero** correction constants in code |
| AC9 | `styles.css` / `index.html` / `sw.js` unchanged, or the change justified in your report |
| AC10 | source + tests in ONE commit; nothing built, nothing pushed |
| AC11 | `SESSION-STATUS.md` block appended in the required format |
| AC12 | **NOT DONE** list written, naming everything you did not do |

---

## 10. The one thing to get right

**A green suite here is worth almost nothing on its own.** A test that asserts
the panel's *sign* and its *wording* will pass on today's contaminated code,
because the contamination is in the arithmetic feeding it. Only an
**invariant** — position-independence, proved by derivation — can fail on this
defect.

If your tests all pass and you cannot show one that goes red, the fix is not
proven and you should say so rather than report success.