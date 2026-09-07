# Codereview: product-rating

- **Datum:** 7. September 2026
- **Repository:** `roemer2201/product-rating`
- **Geprüfter Stand:** `main`, Commit [`7fa0e3a346c776bd23cdd96ab68e38a522dca5f8`](https://github.com/roemer2201/product-rating/commit/7fa0e3a346c776bd23cdd96ab68e38a522dca5f8)
- **Version:** 0.2.2
- **Umfang:** Codeprüfung mit Schwerpunkt auf Authentifizierung, Berechtigungen, Offline-Erfassung und Synchronisierung, Fotoverwaltung sowie Backup/Restore; ergänzende Sichtung von Produkt-/Bewertungsrouten, Import/Export, Konfiguration und Deployment. Kein vollständiger Penetrationstest oder Test auf einem realen iPhone.
- **Änderung:** Dieser Bericht; keine Fehlerbehebungen am Anwendungscode.

## Ergebnis

Sechs konkrete Funde: vier mit **P1** (zeitnah beheben: Zugangsschutz oder Datenverlust/-fehlzuordnung) und zwei mit **P2** (regulär beheben: fehlerhafter Wiederanlauf). P1 bedeutet hier nicht, dass ein beliebiger anonymer Besucher unmittelbar Konten übernehmen kann; die Voraussetzungen stehen beim jeweiligen Fund.

| ID | Priorität | Problem | Nachweis |
| --- | --- | --- | --- |
| R1 | P1 | Unvollständiger Snapshot wird akzeptiert; Restore löscht vorhandene Fotos | Reproduktion mit echten Dateien und SQLite |
| R2 | P1 | Offline-Erfassungen können unter dem falschen Benutzer synchronisiert werden | Statische Prüfung des vollständigen Datenflusses |
| R3 | P1 | Einmaliger Passwort-Link lässt sich gleichzeitig mehrfach einlösen | Zwei parallele Anfragen durch den echten API-Stack |
| R4 | P1 | Bestehender Passwort-Link bleibt nach Passwortwechsel gültig | Service-Test mit echtem Passwort-Hashing |
| R5 | P2 | Fehlerbehandlung setzt bereits gespeicherten Sync-Fortschritt zurück | IndexedDB-/Sync-Test mit kontrolliertem Netzwerkfehler |
| R6 | P2 | Automatische Synchronisierung wiederholt Fehler ohne Pause | Komponententest mit echtem Query-Client |

Alle Codeverweise beziehen sich auf den oben genannten Commit, nicht auf spätere Änderungen.

## R1 — [P1] Restore muss fehlende Uploads vor jeder Änderung ablehnen

**Fundstelle:** [`server/src/services/backup.ts:381–384`](https://github.com/roemer2201/product-rating/blob/7fa0e3a346c776bd23cdd96ab68e38a522dca5f8/server/src/services/backup.ts#L381-L384), ergänzend Zeilen 454–472.

**Fehler:** `inspectSnapshot()` prüft lediglich die SQLite-Datei mit `integrity_check`. Ein fehlendes `uploads/` macht den Snapshot nicht ungültig. `walkFiles()` übersetzt ein nicht vorhandenes Verzeichnis in eine leere Dateiliste. Beim Restore wird diese Liste als vollständiger Sollzustand behandelt: Alle vorhandenen Uploads bleiben in `present` und werden gelöscht.

**Auslöser und Auswirkung:** Ein unvollständig übertragener oder abgebrochener Snapshot enthält eine gültige `app.db`, aber kein Upload-Verzeichnis. Ein anschließendes Restore kann sämtliche noch vorhandenen Fotos der Zielinstanz löschen und erfolgreich zurückkehren. Das zuvor angelegte `pre-restore-*.db` enthält nur die Datenbank und rettet die gelöschten Bilddateien nicht.

**Reproduktion:** In einer Wegwerf-Instanz einen Upload ablegen, mit `createBackup()` sichern, ausschließlich `<snapshot>/uploads` entfernen und die Datenbankverbindung vor dem Restore schließen. `inspectSnapshot()` liefert weiterhin `null`. `restoreBackup()` liefert bei einem vorhandenen Testbild `removedFiles: 1`; die Datei existiert danach nicht mehr. Mit echten Dateien und SQLite bestätigt.

**Korrektur:** Vor dem Ersetzen der Datenbank die Existenz und Lesbarkeit des Upload-Verzeichnisses sowie die in der Snapshot-Datenbank referenzierten Originale und Thumbnails prüfen. Ein fehlendes Verzeichnis ist von einem vorhandenen, legitimerweise leeren Verzeichnis zu unterscheiden. Bei unvollständigem Snapshot ohne Änderungen abbrechen. Für einen fehlgeschlagenen Restore auch die bisherigen Uploads wiederherstellbar halten.

**Regressionstest:** Fehlender Upload-Ordner und fehlendes referenziertes Bild müssen den Restore vor der ersten Mutation abbrechen; vorhandene Datenbank und Uploads bleiben unverändert.

## R2 — [P1] Offline-Erfassungen sind nicht an das erfassende Konto gebunden

**Fundstelle:** [`web/src/lib/offlineQueue.ts:86–102`](https://github.com/roemer2201/product-rating/blob/7fa0e3a346c776bd23cdd96ab68e38a522dca5f8/web/src/lib/offlineQueue.ts#L86-L102), ergänzend `listCaptures()` in Zeilen 281–286, `web/src/lib/queries.ts:190–229` und `web/src/lib/sync.ts:188–208`.

**Fehler:** `Capture` enthält keine Benutzerkennung. Alle Erfassungen liegen im selben IndexedDB-Store und `listCaptures()` liest sie ungefiltert. Login und Logout leeren lediglich den React-Query-Cache; die persistenten Erfassungen bleiben bestehen. `syncCaptures()` verwendet für jede Erfassung die aktuell gültige Sitzung.

**Auslöser und Auswirkung:** Konto A hinterlässt eine noch nicht synchronisierte Erfassung auf einem gemeinsam verwendeten Browser. Vor dem nächsten erfolgreichen Sync wird dort Konto B angemeldet. Sobald die Synchronisierung läuft, werden A's Bewertungen, Preise und Fotos als Beiträge von B übertragen. Bei Bewertungen kann damit B's eigene Bewertung verändert werden. Auch die Warteschlange mit A's noch nicht übertragenen Notizen und Bildern ist nicht nach Konten getrennt.

**Nachweis:** Statisch durchgehend nachvollzogen: Datenmodell → IndexedDB-Abfrage → Login/Logout-Hooks → `SyncGate` im angemeldeten Layout → API-Aufrufe. Die schreibenden Serverrouten leiten den Besitzer korrekt aus `currentUser(request)` ab; ihnen fehlt die Information, dass die lokale Erfassung ursprünglich A gehörte. Kein automatisierter Browser-Kontowechseltest durchgeführt.

**Korrektur:** Erfassungen mit der ursprünglichen Benutzer-ID speichern und Lesen, Anzeigen sowie Synchronisieren an diese ID binden. Für einen Offline-Kaltstart die zuletzt bestätigte Identität berücksichtigen; Erfassungen ohne bestätigte Zuordnung vor dem Upload ausdrücklich zuordnen lassen. Beim Kontowechsel laufende Synchronisierung stoppen und vor weiteren Schreibschritten die Identität prüfen. Fremde Warteschlangen erhalten, ohne sie automatisch unter dem neuen Konto zu übertragen.

**Regressionstest:** A erfasst offline, danach meldet sich B an. B sieht und überträgt A's Erfassung nicht. Nach erneuter Anmeldung von A bleibt sie verfügbar und wird A zugeordnet.

## R3 — [P1] Passwort-Reset prüft und verbraucht den Token nicht atomar

**Fundstelle:** [`server/src/routes/auth.ts:242–252`](https://github.com/roemer2201/product-rating/blob/7fa0e3a346c776bd23cdd96ab68e38a522dca5f8/server/src/routes/auth.ts#L242-L252).

**Fehler:** Der Token wird vor `await setPassword(...)` geprüft und erst danach verbraucht. `setPassword()` wartet auf das asynchrone Argon2-Hashing. Währenddessen kann eine zweite Anfrage denselben noch gültigen Token ebenfalls erfolgreich prüfen. Beide Anfragen ändern anschließend das Passwort und erhalten eine Sitzung. `consumePasswordReset()` prüft weder den bisherigen Verbrauch noch, ob tatsächlich ein noch gültiger Datensatz geändert wurde.

**Auslöser und Auswirkung:** Zwei nahezu gleichzeitige Einlösungen desselben Links, etwa durch zwei Tabs oder durch einen zweiten Besitzer eines abgefangenen Links. Beide werden akzeptiert; die zuletzt abgeschlossene Änderung bestimmt das Passwort und widerruft die zwischenzeitlich erzeugte Sitzung. Die zugesicherte Einmaligkeit ist damit nicht gegeben. Voraussetzung für diesen Angriff ist der Besitz des gültigen Links.

**Reproduktion:** Über `createTestApp()` einen Benutzer und einen Reset-Link erzeugen. Zwei `app.inject()`-Anfragen an `POST /api/v1/auth/reset` mit gleichem Token und unterschiedlichen neuen Passwörtern mit `Promise.all()` starten. Ergebnis: **HTTP 200 und HTTP 200**, beide Antworten setzen `pr_session`. Echter API-Stack, echte SQLite-Datenbank und echtes Hashing; bestätigt.

**Korrektur:** Den neuen Hash vorab berechnen. Danach in einer synchronen Datenbanktransaktion den Token erneut auf Existenz, Ablauf und Verbrauch sowie den Kontostatus prüfen, einmalig beanspruchen, Passwort setzen und Sitzungen widerrufen. Nur die erfolgreiche Transaktion darf eine neue Sitzung erzeugen. Eine bereits verbrauchte oder zwischenzeitlich ersetzte Berechtigung muss scheitern.

**Regressionstest:** Zwei parallele Einlösungen ergeben genau einen Erfolg; die abgewiesene Anfrage ändert weder Passwort noch Sitzung.

## R4 — [P1] Passwortwechsel widerruft zuvor ausgestellte Reset-Links nicht

**Fundstelle:** [`server/src/services/users.ts:204–211`](https://github.com/roemer2201/product-rating/blob/7fa0e3a346c776bd23cdd96ab68e38a522dca5f8/server/src/services/users.ts#L204-L211), Aufrufer unter anderem `server/src/routes/auth.ts` und `server/src/routes/users.ts`.

**Fehler:** `setPassword()` ersetzt ausschließlich den Passwort-Hash und setzt `passwordResetRequired` zurück. Bestehende Zeilen in `passwordResets` bleiben erhalten. Auch die Passwortwechsel-Routen widerrufen lediglich Sitzungen, keine alten Reset-Links.

**Auslöser und Auswirkung:** Ein Administrator stellt einen Link aus. Anschließend setzt der Administrator ein neues Passwort direkt oder der Benutzer ändert sein Passwort regulär. Der alte, unbenutzte Link kann weiterhin bis zu seinem Ablauf ein weiteres Passwort setzen und die neuen Sitzungen widerrufen. Ein zuvor abgefangener Link bleibt somit ein Zugang, obwohl das Passwort inzwischen ersetzt wurde. Anders als R3 benötigt dies keine gleichzeitigen Anfragen.

**Reproduktion:** Benutzer anlegen, `createPasswordReset()` aufrufen, über `setPassword()` ein anderes Passwort setzen und anschließend `resolvePasswordReset()` mit dem alten Token aufrufen. Der Token wird weiterhin erfolgreich aufgelöst, obwohl `passwordResetRequired` bereits `false` ist. Mit echtem Hashing und SQLite bestätigt.

**Korrektur:** Bei jedem erfolgreichen Passwortwechsel alle ausstehenden Reset-Links des Kontos innerhalb derselben Transaktion widerrufen. Die Einlösung aus R3 muss dabei ihre eigene Berechtigung zunächst atomar prüfen und kann anschließend alle übrigen Links ebenfalls ungültig machen.

**Regressionstest:** Nach regulärem Passwortwechsel, administrativem Passwortsetzen und CLI-Passwortsetzen ist ein vorher ausgestellter Token nicht mehr einlösbar.

## R5 — [P2] Sync-Fehler überschreibt bereits bestätigten Fortschritt

**Fundstelle:** [`web/src/lib/sync.ts:214–219`](https://github.com/roemer2201/product-rating/blob/7fa0e3a346c776bd23cdd96ab68e38a522dca5f8/web/src/lib/sync.ts#L214-L219), ergänzend Zeilen 130–147 und 152–157.

**Fehler:** `syncCapture()` speichert erfolgreiche Schritte in einer lokalen Variable `current` und in IndexedDB. Wenn ein späterer Schritt fehlschlägt, schreibt der äußere Catch-Block das ursprüngliche `capture` zurück. Dadurch werden bereits bestätigte Angaben wie `progress.price = true` oder die Anzahl hochgeladener Fotos wieder auf den alten Stand gesetzt.

**Auslöser und Auswirkung:** Der Preis wurde erfolgreich übertragen; die anschließende Abfrage für den Bewertungskonflikt scheitert an einem Netzwerkfehler. Beim nächsten Versuch wird derselbe Preis erneut angelegt. Entsprechend können bereits bestätigte Foto-Uploads wiederholt werden. Es handelt sich hier ausdrücklich um den Verlust bereits lokal gespeicherter Bestätigungen, nicht nur um das allgemein schwierige Problem einer verlorenen Serverantwort.

**Reproduktion:** Eine Erfassung mit Preis und Bewertung anlegen. Produktauflösung und Preis-POST erfolgreich beantworten, die folgende Produktabfrage mit einem Netzwerkfehler ablehnen. Nach dem ersten Lauf steht `progress.price` wieder auf `false`; nach dem zweiten Lauf wurde `api.prices.add()` **zweimal** aufgerufen. Mit echtem Sync-Code und IndexedDB-Testimplementierung bestätigt.

**Korrektur:** Fehlerstatus und Versuchszähler mit dem neuesten gespeicherten Datensatz zusammenführen oder die Fehlerbehandlung in den Bereich verlegen, der `current` besitzt. Fortschrittsfelder niemals mit dem ursprünglichen Snapshot überschreiben. Ergänzend schützen serverseitige Idempotenzschlüssel gegen doppelte Anlage bei verlorenen Antworten.

**Regressionstest:** Preis erfolgreich, späterer Schritt mit Status 0 oder 503 fehlgeschlagen, erneut synchronisieren: exakt ein Preis-POST; bestätigte Fotofortschritte bleiben erhalten.

**Testlücke:** Der vorhandene Test „does not send a price twice when the upload after it failed“ besteht. Sein nicht vollständig nachgebildeter XHR-Fehler kann die Erfassung auf `failed` setzen; der nächste Lauf überspringt sie dann ganz. Damit prüft er nicht zuverlässig die behauptete Fortsetzung nach einem transienten Fehler.

## R6 — [P2] SyncGate startet nach jedem transienten Fehler sofort neu

**Fundstelle:** [`web/src/components/SyncGate.tsx:39–42`](https://github.com/roemer2201/product-rating/blob/7fa0e3a346c776bd23cdd96ab68e38a522dca5f8/web/src/components/SyncGate.tsx#L39-L42), ergänzend `web/src/lib/queries.ts:681–693`.

**Fehler:** Der Effekt hängt von `running` ab. Ein transienter Fehler lässt die Erfassung auf `pending`; sobald die Mutation endet, wechselt `running` von `true` auf `false`. Bei weiterhin wahrem `navigator.onLine` startet derselbe Effekt sofort die nächste Mutation. Ein neues Online-Ereignis oder ein manueller Klick ist nicht nötig.

**Auslöser und Auswirkung:** Das Gerät hat WLAN, aber die Anwendung antwortet dauerhaft mit 503 oder ist hinter einem defekten Proxy nicht erreichbar. Solange ein echter asynchroner Request das laufende Zwischenstadium sichtbar macht, entsteht eine fortlaufende Request-Schleife ohne Backoff. Das belastet Server, Funkverbindung und Akku; zusammen mit R5 kann es wiederholt Preise oder Fotos anlegen, wenn der Fehler jeweils erst nach diesen Schritten auftritt.

**Reproduktion:** `SyncGate` mit echtem React-Query-Client rendern, eine wartende Erfassung und Online-Status setzen. Produktabfragen nach jeweils 20 ms mit 503 ablehnen. Ohne weiteres Online-Ereignis erfolgen mindestens **vier automatische Anfragen innerhalb einer Sekunde**. Komponententest bestätigt.

**Korrektur:** Automatischen Start an einen neuen Auslöser binden, nicht an das bloße Ende der vorherigen Mutation. Alternativ begrenzte Wiederholungen mit Backoff implementieren. Zusätzlich Synchronisierung zentral gegen gleichzeitige Starts aus mehreren Komponenten bzw. Tabs absichern.

**Regressionstest:** Nach einem transienten Fehler bleibt die Erfassung erhalten, aber es gibt keinen weiteren automatischen Versuch ohne neuen Auslöser oder vorgesehenen Backoff-Termin.

## Validierung und Grenzen

Prüfumgebung: Linux, Node.js 24.19.0, Abhängigkeiten aus dem eingecheckten Lockfile. Der dokumentierte Zielbetrieb verwendet Node.js 22; ein separater Lauf unter Node.js 22 fand nicht statt.

| Prüfung | Ergebnis |
| --- | --- |
| `npm run lint` am unveränderten Anwendungscode | Erfolgreich |
| `npm run typecheck` am unveränderten Anwendungscode | Erfolgreich, alle Workspaces |
| `npm test -- --project web` | 23 Testdateien, 179 Tests erfolgreich |
| `npm test -- --project node` | 36 Testdateien, 455 Tests erfolgreich |
| Zusätzliche temporäre Reproduktionstests für R1, R3–R6 | 5 Tests erfolgreich; sie bestätigen das fehlerhafte Ist-Verhalten |
| R2 | Statisch belegt; kein realer Browser-Kontowechseltest |
| Docker-/Debian-Build, realer iOS-/PWA-Test, Lasttest | Nicht ausgeführt |

Die Abhängigkeiten wurden zunächst ohne Installationsskripte installiert. Der erste native Build von `better-sqlite3` scheiterte an einem `fchown/EINVAL` beim Entpacken der Node-Header in dieser Prüfumgebung. Nach Bereitstellung der Header ohne Eigentümerübernahme und erneutem nativen Build liefen die Servertests erfolgreich. Dies wird nicht als Projektfehler gewertet.

Die zusätzlichen Reproduktionstests wurden nur lokal zur Verifikation verwendet und nicht als Änderung an der bestehenden Testsuite übernommen. Die oben beschriebenen Schritte und Assertions dienen als Vorlage für dauerhafte Regressionstests. Bestehende grüne Tests schließen die dokumentierten Randfälle nicht aus.

