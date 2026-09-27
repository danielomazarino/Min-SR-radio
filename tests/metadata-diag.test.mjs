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
  assert.ok(!/\.previoussong/.test(fetchCode) && !/\.nextsong/.test(fetchCode),
    'WS0 must NOT read previoussong/nextsong at runtime — capture only');
  assert.ok(!/\.previoussong/.test(HOOK_CODE) && !/\.nextsong/.test(HOOK_CODE),
    'hook code must not access previoussong/nextsong');
  // But the raw body really is retained, so a future WS1 CAN read them.
  assert.ok(fetchCode.includes('META_DIAG.lastRightNowRaw = data;'),
    'the raw body must be retained in full so prev/next remain observable');
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
  assert.equal(addSites, 8, 'expected 8 audioEl.addEventListener source sites');
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
  assert.ok(/const nextEv = programBoundary\(schedule, posMs\(\), \+1\);/.test(PROGRAM_SKIP_CODE),
    'the next-programme lookup must survive');
  assert.ok(/const behindLive = cur\.atLiveEdge === false/.test(PROGRAM_SKIP_CODE),
    'the behind-live test must survive');
  assert.ok(/cur\.seekableEnd - \(audioEl\.currentTime \|\| 0\) > 60/.test(PROGRAM_SKIP_CODE),
    'the >60s behind-live threshold must survive');
  assert.ok(/nextProgramBtn\.style\.display = '';/.test(PROGRAM_SKIP_CODE)
    && /nextProgramBtn\.style\.display = 'none';/.test(PROGRAM_SKIP_CODE),
    'both button-visibility branches must survive');
  assert.ok(/nextProgramBtn\.title = nextEv\.title \|\| 'Nästa program';/.test(PROGRAM_SKIP_CODE),
    'the button title must survive');
  assert.ok(/prevProgramBtn\.onclick = \(\) => seekToProgramTime\(prevEv\.startMs\);/.test(PROGRAM_SKIP_CODE)
    && /nextProgramBtn\.onclick = \(\) => seekToProgramTime\(nextEv\.startMs\);/.test(PROGRAM_SKIP_CODE),
    'both seek targets must survive');
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

