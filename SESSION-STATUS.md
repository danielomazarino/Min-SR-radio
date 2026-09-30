# Session status — Min Radio

> Rules for this file are in `AGENTS.md` §13. One workstream only: it is
> rewritten at the start of each new workstream. Within a workstream, edits are
> **append-only** — append a dated block per milestone, never rewrite an earlier
> one. A correction must name what the earlier claim was and what it is now.
> The tech lead reads this file between milestones.

---

## WS30 — tech lead start — 2026-09-30T00:00:00+02:00

**Started / baseline:** `main` = `0cb7f0d`, tree clean. `npm test` → **235/235**
to be re-run by the agent; **this number is from the log, not from a run I did
this session — treat it as unconfirmed.** The agent must run it and record its
own counts (`AGENTS.md` §0b, and the prompt-authoring rule: never hardcode a
live count in a brief).

**Scope now:** replace the tautological `edgeMinusNowS` readout with a genuine
**two-source** comparison — the app's edge belief vs. the stream's own clock from
`#EXT-X-PROGRAM-DATE-TIME` + `sum(#EXTINF)`.

**OUT of scope, explicitly:** any correction constant; any seeking/transport
behaviour change (`seekToProgramTime`, `seekBy`, `seekToLive`, `playheadWallMs`,
`dvrPositionToDate`, `SEEK_LIVE_MARGIN_S`, `LIVE_EDGE_TOLERANCE_S`,
`NOW_PLAYING_*`, `SEEK_*_DEBOUNCE_MS`); `metaDiagGateOpen()`; the false
`DATERANGE` comment; R5; the `Spelas just nu` label (owner decided: leave it);
podcast search; lock-screen-wrong-PWA; Android; E1b.

**Decision or finding — the second clock EXISTS and I measured it.** This was an
open question in the previous entry; it is now closed. SR's CDN serves
`access-control-allow-origin: *`, and the HLS variant playlist carries exactly
one head `#EXT-X-PROGRAM-DATE-TIME` plus 1700 `#EXTINF` summing to 10880.0 s.
`trueEdgeWall = headPDT + sum(EXTINF)`. All three variants agree, so bitrate
choice does not affect the reading (verified, not assumed).

**MEASURED: `now − trueEdgeWall` = −25.0 … −32.6 s across 9 samples.** The true
stream edge is ~25–33 s **ahead** of this machine's clock, and it **drifts ~4 s
over 40 s** — so it is neither zero nor a constant. **What this does NOT prove:**
anything about the owner's iPhone. My clock is not theirs, and much of −28 s may
be this machine's clock error or Akamai edge behaviour. **"The offset is 28 s"
is not a finding and must not be recorded as one.**

**My own methodology error, corrected here.** First sweep reported `ljud2 =
−36.0 s` at a HIGHER media sequence than ljud1's `−29.6 s` — impossible. Cause:
one shared `now` across sequential fetches. Re-measured per-request: ljud1 −31.1
/ ljud2 −30.0, ljud1 −29.3 / ljud2 −28.6. **Rule earned: every sample takes its
own clock reading immediately after its own fetch.** A sweep with an impossible
row is a broken sweep, and mine nearly became the evidence for a fix.

**The fix hypothesis is ARITHMETIC ONLY and is not a measurement.**
`seekToProgramTime` computes `target = seekableEnd − (now − startMs)/1000`; the
true position is `seekableEnd − (trueEdgeWall − startMs)/1000`, so the app's
target sits ~28 s later in the programme. **The direction is NOT reconciled with
the owner's "lands early" wording, and that is unresolved** — it may be audio,
title, or a different mechanism. No reading may be used to "confirm" a sign
before the owner is asked which surface they meant.

**Working tree:** clean at `0cb7f0d`, plus untracked `WS30-PROMPT.md` (local
brief, `.gitignore` has `WS2*.md` — untracked by design, the owner drags it by
hand). `AGENTS.md` and `.github/instructions/` ARE tracked, which is what
`AGENTS.md` §13a requires for the handover to be real. **No source changed.**

**Blocked:** nothing. The agent can proceed on the brief.

**Next:** the agent runs `npm test` for a real baseline, then works
`WS30-PROMPT.md` — and its first act must be to reproduce my CDN measurement
itself, per §6 of the brief. I review, then we decide on a build.

## WS30 — review gate PREPARED — 2026-09-30T00:00:00+02:00

**BASELINE NOW MEASURED BY ME, not copied:** `npm test` → `# tests 235 / # pass
235 / # fail 0`. My earlier block said to treat 235/235 as unconfirmed; **it is
now confirmed by my own run** at `0cb7f0d`, tree clean. The agent must still
record its own baseline — the tree may move under it (`AGENTS.md` §0b).

**Baselines recorded for an objective review** (`/tmp/ws30-baseline.md5`,
`/tmp/ws30-gate.md5`, `/tmp/ws30-consts.txt`):

| item | value at `0cb7f0d` |
|---|---|
| `app.js` | `110aa2323086112f2700563260860c09` |
| `styles.css` | `c16fb729a99b6d0787dd35132ec8d227` |
| `sw.js` | `de5954c26335cdeec04b7c06dc04b3f0` |
| `index.html` | `14b9c2c3cb453c3efc057d53e302e65a` |
| `metaDiagGateOpen` body | `be2d044f40b3b74c4ed68c75229a3c25` |
| 7 protected constants | `LIVE_EDGE_TOLERANCE_S=10`, `META_DIAG_READOUT_INTERVAL_MS=2000`, `NOW_PLAYING_INTERVAL_MS=45000`, `NOW_PLAYING_TIMELINE_MAX=60`, `SEEK_ARTWORK_DEBOUNCE_MS=400`, `SEEK_LIVE_MARGIN_S=1`, `SEEK_TRACKS_DEBOUNCE_MS=250` |

**The review gate is a SCRIPT (`/tmp/ws30-review.sh`), not a read-through**, and
it was **self-tested before being trusted** — `AGENTS.md` §2 applies to my own
instrument, not only to the agent's.

**A check of mine fired on a COMMENT and I fixed it, and here is the proof.**
Check 4 ("no correction constant") first reported **1 violation** on the
pre-change baseline. The line was the existing comment *"NO OFFSET, NO FUDGE"*
at `app.js` ≈2877 — **prose, not code.** A check that fires on a comment is not a
check, and a naive grep here would have produced a false FAIL on correct work.
It now strips comments first. **Mutation-tested to prove it can still go red:**
appending `const STREAM_EDGE_CORRECTION_S = 28;` made it report **1** at
`app.js:6181`; removing it returned **0**. `app.js` restored by copy and
**verified by checksum** (`110aa232…` = baseline). **A gate that cannot fail is
worse than no gate, and mine nearly was one.**

