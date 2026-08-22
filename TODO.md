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
- [x] **[S]** `jsdom` und Testing Library ergänzen, sobald es Komponenten zu testen gibt (mit M7)

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
- [x] **[S]** Sitzungsliste lesbarer machen: User-Agent zu „iPhone · Safari“ verdichten (mit der Einstellungsseite in M8)
- [x] **[S]** Anmeldeversuche zusätzlich ins Log mit einheitlichem Ereignisnamen, sobald strukturiertes Logging steht (M13) – `event: "auth.login"` mit `outcome` und Grund

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

- [x] **[M]** Multipart-Upload mit Größenlimit und MIME-Whitelist aus der Konfiguration
- [x] **[M]** Verarbeitung mit `sharp`: HEIC/JPEG/PNG einlesen, EXIF entfernen, Ausrichtung korrigieren, Detailbild (`detail_px`) und Thumbnail (`thumbnail_px`) schreiben
- [x] **[S]** Speicherlayout unter `paths.uploads` festlegen (Unterverzeichnisse nach Produkt-ID-Präfix, generierte Dateinamen)
- [x] **[S]** `POST /api/v1/products/:id/photos`, `DELETE /api/v1/photos/:id`, `PUT /api/v1/photos/:id/primary`
- [x] **[S]** `GET /api/v1/media/:id?size=thumb|full` – authentifiziert, mit `ETag`, `Cache-Control: private`, Range-Unterstützung
- [x] **[S]** Aufräumen verwaister Dateien: Prüfbefehl `product-rating fsck --uploads`
- [x] **[S]** Atomares Schreiben über `paths.temp`, damit halbe Dateien nicht sichtbar werden
- [x] **[S]** Beim Löschen eines Produkts die Bilddateien mitentfernen – `deleteProduct()` liefert die betroffenen Fotozeilen bereits zurück, es fehlt nur das Löschen im Dateisystem
- [x] **[S]** Tests: zu große Datei, falscher MIME-Typ, EXIF wird entfernt, Thumbnail entsteht, Löschen räumt Dateien ab
- [x] **[S]** Fotoliste in die Einzelabfrage eines Produkts aufnehmen (`ProductDetail.photos`) – ohne sie kennt der Client nur `primaryPhotoId` und könnte weitere Fotos weder löschen noch zum Hauptbild machen
- [ ] **[S]** Rate-Limit auf den Upload (README 4 nennt es unter „Härtung“, umgesetzt ist bisher nur das Login-Limit); braucht einen neuen Schlüssel `uploads.rate_limit_per_minute`
- [ ] **[S]** Verwaiste Fotos beim Löschen eines Kontos: Konten werden nur deaktiviert, ein späteres echtes Löschen müsste die Dateien mitnehmen

## M7 – Frontend-Grundgerüst

- [x] **[S]** Vite-React-Projekt in `web/` mit TypeScript und Pfad-Aliassen
- [x] **[S]** Routing (React Router), Layout mit unterer Navigationsleiste
- [x] **[S]** Typisierter API-Client in `web/src/lib/api.ts`, Fehlerbehandlung zentral
- [x] **[S]** Serverstatus-Verwaltung (TanStack Query) mit sinnvollen Cache-Zeiten
- [x] **[M]** Login-Seite, Registrierung mit Einladungscode, „nicht angemeldet“-Weiterleitung
- [x] **[S]** Oberflächentexte zentral in `web/src/lib/strings.ts`
- [x] **[S]** Grundstyling festlegen (eigenes CSS mit Custom Properties, siehe README 2), dunkles und helles Thema
- [x] **[S]** Abmelden zusätzlich auf der Einstellungsseite anbieten – bis M8 liegt es nur in der Kopfzeile
- [ ] **[S]** Fokus nach einem Seitenwechsel auf die neue Überschrift setzen, damit Screenreader den Wechsel mitbekommen (mit dem Barrierefreiheitsdurchgang)

