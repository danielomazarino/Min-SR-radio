# WS41 — iTunes / external podcast integration — implementation

## WS41 — implementation complete, pre-deploy review — 2026-10-02T04:05Z

**Started / baseline:** `npm test` → **381/381 pass** (run, not copied)
**Scope now:** ADD an Apple/iTunes podcast source alongside Sveriges Radio.
Explicitly OUT of scope: `fetchPodcasts`, `fetchLatestEpisode`,
`episodeAudioFields`, `playTrack`, `toggleTrack`, `loadFavorites`,
`saveFavorites`, `src/favorites.mjs`, `tests/favorites.test.mjs`, CSS,
DVR/HLS code, and any new UI section or heading. No backend, no proxy, no
API key. **NOT COMMITTED, NOT PUSHED** — awaiting owner review of the diff.

**Decision or finding:** Two storage keys, never one array. `favoritesFromRaw`
drops non-integers (`MAX_FAVORITES` filter), so namespacing ids as strings
into the SR array would have silently deleted the user's picks on the next
load. SR ids and iTunes collectionIds are both bare integers, so
`resolvePodcastRow` takes an explicit `provider` — a shared lookup would let a
colliding id render the wrong podcast (the one-field-two-writers bug class).

**Test count:** 381 → **412** (+31). Full suite 412/412.
**Mutations: 8 applied, 8 red, `app.js` restored byte-identical by md5.**

**Working tree:** dirty — `app.js`, `tests/itunes-podcast.test.mjs` (new),
`tests/metadata-diag.test.mjs`, plus build artifacts `index.html`, `sw.js`,
`app.2b0ec35e.js` (new) / `app.7d175815.js` (deleted).

**MEASURED — code-proven (executed in tests, not read as text):**
- Search: SR results first, then iTunes. Live: query "ekot" → 11 rows =
  7 SR + 4 iTunes, external rows showing `primaryGenreName`.
- Episode list: 20/20 rows, all `disabled:false` (playable), newest first.
- Storage separation: with SR `3437` + external `1518156497` selected
  simultaneously → `favorites.v1` holds only `3437`; `podcasts.ext.v1` holds
  only the external id. Distinct DOM stream keys `pod:3437` / `xpod:1518…`.
- Live iTunes field mapping: 3/3 search rows and 60/60 episodes mapped,
  0 dropped.

**MEASURED — browser-driven (real DOM, headless Chromium, localhost):**
- Favourite → Spara → home icon appears → reload → still there. PASS.
- Tap external icon → player shows "The Dangerous Truth About People
  Without Convictions" / "Dear Young Person" / 0:03 of 21:22, i.e. real audio
  loaded and advancing. PASS.
- Tap SR icon → player shows a real Ekot granskar episode, 0:02 of 9:17. No
  regression to the SR path. PASS.

**MEASURED — live API boundary:** search and lookup both HTTP 200 with
`Access-Control-Allow-Origin: *`. 0 http→https upgrades were needed in this
sample; the upgrade is retained because `episodeUrl` has been observed as
`http://` on other podcasts and iOS Safari refuses mixed content.

**NOT PROVEN / NOT DONE:**
- **Device playback is NOT verified.** Desktop Chromium has no audio output;
  "the player advanced to 0:03" proves the media loaded, not that sound comes
  out of the speaker on an iPhone. **Needs the owner to test on the phone.**
- The same-`releaseDate` tie-break: observed ONCE (4 episodes sharing a date),
  then NOT reproduced across a 9-podcast sweep. Frequency is **unmeasured**;
  the tie-break is kept because it is cheap.
- 19 earlier `ERR_ABORTED` anchor.fm results remain **UNCERTAIN** — the same
  code the timeout emits. Not treated as broken.
- No offline/failure UI for a user who searches with no network: the SR list
  still renders and iTunes contributes nothing. Not tested.
- Not committed, not pushed. The build artifacts above are staged but the
  tip of main is unchanged.

**Two real defects found by driving the browser, not by reading source:**
1. `updateCounter` / `doneBtnState` counted only the SR arrays → selecting an
   external podcast showed "Poddar (0 valda)" and left **Spara disabled**, so
   an external-only pick could not be saved at all. FIXED + regression test.