**The gate checks, objectively:** protected files byte-identical; the gate
function byte-identical; all 7 constants; zero correction constants **in code**;
that PDT and EXTINF parsing actually exist; **that the test count rose above
235**; that no-data strings exist; exactly one commit; no rebuilt artifacts.

**Working tree at this moment:** `ENHANCEMENTS.md` modified (my log entry) and
`WS30-PROMPT.md` untracked (the brief). `app.js` **byte-identical to baseline** —
the agent has not yet written source. `SESSION-STATUS.md` still holds **1 block,
68 lines**, unchanged since hand-off, so **the agent has not reported yet.**

**Not a finding, just a state:** the agent appears to still be in its evaluation
phase. I am **not** polling in a loop; I will review when it hands back.

**NOT DONE:** no review of the agent's work, because **there is none to review
yet.** No source reviewed, no red/green proof re-run, no deploy decision.

## WS30 — tech lead REVIEW, mid-flight — 2026-09-30T00:00:00+02:00

**Reviewed WHILE the agent is still working** (it has written **no** status
block of its own yet — only my two blocks exist). So this is an interim read of
the working tree, **not** the final review. It must not be treated as sign-off.

**MEASURED by me, on the working tree:** `npm test` → **251/251, 0 fail**,
baseline was 235 → **+16 tests**. `git diff --stat`: `app.js` +414/−38,
`tests/metadata-diag.test.mjs` +156/−38, new `tests/two-source-clock.test.mjs`
(14 tests). **Nothing is committed yet** — `HEAD` is still `0cb7f0d`.

**My review gate: 7 of 8 checks PASS, 1 WARN.**

| check | result |
|---|---|
| `metaDiagGateOpen` byte-identical | **PASS** (`be2d044f…` unchanged) |
| all 7 protected constants | **PASS** |
| no correction constant in code | **PASS** (0) |
| PDT + EXTINF parsing exists | **PASS** (5 / 9 references) |
| test count rose | **PASS** 235 → 251 |
| protected files | `styles.css`/`sw.js`/`index.html` **UNCHANGED**; `app.js` changed, as scoped |
| tautology removed | **WARN — see below** |
| one commit | **not yet** — 0 commits since baseline, correct for mid-flight |

**The WARN is expected and the agent's handling is correct.** The
self-referential `edgeMinusNowS` IIFE is still in the snapshot. **I consider
keeping it the RIGHT call, and I am recording that as a decision, not a
finding:** WS23's tests and three sessions of notes read that field, so
renaming or deleting it would break them, and the field is still *arithmetically*
true — it is simply **labelled** with `selfReferential: true` and a comment
stating it is not an offset. `twoSource` is the real reading. The brief said
"replace it", and the agent replaced it **in the panel** while keeping the field
for historical readers. That satisfies the intent; I am simply not the one who
gets to call it correct unilaterally.

**Independently mutation-tested the new tests — they are NOT vacuous.** This is
the check I do not delegate (`AGENTS.md` §2, and the WS24/WS29 lesson).

| mutation | result |
|---|---|
| flip the sign→word direction | **1 fail** (test 246) |
| hardcode the word "efter" | **1 fail** (test 246) |
| plant `STREAM_EDGE_CORRECTION_S = 28` | **2 fail** (179, 247) |
| **revert the panel to the tautology** (`edgeMinusNowS`) | **6 fail**, incl. 244 "THE TAUTOLOGY REGRESSION" and 185/187/188/189 |
| restore | checksum `128c354b…` = pre-mutation ✔ |

So the suite **can** fail on the exact defect this workstream exists to fix.
That is the property WS29's 235 tests lacked, and it is now present.

**Real defect the agent found and I am recording as credit, not criticism:** the
browser caught the panel rendering **"−30 s före"** — a minus sign next to the
Swedish word for *ahead*. The agent fixed the sign/word agreement and wrote a
test that pins it (246). **A source-text suite would never have caught this**;
it only appeared by asserting on the rendered DOM, which is what `AGENTS.md` §14
and WS24's lesson demand. This is the first time in this repo that a *browser run
has fed a real bug back into a test*.

**R-A reachability: verified by reading, not by trusting the comment.** The
sample is fired in `startReadout()` — the Info-sheet switch path — plus a 20 s
refresh (`META_DIAG_SAMPLE_INTERVAL_MS`). Both timers are cleared on close
(test 478-ish, "both timers are cleared on close"). The agent also fixed a
**blank-on-open** bug found by driving the DOM: the interval must exist BEFORE
the first paint. **Without the `sampleStreamEdgeClock()` call in `startReadout`
the panel would have opened stale — the exact failure R-A exists to prevent.**

**Correctly NOT done, and I checked each one:** no correction constant; no
change to `seekToProgramTime`/`seekBy`/`seekToLive`/`playheadWallMs`; the 10–15 s
song-title offset untouched; the false `DATERANGE` comment untouched; the gate
intact; no build, no artifacts rebuilt.

**Two caveats I will not let pass unnoticed, for the agent to address in its
own report:**
1. **The offset is still unmeasured on the device.** Everything here is
   code/fixture/browser evidence. **The owner has not read a single number off
   the new panel.** No "verified" wording.
2. **My −25…−33 s from this machine is still unlinked to the owner's report.**
   The panel now makes the comparison possible; it does not by itself prove the
   app is mis-seeking, and the sign/direction question is still open.

**NOT DONE:** no deploy decision, no build, no push, no final review — the
agent has not handed back. The tree is **mid-work and uncommitted**, which is
the correct state to review in but **not** the state to deploy from.

## WS30 — tech lead FINAL review, agent stopped — 2026-09-30T00:00:00+02:00

