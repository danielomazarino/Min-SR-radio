// WS47 — the runtime-derived effective media edge (native-HLS experiment).
//
// WHAT IS BEING TESTED. The production equation treats `seekable.end` as
// "now". WS47 tests the hypothesis that Safari's EFFECTIVE media edge — the
// position a seek actually resolves against — can sit ahead of
// `audio.seekable.end()`, by an amount that moves with the rolling playlist.
//
// The experiment derives a step-back from the element's own TimeRanges. It is
// NOT `target = end - 6.4`, and there is no timing constant anywhere: SR's
// segment duration, the observed ~8 s / ~25 s / ~31.5 s errors and every
// device-specific value are absent by construction.
//
// `seekable` is a TimeRanges collection and does NOT expose HLS segment
// boundaries. Nothing here treats start(n)/end(n) as "segment n" — they are
// the only positions the element publishes, so they are the only inputs
// available.
//
// WHAT THESE TESTS GUARD, in order of how badly it would hurt if broken:
//   1. the step is DERIVED, never a literal (otherwise §5 is violated and one
//      day's observation becomes permanent behaviour);
//   2. unusable input falls back SAFELY, because a wrong edge is worse than no
//      experiment;
//   3. hls.js/Edge is untouched;
//   4. the production equation survives verbatim as the fallback.

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

// The canary is incremented by the EXTRACTED FUNCTION ITSELF, so a harness that
// silently stops exercising app.js is detectable (AGENTS.md §7).
function build() {
  let canary = 0;
  const factory = new Function('WS47_CANARY', `${grab('ws47EffectiveEdgeS')}
    return ws47EffectiveEdgeS;`);
  const fn = factory(() => { canary += 1; });
  return { fn, calls: () => canary };
}

// A stand-in for HTMLMediaElement.seekable. It publishes positions; it does NOT
// claim to expose segments, and the tests never assert that it does.
function rangesOf(pairs) {
  return {
    length: pairs.length,
    start: (i) => pairs[i][0],
    end: (i) => pairs[i][1],
  };
}

const EDGE = 10880; // the cached seekable.end the app already holds

// ---- 1. effective-edge derivation ----
//
// IMPORTANT, and established by measurement rather than assumption: a TimeRanges
// is a list of INTERVALS. A single interval publishes exactly two positions --
// its own start and its own end -- so the gap between them is the whole DVR
// window, not a subdivision of it. The implementation therefore REFUSES that
// case. If the owner's iPhone publishes only one interval, WS47 will not fire
// and the production equation runs unchanged; `d.ws47Applied` on the existing
// record is what makes that distinguishable on the device.

test('a single interval is REFUSED: its width is the whole window', () => {
  const { fn, calls } = build();
  // The normal DVR shape: one interval spanning the whole seekable window.
  assert.equal(fn(rangesOf([[0, EDGE]]), EDGE), null);
  assert.equal(fn(rangesOf([[100, 2100]]), 2100), null);
  assert.equal(calls(), 2, 'canary: the extracted function must have executed');
});

test('a zero-based single interval does NOT produce a 3-hour jump', () => {
  // The failure this guards: treating the window width as a segment duration
  // would move the edge from 10880 to 0 -- a 3-hour error, worse than the
  // ~25 s problem being investigated.
  const { fn } = build();
  assert.equal(fn(rangesOf([[0, EDGE]]), EDGE), null);
});

test('two adjacent intervals give the smaller gap', () => {
  // [[0,50],[50,3050]] publishes 0,50,50,3050 -> gaps 50 and 3000.
  // Largest gap 3000 -> edge 3050-3000 = 50.
  const { fn } = build();
  assert.equal(fn(rangesOf([[0, 50], [50, 3050]]), 3050), 50);
});

test('two DISJOINT intervals give the gap between them', () => {
  // A discontinuous seekable range genuinely discloses an internal gap.
  const { fn } = build();
  assert.equal(fn(rangesOf([[0, 900], [1000, 3050]]), 3050), 1000);
});

test('multiple intervals are handled, and the largest gap wins', () => {
  // 0,100,100,1100,1100,3100 -> largest gap 2000 -> edge 3100-2000 = 1100.
  const { fn } = build();
  assert.equal(fn(rangesOf([[0, 100], [100, 1100], [1100, 3100]]), 3100), 1100);
});

