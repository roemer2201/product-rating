# HISTORY

Dokumentation abgeschlossener Arbeiten. Neueste Einträge stehen oben. Jeder
Eintrag nennt Datum, Umfang der Arbeit und die dabei getroffenen Entscheidungen.

---

## 2026-08-15 – M10: Docker

**Umfang**

- `server/src/plugins/staticFrontend.ts` plus der neue Schlüssel
  `server.static_dir`: der Server liefert die gebaute Oberfläche selbst aus
  (`@fastify/static`). Dateien unter `/assets/` tragen einen Inhalts-Hash und
  gehen mit `public, max-age=31536000, immutable` hinaus, alles andere –
  `index.html`, `sw.js`, Manifest, Icons – mit `no-cache`. Unbekannte Adressen
  beantwortet der Not-Found-Handler mit der App-Shell, aber nur bei `GET`/`HEAD`
  auf ein Dokument und nie unter `/api/` oder `/healthz`.
- `server/src/config/`: `static_dir` im Zod-Schema, in der Pfadauflösung (relativ
  zur Konfigurationsdatei) und in den Startprüfungen – gesetzt muss das
  Verzeichnis existieren und eine `index.html` enthalten, angelegt wird es
  bewusst nicht.
- `docker/Dockerfile`: zwei Stufen auf `node:22-bookworm-slim`. Bau-Stufe mit
  `npm ci`, `npm run build` und `npm prune --omit=dev`; Laufzeitstufe mit
  `node_modules`, Server-Bundle samt Migrationen, der Oberfläche unter
  `/app/web`, `USER node`, `EXPOSE 8080`, `VOLUME /data` und `HEALTHCHECK` auf
  `/healthz`.
- `docker/entrypoint.sh` nach den Skript-Konventionen (Header mit
  Programmablaufplan, `--help`, Silent/Verbose, alle Parameter zusätzlich als
  Umgebungsvariable): Verzeichnisse anlegen, Secret mit `0600` erzeugen,
  Migrationen anwenden, dann den Server per `exec` als PID 1 starten.
- `docker/config.container.toml` als mitgeliefertes
  `/etc/product-rating/config.toml`: `host = "0.0.0.0"`, Daten unter `/data`,
  `static_dir = "/app/web"`, Log nach stdout.
- `docker/docker-compose.yml` (Volume `product-rating-data`, Port nur auf
  `127.0.0.1`, `init`, `no-new-privileges`, Health-Check, Durchreichen von
  `PR_SERVER__BASE_URL` und `BOOTSTRAP_ADMIN_*`) sowie
  `docker/docker-compose.caddy.yml` mit `docker/Caddyfile.example` für Caddy als
  vorgelagerten TLS-Proxy.
- `.dockerignore`, README 2, 6.1, 6.2, 7.1 und 9 (Multi-Arch-Bau mit `buildx`,
  Container-Konfiguration, `PR_SERVER__STATIC_DIR` für den gebauten Stand ohne
  Container).
- 385 Tests grün (13 neue); `lint`, `typecheck` und `build` fehlerfrei.

**Real geprüft** (ohne Container – in der Entwicklungsumgebung lief kein
Docker-Daemon; geprüft wurde derselbe Laufzeitpfad, den das Image benutzt)

- `entrypoint.sh` gegen das gebaute Bundle: Verzeichnisse angelegt, Secret mit
  `-rw-------` erzeugt, Migration angewandt, Server gestartet. Zweiter Lauf
  behält Secret und Schema („nothing to do“), `SIGTERM` beendet sauber.
- Auslieferung: `/` und eine Client-Adresse liefern die App-Shell mit
  `no-cache`, `/assets/index-*.js` mit `immutable`, `sw.js` mit `no-cache`,
  `manifest.webmanifest` mit `application/manifest+json`, `/api/v1/nope` bleibt
  ein JSON-`not_found`, `/healthz` antwortet weiter selbst.
- `npm prune --omit=dev` samt entfernter Workspace-Links: Server startet,
  liefert aus, `fsck` läuft, `sharp`, `@node-rs/argon2` und `better-sqlite3`
  laden – der Schritt, auf dem die Laufzeitstufe des Images aufbaut, trägt also.

**Offen** – das Image selbst ist ungebaut und ungetestet; das steht als eigener
Punkt in TODO.md (M10), zusammen mit dem arm64-Bau und der Frage, ob die
Sourcemaps in der Laufzeitstufe bleiben.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Oberfläche im Container | Vom Server selbst ausgeliefert statt aus einem zweiten Container | README 2 sagt „API und Frontend in einem Prozess“ zu; eine Herkunft ist genau das, worauf Session-Cookie und Origin-Prüfung bauen, und der Proxy braucht nur eine Regel |
| Schalter dafür | Konfigurationsschlüssel `server.static_dir`, leer als Standard | Kein Pfad im Code, und die Entwicklung bleibt reine API, wo Vite die Oberfläche ausliefert |
| App-Shell-Fallback | Nur `GET`/`HEAD` mit `Accept: text/html`, nie unter `/api/` | Ein fehlendes Bild muss als `404` scheitern, und ein Client, der JSON erwartet, darf kein HTML mit `200` bekommen |
| Cache-Regeln | `/assets/` unbefristet, alles andere `no-cache` | Nur die Dateien mit Inhalts-Hash im Namen dürfen ewig liegen bleiben; bei `sw.js` und `index.html` hieße das, dass eine neue Version nie ankommt |
| Konfiguration im Image | Eigene Datei `config.container.toml` als `/etc/product-rating/config.toml`, nicht per Umgebungsvariablen im `Dockerfile` | Umgebungsvariablen schlagen die Konfigurationsdatei; wären die Container-Standards Variablen, könnte eine eingehängte eigene Datei sie nicht mehr übersteuern |
| Rechte im Container | `USER node` (uid 1000), keine Vorbereitung als root | Der Entrypoint braucht kein root: `/data` gehört im Image bereits `node`, und ein benanntes Volume erbt diese Rechte. Ein Bind-Mount muss auf dem Host übergeben werden – der Entrypoint sagt das im Fehlerfall dazu |
| Laufzeitabhängigkeiten | `npm prune --omit=dev` statt zweitem `npm install` | Die Lock-Datei bleibt die einzige Wahrheit, und die nativen Module sind schon für die Zielarchitektur gebaut |
| Init-Prozess | Kein `tini` im Image, `init: true` in der Compose-Datei | Der Server läuft dank `exec` als PID 1 und behandelt `SIGTERM` selbst; die Zombie-Ernte ist nur Rückversicherung und gehört in die Betriebsdatei |
| Logging des Entrypoints | stdout/stderr statt `logger` | Im Container gibt es keinen syslog-Dienst; was das Hauptprogramm schreibt, ist das Log, das `docker logs` und jeder Log-Treiber sehen |
| Secret im Container | Vom Entrypoint mit `node crypto` erzeugt, im Volume | Das Laufzeit-Image hat kein `openssl`, und im Volume überlebt das Secret jedes neue Image – sonst wären nach einem Update alle Sitzungen ungültig |

---

## 2026-08-15 – M9: PWA und iOS

**Umfang**

- `web/vite.config.ts`: `vite-plugin-pwa` (Workbox) mit Manifest und Service
  Worker. `registerType: 'prompt'`, `injectRegister: false` – registriert wird
  aus der Oberfläche, die den wartenden Worker ohnehin in der Hand braucht.
  Vorgehalten wird die App-Shell (`js`, `css`, `html`, `svg`, `png`,
  `webmanifest`; 14 Einträge, 484 kB), `navigateFallback` auf `index.html` mit
  `/api/` in der Sperrliste, `cleanupOutdatedCaches`, `clientsClaim`. Dazu ein
  `preview`-Block mit demselben API-Proxy wie der Dev-Server – der Service
  Worker existiert nur im Bau, also braucht es einen Weg, ihn auszuprobieren.
- `web/public/`: `icon.svg` (abgerundet) und `icon-maskable.svg` (randlos, Marke
  auf 85 % skaliert) als einzige handgepflegte Icons, dazu die daraus erzeugten
  `icon-192/512`, `icon-maskable-192/512` und `apple-touch-icon` (180).
