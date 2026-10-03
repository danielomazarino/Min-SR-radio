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

## WS44c — podcast list behind the search box — 2026-10-02T14:40:00Z

**Baseline:** `npm test` → **456/456 pass** (run, not quoted)
**Scope now:** gate the 371-row podcast list behind the search box, per the
owner's approval. Files touched: `app.js` (the gate, `searchQuery`,
`clearSearch()`, description matching, stale-row drop), `styles.css`
(`.pick-empty` + title/sub), `tests/itunes-podcast.test.mjs` (+6).
**OUT of scope, deliberately:** `enableDragSort` and `enableSwipeToRemove` —
the owner clarified long-press drag is *reorder* and that deselect works, so
neither path was touched. Also untouched: `fetchPodcasts`, `extSearch`,
`togglePick`'s storage rules, `src/favorites.mjs`, every DVR/HLS path, and the
**channel** list, which stays browsable.
**Decision:** show a prompt instead of the rows until the owner types; match SR
on description as well as name; state each source's real character threshold.
**Test count:** 456 → 462
**Working tree:** clean apart from the six pre-existing untracked `WS*-PROMPT.md`

**MEASURED, live site, build `e502484`:**
- unsearched: 0 rows, 0 skeletons, prompt shown (127 px, was 33 010 px)
- `granskar` → 5 rows · `dear` → 20 iTunes rows · `samhälle` → 26 SR rows
  (description-only match) · cleared → prompt returns, no skeletons
- selection round trip on both providers, each storage changing only its own
  membership; survives reload; list re-gates
- **zero page errors** throughout
- 7 mutations, 7 red

**TWO REAL DEFECTS found in the browser and fixed here** — not present in my
first implementation:
1. Clearing the box set `loaded.podcasts = false` with no fetch scheduled, so
   `renderList()` took the skeleton branch and the sheet showed **five permanent
   grey bars**. Measured, and it did not resolve on its own.
2. A stale iTunes row from a previous query was re-rendered as a result for the
   next query.

**TWO DEFECTS IN MY OWN WORK, also recorded:** the description-filter harness
reported a false failure because it did not lowercase like `loadItems` does;
and the prompt CSS was lost twice to a stale `/tmp` restore, which no JS guard
could see. Both now have guards.

**Blocked:** nothing
**Next:** owner to check build `e502484` on the iPhone — confirm the prompt
reads well and that typing feels right, and that finding a podcast by a word in
its description now works.

## WS45 — weather in the header, tracking the train — 2026-10-02T16:20:00Z

**Baseline:** `npm test` → **462/462 pass** (run, not quoted)
**Scope now:** weather chip in the header (icon + °C + short Swedish place),
tracking the phone continuously. Files touched: `app.js` (new self-contained
weather module + `initWeather()` call in boot), `styles.css` (`.topbar-left`,
`.weather*`), `index.html` (hashed asset refs), `tests/itunes-podcast.test.mjs`
(+10).
**OUT of scope:** `enableDragSort`, `enableSwipeToRemove`, `removeFavoriteRow`,
`restoreFavoriteRow`, `fetchPodcasts`, `togglePick`, storage helpers,
`src/favorites.mjs`, every DVR/HLS path.
**Decision:** permission on load (owner Q1 = yes); short Swedish place name, no
country/county (owner Q2); live tracking with 3 km + 5 min gates (owner Q3).
**Test count:** 462 → 472
**Working tree:** clean apart from the six pre-existing untracked `WS*-PROMPT.md`

**MEASURED, live site, build `fd4bfcb`:**
- cold start `Klart, 16°, Göteborg`; `.topbar` children = `["topbar-left",
  "edit-btn"]` — TWO, cog right-aligned (the WS11 regression cannot recur)
- 300 m wobble → **no** request (cache age 7.0 s → 9.6 s)
- 8 km move after 6 min → `Klart, 15°, Partille`, exactly one refresh
- further movement follows the new municipality
- **12 mutations, 12 red**

**THE FINDING THAT MATTERS MOST:** `initWeather` seeded `lastFetched` from the
cache and then immediately set it to `null`, so the distance gate had no
previous position and EVERY GPS callback fetched — a 300 m wobble spent an API
call. Found by driving the real handlers and watching the cache timestamp, NOT
by reading: every source-text guard passed, because the source contained
correct-looking code that could never fire.

**Owner answers applied:** Q1 permission on load · Q2 short Swedish place, no
county · Q3 continuous tracking while the app is open.

**Blocked:** nothing
**Next:** owner to check build `fd4bfcb` on the iPhone — allow location once,
confirm the header reads well on a narrow screen, and confirm the place follows
during a real train ride.

**NOT verified, and it needs the phone:** real GPS behaviour, iOS's own
permission prompt, and battery impact over a long ride. Every measurement above
drove the real handlers with a simulated GPS.

## WS46 — ask for location once, not on every open — 2026-10-02T17:40:00+02:00

