---
name: Min Radio — WS4 Go-To-Live, Step Clamp & Stranded Player Fixes
description: Workstream 4 for Min Radio. Implement the missing go-to-live behaviour on the next-programme button, clamp the ±15s step buttons to the live edge, remove the invisible 12% back-to-live hit zone, and make the player transform impossible to strand when iOS withholds touchend.
argument-hint: "Runs Workstream 4 only — go-to-live on the skip button, ±15s clamp, guaranteed transform reset. The stranded-player fix is UNVERIFIED until the owner tests on iPhone."
agent: agent
---

You are the Min Radio coding assistant. This is **Workstream 4 only**.

Two of the three items here implement behaviour the product owner **always
believed existed and which is genuinely missing from the code**. The third fixes
a bug the owner can reproduce but which desktop testing cannot validate.

Read the owner's description carefully — it is the specification.

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
request), a few lines at most: what you are doing now, what you have finished,
anything that contradicts this brief, and what you will do next.

Do not paste raw tool output into status updates. **Post the status and then
continue working.** Never stop to ask permission on a routine step, and never
wait for a reply.

## Read first

1. `README.md` — architecture, build/test commands, Pages deployment model.
2. The active work queue at the top of `ENHANCEMENTS.md`.
3. `/memories/repo/sr-pwa-app.md` — especially the WS4 scope section.
4. The regions of `app.js` named below, in full, before writing anything.

## Verified context (checked 2026-09-27 — trust this, do not re-derive)

Repo: `/home/lm/Dev/SR pwa app`. `npm test` reports **142 passing, 0 failing**.
That is your baseline. If your run differs, stop and report before changing
anything.

`HEAD` is `b3bad7b`. Live serves `app.45cd2170.js`, SW cache `minradio-13e1bc50`.

### How deployment works — there is NO CI

No GitHub Actions workflow exists and none ever did; older notes claiming
otherwise are wrong. GitHub Pages serves the **repository root of `main`**.
`npm run build` writes `dist/` and then **copies the built artifacts back into
the repository root**; the hashed bundles are tracked in git. So: edit →
`npm test` → `npm run build` → `git add` the changed root artifacts →
`git commit` → `git push`. **A commit without a fresh `npm run build` deploys
nothing while looking successful.**

### The owner's intent, in their own words

> The circular arrows have from the start been for ±15 seconds. Then when the
> DVR was built we introduced the skip arrows to move between shows. **In order
> not to have a separate live button that takes up space, the forward skip
> button, when coming to the actual show played at next click, should go to the
> live state.**

So the design intent is: **no separate "Till Direkt" button.** The
next-programme button doubles as back-to-live when there is no next programme.
The owner believes this was implemented. **It was not** — the code has no such
fallback. Items 1 and 2 below implement it properly. Do **not** add a separate
button; that would contradict an explicit product decision about screen space.

---

## Item 1 — Make the next-programme button fall back to go-to-live

### What exists now

The next-programme button is `nextProgramBtn`, created at `app.js:2341` with
`aria-label: 'Till nästa programs start'` (`app.js:2343`). Its behaviour is
driven by `syncNext()`, registered inside the `fetchSchedule(...).then(...)`
block in `renderPlayer()`:

```js
const syncNext = () => {
  const nextEv = programBoundary(schedule, posMs(), +1);
  const behindLive = cur.atLiveEdge === false
    || (Number.isFinite(cur.seekableEnd) && cur.seekableEnd - (audioEl.currentTime || 0) > 60);
  if (nextEv && behindLive) {
    nextProgramBtn.style.display = '';
    nextProgramBtn.title = nextEv.title || 'Nästa program';
    nextProgramBtn.onclick = () => seekToProgramTime(nextEv.startMs);
  } else {
    nextProgramBtn.style.display = 'none';
  }
};
```

