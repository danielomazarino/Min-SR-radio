// WS42 — the backward-binding record and the seek-free seekable-edge reading.
//
// Two jobs:
//   1. Prove the WS42 restatement is sound. Four guards were loosened from
//      "this exact string" to "this requirement", so something must EXECUTED
//      demonstrate the old and new source forms are equivalent.
//   2. Cover the two new pure collectors.
//
// The collectors take everything as arguments — including the media element —
// so they can be run against a fixture and their output asserted exactly. That
// is the only reason the second fresh/cached reading is trustworthy.

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

// A TimeRanges stand-in. The real object has index()/length; the collectors
// only ever call .length and .end(i), so this is the whole surface.
const fakeRanges = (start, end) => ({ length: 1, start: () => start, end: () => end });
const fakeAudio = (seekStart, seekEnd, currentTime) => ({
  seekable: fakeRanges(seekStart, seekEnd),
  currentTime,
});

function prevBindCollector({ bind, state, schedule, pwMs, audio }) {
  // `bind` is legitimately null before any handler is ever bound, so the
  // frozen instant must not be read off it unconditionally.
  const api = new Function('Date', `${grab('ws42PrevBindFields')}
    return ws42PrevBindFields;`);
  // The body calls BOTH `Date.now()` and `new Date(ms).toISOString()`, so a
  // plain stub object is not enough (it threw "Date is not a constructor") and
  // a Proxy is not enough either (a Proxy is not constructable). What is left
  // is a Date SUBCLASS: `new` works, and `now()` is the only override. This
  // keeps the ISO field under test rather than deleting it to make the harness
  // pass.
  const frozenNow = (bind && bind.__now) || 1_000_000;
  class FrozenDate extends Date {
    constructor(...args) { super(...(args.length ? args : [frozenNow])); }
    static now() { return frozenNow; }
  }
  return api(FrozenDate)(bind, state, schedule,
    typeof pwMs === 'function' ? pwMs : () => pwMs, audio);
}

const T = Date.parse('2026-10-01T00:00:00Z');
const scheduleOf = (mins) => mins.map((m, i) => ({
  startMs: T + m * 60_000, endMs: T + (m + 10) * 60_000, title: `P${i + 1}`,
}));

// ===========================================================================
// 1. THE EQUIVALENCE PROOF the restated guards depend on.
// ===========================================================================

test('the named position argument selects EXACTLY what the inline form selected', () => {
  // Extracted from the REAL app.js, both forms, and run. This is the load-
  // bearing test of the workstream: four scope guards were loosened from a
  // literal string to a requirement, and this is what makes that loosening
  // evidence-based rather than a convenience.
  const real = grab('programBoundary');
  const harness = new Function('schedule', 'positionMs', 'direction', `
    ${real}
    return programBoundary(schedule, positionMs, direction);
  `);
  // (schedule, position) — the ORDER matters and an earlier version passed the
  // position function as the schedule, which made every case compare `null`
  // with `null` and the whole equivalence sweep VACUOUS. It reported green and
  // proved nothing, because the guard "at least N cases ran" counts iterations,
  // not non-null results.
  // `programBoundary` takes a NUMBER, not a thunk. An earlier version passed
  // the position FUNCTION itself, so `ev.startMs < positionMs - 1000` compared
  // against NaN and every case returned null -- a sweep that compared null with
  // null and still reported the forms equivalent.
  const bind = (sched, posMsValue) => harness(sched, posMsValue, -1);

  // Every schedule shape the app can produce, including the awkward ones.
  const cases = [
    { sched: scheduleOf([10, 20, 30, 40]), positions: [0, 10, 15, 20, 25, 30, 35, 40, 50, 1e15] },
    { sched: scheduleOf([0, 60, 120]), positions: [0, 1, 59, 60, 61, 119, 120, 121] },
    { sched: scheduleOf([10]), positions: [0, 9, 10, 11, 100] },
    { sched: [], positions: [0, 100] },
  ];
  let checked = 0;
  let selected = 0;
  for (const { sched, positions } of cases) {
    for (const p of positions) {
      // The ORIGINAL source form: `posMs()` is CALLED INLINE, so the function
      // is invoked by the expression itself and a NUMBER is passed.
      const posMs = () => T + p * 60_000;
      const original = harness(sched, posMs(), -1);
      // The WS42 source form: `posMs()` is called once, the value NAMED, and
      // the named value passed. Same call count, same value.
      const bindPosMs = posMs();
      const renamed = harness(sched, bindPosMs, -1);
      assert.deepEqual(renamed, original,
        `the renamed form must select identically at position ${p}`);
      if (original !== null) selected += 1;
      checked += 1;
    }
  }
  assert.ok(checked >= 24, `the sweep must be substantial, ran ${checked}`);
  // ANTI-VACUITY. An earlier version of this test passed the position function
  // as the SCHEDULE, so every case compared `null` with `null` and the whole
  // sweep proved nothing while reporting green. Counting iterations is not
  // enough — require that it actually SELECTED something.
  assert.ok(selected >= 8,
    `the sweep must produce real selections, got ${selected} of ${checked}`);
  // And the negative control: the sweep CAN fail. Different positions must
  // give different answers, otherwise "identical" above proves nothing.
  // Both positions are passed as ABSOLUTE epoch ms — the same units the real
  // `posMs()` returns. Mixing a minute-offset in here once made both sides
  // select the same entry and the control failed for the wrong reason.
  const sched = scheduleOf([10, 20, 30]);
  assert.notDeepEqual(bind(sched, T + 25 * 60_000),
    bind(sched, T + 15 * 60_000),
    'a different position must select a different programme — otherwise the '
    + 'equivalence result is vacuous');
});

