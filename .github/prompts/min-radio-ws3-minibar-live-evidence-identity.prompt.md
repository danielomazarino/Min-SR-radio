---
name: Min Radio — WS3 Mini-Bar Gestures, Live-Seek Evidence & PWA Identity
description: Workstream 3 for Min Radio. Fix the flaky mini-bar swipe gestures (cause identified: the minimised layout never arms them), add a gated diagnostic to capture real back-to-live evidence instead of guessing again, and give the web app an absolute manifest id to stop iOS launching the wrong installed app from the lock screen.
argument-hint: "Runs Workstream 3 only — mini-bar gestures fix, back-to-live evidence capture, absolute PWA id. No blind fix for the live seek."
agent: agent
---

You are the Min Radio coding assistant. This is **Workstream 3 only**. It comes
directly out of a real iPhone retest of Workstream 2, where **one fix failed, one
is flaky, and one bug was never addressed.**

Read the results below carefully. The single most important instruction is in
Part 2: **a previous fix for the back-to-live button did not work. Do not try
another one-line tweak on the same theory. Gather evidence instead.**

## Progress reporting — required throughout

The product owner is not a technical expert and is following this from outside.
They find a stream of near-continuous updates noisy rather than reassuring.

**Post one short status update roughly every five minutes of working time —
and no more often than that.** Do not post one before or after every single
step. If less than five minutes have passed since your last update, stay quiet
and keep working. Five minutes is a target, not a floor: several minutes with no
update is fine and expected, and one message covering several completed steps is
better than three messages covering one step each.

Write each update in plain Swedish or plain English (match the language of the
request), a few lines at most, covering what you are doing now, what you have
finished since the last update, anything that contradicts this brief, and what
you will do next.

Do not paste raw tool output into status updates. **Post the status and then
continue working.** Never stop to ask permission on a routine step, and never
wait for a reply.

## Read first

1. `README.md` — architecture, build/test commands, Pages deployment model.
2. The active work queue at the top of `ENHANCEMENTS.md`.
3. `/memories/repo/sr-pwa-app.md` — especially the WS2 retest section.
4. The regions of `app.js` named below, in full, before writing anything.

## Verified context (checked 2026-09-27 — trust this, do not re-derive)

Repo: `/home/lm/Dev/SR pwa app`. `npm test` reports **133 passing, 0 failing**.
That is your baseline. If your run differs, stop and report before changing
anything.

`HEAD` is `eb23d0b`. Live serves `app.d7a0cc17.js`, SW cache
`minradio-984264e0`.

### How deployment works — there is NO CI

No GitHub Actions workflow exists in this repository and none ever did; older
notes claiming otherwise are wrong. GitHub Pages serves the **repository root
of `main`**. `npm run build` writes `dist/` and then **copies the built
artifacts back into the repository root**; the hashed bundles are tracked in
git. So: edit → `npm test` → `npm run build` → `git add` the changed root
artifacts → `git commit` → `git push`. **A commit without a fresh
`npm run build` deploys nothing while looking successful.**

### What the owner reported after the WS2 deploy

1. **Back-to-live: STILL BROKEN.** The WS2 change (seeking to
   `end - LIVE_EDGE_TOLERANCE_S`, i.e. 10 s behind the edge) did **not** fix it.
2. **Swipe-expand panel: "seems to be fixed."** Treat as probably fixed, not
   verified. Do not touch it.
3. **Gestures are FLAKY.** Swiping down moves the whole player down half the
   screen and it "needs pinning"; swiping up from the fully minimised state is
   unreliable and takes two attempts. **The owner confirms these gestures were
   ALREADY flaky before this workstream — this is not a new regression.**
4. **Lock screen / Face ID: opens a DIFFERENT installed app.** The lock-screen
   card renders correctly (verified by screenshot — Min Radio owns the media
   session), but tapping it, and reopening via Face ID, launches another app.
   Deleting the first competitor's home-screen icon made **a different** app
   open instead, so the target is being resolved **ambiguously**. Root cause is
   the relative `"id": "./"` in `manifest.webmanifest` — see Part 3.

---

## Part 1 — Fix the mini-bar gestures (cause is KNOWN, fix this properly)

### Mechanism — verified by reading the code, do not re-derive

`renderPlayer()` has a **minimised branch that returns early**, at
`app.js:1742`:

```js
if (playerMinimized) {
  const mini = el('div', { class: 'player-mini' }, ...);
  ...
  return;          // <-- returns here
}
// ... full-player layout continues ...
```