2. `boot()` gated the welcome screen on SR favourites only → an external-only
   selection was discarded and the user was returned to the welcome screen.
   FIXED + regression test. (Audited every other `loadFavorites()` consumer;
   this was the only other gate.)

**Harness traps hit this session (6, matching the pattern in AGENTS.md §7):**
- `index.html` loads the **hashed bundle**, not `app.js`. My first browser run
  tested OLD code and showed the iTunes results "missing". The feature was
  fine; the rig was wrong. Bypassing the service worker is mandatory or a
  stale precache repeats the same false negative.
- `loadExternalPodcasts` uses `HARD_CAP` and `safeStr` as well as the key.
  Injecting only the key made it throw inside its OWN try/catch, which
  swallows it — the harness reported a plausible assertion failure instead of
  the ReferenceError. Three tests failed this way before I read the code.
- `favoritesFromRaw` takes raw JSON **text**, and `new Function` rejects
  `export`. Injecting `MAX_FAVORITES` collided with the module's own
  declaration (SyntaxError, nothing to do with the code under test).
- My first mutation used `sed` and silently matched nothing → reported as
  "missed". It was a NO-OP. Now every mutation asserts its marker exists and
  is unambiguous, and reports NO-OP as a hard failure.

**WS20 restated, not weakened.** Its literal pattern went red because an
external branch was inserted in front of the SR call, not because SR behaviour
changed. Replaced with a harness that **extracts and executes** the real
`onclick` expression for all three cases (SR podcast / external / channel), plus
a canary test that fails if the extracted code does not actually run.

**Next:** owner reviews the diff and tests on the iPhone. Deploy only after
that, and report the build id to check (`bygg 68d2638` under NYHETER).

## WS41 — documentation — 2026-10-02T04:35Z

**Baseline:** `npm test` → **412/412 pass** (run, not copied)
**Scope now:** document the implementation in `ENHANCEMENTS.md` and set the
enhancement to DONE. **No source file touched.**

**Decision:** the owner's brief at `ENHANCEMENTS.md` L3251 said "NOT started,
NOT implemented. Investigation brief only." Replacing that status line, and
appending a WS41 implementation record as a **separate dated section** rather
than editing the brief — the brief is load-bearing verbatim text and must
survive session boundaries.

**Verified:** `git diff` shows the ONLY deletions in `ENHANCEMENTS.md` are the
4 old status lines. The brief body is byte-identical. `app.js` md5 unchanged
(`502bd8de…`), so this was a documentation-only change.

**MEASURED:** `ENHANCEMENTS.md` +151/−5, now 6598 lines. Suite 412/412.

**Documented as DONE, with what is NOT proven stated in the same record:**
device playback is unverified (headless Chromium has no audio output); the
same-date tie-break frequency is unmeasured; 19 `anchor.fm` ERR_ABORTED results
remain UNCERTAIN. The record also carries the **correction of my own earlier
28 % coverage claim**, which the `entity=podcastEpisode` discovery overturned
(real: 272/272 episode lists, 245/272 audio).

**Blocked:** nothing.

**Next:** owner reviews the diff, then tests playback on the iPhone. Deploy
only after that.

## WS42 — swipe-to-remove + mixed podcast ordering — 2026-10-02T05:40Z

**Baseline:** `npm test` → **412/412 pass** (run, not copied)
**Scope now:** two owner-reported defects. (1) iTunes podcasts could not be
deselected. (2) SR and iTunes podcasts could not be interleaved — a mixed
arrangement reverted on the home screen. **NOT committed, NOT deployed.**

**Decision 1 — gesture direction, not a second gesture.** These rows already
had a 250 ms vertical drag-to-reorder. A vertical swipe-to-delete would fight
it, so direction decides ownership: horizontal removes, vertical keeps
reordering. This required fixing BOTH sides — the swipe claims horizontal, and
the drag's timer now cancels on a horizontal move instead of on any move.
Verified in the browser: vertical, rightward and 25 px swipes are inert.

**Decision 2 — a third key for ORDER only.** `minradio.podcasts.order.v1`
holds bare ids and no row data, so a podcast is still favourited in exactly
one of the two storages. The separation that protects the SR favourites
(`favoritesFromRaw` drops non-integers) is untouched. The alternative —
writing collectionIds into the SR array — would have silently deleted picks.

