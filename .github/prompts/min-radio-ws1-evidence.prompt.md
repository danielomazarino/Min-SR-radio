---
name: Min Radio — WS1 Leak Fix & Live Evidence Capture
description: Workstream 1 for Min Radio. Commit the WS0 diagnostics harness, fix the verified audioEl timeupdate listener leak as an independent defect, run the harness in a real browser to capture actual evidence for the two unresolved metadata symptoms, then commit and deploy. Does NOT fix the symptoms.
argument-hint: "Runs Workstream 1 only — commit WS0, fix the leak, capture live evidence, then commit and deploy."
agent: agent
---

You are the Min Radio coding assistant. This is **Workstream 1 only**. It has
five parts, and you must stop after them.

The critical framing: **this workstream does not fix the reported bugs.** The
channel-mismatch and programme-skip reports remain open and undiagnosed. Your
job is to remove one defect that is proven, to gather the evidence that a later
workstream will need, and to commit and deploy that work safely. Overstating
your result is a worse failure than doing less.

## Progress reporting — required throughout

The product owner is not a technical expert and is following this work from
outside, and they find a stream of near-continuous updates noisy rather than
reassuring.

**Post one short status update roughly every five minutes of working time —
and no more often than that.** Do not post one before or after every single
step. If less than five minutes have passed since your last update, stay quiet
and keep working. Five minutes is a target, not a floor: a run of several
minutes with no update is fine and expected, and a single message covering
several completed steps is better than three messages covering one step each.

Write each update in plain Swedish or plain English (match the language of the
request), a few lines at most, covering:

- what you are doing right now,
- what you have finished since the last update,
- anything you found that contradicts the brief, and
- what you will do next.

Do not paste raw tool output into status updates — summarise it, and keep the
raw output for the final report. **Post the status and then continue working.**
Never stop to ask for permission on a routine step, and never wait for a reply.
If you are blocked, say so and explain precisely what you need.

Status updates are a deliverable in their own right, not a courtesy. A silent
agent is indistinguishable from a stuck one — which is why the five-minute
cadence exists in both directions: silent is bad, and flooding is also bad.

## Read first

1. `README.md` — architecture, build/test commands, Pages deployment model.
2. The active work queue at the top of `ENHANCEMENTS.md`.
3. `/memories/repo/discovery-rule.md` if available.
4. `/memories/repo/sr-pwa-app.md`, section "WS1 analysis".
5. `.github/prompts/min-radio-ws0-baseline.prompt.md` — Workstream 0, already
   installed. Do not redo it.
6. The regions of `app.js` named below, in full, before writing anything.

## What is already verified (checked 2026-09-27 — trust this, do not re-derive)

Repo: `/home/lm/Dev/SR pwa app`. `npm test` reports **120 passing, 0 failing**.
That is your baseline. If your run differs, stop and report before changing
anything.

**Verified defect — the `timeupdate` leak.** Inside `renderPlayer()`, in the
`fetchSchedule(cur.id).then(...)` block at `app.js:2206-2237`, a listener is
registered:

```js
metaDiagCountAdd('timeupdate');
audioEl.addEventListener('timeupdate', syncNext);
```

There is **no matching `removeEventListener` anywhere in the file.** Confirm
this yourself with `grep -n "syncNext" app.js` and `grep -n
"audioEl.removeEventListener" app.js` before you change it.

This matters because `renderPlayer()` starts with `$player.textContent = ''`
(`app.js:1653`) and rebuilds the whole player subtree. Every render therefore
orphans a complete button tree while its closure stays reachable from
`audioEl`. `renderPlayer()` has roughly nineteen call sites (`playTrack`,
`advanceCandidate`, `toggleTrack`, the `playing` and buffering handlers, quality
change, watchdog, minimize/restore, expand). The closures retain `cur`,
`schedule`, `prevProgramBtn` and `nextProgramBtn`, so garbage grows
monotonically for the life of the page.

**This leak is NOT the cause of the channel-mismatch or programme-skip
reports.** `syncNext` writes only `nextProgramBtn.style.display`, `.title` and
  (`app.js:2222-2227`). It cannot reach `.player-title`,
