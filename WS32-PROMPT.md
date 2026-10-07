# WS32 — build and deploy, then get a real reading on the phone

**From:** tech lead. **To:** coding agent (Space Bunny), in your own chat.
**Date:** 2026-09-30. **Baseline when written:** `main` = `84d22a6` (local,
**not pushed**), suite **253/253**, tree clean except `ENHANCEMENTS.md`.

Read `AGENTS.md` first — it is auto-discovered for you. Then this brief.

---

## 0. The state you are inheriting

WS30 and WS31 are **committed as `84d22a6`**. I reviewed it and independently
mutation-tested the committed tree:

| my mutation | result |
|---|---|
| revert the panel to the tautology (the exact WS29 defect) | **7 fail** |
| show "start a channel" while a channel plays (the WS31 defect) | **1 fail** |
| plant `STREAM_EDGE_CORRECTION_S = 28` | **2 fail** |

Every hard criterion passed: `metaDiagGateOpen` byte-identical, all 7 timing
constants unchanged, **zero correction constants**, no deployable artifact in the
commit, security gate still yields `null` on a shared `?diag=metadata` link.

**Your equivalent-mutant finding on M16 was the right call and I am recording it
as such:** you established it was genuinely unobservable (an episode never
carries a `transport`, so `onHls` is always false for a podcast) rather than
dropping the failing mutation or inventing a world. That is what `AGENTS.md` §2
asks for. I would have quietly dropped it.

**`origin/main` is still `0cb7f0d`. Nothing is pushed, nothing is built, and the
owner is still on the WS29 build.** That is the whole point of this workstream.

---

## Part 1 — BUILD, and verify the artifact actually contains the change

**`dist/` is currently a stale mix and the tracked root artifacts are the WS29
build.** `npm run build` rewrites tracked root files, so:

1. **Commit before you build.** `84d22a6` is already committed, so you are safe —
   but confirm `git status` shows no uncommitted source first. If `ENHANCEMENTS.md`
   is still dirty, that is fine and expected; it is mine and it is not a Pages
   artifact.
2. **Back up the tracked artifacts to `/tmp` and record their checksums** before
   building. `AGENTS.md` §8 — a `git checkout --` after a build has destroyed
   uncommitted work three times in this repo.
3. Run the build.
4. **Verify the hashed bundle, not the source.** `AGENTS.md` §8 and the trap that
   nearly invalidated your entire browser run: **grep the BUILT file** for
   `twoSource`, `parseVariantEdge`, `trueEdgeWallMs` and the new
   `no-stream-clock` state. A green build is not evidence the change shipped.
5. **Regenerate `dist/` properly** as part of the build, so the dev server stops
   serving the stale mix. If `dist/index.html` still points at an old hashed
   bundle after the build, **say so and stop** — that is exactly the trap.

Report the new artifact filenames and the new build id.

### 1a. I HAVE ALREADY DRY-RUN THIS BUILD. It is de-risked — here is the reference.

I did **not** ask you to take the build on trust. I ran `npm run build` in a
throwaway `git archive` checkout of `84d22a6` (`/tmp/ws32-buildtest`, outside
this repo, so your working tree was never touched) and measured the result. **Use
this as the expected outcome, and treat a DIFFERENCE as a finding to report.**

| what | expected value I measured |
|---|---|
| `app.js` bundle | `app.39e44300.js` → **`app.233f96c9.js`** (old one deleted) |
| `styles` bundle | `styles.a7560d22.css` → **unchanged** (no CSS changed) |
| `index.html` | points at `app.233f96c9.js` only |
| service worker cache | `minradio-669f505b`, precaching the new hash |
| `dist/` | regenerated; `dist/index.html` → `app.233f96c9.js` |
| build id | a new 7-char id, injected into the bundle |
| suite in the built tree | **253/253, 0 fail** |
| `metaDiagGateOpen` in the **hashed bundle** | `be2d044f40b3b74c4ed68c75229a3c25` — **identical to source and to pre-WS30** |
| 7 protected constants in the artifact | all 7 identical |
| correction constants in the artifact | **0** |
| dangling refs to the deleted bundle | **none** |

**The build is mechanical and it is safe.** Two things it does that you must
expect and must not "fix":

