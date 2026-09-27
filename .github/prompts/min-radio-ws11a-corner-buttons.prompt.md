---
name: WS11 addendum — the close and chevron buttons belong on the controls row
description: Small correction to WS11. In the expanded player the close and chevron sit in a header row above the controls; the owner wants them on the same row as the transport buttons, at the right, matching the minimised player.
applyTo: "**"
---

# WS11 addendum — move the close and chevron onto the controls row

**This is an addendum to the WS11 prompt, not a replacement.** Do the WS11 work
first; this is an additional, self-contained change.

## What the owner asked for, precisely

In the **expanded (mid) player**, the close ✕ and the chevron currently sit in
their own row **above** the transport buttons. The owner wants them **on the
same row as the transport buttons, at the right-hand end** — i.e. the same
relative position they already occupy in the **minimised** player, where the
order is thumb · meta · play · chevron · close.

Put the chevron first and the close last, so the right-hand order reads
`… play · chevron · close`, mirroring the minimised bar.

## The current structure (verified)

```js
// app.js:2894 — expanded player, a header row of its own
const headerLine = el('div', { class: 'player-header' },
  closeBtn,
  el('div', { class: 'player-title', text: cur.title || '' }),
  el('div', { class: 'player-sub', text: cur._srProgramTitle || cur.subtitle || (live ? 'Direkt' : '') }),
  expandBtn);
```

```js
// app.js:2123 — minimised bar, buttons on the right already
const mini = el('div', { class: 'player-mini' },
  miniThumb,
  el('div', { class: 'player-meta', onclick: restorePlayer }, /* … */),
  miniPlay, miniExpand, miniStop);
```

The transport row is built separately (`app.js:2231` defines `expandBtn`; the
controls row is assembled around it — read the surrounding code, do not assume
the line numbers are the row).

## The critical constraint — read before editing

`.player-header` is **load-bearing for the WS5b alignment.** The text column's
position is not a `padding-left` literal: `.player-header .player-btn-close` is
given the artwork's own width via `--player-art` (styles.css:758-762), so the
gap after it equals `--player-gap` and **the title and programme land on the
artwork's right edge — the same left edge as the quality pill and the song
line.** The measured result is `title / quality / song all at left=72, spread
0px`.

**If you simply delete `closeBtn` from the header, that alignment collapses and
you will have broken WS5b.** Removing the spacer does not remove the space; it
removes the thing that *creates* the space.

**So the correct approach is to replace the button with an equivalent spacer of
the same width** (`--player-art`), not to delete it. A visually identical,
non-interactive element sized to the same custom property preserves the
alignment by construction and removes the button. Then append the real
`closeBtn` and `expandBtn` to the controls row.

Alternatively, if the header keeps the chevron, you must re-establish the
spacer explicitly — do not rely on a fixed pixel width, or the layout will drift
when `--player-art` changes.

**Required outcome to verify and report:**

- `title`, `player-quality` and `.now-playing-line` all still share the same
  left edge (report the measured pixels, and the spread between them).
- The player height does not grow — the owner is removing a row, so it should
  get **shorter** by roughly the header's height.
- No horizontal overflow at 390px, and none at 340px.
- The minimised player is **completely unchanged** — same child order, same
  alignment, same tap targets.

## Hard boundaries

- **Do not touch `setExpandOpen()`, `playerMinimized`, or the minimised bar.**
  `setExpandOpen()` is the sole writer of `aria-expanded` and has several call
  sites; the mini-bar has its own buttons that must keep working.
- `paintProgramTitle()` writes to `$player.querySelector('.player-sub')` and
  `paintNowPlaying()` to `.now-playing-line`. **Keep both inside `$player` and
  keep those class names** — renaming or reparenting them silently breaks
  painting while the tests stay green. This has happened before.
- Preserve each button's `aria-label` and its `onclick` exactly.
- Do not reintroduce the DVR window readout or anything else on the seek row —
  WS11 Part A removes that.
- Do not restore the WS5 attribution footer.

## Tests — non-vacuous, as in WS11

The alignment property is the one that must not regress, and it is the one a
careless edit breaks. Assert:

- the header still contains a spacer whose width derives from `--player-art`;
- both buttons are attached to the **controls row**, not the header;
- `aria-label`s and handlers survive the move;
- a mutation that deletes the spacer **without** replacing it turns the suite
  red — that is the exact regression this addendum is guarding against;
- a mutation that moves a button back to the header turns the suite red.

**Browser evidence, pasted as real output:** the measured left edges of title,
quality and song; player height before vs after; overflow at 390px and 340px;
and a screenshot-sized check of both the expanded and minimised players.

Chromium cannot load SR's DVR stream, so verify on a non-DVR live channel and
say so. No iPhone is available to you.

## Report and deploy

Status roughly every 5 minutes, and **no more often**. Paste the mutation table,
the alignment numbers, and the before/after height.

**Commit together with WS11 if it is still in flight; otherwise commit
separately. Do not push either** — I verify all four deploy checks before the
owner is told anything is live.
