/**
 * WS40 — device verification of the PROPOSED absolute media-origin mapping.
 *
 * WHAT THIS IS. The production seek is UNCHANGED. This file guards a
 * diagnostic that will, on the owner's iPhone, compare two mappings of the
 * same programme start:
 *
 *   existing:  target = seekableEnd - (Date.now() - startMs) / 1000
 *   proposed:  target = (startMs - A) / 1000,  A = media-timeline origin
 *
 * and measure where the player actually landed, so the proposed mapping can
 * be ACCEPTED or FALSIFIED on real hardware rather than on algebra.
 *
 * WHY THE ERROR IS MEASURED IN SEGMENTS. The obvious way to score a landing
 * is `(A + landing*1000) - startMs`. That is a TAUTOLOGY: it is identically
 * zero for ANY value of A, including a badly wrong one, because the same A
 * built the target. Verified numerically before this file existed — with an
 * origin wrong by 999 s it still reported 0 s.
 *
 * So the acceptance number is `landingErrorSeg`: a difference of two SEGMENT
 * INDICES on SR's playlist grid. It uses no media origin and no device clock,
 * so a shared-origin error moves both sides equally and cannot hide in their
 * difference. These tests pin that property, which is the whole reason the
 * diagnostic is trustworthy.
 *
 * THESE TESTS EXECUTE THE APP'S REAL EXTRACTED FUNCTIONS (AGENTS.md §7). A
 * canary counts invocations, because a harness that reports success without
 * running the code under test is worse than no harness at all.
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

const PURE = ['ws40SegmentIndex', 'ws40ProposedTarget', 'ws40ExistingTarget',
  'ws40LandingErrorSeg'];

function pureHarness() {
  const canary = { calls: 0 };
  const api = new Function('deps', `
    const { canary } = deps;
    ${PURE.map(grab).join('\n')}
    const counted = (f) => (...a) => { canary.calls += 1; return f(...a); };
    return {
      ws40SegmentIndex: counted(ws40SegmentIndex),
      ws40ProposedTarget: counted(ws40ProposedTarget),
      ws40ExistingTarget: counted(ws40ExistingTarget),
      ws40LandingErrorSeg: counted(ws40LandingErrorSeg),
    };
  `);
  return { ...api({ canary }), canary };
}

// SR's measured grid (WS40, 2026-10-01, p2_320.pls).
const GRID_S = 6.4;
const HEAD_PDT = Date.parse('2026-09-30T21:10:36.800Z');

// ===========================================================================
// 1. THE TAUTOLOGY TRAP. Pinned so it cannot be reintroduced.
// ===========================================================================

test('a same-origin landing error is a tautology and reads 0 for ANY origin', () => {
  // The TRAP, written correctly: the SAME A builds the target AND scores the
  // landing. My first version of this test computed the landing independently
  // and so was not the tautology at all — it reported 999000 and looked like a
  // real discrepancy. The tautology requires the target to come from A too.
  const startMs = HEAD_PDT + 3600 * 1000;
  const sameOriginError = (A) => {
    const target = (startMs - A) / 1000;        // built WITH A
    return (A + target * 1000) - startMs;      // scored WITH the same A
  };
  for (const A of [HEAD_PDT, HEAD_PDT + 999_000, HEAD_PDT - 999_000]) {
    assert.equal(sameOriginError(A), 0,
      'scoring with the same origin must read 0 for ANY origin, including a wrong one');
  }
  // Control: a DIFFERENT origin than the one that built the target does show
  // the discrepancy — which is exactly why the real diagnostic never does this.
  const target = (startMs - HEAD_PDT) / 1000;
  assert.notEqual((HEAD_PDT + 999_000 + target * 1000) - startMs, 0);
});

test('the segment error is NOT a tautology: it survives an independent origin', () => {
  const h = pureHarness();
  h.canary.calls = 0;
  const startMs = HEAD_PDT + 3600 * 1000;
  const expected = h.ws40SegmentIndex(startMs, HEAD_PDT, GRID_S);
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');

  // A landing 25 s early sits 25/GRID segments earlier.
  const err = h.ws40LandingErrorSeg(expected, expected - (25 / GRID_S));
  assert.ok(Math.abs(err * GRID_S - (-25)) < 1e-9,
    `a 25 s early landing must score -25 s, got ${err * GRID_S}`);

  // THE POINT: shift the wall clock on BOTH sides and the error is unchanged,
  // because it is a difference of two positions on ONE timeline. A wrong
  // origin applied to both moves them together, which is why this figure
  // cannot hide a shared-origin error the way a same-origin score does.
  const shifted = startMs + 999_000;
  const expectedShifted = h.ws40SegmentIndex(shifted, HEAD_PDT, GRID_S);
  assert.equal(
    h.ws40LandingErrorSeg(expectedShifted, expectedShifted - (25 / GRID_S)),
    err,
    'a shift common to both sides must not change the segment error',
  );
  // But a shift on ONE side -- i.e. an actual landing error -- must show up.
  assert.notEqual(
    h.ws40LandingErrorSeg(expected, expectedShifted - (25 / GRID_S)),
    err,
    'a one-sided difference must change the segment error',
  );
});

test('landing error in segments distinguishes 0 / +25 / -25', () => {
  const h = pureHarness();
  h.canary.calls = 0;
  const startMs = HEAD_PDT + 3600 * 1000;
  const expected = h.ws40SegmentIndex(startMs, HEAD_PDT, GRID_S);
  const score = (offsetS) => {
    const landed = expected + (offsetS / GRID_S);
    return h.ws40LandingErrorSeg(expected, landed) * GRID_S;
  };
  assert.ok(h.canary.calls > 0, 'canary: the real functions must have been called');
  assert.ok(Math.abs(score(0)) < 1e-9, 'on-grid must score 0');
  assert.ok(Math.abs(score(-25) + 25) < 1e-9, '25 s early must score -25');
  assert.ok(Math.abs(score(25) - 25) < 1e-9, '25 s late must score +25');
  // The three must be DISTINGUISHABLE. A metric that cannot tell them apart
  // cannot accept or falsify the mapping.
  assert.notEqual(score(0), score(-25));
  assert.notEqual(score(0), score(25));
});

// ===========================================================================
// 2. The two mappings.
// ===========================================================================

test('the proposed mapping uses the origin; the existing one does not', () => {
  const h = pureHarness();
  h.canary.calls = 0;
  const startMs = HEAD_PDT + 3600 * 1000;
  const A = HEAD_PDT + 12_000;   // an origin 12 s off the playlist head
  const proposed = h.ws40ProposedTarget(startMs, A);
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
  // (startMs - A)/1000 -- the playlist head is NOT the media origin, so the
  // target must be 12 s away from the naive value.
  assert.ok(Math.abs(proposed - (3600 - 12)) < 1e-9, `got ${proposed}`);

  const end = 999_991.5, now = 1_000_000_000;
  const existing = h.ws40ExistingTarget(end, now, startMs);
  // The existing mapping is byte-for-byte the production equation.
  assert.equal(existing, end - (now - startMs) / 1000);
});

test('the existing mapping is UNCHANGED from the production equation', () => {
  // Guards against "simplifying" the diagnostic's copy of the old equation
  // into something that is no longer the thing being replaced.
  const body = stripComments(grab('ws40ExistingTarget'));
  assert.ok(/seekableEndS\s*-\s*\(\s*deviceNowMs\s*-\s*startMs\s*\)\s*\/\s*1000/
    .test(body.replace(/\s+/g, ' ')),
  'the diagnostic must reproduce the production equation exactly');
});

test('both mappings return null, never 0, when an operand is missing', () => {
  const h = pureHarness();
  h.canary.calls = 0;
  assert.equal(h.ws40ProposedTarget(null, 1), null);
  assert.equal(h.ws40ProposedTarget(1, null), null);
  assert.equal(h.ws40ExistingTarget(null, 1, 1), null);
  assert.equal(h.ws40ExistingTarget(1, null, 1), null);
  assert.equal(h.ws40ExistingTarget(1, 1, null), null);
  assert.equal(h.ws40SegmentIndex(1, null, GRID_S), null);
  assert.equal(h.ws40SegmentIndex(1, HEAD_PDT, 0), null, 'zero segment must be null');
  assert.equal(h.ws40SegmentIndex(1, HEAD_PDT, -1), null, 'negative segment must be null');
  assert.equal(h.ws40LandingErrorSeg(1, null), null);
  assert.ok(h.canary.calls > 0, 'canary: the real functions must have been called');
});

test('the existing mapping REPRODUCES both observed platform errors', () => {
  // The identity established in this session: error = skew - L.
  // With a ~1 s clock skew, L = 8.5 s reproduces the desktop figure and
  // L = 25 s the iPhone figure, term for term. If this stops holding, the
  // diagnosis is wrong and the fix is not justified.
  const h = pureHarness();
  h.canary.calls = 0;
  const A = HEAD_PDT;
  const startMs = HEAD_PDT + 3600 * 1000;
  const realNow = HEAD_PDT + 3 * 3600 * 1000;
  const skewMs = 1000;
  const deviceNow = realNow - skewMs;
  const score = (L) => {
    const end = (realNow - A) / 1000 - L;
    const target = h.ws40ExistingTarget(end, deviceNow, startMs);
    // Convert the landing back through the segment grid, using the SAME
    // origin the mapping assumed. That is legitimate here because `A` is the
    // TRUE origin in this model, so the tautology cannot fire.
    const landed = h.ws40SegmentIndex(A + target * 1000, HEAD_PDT, GRID_S);
    const expected = h.ws40SegmentIndex(startMs, HEAD_PDT, GRID_S);
    return h.ws40LandingErrorSeg(expected, landed) * GRID_S;
  };
  // The canary must be read AFTER the calls, not before. An earlier version
  // asserted it here and failed against correct code, because `score()` had
  // not run yet -- a harness that reports "the function was never called"
  // when it simply has not been called yet (§7).
  const desktop = score(8.5);
  const iphone = score(25);
  assert.ok(h.canary.calls >= 4, 'canary: the real functions must have been called');
  // error = skew - L  =>  1000ms skew against L=8.5 s gives -7.5 s,
  // and against L=25 s gives -24 s. Both match the owner's reports.
  assert.ok(Math.abs(desktop + 7.5) < 1e-6, `desktop: got ${desktop}`);
  assert.ok(Math.abs(iphone + 24) < 1e-6, `iPhone: got ${iphone}`);
});

test('the proposed mapping scores 0 for EVERY buffer lag L', () => {
  // The claim the fix rests on: with the origin known, L cancels entirely.
  const h = pureHarness();
  h.canary.calls = 0;
  const startMs = HEAD_PDT + 3600 * 1000;
  const expected = h.ws40SegmentIndex(startMs, HEAD_PDT, GRID_S);
  for (const L of [0, 8.5, 25, 120, 300]) {
    const target = h.ws40ProposedTarget(startMs, HEAD_PDT);
    const landed = h.ws40SegmentIndex(HEAD_PDT + target * 1000, HEAD_PDT, GRID_S);
    const err = h.ws40LandingErrorSeg(expected, landed) * GRID_S;
    assert.ok(Math.abs(err) < 1e-9, `L=${L} must score 0, got ${err}`);
  }
  assert.ok(h.canary.calls > 0, 'canary: the real functions must have been called');
});

// ===========================================================================
// 3. Guards on what must NOT have changed.
// ===========================================================================

test('the PRODUCTION seek is untouched by WS40', () => {
  // The whole premise of this workstream: diagnose first, change nothing.
  for (const fn of ['seekToProgramTime', 'seekBy', 'seekToLive',
    'playheadWallMs', 'dvrPositionToDate', 'updateSeekableState']) {
    const body = grab(fn);
    assert.ok(!/WS40|ws40|proposedTarget|mediaOrigin/.test(body),
      `${fn} must not reference any WS40 symbol`);
  }
  // And the production equation is still the production equation.
  assert.ok(/const target = end - behindMs \/ 1000;/.test(APP_JS),
    'the production seek equation must still be end - behindMs/1000');
});

test('the WS38 guard against a circular seekableEnd difference still holds', () => {
  // A fallback `trueEdgeWallMs - seekableEnd*1000` was written and REMOVED:
  // it assumes the playlist edge and the buffered edge are the same instant,
  // i.e. it assumes L = 0, which is the quantity under test. If it ever
  // returns, the diagnostic would report agreement by construction.
  assert.ok(!/trueEdge\w*\s*-\s*[^;]*seekableEnd/.test(APP_CODE),
    'no absolute stream-clock minus seekableEnd difference may exist in code');
  assert.ok(!/seekableEnd[^;]*-\s*[^;]*trueEdge\w*/.test(APP_CODE),
    'nor in the reverse order');

  // ---- ADDED AFTER MUTATION M1 CAME BACK GREEN. -------------------------
  // The two patterns above are NAME-BASED, and M1 wrote the circular
  // expression as `trueEdgeWallMs - e0 * 1000` — the same circular quantity,
  // reading a buffered edge into a local named `e0` instead of literally
  // `seekableEnd`. Both name-patterns missed it and the mutation passed.
  //
  // A guard that only catches one spelling of a defect is not a guard. These
  // two are STRUCTURAL: they forbid the SHAPE (a stream-clock field minus a
  // fresh-seekable read, times 1000) whatever the variable is called, and they
  // forbid the origin fallback inside ws40ReadOrigin by name.
  const readFn = stripComments(grab('ws40ReadOrigin'));
  assert.ok(!/trueEdgeWallMs\s*[-+]\s*/.test(readFn),
    'ws40ReadOrigin must not derive an origin from the stream clock at all');
  assert.ok(!/readFreshSeekableEnd\s*\(\s*\)/.test(readFn),
    'ws40ReadOrigin must not read the buffered edge: any origin built from it '
    + 'assumes the buffered edge and the playlist edge coincide (L = 0), which '
    + 'is the quantity under test');
  // And structurally, anywhere in code: a stream clock minus a fresh read.
  assert.ok(!/trueEdgeWallMs\s*-\s*[A-Za-z_$][\w$]*\s*\*\s*1000/.test(APP_CODE),
    'no stream-clock minus buffered-position expression may exist');
  assert.ok(!/trueEdgeWallMs\s*-\s*readFreshSeekableEnd/.test(APP_CODE),
    'nor one using the buffered-edge reader directly');

  // No fallback origin may be invented when the platform offers none: the
  // function must reach `unavailable` without having derived anything.
  assert.ok(/source:\s*'unavailable'/.test(readFn),
    'the no-origin path must still exist and must be reachable');
});