**Started / baseline:** `npm test` → **472/472 pass** (run, not copied)
**Scope now:** the repeated iOS location prompt. IN scope: when the app asks.
OUT of scope: everything else — no change to favourites, drag-sort, swipe-to-
remove, search, DVR/HLS or playback.
**Decision or finding:** the app asked on EVERY open — measured at 2 geolocation
calls per load (1 `watchPosition` + 1 `getCurrentPosition`) even with a
1-minute-old cache. A cache it already held was not enough to stop it. Now it
asks at most once per install, and taps the weather chip to refresh on demand.

**Test count:** 472 → **483/483 pass**
**Working tree:** clean. Source `13e15ec`, artifacts `7f1ebd3`, both pushed.

**MEASURED (browser, service worker + caches cleared first, geolocation stubbed
with counters; calls shown as get/watch per open):**

| open | calls | chip |
|---|---|---|
| never asked, no cache | 1/1 | `16°Göteborg` |
| asked, 1-min cache | 0/0 | `16°Göteborg` |
| asked, 4-hour cache | **0/0** | `16°Göteborg` |
| asked, no cache, tapped | 0/0 → 1 get | `Väder` → `16°Göteborg` |
| asked, 4-hour, tapped 3× | 0/0 → 3 gets | unchanged, no duplication |

Live re-verified at `13e15ec`: same results; chip carries `role="button"`.

**What it does NOT prove:** nothing was run on iOS. Desktop Chromium cannot
show the system dialog, so whether the owner's iPhone still asks is unmeasured.
MDN: a granted permission's lifetime "depends on the user agent, and may be time
based, session based, or even permanent" — iOS offers web apps only "Allow Once"
/ "While Using", never always-allow. If iOS re-prompts per session, that is the
OS and no web app can override it.

**Three defects I introduced and then caught by measuring** — all invisible to
green source-text tests, all found only by reading the rendered DOM:
1. no chip at all when there was no cached reading (a silent dead end);
2. repaint appended instead of replaced → `16°Göteborg16°Göteborg`;
3. the no-blank guard fired on a freshly created chip → a blank, untappable chip.

**Blocked:** nothing. **Next:** owner to check build `13e15ec` on the iPhone.

### Two things the owner raised that were NOT defects in the app

1. *"each time i open... i get the question"* — a real defect, fixed above.
2. *"i don't see the weather info when i open the url in the safari browser"* —
   the Safari tab was serving a **stale service-worker cache**. Verified: with
   the cache in place the page ran the old `app.aea08104.js`; after unregistering
   the worker and deleting the caches it ran `app.6e0b5230.js` with the fix.
   This repo has hit this before. Unstick on a phone: reload, or remove the
   Home-Screen app and add it again.

## WS47 — weather stays current without asking again — 2026-10-02T19:05:00+02:00

**Started / baseline:** `npm test` → **483/483** (run). **Now 490/490.**
**Scope now:** three owner observations from the iPhone. IN scope: weather
refresh behaviour and the geocoder dependency. OUT of scope: nothing else.

**Owner report, verbatim:**
1. *"in safari on ios i get a dimmed, italic 'Väder', for pwa app i get
   correctly a sun icon, 14 degrees and Göteborg"*
2. *"it does not seem to update as it get colder outside"*
3. *"the closure of the pwa app and then opening again now doesn't evoke a new
   location approval automatically"*

**(3) is the WS46 fix working.** It is now pinned by test so it cannot regress.

**Defects found (all measured before fixing):**

| | defect | measured |
|---|---|---|
| A | stale reading never refreshed — WS46 conflated "never ask again" with "never update again" | 4 h-old cache, 0 requests, frozen at 16° while real weather was 2° |
| B | failed place lookup discarded a real temperature (`if (!place) return 'no-place'`) | geocoder blocked → no weather at all; **this was the Safari symptom** |
| C | WS46's visibilitychange handler called `startWeatherWatch()` on every foreground — re-arming the prompt on every app-switch | found by reading, not by a failing test |

**Fix:** `refreshWeatherQuietly()` reuses saved coordinates, or resolves the
saved place NAME via the Open-Meteo geocoding API. Neither path can raise a
permission prompt — asserted as an absence across the whole call chain. Plus a
`WEATHER_REFRESH_MS` timer while the app is open and visible, skipped when
hidden (the constant WS45 defined and never used).

**MEASURED (browser, SW + caches cleared; LOCATION_PROMPTS = get/watch):**