- `web/scripts/generate-icons.ts` plus `npm run icons`: rastert die SVG-Quellen
  mit `sharp`. Die PNG liegen im Repository, damit ein Produktionsbau ohne das
  native Modul auskommt; das Skript läuft mit Node 22 direkt als TypeScript und
  steht bewusst außerhalb der `tsconfig.json` des Web-Workspaces.
- `web/index.html`: `apple-mobile-web-app-*`, `apple-touch-icon`, zwei
  `theme-color` mit `media`-Abfrage, `format-detection: telephone=no`.
- `web/src/components/UpdatePrompt.tsx`: Registrierung des Workers und die
  sichtbare Aufforderung „Neue Version verfügbar“. Fragt zusätzlich stündlich
  und bei jedem Wechsel in den Vordergrund nach einer neuen Version.
- `web/src/lib/online.ts` und `web/src/components/OfflineNotice.tsx`:
  `useOnlineStatus()` über `useSyncExternalStore`, dazu ein Streifen über der
  Navigation und ein ganzer Schirm für den Fall, dass nichts geladen werden
  konnte. `RequireAuth` benutzt Letzteren, wenn die Sitzungsabfrage scheitert
  *und* das Gerät sich als offline meldet.
- `web/src/styles/app.css`: `.toast-stack` über der Navigationsleiste, mit
  `env(safe-area-inset-*)` und ohne Tastenfang, solange nichts darin steht.
- Testseitig: `web/src/testing/pwaRegister.ts` als Ersatz für
  `virtual:pwa-register/react` (per Alias in `vitest.config.ts`, denn das Plugin
  gehört nicht in den Testlauf) und `web/src/testing/online.ts`, das
  `navigator.onLine` beantwortbar macht; beides räumt `setup.ts` selbst auf.
- 372 Tests grün (12 neue); `lint`, `typecheck`, `format:check` und `build`
  fehlerfrei.

**Real geprüft** (Chromium bei 390×844, gebauter Stand hinter `vite preview`
gegen die laufende API, hell und dunkel – 35 Prüfungen, alle bestanden)

- Manifest und iOS-Metatags am ausgelieferten Dokument, alle fünf Icon-Dateien
  mit `200` und richtigem Content-Type.
- Der Service Worker übernimmt schon beim ersten Besuch; im Cache liegen
  App-Shell, JS und CSS, **kein** `.wasm` und **keine** `/api/`-Antwort.
- Offline neu geladen: die App startet aus dem Cache und zeigt „Keine
  Verbindung“ statt der Fehlerseite des Browsers; „Erneut versuchen“ bringt sie
  zurück. Der Streifen erscheint und verschwindet mit der Verbindung.
- Der ganze Aktualisierungsweg mit zwei echten Bauständen: neue Version wird
  ohne Neuladen gemeldet, wartet dabei nachweislich (`registration.waiting`),
  „Später“ legt die Frage weg, beim nächsten Start ist sie wieder da, „Jetzt neu
  laden“ macht die neue Version aktiv – und die Anmeldung überlebt das.
- Scanner mit Kamera-Attrappe: das WebAssembly wird trotz Service Worker sauber
  aus dem Netz nachgeladen.

**Dabei gefundene Fehler**

| Fund | Ursache | Behebung |
|---|---|---|
| Kein Service Worker übernahm die Seite beim ersten Besuch | `registerType: 'prompt'` setzt weder `skipWaiting` noch `clientsClaim`; die erste Installation wartete damit bis zum nächsten Start der App | `clientsClaim: true` – das betrifft nur den ersten Worker, spätere warten weiterhin auf die Zustimmung |

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Aktualisierung | `prompt` statt `autoUpdate` | Ein Neuladen mitten im Anlegen eines Produkts wirft das Formular weg; die Übernahme ist eine Entscheidung des Nutzers |
| Suche nach neuen Versionen | Stündlich und bei jedem Wechsel in den Vordergrund | Eine App auf dem iOS-Home-Bildschirm wird nie wirklich geschlossen; ohne eigenes Nachfragen bliebe sie tagelang auf dem alten Bundle |
| Erste Installation | `clientsClaim`, aber kein `skipWaiting` | Offline-Fähigkeit ab dem ersten Besuch, ohne dass eine spätere Version ungefragt übernimmt |
| API im Cache | Gar keine `runtimeCaching`-Regel | Ein veraltetes `GET /auth/me` zeigt das falsche Konto; Fotos sind `Cache-Control: private`. Was sich lohnt, hält TanStack Query im Speicher |
| WebAssembly des Decoders | Nicht vorgehalten | Ein Megabyte für den Fall, dass jemand offline scannt – wobei die EAN offline ohnehin nicht nachgeschlagen werden kann |
| Offline-Hinweis | Eigene Ansicht statt einer statischen `offline.html` | Der Fallback lädt die echte App; eine zweite HTML-Datei wäre eine zweite Oberfläche mit eigenem Aussehen und eigener Sprache |
| `navigator.onLine` | Nur zum Erklären, nie zum Entscheiden | Der Wert sagt „es gibt ein Netz“, nicht „der Server ist erreichbar“; eine Anfrage zu unterdrücken wäre falsch, eine fehlgeschlagene zu deuten ist richtig |
| Statusleiste unter iOS | `default` statt `black-translucent` | `black-translucent` erzwingt weiße Symbole, die auf der hellen Kopfzeile verschwinden |
| Icons | Zwei SVG-Quellen, PNG erzeugt und eingecheckt | Eine Änderung an der Marke betrifft eine Datei; der Produktionsbau bleibt frei von `sharp` |
| Ort der Hinweise | In `AppLayout`, nicht um den Router herum | Beide brauchen den Platz über der Navigationsleiste; auf der Anmeldemaske meldet sich ein offenes Gerät ohnehin über die scheiternde Anfrage |

**Nicht erledigt**

Der Punkt „auf einem echten iPhone prüfen“ bleibt offen – dafür braucht es ein
Gerät, das hier niemand hat. Alles, was ohne iPhone prüfbar war, ist geprüft;
was iOS eigen ist (Hinzufügen zum Home-Bildschirm, Safe-Area am echten Notch,
Kamera-Upload aus der Standalone-App, Sitzung nach einem Neustart des Telefons),
steht weiter in TODO.md. Dazu gehört auch die aus M8 stammende Frage nach der
Kamerawahl unter Safari.

---

## 2026-08-15 – M8: Frontend-Funktionen

**Umfang**

- `server/`: `GET /api/v1/products/categories` liefert die im Katalog
  verwendeten Kategorien als Vorschlagsliste. Sortiert wird in der Anwendung
  statt in SQL – `SELECT DISTINCT` ordnet in SQLite nur nach Spalten des eigenen
  Ergebnisses, und `localeCompare` bekommt die Umlaute richtig. Dazu bekommt der
  abgelehnte Upload „kein lesbares Bild“ nun `details.field`, damit die Oberfläche
  ihn vom falschen Format und von der Größengrenze unterscheiden kann.
- `web/src/lib/scanner.ts`: Kamera und Decoder. `zxing-wasm` statt
  `BarcodeDetector`, das WebAssembly-Modul aus dem eigenen Bundle statt vom CDN,
  geladen per dynamischem Import erst beim Start der Kamera. Gelesen werden
  EAN-13, EAN-8 und UPC-A; jeder Treffer läuft zusätzlich durch `normaliseEan()`.
  Kamerawahl mit Vorzug für die Rückseite, Torch-Schalter, sechs unterschiedene
  Fehlerfälle, Rückmeldung per Vibration und kurzem Ton.
- `web/src/lib/image.ts`: Verkleinerung auf 2048 Pixel vor dem Upload, mit
  Rückfall auf das Original, wenn der Browser das Format nicht dekodieren kann.
- `web/src/lib/api.ts`: Upload über `XMLHttpRequest` mit Fortschritt und
  Abbruch – `fetch` kann den Fortschritt eines Requestbodys nicht melden.
  Fehlerbehandlung und deutsche Meldung bleiben identisch zum übrigen Client.
- `web/src/lib/queries.ts`: Hooks für Produkte (inklusive Cursor-Pagination über
  `useInfiniteQuery`), Bewertungen, Fotos, Sitzungen, Einladungen und Konten.
