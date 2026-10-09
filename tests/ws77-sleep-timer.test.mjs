import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_RAW = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const STYLES_RAW = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const APP = stripComments(APP_RAW);
const STYLES = stripComments(STYLES_RAW);

// ---------------------------------------------------------------------------
// WS77 — the ±15 s glyph centering, and the sleep-timer watch
// ---------------------------------------------------------------------------
//
// OWNER, 2026-10-09, verbatim:
//   "1. on the iphone the circle arrows are not perfectly centered visually in
//    the rings. please look in to it, see attached.
//    2. on the same position as the round cross icon but on the left side of the
//    player i want you to add an icon for a round watch, and add sleep timer
//    functionality that stops the player after 15 minutes, 30 minutes, 1 hour or
//    2 hours if selections are set. the icon design should be the same as for
//    the close button exactly size and colour wise. only difference on the
//    button is that the x should be a round watch."

test('WS77 item 1: the ±15 s glyph is nudged so its ARC centres in the ring', () => {
  // MEASURED: the glyph's arc is centred at viewBox y=13 while the ring is at
  // y=12, so the visible arrow sits ~1 unit low. The fix is a small upward
  // transform on the glyph inside the button (a transform, so nothing reflows).
  const rule = STYLES.match(/\.player \.dvr-step-btn svg\s*\{([^}]*)\}/);
  assert.ok(rule, 'the ±15 s glyph must carry the centering nudge');
  const t = rule[1].match(/transform:\s*translateY\((-?[\d.]+)px\)/);
  assert.ok(t, 'the nudge must be a translateY');
  // Must be UPWARD (negative) -- the arc sits low, so a downward nudge would
  // make the misalignment worse.
  assert.ok(Number(t[1]) < 0,
    `the nudge must move the glyph UP; got ${t[1]}px`);
});

test('WS77 item 2: the watch button mirrors the close button exactly', () => {
  // "the icon design should be the same as for the close button exactly size and
  // colour wise". Both are 32px circles; the only difference is the glyph.
  // The close button's COLOURS live in their own one-line rule; the first
  // `.player-header .player-btn-close {` in the file is the grouped size rule,
  // so pick the close rule that actually carries a background.
  const closeMatches = [...STYLES.matchAll(/\.player-header \.player-btn-close\s*\{([^}]*)\}/g)];
  const closeColor = closeMatches.find((m) => /background/.test(m[1]));
  assert.ok(closeColor, 'the close button colour rule must exist');
  assert.match(closeColor[1], /background:\s*var\(--border\)/,
    'the close button is --border filled (the reference treatment)');
  assert.match(closeColor[1], /color:\s*var\(--text\)/,
    'the close button glyph is --text (the reference treatment)');

  const watch = STYLES.match(/^\.player-header \.player-sleep-btn\s*\{([^}]*)\}/m);
  assert.ok(watch, 'the sleep watch rule must exist');
  assert.match(watch[1], /width:\s*32px/,
    'the watch must be 32px like the close button');
  assert.match(watch[1], /height:\s*32px/,
    'the watch must be 32px tall like the close button');
  assert.match(watch[1], /background:\s*var\(--border\)/,
    'the watch must use the close button\'s own background colour');
  assert.match(watch[1], /color:\s*var\(--text\)/,
    'the watch must use the close button\'s own foreground colour');

  // The glyph differs: a round watch, not an ✕. It must be the stroke-drawn
  // circle + hands, so it reads as a watch rather than a filled dot. The class
  // is a TEMPLATE literal (it interpolates the `active` state), so anchor on the
  // class name, not a quoted string.
  const svg = APP.match(/player-sleep-btn[\s\S]*?html:\s*'([^']*)'/);
  assert.ok(svg, 'the sleep button must carry an inline SVG glyph');
  assert.match(svg[1], /<circle/,
    'the watch glyph must draw a circle (the watch case)');
  assert.match(svg[1], /stroke="currentColor"/,
    'the watch glyph must be stroke-drawn in the button colour');
  assert.doesNotMatch(svg[1], /M19 6\.41|17\.59 5/,
    'the glyph must NOT be the close button\'s ✕ path');
});

test('WS77 item 2: the watch overlays the header LEFT without moving the column', () => {
  // It must NOT be a flex child of the header: the header's text column is
  // STRUCTURAL (the width-only spacer holds the artwork column, exactly one
  // element wide), so a flex button would shrink that column and pull the text
  // and pills off the artwork's right edge.
  const watch = STYLES.match(/^\.player-header \.player-sleep-btn\s*\{([^}]*)\}/m);
  assert.match(watch[1], /position:\s*absolute/,
    'the watch must be absolutely positioned, not a flex child');
  assert.match(watch[1], /left:\s*0/,
    'the watch must sit at the header\'s left edge');
  // The header must be its positioning context.
  const header = STYLES.match(/^\.player-header\s*\{([^}]*)\}/m);
  assert.ok(header, '.player-header must exist');
  assert.match(header[1], /position:\s*relative/,
    'the header must be the watch\'s positioning context');
  // The width-only spacer must STILL be present and hold the artwork column.
  assert.match(APP, /const headerSpacer = el\('div', \{ class: 'player-header-spacer'/,
    'the spacer must not be replaced by the watch, or the text column moves');
});

test('WS77 item 2: the sleep timer offers 15/30/60/120 and stops the player', () => {
  // The four choices, exactly as the owner listed them.
  const opts = APP.match(/const SLEEP_OPTIONS = \[([^\]]*)\]/);
  assert.ok(opts, 'SLEEP_OPTIONS must exist');
  const values = opts[1].split(',').map((s) => Number(s.trim()));
  assert.deepEqual(values, [15, 30, 60, 120],
    'the four lengths must be 15, 30, 60 and 120 minutes');

  // The expiry must actually STOP the player, through the same path the close
  // button uses -- not a second teardown.
  const set = APP.match(/function setSleepTimer\(minutes\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(set, 'setSleepTimer must exist');
  assert.match(set[1], /setTimeout\(/,
    'the timer must be a setTimeout');
  assert.match(set[1], /stopAndClosePlayer\(\)/,
    'expiry must call stopAndClosePlayer');
});

test('WS77 item 2: stopping the player cancels a pending sleep timer', () => {
  // A timer that outlived the player would fire into a closed player; and a
  // manual close must not leave a pending stop behind.
  const stop = APP.match(/function stopAndClosePlayer\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(stop, 'stopAndClosePlayer must exist');
  assert.match(stop[1], /clearTimeout\(sleepTimerId\)/,
    'stopAndClosePlayer must clear the sleep timer');
  assert.match(stop[1], /sleepTimerEndsAt = null/,
    'stopAndClosePlayer must clear the end timestamp too');
});

test('WS77 item 2: the active state is visible while a timer runs', () => {
  // The button must reflect an armed timer, or the owner cannot tell it is on.
  const active = STYLES.match(/\.player-header \.player-sleep-btn\.active\s*\{([^}]*)\}/);
  assert.ok(active, 'the watch must have an active state');
  assert.match(active[1], /background:\s*var\(--accent\)/,
    'an armed timer must be visible (accent fill)');
  // And the render must apply it from the timer state, not a one-off.
  assert.match(APP, /sleepTimerActive\(\) \? ' active' : ''/,
    'the active class must be driven by the live timer state');
});
