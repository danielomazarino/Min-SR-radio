---
name: Min Radio — WS5 Player Layout Redesign & Attribution Removal
description: Workstream 5 for Min Radio. Redesign the player to use vertical space efficiently: move channel and programme above the player, the song line below it, put the expand chevron on the right level with the close button, reduce overall height, and remove the "Data från Sveriges Radio" footer now that the information lives in Settings.
argument-hint: "Runs Workstream 5 only — player layout redesign and attribution removal. No behaviour or playback changes."
agent: agent
---

You are the Min Radio coding assistant. This is **Workstream 5 only**.

This is a **presentation-only** workstream. The owner's specific complaint is
that the three stacked text lines (channel, programme, song) are **cut off when
the player overlaps the page**, and the player is **too tall**. The fix is to
stop stacking everything inside the player and to use the space around it.

**Change no behaviour.** No playback, no seeking, no gesture semantics, no
diagnostics changes. If you find yourself editing a function that computes
state, you have gone too far.

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

Repo: `/home/lm/Dev/SR pwa app`. **Run `npm test` first and report the count
before changing anything** — Workstream 4 is expected to have just landed, so
the baseline may be higher than the 147 you may remember. Use whatever your own
first run reports as the baseline and state it in your report.

`npm run build` writes `dist/` and then **copies the built artifacts back into
the repository root**; hashed bundles are tracked in git. Sequence: edit →
`npm test` → `npm run build` → `git add` root artifacts → `git commit` →
`git push`. **A commit without a fresh `npm run build` deploys nothing.**
There is no CI and never was.

### Current structure (verified — these line numbers are current)

- `renderPlayer()` assembles, in order: `closeBtn`, then
  `$player.insertBefore(expandBtn, closeBtn.nextSibling)` (so expand sits
  immediately after close, both in the header), then
  `$player.appendChild(el('div', { class: 'player-row' }, thumb, meta, controls))`
  at `app.js:2448`, then `if (seekRow) $player.appendChild(seekRow)` at
  `app.js:2449`.
- `meta` is built at `app.js:1912` and currently contains **three stacked
  lines**: `.player-title`, `.player-sub`, and `.now-playing-line` (live
  channels only), followed by the `quality` and `mode` pills.
- `closeBtn` is created at `app.js:2371` with
  `aria-label: 'Stäng spelaren'`; `expandBtn` at `app.js:1937` with
  `aria-label: 'Visa programinformation'`.
- The footer is appended to `$main` at `app.js:2989`:
  ```js
  $main.appendChild(el('p', { class: 'attribution' },
    'Data från ',
    el('a', { href: 'https://sverigesradio.se', target: '_blank', rel: 'noopener', text: 'Sveriges Radio' })));
  ```
- The About/Settings overlay at `app.js:3056` **already contains** the same
  attribution plus the disclaimer "Appen är oberoende av och inte utgiven av
  Sveriges Radio." — the information the footer duplicates is already
  available in Settings, so removing the footer loses nothing.
- Relevant CSS: `.player-row` (styles.css:700), `.player-thumb` (710),
  `.player-meta` (724), `.player-title` (726), `.player-sub` (734),
  `.now-playing-line` (1036, hidden when `:empty`, 1045),
  `.player-controls` (782), `.player-btn-close` (807),
  `.player-expand-btn` (1061, rotates 180° when `.open`), `.attribution` (1393).

---

## Item 1 — Move channel + programme ABOVE the player

The owner wants the channel name and programme name **above** the player
surface, so they are never covered by it and the player itself gets shorter.

- Render a compact line containing `.player-title` (channel) and
  `.player-sub` (programme) **above** the player, inside a container that
  belongs to the player but is visually a header line — not inside the
  `.player-row` that holds thumbnail/meta/controls.
- Because the player is `position: fixed` (or equivalent) and anchored to the
  bottom, "above the player" must be achieved **within the player's own
  stacking context** — do not move the player out of its fixed container and do
  not change how it is anchored. Use the existing child order in
  `renderPlayer()`: insert the new header element before the rest.
- The header must be **only visible when the player is open** and must hide
  completely when the player is minimised (the mini-bar layout has its own
  compact title already, at `app.js:1834`).
- **Keep the existing CSS class names** (`.player-title`, `.player-sub`) so
  `paintProgramTitle()` and the diagnostics keep working. That function does
  `$player.querySelector('.player-sub')` and writes to it — if you rename or
  relocate it out of `$player`'s subtree, programme titles stop painting and
  the WS0 snapshot loses the field. This is the single easiest way to break
  this workstream.
- Style it to read as a quiet header: smaller than the current in-player text,
  and it must not visually compete with the controls.

## Item 2 — Move the song line BELOW the player, above the slider

