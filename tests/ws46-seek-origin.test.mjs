// WS46 — the absolute media-timeline origin for the native-HLS DVR seek.
//
// WHAT THESE TESTS GUARD. WS46 changes what `target` IS on native HLS:
//
//     was:  target = seekableEnd - (Date.now() - startMs) / 1000
//     now:  target = (startMs - getStartDate()) / 1000
//
// The single property that makes this an experiment rather than another
// workaround is that `seekableEnd` IS NO LONGER AN INPUT. The transport-
// dependent gap between the buffered edge and the true edge (~8-10 s on
// Edge/hls.js, ~25 s on iPhone/Safari) cannot enter a formula that never
// mentions it. Every test below ultimately protects that.
//
// The risk that matters is not "does the arithmetic work". It is:
//   1. it leaking onto hls.js, where the media timeline is one the client
//      built and the declared start is not its origin;
//   2. it taking effect when the platform returned nothing usable — 0 is what
//      Safari returns for "unknown", and using it would put the target
//      decades away;
//   3. a calibration constant creeping back in, which is the exact shape of
//      the 31.5 s correction that was just reverted;
//   4. the fallback disappearing, which would silently change hls.js.

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

// The canary is incremented by the EXTRACTED FUNCTION ITSELF, so a harness
// that silently stops exercising app.js is detectable rather than producing
// confident fictional numbers (AGENTS.md §7).
function build() {
  let canary = 0;
  const factory = new Function('WS46_CANARY', `${grab('ws46SeekTarget')}
    return ws46SeekTarget;`);
  const fn = factory(() => { canary += 1; });
  return { fn, calls: () => canary };
}

// A media timeline whose origin is 19:00:00Z. A programme starting 10 s later
// must land at media position 10 — readable numbers, so a wrong answer is
// obvious rather than plausible.
const ORIGIN = Date.parse('2026-10-01T19:00:00.000Z');
const FALLBACK = 4242.42; // deliberately unlike any computed value

// Sanity for the "defensive guard" test below, computed here so the claim that
// the overflow case is unreachable is itself checked rather than asserted.
const MAX_VALUE_OVERFLOW_IS_FINITE =
  Number.isFinite((Number.MAX_VALUE - ORIGIN) / 1000);

// ---- 1. the native calculation ----
test('native-hls target is (startMs - origin)/1000', () => {
  const { fn, calls } = build();
  assert.equal(fn(ORIGIN, ORIGIN + 10000, 'native-hls', FALLBACK), 10);
  assert.equal(calls(), 1, 'canary: the extracted function must have executed');
});

test('a programme that started before the origin yields a negative position', () => {
  // Not clamped inside the function. A negative result is meaningful — it says
  // "before the media timeline begins" — and the CALLER's window guard is what
  // turns it into a toast. Clamping here would hide a real out-of-range seek.
  const { fn } = build();
  assert.equal(fn(ORIGIN, ORIGIN - 5000, 'native-hls', FALLBACK), -5);
});

test('fractional programme offsets are preserved, not truncated', () => {
  const { fn } = build();
  assert.equal(fn(ORIGIN, ORIGIN + 12345, 'native-hls', FALLBACK), 12.345);
});

test('the origin form is independent of any buffered edge', () => {
  // THE property of the experiment, asserted directly: change nothing except
  // the origin and the target follows. There is no second input that could
  // carry the buffered-edge error in.
  const { fn } = build();
  const a = fn(ORIGIN, ORIGIN + 30000, 'native-hls', FALLBACK);
  const b = fn(ORIGIN + 1000, ORIGIN + 30000, 'native-hls', FALLBACK);
  assert.equal(a, 30);
  assert.equal(b, 29, 'a 1 s later origin moves the target exactly 1 s earlier');
});

// ---- 2. invalid or missing origin ----
test('missing origin falls back', () => {
  const { fn } = build();
  assert.equal(fn(null, ORIGIN, 'native-hls', FALLBACK), FALLBACK);
  assert.equal(fn(undefined, ORIGIN, 'native-hls', FALLBACK), FALLBACK);
});

test('origin of 0 falls back — Safari returns 0 for "unknown"', () => {
  // The important one. 0 is a NUMBER and passes a naive isFinite check. Using
  // it as an epoch would produce a target ~55 years in the past.
  const { fn } = build();
  assert.equal(fn(0, ORIGIN, 'native-hls', FALLBACK), FALLBACK);
});

test('negative, NaN and Infinity origins fall back', () => {
  const { fn } = build();
  assert.equal(fn(-1, ORIGIN, 'native-hls', FALLBACK), FALLBACK);
  assert.equal(fn(NaN, ORIGIN, 'native-hls', FALLBACK), FALLBACK);
  assert.equal(fn(Infinity, ORIGIN, 'native-hls', FALLBACK), FALLBACK);
});

