/**
 * News audio: the per-item "Lyssna:" clip becomes playable.
 *
 * WHAT THE USER-VISIBLE FAILURE WAS
 * Every news row is a button whose accessible name promises one of two things:
 * "Spela nyhetssändning: <title>" (it will play) or "Öppna artikel: <title>"
 * (it will open the reader). fetchNewsFlashes() hardcoded `audioUrl: null`, so
 * EVERY row was permanently the second kind -- the app rendered a play-shaped
 * row for content it could not play, and the one piece of SR data that made
 * playback possible was thrown away.
 *
 * So the two properties that must hold, and would break if this regressed:
 *   1. a real feed entry with a clip id produces a Topsy resolver URL;
 *   2. an entry WITHOUT a usable clip id stays non-playable and still renders.
 * A test that only asserted (1) would pass if the code returned a URL for
 * EVERY row, including the ones that cannot play -- which is a worse bug than
 * the one it replaced.
 *
 * These tests EXECUTE the real extracted functions from app.js (AGENTS.md §7).
 * A canary counts invocations, because a harness that reports success without
 * running the code under test is worse than no harness at all.
 *
 * The DBID and the resolver shape are load-bearing facts measured against the
 * live feed on 2026-10-01, not guesses:
 *   - 20 of 20 Ekot entries carried a `Lyssna:` link with a numeric DBID;
 *   - `/topsy/ljudfil/{dbId}?publicationId={articleId}` returned 302 to a real
 *     .m4a for 20 of 20, with `access-control-allow-origin: *`.
 * If SR changes the feed, these tests are the thing that should go red.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const q = src[i];
      out += src[i];
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}

// Brace-matched extraction. Handles `function NAME(`.
function grab(name) {
  const src = stripComments(APP_JS);
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in app.js`);
  let d = 0, end = start;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}

// Load the app's REAL functions.
//
// `TOPSY_CLIP_BASE` is EXTRACTED from app.js, never re-declared here. An
// earlier version of this harness hardcoded the expected host in the test
// file, and a mutation that typo'd the real constant (`topsy` -> `toppy`)
// came back GREEN -- because the test was asserting against its own copy
// instead of the app's. The constant is a load-bearing part of the URL, so the
// harness reads the one the app will actually use.
function loadNewsAudio() {
  const canary = { dbId: 0, url: 0 };
  const decl = /const TOPSY_CLIP_BASE = (['"][^'"]*['"]);/.exec(APP_JS);
  assert.ok(decl, 'TOPSY_CLIP_BASE must exist in app.js');
  const factory = new Function('canary', `
    ${grab('unescapeXml')}
    ${grab('newsClipDbId')}
    const TOPSY_CLIP_BASE = ${decl[1]};
    ${grab('newsAudioUrl')}
    return {
      newsClipDbId(s) { canary.dbId++; return newsClipDbId(s); },
      newsAudioUrl(a, b) { canary.url++; return newsAudioUrl(a, b); },
    };
  `);
  return { ...factory(canary), canary };
}

// A verbatim shape of one real entry's decoded content, trimmed to what the
// parser reads. The href is post-unescape: `&` not `&amp;`.
const REAL_CONTENT = '<p><div><img src="https://static-cdn.sr.se/images/83/x.jpg" />' +
  '<p><i>En 20-årig kvinna dömdes.</i></p></div></p>' +
  '<p><strong>Lyssna:</strong> <a href="http://api.sr.se/api/radio/radio.aspx' +
  '?type=db&id=10317199&codingformat=.m4a&metafile=m3u">Blomsterbud med pistol</a></p>' +
  '<p>20-årig kvinna får nästan tolv års fängelse.</p>';

// ---------------------------------------------------------------------------
// 1. Extracting the DBID
// ---------------------------------------------------------------------------

test('newsClipDbId pulls the DBID out of the real Lyssna link', () => {
  const h = loadNewsAudio();
  // Call FIRST, then read the canary. A canary asserted before the call is
  // always 0 and would either fail forever or -- worse -- be "fixed" by
  // deleting the assertion. The increment is the proof that the extracted
  // function is the one that produced the value below.
  const dbId = h.newsClipDbId(REAL_CONTENT);
  assert.ok(h.canary.dbId > 0, 'canary: the extracted function never ran');
  assert.equal(dbId, '10317199');
});

test('newsClipDbId survives the entity-escaped form of the same link', () => {
  // The app unescapes before matching, so this is the shape it really sees.
  // The `(?:amp;)?` branch is the guard for a feed that stops escaping.
  const h = loadNewsAudio();
  const escaped = REAL_CONTENT.replace('?type=db&id=', '?type=db&amp;id=');
  assert.equal(h.newsClipDbId(escaped), '10317199',
    'an unescaped &amp; must not cost every clip');
});

test('newsClipDbId returns null when the entry has no Lyssna link', () => {
  const h = loadNewsAudio();
  assert.equal(h.newsClipDbId('<p> Bara ingress, ingen ljudfil. </p>'), null);
});

test('newsClipDbId is null, not a partial match, for a malformed id', () => {
  const h = loadNewsAudio();
  // A non-numeric id must not be scraped as digits -- `(\d+)` is what prevents
  // "id=abc" from becoming a URL that 302s to somebody else's clip.
  assert.equal(h.newsClipDbId('radio.aspx?type=db&id=abc&x=1'), null);
  assert.equal(h.newsClipDbId('radio.aspx?type=db&id='), null);
});

// ---------------------------------------------------------------------------
// 2. Constructing the Topsy URL
// ---------------------------------------------------------------------------

test('newsAudioUrl builds the exact resolver SR actually serves', () => {
  const h = loadNewsAudio();
  // Call first, canary after -- see the note in the test above.
  const url = h.newsAudioUrl(9311428, '10317199');
  assert.ok(h.canary.url > 0, 'canary: the extracted function never ran');
  // This exact string was measured returning 302 to a playable .m4a with
  // `access-control-allow-origin: *`. Asserted literally, because a plausible
  // but wrong path (the dead radio.aspx, a topsy/ljudfil typo) 302s or 404s
  // and the row silently stops playing.
  assert.equal(
    url,
    'https://www.sverigesradio.se/topsy/ljudfil/10317199?publicationId=9311428');
});

test('newsAudioUrl never uses the dead radio.aspx m3u the feed prints', () => {
  const h = loadNewsAudio();
  const url = h.newsAudioUrl(9311428, '10317199');
  assert.ok(!url.includes('radio.aspx'),
    'radio.aspx?...&metafile=m3u returns an EMPTY playlist');
  assert.ok(!url.includes('metafile'), 'the m3u variant must not be used');
  assert.ok(url.startsWith('https://www.sverigesradio.se/topsy/ljudfil/'),
    'must use the topsy resolver on the www host');
});

// ---------------------------------------------------------------------------
// 3. A normal item becomes playable
// ---------------------------------------------------------------------------

test('a normal feed entry becomes playable (dbId + resolver URL both present)', () => {
  const h = loadNewsAudio();
  const dbId = h.newsClipDbId(REAL_CONTENT);
  const audioUrl = h.newsAudioUrl(9311428, dbId);
  assert.equal(dbId, '10317199');
  // This is the exact condition the renderer branches on.
  assert.ok(Boolean(audioUrl), 'audioUrl must be truthy so the row is playable');
});

// ---------------------------------------------------------------------------
// 4. Bad input stays safely non-playable
// ---------------------------------------------------------------------------

test('an entry without a clip id stays non-playable (no dead play button)', () => {
  const h = loadNewsAudio();
  const dbId = h.newsClipDbId('<p>Ingen ljudfil här.</p>');
  assert.equal(dbId, null);
  assert.equal(h.newsAudioUrl(9311428, dbId), null,
    'a missing DBID must leave audioUrl null, not undefined or a broken URL');
});

test('every broken-id shape is refused rather than half-built', () => {
  const h = loadNewsAudio();
  const cases = [
    [9311428, null], [9311428, undefined], [9311428, ''],
    [9311428, 'abc'], [9311428, '10a'], [9311428, ' 10317199'],
    [null, '10317199'], [0, '10317199'], [NaN, '10317199'],
    [9311428.5, '10317199'],
  ];
  for (const [articleId, dbId] of cases) {
    assert.equal(h.newsAudioUrl(articleId, dbId), null,
      `articleId=${articleId} dbId=${JSON.stringify(dbId)} must not produce a URL`);
  }
});

// ---------------------------------------------------------------------------
// 5. The wiring: fetchNewsFlashes must USE the helpers
// ---------------------------------------------------------------------------

test('fetchNewsFlashes derives audioUrl from the helpers, not a literal null', () => {
  // Guards the actual defect: `audioUrl: null` in the item literal. A test that
  // only exercised the helpers would stay green if the wiring were reverted.
  const body = grab('fetchNewsFlashes');
  assert.ok(body.includes('newsClipDbId(decoded)'),
    'the entry content must be scanned for the clip id');
  assert.ok(body.includes('newsAudioUrl(articleId, audioDbId)'),
    'audioUrl must be built by the resolver helper');
  assert.ok(body.includes('const articleId = idMatch ? Number(idMatch[1]) : null;'),
    'the article id must be read from the feed link for publicationId');
  // The one thing that must NOT come back: a hardcoded null audio source.
  assert.ok(!/audioUrl:\s*null/.test(body),
    'audioUrl: null must not survive -- that is the defect this test exists for');
});

test('the clip id is kept on the item so the URL is derived, never guessed', () => {
  assert.ok(grab('fetchNewsFlashes').includes('audioDbId,'),
    'the raw DBID must travel with the item');
});

// ---------------------------------------------------------------------------
// 6. Existing behaviour preserved -- these are the regression guards
// ---------------------------------------------------------------------------

test('the existing player is reused: no new audio path was introduced', () => {
  // playNews() already branched on item.audioUrl and handed off to
  // toggleTrack(). The requirement was to REUSE that, not to build a second
  // player, so this asserts there is exactly one handoff and it is the old one.
  const pn = grab('playNews');
  assert.ok(pn.includes('if (!item.audioUrl)'), 'the no-audio reader branch must survive');
  assert.ok(pn.includes('openArticle(item)'), 'a non-playable item still opens the reader');
  assert.ok(pn.includes('toggleTrack({'), 'a playable item goes to the existing player');
  assert.ok(pn.includes('audioUrl: item.audioUrl'), 'the item audioUrl is what is played');
  // No second audio element, no direct .play(), no new <audio> construction.
  assert.ok(!/new Audio\(/.test(pn), 'playNews must not construct its own player');
  assert.ok(!/\.play\(\)/.test(pn), 'playNews must not call play() directly');
});

test('the renderer still derives its label from audioUrl (no UI change needed)', () => {
  // The play affordance was ALREADY conditional. This asserts the condition is
  // still the same expression, so the newly-populated audioUrl activates the
  // existing pattern rather than needing a new one.
  assert.ok(APP_JS.includes('const hasAudio = Boolean(item.audioUrl);'),
    'the row must keep branching on audioUrl');
  assert.ok(APP_JS.includes('`Spela nyhetssändning: ${item.title}`'),
    'the playable label must still exist');
  assert.ok(APP_JS.includes('`Öppna artikel: ${item.title}`'),
    'the read-the-article label must still exist');
});

test('feed, ordering, links, timestamps and styling are untouched', () => {
  // The news section's other behaviour must not move.
  assert.ok(APP_JS.includes("const RSS_URL = 'https://api.sr.se/api/rss/program/83?format=145'"),
    'the feed must stay the Ekot Atom feed');
  // Newest-first ordering, unchanged.
  assert.ok(APP_JS.includes('items.sort((a, b) => (b.publishDateUtc ?? 0) - (a.publishDateUtc ?? 0))'),
    'news ordering must stay newest-first');
  assert.ok(APP_JS.includes('return items.slice(0, count)'),
    'the news count setting must still be honoured');
  // Article links go through the existing helper, not a new form.
  assert.ok(APP_JS.includes('href: articleLinkFor(item)'),
    'article links must still use articleLinkFor');
  // Lead text and timestamps still come from the same places.
  assert.ok(APP_JS.includes('lead: textToParagraphs(decoded)'), 'lead text extraction must survive');
  assert.ok(APP_JS.includes('publishDateUtc: publishedMs'), 'timestamp parsing must survive');
  // The Lyssna line must still be filtered OUT of the visible lead.
  assert.ok(APP_JS.includes("!/^Lyssna:/i.test(t)"),
    'the Lyssna label must not appear in the article body');
  // No stylesheet change was needed and none was made.
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.ok(styles.includes('.news-item'), 'existing news styling must be intact');
});

// ---------------------------------------------------------------------------
// 7. Out of scope: nothing here may touch DVR/HLS
// ---------------------------------------------------------------------------

test('this change touches no DVR, HLS or seek symbol', () => {
  // WS41 is in flight on the metadata timebase. A news-audio change that moved
  // any of these would be a regression, and the guard is cheapest as a
  // negative assertion over the functions that were actually edited.
  for (const fn of ['newsClipDbId', 'newsAudioUrl', 'fetchNewsFlashes', 'playNews']) {
    const body = grab(fn);
    assert.ok(!/HLS_CONFIG|seekableStart|seekableEnd|getStartDate|sampleStreamEdgeClock|trueEdgeWallMs|parseVariantEdge|readFreshSeekableEnd|seekToProgramTime|updateSeekableState/.test(body),
      `${fn} must not reference any DVR/HLS symbol`);
  }
});
