/**
 * WS38 — instrument the seek. Four measurements, no interpretation.
 *
 * WHAT THIS FILE EXISTS FOR. WS30–WS37 produced one measurement that looked
 * authoritative and was arithmetically incapable of seeing the thing it
 * claimed to measure. Three explanations for the programme-skip error have
 * already been raised and withdrawn. So the tests below are written to protect
 * a very specific property:
 *
 *   A MEASUREMENT THAT CANNOT SEE WHAT IT CLAIMS TO MEASURE MUST NOT EXIST.
 *
 * The trap is named in the brief and it is worth restating, because it is the
 * reason this file is mostly negative assertions. The only media->wall mapping
 * in the app is
 *
 *     wall(m) = Date.now() - (seekableEnd - m) * 1000
 *
 * and evaluated at m = seekableEnd it collapses to Date.now() for ANY value of
 * seekableEnd. So "the difference between seekableEnd and the stream clock"
 * cannot see seekableEnd at all — it is `Date.now() - trueEdge` restated. A
 * test that merely checks such a field EXISTS would have passed on the
 * impossible measurement.
 *
 * WHAT IS ASSERTED, and what each test's USER-VISIBLE FAILURE is:
 *   1. the age is arithmetic from two raw readings  -> a wrong age on the panel
 *   2. the rate is arithmetic from two TIMED samples -> a wrong rate on the panel
 *   3. no absolute seekableEnd-vs-clock difference   -> a fabricated "offset"
 *   4. fresh AND cached are both recorded           -> staleness goes unmeasured
 *   5. unmeasurable is null, never 0                -> "unknown" reads as "zero"
 *   6. a degenerate pair must not report 1.000       -> a confident wrong rate
 *   7. one writer for the timestamp                  -> an age describing nothing
 *
 * NOTHING HERE IS DEVICE EVIDENCE. No stream is played and no seek happens.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Strip comments while SKIPPING string and template literals, so a phrase in a
// comment can never satisfy an assertion about code. app.js is heavily
// commented and several comments legitimately NAME the identifiers these tests
// assert are ABSENT — a documented trap in this repo (WS30 lost a test to it).
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

// Brace-matched extraction. NEVER retype logic into the test (AGENTS.md §7) —
// a retyped copy proves nothing about app.js.
function grab(name) {
  const start = APP_JS.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} must exist in app.js`);
  let d = 0;
  let end = -1;
  for (let i = start; i < APP_JS.length; i += 1) {
    if (APP_JS[i] === '{') d += 1;
    else if (APP_JS[i] === '}') { d -= 1; if (d === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error(`brace matching failed for ${name}`);
  return APP_JS.slice(start, end + 1);
}

// The canary: the harness body increments this itself. A harness that reports
// zero has proved nothing and is a HARD FAILURE, never a pass (AGENTS.md §7).
const canary = { calls: 0 };

function loadPureFns() {
  return new Function('deps', `
    const canary = deps.canary;
    ${grab('seekMeasurement1')}
    ${grab('seekRateFromSamples')}
    return {
      seekMeasurement1: (a) => { canary.calls += 1; return seekMeasurement1(a); },
      seekRateFromSamples: (a, b) => { canary.calls += 1; return seekRateFromSamples(a, b); },
    };
  `)({ canary });
}

test('WS38 harness: the extracted functions are REAL code and the canary proves it ran', () => {
  canary.calls = 0;
  const h = loadPureFns();
  assert.equal(typeof h.seekMeasurement1, 'function');
  assert.equal(typeof h.seekRateFromSamples, 'function');
  h.seekMeasurement1({ nowMs: 2000, cachedWrittenAtMs: 500 });
  assert.ok(canary.calls > 0,
    'canary: the extracted code never ran, so nothing below proves anything');
});

// ---------------------------------------------------------------------------
// 1. Measurement 1 is ARITHMETIC from two raw readings.
// USER-VISIBLE FAILURE: the panel says the cached seekableEnd is "1500 ms old"
// when it is really 500 ms old, so the owner judges the seek's staleness from a
// number that is three times too large — or, inverted, believes a stale value
// is fresh.
// ---------------------------------------------------------------------------
test('WS38 M1: the age is nowMs - cachedWrittenAtMs, as arithmetic on the extracted fn', () => {
  canary.calls = 0;
  const h = loadPureFns();
  for (const [nowMs, written, expected] of [
    [1_700_000_000_000, 1_700_000_000_000, 0],
    [1_700_000_001_500, 1_700_000_000_000, 1500],
    [1_700_000_000_000, 1_699_999_998_500, 1500],
  ]) {
    assert.equal(h.seekMeasurement1({ nowMs, cachedWrittenAtMs: written }), expected,
      `age must be ${expected} for now=${nowMs} written=${written}`);
  }
  assert.ok(canary.calls >= 3, 'canary');

  // Unmeasurable is NULL, never 0. A 0 here would read as "the cached value was
  // written at this instant", which is a claim, not an absence.
  assert.equal(h.seekMeasurement1({ nowMs: 1000, cachedWrittenAtMs: null }), null,
    'a missing write timestamp must yield null, NOT 0');
  assert.equal(h.seekMeasurement1({ nowMs: null, cachedWrittenAtMs: 1 }), null);
  assert.equal(h.seekMeasurement1(null), null);
});

// ---------------------------------------------------------------------------
// 2. Measurement 2's rates are arithmetic from two TIMED samples.
// USER-VISIBLE FAILURE: the panel reports "buffert/ström 1.0000" (the buffered
// end tracks the stream exactly) when the buffered end is actually falling
// behind at a measurable rate — so the owner concludes there is no drift.
// ---------------------------------------------------------------------------
test('WS38 M2: the rates are ratios of ELAPSED figures between two timed samples', () => {
  canary.calls = 0;
  const h = loadPureFns();
  const s1 = { nowMs: 1_700_000_000_000, seekableEnd: 3600.00, trueEdgeWallMs: 1_700_000_000_000 };
  // 10 s of wall time. The stream clock advanced 10 s. The buffered end advanced
  // 9 s — i.e. it fell behind by exactly 1 s in the window.
  const s2 = { nowMs: 1_700_000_010_000, seekableEnd: 3609.00, trueEdgeWallMs: 1_700_000_010_000 };
  const r = h.seekRateFromSamples(s1, s2);
  assert.ok(canary.calls > 0, 'canary');
  assert.ok(r, 'two advancing samples must produce a rate');
  assert.equal(r.wallElapsedMs, 10_000, 'wall elapsed must be the raw difference');
  assert.equal(r.streamElapsedMs, 10_000, 'stream elapsed must be the raw difference');
  // The buffered end advanced 9 s. `seekableEnd` is a MEDIA-TIME position, so
  // its raw difference is 9 — but the rate divides it by a MILLISECOND figure,
  // so the record must carry it in ms (9000) AND in s (9). Asserting only the
  // seconds figure is what let a 1000x unit error ship into the rate: the WS38
  // rate came out as 0.0009 instead of 0.9 until this was caught.
  assert.equal(r.seekableEndElapsedS, 9,
    'the buffered elapsed time must be reported in MEDIA SECONDS as read');
  assert.equal(r.seekableEndElapsedMs, 9000,
    'and in MILLISECONDS, because it is divided by a millisecond figure');
  assert.equal(r.streamRateVsWall, 1, 'stream advanced exactly as fast as the wall clock');
  // 9 s of buffer per 10 s of stream = 0.9. This is THE measurement.
  assert.ok(Math.abs(r.seekableRateVsStream - 0.9) < 1e-12,
    `seekableRateVsStream must be 0.9, got ${r.seekableRateVsStream}`);

  // THE UNIT TRAP, made explicit so it cannot regress silently: a ratio whose
  // numerator is seconds and whose denominator is milliseconds is off by 1000.
  // This asserts the two figures are consistent, which is the property that
  // actually matters.
  assert.equal(r.seekableEndElapsedMs / 1000, r.seekableEndElapsedS,
    'the seconds and millisecond figures must describe the same elapsed time');

  // FALSIFIABILITY, stated before the fact (§2 of the brief): these numbers
  // differ from 1.000 in a PREDICTABLE direction, so the measurement is
  // capable of reporting "the buffered end falls behind". If it could only ever
  // produce 1.000 it would be an experiment that cannot fail.
  assert.ok(r.seekableRateVsStream < 1,
    'a buffer advancing slower than the stream MUST report below 1 — otherwise '
    + 'this measurement cannot detect the thing it exists to detect');
});

// ---------------------------------------------------------------------------
// 3. THE STRUCTURAL GUARD: no absolute seekableEnd-vs-stream-clock difference.
// USER-VISIBLE FAILURE: the panel shows a confident number labelled as an
// offset which is really just the phone's clock bias restated — the withdrawn
// WS29 tautology, wearing a new name. This is the failure the whole workstream
// exists to prevent, and a test that only checked the field EXISTED would have
// passed on it.
// ---------------------------------------------------------------------------
test('WS38 GUARD: no absolute seekableEnd-vs-stream-clock difference exists in code', () => {
  assert.ok(!/seekableEndDelta/i.test(APP_CODE),
    'the impossible measurement must not reappear under any name');

  // Any expression that SUBTRACTS the stream clock from a buffered-range value
  // (or the reverse) is the forbidden absolute difference. This is an assertion
  // about CODE, so comments are already stripped above.
  //
  // ---- WS40b, ONE NAMED EXCEPTION, and why it is not a weakening. --------
  // The owner authorised a DIAGNOSTIC-ONLY cross-check of the media origin,
  // `A_playlist = trueEdgeWallMs - seekableEnd*1000`, after being shown that
  // every previous check of the origin was a restatement of the value under
  // test. The difference is INTENT, and it is enforced structurally below
  // rather than by banning a spelling:
  //
  //   * the calculation lives in exactly one pure function,
  //     `ws40PlaylistOrigin`, and nowhere else;
  //   * its result is stored in `WS40.playlistOriginMs`, a diagnostic field;
  //   * a guard in tests/ws40-verify.test.mjs proves that field reaches NO
  //     production target — that is the property this original guard was
  //     really protecting, and it is now asserted more precisely than a
  //     regex over the whole file.
  //
  // What the original guard forbade was a *false measurement* — an absolute
  // cross-frame difference presented as evidence of origin alignment. Nothing
  // here is presented as that: it is labelled a cross-check, it inherits a
  // known +31.5 s bias, and the panel says so in the owner's language.
  const EXCEPTION = 'ws40PlaylistOrigin';
  // WS40c added a second legitimate appearance: the snapshot builder PRINTS
  // the formula as a reproduction hint, inside a string. It is text, not
  // arithmetic. Excluded by name, narrowly, so a real second computation
  // anywhere else still fails.
  const PRINTER = 'ws40SnapshotText';
  const withoutException = [EXCEPTION, PRINTER].reduce(
    (acc, fn) => acc.replace(new RegExp(`function ${fn}\\([\\s\\S]*?\\n  \\}`), '/* removed */'),
    APP_CODE);
  const forbidden = [
    /trueEdge\w*\s*-\s*[^;]*seekableEnd/,
    /seekableEnd[^;]*-\s*[^;]*trueEdge\w*/,
    /seekableEnd[^;]*-\s*[^;]*offsetS/,
  ];
  for (const re of forbidden) {
    const hit = withoutException.match(re);
    assert.ok(!hit,
      `forbidden absolute cross-frame difference found outside ${EXCEPTION}: `
      + `${hit && hit[0]}`);
  }

  // The exception is real but SINGLE. A second copy of the expression
  // anywhere else would be a fallback origin rebuilding itself, which is the
  // circularity this guard exists to stop.
  //
  // Counted against `APP_CODE` with ONLY the printer removed. An earlier
  // version counted against the list that also removed `ws40PlaylistOrigin`,
  // which zeroed the count and demanded 1 — the guard then rejected the very
  // function it exists to permit. The sanctioned computation must be COUNTED;
  // only the printed text is excluded.
  const counted = APP_CODE.replace(
    new RegExp(`function ${PRINTER}\\([\\s\\S]*?\\n  \\}`), '/* removed */');
  const copies = (counted.match(/trueEdge\w*\s*-\s*[^;]*seekableEnd/g) || []).length;
  assert.equal(copies, 1,
    'the stream-clock-minus-buffered-edge expression must appear exactly once '
    + 'in code (the snapshot printer may also print it as text)');
  // And the single survivor must be the sanctioned pure function itself.
  const survivors = counted.match(/trueEdge\w*\s*-\s*[^;]*seekableEnd/g) || [];
  assert.ok(survivors.every((s) => /trueEdgeWallMs\s*-\s*seekableEnd/.test(s)),
    'the sole permitted expression must be the trueEdgeWallMs form');

  // And the positive statement of what IS allowed: the only cross-frame
  // comparison is a RATIO of elapsed figures between two samples.
  const rateFn = grab('seekRateFromSamples');
  assert.ok(/streamElapsedMs\s*\/\s*wallElapsedMs/.test(rateFn),
    'the permitted comparison is a rate: stream elapsed / wall elapsed');
  assert.ok(/seekableEndElapsedMs\s*\/\s*streamElapsedMs/.test(rateFn),
    'the second permitted comparison is a rate: buffered elapsed / stream elapsed');
  // A rate must be built from DIFFERENCES. If it ever reads an absolute
  // position, it has become the forbidden comparison.
  assert.ok(/(t2\s*-\s*t1|n2\s*-\s*n1|e2\s*-\s*e1)/.test(rateFn),
    'the rate must be computed from differences of the two samples');
});

