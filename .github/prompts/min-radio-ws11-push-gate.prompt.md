---
name: WS11 push gate — verify then deploy
description: Run after WS11 and WS11a. Verifies the two specific promises that can break silently, then pushes. The push IS the deploy.
applyTo: "**"
---

# Deploy gate — verify, then push

You have just finished WS11 and WS11a. Both are committed locally. **The push is
what deploys to the owner's phone**, so this is the last checkpoint. Do not
improve, refactor or extend anything here. Verify, then push.

## The two things that can break SILENTLY

The full test suite is not what protects these. Both have already broken once
with a green suite, so measure them directly.

### 1. The text alignment in the player header (WS5b)

The title, the quality badge and the song line are **not** aligned by a margin.
They line up because the close button was doing double duty as a **spacer**,
given the artwork's own width via `--player-art`. So when you moved that button
to the controls row, the space could have collapsed — and the tests would not
have noticed.

**Measure it. Do not infer it from the tests.**

- `getBoundingClientRect().left` of `.player-header .player-title`,
  `.player-quality`, and `.now-playing-line`
- the **spread** between the leftmost and rightmost of those three
- the player's height before vs after (removing a row should make it shorter)

Before WS5b the spread was 112px; the target is **0px**. If the spread is no
longer 0, the spacer was removed without being replaced. **That is the single
most important number in this gate.**

If a spacer was used, confirm it derives from `--player-art` and is not a
hardcoded pixel literal — a literal will drift the moment that value changes.

### 2. The slider width (WS11 Part A)

WS9 added a third flex child to the seek row, which took ~61px from the slider.
Part A removed it. Confirm the seek row has **exactly two** children and that
the bar's width is back to its pre-WS9 value.

## Then

- Confirm the working build is what is committed: `npm run build`, and check the
  build id names the **source** commit, not the artifact commit. If the
  artifacts are stale, rebuild and commit them **before** pushing.
- Run the suite once. The owner asked to skip the full battery of *new* tests,
  not to ignore a red suite. If anything is red, **stop and report** — do not
  push.
- Confirm the out-of-scope seek functions are byte-identical to before WS11:
  `seekBy`, `seekToLive`, `seekToProgramTime`, `playheadWallMs`,
  `pickByPosition`, `resolveMetadataForPosition`, the programme-skip lookup and
  every DVR constant. **The forward-skip button works on the owner's phone; do
  not put that at risk.**
- Confirm the WS5 attribution footer is still absent.

## Push

Push to `origin main`. Then report the commit that is now live, the bundle
filename, the cache name, and the build id embedded in the served bundle.

I will independently verify all four deploy checks and confirm to the owner.

## What to tell the owner

State plainly:

- what is now on their phone, and
- **the podcast path is still unverified.** Sveriges Radio's `programmes`,
  `podcasts` and `episodes` endpoints were returning HTTP 500 during WS11 (while
  `channels` stayed 200), so the episode branch could not be exercised. It was
  traced offline by retyping the same expressions, which cannot catch a typo in
  the shipped function. Do not describe podcasts as working.

No device is available to you. Do not claim the car head unit or the lock screen
displays anything — you can only prove what the app hands to the system.
