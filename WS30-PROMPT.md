# WS30 — replace the tautological readout with a genuine two-source comparison

**From:** tech lead. **To:** coding agent (Space Bunny), in your own chat.
**Date:** 2026-09-30. **Baseline when written:** `main` = `0cb7f0d`.

Read `AGENTS.md` first. It is auto-discovered for you. Then this brief. The brief
is a **contract**, not a summary: it names the acceptance criteria and the
evidence bar.

---

## 0. Read this before touching anything

### 0.1 The bug you are fixing is a tautology, and I found it by algebra

In the shipped `app.js`:

```js
function streamEdgeWallMs() {
  const end = state.current ? state.current.seekableEnd : null;
  if (!Number.isFinite(end)) return null;
  return Date.now() - (end - (audioEl.currentTime || 0)) * 1000;   // (1)
}
```

and in the snapshot:

```js
edgeMinusNowS: (() => {
  const e = streamEdgeWallMs();
  return Number.isFinite(e) ? Math.round((Date.now() - e)) / 1000 : null;
})(),                                                               // (2)
```

Substitute (1) into (2) and **`Date.now()` cancels completely**:

```
edgeMinusNowS = round((Date.now() - (Date.now() - (end-currentTime)*1000))/1000)
              = end - currentTime
              = distanceFromLiveEdge
```

`distanceFromLiveEdge` is a number the app already computes for itself, and
`edgeAsWallClockIso` is `new Date(Date.now() - x)` — **also** restated, not
measured. **Every quantity in `streamEdge` is derived from the app's own clock
compared against itself.** There is no second clock in the app.

This is why the owner saw the number wander between +1 and −7: that is the
playhead moving around the buffer edge, not an offset. **The owner was reading
correctly.** WS29 shipped this, it passed 235 tests, and I reviewed the deploy
without reducing the algebra. The tests passed because they were written from
the same formula. Do not repeat that: **a test built from the same formula as
the code cannot fail.**

### 0.2 The fix I am NOT asking you to make

There is an obvious "fix": subtract a constant. **Do not.** `AGENTS.md` §5 — a
fudge factor from one sample freezes that sample into permanent behaviour, and
this repo has already paid for "10 seconds" becoming folklore across three
workstreams. **No correction constant. Not now, not later, not as a
"temporary" value.** If you find yourself wanting one, that is the signal to
stop and report.

---

## 1. What I measured, and what it does and does not prove

I probed SR's CDN from this machine. **Reproduce all of it yourself** before you
trust a word of it.

**The stream's own clock exists and is browser-readable.**

| probe | result |
|---|---|
| `https://ljud1-cdn.sr.se/lc/p2.m3u8` (master) | 200, `application/x-mpegURL` |
| `access-control-allow-origin` with `Origin: https://danielomazarino.github.io` | **`*`** |
| `https://ljud1-cdn.sr.se/lc/p2/p2_320.pls` (variant) | 200, 5022 bytes |
| `#EXT-X-PROGRAM-DATE-TIME` in the variant | **exactly 1**, at the head |
| `#EXTINF` in the variant | **1700** |
| `sum(#EXTINF)` | **10880.0 s** (= 3 h 1 m 20 s) |
| `#EXT-X-DISCONTINUITY-SEQUENCE` | 0 |

So the edge of the buffer, in the stream's own clock, is:

```
trueEdgeWall = headPDT + sum(EXTINF)
```

**MEASURED `now − trueEdgeWall` over repeated fetches: −25.0, −25.6, −24.4,
−28.1, −29.3, −30.0, −30.7, −31.3, −32.6 s.** The true stream edge is roughly
**25–33 s AHEAD of this machine's clock**, and **it drifts** — about 4 s over
40 s of sampling. So:

- **It is a real, signed, non-zero bias.** It is not zero, and not a constant.
- **It is NOT device-verified.** My clock is not the owner's iPhone clock. A
  large part of it may be *this machine's* clock error, or Akamai edge
  behaviour, or the `Date.now()` I sampled against. **Do not present −28 s as
  the offset the owner is experiencing.** It is what I measured from here.
- **It is not necessarily the cause of the ~25 s programme-skip offset.** I
  cannot link them yet. That link is what the device reading is for.

### 1.1 A methodology trap I fell into — do not repeat it

My first sweep reported `ljud2 → −36.0 s` while ljud1 read `−29.6 s` from the
*same* master manifest, with ljud2 carrying a *higher* media sequence. That is
impossible, and it was my error: **I took one `now` and reused it across four
sequential fetches**, so the later requests inherited an older clock.

Re-measured with the clock sampled immediately after each fetch:

```
ljud1  −31.1      ljud2  −30.0
ljud1  −29.3      ljud2  −28.6
```

Consistent. **Rule for your harness: every sample takes its own clock reading,
immediately after its own fetch. Never share a `now` across requests.** A
sweep that produces a physically impossible row is a broken sweep
(`AGENTS.md` §2).

---

## 2. The scope — one function's worth of work, and nothing else

### 2.1 In scope

