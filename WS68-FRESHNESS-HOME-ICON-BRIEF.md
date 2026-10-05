# WS68 — Move the freshness-card button to the home screen

## Owner requirement

Put the freshness/flash button on the **home screen**, in the heading row for
**“Poddar”**, with its horizontal position aligned to the cog-wheel button in
the top bar. The owner clarified this placement on 2026-10-05.

The current shipped JavaScript does contain `freshBtn`, `fresh-btn`, and
`openFreshnessCard`, but the button is created inside `openSheet()` and appended
to the settings sheet's Kanaler/Poddar tab row. That is the wrong surface. Do
not add another copy to settings or treat the current bundle's symbol presence
as satisfying the requirement.

The owner found it in settings and reported that its mark looks like “a strange
vertical thin line,” not a Fluent flash. Browser DOM inspection of the deployed
button supports that report: `.fresh-btn-icon` measured only **3.5px wide by
18px high**, and its only child `.fresh-bars` measured **3.5px wide by 38px
high**. The shipped mark is three narrow rising bars, not a flash/bolt glyph.
Replace it with a recognizable lightning/flash glyph, preferably a compact
inline SVG sized around 20–22px within the existing 44×44 button. Keep it
`aria-hidden="true"`; the button keeps its accessible name.

## Implementation boundary

Move/reuse the existing freshness-card button and its `openFreshnessCard()`
handler in the home screen's “Poddar” section-heading row. The existing home
rendering is in `renderHome()` (`buildIconSection()`); the current button is
created in `openSheet()`. Keep the freshness card, its content, fetch behavior,
and row interactions unchanged unless a directly related defect is proven.

The visual target: a recognizable flash/bolt mark in dark green (`--accent`),
no lighter-green circular background, and a 44px touch target. Align the button
to the cog by rendered layout geometry (same horizontal center), not by a
hard-coded pixel offset. Keep the “Poddar” heading and button in one semantic
row and preserve mobile-width behavior. Do not change the home top bar, cog,
info button, news section, player, polling, schedule, or DVR behavior.

## Baseline test classification

The baseline run was **589/594 passing, 5 failing**. The failures were:

- `WS47: returning to the foreground must not ask for location` — source-region
  start marker not found.
- `snapshot: listener accounting is present, per type, add and remove` — exact
  source-string assertion for the `timeupdate` listener count fails.
- `WS5b Item 1: the header, the pills and the song line share ONE left edge` —
  CSS-region start marker not found.
- `WS11 Part A: the seek row has EXACTLY two children, so the slider is whole`
  — exact source-string assertion fails.
- `WS59: clearing our session is recorded, so a vanished card is provable` —
  no-track branch matcher fails.

All five were **Windows CRLF test-fixture defects**, not application defects:
the failing test files read `app.js` and `styles.css` without normalizing line
endings, then searched for LF-only source anchors. Normalize fixture text to LF
in the affected tests; preserve every assertion's original user-visible
property. The test command also used a shell wildcard that PowerShell did not
expand, so `npm test` failed to find the files on Windows; use Node's
cross-platform test discovery instead.

## Acceptance criteria and evidence

1. On the rendered home screen, the “Poddar” heading and freshness button are
   present in the same section-heading row. The button is not confined to the
   settings sheet.
2. In the built-in browser at a narrow/mobile viewport, measure the button's
   rendered bounding box against the cog's: their horizontal centers align.
   Inspect the icon's rendered bounds to ensure it is visibly a lightning/flash
   glyph (not a 3.5px-wide line or activity bars); the button has an accessible
   name and a 44px touch target.
3. Click the home-screen flash button in the browser. Assert on the rendered
   DOM that the “Podcastuppdatering” card opens. Do not substitute source-text
   assertions for this browser interaction.
4. Confirm the existing settings-sheet tab row no longer contains a duplicate
   freshness button and that ordinary Poddar icon tap/long-press behavior is
   unchanged.
5. Add a regression test that can fail if the home button is removed, misplaced,
   or disconnected from the card. State what visible failure it catches and
   demonstrate that the test goes red when the new wiring is removed.
6. The complete suite is green and its test count is higher than the baseline.
   Report every pre-existing failure classification and the before/after count.
7. Review the entire diff and check nearby home rendering, top-bar alignment,
   settings tabs, and card behavior. Build only after the source-and-test
   commit; confirm the hashed production bundle contains the change and is
   byte-identical after Git checkout.
8. Hashed bundles must be protected from Git's automatic line-ending rewriting
   so their content hashes remain true on both Windows and Linux. `.gitattributes`
   should set `-text` on `app.*.js` and `styles.*.css`, and a regression test
   should check that policy. The first live pass exposed this issue: the Windows
   working copy had CRLF bytes but the pushed Git blob had LF bytes, despite the
   asset returning HTTP 200 and containing the right code.

## Commit and deployment ownership

The owner directly authorized implementation and deployment in the current
session so they can learn the sync process. Commit source, tests, and the
cross-platform test-runner fix together first; then build and commit generated
artifacts separately. **Push only if every deployment check passes.** Report
each repository deployment check individually as PASS or FAIL; do not deploy
from a red suite or silently work around a failed check.

When handing back, name the deployed build ID shown under NYHETER and state
plainly that browser evidence is not iPhone device verification. Do not claim
device verification; the owner can check the deployed build on the iPhone.
