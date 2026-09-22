# Design: HLS live playback + ~3 h DVR/time-shift i Min Radio

Status: **IMPLEMENTERAD (Fas 1–3) — verifierad på riktig Edge 153 + iPhone.**
Ursprunglig design 2026-09-21; implementerad och utökad 2026-09-21/22.
Grund: undersökningsresultat i ENHANCEMENTS.md (kompatibilitetsmatrisen)
+ curl-verifierade HLS-fakta.

## Implementeringsstatus (2026-09-22)

| Fas | Status | Not |
|---|---|---|
| Fas 1 — Stream descriptors + CAPS | **KLAR** | STREAM_TABLE, CAPS, resolveStreams; kandidatordningen identisk med gamla liveCandidates (8 enhetstester) |
| Fas 1a — Livscykel-fix | **KLAR** | renderPlayer nollställer transform varje render; alla 5 övergångar verifierade live |
| Fas 2A — HLS playback-engine | **KLAR** | hls.js lazy-load, stale-session-guard, SR-ladder-bitrate via LEVEL_SWITCHED, seekable-state |
| Fas 2B — Validering riktiga webbläsare | **KLAR** | Edge 153: seekable 181 min, 5-min bakåtseek; Firefox: MP3-fallback som designat |
| Fas 3 — DVR-UI | **KLAR** | mode-pill (minus-tid), DVR-seekrad, ±15 s-knappar, programhopp (väntar på SR:s tablå-API), gest-disambiguering |
| Fas 4 — Bitrate/codec-state | **KLAR** (delvis) | LEVEL_SWITCHED-badge + icy-br HEAD; MediaSession-metadata ej utökad |
| Fas 5 — Riktig enhetsvalidering | **PÅGÅR** | iPhone: DVR + ±15 s verifierade (användarskärdump); bakgrundsljud/låsskärm ej fullständigt testad |
| Fas 6 — FLAC-auto-upptäckt + Firefox | **EJ PÅBÖRJAD** | frivillig |

Avvikelser från designen (dokumenterade beslut):
- **backBufferLength är 90, inte 11100** (§5/§6 föreslog hela fönstret) —
  90 s räckte för bakåtseek i verifieringen; hls.js hämtar äldre segment
  on-demand vid seek. ÄNDRA EJ utan ny verifiering.
- **Mode-pill visar minus-tid** ("−12 min"), inte klocktid — användar-
  preferens 2026-09-22 (klocktiden bor i seekradens vänsterlabel).
- **±15 s-knappar + programhopp tillkom** (användarönskemål 2026-09-22,
  utanför ursprunglig design). Programhopp läser SR:s scheduledevents-API
  (var nere 500 under utredningen — knappar syns när API:t återkommer).
- **Gest-disambiguering på DVR-baren:** vertikala svep avbryter drag utan
  att seeka (fix för "hoppar till noll").

**Bilaga A (nedan): Spelar-UX & livscykel-granskning** — inklusive
rotorsaken till buggen "stängd spelare kommer inte tillbaka" (§A.3),
livscykel-kontrakt (§A.7) och rekommenderade layouter (§A.4–A.10).

---

# Bilaga A — Spelar-UX, livscykel & bugganalys

## A.1 Nuvarande spelar-arkitektur (dokumenterad, oförändrad)

### DOM & livscykel

- `$player` = **en enda permanent div** (`<div class="player">`) som
  skapas en gång vid appstart och aldrig tas bort från DOM.
- **Öppna:** `renderPlayer()` sätter `classList.add('visible')` och
  bygger om innehållet (`$player.textContent = ''` + nya noder).
  Synlighet styrs av CSS: `.player { transform: translateY(110%) }` →
  `.player.visible { transform: translateY(0) }` (glid-in från botten).
- **Stäng:** `stopAndClosePlayer()` — pausar ljudet, tar bort `src`,
  nollställer `state.current`/`lastPlayingKey`, tar bort `visible`-klassen
  och **tömmer innehållet** (`textContent = ''`). Spelaren glider ut
  (CSS-transition) men div:en finns kvar i DOM.
- **Uppdatera:** `renderPlayer()` anropas vid play/pause/buffring/
  kandidatbyte — bygger alltid om hela innehållet (full re-render,
  inget diffat).

### Nuvarande layout (kompakt läge, ~78–115 px hög)

```
┌──────────────────────────────────────────────┐
│ [✕]  [thumb 44px] Titel            [⏪][⏯][⏩]│  ← player-row
│                Undertext                     │
│                [MP3-pill]                    │
│ [0:01] ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ [66:15]        │  ← seek-row (endast episode)
└──────────────────────────────────────────────┘
```

- Direkt (live): ingen seek-rad, inga ⏪/⏩-knappar — bara ⏯ + ✕.
- Episode: seek-rad + ⏪/⏩.
- Badgen (`.player-quality`) sitter under undertexten i metakolumnen.
- Svep nedåt stänger spelaren (`enableSwipeToClose`, axis 'y').

### Händelseflöden som påverkar spelaren

| Händelse | Effekt |
|---|---|
| `playTrack(track)` | sätter state, `renderPlayer()` → öppnar |
| `advanceCandidate()` | `renderPlayer()` (badgen följer) |
| `playing`-event | `renderPlayer()` (buffring av) |
| `pause`/`play` | `renderPlayer()` |
| `waiting`/`stalled` | `setBadgeBuffering(true)` (påverkar bara badgen) |
| `stopAndClosePlayer()` | stänger + tömmer |
| swipe-ned (touch) | animerar transform → `stopAndClosePlayer()` |

## A.2 Bugganalys: "stängd spelare kommer inte tillbaka"

### Reproduktion (verifierad live i webbläsaren)

Testade alla fyra övergångarna i den nu deployade builden:

| Övergång | Spelaren kommer tillbaka? |
|---|---|
| kanal → stäng (✕) → ny kanal | ✅ JA |
| kanal → stäng (✕) → podd | ✅ JA |
| podd → stäng (✕) → kanal | ✅ JA |
| **kanal → stäng (SVEP NED) → ny kanal** | ❌ **NEJ — spelaren förblir osynlig** |

### Exakt rotorsak (etablerad, inte gissad)

`enableSwipeToClose`-animeringen sätter en **inline `style.transform`**
på spelaren när svepet lyckas:

```js
// enableSwipeToClose, finish():
panel.style.transform = axis === 'x' ? `translateX(${dir}px)` : `translateY(${dir}px)`;
setTimeout(close, 180);
```

`close()` (= `stopAndClosePlayer`) tar bort `visible`-klassen men
**nollställer aldrig `panel.style.transform`**. Inline-stilen har högre
specificitet än CSS-regeln `.player.visible { transform: translateY(0) }`.

Nästa `renderPlayer()` lägger tillbaka `visible`-klassen och bygger om
innehållet — men **rör aldrig inline-transformen**. Resultat (mätt live):

- `classList = "player visible"` ✅
- `style.transform = "translateY(1123px)"` ❌ (viewport = 1123 px)
- `getBoundingClientRect().top = 2131 px` — spelaren ligger ~1000 px
  **under skärmen**, osynlig för användaren trots "visible".

**Sammanfattning av rotorsaken:** svep-stängningsanimationen lämnar en
föräldrad inline-transform kvar; `.visible`-klassen kan inte återsynliggöra
spelaren eftersom inline-stilen vinner. ✕-knappens stängväg sätter aldrig
transform och drabbas därför inte — därför är buggen svår att se om man
testar med knappen.

### Buggen är livscykel-, inte logik-

All playback-state (`state.current`, `audioEl.src`, `lastPlayingKey`)
uppdateras korrekt vid ny kanal — ljudet spelas till och med. Endast
*presentationen* är trasig. Detta bekräftar att felet är rent visuell
livscykel-state (inline-transform), inte "permanent stängd"-logik.

### Fix-princip (för fas 1, inte nu)

`stopAndClosePlayer()` (eller `renderPlayer()`) ska nollställa
`$player.style.transform = ''` — en rad. Alternativt: låt svep-animationen
använda en CSS-klass i stället för inline-stil. **HLS/DVR-arbetet får
inte bygga på den nuvarande transform-hanteringen** — kontraktet i §A.7
gör detta explicit.

## A.3 Rekommenderat spelar-livscykel-kontrakt

```
VÄLJ KANAL/PODD (från vilket tillstånd som helst)
  → playTrack(): state uppdateras, renderPlayer() KALLAS ALLTID
  → spelaren MÅSTE vara synlig oavsett hur den senast stängdes
  → kontrakt: renderPlayer() äger ALLT presentations-state:
    visible-klass, transform, innehåll. Ingen annan funktion får
    lämna presentation-state "halvänd".

STÄNG (✕ eller svep)
  → stopAndClosePlayer(): ljud stoppas, state nollställs
  → spelaren göms KOMPLETT (klass + transform + innehåll nollställs)
  → gömd ≠ förstörd: samma div återanvänds nästa gång

REGEL (kontrakt): "renderPlayer() är den enda funktionen som får
sätta presentations-state, och den sätter det ALLTID helt"
— dvs. den nollställer transform explicit varje gång.
```

Gäller konsekvent för: kanal→kanal, kanal→podd, podd→kanal, podd→podd.

## A.4 Rekommenderad kompakt layout (mobil-först)

Behåller dagens struktur (den är bra) med tre förbättringar:

```
┌──────────────────────────────────────────────┐
│ [✕]  [thumb] Titel                [⏪][⏯][⏩]│
│              Undertext · status              │
│              [FLAC] [LIVE]  ← två små pills  │
│ (DVR: [0:00] ▬▬▬●▬▬▬▬▬▬▬ LIVE [Till Direkt]) │  ← endast när DVR finns
└──────────────────────────────────────────────┘
```

- **Två pills i stället för en:** vänster pill = kvalitet (`FLAC` /
  `AAC 320` / `MP3 96`), höger pill = läge (`LIVE` / `~10 min bakom` /
  `buffrar`). Skiljer "vad jag lyssnar på" från "var i tiden jag är" —
  två olika frågor som idag blandas i en pill.
- **Status i undertexten:** buffring visas som pulsande pill (befintlig
  mekanism) + undertexten kan visa "Buffrar…" vid långdragen buffring.
- **Höjd:** ~95–120 px med DVR-rad — acceptabelt; DVR-raden är valfri.

## A.5 Rekommenderad expanderad layout (framtidssäkrad)

**Arkitektursvar: bottom-sheet-expansion (tap på spelaren expanderar).**

```
EXPANDERAD (tap på kompakt spelare, eller svep uppåt):
┌──────────────────────────────────────────────┐
│ [⌄]  (dra ned/tap ⌄ för att kollapsa)        │
│                                              │
│   [Större omslag 96–120px]  PROGRAMNAMN      │
│                             Låt / Avsnitt    │
│                             Artist/ledare   │
│                                              │
│   [0:00] ▬▬▬▬▬●▬▬▬▬▬▬▬▬▬ [LIVE]              │
│   [⏪15]        [⏯]        [⏩15]  [Till Direkt]│
│   [FLAC] [LIVE ~10 min bakom]                │
└──────────────────────────────────────────────┘
```

- **Varför tap-att-expandera (primärt) + svep-upp (bonus):** tap är
  pålitligt, tillgängligt (knapp-semantik) och krockar inte med scroll.
  Svep-upp kan läggas till senare via samma `enableSwipeToClose`-mönster
  (inverterad) — men tap räcker för att inte skapa gest-konflikt med
  hemskärmens scroll.
