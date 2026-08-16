# Mitgelieferte Konfigurationen

Vorlagen für die Fremdkomponenten rund um product-rating. Im Debian-Paket
liegen sie unter `/usr/share/doc/product-rating/examples/`.

Keine dieser Dateien wird von der Anwendung gelesen oder beim Aktualisieren
angefasst – es sind Vorlagen zum Kopieren und Anpassen. Was in jeder einzelnen
zu ändern ist, steht als Kommentar in der Datei selbst.

| Datei | Wofür |
| --- | --- |
| `nginx/product-rating.conf` | nginx-Vhost mit TLS, eigener Hostname |
| `nginx/product-rating-subpath.conf` | nginx unter einem Unterpfad eines bestehenden Hosts |
| `apache2/product-rating.conf` | Apache-2.4-Vhost mit `mod_proxy` |
| `caddy/Caddyfile` | Caddy auf dem Host, Zertifikat automatisch |
| `traefik/dynamic.yml` | Traefik 3 über den File-Provider |
| `traefik/docker-compose.labels.yml` | dasselbe als Container-Labels |
| `systemd/override.conf` | Drop-in für abweichende Pfade, Ports, Log-Stufe |
| `ufw/product-rating` | ufw-Applikationsprofil |
| `backup/product-rating-backup` | Backup-Skript (SQLite-Snapshot plus Fotos) |
| `backup/product-rating-backup.service` | systemd-Unit dazu |
| `backup/product-rating-backup.timer` | tägliche Ausführung |

Die systemd-Unit des Dienstes selbst und die logrotate-Regel sind keine
Vorlagen, sondern Bestandteil des Pakets: sie liegen nach der Installation
unter `/usr/lib/systemd/system/product-rating.service` und
`/etc/logrotate.d/product-rating`. Die Unit wird nicht bearbeitet, sondern mit
`systemctl edit product-rating` überschrieben – dafür ist `systemd/override.conf`
da.

## Drei Dinge, die in jedem Proxy-Beispiel zusammenpassen müssen

1. **`server.base_url`** muss der Adresse entsprechen, unter der der Browser die
   App aufruft. Jede schreibende Anfrage wird gegen diese Herkunft geprüft;
   stimmt sie nicht, lädt die Oberfläche und jedes Speichern scheitert mit 403.
2. **`server.trust_proxy = true`**, sonst sehen Log und Anmelde-Ratenbegrenzung
   den Proxy statt des Clients.
3. **Das Größenlimit des Proxys** muss über `uploads.max_file_size_mb` liegen
   (Standard 15 MB) – sonst bricht der Upload im Proxy ab und die Oberfläche
   sieht nur eine abgerissene Verbindung. Die Beispiele stehen auf 20 MB. Ist
   das Bild zu groß, soll die Anwendung ablehnen: sie antwortet mit einem
   lesbaren Fehler, der Proxy nur mit 413.

## Was die Beispiele bewusst nicht tun

Sie setzen **keine Cache-Header**. Die Anwendung setzt sie selbst und ist die
einzige Stelle, die die beiden Fälle unterscheiden kann: Dateien unter
`/assets/` tragen einen Hash im Namen und sind ein Jahr lang unveränderlich,
während `index.html`, `sw.js` und das Manifest ihre Namen über Versionen hinweg
behalten und deshalb `no-cache` bekommen. Eine eigene Regel im Proxy
(`expires`, `ExpiresByType`, `header Cache-Control`) überschreibt genau das und
lässt installierte Home-Bildschirm-Apps auf einem alten Bundle sitzen.

Ebenso wenig setzen sie eine **Content-Security-Policy**. Die gehört in die
Anwendung, die ihr eigenes Bundle kennt (offen, M14); an zwei Stellen gepflegt
würde sie auseinanderlaufen.
