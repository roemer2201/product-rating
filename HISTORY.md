# HISTORY

Dokumentation abgeschlossener Arbeiten. Neueste Einträge stehen oben. Jeder
Eintrag nennt Datum, Umfang der Arbeit und die dabei getroffenen Entscheidungen.

---

## 2026-09-10 – „10“ am Ende der Sterneskala

**Anlass**

Die Bewertungsskala bricht auf dem Telefon in zwei Reihen um. Die obere trug
sechs Zeichen (die „0“ und fünf Sterne), die untere nur fünf – ein sichtbar
schiefes Raster.

**Umsetzung**

- Hinter dem letzten Stern steht jetzt die Zahl der Höchstbewertung, so wie am
  Anfang die „0“ steht. Damit sind beide Reihen sechs Zellen breit.
- Die Zelle ist ein zweites `<label>` mit `htmlFor` auf denselben Radio-Button
  wie der zehnte Stern: ein Tipp darauf wählt die Höchstwertung, alle Sterne
  füllen sich. Kein zweiter Radio-Button für denselben Wert, der die Gruppe
  durcheinanderbrächte.
- `.stars` verteilt in der breiten Darstellung zwölf statt elf Spalten, und
  `.stars__option--max` folgt der Gestaltung von `.stars__option--zero`.
- Zwei Tests: die Zelle wählt die Höchstwertung, und im deaktivierten Zustand
  tut sie nichts.

**Entscheidungen**

- Die Zelle trägt `aria-hidden`. Der Radio-Button für zehn Sterne ist bereits
  angesagt; ein zweites Label dafür würde Screenreadern denselben Wert doppelt
  vorlesen. Die Zahl ist eine Beschriftung der Skala, keine eigene Option.
- Der zehnte Stern behält seine Zelle. Die Zahl kommt hinzu, statt den Stern zu
  ersetzen – die Skala zeigt weiterhin zehn Sterne, so wie sie heißt.
- Bei zehn Sternen sind Stern und Zahl gemeinsam hinterlegt: die Rückmeldung
  soll dort erscheinen, wo der Finger war.

---

## 2026-09-10 – Zeilenumbruch im Kopfbereich nach „Angemeldet als“

**Anlass**

Auf schmalen Anzeigen stand „Angemeldet als `<name>`“ in einer Zeile, die nicht
umbrechen durfte (`white-space: nowrap`). Der Name wurde deshalb abgeschnitten,
statt in die nächste Zeile zu rutschen.

**Umsetzung**

- `strings.session.loggedInAs()` ist zu `strings.session.loggedInAsLabel`
  geworden. Der Kopfbereich setzt Beschriftung und Name als zwei Boxen mit einem
  gewöhnlichen Leerzeichen dazwischen; genau dort – also nach „als“ – darf die
  Zeile jetzt brechen.
- Beide Teile brechen intern nicht um: „Angemeldet als“ bleibt zusammen, und der
  Name bekommt erst dann wieder eine Ellipse, wenn er allein zu lang für eine
  Zeile ist.
- Die Abmelden-Schaltfläche schrumpft nicht mehr mit (`flex-shrink: 0`), damit
  der Platz beim Text gespart wird und nicht bei der Schaltfläche.
- Die drei Stellen in `AppLayout.test.tsx` prüfen nun Beschriftung und Namen
  getrennt.

**Entscheidungen**

- Der Umbruch entsteht über zwei Elemente statt über ein geschütztes Leerzeichen
  im Text. Ein U+00A0 mitten in einer Zeichenkette wäre unsichtbar und würde die
  Suche nach dem Text in Tests und Werkzeugen erschweren.
- Lint, Typecheck, `format:check` und die Testsuite (654 Tests in 61 Dateien)
  liefen durch.

---

## 2026-09-07 – Nachprüfung der Review-Korrekturen

**Anlass**

Die Korrekturen zu CODEX-REVIEW.md (Eintrag unten) wurden gegengelesen. Lint,
Typecheck, `format:check` und die vollständige Testsuite liefen unter
Node.js 22.22.2 durch – der Zielversion, unter der die Review selbst nicht
geprüft hatte – zunächst mit 651, nach den Ergänzungen mit 654 Tests in
61 Dateien. R2 bis R6 sind wie beschrieben umgesetzt; an R1 und an der
Oberfläche zur Übernahme blieb etwas offen.

**Gefunden und behoben**

- Der neue Restore tauscht das Upload-Verzeichnis vollständig aus, statt in das
  vorhandene zu schreiben. Das Zielverzeichnis entstand über `mkdtemp()` und
  damit mit Modus `0700` und dem Eigentümer, der `restore` aufruft – in der
  Regel `root`. Der Dienst läuft aber unter `product-rating` (Debian) bzw.
  `node` (Docker) und kam danach nicht mehr an seine Fotos: `checkDirectory()`
  bricht den Start mit „directory … is not writable by this process“ ab.
  `restoreBackup()` überträgt jetzt Modus und Eigentümer des ersetzten
  Verzeichnisses – und derselben Überlegung folgend auch die der ersetzten
  Datenbankdatei – auf das, was an seine Stelle tritt. Ohne Vorgänger gilt
  `0750`, derselbe Wert, den `ensureRuntimeDirectories()` verwendet. Zwei
  Regressionstests halten das fest.
- `restore --help` und die Abschlussmeldung sprachen weiter davon, überzählige
  Fotos zu löschen. Gelöscht wird nichts mehr: das bisherige Upload-Verzeichnis
  wandert als Ganzes nach `<uploads>.pre-restore-<zeitstempel>`. Hilfetext und
  Meldung sagen das jetzt und nennen das Verzeichnis, damit es nicht unbemerkt
  Platz belegt. README 8.1 nennt zusätzlich den Platzbedarf während der
  Vorbereitung und das Verhalten bei Rechten.
- `removedFiles` verglich zwei Dateilisten mit `Array.includes()`, also
  quadratisch. Bei der angepeilten Kataloggröße ist das die falsche Reihenfolge;
  jetzt läuft der Vergleich über ein `Set`.
- Die Übernahme unzugeordneter Alt-Erfassungen stand als unformatierter Block
  über der Liste, ohne die Klassen, die der Rest der Ansicht verwendet, und der
  Leerzustand „Nichts offen – alles ist übertragen“ erschien daneben, obwohl
  noch etwas wartete. Der Block trägt jetzt dieselbe `admin-row`-Struktur wie
  die übrige Warteschlange, hat eine eigene Überschrift, und der Leerzustand
  zeigt sich erst, wenn auch nichts mehr zu übernehmen ist. Ein Test deckt die
  Übernahme samt Identitätsprüfung ab.

**Entscheidungen**

- Die Eigentümerübertragung per `chown()` schlägt fehl, wenn `restore` nicht als
  `root` läuft. Das ist kein Fehler, sondern der Normalfall, wenn der Dienstnutzer
  selbst wiederherstellt – dort stimmt der Eigentümer bereits. Der Aufruf bleibt
  deshalb bewusst folgenlos.
- Die Dateien im wiederhergestellten Upload-Verzeichnis gehören weiterhin dem
  aufrufenden Konto. Das war vor der Korrektur ebenso und wird über die Rechte
  des Verzeichnisses abgedeckt; ein `chown -R` über sechsstellig viele Dateien
  wäre der teurere Weg für denselben Effekt.
- CODEX-REVIEW.md bleibt unverändert stehen: der Bericht beschreibt einen Stand,
  kein Arbeitsblatt.

---

## 2026-09-07 – Fehler aus CODEX-REVIEW.md behoben

- R1: Restore prüft Upload-Verzeichnis sowie referenzierte Originale und
  Thumbnails, bereitet Dateien vor und erhält Datenbank und Uploads zur
  Wiederherstellung. Bei Fehlern während des Austauschs wird zurückgerollt.
- R2: Offline-Erfassungen tragen eine Konto-ID. Warteschlangen und Query-Cache
  sind nach Konto getrennt; unzugeordnete Altbestände erfordern eine ausdrückliche
  Übernahme. Jeder Sync-Request wird zusätzlich serverseitig gegen die ursprüngliche
  Konto-ID geprüft. Die letzte bestätigte ID bleibt für Offline-Kaltstarts erhalten.
- R3/R4: Passwort-Reset prüft und verbraucht den Link nach dem Hashing atomar;
  jeder Passwortwechsel widerruft alle bisherigen Links in derselben Transaktion.
- R5/R6: Sync-Fehler erhalten bestätigten Fortschritt. Automatische Versuche sind
  an neue Auslöser gebunden; laufende Versuche werden zentral zusammengeführt,
  mit Web Locks auch über Tabs hinweg, sofern der Browser sie unterstützt.
- Dauerhafte Regressionstests für die sechs Funde ergänzt. Keine Änderungen an
  Konfiguration, Datenbankschema oder den beiden Deployment-Verfahren erforderlich.
- Validierung unter Node.js 24.19.0: Lint und Typecheck erfolgreich; vollständiger
  Testlauf mit 650 erfolgreichen Tests, anschließend der zusätzliche UI-Test zum
  Kontowechsel erfolgreich (insgesamt 651). Kein realer iOS-, Docker- oder Debian-Build-Test.

---

## 2026-09-03 – Neues App-Zeichen, Version 0.2.2

**Anlass**

Das bisherige Zeichen – ein Stern über einem Barcode auf Blau – war ein
Platzhalter aus M9. Der Projektinhaber hat eine Vorlage geliefert: Barcode über
einer Reihe von fünf Sternen auf Grün. Sie ist das Logo der App und ersetzt den
Platzhalter überall dort, wo das Symbol auftaucht.

**Umfang**

- `web/public/icon.svg` und `web/public/icon-maskable.svg` neu gezeichnet:
  Grund `#16a34a`, 22 weiße Balken auf einem 3er-Raster in den Breiten 3, 6 und
  9, darunter fünf Sterne in `#ffc93c` im Abstand von 50 Einheiten. Der
  Unterschied zwischen den beiden Dateien bleibt wie gehabt – abgerundete Ecken
  hier, randlos und auf 85 % verkleinert dort.
- Die fünf PNG-Dateien in `web/public/` mit `npm run icons` daraus neu erzeugt
  (192 und 512 je Variante, `apple-touch-icon` mit 180).
- Version im ganzen Repository auf 0.2.2 gehoben (vier `package.json` und
  `packaging/debian/changelog`).
- `README.md` 2.2: Beschreibung des Zeichens ergänzt.

**Entscheidungen**

- Der viewBox-Bereich wechselt von 512 auf 360 Einheiten – das Raster der
  Vorlage. Damit bleiben alle Balken ganzzahlig und die Breiten exakt im
  Verhältnis 1:2:3, statt bei der Umrechnung auf 512 krumm zu werden. Die
  Rasterung interessiert die viewBox nicht, `generate-icons.ts` bleibt
  unverändert.
- Die abgerundeten Ecken der Vorlage-losen Variante bleiben erhalten, obwohl die
  Vorlage ein volles Quadrat ist: `icon.svg` wird auch dort angezeigt, wo
  niemand eine Form ausschneidet (Browser-Tab, Launcher ohne Maske), und ein
  scharfkantiges Quadrat fällt dort aus dem Rahmen. Nachgemessen gegen die
  Vorlage weicht die Rasterung nur an den vier Ecken und um eine Zeile an den
  Sternspitzen ab.
- Die Akzentfarbe der Oberfläche bleibt Blau (`--color-accent: #2f5fd0`).
  Abgestimmt: das Zeichen wechselt die Farbe, das Farbschema der App nicht –
  das wäre eine eigene Arbeit samt Kontrastprüfung im Dunkelmodus.
- Patch-Version statt Minor: es ändert sich nur ein Bild, kein Verhalten, kein
  Schema, keine Konfiguration.
- Ein Symbol, das schon auf dem Home-Bildschirm liegt, tauscht iOS nicht aus;
  das steht so im Changelog des Pakets.

---

## 2026-08-31 – Foto schon beim erstmaligen Erfassen eines Produkts

**Anlass**

Ein Foto ließ sich bisher nur auf der Produktseite hinzufügen. Der Weg dorthin
führt nach einem Scan über das Formular „Neues Produkt“ – und genau dort steht
man mit der Packung in der Hand. Wer erst anlegen, dann die Produktseite
abwarten und dort noch einmal zur Kamera greifen muss, macht das Foto oft gar
nicht. Die Schaltflächen „Foto aufnehmen“ und „Bild auswählen“ gehören deshalb
auch auf das Formular.

**Umfang**

- `web/src/components/PhotoPicker.tsx` (neu): der gemeinsame Teil des Auswählens
  – `usePhotoPick()` (Auswahl, Verkleinerung, Object-URL samt Freigabe, Leeren
  der beiden `input`-Felder), `PhotoSources` (die zwei Schaltflächen) und
  `PhotoPreview` (Vorschaubild, das seinen `load` meldet).
- `web/src/components/PhotoManager.tsx`: benutzt diese drei Bausteine, statt sie
  selbst zu halten. Verhalten, Markup und Klassen unverändert.
- `web/src/components/ProductForm.tsx`: nimmt `children` zwischen Feldern und
  Schaltflächenzeile sowie ein `actionsRef` auf diese Zeile.
- `web/src/routes/ProductNewPage.tsx`: Abschnitt „Foto“ im Formular, direkt über
  „Produkt anlegen“. Das geladene Vorschaubild schiebt die Schaltflächenzeile
  des Formulars an den unteren Rand – dieselbe Bewegung wie im Katalog, nur ist
  die entscheidende Schaltfläche hier „Produkt anlegen“. Nach dem Anlegen geht
  das Bild sofort hoch; scheitert nur der Upload, bleibt die Ansicht mit
  Hinweis, Fehlermeldung, „Upload wiederholen“ und dem Weg zum angelegten
  Produkt stehen. Ohne Verbindung nimmt die Warteschlange das Bild auf – beim
  gescheiterten Anlegen zusammen mit den Feldern, danach allein.
- `web/src/lib/strings.ts`: `photo.newTitle`, `photo.newHint`,
  `product.created`, `product.toCreated`.
- Tests: `web/src/routes/ProductNewPage.test.tsx` (neu, sieben Fälle) – ungültige
  EAN, Anlegen ohne Bild, Reihenfolge Anlegen → Upload, Bewegung der Seite beim
  geladenen Bild, gescheiterter Upload mit Wiederholung, beide Wege in die
  Warteschlange.
- `README.md` 2.1 und `TODO.md` (M8) nachgezogen.

**Entscheidungen**

- Erst anlegen, dann hochladen: ein Foto gehört serverseitig zu einem Produkt,
  eine andere Reihenfolge gibt es nicht. Der Zwischenzustand wird gezeigt statt
  versteckt, denn er kann für sich scheitern – das Produkt ist dann da und nur
  das Bild fehlt, und das ist etwas anderes als ein fehlgeschlagenes Anlegen.
- Kein Navigieren bei gescheitertem Upload: das vorbereitete Bild bliebe sonst
  auf der Strecke, und der Griff zur Kamera wäre umsonst gewesen. Die
  Wiederholung ist ein Tastendruck, der Weg zum Produkt steht daneben.
- Die Erfassung nach einem gescheiterten Upload wandert ohne Produktdaten in die
  Warteschlange: das Produkt liegt bereits auf dem Server, und der Abgleich
  findet es über die EAN wieder (`resolveProduct` in `web/src/lib/sync.ts`).
- Das Bild steht unter den Feldern und nicht über ihnen. Die Bewegung an den
  unteren Rand hat nur dann einen Sinn, wenn dort die Schaltfläche steht, die
  über das Bild entscheidet – und das ist hier die des Formulars.
- Gegengeprüft im Browser (Chromium, 390 × 664, doppelte Pixeldichte) gegen einen
  laufenden Server: Anlegen mit Foto, Landung auf der Produktseite mit
  gesetztem Hauptbild, Bewegung der Seite nach dem Auswählen und der
  Zwischenzustand nach einem vom Server abgelehnten Bild.

---

## 2026-08-26 – Vorschau schiebt Hochladen und Verwerfen an den unteren Rand

**Anlass**

Nach dem Aufnehmen oder Auswählen eines Fotos erschien die Vorschau, die
Schaltflächen „Hochladen“ und „Verwerfen“ standen aber darunter und damit
außerhalb des Bildschirms. Jedes einzelne Foto kostete so einen Wisch, bevor es
bestätigt werden konnte – auf dem Telefon, einhändig, bei der häufigsten
Handlung der Anwendung.

**Umfang**

- `web/src/lib/scroll.ts` (neu): `scrollToBottomEdge(element, gap)` verschiebt
  den Seitenausschnitt so weit, dass die Unterkante eines Elements `gap` Pixel
  über dem verdeckten unteren Bildschirmrand liegt.
- `web/src/components/PhotoManager.tsx`: Die Schaltflächenzeile der Vorschau
  trägt ein `ref`, das `onLoad` des Vorschaubilds ruft `scrollToBottomEdge`.
  Damit stehen die beiden Schaltflächen am unteren Rand und das Bild darüber.
- Tests: `web/src/lib/scroll.test.ts` (Rechnung mit und ohne Navigation,
  Rückwärtsbewegung, Nulldistanz, Rückfall auf `innerHeight`, reduzierte
  Bewegung) und ein Fall in `web/src/routes/ProductPage.test.tsx`, der zeigt,
  dass erst das geladene Bild die Seite bewegt.

**Entscheidungen**

- Ausgelöst vom `load`-Ereignis des Bildes, nicht vom Auswählen: vor dem Laden
  hat das Bild keine Höhe, die Schaltflächen stünden noch nicht dort, wo sie
  landen werden, und der Ausschnitt säße falsch. `onError` löst dasselbe aus,
  weil auch ein kaputtes Bild dieselben Schaltflächen zeigt.
- Die Höhe der festen Navigationsleiste wird gemessen statt aus `--nav-height`
  errechnet: der Safe-Area-Abstand eines iPhones gehört zu ihrer Höhe dazu.
- `visualViewport` vor `innerHeight`: auf iOS zählt `innerHeight` den Streifen
  unter der Safari-Leiste mit, die Schaltflächen lägen sonst darunter.
- Kein `scrollIntoView({ block: 'end' })`: es kennt die feste Navigationsleiste
  nicht und würde die Schaltflächen hinter ihr parken.