## M8 – Frontend-Funktionen

- [x] **[L]** Scanner-Ansicht: Kamerastream, `zxing-wasm`-Decoder, Erkennungsrahmen, Rückmeldung per Vibration und Ton
- [x] **[S]** Kamera-Auswahl (Rückkamera bevorzugt), Torch-Schalter, wenn verfügbar
- [x] **[S]** Fehlerfälle sauber erklären: kein secure context, Berechtigung verweigert, keine Kamera
- [x] **[S]** Manuelle EAN-Eingabe mit Prüfziffernvalidierung als gleichwertiger Weg
- [x] **[M]** Nach dem Scan: bekanntes Produkt → Detailseite, unbekanntes → Anlegeformular mit vorbelegter EAN
- [x] **[M]** Produktformular: Name, Marke, Kategorie, Notizen; Kategorie als Vorschlagsliste aus vorhandenen Werten
- [x] **[S]** Route für die Kategorievorschläge nachziehen (`GET /api/v1/products/categories`, vorhandene Werte des Katalogs)
- [x] **[M]** Foto aufnehmen oder auswählen (`<input type="file" accept="image/*" capture="environment">`), Vorschau, clientseitige Vorverkleinerung vor dem Upload
- [x] **[S]** Upload-Fortschritt und Wiederholung bei Fehlern
- [x] **[M]** Sterne-Widget: touchfreundlich, halbe Sterne nicht nötig, 0 Sterne bewusst möglich
- [x] **[M]** Produktliste: Suchfeld, Filter, Sortierung, unendliches Nachladen, Thumbnails
- [x] **[M]** Produktdetailseite: Foto groß, eigene Bewertung, Durchschnitt, Bearbeiten, Löschen
- [x] **[S]** Ansicht „Meine Bewertungen“ auf Basis von `GET /api/v1/ratings/mine`, sortierbar nach Datum, Sternen und Name
- [x] **[S]** Leere Zustände und Ladeskelette
- [x] **[S]** Einstellungsseite: Passwort ändern, eigene Sessions, Abmelden
- [x] **[S]** Adminbereich: Nutzer, Einladungen erzeugen und teilen
- [ ] **[S]** „Alle anderen Sitzungen abmelden“ auf der Einstellungsseite anbieten – `DELETE /api/v1/auth/sessions` und der Client-Aufruf existieren seit M3, nur die Schaltfläche fehlt
- [ ] **[S]** Kamerawahl auf dem iPhone prüfen: Safari liefert für die Rückkameras mehrere Einträge mit gleichem Label, eine Unterscheidung nach Brennweite fehlt (mit dem Gerätetest in M9)
- [ ] **[S]** Suchbegriff und Filter des Katalogs beim Zurücknavigieren erhalten – aktuell sind sie Zustand der Ansicht und gehen beim Wechsel auf ein Produkt verloren
- [ ] **[S]** Ton und Vibration beim Treffer abschaltbar machen, sobald es eine Stelle für persönliche Einstellungen gibt

## M9 – PWA und iOS

- [x] **[S]** `vite-plugin-pwa` einrichten, Manifest (`display: standalone`, `theme_color`, `background_color`, Start-URL)
- [x] **[S]** Icons erzeugen: 192, 512, maskable, `apple-touch-icon` 180
- [x] **[S]** iOS-Metatags, `viewport-fit=cover`, `env(safe-area-inset-*)` im Layout
- [x] **[S]** Service Worker: App-Shell vorcachen, API-Antworten nicht blind cachen
- [x] **[S]** Sichtbare Aktualisierungsaufforderung bei neuer Version
- [x] **[S]** Offline-Hinweisseite statt Browser-Fehlerseite
- [ ] **[M]** Auf einem echten iPhone prüfen: Installation, Scanner, Kamera-Upload, Sitzung überlebt Neustart, Safe-Area-Layout
- [x] **[S]** In den Proxy-Beispielen (M12) sicherstellen, dass `sw.js` und `index.html` nicht mit langer Lebensdauer gecacht werden, `/assets/` dagegen schon – sonst bleiben Geräte auf einem alten Bundle stehen. Seit M10 setzt die Anwendung diese Header selbst; die Beispiele dürfen sie also nur durchreichen und nicht überschreiben
- [ ] **[S]** Aktualisierungshinweis auch außerhalb von `AppLayout` zeigen (Anmeldemaske, Registrierung) – dort hängt er derzeit nicht im Baum
- [ ] **[S]** Beim Übernehmen einer neuen Version vor ungespeicherten Eingaben warnen, statt nur nicht von selbst neu zu laden