- **It deletes the old hashed bundle and writes a new one.** That is correct —
  the old file being gone is the point, and `index.html` is rewritten to match.
  Do not restore it.
- **The build id is timestamp-derived** because git was unavailable in my
  throwaway checkout, so mine printed `tmunx1fp3`. **Yours will differ** — it is
  derived from the commit. **The build id is what the owner checks on the phone,
  so report yours explicitly and use only yours in any instruction.**

`npm run build` also runs `node --check` on `app.js`, `src/episode-seek.mjs`,
`sw.js` and `tests/fixpass.test.mjs` before building, so a syntax error fails the
build rather than shipping.

## Part 2 — run the deploy checks, individually, and report PASS/FAIL each

`AGENTS.md` §15. **A green suite is not one of these checks; it is a
precondition.** Report each as PASS or FAIL — never "deployed successfully".

1. Suite green **and the test count went up** — 253 is the number; it did not go
   up for this workstream, so say so explicitly rather than claiming it.
2. **Read the whole diff yourself.** The build will add/changed hashed bundles
   and `sw.js`. **Name every file that changed.** If anything outside the
   expected set moved, stop and say so.
3. **Drive it in the built-in browser against the BUILT artifact** and assert on
   the **rendered DOM text**, not source. The direct-MP3 path should render
   *"Direkt ljud — ingen strömklocka att jämföra med"*, and with nothing playing
   *"Starta en radiokanal först"*. **State what your run did and did not cover** —
   in particular that the HLS measurement path still cannot be exercised on
   desktop.
4. The stated defects are actually fixed: the panel no longer shows a
   self-referential number, and no longer says "start a channel" while one plays.
5. **Nothing else moved.** Spot-check the neighbours: the transport row, the poll
   interval, the schedule, the timing constants.
6. **The build produced the artifacts it should**, and the hashed bundle contains
   the change (Part 1 step 4).
7. **Then** commit the artifacts, push, and re-run the checks against the **live**
   site. A 404 or a stale asset on a fresh push means *propagating*, not
   *failed* — but only after the commit is confirmed on the remote and the asset
   serves 200 from the raw host.

### 2a. The live baseline, measured by me — check against this, do not assume

The remote is `github.com/danielomazarino/Min-SR-radio`, so the Pages URL is:

```
https://danielomazarino.github.io/Min-SR-radio/
```

**Measured by me just now, before you start:**

| | live today |
|---|---|
| HTTP status | **200** |
| JS it serves | **`app.39e44300.js`** |
| CSS it serves | `styles.a7560d22.css` |
| build id in that bundle | the **WS29** build |

**So the owner is on the WS29 build and always has been.** After your push, the
live site must serve **`app.233f96c9.js`** (or whatever your build produces).
**If it still serves `app.39e44300.js`, the deploy did not land** — that is the
single most important check in this workstream, because it is the one that
determines whether the owner's phone is even running the code we reviewed.

**The propagation rule, and it is not optional:** a 404 or a stale asset on a
fresh push means **propagating**, not *failed* — but only after BOTH of these:

1. the commit is confirmed on the remote (`git ls-remote origin main`), **and**
2. the asset serves **200 with the new content** from
   `raw.githubusercontent.com`.

If either fails, it is a real failure, not propagation. Do not report
"propagating" as a way of describing an unreached deploy.

**Deploying proves the right code is SERVED. It says nothing about how it
BEHAVES.** The owner's iPhone is still the only thing that can settle behaviour,
and they must be told which build id to check — theirs, from their build, not
mine.

## Part 3 — the two defects the last agent found, and named as NOT DONE

It reported both of these correctly and left them alone. Now they get addressed.
**This is a small, bounded change — do not widen it.**

### 3a. Any internal error is reported as "no channel"

`app.js` ~6024:

```js
try { snap = metaDiagBuildSnapshot(); } catch { snap = null; }
```

A throw anywhere in the snapshot builder becomes **"Starta en radiokanal
först"** — the same class of untruth WS31 just fixed, one level deeper. The last
agent's own driven probe recorded this world explicitly:

| world | state | primary |
|---|---|---|
| snapshot THROWS | `no-stream` | "Starta en radiokanal först" |

**This is now the most likely reason a future session sees a nonsense panel
state**, so it should not stay.