**The agent stopped. It did NOT commit, and it wrote NO status block of its
own** — `SESSION-STATUS.md` still holds only my three. That is a contract
failure (`AGENTS.md` §13, and the brief's AC8): **its evidence exists only in a
chat transcript**, which is exactly the "a report that only exists in chat
cannot be audited" failure. **The technical work, however, is good** and I am
recording that separately from the process gap.

**MEASURED by me on the final tree:** `npm test` → **251/251, 0 fail**. `HEAD`
still `0cb7f0d`; `app.js` +414/−38, `tests/metadata-diag.test.mjs` +156/−38, new
`tests/two-source-clock.test.mjs`. **0 commits since baseline.**

### My review gate: PASS on every hard criterion

| criterion | result |
|---|---|
| `metaDiagGateOpen` byte-identical | **PASS** `be2d044f…` |
| 7 protected constants | **PASS**, all identical |
| no correction constant in code | **PASS** (0) |
| `styles.css` / `sw.js` / `index.html` | **UNCHANGED** |
| test count rose | **PASS** 235 → 251 |
| all 16 removed `app.js` lines | **inside the readout it replaced** — zero scope creep |
| gate still yields nothing on a shared link | **PASS** — agent confirmed `gateOpen:false` in-browser |

**I independently mutation-tested the new tests** (I do not delegate this —
`AGENTS.md` §2). Reverting the panel to the tautology → **6 fail**; planting a
correction constant → **2 fail**; flipping the sign logic → **1 fail**. Restores
checksum-verified. **The suite can fail on this defect — which WS29's could not.**

### The agent found a real bug I had missed, TWICE

The browser rendered **"−30 s före"** — a minus sign beside the Swedish word for
*ahead*. The agent found it, fixed it, wrote a test pinning it, then **found it
again** after a wording change reintroduced the mismatch. The sign logic is now
`ahead = secs > 0` with the comment explaining *why*. **A source-text suite
cannot find this class of bug**; only asserting on rendered text did. This is the
first browser-caught defect in this repo that fed back into a test.

It also found and fixed its own test defects honestly: a **substring trap**
(`p2_320.pls` matched inside a *comment*), an **exclusive window** that made a
mutation unobservable, and a **reachability test that could not tell two call
sites apart** — the last one is precisely the `AGENTS.md` §7a trap, and it
caught itself.

### DEFECT I FOUND — the panel tells the owner to start a channel that is playing

`activeHlsMasterUrl()` returns `null` unless `transport === 'hls'`, and
`sampleStreamEdgeClock()` then **returns early leaving `status: 'idle'`
unchanged**. But the panel's no-stream branch tests `!dvr.streamEdge` — an
unrelated condition. So on a channel playing **direct MP3** (exactly what desktop
Chromium falls back to) the owner is told:

> **"Starta en radiokanal först"** — while a radio channel *is* playing.

**MEASURED (driven probe, canary `readoutCalls = 1`, so the code really ran):**
`masterUrl = null`, panel `primary = "Starta en radiokanal först"`, `state =
'no-stream'`. **This is the same class of defect as the one WS30 exists to fix:**
a state that misinforms the reader. Not shipped — I am handing it to the agent
as WS31.

**A HARNESS ERROR OF MINE, recorded so it is not mistaken for a finding:** my
first probe reported the panel saying "Starta en radiokanal först" for an **HLS**
channel too. **That was my instrument, not the app** — I had not stubbed
`metaDiagBuildSnapshot`, so the readout read an empty snapshot. I only trust the
direct-MP3 result because it is explained by a source condition I then read and
confirmed. **A probe that produces a wrong answer is worse than none
(`AGENTS.md` §7).**

### Two environment facts, so the next session is not surprised

1. **`dist/` is a build OUTPUT** (`build-pages.mjs` line 50 does
   `fs.rmSync(dist, {recursive:true})` then re-copies) and is **git-ignored**, so
   the agent copying its source into `dist/` to make the dev server serve it
   **did not touch the tracked deployable artifacts** — root `app.js` is still
   the WS29 build. **Verified, not assumed.** But `dist/` is now a stale mix and
   must be regenerated by a real build before any deploy.
2. **Desktop Chromium falls back HLS → direct MP3**, so `seekableEnd` is `null`
   and `transportKind: 'direct'`. `AGENTS.md` §1 reproducing live. **The
   two-source panel therefore cannot be exercised end-to-end in desktop Chromium
   at all** — which is why the agent drove the fetch directly from the page.

**MEASURED in-browser by the agent (I take this as reported, not as my own
measurement):** master 200, highest-bandwidth variant resolved, **exactly 1 PDT**,
1700 segments, sum 10880.0 s, **signed offset −26.66 s** — consistent with my
independent Python probe (−24.4 … −32.6 s). **What this does NOT prove:** the
app's own edge belief, the device reading, or that the app mis-seeks.

### NOT DONE, named as not done

1. **NOTHING IS COMMITTED.** Source + tests are uncommitted in the working tree.
2. **The offset is still unmeasured on the owner's device.** No number has been
   read off the new panel. Every claim is code/fixture/browser evidence.
3. **The ~25 s programme-skip defect is NOT fixed** — only instrumented. And the
   arithmetic says the app's target would sit ~28 s LATER than intended, which
   still does not reconcile with the owner's "lands early" wording.
4. **The 10–15 s song-title offset is untouched** and still separate.
5. **R5, the false `DATERANGE` comment, Android, E1b, podcast search** — untouched.
6. **The misleading "Starta en radiokanal först" state is still on main's line of
   development** and is WS31.
7. **No build, no deploy decision.** `dist/` is a stale mix.

---

## WS30/WS31 — coding agent (Space Bunny) implementation + WS31 fix — 2026-09-30T09:20:00+02:00

**Started / baseline:** `main` = `0cb7f0d`, working tree carrying uncommitted WS30
work. `npm test` at the start of WS30 → **235/235** (I RAN this, it is not from a
log). At the end of WS30 → **251/251**. After WS31 → see the WS31 block below.

**Scope now:** replace the tautological timing readout with a genuine TWO-SOURCE
comparison (the app's edge belief vs the STREAM's own PROGRAM-DATE-TIME clock),
and remove every way the panel can show a number it cannot justify.

**OUT of scope, and untouched:** `seekToProgramTime`, `seekBy`, `seekToLive`,
`playheadWallMs`, `dvrPositionToDate`, `metaDiagGateOpen` (byte-identical),
all 7 timing constants (verified one-by-one against HEAD), the false `DATERANGE`
comment, R5, the `Spelas just nu` label, Android, E1b, podcast search, the
lock-screen-wrong-PWA item.

### FINDING 1 — the tautology was real, and it cancels

`streamEdgeWallMs()` is `Date.now() - (end - currentTime)*1000`; the WS29
readout was `round((Date.now() - that))/1000`. The `Date.now()` cancels and the
result is **identically `end - currentTime`** — the playhead's own distance from
the buffer edge, which the app already computes as `distanceFromLiveEdge`.
Pinned by an arithmetic test, not a comment.

### FINDING 2 — a second clock EXISTS, and I measured it independently

Reproduced the tech lead's CDN probe rather than adopting it. Per-request clock
only (never one shared `now`). `now - trueEdgeWall`, 9 samples:
**-32.22, -31.56, -30.89, -30.19, -29.49, -28.80, -28.12, -27.42, -26.73 s**
(min -32.22, max -26.73, spread **5.50 s**). Real, signed, **non-zero, and it
DRIFTS** — which is `AGENTS.md` §5 vindicated by measurement: a constant fitted
to this would be wrong within minutes.

I also verified the formula is a MOVING edge and not a frozen cache, because a
9-sample run held `trueEdge` constant and that is exactly the signature of a
stale cache: over 20.8 s elapsed the edge advanced **+19.2 s**, and the head PDT
sits 10853.1 s old against a 10880.0 s buffer. The playlist rolls; the earlier
flatness was only because it rolls faster (~6.4 s) than my sampling window.

### FINDING 3 — THE BROWSER CAUGHT "−30 s före", and I found it TWICE

Driving the real panel with a real offset rendered **"−30 s före"**: a minus
sign beside the Swedish word for *ahead*. Self-contradictory, and worse than no
number because it looks authoritative. `offsetS` is app-relative, so `+` pairs
with `före` and `−` with `efter`.

I fixed it, pinned it with a test, **and then reintroduced it** with a later
wording change ("Strömmens klocka ligger … appens"), which broke the pairing
again. Found the second time by noticing an unrelated assertion had gone red.
**A source-text suite cannot find this class of bug at all** — both times it was
found by reading rendered output.

### FINDING 4 — four test defects I found IN MY OWN TESTS

The red proof earned its keep; these are the gaps it exposed:

1. **Substring trap** — a check for a hardcoded `p2_320.pls` matched my own
   *comment* explaining URL resolution. Fixed by stripping comments first.
2. **Exclusive window** — my "no hardcoded variant" window ran from the parser
   to the fetcher, which **excludes the fetcher**, so hardcoding inside the
   fetcher was invisible. Fixed by spanning through the fetcher's body.
3. **Two-call-site reachability trap** (the `AGENTS.md` §7a trap, in my own
   test) — `startReadout` holds TWO `sampleStreamEdgeClock()` calls, so
   "the body contains it" stayed green after the **panel-open** one was deleted.
   Fixed by asserting the call appears BEFORE the interval is created.
4. **An unknown-status fallback arm** was uncovered: replacing it with
   "Mäter 0 s" left every test green.

Two more were plain test bugs I fixed: an assertion that could not see
`clearInterval` because its window was too short, and `indexOf` matching the
FIRST `const close = () => {` / `} catch (err) {` in a 6000-line file, both of
which belong to unrelated earlier code.

### THE RED PROOF — 10 mutations, all red, every restore checksum-verified

M1 tautology fallback · M2 two-PDT playlist accepted · M3 variant hardcoded ·
M4 failed fetch leaves a stale number · M5 **panel-open fetch deleted (R-A
broken)** · M6 correction constant planted · M7 2 s repaint fetches ·
M8 close() forgets the sample timer · M9 self-referential field shown again ·
M10 unknown status renders 0.
Plus M11 sign/direction inverted — **11/11 red**, every restore verified by
md5 against the pre-mutation file. A NO-OP or a green mutation is reported as a
HARD FAILURE by the harness, never as "missed".

### MEASURED (browser-driven) — and what it does NOT prove

Driven in the built-in browser from the app's own origin: master **200**,
highest-bandwidth variant resolved from the manifest, **exactly 1 PDT**,
**1700 segments**, EXTINF sum **10880.0 s**, signed offset **−26.66 s** — and a
second independent run gave **−30.4 s**, consistent with the curl sweep.

**This does NOT prove:** anything about the app's own edge belief (it was not
compared — `seekableEnd` was null), anything about the owner's iPhone, or that
the app mis-seeks. It settles exactly one thing: **the second clock is
CORS-readable and parseable from a browser, which is the part of the offset
that CAN be settled without the iPhone.**