- `web/src/lib/format.ts`: Datum, Durchschnitt, relative Zeit und die
  Verdichtung des User-Agent zu „iPhone · Safari“.
- Neue Komponenten: `BarcodeScanner`, `ProductForm`, `ProductCard`,
  `PhotoManager`, `RatingEditor`, `StarRating`, `LoadMore`, dazu `EmptyState`
  und Ladeskelette in `Feedback`, `TextAreaField`/`SelectField` in `Field`.
- Neue Ansichten: `/products/new`, `/products/:id`, `/admin`; ausgebaut wurden
  Katalog, Scanner, eigene Bewertungen und Einstellungen. Die Platzhalter aus M7
  sind damit verschwunden.
- 360 Tests grün (69 neue); `lint`, `typecheck`, `format:check` und `build`
  fehlerfrei. Bundle 402 kB (gzip 120 kB) plus 38 kB Decoder-Chunk und 1,1 MB
  WebAssembly, die erst beim Scannen geladen werden.
- Zusätzlich real geprüft: API und Vite-Dev-Server, Chromium bei 390×844 in hell
  und dunkel, 32 Prüfungen – Anmeldung mit Rücksprung, Prüfziffer, unbekannte
  EAN → Formular, Anlage → Produktseite, Bewertung speichern und nach dem
  Neuladen wiederfinden, Foto auswählen, Vorschau, Upload mit Fortschritt,
  Auslieferung über `/api/v1/media/`, Katalogsuche über die Marke, leerer
  Filterzustand, Kategorievorschlag, eigene Bewertungen, Sitzungsliste,
  Einladung erzeugen und Link kopieren, Kamerastart mit Fake-Device, dunkles
  Thema. Darunter die Probe, die jsdom nicht leisten kann: ein im Browser
  gezeichneter echter EAN-13 wird vom mitgelieferten WebAssembly gelesen.

**Dabei gefundene Fehler**

| Fund | Ursache | Behebung |
|---|---|---|
| „Gespeichert.“ erschien nach dem Bewerten nie | Der `RatingEditor` hing am `updatedAt` der Bewertung; jedes Speichern erzeugte einen neuen Key und hängte die Komponente samt ihrer Erfolgsmeldung neu ein | Key auf die Produkt-ID – die Route bleibt beim Wechsel der ID montiert, dagegen muss er schützen, nicht gegen das Speichern |
| Sitzungen zeigten „Linux · Safari“ für einen Chrome | Jeder Chrome trägt `Safari/` im User-Agent; `HeadlessChrome/` und `Chromium/` passten nicht auf `\bChrome/` und fielen deshalb auf Safari durch | Wortgrenze vor `Chrome` entfernt |
| Foto-Kacheln waren ein paar Pixel hoch | `width`/`height` am `<img>` sind Präsentationsattribute und setzen die CSS-Höhe – sie schlagen `aspect-ratio` | Attribute entfernt; die Kachel ist ohnehin in CSS festgelegt |

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Decoder | `zxing-wasm`, Modul im eigenen Bundle | iOS Safari hat kein `BarcodeDetector`; ein CDN verbietet die Festlegung „kein ausgehender Netzverkehr im Betrieb“ |
| Ladezeitpunkt | Dynamischer Import beim Start der Kamera | Drei von vier Ansichten dekodieren nie; das gute Megabyte gehört nicht in den Start |
| Symbologien | EAN-13, EAN-8, UPC-A – kein UPC-E | UPC-E kommt als acht Ziffern an, die keine gültige EAN-8 sind; eine still falsch gespeicherte Nummer wäre schlimmer als ein nicht gelesener Code |
| Kamerastart | Nur auf Tastendruck | Kostet Akku und schaltet die Anzeigeleuchte ein; eine Ansicht, die das beim Betreten tut, wird gemieden |
| Eingabe von Hand | Gleichrangig auf demselben Schirm, nicht hinter einem Fehler | Es gibt Barcodes, die keine Kamera liest – zerknitterte Tüte, dunkler Keller, abgeschaltete Kamera |
| Suchbereich | Nur das mittlere Band des Bildes wird dekodiert | Entspricht dem Rahmen auf dem Schirm und ist ein Viertel der Arbeit je Versuch |
| Nach dem Scan | Eine Mutation statt einer Query | Der Scanner fragt genau einmal und will die Antwort in der Hand, um zu entscheiden, wohin er springt; `404` ist hier die normale Antwort |
| Sterne | Sechs echte Radios, verborgen hinter den Glyphen | Pfeiltasten, Tabstopp und Ansage kommen so vom Browser statt aus gepflegtem Code; 0 Sterne ist eine eigene Option, kein „nicht bewertet“ |
| Speichern der Bewertung | Erst auf Knopfdruck, nicht beim Tippen auf einen Stern | Ein Streifen über einen Stern beim Scrollen darf kein Urteil überschreiben |
| Verkleinern im Browser | Höflichkeit, keine Prüfung | Der Server kodiert ohnehin neu; scheitert die Dekodierung im Browser, geht das Original hoch – ein fehlgeschlagener Spareffekt darf nie das Foto kosten |
| Kategorien | Freitext mit `<datalist>` statt Auswahlliste | Ein Haushalt erfindet seine Kategorien selbst, soll aber nicht „Getränke“, „getraenke“ und „Getränk“ nebeneinander bekommen |
| Filterzustand | Zustand der Ansicht, nicht der Adresse | Niemand setzt ein Lesezeichen auf „Haferflocken, mindestens vier Sterne“; eine Adresse, die sich bei jedem Tastendruck ändert, füllt den Zurück-Knopf mit Suchbegriffen |
| Cache-Invalidierung | Grob: eine Bewertung verwirft alle Listen | Ein Durchschnitt ändert Sortierung und zwei Filter; die Buchführung für Genauigkeit kostet mehr als die gesparten Anfragen |
| Nachladen | Beobachter am Listenende **und** Schaltfläche | Scrollen ist eine Daumengeste; wer mit der Tastatur unterwegs ist, braucht etwas zum Drücken |
| Adminbereich | Aus den Einstellungen, nicht aus der Navigation | Wird benutzt, wenn jemand in den Haushalt kommt oder geht – ein paar Mal im Leben einer Installation |
| Einladung teilen | Link in die Zwischenablage, nicht der nackte Code | Der Link trägt den Code ins Formular; getippt wird er dann nirgends |

---

## 2026-08-15 – M7: Frontend-Grundgerüst

**Umfang**

- `web/src/lib/strings.ts`: sämtliche Oberflächentexte an einer Stelle, dazu
  `apiErrorText()` – die Übersetzung von Status, Fehlercode und `details` in
  einen deutschen Satz.
- `web/src/lib/api.ts`: typisierter Client für alle Routen von `/api/v1`
  (Auth, Sitzungen, Produkte, Bewertungen, Fotos, Einladungen, Konten),
  `ApiError` mit deutscher Meldung, `photos.url()` für `<img src>`.
- `web/src/lib/queries.ts`: Query-Client mit Cache-Zeiten und Wiederholungsregel,
  Schlüsselverzeichnis für alle Ressourcen, Hooks `useSession`, `useLogin`,
  `useRegister`, `useLogout`.
- `web/src/lib/forms.ts`: Zod-Issues zu einer deutschen Meldung je Feld.
- `web/src/components/`: `AppLayout` (Kopfzeile mit Konto und Abmelden),
  `BottomNav`, `RequireAuth`, `Field`, `Feedback` (Laden, Fehler, Platzhalter),
  `icons.tsx` (vier Inline-SVGs).
- `web/src/routes/`: `LoginPage`, `RegisterPage` sowie die Platzhalter
  `CataloguePage`, `ScanPage`, `RatingsPage`, `SettingsPage` und `NotFoundPage`.
- `web/src/styles/`: `theme.css` (Token-Satz hell und dunkel), `app.css`
  (Layout, Formulare, Navigation, Safe-Area).
- `vitest.config.ts` auf zwei Projekte umgestellt: `node` für `server/` und
  `shared/`, `web` mit jsdom, Testing Library und `web/src/testing/setup.ts`.
