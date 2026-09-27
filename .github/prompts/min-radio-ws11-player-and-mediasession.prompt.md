---
name: Min Radio WS11 — restore the seek row, and feed the car and lock screen properly
description: Removes the DVR window readout that squeezed the slider, moves the build line where it can be seen, and makes the car/lock screen show programme, song, artist and artwork for BOTH live and podcast playback. Also reconciles the stale version number.
applyTo: "**"
---

# WS11 — undo the regression, and fix the metadata that leaves the app

## 0. What the device actually showed (2026-09-27)

The owner confirmed on the iPhone that **WS9's core work is correct**: the
programme title now matches the position, and skipping back and forth to live
works. The forward-skip button — which failed on the device five times across
WS2/WS4/WS6/WS7 — is fixed. **Do not reopen that.**

Two things are wrong, and the owner was right to object to both:

1. **"You have added bottom right on screen information you never told me
   about and was never allowed to. The slider has become shorter too."**
2. The build line is on screen but reads `Version 1.5.0 · bygg 0e6e89b0` — the
   human-facing version is still the decade-stale literal.

**Process failure that caused (1), so it does not repeat.** WS9 Part C was
described as "instrumentation, not a redesign" and "must not move the WS5b
layout", and the reviewer then verified the *header* alignment (title/quality/
song at left=72) and declared the layout intact. **The seek row had been given
a third flex child.** The promise was checked via a proxy, not against the thing
promised. **In this workstream, verify the specific promise: the slider's width
and the seek row's child count, not a neighbouring measurement.**

## 1. Part A — remove the window readout, restore the slider

`app.js:2378` and `app.js:2406`, inside the live/DVR branch of
`renderPlayer()`:

```js
const windowReadout = el('div', { class: 'dvr-window-readout' });
...
seekRow = el('div', { class: 'seek-row dvr-row' },
  timeLeft, bar, windowReadout);
```

`seekRow` is a flex container, so the third child **shares its width with the
slider**. That is the whole cause of the shortened slider.

**Remove the readout entirely from the seek row.** The owner asked for it gone
and for the slider restored to how it looked before WS9.

- `seekRow` must be back to exactly two children: `timeLeft, bar`.
- Delete `windowReadout`, its paint helper, the `.dvr-window-readout` CSS, and
  the `press.windowSeconds` / `dvrWindow` snapshot fields **unless** — see
  §2 — you keep a diagnostics-only copy.
- The WS9 out-of-window readout must **not** be replaced by some other
  visible element. The owner wants the player clean.

**The value is not wasted — move it, do not show it.** The readout is what
*proved* the DVR window is 3 h 1 min, retiring a multi-day enquiry. Keep it
**available in the gated diagnostics snapshot** (`srMetaDiag()`), where nothing
is rendered on screen, so the next person can read it without touching the
player. State in the report where it now lives.

## 2. Part B — the version number, and where the build line sits

Two separate defects:

- **`APP_VERSION` is still the frozen `'1.5.0'`** (`app.js:42`). The About
  overlay (`app.js:3444`) and the build line (`app.js:3421`) both display it.
  Either derive it from the build (so it moves with the code) or remove it from
  the display and show only the build id. **A version string that is frozen and
  presented as a version is a lie; do not leave it.**
- **`package.json` says `1.3.0` while `app.js` says `1.5.0`** — two version
  sources in one repo. Reconcile them, or make one authoritative and document
  which.

**Placement:** the build line is appended to `$main` at `app.js:3419-3422`, at
the very bottom of the home screen. It is visible in the owner's screenshot only
because the player was closed. **Put it somewhere it cannot be occluded or
scrolled away** — near the settings/about affordance is the obvious choice. It
must stay small and dim; it is diagnostic chrome, not content.

**Keep the WS10 build-id mechanism intact** — the short **source** commit, not
the artifact commit. It is now correct (`745493c` = the code commit) and
idempotent. Do not regress it to the artifact commit.

## 3. Part C — the car screen and lock screen (the owner's main ask)

The car head unit and the iPhone lock screen are fed by the **MediaSession API**,
not by our UI. The owner reports the car shows the channel but **not the song or
artist**, and wants artwork on the lock screen.

**Root cause, verified in the code.** `updateMediaSession()` (`app.js:1591-1614`)
builds `MediaMetadata` from **`cur.title` and `cur.subtitle`**:

```js
title: cur.title || 'Min Radio',
artist: cur.subtitle || (cur.kind === 'live' ? 'Sveriges Radio – direkt' : 'Sveriges Radio'),
```

For a live channel those are just the channel name. **It never reads
`nowPlaying.timeline`, `pickByPosition()` or `cur._srProgramTitle`** — i.e.
everything WS9 built is invisible to the car screen. That is exactly the
reported symptom.

Required for **live**:
- `title` = the programme at the playhead, then the song at the playhead (or a
  sensible combination — the owner wants both visible; the car screen shows
  title and artist as two lines, so use **title = song**, **artist = programme
  and/or channel**, and put the channel in `album`).
