// WS40c — the "Kopiera all diagnostik" button, EXECUTED.
//
// Kept in its own file on purpose. This is the only test in the workstream
// that runs `ws40CopyDiagnostics` for real, and it needs a different harness
// shape from the pure-function tests: every name the function touches has to
// arrive as a genuine parameter, or the test proves nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const APP_JS = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function grab(name) {
  const at = APP_JS.indexOf(`function ${name}(`);
  const asyncAt = APP_JS.indexOf(`async function ${name}(`);
  const start = at === -1 ? asyncAt : (asyncAt === -1 ? at : Math.min(at, asyncAt));
  if (start === -1) throw new Error(`${name} must exist in app.js`);
  let depth = 0;
  for (let i = start; i < APP_JS.length; i += 1) {
    if (APP_JS[i] === '{') depth += 1;
    else if (APP_JS[i] === '}') { depth -= 1; if (depth === 0) return APP_JS.slice(start, i + 1); }
  }
  throw new Error(`brace matching failed for ${name}`);
}

// Build the real function with an EXPLICIT, CLOSED list of names in scope.
// Anything the body reads that is not on this list is a genuine
// ReferenceError — which is exactly the defect this file guards.
function buildCopyFn(stubs) {
  const names = Object.keys(stubs);
  const values = names.map((n) => stubs[n]);
  const factory = new Function(...names, `
    ${grab('ws40CopyDiagnostics')}
    return ws40CopyDiagnostics;
  `);
  return factory(...values);
}

const REFUSING_ENV = {
  // A clipboard that refuses: the branch under test.
  navigator: { clipboard: null },
  Date: { now: () => 1790886304000 },
  Number: { isFinite: (n) => typeof n === 'number' && Number.isFinite(n) },
  Math,
  String,
  Object,
  Promise,
  JSON,
  TypeError,
  // `createRange` THROWS, so the selection step cannot silently succeed and
  // mask a failure in the line before it.
  document: {
    createRange: () => { throw new Error('no range in this test rig'); },
    getSelection: () => null,
  },
  window: { getSelection: () => null },
  setTimeout: () => 0,
  audioEl: {
    readyState: 4, networkState: 2, duration: NaN, paused: false,
    currentTime: 1, getStartDate: undefined,
  },
  state: { current: { title: 'P2', id: '163' } },
  APP_BUILD: 'testbuild',
  // Shaped like the real records, not `{}`. The copy path calls
  // `WS40.runs.slice()`, so a bare object fails on a method the real record
  // has — and a fixture that does not match the code's expectations would make
  // this test fail for the wrong reason.
  WS40: {
    runs: [],
    transport: 'native-hls',
    programmeTitle: 'Ekot',
    programmeStartMs: 1790886000000,
    seekableStartS: 0,
    seekableEndS: 2,
    mediaOriginMs: null,
    originSource: 'unavailable',
    originReason: 'test fixture: no Safari origin',
    headPdtMs: 1790886297600,
    playlistEdgeWallMs: 1790886304000,
    segmentMs: 6.4,
    playlistSampleAtMs: 1790886304000,
    playlistSampleAgeMs: 0,
    playlistOriginMs: null,
    originDeltaS: null,
    existingTargetS: 1,
    proposedTargetS: 1,
    targetDeltaS: 0,
  },
  // The copy path reads the stream-edge record for the playlist witness. It is
  // listed here because the harness is CLOSED: an unlisted name is a
  // ReferenceError, which is the property under test.
  STREAM_EDGE_PROBE: { sampledAtMs: 1790886304000 },
  SEEK_MEASURE: { startMs: 0, behindMs: 0, cachedSeekableEnd: 1,
    freshSeekableEnd: 1, rate: null },
  ws40Transport: () => 'native-hls',
  // WS41: the copy path now also collects metadata fields. Listed here because
  // the harness is CLOSED — an unlisted name is a ReferenceError, which is the
  // property under test. It returns the pure collector's shape.
  ws41CollectMetadata: () => ({
    metaSource: 'playlists/rightnow', metaEndpoint: 'stub', metaEpisodeId: null,
    metaTrackCount: 0, metaCapturedAtMs: null, metaTrackKeys: null,
    metaTrackSample: null, metaEpisodeStartMs: null,
    metaAnchorSource: 'stub', onAirTitle: null, onAirArtist: null,
    onAirStartMs: null, onAirStopMs: null, timelineCount: 0,
    timelinePollCount: 0, timelineSeekCount: 0, playheadWallMs: null,
    deviceNowMs: null, cachedSeekableEnd: null, seekableEndWrittenAtMs: null,
    seekableEndAgeMs: null, onAirOffsetS: null, timelineHitOffsetS: null,
    timelineHitTitle: null, timelineHitStartMs: null, timelineHitSource: null,
  }),
  // WS42: the backward-binding record. Listed for the same reason — the harness
  // is CLOSED, so an unlisted name is a ReferenceError rather than a silent
  // undefined. Observation only; it must not throw on the copy path.
  ws42CollectPrevBind: () => ({
    prevBindBound: null, prevBindBoundAgoMs: null, prevBindLiveEdgeWallMs: null,
    prevBindLiveEdgeWall: null, prevBindPosMs: null, prevBindPosWasEventStart: null,
    prevBindContainingTitle: null, prevBindContainingStartMs: null,
    prevBindSeekableEnd: null, prevBindSeekableEndWrittenAt: null,
    prevBindCurrentTime: null, prevBindScheduleLength: null,
    prevBindCapturedStartMs: null, prevBindCapturedTitle: null,
    prevLivePosMs: null, prevLiveContainingTitle: null,
    prevWouldSelectNowMs: null, prevWouldSelectNowTitle: null,
    prevBindingIsStale: null, prevSkippedCount: null,
    freshSeekableEndNow: null, cachedSeekableEndNow: null,
    freshMinusCachedNowMs: null, seekableEndAgeNowMs: null, currentTimeNow: null,
  }),
};