- Bei `prefers-reduced-motion` wird gesprungen statt geglitten.

---

## 2026-08-24 – Zweiter Weg zum Hinzufügen eines Fotos

**Anlass**

Der `PhotoManager` hatte genau einen Weg zum Bild: eine Schaltfläche mit
`capture="environment"`. Auf dem iPhone ist dieses Attribut keine Voreinstellung,
die sich im Dialog umgehen ließe – Safari öffnet die Kamera und sonst nichts.
Ein Foto, das schon existiert (ein früher abfotografiertes Etikett, ein
zugeschicktes Bild), war damit nicht erreichbar.

**Umfang**

- `web/src/components/PhotoManager.tsx`: neben „Foto aufnehmen“ steht jetzt
  „Bild auswählen“ ohne `capture`-Attribut, das die Fotomediathek des Geräts
  öffnet. Beide Wege enden im selben `onPick` – Verkleinern, Vorschau, Upload,
  Offline-Warteschlange bleiben unverändert, es kommt nur eine zweite Tür in
  denselben Raum dazu.
- Die beiden Eingabefelder liegen in einer kleinen lokalen Komponente
  `PhotoSource`, damit sich die zwölf Zeilen Markup nicht doppeln und der
  einzige echte Unterschied – das `capture`-Attribut – als Parameter sichtbar
  ist.
- Je Quelle ein eigenes `ref`: `clearPick()` leert beide, sonst löst dieselbe
  Datei beim zweiten Mal kein `change`-Ereignis aus.
- Die Aufnahme-Schaltfläche trägt jetzt das Kamerasymbol, die Auswahl das
  Bildsymbol – vorher stand das Bildsymbol an der Kamera.
- `strings.photo.choose` war seit M8 vorhanden und unbenutzt und bekommt hier
  seinen Platz; dazu ein Hinweissatz (`sourceHint`), der sagt, welche
  Schaltfläche wohin führt, weil die Beschriftungen allein den Unterschied
  zwischen Kamera und Mediathek nicht deutlich genug machen.
- Test in `web/src/routes/ProductPage.test.tsx`: das Auswahlfeld trägt kein
  `capture`, das Aufnahmefeld schon, und ein über die Mediathek gewähltes Bild
  geht denselben Weg bis zur Erfolgsmeldung.

**Entscheidungen**

- Zwei Schaltflächen statt einer Auswahl in einem Menü hinter einer
  Schaltfläche: die Aktion ist der häufigste Griff auf der Seite, und ein Menü
  kostet auf dem Telefon einen zusätzlichen Tipp für beide Wege statt für
  keinen.
- Kein Feature-Test auf `capture`: das Attribut wird von Browsern, die es nicht
  kennen, schlicht ignoriert. Am Rechner öffnen beide Schaltflächen denselben
  Dateidialog, was harmlos ist und keine Sonderbehandlung rechtfertigt.

---

## 2026-08-24 – `armhf` als unterstützte Architektur aufgenommen

**Anlass**

`armhf` ist seit dem 22.08.2026 baubar (`build-deb.sh`), stand aber als
ungetestet in TODO. Tests und Produkterfassungen liefen im Alltag bislang
durchgängig auf dieser Architektur – der offene Punkt ist damit beantwortet.

**Umfang**

- README 7.2 nennt `armhf` jetzt neben `amd64` und `arm64` als unterstützte
  Architektur des Debian-Pakets, mit dem Unterschied klar benannt: kein
  GitHub-Actions-Runner, also kein Teil des automatisierten Release (9.2) –
  wer ein `armhf`-Paket will, baut es selbst, auf dem Zielsystem oder im
  `linux/arm/v7`-Container. `better-sqlite3` hat dort keinen Prebuild und wird
  bei jedem Bau übersetzt, was den Bau um einige Minuten verlängert, am
  Ergebnis aber nichts ändert.
- CLAUDE.md 7 (bekannte Fallstricke) unterscheidet jetzt zwischen den
  Docker-Architekturen (`amd64`, `arm64`) und den Debian-Architekturen
  (zusätzlich `armhf`), statt beide unter einer Aufzählung zu vermengen.
- TODO abgehakt.

**Entscheidungen**

- Nur das Debian-Paket führt `armhf`, nicht das Container-Image: Dafür gibt es
  weder eine Anfrage noch einen belegten Anwendungsfall, und `docker buildx`
  auf `linux/arm/v7` bräuchte eine eigene Prüfung der nativen Module, die
  bislang niemand gemacht hat.

---

## 2026-08-24 – Nachtest auf dem iPhone: Behebung der Warteschlange bestätigt

**Anlass**

Der Nachtest zur vorherigen Behebung (M9), auf demselben Gerät.

**Ergebnis**

Eine Erfassung wurde offline angelegt, die App anschließend aus dem
App-Umschalter gewischt und neu gestartet – die Erfassung war weiterhin in der
Warteschlange und wurde bei wiederhergestellter Verbindung automatisch
übertragen. Damit gilt der Commit-statt-Request-Fix aus 0.2.1 als bestätigt.

Ebenfalls geprüft: Das Safe-Area-Layout kollidiert am unteren Rand nicht mit
dem Home-Indikator. Offen bleibt nur noch die Erfassung mit Foto im selben
Ablauf – ob ein `Blob` das Beenden der App ebenso übersteht, ist bisher nur
durch die Konstruktion des Fixes plausibel, nicht am Gerät gezeigt.

**Umfang**

- TODO M9 nachgezogen: der Nachtest-Punkt ist abgehakt, der übergeordnete
  Gerätetest-Punkt trägt den bestätigten Stand.

---

## 2026-08-24 – Offline-Warteschlange: Erfassungen überleben das Beenden der App (0.2.1)

**Anlass**

Der erste Test auf einem echten iPhone (offener Punkt aus M9). Hinzufügen zum
Home-Bildschirm, Scanner und Kamera-Upload verhielten sich wie gedacht. Die
Warteschlange nicht: Eine Erfassung mit „Offline merken“ wurde angenommen, die
Oberfläche meldete „1 Erfassung wartet“ – wischte man die App danach aus dem
App-Umschalter, war sie nach dem Neustart verschwunden, auch mit Verbindung.

**Ursache**

`withStore` in `web/src/lib/offlineQueue.ts` löste sein Promise in
`request.onsuccess` auf. Das ist die falsche Stelle: Der Request meldet, dass
der Object Store den Wert genommen hat, nicht dass die Transaktion committet
ist. Dazwischen liegt ein Fenster, das auf iOS regelmäßig getroffen wird, weil
das Wischen aus dem App-Umschalter den Prozess sofort beendet und WebKit
IndexedDB asynchron und gebündelt auf die Platte schreibt. Der Zähler in der
Oberfläche zählte also etwas, das noch nirgends stand. Ein Foto als `Blob`
verbreitert das Fenster zusätzlich, weil WebKit es in eine eigene Datei legt.

Zweiter, unabhängiger Verlustweg: Ohne `navigator.storage.persist()` gilt der
Speicher als verzichtbar. WebKit räumt ihn bei Platzmangel ab und löscht ihn
nach sieben Tagen ohne Besuch – für eine Warteschlange, deren ganzer Zweck das
Aufheben über Tage ist, die falsche Voreinstellung.

**Umfang**

- **Commit statt Request**: `withStore` legt das Ergebnis beiseite und gibt es
  in `transaction.oncomplete` heraus. Schreibende Transaktionen laufen zusätzlich
  mit `durability: 'strict'`, weil die Voreinstellung `relaxed` einen Commit
  melden darf, bevor die Bytes im Dateisystem sind. Ältere Engines ignorieren
  das Optionsargument, verhalten sich also wie bisher.
- **Persistenz anfragen**: `requestPersistentStorage()` fragt einmal je Sitzung
  `navigator.storage.persist()` an, ausgelöst vom ersten Schreiben – vorher gibt
  es nichts zu schützen. Bewusst nicht abgewartet: Ob der Browser zusagt, ändert
  nichts an diesem Schreibvorgang, und ein Rückfragedialog gehörte nicht vor die
  Erfassung, die jemand gerade retten will. Lehnt der Browser ab oder kennt er
  die API nicht, arbeitet die Warteschlange unverändert weiter.
- **Regressionstest** `web/src/lib/offlineQueue.test.ts`: Er hängt sich an die
  Transaktion und besteht darauf, dass `committed` vor `resolved` steht. Gegen
  den alten Stand schlägt er fehl, was der Punkt dieses Tests ist. Dazu die drei
  Fälle der Persistenzanfrage (frisch zugesagt, schon zugesagt, keine API).

**Entscheidungen**

- `durability: 'strict'` trotz der Kosten. Ein Commit pro Erfassung ist ein
  seltenes Ereignis am Regal, und die Zusage „was die App als aufgehoben meldet,
  ist aufgehoben“ ist der einzige Grund, warum diese Warteschlange existiert.
- Die Persistenzanfrage bleibt vorerst stumm. Sie sichtbar zu machen, wenn sie
  abgelehnt wird, steht als eigener Punkt in TODO – erst sollte der Nachtest auf
  dem Gerät zeigen, ob iOS sie einer Home-Bildschirm-App überhaupt verweigert.

---

## 2026-08-24 – Anzeigename je Konto (0.2.0)

**Umfang**

- **Neue Spalte** `users.display_name` (Migration `0008_user_display_name`,
  `ALTER TABLE … ADD COLUMN`, `null`-bar). Bewusst **ohne** Unique-Index: der
  Anzeigename ist ein Etikett, keine Kennung – niemand meldet sich damit an,
  und zwei Personen im Haushalt dürfen sich „Oma“ nennen. `null` heißt „nicht
  gesetzt“; dann steht überall der Benutzername.
- **Selbst verwalten**: `PATCH /api/v1/auth/profile` setzt den eigenen Namen,
  `null` gibt ihn wieder auf. Die Route nimmt bewusst keine Kennung entgegen,
  spricht also immer „mein Konto“ an – damit ist Umbenennen fremder Konten
  nicht ausdrückbar statt nachträglich geprüft. Administratoren können den
  Namen zusätzlich über `PATCH /api/v1/users/:id` und beim Anlegen setzen,
  ebenso die Registrierung (optionales Feld).
- **Wo er erscheint**: fremde Bewertungen auf der Produktseite, der
  Preisverlauf, der Papierkorb in der Verwaltung, die Nutzerliste und die
  Begrüßung in der Kopfzeile. Die API liefert dafür `username` **und**
  `displayName`; welcher gezeigt wird, entscheidet `accountName()` in
  `shared/src/account.ts` an einer Stelle für alle Ansichten.
- **Regeln**: zwei bis 40 Zeichen, Leerzeichen, Umlaute und Großschreibung
  erlaubt, Steuerzeichen nicht – die würden Zeilenumbrüche oder
  Bidi-Overrides in eine Liste tragen, in der jeder andere Eintrag einzeilig
  ist. Getrimmt wird serverseitig, ein leeres Feld ist kein Fehler, sondern
  der Weg, den Namen abzulegen (`normaliseDisplayName()`).
- **Kommandozeile**: `product-rating user display-name <konto> [text]` setzt
  und entfernt ihn, `user add --display-name` legt ihn gleich mit an,
  `user list` zeigt ihn in einer eigenen Spalte. Der Text darf ohne
  Anführungszeichen Leerzeichen enthalten.
- **Umzug**: Export und Import nehmen den Anzeigenamen mit (`export.json`,
  neue Spalte `display_name` in `users.csv`). Ältere Dateien ohne das Feld
  werden weiter gelesen; Konten, die auf der Zielinstanz schon existieren,
  bleiben wie gehabt unangetastet.
- **Tests**: fünf für die neue Route, drei für den Dienst, je einer für
  Bewertungsliste, Umzug, zwei für die CLI und drei für die Oberfläche
  (Einstellungen, Produktseite). Bestehende Erwartungen an Routentabelle,
  CSV-Kopfzeile und Registrierungs-Payload nachgezogen.
- **Dokumentation**: README 2.1, 3, 4.2 (fremde Bewertungen), 5, 5.1, 8.1 und
  8.3, dazu ein erledigter Punkt im Backlog von TODO.md.
- **Version 0.2.0** in den vier `package.json` und in
  `packaging/debian/changelog`: neue Funktion samt Migration, die von allein
  durchläuft – in der `0.x`-Reihe ist das ein MINOR (README 9.1). Der Tag
  bleibt dem Projektinhaber vorbehalten.

**Entscheidungen**

- **Zwei Namen statt einem.** Der Benutzername bleibt, was er ist: klein
  geschrieben, eindeutig, das, was Anmeldung, Log, CLI und Passwort-Link
  meinen. Der Anzeigename liegt darüber und ist frei. Ihn stattdessen
  änderbar zu machen hätte jede Referenz auf „anna“ zu einem beweglichen Ziel
  gemacht – bis hin zu `--owner` beim Import.
- **Beide Namen reisen über die API**, statt serverseitig einen fertigen Namen
  einzusetzen. So bleibt das Feld ehrlich benannt, und die Verwaltung kann den
  Benutzernamen weiter danebenschreiben, wo er gebraucht wird.
- **Kein Zwang und keine Eindeutigkeit.** Ein Haushalt mit fünf Konten braucht
  keine Namenskollisionsverwaltung; wer keinen Anzeigenamen setzt, erscheint
  wie bisher.

---

## 2026-08-24 – Offline-Queue: gleiche Millisekunde, zufällige Reihenfolge

**Umfang**

- **Fehler behoben**: `enqueueCapture` (`web/src/lib/offlineQueue.ts`) nahm
  `Date.now()` direkt als `createdAt`. Zwei Erfassungen innerhalb derselben
  Millisekunde bekamen damit denselben Zeitstempel, und da die Sortierung in
  `listCaptures` stabil ist, blieb bei Gleichstand die Reihenfolge stehen, in
  der IndexedDB die Datensätze herausgibt – die des Schlüssels, also der
  zufälligen UUID. Zwei hintereinander gescannte Artikel konnten so vertauscht
  in der Warteschlange stehen. Der Zeitstempel kommt jetzt aus `nextCreatedAt`
  und ist streng monoton steigend.
- **Test**: Der bestehende Reihenfolge-Test wartete darauf, dass der
  Gleichstand von selbst auftritt, und schlug entsprechend sporadisch fehl (in
  einem Versuchsaufbau 20 von 40 Durchläufen). Der neue Fall hält die
  Millisekunde mit `vi.spyOn(Date, 'now')` fest und erzwingt den Gleichstand
  über 20 Durchläufe.

**Entscheidungen**

- **Monotoner Zähler statt feinerer Uhr**: `performance.now()` oder ein
  zusätzliches Sequenzfeld hätten das Schema oder einen zweiten Lesezugriff
  gekostet. `Math.max(Date.now(), lastCreatedAt + 1)` bleibt ein `number` in
  Millisekunden, bestehende Einträge bleiben gültig, und nach einem Neuladen
  ist die Uhr ohnehin weiter.
- **Sortierung unverändert**: Kein zweites Sortierkriterium in `listCaptures`.
  Ein Gleichstand kann dort nicht mehr entstehen, und ein Vergleich nach der
  zufälligen ID hätte die Reihenfolge nur festgeschrieben, nicht richtig
  gemacht.

---

## 2026-08-24 – `proxy-config`: `--server apache` wies den eigenen Namen ab

**Umfang**

- **Fehler behoben**: In `TARGET_ALIASES` (`server/src/services/proxyConfig.ts`)
  standen `apache2` und `httpd`, aber nicht `apache` selbst. Da die Tabelle der
  einzige Weg ist, einen Namen aufzulösen, war ausgerechnet der kanonische
  Name ein Aufruffehler – während die Meldung dazu `apache` als bekannt
  auflistete und die Beispiele in Hilfe und README ihn benutzten. Der Eintrag
  fehlt nicht mehr.
- **Eine Quelle für die Namen**: Neu exportiert wird `PROXY_TARGET_NAMES`, die
  Schlüssel der Alias-Tabelle in Reihenfolge. Hilfetext und Fehlermeldung
  bauen darauf auf, statt aus `PROXY_TARGETS` nur die Zielnamen zu nehmen und
  die übrigen Schreibweisen daneben in Prosa zu erwähnen.
- **Hilfezeile**: `--server NAME` schreibt jetzt alle sechs akzeptierten Namen
  aus (`nginx | apache | apache2 | httpd | caddy | traefik`) statt vier davon
  plus einem Klammerzusatz.
- **Tests**: `parseProxyTarget('apache')` fehlte in der Prüfung – genau die
  Lücke, durch die der Fehler kam. Dazu ein Fall, der jeden angebotenen Namen
  auflöst und jedes Ziel in den angebotenen Namen wiederfindet, sowie ein
  Aufruf des Befehls mit allen drei Apache-Schreibweisen und eine Prüfung der
  Hilfezeile.
- **Dokumentation**: README 7.3 und die Befehlstabelle in 8.1 nennen die
  akzeptierten Schreibweisen.

**Entscheidungen**

- **Den Alias ergänzen statt die Dokumentation anzupassen.** `apache` ist der
  Zielname im Typ, steht in `PROXY_TARGETS` und wird in beiden Beispielen
  verwendet; dass er nicht auflöste, war ein Versehen und keine Festlegung.
- **Die Liste der Namen aus der Alias-Tabelle ableiten.** Eine zweite,
  handgepflegte Aufzählung im Hilfetext wäre genau die Art von Duplikat, die
  hier auseinandergelaufen ist.


---

## 2026-08-23 – `proxy-config`: Webserver-Konfiguration aus der Instanz erzeugen

**Umfang**

- **Neuer CLI-Befehl** `product-rating proxy-config --server
  nginx|apache|caddy|traefik` (`apache2` und `httpd` meinen `apache`). Er
  schreibt dieselben vier Konfigurationen, die `packaging/examples/` als
  Vorlage enthält – nur ausgefüllt: Hostname und Unterpfad aus
  `server.base_url`, Adresse der Anwendung aus `server.host` und
  `server.port`, Größenlimit aus `uploads.max_file_size_mb` plus fünf Megabyte
  Luft für den Multipart-Rahmen. Jeder Wert lässt sich mit `--domain`,
  `--base-path`, `--upstream` und `--max-body` überschreiben.
