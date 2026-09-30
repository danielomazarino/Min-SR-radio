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

---

## WS33 — tech lead: a device session is NOT next. A defect is. — 2026-09-30T14:00:00+02:00

**Baseline MEASURED by me, not copied:** `npm test` → **256/256, 0 fail** at
`02e27c4`. Working tree: clean of source; `WS33-PROMPT.md` untracked (by
design — `.gitignore` has `WS2*.md`; the owner drags the brief by hand).
`AGENTS.md` §12 and `.github/instructions/min-radio.instructions.md` **edited
by me this session** (documentation, no code).

**I had proposed a device measurement session as WS33. That was wrong, and
I am recording why rather than quietly replacing it.** Writing the device
protocol, I transcribed the two expressions the whole offset story rests on and
checked them against each other. They do not agree. **The panel is not measuring
a clock offset** — so a device reading would have been taken with an instrument
I already knew was broken, and the number would have been uninterpretable.

### FINDING — `offsetS` is the playhead's distance from the live edge, not a clock bias

Three expressions, transcribed from the current `app.js`:

1. `streamEdgeWallMs()` → `Date.now() - (end - currentTime) * 1000`
2. `updateSeekableState()` → `distanceFromLiveEdge = max(0, end - currentTime)`
3. `sampleStreamEdgeClock()` → `offsetS = (appEdgeWallMs - trueEdgeWallMs) / 1000`

Substituting (1) into (3), **`currentTime` does not cancel.** It survives as
`-distanceFromLiveEdge`, so:

> `offsetS_shown = clockBias − distanceFromLiveEdge`

**MEASURED by arithmetic, with a PERFECT clock (zero bias):**

| playhead behind live | panel reads | true clock bias |
|---|---|---|
| 0 s | `0.0 s` | `0.0 s` |
| 10 s | `−10.0 s` | `0.0 s` |
| 600 s | `−600.0 s` | `0.0 s` |
| 1800 s | `−1800.0 s` | `0.0 s` |

**State what would have made this table come out differently** (`AGENTS.md` §2):
if the `currentTime` term cancelled, **every row reads `0.0 s`**. It does not.
The table can fail.

**What this does NOT prove:** anything about the owner's iPhone, and it does not
prove the app mis-seeks. It is arithmetic over the app's own expressions.

**This is WS30's defect class, in WS30's own fix.** WS29's `edgeMinusNowS`
cancelled to `distanceFromLiveEdge`. WS30 removed the `Date.now()` cancellation
but kept the `currentTime` term, so the field is *still* reading the playhead —
it now merely adds a clock term to it. **Two sources, but one is not a clock.**

### The consequence that made this urgent rather than tidy

**The instrument is only valid at the live edge, and nothing on screen says
so.** My WS30 desktop probe read −24.4 … −32.6 s — taken **at the live edge**,
where the contamination is zero. A reading taken while scrubbed back 30 minutes
reads about `−1800 s`. **The two numbers are not comparable, and an owner
comparing them would conclude the bias is 60× larger than it is.**

**And the correct quantity also predicts the seek.** Transcribing
`seekToProgramTime`'s target, the landing error is **independent of playhead
position** (`−clockBias`, because `seekableEnd` cancels), whereas the panel's
number is not. One reading would be valid anywhere on the timeline. **I have
asked the agent to verify that independence itself** — if it does not hold, that
is a bigger finding than this fix.

### Also found, and NOT acted on: `playheadWallMs` and `streamEdgeWallMs` are near-duplicates

Identical bodies; one returns `Date.now()` on no-window, the other `null`. **I
did not touch it.** It is on the brief's out-of-scope list with the reason, so a
future pass treats it as a decision to argue rather than an obvious cleanup.

### What I shipped this session

1. **`AGENTS.md` §12 corrected.** R5's *"correct but unreachable"* and R6's
   *"this is the next fix (WS27)"* were both **stale and wrong**. Verified: R6's
   fix line is present; R5 has a reachable path (`updateSeekableState`, the
   `lastWindowGateKey` block).
2. **`.github/instructions/min-radio.instructions.md` corrected — and this one
   mattered more.** It is the **auto-discovered** copy the coding agent's chat
   loads automatically, and it still said R1/R2/R3/R5/R6 **failing** /
   **regressed**. Fixing `AGENTS.md` alone would have left the agent reading a
   table that says the product is broken. **The two files drift independently;
   any future edit to the requirements table must change both.**
3. **`WS33-PROMPT.md` written.** Scope is one behavioural change, no correction
   constant, reachability to be proved, ≥4 mutations, and an explicit warning
   that a sign/wording test **cannot** fail on this defect — only an
   position-independence invariant can.

**NOT DONE, named as not done:**

1. **No source changed. No build, no push, no deploy decision.** Nothing has
   been committed this session.
2. **The device session is DEFERRED, not cancelled.** It is still the next thing
   after WS33 — but on a *correct* instrument. Asking the owner to read a number
   off a panel I now know is wrong would have wasted their time and produced a
   reading that cannot be interpreted.
3. **The ~25 s programme-skip defect is still unfixed and its DIRECTION is
   still unestablished.** The arithmetic says the skip lands ~25 s *into* the
   programme; the owner reported "lands early". §8 of the brief puts that
   question to the owner rather than resolving it.
4. **The 10–15 s song-title offset is untouched** and is a separate mechanism
   the owner has already said is different.
5. **I have not re-derived whether the contaminated field affected any
   shipped conclusion.** WS30/31/32 reports quote `offsetS` readings; if any
   were taken behind live, they are void. **This is the next thing to check and
   I have not done it.**
6. R5, the false `DATERANGE` comment, `Spelas just nu`, Android, E1b, podcast
   search, the lock-screen-wrong-PWA item — all untouched.

---

## WS33 — the owner's answer arrived. The DIRECTION is now established. — 2026-09-30T15:30:00+02:00

**The owner answered the §8 question (verbatim):**
> "the audio starts immediately"
> "Just the sound is of circa 25 seconds (i have not measured with a watch, just
> counted in my head while waiting for the correct programme to start playing)"

**WS33 is already sent to the coding agent and in flight. I have NOT edited
`WS33-PROMPT.md` since it was handed over** — changing a brief under a running
agent is how the two diverge silently. This block is the record for **WS34**.

### The direction is established, and I HAD THE SIGN BACKWARDS

The owner says the audio **starts immediately** and the real programme begins
**~25 s later**. So the app lands **BEFORE** the programme starts — it plays
material that is *earlier* than the programme they asked for.

Arithmetic over `seekToProgramTime` (`target = end - (Date.now() - startMs)/1000`),
transcribed verbatim, `seekError = −clockBias`:

| device clock vs the stream | lands |
|---|---|
| 25 s **behind** | 25 s **into** the programme (skips too little) |
| 25 s **ahead** | 25 s **before** it ← **matches the owner** |

**So the owner's iPhone clock reads ~25 s AHEAD of the stream's clock.**

### The "disagreement" was never a disagreement — it was two devices

My desktop probe measured `now − trueEdge` = **−24.4 … −32.6 s** (my clock
BEHIND). The owner's device implies **+25 s** (AHEAD). **Opposite signs, on
different machines.** Both can be true at once, and this is why I refused to
pick a side that fitted the arithmetic (`AGENTS.md` §10, §11).

**This is the most important thing in this block, and it invalidates the shape
of the fix I had been assuming.** A correction constant is not merely
disallowed on principle (§5) — it is now **demonstrably wrong**, because the
same app would need `−25` on one device and `+25` on another. The earlier
"the bias drifts ~5.5 s over minutes" was measured **on one desktop** and is
not evidence about any other device.

**Consequence for WS34:** the correction cannot be a number at all. It must be
computed **per sample, on the device, from the two clocks** — which is precisely
what the corrected panel measures. That is an argument for WS33's fix being a
prerequisite, not merely an improvement.

### What is now established, and what is not

| | status |
|---|---|
| The skip lands **before** the programme | **owner-confirmed on device** (first device-confirmed DVR finding in this repo) |
| The cause is the **device clock vs the stream clock** | **code-proven by arithmetic**, and now agrees with the owner's direction |
| The magnitude | **~25 s, owner-estimated by counting, not measured.** Treat as one observation. |
| The bias is **device-specific** | **new, from the two readings disagreeing in sign** |
| Whether a seek *can* land before the buffer starts | **not examined.** `seekToProgramTime` clamps only `target < start`; a target before the programme is not clamped. **Unchecked — and it is the next thing to look at.** |

### MEASURED, and what it does NOT prove

The two rows above are **arithmetic over the app's own expressions**, run with a
synthetic clock error. They are not a device measurement. **The owner's ~25 s is
an estimate made while waiting, not a stopwatch reading** — and I am recording
it as an estimate, because writing "25 s measured" would freeze one sample into
a constant, which is the exact failure `AGENTS.md` §5 exists to prevent.

**NOT DONE:** no source changed. Nothing built, pushed or deployed. WS33 is in
flight and unreviewed. **The seek fix itself is still unwritten** and must not
be written until WS33's corrected instrument has produced a real device number.
R5, `Spelas just nu`, Android, E1b, podcast search, lock-screen-wrong-PWA — all
untouched.

---

## WS33 — tech lead REVIEW, agent handed back — 2026-09-30T16:10:00+02:00

**The agent has NOT written a status block of its own.** `SESSION-STATUS.md` holds
only my five. **That is the AC11 contract failure again** (`AGENTS.md` §13, brief
AC11) — and its evidence currently exists only in a chat transcript. **The
technical work is good and I am recording that separately from the process gap.**

**MEASURED by me, not copied:** `npm test` → **260/260, 0 fail** (was 256, **+4**).
`HEAD` still `02e27c4`. **Nothing committed.** `app.js` +122/−27,
`tests/two-source-clock.test.mjs` +321.

### My objective gates: PASS on every one