test('the clipboard FALLBACK path runs without a ReferenceError', async () => {
  // REGRESSION test for a real defect found by DRIVING THE BUTTON IN A
  // BROWSER, not by reading source. `ws40CopyDiagnostics` referenced
  // `ws40Box` — a `const` declared inside `openAbout()` — so the reference was
  // out of scope. The fallback is the branch that runs precisely when the
  // clipboard has already refused, so the owner would have lost the snapshot
  // AND seen an unexplained error, at the one moment they needed the text.
  //
  // Why this is executed rather than pattern-matched: a scope error is
  // invisible to source-shape analysis — every identifier looks declared at
  // the top level of the extracted body. Only calling the function can tell
  // whether a name resolves at run time. That is §7a.
  //
  // `ws40Box` is deliberately ABSENT from the environment above. If the body
  // still reaches for it, this is a ReferenceError and the test goes red.
  const calls = { snap: 0, toast: [] };
  const fn = buildCopyFn({
    ...REFUSING_ENV,
    ws40SnapshotText: (d) => { calls.snap += 1; return `SNAPSHOT ${d.appBuild}`; },
    showToast: (m) => calls.toast.push(m),
  });

  const boxNode = { textContent: '' };
  const labelNode = { textContent: 'Kopiera all diagnostik' };
  const button = {};

  const res = await fn(button, labelNode, boxNode);

  assert.equal(calls.snap, 1, 'the snapshot must be built exactly once');
  assert.equal(res.ok, false, 'a refused clipboard must report ok:false');
  assert.equal(res.text, 'SNAPSHOT testbuild',
    'the snapshot must still be returned to the caller');
  assert.equal(boxNode.textContent, 'SNAPSHOT testbuild',
    'the fallback must put the snapshot in the panel — this is the line that '
    + 'threw ReferenceError before the fix');
  assert.ok(calls.toast.length > 0,
    'the owner must be told the copy failed rather than left guessing');
});