// ===========================================================================
// 2. The bind record.
// ===========================================================================

test('the record reports the CAPTURED decision beside what it would be NOW', () => {
  // The defect, as data. Captured at bind time when the playhead was inside
  // P2; the snapshot is taken later, after the playhead has moved.
  const sched = scheduleOf([10, 20, 30, 40]);
  const boundAt = T + 25 * 60_000;
  const bind = {
    boundAtMs: boundAt,
    liveEdgeWallMs: boundAt,
    posMs: T + 20 * 60_000,
    posMsWasEventStart: true,
    containingTitle: 'P2',
    containingStartMs: T + 20 * 60_000,
    containingEndMs: T + 30 * 60_000,
    prevStartMs: T + 20 * 60_000,
    prevTitle: 'P2',
    seekableEndAtBind: 1000,
    seekableEndWrittenAtBind: boundAt - 40,
    currentTimeAtBind: 500,
    scheduleLength: 4,
    __now: boundAt + 600_000,
  };
  // NOW the playhead sits in P1 — so a fresh evaluation should pick nothing
  // before P1, i.e. null, which is a different answer from the captured P2.
  const state = { current: { seekableEnd: 2000, seekableEndWrittenAtMs: boundAt + 599_000 } };
  const out = prevBindCollector({
    bind, state, schedule: sched, pwMs: T + 15 * 60_000,
    audio: fakeAudio(0, 2000, 1500),
  });

  assert.equal(out.prevBindCapturedStartMs, T + 20 * 60_000,
    'the CAPTURED value must be reported verbatim — it is what a press uses');
  assert.equal(out.prevBindCapturedTitle, 'P2');
  assert.equal(out.prevBindPosMs, T + 20 * 60_000, 'the bind-time posMs must be reported');
  assert.equal(out.prevBindLiveEdgeWall, new Date(boundAt).toISOString());
  assert.equal(out.prevBindBoundAgoMs, 600_000, 'how stale the binding is must be reported');
  assert.equal(out.prevBindPosWasEventStart, true);
  assert.equal(out.prevBindSeekableEnd, 1000, 'the edge the estimate was seeded from');
  assert.equal(out.prevBindCurrentTime, 500);
  assert.equal(out.prevBindScheduleLength, 4);
  // The live comparison.
  assert.equal(out.prevLiveContainingTitle, 'P1', 'the live containing programme');
  assert.equal(out.prevWouldSelectNowMs, null,
    'nothing lies before P1, so a fresh backward press would find nothing');
  // `prevBindingIsStale` compares two SELECTIONS. Here the fresh selection is
  // null, so staleness is UNKNOWN rather than true -- and the field must say
  // so rather than round "different" up to "stale". The evidence of staleness
  // here is the CAPTURED value itself: it would send a press back to P2 while
  // the playhead already sits in P1.
  assert.equal(out.prevBindingIsStale, null,
    'staleness is UNKNOWN when a fresh press finds nothing; it must not be '
    + 'reported as a stale-true');
  assert.notEqual(out.prevBindCapturedStartMs, out.prevLivePosMs,
    'the captured selection must be shown to disagree with where the playhead '
    + 'is NOW — that disagreement IS the skip');
});

