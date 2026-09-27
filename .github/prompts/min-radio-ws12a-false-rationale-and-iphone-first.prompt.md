---
name: WS12A — remove the false occlusion rationale, and iPhone-first for UX claims
description: A narrow, safe follow-up to WS12 Part A. The owner has established that the player NEVER covered the build line under NYHETER. That false rationale is still recorded in a test name and a stale comment, and the general "iPhone first / ask the owner about UX" rule was not in the prompt the agent received. This corrects both, and changes no other behaviour. No push — commit only.
applyTo: "**"
---

# WS12A — delete the false reason, and ask before assuming about looks

## 0. Read this first: what is already done, and what is NOT yours to do

WS12 Part A has been implemented. Do not redo it. **Verified as of this writing:**

- `app.js` — the build line is `$main.appendChild(el('p', { class: 'build-line', text: \`bygg ${APP_BUILD}\` }))`,
  after the news section, before `updatePlayingMarks();`. **Correct.**
- `styles.css` — `.build-line` is back to the WS10 block form
  (`margin: 18px 0 4px; font-size: 11px; line-height: 1.4; opacity: 0.75; word-break: break-all;`)
  with no topbar-only properties. **Correct.**
- `index.html` — `.topbar` has no `build-line`; two children, so the cog is
  right-aligned again. **Correct.**
- `tests/metadata-diag.test.mjs` — the placement assertions were rewritten, and
  importantly as **negative guards** (`must NOT be moved back into the .topbar`),
  plus a `space-between` check so the cog cannot silently lose its position.
  **Correct, and better than the original brief asked for.**
- The `1.5.0` version is **not** restored and `scripts/build-pages.mjs` was **not**
  given a version injection. **Correct — do not "helpfully" add either.**

**You have exactly two jobs.** Both are in §2 and §3. Touch nothing else.

### Measure your own baseline. Do NOT trust any count written in this prompt.

An earlier draft of this addendum carried a hardcoded baseline claiming two tests
were red. **That was already wrong by the time it was read** — the other agent
finished Part C and the suite went to 184/184 while the prompt was still claiming
182/184. The agent running this work correctly refused to act on a stale number.

That is the lesson, and it is the same lesson as §2: **a fact copied from an
earlier moment stops being true and keeps looking true.** So:

- **Run `npm test` yourself, first, and record the real counts.** That output —
  not anything written here — is your reference.
- Do not assume the tree is green. Do not assume it is red. Do not assume the
  other agent is still working. **Measure.**
- Your success criterion is **"no new failures relative to your own baseline"**,
  and you must state both numbers. If the suite is green when you start, say so
  and keep it green.
- If it is *not* green when you start, note which tests and why you believe they
  are not yours, and **do not attempt to fix them.** Work in progress you did not
  write is not yours to repair.
- **The tree may be actively edited while you work.** Re-run `npm test`
  immediately before you commit, not only at the start. If the counts moved
  without your involvement, say so.
- Do not use `git stash`, `git checkout --`, or any command that could disturb
  uncommitted work you did not write. **Leave the tree exactly as you found it,
  except for §2.**

## 1. Why this addendum exists at all

The owner's words:

> "i noted that you said the version and build under nyheter made the expanded
> player hide it. on iphone i have never seen that happen as there is space left"

> "so your comment proves that you have to request my support for all ux and ui
> related questions. iphone comes first"

**The claim that the player covered the build line was never observed by anyone.**
It was asserted by the reviewer when WS11 moved the line up, and then repeated
until it read like a measurement. The owner has now checked it on the device and
it is false.

The general failure: **an unverified visual claim becomes authoritative by being
duplicated.** Written once it is a guess. Written into a test name and a commit
message it is indistinguishable from something somebody watched happen — and the
next reader, including a later you, cannot recover the fact that it was invented.

Most of that duplication is already gone (§2). Two traces survive.

---

## 2. Job 1 — remove the last two false traces

> ⚠️ **BOTH OF THESE MAY ALREADY BE DONE.** The other agent has been working in
> this same tree. Before editing anything, **look first**. If §2.1 and §2.2 are
> already handled, say so and move to §3 — do not redo them, and do not
> "improve" a rename that is already honest. A finished edit re-applied is a
> second, different edit.