| gate | result |
|---|---|
| `metaDiagGateOpen` byte-identical | **PASS** `be2d044f…` — unchanged from the WS30 baseline |
| all 7 timing constants | **PASS**, all identical |
| correction constants in **code** | **PASS** (0 — checked with comments stripped, not a naive grep) |
| `styles.css` / `index.html` / `sw.js` | **UNCHANGED** |
| test count rose | **PASS** 256 → 260 |

### The change is exactly the scope the brief allowed

`offsetS = (deviceNow − trueEdge)/1000`. Both operands are wall clocks; **neither
contains `currentTime`.** `deviceNowMs` is a new field so the subtraction is
checkable by hand from the snapshot.

**Two decisions it made that I did not specify, both defensible:**

1. **It removed the `no-seekable-range` guard entirely.** That guard existed
   *only* because the old operand was built from `seekableEnd`. Keeping it would
   report a reason that can no longer be true — "could not read the stream's
   clock" while holding a perfectly good one. **Correct, and the same untruth
   WS31 fixed one level up.** I verified the WS31 panel gating is intact and
   independent.
2. **It kept `appEdgeWallMs` and labelled it a trap.** It is playhead-dependent,
   so subtracting it from `deviceNowMs` rebuilds this exact bug. The agent kept
   it for WS23 continuity and wrote a `note` warning future sessions. **Better
   than deleting it**, which would have broken WS23-era readers.

It also added the playhead distance to the panel **under its own label**,
`dvrOffsetLabel`, in the *secondary* line — using the player's own formatter so
the two cannot drift. It reasoned about placement: putting it in the same string
as the offset is how WS30 happened. **It accepted my recommendation and argued
for it, which is what I asked for.**

### I mutation-tested the new tests myself — 3 mutations, all red, restores checksum-verified

| mutation | result |
|---|---|
| M1 restore the **old contaminated operand** | **3 fail** (252, 257, 258) |
| M2 substitute the app's belief for the device clock | **3 fail** — *including* the no-correction-constant guard |
| M3 plant `+ 28000` as a "correction" | **2 fail** (257, 258) |

Every restore verified by md5 against the pre-mutation file. **NO-OP: none.**

**The invariant test is the best test in this repo.** It **extracts** the sample
block from `app.js` rather than retyping it (§7), injects
`streamEdgeWallMs()` **with a playhead-dependent value** so the contamination is
live, and holds the clock **perfect** so only the playhead can move the result.
It has a **canary**. And it states the user-visible failure: *"the owner scrubs
back 30 minutes, reads '1800 s efter strömmens', concludes their clock is half an
hour slow."*

**It even names its own weakness** — that "the two agree" could pass with both
wrong — and pins the absolute value to close it. I did not ask for that.

### Why this could not have shipped broken

M1 is the decisive one: restoring the WS30 formula **fails 3 tests.** WS30's own
suite passed on the contaminated code, because it asserted *sign* and *wording*,
both of which are perfectly correct for a wrong number. **This suite asserts the
invariant instead, and that is the whole difference.**

### The two caveats I will not let pass

1. **NOTHING IS COMMITTED.** Source and tests are uncommitted.
2. **The offset is still unmeasured on the owner's device, and the seek fix is
   still unwritten.** This ships a correct instrument. No correction constant —
   correct, since the owner's `+25` and my `−25` prove a constant is device-specific.

**NOT DONE:** no build, no push, no deploy decision. I have not reviewed the
agent's own status report **because there is not one**.

---

## WS33 — coding agent — 2026-09-30T19:40:00+02:00

**Started / baseline:** `npm test` run by me → **256/256 pass** (my own run, not
copied from the brief). Working tree had only docs modified.

**Scope now:** exactly one behavioural change — make `offsetS` a pure clock
comparison. **OUT of scope and untouched:** `seekToProgramTime`, `seekBy`,
`seekToLive`, `playheadWallMs`, `distanceFromLiveEdge`, `atLiveEdge`,
`dvrAvailable`, `updateSeekableState`, all 7 timing constants,
`metaDiagGateOpen()`, the `Spelas just nu` label, R5, `styles.css`, `index.html`,
`sw.js`.

**Test count:** 256 → **260**.

**CODE CHANGE** — `app.js`, three places:
1. `sampleStreamEdgeClock()` — the first operand of the subtraction changed from
   `streamEdgeWallMs()` to `const deviceNow = Date.now()`. The assignment is now
   `offsetS = (deviceNow - trueEdge) / 1000`.
2. `STREAM_EDGE_PROBE` — added `deviceNowMs`; `appEdgeWallMs` kept but
   documented as NOT an operand.
3. `metaDiagReadoutLines()` — added the playhead distance to the **secondary**
   line under its own label (the decision the brief left to me — see below).

Also **not changed**: `playheadWallMs`, `streamEdgeWallMs` (both still used by
`dvrPositionToDate`/seek paths), `seekToProgramTime`, any transport code.

**Decision — the playhead distance is KEPT, shown separately.** It is real
information ("where am I") and a different question from "is my clock wrong".
It goes in the secondary line joined by `' · '`, using the app's own existing
`dvrOffsetLabel()` — the same formatter as the player pill — so it reads
"Spelar −30 min från direktsändningen". It is never inside the primary
sentence. That placement IS the decision: WS30/WS33's defect was a real
quantity wearing the wrong label, and merging them into one string is how that
happened. Omitted below 60 s so it can never render a "−0 min" that reads like
an offset.

**A CONSEQUENCE I CHOSE DELIBERATELY, and it removes a guard.** The old code
required a finite `seekableEnd` and reported `error: 'no-seekable-range'`
without one. That guard existed ONLY because the app's operand was built from
`seekableEnd`. The new comparison does not read it, so keeping the guard would
report a reason that can no longer be true — a panel saying "could not read the
stream's clock" while holding a perfectly good one, which is the same untruth
WS31 fixed one level up. **It is removed and not replaced.** If the tech lead
disagrees, this is the one decision to review.

**MEASURED — the defect, by arithmetic over the app's own three expressions.**
With a PERFECT device clock (`trueEdge === Date.now()`, bias 0):

| playhead behind live | panel read (before) | panel reads (after) | true bias |
|---|---|---|---|
| 0 s | `0.0 s` | `0.0 s` | `0.0 s` |
| 10 s | `−10.0 s` | `0.0 s` | `0.0 s` |
| 600 s | `−600.0 s` | `0.0 s` | `0.0 s` |
| 1800 s | `−1800.0 s` | `0.0 s` | `0.0 s` |

**What result would have made this table come out differently (AGENTS.md §2):**
if the `currentTime` term cancelled, every row would read `0.0 s` — which is
exactly the "after" column. It does not cancel, because
`appEdge = Date.now() − (end − currentTime)·1000` and only the `Date.now()`
cancels; `currentTime` survives as `−distanceFromLiveEdge`.

**AC3 — the seek-error independence claim HOLDS.** `target − p_correct =
−offsetS_true` at every position, because `end` is on both sides. Checked
arithmetically at 3 start times × 3 playhead positions; a +25 s fast clock
lands 25 s early everywhere. This is a property of the formula, now asserted
rather than asserted-in-a-comment.

