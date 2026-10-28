# Tab Organizer

Eine Manifest-V3-Erweiterung für Google Chrome und Brave. Sie ordnet Tabs, findet Google- und Brave-Such-Tabs, erkennt File-Storage-Seiten und findet exakte URL-Duplikate.

## Tabs semantisch gruppieren

Die Erweiterung vergleicht Tabtitel mit dem lokal mitgelieferten mehrsprachigen Satz-Embedding-Modell `multilingual-e5-small` (ONNX, quantisiert). Es gibt keine eingebauten Listen bestimmter Themen, Schlüsselwörter oder Wortpaare: Entscheidend ist die Bedeutung im Kontext. Dadurch können auch neue Begriffe und verwandte Formulierungen in verschiedenen Sprachen zusammenpassen.

Standardmäßig werden Seitentitel analysiert. Auf ausdrücklichen Klick kann zusätzlich Zugriff auf die aktuell geöffneten HTTP(S)-Seiten angefragt werden. Bei Freigabe werden Meta-Beschreibung, Überschriften und ein kurzer sichtbarer Textausschnitt aus dem Hauptbereich gelesen (höchstens 850 Zeichen insgesamt pro Seite). Modell und Texte werden ausschließlich lokal verarbeitet und nicht an einen Dienst übertragen. Ohne Freigabe verwendet die Erweiterung nur Titel. Der Browser speichert die gewährte Website-Berechtigung bis zu ihrem Widerruf in den Erweiterungseinstellungen.

Die Analyse folgt der Reihenfolge der Tabs im aktuellen Fenster. Direkte Nachbarn haben den stärksten Einfluss. Ähnlichkeiten zwischen weiter auseinanderliegenden Tabs verlieren mit ihrer Distanz an Gewicht; sie können eine Grenze nur überstimmen, wenn ihr gewichteter Einfluss stärker ist. Zeitlich nahe geöffnete Tabs erhalten einen kleinen Zusatzimpuls, der allein keine Gruppe erzeugt. Neue Tab-Öffnungszeiten werden lokal in der Browser-Sitzung erfasst. Nach Freigabe der optionalen Verlaufsberechtigung fragt die Erweiterung außerdem ausschließlich Besuchszeiten für URLs der gerade offenen Tabs ab; der Verlauf wird nicht als Ganzes durchsucht oder verändert. Für ältere Tabs ohne passende Verlaufseinträge dient `lastAccessed` (zuletzt aktiviert) als schwacher Näherungswert. Einzeltabs und angeheftete Tabs bleiben außerhalb von Gruppen. Beim Anwenden werden bestehende Gruppen der nicht angehefteten Tabs dieses Fensters aufgelöst und die vorgeschlagenen Mehrtab-Gruppen erstellt.

Das quantisierte ONNX-Modell ist etwa 118 MB groß; Tokenizer- und Konfigurationsdateien kommen hinzu. Der vollständige Modellordner wird mit der Erweiterung ausgeliefert, damit die Analyse nach der Installation offline läuft. Quelle: [Xenova multilingual-E5-small](https://huggingface.co/Xenova/multilingual-e5-small), ausgeführt im Browser mit [Transformers.js](https://github.com/huggingface/transformers.js).

## Such-Tabs verwalten

Erkennt Google-Suchergebnisse (`google.* /search?q=…`) und Brave Search (`search.brave.com/search?q=…`). Pro Tab wird nur der Suchbegriff angezeigt. Markiere, welche Such-Tabs geöffnet bleiben sollen; nicht markierte Such-Tabs werden nach Klick und Bestätigung geschlossen.

## File-Storage-Tabs verwalten

Erkennt gängige Anbieter wie Google Drive/Docs, OneDrive, SharePoint, Dropbox, Box, iCloud Drive, MEGA, Proton Drive, pCloud, Sync, Tresorit, Icedrive, MediaFire, Zoho WorkDrive, Yandex Disk, Filen und Internxt. Nextcloud- und ownCloud-Dateiansichten werden anhand ihres Pfads erkannt.

Eigene Domains können im Popup hinzugefügt und später wieder entfernt werden. Die Liste eigener Domains wird lokal im Erweiterungsspeicher gespeichert. Storage-Tabs werden mit Seitentitel und Hostname angezeigt; markiere die Tabs, die geöffnet bleiben sollen. Nicht markierte Storage-Tabs werden nach separater Bestätigung geschlossen. Andere Tabs und der Browserverlauf bleiben unberührt.

## Doppelte Tabs prüfen

Die Duplikatprüfung gruppiert Tabs mit derselben vollständigen URL. Weitere Tabs einer Gruppe sind standardmäßig zum Schließen markiert und können vor dem Schließen abgewählt werden. Auch dafür ist eine Bestätigung erforderlich.

## Installation in Chrome oder Brave

1. `npm install` ausführen.
2. `npm run build` ausführen. Das erzeugt den vollständigen installierbaren Ordner `dist/` inklusive Modell, Runtime-Dateien und Manifest.
3. `chrome://extensions` (Chrome) oder `brave://extensions` (Brave) öffnen.
4. **Entwicklermodus** aktivieren und **Entpackte Erweiterung laden** auswählen.
5. Den erzeugten `dist`-Ordner auswählen.

## Berechtigungen

Die Erweiterung benötigt `tabs`, um Tabtitel und URLs zu lesen und ausgewählte Tabs zu schließen, `tabGroups`, um Tab-Gruppen zu erstellen und zu benennen, sowie `storage` für lokale Öffnungszeitpunkte innerhalb der Browser-Sitzung. `history`, `scripting` und Website-Zugriff werden optional erst beim Klick auf die semantische Analyse angefragt. Browserinterne Tabs und Tabs, deren URL der Browser nicht offenlegt, können von den Prüfungen nicht ausgewertet werden.
