# WS33-DEPLOY — build and push the timing fix. Your deploy bar is in this file.

**Read `AGENTS.md` first.** Note §7a (is the code reachable?), §8 (commit before
building), and §15 (the deploy bar).

**This brief OVERRIDES one standing rule.** `AGENTS.md` §13/§15 currently says the
tech lead deploys and the agent stops. **The owner has overridden that: you build
and push.** Do it in this brief. Everything else in `AGENTS.md` still applies —
especially §8, §15 and the reporting contract in §13.

---

## 0. Why this brief exists

`5da241e` is committed and the suite is green, but **it is not on the owner's
phone.** The live site still serves the WS32 bundle, whose timing panel is the
defective one. **The owner is currently looking at the broken instrument and does
not know it.** This brief exists to close that gap.

**Do not change any source.** Your task is build, verify, push. If you find a
defect while doing it, report it — do not fix it unasked, and do not rebuild a
second time to chase it.

---

## 1. Baseline first, by your own run

Run `npm test` and record your own counts. Do not copy a number from here.

Pre-build checksums for everything the build will rewrite (§8 — a build rewrites
tracked root artifacts, and a `git checkout --` afterwards has destroyed
uncommitted work three times in this repo):

```
md5sum app.js styles.css sw.js index.html > /tmp/ws33d-prebuild.md5
mkdir -p /tmp/ws33d-backup
cp app.js styles.css sw.js index.html /tmp/ws33d-backup/
```

Then confirm the tree is exactly as you left it:

```
git --no-pager status --short
git --no-pager log --oneline -2
```

**Expect** `5da241e` at `HEAD` and only doc files modified. If `app.js` or
anything under `tests/` shows as modified, **stop and report** — something moved
under you.

---

## 2. Build

```
npm run build
```

The build derives the build id from the commit, so it should produce
`5da241e`. **If it falls back to a timestamp instead, stop and report** — that
means the commit-derived path broke, and the owner cannot be told which build to
check.

**A note on the bundle hash:** it is content-derived, so **it will not** be
`fbdc9a4d`. That is expected and not a defect. Old hashed assets must be deleted
and `index.html` / `sw.js` must reference only the new one. Check for dangling
references to the old name anywhere in the tree.

---

## 3. The four deploy checks — report each individually as PASS or FAIL

**A check you did not run is reported as NOT RUN. Never as PASS.** Report them
one by one. A single "deployed successfully" is not a report.

1. **The suite is green and the count went UP.** Baseline was 256 before your
   WS33 change; you took it to 260. Confirm 260/260 on the committed tree.
2. **Read the whole diff yourself.** Name every file that changed. If anything
   outside `app.js`, `tests/`, the docs, and the build artifacts moved, **stop
   and ask** — an unreviewed drive-by is indistinguishable from a regression.
3. **Verify the SERVED artifact contains the fix** — this is the one that has
   bitten repeatedly:
   ```
   grep -c "deviceNow" app.<newhash>.js                          # expect > 0
   grep -c "offsetS = (deviceNow - trueEdge)" app.<newhash>.js   # expect 1
   grep -c "offsetS = (appEdge - trueEdge)" app.<newhash>.js    # expect 0
   ```
   **The old formula must be absent.** Also confirm `APP_BUILD = '5da241e'`
   inside the built file, and that the new `app.<newhash>.js` is what
   `index.html` loads.
4. **Nothing else moved.** Spot-check the neighbours: the 7 timing constants
   (`LIVE_EDGE_TOLERANCE_S=10`, `META_DIAG_READOUT_INTERVAL_MS=2000`,
   `NOW_PLAYING_INTERVAL_MS=45000`, `NOW_PLAYING_TIMELINE_MAX=60`,
   `SEEK_ARTWORK_DEBOUNCE_MS=400`, `SEEK_LIVE_MARGIN_S=1`,
   `SEEK_TRACKS_DEBOUNCE_MS=250`), `metaDiagGateOpen` (must still hash to
   `be2d044f40b3b74c4ed68c75229a3c25`), zero correction constants in **code**
   (strip comments first — a naive grep fires on prose), `styles.css` unchanged,
   and `seekToProgramTime` / `seekBy` / `seekToLive` / `playheadWallMs` /
   `dvrPositionToDate` byte-identical to `5da241e`.

---

## 4. Commit the artifacts, then push

```
git add -A
git commit -m "build: WS33 artifacts (app.<newhash>.js, sw minradio-<newhash>, build 5da241e)"
git push origin main
```