- Neue Abhängigkeiten: `react-router`, `@tanstack/react-query`; als
  Entwicklungsabhängigkeiten `jsdom`, `@testing-library/{react,dom,jest-dom,user-event}`.
  Damit ist auch der seit M0 offene Punkt „jsdom und Testing Library ergänzen“
  erledigt.
- 284 Tests grün (39 neue im Web-Projekt); `lint`, `typecheck`, `format:check`
  und `build` fehlerfrei (Bundle 350 kB, gzip 107 kB).
- Zusätzlich real geprüft: Vite-Dev-Server gegen die laufende API, Chromium bei
  390×844 in hell und dunkel, 19 Prüfungen – Weiterleitung von `/settings` zur
  Anmeldung und zurück, falsches Passwort, Rate-Limit-Text, Kopfzeile mit Konto,
  vier Navigationseinträge mit korrekt gesetztem `aria-current`, 44-px-Scan-Ziel,
  Sitzung übersteht das Neuladen, 404-Seite, Abmelden, Cookie-Flags
  (`HttpOnly`, `SameSite=Lax`), Einladungscode aus dem Link, Registrierung mit
  echtem Code sowie die Ablehnung eines verbrauchten Codes.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Styling | Eigenes CSS mit Custom Properties statt Tailwind | Eine Handvoll Ansichten rechtfertigt weder Build-Schritt noch Klassenvokabular; ein Token-Satz plus je ein Block für hell und dunkel hält jede Farbe an einer Stelle |
| Thema-Wechsel | Folgt der Systemeinstellung, kein Schalter in der App | Auf iOS gehört die Wahl zum Gerät; die PWA soll aussehen wie der Rest des Telefons |
| Routing | Deklarativ (`<Routes>`), keine Router-Loader | Die Daten kommen aus dem Query-Cache; Loader wären eine zweite Quelle für dieselbe Sache |
| Adressen | Englisch (`/scan`, `/ratings`, `/settings`) | Bezeichner sind laut Projektkonvention englisch, deutsch ist nur, was auf dem Bildschirm steht |
| Fehlerübersetzung | Nach Fehlercode und `details`, nie nach dem Text des Servers | Der Servertext ist englisch und für ein Log geschrieben; `details.field` sagt zusätzlich, an welchem Eingabefeld die Meldung steht |
| `401` | Wird zentral in die Sitzungsabfrage geschrieben | Eine abgelaufene Sitzung soll zur Anmeldemaske führen, nicht zu einem Schirm voller fehlschlagender Anfragen |
| `401` beim Login | Wird auf der Anmeldemaske eigens übersetzt | Dort heißt der Status „Passwort falsch“ und nicht „Sitzung abgelaufen“ – nur diese eine Ansicht kann beides unterscheiden |
| Sitzungsabfrage | `401` ergibt `null` statt eines Fehlers | „Niemand angemeldet“ ist eine normale Antwort; so verzweigen die Ansichten über Daten und nicht über Fehlerobjekte |
| Nicht erreichbarer Server | Führt zu Hinweis mit Wiederholung, nicht zur Anmeldemaske | Unerreichbar ist nicht abgemeldet; sonst verlöre man die Sitzung bei jedem Netzwerkaussetzer |
| Wiederholungen | Kein Retry bei 4xx, bis zu zwei bei Netzwerk- und 5xx-Fehlern | Eine abgelehnte Eingabe bleibt abgelehnt, eine abgerissene Verbindung kann sich erholen |
| Abmelden | Räumt die Sitzung lokal auch dann ab, wenn die Anfrage scheitert | Das Cookie kann bereits weg sein; jemanden vor einer Sitzung stehen zu lassen, die er loswerden wollte, wäre der schlechtere Ausgang |
| Abmelden-Ort | In der Kopfzeile statt nur auf der Einstellungsseite | Muss von überall gehen; bis M8 hätte es sonst gar keinen Platz |
| Platzhalterseiten | Alle Navigationsziele existieren schon als Ansicht | Eine Navigationsleiste mit toten Einträgen wäre schlechter als eine mit ehrlichen Platzhaltern |
| Einladungscode | Auch über `?invite=…` vorbelegbar | Macht eine Einladung als Link teilbar, statt sie abtippen zu lassen |
| Formularprüfung | Mit denselben Zod-Schemata wie auf dem Server, Meldungen aber aus `strings.ts` | Spart eine Runde zum Server; die englischen Zod-Texte sind für Entwickler geschrieben. Die Mindestlänge des Passworts steht in der Serverkonfiguration und kann nur dort geprüft werden |
| Tests der Oberfläche | Nur `fetch` wird ersetzt, Client und Query-Cache laufen echt | So deckt ein Test auch Envelope, Fehlerübersetzung und Cache-Voreinstellungen ab statt nur die Komponente |

---

## 2026-08-15 – M6: Fotos

**Umfang**

- `shared/src/schemas/photo.ts`: `PHOTO_FIELD` (Name des Multipart-Feldes),
  `PHOTO_SIZES`/`photoSizeSchema` und `mediaQuerySchema`. Neuer Typ
  `ProductDetail` in `shared/src/types.ts`.
- `server/src/services/photos.ts`: Verarbeitung mit `sharp`, Speicherlayout,
  atomares Schreiben, Ablage- und Löschlogik, Hauptbild und die
  Konsistenzprüfung `checkUploads()`.
- `server/src/routes/photos.ts`: `POST /products/:id/photos`,
  `DELETE /photos/:id`, `PUT /photos/:id/primary` und
  `GET /media/:id?size=thumb|full` inklusive `ETag`, `304`, `Range`/`206` und
  `416`.
- `server/src/app.ts`: `@fastify/multipart` mit `limits` aus der Konfiguration
  (eine Datei, `max_file_size_mb`), Registrierung der Fotorouten.
- `server/src/routes/products.ts`: Einzelabfragen liefern zusätzlich `photos`;
  das Löschen eines Produkts entfernt jetzt auch die Bilddateien.
- `server/src/fsck.ts` plus `npm run fsck`: `--uploads`, `--repair`, `--help`,
  Exit-Code 1 bei Befunden. Der richtige CLI-Rahmen folgt in M13.
- `server/src/testing/harness.ts`: Uploads und Temp liegen im Wegwerf-Verzeichnis
  der Testdatenbank.
- Neue Abhängigkeiten: `sharp` (0.35.x – 0.34.x hat eine offene
  libvips-Meldung) und `@fastify/multipart`.
- Keine Schemaänderung, also keine neue Migration – `photos` steht seit M2.
- 247 Tests grün (38 neue); `lint`, `typecheck`, `format:check` und `build`
  fehlerfrei. Zusätzlich real gegen eine laufende Instanz geprüft: Upload eines
  2400×1600-JPEG mit EXIF/GPS und Orientierung 6, als `image/heic` und
  `IMG_4711.HEIC` deklariert – gespeichert als WebP 1067×1600 ohne EXIF,
  Thumbnail 267×400; `ETag`/`304`, `Range` mit `206` und `416`, anonym `401`;
  abgelehnt wurden 3 MB bei Limit 2 MB, eine PHP-Datei mit `image/png`-Etikett
  und ein GIF; fremder Origin `403`; Hauptbildwechsel; Löschen von Foto und
  Produkt räumt Dateien und Verzeichnisse ab; `fsck` mit und ohne `--repair`.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Ausgabeformat | Immer WebP, das Original wird nicht aufbewahrt | Ein Format hält Speicherlayout und Cache-Header einfach; WebP versteht auch Safari auf iOS, HEIC dagegen kein Browser. Das Original aufzuheben würde Platz kosten und die EXIF-Daten wieder ins Haus holen |
