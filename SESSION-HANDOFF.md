# Min Radio — Fresh Chat Handoff (2026-09-28, end of day)

**READ THIS FIRST, then the `## START HERE` block at the top of
`ENHANCEMENTS.md`, which is the current authority. The full solved/open/process
detail lives there. This file is only a map.**

## Roles and fresh chats
- **Min Radio Tech Lead** chat for evidence gathering, API/source discovery,
  prioritization, test strategy, review, and user-facing status.
  Instructions: `.github/agents/min-radio-tech-lead.agent.md`.
- **Min Radio Coding Assistant** chat for one bounded implementation assigned
  by the lead/user. Instructions: `.github/agents/min-radio-coding-assistant.agent.md`.
- Either can start from `.github/prompts/min-radio-new-session.prompt.md`.
- Repo rules and queue: `README.md`, `ENHANCEMENTS.md`, `/memories/repo/`.

## Where the project is
- Static vanilla JS/CSS/HTML PWA, no backend. GitHub Pages serves the **repository
  root of `main`**. **No CI and no GitHub Actions — a push IS the deployment.**
  (An earlier handoff claimed a Pages workflow `35934340021` succeeded. That is
  false; `git log --all -- .github/workflows` is empty. Do not repeat it.)
- `main` == `origin/main` == `ed95719`. Working tree clean.
- **Live 2026-09-28:** `index.html` → `app.ac2dc64a.js`, `styles.f420a62b.css`,
  SW cache `minradio-53351f32`, embedded build id `72efbb0`. Served bundle is
  byte-identical to the local one (`cmp`), and the tip of `origin/main` is green.
- Suite: **201 tests, 201 pass, 0 fail.**
- **No source code changed after WS21.** Everything later in the day was
  investigation and documentation only, so the live bundle is WS21's.

## What was solved today (do not redo)
Position-aware programme + song titles (WS9) · DVR window **measured at 3 h 1 min**
(WS10) · build id from the source commit (WS10) · DVR readout removed, slider
recovered 61 px (WS11) · frozen `1.5.0` deleted (WS11) · MediaSession now feeds
song/artist/artwork (WS11) · build line back under NYHETER (WS12) · podcast cover
+ mid-player song line (WS12) · episode album cover via the shared iTunes lookup
(WS13) · **chevron + close back on the header, right-grouped (WS14)** ·
**podcast restarts on channel switch (WS17)** · **yesterday's schedule merged
across midnight (WS18)** · **pill off-screen with a long song (WS19)** ·
**slow rolling song line (WS19/WS20)** · **episode name restored to the header
(WS20)** · **the `…` was the ellipsis, not missing data (WS21)** ·
**yesterday-gate now opens on the clock (WS21)**.

**Three regressions I introduced on 2026-09-28 and the owner caught** — see the
`### Regressions I introduced` section in the log. The lesson: a real observation
is not a mandate to act, and reversible is not the same as wanted.

## Open, in priority order
1. **Pre-midnight programme title.** Yesterday's schedule is fetched and merged;
   whether the title updates on a real DVR seek is unverified. Decisive check:
   `?diag=metadata` → `schedule.gate.fetchedDays`.
2. **Earlier played songs missing on live radio** (owner-reported, item 4c).
   Investigated: the code did **not** regress, the limit is SR's data
   (`previoussong` is a single object, `rightnow` is time-agnostic). Decisive
   check: `?diag=metadata` → `songTimelineLength`.
3. **320px is not fixed.** `.player-meta` is 4.0px there and the pills paint
   outside their box again. Same mechanism, deferred, not removed.
4. **Header buttons are 32px, under the 44px iOS tap-target guidance.** A
   deliberate trade for title width. Needs a real-device check.
5. **Podcast songs never resolve** — SR's `ondemand` returns null timings
   (18/18 tracks, pod 78) and zero tracks for six other podcasts. Upstream. The
   whole podcast track path is therefore **tested but not shown with real data**.
6. **iTunes hit rate on real track data: 73%, 89% of hits correct artist**
   (51 tracks, 4 podcasts). A measurement, not a guarantee.
7. Carried over: lock screen opens the wrong PWA (**never root-caused**) ·
   global podcast search (brief in the log) · **E1b buffer/tunnel stop**
   (promoted out of E1, uninstrumented) · `scheduleCache` never cleared ·
   `armPlaybackWatchdog` has no exhausted guard · E1–E4 enhancements.
8. **Android Chrome untested.** I have no Android device and cannot verify it;
   only the owner can close it.

**Three items were reported solved and two were confirmed by me, one could not
be verified at all** (item 8). Details and evidence in the log.

## Rules that must survive into the next chat
1. **iPhone is the reference device.** Never state how something looks on the
   phone as fact. Report *what you measured, where, at what viewport, in what
   player state* — labelled Chromium. When a UX question cannot be settled by
   measurement, **stop and ask**.
2. **Quote the owner verbatim; never paraphrase a brief.** A mis-transcription
   of their words cost three workstreams today.
3. **Verify a prior brief's premise yourself before building on it.** WS12's
   "the lookup searches the podcast name" was simply false. And in WS13 I
   re-broke a defect WS12 had already measured and fixed, because a later
   sentence in a brief sounded like a command. **A measurement recorded in
   the codebase outranks a brief that appears to contradict it**, until
   someone explains why it stopped being true.
4. **Commit source and its tests in ONE commit**, then build, then commit
   artifacts. Before pushing, **clone `origin/main` and run the suite at the
   tip** — WS12A left `main` failing for exactly one commit.
5. `region()` searches forward; anchor it on the declaration of the element
   under test. Mutation harnesses must compare **md5 before and after**.
6. An unverified claim, duplicated, becomes indistinguishable from an observed
   one. Don't copy a rationale into more than one place without asking whether
   it was ever true.
7. A check that cannot fail is not evidence. `document.scrollWidth` stays under
   the viewport even while a flex row overflows internally.
8. **"The owner instructed X" is a claim about a person — verify it like any
   other claim.** A memory note is not a source. On 2026-09-28 I twice wrote
   that the owner had said something they had not; grepping the transcript
   (`type: "user.message"`, text at **`data.content`**) disproved it both times.
9. **"The owner says it's solved" is also a claim — go and check.** Two of three
   such items on 2026-09-28 were confirmed, and the third (Android) turned out to
   be unverifiable by me at all.
10. A shipped fix with no log entry is invisible to the next session. Diff
   `git log` against the entry list at the end of any session. WS17 was missing
   for exactly this reason.
11. A **backgrounded page freezes CSS animations.** Never measure animation
   timing through an unfocused tab; use `getAnimations()[0].currentTime`.

## Deploy order (getting this wrong mislabels the build id)
`npm test` → `git add` source + tests (one commit) → `npm run build` →
`git add -A` artifacts → `git push origin main` → four deploy checks **after** a
wait loop, plus the suite at the tip of `origin/main`.

A commit without a fresh build deploys nothing. `index.html` loads the **hashed**
bundle; `app.js` is only the build input.

**Never modify (byte-identical to `git show 745493c:app.js`):** `seekBy`,
`seekToLive`, `seekToProgramTime`, `posMs`, `liveEdgeWallMs`, `playheadWallMs`,
`pickByPosition`, `resolveMetadataForPosition`, the programme-skip lookup,
`DVR_MIN_WINDOW_S`, `LIVE_EDGE_TOLERANCE_S`, `SEEK_STEP_S`.

## Tell the owner
> På telefonen: avregistrera service workern eller hard-reload. En gammal service
> worker fortsätter att servera den gamla layouten och låter en bra deploy se ut
> som trasig.
