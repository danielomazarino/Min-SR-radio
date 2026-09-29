# WS28 — the two timing offsets. MEASURE FIRST; there is no fix in this brief.

**Priority 2 of the queue. WS27 shipped. This one is investigation with a
measurement, not a patch.**

> **SEND THIS WHOLE FILE to the separate "space bunny" coding-agent chat.**
> The tech lead does not dispatch the agent and does not build or push — see
> `AGENTS.md` §13a.

---

## 0a. PREREQUISITE — the owner must be able to READ the number on the phone

**Do this part first. The whole workstream is blocked without it.**

The owner is not technical and uses an iPhone. The measurement this workstream
depends on is produced by `?diag=metadata`, but **as the app stands today the
owner cannot reach it at all:**

1. `metaDiagGateOpen()` (`app.js:5595`) requires **both** `diag=metadata` in the
   URL **and** `localStorage['sr-meta-diag'] === 'on'`. **There is no in-app way
   to set that flag.**
2. The snapshot is written to `console.log` and to `localStorage['sr-diag-log']`
   (`app.js:375`, `app.js:5964`) — **neither is visible on an iPhone** without a
   Mac cable and Safari Web Inspector.

So the current instruction to the owner is, in effect, "run some JavaScript and
read a console you cannot see." **Build a way to see it.**

### Requirements

- **A small switch in the existing "Om" (About) sheet** — the sheet that already
  explains in Swedish how the app is built. That is where a non-technical owner
  will look. Label it plainly, in Swedish.  - **It exists, and here is exactly how to reach it** (verified 2026-09-30, so
    you do not have to go looking): `openAbout()` at `app.js:4886`,
    `aria-label: 'Om appen'`. Reached from the favourites sheet via a button
    labelled **`Info`** (`app.js:5362`, `onclick: openAbout`) — behind the ⚙️ cog
    (`index.html:29`, `edit-btn`) and after the "Kom igång" onboarding.
  - **Tell the owner it says `Info`, not `Om`.** "Om" is the sheet's aria-label
    only and is **never rendered on screen**, so an owner told to "open Om" will
    be looking for a word that is not there.- **The number must appear as TEXT ON SCREEN**, so the owner can read it and
  photograph it. That is the entire point.
- **One short line the owner can copy or dictate**, not 4 000 characters of JSON.
  The number they need is `edgeMinusNowS` in seconds, plus `clampedByS`.
- **The two-key gate must still hold** for anyone who did not deliberately switch
  it on. Do not weaken `metaDiagGateOpen()` to make this easier — a query string
  travels in links, screenshots and bug reports, so it must never be sufficient on
  its own. Switching the flag **inside the app** is deliberate action, which is
  exactly what the gate is asking for.
- **It must be inert by default** and must not poll, fetch, or change playback.
- **It is a UI change, so the owner's approval is required** — which is why this
  is a brief item. Do not add it silently.

### Why this is worth building rather than working around

The owner's time is the scarcest resource in this project, and every measurement
that currently needs a Mac cable is a measurement we will keep asking for. Once
the reading is on screen, **the same figure can also be read from a desktop
browser** and the two compared — which is the standing instruction in
`AGENTS.md` §14.

**This also satisfies the owner's standing request:** *"you make sure that the
coding agent has good test cases and uses the built in browser for tests where
possible instead of asking the human for tests on iphone."* On-screen numbers
are what makes the browser genuinely usable for state questions.

### Then, and only then, the measurement


### NEW, measured by the tech lead on 2026-09-30: the stream's own clock is
readable in a desktop browser. `https://ljud1-cdn.sr.se/lc/<ch>/<ch>_128.pls`
serves `access-control-allow-origin: *` and carries `#EXT-X-PROGRAM-DATE-TIME`
at playlist head, with 1700 x `#EXTINF:6.4` = a **3.02 h** window.

