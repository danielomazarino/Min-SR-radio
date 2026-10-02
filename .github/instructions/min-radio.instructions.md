# AGENTS.md — Min Radio PWA

Standing instructions for any agent working on this repository. These are the
rules that cost real time when they were not followed. Read before changing code.

The owner is the **product owner and is not technical**. They use this app on an
iPhone. Write explanations for them, not for a colleague.

---

## 0. Before you start: the two questions that decide everything

**0a. Is the code you are about to write REACHABLE?** See §7a. A correct, tested,
never-executed fix is the most expensive defect in this repo, and it has happened
twice for the same gate.

**0b. Is the suite green?** If not, **stop and classify each failure before
changing anything** — see §7b. Do not deploy from a red tree.

**0c. What does the owner's specification actually require?** It is in §12 and it
is not negotiable per-workstream. Read it before designing anything. This
requirement has been lost between workstreams at least three times, and each
time it was re-derived from scratch at a cost of hours.

---

## 1. The device is the only real test rig

**Desktop Chromium cannot load SR's DVR stream** (CORS-blocked). Every DVR
behaviour — seek, programme title, song line, cover, offset — can only be verified
on the owner's iPhone. There is no substitute.

Therefore:

- **Never write "verified"** for anything you proved offline. Write
  *fixture-proven*, *code-proven*, or *device-verified by the owner*.
- Desktop green ≠ device correct. **This has happened repeatedly.**
- A change touching DVR behaviour is not finished when the suite is green. It is
  finished when the owner has run it.
- The automated browser has no audio output. "No audio" is a tool limit, not a
  defect.

**When you hand work back, tell the owner which build to check.** The build id is
the small line under NYHETER on the main screen. If it does not match, they are
testing old code — this has silently invalidated a whole session's results.

**Red tests mean STOP, not "work around it".** On 2026-09-29 the working tree
sat with 5 failing tests, modified `app.js`, and nothing committed — while the
plan was to deploy. That is the state that has twice left the tip of main
failing. **Do not begin a deploy while the suite is red.** Classify the failures
first (see §7b).

**The owner's device report outranks any offline reasoning, including yours.**
The owner twice reported a symptom and twice was right where an agent was wrong:
the pre-midnight title "coming back" (the code was untouched — the cause was
elsewhere) and the artwork fix "regressing" (it was, and from the agent's own
change). When the owner says they see something, treat it as a measurement, not
as a report to be explained away.


---

## 2. The tests check the code's SHAPE, not the app's BEHAVIOUR

The suite asserts on **source text**. It can prove a call exists. It cannot prove
the screen shows the right thing.

**A test that proves the wrong property is worse than no test** — it buys false
confidence. This happened in WS24: the test asserted "the live path is unchanged"
(which was true) and never asked "does the live path fight the seek?" The result
shipped, passed 214 tests and 17 mutations, and broke the panel.

**Before writing a test, ask: what is the behaviour that would be wrong if this
regressed?** Then assert *that*. If you cannot state the user-visible failure,
the test is not worth writing.

**Prove each test can go red.** Revert the change, confirm red, restore by
checksum. A mutation that reports green because it never applied is worse than no
test.

**A metric that cannot fail is not a metric.** This has taken three forms:
asserting a guard doesn't fire after your own fix made it unreachable; a table
whose variable cancels so every row is identical; counting `null == null` as a
match and reporting "10 801 correct" when 10 317 were empty.

**Before publishing a number, state what result would have made it come out
differently** — and confirm the probe could produce it. WS25's L-lag table
printed `error 0 s` for every value of L because L cancelled in its own
arithmetic; a reader would have taken away "the stream lag causes no bias", which
was never established. An experiment that cannot fail is not an experiment.

**A sweep that returns zero for the most recent date is a broken sweep.** If
*today* is empty, fix the probe before believing any row of the table. This
happened in WS25: a typo in the parser turned every date — including today —
into zero, producing a clean table that would have supported any conclusion.

---

## 3. One field, one writer

**The most damaging bug class in this repo is a single piece of state written from
two paths, where the last writer wins.**

`nowPlaying.artwork` is the worked example: the 45 s live poll writes it with the
**on-air** song, and the seek path writes it with the **playhead's** song. Scrub
back → the seek sets the right cover → the poll overwrites it. It survived a
mutation-verified release.

**Before you write to a field, find every other writer.** Grep for it. Ask what
the other writer is for. If two intents share one field, split the field or
guard the write — do not let them race.

**Corollary:** when fixing a display, check the *whole* display, not the part that
was reported. The owner's report was "no cover when scrubbing back". The real
defect was that the **header card** (title, artist, cover) always showed the
on-air song while row 4 followed the playhead — two halves of one panel telling
different stories.

