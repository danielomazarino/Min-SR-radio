# WS38 — instrument the seek. Four measurements, no interpretation, no correction.

**Read `AGENTS.md` first**, especially §2 (tests check shape, not behaviour), §5
(never hardcode a number to make a report go away), §7 (a harness must prove it
is executing the code under test), §7a (is the new code reachable?) and §8.

**This brief does NOT authorise a push.** The owner has been explicit: *"No
correction, no compensation constant, no architectural change, no push until we
have the measurements."* **Commit and stop.** If you push, you have disobeyed a
direct instruction.

**It also does not authorise interpretation.** You are building instruments, not
conclusions. Where this brief says "do not interpret", that means it.

---

## 0. Why this brief exists, and what it must not become

WS30–37 established a genuine contradiction and then removed every wrong
explanation along the way. Current state, all of it already recorded:

- Your phone's clock reads **~29–34 s BEHIND** the stream's own clock
  (`offsetS`, measured on device, build `5da241e`).
- A clock that is **behind** makes the programme skip land **~30 s INTO** the
  programme — it misses the start.
- The owner observes it landing **~25 s BEFORE** the programme starts.
- The gap is **~55 s**, and **no schedule-timestamp error can bridge it**:
  shifting `startMs` moves the landing one-for-one, so it can absorb at most the
  ~30 s the clock already contributes.

**Two explanations have already been raised and withdrawn.** A tautological
readout (WS29/WS30). "The SR schedule is ~25 s early" (withdrawn: circular, and
arithmetically impossible). **Do not resurrect either.**

### The constraint that shapes this whole brief

**An earlier proposal — `seekableEndDeltaMs`, a difference between the cached
`seekableEnd` and the stream clock — was shown to be mathematically impossible,
and it is the reason this brief looks the way it does.**

The only mapping in the codebase from media seconds to wall-clock ms is the app's
own:

```js
wall(m) = Date.now() - (seekableEnd - m) * 1000
```

Evaluated at `m = seekableEnd` it collapses to `Date.now()`, **always, for any
value of `seekableEnd`.** So any "difference between `seekableEnd` and the true
edge" is just `Date.now() − trueEdgeWallMs` restated — it **cannot see
`seekableEnd` at all**. Verified by sweeping `seekableEnd` over 1700/1000/400/42.5
with the true edge fixed: identical result in every row.

**Therefore, absolutely:**

- **Do NOT compute an absolute difference between `seekableEnd` and the stream
  clock.** It is a restatement of the clock bias wearing a new label.
- **Do NOT convert a media position to wall-clock using the existing seek
  formula** (`playheadWallMs` / `streamEdgeWallMs`) and present the result as an
  independent measurement.
- **The ONLY cross-frame comparison permitted in this workstream is a RATE of
  advancement between two samples taken at two different times.** A rate needs
  no absolute alignment between frames, so it cannot smuggle in the assumption.

**If you find yourself wanting an absolute offset, that is the signal you are
about to build a tautology. Stop and report instead.**

---

## 1. Baseline first, by your own run

Run `npm test` and record your own counts. Do not copy any number from here.
Re-run immediately before you commit.

Expect the current HEAD to be `57614f4` with only doc files modified. **If
`app.js` or anything under `tests/` is already modified, stop and report** —
something moved under you.

---

## 2. What already exists — read it before adding anything

**Most of what is needed is already recorded. Do not add a parallel mechanism.**

| what exists | where | note |
|---|---|---|
| `STREAM_EDGE_PROBE` + `sampleStreamEdgeClock()` | `app.js` | WS30/33. Holds `deviceNowMs`, `trueEdgeWallMs`, `offsetS`, `status`, `sampledAtMs` |
| `SEEK_EDGE_DIAG` | `app.js` | WS23. Holds `before`, `after`, `requestedTarget`, `acceptedPosition`, `clampedByS` |
| `recordStreamEdge(phase)` | `app.js` | WS23. Samples edge + `Date.now()` together |
| the panel readout | `metaDiagReadoutLines()` | WS29–33. Already renders the clamp line |

