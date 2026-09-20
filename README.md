# Min Radio — personlig Sveriges Radio-PWA

En liten, personlig radiostartskärm byggd på Sveriges Radios öppna data. Installerbar som app på iPhone och Android. **Helt statisk** — ingen server behövs, distribueras på GitHub Pages eller vilken statisk värd som helst.

- **Version:** 1.3.0
- **Utvecklare:** Daniel Omazarino
- **Status:** Personlig app, ej affilierad med Sveriges Radio

---

## Funktioner

### Hemskärm — tre områden, inget annat

| Område | Beskrivning |
|---|---|
| **Kanaler** | Exakt 4 favoritkanaler som rena logotypikoner i en rad. Tryck = spela/stoppa direkt sändning. |
| **Poddar** | Exakt 4 favoritpoddar som omslagsikoner i en rad. Tryck = spela senaste avsnittet. |
| **Nyheter** | Senaste nyheterna från Ekot (text), nyaste först. Rullbar lista — 4 synliga, upp till 20 (inställbart). Tryck = läs artikeln i appen. |

### Spelare
- Tydlig mini-spelare längst ned när något spelas.
- Pausa/fortsätt för alla ljudtyper.
- **Spola ±15 sekunder** och tryckbar tidslinje för on-demand-ljud (poddavsnitt, nyhetssändningar).
- Direktsänd radio: pausa/fortsätt (spolning saknas — direktsändning kan inte spolas).
- Stäng spelaren med ✕.

### Val av favoriter
- Första starten: guidad val av exakt 4 kanaler + 4 poddar.
- Sök bland poddar — filtrering sker **i appen** mot hela katalogen (SR:s eget sökfilter är trasigt och returnerade fel program; därför görs sökningen klient-sidigt).
- Max 4 per kategori — överskridelse blockeras med tydligt meddelande.
- Enskilda favoriter kan bytas när som helst (ta bort en, välj en ny) — ingen återställning behövs.

### Inställningar (under **Ändra**)
- **Antal nyheter:** 4–20 (reglage, sparas direkt).
- **Om appen · version & hjälp:** öppnas som ett native-lager i appen (ingen ny flik) med versionsnummer, utvecklare och hjälp.

### Integritet & persistens
- Favoriter och inställningar sparas lokalt i `localStorage` — inga konton, ingen databas, ingen spårning.
- Valet överlever omstart, uppdatering och appinstallation.
- Skadad localStorage återställs automatiskt till First-run-guiden.

### Felhantering
- Alla anrop har tidsgräns (10 s) och svenska, vänliga felmeddelanden.
- Tre dataområden (kanaler/poddar/nyheter) laddas oberoende — ett fel stoppar inte de andra.
- Skelettladdning — UI ser aldrig sönder under loading.

---

## Teknisk build

### Arkitektur — 100 % statisk

```
Telefon/dator (PWA, vanilla JS/CSS)
    │  fetch direkt till:
    ├─ SR Open API v2 (api.sr.se/api/v2)  ← kanaler, poddar, avsnitt, ljud (CORS öppet)
    └─ Ekot Atom-flöde (api.sr.se/api/rss/program/83)  ← nyheter + ingertext
    │
    ▼
localStorage (favoriter, antal nyheter)
```

**Ingen backend.** api.sr.se har CORS aktiverat, så webbläsaren pratar direkt med SR:s API. Sveriges.Radio-MCP-projektet (referensintegrationen) wrappar exakt samma endpoints men som stdio/HTTP-JSON-RPC — inte konsumerbart från en webbläsare och överflödigt här. Däremot ersättes en sak som en backend tidigare löste: **full artikeltext** på sverigesradio.se saknar CORS och kan inte hämtas av en statisk app. Läsaren visar därför flödets ingress + bild, med länk "Läs hela artikeln på sverigesradio.se".

### Katalogstruktur

```
├── index.html            # app-skal
├── app.js                # all logik: data, favoriter, spelare, vy
├── styles.css
├── manifest.webmanifest  # relativa sökvägar (fungerar under /repo-namn/)
├── sw.js                 # service worker (relativa sökvägar)
├── icons/                # genererade PNG-ikoner + SVG
├── build.mjs             # produktionsbuild: ikoner + cache-busting
├── scripts/generate-icons.mjs  # ren-JS PNG-rasterizer (ingen dependency)
├── server.js             # VALFRI lokal preview-server (npm start)
├── src/favorites.mjs     # favoritlogik (testbar)
└── tests/favorites.test.mjs
```