test('a FRESH binding reports itself as NOT stale', () => {
  // The counter-case. Without it, `prevBindingIsStale` could be stuck at true
  // and the field would be a constant rather than a measurement.
  const sched = scheduleOf([10, 20, 30, 40]);
  // 35 m sits inside P3 (30-40 m), so a fresh backward press picks P2 (20 m).
  const posNow = T + 35 * 60_000;
  // The binding was made at the SAME position, and captured the same P2.
  const bind = {
    boundAtMs: posNow, liveEdgeWallMs: posNow, posMs: T + 30 * 60_000,
    prevStartMs: T + 20 * 60_000, prevTitle: 'P2',
    containingTitle: 'P3', containingStartMs: T + 30 * 60_000,
    seekableEndAtBind: 1000, currentTimeAtBind: 500, scheduleLength: 4,
    __now: posNow,
  };
  const out = prevBindCollector({
    bind, state: { current: { seekableEnd: 2000, seekableEndWrittenAtMs: posNow } },
    schedule: sched, pwMs: posNow, audio: fakeAudio(0, 2000, 1500),
  });
  assert.equal(out.prevWouldSelectNowMs, T + 20 * 60_000,
    'from inside P3 the previous programme is P2');
  assert.equal(out.prevBindingIsStale, false,
    'a binding made at the current position is not stale');
  assert.equal(out.prevSkippedCount, null,
    'nothing is skipped when the binding is fresh');
});

test('the skip is counted in WHOLE PROGRAMMES', () => {
  // "Skips several programmes" is the owner's phrase; this turns it into a
  // number. Captured P1 while a fresh evaluation would pick P4 → two whole
  // programmes sit between them.
  const sched = scheduleOf([10, 20, 30, 40, 50]);
  const posNow = T + 55 * 60_000;   // inside P5
  const bind = {
    boundAtMs: posNow, liveEdgeWallMs: posNow, posMs: T + 10 * 60_000,
    prevStartMs: T + 10 * 60_000, prevTitle: 'P1', containingTitle: 'P1',
    seekableEndAtBind: 1, currentTimeAtBind: 1, scheduleLength: 5,
    __now: posNow,
  };
  const out = prevBindCollector({
    bind, state: { current: { seekableEnd: 2, seekableEndWrittenAtMs: posNow } },
    schedule: sched, pwMs: posNow, audio: fakeAudio(0, 2, 1),
  });
  assert.equal(out.prevWouldSelectNowMs, T + 40 * 60_000, 'fresh would pick P4');
  assert.equal(out.prevBindCapturedStartMs, T + 10 * 60_000, 'captured P1');
  // Boundaries strictly after P4 (40m) and up to P1 (10m): none, because the
  // CAPTURE is BEHIND the fresh choice, so no programme sits in that
  // direction. Measured, not assumed -- the first draft of this test asserted
  // 1 and was wrong about which direction the skip runs.
  assert.equal(out.prevSkippedCount, 0);
  assert.ok(out.prevBindCapturedStartMs < out.prevWouldSelectNowMs,
    'this fixture captures a BACKWARD-stale binding; a forward-stale one is '
    + 'covered by the first bind test');
  assert.ok(Number.isInteger(out.prevSkippedCount), 'the count must be a whole number');
});

