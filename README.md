# product-rating

Selbst-hostbare Web-App zum Erfassen und Bewerten von Produkten: EAN scannen oder
eingeben, Foto hinterlegen, 0–5 Sterne vergeben. Die App läuft als PWA und lässt
sich unter iOS zum Home-Bildschirm hinzufügen.

> **Status:** Konzeptphase. Dieses Dokument beschreibt die geplante Architektur.
> Der Umsetzungsstand steht in [TODO.md](TODO.md) und [HISTORY.md](HISTORY.md).

---

## 1. Funktionsumfang

**MVP**

- Anmeldung mit Benutzername und Passwort (Session-Cookie)
- EAN per Kamera scannen (EAN-13, EAN-8, UPC-A) oder manuell eingeben
- Produkt anlegen und bearbeiten: Name, Marke, Kategorie, Notizen
- Ein Foto pro Produkt aufnehmen oder hochladen
- Bewertung von 0 bis 5 Sternen, optional mit Kommentar
- Produktliste mit Suche (Name, Marke, EAN) und Filter/Sortierung nach Bewertung
- Installierbar als PWA auf dem iOS-Home-Bildschirm

**Später** (siehe [TODO.md](TODO.md), Abschnitt Backlog)

- Mehrere Fotos pro Produkt, Tags, Papierkorb
- CSV-/JSON-Export, Statistiken
- Offline-Erfassung mit Sync-Queue

---

## 2. Architektur

Eine containerisierbare Anwendung: REST-API und ausgeliefertes Frontend in einem
Prozess, Daten in SQLite, Fotos als Dateien auf der Platte.

```
[iOS Safari / Home-Bildschirm-PWA]
        │ HTTPS
[Reverse Proxy: nginx | Apache | Caddy  – TLS-Terminierung]
        │ HTTP (127.0.0.1:8080)
[product-rating: Fastify-API + statisches Frontend]
        ├── <paths.database>   SQLite (WAL-Modus)
        └── <paths.uploads>    Detailbilder + Thumbnails (WebP)
```

Beide Speicherorte sind frei konfigurierbar (siehe Abschnitt 6).

Die Oberfläche liefert der Server selbst aus, sobald `server.static_dir` auf das
gebaute Bundle zeigt (Container: `/app/web`, Debian-Paket:
`/opt/product-rating/web`). Damit sieht der Browser eine einzige Herkunft –
genau das, worauf Session-Cookie und Origin-Prüfung aufbauen –, und der Reverse
Proxy braucht nur eine `proxy_pass`-Regel statt eines zweiten Wurzelverzeichnisses.
Dateien unter `/assets/` tragen einen Inhalts-Hash im Namen und werden mit
`immutable` für ein Jahr ausgeliefert, alles andere – `index.html`, `sw.js`,
Manifest, Icons – mit `no-cache`, damit eine neue Version wirklich ankommt. Bleibt
`static_dir` leer, ist die Anwendung reine API; so läuft die Entwicklung, wo der
Vite-Server die Oberfläche ausliefert.

### Technologie-Entscheidungen

| Ebene          | Wahl                                    | Begründung |
|----------------|-----------------------------------------|------------|
| Backend        | Node.js 22 LTS + TypeScript + Fastify   | Eine Sprache im ganzen Repo, kleiner Footprint |
| DB-Zugriff     | Drizzle ORM + better-sqlite3            | Typsichere Queries, versionierte SQL-Migrationen, offener Weg zu PostgreSQL |
| Datenbank      | SQLite im WAL-Modus                     | Keine zweite Instanz nötig, Backup = Datei kopieren, ausreichend für Einzelplatz-/Haushaltsbetrieb |
| Frontend       | React + Vite + TypeScript               | Standard-Toolchain, gute PWA-Integration |
| Routing        | React Router (deklarativ)               | Reicht für eine Handvoll Ansichten; Daten kommen aus dem Query-Cache, nicht aus Router-Loadern |
| Serverstatus   | TanStack Query                          | Cache, Nachladen und Fehlerzustände an einer Stelle statt in jeder Ansicht von Hand |
| Styling        | Eigenes CSS mit Custom Properties       | Ein Token-Satz plus je ein Block für hell und dunkel ist weniger Ballast als ein Framework samt Klassenvokabular |
| PWA            | `vite-plugin-pwa` (Workbox)             | Manifest und Service Worker aus einer Quelle |
| Barcode        | `zxing-wasm` im Browser                 | iOS Safari bietet **keine** `BarcodeDetector`-API; WASM-Decoder ist der verlässliche Weg |
| Bildverarbeitung | `sharp`                               | Re-Encoding, EXIF-Entfernung (inkl. GPS), Thumbnails |
| Passwort-Hash  | argon2id                                | Aktueller Standard |
| Konfiguration  | TOML-Datei + Umgebungsvariablen         | Kommentierbar, gut von Hand pflegbar, gut als Debian-`conffile` geeignet |

### 2.1 Aufbau der Weboberfläche

Die Oberfläche ist für ein Telefon in einer Hand gebaut: Navigation unten,
Scannen als hervorgehobene mittlere Schaltfläche, alle Bedienelemente
mindestens 44 Pixel hoch, Ränder über `env(safe-area-inset-*)`.

| Adresse | Ansicht |
|---|---|
| `/` | Katalog – Produktliste mit Suche, Filtern und Thumbnails |
| `/scan` | Scanner, primäre Aktion; darunter die Eingabe von Hand |
| `/products/new?ean=…` | Anlegeformular mit vorbelegter EAN |
| `/products/:id` | Produkt: Foto, Durchschnitt, eigene Bewertung, Bearbeiten, Löschen |
| `/ratings` | Eigene Bewertungen |
| `/settings` | Konto, Passwort, eigene Sitzungen, Abmelden |
| `/admin` | Nutzer und Einladungen (nur Administratoren) |
| `/login`, `/register` | Anmeldung und Registrierung mit Einladungscode |

Die Adressen sind wie der übrige Code englisch; deutsch ist ausschließlich, was
auf dem Bildschirm steht. Sämtliche Oberflächentexte liegen in
`web/src/lib/strings.ts`, damit eine spätere Übersetzung eine Datei betrifft und
nicht dreißig Komponenten.

**Anmeldung.** `RequireAuth` liegt vor allen Ansichten hinter dem Login und
unterscheidet drei Fälle: solange die Sitzung geprüft wird, wartet der Schirm;
ist der Server nicht erreichbar, erscheint ein Hinweis mit Wiederholung –
Unerreichbarkeit ist kein Abmelden; nur ein eindeutiges „niemand angemeldet“
führt zur Anmeldemaske, zusammen mit der ursprünglich gewünschten Adresse, zu
der es nach dem Anmelden zurückgeht. Der zweite Fall zerfällt seit dem Service
Worker noch einmal: weiß das Gerät selbst, dass es offline ist, steht dort die
Offline-Erklärung statt „der Server meldet einen Fehler“.

**Fehlerbehandlung.** Der API-Client (`web/src/lib/api.ts`) ist die einzige
Stelle, die HTTP kennt. Jede fehlgeschlagene Anfrage – auch eine abgerissene
Verbindung – wird zu einem `ApiError`, dessen Meldung bereits der deutsche Satz
für die Oberfläche ist; die englische Serverantwort bleibt für die Konsole
daneben erhalten. Übersetzt wird nicht der Text des Servers, sondern sein
Fehlercode samt `details`: `field` zeigt an, an welchem Eingabefeld die Meldung
steht, und Angaben wie die Mindestlänge eines Passworts oder die Wartezeit nach
zu vielen Anmeldeversuchen wandern in den Satz. Ein `401` an beliebiger Stelle
schreibt der Query-Cache in die Sitzungsabfrage – damit landet die Nutzerin auf
der Anmeldemaske statt vor einem Schirm voller fehlschlagender Anfragen.

**Zwischenspeicher.** Die Cache-Zeiten stehen gesammelt in
`web/src/lib/queries.ts`: fünf Minuten für die Sitzung, dreißig Sekunden für den
gemeinsamen Katalog (jemand anderes im Haushalt kann etwas geändert haben), eine
Minute für die eigenen Bewertungen. Eine wegen falscher Eingabe abgelehnte
Anfrage wird nicht wiederholt, eine abgerissene Verbindung schon.

**Scanner.** `web/src/lib/scanner.ts` kapselt Kamera und Decoder. Gelesen werden
nur EAN-13, EAN-8 und UPC-A; UPC-E bleibt bewusst außen vor, weil es als acht
Ziffern ankommt, die *keine* gültige EAN-8 sind. Das WebAssembly-Modul liegt im
eigenen Bundle und wird niemals von einem CDN geladen – die App macht im Betrieb
keine ausgehenden Anfragen. Geladen wird es erst beim Start der Kamera
(dynamischer Import, eigener Chunk), damit die übrigen Ansichten das gute
Megabyte nicht mitbezahlen. Jeder gelesene Code läuft anschließend noch durch
`normaliseEan()`: der Katalog speichert ausschließlich, was die eigene
Prüfung akzeptiert.