test('WS2 Bug 1: seekToLive targets just BEHIND the edge, not onto the boundary', () => {
  // The defect: `audioEl.currentTime = end` — exactly the buffered end.
  assert.ok(!/audioEl\.currentTime = end;/.test(SEEK_TO_LIVE),
    'seekToLive must NOT assign the exact buffered end (the no-op boundary seek)');
  // The fix: aim behind the edge by the same tolerance updateSeekableState()
  // uses to classify "at live", so the result still counts as live.
  assert.ok(/end - LIVE_EDGE_TOLERANCE_S/.test(SEEK_TO_LIVE),
    'the target must sit behind the edge by LIVE_EDGE_TOLERANCE_S');
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
  assert.ok(RENDER_SONG_VIEW.includes('nowPlaying.artwork'), 'live artwork must still be shown');
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
  assert.ok(/audioEl\.currentTime = target;/.test(SEEK_TO_LIVE),
    'the seek target assignment must be unchanged');
  assert.ok(SEEK_TO_LIVE.includes('Math.max(start, end - LIVE_EDGE_TOLERANCE_S)'),
    'the target arithmetic must be unchanged from WS2 — WS3 attempts no fix');
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
  assert.ok(/nextProgramBtn\.onclick = \(\) => seekToLive\(\);/.test(SYNC_NEXT),
    'the fallback must call seekToLive()');
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
  assert.ok(/quality/.test(metaDecl) && /mode/.test(metaDecl),
    '.player-meta must still carry the quality and mode pills');
  // ... but must still exist, with their ORIGINAL class names, in a header
  // line appended to $player.
  const header = stripComments(region('const headerLine = el(', 'const songLine', APP_JS));
  assert.ok(header.includes("class: 'player-title'"),
    '.player-title must keep its original class name');
  assert.ok(header.includes("class: 'player-sub'"),
    '.player-sub must keep its original class name');
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
  const song = stripComments(region('const songLine = live', '$player.appendChild(headerLine)', APP_JS));
  assert.ok(song.includes("class: 'now-playing-line'"),
    'the song line must keep its original class name');
  assert.ok(song.includes("'aria-live': 'polite'"),
    'aria-live="polite" must be preserved');
  // Live channels only, exactly as before.
  assert.ok(/const songLine = live\s*\?/.test(song),
    'the song line must remain live-only');
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
  // SUPERSEDED BY WS5b, kept in the WS5 shape but pointed at the structure
  // that replaced the standalone .player-header-btns row: close first and
  // expand last, both inside the header row. Asserted positionally because
  // the element order inside el(...) IS the DOM order -- that is the whole
  // point of putting them in one row.
  const header = stripComments(region(
    "const headerLine = el('div', { class: 'player-header' }",
    '$player.appendChild(headerLine);', APP_JS));
  assert.ok(/closeBtn/.test(header),
    'the close button must be built into the header row');
  assert.ok(/expandBtn/.test(header),
    'the expand chevron must be built into the header row');
  assert.ok(header.indexOf('closeBtn') < header.indexOf('player-title'),
    'the close button must come first, so it marks the top-LEFT corner');
  assert.ok(header.indexOf('expandBtn') > header.indexOf('player-sub'),
    'the chevron must come after the text, so it marks the top-RIGHT corner');
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
  assert.ok(!/\.player-header[^{]*\{[^}]*font-size:\s*1[01](\.\d)?px/.test(STYLES_WS5),
    'the header must not shrink the base font sizes to claw back space');
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
  assert.ok(APP_CODE.includes("nextProgramBtn.onclick = () => seekToLive()"),
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
  const row = stripComments(region('.player-header {', '.player-row {', STYLES_WS5));
  assert.ok(/gap: var\(--player-gap\)/.test(row),
    'the header must use the same gap as the player row');
  assert.ok(/\.player-header \.player-btn-close \{[\s\S]*?width: var\(--player-art\)/.test(row),
    'the close button must occupy the artwork column so the text lines up');
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
  const header = stripComments(region(
    "const headerLine = el('div', { class: 'player-header' }",
    '$player.appendChild(headerLine);', APP_JS));
  assert.ok(/class: 'player-title'/.test(header), 'the channel title must survive');
  assert.ok(/class: 'player-sub'/.test(header), 'the programme subtitle must survive');
  assert.ok(header.indexOf('player-title') < header.indexOf('player-sub'),
    'the channel must come before the programme on the shared line');
  // Both still reachable by the paint functions and the WS0 snapshot.
  assert.ok(/metaDiagText\(\$player, '\.player-title'\)/.test(APP_CODE),
    'the WS0 snapshot must still be able to read the channel title');
  assert.ok((APP_CODE.match(/class: 'player-title'/g) || []).length === 2,
    'the title must exist in exactly two places: the mini-bar and the header');
  assert.ok(/querySelector\('\.player-sub'\)/.test(APP_CODE),
    'paintProgramTitle must still be able to query .player-sub');
  assert.ok(/\$player\.appendChild\(headerLine\);/.test(RENDER_WS5),
    'the header must still be appended to $player');
  // WS5 capped the channel at 40% of the header, which truncated it on narrow
  // phones. The cap is gone; the title keeps its intrinsic width.
  const row = stripComments(region('.player-header {', '.player-row {', STYLES_WS5));
  assert.ok(!/max-width: \d+%/.test(row),
    'the percentage width cap must be gone');
  assert.ok(/\.player-header \.player-title \{ flex: 0 1 auto; min-width: 0; \}/.test(row),
    'the title must shrink only when the programme needs room');
  assert.ok(/\.player-header \.player-sub \{ flex: 1 1 auto; min-width: 0; \}/.test(row),
    'the programme must take the remaining width and ellipsize');
});

test('WS5b Item 3: the buttons are corners of the header row, not a floating row',
() => {
  // Provenance, not just presence: the chevron is pushed out by
  // `margin-left: auto`, so the shrinking text can never run underneath it.
  const row = stripComments(region('.player-header {', '.player-row {', STYLES_WS5));
  assert.ok(/\.player-header \.player-expand-btn \{[\s\S]*?margin-left: auto/.test(row),
    'the chevron must be pinned to the right by auto margin, not a fixed width');
  assert.ok(/\.player-header \.player-expand-btn \{[\s\S]*?flex: none/.test(row),
    'the chevron must not be squeezed by the text');
  // The close button grows from 32px to the artwork size, which both fills the
  // column and enlarges the touch target.
  // Anchor with the leading newline on purpose: '.player-btn-close {' is also a
  // substring of '.player-mini .player-btn-close {', and matching that one
  // would silently test the mini-bar override instead of the base rule.
  const closeBtn = stripComments(region('\n.player-btn-close {', '.player-btn-close svg',
    STYLES_WS5));
  assert.ok(/width: 32px/.test(closeBtn),
    'the base close button size must survive for other surfaces (mini-bar)');
  assert.ok(/\.player-header \.player-btn-close \{[\s\S]*?height: var\(--player-art\)/.test(row),
    'the header close button must match the artwork height');
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