`enablePlayerGestures($player, {...})` is not called until `app.js:2327`, well
after that `return`. **So the minimised layout has no touch handlers of its
own.**

What still fires is the handler set registered by the **last full-player
render**, which stays bound to the singleton `$player`. Those handlers then act
on a completely different DOM — the mini bar has no expand panel and no
transport controls. Two visible consequences:

- `onTouchMove`'s downward branch does
  `surface.style.transform = translateY(...)` on `$player` itself. In the
  full-player layout the player is pinned to the bottom, so this reads as a
  drag. In the mini-bar layout there is nothing holding it, so **the whole
  player slides down the screen and stays there.**
- A swipe up from the mini bar runs `onExpand()` — which builds an expand panel
  for a layout that is being torn down — instead of restoring the player. Hence
  "two steps".

`restorePlayer()` (around `app.js:2471`) sets `playerMinimized = false` and
calls `renderPlayer()`, which re-arms gestures — but only **after** a restore
that the user struggles to trigger in the first place.

### Required fix

**The minimised layout must have working gestures of its own, with meanings
appropriate to that layout.** Concretely:

1. `enablePlayerGestures` must be reachable in the minimised branch too — either
   move the call above the early return, or call it inside the minimised branch
   before it returns.
2. **In the minimised layout, swipe up must mean "restore to the full player",
   not "expand the panel".** There is no panel in the mini bar, so `onExpand`
   is the wrong callback. Pass a restore callback.
3. **The drag transform must not be applied to the mini bar.** Dragging the mini
   bar down half the screen with no way to pin it is the bug, not a feature. If
   the mini bar should not follow the finger at all, do not translate it; if it
   should follow slightly, it must spring back on release.
4. Preserve the existing tap-to-restore on the mini bar
   (`onclick: () => { restorePlayer(); }` around `app.js:1718`) unless there is
   a concrete reason it conflicts. Do not remove working behaviour.
5. **Keep the WS2 leak fix intact.** `enablePlayerGestures` stores named
   handlers in `surface._srGestureHandlers` and removes them before
   re-adding, with removals paired to `metaDiagCountRemove(type)`. Because it
   will now be called from two places, make sure it is still called **once per
   render** — not twice, and not zero times. A double call would double-arm.
6. Do not change the full-player expand/minimise behaviour. That path was
   verified in WS2.

### Note on `enableSwipeToClose`

The expand panel has its own `enableSwipeToClose(panel, panel, fold, { axis: 'y' })`
wired to the grab zone. Do not conflate the two gesture systems. The mini bar
must not acquire a swipe-to-close that dismisses playback.

---

## Part 2 — Back-to-live: CAPTURE EVIDENCE, do not guess again

### What is already known

WS2 changed `seekToLive()` from seeking to `cur.seekableEnd` exactly, to seeking
to `Math.max(seekableStart, end - LIVE_EDGE_TOLERANCE_S)`. Current code:

```js
function seekToLive() {
  const cur = state.current;
  if (!cur) return;
  const end = cur.dvrAvailable ? cur.seekableEnd : null;
  if (!Number.isFinite(end)) return;
  const start = Number.isFinite(cur.seekableStart) ? cur.seekableStart : 0;
  const target = Math.max(start, end - LIVE_EDGE_TOLERANCE_S);
  if (!Number.isFinite(target)) return;
  audioEl.currentTime = target;
  updateSeekableState();
  renderPlayer();
}
```

**This did not fix the owner's bug.** The hypothesis — "Safari treats a seek
onto the buffered boundary as a no-op" — is therefore **not established**, and
10 s behind the edge was not enough either. Chromium cannot test this path at
all: the DVR-capable candidate is an HLS stream whose manifest is CORS-blocked
in Chromium, so playback falls back to direct MP3 where `seekableEnd` is null
and `seekToLive` bails at its own guard.

### Your task

**Add a gated diagnostic that captures the evidence needed to diagnose this, and
report what it shows. Do not attempt the fix.**

The WS0 harness already exists and is gated on **both** conditions
(`app.js:3508-3512`): the URL query must contain `diag=metadata` **and**
`localStorage['sr-meta-diag'] === 'on'`. Reuse `metaDiagGateOpen()` and
`diagLog()`. Add whatever new fields are needed to the existing snapshot — do
not build a second, parallel diagnostics system.

Capture at minimum, at the moment the owner presses the button and immediately
after:

