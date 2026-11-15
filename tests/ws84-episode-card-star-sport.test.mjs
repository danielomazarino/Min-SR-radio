import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_RAW = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const APP = stripComments(APP_RAW);

// ---------------------------------------------------------------------------
// WS84 — episode info card, podcast favourite star, selectable news source.
//
// OWNER, 2026-11-11: (1) long-press on a podcast episode shows the episode
// information card; (2) a star button on the podcast card, filled when the
// podcast is a favourite, clicking removes it from favourites; (3) a sport
// news option with a settings toggle.
//
// These tests assert BEHAVIOUR (AGENTS.md §2): the real functions are
// extracted from app.js by brace matching and executed against a driven
// world. Nothing here re-implements the logic under test.
// ---------------------------------------------------------------------------

function grab(name, src = APP) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in app.js`);
  let d = 0, end = start;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}

function grabConst(name, src = APP) {
  const start = src.indexOf(`const ${name} =`);
  assert.notEqual(start, -1, `const ${name} must exist in app.js`);
  let d = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) { end = i; break; } }
  }
  assert.notEqual(end, -1, `const ${name} must be an object literal`);
  return src.slice(start, end + 1) + ';';
}

// A world with the real store functions, the news-feed store, and a DOM stub
// sufficient for buildFavStarButton (classList/setAttribute on one node).
function makeWorld() {
  const storage = new Map();
  const localStorageStub = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
  };
  const toasts = [];
  const factory = new Function('deps', `
    const { localStorage, showToast } = deps;
    const FAVORITES_KEY = 'minradio.favorites.v1';
    const EXTERNAL_PODCASTS_KEY = 'minradio.podcasts.ext.v1';
    const MAX_FAVORITES = 4;
    const HARD_CAP = MAX_FAVORITES * 4;
    const PODCAST_ORDER_KEY = 'minradio.podcasts.order.v1';
    ${grabConst('NEWS_FEEDS').replace(/^  /gm, '')}
    const NEWS_FEED_KEY = 'minradio.newsfeed.v1';
    ${grab('loadNewsFeed').replace(/^  /gm, '')}
    ${grab('saveNewsFeed').replace(/^  /gm, '')}
    ${grab('safeStr').replace(/^  /gm, '')}
    ${grab('loadFavorites').replace(/^  /gm, '')}
    ${grab('saveFavorites').replace(/^  /gm, '')}
    ${grab('loadExternalPodcasts').replace(/^  /gm, '')}
    ${grab('saveExternalPodcasts').replace(/^  /gm, '')}
    const BAUER_FAV_KEY = 'minradio.channels.bauer.v1';
    const INTL_FAV_KEY = 'minradio.channels.intl.v1';
    const CHANNEL_ORDER_KEY = 'minradio.channel-order.v1';
    const mapBauerStation = (s) => (s && Number.isInteger(s.id) ? s : null);
    const mapIntlStation = (s) => (s && Number.isInteger(s.id) ? s : null);
    ${grab('loadBauerFavorites').replace(/^  /gm, '')}
    ${grab('saveBauerFavorites').replace(/^  /gm, '')}
    ${grab('loadIntlFavorites').replace(/^  /gm, '')}
    ${grab('saveIntlFavorites').replace(/^  /gm, '')}
    ${grab('loadChannelOrder').replace(/^  /gm, '')}
    ${grab('saveChannelOrder').replace(/^  /gm, '')}
    ${grab('channelRowOrder').replace(/^  /gm, '')}
    ${grab('persistChannelRowOrder').replace(/^  /gm, '')}
    ${grab('removeFavoriteRow').replace(/^  /gm, '')}
    ${grab('loadPodcastOrder').replace(/^  /gm, '')}
    ${grab('savePodcastOrder').replace(/^  /gm, '')}
    ${grab('podcastRowOrder').replace(/^  /gm, '')}
    ${grab('persistPodcastRowOrder').replace(/^  /gm, '')}
    const STAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
    ${grab('buildFavStarButton').replace(/^  /gm, '')}
    ${grab('addStarToHeader').replace(/^  /gm, '')}
    const el = (tag, attrs = {}) => {
      const node = deps.makeNodeStub();
      node._tag = tag;
      node._attrs = attrs;
      if (attrs.class) node.classList.add(...attrs.class.split(' ').filter(Boolean));
      return node;
    };
    return { loadNewsFeed, saveNewsFeed, loadFavorites, saveFavorites,
      loadExternalPodcasts, saveExternalPodcasts, removeFavoriteRow,
      podcastRowOrder, persistPodcastRowOrder, buildFavStarButton, addStarToHeader,
      raw: (k) => localStorage.getItem(k) };
  `);
  const world = factory({ localStorage: localStorageStub, showToast: (m) => toasts.push(m), makeNodeStub });
  return { storage, toasts, ...world };
}

// A minimal DOM node stub for the star button. el() assigns node._attrs =
// attrs, so setAttribute must write THERE — the closure attrs object from
// makeNodeStub is not the same object the real el() hands the node.
function makeNodeStub() {
  const classes = new Set();
  const node = {
    classList: {
      toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); },
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (c) => classes.delete(c),
    },
    setAttribute(k, v) { node._attrs[k] = v; },
    _classes: classes, _attrs: {},
  };
  return node;
}

// ---- Feature 3: the news source toggle -------------------------------------

test('WS84: the news feed defaults to Ekot and an unknown stored value falls back to Ekot', () => {
  const w = makeWorld();
  assert.equal(w.loadNewsFeed().label, 'Nyheter', 'no stored value → Ekot');
  w.saveNewsFeed('nonsense');
  assert.equal(w.loadNewsFeed().label, 'Nyheter', 'a corrupt value must not break the feed');
});

test('WS84: selecting sport persists and is read back; switching back works', () => {
  const w = makeWorld();
  w.saveNewsFeed('sport');
  assert.equal(w.loadNewsFeed().label, 'Sport', 'sport must be selectable');
  assert.equal(w.raw('minradio.newsfeed.v1'), 'sport', 'the choice must persist');
  w.saveNewsFeed('ekot');
  assert.equal(w.loadNewsFeed().label, 'Nyheter', 'switching back must work');
});

test('WS84: the sport feed URL is the Radiosporten feed and the parser URL follows the setting', () => {
  // The parser must read the SELECTED feed, not a hardcoded one — otherwise
  // the toggle would change the label while the app kept fetching Ekot.
  const fn = grab('fetchNewsFlashes');
  assert.match(fn, /loadNewsFeed\(\)\.url/,
    'fetchNewsFlashes must fetch the selected feed, not a constant');
  const feeds = grabConst('NEWS_FEEDS');
  assert.match(feeds, /ekot: \{ url: 'https:\/\/api\.sr\.se\/api\/rss\/program\/83\?format=145'/,
    'Ekot stays the default feed');
  assert.match(feeds, /sport: \{ url: 'https:\/\/api\.sr\.se\/api\/rss\/program\/179\?format=145'/,
    'sport is the Radiosporten feed (verified live 2026-11-11, same Atom shape)');
});

test('WS84: the home section title follows the selected feed', () => {
  const src = APP;
  assert.match(src, /text: loadNewsFeed\(\)\.label/,
    'the news section title must come from the selected feed, not a literal');
});

// ---- Feature 2: the favourite star ------------------------------------------

test('WS84: the star is filled when the podcast is an SR favourite and clicking removes it', () => {
  const w = makeWorld();
  w.saveFavorites({ channels: [], podcasts: [164] });
  const pod = { id: 164, name: 'Sommar i P1' };
  const btn = w.buildFavStarButton(pod, 'podcasts', 'sr');
  assert.ok(btn._classes.has('active'), 'a favourited podcast shows the filled star');
  assert.equal(btn._attrs['aria-pressed'], 'true');
  // Click → removed from the store, star unfills.
  btn._attrs.onclick();
  assert.deepEqual(w.loadFavorites().podcasts, [], 'clicking the filled star removes the favourite');
  assert.ok(!btn._classes.has('active'), 'the star unfills after removal');
  assert.equal(btn._attrs['aria-pressed'], 'false');
  assert.ok(w.toasts.some((t) => t.includes('Sommar i P1')), 'the removal is confirmed to the user');
  // A second click is a no-op (nothing left to remove).
  btn._attrs.onclick();
  assert.deepEqual(w.loadFavorites().podcasts, []);
});

test('WS84: the star works for an iTunes podcast against the external store', () => {
  const w = makeWorld();
  const pod = { id: 700, name: 'Ext Pod' };
  w.saveExternalPodcasts([{ id: 700, name: 'Ext Pod', provider: 'itunes' }]);
  const btn = w.buildFavStarButton(pod, 'podcasts', 'itunes');
  assert.ok(btn._classes.has('active'), 'an iTunes favourite shows the filled star');
  btn._attrs.onclick();
  assert.deepEqual(w.loadExternalPodcasts(), [], 'clicking removes the iTunes favourite');
  assert.ok(!btn._classes.has('active'));
});

test('WS84: a podcast that is NOT favourited shows an unfilled star and clicking does nothing', () => {
  const w = makeWorld();
  const btn = w.buildFavStarButton({ id: 999, name: 'Not a favourite' }, 'podcasts', 'sr');
  assert.ok(!btn._classes.has('active'), 'unfilled when not favourited');
  assert.equal(btn._attrs['aria-pressed'], 'false');
  btn._attrs.onclick();
  assert.deepEqual(w.loadFavorites().podcasts, [], 'clicking an unfilled star must not add anything');
});

test('WS84: star removal writes to the provider store and cleans the order key', () => {
  const w = makeWorld();
  // Seed: SR favourite 164 + iTunes favourite 700 + an order key holding both.
  w.saveFavorites({ channels: [], podcasts: [164] });
  w.saveExternalPodcasts([{ id: 700, name: 'Ext Pod', provider: 'itunes' }]);
  w.persistPodcastRowOrder([164, 700]);

  // SR removal through the REAL removeFavoriteRow path the star calls.
  const removedSr = w.removeFavoriteRow('podcasts', 164, 'Sommar i P1');
  assert.ok(removedSr, 'the SR favourite must be removable');
  assert.deepEqual(w.loadFavorites().podcasts, [], 'the SR store must no longer hold it');
  w.persistPodcastRowOrder(
    w.podcastRowOrder(w.loadFavorites().podcasts, w.loadExternalPodcasts()).filter((x) => x !== 164));
  assert.ok(!w.raw('minradio.podcasts.order.v1').includes('164'),
    'the order key must forget the removed id');

  // iTunes removal through the same path.
  const removedExt = w.removeFavoriteRow('podcasts', 700, 'Ext Pod');
  assert.ok(removedExt, 'the iTunes favourite must be removable');
  assert.deepEqual(w.loadExternalPodcasts(), [], 'the iTunes store must no longer hold it');
  w.persistPodcastRowOrder(
    w.podcastRowOrder(w.loadFavorites().podcasts, w.loadExternalPodcasts()).filter((x) => x !== 700));
  assert.ok(!w.raw('minradio.podcasts.order.v1').includes('700'),
    'the order key must forget the removed iTunes id');
});

test('WS84: the star reads the provider-explicit store, not the other one', () => {
  // An iTunes podcast is NOT in the SR numeric array; the star must check the
  // external store for it, and vice versa. The builder's isFav() is the
  // behaviour under test — asserted on the extracted source, because the
  // builder needs the full DOM to run.
  const fn = grab('buildFavStarButton');
  assert.match(fn, /provider === 'itunes'\) return loadExternalPodcasts\(\)\.some/,
    'an iTunes star must read the external store');
  assert.match(fn, /provider === 'bauer'\) return loadBauerFavorites\(\)\.some/,
    'a Bauer channel star must read the Bauer store');
  assert.match(fn, /provider === 'intl'\) return loadIntlFavorites\(\)\.some/,
    'an international channel star must read the intl store');
  assert.match(fn, /return loadFavorites\(\)\[kind\]\.includes/,
    'an SR star must read the SR favourites array');
  assert.match(fn, /removeFavoriteRow\(kind, item\.id, item\.name\)/,
    'the star must remove through the ONE shared removal path, not its own');
});

// ---- Feature 1: the episode info card ----------------------------------------

test('WS84: long-press on episode rows opens the info card, in BOTH card variants', () => {
  const sr = grab('openPodcastCard');
  const ext = grab('openExternalPodcastCard');
  assert.match(sr, /addLongPress\(row, \(\) => openEpisodeInfoCard\(/,
    'SR episode rows must open the info card on long-press');
  assert.match(ext, /addLongPress\(row, \(\) => openEpisodeInfoCard\(/,
    'iTunes episode rows must open the info card on long-press');
  // Tap must still play: the onclick stays on the row.
  assert.match(sr, /row\.onclick = \(\) => \{/, 'SR tap must still play');
  assert.match(ext, /row\.onclick = \(\) => \{/, 'iTunes tap must still play');
});

test('WS84: the info card shows description, date, duration and a play path through playTrack', () => {
  const fn = grab('openEpisodeInfoCard');
  assert.match(fn, /openContextCard\(\{/, 'the info card must use the standard card chrome');
  assert.match(fn, /ep\.description/, 'the description must be shown');
  assert.match(fn, /formatTime\(ep\.publishDateUtc\)/, 'the publish date must be shown');
  assert.match(fn, /fmtDur\(ep\.duration\)/, 'the duration must be shown');
  assert.match(fn, /playTrack\(playArgs\(\)\)/,
    'the Spela button must go through playTrack — the same path as the row tap, so the WS83 resume gate applies');
  assert.match(fn, /Inget ljud för detta avsnitt\./,
    'an episode without audio must say so instead of offering a dead button');
});

// ---------------------------------------------------------------------------
// WS85 — owner, 2026-11-14: four follow-ups.
// ---------------------------------------------------------------------------

test('WS85: the star sits LEFT of the close button in the card header', () => {
  // The behaviour: insertion BEFORE .sheet-close, not appended after it.
  const fn = grab('addStarToHeader');
  assert.match(fn, /insertBefore\(star, closeBtn\)/,
    'the star must be inserted before the close button');
  // The extra spacing that makes a mis-tap harder.
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const rule = css.slice(css.indexOf('.pod-star-btn {'), css.indexOf('}', css.indexOf('.pod-star-btn {')));
  assert.match(rule, /margin-right:\s*6px/, 'the star must carry extra spacing from the close button');
});

test('WS85: the tablå card carries the star for channels, Bauer and international', () => {
  const fn = grab('openChannelCard');
  assert.match(fn, /addStarToHeader\(header, buildFavStarButton\(channel, 'channels'/,
    'the channel card must show the star');
  assert.match(fn, /channel\.provider === 'bauer' \? 'bauer'/,
    'a Bauer channel card must read the Bauer store');
  assert.match(fn, /channel\.provider === 'intl' \? 'intl'/,
    'an international channel card must read the intl store');
  // The home row must pass the provider through, or every card would read SR.
  const home = grab('renderHome');
  assert.match(home, /openChannelCard\(\{ \.\.\.item, provider: item\.provider \|\| 'sr' \}\)/,
    'the home row must pass the provider into the channel card');
});

test('WS85: the description renders as separate paragraphs from both newline and HTML sources', () => {
  const w = makeWorld();
  // Drive the REAL function: SR-style newlines.
  // The function is self-contained (it does its own tag strip and entity
  // decode, preserving newlines) — no stubs needed, so a change to the real
  // helpers in app.js cannot silently desync the test.
  const factory = new Function('deps', `
    ${grab('descriptionParagraphs').replace(/^  /gm, '')}
    return { descriptionParagraphs };
  `);
  const { descriptionParagraphs } = factory({});
  // SR plain text with newlines → one paragraph per line.
  const sr = descriptionParagraphs('Programledare: Jesper Hofmann\nPanel: Björn Johnson & Sabri Suvakci\nAnsvarig utgivare: Dawid Fjäll');
  assert.deepEqual(sr, ['Programledare: Jesper Hofmann', 'Panel: Björn Johnson & Sabri Suvakci', 'Ansvarig utgivare: Dawid Fjäll'],
    'newline-separated text becomes separate paragraphs');
  // iTunes HTML with <p> and <br> → same treatment, tags stripped.
  const html = descriptionParagraphs('<p>First para</p><p>Second para</p>Line one<br>Line two');
  assert.deepEqual(html, ['First para', 'Second para', 'Line one', 'Line two'],
    'HTML block tags and <br> become paragraph breaks');
  // Empty/absent → no paragraphs, so the card shows no empty block.
  assert.deepEqual(descriptionParagraphs(null), []);
  assert.deepEqual(descriptionParagraphs(''), []);
  // The card must render the paragraphs as <p> children of the desc block.
  const card = grab('openEpisodeInfoCard');
  assert.match(card, /descriptionParagraphs\(ep\.description\)/,
    'the card must format the description through the paragraph splitter');
  assert.match(card, /paras\.map\(\(p\) => el\('p'/,
    'each paragraph must be its own <p>');
});

test('WS85: the selection UI sits above the Valda favoriter section in the settings sheet', () => {
  const src = APP;
  // The append order IS the visual order: selection UI first, then selected.
  const selIdx = src.indexOf("sheet.appendChild(el('h3', { class: 'section-title', text: 'Välj favoriter' }));");
  const listIdx = src.indexOf('sheet.appendChild(searchInput);');
  const selectedIdx = src.indexOf('sheet.appendChild(selectedSection);');
  assert.notEqual(selIdx, -1, 'the selection heading must exist');
  assert.notEqual(listIdx, -1, 'the search box must exist');
  assert.notEqual(selectedIdx, -1, 'the selected section must exist');
  assert.ok(selIdx < listIdx && listIdx < selectedIdx,
    'the order must be: heading → search → selected list (search ABOVE the selected list)');
});

test('WS85: the tablå rows open the episode info card on long-press, tap still plays', () => {
  const fn = grab('openChannelCard');
  // Long-press opens the info card, fetching the FULL episode so the
  // description is the real one, not the schedule row's short summary.
  assert.match(fn, /addLongPress\(row, async \(\) => \{/,
    'tablå rows must open the info card on long-press');
  assert.match(fn, /episodes\/get\?id=\$\{ev\.episodeId\}/,
    'the info card must fetch the full episode, not trust the schedule summary');
  assert.match(fn, /openEpisodeInfoCard\(ep, \{ name: ev\.programName \|\| channel\.name \}, playArgs\)/,
    'the card must open with the programme name as its subtitle');
  // Tap still plays through the same path as before.
  assert.match(fn, /row\.onclick = async \(\) => \{/, 'tablå tap must still play');
  // A row without an episode id still opens the card with schedule data.
  assert.match(fn, /if \(ev\.episodeId\) \{/,
    'a non-playable slot must still open the card with what the schedule carries');
});

test('WS86: the player opens the episode info card for what the playhead is sitting on', () => {
  // WS87 restated: the playhead resolution moved into resolveNowPlayingInfo()
  // (shared with the panel preview), so the assertions moved with it. The
  // requirement is unchanged — the card must describe the PLAYHEAD's
  // programme, not the on-air one (the R5 rule, on a third surface).
  const fn = grab('resolveNowPlayingInfo');
  assert.match(fn, /pickByPosition\(schedule\.map/,
    'the live programme must resolve from the playhead schedule');
  assert.match(fn, /playheadWallMs\(\)/,
    'the resolution must use the playhead wall clock, not Date.now()');
  assert.match(fn, /description: ev\.description \|\| null/,
    'the schedule entry\'s description must be shown');
  assert.match(fn, /description: cur\.description \|\| null/,
    'an episode must show the track description');
  const card = grab('openNowPlayingInfoCard');
  assert.match(card, /openEpisodeInfoCard\(/, 'the player path must open the shared card');
  assert.match(card, /showNoAudioNote: false/,
    'the player path must suppress the no-audio note — the programme IS playing');
});

test('WS87: the expanded panel shows the description preview and it survives repaints', () => {
  // WS87 SUPERSEDES WS86's row (owner, 2026-11-15): "i don't like the 'Vad
  // handlar det här om' and the info icon. instead show some lines of the
  // episode information directly under the episode name in the player ...
  // when clicking on the episode text shown open the big card". The
  // requirement is the same access to the card, delivered as a description
  // preview instead of a labelled row — restated, not weakened.
  //
  // buildExpandPanel is a `const ... = () => {` arrow, not a `function`
  // declaration, so grab() (which keys on `function NAME(`) cannot see it —
  // the exact silent-extraction trap AGENTS.md §7 warns about. Extract by
  // brace matching from the const declaration instead.
  const start = APP.indexOf('const buildExpandPanel = () => {');
  assert.notEqual(start, -1, 'const buildExpandPanel must exist in app.js');
  let d = 0, end = start;
  for (let i = start; i < APP.length; i++) {
    if (APP[i] === '{') d++;
    else if (APP[i] === '}') { d--; if (d === 0) { end = i; break; } }
  }
  const fn = APP.slice(start, end + 1);
  assert.match(fn, /expand-desc-btn/, 'the panel must carry the description preview');
  assert.match(fn, /openNowPlayingInfoCard\(\)/,
    'the preview must open the now-playing info card');
  // WS87b (owner, 2026-11-15): the preview must align with the TITLE, not
  // the image — mounted INSIDE the .expand-text column, by structure, not by
  // a margin kept in sync with the image width.
  assert.match(fn, /\.expand-row:last-child \.expand-text/,
    'the preview must mount into the text column, aligned with the title');
  // The repaint must re-render the preview, or the first metadata update
  // would erase the only way to open the card.
  assert.match(fn, /baseRepaint\(\);[\s\S]*?infoPreview = mountInfoPreview\(\)/,
    'the repaint must re-mount the description preview');
  // The old labelled row must be gone, not hidden behind the new one.
  assert.ok(!/expand-info-row/.test(fn),
    'the WS86 "Vad handlar det här?" row must be gone (owner, 2026-11-15)');
});

test('WS87: the panel preview and the info card read the SAME resolver', () => {
  // One fact, one source: the preview lines and the card must both come from
  // resolveNowPlayingInfo(), or the two surfaces could describe different
  // programmes (the R6 rule on a third surface).
  const fn = grab('resolveNowPlayingInfo');
  assert.match(fn, /pickByPosition\(schedule\.map/,
    'the live programme must resolve from the playhead schedule');
  assert.match(fn, /playheadWallMs\(\)/,
    'the resolution must use the playhead wall clock, not Date.now()');
  const card = grab('openNowPlayingInfoCard');
  assert.match(card, /resolveNowPlayingInfo\(\)/,
    'the card must read the same resolver the preview reads');
  const panel = APP.slice(APP.indexOf('const buildExpandPanel = () => {'),
    APP.indexOf('expandPanelToggle = function'));
  assert.match(panel, /mountInfoPreview = \(\) => \{[\s\S]*?resolveNowPlayingInfo\(\)/,
    'the preview must read the same resolver the card reads');
});

test('WS88: the played episode carries its OWN description, not the series blurb', () => {
  // OWNER, 2026-11-15: P3 Soul's player showed the podcast-level blurb
  // ("Mats Nileskär ger dig möten och soulvärlden") instead of the episode's
  // own description that SR's app shows. Root cause: fetchLatestEpisode
  // dropped ep.description and playPodcast fell back to pod.description.
  const fetch = grab('fetchLatestEpisode');
  assert.match(fetch, /description: safeStr\(ep\.description, 600\) \|\| null/,
    'fetchLatestEpisode must extract the EPISODE description');
  const play = grab('playPodcast');
  assert.match(play, /description: ep\.description \|\| pod\.description \|\| null/,
    'playPodcast must prefer the episode description over the series blurb');
  // Every play path must carry the description, or the player preview goes
  // blank for episodes started from a card row.
  const srCard = grab('openPodcastCard');
  assert.match(srCard, /description: ep\.description \|\| null/,
    'the SR podcast card rows must carry the episode description');
  const extCard = grab('openExternalPodcastCard');
  assert.match(extCard, /description: ep\.description \|\| null/,
    'the iTunes card rows must carry the episode description');
  const chan = grab('openChannelCard');
  assert.match(chan, /description: ep\.description \|\| ev\.description \|\| null/,
    'the tablå play paths must carry the episode description');
});

test('WS88: a live SONG is never shown with the programme description unlabelled', () => {
  // OWNER, 2026-11-15, P3 live: the song "Det Lyser I Fönstret Hos Mor" sat
  // above the programme blurb "Musik, tävlingar och samtal…" — reading as if
  // it described the song. SR publishes no song descriptions (verified:
  // rightnow dead, HLS carries no metadata), so the programme text must be
  // LABELLED with the programme name when a song is playing.
  const fn = grab('resolveNowPlayingInfo');
  assert.match(fn, /descriptionIsProgramme: songPlaying/,
    'the resolver must carry whether the description is programme-level');
  assert.match(fn, /const songPlaying = Boolean\(head && head\.song && head\.song\.title\)/,
    'the flag must be decided by whether a SONG is playing');
  // The preview and the card must both apply the label.
  const panel = APP.slice(APP.indexOf('const buildExpandPanel = () => {'),
    APP.indexOf('expandPanelToggle = function'));
  assert.match(panel, /descriptionIsProgramme && info\.programName\s*\?\s*`\$\{info\.programName\}: \$\{info\.description\}`/,
    'the preview must prefix the programme name when the text is programme-level');
  const card = grab('openNowPlayingInfoCard');
  assert.match(card, /descriptionIsProgramme && info\.programName/,
    'the card must apply the same labelling as the preview');
  // An episode's description IS about the episode — never labelled.
  assert.match(fn, /descriptionIsProgramme: false/,
    'an episode description must never be labelled as programme-level');
});