Die Kamera startet nicht von selbst, sondern auf Tastendruck – sie kostet Akku
und schaltet die Anzeigeleuchte des Telefons ein. Jeder Grund, aus dem sie
ausfällt, hat einen eigenen Satz: fehlendes HTTPS, verweigerte Berechtigung,
keine Kamera, Kamera belegt. Die Eingabe von Hand steht immer daneben, nicht
erst hinter einem Fehler.

**Fotos.** Vor dem Upload verkleinert der Browser das Bild auf 2048 Pixel
Kantenlänge (`web/src/lib/image.ts`) – ein iPhone-Foto von vier Megabyte über
eine Mobilverbindung zu schicken, damit der Server neun Zehntel davon wegwirft,
ist Wartezeit für nichts. Das ist eine Höflichkeit, keine Prüfung: kann der
Browser das Format nicht dekodieren (HEIC außerhalb von Safari), geht das
Original hoch und `sharp` erledigt es. Der Fortschrittsbalken braucht
`XMLHttpRequest`; `fetch` kann den Fortschritt eines Requestbodys nicht melden.

### 2.2 PWA: Installation, Offline-Verhalten und Aktualisierung

Manifest und Service Worker erzeugt `vite-plugin-pwa` (Workbox) aus der
Konfiguration in `web/vite.config.ts`. Die App meldet sich als
`display: standalone`, deutschsprachig, im Hochformat.

**Icons.** Handgepflegt sind nur zwei SVG-Dateien in `web/public/`: `icon.svg`
mit abgerundeten Ecken für alles, was das Symbol unverändert anzeigt, und
`icon-maskable.svg` randlos und kleiner gezeichnet, weil Android und iOS ihre
eigene Form daraus schneiden – sichtbar bleibt garantiert nur der innere Kreis
mit 80 % Durchmesser. Alles Übrige entsteht daraus mit `npm run icons`
(`web/scripts/generate-icons.ts`, rendert mit `sharp`): 192 und 512 Pixel je
Variante sowie das `apple-touch-icon` mit 180 Pixeln. Die PNG-Dateien liegen im
Repository, damit ein Produktionsbau ohne das native Modul auskommt.

**iOS.** Vom Manifest liest iOS beim Hinzufügen zum Home-Bildschirm nichts:
Standalone-Modus, Name unter dem Symbol und Symbol selbst kommen aus den
`apple-*`-Metatags in `web/index.html`. Für die Statusleiste steht dort
`default` und nicht `black-translucent` – letzteres erzwingt weiße Symbole, die
auf der hellen Kopfzeile verschwinden. Die Farbe der Leiste kommt aus
`theme-color`, das zweimal mit `media`-Abfrage gesetzt ist, weil das Manifest
nur eine Farbe kennt. `viewport-fit=cover` und `env(safe-area-inset-*)` sorgen
dafür, dass die untere Navigationsleiste nicht unter dem Home-Indikator liegt.
`format-detection: telephone=no` verhindert, dass Safari eine 13-stellige EAN in
einen Telefonlink verwandelt.

**Was gecacht wird – und was nicht.** Vorgehalten wird die App-Shell: HTML, JS,
CSS, Icons, Manifest, zusammen knapp 500 kB. Bewusst **nicht** dabei:

- **`/api/v1/…`** – überhaupt keine `runtimeCaching`-Regel. Ein veralteter
  Katalog wäre lästig, ein veraltetes `GET /auth/me` würde das falsche Konto
  anzeigen, und Fotos kommen über eine authentifizierte Route mit
  `Cache-Control: private`. Was sich zu behalten lohnt, hält TanStack Query im
  Speicher.
- **Das WebAssembly des Decoders** (gut ein Megabyte) – es wird erst beim Start
  der Kamera geholt, und offline nützt ein gelesener Barcode ohnehin nichts,
  weil die EAN im Katalog nachgeschlagen werden muss.

Jede Adresse der App wird offline aus der zwischengespeicherten `index.html`
beantwortet (`navigateFallback`), `/api/` ausdrücklich nicht – eine Anfrage, die
den Server erreichen muss, soll als Anfrage scheitern und nicht HTML bekommen.
Damit startet die App ohne Netz, statt die Fehlerseite des Browsers zu zeigen;
sie erklärt dann selbst, was fehlt: ein Streifen über der Navigation, solange
nur nichts gespeichert werden kann, und ein ganzer Schirm, wenn gar nichts
geladen werden konnte.

**Aktualisierung.** `registerType: 'prompt'`: eine neue Version übernimmt nicht
von selbst, sondern wartet und meldet sich sichtbar („Neue Version verfügbar“,
`web/src/components/UpdatePrompt.tsx`). Zwei Gründe – ein Neuladen mitten im
Anlegen eines Produkts wirft das Formular weg, und auf dem iOS-Home-Bildschirm
wird eine App nie wirklich geschlossen, weshalb der Browser von sich aus tagelang
nicht nach einer neuen Version fragen würde. Genau dagegen fragt die App
zusätzlich selbst: stündlich und jedes Mal, wenn sie in den Vordergrund kommt.
Nur der erste Service Worker übernimmt sofort (`clientsClaim`), damit die App
schon nach dem ersten Besuch einen Verbindungsabbruch übersteht.

**Für den Reverse Proxy heißt das:** `sw.js` und `index.html` dürfen nicht mit
langer Lebensdauer zwischengespeichert werden – sonst bleiben Geräte auf einem
alten Bundle stehen. Die Dateien unter `/assets/` tragen einen Hash im Namen und
dürfen dauerhaft gecacht werden. Die Anwendung setzt beide Header seit M10
selbst; die Beispielkonfigurationen (Abschnitt 7.3) reichen sie deshalb nur
durch und setzen bewusst keine eigenen Cache-Regeln.

---

## 3. Datenmodell

Produkte bilden einen **gemeinsamen Katalog** (eine EAN existiert genau einmal),
Bewertungen und Fotos gehören jeweils einem Nutzer.

```
users     (id, username, email, password_hash, role, created_at, disabled_at)
sessions  (id, user_id, expires_at, user_agent, created_at, last_seen_at)
invites   (code, created_by, expires_at, used_by, used_at)
products  (id, ean UNIQUE, name, brand, category, notes,
           created_by, created_at, updated_at)
ratings   (id, product_id, user_id, stars 0..5, comment, created_at, updated_at)
           UNIQUE (product_id, user_id)
photos    (id, product_id, user_id, filename, mime, width, height,
           is_primary, created_at)
```

Fotos werden **nicht** als BLOB in der Datenbank abgelegt: das Dateisystem ist
schneller, hält DB-Backups klein und erlaubt HTTP-Caching und Range-Requests.

---

## 4. Zugriff und Sicherheit

- **API:** REST unter `/api/v1/*`, JSON. Kernrouten: `GET /products`,
  `GET /products/by-ean/:ean`, `POST /products`, `PATCH /products/:id`,
  `PUT /products/:id/rating`, `POST /products/:id/photos`,
  `GET /media/:id?size=thumb|full`.
- **Sessions:** serverseitig in SQLite, Cookie `HttpOnly`, `SameSite=Lax` und
  signiert mit dem Secret aus `auth.secret_file`. Das Cookie trägt 32 zufällige
  Bytes, gespeichert wird nur deren SHA-256-Abdruck – aus der Datenbank lässt
  sich also kein benutzbares Cookie gewinnen. `Secure` wird gesetzt, sobald
  `server.base_url` mit `https://` beginnt; über reines HTTP würde der Browser
  ein `Secure`-Cookie kommentarlos verwerfen. Laufzeit standardmäßig 90 Tage mit
  rollierender Verlängerung – wichtig, damit die Home-Bildschirm-PWA nicht bei
  jedem Öffnen nach dem Passwort fragt. Einzelne Sessions lassen sich
  serverseitig sofort widerrufen.
- **Fehlerformat:** jede Fehlerantwort ist
  `{"error": {"code": "...", "message": "...", "details": {...}}}`. Unerwartete
  Fehler werden protokolliert, aber nur als `internal_error` beantwortet.
- **Uploads:** `multipart/form-data`, Größenlimit und MIME-Whitelist aus der
  Konfiguration, serverseitiges Re-Encoding mit `sharp`. Das entfernt EXIF-Daten
  (inklusive GPS-Position) und entschärft manipulierte Bilddateien.