- `currentTime` before and after
- `seekableStart`, `seekableEnd`, `seekableDuration`
- `distanceFromLiveEdge`, `atLiveEdge`, `dvrAvailable`
- `audioEl.transport` kind (`live` / HLS instance / direct) and `readyState`
- whether `seekToLive` was even reached, and if it bailed, **which guard bailed
  it** — that single fact may be the whole answer
- the transport/codec of the active stream

The most valuable single fact is **which line the function exits at.** If it
bails at `if (!cur)` or `if (!Number.isFinite(end))`, the button was never going
to work and no amount of adjusting the target will help.

### Then use the built-in browser for what it CAN show

You cannot exercise the DVR path in Chromium — established, do not waste time
re-deriving it. But you **can**:

- Verify the button is wired to `seekToLive` and that the DVR row renders when
  `dvrAvailable` is true.
- Exercise `seekToLive()` against a **stubbed** `state` and a real
  `audioEl`-shaped object, and report the actual `currentTime` it produces for
  several window shapes. State plainly that this tests arithmetic only, not
  Safari's behaviour.
- Check the obvious alternative the owner has not tested: **does the button work
  when pressed twice, or when pressed after a programme-skip rather than after a
  slider drag?** Report what you find.

### Deliverable

A short diagnosis section in your report: the ranked list of what could cause
this, which ones the new evidence rules in or out, and which single experiment
on the owner's iPhone would settle it. **If the evidence points at an HLS
live-edge semantic (a live edge that must be *followed* by reloading rather than
seeked to), say so explicitly** — that is a plausible alternative to the
boundary-seek theory and it would change the fix entirely.

---

## Part 3 — Lock screen / Face ID opens a DIFFERENT installed web app

### What the owner has established (this took several wrong theories to reach)

The lock-screen player card renders **correctly** — a screenshot shows the right
P1 channel artwork, "P1 / Direkt", the pause button and a live waveform. **Min
Radio genuinely owns the media session.** The metadata is right.

But **tapping it launches a different app**, and so does reopening via Face ID.
That is a general "resume the wrong app" failure, not a media-card failure.

The decisive experiment: the owner **deleted the other PWA's home-screen icon**
(the Gsim Masters Presence app, a Google Apps Script web app). The symptom did
not disappear — **a different app opened instead: a blog the owner had saved
to the home screen from Safari.**

**That is the whole diagnosis.** The wrong app changes when the set of installed
web apps changes. iOS is not choosing a particular competitor; it is resolving
the launch target **ambiguously** and grabbing whichever installed web app it
lands on. This is an iOS installed-web-app **identity/registration** problem.

Note for the record: the Gsim app has **no media player functionality at all** —
it is an HTML front end that only writes text to a Google Sheet. It cannot have
stolen a media session. Every media-session theory (competition, stale metadata,
teardown ordering) was investigated and refuted by direct reading of the code.

### Root cause — a relative manifest `id`

`manifest.webmanifest` currently contains:

```json
{ "id": "./", "start_url": "./", "scope": "./", "display": "standalone" }
```

**`"id": "./"` is a relative identifier.** The manifest `id` is what defines the
installed web app's identity. A relative value is resolved against the document
URL; for a project deployed under a **subpath** (`/Min-SR-radio/`) that makes
the identity fragile and prone to colliding with other installed web apps in
iOS's registry — exactly the observed behaviour.

### Required fix

1. **Change `"id"` to an absolute, stable identifier** matching the deployed
   origin:
   ```json
   "id": "https://danielomazarino.github.io/Min-SR-radio/"
   ```
   **Keep `start_url` and `scope` relative (`"./"`)** — the app is deliberately
   built to work under any base path and those must stay portable. Do not make
   them absolute.
2. **Verify the build.** `scripts/build-pages.mjs` validates that every asset
   referenced by `manifest.webmanifest` exists (`"src"` entries), and copies the
   manifest into both `dist/` and the repository root. Confirm `npm run build`
   succeeds and still writes the manifest to the root. Do not bypass its checks.
3. **Do not change anything else in the manifest** — not `name`, `short_name`,
   `display`, `orientation`, colours, or the `icons` array.

### Also add — lock-screen position state (a real, separate defect)

`setPositionState()` is **never called anywhere in `app.js`** (verified: the
identifier does not appear in the file). That is why the lock screen shows
`--:--` for elapsed and remaining time instead of actual times.

Add it, correctly:

- For **live** streams, report `duration: Infinity` (or omit `duration`) with
  `currentTime` set to the playback position and `playbackRate`. Live radio has
  no meaningful total duration.