1. **Add a genuine second clock.** Fetch the active stream's HLS **variant**
   playlist, parse the head `#EXT-X-PROGRAM-DATE-TIME` and the `#EXTINF` sum,
   and compute `trueEdgeWall`. Keep it a **pure function over playlist text** so
   it is testable without a network.
2. **Report the real difference** — the app's edge belief minus the stream's
   clock, signed, plus both raw values and the age of the sample.
3. **Point the on-screen panel at the new numbers**, and keep the existing
   "Starta en radiokanal först" no-data behaviour.
4. **Tests that can fail.** Behavioural, and red without your change.

### 2.2 Explicitly OUT of scope — do not touch

- **No correction constant, and no seeking behaviour change.** You are
  instrumenting, not fixing the offset. Do not alter `seekToProgramTime`,
  `seekBy`, `seekToLive`, `playheadWallMs`, `dvrPositionToDate`, or any
  transport constant (`SEEK_LIVE_MARGIN_S`, `LIVE_EDGE_TOLERANCE_S`,
  `NOW_PLAYING_INTERVAL_MS`, `NOW_PLAYING_TIMELINE_MAX`, `SEEK_*_DEBOUNCE_MS`).
- `metaDiagGateOpen()` — **byte-identical.** WS29 verified it in four cases and
  the security property (a shared `?diag=metadata` link with no localStorage
  flag must yield nothing) must survive.
- The false `DATERANGE` comment at `app.js` ≈3337 — **noted, not edited.**
- R5 (pre-midnight programme title), the `Spelas just nu` label (**owner
  decided 2026-09-29: leave it**), podcast search, the lock-screen-wrong-PWA
  item, Android, E1b. Do not "improve" any of them.
- Do not build, do not commit artifacts, do not push. Commit source + tests in
  **one** commit and stop.

---

## 3. The three requirements that matter

### R-A — Reachability. Prove it, don't reason about it

`AGENTS.md` §7a — a correct, well-tested, never-executed fix has happened twice
in this repo, for this same class of gate.

Name the call site and prove it runs **on the path the owner actually uses**:
radio channel playing → the Info sheet is opened → the switch is turned on.
Your fetch must therefore be **triggered by that path**, and you must state in
`SESSION-STATUS.md` exactly what triggers it and when.

**If your fetch only runs on a 45 s poll, the owner will open the panel and see
a stale or empty number — which is indistinguishable from "no offset".** That
is the failure this requirement exists to prevent. If a fresh sample per panel
open is too expensive, sample on panel open **and** keep a periodic refresh, and
say which you did and why.

### R-B — The panel must never show a number it cannot justify

The current panel shows a self-computed difference while claiming to be a
measurement. A reader cannot tell the difference. **Therefore the panel must
distinguish these states explicitly**, in Swedish, on screen:

| state | condition | what the owner must see |
|---|---|---|
| no stream | no radio channel playing | the existing "Starta en radiokanal först" |
| not yet sampled | fetch not finished | an explicit "mäter…" / "hämtar…" state — **never `0`** |
| fetch failed | network/CORS/parse error | an explicit failure state, **never `0`, never a stale number** |
| **real reading** | both clocks present | the signed offset, **and the age of the sample** |

**A `0` that means "unknown" is the exact defect you are fixing.** Do not
reproduce it in a new place. And **stale is not fresh**: if the sample is older
than a few seconds, say so on screen rather than presenting it as current.

### R-C — Tests must be able to go red

`AGENTS.md` §2 and §7b. For each new test, state in `SESSION-STATUS.md`:

- **the user-visible failure it catches**, in one sentence;
- **the red proof** — revert your change, run the suite, record the failing
  test names, restore, and **verify by checksum** that the file is back.

A test that cannot fail is worse than no test. **Watch the test count go UP** —
green with an unchanged count means the suite cannot fail on this defect, which
is precisely the WS24/WS29 failure mode.

Prefer tests that **drive the real function with real playlist text**, not
assertions on source text. If you must assert on source, assert on an
**assignment or a behaviour**, never on a declaration or a bare mention.

**The tautology deserves its own regression test.** Something that fails if
anyone reintroduces a self-referential clock. State what user-visible failure
that catches — "the panel shows the playhead's distance from the buffer edge
while claiming to be an offset" — and make the test detect *that*, not the
absence of a particular string.

---

## 4. Suggested shape (mine, not binding — you may do it differently)

A pure parser, no network, fully testable:

```
parseVariantEdge(playlistText) -> { headPdtMs, totalMs, segmentCount } | null
trueEdgeWallMs(parsed)         -> headPdtMs + totalMs
offsetS = (appEdgeBeliefMs - trueEdgeWallMs) / 1000     // signed, no constant
```

Report **both** raw wall-clock values as ISO strings alongside the difference,
plus `sampledAtMs` / age. Three numbers from two sources beat one derived
number: a reader can check the arithmetic, and the two clocks can be compared
independently if one of them is later found to be wrong.

