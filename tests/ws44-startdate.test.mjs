// WS44 — the getStartDate() timebase experiment.
//
// WHAT THESE TESTS GUARD. The experiment adds a second way of computing the
// playhead's wall-clock position and routes the live DVR metadata lookup
// through it on the native-HLS path only. The risk that matters is not "does
// the arithmetic work" — it is three specific ways this could be WRONG:
//
//   1. it silently takes effect on the hls.js path, where getStartDate()
//      describes a declared presentation time, not the sliding window hls.js
//      actually built;
//   2. it silently takes effect when the platform returns nothing usable
//      (missing method, throw, 0, NaN) — 0 is the value Safari returns for
//      "unknown", and treating it as an instant puts the playhead in 1970;
//   3. the old timebase stops being reachable, so reverting the experiment is
//      not one edit.
//
// Each test below asserts one of those, not merely that a sum is correct.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const APP_JS = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function grab(name) {
  const start = APP_JS.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} must exist in app.js`);
  let depth = 0;
  for (let i = start; i < APP_JS.length; i += 1) {
    if (APP_JS[i] === '{') depth += 1;
    else if (APP_JS[i] === '}') { depth -= 1; if (depth === 0) return APP_JS.slice(start, i + 1); }
  }
  throw new Error(`brace matching failed for ${name}`);
}

// ---- POSITIVE CANARY HARNESS (AGENTS.md §7) ----
// The counter is incremented by the EXTRACTED FUNCTION ITSELF, not by the
// test. Every numeric assertion below is meaningless unless the function
// extracted from app.js is genuinely the one being called, so the canary is
// asserted at the end of this file rather than merely printed.
function build() {
  const src = grab('ws44PlayheadWallMs');
  let canary = 0;
  const factory = new Function('WS44_CANARY', `${src}
    return ws44PlayheadWallMs;`);
  const fn = factory(() => { canary += 1; });
  return { fn, calls: () => canary };
}

const START = Date.parse('2026-10-01T18:00:00.000Z'); // a fixed, readable instant
const FALLBACK = 999; // deliberately unlike any computed value

// ---- 1. valid getStartDate + currentTime ----
test('uses getStartDate + currentTime on native-hls', () => {
  const { fn, calls } = build();
  assert.equal(fn(START, 12.5, 'native-hls', FALLBACK), START + 12500);
  assert.equal(calls(), 1, 'canary: the extracted function must have executed');
});

test('currentTime of 0 maps to the start date itself', () => {
  const { fn } = build();
  assert.equal(fn(START, 0, 'native-hls', FALLBACK), START);
});

test('fractional currentTime is kept, not truncated', () => {
  const { fn } = build();
  assert.equal(fn(START, 0.25, 'native-hls', FALLBACK), START + 250);
});

// ---- 2. invalid / missing getStartDate ----
test('missing start date falls back', () => {
  const { fn } = build();
  assert.equal(fn(null, 12.5, 'native-hls', FALLBACK), FALLBACK);
  assert.equal(fn(undefined, 12.5, 'native-hls', FALLBACK), FALLBACK);
});

test('start date of 0 falls back — Safari returns 0 for "unknown"', () => {
  // The important one. 0 is a NUMBER and would pass a naive isFinite check.
  // Treating it as an instant would place the playhead in 1970, which is the
  // single worst failure this function could have.
  const { fn } = build();
  assert.equal(fn(0, 12.5, 'native-hls', FALLBACK), FALLBACK);
});

test('negative start date falls back', () => {
  const { fn } = build();
  assert.equal(fn(-1, 12.5, 'native-hls', FALLBACK), FALLBACK);
});

test('NaN and Infinity start dates fall back', () => {
  const { fn } = build();
  assert.equal(fn(NaN, 12.5, 'native-hls', FALLBACK), FALLBACK);
  assert.equal(fn(Infinity, 12.5, 'native-hls', FALLBACK), FALLBACK);
});

test('non-finite currentTime falls back rather than producing NaN', () => {
  // Before the media has metadata, currentTime is NaN. Returning NaN here
  // would poison every comparison downstream, because NaN fails silently
  // rather than loudly.
  const { fn } = build();
  assert.equal(fn(START, NaN, 'native-hls', FALLBACK), FALLBACK);
  assert.equal(fn(START, Infinity, 'native-hls', FALLBACK), FALLBACK);
});

// ---- 3. native-HLS only ----
test('hlsjs path uses the fallback even with a perfectly valid start date', () => {
  // This is the guard for the whole experiment's blast radius. If this test
  // ever goes red, the native timebase has leaked onto a path where
  // getStartDate() describes a different thing than the metadata timeline.
  const { fn } = build();
  assert.equal(fn(START, 12.5, 'hlsjs', FALLBACK), FALLBACK);
  assert.equal(fn(START, 12.5, 'direct', FALLBACK), FALLBACK);
  assert.equal(fn(START, 12.5, null, FALLBACK), FALLBACK);
  assert.equal(fn(START, 12.5, undefined, FALLBACK), FALLBACK);
});

test('an unrecognised transport string does not silently opt IN', () => {
  const { fn } = build();
  assert.equal(fn(START, 12.5, 'nativeHls', FALLBACK), FALLBACK);
  assert.equal(fn(START, 12.5, 'NATIVE-HLS', FALLBACK), FALLBACK);
  assert.equal(fn(START, 12.5, '', FALLBACK), FALLBACK);
});

// ---- 4. hls.js behaviour unchanged, and the old path still reachable ----
test('the pre-existing playheadWallMs is unchanged and still the fallback', () => {
  const body = grab('playheadWallMs');
  // The established model, verbatim. If this drifts, the fallback silently
  // stops being the app's historical answer and "revert the experiment" stops
  // meaning anything.
  assert.match(body, /const end = state\.current \? state\.current\.seekableEnd : null;/);
  assert.match(body, /if \(!Number\.isFinite\(end\)\) return Date\.now\(\);/);
  assert.match(body, /return Date\.now\(\) - \(end - \(audioEl\.currentTime \|\| 0\)\) \* 1000;/);
});

test('the experimental accessor always evaluates the fallback first', () => {
  const body = grab('playheadWallMs44');
  // The fallback is an argument, not an `||`. That ordering is what guarantees
  // the old answer exists even when getStartDate() throws.
  assert.match(body, /const fallback = playheadWallMs\(\);/);
  assert.match(body, /typeof audioEl\.getStartDate === 'function'/);
  assert.match(body, /ws44PlayheadWallMs\(startDateMs, audioEl\.currentTime, transport, fallback\)/);
});

test('getStartDate is guarded by typeof because Chromium has no such method', () => {
  const body = grab('playheadWallMs44');
  assert.match(body, /try\s*\{/);
  assert.match(body, /catch \{ startDateMs = null; \}/);
});

// ---- 5. wiring: the experiment reaches the metadata lookup ----
test('the live DVR metadata lookup reads through the experimental timebase', () => {
  // Reachability (AGENTS.md §7a): a correct, tested, never-executed function
  // is the most expensive defect in this repo. Assert the call exists at the
  // production site, not just that the helper exists.
  const start = APP_JS.indexOf('function resolveMetadataForPosition(');
  assert.notEqual(start, -1, 'resolveMetadataForPosition must exist');
  const body = APP_JS.slice(start, APP_JS.indexOf('\n  function ', start + 10));
  assert.match(body, /const atMs = playheadWallMs44\(\);/);
  assert.doesNotMatch(body, /const atMs = playheadWallMs\(\);/);
});

test('the seek reads the origin directly, never the metadata playhead', () => {
  // WS46 SUPERSEDED the FORMULA half of this test. What remains — and is the
  // property worth keeping — is that the seek does not borrow the METADATA
  // timebase. `playheadWallMs44()` maps a position to a wall clock; using it
  // inside the seek would reintroduce the very assumption under test, and the
  // seek must stay independent of metadata resolution.
  const start = APP_JS.indexOf('function seekToProgramTime(');
  assert.notEqual(start, -1, 'seekToProgramTime must exist');
  const body = APP_JS.slice(start, APP_JS.indexOf('\n  function ', start + 10));
  assert.doesNotMatch(body, /playheadWallMs44/);
  assert.doesNotMatch(body, /playheadWallMs\(\)/);
});

test('both timebases are recorded in the snapshot, not just the new one', () => {
  // If only the experimental value were recorded there would be nothing to
  // compare it against on the device, and the experiment could not be judged.
  // The OLD value must still be recorded — reverting the experiment is then a
  // code change, not a loss of the reference reading.
  assert.match(APP_JS, /playheadWallMs: \(cur && cur\.kind === 'live'\) \? playheadWallMs\(\) : null,/);
  assert.match(APP_JS, /playheadWallMs44: \(cur && cur\.kind === 'live'\) \? playheadWallMs44\(\) : null,/);
  assert.match(APP_JS, /getStartDateAvailable: typeof audioEl\.getStartDate === 'function',/);
  assert.match(APP_JS, /playheadDelta44Ms: \(cur && cur\.kind === 'live'/);
});

// ---- 6. the canary itself ----
test('CANARY: the harness executes the function extracted from app.js', () => {
  // If this fails, every numeric assertion above is comparing stand-ins rather
  // than the shipped function, and none of them mean anything.
  let canary = 0;
  const factory = new Function('WS44_CANARY', `${grab('ws44PlayheadWallMs')}
    return ws44PlayheadWallMs;`);
  const fn = factory(() => { canary += 1; });
  assert.equal(canary, 0, 'nothing has run yet');
  fn(START, 1, 'native-hls', FALLBACK);
  fn(null, 1, 'hlsjs', FALLBACK);
  fn(0, 1, 'native-hls', FALLBACK);
  assert.equal(canary, 3, 'the extracted function must run once per call');
});