- **Samma div, två lägen:** `.player.expanded` — ingen ny komponent,
  ingen routing. CSS max-height/transition. Kollaps vid ✕ eller ⌄.
- **Plats för metadata:** expanderat läge ger 3 rader text + större
  omslag — räcker för program/låt/artist (SR-metadata, fas 6+).

## A.6 Rekommenderad buffrings-visualisering

- **Kompakt läge:** befintlig pulsande pill ("MP3 · buffrar") — beprövad,
  tar noll extra plats. Utökas med att undertexten visar "Buffrar…"
  efter >2 s (skiljer kort stöt från lång väntan).
- **Expanderat läge:** samma pill + tunn linjär indikator under
  timeline (obestämd shimmer) — bara i expanderat läge.
- **Stalled/recovering:** samma som buffring; ingen separat nivå
  (onödig komplexitet).

## A.7 Rekommenderad kvalitets/bitrate-pill

- **Två pills** (se A.4): kvalitet + läge. Enskild pill blir för lång
  ("FLAC · buffrar · ~10 min bakom" är oläslig på iPhone).
- **Ärlighet (ingen fake precision):**
  - `FLAC` — ingen bitrate (icy-br opålitlig; aldrig "FLAC 128")
  - `AAC 320` — descriptor-bitrate; vid hls.js bekräftad via
    LEVEL_SWITCHED; nativ Safari = descriptor (dokumenterad begränsning)
  - `MP3 96` — descriptor (liveaudio.url är alltid 96)
  - Okänd bitrate → bara codec (`AAC`), aldrig påhittad siffra
- **Konfigurerad vs aktiv:** badgen visar ALLTID aktiv ström
  (`state.current` efter fallback), aldrig önskad. Fallback → pill
  följer automatiskt (befintlig mekanism).

## A.8 Rekommenderad DVR-affordans

**Enkel modell, tre tillstånd:**

1. **LIVE (normal):** höger pill visar `LIVE`. Ingen spolrad för direkt
   (som idag) — MEN om DVR finns: liten "Spola tillbaka"-knapp (⏪-ikon
   med text) till vänster om ⏯. Tryck → hoppar 15 s bak (och pillen
   blir `~15 min bakom`).
2. **SPOLAT BAKÅT:** spolrad visas med position i fönstret; höger pill
   `~10 min bakom`; knapp **"Till Direkt"** till höger om spolraden.
3. **INGEN DVR (FLAC/MP3):** ingen spolrad, ingen Spola-knapp — spelaren
   ser ut som idag. Ingen teknisk förklaring behövs.

- **Upptäckbarhet utan HLS-kunskap:** "Spola tillbaka"-knappen syns bara
  när DVR finns; att trycka den är självförklarande. Ingen inställning
  krävs för att upptäcka funktionen.
- **FLAC vs HLS-distinktionen (om läge A/B väljs senare):** pillen visar
  `FLAC` resp `AAC 320` — kvalitetsskillnaden är synlig utan att appen
  pratar om HLS. Om användaren i "bäst ljud"-läge trycker "Spola" på en
  FLAC-ström: toast en gång "Spolning kräver spolbar kvalitet — byter"
  → HLS 320 (medvetet val, synligt i badgen). Ingen tyst nedgradering:
  bytet sker bara på explicit spol-begäran.

## A.9 Framtida metadata-yta

- **Kompakt:** undertexten visar program/podd-namn (idag) — låt/artist
  kommer INTE att få plats i kompakt läge; det är OK, expanderat läge
  är hemmet för detaljer.
- **Expanderat:** dedikerade rader (se A.5): PROGRAMNAMN (semibold),
  Låt/Avsnitt (stor), Artist/ledare (sekundär). SR:s metadata-API kan
  fylla dessa senare utan layoutändring — raderna finns från fas 3
  (tomma/dolda tills data finns).
- **Poddar:** avsnittstitel + poddnamn — redan idag i kompakt; expanderat
  lägger beskrivning-utdrag.

## A.10 Svep-expansion — lämplig?

**Ja, som sekundär gest; tap som primär.** `enableSwipeToClose`-mönstret
återanvänds inverterat (svep upp på spelaren = expandera). Risk: gest-
konflikt med sidscroll är låg eftersom spelaren är fixed längst ner och
vertikal intent-detektering redan finns. Men tap-att-expandera är
tillgängligare (skärmläsare, motorik) och implementeras först.

## A.11 UI-oberoende från HLS/hls.js

- UI:t läser ENDAST: `state.current.codec/bitrate` (pill),
  `state.current.dvrWindow` (spolrad), `atLiveEdge` (LIVE-pill),
  buffrings-events. **Ingen referens till hls.js, MSE, transport eller
  URL-mönster i renderPlayer.**
- `hlsAttach/hlsDetach` bor i playback-lagret; UI:t vet bara "spolning
  finns / finns inte" via `dvrWindow`.
- Ny transport i framtiden (t.ex. DASH) = playback-lagerändring, UI:t
  opåverkat.

## A.12 Tillgänglighet

- Alla nya kontroller som knappar med svenska aria-labels ("Spola
  tillbaka 15 sekunder", "Till Direkt", "Expandera spelare",
  "Kollapsa spelaren").
- Pills: `role="status"` + `aria-live="polite"` på läge-pillen så
  skärmläsare hör "buffrar"/"~10 min bakom"-byten utan att spamma.
- Spolrad: `role="slider"` med aria-valuemin/max/now (eller behåll
  klick-bar som idag + tangentbordsstöd ←/→).
- `prefers-reduced-motion`: puls av (finns), expansion utan animation.
- Fokusordning: ✕ → ⏪ → ⏯ → ⏩ → (Spola/Till Direkt) → pills (icke-
  interaktiva, tabindex=-1).

## A.13 Konflikter med DESIGN-HLS-DVR.md (huvuddokumentet)

