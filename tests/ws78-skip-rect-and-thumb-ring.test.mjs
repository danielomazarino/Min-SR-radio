import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const STYLES_RAW = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

// Comments must be stripped before brace-slicing: a `}` inside a comment ends a
// block early (documented trap in the WS75/WS76 guards).
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const STYLES = stripComments(STYLES_RAW);

// ---------------------------------------------------------------------------
// WS78 — rounded rectangles around the skip icons, and a grabbable ring
//        around the slider's current-position dot.
// ---------------------------------------------------------------------------
//
// OWNER, 2026-10-09, verbatim:
//   "for the skip icons, can you add small rounded rectangulars around them and
//    make them clickable for the rectangular area too? Also add for the slider
//    a ring that is not too big around the current dot in the end and make the
//    ring area as well possible to grab to make it easier for users."
//
// Three separate properties, each able to fail on its own:
//   A. a rounded rectangle is DRAWN around each skip glyph;
//   B. the rectangle's AREA is clickable ("clickable for the rectangular area
//      too") -- achieved structurally, by making the rect smaller than the
//      button, so the whole rect lies inside the button's own hit box;
//   C. the slider's dot gets a ring, and the RING AREA is grabbable ("make the
//      ring area as well possible to grab").
//
// The guards assert SHAPE, never pixels: pinning "9px" would go green for the
// wrong reason if the rect's size moved, and the honest property is the
// relationship (rounder than a square, flatter than a circle; smaller than the
// button), not the literal value.

// --- helpers ---------------------------------------------------------------

const num = (block, prop) => {
  const m = block.match(new RegExp(`${prop}:\\s*(-?[\\d.]+)px`));
  return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------------------
// A. The rounded rectangle around each skip glyph (drawn, in accent, rounded)
// ---------------------------------------------------------------------------

test('WS78: the skip buttons are a positioning context for their rectangle', () => {
  const btn = STYLES.match(/^\.dvr-program-btn\s*\{([^}]*)\}/m);
  assert.ok(btn, '.dvr-program-btn must exist');
  assert.match(btn[1], /position:\s*relative/,
    'the button must be a positioning context, or the rect anchors to the page');
});

test('WS78: the skip button draws a ROUNDED RECTANGLE (not a square, not a circle)', () => {
  const rect = STYLES.match(/^\.dvr-program-btn::before\s*\{([^}]*)\}/m);
  assert.ok(rect, 'the .dvr-program-btn::before rectangle must exist');

  const w = num(rect[1], 'width');
  const h = num(rect[1], 'height');
  assert.ok(w && h, 'the rectangle must declare a width and a height');

  // Accent, thin, matching the ±15 s circles the owner asked it to match.
  assert.match(rect[1], /border:\s*[\d.]+px solid var\(--accent\)/,
    'the rectangle outline must be a thin border in the accent colour');

  // ROUNDED RECTANGLE, by relationship rather than by literal value:
  // border-radius must exist, be > 0 (rounded at all), and be LESS THAN half
  // the shorter side. At exactly half the short side it becomes a pill; at
  // half the short side it is indistinguishable from a circle. The owner asked
  // for "rounded rectangulars", so the corner must be visibly a corner.
  const radius = rect[1].match(/border-radius:\s*([\d.]+)px/);
  assert.ok(radius, 'the rectangle must declare a border-radius');
  const r = Number(radius[1]);
  const shortSide = Math.min(w, h);
  assert.ok(r > 0, 'the corners must actually be rounded (radius > 0)');
  assert.ok(r < shortSide / 2,
    `radius ${r}px must be under half the short side (${shortSide / 2}px), or the shape is a pill/circle, not a rounded rectangle`);

  // The rect must be decoration on the button, not its own hit target -- the
  // button owns the click.
  assert.match(rect[1], /pointer-events:\s*none/,
    'the rectangle is drawn on the button, not a separate hit target');

  // The glyph must paint ABOVE the rectangle.
  const svg = STYLES.match(/^\.dvr-program-btn svg\s*\{([^}]*)\}/m);
  assert.ok(svg, '.dvr-program-btn svg must exist');
  assert.match(svg[1], /position:\s*relative/,
    'the glyph must stack above the absolutely-positioned rectangle');
});

// ---------------------------------------------------------------------------
// WS80 — "the skip button icons are a bit high and left adjusted"
// ---------------------------------------------------------------------------