**MEASURED — browser, driven on the served file.** I served my code from
`/tmp` (the repo's `index.html` loads the **hashed** `app.fbdc9a4d.js`, which is
PRE-change — `grep` confirms `deviceNow` count 0 in it, and the build is the
tech lead's step, not mine).
- **Verified I was running my own code:** served `/app.js` contains
  `offsetS = (deviceNow - trueEdge) / 1000` (20 `deviceNow` occurrences) and NOT
  the old formula. Checked before believing anything.
- Drove: onboarding → picked P2 → played it → cog → sheet → "Info" → diag on.
- **Read back from the RENDERED DOM** (not source):
  `readoutText: "Direkt ljud — ingen strömklocka att jämföra med"`,
  `noteText: "Strömmen spelar, men har ingen spellista. …"`,
  `anyDigits: false` — **no number rendered in the non-numeric state.**
- Snapshot ground truth: `transport: "direct"`, `twoStatus: "idle"`,
  `offsetS: null`, `deviceNowMs: null`.
- Reachability: `diagVisible: true`, `switchPressed: "true"`, readout repainted
  over 3 s → the paint interval is live.

**WHAT THE BROWSER RUN DID NOT COVER — stated plainly.** Chromium fell back to
**direct MP3** (`MP3 96`), so `activeHlsMasterUrl()` returns null, the sample
never runs, and **the real two-source comparison was NOT exercised end-to-end
there**. I am not presenting the `no-stream-clock` state as verification of the
offset. The offset's behaviour on a real HLS stream is **code-proven and
fixture-proven only**. Per `AGENTS.md` §14, a fallback is not a verification.

**Mutations run — 4, ALL RED, restored by checksum. No NO-OP.**
| # | mutation | result |
|---|---|---|
| M1 | restore the WS30 contaminated formula | RED ×3 (252, 257, 258) |
| M2 | strip the clock term entirely | RED ×3 (252, 257, 258) |
| M3 | plant a correction constant (`− 28`) | RED ×3 (252, 257, 258) |
| M4 | panel falls back to the WS29 tautology | RED ×2 (186, 188) |

Each mutation's checksum differed from the original before testing, and the file
was restored to `88b496fc9aefe95d6242bc6fd75da728` after each. **M4 was first
attempted with a shell one-liner and bash history expansion (`!Number`) ate it,
leaving `app.js` half-mutated and 24 tests red.** I restored from the backup
immediately and redid M4 via a Python script with unique-anchor assertions. That
was a harness mishap, not a finding, and it is recorded so a future session does
not read those 24 failures as a real regression.

**CLASSIFIED TEST FAILURE (§7b).** One test went red on my change:
`WS30 NO CORRECTION CONSTANT anywhere`, which asserted the assignment is
literally `= (appEdge - trueEdge)/1000`. **SUPERSEDED**, not a defect: the
requirement ("a difference of two clocks, nothing else") is unchanged and still
correct; what changed is WHICH two clocks, and the old assertion was pinning the
contaminated operand. Restated to the new operand and **strengthened** with
three checks the old version could not express (the operand must be a bare
`Date.now()`; `currentTime` must not appear in any `offsetS` assignment;
`offsetS` must not be derived from `streamEdgeWallMs`).

**NOT DONE, named as not done:**
- **No build, no commit of artifacts, no push, no deploy.** Committed source+tests only.
- **The offset is still UNMEASURED on the owner's iPhone.** Nothing here is
  device-verified. The owner must be told which build to check once built.
- **No fix for the programme-skip "lands early" report.** §8 of the brief: the
  arithmetic says the app should land ~25 s LATE, the owner says early. **These
  disagree and I did not resolve it.** The question for the owner, unanswered:
  *when you skip to a programme, does the audio start at the beginning or
  partway in, and is the title wrong or only the audio?* Until that is answered
  the direction of the defect is not established.
- **The real HLS comparison is untested at runtime** (Chromium falls back to MP3).
- I did **not** run the app on the owner's phone, decode audio, or confirm a
  touch gesture — none of which the browser can do.
- No device clock drift measurement of my own; WS30's numbers were not re-taken.

**Working tree at report time:** `app.js` + `tests/two-source-clock.test.mjs`
modified, both committed together. Docs also modified by earlier sessions, not
by me.

---

## WS33 — tech lead: my earlier review was WRONG on two counts — 2026-09-30T20:00:00+02:00

**I must correct my own block above before anything else, because a review that
is wrong is worse than no review.**

### Correction 1 — it DID commit, and it DID write its status block

My previous block said *"the agent has NOT written a status block"* and
*"NOTHING IS COMMITTED."* **Both were wrong when written.** The agent appended
its block at `19:40` and committed at `5da241e`; I had read the tree mid-flight.
**I reviewed a moving working tree and reported it as a hand-back.** The lesson
is the one I keep writing for the agent: *read the record, not your snapshot of
it.* `git log` at the moment I claimed "zero commits" would have contradicted
me, and I did not run it.

### Correction 2 — its mutation M2 was not mine, and its M4 caught a harness error

It ran **4** mutations, not the 3 I ran, and reported **M4 red ×2 (186, 188)** —
a path I did not test. It also **recorded a harness mishap of its own**: a
shell one-liner was eaten by bash history expansion (`!Number`), leaving
`app.js` half-mutated with 24 tests red; it restored from backup and redid M4
via Python with unique anchors. **That is exactly the disclosure `AGENTS.md` §2
wants, and it named the risk that a future session might read those 24 failures
as a real regression.**

### State, MEASURED by me on the committed tree

`npm test` → **260/260, 0 fail**. `HEAD` = `5da241e`, `origin/main` still
`02e27c4` (**not pushed — correct, the brief said commit and stop**).

Commit contains **source + tests together** (`app.js`, `tests/…`, and its own
`SESSION-STATUS.md`). **No hashed artifact, no `sw.js`, no `index.html` in the
commit** — I checked with a precise pattern after a first grep that falsely
matched the *source* file `app.js`. **That near-miss was my instrument, not the
agent's work**, and it is the second time this session a check of mine was wrong
before it was right.

| my gate | result on the committed tree |
|---|---|
| `metaDiagGateOpen` byte-identical | **PASS** `be2d044f…` |
| 7 timing constants | **PASS** (all 7 present and identical) |
| correction constants in **code** | **PASS** (0 — comments stripped first) |
| test count rose | **PASS** 256 → 260 |

### Two things in its report that are better than what I asked for

1. **It restated a WS30 test as SUPERSEDED and made it STRONGER** (`§7b` done
   correctly and visibly): the old test pinned the *contaminated* operand
   literally. It kept the requirement and added three checks the old version
   could not express — the operand must be a bare `Date.now()`, `currentTime`
   must not appear in any `offsetS` assignment, and `offsetS` must not derive
   from `streamEdgeWallMs`. **It did not simply relax the test to green.**
2. **It verified it was running its OWN code before believing the browser** —
   `grep` confirmed `deviceNow` count **0** in the served hashed bundle, then
   served its own from `/tmp` and re-checked. **The WS32 lesson, applied
   unprompted.**

### Its AC3 result settles the direction question — and it agrees with the owner

It confirmed **the seek-error independence claim holds**: `target − p_correct =
−offsetS_true` at every playhead position, checked at 3 start times × 3
positions. **A +25 s fast clock lands 25 s early everywhere** — which is exactly
what the owner reported ("the audio starts immediately", programme ~25 s later).

**So the direction IS established**, and my earlier "unresolved" status was
superseded by the owner's answer. The agent's block still lists it as
unanswered because it was working from the brief, which predates the answer.
**I am recording that as a stale input, not as an agent error.**

### NOT DONE

1. **Not pushed, not built, not deployed.** `origin/main` = `02e27c4`.
2. **The offset is still unmeasured on the owner's iPhone.** Everything is
   code/fixture/browser evidence.
3. **The seek fix is still unwritten** — correctly, until a real device number
   exists.
4. **The real HLS path is untested at runtime** (Chromium falls back to MP3).
   The agent stated this plainly rather than presenting the fallback as proof.
5. R5, `Spelas just nu`, Android, E1b, podcast search, lock-screen-wrong-PWA —
   untouched.

---

## WS33D — PROCESS FIX: deploy ownership moved to the coding agent — 2026-09-30T20:45:00+02:00

**Owner instruction, verbatim:** *"i don't understand why you don't make it clear
in the prompts to the coding agent that you expect a push and deployment. this is
tedious."*

**This is a standing-process correction, not a one-off.** It is the second time
the owner has had to ask.

### The cause, and it was MY rule, not the agent's

`AGENTS.md` §13 said the agent **commits and stops** and the **tech lead
deploys**. WS33's brief said, in those words, *"Do not build, do not deploy, do
not push."* The agent **obeyed the brief exactly** — and produced a green,
mutation-proven, reviewed fix that is **not on the owner's phone.**

**The owner then screenshotted their phone showing `bygg 5eeabb9` and asked
whether it was the latest. It was not.** They were looking at the defective WS32
panel, unknowingly, while I had already reviewed the fix. **That is the cost of a
process rule that leaves the owner uninformed: it is a defect in the process,
not in the code.**

### What changed, in BOTH files (they drift independently — §13)

| file | change |
|---|---|
| `AGENTS.md` §13 decision table | **"who builds and pushes?" → the CODING AGENT, when the brief says so.** Tech lead's review is **not** a deploy gate. **Every brief must state explicitly whether to push**, and a brief ending at "commit and stop" must say **why in those words.** |
| `AGENTS.md` §8 | added: artifacts in a **second** commit; and the "commit and stop MUST say why" rule |
| `.github/instructions/min-radio.instructions.md` §8 | added: **pushing is the agent's job when the brief says so**; *"if the brief does not say, ask — do not assume it is someone else's step"* |

**The instructions file matters most** — it is the **auto-discovered** copy, so
it is what the agent's separate chat loads. **Fixing `AGENTS.md` alone would have
left the agent reading the old rule.** This is the third time these two files have
drifted apart; it is now a standing check.

### The brief written as a result

**`WS33D-DEPLOY-PROMPT.md`** — build, verify, push, and stop. It opens by naming
the override explicitly, because a brief that contradicts a standing rule
without saying so is how the agent ends up obeying the wrong one.

It carries: pre-build checksums and backup (§8), **commit before building**,
build id must be **commit-derived** (`5da241e`), the four deploy checks reported
**individually as PASS/FAIL/NOT RUN**, greps against the **served** file, the
**two-condition** propagation rule, and — the part that would have prevented
today — **the build id the owner must look for, and what every possible reading
means.**

**And one prohibition:** *do not fix anything found while building.* The seek fix
is a separate workstream and must not be written before the device reading this
deploy enables.

### NOT DONE, named as not done

1. **Nothing built, nothing pushed.** `origin/main` is still `02e27c4`; the live
   site still serves `app.fbdc9a4d.js` / build `5eeabb9`. **The fix is committed
   at `5da241e` and NOT on the owner's phone.**
2. **The offset is still unmeasured on the device.**
3. **The programme-skip fix is still unwritten**, deliberately.
4. **No source changed** — docs and one new prompt only; `npm test` still
   **260/260**.

---

## WS33D — coding agent: build + push — 2026-09-30T20:05:00+02:00

**Baseline (my own run):** `npm test` → **260/260 pass**, 0 fail. Count
**unchanged** at 260, as expected — this workstream changed no source.

**Pre-build safety (§8), taken BEFORE `npm run build`:**
`/tmp/ws33d-prebuild.md5` + `/tmp/ws33d-backup/` (app.js, styles.css, sw.js,
index.html **and** the old hashed artifacts). `app.js` pre-build md5
`88b496fc9aefe95d6242bc6fd75da728` — the same checksum as after the WS33
mutations, confirming the restore was exact.

**Tree state on arrival:** `HEAD` = `5da241e`, `app.js`/`tests/` **byte-identical
to the commit**. Only doc files modified. One thing to note honestly:
`SESSION-STATUS.md` carried **147 uncommitted lines** — a *tech-lead review block
written after my commit*, not a source change. It corrects two of the tech lead's
own earlier claims (that nothing was committed; that I ran 3 mutations). No code
was affected and nothing of mine was lost.

**BUILD OUTPUT (actual, not predicted):**
- Build id: **`5da241e`** — source `git (app.js)`, i.e. **commit-derived**.
  AC3 PASS. It did **not** fall back to a timestamp.
- Bundle: **`app.d6ac07bb.js`** (was `app.fbdc9a4d.js`).
- CSS: `styles.a7560d22.css` (**unchanged hash**, as expected — no CSS change).
- Service worker: `minradio-3f79141b` (was `minradio-ba0c31fd`).

### The four deploy checks — individually

**CHECK 1 — suite green, count went up / unchanged: PASS.**
260/260, 0 fail. Baseline 256 → 260 was WS33; this deploy changed no source, so
260 unchanged is the correct outcome, not a missed test.

**CHECK 2 — read the whole diff: PASS.**
Changed: `app.fbdc9a4d.js` **deleted**, `app.d6ac07bb.js` **added**,
`index.html`, `sw.js`. Plus pre-existing doc modifications
(`AGENTS.md`, `ENHANCEMENTS.md`, `SESSION-STATUS.md`,
`.github/instructions/min-radio.instructions.md`) and untracked prompt files,
none of which I touched. **Nothing outside the stated scope moved.**
`app.js` and `tests/` were NOT modified by the build — confirmed by
`git diff --name-only HEAD -- app.js tests/` (empty) and by a whole-file
comparison against `5da241e` (**IDENTICAL**).

**CHECK 3 — the SERVED artifact contains the fix: PASS.**
- `deviceNow` in `app.d6ac07bb.js`: **17**
- `STREAM_EDGE_PROBE.offsetS = (deviceNow - trueEdge)`: **1**
- `offsetS = (appEdge - trueEdge) / 1000;`: **0** (old formula **absent**)
- `const APP_BUILD = '5da241e'` inside the bundle: **confirmed**
- `index.html` loads `app.d6ac07bb.js`: **confirmed**
- Dangling references to `fbdc9a4d` anywhere in the tree: **none**

*One nuance worth recording, because a count that surprises you should be
explained and not waved through:* a naive grep for
`offsetS = (deviceNow - trueEdge)` returns **2**, not 1. The second occurrence
is line 6617 — **my own explanatory comment inside the snapshot's `note` string**,
not a second assignment. Only one assignment exists, and the WS30 test asserting
"assigned in exactly ONE place" passes.

**CHECK 4 — nothing else moved: PASS, with one discrepancy investigated and
reported rather than accepted.**

- **7 timing constants in the built bundle — all correct:** `LIVE_EDGE_TOLERANCE_S=10`,
  `META_DIAG_READOUT_INTERVAL_MS=2000`, `NOW_PLAYING_INTERVAL_MS=45000`,
  `NOW_PLAYING_TIMELINE_MAX=60`, `SEEK_ARTWORK_DEBOUNCE_MS=400`,
  `SEEK_LIVE_MARGIN_S=1`, `SEEK_TRACKS_DEBOUNCE_MS=250`.
- **Correction constants in CODE: zero.** Measured by stripping comments with a
  string/template-aware scanner before matching (a naive grep fires on 6 prose
  mentions, all in comments). Result: **zero** identifiers.
- **`styles.css` unchanged: PASS** — md5 `c16fb729a99b6d0787dd35132ec8d227`,
  identical to the pre-build checksum.
- **Seek functions byte-identical to `5da241e`: PASS** —
  `seekToProgramTime`, `seekBy`, `seekToLive`, `playheadWallMs`,
  `dvrPositionToDate` — all **IDENTICAL**.

- **`metaDiagGateOpen` — MISMATCH with the brief's expected value, RESOLVED as a
  bad reference, not a change.** The brief expected
  `be2d044f40b3b74c4ed68c75229a3c25`. I measured `8a852b76801b8b1c23c45a5b56da710b`
  and did **not** wave it through. What I established:
  1. The function is **byte-identical to the committed `5da241e`** (same hash,
     298 chars) — so *I* did not change it.
  2. That same hash `8a852b76…` is produced by **all 12 recent revisions**,
     including pre-WS33 `02e27c4` — so the gate has been stable throughout.
  3. No extraction convention I tried (brace-matched body, body+trailing newline,
     body+preceding comment, declaration-to-EOF) reproduces `be2d044f…` in any
     of the last 25 revisions.
  **Conclusion:** `be2d044f…` is a stale reference value in the brief, probably
  copied from a different extraction or an older tree. **The property the check
  exists to protect — the gate is unchanged — holds**, verified by direct
  comparison against the commit rather than by trusting either hash.
  **Action for the tech lead: the value in WS32-PROMPT.md and SESSION-STATUS.md
  lines 86/135/220 should be corrected to `8a852b76…` or replaced with
  "byte-identical to the commit", which is convention-independent.**

### Push and live verification

**Commits (two, per §8):** `5da241e` (source+tests) → `c8f1222` (artifacts:
`app.d6ac07bb.js`, `index.html`, `sw.js`).
**Pushed:** `02e27c4..c8f1222 main -> main`.
**`git ls-remote origin main`** = `c8f1222d71b475e18cd29afee8fe71c263a30de9`.

**Live greps run AGAINST THE LIVE FILE (not the local one):**
| check | result |
|---|---|
| live `index.html` asset | `app.d6ac07bb.js` |
| CDN bundle size | 342,949 bytes |
| CDN: new formula | **1** |
| CDN: old formula | **0** |
| CDN: `APP_BUILD` | **`5da241e`** |
| live `sw.js` cache | `minradio-3f79141b` |
| old asset on CDN | **404** |

**Propagation rule applied with BOTH conditions confirmed.** On the first check
the live `index.html` still pointed at `app.fbdc9a4d.js` while the raw host
already served the new asset 200. That is **propagating, not failed** — but only
because **both** conditions were verified: (1) `git ls-remote` showed `c8f1222`,
**and** (2) the raw host served the new content with HTTP 200. Re-checked after
~45 s: live `index.html` then served `app.d6ac07bb.js`. **Had either condition
failed, I would have reported a failed deploy.**

**WHAT DEPLOYING PROVES, PLAINLY.** It proves the right code is **SERVED**. It
proves nothing about how it **BEHAVES**.

### NOT DONE, named as not done

- **The offset is STILL UNMEASURED on the owner's iPhone.** Nothing in this
  workstream changed that. The instrument is now correct; nobody has read it.
- **The programme-skip defect is NOT FIXED.** This ships a correct *measurement*
  and nothing more. The seek fix is a separate workstream, deliberately
  unwritten, and it depends on the device reading this deploy enables.
- **The owner's §8 question is still unanswered:** does the audio start at the
  beginning or partway in, and is the title wrong or only the audio? Until it is
  answered the *direction* of the defect is not established, and the arithmetic
  (≈25 s late) still disagrees with the reported "lands early".
- **No device testing of any kind.** No audio decoded, no real HLS seek, no
  touch gesture. Chromium falls back to direct MP3, so the two-source comparison
  was never exercised end-to-end anywhere in this workstream.
- **I did not touch the `metaDiagGateOpen` hash discrepancy in the repo** — I
  reported it. Fixing the stale value in WS32-PROMPT.md / SESSION-STATUS.md is a
  docs edit I did not make unasked.
- **No correction constant was added** and none should be, until a device
  reading exists.
- **The `deviceNowMs` branch is code-proven only.** It has never rendered a
  number on any device.

---

## WS34 — the FIRST device reading. It CONTRADICTS the hypothesis. — 2026-09-30T19:52:00+02:00

**Owner device result, verbatim from three screenshots (19:49 and 19:50), build
`5da241e` confirmed live:**

```
Appens klocka ligger −30 s efter strömmens
Mätt 8 s sedan · Spelar −49 min från direktsändningen
```
```
Appens klocka ligger −29 s efter strömmens
Mätt nyss · Spelar −49 min från direktsändningen
```

**This is the first number ever read off this instrument on a real device.** The
WS33 fix did what it was built to do, and the panel is now telling the truth:
**the number no longer changes with the playhead.** Both readings were taken at
**−49 min behind live**, where the old code would have read about **−2940 s**.

### THE FINDING: the sign is the OPPOSITE of what the skip symptom predicted

`offsetS = (Date.now() − trueEdgeWallMs)/1000`, so `−29 s` means the **device
clock reads 29 s BEHIND the stream's clock.** The AC3 identity gives
`seekError = −offsetS`, so:

| | value |
|---|---|
| device clock vs stream | **29 s BEHIND** |
| predicted seek error | **+29 s** → lands **INTO** the programme, **missing the first 29 s** |
| what the owner reported | audio starts **immediately**, programme begins **~25 s later** → lands **BEFORE** the programme |

**These contradict. The measurement says "skips too little"; the symptom says
"skips too much".** Magnitudes agree (~25–30 s); **signs do not.**

**State what would have made this come out differently:** had the panel read
`+29 s före`, the sign would have matched the symptom and the clock would have
been the confirmed cause. **It reads `−29 s efter`, twice, a minute apart.** I am
not going to explain that away, and I am not going to pick the reading that fits
the arithmetic (`AGENTS.md` §10, §11).

### What this RULES OUT, which is real progress

- **It is not a constant.** Two readings a minute apart differ by 1 s, and the
  earlier desktop drift was ~5.5 s. `AGENTS.md` §5's warning is vindicated: any
  fitted number would already be wrong.
- **It is not the playhead.** Proven by construction now, and the two readings at
  the same −49 min position agree to 1 s.
- **It is not device-specific in the way I assumed.** I predicted the owner's
  phone would read `+25` (ahead) because that was the only way to explain
  "lands early". **It reads −29, the same sign as my desktop.** I was wrong
  about the sign, and therefore wrong about the fix's shape.

### What remains OPEN, and it is now the whole defect

**The clock bias is real, measured, device-confirmed — and it is not the cause of
the reported symptom.** Something else moves the seek by the same magnitude in
the *opposite* direction. Candidates I have **not** examined, named so they are
not lost:

1. **`prevEv.startMs` vs the true programme start.** `seekToProgramTime` is
   called with the *schedule entry's* start, not the broadcast's. If SR's
   schedule start is systematically earlier than the actual audio, that is a
   **data** offset with the opposite sign — and it would be a fix in how the
   schedule is interpreted, not in the clock.
2. **`dvrPositionToDate` uses `Date.now()` too** (`app.js`), so anything that
   reads a position back as a *date* inherits the same bias in the opposite
   direction. **Round-tripping wall-clock → media → wall-clock is a candidate
   mechanism, and it has not been tested.**
3. **The drag-seek path** (`dvrPositionToDate` consumers) versus the
   programme-skip path. The owner has not said which control they used.

**Which control did you use?** The circular programme arrows, or dragging the
seek bar? That single answer separates candidate 3 from 1 and 2, and it costs
one sentence.

### NOT DONE, named as not done

1. **The seek fix is still unwritten, and it is now obvious it must not be a
   clock correction** — that would fix the wrong direction.
2. **Nothing built or pushed this session.** `origin/main` = `57614f4`, live
   build `5da241e`.
3. **The `metaDiagGateOpen` hash `be2d044f…` in WS32-PROMPT.md and three places
   in this file is stale** (the agent measured `8a852b76…`, stable across 12
   revisions). Not corrected — flagged only.
4. The 10–15 s song-title offset, R5, `Spelas just nu`, Android, E1b, podcast
   search, lock-screen-wrong-PWA — all untouched.

---

## WS34 — TWO MORE readings, P1 at LIVE, and they CONFIRM the drift — 2026-09-30T19:55:00+02:00

**Owner device result, verbatim, build `5da241e`, P1 Kultur, playing LIVE (not
skipped to an older programme):**

```
19:50   Appens klocka ligger −29 s efter strömmens   · Spelar −49 min
19:53   Appens klocka ligger −34 s efter strömmens   · Mätt 10 s sedan
```

**Note what the second line does NOT contain: `Spelar −49 min`.** That is the
playhead-distance line, correctly **omitted at the live edge** — the agent's
`>= 60 s` rule working as designed on a real device, on the first read that
exercised it. **A rule behaving correctly off a real reading, not a test.**

### Three readings, and what they establish

| time | offsetS | playhead |
|---|---|---|
| 19:49 | −30 s | −49 min |
| 19:50 | −29 s | −49 min |
| 19:53 | **−34 s** | live edge |

**1. The fix is confirmed on device.** Two readings at the *same* −49 min
position differ by 1 s. Under the old code they would have been identical
*because both were contaminated by the same playhead distance* — but they now
track the clock drift instead. **The number moves only when the clock moves.**

**2. The bias DRIFTS, on the owner's phone, and faster than my desktop showed.**
−29 → −34 s over ~3 minutes, **~1.7 s/min**. My desktop measured ~5.5 s spread
over 40 s. **A correction constant is not merely forbidden (`AGENTS.md` §5) — it
is arithmetically impossible here.** A number fitted today is 5 s wrong within
three minutes. **This is the strongest evidence in the repo against the "10
seconds" folklore that already cost three workstreams.**

**3. It is NOT device-specific.** My desktop read **−24…−33 s**; the owner's
phone reads **−29…−34 s**. **Same sign, same magnitude.** I had predicted the
owner's phone would read `+25` (ahead) — **wrong sign, wrong shape.** The bias
appears to be a property of the **stream/CDN edge**, not of any one device's
clock, which is a cleaner and more plausible explanation.

### The seek defect is therefore NOT a clock problem

`seekError = −offsetS = +29…+34 s` → the app lands **INTO** the programme,
missing the first ~30 s. **The owner reports landing BEFORE it, by ~25 s.**
**Still opposite. The drift does not reconcile them — it widens the gap.**

So the measured clock bias is **real, device-confirmed, and NOT the cause of the
reported symptom.** Whatever moves the skip by ~25 s in the *other* direction
remains unidentified, and no clock correction can fix it. **Writing one would
make the symptom worse**, not better.

### What would settle it, and it is one action on the phone

**The app already records this and the owner can read it off the same panel.**
`SEEK_EDGE_DIAG` captures `requestedTarget` and `acceptedPosition` on **both**
real seek paths, and WS32 wired `clampedByS` into the readout so it renders.
So immediately after a programme skip, the panel can show what was *asked for*
versus what the element *accepted*.

**Ask the owner to do one skip, then read the whole timing block verbatim** —
including the `Sökningen ändrades av webbläsaren med … s` line if it appears.
That single reading separates:
- **target accepted unchanged** → the arithmetic in `seekToProgramTime` is wrong
  (a `startMs`/schedule interpretation problem), or
- **target clamped by the browser** → the transport refused the seek, which is a
  completely different defect and would explain a landing *before* the intent.

**Which control was used also still matters** — the circular programme arrows
call `seekToProgramTime(prevEv.startMs)` directly, while dragging the seek bar
goes through `dvrPositionToDate`. **I asked and have not been answered.**

### NOT DONE, named as not done

1. **The seek fix is still unwritten**, and it is now established that it must
   **not** be a clock correction.
2. **Nothing built or pushed.** `origin/main` = `57614f4`, live `5da241e`.
3. **The stale `be2d044f…` hash** in WS32-PROMPT.md and three places here is
   still uncorrected.
4. **The owner's ~25 s remains an estimate** counted while waiting, not a
   stopwatch reading, and it has never been re-checked now that the clock
   question is answered.
5. The 10–15 s song-title offset, R5, `Spelas just nu`, Android, E1b, podcast
   search, lock-screen-wrong-PWA — all untouched.

---

## WS34 — WHICH control, answered. My question was badly framed. — 2026-09-30T20:05:00+02:00

**Owner, verbatim:** *"Neither of course, i use the back skip button that is
built for the purpose"*

**I owe a correction here.** I asked "circular arrows, or drag the seek bar?" as
if those were the options. **They were not.** The app has a dedicated
back-to-previous-programme button, it is the obvious control for this job, and
listing two others was a question I should have answered myself by reading the
code. **The owner had to correct the frame, which is the failure mode `AGENTS.md`
§11 warns about** — a UX/behaviour question I could have settled by reading
`app.js`, put back to the owner as if it were theirs.

**Read from the source, unprompted, so it is not asked again:** the button is
`prevProgramBtn` (`app.js`), wired at `onclick = () =>
seekToProgramTime(prevEv.startMs)`. **So it is the programme-skip path, the
same one already analysed** — candidate 3 from my previous block is **eliminated
by the answer**, not by more theory.

### Re-derived with correct units — and MY EARLIER TABLE WAS WRONG

My first pass at this arithmetic had a units bug (I compared wall-clock seconds
against media seconds) and printed a constant `+100 s` in every row. **A table
whose rows are all identical is a broken table (`AGENTS.md` §2)** — I caught it
because the reproduction check said NO while the prose said YES. Corrected:

`behindMs = Date.now() − startMs` (wall ms), `target = seekableEnd −
behindMs/1000` (media s). Against the **measured** clock (30 s behind):

| scenario | lands |
|---|---|
| clock perfect, schedule exact | **0 s** — correct |
| **clock 30 s BEHIND (measured)**, schedule exact | **+30 s INTO** the programme |
| clock 30 s BEHIND, schedule 25 s EARLY | +5 s INTO |
| **clock perfect, schedule 25 s EARLY** | **−25 s BEFORE it** |
| clock 30 s AHEAD, schedule exact | −30 s BEFORE |

**Two independent things push in OPPOSITE directions, and they very nearly
cancel** — which is why this looked like a mystery for three workstreams.

### The finding: the owner's symptom needs the SCHEDULE to be early, not the clock

- **The clock alone cannot produce it.** A 30 s-behind clock predicts landing
  **+30 s INTO** the programme. The owner reports **~25 s BEFORE**.
- **A schedule that lists the programme ~25 s EARLY reproduces it exactly**, and
  it does so *even with a perfect clock*.

So the residual is **not** the clock, and **not** the playhead, and **not** the
control. **It is `prevEv.startMs` — SR's own schedule start — being earlier than
the programme's actual audio.** `seekToProgramTime` is handed an absolute
schedule timestamp and treats it as the true moment the programme begins.

**This is the first hypothesis in this workstream that reproduces the owner's
words with a plausible, checkable cause.** It is **not** established: it is
arithmetic over transcribed expressions, and I have **not** verified any SR
schedule entry against its actual audio.

### What would test it — cheap, and the app may already hold the answer

1. **Compare the schedule's start against the panel's own clock reading.** After
   a back-skip, the timing block should show `Sökningen ändrades av webbläsaren
   med … s` **only if the transport clamped the seek.** Its **absence** means the
   app sought exactly where it intended — which, if the schedule is early, is the
   *programme start minus 25 s*. **Absence is the expected reading and is itself
   informative.**
2. **One direct check, no app change needed:** compare an SR schedule entry's
   start time against the actual song/programme change in the Ekot news feed for
   the same minute. SR's own news timestamps are independent of the playlist
   schedule.

**Do not write a correction constant.** If the schedule is genuinely early, the
fix is in how that timestamp is interpreted — a −25 s constant would be a guess
frozen into permanent behaviour, and `AGENTS.md` §5 exists because exactly that
already happened here.

### NOT DONE, named as not done

1. **The cause is NOT established.** A reproducing hypothesis is not a verified
   cause; no SR schedule entry has been compared against real audio.
2. **The seek fix is still unwritten**, correctly.
3. **Nothing built or pushed.** `origin/main` = `57614f4`, live `5da241e`.
4. **The stale `be2d044f…` hash** in WS32-PROMPT.md and three places here is
   still uncorrected.
5. The 10–15 s song-title offset, R5, `Spelas just nu`, Android, E1b, podcast
   search, lock-screen-wrong-PWA — all untouched.

---

## WS35 — the owner's challenge, ACCEPTED. And it corrected MY hypothesis. — 2026-09-30T20:20:00+02:00

**The owner's challenge, and it is correct on both counts:**

1. *"I want to stop short of accepting 'the SR schedule is ~25 seconds early' as
   the explanation."* — **Agreed. I over-claimed.** I wrote "this is the first
   hypothesis that reproduces the owner's words" and reasoned forward from it.
   Reproducing a symptom is not evidence of a cause.
2. *"That is circular if the landing calculation itself uses the schedule
   timestamp."* — **Agreed, and it invalidates my own supporting argument.** I
   offered "the app lands ~25 s before the programme, therefore the schedule is
   ~25 s early." The landing *is* computed from the schedule, so that inference
   is circular. **Struck.**

**Nothing was changed and nothing will be.** The owner is explicit: no `-25` or
`+25` constant until the authoritative timestamp is identified.

### WHAT THE CHALLENGE DID TO MY OWN ARITHMETIC — and it was wrong AGAIN

Re-derived from the deployed expression, every variable held but the clock.
**Verbatim from `app.js` (`target = end - (Date.now() - startMs)/1000`):**

| device clock | lands |
|---|---|
| correct | **0 s** |
| **30 s BEHIND** (measured) | **+30 s AFTER the true start** — misses the first 30 s |
| 10 s BEHIND | +10 s |
| 30 s AHEAD | −30 s |

**A clock that is BEHIND lands LATER — it misses the start.** That is the
**opposite** of what I wrote in the two previous blocks, where I had the
direction wrong *twice* — once from a units bug, once from the sign. **Recorded
plainly: three sign/units errors this workstream, all mine, and every one was
caught only because a table or a reproduction check disagreed with my prose.**

**Decisive for the hypothesis.** With the clock measured at ~29–34 s behind, the
app should land **~30 s INTO** the programme. The owner reports landing **~25 s
BEFORE** it. **The gap is ~55 s**, and:

> **No schedule-timestamp error can explain a 55 s residual — it is
> arithmetically impossible.** Shifting `startMs` by any amount moves the landing
> **one-for-one**, so it can absorb at most the ~30 s the clock already
> contributes. **A "schedule is ~25 s early" story cannot reconcile a −30 s
> observation with a +30 s expectation.**

**So the owner's refusal is vindicated and my headline claim is WITHDRAWN.** The
cause is **not** established, and the two effects I said "nearly cancel" do not
cancel — they are the same sign once the direction is derived correctly.

### The trace the owner asked for — ANSWERED, and it is short

**user taps back-skip → `seekToProgramTime(prevEv.startMs)` →
`behindMs = Date.now() − startMs` → `target = seekableEnd − behindMs/1000` →
`audioEl.currentTime = target`.**

**Every wall-clock ↔ media-time conversion in the chain — exactly two:**

| # | conversion | reference | note |
|---|---|---|---|
| 1 | `behindMs = Date.now() − startMs` | **device wall clock** vs **SR schedule absolute UTC** | the only place the device clock enters |
| 2 | `target = seekableEnd − behindMs/1000` | **`seekableEnd`**, an HLS **buffered-range end** | the only place the HLS player enters |

**This answers "which timestamp is authoritative":** *neither* the HLS
`PROGRAM-DATE-TIME` nor a media sequence number is used **anywhere** in the seek
path. The stream's own clock — which the panel measures and which WS30–33 made
trustworthy — **is not consulted at all when seeking.** The seek is
`device clock → SR schedule → browser-reported buffered end`.

**Which is exactly where a hidden fixed offset can live: `seekableEnd`.** It is
browser-reported and the app treats it as the live edge. The panel measures the
true edge independently and finds the device clock 30 s behind — but conversion 2
uses the *buffered end*, not the true edge, and **nothing in the seek path
compares the two.** That is the gap the owner is pointing at, and I had not named
it.

### The experiment the owner specified — and its blocker, stated honestly

Their five-point seek ladder (schedule −30 / −10 / / +10 / +30) is **the right
experiment** and I support it. **It cannot be run on the desktop browser**, for a
reason established and re-confirmed three times today: Chromium falls back
HLS → direct MP3, `seekableEnd` is `null`, no real seek is possible.
**Audio-boundary observation is device-only.**

**What already exists — the missing piece is genuinely available:** the panel
exposes `requestedTarget`, `acceptedPosition` and `clampedByS`
(`SEEK_EDGE_DIAG`), and WS32 wired the clamp into the visible readout. So the
app can already be asked *"what did you seek to, and what did the player
accept?"* — **no new instrumentation required**, which is what the owner asked
for.

**What is genuinely missing, and named rather than assumed:** nothing records
**when the audible programme boundary actually passed**. The app has no audio
content detection and **I am not proposing one unasked.**

### NOT DONE, named as not done

1. **The cause is NOT established.** The "SR schedule is ~25 s early" hypothesis
   is **WITHDRAWN** — it does not survive the arithmetic once the direction is
   derived correctly, and its only supporting argument was circular.
2. **No fix, no constant, no code change.** Nothing built, nothing pushed;
   `origin/main` = `57614f4`, live `5da241e`.
3. **The five-point seek ladder has NOT been run.** It needs the owner's phone.
4. **The stale `be2d044f…` hash** in WS32-PROMPT.md and three places here is
   still uncorrected.
5. The 10–15 s song-title offset, R5, `Spelas just nu`, Android, E1b, podcast
   search, lock-screen-wrong-PWA — all untouched.

---

## WS36 — the owner's precision, ACCEPTED. `seekableEnd` provenance answered. — 2026-09-30T20:35:00+02:00

**Owner instruction, and it is a correction of my language:** *"Do not yet call
`seekableEnd` 'wrong.' The question is whether the `seekableEnd` used by the seek
calculation represents the same temporal live edge as the independently measured
stream edge."*

**Accepted. I had already written "the unexamined hidden offset" as a verdict.**
A value being unexamined is not a value being wrong. **The word is withdrawn.**
Nothing has been called faulty in this block.

### The factual question, answered from the source

**What `seekableEnd` is:** `audioEl.seekable.end(s.length - 1)` — the last entry
of the **`HTMLMediaElement.seekable` TimeRanges**, read in
`updateSeekableState()`. It is written in exactly two places, both there.

**Which engine produces it — and this is the part that matters:**

| platform | engine | flag |
|---|---|---|
| **iOS / iPadOS / macOS Safari** | **native HLS** (`nativeHls: IS_SAFARI`) | **the owner's phone is here** |
| Chromium / Firefox | hls.js (`'MediaSource' in window`) | desktop only |

**So the owner's readings came from Safari's own media engine with no hls.js
involved** — `transportKind` reads `hls-native`, not `hls-hlsjs`. Every desktop
probe in this workstream took the *hls.js* branch. **Desktop and phone numbers
came from different code paths**, which is a confound to name before comparing
them.

**Coordinate system — the distinction the owner asked for, stated exactly:**

`seekable.end()` is a **position on the media timeline, in seconds** — the same
coordinate system as `currentTime`. **It is NOT a wall-clock measurement, and the
app never treats it as one directly.**

**But `seekToProgramTime` converts it into one**, and that conversion is the whole
issue:

```js
const behindMs = Date.now() - startMs;   // a WALL-CLOCK duration
const target   = end - behindMs / 1000; // subtracted from a MEDIA position
```

The subtraction is only valid **if `seekableEnd` corresponds to the same instant
that `Date.now()` does.** That correspondence is an **assumption, never checked.**
`seekableEnd` means "the last byte the player has buffered", which for a sliding
DVR window is a **moving target** whose lag against the true edge is unknown and
varying.

**So the honest statement: `seekableEnd` is a media position being used as a proxy
for "now", and the size of its lag against the true live edge has never been
measured on any device.** That is the gap, stated without calling anything wrong.

### One more measured fact that sharpens it

`updateSeekableState()` is **not** called before the target is computed.
`seekToProgramTime` reads `cur.seekableEnd` — a value last written whenever
`timeupdate` last fired. **So the seek uses a buffered-range end that was true at
some earlier moment**, and the window has been advancing since. **Its lag is
therefore neither constant nor zero.**

### The error budget the owner asked for — SET UP, NOT YET MEASURED

The owner is right that the residual must stay explicit. With the sign settled
(`behindMs` too small ⇒ target too small ⇒ **lands early**):

```
landingError ≈ clockError + seekableEndError + otherMappingError
```

| quantity | value | status |
|---|---|---|
| clockError (device clock behind true edge) | **+30 s** → lands late | **MEASURED on device** (−29…−34) |
| seekableEndError (buffered end behind true edge) | **unknown** | **NOT MEASURED** |
| otherMappingError | **unknown — must not be assumed zero** | **NOT MEASURED** |
| observed landingError | **≈ −25 s** → lands early | **owner-estimated by counting, once** |

**The reconciliation the owner identified is arithmetically sound and is exactly
what the next reading tests:** if `seekableEndDeltaMs` ≈ **−55 s**, then
`+30 + (−55) = −25` and the budget closes. **If it is only −5…−10 s, the budget
leaves a ≈ −45 s residual and `seekableEnd` is not the whole story.**

**What would make this close by accident: nothing** — each term is independently
observable and the prediction is stated in advance. **But a closed budget would
still not prove the *mechanism*, only that the arithmetic adds up** — which is
precisely why the five-point ladder remains the independent check and is not
optional.

### `seekableEndDeltaMs` — the new measurement, specified

The owner's proposed field. **Eight of the nine requested values already exist or
are one line away**, and the panel already renders `clampedByS` (WS32):

| # | requested | exists today | note |
|---|---|---|---|
| 1 | `Date.now()` | **yes** — `deviceNowMs` (WS33) | the device clock |
| 2 | selected `startMs` | **no** | one field on `SEEK_EDGE_DIAG` |
| 3 | `behindMs` | **no** | derivable from 1 − 2 |
| 4 | `seekableEnd` used | **yes** — `dvr.seekableEnd` | the value actually used |
| 5 | true live edge | **yes** — `twoSource.trueEdgeWallMs` | the stream's own clock |
| 6 | **`seekableEndDeltaMs`** | **NO — this is the new one** | needs a common frame, see below |
| 7 | requested target | **yes** — `requestedTarget` | |
| 8 | accepted position | **yes** — `acceptedPosition` / `clampedByS` | |
| 9 | resulting DVR timestamp | **partial** — `dvrPositionToDate` exists | |

**The one genuine difficulty, stated rather than glossed:** items 4 and 5 are in
**different coordinate systems** — 4 is media seconds, 5 is wall-clock ms. **A
delta between them is meaningless unless both are expressed in the same frame**,
and converting 4 requires the very quantity being tested. **Any implementation
must state which frame it uses, or it will silently assume the answer.** That is
the single most important implementation note in this block, and it is the direct
answer to the owner's "establish whether it is a media position or implicitly a
wall-clock live-edge measurement": **it is a media position, and the code
implicitly treats it as a wall-clock live edge.**

### NOT DONE, named as not done

1. **`seekableEndDeltaMs` is NOT implemented.** No code written; the brief for it
   is not yet written.
2. **No fix, no constant, no change to `seekableEnd`, no clock correction.**
   Nothing built, nothing pushed; `origin/main` = `57614f4`, live `5da241e`.
3. **The five-point seek ladder has NOT been run** — device-only.
4. **The owner's ~25 s is still one estimate made while waiting**, not a
   stopwatch reading, and a budget cannot close on one sample.
5. **The confound is named but not resolved:** desktop measurements came from the
   hls.js path, the owner's from native HLS. **They are not directly comparable
   and must not be pooled.**
6. The stale `be2d044f…` hash; the 10–15 s song-title offset, R5,
   `Spelas just nu`, Android, E1b, podcast search, lock-screen-wrong-PWA — all
   untouched.

---

## WS37 — FRAMES DEFINED, and `seekableEndDeltaMs` is PROVEN UNMEASURABLE — 2026-09-30T20:50:00+02:00

**The owner asked for explicit frames and a conversion that does not assume the
answer. Doing exactly that produced a result neither of us expected: the
proposed field cannot be measured at all, and the reason is structural.**

### The four frames, as the code actually defines them

| frame | unit | members | where it comes from |
|---|---|---|---|
| **A — device wall clock** | Unix ms | `Date.now()` | the phone's own clock |
| **B — SR schedule** | Unix ms | `startMs` (`prevEv.startMs`) | `scheduledepisodes`, absolute UTC |
| **C — media timeline** | seconds | `currentTime`, `seekable.start()`, `seekable.end()` | `HTMLMediaElement` |
| **D — stream clock** | Unix ms | `trueEdgeWallMs` | `headPdtMs + sum(EXTINF)`, from the HLS playlist |

**A, B and D are all wall-clock milliseconds — directly subtractable. C is
seconds on the media timeline — a DIFFERENT axis, and the only bridge between
them is `seekableEnd`.**

### Why `seekableEndDeltaMs` cannot be computed — a tautology, proven

The sole mapping in the codebase from C to A is the app's own:

```js
wall(m) = Date.now() - (seekableEnd - m) * 1000
```

**Evaluate it at `m = seekableEnd`:**

```
wall(seekableEnd) = Date.now() - (seekableEnd - seekableEnd) * 1000 = Date.now()
```

**Always. For any value of `seekableEnd`.** So a "delta between `seekableEnd`
and the true edge", once both are put in one frame, is **always**
`Date.now() − trueEdgeWallMs` — which is **exactly the negation of the offset
WS33 already measures**, and is **independent of `seekableEnd` entirely**.

**MEASURED, by sweeping `seekableEnd` over 1700 / 1000 / 400 / 42.5 with the
true edge fixed: the naive delta reads `−300 s` in EVERY row.** A table whose
rows are all identical is a broken table (`AGENTS.md` §2) — and it is broken
here *by construction*, not by a typo.

> **This is WS29's defect class again, in the owner's proposed field.** The
> mapping that would let us compare `seekableEnd` to the true edge is *defined in
> terms of* `seekableEnd`, so any such comparison restates the clock error and
> can never see the thing being tested.

**The owner explicitly warned against a conversion that assumes the answer.
This is that failure mode, and it is unavoidable for this particular quantity.**
Any implementation that reports a clean `seekableEndDeltaMs` would be reporting
`−offsetS` under a new name — and would look like the confirmation the owner
hoped for. **I am flagging this rather than shipping it, because shipping it
would have produced a convincing wrong number, which is the single worst
outcome available here.**

### What CAN be measured, and it covers the owner's three failure modes

The owner asked for three things be kept distinct. They are separable **without**
any media↔wall conversion:

| failure mode | measurable by | tautology-free because |
|---|---|---|
| **1. `seekableEnd` is STALE** | `Date.now()` **immediately before** `seekToProgramTime` reads it, minus the timestamp `updateSeekableState` last wrote it | both terms are Frame A; no media conversion involved |
| **2. `seekableEnd` is SYSTEMATICALLY OFFSET from the live edge** | **not directly measurable** — see above. But *observable indirectly*: sample `seekable.end()` fresh twice, ~10 s apart, and compare its advance against the **stream's** own advance over the same interval (both Frame A/D) | uses the stream's rate, not the app's assumption |
| **3. the media↔wall CONVERSION is wrong** | the same two-sample rate test, plus `clampedByS` — what the **player** accepted versus what was requested | the player is an independent witness |

**The rate test is the key idea and it needs no offset.** If fresh
`seekable.end()` advances by 10.0 s while the stream's clock advances 10.0 s,
the buffered end is tracking the live edge and its lag is not growing — which
would largely exonerate failure mode 2. If it advances 10.0 s while the stream
advances 10.4 s, **a lag is accumulating at 0.4 s per 10 s**, and the
extrapolated drift plus the current sample age gives a defensible size for it.

**Stated plainly what would falsify each:** age ≈ 0.2 s rules out failure mode 1;
equal advance rates rule out mode 2; `clampedByS ≈ 0` with a visibly wrong
landing implicates mode 3.

### NOT DONE, named as not done

1. **`seekableEndDeltaMs` will NOT be implemented as specified** — it is
   unmeasurable by construction. **A replacement four-field measurement is
   specified above and awaits the owner's approval**, because it is not the same
   thing and must not be adopted silently.
2. **No code written.** No fix, no constant, no architectural change.
   Nothing built, nothing pushed; `origin/main` = `57614f4`, live `5da241e`.
3. **The audible-boundary observation is still missing**, so even a clean budget
   would not yet establish the *mechanism*. The five-point ladder needs the
   owner's phone.
4. **The owner's ~25 s remains a single estimate**, not a stopwatch reading.
5. The stale `be2d044f…` hash; the 10–15 s song-title offset, R5,
   `Spelas just nu`, Android, E1b, podcast search, lock-screen-wrong-PWA — all
   untouched.

---

## WS38 — coding agent: instrument the seek — 2026-09-30T21:35:00+02:00

**Baseline (my own run):** `npm test` → **260/260 pass**, 0 fail. HEAD = `57614f4`,
`app.js` and `tests/` byte-identical to the commit (nothing had moved under me).

**Test count: 260 → 272** (+12, all new, in `tests/seek-measure.test.mjs`).

**CODE CHANGE — `app.js` only, plus one new test file. NOT PUSHED, NOT BUILT.**

| what | where | note |
|---|---|---|
| `cur.seekableEndWrittenAtMs` | `updateSeekableState()`, **2 syntactic sites, 1 function** | the value branch and the no-window branch. One writer, at the assignment it describes. Cleared in the null branch too — a timestamp surviving beside a null `seekableEnd` would let an age be computed against a value that no longer exists |
| `SEEK_MEASURE` record | new module block next to `SEEK_EDGE_DIAG` | every field initialised to `null`, never `0` |
| `seekMeasurement1()` | pure | measurement 1's arithmetic |
| `seekRateFromSamples()` | pure | measurement 2's rates — the ONLY cross-frame comparison |
| `readFreshSeekableEnd()` | pure-ish, try/catch | reads the element, **never** the cache |
| `takeSeekRateSample()` / `start`/`stopSeekRateSampling()` | timer, 10 s | lifecycle tied to the LIVE CHANNEL, not the panel |
| `recordSeekMeasurement()` | called inside `seekToProgramTime()` | at the exact moment `cur.seekableEnd` is read |
| `seekMeasureRecordText()` | pure | the panel rendering |
| `metaDiagReadoutActive` | one writer, in `stopReadout`/`startReadout` | publishes panel-running state to module scope |
| `dvr.seekMeasure` | in `metaDiagBuildSnapshot()` | the record, for the console |

**NOT changed:** `seekToProgramTime`'s target formula, `seekBy`, `seekToLive`,
`playheadWallMs`, `dvrPositionToDate`, `distanceFromLiveEdge`, `atLiveEdge`,
all 7 timing constants, `metaDiagGateOpen()` (byte-identical, md5
`8a852b76801b8b1c23c45a5b56da7108`), `Spelas just nu`, `styles.css`,
`index.html`, `sw.js`. **No correction constant — zero.** Verified by grep.

### A REAL BUG THE TEST CAUGHT, and it is the exact trap the brief warns about

My first implementation computed `seekableRateVsStream = seekableEndElapsed /
streamElapsedMs` where the numerator is in **MEDIA SECONDS** and the denominator
in **MILLISECONDS**. The WS38 test failed with `0.0009` where `0.9` was correct —
a **1000× unit error**. `seekableEnd` is a media-time position, so its elapsed
figure is seconds and must be converted before being divided by a millisecond
figure.

Fixed by converting once, explicitly, and returning BOTH figures
(`seekableEndElapsedS` and `seekableEndElapsedMs`) so the conversion is visible
rather than assumed. A test now asserts the two are consistent. **This would have
put a wrong number on the owner's panel with a confident-looking `0.0000`-class
value**, and it was caught by arithmetic, not by review.

### Mutations — 4, ALL RED, restored by checksum, NO NO-OP

| # | mutation | result |
|---|---|---|
| M1 | age inverted → `cachedWrittenAtMs - nowMs` | **RED** — WS38 M1 |
| M2 | rebuilt the forbidden absolute difference (`seekableEndVsStreamMs`) | **RED ×2** — WS38 M2 + the degenerate-sample guard |
| M3 | "fresh" read made to read the cache instead of the element | **RED** — WS38 M3 |
| M4 | a `null` initialiser changed to `0` | **RED** — WS38 unmeasurable-fields test |

Every mutation was checksum-verified as applied before testing, and the file was
restored to `a03b25e6dd66214b232a18c9aeef9fe4` after each. 272/272 green on the
committed tree.

**PROCESS NOTE, disclosed:** after M3 I ran a combined restore+mutate command
whose `if/then` guard hit a bash syntax error, so **the restore did not execute**
and M3 was still in place when I started M4. I caught it by diffing against the
backup rather than trusting the command's exit, restored explicitly, and redid
M4 from a Python script with a unique-anchor assertion. **No wrong result was
recorded** — the M3 red result was genuine — but the near-miss is recorded
because "the restore ran" is exactly the kind of assumption that destroys work.

### The record, as the owner will read it

Rendered on the Info panel, one field per line, every unit and frame stated
(§4). Actual shape, captured from the live snapshot:

```
seekMeasure: {
  nowMs: null, cachedWrittenAtMs: null, cachedAgeMs: null,      // MILLISECONDS
  cachedSeekableEnd: null, freshSeekableEnd: null,              // MEDIA SECONDS
  freshMinusCachedMs: null,                                     // MILLISECONDS
  startMs: null, behindMs: null,                                // MILLISECONDS
  target: null, requestedTarget: null,
  acceptedPosition: null, clampedByS: null,                     // MEDIA SECONDS
  rate: null, rateSamples: 1,
  note: 'Raw readings. Units: … There is intentionally NO absolute difference
         between seekableEnd and the stream clock anywhere in this record: that
         quantity cannot see seekableEnd and would be the clock bias restated.'
}
```

**FALSIFIABILITY, stated in advance (§2 of the brief):** `streamRateVsWall` and
`seekableRateVsStream` are ratios of elapsed figures. `1.0000` means that frame
advances exactly as fast as its reference. A `seekableRateVsStream` consistently
**below** `1.0000` means the buffered end is falling behind at a measurable rate.
A test asserts the fixture produces `0.9`, i.e. the measurement **can** report
below 1 — so it is not an experiment that cannot fail. A rate of exactly `1.0000`
across several samples would mean either a perfectly tracking buffer or a broken
probe; the record shows `rateSamples` so the owner can tell those apart.

### Browser — what it did and did not cover

Verified I was running **my own code**: served `/app.js` contains
`seekMeasureRecordText`, `seekMeasure`, `seekableEndWrittenAtMs`. (The repo's
`index.html` loads the hashed bundle, which is pre-change.)

- **Panel renders the record** (rendered DOM, asserted): with nothing measured
  it shows `MÄTNING (WS38) — råvärden, ingen tolkning` / `Ingen sökning mätt
  ännu.` / `Fler än en punkt saknas. Samples: N`. **No invented numbers** — the
  WS30/31 property survives.
- **Gate still yields nothing on a shared link:** with `?diag=metadata` but the
  localStorage flag removed, `window.srMetaDiag()` returned **`null`**.
- **Rate timer runs without owner interaction:** `rateSamples` went **3 → 5**
  across 11 s with no interaction, and the panel's own count reached **6**.
- **The degenerate guard works in the wild:** `rate` stayed **`null`** because
  direct MP3 has no seekable range — the code refused to report a rate rather
  than a confident wrong one.

**WHAT THE BROWSER RUN DID NOT COVER — stated plainly.** Chromium fell back to
**direct MP3** (`transport: "direct"`, `MP3 96`; it briefly showed `AAC 192` then
downgraded). So `seekableEnd` is `null`, **no real seek happened**, and
measurements 1, 3 and 4 were **never exercised end-to-end**. They are
**code-proven only**. The rate sampler ran but could not produce a rate. **A
fallback is not a verification.** The HLS conditions exist only on the owner's
iPhone.

### NOT DONE, named as not done

- **NOT PUSHED. NOT BUILT. No deploy.** Committed source + tests only, per the
  owner's explicit instruction and AC17.
- **NOTHING IS MEASURED ON THE DEVICE.** Every field is `null` until the owner
  runs it on a phone playing HLS.
- **NO CONCLUSION IS OFFERED, and none should be read into the numbers above.**
  Three explanations have been withdrawn in this workstream; a fourth confident
  claim is the main risk. The unit bug I shipped and caught is a live example of
  how a plausible number can be wrong.
- **The programme-skip fix is still unwritten** and still depends on a device
  reading this instrument enables.
- **The owner's §0/§8 question is still unanswered** (does the audio start at
  the beginning or partway in; is the title wrong or only the audio).
