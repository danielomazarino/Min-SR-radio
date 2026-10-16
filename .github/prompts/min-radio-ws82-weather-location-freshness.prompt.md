---
description: WS82 — make the weather + location actually follow a move (fresh position on every automatic refresh), and make the chip a real button.
---

# WS82 — the weather header must follow the move, and the chip becomes a button

**This is a brief, not a summary. It is a contract.** Read `AGENTS.md` first —
especially §1 (the device is the only test rig), §2 (tests check shape, not
behaviour), §3 (one field, one writer), §7a (prove reachability), §13 (report at
the end) and §15 (the deploy bar).

The owner wrote this on 2026-10-16 and described two things. Only one of them is a
bug report; the other is a design request. Do both, in that order.

## The owner's words, verbatim — do not paraphrase or widen

> "the weather and location is not updating as it should every fifth minute. i
> went from gothenburg to askim tonight, and did get a new location even after
> restarting the phone. see if you can check why and look at my analyse with
> another agent below for advice on as well how to make the location for
> information a button as it looks to be today but with now weather and location
> refresh."

("did get a new location" is read as *did NOT get a new location* — the sentence
description, the rest of the report, and the measured behaviour all agree. Flag
it if there is any doubt; do not silently assume.)

The second half, the design request, in the owner's own attachment:

> "Render the weather UI node as an actual `<button type="button">` … instead of a
> plain div, and wire its click handler to `refreshWeatherNow()`. … Keep
> `markAskedForLocation` / permission handling as-is — use `refreshWeatherNow()`
> so the code will run the existing logic that records the asked flag and shows
> `explainNoLocation()` on failure. … Provide `aria-label`/`title` … Preserve the
> empty chip markup (`weather-empty` class) so people can tap when no cached
> reading exists."

---

## Part A — WHY the location does not follow the move (already measured; do not re-derive)

I reproduced the owner's journey by extracting the REAL weather functions from
`app.js` and running them against a controllable geolocation and clock. Positive
canary: 10 scenarios executed, and every one printed its geolocation-call count,
so a broken extractor could not have reported a confident "nothing happens".
These are **code/fixture-proven**, not device-verified.

**The cause.** Once the weather cache holds `lat`/`lon`, EVERY automatic refresh
re-reads those SAVED coordinates. Nothing obtains a fresh position:

- `refreshWeatherQuietly()` takes route 1 whenever the cache has coordinates —
  `refreshWeather({ lat: cached.lat, lon: cached.lon }, { force: true })` — and
  route 1 NEVER touches geolocation. This is the launch path, the
  `visibilitychange` path **and** the 5-minute `setInterval` path.
- `refreshWeatherNow()` (a tap) has the same shortcut: coordinates in the cache →
  `refreshWeather({ lat: held.lat, lon: held.lon }, { force: true })`, no
  geolocation.
- `startWeatherWatch()` — the ONLY thing that ever observes a fresh position — is
  started **only on a first-ever ask**, and `visibilitychange` calls
  `stopWeatherWatch()` the instant the tab is hidden. A normal session therefore
  has no watcher at all.

Measured, with the device actually moved and a `lat/lon` cache present:

| scenario | geolocation calls | coords used | chip |
|---|---|---|---|
| launch in a new place | **0** | the OLD saved coords | unchanged |
| relaunch (restart), 3 h-old cache | **0** | the OLD saved coords | "Göteborg" |
| 5-minute timer after the move | **0** | the OLD saved coords | "Göteborg" |
| tap, coords cached | **0** | the OLD saved coords | "Göteborg" |
| tap, WS45/46-era cache (place, NO coords) | 1 | fresh | correct |
| fresh install | 1 | fresh | correct |
| first-ever session, watcher running | follows, once the 5-min gate opens | fresh | correct |

So the WS48 saving shortcut — added so a tap would stop raising iOS's location
dialog — is exactly what froze the location. The header is refreshed (temperature
updates) from a position that no longer exists.

