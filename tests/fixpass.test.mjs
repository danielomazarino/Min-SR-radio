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
  const calls = code.split('refreshNowPlayingArtwork(').length - 1;
  assert.equal(calls, 5,
    'four call sites (live, episode, seek-clear, seek-fetch) plus the definition');
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

test('BUG 1: swipe-to-close on the sheet is scoped to the grab zone', () => {
  // The sheet's enableSwipeToClose must target .sheet-grab-zone, not the
  // whole sheet (whole-sheet scoping let vertical list touches drag the
  // sheet and fight iOS scrolling).
  assert.ok(APP_JS.includes("sheet.querySelector('.sheet-grab-zone')"),
    'swipe surface must be the grab zone');
  const sheetSwipe = APP_JS.indexOf('enableSwipeToClose(overlay, swipeSurface');
  assert.ok(sheetSwipe !== -1, 'sheet swipe must use swipeSurface');
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
  assert.ok(/pickByPosition\(nowPlaying\.timeline, playheadWallMs\(\)\)/.test(RESOLVE),
    'the debounced lookup must re-resolve the song at fire time');
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

  // The resolver itself must prefer the PLAYHEAD song when behind live, and
  // the on-air song at the edge. Both branches are asserted, because a
  // resolver that always used the timeline would be wrong at the live edge
  // and a resolver that always used the poll would be wrong everywhere else.
  const RESOLVER = (() => {
    const a = CODE.indexOf('function resolvePlayheadMeta()');
    assert.notEqual(a, -1, 'resolvePlayheadMeta must exist');
    return CODE.slice(a, CODE.indexOf('function', a + 10));
  })();
  assert.ok(/atLiveEdge \? \(nowPlaying\.song \|\| hit\) : \(hit \|\| null\)/.test(RESOLVER),
    'the resolver must use the on-air song at the live edge and the playhead song behind it');
  // R6 is the cheap and important one: the cover must be chosen from the SAME
  // decision that chose the song, so the two cannot describe different moments.
  assert.ok(/artwork: atLiveEdge/.test(RESOLVER),
    "the cover must be picked by the same atLiveEdge decision as the song");
  assert.ok(/\? \(nowPlaying\.onAirArtwork \|\| nowPlaying\.playheadArtwork \|\| null\)\s*:\s*\(nowPlaying\.playheadArtwork \|\| null\)/.test(RESOLVER),
    'at the edge the on-air cover; behind live, the playhead cover');
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
    const { nowPlaying, state, audioEl } = deps;
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
  // The playhead sits 60 s INTO the historic song, i.e. 150 s behind the edge.
  const currentTime = seekableEnd - (NOW - (HISTORIC.startMs + 60_000)) / 1000;

  const world = (atLiveEdge, onAirCover, playheadCover) => ({
    nowPlaying: {
      song: { ...ON_AIR }, onAirArtwork: onAirCover, playheadArtwork: playheadCover,
      episodeArtwork: null, channelId: 164, timeline: [{ ...HISTORIC }, { ...ON_AIR }],
    },
    state: { current: { kind: 'live', id: 164, atLiveEdge, seekableEnd, _srProgramTitle: 'P' } },
    audioEl: { currentTime },
  });

  // --- 1. at the live edge: the panel shows the ON-AIR song and cover
  const atEdge = factory(world(true, 'COVER-ONAIR', 'COVER-HIST')).resolvePlayheadMeta();
  assert.equal(atEdge.atLiveEdge, true, 'harness: this world is at the live edge');
  assert.equal(atEdge.song.title, ON_AIR.title, 'at the edge the panel shows the on-air song');
  assert.equal(atEdge.artwork, 'COVER-ONAIR', 'at the edge the panel shows the on-air cover');

  // --- 2. after a seek: title AND artist must follow the playhead
  const seeked = factory(world(false, 'COVER-ONAIR', 'COVER-HIST')).resolvePlayheadMeta();
  assert.equal(seeked.atLiveEdge, false, 'harness: this world is behind live');
  assert.equal(seeked.song.title, HISTORIC.title,
    'R1: behind live the panel song must be the one AT THE PLAYHEAD, not the on-air song');
  assert.equal(seeked.song.artist, HISTORIC.artist,
    'R2: the artist must follow the playhead too');

  // --- 3. the 45 s poll fires while behind live. This is the WS24 regression.
  const afterPoll = factory(world(false, 'COVER-ONAIR-CHANGED', 'COVER-HIST')).resolvePlayheadMeta();
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
  const back = factory(world(true, 'COVER-ONAIR-CHANGED', 'COVER-HIST')).resolvePlayheadMeta();
  assert.equal(back.artwork, 'COVER-ONAIR-CHANGED',
    'at the live edge the panel must show the on-air cover again');
});