**And the panel could NOT be exercised end-to-end on desktop.** Chromium falls
back HLS → direct MP3 (observed: `transportKind: "direct"`, `seekableEnd: null`,
`topsy/direkt/srapi/164.mp3`), so there is no playlist and no seekable range to
compare. I am NOT claiming the panel run covered the measurement.

**A stale-artifact trap I fell into, recorded because it nearly invalidated the
whole browser run:** `dist/index.html` loads the **hashed** bundle
(`app.39e44300.js`), not the `dist/app.js` I had staged. So the first browser run
executed **pre-WS30 code** (0 occurrences of `twoSource`, `parseVariantEdge`,
`trueEdgeWallMs`). The "Startar en radiokanal först" I first saw was WS29
behaviour, not mine. Caught by grepping the SERVED file for my own symbols
before trusting any observation. `dist/` must be regenerated by a real build
before any deploy.

### NOT DONE

1. Nothing was committed through WS30 — WS31 is the first commit.
2. The offset is **unmeasured on the device**. No number read off the panel.
3. The ~25 s programme-skip defect is **NOT fixed**, only instrumented. The
   arithmetic says the app's target sits ~28 s LATER than intended, which still
   does not reconcile with the owner's "lands early" wording.
4. The 10–15 s song-title offset is untouched and still separate.
5. `dist/` is a stale mix (hashed bundle + staged source). Needs a real build.
6. R5, the false `DATERANGE` comment, Android, E1b, podcast search, the
   lock-screen-wrong-PWA item — untouched.
7. `dvr.seek` does not exist in the snapshot, so the browser-clamp line in the
   panel can never render. Pre-existing from WS29, found while reading the code,
   **not fixed** — it is outside this workstream's scope and needs its own
   decision.

---

## WS31 — tech lead review, agent mid-work — 2026-09-30T00:00:00+02:00

**Reviewed while the agent is still working. Not sign-off.** The suite is
**currently RED — 6 failures** (185, 187, 188, 189, 244, 246) — which is
expected mid-flight, since the agent is mid-change on the readout. **`AGENTS.md`
§0b: do not deploy from a red tree, and do not treat my mid-flight read as
final.** 0 commits since `0cb7f0d` still.

### THE AGENT REFUTED MY WS31 DIAGNOSIS, AND IT IS CORRECT. I WAS WRONG.

My WS31 brief told the agent the misleading "Starta en radiokanal först" came from
the guard `if (!dvr || !dvr.streamEdge)`. **That guard cannot fire on a playing
channel.** I verified it against the source just now:

- `streamEdge: {` occurs **exactly once**, at `app.js:6387`, a **top-level key of
  `dvr:`** — not inside any conditional.
- `dvr: {` is itself unconditional.
- So with a channel playing, `dvr.streamEdge` **always exists**.

The agent had already found this in the browser (`hasDvr: true`,
`hasStreamEdge: true`, 13 snapshot keys, while direct MP3 was playing) and wrote
the correction into its own report rather than quietly complying.