**Decision 3 — a ✕ button as well as the swipe.** A swipe is undiscoverable,
keyboard-unreachable and invisible to a screen reader. Both inputs call one
implementation, so they cannot drift.

**Test count:** 412 → **429** (+17). Suite 429/429.
**Mutations: 13 applied, 13 red**, `app.js` restored byte-identical by md5.

**MEASURED — reproduced in a browser before fixing (not reasoned about):**
- An external row's ↑ did **nothing**: it was alone in its own array.
- An SR row at the boundary was **clamped** by its own array's end.
- `buildIconSection` hardcoded SR-then-external — **this was the revert the
  owner saw**, and it was the renderer's fault, not the storage's.

**MEASURED — after the fix, driven in the browser:**
- external ↑ ×2 crosses two SR rows → first on the home screen; ↓ ×2 returns.
- Survives reload. Storage membership unchanged (`[3437,6706]` / `[1518…]`).
- **Existing user with no order key: unchanged, and no key is created.**
- Removing a row cleans the order key (`[999,3437,164]` → `[3437,164]`).

**Two defects found that the owner did not report:**
1. Removing an **SR** row toasted **"Borttaget: undefined"** — an SR favourite
   is a bare integer, so `loadFavorites()` has no name. The name is now passed
   in by the caller; the test also pins the fallback to the id.
2. **Mutation M20 reported GREEN.** Deleting the integer filter from
   `loadPodcastOrder` did not fail the suite, because the assertion matched a
   regex over a source *region* and the identical expression still existed in
   `savePodcastOrder`. Restated per function by brace-matched extraction; load
   side and save side both re-verified red. **A guard that cannot fail is not
   a guard** — caught only because the mutation pass ran.

**Deleted as unreachable:** `moveExternalPodcast`, `persistExternalOrder`,
`extRows` — all per-provider, all part of the cause. A test guards their
absence.

**NOT PROVEN / NOT DONE:**
- **Device gesture feel is NOT verified.** Synthetic touch events prove the
  logic and the DOM outcome; they cannot prove the feel, nor that iOS Safari's
  gesture recognition cooperates. **Needs the owner's phone.**
- Drag-to-reorder across the boundary is code-proven and mutation-verified
  but was **not** driven in a browser this session.
- Not committed, not pushed.

**Next:** owner reviews the diff and tests the swipe on the iPhone. Deploy
only after that.

## WS42 — deployed — 2026-10-02T06:05Z

**Commits:** `d37f586` (source + tests + docs) -> `7f2aa36` (artifacts).
Pushed; `local == origin/main`. Bundle `app.cad98830.js`, build id **d37f586**.

**Deploy checks, each run individually against the LIVE site:**
1. **PASS** — suite green and the count went UP: 429/429, was 412 (+17).
2. **PASS** — diff read. Changed: `app.js`, `styles.css`,
   `tests/itunes-podcast.test.mjs`, `ENHANCEMENTS.md`, `SESSION-STATUS.md`,
   `AGENTS.md` + instructions, plus mechanical artifacts (`index.html`,
   `sw.js`, hashed js/css). Nothing outside the stated scope moved; no
   transport, poll, schedule or timing constant was touched.
3. **PASS** — driven in a browser against the **built bundle**, asserting on
   rendered DOM.
4. **PASS** — the reported defect, checked against the owner's words. Mixed
   order moved in Settings and **stayed** on the main page.
5. **PASS** — neighbours spot-checked: SR-only podcast order unchanged, an
   existing user with no order key sees no change and gets no key created,
   removal cleans the key, vertical/rightward/short swipes all inert.
6. **PASS** — artifacts produced, and the **hashed** bundle contains
   `podcastRowOrder` (8), `enableSwipeToRemove` (3) and the order key (1), and
   **no** `moveExternalPodcast`.

**A propagation delay occurred and was NOT mistaken for a failure.** The first
live check returned **404** on `app.cad98830.js` and showed `index.html` still
pointing at `app.b9a35330.js`. Per the propagation rule I confirmed the commit
was on the remote and the raw host served the file (HTTP 200, contents
verified) before concluding **propagating, not failed**. A later check showed
Pages serving the new bundle.

**Live verification on the real site** (service worker unregistered first, or
a stale precache would serve the old bundle and invalidate everything):
`app.cad98830.js` loaded, mixed order moved two places up in Settings, and the
home page showed **Dear Young Person, Ekot granskar, P4 Psykologen** — the
arrangement held. Build id on screen: **d37f586**.