- **Medienzugriff** ausschließlich über eine authentifizierte Route mit
  Berechtigungsprüfung – keine erratbaren Direktlinks im Webroot.
- **Härtung:** Rate-Limit auf die Anmeldung (je Adresse und je Benutzername),
  CSRF-Schutz über `SameSite=Lax` plus Origin-Prüfung, `/healthz`-Endpunkt.
  Die Origin-Prüfung greift bei jeder schreibenden Anfrage, die ein
  Session-Cookie mitbringt: `Origin` beziehungsweise `Referer` muss zu
  `server.base_url` oder zu `server.trusted_origins` passen. Eine Anmeldung
  unter einem Namen, den es nicht gibt, kostet dieselbe argon2id-Prüfung wie
  eine echte – sonst verriete die Antwortzeit, wer hier ein Konto hat.
- **Grenzen:** JSON-Rumpf höchstens 1 MiB, je Upload eine Datei bis
  `uploads.max_file_size_mb`, und das Bild dahinter höchstens 100 Megapixel.
  Die Bytegrenze allein reicht nicht: ein einfarbiges PNG von einigen hundert
  Megapixeln passt in wenige Megabyte und würde beim Dekodieren den Speicher
  sprengen. Uploads haben bewusst **kein** Ratenlimit – wer hochladen darf, ist
  angemeldet und gehört zum Haushalt.
- **Härtungs-Header** setzt die Anwendung auf jeder Antwort selbst, für
  Oberfläche, API und Fehlerseiten gleichermaßen. Sie stehen an genau einer
  Stelle (`server/src/plugins/securityHeaders.ts`), damit Anwendung und Proxy
  nicht auseinanderlaufen:

  | Header | Wert | Warum |
  | --- | --- | --- |
  | `Content-Security-Policy` | `default-src 'self'` und die Ableitungen unten | Alles kommt aus dem eigenen Bundle |
  | `X-Content-Type-Options` | `nosniff` | Kein Raten am Content-Type vorbei |
  | `X-Frame-Options` | `DENY` | Dasselbe wie `frame-ancestors`, für ältere Browser |
  | `Referrer-Policy` | `same-origin` | Der eigene `Referer` bleibt – die Origin-Prüfung fällt darauf zurück |
  | `Permissions-Policy` | `camera=(self)`, Rest leer | Der Scanner braucht die Kamera, sonst nichts |
  | `Cross-Origin-Opener-Policy` | `same-origin` | Kein fremdes Fenster mit Zugriff |
  | `Cross-Origin-Resource-Policy` | `same-origin` | Fotos und Bundle sind nicht zum Einbetten da |

  In der Policy stehen neben `'self'` nur vier Zugeständnisse, jedes an einer
  Stelle der Oberfläche festgemacht: `'wasm-unsafe-eval'` im `script-src` für
  den WebAssembly-Decoder des Scanners (kein `eval()` von JavaScript),
  `blob:` im `img-src` für die Vorschau eines gerade aufgenommenen Fotos und im
  `media-src` für das Kamerabild, dazu `data:` im `img-src` für kleine
  Bilddateien, die der Bau in das Bundle einbettet. `'unsafe-inline'` kommt
  nirgends vor: der Bau erzeugt weder ein Inline-Skript noch einen Inline-Stil.
  `upgrade-insecure-requests` kommt dazu, sobald `server.base_url` mit `https://`
  beginnt.

  Nicht dabei ist `Strict-Transport-Security`. Der gehört dem, der TLS
  terminiert – die Anwendung dahinter spricht einfaches HTTP und kann nicht
  wissen, ob wirklich ein Zertifikat davorsteht. Die Proxy-Beispiele unter
  `packaging/examples/` setzen ihn deshalb, und sonst keinen.
- **Kein ausgehender Netzwerkverkehr.** Es gibt bewusst keine Anbindung an eine
  externe Produktdatenbank; alle Produktdaten werden lokal erfasst.

### 4.1 Routen zum Produktkatalog

Alle Routen setzen eine Anmeldung voraus. Der Katalog ist gemeinsam: jedes Konto
darf Produkte anlegen und korrigieren. Löschen bleibt Administratoren
vorbehalten, weil es fremde Bewertungen und Fotos mitnimmt.

| Route | Rolle | Zweck |
|---|---|---|
| `POST /api/v1/products` | angemeldet | Produkt anlegen; belegte EAN → `409` mit `details.productId` |
| `GET /api/v1/products` | angemeldet | Liste mit Suche, Filtern, Sortierung und Cursor-Pagination |
| `GET /api/v1/products/by-ean/:ean` | angemeldet | Nachschlagen nach dem Scan |
| `GET /api/v1/products/categories` | angemeldet | Bereits verwendete Kategorien als Vorschlagsliste |
| `GET /api/v1/products/:id` | angemeldet | Produkt inklusive eigener Bewertung, Durchschnitt und Anzahl |
| `PATCH /api/v1/products/:id` | angemeldet | Name, Marke, Kategorie oder Notizen ändern |
| `DELETE /api/v1/products/:id` | admin | Produkt samt Bewertungen und Fotos entfernen |

**EAN-Normalisierung.** Akzeptiert werden EAN-13, EAN-8 und UPC-A, jeweils mit
Prüfung der Prüfziffer. Gespeichert und nachgeschlagen wird immer die auf
dreizehn Stellen aufgefüllte Form – dieselbe Ware ergibt also unabhängig davon,
welches Symbol der Scanner gelesen hat, denselben Eintrag. Führende Nullen
ändern die Prüfziffer nicht, weil sie von rechts berechnet wird.

**Parameter der Liste** (`GET /api/v1/products`):

| Parameter | Werte | Bedeutung |
|---|---|---|
| `q` | Text | Sucht in Name und Marke, bei mindestens vier Ziffern zusätzlich als EAN-Präfix |
| `category` | Text | Genaue Kategorie, Groß- und Kleinschreibung egal |
| `minStars` | 0–5 | Nur Produkte, deren Durchschnitt diesen Wert erreicht; unbewertete fallen heraus |
| `ratedByMe` | `true`/`false` | Nur selbst bewertete Produkte |
| `sort` | `name`, `created`, `updated`, `rating` | Standard `updated` |
| `order` | `asc`, `desc` | Standard: `asc` bei `name`, sonst `desc` |
| `limit` | 1–100 | Standard 25 |
| `cursor` | Zeichenkette | `nextCursor` der vorherigen Seite |

Die Antwort ist `{ products, nextCursor, total }`. Der Cursor merkt sich die
Sortierung, mit der er entstanden ist; wird sie gewechselt, antwortet die Route
mit `400`, statt Produkte zu überspringen oder doppelt zu liefern.

**Suche.** Die Suche arbeitet mit `LIKE` über Name und Marke, nicht mit einer
FTS5-Tabelle: bei bis zu sechsstelligen Produktzahlen und wenigen Nutzern ist
der Tabellendurchlauf schnell genug, und FTS5 könnte weder Teilwörter noch die
Schreibweise mit Umlauten ohne zusätzliche Konfiguration. Groß- und
Kleinschreibung werden über die Anwendungsfunktion `pr_lower()` verglichen,
weil SQLites eingebautes `lower()` nur ASCII kennt und „Müller“ sonst nicht auf
„müller“ passen würde.

### 4.2 Routen zu Bewertungen

Eine Bewertung gehört immer dem angemeldeten Konto. Die Routen sprechen „meine
Bewertung dieses Produkts“ an – eine fremde Bewertung lässt sich darüber gar
nicht adressieren, Eigentum wird also nicht nachträglich geprüft.

| Route | Rolle | Zweck |
|---|---|---|
| `PUT /api/v1/products/:id/rating` | angemeldet | Eigene Bewertung anlegen oder ersetzen; `201` beim ersten Mal, danach `200` |
| `DELETE /api/v1/products/:id/rating` | angemeldet | Eigene Bewertung entfernen |
| `GET /api/v1/ratings/mine` | angemeldet | Eigene Bewertungen mit Sortierung und Cursor-Pagination |

**Körper von `PUT`:** `{ "stars": 0…5, "comment": "…" }`. `stars` ist eine ganze
Zahl; null Sterne sind ein bewusstes Urteil und keine fehlende Bewertung –
„nicht bewertet“ drückt sich dadurch aus, dass es keine Bewertung gibt. Der
Kommentar ist optional und höchstens 1000 Zeichen lang. `PUT` ersetzt die
Bewertung vollständig, ein weggelassener Kommentar löscht also einen früher
gespeicherten. Dieselbe Anfrage zweimal hinterlässt denselben einen Datensatz:
`created_at` bleibt beim ersten Urteil, `updated_at` wandert mit.