- **Zertifikat**: `--cert` und `--key` nehmen die Pfade entgegen und gehören
  zusammen; einer allein ist ein Aufruffehler (Exit-Code 2). Ohne sie stehen
  bei nginx und Apache die certbot-Pfade in der Datei, Caddy und Traefik
  bleiben bei ihrer eigenen ACME-Verwaltung.
- **Ausgabe**: ohne `--out` nach stdout, mit `--out` in eine Datei; ein
  Verzeichnis wird als solches erkannt und der Dateiname aus dem Ziel
  abgeleitet (`product-rating.conf`, `product-rating.caddy`,
  `product-rating.yml`). Fehlende Elternverzeichnisse werden angelegt, eine
  vorhandene Datei nur mit `--force` überschrieben.
- **Hinweise auf stderr**: abweichende `server.base_url` samt fertigem
  `--set`-Aufruf, `server.trust_proxy = false`, ein Zertifikat, das noch nicht
  existiert, und der Hinweis, dass ein Unterpfad in den Client gebaut werden
  muss. Die Datei selbst bleibt frei davon und lässt sich weiterleiten.
- **Code**: `server/src/services/proxyConfig.ts` (Auflösung der Werte und die
  vier Vorlagen), `server/src/cli/proxy.ts` (Befehl, Optionen, Schreiben),
  Registrierung in `server/src/cli/index.ts`. Tests: 18 neue Fälle für die
  Erzeugung, sechs für den Befehl von außen.
- **Dokumentation**: README 7.3 und 8.1, `packaging/examples/README.md`,
  CLAUDE.md 4, ein Beispiel im Debian-Wrapper (Version 2.1.0) und drei Punkte
  in TODO.md.

**Entscheidungen**

- *Ein Befehl der Anwendung, kein eigenes Shell-Skript.* Die Werte, die in der
  Proxy-Konfiguration stehen müssen, kennt die Anwendung bereits – ein Skript
  daneben müsste die TOML-Datei, die Umgebungsvariablen und die Vorrangkette
  ein zweites Mal auswerten. Über die CLI gilt außerdem `--config`
  unverändert, der Befehl lässt sich also auf eine zweite Instanz richten.
- *Die Beispieldateien bleiben.* Sie sind die ausführliche Fassung, die jede
  Einstellung begründet, und werden gelesen, bevor irgendetwas installiert
  ist. Die erzeugte Datei kommentiert nur, was beim Betrieb wichtig ist, und
  verweist auf sie.
- *Kein Zertifikat raten, wo es nicht nötig ist.* Caddy und Traefik besorgen
  sich eins selbst; würde der Befehl dort certbot-Pfade eintragen, nähme er
  ihnen genau das ab. nginx und Apache können es nicht, und eine Datei mit
  einem Platzhalter im `ssl_certificate` wäre keine fertige Konfiguration –
  dort steht deshalb die Vorgabe von certbot.
- *Warnen statt abbrechen.* Ein noch nicht ausgestelltes Zertifikat ist der
  Normalfall, solange der Proxy noch gar nicht steht; die Datei wird trotzdem
  geschrieben und der fehlende Pfad genannt.
- *`loadConfig` statt `loadRuntimeConfig`.* Eine Proxy-Konfiguration zu
  schreiben ist kein Grund, die Datenverzeichnisse der Anwendung anzulegen –
  der Befehl läuft auch als gewöhnlicher Nutzer auf einer Maschine, die keins
  davon hat.
- *Härtungs-Header bleiben, wo sie sind.* Auch die erzeugten Dateien setzen
  nur `Strict-Transport-Security` und keine Cache-Regeln; alles andere ist
  Sache der Anwendung (CLAUDE.md 5).

---

## 2026-08-23 – Bewertungsskala von 0–5 auf 0–10 Sterne

**Umfang**

- **Skala**: `RATING_MAX_STARS` in `shared/src/types.ts` von `5` auf `10`.
  Alles, was die Skala begrenzt, prüft oder darstellt, leitet sich von dieser
  Konstante ab; die Stellen, an denen bis dahin eine `5` fest verdrahtet war,
  sind auf sie umgestellt: `minStars` in `productListQuerySchema`, das
  Import-Schema `exportedRatingSchema` in `server/src/services/transfer.ts`,
  der Filter „Mindestens“ auf der Katalogseite und die Oberflächentexte
  („… von 10 Sternen“) in `web/src/lib/strings.ts`.
- **Datenbank**: Der CHECK `ratings_stars_range` lautet jetzt
  `between 0 and 10` und wird in `schema.ts` aus denselben Konstanten
  geschrieben. Weil SQLite einen CHECK nicht ändern kann, baut die Migration
  `0007_rating_scale.sql` die Tabelle `ratings` neu auf und übernimmt die
  vorhandenen Zeilen – Werte, Kommentare, Zeitstempel und Fremdschlüssel
  bleiben, geprüft an einer Datenbank mit Bestand.
- **Sterne-Widget**: Elf Auswahlmöglichkeiten (0 bis 10) passen nicht in eine
  Reihe, solange jede ihr 44-Pixel-Ziel behält. `.stars` ist deshalb ein Raster
  aus sechs Spalten, das erst ab 38 rem in eine einzige Reihe fällt; die
  Glyphengröße wächst mit `clamp()` mit der Spalte.
- **Dokumentation**: README 1, 4.1 und 4.2, CLAUDE.md 1 und ein Punkt im
  Backlog von TODO.md.

**Entscheidungen**

- *Zehn Sterne statt halber Sterne.* Der Wunsch nach feineren Abstufungen ist
  derselbe, den halbe Sterne bedienen würden – nur ist ein ganzer Schritt auf
  einer längeren Skala am Telefon mit dem Daumen zu treffen, ein halber nicht.
  Die Bewertung bleibt damit eine ganze Zahl, und Durchschnitt, Sortierung und
  Cursor rechnen unverändert weiter.
- *Vorhandene Bewertungen behalten ihre Zahl.* Die einzige Installation ist
  eine Testinstallation mit einer einzigen Bewertung; der Projektinhaber hat
  ausdrücklich auf Kompatibilität verzichtet. Eine Umrechnung (`stars * 2`)
  hätte aus fünf von fünf zehn von zehn gemacht, aber auch aus jeder Drei eine
  Sechs, ohne dass jemand das je so gemeint hätte – aus einer Skala mit sechs
  Stufen lassen sich elf nicht nachträglich erfinden. Wer die alten Urteile
  behalten will, liest sie danach als „von zehn“ und bewertet neu.
- *Der CHECK bleibt in der Datenbank.* Zod prüft die Skala schon an der Route,
  aber Import, CLI und ein direkter `sqlite3`-Zugriff gehen daran vorbei. Die
  Grenze steht deshalb weiter dort, wo sie niemand umgehen kann – und wird
  über `sql.raw` aus den Konstanten geschrieben, damit die generierte Migration
  Literale enthält statt gebundener Parameter.
- *Sechs Spalten, nicht ein Umbruch nach Platz.* Ein `flex-wrap` hätte die
  Reihe irgendwo aufgetrennt, je nach Gerätebreite. Sechs Spalten teilen die
  Skala in ihrer Mitte – 0 bis 5 oben, 6 bis 10 unten – und lassen sie damit
  auch umgebrochen wie eine Skala aussehen.
- *Die abgehakten Punkte in TODO.md bleiben, wie sie sind.* Sie halten fest,
  was in M4 und M8 geplant und gebaut wurde; was heute gilt, steht in README
  und in diesem Eintrag.

---

## 2026-08-23 – Attribut „Sorte“ am Produkt

**Umfang**

- **Datenmodell**: Spalte `products.variant` (Migration
  `0006_product_variant.sql`). Dieselbe Migration baut `products_fts` neu auf –
  die FTS5-Tabelle bekommt eine Spalte `variant`, die drei Trigger werden mit
  ihr neu angelegt und der Index aus den vorhandenen Zeilen gefüllt.
- **API**: `variant` in `createProductSchema`, `updateProductSchema` und im
  Typ `Product` (bis 200 Zeichen, leer bedeutet `null` wie bei Marke,
  Kategorie und Notizen). Die Suche über `q` liest die Sorte mit – über den
  Trigramm-Index und über den `LIKE`-Rückfallweg für Begriffe unter drei
  Zeichen.
- **Export und Import**: Sorte in `export.json` und als Spalte `variant` in
  `products.csv`; eine ältere Datei ohne das Feld liest sich unverändert ein.
- **Oberfläche**: Feld „Sorte“ im Produktformular zwischen Name und Marke,
  eigene Zeile auf der Produktkarte, in der Kopfzeile der Detailseite vor Marke
  und Kategorie. Auch in der Offline-Warteschlange, damit am Regal Erfasstes
  die Sorte mitnimmt.
- **Dokumentation**: README 1, 3 und 4.1 auf den Stand gebracht, dazu ein
  Absatz in 4.1, der Name, Sorte und Marke gegeneinander abgrenzt.

**Entscheidungen**

- *Eine Spalte, keine zweite Tabelle.* Jede Sorte trägt eine eigene EAN und ist
  damit ohnehin ein eigenes Produkt. Eine Tabelle „Produktlinie“ mit
  Fremdschlüssel würde am Regal eine zweite Erfassungsstufe verlangen und für
  einen Haushaltskatalog nichts einbringen; die Zusammengehörigkeit ergibt sich
  aus gleichem Namen und gleicher Marke.
- *Bezeichner `variant`.* Code ist englisch; `variant` ist der geläufige
  Begriff für die Ausführung innerhalb einer Produktlinie und enger als
  `flavour`, das nur zu Essbarem passt.
- *Die Sorte gehört in den Suchindex.* Wer „Bolognese“ tippt, sucht die Sorte
  und nicht die Linie. Weil FTS5-Tabellen keine Spalten nachrüsten lassen,
  wird `products_fts` verworfen und neu aufgebaut – der Index ist abgeleitete
  Daten, und der Aufbau kostet bei sechsstelligen Katalogen Sekunden. Vor jeder
  Migration liegt ohnehin ein Snapshot.
- *Kein Index auf der Spalte.* Gefiltert wird nach Kategorie, sortiert nach
  Name – die Sorte wird nur durchsucht, und das erledigt der Volltextindex.
- *Keine Vorschlagsliste wie bei der Kategorie.* Eine Sorte gehört zu genau
  einem Produkt und wiederholt sich nicht; eine Liste aller bisherigen Sorten
  wäre so lang wie der Katalog.

---

## 2026-08-22 – Debian-Paket auch für armhf

**Umfang**

- **`packaging/build-deb.sh`**: `armhf` in die Zuordnung von Debian- zu
  node-Architektur aufgenommen (`armhf` → `arm`). Bis dahin brach der Bau auf
  einem 32-Bit-ARM-Host mit „no mapping from the Debian architecture armhf“ ab.
- **`prune_foreign_binaries`** entscheidet jetzt anhand dessen, was im Baum
  liegt, statt anhand einer Annahme: Gibt es `prebuilds/linux-<arch>.node`,
  bleibt der Prebuild und `build/` fällt weg; gibt es ihn nicht, bleibt das beim
  Install übersetzte `build/Release/better_sqlite3.node` und die `prebuilds/`
  fallen weg. Fehlen beide, bricht der Bau ab.
- **Abhängigkeits-Install im Staging-Verzeichnis** läuft mit
  `--engine-strict=false`. Dafür prüft `check_prerequisites` jetzt selbst, ob
  die Node-Version des Bau-Hosts die in der Wurzel-`package.json` deklarierte
  Untergrenze erreicht.

**Entscheidungen**

- *Die Architektur bestimmt nicht, woher das Addon kommt.* `better-sqlite3`
  liefert Prebuilds nur für `x64` und `arm64` (`PREBUILD_ARCHS` in
  `lib/binding.js`); auf armhf übersetzt npm beim Install und das Ergebnis
  landet in `build/Release`. Das alte `rm -rf build/` hätte genau dieses Addon
  entfernt – das Paket hätte sich installieren lassen und wäre bei der ersten
  Abfrage gescheitert. Deshalb prüft das Skript, was tatsächlich da ist.
- *Ein fehlendes Addon ist ein Abbruch, keine Warnung.* Ein Paket ohne
  Datenbankbindung ist wertlos; es später beim Nutzer scheitern zu lassen ist
  schlechter, als den Bau anzuhalten.
- *`sharp` und `@node-rs/argon2` brauchten nichts.* Beide haben echte
  armhf-Prebuilds (`@img/sharp-linux-arm`,
  `@node-rs/argon2-linux-arm-gnueabihf`), und die vorhandene Auswahl über
  `-${node_arch}` trifft sie mit `arm` richtig, ohne `arm64` zu erwischen.
- *`engine-strict` gehört nicht in den Paketbau.* Die `.npmrc` des Projekts
  setzt es, und `install_runtime_dependencies` kopiert sie mit, damit der
  Install dieselben Einstellungen sieht wie überall sonst. npm prüft das Feld
  `engines` aber für jedes Paket der Lock-Datei, während es den
  Abhängigkeitsbaum aufbaut – also bevor `--omit=dev` die
  Entwicklungsabhängigkeiten wieder entfernt. Auf Ubuntu 26.04 (Node 22.22.1,
  npm 9) hielt so `jsdom`, eine reine Test-Abhängigkeit mit Anforderung
  `^22.22.2`, den Bau eines Servers auf, der sie nie lädt. Statt die Regel im
  ganzen Repository zu lockern, ist sie für diesen einen Aufruf ausgeschaltet
  und die eigentliche Frage – ist der Bau-Host neu genug – wird ausdrücklich
  gestellt.
- **Offen:** Auf armhf gibt es kein CI. Geprüft ist, dass der amd64-Bau
  unverändert dasselbe Paket erzeugt; der armhf-Bau selbst läuft bisher nur auf
  der Maschine des Projektinhabers.

## 2026-08-22 – Backlog: Offline-Erfassung mit Warteschlange

**Umfang**

- **`web/src/lib/offlineQueue.ts`**: Warteschlange in IndexedDB. Die Einheit ist
  eine *Erfassung* – EAN plus wahlweise Produktdaten, Bewertung, Preis und
  Fotos –, kein API-Aufruf.
- **`web/src/lib/sync.ts`**: löst jede Erfassung über die EAN auf
  (Produkt → Preis → Fotos → Bewertung), merkt sich in `progress`, was schon
  oben ist, und erkennt genau einen Konfliktfall: eine eigene Bewertung, die
  nach dem Erfassungszeitpunkt anderswo geändert wurde.
- **Oberfläche**: „Offline merken“ unter jedem fehlgeschlagenen Speichern
  (`OfflineCapture`), ein Streifen über der Navigation samt automatischer
  Übertragung (`SyncGate`) und die Liste in den Einstellungen mit Zustand,
  Inhalt, Konfliktfrage und Verwerfen (`CaptureQueue`).
- Der Scanner schickt bei einer Suche ohne Verbindung ins Anlegeformular –
  offline lässt sich nicht feststellen, ob es die EAN schon gibt.
- **Tests**: 13 Fälle für Warteschlange und Übertragung (`fake-indexeddb`),
  dazu drei über die Oberfläche.

**Entscheidungen**

- *Absicht statt Request.* Ein Gerät ohne Verbindung kann nicht wissen, ob eine
  EAN im Katalog steht – der Katalog wird bewusst nicht gecacht. Wird die
  Absicht festgehalten, entscheidet sich erst bei der Übertragung, ob daraus
  ein neues Produkt oder ein Zusatz zu einem vorhandenen wird. Das erspart
  vorläufige IDs und ihre spätere Ersetzung.
- *Der Katalog gewinnt gegen die Offline-Notiz.* Existiert die EAN inzwischen,
  bleiben Name, Marke und Kategorie, wie sie sind; Bewertung, Preis und Fotos
  kommen trotzdem dazu.
- *Konflikte werden gefragt, nicht entschieden.* Zwei Bewertungen desselben
  Kontos – eine am Regal, eine zu Hause – lassen sich nicht über den Zeitstempel
  sortieren. „Der letzte gewinnt“ wäre hier eine Behauptung, keine Regel.
- *Kein Wiederhol-Timer.* Übertragen wird beim Start, beim Wiederkehren der
  Verbindung und auf Knopfdruck. Alles andere kostet Akku für eine Antwort, die
  die App schon kennt.
- *„Offline merken“ ist ein Angebot, kein Automatismus.* Etwas für später zu
  merken ist eine andere Handlung als es zu speichern – ein stiller Umbau würde
  genau das verstecken.
- *Nichts verschwindet von selbst.* Eine abgelehnte Erfassung bleibt mit
  Begründung stehen, bis jemand sie erneut versucht oder verwirft.
- **Offen:** Dass ein `Blob` die IndexedDB übersteht, ist eine Zusage des
  Browsers; der Test-Ersatz `fake-indexeddb` gibt ihn als einfaches Objekt
  zurück. Der Gerätetest in M9 holt das nach.

## 2026-08-22 – Konten im Export, ohne Passwörter

**Umfang**

- **`export.json` trägt `users`** (Benutzername, Rolle, E-Mail, Anlage- und
  Deaktivierungsdatum) und `--format csv` schreibt zusätzlich `users.csv`.
  Passwort-Hashes sind bewusst nicht dabei; ein CLI-Test besteht darauf, dass
  in der Datei kein `$argon2id$` vorkommt.
- **Der Import legt fehlende Konten an**, und zwar gesperrt: kein Hash,
  `password_reset_required`, also nur über einen Passwort-Link erreichbar. Am
  Ende nennt der Befehl die betroffenen Konten samt fertigem Aufruf
  (`product-rating user reset-link <name>`).
- Konten, die es drüben schon gibt, bleiben unverändert. `--skip-users` legt
  gar keine an, dann greift wie bisher `--owner`.
- Konten werden **vor** allem anderen geschrieben, damit jede Bewertung, jedes
  Foto und jeder Preis seinen Eigentümer wiederfindet, statt bei einem
  Sammelkonto zu landen.
- **`--no-users` schaltet den Kontenexport ab.** Dann entsteht keine
  `users.csv`, und in `export.json` fehlt der Schlüssel `users` – nicht als
  leere Liste, weil das eine andere Aussage wäre. Einen Export gibt es nur auf
  der Kommandozeile; in der Weboberfläche existiert er nicht, also auch keine
  Ankreuzmöglichkeit.

**Entscheidungen**