| Punkt | Huvuddok | Bilaga A justerar |
|---|---|---|
| §4 Player state | en pill (codec+bitrate) | **två pills** (kvalitet + läge) |
| §4 UI-status | "~10 min bakom Direkt" i undertext | oförändrat, men som egen pill |
| §6 DVR | "Till Direkt"-knapp | + "Spola tillbaka"-knapp i LIVE-läge (upptäckbarhet) |
| §12 Fas 3 | spolrad för live | + fix av transform-buggen FÖRST (fas 1) |
| §12 Fas 1 | descriptors + CAPS | **+ livscykel-fix + renderPlayer-kontrakt** |

Inga motsägelser i playback-arkitekturen — justeringarna är UI-nivå.

## A.14 Rekommenderade ändringar av Fas 1 (huvuddok §12)

Fas 1 utökas till **"Fas 1a: livscykel-fix"** (före allt annat):

1. `stopAndClosePlayer()` nollställer `$player.style.transform = ''`
   (eller renderPlayer gör det — kontraktet i A.3).
2. Enhetstest/regression: svep-stäng → ny kanal → spelaren synlig
   (automatiserat i Playwright där möjligt).
3. Ingen annan ändring i fas 1a — minimal, isolerad, låg risk.

Fas 1 (descriptors + CAPS) genomförs sedan enligt huvuddokumentet, med
tillägg att `renderPlayer` läser descriptor-fält i stället för
URL-gissning (redan specificerat) och att pill-strukturen blir två
(kvalitet + läge) enligt A.7.

**P2 FLAC-skydd bekräftas:** ingen ändring i FLAC-vägen i någon fas;
livscykel-fixen rör bara presentations-state.

## A.15 Svar på de 14 frågorna (kortindex)

1. Arkitektur: §A.1 · 2. Rotorsak: §A.2 (inline-transform från svep) ·
3. Kontrakt: §A.3 · 4. Kompakt: §A.4 · 5. Expanderad: §A.5 ·
6. Buffring: §A.6 · 7. Pill: §A.7 · 8. DVR: §A.8 · 9. Metadata: §A.9 ·
10. Svep: §A.10 (ja, sekundärt) · 11. UI-oberoende: §A.11 ·
12. A11y: §A.12 · 13. Konflikter: §A.13 · 14. Fas 1-ändringar: §A.14

---

## 0. Designprinciper

1. **Ingen rewrite.** Nuvarande `playTrack`/`candidates`/`advanceCandidate`/
   watchdog är ryggraden och ska vara intakt efter varje fas.
2. **Progressiv förstärkning** — plattformar får skilja sig, men ingen
   plattform får gå sönder.
3. **Kvalitet och DVR är oberoende axlar.** HLS 320 kbps är en
   högkvalitetsväg; FLAC är en annan. Ingen tyst nedgradering av FLAC.
4. **En enda capability-modul** — inga browser-checkar utspridda i UI:t.
5. **Runtime-sanning över konfiguration:** badgen visar vad som *faktiskt*
   spelas, aldrig vad som var önskat.

---

## 1. STREAM MODEL

### Idag

`liveCandidates(channel)` returnerar en ordnad lista av URL-strängar.
`track.candidates` + `track.candidateIndex` + `workingStreamIdx`-minnet.
Fungerar men URL-strängar bär ingen semantik — formatet gissas från URL
(`streamFormatLabel`), bitrate hämtas separat via icy-br, DVR är okänt.

### Förslag: deklarerade strömobjekt

Varje kanal får en lista av **stream descriptors** (små objekt i stället
för URL-strängar). Resolvern behåller sin ordnade-lista + fallback-logik —
bara innehållet blir rikare:

```js
// En ström beskrivs så här (påhittade fält borttagna; bara det vi använder):
{
  url: 'https://ljud1-cdn.sr.se/lc/p2/p2_320.m3u8', // eller variant-URL
  codec: 'aac',            // 'aac' | 'mp3' | 'flac'
  bitrate: 320,            // kbps; null om okänd (FLAC)
  transport: 'hls',        // 'hls' | 'direct'
  dvr: true,               // HLS-live med rullande fönster
  priority: 100,           // högre = bättre; resolvern sorterar stabilt
  source: 'static',        // 'static' (inbyggd tabell) | 'api' (liveaudio.url)
}
```

**Varför denna form:**

- `codec`/`bitrate`/`transport`/`dvr` är exakt vad badgen och DVR-UI:t
  behöver — ingen URL-gissning, ingen extra HEAD-request för icy-br på
  HLS (variant-URL:en *är* bitrate-sanningen).
- `priority` gör ordningen deklarerad i stället för implicit i
  if-kedjor — ny FLAC för P1/P3 blir bara ett nytt objekt med hög
  prioritet (se §9).
- `source` skiljer SR:s officiella `liveaudio.url` (alltid sist som
  fallback) från våra tillagda vägar.

### Statisk strömtabell (ny konstant i app.js)

Byggd från de curl-verifierade manifesten; kanal-id → lista:

```js
const STREAM_TABLE = {
  // P2 Musik (2562): FLAC först (kvalitet), sedan HLS-laddern
  2562: [
    { url: 'https://edge1.sr.se/p2-flac', codec: 'flac', bitrate: null,
      transport: 'direct', dvr: false, priority: 100, source: 'static' },
    { url: HLS_MASTER(2562), codec: 'aac', bitrate: 320,
      transport: 'hls', dvr: true, priority: 80, source: 'static' },
    // ... 128/32-varianter behövs inte som separata poster — hls.js och
    // Safari väljer variant inom master-manifestet. Se §5.
  ],
  // P3 (164): HLS 320 finns
  164: [ { ...hls 320, priority 80 } ],
  // P1/P2/P4: HLS 192 som topp
  132: [ { ...hls 192, priority 80 } ],
  163: [ { ...hls 192, priority 80 } ],
  212: [ { ...hls 192, priority 80 } ],
};
// Alla kanaler: liveaudio.url (MP3) läggs till av resolvern med priority 10.
```