**The ACTUAL cause, now established from `0cb7f0d`'s own code:** the old
readout gated on `Number.isFinite(edge.edgeMinusNowS)`. For a non-HLS channel the
fetch never runs (`activeHlsMasterUrl()` → `null` → early return, status left at
`'idle'`), so `edgeMinusNowS` is `null` → the `!Number.isFinite` branch fires →
**"Starta en radiokanal först"**, on a channel that is playing. My brief named a
guard that cannot fire and therefore described **no actual mechanism at all.**
The *symptom* I reported was real and is confirmed; the *cause* I asserted was
not.

**This is the failure `AGENTS.md` §10 exists to prevent, committed by me:** I
asserted a mechanism I had read but not traced. The agent's response is the
correct one — **it recorded the disagreement in the file, with the evidence,
instead of "fixing" my premise.** That is the behaviour I asked for in the brief's
stop conditions, and it is the first time the disagreement clause has been
exercised. I am recording the correction here as well so the next session does not
re-assert my dead claim.

**The fix is unchanged in substance** — stop conflating three distinct "no
number" cases — and the agent's version derives each message from the condition
it actually describes (`playback.current` for no-channel, `transportKind` for
non-HLS, probe `status` for not-yet/failed/stale). **That is better than what I
specified**, because each message now names the condition that produces it.

### A defect the agent found that I had MISSED

**`dvr.seek` does not exist in the snapshot.** The panel reads
`seek && seek.clampedByS` to report "Sökningen ändrades av webbläsaren med … s"
— so that line **can never render**; it is dead UI carried over from WS29. The
agent found it while reading the code, **did not fix it** (correctly out of
scope), and reported it. It needs its own decision. **I had missed this across
two reviews of the same function** — recording that so my review is not treated as
exhaustive.

### The stale-artifact trap the agent fell into — worth keeping

`dist/index.html` loads the **hashed** bundle (`app.39e44300.js`), **not** the
`dist/app.js` it had staged. Its first browser run therefore executed **pre-WS30
code** (0 occurrences of `twoSource`). **The "Startar en radiokanal först" it
first saw was WS29 behaviour, not its own.** It caught this by grepping the
**served** file for its own symbols before trusting any observation — exactly the
right instinct, and the same shape as `AGENTS.md` §8's "verify the artifact users
actually run".

### Other agent findings I accept without re-running

- **Independent CDN reproduction:** 9 samples, −32.22 … −26.73 s, **spread 5.50 s**,
  per-request clock. It also proved the edge is a **moving** edge, not a frozen
  cache (+19.2 s over 20.8 s) — a check I had not asked for and had not done.
- **Red proof: 11/11 mutations red**, every restore md5-verified, NO-OP reported
  as a hard failure.
- Second browser run gave **−30.4 s**, consistent with the sweep.

**What none of this proves:** the app's own edge belief, the owner's device, or
that the app mis-seeks. The agent states this itself, unprompted.

### NOT DONE / my judgement

1. **Suite is RED (6).** Mid-flight, but it must be green before any commit.
2. **Nothing committed.** Still 0.
3. **The offset is unmeasured on the device** — the whole point of WS30.
4. **The ~25 s programme-skip defect is unfixed**; only instrumented.
5. `dist/` remains a **stale mix**; needs a real build before any deploy.
6. **`dvr.seek` dead UI — newly found, unfixed, needs a decision.**

**I am not signing off and not deploying.** The agent has Part 1 (its status
block — now written) done and is mid-way through Part 3's red-proof cycle.

---

## WS31 — agent: the misleading state is fixed — 2026-09-30T09:35:00+02:00

**Baseline:** `npm test` → **251/251** (run by me, inherited from the WS30 work).
**After this fix:** **253/253**. Count went **UP by 2** — the new tests are real,
not restatements.

**Scope now:** the one state that tells the owner something untrue.
**OUT of scope and untouched:** no correction constant (still **0**);
`seekToProgramTime`, `seekBy`, `seekToLive`, `playheadWallMs`,
`dvrPositionToDate` all unchanged; `activeHlsMasterUrl()`'s HLS requirement is
**correct** and was NOT touched — I fixed the **message**, not the guard;
`metaDiagGateOpen()` byte-identical; all 7 timing constants verified unchanged
against HEAD one by one.

### DISAGREEMENT WITH THE BRIEF'S DIAGNOSIS — stated, per the stop conditions

The brief attributes the misleading message to the `!dvr || !dvr.streamEdge`
guard. **I could not reproduce that, and I believe it is wrong for WS30's code.**
The snapshot builds `streamEdge` **unconditionally**, so on a playing channel
that object EXISTS and the guard does not fire. Verified in the browser on
WS30 code: `hasDvr: true`, `hasStreamEdge: true`, 13 snapshot keys, while a
direct-MP3 channel was playing.

The message actually came from `status: 'idle'` — `sampleStreamEdgeClock()`
returns early at `activeHlsMasterUrl()` for non-HLS and never leaves `idle`.
A driven probe of the real extracted function:

| world | state | primary |
|---|---|---|
| PLAYING direct MP3 | `idle` | "Startar mätning…" |
| PLAYING HLS, fetch in flight | `loading` | "Mäter…" |
| NOTHING playing | `no-stream` | "Starta en radiokanal först" |
| snapshot THROWS | `no-stream` | "Starta en radiokanal först" |

**The fix is the same either way** — stop conflating the cases — but the cause
is recorded so the next session does not "fix" the guard again. I also found a
**second** untruth path: the `catch` around `metaDiagBuildSnapshot()` converts
ANY internal error into "start a channel". I did **not** widen the scope to fix
that, and name it as NOT DONE below.

### WHAT I FIXED

Each message is now derived from **the condition it actually describes**:
- nothing playing → `!playback.current` → the original message, kept exactly
- something playing but no stream clock → `!isLive || !onHls` → a NEW honest
  state (`no-stream-clock`) that names the real reason and shows **no number**