### SR-API-mappning (verifierad live 2026-09-20)

| Funktion | Endpoint |
|---|---|
| Kanallista + logotyper + liveaudio | `GET /api/v2/channels` |
| Poddkatalog (494 program) | `GET /api/v2/programs/index?filter=program.haspod&filtervalue=true&size=500` |
| Senaste avsnittet per podd | `GET /api/v2/episodes/index?programid=X&size=1` |
| Nyheter (text) | `GET api.sr.se/api/rss/program/83?format=145` (Atom) |

**Ljudkällor i prioritetsordning** (helper `episodeAudioFields`):
1. `listenpodfile.url` — podd-MP3
2. `broadcast.broadcastfiles[0].url` — direkt M4A (t.ex. lokala P4-nyheter)
3. `broadcast.playlist.url` — streammanifest

### PWA
- `manifest.webmanifest`: standalone, porträtt, **relativa sökvägar** (`./`, `icons/…`) — fungerar både på `användare.github.io/min-radio/` och egen domän.
- iOS: `apple-touch-icon`, `viewport-fit=cover`, safe-area CSS, 16 px inputs (hindrar iOS-zoom).
- Service worker: network-first för appskal med cache-fallback (offline-start), same-origin only — SR-trafik berörs aldrig.
- Ikoner genereras av en egen ren-JS PNG-rasterizer — original design (equalizer bars), inte SR:s logotyp.

### Integritet
- Ingen autentisering, ingen databas, ingen analys, ingen tredjepartskod, ingen server.
- SR:s webbskript laddas aldrig → deras cookie-dialog visas aldrig.
- Attribuering: "Data från Sveriges Radio" + länk, enligt API-villkoren.

---

## Köra & bygga

```bash
npm test          # 10 tester (favoriter, max-4-regler, nyhetssortering)
npm run build     # produktion → dist/ med cache-bustade filer
npm start         # VALFRI lokal preview på :3000 (serverar dist/)
```

**Deploy till GitHub Pages:**
1. Skapa ett GitHub-repo, t.ex. `min-radio`.
2. Ladda upp innehållet i `dist/` (eller kör `npm run build` i en Actions-workflow).
3. Settings → Pages → Branch: `main`, katalog `/ (root)` eller `/docs`.
4. Appen finns på `https://<användare>.github.io/min-radio/` — öppna den i telefonens webbläsare.

Alla referenser i appen är relativa, så den fungerar under vilken basväg som helst.

---

## Verifiera på telefon (iPhone eller Android)

Appen körs direkt från GitHub Pages — inget nätverk att konfigurera, ingen server som måste köras:

1. Öppna `https://<användare>.github.io/min-radio/` i Safari (iPhone) eller Chrome (Android).
2. **iPhone:** Dela-knappen → *Lägg till på hemskärmen* → Lägg till.
   **Android:** Menyn (⋮) → *Lägg till på startskärmen* → Installera.
3. Appen öppnas helskärm från hemskärmens ikon.

**Checklista:**
- [ ] First-run: välj 4 kanaler + 4 poddar (max 4 blockeras)
- [ ] Tryck kanalikon → ljud spelas, ikon-markering visas; tryck igen → stopp
- [ ] Tryck poddikon → senaste avsnittet spelas; pausa/spola ±15 s fungerar
- [ ] Nyheter: rulla i listan, tryck → artikel läses i appen (ingen cookie-banner)
- [ ] Sök podd "radiokorrespondenterna" → visar exakt de 3 Radiokorrespondenterna-programmen
- [ ] Ändra → Om appen öppnas i appen (inte ny flik); version + utvecklare syns
- [ ] Stäng appen helt → öppna igen: favoriter + antal nyheter kvar

> Lokal preview utan deploy: `npm start` och öppna `http://localhost:3000` (eller datorns LAN-IP från telefonen på samma Wi-Fi).

---

## Kända begränsningar

- Direktsänd radio kan inte spolas (teknisk begränsning i direktsändning).
- Nyhetsläsaren visar flödets ingress + bild; full artikeltext kräver backend (sverigesradio.se saknar CORS) — "Läs hela artikeln"-länken tar användaren vidare.
- SR:s öppna API underhålls inte längre ("tillsvidare") men fungerar stabilt.