## M10 – Docker

- [x] **[M]** Mehrstufiges `Dockerfile` (Build-Stufe, schlanke Laufzeitstufe, nicht-privilegierter Nutzer)
- [x] **[S]** Entrypoint: Verzeichnisse anlegen, Secret erzeugen, falls nicht vorhanden, Migrationen ausführen (`node dist/migrate.js`)
- [x] **[S]** `docker-compose.yml` mit Volume `/data` und gemounteter Konfiguration
- [x] **[S]** `HEALTHCHECK` auf `/healthz`
- [x] **[S]** `.dockerignore`
- [x] **[S]** Multi-Arch-Build für `linux/amd64` und `linux/arm64` dokumentieren
- [x] **[S]** Compose-Beispiel mit Caddy als vorgelagertem TLS-Proxy
- [x] **[M]** Auslieferung der gebauten Oberfläche durch den Server selbst (`server.static_dir`, `@fastify/static`, App-Shell-Fallback, Cache-Regeln) – ohne sie wäre das Image nur die API, während README 2 „API und Frontend in einem Prozess“ zusagt
- [ ] **[M]** Image real bauen und starten: `docker build`, `docker compose up`, Anmeldung, Scan, Foto-Upload, Neustart mit vorhandenem Volume, `docker compose pull && up -d` als Update – in der Entwicklungsumgebung stand kein Docker-Daemon zur Verfügung, geprüft wurde bisher nur der Laufzeitpfad ohne Container (Entrypoint, gebautes Bundle, Auslieferung, `npm prune --omit=dev`)
- [ ] **[S]** Multi-Arch-Bau auf `linux/arm64` einmal durchführen und die Prebuilds von `better-sqlite3` und `sharp` bestätigen
- [ ] **[S]** Image-Größe prüfen: `npm prune --omit=dev` lässt auch die Laufzeitabhängigkeiten des Web-Workspaces (React, Router, `zxing-wasm`) im Baum, obwohl das Image nur das gebaute Bundle braucht; dazu die Frage, ob die Sourcemaps in der Laufzeitstufe bleiben

## M11 – Debian-Paket