**This does NOT mean the app can play the stream in Chromium. It cannot.**
Measured: hls.js 1.7.3 parses the manifest and all 1700 fragments -- each with
its own `programDateTime` -- but there is no DVR window and no seek in a
browser. **Every DVR *playback* question still needs the owner's iPhone.**

> **The specific error signature quoted above did NOT reproduce when the tech
> lead re-ran it 2026-09-30, and you should not copy it as an observation.**
> Measured: `MANIFEST_PARSED` **never fired** (15 s timeout), so `play()` was
> neither resolved nor rejected; **0 fatal errors**, and 6 **non-fatal** ones
> (`internalException`, `mediaSourceRequiresReset` ×3,
> `bufferAppendingError` ×2). `video.readyState 0`, `video.seekable.length 0`.
> **The conclusion is unchanged** -- no playback, no seek, phone required -- but
> if you report errors, report the ones **you** observe, not these.

**BUT THE SUBTRACTION BELOW CANNOT BE DONE IN A BROWSER. It is stated here so
nobody wastes time rediscovering it.**

The app-side term (`edgeMinusNowS`) is derived from `seekableEnd`, and
`seekableEnd` only exists once the app is actually playing. **Measured by the
coding agent, 2026-09-30, and independently confirmed by the tech lead: in
desktop Chromium the app never starts playback at all** -- `audioEl.src` stays
`null`, `networkState 0`, `readyState 0`, so there is no seekable range, and
`edgeMinusNowS` is `null`/`ABSENT` with `calls: 0`.

That is consistent with the long-standing finding that desktop Chromium cannot
play SR's HLS (the app's own `app.js:3337` area and the 2026-09-21 stream work).
**So the earlier wording in this brief -- "timing is now measurable in a browser,
do that before asking the owner" -- was WRONG and is withdrawn.** The PDT side is
browser-readable; **the app side is not.**

**What this leaves, and it is still a real gain:** the *stream* half of the
comparison can be computed anywhere, at any time, and it is the half that was
previously unobtainable. Use it to characterise the reference clock:

1. Fetch `https://ljud1-cdn.sr.se/lc/<ch>/<ch>_128.pls` (CORS is `*`).
2. Read the head PDT, sum the `EXTINF` durations: `trueEdge = headPdt + sum`.
3. Record `trueEdge - now`, the channel, and the timestamp in `SESSION-STATUS.md`.

**Measured values so far, and they DRIFT:** `+30.8 s`, and `+28.6 / +28.4 /
+28.1 s` on p1/p2/p3 thirteen minutes earlier -- about **2 s of drift in 13
minutes.** **It is not a constant and must never be used as one.** Sample it more
than once, on more than one channel, and report the spread.

**The decisive reading therefore requires the owner's iPhone**, which is why the
Info-sheet readout in 0a gates everything. That ordering dependency is real: the
brief cannot produce its central measurement until that UI exists and is deployed.

**A caution about comparing the two sides.** The PDT-derived edge is a *playlist*
end; `seekableEnd` is a *buffered* end, and Safari's buffered range **lags** the
playlist. **They are not known to be the same quantity**, and treating them as
interchangeable is the assumption under test. Do not subtract one from the other
and call the result the offset without saying which two quantities you compared.

**Also record `clampedByS` on the phone.** If it is not ~0, **the browser clamped
the seek** and the offset is not in the app's arithmetic at all -- invisible from
outside, and it looks exactly like a wrong offset.

#### Then the owner's reading, in user terms

Ask the owner to: open the app, play a channel with **hourly news**, tap the
**programme-skip** button once, then open **Info** (⚙️ cog → the sheet →
**Info**), switch diagnostics on, and read the `edgeMinusNowS` line. **They need
to read one number and report it -- nothing else, and no understanding of any of
the above is required.**

