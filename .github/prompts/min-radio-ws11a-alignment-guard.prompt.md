---
name: WS11a correction — the alignment spacer, and what to measure
description: Companion to the WS11a addendum. States the single failure mode that breaks the player header alignment silently, and the one measurement that proves the change is safe.
applyTo: "**"
---

# WS11a correction — read before you edit the player header

You are moving the close ✕ and the chevron ⌄ out of `.player-header` and onto
the transport-controls row, so they sit to the right of the play button, as
they already do in the minimised bar.

## The one thing that can go wrong, and it is silent

**The close button in the header is not only a button. It is the alignment
spacer.** `.player-header .player-btn-close` is given the artwork's own width:

```css
/* styles.css */
.player-header .player-btn-close {
  width: var(--player-art);   /* 44px — the same width as the artwork */
  height: var(--player-art);
  flex: none;
}
```

so that the `--player-gap` after it pushes the title and the programme across
to the artwork's right edge — **the same left edge as the quality pill and the
song line.** That is why all three measure the same value. The alignment is
structural, not a `padding-left` literal.

**If you simply delete the button, that space disappears with it and the text
slides left. Every test in the suite still passes, because no test measures the
alignment.** This has effectively happened once already: a reviewer verified
"the layout is intact" by measuring a neighbouring element while the actual
defect sat unmeasured.

## What to do instead

**Replace the button with a non-interactive spacer of exactly the same width**,
sized from the same custom property — not from a hardcoded `44px`. A literal
will drift the moment `--player-art` changes, and the whole point of the
current design is that one value moves everything together.

Then append the real `closeBtn` and `expandBtn` to the controls row, chevron
first and close last, so the right-hand order reads `… play · chevron · close`,
mirroring the minimised bar.

## The one measurement that proves it

Measure these three, in the real player, with the app's own CSS applied, at
390px:

```js
const L = (s) => { const n = document.querySelector(s);
                   return n ? Math.round(n.getBoundingClientRect().left) : null; };
[L('.player-header .player-title'), L('.player-quality'), L('.now-playing-line')]
```

**All three must be equal.** The spread between them must be **0px** — it was
112px before WS5b, and 0px after. If it is not 0, the spacer was removed rather
than replaced. Also report:

- the player's **height** before and after (removing a row should make it
  *shorter*; if it grew, something else moved);
- horizontal overflow at 390px **and** 340px;
- the minimised player **unchanged** — same child order, same alignment.

## Keep these intact

- `paintProgramTitle()` writes to `$player.querySelector('.player-sub')` and
  `paintNowPlaying()` to `.now-playing-line`. Both must stay inside `$player`
  with those class names intact — renaming or reparenting them silently stops
  painting while tests stay green.
- Each button's `aria-label` and `onclick` exactly as they are.
- `setExpandOpen()` is the sole writer of `aria-expanded`; the minimised bar has
  its own buttons and its own restore behaviour. **Do not touch the mini-bar.**

Commit without pushing. Report the measurement numbers and the commit hash.