- *Keine Hashes im Export.* Eine Datei, die jemand sich selbst mailt, darf kein
  Satz Zugangsdaten sein. Der Preis ist der Passwort-Link je Konto – und genau
  dafür gibt es ihn.
- *Fremde Konten der Zielinstanz werden nicht überschrieben.* Rolle und E-Mail
  einer laufenden Installation wiegen schwerer als eine Datei; ein Import soll
  niemandem unbemerkt Administratorrechte geben oder nehmen.

## 2026-08-22 – Passwort-Links für Konten ohne Passwort

**Umfang**

- **`users.password_reset_required`** und die Tabelle **`password_resets`**
  (Migration `0005_password_resets.sql`). Der Hash eines gesperrten Kontos ist
  der Sperrvermerk `!` – die Schreibweise aus `/etc/shadow` –, gegen den kein
  Passwort verifizieren kann.
- **`POST /api/v1/users/:id/reset-link`** (admin) gibt einen Link einmalig aus,
  **`POST /api/v1/users/:id/lock`** entzieht das Passwort und beendet alle
  Sitzungen. **`GET /api/v1/auth/reset/:token`** sagt, zu welchem Konto ein Link
  gehört, **`POST /api/v1/auth/reset`** setzt das Passwort und meldet an.
- **Kommandozeile:** `product-rating user reset-link <name>` (Link auf stdout,
  Erklärung auf stderr) und `product-rating user lock <name>`. `user list`
  zeigt „needs password“ als Zustand.
- **Oberfläche:** neue Seite `/reset` außerhalb der Anmeldung; in der Verwaltung
  je Konto „Passwort-Link erzeugen“ (Link auf dem Bildschirm **und** in der
  Zwischenablage) und „Passwort entziehen“ mit zweitem Klick, dazu die
  Kennzeichnung „Passwort fehlt“.
- **Konfiguration** `auth.password_reset_ttl_hours` (Standard 48).
- Verbrauchte und abgelaufene Links räumt derselbe tägliche Job weg wie die
  abgelaufenen Sitzungen.

**Entscheidungen**

- *Nur der SHA-256 des Tokens wird gespeichert* – anders als bei
  Einladungscodes, die im Klartext liegen. Eine Einladung erlaubt nur ein neues
  Konto, ein Passwort-Link übernimmt ein bestehendes; eine gestohlene Datenbank
  darf keinen benutzbaren enthalten. Folge: Der Link ist genau einmal lesbar
  und wird sonst ersetzt, nicht nachgeschlagen.
- *Genau ein gültiger Link je Konto.* Zwei Links sind zwei Dinge, die
  abgefangen werden können – und der zweite wird ohnehin ausgestellt, weil der
  erste verschwunden ist.
- *Die Anmeldung macht eine dokumentierte Ausnahme* (README 5.2): Ein Konto
  ohne Passwort bekommt eine eigene Meldung statt „falscher Benutzername oder
  falsches Passwort". Sonst tippt nach einem Umzug jemand sein korrektes altes
  Passwort in eine Sackgasse. Der Preis – ein Fremder erfährt für einen
  erratenen Namen, dass das Konto gesperrt ist – steht gegen dieselbe
  Ratenbegrenzung wie bei jedem Fehlversuch und eine Instanz ohne offene
  Registrierung.
- *Ein gesperrtes Konto kostet dieselbe argon2id-Prüfung wie ein unbekanntes.*
  Ohne das hätte die Antwortzeit verraten, welche Konten gesperrt sind.
- *Wer den Link einlöst, ist danach angemeldet.* Er hat gerade bewiesen, dass er
  den Link hat, und ein frisch gesetztes Passwort noch einmal eintippen zu
  müssen wäre reine Zeremonie.
- *Kein Mailversand.* Die Anwendung baut keine ausgehenden Verbindungen auf;
  „verschicken" heißt, dass ein Administrator den Link weitergibt wie eine
  Einladung.

## 2026-08-22 – Backlog: Preisverlauf und Einkaufsort

**Umfang**

- **Export und Import nehmen die Preise mit** (`prices` im JSON, `prices.csv`
  daneben). Wiedererkannt wird ein Eintrag an Konto, Einkaufstag und Betrag,
  damit derselbe Import zweimal nichts verdoppelt.

- **Tabelle `prices`** (Migration `0004_product_prices.sql`): Betrag in der
  kleinsten Währungseinheit, Währung, Einkaufsort, Notiz, Einkaufsdatum, dazu
  Indizes auf (`product_id`, `purchased_at`), `user_id` und `shop` sowie ein
  CHECK gegen negative Beträge.
- **Routen** (README 4.3): `POST /api/v1/products/:id/prices`,
  `DELETE /api/v1/prices/:id`, `GET /api/v1/prices/shops`. Gelesen wird der
  Verlauf über die Produkt-Detailabfrage (`ProductDetail.prices`, jüngster
  Einkauf zuerst, höchstens 50 Einträge).
- **Konfiguration** `app.currency` (Standard `EUR`).
- **Oberfläche**: Abschnitt „Preise“ auf der Produktseite mit dem zuletzt
  bezahlten und dem günstigsten Preis obendrüber, der Liste darunter und einem
  Formular mit Vorschlagsliste für den Einkaufsort. `web/src/lib/money.ts`
  rechnet Eingaben in Cent um (Komma wie Punkt) und formatiert über `Intl`
  zurück.

**Entscheidungen**

- *Ganze Zahlen, keine Dezimalzahlen.* 1,10 + 2,20 ergibt binär nicht 3,30 – ein
  Preisverlauf, der sich verrechnet, ist schlimmer als keiner. Auf der Leitung
  stehen Cent, gerechnet wird nirgends mit Gleitkomma.
- *Die Währung steht am Eintrag, nicht nur in der Konfiguration.* Bezahlt ist
  bezahlt; eine spätere Umstellung der Instanz schreibt die Vergangenheit nicht
  um.
- *Erfassen darf jedes Konto, löschen nur der Eigentümer* (und Administratoren)
  – dieselbe Aufteilung wie bei Fotos: die Tatsache gehört dem Haushalt, der
  Eintrag dem, der ihn geschrieben hat.
- *Keine eigene Leseroute.* Ein Preis ist nur neben seinem Produkt interessant,
  also hängt die Liste wie Fotos und Bewertungen an der Einzelabfrage – und
  bleibt aus der Katalogliste heraus.
- *Ein reines Datum wird als Mittag UTC gelesen*, damit der eingetippte Tag in
  jeder Zeitzone der eingetippte Tag bleibt. Zukunft ist ausgeschlossen, mit
  einem Tag Toleranz für schnell gehende Uhren.

## 2026-08-22 – Backlog: Volltextsuche über FTS5

**Umfang**

- **`products_fts`** (Migration `0003_product_search.sql`): FTS5-Tabelle über
  Name, Marke und EAN mit dem Tokenizer `trigram remove_diacritics 1`, gefüllt
  aus dem vorhandenen Katalog und von drei Triggern auf `products` aktuell
  gehalten (INSERT, UPDATE, DELETE).
- **`searchCondition()`** fragt sie über
  `products.id in (select product_id from products_fts where products_fts match ?)`
  ab. Jedes Wort wird gequotet, mehrere Wörter verbindet FTS5 mit UND.
- **`LIKE` bleibt als Rückfallweg** für Wörter mit weniger als drei Zeichen –
  kürzer als ein Trigramm, davon weiß der Index nichts. Das Ergebnis ist in
  beiden Wegen exakt.
- **Tests:** Wort im Kompositum („flocken“ → Haferflocken), Umlaute, Barcode
  von hinten, zwei Wörter als Einschränkung, kurzer Begriff über `LIKE`,
  Sonderzeichen als Text, und dass Umbenennen und Papierkorb im Index ankommen.

**Entscheidungen**

- *Trigramme statt Wörtern.* Ein wortbasierter Index findet „Apfelsaft“ nicht,
  wenn jemand „saft“ tippt – im Deutschen ist genau das der Normalfall. Der
  Trigramm-Tokenizer beantwortet Teilwortsuchen aus dem Index, was der bisherige
  `LIKE`-Durchlauf nur mit einem Tabellenscan konnte.
- *Eine eigene Tabelle mit `product_id`, keine External-Content-Tabelle.* Der
  Text steht damit zweimal in der Datenbank (bei ein paar hunderttausend kurzen
  Zeilen kein Thema), dafür sind die Trigger drei triviale Anweisungen und die
  Abfrage braucht keinen `rowid`-Verbund.
- *Der Suchbegriff wird immer gequotet.* Unquotiert liest FTS5 `bio-hof` als
  Spaltennamen und die Anfrage scheitert; Nutzereingabe ist Text, keine Syntax.
- *Diakritika werden gefaltet.* „musli“ findet „Müsli“ – auf einer
  Telefontastatur am Regal ist das die freundlichere Regel.
- README 4.1 hält die alte Begründung für `LIKE` nicht mehr fest, sondern
  beschreibt den neuen Weg samt Grenze bei zwei Zeichen.

## 2026-08-22 – Backlog: fremde Bewertungen sichtbar machen

**Umfang**

- **`ProductDetail.allRatings`**: `GET /api/v1/products/:id` (und
  `…/by-ean/:ean`) liefert jede Bewertung des Produkts – die eigene
  eingeschlossen –, mit Sternen, Kommentar, Datum und Benutzernamen, jüngstes
  Urteil zuerst (`listProductRatings()` in `services/ratings.ts`).
- **Produktseite** zeigt darunter den Abschnitt „Bewertungen im Haushalt“; der
  eigene Eintrag trägt die Kennzeichnung „Du“, ein gelöschtes Konto steht als
  „Gelöschtes Konto“ da.
- **Nach dem Speichern der eigenen Bewertung** wird die Detailabfrage neu
  geholt: die Antwort der Schreibroute trägt Durchschnitt und eigene Bewertung,
  aber nicht die Liste der anderen.

**Entscheidungen**

- *Nur der Benutzername verlässt das Konto.* Ein Haushalt kennt sich; alles
  Weitere über ein Konto geht die anderen nichts an.
- *Die Liste bleibt aus dem Katalog heraus.* Eine Kachel zeigt eine Zahl – die
  Bewertungen jedes Produkts mitzulesen wäre auf jeder Listenseite zu bezahlen.
  Sie hängt deshalb an der Einzelabfrage, wie die Fotos.
- *Die eigene Bewertung steht doppelt in der Antwort* (`ownRating` und in
  `allRatings`). Die Liste ist damit vollständig lesbar, ohne dass die Seite
  zwei Quellen zusammensetzen muss, und `ownRating` bleibt die eine Stelle, die
  der Editor kennt.
- *Nichts wird schreibbar.* Die Routen adressieren weiterhin nur „meine
  Bewertung dieses Produkts“ – eine fremde lässt sich gar nicht erst ansprechen.

## 2026-08-22 – Backlog: Export nach JSON und CSV, Import zum Umzug

**Umfang**

- **`server/src/services/transfer.ts`** mit `exportCatalogue()` und
  `importCatalogue()`, dazu die Befehle `product-rating export --to <dir>` und
  `product-rating import --from <dir>` (README 8.3).
- **Export** schreibt `export.json` (die Form, die der Import liest),
  `products.csv` und `ratings.csv` (RFC 4180 mit Byte Order Mark) und mit
  `--with-photos` die Detailbilder nach `photos/`. `--include-trash` nimmt den
  Papierkorb mit, sonst bleibt er außen vor.
- **Import** führt zusammen, statt zu ersetzen: vorhandene Produkte bleiben,
  wie sie sind (`--update` schreibt drüber und holt sie aus dem Papierkorb),
  vorhandene Bewertungen werden nie überschrieben, Fotos werden an Konto und
  Aufnahmezeitpunkt wiedererkannt. `--dry-run` prüft nur.
- **Tests:** Rundlauf zwischen zwei Wegwerf-Instanzen (Export → Import →
  Bewertungen und Fotos sind drüben), doppelter Import, fremdes Dateiformat,
  unbekanntes Konto mit und ohne `--owner`, dazu drei CLI-Fälle.

**Entscheidungen**

- *Konten sind nicht Teil eines Exports.* Eine Datei mit Passwort-Hashes wäre
  ein Satz Zugangsdaten. Bewertungen und Fotos nennen ihr Konto über den
  Benutzernamen; die Zuordnung passiert beim Import.
- *Ein unbekannter Benutzername bricht ab, bevor etwas geschrieben ist.* Alle
  Namen werden zuerst aufgelöst – ein halb eingelesener Import ist das eine
  Ergebnis, das niemand von Hand aufräumen kann. `--owner` übernimmt solche
  Einträge bewusst.
- *Bilder laufen durch `storePhoto()`.* Der Umweg kostet eine erneute
  Kodierung, dafür kommt keine fremde Datei ungeprüft auf die Platte, und das
  Thumbnail entsteht wie bei jedem Upload.
- *CSV ist Ausgabeformat, JSON die Austauschform.* Eine CSV-Datei kann
  Bewertungen und Fotos eines Produkts nicht ohne Verrenkungen tragen; wer
  Tabellen will, bekommt zwei flache Dateien.
- *Abgrenzung zu `backup`.* README 8.3 stellt beide gegenüber, damit niemand
  einen Export für eine Sicherung hält.

## 2026-08-22 – Backlog: Papierkorb statt endgültigem Löschen

**Umfang**

- **`products.deleted_at` / `products.deleted_by`** (Migration
  `0002_product_trash.sql`, Index auf `deleted_at`). `DELETE
  /api/v1/products/:id` setzt beide, statt zu löschen; Bewertungen, Fotos und
  Bilddateien bleiben unangetastet liegen.
- **Jede lesende Abfrage filtert:** Katalog, Suche, Einzelabruf, EAN-Suche,
  Kategorievorschläge und „Meine Bewertungen“ (samt `total`) sehen ein Produkt
  im Papierkorb nicht mehr. Auch Bewerten, Ändern und Foto-Upload finden es
  nicht – `findProductById()` blendet es aus.
- **Drei Routen für Administratoren:** `GET /api/v1/trash`,
  `POST /api/v1/trash/:id/restore`, `DELETE /api/v1/trash/:id`. Nur die letzte
  löscht wirklich und räumt die Bilddateien ab.
- **`app.trash_retention_days`** (Standard 30, `0` = nie): Beim Start und
  danach täglich – auf demselben Timer wie das Aufräumen der Sitzungen – wird
  geleert, was länger als die Aufbewahrungsfrist im Papierkorb liegt.
- **Verwaltung** bekommt einen Abschnitt „Papierkorb“ mit Zurückholen und
  endgültigem Löschen (zwei Klicks). Auf der Produktseite heißt die Schaltfläche
  jetzt „In den Papierkorb“.

**Entscheidungen**

- *Ein Filter statt einer zweiten Tabelle.* Wiederherstellen ist damit ein
  einziges `UPDATE`, und die EAN bleibt belegt – ein zweiter Scan legt kein
  Duplikat neben das gerade gelöschte Produkt.
- *Eine belegte EAN aus dem Papierkorb holt das Produkt zurück.* Ein `409` wäre
  eine Sackgasse: Löschen und Papierkorb gehören Administratoren, das Konto am
  Regal käme also nicht weiter. Die neu eingegebenen Daten gewinnen, Bewertungen
  und Fotos kommen mit; die Antwort sagt es über `restored`.
- *Bilder bleiben abrufbar, solange das Produkt im Papierkorb liegt.* Sie sind
  ohnehin nur mit Sitzung und bekannter ID erreichbar, und ein Produkt soll
  vollständig zurückkommen.
- *Endgültiges Löschen setzt den Papierkorb voraus.* `DELETE /api/v1/trash/:id`
  weigert sich bei einem Produkt, das noch im Katalog steht – sonst wäre der
  Papierkorb ein Vorschlag und kein Netz.

## 2026-08-22 – Backlog: Fotoreihenfolge je Produkt

**Umfang**

- **`photos.position`** ersetzt `photos.is_primary` (Migration
  `0001_photo_order.sql`, Index `photos_product_position_idx`). Die Position
  zählt von null an und bleibt lückenlos; jede Änderung an der Galerie läuft
  über eine Umnummerierung in derselben Transaktion.
- **Hauptbild ist abgeleitet:** `Photo.isPrimary` ist `position === 0`. Damit
  gibt es keine zweite, getrennt gespeicherte Wahrheit mehr, die der
  Reihenfolge widersprechen könnte – Kachel im Katalog und erste Kachel auf der
  Detailseite sind zwangsläufig dasselbe Bild.
- **`PUT /api/v1/photos/:id/position`** verschiebt ein Foto und antwortet mit
  der neuen Reihenfolge des ganzen Produkts. Eine Position hinter dem Ende
  bedeutet „ans Ende“, weil der Client Kacheln auf einem möglicherweise
  veralteten Stand zählt. `PUT …/primary` ist seitdem die Kurzform für
  Position 0.
- **Oberfläche:** zwei Pfeile je Kachel (`PhotoManager`), sichtbar für die
  Fotos, die das Konto ändern darf, plus ein Hinweis, dass das erste Foto das
  Hauptbild ist.

**Entscheidungen**

- *Verschieben gehört dem Eigentümer, nicht jedem Konto.* Die Reihenfolge ist
  zwar eine Eigenschaft des Produkts, das einzelne Bild aber nicht – deshalb
  gilt für `position` dieselbe Regel wie fürs Löschen (Eigentümer oder
  Administrator), statt eine zweite Zuständigkeit einzuführen.
- *Eine Route je Foto statt einer Liste aller IDs.* Ein Aufruf `{ position }`
  ist genau das, was ein Pfeil auslöst; eine vollständige Reihenfolge im Körper
  müsste gegen den Serverstand geprüft werden und wäre bei zwei Telefonen im
  Haushalt die fehleranfälligere Form.
- *Beim Löschen wird umnummeriert, nicht nachgerückt.* Eine Lücke auf Position
  null hieße: Produkt mit Fotos, aber ohne Hauptbild.

## 2026-08-17 – M14: Qualitätssicherung und Release

**Umfang**

