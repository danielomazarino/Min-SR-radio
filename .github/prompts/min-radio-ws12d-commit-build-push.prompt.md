---
name: WS12D — commit the uncommitted WS12 work, build, and PUSH to deploy
description: The owner is away and needs the result live on their iPhone. Part A, B and C are implemented in the working tree but UNCOMMITTED, and commit 532266a has already committed the tests without the app.js they test — so HEAD is currently broken and must never be pushed as-is. This repairs the commit, then commits, builds, pushes, and verifies with the four deploy checks. The push is mandatory.
applyTo: "**"
---

# WS12D — finish WS12: commit, build, push, verify

## 0. The owner is away. The push is the deliverable.

They will check the result on their **iPhone**. **A commit deploys nothing.**
There is no CI and no GitHub Actions in this repo — `.github/` contains only
`agents/` and `prompts/`, and `git log --all -- .github/workflows` is empty.
**Pages serves the repository root of `main`. The push IS the deployment.**

So: commit, build, push, verify, and report. Do not stop at a commit and wait
for a reviewer. Do not push without verifying.

---

## 1. ⚠️ CRITICAL — HEAD is currently broken. Read this before anything else.

**Commit `532266a` is not self-consistent and must NOT be pushed as it stands.**

It committed the WS12 Part A/B/C **test** changes to
`tests/metadata-diag.test.mjs`, while the `app.js` and `styles.css` those tests
exercise are **still uncommitted in the working tree**. So the committed tree
contains new tests that assert against source that is not there.

This was verified by cloning HEAD into a scratch directory and running the suite
there:

```
not ok 6 - tests/metadata-diag.test.mjs
# tests 102   # pass 101   # fail 1

AssertionError: start marker not found: $main.appendChild(el('p', {
```

At HEAD, `app.js` still has the build line in `.topbar`
(`document.querySelector('.topbar')` present) while the committed test asserts it
must **NOT** be there. **Pushing `532266a` as-is would deploy a failing state.**

The working tree was green when this was written. **Re-run `npm test` yourself
and trust your own output, not that sentence** — the tree may have moved since.
The problem here is only the commit split, not the code.

### How to repair it

Do **not** attempt `git commit --amend`, `git rebase`, `git reset --soft` or any
history rewrite. The working tree may be edited concurrently and history surgery
is the one thing that can destroy uncommitted work here.

Instead, make the tree self-consistent by **adding a commit on top**:

1. `git add app.js styles.css tests/fixpass.test.mjs`
   (and anything else in `git status` that is part of WS12 Part A/B/C)
2. Commit the source alongside its tests.
3. `git push origin main` — this pushes **both** `532266a` and the new commit,
   so the tip of `main` is consistent.

A transiently-broken intermediate commit already exists in history. That is
acceptable and far better than rewriting published history. **The only thing
that matters is that the tip of `main` passes.**

---

## 2. What is already done — verify, do not redo

Do not re-implement any of this. Confirm each item, then move on.

### Part A — build number back under NYHETER
- `app.js` — `$main.appendChild(el('p', { class: 'build-line', text: \`bygg ${APP_BUILD}\` }))`,
  after the news section, before `updatePlayingMarks();`
- No `document.querySelector('.topbar')` anywhere in `app.js`
- No `APP_VERSION` declaration — the stale `1.5.0` is **not** restored, and
  `scripts/build-pages.mjs` has **not** been given a version injection
- `styles.css` — `.build-line` is the WS10 block form
  (`margin: 18px 0 4px; font-size: 11px; line-height: 1.4; opacity: 0.75; word-break: break-all;`)
  with none of the topbar-only properties
- `index.html` — `.topbar` has two children, so `space-between` puts the cog at
  the right edge again

### Part B — close ✕ and chevron ⌄ back ABOVE the transport row
- `app.js` — `closeBtn` and `expandBtn` are children of `headerLine`; the
  `WS12 Part B: expandBtn and closeBtn are NO LONGER appended here` comment
  marks where they left `.player-controls`
- `.player-controls` carries the transport only
- `.player-quality` and `.player-mode` both set `white-space: nowrap` **and**
  `text-overflow: ellipsis` — defence in depth, explicitly *not* the cure; the
  cure is the restored width

### Part C — podcast album cover and the mid player
- `app.js` — `const songArtwork = isEpisode ? …` (no longer a hard `null`)
- `app.js` — `const songLine = el('div', { class: 'now-playing-line', … })` with
  no `live ?` gate, so episodes get a mid-player song line

### WS12A — the false rationale
- Test renamed to `'WS11 Part B: no frozen version is displayed anywhere'`, with
  a retraction comment recording that "cannot be occluded" was never observed and
  that the owner checked on the iPhone
- The stale `'Placement: the top bar, not the scrolling content.'` comment is gone
- Every `APP_VERSION` assertion is unchanged (7 assertions; 10 lines mention the
  identifier, the rest being assertion message strings and comments)

**If any of these is NOT true, stop and report it. Do not quietly fix it and
push** — an unverified change reaching the owner's phone is exactly what this
project keeps paying for.

---

## 3. Order of operations

1. `npm test` — record the real counts **now**, before anything.
2. Verify §2. If anything is missing, stop and report.
3. Run the mutation harness for the guards added in WS12 (Part A placement, the
   pill clipping, the spacer, the podcast cover). **Compare md5 before and after
   every mutation** — a harness that only checks the anchor reports no-op
   mutations as green, and that produced four false results in WS11.
