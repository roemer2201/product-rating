# TODO

Feingliederiger Umsetzungsplan. Abgearbeitet wird grundsätzlich von oben nach
unten; innerhalb eines Meilensteins sind die Punkte so geschnitten, dass jeder
einzeln umsetzbar und testbar ist. Erledigtes wird hier abgehakt und in
[HISTORY.md](HISTORY.md) mit Datum dokumentiert.

Legende: **[S]** klein (< 30 min) · **[M]** mittel · **[L]** groß, ggf. weiter zerlegen

---

## M0 – Projektgerüst

- [x] **[S]** `package.json` im Wurzelverzeichnis mit npm-Workspaces `server`, `web`, `shared`
- [x] **[S]** `.editorconfig`, `.nvmrc` (Node 22), `.npmrc`
- [x] **[S]** TypeScript-Basiskonfiguration `tsconfig.base.json`, je Workspace ein erbendes `tsconfig.json`
- [x] **[S]** ESLint + Prettier einrichten, Skripte `lint`, `format`, `typecheck`
- [x] **[S]** Vitest einrichten, Skript `test`, ein Rauchtest je Workspace
- [x] **[S]** `shared/` anlegen: Paketgerüst, Export-Barrel, erste gemeinsame Typen (`Product`, `Rating`, `Photo`, `User`)
- [x] **[S]** Wurzel-Skripte `dev`, `build`, `start` verdrahten (concurrently)
- [ ] **[S]** `LICENSE` wählen und ergänzen (Vorschlag: MIT oder AGPL-3.0 – Entscheidung des Projektinhabers)
- [ ] **[S]** TypeScript auf 7.x heben, sobald `typescript-eslint` es unterstützt (aktuell Peer-Bereich `>=4.8.4 <6.1.0`, deshalb auf `~5.9.3` festgelegt)
- [ ] **[S]** Verbleibende `esbuild`-Meldung aus `npm audit` beobachten (nur Dev-Server unter Windows betroffen, transitiv über `vite`/`tsup` gepinnt)
- [ ] **[S]** `jsdom` und Testing Library ergänzen, sobald es Komponenten zu testen gibt (mit M7)

## M1 – Konfiguration

- [x] **[M]** Zod-Schema für die gesamte Konfiguration (`server/src/config/schema.ts`), inklusive Standardwerten
- [x] **[M]** TOML-Datei laden (`smol-toml`) mit Suchreihenfolge `--config` → `$PRODUCT_RATING_CONFIG` → `/etc/product-rating/config.toml` → `./config/config.toml`
- [x] **[M]** Überschreibung per Umgebungsvariablen `PR_<SEKTION>__<SCHLÜSSEL>` implementieren, inklusive Typkonvertierung
- [x] **[S]** Vorrangkette Standardwerte < Datei < Env < CLI festschreiben und mit Tests belegen
- [x] **[S]** Startprüfung: Existenz und Schreibrechte von `paths.database`, `paths.uploads`, `paths.temp`; fehlende Verzeichnisse anlegen
- [x] **[S]** Startprüfung: `auth.secret_file` vorhanden, Rechte `0600`, Inhalt ausreichend lang – sonst klarer Abbruch
- [x] **[S]** `config/config.example.toml` mit allen Schlüsseln und Kommentaren schreiben
- [x] **[S]** Konfigurationstabelle in `README.md` mit dem Schema abgleichen
- [x] **[S]** Tests: fehlende Datei, ungültiger Wert, Env-Überschreibung, relative Pfade

## M2 – Datenbank und Migrationen

- [x] **[S]** Drizzle + better-sqlite3 einbinden, `drizzle.config.ts`
- [x] **[S]** DB-Verbindung kapseln: WAL-Modus, `foreign_keys = ON`, `busy_timeout`, `synchronous = NORMAL`
- [x] **[M]** Schema `users` (id, username UNIQUE, email, password_hash, role, created_at, disabled_at)
- [x] **[S]** Schema `sessions` (id, user_id, expires_at, user_agent, created_at, last_seen_at) + Index auf `user_id`
- [x] **[S]** Schema `invites` (code UNIQUE, created_by, expires_at, used_by, used_at)
- [x] **[M]** Schema `products` (id, ean UNIQUE, name, brand, category, notes, created_by, created_at, updated_at) + Index auf `name`, `brand`
- [x] **[S]** Schema `ratings` (id, product_id, user_id, stars, comment, created_at, updated_at) + `UNIQUE (product_id, user_id)` + CHECK `stars BETWEEN 0 AND 5`
- [x] **[S]** Schema `photos` (id, product_id, user_id, filename, mime, width, height, is_primary, created_at)
- [x] **[S]** Erste Migration generieren und einchecken
- [x] **[S]** Migrationsrunner beim Serverstart, plus `product-rating migrate`
- [x] **[S]** Automatischer DB-Snapshot vor jeder Migration
- [x] **[S]** Testhilfe: In-Memory- bzw. Temp-Datenbank je Testlauf, Seed-Funktion