Beide schreibenden Routen liefern zusätzlich den neuen Stand des Produkts mit
(`{ "rating": …, "ratings": { "average": …, "count": … } }`), damit die
Detailseite die Zusammenfassung ohne zweite Anfrage aktualisieren kann.

**Parameter von `GET /api/v1/ratings/mine`:**

| Parameter | Werte | Bedeutung |
|---|---|---|
| `sort` | `rated`, `stars`, `name` | Standard `rated`, also wann zuletzt bewertet wurde |
| `order` | `asc`, `desc` | Standard: `asc` bei `name`, sonst `desc` |
| `limit` | 1–100 | Standard 25 |
| `cursor` | Zeichenkette | `nextCursor` der vorherigen Seite |

Die Antwort ist `{ ratings, nextCursor, total }`. Jeder Eintrag ist das ganze
Produkt samt eigener Bewertung und Gesamtdurchschnitt, sodass sich dieselbe
Kachel wie im Katalog verwenden lässt. Gegenüber
`GET /api/v1/products?ratedByMe=true` kann diese Route zusätzlich nach der
eigenen Sternzahl und dem Bewertungsdatum sortieren; der Cursor arbeitet wie
beim Katalog über (Sortierwert, ID).

**Aggregation.** Durchschnitt und Anzahl reisen als korrelierte Unterabfragen
mit der Produktzeile mit – eine Abfrage für die ganze Liste, kein Nachladen je
Produkt. Beide laufen über den Index `ratings_product_user_unique`, dessen
führende Spalte `product_id` ist, und lesen damit nur die Bewertungen des
jeweiligen Produkts. Ein `GROUP BY` über die gesamte Tabelle wäre in der Liste
gleich schnell, müsste aber auch dann alles zusammenzählen, wenn nur ein
einzelnes Produkt gefragt ist – und genau das ist die häufigste Anfrage nach
einem Scan.

### 4.3 Routen zu Fotos

Hochladen darf jedes angemeldete Konto – der Katalog ist gemeinsam. Ein Foto
gehört aber dem Konto, das es aufgenommen hat: Löschen und Zum-Hauptbild-Machen
bleiben ihm und den Administratoren vorbehalten.

| Route | Rolle | Zweck |
|---|---|---|
| `POST /api/v1/products/:id/photos` | angemeldet | Foto hochladen (`multipart/form-data`, Feld `photo`) |
| `DELETE /api/v1/photos/:id` | Eigentümer, admin | Foto samt Dateien entfernen |
| `PUT /api/v1/photos/:id/primary` | Eigentümer, admin | Foto zum Hauptbild des Produkts machen |
| `GET /api/v1/media/:id?size=thumb\|full` | angemeldet | Bild ausliefern; Standard `full` |

**Verarbeitung.** Weder der Dateiname noch der vom Client angegebene MIME-Typ
werden geglaubt; maßgeblich ist das Format, das `sharp` in den Bytes findet, und
nur das wird gegen `uploads.allowed_mime` geprüft. Jedes Bild wird neu kodiert –
das entfernt EXIF-Daten samt GPS-Position, wendet die Ausrichtung an, die ein
iPhone nur als Metadatum notiert, und macht aus einer präparierten Bilddatei
gewöhnliche Pixel. Geschrieben werden zwei Ableitungen, beide als **WebP**:
`full` mit der Kantenlänge `uploads.detail_px` und `thumb` mit
`uploads.thumbnail_px`. Das Original wird nicht aufbewahrt. Ein Format für alles
hält Speicherlayout und Cache-Header einfach, und WebP versteht jeder Browser,
auf den diese Anwendung zielt – anders als HEIC vom iPhone.

**Speicherlayout.** Unterhalb von `paths.uploads` liegen die Dateien als
`<zwei Zeichen der Produkt-ID>/<produkt-id>/<foto-id>.webp`, das Thumbnail
daneben als `<foto-id>.thumb.webp`. Der Präfix verteilt einen sechsstelligen
Katalog auf 256 Verzeichnisse, statt alles in eines zu legen. Dateinamen erzeugt
der Server; was der Client seine Datei genannt hat, erreicht die Platte nie.
Geschrieben wird über `paths.temp` und einen abschließenden `rename`, damit nie
eine halbe Datei sichtbar ist.

**Hauptbild.** Das erste Foto eines Produkts wird automatisch zum Hauptbild,
weitere nur auf ausdrückliche Anforderung. „Hauptbild“ ist eine Eigenschaft des
Produkts, nicht des Kontos, deshalb setzt `PUT …/primary` das Kennzeichen der
übrigen Fotos zurück. Wird das Hauptbild gelöscht, rückt das älteste verbliebene
Foto nach – ein Produkt verliert sein Bild also nicht.

**Auslieferung.** `GET /api/v1/media/:id` verlangt eine Sitzung wie jede andere
Route; es gibt bewusst kein statisches Verzeichnis im Webroot und keine
erratbaren Direktlinks. Jedes angemeldete Konto darf jedes Bild lesen, denn der
Katalog ist gemeinsam. Der Inhalt hinter einer ID ändert sich nie – ein neues
Foto ist eine neue ID –, deshalb ist das `ETag` die ID selbst, die Antwort trägt
`Cache-Control: private, max-age=31536000, immutable` und beantwortet ein
passendes `If-None-Match` mit `304`. `Range`-Anfragen werden unterstützt
(`206` mit `Content-Range`, `416` bei einem Bereich hinter dem Dateiende).

**Grenzen.** `uploads.max_file_size_mb` bricht den Upload ab, während er läuft;
die Datei wird also nicht erst vollständig in den Speicher gelesen. Das
Limit muss zum Reverse Proxy passen (`client_max_body_size` bei nginx,
`LimitRequestBody` bei Apache) – sonst lehnt der Proxy ab, bevor die Anwendung
antworten kann.

### TLS ist Pflicht, nicht optional

iOS gibt `getUserMedia` – und damit den Live-Kamera-Scanner – nur in einem
*secure context* frei. Ohne gültiges Zertifikat funktioniert im LAN nur der
Fallback über `<input type="file" capture="environment">` plus manuelle
EAN-Eingabe. Empfohlen ist deshalb eine eigene Subdomain mit einem
Let's-Encrypt-Zertifikat (DNS-Challenge funktioniert auch ohne offenen Port 80).

---

## 5. Nutzerverwaltung

- Keine offene Registrierung.
- Der **erste Start** legt aus `BOOTSTRAP_ADMIN_USER` und
  `BOOTSTRAP_ADMIN_PASSWORD` ein Administratorkonto an. Alternativ:
  `product-rating user add <name> --role admin` (8.1). Die Variablen wirken nur, solange die
  Instanz überhaupt kein Konto hat – ein vergessener Eintrag in einer
  Unit- oder Compose-Datei kann später also keinen Administrator nachschieben.
- Weitere Konten entstehen nur über **Einladungscodes**
  (`product-rating invite create`, oder in der Weboberfläche als Admin).
  Ein Code hat die Form `A1B2-C3D4-E5F6`, gilt `auth.invite_ttl_days` lang und
  ist genau einmal verwendbar.
- Benutzernamen werden klein geschrieben gespeichert; „Anna“ und „anna“ sind
  dasselbe Konto. Erlaubt sind Buchstaben, Ziffern, Punkt, Bindestrich und
  Unterstrich.
- Konten werden nie gelöscht, sondern deaktiviert – Bewertungen und Fotos
  behalten damit einen gültigen Eigentümer. Mit dem Deaktivieren verfallen alle
  Sessions des Kontos.
- Rollen: `admin` (Nutzerverwaltung, Einladungen, alle Daten) und `user`
  (eigene Bewertungen und Fotos, gemeinsamer Produktkatalog). Der letzte aktive
  Administrator kann weder herabgestuft noch deaktiviert werden.

### 5.1 Routen zu Konten und Sitzungen

| Route | Rolle | Zweck |
|---|---|---|
| `POST /api/v1/auth/login` | – | Anmelden, setzt das Session-Cookie |
| `POST /api/v1/auth/logout` | angemeldet | Aktuelle Sitzung widerrufen |
| `GET /api/v1/auth/me` | angemeldet | Eigenes Konto |
| `POST /api/v1/auth/register` | – | Konto mit gültigem Einladungscode anlegen |
| `POST /api/v1/auth/password` | angemeldet | Passwort ändern, verwirft die übrigen Sitzungen |
| `GET /api/v1/auth/sessions` | angemeldet | Eigene Sitzungen auflisten |
| `DELETE /api/v1/auth/sessions/:id` | angemeldet | Eine eigene Sitzung widerrufen |
| `DELETE /api/v1/auth/sessions` | angemeldet | Alle anderen eigenen Sitzungen widerrufen |
| `POST /api/v1/invites` | admin | Einladungscode erzeugen |
| `GET /api/v1/invites` | admin | Codes mit Status `open`/`used`/`expired` |
| `DELETE /api/v1/invites/:code` | admin | Unbenutzten Code zurückziehen |
| `GET /api/v1/users` | admin | Konten auflisten |
| `POST /api/v1/users` | admin | Konto ohne Einladung anlegen |
| `PATCH /api/v1/users/:id` | admin | Rolle, Zustand oder E-Mail ändern |
| `POST /api/v1/users/:id/password` | admin | Passwort zurücksetzen |
- Nachrüstbar: TOTP-2FA oder Delegation an ein Reverse-Proxy-SSO
  (Authelia/Authentik) über vertrauenswürdige Header.