test('non-finite startMs falls back rather than producing NaN', () => {
  // NaN fails silently downstream, which is the worst failure mode there is.
  const { fn } = build();
  assert.equal(fn(ORIGIN, NaN, 'native-hls', FALLBACK), FALLBACK);
});

test('the non-finite-result guard is present but is NOT reachable by arithmetic', () => {
  // Reported honestly rather than dressed up as coverage. With both operands
  // finite and startDateMs > 0, (startMs - startDateMs)/1000 CANNOT overflow:
  // the numerator is bounded by MAX_VALUE and dividing by 1000 shrinks it.
  // Verified: (MAX_VALUE - origin)/1000 === 1.79e+305, still finite.
  //
  // So the `!Number.isFinite(target)` branch is DEFENSIVE. An earlier draft of
  // this test asserted it by passing MAX_VALUE and expecting a fallback — that
  // test was asserting something arithmetic cannot do, and it failed. A test
  // that cannot fail is not a test (§2), so it is replaced by an assertion that
  // the guard EXISTS, plus this note on why it cannot be exercised.
  assert.ok(MAX_VALUE_OVERFLOW_IS_FINITE,
    'sanity: the overflow case is genuinely unreachable, which is why it is not tested numerically');
  assert.match(grab('ws46SeekTarget'), /if \(!Number\.isFinite\(target\)\) return fallbackTarget;/,
    'the defensive non-finite guard must still exist');
});

// ---- 3. native-HLS only: the hls.js path is untouched ----
test('hlsjs and direct fall back even with a perfectly valid origin', () => {
  // Guards the blast radius. On hls.js the media timeline is one the client
  // assembled over a sliding window; the declared presentation start is not its
  // origin, so applying this there would introduce an error that is not in the
  // build today.
  const { fn } = build();
  assert.equal(fn(ORIGIN, ORIGIN + 10000, 'hlsjs', FALLBACK), FALLBACK);
  assert.equal(fn(ORIGIN, ORIGIN + 10000, 'direct', FALLBACK), FALLBACK);
  assert.equal(fn(ORIGIN, ORIGIN + 10000, null, FALLBACK), FALLBACK);
  assert.equal(fn(ORIGIN, ORIGIN + 10000, undefined, FALLBACK), FALLBACK);
});

test('an unrecognised transport string does not silently opt IN', () => {
  const { fn } = build();
  assert.equal(fn(ORIGIN, ORIGIN + 10000, 'nativeHls', FALLBACK), FALLBACK);
  assert.equal(fn(ORIGIN, ORIGIN + 10000, 'NATIVE-HLS', FALLBACK), FALLBACK);
  assert.equal(fn(ORIGIN, ORIGIN + 10000, '', FALLBACK), FALLBACK);
});

// ---- 4. no calibration anywhere (§5) ----
test('no calibration constant exists in the origin calculation', () => {
  // The 31.5 s correction was reverted. This is the assertion that stops it
  // coming back through a different route: the origin form must stay a pure
  // division with nothing added or subtracted.
  const body = grab('ws46SeekTarget');
  assert.match(body, /const target = \(startMs - startDateMs\) \/ 1000;/);
  assert.doesNotMatch(body, /\(startMs - startDateMs\) \/ 1000\s*[-+]\s*\d/,
    'no numeric constant may be added to or subtracted from the target');
  assert.doesNotMatch(body, /\bOFFSET\b|\bBIAS\b|\bCORRECTION\b|\bDELTA\b|\bLATENCY\b/,
    'no calibration vocabulary may appear');
  assert.doesNotMatch(body, /\bDVR_EDGE_CLOCK_BIAS\b|SEEK_CORRECTION|SEEK_BIAS|EDGE_CORRECTION/,
    'the reverted 31.5 s correction must not reappear');
});

test('no per-device or per-browser table exists anywhere in app.js', () => {
  // Explicitly scope-guarded, because the failure mode being avoided is a
  // calibration table keyed by device rather than a single constant.
  //
  // Scanned against CODE ONLY, comments stripped: the WS46 comment block
  // deliberately says "NO CALIBRATION ANYWHERE", so scanning raw text matched
  // the very words that document the rule. A guard that fails on its own
  // documentation is a broken guard — this version was red for that reason.
  const code = APP_JS
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');
  assert.doesNotMatch(code, /deviceId|device_id|machineId|machine_id|isIPhone|isIphone|userAgentMap/i,
    'no device-identity calibration may exist');
  assert.doesNotMatch(code, /OFFSETS_BY_|BY_DEVICE|PER_DEVICE|CALIBRATION/,
    'no per-device calibration table may exist');
});