| Typprüfung | Gegen das von `sharp` erkannte Format, nicht gegen die Angabe des Clients | Dateiname und MIME-Typ sind frei wählbar; geprüft wird, was in den Bytes steht |
| `failOn` | `'error'` statt der strengeren Voreinstellung | Fotos echter Telefone lösen regelmäßig Warnungen aus; ein abgelehntes gültiges Foto wäre der teurere Fehler |
| Speicherlayout | `<2 Zeichen der Produkt-ID>/<produkt-id>/<foto-id>.webp`, Thumbnail als `<foto-id>.thumb.webp` | Der Präfix verteilt einen sechsstelligen Katalog auf 256 Verzeichnisse; alles zu einem Produkt liegt beisammen und ist in einem Schritt entfernt |
| `photos.filename` | Enthält den relativen Pfad des Detailbilds, das Thumbnail wird daraus abgeleitet | Eine Spalte, eine Wahrheit; die Ableitungsregel steht an einer Stelle im Code |
| Atomares Schreiben | Über `paths.temp` plus `rename`, bei `EXDEV` Fallback auf Kopieren | `paths.temp` darf auf einem anderen Dateisystem liegen; ohne Fallback wäre jeder Upload dort ein Fehlschlag |
| Reihenfolge beim Anlegen | Erst die Dateien, dann die Zeile; scheitert das Einfügen, werden die Dateien zurückgenommen | Eine Datei ohne Zeile ist Müll, den `fsck` findet – eine Zeile ohne Datei wäre ein kaputtes Bild in der App |
| Reihenfolge beim Löschen | Erst die Zeile, dann die Dateien | Umgekehrt wäre bei einer scheiternden Transaktion das Bild weg und der Datensatz da |
| Hauptbild | Eigenschaft des Produkts, nicht des Kontos; das erste Foto wird es automatisch | Die Kachel zeigt genau ein Bild. Beim Löschen rückt das älteste verbliebene nach, statt einen Nachfolger zu markieren – die Produktabfrage tut das ohnehin schon |
| Eigentum | Löschen und Hauptbildwechsel nur für Eigentümer und Administratoren, Hochladen für jedes Konto | Der Katalog ist gemeinsam, das Foto nicht |
| Medienzugriff | Jedes angemeldete Konto darf jedes Bild lesen | Der Katalog ist gemeinsam; eine Produktkachel ohne Bild wäre sinnlos. Geschützt ist der Weg dorthin, nicht das einzelne Bild |
| Caching | `ETag` ist die Foto-ID plus Größe, `max-age` ein Jahr, `immutable`, `private` | Der Inhalt hinter einer ID ändert sich nie – ein neues Foto ist eine neue ID. `private`, weil es eine Sitzung gebraucht hat |
| `Range` | Nur ein einzelner `bytes=`-Bereich, mehrere werden als ganze Datei beantwortet | Erlaubt nach RFC 9110 und für Bilder völlig ausreichend; `multipart/byteranges` wäre Aufwand ohne Nutzen |
| `ProductDetail.photos` | Fotoliste nur in der Einzelabfrage, die Liste behält `primaryPhotoId` | Ohne Liste wären weitere Fotos weder zu löschen noch zum Hauptbild zu machen; in der Katalogliste wäre sie eine Abfrage je Produkt für ein Bild, das niemand sieht |
| `fsck` | Meldet in beide Richtungen, löscht nur mit `--repair` | Eine verwaiste Datei kostet Platz, eine zu Unrecht gelöschte ein Foto. Fehlende Dateien bleiben auch nach einem Repair ein Befund – dagegen hilft nur ein Backup |
| `sharp`-Version | 0.35.x statt 0.34.x | Für 0.34.x ist eine libvips-Meldung offen (`npm audit`, hoch) |

**Offen**

- Ein Rate-Limit für Uploads fehlt; README nennt es unter „Härtung“, umgesetzt
  ist bisher nur das Login-Limit. Als Punkt in M6 vermerkt.
- Mehrere Fotos je Produkt sind technisch möglich (das Datenmodell kann es, die
  Routen auch), die Oberfläche in M8 zeigt zunächst nur das Hauptbild. Sortierung
  mehrerer Fotos bleibt im Backlog.
- Docker und Debian-Paket brauchen `sharp` je Architektur – als bekannter
  Fallstrick in CLAUDE.md vermerkt, umzusetzen in M10/M11.

---

## 2026-08-15 – M5: Bewertungen

**Umfang**

- `shared/src/schemas/rating.ts`: `upsertRatingSchema` (ganze Zahl 0–5,
  optionaler Kommentar bis 1000 Zeichen) und `myRatingsQuerySchema` mit
  Sortierung, Seitengröße und Cursor. Neue Typen `RatedProduct` und
  `RatingListPage` in `shared/src/types.ts`.
- `shared/src/rating.ts`: `roundAverageStars()` und `toRatingSummary()`, damit
  Produkt- und Bewertungsdienst denselben gerundeten Durchschnitt ausgeben.
- `shared/src/schemas/sort.ts`: `SORT_ORDERS` als eine Quelle für die
  Sortierrichtung; `PRODUCT_SORT_ORDERS` verweist darauf.
- `server/src/services/pagination.ts`: Keyset-Pagination aus M4 herausgelöst –
  Cursor kodieren, dekodieren, Vergleichsbedingung, Standardrichtung. Produkt-
  und Bewertungsliste teilen sich jetzt eine Implementierung.
- `server/src/services/ratings.ts`: Upsert, Löschen, Zusammenfassung je Produkt
  und die Liste der eigenen Bewertungen.
- `server/src/routes/ratings.ts`: die drei Routen aus dem Meilenstein, alle
  hinter `requireUser`.
- `server/src/db/testing.ts`: `SeedRating` nimmt Zeitstempel entgegen, damit
  Sortier- und Seitentests nicht von der Ausführungsgeschwindigkeit abhängen.
- Keine Schemaänderung, also keine neue Migration – `ratings` steht seit M2
  inklusive `UNIQUE (product_id, user_id)` und `CHECK (stars between 0 and 5)`.
- 209 Tests grün (22 neue); `lint`, `typecheck`, `format:check` fehlerfrei.
  Zusätzlich real gegen eine laufende Instanz geprüft: Anlegen mit `201`,
  Ersetzen mit `200` bei gleichbleibendem `created_at`, geleerter Kommentar,
  abgelehnte Werte 6 und 2,5, unbekanntes Produkt, fremder Origin, zweites
  Konto über Einladung, Durchschnitt 2,5 aus 0 und 5 Sternen, Löschen der
  eigenen Bewertung ohne Wirkung auf die fremde, zweites Löschen mit `404`,
  `ratings/mine` und ein Cursor aus anderer Sortierung.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Adressierung | `PUT/DELETE /products/:id/rating` statt einer eigenen Bewertungs-ID | Die Bewertung ist durch Produkt und Konto eindeutig; eine fremde Bewertung lässt sich so gar nicht ansprechen, statt sie nachträglich abzuweisen |
| Upsert | Ein `insert … on conflict do update`, danach Rücklesen | Zwei Geräte, die gleichzeitig speichern, würden sonst am eindeutigen Index scheitern; gelesen wird zurück, weil auf dem Konfliktweg ID und `created_at` der vorhandenen Zeile gelten |
| Statuscode | `201` beim ersten Urteil, `200` beim Ersetzen | Ein `PUT` ist wiederholbar; der Unterschied sagt der Oberfläche, ob eine Bewertung neu entstanden ist |
| Kommentar | `PUT` ersetzt die Bewertung ganz, ein fehlender Kommentar löscht den alten | Sonst wäre dieselbe Anfrage nicht wiederholbar und ein Kommentar nie zu entfernen |
| Null Sterne | Gültiger Wert, „nicht bewertet“ ist das Fehlen der Zeile | Null ist ein Urteil; das war schon im Datenmodell so festgelegt |
| Antwort beim Schreiben | Zusätzlich Durchschnitt und Anzahl des Produkts | Die Detailseite aktualisiert die Zusammenfassung ohne zweite Anfrage |
| Aggregation | Korrelierte Unterabfragen bleiben, kein `GROUP BY`-Join | Sie laufen über `ratings_product_user_unique` (führende Spalte `product_id`); ein gruppierter Join müsste die ganze Tabelle zusammenzählen, auch beim Nachschlagen eines einzelnen Produkts nach dem Scan |
| Eigene Liste | Eigene Route statt nur `products?ratedByMe=true` | Nur hier lässt sich nach eigener Sternzahl und Bewertungsdatum sortieren; die Einträge behalten die Produktform, damit die Oberfläche dieselbe Kachel verwenden kann |
| `total` der eigenen Liste | Direkt aus `ratings` gezählt | Die Liste kennt keine Filter, der Zähler nutzt `ratings_user_id_idx` |
| Pagination | Gemeinsames Modul für Katalog und Bewertungen | Zwei Kopien derselben Cursor-Logik wären zwei Stellen, an denen ein Sortierwechsel unbemerkt Zeilen überspringt |

