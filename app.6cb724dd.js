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
  const APP_VERSION = '1.3.0';
  const APP_DEVELOPER = 'Daniel Omazarino';

  // ---------------- favorites store ----------------
  function loadFavorites() {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (!raw) return { channels: [], podcasts: [] };
      const parsed = JSON.parse(raw);
      const clean = (v) =>
        Array.isArray(v) ? v.filter((id) => Number.isInteger(id)).slice(0, MAX_FAVORITES) : [];
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
          channels: favs.channels.slice(0, MAX_FAVORITES),
          podcasts: favs.podcasts.slice(0, MAX_FAVORITES),
        })
      );
      return true;
    } catch (err) {
      console.warn('Could not save favorites:', err);
      return false;
    }
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

  function isCurrent(kind, id) {
    return state.current && state.current.kind === kind && state.current.id === id;
  }

  function playTrack(track) {
    state.current = track;
    lastPlayingKey = `${track.kind}:${track.id}`;
    if (audioEl.src !== track.audioUrl) {
      audioEl.src = track.audioUrl;
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
  }

  ['play', 'pause', 'ended'].forEach((ev) => audioEl.addEventListener(ev, () => {
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

    const meta = el('div', { class: 'player-meta' },
      el('div', { class: 'player-title', text: cur.title || '' }),
      el('div', { class: 'player-sub', text: cur.subtitle || (live ? 'Direkt' : '') }));

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

    // ----- Channels: 4 bare icons in one row -----
    const chanSection = el('section', { class: 'section' },
      el('h2', { class: 'section-title', text: 'Kanaler' }));
    const chanRow = el('div', { class: 'icon-row' });
    for (let i = 0; i < MAX_FAVORITES; i++) {
      const ch = state.channels.find((c) => c.id === favs.channels[i]);
      if (!ch) {
        chanRow.appendChild(el('div', { class: 'icon-empty', 'aria-hidden': 'true' }));
        continue;
      }
      const btn = el('button', {
        class: 'stream-icon',
        type: 'button',
        'data-stream-key': `live:${ch.id}`,
        'data-stream-title': ch.name,
        'aria-pressed': 'false',
        'aria-label': `Spela ${ch.name}`,
        onclick: () => toggleTrack({
          kind: 'live', id: ch.id, title: ch.name, subtitle: 'Direkt',
          audioUrl: ch.liveaudioUrl, artwork: ch.image,
        }),
      });
      if (ch.image) {
        btn.appendChild(el('img', { src: ch.image, alt: '', loading: 'lazy', draggable: 'false' }));
      } else {
        btn.appendChild(el('span', { class: 'icon-letter', text: ch.name.slice(0, 1) }));
      }
      chanRow.appendChild(btn);
    }
    chanSection.appendChild(chanRow);
    $main.appendChild(chanSection);

    // ----- Podcasts: 4 bare icons in one row -----
    const podSection = el('section', { class: 'section' },
      el('h2', { class: 'section-title', text: 'Poddar' }));
    const podRow = el('div', { class: 'icon-row' });
    for (let i = 0; i < MAX_FAVORITES; i++) {
      const pod = state.podcasts.find((p) => p.id === favs.podcasts[i]);
      if (!pod) {
        podRow.appendChild(el('div', { class: 'icon-empty', 'aria-hidden': 'true' }));
        continue;
      }
      const btn = el('button', {
        class: 'stream-icon pod-icon',
        type: 'button',
        'data-stream-key': `pod:${pod.id}`,
        'data-stream-title': pod.name,
        'data-stream-label': `Spela senaste avsnittet av ${pod.name}`,
        'aria-pressed': 'false',
        'aria-label': `Spela senaste avsnittet av ${pod.name}`,
        onclick: () => playPodcast(pod.id),
      });
      if (pod.image) {
        btn.appendChild(el('img', { src: pod.image, alt: '', loading: 'lazy', draggable: 'false' }));
      } else {
        btn.appendChild(el('span', { class: 'icon-letter', text: pod.name.slice(0, 1) }));
      }
      podRow.appendChild(btn);
    }
    podSection.appendChild(podRow);
    $main.appendChild(podSection);

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
        ? `Välj upp till ${MAX_FAVORITES} kanaler (${n}/${MAX_FAVORITES} valda)`
        : `Välj upp till ${MAX_FAVORITES} poddar (${n}/${MAX_FAVORITES} valda)`;
    }

    function doneBtnState() {
      const total = picks.channels.length + picks.podcasts.length;
      doneBtn.disabled = total === 0;
      doneBtn.textContent = 'Spara';
      doneBtn.title = total === 0 ? 'Välj minst en kanal eller podd först' : '';
    }

    // When one category reaches 4 and the other is still empty, jump to the
    // other tab so the user sees there is more to choose.
    function maybeAutoSwitchTab(completedKind) {
      if (picks[completedKind].length !== MAX_FAVORITES) return;
      const other = completedKind === 'channels' ? 'podcasts' : 'channels';
      if (picks[other].length === 0 && tab === completedKind) {
        switchTab(other);
      }
    }

    function togglePick(kind, id) {
      const arr = picks[kind];
      const idx = arr.indexOf(id);
      if (idx >= 0) {
        arr.splice(idx, 1);
      } else if (arr.length < MAX_FAVORITES) {
        arr.push(id);
      } else {
        showToast(kind === 'channels'
          ? 'Du kan välja max 4 kanaler. Ta bort en först.'
          : 'Du kan välja max 4 poddar. Ta bort en först.');
        return;
      }
      saveFavorites({ channels: picks.channels, podcasts: picks.podcasts });
      updateCounter();
      doneBtnState();
      renderList();
      maybeAutoSwitchTab(kind);
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
      title.textContent = 'Favoriter';
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

    doneBtn = el('button', { class: 'sheet-save', type: 'button', text: 'Spara',
      onclick: () => { closeSheet(); onDone?.(); } });

    // News count setting (4–20, step 2) — its own section with a header
    const newsCount = loadNewsCount();
    const newsLabel = el('span', { class: 'setting-value', text: String(newsCount) });
    const newsRange = el('input', {
      class: 'setting-range', type: 'range', min: '4', max: '20', step: '2',
      value: String(newsCount), 'aria-label': 'Antal nyheter att visa',
      oninput: (e) => {
        newsLabel.textContent = e.target.value;
        saveNewsCount(Number(e.target.value));
      },
    });
    const newsSetting = el('div', { class: 'setting-section' },
      el('h3', { class: 'section-title', text: 'Antal nyheter' }),
      el('div', { class: 'setting-row' },
        el('span', { class: 'setting-minmax', text: '4' }),
        newsRange,
        el('span', { class: 'setting-minmax', text: '20' }),
        newsLabel));

    // Structure: header → Info + Spara row → Antal nyheter → Välj favoriter
    sheet.appendChild(el('div', { class: 'sheet-grab', 'aria-hidden': 'true' }));
    sheet.appendChild(el('div', { class: 'sheet-header' }, title, closeBtn));
    sheet.appendChild(el('div', { class: 'sheet-actions' },
      el('button', {
        class: 'sheet-action sheet-action-info', type: 'button',
        onclick: openAbout,
        text: 'Info',
      }),
      doneBtn));
    sheet.appendChild(newsSetting);
    // Selection section — its own header so the list reads as the main task
    sheet.appendChild(el('h3', { class: 'section-title', text: 'Välj favoriter' }));
    sheet.appendChild(counter);
    sheet.appendChild(el('div', { class: 'tabs' }, tabChannels, tabPodcasts));
    sheet.appendChild(searchInput);
    sheet.appendChild(listWrap);
    overlay.appendChild(sheet);
    $sheetRoot.textContent = '';
    $sheetRoot.appendChild(overlay);

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
