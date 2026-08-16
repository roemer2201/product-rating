# CLAUDE.md

Arbeitsanweisungen für Claude Code in diesem Repository. Die fachliche
Beschreibung steht in [README.md](README.md), der Umsetzungsplan in
[TODO.md](TODO.md), erledigte Arbeit in [HISTORY.md](HISTORY.md).

---

## 1. Was dieses Projekt ist

Selbst-hostbare Web-App (PWA) zum Erfassen von Produkten per EAN, mit Foto und
Bewertung von 0 bis 5 Sternen. Zielbetrieb: eigener Server oder NAS im Haushalt,
Nutzung überwiegend vom iPhone über eine zum Home-Bildschirm hinzugefügte PWA.

Zielgrößen: einstellige Nutzerzahl, bis in den sechsstelligen Bereich an
Produkten. Alles, was darüber hinaus skaliert, ist ausdrücklich kein Ziel.

---

## 2. Festgelegte Entscheidungen

Diese Punkte sind mit dem Projektinhaber abgestimmt. Sie sind **nicht ohne
Rückfrage zu ändern** – auch dann nicht, wenn eine Alternative naheliegt.

1. **TypeScript im gesamten Repo.** Backend Node.js 22 LTS + Fastify, Frontend
   React + Vite. Keine zweite Programmiersprache für Anwendungscode.
2. **SQLite über Drizzle ORM + better-sqlite3**, WAL-Modus. Kein PostgreSQL,
   solange nichts dagegen spricht; das Schema bleibt aber portabel (keine
   SQLite-Spezialitäten ohne Not).
3. **Gemeinsamer Produktkatalog.** Eine EAN existiert genau einmal
   (`products.ean UNIQUE`). Bewertungen und Fotos gehören je einem Nutzer,
   `UNIQUE (product_id, user_id)` bei `ratings`.
4. **Mehrbenutzerbetrieb mit Einladungscodes.** Keine offene Registrierung.
   Erster Admin über `BOOTSTRAP_ADMIN_*` oder CLI.
5. **Session-Cookies mit serverseitigem Store**, kein JWT. Lange, rollierende
   Laufzeit (Standard 90 Tage), damit die PWA nicht ständig nach Login fragt.
6. **Kein ausgehender Netzwerkverkehr im Betrieb.** Keine Anbindung an Open Food
   Facts oder andere externe Produktdatenbanken. `app.external_lookup` existiert
   als Schalter, bleibt aber auf `false` und ohne Implementierung, bis der
   Projektinhaber etwas anderes sagt.
7. **Fotos im Dateisystem**, nicht als BLOB in der Datenbank.
8. **Zwei gleichrangige Deployment-Wege:** Docker und Debian-Paket. Eine Änderung
   am Betriebsverhalten muss in beiden nachgezogen werden.
9. **Konfiguration in TOML** unter `/etc/product-rating/config.toml`, mit
   Überschreibung durch Umgebungsvariablen. Speicherorte für Datenbank und
   Uploads sind frei konfigurierbar und nirgends im Code fest verdrahtet.

---

## 3. Repository-Struktur

```
server/                 Fastify-API
  src/routes/           HTTP-Routen, dünn: Validierung → Service → Antwort
  src/services/         Fachlogik (products, ratings, photos, auth, users)
  src/db/schema.ts      Drizzle-Schema
  src/db/migrations/    Generierte SQL-Migrationen, aufsteigend nummeriert
  src/config/           Laden, Zusammenführen und Validieren der Konfiguration
  src/cli/              product-rating CLI (serve, migrate, user, invite, backup)
web/                    React-PWA
  src/routes/           Seiten
  src/components/       UI-Bausteine
  src/lib/api.ts        typisierter API-Client
  src/lib/scanner.ts    zxing-wasm-Kapselung
  public/               Icons: zwei SVG-Quellen, daraus erzeugte PNG
  scripts/              generate-icons.ts (Rasterung der Icons)
shared/                 Gemeinsame Typen und Zod-Schemata für Server und Web
config/config.example.toml
packaging/build-deb.sh  Bauskript des Debian-Pakets (npm run package:deb)
packaging/debian/       control, conffiles, templates, config/postinst/prerm/postrm,
                        systemd-Unit, logrotate-Regel, ausgelieferte config.toml,
                        CLI-Aufsatz, copyright, changelog, lintian-overrides
packaging/examples/     nginx (auch Unterpfad), apache2, caddy, traefik (Datei und
                        Compose-Labels), systemd-Drop-in, ufw, Backup-Skript mit Timer
docker/                 Dockerfile, docker-compose.yml, entrypoint
```

