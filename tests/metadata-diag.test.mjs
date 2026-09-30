/**
 * Workstream 0 — metadata diagnostics hook.
 *
 * `app.js` gained ONE opt-in, read-only diagnostics hook (`srMetaDiag`) so the
 * open channel-switch and programme-skip metadata reports become observable.
 * These tests assert the SOURCE (the same idiom as tests/fixpass.test.mjs:
 * the tracked root app.js is the GitHub Pages source of truth, read as text).
 *
 * What is guarded here is deliberately narrow and mechanical:
 *   1. the two-key gate, and that NEITHER key alone opens it;
 *   2. no side effects outside the gate;
 *   3. the pre-existing always-on diagLog() mechanism is untouched;
 *   4. every required snapshot section exists;
 *   5. the hook is read-only with respect to playback state.
 *
 * These tests do NOT diagnose anything and assert no behaviour fix.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Strip comments while SKIPPING string and template literals, so that URLs like
// 'https://api.sr.se/...' are never mistaken for a line comment. Assertions that
// ask "does the CODE do X" must look at this, not at the raw source: app.js is
// heavily commented, and several of those comments legitimately name identifiers
// the assertion is trying to prove the CODE does not use.
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
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
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

// Isolate a region of the source. Used to prove properties of the hook alone,
// without matching unrelated code elsewhere in a 3500-line file.
// `src` defaults to the raw file (region markers live in comments) — pass
// APP_JS when the assertions concern code rather than documentation.
function region(startMarker, endMarker, src = APP_JS) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, `start marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.notEqual(b, -1, `end marker not found after ${startMarker}`);
  return src.slice(a, b);
}

const HOOK = region(
  '// ================= WS0: metadata diagnostics hook =================',
  '// ---------------- boot ----------------'
);
// The same hook region, comments stripped, bounded by CODE markers. Used for
// "the code must NOT do X" assertions, where a comment naming X is fine but
// code doing X is not.
const HOOK_CODE = region(
  'const META_DIAG_FLAG =', 'window.srMetaDiagGateOpen = metaDiagGateOpen;', APP_CODE
);

// The always-on, pre-existing diagnostics mechanism (iOS audio-lifecycle
// investigation). Must survive WS0 unchanged.
const EXISTING_DIAG = region('const DIAG_ID =', 'const META_DIAG = {');

test('gate: hook is reachable and inert-returning when the gate is shut', () => {
  assert.ok(HOOK.includes('function srMetaDiagSnapshot()'),
    'console entry point srMetaDiagSnapshot must exist');
  // The entry point returns null BEFORE building anything when the gate is shut.
  const entry = HOOK.slice(HOOK.indexOf('function srMetaDiagSnapshot()'));
  const guardIdx = entry.indexOf('metaDiagGateOpen()');
  const buildIdx = entry.indexOf('metaDiagBuildSnapshot()');
  assert.ok(guardIdx !== -1, 'entry point must consult metaDiagGateOpen()');
  assert.ok(buildIdx > guardIdx,
    'gate must be checked BEFORE the snapshot is built');
  assert.ok(/if \(!metaDiagGateOpen\(\)\) return null;/.test(entry),
    'closed gate must return null with no further work');
});

test('gate: requires BOTH the query parameter and the localStorage flag', () => {
  const gate = HOOK.slice(HOOK.indexOf('function metaDiagGateOpen()'));

  // (1) the URL query string must contain diag=metadata ...
  assert.ok(HOOK.includes("const META_DIAG_QUERY = 'diag=metadata';"),
    'the query token must be defined as diag=metadata');
  assert.ok(gate.includes('location.search'),
    'gate must read the actual query string');
  assert.ok(gate.includes('META_DIAG_QUERY'),
    'gate must consult the query token');
  assert.ok(/indexOf\(META_DIAG_QUERY\) === -1\) return false;/.test(gate),
    'a missing query parameter must close the gate immediately');

  // ... AND (2) localStorage['sr-meta-diag'] must be exactly "on".
  assert.ok(HOOK.includes("const META_DIAG_FLAG = 'sr-meta-diag';"),
    "the localStorage key must be defined as 'sr-meta-diag'");
  assert.ok(gate.includes('localStorage.getItem(META_DIAG_FLAG)'),
    'gate must read localStorage for the flag');
  assert.ok(/return flag === 'on';/.test(gate),
    "the flag must be compared exactly to 'on'");
  // The flag check is the LAST thing: the query check returns early above it.
  // If the localStorage check were first, the query check would be redundant.
  const earlyReturn = gate.indexOf('return false');
  const flagRead = gate.indexOf('localStorage.getItem');
  const flagReturn = gate.lastIndexOf("return flag === 'on'");
  assert.ok(earlyReturn !== -1 && flagRead !== -1 && flagReturn !== -1);
  assert.ok(earlyReturn < flagRead && flagRead < flagReturn,
    'both conditions must be required — neither alone may pass');
});

test('gate: neither key alone is sufficient (behavioural simulation)', () => {
  // Mirror the gate's decision logic and prove all four combinations. This
  // catches a future edit that makes either key sufficient, which a pure
  // source-presence assertion would not.
  function gateOpen(search, storageValue) {
    if (String(search).indexOf('diag=metadata') === -1) return false;
    return storageValue === 'on';
  }
  assert.equal(gateOpen('?diag=metadata', null), false,
    'query parameter ALONE must not open the gate');
  assert.equal(gateOpen('?diag=metadata', 'off'), false,
    "query parameter + flag='off' must not open the gate");
  assert.equal(gateOpen('', 'on'), false,
    'localStorage flag ALONE must not open the gate');
  assert.equal(gateOpen('', null), false,
    'no keys at all must not open the gate');
  assert.equal(gateOpen('?diag=metadata', 'on'), true,
    'both keys together must open the gate');
  // A stray parameter that merely CONTAINS the token elsewhere still counts as
  // present, matching the shipped indexOf() semantics — pinned so the
  // behaviour cannot drift silently.
  assert.equal(gateOpen('?x=1&diag=metadata&y=2', 'on'), true);
});

test('gate: closed hook performs no side effects', () => {
  // A closed gate must not register listeners, create timers, fetch, or write
  // localStorage. Scan the WHOLE hook for those and require that every hit is
  // either in the snapshot builder (read-only introspection) or absent.
  //
  // Nothing in the hook may add an event listener of any kind.
  assert.ok(!/addEventListener/.test(HOOK),
    'hook must never register an event listener');
  assert.ok(!/removeEventListener/.test(HOOK),
    'hook must never remove an event listener');
  // Nothing may schedule work.
  assert.ok(!/setTimeout|setInterval|requestAnimationFrame/.test(HOOK),
    'hook must not create timers or animation frames');
  // Nothing may issue a network request. `fetch` appears only as part of the
  // identifiers below, which are captured values, not calls.
  assert.ok(!/\bfetch\s*\(/.test(HOOK),
    'hook must not call fetch()');
  // Nothing may write localStorage (it may only read the gate flag).
  const writes = HOOK.match(/localStorage\.(setItem|removeItem|clear)/g) || [];
  assert.deepEqual(writes, [],
    'hook must not write localStorage');
  // The only localStorage access is the gate's own read.
  const reads = HOOK.match(/localStorage\.[a-zA-Z]+/g) || [];
  assert.deepEqual([...new Set(reads)], ['localStorage.getItem'],
    'hook may only read localStorage, via getItem');
});

test('existing always-on diagLog mechanism is untouched', () => {
  // Still declared, still console+localStorage writing, still called on load.
  assert.ok(EXISTING_DIAG.includes('const diagLog = (msg) =>'),
    'the pre-existing diagLog() must still be declared');
  assert.ok(EXISTING_DIAG.includes("localStorage.setItem(k, JSON.stringify(arr.slice(-200)))"),
    'diagLog() must still write the capped 200-entry array to localStorage');
  assert.ok(EXISTING_DIAG.includes("const k = 'sr-diag-log'"),
    "diagLog() must still target the 'sr-diag-log' key");
  assert.ok(/diagLog\(`page-load href=/.test(APP_JS),
    'diagLog() must still be called on page load');
  assert.ok(/diagLog\(`audio-element-created id=\$\{DIAG_ID\}`\);/.test(APP_JS),
    'the audio-element-created diagLog() call must survive');
  // The existing mechanism is NOT gated — WS0 must not have gated it.
  assert.ok(!/if\s*\(.*metaDiagGateOpen.*\)[\s\S]{0,200}diagLog\(`page-load/.test(APP_JS),
    'the existing page-load diagLog() must remain unconditional');
  // The hook reuses diagLog() rather than replacing it with its own writer.
  assert.ok(HOOK.includes('diagLog(`meta-snapshot'),
    'the hook must append its line through the existing diagLog()');
});

test('snapshot: playback / identity section is complete', () => {
  const playback = HOOK.slice(HOOK.indexOf('playback: {'), HOOK.indexOf('audioEl: {'));
  const required = [
    'kind', 'id', 'title', 'subtitle', '_srProgramTitle', 'audioUrl',
    'codec', 'bitrate', 'transport', 'dvr', 'candidateIndex', 'candidates',
  ];
  required.forEach((f) => {
    assert.ok(playback.includes(`${f}:`) || playback.includes(`${f} ??`),
      `playback.current must expose ${f}`);
  });
  assert.ok(playback.includes('lastPlayingKey'),
    'snapshot must include lastPlayingKey');
});

test('snapshot: audioEl section reports position, buffering and src', () => {
  const build = region('function metaDiagBuildSnapshot()', 'window.srMetaDiag =', APP_CODE);
  const audio = build.slice(build.indexOf('audioEl: {'));
  ['currentTime', 'duration', 'paused', 'readyState', 'networkState', 'buffered', 'src']
    .forEach((f) => {
      // Either an explicit `f:` key or ES6 shorthand `f,` in the object.
      assert.ok(
        audio.includes(`${f}:`) || new RegExp(`\\b${f},`).test(audio),
        `audioEl section must expose ${f}`
      );
    });
  // buffered must be flattened to a serialisable {start,end} array.
  assert.ok(/buffered\.push\(\{ start:/.test(build),
    'buffered must be serialised as {start,end} objects');
  // src must be read as an attribute, not by assigning to it.
  assert.ok(audio.includes("audioEl.getAttribute('src')"),
    'audioEl.src must be read, never assigned');
});

test('snapshot: live now-playing section captures raw body + previous/next song', () => {
  const np = HOOK.slice(HOOK.indexOf('nowPlaying: {'));
  ['song', 'artwork', 'channelId', 'nowPlayingSeq', 'artworkSeq', 'nowPlayingTimer']
    .forEach((f) => assert.ok(np.includes(f), `nowPlaying section must expose ${f}`));
  // The RAW body is captured, and it is the only place previoussong/nextsong
  // can be seen — the parser reads playlist.song exclusively.
  assert.ok(np.includes('rawRightNow'), 'raw rightnow body must be captured');
  assert.ok(np.includes('rawRightNowReceivedAt'), 'receipt time must be recorded');
  // Capture happens at the point of receipt in fetchNowPlaying().
  const fetchFn = region('async function fetchNowPlaying(', 'function scheduleNowPlayingPoll()');
  assert.ok(fetchFn.includes('META_DIAG.lastRightNowRaw = data;'),
    'raw rightnow body must be stored where the response arrives');
  assert.ok(fetchFn.includes('META_DIAG.lastRightNowAt = new Date().toISOString();'),
    'raw rightnow receipt must be timestamped');
  // ...and neither the parser nor the hook's code may READ them as properties.
  // The words themselves appear in an explanatory note string and in comments
  // (that is the point of the capture), so the assertion is about property
  // access, which is what "wired up" would actually require.
  const fetchCode = region(
    'async function fetchNowPlaying(', 'function scheduleNowPlayingPoll()', APP_CODE);
  assert.ok(/const song = pl\.song \|\| null;/.test(fetchCode),
    'the app must still parse playlist.song only');
  // WS9 REVERSES the WS0 decision, deliberately. WS0 captured the raw body
  // precisely because previoussong/nextsong were "otherwise unobservable", and
  // forbade the parser reading them. WS9 is the future workstream that test
  // anticipated: the fields carry starttimeutc/stoptimeutc (verified live
  // 2026-09-27 on ch163), so a song can be matched to any DVR position, and
  // the parser now DOES read them into the retained timeline.
  assert.ok(/keep\(pl\.previoussong\)/.test(fetchCode),
    'the parser must now READ previoussong into the timeline (WS9)');
  assert.ok(/keep\(pl\.nextsong\)/.test(fetchCode),
    'the parser must now READ nextsong into the timeline (WS9)');
  // The raw capture is STILL required: it is the reference the timeline is
  // verified against, and it is what a future diagnostic would need.
  assert.ok(fetchCode.includes('META_DIAG.lastRightNowRaw = data;'),
    'the raw body must be retained in full');
  // The hook itself still must not touch them -- the snapshot reports the
  // resolved timeline, not the raw fields.
  assert.ok(!/\.previoussong/.test(HOOK_CODE) && !/\.nextsong/.test(HOOK_CODE),
    'hook code must not access previoussong/nextsong directly');
});

test('snapshot: programme schedule section exposes raw + parsed + receipt time', () => {
  const sch = HOOK.slice(HOOK.indexOf('schedule: {'), HOOK.indexOf('episodeTracks: {'));
  assert.ok(sch.includes('rawScheduledEpisodes'), 'raw schedule body must be captured');
  assert.ok(sch.includes('rawReceivedAt'), 'schedule receipt time must be recorded');
  assert.ok(sch.includes('channelId'), 'active channel id must be recorded');
  assert.ok(sch.includes('startMs') && sch.includes('endMs') && sch.includes('title'),
    'parsed schedule entries must expose startMs/endMs/title');
  // Raw capture reuses the response that already arrived — no new request.
  const day = region('async function fetchScheduleDay(', 'async function fetchSchedule(');
  assert.ok(day.includes('META_DIAG.lastScheduleRaw = data;'),
    'raw schedule body must be stored where the response arrives');
});

test('snapshot: episode tracks section is complete', () => {
  const ep = HOOK.slice(HOOK.indexOf('episodeTracks: {'), HOOK.indexOf('dvr: {'));
  assert.ok(ep.includes('currentTrack'), 'episodeCurrentTrack must be exposed');
  assert.ok(ep.includes('cacheKeys'), 'episodeTracksCache keys must be exposed');
  assert.ok(ep.includes('trackSeq'), 'episodeTrackSeq must be exposed');
  assert.ok(/Array\.from\(episodeTracksCache\.keys\(\)\)/.test(ep),
    'cache keys must be materialised as a serialisable array');
});

test('snapshot: DVR position section is complete', () => {
  const dvr = HOOK.slice(HOOK.indexOf('dvr: {'), HOOK.indexOf('dom: {'));
  ['atLiveEdge', 'distanceFromLiveEdge', 'seekableStart', 'seekableEnd']
    .forEach((f) => assert.ok(dvr.includes(f), `dvr section must expose ${f}`));
  assert.ok(dvr.includes('positionWallClockIso'),
    'the wall-clock time of the heard position must be derived');
  // The helper call lives just above the returned object, so scan the builder.
  const build = region('function metaDiagBuildSnapshot()', 'window.srMetaDiag =', APP_CODE);
  assert.ok(build.includes('dvrPositionToDate(audioEl.currentTime)'),
    'wall-clock position must reuse the existing read-only helper');
  // It must be applied to the played position, not to Date.now().
  assert.ok(!/dvrPositionToDate\(Date\.now\(\)/.test(build),
    'wall-clock position must derive from the playback position');
});

test('snapshot: rendered DOM section captures text, state and playing marks', () => {
  const dom = HOOK.slice(HOOK.indexOf('dom: {'), HOOK.indexOf('listeners:'));
  ['.player-title', '.player-sub', '.now-playing-line', '.player-mode',
    '.player-quality', '.player-mini']
    .forEach((sel) => {
      assert.ok(dom.includes(`'${sel}'`), `DOM section must capture ${sel}`);
    });
  assert.ok(dom.includes('playerMinimized'), 'playerMinimized must be captured');
  assert.ok(dom.includes('playerClassName'), '$player.className must be captured');
  assert.ok(dom.includes('playerInlineTransform'), 'inline transform must be captured');
  assert.ok(dom.includes('.expand-label') && dom.includes('.expand-title')
    && dom.includes('.expand-sub') && dom.includes('.expand-img'),
  'open expand panel must expose label/title/sub/img');
  assert.ok(dom.includes('expandButtonAriaExpanded'),
    'expand-panel open state must be captured');
  // Playing marks: the stream key plus both aria attributes. The scan and the
  // push live around the returned object, so search the whole builder.
  const build = region('function metaDiagBuildSnapshot()', 'window.srMetaDiag =', APP_CODE);
  assert.ok(build.includes('[data-stream-key]'),
    'playing icons must be found by data-stream-key');
  assert.ok(build.includes('streamKey') && build.includes('ariaPressed')
    && build.includes('ariaLabel'),
  'each playing icon must expose streamKey, aria-pressed and aria-label');
  assert.ok(build.includes("classList.contains('playing')"),
    'only icons actually marked playing may be captured');
  assert.ok(dom.includes('playingIcons'),
    'the DOM section must report the playing marks');
});

test('snapshot: expand panel has a stable per-node identity', () => {
  // The single most important observability requirement: distinguishing the
  // SAME panel node surviving a channel switch from a NEW panel built from
  // state. That needs a monotonically increasing id assigned on creation.
  const build = region('const buildExpandPanel = () => {', 'expandBtn.addEventListener');
  assert.ok(build.includes('META_DIAG.expandPanelSeq += 1'),
    'panel id must be incremented when the node is created');
  assert.ok(build.includes('panel._srPanelSeq = META_DIAG.expandPanelSeq'),
    'the id must be stored on the node itself');
  // The snapshot must report it alongside a build counter.
  const dom = HOOK.slice(HOOK.indexOf('dom: {'), HOOK.indexOf('listeners:'));
  assert.ok(dom.includes('panel._srPanelSeq ?? null'),
    'snapshot must read the id from the live node');
  assert.ok(dom.includes('panelSeqBuiltCount'),
    'snapshot must report how many panels have been built, so a rebuilt panel is visible');
  // The counter must be shared across renders (a per-render counter would
  // restart and make two different nodes look identical).
  assert.ok(/const META_DIAG = \{[\s\S]*expandPanelSeq: 0,/.test(APP_JS),
    'the panel counter must be initialised once, at module scope');
});

test('snapshot: listener accounting is present, per type, add and remove', () => {
  const lis = HOOK.slice(HOOK.indexOf('listeners: (() => {'), HOOK.indexOf('environment: {'));
  assert.ok(lis.includes('META_DIAG.listenerAdds'), 'registered counts must be reported');
  assert.ok(lis.includes('META_DIAG.listenerRemoves'), 'removed counts must be reported');
  assert.ok(lis.includes('netLive'), 'net live count (adds − removes) must be reported');
  // Only the app's own registration sites are instrumented. Checked against
  // CODE: the source comment above the counters names EventTarget.prototype to
  // state that it is deliberately NOT touched.
  assert.ok(!/EventTarget\.prototype/.test(APP_CODE),
    'built-in EventTarget.prototype must NOT be monkey-patched');
  // Every app-owned addEventListener site on audioEl is counted: no add site
  // may lack its count call. Two of these sites are forEach loops over several
  // event names, so the call count (8) is by SOURCE SITE, not by listener.
  // WS2 added a second registration surface ($player touch handlers, stored in
  // the `registered` array), so the count calls are no longer equal to the
  // audioEl sites alone. What must hold is that every audioEl add site has a
  // count call, and that the surplus is accounted for by the $player block.
  const addSites = APP_CODE.split('audioEl.addEventListener').length - 1;
  const countCalls = (APP_CODE.match(/metaDiagCountAdd\(/g) || []).length
    - (APP_CODE.match(/function metaDiagCountAdd\(/g) || []).length;
  // WS9 added a 9th audioEl site: the `seeked` listener that re-resolves the
  // programme and song for the playhead after a seek. It is registered ONCE at
  // module scope, which is why it cannot accumulate the way renderPlayer's
  // timeupdate listener used to (the WS1 leak).
  assert.equal(addSites, 9, 'expected 9 audioEl.addEventListener source sites');
  assert.ok(countCalls >= addSites,
    'every audioEl.addEventListener site must have a matching metaDiagCountAdd call');
  // The surplus must be exactly the $player gesture registrations (one call
  // site, looping over 4 event types).
  assert.equal(countCalls - addSites, 1,
    'the only surplus count call is the $player gesture-registration loop');
  // Removals counted too. WS1 added a third site (the programme-skip updater
  // that used to leak); WS2 added a fourth ($player gesture handlers). WS4
  // changed only the FORM of the gesture removal (it now honours a per-handler
  // `target`, because three terminal signals bind on window/document), so the
  // site count stays 4. What matters is the invariant: no removal site may
  // exist without its count call.
  const remSites = APP_CODE.split('audioEl.removeEventListener').length - 1
    + (APP_CODE.split('removeEventListener(type, fn, opts)').length - 1);
  const remCalls = (APP_CODE.match(/metaDiagCountRemove\(/g) || []).length
    - (APP_CODE.match(/function metaDiagCountRemove\(/g) || []).length;
  assert.equal(remSites, 4, 'expected 4 listener-removal source sites (3 audioEl + 1 $player)');
  assert.equal(remCalls, remSites,
    'every listener-removal site must have a matching metaDiagCountRemove call');
  // The timeupdate listener in renderPlayer() that WS0 must leave alone is
  // still present — counted, but not refactored or removed.
  assert.ok(APP_JS.includes("audioEl.addEventListener('timeupdate', syncNext)"),
    'the renderPlayer timeupdate listener must still exist untouched');
  assert.ok(APP_JS.includes("metaDiagCountAdd('timeupdate');\n        audioEl.addEventListener('timeupdate', syncNext)"),
    'the un-removed renderPlayer timeupdate listener must still be counted');
});

test('snapshot: environment section is complete', () => {
  const env = HOOK.slice(HOOK.indexOf('environment: {'));
  ['DIAG_ID', 'href', 'standalone', 'userAgent', 'viewport', 'performanceNow']
    .forEach((f) => assert.ok(env.includes(f), `environment must expose ${f}`));
  assert.ok(env.includes('display-mode: standalone'),
    'standalone must come from the display-mode media query');
  assert.ok(/width: window\.innerWidth/.test(env), 'viewport width must be captured');
});

test('hook is read-only with respect to playback state', () => {
  // No HLS internals, no playback mutation.
  assert.ok(!/hlsAttach/.test(HOOK), 'hook must not call hlsAttach');
  assert.ok(!/hlsDetach/.test(HOOK), 'hook must not call hlsDetach');
  assert.ok(!/hls\.js/.test(HOOK), 'hook must not reference hls.js');
  // state.current must only ever be READ.
  assert.ok(!/state\.current\s*=/.test(HOOK), 'hook must not assign state.current');
  assert.ok(!/state\.current\.\w+\s*=/.test(HOOK),
    'hook must not write any property of state.current');
  // The audio element must not be driven: no src, currentTime or play/pause.
  assert.ok(!/audioEl\.src\s*=/.test(HOOK), 'hook must not set audioEl.src');
  assert.ok(!/audioEl\.currentTime\s*=/.test(HOOK), 'hook must not seek');
  assert.ok(!/audioEl\.(play|pause|load)\s*\(/.test(HOOK),
    'hook must not play, pause or reload audio');
  // Nor may it re-render, re-poll or re-paint.
  ['renderPlayer(', 'playTrack(', 'startNowPlayingPoll(', 'pollNowPlaying(',
    'fetchNowPlaying(', 'paintNowPlaying(', 'paintProgramTitle(', 'advanceCandidate(']
    .forEach((fn) => {
      const calls = HOOK.split(fn).length - 1;
      assert.ok(calls === 0, `hook must not call ${fn}`);
    });
  // And no listener work: the hook counts, it does not attach.
  ['loadEpisodeTracks(', 'stopEpisodeTracks(', 'stopNowPlayingPoll(']
    .forEach((fn) => {
      assert.ok(HOOK.split(fn).length - 1 === 0, `hook must not call ${fn}`);
    });
});

test('hook output is bounded and truncation is announced', () => {
  const cap = HOOK.slice(HOOK.indexOf('function metaDiagCapRaw('), HOOK.indexOf('function metaDiagText('));
  assert.ok(cap.includes('META_DIAG_RAW_MAX_CHARS'), 'raw bodies must be capped at a char limit');
  assert.ok(cap.includes('truncated'), 'the cap result must report whether truncation happened');
  assert.ok(cap.includes('[TRUNCATED]'),
    'truncation must be stated in the output, not silent');
  // The cap is a pure function of its argument — it never mutates the source.
  assert.ok(/const text = JSON\.stringify\(value\)/.test(cap) || /text = JSON\.stringify\(value\)/.test(cap),
    'the cap must measure the serialised length of the value');
});

test('raw capture adds no network request to normal operation', () => {
  // Both raw captures must assign an already-received body. No new fetch, and
  // neither may sit outside a try/catch in a way that can break playback.
  assert.ok(!/META_DIAG\.lastRightNowRaw = await/.test(APP_JS),
    'raw capture must not await anything');
  assert.ok(!/META_DIAG\.lastScheduleRaw = await/.test(APP_JS),
    'raw capture must not await anything');
  // The assignments are plain references to the awaited response.
  const addCapture = (APP_JS.match(/META_DIAG\.last(RightNowRaw|ScheduleRaw) = data;/g) || []);
  assert.equal(addCapture.length, 2, 'exactly one assignment per captured endpoint');
});

test('hook adds no unconditional side effect at load time', () => {
  // window.srMetaDiag is a function reference assignment only — calling it is
  // what is gated, not defining it.
  assert.ok(HOOK.includes('window.srMetaDiag = srMetaDiagSnapshot;'),
    'the entry point must be exposed on window for console use');
  const assignLine = HOOK.slice(HOOK.indexOf('window.srMetaDiag ='), 400);
  assert.ok(!/srMetaDiagSnapshot\(\)/.test(assignLine),
    'the hook must not be invoked at load time');
  // The gate helpers themselves are pure reads, called only from the entry point.
  assert.ok(!/metaDiagGateOpen\(\);/.test(APP_JS.split('function srMetaDiagSnapshot()')[0]),
    'the gate must not be evaluated during page load');
});

// =====================================================================
// Workstream 1 — the timeupdate listener leak in renderPlayer().
//
// WS0 recorded that renderPlayer() re-registered a `timeupdate` listener
// (syncNext, the programme-skip "next button" updater) on the singleton audioEl
// on EVERY render and never removed any. renderPlayer() starts with
// $player.textContent = '' and has ~19 call sites, so each render orphaned a
// full button tree while its closure stayed reachable from audioEl.
//
// The fix uses the convention the file already applies twice (_srUpd,
// _srDvrUpd): remove the previous handler before adding the new one.
//
// These tests prove the fix is correct and that nothing user-visible was
// dropped along the way. They do NOT claim the leak caused any reported
// symptom — it demonstrably cannot reach the fields where those live.
// =====================================================================

// The renderPlayer() schedule-wiring block, as CODE (comments stripped, so
// assertions cannot match this file's own documentation).
// The end marker is the comment that opens the layout block below the schedule
// wiring. It was renamed in WS5b, so it is named here from the same string the
// layout section uses -- one source of truth, so a future rename fails loudly
// here instead of silently shrinking this region to the whole rest of the file.
const LAYOUT_BLOCK = '// ---- WS5b layout pieces ----';
const PROGRAM_SKIP = region(
  '// Wire program-skip buttons once the schedule resolves',
  LAYOUT_BLOCK, APP_JS
);
assert.ok(APP_JS.includes(LAYOUT_BLOCK), 'the layout block marker must exist');
const PROGRAM_SKIP_CODE = stripComments(PROGRAM_SKIP);

test('WS1: the programme-skip timeupdate listener is removed before it is added', () => {
  // The handler is stored on the audioEl singleton, like its two siblings.
  assert.ok(PROGRAM_SKIP_CODE.includes('if (audioEl._srNextUpd)'),
    'the previous handler must be checked via the _srNextUpd property guard');
  assert.ok(PROGRAM_SKIP_CODE.includes("audioEl.removeEventListener('timeupdate', audioEl._srNextUpd)"),
    'the previous handler must be removed by identity');
  // The new handler is stored, so the NEXT render can find and remove it.
  assert.ok(PROGRAM_SKIP_CODE.includes('audioEl._srNextUpd = syncNext;'),
    'the newly registered handler must be stored for the next render to clean up');

  // Ordering is the whole point: remove BEFORE add.
  const guardAt = PROGRAM_SKIP_CODE.indexOf('if (audioEl._srNextUpd)');
  const removeAt = PROGRAM_SKIP_CODE.indexOf('removeEventListener');
  const addAt = PROGRAM_SKIP_CODE.indexOf("audioEl.addEventListener('timeupdate', syncNext)");
  const storeAt = PROGRAM_SKIP_CODE.indexOf('audioEl._srNextUpd = syncNext;');
  assert.ok(guardAt !== -1 && removeAt !== -1 && addAt !== -1 && storeAt !== -1,
    'all four elements of the remove-then-add cycle must be present');
  assert.ok(guardAt < removeAt && removeAt < addAt && addAt < storeAt,
    'the sequence must be: guard → remove → add → store');
});

test('WS1: the removal is paired with the WS0 diagnostic counters', () => {
  // The counters are the evidence the NEXT workstream depends on. If the
  // removal stopped decrementing, netLive.timeupdate would under-report and
  // a future reader would be misled.
  assert.ok(PROGRAM_SKIP_CODE.includes("metaDiagCountRemove('timeupdate')"),
    'the removal must decrement the diagnostic counter');
  assert.ok(PROGRAM_SKIP_CODE.includes("metaDiagCountAdd('timeupdate')"),
    'the registration must increment the diagnostic counter');
  // Paired with the right event type, and not counted twice.
  const removes = (PROGRAM_SKIP_CODE.match(/metaDiagCountRemove\('timeupdate'\)/g) || []).length;
  const adds = (PROGRAM_SKIP_CODE.match(/metaDiagCountAdd\('timeupdate'\)/g) || []).length;
  assert.equal(removes, 1, 'exactly one removal count in this block');
  assert.equal(adds, 1, 'exactly one registration count in this block');
});

test('WS1: the removal runs synchronously in renderPlayer, not in the callback', () => {
  // The registration happens inside the async fetchSchedule().then(...) body.
  // If the removal also lived there it would race the very registration it
  // exists to prevent, and the guard would never fire on a fresh render.
  const callbackAt = PROGRAM_SKIP_CODE.indexOf('.then((schedule) =>');
  const guardAt = PROGRAM_SKIP_CODE.indexOf('if (audioEl._srNextUpd)');
  const removeAt = PROGRAM_SKIP_CODE.indexOf('removeEventListener');
  assert.notEqual(callbackAt, -1, 'the fetchSchedule callback must still be present');
  assert.ok(guardAt < callbackAt,
    'the removal guard must sit BEFORE the fetchSchedule callback (synchronous)');
  assert.ok(removeAt < callbackAt,
    'the removeEventListener call must sit BEFORE the fetchSchedule callback');
  // The fetch must still be made at the point the wiring happens.
  assert.ok(/fetchSchedule\(cur\.id\)\.then/.test(PROGRAM_SKIP_CODE),
    'the schedule fetch must still happen here');
  // And the callback must still register AFTER its own guard.
  const addAt = PROGRAM_SKIP_CODE.indexOf("audioEl.addEventListener('timeupdate', syncNext)");
  assert.ok(addAt > callbackAt,
    'the registration must remain inside the callback, after the synchronous removal');
});

test('WS1: the removal is safe when no listener was ever registered', () => {
  // First DVR render ever: _srNextUpd is undefined, so the guard must skip
  // both the remove and the count decrement. An unguarded removal would
  // call removeEventListener(undefined) — harmless per spec, but it would
  // also corrupt the diagnostic counters.
  assert.ok(/if \(audioEl\._srNextUpd\) \{[\s\S]*?removeEventListener[\s\S]*?\}/.test(PROGRAM_SKIP_CODE),
    'the removeEventListener call must be inside the property guard');
  const removeAt = PROGRAM_SKIP_CODE.indexOf('removeEventListener');
  const guardOpen = PROGRAM_SKIP_CODE.lastIndexOf('{', removeAt);
  assert.ok(guardOpen < removeAt, 'the removal must be nested inside the guard block');
  // The property is also cleared, so a later render cannot remove it twice.
  assert.ok(PROGRAM_SKIP_CODE.includes('audioEl._srNextUpd = null;'),
    'the property must be cleared after removal so it cannot be removed twice');
});

test('WS1: no user-visible programme-skip behaviour was dropped', () => {
  // Every element of the original feature must still be present. The fix is
  // listener hygiene only — the buttons, the visibility rules and the seek
  // target must be identical.
  assert.ok(/if \(!schedule \|\| !document\.contains\(prevProgramBtn\)\) return;/.test(PROGRAM_SKIP_CODE),
    'the document.contains() early-return guard must survive');
  assert.ok(/const prevEv = programBoundary\(schedule, posMs\(\), -1\);/.test(PROGRAM_SKIP_CODE),
    'the previous-programme lookup must survive');
  // WS6 CHANGED THIS, deliberately. The lookup was
  //   const nextEv = programBoundary(schedule, posMs(), +1);
  // which returns the first event starting AFTER the playhead -- including an
  // event that has NOT STARTED YET. Pressing it then called
  // seekToProgramTime() with a future timestamp, which returns early and does
  // nothing. Measured over five real channels: 65.8% of all behind-live
  // moments produced that dead press, and only 4.0% reached the 'Till Direkt'
  // fallback. The lookup is now the next boundary the playhead can actually
  // REACH (one that has already begun). The user-visible feature -- a skip
  // button that moves the playhead -- is preserved; the dead press is not.
// WS7 SUPERSEDES THE WS6 FORM. WS6 used `schedule.find((ev) => ev.startMs <=
  // nowMs)`, which on an ASCENDING array returns the EARLIEST event of the day
  // -- "Ekot senaste nytt" @ 00:00, hours before the playhead. Seeking there
  // fell outside the 3 h DVR window, so the press showed a toast and did
  // nothing: 132/132 dead on real data, and the owner confirmed the button was
  // still dead on the phone after WS6 shipped. The lower bound is now the
  // PLAYHEAD, which makes it the nearest started boundary rather than the
  // first.
  assert.ok(/schedule\.find\(\(ev\) => ev\.startMs > playheadMs\s*\n?\s*&& ev\.startMs <= nowMs\)/.test(PROGRAM_SKIP_CODE),
    'the next-programme lookup must select the NEAREST boundary that has both begun and lies ahead of the playhead');
  assert.ok(/const nextEv = startedNext\s*\?/.test(PROGRAM_SKIP_CODE),
    'the button must still be wired from a next-programme lookup');
  assert.ok(!/programBoundary\(schedule, posMs\(\), \+1\)/.test(PROGRAM_SKIP_CODE),
    'the future-programme lookup that produced dead presses must be gone');
  assert.ok(/const behindLive = cur\.atLiveEdge === false/.test(PROGRAM_SKIP_CODE),
    'the behind-live test must survive');
  assert.ok(/cur\.seekableEnd - \(audioEl\.currentTime \|\| 0\) > 60/.test(PROGRAM_SKIP_CODE),
    'the >60s behind-live threshold must survive');
  assert.ok(/nextProgramBtn\.style\.display = '';/.test(PROGRAM_SKIP_CODE)
    && /nextProgramBtn\.style\.display = 'none';/.test(PROGRAM_SKIP_CODE),
    'both button-visibility branches must survive');
  assert.ok(/nextProgramBtn\.title = nextEv\.title \|\| 'Nästa program';/.test(PROGRAM_SKIP_CODE),
    'the button title must survive');
  // Assert the seek TARGETS, not the handler syntax. WS6 replaced the inline
  // arrows with named+tagged functions (so the snapshot can read the real
  // wiring); the behaviour these buttons perform must be identical.
  assert.ok(/prevProgramBtn\.onclick = goPrev;/.test(PROGRAM_SKIP_CODE)
    && /const goPrev = \(\) => seekToProgramTime\(prevEv\.startMs\);/.test(PROGRAM_SKIP_CODE),
    'the previous-programme button must still seek to prevEv.startMs');
  // WS7 added press recording to this handler too; the seek target is unchanged.
  assert.ok(/nextProgramBtn\.onclick = goNext;/.test(PROGRAM_SKIP_CODE)
    && /const goNext = \(\) => \{\s*recordSkipPress\(nextEv\.startMs\);\s*seekToProgramTime\(nextEv\.startMs\);\s*\};/.test(PROGRAM_SKIP_CODE),
    'the next-programme button must still seek to nextEv.startMs');
  assert.ok(/if \(prevEv\) syncNext\(\);/.test(PROGRAM_SKIP_CODE),
    'the initial sync call must survive');
  // The catch body is asserted on CODE, so only the statement shape remains —
  // its explanatory comment is stripped. What matters is that the promise is
  // still terminated and the buttons are left hidden on failure.
  assert.ok(/\.catch\(\(\) => \{\s*\}\)/.test(PROGRAM_SKIP_CODE),
    'the failure path must survive');
});

test('WS1: the leak is fixed on every audioEl listener, not just this one', () => {
  // Regression guard for the CLASS of defect. Every `timeupdate` handler the app
  // registers on the singleton must be removable, i.e. stored on a _sr* property
  // and removed before being replaced. The three handlers are _srUpd (episode
  // seek), _srDvrUpd (DVR bar) and _srNextUpd (programme skip).
  ['_srUpd', '_srDvrUpd', '_srNextUpd'].forEach((prop) => {
    assert.ok(APP_CODE.includes(`if (audioEl.${prop})`),
      `${prop} must be removed behind a property guard`);
    assert.ok(APP_CODE.includes(`audioEl.removeEventListener('timeupdate', audioEl.${prop})`),
      `${prop} must be removed by identity`);
    assert.ok(new RegExp(`audioEl\\.${prop} = [a-z]`).test(APP_CODE),
      `${prop} must be assigned so the next render can clean it up`);
  });
  // No `timeupdate` handler may be registered on audioEl without being stored.
  // 3 sites pass a NAMED handler (the per-render updaters). A 4th registers an
  // inline arrow at module scope; it is counted separately below.
  const addSites = APP_CODE.match(/audioEl\.addEventListener\('timeupdate', ([A-Za-z]+)\)/g) || [];
  assert.equal(addSites.length, 3,
    'expected 3 named timeupdate registration sites (one per per-render updater)');
  ['upd', 'syncNext'].forEach((h) => {
    assert.ok(APP_CODE.includes(`audioEl._srUpd = ${h};`) || APP_CODE.includes(`audioEl._srNextUpd = ${h};`),
      `handler ${h} must be stored on the audioEl singleton`);
  });
  // The module-scope observer is registered exactly once, with an inline arrow,
  // and lives for the page's lifetime — not per-render, so it needs no teardown.
  // It is counted (so the diagnostic total is complete) but must never be
  // removed, since nothing re-registers it.
  const moduleScopeAdds = APP_CODE.match(/audioEl\.addEventListener\('timeupdate', \(\) =>/g) || [];
  assert.equal(moduleScopeAdds.length, 1,
    'the module-scope timeupdate observer must be registered exactly once');
  assert.ok(!/removeEventListener\('timeupdate', \(\) =>/.test(APP_CODE),
    'the module-scope observer must never be removed — nothing re-registers it');
});

// =====================================================================
// Workstream 2 — three confirmed bugs, fixed 2026-09-27.
//
//  Bug 1: "Till Direkt" sought to `cur.seekableEnd` EXACTLY — the buffered
//         boundary, which Safari/native HLS treat as a no-op.
//  Bug 2: playTrack() never reset `playerMinimized`, so tapping a different
//         channel while the previous one sat in the mini-bar opened mini.
//  Bug 3: swipe-up opened the panel via a path that never set the chevron's
//         open state, and renderSongView re-rendered from the `cur` captured
//         at BUILD time, so a panel left open across a channel switch showed
//         the PREVIOUS channel and never self-corrected.
//  Plus: enablePlayerGestures() stacked four touch listeners on the singleton
//         $player on every renderPlayer() with no removal (same class as the
//         WS1 audioEl leak).
// =====================================================================

// Region markers often live in comments, so each region below is located in the
// RAW file and then comment-stripped — matching the idiom used above.
const SEEK_TO_LIVE = stripComments(region(
  'function seekToLive()', '// ---- DVR transport', APP_JS));
const PLAY_TRACK = stripComments(region(
  'function playTrack(track)', '// ---- playback watchdog', APP_JS));
const RENDER_SONG_VIEW = stripComments(region(
  'const renderSongView = () => {', 'renderSongView();', APP_JS));
const GESTURES = stripComments(region(
  'function enablePlayerGestures(', '// ---- minimize:', APP_JS));
const GESTURE_FINISH = stripComments(region(
  'const finish = (e) => {', 'const registered = [', APP_JS));
const EXPAND_BTN = stripComments(region(
  "expandBtn.addEventListener('click'", '// Direct AAC streams', APP_JS));

test('WS2 Bug 1 (WS23 restated): seekToLive targets just BEHIND the edge, not onto the boundary', () => {
  // The defect: `audioEl.currentTime = end` — exactly the buffered end.
  assert.ok(!/audioEl\.currentTime = end;/.test(SEEK_TO_LIVE),
    'seekToLive must NOT assign the exact buffered end (the no-op boundary seek)');
  //
  // ---- WS23: this assertion was `end - LIVE_EDGE_TOLERANCE_S` ----
  // The INTENT is unchanged and still fully guarded: never aim at the
  // boundary, always aim behind it. What changed is WHICH constant supplies
  // the margin. `LIVE_EDGE_TOLERANCE_S` (10 s) is a DISPLAY rule -- when the
  // pill reads "LIVE" -- and sizing a seek target from it was a category
  // mistake. The margin now has its own constant, SEEK_LIVE_MARGIN_S.
  //
  // The old text is asserted to be GONE, so the two constants cannot drift
  // back into sharing a number unnoticed.
  assert.ok(!/end - LIVE_EDGE_TOLERANCE_S/.test(SEEK_TO_LIVE),
    'the seek target must NOT be sized by the display tolerance (WS23 separated them)');
  assert.ok(/end - SEEK_LIVE_MARGIN_S/.test(SEEK_TO_LIVE),
    'the target must sit behind the edge by SEEK_LIVE_MARGIN_S');
  // Clamped so it can never fall below the start of the window.
  assert.ok(/Math\.max\(start,/.test(SEEK_TO_LIVE),
    'the target must be clamped against seekableStart');
  assert.ok(/Number\.isFinite\(cur\.seekableStart\) \? cur\.seekableStart : 0/.test(SEEK_TO_LIVE),
    'seekableStart must be read defensively, defaulting to 0');
  assert.ok(/Number\.isFinite\(target\)/.test(SEEK_TO_LIVE),
    'the computed target must be validated before use');
  assert.ok(/audioEl\.currentTime = target;/.test(SEEK_TO_LIVE),
    'the clamped target is what gets assigned');
});

test('WS2 Bug 1: existing guards survive and paused/playing is untouched', () => {
  // The !cur and non-finite-end early returns must both remain. WS3 rewrote the
  // body to record WHICH guard bails (that is the whole diagnostic value), so
  // the !cur branch now labels its exit rather than being a bare `return`.
  // What must be preserved is that it still bails and still assigns nothing.
  assert.ok(/if \(!cur\) \{ d\.lastExit = 'no-track'; return; \}/.test(SEEK_TO_LIVE),
    'the !cur guard must survive (and label its exit for the WS3 diagnostic)');
  assert.ok(!/if \(!cur\) \{[^}]*audioEl\.currentTime/.test(SEEK_TO_LIVE),
    'the !cur guard must still return before touching playback');
  assert.ok(/const end = cur\.dvrAvailable \? cur\.seekableEnd : null;/.test(SEEK_TO_LIVE),
    'the dvrAvailable gate must survive');
  assert.ok(/d\.lastExit = cur\.dvrAvailable \? 'no-finite-end' : 'no-dvr';/.test(SEEK_TO_LIVE),
    'the non-finite-end guard must survive, and must distinguish no-dvr from no-window');
  // Contract: this is a SEEK ONLY. No reload, no new HLS session, no play().
  ['play(', 'pause(', 'load(', 'hlsAttach(', 'hlsDetach('].forEach((forbidden) => {
    assert.ok(!SEEK_TO_LIVE.includes(forbidden),
      `seekToLive must not call ${forbidden} — it is a seek, nothing more`);
  });
  assert.ok(!/audioEl\.src\s*=/.test(SEEK_TO_LIVE), 'seekToLive must not reassign the source');
  assert.ok(!/removeAttribute\('src'\)/.test(SEEK_TO_LIVE), 'seekToLive must not clear the source');
  // The UI must still follow the new position.
  assert.ok(/updateSeekableState\(\);\s*renderPlayer\(\);/.test(SEEK_TO_LIVE),
    'updateSeekableState() + renderPlayer() must still run after the seek');
});

test('WS2 Bug 2: playTrack resets playerMinimized so a fresh play opens full', () => {
  assert.ok(/playerMinimized = false;/.test(PLAY_TRACK),
    'playTrack must reset playerMinimized for every new session');
  // It must sit among the other per-session resets, BEFORE the state assignment,
  // so nothing renders between the reset and the new track.
  const resetAt = PLAY_TRACK.indexOf('playerMinimized = false;');
  const assignAt = PLAY_TRACK.indexOf('state.current = track');
  assert.ok(resetAt !== -1 && assignAt !== -1);
  assert.ok(resetAt < assignAt,
    'the reset must happen before state.current is assigned');
  assert.ok(PLAY_TRACK.indexOf('stopNowPlayingPoll();') < resetAt,
    'the reset belongs with the other per-session resets');
  // The stopAndClosePlayer reset must NOT have been removed.
  const close = stripComments(region('function stopAndClosePlayer()', 'audioEl.addEventListener', APP_JS));
  assert.ok(/playerMinimized = false;/.test(close),
    'stopAndClosePlayer must keep its own playerMinimized reset');
});

test('WS2 Bug 3: swipe commit-expand leaves the same state as the chevron path', () => {
  // The defect: the commit branch only reset the height and returned, so
  // aria-expanded stayed "false" and the `open` class was never added.
  assert.ok(/setExpandOpen\(true\);/.test(GESTURE_FINISH),
    'the commit-expand branch must mark the panel open');
  // AND the spring-back branch must mark it closed again.
  assert.ok(/setExpandOpen\(false\);/.test(GESTURE_FINISH),
    'the spring-back branch must mark the panel closed');
  // Both must live in finish(), i.e. AFTER the drag, not during it.
  assert.ok(GESTURE_FINISH.indexOf('setExpandOpen(true)')
    > GESTURE_FINISH.indexOf('const dy ='),
  'open state is set at commit time, after the drag is measured');
  // The open state may only be claimed when a panel actually EXISTS. A
  // renderPlayer() during the drag (channel switch, buffering event) wipes the
  // player subtree, so the panel can be gone by commit time — claiming
  // "expanded" with no panel would put the button and the DOM out of sync
  // again, which is the very class of bug this fix removes.
  // The commit-expand branch, sliced precisely. It is anchored on CODE, not on
  // its `// Commit EXPAND` comment — this region is comment-stripped, so that
  // marker is gone. The expand condition is the first `dy < -` test in finish().
  const commitAt = GESTURE_FINISH.indexOf('if (dy < -window.innerHeight * THRESHOLD');
  assert.notEqual(commitAt, -1, 'the commit-expand branch must exist');
  const commit = GESTURE_FINISH.slice(commitAt, GESTURE_FINISH.indexOf('return;', commitAt));
  assert.ok(/if \(panel\) \{/.test(commit),
    'the commit branch must guard on the panel still existing');
  assert.ok(commit.indexOf('if (panel) {') < commit.indexOf('setExpandOpen(true)'),
    'setExpandOpen(true) must be inside the panel-exists guard');
  // One shared helper, used by BOTH paths — the whole point of the fix.
  assert.ok(/function setExpandOpen\(open\)/.test(APP_CODE),
    'a shared setExpandOpen() helper must exist');
  assert.ok(EXPAND_BTN.includes('setExpandOpen(true);')
    && EXPAND_BTN.includes('setExpandOpen(false);'),
  'the chevron path must use the same helper for both open and close');
  // The helper must be the only place that writes the PLAYER's state, so the
  // two paths cannot drift apart again. Scoped to the player: the News
  // section has its own unrelated aria-expanded on its toggle button.
  const rawAria = APP_CODE.split("btn.setAttribute('aria-expanded', open ? 'true' : 'false')").length - 1;
  assert.equal(rawAria, 1,
    "the player's aria-expanded must be written in exactly one place (the shared helper)");
  const rawOpen = APP_CODE.split("classList.toggle('open'").length - 1;
  assert.equal(rawOpen, 1,
    "the player's `open` class must be toggled in exactly one place (the shared helper)");
  // The only other aria-expanded writer must be the News toggle, not the player.
  const otherAria = (APP_CODE.match(/\.setAttribute\('aria-expanded'/g) || []).length - 1;
  assert.equal(otherAria, 1,
    'the only other aria-expanded writer is the News section toggle');
  assert.ok(APP_CODE.includes("btn.setAttribute('aria-expanded', String(newsExpanded))"),
    'that other writer is the News toggle, which is unrelated to the player panel');
});

test('WS2 Bug 3: renderSongView reads the channel from LIVE state, not the closure', () => {
  // The defect: renderSongView re-rendered from `cur`, captured when the panel
  // was BUILT, so a panel left open across a channel switch kept showing the
  // previous channel forever.
  assert.ok(/const live = state\.current \|\| cur;/.test(RENDER_SONG_VIEW),
    'renderSongView must read the current track from state.current');
  // Every identity-bearing field must come from `live`, not `cur`.
  ['live.kind', 'live.artwork', 'live.title', 'live._srProgramTitle'].forEach((f) => {
    assert.ok(RENDER_SONG_VIEW.includes(f),
      `renderSongView must derive ${f} from live state`);
  });
  // No bare `cur.` may remain in the identity reads (cur may only be the
  // fallback on the same line as the state.current read).
  const bareCur = (RENDER_SONG_VIEW.match(/\bcur\./g) || []).length;
  assert.equal(bareCur, 0,
    'renderSongView must not read any field from the closure-captured cur');
  // The repaint hook must still exist, so a visible stale panel can correct.
  assert.ok(/panel\._srRepaint = \(\) => \{ content\.textContent = ''; renderSongView\(\); \};/
    .test(APP_CODE),
  'the repaint hook must still re-run renderSongView, so a stale panel self-corrects');
  // Displayed content must be unchanged: same label, song, artist, artwork.
  assert.ok(RENDER_SONG_VIEW.includes("text: 'Spelas just nu'"),
    'the panel label must be unchanged');
  assert.ok(RENDER_SONG_VIEW.includes('song.title'), 'the song title must still be shown');
  assert.ok(RENDER_SONG_VIEW.includes('song.artist'), 'the artist must still be shown');
  // WS26: the live cover comes from the one resolver. The property is that a
  // cover IS shown for a live song; reading the removed `nowPlaying.artwork`
  // here would assert the pre-WS26 architecture rather than the behaviour.
  assert.ok(/head \? head\.artwork : null/.test(RENDER_SONG_VIEW),
    'live artwork must still be shown, via resolvePlayheadMeta');
});

test('WS2: enablePlayerGestures removes its previous handlers before re-adding', () => {
  // The leak: four touch listeners on the SINGLETON $player, re-added on every
  // renderPlayer() with no removal.
  assert.ok(/surface\._srGestureHandlers/.test(GESTURES),
    'the registered handlers must be stored on the element');
  assert.ok(/if \(surface\._srGestureHandlers\) \{/.test(GESTURES),
    'the previous handlers must be checked before re-registering');
  assert.ok(/\(target \|\| surface\)\.removeEventListener\(type, fn, opts\)/.test(GESTURES),
    'the previous handlers must actually be removed by identity');
  // All four TOUCH event types must still be registered AND removed. WS4 added
  // three more terminal signals (pointercancel/visibilitychange/blur) on
  // window/document — those are covered by the WS4 stranding tests, not here,
  // which stays scoped to the touch gesture set.
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((type) => {
    assert.ok(GESTURES.includes(`type: '${type}'`),
      `${type} must be part of the registered handler set`);
  });
  // The removals must be paired with the counter so WS0 keeps telling the truth.
  const removeLoop = GESTURES.slice(GESTURES.indexOf('if (surface._srGestureHandlers)'));
  assert.ok(removeLoop.includes('metaDiagCountRemove(type)'),
    'the gesture removal must decrement the diagnostic counter');
  const addLoop = GESTURES.slice(GESTURES.indexOf('const registered = ['));
  assert.ok(addLoop.includes('metaDiagCountAdd(type)'),
    'the gesture registration must increment the diagnostic counter');
  // Order: remove the old set BEFORE storing the new one.
  assert.ok(GESTURES.indexOf('surface._srGestureHandlers) {')
    < GESTURES.indexOf('surface._srGestureHandlers = registered;'),
  'the old set must be removed before the new one is stored');
  // Handlers must be NAMED so a reference can be kept (not inline arrows).
  assert.ok(/const onTouchStart = \(e\) =>/.test(GESTURES),
    'touchstart handler must be a named binding');
  assert.ok(/const onTouchMove = \(e\) =>/.test(GESTURES),
    'touchmove handler must be a named binding');
});

test('WS2: the chevron path still works exactly as before', () => {
  // Bug 3 must not have regressed the path that already worked.
  assert.ok(EXPAND_BTN.includes('const existing = $player.querySelector'),
    'the chevron must still toggle: find an existing panel first');
  assert.ok(EXPAND_BTN.includes('existing.remove();'),
    'closing via the chevron must still remove the panel');
  assert.ok(EXPAND_BTN.includes('buildExpandPanel()'),
    'opening via the chevron must still build the panel');
  assert.ok(EXPAND_BTN.includes("$player.insertBefore(panel, $player.firstChild)"),
    'the panel must still grow upward from the player top');
  assert.ok(EXPAND_BTN.includes('enableSwipeToClose(panel, panel, fold, { axis: \'y\' })'),
    'swipe-to-fold must still be wired on the panel');
  assert.ok(EXPAND_BTN.includes("grabZone.addEventListener('touchmove'"),
    'the grab zone must still preventDefault its own scroll');
  // setExpandOpen must be defined before the click handler uses it.
  assert.ok(APP_CODE.indexOf('function setExpandOpen(open)')
    < APP_CODE.indexOf("expandBtn.addEventListener('click'"),
  'setExpandOpen must be defined before the chevron handler that calls it');
});

// =====================================================================
// Workstream 3 — mini-bar gestures, back-to-live EVIDENCE (no fix), and
// an absolute manifest id. Prompt 2026-09-27, after the owner's iPhone retest
// of WS2: back-to-live still broken, gestures flaky (pre-existing), and the
// lock screen launching a different installed web app.
// =====================================================================

const RENDER_PLAYER = stripComments(region(
  'function renderPlayer()', '// ---- player gesture engine', APP_JS));
// The minimised branch ENDS at ITS OWN trailing `return;`. Bounding it at the
// first `return;` truncates inside the mini play/pause button, before the
// gesture arming; bounding it at the later `// ---- minimize:` marker pulls in
// ~25 kB of the full-player layout. So: from the branch opener to the LAST
// `return;` before the next top-level function.
const MINI_BRANCH = (() => {
  const start = APP_JS.indexOf('if (playerMinimized) {');
  assert.notEqual(start, -1, 'minimised branch must exist');
  // The branch is followed by `$player.onclick = null;` — the first full-player
  // line after it. Everything up to there is the minimised branch.
  const end = APP_JS.indexOf('$player.onclick = null;', start);
  assert.notEqual(end, -1, 'full-player branch must follow the minimised branch');
  const slice = stripComments(APP_JS.slice(start, end));
  assert.ok(slice.includes('enablePlayerGestures($player'),
    'the minimised branch slice must reach the gesture arming');
  return slice;
})();
const FULL_GESTURE_CALL = stripComments(region(
  'enablePlayerGestures($player, {', '// ---- player gesture engine', APP_JS));

test('WS3 Part 1: gestures are armed in BOTH the minimised and full branches', () => {
  // The defect: the minimised branch returned before enablePlayerGestures(),
  // so the mini bar ran the FULL-PLAYER handlers left over from the last full
  // render — a downward drag translated $player with nothing pinning it, and
  // swipe-up called onExpand() instead of restoring.
  assert.ok(MINI_BRANCH.includes('enablePlayerGestures($player'),
    'the minimised branch must arm its own gestures before returning');
  assert.ok(FULL_GESTURE_CALL.includes('enablePlayerGestures($player'),
    'the full-player branch must still arm gestures (verified working in WS2)');
  // Exactly ONE call site in each branch, and the branches are mutually
  // exclusive (the minimised branch returns), so every render arms once.
  const callSites = (RENDER_PLAYER.match(/enablePlayerGestures\(\$player/g) || []).length;
  assert.equal(callSites, 2,
    'renderPlayer must contain exactly 2 call sites (mini branch + full branch)');
  // The branches must stay mutually exclusive, so exactly one of the two
  // gesture call sites can run per render. MINI_BRANCH is bounded just BEFORE
  // its own trailing `return;`, so that `return;` is checked in the raw slice
  // (it is a statement, not a comment, so it survives stripping).
  assert.ok(/return;/.test(MINI_BRANCH),
    'the minimised branch must still return early, keeping the two paths exclusive');
  assert.ok(MINI_BRANCH.trimEnd().endsWith('};')
    || /return;\s*\}\s*$/.test(MINI_BRANCH),
  'the minimised branch must end by returning, not by falling through');
});

test('WS3 Part 1: the minimised branch passes RESTORE, not onExpand', () => {
  const call = MINI_BRANCH.slice(MINI_BRANCH.indexOf('enablePlayerGestures($player'));
  assert.ok(/onExpand: restorePlayer/.test(call),
    'swipe up in the mini bar must restore the player, not expand a panel');
  // The full-player expand callback must not appear in the MINI branch. The
  // two branches are separate code, so the check is scoped to MINI_BRANCH.
  assert.ok(!call.includes('expandBtn.click'),
    'the mini bar must not reuse the full-player expand callback');
  // The minimised layout has no panel, so it must not build one.
  assert.ok(!MINI_BRANCH.includes('buildExpandPanel'),
    'the minimised branch must not create an expand panel');
  // Tap-to-restore must be preserved (it works and is not part of the bug).
  assert.ok(MINI_BRANCH.includes('restorePlayer()'),
    'tap-to-restore on the mini bar must be preserved');
});

test('WS3 Part 1: the mini bar is never left translated (stickDrag)', () => {
  // The displacement bug: the downward branch set an inline translateY that
  // nothing reset, so the player stayed below the screen.
  assert.ok(MINI_BRANCH.includes('stickDrag: false'),
    'the minimised branch must opt out of the finger-following drag');
  const gest = GESTURES;
  assert.ok(/stickDrag = true/.test(gest),
    'stickDrag must default to true so the full-player behaviour is unchanged');
  // The translate must be behind the flag.
  const flagAt = gest.indexOf('stickDrag');
  const moveAt = gest.indexOf("surface.style.transform = `translateY");
  assert.ok(flagAt !== -1 && moveAt !== -1 && flagAt < moveAt,
    'the stickDrag parameter must be declared before the transform is applied');
  assert.ok(/else if \(stickDrag\) \{/.test(gest),
    'the downward branch must be guarded by stickDrag, not unconditional');
  // The full-player path must still spring back: surface.style.transform = ''
  // on commit-minimize AND on spring-back must both remain.
  assert.ok(gest.includes("surface.style.transform = '';"),
    'the transform must still be cleared on release so it cannot stay displaced');
  assert.ok((gest.match(/surface\.style\.transform = '';/g) || []).length >= 2,
    'transform must be cleared on BOTH the minimize commit and the spring-back');
});

test('WS3 Part 1: the WS2 gesture leak fix survives and arms exactly once', () => {
  assert.ok(APP_CODE.includes('function enablePlayerGestures('),
    'enablePlayerGestures must still exist');
  assert.ok(GESTURES.includes('surface._srGestureHandlers'),
    'the WS2 handler-storage leak fix must survive');
  assert.ok(/\(target \|\| surface\)\.removeEventListener\(type, fn, opts\)/.test(GESTURES),
    'the previous handlers must still be removed by identity, from their target');
  assert.ok(GESTURES.includes('const onTouchStart = (e) =>'),
    'handlers must still be named bindings');
  assert.ok(GESTURES.includes('const onTouchMove = (e) =>'),
    'handlers must still be named bindings');
  // All four types still registered and removed, counters still paired.
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((t) => {
    assert.ok(GESTURES.includes(`type: '${t}'`), `${t} must still be registered`);
  });
  assert.ok(GESTURES.includes('metaDiagCountRemove(type)'),
    'the removal must still decrement the diagnostic counter');
  assert.ok(GESTURES.includes('metaDiagCountAdd(type)'),
    'the registration must still increment the diagnostic counter');
  // Removal must happen before the new set is stored (no double-arm window).
  assert.ok(GESTURES.indexOf('surface._srGestureHandlers) {')
    < GESTURES.indexOf('surface._srGestureHandlers = registered;'),
  'the old set must be removed before the new one is stored');
  // The minimised branch must not set its own stickDrag AND a duplicate call.
  assert.equal((MINI_BRANCH.match(/enablePlayerGestures\(\$player/g) || []).length, 1,
    'the minimised branch must arm gestures exactly once');
});

test('WS3 Part 2: the snapshot exposes back-to-live evidence incl. the exit reason', () => {
  // The single most valuable fact is WHICH guard the button hit. Without it a
  // third blind tweak to the target is being flown at the wrong problem.
  ['backToLive', 'lastExit', 'lastBefore', 'lastTarget', 'lastAfter', 'calls']
    .forEach((f) => {
      assert.ok(HOOK.includes(f), `the snapshot must expose backToLive.${f}`);
    });
  // The before/after captures must include the DVR window and the position.
  ['seekableStart', 'seekableEnd', 'distanceFromLiveEdge', 'currentTime']
    .forEach((f) => {
      assert.ok(HOOK.includes(f), `the snapshot must expose ${f}`);
    });
  // The active transport kind must be reported — an HLS live edge behaves
  // differently from a progressive one.
  assert.ok(HOOK.includes('transportKind'), 'the snapshot must report the transport kind');
  assert.ok(HOOK.includes('hls-native') && HOOK.includes('hls-hlsjs'),
    'transportKind must distinguish native HLS from hls.js');
  // The exit reasons must cover every bail path in seekToLive.
  ['no-track', 'no-dvr', 'no-finite-end', 'non-finite-target', 'seeked']
    .forEach((r) => {
      assert.ok(APP_CODE.includes(`'${r}'`),
        `exit reason '${r}' must be recorded so a bail can be identified`);
    });
  // After a seek, the element's ACTUAL position must be read back — the point
  // is to see whether the browser accepted the target or clamped it.
  assert.ok(/lastAfter = \{[\s\S]*accepted:/.test(APP_CODE),
    'the diagnostic must read back whether the browser accepted the seek target');
  // The seek logic itself must be UNCHANGED — this workstream gathers evidence.
  //
  // ---- WS23: the second assertion below was `end - LIVE_EDGE_TOLERANCE_S` ----
  // WS3's point was "this workstream attempts no fix". WS23 IS the authorised
  // fix, by owner decision, and it changes the target margin from the display
  // tolerance to a separate seek constant. The clamping, validation and
  // update+render sequence around it are still asserted unchanged below.
  assert.ok(/audioEl\.currentTime = target;/.test(SEEK_TO_LIVE),
    'the seek target assignment must be unchanged');
  assert.ok(SEEK_TO_LIVE.includes('Math.max(start, end - SEEK_LIVE_MARGIN_S)'),
    'WS23: the target must use the dedicated seek margin, not the display tolerance');
  assert.ok(SEEK_TO_LIVE.includes('updateSeekableState();') && SEEK_TO_LIVE.includes('renderPlayer();'),
    'the update+render sequence must be unchanged');
});

test('WS3 Part 2: the diagnostic is read-only and gated, never a new system', () => {
  // The evidence must ride the EXISTING gated snapshot, not a parallel one.
  assert.ok(HOOK.includes('backToLive'),
    'the evidence must be a field of the existing snapshot');
  assert.ok(/function srMetaDiagSnapshot\(\) \{[\s\S]*metaDiagGateOpen\(\)/.test(HOOK_CODE)
    || HOOK_CODE.includes('if (!metaDiagGateOpen()) return null;'),
  'the gated entry point must still be the only way to read the snapshot');
  // The recording itself must be unconditional but harmless: no listeners, no
  // timers, no fetches, no DOM writes.
  const d = SEEK_TO_LIVE;
  ['addEventListener', 'setTimeout', 'setInterval', 'fetch(', 'appendChild', 'innerHTML']
    .forEach((forbidden) => {
      assert.ok(!d.includes(forbidden),
        `seekToLive must not ${forbidden} — it records facts, nothing more`);
    });
  // No localStorage write from the seek path.
  assert.ok(!/localStorage\.setItem/.test(d), 'the seek path must not write storage');
});

test('WS3 Part 3: manifest id is absolute; start_url and scope stay relative', () => {
  const MANIFEST = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));
  assert.equal(MANIFEST.id, 'https://danielomazarino.github.io/Min-SR-radio/',
    'the manifest id must be absolute and stable — a relative id is resolved '
    + 'against the document URL and can collide in a subpath deployment');
  // Portability must be preserved: the app is built to work under any base path.
  assert.equal(MANIFEST.start_url, './', 'start_url must stay relative');
  assert.equal(MANIFEST.scope, './', 'scope must stay relative');
  // Nothing else may have changed.
  assert.equal(MANIFEST.name, 'Min Radio');
  assert.equal(MANIFEST.short_name, 'Min Radio');
  assert.equal(MANIFEST.display, 'standalone');
  assert.equal(MANIFEST.orientation, 'portrait');
  assert.equal(MANIFEST.background_color, '#f7f6f2');
  assert.equal(MANIFEST.theme_color, '#f7f6f2');
  assert.equal(MANIFEST.lang, 'sv');
  assert.equal(MANIFEST.icons.length, 3, 'the icons array must be unchanged');
  assert.equal(MANIFEST.icons[0].src, 'icons/icon-192.png');
});

test('WS3 Part 3: setPositionState is used safely, with no new leak', () => {
  const sync = stripComments(region(
    'function syncMediaPosition()', 'function updateMediaSession()', APP_JS));
  assert.ok(sync.includes('mediaSession.setPositionState(position)'),
    'setPositionState must actually be called');
  assert.ok(/try \{[\s\S]*setPositionState[\s\S]*\} catch/.test(sync),
    'setPositionState must be wrapped in try/catch — it throws on some platforms');
  // Live streams have no meaningful duration; episodes report the real one.
  assert.ok(/isLive \? Infinity/.test(sync),
    'live streams must report duration: Infinity');
  assert.ok(/Number\.isFinite\(audioEl\.duration\) \? audioEl\.duration/.test(sync),
    'episodes must report their real duration');
  assert.ok(sync.includes('playbackRate'), 'playbackRate must be reported');
  assert.ok(/typeof mediaSession\.setPositionState === 'function'/.test(sync),
    'setPositionState must be feature-detected');

  // The refresh handle must follow the established store-and-clear pattern.
  assert.ok(sync.includes('audioEl._srPosTimer'),
    'the refresh handle must be stored on the audioEl singleton');
  const start = stripComments(region(
    'function startPositionSync()', 'function stopPositionSync()', APP_JS));
  assert.ok(/if \(!mediaSession \|\| audioEl\._srPosTimer\) return;/.test(start),
    'startPositionSync must be idempotent — never create a second timer');
  assert.ok(start.includes('setInterval'), 'the refresh must use an interval');
  const stop = stripComments(region(
    'function stopPositionSync()', 'function updateMediaSession()', APP_JS));
  assert.ok(stop.includes('clearInterval(audioEl._srPosTimer)'),
    'the interval must be cleared');
  assert.ok(stop.includes('audioEl._srPosTimer = null'),
    'the handle must be nulled so it cannot be cleared twice');
  // Cleared on stop, explicitly — not only as a side effect.
  const close = stripComments(region(
    'function stopAndClosePlayer()', 'audioEl.addEventListener', APP_JS));
  assert.ok(close.includes('stopPositionSync()'),
    'stopAndClosePlayer must explicitly stop the position refresh');
  // And the no-track branch of updateMediaSession must stop it too — otherwise
  // the interval keeps ticking against a dead element.
  const ums = stripComments(region(
    'function updateMediaSession()', '// ---- buffering', APP_JS));
  assert.ok(/if \(!cur\) \{[\s\S]*stopPositionSync\(\);[\s\S]*mediaSession\.metadata = null;/.test(ums),
    'the no-track branch must stop the refresh before clearing metadata');
});

test('WS3 Part 3: the verified-correct MediaSession code is untouched', () => {
  // The setActionHandler implementations and the withdrawal logic were verified
  // correct on the owner's device and must not change.
  const handlers = stripComments(region(
    "mediaSession.setActionHandler('play'", 'function updateMediaSession()', APP_JS));
  assert.ok(handlers.includes("setActionHandler('play'"), 'play handler must remain');
  assert.ok(handlers.includes("setActionHandler('pause'"), 'pause handler must remain');
  assert.ok(handlers.includes("setActionHandler('stop'"), 'stop handler must remain');
  assert.ok(handlers.includes("setActionHandler('seekbackward'"), 'seekbackward must remain');
  assert.ok(handlers.includes("setActionHandler('seekforward'"), 'seekforward must remain');
  // Withdrawal logic unchanged: metadata nulled and state 'none' when no track.
  assert.ok(/if \(!cur\) \{[\s\S]*mediaSession\.metadata = null;[\s\S]*playbackState = 'none'/.test(
    stripComments(region('function updateMediaSession()', '// ---- buffering', APP_JS))),
  "the withdrawal branch must still null metadata and set 'none'");
});

// =====================================================================
// Workstream 4 — go-to-live on the skip button, ±15 s upper clamp, removal
// of the invisible 12 % bar zone, and the transform stranding fix.
//
// Owner intent (2026-09-27): there must be NO separate "Till Direkt" button —
// to save screen space the forward skip button IS the live button once the
// playhead is inside the current programme. That fallback was never
// implemented; the button was hidden instead, leaving no way back to live.
// =====================================================================

const SEEK_BY = stripComments(region('function seekBy(deltaSeconds)', '// Fetch today', APP_JS));
const SYNC_NEXT = stripComments(region(
  'const syncNext = () => {', 'if (prevEv) syncNext();', APP_JS));
const DVR_BAR = stripComments(region(
  "class: 'seek-bar dvr-bar'", '// Drag state', APP_JS));

test('WS4 Item 1: the skip button becomes "Till Direkt" when behind live with no next programme', () => {
  // The gap: `if (nextEv && behindLive) {...} else { hide }` — so behind-live
  // with no later programme hid the button, leaving no way back to live.
  assert.ok(/else if \(behindLive\)/.test(SYNC_NEXT),
    'there must be a behind-live branch that is independent of nextEv');
  assert.ok(SYNC_NEXT.includes("nextProgramBtn.title = 'Till Direkt'"),
    "the fallback button must be titled 'Till Direkt'");
  // WS6: the handler is now a named, tagged function so the snapshot can read
  // the real wiring (metaDiagNextProgram derives `mode` from `_srMode`). It
  // must still be a call to seekToLive() with nothing else in between.
  // WS7 added press recording, so the handler body is now two statements.
  // The call it makes is unchanged.
  assert.ok(/const goLive = \(\) => \{\s*recordSkipPress\(null\);\s*seekToLive\(\);\s*\};/.test(SYNC_NEXT),
    'the fallback must still call seekToLive()');
  assert.ok(/goLive\._srMode = 'direct';/.test(SYNC_NEXT),
    'the fallback handler must be tagged so the snapshot can see it is the live path');
  assert.ok(/nextProgramBtn\.onclick = goLive;/.test(SYNC_NEXT),
    'the fallback must be the handler actually attached to the button');
  assert.ok(/nextProgramBtn\.style\.display = '';/.test(
    SYNC_NEXT.slice(SYNC_NEXT.indexOf('else if (behindLive)'))),
  'the fallback button must be VISIBLE, not hidden');
  // The aria-label must change too, so a screen reader announces the real action.
  assert.ok(SYNC_NEXT.includes("nextProgramBtn.setAttribute('aria-label', 'Till Direkt')"),
    "the fallback must set aria-label 'Till Direkt'");
  // The programme-skip case must be unchanged.
  assert.ok(/seekToProgramTime\(nextEv\.startMs\)/.test(SYNC_NEXT),
    'the next-programme case must still seek to the programme start');
  assert.ok(SYNC_NEXT.includes("nextProgramBtn.title = nextEv.title || 'Nästa program'"),
    'the programme-skip title must be unchanged');
  assert.ok(SYNC_NEXT.includes("nextProgramBtn.setAttribute('aria-label', 'Till nästa programs start')"),
    "the skip case must set its own aria-label, distinct from 'Till Direkt'");
  // NOT behind live must still hide it — no button that does nothing.
  const hideBranch = SYNC_NEXT.slice(SYNC_NEXT.lastIndexOf('else {'));
  assert.ok(hideBranch.includes("nextProgramBtn.style.display = 'none'"),
    'the button must still be hidden when already live');
  assert.ok(!hideBranch.includes('seekToLive'),
    'the hidden branch must not wire a live action');
  // The owner explicitly rejected a separate live button.
  assert.ok(!/class: 'player-live-label'/.test(APP_CODE),
    'no separate live button may be added');
  // behindLive computation must be untouched.
  assert.ok(/cur\.atLiveEdge === false/.test(SYNC_NEXT) && /\> 60/.test(SYNC_NEXT),
    'the behindLive computation must be unchanged');
});

test('WS4 Item 2: seekBy clamps to the live edge as well as the window start', () => {
  // The defect: only the lower bound was clamped, so a forward step near the
  // live edge produced a target BEYOND seekableEnd — the buffered boundary,
  // which Safari rejects or clamps silently.
  assert.ok(/seekableEnd - LIVE_EDGE_TOLERANCE_S/.test(SEEK_BY),
    'the upper bound must sit behind the edge by LIVE_EDGE_TOLERANCE_S');
  assert.ok(/Math\.min\(upper, Math\.max\(start,/.test(SEEK_BY),
    'the final target must be clamped at BOTH ends');
  // The lower clamp must survive.
  assert.ok(/const start = Number\.isFinite\(cur\.seekableStart\) \? cur\.seekableStart : 0;/.test(SEEK_BY),
    'the lower bound must still default to 0 when seekableStart is unusable');
  // Without a finite seekableEnd there must be NO upper clamp (non-DVR safety).
  assert.ok(/: Infinity;/.test(SEEK_BY),
    'a non-finite seekableEnd must leave the upper bound open');
  // Still a seek only.
  ['play(', 'pause(', 'load(', 'hlsAttach(', 'hlsDetach('].forEach((f) => {
    assert.ok(!SEEK_BY.includes(f), `seekBy must stay a seek — no ${f}`);
  });
  assert.ok(!/audioEl\.src\s*=/.test(SEEK_BY), 'seekBy must not reassign the source');
  // The step size and the guard must be untouched.
  assert.ok(/if \(!cur \|\| !cur\.dvrAvailable\) return;/.test(SEEK_BY),
    'the dvrAvailable guard must survive');
  assert.ok(/updateSeekableState\(\);/.test(SEEK_BY) && /renderPlayer\(\);/.test(SEEK_BY),
    'the update+render sequence must remain');
});

test('WS4 Item 3: the invisible 12 % back-to-live hit zone is gone', () => {
  assert.ok(!/0\.88/.test(APP_CODE), 'the frac >= 0.88 comparison must be gone');
  assert.ok(!/bar\.addEventListener\('click'/.test(APP_CODE),
    'the DVR bar must no longer carry a click-to-live handler');
  // No comment may still claim the zone CURRENTLY exists. A comment saying it
  // was removed is correct and required — a comment describing behaviour that
  // no longer exists is itself a defect.
  const claimsZoneExists = /12 ?%(?! of the bar used to be an INVISIBLE)/.test(APP_JS)
    && !/The right 12 % of the bar used to be an INVISIBLE/.test(APP_JS);
  assert.ok(!claimsZoneExists,
    'no comment may claim the right-edge zone still exists');
  assert.ok(!/tapping the bar's right edge returns to live/.test(APP_JS),
    'the stale comment claiming the bar edge returns to live must be corrected');
  assert.ok(/FORWARD SKIP button doubles as/.test(APP_JS),
    'the replacement comment must point at the real affordance');
  // Drag-to-seek and its furniture must be untouched.
  assert.ok(APP_CODE.includes('seekToWindowFraction'), 'drag-to-seek must remain');
  assert.ok(APP_CODE.includes("class: 'seek-fill'") && APP_CODE.includes("class: 'seek-thumb'"),
    'the fill and thumb must remain');
  assert.ok(APP_CODE.includes("class: 'player-time'"), 'the clock label must remain');
  assert.ok(APP_CODE.includes('pointerdown') && APP_CODE.includes('pointermove'),
    'the pointer-drag handlers must remain');
  // The affordance now lives on a visible, labelled control.
  assert.ok(APP_CODE.includes("'aria-label': 'Till nästa programs start'"),
    'the skip button must still be labelled at creation');
});

test('WS4 Item 4: the player transform cannot be stranded', () => {
  // The defect: finish() opened with `if (axis !== 'y') return;`, so a
  // touchend that never arrived (iOS steals the gesture) left the inline
  // translateY in place with no way to pin the player back.
  const gest = GESTURES;
  // ONE shared reset, used by every terminal path.
  assert.ok(/const releaseDragStyles = \(\) => \{/.test(gest),
    'there must be a single shared reset helper');
  assert.ok(/const releaseDragStyles = \(\) => \{[\s\S]*?surface\.style\.transform = '';/.test(gest),
    'the shared reset must clear the inline transform');
  // finish() must call it BEFORE the axis check, not after.
  const finish = gest.slice(gest.indexOf('const finish = (e) => {'));
  const resetAt = finish.indexOf('releaseDragStyles()');
  const axisGuard = finish.indexOf("if (axis !== 'y') return;");
  assert.ok(resetAt !== -1, 'finish() must call the reset');
  assert.ok(axisGuard !== -1, 'the axis guard must still exist');
  assert.ok(resetAt < axisGuard,
    'the reset must run BEFORE the axis early-return, or it is still reachable-but-skipped');
  // The three extra terminal signals must exist and reach the reset.
  [['onPointerCancel', 'pointercancel'], ['onHidden', 'visibilitychange'], ['onBlur', 'blur']]
    .forEach(([fnName, type]) => {
      assert.ok(gest.includes(`const ${fnName} = `), `${fnName} handler must exist`);
      assert.ok(gest.includes(`type: '${type}'`), `${type} must be registered`);
      assert.ok(new RegExp(`const ${fnName} = \\(\\)[\\s\\S]*?releaseDragStyles\\(\\);`).test(gest),
        `${fnName} must call the shared reset`);
    });
  // They must be bound on window/document so they fire when the finger leaves.
  assert.ok(/type: 'pointercancel'[^\n]*target: window/.test(gest),
    'pointercancel must be bound on window');
  assert.ok(/type: 'visibilitychange'[^\n]*target: document/.test(gest),
    'visibilitychange must be bound on document');
  assert.ok(/type: 'blur'[^\n]*target: window/.test(gest),
    'blur must be bound on window');
  // Thresholds must NOT have been tuned — that would be a guess, and a
  // threshold-shaped fix already failed on the owner's device.
  assert.ok(/const THRESHOLD = 0\.22;/.test(gest), 'THRESHOLD must be unchanged at 0.22');
  assert.ok(/window\.innerHeight \* 0\.5/.test(gest), 'the drag multiplier must be unchanged');
  // renderPlayer must still heal a stranded player, early and unconditional.
  const rpTop = APP_JS.slice(APP_JS.indexOf('function renderPlayer()'));
  assert.ok(rpTop.indexOf("$player.style.transform = '';") < rpTop.indexOf('const live ='),
    "renderPlayer must clear the transform before it branches on the layout");
  // The gesture bookkeeping must stay accurate for the new window/document
  // handlers, or the WS0 counters would drift.
  assert.ok(/\(target \|\| surface\)\.addEventListener\(type, fn, opts\)/.test(gest),
    'registration must honour the per-handler target');
  assert.ok(/\(target \|\| surface\)\.removeEventListener\(type, fn, opts\)/.test(gest),
    'removal must honour the per-handler target');
  assert.ok(gest.includes('metaDiagCountAdd(type)') && gest.includes('metaDiagCountRemove(type)'),
    'counters must stay paired for every registered handler');
});

test('WS4: the _srNextUpd leak bookkeeping is intact', () => {
  // WS4 touched syncNext's BODY (the branch logic) but not its lifecycle.
  assert.ok(APP_CODE.includes('if (audioEl._srNextUpd)'),
    'the previous syncNext must still be removed behind a property guard');
  assert.ok(APP_CODE.includes("audioEl.removeEventListener('timeupdate', audioEl._srNextUpd)"),
    'syncNext must still be removed by identity');
  assert.ok(APP_CODE.includes('audioEl._srNextUpd = syncNext;'),
    'the new syncNext must still be stored');
  assert.ok(APP_CODE.includes('audioEl._srNextUpd = null;'),
    'the property must still be cleared so it cannot be removed twice');
  // Guards and helpers WS4 was told not to touch.
  assert.ok(APP_CODE.includes('function programBoundary('), 'programBoundary must survive');
  assert.ok(APP_CODE.includes('function seekToProgramTime('), 'seekToProgramTime must survive');
  assert.ok(/const LIVE_EDGE_TOLERANCE_S = 10;/.test(APP_CODE),
    'LIVE_EDGE_TOLERANCE_S must be unchanged at 10');
  assert.ok(APP_CODE.includes('function updateSeekableState('), 'updateSeekableState must survive');
  assert.ok(APP_CODE.includes('function setExpandOpen(open)'), 'the WS2 setExpandOpen must survive');
  assert.ok(APP_CODE.includes('const live = state.current || cur;'),
    'the WS2 live-state panel fix must survive');
  const MANIFEST_WS4 = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));
  assert.equal(MANIFEST_WS4.id, 'https://danielomazarino.github.io/Min-SR-radio/',
    'the WS3 absolute manifest id must be untouched');
});

// =====================================================================
// Workstream 5 — player layout. PRESENTATION ONLY.
//   Item 1: channel + programme moved ABOVE the player (out of .player-meta)
//   Item 2: song line moved BELOW the player content, ABOVE the seek row
//   Item 3: expand chevron moved to the right, level with the close button
//   Item 4: overall player height reduced
//   Item 5: the "Data från Sveriges Radio" footer removed
// The five class names below are load-bearing: paintProgramTitle(),
// paintNowPlaying() and the WS0 snapshot all query them inside $player.
// =====================================================================

const STYLES_WS5 = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const RENDER_WS5 = stripComments(region('function renderPlayer()', '// ---- player gesture engine', APP_JS));
const META_WS5 = (() => {
  const live = RENDER_WS5.slice(RENDER_WS5.indexOf("const meta = el('div', { class: 'player-meta' }"));
  return live.slice(0, live.indexOf(';'));
})();

test('WS5 Item 1: channel and programme moved above the player, names intact', () => {
  // Slice the LIVE meta construction. Bounding it on the next comment is not
  // enough: a mutation that re-adds .player-title/.player-sub can sit before
  // that marker and escape the slice entirely (which is exactly how mutation
  // M1 passed when it should not have).
  const metaLive = RENDER_WS5.slice(
    RENDER_WS5.indexOf("const meta = el('div', { class: 'player-meta' }"));
  const metaDecl = metaLive.slice(0, metaLive.indexOf(';'));
  // They must no longer be inside .player-meta ...
  // NB: match the class ATTRIBUTE, not a dotted selector. The source reads
  // `class: 'player-title'`, so a regex requiring a leading dot can never
  // match and the assertion passes vacuously.
  assert.ok(!/class: 'player-title'/.test(metaDecl),
    '.player-title must NOT be inside .player-meta any more');
  assert.ok(!/class: 'player-sub'/.test(metaDecl),
    '.player-sub must NOT be inside .player-meta any more');
  // WS18 SUPERSEDES the WS16 placement. The owner corrected it on the real
  // iPhone: the LIVE / "−N min" pill must sit at the RIGHT-HAND END of the
  // SONG + artist row (`.now-playing-line`), not on the channel-name row. On a
  // talk channel the channel-name row holds only the channel, so the pill read
  // as if it described the channel rather than the playhead.
  //
  // So the meta row now carries the identity name ALONE, and the pill has moved
  // to `.player-time-row` alongside the song line. The two rows are checked
  // separately, and the negative assertion is the point of this test: a pill
  // left in the meta row would still be *visible*, so only a structural check
  // catches the regression.
  const rowDecl = stripComments(region("const metaRowTop = el('div'", 'const meta = el(', APP_JS));
  assert.ok(!/isLive \? mode : null/.test(rowDecl),
    '.player-meta-row must NOT carry the time state any more (WS18: it moved to the song row)');
  assert.ok(/identityName/.test(rowDecl),
    '.player-meta-row must still carry the identity name (WS18)');
  const timeRowDecl = stripComments(region("const timeRow = live", 'if (timeRow)', APP_JS));
  assert.ok(/songLine/.test(timeRowDecl) && /mode/.test(timeRowDecl),
    '.player-time-row must carry BOTH the song line and the time state (WS18)');
  // The row must be live-only, and the podcast must keep the bare song line --
  // a podcast has no time state, so wrapping it would add a useless box.
  assert.ok(/live\s*\?\s*el\('div', \{ class: 'player-time-row' \}/.test(timeRowDecl),
    '.player-time-row must be rendered for a live channel only (WS18)');
  const appendDecl = stripComments(region('$player.appendChild(headerLine)', 'if (seekRow)', APP_JS));
  assert.ok(/if \(timeRow\) \$player\.appendChild\(timeRow\)/.test(appendDecl)
    && /else if \(songLine\) \$player\.appendChild\(songLine\)/.test(appendDecl),
    'live must append the time row, non-live the bare song line (WS18)');
  // The song row must come AFTER the player row and BEFORE the seek row, or the
  // pill would sit between the controls and the seek bar instead of under them.
  assert.ok(appendDecl.indexOf('timeRow') < appendDecl.indexOf('songLine') + 1,
    'the time row must replace the song line position, not be appended twice (WS18)');
  // ... but must still exist, with their ORIGINAL class names, in a header
  // line appended to $player.
  //
  // ---- WS19 SUPERSEDES the `.player-title` half of this requirement ----
  // The owner (screenshot): "remove the Bold duplicate information top left ...
  // it must be the same exactly as we have mapped to just above the pill
  // mp3 96". The channel name was printed twice -- bold in the header, then
  // again in the meta row above the quality pill.
  //
  // `.player-sub` is LOAD-BEARING (paintProgramTitle writes into it via
  // $player.querySelector, and the WS0 snapshot reads it) so it stays.
  // `.player-title` is removed from the HEADER ONLY -- the mini-bar keeps its
  // own, because the minimised bar has no meta row and would otherwise have no
  // identity at all. The header is asserted to have exactly ONE .player-sub
  // now, which is the assertion that would catch a re-introduction.
  const header = stripComments(region('const headerLine = el(', 'const songLine', APP_JS));
  assert.ok(!header.includes("class: 'player-title'"),
    'the bold .player-title must NOT be in the header any more (WS19: it duplicated the meta row)');
  assert.ok(header.includes("class: 'player-sub'"),
    '.player-sub must keep its original class name');
  // ---- WS19: the count is now 2 LITERALS but still 1 ELEMENT ----
  // The header is a single ternary, so exactly one arm renders and there is
  // still exactly one `.player-sub` in the DOM. A literal count cannot express
  // that once there are two arms, so the STRUCTURE is asserted instead: the
  // two occurrences must be the two arms of ONE `live ? ... : ...`, which is
  // what makes the runtime count 1. Asserting `count === 1` here would be a
  // proxy that fails on a correct implementation, and asserting `count === 2`
  // alone would still pass if a THIRD unconditional copy were added beside the
  // ternary -- the exact duplication this guards.
  assert.strictEqual((header.match(/class: 'player-sub'/g) || []).length, 2,
    'the header must have exactly two .player-sub literals: the two arms of one ternary (WS19)');
  assert.ok(/live\s*\n?\s*\? el\('div', \{ class: 'player-sub'/.test(header)
    && /:\s*el\('div', \{ class: 'player-sub'/.test(header),
    'both .player-sub literals must be the arms of ONE live ternary, so only one renders (WS19)');
  assert.ok(!/,\s*el\('div', \{ class: 'player-sub'/.test(header),
    'no unconditional third .player-sub may sit beside the ternary (WS19)');
  // The programme must still reach the car/lock screen from the header line's
  // own expression, whichever branch supplies it.
  assert.ok(/_srProgramTitle/.test(header),
    'the live branch must still show the resolved programme in the header');
  // ---- WS20: the non-live branch is the EPISODE NAME, not the podcast name ----
  // The owner (attachment 2): "i wanted the episode name to stay there where it
  // was ... never said you should take it away and instead implement a double
  // dip the info we already have above the mp3 pill."
  //
  // WS19 put `cur.programName` here, which is the PODCAST name, so the header
  // read "P3 Soul" while the meta row below ALSO read "P3 Soul" -- the exact
  // double dip the owner is describing, and my own regression. Before WS19 the
  // header had no podcast branch at all, because the episode name lived in the
  // bold `.player-title` that WS19 removed; deleting that cell deleted the only
  // place the episode name was shown.
  //
  // `cur.title` is the episode name on an episode and the channel name on a
  // live track, so it is the SAME single expression WS15b used.
  assert.ok(/cur\.title/.test(header),
    'a podcast header cell must show the EPISODE name, i.e. cur.title (WS20)');
  assert.ok(!/cur\.programName/.test(header),
    'the podcast NAME belongs in the meta row only; in the header it is a double dip (WS20)');
  assert.ok(/class: 'player-header'/.test(header),
    'the header line needs its own container class');
  // Appended to $player so paintProgramTitle() ($player.querySelector('.player-sub'))
  // and the WS0 snapshot still find it.
  assert.ok(/\$player\.appendChild\(headerLine\);/.test(RENDER_WS5),
    'the header line must be appended to $player');
  assert.ok(RENDER_WS5.indexOf('$player.appendChild(headerLine)')
    < RENDER_WS5.indexOf('$player.appendChild(el(\'div\', { class: \'player-row\''),
  'the header must be appended BEFORE the player row, so it renders above it');
  // The paint functions must still be able to reach it.
  assert.ok(APP_CODE.includes("querySelector('.player-sub')"),
    'paintProgramTitle must still be able to query .player-sub');
});

test('WS5 Item 2: the song line sits below the player and above the seek row', () => {
  // Same lesson as Item 1: slice the LIVE statement, not a comment-bounded region.
  const metaLive2 = RENDER_WS5.slice(
    RENDER_WS5.indexOf("const meta = el('div', { class: 'player-meta' }"));
  const metaDecl2 = metaLive2.slice(0, metaLive2.indexOf(';'));
  assert.ok(!/class: 'now-playing-line'/.test(metaDecl2),
    '.now-playing-line must NOT be inside .player-meta any more');
  // WS12 Part C LIFTS the live-only gate on purpose. It used to be
  // `const songLine = live ? el(...) : null`, so for an EPISODE the element was
  // never created and paintNowPlaying()'s `if (line)` was false -- there was
  // nothing to paint into, which is why a podcast showed no song in the mid
  // player while the expanded panel showed one. The element is now created
  // unconditionally and left EMPTY when there is no song.
  const song = stripComments(region('const songLine = el(', '$player.appendChild(headerLine)', APP_JS));
  assert.ok(song.includes("class: 'now-playing-line'"),
    'the song line must keep its original class name');
  assert.ok(song.includes("'aria-live': 'polite'"),
    'aria-live="polite" must be preserved');
  assert.ok(!/const songLine = live\s*\?/.test(song),
    'the song line must NOT be gated on live -- an episode needs it too');
  // The mini-bar's song line lost the same gate, for the same reason.
  const miniSong = stripComments(region("const mini = el('div', { class: 'player-mini' }", ');', APP_JS));
  assert.ok(/class: 'now-playing-line'/.test(miniSong),
    'the mini-bar song line must be created for episodes too');
  assert.ok(!/live \? el\('div', \{ class: 'now-playing-line'/.test(miniSong),
    'the mini-bar song line must NOT be gated on live');
  // The "no song" case must still take no vertical space, or an always-present
  // element becomes a permanent gap on talk radio and between podcast tracks.
  assert.ok(STYLES_WS5.includes('.now-playing-line:empty { display: none; }'),
    'an empty song line must still collapse the row');
  // The mini-bar's own geometry must be unaffected.
  assert.ok(/\.player-mini \.now-playing-line \{ margin-left: 0; \}/.test(STYLES_WS5),
    'the mini-bar song line must not inherit the full player indent');
  // Order in the assembled player: row -> song -> seekRow.
  const order = RENDER_WS5.slice(RENDER_WS5.indexOf('$player.appendChild(headerLine)'));
  const rowAt = order.indexOf("$player.appendChild(el('div', { class: 'player-row'");
  const songAt = order.indexOf('$player.appendChild(songLine)');
  const seekAt = order.indexOf('$player.appendChild(seekRow)');
  assert.ok(rowAt !== -1 && songAt !== -1 && seekAt !== -1,
    'row, song line and seek row must all be appended');
  assert.ok(rowAt < songAt && songAt < seekAt,
    'the song line must be BELOW the player row and ABOVE the seek row');
  // The :empty / .has-song CSS collapse behaviour must survive.
  assert.ok(STYLES_WS5.includes('.now-playing-line:empty { display: none; }'),
    'an empty song line must still collapse the row');
  assert.ok(STYLES_WS5.includes('.now-playing-line.has-song'),
    'the has-song state must still be styled');
});

test('WS5 Item 3: the chevron is on the right, aligned by flexbox with close', () => {
  // SUPERSEDED BY WS5b, then WS11a, then restored by WS12, then superseded by
  // WS13, then CORRECTED BY WS14. The trail is the whole lesson, so it stays:
  //   WS11a moved the buttons to the transport row, authorised by a brief that
  //   mis-transcribed the owner ("on the same row as the transport buttons").
  //   WS12 moved them back up on the owner's own words: "they should be
  //   **above**" -- and recorded the 7-button measurement that caused it.
  //   WS13 moved them DOWN again, reading a comma-less "not to the right on a
  //   row above the title to mimic the ui for the minimised player" as a fresh
  //   instruction.
  //   WS14 moves them back UP, right-grouped, because WS13 re-broke a defect
  //   WS12 had already measured and fixed.
  //
  // THE WS13 PREMISE WAS WRONG, and the reason is not a missing comma. The
  // owner reported the cramping on their phone; the brief explained it as a
  // transcription error in the owner's sentence. It was not. WS12's own code
  // comment already held the measurement: "with the DVR state (7 buttons) meta
  // went to 0px, the row overflowed 388 > 358". The right answer to that
  // report was to restore the arrangement WS12 had already justified -- not to
  // re-derive the instruction from a clause that had lost a comma three
  // revisions earlier. A later sentence sounding like a command is not a
  // reason to discard a measurement in your own codebase.
  //
  // What survives from WS5b is the REQUIREMENT, not the arrangement: the
  // buttons exist, they are not on a row of their own, and the header's text
  // column still starts on the artwork's right edge.
  const header = stripComments(region(
    'const headerSpacer = el(',
    '$player.appendChild(headerLine);', APP_JS));
  // The header holds the SPACER and BOTH buttons, chevron before close.
  assert.ok(/player-header-spacer/.test(header),
    'the header must keep a spacer in the close button\'s place');
  assert.ok(/expandBtn/.test(header),
    'the expand chevron must be built into the header row (WS14)');
  assert.ok(/closeBtn/.test(header),
    'the close button must be built into the header row (WS14)');
  // Order is the minimised bar's: text, then chevron, then close.
  assert.ok(header.indexOf('expandBtn') < header.indexOf('closeBtn'),
    'the order must read ... text - chevron - close, like the mini-bar');
  // And NEITHER is on the transport row any more.
  const controlsRow = stripComments(region('const controls = el(', '// Wire program-skip buttons', APP_JS));
  assert.ok(!/controls\.appendChild\(expandBtn\)/.test(controlsRow),
    'the chevron must NOT be on the transport row (WS14)');
  assert.ok(!/controls\.appendChild\(closeBtn\)/.test(controlsRow),
    'the close button must NOT be on the transport row (WS14)');
  // EXACTLY ONE element may occupy the artwork column. Both the button and the
  // spacer live in the stylesheet/source vocabulary, so the guard is that the
  // header does not carry the button -- asserted above.
  assert.ok(!/class: 'player-header-btns'/.test(APP_CODE),
    'the WS5 standalone button row must be gone');
  // Alignment must come from flexbox, not from pixel offsets. The CSS lives in
  // styles.css -- slicing it out of app.js finds nothing.
  const row = stripComments(region('.player-header {', '.player-row {', STYLES_WS5));
  assert.ok(/display: flex/.test(row), 'the header row must be a flex container'
);
  assert.ok(!/top:|margin-top: \d|translateY\(/.test(row),
    'vertical alignment must NOT use hard-coded offsets');
  // The chevron rotation behaviour must survive, for BOTH buttons using the class.
  assert.ok(STYLES_WS5.includes('.player-expand-btn.open { transform: rotate(180deg); }'),
    'the open rotation must survive');
  // setExpandOpen must still find the button inside $player.
  assert.ok(/function setExpandOpen\(open\) \{[\s\S]*?querySelector\('\.player-expand-btn'\)/.test(APP_CODE),
    'setExpandOpen must still query .player-expand-btn inside $player');
  assert.ok(RENDER_WS5.indexOf("$player.appendChild(el('div', { class: 'player-row'")
    < RENDER_WS5.indexOf('$player.appendChild(songLine)'),
  'the player row must be assembled before the song line');
});

test('WS5 Item 5: the footer attribution is gone, the About overlay keeps it', () => {
  // The footer must be gone from the CODE (not merely from the DOM).
  assert.ok(!/class: 'attribution'/.test(APP_CODE),
    'the .attribution paragraph must be removed from app.js');
  assert.ok(!/\$\w+\.appendChild\(el\('p', \{ class: 'attribution'/.test(APP_CODE),
    'no element may still append the attribution footer');
  // The dead CSS must be gone too.
  assert.ok(!/\.attribution \{/.test(STYLES_WS5), 'the .attribution rules must be removed');
  assert.ok(!/\.attribution a \{/.test(STYLES_WS5), 'the .attribution link rule must be removed');
  // The About overlay must KEEP its own attribution and the disclaimer.
  const about = stripComments(region("'Datakällor & villkor'", 'about.appendChild(body)', APP_JS));
  assert.ok(about.includes('Data från '),
    "the About overlay's attribution must remain");
  assert.ok(about.includes('sverigesradio.se'),
    'the About overlay must keep its Sveriges Radio link');
  assert.ok(about.includes('Appen är oberoende av och inte utgiven av Sveriges Radio.'),
    'the independent-app disclaimer must remain in the About overlay');
});

test('WS5 Item 4: the layout CSS exists and narrow viewports are handled', () => {
  assert.ok(STYLES_WS5.includes('.player-header {'), 'the header line must be styled');
  assert.ok(STYLES_WS5.includes('.player-header .player-title'),
    'the header title must be styled without changing the base class');
  assert.ok(STYLES_WS5.includes('.player-header .player-sub'),
    'the header programme must be styled without changing the base class');
  // The narrow-viewport query must still exist and cover the new header.
  assert.ok(STYLES_WS5.includes('@media (max-width: 340px)'),
    'the 340px media query must survive');
  const narrow = STYLES_WS5.slice(STYLES_WS5.indexOf('@media (max-width: 340px)'));
  // WS5b revised HOW this is handled: instead of shrinking the header's own
  // gap, the media query tightens the shared --player-gap, which moves the
  // header, the pills and the song line together. The requirement that
  // survives is that the narrow query still reaches the header's column.
  // The 340px query tightens --player-gap on .player. That single change moves
  // the header, the pills and the song line together, so the block does not
  // need to name .player-header at all.
  assert.ok(/\.player\s*\{[^}]*--player-gap/.test(narrow),
    'the header column must still be handled at 340px so it cannot cramp');
  // Legibility must not be bought back with font sizes.
  // WS15: the pattern is anchored to `\{` so it can only match a real RULE,
  // not prose. It previously used `[^{]*\{`, which matched ACROSS comment text,
  // so a CSS comment mentioning `.player-header` and a font size was enough to
  // fail the guard. That is the comment-pattern trap in the direction where a
  // comment causes a FALSE FAILURE. The requirement is unchanged: no header
  // rule may shrink its own font size.
  assert.ok(!/\.player-header[^{}]*\{[^}]*font-size:\s*1[01](\.\d)?px/.test(stripComments(STYLES_WS5)),
    'the header must not shrink the base font sizes to claw back space');
  // WS15: the podcast name must CLIP, never wrap. `.player-meta` is
  // `flex: 1 1 0%` with `min-width: 0`, so a wrap would raise the row height
  // and move the quality pill below it -- the WS9/WS11/WS12 regression class.
  const podName = stripComments(region('.player-podcast-name {', '.player-quality {', STYLES_WS5));
  assert.ok(/white-space: nowrap/.test(podName),
    'the podcast name must not wrap, it must clip');
  assert.ok(/text-overflow: ellipsis/.test(podName),
    'the podcast name must ellipsize rather than wrap');
  // The song line must still be its own row below the player.
  assert.ok(STYLES_WS5.includes('.now-playing-line {'),
    'the song line must still be styled');
});

test('WS5: no out-of-scope behaviour function was changed', () => {
  // WS5 is presentation-only. These must all still exist, untouched.
  ['function seekBy(', 'function seekToLive(', 'function seekToProgramTime(',
    'function programBoundary(', 'function updateSeekableState(',
    'function enablePlayerGestures(', 'function minimizePlayer(', 'function restorePlayer(',
    'function setExpandOpen(', 'const renderSongView = () => {']
    .forEach((f) => {
      assert.ok(APP_CODE.includes(f), `${f} must still exist`);
    });
  // WS4 behaviour must be intact.
  assert.ok(APP_CODE.includes('else if (behindLive)'), 'the WS4 go-to-live branch must survive');
  // WS6 named the handler so the snapshot can read its wiring; the branch and
  // the call it makes are unchanged.
  assert.ok(/const goLive = \(\) => \{\s*recordSkipPress\(null\);\s*seekToLive\(\);\s*\};/.test(APP_CODE)
    && APP_CODE.includes('nextProgramBtn.onclick = goLive;'),
  'the WS4 go-to-live wiring must survive');
  assert.ok(APP_CODE.includes('Math.min(upper, Math.max(start,'),
    'the WS4 ±15s upper clamp must survive');
  assert.ok(!/0\.88/.test(APP_CODE), 'the removed 12% hit zone must stay removed');
  assert.ok(APP_CODE.includes('const releaseDragStyles = () => {'),
    'the WS4 guaranteed transform reset must survive');
  assert.ok(APP_CODE.includes('const LIVE_EDGE_TOLERANCE_S = 10;'),
    'LIVE_EDGE_TOLERANCE_S must be unchanged');
  // The class names other functions depend on must not have been renamed.
  ['player-title', 'player-sub', 'now-playing-line', 'player-expand-btn', 'player-btn-close']
    .forEach((c) => {
      assert.ok(APP_CODE.includes(c), `.${c} must still exist (paint/diagnostics depend on it)`);
    });
  // The WS0 gate must be untouched.
  assert.ok(APP_CODE.includes('function metaDiagGateOpen()'), 'the WS0 gate must survive');
  assert.ok(APP_CODE.includes("localStorage.getItem(META_DIAG_FLAG)"),
    'the WS0 gate must still read its flag');
});

// ---------------------------------------------------------------------------
// WS5b - layout correction after the owner saw WS5 on a real iPhone
// ---------------------------------------------------------------------------

test('WS5b Item 1: the header, the pills and the song line share ONE left edge',
() => {
  // The column is derived from the artwork width and the row gap, on .player,
  // and reused. Three separate `padding-left: 56px` literals would satisfy a
  // screenshot and still drift apart the moment one of them is edited, so the
  // guard is on the SHARED CUSTOM PROPERTY, not on any pixel value.
  const playerBlock = stripComments(region('.player {', '/* While a vertical gesture',
    STYLES_WS5));
  assert.ok(/--player-art: 44px/.test(playerBlock),
    'the artwork width must be a single named custom property on .player');
  assert.ok(/--player-gap: 12px/.test(playerBlock),
    'the row gap must be a single named custom property on .player');
  assert.ok(/--player-col: calc\(var\(--player-art\) \+ var\(--player-gap\)\)/.test(playerBlock),
    'the text column must be DERIVED from art width + gap, not written as a literal');

  // The song line indents by that derived column - the one thing that cannot
  // be achieved structurally, because the artwork is on a DIFFERENT row.
  const song = stripComments(region('.now-playing-line {', '.now-playing-line:empty',
    STYLES_WS5));
  assert.ok(/margin-left: var\(--player-col\)/.test(song),
    'the song line must align using the shared column, not a hard-coded px');
  assert.ok(!/margin-left: \d+px/.test(song),
    'the song line must NOT carry a duplicated pixel literal');

  // The header reaches the same edge STRUCTURALLY: the close button occupies
  // the artwork's width and the row gap is the shared one, so flexbox puts the
  // text on the pills' left edge. This is the part that cannot drift.
  //
  // WS14: the close button is back on the header, right-grouped, and the
  // artwork column is held by the WIDTH-ONLY SPACER. The PROPERTY is unchanged
  // and is what this test guards; the element carrying it has changed several
  // times (button -> spacer -> button -> spacer). EXACTLY ONE element of
  // --player-art width may sit in that column, or the text is pushed off the
  // pills' edge.
  const row = stripComments(region('.player-header {', '.player-row {', STYLES_WS5));
  assert.ok(/gap: var\(--player-gap\)/.test(row),
    'the header must use the same gap as the player row');
  assert.ok(/\.player-header \.player-header-spacer \{[\s\S]*?width: var\(--player-art\)/.test(row),
    'the spacer must occupy the artwork column so the text lines up');
  // WS14: the header-scoped button rules are BACK, and they are the guard that
  // keeps the header buttons from growing to var(--player-art). A 44px pair
  // would leave the programme title 202px on a 390px iPhone.
  assert.ok(/\.player-header \.player-expand-btn/.test(row),
    'the header-scoped chevron rule must be present with the button (WS14)');
  assert.ok(/\.player-header \.player-btn-close/.test(row),
    'the header-scoped close rule must be present with the button (WS14)');
  assert.ok(/margin-left: auto/.test(row),
    'the chevron must push the pair to the far right, past the shrinking text');
  // Neither header button may be --player-art wide, or the text column dies.
  const headerBtns = stripComments(region(
    '.player-header .player-expand-btn,\n.player-header .player-btn-close {', '.player-header .player-title', STYLES_WS5));
  assert.ok(/width: 32px/.test(headerBtns),
    'the header buttons must be 32px, not var(--player-art)');
  assert.ok(!/var\(--player-art\)/.test(headerBtns),
    'the header buttons must not be sized from the artwork column');
  assert.ok(!/padding-left: \d+px/.test(row),
    'the header must NOT hard-code a text indent');
  // The artwork itself must read the same property, or the column lies.
  const thumb = stripComments(region('.player-thumb {', '.player-thumb img', STYLES_WS5));
  assert.ok(/width: var\(--player-art\)/.test(thumb) && /height: var\(--player-art\)/.test(thumb),
    'the artwork must be sized from --player-art, the source of the column');
  // The pills must not have gained an indent of their own either.
  assert.ok(!/\.player-meta \{[^}]*padding-left/m.test(STYLES_WS5),
    '.player-meta must not be indented - it defines the column by starting there');
});

test('WS5b Item 2: channel and programme share one line with no width cap', () => {
  // Two SEPARATE elements, in the header row, in that order. The reason is
  // silent failure, not style: paintProgramTitle() writes into '.player-sub'
  // via $player.querySelector. If the two texts were merged into one node, or
  // either were dropped, that function would keep returning without throwing
  // and programme titles would stop updating with every test still green.
  // ---- WS19: the channel title left the header; the SPLIT requirement stands ----
  // The owner's "remove the Bold duplicate information top left" collapses the
  // header from two text cells to one. What this test actually protects is that
  // `.player-sub` is its OWN element reachable BY NAME -- that is the
  // silent-failure guard, and it is unchanged. What changed is only that the
  // channel name is no longer a second header cell: it moved to the meta row
  // above the quality pill, which is where the owner asked for it.
  const header = stripComments(region(
    "const headerLine = el('div', { class: 'player-header' }",
    '$player.appendChild(headerLine);', APP_JS));
  assert.ok(/class: 'player-sub'/.test(header),
    'the programme subtitle must survive as its own node (paintProgramTitle targets it by name)');
  assert.ok(!/class: 'player-title'/.test(header),
    'the bold channel title must NOT be in the header (WS19: it moved to the meta row)');
  // The channel name must still be rendered SOMEWHERE, or the player has lost
  // its identity. The meta row is now that home -- asserted, not assumed.
  assert.ok(/identityName/.test(
    stripComments(region('const identityName = isLive', 'const metaRowTop', APP_JS))),
    'the channel name must still be rendered, in the meta row (WS19)');
  // Both still reachable by the paint functions and the WS0 snapshot.
  assert.ok(/metaDiagText\(\$player, '\.player-title'\)/.test(APP_CODE),
    'the WS0 snapshot must still be able to read the channel title');
  // The mini-bar KEEPS its title, so the count drops from two to one -- the
  // header's is gone. Guarded by an exact count so a third appearance, or a
  // silent re-introduction in the header, both fail.
  assert.ok((APP_CODE.match(/class: 'player-title'/g) || []).length === 1,
    'the title must now exist in exactly ONE place: the mini-bar (WS19 removed the header copy)');
  assert.ok(/class: 'player-title'/.test(
    stripComments(region("const mini = el('div', { class: 'player-mini' }", 'miniPlay', APP_JS))),
    'the mini-bar must keep its own title, or the minimised bar has no identity (WS19)');
  assert.ok(/querySelector\('\.player-sub'\)/.test(APP_CODE),
    'paintProgramTitle must still be able to query .player-sub');
  assert.ok(/\$player\.appendChild\(headerLine\);/.test(RENDER_WS5),
    'the header must still be appended to $player');
  // WS5 capped the channel at 40% of the header, which truncated it on narrow
  // phones. The cap is gone; the title keeps its intrinsic width.
  const row = stripComments(region('.player-header {', '.player-row {', STYLES_WS5));
  assert.ok(!/max-width: \d+%/.test(row),
    'the percentage width cap must be gone');
  assert.ok(/\.player-header \.player-sub \{ flex: 1 1 auto; min-width: 0; \}/.test(row),
    'the programme must take the remaining width and ellipsize');
  // ---- WS19: the bold title left the header, so its flex rule must go too ----
  // `.player-header .player-title` is now DEAD CSS -- the element is no longer
  // built in the header (only in the mini-bar, which this scoped selector does
  // not match). It is deleted rather than left behind, so a future reader does
  // not assume the header still has two text cells and size the row for them.
  assert.ok(!/\.player-header \.player-title \{/.test(row),
    'the dead .player-header .player-title rule must be removed (WS19)');
  // The channel name still has to reach the player, so the requirement moves
  // rather than disappears: it now lives in the META row.
  assert.ok(/identityName/.test(APP_JS),
    'the channel name must still be rendered (WS19: in the meta row, not the header)');
});

test('WS5b Item 3: the buttons are corners of the header row, not a floating row',
() => {
  // Provenance, not just presence: the chevron is pushed out by
  // `margin-left: auto`, so the shrinking text can never run underneath it.
  //
  // WS11a replaced this with an assertion that the rule was GONE (the button
  // had moved to the transport row). WS12 put the button back at the owner's
  // request. WS13 sent it away again. WS14 restores it, RIGHT-grouped, at the
  // owner's explicit instruction: "right grouped to visually look as the
  // minimised player ... on the same row as the channel and programme title".
  // The auto-margin is what makes that grouping hold at any text length, so
  // the rule is live again and this original requirement returns.
  const row = stripComments(region('.player-header {', '.player-row {', STYLES_WS5));
  assert.ok(/\.player-header \.player-expand-btn/.test(row),
    'the header-scoped chevron rule must be present with the button (WS14)');
  assert.ok(/\.player-header \.player-btn-close/.test(row),
    'the header-scoped close rule must be present with the button (WS14)');
  assert.ok(/\.player-header \.player-expand-btn \{ margin-left: auto; \}/.test(row),
    'the chevron must carry the auto-margin that keeps it at the right edge');
  // The close button's base size must survive for the other surfaces: the
  // mini-bar has its own close button and must not be resized by this change.
  // Anchor with the leading newline on purpose: '.player-btn-close {' is also a
  // substring of '.player-mini .player-btn-close {', and matching that one
  // would silently test the mini-bar override instead of the base rule.
  const closeBtn = stripComments(region('\n.player-btn-close {', '.player-btn-close svg',
    STYLES_WS5));
  assert.ok(/width: 32px/.test(closeBtn),
    'the base close button size must survive for other surfaces (mini-bar)');
  // The mini-bar is a separate subtree with its own close button; the header
  // rules are scoped to .player-header so they cannot leak into it.
  assert.ok(!/^\.player-btn-close \{[^}]*var\(--player-art\)/m.test(STYLES_WS5),
    'the shared close button must NOT be resized globally');
});

test('WS5b Item 4: nothing out of scope changed', () => {
  // The brief explicitly forbids touching these. Each is a live defect or a
  // deliberate decision, and a "small" layout edit is exactly where they get
  // collateral damage.
  assert.ok(/function seekToLive\(\)/.test(APP_CODE),
    'the back-to-live bug is NOT this workstream - seekToLive must be untouched');
  // `seekToLive()` legitimately appears in renderPlayer(): it is the WS4
  // programme-skip wiring that renders the next/previous buttons, and WS5b did
  // not add it. So the guard is scoped to the block WS5b actually authored --
  // a seek/live call there would mean the layout edit reached into playback.
  assert.ok(!/seek|position|currentTime|buffered/i.test(
    stripComments(region(LAYOUT_BLOCK, '$player.appendChild(headerLine);', APP_JS))),
  'no seek or playback code may live in the WS5b layout block');
  // ...and the WS4 wiring itself must be untouched and still reachable.
  assert.ok((APP_CODE.match(/seekToLive\(\)/g) || []).length >= 2,
    'the WS4 back-to-live wiring must still be present (button handler + definition)');
  // renderPlayer() contains BOTH layouts: the minimised branch (which builds
  // .player-mini) and the full one (which the WS5b block belongs to). Asserting
  // the mini-bar is absent from renderPlayer() as a whole is simply wrong; the
  // requirement is that the WS5b block leaves it alone.
  assert.ok(!/player-mini/.test(
    stripComments(region(LAYOUT_BLOCK, '$player.appendChild(headerLine);', APP_JS))),
    'the minimised mini-bar must not be rebuilt by the header change');
  // The mini-bar keeps its own 40px/10px geometry, so the song-line indent added
  // for the full player must be neutralised there rather than left to inherit.
  assert.ok(/\.player-mini \.now-playing-line \{ margin-left: 0; \}/.test(STYLES_WS5),
    'the mini-bar song line must not inherit the full player indent');
  // The header is still inside $player, above the row: WS5 ordering holds.
  assert.ok(RENDER_WS5.indexOf('$player.appendChild(headerLine)')
    < RENDER_WS5.indexOf("$player.appendChild(el('div', { class: 'player-row'"),
  'the header must still render above the player row');
  // The narrow-screen tweak must narrow the COLUMN, not reintroduce a text cap.
  const narrow = stripComments(region('@media (max-width: 340px) {', '/* very narrow',
    STYLES_WS5));
  assert.ok(/--player-gap: 10px/.test(narrow),
    'narrow screens must tighten the shared gap');
  assert.ok(!/player-title \{ max-width/.test(narrow),
    'the percentage cap must not come back in the media query');
});

// ---------------------------------------------------------------------------
// WS6 - programme-skip button: make it observable, then fix the dead press
// ---------------------------------------------------------------------------

// The snapshot helper and the syncNext body, as CODE.
const NEXT_DIAG = stripComments(region(
  'function metaDiagNextProgram()', '// Build the snapshot.', APP_JS));
const SYNC_WS6 = stripComments(region(
  'const syncNext = () => {', 'if (prevEv) syncNext();', APP_JS));
const SCHED_FETCH = stripComments(region(
  'fetchSchedule(cur.id).then((schedule) => {', 'if (prevEv) syncNext();', APP_JS));

test('WS6 Part 1: the snapshot exposes the programme-skip button', () => {
  // Present in the `dom` section, so one snapshot carries it.
  assert.ok(/nextProgram: metaDiagNextProgram\(\)/.test(APP_CODE),
    'the dom section must expose nextProgram');
  // And on the single-line console report, so the owner needs one command.
  assert.ok(/nextProgram: snap\.dom\.nextProgram/.test(APP_CODE),
    'the one-line report must include nextProgram');
  // The four fields the brief requires.
  ['visible', 'title', 'ariaLabel', 'mode'].forEach((f) => {
    assert.ok(NEXT_DIAG.includes(f), `nextProgram must report ${f}`);
  });
  // `present: false` / `absent` when the button does not exist at all (no DVR
  // transport). Without this the field would be silently null and read as
  // "hidden" -- two very different situations on the device.
  assert.ok(/mode: 'absent'/.test(NEXT_DIAG),
    'a button that does not exist must report absent, not hidden');
});

test('WS6 Part 1: mode is DERIVED from the real onclick wiring', () => {
  // The whole point: a parallel `mode` variable would drift from the handler
  // and could report 'direct' while the button still seeks to a programme.
  assert.ok(/typeof fn === 'function' \? \(fn\._srMode \|\| 'unknown'\)/.test(NEXT_DIAG),
    'mode must be read from the onclick function itself');
  assert.ok(/const fn = btn\.onclick;/.test(NEXT_DIAG),
    'mode must read the button\'s own onclick property');
  // Derived, then mapped -- and unknown wiring is reported honestly rather
  // than defaulting to a useful-looking value.
  assert.ok(/wired === 'programme'/.test(NEXT_DIAG) && /wired === 'direct'/.test(NEXT_DIAG),
    'both wiring tags must be recognised');
  assert.ok(/mode = wired;/.test(NEXT_DIAG),
    'unrecognised wiring must surface as-is, not be guessed');
  // A hidden button is 'hidden' regardless of its (stale) handler.
  assert.ok(/if \(!visible\) mode = 'hidden';/.test(NEXT_DIAG),
    'a display:none button must report hidden');
  // The tags are SET on the actual handlers attached to the button.
  assert.ok(/goNext\._srMode = 'programme';/.test(SYNC_WS6),
    'the programme handler must carry the programme tag');
  assert.ok(/goLive\._srMode = 'direct';/.test(SYNC_WS6),
    'the live handler must carry the direct tag');
  assert.ok(/nextProgramBtn\.onclick = goNext;/.test(SYNC_WS6)
    && /nextProgramBtn\.onclick = goLive;/.test(SYNC_WS6),
    'the tagged handlers must be the ones actually attached');
  // Hiding must CLEAR the handler. A hidden button that keeps a live handler
  // is exactly the drift this field exists to reveal.
  assert.ok(/nextProgramBtn\.onclick = null;/.test(SYNC_WS6),
    'hiding the button must clear its handler');
});

test('WS6 Part 2: the dead press is fixed -- only started programmes are offered',
() => {
  // THE DEFECT. The old lookup took the first event starting AFTER the
  // playhead, which is normally an event that has NOT STARTED YET.
  // seekToProgramTime() then hit `if (behindMs < 0) return;` and the press did
  // nothing. Measured over five real channels: 65.8% of behind-live moments.
  assert.ok(!/programBoundary\(schedule, posMs\(\), \+1\)/.test(SCHED_FETCH),
    'the future-programme lookup must be gone');
// WS7 SUPERSEDES THE WS6 FORM. WS6 used `schedule.find((ev) => ev.startMs <=
  // nowMs)`, which on an ASCENDING array returns the EARLIEST event of the day
  // -- "Ekot senaste nytt" @ 00:00, hours before the playhead. Seeking there
  // fell outside the 3 h DVR window, so the press showed a toast and did
  // nothing: 132/132 dead on real data, and the owner confirmed the button was
  // still dead on the phone after WS6 shipped. The lower bound is now the
  // PLAYHEAD, which makes it the nearest started boundary rather than the
  // first.
  assert.ok(/schedule\.find\(\(ev\) => ev\.startMs > playheadMs\s*\n?\s*&& ev\.startMs <= nowMs\)/.test(SCHED_FETCH),
    'the button must offer the NEAREST boundary that has ALREADY STARTED and lies ahead of the playhead');
  // REMOVED (WS7): this used to assert that the offered boundary 'has begun',
  // by re-testing the lookup's own `startMs <= now` predicate. That predicate
  // is written by the fix, so the assertion was TRUE BY CONSTRUCTION -- it
  // could not fail, and its passing meant nothing. It is the exact reasoning
  // that let WS6 ship 162 green tests over a 100%-dead button. WS7 asserts the
  // OUTCOME instead: the lower bound must be the playhead, so the offered
  // target is both forward of the playhead and inside the DVR window. See the
  // WS7 test and the offline sweep in the WS7 report.
  // The fallback is still reachable: when nothing has started, nextEv is null
  // and the behind-live branch runs.
  assert.ok(/const nextEv = startedNext\s*\?/.test(SCHED_FETCH)
    && /else if \(behindLive\)/.test(SYNC_WS6),
    'the Till Direkt fallback must still be reachable');
  // The seekToProgramTime guard is KEPT -- removing it would convert a dead
  // press into a seek to a nonsense target, and it still protects any other
  // caller.
  const SEEK_PROG = stripComments(region(
    'function seekToProgramTime(startMs)',
    "['waiting', 'stalled'].forEach", APP_JS));
  assert.ok(/if \(behindMs < 0\) return;/.test(SEEK_PROG),
    'the future-programme guard in seekToProgramTime must be KEPT');
});

test('WS6 Part 2: the position no longer depends on seekableEnd', () => {
  // The brief's hypothesis: posMs() measured backwards from a possibly-stale
  // live edge. It is now derived from the schedule's own event boundaries.
  assert.ok(/const posMs = \(\) => \{/.test(SCHED_FETCH),
    'posMs must be a function');
  // Its RESULT is a schedule start time, not a clock arithmetic result.
  assert.ok(/return ev \? ev\.startMs : est;/.test(SCHED_FETCH),
    'posMs must return the containing event\'s own startMs');
  assert.ok(/e\.startMs <= est && est < e\.endMs/.test(SCHED_FETCH),
    'the containing event must be found by its [startMs, endMs) range');
  // The stale edge may still SEED the estimate (it must -- the playhead\'s own
  // offset is needed to know which event it is in) but it is never compared
  // against a programme start.
  assert.ok(/const end = cur\.seekableEnd;/.test(SCHED_FETCH),
    'the seed estimate may still use seekableEnd to locate the playhead');
  assert.ok(!/Date\.now\(\) - \(cur\.seekableEnd - \(audioEl\.currentTime \|\| 0\)\) \* 1000;/.test(SCHED_FETCH)
    || /posMs/.test(SCHED_FETCH),
    'the raw one-liner must no longer BE the position used for lookup');
  // Live evidence: META_DIAG, not the current-track object (read-only guard).
  assert.ok(/META_DIAG\.nextBranch = \{/.test(SCHED_FETCH),
    'branch inputs must be recorded in META_DIAG');
  assert.ok(!/cur\._srNextBranch/.test(APP_CODE),
    'nothing may be written onto the current-track object');
});

test('WS6: out of scope -- seekBy, seekToLive and programBoundary unchanged', () => {
  // seekBy() is EXCLUDED by the owner. The WS4 upper clamp and the dvrAvailable
  // guard must be byte-for-byte intact.
  const SEEK_BY = stripComments(region('function seekBy(deltaSeconds)', '// Fetch today', APP_JS));
  // EXACT shape, no `||` fallback. An earlier version of this assertion was
  // `/const upper = .*LIVE_EDGE_TOLERANCE_S/.test(X) || /LIVE_EDGE_TOLERANCE_S/.test(X)`,
  // which passed even when the clamp was rewritten to use `seekableStart` --
  // mutation M8 proved it vacuous. Assert the whole expression.
  assert.ok(/const upper = Number\.isFinite\(cur\.seekableEnd\)\s*\? Math\.max\(start, cur\.seekableEnd - LIVE_EDGE_TOLERANCE_S\)\s*: Infinity;/.test(SEEK_BY),
    'the WS4 upper clamp in seekBy() must survive untouched');
  assert.ok(/const target = Math\.min\(upper, Math\.max\(start, \(audioEl\.currentTime \|\| 0\) \+ deltaSeconds\)\);/.test(SEEK_BY),
    'seekBy() must still clamp the target between start and upper');
  assert.ok(/if \(!cur \|\| !cur\.dvrAvailable\) return;/.test(SEEK_BY),
    'the dvrAvailable guard in seekBy() must survive untouched');
  // seekToLive() is likewise untouched.
  // ---- WS23: the assertion below now expects SEEK_LIVE_MARGIN_S ----
  // Everything ELSE in this test still holds: seekBy's clamp, its guard, the
  // SEEK_LIVE_DIAG fields, programBoundary's +/-1000 margins. Only seekToLive's
  // margin constant changed, by owner decision, and the clamp shape around it
  // is asserted exactly as before.
  const SEEK_LIVE_UNTOUCHED = stripComments(region(
    'function seekToLive()', '// ---- DVR transport', APP_JS));
  assert.ok(/const target = Math\.max\(start, end - SEEK_LIVE_MARGIN_S\);/.test(SEEK_LIVE_UNTOUCHED),
    'seekToLive() target must use the dedicated seek margin (WS23)');
  assert.ok(/updateSeekableState\(\);/.test(SEEK_LIVE_UNTOUCHED),
    'seekToLive() must still refresh the seekable state');
  // The WS3 SEEK_LIVE_DIAG block must still exist with ALL its fields.
  ['calls', 'lastExit', 'lastCalledAt', 'lastBefore', 'lastTarget', 'lastAfter']
    .forEach((f) => assert.ok(APP_CODE.includes(f), `SEEK_LIVE_DIAG.${f} must survive`));
  // programBoundary() keeps its contract -- the +1000 margin is NOT widened.
  const PB = stripComments(region('function programBoundary(schedule, positionMs, direction)',
    '// Seek to a programme start time', APP_JS));
  assert.ok(/ev\.startMs > positionMs \+ 1000/.test(PB),
    'programBoundary() must keep its +1000 contract (no threshold tuning)');
  assert.ok(/ev\.startMs < positionMs - 1000/.test(PB),
    'the previous-programme margin must also be unchanged');
  // No threshold tuning anywhere in this workstream.
  const DMR = stripComments(APP_JS.slice(
    APP_JS.indexOf('function programBoundary'), APP_JS.indexOf('// Seek to a programme start time')));
  assert.ok(!/DVR_MIN_WINDOW_S\s*=/.test(DMR), 'the DVR window minimum must not be retuned');
});

// ---------------------------------------------------------------------------
// WS7 - the forward skip lookup was INVERTED; and record what a press does
// ---------------------------------------------------------------------------

const SKIP_PRESS = stripComments(region(
  'function recordSkipPress(programmeStartMs)', 'function seekToProgramTime(startMs)',
  APP_JS));
const SYNC_WS7 = stripComments(region(
  'const syncNext = () => {', 'if (prevEv) syncNext();', APP_JS));
const POS_MS_WS7 = stripComments(region(
  'const posMs = () => {', 'const prevEv = programBoundary', APP_JS));

test('WS7: the forward lookup returns the NEAREST started boundary, not the first',
() => {
  // The WS6 form, which is what shipped broken. `schedule` is sorted ASCENDING
  // (fetchScheduleDay), so `find(ev => ev.startMs <= nowMs)` returns the
  // EARLIEST event of the day -- "Ekot senaste nytt" @ 00:00 -- and seeking to
  // it lands outside the 3 h window. 132/132 dead presses on real data.
  assert.ok(!/schedule\.find\(\(ev\) => ev\.startMs <= nowMs\)/.test(SYNC_WS7),
    'the WS6 earliest-of-the-day lookup must be gone');
  // The replacement must carry BOTH bounds. Either one alone is wrong:
  //   > playhead only  -> could offer a programme that has not begun
  //   <= now only      -> is the WS6 bug
  const lookup = /schedule\.find\(\(ev\) => ev\.startMs > (\w+)\s*\n?\s*&& ev\.startMs <= nowMs\)/.exec(SYNC_WS7);
  assert.ok(lookup, 'the lookup must bound startMs on both sides');
  assert.ok(lookup[1] === 'playheadMs',
    'the lower bound must be the PLAYHEAD, not the programme start');
  // The playhead estimate must be a distinct value from posMs().
  assert.ok(/const playheadMs = liveEdgeWallMs\(\);/.test(SYNC_WS7),
    'the playhead position must be computed');
  assert.ok(SYNC_WS7.includes('positionMs') && POS_MS_WS7.includes('ev.startMs'),
    'posMs() must still exist and return a programme start');
  // Both states preserved.
  assert.ok(/const nextEv = startedNext\s*\?/.test(SYNC_WS7)
    && /else if \(behindLive\)/.test(SYNC_WS7),
    'the Till Direkt fallback must still be reachable');
  // The BACKWARD button keeps using programBoundary(-1) -- correct for going
  // backwards, and explicitly out of scope here. NB: `prevEv` is declared
  // BEFORE `syncNext`, so it is NOT inside SYNC_WS7 -- assert it in the wider
  // region. Slicing the wrong span is how an assertion silently stops checking
  // anything.
  const SCHED_WS7 = stripComments(region(
    'fetchSchedule(cur.id).then((schedule) => {', 'if (prevEv) syncNext();', APP_JS));
  assert.ok(/const prevEv = programBoundary\(schedule, posMs\(\), -1\);/.test(SCHED_WS7),
    'the previous-programme lookup must be untouched');
});

test('WS7: the press is recorded, so a dead press is distinguishable from silence',
() => {
  // Every branch the brief requires, as discrete strings.
  ['no-track', 'no-dvr', 'non-finite-target', 'out-of-window', 'rejected-by-browser']
    .forEach((b) => assert.ok(SKIP_PRESS.includes(`'${b}'`),
      `recordSkipPress must be able to report ${b}`));
  // A monotonic counter: "calls = 0" means the handler never fired at all,
  // which is a different problem from any branch value. The initialiser lives
  // in the SKIP_PRESS_DIAG declaration, which sits ABOVE the function, so it
  // is asserted against the declaration -- not against the function body.
  const SKIP_PRESS_DECL = stripComments(region(
    'const SKIP_PRESS_DIAG = {', 'function recordSkipPress(programmeStartMs)', APP_JS));
  assert.ok(/calls: 0,/.test(SKIP_PRESS_DECL) && /d\.calls \+= 1;/.test(SKIP_PRESS),
    'a monotonic calls counter must exist');
  // The window at the moment of the press.
  ['seekableStart', 'seekableEnd', 'seekableDuration'].forEach((f) =>
    assert.ok(SKIP_PRESS.includes(f), `the press must record ${f}`));
  // The computed target, and a read-back to detect a silent refusal.
  assert.ok(/d\.lastTarget = target;/.test(SKIP_PRESS),
    'the computed target must be recorded');
  assert.ok(/accepted: Math\.abs\(actual - target\) < 1/.test(SKIP_PRESS),
    'the read-back must compare the actual position against the target');
  assert.ok(/d\.lastBranch = 'rejected-by-browser';/.test(SKIP_PRESS),
    'a target the browser did not honour must be reported as such');
  // BOTH handlers record -- the programme skip and the "Till Direkt" path.
  assert.ok(/const goNext = \(\) => \{\s*recordSkipPress\(nextEv\.startMs\);/.test(SYNC_WS7),
    'the programme-skip handler must record its press');
  assert.ok(/const goLive = \(\) => \{\s*recordSkipPress\(null\);/.test(SYNC_WS7),
    'the Till Direkt handler must record its press');
  // The WS6 wiring contract must still hold (a test above depends on it).
  assert.ok(/goNext\._srMode = 'programme';/.test(SYNC_WS7)
    && /goLive\._srMode = 'direct';/.test(SYNC_WS7)
    && /nextProgramBtn\.onclick = null;/.test(SYNC_WS7),
    'the WS6 handler tags and the hide-clears-handler rule must survive');
  // Surfaced under dom.nextProgram and on the one-line report.
  assert.ok(/skipPress: snap\.dom\.nextProgram/.test(APP_CODE),
    'the press must be surfaced on the one-line report');
  // `press` must be built BEFORE the `if (!btn) return` branch, so it is
  // present in BOTH return paths. A first version put it inside the
  // present-only branch, which made `nextProgram.press` undefined exactly when
  // a reader most wants it -- and every test that read it had synthesised a
  // button, so nothing noticed. Assert the ORDER, not just the presence.
  const pressIdx = NEXT_DIAG.indexOf('const press = {');
  const earlyReturnIdx = NEXT_DIAG.indexOf("if (!btn) {");
  assert.ok(pressIdx !== -1, 'the press block must exist in metaDiagNextProgram()');
  assert.ok(earlyReturnIdx !== -1, 'the absent-button early return must still exist');
  assert.ok(pressIdx < earlyReturnIdx,
    'press must be gathered BEFORE the absent-button return, so both paths report it');
  assert.ok(/mode: 'absent', press \}/.test(NEXT_DIAG),
    'the absent-button return must include the press evidence');
  // Read-only: the recorder must not write to the current-track object.
  assert.ok(!/cur\.\w+\s*=[^=]/.test(SKIP_PRESS),
    'recordSkipPress must not write any property of the current-track object');
});

test('WS7: out of scope -- seekBy, seekToLive, posMs, programBoundary, constants',
() => {
  // EXACT text, no `||` fallback anywhere. WS6's M8 slipped through because an
  // `||` between two assertions made one of them a placeholder.
  assert.ok(APP_JS.includes('const DVR_MIN_WINDOW_S = 60;'),
    'DVR_MIN_WINDOW_S must be byte-identical');
  assert.ok(APP_JS.includes('const LIVE_EDGE_TOLERANCE_S = 10;'),
    'LIVE_EDGE_TOLERANCE_S must be byte-identical');
  // seekBy(): the WS4 clamp, exactly.
  const SEEK_BY = stripComments(region('function seekBy(deltaSeconds)', '// Fetch today', APP_JS));
  assert.ok(/const upper = Number\.isFinite\(cur\.seekableEnd\)\s*\? Math\.max\(start, cur\.seekableEnd - LIVE_EDGE_TOLERANCE_S\)\s*: Infinity;/.test(SEEK_BY),
    'the seekBy upper clamp must be byte-identical');
  assert.ok(/const target = Math\.min\(upper, Math\.max\(start, \(audioEl\.currentTime \|\| 0\) \+ deltaSeconds\)\);/.test(SEEK_BY),
    'the seekBy target expression must be byte-identical');
  assert.ok(/if \(!cur \|\| !cur\.dvrAvailable\) return;/.test(SEEK_BY),
    'the seekBy dvrAvailable guard must be byte-identical');
  // seekToLive(): the target arithmetic, exactly.
  // ---- WS23: the margin constant changed from the display tolerance to the
  // dedicated seek margin. The EXPRESSION is asserted in full so the clamp
  // shape is still exact, and the constant is asserted in the WS23 tests.
  const SEEK_LIVE = stripComments(region('function seekToLive()', '// ---- DVR transport', APP_JS));
  assert.ok(/const target = Math\.max\(start, end - SEEK_LIVE_MARGIN_S\);/.test(SEEK_LIVE),
    'the seekToLive target must use SEEK_LIVE_MARGIN_S (WS23)');
  // programBoundary(): its contract, exactly, including the margins.
  const PB = stripComments(region('function programBoundary(schedule, positionMs, direction)',
    '// Seek to a programme start time', APP_JS));
  assert.ok(PB.includes('const next = schedule.find((ev) => ev.startMs > positionMs + 1000);'),
    'the programBoundary forward margin must be byte-identical');
  assert.ok(PB.includes('const prev = [...schedule].reverse().find((ev) => ev.startMs < positionMs - 1000);'),
    'the programBoundary backward margin must be byte-identical');
  // posMs(): kept, and it still returns a programme start.
  assert.ok(/return ev \? ev\.startMs : est;/.test(POS_MS_WS7),
    'posMs() must still return the containing event startMs');
  assert.ok(/e\.startMs <= est && est < e\.endMs/.test(POS_MS_WS7),
    'posMs() must still locate the containing event by its range');
  // The WS3 diagnostic block keeps every field.
  ['calls', 'lastExit', 'lastCalledAt', 'lastBefore', 'lastTarget', 'lastAfter']
    .forEach((f) => assert.ok(APP_CODE.includes(f), `SEEK_LIVE_DIAG.${f} must survive`));
  // The read-only contract.
  assert.ok(!/state\.current\.\w+\s*=/.test(HOOK),
    'the hook must not write any property of the current-track object');
});

// ---------------------------------------------------------------------------
// WS9 - position-aware programme + song, and the DVR window readout
// ---------------------------------------------------------------------------

const RESOLVE_TITLE = stripComments(region(
  'function playheadWallMs()', 'function playTrack(track)', APP_JS));
const FETCH_NP_WS9 = stripComments(region(
  'async function fetchNowPlaying(', 'function scheduleNowPlayingPoll()', APP_JS));
const WINDOW_READOUT = '(removed by WS11 Part A)';

// WS9 Part C's on-screen readout is SUPERSEDED by WS11 Part A: the owner saw the
// shortened slider and unrequested bottom-right chrome and asked for it gone.
// The VALUE was never the problem, only showing it in the seek row. It now lives
// in the gated diagnostics snapshot (press.windowSeconds), which renders
// nothing. This test now asserts that split.
test('WS9 Part C -> WS11 Part A: the window value is diagnostics-only, never rendered', () => {
  // No element, no CSS, no third child in the seek row.
  assert.ok(!/windowReadout/.test(APP_CODE), 'the readout element must be gone from app.js');
  // The RULE must be gone, not merely the string: an explanatory comment
  // naming the removed class is deliberate provenance and must be allowed.
  assert.ok(!/^\.dvr-window-readout\s*\{/m.test(STYLES_WS5),
    'the .dvr-window-readout CSS RULE must be gone');
  assert.ok(!/^\.dvr-window-readout:empty/m.test(STYLES_WS5),
    'the :empty rule must be gone with it');
  assert.ok(!/class: 'dvr-window-readout'/.test(APP_JS), 'no element may reappear');
  // ...but the VALUE survives in diagnostics, derived -- not a literal.
  const PRESS = stripComments(region('const press = {', 'if (!btn) {', APP_JS));
  assert.ok(/windowSeconds:/.test(PRESS) && /cur\.seekableEnd - cur\.seekableStart/.test(PRESS),
    'the real window length must still be reported in the snapshot');
  assert.ok(!/const secs = \d+ \* \d+;/.test(PRESS),
    'the reported window length must NOT be a hardcoded literal');
});
test('WS9: out of scope -- every seek function and the DVR constants are byte-identical', () => {
  // NO `||` fallbacks between assertions. An `||` has twice let a mutation slip
  // through green in this project.
  assert.ok(APP_JS.includes('const DVR_MIN_WINDOW_S = 60;'), 'DVR_MIN_WINDOW_S must be byte-identical');
  assert.ok(APP_JS.includes('const LIVE_EDGE_TOLERANCE_S = 10;'), 'LIVE_EDGE_TOLERANCE_S must be byte-identical');
  const SEEK_BY = stripComments(region('function seekBy(deltaSeconds)', '// Fetch today', APP_JS));
  assert.ok(/const upper = Number\.isFinite\(cur\.seekableEnd\)\s*\? Math\.max\(start, cur\.seekableEnd - LIVE_EDGE_TOLERANCE_S\)\s*: Infinity;/.test(SEEK_BY),
    'the seekBy upper clamp must be byte-identical');
  const SEEK_LIVE = stripComments(region('function seekToLive()', '// ---- DVR transport', APP_JS));
  assert.ok(/const target = Math\.max\(start, end - SEEK_LIVE_MARGIN_S\);/.test(SEEK_LIVE),
    'the seekToLive target must use SEEK_LIVE_MARGIN_S (WS23)');
  // seekToProgramTime: behaviour AND the out-of-window toast are untouched
  // (WS8 Part B, not authorised here).
  const SPT = stripComments(region('function seekToProgramTime(startMs)', "['waiting', 'stalled'].forEach", APP_JS));
  assert.ok(/showToast\('Programmet ligger utanför spolbart område \(3 timmar\)\.'\);/.test(SPT),
    'the out-of-window toast must be untouched in WS9');
  assert.ok(/if \(target < start\) \{/.test(SPT), 'the out-of-window guard must be byte-identical');
  // The programme-skip lookup and its window-free semantics are unchanged.
  const SYNC = stripComments(region('const syncNext = () => {', 'if (prevEv) syncNext();', APP_JS));
  assert.ok(/ev\.startMs > playheadMs\s*\n?\s*&& ev\.startMs <= nowMs/.test(SYNC),
    'the programme-skip lookup must be byte-identical (not fixed in WS9)');
  // posMs and liveEdgeWallMs unchanged.
  assert.ok(/const posMs = \(\) => \{/.test(APP_CODE), 'posMs must still exist');
  assert.ok(/const liveEdgeWallMs = \(\) => \{/.test(APP_CODE), 'liveEdgeWallMs must still exist');
  assert.ok(/const prevEv = programBoundary\(schedule, posMs\(\), -1\);/.test(APP_CODE),
    'the backwards lookup must be byte-identical');
  // The read-only contract.
  assert.ok(!/state\.current\.\w+\s*=/.test(HOOK), 'the hook must not write to the current-track object');
});

// ---------------------------------------------------------------------------
// WS10 - build identity: injected per build, shown on the main screen
// ---------------------------------------------------------------------------

const BUILD_SCRIPT = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'build-pages.mjs'), 'utf8');
// Start at the appendChild call, NOT at `class: 'build-line'`: the class
// attribute sits INSIDE the el('p', { ... }) call, so a region starting there
// slices the opening off and an assertion about it can never match. That is
// the WS10 §5 "sliced the wrong region" trap, in my own new test.
// WS11 Part B moved the line into .topbar; WS12 Part A moved it back under
// NYHETER at the owner's request. It is now appended INLINE
// ($main.appendChild(el('p', {...})), so there is no `const buildLine = el(`
// declaration left to anchor on. The region starts at the APPEND, which is
// where the class attribute and the text actually are. Anchoring on the class
// attribute alone would slice the opening off -- the WS10 §5 trap, again.
const BUILD_LINE = stripComments(region(
  '$main.appendChild(el(\'p\', {', 'updatePlayingMarks();', APP_JS));
const ABOUT_LINE = stripComments(region(
  "class: 'about-version'", 'openAbout', APP_CODE) || APP_CODE.slice(
    APP_CODE.indexOf("class: 'about-version'"),
    APP_CODE.indexOf("class: 'about-version'") + 300));

test('WS10 Part A: the build id is injected at build time, and the root stays a placeholder', () => {
  // The root app.js is the AUTHORING input. A real build id there would be
  // overwritten by the build and would be a stale lie waiting to happen.
  assert.ok(/const APP_BUILD = '__APP_BUILD_ID__';/.test(APP_JS),
    'the repo-root app.js must keep the placeholder, not a hardcoded hash');
  // The injection must ACTUALLY happen. The previous version of this assertion
  // was `!X || true`, which is unconditionally true -- mutation M3 (deleting the
  // injection) went green because of it. Assert the substitution itself.
  assert.ok(/const BUILD_PLACEHOLDER = '__APP_BUILD_ID__';/.test(BUILD_SCRIPT),
    'the build must name the authoring placeholder as a constant');
  assert.ok(/source = source\.replaceAll\(BUILD_PLACEHOLDER, build\.id\);/.test(BUILD_SCRIPT),
    'the build must substitute the placeholder with the real id');
  assert.ok(/source = source\.replace\(declaration, `const APP_BUILD = '\$\{build\.id\}';`\);/.test(BUILD_SCRIPT),
    'the build must also overwrite an already-injected value (idempotent path)');
  // The build derives it from GIT, which is external to app.js's bytes. Using
  // the content hash here would be circular: injecting it changes the content,
  // which changes the hash, which changes the id, forever.
  assert.ok(/execFileSync\('git', \[/.test(BUILD_SCRIPT),
    'the build id must come from a git command');
  // The validation that decides whether the id is TRUSTED. Removing it let a
  // garbage id through as if it were a commit: mutation M4 was green.
  const RESOLVE = stripComments(region(
    'function resolveBuildId()', 'const build = resolveBuildId()', BUILD_SCRIPT));
  // The gate: an unvalidated `sha` must never be returned as a commit id. The
  // ONLY path that returns a git id is guarded by the hex test; everything else
  // falls through to a labelled timestamp. A first version of this assertion
  // also forbade the guarded `return` entirely, which can never pass.
  assert.ok(/if \(\/\^\[0-9a-f\]\{7,40\}\$\/\.test\(sha\)\) return \{ id: sha, source: 'git \(app\.js\)' \};/.test(RESOLVE),
    'only a validated hex SHA may be returned as a git build id');
  assert.ok(/return \{ id: `t\$\{Date\.now\(\)\.toString\(36\)\}`, source: 'timestamp \(git gave no SHA\)' \};/.test(RESOLVE),
    'an unvalidated sha must fall through to the labelled timestamp');
  assert.ok(!/hash\(.*distApp|hash\(source\)/.test(BUILD_SCRIPT),
    'the build id must NOT be derived from app.js content (circular)');
  // Fallback must be visible, so a degraded build is never read as real.
  assert.ok(/timestamp \(git unavailable\)/.test(BUILD_SCRIPT)
    && /timestamp \(git gave no SHA\)/.test(BUILD_SCRIPT),
    'a git fallback must exist and be labelled in the output');
  assert.ok(/console\.log\(`Build id:/.test(BUILD_SCRIPT),
    'the build must print the id and its source');
  // Idempotent: both paths handled, and exactly one declaration.
  assert.ok(/declarations\.length !== 1/.test(BUILD_SCRIPT),
    'the build must require exactly one APP_BUILD declaration');
  assert.ok(/source\.includes\(BUILD_PLACEHOLDER\)/.test(BUILD_SCRIPT)
    && /source\.replace\(declaration,/.test(BUILD_SCRIPT),
    'the build must handle both a fresh placeholder and an already-injected file');
  assert.ok(/injected\[1\] !== build\.id/.test(BUILD_SCRIPT),
    'the build must verify the injection actually took effect');
});

test('WS10 Part B: the build id is shown on the main screen, without restoring the footer', () => {
  // The line lives in the slot WS5 left, immediately before updatePlayingMarks().
  assert.ok(BUILD_LINE.includes("class: 'build-line'"),
    'the build line must be a dedicated element');
  assert.ok(/APP_BUILD/.test(BUILD_LINE),
    'the main-screen line must show the build id');
  // WS11 Part B: APP_VERSION is GONE, not bumped. A frozen literal presented as
  // a version is a lie; a hand-bumped one repeats the problem later. The build
  // id is the only identity shown.
  assert.ok(!/APP_VERSION/.test(BUILD_LINE),
    'the frozen version must not be displayed');
  assert.ok(!/APP_VERSION/.test(APP_CODE),
    'APP_VERSION must not exist at all -- there is no second version source');
  // NOT the old attribution footer. WS5 removed it deliberately and the About
  // overlay still carries the attribution and the disclaimer.
  assert.ok(!/Data från Sveriges Radio/.test(BUILD_LINE),
    'the build line must NOT restore the removed attribution');
  assert.ok(!/oberoende av|Utgivare av|class: 'attribution'/.test(BUILD_LINE),
    'the build line must NOT restore the disclaimer or the old footer class');
  // It is a plain paragraph -- no links, no interaction.
  assert.ok(/el\('p', \{/.test(BUILD_LINE), 'it must be a plain paragraph');
  assert.ok(!/<a |href:|onclick/.test(BUILD_LINE), 'it must not be interactive');
  // WS12 Part A: the owner asked for it back under NYHETER. It is appended to
  // $main, whose children are channels, podcasts, news -- so it lands directly
  // under the news section, which is the requested position.
  assert.ok(/\$main\.appendChild/.test(BUILD_LINE),
    'the build line must be appended to #main, directly under NYHETER');
  // Assert the NEGATIVE too. WS11 Part B put it in the .topbar and the owner
  // rejected that; without this the line could drift back and the tests would
  // still pass, because `bar.appendChild` is a perfectly good statement.
  assert.ok(!/document\.querySelector\('\.topbar'\)/.test(BUILD_LINE),
    'the build line must NOT be moved back into the .topbar (WS12)');
  assert.ok(!/bar\.appendChild\(buildLine\)/.test(APP_CODE),
    'nothing may append a buildLine to the top bar (WS12)');
  // And the cog is only right-aligned again because the topbar has two
  // children: space-between centres whatever sits between its two ends.
  const topbarBlock = stripComments(region('.topbar {', '\n}', STYLES_WS5));
  assert.ok(/justify-content: space-between/.test(topbarBlock),
    '.topbar must still use space-between, so two children put the cog right');
  // CSS: small and dim, reusing the existing muted colour.
  const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.ok(/\.build-line \{/.test(CSS), 'a .build-line rule must exist');
  // Bound the CSS block on the next rule that actually exists, NOT on a
  // '.build-line:empty' that was never written -- region() returns -1 for a
  // missing end marker and the whole test file fails to load.
  const cssBlock = stripComments(region(
    '.build-line {', '/* ---------- WS5b', CSS));
  // WS12 Part A: back to the WS10 BLOCK form. The topbar-only properties
  // (nowrap / overflow / text-overflow / flex / min-width / align-self) made
  // sense for a truncating flex header and are dead weight in a block, so
  // they are asserted ABSENT rather than merely unused.
  assert.ok(/font-size: 11px/.test(cssBlock), 'the build line must be small');
  assert.ok(/color: var\(--text-secondary\)/.test(cssBlock),
    'it must reuse the existing muted-text colour, not invent one');
  assert.ok(/margin: 18px 0 4px/.test(cssBlock),
    'a block under NYHETER needs breathing room above it');
  ['white-space: nowrap', 'text-overflow: ellipsis', 'flex:', 'align-self:']
    .forEach((p2) => {
      assert.ok(!new RegExp(p2).test(cssBlock),
        `.build-line must NOT carry the topbar-only property ${p2} in a block`);
    });
});

test('WS10: the About overlay shows the real build identity', () => {
  assert.ok(/bygg \$\{APP_BUILD\} · Utvecklad av/.test(ABOUT_LINE),
    'About must show the build id');
  assert.ok(!/APP_VERSION/.test(ABOUT_LINE),
    'About must not show the frozen version');
  // Wording, layout and the independent-app disclaimer are untouched -- only
  // the value changed. Assert the disclaimer is still there.
  const ABOUT_BODY = stripComments(region('function openAbout(', 'function ', APP_CODE));
  assert.ok(/oberoende av och inte utgiven av Sveriges Radio/.test(APP_CODE),
    'the independent-app disclaimer must survive');
  assert.ok(!/class: 'build-line'/.test(ABOUT_BODY),
    'the About overlay uses .about-version, not the home-screen .build-line');
});

test('WS10: the id names the SOURCE commit, not the artifact commit', () => {
  // The tracked bundle lives IN the repository, so the commit that STORES it
  // cannot be the id inside it -- a first version used HEAD and therefore
  // always showed the PARENT's SHA (observed: bundle app.c4d7f88e.js carried
  // 0e6e89b0 while HEAD was 16fa6ba). The id must therefore be the last commit
  // that touched app.js, which exists before the build runs and is what an
  // owner can actually `git log` to.
  const BS = stripComments(region('function resolveBuildId()', 'const build = resolveBuildId()', BUILD_SCRIPT));
  assert.ok(/'log', '-1', '--format=%h', '--', 'app\.js'/.test(BS),
    'the id must come from the last commit that touched app.js');
  // A fallback to HEAD is allowed ONLY when the file has no history, and the
  // result must be validated as a SHA either way.
  assert.ok(/rev-parse/.test(BS), 'a HEAD fallback is permitted for a history-less repo');
  assert.ok(/\[0-9a-f\]\{7,40\}/.test(BS),
    'the id must be validated as a real hex SHA before being trusted');
  // A fallback must SAY SO, so a degraded build is never mistaken for a real id.
  assert.ok(/timestamp \(git gave no SHA\)/.test(BS) && /timestamp \(git unavailable\)/.test(BS),
    'a non-git fallback must be labelled as a timestamp in both cases');
  // The reported source must be visible in the build output.
  assert.ok(APP_JS.includes('__APP_BUILD_ID__'),
    'the root app.js must keep the authoring placeholder');
  // The root must not carry a real SHA -- that would be a stale literal lying
  // about which code is running.
  assert.ok(!/const APP_BUILD = '[0-9a-f]{7,40}'/.test(APP_JS),
    'the root app.js must NOT contain a hardcoded build hash');
});

test('WS10: the About overlay keeps its wording (only the value changed)', () => {
  // The brief permits changing the version VALUE only. Nothing asserted the
  // rest of the line, so mutation M8 (deleting "· Utvecklad av ...") was green.
  const ABOUT = stripComments(region('function openAbout(', '// ----', APP_JS));
  assert.ok(/APP_DEVELOPER/.test(ABOUT),
    'the About overlay must still name the developer');
  assert.ok(/Utvecklad av/.test(ABOUT),
    'the About overlay must keep its Swedish wording');
  assert.ok(/APP_BUILD/.test(ABOUT),
    'the About overlay must show the build id');
  assert.ok(!/APP_VERSION/.test(ABOUT),
    'the About overlay must not show a frozen version');
  // And the independent-app disclaimer that WS5 deliberately left there.
  assert.ok(APP_CODE.includes('oberoende av och inte utgiven av Sveriges Radio'),
    'the independent-app disclaimer must survive');
});

test('WS10: out of scope -- playback, seek, metadata and DVR are byte-identical', () => {
  // No `||` fallbacks. Each is asserted on its exact current text.
  assert.ok(APP_JS.includes('const DVR_MIN_WINDOW_S = 60;'), 'DVR_MIN_WINDOW_S must be byte-identical');
  assert.ok(APP_JS.includes('const LIVE_EDGE_TOLERANCE_S = 10;'), 'LIVE_EDGE_TOLERANCE_S must be byte-identical');
  const SEEK_BY = stripComments(region('function seekBy(deltaSeconds)', '// Fetch today', APP_JS));
  assert.ok(/const upper = Number\.isFinite\(cur\.seekableEnd\)\s*\? Math\.max\(start, cur\.seekableEnd - LIVE_EDGE_TOLERANCE_S\)\s*: Infinity;/.test(SEEK_BY),
    'the seekBy clamp must be byte-identical');
  const SEEK_LIVE = stripComments(region('function seekToLive()', '// ---- DVR transport', APP_JS));
  assert.ok(/const target = Math\.max\(start, end - SEEK_LIVE_MARGIN_S\);/.test(SEEK_LIVE),
    'the seekToLive target must use SEEK_LIVE_MARGIN_S (WS23)');
  // The WS9 position-aware machinery must be untouched by WS10.
  assert.ok(/function playheadWallMs\(\)/.test(APP_CODE), 'playheadWallMs must still exist');
  assert.ok(/e\.startMs <= atMs && atMs < e\.stopMs/.test(APP_CODE), 'pickByPosition must be unchanged');
  assert.ok(/if \(!schedule \|\| state\.current !== cur\) return;/.test(APP_CODE),
    'the superseded guard must be unchanged');
  assert.ok(/keep\(pl\.previoussong\)/.test(APP_CODE), 'the song timeline must be unchanged');
  // The skip lookup and its guards.
  const SYNC = stripComments(region('const syncNext = () => {', 'if (prevEv) syncNext();', APP_JS));
  assert.ok(/ev\.startMs > playheadMs\s*\n?\s*&& ev\.startMs <= nowMs/.test(SYNC),
    'the programme-skip lookup must be byte-identical');
  const SPT = stripComments(region('function seekToProgramTime(startMs)', "['waiting', 'stalled'].forEach", APP_JS));
  assert.ok(/showToast\('Programmet ligger utanför spolbart område \(3 timmar\)\.'\);/.test(SPT),
    'the out-of-window toast must be byte-identical');
  // The read-only contract.
  assert.ok(!/state\.current\.\w+\s*=/.test(HOOK), 'the hook must not write to the current-track object');
});

// ---------------------------------------------------------------------------
// WS11 - remove the seek-row readout; feed the car and lock screen properly
// ---------------------------------------------------------------------------

const SEEK_ROW_WS11 = stripComments(region(
  "seekRow = el('div', { class: 'seek-row dvr-row' }", '// Drag state', APP_JS));
const MEDIA_SESSION = stripComments(region(
  'function updateMediaSession() {', '// ---- buffering indicator', APP_JS));
const BUILD_LINE_WS12 = stripComments(region(
  '$main.appendChild(el(\'p\', {', 'updatePlayingMarks();', APP_JS));

test('WS11 Part A: the seek row has EXACTLY two children, so the slider is whole',
() => {
  // The specific promise, not a proxy. WS9 added a THIRD flex child to a flex
  // container, so the readout took width from the seek bar; the reviewer then
  // measured the HEADER alignment and declared the layout intact. Assert the
  // thing that actually broke.
  assert.ok(SEEK_ROW_WS11.includes("el('div', { class: 'seek-row dvr-row' },\n        timeLeft, bar);"),
    'the seek row must be built from exactly timeLeft and bar');
  assert.ok(!/windowReadout/.test(SEEK_ROW_WS11),
    'the readout must not be a child of the seek row');
  // Count the children structurally, not by eyeballing: exactly two
  // comma-separated arguments between the braces.
  const m = /class: 'seek-row dvr-row' \}\s*,\s*([^;]+?)\);/.exec(SEEK_ROW_WS11);
  assert.ok(m, 'the seek row construction must be parseable');
  const children = m[1].split(',').map((x) => x.trim()).filter(Boolean);
  assert.equal(children.length, 2, 'the seek row must have exactly two children');
  assert.deepEqual(children, ['timeLeft', 'bar'],
    'the children must be the clock label and the bar, in that order');
});

test('WS11 Part A: the readout is gone from the player, the value is not', () => {
  // The element, its paint helper and its CSS are all gone...
  assert.ok(!/windowReadout/.test(APP_CODE), 'no readout element may remain in app.js');
  assert.ok(!/class: 'dvr-window-readout'/.test(APP_JS), 'no readout element may be built');
  assert.ok(!/paintWindowReadout/.test(APP_CODE), 'the paint helper must be gone');
  assert.ok(!/^\.dvr-window-readout\s*\{/m.test(STYLES_WS5), 'the CSS rule must be gone');
  // ...but the VALUE survives, in the gated snapshot where nothing renders.
  // That is where it belonged: it is what proved the window is 3 h 1 min.
  const PRESS = stripComments(region('const press = {', 'if (!btn) {', APP_JS));
  assert.ok(/windowSeconds:/.test(PRESS) && /cur\.seekableEnd - cur\.seekableStart/.test(PRESS),
    'the real window length must still be reported in the diagnostics');
  assert.ok(/dvrWindow:/.test(APP_CODE), 'and on the one-line report');
  // The removed WS5 attribution must NOT come back in its place.
  assert.ok(!/Data från Sveriges Radio/.test(SEEK_ROW_WS11),
    'the seek row must not gain an attribution');
});

// WS12A: renamed from "no frozen version, and the line cannot be occluded".
// "cannot be occluded" was FALSE. It was the reviewer's rationale when WS11
// moved the build line into the top bar -- the claim that the player covered
// it under NYHETER. Nobody ever observed that, and the owner has since
// checked on the iPhone and reported there is space below NYHETER. A visual
// claim that is copied into a test name stops being a guess and starts
// reading like a measurement, so it has to come out. The new name says only
// what the test actually checks.
test('WS11 Part B: no frozen version is displayed anywhere', () => {
  // A version string that never moves but is displayed as a version is a lie.
  assert.ok(!/APP_VERSION/.test(APP_CODE),
    'APP_VERSION must not exist -- there must be no second, frozen version source');
  assert.ok(!/const APP_VERSION\s*=/.test(APP_JS),
    'and it must not come back as a literal');
  // package.json is the single remaining version source; the app deliberately
  // does not display it, because it is not per-build.
  const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(typeof PKG.version === 'string' && PKG.version.length > 0,
    'package.json must still carry the single version source');
  // The single source must not drift from the README either: the two files a
  // reader is most likely to compare are the two that must agree.
  const README = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.ok(new RegExp(`\\*\\*Version:\\*\\* ${PKG.version.replace(/\\./g, '\\\\.')}`).test(README),
    `README must state the same version as package.json (${PKG.version})`);
  assert.ok(!/APP_VERSION/.test(APP_JS) || !/\$\{APP_VERSION\}/.test(APP_CODE),
    'no version may be interpolated into any displayed string');
  // Placement: WS12 Part A reverses the WS11 placement, at the owner's
  // request. The line goes back under NYHETER in #main, and the cog returns
  // to the right edge. The WS11 rationale for moving it up -- that the player
  // covered the line -- was never observed and is false; the owner's
  // instruction was placement, and that is what this asserts.
  assert.ok(/\$main\.appendChild/.test(BUILD_LINE_WS12),
    'the build line must go back under NYHETER in #main');
  assert.ok(!/document\.querySelector\('\.topbar'\)/.test(BUILD_LINE_WS12),
    'it must NOT be in the top bar -- the owner rejected that placement');
  assert.ok(/text: `bygg \$\{APP_BUILD\}`/.test(BUILD_LINE_WS12),
    'it must show the build id');
  // The WS10 build-id mechanism must NOT regress to the artifact commit.
  const BS = BUILD_SCRIPT;
  assert.ok(/APP_SOURCE_COMMIT|resolveBuildId/.test(BS),
    'the build script must still derive the id from the SOURCE commit');
});

test('WS11 Part C: MediaSession carries the position-aware programme and song', () => {
  // The old fields were cur.title / cur.subtitle -- the channel and a static
  // string. Everything WS9 built was invisible to the car screen, which is
  // exactly the reported symptom.
  assert.ok(!/title: cur\.title \|\| 'Min Radio'/.test(MEDIA_SESSION),
    'the channel name must no longer be the MediaSession title');
  assert.ok(!/artist: cur\.subtitle \|\|/.test(MEDIA_SESSION),
    'cur.subtitle must no longer be the MediaSession artist');
  // It must read the SAME position-aware values the in-app display uses.
  assert.ok(/pickByPosition\(nowPlaying\.timeline, playheadWallMs\(\)\)/.test(MEDIA_SESSION),
    'the session song must be selected by the playhead, as the app does');
  assert.ok(/episodeCurrentTrack/.test(MEDIA_SESSION),
    'podcasts must use the position-aware episode track');
  assert.ok(/_srProgramTitle/.test(MEDIA_SESSION),
    'the programme at the playhead must be used');
  // Two lines on a car head unit: title = song, artist = programme + channel.
  //
  // WS15: the FALLBACK CHAIN differs by kind, because on an episode `cur.title`
  // is the EPISODE name while on a live channel it is the channel -- the two
  // fields are swapped. Asserted explicitly rather than as one literal string,
  // because a single regex over a combined expression cannot tell a podcast's
  // fallback from a radio channel's.
  assert.ok(/const metaTitle = songTitle \|\| programme \|\|/.test(MEDIA_SESSION)
    && /cur\.kind === 'episode' \? cur\.title : channel/.test(MEDIA_SESSION),
  'the title must prefer the song, then the programme, then (episode name on a podcast / channel on radio)');
  assert.ok(/songArtist/.test(MEDIA_SESSION) && /programme, channel/.test(MEDIA_SESSION),
    'the artist line must carry the song artist plus programme and channel');
  // ---- WS15: the podcast may never repeat the episode name ----
  // Measured live on P3 Soul (pod 2680): with the old mapping an episode put
  // `cur.title` (the episode name) in BOTH title and artist, because
  // `programme` is only ever set for a live channel. The Volvo rendered the
  // same string on both lines, which the owner reported as the episode title
  // appearing twice.
  assert.ok(/cur\.kind === 'episode'/.test(MEDIA_SESSION)
    && /cur\.programName \|\| cur\.subtitle \|\| 'Min Radio'/.test(MEDIA_SESSION),
  "for a podcast the artist/channel line must be the PODCAST name, not the episode name");
  assert.ok(/const album = cur\.kind === 'live' \? channel : \(cur\.title \|\| 'Min Radio'\)/.test(MEDIA_SESSION),
    'the album must carry the EPISODE name on a podcast, the channel on radio');
  assert.ok(/^\s*album,$/m.test(MEDIA_SESSION),
    'the computed album must actually be passed to MediaMetadata, not left as a dead const');
  // ---- WS15b: the podcast name must not ALSO stay in the player header ----
  // Measured at 390px on P3 Soul before the fix: header title 167.1px CLIPPED,
  // header sub "P3 Soul" 35.0px CLIPPED, and the new .player-podcast-name
  // showing "P3 Soul" a second time above the pill. The name appeared twice and
  // BOTH copies were truncated.
  //
  // The cause is structural: for an episode `cur.subtitle` IS the podcast name,
  // while for a live channel `cur._srProgramTitle` is the PROGRAMME name and is
  // genuinely wanted. So the sub line is dropped for episodes only. Asserted
  // as a live-conditional rather than "absent", because radio must keep it.
  const headerBuild = stripComments(region('const headerLine = el(', '$player.appendChild(headerLine);', APP_JS));
  // ---- WS19: the header now has a live branch AND a podcast branch ----
  // The owner removed the bold duplicate, so the header is a single text cell.
  // A podcast still needs that cell filled (it carried no `.player-sub`
  // before, because the mini-bar style used `.player-podcast-name` instead) --
  // WS19 gives the podcast the same element so the two kinds match. The
  // COUNT guard is the one that matters and it is unchanged: exactly one
  // `.player-sub` in the header, so a second unconditional copy cannot be
  // added alongside the branches, which is precisely how the duplication was
  // reintroduced in the first place.
  assert.ok(/cur\._srProgramTitle \|\| cur\.subtitle \|\| 'Direkt'/.test(headerBuild),
    "radio must keep the resolved programme in the header sub line");
  assert.ok(/cur\.title/.test(headerBuild),
    'the podcast arm of the header ternary must be the EPISODE name, cur.title (WS20)');
  assert.ok(!/cur\.programName/.test(headerBuild),
    'the podcast name must NOT be in the header: it duplicates the meta row (WS20)');
  // ---- WS19: two literals, one rendered element ----
  // The header is a single `live ? ... : ...` ternary, so the podcast arm fills
  // the same cell the radio arm uses and the DOM still holds ONE `.player-sub`.
  // A literal count of 1 was correct when there was one arm and is wrong now,
  // so the structure is asserted instead: both occurrences must be the two arms
  // of that one ternary, and a third unconditional copy beside it -- which is
  // precisely how the duplication was originally reintroduced -- must not
  // exist. See the WS5 Item 1 test for the same argument in full.
  assert.strictEqual((headerBuild.match(/class: 'player-sub'/g) || []).length, 2,
    'the header must have exactly two .player-sub literals: the two arms of one ternary (WS19)');
  assert.ok(/live\s*\n?\s*\? el\('div', \{ class: 'player-sub'/.test(headerBuild),
    'the radio arm of the header ternary must be a .player-sub (WS19)');
  assert.ok(/:\s*el\('div', \{ class: 'player-sub'/.test(headerBuild),
    'the podcast arm must fill the same .player-sub cell (WS19)');
  // The minimised bar had the same duplication and needs the same treatment,
  // with the podcast name taking the sub line's place so no gap is left.
  const miniBuild = stripComments(region('const mini = el(', '$player.appendChild(mini);', APP_JS));
  assert.ok(/live\s*\n?\s*\? el\('div', \{ class: 'player-sub'/.test(miniBuild),
    'the minimised bar sub line must be live-conditional too (WS15b)');
  assert.ok(/!live\s*\n?\s*\? el\('div', \{ class: 'player-podcast-name'/.test(miniBuild),
    'the minimised bar must show the podcast name where the sub line was (WS15b)');
  assert.strictEqual((miniBuild.match(/class: 'player-podcast-name'/g) || []).length, 1,
    'the minimised bar must render .player-podcast-name exactly once');
  // paintProgramTitle writes into .player-sub and must stay live-gated, or it
  // would throw on an episode where the sub line no longer exists.
  const PPT = stripComments(region('function paintProgramTitle()', 'function playheadWallMs()', APP_JS));
  assert.ok(/cur\.kind === 'live' && cur\._srProgramTitle/.test(PPT),
    'paintProgramTitle must stay live-gated: an episode no longer has a sub line');
  // The podcast name must also appear in the compact player, and only for an
  // episode -- a live channel already shows channel + programme in the header.
  const podNameEl = stripComments(region('const podcastName =', 'const meta = el(', APP_JS));
  assert.ok(/!live && \(cur\.programName \|\| cur\.subtitle\)/.test(podNameEl),
    'the podcast name element must exist for episodes only');
  // WS16: the podcast name is no longer a DIRECT child -- it is the identity
  // element inside .player-meta-row, and the quality pill is the second row.
  // The ordering requirement (name above the pill) is unchanged.
  // Ended on `const expandBtn` -- the next real declaration after the
  // .player-meta construction.
  //
  // THREE end markers were tried and all three were wrong, which is worth
  // recording because the failure mode is silent rather than red:
  //   '// Row 2' sits INSIDE the el() call, before `quality);`, so the slice
  //     stopped short of the text being asserted;
  //   '// Fas 4' and 'Fas 4 (redesign' are COMMENT text, and this slice is
  //     stripped of comments, so they are not present in it at all and
  //     indexOf returned -1 -- region() then ran to the end of the bundle.
  // A comment is a valid START marker (it is in the raw source) but never a
  // valid END marker for a region that gets stripComments()ed. Always end on
  // code.
  const metaBuild = stripComments(region('const identityName =', "const expandBtn = el('button'", APP_JS));
  assert.ok(/el\('div', \{ class: 'player-meta' \},\s*metaRowTop,/.test(metaBuild)
    && /quality\);/.test(metaBuild),
  'the podcast name must be in row 1 of .player-meta, above the quality pill (WS16)');
  // `\s*` after the comma, not a literal space: the construction wraps
  // `metaRowTop` onto the next line, and a space-literal regex silently
  // matched nothing -- an assertion that can never pass is worse than no
  // assertion, because it looks like coverage.
  assert.ok(/const identityName = isLive[\s\S]*?: podcastName;/.test(metaBuild),
    "a podcast's identity element must be the podcast name element (WS16)");
  // It must NOT reuse .player-sub: that is load-bearing (paintProgramTitle
  // writes into it, the WS0 snapshot reads it). Writing there would fight the
  // programme painter and re-truncate the name to "P3 ..." -- the symptom the
  // owner screenshotted.
  assert.ok(!/class: 'player-sub'/.test(podNameEl),
    'the podcast name must not reuse .player-sub');
  // Artwork: real artwork when it exists, then the track image, then the icon.
  // Episodes deliberately set artwork: null, so nothing is invented.
  // WS26: the first term is now the one resolver, which is what the lock screen
  // must read (it used to read the raw on-air field, so behind live the car and
  // the phone showed different songs -- R6 in a third place). The CHAIN and its
  // ORDER are the property, so all three rungs are asserted and the order too.
  // The chain is written across three lines with the `||` leading each
  // continuation, so it is matched with [\s\S]*? rather than a single-line
  // pattern that would never have matched the real formatting.
  const chain = /const artworkSrc = [\s\S]*?\|\|\s*cur\.artwork\s*\|\|\s*'icons\/icon-512\.png';/.exec(MEDIA_SESSION);
  assert.ok(chain, 'artwork must fall back in order and never be invented');
  assert.ok(/head \? head\.artwork : null/.test(chain[0]),
    'the first rung must be the position-aware resolver');
  assert.ok(chain[0].indexOf('head.artwork') < chain[0].indexOf('cur.artwork')
    && chain[0].indexOf('cur.artwork') < chain[0].indexOf('icon-512.png'),
    'the fallback order must be resolver -> programme image -> icon');
  // sizes/type must stay correct.
  assert.ok(/sizes: '512x512'/.test(MEDIA_SESSION) && /type: 'image\/png'/.test(MEDIA_SESSION),
    'the artwork sizes/type fields must stay correct');
});

test('WS11 Part C: the session is REFRESHED when the metadata changes', () => {
  // The half that is easy to miss: all seven updateMediaSession() call sites
  // fire on track load / stop / playstate. None fires on a song or programme
  // change, so fixing the fields alone leaves the car screen stale forever.
  const PN = stripComments(region('function paintNowPlaying()', 'function paintProgramTitle()', APP_JS));
  const PT = stripComments(region('function paintProgramTitle()', 'function playheadWallMs()', APP_JS));
  assert.ok(/updateMediaSession\(\);/.test(PN),
    'a song change must refresh the MediaSession');
  assert.ok(/updateMediaSession\(\);/.test(PT),
    'a programme change must refresh the MediaSession');
  // ---- WS15: the call must be UNGATED, and there must be no early return ----
  // This is the assertion whose absence let the podcast bug survive two
  // workstreams. The two assertions above only prove the call EXISTS, so they
  // pass just as happily behind `if (cur.kind === 'live')` -- which is exactly
  // what it was. A test that cannot tell a gated call from an ungated one is
  // not a test of the behaviour.
  //
  // The bug had TWO independent causes, and fixing either alone leaves the
  // other: (1) the `kind === 'live'` gate below, and (2) an `if (isEpisode)
  // return;` earlier in the same function, which returned BEFORE the call.
  // Both are asserted, because both were present.
  assert.ok(/if \(cur\) updateMediaSession\(\);/.test(PN),
    'the song-change refresh must be UNGATED -- a live-only gate silently '
    + 'stops every podcast from reaching the car (WS15)');
  assert.ok(!/if \(cur && cur\.kind === 'live'\) updateMediaSession\(\)/.test(PN),
    'the live-only gate must not come back (WS15)');
  assert.ok(!/return;/.test(PN.slice(PN.indexOf('panel._srRepaint'))),
    'nothing may return from paintNowPlaying before the MediaSession refresh; '
    + 'an `if (isEpisode) return;` after the panel repaint is what blocked podcasts (WS15)');
  // Loop safety: both painters run on timeupdate (~4/s). They must only be
  // called on a CHANGE -- that is the caller's existing change-detection, so
  // the hook must not add an unconditional path.
  assert.ok(PN.includes('pickByPosition'), 'the song painter selects by position');
  // setPositionState must stay correct for live streaming.
  // Anchor on the FUNCTION, not on a line inside it: a region that starts
  // mid-function silently produces an empty slice, and an assertion over an
  // empty slice is either trivially true or misleadingly red. This one was
  // misleadingly red -- the duration IS reported, it was just above my anchor.
  const PS = stripComments(region('function syncMediaPosition()', 'function startPositionSync()', APP_JS));
  assert.ok(/duration: isLive \? Infinity/.test(PS),
    'the position state must still report a live duration of Infinity');
  assert.ok(!/windowSeconds|seekableEnd/.test(PS),
    'the position state must not gain a DVR-window field');
});

test('WS11: out of scope -- every seek and position function is byte-identical', () => {
  // NO `||` fallbacks between assertions.
  assert.ok(APP_JS.includes('const DVR_MIN_WINDOW_S = 60;'), 'DVR_MIN_WINDOW_S must be byte-identical');
  assert.ok(APP_JS.includes('const LIVE_EDGE_TOLERANCE_S = 10;'), 'LIVE_EDGE_TOLERANCE_S must be byte-identical');
  const SEEK_BY = stripComments(region('function seekBy(deltaSeconds)', '// Fetch today', APP_JS));
  assert.ok(/const upper = Number\.isFinite\(cur\.seekableEnd\)\s*\? Math\.max\(start, cur\.seekableEnd - LIVE_EDGE_TOLERANCE_S\)\s*: Infinity;/.test(SEEK_BY),
    'the seekBy clamp must be byte-identical');
  const SPT = stripComments(region('function seekToProgramTime(startMs)', "['waiting', 'stalled'].forEach", APP_JS));
  assert.ok(/if \(target < start\) \{/.test(SPT), 'the seekToProgramTime guard must be byte-identical');
  assert.ok(/showToast\('Programmet ligger utanför spolbart område \(3 timmar\)\.'\);/.test(SPT),
    'the out-of-window toast must be byte-identical');
  // The WS9 position machinery and the working skip lookup are untouched.
  assert.ok(/function playheadWallMs\(\)/.test(APP_CODE), 'playheadWallMs must be untouched');
  assert.ok(/function pickByPosition\(entries, atMs\)/.test(APP_CODE), 'pickByPosition must be untouched');
  const SYNC = stripComments(region('const syncNext = () => {', 'if (prevEv) syncNext();', APP_JS));
  assert.ok(/ev\.startMs > playheadMs\s*\n?\s*&& ev\.startMs <= nowMs/.test(SYNC),
    'the programme-skip lookup must be byte-identical -- the button works');
  assert.ok(/const prevEv = programBoundary\(schedule, posMs\(\), -1\);/.test(APP_CODE),
    'the backwards lookup must be byte-identical');
  // WS5's attribution footer stays gone.
  assert.ok(!/class: 'attribution'/.test(APP_CODE), 'the WS5 attribution footer must not return');
});

// ---------------------------------------------------------------------------
// WS11a - the close and chevron belong on the controls row
// ---------------------------------------------------------------------------

// WS12: the spacer is gone (the real button is back), so the header region is
// anchored on headerLine again. region() searches FORWARD, so anchoring on the
// removed `const headerSpacer` declaration silently began after the element
// under test and could never see it -- that trap fired in WS11a.
// Anchored on the SPACER's own declaration. region() searches FORWARD from
// the start marker, so a region opened at `const headerLine` begins AFTER
// `const headerSpacer` and can never see it -- which is exactly what happened
// here: the test asserted the spacer was absent from a slice that started
// after it. Anchor on the element under test.
const HEADER_ROW_WS12 = stripComments(region(
  'const headerSpacer = el(', '$player.appendChild(headerLine);', APP_JS));
const CONTROLS_WS11A = stripComments(region(
  'const controls = el(', '// Wire program-skip buttons', APP_JS));

test('WS14 Part B: the header spacer IS the artwork column, and it is width-only', () => {
  // Exactly ONE element of --player-art width may occupy the artwork column.
  // WS14 restored the close button to the header, right-grouped, so the column
  // is held by the width-only SPACER again and NOT by the button (the buttons
  // are 32px, and sit after the text, so they do not define the column).
  // Leaving the button AND the spacer both at --player-art would add 44px of
  // dead space and push the text RIGHT of the artwork edge, past the quality
  // pill and the song line. Both the presence of the spacer and the ABSENCE of
  // an --player-art-wide button are asserted deliberately.
  assert.ok(/player-header-spacer/.test(HEADER_ROW_WS12),
    'the header must still contain a spacer in the artwork column');
  assert.ok(/closeBtn/.test(HEADER_ROW_WS12),
    'the close button must be in the header row (WS14)');
  assert.ok(/expandBtn/.test(HEADER_ROW_WS12),
    'the chevron must be in the header row (WS14)');
  assert.ok(!/player-btn-close[\s\S]*?width: var\(--player-art\)/.test(
    stripComments(region('.player-header {', '.player-row {', STYLES_WS5))),
  'no header button may be --player-art wide, or the text is pushed off the pills\' edge');
  // ---- WS19: the anchor is now `.player-sub`, not `.player-title` ----
  // The bold channel title left the header, so it can no longer be the probe
  // for "the text starts on the artwork edge". The requirement is unchanged and
  // the header's only text cell is now `.player-sub`, so that is the anchor.
  // The spacer must still come FIRST, or the text starts at x=0 instead of at
  // the artwork's right edge -- the alignment WS5b exists to hold.
  assert.ok(HEADER_ROW_WS12.indexOf('headerSpacer') < HEADER_ROW_WS12.indexOf('player-sub'),
    'the spacer must be the FIRST cell, so the text starts on the artwork edge (WS19: anchored on .player-sub)');
  assert.ok(!/player-title/.test(HEADER_ROW_WS12),
    'the bold title must NOT be back in the header (WS19)');
  assert.ok(HEADER_ROW_WS12.indexOf('player-sub') < HEADER_ROW_WS12.indexOf('expandBtn'),
    'the button pair must come AFTER the texts, to look like the minimised bar');
  assert.ok(HEADER_ROW_WS12.indexOf('expandBtn') < HEADER_ROW_WS12.indexOf('closeBtn'),
    'the pair must be ordered chevron then close, like the minimised bar');
  // The column is held by the SPACER's width, derived from --player-art.
  // The region ends at the WS14 button rules, not at .player-title: those
  // rules carry a deliberate 32px, and widening the region would make this
  // guard fire on the buttons' width instead of the spacer's.
  const rule = stripComments(region(
    '.player-header .player-header-spacer {', '.player-header .player-expand-btn,', STYLES_WS5));
  assert.ok(/width: var\(--player-art\)/.test(rule),
    'the spacer must occupy the artwork column, derived from --player-art');
  assert.ok(!/width: \d+px/.test(rule),
    'the spacer width must NOT be a hard-coded pixel literal');
  assert.ok(/flex: none/.test(rule), 'the spacer must not be squeezed by the texts');
  // WIDTH-ONLY. This is the part WS11a got wrong in spirit: a height here
  // silently keeps a row of buttons tall, which is what the owner is asking us
  // to remove. Asserted negatively so it cannot creep back.
  assert.ok(!/height:/.test(rule),
    'the spacer must carry NO height, or the header cannot get shorter');
  // The artwork must still be the source of that column, or the number lies.
  const thumb = stripComments(region('.player-thumb {', '.player-thumb img', STYLES_WS5));
  assert.ok(/width: var\(--player-art\)/.test(thumb),
    'the artwork must still be sized from --player-art');
});

test('WS12 Part B: the controls row carries the TRANSPORT only', () => {
  // This test's original DIAGNOSIS was right and stayed right through WS13:
  // `.player-quality` is not in the controls row -- it is built inside `meta`,
  // and `meta` is a sibling of `thumb` and `controls` inside .player-row. So
  // extra 44px buttons in the controls row squeezed .player-meta instead of
  // overflowing the row: measured at 390px in the DVR state, meta went to 0px,
  // the row overflowed 388 > 358 and the pill wrapped to two lines.
  //
  // What WS13 got wrong was the CURE. It kept the buttons in the row anyway, on
  // the strength of a comma-less clause in a brief. The owner then reported the
  // cramping on their phone, and WS14 restored the header arrangement. So the
  // diagnosis is now the assertion: the controls row carries TRANSPORT ONLY.
  //
  // Measured at 390px, DVR state, both arrangements:
  //   header buttons (WS14): 44+12+meta+12+224 = 358, exactly the row width
  //   transport buttons (WS13): 44+12+0+12+304 = 372 > 358, overflowing 14px
  // .player-meta is `flex: 1 1 0%` with `min-width: 0`, so it absorbs the whole
  // deficit to 0 and never pushes back -- the row overflows instead of the
  // text truncating.
  assert.ok(!/controls\.appendChild\(expandBtn\)/.test(CONTROLS_WS11A),
    'the chevron must NOT be on the controls row (WS14)');
  assert.ok(!/controls\.appendChild\(closeBtn\)/.test(CONTROLS_WS11A),
    'the close button must NOT be on the controls row (WS14)');
  // The transport itself is untouched: at most five buttons, in order.
  ['prevProgramBtn', 'backBtn', 'playPause', 'fwdBtn', 'nextProgramBtn']
    .forEach((b) => {
      assert.ok(CONTROLS_WS11A.includes(`controls.appendChild(${b})`),
        `.player-controls must still carry ${b}`);
    });
  assert.ok(CONTROLS_WS11A.indexOf('controls.appendChild(playPause)')
    < CONTROLS_WS11A.indexOf('controls.appendChild(fwdBtn)'),
    'the play button must stay between the two 15s buttons');
  // The header-scoped rules are LIVE again, because the buttons are. Asserted
  // present rather than absent: a button with no sizing rule silently stops
  // being sized, and if the rule were ever written as var(--player-art) the
  // text would be pushed off the pills' edge.
  const row = stripComments(region('.player-header {', '.player-row {', STYLES_WS5));
  assert.ok(/\.player-header \.player-btn-close/.test(row),
    'the header-scoped close rule must be present with the button (WS14)');
  assert.ok(/\.player-header \.player-expand-btn/.test(row),
    'the header-scoped chevron rule must be present with the button (WS14)');
  assert.ok(/\.player-header \.player-header-spacer/.test(row),
    'the spacer rule must hold the artwork column alongside them');
  // REGRESSION GUARD, added in WS14 after the owner saw the defect: the two
  // symptoms that are actually detectable. `document.scrollWidth >
  // window.innerWidth` is FALSE in every broken case, because flex items
  // shrink rather than overflow the document -- measuring the row itself is
  // the only way to see this.
  assert.ok(/\.player-meta \{ min-width: 0; flex: 1; \}/.test(stripComments(STYLES_WS5)),
    '.player-meta must keep min-width:0 + flex:1, the cause of the 0px squeeze');
});

test('WS12 Part B: the pills degrade by clipping, never by wrapping', () => {
  // DEFENCE IN DEPTH, and explicitly NOT the cure -- the cure is the width.
  // `.player-title` and `.player-sub` both set nowrap, so they ellipsized when
  // squeezed. `.player-quality` and `.player-mode` did not, so they wrapped into
  // a two-line pill, which is what the owner photographed. Assert the guard so
  // the same failure cannot come back silently even if a layout change squeezes
  // the column again.
  //
  // WS16: the start marker is now '\n' + sel, not sel. WS16 added a COMPOUND
  // selector (`.player-meta-row > .player-mode`) which CONTAINS the base
  // selector as a substring, and region() searches forward -- so a bare
  // '.player-mode {' matched the compound rule's tail and returned three
  // properties instead of the real styling. Anchoring on the line start is the
  // fix that does not depend on selector naming: a bare base rule always
  // begins its own line, and a compound selector never does.
  ['.player-quality {', '.player-mode {'].forEach((sel) => {
    const rule = stripComments(region('\n' + sel, '\n}', STYLES_WS5));
    assert.ok(/white-space: nowrap/.test(rule),
      `${sel} must set white-space: nowrap so a narrow column clips rather than wraps`);
    assert.ok(/text-overflow: ellipsis/.test(rule),
      `${sel} must ellipsize rather than wrap`);
  });
  // And the cure's precondition: the texts already had it, so this is parity.
  ['.player-title {', '.player-sub {'].forEach((sel) => {
    const rule = stripComments(region('\n' + sel, '\n}', STYLES_WS5));
    assert.ok(/white-space: nowrap/.test(rule), `${sel} must keep its nowrap`);
  });
  // WS16: the base pill rules must remain the ONLY place these are declared.
  // A second bare block for either selector would shadow the real one for any
  // forward search, which is how the WS15 quality pill briefly lost its
  // styling.
  assert.strictEqual((STYLES_WS5.match(/^\.player-quality \{/gm) || []).length, 1,
    '.player-quality must be declared exactly once as a bare rule');
  assert.strictEqual((STYLES_WS5.match(/^\.player-mode \{/gm) || []).length, 1,
    '.player-mode must be declared exactly once as a bare rule');
  // ---- WS16: the pill must OCCUPY ROW 2, and that must be asserted ----
  // Mutation Q3 reverted `.player-quality` to `display: inline-block` and the
  // whole suite stayed GREEN. Nothing asserted the WS16 row geometry, so the
  // single change the workstream exists for was unobservable. Source order
  // would in fact still put the pill on row 2 in the built DOM, which is
  // exactly why this is a real requirement and not a style preference: the
  // layout must not depend on an accident of sibling order.
  const qRule = stripComments(region('\n.player-quality {', '\n}', STYLES_WS5));
  assert.ok(/display: block/.test(qRule),
    '.player-quality must be display:block so it occupies row 2 of .player-meta (WS16)');
  assert.ok(/width: max-content/.test(qRule),
    '.player-quality must be width:max-content so the pill keeps its shape (WS16)');
  // Row 1 must be a real flex row: `margin-left: auto` on the time state only
  // reaches the right edge inside a flex line. Without this the pill sits
  // immediately after the name -- a regression no text assertion would catch.
  const rowRule = stripComments(region('\n.player-meta-row {', '\n}', STYLES_WS5));
  assert.ok(/display: flex/.test(rowRule),
    '.player-meta-row must be display:flex (WS16)');
  assert.ok(/min-width: 0/.test(rowRule),
    '.player-meta-row must keep min-width:0 so the name shrinks, not the pill');
  const modeRule = stripComments(region('\n.player-meta-row > .player-mode {', '\n}', STYLES_WS5));
  assert.ok(/margin-left: auto/.test(modeRule),
    'the time state must be pushed right by margin-left:auto (WS16)');
});

test('WS11a: the buttons survive the move intact', () => {
  // A move is exactly where an aria-label or a handler gets lost. The owner
  // closes the player with this button; if the handler were dropped the button
  // would still look right and do nothing.
  const closeDecl = stripComments(region("const closeBtn = el('button', {", '});', APP_JS));
  assert.ok(/'aria-label': 'Stäng spelaren'/.test(closeDecl),
    'the close button must keep its aria-label');
  assert.ok(/onclick: stopAndClosePlayer/.test(closeDecl),
    'the close button must keep its handler');
  const expandDecl = stripComments(region("const expandBtn = el('button', {", '});', APP_JS));
  assert.ok(/class: 'player-btn player-expand-btn'/.test(expandDecl),
    'the chevron must keep its class (setExpandOpen queries it)');
  assert.ok(/'aria-label'/.test(expandDecl),
    'the chevron must keep an aria-label');
  // The chevron is positioned in the expanded player from two places, and the
  // move must not have orphaned either.
  assert.ok(/function setExpandOpen\(open\) \{[\s\S]*?querySelector\('\.player-expand-btn'\)/.test(APP_CODE),
    'setExpandOpen must still find the chevron inside $player');
  assert.ok(/onExpand: \(\) => expandBtn\.click\(\)/.test(APP_CODE),
    'the expand gesture must still reach the button');
  // The gesture that expands must still work: the button is in the controls row
  // now, but the drag target is the player surface, not the button.
  assert.ok(/installPlayerGestures|enablePlayerGestures/.test(APP_CODE),
    'the player gestures must survive the layout change');
});

test('WS12: hard boundaries -- setExpandOpen, the mini-bar and the paint targets', () => {
  // setExpandOpen is the SOLE writer of aria-expanded; it was not touched.
  assert.ok((APP_CODE.match(/function setExpandOpen\(open\)/g) || []).length === 1,
    'setExpandOpen must exist exactly once and be unedited');
  assert.ok(/setExpandOpen\(true\)|setExpandOpen\(false\)|setExpandOpen\(open\)/.test(APP_CODE),
    'its call sites must survive');
  // The minimised bar is out of scope: same child order, same buttons.
  const mini = stripComments(region("const mini = el('div', { class: 'player-mini' }", ');', APP_JS));
  assert.ok(/miniPlay/.test(mini) && /miniExpand/.test(mini) && /miniStop/.test(mini),
    'the mini-bar must keep all three of its buttons');
  assert.ok(mini.indexOf('miniPlay') < mini.indexOf('miniExpand')
    && mini.indexOf('miniExpand') < mini.indexOf('miniStop'),
    'the mini-bar order must stay play - chevron - close');
  assert.ok(/player-mini/.test(STYLES_WS5),
    'the mini-bar styles must be untouched');
  // The paint targets are the silent-failure trap named in the brief: these two
  // class names, inside $player, are what stop painting WITHOUT any test
  // failing if they are renamed or reparented.
  assert.ok(/querySelector\('\.player-sub'\)/.test(APP_CODE),
    'paintProgramTitle must still query .player-sub');
  assert.ok(/querySelector\('\.now-playing-line'\)/.test(APP_CODE),
    'paintNowPlaying must still query .now-playing-line');
  assert.ok(HEADER_ROW_WS12.includes("class: 'player-sub'"),
    '.player-sub must still be in the header, inside $player');
  // WS11 Part A must not come back: nothing new on the seek row.
  const seekRow = stripComments(region(
    "seekRow = el('div', { class: 'seek-row dvr-row' }", '// Drag state', APP_JS));
  assert.ok(!/windowReadout|dvr-window-readout/.test(seekRow),
    'the seek row must not regain the removed readout');
  // The WS5 attribution footer stays gone.
  assert.ok(!/class: 'attribution'/.test(APP_CODE),
    'the WS5 attribution footer must not return');
});

// ---------------------------------------------------------------------------
// WS17 - the podcast "already loaded" guard compared the wrong ids
// ---------------------------------------------------------------------------

test('WS17: the podcast guard compares podcast ids, never the episode id', () => {
  const PP = stripComments(region('async function playPodcast', 'function playNews', APP_JS));

  // THE DEFECT. The guard read:
  //   isCurrent('episode', programId) === false && ...
  // `programId` is the PODCAST id; isCurrent() compares state.current.id,
  // which for an episode is the EPISODE id. Different kinds of id, so the
  // check could never be true and the guard never asked its real question.
  assert.ok(!/isCurrent\('episode', programId\)/.test(PP),
    'the guard must NOT compare the podcast id against the episode id (WS17)');
  assert.ok(!/isCurrent\(/.test(PP),
    'playPodcast must not use isCurrent() at all -- its `id` argument is an '
    + 'episode id for an episode track, and `programId` is a podcast id (WS17)');

  // What it must compare instead: the two values that ARE the same kind.
  assert.ok(/audioEl\._podProgramId === programId/.test(PP),
    'the guard must compare _podProgramId (the podcast id) with programId');
  // And it must only toggle when an EPISODE is what is actually loaded. The
  // reported symptom was the tap acting on the live channel instead.
  assert.ok(/state\.current\.kind === 'episode'/.test(PP),
    'the toggle must be gated on the loaded track being an episode (WS17)');
  assert.ok(/toggleTrack\(state\.current\)/.test(PP),
    'the toggle must act on the loaded track');
});

test('WS17: the podcast fetch is single-flight, and always released', () => {
  const PP = stripComments(region('async function playPodcast', 'function playNews', APP_JS));

  // Two taps before the first fetch resolved ran two fetches; whichever
  // resolved last won. That is a plausible contributor to "it does not start",
  // because the second playTrack can land after the user has given up.
  assert.ok(/if \(podFetchInFlight === programId\) return;/.test(PP),
    'a second tap for the same podcast must not start a second fetch (WS17)');
  assert.ok(/podFetchInFlight = programId;/.test(PP),
    'the in-flight slot must be claimed before awaiting');

  // Released in a finally, NOT on the success path. Clearing only on success
  // turns one network error into "this podcast never plays again".
  assert.ok(/finally \{/.test(PP),
    'the in-flight slot must be released in a finally (WS17)');
  const tail = PP.slice(PP.indexOf('finally {'));
  assert.ok(/if \(podFetchInFlight === programId\) podFetchInFlight = null;/.test(tail),
    'the finally must release the slot, and only its OWN slot (WS17)');

  // The state must be cleared with the player, or a stale podcast id outlives
  // the thing it describes.
  const STOP = stripComments(region('function stopAndClosePlayer', 'function updatePlayingMarks', APP_JS));
  assert.ok(/audioEl\._podProgramId = null;/.test(STOP),
    'closing the player must clear _podProgramId (WS17)');
  assert.ok(/podFetchInFlight = null;/.test(STOP),
    'closing the player must clear the in-flight slot (WS17)');

  // Declared before first use. A `let` beside playPodcast() is only safe
  // because stopAndClosePlayer() runs after the IIFE body evaluates -- an
  // accident, not a guarantee, and a temporal-dead-zone error the moment that
  // assumption changes.
  const decl = APP_JS.indexOf('let podFetchInFlight');
  const firstUse = APP_JS.indexOf('podFetchInFlight');
  assert.ok(decl !== -1, 'podFetchInFlight must be declared with let');
  assert.ok(decl < firstUse, 'podFetchInFlight must be declared before its first use (WS17)');
  assert.ok(decl < APP_JS.indexOf('function stopAndClosePlayer'),
    'podFetchInFlight must be declared before stopAndClosePlayer, which clears it (WS17)');
});

// ===================================================================
// WS18: a DVR window that reaches back past local midnight.
// ===================================================================
// The owner reported that dragging the P3 seek bar back stopped changing the
// programme title. The measured cause was NOT the drag handler and NOT the
// `seeked` event: `fetchSchedule` requested TODAY ONLY, while
// `playheadWallMs()` maps a DVR position to a WALL-CLOCK time. With a 3-hour
// window that is routinely yesterday's date after midnight, so
// `pickByPosition(cur._srSchedule, ...)` found nothing, `_srProgramTitle` was
// never updated, and the pill + clock still moved -- making the failure
// invisible except to someone who knew the programme had changed.
//
// These tests pin the two properties the fix depends on. They are source-text
// assertions on purpose: the merge is pure date arithmetic, and the honest
// failure mode here is a code shape that a browser test would not catch.

test('WS18: fetchSchedule must load yesterday as well as today', () => {
  const fn = stripComments(region('async function fetchSchedule(channelId) {',
    'function programBoundary('));
  assert.ok(/localDateStr\(\)/.test(fn), 'today must still be requested');
  assert.ok(/localDateStrOffset\(1\)/.test(fn),
    'yesterday must be requested too -- a DVR window can reach past midnight');
});

test('WS18: yesterday is fetched ONLY when the window can actually reach it', () => {
  const fn = stripComments(region('async function fetchSchedule(channelId) {',
    'function programBoundary('));
  // A channel with no DVR state must not pay for a second request per play.
  assert.ok(/seekableStart/.test(fn),
    'the yesterday decision must be derived from the DVR window, not unconditional');
  // The threshold must be a real time comparison in ms, not a truthiness test.
  assert.ok(/Number\.isFinite\(start\)/.test(fn),
    'a non-finite seekableStart must not be treated as a window');
  // ---------------------------------------------------------------------
  // WS26 SUPERSEDES the assertion below. The PROPERTY is unchanged -- yesterday
  // must load only when the window genuinely reaches back -- but the FORM of the
  // comparison is different, and the reason is recorded here rather than by
  // deletion.
  //
  // WAS:  /windowMs > 60 * 60 * 1000/
  //   "yesterday loads when the window reaches more than an hour back". At the
  //   owner's 01:19 with a 3 h window the window reaches back 2 h 41 m, so the
  //   hour threshold said "no" -- and the hour was never consulted. It was a
  //   stand-in for a question about MIDNIGHT that the formula could not ask.
  //
  // NOW:  timeSinceMidnightS < windowS -- two quantities in the same unit. "Has
  //   enough of the day elapsed that the window's oldest moment falls before
  //   local midnight?" No threshold, no fudge factor, and it self-adjusts to
  //   whatever the real window is. A 2 h window then covers hours 0-1 and a 6 h
  //   window covers 0-5, which the old formula could not do.
  //
  // The old regex would have PASSED a hardcoded 3-hour constant. These will not.
  assert.ok(/timeSinceMidnightS\s*<\s*windowS/.test(fn),
    'yesterday must load exactly when the window reaches before local midnight');
  assert.ok(!/windowMs\s*>\s*60\s*\*\s*60\s*\*\s*1000/.test(fn),
    'the superseded one-hour threshold must be gone -- it never consulted the clock');
  // ---- The gate must be WIRED, not merely present. ----
  // Mutation M3 replaced `if (!needsYesterday) return today || [];` with a
  // constant and the whole suite stayed GREEN: the two assertions above only
  // prove the arithmetic is written down, not that anything consults it. So
  // the return that skips the second request is asserted against the varia
  // ble the arithmetic feeds, which is the only version of this change that
  // actually saves a request.
  //
  // ---- WS21 SUPERSEDES the assignment's left-hand side; WS26 supersedes it again ----
  // WS18 assigned `needsYesterday = windowMs > 1h`. Measured live at 01:55,
  // that gate NEVER opened: it is evaluated inside `resolveProgramTitle`,
  // which `playTrack` calls immediately, before any `loadedmetadata` has
  // populated the seekable range -- so `seekableStart` was still null,
  // `windowMs` was 0, and yesterday was never requested. WS21 added a clock
  // trigger. WS26 replaced the window term with a comparison against local
  // midnight, and -- the part that matters -- moved the window decision to a
  // point that actually runs after the window is known.
  //
  // The requirement that survives all three forms is the one this assertion was
  // really protecting: the WINDOW comparison must feed the decision, not be
  // computed and discarded. It is now a three-way branch, and each arm is
  // asserted separately so no arm can be quietly dropped.
  assert.ok(/const windowReachesYesterday = windowS == null/.test(fn),
    'the window comparison must be computed and named, not inlined away');
  assert.ok(/needsYesterday\s*=\s*windowReachesYesterday === null/.test(fn),
    'needsYesterday must branch on whether the window is known');
  assert.ok(/\?\s*pastMidnight\s*:\s*\(windowReachesYesterday \|\| pastMidnight\)/.test(fn),
    'unknown window -> clock; known window -> window first, clock second');
  // The wiring this whole test exists for: the flag that skips the second
  // request must still be the variable the arithmetic feeds.
  assert.ok(/if \(!needsYesterday\)/.test(fn),
    'the gate must still be WIRED -- consumed by the early return, not just computed');
  assert.ok(/META_DIAG\.lastScheduleGate\.fetchedDays = \['today'\]/.test(fn),
    'a closed gate must record that only today was fetched');
  // ---- WS21: the early return grew a body, so the assertion is on STRUCTURE ----
  // The one-line `if (!needsYesterday) return today || [];` became a block that
  // records the outcome before returning. Asserting the literal line would fail
  // on correct code, so the requirement is restated: the branch must be taken
  // on the VARIABLE, and it must return before the second request is issued.
  // Ordering is the part that matters -- a gate that runs after the fetch is
  // not a gate -- so the index of the branch is compared with the index of the
  // `localDateStrOffset(1)` call.
  assert.ok(/if \(!needsYesterday\) \{/.test(fn),
    'the second request must be gated on needsYesterday (M3: un-gating it is a no-op otherwise)');
  const branch = fn.indexOf('if (!needsYesterday)');
  const secondFetch = fn.indexOf('localDateStrOffset(1)');
  assert.ok(branch !== -1 && secondFetch !== -1,
    'both the gate and the second request must be present in fetchSchedule');
  assert.ok(branch < secondFetch,
    'the gate must be evaluated BEFORE the second request is issued (WS21)');
  // The skipped path must still return today's schedule, not fall through.
  assert.ok(/if \(!needsYesterday\) \{[\s\S]*?return today \|\| \[\];/.test(fn),
    'the early-return must still return today when yesterday is not needed (WS21)');
});

test('WS18: the two days must be merged SORTED, or the programme-skip breaks', () => {
  const fn = stripComments(region('async function fetchSchedule(channelId) {',
    'function programBoundary('));
  // pickByPosition and programBoundary BOTH assume start-order. An unsorted
  // merge (today first, then yesterday) would make the skip buttons pick the
  // wrong neighbour across the midnight boundary -- a NEW bug traded for the
  // one being fixed, and one that only shows up near midnight.
  assert.ok(/\.sort\(\(a, b\) => a\.startMs - b\.startMs\)/.test(fn),
    'the merged schedule must be sorted by startMs');
  // ... and both single-day fallbacks must survive, so an empty day does not
  // wipe out the other one (this is the bug class that has already bitten
  // writeFormerIfBetter in the other repo).
  assert.ok(/if \(!yesterday \|\| !yesterday\.length\) return today \|\| \[\]/.test(fn),
    'an empty yesterday must fall back to today, not to an empty schedule');
  assert.ok(/if \(!today \|\| !today\.length\) return yesterday/.test(fn),
    'an empty today must fall back to yesterday, not to an empty schedule');
});

test('WS18: a merged schedule spanning midnight resolves the right programme', () => {
  // Behavioural check of the property the merge exists to provide, using the
  // app's own containment rule from pickByPosition. This is the assertion that
  // would have failed before the fix.
  const pickByPosition = (entries, atMs) => entries
    .find((e) => e.startMs <= atMs && atMs < e.stopMs) || null;

  const yesterday = [
    { title: 'Gattos kväll', startMs: Date.parse('2026-09-26T19:00:00+02:00'), stopMs: Date.parse('2026-09-26T21:00:00+02:00') },
    { title: 'Vaken', startMs: Date.parse('2026-09-26T21:00:00+02:00'), stopMs: Date.parse('2026-09-27T00:00:00+02:00') },
  ];
  const today = [
    { title: 'Vaken forts.', startMs: Date.parse('2026-09-27T00:00:00+02:00'), stopMs: Date.parse('2026-09-27T03:00:00+02:00') },
  ];
  // The merge the fix performs, in the order it performs it.
  const merged = [...today, ...yesterday].sort((a, b) => a.startMs - b.startMs);

  // The live edge is ~00:30 on the 27th, with a 3h window reaching 21:30 on
  // the 26th. That position is in YESTERDAY's list -- the exact case the
  // owner hit, and the one a today-only schedule could not answer.
  const behindMidnight = Date.parse('2026-09-26T21:30:00+02:00');
  assert.equal(pickByPosition(merged, behindMidnight)?.title, 'Vaken',
    'a playhead before midnight must resolve from the merged schedule');
  assert.equal(pickByPosition(yesterday.length ? today : [], behindMidnight), null,
    'a today-only schedule CANNOT answer a pre-midnight position (the regression)');

  // Sorting is what keeps the skip buttons correct. The boundary lookup finds
  // "the last event starting before the position" by REVERSING the array, so
  // an unsorted merge ([...today, ...yesterday]) searches the wrong end.
  //
  // The discriminating case is early morning, just after midnight, when the
  // correct answer is in TODAY's list while the list also holds YESTERDAY's.
  // At 01:00 the last programme to have started is the 00:00 one, and the
  // sorted merge finds it. The unsorted merge reverses to
  // [Vaken(21:00), Gattos(19:00), Vaken forts.(00:00)], so the FIRST entry
  // already satisfies the predicate: it returns the previous evening's 21:00
  // broadcast, and skip-back jumps back four hours instead of landing on the
  // start of what was actually on air. Both entries belong to the same show,
  // so this never looks like a crash -- it just lands in the wrong place.
  const afterMidnight = Date.parse('2026-09-27T01:00:00+02:00');
  const boundaryBefore = (list) => [...list].reverse()
    .find((ev) => ev.startMs < afterMidnight - 1000);
  assert.equal(boundaryBefore(merged).title, 'Vaken forts.',
    'a sorted merge finds the programme that was on air at the playhead');
  assert.equal(boundaryBefore([...today, ...yesterday]).title, 'Vaken',
    "an UNSORTED merge returns yesterday's evening entry instead (why .sort() is required)");
  // ...and the boundaries must be contiguous, or a 1s gap becomes unresolvable.
  for (let i = 1; i < merged.length; i += 1) {
    assert.equal(merged[i].startMs, merged[i - 1].stopMs,
      `merged schedule must be contiguous at index ${i}`);
  }
});

test('WS18: the song-row CSS must make the song truncate and the pill stick right', () => {
  // Without these, `.player-time-row` is a plain block: the pill would sit
  // immediately after the song text instead of at the row's right-hand end,
  // and a long song+artist string would push the pill off the right edge
  // instead of ellipsising. The whole point of the change is the geometry, and
  // the JS assertions above cannot see it.
  const row = region('.player-time-row {', '.player-time-row .now-playing-line {', STYLES_WS5);
  assert.ok(/display:\s*flex/.test(row), '.player-time-row must be a flex line');
  assert.ok(/align-items:\s*center/.test(row), 'the pill must be vertically centred');
  assert.ok(/margin-left:\s*var\(--player-col\)/.test(row),
    'the row carries the player indent, so the song is not indented twice');
  const song = region('.player-time-row .now-playing-line {', '.player-time-row > .player-mode {', STYLES_WS5);
  assert.ok(/flex:\s*1 1 auto/.test(song),
    'the song must take the leftover space so the pill is pushed right');
  assert.ok(/min-width:\s*0/.test(song),
    'the song needs min-width:0 or the flex item refuses to shrink below its text');
  assert.ok(/margin-left:\s*0/.test(song),
    "the row owns the indent now; the song must not re-apply .now-playing-line's own margin");
  const pill = region('.player-time-row > .player-mode {', '.player-mini .now-playing-line', STYLES_WS5);
  assert.ok(/margin-left:\s*auto/.test(pill),
    'the pill must be pushed to the right-hand end of the song row');
  assert.ok(/flex:\s*none/.test(pill),
    'the pill must never be squeezed or wrapped by a long song');
});

// ===================================================================
// WS19: pill hidden by a long song, the missing .player-time-song rule,
// the bold header duplicate, and the lock-screen artist.
// ===================================================================

test('WS19: .player-time-song MUST have a CSS rule with min-width:0', () => {
  // THE BUG, measured not inferred: `app.js` builds
  //   .player-time-row > .player-time-song > .now-playing-line
  // but only a COMMENT ever described `.player-time-song`. With no rule it was
  // a plain block flex item, so `min-width` resolved to `auto` and it refused
  // to shrink below its text. A 455px song then pushed the pill to
  // right=577px on a 390px viewport -- 187px off-screen, i.e. invisible.
  //
  // The WS18 test suite passed the whole time, because every assertion looked at
  // `.player-time-row .now-playing-line` and never at the WRAPPER. The wrapper
  // is the flex item; the line is a block inside it. Giving the line
  // `min-width: 0` cannot help, so this asserts the wrapper directly.
  const wrap = region('.player-time-song {', '.player-time-row .now-playing-line {', STYLES_WS5);
  assert.ok(wrap.includes('min-width: 0'),
    '.player-time-song needs min-width: 0 or it refuses to shrink and pushes the pill off-screen (WS19)');
  assert.ok(/flex:\s*1 1 auto/.test(wrap),
    '.player-time-song must be the growing flex child');
  assert.ok(/overflow:\s*hidden/.test(wrap),
    '.player-time-song must clip, or the rolling text paints over the pill (WS19)');
  // A rule that exists but is empty would satisfy an `includes` check above,
  // so the property must be inside the braces.
  const body = wrap.slice(wrap.indexOf('{') + 1, wrap.indexOf('}'));
  assert.ok(/min-width:\s*0/.test(body), 'min-width: 0 must be INSIDE the rule body (WS19)');
});

test('WS19: the roll must be on an inner track, never on the overflow window', () => {
  // Translating `.now-playing-line` itself would move the WINDOW and expose the
  // gap behind it. The window stays put; an inner `.roll-track` slides under it.
  const css = STYLES_WS5;
  assert.ok(/\.player-time-song \.now-playing-line > \.roll-track/.test(css),
    'the animated element must be an inner .roll-track, not the overflow window (WS19)');
  assert.ok(!/^\.now-playing-line\.rolling|^\.player-time-row \.now-playing-line \{[^}]*animation/m.test(css),
    'the animation must never be attached to the overflow window itself (WS19)');
  // The class is set by JS only when the text overflows, so a short song cannot
  // drift. Reduced motion must disable it outright.
  assert.ok(/\.rolling > \.roll-track/.test(css), 'the roll must be gated on the .rolling class (WS19)');
  assert.ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.rolling > \.roll-track[\s\S]*?animation:\s*none/.test(css),
    'prefers-reduced-motion must switch the roll off (WS19: continuous motion is an accessibility problem)');
  // Alternate + ease-in-out gives the pause-at-each-end lock-screen feel.
  assert.ok(/animation:\s*sr-song-roll[^;]*infinite alternate/.test(css),
    'the roll must alternate, so it pauses at each end rather than snapping back (WS19)');
});

test('WS19/WS20: the roll must be decided from a MEASUREMENT, after layout', () => {
  const paint = stripComments(region('function paintNowPlaying()', 'function paintProgramTitle('));
  // Reading scrollWidth synchronously would measure the OLD text, because the
  // line was just emptied and refilled. The rAF is the earliest correct point.
  assert.ok(/requestAnimationFrame/.test(paint),
    'the overflow measurement must be deferred to a rAF (WS19: sync reads measure the old text)');
  assert.ok(/isConnected/.test(paint),
    'the rAF callback must bail if the player was re-rendered away (WS19)');
  // The text must go in the track, with the note OUTSIDE it.
  assert.ok(/class: 'roll-track'/.test(paint) && /class: 'roll-prefix'/.test(paint),
    'the song text goes in .roll-track and the note stays outside it (WS19)');
  // Both directions must be handled: a long song rolls, and a short one after a
  // long one must STOP rolling. One-way handling is a visible regression.
  assert.ok(/classList\.add\('rolling'\)/.test(paint) && /classList\.remove\('rolling'\)/.test(paint),
    'both the rolling and the non-rolling branch must exist (WS19)');
  // ---- WS20: the measurement must be against the TRACK, net of the note ----
  // The old code compared the whole window against itself, which cannot detect
  // overflow at all: `line.scrollWidth` is clamped to `clientWidth` because the
  // line has `overflow: hidden`. Measured on a 56-char title the real overflow
  // was 183px while `line.scrollWidth - line.clientWidth` reported the same
  // number only by accident of the track's own width -- and for a short title
  // it reported 0 while the true figure was -30.
  assert.ok(/track\.scrollWidth/.test(paint),
    'the overflow must be measured on the TRACK, not on the clipped window (WS20)');
  assert.ok(/line\.clientWidth\s*-\s*prefixW/.test(paint),
    'the width available to the text must exclude the note, which shares the window (WS20)');
});

test('WS20: the roll distance must be PIXELS, never a percentage', () => {
  // THE BUG, reproduced: the keyframe was
  //   to { transform: translateX(calc(-100% + var(--roll-box))); }
  // Inside translateX a percentage resolves against the ELEMENT's own border
  // box, so -100% is the TRACK's width -- but `--roll-box` was stored as
  // `line.clientWidth / track.scrollWidth * 100`, a ratio of the WINDOW to the
  // track. Mismatched bases. Sampled on a short title ("A") the computed
  // transform was matrix(1,0,0,1,122,0) and then +244px: a POSITIVE shift that
  // slides the text right, out of the clipped window, leaving only the note --
  // exactly the `♪ ...` the owner photographed on P2 Nottturno.
  //
  // The fix stores a plain pixel distance, so there is one unit on one basis.
  assert.ok(/--roll-shift/.test(APP_JS),
    'the roll distance must be stored as a pixel length (WS20)');
  assert.ok(/setProperty\('--roll-shift',\s*`\$\{Math\.round\(overflow\)\}px`\)/.test(APP_JS),
    'the shift must be written in px from the measured overflow (WS20)');
  assert.ok(!/--roll-box/.test(APP_JS),
    'the percentage-based --roll-box is the WS20 bug and must not come back');
  assert.ok(!/--roll-box/.test(stripComments(STYLES_WS5)),
    'and no CSS may reference it either (WS20)');
  // The keyframe must be a SINGLE unambiguous term, not a difference of two
  // quantities with different bases.
  const kf = region('@keyframes sr-song-roll {', '@media (prefers-reduced-motion', STYLES_WS5);
  assert.ok(/translateX\(calc\(-1 \* var\(--roll-shift, 0px\)\)\)/.test(kf),
    'the keyframe must translate by the pixel shift directly (WS20)');
  assert.ok(!/calc\(-100%/.test(kf),
    'a -100% term mixes bases with a pixel variable and is the original defect (WS20)');
  // The default must be 0px, not 100%: a missing variable must not launch the
  // text out of view.
  assert.ok(/var\(--roll-shift,\s*0px\)/.test(kf),
    'the fallback must be 0px, so a missing variable cannot shift the text (WS20)');
});

test('WS20: a title that FITS must never be able to slide', () => {
  // The trigger for the owner's screenshot did not even need a real overflow:
  // `.rolling` is set by a rAF and cleared by the next paint, so a resize, a
  // song change or a re-render can leave the class on a title that no longer
  // overflows. With a stale huge value the old keyframe threw the text out of
  // the window. The guard is the `> 1` gate combined with a non-negative
  // distance, so the class is only ever set for a genuine overflow.
  const paint = stripComments(region('function paintNowPlaying()', 'function paintProgramTitle('));
  const measured = region('const prefixW = prefix', 'if (overflow > 1)', APP_JS);
  assert.ok(/const overflow = trackW - availW/.test(measured),
    'the overflow must be the track width minus the width available to it (WS20)');
  assert.ok(/overflow > 1/.test(paint),
    'a sub-pixel overflow must not trigger a roll (WS20)');
  // The no-song branch must clear the shift too, or the next song can inherit
  // the previous one's distance for a frame.
  const empty = stripComments(region('if (!song || !song.title) {', '} else {'));
  assert.ok(/removeProperty\('--roll-shift'\)/.test(empty),
    'the no-song branch must clear --roll-shift, or the next song inherits it (WS20)');
});

test('WS19: the MediaSession artist must CONTAIN the song artist', () => {
  // Measured live on P3: title AND artist both read "P3 Din Gata: Musik", so
  // the lock screen and the car head unit showed one string twice and the
  // performer never appeared. The cause was not fallback ordering --
  // `songArtist` was computed and then used ONLY as a boolean:
  //     metaArtist = songArtist ? [programme, channel].join(' · ') : ...
  // so the artist field never received a character of the actual performer.
  const fn = stripComments(region('function updateMediaSession()', '// ---- buffering indicator'));
  assert.ok(/\[songArtist, programme, channel\]\.filter\(Boolean\)\.join\(' · '\)/.test(fn),
    'the artist field must include songArtist, not merely branch on it (WS19)');
  // The boolean-only form is the exact bug, so assert it is gone.
  assert.ok(!/songArtist\s*\?\s*\[programme, channel\]/.test(fn),
    "the boolean-only form is the WS19 bug and must not come back");
  // The no-song fallback must still identify a talk channel.
  assert.ok(/:\s*\(programme \|\| channel\)/.test(fn),
    'with no song the artist must still fall back to programme, then channel (WS19)');
  // And the title must prefer the song, or the pair is reversed.
  assert.ok(/songTitle \|\| programme/.test(fn), 'the title must prefer the song (WS19)');
});

test('WS19: the header must not carry the bold duplicate channel name', () => {
  const header = stripComments(region('const headerLine = el(', '$player.appendChild(headerLine);', APP_JS));
  assert.ok(!/class: 'player-title'/.test(header),
    'the bold channel title must not be in the header: it duplicated the meta row (WS19)');
  // The channel name must still reach the player -- in the meta row, which is
  // where the owner asked for it ("the same exactly as ... just above the pill").
  const meta = stripComments(region('const identityName = isLive', 'const metaRowTop', APP_JS));
  assert.ok(/cur\.title/.test(meta),
    'the channel name must be the meta row\'s identity child (WS19)');
  // .player-sub is load-bearing: paintProgramTitle targets it by name.
  assert.ok(/class: 'player-sub'/.test(header),
    '.player-sub must survive in the header, or programme painting dies silently (WS19)');
  assert.ok(APP_JS.includes("querySelector('.player-sub')"),
    'paintProgramTitle must still reach .player-sub (WS19)');
  // The dead scoped rule must be gone, or a reader assumes two text cells.
  assert.ok(!/\.player-header \.player-title \{/.test(STYLES_WS5),
    'the dead .player-header .player-title rule must be deleted (WS19)');
});

test('WS20: the podcast icon must be UNCHANGED, and tap still plays the latest', () => {
  // The owner (2026-09-28): "i never ever complained about the pod icon to
  // start the latest podcast. that is by design and was decided in the start of
  // the project."
  //
  // WS19 added an "Avsnitt" caption to podcast icons to advertise the
  // long-press episode list. That was never requested and is now reverted in
  // full. This test is INVERTED rather than deleted: the caption is an addition
  // to a settled design, so the only durable guard is that it stays gone AND
  // that the original behaviour is untouched.
  const build = stripComments(region('function buildIconSection(', '$main.appendChild(buildIconSection'));
  assert.ok(!/icon-hint/.test(build),
    'the WS19 "Avsnitt" caption must NOT come back: it was never requested (WS20)');
  assert.ok(!/Håll klick för att se alla avsnitt/.test(build),
    'the WS19 aria override must not come back either (WS20)');
  // Stripped on purpose: a COMMENT explaining the removal still names
  // `.icon-hint`, and a raw-source check would match it. The rule itself is
  // what must be gone.
  assert.ok(!/icon-hint/.test(stripComments(STYLES_WS5)),
    'the dead .icon-hint CSS must stay deleted, or it misleads a reader (WS20)');
  // The behaviour that IS by design, asserted so a future pass cannot change it
  // by accident: a tap plays the newest episode, and the long-press episode
  // list is untouched.
  assert.ok(/onclick: \(\) => \(isPod \? playPodcast\(item\.id\)/.test(build),
    'a tap must play the latest episode: that is the original design (WS20)');
  assert.ok(/addLongPress\(btn, \(\) => \(isPod \? openPodcastCard/.test(build),
    'the long-press episode list must survive untouched (WS20)');
  assert.ok(/Spela senaste avsnittet av/.test(build),
    "the accessible name must keep saying 'latest episode' (WS20)");
});

test('WS21: a rolling line must NOT paint the ellipsis over the track', () => {
  // THE BUG, measured on the live origin on P2 Nottturno. The owner saw
  // `♪ ...` and reasonably concluded the text was missing. The DOM held all
  // 143 characters:
  //   "Christian Ihle Hadland (piano), Trondheim Symphony Orchestra, ... -
  //    Piano Concerto no 26 in D major, K.537 'Coronation'"
  //
  // The three dots were the LINE-level `text-overflow: ellipsis` firing, and
  // the rolling track was sliding BEHIND it:
  //     line.clientWidth   252
  //     track.scrollWidth  775   (+ 21 for the note = 796 of inline content)
  //     line.scrollWidth   785  -> exceeds the window, so the ellipsis paints
  //
  // `text-overflow: ellipsis` is correct for a STATIC label and wrong for a
  // rolling one: the track is moved by transform, so the line's own inline
  // content never shrinks and the decoration is permanent for the whole cycle.
  // Stripped first, and bounded on a CODE end marker, not on prose. A previous
  // version of this test sliced to `.rolling > .roll-track`, which appears in
  // the explanatory COMMENT above the rule -- so deleting the rule entirely
  // still matched the comment and the test passed. **That is mutation M1, which
  // was a NO-OP: the exact defect the owner photographed had no guard.**
  // `region()` searches forward from a comment and cannot tell prose from code.
  const css = stripComments(STYLES_WS5);
  const roll = region('.player-time-song .now-playing-line.rolling {',
    '.player-time-song .now-playing-line.rolling > .roll-track', css);
  assert.ok(/text-overflow:\s*clip/.test(roll),
    'the line must switch to text-overflow:clip while rolling, or the ellipsis covers the text (WS21)');
  // The ellipsis must SURVIVE for a title that does not roll -- that is the
  // case it was written for, and it is the only case where it adds anything.
  const base = region('.now-playing-line {', '.now-playing-line:empty', STYLES_WS5);
  assert.ok(/text-overflow:\s*ellipsis/.test(base),
    'a non-rolling line must keep the ellipsis (WS21)');
  // ... and the rule must be scoped to the rolling state, not blanket.
  assert.ok(!/^\.now-playing-line \{[^}]*text-overflow:\s*clip/m.test(STYLES_WS5),
    'the ellipsis must not be removed globally (WS21)');
});

test('WS21: the yesterday gate must not depend on a value that is not set yet', () => {
  // WS18 decided whether to load yesterday from `cur.seekableStart`, on the
  // reasoning that a channel with no DVR window pays nothing. Measured live at
  // 01:55 that gate NEVER opens:
  //     transportKind  "direct"   (Chromium cannot load SR's HLS)
  //     seekableStart  null
  //     windowMs       0
  //     needsYesterday false
  // and the schedule actually held began at 00:00 today -- 1.94 h of "today"
  // with the whole previous evening missing.
  //
  // The gate is evaluated inside `resolveProgramTitle`, which `playTrack` calls
  // IMMEDIATELY, before any `loadedmetadata`/`durationchange` has populated the
  // seekable range. **It was reading a value that had not been written yet, so
  // yesterday was never requested and the WS18 fix could not engage on the very
  // case it was written for.**
  const fn = stripComments(region('async function fetchSchedule(channelId) {',
    'function programBoundary('));
  assert.ok(/pastMidnight/.test(fn),
    'the gate must consult the CLOCK, which is always available (WS21)');
  assert.ok(/new Date\(\)\.getHours\(\)\s*<\s*1/.test(fn),
    'after local midnight a 1h+ window necessarily reaches yesterday (WS21)');
  // ---------------------------------------------------------------------
  // WS26 SUPERSEDES the two assertions below, and the reasoning is recorded
  // here rather than by deletion, because the PROPERTY this whole test exists
  // to protect -- "the gate must not depend on a value that is not set yet" --
  // is STILL enforced, by a stricter route. Read the restatement as the
  // property surviving a change of form, not as the property being dropped.
  //
  // WAS:  /needsYesterday = pastMidnight || /
  //       /windowMs > 60 * 60 * 1000/
  //   The gate was "past midnight OR window longer than an hour". WS25 measured
  //   that as wrong for the case it was written for: the first term is true for
  //   ONE hour a day, while a 3 h window reaches into yesterday for three. The
  //   one-hour threshold was a stand-in for a question about MIDNIGHT that the
  //   formula could not express, and the owner's 01:19 test sat squarely in
  //   the 01:00-02:59 gap where the gate is shut.
  //
  // NOW:  window-first, clock as the EXPLICIT fallback for the unknown case:
  //     windowReachesYesterday = windowS == null ? null : timeSinceMidnightS < windowS
  //     needsYesterday = windowReachesYesterday === null
  //       ? pastMidnight
  //       : (windowReachesYesterday || pastMidnight)
  //   `null` means the window is UNKNOWN -- precisely the WS21 situation. So
  //   this test's property is now an explicit branch in the decision rather
  //   than an incidental `||`, and it is asserted as such below.
  assert.ok(/windowReachesYesterday\s*===\s*null\s*\?\s*pastMidnight/.test(fn),
    'with an UNKNOWN window the gate must fall back to the clock (WS21 property)');
  assert.ok(/\(windowReachesYesterday \|\| pastMidnight\)/.test(fn),
    'with a KNOWN window the decision is window-first, clock-second (WS26)');
  assert.ok(/windowS\s*==\s*null\s*\?\s*null\s*:/s.test(fn),
    'an unknown window must be null, distinct from a known-but-short one');
  // The superseded one-hour threshold must be GONE, not merely unused: it
  // would still pass a hardcoded 3-hour constant, which the brief forbids.
  assert.ok(!/windowMs\s*>\s*60\s*\*\s*60\s*\*\s*1000/.test(fn),
    'the superseded one-hour threshold must be gone -- it never consulted the clock');
  // ---------------------------------------------------------------------
  // WS26 ADDITION -- and this is the assertion whose absence let an UNREACHABLE
  // fix look like a working one. Replacing the formula is not the same as
  // consulting it. Measured before this addition (WS26, by execution): on the
  // play path the order is armPlaybackWatchdog -> renderPlayer ->
  // resolveProgramTitle -> fetchSchedule -> the gate, and renderPlayer does NOT
  // call updateSeekableState(), so the window is STILL null when the gate
  // runs. A window-derived gate in that position is dead code: it always takes
  // the clock branch, which is shut for 01:00-02:59, which is exactly the
  // owner's report. So the formula was correct and the FIX was not yet real.
  //
  // The gate must therefore be re-evaluated from a path that provably runs
  // AFTER the window is written. `timeupdate` calls updateSeekableState() for
  // an HLS transport, so within a few hundred ms of playback the window is
  // known. That is the only reachable point, and it must be wired.
  const SEEKABLE = stripComments(region('function updateSeekableState() {',
    'function setExpandOpen(open) {'));
  assert.ok(/lastWindowGateKey\s*!==\s*key/.test(SEEKABLE),
    'the gate must be re-evaluated from updateSeekableState, the only reachable point');
  assert.ok(/resolveProgramTitle\(cur\)/.test(SEEKABLE),
    'that re-evaluation must go through the SAME resolveProgramTitle path');
  // It must be bounded: a 4 Hz timeupdate would otherwise re-fetch the schedule
  // four times a second. One refetch per (channel, local date) transition.
  assert.ok(/lastWindowGateKey\s*=\s*key/.test(SEEKABLE),
    'the re-evaluation must record its key so it fires once, not per tick');
  assert.ok(/scheduleCache\.delete\(key\)/.test(SEEKABLE),
    'the cached day must be dropped, or the refetch returns the stale decision');
  // And the key must not survive a channel switch, or the new channel\'s
  // window-becomes-known transition would be suppressed by the old one.
  assert.ok(/lastWindowGateKey = null/.test(
    stripComments(region('function stopNowPlayingPoll() {', 'async function fetchNowPlaying('))),
    'the gate key is per channel and must be reset on a switch');
  // The window length must be MEASURED, never hardcoded: a 3 h/10800 s
  // constant would freeze one observation into permanent behaviour.
  assert.ok(/const windowS = \(Number\.isFinite\(sStart\) && Number\.isFinite\(sEnd\)/.test(fn),
    'the window must be measured from seekableStart/seekableEnd');
  assert.ok(!/windowS\s*=\s*3\s*\*\s*3600|windowS\s*=\s*10800/.test(fn),
    'the window length must not be hardcoded');
  // MUTATION-PROVEN ADDITION. The assertion above is NOT satisfied by its own
  // negative form: a mutation that replaced the measured window with the
  // literal 10800 was reported STILL GREEN before this was added, because the
  // negative pattern only matched an ASSIGNMENT (`windowS = 10800`) while the
  // constant had been inlined into the COMPARISON instead. That is the exact
  // "freeze one observation into permanent behaviour" trap the brief forbids,
  // and a negative assertion that cannot see it is decoration. Both forms are
  // now rejected, and the mutation is re-run to prove it.
  assert.ok(!/timeSinceMidnightS\s*<\s*(3\s*\*\s*3600|10800)/.test(fn),
    'a window length hardcoded INTO the comparison must also be rejected');
  assert.ok(/Number\.isFinite\(sStart\)/.test(fn) && /Number\.isFinite\(sEnd\)/.test(fn),
    'the window must come from the real seekable range, both ends');
  // The gate must be OBSERVABLE, or the next silent failure is just as
  // undiagnosable as this one was.
  assert.ok(/META_DIAG\.lastScheduleGate\s*=/.test(fn),
    'the gate decision must be recorded (WS21)');
  const snap = stripComments(region('schedule: {', 'episodeTracks: {'));
  assert.ok(/gate:\s*META_DIAG\.lastScheduleGate/.test(snap),
    'the snapshot must expose schedule.gate (WS21)');
  assert.ok(/fetchedDays/.test(fn),
    'the recorded gate must say which days were actually fetched (WS21)');
});


// ===================================================================
// WS23 — the "Till Direkt" margin, the stream-edge assumption, and the
// earbud resume outcome.
//
// Three separate concerns, one workstream. Each group below states what it
// guards and WHY, because two of them exist to stop a specific future change
// that has already been made once in this project.
// ===================================================================

test('WS23: the seek margin and the live-display tolerance are SEPARATE constants', () => {
  // WHY: `LIVE_EDGE_TOLERANCE_S` (10 s) answers "when does the pill say LIVE?".
  // It is a display rule. WS22 measured that seekToLive() was also using it to
  // size the seek TARGET, which parked the playhead a visible margin behind
  // the edge on every press. The owner decided "Till Direkt" should reach the
  // edge, so the two jobs now have their own constants.
  //
  // These are asserted on RAW source deliberately: the definitions live
  // beside explanatory comments, and stripComments() would leave only the
  // assignment. The values, not the prose, are what must not drift.
  assert.ok(APP_JS.includes('const LIVE_EDGE_TOLERANCE_S = 10;'),
    'the display tolerance must be unchanged in WS23 — only the seek margin moved');
  assert.ok(APP_JS.includes('const SEEK_LIVE_MARGIN_S = 1;'),
    'the seek target must have its own dedicated constant');

  // The margin must be a real, finite, POSITIVE number, and strictly SMALLER
  // than the display tolerance. Each bound is a distinct way the change could
  // be wrong, so they are checked separately rather than as one expression.
  const m = /const SEEK_LIVE_MARGIN_S = (\d+);/.exec(APP_JS);
  assert.ok(m, 'SEEK_LIVE_MARGIN_S must be a plain integer literal so it can be asserted');
  const margin = Number(m[1]);
  assert.ok(margin > 0,
    'the margin must NOT be 0: seeking onto the exact buffered boundary is the Safari no-op that made this button fail twice before it was given one');
  assert.ok(margin < 10,
    'the seek margin must be smaller than the display tolerance, or the separation is cosmetic');
  // A margin is only "inaudible" if it is under a second. Real inter-song gaps
  // measured on P3 are 10-16 s, so anything in that range could still hide a
  // boundary; 1 s cannot.
  assert.ok(margin <= 1,
    'the margin must be at most 1 s to be inaudible and unable to hide a title boundary');
});

test('WS23: seekToLive targets the dedicated margin and NOT the display tolerance', () => {
  // The positive form and the INVERTED form are both required. Asserting only
  // that the new constant is used would also pass if the old one were used as
  // well; asserting only the negative would pass if the target were deleted
  // entirely. Together they pin the arithmetic.
  assert.ok(/end - SEEK_LIVE_MARGIN_S/.test(SEEK_TO_LIVE),
    'the target must be sized by the seek margin');
  assert.ok(!/end - LIVE_EDGE_TOLERANCE_S/.test(SEEK_TO_LIVE),
    'the target must NOT be sized by the display tolerance — they are different jobs');
  // Still clamped, still validated, still the value that gets assigned. These
  // are the WS2 guarantees and WS23 must not have disturbed them.
  assert.ok(/Math\.max\(start, end - SEEK_LIVE_MARGIN_S\)/.test(SEEK_TO_LIVE),
    'the margin must remain clamped against seekableStart');
  assert.ok(/audioEl\.currentTime = target;/.test(SEEK_TO_LIVE),
    'the clamped target is still what gets assigned');
  assert.ok(/Number\.isFinite\(target\)/.test(SEEK_TO_LIVE),
    'the target must still be validated before use');
  // The BUG 1 no-op guard from WS2, restated: the exact boundary is forbidden.
  assert.ok(!/audioEl\.currentTime = end;/.test(SEEK_TO_LIVE),
    'the exact buffered boundary must never be the target (WS2 BUG 1)');
});

test('WS23: the display rule is untouched — the pill still reads LIVE where it did', () => {
  // The owner asked for the seek margin to change ONLY. If the display rule had
  // moved too, the pill's meaning would have changed silently and the next
  // device test would be unreadable. These assert the display side is intact.
  const dvr = stripComments(region('function updateSeekableState()',
    '// ---- expand-panel open/close STATE', APP_JS));
  assert.ok(/cur\.atLiveEdge = !usable \|\| cur\.distanceFromLiveEdge <= LIVE_EDGE_TOLERANCE_S;/.test(dvr),
    'atLiveEdge must still be classified by the display tolerance, unchanged');
  // seekBy()'s forward clamp also belongs to the display/live family and was
  // explicitly NOT in scope for WS23.
  const seekBy = stripComments(region('function seekBy(deltaSeconds)', '// Fetch today', APP_JS));
  assert.ok(/cur\.seekableEnd - LIVE_EDGE_TOLERANCE_S/.test(seekBy),
    'seekBy() must still clamp to the display tolerance — WS23 changed only seekToLive');
});

test('WS23: the stream-edge assumption is named once, with its site list', () => {
  // WHY: the app converts a recording position into a clock time by assuming
  // the buffered edge IS the present moment. WS6 already found that this edge
  // can be reported late and worked around it for ONE call site only; the rest
  // still carry the assumption silently. A silent assumption is what turned
  // "about 10 s" into folklore, so it is now documented in one place.
  const doc = region('// ---- WS23: THE STREAM-EDGE ASSUMPTION', 'function playheadWallMs()');
  assert.ok(/seekableEnd/.test(doc), 'the documented assumption must name seekableEnd');
  // Every site that reads the edge as "now" must be listed. The list is what
  // stops a sixth site appearing without anyone noticing.
  ['playheadWallMs', 'dvrPositionToDate', 'seekToProgramTime', 'seekToLive', 'liveEdgeWallMs']
    .forEach((fn) => {
      assert.ok(doc.includes(fn),
        `the assumption's site list must name ${fn} — a new caller must see the caveat`);
    });
  // And it must say plainly that the error is variable and uncorrected, so the
  // next session cannot inherit "the offset is 10 s" as a constant.
  assert.ok(/VARIABLE|NOT A FIXED|not a fixed|variable/i.test(doc),
    'the note must record that the offset is variable, not a fixed margin');
  assert.ok(/NO correction|NOT corrected|not corrected|no correction/i.test(doc),
    'the note must state that no correction value is applied');
  // There must be no correction constant in the source at all. This is the
  // assertion that stops a fudge factor being introduced quietly.
  assert.ok(!/STREAM_EDGE_CORRECTION|EDGE_CORRECTION_S|SEEK_CORRECTION/.test(APP_JS),
    'no hardcoded stream-edge correction may exist — the error is unmeasured');
});

test('WS23: the stream edge is MEASURABLE on a device, sampled around a seek', () => {
  // WHY: whether the buffered edge lags the true live edge could never be
  // answered from inside the app, because the app has no second clock to
  // compare against. These fields make the assumption visible so a human with
  // the real broadcast can supply the missing reference.
  const snap = stripComments(region('dvr: {', 'dom: {', APP_JS));
  assert.ok(/streamEdge:/.test(snap), 'the snapshot must expose a streamEdge section');
  ['edgeAsWallClockIso', 'nowIso', 'edgeMinusNowS']
    .forEach((f) => {
      assert.ok(snap.includes(f), `streamEdge must expose ${f}`);
    });
  // Before/after around the seek, so a reader can see whether the SEEK moved
  // the edge — a re-registered buffer would explain a variable offset alone.
  ['before', 'after', 'requestedTarget', 'acceptedPosition', 'clampedByS']
    .forEach((f) => {
      assert.ok(snap.includes(f), `streamEdge must expose ${f}`);
    });
  // The requested/accepted pair is what distinguishes a browser-clamped seek
  // from a genuine offset; without it a clamp is indistinguishable from one.
  const rec = stripComments(region('function recordStreamEdge(phase)',
    'function seekToLive()', APP_JS));
  // Anchored on `name:` or `name =` so a RENAMED field cannot pass by
  // substring. M13 renamed edgeMinusNowS -> edgeMinusNowSWasRemoved and the
  // suite stayed GREEN, because the old assertion only checked whether the
  // name appeared somewhere in the region. That is the substring trap, and it
  // is now closed for every field asserted here.
  assert.ok(/edgeMinusNowS\s*:/.test(rec),
    'the recorder must compute the edge-versus-now difference');
  // Both seek paths must sample it. seekToProgramTime is the button that
  // produced the ~30 s reading, so an instrumented "Till Direkt" alone would
  // not answer the question.
  const spt = stripComments(region('function seekToProgramTime(startMs)',
    "['waiting', 'stalled'].forEach", APP_JS));
  assert.ok(/recordStreamEdge\('before'\)/.test(spt),
    'the programme-skip path must sample the edge before computing its target');
  assert.ok(/recordStreamEdge\('after'\)/.test(spt),
    'the programme-skip path must re-sample the edge after seeking');
  assert.ok(/recordStreamEdge\('before'\)/.test(SEEK_TO_LIVE),
    'seekToLive must sample the edge before seeking');
  assert.ok(/recordStreamEdge\('after'\)/.test(SEEK_TO_LIVE),
    'seekToLive must re-sample the edge after seeking');
  // BEFORE must precede EVERY guard and the target computation. M12 moved the
  // sample just below the two early-return guards and the suite stayed GREEN,
  // which would have meant a REFUSED press (no track, or no DVR) was never
  // recorded at all -- exactly the press a reader most needs to see. The
  // assertion is therefore positional against the first guard, not just
  // against `const target`.
  const beforeIdx = spt.indexOf("recordStreamEdge('before')");
  const firstGuardIdx = spt.indexOf('if (!cur || !cur.dvrAvailable) return;');
  const targetIdx = spt.indexOf('const target =');
  assert.ok(beforeIdx !== -1, 'the programme-skip path must sample the edge');
  assert.ok(firstGuardIdx !== -1, 'the DVR guard must still exist in seekToProgramTime');
  assert.ok(targetIdx !== -1, 'the target computation must still exist');
  assert.ok(beforeIdx < firstGuardIdx,
    'the edge must be sampled BEFORE the early-return guards, or a refused press is never recorded');
  assert.ok(beforeIdx < targetIdx,
    'the edge must be sampled BEFORE the target is derived from it');

  // The three figures that make a clamped seek visible must be WRITTEN at the
  // seek site, not merely listed in the snapshot. M14 deleted all three writes
  // and the suite stayed GREEN, because the snapshot still names the fields.
  // Anchored on the property name with a preceding `=`, so a renamed field
  // (e.g. `errorNameWasRemoved`) cannot satisfy the match by substring.
  [SEEK_TO_LIVE, spt].forEach((regionSrc, i) => {
    const where = i === 0 ? 'seekToLive' : 'seekToProgramTime';
    assert.ok(/SEEK_EDGE_DIAG\.requestedTarget =/.test(regionSrc),
      `${where} must WRITE the requested target`);
    assert.ok(/SEEK_EDGE_DIAG\.acceptedPosition =/.test(regionSrc),
      `${where} must WRITE the position the element accepted`);
    assert.ok(/SEEK_EDGE_DIAG\.clampedByS =/.test(regionSrc),
      `${where} must WRITE the clamped-by difference`);
  });
});

test('WS23: the earbud resume records its outcome instead of discarding it', () => {
  // WHY: the MediaSession play handler was `audioEl.play().catch(() => {})` —
  // the only play site in the file that threw the reason away. A rejected
  // resume and a resume that succeeded into silence look identical from
  // outside, and only a device can tell them apart. The name and message of a
  // rejection are the whole point.
  const handler = stripComments(region("mediaSession.setActionHandler('play'",
    "mediaSession.setActionHandler('pause'", APP_JS));
  assert.ok(!/\.catch\(\(\) => \{\}\)/.test(handler),
    'the play handler must NOT discard the failure with an empty catch');
  assert.ok(/audioEl\.play\(\)/.test(handler),
    'play() must still be called');
  assert.ok(/\.then\(/.test(handler) && /\.catch\(/.test(handler),
    'the handler must distinguish a resolved resume from a rejected one');
  // The REJECTION branch specifically, isolated from the reset block.
  // M18 deleted the two error writes in `.catch(...)` and the suite stayed
  // GREEN, because the handler opens with a reset that also assigns
  // `errorName`/`errorMessage` to null. Asserting over the whole handler
  // therefore proved nothing about the branch that does the recording — the
  // same lesson as WS6's M8, and the reason this is now a separate slice.
  const catchBranch = handler.slice(handler.indexOf('.catch('));
  ['errorName', 'errorMessage', 'outcome']
    .forEach((f) => {
      assert.ok(new RegExp(`RESUME_DIAG\\.${f}\\s*=`).test(catchBranch),
        `the REJECTION branch must ASSIGN ${f} — the rejection reason is the question`);
    });
  // And the value must come from the error object, not be a constant null.
  assert.ok(/RESUME_DIAG\.errorName\s*=\s*err\s*&&\s*err\.name/.test(catchBranch),
    'errorName must be read from the rejection, not hardcoded');
  assert.ok(/RESUME_DIAG\.errorMessage\s*=\s*err\s*&&\s*err\.message/.test(catchBranch),
    'errorMessage must be read from the rejection, not hardcoded');
  // The reset on entry is required too, or a previous failure's name would be
  // misread as this one's.
  const resetBranch = handler.slice(0, handler.indexOf('.then('));
  assert.ok(/RESUME_DIAG\.outcome\s*=\s*null/.test(resetBranch),
    'each attempt must clear the previous outcome before recording a new one');
  // readyState/networkState are what separate "never started" from "started
  // and silent", which is the distinction the owner can act on. M27 could not
  // even be applied unambiguously at first (three identical lines), which is
  // itself the lesson: assert on a scoped region, not on the whole file.
  const sampler = stripComments(region('function sampleResume(phase)',
    'if (mediaSession) {'));
  ['readyState', 'networkState', 'errorCode']
    .forEach((f) => {
      assert.ok(new RegExp(`${f}\\s*:`).test(sampler),
        `the sampler must record ${f}`);
    });
  // The delayed re-sample is what makes "resumed but silent" visible at all:
  // without it, a resume that resolved is recorded once and never checked
  // again. M28 deleted the whole setTimeout and the suite stayed GREEN.
  assert.ok(/setTimeout\(/.test(handler),
    'the resume path must re-sample after a delay, or a silent resume is invisible');
  assert.ok(/afterDelayMs/.test(handler),
    'the re-sample delay must be the recorded constant, not a magic number');
  assert.ok(/RESUME_DIAG\.after\s*=\s*sampleResume\(/.test(handler),
    'the delayed re-sample must write the after sample');
  // And it must only be scheduled, never awaited — blocking playback on a
  // diagnostic would be a behaviour change.
  assert.ok(!/await\s+.*setTimeout/.test(handler),
    'the re-sample must not be awaited');
  // Exposed in the snapshot so it is readable on a device.
  const snap = stripComments(region('episodeTracks: {', 'dvr: {', APP_JS));
  assert.ok(/earbudResume:/.test(snap), 'the snapshot must expose earbudResume');
  assert.ok(snap.includes('RESUME_DIAG'),
    'earbudResume must report the resume record, not a parallel copy');
});

test('WS23: a rejected resume shows the EXISTING wording, and changes nothing else', () => {
  // The toast must reuse the Swedish string every other play site already
  // uses. Inventing new copy here would make the next device test ambiguous.
  const handler = stripComments(region("mediaSession.setActionHandler('play'",
    "mediaSession.setActionHandler('pause'", APP_JS));
  assert.ok(handler.includes("showToast('Kunde inte starta uppspelning. Försök igen.')"),
    'the rejection path must reuse the existing play-failure wording verbatim');
  assert.ok(/renderPlayer\(\)/.test(handler),
    'the rejection path must re-render so the UI matches the element');
  // The success path is untouched, and NO speculative recovery was added.
  // A reconnect or retry here would put two changes in flight and make the
  // next device result unreadable.
  assert.ok(!/advanceCandidate|hlsDetach|hlsAttach|loadHlsJs/.test(handler),
    'no retry, reconnect or candidate advance may be added to the resume path');
  // The success branch is a pure observer.
  const resolvedBranch = handler.slice(handler.indexOf('.then('), handler.indexOf('.catch('));
  assert.ok(!/showToast/.test(resolvedBranch),
    'a RESOLVED resume must not toast — silent-but-resumed is a different fault');

  // ---- INVERTED GUARD (required) ----
  // The other empty-catch sites in this file are deliberate and out of scope.
  // Widening this change to them would make the next device test unreadable,
  // so they are pinned as still-empty. A negative match, so it is asserted on
  // comment-stripped source: a comment mentioning a site is harmless.
  //
  // Both remaining sites live in the candidate-advance path, which is where a
  // play attempt legitimately races a track change and its failure is
  // genuinely uninteresting. They are sliced individually rather than counted
  // alone, so a future edit that empties or fills ONE of them is attributable.
  const advanceFn = stripComments(region('function advanceCandidate()',
    'function armPlaybackWatchdog()', APP_JS));
  const advanceCatches = advanceFn.split('audioEl.play().catch(() => {})').length - 1;
  assert.equal(advanceCatches, 2,
    'both advanceCandidate() play attempts must keep their empty catches — '
    + 'WS23 changed only the MediaSession site');

  // The seek re-resume site (a `seeked` handler resuming a paused stream) is
  // the third. It is deliberately left alone for the same reason.
  assert.ok(APP_CODE.includes('if (audioEl.paused) audioEl.play().catch(() => {});'),
    'the seek re-resume site must keep its empty catch in WS23');

  // Count, so a NEW empty catch added later is also caught by this test, and
  // so filling one of these three is caught even if a slice is rewritten.
  const emptyCatches = APP_CODE.split('.catch(() => {})').length - 1;
  assert.equal(emptyCatches, 3,
    'exactly three empty-catch sites must remain (WS23 removed only the MediaSession one)');
});

test('WS23: the new diagnostics stay read-only with respect to playback state', () => {
  // The existing contract test guards HOOK, but the WS23 recorders are declared
  // OUTSIDE that region, so they need their own guard. Recording must never
  // become a second control path.
  const recorders = stripComments(region('function streamEdgeWallMs()',
    '// Maps media time to wall clock'));
  assert.ok(!/state\.current\s*=/.test(recorders), 'the recorder must not assign state.current');
  assert.ok(!/state\.current\.\w+\s*=/.test(recorders),
    'the recorder must not write any property of state.current');
  assert.ok(!/audioEl\.currentTime\s*=/.test(recorders), 'the recorder must not seek');

  const resumeBlock = stripComments(region('const RESUME_DIAG = {',
    "mediaSession.setActionHandler('pause'", APP_JS));
  assert.ok(!/state\.current\s*=/.test(resumeBlock),
    'the resume record must not assign state.current');
  assert.ok(!/audioEl\.(src|load)\s*=/.test(resumeBlock),
    'the resume record must not set src or reload the element');
  // It calls play() once, exactly as before, and never pause().
  const playCalls = resumeBlock.split('audioEl.play()').length - 1;
  assert.equal(playCalls, 1, 'the resume path must call play() exactly once');
  assert.ok(!/audioEl\.pause\(\)/.test(resumeBlock),
    'the resume path must not pause — that would be a second control path');
  // Registered once, at startup, beside the other handlers.
  assert.ok(APP_CODE.split("setActionHandler('play'").length - 1 === 1,
    "the 'play' handler must be registered exactly once");
});

// ===================================================================
// WS26 Part 3 -- the SR timeline lookup, and its REQUIRED fallback
// ===================================================================
//
// WS25 refuted the "data ceiling" belief: ondemand returns per-song tracks with
// boundaries for a broadcast that finished yesterday. Part 3 uses that. The
// brief requires a specific degradation: when the lookup fails or returns no
// tracks -- talk programmes return an EMPTY list, verified live, and that is
// NORMAL -- the panel must fall back to the polled timeline unchanged, never
// to a blank panel. A new data source that can blank the panel on a routine
// response would be a worse defect than the one it fixes.

test('WS26 Part 3: a failed episode lookup leaves the POLLED timeline intact', async () => {
  const MERGE = (() => {
    const a = APP_CODE.indexOf('function mergeTimelineEntries(');
    assert.notEqual(a, -1, 'mergeTimelineEntries must exist');
    return APP_CODE.slice(a, APP_CODE.indexOf('async function resolveSeekTracksFromSr(', a));
  })();

  // It merges into the SAME timeline the poll writes, and shares the poll's
  // dedupe / sort / cap. A second cap or a second dedupe rule would be a second
  // place for the timeline to be wrong.
  assert.ok(/nowPlaying\.timeline\.some\(\(t\) => t\.startMs === e\.startMs\)/.test(MERGE),
    'the SR entries must dedupe by start time, exactly as the poll does');
  assert.ok(/nowPlaying\.timeline\.sort\(\(a, b\) => a\.startMs - b\.startMs\)/.test(MERGE),
    'the SR entries must keep the same sort');
  // MUTATION-PROVEN: asserting the cap's PRESENCE was not enough. Replacing
  // this guard with `if (false)` -- so SR entries grow the timeline without
  // bound -- left the whole suite GREEN, because a pattern match cannot tell a
  // live guard from a disabled one. It is now DRIVEN: mergeTimelineEntries is
  // extracted and executed against an over-long timeline, and the assertion is
  // on the resulting LENGTH. A presence check that cannot fail is not a check.
  const capConst = Number(/const NOW_PLAYING_TIMELINE_MAX = (\d+);/.exec(APP_CODE)[1]);
  const capRunner = new Function('deps', `
    const { nowPlaying, NOW_PLAYING_TIMELINE_MAX } = deps;
    ${(() => {
      const a = APP_CODE.indexOf('function mergeTimelineEntries(');
      let d = 0, e = a;
      for (let i = a; i < APP_CODE.length; i++) {
        if (APP_CODE[i] === '{') d++;
        else if (APP_CODE[i] === '}') { d--; if (d === 0) { e = i; break; } }
      }
      return APP_CODE.slice(a, e + 1);
    })()}
    return mergeTimelineEntries;
  `);
  const overLong = { timeline: [] };
  for (let i = 0; i < capConst + 25; i++) {
    overLong.timeline.push({ title: `t${i}`, artist: 'a', startMs: i * 1000, stopMs: i * 1000 + 500 });
  }
  const before = overLong.timeline.length;
  capRunner({ nowPlaying: overLong, NOW_PLAYING_TIMELINE_MAX: capConst })(
    Array.from({ length: 40 }, (_, i) => ({
      title: `new${i}`, artist: 'n', startMs: 10_000_000 + i * 1000, stopMs: 10_000_000 + i * 1000 + 500,
    })));
  assert.equal(before, capConst + 25, 'harness: the timeline starts over the cap');
  assert.equal(overLong.timeline.length, capConst,
    `merging must trim the timeline back to NOW_PLAYING_TIMELINE_MAX (${capConst}), not grow it`);
  // And it must still be SORTED, or a trimmed timeline would resolve wrongly.
  const sorted = overLong.timeline.every((e, i, a) => i === 0 || a[i - 1].startMs <= e.startMs);
  assert.ok(sorted, 'after merging and trimming, the timeline must remain sorted by start time');
  // Malformed entries are dropped, never inserted as zero-length ranges that
  // would then match every position and blank the panel.
  assert.ok(/if \(!Number\.isFinite\(e\.startMs\) \|\| !Number\.isFinite\(e\.stopMs\)\) continue;/.test(MERGE),
    'a non-finite range must be skipped, not inserted');

  const RESOLVE = (() => {
    const a = APP_CODE.indexOf('async function resolveSeekTracksFromSr(');
    assert.notEqual(a, -1, 'resolveSeekTracksFromSr must exist');
    return APP_CODE.slice(a, APP_CODE.indexOf('function ', a + 40));
  })();
  // THE FALLBACK, asserted on both failure shapes. `return` with no mutation
  // before it is the whole mechanism: the polled timeline is left as it was.
  assert.ok(/if \(!entry \|\| entry\.episodeId == null\) return;/.test(RESOLVE),
    'an entry with no episode id must return without touching the timeline');
  assert.ok(/if \(!Array\.isArray\(tracks\) \|\| !tracks\.length\) return;/.test(RESOLVE),
    'an EMPTY track list -- the normal talk-programme response -- must return unchanged');
  assert.ok(/if \(seq !== seekTracksSeq\) return;/.test(RESOLVE),
    'a superseded lookup must return without merging');
  // A relativeEndTime that is missing must NOT be invented -- guessing an end
  // would create overlapping ranges and a title that shows in the wrong place.
  assert.ok(/if \(e != null\) stopMs = entry\.startMs \+ e \* 1000;\s*else continue;/.test(RESOLVE),
    'a track with no end must be skipped, not given an invented end');
  // The cache must store the EMPTY result too, or a talk programme would be
  // re-requested on every seek -- the wasteful outcome the cache exists to stop.
  const FETCH = (() => {
    const a = APP_CODE.indexOf('async function fetchEpisodeTracks(');
    return APP_CODE.slice(a, APP_CODE.indexOf('function mergeTimelineEntries(', a));
  })();
  assert.ok(/episodeTracksById\.set\(episodeId, tracks\)/.test(FETCH),
    'the session cache must store the result, including an empty one');
  // MUTATION-PROVEN: the cache READ was asserted by presence only, and
  // DELETING the read line entirely -- so every seek re-requested the same
  // episode -- left the suite GREEN. Presence cannot distinguish a live cache
  // from an absent one. It is now driven: a fetch for an already-cached id
  // must not call fetch at all, and a fetch for an id that returned [] must
  // also not re-request. Both are the behaviour that bounds the request count.
  // The extracted body calls the BARE identifier `fetch`, so a same-scope
  // binding shadows the global -- the same lesson as the Date shadow in the
  // R6 test. Naming it fetchImpl in deps and shadowing it as `fetch` is what
  // makes this driven rather than a real network call.
  const cacheRunner = new Function('deps', `
    const { episodeTracksById, log } = deps;
    const fetch = async () => { log.push('FETCHED'); return { ok: true, json: async () => ({ tracks: [{ title: 'x' }] }) }; };
    ${(() => {
      const a = APP_CODE.indexOf('async function fetchEpisodeTracks(');
      let d = 0, e = a;
      for (let i = a; i < APP_CODE.length; i++) {
        if (APP_CODE[i] === '{') d++;
        else if (APP_CODE[i] === '}') { d--; if (d === 0) { e = i; break; } }
      }
      return APP_CODE.slice(a, e + 1);
    })()}
    return fetchEpisodeTracks;
  `);
  const run = async (prefilled) => {
    const log = [];
    const f = cacheRunner({
      episodeTracksById: prefilled,
      log,
    });
    return { f, log };
  };
  // (a) a cached id must not issue a request
  const warm = await run(new Map([[2864965, [{ title: 'cached' }]]]));
  const got = await warm.f(2864965);
  assert.equal(warm.log.length, 0, 'a cached episode id must NOT issue a request');
  assert.deepEqual(got, [{ title: 'cached' }], 'a cached episode must return the cached tracks');
  // (b) an EMPTY cached result must also not re-request -- a talk programme
  // returns [] and re-requesting it on every seek is the wasteful case.
  const cold = await run(new Map([[2864966, []]]));
  await cold.f(2864966);
  assert.equal(cold.log.length, 0,
    'a cached EMPTY result must not be re-requested -- talk programmes return [] normally');
  // (c) an UNKNOWN id must issue exactly one request and cache the result
  const fresh = await run(new Map());
  await fresh.f(2864967);
  assert.equal(fresh.log.length, 1, 'an unknown episode id must issue exactly one request');
  // BOUNDED, and each bound is load-bearing.
  assert.ok(/const SEEK_TRACKS_DEBOUNCE_MS = 250;/.test(APP_CODE),
    'the SR lookup must be debounced so a drag issues one request');
  const TU = APP_CODE.slice(APP_CODE.indexOf("addEventListener('timeupdate'"),
    APP_CODE.indexOf('window.__srSeekable'));
  assert.ok(!/resolveSeekTracksFromSr|fetchEpisodeTracks/.test(TU),
    'no SR lookup may be added to a timeupdate handler -- those run 4x/second');
  // ---------------------------------------------------------------------
  // THE SUCCESS PATH, DRIVEN. Added after a REAL defect: Part 3's first draft
  // passed `cur._srSchedule` straight into pickByPosition, which matches on
  // `e.stopMs`, while the schedule entries carry `endMs`. So `entry` was
  // ALWAYS null, the function returned on its second line, and the entire
  // SR-backed lookup was dead code.
  //
  // Every assertion above still passed while that was true, because they only
  // test the FAILURE paths. A test that checks "nothing is touched" cannot
  // detect "nothing ever happens". This block drives the positive case and
  // asserts the timeline actually GROWS.
  // ---------------------------------------------------------------------
  const driveRunner = new Function('deps', `
    const { nowPlaying, state, audioEl, scheduleCache, localDateStr, localDateStrOffset,
            paintNowPlaying, repaintExpandPanel, pickByPosition, playheadWallMs,
            episodeTracksById, hmsToSec, SEEK_TRACKS_DEBOUNCE_MS, NOW_PLAYING_TIMELINE_MAX,
            log } = deps;
    let seekTracksSeq = 0;
    const fetch = async () => ({ ok: true, json: async () => ({ tracks: log.tracks }) });
    ${(() => {
      const a = APP_CODE.indexOf('function mergeTimelineEntries(');
      let d = 0, e = a;
      for (let i = a; i < APP_CODE.length; i++) {
        if (APP_CODE[i] === '{') d++;
        else if (APP_CODE[i] === '}') { d--; if (d === 0) { e = i; break; } }
      }
      return APP_CODE.slice(a, e + 1);
    })()}
    ${(() => {
      const a = APP_CODE.indexOf('async function fetchEpisodeTracks(');
      let d = 0, e = a;
      for (let i = a; i < APP_CODE.length; i++) {
        if (APP_CODE[i] === '{') d++;
        else if (APP_CODE[i] === '}') { d--; if (d === 0) { e = i; break; } }
      }
      return APP_CODE.slice(a, e + 1);
    })()}
    ${(() => {
      const a = APP_CODE.indexOf('async function resolveSeekTracksFromSr(');
      let d = 0, e = a;
      for (let i = a; i < APP_CODE.length; i++) {
        if (APP_CODE[i] === '{') d++;
        else if (APP_CODE[i] === '}') { d--; if (d === 0) { e = i; break; } }
      }
      return APP_CODE.slice(a, e + 1);
    })()}
    return resolveSeekTracksFromSr;
  `);
  const polled = [
    { title: 'Earlier Song', artist: 'A', startMs: 1000, stopMs: 2000 },
    { title: 'On Air Song', artist: 'B', startMs: 2000, stopMs: 9000 },
  ];
  const realTracks = Array.from({ length: 17 }, (_, i) => ({
    title: `Historic ${i}`, artist: 'H',
    relativeStartTime: `00:${String(i * 3).padStart(2, '0')}:00`,
    relativeEndTime: `00:${String(i * 3 + 2).padStart(2, '0')}:30`,
  }));
  const mkDrive = (tracks) => {
    const log = { tracks, calls: [] };
    const nowPlaying = { timeline: polled.map((e) => ({ ...e })), channelId: 164 };
    const deps = {
      log,
      nowPlaying,
      // NOTE the shape: fetchScheduleDay produces `endMs`, NOT `stopMs`. This
      // is the exact detail the first draft got wrong, pinned deliberately.
      state: { current: { kind: 'live', id: 164, _srSchedule: [{ startMs: 0, endMs: 3_600_000, title: 'Vaken', episodeId: 2864965 }] } },
      audioEl: { currentTime: 0 },
      scheduleCache: new Map(),
      localDateStr: () => '2026-09-29',
      localDateStrOffset: () => '2026-09-28',
      paintNowPlaying: () => log.calls.push('paint'),
      repaintExpandPanel: () => log.calls.push('repaint'),
      pickByPosition: (arr, at) => arr.find((e) => e.startMs <= at && at < e.stopMs) || null,
      playheadWallMs: () => 3000,
      episodeTracksById: new Map(),
      hmsToSec: (s) => {
        if (typeof s !== 'string') return null;
        const p = s.split(':').map(Number);
        return p.length === 3 && p.every(Number.isFinite) ? p[0] * 3600 + p[1] * 60 + p[2] : null;
      },
      SEEK_TRACKS_DEBOUNCE_MS: 250,
      NOW_PLAYING_TIMELINE_MAX: 60,
    };
    return { run: driveRunner(deps), nowPlaying, log };
  };
  const positive = mkDrive(realTracks);
  await positive.run();
  assert.equal(positive.nowPlaying.timeline.length, polled.length + realTracks.length,
    'THE SUCCESS PATH: 17 SR tracks must be merged into the timeline. If this is ' +
    'the polled length, the lookup returned early and the whole path is dead.');
  // The polled entries must SURVIVE. They are checked BY IDENTITY, not by
  // position: the merge re-sorts the whole timeline by start time, and the SR
  // tracks are anchored at the episode start (0), which is EARLIER than the
  // polled entries (1000 and 2000). So the surviving polled songs are at
  // indices 1 and 2, not 0 and 1. Asserting positions would have been asserting
  // the sort order rather than the survival -- and would have failed on a
  // perfectly correct merge.
  const titles = positive.nowPlaying.timeline.map((e) => e.title);
  assert.ok(titles.includes('Earlier Song') && titles.includes('On Air Song'),
    'the polled entries must SURVIVE the merge -- SR data is added, not substituted');
  assert.equal(titles.filter((t) => t === 'Earlier Song').length, 1,
    'a polled entry must not be duplicated by the merge');
  assert.ok(positive.nowPlaying.timeline.every((e, i, a) => i === 0 || a[i - 1].startMs <= e.startMs),
    'the merged timeline must be sorted by start time, or the selector breaks');
  assert.deepEqual(positive.log.calls, ['paint', 'repaint'],
    'a successful merge must repaint through the normal path, not reach into the header');
  // The relative times must become ABSOLUTE wall-clock, so the existing
  // selector works unchanged. Asserted BY TITLE, not by index -- the merge
  // re-sorts, so index 2 is not necessarily the first SR track. Track "Historic 0"
  // starts at relative 00:00:00, which anchors to entry.startMs (0); "Historic 1"
  // starts at relative 00:03:00, which is 180_000 ms after it. If these were left
  // as the raw relative values, every track would collapse onto the episode start
  // and the selector would return the same song for the whole programme.
  const byTitle = Object.fromEntries(positive.nowPlaying.timeline.map((e) => [e.title, e]));
  assert.equal(byTitle['Historic 0'].startMs, 0,
    'the first SR track must anchor to the episode start (entry.startMs + 0)');
  assert.equal(byTitle['Historic 1'].startMs, 180_000,
    'relativeStartTime must become an absolute offset: 00:03:00 -> 180000 ms');
  assert.equal(byTitle['Historic 0'].stopMs, 150_000,
    'relativeEndTime must become absolute too, or every track would run to the end of the episode');
  assert.equal(byTitle['Historic 1'].stopMs, 330_000,
    'each track must end at its own relativeEndTime, not at the next track start');
  assert.ok(byTitle['Historic 0'].stopMs > byTitle['Historic 0'].startMs,
    'a merged track must have a positive duration, or it can never match a position');
  // And the negative control, in the same shape: an EMPTY list changes nothing.
  const talk = mkDrive([]);
  await talk.run();
  assert.equal(talk.nowPlaying.timeline.length, polled.length,
    'a talk programme (tracks: []) must leave the timeline exactly as the poll left it');
  assert.deepEqual(talk.log.calls, [],
    'an empty result must not trigger a repaint -- there is nothing new to show');

  // The cache is per channel: another channel's songs must not leak in.
  assert.ok(/episodeTracksById\.clear\(\)/.test(APP_CODE),
    'the per-episode cache must be cleared on a channel switch');
});

// ===================================================================
// WS29 — the visible timing readout in the Info sheet.
//
// WHY THIS BLOCK EXISTS. `edgeMinusNowS` has been measured on a desktop and
// NEVER on a device, and the owner's programme-skip offset (~10 s, then ~30 s,
// then ~25 s) has never been explained. WS29 ships the instrument: a Swedish
// switch and a signed, on-screen number in the existing Info sheet.
//
// THE DEFECT THIS BLOCK GUARDS. The readout's read path deliberately does NOT
// go through `metaDiagGateOpen()` — the owner chose that on 2026-09-30, because
// a query string cannot be produced by an action inside the app and the owner
// was being asked to open `?diag=metadata` by hand. The consequence is that a
// change to the gate, to the flag, or to the panel's read path can silently
// make the readout report "no data" forever — a panel that always reads
// "Starta en radiokanal först" looks EXACTLY like a correct panel on a channel
// that is not playing.
//
// So the two halves are asserted SEPARATELY and BOTH are asserted directly:
//
//   1. the panel reads the snapshot body with NO query string (the fix), and
//   2. the gate still refuses all four of its original cases (the protection).
//
// A test that only asserted (2) would pass on the unbuilt panel. A test that
// only asserted (1) would pass if the gate had been deleted. Neither alone is
// worth writing; together they pin the divergence down.
//
// `metaDiagReadoutLines()` is EXTRACTED from app.js by brace matching and
// EXECUTED, with a positive canary it increments itself — retyping the logic
// under test is how two earlier workstreams reached confident wrong answers
// (AGENTS.md §7).
const WS29_FLAG = 'sr-meta-diag';

// The three states the readout can be in. `null` is the important one: it is
// what a live radio channel looks like before playback has produced a
// seekable range, and rendering it as 0 is the specific failure this workstream
// exists to prevent.
//
// ---- WS30 SUPERSEDENCE, classified per AGENTS.md §7b, reason RETAINED. ----
// The three tests below originally drove `edgeMinusNowS` and asserted the
// readout rendered it. That field is `(now - (now - X))/1000`, which cancels to
// `X` — it is the playhead's own distance from the buffer edge wearing the
// label "offset". Rendering it was the defect, so a test that REQUIRES it to be
// rendered is now asserting the defect. These are SUPERSEDED (the requirement
// genuinely changed), NOT defects, and NOT a reason to weaken anything:
//
//   1. the signed-number test now drives `twoSource.offsetS` — the STREAM's own
//      clock — and additionally asserts that a `twoSource`-less world does NOT
//      fall back to `edgeMinusNowS`. Strictly stronger: it pins the sign AND
//      the absence of the fallback.
//   2. the negative-sign test is unchanged in strength, now on the real field.
//   3. the no-data test is UNCHANGED IN REQUIREMENT and STRENGTHENED: the same
//      "never renders 0/null/undefined" property now holds for every
//      non-numeric status, not just three null-ish shapes.
function ws29Harness(sourceText, edgeMinusNowS, extra) {
  const src = sourceText;
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`${name} must exist in the source under test`);
    let d = 0, end = -1;
    for (let i = start; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error(`brace matching failed for ${name}`);
    return src.slice(start, end + 1);
  };
  return new Function('deps', `
    const { edge, two, canary, playing, transport } = deps;
    // A stand-in for the real snapshot body. It is NOT a re-implementation of
    // anything under test: metaDiagReadoutLines reads fields from ONE injected
    // object, and the fields are injected so each state can be driven.
    //
    // ---- WS31: playback.current and dvr.transportKind are now READ. ----
    // The readout distinguishes "no channel playing" from "a channel playing
    // on a non-HLS transport", deriving each message from the condition that
    // message actually describes. A fixture omitting these fields describes a
    // world that cannot occur — a playing channel with no playback record —
    // so the harness supplies a REALISTIC default: a live radio channel on
    // HLS, which is the case every "has a reading" test here is about. Tests
    // that care about other states pass them explicitly.
    function metaDiagBuildSnapshot() {
      canary.buildCalls += 1;
      return {
        playback: {
          current: playing === undefined ? { kind: 'live', id: 164 } : playing,
        },
        dvr: {
          streamEdge: edge,
          twoSource: two,
          transportKind: transport === undefined ? 'hls-hlsjs' : transport,
          seek: { clampedByS: null },
        },
      };
    }
    ${grab('metaDiagReadoutLines')}
    return { readout: () => { canary.readoutCalls += 1; return metaDiagReadoutLines(); } };
  `);
}

const ws29Edge = (v) => ({ edgeMinusNowS: v });
// A REAL two-source reading: the app's belief, the STREAM's own clock, and
// their signed difference. `status: 'ok'` is required by the readout — a
// non-ok status is a non-numeric state, which is the point of R-B.
const ws29Two = (offsetS, over) => Object.assign({
  status: 'ok',
  appEdgeWallMs: 1_700_000_000_000,
  trueEdgeWallMs: 1_700_000_000_000 - offsetS * 1000,
  offsetS,
  sampleAgeS: 1.2,
  stale: false,
}, over || {});

test('WS29/30 the readout shows a SIGNED two-source number, and the canary proves the code ran', () => {
  const canary = { buildCalls: 0, readoutCalls: 0 };
  const two = ws29Two(27.4);
  const h = ws29Harness(APP_JS, ws29Edge(27.4), null)({ edge: ws29Edge(27.4), two, canary });
  const r = h.readout();
  // CANARY: the extracted function itself increments these. A zero means the
  // harness never executed the code under test, which must be a hard failure
  // and never a pass (AGENTS.md §7).
  assert.ok(canary.readoutCalls > 0, 'canary: metaDiagReadoutLines was never called');
  assert.ok(canary.buildCalls > 0, 'canary: the snapshot body was never called');
  assert.equal(r.ok, true);
  assert.match(r.primary, /\+27 s/,
    'a positive reading must be shown with an explicit + and whole seconds');
});

test('WS30 the readout NEVER falls back to the self-referential edgeMinusNowS', () => {
  // The tautology regression, at the panel level. A world that carries a
  // perfectly good-looking `edgeMinusNowS` but NO two-source sample must NOT
  // produce a number. If someone "fixes" the panel by falling back to
  // edgeMinusNowS when twoSource is missing, this is the test that goes red —
  // and the user-visible failure it catches is the panel showing the
  // playhead's distance from the buffer edge while calling it an offset.
  const canary = { buildCalls: 0, readoutCalls: 0 };
  const edge = ws29Edge(27.4);
  const h = ws29Harness(APP_JS, edge, null)({ edge, two: null, canary });
  const r = h.readout();
  assert.ok(canary.readoutCalls > 0, 'canary');
  assert.equal(r.ok, false,
    'a self-referential value must never be presented as a measurement');
  const text = `${r.primary} ${r.secondary || ''}`;
  assert.ok(!/\d+\s*s/.test(text),
    `no duration may be shown without a two-source sample (got: ${text})`);
});

test('WS29/30 a NEGATIVE reading keeps its minus sign, so the sign of the report is checkable', () => {
  const canary = { buildCalls: 0, readoutCalls: 0 };
  const two = ws29Two(-4.2);
  const h = ws29Harness(APP_JS, ws29Edge(-4.2), null)({ edge: ws29Edge(-4.2), two, canary });
  const r = h.readout();
  assert.ok(canary.readoutCalls > 0, 'canary');
  assert.equal(r.ok, true);
  assert.equal(r.seconds, -4);
  assert.ok(!/\+/.test(r.primary),
    `a negative reading must never render a + sign: ${r.primary}`);
  assert.match(r.primary, /4 s/);
});

test('WS29/30 NO DATA says so in Swedish and never renders 0, null or undefined', () => {
  // This is the test that matters most, and it is STRENGTHENED, not weakened.
  // The property is unchanged ("a missing reading must never look like a
  // zero offset") but it now has to hold for every non-numeric state the
  // panel can be in, which is more of them than before: R-B requires an
  // explicit state for not-yet-sampled, fetch-failed AND no-stream.
  const cases = [
    // NOTHING PLAYING -> the owner-facing message, unchanged.
    // ---- WS31: this case is now driven by `playback.current` being absent,
    // which is the condition the message actually DESCRIBES. It used to be a
    // null `streamEdge`, which describes a playing channel whose snapshot
    // lacks the section -- a world that cannot occur, and which WS31's
    // transport-aware branch now handles as its own state.
    ['nothing playing', null, null, /Starta en radiokanal/, null],
    // a channel is playing but the sample has not landed: must NOT be 0
    ['twoSource loading', ws29Edge(null), ws29Two(null, { status: 'loading', offsetS: null }), /Mäter/, undefined],
    // a failed fetch must NOT show a number and NOT show a stale one
    ['twoSource failed', ws29Edge(12), ws29Two(null, { status: 'failed', offsetS: null, error: 'timeout' }), /Kunde inte läsa/, undefined],
    // ok-status but a non-finite offset is still not a reading
    ['ok but offsetS NaN', ws29Edge(5), ws29Two(NaN, { status: 'ok' }), /.*/, undefined],
  ];
  for (const [label, edge, two, expect, playing] of cases) {
    const canary = { buildCalls: 0, readoutCalls: 0 };
    const h = ws29Harness(APP_JS, edge, null)({ edge, two, canary, playing });
    const r = h.readout();
    assert.ok(canary.readoutCalls > 0, `canary (${label})`);
    assert.match(r.primary, expect, `${label}: wrong primary text: "${r.primary}"`);
    const text = `${r.primary} ${r.secondary || ''}`;
    for (const bad of ['null', 'undefined', 'NaN']) {
      assert.ok(!text.includes(bad),
        `${label}: the readout must not contain "${bad}" (got: ${text})`);
    }
    if (label !== 'ok but offsetS NaN') {
      assert.ok(!/(^|[^.\d])0 s/.test(text),
        `${label}: the readout must not contain a bare "0 s" — it would be read as a zero offset (got: ${text})`);
    }
  }

  // The UNKNOWN-status default arm. R-B enumerates four states, and a status
  // added by a future edit must not slip through the `||` fallback into a
  // number. This case was NOT covered until the mutation proof showed that
  // replacing the fallback text with "Mäter 0 s" left EVERY test green — a
  // panel showing 0 for a state nobody anticipated, which is the defect.
  {
    const canary = { buildCalls: 0, readoutCalls: 0 };
    const two = ws29Two(null, { status: 'something-new', offsetS: null });
    const h = ws29Harness(APP_JS, ws29Edge(3), null)({ edge: ws29Edge(3), two, canary });
    const r = h.readout();
    assert.ok(canary.readoutCalls > 0, 'canary (unknown status)');
    assert.equal(r.ok, false, 'an unrecognised status must not report a reading');
    const text = `${r.primary} ${r.secondary || ''}`;
    assert.ok(!/(^|[^.\d])0 s/.test(text),
      `an unknown status must never render a bare "0 s" (got: ${text})`);
  }

  // Stale is NOT "no data": a stale sample is a real reading and the number
  // legitimately stays. What must happen is that it is LABELLED stale, so a
  // reader never mistakes a ten-minute-old value for a current one.
  {
    const canary = { buildCalls: 0, readoutCalls: 0 };
    const two = ws29Two(5, { sampleAgeS: 90, stale: true });
    const h = ws29Harness(APP_JS, ws29Edge(5), null)({ edge: ws29Edge(5), two, canary });
    const r = h.readout();
    assert.ok(canary.readoutCalls > 0, 'canary (stale)');
    assert.equal(r.ok, true, 'a stale sample is still a real reading, not an error');
    const text = `${r.primary} ${r.secondary || ''}`;
    assert.match(text, /gammal/, `a stale sample must be labelled stale (got: ${text})`);
    assert.match(text, /90 s|Mätt/, `the age must be shown for a stale sample (got: ${text})`);
  }
});

