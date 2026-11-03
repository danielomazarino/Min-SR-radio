# WS83 — remember the stop location of episodes, and offer to resume

**Read `AGENTS.md` first**, especially §2 (tests check shape, not behaviour),
§3 (one field, one writer), §7a (is the new code reachable?), §7b (classify
failing tests before touching them), §8 (commit discipline) and §12 (the
specification).

**This brief DOES authorise a push**, conditional on the §15 deploy bar: every
check run individually and reported PASS/FAIL. If any check fails, stop and
report — do not deploy.

---

## 0. The owner's requirement, in the owner's words

> "when a play of a program or podcast is stopped, look for a solution where
> this timestamp is remembered for future restart as the stop location"

**The owner made two decisions for this workstream (2026-11-03):**

1. **Restart behaviour: ASK.** When an episode that has a remembered position
   is started again, the app must offer a choice — resume from the stop
   location, or start from the beginning. It must NOT silently auto-resume.
2. **Scope: SR podcasts, iTunes podcasts, and schedule episodes.** Live radio
   is excluded (live is live — there is no stop location). News clips are
   excluded (short, listened in one go).

## 1. What the investigation already established (do not re-derive)

- **Pause already works in place.** `toggleTrack()` pauses the live audio
  element; resume continues from the same position with no persistence
  involved. This workstream is about **stop** and **app close**, not pause.
- **Stop loses the position.** `stopAndClosePlayer()` tears down the audio
  element, clears `state.current`, and nothing records `audioEl.currentTime`.
- **App close loses the position.** The `pagehide` handler (persisted=false)
  and the `freeze` handler pause audio but record nothing.
- **All episode plays converge on `playTrack()`** with `kind: 'episode'` and a
  stable episode `id`, from four call sites:
  - `playPodcast()` — SR podcast, latest episode
  - `playExternalPodcast()` — iTunes podcast
  - the schedule card row (`episodes/get?id=…`)
  - the podcast episode card (`episodes/index`)
  A single hook at the convergence point covers all four. Do NOT add four
  separate save/restore paths.
- **News must be excluded by flag, not by id arithmetic:** news plays as
  `{ kind: 'episode', id: -1, isNewsBroadcast: true }`. Gate on
  `isNewsBroadcast` (and on a real positive episode id) so news can never
  create or read a saved position.
- **Existing persistence pattern to copy:** favourites use
  `minradio.favorites.v1` in localStorage with try/catch around every read and
  write (private mode throws). Follow the same shape:
  `minradio.playback-positions.v1`.

## 2. Design constraints

- **One field, one writer (§3).** The saved position is a NEW store. Nothing
  existing writes it; nothing existing reads it. Do not hang it off
  `nowPlaying`, `state.current`, or any existing field.
- **Key by episode id, with the iTunes id space namespaced.** SR episode ids
  are small integers; iTunes collection/episode ids are large. Use the same
  prefixing idea as `extGuardKey()` (e.g. `itunes:<id>`) so an id can never
  resolve against the wrong catalogue.
- **What to store per entry:** episode id (namespaced key), audioUrl, position
  in seconds, duration if known, title (for the prompt text), savedAt.
- **When to save:**
  - on `pause` (the pause event, not the button — earbuds and lock screen
    pause too),
  - in `stopAndClosePlayer()` before the teardown,
  - in the `pagehide` (persisted=false) and `freeze` handlers,
  - throttled during playback (e.g. at most every 15 s on `timeupdate`) so a
    crash or swipe-away still remembers approximately.
  Saving must never throw and never break playback: wrap in try/catch.
- **When to offer resume:** on a new play of an episode whose saved position is
  meaningful — more than ~30 s in AND more than ~30 s remaining (a near-end
  position counts as finished: delete the entry and start from the top
  silently). The thresholds are heuristics, not measurements — name them as
  such in a comment; do not present them as tuned constants.
- **Retention:** expire entries after ~30 days; cap the store (e.g. 50
  entries, oldest evicted). Both are heuristics — comment them as such.
- **The resume seek must be reachable (§7a).** `audioEl.currentTime` cannot be
  set before the media is loaded. The seek must happen on/after
  `loadedmetadata` (or the HLS equivalent), on the path the owner actually
  uses: tap episode → prompt → choose resume → audio starts at the saved
  position. Name the event that carries the seek and prove it fires before you
  call the feature done.
- **The prompt must not fight the existing player UI.** It is a sheet in the
  existing `sheet` style (see the sleep-timer sheet for the pattern). While it
  is open, nothing else may start playback; both choices close it and proceed.
- **Do not touch** the R1–R6 metadata surfaces, the seek/edge logic, the
  watchdog, or the news sequence. If you find yourself editing those, stop and
  re-read the brief.

## 3. Acceptance criteria and the evidence bar

1. **Behaviour tests, not shape tests (§2).** Assert on rendered DOM/state in
   driven tests: the prompt appears with the formatted time; "resume" starts
   at the saved position; "start over" starts at 0; stop → replay shows the
   prompt; a near-end position does not; news never prompts; a second episode
   does not inherit the first's position. Use the existing driven-test seams
   (`window.__sr*` handles, `?diag=metadata` gating) where they fit.
2. **Prove each new test can go red** (revert the change, confirm red, restore
   by checksum, report NO-OP as a hard failure).
3. **Reachability proof (§7a):** name the call site and the event that applies
   the resume seek, and show in a driven test that choosing "resume" results
   in the audio element's position at/near the saved value after metadata
   loads — not merely that the sheet opened.
4. **Suite green, test count UP.** If any existing test fails, classify it per
   §7b before touching it. A rename-classified failure must be restated to
   assert the new property at least as strongly.
5. **Browser check (§14):** drive the built app in the built-in browser —
   play an episode (any fixture/local audio is fine; SR streams are
   CORS-blocked on desktop), stop it, replay it, assert the prompt and the
   resumed position on the rendered DOM. Say exactly what the run did and did
   not cover. Desktop cannot verify the real SR stream; that part stays
   device-verification for the owner.
6. **§15 deploy bar, each check reported individually:** suite green and count
   up; whole diff read and named; driven browser check; the original defect
   (position lost on stop/close) actually fixed; neighbours unmoved; built
   bundle greps for the new code. Then build → commit artifacts → push → the
   four deploy checks against the live site, with the propagation rule.
7. **SESSION-STATUS.md:** rewrite for WS83 at the start (it holds one
   workstream), then append dated blocks per milestone in the required format,
   with the baseline number actually run.

## 4. Commit discipline (§8)

- Source + tests in ONE commit. Build artifacts in a SECOND commit. Commit
  BEFORE building; never `git checkout --` a file with uncommitted edits.
- Report format per §9: CODE CHANGE (files and functions, including files you
  did NOT touch that a reader might assume), MEASURED (device / fixture /
  code evidence, and what each does not prove), NOT DONE (named as such).
- End by telling the owner which build id to check on the iPhone, and that the
  device-only part (real SR episode resume) is theirs to verify.