**Both of the owner's observations are this one cause:** "not updating every fifth
minute" (an update happens, but from the old coords) **and** "no new location
after restarting the phone" (a relaunch also uses the old coords).

**Do NOT re-derive this and do NOT "also fix" the note at `app.js` saying "a
journey therefore shows the previous city until the user taps the chip".** That
comment describes the WS47/48 trade; the fix below intentionally supersedes it —
update the comment to say so.

---

## Part B — the fix: one rule that makes BOTH the temperature and the location current

Keep WS46's guarantee intact: **never reach for location unless
`hasAskedForLocation()` is true**, so the app still cannot re-arm the prompt for a
user who has never asked. Everything below happens only inside that gate.

Establish ONE shared refresh rule and route every automatic path through it:

**When the app already holds a reading, obtain a FRESH position, and refresh when
either is true:**
1. the position has moved **≥ `WEATHER_MIN_MOVE_KM`** (3 km) from the last fetched
   position, **or**
2. the reading is older than **`WEATHER_REFRESH_MS`** (5 min) — the owner's stated
   cadence.

This single rule:
- makes a train/commute move re-fetch and re-geocode, so the chip follows
  Göteborg → Askim;
- keeps the owner's "every fifth minute" temperature cadence;
- preserves the WS45/47 anti-storm guards (distance + time), so a stationary phone
  still does not spend a request on a GPS wobble, and a 90-min ride is still
  bounded to a handful of calls.

Requirements, each of which you must PROVE (a source-text assertion is not proof —
see §7a):

1. **Prove REACHABILITY, not just presence.** Name the call site and prove it runs
   on the path the owner uses — the app boot, the `visibilitychange` handler, and
   the `setInterval`. The last two workstreams both shipped a fix that was correct
   and never executed (§7a). At minimum, drive the real functions and assert the
   geolocation call count is > 0 after a move, per path.
2. **The tap path (`refreshWeatherNow`) must also follow the move.** A tap is a
   fresh decision, so the saved-coordinate shortcut must not be the ONLY route:
   when the app already asked for location, the tap must consult a fresh position
   (bounded like the others). Do NOT reintroduce "a tap always prompts on iOS" —
   keep the cheap route when it is genuinely current, and take a fresh position
   when the reading is stale or the movement gate says so.
3. **One field, one writer** (§3). `lastFetched` is currently written from several
   paths with different `hasPos` semantics. Make sure a single rule decides
   "fresh enough", and that no path can leave `lastFetched` describing a position
   the chip is not showing.
4. **Keep the empty / no-reading behaviour** (WS46b): a chip always exists to tap,
   a failed refresh never blanks a good reading, and the empty state stays
   `weather-empty`.

---

## Part C — the chip becomes a real `<button>`

Change the chip element from `el('div', { class: 'weather' })` to a real button,
so it is a native control rather than a div with `role="button"`:

- `el('button', { class: 'weather', type: 'button', onclick: () => refreshWeatherNow() })`.
  `type="button"` is mandatory — without it a `<button>` inside a form defaults to
  `type="submit"`.
- **Preserve the existing accessible names.** Filled state: an `aria-label` naming
  the weather + temperature + place, and a `title`. Empty state (`weather-empty`):
  an `aria-label` and a `title` that explain the tap. Keep `weather-empty` on the
  element.
- The `keydown` / `tabindex` / `role` plumbing from WS46 becomes redundant on a
  native button. Remove the redundant attributes, but do NOT weaken the existing
  tests: **restate** each removed assertion to the new (stronger) fact — a real
  `<button>` — per §7b. Do not delete a test to get green.
- **CSS trap:** a `<button>` does NOT inherit `font-family` from its ancestors;
  it uses the UA default. `.weather` must gain `font-family: inherit` (and keep
  the existing sizing), or the header text changes font and size. Verify on the
  rendered DOM, not only in source.

---

## Acceptance criteria