4. `node --check` all four sources.
5. `git add` the Part A/B/C **source** files and commit (§1).
6. **`npm run build`.** `scripts/build-pages.mjs` writes `dist/` *and* copies
   `index.html`, `sw.js` and the hashed bundles back into the repository root.
   **A commit without a fresh build deploys nothing.**
7. `git add -A` the regenerated artifacts and commit them.
8. `git push origin main`.
9. **The four deploy checks (§5), then report the raw output.**

### The build-id ordering trap

The build id is derived from **the last commit that touched `app.js`**
(`resolveBuildId` in `scripts/build-pages.mjs`). So the order is forced:

- commit the **source** first (step 5),
- **then** build (step 6),
- **then** commit the artifacts (step 7).

Building before committing the source names the *parent* commit and shows the
owner an id that resolves to a real commit but never to the one they are
running. This happened in WS10 and again in WS11.

---

## 4. Boundaries — do not touch

- **Seek behaviour.** `seekBy`, `seekToLive`, `seekToProgramTime`, `posMs`,
  `liveEdgeWallMs`, `playheadWallMs`, `pickByPosition`, `resolveMetadataForPosition`,
  the programme-skip lookup, and every DVR constant. **The forward-skip button
  works on the owner's phone.** These must be byte-identical to
  `git show 745493c:app.js`. Prove it and paste the result.
- The podcast **thumbnail** (programme image) — the owner confirmed it is correct.
- Do not restore `1.5.0`, do not add a version injection to `build-pages.mjs`,
  do not bump `package.json`.
- Do not restore the DVR window readout or the WS5 attribution footer.
- Do not change `sw.js`'s caching strategy or the manifest.
- No new dependencies. No CI.
- **Do not fix anything you discover in passing.** Report it. Scope creep is how
  a reviewed change becomes an unreviewed one.

## 5. The four deploy checks — all four, then report the raw output

- **(1)** live `index.html` references the new hashed bundle.
- **(2)** live `sw.js` has a new `CACHE_NAME`.
- **(3)** the new **local** bundle contains the change.
- **(4)** the **served** bundle contains the change.

`index.html` loads the **hashed** bundle, not `app.js`; `app.js` is only the build
input. Checking `app.js` proves nothing about what is served.

**Re-read the served `index.html` AFTER your wait loop.** Pages takes tens of
seconds. A hash captured mid-deploy has drifted before and was reported as a
success. If the first hash you read looks stale, wait and read it again.

Then also verify the served bundle actually contains each Part A/B/C change —
the build line append, the absence of the `.topbar` append, the `headerLine`
buttons, the `songArtwork` fix and the ungated `songLine`. A green deploy of the
wrong code is the failure this project has already paid for twice.

## 6. Tell the owner this in your report

> On the phone, unregister the service worker or hard-reload. A stale service
> worker will keep serving the old layout and make a good deploy look broken.

State it plainly so they are not sent chasing a phantom regression.

## 7. Anti-vacuity rules

1. **Never assert a guard "does not fire" once your change makes it unreachable.**
2. **A negative result scoped to one direction is not a negative result.**
3. **A pattern containing a comment can never match a `stripComments()`ed slice.**
4. **Assert the specific promise, not a proxy.** A reviewer checked the *header*
   alignment and declared the layout intact while the seek row had a third flex
   child.
5. **Never use `git checkout --`** to restore uncommitted work. It destroyed WS5b.
6. **Mutation harnesses must compare md5 BEFORE AND AFTER each mutation.**
7. **`region()` searches FORWARD** — a region opened on the wrong declaration
   silently begins *after* the element under test.
8. **A check that cannot fail is not evidence.** `document.scrollWidth` stays
   under the viewport even while a flex row overflows internally.
9. **An unverified claim, duplicated, becomes indistinguishable from an observed
   one.**

## 8. Honesty requirements

**Do not describe anything you did not measure as measured, and do not describe
anything about the iPhone as verified — you have no device.**

Say plainly which parts you measured in Chromium (at a stated viewport, in a
stated player state), which were reasoned about, and which are unverified.

**The 7-button DVR player state cannot be reached naturally in Chromium** — SR's
DVR stream is CORS-blocked, so the programme-skip buttons never render on their
own. Any figure for that state came from a **constructed** state. Say so. This
matters: the reported "no overflow at 390px and 340px" that shipped WS11a was
measured on a 5-button non-DVR channel, while the owner's screen was the 7-button
case where the text column measures **0px**.

Desktop Chromium green is **not** device correct. That has happened three times in
this project.

**The owner's standing instruction, which governs how you report:**

> "you have to request my support for all ux and ui related questions. iphone
> comes first"

If a UX/UI question arises that you cannot settle by measurement — does it
overlap, is it legible, is this wanted, which of two layouts — **stop and ask.**
One message costs far less than a wrong assumption. Ambiguity is a reason to
ask, never a licence to choose.

## 9. Status updates

**Roughly every 5 minutes, and no more often.** Do not report every step; do not
go silent for longer than about 5 minutes. If blocked, say what you are blocked
on rather than retrying.

Lead with what changed, what you measured, and whether it is **live**. If the
push has not happened, say that plainly rather than implying it is deploying.