**The gap:** when `nextEv` is falsy — the playhead is already inside the
currently-airing programme, so there is no later programme — the button is
**hidden entirely** (`display: 'none'`), and the owner is left with **no way at
all** to return to live. The hidden 12% hit zone on the DVR bar (Item 3) was
presumably intended to cover this, and it does not work in practice.

### Required behaviour

When the owner is **behind live** and there is **no next programme**, the
next-programme button must be **visible** and act as **go to live**:

- Visible when `behindLive` is true, regardless of whether `nextEv` exists.
- When `nextEv` exists → unchanged: title `nextEv.title || 'Nästa program'`,
  `onclick` seeks to `nextEv.startMs` via `seekToProgramTime`.
- When `nextEv` is missing but `behindLive` is true → title `'Till Direkt'`,
  `onclick` calls **`seekToLive()`**.
- When **not** behind live → **hidden**, exactly as today. Do not show a button
  that does nothing; that was an explicit requirement of the original design
  ("no duplicated LIVE state, no extra button when already live").

Also update the button's `aria-label` when it is acting as go-to-live, so a
screen reader announces the correct action. The static `aria-label` is set at
creation; a dynamic value is acceptable here provided the default remains the
programme-skip label.

**Do not** change `programBoundary()`, `seekToProgramTime()`, or how `behindLive`
is computed. `syncNext` is already registered/unregistered correctly via
`audioEl._srNextUpd` — keep that leak fix intact.

---

## Item 2 — Clamp the ±15s step buttons to the live edge

### Why

`seekBy()` currently does:

```js
function seekBy(deltaSeconds) {
  const cur = state.current;
  if (!cur || !cur.dvrAvailable) return;
  const start = Number.isFinite(cur.seekableStart) ? cur.seekableStart : 0;
  const target = Math.max(start, (audioEl.currentTime || 0) + deltaSeconds);
  if (!Number.isFinite(target)) return;
  audioEl.currentTime = target;
  updateSeekableState();
  renderPlayer();
}
```

It clamps the **lower** bound to `seekableStart` but has **no upper bound**. When
the owner is a few seconds behind live and presses forward 15 s, the target
**exceeds `seekableEnd`** — the buffered boundary — and Safari rejects or clamps
the seek. This is the same class of defect the WS2 work tried and failed to fix
in `seekToLive()`, and **that path was never corrected here.** It is very
plausibly the cause of the owner's report that "the last step back to live does
nothing": the final 15 s step never lands.

### Required fix

Clamp `target` to the live edge as well:

- Compute an upper bound from `cur.seekableEnd` (only when `cur.dvrAvailable`
  and `seekableEnd` is finite). Aim slightly **behind** the edge by
  `LIVE_EDGE_TOLERANCE_S` (`app.js:733`, value 10) so the result is still
  classified as at-live by `updateSeekableState()` while giving the browser a
  real, non-boundary target.
- Final target: `Math.min(upper, Math.max(start, currentTime + deltaSeconds))`.
- If `seekableEnd` is not finite, keep the current behaviour exactly (no upper
  clamp) — do not break non-DVR or not-yet-seekable states.
- Keep the function a **seek only**: no `play()`, no `src` reassignment, no HLS
  re-attach.

**Do not change** the `±15 s` step size, the DVR/programme buttons, or
`updateSeekableState`.

---

## Item 3 — Remove the invisible 12% back-to-live hit zone

The DVR seek bar carries a click handler at `app.js:2138`:

```js
bar.addEventListener('click', (e) => {
  if (cur.atLiveEdge !== false) return;
  const rect = bar.getBoundingClientRect();
  const frac = (e.clientX - rect.left) / rect.width;
  if (frac >= 0.88) seekToLive();
});
```

Only the rightmost **12%** of the slider snaps to live, with **no visual
affordance whatsoever** (`.dvr-bar` has no styling for it). The owner has never
managed to hit it, and it has now cost two workstreams of misdiagnosis. With
Item 1 implemented there is a discoverable control, so this hidden zone is now
pure liability.