- **Härtungs-Header in der Anwendung** (`server/src/plugins/securityHeaders.ts`):
  Content-Security-Policy, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy` und die beiden `Cross-Origin-*`-Header
  auf jeder Antwort – Oberfläche, API und Fehlerseiten gleichermaßen. Die Policy
  ist gegen das gebaute Bundle geprüft: kein Inline-Skript, kein Inline-Stil,
  kein `data:` in der Stylesheet-Ausgabe. Zugeständnisse sind nur
  `'wasm-unsafe-eval'` (Barcode-Decoder), `blob:` für Fotovorschau und
  Kamerabild und `data:` für kleine eingebettete Bilder.
- **Proxy-Beispiele nachgezogen:** nginx (beide), Apache, Caddy (beide Dateien),
  Traefik (`dynamic.yml` und Labels) setzen nur noch
  `Strict-Transport-Security`. Bei nginx wäre ein zweites `add_header`
  zusätzlich beim Browser angekommen, nicht statt des ersten.
- **Integrationstest über den ganzen Weg** (`server/src/routes/integration.test.ts`,
  23 Fälle): Bootstrap-Administrator → Einladung → Registrierung → gescanntes
  UPC-A als Produkt → Foto vom Telefon → Bewertungen zweier Konten → Suche,
  Filter, Sortierung, Seiten → was nicht erlaubt ist → Löschen durch den
  Administrator.
- **Berechtigungsmatrix** (`server/src/routes/permissions.test.ts`): eine
  Tabelle aller 28 Routen mit der jeweils nötigen Rolle. Die Liste wird gegen
  den Router selbst abgeglichen, eine neue Route ohne Eintrag lässt den Test
  fehlschlagen. Dazu die Sitzung eines gesperrten Kontos, die überall wie eine
  anonyme Anfrage behandelt wird.
- **Versionsschema** (README 9.1): SemVer, eine Nummer für das ganze
  Repository, `0.1.0` als erste ausgelieferte Version. HISTORY.md ist das
  Änderungsverzeichnis, `packaging/debian/changelog` der Paketeintrag;
  `server/src/version.test.ts` besteht darauf, dass alle vier Manifeste und der
  Changelog dieselbe Nummer nennen.
- **Zwei Workflows** unter `.github/workflows/`: `ci.yml` (Format, Lint, Typen,
  Tests, Bau; Debian-Paket inklusive Installation, Start, `/healthz`, `remove`
  und `purge`; Container-Image inklusive Start und `/healthz`) und `release.yml`
  (Tag `v*`: Paket für amd64 und arm64 auf Runnern der jeweiligen Architektur,
  Multi-Arch-Image nach GHCR, GitHub-Release mit beiden `.deb`).
- **Sicherheitsdurchsicht** mit drei Korrekturen: Anmeldungen unter einem
  unbekannten Namen prüfen jetzt gegen einen Platzhalter-Hash, damit die
  Antwortzeit nicht verrät, wer ein Konto hat; die Bildverarbeitung dekodiert
  höchstens 100 Megapixel; API-Antworten tragen `Cache-Control: no-store`.
- **Erster CI-Lauf hat gleich etwas gefunden:** Die Startprüfung des
  syslog-Ziels meldete unter Umständen `spawnSync logger EPIPE` statt des
  eigentlichen Grundes. `logger` ohne erreichbaren Socket endet, bevor die
  Prüfzeile geschrieben ist; wer das Rennen gewinnt, hängt an der Maschine.
  `EPIPE` ist jetzt kein Grund mehr für sich, sondern führt weiter zu Exit-Code
  und stderr des Programms – also zu der Meldung, für die die Prüfung da ist.
- **Installation gegengeprüft**: Paket gebaut, mit `dpkg -i` installiert,
  Rechte kontrolliert (`config.toml` 0640 `root:product-rating`, `secret.env`
  0600, Datenverzeichnisse 0750), Migrationen, CLI, Serverstart, Anmeldung,
  Produktanlage, Header an der echten Instanz, danach `purge`. 484 Tests grün;
  `lint`, `typecheck` und `format:check` fehlerfrei.

**Entscheidungen**

- **Die Header gehören in die Anwendung, nicht in den Proxy.** Seit M10 liefert
  sie das HTML selbst aus und ist die einzige Stelle, die ihr eigenes Bundle
  kennt. Ausnahme ist HSTS: hinter dem Proxy spricht die Anwendung einfaches
  HTTP und kann nicht wissen, ob wirklich ein Zertifikat davorsteht.
- **`0.1.0` und nicht `1.0.0`.** Der MVP ist vollständig, aber noch nirgends im
  Alltag gelaufen. Die Eins vergibt der Projektinhaber nach der ersten
  produktiven Installation; bis dahin steht MINOR für alles, was sonst MAJOR
  wäre.
- **Kein `CHANGELOG.md`.** HISTORY.md ist bereits das Verzeichnis der Arbeiten
  und wird bei jedem Paket gepflegt; ein zweites Dokument liefe daneben her.
  `packaging/debian/changelog` bleibt der kurze Paketeintrag, den `dpkg`
  erwartet – gegen das Auseinanderlaufen steht der Test, nicht ein Generator.
- **Beide Architekturen auf eigenen Runnern statt unter Emulation.**
  `better-sqlite3`, `sharp` und `@node-rs/argon2` bringen native Binärdateien
  mit, und `build-deb.sh` weigert sich zu Recht, ein Paket als etwas anderes zu
  beschriften, als es gebaut wurde. Die arm64-Runner sind für öffentliche
  Repositories kostenlos.
- **Nur Actions von GitHub selbst.** Anmelden an der Registry, Bauen und das
  Release laufen über `docker`, `docker buildx` und `gh` in Shell-Schritten.
  Was ein Release veröffentlicht, soll von so wenigen fremden Stellen wie
  möglich abhängen.
- **Kein Ratenlimit für Uploads.** README hat eines behauptet, gebaut war nie
  eines. Wer hochladen darf, ist angemeldet und gehört zum Haushalt; was
  wirklich fehlte, war eine Grenze für die Bildgröße hinter der Bytegrenze –
  die ist jetzt da. Der Punkt steht als Frage in TODO.md.
- **Ein Platzhalter-Hash statt einer gleichlangen Wartezeit.** Eine künstliche
  Verzögerung müsste geraten werden und wäre bei geänderten argon2-Parametern
  wieder falsch; eine echte Prüfung gegen einen Hash, den niemand kennt, kostet
  genau so viel wie eine echte Anmeldung.

---

## 2026-08-16 – M13: CLI und Betrieb

**Umfang**

- `product-rating <befehl>` als einziger Einstiegspunkt der Anwendung
  (`server/src/cli/`): `serve`, `migrate`, `user add|list|disable|enable|passwd`,
  `invite create|list|revoke`, `backup`, `restore`, `fsck`, dazu `help` und
  `version`. `server/src/index.ts` reicht nur noch `process.argv` an den
  Verteiler weiter und setzt dessen Antwort als Exit-Code; `src/migrate.ts` und
  `src/fsck.ts` sind entfallen, das Bundle hat einen Einstiegspunkt statt drei.
- Einheitliche Exit-Codes: `0` erledigt, `1` fehlgeschlagen oder Fund, `2` falsch
  aufgerufen. Ergebnisse gehen nach stdout, Fortschritt und Fehler nach stderr,
  damit `product-rating invite create` in einer Pipe genau den Code liefert.
- Eigener Optionen-Parser (`cli/options.ts`): Jeder Befehl nimmt seine eigenen
  Schalter heraus und reicht die Konfigurationsschalter aus M1 (`--config`,
  `--set`, Kurzformen) unverändert an `loadConfig()` weiter. Unbekannte Schalter
  sind ein Fehler statt stiller Nachsicht.
- `backup --to <dir> [--keep-days N]` und `restore --from <dir> [--yes]`
  (`services/backup.ts`): Kopie über `VACUUM INTO`, Gegenlesen mit
  `PRAGMA integrity_check`, Fotos gegen den Vorgänger hart verlinkt,
  `latest`-Symlink, Aufbewahrungsgrenze nach Verzeichnisnamen. Layout identisch
  zu `packaging/examples/backup/product-rating-backup`, damit Snapshots beider
  Wege austauschbar sind.
- Strukturiertes Logging mit pino (`server/src/logging/`): `log.level`,
  `log.format` (`json`/`pretty`) und `log.destination` (`stdout`/`file`/`syslog`)
  wirken jetzt tatsächlich; bisher war nur der Level angeschlossen. Fastify
  bekommt die fertige Instanz über `loggerInstance`.
- Anmeldeversuche unter einem Namen im Log: `event: "auth.login"` mit `outcome`
  (`success`, `failure`, `rate_limited`), Benutzername, IP und – nur im Log – dem
  Grund. Damit ist der offene Punkt aus M3 erledigt.
- `/healthz` meldet Version, Erreichbarkeit der Datenbank und Beschreibbarkeit
  des Upload-Verzeichnisses; `503` und `"degraded"`, sobald eines davon fehlt.
- Paket und Container nachgezogen: Der Debian-Aufsatz beantwortet nur noch
  `version` selbst und übergibt den Rest an das Bundle, der Container-Entrypoint
  ruft `dist/index.js migrate` beziehungsweise `serve`, `build-deb.sh` prüft nur
  noch den einen Einstiegspunkt.
- README 5, 7.2, 8 (neu 8.1 Kommandozeile, 8.2 Logging) und CLAUDE.md 4
  nachgezogen. 427 Tests grün; `lint`, `typecheck` und `format:check` fehlerfrei.

**Entscheidungen**

- **Ein Einstiegspunkt statt drei.** `serve` ist ein Befehl wie jeder andere.
  Der Aufsatz in `/usr/bin` musste sonst wissen, welche Datei welchen Befehl
  bedient, und lief bei jedem neuen Befehl der Anwendung hinterher.
- **Kein `--password` auf der Kommandozeile.** Ein Passwort als Argument steht
  in der Shell-History und für die Laufzeit des Prozesses in der Prozessliste
  jedes Nutzers der Maschine. Es bleibt die Abfrage ohne Echo (zweimal, gegen
  Tippfehler) und `--password-stdin` für Skripte.
- **`restore` fragt nach dem Wort „restore“**, nicht nach „ja“. Der Befehl
  ersetzt Datenbank und Fotos; eine Frage, die man im Reflex bejaht, ist dafür
  zu wenig. Die vorhandene Datenbank wird vorher als `pre-restore-<stempel>.db`
  daneben gelegt, ein Griff in das falsche Verzeichnis ist also umkehrbar.
- **syslog über `logger`.** Node kann keine Unix-Datagram-Sockets, `/dev/log`
  ist genau das. Statt eines nativen Moduls für ein Logziel bekommt ein
  langlebiger `logger`-Prozess (util-linux, wie in den Shell-Skripten des
  Projekts) die Zeilen über stdin, mit `--prio-prefix` und `<PRI>` je Zeile,
  damit eine Warnung im Journal eine Warnung bleibt. Stirbt er, fallen die
  Zeilen auf stderr zurück – ein Dienst, der wegen seines Loghelfers abstürzt,
  wäre der schlechtere Tausch. Beim Start wird eine Testzeile geschrieben, sonst
  fiele erst im Ernstfall auf, dass nichts ankommt.
- **`pretty` ohne Worker-Thread.** pino-pretty läuft im Prozess statt als
  Transport: Ein Worker müsste vor dem Ende sauber abgeräumt werden, und für die
  Zeilenzahl einer Haushaltsinstanz ist das viel Maschinerie für nichts.
- **Kopien behalten die Änderungszeit.** Ohne das trüge jede Kopie im Snapshot
  die Zeit des Backup-Laufs, und der nächste Lauf könnte unveränderte Fotos
  nicht mehr erkennen – das harte Verlinken hängt daran. Entspricht `cp -p`.
- **Befehle verweigern die Arbeit auf einem veralteten Schema** und nennen
  `product-rating migrate`. Eine Abfrage gegen eine fehlende Spalte scheitert
  sonst mit einer Meldung über SQL statt mit dem einen hilfreichen Satz.
- **`user enable` zusätzlich aufgenommen.** `disable` ließe sich sonst nur in
  der Weboberfläche zurücknehmen – ausgerechnet dort, wo man nach einem
  versehentlich gesperrten Konto nicht unbedingt hinkommt.
- **`/healthz` bleibt schmal.** Version und zwei Wahrheitswerte, sonst nichts:
  Die Route ist absichtlich ohne Anmeldung erreichbar, also hat sie einem
  Fremden nichts über das Innere der Installation zu erzählen.

**Test**

Gegen ein gebautes Bundle in einer eigenen Instanz durchgespielt: `migrate`
(auch zweimal, bleibt bei „nothing to do“), `user add --password-stdin`,
`user list`, `invite create` und `list`, `backup --to`, `fsck --uploads`,
`serve` mit `/healthz`, einer fehlgeschlagenen und einer erfolgreichen Anmeldung
im Log und Abschluss über SIGTERM mit Exit-Code 0. `logger` ohne syslog-Socket
hat dabei einen EPIPE-Absturz ausgelöst – behoben, die Zeilen fallen jetzt auf
stderr zurück, und der Fall ist als Test hinterlegt.

---

## 2026-08-16 – M12: Mitgelieferte Konfigurationen

**Umfang**

- `packaging/examples/` mit elf Dateien plus Übersicht: nginx (eigener Host und
  Unterpfad), Apache 2.4, Caddy, Traefik (File-Provider und Compose-Labels),
  systemd-Drop-in, ufw-Applikationsprofil sowie das Backup-Skript mit `.service`
  und `.timer`. `packaging/build-deb.sh` legt das Verzeichnis seit M11 von sich
  aus nach `/usr/share/doc/product-rating/examples/`; am Bauskript war nichts zu
  ändern.
- Betrieb unter einem Unterpfad im Web-Client ermöglicht:
  `PRODUCT_RATING_BASE_PATH` setzt Vites `base`, daraus leiten sich `index.html`,
  `start_url`/`scope` des Manifests, der Geltungsbereich des Service Workers,
  die `navigateFallbackDenylist`, `API_BASE` und das `basename` des Routers ab.
  Dazu ein gleichnamiges Build-Argument im `Dockerfile`, damit beide
  Deployment-Wege es können.
- Backup-Skript nach den Skript-Konventionen: Header mit Programmablaufplan,
  `--help` inklusive Wiederherstellungsanleitung, Silent-/Verbose-Modus, jeder
  Parameter zusätzlich als `PRODUCT_RATING_BACKUP_*`-Variable, Logging über
  `logger`. Kopiert die Datenbank mit `VACUUM INTO`, prüft die Kopie mit
  `PRAGMA integrity_check` und verlinkt die Fotos mit `rsync --link-dest` hart
  gegen den Vorgänger.
- README 2.2, 7.3, 8 und 9 sowie CLAUDE.md 3 und 7 nachgezogen.
- 385 Tests grün; `lint`, `typecheck` und `format:check` fehlerfrei;
  `shellcheck` sauber.

**Entscheidungen**

- **Die Beispiele setzen keine Cache-Header.** Seit M10 setzt die Anwendung sie
  selbst und ist die einzige Stelle, die die gehashten Dateien unter `/assets/`
  von `index.html`, `sw.js` und dem Manifest unterscheiden kann. Eine
  `expires`-, `ExpiresByType`- oder `header Cache-Control`-Regel im Proxy
  überschriebe genau das. Dass die Werte der Anwendung durchkommen, ist in allen
  vier Proxys gemessen.
- **Der Unterpfad wird beim Bau festgelegt, nicht zur Laufzeit.** Der Pfad
  steckt in Dateien, die der Bau schreibt – Manifest und Service Worker –, und
  ein Proxy kann sie nicht nachträglich umschreiben. Der Proxy schneidet
  stattdessen das Präfix ab, sodass der Server unverändert auf `/` und
  `/api/v1` antwortet und keine eigene Einstellung braucht.
- **Apache: `LimitRequestBody` reicht nicht.** Gemessen an Apache 2.4.58 geht
  eine von `mod_proxy` behandelte Anfrage daran vorbei – auch im
  `<Location>`-Block; mit einem Testlimit von 1024 Byte lief ein 6,6-KB-Upload
  durch. Die Begrenzung erledigt deshalb eine `mod_rewrite`-Regel über die
  angekündigte `Content-Length`, die mit 413 antwortet. `LimitRequestBody`
  bleibt für alles stehen, was Apache selbst ausliefert.
- **`AllowEncodedSlashes NoDecode` plus `nocanon`** im Apache-Beispiel: ohne die
  beiden beantwortet Apache eine Adresse mit `%2F` selbst mit 404, statt sie
  weiterzureichen. Gegenprobe gefahren – ohne die Direktiven 404, mit ihnen
  erreicht die Anfrage die Anwendung.
- **Keine logrotate-Vorlage und keine zweite Unit** unter `examples/`. Beide
  gehören zum Paket und lägen sonst doppelt im Repository, mit dem üblichen
  Auseinanderlaufen. README 7.3 nennt jetzt die installierten Pfade; für lokale
  Abweichungen an der Unit ist das Drop-in da.
- **`ufw`: zwei Profile.** Das eine öffnet 80 und 443 für den Proxy, das andere
  den Port der Anwendung für den Betrieb ohne Proxy – mit dem Hinweis, dass ohne
  TLS die Kamera und damit der Scanner ausfällt.
- **Backup ohne TOML-Parser.** Das Skript liest `config.toml` bewusst nicht,
  sondern kennt Standardpfade und Parameter. Ein halbherziger Parser, der eine
  geänderte Konfiguration übersieht, sicherte sonst still das falsche
  Verzeichnis.

**Test**

Gegen eine echte Instanz (gebautes Bundle, Server auf `127.0.0.1:8080`,
selbstsigniertes Zertifikat) lief nacheinander nginx 1.24, Apache 2.4.58,
Caddy 2.10.2 und Traefik 3.5.0 davor. Geprüft wurden App-Shell, Deep-Link auf
die App-Shell, `/api/v1` bleibt auch mit `Accept: text/html` JSON, die
durchgereichten `Cache-Control`-Werte (`immutable` für `/assets/`, `no-cache`
für `sw.js`, `index.html` und Manifest), Kompression, die Security-Header,
Anmeldung samt Ablehnung einer fremden `Origin`, das Anlegen eines Produkts,
ein Foto-Upload sowie die Größenstaffelung: 17 MB lehnt die Anwendung mit
lesbarem Fehler ab, 25 MB schon der Proxy mit 413. Für den Unterpfad lief eine
zweite Instanz mit einem Bundle für `/produkte`: Weiterleitung ohne
Schrägstrich, Bundle, Manifest (`start_url` und `scope`), API und Anmeldung
unter dem Präfix, und der Rest des Hostnamens bleibt unberührt.

Das Backup-Skript lief gegen die laufende Instanz: Snapshot,
`integrity_check`, Rückzählung aus der Kopie (1 Produkt, 13 Fotos), harte
Verlinkung beim zweiten Lauf (gleiche Inode-Nummer), Aufbewahrungsgrenze (alter
Snapshot weg, fremdes Verzeichnis und `latest` bleiben), `--retention 0`,
Fehlerpfade und Exit-Codes. `systemd-analyze verify` läuft für die Unit mit
angewandtem Drop-in sowie für `.service` und `.timer` ohne Beanstandung;
`ufw app info` zeigt beide Profile.

Drei Punkte konnten hier nicht laufen und stehen als offene Punkte unter M12:
die Traefik-Compose-Labels und der Docker-Bau mit `PRODUCT_RATING_BASE_PATH`
(kein Docker-Daemon in der Entwicklungsumgebung) sowie nginx ab 1.25.1, dessen
`http2 on;` das ausgelieferte Beispiel verwendet – getestet wurde mit 1.24 und
der dort nötigen alten Schreibweise, die im Beispiel als Hinweis steht.

## 2026-08-15 – M11: Debian-Paket

**Umfang**

- `packaging/build-deb.sh` als `npm run package:deb`: baut beide Workspaces,
  stellt den Laufzeit-Abhängigkeitsbaum zusammen, legt den Installationsbaum
  unter `packaging/build/` an, schreibt `DEBIAN/` samt `md5sums` und ruft
  `dpkg-deb --build --root-owner-group` auf (kein `fakeroot` nötig). Nach den
  Skript-Konventionen: Header mit Programmablaufplan, `--help`,
  Silent-/Verbose-Modus, jeder Parameter zusätzlich als `BUILD_DEB_*`-Variable,
  Logging über `logger` plus Konsole.
- `packaging/debian/`: `control` (mit Platzhaltern für Version, Architektur,
  Größe und die ermittelten Bibliotheks-Abhängigkeiten), `conffiles`,
  `templates`, `config`, `postinst`, `prerm`, `postrm`, die systemd-Unit, die
  logrotate-Regel, die ausgelieferte `config.toml`, der CLI-Aufsatz,
  `copyright`, `changelog` und `lintian-overrides`.
- `postinst`: Systemnutzer, Verzeichnisse mit Rechten, Secret mit `0600`,
  Migrationen als Dienstnutzer und mit `umask 0027`, Anmeldung der Unit bei
  systemd. Neuinstallation aktiviert den Dienst, startet ihn aber nicht –
  `server.base_url` muss vorher stimmen; ein Upgrade startet einen laufenden
  Dienst neu. `prerm` stoppt nur bei `remove`, damit ein Upgrade eine einzige
  Unterbrechung hat statt einer über den ganzen Auspackvorgang.
- `postrm`: `purge` entfernt `/etc/product-rating` samt Secret immer und fragt
  über debconf nach den Nutzdaten; ohne Antwort bleibt es beim Nein. Der
  Systemnutzer geht nur mit den Daten, sonst gehörten die behaltenen Dateien
  einer unbekannten uid.
- systemd-Unit mit `ProtectSystem=strict`, `ReadWritePaths`, `NoNewPrivileges`,
  `PrivateTmp`, `SystemCallFilter=@system-service`, leerem
  `CapabilityBoundingSet` und `UMask=0027`. `MemoryDenyWriteExecute` bleibt
  bewusst aus: der JIT der JavaScript-Engine braucht beschreibbare und
  ausführbare Seiten.
- `/usr/bin/product-rating` bildet `serve`, `migrate` und `fsck` auf die
  vorhandenen Einstiegspunkte ab und meldet für `user`, `invite`, `backup` und
  `restore`, dass es sie noch nicht gibt (M13), statt still nichts zu tun.
- README 7.2 und 9, CLAUDE.md 3 und 4 nachgezogen.
- 385 Tests grün; `lint`, `typecheck` und `format:check` fehlerfrei.

**Entscheidungen**

- **Unit nach `/usr/lib/systemd/system/`**, nicht nach `/lib/systemd/system/`
  wie bisher in der README: auf einem merged-usr-System ist `/lib` ein Symlink,
  und ein Paket darf nicht durch einen Symlink hindurch installieren.
- **Natives Paket** (`0.0.0` ohne Debian-Revision), also `changelog.gz` statt
  `changelog.Debian.gz` – Anwendung und Verpackung sind ein Quellbaum.
- **Kein `npm prune` im Repository.** Ein eigenes Verzeichnis mit nur den
  Manifesten und der Lock-Datei bekommt aus denselben festgenagelten Versionen
  dasselbe Ergebnis, ohne den Entwicklungsbaum des Bauenden zu zerlegen. Der
  Install ist auf den Server-Workspace gefiltert: die Laufzeitpakete von `web/`
  (React, Router, `zxing-wasm`) stecken schon im gebauten Client.
- **Binärdateien fremder Plattformen fliegen raus** (musl, wasm32, darwin,
  win32, andere Architektur), dazu Testsuiten, Dokumentation und CI-Metadaten
  der Abhängigkeiten; die nativen Module werden mit `strip --strip-unneeded`
  entlastet. Zusammen aus 130 MB `node_modules` 71 MB installiert, 11,8 MB
  Paket. Das Ausführbar-Bit unter `node_modules` richtet sich danach, ob eine
  Datei mit `#!` beginnt.