**Choosing the variant URL.** HLS entries point at the **master** manifest
(`HLS_MASTER` in the app builds `https://ljud1-cdn.sr.se/lc/{slug}.m3u8`), and
the comment there says Safari/hls.js pick the variant and handle SR's content
steering themselves. A master manifest has no `PROGRAM-DATE-TIME` — it has
`#EXT-X-STREAM-INF` + variant URIs. So you must **resolve one level**: fetch the
master, pick a variant, fetch that. I measured `p2_32`, `p2_128` and `p2_320` and
all three agree on `sum(EXTINF) = 10880.0` and the same head PDT, so the choice
does not appear to matter — **but verify that yourself, and prefer the highest
bandwidth variant the master offers**, since that is closest to what plays.
Prefer a **relative** variant URI resolved against the master's own URL, and
handle absolute ones. **Do not hardcode a bitrate or a variant filename** — the
master is the source of truth.

**Do not double-fetch on every render.** The panel refreshes on an interval; a
fetch per tick is wasteful and will look like a bug on the phone. Decide the
refresh policy, state it, and keep the sample age on screen.

**Aborting.** The repo already uses `AbortController` for timeouts elsewhere —
find the existing pattern by searching for `AbortController` and **reuse it**.
A fetch with no timeout can hang the panel indefinitely on a phone.

---

## 5. Acceptance criteria — the workstream is done when all are true

1. `npm test` is green **and the test count went up**. Record before and after.
2. The panel shows a **two-source** signed offset, or an explicit non-numeric
   state. **Never a bare `0` meaning "unknown".**
3. Both raw clock values and the sample age are visible in the snapshot.
4. `metaDiagGateOpen()` is **byte-identical**; the shared-link case still yields
   nothing.
5. **Zero removed lines** in `app.js` except inside `streamEdgeWallMs`'s own
   comment/logic and the readout function you replace — report the count, do
   not assert it in prose.
6. **No correction constant.** Count is 0. If you believe one is warranted,
   **report it as a recommendation and do not add it.**
7. Every new test has a red proof with a checksum-verified restore.
8. `SESSION-STATUS.md` has your blocks: baseline, scope, findings, test counts,
   and the reachability argument (R-A).
9. **Drive it in the built-in browser** and assert on the **rendered DOM text**,
   not on source. The live stream will not play in desktop Chromium — that is
   `AGENTS.md` §1 — **but the fetch and the panel are testable**, because the
   playlist is CORS-open. That is the point of this workstream: **this is the
   part of the offset that CAN be settled without the iPhone.** State clearly
   what your browser run did and did not cover.
10. **ONE commit**, source + tests together. No build, no push.

---

## 6. One protocol for the owner — and I have checked every label this time

`AGENTS.md` records that a previous brief of mine named the wrong button and
sent the owner to the ±15 s controls instead of the programme skip. **I have
verified the aria-labels in the current source. Use these, not glyphs:**

| control | aria-label | what it does |
|---|---|---|
| outer pair beside ▶ | `Bakåt 15 sekunder` / `Framåt 15 sekunder` | plain `seekBy(±15)` |
| **inner pair** | `Till föregående programs start` / `Till nästa programs start` | **the programme skip** (`seekToProgramTime`) |
| when at the edge | `Till Direkt` | `seekToLive` |

**Owner instructions, in this order:**

1. Confirm the small build line under NYHETER reads the build id you report.
2. Start **any** radio channel. (No skip press is needed for a reading — the
   sample is taken when the panel is opened.)
3. ⚙️ cog → **Info** → scroll to the bottom → turn on **Visa tidsdiagnostik**.
4. Read the number, **plus the sample age**, and report **both**, with the
   build id. If it shows a non-numeric state, report **that exact state** — it
   is a result, not a failure.
5. *Then*, if you want the skip behaviour: tap the **circular-arrow** button
   (↺ / ↻) either side of ▶. That is the programme skip.

**A device reading settles the direction.** I have not confirmed whether the
owner's "lands early" refers to the audio or the title, so **do not** let a
reading be used to "confirm" a sign until that question is answered.

---

## 7. Report format (AGENTS.md §9)

Separate these; never blur them:

- **CODE CHANGE** — file and function. Also name the files you did **not**
  change that a reader might assume were involved.
- **MEASURED** — the number, how you obtained it, and **what it does not
  prove.** Distinguish device / fixture / code / browser evidence.
- **NOT DONE** — recommended work you did not perform, **named as not done.**

Never write "verified" for anything you proved offline. Use *fixture-proven*,
*code-proven*, *browser-driven*, *device-verified by the owner*.

## 8. Stop conditions

Stop and report, do not guess, if any of these is true:

- the variant playlist turns out **not** to be CORS-readable from the deployed
  origin — then the two-source comparison may be impossible in-app, and **that
  is a finding worth more than a workaround**;
- `sum(#EXTINF)` does **not** correspond to the edge, or the playlist carries
  **more than one** `PROGRAM-DATE-TIME` (a discontinuity would break the
  single-head assumption — there are none today, but that could change);
- you cannot make a test go red for a fix you believe is correct;
- the reachability requirement (R-A) cannot be met without touching something
  in §2.2.

**The offset remains unmeasured on the device and unfixed. Shipping this
workstream means shipping the instrument, not the cure.**