- For **on-demand episodes**, report the real `duration` and `currentTime` from
  `audioEl`.
- Guard the whole call in `try/catch` — `setPositionState` throws on some
  platforms, and it must never break playback.
- It must be updated when playback starts, when it pauses, and periodically
  enough to stay roughly accurate. Do **not** attach a new unremoved interval
  or listener — `app.js` has already suffered two listener-leak defects of this
  shape (`audioEl._srUpd`, and the WS1 `timeupdate` leak). Follow the existing
  established pattern: store the handle on `audioEl`, clear it before
  re-creating, and clear it on stop.
- **This is cosmetic.** It fixes the `--:--` display. It does **not** fix the
  wrong-app launch, and must not be presented as doing so.

### Do NOT attempt

- **Do not modify `manifest.webmanifest` beyond the `id` field.** In particular
  do not change `start_url`, `scope` or `display`.
- **Do not modify the MediaSession `setActionHandler` calls** at
  `app.js:1403-1407`. They work, and the media card renders correctly.
- **Do not try to detect, control or deprioritise the other installed apps.**
  They are separate origins and outside this app's reach.
- **Do not change** `updateMediaSession()`'s withdrawal logic — it is already
  correct: it clears `metadata` and sets `playbackState = 'none'` when there is
  no current track, and `stopAndClosePlayer()` calls it *after*
  `state.current = null`, so the withdrawal branch is genuinely reached.

### The owner's mandatory manual step — state this prominently

A manifest `id` change **only affects apps installed after the change.** The
existing home-screen icon keeps whatever identity it was registered with.

The owner must:

1. **Delete the Min Radio home-screen icon.**
2. **Reinstall from Safari** (open the site → Share → Add to Home Screen).
3. Retest the lock-screen tap and Face ID.

**If they do not do this, nothing will appear to change, and the fix will look
like it failed.** Say this in the report in its own clearly separated section,
not as a footnote. Also note that iOS may need a moment, and that a stale
service-worker cache under the old identity can persist.

### Report the limits honestly

- This is the best-supported available fix, and it targets a genuine defect (a
  relative id in a subpath deployment). It is **not proven** — the proof is the
  owner's reinstall and retest.
- If the problem persists after reinstall, the honest conclusion is that iOS's
  installed-web-app registry on that device is confused by multiple web apps and
  the cause is outside this app's control. Say that plainly rather than
  speculating about further code changes.

## Tests

Add tests to `tests/metadata-diag.test.mjs`, following that file's existing
idiom.

The suite asserts on **source text**, and `app.js` is heavily commented with
comments that name identifiers an assertion is trying to prove the code does
*not* use. The file already has a string-aware `stripComments()`; **reuse it**
and assert on comment-stripped source, or your test will match its own
documentation. Slice the **raw** file to find a region, then slice the
**stripped** source inside it for assertions — comment markers do not survive
stripping, so do not anchor on them.

Established gotchas from WS0/WS1/WS2:

- `audioEl.addEventListener` appears at **8 source sites**, not 9 or 10 (two are
  `forEach` loops over several event names).
- An over-broad "this identifier appears exactly once" assertion will catch
  unrelated code — a previous attempt failed on the **News** section's own
  `aria-expanded` write. Scope such assertions tightly.
- If you add diagnostics counters, the WS0 coverage assertions that count
  `metaDiagCountAdd` call sites will need updating to the correct new invariant.
  Update the count **and record in the test why it changed**.

What the new tests must establish:

1. `enablePlayerGestures` is called in **both** the minimised and the
   full-player branch of `renderPlayer()`.
2. It is called **exactly once per render** — assert the total number of call
   sites in `renderPlayer` is 1, or that the two calls are mutually exclusive.
3. The minimised branch passes a **restore** callback, not `onExpand`.
4. The downward-drag branch does not leave a `translateY` on the mini bar
   without a spring-back.
5. The WS2 leak fix survives: `_srGestureHandlers` removal still present, all
   four touch types still registered and removed, counters still paired.
6. For Part 2, the snapshot builder includes the new back-to-live fields,
   including which guard (if any) bailed.
7. `manifest.webmanifest` has an **absolute** `id`, and `start_url` and `scope`
   remain **relative** — plus no other manifest field changed.
8. `setPositionState` is called, wrapped in `try/catch`, with `duration: Infinity`
   (or no `duration`) for live and a real duration for episodes.