- **`dpkg-shlibdeps` statt Vermutung**: die C-Bibliotheken der nativen Module
  werden beim Bau ermittelt und in `Depends` geschrieben (`libc6 (>= 2.34)`,
  `libgcc-s1`, `libstdc++6`) – `nodejs` allein garantiert sie nicht.
- **Kein Fremdbau.** Die Prebuilds stammen vom Baurechner, deshalb lehnt das
  Skript ein `--arch` ab, das nicht zur eigenen Architektur passt: ein Paket mit
  `arm64` im Namen und x86-Binärdateien darin installiert sauber und scheitert
  erst bei der ersten Datenbankabfrage.
- **lintian**: von 8179 Meldungen auf null offene. Behoben statt überdeckt
  wurden `no-debconf-config`, der Changelog-Name und seine Zeilenlänge, die
  Pfade in `test`-Ausdrücken der Maintainer-Skripte, die Ja/Nein-Formulierung im
  debconf-Text, die fremden Binärdateien, die Ausführbar-Bits und die
  Bibliotheks-Abhängigkeiten. Vier Punkte stehen mit Begründung in
  `lintian-overrides`: `/opt` ist laut FHS genau der richtige Ort für
  nachinstallierte Software, sharp bringt sein libvips selbst mit, die
  Handbuchseite gehört zur echten CLI aus M13, und der `/tmp`-Fund ist der
  String `${DATA_DIR}/tmp`.

**Real geprüft** (Paket gebaut, installiert und betrieben)

- Voller Lebenszyklus: `dpkg -i`, Konfiguration ändern, Upgrade auf `0.0.1`,
  `remove`, `purge`. Der geänderte `conffile` (`port = 9090`) überlebt das
  Upgrade, Secret und Nutzdaten ebenso; die Migration meldet beim zweiten Lauf
  „nothing to do“. `remove` lässt Konfiguration und Daten liegen, `purge` ohne
  Antwort ebenfalls die Daten, `purge` mit vorbelegtem
  `product-rating/purge-data boolean true` räumt Datenbank, Fotos, Logs und den
  Systemnutzer ab.
- Anwendung aus dem installierten Paket, als Dienstnutzer gestartet: Anmeldung
  (argon2), Produkt anlegen (better-sqlite3), Foto hochladen (sharp/libvips –
  1200×900 JPEG nach WebP), Bewertung, Auslieferung von Thumbnail und
  App-Shell, `/assets/` mit `immutable`, `fsck --uploads` ohne Befund. Damit
  ist belegt, dass der beschnittene und gestrippte Abhängigkeitsbaum trägt.
- Rechte nach dem Install: `secret.env` `0600`, `config.toml` `0640
  root:product-rating`, Datenverzeichnisse `0750`, `app.db` `0640`. Dass die
  Datenbank ohne die `umask 0027` im `postinst` als `0644` entstand, ist beim
  Testen aufgefallen und behoben.
- Beim Testen gefunden und behoben: `postrm` hatte `confmodule` innerhalb einer
  Funktion geladen. Das Laden startet das Skript über das debconf-Frontend neu
  – mit `"$@"`, das in einer Funktion aber deren Argumente sind. Das Skript lief
  danach ohne die Aktion von dpkg wieder an und brach mit „unknown argument“ ab.
  Jetzt wird auf oberster Ebene geladen.

**Offen** – arm64 fehlt mangels Maschine, und die Sandbox der Unit ist bisher
nur gelesen: in der Entwicklungsumgebung lief kein systemd, geprüft wurde der
Dienst als derselbe Systemnutzer mit demselben Aufruf, aber ohne die Härtung.
Beides steht als eigener Punkt in TODO.md (M11).

Am Rande: `/usr/share/doc/` sah nach dem Install leer aus – das lag an der
`path-exclude`-Regel des Testcontainers, nicht am Paket; `dpkg -c` zeigt die
Dateien.

---

## 2026-08-15 – M10: Docker

**Umfang**

- `server/src/plugins/staticFrontend.ts` plus der neue Schlüssel
  `server.static_dir`: der Server liefert die gebaute Oberfläche selbst aus
  (`@fastify/static`). Dateien unter `/assets/` tragen einen Inhalts-Hash und
  gehen mit `public, max-age=31536000, immutable` hinaus, alles andere –
  `index.html`, `sw.js`, Manifest, Icons – mit `no-cache`. Unbekannte Adressen
  beantwortet der Not-Found-Handler mit der App-Shell, aber nur bei `GET`/`HEAD`
  auf ein Dokument und nie unter `/api/` oder `/healthz`.
- `server/src/config/`: `static_dir` im Zod-Schema, in der Pfadauflösung (relativ
  zur Konfigurationsdatei) und in den Startprüfungen – gesetzt muss das
  Verzeichnis existieren und eine `index.html` enthalten, angelegt wird es
  bewusst nicht.
- `docker/Dockerfile`: zwei Stufen auf `node:22-bookworm-slim`. Bau-Stufe mit
  `npm ci`, `npm run build` und `npm prune --omit=dev`; Laufzeitstufe mit
  `node_modules`, Server-Bundle samt Migrationen, der Oberfläche unter
  `/app/web`, `USER node`, `EXPOSE 8080`, `VOLUME /data` und `HEALTHCHECK` auf
  `/healthz`.
- `docker/entrypoint.sh` nach den Skript-Konventionen (Header mit
  Programmablaufplan, `--help`, Silent/Verbose, alle Parameter zusätzlich als
  Umgebungsvariable): Verzeichnisse anlegen, Secret mit `0600` erzeugen,
  Migrationen anwenden, dann den Server per `exec` als PID 1 starten.
- `docker/config.container.toml` als mitgeliefertes
  `/etc/product-rating/config.toml`: `host = "0.0.0.0"`, Daten unter `/data`,
  `static_dir = "/app/web"`, Log nach stdout.
- `docker/docker-compose.yml` (Volume `product-rating-data`, Port nur auf
  `127.0.0.1`, `init`, `no-new-privileges`, Health-Check, Durchreichen von
  `PR_SERVER__BASE_URL` und `BOOTSTRAP_ADMIN_*`) sowie
  `docker/docker-compose.caddy.yml` mit `docker/Caddyfile.example` für Caddy als
  vorgelagerten TLS-Proxy.
- `.dockerignore`, README 2, 6.1, 6.2, 7.1 und 9 (Multi-Arch-Bau mit `buildx`,
  Container-Konfiguration, `PR_SERVER__STATIC_DIR` für den gebauten Stand ohne
  Container).
- 385 Tests grün (13 neue); `lint`, `typecheck` und `build` fehlerfrei.

**Real geprüft** (ohne Container – in der Entwicklungsumgebung lief kein
Docker-Daemon; geprüft wurde derselbe Laufzeitpfad, den das Image benutzt)

- `entrypoint.sh` gegen das gebaute Bundle: Verzeichnisse angelegt, Secret mit
  `-rw-------` erzeugt, Migration angewandt, Server gestartet. Zweiter Lauf
  behält Secret und Schema („nothing to do“), `SIGTERM` beendet sauber.
- Auslieferung: `/` und eine Client-Adresse liefern die App-Shell mit
  `no-cache`, `/assets/index-*.js` mit `immutable`, `sw.js` mit `no-cache`,
  `manifest.webmanifest` mit `application/manifest+json`, `/api/v1/nope` bleibt
  ein JSON-`not_found`, `/healthz` antwortet weiter selbst.
- `npm prune --omit=dev` samt entfernter Workspace-Links: Server startet,
  liefert aus, `fsck` läuft, `sharp`, `@node-rs/argon2` und `better-sqlite3`
  laden – der Schritt, auf dem die Laufzeitstufe des Images aufbaut, trägt also.

**Offen** – das Image selbst ist ungebaut und ungetestet; das steht als eigener
Punkt in TODO.md (M10), zusammen mit dem arm64-Bau und der Frage, ob die
Sourcemaps in der Laufzeitstufe bleiben.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Oberfläche im Container | Vom Server selbst ausgeliefert statt aus einem zweiten Container | README 2 sagt „API und Frontend in einem Prozess“ zu; eine Herkunft ist genau das, worauf Session-Cookie und Origin-Prüfung bauen, und der Proxy braucht nur eine Regel |
| Schalter dafür | Konfigurationsschlüssel `server.static_dir`, leer als Standard | Kein Pfad im Code, und die Entwicklung bleibt reine API, wo Vite die Oberfläche ausliefert |
| App-Shell-Fallback | Nur `GET`/`HEAD` mit `Accept: text/html`, nie unter `/api/` | Ein fehlendes Bild muss als `404` scheitern, und ein Client, der JSON erwartet, darf kein HTML mit `200` bekommen |
| Cache-Regeln | `/assets/` unbefristet, alles andere `no-cache` | Nur die Dateien mit Inhalts-Hash im Namen dürfen ewig liegen bleiben; bei `sw.js` und `index.html` hieße das, dass eine neue Version nie ankommt |
| Konfiguration im Image | Eigene Datei `config.container.toml` als `/etc/product-rating/config.toml`, nicht per Umgebungsvariablen im `Dockerfile` | Umgebungsvariablen schlagen die Konfigurationsdatei; wären die Container-Standards Variablen, könnte eine eingehängte eigene Datei sie nicht mehr übersteuern |
| Rechte im Container | `USER node` (uid 1000), keine Vorbereitung als root | Der Entrypoint braucht kein root: `/data` gehört im Image bereits `node`, und ein benanntes Volume erbt diese Rechte. Ein Bind-Mount muss auf dem Host übergeben werden – der Entrypoint sagt das im Fehlerfall dazu |
| Laufzeitabhängigkeiten | `npm prune --omit=dev` statt zweitem `npm install` | Die Lock-Datei bleibt die einzige Wahrheit, und die nativen Module sind schon für die Zielarchitektur gebaut |
| Init-Prozess | Kein `tini` im Image, `init: true` in der Compose-Datei | Der Server läuft dank `exec` als PID 1 und behandelt `SIGTERM` selbst; die Zombie-Ernte ist nur Rückversicherung und gehört in die Betriebsdatei |
| Logging des Entrypoints | stdout/stderr statt `logger` | Im Container gibt es keinen syslog-Dienst; was das Hauptprogramm schreibt, ist das Log, das `docker logs` und jeder Log-Treiber sehen |
| Secret im Container | Vom Entrypoint mit `node crypto` erzeugt, im Volume | Das Laufzeit-Image hat kein `openssl`, und im Volume überlebt das Secret jedes neue Image – sonst wären nach einem Update alle Sitzungen ungültig |

---

## 2026-08-15 – M9: PWA und iOS

**Umfang**

- `web/vite.config.ts`: `vite-plugin-pwa` (Workbox) mit Manifest und Service
  Worker. `registerType: 'prompt'`, `injectRegister: false` – registriert wird
  aus der Oberfläche, die den wartenden Worker ohnehin in der Hand braucht.
  Vorgehalten wird die App-Shell (`js`, `css`, `html`, `svg`, `png`,
  `webmanifest`; 14 Einträge, 484 kB), `navigateFallback` auf `index.html` mit
  `/api/` in der Sperrliste, `cleanupOutdatedCaches`, `clientsClaim`. Dazu ein
  `preview`-Block mit demselben API-Proxy wie der Dev-Server – der Service
  Worker existiert nur im Bau, also braucht es einen Weg, ihn auszuprobieren.
- `web/public/`: `icon.svg` (abgerundet) und `icon-maskable.svg` (randlos, Marke
  auf 85 % skaliert) als einzige handgepflegte Icons, dazu die daraus erzeugten
  `icon-192/512`, `icon-maskable-192/512` und `apple-touch-icon` (180).
- `web/scripts/generate-icons.ts` plus `npm run icons`: rastert die SVG-Quellen
  mit `sharp`. Die PNG liegen im Repository, damit ein Produktionsbau ohne das
  native Modul auskommt; das Skript läuft mit Node 22 direkt als TypeScript und
  steht bewusst außerhalb der `tsconfig.json` des Web-Workspaces.
- `web/index.html`: `apple-mobile-web-app-*`, `apple-touch-icon`, zwei
  `theme-color` mit `media`-Abfrage, `format-detection: telephone=no`.
- `web/src/components/UpdatePrompt.tsx`: Registrierung des Workers und die
  sichtbare Aufforderung „Neue Version verfügbar“. Fragt zusätzlich stündlich
  und bei jedem Wechsel in den Vordergrund nach einer neuen Version.
- `web/src/lib/online.ts` und `web/src/components/OfflineNotice.tsx`:
  `useOnlineStatus()` über `useSyncExternalStore`, dazu ein Streifen über der
  Navigation und ein ganzer Schirm für den Fall, dass nichts geladen werden
  konnte. `RequireAuth` benutzt Letzteren, wenn die Sitzungsabfrage scheitert
  *und* das Gerät sich als offline meldet.
