# Förbättringslogg — Min Radio

Pågående anteckningar för förbättringar att ta itu med senare. Nyast överst.

---

## AKTIV ARBETSKÖ (uppdaterad 2026-09-23 kväll — dokumentationspass)

Historiken nedan bevaras som referens; statusrättelser kan annotera äldre
slutsatser när senare evidens har motbevisat dem. Denna sektion är **den
aktuella arbetskön** — allt annat nedan är historik eller äldre poster som
har rullats in hit.

### Statusrekonciliering 2026-09-23 (dokumentationspass)

Följande äldre poster har justerats så att loggen inte visar färdigt arbete
som öppet (detaljer i respektive historisk post):

| Post | Tidigare status | Nuvarande status |
|---|---|---|
| ROADMAP: Fas 4 (expanderbar player) | PLANNED | **DONE** (Fas 4 redesign + gester + låt/artist/artwork + fallback, verifierat live) |
| ROADMAP Fas 5 (context cards) | PLANNED | **DONE** (långtryckskort: tablå igår+idag, poddavsnitt; verifierat live) |
| ROADMAP BUG 1 (Inställningar-krasch vid scroll) | OPEN | **DONE** (rotorsak: swipe-to-close på hela sheeten; fixad i BUG 1-fixpasset, verifierat) |
| ROADMAP BUG 2 (nyhetslänkar öppnas inte) | OPEN | **DONE** (rotorsak: döda /artikel/<id>-URL:er; fixad i BUG 2-fixpasset, verifierat) |
| BUG A (pill minus-tid) | OPEN i iPhone-feedback-posten | **DONE** (fixpass 2026-09-22, verifierat live Edge; iPhone-verifiering återstår enbart som enhetstest) |
| BUG B (live DVR-slider-instabilitet) | OPEN i iPhone-feedback-posten | **DONE** (touch-action + pointer-robusthet, verifierat live; separat från öppet episode-seek-drag) |
| Öppna punkter 2026-09-21 (buffringsindikator, svep-ned-stäng, sheet-bleed) | öppna | **DONE** (implementerade + verifierade samma dag) |
| Ljud-diagnostik "Missing functionality" 1–3, 5 | öppna rekommendationer | **DONE** (retry/fallback = advanceCandidate + watchdog; stall-detektering = buffrings-badge; canPlayType = CAPS; HLS = Fas 2A) |
| Ljud-diagnostik 4 (kvalitetsval) + 6 (nätverksmedvetenhet) | öppna | **OPEN → ny förstärkningspost "Högsta ljudkvalitet" (nedan)** |
| Låsskärm fel-PWA | öppen | **OPEN — diagnostik deployad, rotorsaksdata väntas från iPhone** (se PWA-ljudlivscykel nedan) |
| iPhone/Android-validering | NOT YET VALIDATED | **PARTIAL** (earlier iPhone screenshots cover DVR/±15 s/gester/zoom/long-press; updated episode seek/metadata, lifecycle and Android Chrome remain blocked on physical-device access) |
| Episod-låtmetadata | SOURCE FIX IMPLEMENTED — build/test verified; production/device verification BLOCKED | Root cause: repaint early-return when compact line absent; stale transition guards added |
| Episodens seek-reglage på touch | SOURCE FIX IMPLEMENTED — local pointer UI verified; production/iPhone validation BLOCKED | Preview/release/cancel and thumb hit area implemented; device behavior remains |
| iPhone installed-PWA lifecycle analysis | OPEN — BLOCKED (waiting for user-exported `sr-diag-log`; no device storage access available here) |
| E1–E4 förstärkningar | PLANNED | Ta efter öppna uppspelnings-/enhetsproblem; E1 är högst prioriterad bland förstärkningarna |

---

## ARBETSKÖ — FYRA NYA FÖRSTÄRKNINGAR (registrerade 2026-09-23, EJ implementerade)

### E1 — Högsta möjliga ljudkvalitet (HÖGSTA PRIORITET BLAND FÖRSTÄRKNINGAR — EJ före öppna buggar)
**Mål:** appen ska alltid använda den bästa ljudkvalitet som är tekniskt
tillgänglig och pålitligt spelbar, med robust fallback till lägre kvalitet.

**Bakgrund:** utredningen av arkiverade avsnitt upptäckte att
`web-api.sr.se/v1/player/ondemand?id=<id>&type=episode` returnerar
`item.audio.src` med FLERA M4A-varianter (32/96/192 kbps). Appen spelar idag
via `episodes/get` → `listenpodfile.url` (MP3) / `broadcastfiles[0].url`
(M4A) — dvs. ofta INTE högsta kvalitet. Live-radio använder HLS-laddern
(32/128/192/320 AAC) via STREAM_TABLE + MP3-fallback.

**Att utreda och dokumentera (innan kod ändras):**
- Aktuell kvalitet för live-radio (per kanal, verifiera STREAM_TABLE mot
  SR:s aktuella ladder).
- Aktuell kvalitet för arkiverade avsnitt/poddar (episodeAudioFields-kedjan).
- Alla kvalitetsvarianter SR erbjuder per uppspelningstyp (HLS-ladder,
  M4A-varianter, MP3, FLAC på P2 Musik).
- Browser/iOS PWA-stöd för formaten (AAC-HE, AAC-LC, M4A-container).
- Är högsta kvaliteten faktiskt spelbar och stabil på iPhone/PWA?
- Ska appen välja högsta tillgängliga kvalitet automatiskt?
- Lämplig fallback om högsta kvalitet misslyckas (befintlig
  advanceCandidate-mekanism kan återanvändas).
- Ska nätverksförhållanden (Wi-Fi/cellulärt) påverka i framtiden? Utred först
  — anta INTE adaptiv kvalitet utan stöd i utredningen.
- Praktiska skillnader HLS vs AAC vs MP3 vs FLAC vs M4A för denna app.

**Viktigt:** ändra inte den fungerande uppspelningsvägen utan verifiering.
Målet är maximal praktisk kvalitet utan att offra uppspelningspålitlighet.

### E2 — Spotify + YouTube-ikoner i expanderade spelaren
**Mål:** när artist/låt-information finns, visa små klickbara Spotify- och
YouTube-ikoner i expanderade spelaren.
- Endast ikoner — inga stora knappar eller textlabels.
- Visuellt diskreta.
- Klick öppnar relevant Spotify/YouTube-destination med plattformslämplig
  öppning (app/browser) på iPhone/PWA.
- Utred: kan tillförlitliga sök-URL:er genereras från artist + titel utan
  backend? (`open.spotify.com/search/...`, `youtube.com/results?search_query=...`
  är kandidater; exakt matchning kan INTE garanteras — dokumentera denna
  begränsning.)
- Datakälla finns redan: live = rightnow (artist/title), episoder =
  ondemand-tracks (artist/title). Spotify-id finns redan i ondemand-tracks
  (`spotifyId`) — kan ge EXAKTA Spotify-länkar för arkiverade avsnitt.
- UI minimal eftersom funktionen används sällan.

### E3 — Nyheter: utred uppspelningsbarhet / play-pill
**Mål:** nyhetsobjekt ska i framtiden ha en synlig play-pill direkt på
raden, integrerad i befintlig radio/podd-spelararkitektur.

