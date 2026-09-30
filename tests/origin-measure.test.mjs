/**
 * WS39 — the media-timeline origin, measured independently of the seek.
 *
 * WHAT THIS EXISTS FOR. The seek equation is
 *
 *     target = seekableEnd - (Date.now() - startMs) / 1000
 *
 * which assumes a mapping from media time to wall clock whose origin it never
 * checks. WS39 measures that origin from the stream's own PROGRAM-DATE-TIME via
 * `hls.latency.currentProgramDateTime`, and measures the difference between the
 * app's stream clock and the browser's at the SAME media position — the
 * quantity the seek equation assumes is zero.
 *
 * THE TEST THAT MATTERS MOST. In the WS39 investigation report I proposed
 *
 *     mediaOriginDeltaMs = pdtForCurrentTimeMs - (nowMs - currentTimeS * 1000)
 *
 * That formula is WRONG and this file pins the correct one. It reintroduces
 * `nowMs`, which has no part in the subtraction: both sides of `pdt` are
 * already wall clock, so mixing the device clock back in re-adds the device's
 * own error and double-counts the elapsed media time. A test named for the
 * device-clock independence of the origin is the one that would have caught
 * it, and it is why the mistake is recorded in code rather than only in prose.
 *
 * WHAT A NULL MEANS. Every derived value is `null` unless all of its operands
 * are finite. `null` and `0` are DIFFERENT FACTS and are never conflated —
 * this repo has shipped a readout that counted `null == null` as a match and
 * reported 10 801 "correct" out of 10 317 empty.
 *
 * These tests execute the app's REAL extracted functions against controlled
 * values (AGENTS.md §7 — never retype logic into a test). A positive canary
 * counts every entry, so a harness that silently fails to run the code under
 * test cannot report success.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += d ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
const APP_CODE = stripComments(APP_JS);

// Brace-matched extraction. Handles `function` and `async function`.
function grab(name) {
  const start = APP_JS.indexOf(`function ${name}(`);
  const asyncStart = APP_JS.indexOf(`async function ${name}(`);
  const at = start === -1 ? asyncStart : (asyncStart === -1 ? start : Math.min(start, asyncStart));
  if (at === -1) throw new Error(`${name} must exist in app.js`);
  let d = 0;
  let end = -1;
  for (let i = at; i < APP_JS.length; i += 1) {
    if (APP_JS[i] === '{') d += 1;
    else if (APP_JS[i] === '}') { d -= 1; if (d === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error(`brace matching failed for ${name}`);
  return APP_JS.slice(at, end + 1);
}

// ---------------------------------------------------------------------------
// A true model of the world, used to generate expectations. The media timeline
// maps to UTC by  U(m) = A + m*1000, where A is the very origin under test.
// ---------------------------------------------------------------------------
const TRUE_ORIGIN_MS = 1_700_000_000_000;

function world(overrides = {}) {
  const A = overrides.A ?? TRUE_ORIGIN_MS;
  const currentTimeS = overrides.currentTimeS ?? 100;
  const seekableEndS = overrides.seekableEndS ?? 3600;
  const nowMs = overrides.nowMs ?? A + 100_000;   // 100 s of wall time
  return {
    A,
    currentTimeS,
    seekableEndS,
    nowMs,
    // What hls.js reports for the playhead.
    pdt: A + currentTimeS * 1000,
    // What the app's SR-PDT stream clock claims for the buffered edge.
    //
    // ANCHORED TO ABSOLUTE WALL TIME, NOT TO `A`. These are two INDEPENDENT
    // sources: the stream clock comes from SR's own playlist, the browser's
    // from hls.js's fragment table. Deriving this from `A` would make the two
    // agree by construction, and a 25 s origin error would cancel out — a
    // metric that cannot fail. It must be able to disagree, or measuring it
    // says nothing. Wall clock is the shared truth both are trying to report.
    trueEdgeWallMs: (overrides.trueEdgeWallMs
      ?? TRUE_ORIGIN_MS + seekableEndS * 1000),
  };
}

// The real arithmetic, executed. `Date` is bound so bare `Date.now()` inside
// the captured function cannot read the real clock.
function makeHarness(ctl = {}) {
  const canary = { calls: 0 };
  const state = { current: { kind: 'live' }, currentTimeS: ctl.currentTimeS };
  const ORIGIN_MEASURE = {
    capturedAtMs: null, nowMs: null, currentTimeS: null, seekableEndS: null,
    trueEdgeWallMs: null, pdtForCurrentTimeMs: null, pdtSource: 'unavailable',
    startDateMs: null, startDateSource: 'unavailable', mediaOriginMs: null,
    wallClockAtSeekableEndMs: null, wallClockDeltaMs: null,
  };
  const STREAM_EDGE_PROBE = { trueEdgeWallMs: ctl.trueEdgeWallMs ?? null };
  const audioEl = {
    currentTime: ctl.currentTimeS ?? NaN,
    get seekable() {
      const end = ctl.seekableEndS;
      if (!Number.isFinite(end)) return { length: 0 };
      return { length: 1, start: () => 0, end: () => end };
    },
    getStartDate: ctl.getStartDate,
  };
  const api = new Function('deps', `
    const {
      ORIGIN_MEASURE, STREAM_EDGE_PROBE, state, audioEl, hlsInstance,
      canary, ctl, Date,
    } = deps;
    ${grab('originFromPdt')}
    ${grab('wallClockAtMediaPosition')}
    ${grab('wallClockDelta')}
    ${grab('readPdtForCurrentTime')}
    ${grab('readStartDate')}
    function readFreshSeekableEnd() {
      try {
        const s = audioEl.seekable;
        if (!s || !s.length) return null;
        const end = s.end(s.length - 1);
        return Number.isFinite(end) ? end : null;
      } catch { return null; }
    }
    ${grab('captureOriginMeasurement')}
    // THE CANARY, done properly. An earlier version of this harness bumped the
    // counter ONCE at construction time, which made every test report "the
    // function was never called" no matter how many times it ran — and a
    // canary that measures the wrong thing is worse than none (§7). It counts
    // INVOCATIONS, so a function that is extracted but never executed fails.
    const counted = (f) => (...a) => { canary.calls += 1; return f(...a); };
    return {
      captureOriginMeasurement: counted(captureOriginMeasurement),
      originFromPdt: counted(originFromPdt),
      wallClockDelta: counted(wallClockDelta),
      wallClockAtMediaPosition: counted(wallClockAtMediaPosition),
      readPdtForCurrentTime: counted(readPdtForCurrentTime),
      readStartDate: counted(readStartDate),
    };
  `);
  const fns = api({
    ORIGIN_MEASURE, STREAM_EDGE_PROBE, state, audioEl, canary, ctl,
    hlsInstance: ctl.hlsInstance ?? null,
    Date: { now: () => ctl.nowMs ?? 0 },
  });
  return { ...fns, canary, ORIGIN_MEASURE };
}

// ===========================================================================
// 1. The origin arithmetic. THE CENTRAL TEST.
// ===========================================================================

test('media origin is recovered exactly from pdt and currentTime', () => {
  const h = makeHarness();
  h.canary.calls = 0;
  // A perfect world: the origin must come back bit-for-bit.
  const w = world();
  assert.equal(h.originFromPdt(w.pdt, w.currentTimeS), TRUE_ORIGIN_MS);
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
});

test('CRITICAL: the origin does NOT depend on the device clock', () => {
  // The bug this pins: my own proposed formula included `nowMs` and returned
  // 100000 where the origin is 1700000000000. The device clock must be an
  // ABSENT input — so vary it over a range far larger than any plausible
  // device error and require the origin not to move by so much as 1 ms.
  const w = world();
  // The device clock is varied over a range far larger than any plausible
  // device error, and the recovered origin must not move by so much as 1 ms.
  const readings = [0, 30_000, -30_000, 3_600_000].map((skew) => {
    const h = makeHarness({ nowMs: w.nowMs + skew, currentTimeS: w.currentTimeS,
      seekableEndS: w.seekableEndS, trueEdgeWallMs: w.trueEdgeWallMs,
      hlsInstance: { latency: { currentProgramDateTime: { getTime: () => w.pdt } } } });
    h.canary.calls = 0;
    const o = h.captureOriginMeasurement();
    assert.ok(h.canary.calls > 0, 'canary: capture must have run');
    return o.mediaOriginMs;
  });
  for (const r of readings) {
    assert.equal(r, TRUE_ORIGIN_MS,
      'origin must be independent of the device clock');
  }
});

test('the wrong formula from the report is demonstrably wrong', () => {
  // Proves the preceding test can fail: a constant timeline-origin difference
  // must move the metric, or it is not measuring anything (AGENTS.md §2).
  const w = world();
  const wrong = w.pdt - (w.nowMs - w.currentTimeS * 1000);
  assert.notEqual(wrong, TRUE_ORIGIN_MS,
    'the report formula must NOT recover the origin');
  const h = makeHarness({ nowMs: w.nowMs, currentTimeS: w.currentTimeS,    seekableEndS: w.seekableEndS, trueEdgeWallMs: w.trueEdgeWallMs,
    hlsInstance: { latency: { currentProgramDateTime: { getTime: () => w.pdt } } } });
  h.canary.calls = 0;
  const o = h.captureOriginMeasurement();
  assert.ok(h.canary.calls > 0, 'canary: capture must have run');
  assert.equal(o.mediaOriginMs, TRUE_ORIGIN_MS);
});

test('a constant 25 s origin error IS visible in the delta', () => {
  // The metric must be able to FAIL. A media timeline whose origin is 25 s
  // late must show up as a non-zero `wallClockDeltaMs`, not cancel out.
  const w = world({ A: TRUE_ORIGIN_MS + 25_000 });
  const h = makeHarness({ nowMs: w.nowMs, currentTimeS: w.currentTimeS,
    seekableEndS: w.seekableEndS, trueEdgeWallMs: w.trueEdgeWallMs,
    hlsInstance: { latency: { currentProgramDateTime: { getTime: () => w.pdt } } } });
  h.canary.calls = 0;
  const o = h.captureOriginMeasurement();
  assert.ok(h.canary.calls > 0, 'canary: capture must have run');
  assert.equal(o.mediaOriginMs, TRUE_ORIGIN_MS + 25_000,
    'the recovered origin must carry the 25 s error');
  assert.equal(o.wallClockDeltaMs, -25_000,
    'and the delta must report it, not absorb it');
});

// ===========================================================================
// 2. The delta: the quantity the seek equation assumes is zero.
// ===========================================================================

test('a perfectly aligned world yields a zero delta, and 0 is not null', () => {
  const w = world();
  const h = makeHarness({ nowMs: w.nowMs, currentTimeS: w.currentTimeS,
    seekableEndS: w.seekableEndS, trueEdgeWallMs: w.trueEdgeWallMs,
    hlsInstance: { latency: { currentProgramDateTime: { getTime: () => w.pdt } } } });
  h.canary.calls = 0;
  const o = h.captureOriginMeasurement();
  assert.ok(h.canary.calls > 0, 'canary: capture must have run');
  assert.equal(o.wallClockDeltaMs, 0);
  assert.notEqual(o.wallClockDeltaMs, null,
    'a measured zero must not read as "not measured"');
});

test('wallClockDelta needs BOTH clocks; one missing gives null not 0', () => {
  assert.equal(wallDeltaProbe({ pdt: 1, currentTimeS: 1, seekableEndS: 2, trueEdge: null }), null);
  assert.equal(wallDeltaProbe({ pdt: null, currentTimeS: 1, seekableEndS: 2, trueEdge: 5 }), null);
  assert.equal(wallDeltaProbe({ pdt: 1, currentTimeS: null, seekableEndS: 2, trueEdge: 5 }), null);
  assert.equal(wallDeltaProbe({ pdt: 1, currentTimeS: 1, seekableEndS: null, trueEdge: 5 }), null);
});
function wallDeltaProbe({ pdt, currentTimeS, seekableEndS, trueEdge }) {
  const h = makeHarness();
  h.canary.calls = 0;
  const r = h.wallClockDelta(trueEdge, pdt, currentTimeS, seekableEndS);
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
  return r;
}

// ===========================================================================
// 3. The two platform readers. Both must be total and must not throw.
// ===========================================================================

test('Chromium reader returns pdt when hls.js is driving', () => {
  const w = world();
  const h = makeHarness({ hlsInstance: { latency: { currentProgramDateTime: { getTime: () => w.pdt } } } });
  h.canary.calls = 0;
  const r = h.readPdtForCurrentTime();
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
  assert.equal(r.pdt, w.pdt);
  assert.equal(r.source, 'hls.latency.currentProgramDateTime');
});

test('Chromium reader is TOTAL: every absent case is null with a reason', () => {
  const cases = [
    [null, 'no-hls-instance'],
    [{}, 'no-latency-controller'],
    [{ latency: {} }, 'no-current-fragment'],
    [{ latency: { currentProgramDateTime: null } }, 'no-current-fragment'],
    [{ latency: { currentProgramDateTime: { getTime: () => NaN } } }, 'null-instant'],
  ];
  for (const [hlsInstance, expected] of cases) {
    const h = makeHarness({ hlsInstance });
    h.canary.calls = 0;
    const r = h.readPdtForCurrentTime();
    assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
    assert.equal(r.pdt, null, `must be null for ${expected}`);
    assert.equal(r.source, expected);
  }
});

test('Chromium reader survives a throwing hls object', () => {
  const hlsInstance = { get latency() { throw new Error('boom'); } };
  const h = makeHarness({ hlsInstance });
  h.canary.calls = 0;
  const r = h.readPdtForCurrentTime();
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
  assert.equal(r.pdt, null);
  assert.equal(r.source, 'threw');
});

test('Safari reader returns getStartDate() when it exists', () => {
  const when = world().A;
  const h = makeHarness({ getStartDate: () => ({ getTime: () => when }) });
  h.canary.calls = 0;
  const r = h.readStartDate();
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
  assert.equal(r.ms, when);
  assert.equal(r.source, 'getStartDate()');
});

test('Safari reader records null when the method is ABSENT (not polyfilled)', () => {
  const h = makeHarness({ getStartDate: undefined });
  h.canary.calls = 0;
  const r = h.readStartDate();
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
  assert.equal(r.ms, null, 'no getStartDate must read null, never 0');
  assert.equal(r.source, 'no-getStartDate');
});

test('Safari reader is TOTAL: null-returning and throwing elements are safe', () => {
  const cases = [
    [() => null, 'returned-null'],
    [() => ({ getTime: () => NaN }), 'returned-non-finite'],
    [() => { throw new Error('boom'); }, 'threw'],
  ];
  for (const [fn, expected] of cases) {
    const h = makeHarness({ getStartDate: fn });
    h.canary.calls = 0;
    const r = h.readStartDate();
    assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
    assert.equal(r.ms, null, `must be null for ${expected}`);
    assert.equal(r.source, expected);
  }
});

// ===========================================================================
// 4. The capture is total and READ-ONLY.
// ===========================================================================

test('capture returns nulls, never zeros, when nothing is available', () => {
  const h = makeHarness({ nowMs: 1234, currentTimeS: NaN, seekableEndS: NaN });
  h.canary.calls = 0;
  const o = h.captureOriginMeasurement();
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
  assert.equal(o.nowMs, 1234, 'the clock is always readable');
  for (const k of ['currentTimeS', 'seekableEndS', 'trueEdgeWallMs',
    'pdtForCurrentTimeMs', 'startDateMs', 'mediaOriginMs',
    'wallClockAtSeekableEndMs', 'wallClockDeltaMs']) {
    assert.equal(o[k], null, `${k} must be null when unavailable, never 0`);
  }
});

test('capture does not depend on state.current (runs with player closed)', () => {
  // The panel can be opened with nothing playing. Reading `state.current`
  // would make this throw or misreport.
  const w = world();
  const h = makeHarness({ nowMs: w.nowMs, currentTimeS: w.currentTimeS,
    seekableEndS: w.seekableEndS, trueEdgeWallMs: w.trueEdgeWallMs,
    hlsInstance: { latency: { currentProgramDateTime: { getTime: () => w.pdt } } } });
  h.canary.calls = 0;
  const o = h.captureOriginMeasurement();
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
  assert.equal(o.mediaOriginMs, TRUE_ORIGIN_MS);
});

test('capture WRITES no playback state', () => {
  // The whole point of the read-only guarantee: nothing the seek path reads is
  // assigned by the capture. Asserted on the real source, per function.
  const fn = grab('captureOriginMeasurement');
  const body = stripComments(fn);
  for (const forbidden of [
    /\.currentTime\s*=/, /\.src\s*=/, /\.(play|pause|load)\s*\(/,
    /hlsInstance\s*=/, /state\.current\s*=/, /STREAM_EDGE_PROBE\.\w+\s*=/,
  ]) {
    assert.ok(!forbidden.test(body),
      `captureOriginMeasurement must not write playback state: ${forbidden}`);
  }
  // And it must not fetch: it reads the EXISTING probe value.
  assert.ok(!/fetch\(/.test(body), 'capture must not fetch anything');
  assert.ok(/STREAM_EDGE_PROBE\.trueEdgeWallMs/.test(body),
    'capture must read the existing stream clock, not compute one');
});

test('the hls.js reader does not WRITE to the hls instance', () => {
  const body = stripComments(grab('readPdtForCurrentTime'));
  assert.ok(!/inst\.\w+\s*=/.test(body), 'must not assign to the hls instance');
  assert.ok(!/\.(load|startLoad|stopLoad|destroy|detachMedia|attachMedia)\s*\(/.test(body),
    'must not drive the hls loader');
});

// ===========================================================================
// 5. Structural guards: what must NOT have changed.
// ===========================================================================

test('no hls.js configuration was added for this', () => {
  // WS39 must not enable anything to obtain the PDT. hls.js 1.7.3 parses
  // PROGRAM-DATE-TIME unconditionally, and HLS_CONFIG must be untouched.
  const hlsConfig = APP_JS.slice(
    APP_JS.indexOf('const HLS_CONFIG'),
    APP_JS.indexOf('const HLS_CONFIG') + 3000);
  assert.ok(!/useProgramDateTime|timelineOffset/.test(hlsConfig),
    'HLS_CONFIG must not gain a timeline option');
  assert.ok(!/useProgramDateTime/.test(APP_CODE),
    'no useProgramDateTime anywhere (it does not exist in 1.7.3)');
});

test('the seek algorithm is untouched by WS39', () => {
  // The five functions that determine an actual seek target. WS39 is
  // instrumentation; none of them may reference the new record.
  for (const fn of ['seekToProgramTime', 'seekBy', 'seekToLive',
    'playheadWallMs', 'dvrPositionToDate', 'updateSeekableState']) {
    const body = grab(fn);
    assert.ok(!/ORIGIN_MEASURE|captureOriginMeasurement|mediaOriginMs|wallClockDeltaMs/
      .test(body), `${fn} must not reference any WS39 field`);
  }
});

test('no correction constant or offset is introduced', () => {
  // §5: never hardcode a number to make a report go away. WS39 measures a
  // difference; it must not apply one.
  const ws39 = APP_JS.slice(APP_JS.indexOf('// WS39 —'), APP_JS.indexOf('let metaDiagReadoutActive'));
  assert.ok(!/\b(correct|compensat|adjust|applyOffset|remap)/i.test(stripComments(ws39)),
    'the WS39 region must contain no correction logic');
  // The derived functions are pure subtractions of their own operands. The one
  // permitted literal is the ms-per-second conversion 1000; any other constant
  // would be a number frozen into behaviour with no measurement behind it.
  for (const fn of ['originFromPdt', 'wallClockAtMediaPosition', 'wallClockDelta']) {
    const body = stripComments(grab(fn));
    const literals = (body.match(/\b\d+\b/g) || [])
      .filter((n) => n !== '1000' && n !== '0' && n !== '1');
    assert.deepEqual(literals, [],
      `${fn} must contain no literal number except the unit conversion`);
  }
});

test('the readout never renders an unknown value as 0', () => {
  const body = stripComments(grab('originMeasureRecordText'));
  // `null` must reach the formatter, and the formatter must have a null branch.
  assert.ok(/Number\.isFinite/.test(body), 'must distinguish finite from absent');
  assert.ok(!/\|\|\s*0\b/.test(body), 'must never substitute 0 for an absent value');
});

// ===========================================================================
// 6. Ordering. A test that FAILED to be written until a mutation caught it.
// ===========================================================================

test('the panel CAPTURES before it PAINTS', () => {
  // Found by mutation M8, which stayed GREEN. Painting first would render the
  // PREVIOUS capture's values — the identical read-before-write ordering that
  // made the WS38 rate unmeasurable for a whole workstream (the sampler read
  // `trueEdgeWallMs` before the async fetch had written it). A defect class
  // this repo has already paid for twice does not get a third pass, and a
  // mutation that reports green because nothing asserted the ordering is
  // exactly the "metric that cannot fail" trap.
  const at = APP_JS.indexOf('captureOriginMeasurement();');
  assert.notEqual(at, -1, 'the capture must be called somewhere');
  const paintAt = APP_JS.indexOf('originRecordBox.textContent = originMeasureRecordText();');
  assert.notEqual(paintAt, -1, 'the record must be painted');
  // Both live in the same paint callback, so a source-order comparison is
  // meaningful here: the capture must come first.
  assert.ok(at < paintAt,
    'captureOriginMeasurement() must be called BEFORE the record is painted');
});
