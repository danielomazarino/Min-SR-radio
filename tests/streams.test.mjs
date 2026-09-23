/**
 * Tests for the live stream resolver (Phase 1 + Phase 2 stream descriptors).
 * Mirrors the resolveStreams logic in public/app.js as a pure module so the
 * candidate ORDER — the critical fallback contract — is regression-protected.
 *
 * Phase 2 adds HLS candidates, verified against SR's actual manifests
 * (AVERAGE-BANDWIDTH per STABLE-VARIANT-ID, curl-checked 2026-09-21):
 *   P2 Musik (2562): FLAC(100) → HLS-320(80) → (Safari: AAC-320, 60) → MP3(10)
 *   P3 (164):        HLS-320(80) → (Safari: AAC-320, 60) → MP3(10)
 *   P1/P2/P4:        HLS-192(80) → (Safari: AAC-320, 60) → MP3(10)
 *
 * HARD RULE (P2 FLAC protection): FLAC stays first in best-audio order —
 * HLS never replaces FLAC just because it has DVR.
 *
 * PRIORITY POLICY (explicit): the ordering FLAC 100 > HLS 80 > direct AAC 60
 * > MP3 10 is NOT a sound-quality ranking. Direct AAC-320 and HLS-320 carry
 * the same audio bitrate. HLS ranks above direct AAC because it is the
 * DVR-capable, SR-documented transport; direct AAC ranks above MP3 because
 * 320 > 96 kbps. Priority = playback-path value, not audio quality alone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- mirrored logic (keep in sync with app.js resolveStreams) ----

const HLS_MASTER = (slug) => `https://ljud1-cdn.sr.se/lc/${slug}.m3u8`;

const STREAM_TABLE = {
  2562: [
    { url: 'https://edge1.sr.se/p2-flac', codec: 'flac', bitrate: null,
      transport: 'direct', dvr: false, priority: 100 },
    { url: HLS_MASTER('p2'), codec: 'aac', bitrate: 320,
      transport: 'hls', dvr: true, priority: 80 },
  ],
  164: [
    { url: HLS_MASTER('p3'), codec: 'aac', bitrate: 320,
      transport: 'hls', dvr: true, priority: 80 },
  ],
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

function mp3Descriptor(channel) {
  return {
    url: channel.liveaudioUrl,
    codec: 'mp3', bitrate: 96, transport: 'direct', dvr: false, priority: 10,
  };
}

function aacDirectDescriptor(channel) {
  return {
    url: `https://www.sverigesradio.se/topsy/direkt/srapi/${channel.id}-hi-aac-http`,
    codec: 'aac', bitrate: 320, transport: 'direct', dvr: false, priority: 60,
  };
}

function resolveStreams(channel, caps) {
  if (!channel || !channel.liveaudioUrl) return [];
  const cands = [];
  for (const entry of STREAM_TABLE[channel.id] || []) {
    if (entry.codec === 'flac' && !caps.canPlayFlac) continue;
    if (entry.transport === 'hls' && !caps.canPlayHls) continue;
    cands.push({ ...entry });
  }
  if (caps.canPlayAacDirect && channel.id) {
    cands.push(aacDirectDescriptor(channel));
  }
  cands.push(mp3Descriptor(channel));
  return cands.sort((a, b) => b.priority - a.priority);
}

const CH_P2MUSIK = { id: 2562, liveaudioUrl: 'https://www.sverigesradio.se/topsy/direkt/srapi/2562.mp3' };
const CH_P1 = { id: 132, liveaudioUrl: 'https://www.sverigesradio.se/topsy/direkt/srapi/132.mp3' };
const CH_P3 = { id: 164, liveaudioUrl: 'https://www.sverigesradio.se/topsy/direkt/srapi/164.mp3' };

// Platform capability sets (mirroring CAPS in app.js)
const CAPS_CHROMIUM = { canPlayFlac: true, canPlayAacDirect: false, canPlayHls: true };
const CAPS_SAFARI = { canPlayFlac: true, canPlayAacDirect: true, canPlayHls: true };
const CAPS_FIREFOX = { canPlayFlac: true, canPlayAacDirect: false, canPlayHls: false };

// ---- tests ----

test('P2 Musik on Chromium (hls.js): FLAC FIRST, then HLS-320, then MP3', () => {
  const cands = resolveStreams(CH_P2MUSIK, CAPS_CHROMIUM);
  assert.deepEqual(cands.map((c) => c.codec), ['flac', 'aac', 'mp3']);
  assert.equal(cands[0].url, 'https://edge1.sr.se/p2-flac'); // FLAC protected
  assert.equal(cands[1].transport, 'hls');
  assert.equal(cands[1].dvr, true);
  assert.equal(cands[1].bitrate, 320);
});

test('P2 Musik on Safari: FLAC, HLS-320, AAC-320 direct, MP3', () => {
  const cands = resolveStreams(CH_P2MUSIK, CAPS_SAFARI);
  assert.deepEqual(cands.map((c) => c.codec), ['flac', 'aac', 'aac', 'mp3']);
  assert.equal(cands[0].transport, 'direct');   // FLAC
  assert.equal(cands[1].transport, 'hls');      // HLS-320
  assert.equal(cands[2].transport, 'direct');   // AAC-320 direct
  assert.equal(cands[3].codec, 'mp3');
});

test('P2 Musik on Firefox (no HLS): FLAC first, then MP3 — unchanged fallback', () => {
  const cands = resolveStreams(CH_P2MUSIK, CAPS_FIREFOX);
  assert.deepEqual(cands.map((c) => c.codec), ['flac', 'mp3']);
});

test('P1 on Chromium (hls.js): HLS-192 first, then MP3', () => {
  const cands = resolveStreams(CH_P1, CAPS_CHROMIUM);
  assert.deepEqual(cands.map((c) => c.codec), ['aac', 'mp3']);
  assert.equal(cands[0].transport, 'hls');
  assert.equal(cands[0].bitrate, 192);
  assert.equal(cands[0].dvr, true);
  assert.equal(cands[0].url, 'https://ljud1-cdn.sr.se/lc/p1.m3u8');
});

test('P1 on Safari (native HLS): HLS-192, AAC-320 direct, MP3', () => {
  const cands = resolveStreams(CH_P1, CAPS_SAFARI);
  assert.deepEqual(cands.map((c) => c.transport), ['hls', 'direct', 'direct']);
  assert.equal(cands[0].bitrate, 192);
  assert.equal(cands[1].bitrate, 320);
});

test('P3 on Chromium: HLS-320 (SR ladder verified: 32/128/320)', () => {
  const cands = resolveStreams(CH_P3, CAPS_CHROMIUM);
  assert.equal(cands[0].bitrate, 320);
  assert.equal(cands[0].dvr, true);
});

test('HLS entries filtered out when platform cannot play HLS (Firefox)', () => {
  const cands = resolveStreams(CH_P3, CAPS_FIREFOX);
  assert.ok(cands.every((c) => c.transport !== 'hls'));
  assert.deepEqual(cands.map((c) => c.codec), ['mp3']);
});

test('descriptors carry codec/bitrate/transport/dvr fields', () => {
  const cands = resolveStreams(CH_P2MUSIK, CAPS_CHROMIUM);
  for (const c of cands) {
    assert.ok('codec' in c && 'bitrate' in c && 'transport' in c && 'dvr' in c && 'priority' in c);
  }
  const hls = cands.find((c) => c.transport === 'hls');
  assert.equal(hls.dvr, true);
  assert.equal(hls.bitrate, 320);
});

test('FLAC descriptor has NO bitrate (icy-br unreliable — never invent one)', () => {
  const cands = resolveStreams(CH_P2MUSIK, CAPS_CHROMIUM);
  assert.equal(cands[0].bitrate, null);
});

test('channel without liveaudioUrl resolves to empty list', () => {
  assert.deepEqual(resolveStreams({ id: 132, liveaudioUrl: null }, CAPS_CHROMIUM), []);
  assert.deepEqual(resolveStreams(null, CAPS_CHROMIUM), []);
});

test('sorting is stable and priority-ordered regardless of push order', () => {
  // Simulate a future table where FLAC is pushed after MP3 — priority must win.
  const cands = [
    { codec: 'mp3', priority: 10 },
    { codec: 'flac', priority: 100 },
  ].sort((a, b) => b.priority - a.priority);
  assert.equal(cands[0].codec, 'flac');
});

// ---- HLS lifecycle contract (mirrored from app.js hlsAttach ERROR handler) ----
//
// The fallback contract, stated directly:
//   non-fatal error  → hls.js recovers internally; app does nothing
//   fatal error      → destroy the instance; if the current track is still
//                      HLS, advance to the next candidate; if playback has
//                      already moved on (e.g. fallback switched to MP3),
//                      only destroy — never advance on a stale track.

function hlsFatalDecision(cur, fatal) {
  if (!fatal) return 'recover-internal';
  if (!cur || cur.transport !== 'hls') return 'detach-only';
  return 'detach-and-advance';
}

test('non-fatal HLS error → hls.js internal recovery, no fallback', () => {
  const cur = { transport: 'hls' };
  assert.equal(hlsFatalDecision(cur, false), 'recover-internal');
});

test('fatal HLS error with HLS active → detach + advanceCandidate', () => {
  const cur = { transport: 'hls' };
  assert.equal(hlsFatalDecision(cur, true), 'detach-and-advance');
});

test('fatal HLS error after playback already left HLS → detach only', () => {
  const cur = { transport: 'direct' };
  assert.equal(hlsFatalDecision(cur, true), 'detach-only');
});

// ---- SR/HLS bitrate ladder mapping ----
//
// SR's HLS master manifests advertise AVERAGE-BANDWIDTH values that include
// container/segment overhead, so the advertised number is HIGHER than the
// nominal AAC bitrate of the rendition. Curl-verified ladder (2026-09-21):
//
//   variant id    advertised AVERAGE-BANDWIDTH   nominal AAC (user-facing)
//   *_32          34 000 bps                     32 kbps
//   *_128         136 000 bps                    128 kbps
//   *_192         204 000 bps                    192 kbps
//   *_320         340 000 bps                    320 kbps
//
// The advertised value is ~6.25% above nominal (e.g. 340000 vs 320000) —
// consistent overhead across the whole ladder, so the mapping is a lookup
// against the verified table, not a division. hls.js LEVEL_SWITCHED reports
// the advertised level bitrate; the app maps it through this table to the
// user-facing kbps label.

const SR_HLS_LADDER = [
  { advertisedBps: 34000, nominalKbps: 32 },
  { advertisedBps: 136000, nominalKbps: 128 },
  { advertisedBps: 204000, nominalKbps: 192 },
  { advertisedBps: 340000, nominalKbps: 320 },
];

function nominalKbpsFor(advertisedBps) {
  // Nearest advertised ladder entry (levels are far apart; exact match normal).
  let best = SR_HLS_LADDER[0];
  for (const entry of SR_HLS_LADDER) {
    if (Math.abs(entry.advertisedBps - advertisedBps)
      < Math.abs(best.advertisedBps - advertisedBps)) best = entry;
  }
  return best.nominalKbps;
}

test('SR HLS ladder: advertised bandwidth maps to nominal display bitrate', () => {
  assert.equal(nominalKbpsFor(340000), 320);  // 340000 bps ≈ "320 kbps" rendition
  assert.equal(nominalKbpsFor(204000), 192);
  assert.equal(nominalKbpsFor(136000), 128);
  assert.equal(nominalKbpsFor(34000), 32);
});

test('ladder mapping is lookup-based, NOT bps/1000 (340000 ≠ 340 kbps)', () => {
  // Guard against the naive conversion: the advertised value includes
  // container overhead, so dividing by 1000 would display a wrong number.
  assert.notEqual(Math.round(340000 / 1000), nominalKbpsFor(340000));
});

// ---- stale-session protection (mirrors hlsSession token in app.js) ----
//
// Contract: every playback change increments a session token; HLS event
// handlers capture the token at attach time and ignore events whose token
// no longer matches. An old session's fatal error must therefore never
// advance the NEW playback's candidates.

function makeSessionGuard() {
  let hlsSession = 0;
  return {
    attach: () => ++hlsSession,
    isCurrent: (session) => session === hlsSession,
  };
}

test('stale HLS session: old session events ignored after new playback starts', () => {
  const guard = makeSessionGuard();
  const s1 = guard.attach(); // P1 HLS starts
  const s2 = guard.attach(); // user picks P3 before P1 finishes loading
  assert.equal(guard.isCurrent(s1), false); // P1's events are stale
  assert.equal(guard.isCurrent(s2), true);  // P3's events are current
});

test('stale fatal error does not advance the new session candidates', () => {
  const guard = makeSessionGuard();
  const s1 = guard.attach();
  guard.attach(); // new session
  // Old session's fatal error arrives: guard says stale → detach only,
  // never advanceCandidate() on the new playback.
  const decision = guard.isCurrent(s1) ? 'detach-and-advance' : 'detach-only';
  assert.equal(decision, 'detach-only');
});

// ---- seekable DVR window state (mirrors updateSeekableState in app.js) ----

const DVR_MIN_WINDOW_S = 60;
const LIVE_EDGE_TOLERANCE_S = 10;

// Pure mirror of the seekable-state calculation for testability.
function seekableState(seekable, currentTime) {
  if (!seekable || !seekable.length) {
    return { dvrAvailable: false, seekableStart: null, seekableEnd: null,
      seekableDuration: null, distanceFromLiveEdge: null, atLiveEdge: true };
  }
  const start = seekable[0].start;
  const end = seekable[seekable.length - 1].end;
  const size = end - start;
  const usable = Number.isFinite(size) && size >= DVR_MIN_WINDOW_S;
  const distance = usable ? Math.max(0, end - (currentTime ?? 0)) : 0;
  return {
    dvrAvailable: usable,
    seekableStart: usable ? start : null,
    seekableEnd: usable ? end : null,
    seekableDuration: usable ? size : null,
    distanceFromLiveEdge: distance,
    atLiveEdge: !usable || distance <= LIVE_EDGE_TOLERANCE_S,
  };
}

test('seekable state: full SR window (~3 h) → dvrAvailable, at live edge', () => {
  const st = seekableState([{ start: 0, end: 10880 }], 10878);
  assert.equal(st.dvrAvailable, true);
  assert.equal(st.seekableDuration, 10880);
  assert.equal(st.atLiveEdge, true); // within 10 s tolerance
});

test('seekable state: rewound 10 min → not at live edge, distance correct', () => {
  const st = seekableState([{ start: 0, end: 10880 }], 10880 - 600);
  assert.equal(st.dvrAvailable, true);
  assert.equal(st.atLiveEdge, false);
  assert.equal(Math.round(st.distanceFromLiveEdge), 600);
});

test('seekable state: window below threshold → dvrAvailable false (no DVR UI)', () => {
  const st = seekableState([{ start: 0, end: 30 }], 29); // 30 s < 60 s threshold
  assert.equal(st.dvrAvailable, false);
  assert.equal(st.seekableStart, null);
  assert.equal(st.atLiveEdge, true);
});

test('seekable state: empty seekable (MP3/FLAC direct) → no DVR, at live edge', () => {
  const st = seekableState([], 0);
  assert.equal(st.dvrAvailable, false);
  assert.equal(st.atLiveEdge, true);
});

test('seekable state: null seekable (unsupported browser) → no DVR, at live', () => {
  const st = seekableState(null, 0);
  assert.equal(st.dvrAvailable, false);
  assert.equal(st.atLiveEdge, true);
});

test('seekable state: exactly at threshold (60 s) is usable', () => {
  const st = seekableState([{ start: 0, end: 60 }], 60);
  assert.equal(st.dvrAvailable, true);
});

// ---- Phase 3: DVR UI logic (mirrors dvrOffsetLabel / seek mapping) ----

// Mirror of dvrOffsetLabel in app.js — keep in sync.
function dvrOffsetLabel(secondsBehind) {
  if (!Number.isFinite(secondsBehind) || secondsBehind < 60) return 'LIVE';
  const totalMin = Math.floor(secondsBehind / 60);
  if (totalMin < 1) return 'LIVE';
  if (totalMin < 60) return `−${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `−${h} h ${m} min` : `−${h} h`;
}

test('offset label: 15 s behind → LIVE (within live-edge tolerance)', () => {
  assert.equal(dvrOffsetLabel(15), 'LIVE');
});

test('offset label: 75 s behind → −1 min', () => {
  assert.equal(dvrOffsetLabel(75), '−1 min');
});

test('offset label: 12 min behind → −12 min', () => {
  assert.equal(dvrOffsetLabel(12 * 60), '−12 min');
});

test('offset label: 65 min behind → −1 h 5 min', () => {
  assert.equal(dvrOffsetLabel(65 * 60), '−1 h 5 min');
});

test('offset label: exactly 2 h behind → −2 h (no zero minutes)', () => {
  assert.equal(dvrOffsetLabel(120 * 60), '−2 h');
});

test('offset label: invalid/zero/negative → LIVE', () => {
  assert.equal(dvrOffsetLabel(0), 'LIVE');
  assert.equal(dvrOffsetLabel(-5), 'LIVE');
  assert.equal(dvrOffsetLabel(NaN), 'LIVE');
  assert.equal(dvrOffsetLabel(Infinity), 'LIVE');
});

// Mirror of the seek mapping in seekToWindowFraction — keep in sync.
function seekTarget(frac, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const clamped = Math.min(1, Math.max(0, frac));
  const target = start + clamped * (end - start);
  return Number.isFinite(target) ? target : null;
}

test('seek mapping: fraction maps to the ACTUAL seekable range (not hard-coded)', () => {
  // A 90-minute window (not the 181-min one) must map correctly.
  const start = 1000, end = 1000 + 90 * 60;
  assert.equal(seekTarget(0, start, end), 1000);
  assert.equal(seekTarget(1, start, end), end);
  assert.equal(seekTarget(0.5, start, end), start + 45 * 60);
});

test('seek mapping: works on the verified 181-min SR window', () => {
  const start = 0, end = 10880;
  assert.equal(seekTarget(0.5, start, end), 5440);
  assert.equal(seekTarget(1, start, end), 10880); // Till Direkt target = seekableEnd
});

test('seek mapping: clamps out-of-range fractions', () => {
  const start = 0, end = 10880;
  assert.equal(seekTarget(-0.5, start, end), 0);
  assert.equal(seekTarget(1.5, start, end), 10880);
});

test('seek mapping: invalid range → null (no seek, no crash)', () => {
  assert.equal(seekTarget(0.5, null, 100), null);
  assert.equal(seekTarget(0.5, 0, null), null);
  assert.equal(seekTarget(0.5, 100, 100), null);   // zero-width
  assert.equal(seekTarget(0.5, 200, 100), null);   // inverted
  assert.equal(seekTarget(0.5, NaN, 100), null);
});

test('Till Direkt target equals the CURRENT seekableEnd (rolling window)', () => {
  // The window rolls: end moves forward. The target must be the live value,
  // never a stored constant.
  const t1 = seekTarget(1, 0, 10880);
  const t2 = seekTarget(1, 0, 10892.8); // window advanced ~12.8 s later
  assert.equal(t1, 10880);
  assert.equal(t2, 10892.8);
  assert.notEqual(t1, t2);
});

// ---- DVR UI gating (mirrors renderPlayer conditions) ----

test('DVR UI gating: no DVR state → no DVR row, mode pill stays LIVE', () => {
  const cur = { kind: 'live', dvrAvailable: false, atLiveEdge: true, distanceFromLiveEdge: null };
  const showDvrRow = cur.kind === 'live' && cur.dvrAvailable === true;
  const modeText = cur.atLiveEdge === false && cur.distanceFromLiveEdge
    ? dvrOffsetLabel(cur.distanceFromLiveEdge) : 'LIVE';
  assert.equal(showDvrRow, false);
  assert.equal(modeText, 'LIVE');
});

test('DVR UI gating: valid window + behind live → DVR row + offset pill', () => {
  const cur = { kind: 'live', dvrAvailable: true, atLiveEdge: false, distanceFromLiveEdge: 720 };
  const showDvrRow = cur.kind === 'live' && cur.dvrAvailable === true;
  const modeText = cur.atLiveEdge === false && cur.distanceFromLiveEdge
    ? dvrOffsetLabel(cur.distanceFromLiveEdge) : 'LIVE';
  assert.equal(showDvrRow, true);
  assert.equal(modeText, '−12 min');
});

test('DVR UI gating: podcast (kind episode) → no DVR row regardless of state', () => {
  const cur = { kind: 'episode', dvrAvailable: true, atLiveEdge: false, distanceFromLiveEdge: 600 };
  const showDvrRow = cur.kind === 'live' && cur.dvrAvailable === true;
  assert.equal(showDvrRow, false);
});

test('stream fallback removes DVR state: direct MP3 has no seekable → dvrAvailable false', () => {
  // Mirrors updateSeekableState's empty-seekable branch: when the fallback
  // stream (MP3/FLAC direct) has no seekable, the DVR UI must disappear.
  const st = seekableState([], 0);
  assert.equal(st.dvrAvailable, false);
  const showDvrRow = st.dvrAvailable === true;
  assert.equal(showDvrRow, false);
});
