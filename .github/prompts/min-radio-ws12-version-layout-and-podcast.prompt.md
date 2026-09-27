---
name: WS12 — move the build number back under NYHETER, repair the squeezed text column, and show the podcast cover
description: Four owner-visible defects. (1) Move the build number back down under NYHETER, where WS10 had it and where the owner has now asked for it, and let the cog wheel return to the right edge — WITHOUT the stale 1.5.0. (2) Put the close ✕ and chevron ⌄ back on their own row ABOVE the transport buttons, undoing the WS11a misreading that squeezed the text column to 0px on DVR channels. (3) Show the podcast album cover in the expanded player. (4) Harmonise the mid player with the expanded player for podcasts. Then commit AND PUSH so the owner can verify on their iPhone.
applyTo: "**"
---

# WS12 — build number placement, layout repair, podcast cover

**The owner is away.** This work must be committed **and pushed** so they can
verify on their own iPhone. See §8. Pushing is part of the job, not a follow-up.

Work in this order and prove each part before starting the next. Part D (push)
is mandatory and is not optional.

---

## 0.0 iPhone first — UX/UI claims require the owner, not inference

The owner's standing instruction:

> "you have to request my support for all ux and ui related questions. iphone
> comes first"

**The iPhone is the reference device. Desktop Chromium is not.** This has been
established three times in this project, most recently when WS11a's "no overflow
at 390px and 340px" was measured on a **non-DVR** channel while the owner's screen
was the **7-button DVR** case where the text column measured **0px**.

Concretely, for this workstream:

- **Do not** state how something *looks* on the owner's phone as fact. You have no
  device. Say what you measured, on what, and that it is not the device.
- **Do not** invent a visual justification for a change. A change with no
  observed reason is a change you should not make, and if the owner asks why,
  the honest answer is "because I assumed" — which is what started this.
- **Do not** carry an unverified visual claim forward into code, comments, test
  names or commit messages. Once written down it reads like an observation, and
  the next person — including you, later — cannot tell it apart from a real one.
  This has already produced four copies of one false claim. See §1 A1b.
- **When a UX/UI question arises that you cannot answer by measurement** — does
  it overlap, is it legible, does it need this, does the owner prefer that —
  **stop and ask.** Do not pick the answer and continue. A question costs the
  owner one message; a wrong assumption costs a whole workstream.
- Ambiguity is a reason to ask, never a licence to choose. "The owner probably
  meant" is how the close button ended up on the wrong row for an entire
  workstream.

You **may** measure layout, widths, overflow, alignment and colour in Chromium,
and that evidence is worth reporting — clearly labelled as Chromium, at a stated
viewport, in a stated player state, and **not** as a claim about the phone.

---

## 0. The owner's words, verbatim — do not paraphrase them

Three separate complaints. Quote these; do not summarise them into something
looser, because that has already caused a wasted workstream in this project.

> "you have now to move back the build number i see that you moved up on screen by
> myself and put it back under NYHETER (but without the stale 1.5.0), the cog wheel
> should go back to where we had it"

> "the close button and chevron were not to be placed on the player icons line.
> they should be **above**."

> "i want the album cover to show in the expanded view as it does for radio
> channels. the programme's image i have no issue with that is correct"

**Part A moves the build number back down. It is a placement change, not a
restoration of something missing, and it is NOT a version change.** See §1.

---

## 1. Part A — move the build number back down, and leave the stale version off

**A draft of this prompt earlier proposed restoring the version number. That draft
is withdrawn — A3 replaces it. Follow A3.** Read it, do not skim it.

The owner is tired of decisions being made about their screen without them, and
this is a direct instruction about placement. Quote it; do not re-derive it:

> "you have now to move back the build number i see that you moved up on screen by
> yourself and put it back under NYHETER (but without the stale 1.5.0), the cog wheel
> should go back to where we had it"

**Two things move, and one thing must NOT come back.**

### A1 — the build number goes back under NYHETER

It is in `.topbar` now because WS11 Part B moved it there (commit `07b41d5`), and
**that move was the reviewer's, not the owner's.** The owner has now seen it and
rejected it. Put it back.