test('WS80: the skip glyph answers to its rectangle (accent), not grey', () => {
  // OWNER, 2026-10-09: "the skip button icons are a bit high and left adjusted."
  //
  // MEASURED FIRST, because "high and left" had to be a measurement and not an
  // impression. The ink's bbox clearance inside the 30x26 rectangle is ALREADY
  // symmetric -- 9.5px left/right and 7.5px top/bottom -- and its mass centroid
  // is 0.51px off. So the geometry was NOT the defect. What was: the glyph
  // rendered `rgb(110,110,115)` (`--text-secondary`) inside a `rgb(0,80,78)`
  // accent rectangle. A grey glyph in a green box reads as misplaced inside it.
  //
  // The ±15 s pair, which the owner asked these icons to MATCH in WS78, draws
  // its glyph in `var(--accent)`. This asserts the match is complete.
  const btn = STYLES.match(/^\.dvr-program-btn\s*\{([^}]*)\}/m);
  assert.ok(btn, '.dvr-program-btn must exist');
  assert.match(btn[1], /color:\s*var\(--accent\)/,
    'the skip glyph must be the ACCENT, matching the rectangle it sits in and the ±15 s pair');
  assert.ok(!/color:\s*var\(--text-secondary\)/.test(btn[1]),
    'the muted grey is what made the glyph look misplaced in its accent box (WS80)');

  // The ±15 s button it must match still uses the accent, so the two agree.
  const step = STYLES.match(/^\.dvr-step-btn\s*\{([^}]*)\}/m);
  assert.match(step[1], /color:\s*var\(--accent\)/,
    'the ±15 s glyph is the reference the skip glyph was asked to match -- it must stay accent');
});

test('WS80: the skip glyph is the same size as the ±15 s glyph it matches', () => {
  // The skip buttons set no explicit svg size, so they inherited
  // `.player-btn svg { 22px }` while the ±15 s buttons set 20px -- the two
  // halves of the "match them" request disagreed on glyph size by 2px, which
  // changes the glyph-to-marking ratio between the rectangles and the circles.
  const prog = STYLES.match(/^\.dvr-program-btn svg\s*\{([^}]*)\}/m);
  assert.ok(prog, 'the skip glyph rule must exist');
  const pw = prog[1].match(/width:\s*(\d+)px/);
  assert.ok(pw, 'the skip glyph must declare an explicit width, or it inherits .player-btn svg');
  const ph = prog[1].match(/height:\s*(\d+)px/);
  assert.ok(ph, 'and an explicit height');

  const step = STYLES.match(/^\.dvr-step-btn svg\s*\{([^}]*)\}/m);
  const sw = step[1].match(/width:\s*(\d+)px/);
  assert.ok(sw, 'the ±15 s glyph must declare a width');
  const sh = step[1].match(/height:\s*(\d+)px/);
  assert.ok(sh, 'and a height');

  assert.equal(pw[1], sw[1],
    `the skip glyph (${pw[1]}px) must be the SAME SIZE as the ±15 s glyph (${sw[1]}px) it was asked to match`);
  assert.equal(ph[1], sw[1],
    'and square -- a non-square glyph box would letterbox the icon');
  assert.ok(pw[1] !== '22',
    'the glyph must NOT keep the inherited 22px, which is what made the two pairs disagree');
});

test('WS80: the ±15 s ink bbox is centred in its ring, measured, not eyed', () => {
  // OWNER (third report): "the circle arrows are still not fully centered."
  //
  // MEASURED on the built page, both arrows identical -- the ink's bbox clearance
  // to the ring was top 8.83px vs bottom 10.50px, i.e. 1.67px UNEQUAL. The ink's
  // bounding EDGE is what the eye compares against the ring's edge.
  //
  // The fix is +0.83px down (half the imbalance, at 0.833px per viewBox unit).
  // What this guard asserts is the PROPERTY, not the literal: the displacement
  // is downward, and it equals half the measured imbalance within tolerance. A
  // pinned "0.83px" would go red for a harmless rounding change and green for a
  // re-introduced upward nudge of the same magnitude with a flipped sign.
  const rule = STYLES.match(/\.player \.dvr-step-btn svg\s*\{([^}]*)\}/);
  assert.ok(rule, 'the ±15 s glyph must carry the centring transform');
  const t = rule[1].match(/transform:\s*translateY\((-?[\d.]+)px\)/);
  assert.ok(t, 'the centring must be a translateY');
  const dy = Number(t[1]);

  assert.ok(dy > 0,
    `the ink bbox sat 1.67px HIGH, so the correction must move DOWN; got translateY(${dy}px)`);
  assert.ok(Math.abs(dy - 1.67 / 2) < 0.15,
    `the correction must cancel the measured 1.67px bbox imbalance (half = 0.83px); got ${dy}px`);
  assert.ok(Math.abs(dy) < 1.67,
    'a correction larger than the imbalance would overshoot past centre');

  // And the marking the ink is centred in is still a square circle on the button.
  const ring = STYLES.match(/^\.dvr-step-btn::before\s*\{([^}]*)\}/m);
  assert.ok(ring, 'the ring must exist');
  const w = ring[1].match(/width:\s*(\d+)px/)[1];
  const h = ring[1].match(/height:\s*(\d+)px/)[1];
  assert.equal(w, h, 'the ring must be square, so its centre is the button centre');
  assert.match(ring[1], /border-radius:\s*50%/, 'the ring must be a circle');
});