---

## 6. Konfiguration

Die App liest eine TOML-Datei. Suchreihenfolge:

1. `--config <pfad>`
2. `$PRODUCT_RATING_CONFIG`
3. `/etc/product-rating/config.toml` (Debian-Paket)
4. `./config/config.toml` (Entwicklung)

Ein Pfad aus `--config` oder `$PRODUCT_RATING_CONFIG` muss existieren, sonst
bricht der Start ab. Die beiden festen Orte werden übersprungen, wenn dort
nichts liegt – die App startet also auch allein mit Standardwerten und
Umgebungsvariablen. `./config/config.toml` wird zusätzlich in bis zu vier
übergeordneten Verzeichnissen gesucht, weil npm Workspace-Skripte im jeweiligen
Workspace-Verzeichnis startet (`npm run dev` läuft in `server/`, die Datei liegt
eine Ebene darüber).

Vorrang der Quellen: **Standardwerte < Konfigurationsdatei < Umgebungsvariablen
< CLI-Argumente.** Jeder Schlüssel lässt sich per Umgebungsvariable
überschreiben, Schema `PR_<SEKTION>__<SCHLÜSSEL>`, zum Beispiel
`PR_PATHS__DATABASE=/srv/app.db`. Listen werden durch Kommas getrennt
(`PR_UPLOADS__ALLOWED_MIME=image/jpeg,image/png`), Wahrheitswerte als
`true`/`false` (auch `1`/`0`, `yes`/`no`, `on`/`off`). Auf der Kommandozeile gibt
es zusätzlich `--set <sektion>.<schlüssel>=<wert>` sowie die Kurzformen
`--host`, `--port`, `--base-url`, `--database`, `--uploads`, `--temp`,
`--log-level`, `--log-format` und `--log-destination`.

Unbekannte Sektionen und Schlüssel sind ein Fehler und keine stille Annahme:
ein Tippfehler in der Datei oder in einer `PR_*`-Variablen bricht den Start mit
einer benannten Meldung ab.

Vollständig kommentierte Vorlage: [`config/config.example.toml`](config/config.example.toml).
Alle dort eingetragenen Werte entsprechen den Standardwerten.

### 6.1 Schlüssel

**`[server]`**

| Schlüssel | Typ | Standard | Bedeutung |
|---|---|---|---|
| `host` | Zeichenkette | `127.0.0.1` | Adresse, an die gebunden wird |
| `port` | Zahl 1–65535 | `8080` | Port der HTTP-Schnittstelle |
| `base_url` | URL | `http://127.0.0.1:8080` | Öffentliche Adresse, für absolute Links und Cookies |
| `trust_proxy` | Wahrheitswert | `false` | `X-Forwarded-*` auswerten, nur hinter vertrauenswürdigem Proxy |
| `trusted_origins` | Liste von URLs | `[]` | Zusätzlich für schreibende Anfragen erlaubte Herkünfte; `base_url` gilt immer |
| `static_dir` | Pfad | `""` | Verzeichnis der gebauten Weboberfläche, relativ zur Konfigurationsdatei aufgelöst; leer heißt „nur API“ (Entwicklung) |

**`[paths]`** – relative Pfade werden gegen das Verzeichnis der
Konfigurationsdatei aufgelöst, ohne Datei gegen das Arbeitsverzeichnis.

| Schlüssel | Typ | Standard | Bedeutung |
|---|---|---|---|
| `database` | Pfad | `/var/lib/product-rating/db/app.db` | SQLite-Datenbank |
| `uploads` | Pfad | `/var/lib/product-rating/uploads` | Fotos und Thumbnails |
| `temp` | Pfad | `/var/lib/product-rating/tmp` | Zwischendateien beim Upload |

**`[uploads]`**

| Schlüssel | Typ | Standard | Bedeutung |
|---|---|---|---|
| `max_file_size_mb` | Zahl 1–512 | `15` | Größenlimit je Bild; Reverse Proxy muss dazu passen |
| `allowed_mime` | Liste | `["image/jpeg", "image/png", "image/webp", "image/heic"]` | Akzeptierte Bildtypen |
| `thumbnail_px` | Zahl 64–2048 | `400` | Kantenlänge des Thumbnails |
| `detail_px` | Zahl 256–8192 | `1600` | Kantenlänge des Detailbilds, muss größer als `thumbnail_px` sein |
| `strip_exif` | Wahrheitswert | `true` | EXIF-Daten inklusive GPS entfernen |

**`[auth]`**

| Schlüssel | Typ | Standard | Bedeutung |
|---|---|---|---|
| `secret_file` | Pfad | `/etc/product-rating/secret.env` | Datei mit dem Session-Secret, Rechte `0600` |
| `session_ttl_days` | Zahl 1–3650 | `90` | Laufzeit einer Sitzung |
| `session_renew_threshold_days` | Zahl 0–3650 | `7` | Ab dieser Restlaufzeit wird verlängert, muss kleiner als `session_ttl_days` sein |
| `invite_ttl_days` | Zahl 1–365 | `14` | Gültigkeit eines Einladungscodes |
| `login_rate_limit_per_minute` | Zahl 1–1000 | `5` | Fehlversuche je Minute, je IP und Benutzername |
| `argon2_memory_mib` | Zahl 8–4096 | `64` | Speicherbedarf des argon2id-Hashings |
| `argon2_time_cost` | Zahl 1–20 | `3` | Anzahl der argon2id-Durchläufe |
| `argon2_parallelism` | Zahl 1–16 | `1` | Anzahl der argon2id-Lanes |
| `min_password_length` | Zahl 8–256 | `10` | Kürzestes akzeptiertes Passwort |

**`[log]`**

| Schlüssel | Typ | Standard | Bedeutung |
|---|---|---|---|
| `level` | `error`\|`warn`\|`info`\|`debug` | `info` | Ausführlichkeit |
| `format` | `json`\|`pretty` | `json` | Ausgabeformat |
| `destination` | `stdout`\|`file`\|`syslog` | `stdout` | Ziel der Logausgabe |
| `file` | Pfad | `/var/log/product-rating/app.log` | Nur bei `destination = "file"` |

**`[app]`**

| Schlüssel | Typ | Standard | Bedeutung |
|---|---|---|---|
| `title` | Zeichenkette | `product-rating` | Anzeigename der Instanz |
| `external_lookup` | Wahrheitswert | `false` | Reserviert; `true` wird abgelehnt, solange es keine Implementierung gibt |

### 6.2 Startprüfungen

Die Speicherorte für Datenbank und Bilder sind frei wählbar – etwa auf einem
NAS-Mount oder einer separaten Platte. Beim Start prüft die App:

- `paths.database` (Verzeichnis), `paths.uploads`, `paths.temp` und bei
  `log.destination = "file"` auch das Logverzeichnis: fehlende Verzeichnisse
  werden angelegt, nicht beschreibbare führen zum Abbruch mit einer Liste aller
  Beanstandungen.
- `auth.secret_file`: vorhanden, keine Rechte für Gruppe und andere (`0600`),
  Inhalt mindestens 32 Zeichen. Andernfalls bricht der Start mit dem Befehl zum
  Erzeugen der Datei ab.
- `server.static_dir`, sofern gesetzt: vorhandenes Verzeichnis mit einer
  `index.html` darin. Angelegt wird es bewusst nicht – es stammt aus dem Bau,
  ein falscher Pfad ist also ein Fehler und kein fehlendes Verzeichnis.

Das Session-Secret steht **nicht** in der Konfigurationsdatei, sondern in einer
eigenen Datei mit Rechten `0600` (`secret_file`), die bei der Installation
beziehungsweise beim ersten Containerstart erzeugt wird. Die Datei enthält
entweder nur das Secret oder eine Zeile `PRODUCT_RATING_SECRET=…`:

```bash
sudo install -m 600 /dev/null /etc/product-rating/secret.env
openssl rand -hex 32 | sudo tee /etc/product-rating/secret.env > /dev/null
```

---

## 7. Deployment

Es gibt zwei gleichrangig gepflegte Wege: **Docker** und ein **Debian-Paket**.