**Viktig detalj:** vi pekar på **master-manifestet** (`srapi/{id}.hls`) och
låter Safari/hls.js välja variant — med en `maxBitrate`-begränsning i
hls.js-konfig och `Hls.Events.LEVEL_SWITCHED` som bitrate-sanning (§7).
Då behöver vi inte hålla variant-URL:er i tabellen, och SR:s
content-steering (LJUD1→LJUD2) hanteras av spelaren själv.

**FLAC-poster förblir handgjorda** (odokumenterade av SR) — tabellen är
den enda platsen de finns, vilket redan är fallet idag.

---

## 2. STREAM RESOLVER

### Frågan resolvern ska svara

> "Vad är den bästa ström jag pålitligt kan spela på DEN HÄR plattformen,
> för DET HÄR uppspelningsläget?"

### Två uppspelningslägen (terminologi anpassad till appen)

Appen är svensk och enkel; vi använder:

- **`bäst ljud`** (maximumQuality) — dagens beteende: FLAC först där det
  finns, annars högsta AAC, annars MP3.
- **`direkt + spola`** (liveWithDvr) — HLS först (DVR), annars bästa
  icke-DVR-ström.

### Resolver-design (evolution, inte ersättning)

```js
function resolveStreams(channel, mode) {
  // 1. Samla kandidater: STREAM_TABLE[channel.id] + liveaudio.url-post
  // 2. Filtrera på plattformsförmåga (capabilities, §6):
  //    - transport 'hls' kräver canPlayHls() (native eller hls.js)
  //    - codec 'aac' kräver canPlayAac() (Safari: ja; Chromium: bara via HLS)
  //    - 'direct'+'aac' på Chromium filtreras bort (ADTS-häng — verifierat)
  // 3. Sortera på priority (stabil; FLAC > HLS-320 > HLS-192 > MP3)
  // 4. mode 'direkt + spola': ström utan dvr:true får lägre prioritet
  //    än DVR-ström, men finns kvar som fallback (aldrig bortfiltrerad)
  // 5. Returnera ordnad lista — SAMMA form som dagens candidates
}
```

**Nyckel: utdata är fortfarande en ordnad kandidatlista.** `playTrack`,
`advanceCandidate`, watchdog och `workingStreamIdx` fungerar oförändrat —
de behöver bara läsa de nya fälten (`codec`, `bitrate`, `transport`, `dvr`)
i stället för att gissa från URL.

### Capability-detektion (en gång, vid start)

```js
const CAPS = {
  nativeHls: /* Safari: canPlayType('application/vnd.apple.mpegurl') && IS_SAFARI */,
  mse: 'MediaSource' in window,
  hlsjs: mse && !IS_FIREFOX,   // Firefox: MSE finns men TS-i-MSE opålitligt
  canPlayHls: nativeHls || hlsjs,
  canPlayAacDirect: IS_SAFARI, // ADTS: bara Safari (Chromium hänger sig)
  canPlayFlac: true,           // alla målplattformar (Ogg-FLAC)
};
```

`IS_FIREFOX`/`IS_SAFARI`/`IS_IOS` samlas i samma modul — inga checkar i
renderPlayer/DVR-UI.

---

## 3. P2 MUSIK — EXAKT BETEENDE

Kanal 2562, strömtabell: FLAC (prio 100) → HLS 320 (prio 80) → MP3 (prio 10).

### A. Läge "bäst ljud" (dagens standard)

1. **FLAC** spelas (som idag). Badge: `FLAC`. Ingen DVR — spelaren visar
   ingen spolning för direkt (som idag).
2. FLAC-fel → **HLS 320** (badge `AAC 320`, DVR aktiveras — bonus, inte
   nedgradering i ljud som användaren hör som "sämre" utan som annan väg).
3. HLS-fel → **MP3** (badge `MP3`).

### B. Läge "direkt + spola"

1. **HLS 320** spelas direkt (badge `AAC 320`, DVR-rad visas).
2. HLS-fel → **FLAC** (utan DVR — badge `FLAC`, DVR-rad döljs, toast
   "Spola bakåt finns inte för den här strömkvaliteten" visas en gång).
3. FLAC-fel → **MP3**.

**Ingen tyst nedgradering:** i läge A är FLAC alltid första försöket.
Läge B väljer HLS *medvetet* eftersom DVR är poängen — och badgen visar
tydligt `AAC 320` så användaren ser skillnaden mot `FLAC`.

---

## 4. PLAYER STATE

### Utökning av `state.current` (inga nya globala)

```js
state.current = {
  // befintliga fält (oförändrade): kind, id, title, subtitle, artwork,
  // audioUrl, candidates, candidateIndex, duration
  // nya fält från stream-descriptor:
  codec: 'aac', bitrate: 320, transport: 'hls', dvr: true,
  // DVR-runtime (uppdateras av timeupdate, läses av renderPlayer):
  dvrWindow: { start: 12345.6, end: 24225.6, size: 10880 }, // sekunder
  atLiveEdge: true,        // currentTime >= liveEdge - 10 s
};
```

### Härledd UI-status (inte lagrad — beräknas i renderPlayer)

| Tillstånd | Villkor | UI |
|---|---|---|
| LIVE | `atLiveEdge` | undertext "Direkt" (som idag) |
| SPOLAT BAKÅT | `!atLiveEdge && dvr` | undertext "~10 min bakom Direkt" + knapp "Till Direkt" |
| BUFFRAR | `waiting/stalled` | badge "· buffrar" (befintlig mekanism) |
| INGEN DVR | `!dvr` eller tomt seekable | ingen spolrad (som idag för live) |

**Användarspråk:** "Direkt" och "~10 min bakom Direkt" — ingen teknisk
terminologi (HLS/DVR/MSE förekommer aldrig i UI:t; badgen visar codec +
bitrate, vilket är begripligt).

