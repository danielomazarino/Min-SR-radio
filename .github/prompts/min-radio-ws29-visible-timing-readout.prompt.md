# WS29 — a visible timing readout, so the offset can finally be measured

**Priority 2 of the queue. The owner has APPROVED this UI change (2026-09-30).**

> **SEND THIS WHOLE FILE to the separate "space bunny" coding-agent chat.**
> The tech lead does not dispatch the agent and does not build or push — see
> `AGENTS.md` §13a.

---

## 0. Why this workstream exists, in one paragraph

The owner has reported the same defect three times across three sessions:
**a programme skip lands about 25 seconds too early** on a channel with hourly
news, and **row 4's song title appears 10–15 seconds early**. The cause has never
been established. The measurement that would establish it
(`seek.streamEdge.edgeMinusNowS`) **already exists in the app** — WS23 built it —
but **the owner cannot reach it**, so it has never been read on a device.

**Two independent blockers, and this brief removes both:**

1. **The gate.** `metaDiagGateOpen()` — `function metaDiagGateOpen()` needs
   `localStorage['sr-meta-diag'] === 'on'` **AND `diag=metadata` in the URL**,
   and **nothing in the app ever writes that flag** — it is read, never set.
   **The URL half is why the panel alone cannot work — read §1a, it is the most
   important section in this brief.**
2. **The output.** `srMetaDiagSnapshot()` writes to `console.log` and
   `localStorage['sr-diag-log']` — `const diagLog = (msg) => {` and `window.srMetaDiag = srMetaDiagSnapshot;`. **Neither is
   visible on a phone.**

**Everything downstream is blocked on this.** WS28 cannot start until this
exists. That ordering dependency is the whole reason this workstream is separate.

---

## 1. What to build

**A small, deliberately hidden panel in the existing Info sheet that shows the
timing number as text on screen.**

### Where exactly

**Find every one of these by its TEXT, not by line number** — your own edits will
shift the line numbers, and a line number that has drifted is worse than none.

| what | how to find it |
|---|---|
| the About overlay | the function `openAbout()`, whose first line contains `'aria-label': 'Om appen'` (on the same line as `class: 'reader-overlay'` and `role: 'dialog'`) |
| how the sheet is reached | the button built as `class: 'sheet-action sheet-action-info'` with `onclick: openAbout` and `text: 'Info'` |
| **insertion point** | immediately after the `about-list` holding the last bullet, *"… är oberoende av och inte utgiven av Sveriges Radio."*, and **before** the line `about.appendChild(body);` |
| the existing sections to sit under | the headings `'Så fungerar appen'`, `'Att veta'`, `'Hur appen är byggd (för den nyfikne)'`, `'Datakällor & villkor'` |
| the gate — leave alone | `function metaDiagGateOpen()` |
| the snapshot to reuse | `window.srMetaDiag = srMetaDiagSnapshot;` |
| the existing debug handle | `window.__srSeekable = () => {` |
| the log sink (the problem) | `const diagLog = (msg) => {` — writes to `console.log` and `localStorage['sr-diag-log']` |

**⚙️ cog is `edit-btn` in `index.html`.** And note: **there is no word "Om" on
screen** — it is an `aria-label` for screen readers only. The visible button says
**Info**. Do not tell the owner to look for "Om".

### What it must do

- **A switch that turns the readout on and off**, labelled in Swedish, in the
  same plain style as the sheet's other controls. Turning it on sets
  `localStorage['sr-meta-diag'] = 'on'`; turning it off sets it to `'off'`.
  **Read the existing value on open, so the switch reflects reality** rather
  than assuming a default.
  - **Setting this flag is NECESSARY BUT NOT SUFFICIENT** — the gate also wants
    the URL. See §1a before you write a line of this.
- **The number rendered as visible text in the DOM.** This is the entire point.
  The owner must be able to read it and photograph it.
- **Refresh the reading while the sheet is open**, on an interval, and once
  immediately on open. Say in the UI what it is: the app's idea of where the live
  stream ends, compared with the real clock. A bare number with no explanation
  will be misread, and a misread number is worse than none.
- **Show it as a whole number of seconds, signed** (`+27 s` / `-4 s`), with a
  plain Swedish label. One line. Not JSON.

### What it must NOT do

- **Do not modify `metaDiagGateOpen()` or weaken the two-key gate.** A query
  string travels in links, screenshots and bug reports, so it must never be
  sufficient on its own. The function stays exactly as it is, and case D below
  must keep returning nothing.
