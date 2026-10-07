# WS31 — commit WS30, and fix the one state that misinforms the reader

**From:** tech lead. **To:** coding agent (Space Bunny), in your own chat.
**Date:** 2026-09-30. **Baseline when written:** `main` = `0cb7f0d`, working tree
carrying **uncommitted** WS30 work.

Read `AGENTS.md` first — it is auto-discovered for you. Then this brief. The brief
is a **contract**: it names acceptance criteria and the evidence bar.

---

## 0. First, the state you are inheriting

WS30 is **done and technically good**, and it is **uncommitted**. I reviewed it
and it passes every hard criterion I set: the security gate is byte-identical,
all 7 timing constants are untouched, there is **no correction constant**, the
removed lines are all inside the readout you replaced, and the suite went
**235 → 251**.

**I independently mutation-tested your new tests**, because the pattern in this
repo is green tests that prove nothing. Reverting the panel to the old
tautological number → **6 tests fail**. Planting a correction constant → **2
fail**. Flipping the sign logic → **1 fail**. Restores checksum-verified.
**That is the property WS29's 235 tests lacked, and you established it.**

Two findings of yours I am recording as credit, not criticism:

- **The browser caught "−30 s före"** — a minus sign beside the Swedish word for
  *ahead*. You found it, fixed it, pinned it with a test, then **found it again**
  when a later wording change reintroduced the mismatch. **A source-text suite
  cannot find this class of bug.** It is the first browser-caught defect in this
  repo that fed back into a test.
- You diagnosed your own test defects honestly: a **substring trap**
  (`p2_320.pls` matching inside a *comment*), an **exclusive window** that made a
  mutation unobservable, and a **reachability test that could not distinguish
  two call sites** — that last one is the `AGENTS.md` §7a trap, and you caught it
  in yourself.

**Two process gaps, which is why this brief exists:**

1. **You wrote no block in `SESSION-STATUS.md`.** Your evidence exists only in a
   chat transcript, and `AGENTS.md` §13 requires it in the file: *"A report that
   only exists in chat cannot be audited."* Part 1 of this brief fixes that, and
   it must be written **before** the commit so the commit message can be honest.
2. **You stopped without committing**, so 251 tests and ~600 lines of work sit
   uncommitted in a working tree. `AGENTS.md` §8 — source and tests in ONE
   commit. That has twice left the tip of `main` failing.

---

## Part 1 — WRITE THE MISSING STATUS BLOCK, FIRST

Before any commit, append a block to `SESSION-STATUS.md` in the required format.
**This is not a formality: the numbers in it are the audit trail for the commit
you are about to make.**

It must contain, at minimum:

- **Started / baseline:** `npm test` → the **real** counts you measured at the
  start of WS30. Not a number from any log.
- **Scope now** and **OUT of scope**, explicitly.
- **The sign bug**, stated as a finding: what the browser rendered, why it is
  self-contradictory, and that you found it **twice**.
- **Your four self-found test defects** and how each was fixed. Name the
  substring trap, the exclusive window, and the two-call-site reachability trap.
- **The red proof**: how many mutations, which went red, and the checksum
  verification of every restore.
- **MEASURED:** the in-browser figures — master 200, one PDT, 1700 segments,
  sum 10880.0 s, **−26.66 s** — **and what they do NOT prove**: not the app's
  edge belief, not the device, not that the app mis-seeks.
- **The desktop MP3 fallback**, and therefore that the two-source panel **cannot
  be exercised end-to-end in desktop Chromium**. Say so rather than implying the
  browser run covered it.
- **NOT DONE**, named as not done: nothing committed until now; the offset
  unmeasured on the device; the ~25 s programme-skip defect **unfixed**; the
  10–15 s song-title offset untouched; R5, `DATERANGE`, Android, E1b, podcast
  search untouched.

**Append-only.** Do not remove or rewrite my three earlier blocks. A correction
must name what it corrects.

---

## Part 2 — ONE COMMIT, source and tests together

Commit **all** of WS30's work: `app.js`, `tests/metadata-diag.test.mjs`, the new
`tests/two-source-clock.test.mjs`, **and** the `SESSION-STATUS.md` block from
Part 1.

- **Do NOT build. Do NOT push.** The brief's original AC10 still holds, and a
  build rewrites tracked root artifacts.
- **`ENHANCEMENTS.md` is mine** — I have a log entry for WS30 in it. Leave it
  uncommitted or commit it as a separate docs commit; your choice, but **say
  which you did.**
- Commit message: state what the workstream does and that **it instruments, it
  does not fix**. Do not write "fixed the offset" — it is not fixed.

**Then verify the commit:** `git status` clean of source, `git log -1 --stat`,
and `npm test` still 251/251 **from the committed tree** (`git stash list` must
be empty — you should not need a stash).

---

## Part 3 — ONE real defect to fix: the panel misinforms on a playing channel

This is a **new** defect, found by me during the WS30 review. It is **not** in
the committed WS30 work and it is **not** a WS30 regression — it is a state
condition WS30's panel inherited.

### The defect

`activeHlsMasterUrl()` returns `null` unless the transport is HLS. When it does,
`sampleStreamEdgeClock()` **returns early and leaves `status` at its initial
`'idle'`**. But the panel's no-stream branch tests a **different** condition
entirely — `!dvr || !dvr.streamEdge`, which is about the *snapshot*, not about
whether a channel is playing.

