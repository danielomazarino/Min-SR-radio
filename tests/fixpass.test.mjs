/**
 * Regression tests for the 2026-09-22 fix pass:
 *   BUG A — DVR mode pill shows minus-time (dvrOffsetLabel), not clock time.
 *   BUG B — DVR slider stability: touch-action rule + drag robustness.
 *   BUG 1 — Settings sheet: swipe surface scoped to grab zone, close button
 *           appended, listener cleanup.
 *   BUG 2 — News links: feed /artikel/<id> URLs are DEAD (SR 404s them);
 *           links must be slug-derived or SR search, never the id URL.
 *
 * The pure logic (slugifyTitle/articleLinkFor/dvrOffsetLabel) is mirrored
 * from public/app.js — keep in sync.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The root assets are the tracked GitHub Pages source of truth. `public/` is
// ignored development scaffolding and can lag the checked-in deployment files.
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

// Comment-stripped app.js, at MODULE scope so every test can use it.
//
// WHY THIS EXISTS, and why it is defined once here rather than inside the test
// that first needed it: app.js is heavily commented, and several of those
// comments legitimately NAME identifiers an assertion is trying to prove the
// CODE does not use. A raw-text scan therefore trips over its own
// documentation. This is the "a pattern containing a comment can never match a
// stripComments()ed slice" trap, in reverse, and it is now the fourth distinct
// instance in this repo (see the region() note in metadata-diag.test.mjs).
//
// It is deliberately a SIMPLE strip: a comment naming a pattern must not
// satisfy a negative match. It is not string-aware, which is safe here only
// because the assertions below target identifiers, not URL substrings.
const CODE = APP_JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// A brace-matched extractor for one top-level `function NAME(` body.
//
// It exists because `region()` lives in itunes-podcast.test.mjs and is not
// importable, and because a hard-coded END MARKER is a trap here: ITEM 1
// renamed `swipeSurface` -> `closeWithDone` and two guards in the other file
// silently became "end marker not found" rather than reporting a defect. This
// version cannot go stale that way — the end is the function's own closing brace.
//
// TWO TRAPS this had to be built around, both found by running it, not by
// reading it (AGENTS.md §7 — a harness must prove it executes the code):
//
//  1. `indexOf('{', start)` finds the DESTRUCTURING brace. The signature is
//     `function openSheet({ initialTab, onDone }) {`, so the first `{` opens
//     the parameter list, and its `}` closes it — the extractor returned a
//     43-character SIGNATURE and every assertion below silently passed on an
//     empty string. It is fixed by skipping to the `)` first.
//  2. Because of (1), a bare "the function exists" canary was NOT a canary: it
//     went green while the extractor returned nothing usable. The real canary
//     is the length floor plus the marker, and it is asserted below.
//
// Comments are stripped, for the reason in the CODE note above: app.js's
// comments legitimately name identifiers an assertion is trying to prove the
// CODE does not use.
const CODE_COMMENTS = /\/\*[\s\S]*?\*\//g;
function extractFunction(src, name, mustContain) {
  const start = src.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `canary: function ${name} must exist in app.js`);
  // Skip the PARAMETER LIST — a destructured parameter is itself a brace pair,
  // and treating it as the body is trap (1) above.
  const paren = src.indexOf(')', start);
  assert.notEqual(paren, -1, `canary: function ${name} has no closing paren`);
  const open = src.indexOf('{', paren);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.notEqual(end, -1, `canary: unbalanced braces after ${name}`);
  const body = src.slice(start, end).replace(CODE_COMMENTS, '').replace(/\/\/[^\n]*/g, '');
  // The canary that would have caught trap (1): a signature-only extract is
  // ~43 chars; a real body is three orders of magnitude larger. The marker is
  // what the caller actually needs, so its absence must be fatal too.
  assert.ok(body.length > 500,
    `canary: extractFunction('${name}') returned ${body.length} chars — ` +
    'the brace match did not reach the body (destructuring-brace trap)');
  if (mustContain) {
    assert.ok(body.includes(mustContain),
      `canary: extractFunction('${name}') is missing ${mustContain}`);
  }
  return body;
}

// ---- BUG A: mode pill shows minus-time ----