`.player-sub`, `_srProgramTitle`, the expand panel, or `.now-playing-line`,
which is where those symptoms live. Fix it because it is a real defect, and
report it as such. Do not present it as a symptom fix.

**Two candidate mechanisms for the channel mismatch have already been refuted
by reading the source.** Do not re-investigate them and do not "discover" them
as new:

- `state.current = track` (`app.js:1068`) assigns a **fresh object** per play,
  and `resolveProgramTitle` bails with `if (!schedule || state.current !== cur)
  return; // superseded` (`app.js:1051`). A stale title cannot survive through
  that path.
- The now-playing out-of-order race is already guarded: `fetchNowPlaying`
  discards stale responses with `if (seq !== nowPlayingSeq) return;`
  (`app.js:903`), `pollNowPlaying` takes `const seq = ++nowPlayingSeq`
  (`app.js:943`), `stopNowPlayingPoll()` bumps both `nowPlayingSeq` and
  `artworkSeq` (`app.js:893-894`), `startNowPlayingPoll` clears the pending
  timer and polls immediately (`app.js:950-957`), re-arming is gated on
  `id === cur.id && seq === nowPlayingSeq` (`app.js:946`), and artwork has its
  own `artworkSeq` guard (`app.js:969`, `985`, `990`).

That both obvious mechanisms are refuted is the reason this workstream exists.
**Do not guess a fix. Measure.**

Also confirmed by reading, and out of scope here: `scheduleCache` is keyed
`${channelId}:${dateStr}` with a 10-minute TTL (`app.js:1534`, `1551`) and is
**never cleared**, not even by `stopAndClosePlayer()`. Note it in your report;
do not fix it.

## Part 1 — Fix the leak, using the pattern already in the file

Run your Part 3 browser evidence **after** this fix so the listener counts
reflect the corrected code.

The codebase already solves this exact problem twice. `app.js:1909-1912` and
`app.js:2012-2015` both do it identically:

```js
if (audioEl._srUpd) { metaDiagCountRemove('timeupdate'); audioEl.removeEventListener('timeupdate', audioEl._srUpd); }
audioEl._srUpd = upd;
audioEl.addEventListener('timeupdate', upd);
```

Use the same convention for `syncNext` — a property on the `audioEl` singleton,
removed before re-added. Pick a name in the same style (for example
`_srNextUpd`) and keep the `metaDiagCountRemove` call paired with the removal so
the WS0 counters keep telling the truth. This matters: the counters are the
evidence the next workstream depends on.

Constraints, all of which matter:

- Add the `removeEventListener` **synchronously in `renderPlayer()`**, not
  inside the `fetchSchedule` callback. The listener is registered
  asynchronously, so cleanup that runs earlier in `renderPlayer()` would miss
  it and the guard would never fire.
- Keep the existing `document.contains(prevProgramBtn)` early return. It is a
  deliberate guard and is not part of this defect.
- Change nothing else about programme-skip behaviour: same buttons, same
  visibility rules, same `programBoundary` logic, same `seekToProgramTime`.
- The removal must be safe when no listener was ever registered. Guard it.

The existing comment at `app.js:2230-2234` says the leak is "NOT FIXED" and is
counted by the diagnostics hook. **Update that comment** so it no longer
contradicts the code. A stale comment is a defect; a lying one is worse.

## Part 2 — Tests

Add tests to `tests/metadata-diag.test.mjs` in the existing style. Read that
file first and follow its idiom.

The suite asserts on source text, and that idiom has sharp edges:

- `app.js` is heavily commented, and several comments *name identifiers an
  assertion is trying to prove the code does NOT use*. Assert on
  **comment-stripped source** or your test will match its own documentation.
  The file already has a string-aware `stripComments()`; reuse it.
- Region markers often live inside comments. Slice the **raw** file to find a
  region, then slice the **stripped** source inside it for code assertions.
- `audioEl.addEventListener` appears at **8 source sites**, not 9 or 10: two
  sites are `forEach` loops over several event names.

What the new tests must establish:

