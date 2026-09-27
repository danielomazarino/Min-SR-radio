# Min Radio — Fresh Chat Handoff (2026-09-27)

**READ THIS FIRST, then `ENHANCEMENTS.md` (top section, dated 2026-09-27).
The full solved/open/process detail lives there. This file is only a map.**

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
- `main` == `origin/main` == `c1ff941`. Working tree clean.
- **Live 2026-09-27:** `index.html` → `app.429acb4b.js`, `styles.2378cfec.css`,
  SW cache `minradio-5859bf28`, embedded build id `219c38a`. Served bundle is
  byte-identical to the local one (`cmp`), and the tip of `origin/main` is green
  (184/184).
- Suite: **184 tests, 184 pass, 0 fail.**

## What was solved today (do not redo)
Position-aware programme + song titles (WS9) · DVR window **measured at 3 h 1 min**
(WS10) · build id from the source commit (WS10) · DVR readout removed, slider
recovered 61 px (WS11) · frozen `1.5.0` deleted (WS11) · MediaSession now feeds
song/artist/artwork (WS11) · build line back under NYHETER (WS12) · podcast cover
+ mid-player song line (WS12) · close + chevron on the transport row (WS13) ·
episode album cover via the shared iTunes lookup (WS13).

**The forward-skip button works on the owner's phone. Do not reopen it.**

## Open, in priority order
1. **7-button DVR state squeezes `.player-meta` to 0 px** (Chromium, 390 px,
   *constructed* state). Needs an **owner decision**, not another measurement.
2. **Podcast songs never resolve** — SR's `ondemand` returns null timings
   (18/18 tracks, pod 78) and zero tracks for six other podcasts. Upstream. The
   whole podcast track path is therefore **tested but not shown with real data**.
3. **iTunes hit rate on real track data: 73%, 89% of hits correct artist**
   (51 tracks, 4 podcasts). Better than WS12 claimed, but not a guarantee.
4. Carried over: lock screen opens the wrong PWA · P1→P2 mismatch · P2
   metadata/artwork · `scheduleCache` never cleared · `armPlaybackWatchdog`
   has no exhausted guard · E1–E4 enhancements.

## Rules that must survive into the next chat
1. **iPhone is the reference device.** Never state how something looks on the
   phone as fact. Report *what you measured, where, at what viewport, in what
   player state* — labelled Chromium. When a UX question cannot be settled by
   measurement, **stop and ask**.
2. **Quote the owner verbatim; never paraphrase a brief.** A mis-transcription
   of their words cost three workstreams today.
3. **Verify a prior brief's premise yourself before building on it.** WS12's
   "the lookup searches the podcast name" was simply false.
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