**Find things by TEXT, not line number** — the file is being edited.

### 2.1 The test NAME

```js
test('WS11 Part B: no frozen version, and the line cannot be occluded', () => {
```

"cannot be occluded" is a false claim written into a test title. **Rename it.**

- Keep the "no frozen version" half — that test's `APP_VERSION` assertions are
  valid, correct, and **must not be touched**.
- The name should describe what the test now actually guards: that no frozen
  version is displayed. Do not keep the word "occluded", and do not introduce a
  new unverified adjective in its place. A neutral, checkable name is better than
  a vivid one.

### 2.2 The stale comment

```js
  // Placement: the top bar, not the scrolling content.
```

The two lines *underneath* it are already correct and were already fixed by the
agent (they assert `$main.appendChild` and the negative `!…topbar…`). Only this
comment is left over, and it now argues **against** the code right below it.

**Delete the line.** The following comment already explains the placement
correctly and attributes it honestly. If you want a lead-in, write one that
matches what the code does.

### 2.3 A completeness sweep — report, do not assume

Run a search across `app.js`, `styles.css` and `tests/*.mjs` for the vocabulary
of the false claim: `occlud`, `scrolled away`, `always-visible`, `scrolling
content`, `cannot be covered`, `visible only because`, `scrolled out of sight`.