---

## 4. Befehle

```bash
npm install              # npm-Workspaces
npm run dev              # API :8080 + Vite :5173
npm test                 # Vitest
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit je Workspace
npm run format           # Prettier
npm run build            # Produktions-Bundle
npm start                # gebauten Server starten
```

Dazu `npm run migrate` und `npm run db:generate` (seit M2), `npm run fsck --
--uploads` (seit M6), im Web-Workspace `npm run icons` (Icons aus den
SVG-Quellen) und `npm run preview` (gebaute App auf :4173, der einzige Weg, den
Service Worker auszuprobieren) – beide seit M9 – sowie `npm run package:deb`
(Debian-Paket, seit M11; `-- --help` zeigt die Schalter).

Vor jedem Commit mindestens `npm run lint`, `npm run typecheck` und `npm test`
laufen lassen und Fehlschläge berichten, nicht stillschweigend übergehen.

---

## 5. Verbindliche technische Regeln

**Sicherheit**

- Passwörter ausschließlich mit **argon2id** hashen, nie selbst gebautes Hashing.
- Session-Cookies immer `HttpOnly`, `Secure`, `SameSite=Lax`. Session-IDs aus
  `crypto.randomBytes`, mindestens 32 Byte.
- Jeder Upload wird serverseitig mit `sharp` neu kodiert; EXIF-Daten werden
  entfernt (GPS-Position!). Der vom Client gelieferte Dateiname und MIME-Typ sind
  nie vertrauenswürdig; Dateinamen auf dem Server werden generiert.
- Medien nur über authentifizierte Routen ausliefern, nie als statisches
  Verzeichnis in den Webroot legen.
- Kein Geheimnis in die Konfigurationsdatei oder ins Repository. Secrets liegen
  in `secret_file` mit `0600`.
- Alle Eingaben serverseitig mit Zod validieren, auch wenn das Frontend bereits
  prüft.

**Datenbank**

- Schemaänderungen ausschließlich über generierte, eingecheckte Migrationen.
  Nie `db push` gegen eine Produktivdatenbank.
- Migrationen sind vorwärtsgerichtet und idempotent aufzusetzen; Migrationen, die
  Daten löschen können, brauchen vorher einen Snapshot.
- SQLite immer im WAL-Modus mit gesetztem `busy_timeout` und
  `foreign_keys = ON` öffnen.

**Konfiguration**

- Keine Pfade hart kodieren. Alles geht durch das Config-Objekt.
- Neue Konfigurationsschlüssel gehören **gleichzeitig** in
  `config/config.example.toml`, in das Zod-Schema, in die README-Tabelle und –
  falls betriebsrelevant – in die Beispielkonfigurationen unter
  `packaging/examples/`.
- Beim Start Konfiguration validieren und mit klarer Meldung abbrechen, wenn
  Verzeichnisse fehlen oder nicht beschreibbar sind.

**Frontend**

- Der Barcode-Scanner darf sich nicht auf `BarcodeDetector` verlassen; iOS Safari
  hat die API nicht. `zxing-wasm` ist der Standardweg, manuelle EAN-Eingabe der
  immer verfügbare Fallback.
- Kamerazugriff braucht HTTPS. Fehlt der secure context, muss die Oberfläche das
  erklären statt kommentarlos zu scheitern.