test('a working clipboard takes the success path and leaves the panel alone', async () => {
  // The other branch. Without it, a change that inverted the success and
  // fallback paths would still pass the test above.
  const calls = { snap: 0, toast: [], written: null };
  const fn = buildCopyFn({
    ...REFUSING_ENV,
    navigator: {
      clipboard: {
        writeText: (t) => { calls.written = t; return Promise.resolve(); },
      },
    },
    ws40SnapshotText: (d) => { calls.snap += 1; return `SNAPSHOT ${d.appBuild}`; },
    showToast: (m) => calls.toast.push(m),
  });

  const boxNode = { textContent: '' };
  const labelNode = { textContent: 'Kopiera all diagnostik' };
  const res = await fn({}, labelNode, boxNode);

  assert.equal(res.ok, true, 'a working clipboard must report ok:true');
  assert.equal(calls.written, 'SNAPSHOT testbuild',
    'exactly the snapshot string must be written');
  assert.equal(calls.snap, 1, 'the snapshot must be built exactly once');
  assert.equal(boxNode.textContent, '',
    'the success path must NOT dump the text into the panel');
});

test('getStartDate() absence and a null return are reported differently', async () => {
  // An earlier live run reported `A: okänd källa: unavailable` and the cause
  // could not be told apart, because "the method does not exist" and "the
  // method returned nothing" were conflated. These are different faults and
  // the owner has to be able to tell them apart.
  const seen = [];
  const runWith = async (audioEl) => {
    const calls = { snap: 0, toast: [] };
    let captured = null;
    const fn = buildCopyFn({
      ...REFUSING_ENV,
      audioEl,
      ws40SnapshotText: (d) => { calls.snap += 1; captured = d; return 'S'; },
      showToast: (m) => calls.toast.push(m),
    });
    await fn({}, { textContent: '' }, { textContent: '' });
    seen.push(captured);
  };

  const base = { readyState: 4, networkState: 2, duration: NaN, paused: false,
    currentTime: 1 };
  await runWith({ ...base });                                  // no method at all
  await runWith({ ...base, getStartDate: () => null });         // method, null

  assert.equal(seen[0].hasGetStartDateFn, false,
    'an absent method must be reported as absent');
  assert.match(seen[0].startDateRaw, /method absent/,
    'an absent method must be described, not read');
  assert.equal(seen[1].hasGetStartDateFn, true,
    'a present method must be reported as present');
  assert.equal(seen[1].startDateRaw, 'null',
    'a null return must be reported as the literal null, not as absence');
  assert.notEqual(seen[0].startDateRaw, seen[1].startDateRaw,
    'the two faults must be distinguishable in the snapshot');
});

test('GUARD: the copy path changes no playback, seek or network state', () => {
  // Structural, because a call the function does not MAKE cannot be observed
  // by executing it. Read-only is a property of the source.
  const body = grab('ws40CopyDiagnostics');
  for (const forbidden of [/\.currentTime\s*=[^=]/, /\.src\s*=[^=]/,
    /\.(play|pause|load)\s*\(/, /\bfetch\(/, /setInterval/]) {
    assert.ok(!forbidden.test(body), `ws40CopyDiagnostics must not contain ${forbidden}`);
  }
  assert.ok(!/ws40ProposedTarget|ws40ExistingTarget|playlistOriginMs\s*=/.test(body),
    'the copy path must not compute a target or an origin');
  // ORDERING. Every live read of `audioEl` must happen BEFORE the first await.
  // If the string were assembled after the clipboard write, a seek landing in
  // between would change the text without anyone knowing — the snapshot would
  // describe a moment nobody was ever at. Asserted on STRUCTURE, because
  // source order IS the ordering in JavaScript.
  const firstAwait = body.search(/\bawait\b/);
  assert.ok(firstAwait !== -1, 'sanity: the copy path does contain an await');
  const after = [...body.matchAll(/audioEl\.[A-Za-z]+/g)]
    .map((m) => m.index)
    .filter((i) => i > firstAwait);
  assert.deepEqual(after, [],
    'no audioEl read may occur after the first await');
  assert.ok(body.indexOf('ws40SnapshotText(') < firstAwait,
    'the snapshot must be BUILT before the clipboard await, not just written after it');
  assert.ok(/await\s+navigator\.clipboard/.test(body),
    'the clipboard write must actually be awaited');
});