**Offen**

- Die API zeigt weiterhin nur Durchschnitt, Anzahl und die eigene Bewertung.
  Wer im Haushalt was vergeben hat, ist bewusst nicht sichtbar; als
  Backlog-Punkt vermerkt.
- Für „Meine Bewertungen“ fehlt die Oberfläche; als Punkt in M8 vermerkt.

---

## 2026-08-14 – M4: Produkt-API

**Umfang**

- `shared/src/ean.ts`: Prüfziffernrechnung und Normalisierung. Akzeptiert
  werden EAN-13, EAN-8 und UPC-A; gespeichert wird immer die auf dreizehn
  Stellen aufgefüllte Form.
- `shared/src/schemas/product.ts`: `eanSchema` (validiert und normalisiert in
  einem Schritt), `createProductSchema`, `updateProductSchema` und
  `productListQuerySchema` inklusive Typkonvertierung für Query-Parameter.
  Neuer Typ `ProductListPage` in `shared/src/types.ts`.
- `server/src/services/products.ts`: Anlegen mit Duplikatserkennung, Lesen aus
  Sicht des Aufrufers (eigene Bewertung, Durchschnitt, Anzahl, Primärfoto),
  Liste mit Suche, Filtern, Sortierung und Cursor-Pagination, Ändern und
  Löschen.
- `server/src/routes/products.ts`: die sechs Routen aus dem Meilenstein, alle
  hinter `requireUser`, `DELETE` hinter `requireAdmin`.
- `server/src/db/client.ts`: SQL-Funktion `pr_lower()` für die Suche.
  `NotFoundError` nimmt jetzt wie die übrigen Dienstfehler `details` entgegen.
- Keine Schemaänderung, also keine neue Migration – die Tabellen stehen seit M2.
- 187 Tests grün (45 neue); `lint`, `typecheck`, `format:check` fehlerfrei.
  Zusätzlich real gegen eine laufende Instanz geprüft: Anlegen als UPC-A,
  Ablehnen desselben Artikels in der EAN-13-Schreibweise mit `409` und
  Produkt-ID, abgewiesene Prüfziffer, Nachschlagen über beide Schreibweisen,
  Suche nach „kölln“ auf „Kölln“, zwei Seiten über den Cursor, Cursor mit
  gewechselter Sortierung abgelehnt, EAN-Präfixsuche, `PATCH` und `DELETE`.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| EAN-Form | Alles wird auf dreizehn Stellen aufgefüllt gespeichert | EAN-8, UPC-A und EAN-13 sind dieselbe GTIN; die Prüfziffer wird von rechts berechnet und übersteht das Auffüllen, `products.ean UNIQUE` bleibt damit aussagekräftig |
| Belegte EAN | `409` mit `details.productId` statt einer nackten Fehlermeldung | Nach dem Scan will die Oberfläche zum vorhandenen Produkt springen, nicht eine Fehlermeldung zeigen |
| Volltextsuche | `LIKE` über Name und Marke, keine FTS5-Tabelle | Bei sechsstelligen Produktzahlen und wenigen Nutzern reicht der Durchlauf; FTS5 kostet Tabelle, Trigger und kann Teilwörter nicht ohne Weiteres |
| Groß-/Kleinschreibung | Eigene SQL-Funktion `pr_lower()` mit `String.toLowerCase()` | SQLites `lower()` faltet nur ASCII – „Müller“ wäre sonst nicht über „müller“ zu finden |
| EAN in der Suche | Ziffernfolgen ab vier Stellen als Präfix, nicht als Teilzeichenkette | Ein Präfix nutzt den Index auf `ean`, eine Teilzeichenkette würde die Tabelle durchlaufen |
| Pagination | Keyset über (Sortierwert, ID) statt `OFFSET` | Ein währenddessen angelegtes Produkt verschiebt sonst die folgenden Seiten; die ID bricht Gleichstände auf |
| Cursor | Trägt die Sortierung mit sich; ein Wechsel ergibt `400` | Ein weitergereichter Cursor aus einer anderen Sortierung würde Produkte überspringen oder doppeln |
| Unbewertete Produkte | Zählen als `-1` beim Sortieren und erreichen kein `minStars` | Sonst stünden sie beim Sortieren nach Bewertung vor den schlecht bewerteten |
| Ändern | Jedes Konto darf jedes Produkt ändern | Der Katalog ist ausdrücklich gemeinsam; Eigentum gilt für Bewertungen und Fotos |
| Löschen | Nur Administratoren | Es nimmt fremde Bewertungen und Fotos mit |
| Durchschnitt | Auf zwei Nachkommastellen gerundet ausgegeben | Mehr Stellen sagen bei fünf Sternen nichts aus; der Cursor rechnet intern weiter mit dem vollen Wert |

**Offen**

- `deleteProduct()` gibt die betroffenen Fotozeilen zurück, löscht aber keine
  Dateien – das Speicherlayout entsteht erst in M6, wo der Punkt vermerkt ist.
- Die Aggregation je Produkt läuft über korrelierte Unterabfragen. Das ist bei
  der angepeilten Größe unauffällig; falls die Liste später spürbar langsam
  wird, ist eine Materialisierung der Durchschnitte der nächste Schritt.
- Die Kategorievorschläge des Produktformulars brauchen noch eine eigene Route;
  als Punkt in M8 vermerkt.

---

## 2026-08-14 – M3: Authentifizierung und Nutzer

**Umfang**

- `server/src/services/`: `passwords.ts` (argon2id über `@node-rs/argon2`,
  Parameter aus `[auth]`, `needsRehash()`), `sessions.ts` (Erstellen, Finden,
  rollierendes Verlängern, Auflisten, Widerrufen, Aufräumen), `users.ts`
  (Anlegen, Suchen, Rolle und Zustand ändern, Passwort setzen), `invites.ts`
  (Erzeugen, Auflisten, Zurückziehen, Einlösen), `bootstrap.ts` (erster Admin
  aus der Umgebung), `rateLimit.ts` (Fenster von einer Minute je Schlüssel),
  `errors.ts` (`ServiceError` mit Statuscode und Fehlercode).
- `server/src/plugins/`: `auth.ts` (Cookie-Ausgabe, `onRequest`-Hook,
  `requireUser`/`requireAdmin`, täglicher Aufräumlauf), `csrf.ts`
  (Origin-/Referer-Prüfung), `errorHandler.ts` (einheitliches Fehlerformat,
  Zod-Fehler als `400`).
- `server/src/routes/`: `auth.ts` (login, logout, me, register, password,
  sessions), `invites.ts`, `users.ts` – alle Eingaben serverseitig mit den
  neuen Zod-Schemata aus `shared/src/schemas/auth.ts` geprüft.
- Konfiguration erweitert: `server.trusted_origins`, `auth.argon2_time_cost`,
  `auth.argon2_parallelism`, `auth.min_password_length` – jeweils in Schema,
  `config.example.toml` und README-Tabelle.
- `config/file.ts`: `config/config.toml` wird zusätzlich in übergeordneten
  Verzeichnissen gesucht. npm startet Workspace-Skripte im Workspace, `npm run
  dev` und `npm run migrate` liefen deshalb bisher gegen die Standardpfade
  statt gegen die Entwicklungskonfiguration.
- 141 Tests grün; `lint`, `typecheck`, `format:check` und `build` fehlerfrei.
  Zusätzlich real geprüft: Bootstrap-Admin beim ersten Start, Anmeldung mit
  richtigem und falschem Passwort, Rate-Limit ab dem sechsten Fehlversuch,
  Einladung erzeugen, Registrierung damit, zweite Registrierung mit demselben
  Code abgelehnt, Adminroute für einen normalen Nutzer gesperrt, schreibende
  Anfrage mit fremder Herkunft abgewiesen.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| argon2-Bibliothek | `@node-rs/argon2` statt `argon2` | Vorgebaute Binaries für amd64 und arm64, kein `node-gyp` beim Paketbau |