The original placement is unambiguous and recoverable — WS10 had it exactly where
the owner is asking for it. From `git show 16fa6ba:app.js`, note that the OLD line
also carried a version; per A3 you keep its position and drop its version:

```js
$main.appendChild(el('p', {
  class: 'build-line',
  text: `Version ${APP_VERSION} · bygg ${APP_BUILD}`,   // <- keep the spot, drop "Version ${APP_VERSION} · "
}));
```

So: `$main.appendChild(...)`, after the news section
(`$main.appendChild(newsSection);` — find it by text) and immediately before
`updatePlayingMarks();`. `#main`'s children are, in order: channels, podcasts,
news — so appending to `#main` puts it directly under NYHETER. **That is the
owner's requested position. Do not invent another one.**

`document.querySelector('.topbar')` and `bar.appendChild(buildLine)` (the two
lines just after the `buildLine` construction) must go, and the `$main.appendChild`
must come back.

### A1b — DELETE the false reason this move was made. It is not true.

The rationale for putting the line in the topbar is recorded in **four** places,
and every one of them is wrong. The owner has checked it directly and reported:

> "i noted that you said the version and build under nyheter made the expanded
> player hide it. on iphone i have never seen that happen as there is space left"

So: **the player never covered the build line.** There is room below NYHETER. The
claim that it "could not be scrolled away or occluded" was never observed by
anyone — it was asserted by the reviewer, and the owner is contradicting it from
the device. Treat the owner as the authority on their own screen.

This is exactly the error that must not be repeated: **an invented justification,
repeated in code, in comments and in tests, until it reads like an observation.**

The four places that must be corrected. **Find them by their TEXT, not by line
number** — the test file is being edited while you work, so any line number quoted
here will be stale by the time you read it. All four are in
`tests/metadata-diag.test.mjs` unless noted:

1. **The comment** reading *"WS10 put it at the bottom of the home screen where the
   player covered it and scrolling hid it -- the owner's complaint."*
   **Delete the rationale.** It was never the owner's complaint. Replace it with
   the real reason: the build number was moved up on the reviewer's own
   initiative, and the owner has now asked for it back where WS10 had it.
2. **The test NAME** `'WS11 Part B: no frozen version, and the line cannot be
   occluded'`. "cannot be occluded" is a false claim baked into a test title.
   Rename it. The `APP_VERSION` half of that test is still valid and stays.
3. **The two placement assertions** and the comment *"Placement: the top bar, not
   the scrolling content."* — currently `assert.ok(/document\.querySelector\('\.topbar'\)/…)`
   twice, each with a `!/(\$main\.appendChild)/` counterpart asserting it is
   **NOT** in the content flow. These are the assertions A5 tells you to change.
   Change them **and** strip the occlusion reasoning from the surrounding
   comments, including the phrases "always-visible top bar" and "must NOT be
   appended to the scrolling content flow". Under the content flow is exactly
   where the owner wants it, so leaving those phrases behind would leave a
   comment arguing against the requirement.
4. **Commit `07b41d5`'s message** reads *"so it cannot be scrolled away or
   occluded. The old placement was visible only because the player was closed."*
   **A committed message cannot be rewritten** — do not attempt history surgery.
   Say plainly in your report that the original rationale was wrong, so the
   correction is on the record where the next person will read it.

Also correct the two comments that justify the topbar CSS and the topbar append:
`styles.css` (the `/* WS11 Part B: the build line lives in the .topbar row now… */`
block) and `app.js` (the `// ---- WS11 Part B: the build line has MOVED out of the
content flow ----` block). Both become lies the moment A1 lands.

**Nothing here may be implemented as "keep the topbar, but stop the player from
covering it."** The player is not the problem. The placement is.

### A2 — the cog wheel goes back to the right

`.topbar` is `justify-content: space-between` with, currently, **three** children:
`brand`, `edit-btn`, `build-line`. With three children, `space-between` puts the
**middle** one in the middle. Measured at 390px:

```
brand      left=20.00  w=101.08
edit-btn   left=188.52  w=44      <- CENTRED, not right-aligned
build-line left=307.95  w=62.19
```