- I did **not** measure a real HLS rate, decode audio, or perform a real seek.
- I did **not** add `WS38-PROMPT.md` to git — like WS30–WS33 it is **untracked**,
  so a separate coding-agent chat could not have read it.

**WHAT DEPLOYING WOULD PROVE, if it were pushed:** only that the right code is
**SERVED**. It would say nothing about how it **behaves**, and nothing about the
four measurements, which require the owner's phone. **It is not being pushed.**

---

## WS38D — coding agent: deploy the instrumentation — 2026-09-30T22:05:00+02:00

**Authorisation:** the owner authorised pushing `f2cb0b1` **solely** to deploy
the completed WS38 instrumentation, and explicitly **not** to change the seek
algorithm. Verified before pushing; the seek was not touched.

### ONE FINDING WORTH RECORDING FIRST

**This repository has NO GitHub Actions workflow.** There is no
`.github/workflows/` directory and no `.yml`/`.yaml` file anywhere in the tree.
Deployment is by **direct push of built artifacts to the repo root**, which
GitHub Pages serves from `main` — which is how every prior deploy worked
(`52429d4`, `0866897`, `c8f1222`, all titled `build: …`).

So "push so GitHub Actions deploys" could not be executed as written: there is
no workflow to trigger, and adding one would be an unrequested architectural
change (forbidden by this authorisation). **I used the established two-commit
pattern instead** — source+tests at `f2cb0b1`, artifacts separately — which
produces the same production result on the same site. **The tech lead should
correct the mental model: this project does not use CI to deploy.**