### 7.1 Docker

```bash
git clone https://github.com/roemer2201/product-rating.git
cd product-rating/docker
PRODUCT_RATING_BASE_URL=https://produkte.example.org \
BOOTSTRAP_ADMIN_USER=admin BOOTSTRAP_ADMIN_PASSWORD=… \
  docker compose up -d --build
```

`PRODUCT_RATING_BASE_URL` muss die Adresse sein, unter der der Browser die App
aufruft – jede schreibende Anfrage wird dagegen geprüft. Ohne Angabe nimmt die
Compose-Datei `http://127.0.0.1:8080` an, was für einen Test auf demselben
Rechner reicht. Die beiden `BOOTSTRAP_ADMIN_*`-Variablen legen beim allerersten
Start das Administratorkonto an und können danach entfallen.

- **Image** mehrstufig gebaut (`docker/Dockerfile`): Bau-Stufe mit allen
  Abhängigkeiten, Laufzeitstufe nur mit `node_modules` ohne Entwicklungspakete,
  dem Server-Bundle samt Migrationen und der gebauten Oberfläche unter
  `/app/web`. Läuft als `node` (uid 1000), nicht als root.
- **Konfiguration:** Das Image bringt `docker/config.container.toml` als
  `/etc/product-rating/config.toml` mit. Einzelne Werte werden über
  `PR_<SEKTION>__<SCHLÜSSEL>` gesetzt; wer mehr ändern will, kopiert diese Datei,
  passt sie an und mountet sie schreibgeschützt an dieselbe Stelle.
- **Daten** im Volume `/data` mit `db/`, `uploads/`, `tmp/` und `secret.env`.
  Das Secret erzeugt der Entrypoint beim ersten Start mit Rechten `0600`,
  danach überlebt es jedes neue Image.
- **Entrypoint** (`docker/entrypoint.sh`): Verzeichnisse anlegen, Secret
  erzeugen, Migrationen ausführen, dann den Server als PID 1 starten – alles
  idempotent, ein Neustart wiederholt nur, was fehlt. `--help` erklärt die
  Schalter, `docker compose run --rm app --log-level debug` reicht Argumente an
  den Server durch.
- **`HEALTHCHECK`** auf `/healthz`, mit `start_period`, die den Migrationen Zeit
  lässt.
- **Reverse Proxy:** Die Compose-Datei veröffentlicht den Port nur auf
  `127.0.0.1`. Soll der Proxy ebenfalls im Container laufen, nimmt
  `docker/docker-compose.caddy.yml` samt `docker/Caddyfile.example` Caddy dazu
  und lässt es das Zertifikat selbst besorgen.

**Zwei Architekturen.** `better-sqlite3` und `sharp` enthalten native Module, das
Image wird deshalb je Architektur gebaut. Mit `buildx` in einem Durchgang:

```bash
docker buildx create --use --name product-rating   # einmalig
docker buildx build --platform linux/amd64,linux/arm64 \
  -f docker/Dockerfile -t <registry>/product-rating:<version> --push .
```

Der Build-Kontext ist das Wurzelverzeichnis des Repositories, nicht `docker/`.
Ohne `--push` behält buildx das Ergebnis im Cache; ein Multi-Arch-Image lässt
sich nicht in den lokalen Docker-Speicher laden. Für nur eine Architektur reicht
`docker build -f docker/Dockerfile -t product-rating .`. Der Bau für eine fremde
Architektur läuft über QEMU (`docker run --privileged --rm tonistiigi/binfmt
--install all`) und dauert entsprechend länger.

### 7.2 Debian-Paket

```bash
# Node.js 22 - weder Debian 13 noch Ubuntu 24.04 haben es im eigenen Archiv:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install nodejs

sudo apt install ./product-rating_<version>_<arch>.deb
sudoedit /etc/product-rating/config.toml      # vor allem server.base_url
sudo systemctl start product-rating
```

Die Abhängigkeit `nodejs (>= 22)` ist der einzige Punkt, an dem die
Installation eine fremde Paketquelle braucht. Wer NodeSource nicht einbinden
will, kann Node auch anders installieren – das Paket verlangt nur, dass
`node` in Version 22 oder neuer im `PATH` liegt.

Das `postinst` aktiviert den Dienst, startet ihn bei einer Neuinstallation aber
bewusst **nicht**: `server.base_url` muss der Adresse entsprechen, unter der der
Browser die App aufruft, und die kennt nur der Betreiber. Bei einem Upgrade wird
ein laufender Dienst neu gestartet, ein gestoppter bleibt gestoppt.

Installationslayout:

| Pfad | Inhalt |
|------|--------|
| `/opt/product-rating/` | Anwendungsbundle (`server/dist` samt Migrationen, `web/`, `node_modules`) |
| `/etc/product-rating/config.toml` | Konfiguration, als `conffile` registriert – Änderungen überleben Updates |
| `/etc/product-rating/secret.env` | Session-Secret, `0600`, im `postinst` erzeugt |
| `/var/lib/product-rating/{db,uploads,tmp}` | Nutzdaten, `0750`, Eigentümer `product-rating` |
| `/var/log/product-rating/` | Logs, sofern `log.destination = "file"` |
| `/usr/lib/systemd/system/product-rating.service` | Dienst, gehärtet (`ProtectSystem=strict`, `ReadWritePaths`, `NoNewPrivileges`, leeres `CapabilityBoundingSet`) |
| `/etc/logrotate.d/product-rating` | Logrotation, ebenfalls `conffile` |
| `/usr/bin/product-rating` | CLI (siehe 8.1) |
| `/usr/share/doc/product-rating/` | `copyright`, `changelog.gz`, `README.md.gz`, `config.example.toml`, `examples/` |

Das `postinst` legt den Systemnutzer `product-rating` an, erzeugt Verzeichnisse
und Secret, führt die Migrationen aus und meldet die Unit bei systemd an – alles
idempotent, ein Upgrade wiederholt nur, was fehlt. `remove` stoppt den Dienst
und lässt die Daten liegen. `purge` entfernt `/etc/product-rating` samt Secret
immer und fragt über debconf nach, ob auch Datenbank, Fotos und Logs weg dürfen;
ohne Antwort (`DEBIAN_FRONTEND=noninteractive`) gilt „nein“ und die Daten
bleiben. Vorbelegen lässt sich die Antwort mit:

```bash
echo 'product-rating product-rating/purge-data boolean true' | sudo debconf-set-selections
```

Die Unit setzt `MemoryDenyWriteExecute` bewusst **nicht**: die JavaScript-Engine
übersetzt zur Laufzeit in Maschinencode und braucht dafür Seiten, die
beschreibbar und ausführbar sind. Ein Port unter 1024 bräuchte zusätzlich
`AmbientCapabilities=CAP_NET_BIND_SERVICE` – dafür steht aber der Reverse Proxy
davor.

`/usr/bin/product-rating` ist ein dünner Aufsatz: Er beantwortet `version` aus
der Paketversion und übergibt alles andere unverändert an das Bundle. Die
Befehle selbst stehen in der Anwendung (8.1), damit Docker und Paket dieselben
haben.

**Paket bauen.** `npm run package:deb` baut beide Workspaces, stellt einen
Abhängigkeitsbaum nur aus Laufzeitpaketen zusammen, wirft die Binärdateien
fremder Plattformen heraus, legt den Baum unter `packaging/build/` an und ruft
`dpkg-deb` auf. Ist `lintian` installiert, wird das Ergebnis geprüft.
`--help` zeigt die Schalter, unter anderem `--version` und `--output`.

Weil `better-sqlite3`, `sharp` und `@node-rs/argon2` native Module enthalten,
wird das Paket je Architektur gebaut (`amd64`, `arm64`). Die Prebuilds stammen
vom Baurechner, deshalb lehnt das Skript ein `--arch` ab, das nicht zur eigenen
Architektur passt – für die andere wird auf ihr gebaut, notfalls im Container:

```bash
docker run --rm -v "${PWD}:/src" -w /src --platform linux/arm64 \
  node:22-bookworm bash -c 'apt-get update && apt-get install -y dpkg-dev \
    && npm run package:deb'
```

Abhängigkeiten des Pakets: `nodejs (>= 22)`, `adduser`, `init-system-helpers`,
`debconf` sowie die C-Bibliotheken, die `dpkg-shlibdeps` beim Bau aus den
nativen Modulen ermittelt (`libc6`, `libgcc-s1`, `libstdc++6`).

### 7.3 Mitgelieferte Konfigurationen für Fremdkomponenten

Unter `/usr/share/doc/product-rating/examples/` (im Repo: `packaging/examples/`,
mit einer eigenen [Übersicht](packaging/examples/README.md)):

