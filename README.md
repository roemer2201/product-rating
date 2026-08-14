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
- **Sessions:** serverseitig in SQLite, Cookie `HttpOnly`, `Secure`,
  `SameSite=Lax`. Laufzeit standardmäßig 90 Tage mit rollierender Verlängerung –
  wichtig, damit die Home-Bildschirm-PWA nicht bei jedem Öffnen nach dem Passwort
  fragt. Einzelne Sessions lassen sich serverseitig sofort widerrufen.
- **Uploads:** `multipart/form-data`, Größenlimit und MIME-Whitelist aus der
  Konfiguration, serverseitiges Re-Encoding mit `sharp`. Das entfernt EXIF-Daten
  (inklusive GPS-Position) und entschärft manipulierte Bilddateien.
- **Medienzugriff** ausschließlich über eine authentifizierte Route mit
  Berechtigungsprüfung – keine erratbaren Direktlinks im Webroot.
- **Härtung:** Rate-Limit auf Login und Upload, CSRF-Schutz über `SameSite=Lax`
  plus Origin-Prüfung, Content-Security-Policy, `/healthz`-Endpunkt.
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
  `product-rating user add --admin`.
- Weitere Konten entstehen nur über **Einladungscodes**
  (`product-rating invite create`, oder in der Weboberfläche als Admin).
- Rollen: `admin` (Nutzerverwaltung, Einladungen, alle Daten) und `user`
  (eigene Bewertungen und Fotos, gemeinsamer Produktkatalog).
- Nachrüstbar: TOTP-2FA oder Delegation an ein Reverse-Proxy-SSO
  (Authelia/Authentik) über vertrauenswürdige Header.

---

## 6. Konfiguration

Die App liest eine TOML-Datei. Suchreihenfolge:

1. `--config <pfad>`
2. `$PRODUCT_RATING_CONFIG`
3. `/etc/product-rating/config.toml` (Debian-Paket)
4. `./config/config.toml` (Entwicklung)

Vorrang der Quellen: **Standardwerte < Konfigurationsdatei < Umgebungsvariablen
< CLI-Argumente.** Jeder Schlüssel lässt sich per Umgebungsvariable überschreiben,
Schema `PR_<SEKTION>__<SCHLÜSSEL>`, zum Beispiel `PR_PATHS__DATABASE`.

```toml
[server]
host      = "127.0.0.1"
port      = 8080
base_url  = "https://products.example.com"   # für absolute Links und Cookies
trust_proxy = true                            # X-Forwarded-* auswerten

[paths]
database = "/var/lib/product-rating/db/app.db"
uploads  = "/var/lib/product-rating/uploads"
temp     = "/var/lib/product-rating/tmp"

[uploads]
max_file_size_mb = 15
allowed_mime     = ["image/jpeg", "image/png", "image/webp", "image/heic"]
thumbnail_px     = 400
detail_px        = 1600
strip_exif       = true

[auth]
secret_file                  = "/etc/product-rating/secret.env"
session_ttl_days             = 90
session_renew_threshold_days = 7
invite_ttl_days              = 14
login_rate_limit_per_minute  = 5
argon2_memory_mib            = 64

[log]
level       = "info"      # error | warn | info | debug
format      = "json"      # json | pretty
destination = "stdout"    # stdout | file | syslog
file        = "/var/log/product-rating/app.log"

[app]
title            = "product-rating"
external_lookup  = false  # bewusst deaktiviert: reiner Offline-Betrieb
```

Die Speicherorte für Datenbank und Bilder sind damit frei wählbar – etwa auf
einem NAS-Mount oder einer separaten Platte. Beim Start prüft die App, ob die
Verzeichnisse existieren und beschreibbar sind, und bricht andernfalls mit einer
klaren Fehlermeldung ab.

Das Session-Secret steht **nicht** in der Konfigurationsdatei, sondern in einer
eigenen Datei mit Rechten `0600` (`secret_file`), die bei der Installation
beziehungsweise beim ersten Containerstart erzeugt wird.

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

```bash
npm install                 # npm-Workspaces: server, web, shared
npm run dev                 # API auf :8080, Vite-Dev-Server auf :5173
npm run migrate             # Migrationen anwenden
npm test                    # Vitest
npm run lint && npm run typecheck
npm run build               # Produktions-Bundle nach dist/
npm run package:deb         # Debian-Paket bauen
```

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
