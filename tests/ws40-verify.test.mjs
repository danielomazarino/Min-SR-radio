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
  'ws40LandingErrorSeg', 'ws40PlaylistOrigin', 'ws40OriginDelta'];

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
      ws40PlaylistOrigin: counted(ws40PlaylistOrigin),
      ws40OriginDelta: counted(ws40OriginDelta),
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
  // HISTORY, kept because the reasoning is load-bearing. A fallback
  // `trueEdgeWallMs - seekableEnd*1000` was ORIGINALLY written inside
  // `ws40ReadOrigin` and REMOVED, because there it was used as the origin for
  // the target — which assumes the playlist edge and the buffered edge are the
  // same instant, i.e. assumes L = 0, the quantity under test. Used as the
  // ORIGIN it assumed the answer; used as a CROSS-CHECK beside a Safari-derived
  // origin it assumes nothing, because the two share no input.
  //
  // The two blanket regex bans that used to live here were NAME-based, so they
  // forbade every spelling of that expression including the diagnostic the owner
  // has now authorised. They are replaced below by the property that was
  // always the point: the quantity must reach NO production target.

  // ---- WS40b: ONE sanctioned diagnostic expression, guarded structurally. ---
  // The owner authorised `A_playlist = trueEdgeWallMs - seekableEnd*1000` as a
  // DIAGNOSTIC cross-check, after being shown that every earlier check of the
  // origin was algebraically a restatement of the value under test. What the
  // original guard forbade was a false measurement presented as evidence of
  // alignment; nothing here is presented as that — it is labelled a
  // cross-check and inherits a known +31.5 s bias that the panel states.
  //
  // The function that computes it must not touch `getStartDate`, the device
  // clock, or any target: it is the second, independent witness, so it must
  // stay independent.
  const readFn = stripComments(grab('ws40ReadOrigin'));
  const originFn = stripComments(grab('ws40PlaylistOrigin'));
  assert.ok(!/getStartDate|mediaOriginMs|Date\.now|deviceNow/.test(originFn),
    'the playlist origin must not read A, getStartDate, the device clock, or a target');
  assert.ok(/trueEdgeWallMs\s*-\s*seekableEndS\s*\*\s*1000/.test(
    originFn.replace(/\s+/g, ' ')),
  'the playlist origin must be exactly trueEdgeWallMs - seekableEnd*1000');

  // ---- THE SECOND NAME-BASED HOLE, FOUND BY MUTATION N6. ----------------
  // N6 added a SECOND copy of the same subtraction, spelled
  // `playlistEdgeWallMs - WS40.seekableEndS * 1000`, and assigned it back into
  // `mediaOriginMs` — i.e. a fallback origin rebuilt from the circular
  // expression, which is the exact defect this guard exists to prevent. The
  // `trueEdge\w*` pattern missed it because `playlistEdgeWallMs` does not
  // contain the token `trueEdge`.
  //
  // That is the SAME failure as mutation M1 one round ago, and naming it is
  // the point: a pattern that matches an identifier is a guard on spelling.
  // This one is on SHAPE — any field holding the playlist edge, minus any
  // media-second position, times 1000 — and it is anchored to the ONE function
  // permitted to contain it.
  const EDGE_FIELD = /(?:trueEdge|playlistEdge)\w*/;
  const shape = new RegExp(`${EDGE_FIELD.source}\\s*-\\s*[^;]*?[Ee]nd\\w*\\s*\\*\\s*1000`, 'g');
  const occurrences = (APP_CODE.match(shape) || []).length;
  assert.equal(occurrences, 1,
    'exactly one stream-edge-minus-buffered-position expression may exist');
  // And it must be the sanctioned one, reached only via the pure function.
  assert.ok(/trueEdgeWallMs\s*-\s*seekableEndS\s*\*\s*1000/.test(
    APP_CODE.replace(/\s+/g, ' ')),
  'the single permitted expression must be the trueEdgeWallMs form');
  // No other function may compute one, whatever it calls the operands.
  for (const fn of ['ws40Capture', 'ws40ReadOrigin', 'ws40TestSeek',
    'ws40ProposedTarget', 'ws40ExistingTarget', 'originMeasureRecordText']) {
    const b = stripComments(grab(fn));
    assert.ok(!new RegExp(EDGE_FIELD.source + '\\s*-').test(b),
      `${fn} must not contain a stream-edge-minus-position expression`);
  }
  // Explicitly: the capture may not write the cross-check back into A.
  assert.ok(!/mediaOriginMs\s*=\s*[^;]*(?:playlistOrigin|playlistEdge|trueEdge)/
    .test(APP_CODE),
  'mediaOriginMs must never be assigned from the playlist edge');

  // THE load-bearing guard: the cross-check must not reach a production
  // target. This is stricter and more meaningful than the old code-shape ban,
  // which would also have forbidden a correct diagnostic.
  const targetFns = ['seekToProgramTime', 'seekBy', 'seekToLive',
    'playheadWallMs', 'dvrPositionToDate', 'updateSeekableState'];
  for (const fn of targetFns) {
    assert.ok(!/playlistOrigin|originDelta/.test(grab(fn)),
      `${fn} must not reference the cross-check fields`);
  }
  // The proposed target is computed from `mediaOriginMs` ALONE.
  const capture = stripComments(grab('ws40Capture'));
  const propLine = capture.split('WS40.proposedTargetS')[1] || '';
  assert.ok(/ws40ProposedTarget\(\s*WS40\.programmeStartMs\s*,\s*WS40\.mediaOriginMs\s*\)/
    .test(capture),
    'the proposed target must be computed from mediaOriginMs alone');
  assert.ok(!propLine.includes('playlistOrigin'),
    'nothing after the proposed target may recompute it from the cross-check');
  // And the cross-check is written after the target, never feeding it.
  assert.ok(capture.indexOf('WS40.playlistOriginMs =')
    < capture.indexOf('WS40.existingTargetS ='),
    'the cross-check is captured before the targets are derived (ordering only)');

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

