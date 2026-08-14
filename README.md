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
        └── <paths.uploads>    Originalfotos + Thumbnails
```

Beide Speicherorte sind frei konfigurierbar (siehe Abschnitt 6).

### Technologie-Entscheidungen

| Ebene          | Wahl                                    | Begründung |
|----------------|-----------------------------------------|------------|
| Backend        | Node.js 22 LTS + TypeScript + Fastify   | Eine Sprache im ganzen Repo, kleiner Footprint |
| DB-Zugriff     | Drizzle ORM + better-sqlite3            | Typsichere Queries, versionierte SQL-Migrationen, offener Weg zu PostgreSQL |
| Datenbank      | SQLite im WAL-Modus                     | Keine zweite Instanz nötig, Backup = Datei kopieren, ausreichend für Einzelplatz-/Haushaltsbetrieb |
| Frontend       | React + Vite + TypeScript               | Standard-Toolchain, gute PWA-Integration |
| PWA            | `vite-plugin-pwa` (Workbox)             | Manifest und Service Worker aus einer Quelle |
| Barcode        | `zxing-wasm` im Browser                 | iOS Safari bietet **keine** `BarcodeDetector`-API; WASM-Decoder ist der verlässliche Weg |
| Bildverarbeitung | `sharp`                               | Re-Encoding, EXIF-Entfernung (inkl. GPS), Thumbnails |
| Passwort-Hash  | argon2id                                | Aktueller Standard |
| Konfiguration  | TOML-Datei + Umgebungsvariablen         | Kommentierbar, gut von Hand pflegbar, gut als Debian-`conffile` geeignet |

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
- **Härtung:** Rate-Limit auf Login und Upload, CSRF-Schutz über `SameSite=Lax`
  plus Origin-Prüfung, Content-Security-Policy, `/healthz`-Endpunkt.
  Die Origin-Prüfung greift bei jeder schreibenden Anfrage, die ein
  Session-Cookie mitbringt: `Origin` beziehungsweise `Referer` muss zu
  `server.base_url` oder zu `server.trusted_origins` passen.
- **Kein ausgehender Netzwerkverkehr.** Es gibt bewusst keine Anbindung an eine
  externe Produktdatenbank; alle Produktdaten werden lokal erfasst.

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
  `product-rating user add --admin`. Die Variablen wirken nur, solange die
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
cd product-rating
cp config/config.example.toml config/config.toml   # anpassen
docker compose up -d
```

- Image mehrstufig gebaut, läuft als nicht-privilegierter Nutzer.
- Ein Volume `/data` mit `db/`, `uploads/`, `tmp/`; die Konfiguration wird nach
  `/etc/product-rating/config.toml` gemountet.
- `HEALTHCHECK` auf `/healthz`.
- Migrationen laufen beim Start automatisch.
- Images für `linux/amd64` und `linux/arm64` (Raspberry Pi, ARM-NAS).

### 7.2 Debian-Paket

```bash
sudo apt install ./product-rating_<version>_<arch>.deb
sudoedit /etc/product-rating/config.toml
sudo systemctl enable --now product-rating
```

Installationslayout:

| Pfad | Inhalt |
|------|--------|
| `/opt/product-rating/` | Anwendungsbundle (Server, Frontend, Abhängigkeiten) |
| `/etc/product-rating/config.toml` | Konfiguration, als `conffile` registriert – Änderungen überleben Updates |
| `/etc/product-rating/secret.env` | Session-Secret, `0600`, im `postinst` erzeugt |
| `/var/lib/product-rating/{db,uploads,tmp}` | Nutzdaten |
| `/var/log/product-rating/` | Logs, sofern `log.destination = "file"` |
| `/lib/systemd/system/product-rating.service` | Dienst, gehärtet (`ProtectSystem=strict`, `ReadWritePaths`, `NoNewPrivileges`) |
| `/etc/logrotate.d/product-rating` | Logrotation |
| `/usr/bin/product-rating` | CLI: `serve`, `migrate`, `user add`, `invite create`, `backup` |
| `/usr/share/doc/product-rating/examples/` | Vorgefertigte Konfigurationen für Fremdkomponenten |

Das `postinst` legt den Systemnutzer `product-rating` an, erzeugt Verzeichnisse
und Secret, führt die Migrationen aus und startet den Dienst. `purge` entfernt
Konfiguration und Nutzdaten erst nach Rückfrage.

Weil `better-sqlite3` und `sharp` native Module enthalten, wird das Paket je
Architektur gebaut (`amd64`, `arm64`). Abhängigkeit: `nodejs (>= 22)`.

### 7.3 Mitgelieferte Konfigurationen für Fremdkomponenten

Unter `/usr/share/doc/product-rating/examples/` (im Repo: `packaging/examples/`):

- **nginx** – `nginx/product-rating.conf`: Vhost mit TLS, `proxy_pass` auf
  `127.0.0.1:8080`, `client_max_body_size` passend zum Upload-Limit,
  `X-Forwarded-*`-Header, Cache-Header für statische Assets, Security-Header.
  Zusätzlich eine Variante für den Betrieb in einem Unterpfad.
- **Apache 2.4** – `apache2/product-rating.conf`: Vhost mit `mod_proxy`,
  `mod_proxy_http`, `mod_headers`, `mod_ssl`; `ProxyPreserveHost On`,
  `RequestHeader set X-Forwarded-Proto https`, `LimitRequestBody` passend zum
  Upload-Limit. Benötigt `a2enmod proxy proxy_http headers ssl`.
- **Caddy** – `caddy/Caddyfile`: kürzeste Variante inklusive automatischem TLS.
- **Traefik** – `traefik/dynamic.yml` sowie Compose-Labels.
- **systemd** – Unit und eine `override.conf`-Vorlage für abweichende Pfade.
- **logrotate** – Rotationsregel für `/var/log/product-rating/`.
- **Backup** – `backup/product-rating-backup` (Skript, konsistentes
  SQLite-`.backup` plus Upload-Verzeichnis) und passende systemd-Timer-Vorlage.
- **ufw** – Applikationsprofil.

---

## 8. Betrieb

- **Backup:** `product-rating backup --to <verzeichnis>` erzeugt einen
  konsistenten SQLite-Snapshot (`VACUUM INTO`) und sichert die Uploads. Ein
  einfaches Kopieren der `.db` im laufenden Betrieb ist wegen WAL nicht sicher.
- **Update:** `apt install ./product-rating_<neue-version>.deb` beziehungsweise
  `docker compose pull && docker compose up -d`. Migrationen laufen automatisch;
  vorher wird ein Datenbank-Snapshot angelegt.
- **Monitoring:** `/healthz` (Prozess und DB-Erreichbarkeit), strukturierte
  JSON-Logs nach stdout, Datei oder syslog.

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
packaging/  debian/, examples/ (nginx, apache2, caddy, traefik, logrotate, backup)
docker/     Dockerfile, docker-compose.yml, Entrypoint
```

Weitere Dokumente: [CLAUDE.md](CLAUDE.md) (Arbeitsanweisungen und
Projektkonventionen), [TODO.md](TODO.md) (Umsetzungsschritte),
[HISTORY.md](HISTORY.md) (abgeschlossene Arbeiten).