- Distinguish *"the snapshot could not be built"* from *"nothing is playing"*.
  They are different facts and the owner can act on only one of them.
- **Show no number**, exactly as now — you are fixing a wrong *label*, not adding
  a reading.
- Keep the real no-channel message for the genuine no-channel case.

### 3b. `dvr.seek` does not exist, so one line can never render

Verified twice now, by me and by the last agent: **0 occurrences of a `seek:`
key inside the snapshot's `dvr:` block.** So *"Sökningen ändrades av webbläsaren
med … s"* is **dead UI** carried over from WS29 — a seek clamped by the browser
is never reported.

**Decide, do not guess.** Two legitimate options, and I am not choosing for you
because I have not measured which is right:

- **(i) Remove the line.** It is unreachable; a dead branch is worse than none.
- **(ii) Wire it to the real source.** If a clamp value exists elsewhere in the
  snapshot — `backToLive`, the seek-edge diagnostics, `SEEK_EDGE_DIAG` — expose
  it under `dvr.seek` and the line starts working.

**If you choose (ii), you must prove the value is real**, not that the key
exists. A test that asserts a key is present, on a path nothing writes, is the
§7a reachability trap and it has bitten this repo twice. **If you cannot prove it
reachable, choose (i) and say why.**

### Out of scope

- **No correction constant.** Still zero. `AGENTS.md` §5.
- **No change** to `seekToProgramTime`, `seekBy`, `seekToLive`,
  `playheadWallMs`, `dvrPositionToDate`, the 7 timing constants,
  `metaDiagGateOpen`, or `activeHlsMasterUrl`'s HLS requirement.
- R5, the false `DATERANGE` comment, the `Spelas just nu` label, Android, E1b,
  podcast search, the lock-screen-wrong-PWA item.
- **Do not attempt to fix the ~25 s programme-skip offset.** It is unfixed and
  that is correct. A device reading comes first.

## Part 3c — THE REGRESSION CHECKLIST (the owner's standing instruction)

The owner approved this workstream on one condition, verbatim: **"I approve the
needed changes as long as you verify that no regression errors happen due to it.
Safety before speed."** So this is a required deliverable, not a courtesy.

**Run every line and report PASS/FAIL individually.** Each is cheap; skipping one
is how a deploy breaks something that was working.

| # | check | how |
|---|---|---|
| R1 | suite green **and** count ≥ 253 | `npm test`, report both numbers |
| R2 | the two WS30/31 defects are still caught | **re-run the red proof** — revert the panel to the tautology, and restore `"Starta en radiokanal först"` for a playing non-HLS channel. Both must go red. Restore by checksum. |
| R3 | gate fn byte-identical | `be2d044f40b3b74c4ed68c75229a3c25`, in **source and in the hashed bundle** |
| R4 | 7 timing constants identical | compare against `0cb7f0d`, one by one |
| R5 | **zero** correction constants | grep in source **and** in the built bundle |
| R6 | transport row unchanged | `±15 s` buttons, programme-skip buttons, play — same handlers |
| R7 | the 45 s now-playing poll unchanged | `NOW_PLAYING_INTERVAL_MS` and its call sites |
| R8 | the schedule fetch unchanged | `fetchSchedule` / `fetchScheduleDay` untouched |
| R9 | seek behaviour unchanged | `seekToProgramTime`, `seekBy`, `seekToLive` byte-identical |
| R10 | both panels render the two new honest states | browser, **rendered text** |
| R11 | the security gate still yields nothing on a shared link | browser: `?diag=metadata`, no flag → `null` |
| R12 | no dangling reference to the deleted bundle | grep the whole tree for `39e44300` |

**R2 and R12 are the two that have historically caught real problems here.** R2
is the only thing that distinguishes "the tests pass" from "the tests can fail on
this defect". Do not report a regression check you did not run — a check that
cannot fail is not a check, and this repo has three of those already.

## Part 4 — the owner protocol (the owner is non-technical, on an iPhone)

**Every label below I have verified in the source. Use these, not glyphs.**

1. Confirm the small build line under NYHETER reads **the build id you report**.
   If it does not, they are testing old code — a stale service worker has
   silently invalidated a whole session's results before.
2. Start **any** radio channel.
3. ⚙️ cog → **Info** → scroll to the bottom → turn on **Visa tidsdiagnostik**.
4. **Read the number, and the age beside it**, and report **both, with the build
   id.**
