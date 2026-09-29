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

1. **The gate.** `metaDiagGateOpen()` (`app.js:5595`) needs
   `localStorage['sr-meta-diag'] === 'on'`, and **nothing in the app ever writes
   that flag** — it is read, never set.
2. **The output.** `srMetaDiagSnapshot()` writes to `console.log` and
   `localStorage['sr-diag-log']` (`app.js:375`, `app.js:6007`). **Neither is
   visible on a phone.**

**Everything downstream is blocked on this.** WS28 cannot start until this
exists. That ordering dependency is the whole reason this workstream is separate.

---

## 1. What to build

**A small, deliberately hidden panel in the existing Info sheet that shows the
timing number as text on screen.**

### Where exactly

- `openAbout()` — `app.js:4886`. The overlay is
  `el('div', { class: 'reader-overlay', role: 'dialog', 'aria-label': 'Om appen' })`.
- The sheet is reached: **⚙️ cog** (`edit-btn`, `index.html:29`) → the sheet →
  the button labelled **`Info`** (`app.js:5362`, `onclick: openAbout`).
  **There is no word "Om" on screen — it is an aria-label only.** Do not tell the
  owner to look for "Om".
- The body is built with `el(...)` into `body`, which is appended to `about` at
  `app.js:4950`. **The existing sections end with "Datakällor & villkor"
  (`app.js:4942`)** — add the new section after that list, before `about.appendChild(body)`.

### What it must do

- **A switch that turns the readout on and off**, labelled in Swedish, in the
  same plain style as the sheet's other controls. Turning it on sets
  `localStorage['sr-meta-diag'] = 'on'`; turning it off sets it to `'off'`.
  **Read the existing value on open, so the switch reflects reality** rather
  than assuming a default.
- **The number rendered as visible text in the DOM.** This is the entire point.
  The owner must be able to read it and photograph it.
- **Refresh the reading while the sheet is open**, on an interval, and once
  immediately on open. Say in the UI what it is: the app's idea of where the live
  stream ends, compared with the real clock. A bare number with no explanation
  will be misread, and a misread number is worse than none.
- **Show it as a whole number of seconds, signed** (`+27 s` / `-4 s`), with a
  plain Swedish label. One line. Not JSON.

### What it must NOT do

- **Do not weaken `metaDiagGateOpen()`.** The two-key gate is deliberate: a query
  string travels in links, screenshots and bug reports, so it must never be
  sufficient on its own. Switching the flag **inside the app** is deliberate
  user action, which is exactly what the gate is asking for. Leave the function
  as it is.
- **Do not change any playback, transport, or scheduling behaviour.** This is a
  read-only display. `AGENTS.md` §3: one field, one writer — this adds a reader,
  not a writer.
- **Do not poll when switched off**, and do not leave a timer running after the
  sheet closes. A hidden panel that keeps working is a battery bug, and the
  existing code has a note about timers outliving their sheet.
- **Do not add the flag to a URL, a share link, or anywhere a screenshot could
  carry it.**

### Graceful degradation — this is a real requirement, not a nicety

`edgeMinusNowS` is derived from `seekableEnd`, which **only exists while a live
radio stream is playing.** On a talk channel, before playback starts, and on
podcasts it will be `null` or absent.

**The panel must say so in plain Swedish** ("Starta en radiokanal först" or
similar) rather than showing `null`, `undefined`, an empty box, or a misleading
`0`. **A panel that displays `0 s` when it means "no data" is worse than no
panel**, and it would send the next session chasing a zero offset that does not
exist.

### Where the number comes from

`window.srMetaDiag()` is already exported (`app.js:6007`) and returns
`dvr.streamEdge.edgeMinusNowS` when the gate is open. `window.__srSeekable()`
(`app.js:912`) is also exported. **Use the existing snapshot — do not
re-implement the edge calculation**, and do not compute the number a second way.
`AGENTS.md` §3.

---

## 2. The owner's instructions, verbatim in substance

Say this to the owner when you hand back. **Keep it short — they need to read one
number, not understand anything.**

> 1. Open Min Radio and start a **radio channel that has hourly news** — the
>    news is easy to recognise by ear, so you'll know exactly when it starts.
> 2. Tap the **programme-skip** button once (the ⏮ / ⏭ next to the play button).
> 3. Open the ⚙️ cog → **Info** → scroll to the bottom → turn on **Visa
>    tidsdiagnostik**.
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
  **no** such constant in the code and a test in `tests/fixpass.test.mjs`
  **rejects one by name**. That test is a deliberate guard; keep it green.
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
- **Do not correct the `app.js:3337` DATERANGE comment in this workstream.** It
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
4. **`metaDiagGateOpen()` is unchanged** — assert the two-key behaviour still
   holds and that a bare `?diag=metadata` with no flag still returns nothing.
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