So the cog drifted to the centre **because** the build line was added beside it.
Removing the build line from the topbar restores two children and `space-between`
puts the cog back at the right edge on its own. **Verify this by measurement, not
by assumption** — the restoration is a consequence, and it is the check that proves
A1 actually worked.

### A3 — the stale `1.5.0` does NOT come back

The owner's parenthetical is explicit: **"but without the stale 1.5.0"**.

This reverses the earlier Part A in this prompt, which proposed restoring the
version number. **Do not restore it.** The owner has now seen the restored design
proposal and rejected the version. What was wrong with the old line is exactly
what WS11 said: the version never moved, so it was a lie.

- The line reads **`bygg ${APP_BUILD}` only** — no `APP_VERSION`, no "Version"
  prefix, no second number of any kind.
- **Do not** add a build-time version injection to `scripts/build-pages.mjs`. The
  earlier proposal in this prompt for `__APP_VERSION__` is **withdrawn**. Its
  reasoning was sound; the owner has declined it. Drop it entirely.
- Do not bump `package.json`. The owner did not ask.
- `README.md` must keep agreeing with `package.json` — a test enforces that, and it
  is unaffected by this.

### A4 — restore the `.build-line` CSS with the placement

`.build-line` was rewritten in `07b41d5` for a topbar that truncates
(`white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto;
min-width: 0; align-self: center;`, plus `font-size: 10px`, `opacity: 0.6`).
The WS10 form, from `git show 16fa6ba:styles.css`, was a plain block that sat
under the content:

```css
.build-line {
  margin: 18px 0 4px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}
```

**Restore that shape**, or something equivalent for a block in the content flow
(its own line, breathing room above it, dim, not competing with the sections). The
`flex`/`min-width`/`align-self`/`ellipsis` properties are topbar-only and become
dead weight in a block context.

Also update the CSS comment at styles.css:715-718, which currently explains *why
the line is in the topbar*. It would become a lie describing code that no longer
exists — and the same class of stale comment has already caused a wasted
workstream in this project. Do the same for the `// ---- WS11 Part B: the build
line has MOVED out of the content flow ----` comment block in `app.js`.

### A5 — tests that must be updated, and how

> **NOTE: the test file is being edited as you work, so line numbers drift. Find
> every one of these by its TEXT.** Quote the string, not the line.

Three assertions currently **require the topbar placement** and will go red:

- the `assert.ok(/document\.querySelector\('\.topbar'\)/.test(BUILD_LINE), …)` in
  `test('WS10 Part B: the build id is shown on the main screen…')`
- the same check against `BUILD_LINE_WS11` in the WS11 Part B test
- the region-anchor comment that reads *"WS11 Part B moved the line out of the
  content flow and into the .topbar row, so the region starts at its
  CONSTRUCTION…"* — it explains the anchor *because* of the topbar move, and it
  must be re-checked once the code changes, not left to describe a move that has
  been reversed

**These are legitimate to change: the owner has reversed the decision they encode.**
That is different from weakening a guard to get green. What they must still assert
after the change:

- the line is a **plain paragraph**, not interactive, with no link, no `onclick`;
- it shows `APP_BUILD`;
- it is **not** in the topbar (assert the negative, so it cannot silently drift back);
- the WS5 attribution / disclaimer / `class: 'attribution'` are still absent;
- **`APP_VERSION` stays banned.** The four `APP_VERSION` bans (find them by
  searching `APP_VERSION` in the test file) are **more** justified now, not less.
  The owner has explicitly rejected the version number. Do not delete, soften or
  re-interpret any of them. They stay exactly as they are.

The two existing `APP_VERSION` bans are `!/APP_VERSION/.test(BUILD_LINE)` and
`!/APP_VERSION/.test(APP_CODE)` / `APP_JS`. They pass today and must still pass.
Confirm that with the suite green and by checking they were not edited.

---

## 2. Part B — put the buttons back ABOVE the transport row

### The owner asked for this twice and got the opposite twice

WS11a moved the close ✕ and chevron ⌄ **onto the transport row**. The owner then
wrote, in a bug report:

> "the close button and chevron were not to be placed on the player icons line.
> they should be **above**."

The instruction that authorised WS11a read "on the same row as the transport
buttons". **That was a transcription error in the brief, by the reviewer — not a
change of mind by the owner.** The minimised bar's arrangement is a different
layout and is not the model. Do not derive the intent from it.

### The measured damage, and where it actually comes from

`.player-quality` is **not** in the controls row. It is created inside `meta`
(app.js:2183), and `meta` is a sibling of `thumb` and `controls` inside
`.player-row` (app.js:2932). The pill wraps because **`.player-meta` is squeezed**,
not because the controls row overflows.

The pill has no `white-space: nowrap` (the `.player-quality` rule, styles.css:818-832),
unlike `.player-title` (styles.css:802-808) and `.player-sub` (styles.css:810-816),
which both set it. So when its container is narrow, the text breaks at spaces —
which is exactly the owner's screenshot.

**WS11a's own evidence checked the wrong case and this is why it shipped broken.**
It measured a non-DVR channel: 5 buttons. The owner's screenshot is the DVR case:
**7 buttons** (previous programme, −15s, play, +15s, next programme, chevron, close),
built at app.js:2685-2702.

Measured at 390px with the real app CSS:

| buttons | `.player-controls` | `.player-meta` | row scrollW | row overflows |
|---|---|---|---|---|
| 5 (non-DVR) | 224px | 66.14px | 358 | no |
| **7 (DVR)** | **320px** | **0px** | **388** | **yes** |

Arithmetic (`btn` 44, `gap` 4, `art` 44, `pgap` 12, `padding` 16):

```
3 buttons -> controls 140px     vw390 content 358 -> meta 150 / 54 / -42
5 buttons -> controls 236px     vw340 content 308 -> meta 100 /  4 / -92
7 buttons -> controls 332px     vw368 content 336 -> meta 128 / 32 / -64
```

**The text column is 0px wide in the case the owner photographed.**

**A trap in the existing evidence:** `document.documentElement.scrollWidth` does
**not** exceed the viewport, because flex items shrink rather than overflow. So
"no horizontal overflow at 390px and 340px" is TRUE and is also a useless check
here. The checks that detect this defect are
`row.scrollWidth > row.clientWidth` and `meta.getBoundingClientRect().width`.

### Required

- Return `closeBtn` and `expandBtn` to `.player-header` (app.js:2918), the row
  above the transport, at its right-hand end.
- Restore `.player-controls` to the transport buttons only: previous programme,
  −15s, play, +15s, next programme (app.js:2685-2689). The two relocated buttons
  leave it.
- **The spacer trap — exactly one of the two may occupy the space, never both.**
  The header's text alignment is structural, not a `padding-left` literal: the
  close button was sized `var(--player-art)` so that the shared `--player-gap`
  landed the title and programme on the artwork's right edge — the same left edge
  as the quality pill and the song line. WS11a replaced it with
  `.player-header-spacer` (styles.css:766-769, `width: var(--player-art)`).
  **When the real button returns, the spacer rule must go with it.** Leaving both
  live adds 44px of dead space and shifts the text right of the artwork edge.
- If you keep the spacer, the button must be sized from `--player-art` too and the
  whole thing must still be justified by measurement, not by assumption. **The
  simplest correct change is to remove the spacer and restore the original
  button rule.** If you take the other path, you owe measurements proving the
  left edges are unchanged.
- The dead header-scoped CSS that WS11a deleted for the relocated buttons
  (`.player-header .player-btn-close`, `.player-header .player-expand-btn`) must
  come back with the buttons, in the same shape, sized from `--player-art`.
- **Defence in depth, and it is not the fix:** add `white-space: nowrap` to
  `.player-quality` and `.player-mode` so a narrow column degrades to an ellipsis
  or a clip rather than a two-line pill. Do this **in addition to** Part B, and
  say in your report that it is a guard, not the cure — the cure is restoring the
  width.

### Verify against the 7-button case, not the 5-button case