test('WS31 the panel must NOT say "start a channel" while a channel is PLAYING', () => {
  // THE DEFECT, found by the tech lead during the WS30 review and confirmed by
  // me in the browser before fixing.
  //
  // USER-VISIBLE FAILURE IT CATCHES: a radio channel is audibly playing, the
  // owner opens the Info sheet, and the panel says "Starta en radiokanal först"
  // — telling them to start a channel they have already started. They would
  // reasonably conclude the feature is broken.
  //
  // WHY IT IS REACHABLE FOR THE OWNER AND NOT ONLY ON DESKTOP: the app falls
  // back HLS -> direct MP3 whenever HLS is unavailable. Observed in Chromium
  // (`transportKind: "direct"`, `topsy/direkt/srapi/164.mp3`), and the same
  // fallback can happen on the phone.
  //
  // The message must be derived from what is TRUE: a channel is playing, and
  // the transport has no playlist, so there is no stream clock to compare
  // against. That is a real state with an honest explanation — and still no
  // number, because inventing one is the defect WS30 exists to fix.
  const canary = { buildCalls: 0, readoutCalls: 0 };
  const edge = ws29Edge(null);
  // Live channel PLAYING, but on direct (non-HLS) audio.
  const h = ws29Harness(APP_JS, edge, null)({
    edge,
    two: ws29Two(null, { status: 'idle', offsetS: null }),
    canary,
    playing: { kind: 'live', id: 164 },
    transport: 'direct',
  });
  const r = h.readout();
  assert.ok(canary.readoutCalls > 0, 'canary: the readout was never called');
  assert.equal(r.ok, false, 'there is no stream clock to compare, so no reading');
  assert.notEqual(r.state, 'no-stream', 'this is NOT the "nothing playing" state');
  assert.ok(!/Starta en radiokanal/.test(`${r.primary} ${r.secondary || ''}`),
    'the panel must not tell the owner to start a channel that is already '
    + `playing (got: "${r.primary}")`);
  // It must SAY what is actually wrong, so the owner can act on it.
  assert.match(r.primary, /spelllista|Direkt/i,
    `the message must name the real reason (got: "${r.primary}")`);
  // And it must still show no number.
  assert.ok(!/(^|[^.\d])\d+\s*s/.test(`${r.primary} ${r.secondary || ''}`),
    'a state with no stream clock must render NO number');

  // The genuine no-channel case keeps its original message — it is correct and
  // the owner knows it. Guards against "fixing" this by over-broadening.
  const c2 = { buildCalls: 0, readoutCalls: 0 };
  const none = ws29Harness(APP_JS, null, null)({
    edge: null, two: null, canary: c2, playing: null,
  });
  const r2 = none.readout();
  assert.equal(r2.state, 'no-stream');
  assert.match(r2.primary, /Starta en radiokanal/,
    'with nothing playing the original message must still be shown');

  // An EPISODE (podcast) is playing: also not a live HLS stream, and also not
  // "no channel". It must not claim a radio channel must be started.
  //
  // WHY THIS ASSERTS THE MESSAGE AND NOT JUST ITS ABSENCE. The mutation proof
  // caught my first version of this case going green: both `!isLive || !onHls`
  // and the wrong `!onHls` avoid the string "Starta en radiokanal" for an
  // episode, so a not-contains assertion could not tell them apart — the
  // classic §2 trap of testing the absence of a word instead of the presence
  // of the right behaviour. Asserting the episode-SPECIFIC wording is what
  // makes the `isLive` half of the condition load-bearing.
  const c3 = { buildCalls: 0, readoutCalls: 0 };
  const ep = ws29Harness(APP_JS, ws29Edge(null), null)({
    edge: ws29Edge(null), two: null, canary: c3,
    playing: { kind: 'episode', id: 12 },
    transport: null,
  });
  const r3 = ep.readout();
  assert.ok(!/Starta en radiokanal/.test(r3.primary),
    `a podcast must not be told to start a radio channel (got: "${r3.primary}")`);
  assert.equal(r3.state, 'no-stream-clock',
    'a podcast is not the "nothing playing" state');
  assert.match(r3.primary, /Podcast/i,
    `a podcast must be named as such, not described as a radio channel `
    + `(got: "${r3.primary}")`);

  // And the two playing-but-not-HLS states must be DISTINGUISHABLE, because
  // the owner's available action differs: a direct radio channel could be
  // fixed by enabling HLS, a podcast never has a stream clock at all.
  const c4 = { buildCalls: 0, readoutCalls: 0 };
  const live = ws29Harness(APP_JS, ws29Edge(null), null)({
    edge: ws29Edge(null),
    two: ws29Two(null, { status: 'idle', offsetS: null }),
    canary: c4,
    playing: { kind: 'live', id: 164 },
    transport: 'direct',
  });
  const r4 = live.readout();
  assert.match(r4.primary, /Direkt/i,
    `a direct radio channel must say it is direct audio (got: "${r4.primary}")`);
  assert.notEqual(r3.primary, r4.primary,
    'a podcast and a direct radio channel must not read identically');
});

