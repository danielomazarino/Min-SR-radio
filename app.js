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

  function unescapeXml(s) {
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function stripTags(s) {
    return unescapeXml(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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
        audioUrl: null,
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
  };

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
  const LIVE_EDGE_TOLERANCE_S = 10;
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
  const nowPlaying = { song: null, artwork: null, channelId: null, timeline: [],
    // WS13 Part B: the iTunes album cover for an EPISODE. Kept separate from
    // nowPlaying.artwork on purpose -- that field belongs to the live poll's
    // position-aware song, and mixing the two would make one kind's cover
    // overwrite the other's. Null until a real track cover resolves.
    episodeArtwork: null };
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
        refreshNowPlayingArtwork(next, nowPlaying);
      }
    }
  }

  function stopNowPlayingPoll() {
    if (nowPlayingTimer) { clearTimeout(nowPlayingTimer); nowPlayingTimer = null; }
    nowPlayingSeq += 1; // invalidate in-flight responses
    artworkSeq += 1; // an old live artwork response must not outlive the channel
    nowPlaying.song = null;
    nowPlaying.artwork = null;
    nowPlaying.channelId = null;
    // WS9: the timeline is per-channel, so it must not survive a channel switch
    // or the entries would be matched against another channel's playhead.
    nowPlaying.timeline = [];
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
      refreshNowPlayingArtwork(nowPlaying.song, nowPlaying);
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
  async function refreshNowPlayingArtwork(song, target) {
    const seq = ++artworkSeq;
    const isLive = target === nowPlaying;
    if (!song || !song.title || !song.artist) {
      // No usable song: clear only our own field, never the other kind's.
      if (isLive) { nowPlaying.artwork = null; paintNowPlaying(); }
      else { nowPlaying.episodeArtwork = null; }
      return;
    }
    const key = `${song.artist}|${song.title}`.toLowerCase();
    if (artworkCache.has(key)) {
      if (isLive) { nowPlaying.artwork = artworkCache.get(key); paintNowPlaying(); }
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
      if (isLive) { nowPlaying.artwork = big; paintNowPlaying(); }
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
      } else {
        line.textContent = `♪ ${song.artist ? song.artist + ' – ' : ''}${song.title}`;
        line.classList.add('has-song');
      }
    }
    // If the expand panel is open, repaint its song view too.
    const panel = $player.querySelector('.player-expand');
    if (panel && typeof panel._srRepaint === 'function') {
      panel._srRepaint();
      // WS15: this early return was the second half of the podcast bug. Even
      // with the kind === 'live' gate below removed, an episode would still
      // RETURN here before reaching the MediaSession refresh -- and an episode
      // is exactly the case that needs it. Removed deliberately; the comment
      // about "the episode painter deliberately has no compact song line"
      // describes why the compact line is skipped, not why the car should
      // stop hearing about the song.
    }
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
    const panel = $player.querySelector('.player-expand');
    if (panel && typeof panel._srRepaint === 'function') panel._srRepaint();
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
  function playheadWallMs() {
    const end = state.current ? state.current.seekableEnd : null;
    if (!Number.isFinite(end)) return Date.now();
    return Date.now() - (end - (audioEl.currentTime || 0)) * 1000;
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
    const atMs = playheadWallMs();

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

  if (mediaSession) {
    const safeSeek = (fn) => { try { fn(); } catch { /* live streams may reject */ } };
    try {
      mediaSession.setActionHandler('play', () => audioEl.play().catch(() => {}));
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
      const curSong = cur.kind === 'episode'
        ? episodeCurrentTrack
        : pickByPosition(nowPlaying.timeline, playheadWallMs());
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
      const metaArtist = songArtist
        ? [programme, channel].filter(Boolean).join(' · ')
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
      const artworkSrc = (cur.kind === 'live' ? nowPlaying.artwork : null)
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
  // So we aim slightly BEHIND the edge instead. LIVE_EDGE_TOLERANCE_S is the
  // same tolerance updateSeekableState() uses to decide "at live", so the
  // result is still classified as live while giving the browser a real,
  // non-boundary target.
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

  function seekToLive() {
    const cur = state.current;
    const d = SEEK_LIVE_DIAG;
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
    const target = Math.max(start, end - LIVE_EDGE_TOLERANCE_S);
    if (!Number.isFinite(target)) { d.lastExit = 'non-finite-target'; return; }
    d.lastTarget = target;
    d.lastExit = 'seeked';
    audioEl.currentTime = target;
    updateSeekableState();
    renderPlayer();
    // Read back what the element ACTUALLY accepted — the seek may be rejected
    // or clamped by the browser, which is exactly what we need to see.
    const now = state.current;
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
  async function fetchSchedule(channelId) {
    return fetchScheduleDay(channelId, localDateStr());
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
    const target = end - behindMs / 1000;
    const start = Number.isFinite(cur.seekableStart) ? cur.seekableStart : 0;
    if (target < start) { d.lastBranch = 'out-of-window'; d.lastTarget = target; d.lastAfter = null; return; }
    d.lastBranch = 'seeked';
    d.lastTarget = target;
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
    if (!cur || !cur.dvrAvailable) return;
    const end = cur.seekableEnd;
    if (!Number.isFinite(end)) return;
    const behindMs = Date.now() - startMs;
    if (behindMs < 0) return; // future programme — nothing to seek to yet
    const target = end - behindMs / 1000;
    const start = Number.isFinite(cur.seekableStart) ? cur.seekableStart : 0;
    if (target < start) {
      showToast('Programmet ligger utanför spolbart område (3 timmar).');
      return;
    }
    audioEl.currentTime = target;
    updateSeekableState();
    renderPlayer();
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
    // channel switch, and it does not re-fetch the schedule.
    scheduleNowPlayingPoll();
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
    const metaRowTop = el('div', { class: 'player-meta-row' },
      identityName,
      isLive ? mode : null);
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
        // Same source of truth as paintNowPlaying: episodes read the
        // ondemand track at the current position; live reads rightnow.
        const isEpisode = live.kind === 'episode';
        const song = isEpisode ? episodeCurrentTrack : nowPlaying.song;
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
          : nowPlaying.artwork;
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
        const prevEv = programBoundary(schedule, posMs(), -1);
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
    const headerLine = el('div', { class: 'player-header' },
      headerSpacer,
      el('div', { class: 'player-title', text: cur.title || '' }),
      live
        ? el('div', { class: 'player-sub', text: cur._srProgramTitle || cur.subtitle || 'Direkt' })
        : null,
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
    const songLine = el('div', { class: 'now-playing-line', 'aria-live': 'polite' });

    $player.appendChild(headerLine);
    $player.appendChild(el('div', { class: 'player-row' }, thumb, meta, controls));
    if (songLine) $player.appendChild(songLine);
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
      const list = favs[kind];

      const sec = el('section', { class: 'section', 'aria-label': title },
        el('h2', { class: 'section-title', text: title }));
      const scroller = el('div', { class: 'icon-scroller', role: 'list' });

      if (!list.length) {
        scroller.appendChild(el('div', { class: 'icon-empty', 'aria-hidden': 'true' }));
      }
      for (const id of list) {
        const item = catalogue.find((c) => c.id === id);
        if (!item) continue; // unknown id — skip silently
        const btn = el('button', {
          class: `stream-icon${isPod ? ' pod-icon' : ''}`,
          type: 'button',
          role: 'listitem',
          'data-stream-key': isPod ? `pod:${item.id}` : `live:${item.id}`,
          'data-stream-title': item.name,
          ...(isPod ? { 'data-stream-label': `Spela senaste avsnittet av ${item.name}` } : {}),
          'aria-pressed': 'false',
          'aria-label': isPod ? `Spela senaste avsnittet av ${item.name}` : `Spela ${item.name}`,
          onclick: () => (isPod ? playPodcast(item.id) : toggleTrack({
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
    const close = () => {
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
    let searchInput;
    let doneBtn;

    function updateCounter() {
      const n = picks[tab].length;
      counter.textContent = tab === 'channels'
        ? `Kanaler (${n} valda)`
        : `Poddar (${n} valda)`;
    }

    function doneBtnState() {
      const total = picks.channels.length + picks.podcasts.length;
      doneBtn.disabled = total === 0;
      doneBtn.textContent = 'Spara';
      doneBtn.title = total === 0 ? 'Välj minst en kanal eller podd först' : '';
    }

    function togglePick(kind, id) {
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
      if (!all.length) {
        listWrap.appendChild(el('div', { class: 'state-msg', text: 'Inga träffar.' }));
        return;
      }
      for (const item of all) {
        const selected = picks[tab].includes(item.id);
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
        const sub = tab === 'channels' ? item.channeltype : item.description;
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
          items.podcasts = q
            ? all.filter((p) => p.name.toLowerCase().includes(q))
            : all;
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

    searchInput = el('input', {
      class: 'search-input', type: 'search',
      placeholder: 'Sök podd…', 'aria-label': 'Sök podd',
    });
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadItems('podcasts', searchInput.value.trim()), 300);
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
      const list = loadFavorites()[kind];
      if (!list.length) {
        group.appendChild(el('div', { class: 'selected-empty', text: 'Inga valda ännu.' }));
        return group;
      }
      list.forEach((id, pos) => {
        const item = catalogue.find((c) => c.id === id);
        if (!item) return;
        const rowEl = el('div', { class: 'selected-item', draggable: 'true', 'data-id': String(id) },
          el('span', { class: 'selected-grip', 'aria-hidden': 'true',
            html: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 5h2v2H9zM13 5h2v2h-2zM9 9h2v2H9zM13 9h2v2h-2zM9 13h2v2H9zM13 13h2v2h-2zM9 17h2v2H9zM13 17h2v2h-2z"/></svg>' }),
          el('span', { class: 'selected-pos', text: String(pos + 1) }),
          item.image
            ? el('img', { class: 'selected-logo', src: item.image, alt: '', loading: 'lazy' })
            : el('span', { class: 'selected-logo selected-letter', text: item.name.slice(0, 1) }),
          el('span', { class: 'selected-name', text: item.name }));
        const controls = el('div', { class: 'selected-controls' });
        controls.appendChild(el('button', {
          class: 'selected-btn', type: 'button',
          'aria-label': `Flytta ${item.name} uppåt`,
          disabled: pos === 0 ? '' : null,
          html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 14l5-5 5 5z"/></svg>',
          onclick: () => {
            const favs = loadFavorites();
            if (moveFavorite(favs, kind, id, 'up')) {
              saveFavorites(favs);
              rebuildSelected();
            }
          },
        }));
        controls.appendChild(el('button', {
          class: 'selected-btn', type: 'button',
          'aria-label': `Flytta ${item.name} nedåt`,
          disabled: pos === list.length - 1 ? '' : null,
          html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>',
          onclick: () => {
            const favs = loadFavorites();
            if (moveFavorite(favs, kind, id, 'down')) {
              saveFavorites(favs);
              rebuildSelected();
            }
          },
        }));
        rowEl.appendChild(controls);
        group.appendChild(rowEl);
      });
      enableDragSort(group, kind);
      return group;
    }

    /**
     * Drag-and-drop reordering within a selected group.
     * Desktop: HTML5 drag events. Touch: long-press (250 ms) starts a drag;
     * the row follows the finger vertically and drops into place.
     */
    function enableDragSort(group, kind) {
      let dragId = null;

      const persist = () => {
        const order = [...group.querySelectorAll('.selected-item')]
          .map(r => Number(r.dataset.id));
        const favs = loadFavorites();
        favs[kind] = order;
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
        touchState = { id, row, startY: e.touches[0].clientY, started: false, timer: setTimeout(() => {
          touchState.started = true;
          row.classList.add('dragging');
          if (navigator.vibrate) navigator.vibrate(10);
        }, 250) };
      }, { passive: true });
      group.addEventListener('touchmove', (e) => {
        if (!touchState) return;
        const y = e.touches[0].clientY;
        if (!touchState.started) {
          if (Math.abs(y - touchState.startY) > 10) clearTimeout(touchState.timer);
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

  function metaDiagGateOpen() {
    let q = '';
    try { q = String(location.search || ''); } catch { q = ''; }
    if (q.indexOf(META_DIAG_QUERY) === -1) return false;
    let flag = null;
    try { flag = localStorage.getItem(META_DIAG_FLAG); } catch { flag = null; }
    return flag === 'on';
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
          artwork: nowPlaying.artwork,
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
        parsed: (META_DIAG.lastScheduleParsed || []).map((e) => ({
          startMs: e.startMs, endMs: e.endMs, title: e.title,
        })),
      },

      episodeTracks: {
        currentTrack: episodeCurrentTrack,
        cacheKeys: Array.from(episodeTracksCache.keys()),
        trackSeq: episodeTrackSeq,
      },

      dvr: {
        atLiveEdge: cur?.atLiveEdge ?? null,
        distanceFromLiveEdge: cur?.distanceFromLiveEdge ?? null,
        seekableStart: cur?.seekableStart ?? null,
        seekableEnd: cur?.seekableEnd ?? null,
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
  async function boot() {
    renderSkeletons();
    const favs = loadFavorites();

    if (favs.channels.length === 0 && favs.podcasts.length === 0) {
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