- `web/src/styles/app.css`: `.toast-stack` über der Navigationsleiste, mit
  `env(safe-area-inset-*)` und ohne Tastenfang, solange nichts darin steht.
- Testseitig: `web/src/testing/pwaRegister.ts` als Ersatz für
  `virtual:pwa-register/react` (per Alias in `vitest.config.ts`, denn das Plugin
  gehört nicht in den Testlauf) und `web/src/testing/online.ts`, das
  `navigator.onLine` beantwortbar macht; beides räumt `setup.ts` selbst auf.
- 372 Tests grün (12 neue); `lint`, `typecheck`, `format:check` und `build`
  fehlerfrei.

**Real geprüft** (Chromium bei 390×844, gebauter Stand hinter `vite preview`
gegen die laufende API, hell und dunkel – 35 Prüfungen, alle bestanden)

- Manifest und iOS-Metatags am ausgelieferten Dokument, alle fünf Icon-Dateien
  mit `200` und richtigem Content-Type.
- Der Service Worker übernimmt schon beim ersten Besuch; im Cache liegen
  App-Shell, JS und CSS, **kein** `.wasm` und **keine** `/api/`-Antwort.
- Offline neu geladen: die App startet aus dem Cache und zeigt „Keine
  Verbindung“ statt der Fehlerseite des Browsers; „Erneut versuchen“ bringt sie
  zurück. Der Streifen erscheint und verschwindet mit der Verbindung.
- Der ganze Aktualisierungsweg mit zwei echten Bauständen: neue Version wird
  ohne Neuladen gemeldet, wartet dabei nachweislich (`registration.waiting`),
  „Später“ legt die Frage weg, beim nächsten Start ist sie wieder da, „Jetzt neu
  laden“ macht die neue Version aktiv – und die Anmeldung überlebt das.
- Scanner mit Kamera-Attrappe: das WebAssembly wird trotz Service Worker sauber
  aus dem Netz nachgeladen.

**Dabei gefundene Fehler**

| Fund | Ursache | Behebung |
|---|---|---|
| Kein Service Worker übernahm die Seite beim ersten Besuch | `registerType: 'prompt'` setzt weder `skipWaiting` noch `clientsClaim`; die erste Installation wartete damit bis zum nächsten Start der App | `clientsClaim: true` – das betrifft nur den ersten Worker, spätere warten weiterhin auf die Zustimmung |

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Aktualisierung | `prompt` statt `autoUpdate` | Ein Neuladen mitten im Anlegen eines Produkts wirft das Formular weg; die Übernahme ist eine Entscheidung des Nutzers |
| Suche nach neuen Versionen | Stündlich und bei jedem Wechsel in den Vordergrund | Eine App auf dem iOS-Home-Bildschirm wird nie wirklich geschlossen; ohne eigenes Nachfragen bliebe sie tagelang auf dem alten Bundle |
| Erste Installation | `clientsClaim`, aber kein `skipWaiting` | Offline-Fähigkeit ab dem ersten Besuch, ohne dass eine spätere Version ungefragt übernimmt |
| API im Cache | Gar keine `runtimeCaching`-Regel | Ein veraltetes `GET /auth/me` zeigt das falsche Konto; Fotos sind `Cache-Control: private`. Was sich lohnt, hält TanStack Query im Speicher |
| WebAssembly des Decoders | Nicht vorgehalten | Ein Megabyte für den Fall, dass jemand offline scannt – wobei die EAN offline ohnehin nicht nachgeschlagen werden kann |
| Offline-Hinweis | Eigene Ansicht statt einer statischen `offline.html` | Der Fallback lädt die echte App; eine zweite HTML-Datei wäre eine zweite Oberfläche mit eigenem Aussehen und eigener Sprache |
| `navigator.onLine` | Nur zum Erklären, nie zum Entscheiden | Der Wert sagt „es gibt ein Netz“, nicht „der Server ist erreichbar“; eine Anfrage zu unterdrücken wäre falsch, eine fehlgeschlagene zu deuten ist richtig |
| Statusleiste unter iOS | `default` statt `black-translucent` | `black-translucent` erzwingt weiße Symbole, die auf der hellen Kopfzeile verschwinden |
| Icons | Zwei SVG-Quellen, PNG erzeugt und eingecheckt | Eine Änderung an der Marke betrifft eine Datei; der Produktionsbau bleibt frei von `sharp` |
| Ort der Hinweise | In `AppLayout`, nicht um den Router herum | Beide brauchen den Platz über der Navigationsleiste; auf der Anmeldemaske meldet sich ein offenes Gerät ohnehin über die scheiternde Anfrage |

**Nicht erledigt**

Der Punkt „auf einem echten iPhone prüfen“ bleibt offen – dafür braucht es ein
Gerät, das hier niemand hat. Alles, was ohne iPhone prüfbar war, ist geprüft;
was iOS eigen ist (Hinzufügen zum Home-Bildschirm, Safe-Area am echten Notch,
Kamera-Upload aus der Standalone-App, Sitzung nach einem Neustart des Telefons),
steht weiter in TODO.md. Dazu gehört auch die aus M8 stammende Frage nach der
Kamerawahl unter Safari.

---

## 2026-08-15 – M8: Frontend-Funktionen

**Umfang**

- `server/`: `GET /api/v1/products/categories` liefert die im Katalog
  verwendeten Kategorien als Vorschlagsliste. Sortiert wird in der Anwendung
  statt in SQL – `SELECT DISTINCT` ordnet in SQLite nur nach Spalten des eigenen
  Ergebnisses, und `localeCompare` bekommt die Umlaute richtig. Dazu bekommt der
  abgelehnte Upload „kein lesbares Bild“ nun `details.field`, damit die Oberfläche
  ihn vom falschen Format und von der Größengrenze unterscheiden kann.
- `web/src/lib/scanner.ts`: Kamera und Decoder. `zxing-wasm` statt
  `BarcodeDetector`, das WebAssembly-Modul aus dem eigenen Bundle statt vom CDN,
  geladen per dynamischem Import erst beim Start der Kamera. Gelesen werden
  EAN-13, EAN-8 und UPC-A; jeder Treffer läuft zusätzlich durch `normaliseEan()`.
  Kamerawahl mit Vorzug für die Rückseite, Torch-Schalter, sechs unterschiedene
  Fehlerfälle, Rückmeldung per Vibration und kurzem Ton.
- `web/src/lib/image.ts`: Verkleinerung auf 2048 Pixel vor dem Upload, mit
  Rückfall auf das Original, wenn der Browser das Format nicht dekodieren kann.
- `web/src/lib/api.ts`: Upload über `XMLHttpRequest` mit Fortschritt und
  Abbruch – `fetch` kann den Fortschritt eines Requestbodys nicht melden.
  Fehlerbehandlung und deutsche Meldung bleiben identisch zum übrigen Client.
- `web/src/lib/queries.ts`: Hooks für Produkte (inklusive Cursor-Pagination über
  `useInfiniteQuery`), Bewertungen, Fotos, Sitzungen, Einladungen und Konten.
- `web/src/lib/format.ts`: Datum, Durchschnitt, relative Zeit und die
  Verdichtung des User-Agent zu „iPhone · Safari“.
- Neue Komponenten: `BarcodeScanner`, `ProductForm`, `ProductCard`,
  `PhotoManager`, `RatingEditor`, `StarRating`, `LoadMore`, dazu `EmptyState`
  und Ladeskelette in `Feedback`, `TextAreaField`/`SelectField` in `Field`.
- Neue Ansichten: `/products/new`, `/products/:id`, `/admin`; ausgebaut wurden
  Katalog, Scanner, eigene Bewertungen und Einstellungen. Die Platzhalter aus M7
  sind damit verschwunden.
- 360 Tests grün (69 neue); `lint`, `typecheck`, `format:check` und `build`
  fehlerfrei. Bundle 402 kB (gzip 120 kB) plus 38 kB Decoder-Chunk und 1,1 MB
  WebAssembly, die erst beim Scannen geladen werden.
- Zusätzlich real geprüft: API und Vite-Dev-Server, Chromium bei 390×844 in hell
  und dunkel, 32 Prüfungen – Anmeldung mit Rücksprung, Prüfziffer, unbekannte
  EAN → Formular, Anlage → Produktseite, Bewertung speichern und nach dem
  Neuladen wiederfinden, Foto auswählen, Vorschau, Upload mit Fortschritt,
  Auslieferung über `/api/v1/media/`, Katalogsuche über die Marke, leerer
  Filterzustand, Kategorievorschlag, eigene Bewertungen, Sitzungsliste,
  Einladung erzeugen und Link kopieren, Kamerastart mit Fake-Device, dunkles
  Thema. Darunter die Probe, die jsdom nicht leisten kann: ein im Browser
  gezeichneter echter EAN-13 wird vom mitgelieferten WebAssembly gelesen.

**Dabei gefundene Fehler**

| Fund | Ursache | Behebung |
|---|---|---|
| „Gespeichert.“ erschien nach dem Bewerten nie | Der `RatingEditor` hing am `updatedAt` der Bewertung; jedes Speichern erzeugte einen neuen Key und hängte die Komponente samt ihrer Erfolgsmeldung neu ein | Key auf die Produkt-ID – die Route bleibt beim Wechsel der ID montiert, dagegen muss er schützen, nicht gegen das Speichern |
| Sitzungen zeigten „Linux · Safari“ für einen Chrome | Jeder Chrome trägt `Safari/` im User-Agent; `HeadlessChrome/` und `Chromium/` passten nicht auf `\bChrome/` und fielen deshalb auf Safari durch | Wortgrenze vor `Chrome` entfernt |
| Foto-Kacheln waren ein paar Pixel hoch | `width`/`height` am `<img>` sind Präsentationsattribute und setzen die CSS-Höhe – sie schlagen `aspect-ratio` | Attribute entfernt; die Kachel ist ohnehin in CSS festgelegt |

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Decoder | `zxing-wasm`, Modul im eigenen Bundle | iOS Safari hat kein `BarcodeDetector`; ein CDN verbietet die Festlegung „kein ausgehender Netzverkehr im Betrieb“ |
| Ladezeitpunkt | Dynamischer Import beim Start der Kamera | Drei von vier Ansichten dekodieren nie; das gute Megabyte gehört nicht in den Start |
| Symbologien | EAN-13, EAN-8, UPC-A – kein UPC-E | UPC-E kommt als acht Ziffern an, die keine gültige EAN-8 sind; eine still falsch gespeicherte Nummer wäre schlimmer als ein nicht gelesener Code |
| Kamerastart | Nur auf Tastendruck | Kostet Akku und schaltet die Anzeigeleuchte ein; eine Ansicht, die das beim Betreten tut, wird gemieden |
| Eingabe von Hand | Gleichrangig auf demselben Schirm, nicht hinter einem Fehler | Es gibt Barcodes, die keine Kamera liest – zerknitterte Tüte, dunkler Keller, abgeschaltete Kamera |
| Suchbereich | Nur das mittlere Band des Bildes wird dekodiert | Entspricht dem Rahmen auf dem Schirm und ist ein Viertel der Arbeit je Versuch |
| Nach dem Scan | Eine Mutation statt einer Query | Der Scanner fragt genau einmal und will die Antwort in der Hand, um zu entscheiden, wohin er springt; `404` ist hier die normale Antwort |
| Sterne | Sechs echte Radios, verborgen hinter den Glyphen | Pfeiltasten, Tabstopp und Ansage kommen so vom Browser statt aus gepflegtem Code; 0 Sterne ist eine eigene Option, kein „nicht bewertet“ |
| Speichern der Bewertung | Erst auf Knopfdruck, nicht beim Tippen auf einen Stern | Ein Streifen über einen Stern beim Scrollen darf kein Urteil überschreiben |
| Verkleinern im Browser | Höflichkeit, keine Prüfung | Der Server kodiert ohnehin neu; scheitert die Dekodierung im Browser, geht das Original hoch – ein fehlgeschlagener Spareffekt darf nie das Foto kosten |
| Kategorien | Freitext mit `<datalist>` statt Auswahlliste | Ein Haushalt erfindet seine Kategorien selbst, soll aber nicht „Getränke“, „getraenke“ und „Getränk“ nebeneinander bekommen |
| Filterzustand | Zustand der Ansicht, nicht der Adresse | Niemand setzt ein Lesezeichen auf „Haferflocken, mindestens vier Sterne“; eine Adresse, die sich bei jedem Tastendruck ändert, füllt den Zurück-Knopf mit Suchbegriffen |
| Cache-Invalidierung | Grob: eine Bewertung verwirft alle Listen | Ein Durchschnitt ändert Sortierung und zwei Filter; die Buchführung für Genauigkeit kostet mehr als die gesparten Anfragen |
| Nachladen | Beobachter am Listenende **und** Schaltfläche | Scrollen ist eine Daumengeste; wer mit der Tastatur unterwegs ist, braucht etwas zum Drücken |
| Adminbereich | Aus den Einstellungen, nicht aus der Navigation | Wird benutzt, wenn jemand in den Haushalt kommt oder geht – ein paar Mal im Leben einer Installation |
| Einladung teilen | Link in die Zwischenablage, nicht der nackte Code | Der Link trägt den Code ins Formular; getippt wird er dann nirgends |

---

## 2026-08-15 – M7: Frontend-Grundgerüst

**Umfang**

- `web/src/lib/strings.ts`: sämtliche Oberflächentexte an einer Stelle, dazu
  `apiErrorText()` – die Übersetzung von Status, Fehlercode und `details` in
  einen deutschen Satz.
- `web/src/lib/api.ts`: typisierter Client für alle Routen von `/api/v1`
  (Auth, Sitzungen, Produkte, Bewertungen, Fotos, Einladungen, Konten),
  `ApiError` mit deutscher Meldung, `photos.url()` für `<img src>`.
- `web/src/lib/queries.ts`: Query-Client mit Cache-Zeiten und Wiederholungsregel,
  Schlüsselverzeichnis für alle Ressourcen, Hooks `useSession`, `useLogin`,
  `useRegister`, `useLogout`.
- `web/src/lib/forms.ts`: Zod-Issues zu einer deutschen Meldung je Feld.
- `web/src/components/`: `AppLayout` (Kopfzeile mit Konto und Abmelden),
  `BottomNav`, `RequireAuth`, `Field`, `Feedback` (Laden, Fehler, Platzhalter),
  `icons.tsx` (vier Inline-SVGs).
- `web/src/routes/`: `LoginPage`, `RegisterPage` sowie die Platzhalter
  `CataloguePage`, `ScanPage`, `RatingsPage`, `SettingsPage` und `NotFoundPage`.
- `web/src/styles/`: `theme.css` (Token-Satz hell und dunkel), `app.css`
  (Layout, Formulare, Navigation, Safe-Area).
- `vitest.config.ts` auf zwei Projekte umgestellt: `node` für `server/` und
  `shared/`, `web` mit jsdom, Testing Library und `web/src/testing/setup.ts`.
- Neue Abhängigkeiten: `react-router`, `@tanstack/react-query`; als
  Entwicklungsabhängigkeiten `jsdom`, `@testing-library/{react,dom,jest-dom,user-event}`.
  Damit ist auch der seit M0 offene Punkt „jsdom und Testing Library ergänzen“
  erledigt.
- 284 Tests grün (39 neue im Web-Projekt); `lint`, `typecheck`, `format:check`
  und `build` fehlerfrei (Bundle 350 kB, gzip 107 kB).
- Zusätzlich real geprüft: Vite-Dev-Server gegen die laufende API, Chromium bei
  390×844 in hell und dunkel, 19 Prüfungen – Weiterleitung von `/settings` zur
  Anmeldung und zurück, falsches Passwort, Rate-Limit-Text, Kopfzeile mit Konto,
  vier Navigationseinträge mit korrekt gesetztem `aria-current`, 44-px-Scan-Ziel,
  Sitzung übersteht das Neuladen, 404-Seite, Abmelden, Cookie-Flags
  (`HttpOnly`, `SameSite=Lax`), Einladungscode aus dem Link, Registrierung mit
  echtem Code sowie die Ablehnung eines verbrauchten Codes.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Styling | Eigenes CSS mit Custom Properties statt Tailwind | Eine Handvoll Ansichten rechtfertigt weder Build-Schritt noch Klassenvokabular; ein Token-Satz plus je ein Block für hell und dunkel hält jede Farbe an einer Stelle |
| Thema-Wechsel | Folgt der Systemeinstellung, kein Schalter in der App | Auf iOS gehört die Wahl zum Gerät; die PWA soll aussehen wie der Rest des Telefons |
| Routing | Deklarativ (`<Routes>`), keine Router-Loader | Die Daten kommen aus dem Query-Cache; Loader wären eine zweite Quelle für dieselbe Sache |
| Adressen | Englisch (`/scan`, `/ratings`, `/settings`) | Bezeichner sind laut Projektkonvention englisch, deutsch ist nur, was auf dem Bildschirm steht |
| Fehlerübersetzung | Nach Fehlercode und `details`, nie nach dem Text des Servers | Der Servertext ist englisch und für ein Log geschrieben; `details.field` sagt zusätzlich, an welchem Eingabefeld die Meldung steht |
| `401` | Wird zentral in die Sitzungsabfrage geschrieben | Eine abgelaufene Sitzung soll zur Anmeldemaske führen, nicht zu einem Schirm voller fehlschlagender Anfragen |
| `401` beim Login | Wird auf der Anmeldemaske eigens übersetzt | Dort heißt der Status „Passwort falsch“ und nicht „Sitzung abgelaufen“ – nur diese eine Ansicht kann beides unterscheiden |
| Sitzungsabfrage | `401` ergibt `null` statt eines Fehlers | „Niemand angemeldet“ ist eine normale Antwort; so verzweigen die Ansichten über Daten und nicht über Fehlerobjekte |
| Nicht erreichbarer Server | Führt zu Hinweis mit Wiederholung, nicht zur Anmeldemaske | Unerreichbar ist nicht abgemeldet; sonst verlöre man die Sitzung bei jedem Netzwerkaussetzer |
| Wiederholungen | Kein Retry bei 4xx, bis zu zwei bei Netzwerk- und 5xx-Fehlern | Eine abgelehnte Eingabe bleibt abgelehnt, eine abgerissene Verbindung kann sich erholen |
| Abmelden | Räumt die Sitzung lokal auch dann ab, wenn die Anfrage scheitert | Das Cookie kann bereits weg sein; jemanden vor einer Sitzung stehen zu lassen, die er loswerden wollte, wäre der schlechtere Ausgang |
| Abmelden-Ort | In der Kopfzeile statt nur auf der Einstellungsseite | Muss von überall gehen; bis M8 hätte es sonst gar keinen Platz |
| Platzhalterseiten | Alle Navigationsziele existieren schon als Ansicht | Eine Navigationsleiste mit toten Einträgen wäre schlechter als eine mit ehrlichen Platzhaltern |
| Einladungscode | Auch über `?invite=…` vorbelegbar | Macht eine Einladung als Link teilbar, statt sie abtippen zu lassen |
| Formularprüfung | Mit denselben Zod-Schemata wie auf dem Server, Meldungen aber aus `strings.ts` | Spart eine Runde zum Server; die englischen Zod-Texte sind für Entwickler geschrieben. Die Mindestlänge des Passworts steht in der Serverkonfiguration und kann nur dort geprüft werden |
| Tests der Oberfläche | Nur `fetch` wird ersetzt, Client und Query-Cache laufen echt | So deckt ein Test auch Envelope, Fehlerübersetzung und Cache-Voreinstellungen ab statt nur die Komponente |