> **ORDERING DEPENDENCY — this is the thing to get right.** This reading is
> **only obtainable on the phone**, and on the phone it is **not currently
> reachable at all** — there is no in-app way to set `localStorage['sr-meta-diag']`
> (verified: `META_DIAG_FLAG` is only ever *read*, `app.js:5597`, never written by
> the app), and the snapshot goes only to `console.log` and `localStorage`, both
> invisible on an iPhone without a Mac cable and Web Inspector. **The Om/Info
> switch must be built, committed, built into artifacts and pushed before this
> reading can be taken at all.** Until that is deployed, do not ask the owner for
> this number -- you would be asking for something they cannot produce.
---

## 0b. Before anything else

1. **Read `AGENTS.md` in full.** The ones that decide this task: §2 (tests check
   *shape*, not behaviour), §5 (**never hardcode a number to silence a report**),
   §6 (a failed endpoint proves only that endpoint failed), §7a (is your new code
   reachable?), §7b (classify a failing test before touching it), §9 (how to
   report), §12 (the owner's real spec), §13 (the status file).
2. **Read the last four entries in `ENHANCEMENTS.md`:** WS22, WS23, WS26, WS27.
   WS22 and WS23 are about these exact offsets and contain measurements you must
   not re-derive or contradict.
3. **Run `npm test` and record the real numbers.** Expected **223/223**. If not,
   stop and classify every failure (`AGENTS.md` §7b) before writing any code.

---

## 1. What the owner reports, from the iPhone, build `c016cdb`

Three things, and **they are not the same problem**:

| # | report | status |
|---|---|---|
| 1 | The pre-midnight programme title **now works**. | **Verified in code as NOT caused by WS27** — see §2. Do not "fix" it. |
| 2 | **Programme skip lands ~25 s EARLY.** Skipping back on a channel with hourly news lands "circa 25 seconds before the actual show". On SR's own web player it is "an instant hit on the second". | **The main event.** |
| 3 | **Row 4's song title appears 10–15 s EARLY.** "the new song on row 4 always starts 10-15 seconds before the actual new song starts to play." | **A different mechanism** — see §4. |

**The owner's own instruction, and it is a hard constraint:**

> "it is not so that it is granted that is it the same offset. i need these things
> to be solved once for all."

**So: do not treat 2 and 3 as one bug, and do not fix either with a constant.**

## 2. Item 1 is NOT a WS27 fix — do not spend this workstream on it

The owner inferred the pre-midnight title was fixed by WS27. **It was not.** The
WS27 diff contains no reference to programme, schedule, fetch, midnight, window
or yesterday; it changes only the song rule and the cover choice. The programme
title is written in exactly one place, `resolveMetadataForPosition()`
(`app.js:1737`), and that function is untouched.

So something else changed the behaviour. The likeliest candidates, **none
established**:

- **A stale service worker.** WS27 changed both the bundle name and the SW cache
  name, so the owner got a genuinely new build; a hard reload re-evaluates the
  gate. **This would need no code change at all.**
- **The WS26 gate re-evaluation hook** firing on the first `timeupdate`. It has
  been in `1b4287b` since WS26.

**What you must do about it: almost nothing.** Record in the status file that R5
is *reported working* and *not attributable to WS27*, and flag that **if the
cause was the reload, the defect is service-worker dependent and can return.**
Do not close R5. Do not write a fix for R5. Your assignment is 2 and 3.

## 3. Item 2 — the programme-skip offset. This is the one to understand.

**The code.** `seekToProgramTime()` (`app.js:3018`):

```js
const target = end - behindMs / 1000;   // end = cur.seekableEnd
audioEl.currentTime = target;
```

The target is derived from `seekableEnd` — the app's belief about where the
buffered edge is. **If that belief is behind the real edge, every computed
position is early by the same amount** — and so is every programme skip.

**Read `playheadWallMs()` (`app.js:1708`) and `streamEdgeWallMs()`
(`app.js:1695`): both derive wall-clock time from the same `seekableEnd` belief.
The app therefore has ONE assumption, used in four places.**

**The instrumentation for this already exists and nobody has read it.**
`recordStreamEdge(phase)` samples the edge and the real clock *together* and
records:

| field | meaning |
|---|---|
| `edgeMinusNowS` | **the number that matters.** Positive = the app thinks the buffered edge is BEHIND the real present, which pushes every computed position EARLY. |
| `before` / `after` | sampled either side of the seek — is the edge itself moving? |
| `requestedTarget` vs `acceptedPosition` (`clampedByS`) | whether the **browser** clamped the seek, which from outside looks identical to a wrong offset |

Exposed as `?diag=metadata` → `seek` / `streamEdge`.

**Your first and most important job: get a reading.** Ask the owner for it, or
drive it in the browser if the browser can. Then interpret it:

| `edgeMinusNowS` | what it means |
|---|---|
| **≈ 0** on a channel with a live DVR window | **the offset is NOT in the app's edge belief.** The cause is elsewhere — the schedule's own times, or where SR places the boundary. Go to §3.2. |
| **≈ +25 s** | the app's edge is behind reality by ~25 s, and **one cause explains both readings**. Go to §3.1. |
| **large and inconsistent between presses** | the edge is being re-registered around the seek. `before` vs `after` will show it. |

### 3.1 If the edge belief is behind

**Do not add a correction to `seekToProgramTime`.** That would freeze one
observation into permanent behaviour — the exact thing `AGENTS.md` §5 exists to
prevent, and what turned "10 seconds" into folklore across three workstreams
before the owner measured 30 on another programme.

The correct fix is to make the edge belief **true**: obtain the real mapping
between playlist time and wall-clock time from the stream itself, and use it
where `playheadWallMs()` and `streamEdgeWallMs()` make the assumption.

> **CORRECTION — the earlier version of this brief said `EXT-X-DATERANGE`, and
> that was wrong.** MEASURED 2026-09-30 against the real playlists:
> `DATERANGE` count = **0**; the tag that is actually present is
> **`#EXT-X-PROGRAM-DATE-TIME`**, at playlist head, on p1/p2/p3. The comment at
> `app.js:3337` says *"HLS playlists carry no EXT-X-DATERANGE metadata"* —
> those words are **literally true and the conclusion is wrong**, which is why it
> misled two sessions. The mapping is carried by **PDT**, not DATERANGE.
>
> Two measured facts that make the PDT path **reachable**, not hypothetical:
> - the CDN serves `access-control-allow-origin: *`, so the playlist **is**
>   readable from the app's own origin — which matters because **on the iPhone
>   the app never constructs hls.js** (`CAPS.hlsjs` is false on Safari) and
>   uses native HLS, so a CDN fetch is the ONLY route on the reference device;
> - hls.js@1 exposes `this.programDateTime` (27 occurrences in the dist), and I
>   read a real `firstFragPdt` off its `LEVEL_LOADED` event — that is the
>   **desktop** path only, and is irrelevant to the iPhone.
>
> PDT is self-consistent: over 20 s the head PDT advanced 19.2 s against 20.0 s
> of wall clock (skew −0.8 s), so it is a usable reference and not a drifting one.

### 3.2 If the edge belief is correct

Then the ~25 s lives in the **schedule's** times or in how the target is
computed from them. Check, in order:

- Does `behindMs` use the right `startMs`? A programme's `starttimeutc` from
  `scheduledepisodes` vs the schedule entry used by the skip buttons.
- Is the target clamped or rounded anywhere between the computation and
  `audioEl.currentTime = target`?
- **Does the browser accept the exact target?** `clampedByS` answers this, and a
  clamp is invisible from outside.

## 4. Item 3 — the song title appearing 10–15 s early. Different mechanism.

Row 4 resolves a song through:

```js
pickByPosition(nowPlaying.timeline, playheadWallMs())
```

So it depends on (a) the app's position belief, and (b) the song's own start and
stop times. Those come from **three different clocks**:

1. SR's broadcast clock (`rightnow` → `previoussong`/`song`/`nextsong`),
2. the **episode's declared start** (WS26 Part 3 merges `relativeStartTime`
   anchored to the episode start), and
