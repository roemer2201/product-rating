# HISTORY

Dokumentation abgeschlossener Arbeiten. Neueste Einträge stehen oben. Jeder
Eintrag nennt Datum, Umfang der Arbeit und die dabei getroffenen Entscheidungen.

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