Chromium cannot load SR's DVR stream (CORS-blocked), so the programme-skip buttons
never render naturally. You must **construct the 7-button state deliberately** and
measure it. Injecting two extra 44×44 buttons into the real `.player-controls` of
the real player, with the real app CSS, is acceptable and is how the numbers above
were obtained. Say in your report that the state was constructed, not observed.

---

## 3. Part C — the podcast album cover in the expanded player

### The owner's requirement, precisely

> "i want the album cover to show in the expanded view as it does for radio
> channels. the programme's image i have no issue with that is correct"

So: cover in the **expanded** player. Programme image in the **thumbnail** —
leave it alone.

### What a previous brief concluded, and why it is wrong

A previous brief said: "the cover is already being fetched and then deliberately
discarded at app.js:2287, so this is a small change."

**That is wrong, and acting on it would produce no visible change.** Measured:

- `refreshNowPlayingArtwork()` (app.js:1054) is called from exactly one place,
  app.js:1007, inside `fetchNowPlaying` — which is reached only when
  `cur.kind === 'live'` (app.js:1023-1026). **For an episode the artwork lookup
  never runs, so `nowPlaying.artwork` is always `null`.**
- Therefore removing the `isEpisode ? null` at app.js:2287 would expose a *second
  null*. The visible outcome would be identical.
- Two sites discard, not one: **app.js:2287** (expanded panel) and
  **app.js:1658** (MediaSession, same `kind === 'live' ? ... : null` shape).

### Do NOT use the iTunes lookup for episodes — measured, and it is a trap

`refreshNowPlayingArtwork()` searches iTunes for `"<artist> <title>"`. For an
episode, `title` is the *episode* name. Measured against real SR names:

| query | result |
|---|---|
| `P3 Soul` | PARTYNEXTDOOR — "Not Nice" **(wrong)** |
| `P3 Soul Måndagsbörsen` | MISS |
| `Söndagsmagasinet` | MISS |
| `Söndagsmagasinet i P3` | MISS |
| `Breakfastvärden` | MISS |
| `Humlan Helmer` | MISS |
| `Vinter` | "Årstider" **(wrong)** |
| `Tjejer` | IFTIIN **(wrong)** |
| `Studio ESS` | Pain — Single **(wrong)** |

Every hit is `wrapperType: track` — a different song entirely. **Running this for
podcasts would show a stranger's album cover under a Swedish radio programme.
That is worse than the placeholder.** Leave the live path alone; do not extend it
to episodes.

### The correct cover already exists — this is a consistency fix

The programme image is the album cover for a podcast, and the app already has it:
`pod.image`, from `p.programimage` (app.js:219), set as `artwork` at app.js:3175
and `image` at 3178. The expanded panel's **no-song** branch already uses exactly
this, via `live.artwork` (app.js:2277).

**So the fix is consistency: make the song branch do what the no-song branch
already does.** No new fetches, no new sources, no invented artwork.

Required:

- For an episode with a current track, use `live.artwork` as the cover in the
  expanded panel, exactly as the no-song branch does.
- If `live.artwork` is absent, keep the existing ♪ placeholder. **Never show a
  broken image and never substitute an unrelated cover.**
- The `artworkSeq` / `nowPlayingSeq` race guards stay. They are the reason a late
  response cannot land on the wrong track; do not add a second mechanism, and do
  not remove the guards because "episodes do not poll".
- Do not change the thumbnail. The owner confirmed it is correct.

### Also: the mid player shows no song for a podcast at all

The owner reports the song and artist appear in the expanded player but not in
the mid player. Root cause, and it is not a painting bug:

- **app.js:2927-2929: `const songLine = live ? el('div', { class: 'now-playing-line', … }) : null;`**
  and `live` is `cur.kind === 'live'` (app.js:2089). For an episode the element is
  **never created**, so `paintNowPlaying()`'s `if (line)` is false and there is
  nothing to paint into.
- The minimised bar has the same `live ?` gate at app.js:2128.
- The comment at app.js:2924 says "Live channels only, exactly as before" — so
  this is deliberate, not an accident. **Change it deliberately**, and update the
  comment so it no longer claims the opposite of the code.
