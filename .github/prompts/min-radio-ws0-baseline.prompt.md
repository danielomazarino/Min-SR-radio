---
name: Min Radio — WS0 Baseline & Evidence Harness
description: Workstream 0 for Min Radio. Add a development-only diagnostics snapshot hook for the live-metadata subsystem, with no behaviour change and no deploy. Establishes the evidence baseline for later root-cause work on channel-switch and programme-skip metadata.
argument-hint: "Runs Workstream 0 only — diagnostics harness, no fixes, no deploy."
agent: agent
---

You are the Min Radio coding assistant. This is **Workstream 0 only** — a
diagnostics harness. It deliberately changes **no user-visible behaviour** and
**ships no fix**. Its only purpose is to make the currently open metadata
reports observable, so that a later workstream can fix a *verified* cause
instead of a guessed one.

## Read first

1. `README.md` — architecture, build/test commands, Pages deployment model.
2. The active work queue at the top of `ENHANCEMENTS.md`.
3. `/memories/repo/discovery-rule.md` if available.
4. The files named below, in full, before writing anything.

## Verified context you may rely on (checked 2026-09-26, do not re-derive)

- Repo: `/home/lm/Dev/SR pwa app`. `main` == `origin/main` at `d54d476`.
- `npm test` currently reports **101 passing, 0 failing**. That is the
  baseline. If your run differs, stop and report it before changing anything.
- `app.js` is ~3370 lines, tracked at repository root and served directly by
  GitHub Pages. There is no bundler step for it; `npm run build` hashes and
  copies it.
- The live-metadata subsystem is `app.js:783-1030`:
  - `nowPlaying` object, `nowPlayingTimer`, `nowPlayingSeq`, `artworkSeq`
  - `stopNowPlayingPoll()`, `fetchNowPlaying()`, `pollNowPlaying()`,
    `startNowPlayingPoll()`
  - `refreshNowPlayingArtwork()` (iTunes Search)
  - `paintNowPlaying()`, `paintProgramTitle()`, `resolveProgramTitle()`
  - `episodeTracksCache`, `stopEpisodeTracks()`, `loadEpisodeTracks()`,
    `updateEpisodeTrack()`
- `playTrack()` is at `app.js:1027`. `advanceCandidate()` at `1120`.
  `stopAndClosePlayer()` at `1179`. `renderPlayer()` at `1587`.
  `enableSwipeToClose()` at `2373`.
- `renderPlayer()` begins with `$player.style.transform = ''` and
  `$player.textContent = ''` (`app.js:1598-1599`). It is invoked from
  `playTrack()`, `advanceCandidate()`, `toggleTrack()`, and audio event
  handlers.
- `seekToProgramTime()` is at `app.js:1565`. `programBoundary()` at `1548`.
  `fetchScheduleDay()` at `1510`, `fetchSchedule()` at `1541`.
- The programme-skip buttons and their `timeupdate` wiring are inside
  `renderPlayer()`, roughly `app.js:2140-2170`. A `timeupdate` listener is
  registered on the singleton `audioEl` there. **Do not fix this in WS0** —
  just make it countable.
- The live track object passed to `playTrack()` for a channel is constructed
  fresh on each tap in `renderHome()`, `app.js:2552`:
  `toggleTrack({ kind: 'live', id, title, subtitle, audioUrl, artwork, description, candidates })`.
- `playlists/rightnow` returns `playlist.song` and also
  `previoussong` / `nextsong` with `starttimeutc` / `stoptimeutc`. The app
  currently parses only `song`'s timestamps into `startMs` / `stopMs`
  (`app.js:881-882`); `previoussong` and `nextsong` are documented in a
  comment at `app.js:786-787` but never read at runtime. **Do not wire them
  up in WS0** — just capture them in the snapshot.
- `state` is declared at `app.js:336`. `DIAG_ID` and the always-on
  `diagLog()` are at `app.js:350-363`; they write to `console` and to
  `localStorage['sr-diag-log']` (capped at 200 entries). **Leave this
  existing mechanism exactly as it is.** It is a separate, pre-existing
  diagnostic for the iOS audio-lifecycle investigation, and it is not gated.
  Your new hook must not extend, replace, reformat or remove it.