1. `syncNext` is now removed before it is added — the `_sr*` property is
   checked, the `removeEventListener` call precedes the `addEventListener`
   call, and both are paired with the correct `metaDiagCount*` calls.
2. The removal is **outside** the `fetchSchedule` callback, so it runs
   synchronously during `renderPlayer()`.
3. Nothing user-visible was dropped: the `programBoundary` lookup, the
   `behindLive` test, the button visibility branches, the `prevProgramBtn`
   guard, and the `catch` are all still present.

Then prove the tests have teeth. Do not skip this and do not report success
without it. Mutate `app.js` at least three ways and show the suite goes red each
time, restoring the file between runs — for example: delete the
`removeEventListener` line; move the removal inside the `fetchSchedule`
callback; make the removal unconditional without the property guard. Use a
backup copy in `/tmp` and confirm with `git status` that `app.js` is byte-identical
to the pre-mutation state at the end. **Paste the actual output.**

## Part 3 — Live evidence capture in the built-in browser

This is the part that matters most, and the part most likely to be skipped. Do
it properly or say plainly that you did not.

The WS0 hook is gated on **both** conditions (`app.js:3402-3412`):

- the URL query string contains `diag=metadata`, **and**
- `localStorage['sr-meta-diag'] === 'on'`

Set the flag, load the page, and drive the real UI. Use the built-in browser.

```js
// in the page, via the browser tools
localStorage.setItem('sr-meta-diag', 'on');
```

Then reproduce and snapshot. For **each** symptom, capture a `srMetaDiag()`
snapshot at the moment the symptom is visible, and record what you did
immediately before it:

**Channel mismatch.** Start P1, wait for metadata to paint, snapshot. Switch to
P2, snapshot again at the moment the player shows the wrong channel or
programme. The field that decides this is `dom.expand.panelSeq`: the **same**
value in both snapshots proves the same node survived, a **different** value
proves the panel was rebuilt from state. Also compare
`playback.lastPlayingKey`, `playback.current.id` and `dom.playerTitle`.

**Programme skip.** While a DVR channel plays, move the slider to a position
inside a *different* programme, snapshot, and record what
`schedule.parsed` and `schedule.lastScheduleAt` said versus what the player
showed. `nowPlaying.rawRightNow` carries `previoussong` and `nextsong`, which
the parser deliberately ignores — if either of those would have shown the
correct programme, that is a significant finding and belongs in your report.

**Listener counts.** Take snapshots across several channel switches and
minimize/restore cycles. `listeners.netLive.timeupdate` should now stay flat
instead of climbing. Report the actual numbers.

Also exercise the two lifecycle edges that have never been tested, and report
what you observe: switch channels rapidly in succession, and start a second
playback while the first is still starting.

### Be honest about the boundary

The built-in browser is a desktop Chromium, not an iPhone. State explicitly
what your captures **cannot** establish: real iPhone audio decoding, native
HLS behaviour, installed-PWA standalone mode, the lock screen, MediaSession
ownership, network handover, and tunnel buffering. Those need the phone.

If a symptom will not reproduce in the browser, **that is a finding, not a
failure.** Report it as such and do not go hunting for a fix.

## Part 4 — Commit the WS0 harness (local only, no push)

The Workstream 0 diagnostics harness is already on disk, uncommitted, and
verified: **120 tests passing, 0 failing**, `app.js` at +343/−18, plus
`tests/metadata-diag.test.mjs` and the WS0 prompt.

Commit it **before** you touch anything, so there is a clean revert point.

```bash
npm test                      # must be 120 pass / 0 fail
git add app.js tests/metadata-diag.test.mjs .github/prompts/min-radio-ws0-baseline.prompt.md
git commit -m "Add opt-in metadata diagnostics harness (WS0)"
git status --short            # must show no uncommitted app.js
```

**Do not push yet.** Do not run `npm run build` yet. Do not add
`.github/prompts/min-radio-ws1-evidence.prompt.md` to this commit — that file
is workstream documentation, it ships in Part 5.

