import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STYLES_RAW = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

// Comments must be stripped before any brace-slicing: a `}` inside a comment
// (e.g. the WS73 note "`.player-meta { margin-top: 3px }`") would otherwise end
// a block early and the guard would read the wrong text -- the exact trap the
// existing metadata-diag guards document.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const STYLES = stripComments(STYLES_RAW);

// ---------------------------------------------------------------------------
// WS75 — the cover square, the build number, and more vertical room.
// ---------------------------------------------------------------------------
//
// OWNER, 2026-10-08, verbatim:
//   "increase the vertical space more on both the base and the extendended
//    player ... the album covers could get excatly the same pixel width and
//    heigt as the channel and podcast icons, and the extended player could
//    cover the build number exactly ... keep everything else the same."
//
// These guards assert the SHAPE the change must hold. They deliberately do NOT
// assert a pixel number for the cover, because the icon size is derived from
// the viewport (`calc((min(100vw,480px) - 82px) / 4)`), and a guard that pinned
// "77px" would be the classic trap AGENTS.md warns about -- a number that is
// not the thing under test, going green for the wrong reason. The property that
// actually makes the two squares equal is that BOTH read the SAME variable.

test('WS75 C1: the home icons and the player cover read ONE shared --icon', () => {
  // The shared value, defined once on :root.
  assert.match(STYLES, /--icon:\s*calc\([^)]*\)/,
    'the shared --icon value must be defined (on :root)');

  // The home icon row consumes it.
  const iconRule = STYLES.match(
    /\.icon-scroller \.stream-icon,[\s\S]*?\.icon-scroller \.icon-empty\s*\{([^}]*)\}/);
  assert.ok(iconRule, 'the icon-scroller sizing rule must exist');
  assert.match(iconRule[1], /flex:\s*0 0 var\(--icon\)/,
    'the home icons must be sized from the shared --icon');

  // The player cover reads the SAME variable, via --player-art. This identity is
  // the whole requirement: one value, two consumers, so they cannot drift.
  const playerBlock = STYLES.slice(STYLES.indexOf('.player {'),
    STYLES.indexOf('}', STYLES.indexOf('.player {')));
  assert.match(playerBlock, /--player-art:\s*var\(--icon\)/,
    'the cover must be the shared --icon, so it equals the home icons exactly');

  // And the cover element itself is sized from --player-art on BOTH axes, or the
  // "square" claim is only half true. Anchored to LINE START: the first
  // `.player-thumb {` in the file is the mini-bar's 40px rule, and an unanchored
  // slice would read that instead -- the same wrong-rule trap the existing
  // guards document.
  const thumb = STYLES.match(/^\.player-thumb\s*\{([^}]*)\}/m);
  assert.ok(thumb, 'the top-level .player-thumb rule must exist');
  assert.match(thumb[1], /width:\s*var\(--player-art\)/,
    'the cover width must come from --player-art');
  assert.match(thumb[1], /height:\s*var\(--player-art\)/,
    'the cover height must come from --player-art (a square, not a rectangle)');
});

test('WS75 C1: the <=340px breakpoint moves --icon in step with the content padding', () => {
  // `.content`'s inline padding drops from 20px to 12px at <=340px, which
  // changes the icon arithmetic. The override must exist, or the cover and the
  // icons silently disagree on small phones -- a defect no other guard covers.
  assert.match(STYLES, /@media \(max-width: 340px\)\s*\{\s*:root\s*\{\s*--icon:/,
    'the <=340px icon size must be overridden to match the narrower content padding');
});

test('WS75 C2: the build number is hidden exactly while the player is visible', () => {
  // The hide must be SCOPED to a visible player. An unconditional
  // `.build-line { display: none }` would satisfy "not seen while playing" and
  // break "seen at rest", which is the opposite of the requirement.
  assert.match(STYLES,
    /body:has\(\.player\.visible\)\s+\.build-line\s*\{\s*display:\s*none;?\s*\}/,
    'the build line must be hidden ONLY while .player.visible is present');

  // The build line must NOT be hidden unconditionally -- it is load-bearing
  // (WS73b): the owner reads it to know which build they are on.
  const buildRule = STYLES.slice(STYLES.indexOf('.build-line {'),
    STYLES.indexOf('}', STYLES.indexOf('.build-line {')));
  assert.ok(!/display:\s*none/.test(buildRule),
    'the bare .build-line rule must not hide the build id at rest');
});

test('WS75 C4: the player row is a grid so a large cover cannot squeeze the pill', () => {
  // The cover is now icon-sized (~77px at 390px). In the old flex row that
  // collapsed the text column to 21.1px and clipped the quality pill. The grid
  // is what prevents the regression, so it is the guard.
  const row = STYLES.slice(STYLES.indexOf('.player-row {'),
    STYLES.indexOf('}', STYLES.indexOf('.player-row {')));
  assert.match(row, /display:\s*grid/,
    '.player-row must be a grid, not a flex row, now the cover is icon-sized');
  assert.match(row, /grid-template-columns:\s*var\(--player-art\)\s+minmax\(0,\s*1fr\)/,
    'the grid must be cover-column + a shrinkable text column');
  // The cover spans both rows; meta and controls stack in column 2, so the
  // transport no longer competes with the text for width.
  assert.match(STYLES, /\.player-row > \.player-thumb\s*\{[^}]*grid-row:\s*1 \/ -1/,
    'the cover must span both grid rows');
  assert.match(STYLES, /\.player-row > \.player-meta\s*\{[^}]*grid-column:\s*2/,
    'the meta must sit in column 2, row 1');
  assert.match(STYLES, /\.player-row > \.player-controls\s*\{[^}]*grid-column:\s*2/,
    'the transport must sit in column 2, row 2 -- below the meta, not beside it');
});

test('WS75 C3: the base player keeps growing vertically, inline padding frozen', () => {
  const playerBlock = STYLES.slice(STYLES.indexOf('.player {'),
    STYLES.indexOf('}', STYLES.indexOf('.player {')));
  const pad = playerBlock.match(/padding:\s*([\d.]+)px\s+16px\s+calc\(/);
  assert.ok(pad, 'the player padding shorthand must be block-variant with inline 16px');
  // Property-based: "at least the WS74 step (16)", so a further increase for the
  // same reason needs no restatement, while a DECREASE -- the only way this can
  // fail -- still goes red.
  assert.ok(Number(pad[1]) >= 16,
    `the player block padding must keep growing (>= 16px); got ${pad[1]}px`);

  // The meta row floor must keep pace with the taller cover.
  const metaRow = STYLES.match(/^\.player-meta-row\s*\{([^}]*)\}/m);
  assert.ok(metaRow, '.player-meta-row must exist');
  const floor = metaRow[1].match(/min-height:\s*(\d+)px/);
  assert.ok(floor, '.player-meta-row must declare a min-height floor');
  assert.ok(Number(floor[1]) >= 30,
    `.player-meta-row floor must not shrink below the WS74 value (>= 30px); got ${floor[1]}px`);
});

test('WS75 C4: nothing else moved -- the transport gap is untouched', () => {
  // The owner said "keep everything else the same". WS75 is a vertical +
  // cover-size change; the horizontal transport gap belongs to WS74 and must
  // not be re-opened here.
  const controls = STYLES.match(/^\.player-controls\s*\{([^}]*)\}/m);
  assert.ok(controls, '.player-controls must exist');
  const gap = controls[1].match(/gap:\s*(\d+)px/);
  assert.ok(gap, '.player-controls must declare an explicit gap');
  assert.equal(gap[1], '12',
    'WS75 must not change the transport gap (WS74 set it to 12px)');
});
