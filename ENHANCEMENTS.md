# Förbättringslogg — Min Radio

Pågående anteckningar för förbättringar att ta itu med senare. Nyast överst.

---

## 2026-09-21 — Strömresolver med automatisk fallback (implementerat)

**Princip: bästa ljudkvalitet först för ALLA enheter; automatisk fallback till
nästa kandidat vid fel — och badgen i spelaren följer med automatiskt så
användaren ser när fallback triggas.**

### Kandidatordning per kanal (`liveCandidates` i app.js)
1. **P2 (id 163): FLAC** `edge1.sr.se/p2-flac` — förlustfri, spelar i Chromium
   (verifierat: `playing@1347ms`, currentTime avancerar) och troligen Safari.
   Omdokumenterad av SR → MP3 är alltid fallback.
2. **iOS/Safari: AAC-320** via officiell mall `srapi/{id}-hi-aac-http`.
   Safari spelar rå ADTS nativt (ej testad på riktig iPhone — se nedan).
3. **Alla: officiell MP3** (`liveaudio.url` från API:t) — fungerar överallt.
   Android/Chrome är Chromium-baserad → rå ADTS fungerar inte där heller,
   så Android får MP3 (med FLAC för P2).

### Fallback-mekanism (två vägar, båda verifierade)
- **`error`-event:** död URL → error@562ms → nästa kandidat → spelar. ✅
- **Watchdog (6 s):** Chromium **avfyrar INTE error** för rå ADTS-AAC — den
  hänger sig tyst (readyState 0, inga events, verifierat 3 ggr). Därför: om
  ingen `playing` inom 6 s → nästa kandidat. Watchdog rensas vid
  `playing`/`pause`/`ended`/stängd spelare.
- **Minne:** `workingStreamIdx` per stream-nyckel — paus/återupptagning
  försöker inte igen en känd dålig kandidat.

### Badge följer aktiv kandidat automatiskt
- `advanceCandidate()` uppdaterar `cur.audioUrl` → `renderPlayer()` → badgen
  renderas från `streamFormatLabel(cur.audioUrl)`. FLAC→MP3-shift syns alltså
  direkt för användaren. icy-br-bitrate hämtas inte för FLAC (opålitlig).

### Verifierat live på GitHub Pages (app.82cdcf19.js)
- P2 → badge "FLAC", spelar, paus/återupptagning OK ✅
- P1 → badge "MP3", spelar ✅ (resolveren bryter inte andra kanaler)
- Simulerad död FLAC-URL → error-fallback → MP3 spelar ✅
- Watchdog-kod i serverat bundle ✅

### Ej testat / kvar
- **AAC-320 på riktig iPhone/Safari** — Chromium-tester kan inte bevisa
  Safari-beteende. Koden aktiverar AAC först på iOS; om den hänger sig tar
  watchdog/error över till MP3 automatiskt, så risken är låg.
- HLS + hls.js (192 kbps AAC för alla kanaler) — framtida förbättring.

---

## 2026-09-21 — Spelare: format-badge (implementerat)

- Badge under undertexten i spelaren visar strömformat: MP3 / AAC / FLAC / HLS,
  härlett från URL-mönstret (`streamFormatLabel` i app.js).
- För direktströmmar hämtas verklig bitrate från `icy-br`-headern och läggs till
  ("MP3 · 148 kbps") — men **endast för direkta `edge*.sr.se`-URL:er**: den
  officiella kedjan topsy→live1→edge har en CORS-lös mellanhopp (live1), så
  `fetch()` dit blockeras alltid. `<audio>`-uppspelning påverkas inte (media-
  element tvingar inte CORS). Poddar/episoder visar bara format (MP3).
- Verifierat live på GitHub Pages: P1 → "MP3"-badge, inga CORS-fel i konsolen.
- Kvar: bitrate visas bara om SR någon gång servar edge-URL direkt i API:t;
  idag är badge format-only för live. Se strömrapport nedan för källor.

---

## 2026-09-21 — Öppna punkter (att ta itu med nästa session)

