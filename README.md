# Spektrum.de – Leseransicht

Ein Userscript für einen ruhigen Wissenschaftsüberblick: Nachrichten, Datum, Vorspann und Bilder. Ohne laufende KI, API-Schlüssel, Backend oder zusätzliche Paketabhängigkeiten.

## Installieren und aktualisieren

[Userscript installieren oder aktualisieren](https://raw.githubusercontent.com/ThisIsBert/Test_LAnsicht/main/spektrum-leseransicht.user.js), die Aktualisierung im Userscript-Manager (zum Beispiel Tampermonkey oder Violentmonkey) bestätigen und `https://www.spektrum.de/` neu laden. Die aktive Version **0.5.0** steht im Kopf- und Fußbereich. Im Manager sollte nur eine Kopie aktiviert sein. Download- und Update-Adressen für spätere Aktualisierungen sind hinterlegt.

Das Script verändert die Darstellung der Startseite. Artikel öffnen sich weiterhin auf Spektrum.de; Zugangs- und Abobedingungen gelten wie gewohnt. **Originalseite** oder Escape zeigen die ursprüngliche Seite wieder an.

## Was angezeigt wird

Die Inhalte kommen ausschließlich aus dem [offiziellen Spektrum-RSS-Feed](https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406). Die frühere Extraktion aus Startseitenblöcken ist entfernt.

- Standard: **Nachrichten der letzten drei Tage** (72 Stunden), neueste zuerst. Die jüngste Nachricht ist der Aufmacher, auch wenn sie kein Bild hat. Bildgröße und ursprüngliche Teaserposition beeinflussen die Reihenfolge nicht.
- **Alle Formate**, Kolumnen, Podcasts und weitere im Feed enthaltene Formate lassen sich getrennt auswählen. Bei null Nachrichten bleibt die Auswahl leer; das Script wechselt nicht automatisch zu anderen Formaten.
- **Zeitraum** bietet drei Tage, sieben Tage oder alle vorhandenen Feed-Beiträge. Fehlende, ungültige oder zukünftige Datumsangaben werden nicht als aktuell behandelt. Beiträge ohne verwertbares Veröffentlichungsdatum sind nur bei „Alle Feed-Beiträge“ sichtbar und als „Datum unbekannt“ gekennzeichnet.
- Jeder Beitrag zeigt das Veröffentlichungsdatum aus dem Feed in der Zeitzone des Browsers. Das Datum ist eine Angabe des Verlags, keine unabhängig verifizierte Datierung.
- **Magazin** zeigt den neuesten Beitrag als Aufmacher, die nächsten drei als Karten und den Rest als Überblick. **Kompakt** zeigt dieselbe chronologische Auswahl als Textliste. Die Layoutwahl wird lokal gespeichert, sofern erlaubt.
- Im Überblick stehen zunächst maximal zwölf Zeilen. Weitere lassen sich aufklappen.
- **↻** ruft den Feed neu ab und erhält Format-, Zeitraum- und Layoutwahl. Während des Abrufs wird der Knopf deaktiviert. Der Abruf bricht nach zwölf Sekunden ab.

Werbung, Shop, Newsletter-Promos, „Meistgelesen“ und „Das Beste von Spektrum.de“ werden nicht aus der Startseite übernommen. Im Feed ausdrücklich als Anzeige, Werbung, Sponsored oder Partnerinhalt gekennzeichnete Beiträge werden ausgeschlossen. Übersetzte wissenschaftliche Beiträge werden nicht pauschal ausgeschlossen; maßgeblich sind ihre Artikelart und ihr Feed-Datum.

## Grenzen und Fehlerfälle

Der Feed lieferte bei der Entwicklung 20 Einträge. Er ist kein vollständiges Archiv: Ein längerer Zeitraum lädt keine älteren Artikel nach. Es werden weder Artikelseiten einzeln abgerufen noch eine KI-Bewertung oder persönliche Relevanzsortierung vorgenommen.

Der Feed wird vom gleichen Ursprung wie die geöffnete Spektrum-Seite geladen. Es sind keine zusätzlichen Userscript-Berechtigungen erforderlich. Bei einem fehlgeschlagenen Abruf erscheint eine Fehlermeldung mit Wiederholungsmöglichkeit; bereits geladene Beiträge bleiben bei einem Aktualisierungsfehler erhalten. Das Script mischt dann keine undatierten Inhalte aus dem Startseiten-DOM hinzu. Bilder, die nicht laden, weichen einer Textdarstellung.

Das Script blendet die ursprünglichen Seitenelemente aus. Es ist kein Netzwerk-Werbeblocker: Im Hintergrund gestartete Skripte der Originalseite können weiterhin ausgeführt werden. Abonnements und Bezahlschranken werden nicht umgangen.

## Entwickeln und prüfen

Kein Build erforderlich. Syntaxprüfung:

```sh
node --check spektrum-leseransicht.user.js
```

Die Browser-Regressionstests benötigen Python 3, das Python-Paket `playwright` und Chromium unter `/usr/bin/chromium`. In der vorbereiteten Cloud-Umgebung sind diese vorhanden. Aus dem Repository-Verzeichnis ausführen:

```sh
python3 -m unittest discover -s tests -v
```

Die Tests führen den tatsächlichen RSS-Abrufcode im Browser mit kontrollierten Antworten aus. Sie prüfen zeitliche Sortierung, Format- und Zeitraumfilter, Duplikate, HTML-Bereinigung, Lade- und Fehlerzustände, Aktualisierung, Tastaturbedienung, Layoutwahl und mobile Darstellung. Sie benötigen keinen Netzwerkzugriff.