**And check whether the things you think are the same bug actually are.** They
often are not. The cover race and the header mismatch have *different* causes, so
fixing one alone would leave title and cover describing different songs. State
the cause per surface; do not bundle them into one "fix the song display" change
that appears to work while half of it is still wrong.

---

## 4. Batch the fixes; do not ship one narrow fix at a time

Successive symptom fixes create new seams for the next one. WS23 and WS24 each
fixed something real, and their interaction produced a regression that was worse
than either bug alone.

**Prefer one integrated change** that establishes a single source of truth, over
a third narrow fix that touches one more field.

**Every deploy is a chance to break what was working.** Push deliberately, with
the four deploy checks run individually against the **live** site.

---

## 5. Never hardcode a number to make a report go away

Not a 10-second offset, not a 30-second offset, not an average of observations.

A fudge factor chosen from one sample freezes that sample into permanent
behaviour, and the next session inherits it as fact. This happened: "10 seconds"
became folklore across three workstreams before the owner measured 30 on another
programme and showed it was **variable** and therefore not a constant at all.

**Make the assumption visible and measurable instead.** If a correction is
genuinely needed, default it to zero and mark it unmeasured.

---

## 6. A failed endpoint proves only that that endpoint failed

This repo has been wrong this way **three times**:

| wrong | right | how the right one was found |
|---|---|---|
| `scheduledevents` | `scheduledepisodes` | the owner pointed at a working third-party site; its traffic was inspected |
| `channels/{id}/rightnow` | `playlists/rightnow?channelid=` | enumerated candidates |
| "ondemand returns null track times" | it does, **for live programmes** | the earlier test was on **podcasts**, where it genuinely is null — two populations merged into one note |

**Enumerate candidates. Do not stop at the first 404 or 500.** Record the
failures — they are the useful part.

**Method traps when probing:**
- `curl` **without `--compressed`** returns gzip binary that prints as garbage and
  reads as a failure.
- **Omitting the `Origin` header** produces a misleading "no CORS header" result.
  A server may legitimately omit it when no origin is presented. Re-test with an
  `Origin` set, and with an `OPTIONS` preflight.

---

## 7. A harness must prove it is executing the code under test

Before any number a harness produces is allowed to be called a finding:

- **Positive canary** — a counter the extracted function itself increments,
  printed on every run. Not a `console.log` probe alone.
- **A `function` declaration passed to `new Function(...)` as the body is never
  invoked.** It is hoisted and defined, and silently does nothing. This produced
  a set of confident, entirely fictional "the seek functions do nothing" results.
- **Your extractor must handle `async` and arrow-function consts.** A
  brace-matcher keyed on `function NAME(` will silently extract
  `async function f(` as a sync function, and will not see
  `const f = () => {}` at all. Both failures are silent — the harness runs and
  returns a wrong answer rather than erroring.
- Compare checksums before and after every mutation and restore. Report
  **NO-OP** as a hard failure, not "missed".
- Stubs passed as function parameters shadow the *identifier*; `new Date()` in
  the body is a **constructor call** and resolves to the real global.
- Extract real functions from `app.js` by brace matching. **Never retype logic
  into a script** — that is how two workstreams reached wrong conclusions.

**A sweep that returns zero for the most recent date is a broken sweep.** This
happened in WS25: the parser read `scheduledepisodes` where the key is
`schedule`, producing a clean-looking all-zero table that would have supported
any conclusion. If *today* is empty, fix the probe before believing any row.

---

## 7a. Is the new code REACHABLE? Prove it, don't reason about it

**The most expensive class of defect in this repo is a fix that is correct, well
tested, and never executed.**

WS26 Part 4 replaced the pre-midnight clock gate with a better question — "does
the DVR window actually reach into yesterday?" — and the new gate read
`seekableStart`. But `resolveProgramTitle` → `fetchSchedule` runs inside
`playTrack`, and `playTrack` calls `renderPlayer()` **before** it. `renderPlayer`
never calls `updateSeekableState`, and the recording length is only populated
later by `loadedmetadata` / `durationchange`. **So `seekableStart` is still
`null` when the gate runs, the new gate cannot answer its own question, it falls
back to the clock, and the fix changes nothing.** The second `fetchSchedule`
call site is inside a pointer/click callback and is not reached on load.

**This is the same finding as WS21, one workstream later.** A gate that reads a
value nothing has written yet cannot fire.

**Before you call a fix done, answer: what executes this code, and when?**

1. Name the call site and prove it runs on the path the owner uses.
2. If it depends on a value populated by an event, name that event and prove it
   has fired by then.
3. **Proving the OLD code was wrong is not evidence the NEW code is right.** A
   test that only shows the removed branch was wasteful passes even when the
   replacement never executes. Assert that the new path is *reached*, not only
   that the old text is gone.

---

## 7b. Fixing a failing test is the highest-risk moment in a workstream

