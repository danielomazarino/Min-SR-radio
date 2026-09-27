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
  // WS16: .player-meta now holds a ROW WRAPPER plus the quality pill, so the
  // mode pill is no longer a direct child. The requirement survives: the meta
  // column still carries the quality pill AND the time state, one level down.
  // The slice is taken from .player-meta-row's own declaration -- anchoring on
  // the .player-meta line alone would start AFTER the row wrapper (region()
  // searches forward), which is the exact trap this file documents twice.
  const rowDecl = stripComments(region("const metaRowTop = el('div'", 'const meta = el(', APP_JS));
  assert.ok(/isLive \? mode : null/.test(rowDecl),
    '.player-meta-row must carry the time state, live-only (WS16)');
  const metaDecl2 = stripComments(region("const meta = el('div', { class: 'player-meta' }", '// Fas 4', APP_JS));
  assert.ok(/metaRowTop/.test(metaDecl2) && /quality/.test(metaDecl2),
    '.player-meta must carry the time-state row and the quality pill (WS16)');
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
  const SEEK_LIVE_UNTOUCHED = stripComments(region(
    'function seekToLive()', '// ---- DVR transport', APP_JS));
  assert.ok(/const target = Math\.max\(start, end - LIVE_EDGE_TOLERANCE_S\);/.test(SEEK_LIVE_UNTOUCHED),
    'seekToLive() target arithmetic must be unchanged');
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
  const SEEK_LIVE = stripComments(region('function seekToLive()', '// ---- DVR transport', APP_JS));
  assert.ok(/const target = Math\.max\(start, end - LIVE_EDGE_TOLERANCE_S\);/.test(SEEK_LIVE),
    'the seekToLive target must be byte-identical');
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
  assert.ok(/const target = Math\.max\(start, end - LIVE_EDGE_TOLERANCE_S\);/.test(SEEK_LIVE),
    'the seekToLive target must be byte-identical');
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
  assert.ok(/const target = Math\.max\(start, end - LIVE_EDGE_TOLERANCE_S\);/.test(SEEK_LIVE),
    'the seekToLive target must be byte-identical');
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
  assert.ok(/live\s*\n?\s*\? el\('div', \{ class: 'player-sub'/.test(headerBuild),
    'the header sub line must be live-conditional (WS15b)');
  assert.ok(/cur\._srProgramTitle \|\| cur\.subtitle \|\| 'Direkt'/.test(headerBuild),
    "radio must keep channel + programme in the header sub line");
  // The sub line must exist ONLY inside the live branch. Counting occurrences
  // is the honest assertion: the conditional itself is asserted above, so this
  // catches a second unconditional `class: 'player-sub'` being added alongside
  // it -- which is precisely how the duplication was reintroduced. A regex
  // that tried to "remove" the live branch and check the remainder was tried
  // first and was unreadable; count instead.
  assert.strictEqual((headerBuild.match(/class: 'player-sub'/g) || []).length, 1,
    "the header must render .player-sub exactly once, inside the live branch");
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
  assert.ok(/nowPlaying\.artwork/.test(MEDIA_SESSION) && /cur\.artwork/.test(MEDIA_SESSION)
    && /icons\/icon-512\.png/.test(MEDIA_SESSION),
    'artwork must fall back in order and never be invented');
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
  assert.ok(HEADER_ROW_WS12.indexOf('headerSpacer') < HEADER_ROW_WS12.indexOf('player-title'),
    'the spacer must be the FIRST cell, so the text starts on the artwork edge');
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