test('WS31 an HLS channel still reaches the measurement (the fix narrows nothing)', () => {
  // The counterpart to the test above: the new branch must catch ONLY the
  // non-HLS case. If it swallowed the HLS path the panel would never show a
  // reading again — a "fix" that silently disables the feature.
  for (const transport of ['hls-hlsjs', 'hls-native']) {
    const canary = { buildCalls: 0, readoutCalls: 0 };
    const two = ws29Two(-28);
    const h = ws29Harness(APP_JS, ws29Edge(27), null)({
      edge: ws29Edge(27), two, canary,
      playing: { kind: 'live', id: 164 }, transport,
    });
    const r = h.readout();
    assert.equal(r.ok, true, `${transport}: an HLS channel must still report a reading`);
    assert.equal(r.seconds, -28, `${transport}: the two-source value must survive`);
  }
});

test('WS30 a real reading states WHICH clock is ahead, and shows the sample age', () => {
  // R-B: "both clocks present -> the signed offset, AND the age of the sample".
  // An offset with no age is indistinguishable from one taken ten minutes ago.
  const canary = { buildCalls: 0, readoutCalls: 0 };
  const two = ws29Two(9, { sampleAgeS: 3 });
  const h = ws29Harness(APP_JS, ws29Edge(9), null)({ edge: ws29Edge(9), two, canary });
  const r = h.readout();
  assert.equal(r.ok, true);
  // Both clocks must be named, so a reader can tell WHICH comparison is shown.
  // (An earlier version asserted the exact sentence "Strömmens klocka ... bakom
  // appens"; that wording was itself wrong — see the sign/direction bug the
  // browser caught, and the WS30 sign-agreement test. Asserting the PROPERTIES
  // rather than one phrasing is what stopped this from breaking silently.)
  assert.match(r.primary, /klocka/,
    'the panel must name the two clocks, not present a bare number');
  assert.match(r.primary, /strömmens/i,
    'the stream\'s own clock must be named in the sentence');
  assert.match(r.secondary, /nyss|Mätt/,
    `the sample age must be on screen (got: ${r.secondary})`);
});