---

## 5. HLS-INTEGRATIONSTRATEGI

### Två transportvägar, ett gränssnitt

```js
// Adapter-funktioner (i app.js, ~80 rader totalt):
function hlsAttach(audioEl, url, { maxBitrate }) {
  if (CAPS.nativeHls) {
    audioEl.src = url;                    // Safari: native, klart
    return null;                          // ingen controller att städa
  }
  if (CAPS.hlsjs) {
    const hls = new Hls({
      maxBufferLength: 30,                // normal buffring
      backBufferLength: 11100,            // behåll hela 3-h-fönstret bakåt
      maxMaxBufferLength: 120,
      startLevel: -1,                     // ABR start, begränsas av maxBitrate
    });
    if (maxBitrate) hls.config.capLevelToPlayerSize = false,
      hls.autoLevelCapping = highestLevelUnder(maxBitrate);
    hls.loadSource(url);
    hls.attachMedia(audioEl);
    return hls;                           // sparad i state.hls, destroy() vid stop
  }
  return 'unsupported';                   // → resolvern faller vidare
}

function hlsDetach() { /* hls?.destroy(); state.hls = null; */ }
```

- **Safari (iOS/iPadOS/macOS):** native — `audioEl.src = m3u8`. Safari
  hanterar content steering, variantval och DVR-window själv. Ingen
  hls.js laddas (noll kostnad).
- **Chromium/Android/desktop:** hls.js lazy-laddas från CDN **först när
  en HLS-ström faktiskt ska spelas** (script-tag vid behov, cachad).
  ~100 KB gz en gång.
- **Firefox:** `CAPS.hlsjs = false` → HLS-poster filtreras bort av
  resolvern → MP3-fallback (dagens beteende). Graceful, ingen kodväg
  riskeras.

### Watchdog-interaktion

Den befintliga 6-s-watchdogmen gäller också HLS: om ingen `playing` inom
6 s → `advanceCandidate()` → nästa ström (t.ex. HLS → FLAC → MP3).
`hlsDetach()` körs i `advanceCandidate`/`stopAndClosePlayer` när den
aktuella strömmen var HLS.

---

## 6. DVR-IMPLEMENTERING

### Detektering (sanningskälla: `audio.seekable`)

```js
function readDvrWindow() {
  const s = audioEl.seekable;
  if (!s || !s.length) return null;
  const start = s.start(0), end = s.end(s.length - 1);
  const size = end - start;
  return size >= 60 ? { start, end, size } : null;  // < 1 min = oanvändbart
}
```

- **Visas bara om fönstret är ≥ 60 s.** Ingen DVR-UI på MP3/FLAC (deras
  seekable är tomt/0) och inte på HLS om SR någon gång krymper fönstret.
- **Rullande fönster:** `timeupdate` → `readDvrWindow()` → uppdatera
  `state.current.dvrWindow`. När playlistan avancerar glider `start`
  framåt; om användaren står kvar bakom och `currentTime < start` hoppar
  spelaren till `start` (webbläsarklippning) — vi detekterar det
  (`currentTime <= start + 1`) och visar "Direkt" igen + toast en gång:
  "Du nådde slutet av det sparade materialet".
- **Till Direkt-knapp:** `audioEl.currentTime = dvrWindow.end - 2`
  (2 s marginal före live-kanten för att undvika buffertomhet).
- **Live-kant:** `atLiveEdge = currentTime >= end - 10`.
- **Ingen klientinspelning/caching** — SR:s CDN är sanningskällan;
  hls.js `backBufferLength: 11100` behåller bara det CDN redan serverar.

### Safari vs hls.js-nyanser

- Safari exponerar DVR-fönstret i `seekable` för live-HLS (dokumenterat
  beteende) — samma `readDvrWindow()` fungerar.
- hls.js: seekable kommer från SourceBuffer-range; med
  `backBufferLength: 11100` behålls hela fönstret (verifierat i vår test:
  seekable [0, 10880]).
- **Olika webbläsare, olika seek-sanning** — därför läses ALLT från
  `seekable`/`currentTime`, aldrig från antaganden om 3 h.

---

## 7. BITRATE/CODEC-DISPLAY

### Sanningskälla per transport

| Transport | Sanningskälla | Kommentar |
|---|---|---|
| direct FLAC | descriptor (`codec:'flac'`) | icy-br är opålitlig för FLAC |
| direct AAC (Safari) | descriptor + icy-br HEAD (befintlig `fetchStreamBitrate`, fungerar på edge-hosts) | mallen `-hi-aac-http` → 320 |
| direct MP3 | descriptor (`bitrate: 96`) | liveaudio.url är alltid 96 |
| HLS | **hls.js `LEVEL_SWITCHED`-event** → aktuell levels bitrate | exakt runtime-sanning inkl. ABR-byten |
| HLS native (Safari) | descriptor (vi capped inte nativt; Safari väljer högsta) | begränsning: Safari avslöjar inte aktiv variant-bitrate i `<audio>` — visar descriptor-bitrate (320/192), vilket stämmer eftersom Safari väljer högsta som standard |

**Badge-format:** `FLAC` · `AAC 320` · `AAC 192` · `MP3 96` — byggd från
`state.current.codec + bitrate`, uppdaterad av `LEVEL_SWITCHED` (hls.js)
eller HEAD-svar (direct). Fallback → badgen följer automatiskt (befintlig
mekanism, nu med data i stället för URL-gissning).

**Känd begränsning:** nativ-HLS-Safari kan i teorin välja lägre variant
vid nätverkspress utan att vi ser det. Sanningskällan är då
descriptor-bitrate (högsta). Detta dokumenteras som begränsning — inte
värt att fetcha playlistor manuellt för att räkna segment.

---

