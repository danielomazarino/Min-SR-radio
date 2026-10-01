// WS41 — the metadata timebase investigation.
//
// The question these tests exist to answer is NOT "is the metadata correct".
// It is: "can the metadata's position be compared with the media position at
// all, and if the comparison disagrees, is that a metadata error or a
// disagreement between two different anchors?"
//
// So the tests assert the collector REPORTS both anchors and labels what each
// offset is a difference between. A test that asserted a particular offset
// value would encode a guess as a requirement — the mistake that cost WS25.

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

// The collector reads three collaborators. They are passed in, not reached
// for, so the function can be executed with a fixture and its output asserted.
function collector({ state, pickByPosition, playheadWallMs, nowMs }) {
  const api = new Function('state', 'pickByPosition', 'playheadWallMs',
    'Date', 'SR_API', `${grab('ws41MetadataFields')}
      return ws41MetadataFields;`);
  return api(state, pickByPosition, playheadWallMs,
    { now: () => nowMs }, 'https://api.sr.se/api/v2');
}

const PROGRAMME_START = Date.parse('2026-10-01T18:00:00.000Z');
const SEEKABLE_END = 9016.47;
const NOW = Date.parse('2026-10-01T19:10:16.000Z');

const baseState = () => ({
  current: {
    seekableEnd: SEEKABLE_END,
    seekableEndWrittenAtMs: NOW - 4000,
  },
});

// pickByPosition and playheadWallMs are the REAL productions, used as fixtures
// with the real arithmetic — not re-derived, because a re-derivation is how two
// workstreams reach different conclusions about the same code.
const realPick = (entries, atMs) => (Array.isArray(entries) && entries.length
  ? entries.find((e) => e.startMs <= atMs && atMs < e.stopMs) || null : null);
const realPlayhead = (state, currentTime) => {
  const end = state.current ? state.current.seekableEnd : null;
  if (!Number.isFinite(end)) return NOW;
  return NOW - (end - currentTime) * 1000;
};

test('the collector reports the poll source with its ABSOLUTE timestamps', () => {
  const timeline = [
    { title: 'Older', artist: 'X', startMs: PROGRAMME_START + 60000, stopMs: PROGRAMME_START + 120000 },
    { title: 'On Air', artist: 'Y', startMs: PROGRAMME_START + 120000, stopMs: PROGRAMME_START + 300000 },
  ];
  const onAir = { title: 'On Air', artist: 'Y', startMs: PROGRAMME_START + 120000, stopMs: PROGRAMME_START + 300000 };
  const diag = {
    lastTrackSource: 'playlists/rightnow',
    lastTrackEpisodeId: null,
    lastTrackCount: 3,
    lastTrackAt: NOW - 5000,
    lastTrackKeys: ['artist', 'starttimeutc', 'stoptimeutc', 'title'],
    lastTrackSample: { title: 'On Air', starttimeutc: '/Date(1790875200000)/' },
    lastTrackEpisodeStartMs: null,
  };
  const state = baseState();
  const out = collector({
    state,
    pickByPosition: realPick,
    playheadWallMs: () => realPlayhead(state, 600),
    nowMs: NOW,
  })(timeline, onAir, diag);

  assert.equal(out.metaSource, 'playlists/rightnow');
  assert.match(out.metaEndpoint, /playlists\/rightnow/);
  // The raw keys are echoed VERBATIM. This is the evidence that would reveal
  // an absolute timestamp if SR ever published one.
  assert.equal(out.metaTrackKeys, 'artist,starttimeutc,stoptimeutc,title');
  assert.equal(out.metaTrackCount, 3);
  assert.equal(out.onAirTitle, 'On Air');
  assert.equal(out.onAirArtist, 'Y');
  assert.equal(out.onAirStartMs, PROGRAMME_START + 120000);
  assert.ok(Number.isFinite(out.onAirOffsetS), 'an offset must be computed');
  // No programme anchor: the poll is not programme-relative.
  assert.equal(out.metaEpisodeStartMs, null);
});