**One field genuinely does not exist and must be added: the timestamp when
`updateSeekableState()` last wrote `seekableEnd`.** That is the basis of
measurement 1. Add it next to the write (where `cur.seekableEnd = usable ? end :
null` is assigned) — **one timestamp, written in the same place as the value it
describes, never in a second location.** `AGENTS.md` §3: one field, one writer.

---

## 3. The four measurements

### 1. `seekableEnd` sample age — how stale is the value the seek actually uses?

At the exact moment `seekToProgramTime` reads `cur.seekableEnd`:

- `Date.now()` at that instant
- the timestamp when the cached `seekableEnd` was last written (new field)
- **age** = the difference, in ms
- the cached `seekableEnd` value the algorithm would use
- a **freshly read** `audioEl.seekable.end(audioEl.seekable.length - 1)`

**Read the fresh value but do not use it.** The seek must continue to use the
cached value — see §5.

**Why this can be done: every one of those is a plain value read.** No frame
conversion. This measurement cannot be circular.

### 2. Advancement rate — does the buffered end track the stream's clock?

**Two samples, ~10 s apart.** At each:

- `Date.now()`
- `seekable.end(...)` read fresh
- the stream-clock value (`STREAM_EDGE_PROBE.trueEdgeWallMs`)

Then report three elapsed figures and **the rates**:

- wall elapsed (`now₂ − now₁`)
- stream elapsed (`trueEdge₂ − trueEdge₁`)
- buffered-end elapsed (`end₂ − end₁`)
- `streamRateVsWall` = stream elapsed ÷ wall elapsed
- `seekableRateVsStream` = buffered-end elapsed ÷ stream elapsed

**The rate is the measurement. The absolute positions are not, and comparing them
is forbidden** (§0).

**Design notes you must honour:**

- Take the second sample from a **timer**, not from a UI interaction — the owner
  must not have to keep the panel open and touch anything.
- **Re-fetch the playlist** for the second stream-clock sample if the existing
  sample is older than the interval. `sampleStreamEdgeClock()` already does the
  fetch; **reuse it, do not write a second fetch path.**
- **State what would make this table falsifiable in advance**, per `AGENTS.md` §2:
  if both rates are 1.000 the buffered end tracks the stream exactly; if
  `seekableRateVsStream` is consistently below 1.000 the buffered end is falling
  behind at a measurable rate. **Record which of those you observe.**
- **A sweep that returns an identical value at every position is a broken sweep.**
  If your rates are all exactly 1.000 across several samples, verify the values
  actually changed before reporting them.

### 3. Fresh vs cached — quantify the staleness directly

At the seek moment, record **both** the value the existing algorithm uses and a
freshly queried `audioEl.seekable.end(...)`, plus their difference in ms.

**Do not interpret the difference.** Not "small enough to ignore", not "this
explains it". **Record the number.** Interpretation is the owner's, and it comes
after the measurements exist.

### 4. Requested vs accepted — what did the player actually do?

On every programme skip, record:

- the selected programme `startMs`
- `behindMs = Date.now() − startMs`
- the calculated `target`
- the value actually requested of the player
- the position the player ended up at, immediately after
- `clampedByS`

`requestedTarget`, `acceptedPosition` and `clampedByS` already exist for this.
**Wire them into the visible panel if they are not already there — WS32 did this
for the clamp; verify and do not duplicate.**

**An accepted position equal to the target is a result, not a confirmation.**
It means the player did what it was told, which shifts the question to *what it
was told* — it does not exonerate the calculation.

---

## 4. Output format — one record, raw values, no derived "offset"

The owner asked for **a single test record of raw values and deltas, not another
derived number whose meaning might be ambiguous.** Honour that literally.

**One record per seek**, containing the raw inputs and the arithmetic that can be
redone by hand:

```
seekRecord: {
  // --- measurement 1: age of the cached value ---
  nowMs, cachedWrittenAtMs, cachedAgeMs,
  cachedSeekableEnd, freshSeekableEnd,

  // --- measurement 2: rates (previous pair is included) ---
  rateWindow: {
    sample1: { nowMs, seekableEnd, trueEdgeWallMs },
    sample2: { nowMs, seekableEnd, trueEdgeWallMs },
    wallElapsedMs, streamElapsedMs, seekableEndElapsedMs,
    streamRateVsWall, seekableRateVsStream
  },

  // --- measurement 3: fresh vs cached ---
  freshMinusCachedMs,

  // --- measurement 4: requested vs accepted ---
  startMs, behindMs, target,
  requestedTarget, acceptedPosition, clampedByS
}
```

**Rules for this record:**

- **Every field is a raw reading or a subtraction of two raw readings.** No field
  is named or shaped like an "offset" unless it is exactly `offsetS`, which
  already exists and is already defined.
- **Anything not measurable is `null`, never `0`.** A `0` reads as "measured and
  zero"; `null` reads as "not measured". This distinction has already caused one
  wrong conclusion in this repo.
- **Comment each field with its unit and its frame** (ms, media seconds, or
  clock-derived). The owner asked for this explicitly because a future reader
  must not confuse them.
- **Expose the whole record on the Info panel**, so the owner can read it on the
  phone without a developer tool. The owner is the only one who can produce the
  HLS conditions, so **anything not visible on the panel will not be measured.**

---

## 5. Behaviour that must NOT change

**The seek must behave exactly as it does today.** Specifically:

- `seekToProgramTime` still computes `target = seekableEnd − behindMs/1000` and
  seeks with the **cached** `cur.seekableEnd`. **Do not "improve" it by using the
  fresh read.** That is the whole point of measurement 3 — comparing fresh against
  cached only works if the cached one is genuinely still the one in use.
- **No correction, no compensation constant, no offset applied anywhere.**
- **No architectural change.** No refactor of the seek path, no new module, no
  change to the transport layer.
- `updateSeekableState()`'s existing writes, and every consumer of
  `seekableEnd` / `seekableStart` / `distanceFromLiveEdge` / `atLiveEdge`, behave
  identically.
- The **only** new state is the one timestamp field in §2, plus the read-only
  record object.
- All 7 timing constants unchanged; `metaDiagGateOpen()` byte-identical;
  `Spelas just nu` untouched; `styles.css` / `index.html` / `sw.js` untouched.

**One field, one writer:** the new timestamp is written in exactly one place, at
the same assignment it describes. If you find yourself writing it anywhere else,
stop.

---

## 6. Reachability — answer before calling it done (`AGENTS.md` §7a)

Name the call site and prove it runs on the path the owner uses. The owner
reaches this via **cog → Info → the timing section**, and performs the seek with
the **dedicated back-to-previous-programme button** (confirmed by the owner
2026-09-30 — not a drag, not the circular arrows).

Prove: the record is populated **at the seek**, not merely computed somewhere; the
rate sampler runs on its timer without owner interaction; the panel shows it; and
the panel's existing timers are still cleared on close.

**Proving the old code is absent is not sufficient** — assert the new path is
*reached*.

---

## 7. Tests, and they must be able to go red

`AGENTS.md` §2: a test that proves the wrong property is worse than no test.
**For each test, state the user-visible failure it catches.** If you cannot, do
not write it.

**Required:**

1. **Measurement 1 is arithmetic**: `cachedAgeMs = nowMs − cachedWrittenAtMs`.
   Extract the real code, do not retype it (§7).
2. **Measurement 2's rates are arithmetic** from the recorded samples, and the
   test **fails** if a rate is computed from absolute positions instead.
3. **Measurement 3 records BOTH values and does not interpret.** Assert the
   record contains a fresh read distinct from the cached field — and assert
   `freshMinusCachedMs` is present even when it is `0`.
4. **`null` vs `0`**: an unmeasurable field is `null`. A test that fails when a
   `0` is substituted for a `null`.
5. **Measurement 4** records start, behindMs, target, requested, accepted.
6. **A guard that measurement 2 cannot silently degenerate** — if the two samples
   are identical, the rates must not report a confident `1.000`.

