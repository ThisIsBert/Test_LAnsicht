# Spektrum.de – Leseransicht

Ein Userscript für eine ruhige Spektrum-Startseite: redaktionelle Beiträge, klare Typografie und möglichst wenig Ablenkung.

## Verwenden

Die Datei `spektrum-leseransicht.user.js` in einem Userscript-Manager wie Tampermonkey oder Violentmonkey installieren und `https://www.spektrum.de/` öffnen. Das Script verändert nur die Startseite. Artikel öffnen sich wie gewohnt auf Spektrum.de; bestehende Zugangs- und Abobedingungen gelten weiter.

- **Magazin** zeigt einen Aufmacher, bis zu drei Bildkarten und einen kurzen Überblick.
- **Kompakt** zeigt dieselben Beiträge als reine Textliste in der Reihenfolge der ursprünglichen Startseite. Die Wahl wird lokal im Browser gespeichert, sofern erlaubt.
- Rubrikfilter grenzen die Auswahl ein. Zunächst erscheinen maximal zwölf Überblickszeilen; weitere lassen sich aufklappen.
- **Originalseite** oder die Escape-Taste kehren zur ursprünglichen Seite zurück. **↻** liest die bereits geladene Seite erneut ein; es lädt keine neuen Nachrichten vom Server.

„Meistgelesen“, „Das Beste von Spektrum.de“, Shop- und Werbeblöcke werden nicht übernommen. Ein Artikel, der zugleich im normalen redaktionellen Bereich erscheint, bleibt dort erhalten. Die Auswahl und Reihenfolge stammen von der geladenen Seite; das Script ermittelt keine Veröffentlichungsdaten und behauptet keine chronologische Sortierung.

## Entwickeln und prüfen

Kein Build und keine Laufzeit-Paketabhängigkeiten. Syntax prüfen:

```sh
node --check spektrum-leseransicht.user.js
```

Die Browser-Regressionstests benötigen Python 3, das Python-Paket `playwright` und Chromium unter `/usr/bin/chromium`. In der vorbereiteten Cloud-Umgebung sind diese vorhanden. Aus dem Repository-Verzeichnis ausführen:

```sh
python3 -m unittest discover -s tests -v
```

Die Tests verwenden kontrollierte HTML-Ausschnitte, deren Listen- und Karussellstruktur der Spektrum-Startseite entspricht. Sie benötigen keinen Netzwerkzugriff und prüfen unter anderem ausgeschlossene Sammelblöcke, mehrfach platzierte Artikel, verzögert geladene Bilder, Ansichtswechsel, Tastaturbedienung und mobile Darstellung. Änderungen an der echten Website können eine Anpassung der DOM-Erkennung erfordern.