- [x] **[M]** `packaging/debian/control`: Paketname, Abhängigkeit `nodejs (>= 22)`, `adduser`, architekturabhängig
- [x] **[M]** Buildskript `npm run package:deb`: Bundle bauen, Baum unter `packaging/build/` aufbauen, `dpkg-deb --build`
- [x] **[S]** Dateibaum: `/opt/product-rating`, `/etc/product-rating`, `/var/lib/product-rating/{db,uploads,tmp}`, `/var/log/product-rating`
- [x] **[S]** `conffiles`: `/etc/product-rating/config.toml` registrieren, damit Änderungen Updates überleben
- [x] **[M]** `postinst`: Systemnutzer anlegen, Verzeichnisse und Rechte setzen, Secret erzeugen (`0600`), Migrationen ausführen (`node dist/migrate.js`), Dienst aktivieren
- [x] **[S]** Prüfen, dass `dist/migrations/` im Paket und im Image landet – der Runner liest die SQL-Dateien zur Laufzeit
- [x] **[S]** `prerm` / `postrm`: Dienst stoppen, bei `purge` Konfiguration und Daten nach Rückfrage entfernen
- [x] **[S]** systemd-Unit mit Härtung: `ProtectSystem=strict`, `ReadWritePaths`, `NoNewPrivileges`, `PrivateTmp`, `Restart=on-failure`
- [x] **[S]** `/usr/bin/product-rating` als Wrapper auf die CLI
- [x] **[S]** logrotate-Regel für `/var/log/product-rating/`
- [x] **[S]** Lintlauf mit `lintian`, gemeldete Punkte abarbeiten
- [x] **[M]** Installation in einer sauberen Debian-VM oder einem Container testen: install, Konfiguration ändern, Neustart, Upgrade, remove, purge
- [ ] **[S]** Architekturen `amd64` und `arm64` bauen (native Module!) – `amd64` ist gebaut und geprüft, für `arm64` fehlte die Maschine; das Bauskript lehnt einen Fremdbau bewusst ab, README 7.2 nennt den Weg über einen `linux/arm64`-Container
- [ ] **[S]** Dienststart unter echtem systemd prüfen: die Härtung der Unit
      (`ProtectSystem=strict`, `SystemCallFilter=@system-service`, leeres
      `CapabilityBoundingSet`) ist bisher nur gelesen, nicht ausgeführt – in der
      Entwicklungsumgebung lief kein systemd. Geprüft wurde der Dienst als
      derselbe Systemnutzer mit demselben Aufruf, aber ohne die Sandbox
- [x] **[S]** Versionsschema festlegen (M14) und das Paket daraus versorgen –
      zurzeit nimmt `build-deb.sh` die `0.0.0` aus `package.json`, und
      `packaging/debian/changelog` wird von Hand gepflegt. Erledigt: SemVer,
      eine Nummer für das ganze Repository, `packaging/debian/changelog` bleibt
      von Hand gepflegt, aber `server/src/version.test.ts` besteht darauf, dass
      alle Stellen dieselbe nennen (README 9.1)
- [ ] **[S]** Beim Löschen des Pakets bleibt `/opt` als von dpkg angelegtes
      Verzeichnis zurück; harmlos, aber es lohnt zu prüfen, ob das Paket den
      Eintrag für `/opt` selbst gar nicht mitliefern muss

## M12 – Mitgelieferte Konfigurationen

- [x] **[M]** `packaging/examples/nginx/product-rating.conf`: TLS-Vhost, `proxy_pass`, `client_max_body_size`, `X-Forwarded-*`, Security-Header, Cache-Regeln für Assets
- [x] **[S]** nginx-Variante für Betrieb unter einem Unterpfad
- [x] **[M]** `packaging/examples/apache2/product-rating.conf`: `mod_proxy`-Vhost, `ProxyPreserveHost`, `RequestHeader set X-Forwarded-Proto`, `LimitRequestBody`, benötigte Module dokumentiert
- [x] **[S]** `packaging/examples/caddy/Caddyfile`
- [x] **[S]** `packaging/examples/traefik/dynamic.yml` plus Compose-Labels
- [x] **[S]** `packaging/examples/systemd/override.conf` als Vorlage für abweichende Pfade
- [x] **[S]** `packaging/examples/ufw/product-rating` – Applikationsprofil
- [x] **[M]** `packaging/examples/backup/product-rating-backup` – Skript nach den Skript-Konventionen (Header, `--help`, Silent-/Verbose-Modus, Logging über `logger`), plus systemd-Timer
- [x] **[S]** In allen Proxy-Beispielen darauf hinweisen, dass `server.base_url` der öffentlichen Adresse entsprechen muss – sonst schlägt die Origin-Prüfung schreibender Anfragen fehl
- [x] **[S]** Jede Beispielkonfiguration einmal real gegen die laufende App testen
- [x] **[S]** Querverweise in `README.md` prüfen
- [x] **[S]** Nichts weiter zu tun fürs Paket: `packaging/build-deb.sh` legt ein vorhandenes `packaging/examples/` von sich aus nach `/usr/share/doc/product-rating/examples/` – nach dem Anlegen einmal im gebauten Paket nachsehen
- [ ] **[S]** Die Compose-Labels für Traefik sind als Einzige nicht real gelaufen – in der Entwicklungsumgebung gab es keinen Docker-Daemon. Geprüft wurden dieselben Einstellungen als `dynamic.yml` gegen ein echtes Traefik 3.5; die Labels sind daraus übersetzt und nur auf gültiges YAML geprüft
- [ ] **[S]** nginx-Beispiele einmal gegen nginx >= 1.25.1 laufen lassen: getestet wurde mit 1.24 (Ubuntu 24.04), das `http2 on;` noch nicht kennt und deshalb im Test durch `listen 443 ssl http2;` ersetzt wurde. Ausgeliefert ist die neue Schreibweise mit dem Hinweis auf die alte
- [ ] **[S]** Unterpfad-Bau in Docker gegenprüfen: das Build-Argument `PRODUCT_RATING_BASE_PATH` im `Dockerfile` ist bisher nur gelesen, gebaut wurde ohne Daemon nichts. Der Weg über `npm run build` (und damit auch `npm run package:deb`) ist geprüft