**Then prove they can fail.** At least four mutations, each restored **by
checksum**; report `NO-OP` as a **hard failure**, never as "missed". Suggested:
the age computation inverted; the rate computed from absolutes; the fresh read
replaced by the cached value; `null` replaced by `0`.

**The test count must go UP.** Record before and after.

---

## 8. Driving it in the browser, and what you must say about it

`AGENTS.md` §14: assert on the **rendered DOM**, not on source.

**You will not be able to exercise this.** Desktop Chromium falls back
HLS → direct MP3, `seekableEnd` is `null`, and no real seek happens. **That is
established and re-confirmed repeatedly; do not spend the session fighting it.**

What you *can* and should do:

- Verify the panel **renders the record** in the non-numeric states, with no
  invented numbers — that is the WS30/31 property and it must survive.
- Verify **the gate still yields nothing** on a shared `?diag=metadata` link.
- Verify you are running **your own code** by grepping the **served** file —
  the repo's `index.html` loads the **hashed** bundle, which is pre-change.
- Exercise the record's shape with **stubbed** readings if that is honest, and
  **label it as stubbed**.

**State plainly what your browser run did not cover.** A fallback is not a
verification. Never write "verified" for anything proved offline.

---

## 9. Report — `SESSION-STATUS.md`, append-only

Append a block in the `AGENTS.md` §13 format. **Append; never rewrite an earlier
block.** The corrections in the existing blocks are part of the record.

Must contain: baseline (yours); every file changed; test count before → after;
the mutations and their results; **the raw record shape with an example**;
**what the browser run did not cover**; and a **NOT DONE** list.

**Your report must NOT contain a conclusion about where the offset lives.** You
are measuring. If the numbers look conclusive, say so as an *observation* and
still do not act on it. **Three explanations have already been withdrawn in this
workstream; a fourth confident claim is the main risk.**

**Say what deploying would prove if it were pushed** — and note that it is not
being pushed.

---

## 10. Acceptance criteria

Report each **individually as PASS / FAIL / NOT RUN**. A check not run is
**NOT RUN**, never PASS.

| # | criterion |
|---|---|
| AC1 | `npm test` run by you; green; **count went up**; before → after recorded |
| AC2 | **no absolute `seekableEnd`-vs-stream-clock difference anywhere** — verified by grep, and no media→wall conversion added |
| AC3 | the **only** cross-frame comparison is a rate between two timed samples |
| AC4 | the new timestamp has exactly **one writer**, at the assignment it describes |
| AC5 | measurement 1: age computed as arithmetic from two raw readings |
| AC6 | measurement 2: two samples ~10 s apart **on a timer**, rates reported, falsifiability stated |
| AC7 | measurement 3: both values recorded, **difference not interpreted** |
| AC8 | measurement 4: start, behindMs, target, requested, accepted, clamped all recorded |
| AC9 | unmeasurable fields are `null`, never `0`; a test enforces it |
| AC10 | the whole record is visible on the Info panel |
| AC11 | **seek behaviour unchanged** — cached `seekableEnd` still the one used |
| AC12 | no correction constant; 7 constants unchanged; `metaDiagGateOpen` byte-identical |
| AC13 | `styles.css` / `index.html` / `sw.js` unchanged |
| AC14 | ≥4 mutations, all red, checksum-verified, no NO-OP |
| AC15 | reachability proven on the owner's path (back-skip button), not assumed |
| AC16 | status block appended; NOT DONE written; **no conclusion offered** |
| AC17 | **NOT PUSHED. No build, no deploy.** |

---

## 11. The one thing to get right

**You are building the ruler, not using it.** This workstream has already
produced one measurement that looked authoritative and was mathematically
incapable of seeing the thing it claimed to measure.

If a field cannot be measured without assuming what is being tested, **leave it
`null` and say so.** A missing number is information; a plausible wrong number is
worse than either, and this repo has three withdrawn explanations to prove it.

The owner will read this on the phone, because the phone is the only place the
HLS conditions exist. **Make the record unambiguous enough that they can check
the arithmetic by eye.**