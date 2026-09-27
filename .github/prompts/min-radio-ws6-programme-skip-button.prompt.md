---
name: Min Radio — WS6 Programme-Skip Button: Make It Observable, Then Fix It
description: Workstream 6 for Min Radio. The programme-skip button's "Till Direkt" fallback still fails on the owner's iPhone after three attempts. First make the button's state visible in diagnostics, then fix the actual defect the evidence points to. Do not attempt a fourth blind seek fix.
argument-hint: "Runs Workstream 6 only — expose the programme-skip button state, then fix the real defect. No blind seek tuning."
agent: agent
---

You are the Min Radio coding assistant. This is **Workstream 6 only**.

The owner's programme-skip button still fails to return to live on a real
iPhone, **after three separate attempts**. This workstream is deliberately
structured to stop that: **observe first, then fix what the observation shows.**
Do not open with another change to a seek target.

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
3. `/memories/repo/sr-pwa-app.md` — especially the WS6 section.
4. The regions of `app.js` named below, in full, before writing anything.

## Verified context (checked 2026-09-27 — trust this, do not re-derive)

Repo: `/home/lm/Dev/SR pwa app`. **Run `npm test` first and report whatever it
says as the baseline** — do not assume a number. Workstream 5b landed at 157
passing; use your own first run.

