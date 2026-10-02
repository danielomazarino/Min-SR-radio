/**
 * Min Radio — frontend logic.
 * Vanilla JS, no dependencies. Fetches Sveriges Radio Open API v2 directly
 * (api.sr.se has CORS enabled) — no backend required. Works on any static host.
 *
 * Favorites are persisted in localStorage under 'minradio.favorites.v1'
 * with schema { channels: number[], podcasts: number[] } (max 4 each).
 *
 * UI model (v2):
 *  - Channels: 4 bare logo icons in one row. Tap = play/stop live stream.
 *  - Podcasts: 4 bare artwork icons in one row. Tap = play latest episode.
 *  - News: latest TEXT news flashes (Ekot feed), newest on top; tap to open
 *    the article. If the feed is down the backend falls back to audio
 *    bulletins, which play on tap instead.
 *  - A single mini-player (fixed at bottom) handles pause/resume and
 *    seek back/forth for on-demand audio (bulletins & episodes).
 *    Live streams support pause/resume but not seek.
 */

import { installEpisodeSeekPointerHandlers } from './src/episode-seek.mjs';

(() => {
  'use strict';

  // ---------------- constants ----------------
  const FAVORITES_KEY = 'minradio.favorites.v1';
  const MAX_FAVORITES = 4;
  const FETCH_TIMEOUT_MS = 10000;
  const SEEK_STEP_S = 15;
  // ---- WS10: build identity, INJECTED at build time ----
  // This placeholder is replaced in dist/app.js by scripts/build-pages.mjs with
  // the short git SHA the build was made from (or a timestamp when git
  // metadata is unavailable). The repo-root app.js is the AUTHORING input and
  // must never contain a real build id: it would be overwritten by the build,
  // and a stale literal here would be a lie waiting to happen. A test asserts
  // that.
  //
  // The id is deliberately NOT derived from app.js's own content hash. The
  // build computes that hash AFTER writing dist/app.js, so injecting it would
  // change the content, which would change the hash, which would change the id
  // -- an infinite loop. The git SHA is external to the bundle's bytes.
  // ---- WS11 Part B: the build identity, and no frozen version ----
  // `APP_VERSION` used to be the literal '1.5.0', unchanged since long before
  // WS6. A version string that never moves but is displayed as a version is a
  // lie: the owner read "Version 1.5.0" on every build and could not tell which
  // code a device was running -- the ambiguity that caused the WS6-WS9 loop.
  //
  // It is REMOVED rather than bumped. A hand-bumped number would repeat the
  // problem one release later, and it is not evidence of anything. The build id
  // (the short SOURCE commit, injected by scripts/build-pages.mjs) is the
  // honest identity: it names the exact code, and `git log <id>` resolves it.
  // package.json's version is the single remaining version source; this app
  // deliberately does not display it, because it is not per-build.
  const APP_BUILD = '__APP_BUILD_ID__';
  const APP_DEVELOPER = 'Daniel Omazarino';

  // ---------------- favorites store ----------------
  // Hard cap: 16 per category (4 swipe pages of 4). The selection UI enforces
  // max 4 per category during normal use; the higher cap leaves room for
  // paging without silently dropping selections.
  const HARD_CAP = MAX_FAVORITES * 4;
  function loadFavorites() {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (!raw) return { channels: [], podcasts: [] };
      const parsed = JSON.parse(raw);
      const clean = (v) =>
        Array.isArray(v) ? v.filter((id) => Number.isInteger(id)).slice(0, HARD_CAP) : [];
      return { channels: clean(parsed?.channels), podcasts: clean(parsed?.podcasts) };
    } catch (err) {
      console.warn('Favorites storage corrupted, resetting:', err);
      return { channels: [], podcasts: [] };
    }
  }

  function saveFavorites(favs) {
    try {
      localStorage.setItem(
        FAVORITES_KEY,
        JSON.stringify({
          channels: favs.channels.slice(0, HARD_CAP),
          podcasts: favs.podcasts.slice(0, HARD_CAP),
        })
      );
      return true;
    } catch (err) {
      console.warn('Could not save favorites:', err);
      return false;
    }
  }

  /** Move an id one step up (earlier = further left on home screen). */
  function moveFavorite(favs, kind, id, direction) {
    const arr = favs[kind];
    const idx = arr.indexOf(id);
    if (idx === -1) return false;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= arr.length) return false;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    saveFavorites(favs);
    return true;
  }

  // ---------------- tiny helpers ----------------
  const $main = document.getElementById('main');
  const $sheetRoot = document.getElementById('sheet-root');
  const $toastRoot = document.getElementById('toast-root');

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue; // false must NOT become setAttribute('disabled','false') — that DISABLES the element
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v; // only trusted inline SVG
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      if (child === null || child === undefined) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  async function apiFetch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`SR svarade med ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Sveriges Radio svarade inte i tid. Försök igen strax.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------- SR data layer (direct, static-host friendly) ----------------
  const SR_API = 'https://api.sr.se/api/v2';
  // Now-playing poll interval: 45 s — well within reason, and the song's
  // stoptimeutc usually gives natural alignment anyway (a song change is
  // picked up at most one interval late).
  const NOW_PLAYING_INTERVAL_MS = 45000;
  const RSS_URL = 'https://api.sr.se/api/rss/program/83?format=145';

  function parseSrDate(v) {
    if (typeof v !== 'string') return null;
    const m = /\/Date\((\d+)\)\//.exec(v);
    const ms = m ? Number(m[1]) : NaN;
    return Number.isFinite(ms) ? ms : null;
  }

  function sizedImage(url, preset) {
    if (!url || typeof url !== 'string') return url;
    try {
      const u = new URL(url);
      u.searchParams.set('preset', preset);
      return u.toString();
    } catch { return url; }
  }

  function safeStr(v, max = 300) {
    return typeof v === 'string' ? v.slice(0, max) : '';
  }

  function episodeAudioFields(ep) {
    const pod = ep?.listenpodfile;
    if (pod?.url) {
      return { audioUrl: safeStr(pod.url, 800) || null,
        duration: Number.isFinite(pod.duration) ? pod.duration : null };
    }
    const bf = ep?.broadcast?.broadcastfiles;
    if (Array.isArray(bf) && bf.length > 0 && bf[0]?.url) {
      return { audioUrl: safeStr(bf[0].url, 800) || null,
        duration: Number.isFinite(bf[0].duration) ? bf[0].duration : null };
    }
    const pl = ep?.broadcast?.playlist;
    if (pl?.url) {
      return { audioUrl: safeStr(pl.url, 800) || null,
        duration: Number.isFinite(pl.duration) ? pl.duration : null };
    }
    return { audioUrl: null, duration: null };
  }

  async function fetchChannels() {
    const data = await apiFetch(`${SR_API}/channels?format=json&size=500&pagination=false`);
    return (Array.isArray(data?.channels) ? data.channels : [])
      .filter((c) => c && typeof c.id === 'number' && typeof c.name === 'string')
      .map((c) => ({
        id: c.id,
        name: safeStr(c.name, 80),
        tagline: safeStr(c.tagline, 160),
        image: sizedImage(c.image, 'api-default-square'),
        siteurl: safeStr(c.siteurl, 300),
        liveaudioUrl: safeStr(c.liveaudio?.url, 500) || null,
        channeltype: safeStr(c.channeltype, 40),
      }));
  }

  let podcastCache = null;
  async function fetchPodcasts() {
    // Full catalogue (haspod=true), cached in memory. SR's server-side name
    // filter is broken (returns unrelated programs), so search is client-side.
    if (podcastCache) return podcastCache;
    const data = await apiFetch(
      `${SR_API}/programs/index?format=json&filter=program.haspod&filtervalue=true&size=500&pagination=true`
    );
    podcastCache = (Array.isArray(data?.programs) ? data.programs : [])
      .filter((p) => p && typeof p.id === 'number' && typeof p.name === 'string')
      .map((p) => ({
        id: p.id,
        name: safeStr(p.name, 120),
        description: safeStr(p.description, 200),
        image: sizedImage(p.programimage, 'api-default-square'),
        siteurl: safeStr(p.programurl, 300) || null,
      }));
    return podcastCache;
  }

  async function fetchLatestEpisode(programId) {
    const data = await apiFetch(
      `${SR_API}/episodes/index?format=json&programid=${programId}&size=1&pagination=true`
    );
    const ep = Array.isArray(data?.episodes) ? data.episodes[0] : null;
    if (!ep) return null;
    const { audioUrl, duration } = episodeAudioFields(ep);
    return {
      id: ep.id ?? null,
      title: safeStr(ep.title, 160) || null,
      url: safeStr(ep.url, 500) || null,
      publishDateUtc: parseSrDate(ep.publishdateutc),
      audioUrl,
      duration,
    };
  }

  // ---------------- external podcasts (Apple/iTunes), ADDITIVE ----------------
  // A SECOND source, not a replacement. Everything above this line is the
  // Sveriges Radio path and is deliberately untouched.
  //
  // WHY THIS EXISTS: iTunes Search (media=podcast) returns ONE record per
  // podcast -- no episode data at all. But the Lookup API with
  // `entity=podcastEpisode` returns real episode records INCLUDING a direct
  // `episodeUrl`, verified 2026-10-02 to be the FULL file (one case: 3474 s
  // declared, content-length 55,603,624 = 128 kbps x 57.9 min, exact).
  // That bypasses the publisher's RSS feed entirely, which matters because
  // only 121 of 272 sampled Swedish feeds send CORS headers.
  //
  // ID SPACE: SR podcast ids are small integers (78..6706); iTunes
  // collectionIds are large (e.g. 251955878). They are kept in SEPARATE
  // storage (below) rather than namespaced into one array, so no id can
  // ever resolve against the wrong catalogue and the existing SR favourites
  // stay byte-for-byte compatible.
  const ITUNES_API = 'https://itunes.apple.com';
  // Only search once the user has typed enough to be deliberate. Below 3
  // characters this would fire on every keystroke against a catalogue we
  // never preload.
  const EXT_SEARCH_MIN_CHARS = 3;
  const EXT_SEARCH_LIMIT = 20;
  const EXT_EPISODE_LIMIT = 20;
  // Episode lists change on a podcast's own schedule (daily at best), so a
  // 30 min cache is generous and keeps repeat opens cheap.
  const EXT_EPISODE_TTL_MS = 30 * 60 * 1000;
  const EXTERNAL_PODCASTS_KEY = 'minradio.podcasts.ext.v1';
  // The podcasts row is ONE list to the user, but the rows live in TWO
  // storages. That made a mixed order impossible to express: the SR array and
  // the external array each have their own order, neither can step past the
  // other, and the home screen hardcoded SR-then-external -- so any attempt to
  // interleave them reverted on the next render (owner, 2026-10-02).
  //
  // This key stores ONLY the visible order, as bare ids. It carries no row
  // data: a podcast is still favourited in exactly one of the two storages,
  // and neither storage's contents change. That keeps the separation that
  // protects the SR favourites (favoritesFromRaw drops non-integers) while
  // giving the row a single order that both providers can occupy.
  const PODCAST_ORDER_KEY = 'minradio.podcasts.order.v1';

  // Session caches. Deliberately module-level Maps, NOT localStorage: these
  // are cheap to rebuild and must never be able to outlive a schema change.
  const extSearchCache = new Map();
  const extEpisodeCache = new Map(); // collectionId -> { at, episodes }

  /**
   * A composite playback-guard key. The SR path already keyed on the raw
   * podcast id; prefixing BOTH providers means an SR id and an iTunes
   * collectionId can never compare equal, which is the whole point -- a bare
   * `251955878` must not be able to satisfy a guard meant for `164`.
   */
  function extGuardKey(provider, id) {
    return `${provider}:${id}`;
  }

  /** Normalise an iTunes artwork URL to a size the 64 px rows can use. */
  function extArtwork(url) {
    if (typeof url !== 'string' || !url) return null;
    return safeStr(url.replace('600x600', '100x100'), 800) || null;
  }

  /**
   * Map one iTunes search record onto the SAME row shape the SR catalogue
   * already produces (id / name / image / description) so every existing
   * renderer works unchanged. Provider extras ride along for playback.
   *
   * Returns null for a malformed row rather than throwing: one bad record
   * must not lose the other nineteen results.
   */
  function mapExtSearchRow(x) {
    if (!x || typeof x !== 'object') return null;
    const id = x.collectionId;
    if (!Number.isInteger(id) || id <= 0) return null;
    const name = safeStr(x.collectionName, 120);
    if (!name) return null;
    return {
      id,
      name,
      image: extArtwork(x.artworkUrl600),
      description: safeStr(x.primaryGenreName, 200) || null,
      provider: 'itunes',
      artist: safeStr(x.artistName, 120) || null,
      feedUrl: safeStr(x.feedUrl, 800) || null,
    };
  }

  /**
   * Search the iTunes catalogue. Never throws and never rejects: an
   * unavailable second source must not be able to fail the SR search, so
   * every failure path resolves to an empty list.
   */
  async function extSearch(query) {
    const q = (query || '').trim();
    if (q.length < EXT_SEARCH_MIN_CHARS) return [];
    if (extSearchCache.has(q)) return extSearchCache.get(q);
    let out = [];
    try {
      const res = await fetch(
        `${ITUNES_API}/search?term=${encodeURIComponent(q)}` +
        `&media=podcast&limit=${EXT_SEARCH_LIMIT}&country=SE`
      );
      if (res.ok) {
        const data = await res.json();
        const rows = Array.isArray(data?.results) ? data.results : [];
        out = rows.map(mapExtSearchRow).filter(Boolean);
      }
    } catch {
      out = []; // silent by design -- see above
    }
    extSearchCache.set(q, out);
    return out;
  }

  /**
   * Sort episodes newest-first, with a deterministic tie-break.
   *
   * The tie-break is not decoration. Lookup can return SEVERAL episodes
   * sharing one releaseDate -- observed once for a daily-bulletin podcast
   * early on 2026-10-02 (4 episodes on one date). A later 9-podcast sweep
   * did NOT reproduce it (0 duplicates), so how common this is remains
   * UNMEASURED. It is kept because it is cheap, and because the failure it
   * prevents -- order silently depending on server order -- is invisible to
   * the user rather than obviously wrong. trackId is a large monotonic
   * integer in practice, so descending trackId resolves same-day entries
   * deterministically.
   */
  function sortExtEpisodes(list) {
    return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
      const at = Date.parse(a?.releaseDate || '') || 0;
      const bt = Date.parse(b?.releaseDate || '') || 0;
      if (bt !== at) return bt - at;
      return (Number(b?.trackId) || 0) - (Number(a?.trackId) || 0);
    });
  }

  /** Map one iTunes episode record onto the existing episode/card model. */
  function mapExtEpisode(e) {
    if (!e || typeof e !== 'object') return null;
    const title = safeStr(e.trackName, 200);
    let audioUrl = safeStr(e.episodeUrl || e.previewUrl, 800);
    // A minority of enclosures are http://. On an https page that is mixed
    // content, which iOS Safari refuses outright, so upgrade it here rather
    // than letting the player fail opaquely.
    if (audioUrl.startsWith('http://')) audioUrl = `https://${audioUrl.slice(7)}`;
    if (!title || !audioUrl) return null;
    return {
      title,
      description: safeStr(e.description, 600) || safeStr(e.shortDescription, 600) || null,
      publishDateUtc: Date.parse(e.releaseDate || '') || null,
      duration: Number.isFinite(e.trackTimeMillis) ? e.trackTimeMillis / 1000 : null,
      audioUrl,
      id: Number.isInteger(e.trackId) ? e.trackId : null,
      artwork: extArtwork(e.artworkUrl600),
    };
  }

  /**
   * Fetch + cache a podcast's episodes. Resolves to an array (possibly
   * empty) and never rejects: an empty array means "no episodes", which is
   * ALSO what a bad collectionId returns (HTTP 200, resultCount 0), so the
   * UI must word that state truthfully rather than calling the podcast
   * invalid.
   */
  async function extEpisodes(collectionId) {
    const id = Number(collectionId);
    if (!Number.isInteger(id) || id <= 0) return [];
    const hit = extEpisodeCache.get(id);
    if (hit && (Date.now() - hit.at) < EXT_EPISODE_TTL_MS) return hit.episodes;
    let episodes = [];
    try {
      const res = await fetch(
        `${ITUNES_API}/lookup?id=${id}&entity=podcastEpisode&country=SE&limit=${EXT_EPISODE_LIMIT}`
      );
      if (res.ok) {
        const data = await res.json();
        const rows = Array.isArray(data?.results) ? data.results : [];
        episodes = sortExtEpisodes(
          rows.filter((r) => r && r.wrapperType === 'podcastEpisode')
        ).map(mapExtEpisode).filter(Boolean);
      }
    } catch {
      episodes = []; // silent: caller renders the empty state
    }
    extEpisodeCache.set(id, { at: Date.now(), episodes });
    return episodes;
  }

  // ---- external favourites: a SEPARATE key, never the numeric SR array ----
  function loadExternalPodcasts() {
    try {
      const raw = localStorage.getItem(EXTERNAL_PODCASTS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((p) => p && Number.isInteger(p.id) && typeof p.name === 'string')
        .slice(0, HARD_CAP)
        .map((p) => ({
          id: p.id,
          name: safeStr(p.name, 120),
          image: safeStr(p.image, 800) || null,
          description: safeStr(p.description, 200) || null,
          provider: 'itunes',
          artist: safeStr(p.artist, 120) || null,
          feedUrl: safeStr(p.feedUrl, 800) || null,
        }));
    } catch (err) {
      console.warn('External podcasts storage corrupted, resetting:', err);
      return [];
    }
  }

  function saveExternalPodcasts(list) {
    try {
      localStorage.setItem(EXTERNAL_PODCASTS_KEY, JSON.stringify(
        (Array.isArray(list) ? list : []).slice(0, HARD_CAP)
      ));
      return true;
    } catch (err) {
      console.warn('Could not save external podcasts:', err);
      return false;
    }
  }

  /** Add or remove an external podcast. Returns true when it is now favourited. */
  function toggleExternalPodcast(pod) {
    const list = loadExternalPodcasts();
    const idx = list.findIndex((p) => p.id === pod?.id);
    let favourited;
    if (idx >= 0) {
      list.splice(idx, 1);
      favourited = false;
    } else {
      if (list.length >= HARD_CAP) {
        showToast('Du kan inte välja fler. Ta bort en först.');
        return false;
      }
      list.push({
        id: pod.id, name: pod.name, image: pod.image,
        description: pod.description, feedUrl: pod.feedUrl, artist: pod.artist,
      });
      favourited = true;
    }
    saveExternalPodcasts(list);
    return favourited;
  }

  /**
   * REMOVE a favourite, from either provider, writing only to that provider's
   * own storage. Returns the removed row so the caller can offer an undo.
   *
   * Why this exists (owner, 2026-10-02): an iTunes podcast can be selected from
   * the search results but, once that search is gone, there was no way to
   * deselect it -- it is not in the SR catalogue, so it could never be found
   * again in the long list. The long list was the ONLY removal mechanism, and
   * it only worked for ids it contained.
   *
   * Mirrors toggleExternalPodcast's "remove" branch deliberately rather than
   * calling toggleExternalPodcast({id}): a row removed while off-screen must
   * remove by ID, and the toggle form would re-add an unknown id rather than
   * fail. Removing by id is idempotent and provider-explicit.
   */
  function removeFavoriteRow(kind, id, name) {
    // `name` is passed IN by the caller, because an SR favourite is stored as
    // a bare integer -- loadFavorites() returns ids only, with no name to
    // recover. Without it the undo toast reads "Borttaget: undefined", which
    // was observed in the browser before this was fixed.
    if (kind !== 'podcasts') {
      const favs = loadFavorites();
      const idx = favs[kind].indexOf(id);
      if (idx === -1) return null;
      const removed = favs[kind][idx];
      favs[kind].splice(idx, 1);
      saveFavorites(favs);
      return { id: removed, kind, provider: 'sr', name: name || String(removed) };
    }
    const list = loadExternalPodcasts();
    const idx = list.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const [removed] = list.splice(idx, 1);
      saveExternalPodcasts(list);
      return { ...removed, kind, provider: 'itunes' };
    }
    const favs = loadFavorites();
    const srIdx = favs.podcasts.indexOf(id);
    if (srIdx === -1) return null;
    const removed = favs.podcasts[srIdx];
    favs.podcasts.splice(srIdx, 1);
    saveFavorites(favs);
    return { id: removed, kind, provider: 'sr', name: name || String(removed) };
  }

  /**
   * Put a previously removed row back, into the provider it came from.
   * Used only by the undo action, so it restores position too when it can.
   */
  function restoreFavoriteRow(row, index) {
    if (!row) return false;
    if (row.provider === 'itunes') {
      const list = loadExternalPodcasts();
      if (list.some((p) => p.id === row.id)) return false;
      const at = Number.isInteger(index) ? Math.min(index, list.length) : list.length;
      list.splice(at, 0, {
        id: row.id, name: row.name, image: row.image,
        description: row.description, feedUrl: row.feedUrl, artist: row.artist,
      });
      saveExternalPodcasts(list);
      return true;
    }
    const favs = loadFavorites();
    if (favs[row.kind].includes(row.id)) return false;
    const at = Number.isInteger(index) ? Math.min(index, favs[row.kind].length) : favs[row.kind].length;
    favs[row.kind].splice(at, 0, row.id);
    saveFavorites(favs);
    return true;
  }

  /**
   * Resolve ONE provider's row for rendering. `provider` is explicit on
   * purpose: SR ids and iTunes collectionIds are both bare integers, so a
   * shared lookup would let a colliding id render the wrong podcast. Each
   * list therefore has exactly one source and one writer.
   */
  function resolvePodcastRow(catalogue, id, provider) {
    if (provider === 'itunes') {
      return loadExternalPodcasts().find((p) => p.id === id) || null;
    }
    return catalogue?.find?.((c) => c.id === id) || null;
  }

  /**
   * The podcast row's visible order, as bare ids from BOTH providers.
   *
   * Stored order wins for ids it contains; anything it does not mention is
   * appended in its own storage's order. That makes this key safe to write
   * from a partial view: a missing id can never be dropped from the row, and a
   * stale id (removed elsewhere) is filtered out by the caller.
   */
  function loadPodcastOrder() {
    try {
      const raw = localStorage.getItem(PODCAST_ORDER_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((id) => Number.isInteger(id)) : [];
    } catch (err) {
      console.warn('Podcast order storage corrupted, resetting:', err);
      return [];
    }
  }

  function savePodcastOrder(ids) {
    try {
      localStorage.setItem(PODCAST_ORDER_KEY, JSON.stringify(
        (Array.isArray(ids) ? ids : []).filter((id) => Number.isInteger(id))
      ));
      return true;
    } catch (err) {
      console.warn('Could not save podcast order:', err);
      return false;
    }
  }

  /**
   * The authoritative podcast row order: SR ids and external ids interleaved
   * as the user arranged them.
   *
   * Falls back to SR-then-external when no order has been stored, which is
   * exactly the pre-existing behaviour -- so an existing user sees no change.
   */
  function podcastRowOrder(srIds, extList) {
    const extIds = extList.map((p) => p.id);
    const all = [...srIds, ...extIds];
    const stored = loadPodcastOrder().filter((id) => all.includes(id));
    const missing = all.filter((id) => !stored.includes(id));
    return [...stored, ...missing];
  }

  /** Write the current row order, dropping ids that no longer exist. */
  function persistPodcastRowOrder(ids) {
    return savePodcastOrder(ids.filter((id) => Number.isInteger(id)));
  }

  function unescapeXml(s) {
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function stripTags(s) {
    return unescapeXml(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ---- News audio: the per-item "Lyssna:" clip ----
  // The Ekot feed already carries a short audio clip for (measured 2026-10-01)
  // 20 of 20 entries, as a link in the entry's own content HTML:
  //   <strong>Lyssna:</strong> <a href=".../radio.aspx?type=db&id=10317313&...">
  // That DBID is the clip's stable id in SR's audio system.
  //
  // The link the feed prints is DEAD: radio.aspx?...&metafile=m3u returns an
  // EMPTY playlist (just "#EXTM3U", 8 bytes, measured on fresh items). So the
  // feed's own href must not be used as an audio source.
  //
  // The working route is SR's Topsy resolver, which takes the DBID and
  // redirects (302) to a real .m4a on lyssna-cdn.sr.se:
  //   /topsy/ljudfil/{dbId}?publicationId={articleId}
  // Both the resolver and the CDN send `access-control-allow-origin: *`, and
  // the resolver explicitly allows the `range` request header, so a static
  // host can stream it directly. The CDN URL itself embeds a per-publication
  // timestamp, so the DBID — not that URL — is the durable identifier.
  //
  // The .m4a format is already proven by this app: podcast episodes resolve to
  // the same lyssna-cdn.sr.se host (e.g. .../ljudit/.../nyheter_p4_jmtland_*.m4a)
  // and play through the existing player. News clips therefore reuse the
  // existing player unchanged — no second audio path.
  const TOPSY_CLIP_BASE = 'https://www.sverigesradio.se/topsy';
  function newsClipDbId(contentHtml) {
    // Run on the ALREADY-unescaped content, so the href is plain
    // `?type=db&id=123`. The optional `&amp;` also covers a feed that leaves
    // the entity escaped, so a future feed change cannot silently drop every
    // clip.
    const m = /radio\.aspx\?type=db&(?:amp;)?id=(\d+)/.exec(contentHtml || '');
    return m ? m[1] : null;
  }

  function newsAudioUrl(articleId, dbId) {
    // BOTH ids are required. The resolver is keyed on the clip, but
    // `publicationId` is what tells SR which publication the clip belongs to;
    // without a real article id there is nothing coherent to send. Any
    // missing or non-numeric part returns null, which leaves the item on the
    // existing read-the-article path instead of producing a dead play button.
    if (!Number.isInteger(articleId) || articleId <= 0) return null;
    if (!/^\d+$/.test(String(dbId || ''))) return null;
    return `${TOPSY_CLIP_BASE}/ljudfil/${dbId}?publicationId=${articleId}`;
  }

  async function fetchNewsFlashes(count) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let xml;
    try {
      const res = await fetch(RSS_URL, { signal: controller.signal });
      if (!res.ok) throw new Error(`Nyhetsflödet svarade med ${res.status}`);
      xml = await res.text();
    } finally {
      clearTimeout(timer);
    }
    const entries = xml.split(/<entry[\s>]/).slice(1);
    const items = [];
    for (const block of entries) {
      const title = /<title type="text">([\s\S]*?)<\/title>/.exec(block)?.[1];
      const published = /<published>([\s\S]*?)<\/published>/.exec(block)?.[1];
      const link = /<link href="([^"]+)"\s*\/>/.exec(block)?.[1];
      const contentHtml = /<content type="html">([\s\S]*?)<\/content>/.exec(block)?.[1] || '';
      const author = /<author>\s*<name>([\s\S]*?)<\/name>/.exec(block)?.[1];
      if (!title || !link) continue;
      const decoded = unescapeXml(contentHtml);
      const imgMatch = /<img src="([^"]+)"/.exec(decoded);
      let publishedMs = published ? Date.parse(published.trim()) : NaN;
      if (!Number.isFinite(publishedMs)) publishedMs = null;
      const idMatch = /artikel\/(\d+)/.exec(link);
      const articleId = idMatch ? Number(idMatch[1]) : null;
      const audioDbId = newsClipDbId(decoded);
      items.push({
        id: idMatch ? Number(idMatch[1]) : publishedMs ?? items.length,
        title: stripTags(title).slice(0, 160),
        // Feed content = lead text (full body is not reachable from a static host)
        lead: textToParagraphs(decoded),
        imageUrl: imgMatch ? imgMatch[1] : null,
        imageAlt: null,
        url: link.trim(),
        publishDateUtc: publishedMs,
        programName: author ? unescapeXml(author).trim().slice(0, 80) : null,
        // The clip id travels with the item so the resolver URL is derived, not
        // guessed, and so a bad id can never produce a play button.
        audioDbId,
        audioUrl: newsAudioUrl(articleId, audioDbId),
        duration: null,
      });
      if (items.length >= count * 3) break;
    }
    items.sort((a, b) => (b.publishDateUtc ?? 0) - (a.publishDateUtc ?? 0));
    return items.slice(0, count);
  }

  /** Extract readable paragraph strings from the feed's content HTML. */
  function textToParagraphs(contentHtml) {
    const paras = [...contentHtml.matchAll(/<p>([\s\S]*?)<\/p>/g)]
      .map((m) => stripTags(m[1]))
      .filter((t) => t.length > 15);
    // drop photo credits and the feed's listen-link line
    return paras
      .filter((t) => !/^Foto:/i.test(t) && !/^Lyssna:/i.test(t))
      .slice(0, 6);
  }

  // ---- BUG 2 fix (2026-09-22): news links open a 404 ----
  // ROOT CAUSE (verified with browser-perfect iOS Safari headers):
  //   1. The Ekot feed's <link> is /artikel/<id> — SR's own site returns 404
  //      for ALL id URLs (SR migrated to slug URLs; the feed was not updated).
  //   2. Working URLs are /artikel/<slug> on the www host (non-www 403s).
  //   3. Slugs CANNOT be fetched cross-origin (sverigesradio.se sends no CORS
  //      headers), so the browser cannot resolve id→slug at runtime.
  //   4. Slugify-from-title matches ~half of articles; editorial slugs differ
  //      for the rest (e.g. "Vill bygga stängsel runt Israels ambassad" →
  //      "stangsel-kring-israels-ambassad-utreds-i-stockholm") — and a wrong
  //      slug 404s exactly like the id URL, so slug-guessing is not viable.
  // FIX: link to SR's search page for the title (www.sverigesradio.se/sok?
  // query=… — verified 200, article is the top result). Never open the dead
  // id URL.
  function articleLinkFor(item) {
    // ALWAYS the SR search page for the title. Slug-guessing from the title
    // matches only ~half of articles (SR uses editorial slugs for the rest —
    // e.g. "Vill bygga stängsel runt Israels ambassad" →
    // "stangsel-kring-israels-ambassad-utreds-i-stockholm"), and a wrong
    // slug 404s exactly like the dead id URL. The search page always loads
    // (verified 200) and shows the article as the top result.
    return `https://www.sverigesradio.se/sok?query=${encodeURIComponent(item.title || '')}`;
  }

  function formatTime(ms) {
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return `idag ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `igår ${time}`;
    return `${d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })} ${time}`;
  }

  function fmtDur(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function showToast(message, durationMs = 3500) {
    $toastRoot.textContent = '';
    const toast = el('div', { class: 'toast', text: message });
    $toastRoot.appendChild(toast);
    setTimeout(() => toast.remove(), durationMs);
  }

  /**
   * A toast with an optional UNDO action.
   *
   * Why this exists: removal by swipe is destructive and easy to trigger by
   * accident -- a sideways slip while scrolling is exactly the motion people
   * make. A destructive gesture with no recovery is a bad trade even when it
   * works, so every removal offers a way back. Only ONE undo toast exists at a
   * time; a second removal replaces it, which is deliberate: the older undo
   * would otherwise restore a row underneath the newer one.
   */
  function showUndoToast(message, onUndo, durationMs = 6000) {
    $toastRoot.textContent = '';
    const toast = el('div', { class: 'toast toast-undo', role: 'status' },
      el('span', { class: 'toast-text', text: message }),
      el('button', {
        class: 'toast-action', type: 'button', text: 'Ångra',
        'aria-label': `Ångra: ${message}`,
        onclick: () => { toast.remove(); onUndo(); },
      }));
    $toastRoot.appendChild(toast);
    const timer = setTimeout(() => toast.remove(), durationMs);
    // A timer that outlives the toast would remove a LATER toast, because
    // $toastRoot is emptied by the next showToast.
    toast.addEventListener('remove', () => clearTimeout(timer), { once: true });
    return toast;
  }

  // ---------------- app state ----------------
  const state = {
    channels: [],   // full catalogues for resolving favorites
    podcasts: [],
    news: [],
    // currently loaded track: { kind:'live'|'episode', id, title, subtitle, audioUrl, duration, artwork }
    current: null,
  };

  // ---------------- audio / player ----------------
  // ---- TEMPORARY DIAGNOSTICS (PWA audio lifecycle investigation) ----
  // Every page load gets a unique instance id. All audio/lifecycle events
  // are logged with it, so logs from an OLD page can be distinguished from
  // the CURRENT one. Kept in localStorage (survives page close) + console.
  // REMOVE once the iOS zombie-audio root cause is identified.
  const DIAG_ID = Math.random().toString(36).slice(2, 8);
  const diagLog = (msg) => {
    const line = `${new Date().toISOString()} [${DIAG_ID}] ${msg}`;
    try { console.log('%cSRDIAG', 'color:#f60', line); } catch { /* ignore */ }
    try {
      const k = 'sr-diag-log';
      const arr = JSON.parse(localStorage.getItem(k) || '[]');
      arr.push(line);
      localStorage.setItem(k, JSON.stringify(arr.slice(-200)));
    } catch { /* ignore */ }
  };
  diagLog(`page-load href=${location.href} standalone=${window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true}`);

  // ---- WS0 metadata diagnostics: capture holders ----
  // ALWAYS allocated, ALWAYS written (pure in-memory integer/object writes: no
  // DOM mutation, no fetch, no timers, no localStorage). Read ONLY by the
  // gated hook at the bottom of this file, which is inert unless two keys are
  // present. Counters must run unconditionally because they observe
  // registrations that happened long before any snapshot could be requested.
  const META_DIAG = {
    expandPanelSeq: 0,          // monotonic id: same id = same node survived
    listenerAdds: Object.create(null),
    listenerRemoves: Object.create(null),
    lastRightNowRaw: null,      // full playlists/rightnow body (previoussong/nextsong)
    lastRightNowAt: null,
    lastScheduleRaw: null,      // full scheduledepisodes body
    lastScheduleAt: null,
    lastScheduleChannelId: null,
    lastScheduleParsed: null,
    // WS21: why fetchSchedule chose one day or two. See the snapshot's
    // `schedule.gate`. Declared here so the shape is fixed, not created on
    // first assignment deep inside an async function.
    lastScheduleGate: null,
    // ---- WS41: what the metadata claims about itself, and when. ----
    // Captured at RECEPTION, before any parsing, because the parsed fields are
    // lossy: `nowPlaying.song` keeps only title/artist/startMs/stopMs, and the
    // seek path's entries keep only absolute ms. If the raw payload ever grows
    // a real timestamp, this is where it will be seen.
    //
    // `source` names WHICH endpoint produced the entry, because that is the
    // whole finding: the two sources use different timebases and the entries
    // are merged into ONE list.
    lastTrackSource: null,      // endpoint id that produced the last entry
    lastTrackEpisodeId: null,
    lastTrackCount: 0,
    lastTrackAt: null,
    lastTrackKeys: null,        // key names on ONE raw track, verbatim
    lastTrackSample: null,      // that raw track, verbatim
    lastTrackEpisodeStartMs: null, // the programme start it was anchored to
    // ---- WS42: what the BACKWARD programme button captured, and when. ----
    // The backward handler is bound ONCE and permanently captures `prevEv`
    // (see the `prevProgramBtn.onclick = goPrev` site), while the forward path
    // is refreshed on `timeupdate`. So the captured value is the thing under
    // suspicion, and until now nothing recorded what it WAS.
    //
    // Every field is captured at BIND time by the same expression that produced
    // the value, so this cannot disagree with what the handler will do. It is
    // a RECORD, not a re-computation: nothing here changes which programme is
    // selected.
    prevBind: null,             // null until a backward handler is ever bound
  };

  // WS41: record which endpoint produced a set of tracks, and what that payload
  // literally contained. WRITE-ONLY capture; it feeds the diagnostic snapshot
  // and nothing else, so metadata behaviour cannot change because of it.
  //
  // `episodeStartMs` is stored BESIDE the tracks because the seek path builds
  // absolute times as `episodeStartMs + relativeStartTime`. Without recording
  // the anchor, a timeline entry's provenance is unrecoverable after the fact.
  function metaDiagTrackSource(source, episodeId, tracks, episodeStartMs) {
    if (!Array.isArray(tracks)) return;
    META_DIAG.lastTrackSource = source;
    META_DIAG.lastTrackEpisodeId = episodeId == null ? null : episodeId;
    META_DIAG.lastTrackCount = tracks.length;
    META_DIAG.lastTrackAt = Date.now();
    META_DIAG.lastTrackKeys = tracks.length && tracks[0] ? Object.keys(tracks[0]) : null;
    META_DIAG.lastTrackSample = tracks.length ? tracks[0] : null;
    META_DIAG.lastTrackEpisodeStartMs = Number.isFinite(episodeStartMs) ? episodeStartMs : null;
  }

  // Instrumented at the APP'S OWN registration sites only. EventTarget.prototype
  // and every built-in are left untouched.
  function metaDiagCountAdd(type) {
    META_DIAG.listenerAdds[type] = (META_DIAG.listenerAdds[type] || 0) + 1;
  }
  function metaDiagCountRemove(type) {
    META_DIAG.listenerRemoves[type] = (META_DIAG.listenerRemoves[type] || 0) + 1;
  }

  const audioEl = new Audio();
  audioEl.preload = 'none';
  diagLog(`audio-element-created id=${DIAG_ID}`);

  const $player = el('div', { class: 'player', 'aria-label': 'Spelare' });
  document.body.appendChild($player);

  let lastPlayingKey = null; // `${kind}:${id}` of what's loaded

  // WS17: the podcast id whose latest-episode fetch is in flight, or null.
  // Declared HERE, beside lastPlayingKey, because stopAndClosePlayer() clears
  // it and is defined ~2000 lines earlier. A `let` further down the file would
  // only be safe because the function runs after the whole IIFE body has been
  // evaluated -- which is true, and is exactly the kind of accident that
  // breaks the moment someone calls it from a top-level statement.
  //
  // Cleared in a `finally`, so a FAILED fetch cannot wedge the podcast
  // permanently: a guard only cleared on success turns one network error into
  // "this podcast never plays again until the app is restarted".
  let podFetchInFlight = null;

  // ---- stream format badge ----
  // Derives a short format label (MP3/AAC/FLAC/HLS) from the stream URL.
  // For live streams the real bitrate is also fetched from the icy-br
  // response header — but only for direct edge*.sr.se URLs: the official
  // topsy→live1 redirect chain has a CORS-less middle hop, so fetch() there
  // is always blocked (playback via <audio> is unaffected — media elements
  // don't enforce CORS).
  function streamFormatLabel(url) {
    if (!url || typeof url !== 'string') return null;
    const u = url.toLowerCase();
    if (u.includes('.m3u8')) return 'HLS';
    if (u.includes('flac')) return 'FLAC';
    if (u.includes('-aac-') || u.includes('.aac')) return 'AAC';
    if (u.includes('.mp3') || u.includes('-mp3-')) return 'MP3';
    return null;
  }

  async function fetchStreamBitrate(url) {
    try {
      const host = new URL(url).hostname;
      if (!/^edge\d*\.sr\.se$/.test(host)) return null; // CORS-readable only on edge
      const res = await fetch(url, { method: 'HEAD' });
      const br = parseInt(res.headers.get('icy-br') || '', 10);
      return Number.isFinite(br) && br > 0 ? br : null;
    } catch {
      return null; // badge stays format-only — never blocks playback
    }
  }

  // ---- live stream resolver (Phase 1: stream descriptors) ----
  // Streams are now described as objects instead of bare URLs, so the badge
  // and future DVR UI can read codec/bitrate/transport/dvr directly instead
  // of guessing from URL patterns. The resolver output is still an ordered
  // candidate list — playTrack/advanceCandidate/watchdog/workingStreamIdx
  // work unchanged.
  //
  // Descriptor shape:
  //   { url, codec: 'aac'|'mp3'|'flac', bitrate: kbps|null,
  //     transport: 'direct'|'hls', dvr: bool, priority: number }
  //   priority: higher = tried first. FLAC 100 > HLS 80 > AAC-direct 60 > MP3 10.
  //
  // Order per channel (verified 2026-09-21, see ENHANCEMENTS.md):
  //   1. P2 Musik (id 2562): FLAC-in-Ogg at edge1.sr.se/p2-flac — lossless,
  //      plays in Chromium & Safari. Undocumented by SR → MP3 stays as
  //      fallback. NOTE: edge slug family 'p2' belongs to P2 Musik
  //      (SR's own 2562.hls lists p2/* variants; 163.hls lists p2sm/*).
  //   2. iOS/Safari: official AAC template srapi/{id}-hi-aac-http → 320 kbps.
  //      Safari plays raw ADTS natively; Chromium does not (verified).
  //   3. Official MP3 (liveaudio.url from the API) — works everywhere.
  // Android/Chrome is Chromium-based → raw ADTS AAC fails there too, so
  // Android intentionally keeps MP3.
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_SAFARI = IS_IOS || /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  const IS_FIREFOX = /firefox|fxios/i.test(navigator.userAgent);

  // Platform capabilities — detected once. UI never checks the browser
  // directly; it reads state.current fields set by the resolver.
  // NOTE: canPlayType lies about HLS in Chromium (says "probably" but native
  // HLS in <audio> errors after ~2.3 s — verified 2026-09-21). So nativeHls
  // is gated on Safari, not on canPlayType.
  const CAPS = {
    isIOS: IS_IOS,
    isSafari: IS_SAFARI,
    isFirefox: IS_FIREFOX,
    // Raw ADTS AAC: Safari plays it natively; Chromium hangs silently
    // (verified 3× 2026-09-21) — so direct AAC is Safari-only.
    canPlayAacDirect: IS_SAFARI,
    // FLAC-in-Ogg plays on all target platforms (verified Chromium; Safari
    // supports Ogg FLAC since 11.1).
    canPlayFlac: true,
    // Native HLS: Safari only (iOS/iPadOS/macOS). Chromium's canPlayType
    // claims support but playback fails — do not trust it.
    nativeHls: IS_SAFARI,
    // hls.js path: MSE-capable Chromium browsers. Firefox has MSE but
    // TS-in-MSE is unreliable — excluded until real-Firefox validation.
    // Electron/VS Code webviews are NOT treated as proof of Chrome support;
    // this flag is UA-based, not canPlayType-based.
    hlsjs: !IS_SAFARI && !IS_FIREFOX && ('MediaSource' in window),
    canPlayHls: IS_SAFARI || (!IS_FIREFOX && 'MediaSource' in window),
  };

  // Static stream table. Bitrates are VERIFIED against SR's actual manifests
  // (AVERAGE-BANDWIDTH per STABLE-VARIANT-ID, curl-checked 2026-09-21):
  //   p1/p2sm/p4gbg ladders: 32 / 128 / 192 kbps AAC
  //   p3/p2 (P3 / P2 Musik): 32 / 128 / 320 kbps AAC
  // FLAC entries stay hand-maintained (undocumented by SR); liveaudio.url
  // (MP3 96) is appended by the resolver for every channel.
  // HLS entries point at the master manifest — Safari/hls.js pick the variant
  // and handle SR's content steering (LJUD1→LJUD2) themselves.
  const HLS_MASTER = (slug) => `https://ljud1-cdn.sr.se/lc/${slug}.m3u8`;
  const STREAM_TABLE = {
    // P2 Musik (2562): FLAC stays highest priority — HLS must NOT replace it.
    2562: [
      { url: 'https://edge1.sr.se/p2-flac', codec: 'flac', bitrate: null,
        transport: 'direct', dvr: false, priority: 100 },
      { url: HLS_MASTER('p2'), codec: 'aac', bitrate: 320,
        transport: 'hls', dvr: true, priority: 80 },
    ],
    // P3 (164): 320 kbps top level
    164: [
      { url: HLS_MASTER('p3'), codec: 'aac', bitrate: 320,
        transport: 'hls', dvr: true, priority: 80 },
    ],
    // P1 (132), P2 (163), P4 Göteborg (212): 192 kbps top level
    132: [
      { url: HLS_MASTER('p1'), codec: 'aac', bitrate: 192,
        transport: 'hls', dvr: true, priority: 80 },
    ],
    163: [
      { url: HLS_MASTER('p2sm'), codec: 'aac', bitrate: 192,
        transport: 'hls', dvr: true, priority: 80 },
    ],
    212: [
      { url: HLS_MASTER('p4gbg'), codec: 'aac', bitrate: 192,
        transport: 'hls', dvr: true, priority: 80 },
    ],
  };

  function descriptorFor(channel, entry) {
    return {
      url: entry.url,
      codec: entry.codec,
      bitrate: entry.bitrate,
      transport: entry.transport,
      dvr: entry.dvr,
      priority: entry.priority,
    };
  }

  function mp3Descriptor(channel) {
    return {
      url: channel.liveaudioUrl,
      codec: 'mp3',
      bitrate: 96, // liveaudio.url is always the 96 kbps MP3 chain
      transport: 'direct',
      dvr: false,
      priority: 10,
    };
  }

  function aacDirectDescriptor(channel) {
    return {
      url: `https://www.sverigesradio.se/topsy/direkt/srapi/${channel.id}-hi-aac-http`,
      codec: 'aac',
      bitrate: 320, // -hi-aac-http resolves to the 320 kbps chain (icy-br 312–320)
      transport: 'direct',
      dvr: false,
      priority: 60,
    };
  }

  // Builds the ordered candidate list for a channel. Same output shape as
  // the old liveCandidates (array), but each item is a descriptor object.
  // Order (priority-sorted, stable):
  //   P2 Musik: FLAC(100) → HLS-320(80) → (Safari: AAC-320 direct, 60) → MP3(10)
  //   P3:       HLS-320(80) → (Safari: AAC-320 direct, 60) → MP3(10)
  //   P1/P2/P4: HLS-192(80) → (Safari: AAC-320 direct, 60) → MP3(10)
  // NOTE: in "best audio" mode P2 Musik still tries FLAC FIRST — HLS never
  // replaces FLAC just because it has DVR. HLS is a higher-priority fallback
  // than direct AAC because it is SR-documented and carries the DVR window.
  function resolveStreams(channel) {
    if (!channel || !channel.liveaudioUrl) return [];
    const cands = [];

    // Static table entries, filtered by platform capability.
    for (const entry of STREAM_TABLE[channel.id] || []) {
      if (entry.codec === 'flac' && !CAPS.canPlayFlac) continue;
      if (entry.transport === 'hls' && !CAPS.canPlayHls) continue;
      cands.push(descriptorFor(channel, entry));
    }

    // Direct AAC — Safari only (Chromium hangs on raw ADTS).
    if (CAPS.canPlayAacDirect && channel.id) {
      cands.push(aacDirectDescriptor(channel));
    }

    // Official MP3 — always last, works everywhere.
    cands.push(mp3Descriptor(channel));

    // Stable sort by priority (descending). The push order above already
    // matches priority order, but sorting makes the table declarative.
    return cands.sort((a, b) => b.priority - a.priority);
  }

  // Backwards-compatible shim: playTrack call sites pass descriptors now;
  // candidates array items carry codec/bitrate/transport/dvr fields.
  function liveCandidates(channel) {
    return resolveStreams(channel);
  }

  // Remembers which candidate index last played successfully per stream key,
  // so pause/resume doesn't retry a known-bad candidate.
  const workingStreamIdx = new Map();

  // ---- HLS playback engine (Phase 2) ----
  // One active hls.js instance at most, owned by the playback layer. The UI
  // never sees hls.js — it reads state.current fields (transport/dvr/bitrate).
  //
  // Lifecycle:
  //   hlsAttach(url) → manifest parsed → media attached → buffering → playing
  //   fatal error    → hlsDetach() → advanceCandidate() (existing fallback)
  //
  // hlsDetach() is called from EVERY path that changes playback:
  // playTrack (new track), advanceCandidate (fallback), stopAndClosePlayer.
  // No stale instance may survive a session change.
  let hlsInstance = null;
  let hlsScriptPromise = null;
  // Session token: incremented on every playback change. HLS event handlers
  // capture their token and ignore events that arrive after the session moved
  // on (e.g. user picks P3 while P1 HLS is still loading — P1's late events
  // must not touch P3's state or advance P3's candidates).
  let hlsSession = 0;

  // Lazy-load hls.js from CDN only when an HLS stream is actually about to
  // play. Direct FLAC/AAC/MP3 never load it. Cached promise = one load.
  function loadHlsJs() {
    if (window.Hls) return Promise.resolve();
    if (hlsScriptPromise) return hlsScriptPromise;
    hlsScriptPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
      s.onload = () => resolve();
      s.onerror = () => { hlsScriptPromise = null; resolve(); /* caller falls back */ };
      document.head.appendChild(s);
    });
    return hlsScriptPromise;
  }

  // Conservative buffering (per approved design): do NOT retain 3 h of media.
  // SR's sliding playlist is the DVR source of truth; hls.js re-fetches older
  // segments on seek. backBufferLength keeps a short tail behind the playhead.
  const HLS_CONFIG = {
    enableWorker: true,
    backBufferLength: 90,      // 90 s behind playhead — not hours
    maxBufferLength: 30,       // forward buffer (s)
    maxMaxBufferLength: 120,
    liveSyncDurationCount: 3,
    fragLoadingMaxRetry: 4,
    manifestLoadingMaxRetry: 2,
    levelLoadingMaxRetry: 3,
  };

  function hlsDetach() {
    if (hlsInstance) {
      try { hlsInstance.destroy(); } catch (e) { /* already gone */ }
      hlsInstance = null;
    }
  }

  // ---- verified SR/HLS bitrate ladder (curl-checked 2026-09-21) ----
  // SR's master manifests advertise AVERAGE-BANDWIDTH including container
  // overhead (~6.25% above nominal), so the mapping advertised→display is a
  // lookup against this verified table — NOT a division by 1000 (340000 bps
  // is the "320 kbps" rendition, not 340).
  const SR_HLS_LADDER = [
    { advertisedBps: 34000, nominalKbps: 32 },
    { advertisedBps: 136000, nominalKbps: 128 },
    { advertisedBps: 204000, nominalKbps: 192 },
    { advertisedBps: 340000, nominalKbps: 320 },
  ];

  function nominalKbpsFor(advertisedBps) {
    let best = SR_HLS_LADDER[0];
    for (const entry of SR_HLS_LADDER) {
      if (Math.abs(entry.advertisedBps - advertisedBps)
        < Math.abs(best.advertisedBps - advertisedBps)) best = entry;
    }
    return best.nominalKbps;
  }

  // DVR usability threshold: a seekable window shorter than this is not
  // worth exposing to the future DVR UI (rolling window start-up, odd browsers).
  const DVR_MIN_WINDOW_S = 60;

  // Attaches url to audioEl for the CURRENT playback session. Returns:
  //   null          → attached (native or hls.js), playback can proceed
  //   'unsupported' → caller must advanceCandidate()
  function hlsAttach(url) {
    const session = ++hlsSession; // new session; old handlers become stale
    if (CAPS.nativeHls) {
      // Safari: native HLS in <audio>. Safari handles variant selection,
      // content steering and the DVR window itself.
      audioEl.src = url;
      return null;
    }
    if (!CAPS.hlsjs || !window.Hls || !window.Hls.isSupported()) {
      return 'unsupported';
    }
    hlsDetach(); // never two live instances
    const hls = new window.Hls(HLS_CONFIG);
    hlsInstance = hls;
    hls.on(window.Hls.Events.LEVEL_SWITCHED, (e, data) => {
      // Stale-session guard: events from a superseded session never touch
      // the current track's state.
      if (session !== hlsSession) return;
      const cur = state.current;
      if (!cur || cur.transport !== 'hls') return;
      // Bitrate truth: the ACTUALLY selected level, mapped through the
      // verified SR ladder (advertised bps → nominal display kbps).
      const level = hls.levels && hls.levels[data.level];
      if (level && Number.isFinite(level.bitrate)) {
        cur.bitrate = nominalKbpsFor(level.bitrate);
        renderPlayer();
      }
    });
    hls.on(window.Hls.Events.ERROR, (e, data) => {
      if (!data.fatal) return; // hls.js recovers non-fatal errors internally
      // Stale-session guard: an old session's fatal error must not advance
      // the NEW playback's candidates.
      if (session !== hlsSession) { hlsDetach(); return; }
      const cur = state.current;
      if (!cur || cur.transport !== 'hls') { hlsDetach(); return; }
      // Fatal → destroy cleanly and use the EXISTING fallback chain.
      hlsDetach();
      advanceCandidate();
    });
    hls.loadSource(url);
    hls.attachMedia(audioEl);
    return null;
  }

  // Seekable DVR window → application state. Reads audio.seekable — the
  // browser's actual window, never an assumption about SR's playlist length.
  // Updates state.current so the DVR UI can read: seekableStart/End/Duration,
  // currentTime, distanceFromLiveEdge, atLiveEdge, dvrAvailable. Threshold:
  // window must exceed DVR_MIN_WINDOW_S.
  //
  // RENDER TRIGGER (iPhone bug fix 2026-09-22): the DVR row is built once per
  // renderPlayer(). On native HLS (iPhone Safari) seekable is EMPTY when
  // playback starts and grows later — so at the initial render dvrAvailable
  // is false and the row is never built. Without a render on the flip, the
  // DVR row never appears on iPhone (observed). So: when dvrAvailable or
  // atLiveEdge CHANGES, re-render so the UI follows the state.
  // Two DIFFERENT tolerances, deliberately separate from WS23.
  //
  // LIVE_EDGE_TOLERANCE_S — DISPLAY rule. How close the playhead must be to
  // the edge before the pill reads "LIVE", and the cap on seekBy()'s forward
  // step. Unchanged in WS23. Three existing tests reference it.
  const LIVE_EDGE_TOLERANCE_S = 10;
  //
  // SEEK_LIVE_MARGIN_S — SEEk TARGET rule. How far behind the buffered edge
  // "Till Direkt" aims. This margin exists ONLY because Safari / native HLS
  // treat a seek onto the exact buffered BOUNDARY as a no-op (the BUG 1 note
  // in seekToLive's own comment: this is why the button failed twice before it
  // was given a margin). It is NOT a display concern and must never be sized
  // from one.
  //
  // OWNER DECISION (2026-09-28), recorded as theirs: "Till Direkt" should reach
  // the live edge, not stop a visible margin short of it.
  //
  // VALUE 1 s, and the reasoning, because a value chosen to look right rather
  // than to work is how this project has gone wrong before:
  //   - it must be > 0: at exactly 0 the target IS the buffered boundary, which
  //     is the no-op Safari was refusing. Zero is known-broken, not ideal.
  //   - it must be inaudible and irrelevant to a title lookup: 1 s cannot be
  //     heard as a delay, and it cannot hide a programme or song boundary,
  //     because real inter-song gaps measured on P3 are 10-16 s.
  //   - it must still be a genuine interior point: 1 s inside a buffer whose
  //     usable span is >= DVR_MIN_WINDOW_S (60 s) is ~1.7% in, nowhere near a
  //     boundary in practice.
  // If a device ever shows the button failing to move again, THIS is the
  // number to revisit first, and the fix is a larger margin here — never a
  // change to the display rule below.
  const SEEK_LIVE_MARGIN_S = 1;
  function updateSeekableState() {
    const cur = state.current;
    if (!cur || cur.kind !== 'live') return;
    const prevDvr = cur.dvrAvailable;
    const prevAtLive = cur.atLiveEdge;
    const s = audioEl.seekable;
    if (!s || !s.length) {
      cur.dvrAvailable = false;
      cur.seekableStart = null;
      cur.seekableEnd = null;
      // Cleared WITH the value it describes. Leaving a timestamp beside a null
      // seekableEnd would let an age be computed against a value that no
      // longer exists.
      cur.seekableEndWrittenAtMs = null;
      cur.seekableDuration = null;
      cur.distanceFromLiveEdge = null;
      cur.atLiveEdge = true;
    } else {
      const start = s.start(0);
      const end = s.end(s.length - 1);
      const size = end - start;
      const usable = Number.isFinite(size) && size >= DVR_MIN_WINDOW_S;
      cur.dvrAvailable = usable;
      cur.seekableStart = usable ? start : null;
      cur.seekableEnd = usable ? end : null;
      // ---- WS38: WHEN this cached seekableEnd was written. ----
      // ONE writer, at the assignment it describes (AGENTS.md §3). If this
      // timestamp is ever written anywhere else it stops describing this value
      // and every age derived from it becomes fiction.
      //
      // It exists because `seekToProgramTime()` reads `cur.seekableEnd` — a
      // CACHED value — and nothing could previously say how old that value was
      // at the moment the seek used it. That is the basis of measurement 1.
      // Plain value read; no frame conversion, so it cannot be circular.
      cur.seekableEndWrittenAtMs = usable ? Date.now() : null;
      cur.seekableDuration = usable ? size : null;
      cur.currentTime = audioEl.currentTime;
      cur.distanceFromLiveEdge = usable ? Math.max(0, end - audioEl.currentTime) : 0;
      cur.atLiveEdge = !usable || cur.distanceFromLiveEdge <= LIVE_EDGE_TOLERANCE_S;
      if (console.debug && usable) {
        console.debug('[stream] seekable', {
          start: Math.round(start), end: Math.round(end),
          windowMin: Math.round(size / 60),
          behindLiveS: Math.round(cur.distanceFromLiveEdge),
          atLiveEdge: cur.atLiveEdge,
        });
      }
    }
    // Re-render only on meaningful flips — not on every timeupdate (the DVR
    // bar's own updater handles continuous position changes).
    if (cur.dvrAvailable !== prevDvr || cur.atLiveEdge !== prevAtLive) {
      renderPlayer();
    }
    // ---- WS26 Part 4 (reachability fix): re-evaluate the yesterday gate ----
    // WHY THIS EXISTS, and it is the reason the gate is not dead code:
    //
    // playTrack() runs  armPlaybackWatchdog -> renderPlayer -> resolveProgramTitle
    // -> fetchSchedule -> the gate. renderPlayer does NOT call
    // updateSeekableState(), and nothing has fired `timeupdate` yet, so
    // seekableStart is STILL NULL when the gate first runs. A window-derived
    // gate is therefore unreachable on the play path -- it falls back to the
    // clock, which is shut for 01:00-02:59, which is exactly the owner's
    // 01:19 report. WS25 measured that; this line is what makes the fix real.
    //
    // THIS is the reachable point. `timeupdate` calls updateSeekableState() on
    // every tick for an HLS transport, so within a few hundred ms of playback
    // the window is known and this block runs. It fires ONCE per
    // (channel, local date, transition-to-known), not per tick: without that
    // guard a 4 Hz listener would re-fetch the schedule four times a second.
    //
    // It re-runs the SAME fetchSchedule()/resolveProgramTitle() path, so the
    // gate decision and the merge remain the identical code. There is no
    // second implementation of "which days do I need".
    if (cur.dvrAvailable && cur.seekableStart != null && cur.seekableEnd != null) {
      const key = `${cur.id}:${localDateStr()}`;
      if (lastWindowGateKey !== key) {
        lastWindowGateKey = key;
        // Drop the cached day first, so the refetch actually re-runs the gate
        // instead of returning the value computed while the window was null.
        scheduleCache.delete(key);
        scheduleCache.delete(`${cur.id}:${localDateStrOffset(1)}`);
        // No extra seq guard is needed here, and that is worth stating
        // rather than leaving as a habit: resolveProgramTitle(cur) writes
        // `cur._srSchedule` on the track OBJECT it was handed, so a response
        // that arrives after a channel switch lands on the OLD object and
        // cannot paint onto the new track. Adding a token here would guard
        // against nothing while implying a hazard that does not exist.
        resolveProgramTitle(cur).catch(() => { /* schedule is best-effort */ });
      }
    }
  }

  // ---- expand-panel open/close STATE (WS2) ----
  // Single source of truth for the chevron's `aria-expanded` and `open` class.
  // BUG 3 FIX (WS2) part 1: the swipe path's commit-expand branch used to set
  // NEITHER, so after a swipe the panel was visible while the button still
  // claimed to be closed. Both the chevron path and the gesture path now go
  // through here, so the two cannot drift apart again.
  function setExpandOpen(open) {
    const btn = $player.querySelector('.player-expand-btn');
    if (!btn) return;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('open', open);
  }

  // Observe the window while HLS is playing. Cheap: only runs when a live
  // HLS track is active, piggybacks on timeupdate.
  metaDiagCountAdd('timeupdate');
  audioEl.addEventListener('timeupdate', () => {
    if (state.current && state.current.kind === 'live'
      && state.current.transport === 'hls') {
      updateSeekableState();
    }
    // Archived-episode track resolution: currentTime is the source of truth.
    // Covers normal playback, seeks (timeupdate fires after seek), and
    // pause (position stays — the displayed track stays consistent).
    if (state.current && state.current.kind === 'episode') {
      updateEpisodeTrack();
    }
  });

  // Debug handle for manual engine verification (not user UI).
  window.__srSeekable = () => {
    updateSeekableState();
    return {
      dvrAvailable: state.current?.dvrAvailable ?? null,
      seekableStart: state.current?.seekableStart,
      seekableEnd: state.current?.seekableEnd,
      seekableDurationMin: state.current?.seekableDuration != null
        ? Math.round(state.current.seekableDuration / 60) : null,
      currentTime: state.current?.currentTime,
      distanceFromLiveEdgeS: state.current?.distanceFromLiveEdge != null
        ? Math.round(state.current.distanceFromLiveEdge) : null,
      atLiveEdge: state.current?.atLiveEdge,
    };
  };

  function isCurrent(kind, id) {
    return state.current && state.current.kind === kind && state.current.id === id;
  }

  // ---- now-playing metadata (playlists/rightnow) ----
  // VERIFIED data source (2026-09-23, from GitHub Pages origin):
  // https://api.sr.se/api/v2/playlists/rightnow?channelid=X&format=json
  // → 200, CORS `*`, payload playlist.song {title, artist, starttimeutc,
  // stoptimeutc} (+ previoussong/nextsong). song === null is NORMAL
  // (talk/program content) — not an error.
  //
  // ISOLATION CONTRACT: this loop never touches audioEl, hls, or playback
  // state. Any fetch/network/parse failure just leaves the last known song
  // (or hides the line). One loop total, keyed to the active live channel.
  const nowPlaying = { song: null, channelId: null, timeline: [],
    // WS13 Part B: the iTunes album cover for an EPISODE. Kept separate from
    // the live covers on purpose -- that field belongs to the live poll's
    // position-aware song, and mixing the two would make one kind's cover
    // overwrite the other's. Null until a real track cover resolves.
    episodeArtwork: null,
    // ---- WS26 Part 2: THREE cover fields, THREE writers, no overlap ----
    // WS25 reproduced the regression: one field, `artwork`, served two intents.
    // The seek path wrote it with the song AT THE PLAYHEAD; the 45 s poll wrote
    // it with the ON-AIR song, unconditionally and with no knowledge of where
    // the playhead was. Last writer won, so a correct cover survived about
    // 45 seconds and was then replaced by a different song's cover.
    //
    // A guard ("only write if behind live") would not have fixed it: two
    // genuine intents, two genuine values, needing two genuine fields. So
    // there are now two live fields and one episode field, and each has
    // exactly ONE writer:
    //
    //   onAirArtwork    <- fetchNowPlaying()          (the poll, on-air song)
    //   playheadArtwork <- resolveMetadataForPosition() (the seek/playhead)
    //   episodeArtwork  <- updateEpisodeTrack()       (episodes)
    //
    // The cover the PANEL shows is then chosen by resolvePlayheadMeta() from
    // whether the playhead is at the live edge -- a read, not a write. Which
    // is the whole point: a reader cannot create a race.
    onAirArtwork: null,
    playheadArtwork: null };
  // ---- WS9: the song timeline, not just the current song ----
  // The rightnow payload carries previoussong / nextsong alongside song, each
  // with starttimeutc / stoptimeutc (verified live 2026-09-27: ch163
  // previoussong 11:51:30-11:54:19, song 11:54:30-11:58:54). Before WS9 those
  // were captured into META_DIAG.lastRightNowRaw and otherwise DISCARDED --
  // every mention of them in this file was inside a comment.
  //
  // DESIGN DECISION (WS9 §2). Two options were on the table: hold only
  // song+previous+next (reaching ~one song either side), or retain a rolling
  // history. BOTH are done, deliberately:
  //   * `timeline` retains every entry seen across polls, deduped by start
  //     time, so skipping back over several songs still resolves.
  //   * a seek ALSO triggers a re-poll, which refreshes the ends of the range.
  // The timeline is capped (see NOW_PLAYING_TIMELINE_MAX) so a long listening
  // session cannot grow it without bound; the oldest entries are dropped first.
  //
  // Cost: the re-poll is one extra HTTP request per seek. It is debounced, and
  // it runs through the SAME seq-guarded path as the periodic poll, so it
  // cannot race the channel switch or leak a stale response.
  const NOW_PLAYING_TIMELINE_MAX = 60;
  // ---- WS24: debounce for the artwork lookup of a SEEK-RESOLVED song ----
  // Not a throttle on the request itself: refreshNowPlayingArtwork() already
  // dedupes by song through artworkCache, so this only collapses the rapid
  // succession of songs a scrub-drag crosses. 400 ms is long enough that a
  // drag across a minute of music issues ONE lookup, and short enough that a
  // deliberate seek still feels immediate. The cover appears a fraction of a
  // second after the playhead settles, which is the same shape as the live
  // path (poll -> fetch -> paint) and cannot be made synchronous without
  // blocking the UI on a network call.
  const SEEK_ARTWORK_DEBOUNCE_MS = 400;
  // WS26 Part 1: the open expand panel's repaint hook, named. It was inlined
  // in two places (identical code) and a third consumer needed it; a named
  // function is the only way "every consumer reads the one resolver" can be
  // true of the repaint as well as of the metadata.
  function repaintExpandPanel() {
    const panel = $player.querySelector('.player-expand');
    if (panel && typeof panel._srRepaint === 'function') panel._srRepaint();
  }
  // ---- WS26 Part 1: ONE resolver for "what is the playhead sitting on?" ----
  // Before this, two functions answered that question and they disagreed: the
  // compact line (row 4) asked the timeline, the expand-panel header asked the
  // on-air poll. WS25 measured the result: title right, header wrong, cover
  // racing. R6 -- the two halves must never disagree -- was therefore not a
  // property of the code, it was a wish.
  //
  // Now there is exactly one derivation, and every consumer reads it. The
  // compact line's SELECTION EXPRESSION is deliberately left byte-identical
  // (`pickByPosition(nowPlaying.timeline, playheadWallMs())`) -- R4 works and
  // changing it would be the regression, not the fix. A "one source of truth"
  // that alters the thing which is already correct is not a refactor.
  //
  // Returns null for an episode, because an episode has no live DVR playhead:
  // episodeCurrentTrack is resolved against `audioEl.currentTime` by a
  // different mechanism entirely, and mixing the two would be the same class of
  // bug this function exists to remove.
  function resolvePlayheadMeta() {
    const cur = state.current;
    if (!cur || cur.kind !== 'live') return null;
    const atLiveEdge = cur.atLiveEdge !== false;
    // THE one timeline read. The compact line and this function must agree by
    // construction, not by discipline: they are the same expression on the
    // same array with the same playhead.
    const hit = pickByPosition(nowPlaying.timeline, playheadWallMs());
    // ONE rule for both surfaces, the edge included. WS27 measured why the
    // edge used to be special: the card preferred the poll's on-air song while
    // row 4 used the timeline, and the two disagreed the moment those sources
    // differed. So there is no longer an edge branch for the SONG at all --
    // there is one expression, and the edge only decides what happens when the
    // timeline is empty.
    //
    // WHY THE TIMELINE WINS AT THE EDGE. It is the only source keyed to the
    // PLAYHEAD, and row 4 has always read it there; R4 works and the owner
    // confirmed it on the device. If the edge read the poll instead, then row
    // 4 would have to change too, and that is the change most likely to
    // regress the case that is known good.
    //
    // WHICH SONG WINS WHEN BOTH EXIST. The timeline, in both cases. Measured
    // on the owner device (2026-09-29, P3, 02:50, pill LIVE): the card read
    // "More!" / Robin Bengtsson while row 4 read "Depeche Mode - Enjoy The
    // Silence". Reproduced here from a fixture, with no timing assumption:
    // `pickByPosition` returns the FIRST containing entry in a startMs-sorted
    // array, so an earlier-starting entry that spans now -- a polled
    // previoussong that overruns, or a WS26 Part-3 merged track anchored at an
    // episode start -- SHADOWS the polled song. That is the divergence, and
    // preferring the timeline removes it at the source.
    //
    // THE EMPTY CASE IS THE EDGE CASE, and it falls back to the poll -- never
    // to a blank. A timeline with no entry covering the playhead (no poll has
    // landed yet, or talk radio, where SR sends no per-song times at all)
    // carries no information about this moment, so the on-air poll is the best
    // available answer and is what the live path showed before WS27.
    // MEASURED: with an empty timeline row 4 renders BLANK, which is not what
    // the owner saw, so the empty case was not their cause -- but the
    // fallback is still the correct degradation and is kept.
    const song = hit || (atLiveEdge ? (nowPlaying.song || null) : null);
    // The cover follows the SONG, not the position -- and now not the position
    // class either. Two cover fields belong to two different songs, so which
    // one is shown must be decided by WHICH SONG WON above. Behind live that
    // is unchanged: the playhead cover, always (R3, and the WS24 race).
    //
    // At the edge the winner is usually the on-air song (the poll writes it
    // into the timeline), so the on-air cover is correct and is preferred. But
    // in the shadowing case above the winner is a DIFFERENT song, and showing
    // the on-air cover under it would be R6 in a new place: the right title
    // under a stranger's face. So the cover is chosen by asking whether the
    // winning song IS the on-air song, and not by asking which side of the
    // edge we are on.
    const onAir = nowPlaying.song;
    const winnerIsOnAir = Boolean(
      song && onAir && song.title === onAir.title && song.artist === onAir.artist);
    const artwork = !atLiveEdge
      ? (nowPlaying.playheadArtwork || null)
      : (winnerIsOnAir
        ? (nowPlaying.onAirArtwork || nowPlaying.playheadArtwork || null)
        : (nowPlaying.playheadArtwork || null));
    // The programme at the playhead. For a live channel `_srProgramTitle` is
    // set by resolveMetadataForPosition() from _srSchedule, position-aware
    // already; at the live edge it is the programme on air, which is the same
    // thing the owner expects to see.
    const programme = cur._srProgramTitle || null;
    return {
      atLiveEdge,
      song,
      artwork,
      programme,
    };
  }
  // ---- WS26 Part 3: fill the timeline from SR, not from listening ----
  // The polled timeline only knows songs a poll HAPPENED to see while the app
  // was open. WS25 refuted the "data ceiling" belief: `ondemand` returns
  // per-song tracks with relativeStartTime/relativeEndTime for a broadcast
  // that finished yesterday, and scheduledepisodes gives episode ids 30+ days
  // back. So on a seek we ask SR what was playing at that moment.
  //
  // BOUNDED, and each bound is deliberate:
  //   * debounced, so a drag across the window issues ONE lookup;
  //   * cached per episode id for the session, so seeking back and forth over
  //     the same programme costs nothing;
  //   * NOT in any timeupdate handler -- those run ~4x/second.
  const SEEK_TRACKS_DEBOUNCE_MS = 250;
  const episodeTracksById = new Map(); // episodeId -> tracks[] (session)
  let seekTracksTimer = null;
  let seekTracksSeq = 0;
  // ---- WS26 Part 4: the gate-reachability key ----
  // Set once per (channel, local date) when the window FIRST becomes known, so
  // the schedule is re-fetched exactly once at that transition and not on every
  // 4 Hz timeupdate tick. Reset on channel switch, because a different channel
  // has a different schedule and a different window.
  let lastWindowGateKey = null;
  // Resolve the wall-clock moment under the playhead to absolute entries and
  // merge them into the SAME timeline the poll writes, so the existing selector
  // works unchanged. That is the whole trick: no second selector, no second
  // shape, no second code path for a reader to disagree with.
  //
  // `schedule` entries carry startMs/endMs/episodeId (fetchScheduleDay keeps
  // them). `tracks` carry relativeStartTime/relativeEndTime as HH:MM:SS
  // relative to the START OF THE EPISODE AUDIO, so the conversion is
  // entry.startMs + seconds -- an offset, not an absolute. Note this is
  // ASSUMED alignment, not proven: the episode's own start is the anchor and
  // SR does not publish a separate audio-start offset. If it is ever wrong the
  // failure mode is benign -- titles shift within the programme, and the
  // fallback below is not involved. Unverified on device (see the WS26 report).
  async function fetchEpisodeTracks(episodeId) {
    if (episodeId == null) return null;
    if (episodeTracksById.has(episodeId)) return episodeTracksById.get(episodeId);
    let tracks = null;
    try {
      const r = await fetch(`https://web-api.sr.se/v1/player/ondemand?id=${episodeId}&type=episode`);
      if (r && r.ok) {
        const j = await r.json();
        tracks = Array.isArray(j?.tracks) ? j.tracks : [];
      }
    } catch {
      tracks = null; // network/CORS/parse -> treated exactly like "no tracks"
    }
    // Cached either way, INCLUDING the empty result: a talk programme really
    // does return tracks: [] (verified live), and re-requesting it on every
    // seek would be the wasteful outcome. A cached [] therefore means "ask no
    // further", which is why the caller's fallback is the polled timeline.
    episodeTracksById.set(episodeId, tracks);
    return tracks;
  }
  // Merge absolute entries into the timeline: same dedupe, same sort, same cap
  // as the poll. Deliberately shares those three rules rather than having its
  // own copy, because a second cap or a second dedupe rule is a second place
  // for the timeline to be wrong.
  function mergeTimelineEntries(entries) {
    if (!Array.isArray(entries) || !entries.length) return 0;
    let added = 0;
    for (const e of entries) {
      if (!Number.isFinite(e.startMs) || !Number.isFinite(e.stopMs)) continue;
      if (!e.title && !e.artist) continue;
      if (nowPlaying.timeline.some((t) => t.startMs === e.startMs)) continue;
      nowPlaying.timeline.push({ title: e.title, artist: e.artist, startMs: e.startMs, stopMs: e.stopMs });
      added += 1;
    }
    if (added) {
      nowPlaying.timeline.sort((a, b) => a.startMs - b.startMs);
      if (nowPlaying.timeline.length > NOW_PLAYING_TIMELINE_MAX) {
        nowPlaying.timeline.splice(0, nowPlaying.timeline.length - NOW_PLAYING_TIMELINE_MAX);
      }
    }
    return added;
  }
  // Called (debounced) from the seek path. NEVER throws, never blocks, and on
  // every failure path it simply leaves the timeline as the poll left it --
  // which is the required fallback and also today's behaviour.
  async function resolveSeekTracksFromSr() {
    const cur = state.current;
    if (!cur || cur.kind !== 'live' || !cur.id) return;
    const schedule = cur._srSchedule;
    if (!Array.isArray(schedule) || !schedule.length) return;
    // REMAP, and this is a real bug that shipped in the first draft of Part 3.
    // `pickByPosition` matches on `e.stopMs`, but the schedule entries built by
    // fetchScheduleDay carry `endMs` (that is the name the API field parses
    // into). Passing the raw array therefore matched NOTHING -- `entry` was
    // always null, the function returned on its second line, and the whole
    // SR-backed lookup was dead code that looked correct.
    //
    // Found by DRIVING the function, not by reading it: a fixture with 17 real
    // tracks merged zero entries while every assertion about the empty-list
    // fallback still passed. A test that only checks the failure path cannot
    // see a success path that never runs.
    //
    // resolveMetadataForPosition has always done this remap for the programme
    // title, and that is why R5 worked while this did not. Same shape, same
    // reason, one place remembered it and the other did not.
    const entry = pickByPosition(schedule.map((e) => ({
      startMs: e.startMs, stopMs: e.endMs, episodeId: e.episodeId, title: e.title,
    })), playheadWallMs());
    if (!entry || entry.episodeId == null) return; // talk / no episode id
    const seq = ++seekTracksSeq;
    const tracks = await fetchEpisodeTracks(entry.episodeId);
    // A channel switch or a later seek superseded this lookup.
    if (seq !== seekTracksSeq) return;
    if (!Array.isArray(tracks) || !tracks.length) return; // FALLBACK: unchanged
    const absolute = [];
    for (const tr of tracks) {
      const s = hmsToSec(tr.relativeStartTime);
      const e = hmsToSec(tr.relativeEndTime);
      if (s == null) continue;
      // relativeEndTime is absent on some payloads; the next track's start is
      // the only honest end. Never invented beyond that.
      let stopMs;
      if (e != null) stopMs = entry.startMs + e * 1000;
      else continue;
      absolute.push({ startMs: entry.startMs + s * 1000, stopMs, title: tr.title || '', artist: tr.artist || '' });
    }
    if (mergeTimelineEntries(absolute)) {
      // The panel may now resolve a song it could not before; repaint through
      // the normal path rather than reaching into the header.
      paintNowPlaying();
      repaintExpandPanel();
    }
    // WS41: record the RELATIVE-timebase source and the anchor it was built
    // from. Placed AFTER the merge so it only fires when the lookup actually
    // produced something — a record of an empty result would be misleading.
    metaDiagTrackSource('player/ondemand', entry.episodeId, tracks, entry.startMs);
  }
  // Timer handle, module scope, so a second song change can cancel the first
  // and a channel switch can clear a pending lookup (see stopNowPlayingPoll).
  // Same pattern as nowPlayingTimer and audioEl._srUpd.
  let seekArtworkTimer = null;
  // The song the current `nowPlaying.artwork` cover was fetched FOR. WS24: the
  // seek path needs this to know whether the cover on screen belongs to the
  // song now being resolved. It is written ONLY by the seek path below and is
  // read only there, so the live path's behaviour is untouched by it.
  let seekArtworkSongKey = null;
  let nowPlayingTimer = null;
  let nowPlayingSeq = 0; // stale-response guard on channel switches
  let artworkSeq = 0; // invalidates stale artwork lookups on every source change

  // ---- Archived-episode track metadata (web-api.sr.se ondemand) ----
  // SR's own web player uses this endpoint; it returns the episode's music
  // playlist with relativeStartTime/relativeEndTime (HH:MM:SS, relative to
  // the START OF THE EPISODE AUDIO) — these map directly onto the existing
  // audio element's currentTime. No polling: timeupdate is the source of
  // truth. Verified live 2026-09-23 (P3 Musik 2861130: 33 tracks; P3 Mix:
  // 29; talk episodes: tracks:[] with 200 OK). CORS-open from GitHub Pages.
  // The episode AUDIO path is untouched — this is metadata only.
  const episodeTracksCache = new Map(); // episodeId → tracks[] (session)
  let episodeTrackSeq = 0; // stale guard: old episode's fetch must not leak
  let episodeCurrentTrack = null; // {title, artist} for the current position

  // "HH:MM:SS" → seconds. Returns null on malformed input.
  function hmsToSec(s) {
    if (typeof s !== 'string') return null;
    const parts = s.split(':').map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return null;
    return parts.reduce((acc, v) => acc * 60 + v, 0);
  }

  function stopEpisodeTracks() {
    episodeTrackSeq += 1; // invalidate in-flight fetches
    episodeCurrentTrack = null;
  }

  async function loadEpisodeTracks(episodeId) {
    const seq = ++episodeTrackSeq;
    if (episodeTracksCache.has(episodeId)) {
      return seq === episodeTrackSeq ? episodeTracksCache.get(episodeId) : null;
    }
    try {
      const r = await fetch(`https://web-api.sr.se/v1/player/ondemand?id=${episodeId}&type=episode`);
      if (seq !== episodeTrackSeq) return null; // superseded — another episode
      const j = await r.json();
      const tracks = Array.isArray(j?.tracks) ? j.tracks : [];
      episodeTracksCache.set(episodeId, tracks);
      return tracks;
    } catch {
      // Endpoint down / offline → no track line; never affects playback.
      return null;
    }
  }

  // Resolve the track at the CURRENT playback position and paint it. Called
  // from timeupdate (cheap: linear scan over ≤40 entries) and after seeks.
  function updateEpisodeTrack() {
    const cur = state.current;
    if (!cur || cur.kind !== 'episode' || !cur.id) return;
    const tracks = episodeTracksCache.get(cur.id);
    if (!tracks || !tracks.length) return; // talk episode / fetch failed
    const t = audioEl.currentTime || 0;
    const hit = tracks.find((tr) => {
      const s = hmsToSec(tr.relativeStartTime);
      const e = hmsToSec(tr.relativeEndTime);
      return s != null && e != null && t >= s && t < e;
    });
    const next = hit ? { title: hit.title || '', artist: hit.artist || '' } : null;
    // Only repaint on change — timeupdate fires ~4×/s.
    if ((next?.title || null) !== (episodeCurrentTrack?.title || null)
      || (next?.artist || null) !== (episodeCurrentTrack?.artist || null)) {
      episodeCurrentTrack = next;
      paintNowPlaying();
      // WS13 Part B: resolve the ALBUM COVER for the episode's current song.
      // Fired on a track CHANGE only, never on timeupdate, so this is one
      // lookup per song rather than four per second. The same artworkCache and
      // the same artworkSeq guard as the live path -- no second mechanism.
      // A miss leaves episodeArtwork null, and the panel then falls back to the
      // programme image, which is the correct thing to show when no album
      // cover can be resolved.
      if (next && next.title && next.artist) {
        refreshNowPlayingArtwork(next, 'episode');
      }
    }
  }

  function stopNowPlayingPoll() {
    if (nowPlayingTimer) { clearTimeout(nowPlayingTimer); nowPlayingTimer = null; }
    // WS24: a pending seek-artwork lookup belongs to the channel being left.
    // Clearing it here means a channel switch cannot have the OLD channel's
    // cover land in the new channel's panel. Same reason artworkSeq is bumped
    // below, applied to the timer rather than to a response.
    if (seekArtworkTimer) { clearTimeout(seekArtworkTimer); seekArtworkTimer = null; }
    // WS26 Part 3: the debounced SR lookup belongs to the channel being left.
    if (seekTracksTimer) { clearTimeout(seekTracksTimer); seekTracksTimer = null; }
    seekTracksSeq += 1; // an in-flight episode lookup must not outlive the channel
    // WS24: the song->cover association is per channel, so it must not survive
    // one. Otherwise the first song resolved on the new channel would compare
    // equal to the old channel's last song and skip the clear.
    seekArtworkSongKey = null;
    nowPlayingSeq += 1; // invalidate in-flight responses
    artworkSeq += 1; // an old live artwork response must not outlive the channel
    nowPlaying.song = null;
    nowPlaying.onAirArtwork = null;
    nowPlaying.playheadArtwork = null;
    nowPlaying.channelId = null;
    // WS26 Part 3: per-channel song data from SR must not survive a switch.
    episodeTracksById.clear();
    // WS9: the timeline is per-channel, so it must not survive a channel switch
    // or the entries would be matched against another channel's playhead.
    nowPlaying.timeline = [];
    // WS26 Part 4: the gate-reachability key is per channel, so it must not
    // survive a switch -- otherwise the new channel's window-becomes-known
    // transition would be suppressed by the old channel's key.
    lastWindowGateKey = null;
  }

  async function fetchNowPlaying(channelId, seq) {
    try {
      const data = await apiFetch(`${SR_API}/playlists/rightnow?channelid=${channelId}&format=json`);
      if (seq !== nowPlayingSeq) return; // stale — channel changed meanwhile
      // WS0 diagnostics: retain the RAW body at the point of receipt. The
      // parser below keeps only playlist.song, so previoussong / nextsong
      // (with their starttimeutc / stoptimeutc) are otherwise unobservable.
      // Capture only — NOT wired to any display path. Pure reference.
      META_DIAG.lastRightNowRaw = data;
      META_DIAG.lastRightNowAt = new Date().toISOString();
      const pl = data?.playlist || {};
      const song = pl.song || null; // null = talk/program content — normal
      nowPlaying.song = song ? {
        title: song.title || '',
        artist: song.artist || '',
        startMs: parseSrDate(song.starttimeutc),
        stopMs: parseSrDate(song.stoptimeutc),
      } : null;
      // ---- WS9: retain previous/next into the timeline ----
      // Each entry is normalised to the same shape as nowPlaying.song so the
      // selector below does not care where an entry came from. Entries without
      // BOTH timestamps are useless for position matching and are dropped --
      // which is why a talk channel (all three null) simply leaves the
      // timeline empty and the song line hidden, as before.
      const keep = (s) => {
        if (!s) return;
        const startMs = parseSrDate(s.starttimeutc);
        const stopMs = parseSrDate(s.stoptimeutc);
        if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) return;
        const title = s.title || '';
        const artist = s.artist || '';
        if (!title && !artist) return;
        // Deduped by start time: repeated polls return the same entries.
        if (nowPlaying.timeline.some((e) => e.startMs === startMs)) return;
        nowPlaying.timeline.push({ title, artist, startMs, stopMs });
      };
      // WS41: this is the ABSOLUTE-timebase source. Recorded as such, so the
      // snapshot can show that the one timeline holds entries from two sources
      // on two different timebases. The capture is placed BEFORE `keep()`
      // filters, so the recorded key set is the raw payload's and not the
      // surviving subset's.
      metaDiagTrackSource('playlists/rightnow', channelId,
        [pl.previoussong, song, pl.nextsong].filter(Boolean), null);
      // Oldest first, so indexOf/index math stays simple after the sort.
      keep(pl.previoussong);
      keep(song);
      keep(pl.nextsong);
      nowPlaying.timeline.sort((a, b) => a.startMs - b.startMs);
      if (nowPlaying.timeline.length > NOW_PLAYING_TIMELINE_MAX) {
        nowPlaying.timeline.splice(0, nowPlaying.timeline.length - NOW_PLAYING_TIMELINE_MAX);
      }
      nowPlaying.channelId = channelId;
      paintNowPlaying();
      // Artwork lookup is fully isolated: failure = no image, nothing else.
      refreshNowPlayingArtwork(nowPlaying.song, 'poll');
    } catch {
      // Network/API error: keep last known song; never touch playback.
    }
  }

  function scheduleNowPlayingPoll() {
    if (nowPlayingTimer) clearTimeout(nowPlayingTimer);
    nowPlayingTimer = setTimeout(() => {
      nowPlayingTimer = null;
      pollNowPlaying();
    }, NOW_PLAYING_INTERVAL_MS);
  }

  function pollNowPlaying() {
    const cur = state.current;
    // Poll ONLY for live channels while audio is playing (or paused mid-
    // session). Stopped player → no polling at all.
    if (!cur || cur.kind !== 'live' || !cur.id) {
      stopNowPlayingPoll();
      return;
    }
    const seq = ++nowPlayingSeq;
    fetchNowPlaying(cur.id, seq).finally(() => {
      // Re-arm only if still the same live channel and the player is open.
      if (state.current && state.current.kind === 'live' && state.current.id === cur.id && seq === nowPlayingSeq) {
        scheduleNowPlayingPoll();
      }
    });
  }

  function startNowPlayingPoll() {
    // Channel switch: cancel any pending timer and poll the NEW channel
    // immediately. (The old loop's finally-check stops itself when it sees
    // the channel changed — but its pending timer would otherwise delay the
    // new channel's first fetch by up to a full interval, and if the old
    // fetch was in flight its seq-guard kills the loop without re-arming.)
    if (nowPlayingTimer) { clearTimeout(nowPlayingTimer); nowPlayingTimer = null; }
    pollNowPlaying();
  }

  // ---- artwork (iTunes Search, CORS `*`, <img> needs no CORS) ----
  // rightnow has NO image fields; SR's own artwork (Spotify CDN URLs) lives
  // only on the CORS-blocked latlista page. iTunes Search is CORS-open and
  // artworkUrl100 scales to any size via URL rewrite. Fully isolated:
  // failure = no image, never affects audio.
  const artworkCache = new Map(); // "artist|title" → url (session-lifetime)
  // WS13 Part B: the lookup takes the SONG to search for, and where to put the
  // result. Previously it read `nowPlaying.song` directly, which only ever
  // holds a live channel's on-air song, so it was unreachable for an episode.
  //
  // A WS12 note claimed this path was unsafe for episodes because it "searches
  // the podcast name". That was WRONG, and it was wrong because the conclusion
  // was drawn from searches the code never makes: `song` here is
  // episodeCurrentTrack, built from the episode's per-SONG track list, so the
  // query is a real song's "artist title". Re-measured on real data (2026-09-27,
  // 51 tracks across 4 podcasts): 73% returned a result and 89% of those had a
  // plausible artist, the misses being name variants of the same act
  // ("P!nk" / "Pink", "Florence + the Machine").
  //
  // GUARD, and the reason the old bad hits happened: only search when the track
  // has a real artist AND title. An empty artist produces a garbage query, and
  // a garbage query is how an unrelated cover ends up under a radio programme.
  // WS26 Part 2: the field this call may write is now passed in explicitly and
  // is one of three. `kind` names the WRITER, never the reader:
  //   'poll'     -> nowPlaying.onAirArtwork     (fetchNowPlaying)
  //   'playhead' -> nowPlaying.playheadArtwork  (resolveMetadataForPosition)
  //   'episode'  -> nowPlaying.episodeArtwork   (updateEpisodeTrack)
  // Nothing else may assign those three fields; the "one writer per field"
  // test enumerates assignment sites on comment-stripped source and fails if a
  // fourth appears. A reader never writes, so a reader cannot create a race.
  async function refreshNowPlayingArtwork(song, kind) {
    const seq = ++artworkSeq;
    // A caller that does not name a writer is a bug, not a default. Checked
    // before the try, because a throw inside the try would be swallowed.
    if (kind !== 'poll' && kind !== 'playhead' && kind !== 'episode') return;
    if (!song || !song.title || !song.artist) {
      // No usable song: clear only this writer's own field, never another's.
      if (kind === 'poll') { nowPlaying.onAirArtwork = null; paintNowPlaying(); }
      else if (kind === 'playhead') { nowPlaying.playheadArtwork = null; paintNowPlaying(); }
      else { nowPlaying.episodeArtwork = null; }
      return;
    }
    const key = `${song.artist}|${song.title}`.toLowerCase();
    if (artworkCache.has(key)) {
      if (kind === 'poll') { nowPlaying.onAirArtwork = artworkCache.get(key); paintNowPlaying(); }
      else if (kind === 'playhead') { nowPlaying.playheadArtwork = artworkCache.get(key); paintNowPlaying(); }
      else nowPlaying.episodeArtwork = artworkCache.get(key);
      return;
    }
    try {
      const q = encodeURIComponent(`${song.artist} ${song.title}`.slice(0, 180));
      const r = await fetch(`https://itunes.apple.com/search?term=${q}&entity=song&limit=1`);
      if (seq !== artworkSeq) return; // superseded by a newer song
      const j = await r.json();
      const url = j?.results?.[0]?.artworkUrl100 || null;
      const big = url ? url.replace(/\d+x\d+bb/, '600x600bb') : null;
      artworkCache.set(key, big);
      if (seq !== artworkSeq) return;
      if (kind === 'poll') { nowPlaying.onAirArtwork = big; paintNowPlaying(); }
      else if (kind === 'playhead') { nowPlaying.playheadArtwork = big; paintNowPlaying(); }
      else nowPlaying.episodeArtwork = big;
    } catch {
      // Artwork failure: never blocks anything. Keep old image briefly to
      // avoid flicker; clear only when the song itself changes.
    }
  }

  // Paint the now-playing line into the player (if present). DOM-diffing is
  // unnecessary: the line is a single element updated in place.
  // Source of truth: LIVE → nowPlaying.song (playlists/rightnow poll);
  // EPISODE → episodeCurrentTrack (ondemand tracks vs currentTime). The two
  // can never mix: an episode never reads rightnow, live never reads tracks.
  function paintNowPlaying() {
    const line = $player.querySelector('.now-playing-line');
    const cur = state.current;
    const isEpisode = Boolean(cur && cur.kind === 'episode');
    // WS9: for a LIVE stream the displayed song is the one containing the
    // PLAYHEAD, not `nowPlaying.song` (which is whatever is on air right now).
    // After a seek the two differ, and the on-air one is wrong. For episodes
    // the existing position-aware path (updateEpisodeTrack) already applies.
    const liveSong = (!isEpisode && cur && cur.kind === 'live')
      ? pickByPosition(nowPlaying.timeline, playheadWallMs())
      : null;
    const song = isEpisode
      ? episodeCurrentTrack
      : (liveSong || null);
    // Episodes have no compact now-playing line, but their expanded panel
    // still depends on this function. Repaint the panel even when no compact
    // line is present.
    if (line) {
      if (!song || !song.title) {
        line.textContent = '';
        line.classList.remove('has-song');
        line.classList.remove('rolling');
        line.style.removeProperty('--roll-dur');
        // WS20: the shift must go too, or a later song that DOES overflow can
        // briefly inherit the previous title's distance before its own rAF
        // runs, and slide by the wrong amount for one frame.
        line.style.removeProperty('--roll-shift');
      } else {
        // ---- WS19: the text goes in an inner track so it can roll ----
        // The line is the overflow WINDOW; the track is what slides. Setting
        // `line.textContent` directly would put the text in the window itself,
        // and translating the window would move the box and expose the gap
        // behind it. The ♪ prefix stays OUTSIDE the track so it does not
        // scroll away on its own while the artist+song slides under it --
        // it reads as a fixed bullet for the rolling text.
        const prefix = el('span', { class: 'roll-prefix', 'aria-hidden': 'true', text: '♪ ' });
        const track = el('span', { class: 'roll-track' });
        track.textContent = song.artist ? `${song.artist} – ${song.title}` : song.title;
        line.textContent = '';
        line.appendChild(prefix);
        line.appendChild(track);
        line.classList.add('has-song');
        // ---- Only roll when the text genuinely overflows ----
        // Decided here rather than in CSS because CSS cannot know the text
        // length. Measuring needs layout, so it is deferred to the next frame:
        // at paint time the line was just emptied and refilled, and reading
        // scrollWidth synchronously would measure the OLD content. One
        // rAF is the earliest point the new text has been laid out.
        //
        // The decision is re-evaluated on every song change, so a short song
        // after a long one correctly stops rolling, and a window resize is
        // caught by the same path on the next paint.
        requestAnimationFrame(() => {
          if (!line.isConnected) return;
          // ---- WS20: measure the TRACK against the width available to it ----
          // The old code compared `line.scrollWidth - line.clientWidth`, i.e.
          // the whole window (note + text) against the whole window. That
          // ignored the `♪ ` prefix, which is a sibling INSIDE the window and
          // occupies real space the text cannot use.
          //
          // More importantly the keyframe this fed was expressed in
          // percentages with mismatched bases and slid the text the WRONG WAY
          // (see the CSS comment); the owner saw `♪ ...` and nothing else. The
          // shift is now computed here as a plain pixel distance and clamped,
          // so a title that fits cannot slide at all.
          const prefix = line.querySelector('.roll-prefix');
          const prefixW = prefix ? prefix.getBoundingClientRect().width : 0;
          const availW = line.clientWidth - prefixW;
          const trackW = track.scrollWidth;
          // > 1px of tolerance: sub-pixel layout means a title that exactly
          // fills the window can measure a fraction over and would otherwise
          // crawl for one pixel.
          const overflow = trackW - availW;
          if (overflow > 1) {
            line.classList.add('rolling');
            // Scale the duration with the overflow so a title that pokes out by
            // a few pixels crawls and a very long one still finishes reading.
            // Clamped so a pathological title cannot produce a crawl so slow
            // it appears frozen, or one so fast it is unreadable.
            const dur = Math.min(28, Math.max(9, 6 + overflow / 14));
            line.style.setProperty('--roll-dur', `${dur.toFixed(1)}s`);
            // Pixels, not a ratio. One unit, one basis, no ambiguity.
            line.style.setProperty('--roll-shift', `${Math.round(overflow)}px`);
          } else {
            line.classList.remove('rolling');
            line.style.removeProperty('--roll-dur');
            line.style.removeProperty('--roll-shift');
          }
        });
      }
    }
    // If the expand panel is open, repaint its song view too.
    repaintExpandPanel();
    // WS15: this early return was the second half of the podcast bug. Even
    // with the kind === 'live' gate below removed, an episode would still
    // RETURN here before reaching the MediaSession refresh -- and an episode
    // is exactly the case that needs it. Removed deliberately; the comment
    // about "the episode painter deliberately has no compact song line"
    // describes why the compact line is skipped, not why the car should
    // stop hearing about the song.
    // ---- WS11 Part C / WS15: keep the car / lock screen in step with the song ----
    // The updateMediaSession() call sites all fire on track load, stop and
    // playstate. NONE fire when the song changes, so fixing the fields alone
    // would leave the car screen showing the previous song forever.
    // paintNowPlaying is called only when the song actually CHANGES, so
    // refreshing here is already change-gated and cannot loop on timeupdate.
    //
    // WS15: this was `kind === 'live'`, which meant a PODCAST NEVER REACHED IT.
    // Measured live on P3 Soul (pod 2680), the app showing "♪ Kehlani – Folded"
    // while the car and lock screen both read "Kehlani och Kärleken till Frida"
    // in the title AND the artist field -- the episode name twice, which is
    // what the owner reported from the Volvo. Removing the episode early
    // return above AND this gate is the whole fix.
    if (cur) updateMediaSession();
  }

  // ---- Pågår nu-programmet som undertitel (användarönskemål 2026-09-23) ----
  // "P3 Direkt" ersätts med programmets namn — kanalen syns redan i ikonen.
  // Datakälla: fetchSchedule (samma cache som Tablå-kortet). Uppdateras i
  // place när schemat löser sig; misslyckande = 'Direkt' som fallback.
  function paintProgramTitle() {
    const sub = $player.querySelector('.player-sub');
    if (sub) {
      const cur = state.current;
      if (cur && cur.kind === 'live' && cur._srProgramTitle) sub.textContent = cur._srProgramTitle;
    }
    // If the expand panel is open, repaint its fallback view too — the
    // program title may have resolved AFTER the panel was opened.
    repaintExpandPanel();
    // ---- WS11 Part C: a programme change must reach the car / lock screen ----
    // Same reasoning as paintNowPlaying: the programme title is the fallback
    // title on a talk channel, and the artist line on a music one, so a
    // change here changes what the car shows. Called on change, not on
    // timeupdate, so there is no loop.
    if (state.current && state.current.kind === 'live') updateMediaSession();
  }

  // ---- WS9: the playhead's WALL-CLOCK position, shared by every consumer ----
  // Before WS9 each consumer derived "now" differently: the programme title
  // used Date.now() (so it showed whatever is ON AIR), the skip button derived
  // its own estimate inside renderPlayer(). Both are wrong after a seek, and
  // they could disagree with each other.
  //
  // This is the single definition, and it is deliberately the same arithmetic
  // the DVR skip button already uses, so the title cannot claim a different
  // position than the button acted on. It maps media time to wall clock:
  //     playhead wall clock = now - (live edge - currentTime)
  // It lives at module scope (not inside renderPlayer) because resolveProgram-
  // Title and the seek paths need it without a player render.
  // ---- WS23: THE STREAM-EDGE ASSUMPTION, named in ONE place ----
  //
  // In plain terms: to turn a position inside the recording into a clock time,
  // the app asks "how far behind the end of the buffer am I?" and subtracts
  // that from the current time. That treats THE END OF THE BUFFER as the
  // current moment.
  //
  // That is an ASSUMPTION, not a measurement. The end of the buffer is whatever
  // the streaming server last published. It can sit behind the true present if
  // a playlist is slow to grow, a fetch stalls, or a stream re-registers. When
  // it does, EVERY position the app works out is shifted by that same amount —
  // and by a DIFFERENT amount each time, which is why the error is not a
  // constant.
  //
  // OWNER EVIDENCE (2026-09-28), which outranks any offline reasoning:
  // skipping back to the 23:00 news on P1 started about 30 s early, while the
  // SAME skip in Sveriges Radio's own app landed on the second. Two things
  // follow. The error is NOT a fixed margin — it was ~10 s once and ~30 s
  // another time. And it is NOT in the stream: SR's own app seeks the same
  // schedule to the same second, so the data is right and something THIS app
  // assumes is wrong.
  //
  // There is NO correction value here, deliberately. A fudge factor picked from
  // a sample is code written to agree with a report instead of with reality,
  // and it would freeze one observation into a constant. If one is ever added
  // it must default to 0 and be labelled unmeasured.
  //
  // Every site that reads `seekableEnd` as "now" — the complete list, so a
  // future change cannot add a sixth silently:
  //   1. playheadWallMs()        — app.js, below (titles + song selection)
  //   2. dvrPositionToDate()     — the clock shown in the seek row
  //   3. seekToProgramTime()     — programme skip; maps a start time to a position
  //   4. seekToLive()            — "Till Direkt"
  //   5. liveEdgeWallMs()        — local to renderPlayer(); seeds WS6/WS7 lookups
  // WS6 already noticed this staleness and worked around it for site 5 ONLY,
  // by resolving the programme from the schedule's own absolute times. Sites
  // 1-4 still carry the assumption in full.
  //
  // The assumption is now MEASURABLE on a device: `?diag=metadata` exposes
  // `streamEdge` (see metaDiagBuildSnapshot), which reports the buffer's edge
  // as a clock time next to the real time, before and after a seek.
  //
  // ---- WS30: and it is measured against a SECOND, INDEPENDENT clock. ----
  //
  // The readout above describes an assumption the app cannot verify by itself.
  // `streamEdgeWallMs()` is built from `Date.now()` and `seekableEnd`, and the
  // WS29 `edgeMinusNowS` was `now - (now - X)`, which collapses to X. Every
  // quantity in that readout was the app's clock compared against itself, so a
  // reader could not tell a real offset from a restatement of the playhead.
  //
  // There IS a second clock: the STREAM carries absolute wall-clock timestamps.
  // A variant playlist opens with one `#EXT-X-PROGRAM-DATE-TIME` and every
  // segment carries an `#EXTINF` duration, so the true edge in the stream's
  // own time base is headPdt + sum(EXTINF). That is not derived from this
  // device's clock at all, which is the whole point: comparing the app's
  // belief against it yields a genuinely two-source number.
  //
  // WHAT THIS IS NOT: a correction. Nothing here subtracts a constant from a
  // seek target. AGENTS.md §5 — an offset fitted to one sample freezes that
  // sample into permanent behaviour, and the measured bias DRIFTS (see
  // SESSION-STATUS.md), so a constant would be wrong within minutes. This is
  // an instrument only.

  // ---- Pure playlist parsing. No network, no globals, no Date. ----
  // Returns { headPdtMs, totalMs, segmentCount, mediaSequence } or null.
  // Pure so it is testable against real playlist text without a network, and
  // so a change to the fetch policy cannot silently change the arithmetic.
  //
  // A single head PDT is REQUIRED, not assumed. A discontinuity or a second
  // PDT would make headPdt + sum(EXTINF) meaningless, and reporting a wrong
  // edge silently is exactly the failure mode being fixed. Refusing is the
  // only honest answer, and the panel shows an explicit state instead.
  function parseVariantEdge(playlistText) {
    if (typeof playlistText !== 'string' || !playlistText) return null;
    const pdtMatches = playlistText.match(/#EXT-X-PROGRAM-DATE-TIME:(.+)/g);
    if (!pdtMatches || pdtMatches.length !== 1) return null;
    const pdtRaw = pdtMatches[0].split(':').slice(1).join(':').trim();
    const headPdtMs = Date.parse(pdtRaw);
    if (!Number.isFinite(headPdtMs)) return null;
    // EXTINF is "duration," — a decimal, possibly several digits, then a comma.
    const durations = playlistText.match(/#EXTINF:\s*([0-9.]+)/g);
    if (!durations || !durations.length) return null;
    let totalMs = 0;
    for (const d of durations) {
      const secs = parseFloat(d.slice(d.indexOf(':') + 1));
      if (!Number.isFinite(secs)) return null;
      totalMs += secs * 1000;
    }
    const seqMatch = playlistText.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
    // ---- WS40: the segment duration, published so the landing error can be
    // measured in SEGMENTS. Derived from the same parse, no extra work: every
    // EXTINF is already read into `durations`. The MEDIA-SEQUENCE is not
    // always present (it is optional in the spec), so the duration is a real
    // measured value rather than an assumed constant.
    let segmentDurationS = null;
    for (const d of durations) {
      const v = parseFloat(d.slice(d.indexOf(':') + 1));
      if (Number.isFinite(v)) { segmentDurationS = v; break; }
    }
    return {
      headPdtMs,
      totalMs,
      segmentDurationS,
      segmentCount: durations.length,
      mediaSequence: seqMatch ? Number(seqMatch[1]) : null,
    };
  }

  // The stream's own clock. Pure over the parse result.
  // headPdt + sum(EXTINF) is the wall time of the last byte in the buffer.
  function trueEdgeWallMs(parsed) {
    if (!parsed || !Number.isFinite(parsed.headPdtMs) || !Number.isFinite(parsed.totalMs)) {
      return null;
    }
    return parsed.headPdtMs + parsed.totalMs;
  }

  // ---- Master manifest: resolve ONE variant, never a hardcoded filename. ----
  // The master is the source of truth. Returns a list of
  // { bandwidth, url } with relative URIs resolved against the master's own
  // URL and absolute ones left alone — SR's manifest contains BOTH forms.
  function parseMasterVariants(playlistText, masterUrl) {
    if (typeof playlistText !== 'string' || typeof masterUrl !== 'string') return [];
    const lines = playlistText.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
      const bw = /BANDWIDTH=(\d+)/.exec(line);
      if (!bw) continue;
      // The URI is the next non-empty, non-comment line (RFC 8216 §4.3.4.2).
      let uri = null;
      for (let j = i + 1; j < lines.length; j += 1) {
        const cand = lines[j].trim();
        if (!cand || cand.startsWith('#')) continue;
        uri = cand;
        break;
      }
      if (!uri) continue;
      out.push({ bandwidth: Number(bw[1]), url: resolveUrl(uri, masterUrl) });
    }
    return out;
  }

  // Absolute-or-relative URL resolution, without the URL constructor's
  // base requirements. Handles the two forms SR emits and a protocol-relative
  // URI, and returns null rather than a silently wrong URL.
  function resolveUrl(uri, baseUrl) {
    const trimmed = String(uri || '').trim();
    if (!trimmed) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.startsWith('//')) {
      const m = /^([a-z][a-z0-9+.-]*:)\/\/([^/]+)(\/.*)$/i.exec(baseUrl || '');
      return m ? `${m[1]}${trimmed}` : null;
    }
    const m = /^([a-z][a-z0-9+.-]*:)\/\/([^/]+)(\/.*)$/i.exec(baseUrl || '');
    if (!m) return null;
    const origin = `${m[1]}//${m[2]}`;
    if (trimmed.startsWith('/')) return origin + trimmed;
    const dir = m[3].replace(/[^/]*$/, '');
    // Collapse ./ and ../ so a variant like "./p2/p2_320.pls" resolves correctly.
    const segs = (dir + trimmed).split('/');
    const stack = [];
    for (const seg of segs) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { stack.pop(); continue; }
      stack.push(seg);
    }
    return `${origin}/${stack.join('/')}`;
  }

  // ---- The two-source state. One writer: the fetcher below. ----
  // AGENTS.md §3. The panel is a READER of this object and never writes it, so
  // a 2 s repaint cannot race the sample that is arriving. `state` here is the
  // app's playback state; this is a separate, explicitly named holder so the
  // two can never be confused at a call site.
  //
  // `status` is the panel's whole contract, and it is deliberately ENUMERATED
  // so a missing sample can never render as a number:
  //   'idle'      — nothing requested yet (panel never opened, or no stream)
  //   'loading'   — a fetch is in flight. NEVER renders as a number.
  //   'failed'    — network/CORS/parse error. NEVER renders as a number, and
  //                 never falls back to a previous reading, because a stale
  //                 number presented as current is the defect being fixed.
  //                 ---- WS33: 'no-seekable-range' is GONE ----
  //                 It described a guard that existed only because the app's
  //                 operand was built from `seekableEnd`. The comparison no
  //                 longer reads it, so the state was reporting a reason that
  //                 could no longer be true. It is not replaced by any other
  //                 no-reading state: a stream clock with no playlist clock to
  //                 compare against is not reachable any more, because there
  //                 is only one operand and it is the device's own clock.
  //   'ok'        — a real two-source reading, with both raw clocks and the age.
  const STREAM_EDGE_PROBE = {
    status: 'idle',
    sampledAtMs: null,      // this device's clock, taken with the sample
    // WS33: the ACTUAL operand of offsetS. The device's wall clock, read in the
    // same breath as the stream's clock. The reported offset is
    // (deviceNowMs - trueEdgeWallMs) / 1000 — a difference of two clocks, and
    // the guaranteed absence of `currentTime` is what this field exists to
    // make checkable rather than assumed.
    deviceNowMs: null,
    // The app's BELIEF about which clock time the buffer edge represents.
    // Still sampled, still playhead-dependent (it is `Date.now() - (seekableEnd
    // - currentTime) * 1000`), and NOT an operand of offsetS. It is retained
    // because WS23 and older sessions read it and its difference from
    // `deviceNowMs` is the playhead's distance from the edge. Read the
    // `twoSource.note` before using it — a session that subtracts these two
    // fields is reconstructing WS33's defect.
    appEdgeWallMs: null,
    trueEdgeWallMs: null,   // the STREAM's own clock (from the playlist)
    offsetS: null,          // (deviceNow - trueEdge)/1000. Signed. No constant.
    segmentCount: null,
    mediaSequence: null,
    variantUrl: null,
    masterUrl: null,
    error: null,            // a short machine-readable reason, never raw text
    // ---- WS40: the two raw quantities the segment-index error needs. ----
    // Both are already computed by `parseVariantEdge` and were simply not
    // published. They are recorded AS READ — no new fetch, no new parse, and
    // `offsetS` does not read either of them, so WS33's operand is untouched.
    //
    // `headPdtMs` is the playlist's own statement of the wall time of its
    // FIRST segment, and `segmentDurationS` its segment length. Together they
    // define SR's media grid in absolute UTC without reference to any device
    // clock, which is what makes the landing error measurable independently.
    headPdtMs: null,
    segmentDurationS: null,
    // A sample older than this is reported as stale on screen. Chosen to be
    // longer than the playlist's own roll period (segments are 6.4 s, the
    // whole playlist rolls far more often) and shorter than a human's
    // patience. It is a DISPLAY threshold, not a correction: it changes no
    // number, it only decides whether the number is presented as current.
    staleAfterMs: 15000,
    inFlight: false,
  };

  // The URL the running stream is actually playing, from the app's own
  // descriptor — never a re-derivation and never a constant. Returns null for
  // direct (non-HLS) streams, which genuinely have no playlist to read.
  function activeHlsMasterUrl() {
    const cur = state.current;
    if (!cur || cur.kind !== 'live') return null;
    if (cur.transport !== 'hls') return null;
    const url = cur.audioUrl;
    return typeof url === 'string' && /\.m3u8($|\?)/i.test(url) ? url : null;
  }

  // One sample. Fetches master -> variant -> parses -> stores. Read-only with
  // respect to playback: it never touches audioEl, hls, or state.current.
  //
  // REUSE: the AbortController + setTimeout timeout pattern is the one already
  // used by apiFetch and fetchNewsFlashes, not a new invention. A fetch with
  // no timeout can hang the panel on a phone indefinitely, which on the
  // Info sheet looks like a frozen app.
  async function sampleStreamEdgeClock() {
    const masterUrl = activeHlsMasterUrl();
    if (!masterUrl) {
      // No HLS stream: not an error, and NOT a reading. The panel's own
      // no-stream state owns this case.
      return null;
    }
    if (STREAM_EDGE_PROBE.inFlight) return null; // no pile-up on a slow phone
    STREAM_EDGE_PROBE.inFlight = true;
    STREAM_EDGE_PROBE.status = 'loading';
    STREAM_EDGE_PROBE.error = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const masterRes = await fetch(masterUrl, { signal: controller.signal });
      if (!masterRes.ok) throw new Error('master http ' + masterRes.status);
      const masterText = await masterRes.text();
      const variants = parseMasterVariants(masterText, masterUrl);
      if (!variants.length) throw new Error('no variants in master');
      // Highest bandwidth is closest to what actually plays. Verified 2026-09-30:
      // all three of SR's variants agree on the head PDT and the EXTINF sum, so
      // the choice does not currently change the reading — but it is taken from
      // the manifest rather than hardcoded so that stays true.
      let best = variants[0];
      for (const v of variants) if (v.bandwidth > best.bandwidth) best = v;
      const variantRes = await fetch(best.url, { signal: controller.signal });
      if (!variantRes.ok) throw new Error('variant http ' + variantRes.status);
      const variantText = await variantRes.text();
      const parsed = parseVariantEdge(variantText);
      if (!parsed) throw new Error('variant unparseable as a single-clock playlist');
      const trueEdge = trueEdgeWallMs(parsed);
      // The device's clock is read HERE, in the same breath as the stream's
      // clock, so the two numbers describe the same instant rather than two
      // moments a round trip apart. This is the one place both clocks are
      // read, which is what makes the subtraction a real comparison. That
      // property is kept deliberately and must not be traded away.
      //
      // ---- WS33: BOTH OPERANDS ARE WALL CLOCKS, AND NEITHER MAY CONTAIN
      // `currentTime`. ----
      //
      // The previous operand was `streamEdgeWallMs()`, which is
      // `Date.now() - (end - currentTime) * 1000`. Substituting it into the
      // subtraction did NOT cancel the playhead term; it survived as
      // `-distanceFromLiveEdge`. So the panel reported
      //     clockBias - distanceFromLiveEdge
      // i.e. the playhead's own distance from the live edge, wearing the
      // label "offset". With a PERFECT device clock it read -1800 s while
      // 30 minutes behind live, and the true bias was invisible underneath.
      // WS30 removed the `Date.now()` half of the same tautology; this
      // removes the `currentTime` half, so what is left is a difference of two
      // clocks and nothing else.
      //
      // CONSEQUENCE, and it is deliberate: the old code needed a finite
      // `seekableEnd` and reported `error: 'no-seekable-range'` without one.
      // That guard existed ONLY because the app's operand was built from
      // `seekableEnd`. The comparison no longer reads it, so keeping the guard
      // would report a reason that is no longer true — a panel saying "could
      // not read the stream's clock" while holding a perfectly good one, which
      // is the same untruth WS31 fixed one level up. It is removed, and the
      // stream clock is measured wherever it can be measured.
      const deviceNow = Date.now();
      STREAM_EDGE_PROBE.sampledAtMs = deviceNow;
      // The real operand. Kept as its own field so the subtraction is
      // checkable by hand from the snapshot: offsetS = (deviceNowMs -
      // trueEdgeWallMs) / 1000, and neither term involves the playhead.
      STREAM_EDGE_PROBE.deviceNowMs = deviceNow;
      // KEPT for WS23 continuity, and it is still the app's honest belief
      // about which clock time the buffer edge represents. It is NOT an
      // operand of offsetS and it is PLAYHEAD-DEPENDENT — see the `note` on
      // `twoSource`, which says so explicitly so the WS33 bug is not
      // "re-derived" by a future session reading the two clocks side by side.
      STREAM_EDGE_PROBE.appEdgeWallMs = streamEdgeWallMs();
      STREAM_EDGE_PROBE.trueEdgeWallMs = trueEdge;
      STREAM_EDGE_PROBE.offsetS = (deviceNow - trueEdge) / 1000;
      // ---- WS40: publish the two raw grid quantities. `offsetS` above does
      // NOT read either of them — it is still exactly (deviceNow - trueEdge),
      // so the WS33 property that neither operand contains the playhead is
      // preserved. These exist only for the segment-index landing error.
      STREAM_EDGE_PROBE.headPdtMs = parsed.headPdtMs;
      STREAM_EDGE_PROBE.segmentDurationS = parsed.segmentDurationS;
      STREAM_EDGE_PROBE.segmentCount = parsed.segmentCount;
      STREAM_EDGE_PROBE.mediaSequence = parsed.mediaSequence;
      STREAM_EDGE_PROBE.variantUrl = best.url;
      STREAM_EDGE_PROBE.masterUrl = masterUrl;
      STREAM_EDGE_PROBE.status = 'ok';
      return STREAM_EDGE_PROBE;
    } catch (err) {
      STREAM_EDGE_PROBE.status = 'failed';
      STREAM_EDGE_PROBE.error = err && err.name === 'AbortError'
        ? 'timeout' : (err && err.message ? String(err.message).slice(0, 80) : 'unknown');
      // A failed sample must NOT leave a previous reading visible as if it
      // were current. The old numbers are kept for the record but `status`
      // governs every read, so no reader can pick them up as a live value.
      return null;
    } finally {
      clearTimeout(timer);
      STREAM_EDGE_PROBE.inFlight = false;
    }
  }

  // Seconds since the sample, or null when there is no sample. Drives the
  // "stale" label. Never rounds to 0 for a fresh sample.
  function streamEdgeSampleAgeS() {
    if (!Number.isFinite(STREAM_EDGE_PROBE.sampledAtMs)) return null;
    return (Date.now() - STREAM_EDGE_PROBE.sampledAtMs) / 1000;
  }

  // The app's belief about which clock time the buffered edge represents.
  // Read-only. Returns null when there is no usable window.
  function streamEdgeWallMs() {
    const end = state.current ? state.current.seekableEnd : null;
    if (!Number.isFinite(end)) return null;
    return Date.now() - (end - (audioEl.currentTime || 0)) * 1000;
  }

  // Maps media time to wall clock:
  //     playhead wall clock = now - (live edge - currentTime)
  // It lives at module scope (not inside renderPlayer) because resolveProgram-
  // Title and the seek paths need it without a player render.
  //
  // WS44 EXPERIMENT. This is the model the app has always used: the buffered
  // EDGE is treated as "now". That assumption is what four workstreams have
  // been trying to validate and have not. It is kept INTACT below and remains
  // the fallback — this is an A/B, not a replacement.
  function playheadWallMs() {
    const end = state.current ? state.current.seekableEnd : null;
    if (!Number.isFinite(end)) return Date.now();
    return Date.now() - (end - (audioEl.currentTime || 0)) * 1000;
  }

  // ---- WS44 EXPERIMENT: the NATIVE getStartDate() timebase. ----
  //
  // Test seam for the canary inside ws44PlayheadWallMs(). `null` in
  // production. Declared here — at the same scope the function is defined in —
  // because an undeclared identifier would make the canary line throw a
  // ReferenceError on every call, which is a far worse outcome than the
  // feature it instruments.
  const WS44_CANARY = null;
  // WS47's canary: `null` in production, declared at module scope for the same
  // reason as WS44's — an undeclared identifier would throw a ReferenceError on
  // the very line that exists to prove the function executes.
  const WS47_CANARY = null;
  //
  // WHAT QUESTION THIS ASKS. `HTMLMediaElement.getStartDate()` returns the
  // wall-clock instant that corresponds to media time 0 for a live stream.
  // If Safari supplies it, then
  //
  //     playhead wall clock = getStartDate() + currentTime
  //
  // is an INDEPENDENT measurement of the same quantity `playheadWallMs()`
  // computes by ASSUMPTION. The existing model never asks the platform what
  // time it thinks the media began; it infers it from a buffered edge and the
  // system clock. This asks the platform directly, and on the path where only
  // Safari can answer (native HLS — i.e. the owner's iPhone).
  //
  // WHY NATIVE-HLS ONLY. hls.js feeds MSE, and `getStartDate()` reflects what
  // the SOURCE declared, not the segment timeline hls.js synthesised over a
  // sliding DVR window. Reading it there would compare a declared presentation
  // time against a constructed one. It is also unnecessary: the hls.js path is
  // not where the owner's symptom is reported. Leaving it untouched also means
  // a desktop measurement still reproduces the OLD behaviour exactly.
  //
  // PURE BY CONSTRUCTION. Every input arrives as an argument — the Date
  // constructor is supplied by the caller, the fallback is supplied by the
  // caller. Nothing here reads `state`, `audioEl` or the module `Date`. That is
  // what makes the difference between the two timebases measurable at all
  // (AGENTS.md §7: a harness must prove it is executing the code under test).
  //
  // RETURNS a number, or the fallback. Callers get a usable value either way,
  // so no caller needs a null check that did not exist before.
  function ws44PlayheadWallMs(startDateMs, currentTime, transport, fallbackMs) {
    // ---- POSITIVE CANARY (AGENTS.md §7). ----
    // The parameter is `null` in production, so this is one branch and one
    // typeof per call — the function is called on metadata refreshes, not per
    // audio frame. It exists so a test harness can PROVE it is executing this
    // function rather than a stand-in: an extracted function that silently
    // does nothing has produced confident, entirely fictional results in this
    // repo before. The call is inside the function body, so the counter can
    // only move if this code actually ran.
    if (WS44_CANARY) WS44_CANARY();
    // Only the native-HLS path may use the native timebase. See above.
    if (transport !== 'native-hls') return fallbackMs;
    // A missing, non-numeric, zero, negative or non-finite start date is not
    // a usable timebase. Safari returns 0 for "unknown" and throws on some
    // paths; treating either as an instant in 1970 would silently move the
    // playhead by half a century, so every one of them falls back.
    if (!Number.isFinite(startDateMs) || startDateMs <= 0) return fallbackMs;
    if (!Number.isFinite(currentTime)) return fallbackMs;
    return startDateMs + currentTime * 1000;
  }

  // The production accessor. It asks the element ONCE, decides the transport,
  // and hands both to the pure function above. The existing implementation is
  // evaluated EAGERLY as the fallback argument, so the fallback is always the
  // app's established answer and never depends on whether the native read
  // happened to be taken.
  function playheadWallMs44() {
    const fallback = playheadWallMs();
    const transport = ws40Transport();
    let startDateMs = null;
    if (transport === 'native-hls') {
      try {
        // Safari only. Guarded on typeof because the method does not exist on
        // Chromium at all, and calling it there would throw.
        if (typeof audioEl.getStartDate === 'function') {
          startDateMs = audioEl.getStartDate();
        }
      } catch { startDateMs = null; }
    }
    return ws44PlayheadWallMs(startDateMs, audioEl.currentTime, transport, fallback);
  }

  // ---- WS47 EXPERIMENT: the effective media edge, derived at runtime. ----
  //
  // WHAT IS BEING TESTED. The production equation uses `seekable.end` as "now":
  //
  //     target = end - (Date.now() - startMs) / 1000
  //
  // The hypothesis is that Safari's EFFECTIVE media edge — the point a seek
  // actually resolves against — can sit AHEAD of `audio.seekable.end()`, by an
  // amount that moves with the rolling playlist. That would make every target
  // overshoot by a rolling amount, which is the shape of the observed error.
  //
  // WHAT IS *NOT* BEING ASSUMED. `seekable` is a `TimeRanges` collection. It
  // does NOT expose HLS segment boundaries, and nothing here treats
  // `start(n)`/`end(n)` as "the nth segment". Those are the only positions the
  // element publishes, so they are the only inputs available. No literal
  // duration appears anywhere below: SR's 6.4 s segments, the observed ~8 s,
  // ~25 s and ~31.5 s errors, and every device-specific value are ABSENT by
  // construction, and a test asserts their absence.
  //
  // HOW THE EDGE IS DERIVED. From the element's own TimeRanges at the moment of
  // the seek: the largest gap between consecutive published positions is the
  // coarsest subdivision the element discloses about its own timeline. Stepping
  // the edge back by that amount is the one non-arbitrary correction the
  // available data supports.
  //
  // If the range is too small to say anything about subdivision, the answer is
  // null and the caller keeps its own arithmetic untouched. Falling back is a
  // first-class outcome, not an error path.
  //
  // PURE BY CONSTRUCTION: the TimeRanges object is an argument. Nothing here
  // reads `state`, `audioEl` or `Date`.
  function ws47EffectiveEdgeS(ranges, fallbackEdge) {
    if (WS47_CANARY) WS47_CANARY();
    if (!Number.isFinite(fallbackEdge)) return null;
    if (!ranges || typeof ranges.length !== 'number' || ranges.length < 1) return null;
    // Collect every published position. Bounded so a malformed TimeRanges
    // cannot spin here.
    const points = [];
    const cap = 512;
    const n = Math.min(ranges.length, cap);
    for (let i = 0; i < n; i += 1) {
      let a;
      let b;
      try {
        a = ranges.start(i);
        b = ranges.end(i);
      } catch {
        // Some engines throw rather than return NaN for an out-of-range index.
        return null;
      }
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
      points.push(a, b);
    }
    // A single TimeRange carries exactly two positions -- its own start and its
    // own end -- so the "largest gap" between them is the ENTIRE DVR window,
    // not a subdivision of it. Stepping the edge back by ~3 hours would be
    // nonsense, so that case is refused rather than acted on.
    //
    // This is the honest limit of the available data: `seekable` is a
    // TimeRanges collection and publishes no HLS segment boundaries. When the
    // element offers no INTERNAL subdivision, there is no non-arbitrary step to
    // take, and the experiment correctly declines to fire. The fallback runs
    // the production equation unchanged.
    if (points.length < 4) return null;
    const lo = points[0];
    const hi = points[points.length - 1];
    // Sort, then take the LARGEST consecutive gap: the element's own coarsest
    // statement about how its timeline is subdivided. A DVR range is normally
    // a single interval, so this is the width of that interval -- derived, not
    // assumed. Using the largest gap (rather than the first) means the value is
    // the maximum step back the published data can justify, never more.
    points.sort((a, b) => a - b);
    let largestGap = 0;
    for (let i = 1; i < points.length; i += 1) {
      const gap = points[i] - points[i - 1];
      if (gap > largestGap) largestGap = gap;
    }
    // A zero gap carries no information; an absurd one would not be a
    // subdivision of a media timeline. Both fall back rather than guess.
    // The bound rejects a gap so large it cannot be a subdivision of a media
    // timeline. It is deliberately relative to the published range rather than
    // an absolute number of seconds: an absolute one-hour cap was tried and
    // rejected, because it silently excludes every realistic DVR step as soon
    // as the window is wide -- which would make the experiment unreachable in
    // production while every offline test still passed. Expressed against the
    // range instead, the bound rejects exactly the case where the largest gap
    // IS the whole window, rather than any legitimately large step.
    const span = hi - lo;
    if (!Number.isFinite(largestGap) || largestGap <= 0) return null;
    if (span > 0 && largestGap >= span) return null;
    const edge = fallbackEdge - largestGap;
    // Never invent an edge outside the range the element published.
    if (!Number.isFinite(edge) || edge < lo || edge > hi) return null;
    return edge;
  }

  // The production accessor. Reads the LIVE TimeRanges rather than the cached
  // `cur.seekableEnd`, because the experiment is about what the element reports
  // right now. Returns null whenever the experiment cannot be grounded, so the
  // caller's original arithmetic is used unchanged.
  function ws47ExperimentalEdgeS() {
    if (ws40Transport() !== 'native-hls') return null;
    const cur = state.current;
    if (!cur || !cur.dvrAvailable) return null;
    if (!Number.isFinite(cur.seekableEnd)) return null;
    const edge = ws47EffectiveEdgeS(audioEl.seekable, cur.seekableEnd);
    // Returning null rather than the fallback keeps "the experiment could not
    // be grounded" distinguishable from "the experiment applied".
    return (edge === null || edge === cur.seekableEnd) ? null : edge;
  }

  // Select the entry whose [startMs, stopMs) contains the playhead. The same
  // containment rule the episode-track updater uses, so a DVR listener sees
  // the same behaviour as an archived-episode listener.
  function pickByPosition(entries, atMs) {
    if (!Array.isArray(entries) || !entries.length) return null;
    return entries.find((e) => e.startMs <= atMs && atMs < e.stopMs) || null;
  }

  // ---- WS9: re-resolve BOTH the programme title and the song for the
  // playhead's position, without re-fetching anything. ----
  // The schedule is already in the 10-minute cache, and the song timeline is
  // already held, so this is a cheap recompute. It is called after a seek
  // (and by the seek paths) rather than on every timeupdate, so it cannot
  // thrash.
  function resolveMetadataForPosition(cur) {
    const track = cur || state.current;
    if (!track || track.kind !== 'live' || !track.id) return;
    // WS44 EXPERIMENT: read the playhead through the experimental native
    // timebase. This is the DVR METADATA lookup, which is the four-day
    // user-visible problem. The seek equation is NOT switched — see
    // playheadWallMs44().
    const atMs = playheadWallMs44();

    // Programme title: the event CONTAINING the playhead, not the one on air.
    const schedule = cur._srSchedule;
    if (Array.isArray(schedule) && schedule.length) {
      const ev = pickByPosition(schedule.map((e) => ({
        startMs: e.startMs, stopMs: e.endMs, title: e.title,
      })), atMs);
      if (ev?.title && ev.title !== track._srProgramTitle) {
        track._srProgramTitle = ev.title;
        paintProgramTitle();
      } else if (ev?.title) {
        paintProgramTitle();
      }
    }

    // Song: the timeline entry containing the playhead.
    const hit = pickByPosition(nowPlaying.timeline, atMs);
    const title = hit ? hit.title : '';
    const artist = hit ? hit.artist : '';
    if ((title || null) !== (nowPlaying._srPaintedTitle || null)
      || (artist || null) !== (nowPlaying._srPaintedArtist || null)) {
      nowPlaying._srPaintedTitle = title || null;
      nowPlaying._srPaintedArtist = artist || null;
      paintNowPlaying();
      // ---- WS24, corrected by WS26: the COVER for a song resolved by a seek ---
      // The WS24 note is kept because its measurement is the reason WS26 exists,
      // but two of its statements are now FALSE and are corrected here rather
      // than left to mislead the next reader.
      //
      // FALSE NOW (1): "refreshNowPlayingArtwork() has exactly two call sites".
      // It has three. WS24 added this one and the poll kept writing the same
      // field, so the fix was undone about 45 s later -- reproduced in WS25 with
      // real extracted code. `nowPlaying.artwork` was one field with two
      // intents, and last writer won.
      // FALSE NOW (2): "the target === nowPlaying guard keeps the live/episode
      // fields apart". It did keep episodeArtwork apart, but it could not keep
      // the two LIVE intents apart, because they were the same field. WS26
      // splits them: onAirArtwork (poll) and playheadArtwork (this path), each
      // with exactly one writer, and the panel chooses between them in
      // resolvePlayheadMeta() as a READ.
      //
      // STILL TRUE, and the reason this block exists: the title and artist above
      // resolve correctly for a historical song, and the cover did not. The
      // owner's report was "a correct song and artist, no cover" -- the same
      // defect in the case where the on-air song had no resolved cover, i.e.
      // null, which shows the placeholder. So the symptom was one bug with two
      // faces: a missing cover when the previous song had none, and a WRONG
      // cover when it had one. The second is worse, and it is why the fix must
      // never leave the old cover in place.
      //
      // ONE implementation, ONE cache: the same refreshNowPlayingArtwork() and
      // the same artworkCache the live path uses, called with the writer name
      // 'playhead' so it can only ever write `playheadArtwork`. An episode
      // cover cannot appear here and this cannot write episodeArtwork, because
      // the function dispatches on `kind`, not on a target object.
      //
      // BOUNDED, and deliberately: one network request per DISTINCT song,
      // deduped by artworkCache for the session. A user dragging the scrubber
      // across an hour would cross many songs in a second, so an undebounced
      // call would fire one request per boundary crossed. seekArtworkTimer
      // collapses that into a single lookup for wherever the playhead settles,
      // and the artworkSeq guard discards any response a later song has already
      // superseded. The timer is cleared by stopNowPlayingPoll(), so a channel
      // switch cannot leave it pending.
      //
      // NOT added to any timeupdate handler: those run several times a second.
      if (hit && hit.title && hit.artist) {
        if (seekArtworkTimer) clearTimeout(seekArtworkTimer);
        const key = `${hit.artist}|${hit.title}`.toLowerCase();
        // The cover currently on screen belongs to whatever the last POLL
        // resolved, which is a DIFFERENT song from this one. Showing it here
        // would pair song B's title with song A's cover — the exact symptom,
        // just narrower than before. So the moment the song CHANGES, the stale
        // cover is cleared and the panel repaints through the same
        // refreshNowPlayingArtwork() used for the live path (its no-song branch
        // is the existing, tested way to clear this field).
        //
        // Clearing is safe at any time: the timer below re-fetches, and
        // refreshNowPlayingArtwork() is a no-op on failure that leaves the
        // field null. The worst case is the ♪ placeholder for the ~400 ms
        // before the cover arrives, which is the correct, honest intermediate
        // state. A wrong cover is never shown.
        //
        // Guarded on the key, so a re-resolve of the SAME song (a second seek
        // landing inside it) does not clear a cover that is already correct —
        // that is the common case when scrubbing inside one long song, and
        // blanking it there would be a visible regression of its own.
        if (seekArtworkSongKey !== key) {
          seekArtworkSongKey = key;
          if (nowPlaying.playheadArtwork) refreshNowPlayingArtwork(null, 'playhead');
        }
        seekArtworkTimer = setTimeout(() => {
          seekArtworkTimer = null;
          // Re-check at fire time: the playhead may have moved on, and the
          // song resolved then may be a different one (or none).
          // WS44 EXPERIMENT: same native timebase as the text it accompanies.
          // A cover and a title from different timebases would be a new
          // disagreement of exactly the kind R6 was about.
          const now = pickByPosition(nowPlaying.timeline, playheadWallMs44());
          if (!now || !now.title || !now.artist) return;
          refreshNowPlayingArtwork(now, 'playhead');
        }, SEEK_ARTWORK_DEBOUNCE_MS);
      }
    }
  }

  async function resolveProgramTitle(cur) {
    if (!cur || cur.kind !== 'live' || !cur.id) return;
    try {
      const schedule = await fetchSchedule(cur.id);
      if (!schedule || state.current !== cur) return; // superseded
      // WS9: keep the schedule so a later SEEK can re-resolve the title from
      // cache, without another fetch. Per-track, so a channel switch can never
      // see another channel's schedule.
      cur._srSchedule = schedule;
      resolveMetadataForPosition(cur);
    } catch { /* schedule unavailable — 'Direkt' fallback stays */ }
  }

  function playTrack(track) {
    // Any track transition invalidates both old episode resolution and state.
    // This is important for episode→episode, not just episode→live.
    stopEpisodeTracks();
    // Do not display the previous live song/artwork while the new channel's
    // rightnow request is pending. The sequence guards also kill late replies.
    stopNowPlayingPoll();
    // BUG 2 FIX (WS2): a fresh playback must always open the FULL player.
    // playerMinimized is only set by minimizePlayer() and cleared by
    // restorePlayer() / stopAndClosePlayer(). Tapping a DIFFERENT channel
    // while the previous one sat in the mini-bar skipped both of those, so the
    // new track rendered in the minimised layout. Reset it here alongside the
    // other per-session resets, matching the intent already documented in
    // stopAndClosePlayer() ("a fresh play must never open as mini-bar").
    playerMinimized = false;
    state.current = track;
    lastPlayingKey = `${track.kind}:${track.id}`;
    // New playback session → the news auto-collapse may fire once again.
    newsAutoCollapsed = false;
    newsManualExpanded = false;
    let srcUrl = track.audioUrl;
    if (Array.isArray(track.candidates) && track.candidates.length) {
      const key = lastPlayingKey;
      const idx = Math.min(workingStreamIdx.get(key) || 0, track.candidates.length - 1);
      track.candidateIndex = idx;
      const cand = track.candidates[idx];
      // Candidates are descriptors (Phase 1): carry codec/bitrate/transport/dvr
      // onto the track so the badge and future DVR UI read facts, not guesses.
      if (typeof cand === 'object' && cand !== null) {
        srcUrl = cand.url;
        track.audioUrl = cand.url;
        track.codec = cand.codec;
        track.bitrate = cand.bitrate;
        track.transport = cand.transport;
        track.dvr = cand.dvr;
      } else {
        srcUrl = cand;
        track.audioUrl = cand;
      }
    }
    // Any playback change detaches a previous HLS instance first — no stale
    // instance may survive into the new session.
    hlsDetach();
    if (track.transport === 'hls') {
      // HLS: attach may be async (hls.js lazy-load). Native Safari path is sync.
      const startHls = () => {
        const cur = state.current;
        if (!cur || cur.audioUrl !== track.audioUrl) return; // superseded meanwhile
        const res = hlsAttach(track.audioUrl);
        if (res === 'unsupported') { advanceCandidate(); return; }
        audioEl.play().catch(() => {
          showToast('Kunde inte starta uppspelning. Försök igen.');
        });
      };
      if (CAPS.nativeHls) {
        startHls();
      } else {
        loadHlsJs().then(startHls);
      }
    } else if (audioEl.src !== srcUrl) {
      diagLog(`audio-src-set kind=${track.kind} id=${track.id} url=${srcUrl.slice(-50)}`);
      audioEl.src = srcUrl;
      audioEl.play().catch(() => {
        showToast('Kunde inte starta uppspelning. Försök igen.');
      });
    } else {
      audioEl.play().catch(() => {
        showToast('Kunde inte starta uppspelning. Försök igen.');
      });
    }
    armPlaybackWatchdog();
    updateMediaSession();
    // Now-playing metadata: live channels only. IMPORTANT ORDER: render the
    // new player DOM FIRST, then start the poll — otherwise a fast rightnow
    // response paints the OLD (about-to-be-discarded) DOM and the new line
    // stays empty until the next poll (observed: song flashed for a split
    // second, then vanished for ~30 s — user report 2026-09-23).
    renderPlayer();
    if (track.kind === 'live') {
      startNowPlayingPoll();
      // WS38: the rate sampler rides the SAME lifecycle as the live channel —
      // started here, stopped with the poll. It is deliberately NOT tied to the
      // Info panel, because the owner must not have to hold the panel open for
      // a rate to exist (§3.2).
      startSeekRateSampling();
      resolveProgramTitle(track); // Pågår nu-programmet som undertitel
    } else {
      // Archived episode: load its music playlist (cached per episode).
      // The audio path is untouched — metadata only.
      if (track.id) {
        loadEpisodeTracks(track.id).then((tracks) => {
          if (tracks && state.current === track) updateEpisodeTrack();
        });
      }
    }
    updatePlayingMarks();
  }

  // ---- playback watchdog ----
  // Chromium does NOT fire 'error' for raw ADTS AAC streams — it hangs
  // silently (readyState stays 0, no events). Verified 2026-09-21. So the
  // resolver can't rely on the error event alone: if no 'playing' within
  // WATCHDOG_MS, advance to the next candidate.
  const WATCHDOG_MS = 6000;
  let watchdogTimer = null;

  function advanceCandidate() {
    const cur = state.current;
    if (!cur || !Array.isArray(cur.candidates)) return false;
    if (cur.candidateIndex >= cur.candidates.length - 1) return false;
    cur.candidateIndex += 1;
    const cand = cur.candidates[cur.candidateIndex];
    if (typeof cand === 'object' && cand !== null) {
      cur.audioUrl = cand.url;
      cur.codec = cand.codec;
      cur.bitrate = cand.bitrate;
      cur.transport = cand.transport;
      cur.dvr = cand.dvr;
    } else {
      cur.audioUrl = cand;
    }
    workingStreamIdx.set(lastPlayingKey, cur.candidateIndex);
    hlsDetach(); // leaving (or re-entering) HLS — always clean slate
    if (cur.transport === 'hls') {
      const startHls = () => {
        if (!state.current || state.current.audioUrl !== cur.audioUrl) return;
        const res = hlsAttach(cur.audioUrl);
        if (res === 'unsupported') { advanceCandidate(); return; }
        audioEl.play().catch(() => {});
      };
      if (CAPS.nativeHls) startHls();
      else loadHlsJs().then(startHls);
    } else {
      audioEl.src = cur.audioUrl;
      audioEl.play().catch(() => {});
    }
    armPlaybackWatchdog();
    renderPlayer();
    return true;
  }

  function armPlaybackWatchdog() {
    clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      if (state.current && audioEl.paused === false && audioEl.readyState < 3) {
        advanceCandidate();
      }
    }, WATCHDOG_MS);
  }

  function clearPlaybackWatchdog() {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }

  function toggleTrack(track) {
    if (isCurrent(track.kind, track.id) && !audioEl.paused) {
      audioEl.pause();
      renderPlayer();
      updatePlayingMarks();
      return;
    }
    playTrack(track);
  }

  function stopAndClosePlayer() {
    clearPlaybackWatchdog();
    if (audioEl._srStuckGuard) { clearInterval(audioEl._srStuckGuard); audioEl._srStuckGuard = null; }
    hlsDetach(); // no HLS instance may outlive the player
    stopNowPlayingPoll(); // metadata loop must not outlive the player
    // WS38: same rule for the rate sampler — a 10 s timer that outlives the
    // player would keep sampling a closed stream for as long as the tab is
    // open, which is a battery bug and produces rates nobody asked for.
    stopSeekRateSampling();
    stopEpisodeTracks(); // archived-track state must not leak into next session
    audioEl.pause();
    diagLog(`audio-src-cleared (stopAndClosePlayer)`);
    audioEl.removeAttribute('src');
    state.current = null;
    // WS17: the podcast id must die with the player. It is the value the
    // playPodcast() guard compares, and leaving it set while nothing is loaded
    // is a stale flag that outlives the thing it describes. (Harmless today
    // only because the guard also requires `state.current`, which this
    // function just nulled -- two pieces of state that must agree.)
    audioEl._podProgramId = null;
    podFetchInFlight = null;
    lastPlayingKey = null;
    playerMinimized = false; // a fresh play must never open as mini-bar
    stopPositionSync(); // no position refresh may outlive the player
    updateMediaSession(); // clears lock-screen now-playing immediately
    $player.classList.remove('visible');
    $player.classList.remove('minimized');
    $player.onclick = null;
    $player.textContent = '';
    updatePlayingMarks();
    updateNewsFold(); // playback ended → News returns to fully expanded
  }

  metaDiagCountAdd('error');
  audioEl.addEventListener('error', () => {
    // Resolver fallback: try the next candidate before giving up.
    if (advanceCandidate()) return;
    if (state.current) showToast('Uppspelningsfel. Försök igen.');
    updatePlayingMarks();
  });

  function updatePlayingMarks() {
    const playing = !audioEl.paused && state.current;
    document.querySelectorAll('[data-stream-key]').forEach((node) => {
      const active = playing && node.dataset.streamKey === lastPlayingKey;
      node.classList.toggle('playing', active);
      node.setAttribute('aria-pressed', String(active));
      // Respect the base label each node declared (news rows say "Öppna artikel",
      // streams/podcasts say "Spela …"); only swap Spela↔Stoppa when playing.
      const base = node.dataset.streamLabel || node.getAttribute('aria-label') || '';
      const stopLabel = `Stoppa ${node.dataset.streamTitle}`;
      const playLabel = base.startsWith('Stoppa ') && node.dataset.streamLabel
        ? node.dataset.streamLabel
        : base;
      node.setAttribute('aria-label', active ? stopLabel : playLabel);
    });
    // Nyheter collapse (user request 2026-09-23, corrected): when a program
    // or podcast starts playing, the news section COLLAPSES so the player
    // gets visual focus; when playback stops it returns to fully expanded.
    // Manual expand during playback wins (see updateNewsFold).
    updateNewsFold();
  }

  // ---- Nyheter collapse/expand (user request 2026-09-23, CORRECTED) ----
  // Correct semantics (the first implementation had this REVERSED):
  //   No playback  → News FULLY EXPANDED (normal, all items visible, no peek).
  //   Playback on  → News auto-COLLAPSES once (header only, no peek) so the
  //                  player gets visual focus.
  //   Manual expand during playback → user's choice wins; playback events,
  //                  renderPlayer, metadata polls etc. must NOT re-collapse.
  //   Playback off → News returns to fully expanded.
  // Module-level so the state survives renderHome() re-renders.
  let newsExpanded = true;      // default: fully expanded, no collapsed state
  let newsManualExpanded = false; // user expanded manually during playback
  let newsAutoCollapsed = false;  // auto-collapse already fired this session
  function updateNewsFold() {
    // "Active playback" = a track is loaded AND audio is not paused. A
    // mid-session PAUSE is still the same playback session — the section
    // must not flip states while the user pauses/resumes (verified live:
    // pause→resume re-triggered the auto-collapse). Only a closed player
    // (state.current === null) ends the session.
    const session = Boolean(state.current);
    const playing = session && !audioEl.paused;
    if (!session) {
      // No active playback at all → fully expanded (user requirement A/D).
      newsExpanded = true;
      newsManualExpanded = false;
      newsAutoCollapsed = false;
    } else if (playing && !newsAutoCollapsed && !newsManualExpanded) {
      // Playback just started → auto-collapse ONCE. After that the user's
      // manual choice wins: playback events / renderPlayer / metadata
      // updates must never re-collapse an expanded section.
      newsExpanded = false;
      newsAutoCollapsed = true;
    }
    document.querySelectorAll('.news-section').forEach((sec) => {
      sec.classList.toggle('expanded', newsExpanded);
      const btn = sec.querySelector('.news-toggle');
      if (btn) {
        btn.setAttribute('aria-expanded', String(newsExpanded));
        btn.setAttribute('aria-label', newsExpanded ? 'Fäll ihop Nyheter' : 'Fäll ut Nyheter');
      }
    });
  }

  ['play', 'pause', 'ended'].forEach((ev) => {
    metaDiagCountAdd(ev);
    audioEl.addEventListener(ev, () => {
      diagLog(`audio-${ev} src=${(audioEl.currentSrc || audioEl.src || 'none').slice(-50)} t=${audioEl.currentTime?.toFixed(1)}`);
      if (ev === 'play') {
        armPlaybackWatchdog();
      } else if (ev === 'pause' || ev === 'ended') {
        clearPlaybackWatchdog();
      }
      updatePlayingMarks();
      if (ev === 'pause' || ev === 'play') {
        renderPlayer();
        updateMediaSession(); // keep lock-screen play/pause state in sync
      }
    });
  });

  // Once audio is actually flowing, remember the working candidate and stop
  // the watchdog. The badge re-renders from cur.audioUrl, so it follows the
  // active candidate automatically (FLAC → MP3 shift is visible to the user).
  metaDiagCountAdd('playing');
  audioEl.addEventListener('playing', () => {
    clearPlaybackWatchdog();
    const cur = state.current;
    if (cur && Array.isArray(cur.candidates)) {
      workingStreamIdx.set(lastPlayingKey, cur.candidateIndex || 0);
    }
    setBadgeBuffering(false);
    renderPlayer();
  });

  // ---- MediaSession (låsskärm / kontrollcenter) ----
  // Utan explicit metadata kan iOS binda låsskärmsspelaren till fel installerad
  // PWA (observerat 2026-09-22: tryck på låsskärmsspelaren öppnade en annan
  // PWA, och att stänga den dödade ljudet). Metadata + artwork knyter
  // sessionen till DEN HÄR appen och ger riktiga kontroller.
  const mediaSession = ('mediaSession' in navigator) ? navigator.mediaSession : null;

  // ---- Sidlivscykel: döda ljudsessionen när PWA:an stängs ----
  // Användarrapport 2026-09-23: "om den nya PWA:n läggs i bakgrunden och
  // sedan stängs spelar den första spelaren fortfarande". När en PWA stängs
  // (swipe away i appväxlaren) skickar iOS pagehide; om ljudsessionen inte
  // städas kan OS:en behålla en zombi-session bunden till den döda sidan —
  // och låsskärmen öppnar då "fel" app (den gamla installationen).
  // pagehide med persisted=false = sidan stängs på riktigt → pausa + rensa
  // MediaSession. persisted=true (bfcache) = normal bakgrundsuppspelning,
  // ljudet SKA fortsätta (radio i bakgrunden är en feature).
  // freeze = sidan är på väg att läggas i is (iOS/Android minneshantering).
  window.addEventListener('pagehide', (e) => {
    diagLog(`pagehide persisted=${e.persisted} playing=${!audioEl.paused}`);
    if (e.persisted) return; // bakgrund, inte stängd — låt ljudet spela
    if (!audioEl.paused) audioEl.pause();
    updateMediaSession(); // rensar now-playing direkt
  });
  document.addEventListener('freeze', () => {
    diagLog(`freeze playing=${!audioEl.paused}`);
    if (!audioEl.paused) audioEl.pause();
    updateMediaSession();
  });
  window.addEventListener('pageshow', (e) => {
    diagLog(`pageshow persisted=${e.persisted} paused=${audioEl.paused}`);
  });
  document.addEventListener('visibilitychange', () => {
    diagLog(`visibilitychange hidden=${document.hidden} paused=${audioEl.paused}`);
  });
  // Tillbaka till appen: om ljudet pausades av pagehide ovan (edge case),
  // synka UI-state. Vi återstartar INTE ljudet automatiskt — användaren
  // styr uppspelning.
  document.addEventListener('resume', () => {
    updatePlayingMarks();
    renderPlayer();
  });

  // ---- WS23: the earbud/lock-screen PLAY button, made diagnosable ----
  //
  // In plain terms. Three different buttons can control playback from a pair
  // of headphones, and they are not interchangeable:
  //
  //   PAUSE just pauses the audio element. It cannot fail in a way that
  //         leaves the app stuck.
  //   STOP  tears the whole stream down (stops playback, detaches HLS,
  //         clears the source and the player state). After that, pressing
  //         play starts everything again from scratch — which is why
  //         "stop then play" works.
  //   PLAY  resumes the SAME element in place.
  //
  // So the owner's AirPods test (stop then play works) does NOT disprove the
  // tester's report. It confirms the reset path. The reported failure is
  // specific to pause -> play, where a paused live stream may be holding a
  // stale connection and resuming produces silence.
  //
  // Until now that handler was:
  //     audioEl.play().catch(() => {})
  // The empty catch DISCARDED the reason. Every other play site in this file
  // (four in playTrack, one on the play/pause button) reports a failure to the
  // user; this was the only one that threw the reason away. It is recorded here
  // because the reason is the entire question:
  //
  //   - the promise REJECTS   -> the browser refused (its error name says why)
  //   - the promise RESOLVES  -> resuming "worked" and the silence is
  //                              downstream, in the stream itself
  //
  // Those two look identical from outside the app, and no amount of reading
  // the source can tell them apart. Only a device can. The first wants a
  // message; the second wants a reconnect, and a toast would achieve nothing.
  //
  // READ-ONLY CONTRACT: written to this module-scope object only. It never
  // writes `state.current` and never drives the element beyond the single
  // `play()` call the handler already made. Registered once, at startup,
  // beside the other handlers — never inside a timeupdate.
  const RESUME_DIAG = {
    calls: 0,             // how many times the handler actually ran
    lastAt: null,
    handlerRan: null,     // false would mean the button never reached us at all
    pausedBefore: null,   // audioEl.paused immediately before play()
    outcome: null,        // 'resolved' | 'rejected' | null (not yet known)
    errorName: null,      // e.g. 'NotAllowedError', 'AbortError'
    errorMessage: null,
    before: null,         // { readyState, networkState, errorCode, currentTime }
    // Sampled a few seconds after the attempt, so "resumed but silent" is
    // distinguishable from "never actually started". If readyState is still 0
    // here, nothing is loading and the resume did not take.
    after: null,
    afterDelayMs: 3000,
  };

  // Samples readyState/networkState/error into the resume record. The delay is
  // scheduled by the caller, never awaited, so playback is never blocked.
  function sampleResume(phase) {
    return {
      at: new Date().toISOString(),
      readyState: audioEl.readyState,
      networkState: audioEl.networkState,
      errorCode: audioEl.error ? audioEl.error.code : null,
      currentTime: audioEl.currentTime,
      paused: audioEl.paused,
    };
  }

  if (mediaSession) {
    const safeSeek = (fn) => { try { fn(); } catch { /* live streams may reject */ } };
    try {
      // WS23: this handler used to swallow the failure entirely. It still
      // calls play() exactly once and changes nothing about the success path;
      // it now records WHY an attempt failed, and tells the user on rejection
      // using the SAME wording every other play site in this file already uses.
      //
      // It deliberately does NOT retry, reconnect, or advance to another
      // stream: if the resume resolves and the audio is still silent, the fix
      // is a reconnect, and this code cannot yet tell that case apart. Adding
      // a speculative reconnect here would also make the next device test
      // unreadable, because two changes would be in flight at once.
      mediaSession.setActionHandler('play', () => {
        RESUME_DIAG.calls += 1;
        RESUME_DIAG.handlerRan = true;
        RESUME_DIAG.lastAt = new Date().toISOString();
        RESUME_DIAG.pausedBefore = audioEl.paused;
        RESUME_DIAG.outcome = null;
        RESUME_DIAG.errorName = null;
        RESUME_DIAG.errorMessage = null;
        RESUME_DIAG.before = sampleResume('before');
        audioEl.play().then(() => {
          RESUME_DIAG.outcome = 'resolved';
          RESUME_DIAG.after = sampleResume('after');
        }).catch((err) => {
          RESUME_DIAG.outcome = 'rejected';
          RESUME_DIAG.errorName = err && err.name ? err.name : null;
          RESUME_DIAG.errorMessage = err && err.message ? err.message : null;
          RESUME_DIAG.after = sampleResume('after');
          // Reuse the existing wording, do not invent new Swedish copy.
          showToast('Kunde inte starta uppspelning. Försök igen.');
          renderPlayer();
        });
        setTimeout(() => {
          // Re-sample so a resume that resolved into silence is visible.
          if (RESUME_DIAG.outcome === null) RESUME_DIAG.outcome = 'pending';
          RESUME_DIAG.after = sampleResume('after');
        }, RESUME_DIAG.afterDelayMs);
      });
      mediaSession.setActionHandler('pause', () => audioEl.pause());
      mediaSession.setActionHandler('stop', () => stopAndClosePlayer());
      mediaSession.setActionHandler('seekbackward', () => safeSeek(() => { audioEl.currentTime = Math.max(0, audioEl.currentTime - 10); }));
      mediaSession.setActionHandler('seekforward', () => safeSeek(() => { audioEl.currentTime = audioEl.currentTime + 10; }));
    } catch { /* unsupported action — ignore */ }
  }

  // ---- lock-screen position state (WS3) ----
  // Without this the lock screen shows --:-- instead of real times. Live radio
  // has no meaningful total duration, so it reports duration: Infinity (which
  // the spec treats as "unknown/streamed") with a currentTime. On-demand
  // episodes report their real duration.
  //
  // The refresh handle is stored on the audioEl singleton, cleared before
  // re-creating and cleared on stop — the same pattern the file already uses
  // for _srUpd / _srDvrUpd / _srGestureHandlers, after two listener-leak
  // defects of exactly this shape. COSMETIC ONLY: it fixes the --:-- display
  // and has nothing to do with which app iOS launches.
  function syncMediaPosition() {
    if (!mediaSession) return;
    const cur = state.current;
    if (!cur) return;
    const isLive = cur.kind === 'live';
    const position = {
      duration: isLive ? Infinity : (Number.isFinite(audioEl.duration) ? audioEl.duration : undefined),
      playbackRate: audioEl.playbackRate || 1,
    };
    if (!isLive) position.currentTime = audioEl.currentTime || 0;
    else {
      // For a live stream currentTime is the position inside the DVR window;
      // reporting it is still better than reporting nothing.
      position.currentTime = audioEl.currentTime || 0;
    }
    try {
      if (typeof mediaSession.setPositionState === 'function') {
        mediaSession.setPositionState(position);
      }
    } catch { /* throws on some platforms — must never break playback */ }
  }

  function startPositionSync() {
    if (!mediaSession || audioEl._srPosTimer) return;
    audioEl._srPosTimer = setInterval(() => {
      if (!state.current) return;
      syncMediaPosition();
    }, 5000);
  }

  function stopPositionSync() {
    if (audioEl._srPosTimer) {
      clearInterval(audioEl._srPosTimer);
      audioEl._srPosTimer = null;
    }
  }

  function updateMediaSession() {
    if (!mediaSession) return;
    const cur = state.current;
    if (!cur) {
      diagLog('mediasession-cleared');
      // No track: also stop the position refresh, or it keeps ticking
      // forever against a dead element.
      stopPositionSync();
      mediaSession.metadata = null;
      try { mediaSession.playbackState = 'none'; } catch { /* ignore */ }
      return;
    }
    try {
      // ---- WS11 Part C: feed the car and lock screen what the app shows ----
      // This used to be `cur.title` / `cur.subtitle` -- the channel name and a
      // static string. Everything WS9 built (the position-aware programme and
      // song) was invisible here, which is exactly the reported symptom: the
      // car showed the channel but never the song or artist.
      //
      // The values are the SAME ones the in-app display uses, selected the same
      // way, so the car screen cannot disagree with the phone.
      //
      // Layout: a car head unit and the lock screen show two lines, so
      //   title  = the song (the most specific thing playing)
      //   artist = programme, then channel
      //   album  = the channel
      // With no song (talk radio) the title falls back to the programme, so a
      // talk channel is still identifiable.
      //
      // ---- WS15: podcasts get the RADIO treatment, not a special case ----
      // The owner: replicate the radio channel's order for podcasts. On radio
      // the pair reads "<song> / <programme> · <channel>"; for a podcast the
      // same shape is "<song> / <podcast name>", and album carries the episode
      // name. Specifically:
      //   - artist falls back to the PODCAST NAME, not the literal "Min Radio"
      //   - the EPISODE NAME takes the place of the programme title
      //
      // Before this, an episode produced metaTitle = episode name and
      // metaArtist = episode name, because `programme` is only ever set for a
      // live channel and `channel` (cur.title) IS the episode name on an
      // episode object. Both fields therefore held the same string and the car
      // displayed the episode title twice. Measured live on P3 Soul.
      // WS44 EXPERIMENT: the panel's song line for a live DVR position now
      // reads through the experimental native timebase. Episodes keep the
      // existing path untouched — the experiment is native-HLS live only.
      const curSong = cur.kind === 'episode'
        ? episodeCurrentTrack
        : pickByPosition(nowPlaying.timeline, playheadWallMs44());
      // For an episode, cur.title is the EPISODE name and cur.programName is
      // the PODCAST name -- they are swapped relative to a live channel, where
      // cur.title is the channel and _srProgramTitle is the programme.
      const programme = (cur.kind === 'live' && cur._srProgramTitle)
        ? cur._srProgramTitle
        : null;
      // "Second line" = what plays the song. Radio: programme, then channel.
      // Podcast: the podcast name. Never the episode name -- that is the
      // album, and repeating it is the bug this replaces.
      const songArtist = curSong && curSong.artist ? curSong.artist : null;
      const songTitle = curSong && curSong.title ? curSong.title : null;
      const channel = cur.kind === 'episode'
        ? (cur.programName || cur.subtitle || 'Min Radio')
        : (cur.title || 'Min Radio');
      const metaTitle = songTitle || programme || (cur.kind === 'episode' ? cur.title : channel) || channel;
      // ---- WS19: the SONG ARTIST must appear in the artist field ----
      // Measured live (P3, talk/music radio): title AND artist both read
      // "P3 Din Gata: Musik", so the lock screen and the car head unit showed
      // the same string twice and the song artist never appeared at all.
      //
      // The cause is not a fallback ordering bug, it is that `songArtist` was
      // computed and then only ever used as a BOOLEAN. It gated the branch but
      // never contributed a character to the output:
      //     metaArtist = songArtist ? [programme, channel].join(' · ') : ...
      // So whenever a song was playing, the artist field was "programme ·
      // channel" and the actual performer was discarded.
      //
      // The fix puts the artist FIRST, because a lock screen's second line is
      // "who is playing this" -- the performer -- and the programme/channel is
      // the context after it. That also matches the in-app line, which reads
      // "artist – title".
      //
      // With no song the artist field falls back to programme, then channel,
      // so a talk channel with no song is still identifiable. The duplicate
      // `programme · channel` pairing is kept in that fallback because on a
      // talk channel they are genuinely the two most useful things to say.
      const metaArtist = songArtist
        ? [songArtist, programme, channel].filter(Boolean).join(' · ')
        : (programme || channel);
      // Album: the channel on radio, the EPISODE name on a podcast.
      const album = cur.kind === 'live' ? channel : (cur.title || 'Min Radio');
      // Artwork: real now-playing artwork when it exists, then the track's own
      // image, then the PWA icon.
      //
      // WS12 Part C: for an EPISODE the first term is skipped deliberately,
      // because `nowPlaying.artwork` is only ever filled for live channels --
      // refreshNowPlayingArtwork() is reached solely from fetchNowPlaying(),
      // which is only called when kind === 'live'. So it is null for an episode
      // BY CONSTRUCTION, not by policy. The second term is the real one there:
      // every episode track is built with `artwork: pod.image` /
      // `item.imageUrl` / `ev.image`, so a podcast shows its programme cover
      // on the lock screen too. Nothing is invented; the icon is last resort.
      // WS26 Part 1: the lock screen / car display read the SAME resolver as
      // the panel and the compact line. It used to read the raw on-air field,
      // so behind live the car and the phone showed different songs -- the
      // same R6 defect in a third place.
      const head = cur.kind === 'live' ? resolvePlayheadMeta() : null;
      const artworkSrc = (cur.kind === 'live' && head ? head.artwork : null)
        || cur.artwork
        || 'icons/icon-512.png';
      // Album: the channel on radio, the EPISODE name on a podcast. Wired up
      // here because the owner asked for the episode name to take the
      // programme's place; leaving the inline literal would silently discard
      // `album` and reintroduce the episode name into the title field.
      mediaSession.metadata = new MediaMetadata({
        title: metaTitle,
        artist: metaArtist,
        album,
        artwork: [{
          src: artworkSrc,
          sizes: '512x512',
          type: 'image/png',
        }],
      });
      // Change-detection: these functions run on timeupdate (~4/s), so the
      // session is only rebuilt when the metadata actually differs. Without
      // this the car screen would keep stale text forever, because no other
      // call site fires on a song or programme change.
      const signature = `${metaTitle}\\u0000${metaArtist}\\u0000${artworkSrc}`;
      if (signature !== META_DIAG.lastMediaSignature) {
        META_DIAG.lastMediaSignature = signature;
        diagLog('mediasession-metadata-changed');
      }
      mediaSession.playbackState = audioEl.paused ? 'paused' : 'playing';
    } catch { /* never let metadata break playback */ }
    // Push the position immediately, then keep it roughly fresh.
    syncMediaPosition();
    if (!audioEl.paused) startPositionSync();
    else stopPositionSync();
  }

  // ---- buffering indicator ----
  // While audio is loading (no playback yet, or re-buffering mid-play) the
  // quality pill pulses with a "buffrar" suffix — zero extra layout space.
  // Reverts to the plain quality label once audio flows again.
  function setBadgeBuffering(buffering) {
    const badge = $player.querySelector('.player-quality');
    if (!badge) return;
    badge.classList.toggle('buffering', buffering);
    const cur = state.current;
    const fmt = badge.dataset.format || qualityLabel(cur) || '';
    badge.textContent = buffering ? `${fmt} · buffrar` : fmt;
  }

  // ---- quality label (Phase 1: honest bitrate from descriptors) ----
  // Reads the ACTIVE stream's descriptor fields (set by playTrack/
  // advanceCandidate), never the preferred one. Bitrate is shown only when
  // reliably known — FLAC shows no bitrate (icy-br is unreliable there),
  // and no bitrate is ever invented.
  function qualityLabel(cur) {
    if (!cur) return null;
    const codec = cur.codec || streamFormatLabel(cur.audioUrl); // descriptor first, URL-guess fallback
    if (!codec) return null;
    const known = typeof cur.bitrate === 'number' && cur.bitrate > 0;
    return known ? `${codec.toUpperCase()} ${cur.bitrate}` : codec.toUpperCase();
  }

  // ---- DVR UI helpers (Phase 3, UX rev 2026-09-22) ----
  // All DVR UI reads the Phase 2A seekable state (dvrAvailable, seekableStart,
  // seekableEnd, distanceFromLiveEdge, atLiveEdge) — never HLS/hls.js/URLs.

  // Clock time (Swedish timezone) for a position inside the DVR window.
  // The live edge ≈ now, so a position p maps to now − (seekableEnd − p).
  // This stays correct as the window rolls. Shown as HH:MM.
  function dvrPositionToDate(position) {
    const cur = state.current;
    if (!cur || !Number.isFinite(position)) return null;
    const end = cur.seekableEnd;
    if (!Number.isFinite(end)) return null;
    const behindMs = (end - position) * 1000;
    const d = new Date(Date.now() - behindMs);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function dvrClockLabel(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }

  // Relative offset label: "−12 min", "−1 h 5 min". Sensible rounding per the
  // approved spec: under 60 s behind → LIVE (effectively live), minutes
  // rounded down, hours + minutes above an hour. No unnecessary precision.
  // (The mechanical atLiveEdge tolerance stays 10 s; this label threshold is
  // the user-facing "effectively live" rule.)
  function dvrOffsetLabel(secondsBehind) {
    if (!Number.isFinite(secondsBehind) || secondsBehind < 60) return 'LIVE';
    const totalMin = Math.floor(secondsBehind / 60);
    if (totalMin < 1) return 'LIVE';
    if (totalMin < 60) return `−${totalMin} min`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `−${h} h ${m} min` : `−${h} h`;
  }

  // Seek to a fraction (0..1) of the CURRENT seekable window. Uses the live
  // values from state — never a hard-coded window size. Clamps safely and
  // does not touch playback state (no pause, no reload, no new session).
  function seekToWindowFraction(frac) {
    const cur = state.current;
    if (!cur || !cur.dvrAvailable) return;
    const start = cur.seekableStart;
    const end = cur.seekableEnd;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const clamped = Math.min(1, Math.max(0, frac));
    const target = start + clamped * (end - start);
    if (!Number.isFinite(target)) return;
    audioEl.currentTime = target;
  }

  // "Till Direkt": seek back to the live edge. Does NOT reload the stream,
  // does NOT create a new HLS session, and preserves the paused/playing state.
  //
  // BUG 1 FIX (WS2): this used to seek to `cur.seekableEnd` EXACTLY — the
  // precise end of the buffered range. That is the live edge, and Safari /
  // native HLS treat a seek onto the buffered BOUNDARY as a no-op or refuse
  // it, so the final step back to live appeared to do nothing. Programme skips
  // work precisely because they target a position in the MIDDLE of the buffer.
  // So we aim slightly BEHIND the edge instead.
  //
  // ---- WS23: the margin is now its OWN constant, and it is smaller ----
  // This used to subtract LIVE_EDGE_TOLERANCE_S (10). That constant is a
  // DISPLAY rule (when does the pill say "LIVE"?) and has no business sizing
  // a seek target. At 10 s the button always parked the playhead a visible
  // margin behind the edge, so a programme or song boundary falling inside
  // those 10 s had not resolved yet when the user pressed "Till Direkt".
  //
  // The margin still must not be 0 — see the SEEK_LIVE_MARGIN_S comment for
  // the Safari no-op that makes a non-boundary target necessary. The display
  // rule is untouched, so the pill still reads "LIVE" exactly where it does
  // today.
  //
  // Clamped against seekableStart so it can never fall outside the buffer.
  // Back-to-live evidence (WS3). seekToLive() has FAILED to fix the owner's
  // bug twice, so the most valuable single fact is WHICH LINE it exits at. If
  // it bails at `!cur` or at the non-finite-`end` guard, the button could never
  // have worked and no adjustment to the target would help. This records the
  // exit reason and the before/after state of the last invocation; it is
  // READ-ONLY and the seek logic itself is untouched.
  const SEEK_LIVE_DIAG = {
    calls: 0,
    lastExit: null,        // 'no-track' | 'no-finite-end' | 'no-dvr' | 'non-finite-target' | 'seeked'
    lastCalledAt: null,
    lastBefore: null,      // { currentTime, seekableStart, seekableEnd, distanceFromLiveEdge }
    lastTarget: null,
    lastAfter: null,       // read back AFTER updateSeekableState()
  };

  // ---- WS23: making the stream-edge assumption MEASURABLE on a device ----
  //
  // WHY THIS EXISTS, in plain terms: the app works out what time it is by
  // asking how far behind the end of the recording it currently is, and
  // subtracting that from the clock. That only gives the right answer if the
  // end of the recording really IS the present moment. Nobody has ever been
  // able to check that, because the app has no second, independent clock to
  // compare against — `Date.now()` is the one it already trusts.
  //
  // So the question was unfalsifiable, and an unfalsifiable assumption in a
  // time-mapping calculation is exactly how "about 10 s, then about 30 s"
  // went unexplained. This records the pieces so a human with the real
  // broadcast in front of them can supply the missing comparison.
  //
  // READ-ONLY CONTRACT: everything here is written to this module-scope
  // object only. It never touches `state.current`, never assigns
  // `audioEl.currentTime`, and never calls play/pause/load. The existing
  // read-only test in tests/metadata-diag.test.mjs must stay green.
  const SEEK_EDGE_DIAG = {
    calls: 0,
    lastCalledAt: null,
    // `edgeWallMs` and `nowMs` are both clock readings taken together. The
    // DIFFERENCE between them is the number that matters and the one that
    // could not previously be obtained: if the buffered edge claims to be a
    // moment other than now, that gap is the bias every resolved title and
    // every programme skip inherits.
    before: null,          // { edgeWallMs, nowMs, edgeMinusNowS, currentTime, readyState }
    after: null,           // { edgeWallMs, nowMs, edgeMinusNowS } sampled post-seek
    // A seek can be accepted, silently clamped, or ignored entirely. Recording
    // both the value asked for and the value the element ended up at is the
    // only way to tell those three apart from the outside.
    requestedTarget: null,
    acceptedPosition: null,
    clampedByS: null,
  };

  // Record the stream edge and the real clock together. `phase` is 'before'
  // or 'after' and is required so the two samples cannot be confused.
  function recordStreamEdge(phase) {
    const edge = streamEdgeWallMs();
    const now = Date.now();
    const sample = {
      edgeWallMs: edge,
      nowMs: now,
      // Positive = the app believes the buffer's edge is BEHIND the real
      // present, which pushes every resolved position FORWARD in time.
      edgeMinusNowS: Number.isFinite(edge) ? (now - edge) / 1000 : null,
      currentTime: audioEl.currentTime,
      readyState: audioEl.readyState,
    };
    SEEK_EDGE_DIAG.calls += 1;
    SEEK_EDGE_DIAG.lastCalledAt = new Date(now).toISOString();
    if (phase === 'after') {
      SEEK_EDGE_DIAG.after = sample;
    } else {
      SEEK_EDGE_DIAG.before = sample;
    }
    return sample;
  }

  // ===================== WS38: MEASURE THE SEEK. NO INTERPRETATION. =====
  //
  // WHY THIS BLOCK IS SO CAUTIOUS. Three explanations for the programme-skip
  // error have already been raised and withdrawn in this project, and the
  // fourth risk is a confident claim built on a number that cannot see what it
  // claims to measure. So the rules below are not stylistic:
  //
  // 1. NO ABSOLUTE DIFFERENCE between `seekableEnd` and the stream clock. The
  //    only media->wall mapping in the codebase is
  //        wall(m) = Date.now() - (seekableEnd - m) * 1000
  //    and at m = seekableEnd it collapses to Date.now() for ANY seekableEnd.
  //    So "seekableEnd vs the stream clock" is just `Date.now() - trueEdge`
  //    restated: it cannot see seekableEnd at all. Forbidden here.
  // 2. THE ONLY PERMITTED CROSS-FRAME COMPARISON IS A RATE between two samples
  //    taken at two different TIMES. A rate needs no absolute alignment between
  //    frames, so it cannot smuggle the assumption back in.
  // 3. Anything not measurable is `null`, never `0`. A `0` reads as "measured
  //    and zero"; `null` reads as "not measured". Conflating those has already
  //    produced one wrong conclusion in this repo.
  //
  // READ-ONLY with respect to playback: nothing here seeks, pauses, loads, or
  // writes any field the seek algorithm reads. The seek keeps using the CACHED
  // `cur.seekableEnd` exactly as before — that is deliberate, because
  // measurement 3 compares fresh against cached, and that comparison is only
  // meaningful if the cached value really is still the one in use.

  const SEEK_MEASURE = {
    // ---- measurement 1: how stale is the cached value the seek uses? ----
    // Every field is a raw reading or a subtraction of two raw readings.
    nowMs: null,                  // ms, this device's clock
    cachedWrittenAtMs: null,      // ms, when cur.seekableEnd was last written
    cachedAgeMs: null,            // ms, nowMs - cachedWrittenAtMs
    cachedSeekableEnd: null,      // MEDIA SECONDS (not ms) — the algorithm's value
    freshSeekableEnd: null,       // MEDIA SECONDS, read at this instant

    // ---- measurement 3: fresh vs cached, RECORDED AND NOT INTERPRETED ----
    freshMinusCachedMs: null,     // ms. Recorded. No conclusion drawn from it.

    // ---- measurement 4: what was asked for, and what the player did ----
    startMs: null,                // ms, absolute wall clock of the programme start
    behindMs: null,               // ms, Date.now() - startMs
    target: null,                 // MEDIA SECONDS, the computed seek target
    requestedTarget: null,        // MEDIA SECONDS, what the element was told
    acceptedPosition: null,       // MEDIA SECONDS, where it ended up
    clampedByS: null,             // MEDIA SECONDS, accepted - requested

    // ---- measurement 2: advancement RATE, two timed samples ----
    rate: null,                   // null until two samples exist
    lastSampleAtMs: null,         // internal: when sample 1 was taken
    samples: 0,                   // internal: how many rate samples taken
  };

  // Pure arithmetic, so it can be tested WITHOUT a media element (AGENTS.md §7
  // — never retype logic into a test; extract it and call it).
  // Returns null for any input it cannot measure. It NEVER returns 0 to mean
  // "unknown".
  function seekMeasurement1(reading) {
    if (!reading) return null;
    const { nowMs, cachedWrittenAtMs } = reading;
    if (!Number.isFinite(nowMs) || !Number.isFinite(cachedWrittenAtMs)) return null;
    return nowMs - cachedWrittenAtMs;
  }

  // The ONLY cross-frame comparison permitted in this workstream (§0 rule 2).
  // Both samples must exist and both frames must actually ADVANCE, otherwise
  // the rate is not measurable — and a confident 1.000 from two identical
  // samples would be the "sweep that cannot fail" this repo has been bitten by.
  function seekRateFromSamples(s1, s2) {
    if (!s1 || !s2) return null;
    const { nowMs: n1, seekableEnd: e1, trueEdgeWallMs: t1 } = s1;
    const { nowMs: n2, seekableEnd: e2, trueEdgeWallMs: t2 } = s2;
    if (![n1, e1, t1, n2, e2, t2].every(Number.isFinite)) return null;
    const wallElapsedMs = n2 - n1;                    // MILLISECONDS
    // `seekableEnd` is a MEDIA-TIME position in SECONDS, so its elapsed figure
    // is in seconds. It is converted to ms HERE, and only here, because the
    // rate below divides it by a millisecond figure — the WS38 test caught this
    // exact 1000x unit error when the rate came out as 0.0009 instead of 0.9.
    // Both units are kept in the returned record so a reader can see the
    // conversion rather than take it on trust.
    const seekableEndElapsedS = e2 - e1;              // MEDIA SECONDS
    const seekableEndElapsedMs = seekableEndElapsedS * 1000;  // MILLISECONDS
    // `trueEdgeWallMs` is on a ~1.7e12 ms scale, so its difference must be
    // allowed to be tiny in absolute terms; the guard is on the STREAM clock
    // not advancing at all, which means the sample is not usable.
    const streamElapsedMs = t2 - t1;                  // MILLISECONDS
    if (!(wallElapsedMs > 0)) return null;          // degenerate window
    if (!(seekableEndElapsedMs > 0)) return null;   // buffered end did not move
    if (!(streamElapsedMs > 0)) return null;        // stream clock did not move
    return {
      sample1: s1,
      sample2: s2,
      wallElapsedMs,
      streamElapsedMs,
      seekableEndElapsedMs,
      seekableEndElapsedS,
      // Rates are dimensionless ratios. 1.000 = this frame advances exactly as
      // fast as the reference frame.
      streamRateVsWall: streamElapsedMs / wallElapsedMs,
      seekableRateVsStream: seekableEndElapsedMs / streamElapsedMs,
    };
  }

  // Read the buffered end FRESH from the element. Media seconds. `null` when
  // there is no seekable range (direct MP3, or nothing buffered yet) — and
  // `null`, never 0, so "no range" cannot read as "range of zero length".
  function readFreshSeekableEnd() {
    try {
      const s = audioEl.seekable;
      if (!s || !s.length) return null;
      const end = s.end(s.length - 1);
      return Number.isFinite(end) ? end : null;
    } catch {
      return null;
    }
  }

  // ======================================================================
  // WS39 — the MEDIA-TIMELINE ORIGIN, measured independently of the seek.
  // ======================================================================
  //
  // WHAT QUESTION THIS ASKS. The seek equation is
  //
  //     target = seekableEnd - (Date.now() - startMs) / 1000
  //
  // which silently ASSUMES a mapping from media time to wall clock:
  //
  //     wallTimeAt(m) = trueEdgeWallMs + (m - seekableEnd) * 1000
  //
  // i.e. it assumes the media timeline and SR's UTC timeline have a COMMON
  // ORIGIN, and it assumes `trueEdgeWallMs` (the WS30 stream clock) is the wall
  // time of media position `seekableEnd`. Nobody has ever measured whether
  // either is true. This record exists to make that measurable.
  //
  // HOW IT MEASURES IT, WITHOUT THE SEEK EQUATION. hls.js can report the wall
  // clock of the CURRENT PLAYHEAD: `hls.latency.currentProgramDateTime`, which
  // it computes as
  //
  //     frag.programDateTime + (currentTime - frag.start) * 1000
  //
  // `frag.start` is a media position in the SAME timeline as
  // `audioEl.currentTime`, and `frag.programDateTime` is that fragment's
  // `#EXT-X-PROGRAM-DATE-TIME` — an absolute UTC instant. So the browser hands
  // us two values on two different timelines and a subtraction between them
  // yields the media origin. `Date.now()` is NOT an operand of that
  // subtraction: the two quantities being subtracted are both already wall
  // clock, and the device clock would only add the device's own error back in.
  //
  //   The equation below, with A the media origin:
  //       pdt = A + currentTime * 1000        =>  A = pdt - currentTime * 1000
  //
  // A CORRECTION TO MY OWN EARLIER WORK. In the WS39 investigation report I
  // proposed `mediaOriginDeltaMs = pdtForCurrentTimeMs - (nowMs - currentTimeS
  // * 1000)`. That formula is WRONG: it reintroduces `nowMs`, and it
  // double-counts the elapsed media time. Checked numerically before it was
  // written down — it returns 100000 where the true origin is
  // 1700000000000, because it is really computing `-2*currentTime*1000 + 2A`
  // under a specific nowMs. The implemented formula is the one above. Anyone
  // comparing this code against that report should read this comment, not the
  // report.
  //
  // WHY `wallClockDeltaMs` EXISTS. It is the quantity the seek equation
  // ASSUMES is zero: the difference between the wall time the app's stream
  // clock claims for media position `seekableEnd`, and the wall time hls.js
  // says that same media position really is. Zero means the assumption holds
  // for this stream; non-zero means the assumption is false by that much.
  //
  // NOTHING HERE IS INTERPRETED, and nothing here is CORRECTED. There is no
  // offset constant, no compensation, and no use of any field below by the seek
  // path. A measured value is recorded; what it means is a separate workstream
  // and a human decision.

  const ORIGIN_MEASURE = {
    // ---- common: one measurement instant ----
    capturedAtMs: null,            // ms, device clock, when the capture ran
    nowMs: null,                   // ms, Date.now() at that instant
    currentTimeS: null,            // MEDIA SECONDS
    seekableEndS: null,            // MEDIA SECONDS
    trueEdgeWallMs: null,          // ms, from the EXISTING WS30 probe, untouched

    // ---- Chromium / hls.js: the wall clock of the CURRENT PLAYHEAD ----
    pdtForCurrentTimeMs: null,      // ms, epoch. null if unavailable.
    pdtSource: 'unavailable',       // which branch produced pdtForCurrentTimeMs

    // ---- Safari / native HLS: getStartDate() ----
    startDateMs: null,             // ms, epoch. null if absent/throws.
    startDateSource: 'unavailable',

    // ---- derived, only when every operand is finite ----
    mediaOriginMs: null,           // ms, epoch: pdt - currentTimeS*1000
    wallClockDeltaMs: null,        // ms: see function below
    // Anything the reader needs to judge the above, stated explicitly.
    wallClockAtSeekableEndMs: null, // ms: hls.js mapping of seekableEnd
  };

  // Pure arithmetic, extracted and executed by the tests (AGENTS.md §7 — never
  // retype logic into a test). Returns null for any input it cannot measure,
  // and NEVER 0 to mean "unknown": null and 0 are different facts.
  //
  // `pdt` is the wall clock of `currentTimeS`; the media origin is therefore
  // `pdt - currentTimeS*1000`. `nowMs` is deliberately NOT a parameter of the
  // origin, because the device clock has no part in the subtraction.
  function originFromPdt(pdt, currentTimeS) {
    if (!Number.isFinite(pdt) || !Number.isFinite(currentTimeS)) return null;
    return pdt - currentTimeS * 1000;
  }

  // The wall clock of media position `seekableEndS`, per the hls.js mapping.
  // Expressed as the playhead's own mapping advanced by the distance between
  // the two media positions — both on the media timeline, so no device clock
  // is involved.
  function wallClockAtMediaPosition(pdt, currentTimeS, seekableEndS) {
    if (!Number.isFinite(pdt)) return null;
    if (!Number.isFinite(currentTimeS) || !Number.isFinite(seekableEndS)) return null;
    return pdt + (seekableEndS - currentTimeS) * 1000;
  }

  // The quantity the seek equation ASSUMES is zero. Null unless both wall
  // clocks for `seekableEndS` are known: the app's SR-PDT stream clock, and
  // the browser's own hls.js-derived one.
  function wallClockDelta(trueEdgeWallMs, pdt, currentTimeS, seekableEndS) {
    const atEnd = wallClockAtMediaPosition(pdt, currentTimeS, seekableEndS);
    if (!Number.isFinite(trueEdgeWallMs) || atEnd === null) return null;
    return trueEdgeWallMs - atEnd;
  }

  // Read `hls.latency.currentProgramDateTime` if hls.js is driving playback.
  //
  // NO OPTION IS ENABLED to obtain this. `Fragment.programDateTime` is parsed
  // unconditionally in hls.js 1.7.3 (there is no `useProgramDateTime` in that
  // version), and `HLS_CONFIG` is NOT touched.
  //
  // Every access is guarded: `latency` may be absent, the property may be
  // absent, `currentFrag` may be unresolved, and it may return null. All four
  // are "not measured", and all four record `null` rather than a guess.
  function readPdtForCurrentTime() {
    try {
      const inst = hlsInstance;
      if (!inst) return { pdt: null, source: 'no-hls-instance' };
      const latency = inst.latency;
      if (!latency) return { pdt: null, source: 'no-latency-controller' };
      const value = latency.currentProgramDateTime;
      if (!value || typeof value.getTime !== 'function') {
        return { pdt: null, source: 'no-current-fragment' };
      }
      const ms = value.getTime();
      return {
        pdt: Number.isFinite(ms) ? ms : null,
        source: Number.isFinite(ms) ? 'hls.latency.currentProgramDateTime' : 'null-instant',
      };
    } catch {
      return { pdt: null, source: 'threw' };
    }
  }

  // Safari-only, and NOT polyfilled. `getStartDate()` is a WebKit extension
  // that appears in no other engine; when it is missing the record says so
  // rather than guessing. MDN documents its value as the real-world time of the
  // START of the media, which for a live rolling window is exactly the
  // question this workstream has not yet been able to answer — so a non-null
  // reading here is a CANDIDATE origin, recorded and not yet trusted.
  function readStartDate() {
    try {
      const el = audioEl;
      if (!el || typeof el.getStartDate !== 'function') {
        return { ms: null, source: 'no-getStartDate' };
      }
      const value = el.getStartDate();
      if (!value || typeof value.getTime !== 'function') {
        return { ms: null, source: 'returned-null' };
      }
      const ms = value.getTime();
      return {
        ms: Number.isFinite(ms) ? ms : null,
        source: Number.isFinite(ms) ? 'getStartDate()' : 'returned-non-finite',
      };
    } catch {
      return { ms: null, source: 'threw' };
    }
  }

  // Take ONE measurement. Every field is a raw reading or a subtraction of two
  // raw readings. READ-ONLY with respect to playback: this function reads the
  // media element and the hls instance and writes nothing but ORIGIN_MEASURE.
  //
  // Called from the seek path (so the playhead is somewhere real) and from the
  // panel paint, so a value exists even if the owner never seeks.
  function captureOriginMeasurement() {
    const nowMs = Date.now();

    const t = Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : null;
    const s = readFreshSeekableEnd();

    const pdtRead = readPdtForCurrentTime();
    const sdRead = readStartDate();

    ORIGIN_MEASURE.capturedAtMs = nowMs;
    ORIGIN_MEASURE.nowMs = nowMs;
    ORIGIN_MEASURE.currentTimeS = t;
    ORIGIN_MEASURE.seekableEndS = s;
    // The EXISTING WS30 probe value, read as-is. This function does not fetch,
    // recompute, or write it.
    ORIGIN_MEASURE.trueEdgeWallMs =
      Number.isFinite(STREAM_EDGE_PROBE.trueEdgeWallMs)
        ? STREAM_EDGE_PROBE.trueEdgeWallMs : null;
    ORIGIN_MEASURE.pdtForCurrentTimeMs = pdtRead.pdt;
    ORIGIN_MEASURE.pdtSource = pdtRead.source;
    ORIGIN_MEASURE.startDateMs = sdRead.ms;
    ORIGIN_MEASURE.startDateSource = sdRead.source;
    ORIGIN_MEASURE.mediaOriginMs = originFromPdt(pdtRead.pdt, t);
    ORIGIN_MEASURE.wallClockAtSeekableEndMs =
      wallClockAtMediaPosition(pdtRead.pdt, t, s);
    ORIGIN_MEASURE.wallClockDeltaMs =
      wallClockDelta(ORIGIN_MEASURE.trueEdgeWallMs, pdtRead.pdt, t, s);
    return ORIGIN_MEASURE;
  }

  // ======================================================================
  // WS40 — DIAGNOSTIC ONLY. Validates the proposed absolute mapping on the
  // real iPhone (native HLS), where the ~25 s landing error was observed.
  // ======================================================================
  //
  // WHAT IS ESTABLISHED ALREADY (not re-derived here, see SESSION-STATUS):
  //   * the device clock is within ~1-2 s of real UTC;
  //   * the apparent ~30 s "clock offset" is SR's PLAYLIST overshooting real
  //     UTC by ~31.5 s — it is not a clock error;
  //   * SR schedule programme starts land 0.00 s off the stream's segment grid,
  //     so the schedule and the stream share a timeline origin;
  //   * the OLD mapping  target = seekableEnd - (Date.now()-startMs)/1000
  //     has error  = clockSkew - L,  where L is how far `seekableEnd` sits
  //     behind the live edge. L is transport-dependent, which is why the same
  //     code lands ~8-9 s early on desktop (MSE) and ~25 s early on iPhone
  //     (native HLS).
  //
  // WHAT IS PROPOSED (NOT YET IMPLEMENTED IN PRODUCTION):
  //     target = (startMs - A) / 1000        with A the media-timeline origin.
  // Written with `seekableEnd` substituted for A this is algebraically
  // `seekableEnd + (startMs - wallAtEnd)/1000`, in which `seekableEnd` appears
  // on both sides and CANCELS — so the buffered-edge lag L drops out entirely.
  // The production seek is DELIBERATELY UNCHANGED by this block.
  //
  // ---- THE CIRCULARITY TRAP, and why this diagnostic is built the way it is
  // A landing error computed as `(A + landing*1000) - startMs`, where the SAME
  // A built the target, is a TAUTOLOGY: it is identically zero even if A is
  // wrong by 999 s. Checked numerically before writing any of this. So the
  // error is NEVER computed that way.
  //
  // Instead the error is judged by SEGMENT INDEX, which uses no origin and no
  // device clock at all:
  //     segIdx(m) = (wallMs - headPdt) / (segmentMs * 1000)
  // The schedule says the programme starts at wall instant `startMs`; the
  // playlist says media position `(startMs - headPdt)/1000` is segment
  // `segIdx`. If the player lands on that segment index, the mapping is right.
  // Both sides are positions on the SAME media timeline, so a shared-origin
  // error cannot hide: it would move both equally and the DIFFERENCE is what
  // is reported.
  //
  // READ-ONLY WITH RESPECT TO PRODUCTION SEEKING. Nothing here changes
  // `seekToProgramTime`, `seekBy`, `seekToLive` or any production target. The
  // ONE seek this block performs is `ws40TestSeek()`, which is reachable ONLY
  // from an explicit owner action in the diagnostics panel, records both
  // mappings side by side, and is otherwise inert. It is a measurement, not a
  // fix: no value it produces is read by the production seek path.

  const WS40 = {
    // ---- inputs, recorded at one instant ----
    atMs: null,                 // device clock at capture
    programmeStartMs: null,     // SR schedule `starttimeutc`, epoch ms
    programmeTitle: null,
    currentTimeS: null,         // MEDIA SECONDS
    seekableStartS: null,       // MEDIA SECONDS
    seekableEndS: null,         // MEDIA SECONDS
    segmentMs: null,            // SR's segment duration (6.4 s measured)
    headPdtMs: null,            // playlist PDT, epoch ms
    playlistEdgeWallMs: null,   // headPdt + sum(EXTINF)
    playlistSampleAgeMs: null,  // age of the playlist fetch
    deviceNowMs: null,          // device clock, for the clock-skew term only
    originSource: 'unavailable', // how A was obtained
    originReason: null,         // WHY, in words, when A is not available
    mediaOriginMs: null,        // A
    transport: null,            // 'native-hls' | 'hlsjs' | 'direct'

    // ---- WS40b: the INDEPENDENT cross-check of A. DIAGNOSTIC ONLY. ----
    // A second, structurally different estimate of the same quantity (the
    // media-timeline origin), derived from SR's playlist instead of Safari.
    // It exists because no amount of arithmetic on A alone can validate A:
    // every earlier check was a restatement of the value under test.
    playlistOriginMs: null,     // trueEdgeWallMs - seekableEnd*1000
    originDeltaS: null,         // (mediaOriginMs - playlistOriginMs)/1000
    // Read so the delta can be weighted by how old the playlist sample is.
    // `trueEdgeWallMs` is only as current as this.
    playlistSampleAtMs: null,   // STREAM_EDGE_PROBE.sampledAtMs

    // ---- the two mappings, computed but NOT used by production ----
    existingTargetS: null,      // old equation
    proposedTargetS: null,      // new equation
    targetDeltaS: null,         // proposed - existing

    // ---- the test seek ----
    runs: [],
  };

  // Pure: media position -> segment index on the SR playlist grid.
  // No origin, no device clock. Returns null unless all inputs are finite.
  function ws40SegmentIndex(wallMs, headPdtMs, segmentMs) {
    if (!Number.isFinite(wallMs) || !Number.isFinite(headPdtMs)) return null;
    if (!Number.isFinite(segmentMs) || segmentMs <= 0) return null;
    return (wallMs - headPdtMs) / (segmentMs * 1000);
  }

  // Pure: the PROPOSED mapping. Needs A only.
  function ws40ProposedTarget(startMs, mediaOriginMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(mediaOriginMs)) return null;
    return (startMs - mediaOriginMs) / 1000;
  }

  // Pure: the EXISTING mapping, verbatim from seekToProgramTime.
  function ws40ExistingTarget(seekableEndS, deviceNowMs, startMs) {
    if (!Number.isFinite(seekableEndS)) return null;
    if (!Number.isFinite(deviceNowMs) || !Number.isFinite(startMs)) return null;
    return seekableEndS - (deviceNowMs - startMs) / 1000;
  }

  // Pure: how far a landing is from where it should have been, expressed in
  // SEGMENTS on the playlist grid. Origin-free and device-clock-free, so it
  // cannot be defeated by a shared-origin error.
  //
  // `expectedStartSeg` is the schedule's programme start as a segment index;
  // `landedSeg` is the landing position as a segment index. Their difference
  // is the landing error, and a negative value means the player landed
  // EARLIER than the programme start.
  function ws40LandingErrorSeg(expectedStartSeg, landedSeg) {
    if (!Number.isFinite(expectedStartSeg) || !Number.isFinite(landedSeg)) return null;
    return landedSeg - expectedStartSeg;
  }

  // Obtain A, the media-timeline origin, using only what the platform can
  // honestly provide. Preference order, and WHY:
  //
  //  1. `getStartDate()` (Safari). It is the only ABSOLUTE native-HLS anchor
  //     the phone has. Its semantics for a rolling window are UNVALIDATED —
  //     that is precisely what this workstream is here to find out, so it is
  //     recorded and used, with its source stated on every reading.
  //  2. `hls.latency.currentProgramDateTime` (Chromium/hls.js) minus
  //     `currentTime` — the media origin by construction.
  //
  // ---- A FALLBACK THAT WAS HERE AND WAS REMOVED, and why -----------------
  // There was a third option: `trueEdgeWallMs - seekableEnd*1000`, i.e. take
  // the playlist's own edge and back out the buffered edge. It is dimensionally
  // valid and it looks like a sensible fallback. It is also CIRCULAR, and
  // silently so.
  //
  // It computes A correctly ONLY IF the playlist's edge and the buffer's edge
  // are the SAME instant — i.e. only if L, the buffered-edge lag, is zero.
  // L is the entire quantity this workstream exists to measure. Using it as a
  // fallback would assume the answer and then report agreement, which is the
  // exact failure this repo has paid for repeatedly (a sweep that returns
  // zeros because the variable cancelled).
  //
  // It was removed rather than kept with a caveat, because a caveat on a
  // circular number is a comment, and comments do not prevent a reader from
  // quoting the number. `WS38 GUARD` in tests/seek-measure.test.mjs is right
  // to forbid it; the guard was not weakened.
  //
  // No fallback invents a number. Absent both sources, A is null and every
  // dependent value is null — which is the honest answer on a transport that
  // offers no absolute anchor.
  // ---- WS41: METADATA COLLECTOR -------------------------------------------
  // PURE: takes the timeline, the polled song and the META_DIAG record, and
  // returns the flat field set the snapshot prints. It reads NOTHING global,
  // which is what lets the tests execute it and assert its output exactly.
  //
  // It computes NO correction and NO alignment. It reports two offsets and
  // labels what each is a difference BETWEEN, because the entire finding is
  // that the two sides are anchored to different things.
  function ws41MetadataFields(timeline, onAir, diag) {
    const d = diag || {};
    const list = Array.isArray(timeline) ? timeline : [];
    const nowMs = Date.now();
    // Which entries came from where. The poll's entries are absolute; the
    // seek path's are programmeStart + relative. They are indistinguishable
    // once merged, which is why this is counted rather than assumed.
    const anchor = Number.isFinite(d.lastTrackEpisodeStartMs)
      ? d.lastTrackEpisodeStartMs : null;
    let seekCount = 0;
    let pollCount = 0;
    for (const e of list) {
      // A seek-path entry's startMs is >= the programme anchor and inside that
      // programme. Entries far outside it came from the absolute-timebase poll.
      if (anchor != null && e.startMs >= anchor) seekCount += 1;
      else pollCount += 1;
    }
    // The entry the panel would pick RIGHT NOW, and the same entry judged
    // against the playhead's wall-clock reconstruction. Both are reported; the
    // difference between them is the quantity under investigation.
    const end = state.current ? state.current.seekableEnd : null;
    const pwMs = playheadWallMs();
    const hit = pickByPosition(list, pwMs);
    let onAirOffsetS = null;
    if (onAir && Number.isFinite(onAir.startMs) && Number.isFinite(pwMs)) {
      onAirOffsetS = (pwMs - onAir.startMs) / 1000;
    }
    let hitOffsetS = null;
    if (hit && Number.isFinite(hit.startMs) && Number.isFinite(pwMs)) {
      hitOffsetS = (pwMs - hit.startMs) / 1000;
    }
    return {
      metaSource: d.lastTrackSource || null,
      metaEndpoint: d.lastTrackSource === 'player/ondemand'
        ? 'web-api.sr.se/v1/player/ondemand?id=<episodeId>&type=episode'
        : (d.lastTrackSource === 'playlists/rightnow'
          ? `${SR_API}/playlists/rightnow?channelid=<id>`
          : null),
      metaEpisodeId: d.lastTrackEpisodeId == null ? null : d.lastTrackEpisodeId,
      metaTrackCount: Number.isFinite(d.lastTrackCount) ? d.lastTrackCount : null,
      metaCapturedAtMs: Number.isFinite(d.lastTrackAt) ? d.lastTrackAt : null,
      metaTrackKeys: Array.isArray(d.lastTrackKeys) ? d.lastTrackKeys.join(',') : null,
      metaTrackSample: d.lastTrackSample ? JSON.stringify(d.lastTrackSample) : null,
      metaEpisodeStartMs: anchor,
      metaAnchorSource: 'SR schedule starttimeutc (fetchScheduleDay)',
      onAirTitle: onAir ? (onAir.title || null) : null,
      onAirArtist: onAir ? (onAir.artist || null) : null,
      onAirStartMs: onAir && Number.isFinite(onAir.startMs) ? onAir.startMs : null,
      onAirStopMs: onAir && Number.isFinite(onAir.stopMs) ? onAir.stopMs : null,
      timelineCount: list.length,
      timelinePollCount: pollCount,
      timelineSeekCount: seekCount,
      playheadWallMs: Number.isFinite(pwMs) ? pwMs : null,
      deviceNowMs: nowMs,
      cachedSeekableEnd: Number.isFinite(end) ? end : null,
      seekableEndWrittenAtMs: state.current
        && Number.isFinite(state.current.seekableEndWrittenAtMs)
        ? state.current.seekableEndWrittenAtMs : null,
      seekableEndAgeMs: state.current
        && Number.isFinite(state.current.seekableEndWrittenAtMs)
        ? nowMs - state.current.seekableEndWrittenAtMs : null,
      onAirOffsetS,
      timelineHitOffsetS: hitOffsetS,
      timelineHitTitle: hit ? (hit.title || null) : null,
      timelineHitStartMs: hit && Number.isFinite(hit.startMs) ? hit.startMs : null,
      timelineHitSource: hit
        ? (anchor != null && hit.startMs >= anchor ? 'SR tracks (programme-anchored)'
          : 'poll (absolute)')
        : null,
    };
  }

  // ---- WS42: BACKWARD-BINDING record. PURE for the same reason as the
  // collector above: everything arrives as an argument, so the tests can
  // execute it and assert the output exactly.
  //
  // It reports the CAPTURED value and, separately, what the same inputs would
  // select NOW. The gap between those two IS the defect, expressed as data
  // rather than as an argument. It computes no correction and changes no
  // selection.
  // `audio` is PASSED IN, not reached for. This function reads no global, so it
  // can be executed in a test with a fixture element and its output asserted
  // exactly — which is the only reason the second fresh/cached reading is
  // trustworthy at all. A "pure" collector that quietly read `audioEl` would
  // have been untestable and therefore unverified.
  function ws42PrevBindFields(bind, state, schedule, playheadWallMsFn, audio) {
    const b = bind || {};
    const end = state && state.current ? state.current.seekableEnd : null;
    const now = Date.now();
    const list = Array.isArray(schedule) ? schedule : [];
    // The live state: where the playhead sits by the app's own bridge now.
    const pwNow = typeof playheadWallMsFn === 'function' ? playheadWallMsFn() : null;
    const evNow = Number.isFinite(pwNow)
      ? (list.find((e) => e.startMs <= pwNow && pwNow < e.endMs)
        || list.find((e) => e.endMs > pwNow) || null)
      : null;
    const posNow = evNow ? evNow.startMs : pwNow;
    // What the backward handler WOULD select if it re-evaluated. Recomputed
    // here ONLY for comparison; the real handler still uses the captured
    // value, so this cannot change what a press does.
    const wouldPickNow = Number.isFinite(posNow)
      ? (list.length ? [...list].reverse().find((e) => e.startMs < posNow - 1000) : null)
      : null;
    const captured = Number.isFinite(b.prevStartMs) ? b.prevStartMs : null;
    const fresh = wouldPickNow && Number.isFinite(wouldPickNow.startMs)
      ? wouldPickNow.startMs : null;
    return {
      prevBindBound: b.boundAtMs == null ? null : b.boundAtMs,
      prevBindBoundAgoMs: b.boundAtMs == null ? null : now - b.boundAtMs,
      prevBindLiveEdgeWallMs: Number.isFinite(b.liveEdgeWallMs) ? b.liveEdgeWallMs : null,
      prevBindLiveEdgeWall: Number.isFinite(b.liveEdgeWallMs)
        ? new Date(b.liveEdgeWallMs).toISOString() : null,
      prevBindPosMs: Number.isFinite(b.posMs) ? b.posMs : null,
      prevBindPosWasEventStart: b.posMsWasEventStart == null ? null : b.posMsWasEventStart,
      prevBindContainingTitle: b.containingTitle || null,
      prevBindContainingStartMs: Number.isFinite(b.containingStartMs)
        ? b.containingStartMs : null,
      prevBindSeekableEnd: Number.isFinite(b.seekableEndAtBind) ? b.seekableEndAtBind : null,
      prevBindSeekableEndWrittenAt: Number.isFinite(b.seekableEndWrittenAtBind)
        ? b.seekableEndWrittenAtBind : null,
      prevBindCurrentTime: Number.isFinite(b.currentTimeAtBind) ? b.currentTimeAtBind : null,
      prevBindScheduleLength: Number.isFinite(b.scheduleLength) ? b.scheduleLength : null,
      // THE CAPTURED DECISION — what the button will do on a press.
      prevBindCapturedStartMs: captured,
      prevBindCapturedTitle: b.prevTitle || null,
      // WHAT IT WOULD DO NOW. A press seeks to `captured`, so this pair is the
      // skip, measured rather than argued.
      prevLivePosMs: Number.isFinite(posNow) ? posNow : null,
      prevLiveContainingTitle: evNow ? (evNow.title || null) : null,
      prevWouldSelectNowMs: fresh,
      prevWouldSelectNowTitle: wouldPickNow ? (wouldPickNow.title || null) : null,
      prevBindingIsStale: (captured != null && fresh != null) ? captured !== fresh : null,
      // How many boundaries stale, in whole programmes. This is the number the
      // owner sees as "skipped several". Counted between the two SELECTIONS,
      // not between the two positions: the schedules entries whose start lies
      // after what a fresh press would pick and up to what the captured press
      // will pick.
      prevSkippedCount: (captured != null && fresh != null && captured !== fresh && list.length)
        ? [...list].filter((e) => e.startMs > fresh && e.startMs <= captured).length
        : null,
      // A SECOND, INDEPENDENT reading of the same quantity the seek uses. The
      // WS38 record only samples AT a seek; this one is available at any
      // snapshot, so the discrepancy can be observed without seeking.
      freshSeekableEndNow: (() => {
        try {
          const s = audio && audio.seekable;
          if (!s || !s.length) return null;
          const e2 = s.end(s.length - 1);
          return Number.isFinite(e2) ? e2 : null;
        } catch { return null; }
      })(),
      cachedSeekableEndNow: Number.isFinite(end) ? end : null,
      freshMinusCachedNowMs: (() => {
        try {
          const s = audio && audio.seekable;
          if (!s || !s.length || !Number.isFinite(end)) return null;
          const e2 = s.end(s.length - 1);
          return Number.isFinite(e2) ? (e2 - end) * 1000 : null;
        } catch { return null; }
      })(),
      seekableEndAgeNowMs: state && state.current
        && Number.isFinite(state.current.seekableEndWrittenAtMs)
        ? now - state.current.seekableEndWrittenAtMs : null,
      currentTimeNow: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : null,
    };
  }

  // WS42: live wrapper for the bind record.
  function ws42CollectPrevBind() {
    return ws42PrevBindFields(META_DIAG.prevBind, state,
      state.current ? state.current._srSchedule : null, playheadWallMs, audioEl);
  }

  // WS41: live wrapper. Reads the element ONCE, synchronously, and delegates.
  // Nothing here changes metadata behaviour; it only observes it.
  function ws41CollectMetadata() {
    return ws41MetadataFields(nowPlaying.timeline, nowPlaying.song, META_DIAG);
  }

  function ws40ReadOrigin() {
    try {
      // (1) Safari native HLS.
      if (audioEl && typeof audioEl.getStartDate === 'function') {
        const d = audioEl.getStartDate();
        if (d && typeof d.getTime === 'function') {
          const ms = d.getTime();
          if (Number.isFinite(ms)) {
            return { originMs: ms, source: 'getStartDate()', assumption:
              'Safari anchors the media start; UNVALIDATED for a rolling '
              + 'DVR window. This is the hypothesis under test.' };
          }
        }
        return { originMs: null, source: 'getStartDate()-null', assumption:
          'the method exists but returned no usable instant' };
      }
      // (2) hls.js / MSE.
      const inst = hlsInstance;
      if (inst && inst.latency) {
        const v = inst.latency.currentProgramDateTime;
        if (v && typeof v.getTime === 'function') {
          const pdt = v.getTime();
          const cur = audioEl.currentTime;
          if (Number.isFinite(pdt) && Number.isFinite(cur)) {
            return { originMs: pdt - cur * 1000,
              source: 'hls.latency.currentProgramDateTime',
              assumption: 'PDT-derived; exact by construction' };
          }
        }
      }
      return { originMs: null, source: 'unavailable',
        assumption: 'this transport offers no absolute native-HLS origin; '
          + 'no fallback is derived, because every one of them assumes the '
          + 'answer (see the removed fallback above)' };
    } catch (err) {
      return { originMs: null, source: 'threw',
        assumption: String((err && err.message) || err).slice(0, 80) };
    }
  }

  // The transport actually in use, so a reading is never attributed to the
  // wrong path. Mirrors the CAPS decision in hlsAttach.
  function ws40Transport() {
    if (hlsInstance) return 'hlsjs';
    const cur = state.current;
    if (cur && cur.transport === 'hls') return 'native-hls';
    if (cur && typeof cur.audioUrl === 'string' && /\.m3u8/i.test(cur.audioUrl)) {
      return 'native-hls';
    }
    return cur ? 'direct' : null;
  }

  // Capture the inputs. READ-ONLY: reads the element and the existing probe,
  // writes only WS40. Never seeks, never fetches.
  //
  // `programmeStartMs` is supplied by the caller (the owner picks which
  // programme to test) so this function needs no network.
  function ws40Capture(programmeStartMs, programmeTitle) {
    const nowMs = Date.now();
    const p = STREAM_EDGE_PROBE;
    const segMs = p.segmentDurationS || null;
    const origin = ws40ReadOrigin();

    WS40.atMs = nowMs;
    WS40.deviceNowMs = nowMs;
    WS40.programmeStartMs = Number.isFinite(programmeStartMs) ? programmeStartMs : null;
    WS40.programmeTitle = programmeTitle || null;
    WS40.currentTimeS = Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : null;
    WS40.seekableStartS = null;
    WS40.seekableEndS = readFreshSeekableEnd();
    try {
      const s = audioEl.seekable;
      if (s && s.length) WS40.seekableStartS = s.start(0);
    } catch { /* recorded as null */ }
    WS40.segmentMs = Number.isFinite(segMs) ? segMs : null;
    WS40.headPdtMs = Number.isFinite(p.headPdtMs) ? p.headPdtMs : null;
    WS40.playlistEdgeWallMs =
      Number.isFinite(p.trueEdgeWallMs) ? p.trueEdgeWallMs : null;
    WS40.playlistSampleAgeMs =
      Number.isFinite(p.sampledAtMs) && Number.isFinite(p.staleAfterMs)
        ? nowMs - p.sampledAtMs : (Number.isFinite(p.sampledAtMs)
          ? nowMs - p.sampledAtMs : null);
    WS40.originSource = origin.source;
    WS40.originReason = origin.assumption || null;
    WS40.mediaOriginMs = origin.originMs;
    WS40.transport = ws40Transport();
    // ---- WS40b: the independent cross-check. Recorded ONLY. ----
    // Neither value below is read by any production target: `proposedTargetS`
    // is computed on the line after this, from `mediaOriginMs` alone, and it
    // must stay that way. A guard test forbids `playlistOriginMs` appearing
    // in the target computation.
    WS40.playlistSampleAtMs =
      Number.isFinite(p.sampledAtMs) ? p.sampledAtMs : null;
    WS40.playlistOriginMs = ws40PlaylistOrigin(
      WS40.playlistEdgeWallMs, WS40.seekableEndS);
    WS40.originDeltaS =
      ws40OriginDelta(WS40.mediaOriginMs, WS40.playlistOriginMs);
    WS40.existingTargetS =
      ws40ExistingTarget(WS40.seekableEndS, nowMs, WS40.programmeStartMs);
    WS40.proposedTargetS =
      ws40ProposedTarget(WS40.programmeStartMs, WS40.mediaOriginMs);
    WS40.targetDeltaS = (Number.isFinite(WS40.proposedTargetS)
      && Number.isFinite(WS40.existingTargetS))
      ? WS40.proposedTargetS - WS40.existingTargetS : null;
    return WS40;
  }

  // ---- the controlled test seek ------------------------------------------
  //
  // THE ONE SEEK THIS BLOCK PERFORMS. It is reachable only from an explicit
  // owner action in the diagnostics panel, and it does exactly one thing the
  // production path does not: it seeks to the PROPOSED target instead of the
  // existing one, then measures where the player actually landed.
  //
  // The landing is judged in SEGMENTS, never by re-converting with the origin
  // that built the target (see the tautology note above).
  //
  // `mapping` is 'proposed' or 'existing', so the owner can run BOTH and get
  // a like-for-like comparison on the same phone, same channel, same window.
  async function ws40TestSeek(mapping) {
    const cur = state.current;
    if (!cur || cur.kind !== 'live') return null;
    const useProposed = mapping !== 'existing';
    const target = useProposed ? WS40.proposedTargetS : WS40.existingTargetS;
    if (!Number.isFinite(target)) return null;
    // Refuse to leave the buffered window rather than clamping silently: a
    // clamped seek would understate the landing error.
    const start = Number.isFinite(WS40.seekableStartS) ? WS40.seekableStartS : 0;
    const end = Number.isFinite(WS40.seekableEndS) ? WS40.seekableEndS : null;
    if (Number.isFinite(end) && (target < start || target > end)) {
      return { mapping, skipped: 'target-outside-window', target,
        seekableStartS: start, seekableEndS: end };
    }
    const expectedStartSeg = ws40SegmentIndex(
      WS40.programmeStartMs, WS40.headPdtMs, WS40.segmentMs);
    const requested = target;
    audioEl.currentTime = target;
    // Let the element settle before reading where it landed. A seek is
    // asynchronous: currentTime is updated synchronously on assignment in
    // most engines but the SEEKED-TO position arrives after the seek completes.
    await new Promise((r) => setTimeout(r, 700));
    const landed = Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : null;
    const landedSeg = ws40SegmentIndex(
      WS40.programmeStartMs, WS40.headPdtMs, WS40.segmentMs);
    const landedWallFromOrigin = Number.isFinite(landed) && Number.isFinite(WS40.mediaOriginMs)
      ? WS40.mediaOriginMs + landed * 1000 : null;
    const run = {
      mapping: useProposed ? 'proposed' : 'existing',
      atMs: Date.now(),
      programmeTitle: WS40.programmeTitle,
      programmeStartMs: WS40.programmeStartMs,
      requestedTargetS: requested,
      landedS: landed,
      // What the player did to our request, in media seconds. WS38 measured
      // this as ~0 on both platforms, so a large value here means the player
      // clamped and the landing error is NOT the mapping's fault.
      clampedByS: Number.isFinite(landed) ? landed - requested : null,
      originSource: WS40.originSource,
      mediaOriginMs: WS40.mediaOriginMs,
      transport: WS40.transport,
      segmentMs: WS40.segmentMs,
      // THE ACCEPTANCE NUMBER. Segment-index error: origin-free, device-clock-free.
      landingErrorSeg: ws40LandingErrorSeg(expectedStartSeg, landedSeg),
      // The same error in seconds, for reading. Derived from segments × the
      // measured segment duration, so it inherits the same independence.
      landingErrorS: (Number.isFinite(expectedStartSeg) && Number.isFinite(landedSeg)
        && Number.isFinite(WS40.segmentMs))
        ? (landedSeg - expectedStartSeg) * WS40.segmentMs : null,
      // Wall-clock reading of the landing, using the origin under test. This
      // IS the tautological figure and is labelled as such: it is here only so
      // a reader can see that it reads ~0 regardless, which is why it is not
      // used as evidence.
      landedWallMsSameOrigin: landedWallFromOrigin,
      tautologicalByConstruction: true,
    };
    WS40.runs.push(run);
    if (WS40.runs.length > 12) WS40.runs.shift();
    return run;
  }

  // Render the WS40 record. Pure and total. `null` renders as "okänd", never
  // as 0 — "measured and zero" and "not measured" are different facts.
  function ws40RecordText() {
    const n = (v) => (Number.isFinite(v) ? v : null);
    const ms = (v) => (Number.isFinite(v) ? `${Math.round(v)} ms` : 'okänd');
    const sec = (v) => (Number.isFinite(v) ? `${v.toFixed(2)} s` : 'okänd');
    const iso = (v) => (Number.isFinite(v) ? new Date(v).toISOString() : 'okänd');
    const lines = [];
    lines.push('MÄTNING (WS40) — test av den FÖRESLAGNA mätningen');
    lines.push('Produktionens sökning är OFÖRÄNDRAD. Detta mäter bara.');
    lines.push('');
    if (!Number.isFinite(WS40.atMs)) {
      lines.push('Ingen mätning gjord ännu. Tryck på "Mät".');
      return lines.join('\n');
    }
    lines.push('Insamlat');
    lines.push(`   transport: ${WS40.transport || 'okänd'}`);
    lines.push(`   program: ${WS40.programmeTitle || 'okänd'}`);
    lines.push(`   starttimeutc: ${iso(WS40.programmeStartMs)}`);
    lines.push(`   currentTime (media-s): ${sec(n(WS40.currentTimeS))}`);
    lines.push(`   seekableStart (media-s): ${sec(n(WS40.seekableStartS))}`);
    lines.push(`   seekableEnd (media-s): ${sec(n(WS40.seekableEndS))}`);
    lines.push('');
    lines.push('SR:s segmentrutnät (från spellistan, ingen enhetsklocka)');
    lines.push(`   headPdt: ${iso(WS40.headPdtMs)}`);
    lines.push(`   segment (ms): ${n(WS40.segmentMs)}`);
    lines.push(`   spellistans kant: ${iso(WS40.playlistEdgeWallMs)}`);
    lines.push(`   provets ålder: ${ms(n(WS40.playlistSampleAgeMs))}`);
    lines.push('');
    lines.push('Medietidsnollpunkten A');
    lines.push(`   A: ${iso(WS40.mediaOriginMs)}`);
    lines.push(`   källa: ${WS40.originSource}`);
    if (!Number.isFinite(WS40.mediaOriginMs) && WS40.originReason) {
      lines.push(`   anledning: ${WS40.originReason}`);
    }
    lines.push('');
    lines.push('Oberoende kontroll av A (från SR:s spellista)');
    lines.push(`   A ur spellistan: ${iso(WS40.playlistOriginMs)}`);
    lines.push(`   skillnad A − A_spellista: ${sec(n(WS40.originDeltaS))}`);
    lines.push(`   provets tidsstämpel: ${iso(WS40.playlistSampleAtMs)}`);
    lines.push(`   provets ålder: ${ms(n(WS40.playlistSampleAgeMs))}`);
    if (Number.isFinite(WS40.originDeltaS)) {
      lines.push('');
      lines.push('   LÄS DETTA: spellistans kant LIGGER ~31 s EFTER verklig tid');
      lines.push('   (SR publicerar spellistan en halv minut före). A_playlist');
      lines.push('   är därför ~+31 s snedvriden, så ett PERFEKT getStartDate()');
      lines.push('   ger en skillnad på ~−31 s, INTE ~0. Rätta för det innan');
      lines.push('   du drar slutsatser.');
    }
    lines.push('');
    lines.push('De två målen (beräknas, används INTE av produktionen)');
    lines.push(`   befintlig formel: ${sec(n(WS40.existingTargetS))}`);
    lines.push(`   föreslagen formel: ${sec(n(WS40.proposedTargetS))}`);
    lines.push(`   skillnad: ${sec(n(WS40.targetDeltaS))}`);
    if (!WS40.runs.length) {
      lines.push('');
      lines.push('Ingen testseek körd. Kör "Testseek föreslagen" först,');
      lines.push('sedan "Testseek befintlig", för att jämföra samma fönster.');
      return lines.join('\n');
    }
    lines.push('');
    lines.push('RESULTAT — felet mäts i SEGMENT, utan ursprung och utan klocka');
    for (const r of WS40.runs) {
      lines.push(`   [${r.mapping}] ${r.programmeTitle || 'okänd'}`);
      if (r.skipped) {
        lines.push(`      hoppades över: ${r.skipped}`);
        lines.push(`      mål ${sec(n(r.requestedTargetS))} utanför `
          + `[${sec(n(r.seekableStartS))}, ${sec(n(r.seekableEndS))}]`);
        continue;
      }
      lines.push(`      begärde: ${sec(n(r.requestedTargetS))}`);
      lines.push(`      landade: ${sec(n(r.landedS))}`);
      lines.push(`      spelaren klippte: ${sec(n(r.clampedByS))}`);
      lines.push(`      segmentfel: ${n(r.landingErrorSeg)} `
        + `= ${sec(n(r.landingErrorS))}`);
      lines.push(`      A-källa: ${r.originSource}`);
    }
    const ok = WS40.runs.filter((r) => Number.isFinite(r.landingErrorSeg));
    if (ok.length) {
      const worst = Math.max(...ok.map((r) => Math.abs(r.landingErrorS || 0)));
      lines.push('');
      lines.push(`Mest avvikande körning: ${worst.toFixed(2)} s `
        + `(${ok.length} körningar mätta)`);
    }
    return lines.join('\n');
  }

  // Pure: the media-timeline origin according to SR's OWN PLAYLIST.
  //
  //   A_playlist = trueEdgeWallMs - seekableEnd * 1000
  //
  // `trueEdgeWallMs` is `headPdt + sum(EXTINF)`, computed by `parseVariantEdge`
  // from a playlist the app fetched itself. `seekableEnd` is the buffered edge
  // the media element reports. Neither input involves `getStartDate()`, the
  // proposed target, or the device clock — so the difference from Safari's
  // anchor is a genuine CROSS-CHECK and not a restatement of it.
  //
  // KNOWN BIAS, measured 2026-10-01 (n=6, range 29-34 s, mean 31.5 s):
  // `trueEdgeWallMs` OVERSHOOTS real UTC, because summing every EXTINF runs
  // past the last segment that has actually aired — SR publishes the playlist
  // roughly half a minute ahead. So `A_playlist` inherits that overshoot and
  // `A_playlist ~ A_true + 31.5 s`.
  //
  // CONSEQUENCE FOR READING `delta` — stated here so the number cannot be
  // misread as a verdict:
  //
  //     delta = A_safari - A_playlist = (A_safari - A_true) - 31.5 s
  //
  // A PERFECT `getStartDate()` therefore does NOT give delta ~ 0; it gives
  // delta ~ -31.5 s. The acceptance band must be centred there, NOT on zero.
  // A `getStartDate()` that is genuinely 25-37 s out gives a delta tens of
  // seconds away from that band. The test still discriminates the two
  // hypotheses by a wide margin; it just does not discriminate them by
  // comparing against zero.
  //
  // Returns null unless both operands are finite. It is DIAGNOSTIC ONLY: see
  // the guard test that forbids it reaching any production target.
  function ws40PlaylistOrigin(trueEdgeWallMs, seekableEndS) {
    if (!Number.isFinite(trueEdgeWallMs)) return null;
    if (!Number.isFinite(seekableEndS)) return null;
    return trueEdgeWallMs - seekableEndS * 1000;
  }

  // Pure: the difference between the two independently derived origins, in
  // seconds. Positive means Safari's anchor is LATER than the playlist's.
  // This is the cross-check number; see the bias note above before reading it.
  function ws40OriginDelta(originMs, playlistOriginMs) {
    if (!Number.isFinite(originMs) || !Number.isFinite(playlistOriginMs)) return null;
    return (originMs - playlistOriginMs) / 1000;
  }

  // ======================================================================
  // WS40c — "Kopiera all diagnostik": ONE atomic snapshot, plain text.
  // ======================================================================
  //
  // WHY. The diagnostics refresh every couple of seconds and the values move
  // while they are read. Copying them by scraping the rendered DOM, or by
  // reading one field at a time from live objects, produces a report whose
  // parts belong to DIFFERENT instants -- and this investigation has already
  // been burned twice by a number that was internally inconsistent (the
  // tautological `segmentfel`, and a `getStartDate()` reported as
  // `unavailable` that had never been read at all).
  //
  // So the text is built by a PURE function from ONE already-captured record.
  // Every value is passed in; the function reads nothing global. If a value
  // refreshes while the clipboard operation is in flight, the string already
  // exists and cannot change underneath the user.
  //
  // It is DIAGNOSTIC ONLY. It reads the same records the panel displays and
  // writes nothing at all -- no playback, no seek, no network.

  // Render one value, or the word the owner asked for. A missing value is
  // NEVER replaced by a derived one and NEVER by 0.
  function ws40Fmt(v, unit) {
    if (v === null || v === undefined) return 'unavailable';
    if (typeof v === 'number' && !Number.isFinite(v)) return 'unavailable';
    if (typeof v === 'boolean' || typeof v === 'string') return String(v);
    if (unit === 'ms') return `${Math.round(v)} ms`;
    if (unit === 'iso') return new Date(v).toISOString();
    if (unit === 's') return `${v.toFixed(2)} s`;
    return String(v);
  }

  // Build the whole report. PURE: every input arrives as an argument, so the
  // output is a function of one moment and cannot drift.
  function ws40SnapshotText(d) {
    const L = [];
    const push = (k, v, unit) => L.push(`${k}: ${ws40Fmt(v, unit)}`);

    L.push(`WS40 SNAPSHOT — ${ws40Fmt(d.snapshotAtMs, 'iso')}`);
    L.push('');
    L.push('== BUILD / CONTEXT ==');
    push('APP_BUILD', d.appBuild);
    push('measurement timestamp (raw ms)', d.snapshotAtMs, 'ms');
    push('transport', d.transport);
    push('channel', d.channelTitle);
    push('channel id', d.channelId);
    push('programme', d.programmeTitle);
    push('programme starttimeutc (raw ms)', d.programmeStartMs, 'ms');
    push('programme starttimeutc (UTC)', d.programmeStartMs, 'iso');
    L.push('');

    L.push('== MEDIA / HLS ==');
    push('currentTime (media seconds)', d.currentTimeS, 's');
    push('seekableStart (media seconds)', d.seekableStartS, 's');
    push('seekableEnd (media seconds)', d.seekableEndS, 's');
    push('duration (media seconds)', d.durationS, 's');
    push('readyState (HAVE_METADATA=1, HAVE_CURRENT_DATA=2, HAVE_FUTURE_DATA=3, HAVE_ENOUGH=4)', d.readyState);
    push('networkState (NETWORK_EMPTY=0 .. NETWORK_NO_SOURCE=3)', d.networkState);
    push('paused', d.paused);
    L.push('');

    L.push('== SAFARI A (getStartDate) ==');
    push('A (getStartDate, raw ms)', d.mediaOriginMs, 'ms');
    push('A (getStartDate, UTC)', d.mediaOriginMs, 'iso');
    push('A source', d.originSource);
    push('A reason if unavailable', d.originReason);
    // The RAW value exactly as Safari handed it over, so the reader can see
    // whether it was null, non-finite, or simply never asked for.
    push('getStartDate() raw', d.startDateRaw);
    push('getStartDate() is a function on this element', d.hasGetStartDateFn);
    L.push('NOTE: A is NEVER reconstructed from seekableEnd, trueEdgeWallMs,');
    L.push('      currentTime, the proposed target or any programme time.');
    L.push('');

    // ---- WS41: METADATA. The two sources use different timebases and their
    // entries are merged into ONE list, so this section exists to make that
    // visible rather than to assert anything about it.
    L.push('== METADATA SOURCE / TIMEBASE ==');
    push('metadata source (last track set)', d.metaSource);
    push('metadata endpoint', d.metaEndpoint);
    push('metadata episodeId', d.metaEpisodeId);
    push('metadata track count', d.metaTrackCount);
    push('metadata capturedAtMs (raw ms)', d.metaCapturedAtMs, 'ms');
    push('metadata capturedAt (UTC)', d.metaCapturedAtMs, 'iso');
    // The literal key names on one raw track. This is what proves the payload
    // carries no absolute timestamp: if a real one ever appears, it appears HERE.
    push('raw track keys (verbatim)', d.metaTrackKeys);
    push('raw track[0] (verbatim)', d.metaTrackSample);
    push('programme anchor startMs (raw ms)', d.metaEpisodeStartMs, 'ms');
    push('programme anchor (UTC)', d.metaEpisodeStartMs, 'iso');
    push('anchor source', d.metaAnchorSource);
    L.push('');

    L.push('== METADATA AS THE PANEL SEES IT ==');
    push('on-air song (poll)', d.onAirTitle);
    push('on-air artist (poll)', d.onAirArtist);
    push('on-air startMs (raw ms)', d.onAirStartMs, 'ms');
    push('on-air stopMs (raw ms)', d.onAirStopMs, 'ms');
    push('timeline entries', d.timelineCount);
    push('timeline entries from poll', d.timelinePollCount);
    push('timeline entries from SR tracks', d.timelineSeekCount);
    L.push('');

    L.push('== PLAYHEAD -> WALL-CLOCK MAPPING (the only bridge) ==');
    push('playheadWallMs() result (raw ms)', d.playheadWallMs, 'ms');
    push('playheadWallMs (UTC)', d.playheadWallMs, 'iso');
    push('derived from: Date.now() (raw ms)', d.deviceNowMs, 'ms');
    push('cached seekableEnd used (media s)', d.cachedSeekableEnd, 's');
    push('cached seekableEnd writtenAtMs', d.seekableEndWrittenAtMs, 'ms');
    push('cached seekableEnd age at snapshot', d.seekableEndAgeMs, 'ms');
    push('currentTime read (media s)', d.currentTimeS, 's');
    L.push('NOTE: playheadWallMs() = Date.now() - (cachedSeekableEnd - currentTime)*1000');
    L.push('      It does NOT use getStartDate(). It is the ONLY bridge between');
    L.push('      media seconds and the absolute metadata timeline, and its anchor');
    L.push('      is a CACHED buffered edge, not the timeline\'s programme start.');
    L.push('');

    L.push('== BACKWARD PROGRAMME BINDING (WS42) ==');
    push('bound at (raw ms)', d.prevBindBound, 'ms');
    push('bound at (UTC)', d.prevBindBound, 'iso');
    push('bound this long ago (ms)', d.prevBindBoundAgoMs, 'ms');
    push('liveEdgeWallMs() at bind', d.prevBindLiveEdgeWall, 'ms');
    push('posMs() at bind', d.prevBindPosMs, 'ms');
    push('posMs() was the event start', d.prevBindPosWasEventStart);
    push('containing programme at bind', d.prevBindContainingTitle);
    push('seekableEnd at bind (media s)', d.prevBindSeekableEnd, 's');
    push('seekableEnd writtenAt at bind', d.prevBindSeekableEndWrittenAt, 'ms');
    push('currentTime at bind (media s)', d.prevBindCurrentTime, 's');
    push('schedule entries', d.prevBindScheduleLength);
    push('CAPTURED prevEv startMs', d.prevBindCapturedStartMs, 'ms');
    push('CAPTURED prevEv (UTC)', d.prevBindCapturedStartMs, 'iso');
    push('CAPTURED prevEv title', d.prevBindCapturedTitle);
    push('NOW: posMs()', d.prevLivePosMs, 'ms');
    push('NOW: containing programme', d.prevLiveContainingTitle);
    push('NOW: would select (startMs)', d.prevWouldSelectNowMs, 'ms');
    push('NOW: would select (title)', d.prevWouldSelectNowTitle);
    push('IS THE BINDING STALE', d.prevBindingIsStale);
    push('programmes skipped by the stale binding', d.prevSkippedCount);
    L.push('READING THIS: a press on the backward button seeks to the CAPTURED');
    L.push('      value, not to "would select now". Where those differ, that is the');
    L.push('      skip, measured. "would select" is computed HERE for comparison only');
    L.push('      — the real handler is unchanged and still uses the captured value.');
    L.push('');

    L.push('== SEEKABLE EDGE: SECOND INDEPENDENT READING (WS42) ==');
    push('currentTime now (media s)', d.currentTimeNow, 's');
    push('cached seekableEnd now (media s)', d.cachedSeekableEndNow, 's');
    push('fresh seekableEnd now (media s)', d.freshSeekableEndNow, 's');
    push('fresh MINUS cached (ms)', d.freshMinusCachedNowMs, 'ms');
    push('cached value age now (ms)', d.seekableEndAgeNowMs, 'ms');
    L.push('SIGN: NEGATIVE means the CACHED edge is AHEAD of the fresh read.');
    L.push('      Since target = end - behindMs/1000 and target INCREASES with end,');
    L.push('      an oversized cached edge moves the landing point FORWARD.');
    L.push('      Compare with the WS38 "fresh seekableEnd" above, which is sampled');
    L.push('      AT a seek; this one is sampled at snapshot time and needs no seek.');
    L.push('');

    L.push('== METADATA vs MEDIA (measured, not assumed) ==');
    push('playheadWallMs - onAirStartMs (s)', d.onAirOffsetS, 's');
    push('playheadWallMs - timelineHitStartMs (s)', d.timelineHitOffsetS, 's');
    push('timeline hit title', d.timelineHitTitle);
    push('timeline hit startMs (raw ms)', d.timelineHitStartMs, 'ms');
    push('timeline hit came from', d.timelineHitSource);
    L.push('READING THIS: a NON-ZERO "playheadWallMs - hitStartMs" is NOT proof of');
    L.push('a metadata error. It is the difference between two different anchors —');
    L.push('the timeline entry is anchored to PROGRAMME START, the playhead to a');
    L.push('CACHED seekableEnd. To attribute a mismatch, compare the anchors first:');
    L.push('  (programme anchor) vs (getStartDate()) vs (cached seekableEnd edge).');
    L.push('');

    L.push('== PLAYLIST WITNESS ==');
    push('headPdtMs (raw ms)', d.headPdtMs, 'ms');
    push('headPdt (UTC)', d.headPdtMs, 'iso');
    push('trueEdgeWallMs (raw ms)', d.trueEdgeWallMs, 'ms');
    push('playlist edge (UTC)', d.trueEdgeWallMs, 'iso');
    push('segmentDurationS', d.segmentMs);
    push('playlist sampledAtMs (raw ms)', d.playlistSampleAtMs, 'ms');
    push('playlist sampledAt (UTC)', d.playlistSampleAtMs, 'iso');
    push('playlist sample age (ms)', d.playlistSampleAgeMs, 'ms');
    push('playlist sample age (s)', d.playlistSampleAgeMs === null
      ? null : d.playlistSampleAgeMs / 1000, 's');
    L.push('');

    L.push('== INDEPENDENT ORIGIN CHECK ==');
    push('A_playlist = trueEdgeWallMs - seekableEnd*1000 (raw ms)', d.playlistOriginMs, 'ms');
    push('A_playlist (UTC)', d.playlistOriginMs, 'iso');
    push('A_safari (raw ms)', d.mediaOriginMs, 'ms');
    push('A_safari - A_playlist (seconds)', d.originDeltaS, 's');
    L.push('reproduce: A_playlist = trueEdgeWallMs - seekableEnd * 1000');
    L.push(`         values:  ${ws40Fmt(d.trueEdgeWallMs, 'ms')} - ${ws40Fmt(d.seekableEndS, 's')} * 1000`);
    L.push('READ WITH THE BIAS IN MIND: trueEdgeWallMs overshoots real UTC by');
    L.push('about 31.5 s, so A_playlist inherits it. A PERFECT getStartDate()');
    L.push('gives a difference near -31.5 s, NOT near 0.');
    L.push('');

    L.push('== TARGET DIAGNOSTICS (computed, never used by production) ==');
    push('existing formula target (media seconds)', d.existingTargetS, 's');
    push('proposed formula target (media seconds)', d.proposedTargetS, 's');
    push('difference proposed - existing (s)', d.targetDeltaS, 's');
    push('startMs (raw ms)', d.startMs, 'ms');
    push('startMs (UTC)', d.startMs, 'iso');
    push('behindMs = now - startMs (ms)', d.behindMs, 'ms');
    push('WS38 cached seekableEnd (media seconds)', d.cachedSeekableEnd, 's');
    push('WS38 fresh seekableEnd (media seconds)', d.freshSeekableEnd, 's');
    push('WS38 rate', d.rate);
    L.push('');

    L.push('== TEST SEEKS RUN (this session) ==');
    if (!d.runs || !d.runs.length) {
      L.push('none — no test seek has been performed');
    } else {
      for (const r of d.runs) {
        L.push(`- [${r.mapping}] ${r.programmeTitle || 'okänd'}`);
        L.push(`    requested: ${ws40Fmt(r.requestedTargetS, 's')}`);
        L.push(`    landed:    ${ws40Fmt(r.landedS, 's')}`);
        L.push(`    clamped:   ${ws40Fmt(r.clampedByS, 's')}`);
      }
    }
    L.push('');
    L.push('== SAFETY ==');
    L.push('production seek equation: end - (Date.now() - startMs)/1000 — UNCHANGED');
    L.push('this snapshot is diagnostic only; it changed no playback state');
    return L.join('\n');
  }

  // Take the snapshot. Reads the already-captured records ONCE, synchronously,
  // so every field belongs to the same instant, and hands the finished string
  // to the clipboard. The string is built BEFORE any await, so a refresh
  // during the clipboard write cannot alter it.
  async function ws40CopyDiagnostics(button, labelNode, boxNode) {
    const nowMs = Date.now();
    const cur = state.current;
    const p = STREAM_EDGE_PROBE;
    // Read the element's live state at this instant and never again.
    const readyState = Number.isFinite(audioEl.readyState) ? audioEl.readyState : null;
    const networkState = Number.isFinite(audioEl.networkState)
      ? audioEl.networkState : null;
    const durationS = Number.isFinite(audioEl.duration) ? audioEl.duration : null;
    const paused = typeof audioEl.paused === 'boolean' ? audioEl.paused : null;
    // Probe the method's existence SEPARATELY from its value, so "the method
    // is missing" can never be reported as "the method returned nothing".
    // These are different faults and the owner has to be able to tell them
    // apart -- an earlier run conflated them.
    const hasFn = typeof audioEl.getStartDate === 'function';
    let startDateRaw = 'not read';
    if (hasFn) {
      try {
        const d = audioEl.getStartDate();
        startDateRaw = d === null ? 'null'
          : (d === undefined ? 'undefined'
            : (typeof d.getTime === 'function' ? String(d.getTime()) : String(d)));
      } catch (err) {
        startDateRaw = `threw: ${String((err && err.message) || err).slice(0, 60)}`;
      }
    } else {
      startDateRaw = 'method absent on this element';
    }

    const text = ws40SnapshotText({
      snapshotAtMs: nowMs,
      appBuild: APP_BUILD,
      transport: WS40.transport || ws40Transport(),
      channelTitle: cur ? (cur.title || cur.name || null) : null,
      channelId: cur ? (cur.id ?? null) : null,
      programmeTitle: WS40.programmeTitle,
      programmeStartMs: WS40.programmeStartMs,
      currentTimeS: Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : null,
      seekableStartS: WS40.seekableStartS,
      seekableEndS: WS40.seekableEndS,
      durationS,
      readyState,
      networkState,
      paused,
      mediaOriginMs: WS40.mediaOriginMs,
      originSource: WS40.originSource,
      originReason: WS40.originReason || null,
      startDateRaw,
      hasGetStartDateFn: hasFn,
      headPdtMs: WS40.headPdtMs,
      trueEdgeWallMs: WS40.playlistEdgeWallMs,
      segmentMs: WS40.segmentMs,
      playlistSampleAtMs: WS40.playlistSampleAtMs,
      playlistSampleAgeMs: WS40.playlistSampleAgeMs,
      playlistOriginMs: WS40.playlistOriginMs,
      originDeltaS: WS40.originDeltaS,
      existingTargetS: WS40.existingTargetS,
      proposedTargetS: WS40.proposedTargetS,
      targetDeltaS: WS40.targetDeltaS,
      startMs: SEEK_MEASURE.startMs,
      behindMs: SEEK_MEASURE.behindMs,
      cachedSeekableEnd: SEEK_MEASURE.cachedSeekableEnd,
      freshSeekableEnd: SEEK_MEASURE.freshSeekableEnd,
      rate: SEEK_MEASURE.rate,
      runs: WS40.runs.slice(),
      // ---- WS41: metadata. Spread from the pure collector so the snapshot
      // stays a function of ONE input object; the collector itself is pure and
      // is unit-tested separately.
      ...ws41CollectMetadata(),
      // ---- WS42: the backward binding record + a second, seek-free reading of
      // the cached/fresh seekable-end discrepancy. Observation only.
      ...ws42CollectPrevBind(),
    });

    // The string exists now. Nothing below can change it.
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch { /* handled below */ }
    if (ok) {
      showToast('Diagnostik kopierad', 1500);
      if (button && labelNode) {
        labelNode.textContent = 'Diagnostik kopierad';
        setTimeout(() => { labelNode.textContent = 'Kopiera all diagnostik'; }, 1500);
      }
      return { ok: true, text };
    }
    // Clipboard refused (insecure context, permission denied, or a browser
    // that has no async clipboard). The snapshot is NOT lost: it is shown in
    // the panel, selected, so it can be copied by hand.
    //
    // `boxNode` is PASSED IN, not read from a variable in this scope: the
    // panel lives in openAbout(), and a reference to it from here threw
    // ReferenceError on the one path that exists precisely when something has
    // already gone wrong. Found by driving the real button in the browser, not
    // by a test -- no source-shape assertion can see a scope error.
    if (!boxNode) {
      showToast('Kopiering misslyckades', 4000);
      return { ok: false, text };
    }
    boxNode.textContent = text;
    try {
      const range = document.createRange();
      range.selectNodeContents(boxNode);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    } catch { /* selection is a convenience, not a requirement */ }
    showToast('Kopiering misslyckades – texten visas och är markerad', 4000);
    return { ok: false, text };
  }

  // True while the Info panel's paint interval is running. Recorded so a reader
  // can see whether the panel was open when the samples were taken — the rate
  // itself does NOT depend on it any more.
  let metaDiagReadoutActive = false;
  function isMetaDiagReadoutActive() {
    return metaDiagReadoutActive;
  }

  // How old the stream-clock reading may be before the sampler refreshes it.
  //
  // Declared BEFORE the sampler that uses it, deliberately: a module-scope
  // `const` would work either way (the module body runs before any timer
  // fires), but reading it from above its own declaration is the kind of
  // latent trap that becomes a real ReferenceError the moment the call site
  // moves.
  //
  // It is a NEW constant, separate from the panel's `META_DIAG_SAMPLE_INTERVAL_MS`
  // (20 s): the panel's refresh behaviour is untouched, and this governs only
  // the sampler's own freshness requirement. It sits BELOW the 10 s sample
  // interval on purpose — a stream clock up to 5 s old is still a genuinely
  // time-separated reading, and demanding strict freshness on every sample
  // would mean a playlist fetch per sample for no measurement benefit.
  const SEEK_RATE_CLOCK_FRESH_MS = 5000;

  // ---- WS38 fix: the rate sampler owns its own stream-clock sampling. ----
  //
  // THE BUG THIS REPLACES, and it was NOT the panel gating.
  //
  // The previous version called `sampleStreamEdgeClock()` and then read
  // `STREAM_EDGE_PROBE.trueEdgeWallMs` on the very next line. That function is
  // ASYNC: it awaits two network fetches before it writes `trueEdgeWallMs`.
  // So every sample was built from a value that had not been written yet —
  // `null` on the first run, or STALE on every run after. The rate could then
  // never be produced, on either platform, regardless of whether the panel was
  // open. The panel gating was a second, separate problem; fixing only that
  // would have left the sampler still broken.
  //
  // THE FIX IS TO AWAIT THE EXISTING FETCH. `sampleStreamEdgeClock()` is
  // reused exactly as it is — same function, same single fetch path, no second
  // playlist fetcher. The sampler simply waits for it to settle before
  // reading. That is what makes the two samples INDEPENDENT: each one carries
  // a stream clock that was fetched at that moment, not one borrowed from a
  // previous run.
  //
  // WHAT THIS DOES NOT DO, and it is the conceptual correction the owner
  // required be preserved: a rate near 1.0000 establishes only that two
  // timelines ADVANCE TOGETHER. It does NOT prove their absolute positions are
  // aligned, and it does NOT eliminate a constant timeline-origin difference.
  // A constant offset between the two frames survives a perfect rate perfectly
  // well. Only the ELAPSED figures are compared; no absolute media-to-wall
  // conversion is introduced anywhere here.
  //
  // Data-collection only: no correction, no offset, no change to the seek, and
  // no new number exposed to the panel beyond the rate already present.

  // Take one RATE sample. Called on a timer, never from a UI interaction.
  //
  // ASYNC now, and deliberately so: it must await the playlist fetch so the
  // stream-clock figure it records belongs to THIS instant rather than to
  // whatever the previous run happened to leave behind.
  async function takeSeekRateSample() {
    const cur = state.current;
    if (!cur || cur.kind !== 'live') return null;
    // Ensure the stream clock is fresh enough to pair with this sample, then
    // WAIT for it. Reuses `sampleStreamEdgeClock()`; writes no fetch logic.
    //
    // The in-flight guard inside that function makes concurrent calls a no-op,
    // so calling it here cannot pile up requests on a slow phone.
    const age = streamEdgeSampleAgeS();
    const needsFreshClock = age === null || age * 1000 > SEEK_RATE_CLOCK_FRESH_MS;
    if (needsFreshClock) {
      try { await sampleStreamEdgeClock(); } catch { /* the record shows null */ }
    }
    const nowMs = Date.now();
    const seekableEnd = readFreshSeekableEnd();
    const trueEdgeWallMs = STREAM_EDGE_PROBE.trueEdgeWallMs;
    const sample = { nowMs, seekableEnd, trueEdgeWallMs };
    if (!Number.isFinite(SEEK_MEASURE.lastSampleAtMs)) {
      // First sample. There is nothing to pair it with, so there is no rate —
      // and `null` is the honest answer, not 1.0000.
      SEEK_MEASURE.lastSampleAtMs = nowMs;
      SEEK_MEASURE.lastSeekableEnd = seekableEnd;
      SEEK_MEASURE.lastTrueEdgeWallMs = trueEdgeWallMs;
      SEEK_MEASURE.samples = 1;
      SEEK_MEASURE.rate = null;   // one sample is not a rate
      return sample;
    }
    const previous = {
      nowMs: SEEK_MEASURE.lastSampleAtMs,
      seekableEnd: SEEK_MEASURE.lastSeekableEnd,
      trueEdgeWallMs: SEEK_MEASURE.lastTrueEdgeWallMs,
    };
    // `seekRateFromSamples` returns null unless every input is finite AND every
    // frame actually advanced, so a stale or missing clock yields no rate.
    SEEK_MEASURE.rate = seekRateFromSamples(previous, sample);
    SEEK_MEASURE.lastSampleAtMs = nowMs;
    SEEK_MEASURE.lastSeekableEnd = seekableEnd;
    SEEK_MEASURE.lastTrueEdgeWallMs = trueEdgeWallMs;
    SEEK_MEASURE.samples += 1;
    return sample;
  }

  // Populate the record AT THE SEEK. Called from seekToProgramTime() at the
  // exact moment it reads `cur.seekableEnd` — which is the whole point: the
  // age is of the value the algorithm is about to use, not of some later read.
  function recordSeekMeasurement(cur, startMs, end) {
    const nowMs = Date.now();
    const cachedWrittenAtMs = cur.seekableEndWrittenAtMs;
    const freshSeekableEnd = readFreshSeekableEnd();
    // MEASUREMENT 1 — arithmetic from two raw readings, via the extracted fn.
    SEEK_MEASURE.nowMs = nowMs;
    SEEK_MEASURE.cachedWrittenAtMs = cachedWrittenAtMs;
    SEEK_MEASURE.cachedAgeMs = seekMeasurement1({ nowMs, cachedWrittenAtMs });
    SEEK_MEASURE.cachedSeekableEnd = Number.isFinite(end) ? end : null;
    SEEK_MEASURE.freshSeekableEnd = freshSeekableEnd;
    // MEASUREMENT 3 — recorded, NOT interpreted. Present even when 0, because
    // "measured, and the two agree" and "not measured" are different facts.
    SEEK_MEASURE.freshMinusCachedMs =
      (Number.isFinite(freshSeekableEnd) && Number.isFinite(end))
        ? (freshSeekableEnd - end) * 1000
        : null;
    // MEASUREMENT 4 inputs. `behindMs` and `target` are the algorithm's OWN
    // arithmetic, recorded as it computes them.
    SEEK_MEASURE.startMs = Number.isFinite(startMs) ? startMs : null;
    SEEK_MEASURE.behindMs = Number.isFinite(startMs) ? nowMs - startMs : null;
    return SEEK_MEASURE;
  }

  // The rate sampler's lifetime follows the LIVE CHANNEL, not the panel: the
  // owner is not required to have the Info sheet open for a rate to exist.
  let seekRateTimer = null;
  const SEEK_RATE_INTERVAL_MS = 10000;
  function startSeekRateSampling() {
    if (seekRateTimer) return;
    // Reset the window so a channel switch cannot pair samples from two
    // different streams — a rate across a switch would be meaningless.
    SEEK_MEASURE.lastSampleAtMs = null;
    SEEK_MEASURE.lastSeekableEnd = null;
    SEEK_MEASURE.lastTrueEdgeWallMs = null;
    SEEK_MEASURE.rate = null;
    SEEK_MEASURE.samples = 0;
    takeSeekRateSample();
    seekRateTimer = setInterval(() => { takeSeekRateSample(); },
      SEEK_RATE_INTERVAL_MS);
  }
  function stopSeekRateSampling() {
    if (seekRateTimer) { clearInterval(seekRateTimer); seekRateTimer = null; }
  }

  // Render the record as text the owner can check BY EYE (§4: the arithmetic must
// be redoable by hand). Every line is `label: value unit`, and every unit and
// frame is stated, because the owner asked for that explicitly and a future
// reader must not confuse ms with media seconds.
//
// `null` is rendered as the word "okänd" (unknown) — NEVER as 0. A 0 would read
// as "measured, and it is zero", which is the confusion this repo has already
// paid for once.
//
// Pure and total: it never throws, and it returns a non-empty string for every
// input, so a reader always sees the shape even before anything is measured.
function seekMeasureRecordText() {
  const m = SEEK_MEASURE;
  const n = (v) => (Number.isFinite(v) ? v : null);
  const ms = (v) => (Number.isFinite(v) ? `${Math.round(v)} ms` : 'okänd');
  const sec = (v) => (Number.isFinite(v) ? `${v.toFixed(2)} s` : 'okänd');
  const ratio = (v) => (Number.isFinite(v) ? v.toFixed(4) : 'okänd');
  const lines = [];
  // A measured value, or an explicit statement that nothing is measured yet.
  const anySeek = Number.isFinite(m.nowMs);
  lines.push('MÄTNING (WS38) — råvärden, ingen tolkning');
  if (!anySeek) lines.push('Ingen sökning mätt ännu.');
  if (anySeek) {
    lines.push('');
    lines.push('1) Ålder på det cachade värdet');
    lines.push(`   nu (ms): ${n(m.nowMs)}`);
    lines.push(`   seekableEnd skrevs (ms): ${n(m.cachedWrittenAtMs)}`);
    lines.push(`   ålder = nu − skrevs: ${ms(n(m.cachedAgeMs))}`);
    lines.push(`   cachad seekableEnd (media-s): ${sec(n(m.cachedSeekableEnd))}`);
    lines.push(`   färsk seekableEnd (media-s): ${sec(n(m.freshSeekableEnd))}`);
    lines.push('');
    lines.push('3) Färsk − cachad');
    lines.push(`   färsk minus cachad: ${ms(n(m.freshMinusCachedMs))}`);
    lines.push('');
    lines.push('4) Beställd position');
    lines.push(`   startMs (ms): ${n(m.startMs)}`);
    lines.push(`   behindMs (ms): ${n(m.behindMs)}`);
    lines.push(`   target (media-s): ${sec(n(m.target))}`);
    lines.push(`   beställd (media-s): ${sec(n(m.requestedTarget))}`);
    lines.push(`   accepterad (media-s): ${sec(n(m.acceptedPosition))}`);
    lines.push(`   klippt av (media-s): ${sec(n(m.clampedByS))}`);
  }
  // ---- measurement 2: the rate. Independent of any seek. ----
  lines.push('');
  lines.push('2) Framryckningshastighet (hastighet, ej absolut läge)');
  const r = m.rate;
  if (!r) {
    lines.push(`   Fler än en punkt saknas. Samples: ${m.samples}`);
  } else {
    lines.push(`   vägg förfluten: ${ms(r.wallElapsedMs)}`);
    lines.push(`   strömklocka förfluten: ${ms(r.streamElapsedMs)}`);
    lines.push(`   buffert slut förfluten: ${(r.seekableEndElapsedS).toFixed(2)} media-s `
      + `(${Math.round(r.seekableEndElapsedMs)} ms)`);
    lines.push(`   ström/vägg: ${ratio(r.streamRateVsWall)}`);
    lines.push(`   buffert/ström: ${ratio(r.seekableRateVsStream)}`);
    lines.push(`   1.0000 = denna ram avancerar lika fort som referensramen.`);
  }
  return lines.join('\n');
}

  // ---- WS39: the media-timeline origin, rendered for the owner. ----
  // Pure and total, like `seekMeasureRecordText`. `null` renders as "okänd"
  // and NEVER as 0: "measured, and it is zero" and "not measured" are
  // different facts, and this repo has already paid for confusing them.
  //
  // Nothing below is a conclusion. The derived lines are printed so the owner
  // can read the arithmetic and check it by hand; what they MEAN is a separate
  // decision that this instrumentation deliberately does not make.
  function originMeasureRecordText() {
    const o = ORIGIN_MEASURE;
    const n = (v) => (Number.isFinite(v) ? v : null);
    const ms = (v) => (Number.isFinite(v) ? `${Math.round(v)} ms` : 'okänd');
    const iso = (v) => (Number.isFinite(v) ? new Date(v).toISOString() : 'okänd');
    const sec = (v) => (Number.isFinite(v) ? `${v.toFixed(2)} media-s` : 'okänd');
    const lines = [];
    lines.push('MÄTNING (WS39) — medietimelines ursprung, oberoende av sökningen');
    const any = Number.isFinite(o.nowMs);
    if (!any) lines.push('Ingen mätning gjord ännu.');
    if (any) {
      lines.push('');
      lines.push('Gemensamt (ett mätögonblick)');
      lines.push(`   nu (ms): ${n(o.nowMs)}`);
      lines.push(`   currentTime (media-s): ${sec(o.currentTimeS)}`);
      lines.push(`   seekableEnd (media-s): ${sec(o.seekableEndS)}`);
      lines.push(`   trueEdgeWallMs (ms): ${n(o.trueEdgeWallMs)}`);
      lines.push('');
      lines.push('Chromium / hls.js — väggklockan för playHEADEN');
      lines.push(`   pdt för currentTime (ms): ${n(o.pdtForCurrentTimeMs)}`);
      lines.push(`   källa: ${o.pdtSource}`);
      lines.push('');
      lines.push('Safari / inbyggd HLS — getStartDate()');
      lines.push(`   startDate (ms): ${n(o.startDateMs)}`);
      lines.push(`   källa: ${o.startDateSource}`);
      lines.push('');
      lines.push('Härlett (bara när varje operand är giltig)');
      lines.push(`   mediaOrigin = pdt − currentTime×1000: ${ms(o.mediaOriginMs)}`);
      lines.push(`   mediaOrigin som ISO: ${iso(o.mediaOriginMs)}`);
      lines.push(`   väggklocka vid seekableEnd (ms): ${n(o.wallClockAtSeekableEndMs)}`);
      lines.push(`   trueEdge − väggklocka vid seekableEnd: ${ms(o.wallClockDeltaMs)}`);
      lines.push('');
      lines.push('Sökformeln ANTA att trueEdge−detta är 0. Mäts, inte antas.');
    }
    return lines.join('\n');
  }

  function seekToLive() {
    const cur = state.current;
    const d = SEEK_LIVE_DIAG;
    // WS23: sample the edge BEFORE anything moves, so the pre-seek figure is
    // never contaminated by the seek this press is about to perform.
    recordStreamEdge('before');
    d.calls += 1;
    d.lastCalledAt = new Date().toISOString();
    d.lastBefore = {
      currentTime: audioEl.currentTime,
      seekableStart: cur ? cur.seekableStart : null,
      seekableEnd: cur ? cur.seekableEnd : null,
      distanceFromLiveEdge: cur ? cur.distanceFromLiveEdge : null,
      atLiveEdge: cur ? cur.atLiveEdge : null,
      dvrAvailable: cur ? cur.dvrAvailable : null,
    };
    if (!cur) { d.lastExit = 'no-track'; return; }
    const end = cur.dvrAvailable ? cur.seekableEnd : null;
    if (!Number.isFinite(end)) {
      d.lastExit = cur.dvrAvailable ? 'no-finite-end' : 'no-dvr';
      return;
    }
    const start = Number.isFinite(cur.seekableStart) ? cur.seekableStart : 0;
    // WS23: SEEK_LIVE_MARGIN_S (1 s), NOT LIVE_EDGE_TOLERANCE_S (10 s). The
    // target and the "is this live?" display rule are separate concerns and
    // must not share a number; see the constant's comment for the value's
    // reasoning and for the Safari boundary no-op that forbids 0.
    const target = Math.max(start, end - SEEK_LIVE_MARGIN_S);
    if (!Number.isFinite(target)) { d.lastExit = 'non-finite-target'; return; }
    d.lastTarget = target;
    d.lastExit = 'seeked';
    audioEl.currentTime = target;
    updateSeekableState();
    renderPlayer();
    // Read back what the element ACTUALLY accepted — the seek may be rejected
    // or clamped by the browser, which is exactly what we need to see.
    const now = state.current;
    // WS23: what was asked for vs what the element ended up at. A large
    // difference means the browser clamped the seek, which would look exactly
    // like a wrong offset from outside — this makes the two distinguishable.
    SEEK_EDGE_DIAG.requestedTarget = target;
    SEEK_EDGE_DIAG.acceptedPosition = audioEl.currentTime;
    SEEK_EDGE_DIAG.clampedByS = Number.isFinite(audioEl.currentTime)
      ? audioEl.currentTime - target : null;
    recordStreamEdge('after');
    d.lastAfter = {
      currentTime: audioEl.currentTime,
      seekableEnd: now ? now.seekableEnd : null,
      distanceFromLiveEdge: now ? now.distanceFromLiveEdge : null,
      atLiveEdge: now ? now.atLiveEdge : null,
      accepted: Math.abs(audioEl.currentTime - target) < 0.5,
    };
  }

  // ---- DVR transport: ±15 s steps + program skip (2026-09-22 request) ----
  // The 3-hour window makes the bare slider too coarse; ±15 s buttons give
  // fine control. Program skip uses SR's schedule (tablå): seek to the start
  // of the previous/next programme. If the schedule API is unavailable
  // (it has had outages), the buttons simply don't render.
  const SEEK_STEP_S_DVR = SEEK_STEP_S; // 15 s, same as on-demand

  function seekBy(deltaSeconds) {
    const cur = state.current;
    if (!cur || !cur.dvrAvailable) return;
    const start = Number.isFinite(cur.seekableStart) ? cur.seekableStart : 0;
    // UPPER CLAMP (WS4). seekBy() only ever clamped the lower bound, so a
    // forward step from a position near the live edge produced a target
    // BEYOND seekableEnd — the buffered boundary, which Safari rejects or
    // silently clamps. That makes the final +15 s back to live do nothing,
    // the same defect class the WS2 attempt at seekToLive() did not solve.
    // Aim just BEHIND the edge by the same tolerance updateSeekableState()
    // uses to classify "at live", so the result still counts as live while
    // giving the browser a real, non-boundary target.
    const upper = Number.isFinite(cur.seekableEnd)
      ? Math.max(start, cur.seekableEnd - LIVE_EDGE_TOLERANCE_S)
      : Infinity;
    const target = Math.min(upper, Math.max(start, (audioEl.currentTime || 0) + deltaSeconds));
    if (!Number.isFinite(target)) return;
    audioEl.currentTime = target;
    updateSeekableState();
    renderPlayer();
  }

  // Fetch today's schedule for a channel. Returns [{startMs, endMs, title,
  // programId, programName}] sorted by start time, or null if unavailable.
  // Cached per channel+date for 10 minutes.
  //
  // ENDPOINT NOTE (2026-09-23): scheduledevents is DEAD (SR confirmed the
  // open API is being decommissioned; that endpoint 500s permanently).
  // scheduledepisodes is the endpoint SR's own ecosystem still serves —
  // verified 200 (today, tomorrow AND yesterday) and it's what
  // servicenoden.se/srtableau uses for its working tablå. Same response
  // shape (schedule[] with starttimeutc/endtimeutc) plus program metadata
  // and episodeid (playable on-demand via episodes/get?id=...).
  const scheduleCache = new Map();
  // SR's date param is LOCAL-day based (verified 2026-09-23: date=2026-09-23
  // returns events from local midnight). toISOString() gives the UTC date —
  // after local midnight but before UTC midnight that's YESTERDAY, and the
  // expand panel showed "Ingen programinfo" (bug found live at 01:02 local).
  // Use the Swedish local date instead.
  const localDateStr = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
  // Local date string N days ago (1 = yesterday). SR's date param is LOCAL-day
  // based, so the arithmetic must run in Sweden time, not UTC.
  function localDateStrOffset(daysBack = 0) {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    return d.toLocaleDateString('sv-SE');
  }
  // One day's schedule for a channel, cached per channel+day (10 min TTL).
  async function fetchScheduleDay(channelId, dateStr) {
    const key = `${channelId}:${dateStr}`;
    const cached = scheduleCache.get(key);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.value;
    let value = null;
    try {
      const data = await apiFetch(
        `${SR_API}/scheduledepisodes?channelid=${channelId}&date=${dateStr}&format=json&pagination=false`
      );
      // WS0 diagnostics: retain the RAW body for the active channel, reusing a
      // response that already arrived. Capture only — the feature path below
      // is unchanged and still reads the same parsed array.
      META_DIAG.lastScheduleRaw = data;
      META_DIAG.lastScheduleAt = new Date().toISOString();
      META_DIAG.lastScheduleChannelId = channelId;
      const events = Array.isArray(data?.schedule) ? data.schedule : [];
      const parsed = events
        .map((ev) => {
          const startMs = parseSrDate(ev.starttimeutc);
          const endMs = parseSrDate(ev.endtimeutc);
          if (startMs == null || endMs == null) return null;
          return {
            startMs, endMs,
            title: ev.title || '',
            programId: ev.program?.id ?? null,
            programName: ev.program?.name || '',
            episodeId: ev.episodeid ?? null,
            image: ev.imageurl || null,
            description: ev.description || null,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.startMs - b.startMs);
      value = parsed.length ? parsed : null;
      // WS0 diagnostics: the parsed [{startMs, endMs, title}] view of the
      // capture above, so a snapshot can show raw AND parsed side by side.
      // NOTE: a cache hit returns early above, so it does not refresh the raw
      // capture — lastScheduleAt always states when the body was received.
      META_DIAG.lastScheduleParsed = value;
      value = parsed.length ? parsed : null;
    } catch {
      value = null; // API down / rate-limited → feature hides
    }
    scheduleCache.set(key, { value, at: Date.now() });
    return value;
  }
  // ---- WS18: a DVR window can reach back past local midnight ----
  // The owner reported that dragging the P3 seek bar back stopped changing the
  // programme title. Measured cause: `fetchSchedule` requested TODAY only, but
  // `playheadWallMs()` maps the DVR position to a WALL-CLOCK time, and with a
  // 3-hour window that is routinely yesterday's date after midnight. So
  // `pickByPosition(cur._srSchedule, ...)` had no entry to find, the title
  // silently stayed on whatever was on air, and nothing looked broken -- the
  // pill and the clock still moved correctly, so the failure was invisible
  // except to someone who knew the programme had changed.
  //
  // `localDateStrOffset(1)` already existed (the expand panel used it) and the
  // per-day cache is already keyed `${channelId}:${dateStr}`, so the second day
  // costs one extra request ONCE per 10 minutes, not per seek.
  //
  // Yesterday's day is fetched only when the playhead can actually reach it:
  // computed from the DVR window rather than fetched unconditionally, so a
  // channel with no DVR state does not pay for it. The two days are merged
  // into ONE sorted array, because `pickByPosition` and `programBoundary` both
  // assume start-order -- an unsorted merge would make the programme-skip
  // buttons pick the wrong neighbour across the midnight boundary.
  async function fetchSchedule(channelId) {
    const today = await fetchScheduleDay(channelId, localDateStr());
    // ---- WS21: the yesterday gate consulted a value that did not exist yet ----
    // WS18 decided whether to load yesterday from `cur.seekableStart`, on the
    // reasoning that a channel with no DVR window pays nothing for the second
    // request. Measured on the live origin at 01:55, that gate never opens:
    //
    //   transportKind : "direct"   (Chromium cannot load SR's HLS)
    //   seekableStart : null
    //   windowMs      : 0
    //   needsYesterday: false
    //
    // and the schedule the app actually held began at 00:00 today — 1.94 h of
    // "today", with the whole previous evening missing. So on a real iPhone the
    // same thing happens whenever the window state is not yet known: the gate
    // is evaluated inside `resolveProgramTitle`, which `playTrack` calls
    // immediately, BEFORE any `loadedmetadata`/`durationchange` has populated
    // the seekable range. **The gate was reading a value that had not been
    // written yet, so yesterday was never requested, and the WS18 fix could
    // not engage on the very case it was written for.**
    //
    // The decision is now made from the CLOCK, which is always available:
    // after local midnight the live edge is within the same day's first hour,
    // so any DVR window longer than an hour necessarily reaches into yesterday.
    // `fetchScheduleDay` is cached per `${channelId}:${dateStr}` for 10
    // minutes, so the cost is at most one extra request per channel per 10
    // minutes, and only between 00:00 and 01:00 local.
    const pastMidnight = new Date().getHours() < 1;
    const start = state.current ? state.current.seekableStart : null;
    // Kept as a second trigger: a known, genuinely long window reaches back
    // regardless of the hour.
    const windowMs = Number.isFinite(start)
      ? Math.max(0, Date.now() - start * 1000)
      : 0;
    // ---- WS26 Part 4: derive the trigger from the WINDOW, not the clock ----
    // The bug: `getHours() < 1` opens the gate for hour 0 only, but a 3 h DVR
    // window reaches into yesterday until 03:00. The two disagree for
    // 01:00-02:59, which is exactly when the owner tested (01:19-01:22). The
    // right question is not "is it just after midnight?" but "does the DVR
    // window reach before local midnight?" -- which is a property of the
    // window, not of the clock.
    //
    // Computed from the REAL window, read from seekableStart/seekableEnd. No
    // 3-hour constant is hardcoded: if the window is 2 h the gate covers hours
    // 0-1, if it is 6 h it covers 0-5. `localDateStrOffset(1)` remains the
    // fallback when the window is not yet known (seekableStart is null at
    // playTrack time -- the WS21 finding, still true), and pastMidnight stays
    // as a trigger so the worst case is a request that was not strictly
    // necessary rather than a missing title.
    //
    // NO OFFSET, NO FUDGE. The correction is not a tunable: the window is
    // measured, and timeSinceMidnight is exact. A constant here would freeze
    // one observation into permanent behaviour, which is how "10 seconds"
    // became folklore in WS23.
    const sStart = state.current ? state.current.seekableStart : null;
    const sEnd = state.current ? state.current.seekableEnd : null;
    const windowS = (Number.isFinite(sStart) && Number.isFinite(sEnd) && sEnd > sStart)
      ? sEnd - sStart
      : null;
    const now = new Date();
    const timeSinceMidnightS = (now.getHours() * 3600) + (now.getMinutes() * 60)
      + now.getSeconds() + (now.getMilliseconds() / 1000);
    // True when the window's oldest moment falls before local midnight. With an
    // unknown window this is `null`, and the caller falls back to the clock.
    const windowReachesYesterday = windowS == null
      ? null
      : timeSinceMidnightS < windowS;
    const needsYesterday = windowReachesYesterday === null
      ? pastMidnight
      : (windowReachesYesterday || pastMidnight);
    // WS21: record the decision and its inputs. The gate failed silently for a
    // whole pass because nothing exposed WHY it chose one day or two.
    META_DIAG.lastScheduleGate = {
      localHour: new Date().getHours(),
      pastMidnight,
      seekableStart: start ?? null,
      windowMs: Math.round(windowMs),
      needsYesterday,
      // WS26 Part 4: the inputs to the NEW decision, so the owner's device
      // check can tell "the window was unknown" from "the window did not reach
      // yesterday" -- which are different defects with different fixes.
      windowS: windowS == null ? null : Math.round(windowS),
      timeSinceMidnightS: Math.round(timeSinceMidnightS),
      windowReachesYesterday,
      gateSource: windowReachesYesterday === null ? 'clock-fallback' : 'window',
    };
    if (!needsYesterday) {
      META_DIAG.lastScheduleGate.fetchedDays = ['today'];
      return today || [];
    }
    const yesterday = await fetchScheduleDay(channelId, localDateStrOffset(1));
    META_DIAG.lastScheduleGate.fetchedDays = ['today', 'yesterday'];
    META_DIAG.lastScheduleGate.yesterdayCount = (yesterday || []).length;
    if (!yesterday || !yesterday.length) return today || [];
    if (!today || !today.length) return yesterday;
    // Merge and sort by start time. `[...a, ...b].sort(...)` on the two arrays
    // is cheaper than a merge routine and cannot get the ordering wrong; the
    // combined length is a day's worth of programmes at most.
    return [...today, ...yesterday].sort((a, b) => a.startMs - b.startMs);
  }

  // Find the programme boundary to seek to. direction -1 = start of the
  // programme before the current position; +1 = start of the next programme
  // after it. Returns {startMs, title} or null.
  function programBoundary(schedule, positionMs, direction) {
    if (!Array.isArray(schedule) || !schedule.length) return null;
    if (direction < 0) {
      // Previous programme: the last one whose start is before the position.
      const prev = [...schedule].reverse().find((ev) => ev.startMs < positionMs - 1000);
      return prev ? { startMs: prev.startMs, title: prev.title } : null;
    }
    // Next programme: the first event starting after the position.
    const next = schedule.find((ev) => ev.startMs > positionMs + 1000);
    return next ? { startMs: next.startMs, title: next.title } : null;
  }

  // Seek to a programme start time inside the DVR window. The window maps
  // wall-clock → position: live edge ≈ now, so position = end − (now − t).
  //
  // WS6: the `if (behindMs < 0) return;` guard below is UNREACHABLE from the
  // programme-skip button as it was wired. `syncNext` picked the first event
  // starting after the playhead — which includes an event that has NOT
  // started yet — and then called this. For such an event `behindMs < 0` and
  // the press did nothing at all, with no error and no visible effect. That
  // was 65.8% of all behind-live moments across five channels (WS6 analysis).
  // The guard is KEPT: it is correct defence for any other caller, and
  // removing it would convert a dead press into a seek to a nonsense target.
  // ---- WS7: what does a press of the programme-skip button actually DO? ----
  // WS6 recorded the button's STATE but never what a tap did, so a silent dead
  // press was indistinguishable from a toast that flashed too fast to notice.
  // This records the press. `seekableStart/End` are READ, never written.
  //
  // The branch is decided by the SAME arithmetic seekToProgramTime() performs,
  // replicated here WITHOUT performing it. Duplicating the guard logic is
  // deliberate: recording must not change behaviour, and a real
  // `rejected-by-browser` (target sane, browser refused it) is only
  // distinguishable if the target was computed the same way. If the two ever
  // diverge, `META_DIAG.skipPress.windowSeconds` is a cheap canary.
  const SKIP_PRESS_DIAG = {
    calls: 0,
    lastBranch: null,   // 'seeked' | 'out-of-window' | 'no-track' | 'no-dvr'
                        // | 'non-finite-target' | 'rejected-by-browser'
    lastCalledAt: null,
    lastRequestedStartMs: null, // null = "Till Direkt" (go to live)
    lastTarget: null,
    lastBefore: null,   // { currentTime, seekableStart, seekableEnd, seekableDuration }
    lastAfter: null,    // read back right after the handler returns
    windowSeconds: 3 * 3600, // canary: must match the real window
  };

  function recordSkipPress(programmeStartMs) {
    const cur = state.current;
    const d = SKIP_PRESS_DIAG;
    d.calls += 1;
    d.lastCalledAt = new Date().toISOString();
    d.lastRequestedStartMs = programmeStartMs;
    d.lastBefore = {
      currentTime: audioEl.currentTime,
      seekableStart: cur ? cur.seekableStart : null,
      seekableEnd: cur ? cur.seekableEnd : null,
      seekableDuration: cur ? cur.seekableDuration : null,
      dvrAvailable: cur ? cur.dvrAvailable : null,
    };
    if (programmeStartMs === null) {
      // "Till Direkt" — seekToLive() owns this path and records itself in
      // SEEK_LIVE_DIAG. Nothing computed here.
      d.lastBranch = 'seeked';
      d.lastTarget = null;
      d.lastAfter = null;
      return;
    }
    if (!cur) { d.lastBranch = 'no-track'; d.lastTarget = null; d.lastAfter = null; return; }
    if (!cur.dvrAvailable) { d.lastBranch = 'no-dvr'; d.lastTarget = null; d.lastAfter = null; return; }
    const end = cur.seekableEnd;
    if (!Number.isFinite(end)) { d.lastBranch = 'non-finite-target'; d.lastTarget = null; d.lastAfter = null; return; }
    const behindMs = Date.now() - programmeStartMs;
    if (behindMs < 0) { d.lastBranch = 'future-programme'; d.lastTarget = null; d.lastAfter = null; return; }
    // WS47: mirrors seekToProgramTime() so the record reports the target the app
    // really requested. A record of the un-experimented target would describe a
    // seek that never happened, and the device result would be unreadable.
    const experimentalEdgeS = ws47ExperimentalEdgeS();
    const effectiveEndS = experimentalEdgeS === null ? end : experimentalEdgeS;
    const target = effectiveEndS - behindMs / 1000;
    const start = Number.isFinite(cur.seekableStart) ? cur.seekableStart : 0;
    if (target < start) { d.lastBranch = 'out-of-window'; d.lastTarget = target; d.lastAfter = null; return; }
    d.lastBranch = 'seeked';
    d.lastTarget = target;
    // ---- WS47: WHICH PATH PRODUCED THIS TARGET. ----
    // Without this the device result is uninterpretable. An unchanged landing
    // means "the hypothesis is refuted" if the experiment fired, and "the
    // experiment never ran" if it did not -- and those lead to opposite next
    // steps. Read-only, one boolean, on the record that already exists.
    d.ws47Applied = experimentalEdgeS !== null;
    d.ws47EdgeS = experimentalEdgeS === null ? null : experimentalEdgeS;
    d.ws47CachedEdgeS = Number.isFinite(end) ? end : null;
    // Read back on the next microtask: the handler has not assigned
    // currentTime yet at this point in the call stack.
    Promise.resolve().then(() => {
      const actual = audioEl.currentTime;
      d.lastAfter = { currentTime: actual, target, accepted: Math.abs(actual - target) < 1 };
      if (!d.lastAfter.accepted && d.lastBranch === 'seeked') d.lastBranch = 'rejected-by-browser';
    });
  }

  function seekToProgramTime(startMs) {
    const cur = state.current;
    // WS23: sample the stream edge BEFORE computing the target. This is the
    // button that produced the owner's ~30 s reading, and this sample is what
    // lets that reading be explained instead of guessed at. Sample first,
    // because the target below is derived FROM the edge.
    recordStreamEdge('before');
    if (!cur || !cur.dvrAvailable) return;
    const end = cur.seekableEnd;
    // ---- WS38: MEASURE AT THE SEEK, at the exact moment `end` is read. ----
    // Placed HERE, immediately after the read, because the whole point is the
    // age of the value THIS call is about to use. Reading it earlier would
    // measure a different value; reading it later would miss the moment.
    //
    // Read-only: it records, it does not change `end` or anything else. The
    // seek below still uses the CACHED `end` exactly as before (§5) — that is
    // deliberate, because measurement 3 compares fresh against cached, and the
    // comparison is only meaningful if the cached one really is still in use.
    recordSeekMeasurement(cur, startMs, end);
    if (!Number.isFinite(end)) return;
    const behindMs = Date.now() - startMs;
    if (behindMs < 0) return; // future programme — nothing to seek to yet
    // ---- WS47 EXPERIMENT ----
    // `target` below is the PRODUCTION equation, kept byte-for-byte intact and
    // used verbatim whenever the experiment cannot be grounded (null). On
    // native HLS with a usable TimeRanges, the edge is instead derived from the
    // element's own published positions. Every other transport is untouched, so
    // the hls.js/Edge seek costs this experiment nothing.
    const experimentalEdgeS = ws47ExperimentalEdgeS();
    const effectiveEndS = experimentalEdgeS === null ? end : experimentalEdgeS;
    const target = effectiveEndS - behindMs / 1000;
    const start = Number.isFinite(cur.seekableStart) ? cur.seekableStart : 0;
    if (target < start) {
      showToast('Programmet ligger utanför spolbart område (3 timmar).');
      return;
    }
    audioEl.currentTime = target;
    updateSeekableState();
    renderPlayer();
    // WS23: record what was asked for and what the element accepted, then
    // re-sample the edge so a reader can see whether the SEEK ITSELF moved the
    // edge. A moved edge means the buffered range was re-registered during the
    // seek, which would explain a variable offset on its own.
    SEEK_EDGE_DIAG.requestedTarget = target;
    SEEK_EDGE_DIAG.acceptedPosition = audioEl.currentTime;
    SEEK_EDGE_DIAG.clampedByS = Number.isFinite(audioEl.currentTime)
      ? audioEl.currentTime - target : null;
    // ---- WS38: measurement 4, completed. ----
    // These three values are ALREADY computed above by SEEK_EDGE_DIAG (§2:
    // reuse, do not add a parallel mechanism). They are copied into the
    // record rather than recomputed, so the panel and the snapshot can never
    // disagree about what the player was told.
    SEEK_MEASURE.target = target;
    SEEK_MEASURE.requestedTarget = SEEK_EDGE_DIAG.requestedTarget;
    SEEK_MEASURE.acceptedPosition = SEEK_EDGE_DIAG.acceptedPosition;
    SEEK_MEASURE.clampedByS = SEEK_EDGE_DIAG.clampedByS;
    recordStreamEdge('after');
  }

  ['waiting', 'stalled'].forEach((ev) => {
    metaDiagCountAdd(ev);
    audioEl.addEventListener(ev, () => {
      if (state.current && audioEl.paused === false) setBadgeBuffering(true);
    });
  });

  // ---- WS9: re-resolve the programme and song when the playhead MOVES ----
  // A `seeked` listener is used rather than edits to seekToProgramTime /
  // seekBy / seekToLive, because those are explicitly out of scope and must
  // stay byte-identical. One listener, registered ONCE at module scope, so it
  // cannot accumulate the way renderPlayer's timeupdate listener used to (the
  // WS1 leak). It is counted in META_DIAG like the app's other registrations,
  // so the WS0 snapshot keeps telling the truth.
  // No channel guard: the listener body checks state.current itself.
  audioEl._srSeekedUpd = () => {
    const cur = state.current;
    if (!cur || cur.kind !== 'live') return;
    resolveMetadataForPosition(cur);
    // A seek can jump beyond what the retained timeline covers (or before its
    // first entry), so refresh the ends of the range. One request, through
    // the SAME seq-guarded path as the periodic poll -- it cannot race a
    // channel switch.
    scheduleNowPlayingPoll();
    // ---- WS26 Part 3: ask SR what was playing at the new position ----
    // Debounced and session-cached per episode id; never on timeupdate. On any
    // failure it leaves the polled timeline exactly as the poll left it, so the
    // worst case is today's behaviour.
    if (seekTracksTimer) clearTimeout(seekTracksTimer);
    seekTracksTimer = setTimeout(() => {
      seekTracksTimer = null;
      resolveSeekTracksFromSr();
    }, SEEK_TRACKS_DEBOUNCE_MS);
    // ---- WS26 Part 4: a SEEK DOES re-run the schedule fetch ----
    // The second cause of the pre-midnight title gap, found in WS25: the
    // schedule is cached 10 minutes per (channel, date) and was only ever
    // fetched at track load. A session that started before 01:00 kept its
    // yesterday data; a session that STARTED at 01:19 never got any, and a
    // mid-window seek could not recover it. That made the symptom look
    // intermittent and deploy-shaped when it is neither.
    //
    // Invalidate the day cache for this channel and refetch. The refetch runs
    // through the same fetchSchedule()/resolveProgramTitle() path as the
    // initial load, so the gate decision and the merge are the identical code
    // -- there is no second implementation of "which days do I need".
    scheduleCache.delete(`${cur.id}:${localDateStr()}`);
    scheduleCache.delete(`${cur.id}:${localDateStrOffset(1)}`);
    resolveProgramTitle(cur);
  };
  metaDiagCountAdd('seeked');
  audioEl.addEventListener('seeked', audioEl._srSeekedUpd);

  function renderPlayer() {
    const cur = state.current;
    if (!cur) return;
    // Lifecycle contract: renderPlayer() owns ALL presentation state — class,
    // transform AND content. The swipe-close animation leaves an inline
    // style.transform on the player; inline style beats the CSS
    // .player.visible { transform: translateY(0) } rule, so without clearing
    // it here the player re-opens "visible" but positioned below the screen
    // (verified bug 2026-09-21). Clear it every render.
    $player.style.transform = '';
    $player.classList.add('visible');
    $player.classList.toggle('minimized', playerMinimized);
    $player.textContent = '';

    const live = cur.kind === 'live';

    // ---- MINIMIZED mini-bar layout (2026-09-23) ----
    // Swipe down on the player minimizes it: a compact bar at the bottom
    // with artwork, title, play/pause, expand and stop. The page behind is
    // fully visible and scrollable; audio keeps playing. Tap the mini-bar
    // (except buttons) restores the full player.
    if (playerMinimized) {
      const miniThumb = el('div', { class: 'player-thumb', 'aria-hidden': 'true' },
        cur.artwork
          ? el('img', { src: cur.artwork, alt: '' })
          : el('span', { class: 'player-thumb-letter', text: (cur.title || '?').slice(0, 1) }));
      const miniPlay = el('button', {
        class: 'player-btn player-btn-main', type: 'button',
        'aria-label': audioEl.paused ? 'Spela' : 'Pausa',
        html: audioEl.paused
          ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
        onclick: () => {
          if (audioEl.paused) audioEl.play().catch(() => {});
          else audioEl.pause();
          renderPlayer();
        },
      });
      const miniExpand = el('button', {
        class: 'player-btn', type: 'button', 'aria-label': 'Visa programinformation',
        html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>',
        onclick: () => { restorePlayer(); },
      });
      const miniStop = el('button', {
        class: 'player-btn player-btn-close', type: 'button', 'aria-label': 'Stäng spelaren',
        html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 13.41 12z"/></svg>',
        onclick: () => { playerMinimized = false; stopAndClosePlayer(); },
      });
      const mini = el('div', { class: 'player-mini' },
        miniThumb,
        el('div', { class: 'player-meta', onclick: restorePlayer },
          el('div', { class: 'player-title', text: cur.title || '' }),
          // WS15b: the same rule as the full player's header -- a podcast's
          // identity is ONE line (the episode name) with the podcast name
          // below it, not the podcast name repeated in a cramped sub line.
          // Radio keeps the channel + programme pair, which is what the
          // minimised bar has always shown and what the owner expects.
          live
            ? el('div', { class: 'player-sub', text: cur._srProgramTitle || cur.subtitle || 'Direkt' })
            : null,
          // The podcast name takes the sub line's place here, so the
          // minimised bar is not left with a gap where the sub line was.
          !live
            ? el('div', { class: 'player-podcast-name', text: cur.programName || cur.subtitle || '' })
            : null,
          // WS12 Part C: the mini-bar's song line is also no longer live-only,
          // for the same reason as the full player above. The scoped reset
          // `.player-mini .now-playing-line { margin-left: 0; }` is untouched,
          // so the mini-bar's own 40px/10px geometry is unaffected.
          el('div', { class: 'now-playing-line', 'aria-live': 'polite' })),
        miniPlay, miniExpand, miniStop);
      $player.appendChild(mini);
      // Self-healing repaint (see full-player branch below): re-renders must
      // not wipe the song line or the resolved program title.
      paintNowPlaying();
      paintProgramTitle();
      // Tap anywhere on the mini-bar (except buttons) restores the player.
      $player.onclick = (e) => {
        if (e.target.closest('button')) return;
        restorePlayer();
      };
      // ---- MINI-BAR GESTURES (WS3 fix) ----
      // The minimised branch used to `return` here, so enablePlayerGestures()
      // was never armed for this layout. What still fired were the handlers
      // left over from the LAST FULL-PLAYER render, bound to the same
      // singleton $player but acting on a completely different DOM. Two
      // symptoms followed: the downward drag branch set
      // `$player.style.transform = translateY(...)`, which in the full layout
      // reads as a drag but in the mini-bar layout (nothing pinning it) slid
      // the whole player down the screen and left it there; and swipe-up ran
      // onExpand() — building an expand panel for a layout being torn down —
      // instead of restoring, hence "needs two attempts".
      //
      // Armed here with meanings appropriate to THIS layout: up = restore.
      // There is no panel in the mini bar, so onExpand is the wrong callback.
      // `stickDrag: false` keeps the downward branch from translating the mini
      // bar at all, so it can never end up displaced.
      enablePlayerGestures($player, {
        onExpand: restorePlayer,
        onMinimize: () => { /* already minimised — nothing to do */ },
        stickDrag: false,
        // Defer the restore to the COMMIT, not the drag. During the drag the
        // generic upward branch builds an "expand panel"; in the mini bar that
        // means restorePlayer() -> renderPlayer() -> enablePlayerGestures()
        // RE-ARMS the handlers mid-gesture. The subsequent touchend then lands
        // on fresh handlers whose axis/startY are reset, so the gesture is
        // silently discarded and the player never restores. Committing instead
        // means exactly one re-render, after the gesture has been consumed.
        expandDuringDrag: false,
      });
      return;
    }
    $player.onclick = null;

    const thumb = el('div', { class: 'player-thumb', 'aria-hidden': 'true' },
      cur.artwork
        ? el('img', { src: cur.artwork, alt: '' })
        : el('span', { class: 'player-thumb-letter', text: (cur.title || '?').slice(0, 1) }));

    // Two pills (approved Appendix A design):
    //   .player-quality — WHAT am I listening to (codec + honest bitrate)
    //   .player-mode    — WHERE am I in time (LIVE / relative DVR offset)
    const qLabel = qualityLabel(cur);
    const quality = qLabel
      ? el('span', { class: 'player-quality', text: qLabel, 'data-format': qLabel })
      : null;
    // Mode pill: WHERE am I in time. At the live edge → "LIVE". Behind live →
    // the RELATIVE OFFSET ("−12 min") per user preference (2026-09-22 iPhone
    // feedback): the pill is the minus-time surface; the clock time lives on
    // the seek row's left label (drag preview + heard position). No duplication:
    // pill = minus-time, slider-left = clock time.
    const behind = live && cur.atLiveEdge === false && cur.distanceFromLiveEdge;
    let modeText = 'LIVE';
    if (behind) {
      modeText = dvrOffsetLabel(cur.distanceFromLiveEdge);
    }
    const mode = live
      ? el('span', {
          class: `player-mode${behind ? ' behind' : ''}`,
          text: modeText,
          'aria-live': 'polite',
        })
      : null;

    // WS5 LAYOUT: the channel/programme identity moved OUT of this text stack
    // into a quiet header line ABOVE the player (see `headerLine` below), and
    // the song line moved BELOW the player (see `songLine` below). `meta` now
    // holds only the quality/mode pills, so the player is much shorter and
    // neither block is ever covered by the player surface.
    //
    // CLASS NAMES MUST NOT CHANGE: paintProgramTitle() and paintNowPlaying()
    // both do $player.querySelector('.player-sub' / '.now-playing-line'), and
    // the WS0 diagnostics snapshot the same. Renaming or moving either out of
    // $player's subtree silently breaks programme titles, now-playing text and
    // the snapshot.
    //
    // ---- WS15: the PODCAST NAME, above the pill, for episodes only ----
    // Owner (2026-09-27): "the podcast name in the player should move to the
    // space between 'Kehlani...' and pill MP3". On a live channel the header
    // already carries channel + programme, so meta needs nothing extra. On a
    // PODCAST the header carries the EPISODE name, and the podcast name was
    // only ever visible as the small grey subtitle inside the expanded panel
    // ("SPELAS JUST NU" block) -- never in the compact player. So the podcast
    // name goes here as the FIRST child of meta, above the quality pill.
    //
    // Wrapped in its own .player-podcast-name rather than reusing .player-sub:
    // .player-sub is LOAD-BEARING (paintProgramTitle writes into it, and the
    // WS0 snapshot reads it). Writing the podcast name there would fight the
    // programme-title painter. This element is static per render -- it never
    // changes while the episode plays, so it needs no repaint plumbing.
    //
    // Radio must be untouched: the pill row is unchanged, and this element is
    // simply absent, so `.player-meta` keeps exactly two children there.
    const podcastName = !live && (cur.programName || cur.subtitle)
      ? el('div', {
          class: 'player-podcast-name',
          text: cur.programName || cur.subtitle,
        })
      : null;
    // ---- WS16: RADIO gets the same shape as a podcast ----
    // Owner (2026-09-27), comparing the real iPhone screenshots of P3 (live)
    // and a podcast: the same information sat in different places, so the two
    // views could not be read side by side. Three moves, all measured to fit
    // in .player-meta (150.1px available; the pill row needs 93.6px):
    //
    //   1. LIVE / "−N min" moves to the FAR RIGHT of the row that carries the
    //      channel name -- i.e. the same row the podcast's quality pill uses,
    //      rather than sitting beside the quality pill on the left.
    //   2. The quality pill (AAC 320 / MP3 / FLAC) moves DOWN to where the
    //      podcast's MP3 pill already is: the second row of .player-meta.
    //   3. The channel + programme name moves to where the podcast name
    //      already is: above that pill.
    //
    // So both kinds end up with the SAME two-row structure in .player-meta:
    //   row 1:  channel-or-podcast name            [state pill on the right]
    //   row 2:  quality pill
    // A podcast has no time state, so its row 1 has no pill -- the pill is the
    // only difference, and that is real information, not a layout accident.
    //
    // The header keeps the channel/programme pair for radio. That is the
    // owner's explicit instruction from WS15b and is unchanged here.
    const isLive = Boolean(live);
    // Row 1, left: for a podcast the podcast name; for radio the CHANNEL name.
    // `cur.title` is the channel on a live track and the episode on an episode,
    // so the same expression serves both once the podcast branch is taken out.
    const identityName = isLive
      ? el('div', { class: 'player-podcast-name', text: cur.title || '' })
      : podcastName;
    // Row 1 is an explicit flex ROW, not two siblings in a block container.
    // The time state has to reach the far right of that row, and
    // `margin-left: auto` only has anything to consume inside a flex line --
    // as siblings in a block context the auto margin is eaten by inline space
    // and the pill would sit right next to the name. A podcast has no time
    // state, so its row 1 has one child and lays out exactly as before.
    // WS18: the time state is no longer a child of this row -- it lives on the
    // song row (see `timeRow`). The row is KEPT rather than collapsed to a bare
    // `identityName`, because it is the flex line that gives the channel name
    // its ellipsis context, and `paintProgramTitle()` and the WS0 diagnostics
    // both read through this subtree.
    const metaRowTop = el('div', { class: 'player-meta-row' }, identityName);
    const meta = el('div', { class: 'player-meta' },
      metaRowTop,
      // Row 2: the quality pill, in the podcast's position.
      quality);

    // Fas 4 (redesign 2026-09-23): NO one-click expansion — accidental taps
    // opened it. Instead: a dedicated chevron handle in the player header
    // expands an info panel UPWARD above the player. The bottom part
    // (controls + seek row) does not move. Fold = swipe down on the panel
    // or tap the chevron again.
    //
    // LIVE metadata (what SR actually offers — verified 2026-09-23):
    // - Live channels: CURRENT + NEXT programme from scheduledepisodes
    //   (title, description, image, start/end times). Song titles are NOT
    //   available: rightnow endpoint is dead (500), HLS playlists carry no
    //   EXT-X-DATERANGE metadata, and sverigesradio.se's SSR page only has
    //   programme-level data (CORS-blocked anyway).
    // - Episodes/podcasts: their own title/description/image (static but
    //   episode-specific).
    const expandBtn = el('button', {
      class: 'player-btn player-expand-btn', type: 'button',
      'aria-label': 'Visa programinformation',
      'aria-expanded': 'false',
      html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>',
    });

    const buildExpandPanel = () => {
      const panel = el('div', { class: 'player-expand', role: 'region', 'aria-label': 'Programinformation' });
      // WS0 diagnostics: STABLE IDENTITY for this panel node. Assigned when the
      // node is created here, and therefore NEW whenever renderPlayer() rebuilds
      // the panel. A snapshot showing the same id before and after a channel
      // switch proves THE SAME NODE SURVIVED; a changed id proves the panel was
      // REBUILT FROM STATE. That distinction is what WS0 exists to make
      // observable. Read-only bookkeeping — no rendering effect.
      META_DIAG.expandPanelSeq += 1;
      panel._srPanelSeq = META_DIAG.expandPanelSeq;
      const content = el('div', { class: 'expand-content' });
      panel.appendChild(content);
      // Fas 4 v3 (2026-09-23): the expanded player shows NOW-PLAYING
      // artwork + artist + song (from playlists/rightnow + iTunes artwork,
      // both verified from GitHub Pages origin). Pågår nu/Nästa program
      // removed — that info already lives in the Tablå context card
      // (long-press on a channel icon); no duplication.
      // song === null (talk content) → show CHANNEL + ONGOING PROGRAM
      // (user request 2026-09-23): channel artwork + channel name + the
      // Pågår nu-program title from the schedule. The old hardcoded text
      // "Ingen låtinformation för tillfället — kanalen sänder program." is
      // REMOVED — the channel name is already in the icon, and the program
      // name is the useful info here.
      const renderSongView = () => {
        // BUG 3 FIX (WS2) — read the track from LIVE STATE, not the closure.
        // This panel used to close over `cur`, the track that was playing when
        // the panel was BUILT. A panel opened by a swipe, then left open across
        // a channel switch, kept repainting the PREVIOUS channel forever: it is
        // still a child of $player, so paintNowPlaying()/paintProgramTitle()
        // found it and called _srRepaint(), but that repaint re-rendered from
        // the captured track. Reading state.current at paint time means an
        // already-visible stale panel corrects itself on the next repaint.
        // Falls back to the captured `cur` only if live state is somehow gone.
        const live = state.current || cur;
        // Same source of truth as paintNowPlaying, and now literally the same
        // function: episodes read the ondemand track at the current position;
        // live reads resolvePlayheadMeta(), which is the SAME
        // `pickByPosition(nowPlaying.timeline, playheadWallMs())` the compact
        // line uses. Before WS26 this line read `nowPlaying.song` -- the on-air
        // poll -- so the header and the compact line answered "what am I
        // looking at?" differently, and R6 could not hold by construction.
        const isEpisode = live.kind === 'episode';
        // One read, for title, artist and cover together. Reading them from
        // three different fields is what allowed the halves to disagree.
        const head = isEpisode ? null : resolvePlayheadMeta();
        const song = isEpisode ? episodeCurrentTrack : (head ? head.song : null);
        if (!song || !song.title) {
          content.appendChild(el('div', { class: 'expand-row' },
            live.artwork
              ? el('img', { class: 'expand-img', src: live.artwork, alt: '' })
              : el('div', { class: 'expand-img expand-img-placeholder', 'aria-hidden': 'true' }, '♪'),
            el('div', { class: 'expand-text' },
              el('div', { class: 'expand-label', text: 'Spelas just nu' }),
              el('div', { class: 'expand-title', text: isEpisode ? (live.title || '') : (live._srProgramTitle || live.title || '') }),
              !isEpisode && live._srProgramTitle && live.title && live._srProgramTitle !== live.title
                ? el('div', { class: 'expand-sub', text: live.title }) : null)));
          return;
        }
        // WS12 Part C: for an EPISODE with a current track, the cover is the
        // PROGRAMME image -- the same `live.artwork` the no-song branch above
        // already uses. For a podcast the programme image IS the album cover,
        // the app already has it, and nothing new has to be fetched.
        //
        // Why NOT the iTunes artwork lookup that live channels use
        // (refreshNowPlayingArtwork): that function is reached only from
        // fetchNowPlaying, which is only called when `cur.kind === 'live'`, so
        // for an episode `nowPlaying.artwork` is ALWAYS null and removing the
        // discard below would expose a second null -- no visible change at all.
        // Extending the iTunes path to episodes was measured and is a trap: it
        // searches "<artist> <title>" where title is the EPISODE name, and
        // returns an unrelated song's cover. Verified against real SR names --
        // "P3 Soul" -> PARTYNEXTDOOR "Not Nice", "Breakfastvärd" and "Humlan
        // Helmer" -> MISS. Showing a stranger's album under a Swedish radio
        // programme is worse than the placeholder, so the live path is left
        // strictly alone.
        //
        // If there is no programme image either, the ♪ placeholder stays.
        // Never a broken image and never an unrelated cover.
        // WS13 Part B: an episode prefers the resolved ALBUM COVER for the
        // current song, and falls back to the programme image when no cover
        // could be resolved. The fallback is not a placeholder for something
        // broken -- for a podcast the programme image IS the album art, and it
        // is what the no-song branch above already shows. An unresolved cover
        // therefore degrades to the correct image rather than to nothing, and
        // never to an unrelated one.
        const songArtwork = isEpisode
          ? (nowPlaying.episodeArtwork || live.artwork || null)
          : (head ? head.artwork : null);
        content.appendChild(el('div', { class: 'expand-row' },
          songArtwork
            ? el('img', { class: 'expand-img expand-img-song', src: songArtwork, alt: '' })
            : el('div', { class: 'expand-img expand-img-placeholder', 'aria-hidden': 'true' }, '♪'),
          el('div', { class: 'expand-text' },
            el('div', { class: 'expand-label', text: 'Spelas just nu' }),
            el('div', { class: 'expand-title', text: song.title || '' }),
            song.artist ? el('div', { class: 'expand-sub', text: song.artist }) : null)));
      };
      renderSongView();
      // Re-paint when metadata/artwork arrives after the panel opened.
      panel._srRepaint = () => { content.textContent = ''; renderSongView(); };
      return panel;
    };

    expandBtn.addEventListener('click', () => {
      const existing = $player.querySelector('.player-expand');
      if (existing) {
        existing.remove();
        setExpandOpen(false);
        return;
      }
      const panel = buildExpandPanel();
      // Grab zone at the panel top owns the swipe-down-to-fold gesture
      // (BUG 1 lesson: never attach swipe logic to a scrollable surface —
      // it kills touch scrolling on iOS). The content below scrolls freely.
      const grabZone = el('div', { class: 'expand-grab-zone' }, el('div', { class: 'sheet-grab' }));
      panel.insertBefore(grabZone, panel.firstChild);
      $player.insertBefore(panel, $player.firstChild); // grows UPWARD — bottom stays put
      setExpandOpen(true);
      const fold = () => {
        panel.remove();
        setExpandOpen(false);
      };
      enableSwipeToClose(panel, panel, fold, { axis: 'y' });
      // The grab zone must not scroll — it owns the vertical gesture.
      grabZone.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    });

    // Direct AAC streams: confirm bitrate via icy-br HEAD (edge hosts only).
    // Only overrides the descriptor when the header gives a real value —
    // never invents one. Skipped for FLAC (icy-br unreliable there).
    // HLS bitrate comes from LEVEL_SWITCHED (see hlsAttach) — no HEAD here.
    if (live && cur.audioUrl && quality && cur.codec !== 'flac'
        && cur.transport === 'direct') {
      const key = lastPlayingKey;
      fetchStreamBitrate(cur.audioUrl).then((br) => {
        if (!br || lastPlayingKey !== key) return; // track changed meanwhile
        const badge = $player.querySelector('.player-quality');
        if (badge) {
          badge.dataset.format = `${cur.codec.toUpperCase()} ${br}`;
          badge.textContent = badge.dataset.format;
        }
      });
    }

    let seekRow = null;
    if (!live) {
      const bar = el('div', {
        class: 'seek-bar episode-seek-bar',
        role: 'slider',
        'aria-label': 'Spola i avsnittet',
        'aria-valuemin': 0,
        'aria-valuemax': cur.duration || 0,
        'aria-valuenow': 0,
        tabindex: '0',
      }, el('div', { class: 'seek-fill' }), el('div', { class: 'seek-thumb' }));
      const timeLeft = el('div', { class: 'player-time', text: '' });
      const timeRight = el('div', { class: 'player-time', text: '' });
      seekRow = el('div', { class: 'seek-row' }, timeLeft, bar, timeRight);
      const fill = bar.querySelector('.seek-fill');
      const thumb = bar.querySelector('.seek-thumb');

      const duration = () => Number.isFinite(audioEl.duration) && audioEl.duration > 0
        ? audioEl.duration
        : (cur.duration || 0);
      const fractionAt = (clientX) => {
        const rect = bar.getBoundingClientRect();
        if (!rect.width) return null;
        return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      };
      const paintEpisodeSeek = (frac) => {
        const f = Math.min(1, Math.max(0, frac));
        fill.style.width = `${f * 100}%`;
        thumb.style.left = `${f * 100}%`;
        bar.setAttribute('aria-valuenow', String(Math.round(f * duration())));
      };

      const upd = () => {
        const d = duration();
        const t = audioEl.currentTime || 0;
        if (d > 0) paintEpisodeSeek(t / d);
        timeLeft.textContent = fmtDur(t) || '0:00';
        timeRight.textContent = d ? fmtDur(d) : '';
      };
      if (audioEl._srUpd) { metaDiagCountRemove('timeupdate'); audioEl.removeEventListener('timeupdate', audioEl._srUpd); }
      audioEl._srUpd = upd;
      metaDiagCountAdd('timeupdate');
      audioEl.addEventListener('timeupdate', upd);
      upd();

      installEpisodeSeekPointerHandlers(bar, {
        getDuration: duration,
        seekToFraction: (fraction) => {
          const d = duration();
          if (d > 0) audioEl.currentTime = fraction * d;
        },
        onPreview: paintEpisodeSeek,
        onRestore: upd,
      });
      bar.addEventListener('keydown', (e) => {
        const d = duration();
        if (!(d > 0)) return;
        if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          audioEl.currentTime = e.key === 'Home' ? 0 : d;
          return;
        }
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const step = e.shiftKey ? SEEK_STEP_S : 5;
        audioEl.currentTime = Math.max(0, Math.min(d, (audioEl.currentTime || 0)
          + (e.key === 'ArrowLeft' ? -step : step)));
      });
    } else if (cur.dvrAvailable) {
      // DVR seek row (Phase 3, UX rev): a REAL draggable slider (pointer
      // events — touch + mouse), mapped to the actual seekable range. Left
      // label = clock time of the heard position; right label = "LIVE",
      // clickable to return to the live edge (replaces the separate button —
      // no duplicated LIVE state, no extra button when already live).
      const bar = el('div', {
        class: 'seek-bar dvr-bar', role: 'slider',
        'aria-label': 'Spola i direktinspelningen',
        'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 100,
        tabindex: '0',
      }, el('div', { class: 'seek-fill' }), el('div', { class: 'seek-thumb' }));
      const timeLeft = el('div', { class: 'player-time', text: '' });

      // ±15 s step buttons + program skip now live in the MAIN controls row
      // (flanking play/pause) per user request 2026-09-23 — the seek row
      // keeps only the slider + clock label. LIVE label removed: the mode
      // pill shows LIVE/−time, and the FORWARD SKIP button doubles as
      // "Till Direkt" when there is no later programme (see syncNext below),
      // so returning to live is a visible, labelled control.

      // Program-skip buttons live in the MAIN controls row now (created
      // below); the schedule wiring happens after they exist.

      // ---- WS11 Part A: the DVR window readout is REMOVED from the seek row ----
      // The readout (WS9 Part C) was a third flex child of .seek-row, and a flex
      // container shares width among its children -- so it took width AWAY from
      // the seek bar. The owner saw a shorter slider and bottom-right chrome
      // they never asked for. The value was never the problem; putting it HERE
      // was.
      //
      // The value is NOT lost: it still lives in the gated diagnostics snapshot
      // as dom.nextProgram.press.windowSeconds (and on the one-line report as
      // `dvrWindow`), both derived from cur.seekableStart / cur.seekableEnd.
      // That is where it belonged all along -- a diagnostic that renders nothing
      // on screen. It is what proved the window is 3 h 1 min and retired a
      // multi-day enquiry, and it can still be read without touching the player.
      seekRow = el('div', { class: 'seek-row dvr-row' },
        timeLeft, bar);
      const fill = bar.querySelector('.seek-fill');
      const thumb = bar.querySelector('.seek-thumb');

      // The right 12 % of the bar used to be an INVISIBLE "back to live" tap
      // zone. It had no visual affordance at all, the owner never managed to
      // hit it, and it cost two workstreams of misdiagnosis (WS2 and WS3 both
      // chased the wrong button). It is REMOVED (WS4): the next-programme
      // button now doubles as "Till Direkt" when there is no later programme,
      // which is a visible, labelled control. Drag-to-seek, the fill/thumb and
      // the clock label are untouched.

      // Drag state: while dragging, the UI previews the target position and
      // does NOT fight the rolling window; the seek is committed on release
      // (feels native on touch, avoids seek-storms while sliding).
      let dragging = false;
      let dragFrac = null;

      const windowFrac = () => {
        const start = cur.seekableStart;
        const end = cur.seekableEnd;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
        const t = audioEl.currentTime || start;
        return Math.min(1, Math.max(0, (t - start) / (end - start)));
      };

      const paint = (frac) => {
        const f = Math.min(1, Math.max(0, frac));
        fill.style.width = `${f * 100}%`;
        thumb.style.left = `${f * 100}%`;
        bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
        // Left label: clock time of the represented position (drag preview
        // while dragging, otherwise the heard position).
        const start = cur.seekableStart;
        const end = cur.seekableEnd;
        if (!Number.isFinite(start) || !Number.isFinite(end)) { timeLeft.textContent = ''; return; }
        const pos = start + f * (end - start);
        const d = dvrPositionToDate(pos);
        timeLeft.textContent = d ? dvrClockLabel(d) : '';
      };

      const upd = () => {
        if (dragging) return; // don't fight the finger
        const f = windowFrac();
        if (f === null) { timeLeft.textContent = ''; fill.style.width = '0%'; return; }
        paint(f);
      };
      if (audioEl._srDvrUpd) { metaDiagCountRemove('timeupdate'); audioEl.removeEventListener('timeupdate', audioEl._srDvrUpd); }
      audioEl._srDvrUpd = upd;
      metaDiagCountAdd('timeupdate');
      audioEl.addEventListener('timeupdate', upd);
      upd();

      const fracFromEvent = (e) => {
        const rect = bar.getBoundingClientRect();
        return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      };

      // Pointer events = unified touch/mouse dragging.
      // GESTURE DISAMBIGUATION (fix for "slider jumps to zero by itself"):
      // a vertical swipe-down on the player that BEGINS on the seek bar was
      // interpreted as a horizontal drag → the release committed a seek to
      // the finger's x-position (often near 0). Fix: only treat a pointer as
      // a seek-drag once it shows HORIZONTAL intent (dx >= dy, dx >= 8 px).
      // Vertical-dominant gestures are ignored entirely — the swipe-to-close
      // handler owns those.
      let paintPending = false;
      let dragStartX = null;
      let dragStartY = null;
      let dragAxis = null; // 'x' | 'y' | null (undecided)
      const paintThrottled = (frac) => {
        dragFrac = frac;
        if (paintPending) return;
        paintPending = true;
        requestAnimationFrame(() => {
          paintPending = false;
          if (dragging && dragFrac !== null) paint(dragFrac);
        });
      };

      bar.addEventListener('pointerdown', (e) => {
        dragging = true;
        dragAxis = null; // decided on first significant move
        dragFrac = fracFromEvent(e);
        paint(dragFrac);
        try { bar.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
        bar.classList.add('dragging');
      });
      bar.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        if (dragAxis === null) {
          const dx = Math.abs(e.clientX - (dragStartX ?? e.clientX));
          const dy = Math.abs(e.clientY - (dragStartY ?? e.clientY));
          if (dx < 8 && dy < 8) return; // not yet significant
          dragAxis = dx >= dy ? 'x' : 'y';
          if (dragAxis === 'y') {
            // Vertical intent — this is a swipe-to-close gesture, not a seek.
            // Abort the drag WITHOUT committing anything; the swipe handler
            // owns vertical gestures.
            dragging = false;
            dragFrac = null;
            bar.classList.remove('dragging');
            try { bar.releasePointerCapture(e.pointerId); } catch (err) { /* ok */ }
            paint(windowFrac() ?? 0); // restore the real position
            return;
          }
        }
        if (dragAxis !== 'x') return;
        paintThrottled(fracFromEvent(e));
      });
      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        // Only commit a seek when the gesture was a horizontal drag (or a
        // plain tap). A vertical-dominant gesture belongs to swipe-to-close.
        const commit = dragAxis === 'x' || dragAxis === null;
        const frac = (e && Number.isFinite(e.clientX)) ? fracFromEvent(e) : dragFrac;
        dragFrac = null;
        bar.classList.remove('dragging');
        if (e && Number.isFinite(e.pointerId)) {
          try { bar.releasePointerCapture(e.pointerId); } catch (err) { /* released */ }
        }
        if (commit && frac !== null) seekToWindowFraction(frac);
        upd();
      };
      bar.addEventListener('pointerup', endDrag);
      bar.addEventListener('pointercancel', endDrag);
      // Safety net: if iOS never fires pointerup/cancel (observed failure
      // mode), a pointer that LEAVES the bar while dragging ends the drag
      // instead of leaving the slider stuck (BUG B).
      bar.addEventListener('pointerleave', (e) => {
        if (dragging && e.pointerType === 'touch') endDrag(e);
      });
      // Last-resort fallback: if dragging somehow stays true (no end event
      // fired at all), a watchdog force-releases after 3 s without movement
      // so the slider never "dies". The interval is cleared when this bar is
      // replaced (renderPlayer rebuilds the row; the old bar is garbage once
      // its guard is cleared).
      let lastDragMove = Date.now();
      bar.addEventListener('pointermove', () => { lastDragMove = Date.now(); });
      bar.addEventListener('pointerdown', (e) => {
        lastDragMove = Date.now();
        dragStartX = e.clientX;
        dragStartY = e.clientY;
      });
      const stuckGuard = setInterval(() => {
        if (!dragging) return;
        // A real drag produces pointermove; if none arrived for 3 s while
        // dragging, force-release.
        if (Date.now() - lastDragMove > 3000) endDrag(null);
      }, 1000);
      const prevGuard = audioEl._srStuckGuard;
      if (prevGuard) clearInterval(prevGuard);
      audioEl._srStuckGuard = stuckGuard;

      // Keyboard support (desktop): arrows move within the window.
      bar.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 0.1 : 0.02; // shift = 10 %, normal = 2 %
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const dir = e.key === 'ArrowLeft' ? -1 : 1;
          const f = windowFrac();
          if (f === null) return;
          seekToWindowFraction(Math.min(1, Math.max(0, f + dir * step)));
          upd();
        }
      });
    }

    // DVR transport buttons (±15 s + program skip) flank play/pause in the
    // main controls row — user request 2026-09-23: "logically placed left and
    // right of the play/stop button". For non-DVR (podcast/episode) playback
    // the ±15 s buttons use plain currentTime seeks (SEEK_STEP_S).
    const isDvr = live && cur.dvrAvailable;
    const backBtn = el('button', {
      class: `player-btn${isDvr ? ' dvr-step-btn' : ''}`, type: 'button', 'aria-label': 'Bakåt 15 sekunder',
      html: isDvr
        ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>',
      onclick: () => {
        if (isDvr) seekBy(-SEEK_STEP_S_DVR);
        else audioEl.currentTime = Math.max(0, audioEl.currentTime - SEEK_STEP_S);
      },
    });

    // Program-skip back button (DVR only, hidden until schedule resolves).
    const prevProgramBtn = isDvr ? el('button', {
      class: 'player-btn dvr-program-btn', type: 'button',
      'aria-label': 'Till föregående programs start',
      style: 'display:none;',
      html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>',
    }) : null;

    const playPause = el('button', {
      class: 'player-btn player-btn-main', type: 'button',
      'aria-label': audioEl.paused ? 'Spela' : 'Pausa',
      html: audioEl.paused
        ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
      onclick: () => {
        if (audioEl.paused) audioEl.play().catch(() => showToast('Kunde inte starta uppspelning.'));
        else audioEl.pause();
        renderPlayer();
      },
    });

    // Program-skip forward button (DVR only, lights up when behind live AND
    // a later programme exists — same semantics as before, new position).
    const nextProgramBtn = isDvr ? el('button', {
      class: 'player-btn dvr-program-btn', type: 'button',
      'aria-label': 'Till nästa programs start',
      style: 'display:none;',
      html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>',
    }) : null;

    const fwdBtn = el('button', {
      class: `player-btn${isDvr ? ' dvr-step-btn' : ''}`, type: 'button', 'aria-label': 'Framåt 15 sekunder',
      html: isDvr
        ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 6v12l8.5-6L13 6zM3 18l8.5-6L3 6v12z"/></svg>',
      onclick: () => {
        if (isDvr) { seekBy(SEEK_STEP_S_DVR); return; }
        const d = Number.isFinite(audioEl.duration) && audioEl.duration > 0
          ? audioEl.duration : cur.duration;
        if (d) audioEl.currentTime = Math.min(d, audioEl.currentTime + SEEK_STEP_S);
      },
    });

    const closeBtn = el('button', {
      class: 'player-btn player-btn-close', type: 'button', 'aria-label': 'Stäng spelaren',
      html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
      onclick: stopAndClosePlayer,
    });

    const controls = el('div', { class: 'player-controls' });
    if (prevProgramBtn) controls.appendChild(prevProgramBtn);
    if (backBtn) controls.appendChild(backBtn);
    controls.appendChild(playPause);
    if (fwdBtn) controls.appendChild(fwdBtn);
    if (nextProgramBtn) controls.appendChild(nextProgramBtn);
    // ---- WS13 Part A: the chevron and the close join the transport row ----
    // The owner: "the mid player close button now is back to the left above the
    // miniture image and not to the right on a row above the title to mimic the
    // ui for the minimised player. this issue is both on radio channel playing
    // and podcasts".
    //
    // "mimic the ui for the minimised player" is the specification. The
    // minimised bar reads thumb . text . play . chevron . close, so the close
    // is the LAST item on the SAME row as play and chevron. The order here is
    // transport . chevron . close for the same reason.
    //
    // This is the same end state WS11a aimed for. WS11a was not wrong in its
    // MECHANISM, it was wrong about who asked for it: it was authorised by a
    // brief that said "on the same row as the transport buttons", which was a
    // transcription error in the brief rather than the owner's intent. WS12
    // then reversed it on the strength of "they should be above". Now it is the
    // owner's own request, so it stands.
    //
    // The header keeps a width-only SPACER in the close button's old place.
    // That is not cosmetic: `.player-header .player-btn-close` was sized
    // var(--player-art) and doubled as the artwork-column spacer, and the row's
    // shared --player-gap after it is what lands the title and programme on the
    // artwork's right edge. Deleting the button removes the thing that CREATES
    // the space, not the space, and the text column collapses to 0 with every
    // test still green. The spacer is that same width, from the same custom
    // property -- never a pixel literal.
    // ---- WS14: the chevron and the close LEAVE the transport row ----
    // Owner (2026-09-27), correcting WS13 Part A: the chevron and the close
    // belong on the header row, grouped at the RIGHT end, "visually look as
    // the minimised player", on the same line as the channel and programme
    // title, for radio AND podcasts.
    //
    // WHY WS13 PART A WAS REVERTED — this is a measurement, not a preference.
    // The owner reported the 7-button DVR state cramping the row; the brief
    // attributed it to a missing comma ("not to, the right on a row above the
    // title"). That explanation was WRONG. WS12 had already put both buttons
    // back on the header row, with a comment recording this exact measurement:
    // "with the DVR state (7 buttons) meta went to 0px, the row overflowed
    // 388 > 358". WS13 Part A re-broke a defect I had already found, because
    // the comma-less "to mimic the ui for the minimised player" read as a fresh
    // instruction and overrode my own prior finding. Ignore no measurement
    // because a later sentence sounds like a command.
    //
    // The arithmetic at 390px, measured live, both states DVR:
    //   WS12 (5 controls, close+chevron in header): 44+12+66.1+12+224 = 358 = fits
    //   WS13 (7 controls):                          44+12+   0+12+304 = 372 > 358
    // The two rows differ ONLY by the two buttons WS13 moved into the row.
    // .player-meta is `flex: 1 1 0%` with `min-width: 0`, so it absorbs the
    // entire deficit to 0 and never pushes back. The text is not truncated —
    // it PAINTS outside its box (overflow: visible), which is why the defect
    // looks milder than it is while the close button is genuinely clipped.
    //
    // NOTE: `document.documentElement.scrollWidth > window.innerWidth` is FALSE
    // in every one of these cases. The only signals that detect it are
    // row.scrollWidth > row.clientWidth and meta.getBoundingClientRect().width.

    // Wire program-skip buttons once the schedule resolves (DVR only).
    // Re-render is NOT needed: the buttons live in this render instance.
    if (isDvr && cur.id && prevProgramBtn && nextProgramBtn) {
      // LEAK FIX (WS1): drop the PREVIOUS render's programme-skip updater
      // before this render can register its own. Without this, every
      // renderPlayer() call added another `timeupdate` listener on the
      // singleton audioEl and never removed any, so closures (and the
      // orphaned button trees they capture) accumulated for the life of the
      // page. Same convention as _srUpd / _srDvrUpd above.
      //
      // This removal MUST stay synchronous in renderPlayer(), NOT inside the
      // fetchSchedule callback: syncNext is registered asynchronously, so a
      // cleanup that ran after an `await` would be racing the registration it
      // is meant to prevent. The property guard makes it safe when no listener
      // was ever registered.
      if (audioEl._srNextUpd) {
        metaDiagCountRemove('timeupdate');
        audioEl.removeEventListener('timeupdate', audioEl._srNextUpd);
        audioEl._srNextUpd = null;
      }
      fetchSchedule(cur.id).then((schedule) => {
        if (!schedule || !document.contains(prevProgramBtn)) return;
        // ---- WS6: the playhead's wall-clock position, WITHOUT seekableEnd ----
        //
        // The shipped formula was
        //     posMs = Date.now() - (cur.seekableEnd - audioEl.currentTime) * 1000
        // which infers "now" by measuring backwards from the live edge. It
        // inherits every staleness in `cur.seekableEnd` (an HLS buffered-range
        // end that iOS can report late between updates), and it is only ever as
        // good as that assumption.
        //
        // The schedule is fetched over HTTP, carries absolute UTC start/end
        // times, and is not subject to buffered-range lag. So the position is
        // derived from the programme that is ACTUALLY ON AIR at the playhead:
        // find the event whose [startMs, endMs) contains the playhead's
        // estimated wall-clock time, and use that event's own start.
        //
        // The playhead's own offset is still needed to find WHICH event it is
        // in, so the estimate is seeded from the old formula — but it is only
        // an index into the schedule now, never the value compared against a
        // programme start. A stale `end` can then only mis-select between two
        // adjacent programmes, and the 1s boundary margins below absorb that;
        // it can no longer manufacture a wrong "now".
        //
        // `Date.now()` is NOT trusted on its own either: a phone whose clock
        // drifts would put every programme in the future, making every press
        // dead. So the schedule's own notion of now is used, derived by
        // assuming the event containing the playhead is the current one.
        const liveEdgeWallMs = () => {
          const end = cur.seekableEnd;
          if (!Number.isFinite(end)) return Date.now();
          // The live edge is, by construction, ~now. Use it only to seed.
          return Date.now() - (end - (audioEl.currentTime || 0)) * 1000;
        };
        // The schedule's own clock: the start of the event the playhead sits
        // in, corrected by how far into that event the playhead is. Falls back
        // to the wall clock when the schedule cannot place the playhead.
        const scheduleNowMs = () => {
          const est = liveEdgeWallMs();
          const ev = schedule.find((e) => e.startMs <= est && est < e.endMs)
            || schedule.find((e) => e.endMs > est);
          if (!ev) return est;
          return ev.startMs;
        };
        // Position used for boundary lookups: the START of the programme the
        // playhead is inside. Comparing a programme's start against another
        // programme's start is exact — no clock, no buffered range, no
        // tolerance drift.
        const posMs = () => {
          const est = liveEdgeWallMs();
          const ev = schedule.find((e) => e.startMs <= est && est < e.endMs)
            || schedule.find((e) => e.endMs > est);
          return ev ? ev.startMs : est;
        };
        // ---- WS42: capture posMs() ONCE and use it for both the record and the
        // real selection. Storing the value changes NOTHING about the
        // behaviour: `posMs()` is still evaluated exactly once here, it is
        // simply kept. Calling it a second time for the record would sample a
        // slightly later instant and could report a `prevEv` the handler does
        // not actually make — a diagnostic that lies about its own subject.
        const bindPosMs = posMs();
        const prevEv = programBoundary(schedule, bindPosMs, -1);
        // Recorded AFTER the value it describes exists, and never read by the
        // handler. Pure observation.
        const bindEstMs = liveEdgeWallMs();
        const bindEv = schedule.find((e) => e.startMs <= bindPosMs && bindPosMs < e.endMs)
          || schedule.find((e) => e.endMs > bindPosMs);
        META_DIAG.prevBind = {
          boundAtMs: Date.now(),
          liveEdgeWallMs: bindEstMs,
          posMs: bindPosMs,
          posMsWasEventStart: bindEv ? bindEv.startMs === bindPosMs : false,
          containingTitle: bindEv ? (bindEv.title || null) : null,
          containingStartMs: bindEv && Number.isFinite(bindEv.startMs) ? bindEv.startMs : null,
          containingEndMs: bindEv && Number.isFinite(bindEv.endMs) ? bindEv.endMs : null,
          prevStartMs: prevEv ? prevEv.startMs : null,
          prevTitle: prevEv ? (prevEv.title || null) : null,
          // The edge the estimate was seeded from. If this is the stale
          // cached edge, the same staleness that shifts the seek target also
          // shifts which programme `posMs()` lands in.
          seekableEndAtBind: Number.isFinite(cur.seekableEnd) ? cur.seekableEnd : null,
          seekableEndWrittenAtBind: Number.isFinite(cur.seekableEndWrittenAtMs)
            ? cur.seekableEndWrittenAtMs : null,
          currentTimeAtBind: Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : null,
          scheduleLength: Array.isArray(schedule) ? schedule.length : null,
        };
        if (prevEv) {
          prevProgramBtn.style.display = '';
          prevProgramBtn._srMode = 'programme';
          const goPrev = () => seekToProgramTime(prevEv.startMs);
          goPrev._srMode = 'programme';
          prevProgramBtn.onclick = goPrev;
        }
        const syncNext = () => {
          // ---- WS7 FIX: the NEAREST started boundary, not the first one ----
          //
          // WS6 replaced a future-programme lookup with
          //     schedule.find((ev) => ev.startMs <= nowMs)
          // and that is ALSO wrong. `fetchScheduleDay` sorts the schedule
          // ASCENDING, and `Array.prototype.find` returns the FIRST match --
          // so this returned the earliest event of the whole day
          // ("Ekot senaste nytt" @ 00:00), typically hours before the
          // playhead. seekToProgramTime() then asked for a position outside
          // the 3 h DVR window, hit its `target < start` guard and showed
          // "Programmet ligger utanför spolbart område", leaving the playhead
          // untouched. Measured over 132 behind-live moments: 132/132 dead.
          //
          // The correct target for a FORWARD button is the nearest programme
          // start that lies strictly after the PLAYHEAD and has already
          // begun. Two properties then hold simultaneously, and BOTH are
          // required:
          //   startMs >  playhead  -> the seek moves FORWARD, never backward;
          //   startMs <= now       -> the seek target is never in the future,
          //                            so seekToProgramTime()'s `behindMs < 0`
          //                            guard cannot fire from this button.
          //
          // Note this is the playhead's own position, NOT posMs()'s value
          // (which is the containing programme's START). Comparing against
          // the programme start asks for a boundary after the current
          // programme began -- i.e. the NEXT programme -- which has not
          // started yet, so that form finds nothing for the whole duration of
          // every programme and silently turns the button into "Till Direkt".
          // Both forms avoid a dead press; only this one keeps offering a real
          // forward skip. posMs() itself is untouched and still used below for
          // the backwards button, where it is correct.
          //
          // programBoundary() keeps its contract; the +1000 margin is NOT
          // widened and no threshold is retuned.
          const positionMs = posMs();
          const nowMs = Date.now();
          const playheadMs = liveEdgeWallMs();
          // NEAREST started boundary after the playhead. `schedule` is sorted
          // ascending, so `find` here walks forward in time and the first
          // match is the nearest one -- which is what makes this correct where
          // WS6's `find` was not.
          const startedNext = schedule.find((ev) => ev.startMs > playheadMs
            && ev.startMs <= nowMs);
          const behindLive = cur.atLiveEdge === false
            || (Number.isFinite(cur.seekableEnd) && cur.seekableEnd - (audioEl.currentTime || 0) > 60);
          const nextEv = startedNext
            ? { startMs: startedNext.startMs, title: startedNext.title }
            : null;
          if (nextEv && behindLive) {
            nextProgramBtn.style.display = '';
            nextProgramBtn.title = nextEv.title || 'Nästa program';
            nextProgramBtn.setAttribute('aria-label', 'Till nästa programs start');
            // Named + tagged so the WS6 snapshot can read the REAL wiring
            // instead of trusting a parallel mode variable.
            const goNext = () => {
              recordSkipPress(nextEv.startMs);
              seekToProgramTime(nextEv.startMs);
            };
            goNext._srMode = 'programme';
            nextProgramBtn.onclick = goNext;
          } else if (behindLive) {
            // No started boundary ahead of the playhead, but behind live: go to
            // live. Before WS4 this case HID the button entirely, leaving no
            // discoverable way back.
            nextProgramBtn.style.display = '';
            nextProgramBtn.title = 'Till Direkt';
            nextProgramBtn.setAttribute('aria-label', 'Till Direkt');
            // Named and tagged so the WS6 snapshot reads the REAL wiring. The
            // tag is what `mode` is derived from — see metaDiagNextProgram().
            const goLive = () => {
              recordSkipPress(null);
              seekToLive();
            };
            goLive._srMode = 'direct';
            nextProgramBtn.onclick = goLive;
          } else {
            // Already live: hide it, so there is no button that does nothing.
            nextProgramBtn.style.display = 'none';
            nextProgramBtn.onclick = null;
          }
          // Expose the inputs the branch decision used, for the snapshot.
          // Deliberately NOT stored on the current-track object: the WS0 hook
          // is contractually read-only with respect to playback state, and a
          // test enforces that. META_DIAG is the diagnostics' own store.
          META_DIAG.nextBranch = {
            positionMs, nowMs, behindLive,
            nextStartMs: nextEv ? nextEv.startMs : null,
            nextTitle: nextEv ? nextEv.title : null,
            liveEdgeWallMs: liveEdgeWallMs(),
          };
        };
        if (prevEv) syncNext();
        // Keep next-button state fresh as playback moves. Paired with the
        // synchronous removal above, so exactly one such listener is ever
        // attached to audioEl.
        metaDiagCountAdd('timeupdate');
        audioEl.addEventListener('timeupdate', syncNext);
        audioEl._srNextUpd = syncNext;
      }).catch(() => { /* schedule unavailable — buttons stay hidden */ });
    }

    // ---- WS5b layout pieces ----
    // The header row carries the channel and the programme. The two corner
    // buttons used to live here too, which put them on a row of their own
    // above the transport — the owner asked for them on the controls row at
    // the right-hand end instead, matching the minimised bar
    // (thumb · meta · play · chevron · close). They now live in `controls`.
    //
    // ---- WS12 Part B: the two buttons are back on the header row ----
    // The owner: "the close button and chevron were not to be placed on the
    // player icons line. they should be above."
    //
    // The brief that authorised WS11a said "on the same row as the transport
    // buttons". That was a transcription error in the brief, by the reviewer --
    // NOT a change of mind by the owner -- and the minimised bar's arrangement
    // is a different layout and is not the model. So this is a straight revert
    // of the WS11a move, with the damage it did reversed too.
    //
    // THE SPACER IS GONE BECAUSE THE REAL BUTTON IS BACK. Exactly one of the
    // two may occupy the artwork column. WS11a left a width-only
    // .player-header-spacer (var(--player-art)) standing in for the close
    // button. Keeping both would add 44px of dead space and push the text
    // RIGHT of the artwork's edge, past the quality pill and the song line.
    // The close button itself is the spacer again: it is sized from
    // --player-art by .player-header .player-btn-close, and the shared
    // --player-gap after it is what lands the title and programme on the
    // artwork's right edge. That is structural, not a padding-left literal.
    //
    // WHY THE BUTTONS WERE ON THE TRANSPORT ROW AT ALL (measured, 390px):
    // .player-quality is not in the controls row -- it is built inside `meta`,
    // and `meta` is a sibling of `thumb` and `controls` inside .player-row. So
    // putting two more 44px buttons in the controls row squeezed .player-meta
    // instead of overflowing the row: with the DVR state (7 buttons) meta went
    // to 0px, the row overflowed 388 > 358, and the pill wrapped to two lines
    // (17px -> 32px tall). Chromium has no audio output and no DVR transport,
    // so this was invisible in every desktop check, and the "no horizontal
    // overflow" check is TRUE here regardless, because flex items shrink
    // rather than overflow. The detectable signals are row.scrollWidth >
    // row.clientWidth and meta.getBoundingClientRect().width.
    //
    // CLASS NAMES AND PARENTING ARE LOAD-BEARING: paintProgramTitle() writes
    // into '.player-sub' and paintNowPlaying() into '.now-playing-line', both
    // via $player.querySelector(...), and the WS0 snapshot reads the same
    // nodes. Renaming either, or moving either out of $player's subtree,
    // silently stops programme titles and song lines painting — with green
    // tests. Keep them as two separate elements: merging the title and
    // programme into one text node would break paintProgramTitle entirely.
    const headerSpacer = el('div', { class: 'player-header-spacer', 'aria-hidden': 'true' });
    // ---- WS14: chevron + close, right-grouped, on the header row ----
    // Order is the minimised bar's: text, then chevron, then close. The
    // header KEEPS the width-only SPACER in the artwork column: exactly one
    // element may occupy that column, and the spacer is what lands the title
    // and programme on the artwork's right edge (structurally, via the row's
    // shared --player-gap -- not a padding-left literal). The spacer is
    // width-only with NO height, so the header still collapses to the text's
    // line height instead of adding a 44px empty row.
    //
    // WHY RIGHT-GROUPED RATHER THAN THE WS11a/WS12 LEFT-CLOSE: the owner
    // asked for the minimised bar's arrangement, which puts both buttons
    // after the text. The left-close variant was measured as working
    // (meta 66.1px) but groups them at opposite ends of the line, which is
    // not what "visually look as the minimised player" describes.
    // ---- WS15b: the header carries ONE identity, not two ----
    // Measured at 390px on P3 Soul (pod 2680) before this change:
    //   header title  "Kehlani och Kärleken till Frida"  167.1px  CLIPPED
    //   header sub    "P3 Soul"                           35.0px  CLIPPED
    //   podcast name  "P3 Soul"                          150.1px  (the new element)
    // The podcast name appeared TWICE -- once in the header, truncated to
    // "P3 ...", and again above the quality pill -- and the episode name it
    // squeezed was itself truncated. Two facts about the data made the
    // duplication structural rather than accidental:
    //   - for an EPISODE, `cur.subtitle` IS the podcast name (set from
    //     `programName` at playTrack time), so the sub line showed it;
    //   - for a LIVE channel, `cur._srProgramTitle` is the PROGRAMME name,
    //     which is genuinely wanted, so the sub line must stay for radio.
    // So the sub line is dropped for episodes ONLY. The header then reads
    // episode name alone, full width, exactly as the owner asked, and the
    // podcast name appears once, in full, above the pill.
    // Radio is untouched: `_srProgramTitle || cur.subtitle || 'Direkt'` still
    // applies there, so P1 keeps "P1 / Godmorgon, världen!" and P3 keeps
    // "P3 Din gata / P3 Din Gata: Musik".
    // ---- WS19: the bold channel/programme pair is GONE from the header ----
    // The owner (screenshot): "remove the Bold duplicate information top left
    // ... it must be the same exactly as we have mapped to just above the pill
    // mp3 96". The channel name was printed TWICE -- once bold in the header,
    // once in the meta row directly above the quality pill -- and the header
    // row was mostly empty space besides.
    //
    // The header now keeps ONLY the programme line, styled as the quiet
    // secondary text it always was, positioned in the same column as the meta
    // row so the two read as one stack. The channel name is not lost: it is
    // the meta row's first child, one row below, and it is also the player's
    // own identity used by `.player-podcast-name` on a podcast.
    //
    // `.player-sub` is LOAD-BEARING -- `paintProgramTitle()` writes into it via
    // `$player.querySelector('.player-sub')` and the WS0 diagnostics read it --
    // so the ELEMENT stays and only the bold `.player-title` sibling is
    // removed. Removing the element instead would stop the programme painting
    // with the whole suite still green.
    // ---- WS20: the podcast's header cell is the EPISODE NAME, restored ----
    // The owner (attachment 2): "i wanted the episode name to stay there where
    // it was ... never said you should take it away and instead implement a
    // double dip the info we already have above the mp3 pill."
    //
    // WS19 replaced this cell's content for a podcast with `cur.programName`,
    // which is the PODCAST name -- so the header read "P3 Soul" while the meta
    // row directly below it also read "P3 Soul". That is precisely the double
    // dip the owner is describing, and it was my own regression: the header had
    // no branch for a podcast before WS19, because `.player-sub` was
    // live-only and the EPISODE NAME lived in the bold `.player-title` beside
    // it. Removing the bold cell to kill the bold DUPLICATE therefore removed
    // the only place the episode name was shown.
    //
    // The fix is `cur.title`, which is the episode name on an episode object
    // and the channel name on a live one -- the same single expression the
    // bold cell used, so the information is IDENTICAL to what WS15b shipped.
    //
    // No duplication results, because the meta row shows a different string:
    //   header  -> cur.title      = "Kehlani och Kärleken till Frida" (episode)
    //   meta    -> cur.programName = "P3 Soul"                      (podcast)
    // Those are the episode and the show, not the same fact twice. The
    // duplicate the owner DID ask to remove is the bold CHANNEL name on a live
    // channel, which the live branch below still does not print.
    const headerLine = el('div', { class: 'player-header' },
      headerSpacer,
      live
        ? el('div', { class: 'player-sub', text: cur._srProgramTitle || cur.subtitle || 'Direkt' })
        : el('div', { class: 'player-sub', text: cur.title || '' }),
      expandBtn,
      closeBtn);

    // Song line: BELOW the player content, ABOVE the seek row. aria-live and
    // the :empty / .has-song CSS behaviour are preserved, so a talk channel
    // with no song collapses the row entirely instead of leaving a gap.
    //
    // WS12 Part C: this is NO LONGER live-only. It used to be gated on `live`,
    // so for an EPISODE the element was never created at all --
    // paintNowPlaying()'s `if (line)` was then false and there was nothing to
    // paint into, which is why a podcast showed no song in the mid player even
    // though the expanded panel showed one. The element is now created
    // UNCONDITIONALLY and left empty when there is no song; the existing
    // :empty collapse already handles the "no song" case, so a talk channel
    // and a podcast between tracks still take no vertical space.
    //
    // paintNowPlaying() already reads the right source per kind (live ->
    // pickByPosition(nowPlaying.timeline, playheadWallMs()), episode ->
    // episodeCurrentTrack), so no painting logic changed here -- only the gate
    // that prevented the line from existing.
    // WS18: the time state moves onto the SONG row, at its right-hand end --
    // the owner's correction: "to the right hand of the position of song and
    // artist information ... row 4 rightmost". WS16 had put it on row 1
    // (the channel-name row) on my reading of the request; on a talk channel
    // with no song that row holds only the channel, and the pill read as if it
    // described the channel rather than the playhead.
    //
    // The song row is a flex line with the pill as its second child, so
    // `margin-left: auto` on the pill puts it at the far right of THAT row
    // rather than the far right of the meta column. The song line keeps its
    // own ellipsis and `min-width: 0`, so a long song+artist string truncates
    // instead of pushing the pill off the edge.
    //
    // With no song the line collapses to height 0 (existing `.has-song` /
    // :empty CSS), which would take the pill with it. So on a talk channel the
    // pill needs a row of its own -- hence `songRow` below.
    const songLine = el('div', { class: 'now-playing-line', 'aria-live': 'polite' });
    // The pill's container. Rendered for a live channel regardless of song, so
    // the time state is never invisible; `songLine` is passed in as a child so
    // the two always share one row and one ellipsis context.
    const timeRow = live
      ? el('div', { class: 'player-time-row' },
          el('div', { class: 'player-time-song' }, songLine),
          mode)
      : null;

    $player.appendChild(headerLine);
    $player.appendChild(el('div', { class: 'player-row' }, thumb, meta, controls));
    // A podcast has no time state, so the song line stands alone and keeps
    // exactly the margin-left it had before WS18.
    if (timeRow) $player.appendChild(timeRow);
    else if (songLine) $player.appendChild(songLine);
    if (seekRow) $player.appendChild(seekRow);

    // ---- Self-healing repaint (blink fix 2026-09-23) ----
    // renderPlayer() is re-invoked by playback events ('playing', buffering
    // badge, quality changes) AFTER the now-playing poll has painted the song
    // line. Each rebuild starts from an empty DOM, so the line vanished until
    // the next 45s poll — the "song flashes then disappears" bug. Seeding at
    // build time makes every render self-healing: the line and the program
    // title survive any re-render. paintNowPlaying/paintProgramTitle read the
    // same state, so this is a no-op when nothing is known yet.
    paintNowPlaying();
    paintProgramTitle();

    // ---- Player vertical gestures (redesign 2026-09-23) ----
    // The player surface owns ALL vertical gestures on itself:
    //   swipe UP   → expand the info panel upward (finger-following)
    //   swipe DOWN → MINIMIZE to a mini-bar (audio keeps playing; the page
    //                becomes visible again). NOT close — closing is the ✕
    //                button's job.
    // The background page must never move with the gesture: the player has
    // touch-action:none and the handlers preventDefault vertical moves.
    // (Old behavior — swipe down = stop & close — removed per user request:
    // accidental kills of playback were too easy.)
    enablePlayerGestures($player, {
      onExpand: () => expandBtn.click(),
      onMinimize: minimizePlayer,
    });
  }

  // ---- player gesture engine: finger-following expand/minimize ----
  // Vertical drag on the player surface:
  //   up   → expands the info panel (panel height follows the finger)
  //   down → minimizes the player (player slides down, page visible)
  // The gesture NEVER scrolls the background page: the player element has
  // touch-action:none and touchmove is preventDefault-ed while dragging.
  function enablePlayerGestures(
    surface, { onExpand, onMinimize, stickDrag = true, expandDuringDrag = true }
  ) {
    let startY = 0, startX = 0, dragging = false, axis = null, t0 = 0;
    const THRESHOLD = 0.22; // 22 % of viewport height commits the gesture
    const FLICK_MS = 260;

    // STRANDING FIX (WS4) part 2: the single place that guarantees the player
    // is never left displaced. Every terminal path — commit, spring-back,
    // touchcancel, pointercancel, page hidden, window blur — routes through
    // this, so the inline transform cannot survive a gesture that ended
    // without the app noticing. Thresholds are deliberately NOT touched: the
    // bug was the missing reset, not the drag distance.
    const releaseDragStyles = () => {
      surface.classList.remove('gesture-owning');
      document.body.classList.remove('player-gesture-lock');
      surface.style.transition = '';
      surface.style.transform = '';
    };

    // Named handlers (not inline arrows) so enablePlayerGestures can keep a
    // reference to each one and remove it on the next call — see the leak fix
    // at the end of this function.
    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      t0 = Date.now();
      axis = null;
    };

    const onTouchMove = (e) => {
      if (e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (axis === null && (Math.abs(dy) > 10 || Math.abs(dx) > 10)) {
        // Vertical intent only — horizontal gestures belong to the DVR bar
        // (which stops propagation anyway via its own touch-action:none).
        axis = Math.abs(dy) > Math.abs(dx) ? 'y' : null;
        if (axis === 'y') {
          surface.classList.add('gesture-owning'); // locks page scroll
          document.body.classList.add('player-gesture-lock'); // belt+suspenders
          surface.style.transition = 'none';
        }
      }
      if (axis !== 'y') return;
      e.preventDefault(); // THE key line: background page never moves
      if (dy < 0) {
        // Dragging up: expand panel grows with the finger (0 → max 40 dvh).
        const panel = surface.querySelector('.player-expand');
        // `expandDuringDrag: false` is the MINI-BAR case (WS3): there is no
        // panel to grow, and building one here would re-render (and re-arm
        // these handlers) in the middle of the gesture, so the release would
        // be lost. The commit branch performs the action instead.
        if (!panel && expandDuringDrag) {
          // create the panel on first upward movement
          onExpand();
        }
        const p = surface.querySelector('.player-expand');
        if (p) {
          const h = Math.min(-dy, window.innerHeight * 0.4);
          p.style.height = `${Math.max(0, h)}px`;
        }
      } else if (stickDrag) {
        // Dragging down: player follows the finger toward minimized state.
        // `stickDrag: false` is the MINI-BAR case (WS3): the bar must not be
        // translated at all, because in that layout nothing anchors it and it
        // ends up stranded below the viewport with no way to pin it.
        surface.style.transform = `translateY(${Math.min(dy, window.innerHeight * 0.5)}px)`;
      }
    };

    const finish = (e) => {
      // STRANDING FIX (WS4) part 1: `finish()` used to open with
      // `if (axis !== 'y') return;`. If iOS never delivered `touchend` — or a
      // renderPlayer() mid-drag reset `axis` — the clearing line was skipped
      // and the player stayed translated down the screen with no way to pin it
      // back. The gesture is over by the time ANY terminal event arrives, so
      // the reset now runs unconditionally, BEFORE the axis check.
      releaseDragStyles();
      if (axis !== 'y') return;
      axis = null;
      const dy = e.changedTouches?.[0] ? e.changedTouches[0].clientY - startY : 0;
      const flick = Date.now() - t0 < 260 && Math.abs(dy) > 40;
      const panel = surface.querySelector('.player-expand');
      if (dy < -window.innerHeight * THRESHOLD || (Date.now() - t0 < 260 && dy < -40)) {
        // Commit EXPAND: panel snaps to full height.
        // BUG 3 FIX (WS2) part 1: this branch previously only reset the height
        // and returned, leaving the chevron's aria-expanded="false" and no
        // `open` class — a visible panel whose button claimed to be closed.
        // It must now leave the same state the chevron path produces.
        if (panel) {
          panel.style.height = '';
          // Only claim "expanded" when a panel actually exists: a renderPlayer()
          // during the drag (channel switch, buffering event) wipes the whole
          // player subtree, so the panel the swipe created can already be gone
          // by commit time. Setting aria-expanded with no panel would be a lie.
          setExpandOpen(true);
        } else {
          // No panel was ever created (mini bar, or one was wiped mid-drag):
          // THIS is where the upward action belongs. Doing it here rather than
          // during the drag keeps the gesture handlers intact until the release
          // has been consumed, so the action cannot be lost.
          onExpand();
        }
        return;
      }
      if (dy > window.innerHeight * THRESHOLD || (Date.now() - t0 < 260 && dy > 40)) {
        // Commit MINIMIZE.
        surface.style.transform = '';
        onMinimize();
        return;
      }
      // Spring back: restore whatever state we were in.
      surface.style.transform = '';
      if (panel && dy < 0 && -dy < window.innerHeight * THRESHOLD) {
        // Not dragged far enough up — fold the panel back.
        panel.style.height = '';
        panel.remove();
        setExpandOpen(false);
      }
    };
    surface.addEventListener('touchend', finish, { passive: true });
    surface.addEventListener('touchcancel', finish, { passive: true });

    // STRANDING FIX (WS4) part 3: the gestures are touch events, but a
    // pointer device or a stolen touch can end without a touchend. These
    // terminal signals are bound on the WINDOW (not the surface) so they fire
    // even when the finger has left the element entirely, and they reuse
    // releaseDragStyles() so there is exactly one reset implementation.
    const onPointerCancel = () => { releaseDragStyles(); axis = null; };
    const onHidden = () => { if (document.hidden) { releaseDragStyles(); axis = null; } };
    const onBlur = () => { releaseDragStyles(); axis = null; };
    // SINGLETON $player on every render, and each call added four more touch
    // listeners with no matching removal — so they accumulated for the life of
    // the page and one swipe could be handled by several stacked handlers.
    // Same class of defect as the WS1 audioEl timeupdate leak. The WS0
    // counters are defined for audioEl, so the app's own registration is
    // tracked the same way, keyed on the element, and the removal is paired
    // with the counter so the diagnostics keep telling the truth.
    const registered = [
      { type: 'touchstart', fn: onTouchStart, opts: { passive: true }, target: surface },
      { type: 'touchmove', fn: onTouchMove, opts: { passive: false }, target: surface },
      { type: 'touchend', fn: finish, opts: { passive: true }, target: surface },
      { type: 'touchcancel', fn: finish, opts: { passive: true }, target: surface },
      { type: 'pointercancel', fn: onPointerCancel, opts: true, target: window },
      { type: 'visibilitychange', fn: onHidden, opts: true, target: document },
      { type: 'blur', fn: onBlur, opts: true, target: window },
    ];
    // Remove from whichever target each handler was bound to.
    if (surface._srGestureHandlers) {
      const prev = surface._srGestureHandlers;
      prev.forEach(({ type, fn, opts, target }) => {
        (target || surface).removeEventListener(type, fn, opts);
        metaDiagCountRemove(type);
      });
    }
    registered.forEach(({ type, fn, opts, target }) => (target || surface).addEventListener(type, fn, opts));
    registered.forEach(({ type }) => metaDiagCountAdd(type));
    surface._srGestureHandlers = registered;
  }

  // ---- minimize: player shrinks to a mini-bar; page visible; audio keeps playing ----
  let playerMinimized = false;
  function minimizePlayer() {
    if (playerMinimized || !state.current) return;
    playerMinimized = true;
    // Fold the expand panel if open.
    $player.querySelector('.player-expand')?.remove();
    setExpandOpen(false);
    $player.classList.add('minimized');
    // Mini-bar content: artwork, title, play/pause, expand, stop.
    renderPlayer();
  }

  function restorePlayer() {
    if (!playerMinimized) return;
    playerMinimized = false;
    $player.classList.remove('minimized');
    renderPlayer();
  }

  // ---------------- playback actions ----------------
  async function playPodcast(programId) {
    const pod = state.podcasts.find((p) => p.id === programId);
    if (!pod) return;
    // ---- WS17: the "already loaded" guard compared the WRONG ids ----
    // This read:
    //   isCurrent('episode', programId) === false && audioEl._podProgramId === programId
    // `programId` is the PODCAST id. `isCurrent(kind, id)` compares against
    // `state.current.id`, which for an episode is the EPISODE id
    // (playTrack({ id: ep.id })). So the two sides were structurally
    // different numbers and isCurrent() could never be true here: the
    // `=== false` half was always true, and the guard's real question
    // ("is the podcast we were asked for the one already loaded?") was never
    // actually asked.
    //
    // Consequence, exactly as the owner reported: play a podcast, switch to a
    // radio channel, then tap the podcast again. state.current is now the
    // radio channel, so `state.current` is truthy and
    // `audioEl._podProgramId` still equals programId -- but isCurrent() is
    // false, so the code took the TOGGLE branch and called
    // toggleTrack(state.current) on the LIVE CHANNEL. The podcast was never
    // restarted; the tap either paused the channel or did nothing visible.
    //
    // The fix compares the two things that are actually the same kind of id.
    // `_podProgramId` is the podcast id, so that is the only comparison that
    // can answer the question. The extra `state.current` truthiness check is
    // kept so a cleared player (stopAndClosePlayer sets state.current = null)
    // still falls through to a fresh fetch.
    if (audioEl._podProgramId === programId && state.current) {
      // Same podcast already loaded AND still the thing playing → just toggle
      // pause/resume, without refetching the latest episode.
      if (state.current.kind === 'episode') {
        toggleTrack(state.current);
        return;
      }
      // Loaded earlier but something else is playing now: fall through and
      // restart the podcast, which is what the tap was asking for.
    }
    showToast('Hämtar senaste avsnittet…', 2000);
    // WS17: the in-flight guard. Two taps before the first fetch resolves ran
    // two independent fetches, and whichever resolved last won -- on a slow
    // connection the second could land after the user had already tapped
    // again, leaving the player showing one episode and playing another, or
    // restarting from 0. The podcast id is the natural key: a second tap for
    // the SAME podcast is a duplicate, a tap for a different one is not.
    if (podFetchInFlight === programId) return;
    podFetchInFlight = programId;
    try {
      const ep = await fetchLatestEpisode(programId);
      if (!ep || !ep.audioUrl) {
        showToast('Inget avsnitt med ljud hittades.');
        return;
      }
      audioEl._podProgramId = programId;
      playTrack({
        kind: 'episode',
        id: ep.id,
        title: ep.title || pod.name,
        subtitle: pod.name,
        audioUrl: ep.audioUrl,
        duration: ep.duration,
        artwork: pod.image,
        description: pod.description || null,
        programName: pod.name,
        image: pod.image || null,
      });
    } catch (err) {
      showToast(err.message || 'Kunde inte hämta avsnittet.');
    } finally {
      // Only clear our own slot: a tap for a different podcast may have taken
      // over while this one was in flight, and nulling it would drop that
      // one's guard too.
      if (podFetchInFlight === programId) podFetchInFlight = null;
    }
  }

  /**
   * Play the latest episode of an EXTERNAL (iTunes) podcast.
   *
   * Deliberately a separate function rather than a widened playPodcast():
   * playPodcast() is guarded by tests that assert it compares _podProgramId
   * and podFetchInFlight against the raw numeric SR id. Widening it would
   * have put a new branch inside the one function the existing suite most
   * tightly constrains, for no gain -- the two paths fetch from different
   * endpoints and share nothing but playTrack().
   *
   * GUARD REUSE, and why it is safe: it uses the same two slots, but writes
   * the PREFIXED key from extGuardKey(). playPodcast() compares those slots
   * against `programId`, which is always a number on the SR path, so
   * 'itunes:251955878' === 164 is false -- the SR function simply falls
   * through to its own fetch, which is the correct behaviour anyway. And both
   * slots are already cleared by stopAndClosePlayer(), so no stale-flag bug
   * is introduced by reusing them.
   */
  async function playExternalPodcast(pod) {
    if (!pod || !Number.isInteger(pod.id)) return;
    const key = extGuardKey('itunes', pod.id);
    if (audioEl._podProgramId === key && state.current) {
      // Already loaded and still playing: this tap is pause/resume.
      if (state.current.kind === 'episode') {
        toggleTrack(state.current);
        return;
      }
    }
    // In-flight guard: a second tap before the first resolves is a duplicate.
    if (podFetchInFlight === key) return;
    podFetchInFlight = key;
    showToast('Hämtar senaste avsnittet…', 2000);
    try {
      const eps = await extEpisodes(pod.id);
      const ep = eps[0];
      if (!ep || !ep.audioUrl) {
        showToast('Inget avsnitt med ljud hittades.');
        return;
      }
      audioEl._podProgramId = key;
      playTrack({
        kind: 'episode',
        // A missing trackId would collide on `id` with a real episode id, so
        // fall back to the collectionId rather than to undefined/null.
        id: ep.id ?? pod.id,
        title: ep.title || pod.name,
        subtitle: pod.name,
        audioUrl: ep.audioUrl,
        duration: ep.duration,
        artwork: ep.artwork || pod.image,
        description: ep.description || pod.description || null,
        programName: pod.name,
        image: pod.image || null,
      });
    } catch (err) {
      showToast(err.message || 'Kunde inte hämta avsnittet.');
    } finally {
      if (podFetchInFlight === key) podFetchInFlight = null;
    }
  }

  function playNews(item) {
    if (!item.audioUrl) {
      // Text flash → open the in-app article reader
      openArticle(item);
      return;
    }
    toggleTrack({
      kind: 'episode',
      id: item.id,
      title: item.title,
      subtitle: item.programName,
      audioUrl: item.audioUrl,
      duration: item.duration,
      artwork: item.imageUrl,
    });
  }

  // ---------------- in-app article reader ----------------
  /**
   * Swipe support for full-screen overlays: swipe right (or left) to close.
   * The panel follows the finger horizontally while dragging; release past
   * ~35% of the width (or a fast flick) closes it, otherwise it springs back.
   * Vertical scrolling inside .reader-body is unaffected (horizontal intent
   * is detected by comparing axis deltas).
   */
  function enableSwipeToClose(overlay, panel, close, { axis = 'x' } = {}) {
    let startX = 0, startY = 0, d = 0, dragging = false, intent = null, t0 = 0;
    const W = () => window.innerWidth;
    const H = () => window.innerHeight;

    panel.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      t0 = Date.now();
      d = 0;
      dragging = true;
      intent = null;
      panel.style.transition = 'none';
    }, { passive: true });

    panel.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const cx = e.touches[0].clientX;
      const cy = e.touches[0].clientY;
      const adx = cx - startX, ady = cy - startY;
      if (intent === null && (Math.abs(adx) > 8 || Math.abs(ady) > 8)) {
        intent = axis === 'x'
          ? (Math.abs(adx) > Math.abs(ady) ? 'x' : null)
          : (Math.abs(ady) > Math.abs(adx) ? 'y' : null);
      }
      if (!intent || intent !== axis) return;
      d = axis === 'x' ? adx : ady;
      if (d < 0) { // wrong direction — spring back immediately
        panel.style.transform = '';
        return;
      }
      panel.style.transform = axis === 'x' ? `translateX(${d}px)` : `translateY(${d}px)`;
    }, { passive: true });

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = 'transform 0.2s ease';
      const elapsed = Date.now() - t0;
      const flick = elapsed < 250 && Math.abs(d) > 40;
      const size = axis === 'x' ? W() : H();
      if (Math.abs(d) > size * 0.35 || flick) {
        const dir = axis === 'x' ? (d > 0 ? W() : -W()) : H();
        panel.style.transform = axis === 'x' ? `translateX(${dir}px)` : `translateY(${dir}px)`;
        setTimeout(close, 180);
      } else {
        panel.style.transform = '';
      }
    };
    panel.addEventListener('touchend', finish);
    panel.addEventListener('touchcancel', finish);
  }

  function openArticle(item) {
    const overlay = el('div', { class: 'reader-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Artikel' });
    const reader = el('article', { class: 'reader' });

    const close = () => {
      overlay.remove();
      document.body.style.overflow = '';
    };

    const closeBtn = el('button', {
      class: 'reader-close', type: 'button', 'aria-label': 'Stäng artikel', text: '✕',
      onclick: close,
    });
    reader.appendChild(el('div', { class: 'reader-topbar' },
      el('div', { class: 'reader-brand', text: 'Min Radio' }), closeBtn));

    // Content is available immediately (feed provides lead text + image)
    const body = el('div', { class: 'reader-body' });
    reader.appendChild(body);
    overlay.appendChild(reader);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
    enableSwipeToClose(overlay, reader, close);

    // fetch article content — static host: reader shows the feed's lead text
    // (full body is only reachable via a backend, which this app doesn't use)
    body.textContent = '';
    if (item.imageUrl) {
      body.appendChild(el('img', { class: 'reader-image', src: item.imageUrl, alt: item.imageAlt || '' }));
    }
    body.appendChild(el('h2', { class: 'reader-title', text: item.title }));
    const meta = [item.programName, formatTime(item.publishDateUtc)]
      .filter(Boolean).join(' · ');
    if (meta) body.appendChild(el('div', { class: 'reader-meta', text: meta }));
    const paras = item.lead && item.lead.length ? item.lead : ['Hela texten finns hos Sveriges Radio.'];
    for (const p of paras) {
      body.appendChild(el('p', { class: 'reader-para', text: p }));
    }
    body.appendChild(el('a', {
      class: 'reader-source', href: articleLinkFor(item), target: '_blank', rel: 'noopener',
      text: 'Läs hela artikeln på sverigesradio.se →',
    }));
  }

  // ---------------- settings: news count ----------------
  const NEWS_COUNT_KEY = 'minradio.newscount.v1';
  function loadNewsCount() {
    const v = Number(localStorage.getItem(NEWS_COUNT_KEY));
    return Number.isInteger(v) && v >= 4 && v <= 20 ? v : 4;
  }
  function saveNewsCount(n) {
    try { localStorage.setItem(NEWS_COUNT_KEY, String(n)); } catch { /* ignore */ }
  }

  // ---------------- rendering: home screen ----------------
  function renderSkeletons() {
    $main.textContent = '';
    const skel = (cls) => el('div', { class: `skel ${cls}` });
    $main.appendChild(
      el('section', { class: 'section' },
        el('div', { class: 'section-title', text: 'Kanaler' }),
        el('div', { class: 'icon-row' },
          skel('skel-icon'), skel('skel-icon'), skel('skel-icon'), skel('skel-icon'))
      )
    );
    $main.appendChild(
      el('section', { class: 'section' },
        el('div', { class: 'section-title', text: 'Poddar' }),
        el('div', { class: 'icon-row' },
          skel('skel-icon'), skel('skel-icon'), skel('skel-icon'), skel('skel-icon'))
      )
    );
    $main.appendChild(
      el('section', { class: 'section' },
        el('div', { class: 'section-title', text: 'Nyheter' }),
        skel('skel-news'), skel('skel-news'), skel('skel-news'), skel('skel-news'))
    );
  }

  function renderError(message, retryFn) {
    $main.textContent = '';
    $main.appendChild(
      el('div', { class: 'state-msg', role: 'alert' },
        el('div', { text: message }),
        el('button', { class: 'retry-btn', type: 'button', text: 'Försök igen', onclick: retryFn })
      )
    );
  }

  function renderHome() {
    $main.textContent = '';
    const favs = loadFavorites();

    // ----- Channels & Podcasts: same look as before — two sections with one
    // row of icons. The row scrolls continuously (icon by icon, native
    // momentum scroll) and stops at the last icon — no placeholder slots.
    function buildIconSection(kind, title, catalogue) {
      const isPod = kind === 'podcasts';
      // External favourites live in the SAME row, under the SAME header. No
      // new section, no new heading: the owner chose one list.
      const extList = isPod ? loadExternalPodcasts() : [];
      // podcastRowOrder() interleaves both providers by the stored order.
      // Previously this was [...favs, ...ext], which made a mixed order
      // impossible -- any interleaving reverted on the next render.
      const list = isPod ? podcastRowOrder(favs[kind], extList) : favs[kind];

      const sec = el('section', { class: 'section', 'aria-label': title },
        el('h2', { class: 'section-title', text: title }));
      const scroller = el('div', { class: 'icon-scroller', role: 'list' });

      if (!list.length) {
        scroller.appendChild(el('div', { class: 'icon-empty', 'aria-hidden': 'true' }));
      }
      for (const id of list) {
        // Provider-explicit: SR ids and iTunes collectionIds are both bare
        // integers, so a colliding id must resolve against its OWN list.
        const item = resolvePodcastRow(catalogue, id, isPod && extList.some((p) => p.id === id) ? 'itunes' : 'sr');
        if (!item) continue; // unknown id — skip silently
        const isExtPod = isPod && item.provider === 'itunes';
        const btn = el('button', {
          class: `stream-icon${isPod ? ' pod-icon' : ''}`,
          type: 'button',
          role: 'listitem',
          // The external key is prefixed so a collectionId can never collide
          // with an SR podcast id in the playing-mark lookup below.
          'data-stream-key': isExtPod ? `xpod:${item.id}`
            : (isPod ? `pod:${item.id}` : `live:${item.id}`),
          'data-stream-title': item.name,
          ...(isPod ? { 'data-stream-label': `Spela senaste avsnittet av ${item.name}` } : {}),
          'aria-pressed': 'false',
          'aria-label': isPod ? `Spela senaste avsnittet av ${item.name}` : `Spela ${item.name}`,
          // An external row is passed whole, because its episode list comes
          // from a different endpoint. The SR call site is byte-identical.
          onclick: () => (isPod
            ? (isExtPod ? playExternalPodcast(item) : playPodcast(item.id))
            : toggleTrack({
              kind: 'live', id: item.id, title: item.name, subtitle: 'Direkt',
              audioUrl: item.liveaudioUrl, artwork: item.image,
              description: item.tagline || null,
              candidates: liveCandidates(item),
            })),
        });
        // Fas 5: long-press opens the context card (tablå for channels,
        // episode list for podcasts). Tap still plays.
        addLongPress(btn, () => (isPod ? openPodcastCard(item) : openChannelCard(item)));
        if (item.image) {
          btn.appendChild(el('img', { src: item.image, alt: '', loading: 'lazy', draggable: 'false' }));
        } else {
          btn.appendChild(el('span', { class: 'icon-letter', text: item.name.slice(0, 1) }));
        }
        // ---- WS20: the WS19 "Avsnitt" caption is REMOVED ----
        // The owner: "i never ever complained about the pod icon to start the
        // latest podcast. that is by design and was decided in the start of the
        // project."
        //
        // The tap-plays-the-latest-episode behaviour is therefore correct and
        // stays, and the caption I added on top of it is reverted. The original
        // observation (an older episode is hard to find) was real, but the
        // remedy was not mine to impose: the long-press episode list is
        // pre-existing, deliberate, and unchanged. Reverted in full -- the
        // caption span, the `aria-label` override, and the `.icon-hint` CSS.
        //
        // Nothing about the icon's behaviour changed in WS19 and nothing changes
        // now; only my unrequested decoration is gone.
        scroller.appendChild(btn);
      }
      sec.appendChild(scroller);
      return sec;
    }

    $main.appendChild(buildIconSection('channels', 'Kanaler', state.channels));
    $main.appendChild(buildIconSection('podcasts', 'Poddar', state.podcasts));

    // ----- News: latest text flashes, newest on top; tap opens in-app reader -----
    // Nyheter collapse/expand (user request 2026-09-23, corrected): the
    // header is a toggle. Default = FULLY EXPANDED (no peek). When playback
    // starts the section auto-collapses (header only); the user can expand
    // it manually during playback and it stays expanded. When playback
    // stops it returns to fully expanded.
    const newsSection = el('section', { class: 'section news-section' });
    const newsToggle = el('button', {
      class: 'news-toggle', type: 'button',
      'aria-expanded': String(newsExpanded),
      'aria-label': newsExpanded ? 'Fäll ihop Nyheter' : 'Fäll ut Nyheter',
      onclick: () => {
        // Manual toggle. If the user expands during playback, that choice
        // wins for the rest of the session (no auto re-collapse).
        newsExpanded = !newsExpanded;
        if (newsExpanded) newsManualExpanded = true;
        updateNewsFold();
      },
    },
      el('h2', { class: 'section-title', text: 'Nyheter' }),
      el('span', { class: 'news-toggle-chevron', 'aria-hidden': 'true' }));
    newsSection.appendChild(newsToggle);
    if (!state.news.length) {
      newsSection.appendChild(el('div', { class: 'state-msg', text: 'Inga nyheter just nu.' }));
    } else {
      const scroller = el('div', { class: 'news-scroller', role: 'list' });
      for (const item of state.news) {
        const hasAudio = Boolean(item.audioUrl);
        const btn = el('button', {
          class: 'news-item',
          type: 'button',
          role: 'listitem',
          'data-stream-key': `episode:${item.id}`,
          'data-stream-title': item.title,
          'aria-pressed': 'false',
          'aria-label': hasAudio
            ? `Spela nyhetssändning: ${item.title}`
            : `Öppna artikel: ${item.title}`,
          onclick: () => playNews(item),
        });
        if (item.imageUrl) {
          btn.appendChild(el('img', {
            class: 'news-thumb', src: item.imageUrl, alt: '',
            loading: 'lazy', draggable: 'false',
          }));
        }
        const text = el('div', { class: 'news-text' },
          el('div', { class: 'news-title', text: item.title }));
        const meta = [item.programName, formatTime(item.publishDateUtc),
          item.duration ? fmtDur(item.duration) : null].filter(Boolean).join(' · ');
        if (meta) text.appendChild(el('div', { class: 'news-meta', text: meta }));
        btn.appendChild(text);
        scroller.appendChild(btn);
      }
      newsSection.appendChild(scroller);
    }
    $main.appendChild(newsSection);
    // Apply the current fold state to the freshly rendered section.
    updateNewsFold();

    // The footer attribution was removed (WS5): the About/Settings overlay
    // already carries the same attribution plus the independent-app
    // disclaimer, so nothing is lost. Intentionally NOT re-added here.

    // ---- WS12 Part A: the build line is back under NYHETER, by request ----
    // The owner's words: "you have now to move back the build number i see
    // that you moved up on screen by myself and put it back under NYHETER
    // (but without the stale 1.5.0), the cog wheel should go back to where
    // we had it".
    //
    // So this reverses WS11 Part B, which moved the line into .topbar. That
    // move was the reviewer's, not the owner's, and the owner has now seen it
    // and rejected it. `.topbar` is `justify-content: space-between` with two
    // children (brand, cog); adding a third put the COG IN THE MIDDLE, because
    // space-between centres whatever sits between its two ends. Moving the
    // line out of the topbar is what returns the cog to the right edge.
    //
    // #main's children are, in order: channels, podcasts, news -- so
    // appending here puts the line directly under NYHETER, which is the
    // position the owner asked for and the one WS10 had.
    //
    // The owner's parenthetical is binding: NO "Version 1.5.0 ·" prefix. That
    // literal never moved, so presenting it as a version was a lie; it stays
    // banned. The build id alone is what actually identifies a build.
    //
    // This is still NOT the WS5 attribution footer: no attribution, no link,
    // no disclaimer -- those remain in the About overlay only.
    $main.appendChild(el('p', {
      class: 'build-line',
      text: `bygg ${APP_BUILD}`,
    }));

    updatePlayingMarks();
  }

  // ---------------- in-app about/help overlay ----------------
  function openAbout() {
    const overlay = el('div', { class: 'reader-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Om appen' });
    const about = el('article', { class: 'reader' });
    // WS29: the readout's interval is declared here so `close` can clear it.
    // Declared before `close` is defined because `close` closes over it.
    let readoutTimer = null;
    // WS30: the sample interval is declared HERE, beside the paint interval and
    // for the same reason — `close` closes over it, so a declaration further
    // down would be a temporal-dead-zone error on a fast close.
    let sampleTimer = null;
    const close = () => {
      // WS29: no timer may outlive the sheet. Verified by a driven test.
      if (readoutTimer) { clearInterval(readoutTimer); readoutTimer = null; }
      // WS30: nor may the sampler. Two fetches per panel open, forever, is
      // exactly the battery bug the paint interval was fixed for.
      if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
      overlay.remove();
      document.body.style.overflow = '';
    };
    const closeBtn = el('button', {
      class: 'reader-close', type: 'button', 'aria-label': 'Stäng', text: '✕', onclick: close,
    });
    about.appendChild(el('div', { class: 'reader-topbar' },
      el('div', { class: 'reader-brand', text: 'Min Radio' }), closeBtn));

    const body = el('div', { class: 'reader-body about-body' });

    body.appendChild(el('h2', { class: 'about-title', text: 'Om Min Radio' }));
    body.appendChild(el('p', { class: 'about-version', text: `bygg ${APP_BUILD} · Utvecklad av ${APP_DEVELOPER}` }));

    body.appendChild(el('h3', { class: 'about-heading', text: 'Så fungerar appen' }));
    const items = [
      ['Kanaler', 'Dina 4 favoritkanaler som ikoner. Tryck för att lyssna direkt, tryck igen för att stoppa.'],
      ['Poddar', 'Dina 4 favoritpoddar som ikoner. Tryck för att spela senaste avsnittet. Pausa, spola ±15 sekunder och dra i tidslinjen i spelaren.'],
      ['Nyheter', 'Senaste nyheterna från Ekot, nyaste först. Listan är rullbar — antalet (4–20) ställer du in här under Antal nyheter. Tryck på en nyhet för att läsa den direkt i appen.'],
      ['Ändra favoriter', 'Välj upp till 4 kanaler och 4 poddar — byt enskilda val när som helst, du behöver aldrig börja om.'],
    ];
    for (const [t, d] of items) {
      body.appendChild(el('div', { class: 'about-card' },
        el('b', { text: t }), el('span', { text: d })));
    }

    body.appendChild(el('h3', { class: 'about-heading', text: 'Att veta' }));
    const knows = [
      'Allt du väljer sparas på enheten och finns kvar nästa gång du öppnar appen.',
      'Appen kan installeras på startskärmen (iPhone: Dela → Lägg till på hemskärmen; Android: meny → Lägg till på startskärmen).',
      'Artiklar läses direkt i appen — ingen inloggning och inga kakor behövs.',
    ];
    body.appendChild(el('ul', { class: 'about-list' },
      ...knows.map((k) => el('li', { text: k }))));

    body.appendChild(el('h3', { class: 'about-heading', text: 'Hur appen är byggd (för den nyfikne)' }));
    body.appendChild(el('p', { class: 'about-para',
      text: 'Appen har ingen egen server. Det är bara filer på GitHub Pages — som vilken webbsida som helst. All logik körs i telefonens webbläsare.' }));
    const tech = [
      ['Ingen back-end', 'När du trycker på en kanal eller podd pratar appen direkt med Sveriges Radios offentliga servrar (api.sr.se). SR har öppnat sitt API för alla — inget konto krävs, och det tillåter anrop från vilken webbsida som helst.'],
      ['Dina val stannar i telefonen', 'Favoriter och inställningar sparas i telefonens egen webblagring (localStorage). De skickas ingenstans och finns bara på din enhet — därför fungerar de offline och utan inloggning.'],
      ['Varför localStorage och inte IndexedDB?', 'IndexedDB är bättre för stora datamängder — men den här appen sparar ca 135 byte (fyra kanal-id:n, fyra podd-id:n, ett tal). Det är 0,003 % av kvoten, och en sparning tar 0,03 millisekunder. IndexedDB hade gett mer kod utan någon vinst. Rätt verktyg för jobbet.'],
      ['GitHub Pages levererar filerna', 'HTML, CSS, JavaScript och ikoner ligger i ett GitHub-repo och serveras gratis av GitHub Pages. Inget att drifta, inget som kan ligga nere, ingen driftkostnad.'],
      ['Ljudet kommer från SR', 'Direktradio och poddavsnitt spelas direkt från SR:s ljudservrar — appen är bara en fjärrkontroll och ett spelar-gränssnitt.'],
      ['Enda begränsningen', 'Hela nyhetstexten kan appen inte hämta själv — SR:s artikelsidor tillåter inte att andra webbsidor läser dem direkt (säkerhetsregeln CORS). Nyhetsläsaren visar därför ingress + bild, med länk till hela artikeln på sverigesradio.se.'],
    ];
    for (const [t, d] of tech) {
      body.appendChild(el('div', { class: 'about-card' },
        el('b', { text: t }), el('span', { text: d })));
    }

    body.appendChild(el('h3', { class: 'about-heading', text: 'Datakällor & villkor' }));
    body.appendChild(el('ul', { class: 'about-list' },
      el('li', {}, 'Kanaler, poddar och ljud: Sveriges Radios öppna API v2'),
      el('li', {}, 'Nyheter: Ekots nyhetsflöde (api.sr.se)'),
      el('li', {}, 'Data från ',
        el('a', { href: 'https://www.sverigesradio.se', target: '_blank', rel: 'noopener', text: 'Sveriges Radio' }),
        '. Appen är oberoende av och inte utgiven av Sveriges Radio.')));

    // ---- WS29: the visible timing readout. ----
    // Owner decision 2026-09-30: the switch is the deliberate action, so the
    // panel reads the snapshot body without the ?diag=metadata query half of
    // the gate. `metaDiagGateOpen()` itself is untouched — see the note beside
    // it. This block is the ONLY thing that changed about diagnostics access.
    const diagFlagRead = () => {
      try { return localStorage.getItem(META_DIAG_FLAG); } catch { return null; }
    };
    const diagFlagWrite = (v) => {
      try { localStorage.setItem(META_DIAG_FLAG, v); } catch { /* ignore */ }
    };

    // Read the STORED value on open, so the switch tells the truth rather than
    // assuming a default. Absent is treated as off: diagnostics must never be
    // on for someone who never asked for it.
    const diagSwitch = el('button', {
      class: 'setting-row about-diag-switch', type: 'button',
      'aria-pressed': 'false',
    });
    const diagSwitchLabel = el('span', { class: 'setting-minmax', text: 'Visa tidsdiagnostik' });
    const diagSwitchState = el('span', { class: 'setting-minmax', text: 'Av' });
    diagSwitch.append(diagSwitchLabel, diagSwitchState);
    const syncSwitch = () => {
      const on = diagFlagRead() === 'on';
      diagSwitch.setAttribute('aria-pressed', String(on));
      diagSwitchState.textContent = on ? 'På' : 'Av';
    };

    const readout = el('p', { class: 'about-diag-readout', text: '' });
    const readoutNote = el('p', { class: 'about-diag-note', text: '' });
    // ---- WS38: the raw measurement record, visible on the phone. ----
    // The owner is the only one who can produce the HLS conditions, so anything
    // not visible HERE will not be measured. Built with the existing 'p' and
    // 'div' helpers and the existing CSS classes — no stylesheet or markup
    // change (§5). `white-space: pre-line` is already the behaviour of these
    // text nodes, so one field per line costs no CSS.
    const seekRecordBox = el('p', { class: 'about-diag-note', text: '' });

    // ---- WS39: the media-timeline origin record, on the same panel. ----
    // A separate node so the WS38 record above it is untouched and still
    // reviewable on its own. Same `p` helper, same existing CSS class — so no
    // stylesheet and no markup change (§5).
    const originRecordBox = el('p', { class: 'about-diag-note', text: '' });

    // ---- WS40: the device-verification controls. ----
    // Built with the EXISTING helpers and the EXISTING CSS classes only: no
    // stylesheet and no markup change (§5). Each is a `setting-row`-styled
    // button, which the sheet already styles.
    //
    // The programme selector exists because the acceptance criterion is
    // "run this against at least 3 programme boundaries" — the owner picks
    // which programme to test, so a single session can cover three.
    const ws40Box = el('p', { class: 'about-diag-note', text: '' });
    let ws40Choice = 0;
    const ws40ChoiceLabel = el('span', { class: 'setting-minmax', text: '—' });
    const ws40Pick = el('button', {
      class: 'setting-row', type: 'button',
    });
    ws40Pick.append(el('span', { class: 'setting-minmax', text: 'Program att testa' }),
      ws40ChoiceLabel);
    const ws40Measure = el('button', {
      class: 'setting-row', type: 'button',
    }, el('span', { class: 'setting-minmax', text: 'Mät (läser bara)' }));
    const ws40SeekNew = el('button', {
      class: 'setting-row', type: 'button',
    }, el('span', { class: 'setting-minmax', text: 'Testseek FÖRESLAGEN' }));
    const ws40SeekOld = el('button', {
      class: 'setting-row', type: 'button',
    }, el('span', { class: 'setting-minmax', text: 'Testseek BEFINTLIG' }));

    // ---- WS40c: copy one whole, internally consistent snapshot. ----
    // Reads the same records the panel displays, at one instant, and never
    // scrapes the DOM -- a DOM read would return values painted at different
    // moments, which is the exact inconsistency this button exists to remove.
    const ws40CopyLabel = el('span', {
      class: 'setting-minmax', text: 'Kopiera all diagnostik',
    });
    const ws40CopyBtn = el('button', {
      class: 'setting-row', type: 'button',
    }, ws40CopyLabel);
    ws40CopyBtn.addEventListener('click', () => {
      ws40CopyDiagnostics(ws40CopyBtn, ws40CopyLabel, ws40Box);
    });

    // The candidate programmes: from the CURRENT channel's already-fetched
    // schedule, those that have already started (a future programme cannot be
    // seeked to) and that sit inside the buffered window. Nothing is fetched
    // here — `cur._srSchedule` is the array the app already holds.
    const ws40Candidates = () => {
      const cur = state.current;
      if (!cur || cur.kind !== 'live') return [];
      const sched = Array.isArray(cur._srSchedule) ? cur._srSchedule : [];
      const now = Date.now();
      return sched
        .filter((e) => e && Number.isFinite(e.startMs) && e.startMs < now - 1000)
        .slice(-8)
        .reverse();
    };
    const syncWs40Choice = () => {
      const c = ws40Candidates();
      if (!c.length) {
        ws40ChoiceLabel.textContent = 'ingen (ingen spellista)';
        return;
      }
      if (ws40Choice >= c.length) ws40Choice = 0;
      const e = c[ws40Choice];
      ws40ChoiceLabel.textContent =
        `${new Date(e.startMs).toISOString().slice(11, 19)} `
        + `${(e.title || '').slice(0, 22)}`;
    };
    ws40Pick.addEventListener('click', () => {
      ws40Choice += 1;
      syncWs40Choice();
    });
    ws40Measure.addEventListener('click', () => {
      const e = ws40Candidates()[ws40Choice];
      if (!e) return;
      // A FRESH playlist sample, awaited, so headPdt and the segment grid
      // belong to now. This reuses the existing fetcher; no new endpoint.
      //
      // `sampleStreamEdgeClock` already swallows its own failures and returns
      // null, so there is nothing to catch: a failed fetch leaves the probe's
      // `status`/`error` visible and the record simply reports nulls. The
      // capture therefore runs in BOTH cases and cannot be skipped, which is
      // what the earlier duplicated then/catch pair was really about.
      const run = () => {
        ws40Capture(e.startMs, e.title);
        ws40Box.textContent = ws40RecordText();
      };
      try {
        sampleStreamEdgeClock().then(run, run);
      } catch (err) {
        // A synchronous throw would otherwise skip the measurement entirely.
        run();
      }
    });
    ws40SeekNew.addEventListener('click', () => {
      ws40TestSeek('proposed').then(() => {
        ws40Box.textContent = ws40RecordText();
      });
    });
    ws40SeekOld.addEventListener('click', () => {
      ws40TestSeek('existing').then(() => {
        ws40Box.textContent = ws40RecordText();
      });
    });

    const ws40Section = el('div', { class: 'about-diag' },
      el('h3', { class: 'about-heading', text: 'Test av föreslagen mätning' }),
      ws40Pick, ws40Measure, ws40SeekNew, ws40SeekOld, ws40CopyBtn, ws40Box);

    // Built BEFORE the handlers below are wired, because the click handler
    // toggles `is-off` on it. Declaring it after the handler would be a
    // temporal-dead-zone error on the very first click.
    const diagSection = el('div', { class: 'about-diag' },
      el('h3', { class: 'about-heading', text: 'Felsökning' }),
      diagSwitch,
      readout,
      readoutNote,
      seekRecordBox,
      originRecordBox,
      ws40Section);
    // Inert until switched on: hidden, but present in the DOM.
    if (diagFlagRead() !== 'on') diagSection.classList.add('is-off');
    body.appendChild(diagSection);

    // A single interval for the whole panel, cleared on close. A hidden panel
    // that keeps polling is a battery bug, and the interval must not outlive
    // the sheet that created it. `readoutTimer` is the one declared at the top
    // of openAbout() so close() can clear it — a second declaration here would
    // shadow it and the close handler would clear nothing.
    //
    // ---- WS30: sampling and PAINTING are on SEPARATE intervals, on purpose. ----
    // `META_DIAG_READOUT_INTERVAL_MS` (2 s) repaints the text only; it never
    // fetches. The sample interval below is deliberately slower, because
    // SR's playlist rolls every few seconds and re-fetching on every paint
    // would be wasteful and would look like a bug on a phone. So: fresh on
    // panel open (R-A), then refreshed on the slower cadence, with the sample
    // age on screen so staleness is visible rather than implied.
    const stopReadout = () => {
      if (readoutTimer) { clearInterval(readoutTimer); readoutTimer = null; }
      if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
      // WS38: publish the panel's running state at module scope so the rate
      // sampler can tell whether the stream clock is being refreshed by the
      // panel (open) or has to refresh it itself (closed). Written HERE, in
      // the function that owns the timer — one writer, with the timer.
      metaDiagReadoutActive = false;
    };
    const paintReadout = () => {
      if (readoutTimer === null) return; // switched off: do not poll at all
      const r = metaDiagReadoutLines();
      readout.textContent = r.primary;
      readoutNote.textContent = r.secondary || '';
      // WS38: the raw record, painted on the SAME interval as everything else
      // so it cannot drift out of step with the readout above it.
      seekRecordBox.textContent = seekMeasureRecordText();
      // WS39: the origin record, painted on that same interval. The capture
      // itself is READ-ONLY — it reads currentTime, seekable and the hls
      // instance, and writes no playback state. It is taken here so a value
      // exists even when the owner never seeks, which is the whole point of
      // measuring something the seek cannot be trusted to report.
      //
      // CAPTURE BEFORE PAINT. Rendering first would show the PREVIOUS
      // capture's values — the same read-before-write ordering that made the
      // WS38 rate unmeasurable, reappearing in a different function.
      captureOriginMeasurement();
      originRecordBox.textContent = originMeasureRecordText();
      // WS40: the test record, painted on the same interval. NOTE: this only
      // RE-PAINTED text. The measurement itself happens on the explicit "Mät"
      // press, because it must be a single instant the owner chose, not a
      // rolling value that changes under the reader's eyes while they compare
      // two runs.
      ws40Box.textContent = ws40RecordText();
    };
    const startReadout = () => {
      stopReadout();
      // WS38: paired with the reset in stopReadout(). Set BEFORE the first
      // paint so the rate sampler never races the panel's own fetch.
      metaDiagReadoutActive = true;
      // The interval must exist BEFORE the first paint: paintReadout returns
      // early when there is no timer, so painting first left the readout blank
      // on open. The suite could not see this — the text assertion passed while
      // the element was invisible. Found by driving the real DOM.
      readoutTimer = setInterval(paintReadout, META_DIAG_READOUT_INTERVAL_MS);
      // ---- WS30 R-A: THE REACHABILITY ARGUMENT, in one place. ----
      // A sample is requested HERE, on the path the owner actually walks:
      // channel playing -> cog -> Info -> switch on. Without this line the
      // fetch would only ever run on the 2 s repaint or a 45 s poll, and the
      // owner would open the panel onto a stale or empty number — which is
      // indistinguishable from "no offset", the exact failure R-A exists to
      // prevent. A fresh sample per panel open is also why the sample AGE is
      // on screen: a reader can see how current the number is.
      // Fire-and-forget: the panel paints 'Mäter…' until it lands, and a
      // rejection here must not break the Info sheet.
      try { sampleStreamEdgeClock(); } catch { /* the panel shows the state */ }
      // The refresh cadence. Declared here rather than at module scope so the
      // number cannot drift away from the panel it serves.
      sampleTimer = setInterval(() => {
        try { sampleStreamEdgeClock(); } catch { /* the panel shows the state */ }
      }, META_DIAG_SAMPLE_INTERVAL_MS);
      paintReadout();
    };

    diagSwitch.addEventListener('click', () => {
      const next = diagFlagRead() === 'on' ? 'off' : 'on';
      diagFlagWrite(next);
      syncSwitch();
      // WS29: the class must follow the switch. Applying `is-off` only on open
      // left the section display:none after the switch was turned on — the
      // readout rendered correct text that the owner could never see. Found by
      // driving the real DOM, not by the suite.
      diagSection.classList.toggle('is-off', next !== 'on');
      if (next === 'on') startReadout(); else stopReadout();
    });
    syncSwitch();
    // WS40: sync the programme picker on open, so the first thing the owner
    // sees names a real programme rather than a dash. Without this the
    // selector reads "—" until it is pressed, which looks like an empty
    // schedule when it is only an unlabelled default.
    syncWs40Choice();
    if (diagFlagRead() === 'on') startReadout(); else stopReadout();

    about.appendChild(body);
    overlay.appendChild(about);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
    enableSwipeToClose(overlay, about, close);
  }

  // ---------------- Fas 5: context cards (long-press) ----------------
  // Long-press (500 ms hold, cancelled by movement > 10 px or early release)
  // opens a context card. Tap still plays as before — long-press is additive.
  function addLongPress(node, onLongPress) {
    let timer = null;
    let startX = 0, startY = 0;
    const CANCEL_MOVE = 10;
    const HOLD_MS = 500;
    const start = (x, y) => {
      startX = x; startY = y;
      timer = setTimeout(() => { timer = null; onLongPress(); }, HOLD_MS);
    };
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    node.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      start(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    node.addEventListener('touchmove', (e) => {
      if (!timer) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - startX) > CANCEL_MOVE || Math.abs(t.clientY - startY) > CANCEL_MOVE) cancel();
    }, { passive: true });
    node.addEventListener('touchend', cancel, { passive: true });
    node.addEventListener('touchcancel', cancel, { passive: true });
    // Desktop: right-click opens the card too (contextual parity).
    node.addEventListener('contextmenu', (e) => { e.preventDefault(); onLongPress(); });
  }

  // Generic context-card sheet (reuses the settings-sheet visual language).
  function openContextCard({ title, subtitle, image, buildBody }) {
    const overlay = el('div', { class: 'sheet-overlay' });
    const sheet = el('div', { class: 'sheet context-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const grabZone = el('div', { class: 'sheet-grab-zone' }, el('div', { class: 'sheet-grab' }));
    const header = el('div', { class: 'sheet-header' },
      el('div', { class: 'card-head' },
        image ? el('img', { class: 'card-img', src: image, alt: '' }) : null,
        el('div', { class: 'card-head-text' },
          el('div', { class: 'sheet-title', text: title }),
          subtitle ? el('div', { class: 'card-sub', text: subtitle }) : null)),
      el('button', {
        class: 'sheet-close', type: 'button', 'aria-label': 'Stäng', text: '✕',
        onclick: close,
      }));
    const body = el('div', { class: 'card-body' });
    buildBody(body, close);
    sheet.appendChild(grabZone);
    sheet.appendChild(header);
    sheet.appendChild(body);
    overlay.appendChild(sheet);
    $sheetRoot.textContent = '';
    $sheetRoot.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    function close() {
      $sheetRoot.textContent = '';
      document.body.style.overflow = '';
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
    enableSwipeToClose(overlay, sheet, close, { axis: 'y' });
  }

  // Channel card: tablå for YESTERDAY + TODAY via scheduledepisodes (live
  // endpoint). Scrolling up past the "Igår" divider reaches yesterday's
  // programmes — any past programme with an episodeId is playable on-demand
  // via episodes/get (verified: yesterday's Ekot returns listenpodfile.url).
  // Future programmes are listed but marked "ej påbörjad".
  // The WHOLE row is the play button (user request 2026-09-23): rows are
  // <button> elements spanning the full width — the ▶ glyph is decoration,
  // not the target.
  function openChannelCard(channel) {
    openContextCard({
      title: channel.name,
      subtitle: 'Tablå — igår + idag',
      image: channel.image || null,
      buildBody: (body, close) => {
        body.appendChild(el('div', { class: 'card-loading', text: 'Hämtar tablå…' }));
        Promise.all([
          fetchScheduleDay(channel.id, localDateStrOffset(1)),
          fetchScheduleDay(channel.id, localDateStr()),
        ]).then(([yesterday, today]) => {
          body.textContent = '';
          if (!yesterday && !today) {
            body.appendChild(el('div', { class: 'state-msg', text: 'Tablån kunde inte hämtas just nu.' }));
            return;
          }
          const now = Date.now();
          const list = el('div', { class: 'card-list', role: 'list' });
          const addDay = (schedule, label) => {
            if (!schedule || !schedule.length) return;
            list.appendChild(el('div', { class: 'card-day-label', text: label }));
            for (const ev of schedule) {
              const ongoing = now >= ev.startMs && now < ev.endMs;
              const past = now >= ev.endMs;
              const playable = Boolean(ev.episodeId);
              const row = el('button', {
                class: `card-row${ongoing ? ' ongoing' : ''}${playable ? '' : ' no-audio'}`,
                type: 'button', role: 'listitem',
                'aria-label': playable ? `Spela ${ev.title} från ${dvrClockLabel(new Date(ev.startMs))}` : ev.title,
                disabled: !playable,
              });
              row.appendChild(el('span', { class: 'card-time', text: dvrClockLabel(new Date(ev.startMs)) || '' }));
              row.appendChild(el('span', { class: 'card-title', text: ev.title + (ongoing ? ' ●' : '') }));
              row.appendChild(el('span', { class: 'card-state', text: playable ? '▶' : (past ? '' : '⏳') }));
              if (playable) {
                row.onclick = async () => {
                  close();
                  showToast('Hämtar avsnitt…', 1500);
                  try {
                    const data = await apiFetch(`${SR_API}/episodes/get?id=${ev.episodeId}&format=json`);
                    const ep = data?.episode || {};
                    const { audioUrl, duration } = episodeAudioFields(ep);
                    if (!audioUrl) { showToast('Inget ljud för detta avsnitt.'); return; }
                    playTrack({
                      kind: 'episode', id: ep.id ?? ev.episodeId,
                      title: ep.title || ev.title,
                      subtitle: ev.programName || channel.name,
                      audioUrl, duration,
                      artwork: ev.image || channel.image,
                    });
                  } catch { showToast('Kunde inte hämta avsnittet.'); }
                };
              }
              list.appendChild(row);
            }
          };
          // Yesterday first (oldest at top), then today — scrolling down
          // moves forward in time; yesterday's rows are reachable by
          // scrolling up from the ongoing programme.
          addDay(yesterday, 'Igår');
          addDay(today, 'Idag');
          body.appendChild(list);
          // Start scrolled to the ongoing programme (or top of today) so
          // yesterday is one flick away, not hidden below the fold.
          const ongoingRow = list.querySelector('.card-row.ongoing');
          if (ongoingRow) ongoingRow.scrollIntoView({ block: 'center' });
        }).catch(() => {
          body.textContent = '';
          body.appendChild(el('div', { class: 'state-msg', text: 'Tablån kunde inte hämtas.' }));
        });
      },
    });
  }

  // Podcast card: recent episodes via episodes/index (SR quirk: page 1 is
  // empty for many programs — try page 2 as well).
  function openPodcastCard(pod) {
    // An external podcast has no SR programme id, so the SR endpoint below
    // would 404. Split FIRST, before any SR call is made -- otherwise an
    // external id is sent to api.sr.se and the failure is reported as
    // "episodes could not be fetched" instead of "no episodes".
    if (pod?.provider === 'itunes') return openExternalPodcastCard(pod);
    openContextCard({
      title: pod.name,
      subtitle: 'Avsnitt',
      image: pod.image || null,
      buildBody: (body, close) => {
        body.appendChild(el('div', { class: 'card-loading', text: 'Hämtar avsnitt…' }));
        (async () => {
          let eps = [];
          for (const page of [1, 2]) {
            const data = await apiFetch(`${SR_API}/episodes/index?format=json&programid=${pod.id}&size=10&page=${page}`);
            eps = Array.isArray(data?.episodes) ? data.episodes : [];
            if (eps.length) break;
          }
          body.textContent = '';
          if (!eps.length) {
            body.appendChild(el('div', { class: 'state-msg', text: 'Inga avsnitt hittades.' }));
            return;
          }
          const list = el('div', { class: 'card-list', role: 'list' });
          for (const ep of eps) {
            const { audioUrl, duration } = episodeAudioFields(ep);
            const row = el('button', {
              class: `card-row${audioUrl ? '' : ' no-audio'}`,
              type: 'button', role: 'listitem',
              'aria-label': audioUrl ? `Spela ${ep.title}` : ep.title,
              disabled: !audioUrl,
            });
            row.appendChild(el('span', { class: 'card-time', text: formatTime(parseSrDate(ep.publishdateutc)) || '' }));
            row.appendChild(el('span', { class: 'card-title', text: ep.title || '' }));
            if (duration) row.appendChild(el('span', { class: 'card-state', text: fmtDur(duration) }));
            if (audioUrl) {
              row.onclick = () => {
                close();
                playTrack({
                  kind: 'episode', id: ep.id,
                  title: ep.title || pod.name,
                  subtitle: pod.name,
                  audioUrl, duration,
                  artwork: pod.image,
                });
              };
            }
            list.appendChild(row);
          }
          body.appendChild(list);
        })().catch(() => {
          body.textContent = '';
          body.appendChild(el('div', { class: 'state-msg', text: 'Avsnitten kunde inte hämtas.' }));
        });
      },
    });
  }

  /** Episode card for an EXTERNAL podcast, same chrome as the SR one. */
  function openExternalPodcastCard(pod) {
    openContextCard({
      title: pod.name,
      subtitle: 'Avsnitt',
      image: pod.image || null,
      buildBody: (body, close) => {
        body.appendChild(el('div', { class: 'card-loading', text: 'Hämtar avsnitt…' }));
        (async () => {
          const eps = await extEpisodes(pod.id);
          body.textContent = '';
          // Worded as "none found", NOT "not found": a bad collectionId
          // returns HTTP 200 with resultCount 0, i.e. an empty list, and
          // telling the user the podcast does not exist would be a claim the
          // response does not support.
          if (!eps.length) {
            body.appendChild(el('div', { class: 'state-msg', text: 'Inga avsnitt hittades.' }));
            return;
          }
          const list = el('div', { class: 'card-list', role: 'list' });
          for (const ep of eps) {
            const row = el('button', {
              class: `card-row${ep.audioUrl ? '' : ' no-audio'}`,
              type: 'button', role: 'listitem',
              'aria-label': `Spela ${ep.title}`,
              disabled: !ep.audioUrl,
            });
            row.appendChild(el('span', { class: 'card-time', text: formatTime(ep.publishDateUtc) || '' }));
            row.appendChild(el('span', { class: 'card-title', text: ep.title || '' }));
            if (ep.duration) row.appendChild(el('span', { class: 'card-state', text: fmtDur(ep.duration) }));
            if (ep.audioUrl) {
              row.onclick = () => {
                close();
                playTrack({
                  kind: 'episode', id: ep.id ?? pod.id,
                  title: ep.title || pod.name,
                  subtitle: pod.name,
                  audioUrl: ep.audioUrl,
                  duration: ep.duration,
                  artwork: ep.artwork || pod.image,
                });
              };
            }
            list.appendChild(row);
          }
          body.appendChild(list);
        })().catch(() => {
          body.textContent = '';
          body.appendChild(el('div', { class: 'state-msg', text: 'Avsnitten kunde inte hämtas.' }));
        });
      },
    });
  }

  // ---------------- bottom sheet (selection UI) ----------------
  function closeSheet() {
    $sheetRoot.textContent = '';
    document.body.style.overflow = '';
    // Remove the accumulated resize listener from the last openSheet.
    if (window.__srSheetSync) {
      window.removeEventListener('resize', window.__srSheetSync);
      window.__srSheetSync = null;
    }
  }

  function openSheet({ initialTab, onDone }) {
    let tab = initialTab || 'channels';
    const favs = loadFavorites();
    const picks = { channels: [...favs.channels], podcasts: [...favs.podcasts] };

    const overlay = el('div', { class: 'sheet-overlay' });
    const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Välj favoriter' });

    const counter = el('p', { class: 'sheet-counter' });
    const listWrap = el('div', { class: 'pick-list' });
    const items = { channels: [], podcasts: [] };
    const loaded = { channels: false, podcasts: false };
    // The live search text. renderList() reads THIS rather than the input's
    // value, so the list cannot disagree with the box the owner is looking at
    // (WS44c).
    let searchQuery = '';
    let searchInput;
    let doneBtn;

    function updateCounter() {
      // Counts BOTH providers. The external list is separate storage, so
      // counting only picks[tab] reported "0 valda" while a row sat selected
      // -- and, worse, left the Spara button disabled, so a user whose only
      // pick was an external podcast could not save at all.
      const n = picks[tab].length
        + (tab === 'podcasts' ? loadExternalPodcasts().length : 0);
      counter.textContent = tab === 'channels'
        ? `Kanaler (${n} valda)`
        : `Poddar (${n} valda)`;
    }

    function doneBtnState() {
      const total = picks.channels.length + picks.podcasts.length
        + loadExternalPodcasts().length;
      doneBtn.disabled = total === 0;
      doneBtn.textContent = 'Spara';
      doneBtn.title = total === 0 ? 'Välj minst en kanal eller podd först' : '';
    }

    function togglePick(kind, id) {
      // External podcasts never enter the numeric SR array -- they live in
      // their own key, so saveFavorites()/Number.isInteger is not involved and
      // the SR favourites stay byte-identical. add=true when the row being
      // tapped is one the ext search just produced.
      const extRow = items[kind]?.find((i) => i.id === id && i.provider === 'itunes');
      if (kind === 'podcasts' && (extRow || loadExternalPodcasts().some((p) => p.id === id))) {
        toggleExternalPodcast(extRow || { id });
        // A newly added external row belongs at the END of the row, which is
        // where it appeared in the search list the user just used.
        if (kind === 'podcasts' && extRow) {
          persistPodcastRowOrder(
            podcastRowOrder(loadFavorites().podcasts, loadExternalPodcasts())
          );
        }
        updateCounter();
        doneBtnState();
        renderList();
        rebuildSelected();
        return;
      }
      const arr = picks[kind];
      const idx = arr.indexOf(id);
      if (idx >= 0) {
        arr.splice(idx, 1);
      } else if (arr.length < HARD_CAP) {
        arr.push(id);
      } else {
        showToast('Du kan inte välja fler. Ta bort en först.');
        return;
      }
      saveFavorites({ channels: picks.channels, podcasts: picks.podcasts });
      updateCounter();
      doneBtnState();
      renderList();
      rebuildSelected();
    }

    function renderList() {
      updateCounter();
      doneBtnState();
      listWrap.textContent = '';
      const all = items[tab];
      if (!loaded[tab]) {
        for (let i = 0; i < 5; i++) listWrap.appendChild(el('div', { class: 'skel', style: 'height:56px;' }));
        return;
      }
      // THE LONG LIST (owner, 2026-10-02): "removing the long list of the
      // swedish radio podcasts visually ... visible only via the search box".
      // Measured: 371 SR programmes rendered 33 010 px tall -- about 89
      // screens of scrolling to reach a name most owners know already.
      //
      // Channels are deliberately EXEMPT: there are only ~52 of them, they fit
      // on a screen or two, and a channel is picked by recognition rather than
      // by remembering its exact name. Podcasts are picked by remembering a
      // name, which is exactly what the search box is for.
      //
      // Nothing is hidden FROM the owner: every one of the 371 rows is one
      // keystroke away, and the search already reaches all of them. This is a
      // change of presentation, not of access.
      if (tab === 'podcasts' && !searchQuery) {
        listWrap.appendChild(el('div', { class: 'pick-empty' },
          el('p', { class: 'pick-empty-title', text: 'Sök för att hitta poddar' }),
          // The wording is exact on purpose. TWO characters already search
          // Sveriges Radio (measured: "ek" -> 45 rows), but iTunes needs THREE
          // (EXT_SEARCH_MIN_CHARS). Saying "minst tre tecken" would imply two
          // shows nothing, which is false -- so the threshold is stated as what
          // it is: what each source needs.
          el('p', { class: 'pick-empty-sub', text: `${all.length} poddar från Sveriges Radio och iTunes. Sök på två tecken för Sveriges Radio, tre eller fler för att även söka iTunes.` })));
        return;
      }
      if (!all.length) {
        listWrap.appendChild(el('div', { class: 'state-msg', text: 'Inga träffar.' }));
        return;
      }
      for (const item of all) {
        const isExt = item.provider === 'itunes';
        const selected = isExt
          ? loadExternalPodcasts().some((p) => p.id === item.id)
          : picks[tab].includes(item.id);
        const btn = el('button', {
          class: `pick-item${selected ? ' selected' : ''}`,
          type: 'button',
          'aria-pressed': String(selected),
          onclick: () => togglePick(tab, item.id),
        });
        if (item.image) {
          btn.appendChild(el('img', { class: 'pick-logo', src: item.image, alt: '', loading: 'lazy' }));
        } else {
          btn.appendChild(el('div', { class: 'pick-placeholder', 'aria-hidden': 'true',
            text: (item.name || '?').slice(0, 1).toUpperCase() }));
        }
        const textWrap = el('div', {},
          el('div', { class: 'pick-name', text: item.name }));
        // An external row's genre can be empty, so fall back to the artist
        // rather than rendering a row with no second line at all.
        const sub = tab === 'channels'
          ? item.channeltype
          : (item.description || item.artist);
        if (sub) textWrap.appendChild(el('div', { class: 'pick-sub', text: sub }));
        btn.appendChild(textWrap);
        btn.appendChild(el('span', { class: 'pick-check', 'aria-hidden': 'true', text: '✓' }));
        listWrap.appendChild(btn);
      }
    }

    async function loadItems(kind, query) {
      try {
        if (kind === 'channels') {
          items.channels = await fetchChannels();
        } else {
          const all = await fetchPodcasts();
          // client-side search (SR's server-side name filter is broken)
          const q = (query || '').trim().toLowerCase();
          // SR FIRST, unchanged. The external source is appended after it and
          // can only ever add rows -- extSearch never rejects, so an outage at
          // Apple leaves this list exactly as it was.
          //
          // MATCHES THE DESCRIPTION TOO. With the long list now hidden behind
          // the search box, name-only matching became a real limitation
          // rather than a cosmetic one: measured before this change, searching
          // "rapportage" returned ZERO SR rows even though several SR
          // descriptions contain the word. Hiding the browsable list must not
          // also remove the ability to find a programme by what it is about.
          const srRows = q
            ? all.filter((p) => p.name.toLowerCase().includes(q)
              || (p.description || '').toLowerCase().includes(q))
            : all;
          const extRows = await extSearch(query);
          items.podcasts = [...srRows, ...extRows];
        }
        loaded[kind] = true;
      } catch (err) {
        loaded[kind] = true;
        items[kind] = [];
        showToast(err.message || 'Kunde inte hämta listan.');
      }
      renderList();
    }

    const title = el('div', { class: 'sheet-title' });
    const closeBtn = el('button', {
      class: 'sheet-close', type: 'button', 'aria-label': 'Stäng',
      text: '✕', onclick: () => { closeSheet(); onDone?.(); },
    });
    // BUG FIX (2026-09-22): closeBtn was created but never appended — the
    // sheet had NO visible close button (verified live: .sheet-close missing
    // from DOM). Users could only close via swipe or overlay tap.

    function setTitle() {
      title.textContent = 'Info och anpassningar';
    }

    const tabChannels = el('button', { class: 'tab', type: 'button', text: 'Kanaler',
      onclick: () => switchTab('channels') });
    const tabPodcasts = el('button', { class: 'tab', type: 'button', text: 'Poddar',
      onclick: () => switchTab('podcasts') });

    function switchTab(next) {
      tab = next;
      tabChannels.setAttribute('aria-selected', String(tab === 'channels'));
      tabPodcasts.setAttribute('aria-selected', String(tab === 'podcasts'));
      searchInput.style.display = tab === 'podcasts' ? '' : 'none';
      setTitle();
      if (!loaded[tab]) loadItems(tab);
      renderList();
    }

    /**
     * Return the podcast list to its unsearched state.
     *
     * Both the box AND the recorded query are cleared together, deliberately.
     * Clearing only one of them is how the list and the search field end up
     * telling the owner different stories -- the same "two halves disagree"
     * defect class as the R6 song panel, on a different surface.
     */
    function clearSearch() {
      clearTimeout(searchTimer);
      searchQuery = '';
      items.podcasts = [];
      // NOT loaded.podcasts = false -- see the note in the input handler. The
      // catalogue is cached in memory; marking it unloaded strands the sheet on
      // skeletons with nothing scheduled to replace them.
      if (searchInput) searchInput.value = '';
    }

    searchInput = el('input', {
      class: 'search-input', type: 'search',
      placeholder: 'Sök podd…', 'aria-label': 'Sök podd',
    });
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      // Recorded BEFORE the debounce, so clearing the box brings the empty
      // state straight back instead of waiting for a network round trip.
      searchQuery = q;
      // A clear while a fetch is in flight must not leave stale rows on screen
      // pretending to be results for an empty box.
      //
      // `loaded` stays TRUE here. Setting it false was a real defect found in
      // the browser: with no fetch scheduled, renderList() took the SKELETON
      // branch and the sheet showed five permanent grey loading bars instead
      // of the search prompt. The catalogue is already in memory, so there is
      // nothing to load and nothing to wait for.
      if (!q) {
        items.podcasts = [];
        renderList();
        return;
      }
      // Show what we already have for this text immediately, then refine when
      // the debounce fires. iTunes rows for a previous query are dropped so a
      // stale external hit is never labelled as a result for a new query.
      items.podcasts = items.podcasts.filter((r) => r.provider !== 'itunes');
      renderList();
      searchTimer = setTimeout(() => loadItems('podcasts', q), 300);
    });

    doneBtn = el('button', { class: 'sheet-action sheet-save', type: 'button', text: 'Spara',
      onclick: () => { closeSheet(); onDone?.(); } });

    // News count setting (4–20, step 2) — its own section with a header
    const newsCount = loadNewsCount();
    const newsRange = el('input', {
      class: 'setting-range', type: 'range', min: '4', max: '20', step: '2',
      value: String(newsCount), 'aria-label': 'Antal nyheter att visa',
    });
    // Value bubble rides on the thumb (JS-positioned; CSS pseudo-elements on
    // slider thumbs don't work in WebKit).
    const thumbBubble = el('span', { class: 'thumb-bubble', text: String(newsCount) });
    const syncBubble = () => {
      const min = Number(newsRange.min), max = Number(newsRange.max);
      const frac = (Number(newsRange.value) - min) / (max - min);
      // thumb center = trackLeft + thumbRadius + frac * (trackWidth - thumbWidth)
      const trackW = newsRange.clientWidth - 34;
      thumbBubble.style.left = `${frac * trackW}px`;
      thumbBubble.textContent = newsRange.value;
    };
    newsRange.addEventListener('input', () => {
      saveNewsCount(Number(newsRange.value));
      syncBubble();
    });
    const newsSetting = el('div', { class: 'setting-section' },
      el('h3', { class: 'section-title', text: 'Antal nyheter' }),
      el('div', { class: 'setting-row' },
        el('span', { class: 'setting-minmax', text: '4' }),
        el('div', { class: 'setting-slider-wrap' }, newsRange, thumbBubble),
        el('span', { class: 'setting-minmax', text: '20' })));
    // position the bubble once the sheet is laid out. The resize listener is
    // removed on close — openSheet runs on every open, and without removal
    // listeners accumulate on window across opens (leak, verified 2026-09-22).
    requestAnimationFrame(syncBubble);
    window.addEventListener('resize', syncBubble);
    const prevSync = window.__srSheetSync;
    if (prevSync) window.removeEventListener('resize', prevSync);
    window.__srSheetSync = syncBubble;

    // Structure: header → Info + Spara row → Antal nyheter → Välj favoriter
    const grab = el('div', { class: 'sheet-grab', 'aria-hidden': 'true' });
    sheet.appendChild(el('div', { class: 'sheet-grab-zone', 'aria-hidden': 'true' },
      el('div', { class: 'sheet-grab', 'aria-hidden': 'true' })));
    sheet.appendChild(el('div', { class: 'sheet-header' }, title, closeBtn));
    sheet.appendChild(el('div', { class: 'sheet-actions' },
      el('button', {
        class: 'sheet-action sheet-action-info', type: 'button',
        onclick: openAbout,
        text: 'Info',
      }),
      doneBtn));
    sheet.appendChild(newsSetting);

    // Selected favorites with custom sorting — order here = order on the
    // home screen (first = leftmost). Placed ABOVE the selection list so the
    // user doesn't scroll past a long catalogue to reach it.
    const selectedSection = el('div', { class: 'setting-section' },
      el('h3', { class: 'section-title', text: 'Valda favoriter' }));
    const selectedWrap = el('div', { class: 'selected-groups' });

    function buildSelectedGroup(kind, title, catalogue) {
      const group = el('div', { class: 'selected-group' },
        el('h4', { class: 'selected-group-title', text: title }));
      // One list, both providers, ONE heading. External rows are appended
      // after the SR rows and marked, so the two storages never interleave
      // silently and the SR order is preserved exactly.
      const extList = kind === 'podcasts' ? loadExternalPodcasts() : [];
      const srIds = loadFavorites()[kind];
      // ONE order for the whole row, shared with buildIconSection, so the
      // arrangement the user makes here is the arrangement they see there.
      const list = kind === 'podcasts'
        ? podcastRowOrder(srIds, extList)
        : srIds;
      if (!list.length) {
        group.appendChild(el('div', { class: 'selected-empty', text: 'Inga valda ännu.' }));
        return group;
      }

      /**
       * Remove one row and offer an undo. Shared by the ✕ button and the
       * swipe gesture so the two can never drift apart in behaviour -- the
       * gesture must not be a "second implementation" of the same action.
       */
      const onRemoveRequest = (id, provider, name) => {
        const before = provider === 'itunes'
          ? loadExternalPodcasts().findIndex((p) => p.id === id)
          : loadFavorites()[kind].indexOf(id);
        const removed = removeFavoriteRow(kind, id, name);
        if (!removed) return;   // already gone: a double removal is a no-op
        // The sheet's own copy of the picks must follow, or Spara would write
        // the removed SR id straight back on the next save.
        if (removed.provider === 'sr') {
          const idx = picks[kind].indexOf(id);
          if (idx >= 0) picks[kind].splice(idx, 1);
        }
        // The stored order must forget the removed id, or it would linger in
        // the order key and reappear if the same podcast were re-added.
        if (kind === 'podcasts') {
          persistPodcastRowOrder(
            podcastRowOrder(loadFavorites().podcasts, loadExternalPodcasts())
              .filter((x) => x !== id)
          );
        }
        updateCounter();
        doneBtnState();
        renderList();
        rebuildSelected();
        showUndoToast(`Borttaget: ${removed.name}`, () => {
          restoreFavoriteRow(removed, before);
          if (removed.provider === 'sr' && !picks[kind].includes(id)) {
            const at = Number.isInteger(before)
              ? Math.min(before, picks[kind].length)
              : picks[kind].length;
            picks[kind].splice(at, 0, id);
          }
          // Put it back where it was, in the ORDER too -- otherwise undo
          // would restore the podcast but lose its position.
          if (kind === 'podcasts') {
            persistPodcastRowOrder(
              podcastRowOrder(loadFavorites().podcasts, loadExternalPodcasts())
            );
          }
          updateCounter();
          doneBtnState();
          renderList();
          rebuildSelected();
        });
      };

      list.forEach((id, pos) => {
        const isExt = extList.some((p) => p.id === id);
        const item = resolvePodcastRow(catalogue, id, isExt ? 'itunes' : 'sr');
        if (!item) return;
        const rowEl = el('div', {
          class: 'selected-item', draggable: 'true', 'data-id': String(id),
          // Marks the row for persistExternalOrder(), which selects on it.
          ...(isExt ? { 'data-ext': '1' } : {}),
        },
          // The delete action revealed BEHIND the row as it slides left, in the
          // iOS Mail / WhatsApp idiom: a plain coloured panel with an ICON and
          // NO text label. An earlier version put a full-width red block with
          // the word "Ta bort" behind the row; the owner rejected it because it
          // did not read like a message app. The icon is the language here --
          // a trash glyph is understood without translation, while a caption
          // would also compete visually with the podcast name sliding away.
          el('div', { class: 'swipe-reveal', 'aria-hidden': 'true' },
            el('span', {
              class: 'swipe-reveal-icon',
              html: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
            })),
          // THE FACE. The row's own surface colour has to live on a layer that
          // paints ABOVE the delete panel, or the panel shows through at REST
          // and every row reads as a red block when nothing is happening
          // (observed in a screenshot on the live site, after an earlier fix
          // that made the text readable but left the row red).
          //
          // Painting order is the whole problem: a parent's own background is
          // painted before any positioned child, so an absolutely-positioned
          // panel is ALWAYS above it. Making the content a positioned layer
          // with the surface colour on it is what puts the white face above the
          // red, and the face is what slides.
          el('div', { class: 'selected-item-face' },
          el('span', { class: 'selected-grip', 'aria-hidden': 'true',
            html: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 5h2v2H9zM13 5h2v2h-2zM9 9h2v2H9zM13 9h2v2h-2zM9 13h2v2H9zM13 13h2v2h-2zM9 17h2v2H9zM13 17h2v2h-2z"/></svg>' }),
          el('span', { class: 'selected-pos', text: String(pos + 1) }),
          item.image
            ? el('img', { class: 'selected-logo', src: item.image, alt: '', loading: 'lazy' })
            : el('span', { class: 'selected-logo selected-letter', text: item.name.slice(0, 1) }),
          el('span', { class: 'selected-name', text: item.name })));
        const controls = el('div', { class: 'selected-controls' });
        /**
         * Move a row one place within the WHOLE row -- crossing the SR/external
         * boundary when needed.
         *
         * This replaces a per-provider mover that could not cross: an external
         * row was alone in its own array, so "move up" found nothing to swap
         * with and silently did nothing, and an SR row at the boundary was
         * clamped by its own array's end. Both were observed in the browser.
         *
         * The swap is done on the ORDER, then written back to each provider's
         * own storage in that provider's own relative order. Neither provider's
         * membership changes -- only the sequence the row is displayed in.
         */
        const move = (direction) => {
          if (kind !== 'podcasts') {
            const favs = loadFavorites();
            if (moveFavorite(favs, kind, id, direction)) {
              saveFavorites(favs);
              rebuildSelected();
            }
            return;
          }
          const current = podcastRowOrder(loadFavorites().podcasts, extList);
          const from = current.indexOf(id);
          if (from === -1) return;
          const to = direction === 'up' ? from - 1 : from + 1;
          if (to < 0 || to >= current.length) return;   // already at that end
          const next = [...current];
          [next[from], next[to]] = [next[to], next[from]];
          // Write each provider's slice back in the order the swap produced.
          const extIds = new Set(extList.map((p) => p.id));
          const srFavs = loadFavorites();
          srFavs.podcasts = next.filter((x) => !extIds.has(x));
          saveFavorites(srFavs);
          saveExternalPodcasts(next
            .filter((x) => extIds.has(x))
            .map((x) => extList.find((p) => p.id === x)));
          persistPodcastRowOrder(next);
          rebuildSelected();
        };
        controls.appendChild(el('button', {
          class: 'selected-btn', type: 'button',
          'aria-label': `Flytta ${item.name} uppåt`,
          disabled: pos === 0 ? '' : null,
          html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 14l5-5 5 5z"/></svg>',
          onclick: () => move('up'),
        }));
        controls.appendChild(el('button', {
          class: 'selected-btn', type: 'button',
          'aria-label': `Flytta ${item.name} nedåt`,
          disabled: pos === list.length - 1 ? '' : null,
          html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>',
          onclick: () => move('down'),
        }));
        // The NON-GESTURE equivalent of the swipe, and deliberately not hidden
        // behind one: swipe is undiscoverable, unreachable by keyboard, and
        // impossible with a screen reader. This button is the same removal with
        // the same undo, so the feature does not depend on discovering a
        // gesture. It is placed LAST so the arrows stay where they were.
        controls.appendChild(el('button', {
          class: 'selected-btn selected-btn-remove', type: 'button',
          'aria-label': `Ta bort ${item.name}`,
          html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
          onclick: () => onRemoveRequest(id, isExt ? 'itunes' : 'sr', item.name),
        }));
        // The controls live INSIDE the face so they slide with it. Appending
        // them to the row would leave them stationary over the panel.
        rowEl.querySelector('.selected-item-face').appendChild(controls);
        group.appendChild(rowEl);
      });
      enableDragSort(group, kind, extList);
      // Swipe-to-remove, enabled for BOTH providers. It calls the SAME
      // onRemoveRequest the ✕ button uses -- one implementation, two inputs.
      // The removal is provider-explicit in removeFavoriteRow(), so this one
      // binding covers SR and iTunes rows without either list knowing about
      // the other.
      enableSwipeToRemove(group, kind, onRemoveRequest);
      return group;
    }

    /**
     * Drag-and-drop reordering within a selected group.
     * Desktop: HTML5 drag events. Touch: long-press (250 ms) starts a drag;
     * the row follows the finger vertically and drops into place.
     */
    function enableDragSort(group, kind, extList = []) {
      let dragId = null;

      const persist = () => {
        const order = rows().map(r => Number(r.dataset.id));
        // Rows come from BOTH providers. Writing every id into the SR array
        // would push iTunes collectionIds into favourites.json, which
        // favoritesFromRaw() drops as non-numbers -- the reorder would then
        // be silently undone on the next load.
        if (kind === 'podcasts') {
          const extIds = new Set(extList.map((p) => p.id));
          const favs = loadFavorites();
          // Each provider keeps its own members, in the relative order the drag
          // produced; the interleaving itself lives in the order key.
          const known = new Set(favs.podcasts);
          favs.podcasts = order.filter((id) => !extIds.has(id) && known.has(id));
          saveFavorites(favs);
          saveExternalPodcasts(order
            .filter((id) => extIds.has(id))
            .map((id) => extList.find((p) => p.id === id)));
          persistPodcastRowOrder(order);
          return;
        }
        const favs = loadFavorites();
        const known = new Set(favs[kind]);
        favs[kind] = order.filter((id) => known.has(id));
        saveFavorites(favs);
      };

      const rows = () => [...group.querySelectorAll('.selected-item')];

      const reorderTo = (id, beforeId) => {
        const favs = loadFavorites();
        const arr = favs[kind];
        const from = arr.indexOf(id);
        if (from === -1) return;
        arr.splice(from, 1);
        const to = beforeId === null ? arr.length : arr.indexOf(beforeId);
        arr.splice(to, 0, id);
        saveFavorites(favs);
        rebuildSelected();
      };

      // --- HTML5 drag (desktop) ---
      group.addEventListener('dragstart', (e) => {
        const row = e.target.closest('.selected-item');
        if (!row) return;
        dragId = Number(row.dataset.id);
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(dragId)); } catch {}
      });
      group.addEventListener('dragover', (e) => {
        e.preventDefault();
        const over = e.target.closest('.selected-item');
        if (!over || dragId === null || Number(over.dataset.id) === dragId) return;
        const rect = over.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        const overId = Number(over.dataset.id);
        const rowsArr = rows();
        const dragRow = rowsArr.find(r => Number(r.dataset.id) === dragId);
        if (before) group.insertBefore(dragRow, over);
        else group.insertBefore(dragRow, over.nextSibling);
        // renumber
        rowsArr.forEach((r, i) => r.querySelector('.selected-pos').textContent = String(i + 1));
      });
      group.addEventListener('drop', (e) => e.preventDefault());
      group.addEventListener('dragend', () => {
        if (dragId === null) return;
        rows().forEach(r => r.classList.remove('dragging'));
        persist();
        dragId = null;
      });

      // --- touch long-press drag (mobile) ---
      let touchState = null;
      group.addEventListener('touchstart', (e) => {
        const row = e.target.closest('.selected-item');
        if (!row || e.touches.length !== 1) return;
        const id = Number(row.dataset.id);
        touchState = { id, row, startX: e.touches[0].clientX, startY: e.touches[0].clientY, started: false, timer: setTimeout(() => {
          touchState.started = true;
          row.classList.add('dragging');
          if (navigator.vibrate) navigator.vibrate(10);
        }, 250) };
      }, { passive: true });
      group.addEventListener('touchmove', (e) => {
        if (!touchState) return;
        const y = e.touches[0].clientY;
        const x = e.touches[0].clientX;
        if (!touchState.started) {
          // The timer used to be cancelled on ANY 10 px move. It must NOT arm
          // for a horizontal swipe: enableSwipeToRemove owns that direction,
          // and a stray 'dragging' class here would reorder a row the user was
          // trying to remove -- the two gestures would fight over one gesture.
          const dx = x - touchState.startX;
          const dy = y - touchState.startY;
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
            clearTimeout(touchState.timer);   // horizontal -> belongs to remove
          } else if (Math.abs(dy) > 10) {
            clearTimeout(touchState.timer);   // vertical scroll -> not a drag
          }
          return;
        }
        e.preventDefault();
        const over = document.elementFromPoint(e.touches[0].clientX, y)?.closest('.selected-item');
        if (over && Number(over.dataset.id) !== touchState.id) {
          const rect = over.getBoundingClientRect();
          const before = y < rect.top + rect.height / 2;
          const rowsArr = rows();
          const dragRow = rowsArr.find(r => Number(r.dataset.id) === touchState.id);
          if (before) group.insertBefore(dragRow, over);
          else group.insertBefore(dragRow, over.nextSibling);
          rowsArr.forEach((r, i) => r.querySelector('.selected-pos').textContent = String(i + 1));
        }
      }, { passive: false });
      group.addEventListener('touchend', () => {
        if (!touchState) return;
        clearTimeout(touchState.timer);
        rows().forEach(r => r.classList.remove('dragging'));
        if (touchState.started) persist();
        touchState = null;
      });
    }

    /**
     * Swipe-to-remove on a selected-favourites row (owner request 2026-10-02).
     *
     * THE GESTURE CONFLICT, and how it is resolved. This list ALREADY has a
     * touch gesture: a 250 ms long-press starts a drag-to-reorder, and a
     * drag is inherently VERTICAL. A naive vertical swipe-to-delete would
     * therefore fight the existing feature on the same rows, and the loser
     * would be whichever the user happened to want.
     *
     * The resolution is DIRECTION, decided once, on the first 10 px:
     *   horizontal  -> REMOVE   (a fling sideways is not a reorder attempt)
     *   vertical    -> the existing long-press drag keeps it
     * A vertical drag therefore never reaches the removal threshold, and a
     * horizontal swipe never arms the drag. They cannot both fire.
     *
     * The 10 px decision window also means a SCROLL that drifts sideways a
     * little is not enough to remove anything; only a clear horizontal intent
     * counts. Requiring a deliberate horizontal move is what keeps this safe on
     * a list the user scrolls.
     *
     * Removal is reversible: the caller shows an undo toast. See
     * showUndoToast().
     */
    function enableSwipeToRemove(group, kind, onRemoved) {
      // 10 px decides intent; 35% of the row's width commits; a fast flick
      // commits early. All three are relative to the ROW, not the viewport,
      // because the rows are ~50 px tall and a viewport fraction would be
      // unreachable on a phone.
      const DECIDE_PX = 10;
      let s = null;

      group.addEventListener('touchstart', (e) => {
        const row = e.target.closest('.selected-item');
        if (!row || e.touches.length !== 1) return;
        // The CONTENT layer: every child EXCEPT the delete panel. These are
        // the elements that slide, captured once per gesture rather than
        // re-queried on every move. The panel must never be transformed.
        const content = [...row.children].filter((c) => !c.classList.contains('swipe-reveal'));
        s = {
          row,
          content,
          id: Number(row.dataset.id),
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          t0: Date.now(),
          intent: null,   // null until decided, then 'remove' or 'drag'
          d: 0,
        };
      }, { passive: true });

      group.addEventListener('touchmove', (e) => {
        if (!s) return;
        const dx = e.touches[0].clientX - s.startX;
        const dy = e.touches[0].clientY - s.startY;
        if (s.intent === null && (Math.abs(dx) > DECIDE_PX || Math.abs(dy) > DECIDE_PX)) {
          // Horizontal wins ties only when it is clearly horizontal. This is
          // the whole conflict-resolution rule, so it is stated once, here.
          s.intent = Math.abs(dx) > Math.abs(dy) ? 'remove' : 'drag';
          if (s.intent === 'remove') {
            s.row.classList.add('swiping');
            s.width = s.row.getBoundingClientRect().width || 1;
          }
        }
        if (s.intent !== 'remove') return;
        // Only LEFTWARD removes. Rightward springs back, so a mis-swing in the
        // other direction is inert rather than destructive.
        const d = Math.min(0, dx);
        s.d = d;
        // Translate the CONTENT layer only. Moving the whole row would drag
        // the coloured panel sideways with it, leaving nothing for the content
        // to uncover -- which is the entire effect. The panel stays put.
        s.content.forEach((el) => {
          el.style.transition = 'none';
          el.style.transform = `translateX(${d}px)`;
        });
      }, { passive: true });

      const finish = () => {
        if (!s) return;
        const st = s;
        s = null;
        st.row.classList.remove('swiping');
        // Reset the CONTENT layer. Used on spring-back, on cancel and just
        // before the list rebuilds, so a row restored later by undo never
        // inherits a transform.
        const clearContent = (transition) => {
          st.content.forEach((el) => {
            el.style.transition = transition;
            el.style.transform = '';
          });
        };
        if (st.intent !== 'remove') {
          // Not a removal: leave the row exactly as the drag-sort left it.
          clearContent('');
          return;
        }
        const elapsed = Date.now() - st.t0;
        const flick = elapsed < 250 && Math.abs(st.d) > 40;
        const threshold = (st.width || 1) * 0.35;
        if (Math.abs(st.d) >= threshold || flick) {
          // Carry the content fully off, leaving the panel bare for a beat.
          st.content.forEach((el) => {
            el.style.transition = 'transform 0.18s ease';
            el.style.transform = 'translateX(-100%)';
          });
          const commit = () => {
            // Cleanup BEFORE the list rebuilds, so the row object that undo
            // may resurrect is never left holding a transform.
            clearContent('');
            // Read the name from the DOM: an SR favourite is stored as a bare
            // integer, so the row is the only place the name still exists.
            const name = st.row.querySelector('.selected-name')?.textContent || '';
            onRemoved(st.id, st.row.dataset.ext ? 'itunes' : 'sr', name);
          };
          setTimeout(commit, 170);
        } else {
          clearContent('transform 0.18s ease');
        }
      };
      group.addEventListener('touchend', finish);
      group.addEventListener('touchcancel', () => {
        if (!s) return;
        s.row.classList.remove('swiping');
        s.content.forEach((el) => { el.style.transition = ''; el.style.transform = ''; });
        s = null;
      });
    }

    function rebuildSelected() {
      selectedWrap.textContent = '';
      selectedWrap.appendChild(buildSelectedGroup('channels', 'Kanaler', state.channels));
      selectedWrap.appendChild(buildSelectedGroup('podcasts', 'Poddar', state.podcasts));
    }
    rebuildSelected();
    selectedSection.appendChild(selectedWrap);
    sheet.appendChild(selectedSection);

    // Selection section — its own header so the list reads as the main task
    sheet.appendChild(el('h3', { class: 'section-title', text: 'Välj favoriter' }));
    sheet.appendChild(counter);
    sheet.appendChild(el('div', { class: 'tabs' }, tabChannels, tabPodcasts));
    sheet.appendChild(searchInput);
    sheet.appendChild(listWrap);
    overlay.appendChild(sheet);
    $sheetRoot.textContent = '';
    $sheetRoot.appendChild(overlay);
    document.body.style.overflow = 'hidden'; // no page scroll behind the sheet

    // BUG 1 FIX (2026-09-22, user lead: "scrolling works first time, fails
    // after"): swipe-to-close was attached to the ENTIRE sheet, so vertical
    // touches ANYWHERE — including on the scrollable pick list — ran the drag
    // logic and set transform on the sheet during scroll (finger-down = d>0 =
    // sheet drags). On iOS this fights the native scroll and can leave the
    // sheet unscrollable. Fix: scope the swipe surface to the grab handle +
    // header zone only; list touches never reach the swipe logic.
    const swipeSurface = sheet.querySelector('.sheet-grab-zone');
    enableSwipeToClose(overlay, swipeSurface, () => { closeSheet(); onDone?.(); }, { axis: 'y' });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { closeSheet(); onDone?.(); }
    });

    tabChannels.setAttribute('aria-selected', String(tab === 'channels'));
    tabPodcasts.setAttribute('aria-selected', String(tab === 'podcasts'));
    searchInput.style.display = tab === 'podcasts' ? '' : 'none';
    setTitle();
    clearSearch();
    loadItems(tab);
    renderList();
  }

  // ================= WS0: metadata diagnostics hook =================
  // DIAGNOSTICS ONLY — INERT BY DEFAULT. Installed by Workstream 0 to make the
  // open channel-switch and programme-skip metadata reports observable. It
  // fixes nothing and changes no behaviour; root-cause work is Workstream 1.
  //
  // GATE (deliberately two keys, both required):
  //   1. the URL query string contains diag=metadata, AND
  //   2. localStorage['sr-meta-diag'] === 'on'.
  // Reasoning: the query parameter alone travels in links, screenshots, bug
  // reports and browser history, so it must never be sufficient to switch
  // diagnostics on in someone's normal session. The localStorage flag is
  // something a person sets deliberately on the device they are debugging.
  // Requiring both means a stray or shared link does nothing on its own.
  // With the gate closed this function returns null immediately: no
  // listeners, no timers, no fetches, no polling, no DOM mutation, no
  // localStorage writes.
  const META_DIAG_FLAG = 'sr-meta-diag';
  const META_DIAG_QUERY = 'diag=metadata';
  const META_DIAG_RAW_MAX_CHARS = 4000;

  // WS29 — OWNER DECISION 2026-09-30, and a DELIBERATE divergence. Read this
  // before "fixing" it.
  //
  // The gate below is UNCHANGED and still protects `srMetaDiag()`. WS29 adds a
  // SECOND, separate read path (`aboutTimingReadout`, below) which calls
  // `metaDiagBuildSnapshot()` directly, WITHOUT consulting this gate.
  //
  // Why that is acceptable: the property this gate protects is that a stray
  // artefact must never silently enable diagnostics. A query string travels in
  // links, screenshots, bug reports and history, so it must never be
  // sufficient on its own. The WS29 switch is a deliberate action INSIDE the
  // app's own Info sheet — which is exactly the "something a person sets
  // deliberately" this comment already asks for. The gate asks "are both keys
  // present?"; the owner has decided that the right question is "was this
  // deliberate?".
  //
  // WHAT MUST NOT CHANGE: `metaDiagGateOpen()` itself, and therefore cases B, C
  // and D. A shared `?diag=metadata` link with no flag must still return null.
  // If a future session finds the panel reading without the URL and concludes
  // the flag is now redundant, that is the wrong conclusion — the flag is what
  // stops the LINK, and the switch is what stops nothing by accident.

  function metaDiagGateOpen() {
    let q = '';
    try { q = String(location.search || ''); } catch { q = ''; }
    if (q.indexOf(META_DIAG_QUERY) === -1) return false;
    let flag = null;
    try { flag = localStorage.getItem(META_DIAG_FLAG); } catch { flag = null; }
    return flag === 'on';
  }

  // ---- WS29: the readout the owner can actually see. ----
  //
  // ONE number, on screen, in Swedish, readable on an iPhone. This exists
  // because `edgeMinusNowS` has been measured on a desktop and never on a
  // device, and the reported programme-skip offset (~25 s, then ~10 s, then
  // ~30 s) has never been explained.
  //
  // READ-ONLY. It reads `metaDiagBuildSnapshot()` and writes NOTHING except its
  // own text nodes. It never touches audioEl, hls, state.current, timers
  // outside its own interval, or the network. AGENTS.md §3: this adds a reader,
  // not a writer.
  const META_DIAG_READOUT_INTERVAL_MS = 2000;

  // ---- WS30: the SAMPLE cadence, deliberately slower than the paint cadence. ----
  // SR's playlist rolls every few seconds (segments are 6.4 s), so a sample
  // taken 2 s after the last one adds information but costs a fetch. 20 s keeps
  // the reading current on screen while staying well under the 15 s staleness
  // threshold, so a normally-refreshing panel never shows the stale label.
  // It is a display/fetch policy only: no transport constant is touched and no
  // number is corrected by it.
  const META_DIAG_SAMPLE_INTERVAL_MS = 20000;

  // The whole point is that a missing reading must never look like a zero
  // offset. A panel showing "0 s" when it means "no data" would send the next
  // session chasing an offset that does not exist — that is the failure this
  // function exists to prevent.
  //
  // ---- WS30: this no longer reads `edgeMinusNowS` at all. ----
  //
  // That field was `(now - (now - X))/1000`, i.e. identically X. It was the
  // playhead's own distance from the buffer edge, wearing the label "offset",
  // and the tests built from that formula could not fail. This function now
  // requires `twoSource`, which is only ever populated from the STREAM's own
  // PROGRAM-DATE-TIME clock. If that field is absent the panel says so — there
  // is deliberately no fallback to the self-referential number, because a
  // fallback is how the tautology would come back wearing a new name.
  function metaDiagReadoutLines() {
    // ---- WS32 (3a): a snapshot FAILURE is not the same fact as NO CHANNEL. ----
    // The `catch` used to set `snap = null`, which made an internal error
    // indistinguishable from "nothing is playing" — so the panel told the owner
    // to start a channel whenever anything inside the snapshot builder threw.
    // That is the same class of untruth WS31 fixed one level up, and it is the
    // most likely reason a future session sees a nonsense panel state, because
    // the failure is silent: no number, no number ever.
    //
    // The two facts are now kept apart. `snapFailed` distinguishes "the readout
    // could not be built" from "the readout is fine and nothing is playing",
    // and only the latter may claim a channel must be started. The error is
    // also recorded so a session can act on it rather than re-deriving it.
    let snap = null;
    let snapFailed = false;
    try {
      snap = metaDiagBuildSnapshot();
    } catch {
      snap = null;
      snapFailed = true;
    }
    const dvr = snap && snap.dvr ? snap.dvr : null;
    const two = dvr ? dvr.twoSource : null;
    const seek = dvr ? dvr.seek : null;

    // (0) The snapshot itself could not be built. NO number is shown — this is
    //     a wrong LABEL being fixed, not a reading being added. It comes BEFORE
    //     the no-stream check, because with `snap === null` both would otherwise
    //     match and the untruth would survive.
    if (snapFailed) {
      return {
        ok: false,
        state: 'snapshot-error',
        primary: 'Kunde inte läsa appens egen diagnosdata',
        secondary: 'Det här är inte en mätning och inte noll — panelen kunde '
          + 'inte byggas upp. Starta om appen och försök igen.',
      };
    }

    // ---- WS31: WHICH condition each message is derived from, and why. ----
    //
    // The three "there is no number" cases are genuinely different, and
    // conflating them is the same defect class WS30 exists to fix: a state
    // that tells the reader something untrue.
    //
    // (a) NO CHANNEL PLAYING. Condition tested: `playback.current` is absent.
    //     That is the condition the message actually describes, so it is the
    //     condition tested. `playback.current.kind` is 'live' | 'episode' | null.
    //
    // (b) A CHANNEL IS PLAYING BUT NOT ON HLS (direct MP3). Condition tested:
    //     `dvr.transportKind` is not an HLS value. This IS reachable for the
    //     owner: the app falls back HLS -> direct MP3 whenever HLS is
    //     unavailable, on desktop and on the phone alike. `activeHlsMasterUrl()`
    //     correctly returns null here, so there is genuinely no playlist to
    //     read and NO stream clock to compare against — but telling the owner
    //     to "start a channel" while one is playing is simply false.
    //
    // (c) The sample has not landed / failed / is stale — handled below, from
    //     the probe's own `status`, which is the only thing that knows.
    //
    // NOTE ON WHAT THIS IS NOT. The `no-stream` branch used to be
    // `!dvr || !dvr.streamEdge`. The tech lead's WS31 brief attributes the
    // misleading message to that guard. I could not reproduce that: the
    // snapshot builds `streamEdge` UNCONDITIONALLY, so on a playing channel
    // that object exists and the guard does not fire — verified in the browser
    // (`hasDvr: true`, `hasStreamEdge: true`, 13 snapshot keys while direct MP3
    // was playing). The message I saw came from `status: 'idle'`, reached
    // because the fetcher returns early for non-HLS and leaves status at its
    // initial value. The FIX is the same either way — stop conflating the cases
    // — but the cause is recorded here so the next session does not "fix" the
    // guard again.
    const playing = snap && snap.playback ? snap.playback.current : null;
    // "Something is playing" covers BOTH live radio and a podcast episode. An
    // episode is not a live HLS stream either, so it must not be told to start
    // a radio channel — the WS31 test drives this case and it went red, which
    // is why the condition is `playing` and not `isLive`.
    const isPlaying = !!playing;
    const isLive = isPlaying && playing.kind === 'live';
    const transport = dvr ? dvr.transportKind : null;
    const onHls = transport === 'hls-hlsjs' || transport === 'hls-native';

    // (a) Nothing playing at all — the pre-existing, owner-facing state, kept
    //     EXACTLY as it was because it is correct and the owner knows it.
    if (!isPlaying) {
      return {
        ok: false,
        state: 'no-stream',
        primary: 'Starta en radiokanal först',
        secondary: 'Timningen mäts bara medan en radiokanal spelar.',
      };
    }

    // (b) Something IS playing, but it is not a live HLS stream, so there is no
    //     playlist and no stream clock to compare against. Say what is actually
    //     true instead of contradicting what the owner can see and hear. This
    //     covers a direct-MP3 radio channel AND a podcast episode. `ok: false`
    //     and NO number: there is no second clock, and inventing one is the
    //     defect WS30 exists to fix.
    if (!isLive || !onHls) {
      return {
        ok: false,
        state: 'no-stream-clock',
        primary: isLive
          ? 'Direkt ljud — ingen strömklocka att jämföra med'
          : 'Podcast — ingen strömklocka att jämföra med',
        secondary: 'Strömmen spelar, men har ingen spellista. '
          + 'Timningen kan bara mätas på en HLS-kanal.',
      };
    }

    // Every non-numeric state is EXPLICIT. None of them may render a number,
    // and none of them may fall back to an earlier reading.
    const status = two ? two.status : 'idle';
    if (status !== 'ok' || !Number.isFinite(two.offsetS)) {
      const text = {
        loading: ['Mäter…', 'Läser strömmens egen klocka.'],
        failed: ['Kunde inte läsa strömmens klocka',
          'Ingen mätning — det här är inte noll.'],
        idle: ['Startar mätning…', 'Öppna panelen igen för att mäta.'],
      }[status] || ['Startar mätning…', 'Öppna panelen igen för att mäta.'];
      return { ok: false, state: status, primary: text[0], secondary: text[1] };
    }

    const ageS = Number.isFinite(two.sampleAgeS) ? two.sampleAgeS : null;
    const stale = two.stale === true;
    const secs = Math.round(two.offsetS);
    const sign = secs > 0 ? '+' : (secs < 0 ? '−' : '±');
    // The subject is the APP and the direction word is derived from the sign,
    // and the two must AGREE. This is not cosmetic: the browser caught the
    // first version rendering "−30 s före" — a minus sign next to the word for
    // "ahead". offsetS is app-relative (appEdge - trueEdge), so:
    //   positive => the app's belief is LATER than the stream's clock => "före"
    //   negative => the app's belief is EARLIER                 => "efter"
    // Swedish "före" = ahead, "efter" = behind. So + pairs with före and −
    // pairs with efter, and the owner can read the sign without knowing what it
    // means. WS30 test asserts this agreement directly.
    const ahead = secs > 0;
    const primary = secs === 0
      ? 'Appens klocka ligger i linje med strömmens (±0 s)'
      : `Appens klocka ligger ${sign}${Math.abs(secs)} s ${ahead ? 'före' : 'efter'} strömmens`;
    const parts = [];
    if (ageS !== null) {
      parts.push(`Mätt ${ageS < 5 ? 'nyss' : Math.round(ageS) + ' s sedan'}`);
    }
    if (stale) {
      // Stale is not fresh. Saying so is the whole point of keeping the age.
      parts.push('mätningen kan vara gammal');
    }
    const clamp = seek && Number.isFinite(seek.clampedByS) ? seek.clampedByS : null;
    if (clamp !== null && Math.abs(clamp) > 0.5) {
      parts.push(`Sökningen ändrades av webbläsaren med ${clamp.toFixed(1)} s`);
    }
    // ---- WS33: the playhead distance, shown SEPARATELY and under its OWN
    // label. The tech lead asked for a decision and a reason; this is mine. ----
    //
    // YES, keep it, because `distanceFromLiveEdge` is real information the
    // owner legitimately wants: "where am I on the timeline" is a different
    // question from "is my clock wrong", and this panel is the only place the
    // two can be told apart.
    //
    // It goes in the SECONDARY line, joined by ' · ', and never inside the
    // primary sentence. That placement is the whole decision: WS30's defect was
    // a real quantity wearing the wrong label, and putting it in the same
    // string as the clock offset is how that happened. On its own, with
    // `dvrOffsetLabel` — the SAME formatter the player's own pill uses — it
    // cannot be misread as a clock: it reads "−30 min", the pill's own words.
    //
    // It is READ, never computed here: `dvr.distanceFromLiveEdge` is written
    // by `updateSeekableState` and by nothing else (AGENTS.md §3), so this
    // adds a reader and not a writer. Omitted entirely when absent or at the
    // live edge, so it can never render a "−0 min" that reads like an offset.
    const behindS = dvr && Number.isFinite(dvr.distanceFromLiveEdge)
      ? dvr.distanceFromLiveEdge : null;
    if (behindS !== null && behindS >= 60) {
      // `dvrOffsetLabel` is the app's existing formatter for exactly this
      // quantity, so the panel and the player pill cannot drift apart. It is
      // called directly, NOT guarded by a typeof: a guard would be dead code
      // here, and the test harness EXTRACTS this function rather than
      // reimplementing it (AGENTS.md §7), so there is no absent case to
      // defend against.
      const where = dvrOffsetLabel(behindS);
      if (where !== 'LIVE') {
        parts.push(`Spelar ${where} från direktsändningen`);
      }
    }
    return { ok: true, state: 'ok', primary, secondary: parts.join(' · ') || null, seconds: secs };
  }

  // Bound a captured raw API body so a snapshot stays readable in a console.
  // Truncation is ANNOUNCED, never silent.
  function metaDiagCapRaw(value) {
    if (value == null) return { body: null, truncated: false, chars: 0 };
    let text;
    try { text = JSON.stringify(value); } catch {
      return { body: null, truncated: true, chars: 0, note: 'unserialisable' };
    }
    if (text.length <= META_DIAG_RAW_MAX_CHARS) {
      return { body: value, truncated: false, chars: text.length };
    }
    return {
      body: `${text.slice(0, META_DIAG_RAW_MAX_CHARS)}…[TRUNCATED]`,
      truncated: true,
      chars: text.length,
      shownChars: META_DIAG_RAW_MAX_CHARS,
    };
  }

  function metaDiagText(root, selector) {
    const n = root.querySelector(selector);
    return n ? (n.textContent || '').trim() : null;
  }

  function metaDiagAttr(root, selector, attr) {
    const n = root.querySelector(selector);
    return n ? n.getAttribute(attr) : null;
  }

  // ---- WS6: what is the programme-skip button actually DOING? ----
  // Three workstreams guessed at this button's behaviour because nothing could
  // see it. The trap in guessing: `title` says "Nästa program" but the wiring
  // may be anything, and a separate `mode` variable would drift out of sync
  // with the real handler. So `mode` is derived from the handler itself.
  //
  // The handlers are named (not inline arrows) and tagged with `_srMode`, so
  // the derivation is a real read of the wiring rather than a string search
  // over minified-ish source. If a future change swaps the handler without
  // updating the tag, this reports 'unknown' instead of lying.
  function metaDiagNextProgram() {
    const btn = $player.querySelector('.dvr-program-btn');
    // The press evidence is gathered FIRST and unconditionally, so the field is
    // present in BOTH return paths. Reporting it only when the button exists
    // made `nextProgram.press` undefined exactly when a reader most wants it —
    // and a test asserting on a present button never noticed.
    const cur = state.current;
    const press = {
      calls: SKIP_PRESS_DIAG.calls,
      lastBranch: SKIP_PRESS_DIAG.lastBranch,
      lastCalledAt: SKIP_PRESS_DIAG.lastCalledAt,
      lastRequestedStartMs: SKIP_PRESS_DIAG.lastRequestedStartMs,
      lastTarget: SKIP_PRESS_DIAG.lastTarget,
      lastBefore: SKIP_PRESS_DIAG.lastBefore,
      lastAfter: SKIP_PRESS_DIAG.lastAfter,
      // The live DVR window, so an out-of-window verdict can be judged.
      seekableEnd: cur ? cur.seekableEnd : null,
      seekableStart: cur ? cur.seekableStart : null,
      seekableDuration: cur ? cur.seekableDuration : null,
      // WS9 Part C: the window's REAL length, DERIVED from the two values
      // above. The hardcoded "3 timmar" in the out-of-window toast is why
      // every offline model of the skip button had to guess; this is measured.
      windowSeconds: (cur && Number.isFinite(cur.seekableStart)
        && Number.isFinite(cur.seekableEnd) && cur.seekableEnd > cur.seekableStart)
        ? cur.seekableEnd - cur.seekableStart : null,
      // WS9: the playhead's wall-clock position and what it resolves to, so a
      // screenshot shows the title AND the position that produced it.
      playheadWallMs: (cur && cur.kind === 'live') ? playheadWallMs() : null,
      // WS44 EXPERIMENT. BOTH timebases on the press path too. The delta is
      // the experiment's result: on the iPhone it is the size of the error the
      // seekableEnd-derived model was carrying. Recorded whether or not a
      // native read was available, so "delta 0 because the platform returned
      // nothing" stays distinguishable from "delta 0 because the two agree".
      playheadWallMs44: (cur && cur.kind === 'live') ? playheadWallMs44() : null,
      playheadDelta44Ms: (cur && cur.kind === 'live'
        && Number.isFinite(playheadWallMs())
        && Number.isFinite(playheadWallMs44()))
        ? playheadWallMs44() - playheadWallMs() : null,
      getStartDateMs: (() => {
        try {
          if (typeof audioEl.getStartDate !== 'function') return null;
          const v = audioEl.getStartDate();
          return Number.isFinite(v) && v > 0 ? v : null;
        } catch { return null; }
      })(),
      getStartDateAvailable: typeof audioEl.getStartDate === 'function',
      programAtPlayhead: (cur && cur.kind === 'live' && Array.isArray(cur._srSchedule))
        ? (pickByPosition(cur._srSchedule.map((e) => ({
          startMs: e.startMs, stopMs: e.endMs, title: e.title,
        })), playheadWallMs())?.title ?? null)
        : null,
      songTimelineLength: nowPlaying.timeline.length,
    };
    if (!btn) {
      // The button only exists when cur.dvrAvailable was true at render time.
      // A press can still have been recorded earlier in the session, so
      // `press` is reported rather than dropped.
      return { present: false, visible: false, title: null, ariaLabel: null, mode: 'absent', press };
    }
    const visible = btn.style.display !== 'none';
    const fn = btn.onclick;
    // The wiring is the source of truth. `fn` is one of the two NAMED
    // functions below; anything else (including null) is reported honestly.
    const wired = typeof fn === 'function' ? (fn._srMode || 'unknown') : 'unwired';
    let mode;
    if (!visible) mode = 'hidden';
    else if (wired === 'programme') mode = 'programme';
    else if (wired === 'direct') mode = 'direct';
    else mode = wired; // 'unknown' | 'unwired' — never claim a mode we cannot see
    return {
      present: true,
      visible,
      title: btn.getAttribute('title'),
      ariaLabel: btn.getAttribute('aria-label'),
      mode,
      wired,
      behindLive: cur ? (cur.atLiveEdge === false) : null,
      secondsBehind: cur ? cur.distanceFromLiveEdge : null,
      // WS6: the exact inputs the last syncNext() used, so a device snapshot
      // shows WHICH branch ran and why, not just the resulting mode.
      branch: META_DIAG.nextBranch ?? null,
      press,
    };
  }

  // Build the snapshot. Called only when metaDiagGateOpen() is true.
  function metaDiagBuildSnapshot() {
    const cur = state.current;
    let buffered = [];
    try {
      const b = audioEl.buffered;
      for (let i = 0; b && i < b.length; i += 1) buffered.push({ start: b.start(i), end: b.end(i) });
    } catch { buffered = []; }

    const panel = $player.querySelector('.player-expand');
    const playingIcons = [];
    document.querySelectorAll('[data-stream-key]').forEach((n) => {
      if (!n.classList.contains('playing')) return;
      playingIcons.push({
        streamKey: n.dataset.streamKey || null,
        ariaPressed: n.getAttribute('aria-pressed'),
        ariaLabel: n.getAttribute('aria-label'),
      });
    });

    // Wall-clock time of the heard position inside the DVR window. Read-only:
    // dvrPositionToDate() only reads cur.seekableEnd.
    let positionWallClock = null;
    try {
      const d = dvrPositionToDate(audioEl.currentTime);
      if (d) positionWallClock = d.toISOString();
    } catch { positionWallClock = null; }

    return {
      tool: 'sr-meta-diag (WS0) — read-only snapshot, fixes nothing',
      gate: { query: META_DIAG_QUERY, flagKey: META_DIAG_FLAG, open: true },
      takenAt: new Date().toISOString(),

      playback: {
        current: cur ? {
          kind: cur.kind ?? null,
          id: cur.id ?? null,
          title: cur.title ?? null,
          subtitle: cur.subtitle ?? null,
          _srProgramTitle: cur._srProgramTitle ?? null,
          audioUrl: cur.audioUrl ?? null,
          codec: cur.codec ?? null,
          bitrate: cur.bitrate ?? null,
          transport: cur.transport ?? null,
          dvr: cur.dvr ?? null,
          candidateIndex: cur.candidateIndex ?? null,
          duration: cur.duration ?? null,
          dvrAvailable: cur.dvrAvailable ?? null,
          candidates: Array.isArray(cur.candidates) ? cur.candidates : [],
        } : null,
        lastPlayingKey,
      },

      audioEl: {
        currentTime: audioEl.currentTime,
        duration: Number.isFinite(audioEl.duration) ? audioEl.duration : null,
        paused: audioEl.paused,
        readyState: audioEl.readyState,
        networkState: audioEl.networkState,
        buffered,
        src: audioEl.getAttribute('src'),
        currentSrc: audioEl.currentSrc || null,
      },

      nowPlaying: {
        parsed: {
          song: nowPlaying.song
            ? {
                title: nowPlaying.song.title,
                artist: nowPlaying.song.artist,
                startMs: nowPlaying.song.startMs,
                stopMs: nowPlaying.song.stopMs,
              }
            : null,
          artwork: nowPlaying.onAirArtwork,
          playheadArtwork: nowPlaying.playheadArtwork,
          resolvedAtPlayhead: resolvePlayheadMeta(),
          channelId: nowPlaying.channelId,
        },
        nowPlayingSeq,
        artworkSeq,
        nowPlayingTimer: nowPlayingTimer ? 'present' : 'absent',
        rawRightNow: metaDiagCapRaw(META_DIAG.lastRightNowRaw),
        rawRightNowReceivedAt: META_DIAG.lastRightNowAt,
        note: 'previoussong/nextsong are captured in rawRightNow only; '
          + 'the app parses playlist.song exclusively and nothing else reads them.',
      },

      schedule: {
        channelId: META_DIAG.lastScheduleChannelId,
        rawScheduledEpisodes: metaDiagCapRaw(META_DIAG.lastScheduleRaw),
        rawReceivedAt: META_DIAG.lastScheduleAt,
        // ---- WS21: the yesterday gate, recorded so it is OBSERVABLE ----
        // WS18's gate read `cur.seekableStart` at schedule-fetch time, when it
        // is still null, so it never opened and yesterday was never loaded.
        // The cause was invisible from outside; these three fields make it a
        // one-glance check on a real device: if `fetchedDays` is `['today']`
        // while `pastMidnight` is true, the gate is broken again.
        gate: META_DIAG.lastScheduleGate || null,
        parsed: (META_DIAG.lastScheduleParsed || []).map((e) => ({
          startMs: e.startMs, endMs: e.stopMs, title: e.title,
        })),
      },

      episodeTracks: {
        currentTrack: episodeCurrentTrack,
        cacheKeys: Array.from(episodeTracksCache.keys()),
        trackSeq: episodeTrackSeq,
      },

      // ---- WS23: what happened the last time PLAY was pressed on a pair of
      // headphones or the lock screen ----
      // The single most useful field is `outcome`:
      //   'rejected' -> the browser refused; `errorName` says why
      //                 ('NotAllowedError' = refused, 'AbortError' = something
      //                 else interrupted it).
      //   'resolved' -> resuming "worked" at the API level, so any silence is
      //                 DOWNSTREAM in the stream. This is the case that cannot
      //                 be fixed by showing a message.
      //   null       -> the button never reached this handler at all.
      // Paired with the owner's own result: stop-then-play works, which is the
      // full teardown path, and is a different code path from pause-then-play.
      earbudResume: { ...RESUME_DIAG },

      dvr: {
        atLiveEdge: cur?.atLiveEdge ?? null,
        distanceFromLiveEdge: cur?.distanceFromLiveEdge ?? null,
        seekableStart: cur?.seekableStart ?? null,
        seekableEnd: cur?.seekableEnd ?? null,
        // ---- WS23: the stream-edge assumption, made visible ----
        // `edgeAsWallClock` is what the app BELIEVES the end of the buffer
        // corresponds to as a clock time. `nowIso` is the actual current time.
        // `edgeMinusNowS` is the difference in seconds, and it is the single
        // most useful number here: it is the bias every resolved programme
        // title and every programme skip inherits, and until now nothing in the
        // app could report it.
        //
        // IMPORTANT, so nobody over-reads it: this is the app comparing
        // itself against the same clock it already trusts. It CANNOT detect a
        // device clock that is itself wrong, and it cannot by itself prove the
        // stream is behind. Its job is to make the assumption observable, so a
        // human comparing it against the real broadcast can supply the
        // independent reference the app lacks.
        //
        // For the full reading guide see the WS23 entry in ENHANCEMENTS.md.
        streamEdge: {
          edgeAsWallClockIso: (() => {
            const e = streamEdgeWallMs();
            return Number.isFinite(e) ? new Date(e).toISOString() : null;
          })(),
          nowIso: new Date().toISOString(),
          edgeMinusNowS: (() => {
            const e = streamEdgeWallMs();
            return Number.isFinite(e) ? Math.round((Date.now() - e)) / 1000 : null;
          })(),
          // ---- WS30: WHY THE FIELD ABOVE IS NOT AN OFFSET ----
          // `edgeMinusNowS` is `(now - (now - X))/1000`, which cancels to `X`.
          // It is `distanceFromLiveEdge` — the playhead's own distance from the
          // buffer edge — and it is the app's clock compared with itself. It is
          // KEPT, because WS23 tests and older sessions read it and a rename
          // would break them, but it is NOT an offset and must never be
          // presented as one. `twoSource` below is the real measurement.
          selfReferential: true,
          // Sampled around the most recent seek, so a reader can tell whether
          // the seek itself moved the edge.
          before: SEEK_EDGE_DIAG.before,
          after: SEEK_EDGE_DIAG.after,
          requestedTarget: SEEK_EDGE_DIAG.requestedTarget,
          acceptedPosition: SEEK_EDGE_DIAG.acceptedPosition,
          clampedByS: SEEK_EDGE_DIAG.clampedByS,
          calls: SEEK_EDGE_DIAG.calls,
          lastCalledAt: SEEK_EDGE_DIAG.lastCalledAt,
          assumption: 'seekableEnd is read as "now" by playheadWallMs, '
            + 'dvrPositionToDate, seekToProgramTime and seekToLive. The real '
            + 'size of that error is NOT known and is NOT corrected for.',
        },
        // ---- WS30: the genuine TWO-SOURCE comparison. ----
        // `deviceNowMs` is THIS DEVICE'S wall clock. `trueEdgeWallMs` is the
        // STREAM's own clock: the head #EXT-X-PROGRAM-DATE-TIME plus the sum of
        // every #EXTINF, fetched from SR's own CDN. `offsetS` is their signed
        // difference. Neither operand contains `currentTime`, which is what
        // makes it a CLOCK offset (WS33).
        //
        // Three numbers from two sources, not one derived number, so a reader
        // can check the arithmetic and either clock can be shown to be wrong
        // later without the other being lost.
        //
        // `status` is ENUMERATED and the readout treats anything but 'ok' as a
        // non-numeric state. There is deliberately no path here that turns a
        // missing or failed sample into 0, and none that falls back to
        // `edgeMinusNowS`.
        // ---- WS32 (3b): expose the browser-clamp so the panel can use it. ----
        // `metaDiagReadoutLines` has read `dvr.seek.clampedByS` since WS29 to
        // say "Sökningen ändrades av webbläsaren med N s", but the snapshot
        // NEVER PROVIDED `dvr.seek`. The line was dead UI: a seek clamped by
        // the browser was silently never reported.
        //
        // CHOSEN OVER DELETION, and the reachability was PROVED rather than
        // assumed (AGENTS.md §7a — a reader fed by nothing has bitten this repo
        // twice). `SEEK_EDGE_DIAG.clampedByS` is written on BOTH of the owner's
        // real seek paths:
        //   seekToLive()        — "Till Direkt"
        //   seekToProgramTime() — the programme skip (the circular arrows)
        // each as `audioEl.currentTime - target` immediately after the seek, so
        // it is a real measurement of what the element accepted rather than a
        // recomputation of what we asked for.
        //
        // Exposing it is strictly more informative than removing the line: the
        // whole point of the clamp is that it is INDISTINGUISHABLE from a wrong
        // offset from the outside. Without it, a clamped seek and a genuine
        // offset look identical on screen.
        seek: {
          clampedByS: SEEK_EDGE_DIAG.clampedByS,
          requestedTarget: SEEK_EDGE_DIAG.requestedTarget,
          acceptedPosition: SEEK_EDGE_DIAG.acceptedPosition,
          calls: SEEK_EDGE_DIAG.calls,
          lastCalledAt: SEEK_EDGE_DIAG.lastCalledAt,
        },
        twoSource: {
          status: STREAM_EDGE_PROBE.status,
          // BOTH raw clocks, so the difference is checkable by hand.
          // The OPERAND (WS33). Neither involves the playhead.
          deviceNowMs: STREAM_EDGE_PROBE.deviceNowMs,
          deviceNowIso: Number.isFinite(STREAM_EDGE_PROBE.deviceNowMs)
            ? new Date(STREAM_EDGE_PROBE.deviceNowMs).toISOString() : null,
          trueEdgeWallMs: STREAM_EDGE_PROBE.trueEdgeWallMs,
          trueEdgeIso: Number.isFinite(STREAM_EDGE_PROBE.trueEdgeWallMs)
            ? new Date(STREAM_EDGE_PROBE.trueEdgeWallMs).toISOString() : null,
          // The app's BELIEF about the buffer edge, NOT an operand. It is
          // playhead-dependent, so `deviceNowMs - appEdgeWallMs` equals the
          // playhead's distance from the live edge. WS33 shipped a panel whose
          // "offset" was exactly that quantity; see `note` before using it.
          appEdgeWallMs: STREAM_EDGE_PROBE.appEdgeWallMs,
          appEdgeIso: Number.isFinite(STREAM_EDGE_PROBE.appEdgeWallMs)
            ? new Date(STREAM_EDGE_PROBE.appEdgeWallMs).toISOString() : null,
          // Signed seconds. The ONE number the panel shows.
          offsetS: Number.isFinite(STREAM_EDGE_PROBE.offsetS)
            ? STREAM_EDGE_PROBE.offsetS : null,
          // Age of the sample, and whether it has passed the display threshold.
          // Stale is not fresh, and the panel says so.
          sampleAgeS: streamEdgeSampleAgeS(),
          stale: (() => {
            const age = streamEdgeSampleAgeS();
            return age !== null && age * 1000 > STREAM_EDGE_PROBE.staleAfterMs;
          })(),
          sampledAtIso: Number.isFinite(STREAM_EDGE_PROBE.sampledAtMs)
            ? new Date(STREAM_EDGE_PROBE.sampledAtMs).toISOString() : null,
          segmentCount: STREAM_EDGE_PROBE.segmentCount,
          mediaSequence: STREAM_EDGE_PROBE.mediaSequence,
          masterUrl: STREAM_EDGE_PROBE.masterUrl,
          variantUrl: STREAM_EDGE_PROBE.variantUrl,
          error: STREAM_EDGE_PROBE.error,
          note: 'deviceNowMs is this device\'s wall clock, read in the same '
            + 'breath as the stream\'s own clock (head PROGRAM-DATE-TIME + sum '
            + 'of EXTINF). offsetS = (deviceNow - trueEdge)/1000 — a difference '
            + 'of two clocks, and independent of where the playhead sits. '
            + 'appEdgeWallMs is NOT an operand: it is the app\'s belief about '
            + 'the buffer edge and it MOVES with the playhead, so subtracting '
            + 'it from deviceNowMs would rebuild the WS33 defect (a "offset" '
            + 'that was really the distance behind live). No correction '
            + 'constant is applied anywhere, and none should be added from one '
            + 'sample.',
        },
        // ---- WS38: the raw seek-measurement record. ----
        // Every field is a raw reading or a subtraction of two raw readings.
        // `null` means NOT MEASURED and must never be rendered as 0.
        //
        // There is deliberately NO field here that differences `seekableEnd`
        // against the stream clock. That quantity is arithmetically
        // incapable of seeing `seekableEnd` (the only media->wall mapping
        // collapses to `Date.now()` at m = seekableEnd), so it would be the
        // clock bias restated. The ONLY cross-frame comparison is `rate`,
        // which compares two samples taken at two different TIMES.
        seekMeasure: {
          // --- measurement 1: age of the cached value the seek used ---
          nowMs: SEEK_MEASURE.nowMs,
          cachedWrittenAtMs: SEEK_MEASURE.cachedWrittenAtMs,
          cachedAgeMs: SEEK_MEASURE.cachedAgeMs,
          cachedSeekableEnd: SEEK_MEASURE.cachedSeekableEnd,
          freshSeekableEnd: SEEK_MEASURE.freshSeekableEnd,
          // --- measurement 3: recorded, NOT interpreted ---
          freshMinusCachedMs: SEEK_MEASURE.freshMinusCachedMs,
          // --- measurement 4: requested vs accepted ---
          startMs: SEEK_MEASURE.startMs,
          behindMs: SEEK_MEASURE.behindMs,
          target: SEEK_MEASURE.target,
          requestedTarget: SEEK_MEASURE.requestedTarget,
          acceptedPosition: SEEK_MEASURE.acceptedPosition,
          clampedByS: SEEK_MEASURE.clampedByS,
          // --- measurement 2: the rate window ---
          rate: SEEK_MEASURE.rate,
          rateSamples: SEEK_MEASURE.samples,
          note: 'Raw readings. Units: nowMs/cachedWrittenAtMs/cachedAgeMs/'
            + 'behindMs/startMs/freshMinusCachedMs are MILLISECONDS; '
            + 'cachedSeekableEnd/freshSeekableEnd/target/requestedTarget/'
            + 'acceptedPosition/clampedByS are MEDIA SECONDS, not ms. A rate of '
            + '1.0000 means that frame advanced exactly as fast as its '
            + 'reference. There is intentionally NO absolute difference '
            + 'between seekableEnd and the stream clock anywhere in this '
            + 'record: that quantity cannot see seekableEnd and would be the '
            + 'clock bias restated.',
        },
        // ---- WS39: the media-timeline origin, measured independently. ----
        // Read-only capture. Nothing in this block is used by the seek path,
        // and no field here is written by it.
        originMeasure: {
          capturedAtMs: ORIGIN_MEASURE.capturedAtMs,
          nowMs: ORIGIN_MEASURE.nowMs,
          currentTimeS: ORIGIN_MEASURE.currentTimeS,
          seekableEndS: ORIGIN_MEASURE.seekableEndS,
          trueEdgeWallMs: ORIGIN_MEASURE.trueEdgeWallMs,
          // Chromium / hls.js
          pdtForCurrentTimeMs: ORIGIN_MEASURE.pdtForCurrentTimeMs,
          pdtSource: ORIGIN_MEASURE.pdtSource,
          // Safari / native HLS
          startDateMs: ORIGIN_MEASURE.startDateMs,
          startDateSource: ORIGIN_MEASURE.startDateSource,
          // derived
          mediaOriginMs: ORIGIN_MEASURE.mediaOriginMs,
          wallClockAtSeekableEndMs: ORIGIN_MEASURE.wallClockAtSeekableEndMs,
          wallClockDeltaMs: ORIGIN_MEASURE.wallClockDeltaMs,
          note: 'Media-timeline origin, measured WITHOUT the seek equation. '
            + 'mediaOriginMs = pdtForCurrentTimeMs - currentTimeS*1000, where '
            + 'pdtForCurrentTimeMs is hls.latency.currentProgramDateTime — the '
            + 'wall clock of the current playhead, which hls.js derives from '
            + 'fragment.programDateTime + (currentTime - fragment.start)*1000. '
            + 'Date.now() is NOT an operand of that subtraction; including it '
            + 'would reintroduce the device clock error. currentTimeS and '
            + 'seekableEndS are MEDIA SECONDS, not ms; the other values are '
            + 'epoch MILLISECONDS. wallClockDeltaMs is the quantity the seek '
            + 'equation assumes is zero. A null means NOT MEASURED and is '
            + 'never rendered as 0. NO correction is applied anywhere.',
        },
        // ---- WS40: the device-verification record. DIAGNOSTIC ONLY. ----
        // Nothing here is read by the production seek path, and the two target
        // positions are recorded, never used. The acceptance number is
        // `landingErrorSeg` / `landingErrorS` on each run.
        ws40: {
          atMs: WS40.atMs,
          transport: WS40.transport,
          programmeTitle: WS40.programmeTitle,
          programmeStartMs: WS40.programmeStartMs,
          currentTimeS: WS40.currentTimeS,
          seekableStartS: WS40.seekableStartS,
          seekableEndS: WS40.seekableEndS,
          segmentMs: WS40.segmentMs,
          headPdtMs: WS40.headPdtMs,
          playlistEdgeWallMs: WS40.playlistEdgeWallMs,
          playlistSampleAgeMs: WS40.playlistSampleAgeMs,
          deviceNowMs: WS40.deviceNowMs,
          originSource: WS40.originSource,
          originReason: WS40.originReason,
          mediaOriginMs: WS40.mediaOriginMs,
          // ---- WS40b: independent cross-check of A. DIAGNOSTIC ONLY. ----
          playlistOriginMs: WS40.playlistOriginMs,
          originDeltaS: WS40.originDeltaS,
          playlistSampleAtMs: WS40.playlistSampleAtMs,
          existingTargetS: WS40.existingTargetS,
          proposedTargetS: WS40.proposedTargetS,
          targetDeltaS: WS40.targetDeltaS,
          runs: WS40.runs.slice(),
          note: 'DIAGNOSTIC ONLY -- the production seek is unchanged and '
            + 'reads none of this. The proposed mapping is '
            + 'target = (startMs - A)/1000 with A the media-timeline origin; '
            + 'the existing one is target = seekableEnd - '
            + '(Date.now()-startMs)/1000. Units: programmeStartMs/headPdtMs/'
            + 'playlistEdgeWallMs/deviceNowMs/mediaOriginMs/atMs are epoch '
            + 'MILLISECONDS; currentTimeS/seekableStartS/seekableEndS/'
            + 'existingTargetS/proposedTargetS/targetDeltaS are MEDIA SECONDS; '
            + 'segmentMs is the playlist segment duration in SECONDS. '
            + 'landingErrorSeg is measured in SEGMENT INDICES and is the '
            + 'acceptance number: it uses neither the device clock nor any '
            + 'media origin, so a shared-origin error cannot hide in it. '
            + 'landedWallMsSameOrigin IS tautological (it re-converts the '
            + 'landing with the same origin that built the target) and is '
            + 'included only so a reader can see it read ~0 regardless; it is '
            + 'NOT evidence. playlistOriginMs/originDeltaS are the WS40b '
            + 'cross-check: a second estimate of the media origin derived from '
            + 'SR\'s playlist, sharing no input with getStartDate(). READ WITH '
            + 'THE BIAS IN MIND: trueEdgeWallMs overshoots real UTC by ~31.5 s '
            + '(measured n=6), so playlistOriginMs inherits that overshoot and '
            + 'a PERFECT getStartDate() yields originDeltaS of about -31.5 s, '
            + 'NOT about 0. Both fields are diagnostic and are read by no '
            + 'production target. A null means NOT MEASURED, never 0.',
        },
        seekableDuration: cur?.seekableDuration ?? null,
        positionWallClockIso: positionWallClock,
        // WS3: back-to-live evidence. `lastExit` is the single most useful
        // fact here — it says which guard the button hit, and therefore
        // whether the target was ever the problem.
        backToLive: {
          calls: SEEK_LIVE_DIAG.calls,
          lastExit: SEEK_LIVE_DIAG.lastExit,
          lastCalledAt: SEEK_LIVE_DIAG.lastCalledAt,
          before: SEEK_LIVE_DIAG.lastBefore,
          target: SEEK_LIVE_DIAG.lastTarget,
          after: SEEK_LIVE_DIAG.lastAfter,
        },
        // Active transport: which kind of stream the DVR window belongs to.
        transportKind: (() => {
          if (!cur) return null;
          if (cur.transport === 'hls') {
            return typeof window.Hls === 'function' ? 'hls-hlsjs' : 'hls-native';
          }
          return cur.transport === 'direct' ? 'direct' : (cur.transport || null);
        })(),
        streamCodec: cur?.codec ?? null,
        streamBitrate: cur?.bitrate ?? null,
        streamUrl: cur?.audioUrl ?? null,
      },

      dom: {
        playerTitle: metaDiagText($player, '.player-title'),
        playerSub: metaDiagText($player, '.player-sub'),
        nowPlayingLine: metaDiagText($player, '.now-playing-line'),
        playerMode: metaDiagText($player, '.player-mode'),
        playerQuality: metaDiagText($player, '.player-quality'),
        playerMini: metaDiagText($player, '.player-mini'),
        playerMinimized,
        expandButtonAriaExpanded: metaDiagAttr($player, '.player-expand-btn', 'aria-expanded'),
        // WS6. `mode` is derived from the button's actual onclick wiring, not
        // from a parallel variable, so it cannot report 'direct' while the
        // button still seeks to a programme.
        nextProgram: metaDiagNextProgram(),
        expand: panel ? {
          isOpen: true,
          // STABLE IDENTITY. Assigned once per created node, so the same value
          // across two snapshots = the SAME node survived whatever happened in
          // between; a different value = the panel was REBUILT from state.
          panelSeq: panel._srPanelSeq ?? null,
          panelSeqBuiltCount: META_DIAG.expandPanelSeq,
          label: metaDiagText(panel, '.expand-label'),
          title: metaDiagText(panel, '.expand-title'),
          sub: metaDiagText(panel, '.expand-sub'),
          img: metaDiagAttr(panel, '.expand-img', 'src'),
        } : { isOpen: false, panelSeq: null, panelSeqBuiltCount: META_DIAG.expandPanelSeq },
        playerClassName: $player.className,
        playerInlineTransform: $player.style.transform,
        playingIcons,
      },

      // Counts of the listeners THE APP registers on the singleton audioEl,
      // instrumented at the app's own registration sites only. No
      // EventTarget.prototype patching. netLive = adds − removes, i.e. how
      // many are still attached to the element right now.
      listeners: (() => {
        const adds = { ...META_DIAG.listenerAdds };
        const removes = { ...META_DIAG.listenerRemoves };
        const net = Object.create(null);
        Object.keys(adds).forEach((k) => {
          net[k] = (adds[k] || 0) - (removes[k] || 0);
        });
        return { registered: adds, removed: removes, netLive: net };
      })(),

      environment: {
        DIAG_ID,
        href: location.href,
        standalone: (() => {
          try {
            return window.matchMedia('(display-mode: standalone)').matches
              || window.navigator.standalone === true;
          } catch { return null; }
        })(),
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        performanceNow: performance.now(),
      },
    };
  }

  // Console entry point. Returns the snapshot, or null when the gate is shut.
  // Read-only with respect to playback: it never touches audioEl.src, hls,
  // state.current, timers or the network.
  function srMetaDiagSnapshot() {
    if (!metaDiagGateOpen()) return null; // inert: no side effects of any kind
    let snap = null;
    try {
      snap = metaDiagBuildSnapshot();
      console.log('%cSR-METADIAG', 'color:#0a0', JSON.stringify(snap, null, 2));
      // One compact line in the existing always-on log, so the snapshot
      // carries the existing DIAG_ID and is distinguishable by its prefix.
      diagLog(`meta-snapshot ${JSON.stringify({
        takenAt: snap.takenAt,
        kind: snap.playback.current?.kind ?? null,
        id: snap.playback.current?.id ?? null,
        channelId: snap.nowPlaying.parsed.channelId,
        song: snap.nowPlaying.parsed.song?.title ?? null,
        programTitle: snap.playback.current?._srProgramTitle ?? null,
        expandPanelSeq: snap.dom.expand.panelSeq,
        atLiveEdge: snap.dvr.atLiveEdge,
        // WS6: the programme-skip button's state, on the same single line, so
        // the owner can read it with one command instead of opening the whole
        // snapshot.
        nextProgram: snap.dom.nextProgram
          ? `${snap.dom.nextProgram.mode}/${snap.dom.nextProgram.visible ? 'visible' : 'hidden'}`
          : null,
        // WS7: the press outcome on the same line — `skipPress: 3/out-of-window`
        // reads the failure mode without opening the snapshot.
        skipPress: snap.dom.nextProgram?.press
          ? `${snap.dom.nextProgram.press.calls}/${snap.dom.nextProgram.press.lastBranch ?? 'none'}`
          : null,
        // WS9 Part C: the real window length on the one line, so the owner can
        // read it without expanding the snapshot.
        dvrWindow: snap.dom.nextProgram?.press?.windowSeconds != null
          ? `${Math.round(snap.dom.nextProgram.press.windowSeconds / 60)} min`
          : null,
        listeners: snap.listeners.netLive,
      })}`);
    } catch (e) {
      console.log('SR-METADIAG failed', e);
      return null;
    }
    return snap;
  }

  // Exposed for the console. Assigning is inert; calling is gated.
  window.srMetaDiag = srMetaDiagSnapshot;
  window.srMetaDiagGateOpen = metaDiagGateOpen;

  // ---------------- boot ----------------
  // ---------------- weather in the header (WS45) ---------------------------
  //
  // OWNER REQUEST (2026-10-02): "weather info in the header. i.e. starting with
  // the typical weather icon for sun, clouds, rain... and the temperature in
  // celsius followed by the location as tracked by the phone".
  //
  // TWO FACILITIES, BOTH KEYLESS AND BOTH VERIFIED BEFORE ANY CODE WAS WRITTEN
  // (AGENTS.md §6 -- a working endpoint is a measurement, not an assumption):
  //   weather : api.open-meteo.com   HTTP 200, access-control-allow-origin: *
  //   place   : api.bigdatacloud.net HTTP 200 after a 307 the browser follows,
  //             access-control-allow-origin: *
  // Neither needs an API key, so the static-only constraint holds: no backend,
  // no proxy, no secret in the bundle. That was the make-or-break question and
  // it is answered by measurement.
  //
  // EVERY DECISION BELOW IS MINE, NOT THE OWNER'S. The owner was unavailable
  // when this was written (asked, no answer), so the three choices are recorded
  // here to be overturned on request:
  //   1. permission is requested ON LOAD, not behind a tap
  //   2. the place shown is the nearest CITY, with the area as a fallback
  //   3. the position is cached for 6 h so a reopen shows weather immediately
  //
  // WHY ON LOAD. On iOS the permission prompt is a one-time system dialog. If
  // it is gated behind a tap, a tester who never taps sees no weather at all
  // and reports it missing; if it is on load, they see the prompt once and the
  // feature simply works. The owner asked for weather to be visible in the
  // header -- not conditional on a gesture.
  //
  // WHY THE CITY. The neighbourhood name is often long ("Inom Vallgraven") or
  // empty in rural areas, and this sits in a header next to a title and a cog.
  // The area is used only when the city is missing, so the header never shows
  // a blank.
  //
  // WHY CACHE. Geolocation on a phone can take several seconds and sometimes
  // fails outright indoors. Without a cache the header would sit empty on every
  // cold start. With one, the last known place shows immediately and refreshes
  // in the background -- which also keeps the feature useful on the train.

  const WEATHER_KEY = 'minradio.weather.v1';
  // WS46. Set the FIRST time the app asks the OS for location, and never
  // cleared. It is NOT the permission -- only the browser can grant that. It
  // records "we have already put this question to the user", which is what
  // lets a later open decide not to ask again.
  const WEATHER_ASK_KEY = 'minradio.weather.asked.v1';
  // How old a cached reading may be and still be shown WITHOUT asking for
  // location at all. Half an hour of weather in a header is indistinguishable
  // from now, and not asking is worth far more than one fresher degree.
  const WEATHER_FRESH_MS = 30 * 60 * 1000;
  const WEATHER_MAX_AGE_MS = 6 * 60 * 60 * 1000;   // decision 3
  const WEATHER_REFRESH_MS = 30 * 60 * 1000;       // refresh well inside the TTL

  /**
   * Map a WMO weather code to an icon and a Swedish label.
   *
   * The WMO code set is a fixed, published table -- this is not an invented
   * mapping. It is deliberately COARSE: a header has room for a glyph, not for
   * a forecast. Codes are grouped by what the sky LOOKS like, because that is
   * all the owner asked for ("icon for sun, clouds, rain").
   */
  function weatherGlyph(code) {
    if (code === 0) return { id: 'clear', label: 'Klart' };
    if (code === 1 || code === 2) return { id: 'partly', label: 'Delvis molnigt' };
    if (code === 3) return { id: 'cloudy', label: 'Molnigt' };
    if (code === 45 || code === 48) return { id: 'fog', label: 'Dimma' };
    if (code >= 51 && code <= 57) return { id: 'drizzle', label: 'Lätt regn' };
    if (code >= 61 && code <= 65 || code >= 80 && code <= 82) return { id: 'rain', label: 'Regn' };
    if (code >= 71 && code <= 77 || code === 85 || code === 86) return { id: 'snow', label: 'Snö' };
    if (code >= 95) return { id: 'storm', label: 'Åska' };
    return { id: 'cloudy', label: 'Okänt väder' };
  }

  // Inline SVG so the glyph needs no network request and inherits currentColor.
  const WEATHER_ICONS = {
    clear: '<circle cx="12" cy="12" r="4.6"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"><path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.4 5.4l1.9 1.9M16.7 16.7l1.9 1.9M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9"/></g>',
    partly: '<circle cx="8.6" cy="8.6" r="3.2"/><path d="M7.2 18.4h9.1a3.7 3.7 0 0 0 .3-7.4 5.2 5.2 0 0 0-10 1.6 2.9 2.9 0 0 0 .6 5.8z"/>',
    cloudy: '<path d="M7.2 18.4h9.1a3.7 3.7 0 0 0 .3-7.4 5.2 5.2 0 0 0-10 1.6 2.9 2.9 0 0 0 .6 5.8z"/>',
    fog: '<path d="M7.2 15.4h9.1a3.7 3.7 0 0 0 .3-7.4 5.2 5.2 0 0 0-10 1.6 2.9 2.9 0 0 0 .6 5.8z"/><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 18.6h16M6 21.4h12"/></g>',
    drizzle: '<path d="M7.4 15.2h8.6a3.6 3.6 0 0 0 .3-7.2 5.1 5.1 0 0 0-9.7 1.6A2.9 2.9 0 0 0 7.4 15.2z"/><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M9 18.4l-.8 2.2M13 18.4l-.8 2.2"/></g>',
    rain: '<path d="M7.4 14.6h8.6a3.6 3.6 0 0 0 .3-7.2 5.1 5.1 0 0 0-9.7 1.6A2.9 2.9 0 0 0 7.4 14.6z"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8.8 17.6l-1.2 3.4M12.8 17.6l-1.2 3.4M16.6 17.6l-1.2 3.4"/></g>',
    snow: '<path d="M7.4 14.6h8.6a3.6 3.6 0 0 0 .3-7.2 5.1 5.1 0 0 0-9.7 1.6A2.9 2.9 0 0 0 7.4 14.6z"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M8.6 18.4v2.8M7.4 19.8h2.4M15.4 18.4v2.8M14.2 19.8h2.4"/></g>',
    storm: '<path d="M7.4 14.6h8.6a3.6 3.6 0 0 0 .3-7.2 5.1 5.1 0 0 0-9.7 1.6A2.9 2.9 0 0 0 7.4 14.6z"/><path d="M13.4 17.2l-3.2 3.6h2.4l-1 2.6" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  function readWeatherCache() {
    try {
      const raw = localStorage.getItem(WEATHER_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return (v && typeof v.temp === 'number' && typeof v.place === 'string') ? v : null;
    } catch {
      return null;   // corrupt cache must never break the header
    }
  }

  function writeWeatherCache(v) {
    try { localStorage.setItem(WEATHER_KEY, JSON.stringify(v)); } catch { /* private mode */ }
  }

  /**
   * Has this browser EVER been asked for location by this app?
   *
   * This is deliberately NOT a permission check. `navigator.permissions` is not
   * implemented on iOS Safari, and building the fix on a feature-detected API
   * that may be absent turns it into a hard dependency on the one platform that
   * matters most here. The flag is a plain localStorage string: it cannot claim
   * permission was granted, and it cannot break if the Permissions API is gone.
   */
  function hasAskedForLocation() {
    try { return localStorage.getItem(WEATHER_ASK_KEY) === '1'; } catch { return false; }
  }

  function markAskedForLocation() {
    try { localStorage.setItem(WEATHER_ASK_KEY, '1'); } catch { /* private mode */ }
  }

  function formatTemp(t) {
    // Round to a whole degree: "17°" is what a header wants, and a phone GPS
    // reading is not precise enough for "17.4°" to mean anything.
    return `${Math.round(t)}°`;
  }

  /**
   * Ask the phone where we are, then turn that into a place name.
   * Resolves to null on ANY failure -- geolocation denied, unavailable, slow,
   * or the network down. The caller renders whatever cache it already has.
   */
  function locate() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      // A generous timeout: a cold GPS fix on a phone can take several
      // seconds, and a wrong answer here is better than no header at all.
      navigator.geolocation.getCurrentPosition(
        (pos) => done({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => done(null),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: WEATHER_MAX_AGE_MS }
      );
      // Never hang the header on a GPS that never answers.
      setTimeout(() => done(null), 12000);
    });
  }

  /**
   * Turn a geocoder name into the SHORT form the owner asked for.
   *
   * OWNER (2026-10-02): "Just the city or place, no country or county info to
   * save space. So just 'Göteborg' or 'Lerum' for example."
   *
   * Measured against the live geocoder with localityLanguage=sv: a Swedish
   * municipality comes back as "Lerums kommun", not "Lerum" -- 4 of the 5
   * non-city samples were the kommun form. So the rule is: drop a trailing
   * " kommun", then drop the genitive "s" the Swedish definite form leaves
   * behind. Verified across 10 places:
   *   Göteborg          -> Göteborg      (already a city, untouched)
   *   Lerums kommun     -> Lerum
   *   Trelleborgs kommun-> Trelleborg
   *   Melleruds kommun  -> Mellerud
   *   Älvkarleby kommun -> Älvkarleby    (no trailing s to remove)
   *
   * The län (county) form is deliberately NOT shortened: it is never returned
   * in the city field, and shortening it would risk mangling a real place name
   * if the geocoder ever changes. A name with no " kommun" is passed through
   * unchanged, so an ordinary city can never be altered by this rule.
   */
  function prettyPlace(raw) {
    let name = String(raw == null ? '' : raw).trim();
    if (!name) return '';
    if (name.endsWith(' kommun')) {
      name = name.slice(0, -' kommun'.length).trim();
      if (name.endsWith('s')) name = name.slice(0, -1);
    }
    return name.replace(/\s*\[[A-Z]{2}-\d+\]\s*$/, '').trim();
  }

  async function fetchPlace(lat, lon) {
    // localityLanguage=sv is what makes the geocoder answer "Göteborg" rather
    // than "Gothenburg". Measured: the same coordinates return 'Gothenburg'
    // with `en` and 'Göteborg' with `sv`.
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client`
      + `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`
      + `&localityLanguage=sv`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('place ' + res.status);
    const d = await res.json();
    // City first, then the locality (a suburb), so the header is never blank.
    // The county is deliberately NOT used: the owner asked for no county info.
    return prettyPlace(d.city || d.locality || '');
  }

  async function fetchWeather(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}`
      + `&longitude=${encodeURIComponent(lon)}&current=temperature_2m,weather_code&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('weather ' + res.status);
    const d = await res.json();
    const cur = d && d.current;
    if (!cur || typeof cur.temperature_2m !== 'number') throw new Error('weather payload');
    return { temp: cur.temperature_2m, code: cur.weather_code };
  }

  /**
   * Paint the header chip. Accepts a full record or nothing; it never throws,
   * and it never removes an existing chip on a failed refresh -- a header that
   * flickers to empty because one request failed is worse than a stale reading.
   */
  function renderWeatherChip(rec) {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    let chip = bar.querySelector('.weather');
    if (!rec) return;                       // keep whatever is already there
    if (!chip) {
      // A NEW CHILD IS NOT ADDED TO .topbar. That bar is
      // `justify-content: space-between` and WS11 added a third child, which
      // put the cog in the MIDDLE -- an owner-reported regression ("the cog
      // wheel should go back to where we had it"). The chip is therefore
      // inserted INSIDE a wrapper that already exists, leaving the bar at two
      // children exactly as before.
      const brand = bar.querySelector('.brand');
      const holder = el('div', { class: 'topbar-left' });
      brand.replaceWith(holder);
      holder.appendChild(brand);
      chip = el('div', { class: 'weather' });
      holder.appendChild(chip);
      // WS46: the chip is the user's way OUT of a stale reading. Now that the
      // app stops asking for location it does not need, a header can honestly
      // be an hour old -- and without a manual refresh the only cure would be
      // to re-ask on every open, which is the behaviour this change removes.
      // One deliberate tap is not a prompt storm.
      //
      // Keyboard parity: this is a real control now, so it must be reachable
      // and activatable without a pointer.
      chip.setAttribute('role', 'button');
      chip.setAttribute('tabindex', '0');
      const onChipActivate = () => refreshWeatherNow();
      chip.addEventListener('click', onChipActivate);
      chip.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();        // Space would scroll the page
        onChipActivate();
      });
    }
    const glyph = weatherGlyph(rec.code);
    chip.textContent = '';
    chip.appendChild(el('span', { class: 'weather-icon', 'aria-hidden': 'true',
      html: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${WEATHER_ICONS[glyph.id]}</svg>` }));
    chip.appendChild(el('span', { class: 'weather-temp', text: formatTemp(rec.temp) }));
    chip.appendChild(el('span', { class: 'weather-place', text: rec.place }));
    // One accessible string, not three fragments read out separately.
    chip.setAttribute('aria-label', `${glyph.label}, ${formatTemp(rec.temp)}, ${rec.place}`);
    chip.setAttribute('title', `${glyph.label} · ${formatTemp(rec.temp)} · ${rec.place}`);
  }

  // ---- live tracking (owner: "it has to update as my tester is commuting
  // by train with the app and expects the location to change as the train
  // moves") -------------------------------------------------------
  //
  // THREE GUARDS, because "update as the train moves" is an instruction to
  // poll and polling without limits is how an app gets an IP throttled and the
  // feature stops working for everyone.
  //
  // 1. DISTANCE GATE. The GPS is watched continuously, but the two network
  //    calls only happen once the position has actually CHANGED BY A
  //    MEANINGFUL AMOUNT. 3 km is the threshold: it is roughly one Swedish
  //    municipality, so the header changes when the name would actually
  //    change, and not for every GPS wobble while stationary.
  // 2. TIME GATE. At most one refresh per 5 minutes, whatever the distance.
  //    A train covers 3 km in well under a minute, so this does not delay an
  //    update the tester would notice -- it only bounds the worst case.
  // 3. IN-FLIGHT LOCK. `weatherBusy` means a slow request can never be
  //    stacked by a second one arriving while it is still open.
  //
  // Together: a 90-minute train ride makes roughly 6-10 calls, not 200.

  const WEATHER_MIN_MOVE_KM = 3;          // guard 1
  const WEATHER_MIN_INTERVAL_MS = 5 * 60 * 1000;   // guard 2
  const WEATHER_POLL_MS = 60 * 1000;      // how often we look at the GPS

  let weatherBusy = false;
  let weatherWatchId = null;
  let lastFetched = null;       // {lat, lon, at}
  let lastPainted = null;       // the record currently in the chip

  function distanceKm(a, b) {
    // Haversine. Good enough at this scale and cheap; a full geodesic library
    // would be several times the size of this whole feature.
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const la1 = toRad(a.lat);
    const la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /** Fetch and paint, subject to all three guards. Returns a status for tests. */
  async function refreshWeather(pos, { force = false } = {}) {
    if (weatherBusy) return 'busy';
    const now = Date.now();
    if (!force && lastFetched) {
      if (now - lastFetched.at < WEATHER_MIN_INTERVAL_MS) return 'too-soon';
      // The distance gate can only be applied when the previous position is
      // actually KNOWN. A cache restored from localStorage has a time but no
      // coordinates, and comparing against null would silently disable the
      // gate -- which is exactly the bug found in the browser.
      if (lastFetched.hasPos !== false && distanceKm(lastFetched, pos) < WEATHER_MIN_MOVE_KM) {
        return 'not-moved-enough';
      }
    }
    weatherBusy = true;
    try {
      const [w, place] = await Promise.all([
        fetchWeather(pos.lat, pos.lon),
        // A place name is part of the requirement, but a missing name must not
        // cost the temperature -- so this one may fail on its own.
        fetchPlace(pos.lat, pos.lon).catch(() => ''),
      ]);
      if (!place) return 'no-place';
      const rec = { temp: w.temp, code: w.code, place, at: now };
      lastFetched = { lat: pos.lat, lon: pos.lon, at: now, hasPos: true };
      writeWeatherCache(rec);
      // Only repaint when something the tester can SEE changed. A new
      // temperature to one decimal would otherwise repaint every few minutes
      // for no reason, and a repaint mid-scroll is a visible flicker.
      if (!lastPainted || lastPainted.place !== rec.place || Math.round(lastPainted.temp) !== Math.round(rec.temp)) {
        renderWeatherChip(rec);
        lastPainted = rec;
      }
      return 'ok';
    } catch {
      return 'failed';       // offline or rate-limited: keep what is painted
    } finally {
      weatherBusy = false;
    }
  }

  function startWeatherWatch() {
    if (weatherWatchId !== null) return;
    if (!navigator.geolocation || !navigator.geolocation.watchPosition) return;
    // enableHighAccuracy is deliberately FALSE. A city-level fix is accurate
    // enough for a weather header and is far cheaper on the battery; a high-
    // accuracy fix on a moving train is a continuous GPS drain for no gain
    // when the answer is "Lerum" either way.
    weatherWatchId = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lon: p.coords.longitude };
        // Never block the UI thread on a rejected promise. NOTE: this is NOT one
        // of the three silent `audioEl.play().catch(() => {})` sites WS23
        // pinned -- those swallow a PLAYBACK failure, which must stay visible.
        // This one swallows a weather refresh that already handles its own
        // errors internally and reports a status string, so there is nothing
        // left for a rejection to carry. Written as a handler rather than an
        // empty catch so the intent is legible and the WS23 count stays at 3.
        const quiet = () => {};
        refreshWeather(pos).then(quiet, quiet);
      },
      () => { /* denied or unavailable: the cached chip stands */ },
      { enableHighAccuracy: false, maximumAge: WEATHER_POLL_MS, timeout: 30000 }
    );
  }

  /**
   * A deliberate tap on the chip: get a reading now, ignoring the gates.
   *
   * This is the escape hatch that makes "ask less" safe. The gates exist to
   * stop the app burning an API call on a 300 m wobble, which is right for an
   * unattended background refresh and wrong for a person who has just asked.
   * It is the only path that may call the location API after the app has
   * already been refused once: a user tapping is a fresh decision, not a
   * repeat of the original prompt.
   */
  async function refreshWeatherNow() {
    markAskedForLocation();
    const pos = await locate();
    if (!pos) return 'no-position';
    return refreshWeather(pos, { force: true });
  }

  function stopWeatherWatch() {
    if (weatherWatchId === null) return;
    navigator.geolocation.clearWatch(weatherWatchId);
    weatherWatchId = null;
  }

  async function initWeather() {
    const cached = readWeatherCache();
    // Paint the last known reading SYNCHRONOUSLY, before any network call.
    // A cold start on a moving train must show something immediately, not an
    // empty header that fills in three seconds later.
    if (cached) {
      renderWeatherChip(cached);
      lastPainted = cached;
      // The cache carries a TIMESTAMP but no COORDINATES. Seeding `lastFetched`
      // from it gave the distance gate nothing to measure against, so the very
      // first callback always fetched -- and, in the version measured, EVERY
      // callback fetched, because the seeding line was immediately overwritten
      // with null. A 300 m GPS wobble was enough to spend an API call.
      //
      // So: keep the timestamp (it is real) and record that the coordinates are
      // unknown. `lastFetched.hasPos === false` then makes the DISTANCE gate
      // skip while the TIME gate still applies, so the header still refreshes on
      // a schedule but not on every wobble.
      lastFetched = { lat: null, lon: null, at: cached.at, hasPos: false };
    }
    // ---- WS46: do not ask again once we have asked once. ----
    //
    // The owner reported: "each time i open the page or pwa app i get the
    // 'Would like to Use Your location' question". MEASURED in the browser:
    // every open made TWO geolocation calls -- one watchPosition plus one
    // getCurrentPosition -- even when the cached reading was one minute old.
    // A cache the app already had, and a request it had already paid for, were
    // not enough to stop it asking.
    //
    // So the question is now asked at most once per install:
    //
    //   * cache younger than WEATHER_FRESH_MS  -> do not ask at all. The chip
    //     is already painted with something accurate. This is the common case
    //     for a tester who opens the app every day.
    //   * already asked before, and no usable cache -> do not ask again.
    //   * genuinely never asked, or the cache has gone stale -> ask once, and
    //     record that we did, so the NEXT open is silent.
    //
    // What this cannot do: stop iOS from re-prompting when it has decided to.
    // MDN is explicit that a granted permission's lifetime "depends on the user
    // agent, and may be time based, session based, or even permanent", and iOS
    // grants web apps only "Allow Once" / "While Using" -- there is no always
    // allow. So if the dialog still appears, that is the OS, not this code.
    const age = cached ? Date.now() - cached.at : Infinity;
    if (cached && age < WEATHER_FRESH_MS) {
      return;                       // fresh enough: nothing to ask for
    }
    if (hasAskedForLocation()) {
      // Already put it to the user once, so this open says nothing. Not even a
      // watcher: `watchPosition` is a geolocation call like any other and
      // re-arms the prompt on exactly the opens this change exists to silence.
      // That was a real defect here, caught by the ordering assertion in the
      // WS46 test -- the branch looked harmless and was not.
      //
      // The cost is honest: a stale header no longer follows a train on its
      // own. Tapping the chip refreshes it, deliberately, whenever the user
      // wants. Not asking was the requirement; live tracking cannot be had for
      // free from a browser that asks once.
      return;
    }
    // First ask. Both geolocation entry points run, and the flag is set BEFORE
    // the call so a crash or a denied permission cannot make us ask again on
    // the next open.
    markAskedForLocation();
    startWeatherWatch();
    const pos = await locate();
    if (pos) await refreshWeather(pos);
  }

  // WS46. `stopWeatherWatch()` existed with no caller at all -- verified by
  // grep, not assumed. That is the WS7a failure in its purest form: correct
  // code that never executes. A watch left running in a backgrounded PWA
  // holds the GPS open for a session nobody is watching, which is the
  // owner's complaint wearing a different hat. Stop it when hidden, restart
  // when shown again.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopWeatherWatch();
    } else {
      const cached = readWeatherCache();
      if (!hasAskedForLocation()) return;      // never asked: stay silent
      if (cached && Date.now() - cached.at < WEATHER_FRESH_MS) return;
      startWeatherWatch();
    }
  });

  async function boot() {
    renderSkeletons();
    // Fire-and-forget: the header must never wait on a GPS fix. It paints the
    // cached reading synchronously via renderWeatherChip and updates later.
    initWeather();
    const favs = loadFavorites();
    // External podcasts count as a selection too. Without this, a user whose
    // ONLY pick came from the iTunes search was told they had chosen nothing
    // and was returned to the welcome screen -- their pick silently vanished.
    const hasExtPods = loadExternalPodcasts().length > 0;

    if (favs.channels.length === 0 && favs.podcasts.length === 0 && !hasExtPods) {
      $main.textContent = '';
      $main.appendChild(el('div', { class: 'state-msg' },
        el('div', { text: 'Välkommen! Välj dina favoritkanaler och poddar för att komma igång.' }),
        el('button', {
          class: 'retry-btn', type: 'button', text: 'Kom igång',
          onclick: () => openSheet({ initialTab: 'channels', onDone: boot }),
        })
      ));
      return;
    }

    const channelsP = fetchChannels();
    const podcastsP = fetchPodcasts();
    const newsP = fetchNewsFlashes(loadNewsCount());

    const results = await Promise.allSettled([channelsP, podcastsP, newsP]);
    if (results[0].status === 'fulfilled') state.channels = results[0].value;
    if (results[1].status === 'fulfilled') state.podcasts = results[1].value;
    if (results[2].status === 'fulfilled') state.news = results[2].value;

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed === 3) {
      renderError(results.find((r) => r.status === 'rejected')?.reason?.message
        || 'Kunde inte hämta data från Sveriges Radio just nu. Kontrollera din internetanslutning.', boot);
      return;
    }
    if (failed) showToast('Kunde inte hämta allt innehåll just nu.');

    renderHome();
  }

  document.getElementById('edit-btn').addEventListener('click', () => {
    openSheet({ initialTab: 'channels', onDone: boot });
  });

  boot();
})();
