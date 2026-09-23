/**
 * Regression tests for the 2026-09-22 second fix pass:
 *   1. Gesture disambiguation — vertical swipe on the DVR bar must NOT seek
 *      (the "slider jumps to zero by itself" bug).
 *   2. ±15 s step buttons on the DVR row.
 *   3. Program prev/next skip via SR's schedule (tablå), with graceful
 *      degradation when the schedule API is unavailable.
 *
 * Pure logic mirrored from the tracked root app.js — keep in sync.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

// ---- 1. Gesture disambiguation ----

test('gesture guard: drag axis is decided from pointer movement, not assumed', () => {
  assert.ok(APP_JS.includes("dragAxis = null; // decided on first significant move"),
    'dragAxis must start undecided');
  assert.ok(APP_JS.includes("dragAxis = dx >= dy ? 'x' : 'y';"),
    'axis decision must compare dx vs dy');
});

test('gesture guard: vertical-dominant drag aborts WITHOUT committing a seek', () => {
  // The 'y' branch must clear dragging/dragFrac and restore the position —
  // never call seekToWindowFraction.
  const moveHandler = APP_JS.slice(
    APP_JS.indexOf("bar.addEventListener('pointermove'"),
    APP_JS.indexOf("const endDrag = (e) => {")
  );
  assert.ok(moveHandler.includes("dragAxis === 'y'"), 'y-intent branch must exist');
  assert.ok(moveHandler.includes('dragging = false'), 'must abort the drag');
  assert.ok(!moveHandler.includes('seekToWindowFraction'),
    'the move handler must never seek directly');
});

test('gesture guard: endDrag only commits for horizontal drags or plain taps', () => {
  const endDrag = APP_JS.slice(
    APP_JS.indexOf('const endDrag = (e) => {'),
    APP_JS.indexOf("bar.addEventListener('pointerup', endDrag)")
  );
  assert.ok(endDrag.includes("const commit = dragAxis === 'x' || dragAxis === null;"),
    'commit gate must exist');
  assert.ok(endDrag.includes('if (commit && frac !== null) seekToWindowFraction(frac);'),
    'seek must be gated on commit');
});

// ---- 2. ±15 s step buttons ----

test('±15s buttons exist in the main controls row flanking play/pause (2026-09-23 repositioning)', () => {
  assert.ok(APP_JS.includes("'aria-label': 'Bakåt 15 sekunder'"), 'back 15 button');
  assert.ok(APP_JS.includes("'aria-label': 'Framåt 15 sekunder'"), 'fwd 15 button');
  assert.ok(APP_JS.includes('if (isDvr) seekBy(-SEEK_STEP_S_DVR)'), 'back wiring (DVR branch)');
  assert.ok(APP_JS.includes('if (isDvr) { seekBy(SEEK_STEP_S_DVR); return; }'), 'fwd wiring (DVR branch)');
  // Buttons flank play/pause: prevProgram, back, playPause, fwd, nextProgram
  const order = ['prevProgramBtn) controls.appendChild', 'backBtn) controls.appendChild', 'controls.appendChild(playPause)', 'fwdBtn) controls.appendChild', 'nextProgramBtn) controls.appendChild'];
  let last = -1;
  for (const frag of order) {
    const idx = APP_JS.indexOf(frag);
    assert.ok(idx > last, `controls order: ${frag}`);
    last = idx;
  }
});

test('LIVE label button removed from DVR row (pill + right-edge tap instead)', () => {
  assert.ok(!APP_JS.includes("class: 'player-live-label'"), 'no live-label button');
  assert.ok(APP_JS.includes('frac >= 0.88) seekToLive()'), 'right-edge tap zone wired');
});

test('seekBy clamps to the seekable window start (no negative positions)', () => {
  // Mirror of seekBy in app.js — keep in sync.
  function seekTarget(currentTime, delta, seekableStart) {
    const start = Number.isFinite(seekableStart) ? seekableStart : 0;
    return Math.max(start, (currentTime || 0) + delta);
  }
  assert.equal(seekTarget(100, -15, 0), 85);
  assert.equal(seekTarget(10, -15, 0), 0); // clamped, never negative
  assert.equal(seekTarget(50, -15, 40), 40); // clamped to window start
  assert.equal(seekTarget(100, 15, 0), 115);
});

test('±15s buttons have CSS (36px wide, 44px touch target)', () => {
  const m = STYLES_CSS.match(/\.dvr-step-btn\s*\{[^}]*height:\s*44px[^}]*\}/);
  assert.ok(m, '.dvr-step-btn must have a 44px touch target');
});

// ---- 3. Program skip ----

// Mirror of programBoundary in app.js — keep in sync.
function programBoundary(schedule, positionMs, direction) {
  if (!Array.isArray(schedule) || !schedule.length) return null;
  if (direction < 0) {
    const prev = [...schedule].reverse().find((ev) => ev.startMs < positionMs - 1000);
    return prev ? { startMs: prev.startMs, title: prev.title } : null;
  }
  const next = schedule.find((ev) => ev.startMs > positionMs + 1000);
  return next ? { startMs: next.startMs, title: next.title } : null;
}

const SCHEDULE = [
  { startMs: 6 * 3600 * 1000, endMs: 7 * 3600 * 1000, title: 'Morgonpasset' },
  { startMs: 9 * 3600 * 1000, endMs: 10 * 3600 * 1000, title: 'Program A' },
  { startMs: 12 * 3600 * 1000, endMs: 13 * 3600 * 1000, title: 'Program B' },
  { startMs: 15 * 3600 * 1000, endMs: 16 * 3600 * 1000, title: 'Eftermiddag' },
];

test('programBoundary: prev restarts the CURRENT programme (podcast-app semantics)', () => {
  // 30 min into Program A: prev → Program A's start. Pressing again from
  // there goes to Morgonpasset (position then < A's start + tolerance).
  const pos = 9.5 * 3600 * 1000; // inside Program A
  const prev = programBoundary(SCHEDULE, pos, -1);
  assert.equal(prev.title, 'Program A');
  assert.equal(prev.startMs, 9 * 3600 * 1000);
  // From A's start, prev → Morgonpasset.
  const prev2 = programBoundary(SCHEDULE, 9 * 3600 * 1000, -1);
  assert.equal(prev2.title, 'Morgonpasset');
});

test('programBoundary: next finds the programme after the position', () => {
  const pos = 9.5 * 3600 * 1000; // inside Program A
  const next = programBoundary(SCHEDULE, pos, +1);
  assert.equal(next.title, 'Program B');
  assert.equal(next.startMs, 12 * 3600 * 1000);
});

test('programBoundary: position before all programmes → null (button hidden)', () => {
  const posBeforeAll = 5 * 3600 * 1000; // before everything
  assert.equal(programBoundary(SCHEDULE, posBeforeAll, -1), null);
});

test('programBoundary: no next programme → null (button stays hidden)', () => {
  const pos = 15.5 * 3600 * 1000; // inside the last programme
  assert.equal(programBoundary(SCHEDULE, pos, +1), null);
});

test('programBoundary: empty/missing schedule → null (graceful degradation)', () => {
  assert.equal(programBoundary(null, 9.5 * 3600 * 1000, -1), null);
  assert.equal(programBoundary([], 9.5 * 3600 * 1000, +1), null);
});

test('programBoundary: 1 s tolerance prevents boundary flicker', () => {
  // Position exactly at a programme start (±1 s) must not match that event.
  const pos = 9 * 3600 * 1000 + 500; // 500 ms into Program A
  const prev = programBoundary(SCHEDULE, pos, -1);
  assert.equal(prev.title, 'Morgonpasset'); // not Program A itself
});

// Mirror of seekToProgramTime's window mapping — keep in sync.
function programSeekTarget(startMs, nowMs, seekableEnd, seekableStart) {
  const behindMs = nowMs - startMs;
  if (behindMs < 0) return null; // future programme
  const target = seekableEnd - behindMs / 1000;
  const start = Number.isFinite(seekableStart) ? seekableStart : 0;
  if (target < start) return 'out-of-window';
  return target;
}

test('program seek maps wall-clock start → DVR window position', () => {
  const now = Date.now();
  const startMs = now - 30 * 60 * 1000; // 30 min ago
  const end = 10880;
  const target = programSeekTarget(startMs, now, end, 0);
  assert.ok(Math.abs(target - (end - 1800)) < 1, '30 min behind live edge');
});

test('program seek: future programme → null (no seek)', () => {
  const now = Date.now();
  const startMs = now + 60 * 60 * 1000; // 1 h in the future
  assert.equal(programSeekTarget(startMs, now, 10880, 0), null);
});

test('program seek: older than the 3-h window → out-of-window (toast, no seek)', () => {
  const now = Date.now();
  const startMs = now - 4 * 3600 * 1000; // 4 h ago — outside the window
  assert.equal(programSeekTarget(startMs, now, 10880, 0), 'out-of-window');
});

test('schedule fetch degrades gracefully: buttons hidden until schedule resolves', () => {
  assert.ok(APP_JS.includes("style: 'display:none;'"), 'program buttons start hidden');
  assert.ok(APP_JS.includes('fetchSchedule(cur.id)'), 'schedule fetch wired');
  assert.ok(APP_JS.includes('value = parsed.length ? parsed : null;'),
    'empty/failed schedule → null (buttons stay hidden)');
});

test('schedule fetch uses the SR scheduledepisodes endpoint with channelid+date', () => {
  assert.ok(APP_JS.includes('/scheduledepisodes?channelid='), 'endpoint');
  assert.ok(!APP_JS.includes('/scheduledevents?channelid='), 'dead scheduledevents endpoint must not be used');
  assert.ok(APP_JS.includes('&date='), 'date param');
  assert.ok(APP_JS.includes('pagination=false'), 'pagination=false param');
});

test('schedule is cached per channel+day for 10 minutes', () => {
  assert.ok(APP_JS.includes('scheduleCache'), 'cache exists');
  assert.ok(APP_JS.includes('10 * 60 * 1000'), '10-minute TTL');
});