### 1. Inställningar-vyn: scrollning är inte smidig
- **Problem:** när man scrollar ned i Inställningar-vyn (bottom sheet) rör sig hemskärmen bakom med — bakgrundssidan följer med i scrollen ("scroll bleed-through").
- **Orsak (trolig):** `overscroll-behavior` är inte satt på `.sheet` (endast på `.news-scroller` och `.icon-scroller`). Touch-scroll i sheeten "läcker" till body.
- **Förslag på fix:** lägg `overscroll-behavior: contain;` på `.sheet` och se till att `body`-scroll låses ordentligt när sheeten är öppen (idag sätts `document.body.style.overflow = 'hidden'` — kontrollera att det gäller hela tiden, även efter swipe-to-close).

### 2. Minispelaren: saknar svepfunktion och stäng-kryss
- **Problem:** spelaren i nederkanten har varken svepgester eller stäng-kryss.
- **Önskat:**
  - Svep nedåt (eller åt sidan) på spelaren ska stänga/stoppa uppspelning — samma mönster som Inställningar/Info.
  - Ett tydligt stäng-kryss (✕) i spelaren som stoppar ljudet och stänger.
- **Not:** spelaren har redan en liten ✕-knapp (`player-btn-close`) men den är diskret; gör den tydligare och lägg till svepstöd via `enableSwipeToClose` (finns redan som hjälpfunktion i app.js, stödjer axis 'x' och 'y').

### 3. Ljud/stream-diagnostik — genomförd, se rapport nedan
Diagnostik genomförd 2026-09-21 enligt checklistan. Resultat: se avsnittet "Ljud-diagnostik 2026-09-21" längst ned.

---

## Ljud-diagnostik 2026-09-21 (investigation only, inga filer ändrade)

### Current architecture
- **100 % statisk PWA**, vanilla JS (IIFE i `public/app.js`), ingen backend, inga ramverk, inget state-bibliotek — tillståndet är en enkel `state`-objekt-modul (`state.channels/podcasts/news/current`) plus `localStorage` för favoriter/inställningar.
- Data hämtas direkt från SR Open API v2 (`api.sr.se/api/v2`) och Ekots Atom-flöde i webbläsaren (CORS öppet, verifierat).
- Ljud spelas med en enda global `new Audio()`-instans (`audioEl`, skapad i modul-scope i `public/app.js` ~rad 250).

### Relevant files
- `public/app.js` — allt: datahämtning (`fetchChannels`, `fetchPodcasts`, `fetchLatestEpisode`, `fetchNewsFlashes`, `episodeAudioFields` ~rad 100–210), spelare (`playTrack`, `toggleTrack`, `stopAndClosePlayer`, `renderPlayer` ~rad 250–470), favoriter (`loadFavorites`/`saveFavorites`), UI.
- `public/styles.css` — spelarens utseende (`.player*`, `.seek-*`).
- `public/sw.js` — service worker; **ignorerar alla cross-origin requests** (SR-trafik cachas aldrig).
- `src/favorites.mjs` + `tests/favorites.test.mjs` — endast favoritlogik; **inga ljudtester**.

### Current stream sources and formats
- **Kanaler (direkt):** `channel.liveaudio.url` från `/api/v2/channels` — MP3-stream (t.ex. `https://sverigesradio.se/topsy/direkt/srapi/132.mp3` → redirect till `edge1.sr.se/p1-mp3-96`, audio/mpeg 96 kbps).
- **Poddar/nyheter (on-demand):** prioriterad kedja i `episodeAudioFields()`:
  1. `listenpodfile.url` (MP3)
  2. `broadcast.broadcastfiles[0].url` (M4A/AAC, t.ex. `lyssna-cdn.sr.se/...192.m4a`)
  3. `broadcast.playlist.url` (m3u/ASX-manifest — **i praktiken oanvändbart**: m3u returnerar tom `#EXTM3U`, ASX saknar media-href; verifierat live)
- **Hårdkodade URL:er:** inga — alla ström-URL:er kommer från SR-API:et vid runtime.