## 8. PLATTFORMSSTRATEGI (sammanfattning)

| Plattform | Väg | Not |
|---|---|---|
| iOS/iPadOS Safari + PWA | native HLS | primärt mål; DVR + 320/192; ingen hls.js |
| Android Chrome + PWA | hls.js | DVR + 320/192; lazy-load |
| Win/Linux/macOS Chrome, Edge | hls.js | samma som Android |
| macOS Safari | native HLS | som iOS |
| Firefox (alla OS) | MP3-fallback | HLS filtreras bort i resolvern; testar TS-i-MSE senare |
| FLAC (P2 Musik) | direct, alla plattformar | orörd |

All plattformslogik bor i `CAPS` + `hlsAttach/hlsDetach` — UI:t läser
bara `state.current`-fält.

---

## 9. FRAMTIDA FLAC (P1/P3 m.fl.)

Nya FLAC-strömmar = **en rad i `STREAM_TABLE`**:

```js
132: [ { url: 'https://edge1.sr.se/p1-flac', codec:'flac', ..., priority: 100 }, ... ]
```

Ingen spelarändring: resolvern sorterar, badgen visar FLAC, DVR-UI
aktiveras bara om `seekable` säger så. **Upptäckt i runtime (frivillig
fas 6):** en liten HEAD-probe mot `edge1.sr.se/{slug}-flac` per kanal vid
uppstart (billig, cachad i sessionStorage) kan upptäcka nya FLAC-strömmar
automatiskt — men tabellen räcker som bas.

---

## 10. ERROR & FALLBACK-STATEMASKIN

Nuvarande kedja (oförändrad kärna) + nya HLS-grenar:

```
playTrack(track)
  ├─ hlsAttach ok → playing? → KLAR (badge = descriptor)
  │    └─ watchdog 6 s / error → advanceCandidate()
  ├─ hlsAttach 'unsupported' (Firefox) → advanceCandidate()
  ├─ hls.js fatal error (network/manifest) → advanceCandidate()
  │    └─ (hls.js har egen intern recovery för icke-fatala fel — låt den)
  ├─ MSE saknas → CAPS.hlsjs=false sedan tidigare → HLS aldrig vald
  ├─ codec unsupported → filtrerad i resolvern sedan tidigare
  ├─ FLAC-fel → advanceCandidate() → HLS → MP3 (befintligt)
  ├─ nätverksdegradering (mid-play) → hls.js ABR sänker variant
  │    (badge uppdateras via LEVEL_SWITCHED); native Safari gör samma
  ├─ ström försvinner (404 på manifest) → hls.js fatal → advanceCandidate()
  ├─ kanalbyte → stopAndClosePlayer() → hlsDetach() → ny resolveStreams()
  ├─ DVR→live ("Till Direkt") → seek till live-kanten (ingen omstart)
  └─ live→DVR (spola bak) → seek in i fönstret (ingen omstart)
```

`workingStreamIdx`-minnet fungerar oförändrat (index i den nya listan).
Watchdog rensas vid `playing` (befintligt).

---

## 11. UX-ALTERNATIV: FLAC vs HLS/DVR (beslut lämnas öppet)

### Alternativ A — Två lägen i Inställningar (global växel)
"Kvalitet: Bäst ljud / Direkt med spolning". En inställning, gäller alla
kanaler. **+** enklast, minst UI. **−** global; P2-Musik-FLAC-fans måste
offra DVR (eller tvärtom) överallt.

### Alternativ B — Per-kanal-väljare i Inställningar
Under "Valda favoriter": varje kanalrad får en liten växlare (Bäst ljud /
Direkt+spola) där båda vägarna finns. **+** P2 Musik kan ha FLAC medan
P1 har DVR. **−** mer UI i sheeten; två koncept att förklara.

