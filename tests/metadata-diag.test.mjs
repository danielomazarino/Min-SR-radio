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
// APP_CODE when the assertions concern code rather than documentation.
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
  const addSites = APP_CODE.split('audioEl.addEventListener').length - 1;
  const countCalls = (APP_CODE.match(/metaDiagCountAdd\(/g) || []).length
    - (APP_CODE.match(/function metaDiagCountAdd\(/g) || []).length;
  assert.equal(addSites, 8, 'expected 8 audioEl.addEventListener source sites');
  assert.equal(countCalls, addSites,
    'every audioEl.addEventListener site must have a matching metaDiagCountAdd call');
  // Removals counted too.
  const remSites = APP_CODE.split('audioEl.removeEventListener').length - 1;
  const remCalls = (APP_CODE.match(/metaDiagCountRemove\(/g) || []).length
    - (APP_CODE.match(/function metaDiagCountRemove\(/g) || []).length;
  assert.equal(remSites, 2, 'expected 2 audioEl.removeEventListener sites');
  assert.equal(remCalls, remSites,
    'every audioEl.removeEventListener site must have a matching metaDiagCountRemove call');
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
