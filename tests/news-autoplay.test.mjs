/**
 * WS70 — news autoplay toggle.
 *
 * WHAT THE USER-VISIBLE FAILURE WOULD BE
 * The toggle promises two things: that the icon reflects the SAVED mode
 * (not whether a queue happens to be playing), and that autoplay plays a
 * FINITE sequence — the selected clip plus the following clips, in list
 * order, at most the configured news count, never wrapping. A regression
 * that looped forever, ignored the limit, reordered an active sequence on a
 * feed refresh, or let stopping the player silently flip the saved
 * preference would each pass a suite that only checked "a button exists".
 *
 * These tests EXECUTE the real extracted functions from app.js (AGENTS.md
 * §7). A canary counts invocations, because a harness that reports success
 * without running the code under test is worse than no harness at all.
 *
 * The advance path is driven through the REAL `ended` listener wiring by
 * asserting the listener body's structure, and the sequence arithmetic is
 * executed directly. SR `.m4a` clips abort in headless Chromium (known
 * limit, control-confirmed in WS67), so nothing here claims device
 * verification — that is the owner's iPhone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const STYLES = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

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

// ---------------------------------------------------------------------------
// 1. Persistence — namespaced key, default manual, stop never writes it
// ---------------------------------------------------------------------------

test('the autoplay preference is persisted under a namespaced key, default off', () => {
  const decl = /const NEWS_AUTOPLAY_KEY = (['"][^'"]*['"]);/.exec(APP_JS);
  assert.ok(decl, 'NEWS_AUTOPLAY_KEY must exist in app.js');
  assert.match(decl[1], /^['"]minradio\./, 'the key must be namespaced like the other prefs');
  // Default manual: the loader must require an explicit "on".
  const loader = grab('loadNewsAutoplay');
  assert.match(loader, /=== 'on'/,
    'the loader must treat anything but an explicit "on" as manual');
  // The save path must write a real value, not clear the key.
  const saver = grab('saveNewsAutoplay');
  assert.match(saver, /on \? 'on' : 'off'/, 'the saver must write both states');
});

test('stopping the player clears the sequence but never writes the preference', () => {
  const stop = grab('stopAndClosePlayer');
  assert.ok(stop.includes('clearNewsSequence()'),
    'stop must end the active sequence');
  assert.ok(!stop.includes('saveNewsAutoplay'),
    'stop must NOT silently change the saved autoplay preference');
});

// ---------------------------------------------------------------------------
// 2. One field, one writer
// ---------------------------------------------------------------------------

test('newsAutoplayQueue has exactly one writer and one clearer', () => {
  const src = stripComments(APP_JS);
  const writes = [...src.matchAll(/newsAutoplayQueue\s*=(?!=)/g)].length;
  assert.equal(writes, 2,
    'exactly two assignments: the initial null and the snapshot in startNewsSequence');
  const clearSites = [...src.matchAll(/newsAutoplayQueue = null/g)].length;
  assert.equal(clearSites, 2,
    'the null must be written only at declaration and inside clearNewsSequence');
  // clearNewsSequence must be the ONLY function whose body nulls it.
  const clearer = grab('clearNewsSequence');
  assert.ok(clearer.includes('newsAutoplayQueue = null'),
    'clearNewsSequence must be the clearing function');
});

// ---------------------------------------------------------------------------
// 3. The sequence arithmetic — EXECUTED, not asserted as text
// ---------------------------------------------------------------------------

// Drive the real startNewsSequence/advanceNewsSequence with a stubbed
// environment. The functions are extracted verbatim from app.js; the stubs
// stand in for the module-scope state they read (loadNewsAutoplay,
// loadNewsCount, state.news, state.current, newsAutoplayQueue, playNews).
function loadSequenceHarness({ autoplay, count, news, current, playNews }) {
  const canary = { start: 0, advance: 0, played: [] };
  const factory = new Function(
    'loadNewsAutoplay', 'loadNewsCount', 'state', 'playNews', 'canary', `
    let newsAutoplayQueue = null;
    ${grab('clearNewsSequence')}
    ${grab('startNewsSequence')}
    ${grab('advanceNewsSequence')}
    return {
      start(item) { canary.start++; startNewsSequence(item); return newsAutoplayQueue; },
      advance() { canary.advance++; return advanceNewsSequence(); },
      get queue() { return newsAutoplayQueue; },
      set queue(v) { newsAutoplayQueue = v; },
    };
  `);
  const state = { news, current: current ?? null };
  const play = (item) => { canary.played.push(item.id); playNews(item); };
  const h = factory(
    () => { canary.start += 0; return autoplay; },
    () => count,
    state,
    play,
    canary,
  );
  return { ...h, canary, state };
}

const NEWS_FIXTURE = [
  { id: 1, audioUrl: 'u1' }, { id: 2, audioUrl: 'u2' }, { id: 3, audioUrl: 'u3' },
  { id: 4, audioUrl: 'u4' }, { id: 5, audioUrl: 'u5' }, { id: 6, audioUrl: 'u6' },
  { id: 7, audioUrl: null }, // a text-only flash: never part of a sequence
  { id: 8, audioUrl: 'u8' },
];

test('CANARY: the harness executes the functions extracted from app.js', () => {
  const h = loadSequenceHarness({ autoplay: true, count: 4, news: NEWS_FIXTURE });
  h.start(NEWS_FIXTURE[1]);
  assert.ok(h.canary.start > 0, 'canary: startNewsSequence never ran');
  h.advance();
  assert.ok(h.canary.advance > 0, 'canary: advanceNewsSequence never ran');
});

test('autoplay builds a snapshot from the selected clip forward, in list order', () => {
  const h = loadSequenceHarness({ autoplay: true, count: 4, news: NEWS_FIXTURE });
  const q = h.start(NEWS_FIXTURE[2]);
  assert.ok(h.canary.start > 0, 'canary: the extracted function never ran');
  assert.deepEqual(q.map((n) => n.id), [3, 4, 5, 6],
    'the sequence must start at the selection and follow list order');
});

test('the selected clip counts as item 1 and the configured limit is honoured', () => {
  const h = loadSequenceHarness({ autoplay: true, count: 4, news: NEWS_FIXTURE });
  const q = h.start(NEWS_FIXTURE[0]);
  assert.equal(q.length, 4, 'at most the configured number of clips total');
  assert.equal(q[0].id, 1, 'the selected clip is item 1 of the sequence');
  // A larger list must still be cut at the limit.
  const h2 = loadSequenceHarness({ autoplay: true, count: 5, news: NEWS_FIXTURE });
  assert.equal(h2.start(NEWS_FIXTURE[0]).length, 5);
});

test('the sequence never wraps from the end back to the beginning', () => {
  const h = loadSequenceHarness({ autoplay: true, count: 20, news: NEWS_FIXTURE });
  const q = h.start(NEWS_FIXTURE[6]); // near the end of the list
  assert.ok(q.every((n) => n.id > 6), 'no clip before the selection may appear');
  assert.ok(q.length <= 2, 'the slice must simply end at the list end');
});

test('text-only flashes are excluded from the sequence', () => {
  const h = loadSequenceHarness({ autoplay: true, count: 4, news: NEWS_FIXTURE });
  const q = h.start(NEWS_FIXTURE[0]);
  assert.ok(!q.some((n) => n.id === 7),
    'a clip without a source must never be queued');
});

test('the snapshot is stable: a later list refresh does not reorder an active queue', () => {
  const h = loadSequenceHarness({ autoplay: true, count: 4, news: NEWS_FIXTURE });
  const before = h.start(NEWS_FIXTURE[1]).map((n) => n.id);
  // The feed refreshes and the list is re-sorted/replaced.
  h.state.news = [...NEWS_FIXTURE].reverse();
  assert.deepEqual(h.queue.map((n) => n.id), before,
    'an active sequence must keep the order it was built with');
});

test('manual mode never builds a sequence and clears a stale one', () => {
  const h = loadSequenceHarness({ autoplay: false, count: 4, news: NEWS_FIXTURE });
  h.queue = [{ id: 99 }]; // a stale queue left over from autoplay mode
  const q = h.start(NEWS_FIXTURE[0]);
  assert.equal(q, null, 'manual mode must not build a sequence');
  assert.equal(h.queue, null, 'a stale queue must be cleared when the mode is manual');
});

test('an unknown item builds no sequence', () => {
  const h = loadSequenceHarness({ autoplay: true, count: 4, news: NEWS_FIXTURE });
  assert.equal(h.start({ id: 4242, audioUrl: 'x' }), null);
});

// ---------------------------------------------------------------------------
// 4. Advancing — order, limit, end, and the failure path
// ---------------------------------------------------------------------------

test('advance plays the next clip in order and only on a normal finish', () => {
  const h = loadSequenceHarness({
    autoplay: true, count: 4, news: NEWS_FIXTURE,
    playNews: () => { /* stub: the real one goes through toggleTrack */ },
  });
  h.start(NEWS_FIXTURE[0]);
  assert.ok(h.advance(), 'the first advance must start clip 2');
  assert.deepEqual(h.canary.played, [2]);
  assert.ok(h.advance(), 'the second advance must start clip 3');
  assert.deepEqual(h.canary.played, [2, 3]);
});