- Layout mit `viewport-fit=cover` und `env(safe-area-inset-*)`, Bedienelemente
  daumenfreundlich; primäre Aktion ist der Scan-Button.

**Shell-Skripte** (Maintainer-Skripte, Backup-Skript, Entrypoint)

- Es gelten die persönlichen Skript-Konventionen des Projektinhabers: Header mit
  Zweck und Ablaufbeschreibung, `--help`, Silent-/Verbose-Modus, Parameter über
  Umgebungsvariablen, Logging über `logger`/syslog, Englisch, ASCII, konsequentes
  Quoting von Variablen.
- Debian-Maintainer-Skripte zusätzlich: `set -e`, idempotent, korrekte Behandlung
  der Aktionen (`configure`, `remove`, `purge`, `upgrade`).

**Sprache**

- Dokumentation (`README.md`, `CLAUDE.md`, `TODO.md`, `HISTORY.md`): Deutsch.
- Code, Bezeichner, Kommentare, Log-Ausgaben, Commit-Nachrichten: Englisch.
- Oberflächentexte: Deutsch, zentral in einer Datei, damit i18n später möglich ist.

---

## 6. Arbeitsweise in diesem Repository

- **TODO.md ist die Arbeitsgrundlage.** Punkte werden der Reihe nach abgearbeitet
  und beim Abschluss abgehakt. Neue Erkenntnisse kommen als neue Punkte hinzu,
  statt still den Umfang zu verändern.
- **HISTORY.md wird bei jedem abgeschlossenen Arbeitspaket ergänzt** – Datum,
  was gemacht wurde, warum, und welche Entscheidungen dabei gefallen sind.
  Neueste Einträge oben.
- Ein Arbeitspaket entspricht einem Commit. Commit-Nachrichten im Imperativ,
  englisch, Präfix nach Bereich (`server:`, `web:`, `packaging:`, `docs:`).
- Entwicklung auf dem Branch `claude/ean-product-app-concept-oijwll`, sofern
  nichts anderes vereinbart ist. Kein Pull Request ohne ausdrückliche Aufforderung.
- `.claude/` ist über `.gitignore` ausgeschlossen und bleibt es.
- Beim Ändern von Betriebsverhalten prüfen: Ist Docker **und** das Debian-Paket
  angepasst? Sind die Beispielkonfigurationen noch stimmig?

---

## 7. Bekannte Fallstricke

- `better-sqlite3` und `sharp` sind native Module: Debian-Pakete und
  Docker-Images müssen je Architektur (`amd64`, `arm64`) gebaut werden.
- Ein laufendes SQLite im WAL-Modus lässt sich nicht durch bloßes Kopieren der
  `.db` sichern. Immer `VACUUM INTO` beziehungsweise die Backup-API verwenden.
- iOS-PWA: Der Service Worker cacht aggressiv. Beim Ausrollen neuer Versionen
  braucht es eine sichtbare Aktualisierungsaufforderung, sonst bleiben Nutzer auf
  alten Bundles hängen.
- iOS liefert Fotos je nach Gerät als HEIC; die Konvertierung nach JPEG/WebP muss
  serverseitig passieren.
- Upload-Limits existieren an drei Stellen: App-Konfiguration, Reverse Proxy
  (`client_max_body_size` bzw. `LimitRequestBody`) und gegebenenfalls Container.
  Alle drei müssen zusammenpassen. Bei Apache greift `LimitRequestBody` für
  Proxy-Anfragen nicht – dort begrenzt die Regel mit `mod_rewrite` in
  `packaging/examples/apache2/product-rating.conf`.
- Der Unterpfad (`PRODUCT_RATING_BASE_PATH`) wird beim **Bau** festgelegt und
  steckt in `index.html`, Manifest, Service Worker und in `API_BASE`. Wer an
  diesen Stellen etwas ändert, muss ihn mitdenken – ein Pfad lässt sich später
  nicht durch den Proxy umschreiben.