test('WS29 the readout is READ-ONLY: it adds a reader, never a writer', () => {
  // AGENTS.md §3. The panel must not write any of the fields the playback paths
  // own, or the next session inherits a two-writer race.
  const panelRegion = region('function openAbout(', 'about.appendChild(body);', APP_CODE);
  const writes = ['state.current =', 'audioEl.currentTime =', 'audioEl.src =',
    'seekableEnd =', 'nowPlaying.timeline =', '.play()', '.pause()', 'hlsDetach('];
  for (const w of writes) {
    assert.ok(!panelRegion.includes(w),
      `the Info-sheet panel must not contain "${w}" — it is a read-only display`);
  }
});

test('WS29 the panel reads the snapshot body WITHOUT the ?diag=metadata query', () => {
  // The regression test for the defect that made this brief unbuildable: with
  // the owner's switch on and NO query string, the panel must still produce a
  // reading. If someone "simplifies" the panel back through the gate, this is
  // the test that goes red.
  const panelRegion = region('function openAbout(', 'about.appendChild(body);', APP_CODE);
  assert.ok(panelRegion.includes('metaDiagReadoutLines('),
    'the panel must call the real readout helper');
  assert.ok(!panelRegion.includes('metaDiagGateOpen('),
    'the panel must NOT go through metaDiagGateOpen() — the owner chose the '
    + 'deliberate in-app switch instead, and a URL query cannot be produced by it');
});