## M13 – CLI und Betrieb

- [x] **[S]** CLI-Gerüst (`product-rating <befehl>`) mit `--help` und Exit-Codes
- [x] **[S]** `serve`, `migrate`
- [x] **[S]** `user add|list|disable|passwd`, `invite create|list|revoke` – dazu `user enable`, weil `disable` sonst nur über die Weboberfläche zurückzunehmen ist
- [x] **[M]** `backup --to <verzeichnis>`: SQLite `VACUUM INTO` plus Uploads, mit Zeitstempel und optionaler Aufbewahrungsgrenze (`--keep-days`)
- [x] **[M]** `restore --from <verzeichnis>` mit ausdrücklicher Bestätigung
- [x] **[S]** `fsck` – verwaiste Dateien und Datenbankeinträge finden
- [x] **[S]** `/healthz` liefert Version, DB-Erreichbarkeit, Schreibbarkeit der Uploads
- [x] **[S]** Strukturiertes Logging (pino) mit den Zielen stdout, Datei und syslog
- [x] **[S]** `log.format` und `log.destination` tatsächlich anwenden – seit M1 validiert, wirksam ist bislang nur `log.level`
- [x] **[S]** CLI-Argumente aus M1 (`--config`, `--set`, Kurzformen) in `--help` aufnehmen
- [ ] **[S]** Handbuchseite (`man 1 product-rating`) aus den Hilfetexten erzeugen und ins Paket legen; bis dahin steht dafür ein `lintian`-Override
- [ ] **[S]** `restore` kann nicht prüfen, ob der Dienst noch läuft – SQLite gibt darüber im Leerlauf keine Auskunft. Es bleibt bei Hinweis und Vorab-Kopie; eine Sperrdatei des laufenden Servers wäre der Weg, wenn das je stört
- [ ] **[S]** Der syslog-Weg läuft über `logger` (util-linux), weil Node keine Unix-Datagram-Sockets kann. Falls das je stört: eigenes natives Modul oder ein Dienst, der auf einem Stream-Socket lauscht

## M14 – Qualitätssicherung und Release