**Remove this hit zone entirely.** Do not replace it with a visible zone on the
bar — Item 1 provides the affordance. Leave the bar's drag-to-seek behaviour,
the `seek-fill`/`seek-thumb` elements, and the clock label untouched.

If you find a comment claiming this zone exists, remove or correct the comment
too. A comment that documents behaviour which no longer exists is a defect.

---

## Item 4 — Make the player impossible to strand (UNVERIFIABLE ON DESKTOP)

### The bug

The owner reports the player **sliding down over half the screen** and staying
there, unable to be pinned back. This is reproducible on a real iPhone and **was
NOT reproducible in Chromium**.

`enablePlayerGestures()` applies, during a downward drag:

```js
surface.style.transform = `translateY(${Math.min(dy, window.innerHeight * 0.5)}px)`;
```

and clears it only at the end of `finish()`:

```js
surface.style.transform = '';
```

`finish()` begins with `if (axis !== 'y') return;`. So if `touchend` never
arrives — iOS steals the gesture, or a `renderPlayer()` mid-drag resets `axis` —
**the clearing line never runs** and the player is stranded with a live inline
transform. `renderPlayer()` does set `$player.style.transform = ''` at its top,
so a later render would heal it, but the owner has no reliable trigger for one.

### Required fix — guarantee the reset, do not tune thresholds

1. **Reset the transform on every terminal path**, not only `touchend`:
   `touchcancel` is already bound; make sure it takes the same clearing path
   rather than returning early.
2. **Also clear on `pointercancel`**, and on `visibilitychange` / `blur` when
   the document is hidden — the gesture is definitely over at that point.
3. **Re-assert the reset in `renderPlayer()`** — it already does
   `$player.style.transform = ''`; confirm that line is unconditional and early
   enough that any render heals a stranded player. Do not add a second
   redundant clear.
4. **Do not tune `THRESHOLD`, the flick window, or the 0.5 multiplier.** The
   problem is the missing reset, not the drag distance. Changing thresholds to
   make the symptom less visible would be a guess, and a previous threshold-ish
   fix already failed.
5. If `enablePlayerGestures` gains a new listener, store it in the existing
   `surface._srGestureHandlers` bookkeeping and pair the removal with
   `metaDiagCountRemove` — that structure exists precisely for this and must
   stay accurate.

### Honesty requirement for this item

**Desktop testing cannot validate this.** A previous gesture fix in this
repository passed the entire 142-test suite **and** a synthetic Chromium
touch simulation, and still failed on the owner's iPhone. Do not report Item 4
as fixed. Report it as implemented-but-unverified, state plainly that no iPhone
or real device was used, and tell the owner that their retest is the only real
verification. Do not let a green desktop run imply the phone is fixed.

---

## Tests

Add tests to `tests/metadata-diag.test.mjs`, following that file's existing
idiom.

The suite asserts on **source text**, and `app.js` is heavily commented with
comments that name identifiers an assertion is trying to prove the code does
*not* use. The file already has a string-aware `stripComments()`; **reuse it**
and assert on comment-stripped source, or your test will match its own
documentation. Slice the **raw** file to find a region, then slice the
**stripped** source inside it — comment markers do not survive stripping, so
never anchor on one.

Established gotchas from WS0–WS3:

- `audioEl.addEventListener` appears at **8 source sites**, not 9 or 10.
- An "appears exactly once" assertion will catch unrelated code — a previous
  attempt failed on the **News** section's own `aria-expanded` write. Scope
  tightly.
- If you add diagnostics counters, the WS0 coverage assertions counting
  `metaDiagCountAdd` call sites need updating **and the reason recorded in the
  test**.

What the new tests must establish:

1. `syncNext` shows the next-programme button when `behindLive` is true even
   when `nextEv` is falsy, and wires that case to `seekToLive()`.
2. The go-to-live case sets a distinct title/aria-label from the programme-skip
   case.