function dvrOffsetLabel(secondsBehind) {
  if (!Number.isFinite(secondsBehind) || secondsBehind < 60) return 'LIVE';
  const totalMin = Math.floor(secondsBehind / 60);
  if (totalMin < 1) return 'LIVE';
  if (totalMin < 60) return `−${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `−${h} h ${m} min` : `−${h} h`;
}

test('BUG A: mode pill uses dvrOffsetLabel (minus-time), not clock time', () => {
  // The renderPlayer mode-pill branch must call dvrOffsetLabel, not
  // dvrClockLabel. Regression for the 2026-09-22 user preference.
  assert.ok(APP_JS.includes('modeText = dvrOffsetLabel(cur.distanceFromLiveEdge)'),
    'mode pill must use dvrOffsetLabel');
  // The clock label must NOT be used for the pill (it stays on the seek row).
  const pillBranch = APP_JS.slice(
    APP_JS.indexOf('let modeText = \'LIVE\';'),
    APP_JS.indexOf('const mode = live')
  );
  assert.ok(!pillBranch.includes('dvrClockLabel'),
    'mode pill must not use clock time (duplicated info)');
});

test('BUG A: offset label still formats correctly (existing contract)', () => {
  assert.equal(dvrOffsetLabel(720), '−12 min');
  assert.equal(dvrOffsetLabel(65 * 60), '−1 h 5 min');
  assert.equal(dvrOffsetLabel(15), 'LIVE');
});

// ---- BUG B: slider stability ----

test('BUG B: .dvr-bar has touch-action:none (Safari gesture conflict fix)', () => {
  const m = STYLES_CSS.match(/\.dvr-bar\s*\{[^}]*touch-action:\s*none[^}]*\}/);
  assert.ok(m, '.dvr-bar must set touch-action: none');
});

test('BUG B: drag paint is rAF-throttled (iOS pointermove flood fix)', () => {
  assert.ok(APP_JS.includes('paintThrottled'), 'rAF-throttled paint must exist');
  assert.ok(APP_JS.includes('requestAnimationFrame'), 'must use requestAnimationFrame');
});

test('BUG B: pointercancel + pointerleave + stuck-drag watchdog exist', () => {
  assert.ok(APP_JS.includes("bar.addEventListener('pointercancel', endDrag)"),
    'pointercancel must end the drag');
  assert.ok(APP_JS.includes("bar.addEventListener('pointerleave'"),
    'pointerleave safety net must exist');
  assert.ok(APP_JS.includes('_srStuckGuard'), 'stuck-drag watchdog must exist');
});

test('BUG B: LIVE label has breathing room from the thumb (user note)', () => {
  // The bar gets right padding so the thumb cannot reach the LIVE label zone.
  const m = STYLES_CSS.match(/\.dvr-bar\s*\{[^}]*padding-right:\s*14px[^}]*\}/);
  assert.ok(m, '.dvr-bar must have right padding separating thumb from LIVE');
});

// ---- Episode seek drag ----

test('episode seek exposes an accessible slider with a visible movable thumb', () => {
  assert.ok(APP_JS.includes("class: 'seek-bar episode-seek-bar'"), 'episode slider class');
  assert.ok(APP_JS.includes("'aria-label': 'Spola i avsnittet'"), 'accessible name');
  assert.ok(APP_JS.includes("el('div', { class: 'seek-thumb' })"), 'episode thumb exists');
  assert.ok(APP_JS.includes("thumb.style.left = `${f * 100}%`"), 'thumb follows preview');
});

test('episode seek supports pointer preview, release commit, and cancellation restore', () => {
  const start = APP_JS.indexOf("class: 'seek-bar episode-seek-bar'");
  const end = APP_JS.indexOf('} else if (cur.dvrAvailable)', start);
  const episodeSeek = APP_JS.slice(start, end);
  assert.ok(episodeSeek.includes('installEpisodeSeekPointerHandlers(bar'), 'pointer state machine is wired');
});

test('episode seek has forgiving invisible thumb hit area and retains vertical page gestures', () => {
  assert.match(STYLES_CSS, /\.episode-seek-bar\s*\{[^}]*touch-action:\s*pan-y/s,
    'episode slider must preserve vertical panning');
  assert.match(STYLES_CSS, /\.episode-seek-bar \.seek-thumb\s*\{[^}]*width:\s*32px[^}]*height:\s*32px/s,
    'episode thumb hit target is 32px');
  assert.match(STYLES_CSS, /\.episode-seek-bar \.seek-thumb::after\s*\{[^}]*inset:\s*9px/s,
    'visible dot stays smaller than hit target');
});

test('episode metadata repaint does not depend on the compact live song line', () => {
  const start = APP_JS.indexOf('  function paintNowPlaying() {');
  const end = APP_JS.indexOf('\n  // ---- Pågår nu-programmet', start);
  const painter = APP_JS.slice(start, end);
  assert.ok(painter.includes('if (line) {'), 'compact line is optional');
  // WS26: the inline panel lookup became the named repaintExpandPanel(), so
  // that three consumers could share one call site. The BEHAVIOUR this test
  // guards is unchanged: the repaint still runs independently of the compact
  // line, and it is still not short-circuited by a missing line.
  assert.ok(painter.includes('repaintExpandPanel();'), 'open panel repaint must run');
  assert.ok(APP_JS.includes('function repaintExpandPanel() {'),
    'the panel repaint must be a named function, not three inline copies');
  assert.ok(/function repaintExpandPanel\(\) \{[\s\S]*?querySelector\('\.player-expand'\)[\s\S]*?_srRepaint\(\)/.test(APP_JS),
    'repaintExpandPanel must find the open panel and call its repaint hook');
  assert.ok(!/^\s*if \(!line\) return;/m.test(painter),
    'missing compact live line must not short-circuit episode panel repaint');
});

// ---- BUG 1: settings sheet scroll ----

test('episode-to-episode starts invalidate the previous episode track state', () => {
  const start = APP_JS.indexOf('  function playTrack(track) {');
  const end = APP_JS.indexOf('\n  // ---- playback watchdog ----', start);
  const playTrack = APP_JS.slice(start, end);
  assert.ok(playTrack.indexOf('stopEpisodeTracks();') < playTrack.indexOf('state.current = track;'),
    'clear/invalidate old episode metadata before changing current track');
  assert.ok(playTrack.includes('if (tracks && state.current === track) updateEpisodeTrack()'),
    'late episode track fetch is still guarded to its playback object');
});

test('episode expanded artwork never borrows a live channel song artwork', () => {
  // WS12 Part C kept this rule and changed only WHICH image an episode uses.
  // The original intent stands: an episode must never show the iTunes
  // artwork of a live channel's song. Episodes now show `live.artwork`, the
  // PROGRAMME image (pod.image / item.imageUrl / ev.image), which is the
  // podcast's own album cover and is already on the track.
  //
  // The iTunes path is not merely unsuitable for episodes, it is unreachable:
  // refreshNowPlayingArtwork() is called only from fetchNowPlaying(), which
  // runs only when kind === 'live', so nowPlaying.artwork is null for an
  // episode BY CONSTRUCTION. Measured against real SR names, the lookup also
  // returns unrelated songs ("P3 Soul" -> PARTYNEXTDOOR "Not Nice"), so
  // extending it would show a stranger's cover under a Swedish programme.
  const EXPAND = APP_JS.slice(APP_JS.indexOf('const renderSongView = () => {'));
  assert.ok(/const songArtwork = isEpisode\s*\?/.test(EXPAND),
    'the episode branch of songArtwork must remain explicit and separate');
  // WS26: the live arm no longer names nowPlaying.artwork -- that field is
  // gone -- it reads the one resolver. The rule under test is unchanged and is
  // now stronger: an episode arm cannot reach ANY live cover field.
  assert.ok(/isEpisode\s*\?\s*\(nowPlaying\.episodeArtwork\s*\|\|\s*live\.artwork\s*\|\|\s*null\)\s*:\s*\(head\s*\?\s*head\.artwork\s*:\s*null\)/.test(EXPAND),
    "the episode arm must still read only episodeArtwork/live.artwork, and the live arm only the resolver");
  // WS13 Part B supersedes the WS12 conclusion that an episode must use the
  // programme image and nothing else. That conclusion was WRONG: it rested on
  // searches the code never makes (podcast NAMES), whereas this path searches
  // a real song's "artist title". Re-measured on 51 real tracks: 73% resolve,
  // 89% of those to a plausible artist.
  //
  // The rule that still stands, and is the real point of this test, is the one
  // underneath: an episode must never inherit a LIVE CHANNEL's song cover.
  // nowPlaying.episodeArtwork is a separate field precisely so the two cannot
  // overwrite each other. That separation is asserted, not assumed.
  const decl = /const songArtwork = isEpisode[\s\S]*?;/.exec(EXPAND);
  assert.ok(decl, 'songArtwork must be a single readable declaration');
  assert.ok(/nowPlaying\.episodeArtwork/.test(decl[0]),
    "an episode's cover must prefer its own resolved album cover");
  assert.ok(/live\.artwork/.test(decl[0]),
    'and fall back to the programme image when no cover resolves');
  // The two artwork fields must be distinct, so an episode can never show a
  // live channel's song cover by accident.
  // The two fields must be SEPARATE, which is the property N8 attacked.
  // Asserting only that `episodeArtwork: null` appears was not enough: adding a
  // DUPLICATE `artwork:` key to the same object literal satisfies that pattern
  // and would let one kind's cover overwrite the other's. JavaScript accepts a
  // duplicate key silently -- the last one wins -- so this has to be checked by
  // counting, not by presence.
  const npDecl = /const nowPlaying = \{[\s\S]*?playheadArtwork: null \};/.exec(APP_JS);
  assert.ok(npDecl, 'the nowPlaying literal must be readable');
  const npBody = npDecl[0];
  // WS26: THREE cover fields now, and the duplicate-key hazard applies to each
  // one. `artwork:` alone would also match `episodeArtwork:`/`onAirArtwork:`
  // as a substring, so the count is anchored to the START of a key.
  for (const key of ['onAirArtwork', 'playheadArtwork', 'episodeArtwork']) {
    assert.equal((npBody.match(new RegExp(`\\b${key}:`, 'g')) || []).length, 1,
      `exactly one ${key} key -- a duplicate would silently shadow it`);
  }
  // The old single `artwork` key must be GONE, not merely unused: leaving it in
  // the literal is what would let a future writer resurrect the dual-writer.
  assert.ok(!/^\s*artwork:/m.test(npBody),
    'the ambiguous `artwork` field must not exist alongside the three');
  // And the three must be written from three different fields at three
  // different call sites, so no two paths can inherit each other's cover.
  assert.ok(/if \(kind === 'poll'\) \{ nowPlaying\.onAirArtwork =/.test(APP_JS),
    "the poll writer must write nowPlaying.onAirArtwork");
  assert.ok(/else if \(kind === 'playhead'\) \{ nowPlaying\.playheadArtwork =/.test(APP_JS),
    "the playhead writer must write nowPlaying.playheadArtwork");
  assert.ok(/else nowPlaying\.episodeArtwork =/.test(APP_JS),
    'the episode writer must write nowPlaying.episodeArtwork, not a live field');
  // The live arm reads the ONE resolver, which is what makes R6 structural.
  assert.ok(/head \? head\.artwork : null/.test(decl[0]),
    'a live song must take its cover from resolvePlayheadMeta(), not a raw field');
  // The episode arm must be the PROGRAMME image and the live arm must be the
  // iTunes/rightnow image -- read them positionally, not just by presence, so
  // swapping the two cannot pass.
  const arms = /isEpisode\s*\?\s*\(([^)]*)\)\s*:\s*([\s\S]*?);/.exec(decl[0]);
  assert.ok(arms, 'songArtwork must be a readable isEpisode ternary');
  // WS13: the episode arm reads its OWN resolved album cover first and the
  // programme image second. It must NOT read the live channel's artwork field.
  assert.ok(/episodeArtwork/.test(arms[1]),
    'the EPISODE arm must prefer its own resolved album cover');
  assert.ok(/live\.artwork/.test(arms[1]),
    'and fall back to the programme image');
  assert.ok(!/nowPlaying\.artwork/.test(arms[1]),
    "the episode arm must NOT read the LIVE channel's artwork field");
  assert.ok(/head \? head\.artwork : null/.test(arms[2]),
    'the LIVE arm must read the resolver\'s cover, which is the rightnow/iTunes artwork at the live edge');
  // Episodes must not trigger an iTunes lookup at all. Comments are stripped
  // first: the WS12 comment NAMES refreshNowPlayingArtwork() while explaining
  // why it is unreachable, and a raw-text scan would trip over its own
  // documentation. This is the "a pattern containing a comment can never match
  // a stripComments()ed slice" trap, in reverse.
  // Comments are stripped first: the WS12 comment NAMES
  // refreshNowPlayingArtwork() while explaining why it is unreachable, and a
  // raw-text scan would trip over its own documentation.
  // WS24: the comment-stripped source is now the module-scope CODE, defined
  // once at the top of this file so the WS24 tests below can share it.
  const code = CODE;
  // WS13 Part B: TWO call sites plus the definition -- the live poll and the
  // episode track-change path. Both must be real, or the feature is dead code.
  // The single-mechanism rule still holds: the same function, the same
  // artworkCache, the same artworkSeq guard, no second lookup implementation.
  //
  // ---- WS24: TWO further call sites were added, and the count moved 3 -> 5 ----
  // The seek path (resolveMetadataForPosition) now asks for the cover of a
  // song resolved by scrubbing back. Before WS24 the seek path called neither,
  // so a historical song inherited the last POLLED song's cover -- measured:
  // title B with cover A, or no cover at all when the previous song had none.
  //
  // It calls TWICE, and both are deliberate:
  //   - `refreshNowPlayingArtwork(null, nowPlaying)` to CLEAR the previous
  //     song's cover the moment the song changes, so a wrong cover is never
  //     shown next to a new title. This is the function's own existing
  //     no-song branch, not a new mechanism.
  //   - `refreshNowPlayingArtwork(now, nowPlaying)` inside the debounce, to
  //     fetch the cover for wherever the playhead settled.
  //
  // The count is restated rather than loosened. What this test actually
  // protects is the SINGLE-MECHANISM rule -- one implementation, one cache,
  // one seq guard -- and every one of those assertions is unchanged and still
  // exact. Four callers of ONE shared function is not four mechanisms; a
  // second implementation, cache or guard would be, and each is still
  // counted at exactly 1.
  //
  // The sites are additionally asserted BY NAME, because a count alone cannot
  // say whether a new caller is the seek path or somewhere unsafe.
  // WS56: RESTATED, 5 -> 6, and the sixth is NAMED rather than allowed in by a
  // loosened number. The new site is the second seek-clear: the first fires when
  // the resolved song CHANGES, this one fires when the resolved song is GONE
  // (talk radio, or the gap between two songs). Without it the cover of a song
  // that ended minutes ago survives -- the owner's exact report, "the cover
  // showed that old stale Tove Styrke cover instead of not showing a cover at
  // all".
  //
  // It is still ONE mechanism, which is what this test protects: one
  // implementation, one cache, one seq guard, each still counted at exactly 1
  // below. Five callers of a shared function is not five mechanisms.
  const calls = code.split('refreshNowPlayingArtwork(').length - 1;
  assert.equal(calls, 6,
    'five call sites (live, episode, seek-clear-on-change, seek-clear-on-gone, '
    + 'seek-fetch) plus the definition');
  // A count cannot say WHICH site is new, so the two seek-clears are pinned by
  // their distinct guards -- one keyed on a song change, one on there being no
  // song. If a future edit merges them, this fails rather than the count drifting.
  assert.equal(
    (code.match(/if \(nowPlaying\.playheadArtwork\) refreshNowPlayingArtwork\(null, 'playhead'\)/g) || []).length,
    2,
    'both seek-clears must exist and must both guard on a cover being present, '
    + 'so neither can fire a pointless request');
  assert.match(code, /if \(!\(hit && hit\.title && hit\.artist\)\)/,
    'WS56: there must be a branch for "the playhead resolved to NO song" -- its '
    + 'absence is the defect');
  assert.equal((code.match(/async function refreshNowPlayingArtwork/g) || []).length, 1,
    'exactly ONE implementation -- every path must reuse it, not clone it');
  // Only ONE cache and ONE seq guard, or the paths could disagree.
  assert.equal((code.match(/const artworkCache = new Map/g) || []).length, 1,
    'exactly one artwork cache');
  assert.equal((code.match(/const seq = \+\+artworkSeq/g) || []).length, 1,
    'exactly one artworkSeq guard, inside the shared function');

  // ---- WS24: the third caller is the seek path, and it is BOUNDED ----
  // A network request per distinct song is already deduped by artworkCache,
  // but a scrub-drag across an hour would cross many songs in a second. So
  // the seek caller must be debounced, and the timer must be cancellable.
  const RESOLVE = (() => {
    const a = code.indexOf('function resolveMetadataForPosition(');
    assert.notEqual(a, -1, 'resolveMetadataForPosition must exist');
    return code.slice(a, code.indexOf('async function resolveProgramTitle(', a));
  })();
  assert.ok(/refreshNowPlayingArtwork\(/.test(RESOLVE),
    'the seek path must request artwork for the song it resolved');
  assert.ok(/setTimeout\(/.test(RESOLVE),
    'the seek artwork lookup must be debounced, or a scrub-drag fires one request per boundary');
  assert.ok(/clearTimeout\(seekArtworkTimer\)/.test(RESOLVE),
    'a newer song must cancel the pending lookup, or responses arrive out of order');
  assert.ok(/SEEK_ARTWORK_DEBOUNCE_MS/.test(RESOLVE),
    'the debounce interval must be the named constant, not a magic number');
  // The debounce must NOT live in a timeupdate handler: those run several
  // times a second, and a network request there would be a defect.
  const TIMEUPDATE = (() => {
    const a = code.indexOf("audioEl.addEventListener('timeupdate'");
    assert.notEqual(a, -1, 'the timeupdate registration must exist');
    return code.slice(a, code.indexOf('window.__srSeekable', a));
  })();
  assert.ok(!/refreshNowPlayingArtwork/.test(TIMEUPDATE),
    'no artwork lookup may be added to a timeupdate handler');
  assert.ok(!/seekArtworkTimer/.test(TIMEUPDATE),
    'the seek artwork timer must not be driven from timeupdate');
  // And a channel switch must clear the pending lookup, or the OLD channel's
  // cover can land in the NEW channel's panel.
  const STOP = (() => {
    const a = code.indexOf('function stopNowPlayingPoll(');
    assert.notEqual(a, -1, 'stopNowPlayingPoll must exist');
    return code.slice(a, code.indexOf('async function fetchNowPlaying(', a));
  })();
  assert.ok(/clearTimeout\(seekArtworkTimer\)/.test(STOP),
    'a channel switch must clear the pending seek-artwork lookup');
  assert.ok(/seekArtworkSongKey = null/.test(STOP),
    'the song->cover association is per channel and must not survive a switch');
  // The episode call site must pass a real song and the shared target, and must
  // be guarded on having an artist -- an empty artist is a garbage query.
  assert.ok(/refreshNowPlayingArtwork\(next, 'episode'\)/.test(code),
    'the episode path must call the shared lookup with the resolved track');
  assert.ok(/if \(next && next\.title && next\.artist\) \{\s*refreshNowPlayingArtwork\(next, 'episode'\)/.test(code),
    "the episode lookup must be guarded on a real title AND artist");
  // The live call site is unchanged in substance: the live song, and it names
  // the 'poll' writer (WS26 replaced the `nowPlaying` target object with an
  // explicit writer name, so the two live intents can be told apart).
  assert.ok(/refreshNowPlayingArtwork\(nowPlaying\.song, 'poll'\)/.test(code),
    'the live path must still pass the live song and name the poll writer');
  // Sliced by FUNCTION, with the end marker taken from the code itself rather
  // than from neighbouring names: stopNowPlayingPoll is defined BEFORE
  // fetchNowPlaying, so a slice bounded by those two is EMPTY and every
  // assertion over it is vacuously red. pollNowPlaying is the real next
  // function after fetchNowPlaying.
  // The call now TAKES ARGUMENTS (song, target), so a no-arg pattern can never
  // match -- a pattern that can never match is a check that cannot fail.
  const fetchFn = code.slice(code.indexOf('async function fetchNowPlaying'),
    code.indexOf('function pollNowPlaying'));
  assert.ok(fetchFn.length > 0
    && /refreshNowPlayingArtwork\(nowPlaying\.song, 'poll'\)/.test(fetchFn),
  'the live iTunes lookup must hang off fetchNowPlaying');
  // ...and that function is live-gated, so the LIVE cover is only ever a
  // live channel's.
  const pollFn = code.slice(code.indexOf('function pollNowPlaying'));
  assert.ok(/kind !== 'live'/.test(pollFn),
    "pollNowPlaying must still refuse to run for anything but a live channel");
  // WS13 SUPERSEDES the old "episodes never touch the artwork lookup" rule:
  // they now DO, through the same shared function, on a track change. What
  // must still hold is that the episode call is inside updateEpisodeTrack's
  // change-detection block and guarded on a real title AND artist -- a lookup
  // on an empty artist is a garbage query, which is how a wrong cover arrives.
  // The slice end is stopNowPlayingPoll, which FOLLOWS updateEpisodeTrack.
  // It used to be `async function fetchNowPlaying`, which no longer comes
  // after it -- so this slice silently became empty and the assertion below
  // could never pass. A boundary that has drifted is a test that stopped
  // testing, and it failed LOUDLY here rather than passing vacuously.
  const epStart = code.indexOf('function updateEpisodeTrack');
  const epEnd = code.indexOf('function stopNowPlayingPoll', epStart);
  const epFn = code.slice(epStart, epEnd);
  assert.ok(epFn.length > 0, 'the updateEpisodeTrack slice must not be empty');
  assert.ok(/refreshNowPlayingArtwork\(next, 'episode'\)/.test(epFn),
    'the episode lookup must live in updateEpisodeTrack, on a track change');
  assert.ok(/if \(next && next\.title && next\.artist\)/.test(epFn),
    "the episode lookup must be guarded on a real title AND artist");
  // And it must be inside the CHANGE detection, never on every timeupdate:
  // a lookup per tick would be four requests a second.
  assert.ok(/episodeCurrentTrack = next;[\s\S]*?refreshNowPlayingArtwork\(next, 'episode'\)/.test(epFn),
    'the episode lookup must come after the track is committed, inside the change branch');
});

test('stopping live metadata invalidates pending artwork lookups', () => {
  const start = APP_JS.indexOf('  function stopNowPlayingPoll() {');
  const end = APP_JS.indexOf('\n  async function fetchNowPlaying', start);
  assert.ok(APP_JS.slice(start, end).includes('artworkSeq += 1'),
    'pending iTunes artwork response must be stale after channel/episode transition');
});

test('BUG 1: swipe-to-close on the sheet never covers a scrolling surface', () => {
  // BUG 1's original defect was WHOLE-SHEET scoping: every vertical touch in
  // the list ran the drag logic and fought iOS scrolling. The grab zone was the
  // fix.
  //
  // SUPERSEDED (2026-10-03), requirement genuinely changed. The owner measured
  // that the grab zone is 33 px — out of a 144 px top band — and asked to "make
  // it possible to swipe down the page from to top of now and further down on
  // the page". ITEM 1 widened the band to three FIXED regions.
  //
  // WHAT DID NOT CHANGE, and is the whole point of this restatement: the
  // gesture must still never cover a SCROLLING surface. That was BUG 1, and
  // widening a band is exactly the moment somebody reaches for the list as a
  // shortcut. So the guard moves from "one specific surface" to the property:
  //
  //   every bound surface is a fixed-height band, and
  //   none of them is the list, the news slider, or the sheet itself.
  //
  // Asserting the property rather than the constant means a FUTURE band can be
  // added without editing this test, but a list can never be bound by accident.
  const openSheet = extractFunction(CODE, 'openSheet', 'enableSwipeToClose');
  const scrollable = ['.sheet-list', '.sheet-news', '.sheet-body'];
  for (const sel of scrollable) {
    assert.ok(!openSheet.includes(`enableSwipeToClose(overlay, sheet.querySelector('${sel}')`),
      `BUG 1 regression: ${sel} scrolls — binding the swipe there lets every list ` +
      'touch drag the sheet and fight iOS scrolling');
  }
  assert.ok(!/enableSwipeToClose\(overlay, sheet[,)]/.test(openSheet),
    'BUG 1 regression: the gesture must not be bound to the whole sheet');
  // And the bands ITEM 1 added must all actually be bound, or the guard above
  // passes vacuously on a sheet with no swipe at all.
  const bound = [...openSheet.matchAll(/enableSwipeToClose\(overlay, sheet\.querySelector\('([^']+)'\)/g)]
    .map((m) => m[1]);
  assert.ok(bound.includes('.sheet-grab-zone'),
    'the grab zone must remain a swipe surface');
  assert.ok(bound.includes('.sheet-header'),
    'ITEM 1: the 32px header band above the actions row must be swipeable');
});

test('BUG 1: sheet close button is appended to the header', () => {
  // closeBtn was created but never appended (dead code) — the sheet had no
  // visible close button.
  assert.ok(APP_JS.includes("el('div', { class: 'sheet-header' }, title, closeBtn)"),
    'closeBtn must be appended to the sheet header');
});

test('BUG 1: resize listener is removed on closeSheet (no accumulation)', () => {
  assert.ok(APP_JS.includes("window.removeEventListener('resize', window.__srSheetSync)"),
    'closeSheet must remove the accumulated resize listener');
});

// ---- BUG 2: news links ----

// Mirrors slugifyTitle in app.js — keep in sync.
function slugifyTitle(title) {
  if (!title) return null;
  let t = title
    .replace(/ö/g, 'o').replace(/Ö/g, 'o')
    .replace(/ä/g, 'a').replace(/Ä/g, 'a')
    .replace(/å/g, 'a').replace(/Å/g, 'a')
    .replace(/é/g, 'e').replace(/è/g, 'e')
    .replace(/ü/g, 'u').replace(/û/g, 'u')
    .replace(/–|—/g, '-');
  t = t.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return t.length >= 8 ? t : null;
}

// Mirrors articleLinkFor in app.js — keep in sync.
function articleLinkFor(item) {
  return `https://www.sverigesradio.se/sok?query=${encodeURIComponent(item.title || '')}`;
}

test('BUG 2: slugify handles Swedish characters correctly', () => {
  assert.equal(slugifyTitle('Jordens gränser överskrids alltmer'),
    'jordens-granser-overskrids-alltmer');
  assert.equal(slugifyTitle('Klubbat: Så dyr blev årets första hummer'),
    'klubbat-sa-dyr-blev-arets-forsta-hummer');
});

test('BUG 2: short/empty titles give null slug (search fallback)', () => {
  assert.equal(slugifyTitle(''), null);
  assert.equal(slugifyTitle(null), null);
  assert.equal(slugifyTitle('Kort'), null); // < 8 chars
});

test('BUG 2: article link never uses the dead feed id URL', () => {
  const item = { title: 'Jordens gränser överskrids alltmer', url: 'https://www.sverigesradio.se/artikel/9304760' };
  const link = articleLinkFor(item);
  assert.ok(!/\/artikel\/\d+$/.test(link), 'must not link to /artikel/<id>');
  assert.ok(link.startsWith('https://www.sverigesradio.se/sok?query='),
    'must use the SR search page (always loads, article is top result)');
});

test('BUG 2: editorial-slug titles also go to SR search (no dead slug guesses)', () => {
  const item = { title: 'Vill bygga stängsel runt Israels ambassad' };
  const link = articleLinkFor(item);
  assert.ok(link.startsWith('https://www.sverigesradio.se/sok?query='),
    'all titles use the search page (no dead slug guesses)');
  assert.ok(link.includes(encodeURIComponent('Vill bygga stängsel runt Israels ambassad')));
});

test('BUG 2: reader source link uses articleLinkFor, not item.url', () => {
  assert.ok(APP_JS.includes('href: articleLinkFor(item)'),
    'reader link must go through articleLinkFor');
  assert.ok(!APP_JS.includes("href: item.url, target: '_blank'"),
    'reader must not link the raw feed URL');
});

test('BUG 2: links use the www host (non-www 403s, verified)', () => {
  const item = { title: 'Jordens gränser överskrids alltmer' };
  assert.ok(articleLinkFor(item).startsWith('https://www.sverigesradio.se/'),
    'must use www.sverigesradio.se (non-www is Akamai-403)');
});

// ===================================================================
// WS24 — artwork for a song found by scrubbing back.
//
// The defect: the title and artist for a historical song resolved correctly,
// but the cover did not. `nowPlaying.artwork` is written only by
// refreshNowPlayingArtwork(), whose callers were the live poll and the episode
// path. The seek path called neither, so a seek-resolved song inherited
// whatever the LAST POLLED song's cover was.
//
// Measured against the panel's own expression before the change:
//   live edge, song A on air -> title A, cover A   (correct)
//   scrub back into song B   -> title B, cover A   (MISMATCHED)
// and with no cover resolved for song A, the ♪ placeholder instead — which is
// exactly what the owner reported.
//
// One symptom, two faces: a MISSING cover, and a WRONG cover. The second is
// worse, and it is why the fix must never leave the old cover in place.
// ===================================================================

test('WS24: the seek path requests artwork for the song it resolved', () => {
  const RESOLVE = (() => {
    const a = CODE.indexOf('function resolveMetadataForPosition(');
    assert.notEqual(a, -1, 'resolveMetadataForPosition must exist');
    return CODE.slice(a, CODE.indexOf('async function resolveProgramTitle(', a));
  })();
  assert.ok(/refreshNowPlayingArtwork\(/.test(RESOLVE),
    'the seek path must request artwork, or a historical song never gets a cover');
  // It must name the WRITER it is, which is how the shared function decides
  // which field it may write. Getting this wrong would write a radio cover
  // into the on-air slot -- which is the WS24 regression, in the other
  // direction. WS26 replaced the `target === nowPlaying` object test with an
  // explicit writer name, because an object identity test cannot distinguish
  // two intents that legitimately both mean "live".
  const calls = RESOLVE.match(/refreshNowPlayingArtwork\([^)]*\)/g) || [];
  assert.ok(calls.length >= 1, 'the seek path must call the shared lookup');
  calls.forEach((c) => {
    assert.ok(/,\s*'playhead'\s*\)/.test(c),
      `every seek-path call must name the 'playhead' writer: ${c}`);
    assert.ok(!/,\s*'poll'\s*\)/.test(c),
      `the seek path must NEVER name the poll writer: ${c}`);
  });
  // And the song it looks up must be re-resolved at fire time, not captured
  // from an earlier frame: the playhead may have moved on while the debounce
  // was pending, and a stale capture would fetch the wrong song's cover.
  //
  // WS44 SUPERSEDED the `playheadWallMs()` spelling to `playheadWallMs44()` —
  // the requirement is "re-resolve the song at fire time, through the app's
  // current DVR timebase", and the experiment changed WHICH timebase that is.
  // Restated, not weakened: it still pins the exact call, still forbids a
  // captured variable, and now also pins that the value comes from the
  // experimental accessor rather than from a local.
  assert.ok(/pickByPosition\(nowPlaying\.timeline, playheadWallMs44\(\)\)/.test(RESOLVE),
    'the debounced lookup must re-resolve the song at fire time');
  assert.ok(!/const (captured|cached|frozen)\w*\s*=\s*pickByPosition/.test(RESOLVE),
    'the debounced lookup must not capture an earlier pickByPosition result');
  assert.ok(/if \(!now \|\| !now\.title \|\| !now\.artist\) return;/.test(RESOLVE),
    'the debounced lookup must bail if the playhead is no longer inside a song');
});