3. the device's wall clock.

A 10–15 s lead is consistent with the **episode-start anchor sitting ahead of the
actual audio start** — SR publishes no audio-start offset, so the episode's
declared start has been standing in for one.

**Treat this as separate from item 2, and prove which of the two it is.** If
`edgeMinusNowS ≈ +25 s`, part of the 10–15 s could be that same bias, because
every position is derived from the same belief. **The readings are close enough
to share a cause and far enough apart to be two — which is exactly why a single
constant must not be applied to both.** Establish which, with a reading.

## 5. The one thing you must not do

**Do not add a correction constant, margin, or fudge factor to any of this.**
Not `+25`, not `+12`, not `SEEK_OFFSET_S`. There is currently **no** such
constant in the code, and a test in `tests/fixpass.test.mjs` **rejects one by
name**. That test is a deliberate guard and it must stay green.

The prior readings were **~10 s, then ~30 s, now ~25 s** — on different
programmes. A constant fitted to any of them is wrong for the others, and the
owner has said outright that the two offsets are not the same. **If a correction
seems to be the only answer, that is the signal that the real cause has not been
found yet. Report that instead of shipping the constant.**

## 6. Also check, cheaply, while you are in the code

- **`streamEdgeWallMs()` and `playheadWallMs()` are near-duplicates** computing
  the same thing from `seekableEnd`. Two copies of one assumption is the
  `AGENTS.md` §3 hazard ("one field, one writer") applied to an assumption
  rather than a field. If they can share one implementation, that is a real
  improvement — and if they ever disagree, that is a bug.