**Red tests are a gate. A green suite obtained by editing tests proves
nothing** unless each edit is classified first.

Before touching a failing test, decide and record which it is:

- **SUPERSEDED** — the requirement genuinely changed. Restate it to assert the
  *new* property at least as strongly, and keep the reason. Never delete, never
  weaken to a looser pattern.
- **A REAL DEFECT** — the code is wrong. Fix the code. **Never** edit the test.

**WS26 had 5 failures, 3 of them pure field renames, and 2 guarding the
pre-midnight gate.** The 2 were the only ones that could have caught a fix that
does not execute. Restating them to green — which the new code's elegance
invited — would have made an unfixed defect invisible.

**Rule: when a test guards code you are changing, prove the replacement is
reachable before you restate the test.** If you cannot, say so and leave the
failure visible. A red test that means something is worth more than a green one
that means nothing.

---


## 8. Commit discipline

- **Source and its tests in ONE commit.** Splitting them has twice left the tip of
  main failing.
- **Commit BEFORE building.** `npm run build` rewrites tracked root artifacts, so
  a `git checkout --` afterwards can destroy uncommitted work. It has happened
  three times. Back up to `/tmp`, verify by checksum.
- **Never `git checkout --` a file with uncommitted edits.** Recover from a
  backup, not from git.
- **Artifacts go in a SECOND commit, not the first.**
- **BUILDING AND PUSHING IS THE CODING AGENT'S JOB when the brief says to.**
  The tech lead does NOT deploy. A brief that is silent about pushing has
  previously left a finished fix sitting undeployed while the owner believed it
  was live — so **if the brief does not say, ask; do not assume it is someone
  else's step.**

---

## 9. Report what you actually did

The owner has asked for this directly. Separate these, and never blur them:

- **CODE CHANGE** — name the file and the function. Also name the files you did
  **not** change that a reader might assume were involved.
- **MEASURED** — the number, how it was obtained, and **what it does not prove**.
  Distinguish device / fixture / code evidence.
- **NOT DONE** — recommended work you did not perform, named as not done. A
  silent omission reads as "not needed".

A "deployed successfully" with no detail is not a report. The four deploy checks
are reported individually as PASS or FAIL.

---

## 10. Claims about people must be verified

**"The owner said X" is a claim about a person and must be verified like any
other claim.** A memory note is not a source — grep the transcript.

This went wrong once: a one-off verification request was promoted to a permanent
standing instruction, survived in a memory note, then got replicated into tests
and commit messages before a full log audit removed it. It cost a session.

Before writing that the owner wants or forbids something, find it in the record.
If you cannot find it, ask.

---

## 11. Language and scope

- **The owner writes in English.** New log entries in English. **Do not
  retro-translate** older sections — they contain verbatim quotes that are
  load-bearing.
- Never invent a visual justification. No observed reason → don't make the change.
- If a UX/UI question cannot be answered by measurement, **ask the owner**. The
  iPhone is the reference device; a desktop inference is not.
- "Investigate" means investigate. **Do not fix what you find** unless the brief
  asks for a fix. An unrequested fix is indistinguishable from a guess.

---

## 12. The specification the owner actually wants

**Whatever the playhead is sitting on, the whole panel must describe that same
moment** — the cover, the song title, the artist, and the song line. Live
programme and current-song information belong in the panel **only when the
playhead is at the live edge**.

Checked individually, because they can fail separately:

| | Requirement | Status as of 2026-09-30 (build `5eeabb9`) |
|---|---|---|
| R1 | header song title follows the playhead | **code-proven behind live** — never device-verified |
| R2 | header artist follows the playhead | **code-proven behind live** — never device-verified |
| R3 | header cover follows the playhead, never another song's | **code-proven behind live**; the 45 s poll race is closed |
| R4 | row 4 song line follows the playhead | **works — do not "re-fix" it** |
| R5 | programme name follows the playhead | mechanism fixed (WS26 Part 4); **behaviour unverified on device** |
| R6 | the two halves of the panel must never disagree | **fixed (WS27)** — code-proven only, never device-verified |

**"code-proven" means the behind-live case only.** Desktop Chromium cannot load
SR's DVR stream, so none of R1–R3 or R6 has been observed on a device. Never
write "verified" for anything proved on a desktop.

**R6 was fixed by one line** — `const song = hit || (atLiveEdge ? (nowPlaying.song
|| null) : null);` — because `pickByPosition()` returns the *first* containing
entry, so an earlier-starting timeline entry still spanning "now" **shadowed**
the polled on-air song. **Do not re-open it on the strength of a desktop test.**

The label `Spelas just nu` ("playing right now") is wrong when behind live and
**stays exactly as it is — the owner's decision, 2026-09-29 (option A).** Do not
re-open it and do not "improve" it.
