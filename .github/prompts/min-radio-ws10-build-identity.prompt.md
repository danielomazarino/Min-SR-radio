---
name: Min Radio WS10 — show the build identity on the main screen
description: The About screen says "Version 1.5.0" on every build, so neither the owner nor the agent can tell which code a device is running. Make the version track the build and put it on the main screen where the WS5 attribution footer used to be.
applyTo: "**"
---

# WS10 — make the build identifiable from the device

## 0. Why this exists

On 2026-09-27 the owner asked whether we were "committing and pushing the wrong
code sets to deployments", because WS9 made the forward skip work while the
programme titles still did not appear. The deploy was provably correct — I
verified the served bundle was **byte-identical (same md5)** to the local build
and came from the right commit. The confusion was caused by something else:

**`APP_VERSION` is `'1.5.0'` and has not changed since commit `0f18213`, long
before any of WS6–WS9.** So the About screen reads "Version 1.5.0" on *every*
build. Neither of us could tell which code a device was actually running, and
that ambiguity has recurred across at least three workstreams.

**This workstream is small, safe, and unblocks every future device test.** It
touches no playback, seek or metadata logic.

**Verified anchors** (line numbers as of `6fa2255` — re-check, but correct now):

| what | line |
|---|---|
| `const APP_VERSION = '1.5.0';` | 30 |
| the WS5 "attribution NOT re-added" comment in `renderHome()` | 3393-3395 |
| `updatePlayingMarks();` (insert the build line before this) | 3397 |
| `Version ${APP_VERSION} · Utvecklad av …` in `openAbout()` | 3417 |
| build-script content-hash step (the circularity constraint) | 58-63 |

## 1. Part A — the version must actually change per build

`app.js:30` currently has:

```js
const APP_VERSION = '1.5.0';
```

**Do not simply bump it by hand.** That recreates the same problem one release
later, and a hand-bumped string is not evidence of anything.

Instead, derive a **build identity** at build time and inject it, so the number
on screen corresponds to the code that is actually running.

**The circularity constraint — read carefully.** `scripts/build-pages.mjs` reads
`app.js`, writes `dist/app.js`, and **then** computes the content hash used for
`app.<hash>.js` (lines 58-63). If the injected build id were derived from the
final `app.js` content hash, injecting it would change the content, which would
change the hash, which would change the id — an infinite loop.

So derive the build id from something **stable and external to app.js's own
bytes**. Acceptable sources, in order of preference:

1. The **git commit** the build was made from (short SHA). This is the most
   useful to us: it is exactly what I verify against `origin/main`.
2. A **build timestamp**, if the commit is unavailable.

Read it in `scripts/build-pages.mjs` and inject it into `dist/app.js` as a
replacement of a clearly-marked placeholder. Keep the repo-root `app.js`
authoring file free of generated values — the build already treats `dist/` as
generated output, and the root `app.js` is the input.

**Requirements:**

- The About overlay (`app.js:3417`, `Version ${APP_VERSION} · Utvecklad av …`)
  must show the real build identity.
- The **repo-root `app.js` must not contain a hardcoded build hash** — it is
  overwritten by the build, and a stale literal there is a lie waiting to
  happen. Assert this in a test.
- The build must be **idempotent**: running it twice on an unchanged tree must
  produce the same result, and must not append a second copy of the value.
- If git metadata is unavailable (e.g. a shallow clone or a tarball), fall back
  to a timestamp rather than failing the build, and make the fallback visible in
  the output so a silent degradation is not mistaken for a real build id.

## 2. Part B — show it on the main screen

The owner asked for this explicitly: the build identity should be **visible on
the main screen during testing**, not buried behind a menu.

There is an exact, intended slot for it. WS5 **removed** a footer attribution
from the end of `renderHome()` and left this comment behind (`app.js:3393-3395`):

```js
// The footer attribution was removed (WS5): the About/Settings overlay
// already carries the same attribution plus the independent-app
// disclaimer, so nothing is lost. Intentionally NOT re-added here.
```