| Session-Speicherung | Cookie trägt 32 Zufallsbytes, gespeichert wird nur deren SHA-256-Abdruck | Aus einem Datenbank-Leck lässt sich kein benutzbares Cookie gewinnen; Widerruf bleibt ein `DELETE` |
| Cookie-Signatur | Zusätzlich mit dem Secret aus `auth.secret_file` signiert | Manipulierte Cookies werden erkannt, bevor die Datenbank gefragt wird; das Secret bekommt damit seine Aufgabe |
| `Secure`-Flag | Wird gesetzt, sobald `base_url` mit `https://` beginnt | Über reines HTTP verwirft der Browser ein `Secure`-Cookie kommentarlos – die lokale Entwicklung wäre ohne erkennbaren Grund kaputt |
| CSRF | Origin-/Referer-Prüfung statt Token, zusätzlich zu `SameSite=Lax` | Kein Token-Umlauf nötig; `server.trusted_origins` deckt den Vite-Dev-Server ab |
| Rate-Limit | Prozesslokal, zwei Schlüssel (IP und Benutzername), Fenster von einer Minute | Einzelprozess mit wenigen Nutzern; ein gemeinsamer Speicher wäre Aufwand ohne Nutzen |
| Fehlermeldung beim Login | Unbekannter Nutzer, falsches Passwort und deaktiviertes Konto antworten gleich | Sonst wird die Route zur Auskunft darüber, wer hier ein Konto hat |
| Benutzernamen | Klein geschrieben gespeichert, per CHECK-Constraint abgesichert | „Anna“ und „anna“ können nie beide existieren, ohne Ausdrucksindex |
| Einladungscodes | Klartext in der Datenbank, kurzlebig und einmalig | Ein Admin muss den Code erneut lesen können, um ihn weiterzugeben |
| Registrierung | Konto anlegen und Code einlösen in einer Transaktion, Hashing davor | SQLite-Transaktionen sind synchron, argon2 ist es nicht; so bleibt beides unteilbar |
| Konten löschen | Gibt es nicht, nur deaktivieren; Sessions verfallen dabei | Bewertungen und Fotos behalten einen gültigen Eigentümer |
| Letzter Administrator | Kann weder herabgestuft noch deaktiviert werden | Sonst ist die Instanz nur noch über die Datenbank zu retten |
| Passwortwechsel | Verwirft alle anderen Sessions, behält die eigene | Erwartetes Verhalten nach einem verlorenen Gerät, ohne den Nutzer selbst hinauszuwerfen |

**Offen**

- Der Aufräumlauf für abgelaufene Sessions hängt an einem `setInterval` im
  Serverprozess. Für den Betrieb reicht das; ein CLI-Befehl kommt mit M13.
- Das Rate-Limit zählt im Prozessspeicher und beginnt nach einem Neustart von
  vorn. Bei einem Prozess je Instanz ist das kein Verlust.
- `POST /api/v1/users` legt Konten ohne Einladung an – bewusst, damit ein Admin
  nicht den Umweg über einen Code gehen muss.

---

## 2026-08-14 – M2: Datenbank und Migrationen

**Umfang**

- `server/src/db/`: `schema.ts` (alle sechs Tabellen mit Indizes,
  Fremdschlüsseln und CHECK-Constraints), `client.ts` (`openDatabase()` mit
  WAL, `foreign_keys = ON`, `busy_timeout`, `synchronous = NORMAL`),
  `migrate.ts` (Runner mit Snapshot), `testing.ts` (Wegwerf-Datenbank je Test
  plus Seed-Funktion), `index.ts` als Barrel.
- `drizzle.config.ts` und die erste eingecheckte Migration
  `src/db/migrations/0000_initial_schema.sql`.
- Neue Skripte `npm run migrate` (eigener Einstiegspunkt `src/migrate.ts`, für
  Container-Entrypoint und `postinst`) und `npm run db:generate`. `tsup` kopiert
  die Migrationen nach `dist/migrations`, weil der Runner sie zur Laufzeit
  liest.
- Der Serverstart führt Migrationen aus, bevor die erste Abfrage läuft.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Zeitstempel | `integer` mit Unix-Millisekunden, in TypeScript `Date` | Günstig zu vergleichen und zu indizieren, ohne SQLite-Datumsfunktionen; die API gibt weiterhin ISO-8601 aus |
| Identifikatoren | UUIDv4 als `text` | Erlaubt das Erzeugen im Anwendungscode und macht Zusammenführungen von Datenbeständen möglich |
| Standardwerte | Im Anwendungscode (`$defaultFn`) statt als SQL-Default | Ein Ort für die Regel; alle Schreibzugriffe laufen ohnehin über Drizzle |
| Snapshot | `VACUUM INTO` vor jeder Migration einer bestehenden Datenbank | Im WAL-Modus ist das Kopieren der `.db` nicht konsistent; ein Fehlschlag bricht die Migration ab |
| Fremdschlüssel | `ratings`/`photos` kaskadieren mit dem Produkt, `products.created_by` ist `restrict` | Ein gelöschtes Produkt nimmt seine Bewertungen mit, ein Konto lässt sich nicht unter einem Produkt wegziehen |
| Testdatenbank | Datei in einem temporären Verzeichnis statt `:memory:` | Prüft WAL, `busy_timeout` und den Migrationsweg so, wie sie im Betrieb laufen |

**Offen**

- Die Snapshots landen neben der Datenbank und werden nicht aufgeräumt; eine
  Aufbewahrungsgrenze gehört zum Backup-Thema in M13.
- `product-rating migrate` als Unterbefehl der CLI kommt mit M13; bis dahin ist
  `npm run migrate` beziehungsweise `node dist/migrate.js` der Weg.

---

## 2026-08-14 – M1: Konfiguration

**Umfang**

- `server/src/config/` als eigenständiges Modul: `schema.ts` (Zod-Schema mit
  allen Standardwerten), `file.ts` (Suchreihenfolge und TOML-Einlesen über
  `smol-toml`), `env.ts` (`PR_<SEKTION>__<SCHLÜSSEL>`), `cli.ts` (`--config`,
  `--set`, Kurzformen), `values.ts` (Typkonvertierung und Zusammenführung),
  `load.ts` (Vorrangkette und Pfadauflösung), `checks.ts` (Startprüfungen),
  `errors.ts` (`ConfigError` mit mehrzeiliger Ausgabe).
- Vorrangkette Standardwerte < Datei < Umgebungsvariablen < CLI, mit Tests je
  Stufe belegt.
- Startprüfungen: Verzeichnisse für Datenbank, Uploads, Temp und – bei
  `log.destination = "file"` – für das Log werden angelegt beziehungsweise
  bemängelt; `auth.secret_file` muss existieren, Rechte `0600` haben und
  mindestens 32 Zeichen enthalten.
- `config/config.example.toml` mit allen Schlüsseln und Kommentaren; ein Test
  lädt die Datei und vergleicht sie mit den Standardwerten, damit Beispiel und
  Schema nicht auseinanderlaufen.
- `README.md`: Abschnitt 6 um Schlüsseltabellen je Sektion, die Regeln für
  Umgebungsvariablen und CLI-Argumente, die Startprüfungen und eine Anleitung
  für die lokale Entwicklungskonfiguration ergänzt.
- `server/src/index.ts` liest nichts mehr aus `process.env`, sondern lädt die
  Konfiguration, führt die Startprüfungen aus und bricht bei Fehlern mit einer
  benannten Meldung und Exit-Code 1 ab. `buildApp()` bekommt die geprüfte
  Konfiguration und stellt sie als `app.config` bereit.
- 53 Tests grün; `lint`, `typecheck`, `format:check` und `build` fehlerfrei. Der
  Start wurde real gegen eine lokale `config/config.toml` geprüft (Konfiguration
  geladen, Verzeichnisse angelegt, `/healthz` erreichbar) sowie in den
  Fehlerfällen fehlendes Secret, zu offene Rechte, ungültiger Wert und
  unbekannter Schlüssel.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Typkonvertierung | Werte aus Env und CLI werden gegen das Schlüssel-Schema probiert (Zeichenkette → Zahl → Wahrheitswert → kommagetrennte Liste) | Keine zweite Tabelle mit Typen, die zum Schema synchron gehalten werden müsste |