test('an edge derived from disjoint intervals stays inside the range', () => {
  const { fn } = build();
  const edge = fn(rangesOf([[5000, 6000], [7000, 15000]]), 15000);
  assert.equal(edge, 7000);
  assert.ok(edge >= 5000 && edge <= 15000, 'the edge must stay within the range');
});

// ---- 2. target shift ----
test('the target moves earlier by exactly the derived amount', () => {
  const { fn } = build();
  const behindS = 500;
  const derived = fn(rangesOf([[0, 900], [1000, EDGE]]), EDGE);
  assert.equal(derived, 1000);
  const oldTarget = EDGE - behindS;          // production: end - behindMs/1000
  const newTarget = derived - behindS;       // WS47: effective edge
  assert.equal(oldTarget - newTarget, EDGE - derived,
    'the shift equals exactly the derived step, not a constant');
  assert.equal(newTarget, 500);
});

// ---- 3. safe fallback ----
test('no ranges falls back to null, leaving the caller unchanged', () => {
  const { fn } = build();
  assert.equal(fn(null, EDGE), null);
  assert.equal(fn(undefined, EDGE), null);
});

test('a single position cannot be subdivided, so it falls back', () => {
  // One position carries no information about the element's subdivision.
  // Guessing here would be inventing a number.
  const { fn } = build();
  assert.equal(fn(rangesOf([[0, EDGE]]).length === 1 ? { length: 0 } : null, EDGE), null);
  assert.equal(fn({ length: 1, start: () => 0, end: () => 0 }, EDGE), null);
});

test('a throwing TimeRanges falls back rather than propagating', () => {
  // Some engines throw instead of returning NaN for an out-of-range index.
  // An exception here would break the seek entirely.
  const { fn } = build();
  const hostile = { length: 4, start: () => { throw new Error('nope'); }, end: () => 1 };
  assert.equal(fn(hostile, EDGE), null);
});

test('NaN or infinite positions fall back', () => {
  const { fn } = build();
  assert.equal(fn({ length: 2, start: () => NaN, end: () => 10 }, EDGE), null);
  assert.equal(fn({ length: 2, start: () => 0, end: () => Infinity }, EDGE), null);
  assert.equal(fn({ length: 2, start: () => 0, end: () => -5 }, EDGE), null);
});

test('a non-finite cached edge falls back', () => {
  const { fn } = build();
  assert.equal(fn(rangesOf([[0, 100]]), NaN), null);
  assert.equal(fn(rangesOf([[0, 100]]), null), null);
});

test('a gap as wide as the whole range is refused', () => {
  const { fn } = build();
  // The bound is RELATIVE to the published span, not an absolute number of
  // seconds. A gap that spans the entire range is not internal subdivision,
  // it IS the window -- stepping back by it would move the edge ~3 hours.
  // A degenerate range where the only positions are the two extremes, so the
  // largest gap IS the whole span. An earlier fixture ([[0,100],[10880,10880]])
  // gave largestGap 10780 vs span 10880 -- not equal, so it did not test this
  // guard at all and passed for the wrong reason.
  assert.equal(fn(rangesOf([[0, 0], [5000, 5000]]), 5000), null);
  assert.equal(fn(rangesOf([[0, 5000], [5000, 5000]]), 5000), null);
  // An absolute bound was tried first (3600 s) and rejected: it excludes
  // every realistic DVR step as soon as the window is wide, which would make
  // the experiment unreachable while offline tests still passed.
  const wide = rangesOf([[0, 900], [1000, 10880]]);
  assert.equal(fn(wide, 10880), 1000, 'a 980 s gap in a 10880 s window is valid');
});

test('an edge outside the published range is refused', () => {
  // Defence in depth: even if the arithmetic produced an edge outside what the
  // element published, it must not be used.
  const { fn } = build();
  const r = rangesOf([[9000, 9500], [12000, 13000]]);
  const edge = fn(r, 13000);
  assert.ok(edge === null || (edge >= 9000 && edge <= 13000), 'edge must be null or inside');
});

// ---- 4. native-HLS-only gating ----
test('the accessor refuses every non-native transport', () => {
  const body = grab('ws47ExperimentalEdgeS');
  assert.match(body, /if \(ws40Transport\(\) !== 'native-hls'\) return null;/,
    'the experiment must be gated to native-HLS');
  assert.match(body, /if \(!cur \|\| !cur\.dvrAvailable\) return null;/);
  assert.match(body, /if \(!Number\.isFinite\(cur\.seekableEnd\)\) return null;/);
  // "null when not applicable" is what lets the caller keep its own arithmetic.
  assert.match(body, /return \(edge === null \|\| edge === cur\.seekableEnd\) \? null : edge;/);
});

