# Spektrum.de – Leseransicht

Ein Userscript für eine ruhige Spektrum-Startseite: redaktionelle Beiträge, klare Typografie und möglichst wenig Ablenkung.

## Verwenden

[Userscript installieren oder aktualisieren](https://raw.githubusercontent.com/ThisIsBert/Test_LAnsicht/main/spektrum-leseransicht.user.js), die Aktualisierung im Userscript-Manager (zum Beispiel Tampermonkey oder Violentmonkey) bestätigen und `https://www.spektrum.de/` neu laden. In der Kopfzeile und im Fußbereich steht die aktive Version, derzeit **0.4.1**. Im Script sind die Download- und Update-Adressen für spätere Aktualisierungen hinterlegt. Ein GitHub-Upload allein aktualisiert bereits installierte Kopien nicht sofort; der Knopf **↻** aktualisiert nur die Artikelauswahl.

Falls weiterhin sechs Bildkarten erscheinen oder die Schalter **Magazin/Kompakt** fehlen, läuft eine ältere Kopie. Im Userscript-Manager prüfen, dass nur eine Version aktiviert ist. Das Script verändert nur die Startseite. Artikel öffnen sich wie gewohnt auf Spektrum.de; bestehende Zugangs- und Abobedingungen gelten weiter.

- **Magazin** zeigt einen Aufmacher, bis zu drei Bildkarten und einen kurzen Überblick.
- **Kompakt** zeigt dieselben Beiträge als reine Textliste in der Reihenfolge der ursprünglichen Startseite. Die Wahl wird lokal im Browser gespeichert, sofern erlaubt.
- Standardmäßig wird nur der obere aktuelle Überblick der Startseite eingelesen, vor den benannten Magazin- und Themenblöcken. **Weitere Rubriken einbeziehen** erweitert diese Auswahl. **Nachrichten** grenzt die jeweilige Auswahl auf die Artikelart `/news/` ein; diese URL allein sagt nichts über das Alter eines Artikels aus.
- Rubrikfilter grenzen die Auswahl ein. Zunächst erscheinen maximal zwölf Überblickszeilen; weitere lassen sich aufklappen.
- **Originalseite** oder die Escape-Taste kehren zur ursprünglichen Seite zurück. **↻** liest die bereits geladene Seite erneut ein; es lädt keine neuen Nachrichten vom Server.

„Meistgelesen“, „Das Beste von Spektrum.de“, Shop- und Werbeblöcke werden nicht übernommen, auch nicht bei aktivierten weiteren Rubriken. Neben den DOM-Blöcken werden die Empfehlungskennzeichnungen `itm_campaign=meistgelesen` und `itm_campaign=articles-of-interest` an den Links geprüft. Ein Artikel, der zugleich im normalen aktuellen Bereich erscheint, bleibt dort erhalten. Die Auswahl und Reihenfolge stammen von der geladenen Seite; das Script ermittelt keine Veröffentlichungsdaten und garantiert kein bestimmtes Höchstalter. „Aktuell“ bezeichnet den oberen redaktionellen Bereich, keine Prüfung des Veröffentlichungsdatums.

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