### Preconditions (all verified before any push)

| check | result |
|---|---|
| HEAD is `f2cb0b1` | **PASS** |
| `app.js` / `tests/` clean vs the commit | **PASS** (`git diff --name-only HEAD` empty) |
| `npm test` | **PASS** — **272/272**, 0 fail |
| commit contains instrumentation + tests | **PASS** — `app.js` +391, `tests/seek-measure.test.mjs` +505 |
| uncommitted changes altering WS38 | **NONE** — the only dirty files are 3 pre-existing docs and 6 untracked prompt files |
| seek calculation modified | **NO** — verified byte-identical below |
| correction / compensation constant added | **NO** — zero correction identifiers in code (comments stripped) |
| further architectural changes | **NONE** |
| `styles.css` / `index.html` / `sw.js` edited by me | **NO** — `styles.css` md5 unchanged |

**Pre-build safety (§8):** checksums in `/tmp/ws38d-prebuild.md5` and a full
backup in `/tmp/ws38d-backup/` (including `app.d6ac07bb.js`), taken **before**
`npm run build`.

### The four deploy checks — individually

**CHECK 1 — suite green, count unchanged: PASS.** 272/272, 0 fail. WS38 added
12; this deploy changed no source, so 272 unchanged is correct.

**CHECK 2 — read the whole diff: PASS.** Build touched only
`app.d6ac07bb.js` → **deleted**, `app.66f55486.js` → **added**, `index.html`,
`sw.js`. `app.js` and `tests/` untouched.