test('WS78: the rectangle is centred on the button', () => {
  const rect = STYLES.match(/^\.dvr-program-btn::before\s*\{([^}]*)\}/m);
  assert.ok(rect, 'the .dvr-program-btn::before rectangle must exist');
  const b = rect[1];
  const w = num(b, 'width');
  const h = num(b, 'height');

  assert.match(b, /top:\s*50%/, 'the rectangle must be vertically centred');
  assert.match(b, /left:\s*50%/, 'the rectangle must be horizontally centred');

  // A 50%/-half-margin pair is what makes "50%" the button's CENTRE rather
  // than its top-left corner. If the margin is not exactly half the box, the
  // rectangle sits off-centre inside its button.
  const margin = b.match(/margin:\s*(-?[\d.]+)px\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)px/);
  assert.ok(margin, 'the rectangle must use a shorthand 4-value margin');
  assert.equal(Math.abs(Number(margin[1])), h / 2,
    'the top margin must be exactly half the height, so top:50% lands on the centre');
  assert.equal(Math.abs(Number(margin[4])), w / 2,
    'the left margin must be exactly half the width, so left:50% lands on the centre');
});

// ---------------------------------------------------------------------------
// B. "make them clickable for the rectangular area too"
// ---------------------------------------------------------------------------

test('WS78: every point inside the rectangle is inside the clickable button', () => {
  // The owner asked for the RECTANGLE's area to be clickable. It is achieved
  // structurally rather than with a separate hit element: the rectangle is a
  // pseudo-element of the button, and it is SMALLER than the button's own box
  // (36 x 44), so every point inside the rect is already a point on the button
  // and therefore already activates it. If the rect ever grew past the button,
  // the parts sticking out would be dead pixels that LOOK clickable -- which is
  // exactly the defect this guard exists to prevent.
  const btn = STYLES.match(/^\.dvr-program-btn\s*\{([^}]*)\}/m);
  const rect = STYLES.match(/^\.dvr-program-btn::before\s*\{([^}]*)\}/m);
  assert.ok(btn && rect, 'both the button and its rectangle must exist');

  const btnW = num(btn[1], 'width');
  const btnH = num(btn[1], 'height') ?? 44; // the button's height comes from .player-btn
  assert.ok(btnW, 'the skip button must declare a width (WS73/74: 36px)');

  const rectW = num(rect[1], 'width');
  const rectH = num(rect[1], 'height');

  assert.ok(rectW <= btnW,
    `the rectangle (${rectW}px wide) must not be wider than the button (${btnW}px), or part of the "clickable" rect is dead`);
  assert.ok(rectH <= btnH,
    `the rectangle (${rectH}px tall) must not be taller than the button (${btnH}px), or part of the "clickable" rect is dead`);

  // And it must not be so small that the outline reads as not belonging to the
  // button at all. Half the button's box is a generous floor.
  assert.ok(rectW >= btnW / 2 && rectH >= btnH / 2,
    'the rectangle must be large enough to read as the button\'s own marking');
});

test('WS78: the skip buttons are real, focusable <button>s', () => {
  // "clickable" also means the underlying control must be a button, and both
  // skip buttons must exist in the transport row.
  assert.match(APP_JS, /class: 'player-btn dvr-program-btn/,
    'the programme-skip buttons must carry .dvr-program-btn');
  assert.match(APP_JS, /prevProgramBtn|nextProgramBtn/,
    'both programme-skip buttons must remain wired in the controls row');
});