- [x] **[M]** Integrationstests über die API: Registrierung → Produkt anlegen → Foto → Bewertung → Suche
- [x] **[S]** Testabdeckung für EAN-Validierung, Konfigurationsauflösung und Berechtigungen sicherstellen
- [x] **[M]** GitHub-Actions-Workflow: lint, typecheck, test, build
- [x] **[M]** Release-Workflow: Debian-Pakete (amd64, arm64) und Container-Images bauen und anhängen
- [x] **[S]** Versionsschema festlegen (SemVer) und `CHANGELOG` oder `HISTORY.md` als Quelle bestimmen. Dazu gehört `server/package.json`: daraus lesen seit M13 `product-rating version` und `/healthz`, und dort steht bislang `0.0.0`
- [x] **[S]** Sicherheitsdurchsicht vor dem ersten Release: Header, Cookies, Limits, Dateirechte
- [x] **[S]** Content-Security-Policy und die übrigen Sicherheits-Header setzen – README 4 nennt sie unter „Härtung“, umgesetzt ist bisher keiner; seit M10 liefert die Anwendung das HTML selbst aus, also gehört die Regel in den Server und nicht nur in die Proxy-Beispiele
- [x] **[S]** Installationsanleitung anhand einer Neuinstallation gegenprüfen
- [ ] **[S]** `1.0.0` vergeben, sobald die erste Installation produktiv läuft. M14 hat `0.1.0` gesetzt, weil bis dahin niemand die Anwendung im Alltag benutzt hat
- [ ] **[S]** Ratenbegrenzung für Uploads nachrüsten oder endgültig verwerfen. README nannte sie unter „Härtung“, gebaut war sie nie; die Durchsicht hat den Text auf den Stand gebracht (Größenlimit, eine Datei je Anfrage, 100-Megapixel-Grenze). Ein angemeldetes Konto gehört zum Haushalt, deshalb ist der Nutzen gering – wenn, dann als Schutz gegen ein Skript, das eine Platte vollschreibt
- [ ] **[S]** Die 100-Megapixel-Grenze der Bildverarbeitung ist ungetestet: ein Testbild dieser Größe zu erzeugen kostet mehr Speicher, als ein Testlauf haben sollte. Geprüft ist nur, dass die Option gesetzt wird
- [ ] **[S]** Die beiden Workflows sind noch nie gelaufen – sie werden mit diesem Commit überhaupt erst angelegt. Beim ersten Lauf gegenprüfen: `ubuntu-24.04-arm` als Runner, das Anmelden an der GHCR, `push-by-digest` und das Zusammenführen der Manifeste
- [ ] **[S]** Der Installationsdurchlauf lief ohne systemd (Container ohne PID 1): Verzeichnisse, Rechte, Secret, Migrationen, CLI, Start des Servers und `purge` sind geprüft, `systemctl start` und der Neustart beim Upgrade nicht. Der CI-Workflow holt genau das auf einem echten Runner nach

---

## Backlog (nach dem MVP)

- [x] Mehrere Fotos pro Produkt inklusive Sortierung
- [ ] Tags und freie Kategorien mit Autovervollständigung
- [x] Papierkorb mit Wiederherstellung statt endgültigem Löschen
- [x] Export nach CSV und JSON, Import zum Umzug
- [ ] Offline-Erfassung mit Sync-Queue (IndexedDB) und Konfliktbehandlung
- [ ] Statistiken: Bewertungsverteilung, meistbewertete Marken
- [x] Fremde Bewertungen sichtbar machen: wer im Haushalt hat wie viele Sterne vergeben – bisher liefert die API nur Durchschnitt, Anzahl und die eigene Bewertung
- [x] FTS5-Suche nachrüsten, falls die `LIKE`-Suche mit wachsendem Katalog spürbar langsam wird
- [ ] TOTP-Zweitfaktor
- [ ] Optionale Delegation der Authentifizierung an Reverse-Proxy-SSO
- [ ] Preisverlauf und Einkaufsort je Produkt
- [ ] Teilen einer Produktansicht per zeitlich begrenztem Link
- [ ] Barrierefreiheitsdurchgang (Fokusreihenfolge, Kontraste, Screenreader)
- [ ] Mehrere Fotos gleichzeitig auswählen und hochladen (die Ansicht nimmt bewusst eines nach dem anderen)
- [ ] PostgreSQL als alternatives Backend, falls jemals nötig
