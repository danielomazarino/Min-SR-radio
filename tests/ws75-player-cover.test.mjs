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
// WS75 — the EXTENDED player's cover square, the build number, vertical room.
// ---------------------------------------------------------------------------
//
// OWNER, 2026-10-08, verbatim:
//   "increase the vertical space more on both the base and the extendended
//    player ... the album covers could get excatly the same pixel width and
//    heigt as the channel and podcast icons, and the extended player could
//    cover the build number exactly ... keep everything else the same."
//
// OWNER CORRECTION, 2026-10-09, verbatim:
//   "it is the album cover icon in the extended player that should be in the
//    size of the channels and podcasts ... and the icon in the 'normal player'
//    to be as it was."
//
// So the icon-sized cover belongs to the EXTENDED player (`.expand-img` /
// `.expand-img-song`), and the NORMAL player's cover (`.player-thumb`) stays
// 44px. WS75 first applied it to the normal player -- the opposite -- and these
// guards now assert the corrected arrangement.
//
// They deliberately do NOT assert a pixel number for the extended cover,
// because the icon size is derived from the viewport
// (`calc((min(100vw,480px) - 82px) / 4)`), and a guard that pinned "77px" would
// be the classic trap AGENTS.md warns about -- a number that is not the thing
// under test, going green for the wrong reason. The property that actually
// makes the two squares equal is that BOTH read the SAME variable.

test('WS75 C1: the home icons and the EXTENDED player cover read ONE shared --icon', () => {
  // The shared value, defined once on :root.
  assert.match(STYLES, /--icon:\s*calc\([^)]*\)/,
    'the shared --icon value must be defined (on :root)');

  // The home icon row consumes it.
  const iconRule = STYLES.match(
    /\.icon-scroller \.stream-icon,[\s\S]*?\.icon-scroller \.icon-empty\s*\{([^}]*)\}/);
  assert.ok(iconRule, 'the icon-scroller sizing rule must exist');
  assert.match(iconRule[1], /flex:\s*0 0 var\(--icon\)/,
    'the home icons must be sized from the shared --icon');

  // The EXTENDED player's cover reads the SAME variable. This identity is the
  // whole requirement: one value, two consumers, so they cannot drift.
  const expandImg = STYLES.match(/^\.expand-img\s*\{([^}]*)\}/m);
  assert.ok(expandImg, 'the .expand-img rule must exist');
  assert.match(expandImg[1], /width:\s*var\(--icon\)/,
    'the extended player cover width must be the shared --icon');
  assert.match(expandImg[1], /height:\s*var\(--icon\)/,
    'the extended player cover height must be the shared --icon (a square)');

  // The song album cover in the extended player is the same square, so a song
  // and a talk programme show the same-sized cover.
  const songImg = STYLES.match(/^\.expand-img-song\s*\{([^}]*)\}/m);
  assert.ok(songImg, 'the .expand-img-song rule must exist');
  assert.match(songImg[1], /width:\s*var\(--icon\)/,
    'the extended player song cover must be the shared --icon');
  assert.match(songImg[1], /height:\s*var\(--icon\)/,
    'the extended player song cover must be the shared --icon (a square)');
});

test('WS75 C1: the NORMAL player cover stays 44px, as it was', () => {
  // The owner's correction: the normal player's cover is NOT the icon-sized one.
  // It must stay the 44px literal it has always been.
  const playerBlock = STYLES.slice(STYLES.indexOf('.player {'),
    STYLES.indexOf('}', STYLES.indexOf('.player {')));
  assert.match(playerBlock, /--player-art:\s*44px/,
    'the normal player cover must stay 44px, not the icon size');

  // And the cover element is sized from --player-art on BOTH axes.
  // Anchored to LINE START: the first `.player-thumb {` in the file is the
  // mini-bar's 40px rule, and an unanchored slice would read that instead.
  const thumb = STYLES.match(/^\.player-thumb\s*\{([^}]*)\}/m);
  assert.ok(thumb, 'the top-level .player-thumb rule must exist');
  assert.match(thumb[1], /width:\s*var\(--player-art\)/,
    'the normal cover width must come from --player-art');
  assert.match(thumb[1], /height:\s*var\(--player-art\)/,
    'the normal cover height must come from --player-art (a square)');
});

test('WS75 C1: the <=340px breakpoint moves --icon in step with the content padding', () => {
  // `.content`'s inline padding drops from 20px to 12px at <=340px, which
  // changes the icon arithmetic. The override must exist, or the cover and the
  // icons silently disagree on small phones -- a defect no other guard covers.
  assert.match(STYLES, /@media \(max-width: 340px\)\s*\{\s*:root\s*\{\s*--icon:/,
    'the <=340px icon size must be overridden to match the narrower content padding');
});

test('WS75 C2 (RESTATED WS80): there is no home-screen build number left to hide', () => {
  // ---- RESTATED (AGENTS.md 7b). WHAT IT USED TO SAY (WS75): "the build number is
  // hidden exactly while the player is visible", asserting
  // `body:has(.player.visible) .build-line { display: none }` AND that the bare
  // `.build-line` rule did NOT hide it at rest.
  //
  // WHY IT CHANGED -- OWNER, 2026-10-09: "the build id should not be present under
  // Nyheter anymore as it is not now. it is enough that the build id is visible
  // under Info." The element WS75's hide existed for was REMOVED outright, so the
  // hide has nothing to hide.
  //
  // The requirement WS75 served -- "the build number must not be readable while
  // the player is open" -- is now satisfied MORE strongly, by there being no
  // home-screen build number at all. Assert that, which the original could not:
  // both the element and the hide rule must be gone, and NO rule may reintroduce
  // a home-screen `.build-line`.
  assert.ok(!/\.build-line/.test(STYLES),
    'no .build-line rule may remain -- the element is removed (WS80), so the WS75 hide is dead too');
  // Read app.js directly: this file has no APP_JS binding (it is a CSS-focused
  // suite), and a cross-file guard here is cheap insurance against the element
  // being reintroduced by a later workstream.
  const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(!/class: 'build-line'/.test(APP_SRC),
    'no element may build a .build-line again');
  // The requirement behind it still holds: while the player is open, the owner
  // must not be able to read a build number. The About overlay is a modal the
  // player sits under, so assert the player still has a higher stacking order
  // than the About overlay's own layer -- if the player is on top, nothing in
  // the content flow underneath it can be read.
  const playerZ = STYLES.slice(STYLES.indexOf('.player {'),
    STYLES.indexOf('}', STYLES.indexOf('.player {')));
  const z = playerZ.match(/z-index:\s*(\d+)/);
  assert.ok(z && Number(z[1]) > 0,
    'the player must keep a positive z-index, so it still covers the content flow');
});

test('WS75 C4: the normal player row is a flex row again (cover is 44px)', () => {
  // The owner's correction restores the normal cover to 44px, so the original
  // single-row flex layout fits again. WS75's grid restructure was only needed
  // for the (wrong) 77px normal cover and is reverted.
  const row = STYLES.slice(STYLES.indexOf('.player-row {'),
    STYLES.indexOf('}', STYLES.indexOf('.player-row {')));
  assert.match(row, /display:\s*flex/,
    '.player-row must be a flex row again, now the normal cover is 44px');
  assert.ok(!/display:\s*grid/.test(row),
    '.player-row must NOT be a grid -- the grid was for the wrong 77px cover');
  // The grid child rules must be gone too, or they would be dead selectors
  // telling a future reader the row is still a grid.
  assert.ok(!/\.player-row > \.player-thumb\s*\{[^}]*grid-row/.test(STYLES),
    'the grid child rules must be removed with the grid');
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