// ===========================================================================
// 7. WS40b — the independent-origin cross-check.
// ===========================================================================

test('A_playlist is exactly trueEdgeWallMs - seekableEnd*1000', () => {
  const h = pureHarness();
  h.canary.calls = 0;
  const edge = 1790811244800;
  const end = 6763.0;
  const got = h.ws40PlaylistOrigin(edge, end);
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
  assert.equal(got, edge - end * 1000);
  // Written out longhand, because a units slip here would be invisible:
  // seekableEnd is MEDIA SECONDS and must be scaled, not left alone.
  assert.equal(got, 1790811244800 - 6763000);
});

test('A_playlist returns null, never 0, when an operand is missing', () => {
  const h = pureHarness();
  h.canary.calls = 0;
  assert.equal(h.ws40PlaylistOrigin(null, 1), null);
  assert.equal(h.ws40PlaylistOrigin(1, null), null);
  assert.equal(h.ws40PlaylistOrigin(NaN, 1), null);
  // A genuine zero must survive as a real value, not collapse to null.
  assert.equal(h.ws40PlaylistOrigin(0, 0), 0);
  assert.notEqual(h.ws40PlaylistOrigin(0, 0), null);
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
});

test('the cross-check distinguishes the two hypotheses', () => {
  // THE POINT OF THE INSTRUMENT. A perfect Safari anchor and a Safari anchor
  // biased by 25 s must produce clearly different deltas, or the test settles
  // nothing. The bias of A_playlist itself is applied as a CONSTANT here so
  // the two cases differ ONLY by Safari's error — the quantity in question.
  const h = pureHarness();
  h.canary.calls = 0;
  const edge = 1790811244800, end = 6763.0;
  const A_playlist = h.ws40PlaylistOrigin(edge, end);
  const A_true = A_playlist - 31_500;   // undo the known overshoot
  const deltaIfCorrect = h.ws40OriginDelta(A_true, A_playlist);
  const deltaIfBiased25 = h.ws40OriginDelta(A_true - 25_000, A_playlist);
  assert.ok(h.canary.calls > 0, 'canary: the real functions must have been called');
  assert.ok(Math.abs(deltaIfCorrect - (-31.5)) < 1e-9,
    `a correct anchor must read the documented -31.5 s, got ${deltaIfCorrect}`);
  assert.ok(Math.abs(deltaIfBiased25 - (-56.5)) < 1e-9,
    `a 25 s bias must read -56.5 s, got ${deltaIfBiased25}`);
  // 25 s apart, and no amount of playlist age (a few seconds) bridges that.
  assert.ok(Math.abs(deltaIfCorrect - deltaIfBiased25 - 25) < 1e-9);
});

test('originDeltaS is null unless BOTH origins are finite', () => {
  const h = pureHarness();
  h.canary.calls = 0;
  assert.equal(h.ws40OriginDelta(null, 1), null);
  assert.equal(h.ws40OriginDelta(1, null), null);
  assert.equal(h.ws40OriginDelta(0, 0), 0, 'a real zero must be a real value');
  assert.ok(h.canary.calls > 0, 'canary: the real function must have been called');
});

test('GUARD: the cross-check is diagnostic-only and reaches no target', () => {
  // The load-bearing structural guard. A diagnostic that can influence a seek
  // is a production change wearing a diagnostic's name.
  for (const fn of ['seekToProgramTime', 'seekBy', 'seekToLive',
    'playheadWallMs', 'dvrPositionToDate', 'updateSeekableState',
    'resolveProgramTitle', 'programBoundary', 'fetchScheduleDay']) {
    assert.ok(!/playlistOrigin|originDelta/.test(grab(fn)),
      `${fn} must not reference the cross-check`);
  }
  // The target is derived from mediaOriginMs alone, in one call.
  const capture = stripComments(grab('ws40Capture'));
  assert.ok(/ws40ProposedTarget\(\s*WS40\.programmeStartMs\s*,\s*WS40\.mediaOriginMs\s*\)/
    .test(capture), 'the proposed target must take mediaOriginMs as its origin');
  // And nothing anywhere else re-derives a target from the cross-check.
  const all = (APP_CODE.match(/ws40ProposedTarget\(/g) || []).length;
  assert.equal(all, 2, 'exactly one definition and one call site');
  // The production equation is untouched.
  assert.ok(/const target = end - behindMs \/ 1000;/.test(APP_JS),
    'the production seek equation must still be end - behindMs/1000');
});

test('GUARD: the origin functions stay independent of each other', () => {
  // A_playlist must not read A, and A must not be derived from the playlist.
  // If either borrowed from the other the cross-check would compare a value
  // with itself and read 0 — the tautology this whole phase exists to avoid.
  const p = stripComments(grab('ws40PlaylistOrigin'));
  assert.ok(!/mediaOriginMs|getStartDate/.test(p),
    'A_playlist must not read the Safari origin');
  const r = stripComments(grab('ws40ReadOrigin'));
  assert.ok(!/playlistOrigin|trueEdgeWallMs\s*-/.test(r),
    'A_safari must not be derived from the playlist edge');
});