- `tests/fixpass.test.mjs` reads `app.js` and `styles.css` **as text** from
  the tracked root and asserts on their source. Several other test files
  follow the same pattern. Write your test in that idiom.

## Task: add one opt-in diagnostics hook

Add a single, self-contained diagnostics function to `app.js` that returns a
JSON-serialisable snapshot of the live-metadata subsystem. It must be
**completely inert unless explicitly enabled**.

### Gating requirement (the important part)

Enable it only when BOTH of these are true:

- the URL query string contains `diag=metadata`, and
- `localStorage['sr-meta-diag'] === 'on'`.

The query parameter alone must not enable it. This two-key gate exists so
that a stray or shared link cannot turn on diagnostics in a normal session.
Document this reasoning in a comment above the gate.

If the gate is closed, the function must do nothing beyond returning `null`
(or an equivalent inert value). No listeners, no timers, no fetches, no
polling, no DOM mutation, no `localStorage` writes.

### What the snapshot must contain

Group it into clearly named sections. Include at minimum:

**Playback / identity**
- `state.current`: `kind`, `id`, `title`, `subtitle`, `_srProgramTitle`,
  `audioUrl`, `codec`, `bitrate`, `transport`, `dvr`, `candidateIndex`,
  and the full `candidates` array with each candidate's descriptor fields.
- `lastPlayingKey`.
- `audioEl`: `currentTime`, `duration`, `paused`, `readyState`, `networkState`,
  `buffered` (as an array of `{start, end}`), `src`.

**Live now-playing**
- The whole `nowPlaying` object: `song` (with `title`, `artist`, `startMs`,
  `stopMs`), `artwork`, `channelId`.
- `nowPlayingSeq`, `artworkSeq`, `nowPlayingTimer` present-or-absent.
- The **raw** last `playlists/rightnow` response body, including
  `previoussong` and `nextsong` with their timestamps, plus the ISO
  timestamp of when it was received. Currently only the parsed subset is
  retained; capture the raw payload at the point of receipt.

**Programme schedule**
- The raw last `scheduledepisodes` response for the active channel and the
  ISO timestamp of receipt, plus the parsed `[{startMs, endMs, title}]`.

**Episode tracks**
- `episodeCurrentTrack`, the keys of `episodeTracksCache`, `episodeTrackSeq`.

**DVR position**
- `state.current.atLiveEdge`, `distanceFromLiveEdge`, `seekableStart`,
  `seekableEnd`, and the derived wall-clock time of the current playback
  position.

**Rendered DOM — the part that matters most**
- For the live site, capture at snapshot time:
  - the text content of `.player-title`, `.player-sub`,
    `.now-playing-line`, `.player-mode`, `.player-quality`,
    `.player-mini` (if present)
  - whether a `.player-expand` panel is open, and its `.expand-label`,
    `.expand-title`, `.expand-sub` and `.expand-img` values
  - `playerMinimized`
  - `$player.className` and `$player.style.transform`
  - the `[data-stream-key]` of every icon currently marked as playing, and
    the `aria-pressed` / `aria-label` of each
- Crucially, give each captured `.player-expand` node a **stable identity**
  (a monotonically increasing id assigned when the panel is created, and
  when it is rebuilt) so a later run can distinguish *the same panel node
  surviving a channel switch* from *a new panel being built from state*.
  This distinction is the single most important thing this hook must make
  observable.

**Listener accounting**
- A count of the listeners the **app itself** registers on the singleton
  `audioEl`, by event type, and the count of listeners it has since removed.
  Instrument the app's own registration sites only. Do not monkey-patch
  `EventTarget.prototype` or any built-in.

**Environment**
- `DIAG_ID`, `href`, `standalone` match-media result, `userAgent`, viewport
  size, and `performance.now()`.

### How to expose it