- **Check whether live radio is also affected before assuming it is
  episode-only.** The owner's evidence is a podcast, but the underlying cause may
  be shared. Report which it is.
- Note the existing scoped reset `.player-mini .now-playing-line { margin-left: 0; }`
  (styles.css:1136) — do not break it.
- `paintNowPlaying()` and `paintProgramTitle()` look these up by class name inside
  `$player` (`.now-playing-line`, `.player-sub`). The comment at app.js:2212-2220
  warns that renaming or reparenting either breaks titles, now-playing text and the
  WS0 diagnostics snapshot. **Keep both class names and keep both inside `$player`.**

---

## 4. Part D — commit AND push (mandatory)

The owner is away and will check the result on their **iPhone**. A commit alone
deploys nothing.

This repo has **no CI and no GitHub Actions** — `.github/` contains only `agents/`
and `prompts/`. **A push is the deploy.** Pages serves the repository root of
`main`. `scripts/build-pages.mjs` writes `dist/` *and* copies `index.html`, `sw.js`
and the hashed bundles back into the repository root, and the hashed bundles are
tracked in git. **A commit without a fresh `npm run build` deploys nothing.**

Order matters, and getting it wrong is the cause of the off-by-one build id:

1. `npm test` green.
2. `node --check` all four sources.
3. `git add` the **source** changes only (app.js, styles.css, tests, scripts) and
   commit. This is the commit the build id must name.
4. `npm run build`. The build id is derived from the last commit that touched
   `app.js` (scripts/build-pages.mjs `resolveBuildId`) — so it now names the
   commit from step 3, not the artifact commit.
5. `git add -A` the regenerated artifacts (hashed `app.*.js`, `styles.*.css`,
   `index.html`, `sw.js`, `dist/`) and commit.
6. `git push origin main`.
7. **Verify the deploy. All four checks, then report the raw output.**

### The four deploy checks — all four, every time

- **(1)** live `index.html` references the new hashed bundle.
- **(2)** live `sw.js` has a new `CACHE_NAME`.
- **(3)** the new **local** bundle contains the change.
- **(4)** the **served** bundle contains the change.

`index.html` loads the **hashed** bundle, not `app.js`; `app.js` is only the build
input. Checking `app.js` proves nothing about what is served.

**Re-read the served `index.html` AFTER your wait loop.** GitHub Pages takes tens
of seconds. A hash captured mid-deploy has drifted before and was reported as
success. If the hash you first read is stale, wait and read again. Do not report
a deploy on a hash you captured before the wait.

Then, as the owner will have to:

> On the phone, unregister the service worker or hard-reload. A stale SW will keep
> serving the old layout and make a good deploy look broken.

State this in your report so they are not sent chasing a phantom regression.

---

## 5. Boundaries — do not touch

- **Seek behaviour.** `seekBy`, `seekToLive`, `seekToProgramTime`, `posMs`,
  `liveEdgeWallMs`, `playheadWallMs`, `pickByPosition`, `resolveMetadataForPosition`,
  the programme-skip lookup, and every DVR constant. **The forward-skip button
  works on the owner's phone.** These must be byte-identical to `git show 745493c:app.js`.
- The minimised bar's button **order and styling** is not in question. Adding a
  song line to it is (Part C), but do not reshuffle it.
- Do not restore the DVR window readout (removed in WS11) or the WS5 attribution footer.
- No new dependencies. No CI. No build-system change beyond `build-pages.mjs`.
- The four `APP_VERSION` bans are **untouchable**. The owner has explicitly
  rejected the version number, so these guards are now more justified, not less.
  Do not modify any of them.
- Do not add a version injection to `scripts/build-pages.mjs`. Do not change
  `package.json`'s version, `sw.js`'s caching strategy, or the manifest.
- The build line stays out of `.topbar`. Do not put it back.

## 6. Anti-vacuity rules — this project has been bitten by every one of these

1. **Never assert a guard "does not fire" once your change makes it unreachable.**
   WS6 shipped 162 green tests over a button that could never be reached.
