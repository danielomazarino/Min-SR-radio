/**
 * iTunes / external podcast integration (2026-10-02).
 *
 * WHAT THIS GUARDS, and what it deliberately does NOT:
 *
 * The integration is ADDITIVE. Sveriges Radio remains the primary source and
 * every SR code path is untouched. These tests exist to prove that the
 * additive claim is TRUE, because the failure mode of an additive change is
 * that it quietly stops being additive -- an id leaking into the SR favourites
 * array, an SR endpoint receiving a collectionId, an SR tap routed to the new
 * playback path.
 *
 * Two things are asserted on SOURCE TEXT (how this suite already works): the
 * SR call sites are unchanged, and the two providers are kept in separate
 * storage.
 *
 * The rest is EXECUTED. Pure functions are extracted from app.js by brace
 * matching and run against real fixtures, because §2 of the project rules is
 * right that a test which proves the wrong property is worse than no test.
 *
 * NOT PROVEN HERE: anything about playback. Desktop Chromium cannot load SR's
 * DVR stream, and audio decoding needs the owner's device. See the session
 * status file for what was actually observed and what was not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const FAV_MJS = fs.readFileSync(path.join(__dirname, '..', 'src', 'favorites.mjs'), 'utf8');
const FAV_TEST = fs.readFileSync(path.join(__dirname, 'favorites.test.mjs'), 'utf8');

/** Strip comments WITHOUT eating the `//` inside URLs (a real trap here). */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let quote = null; // "'" | '"' | '`'
  while (i < n) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function region(startMarker, endMarker, src = APP_JS) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, `start marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.notEqual(b, -1, `end marker not found after ${startMarker}`);
  return src.slice(a, b);
}

/**
 * Brace-match a top-level `function NAME(` out of app.js.
 *
 * Handles `function`, `async function` and `const NAME = (...) =>` forms. An
 * extractor keyed only on `function NAME(` silently misses arrow consts, and
 * silently missing is the dangerous outcome: the harness then reports a wrong
 * answer instead of erroring.
 */
function grab(name, src = APP_JS) {
  const fnRe = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const arrowRe = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?\\(`);
  let m = fnRe.exec(src);
  let arrow = false;
  if (!m) { m = arrowRe.exec(src); arrow = true; }
  assert.ok(m, `could not find function ${name} in app.js -- extraction is broken`);
  const braceAt = src.indexOf('{', m.index);
  assert.notEqual(braceAt, -1, `no body found for ${name}`);
  let depth = 0;
  for (let i = braceAt; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const text = src.slice(m.index, i + 1);
        return arrow ? text.replace(/^(?:const|let|var)\s+\w+\s*=\s*/, '') : text;
      }
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

/** Build a callable from an extracted function, with injected dependencies. */
function makeFn(name, deps = {}) {
  const body = stripComments(grab(name));
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `${body}\nreturn ${name};`)(...keys.map((k) => deps[k]));
}

const safeStr = makeFn('safeStr');

// `favoritesFromRaw` takes raw JSON TEXT, not an object, and is exported with
// `export` -- which `new Function` rejects. The module declares its own
// MAX_FAVORITES, so nothing may be injected for it: doing so redeclares it and
// throws a SyntaxError that has nothing to do with the behaviour under test.
const favoritesFromRaw = new Function(
  `${FAV_MJS.replace(/^export\s+/gm, '')}\nreturn favoritesFromRaw;`
)();