- **nginx** – `nginx/product-rating.conf`: Vhost mit TLS, `proxy_pass` auf
  `127.0.0.1:8080`, `client_max_body_size` passend zum Upload-Limit,
  `X-Forwarded-*`-Header, HSTS, gzip. Dazu
  `nginx/product-rating-subpath.conf` für den Betrieb unter einem Unterpfad.
- **Apache 2.4** – `apache2/product-rating.conf`: Vhost mit `mod_proxy`,
  `ProxyPreserveHost On`, `RequestHeader set X-Forwarded-Proto https`,
  `AllowEncodedSlashes NoDecode` und Größenbegrenzung. Benötigt
  `a2enmod proxy proxy_http headers ssl deflate rewrite`.
- **Caddy** – `caddy/Caddyfile`: kürzeste Variante inklusive automatischem TLS.
- **Traefik** – `traefik/dynamic.yml` für den File-Provider sowie
  `traefik/docker-compose.labels.yml` mit denselben Einstellungen als Labels.
- **systemd** – `systemd/override.conf`: Drop-in-Vorlage für abweichende Pfade,
  Ports und Log-Stufe. Die Unit selbst gehört zum Paket und wird nicht
  bearbeitet, sondern mit `systemctl edit product-rating` überschrieben.
- **Backup** – `backup/product-rating-backup` (Skript: SQLite-Snapshot per
  `VACUUM INTO` plus Upload-Verzeichnis, Fotos gegen den Vorgänger hart
  verlinkt) mit `.service` und `.timer` für den täglichen Lauf.
- **ufw** – Applikationsprofil.

Die logrotate-Regel ist keine Vorlage, sondern Teil des Pakets
(`/etc/logrotate.d/product-rating`, als `conffile` registriert).

Keins der Beispiele setzt Cache- oder Härtungs-Header: beide setzt die
Anwendung selbst. Bei den Cache-Headern ist sie die einzige Stelle, die die
unveränderlichen Dateien unter `/assets/` von `index.html`, `sw.js` und dem
Manifest unterscheiden kann (Abschnitt 2.2); bei der Content-Security-Policy
ist sie die einzige Stelle, die ihr eigenes Bundle kennt (Abschnitt 4). Eine
eigene Regel im Proxy überschriebe das eine und verdoppelte das andere.
Ausgenommen ist `Strict-Transport-Security`, den die Beispiele setzen – nur die
TLS-Seite weiß, dass wirklich ein Zertifikat davorsteht.

**Betrieb unter einem Unterpfad.** Möglich, kostet aber einen eigenen Bau: der
Pfad steckt in `index.html`, im Manifest, im Service Worker und in der
API-Adresse des Bundles und lässt sich nachträglich nicht umschreiben.

```bash
PRODUCT_RATING_BASE_PATH=/produkte npm run package:deb
docker build --build-arg PRODUCT_RATING_BASE_PATH=/produkte \
  -f docker/Dockerfile -t product-rating .
```

Der Proxy schneidet das Präfix wieder ab (`proxy_pass … /` mit Schrägstrich am
Ende), die Anwendung antwortet also weiterhin auf `/` und `/api/v1` und braucht
keine eigene Einstellung. `server.base_url` bekommt den vollen Pfad, zum
Beispiel `https://heim.example.org/produkte`. Zwei Instanzen unter zwei
Unterpfaden **desselben** Hostnamens funktionieren nicht: das Sitzungs-Cookie
gilt für `/` und beide überschrieben sich gegenseitig.

---

## 8. Betrieb

- **Backup:** `product-rating backup --to <verzeichnis>` erzeugt einen
  konsistenten SQLite-Snapshot (`VACUUM INTO`) und sichert die Uploads. Ein
  einfaches Kopieren der `.db` im laufenden Betrieb ist wegen WAL nicht sicher.
  Der Dienst muss dafür nicht angehalten werden. Dieselben Snapshots erzeugt
  `packaging/examples/backup/product-rating-backup` samt Timer – gedacht für
  Maschinen, die die Anwendung dafür gar nicht erst aufrufen wollen.
- **Update:** `apt install ./product-rating_<neue-version>.deb` beziehungsweise
  `docker compose pull && docker compose up -d`. Migrationen laufen automatisch;
  vorher wird ein Datenbank-Snapshot angelegt.
- **Monitoring:** `/healthz` antwortet ohne Anmeldung mit Version, Erreichbarkeit
  der Datenbank und Beschreibbarkeit des Upload-Verzeichnisses – Status `200`
  mit `{"status":"ok",…}`, sonst `503` mit `"degraded"`. Dazu strukturierte Logs
  nach stdout, Datei oder syslog (8.2).
- **Konsistenzprüfung:** `product-rating fsck --uploads` vergleicht das
  Upload-Verzeichnis in beide Richtungen mit der Fototabelle: Dateien, zu denen
  keine Zeile mehr existiert, und Zeilen, deren Datei fehlt. Gemeldet wird
  immer, gelöscht nur mit `--repair` – eine verwaiste Datei kostet Platz, eine
  zu Unrecht gelöschte ein Foto.

### 8.1 Kommandozeile

`product-rating <befehl>` ist der einzige Einstiegspunkt: Der systemd-Dienst
ruft `serve` auf, das `postinst` `migrate`, alles Weitere ein Mensch auf der
Konsole. Im Container liegt derselbe Befehl unter
`node /app/server/dist/index.js`, zum Beispiel
`docker compose exec app node /app/server/dist/index.js user list`.

| Befehl | Wirkung |
|---|---|
| `serve` | API und Weboberfläche ausliefern; wendet vorher fehlende Migrationen an |
| `migrate` | Migrationen anwenden und beenden (idempotent, mit Snapshot vorweg) |
| `user add\|list\|disable\|enable\|passwd` | Konten anlegen, auflisten, sperren, entsperren, Passwort setzen |
| `invite create\|list\|revoke` | Einladungscodes ausgeben, auflisten, zurückziehen |
| `backup --to <dir>` | Snapshot aus `VACUUM INTO` plus Fotos, `--keep-days N` als Aufbewahrungsgrenze |
| `restore --from <dir>` | Snapshot zurückspielen, nach ausdrücklicher Bestätigung (`--yes` überspringt sie) |
| `fsck --uploads` | Upload-Verzeichnis gegen die Fototabelle prüfen, `--repair` löscht verwaiste Dateien |
| `help [befehl]`, `version` | Hilfe und Version |

Jeder Befehl versteht zusätzlich die Konfigurationsschalter aus 6:
`--config <datei>`, `--set <sektion>.<schlüssel>=<wert>` und die Kurzformen
`--host`, `--port`, `--base-url`, `--database`, `--uploads`, `--temp`,
`--log-level`, `--log-format`, `--log-destination`. Damit lässt sich jeder
Befehl auf eine zweite Instanz richten. Einzige Doppelbelegung: `fsck --uploads`
meint die Prüfung, nicht den Pfad – dafür `--set paths.uploads=<dir>`.

Exit-Codes: `0` erledigt, `1` fehlgeschlagen oder Fund (`fsck`), `2` falsch
aufgerufen. Ergebnisse gehen nach stdout, Fortschritt und Fehler nach stderr –
`product-rating invite create` liefert also genau den Code auf stdout und lässt
sich weiterverarbeiten.

Passwörter nimmt die CLI nie als Argument entgegen; sie stünden in der
Shell-History und in der Prozessliste. Entweder fragt sie danach (zweimal, ohne
Echo) oder sie liest sie mit `--password-stdin` aus einer Pipe:

```bash
product-rating user add anna --role admin
echo "…" | product-rating user add tom --password-stdin
product-rating invite create --note "für Tom"

systemctl stop product-rating
product-rating restore --from /var/backups/product-rating/2026-08-16_030000
systemctl start product-rating
```

`restore` überschreibt den laufenden Zustand, deshalb erst den Dienst anhalten:
Ein laufender Server hält die Datenbank offen und schriebe in die Datei, die
gerade ersetzt wird. Die vorhandene Datenbank wird vorher als
`pre-restore-<zeitstempel>.db` daneben abgelegt.

### 8.2 Logging

`log.level` bestimmt die Ausführlichkeit, `log.format` die Form (`json` für
Auswertung, `pretty` für den Blick auf die Konsole) und `log.destination` das
Ziel:

| Ziel | Wohin | Anmerkung |
|---|---|---|
| `stdout` | Standardausgabe | Standard. Unter systemd das Journal, im Container das, was `docker logs` zeigt |
| `file` | `log.file` | Verzeichnis wird beim Start geprüft und angelegt; Rotation über `/etc/logrotate.d/product-rating` (`copytruncate`) |
| `syslog` | lokaler syslog-Dienst | Über `logger` (util-linux), Facility `daemon`, Priorität je Zeile. Beim Start wird eine Testzeile geschrieben; klappt das nicht, bricht der Start mit Begründung ab |