- `.now-playing-line` currently sits inside `meta`, between `.player-sub` and
  the quality/mode pills. Move it **out of the text stack** and place it in its
  own row **below the player content and above the seek row**.
- The owner explicitly asked for the song to sit **under the player and above
  the slider**. Preserve that order.
- It must keep the `aria-live: 'polite'` attribute and the `:empty` /
  `.has-song` behaviour (`styles.css:1045`) so a talk channel with no song still
  collapses the row instead of leaving a gap.
- `paintNowPlaying()` does `$player.querySelector('.now-playing-line')` — again,
  **keep the class name and keep it inside `$player`**, or now-playing text stops
  painting.
- Live channels only, exactly as today. Do not add it to episodes.

## Item 3 — Move the expand chevron to the right, level with the close button

Today `expandBtn` is inserted immediately after `closeBtn` in the header, so
the two buttons sit together on the left. The owner wants the chevron **on the
right-hand side**, on the **same vertical pixel row** as the close button — the
same treatment the Nyheter fold chevron already gets.

- Keep `closeBtn` on the left and place `expandBtn` on the right of the same
  row. The simplest structural approach is to wrap the two buttons in a
  flex row that spans the full width with `justify-content: space-between`
  (or equivalent), preserving the existing DOM order of the rest of the player.
- **The two must be exactly vertically aligned.** Use flex alignment on the
  shared row rather than absolute positioning or hard-coded offsets — hard-coded
  pixel offsets will drift the moment the artwork or text metrics change.
- The chevron must keep rotating 180° when the panel is open
  (`styles.css:1061-1062`, `.player-expand-btn.open`). Both `expandBtn`
  (created at `app.js:1937`) and the mini-bar's own expand button
  (`app.js:1823`) use the same class, so check you have not changed the
  behaviour of both.
- Keep `aria-expanded` handling intact. `setExpandOpen()`
  (`app.js:781`) is the single writer of that attribute and of the `open`
  class, and it queries `.player-expand-btn` inside `$player`. Moving the button
  within `$player` is fine; moving it **out** of `$player` would break the
  expand state for both the chevron and the swipe gesture.

## Item 4 — Reduce the player's overall height

The player's vertical footprint should shrink. Achieve that through the
structural changes in Items 1–3 — fewer stacked lines inside the player, no
in-player programme/channel block — plus tightening the relevant padding and
gaps in `styles.css`.

- Do **not** simply reduce font sizes to claw back space; legibility on a phone
  matters more than a few pixels.
- Check the existing narrow-viewport media query at `styles.css:1402`
  (`@media (max-width: 340px)`) and keep the layout intact there. The owner
  tests on a phone roughly 390 px wide, and there is history of cramped-layout
  regressions on small viewports.
- **No horizontal overflow at 390 px.** Verify this explicitly in the browser.
  A layout that scrolls sideways is worse than the problem being fixed.

## Item 5 — Remove the "Data från Sveriges Radio" footer

- Delete the `.attribution` paragraph appended to `$main` at `app.js:2989`.
- The About/Settings overlay already carries the same attribution **and** the
  independent-app disclaimer, so no information is lost.
- Remove the now-unused `.attribution` rules from `styles.css` (around
  `styles.css:1393-1399`) rather than leaving dead CSS behind.
- **Check for other references first.** `grep` for `attribution` across `app.js`,
  `styles.css`, `index.html` and `tests/` before deleting. If any test asserts on
  the footer, **update that test** and say so in your report — do not delete the
  assertion to make it pass.
- Do **not** touch the About overlay's own attribution text at `app.js:3056`.
  That one stays.

## Item 6 — Make sure the view is clean when the player is closed

The owner asked that the page look clean when the player is not expanded. After
removing the footer, confirm there is no leftover empty space, stub, or
stranded margin where the attribution used to be, and that the Nyheter section
still sits correctly at the bottom of the page.

---

## Explicitly OUT of scope

- **No playback, seeking, or gesture changes.** Do not touch `seekBy`,
  `seekToLive`, `seekToProgramTime`, `programBoundary`, `updateSeekableState`,
  `enablePlayerGestures`, `enableSwipeToClose`, `minimizePlayer`,
  `restorePlayer`, or `setExpandOpen`.
- **Do not change the WS4 behaviour** (go-to-live fallback on the
  next-programme button, the ±15 s clamp, the removed 12% hit zone, the
  guaranteed transform reset). WS5 is a separate, later change.
- **Do not change** the expand panel's content or `renderSongView`.
- **Do not rename** `.player-title`, `.player-sub`, `.now-playing-line`,
  `.player-expand-btn`, or `.player-btn-close`. Several paint functions and
  diagnostics depend on those exact names.