## M3 – Authentifizierung und Nutzer

- [x] **[M]** Passwort-Hashing mit argon2id, Parameter aus der Konfiguration
- [x] **[M]** Session-Erstellung: 32-Byte-Zufalls-ID, Speicherung, Cookie `HttpOnly`/`Secure`/`SameSite=Lax`
- [x] **[S]** Auth-Hook in Fastify: Session laden, `request.user` setzen, abgelaufene Sessions verwerfen
- [x] **[S]** Rollierende Verlängerung, wenn Restlaufzeit unter `session_renew_threshold_days`
- [x] **[S]** Aufräumjob für abgelaufene Sessions (beim Start und täglich)
- [x] **[S]** `POST /api/v1/auth/login` mit Rate-Limit pro IP und Benutzername
- [x] **[S]** `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`
- [x] **[S]** `GET/DELETE /api/v1/auth/sessions` – eigene Sessions anzeigen und einzeln widerrufen
- [x] **[M]** Bootstrap-Admin aus `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASSWORD` beim ersten Start
- [x] **[M]** Einladungen: `POST /api/v1/invites` (admin), `GET /api/v1/invites`, `DELETE /api/v1/invites/:code`
- [x] **[M]** `POST /api/v1/auth/register` – nur mit gültigem, unbenutztem Einladungscode
- [x] **[S]** Nutzerverwaltung für Admins: auflisten, deaktivieren, Rolle ändern, Passwort zurücksetzen
- [x] **[S]** Passwortwechsel für den eigenen Account (mit Prüfung des alten Passworts, invalidiert andere Sessions)
- [x] **[S]** CSRF-Absicherung: Origin-/Referer-Prüfung für alle schreibenden Routen
- [x] **[S]** Tests: Login-Erfolg/-Fehlschlag, Rate-Limit, abgelaufene Session, Registrierung mit gültigem/ungültigem/verbrauchtem Code, Rollenprüfung
- [ ] **[S]** Sitzungsliste lesbarer machen: User-Agent zu „iPhone · Safari“ verdichten (mit der Einstellungsseite in M8)
- [ ] **[S]** Anmeldeversuche zusätzlich ins Log mit einheitlichem Ereignisnamen, sobald strukturiertes Logging steht (M13)

## M4 – Produkt-API

- [x] **[S]** Zod-Schemata für Produktanlage und -änderung in `shared/`
- [x] **[M]** EAN-Validierung inklusive Prüfziffer (EAN-13, EAN-8, UPC-A mit Normalisierung auf EAN-13)
- [x] **[S]** `POST /api/v1/products` – legt an, meldet bei bestehender EAN `409` mit der vorhandenen Produkt-ID
- [x] **[S]** `GET /api/v1/products/by-ean/:ean` – Nachschlagen nach dem Scan
- [x] **[S]** `GET /api/v1/products/:id` inklusive eigener Bewertung, Durchschnitt und Anzahl der Bewertungen
- [x] **[M]** `GET /api/v1/products` mit Suche (Name, Marke, EAN), Filter (Kategorie, Mindestbewertung, „nur eigene bewertete“), Sortierung und Cursor-Pagination
- [x] **[S]** `PATCH /api/v1/products/:id` – Änderungen am gemeinsamen Katalog, `updated_at` pflegen
- [x] **[S]** `DELETE /api/v1/products/:id` – nur Admin; entfernt zugehörige Bewertungen, Fotos und Dateien
- [x] **[S]** Volltextsuche prüfen: FTS5-Tabelle oder `LIKE` mit Index – Entscheidung dokumentiert (`LIKE` über `pr_lower()`, siehe README 4.1)
- [x] **[S]** Tests: EAN-Prüfziffer, Duplikatanlage, Suche, Pagination, Berechtigungen

## M5 – Bewertungen

