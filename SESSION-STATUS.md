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
