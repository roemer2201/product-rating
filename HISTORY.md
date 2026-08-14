# HISTORY

Dokumentation abgeschlossener Arbeiten. Neueste Einträge stehen oben. Jeder
Eintrag nennt Datum, Umfang der Arbeit und die dabei getroffenen Entscheidungen.

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