**What deploying does NOT establish:** the checks prove the right code is
**served**. They say nothing about how the swipe **feels**, and nothing about
audio. The owner's iPhone is still the only thing that settles that.

**Next:** owner checks build **d37f586** on the phone — confirm the swipe feels
right, that a vertical long-press still reorders, and that removing a podcast
can be undone.

## WS43 — swipe panel covered the row; corrected to the SMS idiom — 2026-10-02T06:50Z

**Baseline:** `npm test` → **429/429** at the start of this work.
**Scope now:** two owner reports about the swipe panel. (1) It is a red block
with a "Ta bort" caption, not like an SMS app. (2) *"we can't have a red
overlay over the old view — the user can't see which channels and podcasts that
are in the favorites section at all."*

**Test count:** 429 → **453** (+24). Suite **453/453**.

**Root cause 1 — wrong idiom.** A full-width red block with a written caption.
iOS Mail / WhatsApp slide the row to uncover a plain coloured area with a
**glyph**. Caption removed, trash icon added.

**Root cause 2 — a CSS painting-order trap, and the reason the list became
unreadable.** The row is `position: relative`, the panel `position: absolute`,
and the row's children were `position: static`. **Positioned elements paint
above all non-positioned siblings**, so the panel covered everything *despite
being written first in the DOM*. Source order does not cross the positioning
boundary. Fixed by giving every content child `position: relative` with no
offsets — it moves nothing, and only changes paint order.

**MEASURED by screenshot, not by reading code:** before, the row was a red
block with only the reorder grip faintly visible — name, logo, position and
controls all hidden. After, at 75 px and 165 px of swipe: content transform
`-165px`, panel transform `none`, all four content parts still visible.

**The gesture had to change too.** It was translating the **whole row**, which
would drag the panel sideways and leave nothing to uncover. It now captures the
content layer (every child except `.swipe-reveal`) on touchstart and
translates only that.

**Verified in a browser:** external podcast swiped out (SR storage untouched,
toast names it), SR podcast swiped out (external storage untouched), undo
restores both with position, vertical/rightward/short swipes inert.

**A TOOLING FAILURE, recorded because it nearly cost the diagnosis.** Three
`replace_string_in_file` calls reported success and did not apply. The next
browser check showed unchanged behaviour, which is indistinguishable from "the
fix does not work" — and I nearly re-diagnosed a correct fix as broken. All
three were re-applied with Python using `assert s.count(marker) == 1`, which
fails loudly. Every later edit used the same guard.

### CORRECTION to what I said earlier in this session

I earlier reported WS47 as "uncommitted in-flight work" and that my work
"cleared a pre-existing WS38/WS47 failure". **Both were wrong.** Measured:

- `ws47EffectiveEdgeS` was committed in **`6df011e`** ("WS47: derive the
  effective media edge at runtime"), so it is **already deployed**.
- The failing WS38 assertion came from the **same commit's** test.
- `git stash` of every uncommitted file shows **HEAD is 451/451 GREEN**.

So the red suite I saw at the start of this turn was caused by **my own
partially-applied edits landing in a different order**, not by WS47. WS47 is
untouched by this work and remains parked as an experiment.

**Not proven / not done:**
- **Device feel is NOT verified.** Layering is proven by screenshot and computed
  style; the feel of the slide and iOS Safari's cooperation are not.
- The commit threshold is 35 % of the row: ~149 px on a 425 px row, ~123 px on
  a 350 px phone row. Deliberately relative, but never checked against a thumb.
- Not committed, not pushed.

**Next:** owner reviews, then tests the slide on the phone.

## WS43b — live verification + deploy — 2026-10-02T06:20:00Z

**Baseline:** `npm test` → **453/453 pass** (run at the start of this block)
**Scope now:** correct the WS43 claim that the red overlay was fixed. Files
touched: `app.js` (face wrapper + controls re-parented), `styles.css` (row
transparent, `.selected-item-face` positioned + `flex: 1`), and the layering
test in `tests/itunes-podcast.test.mjs`. **OUT of scope:** every DVR/HLS path,
`fetchPodcasts`, `playTrack`, `enableDragSort`, `src/favorites.mjs`.
**Decision:** the surface colour had to move off the row onto an inner
positioned layer, *and* that layer had to be given `flex: 1`. Painting order
alone left rows red down the right-hand side.
**Test count:** 453 → 453 (two guards restated, two added, none deleted)
**Working tree:** clean apart from six pre-existing untracked `WS*-PROMPT.md`
files that were already there.

**MEASURED, live site, build `1ce0114`:**
- served JS contains `selected-item-face`; served CSS carries `flex: 1`,
  `min-width: 0`, `z-index: 1`, `background: var(--surface)` on the face
- at rest: row `rgba(0,0,0,0)`, face `rgb(255,255,255)`, face width 425 ==
  row width 425, on both rows
- harness screenshot at rest: white rows, no red. Mid-swipe: 150 px offset,
  red panel with trash glyph exposed, name readable
- live swipe → removed the iTunes podcast; SR storage `[6706]` untouched;
  toast "Borttaget: Dear Young Person"; order key rewritten
- undo restores podcast and position. Rightward / 25 px / vertical all inert
- reorder works after the restructure and survives reload
- 7 mutations, 7 red

**What this does NOT prove:** device feel. Whether iOS Safari cooperates with
`touch-action: pan-y`, and whether the slide *feels* right, needs the owner's
iPhone. Screenshots and computed styles prove layering, not gesture quality.

**Two of my own earlier claims were wrong and are corrected in
`ENHANCEMENTS.md`:** (1) WS43 did not fix the red rows — a live screenshot
disproved it; (2) there was never a pre-existing WS47 test failure — `HEAD` was
451/451 green.

**A §8 violation, self-inflicted:** `git checkout -- app.js` on a file with
uncommitted edits destroyed the face wrapper. Recovered from the built bundle
and re-applied with `assert s.count(marker) == 1`. All later mutations used
`/tmp` snapshots and checksum comparison.

**Blocked:** nothing
**Next:** owner to check build `1ce0114` on the iPhone — swipe a podcast left,
confirm it feels like Mail/WhatsApp and that the row is white at rest.

## WS44 — podcast sort ReferenceError + long-list report — 2026-10-02T13:20:00Z

**Baseline:** `npm test` → **453/453 pass** (run, not quoted)
**Scope now:** fix the podcast reorder save; report on the 371-row SR list.
Files touched: `app.js` (2 lines — `extList` passed into `enableDragSort`) and
`tests/itunes-podcast.test.mjs`. **OUT of scope:** `enableSwipeToRemove`,
`fetchPodcasts`, `togglePick`, all storage helpers, `src/favorites.mjs`, every
DVR/HLS path.
**Decision:** the reorder save threw `ReferenceError: extList is not defined` —
`extList` is `buildSelectedGroup`'s local, read from its sibling. The rows
moved on screen before `persist()` ran, so nothing was saved and the order
reverted. Channels were unaffected (their branch returns first), which is why it
looked podcast-only.
**Test count:** 453 → 456 (+3: an executing persist harness, a signature guard,
a scope linter)
**Working tree:** clean apart from the six pre-existing untracked `WS*-PROMPT.md`

**MEASURED, live site, build `b370dac`:**
- long-press drag reorders; SR `[3437, 6706]`, iTunes untouched, order key
  `[3437, 6706, 1518156497]`, **zero page errors**
- survives reload; main-screen icons match the sheet rows
- 4 mutations, 4 red

**THE MEASUREMENT THAT MATTERS MOST:** 453 green tests could not see this,
because a `ReferenceError` is a property of *running* code, not of source text.
The new test executes `persist()` through `new Function()` and drives the real
`dragstart`→`dragend` listeners, so reverting the signature reproduces the
owner's exact error.

**WS44b — REPORT ONLY, nothing implemented.** The SR list is **371 rows /
33 010 px**. Recommendation: show an empty state until the owner types, so the
list appears on the first keystroke. Search is already client-side and instant
(371 rows, no network). SR's API exposes **no category field**, so grouping
would have to be invented by parsing names. Two caveats recorded: SR search
matches **name only, not description**, and iTunes needs 3 characters while SR
works at 2.

**Blocked:** nothing. Waiting on the owner's decision for WS44b.

**Next:** owner to (a) confirm the drag feels right on the iPhone at build
`b370dac`, and (b) accept, amend or reject the WS44b empty-state proposal.