`HEAD` is `78ecc5f` ("Align the player: one text column, buttons as header
corners (WS5b)"), which **is deployed**: live `app.54ce5277.js`,
`styles.928a0e57.css`, SW cache `minradio-4b6cc688`. WS4 and WS5 are also
deployed.

`npm run build` writes `dist/` and then **copies the built artifacts back into
the repository root**; hashed bundles are tracked in git. Sequence: edit →
`npm test` → `npm run build` → `git add` root artifacts → `git commit` →
`git push`. **A commit without a fresh `npm run build` deploys nothing.**
There is no CI and never was.

## Scope — read this carefully, it is narrow on purpose

**In scope: the programme-skip button only** (the circular-arrow button
immediately right of the pause button). The owner has confirmed this is the
control they use and the one that is broken.

**Explicitly OUT of scope: the ±15 second buttons** (`seekBy()`). The owner
raised this in conversation and then explicitly said they had *not* asked for it
and did not want it changed. **Do not touch `seekBy()`.** If you think it has a
defect, report it and leave the code alone.

## What has already been tried and failed

Three fixes have shipped and none worked on the owner's iPhone:

1. **WS2** — `seekToLive()` changed from seeking exactly `seekableEnd` to
   `end - LIVE_EDGE_TOLERANCE_S` (10 s behind the edge).
2. **WS4 Item 2** — `seekBy()` gained an upper clamp (out of scope now, but note
   the pattern).
3. **WS4 Item 1** — the go-to-live fallback on the programme-skip button was
   implemented exactly as the owner specified.

**The important conclusion:** three attempts to change *where a seek lands* all
failed. That is strong evidence the problem is **not the seek target at all** —
it is more likely that the intended code path is never being reached.

## The leading hypothesis — test this FIRST

`posMs()` at `app.js:2409` computes the playhead's wall-clock position by
**measuring backwards from the live edge**:

```js
const posMs = () => Date.now() - (cur.seekableEnd - (audioEl.currentTime || 0)) * 1000;
```

That is `Date.now()` minus the distance from the playhead to `seekableEnd`. It
assumes `seekableEnd` is *current*. On iOS native HLS the buffered end can lag
between updates. If `seekableEnd` is stale, the computed position drifts.

The consequence, at `app.js:2429`:

```js
if (nextEv && behindLive) {
  ... title 'Nästa program' ... onclick: () => seekToProgramTime(nextEv.startMs);
} else if (behindLive) {
  ... title 'Till Direkt' ... onclick: () => seekToLive();
}
```

If the drift makes `programBoundary(schedule, posMs(), +1)` keep finding a later
event, `nextEv` stays truthy, **the `else if (behindLive)` branch is never
taken**, the button keeps saying "Nästa program", and it keeps jumping to a
programme start. `seekToLive()` is then never called at all — which would mean
**the WS3 diagnostic was never exercised**, because `backToLive.calls` would
stay `0`.

**This is a hypothesis, not a finding.** Part 2 exists to test it.

---

## Part 1 — Make the button observable (do this first, it is the important part)

**Today nothing can see this button's state.** Grep the diagnostics `dom`
section for `nextProgram` — there is nothing. The WS0 snapshot captures the
player, the expand panel and the playing marks, but not this button. That is
precisely why three workstreams have been guessing.

Add it to the existing snapshot, in the same style as the neighbouring fields.
It must report, at snapshot time:

- `visible` — whether the button is displayed (`display !== 'none'`)
- `title` — its `title` attribute (this is where `'Nästa program'` vs
  `'Till Direkt'` is visible in code)
- `ariaLabel` — its `aria-label` attribute
- `mode` — a single unambiguous token: `'programme'` when it is wired to
  `seekToProgramTime`, `'direct'` when it is wired to `seekToLive`, and
  `'hidden'` when not displayed. Derive it from the actual wiring, not from a
  separate variable that could drift out of sync with it.

`mode` is the field that settles the diagnosis. **Derive it from what the
`onclick` actually is**, or the field can lie.

Add the snapshot field, and add it to whatever the console/one-line report
already prints, so the owner can read it with one command.

---

## Part 2 — Establish which branch actually runs

Before changing any logic, **prove which branch the owner's situation takes.**

1. In the built-in browser, confirm the new field appears and correctly reports
   `mode` for the states you can produce.
2. Write a short, honest analysis of when `nextEv` is falsy versus truthy, given
   `posMs()`'s formula and the schedule the app fetches. State plainly whether
   the `else if (behindLive)` branch is reachable **at all** in normal use, or
   only in a narrow window.
3. **Compare `posMs()` against a position derived independently** — for
   example the currently-airing event's own `startMs`/`endMs` from the parsed
   schedule, which is a direct statement of "now" that does not depend on
   `seekableEnd` at all. If the two disagree by more than a small tolerance,
   that is the bug, and you have proven it in the browser.

**If the two disagree, report the measured numbers before you fix anything.**

### Then fix the cause, not the symptom

- If `posMs()` drift is confirmed, the fix is to make the position used for
  boundary lookup **not depend on a possibly-stale `seekableEnd`**. Deriving it
  from the schedule's own event boundaries is the sound approach, because the
  schedule is fetched over HTTP and is not subject to buffered-range lag.
- **Do not "fix" it by widening the `+ 1000` margin in `programBoundary()`.**
  That is tuning a threshold to make a symptom disappear, and threshold-shaped
  fixes have already failed here twice.
- `programBoundary()` itself should keep its contract. If you change it, justify
  why in the report.

---

## Part 3 — Instrument `seekToLive()` only if Part 2 shows it IS being called

The WS3 diagnostic (`SEEK_LIVE_DIAG` at `app.js:1589`, exposed as
`dvr.backToLive` at `app.js:3876`) already records `calls`, `lastExit`,
`lastBefore`, `lastTarget` and `lastAfter`.

**Read it first.** If your Part 2 analysis shows the button is correctly wired
and calling `seekToLive()`, that diagnostic is the right instrument and you
probably do not need to add anything.

If it needs one addition, add **only** what the analysis shows is missing — for
example whether a `seeking`/`seeked` event fired, or `readyState`/`networkState`
around the assignment. Do not speculatively add fields.

**Hard boundary: do not change `seekToLive()`'s behaviour in this workstream.**
Its target arithmetic was reviewed twice and the owner is not asking for another
seek tweak. If the evidence points at the seek being rejected by Safari, **say
so in the report and stop** — that is a finding, and acting on it is a separate,
authorised decision.

---

## Tests

Add tests to `tests/metadata-diag.test.mjs`, following the file's existing
idiom.

The suite asserts on **source text**. `app.js` is heavily commented and comments
name identifiers an assertion is trying to prove the code does *not* use; the
file has a string-aware `stripComments()` — **reuse it** and assert on
comment-stripped source. Slice the **raw** file to find a region, then slice the
**stripped** source inside it; comment markers do not survive stripping.

**Two hard-won lessons — apply both:**

- **WS5 shipped a vacuous assertion.** Its regex required a literal `.` before
  `player-title`, but the source contains `class: 'player-title'` — no dot. The
  assertion could never match, so it passed while proving nothing, and a mutation
  slipped through undetected. **Never write an assertion whose pattern cannot
  match the real source.**
- **Over-broad "appears exactly once" assertions catch unrelated code.** A WS2
  attempt failed because it matched the News section's own `aria-expanded`
  write. Scope such assertions tightly.

What the tests must establish:

1. The snapshot exposes the programme-skip button with `visible`, `title`,
   `ariaLabel` and `mode`.
2. `mode` is derived from the actual `onclick` wiring, not from a separate
   variable — so the field cannot report `'direct'` while the button still seeks
   to a programme.
3. The go-to-live branch is reachable: there is a test that demonstrates a state
   in which `nextEv` is falsy and `behindLive` is true.
4. Whatever changes the position calculation, it no longer depends solely on
   `seekableEnd`, and a test demonstrates the old and new values agreeing for a
   healthy stream.
5. `seekBy()` is **unchanged** — assert the WS4 clamp and the `dvrAvailable`
   guard are still exactly as they were.
6. The WS3 `SEEK_LIVE_DIAG` block still exists with all its fields.

Then **prove the tests have teeth.** Mutate at least three ways, show the suite
going red each time, restore between runs, and prove with `git status` that the
tree is byte-identical to its pre-mutation state. **Paste the actual output.**

## Verify in the built-in browser

Run `npm run build` first — `index.html` loads a **hashed bundle**, so without a
build the browser serves the previous one and your changes look absent.

**An important limitation, established in this project:** Chromium cannot load
SR's DVR-capable HLS stream (its manifest is CORS-blocked), so playback falls
back to a direct stream where `dvrAvailable` is false and **the programme-skip
buttons never render at all.** You therefore cannot exercise the real button in
Chromium.

So verify what is honestly possible, and be explicit about the rest:

- The new snapshot field appears and reports correct values for the states you
  can synthesise. **Synthesising state is acceptable here** — set
  `dvrAvailable`/`seekableEnd`/`atLiveEdge` deliberately and confirm `mode`
  reports the truth. Say that is what you did.
- The position calculation: run the **real shipped function** against realistic
  and deliberately-stale `seekableEnd` values, and report the before/after
  numbers. This is the most valuable evidence you can produce without a phone.
- Confirm nothing else in the player regressed: expand chevron, mini-bar, seek
  bar, ±15s buttons, and the WS5b header/alignment layout.

**State plainly that the button itself was never exercised on a real device.**

## Hard boundaries

- **Do not touch `seekBy()` or the ±15 second buttons.** The owner explicitly
  excluded them.
- **Do not change `seekToLive()`'s behaviour.** Read it, instrument it if the
  evidence demands, but do not retune it.
- **Do not tune thresholds** — not the `+ 1000` margin in `programBoundary()`,
  not `LIVE_EDGE_TOLERANCE_S`, not `THRESHOLD` in the gesture code.
- **Do not change** the WS5b layout, the `.attribution` removal, the WS4
  go-to-live branch structure, the removed `0.88` hit zone, or
  `releaseDragStyles`.
- **Do not touch** `manifest.webmanifest`, MediaSession code, or the WS0 gate.
- Do not remove the `'Nästa program'` behaviour — the owner wants both states,
  correctly chosen.
- Never claim a deploy succeeded without all four checks: live `index.html`
  references the new hashed bundle and stylesheet; live `sw.js` has a new
  `CACHE_NAME` and lists the new assets; the **new local** bundle contains the
  change (grep it); the **served** bundle contains the change (curl it and grep).
- If anything in this brief turns out to be false, stop and say so. A brief that
  disagrees with the code is worth more than a change that matches it.

## Final report format

Plain English, for a product owner who will not read raw tool output:

1. **The headline finding:** which branch the button actually takes, and
   therefore whether `seekToLive()` was ever being called. State this first and
   state it plainly.
2. What you changed, one short paragraph per part.
3. The measured evidence: the position values before and after, the staleness
   figures, and the `mode` readings for the states you synthesised.
4. The final test count, and the baseline your first run reported.
5. The mutation results — actual output, not a summary.
6. The commit hash, and confirmation it was **pushed** — state this explicitly.
7. The deploy verification: new bundle and stylesheet names, old and new
   `CACHE_NAME`, and confirmation the served assets contain the change.
8. **Exactly what the owner must do on the iPhone**, as a single short sequence.
   Say plainly: load the app, skip back a programme, tap the programme-skip
   button once, and send the `nextProgram` block from the diagnostic report. That
   is now possible because Part 1 made the button visible.
9. What you did **not** verify — specifically, that no iPhone or real device was
   used, and that the button itself was never exercised in a browser because
   Chromium cannot load the DVR stream.
10. Any defect you noticed but deliberately did not fix, as a hypothesis with
    the evidence supporting it.

Do not claim this fixes the owner's bug. Three attempts have failed; this one is
built to find out *why*, and to make the button observable so the answer can be
read off the device in a single press.
