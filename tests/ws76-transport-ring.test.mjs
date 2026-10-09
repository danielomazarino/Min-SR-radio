import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const STYLES_RAW = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

// Comments must be stripped before brace-slicing: a `}` inside a comment ends a
// block early (documented trap in the WS75 guards).
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const STYLES = stripComments(STYLES_RAW);

// ---------------------------------------------------------------------------
// WS76 — the ±15 s buttons: a thin green ring, and a balanced, play-away gap.
// ---------------------------------------------------------------------------
//
// OWNER, 2026-10-09, verbatim:
//   "on the iphone screen a challenge is that +- 15 seconds button are feeling
//    wise to close to the play button. it also looks as they are closer to it
//    than to the skip buttons. I'm thinking that we should make a thin round
//    circular marking in the same green accent colour as the circular arrows
//    around them and move them slightly towards the skip buttons. the whole
//    circles should then be clickable."
//
// The guard deliberately asserts the SHAPE (a circle drawn as a square
// pseudo-element, an asymmetric net-zero margin pair, scoped to the DVR row),
// not a pixel gap -- the gap is a consequence of the base gap plus the margin,
// and pinning "16px" would go green for the wrong reason if the base gap moved.

test('WS76: the DVR transport row is marked, so the nudge is scoped to it', () => {
  // A DVR channel's transport row carries `.dvr`; a podcast's does not. The
  // nudge must be scoped, or the podcast's 3-button row (no skip buttons) would
  // shift off centre for no reason.
  const controls = APP_JS.slice(APP_JS.indexOf("const controls = el('div', { class: 'player-controls' }"));
  const head = controls.slice(0, controls.indexOf('controls.appendChild'));
  assert.match(head, /if \(isDvr\) controls\.classList\.add\('dvr'\)/,
    'the DVR transport row must be tagged .dvr, and only on a DVR channel');
});

test('WS76: the ±15 s buttons are individually addressable', () => {
  // The two step buttons need distinct classes so each can be nudged outward on
  // the correct side (a shared class cannot tell "back" from "forward").
  assert.match(APP_JS, /class: 'player-btn dvr-step-btn dvr-step-back'/,
    'the back ±15 s button must carry .dvr-step-back');
  assert.match(APP_JS, /class: 'player-btn dvr-step-btn dvr-step-fwd'/,
    'the forward ±15 s button must carry .dvr-step-fwd');
});

test('WS76: the ±15 s button draws a thin green CIRCLE, whole circle clickable', () => {
  const rule = STYLES.match(/^\.dvr-step-btn\s*\{([^}]*)\}/m);
  assert.ok(rule, '.dvr-step-btn must exist');
  // The button is 36 wide x 44 tall, so a `border` on it would be an ELLIPSE.
  // The ring must therefore be a square pseudo-element with border-radius 50%.
  assert.match(rule[1], /position:\s*relative/,
    'the button must be a positioning context for its ring');

  const ring = STYLES.match(/^\.dvr-step-btn::before\s*\{([^}]*)\}/m);
  assert.ok(ring, 'the ring pseudo-element must exist');
  // Square: equal width and height -> a true circle.
  const w = ring[1].match(/width:\s*(\d+)px/);
  const h = ring[1].match(/height:\s*(\d+)px/);
  assert.ok(w && h, 'the ring must declare a width and a height');
  assert.equal(w[1], h[1],
    'the ring must be square, or border-radius:50% renders an ellipse');
  assert.match(ring[1], /border-radius:\s*50%/,
    'the ring must be a circle');
  assert.match(ring[1], /border:\s*[\d.]+px solid var\(--accent\)/,
    'the ring must be a thin border in the accent colour');
  // The ring must not swallow taps on the button's own glyph area -- it is part
  // of the button, so a tap anywhere still activates it ("whole circles
  // clickable"), but it must not be a separate hit target.
  assert.match(ring[1], /pointer-events:\s*none/,
    'the ring is decoration on the button, not its own hit target');
  // The glyph must paint ABOVE the ring.
  const svg = STYLES.match(/^\.dvr-step-btn svg\s*\{([^}]*)\}/m);
  assert.ok(svg, '.dvr-step-btn svg must exist');
  assert.match(svg[1], /position:\s*relative/,
    'the glyph must stack above the absolutely-positioned ring');
});