test('WS29 the gate is INTACT: all four original cases behave exactly as before', () => {
  // The protection half. Case D is the one the gate exists for: a shared
  // ?diag=metadata link with no flag must still yield nothing.
  const gate = region('function metaDiagGateOpen()', "return flag === 'on';", APP_CODE);
  assert.ok(gate.includes('META_DIAG_QUERY'),
    'the gate must still require the query string');
  assert.ok(gate.includes('localStorage.getItem(META_DIAG_FLAG)'),
    'the gate must still require the stored flag');

  // Driven, all four cases, against the real function.
  const grabGate = () => {
    const start = APP_JS.indexOf('function metaDiagGateOpen()');
    let d = 0, end = -1;
    for (let i = start; i < APP_JS.length; i += 1) {
      if (APP_JS[i] === '{') d += 1;
      else if (APP_JS[i] === '}') { d -= 1; if (d === 0) { end = i; break; } }
    }
    return APP_JS.slice(start, end + 1);
  };
  // Build a runner per case so the stored flag is genuinely in localStorage.
  const runCase = (q, flagValue) => new Function('q', `
    const META_DIAG_QUERY = 'diag=metadata';
    const META_DIAG_FLAG = ${JSON.stringify(WS29_FLAG)};
    const location = { search: q };
    const localStorage = { getItem: (k) => (k === META_DIAG_FLAG ? ${JSON.stringify(flagValue)} : null) };
    ${grabGate()}
    return metaDiagGateOpen();
  `)(q);
  assert.equal(runCase('', 'on'), false,
    'case A: the flag alone must NOT open the gate (a query string is required)');
  assert.equal(runCase('?diag=metadata', 'on'), true,
    'case B: both keys must open the gate');
  assert.equal(runCase('?diag=metadata', 'off'), false,
    'case C: flag "off" must keep the gate shut');
  assert.equal(runCase('?diag=metadata', null), false,
    'case D: a shared link with NO flag must yield nothing — this is the case '
    + 'the gate exists to stop');
});