**CHECK 3 — the served artifact contains the WS38 instrumentation: PASS.**
- `seekMeasureRecordText`: **2** · `seekableEndWrittenAtMs`: **3** · `seekMeasure`: **5**
- `const APP_BUILD = 'f2cb0b1'` — **commit-derived, matches HEAD**
- `index.html` loads `app.66f55486.js`; `sw.js` references it
- dangling references to `d6ac07bb` anywhere in the tree: **none**

**CHECK 4 — the seek was NOT changed: PASS.**
`seekToProgramTime`, `seekBy`, `seekToLive`, `playheadWallMs`,
`dvrPositionToDate` and `updateSeekableState` are all **byte-identical to
`f2cb0b1`**, and `app.js` as a whole is identical to the commit. All 7 timing
constants intact. `styles.css` md5 `c16fb729a99b6d0787dd35132ec8d227`, unchanged.

### Deployment result

**Commits (two):** `f2cb0b1` (source + tests) → `621ae5a` (artifacts).
**Pushed:** `57614f4..621ae5a main -> main`.
**`git ls-remote origin main`** = `621ae5ac2e3e0ebceda4ebefaf3bd5d0cbaab7b1`.

**Build identity:** build id **`f2cb0b1`**, bundle **`app.66f55486.js`**,
service worker cache **`minradio-4a2d80b9`**, artifact commit `621ae5a`.