- [x] **[S]** `PUT /api/v1/products/:id/rating` – anlegen oder aktualisieren (Upsert), 0–5 Sterne, optionaler Kommentar
- [x] **[S]** `DELETE /api/v1/products/:id/rating` – eigene Bewertung entfernen
- [x] **[S]** Aggregation: Durchschnitt und Anzahl je Produkt, effizient in der Listenabfrage (korrelierte Unterabfragen über `ratings_product_user_unique`, siehe README 4.2)
- [x] **[S]** `GET /api/v1/ratings/mine` – eigene Bewertungen, sortierbar
- [x] **[S]** Tests: Upsert-Verhalten, Grenzwerte 0 und 5, ungültige Werte, Fremdbewertung nicht änderbar

## M6 – Fotos

- [ ] **[M]** Multipart-Upload mit Größenlimit und MIME-Whitelist aus der Konfiguration
- [ ] **[M]** Verarbeitung mit `sharp`: HEIC/JPEG/PNG einlesen, EXIF entfernen, Ausrichtung korrigieren, Detailbild (`detail_px`) und Thumbnail (`thumbnail_px`) schreiben
- [ ] **[S]** Speicherlayout unter `paths.uploads` festlegen (Unterverzeichnisse nach Produkt-ID-Präfix, generierte Dateinamen)
- [ ] **[S]** `POST /api/v1/products/:id/photos`, `DELETE /api/v1/photos/:id`, `PUT /api/v1/photos/:id/primary`
- [ ] **[S]** `GET /api/v1/media/:id?size=thumb|full` – authentifiziert, mit `ETag`, `Cache-Control: private`, Range-Unterstützung
- [ ] **[S]** Aufräumen verwaister Dateien: Prüfbefehl `product-rating fsck --uploads`
- [ ] **[S]** Atomares Schreiben über `paths.temp`, damit halbe Dateien nicht sichtbar werden
- [ ] **[S]** Beim Löschen eines Produkts die Bilddateien mitentfernen – `deleteProduct()` liefert die betroffenen Fotozeilen bereits zurück, es fehlt nur das Löschen im Dateisystem
- [ ] **[S]** Tests: zu große Datei, falscher MIME-Typ, EXIF wird entfernt, Thumbnail entsteht, Löschen räumt Dateien ab

## M7 – Frontend-Grundgerüst

- [ ] **[S]** Vite-React-Projekt in `web/` mit TypeScript und Pfad-Aliassen
- [ ] **[S]** Routing (React Router), Layout mit unterer Navigationsleiste
- [ ] **[S]** Typisierter API-Client in `web/src/lib/api.ts`, Fehlerbehandlung zentral
- [ ] **[S]** Serverstatus-Verwaltung (TanStack Query) mit sinnvollen Cache-Zeiten
- [ ] **[M]** Login-Seite, Registrierung mit Einladungscode, „nicht angemeldet“-Weiterleitung
- [ ] **[S]** Oberflächentexte zentral in `web/src/lib/strings.ts`
- [ ] **[S]** Grundstyling festlegen (schlichtes eigenes CSS oder Tailwind – Entscheidung dokumentieren), dunkles und helles Thema

## M8 – Frontend-Funktionen

- [ ] **[L]** Scanner-Ansicht: Kamerastream, `zxing-wasm`-Decoder, Erkennungsrahmen, Rückmeldung per Vibration und Ton
- [ ] **[S]** Kamera-Auswahl (Rückkamera bevorzugt), Torch-Schalter, wenn verfügbar
- [ ] **[S]** Fehlerfälle sauber erklären: kein secure context, Berechtigung verweigert, keine Kamera
- [ ] **[S]** Manuelle EAN-Eingabe mit Prüfziffernvalidierung als gleichwertiger Weg
- [ ] **[M]** Nach dem Scan: bekanntes Produkt → Detailseite, unbekanntes → Anlegeformular mit vorbelegter EAN
- [ ] **[M]** Produktformular: Name, Marke, Kategorie, Notizen; Kategorie als Vorschlagsliste aus vorhandenen Werten
- [ ] **[S]** Route für die Kategorievorschläge nachziehen (`GET /api/v1/products/categories`, vorhandene Werte des Katalogs)
- [ ] **[M]** Foto aufnehmen oder auswählen (`<input type="file" accept="image/*" capture="environment">`), Vorschau, clientseitige Vorverkleinerung vor dem Upload
- [ ] **[S]** Upload-Fortschritt und Wiederholung bei Fehlern
- [ ] **[M]** Sterne-Widget: touchfreundlich, halbe Sterne nicht nötig, 0 Sterne bewusst möglich
- [ ] **[M]** Produktliste: Suchfeld, Filter, Sortierung, unendliches Nachladen, Thumbnails
- [ ] **[M]** Produktdetailseite: Foto groß, eigene Bewertung, Durchschnitt, Bearbeiten, Löschen
- [ ] **[S]** Ansicht „Meine Bewertungen“ auf Basis von `GET /api/v1/ratings/mine`, sortierbar nach Datum, Sternen und Name
- [ ] **[S]** Leere Zustände und Ladeskelette
- [ ] **[S]** Einstellungsseite: Passwort ändern, eigene Sessions, Abmelden
- [ ] **[S]** Adminbereich: Nutzer, Einladungen erzeugen und teilen