- **Do not touch** `manifest.webmanifest`, MediaSession code, or the WS0
  diagnostics gate.
- `scheduleCache` is still never cleared and `armPlaybackWatchdog` still
  advances candidates with no exhausted guard. Both remain out of scope.
- The lock-screen wrong-app bug is **closed as out of scope** — four theories
  were tested and refuted, including a reinstalled absolute `manifest` id. It
  is an iOS device-level issue. Do not revisit it.

## Tests

Add or update tests in the existing files, following their established idiom.
`app.js` is heavily commented and comments name identifiers an assertion is
trying to prove the code does *not* use; the suite already has a string-aware
`stripComments()`. **Reuse it** and assert on comment-stripped source. Slice the
**raw** file to find a region, then slice the **stripped** source inside it —
comment markers do not survive stripping.

What the tests must establish:

1. `.player-title` and `.player-sub` are still created **inside `$player`** and
   still carry their original class names.
2. `.now-playing-line` is still created inside `$player`, keeps
   `aria-live: 'polite'`, and is **not** nested inside `.player-meta` any more.
3. `expandBtn` and `closeBtn` are both children of a shared flex row, and the
   CSS for that row aligns them (`align-items` and `justify-content`), with no
   hard-coded pixel offsets for their vertical alignment.
4. The `.attribution` paragraph is gone from `app.js`, and the `.attribution`
   rules are gone from `styles.css`.
5. The About overlay's attribution at `app.js:3056` is **still present**.
6. None of the out-of-scope function names in this brief appear as changed.

Then **prove the tests have teeth.** Mutate at least three ways, show the suite
going red each time, restore between runs, and prove with `git status` that the
tree is byte-identical to its pre-mutation state. **Paste the actual output.**

## Verify in the built-in browser

Run `npm run build` first — `index.html` loads a **hashed bundle**, so without a
build the browser serves the previous one and your changes look absent.

Check, at a viewport around **390 × 844**, and report the actual measurements:

1. **Total player height before vs after.** Report the real pixel height in both
   states. A reduction is the point of this workstream — if it did not shrink,
   say so plainly.
2. **Channel and programme render above the player** and are fully visible when
   the player is open.
3. **The song line renders below the player and above the slider** when a song
   is playing, and collapses entirely when there is none (talk radio).
4. **The chevron is on the right, vertically level with the close button.** Give
   the measured `getBoundingClientRect().top` of both buttons.
5. **No horizontal overflow** — compare `document.documentElement.scrollWidth`
   against `clientWidth` and report both.
6. **The footer is gone** and the About overlay still shows its attribution.
7. **The expand panel, mini-bar, DVR row and the ±15 s / programme-skip buttons
   all still work and look correct.** This is a layout change on a surface that
   carries real controls — check them, do not assume.
8. Re-check at **340 px** width (the existing media query) for cramping.

**Be honest about the limit.** You are verifying layout, which Chromium
represents faithfully — but you are **not** on an iPhone, and touch targets,
safe-area insets and real device metrics can differ. Say that plainly. Do not
describe a desktop layout pass as proof the phone looks right; the owner will
confirm.

## Hard boundaries

- **Presentation only.** No behaviour change.
- **Do not rename** the five CSS classes listed in Out of scope — paint
  functions and diagnostics depend on them.
- Never claim a deploy succeeded without all four checks: live `index.html`
  references the new hashed bundle; live `sw.js` has a new `CACHE_NAME` and
  lists the new bundle; the **new local bundle** contains the change (grep it);
  the **served** bundle contains the change (curl it and grep).
- If anything in this brief turns out to be false — for example if a test
  depends on the footer in a way that makes removing it wrong — stop and say so.
  A brief that disagrees with the code is worth more than a change that matches
  it.

## Final report format

Plain English, for a product owner who will not read raw tool output:

1. What you changed, one short paragraph per item.
2. **The measured player height before and after**, in pixels. This is the main
   thing the owner wants to know.
3. The final test count, and the baseline your first run reported.
4. The mutation-test results — actual output, not a summary.
5. The browser verification: the actual measurements, including the chevron and
   close-button alignment numbers and the overflow check.
6. Anything you had to change beyond the brief, and why.
7. The commit hash and the files it changed.
8. The deploy verification: new bundle name, old and new `CACHE_NAME`, and
   confirmation the served artifacts contain the change.
9. What you did **not** verify — specifically, that no iPhone or real device was
   used, so the final look on the owner's phone is unconfirmed.
10. Any defect you noticed but deliberately did not fix, as a hypothesis with the
    evidence supporting it.

Do not claim the layout is verified on the owner's phone. Describe what you
measured on the desktop browser and let the owner confirm the rest.
