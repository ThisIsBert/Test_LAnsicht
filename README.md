# Spektrum.de – Leseransicht

Ein Userscript für einen ruhigen Wissenschaftsüberblick: Nachrichten, Datum, Vorspann und Bilder. Ohne laufende KI, API-Schlüssel, Backend oder zusätzliche Paketabhängigkeiten.

## Installieren und aktualisieren

[Userscript installieren oder aktualisieren](https://raw.githubusercontent.com/ThisIsBert/Test_LAnsicht/main/spektrum-leseransicht.user.js), die Aktualisierung im Userscript-Manager (zum Beispiel Tampermonkey oder Violentmonkey) bestätigen und `https://www.spektrum.de/` neu laden. Die aktive Version **0.6.0** steht im Kopf- und Fußbereich. Im Manager sollte nur eine Kopie aktiviert sein. Download- und Update-Adressen für spätere Aktualisierungen sind hinterlegt.

Das Script verändert die Darstellung der Startseite. Artikel öffnen sich weiterhin auf Spektrum.de; Zugangs- und Abobedingungen gelten wie gewohnt. **Originalseite** oder Escape zeigen die ursprüngliche Seite wieder an.

## Was angezeigt wird

Die geladene Startseite liefert die redaktionellen Beiträge, Bilder und Vorspänne. Der [offizielle Spektrum-RSS-Feed](https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406) ergänzt insbesondere Veröffentlichungsdaten und neue Beiträge. Beide Quellen werden anhand der Artikel-ID zusammengeführt, auch bei abweichenden URL-Slugs oder Tracking-Parametern. Ein Artikel erscheint einmal. Zusätzliche Kolumnen auf der Startseite bleiben erhalten, wenn sie im begrenzten Feed fehlen.

- Standard: **Nachrichten**, mit datierten Beiträgen der letzten drei Tage (72 Stunden), neueste zuerst. Die jüngste datierte Nachricht ist der Aufmacher, auch wenn sie kein Bild hat. Bildgröße und ursprüngliche Teaserposition beeinflussen die Reihenfolge nicht.
- Beiträge ohne verlässliches Datum erscheinen zusätzlich und getrennt als **Weitere Beiträge der Startseite** beziehungsweise **Beiträge ohne Datum**. Sie bleiben unabhängig vom gewählten Zeitraum sichtbar. Ihre Reihenfolge entspricht der Quelle; sie werden nicht als neu ausgegeben und nicht zum datierten Aufmacher gemacht.
- **Alle Formate**, Kolumnen, Podcasts und weitere enthaltene Formate lassen sich getrennt auswählen. Bei null Nachrichten bleibt die Auswahl leer; das Script wechselt nicht automatisch zu anderen Formaten.
- **Zeitraum** bietet drei Tage, sieben Tage oder alle datierten Beiträge. Fehlende, ungültige oder zukünftige Datumsangaben werden nicht als aktuell behandelt.
- Das Veröffentlichungsdatum stammt aus dem RSS-Feed oder einer ausdrücklichen Datumsangabe im jeweiligen Webseiten-Teaser. Es wird in der Zeitzone des Browsers angezeigt. Das Datum ist eine Angabe des Verlags, keine unabhängig verifizierte Datierung. Position, Artikel-ID oder Fehlen im Feed werden nicht zur Altersbestimmung verwendet.
- **Magazin** zeigt den neuesten datierten Beitrag als Aufmacher, die nächsten drei als Karten und den Rest als Überblick. **Kompakt** zeigt die datierten Beiträge chronologisch als Textliste. Undatierte Beiträge folgen in beiden Ansichten separat. Die Layoutwahl wird lokal gespeichert, sofern erlaubt.
- Im datierten und im undatierten Überblick stehen zunächst jeweils maximal zwölf Zeilen. Weitere lassen sich unabhängig aufklappen.
- **↻** liest die bereits geladene Startseite erneut ein, ruft den Feed neu ab und erhält Format-, Zeitraum- und Layoutwahl. Es wird keine weitere HTML-Startseite abgerufen. Während des Feed-Abrufs wird der Knopf deaktiviert. Der Abruf bricht nach zwölf Sekunden ab.

Werbung, Shop, Newsletter-Promos, „Meistgelesen“ und „Das Beste von Spektrum.de“ werden nicht aus der Startseite übernommen. Im Feed ausdrücklich als Anzeige, Werbung, Sponsored oder Partnerinhalt gekennzeichnete Beiträge werden ausgeschlossen. Übersetzte wissenschaftliche Beiträge werden nicht pauschal ausgeschlossen; maßgeblich sind ihre Artikelart und ihr Feed-Datum.

## Grenzen und Fehlerfälle

Der Feed lieferte bei der Entwicklung 20 Einträge. Zusammen mit der Startseite entsteht eine breitere Auswahl, aber kein vollständiges Archiv: Ein längerer Zeitraum lädt keine älteren Artikel nach. Es werden weder Artikelseiten einzeln abgerufen noch eine KI-Bewertung oder persönliche Relevanzsortierung vorgenommen. Ob ein undatierter Artikel tatsächlich neu oder alt ist, bleibt offen.

Der Feed wird vom gleichen Ursprung wie die geöffnete Spektrum-Seite geladen. Es sind keine zusätzlichen Userscript-Berechtigungen erforderlich. Bei einem fehlgeschlagenen Abruf zeigt die Statuszeile den Fehler. Die Webseitenbeiträge bleiben verfügbar; zuvor geladene Feed-Daten bleiben bei einem Aktualisierungsfehler erhalten. Fehlende Datumsangaben werden nicht ergänzt oder erraten. Bilder, die nicht laden, weichen einer Textdarstellung.

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

Die Tests führen den tatsächlichen Seiten- und RSS-Code im Browser mit kontrollierten Antworten aus. Sie prüfen insbesondere acht Webseitenkolumnen bei nur einer RSS-Kolumne, Zusammenführung trotz unterschiedlicher Slugs, Ausschluss von Sammel- und Werbeblöcken, Umgang mit fehlenden Daten, zeitliche Sortierung, Filter, Lade- und Fehlerzustände, Aktualisierung, Tastaturbedienung und mobile Darstellung. Sie benötigen keinen Netzwerkzugriff.
