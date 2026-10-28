# Tab Organizer

Eine Manifest-V3-Erweiterung für Google Chrome und Brave. Die Auswertungen laufen lokal; die Erweiterung sendet keine Daten an Server.

## Tabs thematisch gruppieren

Die Gruppierung bezieht sich auf Tabs im aktuellen Browserfenster. Sie vergleicht ausschließlich Seitentitel, nicht Seiteninhalte, URLs oder Domains. Ein lokaler TF-IDF-/Cosinus-Ähnlichkeitsvergleich wird durch Themenbegriffe ergänzt. Direkte Nachbarn erhalten den höchsten Einfluss; der Einfluss weiter entfernter Titel sinkt mit der Tab-Distanz. Eine starke entfernte Beziehung kann eine lokale Grenze überstimmen, wenn ihr gewichteter Einfluss größer ist. Tabs zwischen solchen Ankern werden Teil desselben Bereichs. So können beispielsweise eine Stellenausschreibung für 3D Artists und ein Unreal-Engine-Tutorial samt dazwischenliegenden Tabs gemeinsam gruppiert werden, sofern ihre gewichtete Beziehung stärker bleibt. Sonst beginnt an der unpassenden Nachbarschaft ein neuer Bereich. Vorschläge zeigen Themenbezug und einstellbare Gruppennamen; auch einzelne Tabs werden als eigene Bereiche vorgeschlagen. Angeheftete Tabs bleiben außerhalb. Beim Anwenden werden bestehende Gruppen der neu zugeordneten Tabs ersetzt. Es wird kein KI-Dienst oder Netzwerkzugriff verwendet.

## Such-Tabs verwalten

Erkennt Google-Suchergebnisse (`google.* /search?q=…`) und Brave Search (`search.brave.com/search?q=…`). Pro Tab wird nur der Suchbegriff angezeigt. Markiere, welche Such-Tabs geöffnet bleiben sollen; nicht markierte Such-Tabs werden nach Klick und Bestätigung geschlossen.

## File-Storage-Tabs verwalten

Erkennt gängige Anbieter wie Google Drive/Docs, OneDrive, SharePoint, Dropbox, Box, iCloud Drive, MEGA, Proton Drive, pCloud, Sync, Tresorit, Icedrive, MediaFire, Zoho WorkDrive, Yandex Disk, Filen und Internxt. Nextcloud- und ownCloud-Dateiansichten werden anhand ihres Pfads erkannt.

Eigene Domains können im Popup hinzugefügt und später wieder entfernt werden. Das hilft bei selbst gehosteten oder hier nicht aufgeführten Diensten. Die Liste eigener Domains wird lokal im Erweiterungsspeicher gespeichert. Storage-Tabs werden mit Seitentitel und Hostname angezeigt; markiere die Tabs, die geöffnet bleiben sollen. Nicht markierte Storage-Tabs werden nach separater Bestätigung geschlossen. Andere Tabs und der Browserverlauf bleiben unberührt.

## Doppelte Tabs prüfen

Die Duplikatprüfung gruppiert Tabs mit derselben vollständigen URL. Weitere Tabs einer Gruppe sind standardmäßig zum Schließen markiert und können vor dem Schließen abgewählt werden. Auch dafür ist eine Bestätigung erforderlich.

## Installation in Chrome oder Brave

1. Dieses Projektverzeichnis lokal speichern.
2. `chrome://extensions` (Chrome) oder `brave://extensions` (Brave) öffnen.
3. **Entwicklermodus** aktivieren.
4. **Entpackte Erweiterung laden** auswählen und dieses Verzeichnis wählen.
5. Erweiterung über das Erweiterungssymbol öffnen.

## Berechtigung

Die Erweiterung benötigt `tabs`, um Tab-URLs und Titel zu lesen und ausgewählte Tabs zu schließen, sowie `tabGroups`, um Tab-Gruppen zu erstellen und zu benennen. Für die thematische Gruppierung wird nur der Seitentitel verwendet. Browserinterne Tabs und Tabs, deren URL der Browser nicht offenlegt, können von den Such-, Storage- und Duplikatprüfungen nicht ausgewertet werden.