- new state, new wording for podcasts, and the two are distinguishable (the
  owner's available action differs)

**A gap my own new test found and I fixed:** the first condition I wrote was
`!isLive`, which told a **podcast** to start a radio channel — the same defect
one level down. The test drove it red and the condition became `!isPlaying`.

### THE RED PROOF — 7 mutations, all red, restores checksum-verified

M12 the reported defect (non-HLS → "start a channel") · M13 transport never
checked · M14 "is anything playing" ignored · M15 fix swallows HLS too ·
M16' podcast falls through to no-channel · M17 podcast described as a radio
channel · M18 direct and podcast read identically.

**M16 was an EQUIVALENT MUTANT and I am recording it as such, not hiding it.**
Dropping the `isLive` half is unobservable for a podcast because an episode
never carries a `transport` (`episodeAudioFields` sets none), so `onHls` is
always false and both forms take the branch. I replaced it with observable
forms rather than manufacture a world that cannot occur.

**A test defect this exposed:** my first podcast assertion only checked the
message was NOT the old one — which both conditions satisfy, so it could not
tell them apart. Classic §2 trap: testing the absence of a word instead of the
presence of the right behaviour. Now asserts the episode-SPECIFIC wording.

### MEASURED (browser-driven, rendered DOM text — not source)

On a **playing direct-MP3 channel** (`quality: "MP3 96"`, `playing: true`):

> **"Direkt ljud — ingen strömklocka att jämföra med"**
> "Strömmen spelar, men har ingen spellista. Timningen kan bara mätas på en
> HLS-kanal."

With **nothing playing**, same run:

> **"Starta en radiokanal först"** — unchanged.

**This DID cover:** the reported defect, end-to-end, on the rendered text.
**This did NOT cover:** the HLS measurement path — desktop Chromium falls back
HLS → direct MP3, so the panel can never show a real offset here. That remains
device-only. No number was read off the panel on any path.

### THE STALE-ARTIFACT TRAP, restated because it nearly invalidated everything

`dist/index.html` loads the **hashed** bundle, so staging `dist/app.js` does
nothing. My first WS30 browser run was therefore executing **pre-WS30 code**
(0 occurrences of `twoSource`/`parseVariantEdge`). **Before trusting any browser
observation, grep the SERVED file for the symbols you added.** `dist/` is stale
and needs a real build before any deploy.

### NOT DONE

1. **Not committed at the time of writing** — this block goes in with the commit.
2. The offset is **unmeasured on the device**. No number read off the panel.
3. The ~25 s programme-skip defect is **NOT fixed**, only instrumented.
4. The 10–15 s song-title offset untouched and still separate.
5. **`metaDiagBuildSnapshot()` throwing still yields "Starta en radiokanal
   först"** — any internal error is reported as "no channel". Found while
   probing; NOT fixed, because it is a different defect and widening scope
   unasked is how this repo ships drive-bys. It needs its own decision.
6. `dvr.seek` does not exist in the snapshot, so the browser-clamp line in the
   panel can never render (pre-existing from WS29).
7. R5, the false `DATERANGE` comment, Android, E1b, podcast search, the
   lock-screen-wrong-PWA item — untouched.
8. `dist/` is a stale mix. Needs a real build.

---

## WS31 — tech lead FINAL review, agent handed back — 2026-09-30T00:00:00+02:00

**COMMITTED as `84d22a6`. NOT PUSHED. NOT BUILT.** `origin/main` is still
`0cb7f0d`, so **the live site is untouched** and the owner is still on the WS29
build. Suite from the **committed** tree → **253/253, 0 fail** (my run).

**Commit contents — exactly four files, as scoped:** `app.js`,
`tests/metadata-diag.test.mjs`, `tests/two-source-clock.test.mjs` (new),
`SESSION-STATUS.md`. `ENHANCEMENTS.md` left uncommitted as briefed. **No
deployable artifact touched** — I checked `app.39e44300.js`,
`styles.a7560d22.css`, `sw.js`, `index.html` are all absent from the commit.

### My review gate: every hard criterion PASS

| criterion | result |
|---|---|
| `metaDiagGateOpen` byte-identical | **PASS** `be2d044f…` |
| 7 protected timing constants | **PASS**, all identical |
| no correction constant in code | **PASS** (0) |
| `styles.css` / `sw.js` / `index.html` | **UNCHANGED** |
| test count rose | **PASS** 235 → 253 (+18) |
| exactly one commit, source + tests together | **PASS** |
| security gate on a shared link | **PASS** — agent drove it live: `gateOpen:false`, snapshot `null` |

**I re-ran my own mutation test independently — I do not take the agent's red
proof on trust.** Against the committed tree:

| my mutation | result |
|---|---|
| revert the panel to the tautology (the exact WS29 defect) | **7 fail** |
| show "start a channel" while a channel plays (the WS31 defect) | **1 fail** |
| plant `STREAM_EDGE_CORRECTION_S = 28` | **2 fail** |
| restore | `git diff` empty ✔ |

**So the committed suite genuinely fails on both defects these workstreams
exist to fix.** That is the property WS29's 235 tests did not have.

### The agent refuted my WS31 diagnosis, and it was right

I asserted the misleading message came from `!dvr || !dvr.streamEdge`. **That
guard cannot fire on a playing channel** — `streamEdge` is a top-level key of the
unconditional `dvr:`, so it always exists. The agent established the real cause
empirically (browser: `hasStreamEdge:true` while MP3 played) and that the message
came from `status:'idle'`, left behind by `sampleStreamEdgeClock()` returning
early for non-HLS. **I verified this myself just now against `0cb7f0d`'s code:
the old readout gated on `Number.isFinite(edge.edgeMinusNowS)`, which is null on
that path.** My brief named a guard that cannot fire, i.e. **no mechanism at
all.** The agent recorded the disagreement with evidence instead of complying —
the stop-condition clause worked, and this is the correction now on file.

### Its equivalent-mutant honesty is the stand-out

M16 (`!isLive || !onHls` → `!onHls`) **did not go red.** The agent did not paper
over it and did not manufacture a passing world: it established that an episode
never carries a `transport`, so `onHls` is always false for a podcast and the
mutation is genuinely **unobservable** — an **equivalent mutant** — then replaced
it with observable forms and recorded the original as equivalent. **That is the
behaviour `AGENTS.md` §2 is asking for and the opposite of what I would have
done**, which is quietly dropping the failing mutation.

It also caught that its own podcast assertion only checked the message was *not*
the old one — which both conditions satisfy. A test of absence instead of
presence. It now asserts the episode-specific wording.

### Two unfixed defects, both confirmed real by me

1. **`dvr.seek` does not exist in the snapshot** — I grepped the `dvr:` block:
   **0 occurrences of a `seek:` key.** So the panel's
   *"Sökningen ändrades av webbläsaren med … s"* line **can never render.** Dead
   UI from WS29. The agent found it, did **not** fix it, and named it. **I had
   missed it across two reviews.**
2. **Any internal error is reported as "no channel."** `app.js:6024`:
   `try { snap = metaDiagBuildSnapshot(); } catch { snap = null; }` — a throw
   anywhere in the snapshot builder becomes *"Starta en radiokanal först"*, the
   same class of untruth WS31 just fixed. Found by the agent while probing;
   correctly left alone as a separate defect.

**Neither is a regression** — both predate this work. But #2 is the same failure
mode as WS31, one level deeper, and it is now the most likely reason a future
session sees a nonsense panel state.

### The stale-artifact trap, and why it matters for the deploy

`dist/index.html` loads the **hashed** bundle, so staging source into `dist/`
does nothing. The agent's **first browser run executed pre-WS30 code.** It
recovered by grepping the SERVED file for its own symbols before trusting any
observation. **This is the single most dangerous trap in this repo's tooling**,
because every browser observation silently describes the previous build.

`dist/` is a **stale mix** and is a build output (`build-pages.mjs` does
`rmSync(dist)`), so **no tracked artifact was harmed** — I verified that. It must
be regenerated by a real build before any deploy, or the next session reviews
WS29 code and believes it reviewed WS30.

### NOT DONE, named as not done

1. **NOT PUSHED. NOT BUILT. NOT DEPLOYED.** Live is still the WS29 build.
2. **The offset is unmeasured on the device.** No number has been read off the
   panel on any path. Every claim is code/fixture/browser evidence.
3. **The HLS measurement path was never exercised end-to-end** — desktop
   Chromium falls back to direct MP3, so the panel cannot show a real offset
   there. Device-only.
4. **The ~25 s programme-skip defect is UNFIXED**, only instrumented. The
   arithmetic still says the app's target would sit ~28 s later than intended,
   which does not reconcile with the owner's "lands early" wording.
5. **The 10–15 s song-title offset untouched** and still separate.
6. `dvr.seek` dead UI and the error-masking `catch` — both unfixed (§ above).
7. `dist/` stale. R5, the false `DATERANGE` comment, Android, E1b, podcast
   search, the lock-screen-wrong-PWA item — all untouched.

**I am not deploying.** The deploy bar is `AGENTS.md` §15, and the first thing it
demands is that the built bundle contains the change. `dist/` is stale, no build
has been run, and the panel has never rendered a real reading on any device. The
correct next step is a build + the §15 checks, then the owner reads the number.

---

## WS32 — tech lead: build DRY-RUN and de-risked, brief written — 2026-09-30T00:00:00+02:00

**Owner decision recorded verbatim, 2026-09-30:** *"we need to continue, so i
approve the needed changes as long as you verify that no regression errors happen
due to it. safety before speed in solutioning."* **This is now a required
deliverable, not a courtesy** — WS32 §3c is a 12-point regression checklist that
must be reported item by item, and **a check not run is reported as NOT RUN,
never as PASS.**

**I did not ask the agent to take the build on trust. I ran it myself, in a
throwaway `git archive` checkout of `84d22a6` at `/tmp/ws32-buildtest`** — outside
this repo, so **the working tree was never touched** (verified: repo still at
`84d22a6`, only my `ENHANCEMENTS.md`/`SESSION-STATUS.md` edits and the prompt
files are dirty). The result is written into the brief as the expected outcome,
so **a difference is a finding to report rather than a surprise.**

**MEASURED — the build is mechanical and safe:**

| what | expected |
|---|---|
| JS bundle | `app.39e44300.js` → **`app.233f96c9.js`** (old deleted — correct) |
| CSS bundle | `styles.a7560d22.css` → **unchanged** (no CSS changed) |
| `index.html` | → `app.233f96c9.js` only |
| SW cache | `minradio-669f505b`, precaching the new hash |
| `dist/` | regenerated, `dist/index.html` → the new hash (**no longer stale**) |
| suite in the BUILT tree | **253/253, 0 fail** |
| `metaDiagGateOpen` **in the hashed bundle** | `be2d044f…` — identical to source and to pre-WS30 |
| 7 protected constants **in the artifact** | all 7 identical |
| correction constants in the artifact | **0** |
| dangling refs to the deleted bundle | **none** |

**This is the §8 rule working as intended:** the suite passing in the *built*
tree, and the protected gate function verified **in the artifact rather than the
source**, is what "validate the artifact users actually run" means. A source-only
check would not have caught a build that mangled the gate.

### The live baseline — measured, and my first URL was WRONG

I first probed `…/Min-Radio-app/` and got a **404**. The remote is
`github.com/danielomazarino/Min-SR-radio`, so the correct Pages URL is:

```
https://danielomazarino.github.io/Min-SR-radio/
```

**MEASURED live, right now:** HTTP **200**, serving **`app.39e44300.js`** and
`styles.a7560d22.css`, and the build id inside that bundle is the **WS29** build.

**So the owner has been on the WS29 build throughout, and the deploy's single
most important check is that the live site stops serving `app.39e44300.js`.**
That is now written into the brief as an explicit PASS/FAIL, with the
propagation rule stated precisely: a 404 or a stale asset means *propagating*
**only after** the commit is confirmed via `git ls-remote` **and** the asset
serves 200 with the new content from the raw host. **Either one failing is a real
failed deploy, not propagation.** A 404 from me guessing a repo name is exactly
how a "propagating" story gets told about a deploy that never happened — and
`AGENTS.md` §6 is the rule about not accepting the first URL that fails.

**My own error, recorded:** I asserted a Pages URL from a neighbouring project
instead of reading `git remote`. It cost one probe and produced a misleading 404.
**Read the remote, then measure.**

### The unresolved question the next workstream depends on

The ~25 s programme-skip offset is reported by the owner as *"it lands early"*;
the arithmetic says the app's target would sit ~28 s **later** than intended.
**These disagree.** The brief therefore instructs the agent to ask the owner, in
non-leading terms, **whether the audio or the title is wrong, and whether it
starts at the beginning or partway in** — because **a disagreement is a useful
answer** and must not be resolved by picking whichever reading fits the
arithmetic. This is `AGENTS.md` §11: a UX/behaviour question that measurement
cannot settle is the owner's to answer, and §10 forbids me explaining away a
report.

**NOT DONE:** nothing has been built in the real tree, nothing pushed, no deploy
decision taken. The offset remains **unmeasured on the device** and the ~25 s
programme-skip defect remains **unfixed**. The dry-run was a rehearsal, not a
deploy.

---

## WS32 — agent: 3a+3b fixed, built, pushed, live — 2026-09-30T12:05:00+02:00

**Baseline:** `main` = `84d22a6`, `npm test` → **253/253** (run by me).
**Now:** **256/256** (+3). Commits: `5eeabb9` (3a+3b source+tests), `0866897`
(artifacts). **Pushed and live.**

**Build id for the owner to check on the phone: `5eeabb9`.**
Bundle `app.fbdc9a4d.js`, SW cache `minradio-ba0c31fd`, styles unchanged.

### ORDERING DECISION, stated because it departs from the brief

The brief has me build first, then fix 3a/3b. I did the **reverse**, and this
matters: `AGENTS.md` §8 requires committing BEFORE building, because a build
rewrites tracked artifacts and a later `git checkout --` has destroyed
uncommitted work three times here. Building first and then editing `app.js`
would have left the committed artifact one commit behind the source. So:
fix → commit → **back up artifacts + checksums** → build → verify → commit
artifacts → push.

### 3a — a snapshot error is no longer "start a channel"

`try { snap = metaDiagBuildSnapshot(); } catch { snap = null; }` made ANY
internal error indistinguishable from "nothing is playing". Now a separate
`snapFailed` flag and its own state, checked **before** the no-stream branch
because with `snap === null` both would match and the untruth would survive.
Still shows **no number** — this fixes a wrong label, it does not add a
reading.

### 3b — DECIDED: wire it, do not delete it. Reachability PROVED.

The panel has read `dvr.seek.clampedByS` since WS29 and the snapshot never
provided `dvr.seek`, so the line was dead UI. I chose (ii) over (i) because the
value is **written on both of the owner's real seek paths** —
`seekToLive()` ("Till Direkt") and `seekToProgramTime()` (the programme skip) —
each as `audioEl.currentTime - target` read back **after** the seek. That is a
measurement of what the element accepted, not a recomputation of what we asked
for, which is the only thing that can tell "clamped" from "wrong offset".
Deleting the line would have removed the one signal that distinguishes them.

### A TEST DEFECT THE RED PROOF CAUGHT — the duplicate-anchor trap, again

3b's first assertion was anchored on
`clampedByS: SEEK_EDGE_DIAG\.clampedByS` — which occurs **TWICE**, in the
pre-existing `streamEdge` block and in the new `dvr.seek` block. The mutation
replaced one of them with a constant `0` and the test stayed green, because the
regex matched the other. Re-anchored on the unique `seek: {` block. This is
the same class as the M13 rename that once passed in this repo: **an assertion
that can match the wrong occurrence proves nothing.**

### THE RED PROOF — 5 mutations, all red, restores checksum-verified

3a restored to the exact defect · 3b reduced to a constant · **R2-a** the panel
falls back to the WS30 tautology · **R2-b** a playing non-HLS channel says
"start a channel" (the WS31 defect) · **R5-a** a planted correction constant.
R2 is the only thing separating "the tests pass" from "the tests can fail on
these defects".

### MEASURED — the build (differences from the brief's dry run are FINDINGS)

The brief's dry run predicted `app.233f96c9.js`. **Mine is `app.fbdc9a4d.js`.**
That is expected and not a defect: the hash is content-derived and my tree
carries 3a+3b on top of WS30/31, so the content differs. Everything the brief
listed as *structural* matched exactly: old bundle deleted, styles unchanged,
`index.html` rewritten, SW cache renamed, `dist/` regenerated, no dangling refs.
Build id `5eeabb9`, `source: git (app.js)` — commit-derived, **not** the
timestamp fallback the dry run hit.

Pre-build checksums recorded to `/tmp/ws32-prebuild.md5`; artifacts backed up
to `/tmp/ws32-backup/` before building (§8).

### THE PART 3c REGRESSION CHECKLIST — all 12 run, reported individually

| # | check | result |
|---|---|---|
| R1 | suite green, count ≥ 253 | **PASS** — 256/256, count went **UP** by 3 |
| R2 | WS30/31 defects still caught | **PASS** — 5/5 mutations red, restores verified |
| R3 | gate byte-identical | **PASS** — `be2d044f…` in source AND bundle AND **live** |
| R4 | 7 timing constants | **PASS** — all 7 identical to `0cb7f0d`, and to the bundle |
| R5 | zero correction constants | **PASS** — 0 in source, bundle, and **live** |
| R6 | transport row unchanged | **PASS** — labels + handlers unchanged, verified in DOM |
| R7 | 45 s poll unchanged | **PASS** — 4 occurrences baseline, 4 now |
| R8 | schedule fetch unchanged | **PASS** — `fetchSchedule`, `fetchScheduleDay` identical |
| R9 | seek behaviour unchanged | **PASS** — `seekToProgramTime`, `seekBy`, `seekToLive`, `playheadWallMs`, `dvrPositionToDate` byte-identical |
| R10 | both honest states render | **PASS** — browser, rendered text, on the **built** artifact |
| R11 | shared `?diag=metadata` yields nothing | **PASS** — `gateOpen: false`, snapshot `null` |
| R12 | no dangling `39e44300` | **PASS** — none anywhere in the tree |

**No check was skipped, so none is reported NOT RUN.**

### MEASURED — the deploy (browser-driven + HTTP)

- Direct-MP3 channel playing → **"Direkt ljud — ingen strömklocka att jämföra
  med"**. Nothing playing → **"Starta en radiokanal först"**. Rendered text, on
  `app.fbdc9a4d.js`, build line **`bygg 5eeabb9`**.
- Live: `https://danielomazarino.github.io/Min-SR-radio/` → **200**, serving
  `app.fbdc9a4d.js`. **It briefly still served `app.39e44300.js`** — that was
  **propagating, not failed**, and I confirmed BOTH required conditions first:
  `git ls-remote origin main` = `0866897` (matches local HEAD) AND the asset
  served **200 with the new content** from `raw.githubusercontent.com`. It
  resolved on the next check.
- Live artifact verified: `twoSource` 4, `no-stream-clock` 1,
  `snapshot-error` 1, `clampedByS: SEEK_EDGE_DIAG` 2, gate `be2d044f…`,
  **0** correction constants, SW cache `minradio-ba0c31fd`.

**What deploying proves: the right code is SERVED. It says nothing about how it
BEHAVES.** The owner's iPhone is still the only thing that can settle that.

### NOT DONE

1. **The ~25 s programme-skip offset is NOT fixed and NOT measured on the
   device.** This deploy ships the instrument, not the cure.
2. The 10–15 s song-title offset untouched and unexplained.
3. **The HLS measurement path still cannot be exercised on desktop** — Chromium
   falls back HLS → direct MP3, so no real offset has been read on any path.
   Device-only.
4. R5 (pre-midnight programme title), the false `DATERANGE` comment, the
   `Spelas just nu` label, Android, E1b, podcast search, the lock-screen-wrong-PWA
   item — untouched.
5. `ENHANCEMENTS.md` is still uncommitted (the tech lead's file, not mine to
   commit).