- Use the **position-aware** values, exactly as the in-app display does. The
  car screen must not disagree with the phone.
- `artwork`: prefer real now-playing artwork (`nowPlaying.artwork`) when
  available; fall back to the channel/programme image, then the PWA icon. Keep
  the existing `sizes`/`type` fields correct.

Required for **podcasts/episodes**:
- The same position-aware song from `episodeCurrentTrack`, which is already
  maintained by `updateEpisodeTrack()`.
- Episode artwork: `ENHANCEMENTS.md` records that episode tracks deliberately
  set `artwork: null`. Do **not** invent artwork; fall back cleanly to the
  programme image, and say in the report what the fallback is.

**The second half, easily missed:** there are currently **seven**
`updateMediaSession()` call sites, all on track load / stop / playstate. **None
fires when the song or programme changes.** Fixing the fields alone would leave
the car screen showing stale text. Refresh it when the position-derived
metadata changes — the `paintNowPlaying()` / `paintProgramTitle()` paths are
the right hooks, since they already compare old vs new before repainting.
Guard against a tight loop: these run on `timeupdate` (~4/s), so refresh only
on an actual **change**, the way the existing change-detection does.

`setPositionState()` (already present, `app.js:1570-1571`) must stay correct for
live streaming: it should report duration 0 / an indeterminate position, not a
fake episode length.

**Verified anchors** (line numbers as of `189117a` — re-check, but correct now):

| what | line |
|---|---|
| `const APP_VERSION = '1.5.0';` (frozen) | 42 |
| `const APP_BUILD = '__APP_BUILD_ID__';` (injected) | 43 |
| `setPositionState` | 1570-1571 |
| `function updateMediaSession() {` | 1591 |
| `const windowReadout = el(` | 2378 |
| `seekRow = el('div', { class: 'seek-row dvr-row' }` | 2406 |
| `$main.appendChild(el('p', { class: 'build-line' …` | 3419-3422 |
| About overlay version line | 3444 |
| `package.json` `"version": "1.3.0"` (disagrees with app.js) | 3 |

## 4. Boundaries — do not touch

- **Seek behaviour.** `seekBy`, `seekToLive`, `seekToProgramTime`, `posMs`,
  `liveEdgeWallMs`, `playheadWallMs`, `pickByPosition`,
  `resolveMetadataForPosition`, the programme-skip lookup, and every DVR
  constant. The skip button works; do not risk it.
- The WS5b player layout beyond the seek row, and the WS5 removal of the
  attribution footer (**do not restore it**).
- The WS0 diag gate, `manifest.webmanifest`, the service-worker strategy.
- No new dependencies. No CI (this repo has none and must not gain any).

## 5. Anti-vacuity rules (four have bitten this project)

1. **Never assert a guard "does not fire" once your change makes it
   unreachable.** WS6 shipped 162 green tests over a 100%-dead button.
2. **A negative result scoped to one direction is not a negative result.** The
   WS8 agent tested only backward seeks and was wrong by 24,947 cases.
3. **A pattern containing a comment can never match a `stripComments()`ed
   slice.** WS9 required `// superseded` in comment-stripped text — vacuous.
4. **Assert the specific promise, not a proxy.** This workstream exists because
   "the layout is intact" was verified by measuring the header instead of the
   seek row.

Also: `region()` searches **forward**, so an end marker appearing *earlier* in
the file returns -1. This has broken the suite repeatedly. Verify every marker
exists and is in order before running.

## 6. Tests and evidence

Required, and each must be able to fail:

- The seek row has **exactly two children**; a mutation adding a third goes red.
- No `dvr-window-readout` element remains in the player; a mutation restoring it
  goes red.
- `updateMediaSession()` reads the position-aware fields, **not** `cur.subtitle`
  alone; reverting either must go red.
- The MediaSession metadata is refreshed **on a change**; removing the refresh
  hook goes red.
- `APP_VERSION` is no longer a frozen literal, and `package.json` agrees.
- All out-of-scope functions in §4 are **byte-identical**. No `||` fallbacks
  between assertions — an `||` between two assertions has twice let a mutation
  slip through green.

**Browser evidence required, and it must be honest.** Chromium cannot load
SR's DVR stream (manifest is CORS-blocked), so the DVR path is unreachable
there. Measure and paste:

- the seek row's child count and the **slider's width before vs after**;
- the MediaSession `metadata.title` / `artist` / `artwork` actually set, for a
  live channel **with a synthesised DVR window** and for a podcast, after a
  simulated song change.

State plainly what is verified and what is not. No iPhone is available to you,
and you cannot prove what a car head unit displays.

## 7. Report format

A status update roughly every 5 minutes, **and no more often**.

Paste, as real output: the mutation table; the before/after slider width; the
MediaSession values for both live and podcast; `md5sum` restore confirmation;
test count before and after; the commit hash.

## 8. Deploy

Commit **without** pushing. Report the hash. I verify all four deploy checks
myself before telling the owner anything is live.