test('WS29 the owner decision is recorded NEXT TO the gate, so it is not "fixed" away', () => {
  // A divergence with no explanation is indistinguishable from a bug, and the
  // next session would rationally delete the flag to "fix" it.
  // APP_JS, not APP_CODE: this asserts that a COMMENT exists, and APP_CODE has
  // had its comments stripped. Reading it from the stripped source would make
  // the assertion pass on an empty string -- a check that cannot fail.
  const near = APP_JS.slice(
    APP_JS.indexOf('function metaDiagGateOpen()') - 2600,
    APP_JS.indexOf('function metaDiagGateOpen()'));
  assert.ok(/OWNER DECISION/i.test(near),
    'the owner decision must be written in a comment beside metaDiagGateOpen()');
  assert.ok(/deliberate divergence/i.test(near),
    'the comment must say the divergence is deliberate, or a later session '
    + 'will treat it as an oversight');
});

test('WS29 the readout timer is cleared when the sheet closes, and never polls when off', () => {
  // A hidden panel that keeps polling is a battery bug; an interval that
  // outlives its sheet is the same defect wearing a different hat.
  const openRegion = region('function openAbout(', 'about.appendChild(body);', APP_CODE);
  assert.ok(/let readoutTimer = null;/.test(openRegion),
    'the interval handle must be declared where close() can reach it');
  // region() searches forward from the FIRST match, and `const close = () => {`
  // occurs in an earlier, unrelated function. Anchor on openAbout's own body so
  // this cannot silently read someone else's close handler -- the drifted-anchor
  // trap that has produced three wrong conclusions in this repo.
  const closeRegion = region(
    "aria-label': 'Om appen'", 'document.body.style.overflow', APP_CODE);
  assert.ok(/clearInterval\(readoutTimer\)/.test(closeRegion),
    'close() must clear the interval — otherwise it outlives the sheet');
  // The one declaration only. A second `let readoutTimer` further down would
  // shadow the first and close() would clear nothing at all.
  const declarations = openRegion.match(/let readoutTimer = null;/g) || [];
  assert.equal(declarations.length, 1,
    `exactly one readoutTimer declaration expected, found ${declarations.length} `
    + '— a second one shadows the first and the close handler becomes a no-op');
  // Off means no polling at all: the paint function must bail on a null timer.
  assert.ok(/if \(readoutTimer === null\) return;/.test(openRegion),
    'the paint function must return early when the panel is switched off, so '
    + 'an interval can never outlive the switch being turned off');
});

