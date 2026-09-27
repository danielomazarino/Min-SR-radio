---
name: Min Radio — WS5b Player Layout Correction
description: Workstream 5b for Min Radio. Correct the WS5 player layout on the owner's iPhone: left-align the channel/programme header and the song line with the artwork and pills, group the channel and programme as one clean line, and move the close button and chevron up so they mark the top corners instead of floating in the middle.
argument-hint: "Runs Workstream 5b only — alignment and vertical placement corrections to the WS5 player. Presentation only, no behaviour change."
agent: agent
---

You are the Min Radio coding assistant. This is **Workstream 5b only**.

Workstream 5 moved the pieces to roughly the right places and reduced the
player's height. But the owner reviewed the result **on a real iPhone** and
found the visual result unclear. This workstream fixes **alignment and vertical
placement only**. It is still **presentation only** — no behaviour changes.

Read the owner's description below carefully. It is the specification, and it
refers to positions in a screenshot of the live app.

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
3. `/memories/repo/sr-pwa-app.md`.
4. The regions of `app.js` and `styles.css` named below, in full, before
   writing anything.

## Verified context (checked 2026-09-27 — trust this, do not re-derive)

Repo: `/home/lm/Dev/SR pwa app`. **Run `npm test` first and report whatever it
says as the baseline** — do not assume a number. Workstream 5 landed at 153
passing; use your own first run.

