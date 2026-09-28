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
  assert.ok(painter.includes("const panel = $player.querySelector('.player-expand')"),
    'expanded panel lookup must run independently of line presence');
  assert.ok(painter.includes('panel._srRepaint();'), 'open panel repaint must run');
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
  const npDecl = /const nowPlaying = \{[\s\S]*?episodeArtwork: null \};/.exec(APP_JS);
  assert.ok(npDecl, 'the nowPlaying literal must be readable');
  const npBody = npDecl[0];
  assert.equal((npBody.match(/artwork:/g) || []).length, 1,
    'exactly ONE artwork key -- a duplicate would silently shadow the live field');
  assert.equal((npBody.match(/episodeArtwork:/g) || []).length, 1,
    'exactly one episodeArtwork key');
  // And the two must be read from two different fields at the two call sites,
  // so neither path can inherit the other's cover.
  assert.ok(/if \(isLive\) \{ nowPlaying\.artwork =/.test(APP_JS),
    'the live target must write nowPlaying.artwork');
  assert.ok(/else nowPlaying\.episodeArtwork =/.test(APP_JS),
    'the episode target must write nowPlaying.episodeArtwork, not artwork');
  // The live branch must still read nowPlaying.artwork and nothing else.
  assert.ok(/nowPlaying\.artwork/.test(decl[0]),
    'a live song must still use the rightnow/iTunes artwork');
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
  assert.ok(/nowPlaying\.artwork/.test(arms[2]),
    'the LIVE arm must still read the rightnow/iTunes artwork');
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
  assert.ok(/refreshNowPlayingArtwork\(next, nowPlaying\)/.test(code),
    'the episode path must call the shared lookup with the resolved track');
  assert.ok(/if \(next && next\.title && next\.artist\) \{\s*refreshNowPlayingArtwork\(next, nowPlaying\)/.test(code),
    "the episode lookup must be guarded on a real title AND artist");
  // The live call site is unchanged in substance: the live song, live target.
  assert.ok(/refreshNowPlayingArtwork\(nowPlaying\.song, nowPlaying\)/.test(code),
    'the live path must still pass the live song and the live target');
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
    && /refreshNowPlayingArtwork\(nowPlaying\.song, nowPlaying\)/.test(fetchFn),
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
  const epFn = code.slice(code.indexOf('function updateEpisodeTrack'),
    code.indexOf('async function fetchNowPlaying'));
  assert.ok(epFn.length > 0 && /refreshNowPlayingArtwork\(next, nowPlaying\)/.test(epFn),
    'the episode lookup must live in updateEpisodeTrack, on a track change');
  assert.ok(/if \(next && next\.title && next\.artist\)/.test(epFn),
    "the episode lookup must be guarded on a real title AND artist");
  // And it must be inside the CHANGE detection, never on every timeupdate:
  // a lookup per tick would be four requests a second.
  assert.ok(/episodeCurrentTrack = next;[\s\S]*?refreshNowPlayingArtwork\(next, nowPlaying\)/.test(epFn),
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
  // It must pass `nowPlaying` as the target, which is how the shared function
  // decides the LIVE field rather than the episode field. Getting this wrong
  // would write a radio cover into the episode's slot.
  const calls = RESOLVE.match(/refreshNowPlayingArtwork\([^)]*\)/g) || [];
  assert.ok(calls.length >= 1, 'the seek path must call the shared lookup');
  calls.forEach((c) => {
    assert.ok(/nowPlaying\s*\)?\s*$/.test(c) || /, nowPlaying\)/.test(c),
      `every seek-path call must target nowPlaying (the live field): ${c}`);
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
  assert.ok(/refreshNowPlayingArtwork\(null, nowPlaying\)/.test(RESOLVE),
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
  assert.ok(/if \(nowPlaying\.artwork\)/.test(RESOLVE),
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
  assert.ok(/refreshNowPlayingArtwork\(nowPlaying\.song, nowPlaying\)/.test(FETCH),
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
  assert.ok(!/nowPlaying\.artwork/.test(arms[1]),
    "the episode arm must still NOT read the live channel's artwork field");
  assert.ok(/nowPlaying\.artwork/.test(arms[2]),
    'the live arm must still read nowPlaying.artwork');
  // The live/episode field split inside the shared function is unchanged: the
  // guard is what stops the seek path writing into the episode slot.
  const FN = (() => {
    const a = CODE.indexOf('async function refreshNowPlayingArtwork(');
    return CODE.slice(a, CODE.indexOf('function paintNowPlaying(', a));
  })();
  assert.ok(/const isLive = target === nowPlaying;/.test(FN),
    'the live/episode guard must be unchanged');
  assert.ok(/if \(isLive\) \{ nowPlaying\.artwork = big; paintNowPlaying\(\); \}/.test(FN),
    'the live write path must be byte-identical');
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
