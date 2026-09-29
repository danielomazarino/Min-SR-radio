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
  will look. Label it plainly, in Swedish.
- **The number must appear as TEXT ON SCREEN**, so the owner can read it and
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

Once the switch exists and the owner can see the value, the reading to take is:

> Open the app. Play a channel that has **hourly news** (so the programme
> boundaries are obvious to the ear). Tap the **programme-skip** button once.
> Open **Om** and turn diagnostics on. Read the line showing `edgeMinusNowS`.

**Then interpret it** — and write the interpretation into `SESSION-STATUS.md`
before touching any code:

| `edgeMinusNowS` | what it means | what to do next |
|---|---|---|
| **≈ 0** | the app's edge belief is **accurate**. The ~25 s is NOT here, so it lives in the schedule's own times or where SR places the boundary. | investigate §3.2 — the schedule path, and whether the browser clamped the seek |
| **≈ +25 s** | the app's edge is ~25 s **behind** reality, and **one cause explains both owner readings**. | investigate §3.1 — but do NOT add a correction constant |
| **inconsistent between presses** | the edge is being re-registered around the seek. | `before` vs `after` will show the movement; a sliding window that re-registers is a real mechanism |

**`clampedByS` is the second number and it is equally decisive.** If it is not
~0, **the browser clamped the seek** and the offset is not in the app's
arithmetic at all. That is invisible from outside the app and would look exactly
like a wrong offset.

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
where `playheadWallMs()` and `streamEdgeWallMs()` make the assumption. Note
`app.js:3337` already references `EXT-X-DATERANGE` metadata — that is where SR
publishes exactly this mapping, and **that path has never been built.** It is
the most likely real fix for both offsets. Investigate whether it is reachable
with the existing hls.js integration before proposing anything else.

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