- **Does the edge belief change across a long session?** A sliding HLS window
  that re-registers its buffered range would make the offset drift, which would
  also explain a *variable* reading. `recordStreamEdge` is called on every
  programme skip; `before` vs `after` shows movement.

## 7. Status reporting — MANDATORY

Write to `SESSION-STATUS.md` throughout (`AGENTS.md` §13). This is how the tech
lead follows you.

- **at the start** (a baseline you actually ran, plan, scope),
- **after every test run, every decision, every file edit**,
- **at least every 5 minutes** while working, even if nothing changed — write
  `no change, currently: <what you are doing>`,
- **at the end**.

```markdown
## WS28 — <phase> — <ISO timestamp>

**Started / baseline:** `npm test` → **N/N pass** (your own run)
**Scope now:** what is changing, and what is explicitly OUT of scope
**Decision or finding:** one or two sentences
**Test count:** before → after
**Working tree:** clean / dirty (which files)
**MEASURED:** the number, how it was obtained, and **what it does not prove**
**Blocked:** or "nothing"
**Next:** the single most valuable next step
```

**The baseline matters most: never report a test count you did not run.**
Append-only within a workstream; to correct something, say what the earlier claim
was and what it is now.

## 8. Testing

**A measurement is the deliverable here, not a patch.** A well-instrumented,
correctly-interpreted reading beats a speculative fix.

If you do change code, it must be **driven** — real functions extracted from
`app.js` by brace matching and executed, never re-typed into a script — and it
must be **red on today's code**, with the red proven and checksums reported.

**Use the browser before asking the owner.** `scripts/cdp-eval.mjs` evaluates an
expression in a running Edge/Chrome on port 9222; `window.__srSeekable()` is a
debug handle already in `app.js`. State what the browser run proved and what it
did not. **What the browser cannot do:** load SR's DVR HLS (CORS), decode audio,
or confirm a touch gesture. **Never write "verified" for anything not seen on
the device.**

## 9. Commit and STOP

- Source and tests in **ONE commit**, plain-English message.
- **Then stop.** No `npm run build`. **No push**, to any branch. The owner
  reviews, and build and push are separate steps.

## 10. Final report

**CODE CHANGE** (file + function, and what you did **not** touch) /
**MEASURED** (number, how obtained, **what it does not prove**) / **NOT DONE**
(named as not done). Then, separately, **what still needs the owner's iPhone** —
and if the decisive next reading is one the owner has to take, **say so
plainly and say exactly where to look.**