**Two commits, not one** — source+tests at `5da241e`, artifacts separately. That
is the established pattern and it keeps the source commit reviewable on its own.

---

## 5. Verify the push against the LIVE site

After pushing:

```
git ls-remote origin main                    # must be your artifact commit
curl -s --compressed https://danielomazarino.github.io/Min-SR-radio/ | grep -o 'app\.[0-9a-f]*\.js'
```

Then `curl` the asset from the raw host and confirm it serves **200 with the new
content**, and fetch the live `app.<newhash>.js` and re-run the three greps from
check 3 **against the live file**, not the local one.

**The propagation rule, precisely.** A 404 or a stale asset means
**propagating**, *not* failed — but only after **both** of these are confirmed:

1. `git ls-remote origin main` shows your commit, and
2. the asset serves **200 with the new content** from
   `raw.githubusercontent.com`.

**If either one fails, that is a genuinely failed deploy.** Do not tell the owner
it is "propagating" on the strength of one of them. This has been got wrong here
before. Re-check after a short wait if only the asset looks stale.

---

## 6. Tell the owner exactly what to check

Your report must state, in plain language:

- **The build id to look for is `5da241e`.** It is the small grey line under
  NYHETER on the main screen. **If it does not read `5da241e`, the owner is
  testing old code** and any result they give is void. This has silently
  invalidated a whole session's results before.
- **Fully close and reopen the app** if needed — a stale service worker will
  otherwise keep serving the old bundle.
- **What to read:** open the panel (cog → Info → the timing section) and report
  the number verbatim, including the `+`/`−` sign, the direction word
  (`före`/`efter`), and the `Mätt …` age line.
- **What each reading means.** At the live edge the number should be roughly
  **+25 s** — the owner's phone clock runs about 25 s ahead of the stream's
  clock, and that is what makes a programme skip land early. A reading near
  `±0 s` would mean the phone's clock is *not* the cause, and that is a real and
  useful answer.
- **A non-numeric state is a result, not a failure.** If it says `Direkt ljud —
  ingen strömklocka att jämföra med` or `Kunde inte läsa strömmens klocka`,
  report that verbatim; it means the panel could not measure, which is different
  from measuring zero.

**Never write "verified" for anything you proved offline.** The owner reading
the number on their own phone is the only thing that makes it device-verified.

---

## 7. Report — `SESSION-STATUS.md`, append-only

Append a block in the format from `AGENTS.md` §13. **Append; never rewrite an
earlier block.** The existing WS33 blocks are a dated record, including the
corrections in them.

Must contain: the four deploy checks **individually** (PASS / FAIL / NOT RUN),
the build's actual output hash, your baseline test count, what the live checks
returned, and a **NOT DONE** list naming everything you did not do — including
the offset still being unmeasured on the device, and the programme-skip fix still
being unwritten.

**Say plainly what deploying proves:** the right code is **served**. It says
nothing about how it **behaves**.

---

## 8. Acceptance criteria

| # | criterion |
|---|---|
| AC1 | `npm test` run by you, green, count unchanged at 260 |
| AC2 | pre-build checksums and backup taken **before** `npm run build` |
| AC3 | build produced a **commit-derived** build id (`5da241e`) |
| AC4 | all 4 deploy checks run and reported **individually** |
| AC5 | the **served** bundle contains the new formula and **not** the old one |
| AC6 | `metaDiagGateOpen` hash unchanged; 7 constants unchanged; **zero** correction constants in code |
| AC7 | seek functions byte-identical; `styles.css` unchanged |
| AC8 | artifacts committed in a **second** commit |
| AC9 | pushed, and `git ls-remote` confirms it |
| AC10 | live greps run **against the live file**, not the local one |
| AC11 | propagation rule applied with **both** conditions confirmed |
| AC12 | status block appended; NOT DONE list written |
| AC13 | the owner is told the build id and **what every reading means** |

---

## 9. The bar

**The owner is waiting for a fix on their phone, and right now they are looking
at a broken instrument without knowing it.** That is the whole reason for this
brief.

Two things are still true after a successful deploy, and must not be softened:

- **The programme-skip defect is NOT fixed by this deploy.** It ships a correct
  *measurement*, nothing more.
- **Nothing is device-verified until the owner reads the number themselves.**

And one thing you must not do: **do not fix anything you notice while building.**
The seek fix is a separate workstream, it is deliberately unwritten, and it
depends on the device reading this deploy enables. Report what you see; do not
act on it.