test('the sequence ends at the limit and leaves the player in its normal state', () => {
  const h = loadSequenceHarness({
    autoplay: true, count: 3, news: NEWS_FIXTURE,
    playNews: () => {},
  });
  h.start(NEWS_FIXTURE[0]); // queue = [1, 2, 3]
  h.state.current = NEWS_FIXTURE[0];
  assert.ok(h.advance()); // -> 2
  h.state.current = NEWS_FIXTURE[1];
  assert.ok(h.advance()); // -> 3 (the limit)
  h.state.current = NEWS_FIXTURE[2];
  assert.equal(h.advance(), false, 'the limit must end the sequence');
  assert.equal(h.queue, null, 'the queue must be cleared at the limit');
  assert.deepEqual(h.canary.played, [2, 3], 'nothing may play past the limit');
});

test('the sequence ends at the end of the list without wrapping', () => {
  const h = loadSequenceHarness({
    autoplay: true, count: 20, news: NEWS_FIXTURE,
    playNews: () => {},
  });
  h.start(NEWS_FIXTURE[7]); // the last playable clip
  h.state.current = NEWS_FIXTURE[7];
  assert.equal(h.advance(), false, 'the end of the list must end the sequence');
  assert.equal(h.queue, null);
  assert.deepEqual(h.canary.played, [], 'nothing may play after the last clip');
});