test('the collector reports the SR-track source with its RELATIVE anchor', () => {
  // The decisive fixture: a track whose absolute position was built as
  // programmeStart + relativeStart. The collector must show the anchor, or
  // the entry is unrecoverable after the fact.
  const trackStart = PROGRAMME_START + 665000;
  const timeline = [{ title: 'Rolffa', artist: 'R', startMs: trackStart, stopMs: trackStart + 234000 }];
  const diag = {
    lastTrackSource: 'player/ondemand',
    lastTrackEpisodeId: 2874830,
    lastTrackCount: 1,
    lastTrackAt: NOW - 2000,
    // The REAL key set, measured live: no absolute timestamp anywhere.
    lastTrackKeys: ['artist', 'relativeEndTime', 'relativeStartTime', 'title'],
    lastTrackSample: {
      artist: 'Rolffa', title: 'Vi Glemmer Alt',
      relativeStartTime: '00:11:05', relativeEndTime: '00:14:59',
    },
    lastTrackEpisodeStartMs: PROGRAMME_START,
  };
  const state = baseState();
  const out = collector({
    state,
    pickByPosition: realPick,
    playheadWallMs: () => realPlayhead(state, 9016.47),
    nowMs: NOW,
  })(timeline, null, diag);

  assert.equal(out.metaSource, 'player/ondemand');
  assert.match(out.metaEndpoint, /player\/ondemand/);
  assert.equal(out.metaEpisodeId, 2874830);
  // THE finding, stated as an assertion: the payload carries relative times
  // only. If SR adds a real timestamp, this test goes red and says so.
  assert.equal(out.metaTrackKeys, 'artist,relativeEndTime,relativeStartTime,title');
  assert.ok(!/starttimeutc|stoptimeutc|startTime|endTime/.test(out.metaTrackKeys),
    'if an absolute time ever appears here, the timebase question must be reopened');
  assert.equal(out.metaEpisodeStartMs, PROGRAMME_START,
    'the programme anchor must be reported, because it is what the entry is built from');
  assert.equal(out.timelineSeekCount, 1, 'an entry at/after the anchor is a seek-path entry');
  assert.equal(out.timelinePollCount, 0);
});

test('the collector separates poll entries from programme-anchored entries', () => {
  // Both sources land in ONE list and are indistinguishable once merged. The
  // count is what makes the mixture visible at all.
  const diag = {
    lastTrackSource: 'player/ondemand',
    lastTrackEpisodeId: 1,
    lastTrackCount: 2,
    lastTrackAt: NOW,
    lastTrackKeys: ['artist', 'relativeEndTime', 'relativeStartTime', 'title'],
    lastTrackSample: {},
    lastTrackEpisodeStartMs: PROGRAMME_START,
  };
  const timeline = [
    // Before the programme anchor -> came from the absolute poll.
    { title: 'Pre', artist: 'A', startMs: PROGRAMME_START - 600000, stopMs: PROGRAMME_START - 300000 },
    // At/after it -> built from programme start + relative.
    { title: 'In', artist: 'B', startMs: PROGRAMME_START + 60000, stopMs: PROGRAMME_START + 120000 },
    { title: 'In2', artist: 'C', startMs: PROGRAMME_START + 120000, stopMs: PROGRAMME_START + 180000 },
  ];
  const state = baseState();
  const out = collector({
    state, pickByPosition: realPick,
    playheadWallMs: () => realPlayhead(state, 100),
    nowMs: NOW,
  })(timeline, null, diag);

  assert.equal(out.timelineCount, 3);
  assert.equal(out.timelinePollCount, 1);
  assert.equal(out.timelineSeekCount, 2);
});

test('the collector reports BOTH anchors and the age of the cached edge', () => {
  // The bridge from media seconds to wall clock uses a CACHED seekableEnd.
  // Its age decides whether any comparison against it is meaningful, so it is
  // reported rather than left implicit.
  const state = baseState();
  const out = collector({
    state, pickByPosition: realPick,
    playheadWallMs: () => realPlayhead(state, 10),
    nowMs: NOW,
  })([], null, { lastTrackSource: null });

  assert.equal(out.cachedSeekableEnd, SEEKABLE_END);
  assert.equal(out.seekableEndWrittenAtMs, NOW - 4000);
  assert.equal(out.seekableEndAgeMs, 4000, 'the cached edge age must be reported');
  assert.equal(out.playheadWallMs, realPlayhead(state, 10));
});