Write a commit message that says what the harness *is* (a gated, read-only
diagnostics snapshot) and states plainly that it changes no user-visible
behaviour and fixes nothing.

## Part 5 — Commit and deploy the leak fix

### How deployment actually works here — read this before committing

There is **no CI and no GitHub Actions workflow in this repository.**
`git log --all -- ".github/workflows"` returns nothing; a workflow has never
existed. Some older notes claim a "Pages workflow" run; that is wrong, ignore
it.

GitHub Pages serves the **repository root of `main`**. The hashed bundles
(`app.<hash>.js`, `styles.<hash>.css`) are **tracked in git**, and
`scripts/build-pages.mjs` writes `dist/` *and then copies* `index.html`,
`sw.js`, the new hashed bundles and the module assets back into the repository
root. So the deploy sequence is:

1. `npm run build` — this **mutates tracked root files** and produces a new
   asset hash.
2. `git add` the changed root artifacts (`index.html`, `sw.js`, the new hashed
   bundle, and any deleted old bundles).
3. `git commit`
4. `git push`

**A commit that does not include a fresh `npm run build` deploys nothing.**
The live site will keep serving the old bundle. This is the single most likely
way for this workstream to appear successful while shipping nothing.

### Do it

```bash
npm test                      # must be 120 + your new tests, 0 fail
npm run build                 # regenerates root artifacts
git status --short            # note every changed/added/deleted root file
git add -A index.html sw.js app.*.js styles.*.css src/ .github/prompts/min-radio-ws1-evidence.prompt.md
git commit -m "Fix unbounded timeupdate listener leak in renderPlayer"
git push
```

Then **verify the deploy actually happened** — do not assume it:

- Confirm `git status --short` is clean afterwards.
- Fetch the live `https://danielomazarino.github.io/Min-SR-radio/index.html`
  and confirm it references the **new** hashed bundle name.
- Fetch the live `sw.js` and confirm `CACHE_NAME` changed and the new bundle
  is in `SHELL_ASSETS`.
- `grep` the **new local bundle** for `_srNextUpd` to confirm the fix is
  actually inside the artifact you are about to serve.

If any of those do not match, the deploy did not happen. Report that instead
of claiming success.

## Hard boundaries

- **Do not change any user-visible behaviour** beyond removing the leak. The
  `scheduleCache` is not cleared in this workstream. No refactoring of
  `renderPlayer()`.
- **Do not attempt to fix the channel mismatch or the programme-skip reports.**
  You are not authorised to, and you have no evidence that would justify it.
- **Do not rebuild or redeploy between Part 1 and Part 4.** The browser
  evidence in Part 3 runs against the unbuilt source via `npm start`; run
  `npm run build` only in Part 5.
- **Never claim a deploy succeeded without the four live checks above.**
- If something in this brief turns out to be false, stop and say so. A brief
  that disagrees with the code is worth more than a change that matches it.

## Final report format

Plain English, for a product owner who will not read raw tool output:

1. What you changed, and confirmation that the change is limited to the
   listener cleanup plus its comment and tests.
2. The final test count, and confirmation that the pre-change baseline was
   120 passing.
3. The mutation-test results — the actual output, not a summary.
4. For each of the three captures: what you did, and what the snapshot
   actually showed. Include the real numbers, especially `panelSeq` and
   `listeners.netLive.timeupdate`.
5. Which symptoms reproduced in the browser and which did not.
6. The two commits: their hashes, messages, and the files each one changed.
7. The deploy verification: the new hashed bundle name, the old and new
   `CACHE_NAME`, and confirmation that the served `index.html` and `sw.js`
   reference the new artifacts. If the deploy did not happen, say so plainly.
8. What you did **not** verify, stated plainly. Specifically: that no iPhone
   or real device was used, and that no real audio playback was heard. The
   owner will test on a real iPhone after this, so be precise about what your
   evidence does and does not cover.
9. Any behaviour defect you noticed while reading but deliberately did not
   fix, described as a hypothesis with the evidence supporting it.

Do not present the leak fix as progress on the reported bugs. It is not. It is
a real defect, removed because it is real, and it is not the cause of either
symptom.
