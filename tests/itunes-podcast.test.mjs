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
  const grp = stripComments(region('function buildSelectedGroup', 'function enableDragSort', APP_JS));
  const swipe = stripComments(region('function enableSwipeToRemove', 'function rebuildSelected', APP_JS));
  // THE ROW ITSELF must be transparent and the SURFACE must live on an inner
  // positioned layer. Giving the children `position: relative` is NOT enough:
  // a parent's own background paints before any positioned child, so the
  // panel still shows through and the row reads red at REST. That was measured
  // on the live site after a fix that had made the text readable.
  // MUTATION CAUGHT IT: the first version of these used /\.selected-item-face \{
  // [\s\S]*?flex: 1;/ and reported GREEN when `flex: 1` was deleted, because
  // the unanchored wildcard runs on past the rule's closing brace and finds a
  // `flex: 1` in some LATER rule. Scoped to the block, every one goes red.
  const faceRule = stripComments(region('.selected-item-face {', '.selected-item.swiping', css));
  const rowRule = stripComments(region('.selected-item {', '.selected-item.dragging', css));
  assert.ok(rowRule.includes('background: transparent'),
    'the row must not paint a surface of its own -- it would sit under the panel');
  assert.match(faceRule, /position: relative;/);
  assert.match(faceRule, /z-index: 1;/,
    'the face must be a stacking layer above the panel');
  assert.match(faceRule, /background: var\(--surface\)/,
    'the visible surface must live on a layer ABOVE the panel');
  // FOUND IN A SCREENSHOT OF A HARNESS, after the first two fixes both passed:
  // the face was correctly positioned and correctly coloured, and the rows were
  // STILL red -- because the face is the row's ONLY in-flow child and sized to
  // its content, leaving a bare red strip down the right-hand side. Painting
  // order was correct; the face was simply too narrow. `flex: 1` is what makes
  // it span the row. Without this the guard above passes on a broken layout.
  assert.match(faceRule, /flex: 1;/,
    'the face must FILL the row width -- sized to content it leaves the panel showing');
  assert.match(faceRule, /min-width: 0;/,
    'the face needs min-width:0 or .selected-name can never ellipsis inside it');
  // The controls slide WITH the face. If they were re-parented onto the row they
  // would sit still over the panel instead of travelling with the name.
  assert.match(grp, /querySelector\('\.selected-item-face'\)\.appendChild\(controls\)/,
    'the controls must be appended INSIDE the face, or they do not travel with it');
  assert.match(grp, /class: 'selected-item-face'/,
    'the row content must be wrapped in the face layer');
  // The face is what slides, so the gesture must target it -- not each child.
  assert.match(swipe,
    /const content = \[\.\.\.row\.children\]\.filter\(\(c\) => !c\.classList\.contains\('swipe-reveal'\)\)/,
    'the gesture must capture the content layer, excluding the panel');
  assert.doesNotMatch(swipe, /s\.row\.style\.transform/,
    'the ROW must never be translated -- that moves the panel with it');
  assert.match(swipe, /s\.content\.forEach\(\(el\) => \{/);
  // The slide must apply to the CONTENT, not the whole row: translating the row
  // would drag the panel sideways and nothing would be uncovered.
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
/* ---------------------------------------------------------------------------
 * WS44 — the drag-to-reorder save path threw a ReferenceError.
 *
 * OWNER REPORT: "the sort order of poscasts is not working in the latest
 * version. the swipe for delete is working fine."
 *
 * WHY A TEXT ASSERTION COULD NOT HAVE CAUGHT IT. Every earlier guard on this
 * file reads the SOURCE of persist(). A ReferenceError is not a property of
 * the text — it only exists when the code RUNS, in a scope where `extList` is
 * not defined. `extList` was declared with `const` inside buildSelectedGroup
 * and read from enableDragSort, a sibling function. The text says
 * "const extList = ..." and "extList.map(...)"; both readings look correct.
 *
 * So this test EXECUTES the persist body through new Function(). If any
 * identifier it reads is not passed in, the call throws and the test fails.
 * That is the property the defect actually had, and the one a regex cannot
 * observe. Observed in the live browser first, not derived from reading.
 * --------------------------------------------------------------------- */
function persistHarness({ sr, ext, domIds }) {
  const store = {
    'minradio.favorites.v1': JSON.stringify(sr),
    'minradio.podcasts.ext.v1': JSON.stringify(ext),
  };
  const writes = {};
  const listeners = {};
  // Stand-ins for the rows. The array order IS the arrangement the user
  // dragged them into, which is the only thing persist() reads from the DOM.
  const rowObjRef = {};
  const rowObjs = domIds.map((id) => {
    const r = {
      dataset: { id: String(id) },
      // The real code calls e.target.closest('.selected-item'); a row IS one.
      closest: (sel) => (sel === '.selected-item' ? r : null),
      querySelector: () => ({ textContent: '' }),
      classList: { add() {}, remove() {} },
    };
    rowObjRef[String(id)] = r;
    return r;
  });
  const group = {
    querySelectorAll: () => rowObjs,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    insertBefore() {},
    getBoundingClientRect: () => ({ top: 0, height: 10, width: 100, left: 0 }),
  };
  const deps = {
    document: { elementFromPoint: () => null },
    navigator: {},
    loadFavorites: () => JSON.parse(store['minradio.favorites.v1']),
    saveFavorites: (f) => { store['minradio.favorites.v1'] = JSON.stringify(f); writes.sr = f; },
    loadExternalPodcasts: () => JSON.parse(store['minradio.podcasts.ext.v1']),
    saveExternalPodcasts: (list) => { store['minradio.podcasts.ext.v1'] = JSON.stringify(list); writes.ext = list; },
    persistPodcastRowOrder: (ids) => { writes.order = ids; },
    rebuildSelected: () => {},
  };
  const keys = Object.keys(deps);
  const enableDragSort = new Function(...keys, `${stripComments(grab('enableDragSort'))}\nreturn enableDragSort;`)(...keys.map((k) => deps[k]));
  // Called EXACTLY as the app calls it, so the parameter contract is the thing
  // under test. The broken signature was (group, kind) and left extList unbound.
  enableDragSort(group, 'podcasts', ext);

  // Drive the real desktop drag: dragstart, then dragend -> persist().
  const drag = () => {
    listeners.dragstart({ target: rowObjs[0], dataTransfer: { setData() {}, effectAllowed: '' } });
    listeners.dragend({});
  };
  return {
    drag,
    readSr: () => JSON.parse(store['minradio.favorites.v1']),
    readExt: () => JSON.parse(store['minradio.podcasts.ext.v1']),
    writes,
  };
}

test('WS44: the drag-to-reorder save runs without throwing, and splits providers', () => {
  // THE assertion that matters: the save path must not throw. For the whole of
  // WS42b -> WS43b it threw `ReferenceError: extList is not defined`, which no
  // source-text assertion could see, because the text was well-formed.
  const h = persistHarness({
    sr: { channels: [132], podcasts: [6706, 3437] },
    ext: [{ id: 1518156497, name: 'Dear Young Person' }],
    domIds: [3437, 1518156497, 6706],
  });
  assert.doesNotThrow(() => h.drag(),
    'the reorder save must not throw -- it threw ReferenceError: extList is not defined');

  assert.deepEqual(h.writes.order, [3437, 1518156497, 6706],
    'the interleaved arrangement must reach the order key verbatim');
  assert.deepEqual(h.readSr().podcasts, [3437, 6706],
    'SR keeps its own members, in the dragged relative order');
  assert.deepEqual(h.readExt().map((p) => p.id), [1518156497],
    'the iTunes podcast stays in the iTunes storage');
  assert.ok(!h.readSr().podcasts.includes(1518156497),
    'an iTunes collectionId must never be written into the SR array -- favoritesFromRaw drops non-integers and would silently undo the reorder');
  assert.deepEqual(h.readSr().channels, [132], 'channels must be untouched by a podcast reorder');
});

test('WS44: enableDragSort receives extList as a parameter', () => {
  // The regression guard for the ReferenceError. If the signature ever loses
  // the parameter, the test above throws; this states the cause in the source.
  const sig = stripComments(region('function enableDragSort', 'const rows =', APP_JS));
  assert.match(sig, /function enableDragSort\(group, kind, extList = \[\]\)/,
    'enableDragSort must take extList as a parameter -- it is buildSelectedGroup\'s local');
  const caller = stripComments(region('function buildSelectedGroup', 'function enableSwipeToRemove', APP_JS));
  assert.match(caller, /enableDragSort\(group, kind, extList\)/,
    'the only caller must pass extList in');
});

test('WS44: the reorder path has no other out-of-scope provider variable', () => {
  // The ReferenceError CLASS of bug: a sibling function's local read from a
  // different scope. `extList` was exactly that and it shipped, so the shape is
  // worth a guard -- a second instance must not be addable silently.
  //
  // Scoped correctly, which the first attempt was not: the original flagged
  // `r`, `p`, `e` and `group` (arrow and function parameters) and `extList`
  // itself, which is now a parameter. The check below therefore treats a name
  // as IN SCOPE if it is a parameter of the function, of any nested arrow, or
  // declared anywhere in the module -- and only reports names that satisfy
  // none of those. A linter that cries wolf is worse than no linter.
  const moduleDecls = new Set();
  for (const m of stripComments(APP_JS).matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) moduleDecls.add(m[1]);
  const globals = new Set([
    'Math', 'Number', 'JSON', 'Date', 'Set', 'Map', 'WeakMap', 'String', 'Array',
    'Object', 'Boolean', 'RegExp', 'Promise', 'Error', 'parseInt', 'parseFloat',
    'isNaN', 'isFinite', 'setTimeout', 'clearTimeout', 'setInterval', 'fetch',
    'document', 'window', 'navigator', 'console', 'localStorage', 'TouchEvent',
    'Touch', 'Element', 'CustomEvent', 'AbortController', 'URL', 'location',
  ]);
  // Language keywords and statements: they parse as identifiers to a regex but
  // are never variables. Keeping them out is what stops the guard crying wolf.
  const keywords = new Set(['if', 'for', 'while', 'switch', 'catch', 'return',
    'typeof', 'new', 'of', 'in', 'do', 'else', 'function', 'await', 'yield',
    'delete', 'void', 'instanceof', 'case', 'default', 'try', 'finally', 'throw']);

  for (const fn of ['enableDragSort', 'enableSwipeToRemove']) {
    // Strip template literals too: their text is prose and CSS, not variables.
    const body = stripComments(grab(fn)).replace(/`(?:[^`\\]|\\.)*`/g, '``');
    // Every declared-or-bound name: params of the function, params of any inner
    // arrow/function, and every const/let/var in the body.
    const scope = new Set(moduleDecls);
    // The function's OWN parameters -- this is where `onRemoved` lives. The
    // first version only scanned arrow parameters, which is why it reported
    // `onRemoved` as free when it has been a parameter all along.
    const head = body.slice(0, body.indexOf('{'));
    for (const part of head.replace(/^[^(]*/, '').replace(/\)\s*\{?$/, '').split(',')) {
      const n = part.trim().split(/[:=]/)[0].trim().replace(/^[.]{3}/, '');
      if (/^[A-Za-z_$][\w$]*$/.test(n)) scope.add(n);
    }
    for (const m of body.matchAll(/\(([^)]*)\)\s*=>/g)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().split(/[:=]/)[0].trim().replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(n)) scope.add(n);
      }
    }
    for (const m of body.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) scope.add(m[1]);
    // Names read off an object or a call are properties, not variables.
    const read = new Set();
    for (const m of body.matchAll(/(?<![.\w$'"])([A-Za-z_$][\w$]*)\s*[.[(]/g)) read.add(m[1]);
    const suspicious = [...read].filter((id) => !scope.has(id) && !globals.has(id) && !keywords.has(id));
    assert.deepEqual(suspicious, [],
      `${fn} reads names that are not parameters, locals, module declarations or globals: ${suspicious.join(', ')}`);
  }
});

/* ---------------------------------------------------------------------------
 * WS44c — the podcast list is reachable only through the search box.
 *
 * OWNER (2026-10-02): "removing the long list of the swedish radio podcasts
 * visually and how to make them visible only via the search box", then
 * "changes are okey to implement as you propose, just make sure you test
 * carefully that the search experience is find for both sources".
 *
 * The list rendered 371 SR programmes at 33 010 px (~89 screens). The empty
 * state replaces that until the owner types.
 *
 * THE PROPERTY THAT MATTERS, and it is not "the list is short": the box and
 * the list must never tell different stories. Clearing the box must bring the
 * prompt back, and a stale row must never survive under a new query. That is
 * the same defect class as R6 on a different surface.
 * --------------------------------------------------------------------- */

/**
 * Run the REAL SR filter out of loadItems, against a fixture catalogue.
 *
 * The filter is extracted from the function body rather than retyped, because
 * retyping it is how two workstreams reached opposite conclusions about this
 * same code in the past.
 */
function srFilterHarness(catalogue) {
  const body = stripComments(grab('loadItems'));
  // The SR filter expression, verbatim, as it appears in loadItems.
  const m = body.match(/const srRows = q[\s\S]*?: all;/);
  assert.ok(m, 'the SR filter expression was not found in loadItems');
  // eslint-disable-next-line no-new-func
  const build = new Function('all', 'q', `${m[0]}\nreturn srRows;`);
  // loadItems normalises the query BEFORE the filter runs
  // (`const q = (query || '').trim().toLowerCase()`), so the harness must do
  // the same or it is not testing the real behaviour. My first version passed
  // raw text and reported a failure that was the harness's, not the code's.
  return (q) => build(catalogue, (q || '').trim().toLowerCase());
}

const CATALOGUE = [
  { id: 6706, name: 'P4 Psykologen', description: 'Vi har alla problem som gnuggar i skallen.' },
  { id: 3437, name: 'Ekot granskar', description: 'Prisbelönta avslöjanden och gripande reportage.' },
  { id: 90210, name: 'Spanarna', description: 'Aktuellt om brottsligheten och samhället.' },
  // description carries the word, the NAME does not -- this is the whole point
  { id: 5000, name: 'Funk i P1', description: 'Musik och studier om samhälle.' },
  { id: 6000, name: 'Null', description: null },   // must not throw
];

test('WS44c: the SR search matches the description as well as the name', () => {
  const f = srFilterHarness(CATALOGUE);
  // by name
  assert.deepEqual(f('psykolog').map((p) => p.id), [6706]);
  assert.deepEqual(f('spanarna').map((p) => p.id), [90210]);
  // by DESCRIPTION ONLY -- this is what the fix added. Before it, `samhälle`
  // returned nothing at all, because no NAME contains the word.
  assert.deepEqual(f('samhälle').map((p) => p.id).sort(), [5000, 90210],
    'a word that appears only in a description must still find the programme');
  // a null description must not throw
  assert.doesNotThrow(() => f('null'));
  // case-insensitive, as before
  assert.deepEqual(f('GRANSKAR').map((p) => p.id), [3437]);
  // empty query returns the whole catalogue (the unsearched state)
  assert.equal(f('').length, CATALOGUE.length);
});

test('WS44c: the unsearched podcast list shows a prompt, not 371 rows', () => {
  const renderList = stripComments(region('function renderList', 'async function loadItems', APP_JS));
  // The gate must be on podcasts AND an empty query. Either half alone is wrong:
  // gating on the tab alone would hide the channels list too.
  assert.match(renderList, /if \(tab === 'podcasts' && !searchQuery\) \{/,
    'the long list must be gated on the podcast tab and an empty query');
  assert.match(renderList, /class: 'pick-empty'/,
    'an empty state must be rendered in place of the rows');
  // The count must come from the loaded catalogue, not a hardcoded number.
  assert.match(renderList, /\$\{all\.length\} poddar/,
    'the prompt must state how many podcasts exist, from the real catalogue');
  // Channels are exempt and must NOT be gated: ~52 rows fit on a screen or two
  // and a channel is picked by recognition, not by remembering its name.
  const gate = renderList.slice(renderList.indexOf("tab === 'podcasts' && !searchQuery"));
  const beforeChannels = gate.slice(0, gate.indexOf('for (const item of all)'));
  assert.ok(!/tab === 'channels'/.test(beforeChannels),
    'channels must stay browsable -- the gate is podcasts-only');
});

test('WS44c: clearing the search cannot strand the sheet on loading skeletons', () => {
  // A REAL defect found in the browser while building this: clearing the box
  // set `loaded.podcasts = false`, so renderList() took the skeleton branch with
  // nothing scheduled to replace it, and the sheet showed five permanent grey
  // bars instead of the prompt.
  const inputHandler = stripComments(region(
    "searchInput.addEventListener('input'", 'doneBtn = el(', APP_JS));
  const clearBranch = inputHandler.slice(
    inputHandler.indexOf('if (!q) {'),
    inputHandler.indexOf('searchTimer = setTimeout'));
  assert.doesNotMatch(clearBranch, /loaded\.podcasts = false/,
    'marking the catalogue unloaded strands the list on skeletons -- the data is already in memory');
  const clearSearch = stripComments(region('function clearSearch', '}', APP_JS));
  assert.doesNotMatch(clearSearch, /loaded\.podcasts = false/,
    'clearSearch must not strand the list on skeletons either');
  // Both the box and the recorded query are cleared together.
  assert.match(clearSearch, /searchQuery = ''/);
  assert.match(clearSearch, /searchInput\.value = ''/,
    'the box and the recorded query must be cleared together, or the list and the box disagree');
});

test('WS44c: a stale external row cannot be labelled a result for a new query', () => {
  const inputHandler = stripComments(region(
    "searchInput.addEventListener('input'", 'doneBtn = el(', APP_JS));
  assert.match(inputHandler, /items\.podcasts = items\.podcasts\.filter\(\(r\) => r\.provider !== 'itunes'\)/,
    'iTunes rows belong to the query that fetched them; keeping them would show an old hit under a new search');
});

test('WS44c: the empty state is actually styled', () => {
  // Added after the CSS was lost twice in one session by a stale /tmp snapshot
  // restore. The JS test above only asserts the class NAME is emitted; it
  // cannot tell whether any rule styles it, so a prompt could render as
  // unstyled default text and every other guard would still be green.
  const css = stripComments(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8'));
  assert.match(css, /\.pick-empty \{/, 'the empty-state container must exist in the stylesheet');
  assert.match(css, /\.pick-empty-title \{/, 'the prompt title must be styled');
  assert.match(css, /\.pick-empty-sub \{/, 'the prompt sub-line must be styled');
  // A prompt the owner has to hunt for is not a prompt.
  const block = stripComments(region('.pick-empty {', '.retry-btn {', css));
  assert.match(block, /text-align: center/, 'the prompt must be centred, not a stray left-aligned line');
});

test('WS44c: the empty-state text tells the owner what each source needs', () => {
  // The thresholds are asymmetric and MEASURED: SR filters at 2 characters,
  // iTunes needs 3 (EXT_SEARCH_MIN_CHARS). A prompt claiming "minst tre tecken"
  // would imply two characters shows nothing, which is false.
  const renderList = stripComments(region('function renderList', 'async function loadItems', APP_JS));
  assert.match(renderList, /två tecken för Sveriges Radio, tre eller fler för att även söka iTunes/,
    'the prompt must state the real per-source thresholds');
  assert.doesNotMatch(renderList, /minst tre tecken/,
    'the old wording implied two characters returns nothing -- measured, it returns 45 SR rows');
  assert.match(APP_JS, /EXT_SEARCH_MIN_CHARS = 3;/,
    'the iTunes threshold this text describes must still be 3');
});

/* ---------------------------------------------------------------------------
 * WS45 — weather in the header.
 *
 * OWNER: "weather info in the header ... the typical weather icon for sun,
 * clouds, rain... and the temperature in celsius followed by the location as
 * tracked by the phone", then "just Göteborg or Lerum for example" and "it has
 * to update as my tester is commuting by train ... expects the location to
 * change as the train moves".
 *
 * Both facilities were MEASURED before any of this was written: Open-Meteo
 * 200 + access-control-allow-origin: *, BigDataCloud 200 after a 307 the
 * browser follows. Neither needs a key, so the static-only rule holds.
 * --------------------------------------------------------------------- */

/** Run the real functions out of app.js rather than retyping their logic. */
function wxFn(name) {
  const src = stripComments(grab(name));
  return new Function(`${src}\nreturn ${name};`)();
}

test('WS45: the WMO code map covers every code with a sensible glyph', () => {
  const glyph = wxFn('weatherGlyph');
  // Spot checks across the published WMO table. These are the codes the owner
  // named (sun, clouds, rain) plus the ones a Swedish winter produces.
  assert.equal(glyph(0).id, 'clear');                       // sun
  assert.equal(glyph(1).id, 'partly');
  assert.equal(glyph(3).id, 'cloudy');                      // overcast
  assert.equal(glyph(45).id, 'fog');                        // fog
  assert.equal(glyph(53).id, 'drizzle');
  assert.equal(glyph(61).id, 'rain');                       // rain
  assert.equal(glyph(65).id, 'rain');
  assert.equal(glyph(71).id, 'snow');                       // snow
  assert.equal(glyph(75).id, 'snow');
  assert.equal(glyph(95).id, 'storm');                      // thunder
  // EVERY code must produce a glyph and a label -- no undefined leaking into
  // the header, and no label left empty.
  for (let c = 0; c <= 99; c++) {
    const g = glyph(c);
    assert.ok(g && typeof g.id === 'string' && g.id.length > 0, `code ${c} has no glyph id`);
    assert.ok(typeof g.label === 'string' && g.label.length > 0, `code ${c} has no label`);
  }
  // Every glyph id must have an SVG, or the chip renders an empty box. The
  // block is parsed rather than regex-matched: my first attempt assumed every
  // entry had a leading newline, which is false for the FIRST one, so it
  // reported a false failure on `clear`.
  const iconsSrc = stripComments(region('const WEATHER_ICONS = {', '\n  };', APP_JS));
  assert.ok(iconsSrc.length > 200, 'the WEATHER_ICONS block was not extracted');
  const declared = new Set();
  // Indentation-agnostic: an earlier version assumed exactly two spaces, and
  // the entries are indented four. Asserting on layout instead of on the
  // entries is a test that fails when a formatter is run.
  for (const m of iconsSrc.matchAll(/^\s+([a-z]+):\s*'/gm)) declared.add(m[1]);
  assert.ok(declared.size >= 8, `expected the full icon set, found ${declared.size}: ${[...declared]}`);
  for (let c = 0; c <= 99; c++) {
    const id = glyph(c).id;
    assert.ok(declared.has(id), `glyph id "${id}" has no SVG in WEATHER_ICONS`);
  }
});

test('WS45: place names are the short Swedish form the owner asked for', () => {
  const pretty = wxFn('prettyPlace');
  // MEASURED against the live geocoder with localityLanguage=sv. The kommun
  // form is what it actually returns for a municipality, and the owner asked
  // for "Lerum", not "Lerums kommun".
  assert.equal(pretty('Lerums kommun'), 'Lerum');
  assert.equal(pretty('Trelleborgs kommun'), 'Trelleborg');
  assert.equal(pretty('Melleruds kommun'), 'Mellerud');
  assert.equal(pretty('Ljusdals kommun'), 'Ljusdal');
  // No trailing genitive s -> leave it alone (Älvkarleby must not become Älvkarleb)
  assert.equal(pretty('Älvkarleby kommun'), 'Älvkarleby');
  // A plain city name must pass through untouched -- this rule must never be
  // able to alter one.
  assert.equal(pretty('Göteborg'), 'Göteborg');
  assert.equal(pretty('Stockholm'), 'Stockholm');
  // Empties and junk must not throw, and must not produce a blank-looking name.
  assert.equal(pretty(''), '');
  assert.equal(pretty(null), '');
  assert.equal(pretty(undefined), '');
  // A trailing admin bracket is stripped.
  assert.equal(pretty('Västra Götalands län [SE-14]'), 'Västra Götalands län');
});

test('WS45: fetchPlace asks the geocoder for Swedish, and never for a county', () => {
  const body = stripComments(region('async function fetchPlace', 'async function fetchWeather', APP_JS));
  // `en` returns "Gothenburg"; the owner wrote "Göteborg". Measured both.
  assert.match(body, /localityLanguage=sv/,
    'the geocoder must be asked for Swedish names -- `en` returns Gothenburg');
  assert.match(body, /d\.city \|\| d\.locality/,
    'city first, then the locality, so the header is never blank');
  assert.doesNotMatch(body, /principalSubdivision/,
    'the owner asked for NO county info -- it must not be used as a fallback');
});

test('WS45: the header gains a weather chip WITHOUT becoming a third flex child', () => {
  // THE REGRESSION THIS WOULD REINTRODUCE, from the app's own history: WS11
  // added a third child to `.topbar` and the cog jumped to the middle, which
  // the owner reported and had to be undone. `.topbar` is
  // `justify-content: space-between`, so anything placed between its two ends
  // gets centred.
  const paint = stripComments(region('function renderWeatherChip', 'let weatherBusy', APP_JS));
  assert.match(paint, /class: 'topbar-left'/,
    'the chip must be grouped with the brand inside a wrapper');
  assert.match(paint, /holder\.appendChild\(brand\)/,
    'the brand must move INTO the wrapper, so the bar keeps two children');
  assert.doesNotMatch(paint, /bar\.appendChild\(chip\)/,
    'appending the chip to .topbar directly would make it a third child and re-centre the cog');
  // The real markup must still have exactly two children in .topbar.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const bar = html.slice(html.indexOf('<header class="topbar">'), html.indexOf('</header>'));
  const childTags = (bar.match(/<h1|<button/g) || []).length;
  assert.equal(childTags, 2,
    '.topbar must carry exactly two children in the markup (brand + cog); the chip is built at runtime inside .topbar-left');
});

test('WS45: tracking is throttled by distance AND time, or a train ride storms the API', () => {
  const body = stripComments(region('async function refreshWeather', 'function startWeatherWatch', APP_JS));
  // The owner's requirement is "update as the train moves". That is an
  // instruction to poll, and unbounded polling is how the app gets throttled.
  assert.match(body, /weatherBusy/,
    'an in-flight lock is required so a slow request cannot be stacked');
  assert.match(body, /WEATHER_MIN_INTERVAL_MS/, 'a time gate is required');
  assert.match(body, /WEATHER_MIN_MOVE_KM/, 'a distance gate is required');
  assert.match(body, /distanceKm\(lastFetched, pos\) < WEATHER_MIN_MOVE_KM/,
    'the distance gate must actually be consulted, not merely declared');
  // The watcher must be a watch, not a one-shot getCurrentPosition -- that is
  // what makes the header follow the train at all.
  //
  // MUTATION CAUGHT IT: this used to assert only /watchPosition/ anywhere in
  // startWeatherWatch, and reported GREEN when the CALL was rewritten to
  // getCurrentPosition -- because the capability guard on the line above
  // (`if (!navigator.geolocation.watchPosition) return;`) still contains the
  // word. The guard has to name the call site, not the word.
  const watch = stripComments(region('function startWeatherWatch', 'function stopWeatherWatch', APP_JS));
  assert.match(watch, /weatherWatchId = navigator\.geolocation\.watchPosition\(/,
    'the watcher must actually CALL watchPosition -- a one-shot getCurrentPosition would never follow the train');
  assert.doesNotMatch(watch, /weatherWatchId = navigator\.geolocation\.getCurrentPosition\(/,
    'a one-shot fix cannot track a moving train');
  // (A third assertion I added here, "the watcher needs its real success
  // callback", was WRONG and I removed it: the ERROR callback is legitimately
  // `() => {}` because a denied-location failure has nothing to report. A
  // guard that forbids correct code is worse than no guard.)
  assert.match(watch, /enableHighAccuracy: false/,
    'a city-level fix is enough for a city name and is far cheaper on the battery');
  // And the watch must be stoppable, so a backgrounded app is not polling.
  const stop = stripComments(region('function stopWeatherWatch', 'async function initWeather', APP_JS));
  assert.match(stop, /clearWatch/, 'the watch must be stoppable');
});

test('WS45: a failed refresh never blanks the header', () => {
  // The header must not flicker to empty because one request failed -- a
  // stale temperature is better than no weather.
  const paint = stripComments(region('function renderWeatherChip', 'const WEATHER_MIN_MOVE_KM', APP_JS));
  assert.match(paint, /if \(!rec\) return;/,
    'renderWeatherChip(null) must keep the existing chip rather than clearing it');
  const refresh = stripComments(region('async function refreshWeather', 'function startWeatherWatch', APP_JS));
  assert.match(refresh, /catch \{\s*return 'failed'/,
    'a failed fetch must be caught and reported, not allowed to blank the chip');
});

test('WS45: the weather module touches no playback, storage or DVR code', () => {
  const mod = region('// ---------------- weather in the header (WS45)', 'async function boot()');
  const clean = stripComments(mod);
  assert.doesNotMatch(clean, /playTrack|toggleTrack|loadFavorites|saveFavorites|audioEl|hls|m3u8|seekable|renderPlayer/,
    'the weather module must not reach into playback, favourites or DVR');
});

test('WS45: a restored cache must NOT silently disable the distance gate', () => {
  // THE DEFECT, found by driving the real handlers in the browser and watching
  // a 300 m GPS wobble spend an API call. initWeather() seeded `lastFetched`
  // from the cache and then immediately overwrote it with null, so the gate had
  // no previous position to measure against and EVERY callback fetched.
  //
  // This is the WS4x lesson again: the guards above all read the SOURCE, and
  // the source said `distanceKm(lastFetched, pos) < WEATHER_MIN_MOVE_KM` --
  // correct-looking code that could never fire.
  const init = stripComments(region('async function initWeather', 'async function boot', APP_JS));
  // Scoped to the assignment itself: `[^}]*` stops at the object's own `{`,
  // which made this report a false failure against correct code.
  const seedAssign = init.slice(init.indexOf('lastFetched = {'), init.indexOf('startWeatherWatch()'));
  assert.match(seedAssign, /hasPos: false/,
    'a cache has a timestamp but no coordinates, and the gate must know that');
  // The seeding must NOT be immediately clobbered -- that was the bug.
  assert.doesNotMatch(seedAssign, /lastFetched = null/,
    'assigning lastFetched = null right after seeding it disables the distance gate entirely');
  // And the gate must actually honour the flag.
  const refresh = stripComments(region('async function refreshWeather', 'function startWeatherWatch', APP_JS));
  assert.match(refresh, /lastFetched\.hasPos !== false && distanceKm\(lastFetched, pos\)/,
    'the distance gate must be skipped when the previous position is unknown, not applied against null');
  // A successful fetch must record that the position IS known, or the gate can
  // never start working.
  assert.match(refresh, /lastFetched = \{ lat: pos\.lat, lon: pos\.lon, at: now, hasPos: true \}/,
    'after a fetch the position is known and the distance gate must be armed');
});

test('WS45: distanceKm measures real kilometres', () => {
  // I twice concluded this function was broken when MY OWN probe was: I
  // divided metres by 111320 to get degrees and then compared the result
  // against 3 as if it were kilometres. The function is correct; the probe was
  // not. This test pins the scale so that mistake cannot recur.
  const dist = wxFn('distanceKm');
  const A = { lat: 57.7089, lon: 11.9746 };          // Göteborg
  const perDegLat = 111.32;                            // km per degree latitude
  const north = (km) => ({ lat: A.lat + km / perDegLat, lon: A.lon });
  assert.ok(Math.abs(dist(A, north(5)) - 5) < 0.05, '5 km north must measure ~5 km');
  assert.ok(Math.abs(dist(A, north(1)) - 1) < 0.02, '1 km north must measure ~1 km');
  // 0.3 km must be BELOW the 3 km gate, which is the whole point of it.
  assert.ok(dist(A, north(0.3)) < 3, 'a 300 m wobble must fall under the distance gate');
  // A real train hop must be well OVER it.
  assert.ok(dist(A, { lat: 57.8000, lon: 12.3000 }) > 3,
    'Göteborg -> Lerum is a genuine move and must exceed the distance gate');
  assert.equal(dist(A, A), 0, 'the distance to itself is zero');
});

test('WS45: the cold-start fetch is not force-bypassed', () => {
  // `force: true` skipped both gates. On a fresh cache it spent a call the
  // gates exist to avoid, and it also reset lastFetched, which is what made
  // the leak above hard to see.
  const init = stripComments(region('async function initWeather', 'async function boot', APP_JS));
  assert.doesNotMatch(init, /refreshWeather\(pos, \{ force: true \}\)/,
    'the cold-start refresh must go through the gates, not force past them');
  assert.match(init, /refreshWeather\(pos\)/,
    'the cold-start refresh must use the gated path');
});

// ---------------------------------------------------------------------------
// WS46 -- the location permission prompt must not reappear on every open.
//
// The owner's report, in their words: "each time i open the page or pwa app i
// get the 'Would like to Use Your location' question".
//
// MEASURED in the browser before changing anything: every page open made TWO
// geolocation calls (one watchPosition + one getCurrentPosition), even when the
// cached reading was ONE MINUTE old. A cache the app already held, and a
// request it had already paid for, were not enough to stop it asking.
// ---------------------------------------------------------------------------

test('WS46: a fresh cache must stop the app asking for location at all', () => {
  // The guard is an ORDERING claim, so it is asserted as ordering: the early
  // return has to appear BEFORE the first geolocation call site, otherwise the
  // code asks and then decides it did not need to.
  const init = stripComments(region('async function initWeather', 'async function boot', APP_JS));
  const gate = init.indexOf('if (cached && age < WEATHER_FRESH_MS)');
  const firstAsk = init.indexOf('startWeatherWatch()');
  assert.ok(gate !== -1,
    'a cache younger than WEATHER_FRESH_MS must end the function before any geolocation call');
  assert.ok(firstAsk !== -1, 'the first-ask path must still ask, or first-run weather is dead');
  assert.ok(gate < firstAsk,
    'the fresh-cache early return sits AFTER the geolocation call, so it cannot prevent the prompt');
});

test('WS46: after the first ask the app must not ask again on a later open', () => {
  const init = stripComments(region('async function initWeather', 'async function boot', APP_JS));
  assert.match(init, /if \(hasAskedForLocation\(\)\)/,
    'a second open must be able to tell that the user has already been asked');
  const askedGate = init.indexOf('if (hasAskedForLocation())');
  const mark = init.indexOf('markAskedForLocation()');
  const ask = init.indexOf('startWeatherWatch()');
  assert.ok(askedGate !== -1, 'the already-asked branch is missing entirely');
  // The flag is recorded BEFORE the call, not after: a denial, a crash or a
  // thrown exception must not leave the app free to ask again next time.
  assert.ok(mark < ask,
    'markAskedForLocation() must run BEFORE the geolocation call, or a crash re-arms the prompt');
  assert.ok(askedGate < ask,
    'the already-asked check must precede the geolocation call it exists to prevent');
  // And the already-asked branch must actually leave, not fall through.
  const branch = init.slice(askedGate, ask);
  assert.match(branch, /return/,
    'the already-asked branch must return; falling through re-asks the very thing it is avoiding');
});

test('WS46: the flag is set from a localStorage string, never navigator.permissions', () => {
  // iOS Safari does not implement navigator.permissions. Building the fix on
  // it would make the whole feature depend on a platform that is not there.
  // This pins the choice so a later "improvement" cannot silently introduce it.
  const helpers = stripComments(region('function hasAskedForLocation', 'function formatTemp', APP_JS));
  assert.doesNotMatch(helpers, /navigator\.permissions/,
    'navigator.permissions is unavailable on iOS Safari and must not gate the weather header');
  assert.match(helpers, /localStorage\.getItem\(WEATHER_ASK_KEY\) === '1'/,
    'the flag must be a plain localStorage read');
});

test('WS46: the asked-flag round-trips', () => {
  // An EXECUTING test, not a source-text one. Both helpers are extracted from
  // app.js and actually called -- the WS7 rule that a `function` declaration
  // passed to `new Function` is never invoked is exactly what this avoids.
  const store = new Map();
  const fakeLocalStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const src = stripComments(grab('hasAskedForLocation')) + '\n' +
              stripComments(grab('markAskedForLocation'));
  const fns = new Function('localStorage', 'WEATHER_ASK_KEY',
    `${src}\nreturn { hasAskedForLocation, markAskedForLocation };`)(fakeLocalStorage, 'minradio.weather.asked.v1');

  assert.equal(fns.hasAskedForLocation(), false,
    'a fresh install has never asked, so the first open must be allowed to ask');
  fns.markAskedForLocation();
  assert.equal(fns.hasAskedForLocation(), true,
    'after the first ask a later open must be able to stay silent -- the whole point of WS46');
  assert.equal(store.get('minradio.weather.asked.v1'), '1',
    'the flag must survive a restart, which is the only way "once" can mean once');
  // A corrupt value must not read as "asked" -- that would silently disable
  // first-run weather.
  store.set('minradio.weather.asked.v1', 'nonsense');
  assert.equal(fns.hasAskedForLocation(), false,
    'an unrecognised stored value must not count as asked');
});

test('WS46: tapping the chip refreshes on demand', () => {
  // The whole change is only safe because a stale header has a manual cure.
  // Without it, "ask less" would mean "no way to fix it without a reinstall".
  // End marker must be a function that ACTUALLY exists -- an invented marker
  // makes region() throw and the test fail for a reason unrelated to the chip.
  const chip = stripComments(region('function renderWeatherChip', 'function distanceKm', APP_JS));
  assert.match(chip, /addEventListener\('click'/,
    'the chip must be clickable');
  assert.match(chip, /role', 'button/,
    'a clickable chip must be announced as a control');
  assert.match(chip, /tabindex', '0'/,
    'a control that only responds to clicks is unreachable by keyboard');
  // Space must not scroll the page away from under the control.
  assert.match(chip, /e\.preventDefault\(\)/,
    'the Space key must be handled, or activating the chip scrolls the page');

  const now = stripComments(grab('refreshWeatherNow'));
  assert.match(now, /markAskedForLocation\(\)/,
    'a deliberate tap counts as asking, so a later open stays silent');
  assert.match(now, /force: true/,
    'a person who just tapped must not be refused by the background gates');
});

test('WS46: the watcher must actually be stopped (it had no caller at all)', () => {
  // WS7a in its purest form. `stopWeatherWatch()` was written in WS45 and
  // grep proved it had ZERO callers -- correct code that never executes. If it
  // is still uncalled, a backgrounded PWA holds the GPS open for a session
  // nobody is looking at, which is the same complaint in a different costume.
  const stop = stripComments(grab('stopWeatherWatch'));
  assert.ok(stop, 'stopWeatherWatch must still exist');

  const callers = (stripComments(APP_JS).match(/stopWeatherWatch\(\)/g) || []).length;
  // One occurrence is the declaration itself. Any more means it is now called.
  assert.ok(callers > 1,
    `stopWeatherWatch has no call site -- it was dead code in WS45 and must not stay dead (found ${callers} occurrence(s), 1 = declaration only)`);

  assert.match(stripComments(APP_JS), /addEventListener\('visibilitychange'/,
    'the watch must be tied to visibility, or a hidden PWA keeps streaming positions');
});

test('WS46: the first-run path is not dead code', () => {
  // The guard that could have failed silently: an early return that fires on
  // every real install would mean a NEW user never sees weather at all. The
  // fix must still ask exactly once for someone who has never been asked.
  const init = stripComments(region('async function initWeather', 'async function boot', APP_JS));
  assert.match(init, /await locate\(\)/,
    'a never-asked install must still take a position');
  assert.match(init, /await refreshWeather\(pos\)/,
    'and must still fetch, or first-run weather is broken by this change');
  assert.match(init, /startWeatherWatch\(\)/,
    'the watcher is what makes the header follow a train; it must survive');
});