test('WS24: a stale cover is CLEARED when the song changes, never left behind', () => {
  // This is the half that prevents the WORSE symptom. Between the seek and the
  // cover arriving, the panel would otherwise pair song B's title with song A's
  // cover. The clear uses the shared function's own no-song branch, so it is
  // not a second mechanism.
  const RESOLVE = (() => {
    const a = CODE.indexOf('function resolveMetadataForPosition(');
    return CODE.slice(a, CODE.indexOf('async function resolveProgramTitle(', a));
  })();
  assert.ok(/refreshNowPlayingArtwork\(null, 'playhead'\)/.test(RESOLVE),
    'the previous song\'s cover must be cleared through the shared function');
  // Guarded on the song key, so scrubbing WITHIN one long song does not blank
  // a cover that is already correct. Unguarded, this would be a visible
  // regression of its own on every re-resolve.
  assert.ok(/seekArtworkSongKey\s*!==\s*key/.test(RESOLVE),
    'the clear must be guarded on the song having actually changed');
  assert.ok(/seekArtworkSongKey\s*=\s*key/.test(RESOLVE),
    'the current song key must be recorded when the clear happens');
  // Guarded on there being something to clear: calling the function when the
  // field is already null is a wasted repaint on every re-resolve.
  assert.ok(/if \(nowPlaying\.playheadArtwork\)/.test(RESOLVE),
    'the clear must only run when a cover is actually present');
});