- **Do not change any playback, transport, or scheduling behaviour.** This is a
  read-only display. `AGENTS.md` §3: one field, one writer — this adds a reader,
  not a writer.
- **Do not poll when switched off**, and do not leave a timer running after the
  sheet closes. A hidden panel that keeps working is a battery bug, and the
  existing code has a note about timers outliving their sheet.
- **Do not add the flag to a URL, a share link, or anywhere a screenshot could
  carry it.**

### Graceful degradation — this is a real requirement, not a nicety

> ### §1a — THE PANEL CANNOT OPEN THE GATE. Read this before writing anything.
>
> `metaDiagGateOpen()` needs **two** keys: the URL query **and** the flag.
> **MEASURED in Chromium against the live site, 2026-09-30:**
>
> | case | URL | flag | `gateOpen` |
> |---|---|---|---|
> | **flag only, no query — what §2 tells the owner to do** | `/` | `on` | **`false`** |
> | flag + query | `?diag=metadata` | `on` | `true` |
> | flag `off` + query | `?diag=metadata` | `off` | `false` |
> | query only, no flag (a shared link) | `?diag=metadata` | absent | `false` |
>
> **So the brief as first written would build a panel, flip a switch, and show
> "no data" — and that "no data" would be very easy to report as the
> measurement.** Do not ship that. Do not report "no data" as a reading.
>
> **The gate is a good design and must not be weakened.** Its own comment says
> the query parameter "travels in links, screenshots, bug reports and browser
> history, so it must never be sufficient" — the property being protected is
> *a stray artefact must not silently enable diagnostics*. An explicit switch
> inside a settings sheet is precisely the **deliberate action** that comment
> asks for; it is the gate asking the wrong question ("are both keys present?")
> rather than the switch being insufficient.
>
> **The owner has NOT yet chosen between these. Do not pick one yourself:**
>
> 1. **RECOMMENDED — the panel reads the edge itself**, via its own small,
>    read-only helper, and `metaDiagGateOpen()` is left **completely untouched**.
>    The switch's flag stays as it is; the panel simply does not require the URL
>    half. Weakening of existing gates: **none**.
> 2. The switch **also navigates** to `?diag=metadata`. Works, but it puts the
>    marker in the URL, which this brief otherwise forbids.
> 3. Drop the URL half of the gate. **Weakest**, and ruled out by this brief's
>    own reasoning.
>
> **Whichever is chosen: it is an owner decision, it must be recorded, and the
> reasoning must be written next to `metaDiagGateOpen()`** so a later session
> does not "fix" the divergence. If the owner has not answered, **stop and say
> so in `SESSION-STATUS.md`** — do not implement option 1 and call it decided.

`edgeMinusNowS` is derived from `seekableEnd`, which **only exists while a live
radio stream is playing.** On a talk channel, before playback starts, and on
podcasts it will be `null` or absent.

**The panel must say so in plain Swedish** ("Starta en radiokanal först" or
similar) rather than showing `null`, `undefined`, an empty box, or a misleading
`0`. **A panel that displays `0 s` when it means "no data" is worse than no
panel**, and it would send the next session chasing a zero offset that does not
exist.

### Where the number comes from — READ THIS, IT IS THE CRITICAL PART

**The panel must NOT go through `metaDiagGateOpen()`. It cannot work, and here is
the measured proof** (coding agent, 2026-09-30, confirmed independently by the
tech lead in Chromium against the live site — all four cases reproduced):

| case | URL | flag | `gateOpen` | snapshot |
|---|---|---|---|---|
| **A** — **flag on, normal URL = what §2 tells the owner to do** | `/` | `on` | **`false`** | **`null`** |
| B — flag + query | `?diag=metadata` | `on` | `true` | object |
| C — flag `off` + query | `?diag=metadata` | `off` | `false` | `null` |
| D — shared link, no flag | `?diag=metadata` | absent | `false`** | `null` |

**Case A is the whole problem.** The owner opens the app normally, with no query
string, so the gate stays shut, the panel shows "no data", and the reading is
worthless. A panel that is built this way looks like it works and measures
nothing.

**THE REQUIRED SHAPE — a second, explicit read path, and the gate is untouched:**

- Extract the snapshot **body** into a function that takes no gate check, e.g.
  `buildMetaDiagSnapshot()`, and let `srMetaDiagSnapshot()` call it **only after**
  `metaDiagGateOpen()` returns true. **That ordering is the whole protection** and
  it must be preserved: nothing may reach the body without passing the gate.