**A1 — a move is picked up automatically.** Drive the real code: with a cache
holding `lat/lon` for place X and geolocation now returning place Y ≥ 3 km away,
the launch refresh, a `visibilitychange` refresh, and one 5-min-timer tick must
EACH make ≥ 1 geolocation call and end with the chip showing Y. Assert on the
chip's rendered text, not on source.

**A2 — the 5-minute cadence holds.** With the phone stationary, a refresh occurs
no more often than once per 5 minutes, and an unchanged reading does not repaint.
State the measured request count for a fixed-duration stationary run.

**A3 — a tap follows the move.** With `lat/lon` cached and geolocation moved, a tap
ends with the correct new place. With no saved coordinates, a tap behaves as it
does today.

**A4 — the no-re-prompt guarantee is unchanged.** With `hasAskedForLocation()`
false, NO automatic path and no background refresh reaches for location. This is
WS46's whole point; a regression here is worse than the bug being fixed.

**A5 — the chip is a real button** with a `type` attribute, a click that calls
`refreshWeatherNow()`, and an `aria-label`/`title` in BOTH the filled and empty
states. Measured on the DOM.

**A6 — nothing else moves.** `.topbar` still has exactly TWO flex children and the
cog is still last (the WS11/E4 invariant that was broken once). No new network
host is introduced (Open-Meteo + BigDataCloud only). The transport, the poll, and
the player are untouched.

---

## Test requirements (§2, §7b)

- The existing suite is **source-text**; it did not catch this bug because it never
  asked the behavioural question. Add at least one test that EXECUTES the real
  functions (extract them by brace-matching, as `tests/itunes-podcast.test.mjs`
  already does) and asserts the geolocation-call count and the resulting place.
- **Prove every new test can go red:** revert the fix, confirm red, restore by
  checksum. Report the red count.
- For any existing test you must change, classify it **SUPERSEDED** or **A REAL
  DEFECT** in the code comment, and state the reason. The tests that touch
  `el('div', { class: 'weather' })`, `role', 'button` and `tabindex', '0'` are
  SUPERSEDED by the native button — restate them at least as strongly.
- **The test count must go UP.** A green suite with an unchanged count means the
  new behaviour is untested.

---

## Method notes (from prior workstreams — do not relearn these)

- `AGENTS.md` §7: extract real functions; a `function` declaration passed to
  `new Function(...)` is never invoked. Your extractor must handle `async function`
  and `const f = () => {}`.
- If you build a browser harness, a `window.fetch` wrapper leaks across
  `page.goto` in the same tab; use a fresh page with ONE `addInitScript`.
- Desktop Chromium **cannot** load SR's DVR stream — that is unrelated here. The
  weather APIs are CORS-open and keyless, so this feature IS browser-testable.
  Report what you actually drove and what you did not.

---

## Deliverable: `SESSION-STATUS.md` (AGENTS.md §13)

Rewrite it at the start of this workstream and append a dated block per milestone,
in the required format. **Run `npm test` yourself and put the real counts in the
baseline line** — never copy a number from this brief or the log.

## Deploy

The owner's standing instruction (2026-09-30) is to deploy when it is "not
crappy". **Push when all of these hold:** the suite is green and the count went
UP; you have read your own whole diff; you have driven the change in the browser
and asserted on the rendered DOM; nothing outside the weather module moved; the
built hashed bundle really contains the change (`grep` it, not the source). Run
the four deploy checks individually — PASS or FAIL each — and remember a 404 on a
fresh push means *propagating*, only after `git ls-remote` shows the commit and
the raw host serves the asset 200.

## Report back (AGENTS.md §9) — the owner is non-technical and uses an iPhone

Separate **CODE CHANGE** (file + function, and the files you did NOT touch) /
**MEASURED** (the number, how obtained, and what it does NOT prove) / **NOT DONE**.

Tell the owner **which build to check and where they now read the build id**:
open the app, tap the **info** button on the main screen, and read the
`about-version` line at the bottom of the overlay (`<build> · Utvecklad av …`).
The build id is no longer under NYHETER (WS80 moved it). Then the check they can
run on the phone: ride with the app open and see the city change, or tap the
weather chip.