test('WS76 (RESTATED WS81): the ±15 s nudge is NEUTRAL — the gaps are equal', () => {
  // ---- RESTATED (AGENTS.md 7b). WHAT IT USED TO SAY (WS76): "the ±15 s button
  // moves toward the skip, away from play, net-zero", REQUIRING an asymmetric
  // margin pair (`-4px / +4px`).
  //
  // WHY IT CHANGED -- OWNER, 2026-10-09: "in the 773b2e5 it doesn't look
  // perfect, so fix 1, 2 and 3". Item 2 was the ±15 s ink gap asymmetry, which
  // this nudge CAUSED: MEASURED on the built page at 390px with the real `.dvr`
  // row, the ink-to-ink gaps were 32.33px (skip↔step) and 43.33px (step↔play).
  //
  // The WS76 requirement was "balance the ±15 s gap" -- but it balanced the
  // BUTTON boxes (uniform 12px flex gap before the nudge) rather than the INK,
  // and the ±15 s button is 36px wide around a 20px glyph. The fix that satisfies
  // the original AND the new requirement is no displacement at all: the flex gap
  // is uniform, so all four ink gaps become equal.
  //
  // The property is asserted at least as strongly as before: net-zero margins are
  // still required (the row cannot shift), and the rule is still required to carry
  // both margins so a future edit cannot silently re-introduce a nudge.
  const back = STYLES.match(/\.player-controls\.dvr \.dvr-step-back\s*\{([^}]*)\}/);
  assert.ok(back, 'the back ±15 s rule must exist, scoped to the DVR row');
  const backL = back[1].match(/margin-left:\s*(-?\d+)px/);
  const backR = back[1].match(/margin-right:\s*(-?\d+)px/);
  assert.ok(backL && backR, 'the back rule must set both margins explicitly');
  assert.equal(Number(backL[1]), 0,
    'the back button must not be displaced — a non-zero margin re-opens the 32.3px/43.3px ink-gap asymmetry');
  assert.equal(Number(backR[1]), 0, 'and the other side must be zero too');

  const fwd = STYLES.match(/\.player-controls\.dvr \.dvr-step-fwd\s*\{([^}]*)\}/);
  assert.ok(fwd, 'the forward ±15 s rule must exist, scoped to the DVR row');
  const fwdL = fwd[1].match(/margin-left:\s*(-?\d+)px/);
  const fwdR = fwd[1].match(/margin-right:\s*(-?\d+)px/);
  assert.ok(fwdL && fwdR, 'the forward rule must set both margins explicitly');
  assert.equal(Number(fwdL[1]), 0, 'the forward button must not be displaced either');
  assert.equal(Number(fwdR[1]), 0, 'and the other side must be zero too');

  // NET ZERO still holds trivially, and is asserted so the original requirement
  // is not lost: the row's total width must be unchanged by these rules.
  assert.equal(Math.abs(Number(backL[1])), Math.abs(Number(backR[1])),
    'the back margins must remain net-zero, so the row width cannot change');
  assert.equal(Math.abs(Number(fwdL[1])), Math.abs(Number(fwdR[1])),
    'the forward margins must remain net-zero, so the row width cannot change');
});

test('WS76: nothing else in the transport moved', () => {
  // The owner said "keep everything else the same" in the sibling workstream;
  // this change must not re-open the base gap or the button widths.
  const controls = STYLES.match(/^\.player-controls\s*\{([^}]*)\}/m);
  assert.ok(controls, '.player-controls must exist');
  const gap = controls[1].match(/gap:\s*(\d+)px/);
  assert.ok(gap, '.player-controls must declare an explicit gap');
  assert.equal(gap[1], '12', 'the base transport gap must stay 12px (WS74)');

  const step = STYLES.match(/^\.dvr-step-btn\s*\{([^}]*)\}/m);
  const w = step[1].match(/width:\s*(\d+)px/);
  assert.ok(w, '.dvr-step-btn must declare a width');
  assert.equal(w[1], '36', 'the ±15 s button width must stay 36px (WS73/74)');

  const prog = STYLES.match(/^\.dvr-program-btn\s*\{([^}]*)\}/m);
  assert.ok(prog, '.dvr-program-btn must exist');
  const pw = prog[1].match(/width:\s*(\d+)px/);
  assert.ok(pw, '.dvr-program-btn must declare a width');
  assert.equal(pw[1], '36', 'the programme-skip button width must stay 36px');
});