### Alternativ C — Automatiskt + badge som avslöjar
Appen väljer själv: FLAC när den finns (kvalitet först), HLS när
användaren spolar bakåt. Konkret: första tryck = FLAC; trycker användaren
"bakåt 15 s" på en live-ström → appen byter till HLS (med toast "Bytte
till spolbar kvalitet") och stannar där för sessionen. **+** noll
inställningar, mobilvänligt. **−** oväntat byte kan förvirra; ljudet
ändras karaktär (FLAC→AAC).

### Alternativ D — DVR-knapp i spelaren (på begäran)
Spelaren visar en liten "Spola"-knapp bara för kanaler som HAR en
DVR-väg. Tryck → byter till HLS + visar spolrad. **+** explicit,
användaren styr, ingen global inställning. **−** en knapp till i
spelaren (liten yta).

**Tekniskt är alla fyra billiga** — de skiljer sig bara i vem som sätter
`mode`-parametern till `resolveStreams`. Rekommendation att börja med **D
eller C** (mobil-enklast), men beslutet är ditt.

---

## 12. IMPLEMENTERINGSFASER

### Fas 1 — Stream descriptors + capability-modul (grund)
- **Filer:** `public/app.js` (STREAM_TABLE, CAPS, resolveStreams,
  liveCandidates→resolveStreams-anrop), `tests/` (nya enhetstester för
  resolveStreams-sortering/filtrering).
- **Ansvar:** ersätta URL-strängar med descriptors; alla befintliga
  beteenden bevarade (FLAC P2, iOS AAC, MP3).
- **Beroenden:** inga.
- **Acceptans:** alla dagens fall ger SAMMA kandidatordning som idag
  (verifierat med tester); badge visar codec+bitrate från descriptor;
  inga nya nätverksanrop.
- **Regressionsrisk:** ordningsfel i tabellen → fel kvalitet. Testar med
  jämförelsetester mot gamla liveCandidates.
- **Test:** `node --test` + manuell P2/P1/P3-playback i Chromium + badge.

### Fas 2 — HLS-uppspelning (hls.js + native)
- **Filer:** `public/app.js` (hlsAttach/hlsDetach, lazy script-load,
  playTrack/advanceCandidate/stopAndClosePlayer HLS-grenar),
  `public/index.html` (ingen ändring — script laddas dynamiskt).
- **Ansvar:** spela HLS på Safari (native) och Chromium (hls.js).
- **Beroenden:** fas 1.
- **Acceptans:** P1 via HLS spelar i Chromium och (vid manuell test)
  Safari; fallback HLS→FLAC→MP3 fungerar; watchdog täcker HLS-häng.
- **Risk:** hls.js-version/CDN; MSE-quirks. Mildras av watchdog + fallback.
- **Test:** Chromium (här), riktig Chrome, sedan iPhone (fas 5).

### Fas 3 — DVR: seek-modell + UI
- **Filer:** `public/app.js` (readDvrWindow, timeupdate-hook,
  renderPlayer: spolrad för live + "Till Direkt"-knapp + "~X min bakom"),
  `public/styles.css` (spolrad återanvänd; liten live-kant-markering).
- **Ansvar:** visa/använd seekable-fönstret; rullande fönster-hantering.
- **Beroenden:** fas 2.
- **Acceptans:** DVR-rad visas ENDAST när seekable ≥ 60 s; 10-min-rewind
  fungerar; "Till Direkt" återgår; fönster-glidning hanteras; MP3/FLAC
  visar ingen DVR-rad.
- **Risk:** Safari-vs-hls.js seek-skillnader → all logik läser seekable.
- **Test:** Chromium (hls.js), iPhone Safari (manuell, fas 5).

### Fas 4 — Bitrate/codec-state + MediaSession
- **Filer:** `public/app.js` (LEVEL_SWITCHED-hook, badge-uppdatering,
  MediaSession metadata incl. bitrate i title? — nej: badge räcker;
  MediaSession får kanalnamn som idag).
- **Ansvar:** badge = faktisk kvalitet; MediaSession oförändrad.
- **Beroenden:** fas 2.
- **Acceptans:** ABR-nedgång syns i badgen; FLAC visar "FLAC" utan
  bitrate; MP3 visar "MP3 96".
- **Risk:** låg.
- **Test:** throttla nätverk i devtools → badge sänks.

### Fas 5 — Riktig enhetsvalidering (manuell checklista)
- **Filer:** inga (eller små fixar som upptäcks); `ENHANCEMENTS.md` loggas.
- **Acceptans:** se §13-checklistan nedan.
- **Risk:** upptäckta plattformsskillnader → justeringar i CAPS/tabell.

### Fas 6 — (Frivillig) FLAC-auto-upptäckt + Firefox-utvärdering
- **Filer:** `public/app.js` (HEAD-probe, sessionStorage-cache).
- **Ansvar:** upptäcka nya SR-FLAC-strömmar; omtesta Firefox TS-i-MSE.
- **Beroenden:** fas 1–3 stabila.
- **Acceptans:** ny FLAC-URL för P1 hittas och spelas utan kodändring.

---

## 13. ACCEPTANSKRITERIER + MANUELL TESTCHECKLISTA (fas 5)

Varje plattform testas för: uppspelning, codec/badge, bitrate/badge, HLS,
DVR, 10-min-rewind, 3-h-gräns (spola till äldsta), Till-Direkt,
bakgrundsljud, MediaSession/lockscreen, kanalbyte, fallback (flygplans-
läge kort / död URL simuleras).

| Plattform | Förväntat |
|---|---|
| iPhone Safari + PWA | native HLS; DVR-rad; 320/192-badge; bakgrund + låsskärm |
| iPad Safari + PWA | som iPhone |
| Android Chrome + PWA | hls.js; DVR; badge; WebAPK-bakgrund |
| Win Chrome / Edge | hls.js; DVR; badge |
| Win Firefox | MP3-fallback; ingen DVR-rad; ingen regression |
| macOS Safari | native HLS; DVR |
| macOS Chrome | hls.js; DVR |
| Linux Chrome | hls.js; DVR |
| Linux Firefox | MP3-fallback |

**Globala regressionskriterier:** P2 FLAC spelar fortfarande först i
"bäst ljud"-läge; poddar/nyheter opåverkade; 10/10 befintliga tester
passerar + nya resolveStreams-tester; badge följer fallback; buffrings-
indikatorn fungerar för HLS också.

---

## 14. FILER SOM BERÖRS (sammanfattning)

- `public/app.js` — STREAM_TABLE, CAPS, resolveStreams, hlsAttach/Detach,
  readDvrWindow, renderPlayer (DVR-rad, badge), watchdog-interaktion
- `public/styles.css` — spolrad för live (återanvänder .seek-row),
  "Till Direkt"-knapp, ev. live-kant-markering
- `tests/` — resolveStreams-enhetstester
- `ENHANCEMENTS.md` — fasloggar
- **Orörda:** sw.js, manifest, build.mjs, server.js, index.html (hls.js
  laddas dynamiskt), all podd/nyhet-logik

## 15. RISKER (topp 5)

1. **Safari-DVR-skillnader** — seekable-beteende kan skilja mellan iOS-
   versioner; mildras av att ALLT läses från seekable + fas 5-test.
2. **hls.js på Firefox** — utesluts initialt; ingen kodväg riskeras.
3. **Content steering i hls.js** — master-manifestet har EXT-X-CONTENT-
   STEERING; hls.js 1.7 stödjer det, men om problem uppstår: peka direkt
   på `ljud1-cdn.sr.se/lc/{slug}.m3u8` (verifierad URL) med ljud2 som
   explicit fallback-post.
4. **Electron/VS Code-webview-quirk** — vår förhandsvisning är inte
   sanningskällan; fas 5 på riktig hårdvara är avgörande.
5. **FLAC-regression** — P2-FLAC-vägen röras endast av tabellposten;
   jämförelsetester i fas 1 skyddar ordningen.