test('WS29 the switch reflects STORED state on open, and absent means OFF', () => {
  // Not "the click sets it" — "the panel tells the truth about what is stored".
  const openRegion = region('function openAbout(', 'about.appendChild(body);', APP_CODE);
  assert.ok(/localStorage\.getItem\(META_DIAG_FLAG\)/.test(openRegion),
    'the switch must read the stored flag, not assume a default');
  assert.ok(/syncSwitch\(\);/.test(openRegion),
    'the switch must be synced on open');
  assert.ok(/diagFlagRead\(\) === 'on'\) startReadout\(\); else stopReadout\(\);/.test(openRegion),
    'an absent flag must read as OFF: diagnostics must never be on for someone '
    + 'who never asked for it');
});

test('WS29 the section becomes VISIBLE when the switch is turned on', () => {
  // REGRESSION TEST for a bug the browser found and the suite could not.
  // `is-off` was applied only once, on open, so after switching on the section
  // kept `display:none` — the readout rendered correct text that the owner
  // could never see. Every text assertion passed while the element was
  // invisible. This asserts the CLASS FOLLOWS THE SWITCH, which is the
  // property that was actually missing.
  const openRegion = region('function openAbout(', 'about.appendChild(body);', APP_CODE);
  assert.ok(/diagSection\.classList\.toggle\('is-off', next !== 'on'\)/.test(openRegion),
    'the click handler must toggle `is-off` with the switch — applying it only '
    + 'on open leaves the panel invisible after the owner switches it on');
  // And it must be applied on open too, so the panel starts inert.
  assert.ok(/if \(diagFlagRead\(\) !== 'on'\) diagSection\.classList\.add\('is-off'\);/.test(openRegion),
    'an absent flag must start the section hidden');
});