So on a channel playing **direct MP3**, the owner is told:

> **"Starta en radiokanal först"** — while a radio channel **is playing**.

**MEASURED (driven probe, canary confirmed the extracted code executed):**
`masterUrl = null`, panel `primary = "Starta en radiokanal först"`,
`state = 'no-stream'`.

**Why this matters more than it looks.** This is the *same class* of defect WS30
exists to fix: **a state that tells the reader something untrue.** The owner
would reasonably conclude the feature is broken, when in fact the app is playing
a stream that simply has no HLS playlist to read. And a misleading state is
exactly what generated this repo's worst false conclusions.

**Note the environment fact that makes this reachable for the owner too:**
desktop Chromium falls back HLS → direct MP3, and **so does the app on the
owner's iPhone whenever HLS is unavailable.** This is not a desktop-only path.

### What to do

Make the readout distinguish **these** cases, and never claim a channel is not
playing when one is:

| situation | what the owner must see |
|---|---|
| no channel at all | the existing "Starta en radiokanal först" — **correct as-is** |
| **channel playing, but not HLS** (direct MP3) | an explicit state saying the stream has **no playlist to read** — e.g. that the stream is direct audio so there is no stream clock to compare against. **NOT** "start a channel". |
| channel playing on HLS | the measurement, as now |
| fetch in progress / failed / stale | as WS30 does — explicit, never a bare `0` |

**Requirements:**

1. **The message must be derived from what is actually true**, not from an
   unrelated condition. Name the condition you test and be able to state why it
   is the right one.
2. **Keep the existing no-channel message intact** for the genuine no-channel
   case — it is correct and the owner knows it.
3. **New state, new test.** A test that fails if the misleading message is shown
   while a channel is playing on a non-HLS transport.
4. **Prove it red**: make the panel say "Starta en radiokanal först" for a
   playing non-HLS channel, confirm the new test goes red, restore, **verify by
   checksum**.
5. **Drive it in the browser on the direct-MP3 path** and assert on the
   **rendered text** — that path *is* reachable on desktop, so this one **can**
   be verified end-to-end without the iPhone. This is the first defect in this
   queue that a desktop browser run can actually settle.

### Out of scope for Part 3

- **No correction constant.** Still zero. `AGENTS.md` §5.
- **No change** to `seekToProgramTime`, `seekBy`, `seekToLive`,
  `playheadWallMs`, `dvrPositionToDate`, `activeHlsMasterUrl`'s HLS requirement
  (it is *correct* that it needs HLS — fix the **message**, not the guard).
- **Do not make the panel measure anything new.** The measurement is done.
- `metaDiagGateOpen` — byte-identical.
- The false `DATERANGE` comment, R5, the `Spelas just nu` label, Android, E1b,
  podcast search, the lock-screen-wrong-PWA item.

---

## Part 4 — then STOP

Commit and stop. **Do not build. Do not push.** A deploy is a reviewed step with
a checklist (`AGENTS.md` §15), and I run it.

**One environment cleanup, and it matters:** `dist/` is currently a **stale
mix** — you copied your source into it so the dev server would serve it. I
verified `dist/` is a build **output** (`build-pages.mjs` wipes it) and is
git-ignored, so **the tracked deployable artifacts are untouched** — that was
the right call and I checked it rather than assumed it. But **`dist/` must be
regenerated by a real build before any deploy.** Say in your report that it is
stale, so the next session does not serve it by accident.

---

## Acceptance criteria — done when all are true

1. **`SESSION-STATUS.md` has your block**, with the numbers you actually
   measured, appended **without** altering my earlier blocks.
2. **Exactly one commit** containing source + tests + your status block.
   `git status` shows no uncommitted source.
3. `npm test` → **251/251 or higher** from the committed tree, **and the count
   went up again** because of Part 3's new test. Green with an unchanged count
   means the suite cannot fail on the defect it was written for.
4. **The misleading state is gone**, proven red first and restored by checksum.
5. **Browser-driven assertion on the rendered text** for the direct-MP3 path,
   stating what it did and did not cover.
6. **Zero correction constants** in code. If you think one is warranted, **report
   it as a recommendation — do not add it.**
7. `metaDiagGateOpen` byte-identical; all 7 timing constants unchanged; the
   security gate still yields nothing on a shared `?diag=metadata` link.
8. Report in the `AGENTS.md` §9 form: **CODE CHANGE** / **MEASURED** /
   **NOT DONE**, separately. Never "verified" for anything proved offline —
   use *fixture-proven*, *code-proven*, *browser-driven*.

## Stop conditions

Stop and report rather than guess if:

- fixing the message appears to require touching the HLS guard itself, or any
  transport constant;
- the non-HLS case turns out to have **another** truthful source of information
  you did not expect — report it, do not build around it;
- you cannot make the new test go red;
- you find the WS30 committed work is **not** actually as sound as this brief
  says. **Say so.** Do not quietly fix it — a disagreement is information, and I
  would rather hear it than find it later.

**The offset remains unmeasured on the device and unfixed.** The panel tells the
owner the truth about what it knows; it does not yet tell them what is wrong with
the app, and that is the next workstream after the owner reads a number.