**The only legitimate hits are ordinary English uses of "cannot"** (e.g. "so it
cannot be removed twice"), which have nothing to do with this. Do not rewrite
those.

Report the raw search output, and state plainly whether any genuine trace
survives. If you find one, remove it; if you are unsure whether a hit is genuine,
**ask the owner rather than guessing** (§3).

### 2.4 What you must NOT do

- **Do not** attempt history surgery. Commit `07b41d5`'s message says "so it
  cannot be scrolled away or occluded. The old placement was visible only
  because the player was closed." A committed message cannot be rewritten, and
  rewriting history on a deployed repo is far worse than a wrong old message.
  Instead, **say plainly in your report that the original rationale was wrong**,
  so the correction is on the record.
- **Do not** "fix" the player so it would not cover the line. The player was never
  the problem — the placement was. There is space below NYHETER; the owner has
  said so from the device.
- **Do not** reinstate the `1.5.0` version, and **do not** add a `__APP_VERSION__`
  injection to `scripts/build-pages.mjs`. The owner's instruction was explicit:
  *"but without the stale 1.5.0"*. The number never moves, so displaying it is a
  lie — that reasoning still stands and the owner accepted it.

---

## 3. Job 2 — iPhone first: ask, do not assume (standing rule, from here on)

The owner's standing instruction, which governs this and every future workstream
in this project:

> "you have to request my support for all ux and ui related questions. iphone
> comes first"

**The iPhone is the reference device. Desktop Chromium is not.** That is
established, not debated: WS11a reported "no overflow at 390px and 340px" from a
**non-DVR** channel, while the owner's actual screen was the **7-button DVR** case
where the text column measured **0px**.

Concretely:

1. **Never** state how something looks on the owner's phone as fact. You have no
   device. Report *what you measured, where, at what viewport, in what player
   state* — and label it Chromium, not the phone.
2. **Never** invent a visual justification for a change. A change with no observed
   reason is a change you should not make. If asked why, the honest answer is
   "because I assumed" — which is what produced this whole addendum.
3. **Never** let an unverified visual claim reach code, comments, test names or
   commit messages. §2 exists because it did.
4. **When a UX/UI question cannot be settled by measurement — does it overlap, is
   it legible, is this wanted, which of two layouts — STOP AND ASK.** One message
   costs the owner far less than a wrong assumption. A question is never a
   failure to progress.
5. **Ambiguity is a reason to ask, never a licence to choose.** "The owner
   probably meant…" is how the close button ended up on the wrong row for an
   entire workstream, and how the build number was moved up without them.

Measuring layout, widths, overflow, alignment and colour in Chromium is
welcome — clearly labelled as Chromium, at a stated viewport. It is only when you
*generalise it into a claim about the phone* that this rule bites.

---

## 4. Anti-vacuity rules — this project has been bitten by every one

1. **Never assert a guard "does not fire" once your change makes it unreachable.**
   WS6 shipped 162 green tests over a button that could never be reached.
2. **A negative result scoped to one direction is not a negative result.** WS8's
   agent tested only backward seeks; 24,947 forward counterexamples followed.
3. **A pattern containing a comment can never match a `stripComments()`ed slice.**
4. **Assert the specific promise, not a proxy.** A reviewer checked the *header*
   alignment and declared the layout intact while the seek row had a third flex
   child. And a brief paraphrased the owner's words and the paraphrase went
   unchallenged for a whole workstream.
5. **Never use `git checkout --`** to restore uncommitted work. It destroyed WS5b
   once.
6. **Mutation harnesses must compare md5 BEFORE AND AFTER each mutation.** A
   harness that only verifies the anchor reports no-op mutations as green.
7. **`region()` searches FORWARD.** A region opened on the wrong declaration
   silently begins *after* the element under test.
8. **A check that cannot fail is not evidence.** `document.scrollWidth` stays
   under the viewport even while a flex row overflows internally.

**And the one this addendum is about:**

9. **An unverified claim, duplicated, becomes indistinguishable from an observed
   one.** Do not copy a rationale into more than one place without asking whether
   it was ever true. One copy can be corrected; four copies read as consensus.

---

## 5. Boundaries — do not touch

- **Seek behaviour.** `seekBy`, `seekToLive`, `seekToProgramTime`, `posMs`,
  `liveEdgeWallMs`, `playheadWallMs`, `pickByPosition`, `resolveMetadataForPosition`,
  the programme-skip lookup, and every DVR constant. **The forward-skip button
  works on the owner's phone.** These must be byte-identical to
  `git show 745493c:app.js`.
- Do not touch `.topbar`, `.build-line`, the `space-between` mechanism, the cog,
  or the placement — Part A is done and correct.
- Do not touch Part B (transport row), Part C (podcast cover, mid player) or
  Part D (push) of WS12 unless you were also given those.
- Do not modify the `APP_VERSION` assertions. Only the **test name** changes.
- Do not change `package.json`, `sw.js`'s caching, or the manifest.
- No new dependencies. No CI. No new files other than test edits.

## 6. Evidence required

- **Your own `npm test` run, captured BEFORE you change anything**, and the same
  command immediately before you commit. State both, and confirm the failure set
  is unchanged relative to your own baseline. **Never** report a count copied
  from this prompt — see the note at the top of §0.
- The renamed test line, before and after, verbatim.
- The raw output of the §2.3 sweep, with a plain statement of whether any genuine
  trace survives. Ordinary English uses of "cannot be" ("so it cannot be removed
  twice") are unrelated to this and must be left alone — say that you recognised
  them as such rather than silently skipping them.
- Confirmation that the `APP_VERSION` assertions are **byte-identical** to before
  (`git diff` shown for those lines).
- A diff summary proving nothing outside §2 changed: `git diff --stat`, plus
  explicit confirmation that **`app.js` and `styles.css` are unmodified by you**.

## 7. Honesty requirements

Say which parts you changed, which you verified, and which you merely reasoned
about. **Do not describe anything you did not measure as measured.** If you are
unsure whether a remaining hit in §2.3 is a genuine trace, say so and ask — do
not resolve the ambiguity yourself.

**Do not claim the app is fixed on the phone.** You have no device. Desktop
Chromium is not the iPhone, and that distinction has already cost this project
three workstreams. What you can honestly report is what the code does and what
you measured in Chromium.

## 8. Commit — and DO NOT PUSH

- `npm test` green, then `node --check` the test file.
- `git add` **only** `tests/metadata-diag.test.mjs` (and any file you genuinely
  had to correct under §2.3). **Do not** `git add -A`.
- Commit with a message that states plainly: the occlusion rationale was never
  observed, the owner verified on the iPhone that there is space below NYHETER,
  and the line has moved back to where WS10 had it at the owner's request.
- **Do NOT push.** This addendum is reviewed before it ships. Report the hash.
