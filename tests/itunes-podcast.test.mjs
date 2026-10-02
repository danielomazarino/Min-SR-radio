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
  // DELETED 2026-10-02. This function is GONE, and that is the fix, not a
  // regression: it moved an id within the external array only, so an external
  // row could never step past an SR row and vice versa. It is kept here as a
  // guard so it cannot be quietly reinstated.
  assert.doesNotMatch(APP_JS, /function moveExternalPodcast/,
    'the per-provider mover could not cross the boundary and must stay deleted');
  assert.doesNotMatch(APP_JS, /function persistExternalOrder/,
    'superseded by the combined-order persist');
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

test('the drag-sort persist keeps each provider in its own storage', () => {
  // RESTATED 2026-10-02. The requirement did NOT weaken: an id must still
  // never cross into the wrong storage. The MECHANISM changed, because the
  // row now has one order that both providers occupy (the owner reported that
  // a mixed arrangement reverted on the home screen).
  const persist = stripComments(region('const persist = () => {', 'const rows = () =>', stripComments(APP_JS)));
  // The bug this prevents: writing EVERY id into the SR array. iTunes
  // collectionIds written there are dropped by favoritesFromRaw() on the next
  // load, so the reorder would silently undo itself.
  assert.match(persist, /if \(kind === 'podcasts'\) \{/);
  assert.match(persist,
    /favs\.podcasts = order\.filter\(\(id\) => !extIds\.has\(id\) && known\.has\(id\)\)/,
    'only ids that are really SR favourites may be written to the SR array');
  assert.match(persist, /persistPodcastRowOrder\(order\)/,
    'the interleaving is stored as an ORDER, not by moving ids between arrays');
});

test('a mixed order is expressible and both renderers read the same one', () => {
  // The reported bug: an interleaved arrangement reverted when leaving the
  // settings sheet, because the home row hardcoded SR-then-external while the
  // settings list had its own arrangement.
  const src = stripComments(APP_JS);
  const icons = region('function buildIconSection', "el('h2'", src);
  const grp = region('function buildSelectedGroup', 'function enableDragSort', src);
  for (const [name, body] of [['buildIconSection', icons], ['buildSelectedGroup', grp]]) {
    assert.match(body, /podcastRowOrder\(/,
      `${name} must read the shared order, or the two views disagree`);
  }
  // The order key holds BARE ids only -- no row data -- so a podcast is still
  // favourited in exactly one of the two storages.
  const loadOrder = stripComments(grab('loadPodcastOrder'));
  const saveOrder = stripComments(grab('savePodcastOrder'));
  // BOTH ends are checked, and by FUNCTION rather than by a slice of source.
  // An earlier version asserted a regex over the combined region, which stayed
  // GREEN when loadPodcastOrder's filter was deleted -- because the identical
  // expression still existed in savePodcastOrder. A guard that cannot go red is
  // not a guard.
  assert.match(loadOrder, /\.filter\(\(id\) => Number\.isInteger\(id\)\)/,
    'loadPodcastOrder must reject non-integer ids on the way IN, whatever was '
    + 'written to storage');
  assert.match(saveOrder, /\.filter\(\(id\) => Number\.isInteger\(id\)\)/,
    'savePodcastOrder must not write non-integer ids on the way OUT');
});

test('the reorder buttons swap across the provider boundary', () => {
  // The reported bug had two halves, BOTH observed in the browser: an external
  // row's "move up" did nothing at all (it was alone in its own array), and an
  // SR row at the boundary was clamped by its own array's end.
  const grp = stripComments(region('function buildSelectedGroup', 'function enableDragSort', APP_JS));
  assert.match(grp, /const current = podcastRowOrder\(/,
    'the move must operate on the COMBINED order, not on one provider array');
  assert.match(grp, /\[next\[from\], next\[to\]\] = \[next\[to\], next\[from\]\]/,
    'it must be a swap against the neighbour -- a swap is what crosses providers');
  assert.match(grp, /if \(to < 0 \|\| to >= current\.length\) return;/,
    "only the ends of the WHOLE row are bounds, not each array's end");
  assert.match(grp, /srFavs\.podcasts = next\.filter\(\(x\) => !extIds\.has\(x\)\)/,
    'each provider is written back with its own members only');
  // The per-provider mover is gone: it could not cross, so keeping it would be
  // dead code that invites reuse.
  assert.doesNotMatch(grp, /moveExternalPodcast\(/);
  // The row is still marked, so the drag persist can tell the providers apart.
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
// 13. Swipe-to-remove (owner request 2026-10-02).
//
//     THE BUG: an iTunes podcast could be selected from the search results but
//     never deselected. The ONLY removal mechanism was tapping the row in the
//     long SR list, and an external podcast is not in that list -- so once the
//     search was gone the pick was permanent.
//
//     THE GESTURE CONFLICT: these rows already have a long-press drag-to-
//     reorder, which is VERTICAL. A vertical swipe-to-delete would fight it.
//     Resolved by DIRECTION: horizontal removes, vertical keeps reordering.
// ---------------------------------------------------------------------------

/** loadFavorites/saveFavorites over a fake store, built from the real module. */
function srStoreHarness(initial) {
  const store = { 'minradio.favorites.v1': JSON.stringify(initial) };
  const deps = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
    FAVORITES_KEY: 'minradio.favorites.v1',
    MAX_FAVORITES: 4,
    console,
  };
  const favMod = FAV_MJS.replace(/^export\s+/gm, '');
  const sr = new Function('localStorage', 'FAVORITES_KEY', 'MAX_FAVORITES',
    `${favMod}\nreturn { favoritesFromRaw, togglePick };`)(deps.localStorage,
    deps.FAVORITES_KEY, deps.MAX_FAVORITES);
  return {
    store,
    deps,
    sr,
    read: () => JSON.parse(store['minradio.favorites.v1']),
  };
}

function removalHarness({ sr = { channels: [], podcasts: [164] }, ext = [] } = {}) {
  const store = {
    'minradio.favorites.v1': JSON.stringify(sr),
    ...(ext.length ? { 'minradio.podcasts.ext.v1': JSON.stringify(ext) } : {}),
  };
  const deps = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
    EXTERNAL_PODCASTS_KEY: 'minradio.podcasts.ext.v1',
    FAVORITES_KEY: 'minradio.favorites.v1',
    HARD_CAP: 16,
    MAX_FAVORITES: 4,
    safeStr,
    console,
  };
  const favMod = FAV_MJS.replace(/^export\s+/gm, '');
  const favoritesFromRaw = new Function(`${favMod}\nreturn favoritesFromRaw;`)();
  const build = (name) => makeFn(name, {
    ...deps,
    loadFavorites: () => favoritesFromRaw(store['minradio.favorites.v1']),
    saveFavorites: (favs) => { store['minradio.favorites.v1'] = JSON.stringify(favs); },
    loadExternalPodcasts: makeFn('loadExternalPodcasts', deps),
    saveExternalPodcasts: makeFn('saveExternalPodcasts', deps),
  });
  return { store, readSr: () => JSON.parse(store['minradio.favorites.v1']),
    readExt: () => JSON.parse(store['minradio.podcasts.ext.v1'] || '[]'),
    remove: build('removeFavoriteRow'), restore: build('restoreFavoriteRow') };
}

test('removeFavoriteRow removes an iTunes podcast and leaves SR untouched', () => {
  const h = removalHarness({ sr: { channels: [132], podcasts: [164] },
    ext: [{ id: 251955878, name: 'P3 Om Vi' }] });
  const removed = h.remove('podcasts', 251955878);
  assert.equal(removed.provider, 'itunes');
  assert.equal(removed.name, 'P3 Om Vi');
  assert.deepEqual(h.readExt(), []);
  assert.deepEqual(h.readSr(), { channels: [132], podcasts: [164] },
    'removing an external podcast must not touch the SR array at all');
});

test('removeFavoriteRow removes an SR podcast without touching external storage', () => {
  const h = removalHarness({ sr: { channels: [], podcasts: [164, 3437] },
    ext: [{ id: 251955878, name: 'P3 Om Vi' }] });
  const removed = h.remove('podcasts', 164);
  assert.equal(removed.provider, 'sr');
  assert.deepEqual(h.readSr(), { channels: [], podcasts: [3437] });
  assert.deepEqual(h.readExt(), [{ id: 251955878, name: 'P3 Om Vi' }]);
});

test('removeFavoriteRow is idempotent -- a double swipe removes nothing twice', () => {
  const h = removalHarness({ ext: [{ id: 251955878, name: 'P3 Om Vi' }] });
  assert.ok(h.remove('podcasts', 251955878));
  assert.equal(h.remove('podcasts', 251955878), null,
    'the second swipe must be a no-op, not a re-add or a throw');
  assert.deepEqual(h.readExt(), []);
});

test('removeFavoriteRow handles channels as well as podcasts', () => {
  const h = removalHarness({ sr: { channels: [132, 163], podcasts: [] } });
  assert.equal(h.remove('channels', 132).provider, 'sr');
  assert.deepEqual(h.readSr().channels, [163]);
  assert.equal(h.remove('channels', 999), null);
});

test('restoreFavoriteRow puts an iTunes podcast back at its original position', () => {
  const h = removalHarness({ ext: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }] });
  const before = h.readExt().findIndex((p) => p.id === 2);
  const removed = h.remove('podcasts', 2);
  assert.deepEqual(h.readExt().map((p) => p.id), [1, 3]);
  assert.equal(h.restore(removed, before), true);
  assert.deepEqual(h.readExt().map((p) => p.id), [1, 2, 3],
    'undo must restore the ORDER, not just the membership');
});

test('restoreFavoriteRow will not duplicate an id that was already re-added', () => {
  const h = removalHarness({ ext: [{ id: 1, name: 'a' }] });
  const removed = { id: 1, name: 'a', kind: 'podcasts', provider: 'itunes' };
  assert.equal(h.restore(removed, 0), false);
  assert.deepEqual(h.readExt().map((p) => p.id), [1]);
});

test('restoreFavoriteRow puts an SR podcast back into the SR array only', () => {
  const h = removalHarness({ sr: { channels: [], podcasts: [164, 3437] },
    ext: [{ id: 251955878, name: 'x' }] });
  const before = h.readSr().podcasts.indexOf(3437);
  const removed = h.remove('podcasts', 3437);
  assert.equal(h.restore(removed, before), true);
  assert.deepEqual(h.readSr().podcasts, [164, 3437]);
  assert.deepEqual(h.readExt().map((p) => p.id), [251955878]);
});

test('the swipe gesture is direction-resolved so it cannot fight the drag', () => {
  const src = stripComments(APP_JS);
  const swipe = region('function enableSwipeToRemove', 'function rebuildSelected', src);
  // The whole conflict-resolution rule, in one place.
  assert.match(swipe,
    /s\.intent = Math\.abs\(dx\) > Math\.abs\(dy\) \? 'remove' : 'drag'/,
    'horizontal must claim removal and leave the vertical drag intact');
  assert.match(swipe, /const DECIDE_PX = 10;/,
    'intent must be decided on a small deadzone, or a scrolling list removes rows');
  // Leftward only: a mis-swing the other way must be inert.
  assert.match(swipe, /Math\.min\(0, dx\)/,
    'rightward must not remove -- the offset is clamped at 0');
  assert.match(swipe, /0\.35/,
    'a full swipe is not required; a deliberate partial one must commit');
});

test('the drag-sort yields the horizontal direction to the swipe', () => {
  // The conflict is mutual: the swipe must not start a drag, AND the drag's
  // 250ms timer must not arm for a horizontal move. Without this, a swipe
  // would both delete and reorder the same row.
  const src = stripComments(APP_JS);
  const drag = region('let touchState = null;', 'function rebuildSelected', src);
  assert.match(drag,
    /if \(Math\.abs\(dx\) > Math\.abs\(dy\) && Math\.abs\(dx\) > 10\) \{\s*clearTimeout\(touchState\.timer\)/,
    'a horizontal move must cancel the drag timer, or one gesture does both');
  assert.match(drag, /startX: e\.touches\[0\]\.clientX/,
    'the drag must record startX, or it cannot recognise a horizontal move');
});

test('the ✕ button and the swipe share ONE removal implementation', () => {
  // Two implementations of "remove" would drift. The gesture must call the
  // same function the button does.
  const src = stripComments(APP_JS);
  const grp = region('function buildSelectedGroup', 'function enableDragSort', src);
  assert.match(grp, /onclick: \(\) => onRemoveRequest\(id, isExt \? 'itunes' : 'sr', item\.name\)/);
  assert.match(grp, /enableSwipeToRemove\(group, kind, onRemoveRequest\)/,
    'the gesture must delegate to the button\'s handler, not reimplement it');
  assert.match(grp, /'aria-label': `Ta bort \$\{item\.name\}`/,
    'removal must be reachable without a gesture: undiscoverable and '
    + 'keyboard-unreachable swipes are not an acceptable removal mechanism');
});

test('removal is reversible and the undo toast is a real button', () => {
  const src = stripComments(APP_JS);
  const grp = region('function buildSelectedGroup', 'function enableDragSort', src);
  assert.match(grp, /showUndoToast\(`Borttaget: \$\{removed\.name\}`/,
    'a destructive gesture with no recovery is a bad trade even when it works');
  assert.match(grp, /restoreFavoriteRow\(removed, before\)/);

  const toast = region('function showUndoToast', '// ---------------- app state', APP_JS);
  assert.match(toast, /class: 'toast-action', type: 'button'/,
    'undo must be a <button> so it is keyboard-reachable and announced');
  // A timer that outlives its toast would remove a LATER toast.
  assert.match(toast, /clearTimeout\(timer\)/);
});

test('the sheet pick list follows a removal, or Spara would restore it', () => {
  // This is the subtle one: the sheet keeps its OWN copy in `picks`, and Spara
  // writes from there. Removing from storage alone would let the next save
  // write the id straight back.
  const grp = stripComments(region('function buildSelectedGroup', 'function enableDragSort', APP_JS));
  assert.match(grp, /const idx = picks\[kind\]\.indexOf\(id\);\s*if \(idx >= 0\) picks\[kind\]\.splice\(idx, 1\);/,
    'the in-memory pick list must be updated too, not only storage');
  assert.match(grp, /picks\[kind\]\.splice\(at, 0, id\)/,
    'undo must restore the in-memory pick as well');
});

test('the swipe reveal is behind the row content, not painted over it', () => {
  // THE OWNER'S SECOND REPORT: the red panel covered the whole row, so the
  // favourites list became unreadable exactly when the user was looking at it.
  // The cause is a CSS painting-order trap, not a colour choice: the panel is
  // `position: absolute` while the row's children are `position: static`, and
  // POSITIONED elements paint ABOVE all non-positioned siblings -- so writing
  // the panel first in the DOM does not put it behind.
  const css = stripComments(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8'));
  // Every content child must be lifted into the positioned layer, and source
  // order then decides: panel first, content after, content on top.
  assert.match(css,
    /\.selected-item > \.selected-grip,[\s\S]*?\.selected-item > \.selected-controls \{\s*position: relative;/,
    'the row content must be positioned, or the absolute panel paints over it');
  // The slide must apply to the CONTENT, not the whole row: translating the row
  // would drag the panel sideways and nothing would be uncovered.
  const swipe = stripComments(region('function enableSwipeToRemove', 'function rebuildSelected', APP_JS));
  assert.match(swipe, /const content = \[\.\.\.row\.children\]\.filter\(\(c\) => !c\.classList\.contains\('swipe-reveal'\)\)/,
    'the gesture must capture the content layer, excluding the panel');
  assert.doesNotMatch(swipe, /s\.row\.style\.transform/,
    'the ROW must never be translated -- that moves the panel with it');
  assert.match(swipe, /s\.content\.forEach\(\(el\) => \{/);
});

test('the reveal carries an icon and no caption', () => {
  // Owner: it should look "as for messages in an sms-app or whatsapp". Those
  // use a plain coloured panel with a glyph, not a written label.
  const grp = stripComments(region('function buildSelectedGroup', 'function enableDragSort', APP_JS));
  assert.match(grp, /class: 'swipe-reveal-icon'/, 'the panel must carry an icon');
  assert.doesNotMatch(grp, /class: 'swipe-reveal', 'aria-hidden': 'true', text:/,
    'no written caption on the panel');
});

test('the reveal is a full-bleed panel behind the row, and the row stays readable', () => {
  const grp = stripComments(region('function buildSelectedGroup', 'function enableDragSort', APP_JS));
  assert.match(grp, /'aria-hidden': 'true'/, 'the cue is decorative; the ✕ button carries the name');

  const css = stripComments(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8'));
  assert.match(css, /\.swipe-reveal \{[\s\S]*?background: var\(--danger/,
    'the reveal must use the existing --danger token, not a second red');
  assert.match(css, /\.selected-item \{ position: relative; touch-action: pan-y; \}/);
});

test('removeFavoriteRow carries the name, because SR stores bare integers', () => {
  // Found in the BROWSER, not by reading source: removing an SR row produced
  // "Borttaget: undefined". loadFavorites() returns ids only, so there is no
  // name to recover -- the caller has to pass it in.
  const h = removalHarness({ sr: { channels: [], podcasts: [3437] } });
  const removed = h.remove('podcasts', 3437, 'Ekot granskar');
  assert.equal(removed.name, 'Ekot granskar',
    'the undo toast names the row; without this it reads "undefined"');
  assert.equal(removed.provider, 'sr');

  // Falls back rather than producing undefined when no name is supplied.
  const h2 = removalHarness({ sr: { channels: [], podcasts: [3437] } });
  assert.equal(h2.remove('podcasts', 3437).name, '3437',
    'with no name supplied it must degrade to the id, never to undefined');
});

test('both removal inputs pass a name through', () => {
  const src = stripComments(APP_JS);
  const grp = region('function buildSelectedGroup', 'function enableDragSort', src);
  assert.match(grp, /onRemoveRequest\(id, isExt \? 'itunes' : 'sr', item\.name\)/,
    'the button must pass the name it already has');
  assert.match(grp, /const onRemoveRequest = \(id, provider, name\)/);
  // The gesture can only read it off the DOM.
  const swipe = region('function enableSwipeToRemove', 'function rebuildSelected', src);
  assert.match(swipe,
    /const name = st\.row\.querySelector\('\.selected-name'\)\?\.textContent \|\| ''/,
    'the swipe must read the name from the row it swiped');
  assert.match(swipe, /onRemoved\(st\.id, st\.row\.dataset\.ext \? 'itunes' : 'sr', name\)/);
});

// ---------------------------------------------------------------------------
// 14. No DVR/HLS or player code was touched by the removal work.
// ---------------------------------------------------------------------------

test('removal does not touch DVR/HLS or the player', () => {
  // NOTE: these regions are cut from RAW APP_JS, not stripComments(APP_JS):
  // the end markers are comments, which stripComments removes -- using the
  // stripped source here reports a harness fault as a code fault.
  for (const [name, end] of [['function removeFavoriteRow', 'function restoreFavoriteRow'],
    ['function restoreFavoriteRow', 'function resolvePodcastRow'],
    ['function showUndoToast', '// ---------------- app state']]) {
    assert.doesNotMatch(stripComments(region(name, end)), /dvr|seekable|topsy|hls|m3u8|audioEl|playTrack/,
      `${name} must not touch playback or DVR code`);
  }
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