- The panel calls the **body function directly**, and only when its own switch is
  on. The switch is the deliberate action; the query string is not needed and is
  not asked for.
- **`metaDiagGateOpen()` is not edited, not bypassed for anyone else, and not
  removed.** Cases B, C and D must behave exactly as they do today.
- **Write the reasoning next to the gate**, in a comment, so a later session does
  not "fix" the divergence by deleting the flag. State: *the gate exists to stop a
  stray link or screenshot silently enabling diagnostics; the panel exists because
  the owner must be able to read a number deliberately, and a switch inside a
  settings sheet is precisely the deliberate action the gate's own comment asks
  for.*

**This was an owner decision, taken 2026-09-30.** The alternatives were rejected:
having the switch also navigate to `?diag=metadata` (puts a diagnostics flag in a
URL), and dropping the URL half of the gate (a shared link could then enable
diagnostics). **Do not "improve" on this by taking one of those instead.**

**Reuse, do not re-implement:** the edge calculation itself lives in
`streamEdgeWallMs()`. **Call it — never write a second version of it.** Same for
the snapshot body. A second copy of the edge calculation is a second place for
the number to be wrong, and this number is the instrument everything else depends
on.

**`window.__srSeekable()` already exists as a debug handle** and is unchanged.
Use it if it is the cleaner route; do not add a second debug handle.

## 2. The owner's instructions, verbatim in substance

Say this to the owner when you hand back. **Keep it short — they need to read one
number, not understand anything.**

> 1. Open Min Radio and start a **radio channel that has hourly news** — the
>    news is easy to recognise by ear, so you'll know exactly when it starts.
> 2. Tap the **programme-skip** button once (the ⏮ / ⏭ next to the play button).
> 3. Open the ⚙️ cog → **Info** → scroll to the bottom → turn on **Visa
>    tidsdiagnostik**.
>    *(Only send these instructions to the owner **after** §1a is resolved and
>    the panel is built and deployed. Before that, step 3 produces "no data"
>    and the reading is void.)*
> 4. Read the line that says how many seconds the app thinks the stream is
>    behind. **Write that number down, or photograph the screen.**

**They must also confirm the build id** under NYHETER, and report it. Without it
a reading cannot be attributed to a build, and that has voided a session before.

---

## 3. Then — and only then — interpret the reading

Write the number, the channel, the build id and the timestamp into
`SESSION-STATUS.md`, then interpret it. **Do not adjust anything to make it fit a
theory.**

| reading | meaning | next |
|---|---|---|
| **large positive** (tens of seconds) | the app believes the buffered edge is well behind the real present, so every position it computes is early | investigate `seekToProgramTime`'s `end` and `playheadWallMs` — **no constant** |
| **≈ 0** | the app's edge is accurate; the offset is in the **schedule's own times** or where SR places the boundary | investigate the schedule path and `clampedByS` |
| **negative** | the app believes it is *ahead* of the present | report it plainly; it contradicts the "early" symptom — **do not force it** |
| **absent / "start a channel first"** | no stream playing; not a finding | ask the owner to retry with a channel running |
| **inconsistent between presses** | the edge is re-registering around the seek | compare `before` and `after` |

**Also record `clampedByS`.** If it is not ~0, **the browser clamped the seek**
and the offset is not in the app's arithmetic at all — invisible from outside,
and it looks exactly like a wrong offset.

**And state which two quantities you compared.** The PDT-derived edge from the
CDN is a *playlist* end; `seekableEnd` is a *buffered* end, and Safari's buffered
range lags the playlist. **They are not known to be the same quantity.** Do not
present a difference between them as "the offset" without saying so.

---

## 4. What you must not do

- **No correction constant. No margin. No fudge factor.** There is currently
  **no** such constant in the code and a test **rejects one by name**.
  > **CORRECTION — the earlier version of this brief named the wrong file.** The
  > guard is in **`tests/metadata-diag.test.mjs`** (line ~3815), **not**
  > `tests/fixpass.test.mjs`, which has no such guard. Verified by
  > `grep -rn STREAM_EDGE_CORRECTION tests/` → exactly one hit, in
  > `metadata-diag.test.mjs`:
  > ```js
  > assert.ok(!/STREAM_EDGE_CORRECTION|EDGE_CORRECTION_S|SEEK_CORRECTION/.test(APP_JS), …)
  > ```
  > **Keep that one green.** Do not add a duplicate guard in `fixpass.test.mjs`
  > — two guards look like protection and one of them would test nothing.
  The readings across sessions are ~10 s, then ~30 s, then ~25 s, on different
  programmes. **The owner has said explicitly the programme-skip offset and the
  song-title offset are not the same offset.** A constant fitted to any one
  reading is wrong for the others. **If a constant seems to be the only answer,
  that is the signal the real cause has not been found — report that instead.**