| case | weather calls | prompts | chip |
|---|---|---|---|
| 4 h cache, no coords (owner's real state) | 1 | **0/0** | `2°Göteborg` |
| 4 h cache, geocoder down (Safari) | 1 | **0/0** | `2°Göteborg` |
| 10-min cache (must not refetch) | 0 | **0/0** | `16°Göteborg` |

Re-verified live at `6cdde29`. Deploy checks: suite green 490 · remote head
`5d9991a` · live serves `app.ca064cd0.js` 200 · hashed bundle contains all five
fixes.

**What it does NOT prove:** still nothing run on iOS. The place NAME is not
refreshed on a quiet refresh (that would need a geocoder call per refresh), so
on a journey the city stays the old one until the chip is tapped. Stated, not
hidden.

**Two mutations caught going GREEN / NO-OP on the first pass** — the reason this
entry is longer than the fix:
- renaming `refreshWeatherQuietly` left all 483 tests green, because they
  asserted the CALL SITE. Now asserted as a closure.
- a `readWeatherCache` mutation was a NO-OP: I had written the intent as a
  comment in a different place and never made the change.

**Blocked:** nothing. **Next:** owner to check build **`6cdde29`** on the phone —
closing and reopening must NOT prompt, and the temperature must track reality.

## WS47b — no stuck "Väder", and always refresh at open — 2026-10-02T19:55:00+02:00

**Started / baseline:** `npm test` → **490/490** (run). **Now 494/494.**
**Scope now:** two owner reports from the iPhone. IN scope: the open-time
refresh decision, and recovery when a position lookup FAILS. OUT of scope:
nothing else.

**Owner report, verbatim:**
- A *"the temperature updated to 13 from 14 degrees when i clicked on the
  weather pill manually ... so you need to check if there is a refresh missing
  at pwa app starts"*
- B *"on safari [...] i still have the italic väder, and there is no location
  request popping up when launching the page or clicking the weather pill"*

**B was the serious one — the app could get PERMANENTLY stuck.**

| defect | measured |
|---|---|
| D — no recovery from a failed position | 3 consecutive opens, geo denying every call: `Väder`, `Väder`, `Väder`, 0 weather requests, 0 prompts. Tapping the chip: 1 geolocation call, 0 requests, chip unchanged. |
| E — open-time freshness gate | cache 29 min old → 0 requests, painted a degree out; 31 min old → 1 request, correct |

Cause of D: WS46's ask-once flag + WS47's coordinate-or-place-name refresh
left the app silent AND unable to recover — with no reading there is no place
name to look up either. **A failed position is not the user saying no.**
Fix: retry quietly on a 10-minute timestamp cooldown; a tap falls back to the
permission-free route, paints and stores what it got.

Cause of E: the gate traded accuracy for one saved request per launch. Removed.
An open now always refreshes, bounded to ONE request by the `weatherBusy` lock,
still with zero permission prompts.

**MEASURED live at `50ced0f`** (SW + caches cleared; PROMPTS = get/watch):

| case | weather calls | prompts | chip |
|---|---|---|---|
| 29-min cache, truth 13 | 1 | **0/0** | `13°Göteborg` |
| 20-min cache, truth 13 | 1 | **0/0** | `13°Göteborg` |
| no cache + geo DENIED | 1 | **0/0** | `13°Göteborg` |
| same, tapped | +1 | 1 get | `13°Göteborg` |

Deploy checks: suite 494/494 · remote `d4fdfe2` · live serves `app.b2b2fcea.js`
200 · hashed bundle contains all three fixes.

### How often the weather refreshes (asked directly)

- **On every open** — always, one request, no permission. This is new: a
  30-minute "fresh enough" gate was removed because it showed a stale number.
- **Every 30 minutes** while the app is open and visible (`WEATHER_REFRESH_MS`).
  Nothing is polled while it is in the background.
- **On tap** of the pill — immediately, bypassing all gates.
- Worst case staleness is therefore ~30 min, down from ~60 before.
- Retrying a *failed* position: once, then at most once per 10 minutes.

**Two tests SUPERSEDED** and restated to the requirement, not the mechanism —
one had been satisfiable by deleting the branch it guarded.

**One mutation reported GREEN (Q4).** Making `weatherRetryDue()` return `true`
unconditionally passed everything, because the tests asserted only that the
helper is *called*. The test now extracts and **calls** the real helper with a
fake localStorage and asserts it declines inside the cooldown window.
Asserting the literal `return false` was tried first and was wrong — the helper
returns a boolean expression, and matching the literal would have forced worse
code to satisfy a test.

Tests: 494. 12 mutations all RED, checksum restored.

**Blocked:** nothing. **Next:** owner to check build **`50ced0f`** — the pill
should be correct the moment the app opens, and Safari should show a reading
rather than `Väder`.

## WS47c — the launch refresh silently failed on the real device — 2026-10-02T20:40:00+02:00

**Started / baseline:** `npm test` → **494/494** (run). Still **494/494**.
**Scope now:** one owner report, with a screenshot of BOTH surfaces on the
previous build (`50ced0f`):
*"the changes have not visually gone true, and when i clicked on the pill on the
pwa app it changed again to 13 degrees from 14 at launch"*

**REPRODUCED EXACTLY before changing anything.** Blocking only the geocoding
host `geocoding-api.open-meteo.com`:

| | chip | network |
|---|---|---|
| at open | `14°Göteborg` | `[GEOCODING]` only |
| after tap | `13°Göteborg` | `[GEOCODING, FORECAST, PLACE]` |

**Root cause.** With no saved coordinates — the state of every install that has
not refreshed since WS47 — `refreshWeatherQuietly` had exactly **one** route:
turn the saved place name into coordinates. That needs a **second host** the app
must reach, and on this device it is not reachable. So the launch refresh failed
silently and the header kept its old number. The tap worked because it goes via
`getCurrentPosition` and never touches that host.

**This dependency was introduced by me in WS47 and I never checked it was
reachable from the phone that matters.** A test can prove the call exists; only
the device could have told me the host was dead.

**Fix** — three routes, in order of what they cost the user:
1. coordinates already saved — no request, no permission
2. the saved place name — no permission, but needs a reachable host
3. the granted position — **last**; the only one that can raise a dialog

**MEASURED** (real function extracted and executed):

| case | geolocation calls | result |
|---|---|---|
| coordinates saved | **0** | refreshed |
| geocoding reachable | **0** | refreshed |
| geocoding **unreachable** | 1 | **refreshed** ← was stuck at 14 |

**Two tests SUPERSEDED.** WS47 asserted an *outright ban* on geolocation in the
quiet refresh. That ban is precisely what made this unfixable, so it is restated
as the bound that matters: no watcher is ever started, the permission-free route
is tried first, and geolocation is reached only when it returned nothing.

**Stated cost:** if iOS's "Allow Once" lapses back to `prompt`, the user may see
one dialog and *get weather* — which is better than a permanent dimmed `Väder`.

**Two probe corrections, both cases where the test would have forced worse code:**
- asserted a literal `if (!byPlace)` when the code correctly uses an early
  return — the control flow is asserted instead;
- hit the WS7 trap live in the verification harness: a stub passed as a function
  parameter does not make a module-scope `let` assignable. It failed loudly with
  a `ReferenceError`, which is the good version of that failure.

**One mutation reported GREEN (R5)** — dropping `{ force: true }` from the
fallback — because the existing assertion was satisfied by the coordinate path.
Now asserted on the fallback specifically.

Tests: 494. 6 mutations all RED, checksum restored.
Deploy: remote `4e8f5ac`, live serves `app.f671f30d.js` 200.

**Blocked:** nothing. **Next:** owner to confirm build **`d6d4d67`** shows the
correct temperature at launch on BOTH surfaces, with no dialog.

## WS48 — tap must not prompt, coords must persist, 5-minute cadence — 2026-10-02T21:20:00+02:00

**Started / baseline:** `npm test` → **494/494** (run). **Now 498/498.**
**Owner report, verbatim:**
1. *"the app started with 13 degrees and clicking on the weather pill opened the
   ios toast for approving location services. is this expected?"*
2. *"on safari [...] still the italic väder sign and no location services toast
   when clicking on it"*
3. *"update every 5th minute instead of every 30 minutes"*

---

### Point 1 — the location toast on tapping. **No, not expected. Fixed.**

**Why it happened:** tapping was meant to be the *cheap* refresh, but it asked
for your location **every single time** — even when the app already had your
coordinates saved. Asking was exactly what saving them was supposed to avoid.

**Measured before the fix:** with coordinates in the cache, a tap still made one
`getCurrentPosition` call. On iOS that is the difference between a silent refresh
and a system dialog.

**Done:** a tap now uses the saved coordinates first. **0 location calls.**
That is also why your PWA showed 13° at launch — the launch refresh was
downloading your coordinates through the fallback route, and once they were
saved, the tap had no reason to ask.

### Point 2 — Safari's italic *Väder*. **Not a bug — and no app can fix it.**

**Why it looks stuck:** with nothing saved and location unavailable, tapping
reaches the position lookup, gets nothing, and gave up **silently**. A dimmed
*Väder* that does nothing looks identical to a broken app.

**What is actually happening:** your iPhone has location set to **denied** for
Safari. A denied web permission is permanent — the system returns no position
*and* shows no dialog. That is precisely why tapping did nothing **and** no
toast appeared. No website on earth can recover from this; only you can.

**Done:** the pill now says so instead of appearing broken —
*"Ingen platsinfo. Tillåt i Settings > Safari > Plats."*
Shown in the visible text, the `aria-label` and the tooltip. Deliberately **not**
a toast, because a toast vanishes before most people look up.

**To fix it:** iPhone **Settings → Apps → Safari → Location** (or the equivalent
under Chrome), and allow it. Then reopen the tab.

### Point 3 — refresh every 5 minutes. **Done.**

`WEATHER_REFRESH_MS` 30 → 5 minutes. Worst-case staleness ~30 min → **~5 min**.
Kept honest by three bounds: one request per tick, nothing at all while the app
is hidden, and no repaint when nothing visible changed. Cost: ~6x the weather
requests over a long session — a real trade, stated rather than hidden.

---

### Defect F found along the way

The by-name lookup **resolved your coordinates and threw them away**. So it never
made any future open cheaper — every open went back for location again. It now
returns and stores them.

**MEASURED after the fixes:**

| case | location calls | result |
|---|---|---|
| tap, coordinates saved | **0** | toast gone |
| open, coordinates saved | **0** | correct |
| open, geocoder down, no coordinates | 1 | refreshes **and saves coordinates** |
| next open, geocoder still down | **0** | still correct |
| Safari, no reading, denied | 0 | chip now explains the Settings fix |

### Two probe corrections worth recording

Both produced convincing **wrong** answers before failing loudly, and both were
my instruments, not the app:
- omitting a closed-over binding throws a `ReferenceError` *inside* the
  refresh's `try`, which its `catch` reports as `'failed'` — indistinguishable
  from a real outage. The harness had already "found" a failure that way.
- a stub for the by-name lookup that didn't return coordinates reported
  "coordinates are not saved" as if the fix had failed.

**Tests: 498. 8 mutations all RED.** Deploy: remote `a4284dc`, live serves
`app.f82d2daf.js` 200.

**Next:** owner to check build **`ed9f68e`** — tapping should no longer prompt,
and Safari should name the Settings fix.

## WS49 — "was that expected?" + explain the empty header on open — 2026-10-02T21:45:00+02:00

**Started / baseline:** `npm test` → **498/498** (run). **Now 499/499.**
**Owner report, verbatim:**
*"switched on location services for safari and got 13 degrees Göteborg same as
in the pwa app. when i switched it off and refreshed the webpage the 13 and
Göteborg stayed. didn't show the italic väder until i cleared the history. was
that expected behaviour according to implementation"*

### Both halves were expected — MEASURED, not reasoned

| scenario | prompts | header |
|---|---|---|
| location ON, coordinates saved | **0** | `13° Göteborg` |
| location **OFF**, coordinates saved | **0** | `13° Göteborg` ← stayed |
| history cleared, location OFF | 0 | italic `Väder` |

**Why 13° stayed after switching location off — and this is correct.** Once
coordinates are saved the app does not need the GPS at all. Weather for a city
does not change because a permission was withdrawn. The whole point of saving
them (WS48) was so the header keeps working without ever asking again — so
withdrawing permission cannot make it stop. Turning location off and expecting
the header to empty would mean the fix was never in place.

**Why clearing history produced *Väder*.** Clearing removed the saved
coordinates, which is the only thing that can produce the empty state. So the
sequence the owner observed is exactly the sequence the implementation implies,
and the fact that clearing was needed is itself evidence the saving works.

### One real defect found, and fixed

**DEFECT G.** MEASURED: `explainNoLocation()` was called from `refreshWeatherNow`
and from **nowhere** in `initWeather`. So the empty state explained itself when
reached by **tapping** and stayed mute when reached by **reloading** — two entry
points into one dead end behaving differently, and no test covered the difference.
Reloading is the path people actually take; the owner took it.

Fix: the retry-FAILED branch in `initWeather` now explains itself too. The test
asserts it sits on the FAILED branch, since calling it after a successful retry
would overwrite a perfectly good reading.

**What the user now sees in that state, on either entry path:**
`Ingen platsinfo. Tillåt i Settings > Safari > Plats.` in the visible text, the
`aria-label` and the tooltip — not a toast, which is transient.

Tests: 499. 1 mutation RED, checksum restored.
Deploy: remote `8b39005`, live serves `app.a26be8a4.js` 200.

**Next:** owner to check build **`40870cf`**. To see the explanation, turn
location off, clear the app's storage, and reload — the pill should now name the
setting instead of looking broken.

## WS50 — tablå scroll: flick/drag close now respects direction — 2026-10-03T02:10:00+02:00

**Started / baseline:** `npm test` → **499/499** (run). **Now 505/505.**
**Owner report, verbatim:** *"now 12 degrees so we can consider the 5 minute
update done. make the fix for the flick behaviour"*

**Scope now:** the swipe/drag close condition in `enableSwipeToClose`. Explicitly
OUT of scope: `openSheet` (already correct), the mini-bar and sheet-order drags
(already direction-guarded), and all DVR/HLS code.

**Decision or finding:** `Math.abs(d)` discarded the direction, so a gesture the
drag code had already **refused** still counted as a close on release. Only
`d > 0` may close.

**Test count:** 499 → 505
**Working tree:** clean. Source `eeebe4d`, artifacts `40c7f91`, both pushed.

**MEASURED — live site `app.1d08f256.js`, P1 card, 163 rows:**

| gesture | before | after |
|---|---|---|
| 50 px up flick | card CLOSED | **card SURVIVES**, transform `none` |
| slow 300 px up drag | card CLOSED | **card SURVIVES** |
| 220 px down flick | closes | **closes** (`translateY(220px)`) — intact |

Also measured on the live site **before** the fix, at 192 rows: 50 px up flick
closed the card against a 171 px threshold. **What this does NOT prove:** no
iPhone run. Synthetic touch exercises the release logic, not iOS's own scroll
gesture.

**3 mutations, 3 RED**, checksums restored: both branches → 3 fail; flick only →
2; distance only → 1. Each branch is guarded independently.

**Three harness defects found and fixed (mine, not the product's):** `grab()`
took a destructured parameter as the body; `window.innerWidth` is a global that
argument stubs cannot shadow, leaving the threshold `NaN`; `close` is deferred
180 ms and was read synchronously. All three would have made a guard pass for
the **wrong reason**.

**Deploy checks, individually:** suite 505/505 **PASS** · count UP **PASS** ·
remote head `40c7f91` **PASS** · live serves `app.1d08f256.js` 200 **PASS**.

**Weather, closed:** owner-observed 13° → 12° in the same place. The 5-minute
cadence is **device-verified by the owner**, the last open WS48/WS49 item.

**Blocked:** nothing.
**Next:** owner to check build **`eeebe4d`** — long-press a channel, flick the
programme list fast, and confirm the card stays open. That is the one reading
this workstream cannot substitute for.

## WS53 — drag, Info page, brand icons — 2026-10-03T02:40:00+02:00

**Baseline:** `npm test` → **518/518** (run). **Now 523/523.**
**Owner report, verbatim:** three defects — "the spotify and youtube icons needs
to be the official icons from the companies. the info page is not moved as
stipulated in the requirements, i can only see the old info button being renamed
to Tests… the Info och Anpassningar still doesn't drag down i see as it should,
only the small horizontal mark is moving and the menu itself seems stale."

**All three MEASURED before fixing**, two on the LIVE site at build `022f82b`:
- drag: `sheet transform: none`, `zone transform: translateY(110px)`
- Info page: no info button on the home screen; help text unreachable from it
- icons: glyphs were the letters S and Y

**Decision:** the drag's cause was the BUG 1 fix (2026-09-22) — it correctly
scoped the gesture to `.sheet-grab-zone` but passed that zone as the element the
transform is written to, so the scoping was right and the movement was left
behind. `enableSwipeToClose` now takes `move` (what slides) separately from
`panel` (what receives), defaulting to `panel` so three call sites are unchanged.

**Test count:** 518 → 523. **5 mutations: 4 RED, 1 NO-OP reported.** The no-op was
my measurement error (a `.replace` that matched a different `});`); the guard was
sound, the mutation never applied. Re-mutated against the exact anchor → red.

**Three test-side faults fixed, each of which reported a defect that did not
exist:** a region ending one line before its call; `[^)]*` unable to span
`onDone?.()`; and a flat regex counting 4 topbar children because it could not
distinguish a wrapper from the buttons inside it.

**One product-code crash found ONLY in the browser:** the SVG passed as a
variadic child of `el()` threw "parameter 1 is not of type 'Node'" and took the
expand panel down. 523 source-text assertions could not see it.

**One CSS syntax error I introduced in WS52** — 8 orphaned declarations outside
any rule, leaving the day labels unstyled — repaired, found via the owner's
screenshot.

**Deploy checks:** suite 523/523 **PASS** · remote `60358a9` **PASS** · live
`app.78643850.js` **PASS** · served bundle **byte-identical to local**
(`eedfc622`, md5-compared) **PASS**. An earlier poll showed a different hash; that
was my own stale expected value, not a deploy fault — resolved by md5.

**Next:** owner to check build **`022f82b`**. One reading settles all three: drag
the Info sheet down and watch whether the whole panel follows the mark.

## WS54 — zero gap, always-visible mark, header swipe, both card types — 2026-10-03T04:05:00+02:00

**Baseline:** `npm test` → **523/523** (run). **Now 528/528.**
**Owner report, verbatim:** *"the igår and idag at scolling has a gap that should
not be between the P1 section attached and the label igår … needs to be tightend
to zero pixels. the second issue is that the horizontal marker section should be
visible at all times. the third is that touching and draging down from the p1 one
section … needs to be possible regardless of where the tableu is scrolled."*
Follow-up: *"the same fix … for the podcasts too."*

**Measured before fixing** (driven DOM, tablå card):
- gap: header bottom 176, card-body top 184 → **8 px**
- mark: hidden whenever scrolled (both bands were `top: 0`, header covered it)
- header drag: `zoneSees 0, headerSees 3, transform none` — never received

**The geometry is the fix.** Three elements stack in a fixed band: grab zone
`top 0 h 33`, header `top 33 h 51`, day label `top 84`. Each offset is the height
of everything above it, so **two** values are published: `--card-grab-h` (zone
alone) and `--card-fixed-h` (zone + header). WS52 published one sum and gave it
to both, which pushed the header to 84 and let the 33 px zone show through as the
photographed gap.

**MEASURED after, on the tablå card at scrollTop 0/40/600/1400/2000/4000:**
`gapToLabel0 = 0`, `markVisible = true` at every position, `noOverlap = true`,
labels never coincide. Header drag closes from rest **and** from scrollTop 2500.
List scroll still survives; grab-zone drag still folds.

**Podcast cards: no separate work.** All three card types are built by
`openContextCard`, so they share the implementation and the `.sheet.context-card`
CSS scope. Verified live rather than assumed — `Nyheter P4 Göteborg` reports the
same `33px`/`84px`, `markVisible: true`, `listScroll_survived: true`,
`headerDrag_closed: true`.

**Two wrong fixes came first, both recorded because both were measured:**
subtracting the day label's own padding from its offset (wrong element — it is
`.card-body`'s margin; it changed nothing at rest then overlapped by 41 px), and
giving the labels the header height alone (parks them 33 px high, under the
header). The gap was `margin-top: 8px` all along.

**Test count:** 523 → 528. **4 mutations, 4 RED**, checksums restored: labels use
header height alone · restore the 8 px margin · header back to `top: 0` · unbind
the header swipe.

**Three test-side faults, all mine, each reporting a defect that did not exist:**
a hand-rolled regex that could not match the real `setProperty(...)` call; a
regex demanding `\d+px` when the fix writes `margin-top: 0` without a unit; and a
call-site count that also matched the function declaration.

**Deploy checks:** suite 528/528 **PASS** · remote `2ede0c3` **PASS** · live
`app.8056e062.js` **PASS** · served bundle **byte-identical to local**
(`89269067`, md5) **PASS**. The polling loop printed a different hash first —
again my own stale expected value, resolved by md5 rather than by assuming.

**Next:** owner to check build **`3bac597`**. One reading settles all three: open a
tablå card, scroll to the middle, and check that (a) the header sits flush against
"Igår" with no gap, (b) the grab mark is still there, (c) dragging from the P1
header closes the card. Then repeat on a podcast.

## WS55 — whole top band draggable + enhancements feature table — 2026-10-03

**Baseline:** `npm test` → **528/528** (run). **Now 532/532.**
**Owner report, verbatim:** *"visually all is okey, but the band to touch on for
the dragging down doesn't seem to cover the whole top area that is possible to
use for the dragging down. it feels like one has to be very close to the
position of the horizontal mark."*
Second instruction: *"go through all of the file and make a full table of
features covered in it and mark them done or undone."*

**MEASURED before fixing** — computed `touch-action` per band on the tablå card:

| band | y-range | h | touch-action | app owns it? |
|---|---|---|---|---|
| `.sheet-grab-zone` | 91–124 | 33px | `none` | YES |
| `.sheet-header` | 124–175 | 51px | `manipulation` | no |
| `.card-day-label` Igår | 175–205 | 30px | `manipulation` | no |
| `.card-day-label` Idag | 205–235 | 30px | `manipulation` | no |

**33 px usable of 144 px visible.** The complaint, as a number.

**Cause was NOT the JS binding.** WS54 already bound the header and a synthetic
header drag closes the card on desktop. The cause is `touch-action`: the zone
declares `none`, the header never did, so it computed to `manipulation` and the
UA may claim the drag as a scroll. Desktop never exercises that, which is why
the headless run looked fine while the phone did not.

**THE REACHABILITY TRAP, caught by measuring.** The day labels are now a swipe
surface by **delegation** on the sheet with a new `within` filter. The obvious
loop over `.card-day-label` was written first and bound **zero** listeners:
`openContextCard` calls `buildBody()` before binding, and the tablå builder
creates labels inside an async `.then()`. Measured: drag from a label gave
`transform: none` 3/3 while the header closed 3/3. Sampling showed 2 labels
present at 0 ms — they exist, just AFTER the synchronous pass. WS21/WS26 class:
correct code that never runs.

**MEASURED after, driven DOM:** usable **144px of 144px** (was 33/144). Closes
from zone (y=101), header (y=150) and both labels (y=190, y=218), polled to
settlement. Programme-row drag does NOT close. Upward drag from header AND from
a label springs back (WS50 intact). Header drag at `scrollTop 3000` closes.
`gapToLabel 0`, mark visible deep-scrolled. Podcast card: both bands `none`,
33px/51px — verified, not assumed.

**Confirmed on the LIVE site** after deploy: live serves `app.8692ea6b.js` /
`styles.0abfe714.css`; drag closes from all four bands.

**A finding I did NOT act on.** The live matrix closed 1/4 at y=218 while the
drag itself worked 4/4. Cause: a 90px drag is far below the 266px distance
threshold, so the close rides entirely on the flick branch (`elapsed < 250 &&
d > 40`). Five measured runs: **148–225 ms against a 250 ms window** — as little
as 25 ms headroom. My driver's 16ms inter-move sleep inflates this, so it is
NOT a demonstrated product defect and **the window is unchanged**. Widening it to
make the numbers look clean is the fudge-factor move the rules forbid.

**Test count:** 528 → 532. **7 mutations, 7 RED**, checksums restored each time.

**One test restated (SUPERSEDED, form only).** The WS53 signature guard pinned
`/{ axis = 'x', move = null }/` literally, so adding `within` broke a test whose
requirement is unchanged. Restated to assert the properties (`move` accepted,
defaults null, `mover` falls back to `panel`) and mutation-verified to still bite
(mutation 7).

**Four test-side faults, all mine, each reporting a defect that did not exist:**
a regex that could not match across a CSS comment; a helper returning only the
FIRST of a two-rule selector list (answered the `position: sticky` question
while appearing to answer the `touch-action` one); a `.card-list` guard whose
selector matched a descendant rule so the sticky band answered for the list; and
`upwardDidNotClose: false` from a probe that scrolled the wrong element — the
`.sheet` is the scroller, not `.card-list`.

**Deploy checks:** suite 532/532 **PASS** · remote `153cfaf`→`014a227` **PASS** ·
live `app.8692ea6b.js` + `styles.0abfe714.css` 200 **PASS** · both served files
**byte-identical to local** (`76a18bc0`, `f5a041cb`) **PASS** · live DOM drag
matrix **PASS**.

**Enhancements log:** WS55 entry plus a FULL FEATURE TABLE over every E-, B-,
owner-reported and context-card item, each DONE or UNDONE with evidence named.
DONE and UNDONE are separated, and within them code-proven / driven-DOM-proven /
device-verified. B4 was first written as one vague row from memory and corrected
to its four real items, read back from the log rather than recalled.

**NOT DONE / named as not done:** no iPhone verification of anything; E2
exact-match links not buildable from SR data (product decision); the
pre-existing `styles.css` brace imbalance untouched; the flick window unchanged
pending one device reading from the owner.

**Next:** owner to check build **`1eae491`** — drag down from anywhere in the top
band of a tablå card, including on "Igår"/"Idag", and report whether a normal
short flick closes it.

## E2/E3/E4 UX pass — 2026-10-03

**Baseline:** `npm test` → **532/532** (run). **Now 541/541.**
**Scope:** E2 icons · E3 news chevron · E4 Info button + Tests page. Plus a
5-minute status report in chat, which the owner asked for and which was given
throughout.

**E2 MEASURED before/after** (driven DOM, then live): glyph 14px → **20px**;
the 26px round button with its tinted ring and fill **removed** (radius 0, no
border, no background); gap 6px → **14px**; `margin-left:auto` pins the pair to
the right edge. At a short AND a long title `offsetFromRightEdge` = **0**,
`grewBy` = **0**. Tap target 26×26 → **34×34**, so the thumb target got BIGGER
even though the visible box shrank — the padding is load-bearing and the CSS
says so.

**E3 MEASURED**, live, twice each direction: news → `expanded:true`, radio →
`expanded:false`, `allCorrect:true`. `playNews()` marks the track
`isNewsBroadcast:true`; `updateNewsFold()` exempts it BEFORE the auto-collapse.
Needed a marker because news and podcast episodes are both `kind:'episode'` —
guessing from kind would have folded podcasts, the one thing excluded.
**A debug handle was required**: SR's stream is CORS-blocked, so `playing` is
permanently false offline and a click-check reports "never folds" for BOTH kinds.

**E4 MEASURED**, live: cog and Info both 44×44, same tint `rgb(227,239,238)`,
same colour `rgb(0,80,78)`, `sameDesign:true`. Tests page: buttons y273–464
(5 controls), results y464–534 under a "Mätvärden" heading, all buttons on the
first screen, 1013 chars of results rendered, **prompt ids visible: none**,
copy button kept. Labels rewritten to actions; formula detail moved to a muted
hint so simplification does not delete what they measure.

**Test count:** 532 → 541. **SIX mutations. First pass: 4 red, 2 GREEN.**
Both greens were guards that could not fail:
- **M4** disabled the exemption with `false && isNewsBroadcast()`; the string is
  still present so a presence check passed. Guard now asserts branch BODIES.
- **M5** swapped the append order in the final `el(...)`; the guard read where
  blocks are BUILT, not APPENDED. Both asserted now.
**M6 then exposed a third: a heredoc-escaping bug in the guard's own scanner**
— `/'([^'\\n]*)'/g` matched a literal backslash-n and scanned **nothing**. Found
only because M6 was run rather than assumed. After fixes: **6/6 RED**.

**Four test-side faults during the work**, all mine, each reporting a defect
that did not exist: a wrong `region()` end marker (`updatePlayingMarks` is
BEFORE `updateNewsFold`); a 600-char window too small for the marker it looked
for; `grab()` given `'function NAME'` instead of a bare name; a block slice
ending inside the `el()` call.

**Deploy checks:** suite 541/541 **PASS** · remote `39d0e21` **PASS** · live
`app.e23e4764.js` + `styles.171d5438.css` 200 **PASS** · both served files
**byte-identical to local** (`e61994f3`, `12568d1c`) **PASS** · live DOM
re-verified: `sameDesign true`, `allCorrect true`, `grewBy 0`, buttons 273–464 /
results 464–534, `promptIdsInOutput false`.

**NOT DONE / named as not done:** no iPhone verification — every number above is
desktop Chromium, including how the 34px targets feel under a real thumb. The
E3 fold probe is a test-only handle, not user UI. E2 exact-match links remain a
product decision (unchanged). The flick window remains unchanged pending the
owner's reading.

**Next:** owner to check build `1b78db3` — open a podcast, expand the player,
check the icons; play a news item and confirm the chevron stays open; then play a
radio channel and confirm it folds as before; open Tests and read the page.