## M9 – PWA und iOS

- [ ] **[S]** `vite-plugin-pwa` einrichten, Manifest (`display: standalone`, `theme_color`, `background_color`, Start-URL)
- [ ] **[S]** Icons erzeugen: 192, 512, maskable, `apple-touch-icon` 180
- [ ] **[S]** iOS-Metatags, `viewport-fit=cover`, `env(safe-area-inset-*)` im Layout
- [ ] **[S]** Service Worker: App-Shell vorcachen, API-Antworten nicht blind cachen
- [ ] **[S]** Sichtbare Aktualisierungsaufforderung bei neuer Version
- [ ] **[S]** Offline-Hinweisseite statt Browser-Fehlerseite
- [ ] **[M]** Auf einem echten iPhone prüfen: Installation, Scanner, Kamera-Upload, Sitzung überlebt Neustart, Safe-Area-Layout

## M10 – Docker

- [ ] **[M]** Mehrstufiges `Dockerfile` (Build-Stufe, schlanke Laufzeitstufe, nicht-privilegierter Nutzer)
- [ ] **[S]** Entrypoint: Verzeichnisse anlegen, Secret erzeugen, falls nicht vorhanden, Migrationen ausführen (`node dist/migrate.js`)
- [ ] **[S]** `docker-compose.yml` mit Volume `/data` und gemounteter Konfiguration
- [ ] **[S]** `HEALTHCHECK` auf `/healthz`
- [ ] **[S]** `.dockerignore`
- [ ] **[S]** Multi-Arch-Build für `linux/amd64` und `linux/arm64` dokumentieren
- [ ] **[S]** Compose-Beispiel mit Caddy als vorgelagertem TLS-Proxy

## M11 – Debian-Paket

- [ ] **[M]** `packaging/debian/control`: Paketname, Abhängigkeit `nodejs (>= 22)`, `adduser`, architekturabhängig
- [ ] **[M]** Buildskript `npm run package:deb`: Bundle bauen, Baum unter `packaging/build/` aufbauen, `dpkg-deb --build`
- [ ] **[S]** Dateibaum: `/opt/product-rating`, `/etc/product-rating`, `/var/lib/product-rating/{db,uploads,tmp}`, `/var/log/product-rating`
- [ ] **[S]** `conffiles`: `/etc/product-rating/config.toml` registrieren, damit Änderungen Updates überleben
- [ ] **[M]** `postinst`: Systemnutzer anlegen, Verzeichnisse und Rechte setzen, Secret erzeugen (`0600`), Migrationen ausführen (`node dist/migrate.js`), Dienst aktivieren
- [ ] **[S]** Prüfen, dass `dist/migrations/` im Paket und im Image landet – der Runner liest die SQL-Dateien zur Laufzeit
- [ ] **[S]** `prerm` / `postrm`: Dienst stoppen, bei `purge` Konfiguration und Daten nach Rückfrage entfernen
- [ ] **[S]** systemd-Unit mit Härtung: `ProtectSystem=strict`, `ReadWritePaths`, `NoNewPrivileges`, `PrivateTmp`, `Restart=on-failure`
- [ ] **[S]** `/usr/bin/product-rating` als Wrapper auf die CLI
- [ ] **[S]** logrotate-Regel für `/var/log/product-rating/`
- [ ] **[S]** Lintlauf mit `lintian`, gemeldete Punkte abarbeiten
- [ ] **[M]** Installation in einer sauberen Debian-VM oder einem Container testen: install, Konfiguration ändern, Neustart, Upgrade, remove, purge
- [ ] **[S]** Architekturen `amd64` und `arm64` bauen (native Module!)

## M12 – Mitgelieferte Konfigurationen

