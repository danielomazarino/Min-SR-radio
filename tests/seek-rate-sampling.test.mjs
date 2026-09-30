/**
 * WS38-FIX — measurement 2 must be able to obtain TWO INDEPENDENT samples.
 *
 * THE DEFECT THIS EXISTS FOR. The sampler called `sampleStreamEdgeClock()`
 * and then read `STREAM_EDGE_PROBE.trueEdgeWallMs` on the next line. That
 * function is ASYNC — it awaits two playlist fetches before writing the field.
 * So every sample was built from a value that had not been written yet: `null`
 * on the first run, STALE on every run after. The rate could therefore never
 * be produced on ANY platform, and the panel correctly reported "more than one
 * point missing" forever.
 *
 * A suite asserting the sampler "calls the fetch" stayed GREEN throughout that
 * bug, because presence is not ordering. These tests are written against
 * BEHAVIOUR — they execute the real function with a real async fetch and
 * require that two time-separated samples actually yield a rate.
 *
 * WHAT A RATE DOES AND DOES NOT PROVE, preserved deliberately (the owner's
 * correction): a rate near 1.0000 establishes only that two timelines
 * ADVANCE TOGETHER. It does NOT prove their absolute positions are aligned and
 * does NOT eliminate a constant timeline-origin difference. A test below pins
 * that: two timelines with a large constant offset between them must still be
 * able to report 1.0000. Anyone who later reads "1.0000" as "aligned" will
 * find that assertion waiting for them.
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

// ---------------------------------------------------------------------------
// The real sampler, run against a REAL async fetch. `sampleStreamEdgeClock`
// is replaced by a stub that resolves on a later turn of the event loop and
// THEN writes the stream clock — which is exactly the ordering the bug broke.
// Everything else (the sampler body, `seekRateFromSamples`) is the app's own
// extracted code.
// ---------------------------------------------------------------------------
function makeSamplerHarness(overrides = {}) {
  const canary = { samples: 0, fetches: 0 };
  const SEEK_MEASURE = {
    nowMs: null, cachedWrittenAtMs: null, cachedAgeMs: null,
    cachedSeekableEnd: null, freshSeekableEnd: null, freshMinusCachedMs: null,
    startMs: null, behindMs: null, target: null,
    requestedTarget: null, acceptedPosition: null, clampedByS: null,
    rate: null, lastSampleAtMs: null, samples: 0,
    lastSeekableEnd: null, lastTrueEdgeWallMs: null,
  };
  const STREAM_EDGE_PROBE = { trueEdgeWallMs: null, sampledAtMs: null, status: 'idle' };
  const state = { current: { kind: 'live' } };

  let clockMs = 1_700_000_000_000;
  let seekableEnd = 3600.0;
  let streamEdgeWallMs = 1_700_000_000_000;

  const api = new Function('deps', `
    // \`Date\` MUST be destructured here. The sampler calls the BARE
    // \`Date.now()\`, exactly as it does in app.js, so the harness shadows the
    // global by binding it into this function's scope. Passing \`Date\` in
    // \`deps\` without destructuring it here leaves the sampler reading the
    // REAL wall clock — which is why an earlier version of this file reported
    // wallElapsedMs of 22 ms instead of the 10 s the test advanced by.
    const { SEEK_MEASURE, STREAM_EDGE_PROBE, state, ctl, canary, Date } = deps;
    // The extracted readFreshSeekableEnd() closes over \`audioEl\`, exactly as
    // it does in app.js. Without this stub it has nothing to read and returns
    // null, which made the first version of this harness report "no rate" for
    // a reason that had nothing to do with the code under test.
    const audioEl = {
      get seekable() {
        const end = ctl.seekableEnd();
        return {
          length: 1,
          start: () => 0,
          end: () => end,
        };
      },
    };
    ${grab('readFreshSeekableEnd')}
    ${grab('seekMeasurement1')}
    ${grab('seekRateFromSamples')}
    const SEEK_RATE_CLOCK_FRESH_MS = 5000;
    function isMetaDiagReadoutActive() { return ctl.panelOpen; }
    function streamEdgeSampleAgeS() {
      if (!Number.isFinite(STREAM_EDGE_PROBE.sampledAtMs)) return null;
      return (ctl.Date.now() - STREAM_EDGE_PROBE.sampledAtMs) / 1000;
    }
    // The ASYNC fetch, faithfully reproducing the real one's ordering: the
    // stream clock is written only AFTER awaiting.
    async function sampleStreamEdgeClock() {
      canary.fetches += 1;
      await new Promise((r) => setTimeout(r, 1));   // a real await, like a fetch
      STREAM_EDGE_PROBE.trueEdgeWallMs = ctl.streamEdgeWallMs();
      STREAM_EDGE_PROBE.sampledAtMs = ctl.Date.now();
      return STREAM_EDGE_PROBE;
    }
    ${grab('takeSeekRateSample')}
    return {
      take: () => takeSeekRateSample(),
      measure: SEEK_MEASURE,
    };
  `)({
    SEEK_MEASURE, STREAM_EDGE_PROBE, state, canary,
    // The sampler calls the BARE `Date.now()`, exactly as it does in app.js —
    // so the harness must shadow the global `Date` to control time. Without
    // this the sampler read the real wall clock and `wallElapsedMs` came out
    // as the few milliseconds the stub's `await` happened to take, rather than
    // the 10 s the test advanced the simulated clock by.
    Date: { now: () => clockMs },
    ctl: {
      get panelOpen() { return overrides.panelOpen; },
      Date: { now: () => clockMs },
      streamEdgeWallMs: () => streamEdgeWallMs,
      seekableEnd: () => seekableEnd,
    },
  });

  // The sampler reads module-scope `audioEl` and `STREAM_EDGE_PROBE`; provide
  // them through the closure the extracted code closes over.
  api._ctl = { setClock: (v) => { clockMs = v; }, setSeekableEnd: (v) => { seekableEnd = v; }, setStreamEdge: (v) => { streamEdgeWallMs = v; }, canary };
  api._probe = STREAM_EDGE_PROBE;
  return api;
}

// ---------------------------------------------------------------------------
// 1. THE TEST THE BUG WOULD HAVE FAILED.
// USER-VISIBLE FAILURE: the panel says "more than one point missing" for ever,
// so measurement 2 can never be collected and the owner has no rate to bring
// back. This is exactly what was reported.
// ---------------------------------------------------------------------------
test('WS38-FIX the sampler obtains TWO independent samples and produces a rate', async () => {
  const h = makeSamplerHarness({ panelOpen: false });
  const T0 = 1_700_000_000_000;
  h._ctl.setClock(T0);
  h._ctl.setSeekableEnd(3600.0);
  h._ctl.setStreamEdge(T0);

  await h.take();                       // sample 1
  assert.equal(h.measure.samples, 1, 'first sample must be recorded');
  assert.equal(h.measure.rate, null,
    'one sample is not a rate — and null is the honest answer');

  // Advance BOTH timelines by the same amount over a 10 s gap.
  h._ctl.setClock(T0 + 10_000);
  h._ctl.setSeekableEnd(3610.0);
  h._ctl.setStreamEdge(T0 + 10_000);

  await h.take();                       // sample 2

  assert.equal(h.measure.samples, 2, 'second sample must be recorded');
  assert.ok(h._ctl.canary.fetches >= 2,
    'each sample must obtain its OWN stream-clock reading — a single fetch '
    + 'means the second sample reused the first sample\'s clock');
  assert.ok(h.measure.rate,
    'THE TEST THE BUG WOULD HAVE FAILED: two advancing, independently-fetched '
    + 'samples must produce a rate');
  assert.equal(h.measure.rate.wallElapsedMs, 10_000);
  assert.equal(h.measure.rate.streamElapsedMs, 10_000);
  assert.equal(h.measure.rate.seekableEndElapsedS, 10);
  assert.equal(h.measure.rate.streamRateVsWall, 1);
  assert.equal(h.measure.rate.seekableRateVsStream, 1);
});

test('WS38-FIX the sampler AWAITS the fetch: it does not read the clock before it lands', async () => {
  // The bug in its purest form. The stub writes the stream clock only after a
  // real await; a sampler that reads immediately would see `null`.
  const h = makeSamplerHarness({ panelOpen: false });
  h._ctl.setClock(1_700_000_000_000);
  await h.take();
  assert.ok(Number.isFinite(h.measure.lastTrueEdgeWallMs),
    'after awaiting, the sample must carry a real stream-clock value');
  assert.ok(Number.isFinite(h._probe.trueEdgeWallMs),
    'the fetch must actually have completed');

  // And the ORDER is observable: the recorded sample must equal the value the
  // fetch wrote, not a pre-fetch value.
  assert.equal(h.measure.lastTrueEdgeWallMs, h._probe.trueEdgeWallMs,
    'the sample must carry the value the fetch wrote, read AFTER it resolved');
});

// ---------------------------------------------------------------------------
// 2. The panel's state must NOT gate the sampler. This was the second, separate
// defect: the old code skipped its fetch while the panel was open.
// USER-VISIBLE FAILURE: the owner opens the Info panel (the natural thing to
// do) and the rate stops updating — the opposite of what the instrument is for.
// ---------------------------------------------------------------------------
test('WS38-FIX the sampler behaves IDENTICALLY whether the Info panel is open or closed', async () => {
  for (const panelOpen of [false, true]) {
    const h = makeSamplerHarness({ panelOpen });
    const T0 = 1_700_000_000_000;
    h._ctl.setClock(T0);
    h._ctl.setSeekableEnd(3600.0);
    h._ctl.setStreamEdge(T0);
    await h.take();
    h._ctl.setClock(T0 + 10_000);
    h._ctl.setSeekableEnd(3610.0);
    h._ctl.setStreamEdge(T0 + 10_000);
    await h.take();

    assert.equal(h.measure.samples, 2, `samples with panelOpen=${panelOpen}`);
    assert.ok(h.measure.rate,
      `a rate must be obtainable with panelOpen=${panelOpen} — the sampler must `
      + 'not depend on the panel');
  }
  // And the structural proof: the gate must be GONE, not merely bypassed.
  const sampler = grab('takeSeekRateSample');
  assert.ok(!/isMetaDiagReadoutActive\(\)/.test(sampler),
    'the sampler must not consult the panel state at all');
  assert.ok(!/maybeRefreshStreamClockForRate/.test(APP_CODE),
    'the panel-gated helper must be removed, not left in place');
});

// ---------------------------------------------------------------------------
// 3. THE OWNER'S CONCEPTUAL CORRECTION, made executable.
// A rate near 1.0000 must NOT be read as "the timelines are aligned". Two
// timelines offset by a large CONSTANT must still report 1.0000, because a
// rate compares elapsed figures only and never absolute positions.
// USER-VISIBLE FAILURE THIS GUARDS: a future session reports "rate 1.0000,
// so the buffered end and the stream clock agree" and concludes a constant
// timeline-origin difference has been eliminated. It has not.
// ---------------------------------------------------------------------------
test('WS38-FIX a constant timeline-origin difference SURVIVES a rate of 1.0000', () => {
  const fn = new Function(`${grab('seekRateFromSamples')}; return seekRateFromSamples;`)();
  const T = 1_700_000_000_000;
  // The stream clock is 5 hours (18000 s) away from the wall clock — an offset
  // far larger than any real skew. The rate must be blind to it.
  const s1 = { nowMs: T, seekableEnd: 3600.0, trueEdgeWallMs: T + 18_000_000 };
  const s2 = { nowMs: T + 10_000, seekableEnd: 3610.0, trueEdgeWallMs: T + 18_010_000 };
  const r = fn(s1, s2);
  assert.ok(r, 'the pair must produce a rate');
  assert.equal(r.seekableRateVsStream, 1,
    'a 5-hour constant offset between the timelines must NOT change the rate');
  assert.equal(r.streamRateVsWall, 1);
  // The offset is invisible in the rate — which is the whole point, and why a
  // rate must never be reported as evidence of alignment.
  assert.equal(r.streamElapsedMs, 10_000,
    'only the ELAPSED difference is used; the constant cancels');
});

// ---------------------------------------------------------------------------
// 4. null, never a manufactured rate.
// USER-VISIBLE FAILURE: the panel shows "1.0000" when the two samples were
// really the same fetch, or when the buffered end never moved.
// ---------------------------------------------------------------------------
test('WS38-FIX no rate is manufactured when a frame does not advance', async () => {
  const h = makeSamplerHarness({ panelOpen: false });
  const T0 = 1_700_000_000_000;
  h._ctl.setClock(T0);
  h._ctl.setSeekableEnd(3600.0);
  h._ctl.setStreamEdge(T0);
  await h.take();
  // The buffered end does NOT advance, though the clock does.
  h._ctl.setClock(T0 + 10_000);
  h._ctl.setSeekableEnd(3600.0);
  h._ctl.setStreamEdge(T0 + 10_000);
  await h.take();
  assert.equal(h.measure.rate, null,
    'a buffered end that did not advance must yield null, not a rate');
  assert.equal(h.measure.samples, 2,
    'the samples were still TAKEN — a missing rate is not a missing sample');
});

// ---------------------------------------------------------------------------
// 5. One fetch path, and the panel's 20 s refresh untouched.
// USER-VISIBLE FAILURE: a second playlist fetcher is introduced, doubling the
// network cost on a phone, or the panel's own refresh cadence is altered.
// ---------------------------------------------------------------------------
test('WS38-FIX the existing fetch is reused; no second fetch path, and the panel cadence is intact', () => {
  // Exactly one definition of the fetch, reused by both callers.
  assert.equal((APP_CODE.match(/async function sampleStreamEdgeClock\(/g) || []).length, 1,
    'there must be exactly ONE playlist-fetch implementation');
  const sampler = grab('takeSeekRateSample');
  assert.ok(/await sampleStreamEdgeClock\(\)/.test(sampler),
    'the sampler must AWAIT the existing fetch, not write its own');
  // The panel's 20 s cadence is untouched.
  assert.match(APP_CODE, /const META_DIAG_SAMPLE_INTERVAL_MS = 20000;/,
    'the panel stream-clock refresh must remain 20 s');
  // The sampler awaits rather than firing and forgetting.
  assert.match(sampler, /async function takeSeekRateSample\(/,
    'the sampler must be async');
  assert.ok(!/sampleStreamEdgeClock\(\);/.test(sampler.replace(/await sampleStreamEdgeClock\(\);/, '')),
    'every sampler fetch must be awaited — a fire-and-forget fetch is the bug');
});

// ---------------------------------------------------------------------------
// 6. Data-collection only: the seek is untouched.
// USER-VISIBLE FAILURE: the seek calculation changes while "fixing the sampler",
// and a behaviour change ships disguised as an instrumentation fix.
// ---------------------------------------------------------------------------
test('WS38-FIX the seek calculation and the record semantics are UNCHANGED', () => {
  const seek = APP_CODE.slice(APP_CODE.indexOf('function seekToProgramTime('),
    APP_CODE.indexOf('function seekToProgramTime(') + 2000);
  assert.match(seek, /const target = end - behindMs \/ 1000;/,
    'the target formula must be exactly as before');
  assert.match(seek, /const end = cur\.seekableEnd;/,
    'the seek must still use the CACHED seekableEnd');
  assert.ok(!/SEEK_RATE_CLOCK_FRESH_MS/.test(seek),
    'the sampler freshness constant must not touch the seek');
  // No new offset/correction anywhere in the sampler.
  const sampler = grab('takeSeekRateSample');
  assert.ok(!/offsetS|correction|CORRECTION/i.test(sampler),
    'the sampler must compute no offset and no correction');
  // The rate still compares only elapsed figures.
  assert.ok(/seekRateFromSamples\(previous, sample\)/.test(sampler),
    'the sampler must delegate to the rate function, not compute its own ratio');
});