Add a **small, quiet build line** at the end of `renderHome()`, immediately
before `updatePlayingMarks()` (which is at `app.js:3397`).

Constraints:

- **This is not the old attribution footer.** Do not restore the removed
  attribution, link, or disclaimer — WS5 removed those deliberately and the
  About overlay still carries them. Add only the build identity.
- **It must be unobtrusive**: small, dim, and out of the way. It is diagnostic
  chrome, not content. It must not compete with the channel and podcast
  sections, and must not change the layout or scroll behaviour of anything
  above it.
- The WS5b player layout is **not** involved — this is the home screen, not the
  player. Leave the player untouched.
- Use a dedicated class (e.g. `build-line`) and add the minimum CSS needed.
  Match the existing muted-text styling rather than inventing a new look.

## 3. Boundaries — do not touch

- **Any playback, seek, metadata or DVR logic.** No changes to `seekBy`,
  `seekToLive`, `seekToProgramTime`, `posMs`, `liveEdgeWallMs`,
  `playheadWallMs`, `pickByPosition`, `resolveMetadataForPosition`,
  `resolveProgramTitle`, `paintProgramTitle`, `paintNowPlaying`, the
  programme-skip lookup, `fetchNowPlaying`, or any DVR constant.
- The About overlay's wording, layout and the independent-app disclaimer — only
  the version *value* changes.
- The removed WS5 attribution footer: **do not restore it.**
- `manifest.webmanifest`, MediaSession, the WS0 diag gate, the service worker
  strategy, `sw.js` cache semantics.
- No new dependencies. No CI (this repo has none and must not gain any).

## 4. Anti-vacuity rules (four have bitten this project)

1. **Never assert a guard "does not fire" once your change makes it
   unreachable.** WS6 shipped 162 green tests over a 100%-dead button.
2. **A negative result scoped to one direction is not a negative result.** The
   WS8 agent tested only backward seeks and concluded "impossible"; 24,947
   forward counterexamples existed.
3. **A pattern containing a comment can never match a `stripComments()`ed
   slice.** WS9 hit this: requiring `// superseded` in a comment-stripped
   region made a vacuous assertion.
4. **Asserting a whole-file pattern is weak when the same text appears
   elsewhere.** WS9's seek-time re-resolve assertion passed against `APP_CODE`
   because the same call also exists in `playTrack`. Slice the region that the
   change actually touched.

## 5. Tests and evidence

The suite asserts on **source text** via `region(start, end, src)` and
`stripComments()`. `region()` searches **forward** from the start marker, so an
end marker that appears *earlier* in the file returns -1 — this has broken the
suite twice. Verify every marker exists and is in order before running.

Required:

- The About overlay renders the **build identity**, not the frozen `1.5.0`.
- The repo-root `app.js` contains **no hardcoded build hash**.
- The build script **injects** the identity and does so **idempotently**.
- A mutation replacing the injected id with a fixed literal turns the suite red.
- A mutation removing the injection turns the suite red.
- A mutation that restores the old attribution footer turns the suite red.
- All out-of-scope functions listed in §3 are **byte-identical**. No `||`
  fallbacks between assertions — an `||` between two assertions has twice let a
  mutation slip through green.

**Run the build twice and paste both outputs**, proving idempotency and that
the hash does not oscillate.

**For every mutation: `cp` the files first, verify with `cmp -s` that it
actually applied before trusting the result, and `md5sum` after restore.** Never
use `git checkout --` to restore uncommitted work — it destroyed an entire
workstream once.

## 6. Report format

A status update roughly every 5 minutes, **and no more often**.

The final report must paste, as real output: the mutation table; both build runs
side by side; `md5sum` confirmation of restore; test count before and after; the
commit hash; and the exact string the main screen will display.

State plainly what is **verified** and what is **not**. No iPhone is available
to you. You cannot prove what a device displays — only that the value is
injected, correct and idempotent.

## 7. Deploy

Commit **without** pushing. Report the hash. I will verify the deploy myself,
and I will check all four deploy checks before telling the owner it is live.