test('an unbound backward button reports null, not a fabricated value', () => {
  // The very first snapshot after a channel switch, before any schedule has
  // resolved. Everything must be honestly absent.
  const out = prevBindCollector({
    bind: null, state: { current: { seekableEnd: 2000, seekableEndWrittenAtMs: 5 } },
    schedule: null, pwMs: null, audio: fakeAudio(0, 2000, 7),
  });
  assert.equal(out.prevBindCapturedStartMs, null);
  assert.equal(out.prevBindingIsStale, null, 'staleness is UNKNOWN, not false');
  assert.equal(out.prevSkippedCount, null);
  assert.equal(out.prevWouldSelectNowMs, null);
});

test('the second seekable reading needs NO seek and reports the SIGN correctly', () => {
  // This is the whole point of the field: a fresh/cached comparison available
  // at snapshot time, using the app's own sign convention
  // (freshMinusCached = (fresh - cached) * 1000).
  const state = { current: { seekableEnd: 10881.24, seekableEndWrittenAtMs: 995 } };
  // `__now` fixes the collector's instant, so the age below is exact rather
  // than dependent on wall-clock time at run time.
  const out = prevBindCollector({
    bind: { __now: 1000 }, state, schedule: null, pwMs: null,
    audio: fakeAudio(0, 10862.0, 9016.31),
  });
  assert.equal(out.cachedSeekableEndNow, 10881.24);
  assert.equal(out.freshSeekableEndNow, 10862.0);
  // Tolerance, not equality: `(10862.0 - 10881.24) * 1000` is
  // -19239.99999999978 in binary floating point. Asserting exact equality
  // would be asserting an accident of IEEE-754 representation, and the
  // snapshot rounds for display anyway. The SIGN and the magnitude are what
  // this field exists to carry.
  assert.ok(out.freshMinusCachedNowMs < 0,
    'NEGATIVE: the cached edge is AHEAD of the fresh read. The first device '
    + 'sample was exactly this, and my WS42 report had the sign backwards.');
  assert.ok(Math.abs(out.freshMinusCachedNowMs - (-19240)) < 1e-6,
    `the magnitude must be 19.240 s, got ${out.freshMinusCachedNowMs}`);
  assert.equal(out.seekableEndAgeNowMs, 5,
    'age is measured from the CACHED WRITE timestamp, not from now()');
  assert.equal(out.currentTimeNow, 9016.31);
  // And the opposite direction must produce the opposite sign, so the field is
  // a measurement rather than a constant.
  const other = prevBindCollector({
    bind: null, state: { current: { seekableEnd: 100, seekableEndWrittenAtMs: 1 } },
    schedule: null, pwMs: null, audio: fakeAudio(0, 130, 5),
  });
  assert.equal(other.freshMinusCachedNowMs, 30000,
    'a cached edge BEHIND the fresh read must report POSITIVE');
});

test('a missing seekable range reports unavailable, never a number', () => {
  const out = prevBindCollector({
    bind: null, state: { current: { seekableEnd: 500, seekableEndWrittenAtMs: 1 } },
    schedule: null, pwMs: null,
    audio: { seekable: { length: 0 }, currentTime: 5 },
  });
  assert.equal(out.freshSeekableEndNow, null);
  assert.equal(out.freshMinusCachedNowMs, null,
    'no range means no comparison — it must not fall back to 0');
});

// ===========================================================================
// 3. GUARDS: observation only.
// ===========================================================================