- [ ] **[M]** `packaging/examples/nginx/product-rating.conf`: TLS-Vhost, `proxy_pass`, `client_max_body_size`, `X-Forwarded-*`, Security-Header, Cache-Regeln für Assets
- [ ] **[S]** nginx-Variante für Betrieb unter einem Unterpfad
- [ ] **[M]** `packaging/examples/apache2/product-rating.conf`: `mod_proxy`-Vhost, `ProxyPreserveHost`, `RequestHeader set X-Forwarded-Proto`, `LimitRequestBody`, benötigte Module dokumentiert
- [ ] **[S]** `packaging/examples/caddy/Caddyfile`
- [ ] **[S]** `packaging/examples/traefik/dynamic.yml` plus Compose-Labels
- [ ] **[S]** `packaging/examples/systemd/override.conf` als Vorlage für abweichende Pfade
- [ ] **[S]** `packaging/examples/ufw/product-rating` – Applikationsprofil
- [ ] **[M]** `packaging/examples/backup/product-rating-backup` – Skript nach den Skript-Konventionen (Header, `--help`, Silent-/Verbose-Modus, Logging über `logger`), plus systemd-Timer
- [ ] **[S]** In allen Proxy-Beispielen darauf hinweisen, dass `server.base_url` der öffentlichen Adresse entsprechen muss – sonst schlägt die Origin-Prüfung schreibender Anfragen fehl
- [ ] **[S]** Jede Beispielkonfiguration einmal real gegen die laufende App testen
- [ ] **[S]** Querverweise in `README.md` prüfen

## M13 – CLI und Betrieb

- [ ] **[S]** CLI-Gerüst (`product-rating <befehl>`) mit `--help` und Exit-Codes
- [ ] **[S]** `serve`, `migrate`
- [ ] **[S]** `user add|list|disable|passwd`, `invite create|list|revoke`
- [ ] **[M]** `backup --to <verzeichnis>`: SQLite `VACUUM INTO` plus Uploads, mit Zeitstempel und optionaler Aufbewahrungsgrenze
- [ ] **[M]** `restore --from <verzeichnis>` mit ausdrücklicher Bestätigung
- [ ] **[S]** `fsck` – verwaiste Dateien und Datenbankeinträge finden
- [ ] **[S]** `/healthz` liefert Version, DB-Erreichbarkeit, Schreibbarkeit der Uploads
- [ ] **[S]** Strukturiertes Logging (pino) mit den Zielen stdout, Datei und syslog
- [ ] **[S]** `log.format` und `log.destination` tatsächlich anwenden – seit M1 validiert, wirksam ist bislang nur `log.level`
- [ ] **[S]** CLI-Argumente aus M1 (`--config`, `--set`, Kurzformen) in `--help` aufnehmen

## M14 – Qualitätssicherung und Release

- [ ] **[M]** Integrationstests über die API: Registrierung → Produkt anlegen → Foto → Bewertung → Suche
- [ ] **[S]** Testabdeckung für EAN-Validierung, Konfigurationsauflösung und Berechtigungen sicherstellen
- [ ] **[M]** GitHub-Actions-Workflow: lint, typecheck, test, build
- [ ] **[M]** Release-Workflow: Debian-Pakete (amd64, arm64) und Container-Images bauen und anhängen
- [ ] **[S]** Versionsschema festlegen (SemVer) und `CHANGELOG` oder `HISTORY.md` als Quelle bestimmen
- [ ] **[S]** Sicherheitsdurchsicht vor dem ersten Release: Header, Cookies, Limits, Dateirechte
- [ ] **[S]** Installationsanleitung anhand einer Neuinstallation gegenprüfen

---

## Backlog (nach dem MVP)

- [ ] Mehrere Fotos pro Produkt inklusive Sortierung
- [ ] Tags und freie Kategorien mit Autovervollständigung
- [ ] Papierkorb mit Wiederherstellung statt endgültigem Löschen
- [ ] Export nach CSV und JSON, Import zum Umzug
- [ ] Offline-Erfassung mit Sync-Queue (IndexedDB) und Konfliktbehandlung
- [ ] Statistiken: Bewertungsverteilung, meistbewertete Marken
- [ ] Fremde Bewertungen sichtbar machen: wer im Haushalt hat wie viele Sterne vergeben – bisher liefert die API nur Durchschnitt, Anzahl und die eigene Bewertung
- [ ] FTS5-Suche nachrüsten, falls die `LIKE`-Suche mit wachsendem Katalog spürbar langsam wird
- [ ] TOTP-Zweitfaktor
- [ ] Optionale Delegation der Authentifizierung an Reverse-Proxy-SSO
- [ ] Preisverlauf und Einkaufsort je Produkt
- [ ] Teilen einer Produktansicht per zeitlich begrenztem Link
- [ ] Barrierefreiheitsdurchgang (Fokusreihenfolge, Kontraste, Screenreader)
- [ ] PostgreSQL als alternatives Backend, falls jemals nötig