Provide a console-callable entry point, e.g. a function on `window` that
returns the snapshot and also `console.log`s it as pretty-printed JSON. Also
append one compact line to the existing `localStorage['sr-diag-log']` when
invoked, reusing the existing `diagLog()` so the entry carries the existing
`DIAG_ID` and is distinguishable from other log lines by a clear prefix.
Keep the payload bounded — cap the raw API bodies so a snapshot stays
readable in a console, and say in the output that truncation occurred rather
than silently trimming.

### Tests to add

Add a new test file, `tests/metadata-diag.test.mjs`, in the existing
source-text idiom. Assert at minimum:

1. The gate is present and requires **both** the query parameter and the
   `localStorage` flag — assert that neither alone is sufficient.
2. With the gate closed, the hook performs no side effects: assert the
   source contains no unconditional listener registration, timer creation,
   `fetch`, or `localStorage.setItem` attributable to the hook.
3. The pre-existing always-on `diagLog()` mechanism is untouched: assert
   `app.js` still calls `diagLog()` on page load and still writes to
   `sr-diag-log`.
4. Every required snapshot section is present in the source.
5. The hook does not reference `hls.js`, `hlsAttach`, `hlsDetach` or mutate
   `state.current` — it must be read-only with respect to playback state.

The suite must remain **101 + your new tests** passing, 0 failing. Report the
actual final count; do not assume it.

## Hard constraints

- **No behavioural change.** Do not alter playback, metadata resolution,
  polling, rendering, scheduling, candidate fallback, MediaSession, or the
  existing `diagLog()` lifecycle instrumentation. If you believe a
  behaviour fix is needed, leave a comment and report it — do not fix it.
- **No new dependency.** Vanilla JS, no packages, no build-tooling change.
- **No network calls** added to normal operation. Raw API capture must reuse
  responses that already arrive through the existing fetches, not add new
  requests. The hook must not poll.
- Do not wire up `previoussong` / `nextsong` for display. Capture only.
- Do not fix, refactor or "tidy" the `timeupdate` listener in
  `renderPlayer()`. Count it; leave it.
- Do not modify `styles.css`, `index.html`, `sw.js`, `manifest.webmanifest`,
  `scripts/`, `server.js`, or any other test file.
- Do not update `README.md`, `ENHANCEMENTS.md` or `SESSION-HANDOFF.md`.
- **Do not commit. Do not push. Do not deploy.** The user has not authorised
  any of these. Leave the change in the working tree and report `git status`.
- Do not run `npm run build` — it rewrites tracked root build outputs and
  that would muddy an otherwise diagnostics-only diff. Run `npm test` only.

## Test instructions to run and report

```bash
cd "/home/lm/Dev/SR pwa app"
git status -sb
git --no-pager log --oneline -3
npm test
git status --short
git --no-pager diff --stat
```

Confirm from the output: baseline was 101 passing before your change; the
final run is 101 plus your new tests with 0 failures; and `git diff --stat`
touches **only** `app.js` and the new test file.

## Manual verification, if you can reach the running app

You do **not** need a browser, and you must not deploy to do this. If a local
preview is convenient, `npm start` serves the tracked root on port 3000.
Otherwise report the verification as not performed — that is an acceptable
answer and preferable to guessing.

If you do verify locally: confirm that with no query parameter and no
`localStorage` flag, nothing is logged and no new state appears; and that
with both enabled, a snapshot can be taken on a plain page load. Note that
live channel metadata and a real expand panel require actual audio playback,
which a headless check cannot honestly establish — say so rather than
implying it was verified.

## Final report format

Report in plain English, for a product owner who will not read raw tool
output:

1. What you added, in one paragraph, and the exact gate condition.
2. The final test count, and confirmation that the pre-change baseline was
   101 passing.
3. `git status --short` output, confirming only `app.js` and the new test
   file changed.
4. What you did **not** verify, stated plainly. Specifically: whether any
   browser or device was used at all, and whether real audio playback was
   exercised.
5. Any behaviour defect you noticed while reading but deliberately did not
   fix, described as a hypothesis with the evidence that supports it.

Do not claim the harness has diagnosed anything. It has only been installed.
The actual root-cause work is Workstream 1 and is not authorised yet.