**Viktigt:** tidigare slutsats ("nyheter kan bara visa preview/bild/text/
URL") ska INTE antas vara en teknisk gräns. Använd discovery-regeln: en
ofullständig endpoint-utredning bevisar INTE att förmågan saknas.

**Att utreda (innan någon UI ändras):**
- Vilken datakälla levererar Nyheter idag? (Ekot Atom-flöde — verifiera.)
- Vad ger underliggande SR-API per nyhetsobjekt: audio, episode-id,
  media-URL, annan spelbar referens?
- Har SR:s nyhets-/ekot-sidor nätverksrequest eller spelare kopplad till
  objektet? (Fånga trafik enligt discovery-regeln.)
- Kan webbläsaren nå källan direkt från GitHub Pages (CORS)?
- Är begränsningen teknisk — eller var den tidigare utredningen ofullständig?
- Kan befintlig spelare spela källan utan backend?

**UX-krav för framtida implementation:** synlig play-pill från början;
ren hantering när objekt inte är spelbart (ingen missvisande play-knapp);
integrerad med befintlig spelare.

### E4 — App-information: INFO-ikon på startsidan + uppdaterad hjälpinnehåll
**Mål:** appen ska förklara sig själv via en tydlig INFO-ikon överst på
startsidan — inte via Inställningar.
- Lägg till Info-ikon i toppen av startsidan.
- Öppna en ren informations-/hjälpvy.
- Förklara på användarspråk: vad appen är till för; radio; poddar/program;
  Nyheter; favoriter; relevant uppspelningsbeteende; bakgrundsljud/PWA om
  lämpligt.
- Nuvarande Info-vy (openAbout) är föråldrad — behandla som legacy-innehåll
  som behöver genomgripande omarbetning.
- Håll tekniska detaljer borta från den primära användarförklaringen.
- Gör innehållet konsistent med dagens app, inte den historiska versionen.

---

## ÖPPNA POSTER (kvarstående, ej nya förstärkningar)

### Episod-låtmetadata otillförlitlig i fältet — SOURCE FIX IMPLEMENTED; live/iPhone RETEST REQUIRED
- Användarens iPhone + Edge-test av igårens program: låt/artist visas bara
  mycket sällan; när den visas uppdateras den INTE vid nästa låt; ibland
  visas fel kanals information när ingen låt spelas (P3 "Vaken" medan
  Jazzradion spelar; "Aftonsång och Vaggvisa / Eduard Tubin" medan Musik
  mot midnatt spelar — skärmdumpar i rapporten).
- Detaljerad analys + utredningsplan: se "FÄLTTEST 2026-09-23"-posten
  (ovan, under episod-metadata-posten). **Utred nästa session innan kod
  ändras.**
- Senare evidens: GitHub Pages-UI-testet reproducerade stale/tom expanderpanel
  efter seek **6/6 gånger**; korrekt spår visades först efter att panelen
  stängts/öppnats. Testet saknade fungerande mediaelement, så faktisk
  ljuduppspelning/timeupdate och state-vs-repaint-rotorsak är fortfarande
  obevisade i första headless-passet. Senare source review fastställde
  repaint-roten; se fix-anteckning nedan.
  **Uppdatering 2026-09-24 — kodorsak verifierad, fix implementerad:**
  `paintNowPlaying()` tidigare returnerade direkt när `.now-playing-line`
  saknades. Episoder saknar den kompakta live-raden, så `updateEpisodeTrack()`
  kunde uppdatera `episodeCurrentTrack` och anropa paint, men aldrig nå
  `panel._srRepaint()`. Stäng/öppna byggde om panelen och läste den redan
  korrekta state:n — exakt symptom från Playwright. Ändringen gör compact line
  valfri men kör panelrepaint ändå; regressionstest skyddar detta.
- Ytterligare hardening: episode metadata state nollställs/in-flight fetch
  invalidieras vid ALLA playback-övergångar (även episode→episode), stale
  live-artwork requests invalidieras när polling stoppas/uppdateras, och
  expanderad episode artwork lånar inte live-kanalens låtbild.
- **Uppdatering 2026-09-24:** repo/build mismatch är åtgärdad lokalt.
  `public/` och tidigare `build.mjs` var gitignored och gav `npm run build` en
  stale utvecklingskopia; testmappen var också ignored. Nu är package/tests/
  module/build script spårbara, tester läser tracked root, index pekar på den
  enda aktuella hashed bunlden, och canonical Pages build genererar root +
  `dist/`, skriver SW precache inklusive moduler/cache version. GitHub Pages
  API bekräftade source `main` `/`.
- Artifact inspection at final build: root index loads `app.ac87ca45.js` +
  `styles.d80070f9.css`; SW cache is content-based and precaches the same pair
  + `src/episode-seek.mjs`; old hashed bundles are deleted. Build passed;
  tracked test suite **98/98** passerar.
- Built artifact browser journey: player/episode/panel rendered. Simulated
  touch-pointer drag previewed 10→55% and seek time 0:01→34:43; synthetic
  post-drag click caused no second seek. A pointerup-only vertical release
  with 20 px vertical drift left media time unchanged (found/fixed after
  browser testing). Same-track metadata showed the episode-title fallback;
  favorite P3 Musikdokumentär is talk content, not a useful music-track fixture.
  Browser had no observable `<audio>`/video/media request and SR MP3 failed
  with `ERR_ABORTED`/`ERR_CONNECTION_CLOSED`, so no actual audio/timeupdate
  claim.
- Production Pages has **not** been deployed or retested after these edits;
  physical iPhone/Android behavior still BLOCKED. See exact support steps
  below.

### Episodspelare: seek-reglaget ska vara dragbart på iPhone — SOURCE FIX IMPLEMENTED; iPhone RETEST REQUIRED
- Användarrapport: vid podd-/episoduppspelning går det att trycka på
  tidslinjen för att söka, men touch-and-drag fungerar inte som på
  live-radions DVR-reglage.
- Den runda tumregeln/indikatorn ska synas även för poddar. Utöka dess
  touch-träffyta så att dragning startar pålitligt utan att användaren måste
  träffa ett fåtal exakta pixlar; den synliga punkten behöver inte göras
  större om en större interaktionsyta räcker.
- Förväntat: tryck och drag ger samma förhandsvisning och seek vid släpp som
  live-reglaget, samtidigt som vanliga sidgester inte fångas av misstag.
- Orsak ej fastställd. Jämför episodens `.seek-bar`-händelser/CSS med
  `.dvr-bar`; verifiera drag från både tummen och spåret på riktig iPhone.
  Behåll tryck-seek och kontrollera att bredare träffyta inte försämrar
  sidscroll eller spelarens gester.
- **Uppdatering 2026-09-24 — implementation klar, iPhone-validering BLOCKED:**
  `.episode-seek-bar` har horisontell pointer-preview och commit på släpp,
  kvarvarande klick-seek, 32 px transparent tum-träffyta runt oförändrad
  synlig prick, vertikal gest-avbrytning, pointercancel/lost-capture-säkerhet
  och tangentbordsstöd. Full testsvit passerade; tracked-root-source preview
  visade pointerpreview 10→55 % och släpp uppdaterade tiden 0:01→34:43.
  Headless-miljön hade ingen observable audio node/faktisk ljudtransport och inget
  iPhone finns tillgängligt här. Kräver iPhone Safari + installerad PWA för
  drag från thumb/bar, tap-seek, vertikal scroll/svep, cancel och verklig
  seek/lyssning. Android touch-gesture har inte heller testats.
- **Efter deploy: konkret stöd som krävs.** iPhone Safari + installerad PWA:
  drag från thumb och bar, tap-seek, vertikal scroll/svep, cancel, seek över
  känd låtgräns och episode→episode/live; verifiera faktisk ljudtid och både
  compact/expanded metadata. Lifecycle separat: spela→lås→lås upp→svep bort→öppna;
  exportera sanerade DIAG_ID-rader för audio/pagehide/pageshow/visibility/freeze/
  MediaSession. Android Chrome/PWA behöver en Android-enhet för live HLS/DVR,
  episod seek/drag, metadata/kanalbyten, fallback, bakgrund och låsskärm.

### PWA-ljudlivscykel (iPhone) — OPEN, diagnostik deployad
- Användarrapport: ljud fortsätter när PWA swipas bort; låsskärmen öppnar
  fel PWA. **Både pagehide/freeze-fixen (38efd3b) och diagnostikpasset
  (66af359) har EJ löst problemet enligt användarens senaste iPhone-test
  2026-09-23 — beteendet är oförändrat.**
- Kodgranskning (2026-09-23): exakt EN Audio-element (singleton, aldrig
  återskapad) — appen kan strukturellt inte producera ett andra element.
  Kandidater: (a) annat dokument (dubbelinstallation/gammal flik), (b) iOS
  media-session-UI kvarstår medan ljudet stoppat, (c) iOS standalone-
  process avslutas fördröjt (OS-beteende).
- Diagnostik aktiv: DIAG_ID per sidladdning → localStorage 'sr-diag-log'
  (överlever sidstängning). **Nästa steg: hämta och analysera diag-loggen
  från användarens iPhone efter reproduktion av sekvensen (spela → lås →
  lås upp → swipa bort PWA:n → öppna igen). Ingen workaround förrän
  rotorsaken är identifierad.**
- Tillgänglig logg i den delade VS Code-browserns GitHub Pages-origin:
  200 poster, 10 DIAG_ID:n mellan 2026-09-23 02:00Z och 20:29Z; 9 page-load
  och 8 pagehide, majoriteten visibilitychange/audio-play/pause. Detta är
  desktop/browser-historik (display-mode standalone=false), inte den
  installerade iPhone PWA:n och inte korrelerad bevisning för rapporterade
  lås→svep-bort-sekvensen. Därför räcker inte loggen för rotorsaksbeslut.
- Diagnostikloggen ska tas bort när rotorsaken är känd.
- **BLOCKED — device log unavailable:** denna agent-session saknar åtkomst
  till iPhone localStorage och Safari Web Inspector. Krävs att användaren på
  installerad PWA reproducerar spela→lås→lås upp→svep bort→öppna igen och
  exporterar sanerade `sr-diag-log`-rader via Mac Safari Web Inspector
  (Develop → iPhone → Min Radio → Console →
  `localStorage.getItem('sr-diag-log')`). Dela posterna med DIAG_ID och
  page-load/audio-src-set/audio-play/pause/pagehide/pageshow/
  visibilitychange/freeze/mediasession-cleared; maskera query-parametrar
  eller andra privata värden. Ingen lifecycle-kod/workaround ändrad utan
  den evidensen. Utan fysisk iPhone/Mac-inspector eller användarexporterad
  logg går Task 1/4 inte att slutföra.
- **Stöd som krävs:** jag kan inte läsa iPhone-localStorage eller iPhone-
  konsolen från denna VS Code-session. På den installerade PWA:n: reproducera
  spela → lås → lås upp → svep bort → öppna igen; öppna sedan Info/inställningar
  och exportera innehållet i localStorage-nyckeln `sr-diag-log` (200 rader,
  vanlig text/JSON) genom en tillfällig kopieringsruta om den finns i den
  aktuella builden, annars via iOS Safari Web Inspector. Skicka bara posterna
  med DIAG_ID och händelserna page-load, audio-src-set/play/pause,
  pagehide/pageshow, visibilitychange, freeze och mediasession-cleared;
  maskera URL-parametrar/personuppgifter. Loggen innehåller normalt bara
  kanal-/resursnamn och tid, men granska innan delning. Nödvändigt stöd:
  användaren behöver klistra in/exportera den sanerade loggen; utan detta
  finns ingen evidensbaserad livscykelfix att verifiera.

### Riktig enhetsvalidering — PARTIAL
- iPhone (verifierat via användarskärmdump): DVR-seek, ±15 s, LIVE-etikett,
  knappplacering, zoom, långtryckskort, expanderad spelare, gest-fixar.
- iPhone (öppet): episod-låtmetadata-panelen (headless UI-symptom reproducerat,
  source fix implemented but new production/device retest needed), episodens
  seek-drag/träffyta (implemented, not iPhone-verified), och låsskärm/PWA-
  ljudlivscykel (diagnostic log needed; see above).
- Android Chrome: ej validerat (hls.js-vägen; no Android device available in
  this session). Required support: Android phone with Chrome; install/open
  PWA and test HLS live, DVR, episode play/seek/drag, metadata transitions,
  channel switch, fallback, background and lock screen. Mark remains BLOCKED
  until observed on device.

### Låsskärm: MediaSession-metadata + ikon — DONE med förbehåll
- MediaSession-metadata + action handlers implementerade och deployade
  (2026-09-22). Ikonen full-bleed square (verifierad md5 + hörnpixel).
- Användaren bekräftade: "SR-ikoner visas nu på låsskärm + i spelaren".
- Kvarstår: fel-PWA-öppningen vid låsskärm (se PWA-ljudlivscykel ovan —
  samma rotorsaksutredning).

---

## 2026-09-22 — Tablå-utredning: varför fungerar programhopp i SR:s app men inte hos oss?

**Användarobservation:** SR:s officiella iPhone-app har fungerande tablå och
programnavigering, medan våra programhopp-knappar inte syns. Utredt varför.

### Fakta (curl-verifierat 2026-09-22, även med VPN av = svenskt nät)

1. **SR:s publika tablå-API är nere — totalt.** `api.sr.se/api/v2/scheduledevents`
   svarar 500 i ALLA varianter: med/utan channelid, med/utan date, alla
   format, även `/api/v1/` och RSS-varianterna (`/api/rss/kanal/164`,
   `/api/rss/tabla/164`). Även `channels/{id}/rightnow` är 500. Detta är en
   server-side outage i SR:s schemabackend — inte geo-block, inte parametrar,
   inte våra headers.
2. **SR:s app/web använder INTE api.sr.se för tablå.** Kanalsidan
   `sverigesradio.se/kanaler/p3` (Next.js SSR) inbäddar hela schemat
   server-side i HTML: `scheduleItems` med `title`, `startTimeUtc`,
   `endTimeUtc` (10 poster för P3, spanar in i nästa dag). Deras webb och
   native-appar läser en intern tjänst (psapi-hosts löser sig inte publikt).
3. **Kanalsidans data är CORS-blockerad för oss.** `sverigesradio.se` skickar
   inga `access-control-allow-origin`-headers (verifierat med Origin-header) —
   vår PWA kan inte hämta den inbäddade tablån från webbläsaren. Enda
   CORS-öppna SR-värd är api.sr.se, vars schemabackend är 500.

### Slutsats

- Våra programhopp-knappar är korrekt byggda med graceful degradation: de
  syns först när `scheduledevents` svarar 200 igen. Ingen app-ändring kan
  komma åt tablå-data medan SR:s schemabackend är nere — SR:s egen app går
  via interna API:er som inte är publikt nåbara.
- ~~**Åtgärd: vänta ut SR:s API-fix.**~~ (REVIDERAD, se nedan.)

### UPPDATERING 2026-09-22: SR bekräftar avveckling — 500:an kommer INTE att fixas

Källa: SR:s officiella tekniksupportforum,
[tråden "Sveriges Radios API"](https://teknisk-support.sverigesradio.se/org/teknisk-support/d/sveriges-radios-apier/)
(svar från "Annika Webbmaster", SR Lyssnarservice, nov 2025 – jun 2026):

- **"Det öppna API:t avvecklas."** Explicit uttalande. Regeringens
  public service-proposition 2026–2033 kräver att SR "undviker att
  tillgängliggöra innehåll på externa internetplattformar"; SR avsätter
  därför inga resurser på det öppna API:t.
- **"API:t går fortfarande att använda, men kända problem åtgärdas inte.
  Det kommer dessutom att uppstå fler problem framöver … Förr eller senare
  kommer API:t att funka så pass dåligt att vi väljer att ta bort det helt.
  Möjligen tar vi av strategiska skäl ned detta API 'i förtid'."**
  → Vår tidigare hypotes "tillfällig outage, vänta på fix" är FÖRKASTAD.
  scheduledevents/rightnow/RSS-tablå är sannolikt permanent borta.
- **Orsak till att det slutar fungera:** "Vi förnyar vår dataförsörjning och
  det nuvarande öppna API:t använder metoder som vi snart inte längre
  använder. Därmed kommer det nuvarande API:t att sluta fungera."
- **Jun 2026-uppdatering i tråden:** "API:t i sin nuvarande form kommer att
  upphöra. Delar ersätts inte alls (t.ex. topplistor och grupper). Andra
  delar, som poddflöden (api.sr.se/api/rss/pod/…), kommer att få ny URL."
  → Även våra poddkällor kan bryta framöver; kanaler/episoder/programs
  fungerar tills vidare men är inte garanterade.
- **SR:s egen app:** backend-API:t (app-api.sr.se) är "inte för publik
  användning", saknar dokumentation och är inte dimensionerad för extern
  last. Ingen väg in där.
- **SR:s sanktionerade väg för strömmar:** artikel med direktlänkar till
  ljudströmmar för alla kanaler
  (sverigesradio.se/artikel/lankar-till-ljudstrommar-for-alla-kanaler) —
  våra stream-URL:er är alltså den del som SR aktivt stödjer.
- SR uppmanar API-användare att beskriva sina tjänster i tråden (de samlar
  underlag för ett internt beslut). Min Radio är ett konkret exempel.

### Reviderad åtgärd

1. **Programhopp:** knappen förblir dold (graceful degradation redan
   implementerad). Ingen kodändring — men vi väntar inte längre på någon
   fix; den kommer sannolikt aldrig. Om tablå-funktionen ska överleva krävs
   en CORS-proxy mot kanalsidans inbäddade schema (användarbeslut, bryter
   mot "ingen backend"-principen).
2. **Överlevnadsplan för appen (ny prioritet):** (a) kanalströmmar via SR:s
   officiella direktlänksartikel är den stabila grunden — redan vår väg;
   (b) poddar via api.sr.se/api/rss/pod/… får ny URL enligt SR — bevaka och
   byt vid brytning; (c) episodes/programs-endpoints fungerar tills vidare
   men planera fallback (RSS-poddflöden är SR:s egen ersättning).
3. **Överväg att posta en kort beskrivning av Min Radio i forumtråden** —
   SR ber uttryckligen om användningsexempel, och det är den enda kända
   vägen att påverka beslutet.

### Firefox-observation (förklaring, ingen bugg)

Firefox visar den enkla spelaren (ingen DVR-rad, inga ±15 s-knappar) eftersom
Firefox medvetet är exkluderad från hls.js-vägen (TS-i-MSE opålitligt —
dokumenterat i kompatibilitetsmatrisen). Firefox får MP3 96-fallback, som saknar
seekable-fönster → ingen DVR-UI. Detta är designat beteende, inte ett fel.

### Verifierat fungerande (användarens skärmdump, Edge + iPhone)

DVR-rad med ±15 s-knappar + LIVE-etikett syns och fungerar på Edge och iPhone
(P2, AAC 192, klocktid 23:04 i vänsterlabel). Fixpasset är live.

---

## 2026-09-22 — DVR-transport: gest-fix + ±15 s + programhopp (implementerat, deployat)

Användarfeedback efter iPhone-test: (1) slidern "hoppar till noll av sig själv"
när man sveper spelaren nedåt, (2) ±15 s-knappar behövs — slidern täcker 3 h
och är för grov, (3) önskemål om programhopp (föregående/nästa program).

### 1. "Hoppar till noll"-buggen (FIXAD — rotorsak etablerad)
**Rotorsak:** svep-ned-gesten på spelaren som *börjar på DVR-baren* tolkades
som horisontell drag → vid släpp committades seek till fingrets x-position
(ofta nära noll). Bara `touch-action: none` skyddade inte mot detta — baren
äger alla pekare på sig.

**Fix (gest-disambiguering):** drag-axeln avgörs nu av första signifikanta
rörelsen (dx ≥ dy och dx ≥ 8 px = horisontell). Vertikal-dominanta gester
avbryter draget UTAN att committa något — svep-ned-hanteraren äger dem.
Horisontella drag och vanliga tryck committar seek som förut.

**Verifierat (Edge CDP, HLS P3):** seek till 50 % (5440 s) → vertikal svep på
baren → position OFÖRÄNDRAD (5440). Horisontell drag → seek fungerar (→ 10925).
82/82 tester.

### 2. ±15 s-knappar (implementerat)
`seekBy(±15)`-knappar (ikon: pil-cirkel) på vardera sidan om DVR-baren,
clampade till fönstrets start. Samma visuella språk som LIVE-etiketten.
Verifierade live: back/fwd ändrar currentTime med 15 s.

### 3. Programhopp — föregående/nästa program (implementerat, beroende av SR:s API)
- **Datakälla:** SR:s `scheduledevents?channelid=X&date=YYYY-MM-DD` (tablå).
  **VIKTIGT: endpointen svarar 500 just nu (SR-serverfel, verifierat 2026-09-22
  med alla parametervarianter).** Implementeringen är därför byggd med graceful
  degradation: knappen "föregående program" renderas först när schemat hämtats
  framgångsrikt; API-nedtid = knappen syns inte. När SR fixar sin API dyker
  funktionen upp automatiskt.
- **Semantik:** "föregående" = starttiden för programmet vid den hörda
  positionen (30 min in i program A → tryck = börja om A; tryck igen =
  Morgonpasset). "nästa" = första programmet som startar efter positionen —
  knappen tänds ENDAST när man lyssnar bakom live OCH ett senare program finns.
- **Fönster-mappning:** wall-clock → position via `end − (now − startMs)`;
  program äldre än 3 h ger en svensk toast i stället för tyst misslyckande.
- Cache per kanal+dag, 10 min TTL.

### Deploy
- Commit feef041, pushad. Pages serverar `app.92d1e4b6.js` +
  `styles.3548e122.css` (verifierat via curl + inbyggd webbläsare mot LIVE-URL:
  dragAxis/seekBy/programBoundary/±15-labels finns i serverad bundle).
- HLS är geo-blockat från Linux-maskinens nätverk (cc=US) — DVR-rad kunde ej
  verifieras mot LIVE-URL härifrån, men allt verifierat i lokal Edge där HLS
  spelar. iPhone (svenskt nät) bör se DVR-rad + knappar.

### Kvar — **UPPDATERAD 2026-09-23: programhopp är LIVE**
- iPhone-test: gest-fixen (svep nedåt ska INTE längre seeka) och ±15 s-
  knapparna verifierades via användarskärmdump 2026-09-22.
- ~~programhopp (syns när SR:s tablå-API fungerar igen)~~ **DONE 2026-09-23:**
  appen migrerad till `scheduledepisodes` (scheduledevents är permanent
  avvecklat) — programhopp-knapparna är aktiva och tablåkortet visar
  igår + idag.
- ~~SR: rapportera/vänta ut scheduledevents-500:an.~~ **OBSOLETE** — API:t
  avvecklat; migreringen gjorde frågan irrelevant. Överlevnadsplanen
  (podd-URL:er, direktlänkar) behövs inte längre: scheduledepisodes +
  episodes/get täcker uppspelningsvägen.

---

## 2026-09-22 — FIXPASS: BUG A + BUG B + BUG 1 + BUG 2 (implementerat & verifierat)

Alla fyra öppna buggar från pass 1–2-planen är åtgärdade i en pass. 64/64
tester (49 gamla + 15 nya regressionstester i `tests/fixpass.test.mjs`).
Live-verifierad i riktig Edge 153 headless via CDP mot lokal build
(`scripts/cdp-eval.mjs` = ny zero-dep CDP-klient). **iPhone ej verifierad —
användaren får testa** (BUG B och BUG 1 är touch-specifika).

### BUG A — pillen visar minus-tid (FIXAD)
- `renderPlayer` mode-pill använder nu `dvrOffsetLabel()` ("−3 h 1 min")
  i stället för klocktid. Klocktiden bor kvar i seekradens vänsterlabel
  (drag-förhandsvisning + hörd position). Icke-duplicerad komposition:
  pill = minus-tid, slider-vänster = klocktid.
- **Verifierat live:** P3 HLS → seek 25 % → pill "−3 h 1 min", vänsterlabel
  "07:48" (klocktid). LIVE-etikett-klick → pill "LIVE".

### BUG B — slider-stabilitet + LIVE-avstånd (FIXAD)
- `touch-action: none` på `.dvr-bar` (saknades — Safari gest-konflikt var
  trolig huvudorsak till "fläckig" känsla).
- rAF-throttling av drag-paint (`paintThrottled`) — pointermove flödar på
  iOS snabbare än frames; utan throttling floodas paint.
- Robust drag-slut: `pointercancel` + `pointerleave`-säkerhetsnät (touch) +
  stuck-drag-watchdog (`_srStuckGuard`, force-release efter 3 s utan rörelse,
  cleansas vid render-byte och stopAndClosePlayer) — slidern kan aldrig
  "dö" längre.
- **Användarnotat (LIVE för nära tummen):** `.dvr-bar` har nu
  `padding-right: 14px` (thumben kan aldrig nå LIVE-zonen) +
  `.player-live-label` fick margin/padding (10 px sidopadding).
- **Verifierat live:** drag 50 % → currentTime 5440 = 0,5 × 10880, pill
  "−3 h 1 min", dragging-klass rensad. Computed `touch-action: none` ✅.

### BUG 1 — Inställningar: scroll funkar bara första gången (FIXAD, mekanism etablerad)
**Användarens lead var nyckeln:** "fungerar första gången efter PWA-öppning,
failar sedan varje gång" → touch-specifik, inte logik-specifik. Desktop-Edge
repro (programmatisk scroll) fungerade på ALLA öppningar — felet är i
touch-vägen.

Rotorsaker (etablerade via live-probing):
1. **BEKRÄFTAT:** `enableSwipeToClose` satt på HELA sheeten — vertikala
   touches NÅGONSTANS (inkl. rullningslistan) körde drag-logiken och satte
   `transform` på sheeten under scroll (finger-ned = d>0 = sheet drar). På
   iOS krockar det med native scroll. **Fix:** swipe-ytan är nu scoped till
   `.sheet-grab-zone` (grab-handtag + header-zon, `touch-action: none`);
   list-touches når aldrig swipe-logiken.
2. **BEKRÄFTAT (död kod):** sheetens ✕-knapp skapades men **aldrig appendad**
   — sheeten hade ingen synlig stängknapp (verifierat: `.sheet-close` saknades
   i DOM). Nu appendad i headern.
3. **BEKRÄFTAT (läckage):** `window.addEventListener('resize', syncBubble)`
   ackumulerades vid varje openSheet. Nu tas den bort i closeSheet.
4. **HYPOTES (iOS, otestad här):** body-overflow-växling + transform-under-
   scroll kan lämna iOS touch-scroll i låst läge efter första öppningen.
   Fix 1 täcker den troliga mekanismen (transform sätts inte längre vid
   list-scroll). iPhone-verifiering krävs.

**Verifierat live (Edge):** grab-zon finns, ✕-knapp i headern, scroll funkar
på 1:a och 2:a öppningen (500/600 px), stäng via ✕ och overlay-tap, body-
overflow återställs, inga JS-fel.

### BUG 2 — Nyhetslänkar öppnas inte (FIXAD, rotorsak etablerad)
**Rotorsak (verifierad med browser-perfekta iOS Safari-headers via curl):**
1. Ekot-flödets `<link>` är `/artikel/<id>` — SR:s egen site returnerar **404
   för ALLA id-URL:er** (SR migrerade till slug-URL:ar; flödet uppdaterades
   aldrig). Det är därför länkarna "inte öppnas korrekt" — de öppnar en
   SR 404-sida.
2. Fungerande URL:ar är `/artikel/<slug>` på **www**-host (non-www 403:ar).
3. Slug kan INTE slås upp cross-origin (sverigesradio.se skickar inga
   CORS-headers) — webbläsaren kan inte resa id→slug vid runtime.
4. Slug-gissning från titel matchar bara ~halva artiklarna (SR använder
   redaktionella slugs, t.ex. "Vill bygga stängsel runt Israels ambassad" →
   "stangsel-kring-israels-ambassad-utreds-i-stockholm") — och en fel slug
   404:ar precis som id-URL:en. **Slug-gissning är därför inte via-bar.**

**Fix:** läsarens "Läs hela artikeln"-länk pekar nu ALWAYS på SR:s söksida
för titeln (`www.sverigesradio.se/sok?query=<titel>` — verifierad 200,
artikeln är toppresultat). Aldrig den döda id-URL:en. Trade-off dokumenterad:
ett extra klick för användaren, men länken fungerar alltid.

**Verifierat live:** reader-länk = `sok?query=Miljödata tvingas betala…`,
inte `/artikel/<id>`.

### Deploy
- `npm run build` → dist/ → kopierad till root (GitHub Pages-flödet).
- Ny bundle: `app.4a874f05.js` + `styles.970c8cdb.css`, SW-cache
  `minradio-2a7b0c3b`. Fixarna verifierade i den serverade bundlen
  (grep: paintThrottled/stuckGuard/sheet-grab-zone/sok?query/touch-action).
- Nytt verktyg: `scripts/cdp-eval.mjs` (zero-dep CDP-klient för
  Edge-headless-verifiering — ersätter /tmp/ux-verify.js-mönstret).

### Kvar — **UPPDATERAD 2026-09-23**
- iPhone-verifiering av BUG A/B och BUG 1: BUG A/B fixade + verifierade i
  Edge 2026-09-22; BUG 1 fixad + verifierad. iPhone-känsla återstår enbart
  som del av allmän enhetsvalidering (se AKTIV ARBETSKÖ).
- Android Chrome-validering — fortfarande öppen.
- ~~Fas 4/5 (PLANNED) oförändrat~~ **DONE** — båda implementerade
  2026-09-23 (se ROADMAP-tabellen ovan).

---

## 2026-09-22 — iPhone-feedback på DVR-UX-revisionen (buggar att fixa nästa session)

**Användaren testade nya UX:n på riktig iPhone.** Funktionellt fungerar DVR
(seek + Till Direkt via LIVE-etiketten), men två UX-problem rapporterades:

### BUG A — Pillen ska visa minus-tid, inte klocktid (HIGH, ~~OPEN~~ **CLOSED 2026-09-22**)
- **Observation:** pillen visar klocktid (t.ex. "23:05") men klocktiden står
  redan nere till vänster vid slidern — pillen ska visa **minus-tiden**
  ("−46 min") eftersom det är den information användaren vill se i pillen.
- **FIXAD i fixpasset 2026-09-22** (se "FIXPASS"-posten nedan): pillen
  använder `dvrOffsetLabel()`, verifierat live i Edge 153. iPhone-känsla
  återstår enbart som del av enhetsvalideringen.

### BUG B — Live DVR-slider: tidigare instabilitet (HIGH, ~~OPEN~~ **CLOSED 2026-09-22**; separat från episodens dragbugg)
- **Observation:** slider-känslan är "fläckig" och känns inte stabil/smooth
  på iPhone (touch).
- **FIXAD i fixpasset 2026-09-22**: `touch-action: none` på DVR-baren +
  pointer-robusthet (pointercancel-säkerhet, drag-end-fallback). Verifierat
  live i Edge 153; regressionstester tillagda. Användaren har inte
  återrapporterat instabilitet efter fixen; om känslan åter uppstår på
  iPhone, utgå från hypoteslistan nedan.
- **Möjliga orsaker som utreddes (historik):**
  1. `pointerdown` → `setPointerCapture` kan krocka med Safari's touch-
     scroll/gester; prova `touch-action: none` på `.dvr-bar` (saknas idag —
     CSS har ingen touch-action-regel för DVR-baren).
  2. Seek committas först vid `pointerup` — under draget spelas fortfarande
     gamla positionen; känslan av "instabil" kan vara att fill/thumb hoppar
     tillbaka när `timeupdate`-paint krockar med drag-paint (dragging-guard
     finns men `upd()` kan köras mellan pointerdown och paint).
  3. `pointermove` utan throttling kan flöda paint på iOS.
  4. iOS Safari kan rapportera `pointerId` annorlunda; `releasePointerCapture`
     i try/catch finns men kolla att `pointerup` verkligen firear (annars
     fastnar dragging=true och slidern "dör").
- **Fix-riktning:** lägg `touch-action: none` på `.dvr-bar`, lägg till
  `pointercancel`-säkerhet + drag-end-fallback, överväg rAF-throttling av
  paint, och testa på riktig iPhone efter varje ändring.
- **Regressionsskydd:** 49/49 tester ska fortsätta passera; lägg gärna till
  ett test för touch-action-regeln.

### Nästa session — startpunkt (**HISTORISK — genomförd 2026-09-22**)
Planen nedan exekverades i fixpasset 2026-09-22 (BUG A + B + 1 + 2 fixade,
64/64 tester, live-verifierad i Edge 153). Bevarad som historik.
1. Läs denna post + "Fas 3 implementerad"-posten (nedan) för kontext.
2. Fixa BUG A (pill → minus-tid) — liten ändring i `renderPlayer` mode-pill.
3. Fixa BUG B (slider-stabilitet) — CSS `touch-action: none` + pointer-
   robusthet; validera på riktig iPhone efteråt.
4. Kör `node --test` (49/49), `node build.mjs`, kopiera dist → root, commit,
   push — samma deploy-flöde som tidigare.
5. Deploy-verifiering: riktig Edge via CDP (mönster i /tmp/ux-verify.js) +
   användarens iPhone.

---

## 2026-09-22 — DVR-UX reviderad (användarfeedback från riktig iPhone)

**Användare bekräftade:** DVR fungerar på iPhone (P2, "−46 min", AAC 192) —
men UX:n behövde förbättras: duplicerad "−46 min"-info, slider var bara
klickbar (inte dragbar), LIVE i två ställen + ful "Till Direkt"-knapp.

### Ny design (implementerad)
- **Klocktid i stället för duplicerad offset:** mode-pill visar nu KLOCKTID
  (svensk tid, HH:MM) för positionen man hör — t.ex. "23:05". Seekradens
  vänsterlabel visar samma klocktid (drag-förhandsvisning medan man drar).
  Relativ offset ("−46 min") används bara som fallback om klocktid inte kan
  beräknas. Ingen duplicering: pill = klocktid, seekrad-vänster = klocktid
  (samma information, en gång i pillen + en gång vid slidern där man pekar).
- **Riktig drag-slider:** pointer events (touch + mus) — dra för att
  förhandsvisa (fill + thumb följer fingret, vänsterlabel visar mål-klocktid
  live), släpp för att committa seeket. Ingen seek-storm under draget.
  Thumb-knapp (14 px, accentfärg) som växer vid drag.
- **Klickbar LIVE-etiket ersätter Till Direkt-knappen:** seekradens högersida
  visar "LIVE" — klick → tillbaka till live-kanten. När man redan är live
  dimmas den (grå) men är fortfarande klickbar. Ingen separat knapp, ingen
  duplicerad LIVE-state.
- **Live-läge ser nu rent ut:** pill "LIVE", fill 100 %, thumb vid kanten,
  LIVE-etikett dimmad — inga knappar som skriker.

### Klocktidens sanningskälla
Live-kanten ≈ nu. Position p i fönstret mappas till `now − (seekableEnd − p)`
— korrekt även när fönstret rullar. Formateras med `toLocaleTimeString
('sv-SE')` → svensk tidszon.

### Verifierat live på riktig Edge 153 (app.c7d189bd.js)
- Live: pill "01:12" (klocktid), fill 99,9 %, thumb vid kanten ✅
- Drag 80 % → 30 %: fill/thumb följde (30 %), vänsterlabel visade
  mål-klocktid "23:05" under draget ✅
- Efter släpp: pill "23:05", seek committad, uppspelning fortsatte ✅
- Klick på LIVE-etiketten: fill 100 %, pill "LIVE", etiketten dimmad
  (at-live) ✅
- 49/49 tester passerar ✅

### Kvar — **UPPDATERAD 2026-09-23: verifierad**
- iPhone-verifiering av nya UX:n: genomförd via användarskärmdump
  2026-09-22 (DVR-rad + knappar syns och fungerar).

---

## 2026-09-22 — FIX: DVR-raden dök inte upp på iPhone (render-trigger)

**Användarobservation (riktig iPhone, skärmdump):** P4 Göteborg spelade via
HLS (badge "AAC 192 · buffrar") men ingen DVR-rad syntes.

### Rotorsak (etablerad, inte gissad)
`updateSeekableState()` uppdaterade state men **anropade aldrig
`renderPlayer()`**. DVR-raden byggs en gång per render — och på native HLS
(iPhone Safari) är `seekable` **tom när uppspelningen startar** och växer
först senare. Vid den initiala renderen var `dvrAvailable` false → raden
byggdes aldrig → när seekable senare växte fanns ingen render som visade
den. På desktop Edge i Fas 3-testet syntes raden eftersom testet interagerade
(seek/klick) som triggade renders — därför upptäcktes det inte där.

### Fix (minimal)
`updateSeekableState()` spårar nu `prevDvr`/`prevAtLive` och anropar
`renderPlayer()` **endast när `dvrAvailable` eller `atLiveEdge` flippar** —
inte vid varje timeupdate (DVR-barens egen updater hanterar kontinuerlig
position). Kontraktet "renderPlayer äger presentationen" är nu komplett
även för asynkron seekable-tillväxt.

### Verifiering
- 49/49 tester passerar (oförändrat beteende i övrigt)
- Riktig Edge 153 med ny build (app.f16d1ae6.js): P4 HLS → DVR-rad + Till
  Direkt syns, seekable 181 min, LIVE-pill ✅
- **iPhone är fortfarande ej verifierat** — men flip-mekanismen täcker nu
  exakt det iPhone-scenario som observerades (seekable tom vid start →
  växer senare → render triggas). Användaren ombeds testa igen på iPhone.

---

## ROADMAP — projektstatus och framtida faser (2026-09-22)

**Statusöversikt vid 2026-09-23 (historisk; AKTIV ARBETSKÖ högst upp är
aktuell status):**

| Fas | Status |
|---|---|
| Fas 1 — Foundation (descriptors, CAPS, livscykel-fix) | **COMPLETE** |
| Fas 2A — HLS playback-engine | **COMPLETE** |
| Fas 2B — Validering på riktiga webbläsare | **COMPLETE ENOUGH TO PROCEED** |
| Fas 3 — DVR-UI | **COMPLETE** (se nedan; verifierad på riktig Edge) |
| Fas 4 — Expanderbar/rich player | **COMPLETE** (2026-09-23: redesign + gester + låt/artist/artwork + fallback — se poster nedan; status uppdaterad 2026-09-23) |
| Fas 5 — Context cards: Tablå & podcast-avsnitt | **COMPLETE** (2026-09-23: långtryckskort implementerade; tablåkortet visar igår+idag; status uppdaterad 2026-09-23) |
| Validering på riktig iPhone Safari + Android Chrome | **PARTIAL** (iPhone: DVR/±15 s/gester/kort verifierade; episodmetadata/seek-drag + bakgrund/låsskärm öppna; Android ej validerad) |
| Bug backlog (Inställningar-krasch, nyhetslänkar) | **CLOSED** (båda fixade + verifierade 2026-09-22; status uppdaterad 2026-09-23) |

**Fas 2B-nyckelbevis (bevarat):** riktig Edge 153 (riktig Chromium, CDP-driven
mot deployad GitHub Pages — ej Electron/VS Code-webview): seekable 0 → 10 880 s
(≈181 min / 3,02 h), currentTime ≈ 10 868 vid live-kanten, 5-min-bakåtseek
lyckades med uppspelning aktiv; P1 HLS-192 AAC 192, P2 Musik FLAC först,
P3 HLS-320 AAC 320, P2 (163) HLS-192 AAC 192. Firefox 155: HLS korrekt
filtrerad, MP3 96-fallback, `hlsLoaded: false`, livscykel OK, inga HLS-fel
exponeras. `backBufferLength: 90` / `maxBufferLength: 30` räckte för den
testade bakåtseeken — **ändra inte dessa värden** bara för att SR:s playlist
innehåller ~3 timmar.

**Plattformsstatus (uppdaterad 2026-09-23):** iPhone Safari/PWA har
användarverifiering av DVR/±15 s och centrala gester, men episod-seek-drag,
episodmetadata och ljudets bakgrund/låsskärmslivscykel är fortfarande öppna.
Android Chrome/PWA är ännu inte validerad. HLS/DVR-stöd ska inte kallas
fullständigt plattformsverifierat förrän dessa riktiga enhetsflöden testats.

### Fas 3 — DVR-UI (status: COMPLETE; iPhone delvis verifierad 2026-09-22/23)
Implementerad och verifierad 2026-09-22 (se detaljerad post nedan): mode-pill
med relativ offset, DVR-seekrad mappad till aktuell seekable-range, "Till
Direkt", transportoberoende (läser Phase 2A-state), P2 FLAC aldrig automatiskt
ersatt. iPhone DVR/±15 s/gester har senare verifierats via användartest och
skärmdumpar; Android Chrome återstår. Separata öppna episode-seek- och
metadatafel listas i den aktuella arbetskön.

### Fas 4 — Expanderbar/rich player (status: COMPLETE — implementerad 2026-09-23)
Ursprunglig plan genomförd och därefter redesignad efter användarfeedback.
- Chevron-knapp (ingen one-click-expansion), panel expanderar UPPÅT med
  fingerföljande höjd, fälls via svep ned på grab-zon.
- Visar nu: aktuell låt + artist (live via rightnow; episoder via ondemand-
  tracks), artwork (iTunes), Pågår nu-programnamn som undertitel, fallback
  med kanalomslag när ingen låt spelas.
- Minimera till mini-bar (svep ned), tap återställer.
- Detaljerade poster: "Fas 4 redesign" (natt), "Spelar-gester" (natt 2),
  "Aktuell låt + artist + artwork" (natt 3), "Nyheter-logik korrigerad…"
  (2026-09-23) — alla nedan.

### Fas 5 — Context cards: Tablå & podcast-avsnitt (status: COMPLETE — implementerad 2026-09-23)
Långtryck på kanal/podd öppnar context card. Tablåkortet hämtar IGÅR + IDAG
(fetchScheduleDay, dagdividerare, auto-scroll till pågående program) och
hela raden är klickbar; igårens program spelbara via episodes/get. Poddkort
listar avsnitt (episodes/index page 1+2). Detaljer: poster 2026-09-23 nedan.

**Kanaler — långtryck öppnar Tablå-kort:**
1. Långtryck på en vald kanal öppnar ett kompakt informations/åtgärds-kort
   med relevant programschema (tablå).
2. Kortet visar tillgängliga/relevanta program från schemat.
3. Användaren kan välja ett program direkt från kortet.
4. Valda program spelas när uppspelning är tillgänglig.

Kortet ska tydligt skilja på: pågående/live-program, program som är
uppspelningsbara, och program som inte är uppspelningsbara (om tillämpligt).
Anta INTE att varje program i en tablå är uppspelningsbart — kortet ska
använda faktisk tillgänglighetsinformation från appens datakälla.

**Poddar — långtryck öppnar avsnittskort:**
1. Långtryck på en vald podd öppnar ett kompakt kort med tillgängliga
   avsnitt.
2. Användaren ser avsnitten och kan välja valigt uppspelningsbart avsnitt.
3. Uppspelning startar direkt från kortet.

**UX-intent:** ett snabbt kontextuellt sätt att bläddra i innehåll utan att
lämna huvudkanal/podd-val-upplevelsen.

### Validering på riktig enhet (status: PARTIAL)
- iPhone Safari + installerad PWA: DVR/±15 s, centrala gester, kort,
  knappplacering och zoom har verifierats via användartest/skärmdumpar.
  Kvar: episodmetadata/seek-drag samt bakgrundsljud och låsskärmslivscykel.
- Android Chrome + installerad PWA: hls.js, DVR, bakgrundsljud, låsskärm,
  kanalbyte och fallback är ännu inte validerade.
- DVR-UI:n är transportoberoende (läser seekable-state), men faktisk
  plattformsvalidering krävs innan iPhone/Android-stödet förklaras komplett.

### BUG BACKLOG (status: CLOSED — båda fixade 2026-09-22, status uppdaterad 2026-09-23)

**BUG 1 — Inställningssidan kraschar vid scroll till kanal/podd-val**
- Severity: HIGH · Status: **CLOSED (FIXAD + verifierad)**
- Rotorsak (etablerad i fixpasset 2026-09-22): swipe-to-close var kopplad till
  HELA sheeten — vertikala touchrörelser var som helst (inkl. på
  scroll-listan) körde drag-logiken och satte transform på sheeten under
  scroll, vilket på iOS strider mot native scroll och lämnade sheeten
  oscrollbar. Fix: swipe-ytan avgränsad till grab-hantaget + headern.
- Verifierat live (se BUG 1-posten nedan).

**BUG 2 — Nyhetslänkar (URL) öppnas inte korrekt**
- Severity: HIGH · Status: **CLOSED (FIXAD + verifierad)**
- Rotorsak (etablerad i fixpasset 2026-09-22): flödets /artikel/<id>-URL:er
  är DÖDA (SR 404:ar dem). Fix: slug-härledda länkar / SR-sökning, aldrig
  id-URL. Verifierat live (se BUG 2-posten nedan).

### Rekommenderad arbetsordning (uppdaterad 2026-09-23)
1. **PWA-ljudlivscykel/låsskärm — samla evidens nu:** hämta iPhone-
  diagnostik efter den dokumenterade reproduktionssekvensen. Ändra ingen kod
  förrän loggen skiljer dokument-/session-/iOS-livscykelhypoteserna åt. Detta
  kan göras parallellt med följande isolerade UI-arbete.
2. **Episodens touch-seek:** tydlig användarrapport och avgränsad yta.
  Jämför `.seek-bar` med `.dvr-bar`, implementera drag + synlig thumb/bredare
  hit area utan att fånga scrollgester, verifiera på riktig iPhone.
3. **Episodmetadata-panelens stale UI:** headless production-UI-symptom
  reproducerat 6/6, men faktisk ljud/timeupdate och intern state-vs-repaint-
  rotorsak ej bevisad. Reproducera med fungerande media eller på iPhone;
  skilj track-state från repaint innan ändring.
4. **PWA-ljudlivscykel — rotorsaksfix:** efter granskning av loggen, välj
  minsta korrigering och testa upprepad start/lås/återöppning på iPhone.
  Håll detta separat från episodmetadata.
5. **Enhetsvalidering:** komplettera iPhone-flöden och kör Android Chrome /
  installerad PWA-smoke-test för HLS, DVR, kanalbyte, fallback och bakgrund.
6. **E1 ljudkvalitet:** gör discovery och besluta policy innan någon
  uppspelningsväg byts; testa fallback och stabilitet på riktiga enheter.
7. **E3 nyheter/play-pill:** endpoint-/trafikdiscovery först, därefter
  produktbeslut om spelbara objekt.
8. **E4 info-vy:** omarbeta hjälpinnehållet och placera INFO på startsidan.
9. **E2 Spotify/YouTube:** sist; valfri bekvämlighet och delvis beroende av
  tillförlitlig låtmetadata. Använd Spotify-ID där det finns och var tydlig
  med att textbaserade sökningar inte garanterar exakt matchning.

De två nya spelarproblemen ska hanteras före större ljudförbättringar; samla
samtidigt PWA-diag-data efter den dokumenterade reproduktionen. Håll
diagnostik, implementation och iPhone/Android-verifiering som separata steg;
enhetstest eller headless DOM-test ensamt räcker inte för att markera dessa
problem lösta. BUG 1 och BUG 2 är stängda och ska inte återöppnas utan ny
reproduktion. Denna sektion är den enda aktuella arbetsordningen; numrerade
faser och checklistor i daterade historikposter beskriver status vid den
tidpunkten.

---

## 2026-09-22 — Fas 3 implementerad: DVR-UI (transportoberoende)

### Implementerat
- **Mode-pill visar tidsposition:** `LIVE` vid live-kanten, annars relativ
  offset ("−12 min", "−1 h 5 min") via `dvrOffsetLabel()`. Rounding enligt
  spec: < 60 s bakom = LIVE (användarvänlig "effectively live"-regel),
  minuter nedrundade, timmar + minuter över en timme. Pillen får accent-
  toning när bakom (`.player-mode.behind`) — inte färg-enbart (texten ändras).
- **DVR-seekrad** (`.dvr-row`): visas ENDAST när `cur.dvrAvailable === true`
  och `kind === 'live'`. Mappar seek-baren till den AKTUELLA seekable-
  range:n (`seekableStart`/`seekableEnd`) — aldrig hårdkodad 3 h. Samma
  visuella språk som episode-seekraden; höger sida har "Till Direkt"-
  knappen i stället för duration.
- **"Till Direkt"** (`seekToLive()`): seek till AKTUELLT `seekableEnd`
  (rullande fönster), ingen omstart av ström, inget nytt HLS-session,
  paus/spelar-state bevaras. UI återgår till LIVE när kanten nås.
- **Seek-mappning** (`seekToWindowFraction()`): klick/keyboard (pil-tangenter,
  shift = 10 % steg) → fraktion av aktuell range, clampad säkert, ingen
  NaN/Infinity. Paus/spelar-state orörd — ingen reload, ingen kandidatbyte.
- **Tillgänglighet:** seek-bar `role="slider"` med aria-label
  "Spola i direktinspelningen" + aria-valuenow; "Till Direkt" har aria-label;
  mode-pill `aria-live="polite"`; tangentbord stöds på desktop.

### Arkitekturbeslut
- **Konsumerar Phase 2A-state rakt av** (`dvrAvailable`, `seekableStart/End`,
  `distanceFromLiveEdge`, `atLiveEdge`) — inget nytt DVR-state-model, ingen
  inspectering av HLS/hls.js/URL:er i UI:t. Transportoberoende: samma UI
  fungerar för framtida native-Safari-DVR (läser samma state).
- **Etikett-tröskel vs mekanisk tolerans:** `atLiveEdge`-toleransen är 10 s
  (mekanisk), medan etiketten visar LIVE under 60 s bakom (specens
  "effectively live"-regel). Dokumenterat i koden.
- **P2 FLAC skyddad:** ingen automatisk FLAC→HLS-switch; DVR-raden visas
  bara när den AKTUELLA strömmen har seekable-state.

### Verifierat live på riktig Edge 153 (app.3a8a811f.js)
- P3 HLS: DVR-rad + "Till Direkt" visas, pill "LIVE" ✅
- Seek bakåt via baren (25 %) → pill "−2 h 16 min", currentTime 2723 s,
  uppspelning fortsätter (paus-state orörd) ✅
- "Till Direkt" → currentTime = seekableEnd (10892.8), pill "LIVE",
  `atLiveEdge: true` ✅
- P2 Musik FLAC: **ingen DVR-rad, ingen Till Direkt** — normal spelare ✅
- Rullande fönster: seekableEnd flyttade sig 10880→10892.8 under testet och
  UI följde ✅

### Tester
- 49/49 passerar (34 tidigare + 15 nya DVR-tester): offset-formatering (6),
  seek-mappning (5: aktuell range, 181-min-fönstret, clamp, ogiltiga värden,
  rullande Till Direkt-mål), DVR-gating (4: ingen DVR, bakom live, podd,
  fallback tar bort DVR).

### Begränsningar
- iPhone Safari / Android Chrome: NOT TESTED (ingen enhet) — UI:t är
  transportoberoende och läser samma state, men ej validerat där.
- Bakgrundsljud: NOT TESTED.

---

## 2026-09-22 — Fas 2B: validering på riktiga webbläsare (rapport)

**Genombrott: SR:s ~3-h-DVR-fönster är NU OBSERVERAT i en riktig Chromium-
webbläsare.** Riktig Microsoft Edge 153 (headless, ej Electron/VS Code-webview)
mot deployad GitHub Pages-build:

### Edge 153 (riktig Chromium) — HLS FUNGERAR
- **P3:** HLS via hls.js 1.7.3, badge "AAC 320", spelar ✅
- **P1:** HLS, badge "AAC 192", spelar ✅
- **P2 (163):** HLS, badge "AAC 192", spelar ✅
- **P2 Musik:** **FLAC först** (badge "FLAC") — skyddat ✅
- **SEEKABLE = 0 → 10880 s = 181 min ≈ 3,02 h** — hela SR:s rullande fönster
  exponeras av `audio.seekable` i en MSE-kapabel webbläsare ✅
- **BAKÅTSEEK 5 MIN VERIFIERAD:** seek till liveEdge−300 s → currentTime
  10586→10588 (avancerar), `paused: false` — uppspelning fortsätter från det
  förflutna ✅
- Kanalbyte, svep-stäng → ny kanal: allt OK, livscykel intakt ✅
- Buffring: backBufferLength 90/maxBufferLength 30 räckte — seek 5 min bak
  fungerade utan omkonfiguration (segment hämtas on-demand) ✅

### Firefox 155 (riktig Firefox, via Playwright)
- **HLS filtreras bort som designat:** badge "MP3 96", `hlsLoaded: false` ✅
- Spelar, livscykel OK, inga HLS-fel exponeras ✅
- Seekable-proben: `dvrAvailable: false` (direct har inget fönster) ✅

### Electron/VS Code-webview (SEPARAT från riktiga resultat — som alltid)
- MSE-quirken (mediaSourceRequiresReset) → HLS-fallback till MP3 är den enda
  spelbara vägen där. Bevisar endast fallback-kedjan, inte Chrome-kompatibilitet.

### Acceptansmatris (ögonblicksbild vid Fas 2B-testet; aktuell status står ovan)

| Platform | HLS-metod | HLS-uppspelning | Seekable | Bakåtseek | Bakgrundsljud | Not |
|---|---|---|---|---|---|---|
| iPhone Safari | native | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | ingen enhet tillgänglig |
| Android Chrome | hls.js | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | ingen enhet tillgänglig |
| Chrome desktop | hls.js | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | ej installerad |
| **Edge desktop** | **hls.js** | **JA** | **JA — 181 min** | **JA — 5 min** | NOT TESTED | riktig Edge 153 headless |
| Firefox | fallback | N/A | N/A | N/A | NOT TESTED | MP3-fallback bekräftad |

### Slutsats
- Fas 2A-implementeringen ska förbli oförändrad — inga fel krävde korrigering.
- **Tillräckligt underlag för DVR-UI på Chromium-vägen:** seekable-mekanismen
  är bevisad (181-min fönster + lyckad 5-min-bakåtseek med fortsatt uppspelning).
- Safari/iOS och Android är fortfarande otestade — DVR-UI bör byggas
  transport-oberoende (läser bara seekable-state) och valideras på riktig
  iPhone/Android i nästa steg.

---

## 2026-09-21 — Fas 2A implementerad: HLS playback-engine (utan DVR-UI)

### Implementerat i `public/app.js`
- **Stale-session-skydd:** `hlsSession`-token ökas vid varje playback-ändring;
  HLS-eventhandlers fångar sin token vid attach och ignorerar events från
  ersatta sessioner (P1-HLS som laddar när användaren redan valt P3 får
  inte röra P3:s state eller avancera P3:s kandidater).
- **SR-ladder-mappning:** `SR_HLS_LADDER` + `nominalKbpsFor()` — verifierad
  uppslagning (34000→32, 136000→128, 204000→192, 340000→320), INTE division
  med 1000 (340000 bps = "320 kbps"-rendition pga container-overhead).
  LEVEL_SWITCHED mappar genom tabellen.
- **Seekable-state (engine only):** `updateSeekableState()` läser
  `audio.seekable` vid timeupdate för live-HLS och skriver till
  `state.current`: `dvrAvailable` (tröskel `DVR_MIN_WINDOW_S = 60`),
  `seekableStart/End/Duration`, `currentTime`, `distanceFromLiveEdge`,
  `atLiveEdge` (tolerans 10 s). Debug-probe: `window.__srSeekable()`.
  Ingen DVR-UI — nästa fas bygger den på denna state.
- **Konservativ buffring:** `backBufferLength: 90` (sekunder bakom
  playhead), `maxBufferLength: 30` — INTE 3 timmar. SR:s rullande playlist
  är DVR-sanningskällan; hls.js hämtar äldre segment vid seek.

### Verifierat live (app.f5145488.js, Chromium/Electron-webview)
- hls.js lazy-loadas först när HLS ska spelas (1.7.3) ✅
- HLS startar: badge "AAC 192 · buffrar" syns under laddning ✅
- **Fallback fungerar som designad:** denna webview har den dokumenterade
  MSE-quirken (mediaSourceRequiresReset) → fatal → hlsDetach →
  advanceCandidate → MP3 96 spelar. Badgen följer korrekt.
- Seekable-proben rapporterar korrekt `dvrAvailable: false` på MP3-fallback
  (direct har inget DVR-fönster) ✅
- P2 Musik: **FLAC spelas fortfarande först** (badge "FLAC", LIVE) ✅
- Svep-stäng → ny kanal: spelaren synlig (Fas 1a intakt) ✅

### Tester
- 34/34 passerar (10 favorites + 24 streams). Nya: stale-session-guard (2),
  seekable-state (6: fullt fönster, 10-min-bakåt, under-tröskel, tom,
  null, exakt-tröskel).

### Ej verifierat på riktig hårdvara (ärlig status)
- **Ingen riktig iPhone/Android/desktop-Chrome/Firefox-test har gjorts** —
  endast Electron/VS Code-webview, som uttryckligen INTE är bevis för
  vanlig Chrome. HLS-uppspelning i riktig Chrome och native-HLS i Safari
  är därför **ej bekräftad**; webview-quirken gör att HLS-fallbacken är
  den enda vägen som spelar här.
- Seekable-fönstret (~3 h) är ännu inte observerat i en webbläsare som
  klarar MSE — nästa fas bör börja med den verifieringen.

---

## 2026-09-21 — Fas 1a + Fas 1 implementerade (godkända)

### Fas 1a — Livscykel-fix (buggen "stängd spelare kommer inte tillbaka")
- `renderPlayer()` nollställer nu `$player.style.transform = ''` vid varje
  render — kontraktet "renderPlayer äger ALLT presentations-state" är
  genomfört. Svep-stängning lämnar inte längre spelaren osynlig under
  skärmen.
- **Alla 5 övergångar verifierade live på GitHub Pages** (synlig + på
  skärmen + rätt titel): kanal→✕→kanal ✅, kanal→svep→kanal ✅,
  kanal→svep→podd ✅, podd→svep→kanal ✅, podd→✕→podd ✅.

### Fas 1 — Stream descriptors + CAPS + resolveStreams
- `STREAM_TABLE` (statisk, Phase 1: endast FLAC-posten för P2 Musik 2562),
  `CAPS` (isIOS/isSafari/isFirefox/canPlayAacDirect/canPlayFlac; HLS-flaggor
  definierade men false till fas 2), `resolveStreams(channel)` som ger
  descriptor-objekt `{url, codec, bitrate, transport, dvr, priority}`.
- Kandidatordningen är **identisk** med den gamla `liveCandidates` —
  skyddad av 8 nya enhetstester (`tests/streams.test.mjs`): P2 Musik
  Chromium = FLAC→MP3; Safari = FLAC→AAC320→MP3; P1 = MP3 (Chromium) /
  AAC320→MP3 (Safari).
- `playTrack`/`advanceCandidate` bär descriptor-fält (codec/bitrate/
  transport/dvr) till `state.current` — badgen läser fakta i stället för
  URL-gissning.
- **Två pills** enligt godkänd Bilaga A: `.player-quality` (FLAC / AAC 320 /
  MP3 96 — ärlig bitrate, FLAC utan siffra) + `.player-mode` (LIVE; DVR-
  tillstånd kommer i fas 3). icy-br HEAD bekräftar bitrate för direct-AAC.
- **P2 FLAC skyddat:** verifierat live — P2 Musik spelar FLAC först
  (badge "FLAC", paus/återupptagning OK), ingen nedgradering.
- Tester: 18/18 passerar (10 gamla + 8 nya).

---

## 2026-09-21 — KOMPATIBILITETSMATRIS: strömkvalitet över hela PWA-plattforms-matrisen

**Princip:** "Använd den högsta ljudkvalitet som aktuell plattform/webbläsare
kan spela pålitligt, med behållna fallbacks." Ingen plattform ska gå sönder
för att en annan stödjer mer.

### Nyckelfynd från SR:s HLS (curl-verifierat 2026-09-21)

- **DVR-fönstret är ~3 timmar!** Varianter-playlistor innehåller 1700 segment
  × 6,4 s = 10 880 s ≈ 3,02 h rullande fönster (inga ENDLIST/PLAYLIST-TYPE =
  sliding live). Detta gäller alla kanaler/varianter (p1_128, p2_320, p3_320).
- **Kvalitetsladder per kanal (AAC-LC, mp4a.40.2):**
  - P1 (132): 32 / 128 / 192 kbps
  - P2 (163): 32 / 128 / 192 kbps
  - P3 (164): 32 / 128 / **320 kbps**
  - P4 Göteborg (212): 32 / 128 / 192 kbps
  - P2 Musik (2562): 32 / 128 / **320 kbps**
- **CORS:** ljud1-cdn + ljud2-cdn + roder.sr.se (content steering) alla
  `access-control-allow-origin: *` — hls.js fungerar från GitHub Pages.
- **Dubbla CDN:** LJUD1 (ljud1-cdn) + LJUD2 (ljud2-cdn) via content steering
  (`roder.sr.se/hls/{kanal}?cc=XX`, PATHWAY-PRIORITY LJUD1→LJUD2).
- **Segment:** MPEG-TS (`video/MP2T`), 6,4 s, AAC-LC i TS.

### Browser-tester (Chromium 148/Electron — VS Code-webview)

- **Native HLS i `<audio>`:** `canPlayType` säger "true" men **spelar inte** —
  loadedmetadata@2.3s → error. Chromium ljuger i canPlayType för m3u8.
- **hls.js 1.7.3:** manifest parsas, buffer appendas, **seekable = [0, 10880]**
  — hela 3-h-fönstret exponeras! Seek 10 min bak fungerar (ct=10280 efter seek
  till -600s). I den här Electron-webviewen uppstår `mediaSourceRequiresReset`-
  fel (MSE-lifecycle-quirk i VS Code-webview, ej representativt för riktig
  Chrome) — men pipeline och DVR-seek fungerar ändå delvis.
- **Slutsats:** hls.js-arkitekturen är via-bar för DVR; kräver riktig
  Chrome/Safari-test innan implementering.

### Kompatibilitetsmatris (snapshot 2026-09-21; plattformsstatus uppdaterad i senare poster)

| Kapabilitet | iOS Safari/PWA | iPadOS Safari/PWA | Android Chrome/PWA | Win Chrome | Win Edge | Win Firefox | macOS Safari | macOS Chrome | Linux Chrome | Linux Firefox |
|---|---|---|---|---|---|---|---|---|---|---|
| FLAC (Ogg) decode | ✅ (11.1+) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| FLAC via `<audio>` direkt | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| AAC-LC ADTS via `<audio>` | ✅ nativt | ✅ nativt | ❌ hänger sig | ❌ hänger sig | ❌ hänger sig | ⚠️ varierar | ✅ nativt | ❌ hänger sig | ❌ hänger sig | ⚠️ varierar |
| MP3 via `<audio>` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| HLS nativt (m3u8 i media-el) | ✅ nativt | ✅ nativt | ❌ | ❌ | ❌ | ❌ | ✅ nativt | ❌ | ❌ | ❌ |
| HLS via hls.js (MSE) | ⚠️ iOS 17.1+ ManagedMSE, annars begränsat | ⚠️ samma | ✅ | ✅ | ✅ | ⚠️ FF MSE ok men TS-i-MSE varierar | ⚠️ (native bättre) | ✅ | ✅ | ⚠️ |
| HLS live-uppspelning | ✅ nativt | ✅ nativt | ✅ via hls.js | ✅ via hls.js | ✅ via hls.js | ⚠️ | ✅ nativt | ✅ via hls.js | ✅ via hls.js | ⚠️ |
| HLS live seek/DVR (3 h) | ✅ nativt (seekable) | ✅ nativt | ✅ hls.js (verifierat seekable 0–10880) | ✅ hls.js | ✅ hls.js | ⚠️ | ✅ nativt | ✅ hls.js | ✅ hls.js | ⚠️ |
| ~3 h rewind | ✅ (nativt DVR) | ✅ | ✅ (hls.js + backBufferLength) | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ |
| MSE-stöd | ❌ (ingen MSE i Safari för audio-only; ManagedMSE iOS 17.1+ video) | ❌/⚠️ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| hls.js viabilitet | ⚠️ (native HLS bättre) | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ✅ | ⚠️ |
| Bakgrundsljud (PWA) | ✅ (media session) | ✅ | ✅ (media session + foreground service) | ✅ (flik aktiv) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Låsskärmskontroller | ✅ MediaSession API | ✅ | ✅ | ✅ (OS-beroende) | ✅ | ⚠️ | ✅ | ✅ | ⚠️ (DE-beroende) | ⚠️ |
| Installerad PWA + ljud | ✅ hemskärms-PWA spelar i bakgrund | ✅ | ✅ (WebAPK) | ✅ | ✅ | ⚠️ (FF ej full PWA) | ✅ | ✅ | ✅ | ⚠️ |

**Viktiga distinktioner (per krav):**
1. "Kan avkoda codec" ≠ "kan spela SR:s ström": Chromium kan "avkoda AAC" men
   SR:s rå-ADTS-ström hänger sig tyst (verifierat 3 ggr). Safari spelar ADTS.
2. "Spela ström" ≠ "via arkitektur": Chromium spelar inte HLS nativt trots
   canPlayType=true; via hls.js/MSE fungerar det (med DVR!).
3. "PWA-beteende vid installering/bakgrund": iOS PWA spelar ljud i bakgrund
   med MediaSession; Android WebAPK likaså; desktop = flik-musik.

### Rekommenderad arkitektur (progressiv förstärkning, hela matrisen)

1. **iOS/iPadOS Safari (primärt mål):** native HLS i `<audio>` — Safari spelar
   m3u8 nativt inkl. DVR-seek (seekable exponeras). Bästa kvalitet: HLS 320
   (P3/P2 Musik) resp 192 (P1/P2/P4). Ingen hls.js behövs. AAC-ADTS direkt
   fungerar också men HLS ger DVR + adaptivt.
2. **Android Chrome + desktop Chromium (Chrome/Edge):** hls.js + MSE.
   Kvalitet: samma HLS-ladder, adaptiv eller låst till högsta. DVR via
   seekable. hls.js ~100 KB gz, lazy-loadas bara när spelaren används.
3. **Firefox (Win/Linux):** MSE finns men TS-i-MSE är opålitligt → behåll
   MP3-96 som fallback (nuvarande beteende). Test krävs; hls.js kan funka.
4. **P2 Musik FLAC:** behåll som kandidat 1 på alla plattformar (Ogg-FLAC
   spelar överallt enligt matrisen) — men HLS 320 är nu ett dokumenterat,
   stabilt alternativ med DVR som FLAC saknar.
5. **Fallback-kedjan (nuvarande resolver) är fortfarande ryggraden:** varje
   plattform faller automatiskt till nästa kandidat som fungerar.

### 3-timmars rewind — plattformsoberoende bedömning

- **Kan implementeras konsekvent på:** iOS/iPadOS (native HLS), Android
  Chrome, Windows/macOS/Linux Chrome+Edge (hls.js). Det är majoriteten av
  matrisen.
- **Ej garanterat:** Firefox (TS-i-MSE opålitligt), äldre iOS (<17.1 har
  begränsad MSE men native HLS täcker DVR ändå).
- **Bästa korsplattforms-arkitektur:** HLS överallt där det fungerar (native
  på Safari, hls.js på Chromium-baserade), MP3-fallback på Firefox tills
  testat. DVR-UI (spola bakåt i direkt) aktiveras bara när
  `audio.seekable` visar ett fönster > 0.

### Kvar att testa på riktig hårdvara — **ögonblicksbild 2026-09-23, se senare evidens ovan/nedan**
- iPhone: native HLS + DVR-seek **DONE** (användarskärdump 2026-09-22);
  bakgrund/PWA-ljudlivscykel **OPEN** (diagnostik deployad).
- Android: hls.js + DVR + bakgrund — **OPEN**.
- Firefox desktop: TS-i-MSE — **OPEN** (låg prioritet; MP3-fallback fungerar).
- (Electron-webviewen här är inte representativ; dess MSE-quirk dokumenterad
  ovan men påverkar bara VS Code-förhandsvisning)

---

## 2026-09-21 — Öppna punkter: genomförda (buffring, spelare, sheet, ikonfråga)

### 1. Buffringsindikator (implementerat)
- Badgen i spelaren visar "MP3 · buffrar" (pulsande animation) medan ljudet
  laddar eller re-buffrar (`waiting`/`stalled`), och återgår till vanligt
  format ("MP3") när ljudet flyter (`playing`). Noll extra plats — samma pill.
- `prefers-reduced-motion` respekterad (ingen puls).
- Verifierat live: "MP3 · buffrar" under laddning → "MP3" vid uppspelning.

### 2. Spelaren: svep-ned-stäng + tydligare kryss (implementerat)
- Svep nedåt på spelaren stoppar ljudet och stänger den (samma mönster som
  Inställningar-sheeten, via `enableSwipeToClose` axis 'y'). Verifierat live.
- Stäng-krysset är nu en SVG-ikon (skarp vid alla skalor) i stället för
  text-tecknet ✕.

### 3. Inställningar-sheeten: scroll bleed-through (fixat)
- `overscroll-behavior: contain` på `.sheet` + `body.overflow=hidden` när
  sheeten öppnas, återställt vid stängning (även via Spara och svep).
- Verifierat live: sheet scrollar internt, sidan bakom står still, overflow
  återställs efter stängning.

### 4. P2 Musik-ikon (utrett — ingen distinkt ikon finns)
- SR:s API har separata bildfiler för P2 (163: `684f7bac…`) och P2 Musik
  (2562: `19ccfced…`), men **båda visar samma orangea "P2"-logo** — SR använder
  samma design för båda kanalerna. Ingen "P2 Musik"-specifik logo finns i
  API, CDN eller på sverigesradio.se (kanaler-sidan visar programbilder, inte
  kanallogotyper; logotyp-sidan på om.sr.se 404:ar).
- Appen visar alltså SR:s officiella ikoner korrekt. Om man vill skilja dem
  åt visuellt krävs en egen påhittad ikon — inte gjort (behåller SR:s look).

---

## 2026-09-21 — VIKTIGT: FLAC-mappningen var fel kanal (korrigerat)

- **Fynd:** `edge1.sr.se/p2-flac` tillhör **P2 Musik (id 2562)**, inte P2
  (id 163). Bevis: SR:s egna HLS-manifest — `163.hls` listar endast
  `p2sm/*`-varianter, `2562.hls` listar endast `p2/*`-varianter. Edge-slug-
  familjen "p2" = P2 Musik. Ingen `p2sm-flac` finns (edge1/ljud1/ljud2: 404).
- **Konsekvens innan fixen:** när man tryckte på P2 (163) spelades P2 Musiks
  FLAC-ström — fel kanalinnehåll utanför simucast-tider (t.ex. 06:00–12:30 när
  P2 sänder finska/samiska program men P2 Musik sänder klassiskt).
- **Fix:** FLAC-kandidaten flyttad till 2562. Nu: P2 Musik → FLAC först på
  alla enheter; P2 (163) → AAC-320 på iOS, MP3 annars (ingen FLAC finns).
- Verifierat live: P2 (163) → badge MP3; P2 Musik (2562) → badge FLAC, spelar.
- **Lärdom:** testa kanalidentitet, inte bara URL-levnad. Simucast-fönster
  (t.ex. "Konsert i P2" 20–22) kan dölja fel kanalmappning helt.

## 2026-09-21 — iPhone-frågor (svar)

- **Badges pålitliga?** Ja efter FLAC-fixen ovan. Badgen visar den URL som
  faktiskt spelas (`cur.audioUrl`), och fallback uppdaterar den automatiskt.
  AAC-badgen på iPhone = AAC-320 via officiell mall (icy-br 312 verifierat).
- **~2 s fördröjning innan ljud på iPhone:** det är buffring, inte inbyggd
  fördröjning. Kedjan är: API-hämtning av kanaler → tryck → `<audio>` laddar
  via 2 redirects (topsy→live1→edge) → Safari buffrar ~1–2 s innan `playing`.
  MP3-96 startar snabbare än FLAC (större bitrate = mer buffring). Kan
  förbättras med HLS (6 s-segment, snabbare first-play) senare.

---

## 2026-09-21 — Strömresolver med automatisk fallback (historisk första version; kanalordning korrigerad senare)

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

## 2026-09-21 — Öppna punkter (att ta itu med nästa session) — **HISTORISK: alla tre genomförda samma dag**

### 1. Inställningar-vyn: scrollning är inte smidig — **FIXAD (samma dag, se "Öppna punkter: genomförda" nedan)**
- **Problem:** när man scrollar ned i Inställningar-vyn (bottom sheet) rör sig hemskärmen bakom med — bakgrundssidan följer med i scrollen ("scroll bleed-through").
- **Orsak (trolig):** `overscroll-behavior` är inte satt på `.sheet` (endast på `.news-scroller` och `.icon-scroller`). Touch-scroll i sheeten "läcker" till body.
- **Förslag på fix:** lägg `overscroll-behavior: contain;` på `.sheet` och se till att `body`-scroll låses ordentligt när sheeten är öppen (idag sätts `document.body.style.overflow = 'hidden'` — kontrollera att det gäller hela tiden, även efter swipe-to-close).

### 2. Minispelaren: saknar svepfunktion och stäng-kryss — **ÖVERGRIVEN 2026-09-23: spelaren har nu full gestmotor (svep upp = expand, svep ned = minimera till mini-bar med stäng-kryss). Se Fas 4-redesign-posterna. Historik nedan.**
- **Problem:** spelaren i nederkanten har varken svepgester eller stäng-kryss.
- **Önskat:**
  - Svep nedåt (eller åt sidan) på spelaren ska stänga/stoppa uppspelning — samma mönster som Inställningar/Info.
  - Ett tydligt stäng-kryss (✕) i spelaren som stoppar ljudet och stänger.
- **Not:** spelaren har redan en liten ✕-knapp (`player-btn-close`) men den är diskret; gör den tydligare och lägg till svepstöd via `enableSwipeToClose` (finns redan som hjälpfunktion i app.js, stödjer axis 'x' och 'y').

### 3. Ljud/stream-diagnostik — genomförd, se rapport nedan
Diagnostik genomförd 2026-09-21 enligt checklistan. Resultat: se avsnittet "Ljud-diagnostik 2026-09-21" längst ned.

---

## Ljud-diagnostik 2026-09-21 (historisk arkitektursnapshot — senare arbete ersatte flera slutsatser)

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

### Missing functionality (prioriterat) — **STATUS UPPDATERAD 2026-09-23** (se markering per rad; detaljer i AKTIV ARBETSKÖ)
1. ~~Retry/återanslutning för direktströmmar~~ **DONE** — advanceCandidate + 6 s watchdog (Fas 1/2).
2. ~~Stall/buffering-detektering + UI-indikering~~ **DONE** — buffrings-badge (waiting/stalled).
3. ~~`canPlayType`-check innan källval~~ **DONE** — CAPS-modulen (Fas 1).
4. Kvalitetsval — **OPEN → E1 "Högsta möjliga ljudkvalitet" i AKTIV ARBETSKÖ** (ondemand M4A-varianter 32/96/192 upptäckta 2026-09-23).
5. ~~HLS-stöd~~ **DONE** — Fas 2A (hls.js lazy-load + native HLS).
6. Nätverksmedvetenhet — **OPEN → del av E1-utredningen** (antag inte adaptiv kvalitet utan stöd i utredningen).

### Recommended next investigation steps (HISTORIK — ersatta av HLS- och fallback-arbetet)
1. Kartlägga SR:s ljud-URL-mallar för kvalitetsvarianter (96/192 MP3, AAC) — finns i SR:s dokumentation under "ljud".
2. Testa beteende vid nätverksbortfall på riktig telefon (flygplansläge mitt i P1) — dokumentera exakt vad som händer.
3. Utvärdera `audio.addEventListener(['waiting','stalled','suspend'])` som bas för stall-detektering.
4. Besluta om HLS är värt hls.js-beroendet (troligen nej för personlig app).

---

## Genomförda förbättringar (historik, kort)

- 2026-09-21: Ikonrader med kontinuerlig rullning (exakt 4 syns, stopp vid sista ikonen); Valda favoriter + drag-and-drop-sortering i Inställningar; fler än 4 val möjliga (cap 16); svep nedåt stänger Inställningar; svep åt sidan stänger läsare/Info; Info/Spara 50/50; kugghjul; reglage med värde i bollen.
- 2026-09-20: Statisk arkitektur (GitHub Pages), nyhetsläsare i appen, rullbar nyhetslista med inställbart antal, poddsökning klientsidigt, PWA-ikoner, service worker.

## Låsskärm-fixar (2026-09-22; första implementationen, senare fälttest visade att fel-PWA-problemet kvarstår)

**1. Fel PWA öppnades från låsskärmsspelaren.** Utan `navigator.mediaSession`-
metadata kunde iOS binda now-playing-sessionen till fel installerad PWA (tryck
på låsskärmsspelaren öppnade en annan PWA; att stänga den dödade Min Radio:s
ljud). Fix: explicit MediaSession-metadata (title/artist/album/artwork) +
action handlers (play/pause/stop/seekbackward/seekforward), uppkopplad i
`playTrack`, `stopAndClosePlayer` och play/pause-händelser. Bonus: riktiga
kontroller på låsskrmen istället för generiska ±10 s.

**2. Vita hörn på ikonen (iOS 27 låsskärm).** `apple-touch-icon.png` var
renderad med rundade hörn + transparent utanför — iOS maskar själv och
renderade transparensen vitt. Fix: ny `square: true`-option i
`generate-icons.mjs`; apple-touch-icon nu full-bleed (hörnpixel verifierad
opak teal [0,80,78,255] både lokalt och LIVE).

**Fällgrupp upptäckt:** `icons/` i roten är deploy-kopian; generatorn skriver
till `public/icons/`. Glömd kopiering → live-ikonen förblev gammal trots
"lyckad" build. Nu verifierad byte-for-byte via md5 mot live-URL.

**Verifierat live vid implementationen:** bundle `app.21251be8.js`, SW
`minradio-2265a6ae`, ikon-md5 `c79ae883…` på GitHub Pages. MediaSession-
metadata sätts vid uppspelning. Senare iPhone-test (2026-09-23) rapporterade
oförändrat fel-PWA-beteende efter både livscykelfix och diagnostik; den öppna
rotorsaksutredningen i AKTIV ARBETSKÖ är den aktuella statusen.

## 2026-09-23 — TABLÅ FIXAD: scheduledepisodes (upptäckt via srtableau.se)

**Genombrott:** användaren pekade på servicenoden.se/srtableau — en fungerande
tablå-app från forumtråden. Genom att fånga dess nätverkstrafik i webbläsaren
fanns svaret direkt: **den använder `scheduledepisodes`, inte
`scheduledevents`.**

### Rotorsak till "SR:s tablå-API är nere"
- `scheduledevents` är död (500 permanent — del av API-avvecklingen).
- **`scheduledepisodes` lever och svarar 200** — verifierat för idag, imorgon
  OCH igår (61–97 poster per kanal). Samma svarsform (`schedule[]` med
  `starttimeutc`/`endtimeutc`) PLUS rikare metadata:
  - `program: {id, name}` — programidentitet (grund för Fas 5-kort)
  - `episodeid` — 41/61 poster för P3 har spelbara avsnitt
  - `description`, `imageurl`
- Uppspelning av tablåposter (srtableaus mönster): `episodes/get?id=<episodeid>`
  → `listenpodfile.url` (verifierat: Talkshow i P1, 3293 s, podradio-CDN).

### Fix (implementerad, deployad)
- `fetchSchedule()` bytt till `scheduledepisodes?channelid=X&date=Y&format=json
  &pagination=false`.
- Schema-poster berikade med `programId`, `programName`, `episodeId`.
- **Programhopp-knapparna aktiveras nu automatiskt** (graceful degradation
  redan på plats — schemat löser sig nu).
- Test uppdaterad: endpoint + död-endpoint-förbud + pagination-param.
  82/82 tester.

### Verifierat
- LIVE-bundle `app.7f963167.js` serverar scheduledepisodes (grep mot serverad
  JS), döda endpointen borta.
- API-svar verifierat i appkontext: 61 poster, 41 med episodeId,
  programgränser korrekta (prev/next vid 06:00 = Morgonpasset i P3).
- DVR-rad kunde ej verifieras härifrån (HLS geo-blockat från detta nät —
  MP3-fallback utan DVR-rad, som designat). iPhone med svenskt nät bör nu se
  programhopp-knapparna.

### Fas 5-implication (context cards)
scheduledepisodes ger allt som behövs för långtryckskort: programnamn, tid,
episodeId → episodes/get → listenpodfile (spelbar URL + duration). Ingen
proxy behövs. Tablå-kortet kan byggas på denna endpoint.

## 2026-09-23 — Fas 4 + Fas 5 IMPLEMENTERADE + UX-fixar (deployade)

### 1. DVR-knappar omplacerade (användarens ursprungliga önskan — nu gjord)
- **±15 s + programhopp flankerar nu play/paus** i huvudkontrollraden:
  [prevProgram] [back15] [PLAY] [fwd15] [nextProgram]. Logisk placering —
  transportknapparna är där tummen redan är.
- **LIVE-knappen borttagen** från DVR-radens högersida (användaren: "det är
  nog med pill och slide till höger"). Ersättare: tap på barens högra 12 %
  → tillbaka till live (samma gestyta, ingen extra knapp att träffa fel).
  Pillen visar LIVE/−tid som förut.
- DVR-radens layout nu: [klocktid] [slider] — rent och luftigt.
- Död CSS (.player-live-label) borttagen.

### 2. Zoom-fix (dubbelklick zoomade oönskat)
- `touch-action: manipulation` globalt (tillåter pan + pinch, blockerar
  double-tap-zoom) + `maximum-scale=1` i viewport-metan.
- Pinch-zoom (två fingrar) fungerar fortfarande — endast oönskad
  dubbelklicks-zoom är avstängd.

### 3. Fas 4 — Expanderad spelare (KLAR)
- Tap på spelarens meta-yta (titel/undertitel) växlar ett infopanel:
  omslagsbild, programnamn, beskrivning (4 rader clamp), längd.
- Kompakt spelare förblir standard; panelen är ett tilläggslager.
- Data: kanaler får tagline som description; poddar får programbeskrivning
  (redan i katalogen); nyheter har programName sedan tidigare.
- Keyboard-stöd (Enter/space) + aria.

### 4. Fas 5 — Context cards via långtryck (KLAR)
- **Långtryck (500 ms) på kanalikon → Tablå-kort:** dagens schema via
  scheduledepisodes (den levande endpointen). Pågående program markerat ●,
  spelbara poster (med episodeId) ▶ → episodes/get → listenpodfile →
  spelas direkt. Framtida poster ⏳, ej spelbara dimmade.
- **Långtryck på poddikon → Avsnittskort:** episodes/index (page 1+2 —
  SR-quirk: page 1 tom för vissa program), tid + titel + längd, tap spelar.
- Desktop-paritet: högerklick öppnar kortet.
- Korten återanvänder sheet-visualspråket (grab-zon, swipe-ned stänger,
  ✕, overlay-tap, Esc).

### 5. KRITISK bugg fixad under vägen: el() + disabled
- `el('button', {disabled: false})` → `setAttribute('disabled', false)` →
  knappen BLEV disabled (attributets existens disable:ar, värdet spelar
  ingen roll). Alla card-rader med ljud var klickade-av. Fix: boolean false
  skippas i el(). Upptäckt via live-verifiering (81/93 rader spelbara efter
  fix, 0 före).

### 6. Ikonregressionen — rotorsak på build-nivå
- build.mjs regenererade ikoner till dist/ med `renderIcon(180)` UTAN
  square-option → skrev över den fixade ikonen vid VARJE build. Det är
  därför vita hörn kom tillbaka live trots tidigare fix. Nu: build.mjs
  använder `renderIcon(180, { square: true })` — permanent fix.
- **PWA-låsskärmbuggen (fel PWA öppnas)** kvarstår enligt användaren —
  MediaSession-metadata är deployad i bundlen; iOS kan behöva PWA-
  ominstallation. Noterad som öppen.

### Verifierat live (GitHub Pages, bundle app.94281c6d.js)
- Kanalkort P1: 93 rader, 81 spelbara, pågående markerad ✅
- Poddkort: 10 avsnitt, alla spelbara, tid + längd ✅
- 83/83 tester. SW minradio-a0461639.

### Kvar — **UPPDATERAD 2026-09-23**
- ~~iPhone-verifiering: knappplacering, zoom, långtryckskort, expanderad
  spelare~~ **DONE** — verifierade via användarskärmdumpar 2026-09-23.
- Låsskärm (fel-PWA-buggen) — **OPEN**, diagnostik deployad (se
  AKTIV ARBETSKÖ).
- Android Chrome-validering — **OPEN**.

## 2026-09-23 (natt) — Fas 4 redesign + iOS långtrycks-fix + 2 kritiska buggar

### 1. iOS långtryck kapades av systemmenyn (FIXAD)
Användaren: långtryck på podd-ikon fungerade EN gång, sedan visade iOS
"Spara i Bilder/Copy"-menyn på alla ikoner. Orsak: iOS visar native
touch-callout för bilder vid långtryck om inte callouten är avstängd.
Fix: `-webkit-touch-callout: none` + `user-select: none` + `-webkit-user-drag:
none` på `.stream-icon`, och `pointer-events: none` på `.stream-icon img`
(knappen äger gesten, inte bilden).

### 2. Expanderad spelare — HELT om designad (användarens feedback)
- **Ingen one-click längre** (oavsiktliga tapar öppnade den). Ny: dedikerad
  chevron-knapp i spelarheadern (bredvid ✕).
- **Panelen expanderar UPPÅT** ovanför spelaren — nederdelen (kontroller +
  seekrad) står STILLA. Panelen är spelarens första child.
- **Fälls genom svep ned** på grab-zonen i panelens topp (eller chevron igen).
  Grab-zon äger gesten — scrollbart innehåll nedanför påverkas inte (BUG 1-
  lärdom: aldrig swipe-logik på scrollbar yta).
- **LIVE-metadata:** "Pågår nu" + "Nästa" med titel, programnamn, tidsinter-
  vall, bild och beskrivning från scheduledepisodes. Verifierat live:
  P3 01:02 → "Vaken (Vaken med P3 & P4) 01:02–02:00" + "Nästa: Ekot senaste
  nytt 02:00–02:02", båda med bilder + beskrivningar.
- **Dåvarande slutsats, senare motbevisad samma natt:** den utredningen fann
  inga nåbara låttitlar eftersom den testade `channels/{id}/rightnow` (500),
  HLS-playlistorna saknade EXT-X-DATERANGE-metadata och sverigesradio.se:s
  SSR-sida var CORS-blockerad. Del 2 nedan fann `playlists/rightnow`, som
  returnerar live artist/titel med CORS från GitHub Pages. Behåll detta som
  historik över en ofullständig endpoint-utredning, inte som nuvarande
  arkitekturbeslut.

### 3. Kritisk bugg A: duplicerad const nextEv (FIXAD)
SyntaxError "Identifier 'nextEv' has already been declared" kraschade HELA
appen vid load (vit skärm). Hittad via pageerror vid live-verifiering.

### 4. Kritisk bugg B: UTC vs lokal datum i fetchSchedule (FIXAD)
fetchSchedule använde toISOString() (UTC-datum) men SR:s date-param är LOKAL
dag. Efter lokal midnatt men före UTC-midnatt (t.ex. 01:02 svensk tid)
hämtades GÅRDAGENS schema → "Ingen programinfo" i expanderpanelen och inga
programhopp-knappar. Fix: toLocaleDateString('sv-SE'). Hittad live 01:02.

### Verifierat live (bundle app.e918fec1.js)
- Ikoner: callout av, img pointer-events none ✅
- Expand-knapp + panel uppåt + grab-zon ✅
- Pågår nu/Nästa med bilder, tider, beskrivningar ✅
- 83/83 tester.

### Kvar (iPhone) — **UPPDATERAD 2026-09-23**
- ~~Långtryck på ikoner → kort (iOS-menyn ska vara borta)~~ **DONE** —
  iOS-callout-fixen (natt) + korten verifierade via användarskärmdump.
- ~~Chevron-expansion uppåt + svep-ned-fällning~~ **DONE** — Fas 4-redesign
  (natt) + gester (natt 2), verifierade live.
- Låsskärm: fel-PWA-buggen — **OPEN** (diagnostik deployad; se
  PWA-ljudlivscykel i AKTIV ARBETSKÖ).

## 2026-09-23 (natt 2) — Spelar-gester: fingerföljande expand/minimize (deployad)

### Användarens krav
1. "solid way of marking the finger on the player and swiping upwards for
   expansion and then down to close" — fingerföljande gester, inte knappar.
2. "background page never swipes with it — feels flaky when everything moves".
3. "remove close player and stream when swiping down — instead minimise the
   player so news and mainpage becomes visible while still playing".

### Implementerat (bundle app.53c9d8c5.js)
- **Svep UPP på spelaren** → expanderpanelen växer med fingret (0 → 40 dvh),
  committar vid 22 % av skärmen (eller flick), fjädrar tillbaka om för kort.
- **Svep NED på spelaren** → MINIMERA till mini-bar: artwork, titel, play/
  paus, expand-knapp, stopp. **Ljudet fortsätter**, sidan bakom blir synlig
  och rullbar. Tap på mini-baren (utom knappar) återställer full spelare.
  ✕-knappen är nu ENDA sättet att stänga (medvetet — inga olyckor).
- **Bakgrundssidan rör sig ALDRIG:** `.player { touch-action: none }` +
  `e.preventDefault()` på vertikala drag + `body.player-gesture-lock`
  (overflow:hidden) under pågående gest. Tre lager skydd.
- Gest-disambiguering: horisontella drag på DVR-baren påverkas inte (baren
  har egen touch-action:none och stoppar propagation via sin yta).
- Chevron-knappen finns kvar som alternativ (tillgänglighet/desktop).

### Verifierat live (simulerade touch-gester mot GitHub Pages)
- Svep ned → minimized=true, mini-bar syns, ljudet spelar ✅
- Tap på mini-bar → restored ✅
- Svep upp → panel öppen, "Vaken" + "Nästa Ekot senaste nytt" ✅
- Svep ned på expanderad panel → minimerar (gesten ägs av spelaren) ✅
- 83/83 tester.

### Låttitlar — slututredning (användaren bad om fördjupning)
SR:s webbplayer visar "♪ Artist – Låt" och datan FINNS: sidan
sverigesradio.se/kanaler/latlista/p3 är server-renderad med hela låtlistan
(title/artist/composer, uppdateras live). MEN: sverigesradio.se skickar INGA
CORS-headers (verifierat med Origin-header — servern ignorerar den), så PWA:n
kan inte läsa svaret. SR:s egen spelare är same-origin och därför funkar det
för dem. Alla api.sr.se-varianter (songs/playlist/music/latlista) är 500.
**Dåvarande slutsats, motbevisad senare samma natt:** låttitlar skulle kräva
en proxy. Del 2 nedan fann `playlists/rightnow`, som ger live artist/titel
med CORS från GitHub Pages. Behåll detta stycke som historik över en
ofullständig endpoint-utredning, inte som nuvarande arkitekturbeslut.

## 2026-09-23 (natt 3) — Aktuell låt + artist + artwork (Del 1–5 genomförda)

### Del 1 — Discovery-regeln (BESTÅENDE)
Sparad i `/memories/repo/discovery-rule.md` (repo-minne, läses i alla framtida
sessioner i detta workspace) + referensrad överst i `/memories/repo/sr-pwa-app.md`.
Innebörd: "Reverse-engineer the data model and API surface before
implementation" — ett misslyckat endpoint-försök bevisar BARA att den
endpointen misslyckades; kartlägg datamodellen, alternativa resource-namn,
tjänstens egna klienter och nätverkstrafik; klassa fel (saknas/fel/ingen-CORS/
browser-OK/production-origin-OK); "proxy krävs" först EFTER verifiering från
riktig GitHub Pages-origin. Metodregel, inte SR-specifik.

### Del 2 — Aktuell låt + artist (implementerat, deployat)
- Endpoint: `playlists/rightnow?channelid=X&format=json` (verifierad 200 +
  CORS `*` från GitHub Pages-origin).
- Pollning: 45 s intervall, EXAKT EN loop, seq-guard mot stale responses.
- `song === null` = normalt tillstånd (tal/program) → linjen döljs helt,
  expanderpanelen visar "Ingen låtinformation — kanalen sänder program".
- UI: "♪ Artist – Låt"-linje i spelarens meta-yta + mini-bar (accentfärg,
  ellipsis, aria-live polite).
- Kanalbyte: startNowPlayingPoll avbryter pending timer + pollar NY kanal
  direkt (bugg hittad i Del 5-verifiering: gamla koden väntade upp till en
  hel intervall eller dog på seq-guard utan återarmering).
- Isolering: metadata-loopens fel kan ALDRIG påverka ljudet — fetch-fel =
  sista kända låten behålls; stopp/kanalbyte städar loopen.

### Del 3 — Artwork (implementerat enligt beslutsregeln)
Utredning: rightnow har INGA bildfält (även inte med largedata=true). SR:s
egna artwork (Spotify CDN-URL:er) finns bara på CORS-blockerade latlista-
sidan. FÖLJ DISCOVERY-REGELN → hittade **iTunes Search API**
(`itunes.apple.com/search`, CORS `*`, artworkUrl100 skalbar till 600x600 via
URL-rewrite). Verifierat från GitHub Pages-origin: search 200 + <img>-laddning
600x597 OK (<img> kräver ingen CORS).
**Beslut: artwork STABIL nog → implementerad.**
- Expanderad spelare visar nu: [artwork] Spelas just nu / Låttitel / Artist.
- **Pågår nu + Nästa-program BORTTAGNA** från expanderpanelen (finns redan i
  Tablå-kortet via långtryck på kanalikon — ingen duplicering).
- song:null → ♪-placeholder + "Ingen låtinformation — kanalen sänder program".
- Artwork-cache per artist|title (session), stale-guard, misslyckad bild =
  placeholder, aldrig påverkan på ljudet.
- Känd begränsning: klassisk musik (långa artiststrängar) matchar oftast inte
  i iTunes → placeholder. Pop/musik = bra träfffrekvens.

### Del 5 — Verifiering (från riktig GitHub Pages-origin)
- P3 med musik: "♪ The Rolling Stones – Tumbling Dice" syns i spelaren ✅
- P2 Musik: "♪ Leonidas Kavakos… – Violin Concerto no 2" ✅
- P1 (tal): song=null → linje dold, expanderpanel visar placeholder ✅
- Kanalbyte: metadata följer (efter poll-fixen) ✅
- Ljuduppspelning påverkas inte av metadata/artwork-fel ✅
- Requests går direkt browser→api.sr.se (resource-timing verifierad, ingen
  proxy) ✅
- 83/83 tester.

### Fix — Låt-blink vid kanalbyte + programtitel (2026-09-23, commit ae84397)
**Användarrapport:** "Beyoncé visades i 10:dels sekund, försvann, kom tillbaka
efter ca 30 sekunder" vid P2→P3-byte. Dessutom: "P3 Direkt" skulle ersättas
med Pågår nu-programmets namn.
- Första fixen (12de6fa, renderPlayer före startNowPlayingPoll) räckte inte —
  verifiering visade linjen fortfarande försvann (synlig @1s, borta @3s).
- **Rotorsak 2 hittad:** renderPlayer() körs om av playback-events ('playing',
  buffering-badge) EFTER att pollen paintat linjen. Varje rebuild börjar med
  tom DOM ($player.textContent = '') → linjen + undertiteln nollställs till
  nästa 45s-poll. MutationObserver bevisade mekanismen (0 renders @4s = linjen
  tomdes av event-driven re-render, inte av ny poll).
- **Fix:** paintNowPlaying() + paintProgramTitle() körs i slutet av BÅDA
  renderPlayer-grenarna (full spelare + mini-bar), och undertitelelementet
  seedas från cur._srProgramTitle vid bygg tid. Varje re-render är nu
  self-healing — metadata kan aldrig längre "vippas bort" av en re-render.
- **Verifierat live (GitHub Pages, ny bundle app.4eb4f888.js):** P2→P3-byte,
  linje samplad @200ms/1s/3s/6s — STABIL ("♪ Funky Loffe & Sofie Norling –
  Ching Ching Hej Hej" genomgående). Undertitel: "Direkt" @200ms → "Vaken"
  @1s (fetchSchedule löser) och STAY. P2 visade "Notturno" ✅.
- 83/83 tester.

### Tablå-kortet: igår + idag + hela raden klickbar (2026-09-23, commit 4ec597d, bundle app.3f652e46.js)
**Användarönskemål:** tablån ska visa både igår och idag så att man kan starta
ett program från igår genom att scrolla; hela raden ska vara klickbar, inte
bara den lilla play-knappen.
- fetchScheduleDay(channelId, dateStr): per-dag-cache (10 min TTL), samma
  parsing som tidigare. fetchSchedule(channelId) delegerar till idag —
  DVR-knapparnas kontrakt oförändrat.
- openChannelCard: hämtar igår + idag parallellt, dagdividerare "Igår"/"Idag"
  (sticky, följer med vid scroll), igår först. Auto-scroll (scrollIntoView
  block:center) till pågående programmet → igår ligger direkt ovanför.
- Hela raden var redan en <button> (width 100%) — men disabled-rader (ingen
  episodeId) såg likadana ut och gjorde inget, vilket gav intrycket att bara
  ▶ var klickbar. Nu: disabled-rader dimmade (opacity 0.55), :active-
  feedback på hela raden, ▶ är dekoration.
- Verifierat live (GitHub Pages, app.3f652e46.js):
  - Kortet: 122 rader (61 igår + 61 idag), dividerare Igår/Idag, 83 spelbara.
  - END-TO-END: klick på igårens "Morgonpasset i P3 09:02" → episodes/get →
    listenpodfile.mp3 → spelaren öppnad, seek 0:02→0:34 av 96:48 ADVANCERAR
    (ljudet spelar). Sub = programnamn, titel = avsnittstitel.
  - Screenshot: Igår-sektionen syns direkt ovanför Idag, pågående rad centrerad.
- 83/83 tester.

### Användarönskemål 2026-09-23 (del 1–3): fallback, Nyheter-unfold, PWA-livscykel (commits 434eb28 + 0d6dfb3, bundle app.b178e3e6.js)

**1. Fallback utan låt (expanderad spelare):**
- Hårdkodade texten "Ingen låtinformation för tillfället — kanalen sänder
  program." BORTTAGEN helt.
- Ny fallback: kanal-omslag (cur.artwork) + "Spelas just nu" + Pågår
  nu-programnamnet (cur._srProgramTitle) + kanalnamn som sub.
- paintProgramTitle repaintar nu öppen expanderpanel — programtiteln kan
  lösa sig EFTER att panelen öppnats.
- Verifierat live (P1, tal): "Spelas just nu / Förmiddag i P1 / P1" med
  kanalomslag, ingen hårdkodad text.

**2. Nyheter unfold/fold:**
- Sektionsrubriken är nu en toggle (chevron roterar). Ihopfälld = första
  nyheten peekar ut (74px + gradient-mask) som hint.
- Auto-unfold EN gång per uppspelningssession när program/podd spelar
  (newsAutoUnfolded-flagga, reset i playTrack). Spelaren ligger kvar överst
  (fixed z-30; sektionen är i normalt flöde).
- BUGG hittad i live-verifiering: första manuell fällning under uppspelning
  överriddes direkt — auto-unfold körde varje updatePlayingMarks och
  re-expanderade. Fix: auto-unfold eldar en gång per session, manuellt val
  vinner. Återverifierat: fold håller, unfold funkar, stopp ändrar inte.
- Verifierat live: foldedInitially ✅ autoUnfoldedOnPlay ✅ manualFoldHolds ✅
  manualUnfoldWorks ✅ afterStopStaysExpanded ✅

**3. PWA-livscykel (försökt fix; senare iPhone-test bekräftade att problemet kvarstår):**
- Användarrapport: "om den nya PWA:n läggs i bakgrunden och sedan stängs
  spelar den första spelaren fortfarande" + låsskärmen öppnar fel PWA.
- Analys: när PWA stängs (swipe away) skickar iOS pagehide; utan städning
  kan OS behålla zombi-ljudsession bunden till döda sidan → låsskärmen
  pekar på fel (gammal) installation.
- Fix: pagehide(persisted=false) + freeze → pausa ljud + rensa
  MediaSession. persisted=true (bfcache/bakgrund) påverkas INTE — radio i
  bakgrunden är en feature. resume → synka UI.
- Vid implementationstillfället återstod iPhone-verifiering. Fälttest
  2026-09-23 bekräftade att beteendet var oförändrat; hämta först
  `sr-diag-log` enligt AKTIV ARBETSKÖ i stället för att anta att ominstallation
  eller dubbelinstallation är orsaken.

### Nyheter-logik korrigerad + episod-låtmetadata + PWA-diagnostik (2026-09-23, commits 38efd3b + 66af359, bundle app.47d38b2b.js)

**1. Nyheter — KORRIGERAD (första implementationen var bakvänd):**
- Default (ingen uppspelning): HELT UTFÄLLD, alla nyheter synliga/klickbara.
  Peek-beteendet ("första nyheten som hint") HELT BORTTAGET.
- Uppspelning startar → auto-IHOPFÄLLNING en gång (endast header, scroller
  display:none — ingen peek). Spelaren ligger överst (fixed z-30).
- Manuell utfällning under uppspelning vinner (newsManualExpanded) —
  playback-events/renderPlayer/metadata uppdateringar återfäller ALDRIG.
- BUGG hittad i live-verifiering: paus→spela triggade om auto-i-hopfällningen
  (updateNewsFold behandlade paus som sessionslut). Fix: session =
  state.current finns; paus/resume inom sessionen ändrar inte läget. Endast
  stängd spelare → åter full utfällning.
- VERIFIERAT LIVE (alla 7 steg): s1 utfälld utan uppspelning ✅ s2 ihopfälld
  vid play + scroller display:none ✅ s3 manuell utfällning håller ✅
  s4a utfälld under paus ✅ s4 håller efter resume ✅ s5 utfälld efter stopp ✅

**2. PWA-ljudlivscykel — INSTRUMENTERING (rotorsaksdata väntas från iPhone):**
- Kodgranskning: exakt EN Audio (const, aldrig återskapad), en $player,
  renderPlayer rör aldrig audioEl, alla listeners → singleton, alla
  singletons (hls/timers/poll) städas i stopAndClosePlayer. SW cachar bara
  same-origin shell — kan inte hålla ljud vid liv.
- SLUTSATS FRÅN KOD: appen KAN inte producera ett andra audio-element. Om
  ljud fortsätter efter swipe-away är det INTE detta dokuments audioEl.
  Kandidater: (a) annat dokument (dubbelinstallation/gammal flik), (b)
  iOS media-session UI kvarstår medan ljudet faktiskt stoppat, (c) iOS
  standalone-process suspenderas/avslutas fördröjt — OS-beteende.
- DIAGNOSTIK tillagd (tillfällig, tas bort när rotorsaken är känd): unikt
  DIAG_ID per sidladdning; loggar page-load (med standalone-flagga),
  audio-created/src-set/src-cleared, play/pause/ended, pagehide(persisted),
  pageshow, visibilitychange, freeze, mediasession-cleared → localStorage
  'sr-diag-log' (200 rader) + console. Loggen ÖVERLEVER sidstängning.
- iPhone-procedur: spela → lås → lås upp → swipa bort PWA:n → öppna PWA:n
  igen → Inställningar → (diag-loggen kan läsas via konsol eller nästa
  steg: visa den i Om-appen-vyn). Om gammal DIAG_ID saknar pagehide-rad =
  iOS meddelade aldrig sidan (kandidat c). Om pagehide persisted=false +
  pause finns = ljudet kommer från annat dokument (kandidat a).

**3. Arkiverade avsnitt: låtmetadata via web-api.sr.se/v1/player/ondemand:**
- playTrack(kind=episode) → loadEpisodeTracks(id) (cache per avsnitt,
  seq-guard så gamla svar aldrig läcker) → tracks med relativeStartTime/
  relativeEndTime (HH:MM:SS relativt avsnittets ljudstart) → mappas direkt
  mot audioEl.currentTime. INGEN polling — timeupdate är källan.
- paintNowPlaying + expanderpanelens renderSongView läser episodeCurrent-
  Track för episoder, nowPlaying.song för live — källorna kan aldrig blanda.
- Seek/paus: timeupdate löser om positionen; paus behåller aktuell låt.
- stopAndClosePlayer + live-övergång: stopEpisodeTracks() nollställer.
- tracks:[] (talk/poddar) → ingen linje, ingen error (verifierat: podd
  2878427 spelar, linje dold, panel visar avsnittstitel + omslag).
- Verifierat mot riktiga data: 2861130 (33 spår) — position 300s →
  "Avicii, Audra Mae – Addicted To You" ✅. Diag-loggen bekräftar att
  playTrack anropats med rätt episode-id:n. Full paint-verifiering av
  musikavsnitt kräver riktig enhet (headless Chromium kan inte dekoda
  SR:s m4a/AAC — samma URL:er spelar redan i produktion via episodes/get).
- 83/83 tester.

### FÄLTTEST 2026-09-23 (användarens iPhone + Edge) — episod-låtmetadata FUNGERAR OTILLFÖRLITLIGT — **OPEN, kräver mer testning**

Användarens fälttest av igårens program (skärmdumpar bifogade rapporten):

1. **Låttitel + artist visas bara mycket sällan** på igårens program.
2. **När titel/artist VÄL visas uppdateras den inte** — samma låt står kvar
   även när nästa låt börjar (t.ex. "Koncert: Hammond…" på Jazzradion,
   skärmdump).
3. **Fel kanalinformation visas ibland** när ingen låt spelas: skärmdump 1
   (iPhone) visar expanderpanelen med P3-omslag + "Vaken / P3" medan
   Jazzradion spelar; skärmdump 2 (Edge) visar "Aftonsång och Vaggvisa /
   Eduard Tubin" medan Musik mot midnatt spelar — dvs. metadata från fel
   källa/fel session läcker in i panelen.

**Första analysen (preliminär och senare förfinad av evidenspassen nedan):**
- Punkt 3 tyder på att `episodeCurrentTrack`/`nowPlaying`-state inte
  nollställs vid kanal-/avsnittsbyte i alla vägar, eller att expander-
  panelens `renderSongView` läser state som tillhör en tidigare session.
  Kandidater: stopEpisodeTracks() saknas i någon övergång; panel öppnad
  före/efter byte repainterar med gammalt state; `_srRepaint`-guard.
- Punkt 2 tyder på att `updateEpisodeTrack()` inte körs (timeupdate når
  inte resolvern) eller att jämförelsen av title/artist felaktigt bedömer
  "ingen ändring" — eller att tracks-cache innehåller fel avsnitts data.
- Punkt 1 kan vara att ondemand-fetchen misslyckas tyst (catch → null) för
  vissa avsnitt, eller att tracks är tomma för vissa igårens program.

**Ursprunglig nästa-session-plan (historisk; senare iPhone-/Playwright-evidens och aktuell arbetsordning följer nedan):**
1. Reproducera på riktig enhet: spela igårens musikprogram, vänta till
   nästa låt, öppna panelen — logga vilken källa (episodeCurrentTrack vs
   nowPlaying.song) panelen ritar.
2. Granska alla övergångar (episode→live, episode→episode, stopp) för
   saknad stopEpisodeTracks()/stopNowPlayingPoll().
3. Verifiera att ondemand-fetchen lyckas för de igårens avsnitt som
   misslyckas i fältet (endpoint kan returnera tracks:[] för vissa).
4. Lägg till regressionstester för state-nollställning per övergång.

### Evidenspass 2026-09-23 (GitHub Pages + Edge headless) — AVGRÄNSAT, INTE iPhone

Detta pass verifierade den publicerade builden och SR-data från den riktiga
GitHub Pages-origin. Headless Edge kan inte användas som bevis för att SR:s
M4A-ljud faktiskt spelar eller att iPhone-beteendet är reproducerat.

**Verifierat:**
- Publicerad sida laddar `app.47d38b2b.js`; den har ingen service-worker-
  controller i denna headless-session. Befintliga Network Timing-resurser
  visar två lyckade `ondemand?id=2863666`-anrop (HTTP-status kunde inte
  avläsas ur Performance API; appens fetch-respons hanteras separat).
- SR `scheduledepisodes` returnerade HTTP 200 för 2026-09-22. Jazzradion
  `episodeid=2863666` (60 min) har 8 låtposter; Musik mot midnatt
  `episodeid=2863667` (120 min) har 28; P3-programmet `episodeid=2861333`
  har 66. Ondemand-endpointen returnerade HTTP 200 för samtliga och
  motsvarande spårantal. Radio Sweden-avsnitt `2878427` returnerade 200,
  `tracks: []` — giltigt talinnehåll, inte fetch-fel.
- Rätt aktivt avsnitt valdes i UI-kortet för Jazzradion, och expanderpanelen
  visade dess avsnittstitel/omslag medan ingen låt ännu matchade position
  0:00. Headless ljudstart misslyckades (`Kunde inte starta uppspelning`,
  `ERR_ABORTED` på M4A efter kandidatbyte); därför gick det inte att verifiera
  timeupdate, spårgräns eller nästa-låt-paint i denna miljö.
- Live `playlists/rightnow` gav HTTP 200 och olika data för P2 Musik (163)
  och P3 (164). Stale song/artwork från föregående kanal kan inte avgöras
  genom att titta på DOM utan att köra sidans interna listeners/state.
- Ingen kodändring. `npm test`: 83/83 passerar.

**Kodgranskning — konkret avvikelse som behöver verifieras:**
- `playTrack()` sätter `state.current = track` före metadata-övergångarna.
  Vid live väljs därför rätt live-källa direkt; `stopEpisodeTracks()` rensar
  avsnitts-låten. Vid episod anropas `stopNowPlayingPoll()`, men funktionen
  rensar `nowPlaying.song/artwork` utan att anropa `paintNowPlaying()`.
- `paintNowPlaying()` väljer korrekt textkälla efter `state.current.kind`,
  men expanderpanelens `renderSongView()` väljer rätt `song` och använder
  ändå alltid `nowPlaying.artwork` för låtbilden. Därför kan gammalt
  live-omslag paras med episodens låttext under en övergång, om panelen
  är öppen och episodmetadata hinner målas före en ny render. Detta är en
  verifierbar inkonsekvens i koden, men ännu inte bekräftad som förklaring
  till användarens skärmdumpar.
- `refreshNowPlayingArtwork()` skyddar sena iTunes-resultat med `artworkSeq`
  bara när en ny bildsökning startar. `stopNowPlayingPoll()` invaliderar inte
  `artworkSeq`; ett svar från föregående live-kanal kan därför skriva
  `nowPlaying.artwork` efter kanal-/episodbyte. Ingen synlig episod-låttext
  orsakas av detta, eftersom episodens textkälla är separat, men omslagsbild
  kan bli stale. Bekräfta faktisk synlighet innan åtgärd.
- `updateEpisodeTrack()` körs bara på `timeupdate`; resolvern lämnar
  `episodeCurrentTrack` oförändrad om `tracks` saknas/tomma. Korrekt
  sekvensguard finns för fetch, men appen ignorerar `response.ok` före
  `response.json()` och gör fetchfel/tomt svar indistinguishable i UI.

**Nästa högsta informationsvärde:** på riktig iPhone spela Jazzradion
2863666 från tablån, verifiera låt vid 00:02 (första intervallet startar
00:01:49), sök till cirka 00:11 (nästa låt börjar 00:10:41), och rapportera
om både minispelarens rad och expanderpanelens titel byts. Anteckna aktivt
avsnitt, visad låt/omslag och UI direkt före/efter sökningen. Separat,
kontrollera episode→live och episode→annat episode med expanderpanelen öppen
för att avgöra om stale artwork faktiskt visas. Ändra inte reset-/paint-flödet
förrän en av dessa fall visar det specifika felet.

### iPhone-uppföljning (rätt tredje skärmdump, 2026-09-23)

- Vid ca 02:14 i Jazzradion 2863666 visar panelen fortfarande programmets
  titel/omslag, inte låten. API:ts första låt är `A Real Goodun'` från
  00:01:49 till 00:10:41. Observationen bekräftar alltså att första
  låtintervallet inte syntes vid den rapporterade positionen.
- Vid 12:46 visas `Groove Merchant` med Anders Berglunds band; API:t anger
  intervallet 00:12:00–00:18:34. Andra intervallet matchar således
  uppspelningstiden och renderades korrekt. Detta begränsar problemet:
  metadata saknas inte generellt för avsnittet; felet tycks bero på första
  låtens upptäckt/visning eller testets initiala laddnings-/seeksekvens.
- Korrigerad tredje skärmdump efter tryck på P2-kanalikonen visar P2 som
  aktiv källa, undertiteln `Konsert i P2` och live-spåret `Trippelkonsert
  för violin, cello, och piano i C-dur op 56` av Trio Con Brio. Detta är
  förenligt med P2:s live-metadata och visar inte kvarhängande Jazzradion-
  eller episodtext. Badgen visar `AAC 192 · buffrar`; skärmbilden ensam
  bekräftar inte om ljudet därefter återhämtade sig eller förblev stannat.
- Därmed finns ännu inget fältbelägg för episod→live-textläckage i just
  denna övergång. Den kodgranskade artwork-race:n är fortfarande en möjlig
  hypotes, inte en bekräftad orsak.
- **Ny uppföljning:** vid seek tillbaka saknades `A Real Goodun'` först;
  vid ändring till ca 12:26 ändrades inte låten direkt. När användaren
  stängde den expanderade panelen och öppnade den igen visades rätt låt.
  Samma sak inträffade efter återgång till ca 02:14. Detta skiljer tydligt
  på metadata/data och presentation: rätt låt kan visas för samma position
  efter att panelen byggts om, så saknad endpoint-data är inte längre den
  främsta hypotesen. Användaren förtydligar att felet är i den expanderade
  spelarens uppdatering: efter återgång till 02:14 stängdes/öppnades panelen,
  och då dök rätt låt upp. Detta korrigerar eventuell feltolkning att låten
  skulle ha dykt upp spontant medan panelen var öppen. Fokusera nu på
  panelens repaint/livscykel efter seek; track-state kan redan vara korrekt,
  men aktuell observation ensam bevisar inte exakt vilket led som fallerar.

**Föreslagen kontroll då (senare ersatt av Playwright-försöket nedan):** håll panelen öppen och seeka mellan 02:14 och
12:26. Bekräfta om metadata i panelen förblir stale medan spelaren går, och
uppdateras omedelbart när panelen stängs/öppnas. Denna jämförelse skiljer en
missad panel-repaint från en metadata-resolver som bara uppdateras vid ny
render. Koden att spåra är `updateEpisodeTrack()` → `paintNowPlaying()` →
`panel._srRepaint`; kontrollera även om `renderPlayer()` återskapar panelen
under seek. Gör ingen workaround innan den ansvariga vägen är bekräftad.

### Fokuserat Playwright-försök (produktionsorigin, 2026-09-23)

- Git-status före testet: ENDAST redan existerande ändring i `ENHANCEMENTS.md`
  från dokumentation av fälttester; inga app-/test-/skriptändringar. Inga
  tillfälliga diagnostik-wrappers eller Audio-mocks användes i detta pass.
- Använde byggda GitHub Pages-appen `app.47d38b2b.js`. Endpointen för P3
  Musik episod `2861130` gav 200 och 33 spår. Kända positioner: 130 s =
  `Waste My Time`, 300 s = `Addicted To You`, 740 s = `Faller`.
- Verklig UI-resa: öppna P3:s tablå via högerklick/contextmenu på P3-ikonen,
  välja gårdagens `P3 Musik`-rad 22:03 (episod 2861130), öppna expanderpanelen,
  klicka på seekraden vid episodpositionen och läsa panelens faktiska DOM.
  Varje seek följdes av DOM-läsning efter 1, 3, 5 och 10 s; därefter stängdes
  och öppnades expanderpanelen och DOM lästes igen.
- Tre kompletta cykler genomfördes för 130 s och 300 s (6 seekförsök):
  - 130 s: i samtliga 3 cykler visade panelen endast `Med Annie Widman`
    efter 1/3/5/10 s; efter panel stäng/öppna visade den
    `Waste My Time — Benjamin Ingrosso`.
  - 300 s: i samtliga 3 cykler visade panelen `Waste My Time — Benjamin
    Ingrosso` efter 1/3/5/10 s; efter panel stäng/öppna visade den
    `Addicted To You — Avicii, Audra Mae`.
- Första cykelns tidslinje: panel öppen med fallback `Med Annie Widman` →
  seek till rapporterad 130 s, UI-tid 1:59 → panel oförändrad vid +1,+3,+5,
  +10 s → stäng/öppna → `Waste My Time` visas. Därefter seek 300 s, UI-tid
  4:54 → panel behåller `Waste My Time` i 10 s → stäng/öppna → panel visar
  `Addicted To You`.
- **Resultat: produktions-Playwright återgav den användarsynliga buggen
  6/6 gånger** (gammal/tom panel efter seek; korrekt spår först efter
  expanderpanelen byggts om). Detta besvarar reproducerbarhetsfrågan: JA.
- Begränsning: browser context hade ingen `<audio>`/`<video>`-nod och inga
  media-resource entries; seekraden ändrade ändå appens synliga tid. Därför
  verifierar detta direkt fel i den deployade UI-resan, men bevisar inte att
  faktisk AAC-dekodning/timeupdate/ljuduppspelning fungerade. Den testade
  positionen var UI-tid nära respektive spårposition; miljöns media-gräns
  gör detta en browser-automation-återgivning av UI-symptomet, inte full
  ljudkedja.
- Slutsats hittills: det reproduceras tydligt i UI och reopening ändrar
  expanderpanelens text. Track-resolution vs repaint kan ännu inte säkert
  skiljas åt utan privata state-instrument eller en miljö med fungerande
  mediaavkodning. Varken console- eller HTTP-fel som hör till denna UI-resa
  identifierades; relevant ondemand-fetch hade tidigare returnerat 200.
- Nästa minsta steg: återge samma production journey i icke-headless
  desktop Edge/Chrome med verkligt fungerande media och seek, och jämför
  användar-DOM över 1/3/5/10 s. Om automatisering fortsatt saknar riktig
  media bör diagnosen stanna vid "UI-bug reproducerad, intern gräns ej
  avgjord" — inga slutsatser om `episodeCurrentTrack`.

---