- **Do not "fix" the ~25 s.** The measurement comes first. This workstream ships
  the instrument, not the cure.
- **Do not touch** `NOW_PLAYING_INTERVAL_MS`, `NOW_PLAYING_TIMELINE_MAX`,
  `LIVE_EDGE_TOLERANCE_S`, `SEEK_LIVE_MARGIN_S`, `SEEK_ARTWORK_DEBOUNCE_MS`,
  `SEEK_TRACKS_DEBOUNCE_MS`, WS27's one-song rule in `resolvePlayheadMeta()`,
  the `Spelas just nu` label (**owner's decision: leave it**), or anything in
  the WS23 `seekableEnd` assumption sites.
- **Do not correct the the comment above the DATERANGE note in the episode-track area DATERANGE comment in this workstream.** It
  is a false technical claim — measured 2026-09-30, SR publishes
  `#EXT-X-PROGRAM-DATE-TIME`, not `EXT-X-DATERANGE` — and it is wrong. But it
  belongs with the timing work that uses it, not smuggled in here. Note it in
  `SESSION-STATUS.md`; do not edit it.
- **Do not build, do not push.** §9.

---

## 5. Testing

**Browser-first, and this workstream is unusually well suited to it.** The panel
is DOM. Load the app in Chromium with the built-in browser, drive the switch, and
assert on the **rendered text** — not on source.

Cover at minimum:

1. **The switch reflects stored state on open** (on → on, off → off, absent → a
   defined default). Not "the click sets it" — "the panel tells the truth about
   what is stored."
2. **The graceful-degradation case renders a Swedish message, not `null`/`0`/`undefined`.**
   **This is the one that matters most**, because a panel showing `0 s` when it
   means "no data" would send the next session chasing a zero offset.
3. **No timer runs when the switch is off, and none survives the sheet closing.**
4. **The gate is intact — all four cases, driven.** Assert case B (flag + query)
   returns a snapshot, and that **C** (flag `off`) and **D** (query, no flag) both
   return `null`. **Case D is the one that matters: it is the shared-link case
   the gate exists to stop.** If D ever returns a snapshot, the gate has been
   broken.
5. **The panel reads without the gate.** With the switch on and **no query
   string**, the panel must render a number (or the plain "start a channel first"
   message). **This is the regression test for the defect that made this brief
   unbuildable** — without it, the same mistake can be reintroduced silently.
   **This test must survive whichever §1a option is chosen.** If the owner picks
   option 1, the gate keeps its exact current behaviour and the *panel* has a
   separate read path — that separation is the thing to assert, so a later
   session cannot quietly widen the panel's path into everything.
5. **The panel is read-only** — assert that no state field is written by it.

Any test that reads source text where a rendered-DOM assertion is possible is the
wrong test here (`AGENTS.md` §2). Where you do drive behaviour, extract the real
functions by brace matching and execute them; **never re-type the logic under
test.**

**Prove each test can go red** — revert, confirm red, restore by checksum, and
report the checksums. A test only ever seen green is not evidence.

---

## 6. Status reporting — MANDATORY, and it has slipped once

Write to `SESSION-STATUS.md` throughout (`AGENTS.md` §13).

- **at the start** (a baseline you actually ran — never a copied number),
- **after every test run, every decision, every file edit**,
- **at least every 5 minutes** even if nothing changed: `no change, currently: <what>`,
- **at the end**.

Append-only within the workstream. A correction must name what the earlier claim
was.

**It has slipped: an earlier WS28 pass did investigation and reported only in
chat, so its reasoning could not be audited and had to be re-derived. Do not
repeat that.**

---

## 7. Commit and STOP

- **Source and its tests in ONE commit**, plain-English message.
- **Do not run `npm run build`. Do not push**, to any branch. The owner reviews,
  and build and push are separate steps.
- Leave the tree clean. Report the commit id.

## 8. Final report

**CODE CHANGE** (file + function, and what you did **not** touch) /
**MEASURED** (number, how obtained, **what it does not prove** — distinguish
browser / fixture / code evidence) / **NOT DONE** (named as not done) /
**what still needs the owner's iPhone**, and the **exact user instructions** from
§2, reproduced verbatim so the tech lead can hand them to the owner unchanged.