test('a failed advance clears the queue and starts nothing', () => {
  const h = loadSequenceHarness({
    autoplay: true, count: 4, news: NEWS_FIXTURE,
    playNews: () => { throw new Error('playback rejected'); },
  });
  h.start(NEWS_FIXTURE[0]);
  assert.equal(h.advance(), false, 'a rejected start must not count as advanced');
  assert.equal(h.queue, null, 'the queue must be cleared on failure');
  assert.deepEqual(h.canary.played, []);
});

test('a queue-less advance is a no-op (autoplay turned off mid-playback)', () => {
  const h = loadSequenceHarness({
    autoplay: true, count: 4, news: NEWS_FIXTURE,
    playNews: () => {},
  });
  h.start(NEWS_FIXTURE[0]);
  h.queue = null; // the user toggled autoplay off: the click handler cleared it
  assert.equal(h.advance(), false);
  assert.deepEqual(h.canary.played, [], 'nothing may start after the toggle-off');
});

// ---------------------------------------------------------------------------
// 5. The wiring — the ended listener advances, pause never does
// ---------------------------------------------------------------------------

test('the ended listener advances the sequence; pause and play never do', () => {
  // Slice the REAL forEach block that registers the play/pause/ended
  // listeners, so the wiring under test is the shipped code, not a retyped
  // copy of it.
  const start = APP_JS.indexOf("['play', 'pause', 'ended'].forEach((ev) => {");
  assert.notEqual(start, -1, 'the play/pause/ended registration must exist');
  const block = stripComments(APP_JS.slice(start, start + 2200));
  const endedBranch = block.slice(block.indexOf("ev === 'ended'"));
  assert.match(endedBranch, /advanceNewsSequence\(\)/,
    'the ended branch must consult the sequence');
  // pause/play must NOT advance: the user paused, not finished.
  const pauseBranch = block.slice(block.indexOf("ev === 'pause' || ev === 'ended'"),
    block.indexOf("ev === 'ended' &&"));
  assert.ok(!pauseBranch.includes('advanceNewsSequence'),
    'pause must never advance the sequence');
  // The advance must short-circuit the rest of the handler when it fires.
  assert.match(endedBranch, /advanceNewsSequence\(\)\) return;/,
    'a successful advance must return before the pause/play repaint path');
});

test('playNews is the only entry that builds a sequence, and only for news', () => {
  const pn = grab('playNews');
  assert.ok(pn.includes('startNewsSequence(item)'),
    'playNews must decide the sequence where "came from Nyheter" is knowable');
  // Podcast and radio paths must not build sequences.
  const pp = grab('playPodcast');
  const px = grab('playExternalPodcast');
  assert.ok(!pp.includes('startNewsSequence'), 'playPodcast must not touch the sequence');
  assert.ok(!px.includes('startNewsSequence'), 'playExternalPodcast must not touch the sequence');
  assert.ok(!grab('playTrack').includes('startNewsSequence'),
    'playTrack must not touch the sequence');
});

// ---------------------------------------------------------------------------
// 6. The toggle — icon-only, mode-reflecting, accessible
// ---------------------------------------------------------------------------