// ---------------------------------------------------------------------------
// C. The slider ring — drawn on BOTH sliders, grabbable on the DVR slider
// ---------------------------------------------------------------------------

test('WS78 (RESTATED WS80): the ring is drawn on the base thumb, so both sliders show it', () => {
  // ---- RESTATED (AGENTS.md 7b). WHAT IT USED TO SAY (WS78): the ring is 26px and
  // BOUNDED to >= 24px ("at least 24px to be an easy grab target").
  //
  // WHY IT CHANGED (owner, 2026-10-09, after seeing WS78 shipped): "the ring
  // around the slider is a little too big and needs the solid background colour
  // of the player." So the 24px FLOOR was the wrong floor — the owner's actual
  // bound is LOWER — and the ring was also missing a fill (the 4px track showed
  // through it, which is what made it read as a window rather than a handle).
  //
  // The requirement did not change ("a ring that is not too big around the
  // current dot"); WS78 simply picked a size above what the owner wanted. The
  // guard is restated to the measured requirement and asserted no less strictly:
  // a size band, a FILL, an accent border, centring and non-grabbability.
  assert.match(APP_JS, /class: 'seek-bar dvr-bar'/,
    'the DVR slider must exist');
  assert.match(APP_JS, /class: 'seek-bar episode-seek-bar'/,
    'the podcast slider must exist');

  const ring = STYLES.match(/^\.seek-thumb::before\s*\{([^}]*)\}/m);
  assert.ok(ring, 'the base .seek-thumb::before ring must exist');

  const w = num(ring[1], 'width');
  const h = num(ring[1], 'height');
  assert.ok(w && h, 'the ring must declare a width and a height');
  assert.equal(w, h, 'the ring must be square, or border-radius:50% renders an ellipse');
  assert.match(ring[1], /border-radius:\s*50%/, 'the ring must be a circle');
  assert.match(ring[1], /border:\s*[\d.]+px solid var\(--accent\)/,
    'the ring must be a thin accent-coloured circle, matching the skip outlines');

  // SIZE BAND. The owner has now given a bound from BOTH sides: WS78's 26px was
  // "a little too big", so the ceiling drops below it; and the ring still has to
  // be a grab target larger than the 14px dot it circles, so the floor stays
  // above that. 22px sits inside both.
  assert.ok(w > 14,
    `the ring (${w}px) must be larger than the 14px dot it circles, or it is not a ring`);
  assert.ok(w < 26,
    `the ring (${w}px) must be SMALLER than the 26px the owner called "a little too big"`);
  assert.ok(w >= 20,
    `the ring (${w}px) must stay >= 20px so it remains an easy grab target`);

  // FILL — "needs the solid background colour of the player". `--surface` is
  // that token (`.player { background: var(--surface) }`). Without it the track
  // shows through the ring. This is the property that was MISSING in WS78.
  assert.match(ring[1], /background:\s*var\(--surface\)/,
    'the ring must be FILLED with --surface (the player\'s own background), so the track does not show through it');

  // The ring must be centred on the dot.
  assert.match(ring[1], /top:\s*50%/, 'the ring must be vertically centred on the thumb');
  assert.match(ring[1], /left:\s*50%/, 'the ring must be horizontally centred on the thumb');
  const margin = ring[1].match(/margin:\s*(-?[\d.]+)px\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)px/);
  assert.ok(margin, 'the ring must use a shorthand 4-value margin');
  assert.equal(Math.abs(Number(margin[1])), h / 2, 'the ring top margin must be half its height');
  assert.equal(Math.abs(Number(margin[4])), w / 2, 'the ring left margin must be half its width');

  // Decoration only, so the grab decision stays on the thumb box below.
  assert.match(ring[1], /pointer-events:\s*none/,
    'the ring itself must not be a separate hit target');
});