test('WS24: the seek artwork lookup is BOUNDED', () => {
  // artworkCache already dedupes by song, so this is not a throttle on the
  // request itself — it collapses the many songs a scrub-drag crosses into one
  // lookup for wherever the playhead settles.
  const RESOLVE = (() => {
    const a = CODE.indexOf('function resolveMetadataForPosition(');
    return CODE.slice(a, CODE.indexOf('async function resolveProgramTitle(', a));
  })();
  assert.ok(/setTimeout\(/.test(RESOLVE), 'the lookup must be debounced');
  assert.ok(/clearTimeout\(seekArtworkTimer\)/.test(RESOLVE),
    'a newer song must cancel the pending lookup');
  assert.ok(/SEEK_ARTWORK_DEBOUNCE_MS/.test(RESOLVE),
    'the interval must be the named constant');
  // The constant must be a real, finite, positive number and the timer handle
  // must exist beside the other module-scope timer handles.
  const m = /const SEEK_ARTWORK_DEBOUNCE_MS = (\d+);/.exec(APP_JS);
  assert.ok(m, 'SEEK_ARTWORK_DEBOUNCE_MS must be a plain integer literal');
  assert.ok(Number(m[1]) >= 100, 'the debounce must be long enough to collapse a drag');
  assert.ok(Number(m[1]) <= 2000, 'and short enough that a deliberate seek still feels immediate');
  assert.ok(/let seekArtworkTimer = null;/.test(APP_JS),
    'the timer handle must be module scope, like nowPlayingTimer');
  // The constant must be USED, not merely declared. M12 added a second literal
  // holding the same number and left the call site untouched, and the suite
  // stayed GREEN — pinning the declaration proves nothing about the behaviour.
  // What matters is that the setTimeout in the seek path takes the constant,
  // so retuning the debounce is a one-line change and cannot be done by
  // editing a number at the call site.
  //
  // Counting is done by OCCURRENCE, not by matching balanced parentheses: a
  // regex like /setTimeout\([^)]*\)/ stops at the first `)` inside the arrow
  // body, so it saw 0 timers where there is 1. (My own first attempt failed
  // for that reason — a test that cannot count the thing it guards.)
  const timerCount = (RESOLVE.match(/setTimeout\(/g) || []).length;
  assert.ok(timerCount >= 1, 'the seek path must have a debounced timer');
  const constUses = (RESOLVE.match(/SEEK_ARTWORK_DEBOUNCE_MS/g) || []).length;
  assert.equal(constUses, timerCount,
    'EVERY setTimeout in the seek path must be bounded by SEEK_ARTWORK_DEBOUNCE_MS, '
    + 'not a literal — a magic number at the call site cannot be retuned safely');
  assert.ok(/setTimeout\([\s\S]*?,\s*SEEK_ARTWORK_DEBOUNCE_MS\s*\)/.test(RESOLVE),
    'the debounce interval must be passed as the trailing constant argument');

  // A channel switch must clear it AND the song->cover association. Without
  // the second, the first song resolved on the new channel would compare equal
  // to the old channel's last song and skip the clear, landing a foreign cover
  // in the new channel's panel.
  const STOP = (() => {
    const a = CODE.indexOf('function stopNowPlayingPoll(');
    return CODE.slice(a, CODE.indexOf('async function fetchNowPlaying(', a));
  })();
  assert.ok(/clearTimeout\(seekArtworkTimer\)/.test(STOP),
    'a channel switch must clear the pending lookup');
  assert.ok(/seekArtworkSongKey = null/.test(STOP),
    'the song->cover association is per channel and must not survive a switch');
});

test('WS24: the LIVE path behaviour is UNCHANGED', () => {
  // The owner is about to test the live path against a known-good build, so any
  // difference there reads as a regression from this deploy. These assert the
  // live path's own code, not merely that "something still works".
  const FETCH = (() => {
    const a = CODE.indexOf('async function fetchNowPlaying(');
    assert.notEqual(a, -1, 'fetchNowPlaying must exist');
    return CODE.slice(a, CODE.indexOf('function scheduleNowPlayingPoll(', a));
  })();
  // The live poll still calls the shared lookup with the on-air song, and
  // nothing in it was rewired.
  assert.ok(/refreshNowPlayingArtwork\(nowPlaying\.song, 'poll'\)/.test(FETCH),
    'the live poll must still request artwork for the ON-AIR song');
  // It must still be unconditional within the poll, i.e. not gated on a
  // position or a debounce of WS24's making.
  assert.ok(!/SEEK_ARTWORK_DEBOUNCE_MS|seekArtworkSongKey|seekArtworkTimer/.test(FETCH),
    'the live poll must not be gated on any WS24 seek state');
  // The poll interval is untouched — a debounce here would change how often
  // live metadata refreshes.
  assert.ok(APP_JS.includes('const NOW_PLAYING_INTERVAL_MS = 45000;'),
    'the live poll interval must be byte-identical');
  // The panel's live arm still reads the live field, and the episode arm still
  // must not. (The existing episode test covers the arms; this pins that WS24
  // did not move them.)
  const EXPAND = APP_JS.slice(APP_JS.indexOf('const renderSongView = () => {'));
  const decl = /const songArtwork = isEpisode[\s\S]*?;/.exec(EXPAND);
  assert.ok(decl, 'songArtwork must be a single readable declaration');
  const arms = /isEpisode\s*\?\s*\(([^)]*)\)\s*:\s*([\s\S]*?);/.exec(decl[0]);
  assert.ok(arms, 'songArtwork must be a readable isEpisode ternary');
  assert.ok(!/nowPlaying\.onAirArtwork|nowPlaying\.playheadArtwork/.test(arms[1]),
    "the episode arm must still NOT read a live channel's artwork field");
  assert.ok(/head \? head\.artwork : null/.test(arms[2]),
    'the live arm must still read nowPlaying.artwork');
  // The live/episode field split inside the shared function is unchanged: the
  // guard is what stops the seek path writing into the episode slot.
  const FN = (() => {
    const a = CODE.indexOf('async function refreshNowPlayingArtwork(');
    return CODE.slice(a, CODE.indexOf('function paintNowPlaying(', a));
  })();
  // WS26 REPLACED this guard, deliberately. `target === nowPlaying` could not
  // keep the two LIVE intents apart, because both of them meant "live" and both
  // passed the same object -- which is exactly the WS24 regression. The
  // replacement names the writer, so it distinguishes the poll from the
  // playhead as well as either from the episode.
  assert.ok(!/const isLive = target === nowPlaying;/.test(FN),
    'the object-identity guard must be GONE -- it could not separate two live intents');
  // The field must be resolved from the writer name on EVERY branch, not just
  // the episode one. Asserting only the episode arm would pass a function that
  // sent the poll and the playhead to the same field -- which is the WS24 bug.
  // The three arms are written in three different syntactic forms in the real
  // code (`if (kind === ...) {`, `else if (kind === ...) {`, and a bare
  // `else`), so this matches the ASSIGNMENT and reads the field name back from
  // whichever kind value governs it. A regex that assumed one form would have
  // silently matched two of three -- and the missing one is the episode writer.
  const writerArms = [...FN.matchAll(
    /(?:if|else if)\s*\(kind === '(poll|playhead|episode)'\)\s*\{\s*nowPlaying\.(\w+) =|(?:^|\n)\s*else\s*\{\s*nowPlaying\.episodeArtwork =/g
  )];
  const seen = new Map();
  for (const m of writerArms) {
    if (m[1]) seen.set(m[1], m[2]);
    else seen.set('episode', 'episodeArtwork');
  }
  assert.ok(writerArms.length >= 3, `every writer name must resolve to its own field (found ${writerArms.length})`);
  assert.equal(seen.get('poll'), 'onAirArtwork', "the poll writer must own onAirArtwork");
  assert.equal(seen.get('playhead'), 'playheadArtwork', "the playhead writer must own playheadArtwork");
  assert.equal(seen.get('episode'), 'episodeArtwork', "the episode writer must own episodeArtwork");
  assert.equal(new Set(seen.values()).size, 3,
    'three writers, three DISTINCT fields -- a shared field is the WS24 regression');
  assert.ok(/if \(kind !== 'poll' && kind !== 'playhead' && kind !== 'episode'\) return;/.test(FN),
    'an unrecognised writer must write nothing, rather than defaulting to the poll');
  // The three resolved-write arms, asserted individually. WS26 replaced the
  // single `if (isLive) { nowPlaying.artwork = big }` with one arm per writer;
  // the property that survives is that the poll's arm still writes the on-air
  // field and still repaints, i.e. the live path is not merely present but
  // unchanged in substance.
  assert.ok(/if \(kind === 'poll'\) \{ nowPlaying\.onAirArtwork = big; paintNowPlaying\(\); \}/.test(FN),
    "the poll's resolved-write arm must still write onAirArtwork and repaint");
  assert.ok(/else if \(kind === 'playhead'\) \{ nowPlaying\.playheadArtwork = big; paintNowPlaying\(\); \}/.test(FN),
    "the playhead's resolved-write arm must write playheadArtwork and repaint");
  assert.ok(/else nowPlaying\.episodeArtwork = big;/.test(FN),
    "the episode's resolved-write arm must write episodeArtwork");
  // And the CACHE must still be hit on the way in, for all three writers --
  // the dedupe is what stops a scrub from issuing one request per boundary.
  assert.ok((FN.match(/artworkCache\.get\(key\)/g) || []).length >= 3,
    'all three writers must read the shared cache');
  assert.ok(/else nowPlaying\.episodeArtwork = big;/.test(FN),
    'the episode write path must be byte-identical');
  // The cache is still keyed by artist|title, so a cover fetched on the seek
  // path is REUSED by the live path instead of being a second request.
  assert.ok(/const key = `\$\{song\.artist\}\|\$\{song\.title\}`\.toLowerCase\(\);/.test(FN),
    'the cache key must be unchanged, so seek and live share one cache');
});

test('WS24: nothing new was added to a timeupdate handler, and the recorder stays read-only', () => {
  // timeupdate runs several times a second; a network request there is a defect.
  const TIMEUPDATE = (() => {
    const a = CODE.indexOf("audioEl.addEventListener('timeupdate'");
    assert.notEqual(a, -1, 'the timeupdate registration must exist');
    return CODE.slice(a, CODE.indexOf('window.__srSeekable', a));
  })();
  assert.ok(!/refreshNowPlayingArtwork/.test(TIMEUPDATE),
    'no artwork lookup may be added to timeupdate');
  assert.ok(!/seekArtwork/.test(TIMEUPDATE),
    'no WS24 seek-artwork state may be driven from timeupdate');
  // Read-only with respect to state.current: the seek path may READ the track
  // and may write module-scope metadata, but must not assign the track object.
  const RESOLVE = (() => {
    const a = CODE.indexOf('function resolveMetadataForPosition(');
    return CODE.slice(a, CODE.indexOf('async function resolveProgramTitle(', a));
  })();
  assert.ok(!/state\.current\s*=/.test(RESOLVE),
    'the seek path must not assign state.current');
  assert.ok(!/state\.current\.\w+\s*=(?!=)/.test(RESOLVE),
    'the seek path must not write any property of state.current');
  // The WS23 read-only contract test must still be satisfied by the new state.
  assert.ok(!/nowPlaying\.artwork\s*=/.test(RESOLVE),
    'the seek path must not assign artwork directly; only the shared function may');
});

// ===================================================================
// WS26 -- R1/R2: the panel header must describe THE PLAYHEAD, not the air
// ===================================================================
//
// WS25 established that the compact line and the expand-panel header answered
// "what is the user looking at?" from two different sources, and disagreed
// after a seek. WS26 gives both halves ONE source: resolvePlayheadMeta().
//
// THE MUTATION THAT PROVED THIS TEST WAS MISSING: reverting the header to
// `const song = ... : nowPlaying.song` -- the exact pre-WS26 defect -- left the
// WHOLE SUITE GREEN. Every other assertion in this file covers the artwork
// field; none covered the header's SONG. So R1 was untested and this test is
// the reason that is now on the record rather than merely fixed.

test('WS26 R1: the panel header song comes from the ONE resolver, not the air', () => {
  // The slice is BOUNDED at the end of renderSongView. An unbounded slice to
  // end-of-file would also contain later, legitimate `nowPlaying.song` reads
  // (the poll itself, the diagnostics snapshot) and the negative assertion
  // below would then fail for the wrong reason -- or, if those moved, pass for
  // the wrong reason. A test that scans past its subject is not a test.
  const start = APP_JS.indexOf('const renderSongView = () => {');
  // Use this file's comment-stripped module constant (CODE), not a local
  // re-strip: one definition, so the two cannot drift.
  const EXPAND = CODE.slice(CODE.indexOf('const renderSongView = () => {'),
    CODE.indexOf('panel._srRepaint =', CODE.indexOf('const renderSongView = () => {')));
  assert.ok(EXPAND.length > 0, 'the renderSongView region must exist');

  // The header must read the resolver, once, and use it for the song.
  assert.ok(/const head = isEpisode \? null : resolvePlayheadMeta\(\);/.test(EXPAND),
    'the header must read the one resolver rather than deriving its own');
  assert.ok(/const song = isEpisode \? episodeCurrentTrack : \(head \? head\.song : null\);/.test(EXPAND),
    "the header's song must come from the resolver's `head.song`");

  // And it must NOT read the on-air field that WS25 found it reading. This is
  // the regression guard: a single extra `nowPlaying.song` in the header
  // brings back R6, no matter what else is correct.
  //
  // COMMENTS ARE STRIPPED FIRST, and that is not tidiness. The explanatory
  // comment above this code contains the literal string `nowPlaying.song`
  // ("before WS26 this line read nowPlaying.song"), so the raw-source version
  // of this assertion failed on the COMMENT while the code was correct -- the
  // exact comment-trap AGENTS.md §2 warns about, and it is how a test ends up
  // asserting prose. A negative assertion is the most exposed to this: it must
  // look at code, or it will police a sentence.
  assert.ok(!/nowPlaying\.song/.test(EXPAND),
    "the header must never read nowPlaying.song -- that is the ON-AIR poll's field");

  // The resolver's SONG RULE, asserted as a rule rather than as the old
  // edge-branch literal.
  //
  // ---- WS27 RESTATEMENT, with the reason recorded (§7b) ----
  // The earlier claim here was:
  //   /atLiveEdge \? \(nowPlaying\.song \|\| hit\) : \(hit \|\| null\)/
  // "the resolver must use the on-air song at the live edge and the playhead
  // song behind it". That was a SOURCE-TEXT assertion of the WS26 shape, and
  // the shape it pinned is the shape the OWNER'S DEVICE falsified: at the live
  // edge that expression prefers the poll's song while row 4 reads the
  // timeline, so the two halves named different songs at the same instant
  // (2026-09-29, P3, 02:50). It is SUPERSEDED -- the requirement genuinely
  // changed, from "the edge prefers the poll" to "ONE rule for both surfaces".
  //
  // It is NOT deleted and NOT weakened to a looser pattern. The new assertion
  // is STRONGER in the property that matters: there must be exactly ONE
  // timeline read feeding the song, and no `nowPlaying.song` preference at all
  // in the song position. The poll is allowed ONLY as the empty-timeline
  // fallback, which is asserted separately and by behaviour below.
  const RESOLVER = (() => {
    const a = CODE.indexOf('function resolvePlayheadMeta()');
    assert.notEqual(a, -1, 'resolvePlayheadMeta must exist');
    return CODE.slice(a, CODE.indexOf('function', a + 10));
  })();
  // ONE expression decides the song, at the edge and behind it alike.
  assert.ok(/const song = hit \|\| \(atLiveEdge \? \(nowPlaying\.song \|\| null\) : null\);/.test(RESOLVER),
    'the song must come from ONE rule: the timeline whenever it has an entry, ' +
    'with the on-air poll as the empty-timeline fallback at the live edge');
  // The old edge-branch preference must be GONE. This is the regression guard
  // for the exact defect: if a future edit restores "at the edge trust the poll
  // first", the two halves can diverge again and the suite must say so.
  //
  // SCOPED PRECISELY, and a first attempt at this was too broad. Asserting
  // "no `atLiveEdge ? (nowPlaying.song`" also forbids the CORRECT empty-
  // timeline fallback, which legitimately reads
  //   hit || (atLiveEdge ? (nowPlaying.song || null) : null)
  // and must stay, or the card blanks when no poll has landed. A guard that
  // forbids the fix as well as the defect is a bad guard. So the forbidden
  // shape is the POLL-FIRST one specifically: the poll consulted BEFORE `hit`.
  assert.ok(!/nowPlaying\.song \|\| hit/.test(RESOLVER),
    'the resolver must not prefer the on-air poll at the live edge -- that is ' +
    'the WS26 assumption the owner\'s device falsified, and the cause of R6');
  assert.ok(!/atLiveEdge \? nowPlaying\.song/.test(RESOLVER),
    'the live edge must not take the poll without consulting the timeline first');
  // And the fallback MUST still be reachable, or "the card must never blank"
  // is a claim with nothing behind it. Asserted positively, and then driven
  // for real in the WS27 tests below -- a positive-source assertion plus a
  // driven empty-timeline case, because a guard that cannot fail is not one.
  // R6 is the cheap and important one: the cover must be chosen from the SAME
  // decision that chose the song, so the two cannot describe different moments.
  // The cover is now chosen by asking whether the WINNING SONG is the on-air
  // song, not by asking which side of the edge we are on -- a position test can
  // disagree with a song test, which is how a stranger's cover got a real title.
  assert.ok(/const winnerIsOnAir = Boolean\(/.test(RESOLVER),
    "the cover must be chosen by which SONG won, not by which side of the edge");
  assert.ok(/const artwork = !atLiveEdge/.test(RESOLVER),
    'behind live the cover must be the playhead cover, unchanged (R3)');
  assert.ok(/winnerIsOnAir[\s\S]{0,200}onAirArtwork/.test(RESOLVER),
    'at the edge the on-air cover when the on-air song won');
  // And the ONE timeline read: the compact line and the resolver must use the
  // identical expression, so they agree by construction rather than by habit.
  const compact = /const liveSong = \(!isEpisode && cur && cur\.kind === 'live'\)\s*\?\s*pickByPosition\(nowPlaying\.timeline, playheadWallMs\(\)\)/.test(APP_JS);
  const resolver = /pickByPosition\(nowPlaying\.timeline, playheadWallMs\(\)\)/.test(RESOLVER);
  assert.ok(compact && resolver,
    'R4 and the resolver must read the timeline with the IDENTICAL expression');
});

// ===================================================================
// WS26 R6 -- DRIVEN, not asserted. The test whose absence let a regression ship.
// ===================================================================
//
// Every other WS26 test checks the SHAPE of the code. This one runs the real
// poll -> seek -> poll sequence and asks the only question that matters: do
// the panel's fields describe the same moment? R6 was not a property of the
// code before WS26 -- it was a wish -- and a wish cannot be asserted.
//
// WHAT THIS PROVES: with the real resolver, driven through the real sequence,
// the panel's song and cover describe the same playhead, and the poll can no
// longer overwrite the cover.
// WHAT THIS DOES NOT PROVE: anything about a real iPhone, a real HLS stream, or
// SR's network. No network is touched, no audio is decoded.
//
// The resolver and the two position helpers are EXTRACTED from app.js by brace
// matching and executed. Nothing here re-implements the logic under test --
// retyping it is how two earlier workstreams reached confident wrong answers.

test('WS26 R6: driven poll -> seek -> poll, the panel describes ONE moment', () => {
  const src = CODE;
  // Brace-matched extraction. `playheadWallMs` calls the real Date.now(), so a
  // Date shadow must be declared in the SAME scope: `new Date()` is a
  // CONSTRUCTOR call and resolves to that scope's binding, not to a parameter.
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist in app.js`);
    let d = 0, end = start;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}') { d--; if (d === 0) { end = i; break; } }
    }
    return src.slice(start, end + 1);
  };
  const NOW = 1_700_000_000_000;
  const factory = new Function('deps', `
    const { nowPlaying, state, audioEl, seekArtworkSongKey } = deps;
    const _RealDate = Date;
    function Date(...a) { return a.length ? new _RealDate(...a) : new _RealDate(${NOW}); }
    Date.now = () => ${NOW};
    Date.prototype = _RealDate.prototype;
    ${grab('pickByPosition')}
    ${grab('playheadWallMs')}
    ${grab('resolvePlayheadMeta')}
    return { resolvePlayheadMeta };
  `);

  const WINDOW_S = 3 * 3600;
  const seekableEnd = NOW / 1000;
  const ON_AIR = { title: 'On Air Song', artist: 'Air Artist', startMs: NOW - 60_000, stopMs: NOW + 240_000 };
  const HISTORIC = { title: 'Historic Song', artist: 'Old Artist', startMs: NOW - 330_000, stopMs: NOW - 150_000 };
  // The SEEKED playhead sits 60 s INTO the historic song, 150 s behind the edge.
  const seekedTime = seekableEnd - (NOW - (HISTORIC.startMs + 60_000)) / 1000;
  // The genuinely-at-the-edge playhead sits ON the buffer edge, so
  // playheadWallMs() returns NOW and the on-air song is the one covering it.
  const edgeTime = seekableEnd;

  const world = (atLiveEdge, onAirCover, playheadCover, currentTime) => ({
    nowPlaying: {
      song: { ...ON_AIR }, onAirArtwork: onAirCover, playheadArtwork: playheadCover,
      episodeArtwork: null, channelId: 164, timeline: [{ ...HISTORIC }, { ...ON_AIR }],
    },
    state: { current: { kind: 'live', id: 164, atLiveEdge, seekableEnd, _srProgramTitle: 'P' } },
    audioEl: { currentTime },
    // WS56: the playhead cover is only shown when it was fetched FOR the song
    // the playhead now resolves. In every world below the playhead cover
    // belongs to HISTORIC (it is COVER-HIST), so the key names HISTORIC. That
    // is the state a real seek leaves behind -- resolveMetadataForPosition sets
    // this key at the moment it requests the cover.
    seekArtworkSongKey: `${HISTORIC.artist}|${HISTORIC.title}`.toLowerCase(),
  });

  // ---- WS27 CORRECTION, with the reason recorded (§7b) ----
  // The world above used to be called with `atLiveEdge: true` while the
  // playhead sat 150 s BEHIND the edge. Those two facts contradict each other:
  // the app derives atLiveEdge from distanceFromLiveEdge (<= 10 s), so a world
  // 150 s behind the edge is a BEHIND-LIVE world that claims to be at the edge.
  // The old case 1 ("at the edge the panel shows the on-air song") only passed
  // because the resolver preferred the poll unconditionally at the edge -- it
  // asserted the right ANSWER from a world that does not exist, and it could
  // not tell a correct resolver from one that always trusts the poll.
  //
  // The edge cases now use a playhead that is actually on the edge. The
  // behind-live cases keep the original seeked playhead, unchanged, so R1/R2/R3
  // and the WS24 cover-race guard still assert exactly what they asserted.
  //
  // WHAT IT DOES NOT WEAKEN: the assertions below are the same properties, now
  // on a world where they mean what they say.

  // --- 1. at the live edge: the panel shows the ON-AIR song and cover
  const atEdge = factory(world(true, 'COVER-ONAIR', 'COVER-HIST', edgeTime)).resolvePlayheadMeta();
  assert.equal(atEdge.atLiveEdge, true, 'harness: this world is at the live edge');
  assert.equal(atEdge.song.title, ON_AIR.title, 'at the edge the panel shows the on-air song');
  assert.equal(atEdge.artwork, 'COVER-ONAIR', 'at the edge the panel shows the on-air cover');

  // --- 2. after a seek: title AND artist must follow the playhead
  const seeked = factory(world(false, 'COVER-ONAIR', 'COVER-HIST', seekedTime)).resolvePlayheadMeta();
  assert.equal(seeked.atLiveEdge, false, 'harness: this world is behind live');
  assert.equal(seeked.song.title, HISTORIC.title,
    'R1: behind live the panel song must be the one AT THE PLAYHEAD, not the on-air song');
  assert.equal(seeked.song.artist, HISTORIC.artist,
    'R2: the artist must follow the playhead too');

  // --- 3. the 45 s poll fires while behind live. This is the WS24 regression.
  const afterPoll = factory(world(false, 'COVER-ONAIR-CHANGED', 'COVER-HIST', seekedTime)).resolvePlayheadMeta();
  assert.equal(afterPoll.artwork, 'COVER-HIST',
    'R3: the poll must NOT overwrite the cover the playhead resolved');
  assert.equal(afterPoll.song.title, HISTORIC.title,
    'R1: the poll must NOT overwrite the playhead song');
  // R6 proper: the two halves of the panel describe the SAME moment. This is
  // the assertion whose absence let the panel ship with song B under song A's
  // cover, and it is checked as an equality between the two fields rather than
  // as two separate facts.
  assert.equal(afterPoll.artwork === 'COVER-HIST' && afterPoll.song.title === HISTORIC.title, true,
    'R6: the song and the cover must describe the same playhead');
  assert.notEqual(afterPoll.song.title, ON_AIR.title,
    'R6 guard: the panel must genuinely be behind live, or this test proves nothing');

  // --- 4. returning to the edge brings the on-air cover back
  const back = factory(world(true, 'COVER-ONAIR-CHANGED', 'COVER-HIST', edgeTime)).resolvePlayheadMeta();
  assert.equal(back.artwork, 'COVER-ONAIR-CHANGED',
    'at the live edge the panel must show the on-air cover again');
});

// ===================================================================
// WS27 R6 -- the live-edge divergence. DRIVEN, and RED on the pre-change code.
// ===================================================================
//
// WHY THIS BLOCK EXISTS AND WHY IT IS SEPARATE FROM THE WS26 ONE ABOVE.
//
// The WS26 driven test is a poll -> seek -> poll sequence. Every one of its
// cases sits BEHIND the edge, because before WS27 the edge was a different
// code path. That is the trap AGENTS.md §12 records: a suite that only tests
// the case you already fixed cannot find the case you did not. The owner's
// defect was AT the edge, and the green suite said nothing about it.
//
// The resolver and both position helpers are EXTRACTED from app.js by brace
// matching and EXECUTED. Nothing here re-implements the logic under test --
// retyping it is how two earlier workstreams reached confident wrong answers.
//
// WHAT THIS BLOCK PROVES: on a fixture world that the owner's device report
// describes, the two halves of the panel name one song. This is CODE
// EVIDENCE from a fixture harness on a desktop. It is NOT device evidence, it
// touches no network, and it decodes no audio.

const WS27_NOW = 1_700_000_000_000;

// One extraction + execution harness for the whole block, so the canary is a
// property of the harness rather than of any one test.
//
// CANARY: `pickByPosition` and `resolvePlayheadMeta` are real, so a wrapper in
// the injected scope counts every call. Printed by the first test and
// ASSERTED non-zero by it. A harness whose canary reads 0 is a harness that
// proved nothing and must be reported as a hard failure, not as a pass.
function ws27Harness(sourceText) {
  const src = sourceText;
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`${name} must exist in the source under test`);
    let d = 0, end = -1;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}') { d--; if (d === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error(`brace matching failed for ${name}`);
    return src.slice(start, end + 1);
  };
  return new Function('deps', `
    const { nowPlaying, state, audioEl, canary, seekArtworkSongKey } = deps;
    const _RealDate = Date;
    function Date(...a) { return a.length ? new _RealDate(...a) : new _RealDate(${WS27_NOW}); }
    Date.now = () => ${WS27_NOW};
    Date.prototype = _RealDate.prototype;
    // The REAL functions, verbatim. Wrapped only to count calls.
    ${grab('pickByPosition')}
    ${grab('playheadWallMs')}
    const _pickByPosition = pickByPosition;
    const _resolvePlayheadMeta = resolvePlayheadMeta;
    function countedPick(entries, atMs) {
      canary.pickCalls++;
      const r = _pickByPosition(entries, atMs);
      canary.lastPick = r;
      return r;
    }
    pickByPosition = countedPick;
    ${grab('resolvePlayheadMeta')}
    // resolvePlayheadMeta closes over pickByPosition, which is now the counted
    // wrapper, so the count is of the REAL selection logic being executed.
    return {
      resolvePlayheadMeta() { canary.resolveCalls++; return _resolvePlayheadMeta(); },
      pickByPosition: _pickByPosition,
      // Exposed so a test can ask "what instant does the REAL code think the
      // playhead is on?" instead of hardcoding one. A hardcoded instant in this
      // file once landed exactly on an exclusive stopMs boundary and returned
      // null, which failed the test for a reason that had nothing to do with
      // the resolver under test.
      playheadWallMs: () => playheadWallMs(),
    };
  `);
}

// The owner's world, verbatim from the 2026-09-29 device report:
//   card   -> "More!" / Robin Bengtsson      (the poll's on-air song)
//   row 4  -> "Depeche Mode / Enjoy The Silence"
// at the LIVE EDGE, P3, 02:50.
//
// The mechanism (measured, not assumed): pickByPosition returns the FIRST
// containing entry in a startMs-sorted array, so an earlier-starting entry
// that spans now SHADOWS the polled song. A polled `previoussong` that has
// overrun `now` is exactly such an entry, and no timing assumption about the
// real stream is needed to build it.
const WS27_ON_AIR = {
  title: 'More!', artist: 'Robin Bengtsson',
  startMs: WS27_NOW - 60_000, stopMs: WS27_NOW + 240_000,
};
const WS27_SHADOW = {
  title: 'Enjoy The Silence', artist: 'Depeche Mode',
  startMs: WS27_NOW - 400_000, stopMs: WS27_NOW + 30_000,
};

function ws27World({ atLiveEdge, timeline, currentTime, onAir = WS27_ON_AIR,
                      onAirArtwork = 'COVER-ONAIR', playheadArtwork = 'COVER-PLAYHEAD',
                      coverForSong = null }) {
  // WS56: `seekArtworkSongKey` names the song the playhead cover was FETCHED
  // FOR. It is derived from the entry covering the ACTUAL PLAYHEAD, not from
  // `WS27_NOW` -- several of these worlds sit behind the edge, and keying off
  // `now` there names the on-air song and silently withholds a correct cover.
  // Deriving it from the playhead makes the key describe the world rather than
  // being a constant that would make every assertion pass for the wrong reason.
  //
  // The playhead is `now` at the edge and `now + (currentTime - seekableEnd)`
  // behind it, which is the same arithmetic playheadWallMs() performs.
  const playheadMs = WS27_NOW
    + (currentTime - WS27_NOW / 1000) * 1000;
  const resolvedSong = coverForSong
    || timeline.find((e) => e.startMs <= playheadMs && playheadMs < e.stopMs)
    || null;
  return {
    nowPlaying: {
      song: onAir ? { ...onAir } : null,
      onAirArtwork,
      playheadArtwork,
      episodeArtwork: null,
      channelId: 164,
      timeline,
    },
    // At the edge the playhead sits ON the buffer edge, so playheadWallMs()
    // returns NOW and the shadowing entry genuinely contains it. This world is
    // internally consistent -- the WS26 test's `atLiveEdge: true` with a
    // playhead 150 s back was not, and that contradiction is corrected there.
    state: { current: { kind: 'live', id: 164, atLiveEdge, seekableEnd: WS27_NOW / 1000, _srProgramTitle: 'P' } },
    audioEl: { currentTime },
    // WS56: derived from the entry actually covering the playhead, so the key
    // describes the world rather than being a constant that would make every
    // assertion pass for the wrong reason.
    seekArtworkSongKey: resolvedSong
      ? `${resolvedSong.artist}|${resolvedSong.title}`.toLowerCase()
      : null,
    canary: { pickCalls: 0, resolveCalls: 0, lastPick: null },
  };
}

// --- 1. THE DEFECT. Red on the pre-change resolver, green on the new one. ---

test('WS27 R6 live edge: card and row 4 must name ONE song when a timeline entry shadows the poll', () => {
  // The SAME extraction + execution path for both source versions, so the only
  // variable is the resolver under test.
  const timeline = [WS27_SHADOW, WS27_ON_AIR];   // startMs-sorted, as app.js guarantees
  const run = (sourceText) => {
    const world = ws27World({ atLiveEdge: true, timeline, currentTime: WS27_NOW / 1000 });
    const api = ws27Harness(sourceText)(world);
    return { card: api.resolvePlayheadMeta(), canary: world.canary, api };
  };

  const w = run(CODE);
  const { card, canary } = w;

  // The canary is asserted, not just logged. A zero here means the harness
  // never executed the code under test and every number below is fiction.
  assert.ok(canary.pickCalls > 0 && canary.resolveCalls > 0,
    `harness canary must fire: pickCalls=${canary.pickCalls} resolveCalls=${canary.resolveCalls}`);
  console.log(`WS27 canary: pickCalls=${canary.pickCalls} resolveCalls=${canary.resolveCalls}`);

  // Row 4 is the timeline, unconditionally -- that is the pre-existing
  // expression in paintNowPlaying(), left byte-identical on purpose.
  const row4 = w.api.pickByPosition(timeline, WS27_NOW);
  assert.equal(row4.title, 'Enjoy The Silence',
    'harness: the shadowing entry must be the one row 4 shows, or this test proves nothing');
  assert.equal(row4.title, WS27_SHADOW.title);

  // THE ASSERTION. Card song and row 4 song, as an equality between the two
  // surfaces -- not two separate facts, which is how they drifted apart.
  assert.equal(card.atLiveEdge, true, 'harness: this world is at the live edge');
  assert.equal(card.song.title, row4.title,
    'R6 AT THE LIVE EDGE: the card must name the same song row 4 names, even '
    + 'when a timeline entry shadows the poll. This is the owner\'s defect '
    + '(P3, 02:50: "More!" vs "Enjoy The Silence") and it is RED on the '
    + 'pre-change resolver.');
  assert.equal(card.song.artist, row4.artist, 'R6: the artist must agree too');

  // And the cover must belong to THAT song, not to the poll's. This is the
  // second half of the same failure: a stranger's face under a real title.
  assert.notEqual(card.song.title, WS27_ON_AIR.title,
    'R6 guard: the winning song must genuinely differ from the on-air song, or '
    + 'this test cannot tell the fix from the defect');
  assert.notEqual(card.artwork, 'COVER-ONAIR',
    'R6: the on-air cover belongs to a DIFFERENT song and must not be shown '
    + 'under this title');
  assert.equal(card.artwork, 'COVER-PLAYHEAD',
    'R6: the cover must describe the song the card names');
});

test('WS27 cover: at the live edge the cover is chosen by WHICH SONG WON, not by which side of the edge', () => {
  // Two worlds at the SAME edge with the SAME covers, differing only in whether
  // the on-air song won. If the cover were picked by position class, both would
  // return the same thing and this test could not fail. It can: the answers
  // differ, so the position-class rule is falsified.
  const atEdgeWithOnAirWinner = (() => {
    const w = ws27World({ atLiveEdge: true, timeline: [{ ...WS27_ON_AIR }],
                          currentTime: WS27_NOW / 1000 });
    return ws27Harness(CODE)(w).resolvePlayheadMeta();
  })();
  const atEdgeWithShadowWinner = (() => {
    const w = ws27World({ atLiveEdge: true, timeline: [WS27_SHADOW, { ...WS27_ON_AIR }],
                          currentTime: WS27_NOW / 1000 });
    return ws27Harness(CODE)(w).resolvePlayheadMeta();
  })();

  assert.equal(atEdgeWithOnAirWinner.song.title, WS27_ON_AIR.title, 'harness');
  assert.equal(atEdgeWithOnAirWinner.artwork, 'COVER-ONAIR',
    'at the edge, when the on-air song wins, its own cover must be shown');

  assert.equal(atEdgeWithShadowWinner.song.title, WS27_SHADOW.title, 'harness');
  assert.equal(atEdgeWithShadowWinner.artwork, 'COVER-PLAYHEAD',
    'at the edge, when a DIFFERENT song wins, that song\'s cover must be '
    + 'shown -- never the on-air song\'s');

  // Stated as the general property, because that is what must hold.
  assert.notEqual(atEdgeWithOnAirWinner.artwork, atEdgeWithShadowWinner.artwork,
    'harness: the two edge cases must produce different covers, or the '
    + 'position-class rule has not been falsified and this test proves nothing');
});

// --- 2. R4 BEHIND LIVE IS UNCHANGED. This must hold on BOTH versions. ---

test('WS27 R4 guard: behind live the row-4 song is UNCHANGED by the WS27 fix', () => {
  // The known-good case, owner-confirmed on the device for historical songs.
  // R4 is the thing the brief says must not regress, so it is asserted against
  // the PRE-change resolver too: the expectation is source-version independent
  // and a fix that moved it would fail here rather than in the field.
  const HISTORIC = { title: 'Historic Song', artist: 'Old Artist',
                     startMs: WS27_NOW - 330_000, stopMs: WS27_NOW - 150_000 };
  const timeline = [HISTORIC, { ...WS27_ON_AIR }];
  // 60 s into the historic song == 150 s behind the edge.
  const seekedTime = (WS27_NOW / 1000) - (WS27_NOW - (HISTORIC.startMs + 60_000)) / 1000;

  const w = ws27World({ atLiveEdge: false, timeline, currentTime: seekedTime,
                        onAirArtwork: 'COVER-ONAIR-CHANGED', playheadArtwork: 'COVER-HIST' });
  const api = ws27Harness(CODE)(w);
  const behind = api.resolvePlayheadMeta();

  assert.ok(w.canary.pickCalls > 0, 'harness canary must fire');
  // Row 4 asks the timeline at the playhead. The instant is taken from the
  // REAL playheadWallMs(), not from a literal, so the two cannot drift.
  const playhead = api.playheadWallMs();
  assert.equal(playhead, HISTORIC.startMs + 60_000,
    'harness: the playhead must sit 60 s into the historic song, 150 s behind '
    + 'the edge, or this test is not the R4 case it claims to be');
  const row4 = api.pickByPosition(timeline, playhead);
  assert.notEqual(row4, null, 'harness: the timeline must have an entry at the playhead');
  assert.equal(behind.atLiveEdge, false, 'harness: this world is behind live');

  // Same input, same output as before the change.
  assert.equal(behind.song.title, HISTORIC.title,
    'R4/R1: behind live the panel song must be the one AT THE PLAYHEAD, not the '
    + 'on-air song -- unchanged by WS27');
  assert.equal(behind.song.artist, HISTORIC.artist, 'R2: artist, likewise');
  assert.equal(behind.song.title, row4.title, 'R4: card and row 4 agree behind live');
  assert.equal(behind.artwork, 'COVER-HIST',
    'R3: behind live the cover is the playhead cover, never the poll\'s '
    + '(the WS24 race) -- unchanged by WS27');
});

// --- 3. THE EMPTY-TIMELINE FALLBACK. The case the fix could most easily break. ---

test('WS27 empty timeline at the live edge: falls back to the on-air song and must NOT blank', () => {
  const w = ws27World({ atLiveEdge: true, timeline: [], currentTime: WS27_NOW / 1000 });
  const api = ws27Harness(CODE)(w);
  const card = api.resolvePlayheadMeta();

  assert.ok(w.canary.pickCalls > 0,
    'harness canary must fire even when the timeline is empty -- an empty array '
    + 'still has to REACH pickByPosition for this to be evidence');
  assert.equal(w.canary.lastPick, null,
    'harness: an empty timeline must genuinely select nothing');

  assert.notEqual(card.song, null,
    'the card must NOT blank when the timeline is empty at the live edge: the '
    + 'poll is the only information available about this moment');
  assert.equal(card.song.title, WS27_ON_AIR.title,
    'the empty-timeline fallback must be the ON-AIR song, as the live path '
    + 'showed before WS27');
  assert.equal(card.artwork, 'COVER-ONAIR',
    'the cover must be the on-air song\'s own cover, not the playhead\'s');
});

test('WS27 empty timeline behind live: still null, and the on-air poll must NOT leak in', () => {
  // The other half of the fallback, and the reason the fallback is scoped to
  // the edge. Behind live the on-air poll is known to be the WRONG song (that
  // is R1), so a timeline with no entry there is an honest blank.
  const w = ws27World({ atLiveEdge: false, timeline: [], currentTime: WS27_NOW / 1000 - 200 });
  const card = ws27Harness(CODE)(w).resolvePlayheadMeta();
  assert.equal(card.song, null,
    'behind live an empty timeline must NOT fall back to the on-air song -- '
    + 'that would reintroduce the exact defect WS27 fixes, one field away');
});

test('WS27 talk radio at the live edge: empty timeline and no song, so artwork is null and must not be asserted otherwise', () => {
  // Recorded so the next reader does not "fix" this into a cover assertion.
  // The tech lead hit exactly this on 2026-09-29: it asserted a cover must
  // exist here and the assertion was WRONG, because `onAirArtwork` is only ever
  // fetched when a song exists, so `null` is the correct answer. This test
  // asserts the correct answer instead.
  const w = ws27World({ atLiveEdge: true, timeline: [], currentTime: WS27_NOW / 1000,
                        onAir: null, onAirArtwork: null, playheadArtwork: 'COVER-PLAYHEAD' });
  const card = ws27Harness(CODE)(w).resolvePlayheadMeta();
  assert.equal(card.song, null, 'no song anywhere -> no song, and no crash');
  // NOT asserted: "a cover must exist". See above. The value is whatever the
  // correct rule yields; the property worth guarding is that it does not throw
  // and does not invent a song.
});

// ===================================================================
// WS56 -- the stale lock-screen cover. The owner's report, verbatim:
//
//   "there was a Taylor Swift album cover on the lock screen ... but when the
//    radio talk started and the song from Taylor was over the cover showed
//    that old stale Tove Styrke cover ... instead of not showing a cover at
//    all."
//
// TWO defects, and only fixing the first would have shipped the second.
//   (a) The WRITER never clears `playheadArtwork` when the resolved song is
//       GONE -- only when it CHANGES. Reaching live again is not a change in
//       that path, so the seek's cover survives.
//   (b) The READER falls back to `playheadArtwork` unconditionally. Even with
//       (a) fixed, the reader is reached every tick from the timeupdate path,
//       so a cover that has become stale is corrected on the next tick --
//       whereas (a) alone depends on a seek happening to trigger the clear.
//       This is the WS21/WS26 shape: a fix that cannot run on the path the
//       owner actually uses.
//
// RED on the pre-fix resolver: `playheadCover` did not exist, so every stale
// case returned a cover.

test('WS56: a cover for a song that is over is never shown', () => {
  // The owner's world: the playhead sits 150 s BEHIND the edge, which is where
  // a seek leaves you, and then playback walks forward to the edge and into
  // talk. `playheadArtwork` still holds 'COVER-SEEKED' the whole time.
  const SEEKED = { title: 'Tove Styrke Song', artist: 'Tove Styrke',
                   startMs: WS27_NOW - 330_000, stopMs: WS27_NOW - 150_000 };
  const ON_AIR = { title: 'Taylor Swift Song', artist: 'Taylor Swift',
                   startMs: WS27_NOW - 150_000, stopMs: WS27_NOW - 120_000 };

  // Step 1: BEHIND LIVE, on the seeked song. Its own cover must show.
  const seekedTime = (WS27_NOW / 1000) - (WS27_NOW - (SEEKED.startMs + 60_000)) / 1000;
  const w1 = ws27World({
    atLiveEdge: false,
    timeline: [SEEKED, ON_AIR],
    currentTime: seekedTime,
    onAir: ON_AIR,
    onAirArtwork: 'COVER-TAYLOR',
    playheadArtwork: 'COVER-SEEKED',
  });
  const behind = ws27Harness(CODE)(w1).resolvePlayheadMeta();
  assert.equal(behind.song.title, SEEKED.title,
    'harness: the playhead must resolve to the seeked song');
  assert.equal(behind.artwork, 'COVER-SEEKED',
    'R3 unchanged: behind live on a seeked song, its OWN cover must show. '
    + 'This is the case that must not regress.');

  // Step 2: TALK. The songs are over -- the timeline has no entry covering the
  // playhead, and there is no on-air song either. This is the owner's moment.
  const w2 = ws27World({
    atLiveEdge: true,
    timeline: [SEEKED, ON_AIR],
    currentTime: WS27_NOW / 1000,
    onAir: null,
    onAirArtwork: null,
    playheadArtwork: 'COVER-SEEKED',
    coverForSong: null,
  });
  const talk = ws27Harness(CODE)(w2).resolvePlayheadMeta();
  assert.equal(talk.song, null, 'harness: talk radio has no song at the playhead');
  assert.equal(talk.artwork, null,
    'WS56: during talk the cover must be NOTHING -- the owner asked for "not '
    + 'showing a cover at all". A cover for a song that is over is the defect.');

  // Step 3: the on-air song is a DIFFERENT one from the seeked song. Its cover
  // must be used, and the seeked cover must not appear as a fallback.
  const w3 = ws27World({
    atLiveEdge: true,
    timeline: [SEEKED, ON_AIR],
    currentTime: WS27_NOW / 1000,
    onAir: ON_AIR,
    onAirArtwork: 'COVER-TAYLOR',
    playheadArtwork: 'COVER-SEEKED',
  });
  const live = ws27Harness(CODE)(w3).resolvePlayheadMeta();
  assert.equal(live.artwork, 'COVER-TAYLOR',
    'WS56: at the edge the on-air song wins, so ITS cover must show');
  assert.notEqual(live.artwork, 'COVER-SEEKED',
    'WS56: the seeked song\'s cover must never be used as a fallback');
});

test('WS56: the fallback is gone even when a cover is present but for another song', () => {
  // The narrow case a reader-side `|| playheadArtwork` would still get wrong:
  // a cover EXISTS, so a truthiness check passes, but it belongs to a different
  // song than the one the panel names. Ownership must be by KEY, not by
  // presence.
  const w = ws27World({
    atLiveEdge: true,
    timeline: [WS27_SHADOW, { ...WS27_ON_AIR }],
    currentTime: WS27_NOW / 1000,
    onAirArtwork: null,
    playheadArtwork: 'COVER-PLAYHEAD',
    coverForSong: WS27_SHADOW,
  });
  const card = ws27Harness(CODE)(w).resolvePlayheadMeta();
  assert.equal(card.song.title, WS27_SHADOW.title,
    'harness: the shadowing entry wins, so the panel names that song');
  assert.equal(card.artwork, 'COVER-PLAYHEAD',
    'the cover that was fetched FOR the winning song must still be shown -- '
    + 'the key check must not withhold correct covers');
});