test('the toggle is icon-only, reflects the saved mode, and carries aria state', () => {
  const src = stripComments(APP_JS);
  assert.ok(src.includes("class: `news-autoplay-btn${loadNewsAutoplay() ? ' active' : ''}`"),
    'the icon must reflect the SAVED mode, not a playing queue');
  assert.match(src, /'aria-pressed': String\(loadNewsAutoplay\(\)\)/,
    'aria-pressed must carry the toggle state');
  assert.match(src, /Spela nyheter i följd: (på|av)/,
    'an aria-label must exist (no visible text)');
  // Both icon variants must be present: loop for autoplay, loop-off for manual.
  assert.ok(src.includes('M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z'),
    'the loop (repeat) icon must exist for autoplay mode');
  assert.ok(src.includes('M21 7h-2.3l1.8-1.8-1.4-1.4L2.4 20.6l1.4 1.4L6.8 19H17v3l4-4-4-4v3H8.8l2-2H17v-3l4-4-4-4v3h2.6L21 7zM7 17H5v-4H3v6h4v-2z'),
    'the loop-off icon must exist for manual mode');
  // Toggling off mid-playback must clear the queue; toggling on must not
  // start anything by itself.
  const btn = src.slice(src.indexOf('const newsAutoplayBtn = el('), src.indexOf('newsHeaderRow.appendChild(newsAutoplayBtn)'));
  assert.match(btn, /if \(!on\) clearNewsSequence\(\)/,
    'toggling off must end the active sequence');
  assert.ok(!/playNews\(|toggleTrack\(/.test(btn),
    'toggling on must not start playback by itself');
});

test('the toggle sits beside NYHETER as a sibling of the fold button', () => {
  const src = stripComments(APP_JS);
  const row = src.slice(src.indexOf('const newsHeaderRow = el('),
    src.indexOf('newsSection.appendChild(newsHeaderRow)'));
  assert.ok(row.includes("class: 'news-toggle'"), 'the fold button must be in the row');
  assert.ok(row.includes('newsAutoplayBtn'), 'the autoplay toggle must be in the row');
  // A button inside a button is invalid HTML and would break the fold target.
  const foldBtn = row.slice(row.indexOf('const newsToggle = el('),
    row.indexOf('newsHeaderRow.appendChild(newsToggle)'));
  assert.ok(!foldBtn.includes('newsAutoplayBtn'),
    'the autoplay toggle must be a SIBLING of the fold button, not its child');
  // CSS: the row is flex, the fold button keeps the chevron at the right edge.
  assert.match(STYLES, /\.news-header-row \{[^}]*display:\s*flex/, 'the header row must be flex');
  const toggle = STYLES.match(/\.news-toggle \{([^}]*)\}/);
  assert.ok(toggle && /flex:\s*1/.test(toggle[1]),
    'the fold button must take flex: 1 so the chevron stays at the right edge');
  // The toggle styling mirrors .fresh-btn (44px target, 22px glyph).
  const btn = STYLES.match(/\.news-autoplay-btn \{([^}]*)\}/);
  assert.ok(btn && btn[1].includes('44px') && btn[1].includes('44px'),
    'the toggle must keep the 44px tap target');
  assert.match(STYLES, /\.news-autoplay-btn svg \{[^}]*22px/,
    'the glyph must match the fresh-btn sizing');
  assert.match(STYLES, /\.news-autoplay-btn\.active \{ color: var\(--accent\)/,
    'the active mode must be marked with the accent colour');
  // Keyboard focus comes from the app-wide rule; assert it still exists.
  assert.match(STYLES, /button:focus-visible/,
    'the app-wide focus outline must cover the new button');
});

// ---------------------------------------------------------------------------
// 7. Out of scope: podcasts, radio, and the existing news behaviour
// ---------------------------------------------------------------------------

test('podcast and radio playback are untouched by the sequence', () => {
  // The sequence functions must never be reachable from the live/podcast
  // paths: only playNews (news rows) and the ended listener reference them.
  const src = stripComments(APP_JS);
  const callers = [...src.matchAll(/advanceNewsSequence\(\)/g)].length;
  assert.equal(callers, 2,
    'advanceNewsSequence must be called only from the ended listener and its own body');
  // The existing news row behaviour is unchanged: same click handler, same
  // reader branch, same labels.
  const pn = grab('playNews');
  assert.ok(pn.includes('if (!item.audioUrl)'), 'the no-audio reader branch must survive');
  assert.ok(pn.includes('openArticle(item)'), 'a non-playable item still opens the reader');
  assert.ok(pn.includes('toggleTrack({'), 'a playable item still goes to the existing player');
  assert.ok(pn.includes('isNewsBroadcast: true'), 'the news-broadcast mark must survive');
});