| Unbekannte Schlüssel | `strictObject`; Tippfehler in Datei, Env oder CLI brechen den Start ab | Ein stillschweigend ignorierter Schlüssel ist im Betrieb kaum zu finden |
| Relative Pfade | Werden gegen das Verzeichnis der Konfigurationsdatei aufgelöst, ohne Datei gegen das Arbeitsverzeichnis | Eine Konfiguration bleibt damit samt Datenverzeichnis verschiebbar |
| Session-Secret | Eigene Datei, entweder nur das Secret oder eine Zeile `PRODUCT_RATING_SECRET=…`, Rechte `0600`, mindestens 32 Zeichen | Passt zu `secret.env` aus `postinst` und Container-Entrypoint, ohne ein bestimmtes Format zu erzwingen |
| `app.external_lookup` | Schlüssel existiert, `true` wird beim Start abgelehnt | Festgelegte Entscheidung: kein ausgehender Netzwerkverkehr, solange es keine Implementierung gibt |
| Wertegrenzen | Zahlen mit Ober- und Untergrenzen, Querbezüge geprüft (`session_renew_threshold_days < session_ttl_days`, `thumbnail_px < detail_px`) | Fängt Zahlendreher ab, bevor sie im Betrieb auffallen |
| CLI-Argumente | Nur konfigurationsbezogene Argumente werden gelesen, alles andere ignoriert | Die eigentliche CLI mit Unterbefehlen kommt in M13 |

**Offen**

- `log.format` und `log.destination` werden validiert, aber noch nicht
  angewendet; wirksam ist bislang nur `log.level` (neuer Punkt in M13).
- Die Entwicklungskonfiguration `config/config.toml` und ein lokales
  `config/secret.env` müssen von Hand angelegt werden; beides ist über
  `.gitignore` ausgeschlossen und in der README beschrieben.
- Docker-Entrypoint und `postinst` müssen das Secret erzeugen – bereits als
  Punkte in M10 und M11 vorgemerkt.

---

## 2026-08-14 – M0: Projektgerüst

**Umfang**

- npm-Workspaces `shared`, `server`, `web` mit gemeinsamer TypeScript-Basis
  (`tsconfig.base.json`, `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- Toolchain: ESLint 10 (Flat Config, typescript-eslint), Prettier, Vitest 4,
  `concurrently`. Skripte `dev`, `build`, `start`, `test`, `lint`, `typecheck`,
  `format` im Wurzelverzeichnis.
- `shared/`: erste Domänentypen (`User`, `Product`, `Rating`, `Photo`,
  `ProductWithRatings`), Sterngrenzen und `isValidStars()`.
- `server/`: Fastify-Instanz als Factory (`buildApp()`), `/healthz`, sauberes
  Herunterfahren bei `SIGINT`/`SIGTERM`, Entwicklung über `tsx watch`, Build
  über `tsup` nach `dist/index.js`.
- `web/`: Vite-React-Gerüst mit Platzhalter-App, Alias `@` auf `src`,
  Dev-Proxy `/api` auf `127.0.0.1:8080`.
- Rauchtests je Workspace: 8 Tests, alle grün. `lint`, `typecheck`,
  `format:check` und `build` laufen fehlerfrei; der gebaute Server und beide
  Dev-Server wurden gegen `/healthz` geprüft.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| TypeScript-Version | `~5.9.3` statt des aktuellen 7.0.2 | `typescript-eslint@8.67` erlaubt nur `>=4.8.4 <6.1.0`; Upgrade als TODO vermerkt |
| Shared-Paket | Liefert TypeScript-Quellen statt eines Build-Artefakts | Keine Build-Reihenfolge nötig; `tsup` bündelt es in den Server, Vite in das Frontend |
| Server-Build | `tsup` (esbuild) statt `tsc` | Ein einzelnes Bundle vereinfacht später das Debian-Paket und das Container-Image |
| Testaufbau | Eine Vitest-Konfiguration im Wurzelverzeichnis für alle Workspaces | Weniger Konfigurationsdateien; `jsdom` kommt erst, wenn es Komponenten zu testen gibt |
| Prettier | `*.md` ausgenommen | Die deutschen Dokumente enthalten von Hand gesetzte Tabellen |
| Fastify-Optionen | `bodyLimit` vorerst 1 MB | Wird mit dem Foto-Upload in M6 auf den Konfigurationswert gehoben |

**Offen**

- Lizenz weiterhin nicht festgelegt.
- `PR_SERVER__*` wird im Server derzeit direkt aus `process.env` gelesen; das
  ersetzt M1 durch den Konfigurationslader.

---

## 2026-08-14 – Konzept und Projektdokumentation

**Umfang**

- Konzept für die Anwendung erarbeitet und mit dem Projektinhaber abgestimmt.
- `README.md` mit Architektur, Datenmodell, Zugriffs- und Sicherheitskonzept,
  Nutzerverwaltung, Konfigurationsformat und beiden Deployment-Wegen geschrieben.
- `CLAUDE.md` mit den festgelegten Entscheidungen, der Repository-Struktur,
  verbindlichen technischen Regeln und der Arbeitsweise angelegt.
- `TODO.md` mit feingliedrigem Umsetzungsplan (Meilensteine M0 bis M14 plus
  Backlog) angelegt.
- `HISTORY.md` angelegt.
- `.gitignore` ergänzt, inklusive Ausschluss von `.claude/`.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Sprache/Stack | TypeScript durchgängig: Node.js 22 + Fastify, React + Vite | Eine Sprache im Repo, gute PWA- und Barcode-Toolchain |
| Datenbank | SQLite (WAL) über Drizzle ORM + better-sqlite3 | Keine zweite Instanz nötig, einfaches Backup, Schema bleibt portabel |
| Produktkatalog | Gemeinsam, `products.ean` eindeutig; Bewertungen je Nutzer | Vermeidet Dubletten, ermöglicht Durchschnittswerte |
| Nutzerkonten | Mehrbenutzer mit Einladungscodes, kein offener Zugang; erster Admin per ENV oder CLI | Selbst-Hosting im kleinen Kreis, keine Missbrauchsfläche |
| Sitzungen | Serverseitige Sessions mit Cookie, 90 Tage rollierend | PWA soll nicht bei jedem Start nach Login fragen; sofortiger Widerruf möglich |
| Externe Produktdaten | Keine Anbindung (Open Food Facts verworfen) | Ausdrücklicher Wunsch: reiner Offline-Betrieb ohne ausgehenden Verkehr |
| Fotospeicher | Dateisystem statt BLOB, serverseitiges Re-Encoding mit `sharp` | Kleine DB-Backups, HTTP-Caching, EXIF- und GPS-Daten werden entfernt |
| Barcode-Erkennung | `zxing-wasm` statt `BarcodeDetector` | iOS Safari stellt die native API nicht bereit |
| Deployment | Docker **und** Debian-Paket, gleichrangig gepflegt | Wunsch des Projektinhabers; deckt Container- und klassische Serverumgebungen ab |
| Fremdkonfigurationen | Vorgefertigte Beispiele für nginx, Apache 2.4, Caddy, Traefik, systemd, logrotate, ufw und Backup | Erspart bei der Installation das Zusammensuchen von Proxy-Details |
| Konfigurationsformat | TOML unter `/etc/product-rating/config.toml`, überschreibbar per `PR_*`-Umgebungsvariablen | Kommentierbar, gut von Hand pflegbar, als Debian-`conffile` geeignet |
| Konfigurierbare Pfade | `paths.database`, `paths.uploads`, `paths.temp` frei wählbar | Ausdrücklicher Wunsch: Ablage von Bildern und Datenbank frei bestimmbar |
| Dokumentationssprache | Dokumente Deutsch, Code und Commits Englisch | Projektinhaber arbeitet auf Deutsch, Code bleibt konventionell |

**Offen / bewusst verschoben**

- Lizenz noch nicht festgelegt (siehe TODO M0).
- Entscheidung zwischen SQLite-FTS5 und indiziertem `LIKE` für die Suche steht
  noch aus (siehe TODO M4).
- Styling-Ansatz im Frontend (eigenes CSS oder Tailwind) noch offen (siehe TODO M7).
- Noch kein Anwendungscode geschrieben; der Umsetzungsstart erfolgt mit M0.
