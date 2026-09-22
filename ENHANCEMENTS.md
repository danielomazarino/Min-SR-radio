# Förbättringslogg — Min Radio

Pågående anteckningar för förbättringar att ta itu med senare. Nyast överst.

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

### Kvar
- iPhone-test: gest-fixen (svep nedåt ska INTE längre seeka), ±15 s-knappar,
  programhopp (syns när SR:s tablå-API fungerar igen).
- ~~SR: rapportera/vänta ut scheduledevents-500:an.~~ → Se UPPDATERING
  ovan: API:t avvecklas, 500:an fixas inte. Programhopp förblir dolt tills
  vidare; överlevnadsplan (podd-URL:er, direktlänkar) är ny åtgärd.

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

### Kvar
- iPhone-verifiering av BUG A/B (DVR-pill + slider) och BUG 1 (sheet-scroll
  efter andra öppningen) — användaren har enheten.
- Android Chrome-validering (Fas 3-kvarvarande).
- Fas 4/5 (PLANNED) oförändrat.

---

## 2026-09-22 — iPhone-feedback på DVR-UX-revisionen (buggar att fixa nästa session)

**Användaren testade nya UX:n på riktig iPhone.** Funktionellt fungerar DVR
(seek + Till Direkt via LIVE-etiketten), men två UX-problem rapporterades:

### BUG A — Pillen ska visa minus-tid, inte klocktid (HIGH, OPEN)
- **Observation:** pillen visar klocktid (t.ex. "23:05") men klocktiden står
  redan nere till vänster vid slidern — pillen ska visa **minus-tiden**
  ("−46 min") eftersom det är den information användaren vill se i pillen.
- **Fix-riktning:** byt tillbaka pillen till `dvrOffsetLabel()` (relativ
  offset). Behåll klocktiden i seekradens vänsterlabel (där den är nyttig
  som drag-förhandsvisning). Detta återställer den icke-duplicerade
  kompositionen: pill = minus-tid, slider-vänster = klocktid.
- Obs: detta är en medveten designändring från UX-revisionen ovan —
  användarens preferens vinner.

### BUG B — Slider-upplevelsen fläckig/instabil (HIGH, OPEN)
- **Observation:** slider-känslan är "fläckig" och känns inte stabil/smooth
  på iPhone (touch).
- **Möjliga orsaker att utreda (INTE bekräftade — utred först):**
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

### Nästa session — startpunkt
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

### Kvar
- iPhone-verifiering av nya UX:n (användaren har enheten) — mekanismen är
  oförändrad, bara presentationen.

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

**Statusöversikt (distinguishera COMPLETE / NEXT / PLANNED / OPEN BUG /
NOT YET VALIDATED — historiken nedan är oförändrad):**

| Fas | Status |
|---|---|
| Fas 1 — Foundation (descriptors, CAPS, livscykel-fix) | **COMPLETE** |
| Fas 2A — HLS playback-engine | **COMPLETE** |
| Fas 2B — Validering på riktiga webbläsare | **COMPLETE ENOUGH TO PROCEED** |
| Fas 3 — DVR-UI | **COMPLETE** (se nedan; verifierad på riktig Edge) |
| Fas 4 — Expanderbar/rich player | **PLANNED** |
| Fas 5 — Context cards: Tablå & podcast-avsnitt | **PLANNED** (framtida) |
| Validering på riktig iPhone Safari + Android Chrome | **NOT YET VALIDATED** |
| Bug backlog (Inställningar-krasch, nyhetslänkar) | **OPEN BUG** |

**Fas 2B-nyckelbevis (bevarat):** riktig Edge 153 (riktig Chromium, CDP-driven
mot deployad GitHub Pages — ej Electron/VS Code-webview): seekable 0 → 10 880 s
(≈181 min / 3,02 h), currentTime ≈ 10 868 vid live-kanten, 5-min-bakåtseek
lyckades med uppspelning aktiv; P1 HLS-192 AAC 192, P2 Musik FLAC först,
P3 HLS-320 AAC 320, P2 (163) HLS-192 AAC 192. Firefox 155: HLS korrekt
filtrerad, MP3 96-fallback, `hlsLoaded: false`, livscykel OK, inga HLS-fel
exponeras. `backBufferLength: 90` / `maxBufferLength: 30` räckte för den
testade bakåtseeken — **ändra inte dessa värden** bara för att SR:s playlist
innehåller ~3 timmar.

**Ej verifierade plattformar (kvarstår):** iPhone Safari, Android Chrome,
bakgrund/låsskärm-uppspelning. Fas 2B gav tillräckligt underlag för DVR-UI;
**riktig enhetsvalidering krävs innan iPhone/Android-DVR-stöd kan förklaras
komplett.**