2. **A negative result scoped to one direction is not a negative result.** WS8's
   agent tested only backward seeks and concluded staleness can never refuse; a
   follow-up found 24,947 forward counterexamples in 1,131,520 combinations.
3. **A pattern containing a comment can never match a `stripComments()`ed slice.**
4. **Assert the specific promise, not a proxy.** This workstream exists because a
   reviewer checked the *header* alignment and declared the layout intact while the
   seek row had a third flex child — and because a brief paraphrased the owner's
   words and the paraphrase went unchallenged for a whole workstream.
5. **Never use `git checkout --`** to restore uncommitted work. It destroyed WS5b once.
6. **Mutation harnesses must compare md5 BEFORE AND AFTER each mutation.** A harness
   that only verifies the anchor reports no-op mutations as green — that produced
   four false results in WS11.
7. **`region()` searches FORWARD.** An end marker appearing earlier returns -1, and
   a region opened on the wrong declaration silently begins *after* the element
   under test. That happened in WS11a: a test could not see the spacer it guarded.
8. **A check that cannot fail is not evidence.** `document.scrollWidth` staying
   under the viewport is true even while a flex row overflows internally.

## 7. Evidence required — paste raw output, not adjectives

- Part A: the rendered `.build-line` text, and proof it is **inside `#main` after the
  news section** and **absent from `.topbar`**; the `.topbar` child list, and the
  `.edit-btn` `getBoundingClientRect().right` at 390 / 360 / 340 / 320px — the cog
  must be right-aligned again, not centred.
- Part B, **at 390px, in BOTH the 5-button and the 7-button states**:
  - `.player-meta` width;
  - `row.scrollWidth` vs `row.clientWidth`;
  - `.player-quality` width and **height** — a two-line pill is a taller pill;
  - the left edges of `.player-title`, `.player-quality`, `.now-playing-line`
    and **the spread between them (must be 0px)**;
  - the player's total height;
  - **explicitly** `meta.getBoundingClientRect().width` and the row-overflow
    boolean, not `document.scrollWidth`.
- Part C: the expanded panel's artwork element `src` for a podcast, and for a live
  channel, and that both are non-broken; the mid player's song line text for a
  podcast and for live.
- The mutation list for the guards you add, with the red/missed verdict per
  mutation and an md5 before/after per mutation.
- The full four deploy checks, plus the served `index.html` bundle hash and
  `sw.js` `CACHE_NAME`.

## 8. Honesty requirements

**Say which parts were measured live, which were measured against a constructed
state, and which were reasoned about only. Do not describe unverified behaviour
as verified.** This has been the single most costly failure mode in this project.

- Chromium **cannot** load SR's DVR stream (CORS-blocked manifest), so the
  programme-skip buttons never render on their own. The 7-button state is
  **constructed**. Say so.
- Desktop Chromium green is **not** device correct. This has happened three times
  in this project, including the work you are replacing. Say so.
- **You have no device.** Anything about a car stereo, a lock screen or an iPhone
  you cannot test is unverified, whatever the MediaSession code says. You can
  prove what the app *hands* the system; you cannot prove what a head unit displays.

### Endpoint status, re-verified 2026-09-27

| endpoint | status |
|---|---|
| `channels` | 200 |
| `programs` | 200 |
| `programs/index?filter=program.haspod` | 200 |
| `web-api.sr.se/v1/player/ondemand?id=…&type=episode` | **200 — alive** |
| `podcasts` | **500** |
| `programs/{id}/episodes` | **500** |

So: the podcast **catalogue** works and `ondemand` works and returns real tracks
(`artist`, `title`, `relativeStartTime`, `relativeEndTime` — **and no image
field**, which is why §3 uses the programme image rather than a track image).
The `podcasts` and `episodes` endpoints are still down. Exercise the episode path
through `ondemand`, and if the live episode path cannot be reached, say so rather
than describing it as working.

## 9. Status updates

**Give a status update roughly every 5 minutes, and no more often.** Do not
report every step. Do not go silent for longer than about 5 minutes. If you are
blocked, say what you are blocked on rather than continuing to retry.

Report in the owner's language (Swedish or English as they are using), and lead
with what changed and what you measured — not with a narration of your process.