test('WS29 the first paint happens AFTER the interval exists', () => {
  // REGRESSION TEST for the second browser-found bug. paintReadout() returns
  // early when readoutTimer is null, so calling it before setInterval left the
  // readout blank on open. Order is the whole property, so it is asserted as
  // order -- a setInterval that merely EXISTS would pass a weaker test.
  const openRegion = region('function openAbout(', 'about.appendChild(body);', APP_CODE);
  const start = openRegion.indexOf('const startReadout = () => {');
  assert.notEqual(start, -1, 'startReadout must exist');
  const body = openRegion.slice(start, openRegion.indexOf('};', start));
  const iInterval = body.indexOf('setInterval(');
  const iPaint = body.indexOf('paintReadout()');
  assert.ok(iInterval !== -1, 'startReadout must create the interval');
  assert.ok(iPaint !== -1, 'startReadout must paint once immediately');
  assert.ok(iInterval < iPaint,
    'setInterval must come BEFORE the first paintReadout() call: paintReadout '
    + 'returns early when readoutTimer is null, so painting first leaves the '
    + 'readout blank on open. Found by driving the real DOM.');
});

test('WS29 diagSection is declared BEFORE the click handler that mutates it', () => {
  // A temporal-dead-zone trap: the handler references diagSection, so a later
  // `const` would throw on the first click. Asserted as order for that reason.
  const openRegion = region('function openAbout(', 'about.appendChild(body);', APP_CODE);
  const iDecl = openRegion.indexOf('const diagSection = el(');
  const iHandler = openRegion.indexOf("diagSwitch.addEventListener('click'");
  assert.ok(iDecl !== -1, 'diagSection must be declared');
  assert.ok(iHandler !== -1, 'the click handler must exist');
  assert.ok(iDecl < iHandler,
    'diagSection must be declared before the handler that toggles its class, or '
    + 'the first click throws a temporal-dead-zone ReferenceError');
});