test('WS78: the DVR thumb is grabbable and its box covers the whole ring', () => {
  // "make the ring area as well possible to grab to make it easier for users."
  // The base thumb is `pointer-events: none` (the bar handled the press), so
  // before WS78 the only way to drag the live slider was to hit the 4px track.
  const base = STYLES.match(/^\.seek-thumb\s*\{([^}]*)\}/m);
  assert.ok(base, '.seek-thumb must exist');
  assert.match(base[1], /pointer-events:\s*none/,
    'the base thumb must stay non-grabbing — the bar is what handles the press there');

  const thumb = STYLES.match(/^\.dvr-bar \.seek-thumb\s*\{([^}]*)\}/m);
  assert.ok(thumb, 'the DVR thumb must have a rule of its own');
  assert.match(thumb[1], /pointer-events:\s*auto/,
    'the DVR thumb must be grabbable, or "the ring area" is not a target');

  const ring = STYLES.match(/^\.seek-thumb::before\s*\{([^}]*)\}/m);
  const ringW = num(ring[1], 'width');
  const thumbW = num(thumb[1], 'width');
  const thumbH = num(thumb[1], 'height');
  assert.ok(thumbW && thumbH, 'the DVR thumb must declare a width and a height');

  // The promise is "the RING AREA is grabbable". That is only true if the
  // thumb's hit box is at least as large as the ring, in BOTH dimensions. If
  // the box were smaller, the ring's edge would look grabbable and not be.
  assert.ok(thumbW >= ringW,
    `the grabbable thumb box (${thumbW}px) must cover the ring (${ringW}px wide)`);
  assert.ok(thumbH >= ringW,
    `the grabbable thumb box (${thumbH}px) must cover the ring (${ringW}px tall)`);

  // The visible dot must be DRAWN separately and be smaller than the box, so
  // growing the hit area did not inflate the visible thumb.
  const dot = STYLES.match(/^\.dvr-bar \.seek-thumb::after\s*\{([^}]*)\}/m);
  assert.ok(dot, 'the DVR dot must be drawn by ::after, as the podcast slider does');
  const inset = dot[1].match(/inset:\s*([\d.]+)px/);
  assert.ok(inset, 'the dot must be inset from its oversized box');
  assert.ok(Number(inset[1]) > 0,
    'the dot must be inset, or the "larger hit area" also enlarged the visible thumb');
  assert.match(dot[1], /background:\s*var\(--accent\)/,
    'the dot must still be the accent-coloured thumb the owner recognises');
});

test('WS78: the podcast slider keeps its own grabbable thumb', () => {
  // The ring was added on the base class, so the podcast slider must keep the
  // oversized grabbable box it already had -- the ring must not have been
  // "fixed" by shrinking that box back to 14px.
  const ep = STYLES.match(/^\.episode-seek-bar \.seek-thumb\s*\{([^}]*)\}/m);
  assert.ok(ep, 'the podcast thumb rule must survive');
  assert.match(ep[1], /pointer-events:\s*auto/,
    'the podcast thumb must stay grabbable');
  const w = num(ep[1], 'width');
  const ring = STYLES.match(/^\.seek-thumb::before\s*\{([^}]*)\}/m);
  const ringW = num(ring[1], 'width');
  assert.ok(w >= ringW,
    `the podcast thumb box (${w}px) must cover the ring (${ringW}px)`);
});

// ---------------------------------------------------------------------------
// D. Nothing else moved
// ---------------------------------------------------------------------------

test('WS78: the transport geometry is unchanged', () => {
  // WS76 pinned these. WS78 draws inside the existing boxes; if it changed a
  // box size the WS12 squeezed-column defect could return on a DVR channel.
  const controls = STYLES.match(/^\.player-controls\s*\{([^}]*)\}/m);
  assert.ok(controls, '.player-controls must exist');
  assert.equal(num(controls[1], 'gap'), 12,
    'the base transport gap must stay 12px (WS74)');

  const step = STYLES.match(/^\.dvr-step-btn\s*\{([^}]*)\}/m);
  assert.ok(step, '.dvr-step-btn must exist');
  assert.equal(num(step[1], 'width'), 36,
    'the ±15 s button width must stay 36px (WS73/74) — WS78 must not touch it');

  const prog = STYLES.match(/^\.dvr-program-btn\s*\{([^}]*)\}/m);
  assert.ok(prog, '.dvr-program-btn must exist');
  assert.equal(num(prog[1], 'width'), 36,
    'the skip button width must stay 36px — WS78 draws inside it, it does not resize it');

  // The ±15 s ring keeps its own size and did not get the new rounded-rect rule.
  const stepRing = STYLES.match(/^\.dvr-step-btn::before\s*\{([^}]*)\}/m);
  assert.ok(stepRing, 'the ±15 s ring must survive (WS76)');
  assert.match(stepRing[1], /border-radius:\s*50%/,
    'the ±15 s marking must stay a CIRCLE — only the skip buttons get rectangles');
});