### Existing quality and fallback behavior
- **P2 FLAC:** stöds inte (flödet exponerar inte FLAC; inte efterfrågat i koden).
- **AAC/M4A:** stöds indirekt via broadcastfiles (spelaren förlitar sig på webbläsarens AAC-stöd — fungerar i Safari/Chrome).
- **MP3:** stöds (kanaler + poddfiler).
- **HLS:** stöds inte (ingen hls.js; SR:s m3u8 används inte).
- **Manuell kvalitetsval:** finns inte.
- **Automatisk fallback:** endast den statiska 3-stegskedjan i `episodeAudioFields` (podfile → broadcastfile → playlist). Ingen fallback vid uppspelningsfel mitt i en ström.
- **Retries/reconnection:** inga. `audioEl.addEventListener('error')` visar bara en toast ("Uppspelningsfel. Försök igen.") — ingen automatisk återanslutning, ingen retry med backoff.
- **Buffering/stall detection:** ingen. `waiting`/`stalled`-eventen lyssnas inte på; ingen spinner eller "buffrar"-indikering.

### Browser media-format support check
- **Finns inte i koden.** Ingen användning av `MediaSource.isTypeSupported`, `canPlayType` eller liknande. Appen antar att webbläsaren klarar MP3/AAC (sant för alla moderna webbläsare, men ocheckat).

### Playback error handling
- `audioEl` 'error'-event → toast. Ingen felkod-loggning, ingen åtskillnad mellan nätverksfel och formatfel.
- `play()`-promise fångas → toast "Kunde inte starta uppspelning. Försök igen." (autoplay-block hanteras så).
- Inga timeouts på uppspelningsstart; en ström som hänger förblir hängande.

### Network awareness
- **Ingen.** `navigator.connection` används inte; ingen skillnad på Wi-Fi/cellulärt; ingen nedgradering av kvalitet vid dålig uppkoppling. Service workern cachar inte SR-trafik (medvetet).

### Technical risks
1. **Direktströmmar (edge1.sr.se) har ingen felhantering** — droppar man täckning dör ljudet tills användaren trycker igen.
2. **M4A/AAC via broadcastfiles** — fungerar i test (Safari/Chromium) men är otestat på äldre Android WebView.
3. **`broadcast.playlist.url`-fallbacken är död kod** i praktiken (tom m3u) — ger falsk trygghet.
4. **Ingen stall-detection** — dålig uppkoppling ger tyst avbrott utan UI-feedback.
5. **Autoplay-policy:** första play kräver användargest (hanteras), men växling mellan källor mitt i uppspelning kan i vissa webbläsare kräva ny gesture — otestat på iOS.
6. **Service worker + audio:** SW ignorerar cross-origin (korrekt), men om SW-reglerna ändras finns risk att strömmar buffras fel.

### Missing functionality (prioriterat)
1. Retry/återanslutning för direktströmmar (viktigast).
2. Stall/buffering-detektering + UI-indikering.
3. `canPlayType`-check innan källval (AAC vs MP3).
4. Kvalitetsval (SR erbjuder 96/192 kbps MP3 och AAC via olika URL-mallar — kräver kartläggning av SR:s ljud-URL-mönster).
5. HLS-stöd (endast om SR:s HLS-strömmar ska användas; kräver hls.js ~400 kB — väg mot nytta).
6. Nätverksmedvetenhet (`navigator.connection.effectiveType`).

### Recommended next investigation steps
1. Kartlägga SR:s ljud-URL-mallar för kvalitetsvarianter (96/192 MP3, AAC) — finns i SR:s dokumentation under "ljud".
2. Testa beteende vid nätverksbortfall på riktig telefon (flygplansläge mitt i P1) — dokumentera exakt vad som händer.
3. Utvärdera `audio.addEventListener(['waiting','stalled','suspend'])` som bas för stall-detektering.
4. Besluta om HLS är värt hls.js-beroendet (troligen nej för personlig app).

---

## Genomförda förbättringar (historik, kort)

- 2026-09-21: Ikonrader med kontinuerlig rullning (exakt 4 syns, stopp vid sista ikonen); Valda favoriter + drag-and-drop-sortering i Inställningar; fler än 4 val möjliga (cap 16); svep nedåt stänger Inställningar; svep åt sidan stänger läsare/Info; Info/Spara 50/50; kugghjul; reglage med värde i bollen.
- 2026-09-20: Statisk arkitektur (GitHub Pages), nyhetsläsare i appen, rullbar nyhetslista med inställbart antal, poddsökning klientsidigt, PWA-ikoner, service worker.