5. If it shows a **non-numeric state**, report **that exact state.** It is a
   result, not a failure — and after 3a there are more honest states than
   before, which is the point.

**Button aria-labels, verified in source:** `Till föregående programs start` /
`Till nästa programs start` = the **programme skip** (the circular arrows ↺ ↻
either side of ▶). `Bakåt 15 sekunder` / `Framåt 15 sekunder` = a plain ±15 s
step. A previous brief of mine named the wrong pair and wasted a measurement.

**One question only the owner can answer, and it decides the next workstream.**
The ~25 s programme-skip offset has been reported as *"it lands early"*. The
arithmetic says the app's target would sit ~28 s **later** than intended — which
would be *late*, not early. Those disagree, and I will not let a number be used
to "confirm" a sign until the owner is asked. So ask, in the owner's own terms
and without leading them:

> When you skip to a programme, does the audio start **at the beginning of the
> programme**, or does it start **partway in / before the beginning**? And is the
> **title** wrong, or only the **audio**?

**A disagreement is a useful answer.** Do not resolve it by picking the reading
that fits the arithmetic.

**How to describe the number to a non-technical owner — use these words:**

- It is the difference between **what the app thinks** the stream's end is, and
  **what the stream itself says** it is.
- It is **not** a diagnosis of the bug. Do not call it "the bug" or "the fault".
- Say plainly: **"we can now measure this for the first time; we have not yet
  fixed it."**

**Button aria-labels, verified in source:** `Till föregående programs start` /
`Till nästa programs start` = the **programme skip** (circular arrows ↺ ↻ either
side of ▶). `Bakåt 15 sekunder` / `Framåt 15 sekunder` = a plain ±15 s step.
A previous brief of mine named the wrong pair and wasted a measurement.

**A note on interpretation, and it matters.** The number you will read is the
difference between the app's belief about the stream edge and the stream's own
clock. **It is not yet a diagnosis of your defect.** Do not describe it to the
owner as "the bug". It settles one question — *is the app's edge belief biased,
and by how much* — and that is a genuine step, but the ~25 s programme-skip
offset and the 10–15 s song-title offset remain **unfixed and unexplained**.

## Acceptance criteria

1. Build run **after** the commit, artifacts backed up and checksummed first.
2. The **hashed** bundle contains `twoSource` / `no-stream-clock` — grepped, not
   assumed. `dist/` regenerated, not a stale mix.
3. Suite green at **253 or higher** from the committed tree.
4. 3a fixed: a snapshot error no longer reads as "start a channel". New test,
   proven red, restored by checksum.
5. 3b decided **and justified**, with reachability **proved** if you chose (ii).
6. **Zero correction constants**, in source and in the built bundle.
7. `metaDiagGateOpen` byte-identical; 7 timing constants unchanged.
8. **The Part 3c regression checklist: all 12 reported individually as PASS or
   FAIL.** A check you did not run is reported as **NOT RUN**, never as PASS.
9. Deploy checks reported **individually** as PASS/FAIL, plus **your** build id
   for the owner to check on the phone.
10. Report in `AGENTS.md` §9 form: **CODE CHANGE** / **MEASURED** /
    **NOT DONE**. Never "verified" for offline proof — use *fixture-proven*,
    *code-proven*, *browser-driven*, *device-verified by the owner*.

## Stop conditions

Stop and report rather than guess if:

- the build changes a file outside the expected artifact set;
- the hashed bundle does **not** contain the change after a successful build;
- `dist/index.html` still references a stale bundle after the build;
- **any Part 3c regression check FAILS** — that is the owner's condition, and a
  failed check is information, not an obstacle to work around;
- 3b (ii) turns out to need a value nothing writes — **that is the §7a trap;
  report it and choose (i)**;
- the suite goes red for a reason you did not cause. **Do not "fix" a test to
  get to green.** Classify it per `AGENTS.md` §7b first and say which it is.
- the live site still serves `app.39e44300.js` after a confirmed push — say so
  plainly as a **failed deploy**, not as propagation, unless both propagation
  conditions in §2a are met.

**The offset is still unmeasured on the device and still unfixed.** This
workstream makes the instrument visible and deployable. That is all it does.