**Live verification (run against the LIVE CDN file, not the local one):**
| check | result |
|---|---|
| live `index.html` asset | `app.66f55486.js` |
| CDN bundle size | 363,928 bytes |
| CDN `APP_BUILD` | **`f2cb0b1`** |
| CDN `seekMeasureRecordText` | **2** |
| CDN `seekableEndWrittenAtMs` | **3** |
| live `sw.js` cache | `minradio-4a2d80b9` |
| old asset `app.d6ac07bb.js` | **404** |

**Propagation rule applied with BOTH conditions confirmed:** `git ls-remote`
showed `621ae5a` **and** the raw host served the new asset HTTP 200. Only then
was the intermediate state classified as propagating rather than failed.

**RESULT: DEPLOYED.** The WS38 instrumentation is live on the production
GitHub Pages site.

### What deploying proves, and what it does not

It proves the right code is **SERVED**. It says nothing about how it
**behaves**, and it produced **no measurements**. The four measurements are
`null` in production until the owner runs them on a phone playing HLS —
`seekableEnd` does not exist on the desktop, and the seek never ran here.

### NOT DONE, named as not done

- **NO INTERPRETATION.** No measurement was read, and none should be inferred
  from this deploy. Deploying an instrument is not using it.
- **NO CODE CHANGES** were made in response to the deployment. The seek
  algorithm, the record, and every constant are exactly as committed.
- **No GitHub Actions workflow was created**, despite the authorisation naming
  one — it would have been an unrequested architectural change. Recorded above
  as a finding for the tech lead.
- **The programme-skip fix is still unwritten**, and still depends on the
  device readings this deploy enables.
- **Nothing is device-verified.** The owner must confirm the build id reads
  `f2cb0b1` on the main screen before any result is valid.
- **A stale service worker will still serve the old bundle** until the app is
  fully closed and reopened; the owner must be told this.
