import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_RAW = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const APP = stripComments(APP_RAW);

// ---------------------------------------------------------------------------
// WS83 — remembered stop locations, ask-first resume.
//
// OWNER, 2026-11-03: "when a play of a program or podcast is stopped, look for
// a solution where this timestamp is remembered for future restart as the stop
// location." Decisions: ASK before resuming; scope = SR podcasts, iTunes
// podcasts, schedule episodes; live radio and news excluded.
//
// These tests assert BEHAVIOUR (AGENTS.md §2): the real functions are
// extracted from app.js by brace matching and executed against a driven
// world. Nothing here re-implements the logic under test.
// ---------------------------------------------------------------------------

function grab(name, src = APP) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in app.js`);
  let d = 0, end = start;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}

// A factory that builds a world with the real store functions plus the
// caller-visible surface they need (state, audioEl, localStorage stub).
function makeWorld({ now = 1_700_000_000_000 } = {}) {
  const storage = new Map();
  const localStorageStub = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
  };
  const state = { current: null };
  const audioEl = { currentTime: 0, duration: NaN };
  const logs = [];
  const factory = new Function('deps', `
    const { localStorage, state, audioEl, diagLog } = deps;
    const _RealDate = Date;
    function Date(...a) { return a.length ? new _RealDate(...a) : new _RealDate(${now}); }
    Date.now = () => ${now};
    Date.prototype = _RealDate.prototype;
    ${grab('safeStr', APP_RAW).replace(/^  /gm, '')}
    const PLAYBACK_POSITIONS_KEY = 'minradio.playback-positions.v1';
    const RESUME_MIN_INTO_S = 30;
    const RESUME_MIN_REMAINING_S = 30;
    const POSITIONS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const POSITIONS_CAP = 50;
    ${grab('loadPlaybackPositions').replace(/^  /gm, '')}
    ${grab('savePlaybackPositions').replace(/^  /gm, '')}
    ${grab('playbackPositionKey').replace(/^  /gm, '')}
    ${grab('savePlaybackPosition').replace(/^  /gm, '')}
    ${grab('savedResumePosition').replace(/^  /gm, '')}
    ${grab('clearPlaybackPosition').replace(/^  /gm, '')}
    return { loadPlaybackPositions, savePlaybackPosition, savedResumePosition,
      clearPlaybackPosition, playbackPositionKey, raw: () => localStorage.getItem('minradio.playback-positions.v1') };
  `);
  const world = factory({ localStorage: localStorageStub, state, audioEl, diagLog: (m) => logs.push(m) });
  return { state, audioEl, storage, logs, ...world };
}

test('WS83: a stopped episode is remembered at its playhead', () => {
  const w = makeWorld();
  w.state.current = { kind: 'episode', id: 12345, title: 'P3 Dokumentär' };
  w.audioEl.currentTime = 734.2;
  w.audioEl.duration = 3600;
  const saved = w.savePlaybackPosition();
  assert.ok(saved, 'the save must happen');
  assert.equal(saved.positionS, 734, 'the saved position is the playhead');
  assert.equal(saved.durationS, 3600, 'the duration is saved with it');
  assert.equal(saved.title, 'P3 Dokumentär', 'the title is saved for the prompt text');
  const raw = JSON.parse(w.raw());
  assert.ok(raw['sr:12345'], 'the entry is keyed sr:<episodeId>');
});

test('WS83: replaying a stopped episode OFFERS the saved position (ask-first)', () => {
  const w = makeWorld();
  w.state.current = { kind: 'episode', id: 12345, title: 'P3 Dokumentär' };
  w.audioEl.currentTime = 734;
  w.audioEl.duration = 3600;
  w.savePlaybackPosition();
  // The owner taps the episode again in a fresh session: state.current is
  // null (the player was closed), audioEl is fresh.
  w.state.current = null;
  w.audioEl.currentTime = 0;
  const offer = w.savedResumePosition('sr', 12345, 3600);
  assert.ok(offer, 'a meaningful saved position must be OFFERED, not applied silently');
  assert.equal(offer.positionS, 734, 'the offer carries the stop location');
});

test('WS83: a near-start position is not offered (starting over IS resuming)', () => {
  const w = makeWorld();
  w.state.current = { kind: 'episode', id: 12345 };
  w.audioEl.currentTime = 10; // below RESUME_MIN_INTO_S
  w.audioEl.duration = 3600;
  w.savePlaybackPosition();
  w.state.current = null;
  assert.equal(w.savedResumePosition('sr', 12345, 3600), null,
    'a 10 s position must not trigger the prompt');
});

test('WS83: a near-end position is treated as finished and FORGOTTEN', () => {
  const w = makeWorld();
  w.state.current = { kind: 'episode', id: 12345 };
  w.audioEl.currentTime = 3590; // 10 s remaining, below RESUME_MIN_REMAINING_S
  w.audioEl.duration = 3600;
  w.savePlaybackPosition();
  w.state.current = null;
  assert.equal(w.savedResumePosition('sr', 12345, 3600), null,
    'a nearly-finished episode must not prompt');
  const raw = JSON.parse(w.raw());
  assert.ok(!raw['sr:12345'], 'the finished entry is deleted so the next play starts clean');
});

test('WS83: news broadcasts are never saved and never offered', () => {
  const w = makeWorld();
  // News plays as { kind:'episode', id:-1, isNewsBroadcast:true }.
  w.state.current = { kind: 'episode', id: -1, isNewsBroadcast: true, title: 'Ekot' };
  w.audioEl.currentTime = 120;
  w.audioEl.duration = 300;
  assert.equal(w.savePlaybackPosition(), null, 'news must not create a saved position');
  assert.equal(w.raw(), null, 'the store stays empty for news');
  assert.equal(w.savedResumePosition('sr', -1, 300), null, 'news ids can never resolve');
});

test('WS83: live radio is never saved', () => {
  const w = makeWorld();
  w.state.current = { kind: 'live', id: 164, title: 'P3' };
  w.audioEl.currentTime = 500;
  assert.equal(w.savePlaybackPosition(), null, 'live has no stop location to remember');
  assert.equal(w.raw(), null);
});

test('WS83: an iTunes episode is namespaced so ids can never collide with SR', () => {
  const w = makeWorld();
  w.state.current = { kind: 'episode', id: 251955878, provider: 'itunes', title: 'Lex' };
  w.audioEl.currentTime = 600;
  w.audioEl.duration = 4000;
  w.savePlaybackPosition();
  const raw = JSON.parse(w.raw());
  assert.ok(raw['itunes:251955878'], 'the iTunes entry is keyed itunes:<id>');
  assert.ok(!raw['sr:251955878'], 'no bare SR key may exist for the same number');
  // And an SR episode with the same numeric id resolves to nothing.
  w.state.current = null;
  assert.equal(w.savedResumePosition('sr', 251955878, 4000), null,
    'an SR id must never read an iTunes entry');
});

test('WS83: a second episode does not inherit the first one\'s position', () => {
  const w = makeWorld();
  w.state.current = { kind: 'episode', id: 111 };
  w.audioEl.currentTime = 500;
  w.audioEl.duration = 2000;
  w.savePlaybackPosition();
  w.state.current = null;
  assert.equal(w.savedResumePosition('sr', 222, 2000), null,
    'episode 222 must not see episode 111\'s position');
});

test('WS83: the duration falls back to the track\'s declared duration', () => {
  // audioEl.duration is NaN until metadata loads; a save that happens before
  // that (pause during buffering) must still record the declared duration,
  // or the near-end rule cannot run on the next play.
  const w = makeWorld();
  w.state.current = { kind: 'episode', id: 12345, duration: 3600 };
  w.audioEl.currentTime = 600;
  w.audioEl.duration = NaN;
  const saved = w.savePlaybackPosition();
  assert.equal(saved.durationS, 3600, 'the declared duration must be saved when the element has none');
  w.state.current = null;
  assert.ok(w.savedResumePosition('sr', 12345, null),
    'the offer must work from the saved duration alone');
});

test('WS83: entries expire after ~30 days', () => {
  const w = makeWorld({ now: 1_700_000_000_000 });
  w.state.current = { kind: 'episode', id: 12345 };
  w.audioEl.currentTime = 600;
  w.audioEl.duration = 3600;
  w.savePlaybackPosition();
  // 31 days later.
  const later = makeWorld({ now: 1_700_000_000_000 + 31 * 24 * 3600 * 1000 });
  // Same storage contents, new clock: copy the raw payload across.
  later.storage.set('minradio.playback-positions.v1', w.raw());
  assert.equal(later.savedResumePosition('sr', 12345, 3600), null,
    'a month-old position must not be offered');
});

test('WS83: the store is capped so it can never grow unbounded', () => {
  const w = makeWorld();
  for (let i = 1; i <= 60; i++) {
    w.state.current = { kind: 'episode', id: i };
    w.audioEl.currentTime = 100 + i;
    w.audioEl.duration = 1000;
    w.savePlaybackPosition();
  }
  const raw = JSON.parse(w.raw());
  const count = Object.keys(raw).length;
  assert.ok(count <= 50, `the store must stay within the cap (got ${count})`);
  assert.ok(raw['sr:60'], 'the most recent entry survives the cap');
  assert.ok(!raw['sr:1'], 'the oldest entry is evicted');
});

test('WS83: corrupted storage behaves as "nothing saved" and never throws', () => {
  const w = makeWorld();
  w.storage.set('minradio.playback-positions.v1', '{not json');
  assert.deepEqual(w.loadPlaybackPositions(), {}, 'corrupt JSON reads as empty');
  // And a save over it recovers the store.
  w.state.current = { kind: 'episode', id: 7 };
  w.audioEl.currentTime = 200;
  w.audioEl.duration = 1000;
  assert.ok(w.savePlaybackPosition(), 'saving after corruption must work');
});

// ---------------------------------------------------------------------------
// The gate and the sheet: the ask-first decision, asserted on the CODE the
// owner's tap actually runs. These are shape assertions on the gate/sheet
// because the DOM sheet cannot run headless; the behaviour above is driven.
// ---------------------------------------------------------------------------

test('WS83: the playTrack gate asks BEFORE playback and never auto-resumes', () => {
  // The gate must sit at the very top of playTrack, before any state mutation.
  const gateStart = APP.indexOf('function playTrack(');
  const gateEnd = APP.indexOf('stopEpisodeTracks()', gateStart);
  const head = APP.slice(gateStart, gateEnd);
  assert.match(head, /__resumeDecided/, 'the gate must read the decided flag');
  assert.match(head, /savedResumePosition/, 'the gate must consult the saved position');
  assert.match(head, /isNewsBroadcast/, 'news must be excluded at the gate');
  assert.match(head, /isCurrent\(track\.kind, track\.id\)/,
    'tapping the PAUSED current episode must continue in place, not re-ask');
  assert.match(head, /openResumeSheet/, 'a hit must open the choice sheet');
  assert.match(head, /return;/, 'a hit must return BEFORE any playback state changes');
  // The gate must sit BEFORE the first state mutation in playTrack: the
  // position of the gate text must precede `state.current = track`.
  const gateSheetIdx = head.indexOf('openResumeSheet');
  const stateAssign = head.indexOf('state.current = track');
  assert.ok(stateAssign === -1 || gateSheetIdx < stateAssign,
    'the gate must complete before playTrack mutates any player state');
  assert.match(head, /return;/, 'a hit must return BEFORE any playback state changes');
  // The sheet's resume choice must carry the position for the seek, and both
  // choices must mark the decision so the gate lets them through exactly once.
  const sheet = grab('openResumeSheet');
  assert.match(sheet, /__resumeFromS = entry\.positionS/, 'resume must carry the stop location');
  assert.match(sheet, /__resumeDecided = true/, 'both choices must mark the decision');
  assert.match(sheet, /Börja om/, 'the start-over choice must exist (ask-first, not auto)');
  assert.match(sheet, /Fortsätt från/, 'the resume choice must show the time');
});

test('WS83: the resume seek is carried by loadedmetadata and consumed once', () => {
  // REACHABILITY (§7a): the seek must be applied by the loadedmetadata
  // listener, and it must re-check state.current so a superseded playback
  // cannot receive a stale seek. The listener is extracted by brace matching
  // and EXECUTED against a driven world, so the assertions are on behaviour:
  // a stale pending position on a superseded track must NOT seek, and a live
  // one must.
  const start = APP.indexOf("audioEl.addEventListener('loadedmetadata'");
  assert.notEqual(start, -1, 'a loadedmetadata listener must exist');
  let d = 0, end = start;
  for (let i = start; i < APP.length; i++) {
    if (APP[i] === '{') d++;
    else if (APP[i] === '}') { d--; if (d === 0) { end = i; break; } }
  }
  const listenerSrc = APP.slice(start, end + 1);
  assert.match(listenerSrc, /__resumeFromS/, 'it must apply the pending resume position');
  assert.match(listenerSrc, /__resumeFromS = null/, 'the pending position is consumed once');
  assert.match(listenerSrc, /audioEl\.currentTime = target/, 'it must actually seek');
  // DRIVEN: run the real listener body against a world.
  const run = (currentTrack, seeks) => {
    const audioEl = { currentTime: 0 };
    const logs = [];
    const fn = new Function('state', 'audioEl', 'diagLog', `
      ${listenerSrc.replace("audioEl.addEventListener('loadedmetadata', () => {", 'const handler = () => {')
        .replace(/\}\);\s*$/, '};')
        .replace(/^  /gm, '')}
      handler();
    `);
    fn({ current: currentTrack }, audioEl, (m) => logs.push(m));
    return { t: audioEl.currentTime, logs };
  };
  // Live track with a pending position → seeks.
  const live = run({ __resumeFromS: 734 }, null);
  assert.equal(live.t, 734, 'a live track with a pending position must seek to it');
  // Superseded track (state.current is null) → must NOT seek.
  const stale = run(null, null);
  assert.equal(stale.t, 0, 'a superseded playback must never receive the stale seek');
  // Consumed once: a second invocation with the same track must not re-seek.
  const track = { __resumeFromS: 500 };
  run(track, null);
  const second = run(track, null);
  assert.equal(second.t, 0, 'the pending position is consumed exactly once');
});

test('WS83: the save points cover stop, pause, end, and app close', () => {
  // stopAndClosePlayer saves BEFORE the teardown.
  const stop = grab('stopAndClosePlayer');
  const saveIdx = stop.indexOf('savePlaybackPosition()');
  const pauseIdx = stop.indexOf('audioEl.pause()');
  assert.ok(saveIdx !== -1 && pauseIdx !== -1 && saveIdx < pauseIdx,
    'stopAndClosePlayer must record the position before pausing/clearing');
  // The pause/ended listener saves.
  const evListener = APP.match(/\['play', 'pause', 'ended'\]\.forEach[\s\S]*?\}\);/);
  assert.ok(evListener, 'the play/pause/ended listener must exist');
  assert.match(evListener[0], /savePlaybackPosition\(\)/, 'pause and ended must save');
  // pagehide and freeze save. The regex anchors on the HANDLER REGISTRATION
  // (window.addEventListener('pagehide'…), not on any comment text, so a
  // mutation that deletes the save call inside the handler goes red.
  const ph = APP.match(/addEventListener\('pagehide'[\s\S]{0,500}?savePlaybackPosition\(\)/);
  assert.ok(ph, 'pagehide must save the position');
  const fz = APP.match(/addEventListener\('freeze'[\s\S]{0,400}?savePlaybackPosition\(\)/);
  assert.ok(fz, 'freeze must save the position');
  // Throttled during playback, on the episode branch of timeupdate.
  const tu = APP.match(/audioEl\.addEventListener\('timeupdate'[\s\S]*?\}\);/);
  assert.ok(tu, 'the timeupdate listener must exist');
  assert.match(tu[0], /POSITION_SAVE_INTERVAL_MS/, 'playback saves must be throttled');
  assert.match(tu[0], /kind === 'episode'/, 'the throttle must ride the episode branch only');
});