`HEAD` is `29b36fe` ("Redesign player layout: header above, song below, chevron
right, drop footer (WS5)"), which **is deployed**: live `app.2ba3eca2.js`,
`styles.98cdded5.css`, SW cache `minradio-29d8053b`. WS4 (`5e27b58`) is also
deployed and live.

`npm run build` writes `dist/` and then **copies the built artifacts back into
the repository root**; hashed bundles are tracked in git. Sequence: edit →
`npm test` → `npm run build` → `git add` root artifacts → `git commit` →
`git push`. **A commit without a fresh `npm run build` deploys nothing.**
There is no CI and never was.

### Current structure (verified — these line numbers are current)

Assembly in `renderPlayer()`, at the end of the function:

```js
$player.appendChild(headerLine);                                              // 2469
$player.appendChild(el('div', { class: 'player-header-btns' }, closeBtn, expandBtn)); // 2473
$player.appendChild(el('div', { class: 'player-row' }, thumb, meta, controls)); // 2474
if (songLine) $player.appendChild(songLine);                                   // 2475
if (seekRow) $player.appendChild(seekRow);                                     // 2476
```

- `headerLine` is created at `app.js:2457` as `.player-header`, containing
  `.player-title` and `.player-sub`.
- `songLine` is created at `app.js:2465` (live channels only) as
  `.now-playing-line`.
- `meta` is created at `app.js:1923` and now contains **only** the two pills:
  ```js
  const meta = el('div', { class: 'player-meta' }, quality, mode);
  ```
  The quality pill (e.g. `AAC 320 · buffrar`) and the mode pill (`LIVE` or
  `−12 min`) live here.
- Current CSS: `.player-header` at `styles.css:704-712` (flex,
  `align-items: baseline`, `gap: 8px`, `.player-title` capped at
  `max-width: 40%`), `.player-header-btns` at `styles.css:718-722` (flex,
  `align-items: center`, `justify-content: space-between`), and
  `.now-playing-line` at `styles.css:1060-1068`.

### What the owner sees, top to bottom, on the iPhone

1. `P3  Vaken` — the `.player-header` line
2. a row containing the **✕ close button** on the left and the **⌄ chevron** on
   the right (`.player-header-btns`)
3. the artwork, then the **quality pill** (`AAC 320 · buffrar`), then the
   **LIVE pill** beside it
4. `♪ Marie Fredriksson – Ännu Doftar Kärlek` — the song line
5. the seek bar and clock (`03:22`)

---

## Item 1 — The header and the song line must left-align with the content below

**This is the owner's main complaint.** Today the header and the song line are
full-width flex rows that start at the player's left padding, while the artwork,
the pills and the controls are inside `.player-row`. The result is that the text
appears indented relative to the artwork and floats, rather than forming one
clean left edge.

The owner wants, reading their own words:

> The channel and program name should be above the `AAC 320 · buffrar` pill,
> starting nicely left-aligned, and the same goes for the artist and song title
> that should left align with the three stacked above it.

So: **channel, programme, quality pill, mode pill, and song line must all share
one consistent left edge**, reading as a single aligned column, with the artwork
and transport controls participating in that same alignment.

How to achieve it — your choice, but it must be structural rather than a magic
number:

- The cleanest approach is to make the text block and the pills share a common
  container whose left edge is defined **once**, and to make the header line and
  the song line align to that same edge. Achieving it with a hard-coded
  `padding-left` equal to the artwork width is acceptable **only if** the artwork
  width is a single shared CSS custom property, so it cannot drift. Prefer a
  layout where the alignment is structural.
- Whatever you choose, **measure it in the browser** and report the actual
  `getBoundingClientRect().left` of `.player-title`, `.player-sub`,
  `.player-quality`, `.player-mode` and `.now-playing-line`. They should agree
  within a pixel or two. State the numbers.

## Item 2 — Group the channel and programme as one clean line

The owner wants the channel and programme to read as **one tidy line**, not two
loose items. Today `.player-header` is a flex row with the title capped at
`max-width: 40%` and the programme filling the rest, so a long programme name
pushes and truncates awkwardly.

- Present it as a single line: **channel name first, then the programme name**,
  visually subordinate (smaller or dimmer), separated by a clear gap.
- The channel name must **not** be squeezed to 40% — it is the primary
  identifier and should keep its natural width, truncating with an ellipsis only
  if genuinely necessary.
- Keep both text nodes as **separate elements with their existing class names**
  (`.player-title`, `.player-sub`). Do not merge them into one string: see the
  constraint section — `paintProgramTitle()` writes to `.player-sub` directly.

## Item 3 — Move the close button and chevron up to the top corners

**The owner's words:**

> The close button and chevron need to move up then to mark the corners nicely.

Today `.player-header-btns` sits on its **own row between** the header text and
the content row, so the two buttons float in the middle of the player with empty
space beside them, and the header text sits above them with nothing alongside.

They should instead sit on the **same row as the header text** — close at the
**top-left** corner, chevron at the **top-right** corner — so they frame the
player rather than floating in it.

- The buttons must share a row with `.player-header`.
- Close on the left, chevron on the right, **vertically aligned with the header
  text** (the owner asked for both to be on the same row; keep the alignment
  guaranteed by flexbox, not by pixel offsets).
- Achieving this may mean merging `.player-header-btns` into the header row, or
  absolutely positioning the two buttons into the header's corners. **Either is
  acceptable** — pick whichever keeps the existing paint functions working, and
  say which you chose and why.
- If you absolutely position them, the header row **must** reserve horizontal
  space for both buttons so the channel and programme text never runs underneath
  them. Verify the title is still fully readable.
- Keep the chevron's 180° rotation when open
  (`.player-expand-btn.open { transform: rotate(180deg); }`) and keep
  `setExpandOpen()` able to find `.player-expand-btn` inside `$player`.

## Item 4 — Do not let this workstream grow the player back

WS5 reduced the height from **159px to 134px**. Merging the button row into the
header row should keep that, or reduce it further.

- **Report the new player height in pixels** and compare it against 134px. If
  this workstream makes the player taller than 134px, that is a regression —
  either fix it or explain precisely why it was unavoidable.
- No horizontal overflow at 390px or 340px. Report both measurements.
- Check the 340px media query still handles the header properly.

---

## Hard constraints — breaking these breaks the app silently

These are the highest-risk part of this workstream. Read them twice.

1. **`.player-title` and `.player-sub` must keep their exact class names and must
   stay inside `$player`'s subtree.** `paintProgramTitle()` does
   `$player.querySelector('.player-sub')` and writes the resolved programme title
   into it. **Move it out of `$player`, or rename it, and programme titles stop
   painting — with no error and probably with green tests.**
2. **`.now-playing-line` must keep its exact class name, stay inside `$player`,
   and keep `aria-live: 'polite'`.** `paintNowPlaying()` does
   `$player.querySelector('.now-playing-line')`. Same failure mode.
3. **Keep the `:empty` and `.has-song` CSS behaviour.** A talk channel with no
   song must collapse the song line to zero height, not leave a gap.
4. **`.player-expand-btn` must stay inside `$player`.** `setExpandOpen()` queries
   it there and owns its `aria-expanded` and `open` class.
5. **Do not rename** `.player-title`, `.player-sub`, `.now-playing-line`,
   `.player-expand-btn`, `.player-btn-close`, `.player-meta`, `.player-row`.
6. **Do not merge the title and programme into a single text node.** Keep two
   elements; only their presentation changes.
7. **Do not change** the WS4 or WS5 behaviour: the `else if (behindLive)`
   go-to-live branch, the `Math.min(upper, ...)` clamp in `seekBy`, the removed
   `0.88` hit zone, `releaseDragStyles`, the `.player-header` presence, or the
   removal of the `.attribution` footer.
8. **Do not touch** `manifest.webmanifest`, MediaSession code, or the WS0
   diagnostics gate.

## Out of scope

- Any playback, seeking, gesture or diagnostics change.
- `scheduleCache` and `armPlaybackWatchdog` — both still open, both untouched.
- The lock-screen wrong-app bug — closed as out of scope, four theories refuted.
- The back-to-live bug — **still open and still failing on the owner's iPhone.
  Do not attempt it in this workstream.** A separate diagnostic workstream is
  planned for it.

## Tests

Add or update tests in `tests/metadata-diag.test.mjs`, following the file's
existing idiom.

The suite asserts on **source text**. `app.js` is heavily commented and comments
name identifiers an assertion is trying to prove the code does *not* use; the
file has a string-aware `stripComments()` — **reuse it** and assert on
comment-stripped source. Slice the **raw** file to find a region, then slice the
**stripped** source inside it; comment markers do not survive stripping.

**Hard-won lesson from WS5, apply it here:** WS5 shipped a test whose regex
required a literal `.` before `player-title`, but the source contains
`class: 'player-title'` — no dot. The assertion could never match, so it passed
*vacuously*, and a mutation slipped through undetected. **Do not write an
assertion whose pattern cannot match the actual source.** When you write one,
prove it by deliberately breaking the thing it guards and confirming the test
goes red.

What the tests must establish:

1. `.player-title` and `.player-sub` still exist with their original class
   names, as **two separate elements**, and are still appended inside `$player`.
2. `.now-playing-line` keeps its class name, its `aria-live: 'polite'`, and is
   still inside `$player`.
3. The close button and the expand chevron are in the **same row** as the header
   text — assert the header row contains all three (or that the buttons are
   positioned into the header), and that the buttons come after the text in DOM
   order so the text is not pushed out of view.
4. The alignment is structural: the header, the song line, and the pills resolve
   to a shared left edge **in the browser measurement**, not merely in source.
   Assert the CSS uses a shared custom property or a shared container rather
   than a duplicated literal `padding-left` in two unrelated rules.
5. The vertical alignment of close and chevron is not done with hard-coded
   offsets in the header rule.
6. Nothing in the out-of-scope list changed.

Then **prove the tests have teeth.** Mutate at least three ways, show the suite
going red each time, restore between runs, and prove with `git status` that the
tree is byte-identical to its pre-mutation state. **Paste the actual output.**

## Verify in the built-in browser

Run `npm run build` first — `index.html` loads a **hashed bundle**, so without a
build the browser serves the previous one and your changes look absent.

At a viewport of **390 × 844** (the owner's phone width), and again at 340:

1. **Report the measured `left` of `.player-title`, `.player-sub`,
   `.player-quality`, `.player-mode` and `.now-playing-line`.** The point of Item
   1 is that these agree. State the numbers and the spread in pixels.
2. **Report the new player height**, and compare against WS5's 134px.
3. **Report the close button's and chevron's `top` and `centerY`**, and confirm
   they are on the header row and in the top corners — close near the left edge,
   chevron near the right edge.
4. **Confirm the channel and programme text is fully readable** and not running
   underneath either button.
5. **No horizontal overflow** — report `scrollWidth` vs `clientWidth` at both
   widths.
6. **Still works:** expand chevron opens and closes the panel; the mini-bar
   still renders and still hides the header line; the seek bar, ±15s buttons and
   programme-skip buttons are unchanged and correctly placed; a talk channel
   with no song collapses the song line to zero height.
7. **Take a screenshot** and describe what it shows, so the owner can compare it
   against his own screenshot.

**Be honest about the limit.** You are measuring in desktop Chromium. The owner
judged the previous attempt on an iPhone and found it unclear, so **do not claim
the layout is right on the phone.** Report your measurements, note explicitly
that the phone has not been verified, and let the owner decide.

## Hard boundaries

- **Presentation only.** No behaviour change.
- **Do not break any of the eight constraints above.** They are silent-failure
  risks, not style preferences.
- Never claim a deploy succeeded without all four checks: live `index.html`
  references the new hashed bundle and stylesheet; live `sw.js` has a new
  `CACHE_NAME` and lists the new assets; the **new local** bundle contains the
  change (grep it); the **served** bundle contains the change (curl it and grep).
- If anything in this brief turns out to be false, stop and say so. A brief that
  disagrees with the code is worth more than a change that matches it.

## Final report format

Plain English, for a product owner who will not read raw tool output:

1. What you changed, one short paragraph per item, and which structural approach
   you chose for the alignment.
2. **The measured left edges** of the header text, the pills and the song line,
   in pixels, at 390px.
3. **The new player height**, compared against 134px.
4. The close/chevron measurements and a description of where they now sit.
5. The final test count, and the baseline your first run reported.
6. The mutation results — actual output, not a summary.
7. The browser verification results, including the overflow checks and a
   description of your screenshot.
8. Anything you had to change beyond the brief, and why.
9. The commit hash, and confirmation that it was **pushed** — state this
   explicitly, because the owner needs to know the new build is live.
10. The deploy verification: new bundle and stylesheet names, old and new
    `CACHE_NAME`, and confirmation the served assets contain the change.
11. What you did **not** verify — specifically that no iPhone or real device was
    used.
12. Any defect you noticed but deliberately did not fix, as a hypothesis with the
    evidence supporting it.

Do not describe this as verified on the owner's phone. The previous attempt
passed every desktop check and was still judged unclear on the device.