3. The button is still hidden when **not** behind live.
4. `seekBy` clamps its target to the live edge using `LIVE_EDGE_TOLERANCE_S`,
   and still clamps the lower bound to `seekableStart`.
5. `seekBy` keeps its current behaviour when `seekableEnd` is not finite.
6. The 12% bar hit zone is gone — no `frac >= 0.88` / `>= 0.88` comparison
   remains, and the bar click handler no longer calls `seekToLive()`.
7. The player transform is cleared on more than just `touchend`: assert the
   cancel/visibility paths exist and reach the clearing line.
8. `audioEl._srNextUpd` leak bookkeeping is intact.

Then **prove the tests have teeth.** Mutate at least three ways — one per item is
best — show the suite going red each time, restore between runs, and prove with
`git status` that the tree is byte-identical to its pre-mutation state.
**Paste the actual output.**

## Verify in the built-in browser

Run `npm run build` first: `index.html` loads a **hashed bundle**, so without a
build the browser serves the previous one and your changes appear absent.

What Chromium can honestly show:

- The next-programme button appears and is wired to go-to-live when there is no
  next programme and the state says behind-live.
- The ±15s forward button clamps to the live edge instead of overshooting.
- The 12% hit zone is gone: clicking the right end of the bar does nothing.
- `$player`'s inline `style.transform` is empty at rest after a simulated drag.

**What it cannot show:** whether the stranded-player bug is fixed, because the
failure depends on iOS not delivering `touchend`. Say so.

## Hard boundaries

- **Do not add a separate "Till Direkt" button.** The owner explicitly chose
  to avoid one to save screen space. Item 1 implements the fallback on the
  existing button.
- **Do not change** the ±15 s step size, `programBoundary()`, `seekToProgramTime()`,
  `seekToLive()`'s existing guards, `updateSeekableState`, or the
  `LIVE_EDGE_TOLERANCE_S` constant.
- **Do not touch** the WS2 swipe-expand-panel fix, `setExpandOpen`,
  `renderSongView`, or `audioEl._srNextUpd`.
- **Do not touch** `manifest.webmanifest`, the MediaSession
  `setActionHandler` implementations, or `updateMediaSession()`'s withdrawal
  logic.
- **Do not tune gesture thresholds or the drag multiplier** (Item 4).
- `scheduleCache` is still never cleared and `armPlaybackWatchdog` still
  advances candidates with no exhausted guard. Both remain out of scope. Report
  them; do not fix them.
- The lock-screen wrong-app bug is **closed as out of scope**: four theories were
  tested and refuted, including a reinstalled absolute `manifest` id. It is an
  iOS device-level installed-web-app issue. Do not revisit it.
- Never claim a deploy succeeded without all four checks: live `index.html`
  references the new hashed bundle; live `sw.js` has a new `CACHE_NAME` and
  lists the new bundle; the **new local bundle** contains the fix (grep it); the
  **served** bundle contains the fix (curl it and grep).
- If anything in this brief turns out to be false, stop and say so.

## Final report format

Plain English, for a product owner who will not read raw tool output:

1. What you changed, one paragraph per item.
2. The final test count, and confirmation the pre-change baseline was 142.
3. The mutation-test results — actual output, not a summary.
4. The browser verification: what you did and the actual values, plus an
   explicit statement of what Chromium could **not** verify.
5. The commit hash and the files it changed.
6. The deploy verification: new bundle name, old and new `CACHE_NAME`, and
   confirmation the served artifacts contain the fix.
7. **What the owner must retest on the iPhone**, item by item, and which of
   those results are the only real proof.
8. What you did **not** verify — specifically, that no iPhone or real device was
   used, and that Item 4 is therefore **not** claimed as fixed.
9. Any defect you noticed but deliberately did not fix, as a hypothesis with the
   evidence supporting it.

Do not describe Items 1 and 2 as "fixing back-to-live" in a way that implies the
owner has confirmed it. These implement the behaviour they specified and that
was missing; the confirmation is their retest.
