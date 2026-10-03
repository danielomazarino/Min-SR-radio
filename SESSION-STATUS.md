# SESSION-STATUS

## Third pass — four owner corrections — 2026-10-04

**Baseline:** 547/547. **Now:** **550/550** (run, not quoted).
**Shipped:** `f557861` = `origin/main`. Live bundle `app.9b33fc01.js` /
`styles.671eb90d.css`, confirmed served and matching the local build.

**THE MOST IMPORTANT EVENT OF THIS PASS was a correction I received, not a fix
I made.** The owner asked whether the item-4 change was a regression of WS27.
It was — I had deleted `hit || (atLiveEdge ? nowPlaying.song : null)`, which is
exactly what WS27 (`c016cdb`) put in on 29 Sep. The fallback is deliberate: it is
what stops the panel going blank during talk, when SR sends no per-song times.

So the regression was reverted and the real cause fixed instead:
`song = hit || (atLiveEdge && onAirStillCurrent ? onAirNow : null)`.

**MEASURED, and the guard is a real check:** the poll's song now only wins while
`Date.now()` is inside that song's own `[startMs, stopMs)` window. A song that
has ended can never be shown, which was the owner's symptom. The WS27
empty-timeline fallback is preserved, so the panel still does not blank.

**M17** reverts to the unguarded fallback -> 2 failures. Checksum byte-identical
after restore.

**The other three:**
1. Info page band: measured live at **330 px = exactly half of the 659 px
   viewport** (owner asked for "half the size of the screen"). Pill margin
   unified to one rule so the two surfaces align; Info band padding aligned to
   the sheet's (11px -> 15px, measured).
2. The programme button is a **real dropdown** — it previously cycled silently on
   each tap, which is what the owner reported. Fixing it required a real bug
   fix: `stopPropagation` does not stop the document-level dismiss listener
   firing in the same tap, so the list opened and closed at once. Measured live.
3. Verified only — owner confirmed.

**NOT PROVEN — the important caveat.** Desktop Chromium cannot load SR's DVR
stream, so **item 4 has never been observed on a real seek back and return to
live.** The guard is code-proven and mutation-tested; the behaviour is not
device-verified. Same for the half-screen drag area.

**Deploy checks:** suite green + count up PASS · diff read, nothing outside scope
PASS · live DOM driven PASS · item 4 checked against the owner's words PASS ·
neighbours spot-checked PASS · hashed bundles grepped PASS · propagation
confirmed PASS.

**Blocked:** nothing.

**Next:** owner checks build **`f557861`** on the iPhone (small line under
NYHETER), and specifically: seek back behind live, then press Till Direkt, and
confirm the panel does NOT show the finished song.