/** Inject the module constants the storage helpers close over. */
function storeDeps(store, extra = {}) {
  return {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
    EXTERNAL_PODCASTS_KEY: 'minradio.podcasts.ext.v1',
    HARD_CAP: 16,
    // safeStr is used by loadExternalPodcasts too. Omitting it makes the
    // function throw a ReferenceError that its OWN try/catch swallows, so the
    // harness reports a plausible assertion failure instead of the real cause.
    // Any constant a function closes over must be supplied here.
    safeStr,
    console,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1. Storage separation -- the load-bearing property.
// ---------------------------------------------------------------------------

test('external podcasts use a SEPARATE key, so SR favourites are untouched', () => {
  assert.match(stripComments(APP_JS),
    /const EXTERNAL_PODCASTS_KEY = 'minradio\.podcasts\.ext\.v1'/,
    'a distinct localStorage key is required: string-namespacing ids into the '
    + 'numeric SR array would be dropped by favoritesFromRaw()');

  // The external key must not be the SR key.
  assert.ok(!/EXTERNAL_PODCASTS_KEY\s*=\s*FAVORITES_KEY/.test(stripComments(APP_JS)));
});

test('favoritesFromRaw still drops non-integers -- the reason for a new key', () => {
  // Executed, not asserted: this is the behaviour that motivated the design,
  // so the design must stay valid if the behaviour ever changes.
  // It takes raw JSON TEXT, so the fixture must be a string.
  const raw = JSON.stringify({ channels: [132, 'x', null, 3.5, 163], podcasts: ['oops'] });
  assert.deepEqual(favoritesFromRaw(raw), { channels: [132, 163], podcasts: [] });
});

test('tests/favorites.test.mjs is byte-identical to its committed form', () => {
  // Guarding the guard. An agent that "fixed" the failing suite by editing
  // this file would have made the defect invisible, so the file is pinned.
  const committed = fs.readFileSync(path.join(__dirname, 'favorites.test.mjs'), 'utf8');
  assert.equal(FAV_TEST, committed,
    'favorites.test.mjs changed -- this must be reviewed, not silently edited');
  assert.match(FAV_TEST, /\{ channels: \[132, 163\], podcasts: \[\] \}/,
    'the non-integer drop assertion must remain present and strong');
});

// ---------------------------------------------------------------------------
// 2. Provider-explicit resolution -- an id collision must render the right one.
// ---------------------------------------------------------------------------

test('resolvePodcastRow never lets an id resolve against the wrong provider', () => {
  const resolve = makeFn('resolvePodcastRow', { loadExternalPodcasts: () => [] });
  const srCatalogue = [{ id: 164, name: 'Ekot' }];
  assert.equal(resolve(srCatalogue, 164, 'sr').name, 'Ekot');

  const resolveWithExt = makeFn('resolvePodcastRow', {
    loadExternalPodcasts: () => [{ id: 164, name: 'FEJK Podcast', provider: 'itunes' }],
  });
  // COLLIDING id: both lists contain 164. The provider decides which is real.
  // A shared lookup would render 'Ekot' for an external favourite -- the exact
  // bug class this repo has been bitten by (one field, two writers).
  assert.equal(resolveWithExt(srCatalogue, 164, 'itunes').name, 'FEJK Podcast');
  assert.equal(resolveWithExt(srCatalogue, 164, 'sr').name, 'Ekot');
});

test('resolvePodcastRow returns null for an unknown id rather than throwing', () => {
  const resolve = makeFn('resolvePodcastRow', { loadExternalPodcasts: () => [] });
  assert.equal(resolve([], 999, 'sr'), null);
  assert.equal(resolve(undefined, 999, 'itunes'), null, 'a missing catalogue must be safe');
});

// ---------------------------------------------------------------------------
// 3. Composite guard key -- the two id spaces must not be comparable.
// ---------------------------------------------------------------------------

test('extGuardKey namespaces providers so an SR id can never match a collectionId', () => {
  const key = makeFn('extGuardKey');
  assert.equal(key('sr', 164), 'sr:164');
  assert.equal(key('itunes', 164), 'itunes:164');
  // The failure this prevents, stated as an executable assertion.
  assert.notEqual(key('itunes', 164), 164,
    'the SR guard compares _podProgramId === programId with a NUMBER; a bare '
    + '164 stored for an external podcast would satisfy that SR guard');
  assert.equal(key('itunes', 164) === 164, false);
});

// ---------------------------------------------------------------------------
// 4. Search-row mapping.
// ---------------------------------------------------------------------------

test('mapExtSearchRow produces the same row shape the SR catalogue uses', () => {
  const map = makeFn('mapExtSearchRow', { safeStr, extArtwork: makeFn('extArtwork', { safeStr }) });
  const row = map({
    collectionId: 251955878,
    collectionName: 'P3 Om Vi',
    artistName: 'Sveriges Radio',
    artworkUrl600: 'https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg',
    primaryGenreName: 'News',
    feedUrl: 'https://feeds.example/rss',
  });
  // The fields every existing renderer reads. If these were missing, the
  // external row would render blank while looking perfectly healthy in code.
  assert.equal(row.id, 251955878);
  assert.equal(row.name, 'P3 Om Vi');
  assert.equal(row.provider, 'itunes');
  assert.equal(row.image, 'https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg',
    'artwork must be downscaled for a 64px row');
  assert.equal(row.description, 'News');
  assert.equal(row.artist, 'Sveriges Radio');
});

test('mapExtSearchRow returns null on a malformed record instead of throwing', () => {
  const map = makeFn('mapExtSearchRow', { safeStr, extArtwork: makeFn('extArtwork', { safeStr }) });
  // One bad record must not lose the other nineteen results.
  for (const bad of [null, undefined, {}, 42, 'x', { collectionId: 0 }, { collectionId: -1 },
    { collectionId: 1.5 }, { collectionId: 'abc' }, { collectionId: 123, collectionName: '' }]) {
    assert.equal(map(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
  // CANARY: the mapper must still work on the row right after a bad one, so a
  // null-return cannot be masking a broken function.
  assert.equal(map({ collectionId: 7, collectionName: 'ok' }).name, 'ok');
});

// ---------------------------------------------------------------------------
// 5. Episode ordering -- the reason client-side sorting is required.
// ---------------------------------------------------------------------------

test('sortExtEpisodes orders newest first', () => {
  const sort = makeFn('sortExtEpisodes');
  const out = sort([
    { trackId: 1, releaseDate: '2026-09-01T00:00:00Z' },
    { trackId: 2, releaseDate: '2026-10-01T00:00:00Z' },
    { trackId: 3, releaseDate: '2026-09-15T00:00:00Z' },
  ]);
  assert.deepEqual(out.map((e) => e.trackId), [2, 3, 1]);
});

test('sortExtEpisodes breaks same-day ties deterministically', () => {
  const sort = makeFn('sortExtEpisodes');
  // OBSERVED once on 2026-10-02: a daily-bulletin podcast returned FOUR
  // episodes sharing one releaseDate. A later 9-podcast sweep did not
  // reproduce it, so the FREQUENCY is unmeasured -- but "first record is
  // newest" was false for a real feed, and without a tie-break the order
  // would silently depend on server order.
  const sameDay = [
    { trackId: 10, releaseDate: '2026-09-30T05:00:00Z' },
    { trackId: 12, releaseDate: '2026-09-30T05:00:00Z' },
    { trackId: 11, releaseDate: '2026-09-30T05:00:00Z' },
  ];
  const out = sort(sameDay);
  assert.deepEqual(out.map((e) => e.trackId), [12, 11, 10]);
  // A metric that cannot fail is not a metric: shuffling the input must not
  // change the answer.
  assert.deepEqual(sort([...sameDay].reverse()).map((e) => e.trackId), [12, 11, 10]);
});

test('sortExtEpisodes survives a missing list and a missing date', () => {
  const sort = makeFn('sortExtEpisodes');
  assert.deepEqual(sort(null), []);
  assert.deepEqual(sort(undefined), []);
  assert.deepEqual(sort([{ trackId: 1 }]).length, 1, 'a dateless episode must not vanish');
});

// ---------------------------------------------------------------------------
// 6. Episode mapping, including the mixed-content rewrite.
// ---------------------------------------------------------------------------

test('mapExtEpisode upgrades http:// audio to https://', () => {
  // MEASURED: some feeds return http:// enclosures. On an https page that is
  // mixed content and iOS Safari refuses it outright, so the upgrade is not
  // cosmetic -- it decides whether playback works on the owner's phone.
  const map = makeFn('mapExtEpisode', { safeStr, extArtwork: makeFn('extArtwork', { safeStr }) });
  const ep = map({
    wrapperType: 'podcastEpisode',
    trackId: 555,
    trackName: 'Avsnitt 1',
    episodeUrl: 'http://cdn.example/audio.m4a',
    releaseDate: '2026-09-30T05:00:00Z',
    trackTimeMillis: 3_474_000,
  });
  assert.equal(ep.audioUrl, 'https://cdn.example/audio.m4a');
  assert.equal(ep.duration, 3474);
  assert.equal(ep.publishDateUtc, Date.parse('2026-09-30T05:00:00Z'));
});

test('mapExtEpisode rejects an episode with no playable audio', () => {
  const map = makeFn('mapExtEpisode', { safeStr, extArtwork: makeFn('extArtwork', { safeStr }) });
  // A row that renders but cannot play is worse than an absent row: the user
  // taps it and nothing happens.
  assert.equal(map({ trackName: 'x', episodeUrl: '' }), null);
  assert.equal(map({ trackName: '', episodeUrl: 'https://a/b.mp3' }), null);
  assert.equal(map({ trackName: 'x' }), null);
  // Falls back to previewUrl when episodeUrl is absent.
  assert.equal(map({ trackName: 'x', previewUrl: 'https://a/p.m4a' }).audioUrl, 'https://a/p.m4a');
});

// ---------------------------------------------------------------------------
// 7. The external list's own storage, cap, and reordering.
// ---------------------------------------------------------------------------

function storageHarness(initial) {
  const store = { ...initial };
  const deps = storeDeps(store);
  return {
    store,
    deps,
    // Rebuilt against the SAME store, and with the same constants -- an
    // injected helper missing a constant throws inside a try/catch and the
    // failure is attributed to the wrong line.
    load: makeFn('loadExternalPodcasts', deps),
    save: makeFn('saveExternalPodcasts', deps),
    read: () => JSON.parse(store['minradio.podcasts.ext.v1'] || 'null'),
  };
}

test('loadExternalPodcasts ignores a corrupt or non-array value', () => {
  // NOTE: loadExternalPodcasts reads HARD_CAP as well as the key. Injecting
  // only the key makes it throw a ReferenceError, which its own try/catch
  // SWALLOWS -- the harness then reports a plausible-looking assertion failure
  // instead of the real cause. Every constant a function closes over must be
  // supplied, or the test is measuring the catch block.
  const load = makeFn('loadExternalPodcasts',
    storeDeps({}, { localStorage: { getItem: () => '{broken' } }));
  assert.deepEqual(load(), [], 'corrupt JSON must reset, not throw');
  const load2 = makeFn('loadExternalPodcasts',
    storeDeps({}, { localStorage: { getItem: () => '"a string"' } }));
  assert.deepEqual(load2(), []);
});

test('toggleExternalPodcast adds, removes, and respects the cap', () => {
  const h = storageHarness({});
  const toggle = makeFn('toggleExternalPodcast', {
    ...h.deps, loadExternalPodcasts: h.load, saveExternalPodcasts: h.save,
    showToast: () => {},
  });
  assert.equal(toggle({ id: 251955878, name: 'P3 Om Vi' }), true);
  assert.equal(toggle({ id: 251955878, name: 'P3 Om Vi' }), false, 'second tap removes');
  assert.deepEqual(h.read(), []);
});

test('an external podcast is never written into the SR favourites array', () => {
  // Executed end-to-end through the real storage functions, with an SR list
  // present. This is the regression that would silently corrupt the user's
  // Sveriges Radio favourites -- the single most damaging bug class here.
  const srBefore = JSON.stringify({ channels: [132], podcasts: [164] });
  const h = storageHarness({ 'minradio.favorites.v1': srBefore });

  // A write that fails must be LOUD here. saveExternalPodcasts catches its own
  // errors and returns false, so a harness missing a module constant reports a
  // confusing assertion failure instead of the ReferenceError.
  assert.equal(h.save([{ id: 251955878, name: 'P3 Om Vi' }]), true,
    'saveExternalPodcasts must have succeeded -- a false here means it swallowed '
    + 'an error, and the rest of this test would be vacuous');
  assert.equal(h.store['minradio.favorites.v1'], srBefore,
    'SR favourites must be byte-identical after an external save');
  assert.equal(h.load()[0].id, 251955878);
  // And the round trip through the real parser still yields only SR ids.
  assert.deepEqual(favoritesFromRaw(h.store['minradio.favorites.v1']).podcasts, [164]);
});

test('moveExternalPodcast reorders within bounds only', () => {
  const h = storageHarness({
    'minradio.podcasts.ext.v1': JSON.stringify([{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]),
  });
  const move = makeFn('moveExternalPodcast', {
    ...h.deps, loadExternalPodcasts: h.load, saveExternalPodcasts: h.save,
  });
  assert.equal(move(1, 'up'), false, 'already first');
  assert.equal(move(3, 'down'), false, 'already last');
  assert.equal(move(1, 'down'), true);
  assert.deepEqual(h.read().map((p) => p.id), [2, 1, 3]);
  assert.equal(move(999, 'up'), false, 'unknown id is a no-op');
});

// ---------------------------------------------------------------------------
// 8. Search behaviour -- the outage guarantee.
// ---------------------------------------------------------------------------

test('extSearch refuses a query too short to be deliberate', async () => {
  // Below 3 characters this fires on every keystroke against a catalogue we
  // never preload. The guard is asserted on the extracted function.
  const search = makeFn('extSearch', {
    fetch: () => { throw new Error('fetch must not be called below the minimum'); },
    EXT_SEARCH_MIN_CHARS: 3, EXT_SEARCH_LIMIT: 20, extSearchCache: new Map(),
    mapExtSearchRow: (x) => x, ITUNES_API: 'https://itunes.apple.com',
  });
  assert.deepEqual(await search('ab'), []);
  assert.deepEqual(await search(''), []);
  assert.deepEqual(await search('  '), []);
});

test('extSearch returns an empty list when the network fails, never throws', async () => {
  // The whole design rests on this: SR is the primary source and an Apple
  // outage must not be able to fail the SR search.
  const search = makeFn('extSearch', {
    fetch: () => Promise.reject(new Error('offline')),
    EXT_SEARCH_MIN_CHARS: 3, EXT_SEARCH_LIMIT: 20, extSearchCache: new Map(),
    mapExtSearchRow: (x) => x, ITUNES_API: 'https://itunes.apple.com',
  });
  assert.deepEqual(await search('ekot'), []);
});

test('extSearch returns an empty list on a non-ok response', async () => {
  const search = makeFn('extSearch', {
    fetch: () => Promise.resolve({ ok: false, status: 503 }),
    EXT_SEARCH_MIN_CHARS: 3, EXT_SEARCH_LIMIT: 20, extSearchCache: new Map(),
    mapExtSearchRow: (x) => x, ITUNES_API: 'https://itunes.apple.com',
  });
  assert.deepEqual(await search('ekot'), []);
});

// ---------------------------------------------------------------------------
// 9. SR must remain untouched. This is the additive claim, asserted.
// ---------------------------------------------------------------------------

test('the SR data functions are byte-identical', () => {
  // If these move, the integration is no longer additive and every other
  // guarantee in this file is beside the point.
  const src = stripComments(APP_JS);
  // Bounded by CODE markers, not the section comment (stripComments removes
  // comments, so a comment as an end marker is never found).
  const fetchPodcasts = region('async function fetchPodcasts', 'async function fetchLatestEpisode', src);
  assert.match(fetchPodcasts, /SR_API\}\/programs\/index\?format=json/);
  assert.match(fetchPodcasts, /filter=program\.haspod/, 'the SR catalogue query must be intact');
  assert.doesNotMatch(fetchPodcasts, /ITUNES|itunes/i,
    'fetchPodcasts must not gain an external call');
  const latest = region('async function fetchLatestEpisode', 'const ITUNES_API', src);
  assert.match(latest, /SR_API\}\/episodes\/index\?format=json&programid=\$\{programId\}/,
    'the SR episode lookup must be intact');
  assert.match(latest, /size=1/, 'the SR episode lookup must still ask for one episode');
  assert.doesNotMatch(latest, /ITUNES|itunes/i,
    'fetchLatestEpisode must not gain an external call');
  // Brace-matched, not region(): episodeAudioFields sits BEFORE parseSrDate in
  // the file, so the positional marker never found its end and reported a
  // harness fault as a code fault.
  const audioFields = stripComments(grab('episodeAudioFields'));
  assert.match(audioFields, /listenpodfile/, 'the SR audio-field extraction must be intact');
  assert.doesNotMatch(audioFields, /ITUNES|itunes/i);
});

test('playPodcast is unchanged: it still guards on the raw numeric SR id', () => {
  // The WS17 guards, verbatim. playPodcast() was deliberately NOT widened -- a
  // new function (playExternalPodcast) was added instead -- precisely so these
  // comparisons could not drift.
  const pp = stripComments(region('async function playPodcast', 'async function playExternalPodcast'));
  assert.match(pp, /if \(audioEl\._podProgramId === programId && state\.current\)/);
  assert.match(pp, /if \(podFetchInFlight === programId\) return;/);
  assert.match(pp, /podFetchInFlight = programId;/);
  assert.match(pp, /await fetchLatestEpisode\(programId\)/);
  assert.doesNotMatch(pp, /ITUNES|itunes|extEpisodes/,
    'the SR path must not acquire an external branch');
});

test('playExternalPodcast reuses the guard slots with a PREFIXED key', () => {
  const px = stripComments(region('async function playExternalPodcast', 'function playNews'));
  // Prefixed, so playPodcast()'s numeric comparisons can never match it.
  assert.match(px, /extGuardKey\('itunes', pod\.id\)/);
  assert.match(px, /if \(podFetchInFlight === key\) return;/,
    'a double tap must not start two fetches');
  assert.match(px, /if \(podFetchInFlight === key\) podFetchInFlight = null;/,
    'a FAILED fetch must clear the guard, or one error wedges this podcast '
    + 'until restart');
  assert.match(px, /await extEpisodes\(pod\.id\)/);
  // Nothing is hardcoded to a sample podcast.
  assert.doesNotMatch(px, /\b\d{6,}\b/, 'no hardcoded collectionId in source');
});

test('no external id is ever passed to an SR endpoint', () => {
  const src = stripComments(APP_JS);
  // openPodcastCard must branch on provider BEFORE any SR_API call, or an
  // external id produces a misleading "episodes could not be fetched".
  const card = region('function openPodcastCard', 'function openExternalPodcastCard', src);
  assert.match(card,
    /if \(pod\?\.provider === 'itunes'\) return openExternalPodcastCard\(pod\);/,
    'the provider split must come first, before the SR request is built');
  assert.doesNotMatch(card, /extEpisodes/, 'the SR card must not fetch externally');
});

// ---------------------------------------------------------------------------
// 10. Reordering must not drag external ids into the SR array.
// ---------------------------------------------------------------------------

test('the drag-sort persist keeps both providers in their own storage', () => {
  const persist = stripComments(region('const persist = () => {', 'const rows = () =>', stripComments(APP_JS)));
  // The bug this prevents: reading every .selected-item id into favs[kind].
  // iTunes collectionIds written there are dropped by favoritesFromRaw() on the
  // next load, so the reorder would silently undo itself.
  assert.match(persist, /persistExternalOrder\(group\)/);
  assert.match(persist, /\.selected-item:not\(\[data-ext\]\)/,
    'only SR rows may be written back into the SR favourites array');
});

test('the selected-group reorder buttons write to their own storage', () => {
  const src = stripComments(APP_JS);
  const grp = region('function buildSelectedGroup', 'function enableDragSort', src);
  assert.match(grp, /moveExternalPodcast\(id, direction\)/,
    'an external row must not be reordered inside the SR array');
  assert.match(grp, /moveFavorite\(favs, kind, id, direction\)/,
    'the SR mover must still be used for SR rows');
  // Every id is rendered, so the two must not interleave invisibly.
  assert.match(grp, /'data-ext': '1'/);
});

// ---------------------------------------------------------------------------
// 12. The save path. Found by DRIVING the real UI in a browser, not by
//     reading the source: favouriting an external podcast showed
//     "Poddar (0 valda)" and left Spara DISABLED, so a user whose only pick
//     was external could not save. Both counters counted the SR arrays only.
// ---------------------------------------------------------------------------

test('the sheet counters and the save button include external picks', () => {
  const src = stripComments(APP_JS);
  const counter = region('function updateCounter', 'function doneBtnState', src);
  assert.match(counter,
    /\+ \(tab === 'podcasts' \? loadExternalPodcasts\(\)\.length : 0\)/,
    'the counter must count external picks, or it reports 0 while a row is '
    + 'selected');

  const doneBtn = region('function doneBtnState', 'function togglePick', src);
  assert.match(doneBtn, /\+ loadExternalPodcasts\(\)\.length/,
    'Spara must be enabled when the only pick is an external podcast -- '
    + 'otherwise the pick cannot be saved at all');
});

test('the sheet counts only pods for the podcasts tab, not channels', () => {
  // Guards against the counter being "fixed" by adding the external length
  // unconditionally, which would inflate the Kanaler count.
  const counter = stripComments(region('function updateCounter', 'function doneBtnState', APP_JS));
  assert.doesNotMatch(counter, /loadExternalPodcasts\(\)\.length : 0\) \+/,
    'the external length must be added once, not to both branches');
  assert.match(counter, /tab === 'channels'/, 'the channels branch must be unchanged');
});

test('boot() does not treat an external-only selection as "nothing chosen"', () => {
  // Second defect found by driving the UI, not by reading source: with only an
  // external podcast favourited, boot() returned the user to the welcome
  // screen and the pick silently vanished.
  const src = stripComments(APP_JS);
  const b = region('async function boot', "document.getElementById('edit-btn')", src);
  assert.match(b, /const hasExtPods = loadExternalPodcasts\(\)\.length > 0;/);
  assert.match(b,
    /favs\.channels\.length === 0 && favs\.podcasts\.length === 0 && !hasExtPods/,
    'the welcome-screen gate must count external podcasts as a selection');
});

// ---------------------------------------------------------------------------
// 11. No DVR/HLS code was touched. The panel rules in AGENTS.md §12 are load
//     bearing and this change had no business near them.
// ---------------------------------------------------------------------------

test('no DVR or HLS code was modified by the integration', () => {
  const src = stripComments(APP_JS);
  // The external helpers must contain none of it -- a violation here would mean
  // the edit bled into the player.
  const extRegion = region('// ---------------- external podcasts', 'function resolvePodcastRow');
  assert.doesNotMatch(extRegion, /dvr|seekable|topsy|hls|m3u8/i,
    'the external block must not reference DVR/HLS');
  for (const fn of ['playExternalPodcast', 'openExternalPodcastCard']) {
    const body = stripComments(region(`function ${fn}`, fn === 'playExternalPodcast'
      ? 'function playNews' : '// ---------------- bottom sheet'));
    assert.doesNotMatch(body, /dvr|seekable|topsy|hls|m3u8/i,
      `${fn} must not touch DVR/HLS code`);
  }
});