test('no device detection is used to gate the experiment', () => {
  const body = grab('ws47ExperimentalEdgeS') + grab('ws47EffectiveEdgeS');
  assert.doesNotMatch(body, /userAgent|navigator\.|isIPhone|isSafari|device/i,
    'the experiment must be gated on transport, never on a device check');
});

// ---- 5. no arbitrary timing constants ----
test('no observed error or SR segment duration is hardcoded', () => {
  const body = grab('ws47EffectiveEdgeS') + grab('ws47ExperimentalEdgeS');
  assert.doesNotMatch(body, /\b6\.4\b/, 'SR segment duration must not be hardcoded');
  assert.doesNotMatch(body, /\b31\.5\b/, 'the reverted playlist correction must not return');
  assert.doesNotMatch(body, /[-+]\s*8\b/, 'the desktop error must not be hardcoded');
  assert.doesNotMatch(body, /[-+]\s*25\b/, 'the iPhone error must not be hardcoded');
  assert.doesNotMatch(body, /[-+]\s*30\b/, 'the overshoot must not be hardcoded');
  assert.doesNotMatch(body, /OFFSET|BIAS|CORRECTION|CALIBRAT/i);
});

test('the sanity bound is relative and only ever rejects', () => {
  const body = grab('ws47EffectiveEdgeS');
  // The bound is expressed against the published span, never as an absolute
  // number of seconds, and it can only REJECT. It must never be added to or
  // subtracted from a target, or it would be a calibration constant wearing a
  // guard's clothes.
  assert.match(body, /const span = hi - lo;/);
  assert.match(body, /if \(span > 0 && largestGap >= span\) return null;/,
    'the relative bound must be present');
  assert.doesNotMatch(body, /span\s*[-+]|[-+]\s*span\b/,
    'the span must only ever be compared, never used to adjust the edge');
  assert.doesNotMatch(body, /3600|3_600/,
    'no absolute seconds bound may reappear');
});

// ---- 6. hls.js / Edge unchanged ----
test('the hls.js/Edge path is not touched by the experiment', () => {
  for (const fn of ['seekBy', 'seekToLive', 'playheadWallMs',
    'updateSeekableState', 'programBoundary', 'pickByPosition', 'parseVariantEdge']) {
    assert.doesNotMatch(grab(fn), /ws47|WS47/,
      `${fn} must not reference the WS47 experiment`);
  }
  assert.doesNotMatch(APP_JS, /liveSyncDurationCount:\s*\d+\s*,\s*\n\s*\/\/WS47/);
});

// ---- 7. the production equation survives as the fallback ----
test('the original equation is still computed and used when not applicable', () => {
  const body = grab('seekToProgramTime');
  assert.match(body, /const end = cur\.seekableEnd;/,
    'the cached seekableEnd must still be read');
  assert.match(body, /const effectiveEndS = experimentalEdgeS === null \? end : experimentalEdgeS;/,
    'null must select the cached edge');
  assert.match(body, /const target = effectiveEndS - behindMs \/ 1000;/);
  // The out-of-window guard must still test the value actually seeked to.
  assert.match(body, /if \(target < start\) \{/);
});

// ---- 8. wiring: reachability (AGENTS.md §7a) ----
test('the production seek and its diagnostic mirror both call the experiment', () => {
  // A correct, tested, never-executed experiment is the most expensive defect
  // in this repo, so the CALL SITES are asserted, not just the helper.
  const seek = grab('seekToProgramTime');
  assert.match(seek, /ws47ExperimentalEdgeS\(\)/);
  const mirror = grab('recordSkipPress');
  assert.match(mirror, /ws47ExperimentalEdgeS\(\)/,
    'the mirror must report the target the app really requested');
});

// ---- 9. CANARY ----
test('CANARY: the harness executes the function extracted from app.js', () => {
  let canary = 0;
  const factory = new Function('WS47_CANARY', `${grab('ws47EffectiveEdgeS')}
    return ws47EffectiveEdgeS;`);
  const fn = factory(() => { canary += 1; });
  assert.equal(canary, 0, 'nothing has run yet');
  fn(rangesOf([[0, EDGE]]), EDGE);
  fn(null, EDGE);
  fn({ length: 1, start: () => 0, end: () => 0 }, EDGE);
  assert.equal(canary, 3, 'the extracted function must run once per call');
});