9. Any `setPositionState` timer/handle is stored and cleared before re-creating,
   and cleared on stop — no new leak. The `MediaSession` `setActionHandler`
   implementations at `app.js:1403-1407` are unchanged, as is
   `updateMediaSession()`'s withdrawal logic.

Then **prove the tests have teeth.** Mutate at least three ways — one per part is
best — show the suite going red each time, restore between runs, and prove with
`git status` that the working tree is byte-identical to its pre-mutation state.
**Paste the actual output.**

## Verify in the built-in browser

Serve with `npm start` and use the built-in browser. Remember `index.html`
loads a **hashed bundle**, so run `npm run build` first or the browser will
serve the previous build.

- **Mini-bar gestures:** start a channel, swipe down to minimise, confirm the
  player does **not** slide down the screen or stay displaced. Swipe up from
  the mini bar and confirm it restores to the full player in **one** gesture.
  Check `$player`'s inline `style.transform` is empty at rest.
- **Full-player gestures:** confirm swipe up still expands the panel and swipe
  down still minimises. That path was verified in WS2 — do not regress it.
- **Gesture listeners:** `srMetaDiag().listeners.netLive` must show each touch
  type at exactly **1**, not 2 (a double-arm would show 2).

**Be honest about the limit.** Chromium is not Safari, and the mini-bar
gesture path in particular depends on real touch behaviour. If your test
passes, say clearly that it does not prove the iPhone is fixed. The owner will
retest on the phone and that retest is the real verification. Do not describe a
desktop pass as "fixed".

## Hard boundaries

- **Do not attempt a back-to-live fix.** That is Part 2's evidence-gathering.
  A third speculative tweak to a function that has already failed twice is
  worse than no change.
- **Do not touch** the WS2 swipe-expand-panel fix, `setExpandOpen`, or
  `renderSongView`. The owner reports the panel now behaves correctly.
- **Do not change `manifest.webmanifest` beyond the `id` field.** Specifically
  not `start_url`, `scope`, `display`, `name`, or `icons`. If the build's
  reference check rejects an absolute id for any reason, **stop and report it**
  rather than working around the check.
- **Do not change** the MediaSession `setActionHandler` implementations at
  `app.js:1403-1407`, or `updateMediaSession()`'s withdrawal logic — both are
  verified correct and the media card renders correctly on the owner's device.
- **Do not change** `seekToLive()`'s existing guards, `updateSeekableState`, the
  `LIVE_EDGE_TOLERANCE_S` constant, or the programme-skip buttons.
- **Do not present the manifest-id change as a proven fix.** It corrects a real
  defect; whether it resolves the owner's symptom is proven only by their
  reinstall and retest.
- `scheduleCache` is still never cleared and `armPlaybackWatchdog` still
  advances candidates with no exhausted guard. Both remain out of scope. Report
  them; do not fix them.
- Never claim a deploy succeeded without all four checks: live `index.html`
  references the new hashed bundle; live `sw.js` has a new `CACHE_NAME` and
  lists the new bundle; the **new local bundle** contains the fix (grep it); the
  **served** bundle contains the fix (curl it and grep).
- If anything in this brief turns out to be false, stop and say so. A brief that
  disagrees with the code is worth more than a change that matches it.

## Final report format

Plain English, for a product owner who will not read raw tool output:

1. What you changed, one paragraph per part.
2. The final test count, and confirmation the pre-change baseline was 133.
3. The mutation-test results — actual output, not a summary.
4. **The back-to-live diagnosis:** what the new evidence shows, which causes it
   rules in and out, and the single best next experiment on the iPhone.
5. The browser verification: what you did and the actual values.
6. The commit hash and the files it changed.
7. The deploy verification: new bundle name, old and new `CACHE_NAME`, and
   confirmation the served artifacts contain the fix.
8. **The owner's mandatory manual step**, in its own clearly separated section:
   the manifest `id` change only takes effect after **deleting the Min Radio
   home-screen icon and reinstalling from Safari**. Without that, nothing will
   change and the fix will look like a failure. Do not bury this.
9. What you did **not** verify — specifically, that no iPhone or real device was
   used, that Safari's live-edge behaviour was not reproduced, that the
   back-to-live button is **not** claimed as fixed, and that the wrong-app launch
   is **not** claimed as fixed — only that a genuine identity defect was
   corrected. `setPositionState` is cosmetic and fixes the `--:--` display
   only.
10. Any defect you noticed but deliberately did not fix, as a hypothesis with
    the evidence supporting it.

Do not describe this workstream as fixing the back-to-live button. It does not,
and claiming otherwise would be the third unverified success in a row.