---

## 2026-08-15 – M6: Fotos

**Umfang**

- `shared/src/schemas/photo.ts`: `PHOTO_FIELD` (Name des Multipart-Feldes),
  `PHOTO_SIZES`/`photoSizeSchema` und `mediaQuerySchema`. Neuer Typ
  `ProductDetail` in `shared/src/types.ts`.
- `server/src/services/photos.ts`: Verarbeitung mit `sharp`, Speicherlayout,
  atomares Schreiben, Ablage- und Löschlogik, Hauptbild und die
  Konsistenzprüfung `checkUploads()`.
- `server/src/routes/photos.ts`: `POST /products/:id/photos`,
  `DELETE /photos/:id`, `PUT /photos/:id/primary` und
  `GET /media/:id?size=thumb|full` inklusive `ETag`, `304`, `Range`/`206` und
  `416`.
- `server/src/app.ts`: `@fastify/multipart` mit `limits` aus der Konfiguration
  (eine Datei, `max_file_size_mb`), Registrierung der Fotorouten.
- `server/src/routes/products.ts`: Einzelabfragen liefern zusätzlich `photos`;
  das Löschen eines Produkts entfernt jetzt auch die Bilddateien.
- `server/src/fsck.ts` plus `npm run fsck`: `--uploads`, `--repair`, `--help`,
  Exit-Code 1 bei Befunden. Der richtige CLI-Rahmen folgt in M13.
- `server/src/testing/harness.ts`: Uploads und Temp liegen im Wegwerf-Verzeichnis
  der Testdatenbank.
- Neue Abhängigkeiten: `sharp` (0.35.x – 0.34.x hat eine offene
  libvips-Meldung) und `@fastify/multipart`.
- Keine Schemaänderung, also keine neue Migration – `photos` steht seit M2.
- 247 Tests grün (38 neue); `lint`, `typecheck`, `format:check` und `build`
  fehlerfrei. Zusätzlich real gegen eine laufende Instanz geprüft: Upload eines
  2400×1600-JPEG mit EXIF/GPS und Orientierung 6, als `image/heic` und
  `IMG_4711.HEIC` deklariert – gespeichert als WebP 1067×1600 ohne EXIF,
  Thumbnail 267×400; `ETag`/`304`, `Range` mit `206` und `416`, anonym `401`;
  abgelehnt wurden 3 MB bei Limit 2 MB, eine PHP-Datei mit `image/png`-Etikett
  und ein GIF; fremder Origin `403`; Hauptbildwechsel; Löschen von Foto und
  Produkt räumt Dateien und Verzeichnisse ab; `fsck` mit und ohne `--repair`.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Ausgabeformat | Immer WebP, das Original wird nicht aufbewahrt | Ein Format hält Speicherlayout und Cache-Header einfach; WebP versteht auch Safari auf iOS, HEIC dagegen kein Browser. Das Original aufzuheben würde Platz kosten und die EXIF-Daten wieder ins Haus holen |
| Typprüfung | Gegen das von `sharp` erkannte Format, nicht gegen die Angabe des Clients | Dateiname und MIME-Typ sind frei wählbar; geprüft wird, was in den Bytes steht |
| `failOn` | `'error'` statt der strengeren Voreinstellung | Fotos echter Telefone lösen regelmäßig Warnungen aus; ein abgelehntes gültiges Foto wäre der teurere Fehler |
| Speicherlayout | `<2 Zeichen der Produkt-ID>/<produkt-id>/<foto-id>.webp`, Thumbnail als `<foto-id>.thumb.webp` | Der Präfix verteilt einen sechsstelligen Katalog auf 256 Verzeichnisse; alles zu einem Produkt liegt beisammen und ist in einem Schritt entfernt |
| `photos.filename` | Enthält den relativen Pfad des Detailbilds, das Thumbnail wird daraus abgeleitet | Eine Spalte, eine Wahrheit; die Ableitungsregel steht an einer Stelle im Code |
| Atomares Schreiben | Über `paths.temp` plus `rename`, bei `EXDEV` Fallback auf Kopieren | `paths.temp` darf auf einem anderen Dateisystem liegen; ohne Fallback wäre jeder Upload dort ein Fehlschlag |
| Reihenfolge beim Anlegen | Erst die Dateien, dann die Zeile; scheitert das Einfügen, werden die Dateien zurückgenommen | Eine Datei ohne Zeile ist Müll, den `fsck` findet – eine Zeile ohne Datei wäre ein kaputtes Bild in der App |
| Reihenfolge beim Löschen | Erst die Zeile, dann die Dateien | Umgekehrt wäre bei einer scheiternden Transaktion das Bild weg und der Datensatz da |
| Hauptbild | Eigenschaft des Produkts, nicht des Kontos; das erste Foto wird es automatisch | Die Kachel zeigt genau ein Bild. Beim Löschen rückt das älteste verbliebene nach, statt einen Nachfolger zu markieren – die Produktabfrage tut das ohnehin schon |
| Eigentum | Löschen und Hauptbildwechsel nur für Eigentümer und Administratoren, Hochladen für jedes Konto | Der Katalog ist gemeinsam, das Foto nicht |
| Medienzugriff | Jedes angemeldete Konto darf jedes Bild lesen | Der Katalog ist gemeinsam; eine Produktkachel ohne Bild wäre sinnlos. Geschützt ist der Weg dorthin, nicht das einzelne Bild |
| Caching | `ETag` ist die Foto-ID plus Größe, `max-age` ein Jahr, `immutable`, `private` | Der Inhalt hinter einer ID ändert sich nie – ein neues Foto ist eine neue ID. `private`, weil es eine Sitzung gebraucht hat |
| `Range` | Nur ein einzelner `bytes=`-Bereich, mehrere werden als ganze Datei beantwortet | Erlaubt nach RFC 9110 und für Bilder völlig ausreichend; `multipart/byteranges` wäre Aufwand ohne Nutzen |
| `ProductDetail.photos` | Fotoliste nur in der Einzelabfrage, die Liste behält `primaryPhotoId` | Ohne Liste wären weitere Fotos weder zu löschen noch zum Hauptbild zu machen; in der Katalogliste wäre sie eine Abfrage je Produkt für ein Bild, das niemand sieht |
| `fsck` | Meldet in beide Richtungen, löscht nur mit `--repair` | Eine verwaiste Datei kostet Platz, eine zu Unrecht gelöschte ein Foto. Fehlende Dateien bleiben auch nach einem Repair ein Befund – dagegen hilft nur ein Backup |
| `sharp`-Version | 0.35.x statt 0.34.x | Für 0.34.x ist eine libvips-Meldung offen (`npm audit`, hoch) |

**Offen**

- Ein Rate-Limit für Uploads fehlt; README nennt es unter „Härtung“, umgesetzt
  ist bisher nur das Login-Limit. Als Punkt in M6 vermerkt.
- Mehrere Fotos je Produkt sind technisch möglich (das Datenmodell kann es, die
  Routen auch), die Oberfläche in M8 zeigt zunächst nur das Hauptbild. Sortierung
  mehrerer Fotos bleibt im Backlog.
- Docker und Debian-Paket brauchen `sharp` je Architektur – als bekannter
  Fallstrick in CLAUDE.md vermerkt, umzusetzen in M10/M11.

---

## 2026-08-15 – M5: Bewertungen

**Umfang**

- `shared/src/schemas/rating.ts`: `upsertRatingSchema` (ganze Zahl 0–5,
  optionaler Kommentar bis 1000 Zeichen) und `myRatingsQuerySchema` mit
  Sortierung, Seitengröße und Cursor. Neue Typen `RatedProduct` und
  `RatingListPage` in `shared/src/types.ts`.
- `shared/src/rating.ts`: `roundAverageStars()` und `toRatingSummary()`, damit
  Produkt- und Bewertungsdienst denselben gerundeten Durchschnitt ausgeben.
- `shared/src/schemas/sort.ts`: `SORT_ORDERS` als eine Quelle für die
  Sortierrichtung; `PRODUCT_SORT_ORDERS` verweist darauf.
- `server/src/services/pagination.ts`: Keyset-Pagination aus M4 herausgelöst –
  Cursor kodieren, dekodieren, Vergleichsbedingung, Standardrichtung. Produkt-
  und Bewertungsliste teilen sich jetzt eine Implementierung.
- `server/src/services/ratings.ts`: Upsert, Löschen, Zusammenfassung je Produkt
  und die Liste der eigenen Bewertungen.
- `server/src/routes/ratings.ts`: die drei Routen aus dem Meilenstein, alle
  hinter `requireUser`.
- `server/src/db/testing.ts`: `SeedRating` nimmt Zeitstempel entgegen, damit
  Sortier- und Seitentests nicht von der Ausführungsgeschwindigkeit abhängen.
- Keine Schemaänderung, also keine neue Migration – `ratings` steht seit M2
  inklusive `UNIQUE (product_id, user_id)` und `CHECK (stars between 0 and 5)`.
- 209 Tests grün (22 neue); `lint`, `typecheck`, `format:check` fehlerfrei.
  Zusätzlich real gegen eine laufende Instanz geprüft: Anlegen mit `201`,
  Ersetzen mit `200` bei gleichbleibendem `created_at`, geleerter Kommentar,
  abgelehnte Werte 6 und 2,5, unbekanntes Produkt, fremder Origin, zweites
  Konto über Einladung, Durchschnitt 2,5 aus 0 und 5 Sternen, Löschen der
  eigenen Bewertung ohne Wirkung auf die fremde, zweites Löschen mit `404`,
  `ratings/mine` und ein Cursor aus anderer Sortierung.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| Adressierung | `PUT/DELETE /products/:id/rating` statt einer eigenen Bewertungs-ID | Die Bewertung ist durch Produkt und Konto eindeutig; eine fremde Bewertung lässt sich so gar nicht ansprechen, statt sie nachträglich abzuweisen |
| Upsert | Ein `insert … on conflict do update`, danach Rücklesen | Zwei Geräte, die gleichzeitig speichern, würden sonst am eindeutigen Index scheitern; gelesen wird zurück, weil auf dem Konfliktweg ID und `created_at` der vorhandenen Zeile gelten |
| Statuscode | `201` beim ersten Urteil, `200` beim Ersetzen | Ein `PUT` ist wiederholbar; der Unterschied sagt der Oberfläche, ob eine Bewertung neu entstanden ist |
| Kommentar | `PUT` ersetzt die Bewertung ganz, ein fehlender Kommentar löscht den alten | Sonst wäre dieselbe Anfrage nicht wiederholbar und ein Kommentar nie zu entfernen |
| Null Sterne | Gültiger Wert, „nicht bewertet“ ist das Fehlen der Zeile | Null ist ein Urteil; das war schon im Datenmodell so festgelegt |
| Antwort beim Schreiben | Zusätzlich Durchschnitt und Anzahl des Produkts | Die Detailseite aktualisiert die Zusammenfassung ohne zweite Anfrage |
| Aggregation | Korrelierte Unterabfragen bleiben, kein `GROUP BY`-Join | Sie laufen über `ratings_product_user_unique` (führende Spalte `product_id`); ein gruppierter Join müsste die ganze Tabelle zusammenzählen, auch beim Nachschlagen eines einzelnen Produkts nach dem Scan |
| Eigene Liste | Eigene Route statt nur `products?ratedByMe=true` | Nur hier lässt sich nach eigener Sternzahl und Bewertungsdatum sortieren; die Einträge behalten die Produktform, damit die Oberfläche dieselbe Kachel verwenden kann |
| `total` der eigenen Liste | Direkt aus `ratings` gezählt | Die Liste kennt keine Filter, der Zähler nutzt `ratings_user_id_idx` |
| Pagination | Gemeinsames Modul für Katalog und Bewertungen | Zwei Kopien derselben Cursor-Logik wären zwei Stellen, an denen ein Sortierwechsel unbemerkt Zeilen überspringt |

**Offen**

- Die API zeigt weiterhin nur Durchschnitt, Anzahl und die eigene Bewertung.
  Wer im Haushalt was vergeben hat, ist bewusst nicht sichtbar; als
  Backlog-Punkt vermerkt.
- Für „Meine Bewertungen“ fehlt die Oberfläche; als Punkt in M8 vermerkt.

---

## 2026-08-14 – M4: Produkt-API

**Umfang**

- `shared/src/ean.ts`: Prüfziffernrechnung und Normalisierung. Akzeptiert
  werden EAN-13, EAN-8 und UPC-A; gespeichert wird immer die auf dreizehn
  Stellen aufgefüllte Form.
- `shared/src/schemas/product.ts`: `eanSchema` (validiert und normalisiert in
  einem Schritt), `createProductSchema`, `updateProductSchema` und
  `productListQuerySchema` inklusive Typkonvertierung für Query-Parameter.
  Neuer Typ `ProductListPage` in `shared/src/types.ts`.
- `server/src/services/products.ts`: Anlegen mit Duplikatserkennung, Lesen aus
  Sicht des Aufrufers (eigene Bewertung, Durchschnitt, Anzahl, Primärfoto),
  Liste mit Suche, Filtern, Sortierung und Cursor-Pagination, Ändern und
  Löschen.
- `server/src/routes/products.ts`: die sechs Routen aus dem Meilenstein, alle
  hinter `requireUser`, `DELETE` hinter `requireAdmin`.
- `server/src/db/client.ts`: SQL-Funktion `pr_lower()` für die Suche.
  `NotFoundError` nimmt jetzt wie die übrigen Dienstfehler `details` entgegen.
- Keine Schemaänderung, also keine neue Migration – die Tabellen stehen seit M2.
- 187 Tests grün (45 neue); `lint`, `typecheck`, `format:check` fehlerfrei.
  Zusätzlich real gegen eine laufende Instanz geprüft: Anlegen als UPC-A,
  Ablehnen desselben Artikels in der EAN-13-Schreibweise mit `409` und
  Produkt-ID, abgewiesene Prüfziffer, Nachschlagen über beide Schreibweisen,
  Suche nach „kölln“ auf „Kölln“, zwei Seiten über den Cursor, Cursor mit
  gewechselter Sortierung abgelehnt, EAN-Präfixsuche, `PATCH` und `DELETE`.

**Getroffene Entscheidungen**

| Thema | Entscheidung | Begründung |
|---|---|---|
| EAN-Form | Alles wird auf dreizehn Stellen aufgefüllt gespeichert | EAN-8, UPC-A und EAN-13 sind dieselbe GTIN; die Prüfziffer wird von rechts berechnet und übersteht das Auffüllen, `products.ean UNIQUE` bleibt damit aussagekräftig |
| Belegte EAN | `409` mit `details.productId` statt einer nackten Fehlermeldung | Nach dem Scan will die Oberfläche zum vorhandenen Produkt springen, nicht eine Fehlermeldung zeigen |
| Volltextsuche | `LIKE` über Name und Marke, keine FTS5-Tabelle | Bei sechsstelligen Produktzahlen und wenigen Nutzern reicht der Durchlauf; FTS5 kostet Tabelle, Trigger und kann Teilwörter nicht ohne Weiteres |
| Groß-/Kleinschreibung | Eigene SQL-Funktion `pr_lower()` mit `String.toLowerCase()` | SQLites `lower()` faltet nur ASCII – „Müller“ wäre sonst nicht über „müller“ zu finden |
| EAN in der Suche | Ziffernfolgen ab vier Stellen als Präfix, nicht als Teilzeichenkette | Ein Präfix nutzt den Index auf `ean`, eine Teilzeichenkette würde die Tabelle durchlaufen |
| Pagination | Keyset über (Sortierwert, ID) statt `OFFSET` | Ein währenddessen angelegtes Produkt verschiebt sonst die folgenden Seiten; die ID bricht Gleichstände auf |
| Cursor | Trägt die Sortierung mit sich; ein Wechsel ergibt `400` | Ein weitergereichter Cursor aus einer anderen Sortierung würde Produkte überspringen oder doppeln |
| Unbewertete Produkte | Zählen als `-1` beim Sortieren und erreichen kein `minStars` | Sonst stünden sie beim Sortieren nach Bewertung vor den schlecht bewerteten |
| Ändern | Jedes Konto darf jedes Produkt ändern | Der Katalog ist ausdrücklich gemeinsam; Eigentum gilt für Bewertungen und Fotos |
| Löschen | Nur Administratoren | Es nimmt fremde Bewertungen und Fotos mit |
| Durchschnitt | Auf zwei Nachkommastellen gerundet ausgegeben | Mehr Stellen sagen bei fünf Sternen nichts aus; der Cursor rechnet intern weiter mit dem vollen Wert |

**Offen**

- `deleteProduct()` gibt die betroffenen Fotozeilen zurück, löscht aber keine
  Dateien – das Speicherlayout entsteht erst in M6, wo der Punkt vermerkt ist.
- Die Aggregation je Produkt läuft über korrelierte Unterabfragen. Das ist bei
  der angepeilten Größe unauffällig; falls die Liste später spürbar langsam
  wird, ist eine Materialisierung der Durchschnitte der nächste Schritt.
- Die Kategorievorschläge des Produktformulars brauchen noch eine eigene Route;
  als Punkt in M8 vermerkt.

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