### Fas 3 — DVR-UI (status: COMPLETE, verifierad på riktig Edge 153)
Implementerad och verifierad 2026-09-22 (se detaljerad post nedan): mode-pill
med relativ offset, DVR-seekrad mappad till aktuell seekable-range, "Till
Direkt", transportoberoende (läser Phase 2A-state), P2 FLAC aldrig automatiskt
ersatt. Kvar för Fas 3: validering på riktig iPhone Safari + Android Chrome när
enheter finns tillgängliga.

### Fas 4 — Expanderbar/rich player (status: PLANNED — efter Fas 3)
Syfte: expandera den kompakta spelaren till en rikare spelare utan att den
normala spelaren blir rörig.
- Tap på spelaren expanderar
- Program/programmets namn, aktuell låt, artist
- Podd/avsnitt-information där tillgänglig
- Eventuellt omslagsbild
- Kompakt spelarläge förblir standard

**UX-princip:** den normala spelaren förblir kompakt. Den expanderade
spelaren är ett extra informationslager, inte en ersättning.

### Fas 5 — Context cards: Tablå & podcast-avsnitt (status: PLANNED)
Framtida funktion som kräver egen UX- och datakälls-utredning innan
implementering. **Implementeras inte nu.**

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

### Validering på riktig enhet (status: NOT YET VALIDATED)
Kvar att validera när enheter finns tillgängliga:
- iPhone Safari + installerad PWA: native HLS, DVR-UI, bakgrundsljud,
  låsskärm, kanalbyte, fallback
- Android Chrome + installerad PWA: hls.js, DVR-UI, bakgrundsljud,
  låsskärm, kanalbyte, fallback
- DVR-UI:n är transportoberoende (läser bara seekable-state) och ska
  valideras på båda plattformarna innan stödet förklaras komplett.

### BUG BACKLOG (status: OPEN — separerade från feature-faser)

Dessa är bekräftade applikationsbuggar som inte får glömmas. De är inte
valfria förbättringar och kan behöva åtgärdas före/mellan feature-faser
beroende på utredning.

**BUG 1 — Inställningssidan kraschar vid scroll till kanal/podd-val**
- Severity: HIGH · Status: OPEN
- Observerat: Inställningssidan kraschar när användaren scrollar ned till
  sektionen där kanaler/poddar kan väljas.
- Förväntat: sidan ska vara stabil genom hela Inställningar-sidan, inklusive
  kanal- och poddval — öppna, scrolla, nå kanalval, nå poddval, välja/avvälja
  och fortsätta scrolla utan krasch.
- **Ingen rotorsak är känd — registrerad som observerad bugg som kräver
  utredning.** Vid framtida fix: reproducera först, identifiera exakt fel
  (rendering, event-hantering, DOM-livscykel, dataladdning eller annat),
  gör den minsta lämpliga korrigeringen, lägg till regressionstäckning där
  praktiskt.

**BUG 2 — Nyhetslänkar (URL) öppnas inte korrekt**
- Severity: HIGH · Status: OPEN
- Observerat: URL-länkar i nyhetssidorna öppnas inte korrekt.
- Förväntat: när användaren väljer en länk från en nyhetssida ska
  destinationen öppnas korrekt, med plattformslämplig navigering (PWA/
  webbläsare).
- **Ingen rotorsak är känd — registrerad som observerad bugg som kräver
  utredning.** Vid framtida fix: identifiera hur nyhetslänkar renderas idag,
  avgör om länkar fångas fel, om SPA-routing/PWA-navigering/target-hantering
  eller URL-hantering är inblandad, reproducera, gör minsta lämpliga
  korrigering, lägg till regressionstäckning där praktiskt.

### Rekommenderad arbetsordning
Faserna behöver inte genomföras i strikt numerisk ordning. De två bekräftade
buggarna (Inställningar-krasch, nyhetslänkar) kan behöva åtgärdas före eller
mellan feature-faser beroende på utredning. Riktig enhetsvalidering
(iPhone/Android) krävs innan plattformsspecifikt DVR-stöd förklaras komplett.

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

### Acceptansmatris

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

### Kompatibilitetsmatris (kodavkodning vs SR-ström vs arkitektur)

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

### Kvar att testa på riktig hårdvara
- iPhone: native HLS + DVR-seek + bakgrund/PWA (högsta prioritet)
- Android: hls.js + DVR + bakgrund
- Firefox desktop: TS-i-MSE
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

## Låsskärm-fixar (2026-09-22)

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

**Verifierat live:** bundle `app.21251be8.js`, SW `minradio-2265a6ae`,
ikon-md5 `c79ae883…` på GitHub Pages. MediaSession-metadata sätts vid
uppspelning (poddar/nyheter; kanaler följer samma kodväg). iPhone-verifiering
av låsskärmsspelaren + ikonen återstår (användaren).

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
