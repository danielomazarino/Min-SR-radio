/**
 * WS30 — the genuine two-source comparison.
 *
 * THE DEFECT THIS FILE EXISTS FOR. WS29 shipped an on-screen "offset" that was
 * `edgeMinusNowS = (now - (now - X))/1000`, which cancels to `X` — identically
 * the playhead's own distance from the buffer edge. The app was comparing its
 * clock against itself, and the number it showed was a restatement, not a
 * measurement. The owner watched it wander between +1 and −7 and read it
 * correctly: that was the playhead moving, not an offset.
 *
 * The fix is a SECOND clock: the stream carries absolute wall-clock timestamps
 * (`#EXT-X-PROGRAM-DATE-TIME` + the `#EXTINF` sum), which is not derived from
 * this device's clock at all. This file tests that comparison.
 *
 * WHAT IS ASSERTED HERE, AND WHAT IS NOT.
 *   - The parser is driven with REAL captured SR playlist text, so a change in
 *     the real format cannot pass unnoticed.
 *   - The tautology gets its own regression test, and it is written so it goes
 *     red on the WS29 code (see the red proof in SESSION-STATUS.md).
 *   - NOTHING here is device evidence. No stream is played, no audio is
 *     decoded, and the "does the iPhone agree" question is untouched.
 *
 * Pure functions are EXTRACTED from app.js by brace matching and executed.
 * Nothing re-implements the logic under test (AGENTS.md §7).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// ---------------------------------------------------------------------------
// REAL captured fixtures. 2026-09-30, from SR's own CDN, via curl --compressed
// with an Origin header set (AGENTS.md §6: a missing Origin produces a
// misleading CORS result).
//
//   p2.m3u8            -> master, 200, access-control-allow-origin: *
//   p2/p2_320.pls      -> 200, one PDT at the head, 1700 x #EXTINF:6.4,
//                         #EXT-X-MEDIA-SEQUENCE:279804035
//
// The head PDT is 05:23:44Z while the fetch happened near 08:26Z, and the
// buffer is 10880 s long — the head is ~10853 s old against a ~10880 s buffer,
// which is the evidence that this is a ROLLING window and not a stale cache.
// ---------------------------------------------------------------------------
const REAL_MASTER = [
  '#EXTM3U',
  '#EXT-X-CONTENT-STEERING:SERVER-URI="https://roder.sr.se/hls/p2?cc=US",PATHWAY-ID="LJUD1"',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=37333,AVERAGE-BANDWIDTH=34000,CODECS="mp4a.40.29",PATHWAY-ID="LJUD1",STABLE-VARIANT-ID="p2_32"',
  'p2/p2_32.pls',
  '#EXT-X-STREAM-INF:BANDWIDTH=149333,AVERAGE-BANDWIDTH=136000,CODECS="mp4a.40.2",PATHWAY-ID="LJUD1",STABLE-VARIANT-ID="p2_128"',
  'p2/p2_128.pls',
  '#EXT-X-STREAM-INF:BANDWIDTH=373333,AVERAGE-BANDWIDTH=340000,CODECS="mp4a.40.2",PATHWAY-ID="LJUD1",STABLE-VARIANT-ID="p2_320"',
  'p2/p2_320.pls',
  '#EXT-X-STREAM-INF:BANDWIDTH=37333,AVERAGE-BANDWIDTH=34000,CODECS="mp4a.40.29",PATHWAY-ID="LJUD2",STABLE-VARIANT-ID="p2_32"',
  'https://ljud2-cdn.sr.se/lc/p2/p2_32.pls',
  '#EXT-X-STREAM-INF:BANDWIDTH=149333,AVERAGE-BANDWIDTH=136000,CODECS="mp4a.40.2",PATHWAY-ID="LJUD2",STABLE-VARIANT-ID="p2_128"',
  'https://ljud2-cdn.sr.se/lc/p2/p2_128.pls',
  '#EXT-X-STREAM-INF:BANDWIDTH=373333,AVERAGE-BANDWIDTH=340000,CODECS="mp4a.40.2",PATHWAY-ID="LJUD2",STABLE-VARIANT-ID="p2_320"',
  'https://ljud2-cdn.sr.se/lc/p2/p2_320.pls',
  '',
].join('\n');

// A real variant, trimmed to 4 segments but keeping the REAL header lines and
// the real 6.4 s duration. Trimming keeps the fixture readable; the header,
// the PDT format and the duration are exactly as SR emits them.
const REAL_VARIANT = [
  '#EXTM3U',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:6',
  '#EXT-X-MEDIA-SEQUENCE:279804035',
  '#EXT-X-PROGRAM-DATE-TIME:2026-09-30T05:23:44.000Z',
  '#EXTINF:6.4,',
  '279804/p2_320-279804035@300.ts',
  '#EXTINF:6.4,',
  '279804/p2_320-279804036@300.ts',
  '#EXTINF:6.4,',
  '279804/p2_320-279804037@300.ts',
  '#EXTINF:6.4,',
  '279804/p2_320-279804038@300.ts',
  '',
].join('\n');

const MASTER_URL = 'https://ljud1-cdn.sr.se/lc/p2.m3u8';

// Strip comments while SKIPPING string and template literals, so a filename in
// a comment is never mistaken for a filename in the CODE. The repo already
// documents this trap (tests/metadata-diag.test.mjs): app.js is heavily
// commented and several comments legitimately NAME identifiers an assertion is
// trying to prove the code does not use. One WS30 assertion below failed for
// exactly this reason — my own explanatory comment mentioned `p2_320.pls`, and
// the check was reading it as a hardcoded variant.
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

// --- extraction harness -----------------------------------------------------
// CANARY: `harnessCalls` is incremented by the harness body itself, and the
// first test asserts it is non-zero. A harness that reports 0 proved nothing
// and must be reported as a hard failure, never a pass (AGENTS.md §7).
function extractHarness() {
  const src = APP_JS;
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`${name} must exist in app.js`);
    let d = 0, end = -1;
    for (let i = start; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error(`brace matching failed for ${name}`);
    return src.slice(start, end + 1);
  };
  return new Function('deps', `
    const canary = deps && deps.canary;
    if (canary) canary.harnessCalls += 1;
    ${grab('resolveUrl')}
    ${grab('parseMasterVariants')}
    ${grab('parseVariantEdge')}
    ${grab('trueEdgeWallMs')}
    return { resolveUrl, parseMasterVariants, parseVariantEdge, trueEdgeWallMs };
  `);
}

test('WS30 the parser is REAL code, and the canary proves it ran (not a re-typed copy)', () => {
  const canary = { harnessCalls: 0 };
  const h = extractHarness()({ canary });
  assert.ok(canary.harnessCalls > 0,
    'canary: the harness body never ran, so nothing below proves anything');
  for (const fn of ['parseVariantEdge', 'trueEdgeWallMs', 'parseMasterVariants', 'resolveUrl']) {
    assert.equal(typeof h[fn], 'function', `${fn} must be extracted and callable`);
  }
});

test('WS30 parseVariantEdge reads the REAL head PDT and sums the REAL EXTINFs', () => {
  const canary = { harnessCalls: 0 };
  const h = extractHarness()({ canary });
  const parsed = h.parseVariantEdge(REAL_VARIANT);
  assert.ok(canary.harnessCalls > 0, 'canary');
  assert.ok(parsed, 'real SR playlist text must parse');
  // The exact instant SR wrote, not a re-derived one.
  assert.equal(parsed.headPdtMs, Date.parse('2026-09-30T05:23:44.000Z'),
    'the head PROGRAM-DATE-TIME must be read verbatim');
  assert.equal(parsed.segmentCount, 4, 'every segment must be counted');
  assert.equal(parsed.mediaSequence, 279804035, 'the media sequence must be read');
  // 4 x 6.4 s. If the sum is wrong the edge is wrong, and the whole comparison
  // is wrong with it.
  assert.equal(parsed.totalMs, 4 * 6.4 * 1000, 'the EXTINF sum must be exact');
});

test('WS30 trueEdgeWall = head PDT + EXTINF sum, i.e. the STREAM\'s own clock', () => {
  const canary = { harnessCalls: 0 };
  const h = extractHarness()({ canary });
  const parsed = h.parseVariantEdge(REAL_VARIANT);
  const edge = h.trueEdgeWallMs(parsed);
  assert.equal(edge, parsed.headPdtMs + parsed.totalMs,
    'the edge is the head timestamp advanced by the total buffer duration');
  // 05:23:44 + 25.6 s. Guards the arithmetic independently of the parse.
  assert.equal(edge, Date.parse('2026-09-30T05:23:44.000Z') + 25600);
});

test('WS30 a playlist with TWO program-date-times is REFUSED, not silently mis-summed', () => {
  // A discontinuity would make headPdt + sum(EXTINF) meaningless. There are
  // none today (verified 2026-09-30: exactly 1 PDT in the real variant), but a
  // wrong edge presented as a measurement is the failure this workstream
  // exists to prevent, so the parser refuses rather than guesses.
  const canary = { harnessCalls: 0 };
  const h = extractHarness()({ canary });
  const two = REAL_VARIANT.replace(
    '#EXT-X-DISCONTINUITY', '#EXT-X-DISCONTINUITY'
  ) + '#EXT-X-PROGRAM-DATE-TIME:2026-09-30T06:00:00.000Z\n#EXTINF:6.4,\nx/y.ts\n';
  assert.equal(h.parseVariantEdge(two), null,
    'two PDT tags must yield null (no reading), never a number');
  assert.equal(h.parseVariantEdge('#EXTM3U\n#EXTINF:6.4,\na.ts\n'), null,
    'a playlist with no PDT at all must yield null');
  assert.equal(h.parseVariantEdge(''), null, 'empty text must yield null');
  assert.equal(h.parseVariantEdge(null), null, 'null must yield null, not throw');
});

test('WS30 the master is the source of truth: highest bandwidth, relative AND absolute URIs', () => {
  const canary = { harnessCalls: 0 };
  const h = extractHarness()({ canary });
  const vs = h.parseMasterVariants(REAL_MASTER, MASTER_URL);
  assert.ok(canary.harnessCalls > 0, 'canary');
  assert.equal(vs.length, 6, 'SR\'s master lists two pathways x three variants');
  // Relative URIs must resolve against the master's own URL...
  assert.equal(vs[0].url, 'https://ljud1-cdn.sr.se/lc/p2/p2_32.pls',
    'a relative variant URI must resolve against the master URL');
  // ...and absolute ones must be left alone.
  assert.equal(vs[3].url, 'https://ljud2-cdn.sr.se/lc/p2/p2_32.pls',
    'an absolute variant URI must pass through unchanged');
  // The chosen variant is the highest bandwidth, taken from the manifest and
  // NOT hardcoded (a hardcoded p2_320 would break the moment SR renames it).
  let best = vs[0];
  for (const v of vs) if (v.bandwidth > best.bandwidth) best = v;
  assert.equal(best.bandwidth, 373333);
  assert.equal(best.url, 'https://ljud1-cdn.sr.se/lc/p2/p2_320.pls',
    'the first entry of the highest bandwidth wins (LJUD1, what the app plays)');
  // Comments stripped: this asks whether the CODE hardcodes a variant, and a
  // filename appearing in a comment is documentation, not a hardcode.
  //
  // THE WINDOW MUST CONTAIN THE FETCHER. This test originally ran from
  // `parseMasterVariants` to `sampleStreamEdgeClock`, which EXCLUDES the
  // fetcher — so hardcoding a variant inside the fetcher was invisible and the
  // mutation proof caught it going green. The window now spans parser through
  // the end of the fetcher's own body.
  const from = APP_CODE.indexOf('function parseMasterVariants');
  const to = APP_CODE.indexOf('function streamEdgeSampleAgeS');
  const between = APP_CODE.slice(from, to);
  assert.ok(from !== -1 && to > from, 'the parser and the age helper must both exist');
  assert.ok(!/\.pls\b/.test(between),
    'no variant filename may be hardcoded anywhere in the two-source code path');
  // And positively: the fetcher must still SELECT from the parsed variants by
  // bandwidth, rather than using whatever the parser returned first.
  assert.match(between, /bandwidth\s*>\s*best\.bandwidth/,
    'the highest-bandwidth variant must be selected from the manifest');
});

test('WS30 resolveUrl handles the four URL forms a manifest can contain', () => {
  const canary = { harnessCalls: 0 };
  const h = extractHarness()({ canary });
  const base = 'https://ljud1-cdn.sr.se/lc/p2.m3u8';
  assert.equal(h.resolveUrl('p2/p2_320.pls', base), 'https://ljud1-cdn.sr.se/lc/p2/p2_320.pls');
  assert.equal(h.resolveUrl('/lc/p2_320.pls', base), 'https://ljud1-cdn.sr.se/lc/p2_320.pls');
  assert.equal(h.resolveUrl('./p2_320.pls', base), 'https://ljud1-cdn.sr.se/lc/p2_320.pls');
  assert.equal(h.resolveUrl('../x/p.pls', base), 'https://ljud1-cdn.sr.se/x/p.pls',
    'a parent-relative URI must not escape the origin');
  assert.equal(h.resolveUrl('//ljud2-cdn.sr.se/lc/p.pls', base), 'https://ljud2-cdn.sr.se/lc/p.pls');
  assert.equal(h.resolveUrl('https://other.example/p.pls', base), 'https://other.example/p.pls');
  assert.equal(h.resolveUrl('', base), null, 'an empty URI must be null, not the base');
  assert.equal(h.resolveUrl('p.pls', 'not a url'), null,
    'an unresolvable base must be null rather than a silently wrong URL');
});

test('WS30 THE TAUTOLOGY REGRESSION: the panel shows the STREAM clock, not the app\'s own', () => {
  // This is the test the whole workstream is for.
  //
  // The user-visible failure it catches: the panel shows the playhead's
  // distance from the buffer edge while calling it an offset. That is what the
  // owner saw, and it moved with the playhead, which is why it wandered between
  // +1 and -7.
  //
  // The world below is constructed so the two quantities are WILDLY different:
  // the app's edgeMinusNowS (the tautology) reads +27, while the real two-source
  // offset is -28. If the panel rendered the tautology this fails on the value,
  // and it also fails on the text.
  //
  // GOES RED ON THE WS29 CODE: that code read `edge.edgeMinusNowS` and would
  // return ok:true with +27. Verified by the red proof in SESSION-STATUS.md.
  const src = APP_JS;
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist in app.js`);
    let d = 0, end = -1;
    for (let i = start; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) { end = i; break; } }
    }
    assert.notEqual(end, -1, `brace matching failed for ${name}`);
    return src.slice(start, end + 1);
  };
  const canary = { buildCalls: 0, readoutCalls: 0 };
  const readout = new Function('deps', `
    const { dvr, canary } = deps;
    // WS31: the readout also reads playback.current (is anything playing?) and
    // dvr.transportKind (is it HLS?). Both are supplied so the fixture is a
    // world that can actually occur: a live radio channel on HLS.
    function metaDiagBuildSnapshot() {
      canary.buildCalls += 1;
      return {
        playback: { current: { kind: 'live', id: 164 } },
        dvr,
      };
    }
    ${grab('metaDiagReadoutLines')}
    return { readout: () => { canary.readoutCalls += 1; return metaDiagReadoutLines(); } };
  `)({
    canary,
    dvr: {
      // THE TAUTOLOGY, present and plausible: +27 s.
      streamEdge: { edgeMinusNowS: 27, selfReferential: true },
      // THE REAL COMPARISON: the stream's clock is 28 s AHEAD of the app's.
      twoSource: {
        status: 'ok',
        appEdgeWallMs: 1_700_000_000_000,
        trueEdgeWallMs: 1_700_000_028_000,
        offsetS: -28,
        sampleAgeS: 1.1,
        stale: false,
      },
      transportKind: 'hls-hlsjs',
      seek: { clampedByS: null },
    },
  });

  const r = readout.readout();
  assert.ok(canary.readoutCalls > 0, 'canary: metaDiagReadoutLines was never called');
  assert.equal(r.ok, true, 'a real two-source sample must be reported');
  assert.equal(r.seconds, -28,
    'the panel must show the two-source offset (-28), never the tautology (+27)');
  assert.ok(!r.primary.includes('+27'),
    `the self-referential value must never be rendered (got: ${r.primary})`);
});

test('WS30 the tautology is arithmetically what we say it is, so the claim is not folklore', () => {
  // A claim in a comment that nothing checks becomes folklore. This asserts the
  // cancellation DIRECTLY: for any seekableEnd and currentTime, the WS29
  // formula yields exactly `end - currentTime`, which is the playhead's
  // distance from the edge. If someone "fixes" the app's clock handling, this
  // still holds — it is a property of the formula, not of the app.
  const NOW = 1_700_000_000_000;
  for (const [end, currentTime] of [[NOW / 1000, NOW / 1000 - 7], [NOW / 1000 + 12, NOW / 1000], [0, 0]]) {
    const streamEdgeWallMs = NOW - (end - currentTime) * 1000;
    const edgeMinusNowS = Math.round((NOW - streamEdgeWallMs)) / 1000;
    assert.equal(edgeMinusNowS, end - currentTime,
      'edgeMinusNowS collapses to the playhead distance from the edge');
  }
  // And that quantity is a NUMBER THE APP ALREADY KNOWS, which is what makes
  // the panel's old reading a restatement rather than a measurement.
  assert.ok(APP_JS.includes('distanceFromLiveEdge'),
    'the collapsed quantity is the app\'s own distanceFromLiveEdge');
});

test('WS30 the sign and the Swedish direction word MUST agree (browser-caught bug)', () => {
  // The built-in browser caught this: the first version rendered
  // "−30 s före", pairing a minus sign with the word for AHEAD. It was caught
  // by reading the RENDERED output of a real offset (-30.4 s), not by any test.
  //
  // offsetS is app-relative: (appEdge - trueEdge). Swedish "före" = ahead,
  // "efter" = behind. So:
  //   offsetS > 0  ->  the app's belief is LATER  ->  "före"  (ahead)
  //   offsetS < 0  ->  the app's belief is EARLIER ->  "efter" (behind)
  // A reader must be able to read the sign and the word and have them agree.
  const src = APP_JS;
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist in app.js`);
    let d = 0, end = -1;
    for (let i = start; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) { end = i; break; } }
    }
    assert.notEqual(end, -1, `brace matching failed for ${name}`);
    return src.slice(start, end + 1);
  };
  const render = (offsetS) => new Function('deps', `
    const { dvr } = deps;
    // WS31: supply playback.current and transportKind so the fixture is a real
    // world -- a live radio channel on HLS with a reading.
    function metaDiagBuildSnapshot() {
      return { playback: { current: { kind: 'live', id: 164 } }, dvr };
    }
    ${grab('metaDiagReadoutLines')}
    return metaDiagReadoutLines();
  `)({
    dvr: {
      streamEdge: { edgeMinusNowS: 99 },
      twoSource: { status: 'ok', offsetS, sampleAgeS: 1, stale: false },
      transportKind: 'hls-hlsjs',
      seek: { clampedByS: null },
    },
  });

  for (const [offsetS, sign, word] of [
    [-30.4, '−', 'efter'],   // the exact case the browser produced
    [12.0, '+', 'före'],
    [0, '±', 'i linje med'],
  ]) {
    const r = render(offsetS);
    assert.equal(r.ok, true, `offset ${offsetS} must render a reading`);
    assert.ok(r.primary.includes(sign),
      `offset ${offsetS}: expected sign "${sign}" in "${r.primary}"`);
    if (word !== 'i linje med') {
      assert.ok(r.primary.includes(word),
        `offset ${offsetS}: expected direction "${word}" in "${r.primary}" — a sign `
        + 'and a direction word that disagree are worse than no number');
      // The forbidden pairing, named explicitly so the intent survives.
      if (offsetS < 0) {
        assert.ok(!r.primary.includes('före'),
          `a negative offset must not be called "före" (ahead) — got "${r.primary}"`);
      } else if (offsetS > 0) {
        assert.ok(!r.primary.includes('efter'),
          `a positive offset must not be called "efter" (behind) — got "${r.primary}"`);
      }
    }
  }
});

test('WS30/33 NO CORRECTION CONSTANT anywhere: the offset is measured, not fitted', () => {
  // AGENTS.md §5. The brief for this workstream made this an explicit
  // acceptance criterion, and a constant fitted to one sample is exactly the
  // defect that produced "10 seconds" folklore across three workstreams.
  assert.ok(!/STREAM_EDGE_CORRECTION|EDGE_CORRECTION_S|SEEK_CORRECTION|EDGE_OFFSET_CONSTANT/i.test(APP_CODE),
    'no stream-edge correction constant may exist');
  // The offset must be a difference of two clocks and nothing else.
  const i = APP_CODE.indexOf('STREAM_EDGE_PROBE.offsetS =');
  assert.ok(i !== -1, 'the offset must be assigned explicitly');
  // ANCHORED, not a bare indexOf on a constant name: the first test wrote
  // `/CONSTANT_NAME/` as the assertion, which passed with the name present in
  // an unrelated throwaway string and stayed green when a real -28 was
  // subtracted. The assignment itself must be the difference of two clocks.
  //
  // ---- WS33: the operand name CHANGED, and this is a SUPERSEDED assertion,
  // not a weakened one. (AGENTS.md §7b — classified before it was edited.)
  //
  // It previously read `= (appEdge - trueEdge)/1000`. It went RED on the WS33
  // change, and the reason is the point of this workstream, not an accident:
  //   appEdge = streamEdgeWallMs() = Date.now() - (end - currentTime) * 1000
  // so `appEdge - trueEdge` does NOT cancel the playhead term — it survives as
  // `-distanceFromLiveEdge`. The assertion was pinning the CONTAMINATED
  // operand. It was not wrong about "no constant"; it was wrong about WHICH
  // two clocks, and that is exactly what WS33 fixed.
  //
  // The requirement is restated, not relaxed. It is now STRONGER, because it
  // adds checks the old version had no way to express: the first operand must
  // be a bare `Date.now()`, and `currentTime` must not reach the comparison
  // by any route at all.
  const assign = APP_CODE.slice(i, i + 120);
  assert.match(assign, /=\s*\(deviceNow\s*-\s*trueEdge\)\s*\/\s*1000\s*;/,
    'the offset must be EXACTLY (deviceNow - trueEdge)/1000 — no added or '
    + `subtracted term (got: ${JSON.stringify(assign.slice(0, 60))})`);
  // And the new first operand must be this device's wall clock and NOTHING
  // else. This is the WS33 invariant stated where a reader will meet it.
  const bindAt = APP_CODE.lastIndexOf('const deviceNow = Date.now()', i);
  assert.ok(bindAt !== -1,
    'the first operand must be bound to a bare Date.now()');
  // Belt and braces: no numeric literal may be subtracted from it anywhere.
  assert.ok(!/\(deviceNow\s*-\s*trueEdge\)\s*\/\s*1000\s*[-+*]/.test(APP_CODE),
    'the offset expression must not be adjusted by any constant');
  // WS33: the playhead must not reach the comparison by ANY route, including
  // one reintroduced outside the literal assignment asserted above.
  const compare = APP_CODE.slice(
    APP_CODE.indexOf('const trueEdge = trueEdgeWallMs(parsed);'),
    APP_CODE.indexOf('STREAM_EDGE_PROBE.segmentCount ='));
  assert.ok(/const deviceNow = Date\.now\(\)/.test(compare),
    'the comparison must be built from a Date.now() binding');
  assert.ok(!/offsetS\s*=\s*[^;]*currentTime/.test(compare),
    'currentTime must never appear in an offsetS assignment');
  assert.ok(!/offsetS\s*=\s*[^;]*streamEdgeWallMs/.test(compare),
    'offsetS must not be derived from streamEdgeWallMs — that function '
    + 'contains the playhead term (WS33)');
});

test('WS30 R-A REACHABILITY: opening the panel is what triggers a sample', () => {
  // AGENTS.md §7a — a correct, tested, never-executed fix is the most expensive
  // defect in this repo, and it has happened twice for this same class of gate.
  // The owner's path is: channel playing -> cog -> Info -> switch on. If the
  // fetch only ran on a poll, the owner would open the panel onto a stale or
  // empty number, which is indistinguishable from "no offset".
  const src = APP_JS;
  const start = src.indexOf('const startReadout = () => {');
  assert.notEqual(start, -1, 'startReadout must exist');
  const end = src.indexOf('diagSwitch.addEventListener', start);
  const body = src.slice(start, end);
  // PRESENCE IS NOT ENOUGH, and the mutation proof is why. startReadout holds
  // TWO call sites — the panel-open fetch and the setInterval callback — so an
  // assertion of the form "the body contains sampleStreamEdgeClock()" stays
  // green after the PANEL-OPEN one is deleted. That is the exact reachability
  // failure AGENTS.md §7a is about, hidden inside my own test.
  //
  // So the panel-open call is asserted as a STATEMENT that appears BEFORE the
  // interval is created: that ordering is what makes it happen on open.
  const openFetch = body.indexOf('sampleStreamEdgeClock()');
  const intervalAt = body.indexOf('sampleTimer = setInterval');
  assert.ok(openFetch !== -1, 'turning the switch on MUST request a sample');
  assert.ok(intervalAt !== -1, 'a periodic refresh must exist');
  assert.ok(openFetch < intervalAt,
    'the sample must be requested BEFORE the interval is created, so it happens '
    + 'on panel open rather than only 20 s later');

  // And the switch handler must be the thing that calls startReadout, so the
  // owner's actual action reaches the fetch.
  const click = src.slice(src.indexOf("diagSwitch.addEventListener"),
    src.indexOf("diagSwitch.addEventListener") + 700);
  assert.ok(/if \(next === 'on'\) startReadout\(\); else stopReadout\(\);/.test(click),
    'turning the switch on must call startReadout, which is where the fetch lives');

  // The sample must ALSO refresh, or the panel shows one reading for ever.
  assert.ok(body.includes('sampleTimer = setInterval'),
    'a periodic refresh must exist, or the sample goes stale with no warning');

  // The paint cadence must NOT fetch: SR's playlist rolls every few seconds
  // and a fetch per 2 s repaint is a battery bug that looks broken on a phone.
  const paint = src.slice(src.indexOf('const paintReadout = () => {'),
    src.indexOf('const startReadout = () => {'));
  assert.ok(!paint.includes('sampleStreamEdgeClock'),
    'the 2 s repaint must only repaint; sampling has its own slower interval');
  assert.ok(src.includes('const META_DIAG_SAMPLE_INTERVAL_MS'),
    'the sample cadence must be a named constant, not a bare literal');
});

test('WS30 both timers are cleared on close, so nothing outlives the Info sheet', () => {
  // WS29 fixed this for the paint timer; the sample timer must not reintroduce
  // the bug. A second `let sampleTimer` declared further down would shadow and
  // the close handler would clear nothing.
  const src = APP_JS;
  // WS60 RE-ANCHOR (2026-10-04): the window was a hard-coded 1400 characters from
  // `function openAbout(`. That is a slice of a COMMENT-SHAPED region, so adding
  // any explanatory comment above the declarations pushes them past the cut and
  // the test reports a missing declaration that is present in the file — exactly
  // the false failure this test already records once above.
  //
  // Now bounded by the function's own close, brace-matched, so it survives any
  // comment or code inserted inside openAbout. The three assertions are
  // UNCHANGED.
  const openStart = src.indexOf('function openAbout(');
  assert.notEqual(openStart, -1, 'openAbout must exist');
  let depth = 0;
  let openEnd = -1;
  for (let i = src.indexOf('{', openStart); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) { openEnd = i + 1; break; }
    }
  }
  assert.notEqual(openEnd, -1, 'openAbout body must be brace-matchable');
  const open = src.slice(openStart, openEnd);
  assert.ok(/let readoutTimer = null;/.test(open), 'readoutTimer declared at the top');
  assert.ok(/let sampleTimer = null;/.test(open),
    'sampleTimer must be declared beside readoutTimer so close() can see it');
  // The window must reach the actual clear calls. A too-short slice produced a
  // false failure on `clearInterval(readoutTimer)` — the call is present in the
  // code but sits past the cut, which is a test bug and not a defect.
  //
  // TRAP, and it already bit this test once: `src.indexOf('const close = () => {')`
  // finds the FIRST such function in a 6000-line file, and there is an unrelated
  // one earlier. Anchored on a marker unique to the Info sheet instead.
  const closeStart = src.indexOf('const close = () => {', src.indexOf('function openAbout('));
  assert.notEqual(closeStart, -1, 'close() must exist inside openAbout');
  // WS60 RE-ANCHOR (2026-10-04). The end marker was `const closeBtn`, which
  // used to sit BELOW the close() definition. WS60 moved the close button up to
  // build the sheet's header row, so `indexOf` now finds nothing after
  // closeStart and the slice ran to the end of the file — reading a 6000-line
  // region and reporting `readoutTimer declared at the top` as missing.
  //
  // Re-anchored on the first statement INSIDE close(), which is what the two
  // assertions actually care about. Both assertions are unchanged.
  const closeEnd = src.indexOf('};', closeStart);
  assert.ok(closeEnd > closeStart, 'close() body must be findable');
  const close = src.slice(closeStart, closeEnd + 2);
  assert.ok(close.includes('clearInterval(readoutTimer)'),
    'close() must clear the paint timer');
  assert.ok(close.includes('clearInterval(sampleTimer)'),
    'close() must clear the sample timer');
  // Exactly one declaration of each: a shadowing second one silently breaks close.
  const decls = (src.match(/let sampleTimer = null;/g) || []).length;
  assert.equal(decls, 1, 'sampleTimer must be declared exactly once (no shadowing)');
});

test('WS30 the probe is ONE WRITER, and the panel is a reader (AGENTS.md §3)', () => {
  // Two writers to one field is the most damaging bug class in this repo. The
  // fetch writes STREAM_EDGE_PROBE; the 2 s repaint must only read it.
  const src = APP_JS;
  const paint = src.slice(src.indexOf('const paintReadout = () => {'),
    src.indexOf('const startReadout = () => {'));
  assert.ok(!/STREAM_EDGE_PROBE\.[a-zA-Z]+\s*=[^=]/.test(paint),
    'the repaint must not write any probe field');
  // The snapshot is a reader too: it must not assign into the probe.
  const snap = src.slice(src.indexOf('twoSource: {'),
    src.indexOf('twoSource: {') + 1600);
  assert.ok(!/STREAM_EDGE_PROBE\.[a-zA-Z]+\s*=[^=]/.test(snap),
    'the snapshot must not write any probe field');
  // And the Info sheet must stay read-only with respect to playback.
  const panel = src.slice(src.indexOf('function openAbout('),
    src.indexOf('about.appendChild(body);'));
  for (const w of ['state.current =', 'audioEl.currentTime =', 'audioEl.src =',
    'seekableEnd =', '.play()', '.pause()', 'hlsDetach(']) {
    assert.ok(!panel.includes(w), `the Info sheet must not contain "${w}"`);
  }
});

test('WS30 a failed fetch clears to an explicit state, never a stale number', () => {
  // R-B. `status` is what every reader keys on, so a failure cannot leave the
  // previous offset visible as if it were current. Asserted against the
  // snapshot's own status field rather than prose.
  const src = APP_JS;
  const snap = src.slice(src.indexOf('twoSource: {'),
    src.indexOf('twoSource: {') + 1600);
  assert.ok(/status: STREAM_EDGE_PROBE\.status/.test(snap),
    'the snapshot must expose the enum status, not just the number');
  // The catch branch must set failed AND leave the number out of reach. The
  // window is anchored on the sampler's OWN catch, not on the first `catch`
  // in the file — `loadFavorites` has one far earlier, and an indexOf on
  // `} catch (err) {` alone silently matched THAT instead.
  const catchStart = src.indexOf('} catch (err) {', src.indexOf('async function sampleStreamEdgeClock'));
  assert.notEqual(catchStart, -1, 'the sampler must have a catch branch');
  const catchBlock = src.slice(catchStart,
    src.indexOf('} finally {', catchStart));
  assert.ok(/STREAM_EDGE_PROBE\.status = 'failed'/.test(catchBlock),
    'a failed fetch must set status failed');
  assert.ok(!/offsetS\s*=[^=]/.test(catchBlock),
    'a failed fetch must NOT assign an offset');
  // offsetS is only ever assigned on the success path.
  const assigns = src.match(/STREAM_EDGE_PROBE\.offsetS\s*=[^=]/g) || [];
  assert.equal(assigns.length, 1,
    'offsetS must be assigned in exactly ONE place — the success path');
});

// ===========================================================================
// WS33 — the offset was still the playhead's own distance from the live edge.
//
// THE DEFECT. WS30 replaced a tautology, but the replacement kept the
// `currentTime` term:
//
//   appEdge = streamEdgeWallMs() = Date.now() - (end - currentTime) * 1000
//   offsetS = (appEdge - trueEdge) / 1000
//
// `Date.now()` cancels, but `currentTime` does NOT — it survives as
// `-distanceFromLiveEdge`. So the panel reported
//
//     clockBias - distanceFromLiveEdge
//
// With a PERFECT device clock, 30 minutes behind live, it read -1800 s while
// the true bias was 0 s. The number the owner most wants to compare against
// the programme-skip error was buried inside a term they cannot see, and the
// instrument was only valid at one playhead position.
//
// WHY THESE TESTS ARE ARITHMETIC AND NOT STRING MATCHES. A test asserting
// "the assignment is (deviceNow - trueEdge)/1000" passes on a codebase where
// `deviceNow` is itself contaminated. Only an INVARIANT can fail here, so the
// central test below EVALUATES THE REAL EXTRACTED ASSIGNMENT against a
// controlled clock, at two playhead positions, and requires the results to be
// identical. A transcription of the formula into the test would prove nothing
// about app.js (AGENTS.md §7).
//
// WHAT NONE OF THIS PROVES: anything about the owner's iPhone, and nothing
// about whether the app mis-seeks. It is arithmetic over the app's own
// expressions plus the rendered text those expressions feed.
// ===========================================================================

// Extracts the REAL success-path block of sampleStreamEdgeClock — from the
// stream's clock to the `status = 'ok'` line — and runs it with injected
// `Date.now`, `trueEdgeWallMs`, `streamEdgeWallMs` and a recording probe.
//
// The probe is a real object the extracted code writes into, so `offsetS` is
// read back from the app's own assignment rather than recomputed here.
function ws33Sample(sourceText, { nowMs, trueEdge, appEdge }) {
  const src = sourceText;
  const start = src.indexOf('const trueEdge = trueEdgeWallMs(parsed);');
  const end = src.indexOf("STREAM_EDGE_PROBE.status = 'ok';", start);
  if (start === -1 || end === -1) throw new Error('the sample block must exist in app.js');
  const block = src.slice(start, end);
  const canary = { samples: 0 };
  const probe = { offsetS: undefined, deviceNowMs: undefined, appEdgeWallMs: undefined };
  const result = new Function('deps', `
    const { nowMs, trueEdge: trueEdgeStub, appEdge, probe, canary, STREAM_EDGE_PROBE } = deps;
    // ---- the stand-ins ----
    // \`parsed\` and \`trueEdgeWallMs\` are pure and already covered above; the
    // point here is the ARITHMETIC the app does with the result, so the parser
    // is stubbed at its output and the CLOCK is what is controlled.
    //
    // NOTE the alias: the injected value is bound as \`trueEdgeStub\`, NOT
    // \`trueEdge\`. The extracted block declares \`const trueEdge =\` itself, so
    // binding the same name here is a redeclaration and the whole harness dies
    // with a SyntaxError. That failure is loud, which is why it is safe — but
    // it is a harness bug, not a finding, and it is recorded here so the next
    // session does not read it as a defect in app.js.
    const parsed = { headPdtMs: trueEdgeStub, totalMs: 0 };
    function trueEdgeWallMs(p) { return p.headPdtMs; }
    // The app's belief, verbatim from the WS30 code, INCLUDING the playhead
    // term. It is injected rather than derived, because what is under test is
    // whether the app's subtraction is INVOLVED — not what its contents are.
    function streamEdgeWallMs() { return appEdge; }
    const Date = { now: () => nowMs };
    // The block continues past the arithmetic into the two provenance fields.
    // They are stubbed rather than the block being TRUNCATED, because cutting
    // the extraction short would mean the harness stops running the same code
    // the app runs — the trap AGENTS.md §7 warns about.
    const best = { url: 'https://example.invalid/v.pls' };
    const masterUrl = 'https://example.invalid/m.m3u8';
    ${block}
    Object.assign(probe, {
      offsetS: STREAM_EDGE_PROBE.offsetS,
      deviceNowMs: STREAM_EDGE_PROBE.deviceNowMs,
      appEdgeWallMs: STREAM_EDGE_PROBE.appEdgeWallMs,
    });
    canary.samples += 1;
    return probe;
  `)({ nowMs, trueEdge, appEdge, probe, canary, STREAM_EDGE_PROBE: probe });
  return { probe, result, canary, block };
}

test('WS33 THE INVARIANT: offsetS is INDEPENDENT of the playhead position', () => {
  // THE TEST THAT FAILS ON THE WS30 CODE. Everything else here is corroboration.
  //
  // USER-VISIBLE FAILURE IT CATCHES: the owner scrubs back 30 minutes, opens
  // the timing panel, and reads "Appens klocka ligger 1800 s efter strömmens".
  // They conclude their device clock is half an hour slow. It is not — the
  // panel is reporting how far THEY have scrubbed, wearing the word "offset".
  // Everything they compare that number against is then meaningless.
  //
  // THE METHOD, and why it cannot pass by accident:
  //   - the code under test is EXTRACTED from app.js, not retyped (AGENTS.md §7);
  //   - `streamEdgeWallMs()` is injected WITH a playhead-dependent value, so if
  //     the app subtracts it, the contamination is live and the test goes red;
  //   - the clock is held PERFECT (`trueEdge === nowMs`, zero bias) so the only
  //     thing that can move the result is the playhead.
  // A result could have come out differently: if the app's clock were wrong,
  // both rows would move TOGETHER and the difference would still be zero. So
  // "the two agree" alone would be a weaker claim than intended — which is why
  // the third assertion pins the value itself.

  const NOW = 1_700_000_000_000;          // a fixed instant
  const END = NOW / 1000;                 // a plausible seekableEnd
  // A PERFECT device clock: the stream's own clock IS this device's clock, so
  // the true bias is exactly 0 s and anything non-zero is contamination.
  const TRUE_EDGE = NOW;

  // Two playhead positions, 30 minutes apart, with `streamEdgeWallMs()`
  // carrying the app's real (playhead-dependent) belief for each.
  const at = (currentTime) => ({
    nowMs: NOW,
    trueEdge: TRUE_EDGE,
    appEdge: NOW - (END - currentTime) * 1000,   // the WS30 formula, verbatim
  });
  const live = ws33Sample(APP_JS, at(END));
  const behind = ws33Sample(APP_JS, at(END - 1800));

  // Canary: the extracted block must actually have run. A harness that reports
  // zero proves nothing and is a hard failure, never a pass (AGENTS.md §7).
  assert.ok(live.canary.samples > 0, 'canary: the extracted sample block never ran');
  assert.ok(behind.canary.samples > 0, 'canary: the extracted sample block never ran');

  // THE INVARIANT. Same stream clock, different playhead, identical offset.
  assert.equal(live.probe.offsetS, behind.probe.offsetS,
    'offsetS changed when only the PLAYHEAD moved — the comparison is still '
    + 'reading currentTime. The panel would show the scrub distance as an '
    + `offset (live=${live.probe.offsetS}, 30min behind=${behind.probe.offsetS})`);

  // And pinned, so "the two agree" cannot pass by both being wrong. With a
  // perfect clock the ONLY correct answer is 0.
  assert.equal(live.probe.offsetS, 0,
    `with a perfect device clock the offset must be exactly 0, got ${live.probe.offsetS}`);
  assert.equal(behind.probe.offsetS, 0,
    `30 minutes behind live must STILL read 0 with a perfect clock, got ${behind.probe.offsetS}`);

  // The contaminating value IS present and IS different at the two positions —
  // otherwise this test could pass simply because the stub was constant, which
  // would make it an experiment that cannot fail (AGENTS.md §2).
  assert.notEqual(live.probe.appEdgeWallMs, behind.probe.appEdgeWallMs,
    'the injected app belief must genuinely differ between the two positions, '
    + 'or this test cannot fail');
  assert.equal(live.probe.appEdgeWallMs - behind.probe.appEdgeWallMs, 1800 * 1000,
    "the app's belief must move by exactly the playhead's 1800 s distance");
});

test('WS33 the reported offset equals (deviceNow - trueEdge)/1000, checkable by hand', () => {
  // The panel's number must be reconstructible from two raw clocks a reader
  // can see. If it is not, a reader cannot tell WHICH clock is wrong — which
  // was the reason for exposing both in the first place.
  //
  // A biased clock is used here on purpose: with a perfect clock the answer is
  // 0 and a sign error would be invisible.
  const NOW = 1_700_000_000_000;
  const TRUE_EDGE = NOW - 28_000;   // the stream's clock is 28 s BEHIND ours
  const h = ws33Sample(APP_JS, {
    nowMs: NOW, trueEdge: TRUE_EDGE, appEdge: NOW + 1234, // appEdge is irrelevant
  });
  assert.ok(h.canary.samples > 0, 'canary');
  // Device clock LATER than the stream's => the app believes it is ahead.
  assert.equal(h.probe.offsetS, 28, `expected +28 s, got ${h.probe.offsetS}`);
  assert.equal(h.probe.deviceNowMs, NOW, 'the device clock must be exposed');
  // Reconstructible by hand from the two exposed operands.
  assert.equal((h.probe.deviceNowMs - TRUE_EDGE) / 1000, h.probe.offsetS,
    'offsetS must be exactly (deviceNowMs - trueEdgeWallMs)/1000');
  // And it must NOT be reconstructible from the app's belief, because that
  // would mean the playhead is back in the comparison.
  assert.notEqual((h.probe.appEdgeWallMs - TRUE_EDGE) / 1000, h.probe.offsetS,
    'if the offset still matches (appEdge - trueEdge) the playhead is back in '
    + 'the comparison');
});

test('WS33 THE SEEK ERROR IS INDEPENDENT OF THE PLAYHEAD — the reading is valid anywhere', () => {
  // AC3. The brief asked for this claim to be CHECKED and the result reported
  // either way. It HOLDS, and that is what makes the corrected number useful:
  // one reading predicts the programme-skip error at any position on the
  // timeline, whereas the old panel was only valid at one.
  //
  // `seekToProgramTime` computes  target = end - (Date.now() - startMs)/1000.
  // The position that is CORRECT is  p = end - (T_end - startMs)/1000, where
  // T_end is the stream's own edge clock. Subtracting:
  //     target - p = -(Date.now() - T_end)/1000 = -offsetS_true
  // `end` appears on both sides and cancels, so the playhead is not involved.
  //
  // This is arithmetic over the app's own seek formula, transcribed once. It is
  // a property of the formula, and it is asserted rather than asserted-in-a-
  // comment because AGENTS.md §2: a claim nothing checks becomes folklore.
  const seekTarget = (end, nowMs, startMs) => end - (nowMs - startMs) / 1000;
  const correctPos = (end, trueEdgeMs, startMs) => end - (trueEdgeMs - startMs) / 1000;
  const NOW = 1_700_000_000_000;
  const END = 3_600_000;
  const TRUE_EDGE = NOW - 25_000;          // device clock 25 s AHEAD
  const offsetS_true = (NOW - TRUE_EDGE) / 1000;   // +25

  for (const [label, startMs] of [['now', NOW], ['30 min in', NOW - 1_800_000],
    ['2 h in', NOW - 7_200_000]]) {
    for (const currentTime of [END, END - 600, END - 1800]) {
      const err = seekTarget(END, NOW, startMs) - correctPos(END, TRUE_EDGE, startMs);
      assert.equal(err, -offsetS_true,
        `at ${label} the landing error must be -offsetS regardless of the `
        + `playhead (currentTime=${currentTime}); got ${err}`);
    }
  }
  // Stated so a reader knows the sign: the app lands 25 s EARLY relative to
  // the stream's own clock, i.e. it seeks too far forward.
  assert.equal(-offsetS_true, -25,
    'with a 25 s fast clock the app must overshoot by 25 s, at every position');
});

test('WS33 the playhead distance is shown SEPARATELY, under its own label', () => {
  // The decision the brief left open. `distanceFromLiveEdge` is real
  // information and is kept — but it must never be inside the clock sentence,
  // which is precisely how WS30/WS33's defect presented itself.
  const build = ws33ReadoutHarness(APP_JS, {
    offsetS: 5,
    distanceFromLiveEdge: 1800,
  });
  const r = build();
  assert.ok(build.canary.readoutCalls > 0, 'canary: the readout never ran');
  assert.equal(r.ok, true);
  // The PRIMARY sentence is the clock, and only the clock.
  assert.match(r.primary, /5 s/,
    `the primary line must state the clock offset (got: "${r.primary}")`);
  assert.ok(!/30 min/.test(r.primary),
    `the primary line must NOT carry the playhead distance — that is the WS33 `
    + `defect's shape (got: "${r.primary}")`);
  // The distance appears, separately and legibly, in the secondary line.
  assert.match(r.secondary || '', /30 min/,
    `the distance behind live must still be shown, under its own label `
    + `(got: "${r.secondary}")`);
});

// A small local harness so the test above does not depend on the other file's
// internals. It EXTRACTS `metaDiagReadoutLines` and `dvrOffsetLabel` from
// app.js — never a retyped copy (AGENTS.md §7).
function ws33ReadoutHarness(sourceText, { offsetS, distanceFromLiveEdge }) {
  const src = sourceText;
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`${name} must exist in app.js`);
    let d = 0, end = -1;
    for (let i = start; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error(`brace matching failed for ${name}`);
    return src.slice(start, end + 1);
  };
  const canary = { readoutCalls: 0, buildCalls: 0 };
  const readout = new Function('deps', `
    const { offsetS, distanceFromLiveEdge, canary } = deps;
    ${grab('dvrOffsetLabel')}
    function metaDiagBuildSnapshot() {
      canary.buildCalls += 1;
      return {
        playback: { current: { kind: 'live', id: 164 } },
        dvr: {
          streamEdge: { edgeMinusNowS: 27, selfReferential: true },
          twoSource: {
            status: 'ok',
            deviceNowMs: 1_700_000_000_000,
            trueEdgeWallMs: 1_700_000_000_000 - offsetS * 1000,
            appEdgeWallMs: 1_700_000_000_000,
            offsetS, sampleAgeS: 1.1, stale: false,
          },
          transportKind: 'hls-hlsjs',
          seek: { clampedByS: null },
          distanceFromLiveEdge,
        },
      };
    }
    ${grab('metaDiagReadoutLines')}
    return () => { canary.readoutCalls += 1; return metaDiagReadoutLines(); };
  `)({ offsetS, distanceFromLiveEdge, canary });
  readout.canary = canary;
  return readout;
}