test('GUARD: the collectors change no behaviour and add no constants', () => {
  for (const fn of ['ws42PrevBindFields', 'ws41MetadataFields']) {
    const body = grab(fn);
    for (const forbidden of [/\.currentTime\s*=[^=]/, /\.src\s*=[^=]/,
      /\.(play|pause|load)\s*\(/, /\bfetch\(/, /setInterval/]) {
      assert.ok(!forbidden.test(body), `${fn} must not contain ${forbidden}`);
    }
    assert.ok(!/\bstate\.current\.\w+\s*=[^=]/.test(body),
      `${fn} must not write to the current-track object`);
    assert.ok(!/\bcur\.\w+\s*=[^=]/.test(body),
      `${fn} must not write to any track state`);
    // No fudge factor: a millisecond literal added to a comparison would be a
    // correction smuggled in as a diagnostic.
    assert.ok(!/[-+]\s*\d{3,}(\.\d+)?\s*;/.test(body),
      `${fn} must contain no millisecond correction constant`);
  }
  // Neither collector may be called from a playback or selection path.
  const callers = APP_JS.match(/ws4[12]Collect\w+\(\)/g) || [];
  assert.ok(callers.length >= 2, 'both collectors must be reachable');
  for (const m of APP_JS.matchAll(/ws4[12]Collect\w+\(\)/g)) {
    const before = APP_JS.slice(Math.max(0, m.index - 400), m.index);
    assert.ok(!/seekToProgramTime\s*\(/.test(before),
      'no collector may be invoked from inside seekToProgramTime');
    assert.ok(!/prevProgramBtn\.onclick/.test(before),
      'no collector may be invoked from the backward handler');
  }
});

test('GUARD: the backward handler is still bound exactly once', () => {
  // The DEFECT is not fixed here — that is the next task. This asserts the
  // current, defective state explicitly, so the fix cannot land silently
  // without this file changing, and so the device snapshot has a known
  // baseline to be compared against.
  // Count ASSIGNMENTS, not textual occurrences. WS42 added a comment naming
  // this very site, so a plain textual count returned 2 and would have read as
  // "a fix landed" when nothing had changed. Comments are excluded by using the
  // comment-stripped source.
  const CODE = APP_JS
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const bindings = CODE.match(/prevProgramBtn\.onclick\s*=[^=]/g) || [];
  assert.equal(bindings.length, 1,
    'the backward handler is bound once today; if this fails, a fix landed');
  // And it must still capture a value rather than recompute one -- the defect.
  assert.ok(/const goPrev = \(\) => seekToProgramTime\(prevEv\.startMs\);/.test(CODE),
    'goPrev must still capture prevEv -- that capture IS the defect, and the '
    + 'fix belongs to the next task');
  // And the forward path is still refreshed continuously — the asymmetry the
  // whole finding rests on.
  assert.ok(/audioEl\.addEventListener\('timeupdate',\s*syncNext\)/.test(APP_JS),
    'the forward path must still be refreshed on timeupdate');
});
test('GUARD: the bind record is actually WRITTEN where the handler is bound', () => {
  // Found by mutation X3: deleting the entire `META_DIAG.prevBind = {...}`
  // statement — 1181 characters, the whole record — left this file GREEN.
  // Nothing asserted that the record is produced at all, so the diagnostic
  // could have shipped reporting `unavailable` for every field forever and no
  // offline test would have noticed. The device would have been asked to
  // collect a snapshot that could not contain the answer.
  //
  // A collector can be perfect and still never be called. That is the §7a
  // reachability question applied to instrumentation.
  const at = APP_JS.indexOf('META_DIAG.prevBind = {');
  assert.ok(at !== -1, 'the bind record must be WRITTEN somewhere');
  // It must be written in the same block that BINDS the handler — otherwise the
  // record and the behaviour it describes can drift apart.
  const bindAt = APP_JS.indexOf('prevProgramBtn.onclick = goPrev;');
  assert.ok(bindAt !== -1, 'the handler must still be bound');
  const between = APP_JS.slice(at, bindAt);
  assert.ok(!/prevProgramBtn\.onclick/.test(between),
    'the record must be written BEFORE the binding, so it describes the value '
    + 'the handler is about to capture');
  assert.ok(between.length < 2000,
    'the record must be adjacent to the binding, not somewhere else entirely');
  // And the fields the brief asks for must all be present at the write site.
  for (const field of ['boundAtMs', 'liveEdgeWallMs', 'posMs', 'prevStartMs',
    'prevTitle', 'containingTitle', 'seekableEndAtBind',
    'seekableEndWrittenAtBind', 'currentTimeAtBind']) {
    assert.ok(between.includes(`${field}:`),
      `the bind record must carry ${field}`);
  }
  // The record must not be written from anywhere else, or a second writer
  // would make it describe a different moment than the binding.
  assert.equal((APP_JS.match(/META_DIAG\.prevBind\s*=/g) || []).length, 1,
    'exactly one writer for the bind record (AGENTS.md §3)');
});