Anmeldeversuche stehen unter einem einheitlichen Ereignisnamen im Log:
`event: "auth.login"` mit `outcome` `success`, `failure` oder `rate_limited`,
dazu Benutzername, IP und – nur im Log, nie in der Antwort – der Grund
(`unknown_user`, `wrong_password`, `account_disabled`). Damit lässt sich „alle
Fehlversuche dieser Adresse“ abfragen, ohne nach Sätzen zu suchen.

---

## 9. Entwicklung

Einmalig eine lokale Konfiguration und ein Secret anlegen (beides ist über
`.gitignore` ausgeschlossen):

```bash
cp config/config.example.toml config/config.toml
# in config/config.toml auf lokale Pfade zeigen, relativ zur Datei erlaubt:
#   [paths] database = "../data/db/app.db"
#           uploads  = "../data/uploads"
#           temp     = "../data/tmp"
#   [auth]  secret_file = "secret.env"
install -m 600 /dev/null config/secret.env
openssl rand -hex 32 > config/secret.env
```

Damit die Anmeldung aus dem Vite-Dev-Server heraus funktioniert, gehört dessen
Herkunft in die Konfiguration – der Proxy reicht den `Origin`-Header des
Browsers durch, und die Origin-Prüfung lehnt alles Unbekannte ab:

```toml
[server]
trusted_origins = ["http://localhost:5173"]
```

Den ersten Administrator legt der erste Start aus der Umgebung an:

```bash
BOOTSTRAP_ADMIN_USER=chef BOOTSTRAP_ADMIN_PASSWORD=... npm run dev
```

```bash
npm install                 # npm-Workspaces: server, web, shared
npm run dev                 # API auf :8080, Vite-Dev-Server auf :5173
npm run migrate             # Migrationen anwenden
npm run db:generate         # Migration aus geändertem Schema erzeugen
npm test                    # Vitest
npm run lint && npm run typecheck
npm run build               # Produktions-Bundle nach dist/
npm run package:deb         # Debian-Paket bauen
PRODUCT_RATING_BASE_PATH=/produkte npm run build   # Bau für einen Unterpfad (7.3)
docker build -f docker/Dockerfile -t product-rating .   # Image bauen

npm run icons  --workspace @product-rating/web   # Icons aus den SVG-Quellen
npm run preview --workspace @product-rating/web  # Bau auf :4173 ausliefern
```

`npm test` läuft in zwei Vitest-Projekten: `node` für `server/` und `shared/`,
`web` mit jsdom und Testing Library für die Oberfläche. Ein einzelnes Projekt
lässt sich mit `npx vitest run --project web` starten. Die Tests der Oberfläche
ersetzen nur `fetch` und laufen sonst durch den echten API-Client und den echten
Query-Cache, damit auch die Übersetzung der Fehler mit geprüft wird.

Der Service Worker existiert nur im gebauten Zustand – im Dev-Server ist er
abgeschaltet, sonst würde er genau die Dateien zwischenspeichern, die Vite bei
jeder Änderung austauscht. Wer ihn ausprobieren will, nimmt `npm run build` und
`npm run preview`; der Preview-Server hat denselben API-Proxy wie der
Dev-Server, und `http://localhost:4173` gilt dem Browser als sicherer Kontext,
sodass Service Worker und Kamera ohne TLS funktionieren. Die Herkunft gehört
dann zusätzlich in `server.trusted_origins`.

In der Entwicklung ist `server.static_dir` leer, der Server also reine API. Wer
den gebauten Gesamtstand ohne Container sehen will – Oberfläche und API auf
einer Herkunft, so wie im Betrieb –, baut einmal und startet den Server mit
gesetztem Verzeichnis:

```bash
npm run build
PR_SERVER__STATIC_DIR="${PWD}/web/dist" npm start
```

Schemaänderungen laufen immer über `server/src/db/schema.ts` plus
`npm run db:generate`; die erzeugte SQL-Datei unter
`server/src/db/migrations/` wird eingecheckt. Vor jeder Migration einer
bestehenden Datenbank legt der Runner selbständig einen Snapshot
`pre-migration-<zeitstempel>.db` neben der Datenbank an.

Repository-Struktur:

```
server/     Fastify-API, Drizzle-Schema und Migrationen, CLI
web/        React-PWA
shared/     gemeinsame Typen und Zod-Schemata
config/     config.example.toml
packaging/  build-deb.sh, debian/ (control, Maintainer-Skripte, Unit,
            logrotate, Konfiguration), examples/ (nginx, apache2, caddy,
            traefik, systemd, ufw, backup)
docker/     Dockerfile, Entrypoint, Container-Konfiguration, Compose-Dateien
            (einzeln und mit Caddy davor)
```

### 9.1 Versionen und Release

**Eine Version für das ganze Repository**, nach [SemVer](https://semver.org):
`MAJOR.MINOR.PATCH`. Für eine Haushalts-App bedeutet das konkret:

- **MAJOR** – ein Update braucht einen Handgriff: geänderte Konfigurations-
  schlüssel, ein anderer Pfad, ein Bruch in der API.
- **MINOR** – neue Funktionen, Migrationen, die von allein durchlaufen.
- **PATCH** – Fehlerbehebungen und Sicherheitskorrekturen ohne neue Funktion.

Bis zur ersten abgenommenen Installation bleibt die Reihe bei `0.x`; `1.0.0`
vergibt der Projektinhaber, wenn eine Installation produktiv läuft. In der
`0.x`-Reihe steht MINOR für alles, was sonst MAJOR wäre.

**Quelle der Wahrheit sind die `package.json`-Dateien.** Daraus liest
`product-rating version` und `/healthz` (über `server/package.json`) und
`packaging/build-deb.sh` (über die Datei im Wurzelverzeichnis). Die
Änderungsgeschichte steht in [HISTORY.md](HISTORY.md) – ein eigenes `CHANGELOG`
gibt es bewusst nicht, es liefe daneben her. `packaging/debian/changelog` ist
kein zweites Verzeichnis der Änderungen, sondern der kurze Paketeintrag, den
`dpkg` erwartet. Dass alle Stellen dieselbe Nummer nennen, prüft
`server/src/version.test.ts` bei jedem Testlauf.

Ein Release besteht aus fünf Schritten:

```bash
# 1. Version in allen vier Manifesten setzen
npm version 0.2.0 --workspaces --include-workspace-root --no-git-tag-version

# 2. packaging/debian/changelog: neuen Eintrag oben ergänzen, Version gleich
# 3. HISTORY.md: Eintrag mit Datum und Umfang
# 4. Prüfen und committen
npm run lint && npm run typecheck && npm test
git commit -am "release: 0.2.0"

# 5. Tag schieben - der Release-Workflow baut Pakete und Images
git tag -a v0.2.0 -m "0.2.0"
git push origin main --follow-tags
```

Der Tag trägt ein `v` davor, die Version im Paket nicht: aus `v0.2.0` wird
`product-rating_0.2.0_amd64.deb`. Was der Workflow daraus baut, steht in
Abschnitt 9.2.

### 9.2 Continuous Integration

Zwei Workflows unter `.github/workflows/`:

- **`ci.yml`** läuft bei jedem Push und jedem Pull Request auf `main` und auf
  `claude/**`: `npm ci`, `format:check`, `lint`, `typecheck`, `test`, `build`.
  Dazu ein zweiter Job, der das Debian-Paket baut und mit `lintian` prüft, und
  ein dritter, der das Container-Image baut (ohne es zu veröffentlichen). Damit
  ist genau das abgedeckt, was CLAUDE.md vor jedem Commit verlangt – nur eben
  auch dann, wenn es jemand vergisst.
- **`release.yml`** läuft auf einen Tag `v*`: baut das Debian-Paket für `amd64`
  und `arm64` – jeweils auf einem Runner der Architektur, weil
  `better-sqlite3`, `sharp` und `@node-rs/argon2` native Binärdateien mitbringen
  –, hängt beide `.deb` an ein GitHub-Release und schiebt ein Multi-Arch-Image
  nach `ghcr.io/<owner>/product-rating` (Tags: die Version, `MAJOR.MINOR`,
  `MAJOR` und `latest`).

Beide Workflows brauchen keine eingerichteten Secrets: `GITHUB_TOKEN` reicht
für Release und Registry.

Weitere Dokumente: [CLAUDE.md](CLAUDE.md) (Arbeitsanweisungen und
Projektkonventionen), [TODO.md](TODO.md) (Umsetzungsschritte),
[HISTORY.md](HISTORY.md) (abgeschlossene Arbeiten).