test('a disagreement between the two anchors is reported, not resolved', () => {
  // THE anti-tautology property. Feed a timeline entry that CONTAINS the
  // playhead but whose start is offset from it, and require the collector to
  // REPORT the gap while touching nothing. If this function ever "corrected"
  // the value, the discrepancy would vanish and be unfalsifiable.
  //
  // The fixture is built from `realPlayhead` FIRST, then the entry is placed
  // around it. Placing the entry on a guessed wall-clock time instead is how a
  // test ends up asserting on an entry that was never selected — the WS25
  // failure, and the reason this reads the playhead before choosing a value.
  const state = baseState();
  const pwMs = realPlayhead(state, 500);
  // The disagreement to be reported. Read off the fixture, not guessed: the
  // entry starts 1000 ms before the playhead, so the reported offset must be
  // +1.000 s. Asserting a number that does not follow from the fixture is how
  // a test ends up red for a reason that is not the defect.
  const entryStart = pwMs - 1000;            // entry contains the playhead...
  const timeline = [{ title: 'Off', artist: 'Z', startMs: entryStart, stopMs: entryStart + 60000 }];
  const out = collector({
    state, pickByPosition: realPick,
    playheadWallMs: () => pwMs,
    nowMs: NOW,
  })(timeline, null, {
    lastTrackSource: 'player/ondemand',
    lastTrackEpisodeStartMs: PROGRAMME_START,
  });

  // Sanity: the entry really was selected. Without this the offset could be
  // null and the test would pass for the wrong reason.
  assert.ok(out.timelineHitStartMs === entryStart,
    `the fixture must select its entry (got ${out.timelineHitStartMs}, wanted ${entryStart})`);
  assert.ok(Number.isFinite(out.timelineHitOffsetS), 'the gap must be a number');
  // Reported as a difference, and the entry is NOT moved to hide it.
  const expectedS = (pwMs - entryStart) / 1000;
  assert.ok(Math.abs(out.timelineHitOffsetS - expectedS) < 1e-6,
    'the reported offset must be exactly playheadWallMs - entryStart');
  assert.ok(Math.abs(out.timelineHitOffsetS * 1000 - (pwMs - entryStart)) < 1e-3,
    'the planted gap must survive unchanged — a correcting implementation would '
    + 'report ~0 here and pass a test that could not fail');
  assert.ok(out.timelineHitOffsetS > 0.9 && out.timelineHitOffsetS < 1.1,
    `the reported offset must be the planted +1.000 s, got ${out.timelineHitOffsetS}`);
});

test('GUARD: the collector computes no correction and reads no clock directly', () => {
  // It may call playheadWallMs (the app's own bridge) but must not read the
  // media element, must not write, and must not carry a fudge factor.
  const body = grab('ws41MetadataFields');
  assert.ok(!/audioEl/.test(body),
    'the collector must not read the media element — currentTime reaches it via playheadWallMs');
  assert.ok(!/\bstartMs\s*=[^=]/.test(body),
    'the collector must not assign a startMs');
  assert.ok(!/\+\s*\d{3,}/.test(body), 'no millisecond fudge factor may appear');
  assert.ok(!/seekableEnd\s*=[^=]/.test(body), 'it must not recompute the buffered edge');
  // And the snapshot must LABEL what the offsets are differences between, so
  // a reader cannot mistake a non-zero value for a proven defect.
  const snap = grab('ws40SnapshotText');
  assert.ok(/NOT proof of/.test(snap),
    'the snapshot must state that a non-zero offset is not proof of a metadata error');
  assert.ok(/PROGRAMME START/.test(snap) && /CACHED/.test(snap),
    'the snapshot must name both anchors');
});
// ===========================================================================
// The capture function ITSELF.
// ===========================================================================