// ---- 5. the fallback is intact and evaluated eagerly ----
test('the pre-existing equation survives verbatim as the fallback', () => {
  // If this line were deleted, hls.js would silently change behaviour. It is
  // the value every non-native transport seeks to.
  assert.match(APP_JS, /const fallbackTarget = end - behindMs \/ 1000;/);
  assert.match(APP_JS, /const end = cur\.seekableEnd;/,
    'the seek still reads the cached seekableEnd for the fallback');
});

test('the fallback is computed eagerly, before the origin read', () => {
  // Ordering is the guarantee: if the platform read throws, the old answer
  // already exists. This is why reverting the experiment is deleting a call
  // rather than restoring a lost computation.
  const body = grab('seekToProgramTime');
  const fb = body.indexOf('const fallbackTarget = end - behindMs / 1000;');
  const use = body.indexOf('ws46SeekTarget(');
  assert.ok(fb !== -1 && use !== -1, 'both must exist in seekToProgramTime');
  assert.ok(fb < use, 'the fallback must be computed before the experimental target');
});

test('the origin read is transport-guarded and exception-guarded', () => {
  const body = grab('ws46ReadStartDateMs');
  assert.match(body, /ws40Transport\(\) !== 'native-hls'\) return null/);
  assert.match(body, /typeof audioEl\.getStartDate !== 'function'\) return null/,
    'Chromium has no getStartDate; calling it there would throw');
  assert.match(body, /Number\.isFinite\(v\) && v > 0/);
  assert.match(body, /catch \{ return null; \}/);
});

// ---- 6. the window guard now protects the value actually seeked to ----
test('the out-of-window guard checks the target that will be seeked', () => {
  // Checking the fallback instead would let an experimental target land
  // outside the DVR window and hand currentTime an unreachable position — a
  // new failure mode rather than a fixed one.
  const body = grab('seekToProgramTime');
  assert.match(body, /if \(!Number\.isFinite\(target\) \|\| target < start\) \{/,
    'the guard must cover non-finite and out-of-window experimental targets');
});

// ---- 7. wiring: reachability (AGENTS.md §7a) ----
test('the production seek actually calls the experiment', () => {
  const body = grab('seekToProgramTime');
  assert.match(body, /ws46SeekTarget\(ws46ReadStartDateMs\(\), startMs,\s*ws40Transport\(\), fallbackTarget\)/,
    'the seek must route through ws46SeekTarget with the real origin read');
});

test('the diagnostic mirror uses the SAME calculation as the real seek', () => {
  // If the mirror kept the old equation the snapshot would describe a seek
  // that never happened, and the device result would be unreadable.
  const body = grab('recordSkipPress');
  assert.match(body, /ws46SeekTarget\(ws46ReadStartDateMs\(\), programmeStartMs,\s*ws40Transport\(\), fallbackTarget\)/);
  assert.doesNotMatch(body, /const target = end - behindMs \/ 1000;/,
    'the mirror must not report the uncorrected target');
});

test('the experiment did not spread to functions that must not change', () => {
  // seekBy, seekToLive, playheadWallMs and updateSeekableState are the
  // neighbours of this change. A panel fix that quietly moved a transport or a
  // poll is exactly what §15 check 5 exists to catch.
  for (const fn of ['seekBy', 'seekToLive', 'playheadWallMs',
    'updateSeekableState', 'programBoundary', 'pickByPosition']) {
    assert.doesNotMatch(grab(fn), /ws46|WS46/,
      `${fn} must not reference the WS46 experiment`);
  }
});

test('the hls.js configuration is untouched', () => {
  assert.match(APP_JS, /const HLS_CONFIG = \{[\s\S]*?liveSyncDurationCount: 3,/,
    'the hls.js config must be unchanged');
  assert.match(APP_JS, /backBufferLength: 90,/);
  assert.match(APP_JS, /maxBufferLength: 30,/);
});

// ---- 8. CANARY ----
test('CANARY: the harness executes the function extracted from app.js', () => {
  let canary = 0;
  const factory = new Function('WS46_CANARY', `${grab('ws46SeekTarget')}
    return ws46SeekTarget;`);
  const fn = factory(() => { canary += 1; });
  assert.equal(canary, 0, 'nothing has run yet');
  fn(ORIGIN, 1, 'native-hls', FALLBACK);
  fn(null, 1, 'hlsjs', FALLBACK);
  fn(0, 1, 'native-hls', FALLBACK);
  assert.equal(canary, 3, 'the extracted function must run once per call');
});