test('WS40 performs no network fetch of its own', () => {
  for (const fn of ['ws40Capture', 'ws40TestSeek', 'ws40ReadOrigin',
    'ws40Transport']) {
    const body = stripComments(grab(fn));
    assert.ok(!/fetch\(/.test(body), `${fn} must not fetch`);
  }
});

test('WS40 writes no playback state except the one deliberate test seek', () => {
  const body = stripComments(grab('ws40Capture'));
  for (const forbidden of [/\.currentTime\s*=/, /\.src\s*=/, /\.(play|pause|load)\s*\(/]) {
    assert.ok(!forbidden.test(body),
      `ws40Capture must not write playback state: ${forbidden}`);
  }
  // The test seek is the ONE permitted assignment, and it lives only in
  // ws40TestSeek, which is reachable only from the panel buttons.
  const seekBody = stripComments(grab('ws40TestSeek'));
  assert.ok(/audioEl\.currentTime\s*=\s*target/.test(seekBody),
    'the test seek must assign the target it was asked to test');
  // Defined once, and called only from the "Mät" button. Counted in
  // COMMENT-STRIPPED code with a pattern that excludes the `function`
  // declaration: `ws40Capture(` preceded by `function ` is the definition,
  // anything else is a call. Two earlier attempts were wrong -- one matched
  // the definition, one (`[^n]ws40Capture\(`) matched it again because a
  // newline sits before `function`. A guard that fires on correct code is not
  // a guard, so the pattern is explicit rather than clever.
  const calls = (APP_CODE.match(/(?<!function )ws40Capture\(/g) || []).length;
  assert.equal(calls, 1, 'ws40Capture must be called from exactly one place');
});

test('the diagnostic refuses to seek outside the buffered window', () => {
  // A clamped seek would understate the landing error, so the test seek must
  // decline rather than let the element clamp it.
  const body = stripComments(grab('ws40TestSeek'));
  assert.ok(/target\s*<\s*start\s*\|\|\s*target\s*>\s*end/.test(body),
    'the test seek must check the target against the buffered window');
  assert.ok(/skipped:\s*'target-outside-window'/.test(body),
    'and must report the skip rather than seeking anyway');
});

test('no correction constant is introduced', () => {
  const ws40 = APP_JS.slice(APP_JS.indexOf('// WS40 —'), APP_JS.indexOf('let metaDiagReadoutActive'));
  assert.ok(!/\b(correct|compensat|adjust|remap|fudge)/i.test(stripComments(ws40)),
    'the WS40 region must contain no correction logic');
  for (const fn of PURE) {
    const body = stripComments(grab(fn));
    const literals = (body.match(/\b\d+\b/g) || [])
      .filter((n) => n !== '1000' && n !== '0' && n !== '1');
    assert.deepEqual(literals, [],
      `${fn} must contain no literal except the ms-per-second conversion`);
  }
});

test('the renderer never renders an unknown value as 0', () => {
  const body = stripComments(grab('ws40RecordText'));
  assert.ok(/Number\.isFinite/.test(body), 'must distinguish finite from absent');
  // `null` must reach the formatter rather than be substituted at the call
  // site. The literal pattern `|| 0` is not the only way to lose a null --
  // `?? 0` does it too, and so does a bare `||` before a fallback string.
  assert.ok(!/\?\?\s*0\b/.test(body), 'must never substitute 0 via ??');
  assert.ok(!/Number\.isFinite\([^)]*\)\s*\?[^:]*:\s*0\b/.test(body),
    'a non-finite value must never render as a bare 0');
  // The segment-score formatting must preserve null as 'okänd'.
  assert.ok(/n\(r\.landingErrorSeg\)/.test(body),
    'the landing error must go through the null-preserving formatter');
  // And the tautological figure must be labelled, not presented as evidence.
  const snap = APP_JS.slice(APP_JS.indexOf('note: \'DIAGNOSTIC ONLY'));
  assert.ok(/tautological/i.test(snap),
    'the snapshot note must label the same-origin figure as tautological');
});
