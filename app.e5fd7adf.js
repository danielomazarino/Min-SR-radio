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

(() => {
  'use strict';

  // ---------------- constants ----------------
  const FAVORITES_KEY = 'minradio.favorites.v1';
  const MAX_FAVORITES = 4;
  const FETCH_TIMEOUT_MS = 10000;
  const SEEK_STEP_S = 15;
  const APP_VERSION = '1.5.0';
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
      if (v === undefined || v === null) continue;
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
    const s = Math.round(sec % 60);
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
  const audioEl = new Audio();
  audioEl.preload = 'none';

  const $player = el('div', { class: 'player', 'aria-label': 'Spelare' });
  document.body.appendChild($player);

  let lastPlayingKey = null; // `${kind}:${id}` of what's loaded

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

  // ---- live stream resolver ----
  // Builds an ordered candidate list per channel and falls back automatically
  // when a stream fails to play. Order (verified 2026-09-21, see
  // ENHANCEMENTS.md stream report):
  //   1. P2 (id 163): FLAC-in-Ogg at edge1.sr.se/p2-flac — lossless, plays in
  //      Chromium & Safari. Undocumented by SR → MP3 must stay as fallback.
  //   2. iOS/Safari: official AAC template srapi/{id}-hi-aac-http → 320 kbps.
  //      Safari plays raw ADTS natively; Chromium does not (verified).
  //   3. Official MP3 (liveaudio.url from the API) — works everywhere.
  // Android/Chrome is Chromium-based → raw ADTS AAC fails there too, so
  // Android intentionally keeps MP3.
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const P2_FLAC_URL = 'https://edge1.sr.se/p2-flac';

  function liveCandidates(channel) {
    const cands = [];
    if (channel.id === 163 && channel.liveaudioUrl) cands.push(P2_FLAC_URL);
    if (IS_IOS && channel.id) {
      cands.push(`https://www.sverigesradio.se/topsy/direkt/srapi/${channel.id}-hi-aac-http`);
    }
    if (channel.liveaudioUrl) cands.push(channel.liveaudioUrl);
    return cands;
  }

  // Remembers which candidate index last played successfully per stream key,
  // so pause/resume doesn't retry a known-bad candidate.
  const workingStreamIdx = new Map();

  function isCurrent(kind, id) {
    return state.current && state.current.kind === kind && state.current.id === id;
  }

  function playTrack(track) {
    state.current = track;
    lastPlayingKey = `${track.kind}:${track.id}`;
    let srcUrl = track.audioUrl;
    if (Array.isArray(track.candidates) && track.candidates.length) {
      const key = lastPlayingKey;
      const idx = Math.min(workingStreamIdx.get(key) || 0, track.candidates.length - 1);
      track.candidateIndex = idx;
      srcUrl = track.candidates[idx];
      track.audioUrl = srcUrl;
    }
    if (audioEl.src !== srcUrl) {
      audioEl.src = srcUrl;
    }
    audioEl.play().catch(() => {
      showToast('Kunde inte starta uppspelning. Försök igen.');
    });
    renderPlayer();
    updatePlayingMarks();
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
    audioEl.pause();
    audioEl.removeAttribute('src');
    state.current = null;
    lastPlayingKey = null;
    $player.classList.remove('visible');
    $player.textContent = '';
    updatePlayingMarks();
  }

  audioEl.addEventListener('error', () => {
    const cur = state.current;
    // Resolver fallback: try the next candidate before giving up.
    if (cur && Array.isArray(cur.candidates)
        && cur.candidateIndex < cur.candidates.length - 1) {
      cur.candidateIndex += 1;
      cur.audioUrl = cur.candidates[cur.candidateIndex];
      workingStreamIdx.set(lastPlayingKey, cur.candidateIndex);
      audioEl.src = cur.audioUrl;
      audioEl.play().catch(() => {});
      renderPlayer();
      return;
    }
    if (cur) showToast('Uppspelningsfel. Försök igen.');
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
  }

  ['play', 'pause', 'ended'].forEach((ev) => audioEl.addEventListener(ev, () => {
    if (ev === 'play' && state.current && Array.isArray(state.current.candidates)) {
      workingStreamIdx.set(lastPlayingKey, state.current.candidateIndex || 0);
    }
    updatePlayingMarks();
    if (ev === 'pause' || ev === 'play') renderPlayer();
  }));

  function renderPlayer() {
    const cur = state.current;
    if (!cur) return;
    $player.classList.add('visible');
    $player.textContent = '';

    const live = cur.kind === 'live';

    const thumb = el('div', { class: 'player-thumb', 'aria-hidden': 'true' },
      cur.artwork
        ? el('img', { src: cur.artwork, alt: '' })
        : el('span', { class: 'player-thumb-letter', text: (cur.title || '?').slice(0, 1) }));

    const fmt = streamFormatLabel(cur.audioUrl);
    const quality = fmt
      ? el('span', { class: 'player-quality', text: fmt, 'data-format': fmt })
      : null;

    const meta = el('div', { class: 'player-meta' },
      el('div', { class: 'player-title', text: cur.title || '' }),
      el('div', { class: 'player-sub', text: cur.subtitle || (live ? 'Direkt' : '') }),
      quality);

    // Live streams: enrich the badge with the real bitrate from icy-br.
    // Skipped for FLAC — icy-br is unreliable there (reports 128 for a
    // lossless stream).
    if (live && cur.audioUrl && quality && streamFormatLabel(cur.audioUrl) !== 'FLAC') {
      const key = lastPlayingKey;
      fetchStreamBitrate(cur.audioUrl).then((br) => {
        if (!br || lastPlayingKey !== key) return; // track changed meanwhile
        const badge = $player.querySelector('.player-quality');
        if (badge) badge.textContent = `${badge.dataset.format} · ${br} kbps`;
      });
    }

    let seekRow = null;
    if (!live) {
      const bar = el('div', { class: 'seek-bar' }, el('div', { class: 'seek-fill' }));
      const timeLeft = el('div', { class: 'player-time', text: '' });
      const timeRight = el('div', { class: 'player-time', text: '' });
      seekRow = el('div', { class: 'seek-row' }, timeLeft, bar, timeRight);
      const fill = bar.firstChild;

      const upd = () => {
        const d = Number.isFinite(audioEl.duration) && audioEl.duration > 0
          ? audioEl.duration
          : (cur.duration || 0);
        const t = audioEl.currentTime || 0;
        if (d > 0) fill.style.width = `${Math.min(100, (t / d) * 100)}%`;
        timeLeft.textContent = fmtDur(t) || '0:00';
        timeRight.textContent = d ? fmtDur(d) : '';
      };
      if (audioEl._srUpd) audioEl.removeEventListener('timeupdate', audioEl._srUpd);
      audioEl._srUpd = upd;
      audioEl.addEventListener('timeupdate', upd);
      upd();

      bar.addEventListener('click', (e) => {
        const d = Number.isFinite(audioEl.duration) && audioEl.duration > 0
          ? audioEl.duration : cur.duration;
        if (!d) return;
        const rect = bar.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        audioEl.currentTime = frac * d;
      });
    }

    const backBtn = live ? null : el('button', {
      class: 'player-btn', type: 'button', 'aria-label': 'Bakåt 15 sekunder',
      html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>',
      onclick: () => { audioEl.currentTime = Math.max(0, audioEl.currentTime - SEEK_STEP_S); },
    });

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

    const fwdBtn = live ? null : el('button', {
      class: 'player-btn', type: 'button', 'aria-label': 'Framåt 15 sekunder',
      html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 6v12l8.5-6L13 6zM3 18l8.5-6L3 6v12z"/></svg>',
      onclick: () => {
        const d = Number.isFinite(audioEl.duration) && audioEl.duration > 0
          ? audioEl.duration : cur.duration;
        if (d) audioEl.currentTime = Math.min(d, audioEl.currentTime + SEEK_STEP_S);
      },
    });

    const closeBtn = el('button', {
      class: 'player-btn player-btn-close', type: 'button', 'aria-label': 'Stäng spelaren',
      text: '✕',
      onclick: stopAndClosePlayer,
    });

    const controls = el('div', { class: 'player-controls' });
    if (backBtn) controls.appendChild(backBtn);
    controls.appendChild(playPause);
    if (fwdBtn) controls.appendChild(fwdBtn);

    $player.appendChild(closeBtn);
    $player.appendChild(el('div', { class: 'player-row' }, thumb, meta, controls));
    if (seekRow) $player.appendChild(seekRow);
  }

  // ---------------- playback actions ----------------
  async function playPodcast(programId) {
    const pod = state.podcasts.find((p) => p.id === programId);
    if (!pod) return;
    if (isCurrent('episode', programId) === false && audioEl._podProgramId === programId && state.current) {
      // same program already loaded → just toggle
      toggleTrack(state.current);
      return;
    }
    showToast('Hämtar senaste avsnittet…', 2000);
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
      });
    } catch (err) {
      showToast(err.message || 'Kunde inte hämta avsnittet.');
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
      class: 'reader-source', href: item.url, target: '_blank', rel: 'noopener',
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
            candidates: liveCandidates(item),
          })),
        });
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
    const newsSection = el('section', { class: 'section' },
      el('h2', { class: 'section-title', text: 'Nyheter' }));
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

    $main.appendChild(el('p', { class: 'attribution' },
      'Data från ',
      el('a', { href: 'https://sverigesradio.se', target: '_blank', rel: 'noopener', text: 'Sveriges Radio' })));

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
    body.appendChild(el('p', { class: 'about-version', text: `Version ${APP_VERSION} · Utvecklad av ${APP_DEVELOPER}` }));

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

  // ---------------- bottom sheet (selection UI) ----------------
  function closeSheet() {
    $sheetRoot.textContent = '';
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
    // position the bubble once the sheet is laid out
    requestAnimationFrame(syncBubble);
    window.addEventListener('resize', syncBubble);

    // Structure: header → Info + Spara row → Antal nyheter → Välj favoriter
    sheet.appendChild(el('div', { class: 'sheet-grab', 'aria-hidden': 'true' }));
    sheet.appendChild(el('div', { class: 'sheet-header' }, title));
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

    // Swipe down on the grab handle/header closes the sheet (the grab line
    // indicates this). Horizontal intent is ignored so the list still scrolls.
    enableSwipeToClose(overlay, sheet, () => { closeSheet(); onDone?.(); }, { axis: 'y' });

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

  // register service worker with a path that works under any base URL
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const swUrl = new URL('sw.js', document.baseURI).href;
      navigator.serviceWorker.register(swUrl).catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

  boot();
})();