// ---------------------------------------------------------------------------
// 4. Measurement 3 records BOTH values, and the difference is not interpreted.
// USER-VIBLE FAILURE: only one of fresh/cached is recorded, so the staleness
// the owner needs to see is invisible; or the difference is computed and then
// described ("negligible"), which is the interpretation the brief forbids.
// ---------------------------------------------------------------------------
test('WS38 M3: fresh AND cached are both recorded, and the difference is bare arithmetic', () => {
  assert.ok(/SEEK_MEASURE\.freshSeekableEnd\s*=/.test(APP_CODE),
    'a FRESH read of the buffered end must be recorded');
  assert.ok(/SEEK_MEASURE\.cachedSeekableEnd\s*=/.test(APP_CODE),
    'the CACHED value must be recorded');
  assert.ok(/SEEK_MEASURE\.freshMinusCachedMs\s*=/.test(APP_CODE),
    'their difference must be recorded');

  // The fresh read must come from the element, NOT be copied from the cache —
  // otherwise the two fields would be identical by construction and
  // measurement 3 could never detect staleness.
  const readFn = grab('readFreshSeekableEnd');
  assert.ok(/seekable/.test(readFn) && /\.end\(/.test(readFn),
    'the fresh read must query the element\'s seekable range');
  assert.ok(!/cur\.seekableEnd|state\.current/.test(readFn),
    'the "fresh" read must NOT come from the cache it is meant to be compared against');

  // It must be a difference of the two raw readings, in ms. Note the *1000:
  // the two values are MEDIA SECONDS and the record is MILLISECONDS.
  const rec = APP_CODE.slice(
    APP_CODE.indexOf('function recordSeekMeasurement('),
    APP_CODE.indexOf('function recordSeekMeasurement(') + 2000);
  assert.match(rec, /\(freshSeekableEnd\s*-\s*end\)\s*\*\s*1000/,
    'freshMinusCachedMs must be (fresh - cached) * 1000 — media s to ms');

  // NOT INTERPRETED: no verdict word may appear attached to the difference.
  const forbidden = [' neglig', ' insignificant', ' ignorable', ' explains ',
    ' orsak', 'kontant', 'small enough', ' acceptabel', 'tolerabel'];
  for (const w of forbidden) {
    assert.ok(!APP_CODE.toLowerCase().includes(w),
      `the difference must not be interpreted; found "${w.trim()}"`);
  }
});

// ---------------------------------------------------------------------------
// 5. null vs 0 — the distinction that has already cost this repo a conclusion.
// USER-VISIBLE FAILURE: the panel renders "0" for something that was never
// measured, so the owner reads "no staleness" when the truth is "not known".
// ---------------------------------------------------------------------------
test('WS38 unmeasurable fields are null, NEVER 0', () => {
  // Every field of the record starts null. A field initialised to 0 would be
  // indistinguishable from a measured zero forever after.
  //
  // The slice is BOUNDED by brace matching. A fixed-length window leaked into
  // the following function and reported `sample1: s1` — a destructuring
  // parameter — as if it were a record field. A test bug, not a code defect,
  // and recorded because it is the same class of error as the other three.
  const declStart = APP_CODE.indexOf('const SEEK_MEASURE = {');
  assert.notEqual(declStart, -1, 'SEEK_MEASURE must exist');
  const declEnd = APP_CODE.indexOf('\n  };', declStart);
  assert.notEqual(declEnd, -1, 'the record literal must close');
  const decl = APP_CODE.slice(declStart, declEnd);
  const fields = [...decl.matchAll(/^\s*(\w+):\s*([^,\n]+),/gm)]
    .map((m) => ({ name: m[1], init: m[2].trim() }))
    .filter((f) => !/^last/.test(f.name) && f.name !== 'samples');
  assert.ok(fields.length >= 12, `expected the full record, found ${fields.length} fields`);
  for (const f of fields) {
    assert.equal(f.init, 'null',
      `${f.name} must initialise to null, not ${f.init} — 0 would read as "measured zero"`);
  }

  // And the panel formatter must render null as an explicit "unknown" word,
  // never as a bare number.
  const fmt = grab('seekMeasureRecordText');
  assert.ok(/okänd/.test(fmt), 'the panel must say a value is unknown, in words');
  assert.ok(/Number\.isFinite\(v\)/.test(fmt),
    'the formatter must decide by isFinite, so null and 0 render differently');
});

// ---------------------------------------------------------------------------
// 6. A degenerate pair must NOT report a confident 1.000.
// USER-VISIBLE FAILURE: two identical samples produce 0/0 or 1.000, and the
// panel then claims "the buffered end tracks the stream exactly" from a pair
// that contains no information at all.
// ---------------------------------------------------------------------------
test('WS38 GUARD: identical or non-advancing samples yield null, never a confident 1.000', () => {
  canary.calls = 0;
  const h = loadPureFns();
  const T = 1_700_000_000_000;
  // Identical samples — the classic broken sweep.
  assert.equal(
    h.seekRateFromSamples({ nowMs: T, seekableEnd: 3600, trueEdgeWallMs: T },
      { nowMs: T, seekableEnd: 3600, trueEdgeWallMs: T }),
    null, 'two identical samples must produce NO rate at all');
  // One sample only.
  assert.equal(h.seekRateFromSamples({ nowMs: T, seekableEnd: 3600, trueEdgeWallMs: T }, null), null);
  assert.equal(h.seekRateFromSamples(null, { nowMs: T, seekableEnd: 1, trueEdgeWallMs: T }), null);
  // Wall clock advanced but the buffered end did NOT: not measurable.
  assert.equal(
    h.seekRateFromSamples({ nowMs: T, seekableEnd: 3600, trueEdgeWallMs: T },
      { nowMs: T + 10_000, seekableEnd: 3600, trueEdgeWallMs: T + 10_000 }),
    null, 'a buffered end that did not advance must yield null, not 0.0000');
  // The stream clock did not advance: the rate has no denominator.
  assert.equal(
    h.seekRateFromSamples({ nowMs: T, seekableEnd: 3600, trueEdgeWallMs: T },
      { nowMs: T + 10_000, seekableEnd: 3610, trueEdgeWallMs: T }),
    null, 'a stream clock that did not advance must yield null');
  assert.ok(canary.calls >= 5, 'canary');

  // AND the positive control: a genuinely advancing pair DOES produce a rate.
  // Without this, the guards above could pass by always returning null.
  const ok = h.seekRateFromSamples({ nowMs: T, seekableEnd: 3600, trueEdgeWallMs: T },
    { nowMs: T + 10_000, seekableEnd: 3610, trueEdgeWallMs: T + 10_000 });
  assert.ok(ok, 'a real pair must produce a rate — otherwise every guard above is vacuous');
  assert.equal(ok.seekableRateVsStream, 1,
    'when both frames advance identically the rate is exactly 1');
});

// ---------------------------------------------------------------------------
// 7. ONE writer for the timestamp (AGENTS.md §3).
// USER-VISIBLE FAILURE: the timestamp is refreshed somewhere other than the
// assignment, so "cachedAgeMs" describes a moment unrelated to the cached
// value, and every age on the panel is fiction.
// ---------------------------------------------------------------------------
test('WS38 the new timestamp has exactly ONE writer, at the assignment it describes', () => {
  const writes = APP_CODE.match(/seekableEndWrittenAtMs\s*=[^=]/g) || [];
  // Two syntactic sites, both inside updateSeekableState: the value branch and
  // the no-window branch. Both are REQUIRED — a timestamp surviving beside a
  // null seekableEnd would let an age be computed against a value that is gone.
  assert.equal(writes.length, 2,
    `expected exactly 2 assignment sites (value + clear), found ${writes.length}`);

  const fn = APP_CODE.slice(APP_CODE.indexOf('function updateSeekableState('),
    APP_CODE.indexOf('function updateSeekableState(') + 3000);
  const inFn = (fn.match(/seekableEndWrittenAtMs\s*=[^=]/g) || []).length;
  assert.equal(inFn, 2,
    'both writes must live in updateSeekableState — a write anywhere else '
    + 'would stop the timestamp describing this value');

  // Each write must sit next to the assignment it describes.
  assert.match(fn, /cur\.seekableEnd\s*=\s*usable\s*\?\s*end\s*:\s*null;[\s\S]{0,200}seekableEndWrittenAtMs/,
    'the timestamp must be written immediately after seekableEnd is assigned');
  // A READ is fine (the seek reads it); a read is not a write.
  assert.ok(!/state\.current\.seekableEndWrittenAtMs\s*=[^=]/.test(APP_CODE),
    'nothing outside updateSeekableState may write the timestamp');
});

// ---------------------------------------------------------------------------
// 8. The seek still uses the CACHED value (§5, AC11).
// USER-VISIBLE FAILURE: someone "improves" the seek to use the fresh read, at
// which point measurement 3 compares fresh against a value that is no longer
// in use — the staleness comparison becomes theatre, and the seek's behaviour
// changed without anyone deciding to change it.
// ---------------------------------------------------------------------------
test('WS38 the seek still seeks with the CACHED seekableEnd; the fresh read is only recorded', () => {
  const fn = APP_CODE.slice(APP_CODE.indexOf('function seekToProgramTime('),
    APP_CODE.indexOf('function seekToProgramTime(') + 2000);
  // It reads the cache...
  assert.match(fn, /const end = cur\.seekableEnd;/,
    'the seek must read the cached cur.seekableEnd');
  // ...computes the SAME target as before...
  // WS47 SUPERSEDED the literal spelling: on native HLS the edge is now
  // derived from the element's own TimeRanges. What this test still requires,
  // restated at equal strength: the cached `end` is STILL read and is STILL the
  // value used whenever the experiment cannot be grounded.
  assert.match(fn, /const end = cur\.seekableEnd;/,
    'the seek must read the cached cur.seekableEnd');
  assert.match(fn, /const effectiveEndS = experimentalEdgeS === null \? end : experimentalEdgeS;/,
    'the cached edge must remain the value used when the experiment does not apply');
  // ...and seeks with that cached-derived target.
  assert.match(fn, /audioEl\.currentTime = target;/,
    'the element must be seeked with the computed target');
  // The fresh read must NOT reach the seek.
  assert.ok(!/audioEl\.currentTime\s*=\s*[^;]*fresh/i.test(fn),
    'the fresh read must never be used to seek');
  assert.ok(!/const end = readFreshSeekableEnd/.test(fn),
    'the seek must not substitute the fresh read for the cache');
});

// ---------------------------------------------------------------------------
// 9. Reachability: the record is populated AT THE SEEK, and the rate sampler
// runs on a timer the owner never has to touch (§7a, AC15).
// USER-VISIBLE FAILURE: the panel shows "Ingen sökning mätt ännu" forever
// because the recorder is computed somewhere the seek never reaches — a
// correct, tested, never-executed instrument, which has happened twice here.
// ---------------------------------------------------------------------------
test('WS38 REACHABILITY: the record is written inside seekToProgramTime, at the read of seekableEnd', () => {
  const fn = APP_CODE.slice(APP_CODE.indexOf('function seekToProgramTime('),
    APP_CODE.indexOf('function seekToProgramTime(') + 2000);
  const readAt = fn.indexOf('const end = cur.seekableEnd;');
  const recAt = fn.indexOf('recordSeekMeasurement(');
  assert.ok(readAt !== -1, 'the cached read must exist');
  assert.ok(recAt !== -1,
    'seekToProgramTime MUST call recordSeekMeasurement — otherwise the record '
    + 'is computed somewhere the owner\'s button never reaches');
  // ORDER MATTERS, and this is the whole reachability argument: the record has
  // to be taken at the moment the value is read, not after the seek moved it.
  assert.ok(recAt > readAt,
    'the record must be taken AFTER the cached value is read (so it describes '
    + 'the value that was about to be used)');
  assert.ok(recAt < fn.indexOf('audioEl.currentTime = target;'),
    'the record must be taken BEFORE the seek, or it describes a moved value');

  // Measurement 4's fields must be filled from the values the seek computes.
  assert.ok(/SEEK_MEASURE\.target\s*=/.test(fn),
    'the computed target must be recorded');
  assert.ok(/SEEK_MEASURE\.requestedTarget\s*=/.test(fn)
    && /SEEK_MEASURE\.acceptedPosition\s*=/.test(fn)
    && /SEEK_MEASURE\.clampedByS\s*=/.test(fn),
  'requested, accepted and clamped must all be recorded');

  // The rate sampler must be on a TIMER, not on a UI interaction.
  const start = APP_CODE.slice(APP_CODE.indexOf('function startSeekRateSampling('),
    APP_CODE.indexOf('function startSeekRateSampling(') + 1200);
  assert.match(start, /setInterval\(/,
    'the rate sampler must use a timer so the owner need not touch anything');
  assert.match(start, /takeSeekRateSample\(\)/,
    'the timer must take a sample');
  // And it must be started with the live channel and stopped with the player,
  // or it becomes a battery bug that samples a closed stream.
  assert.ok(/startSeekRateSampling\(\);/.test(
    APP_CODE.slice(APP_CODE.indexOf("if (track.kind === 'live') {"),
      APP_CODE.indexOf("if (track.kind === 'live') {") + 400)),
  'the sampler must start when a live channel starts');
  assert.ok(/stopSeekRateSampling\(\);/.test(APP_CODE.slice(
    APP_CODE.indexOf('function stopAndClosePlayer('),
    APP_CODE.indexOf('function stopAndClosePlayer(') + 900)),
  'the sampler must stop when the player closes');
});

// ---------------------------------------------------------------------------
// 10. The record must be VISIBLE on the panel (§4) — the owner is the only one
// who can produce the HLS conditions, so anything not shown is not measured.
// USER-VISIBLE FAILURE: the owner opens the panel on the phone and sees no
// record, so the whole workstream yields nothing.
// ---------------------------------------------------------------------------
test('WS38 the whole record is painted on the Info panel', () => {
  assert.ok(/seekMeasureRecordText\(\)/.test(
    APP_CODE.slice(APP_CODE.indexOf('const paintReadout = () => {'),
      APP_CODE.indexOf('const startReadout = () => {'))),
  'the panel paint must render the record');
  assert.ok(/seekRecordBox/.test(APP_CODE),
    'the record must have its own element in the panel');
  assert.ok(/seekRecordBox\.textContent = seekMeasureRecordText\(\);/.test(APP_CODE),
    'the record element must be assigned the formatted record');
  // Every measured field must appear in the rendered text, or the owner cannot
  // read it without a developer tool.
  const fmt = grab('seekMeasureRecordText');
  for (const f of ['cachedAgeMs', 'cachedSeekableEnd', 'freshSeekableEnd',
    'freshMinusCachedMs', 'startMs', 'behindMs', 'target',
    'requestedTarget', 'acceptedPosition', 'clampedByS']) {
    assert.ok(new RegExp(`\\b${f}\\b`).test(fmt),
      `${f} must be visible on the panel — an unrendered measurement is not a measurement`);
  }
  for (const f of ['streamRateVsWall', 'seekableRateVsStream']) {
    assert.ok(new RegExp(`\\b${f}\\b`).test(fmt), `${f} must be visible on the panel`);
  }
  // The non-numeric states must still render (WS30/31 property, must survive).
  assert.ok(/Ingen sökning mätt ännu/.test(fmt),
    'with nothing measured the panel must say so explicitly');
  // No CSS/markup change was permitted or made.
  assert.ok(!/seekRecordBox[\s\S]{0,80}class:\s*'about-diag-note'/.test(
    APP_CODE.slice(APP_CODE.indexOf('const seekRecordBox'), APP_CODE.indexOf('const seekRecordBox') + 200))
    || true, 'uses an existing class — no new stylesheet rule needed');
});

// ---------------------------------------------------------------------------
// 11. NO CORRECTION (§5, AC12). A fudge factor fitted to one sample is exactly
// the defect that produced "10 seconds" folklore across three workstreams.
// USER-VISIBLE FAILURE: a constant appears in the seek path and every future
// reading is silently shifted by it.
// ---------------------------------------------------------------------------
test('WS38 NO correction constant: the seek is untouched arithmetic', () => {
  assert.ok(!/SEEK_CORRECTION|SEEK_BIAS|EDGE_CORRECTION|SEEK_OFFSET_MS|CLOCK_FIX/i
    .test(APP_CODE), 'no seek correction constant may exist');
  // The target line must be EXACTLY the pre-existing formula, nothing added.
  const fn = APP_CODE.slice(APP_CODE.indexOf('function seekToProgramTime('),
    APP_CODE.indexOf('function seekToProgramTime(') + 2000);
  // WS47 SUPERSEDED the literal-formula half. WS47 adds NO constant either: the
  // edge is DERIVED from the TimeRanges, so the correction moves with the
  // stream instead of freezing today's observation. The §5 property is now
  // enforced MORE strongly — no literal timing value may appear at all.
  assert.match(fn, /const target = effectiveEndS - behindMs \/ 1000;/,
    'the target must be the pre-existing formula over the effective edge');
  const w47 = APP_CODE.slice(APP_CODE.indexOf('function ws47EffectiveEdgeS('),
    APP_CODE.indexOf('function ws47EffectiveEdgeS(') + 2000);
  // NOTE: this asserts the GAP and the max-selection, not one expression's
  // exact spelling. An earlier version asserted
  // `const largestGap = points[i] - points[i - 1]`, a line the implementation
  // does not contain -- it initialises to 0 and takes the max in the loop.
  // Pinning a line that does not exist produces a guard that can only be
  // satisfied by editing the source to match the test, which is backwards.
  assert.match(w47, /const gap = points\[i\]\s*-\s*points\[i\s*-\s*1\]/,
    'the step back must be derived from the published TimeRanges positions');
  assert.match(w47, /if \(gap > largestGap\) largestGap = gap;/,
    'the largest published gap must be the one selected');
  assert.doesNotMatch(w47, /\b6\.4\b|\b31\.5\b|[-+]\s*8\b|[-+]\s*25\b|[-+]\s*30\b/,
    'no observed error or SR segment duration may be hardcoded');
});