test('the capture records the payload key names VERBATIM', () => {
  // A REAL gap, found by mutation W3: making the capture invent a key set
  // (`['absoluteStart','absoluteEnd','title']` instead of `Object.keys(track)`)
  // left the whole suite GREEN. Every other test stubs this function out, so
  // nothing executed the line that produces the evidence.
  //
  // That makes this the load-bearing assertion of the workstream: the payload
  // key set is the ONLY evidence that SR publishes no absolute timestamp. If
  // the capture can be replaced by a fabrication, that evidence is worthless —
  // and a fabricated key set is precisely the shape of a plausible lie.
  const api = new Function('META_DIAG', 'Date', `${grab('metaDiagTrackSource')}
    return metaDiagTrackSource;`);
  const rec = {};
  const fn = api(rec, { now: () => NOW });

  // The REAL payload shape, measured live from web-api.sr.se.
  const realTrack = {
    artist: 'Rolffa', title: 'Vi Glemmer Alt',
    relativeStartTime: '00:11:05', relativeEndTime: '00:14:59',
  };
  fn('player/ondemand', 2874830, [realTrack], PROGRAMME_START);

  assert.equal(rec.lastTrackSource, 'player/ondemand');
  assert.equal(rec.lastTrackEpisodeId, 2874830);
  assert.equal(rec.lastTrackCount, 1);
  assert.equal(rec.lastTrackAt, NOW);
  assert.equal(rec.lastTrackEpisodeStartMs, PROGRAMME_START);
  // VERBATIM: the real key names, with nothing added and nothing removed.
  // Compared as a SET, because JSON key order is not a property of the payload
  // — asserting the order would encode the order my hand-written fixture
  // happened to use and would break on a harmless server reordering.
  assert.deepEqual([...rec.lastTrackKeys].sort(),
    ['artist', 'relativeEndTime', 'relativeStartTime', 'title']);
  // And the one thing this investigation turns on: no absolute time field.
  assert.ok(!rec.lastTrackKeys.some((k) => /starttimeutc|stoptimeutc/i.test(k)),
    'the recorded payload must not contain an absolute SR time field');
  assert.ok(!rec.lastTrackKeys.some((k) => /^(startTime|endTime|programDateTime|PDT)$/.test(k)),
    'nor any absolute media-time field');
  assert.deepEqual(rec.lastTrackSample, realTrack,
    'the raw track must be retained verbatim, not summarised');

  // The counter-case, so this test can fail in both directions: a payload that
  // DOES carry an absolute time must be recorded as such, not filtered.
  const withAbs = { ...realTrack, startTimeUtc: '/Date(1790805600000)/' };
  fn('playlists/rightnow', null, [withAbs], null);
  assert.ok(rec.lastTrackKeys.includes('startTimeUtc'),
    'an absolute time must be recorded when the payload carries one');
});

test('GUARD: the capture is write-only and touches no playback state', () => {
  const body = grab('metaDiagTrackSource');
  for (const forbidden of [/\.currentTime\s*=[^=]/, /\.src\s*=[^=]/,
    /\.(play|pause|load)\s*\(/, /\bfetch\(/]) {
    assert.ok(!forbidden.test(body), `metaDiagTrackSource must not contain ${forbidden}`);
  }
  // It must not be called anywhere on a display or playback path: it records,
  // it does not influence.
  assert.ok(!/paintNowPlaying\s*\(\s*\)\s*;?\s*$/.test(body),
    'the capture must not repaint anything');
});

test('BOTH metadata sources are wired to the capture', () => {
  // The poll capture was silently NOT wired in the first draft of this
  // workstream: the edit reported success, nothing changed on disk, and
  // `fetchNowPlaying` came out byte-identical to the deployed build — which
  // read as "unchanged" rather than "my edit never landed".
  //
  // This asserts BOTH call sites exist, by function, so a dropped edit is a
  // red test rather than a silent omission found later on a device.
  const poll = grab('fetchNowPlaying');
  const seek = grab('resolveSeekTracksFromSr');
  assert.ok(/metaDiagTrackSource\(\s*'playlists\/rightnow'/.test(poll),
    'the 45 s poll (the ABSOLUTE-timebase source) must record itself');
  assert.ok(/metaDiagTrackSource\(\s*'player\/ondemand'/.test(seek),
    'the seek path (the RELATIVE-timebase source) must record itself');
  // The poll passes NO programme anchor, because it has none. If it ever
  // passes one, the "which entries came from where" count silently changes.
  assert.ok(!/metaDiagTrackSource\(\s*'playlists\/rightnow'[^;]*entry\.startMs/s.test(poll),
    'the poll must not claim a programme anchor it does not have');
  // And the seek capture must come AFTER the merge, so an empty result is not
  // recorded as if it had produced entries.
  assert.ok(seek.indexOf('mergeTimelineEntries(absolute)')
    < seek.indexOf("metaDiagTrackSource('player/ondemand'"),
  'the seek capture must follow the merge');
});
