# Universal Cut List Optimizer – Product Requirements

| | |
|---|---|
| Status | Entwurf v0.1, abgeleitet aus dem Prototyp |
| Stand | 2026-11-15 |
| Autorität | Dieses Dokument definiert die fachlichen Regeln. Die ursprüngliche Bauanleitung (`instructions.md`) ist nicht Teil des Repos. Der Code im Commit `64e0596` zeigt den Ist-Stand. |
| Legende | **[Code]** = am Code verifiziert (Commit `64e0596`) · **[Annahme]** = vorgeschlagener Default, vom Product Owner zu bestätigen |

---

## 1. Produktziel

Wer Holz, Platten oder Metall zuschneidet, soll in wenigen Minuten einen Schnittplan bekommen. Der Plan zeigt:

- aus welchen vorhandenen Rohteilen (Latten oder Platten) welche Zuschnitte entstehen,
- wie viel Material dabei verloren geht,
- welche Teile sich mit dem vorhandenen Material **nicht** herstellen lassen, und warum.

Das Werkzeug läuft im Browser, ohne Konto und ohne Server.

**Jobs-to-be-done**
1. „Ich habe eine Stückliste und weiß nicht, wie viele Latten oder Platten ich kaufen muss.“
2. „Ich habe Material da und will wissen, ob es für mein Projekt reicht.“
3. „Ich will einen Plan mit wenig Verschnitt, den ich an der Säge abarbeiten kann.“

## 2. Nutzer und Rollen

| Rolle | Beschreibung |
|---|---|
| Anwender (anonym, lokal) | Hobbyhandwerker, Tischler, Schreiner, Metallbauer. Bedient die gesamte App. |

**[Annahme]** Es gibt eine einzige Rolle ohne Anmeldung. Daten liegen nur im Browser-Tab und gehen beim Neuladen verloren (Ist-Stand **[Code]**). Es gibt keine Berechtigungsunterschiede.

## 3. Domänenobjekte

| Objekt | Zweck | Felder (Einheit) | Lebenszyklus |
|---|---|---|---|
| **Projekt-Einstellungen** | Globale Parameter einer Berechnung | `modus` (1D \| 2D), `kerf` (mm, ≥ 0, Standard 3), `rotationErlaubt` (bool, nur 2D, Standard an), `iterativ` (bool, nur 2D, Standard an) | Bleibt für die Sitzung bestehen. Moduswechsel verwirft das Ergebnis. |
| **Rohmaterial (Stock)** | Vorhandenes Material | `laenge` (mm > 0), `breite` (mm > 0), `anzahl` (Ganzzahl ≥ 1), `bezeichnung` (Text, optional) | Anlegen, bearbeiten, löschen. Getrennte Listen je Modus **[Code]**. |
| **Zuschnitt (Part)** | Benötigtes Teil | wie Rohmaterial | wie Rohmaterial |
| **Ergebnis** | Ausgabe einer Berechnung | Liste von *Belegungen*, Liste von *nicht zugeordneten Teilen*, Kennzahlen | Entsteht durch „Calculate“. Wird bei Moduswechsel und neuer Berechnung ersetzt. Iterativ: wird durch bessere Lösungen überschrieben. |
| **Belegung (Bin)** | Ein verwendetes Rohteil mit seinen Zuschnitten | Bezug zum Rohmaterial, Platzierungen, Rest/Verschnitt | Teil des Ergebnisses |
| **Platzierung** | Lage eines Zuschnitts | 1D: Position auf der Länge. 2D: `x`, `y`, `breite`, `hoehe`, `gedreht` | Teil der Belegung |
| **Nicht zugeordnetes Teil** | Zuschnitt ohne Platz | Bezug zum Zuschnitt, `grund` | Teil des Ergebnisses |

**Beziehungen**
- Rohmaterial 1 → n Belegungen. Eine Zeile mit `anzahl = 5` liefert bis zu 5 Belegungen.
- Belegung 1 → n Platzierungen. Jede Platzierung gehört zu genau einem Exemplar eines Zuschnitts.
- Jedes Exemplar eines Zuschnitts (`anzahl` expandiert) ist **genau einmal** entweder platziert oder nicht zugeordnet.

## 4. Kernabläufe

1. **Modus wählen:** 1D (Latten, Leisten, Rohre) oder 2D (Platten).
2. **Material und Zuschnitte erfassen:** Zeilen hinzufügen, bearbeiten oder löschen. Beispieldaten sind vorbelegt **[Code]**.
3. **Einstellungen setzen:** Kerf, im 2D-Modus zusätzlich Rotation und iterativ.
4. **Berechnen:** Eine erste Lösung erscheint sofort. Im iterativen 2D-Modus folgen bessere Lösungen, und die Optimierung lässt sich stoppen.
5. **Ergebnis lesen:** Schnittbild je Rohteil, Verschnitt, Liste der nicht zugeordneten Teile mit Grund.

## 5. Geschäftsregeln

### 5.1 Allgemein
- R1: Mengen werden zu Einzelexemplaren expandiert.
- R2: **Erhaltungsregel.** Platzierte Teile plus nicht zugeordnete Teile ergeben die Anzahl angeforderter Teile. Nichts geht verloren, nichts wird doppelt platziert.
- R3: Ungültige Zeilen (Länge, Breite oder Anzahl leer, 0, negativ oder nicht numerisch) werden nicht berechnet. Sie werden markiert. **[Annahme]**
- R4: **Kerf** ist die Breite des Sägeschnitts. Er fällt nur **zwischen** zwei Teilen bzw. zwischen Teil und Reststück an, **nicht** an der Außenkante des Rohteils. Ein Teil, das genau bis zur Kante reicht, braucht dort keinen Schnitt. **[Annahme, entspricht instructions.md „usually not“]**
- R5: Rohteile werden nicht automatisch besäumt (keine Randabzüge). **[Annahme]**

### 5.2 1D-Modus
- R6: Ein Teil passt nur auf Rohmaterial **gleicher Breite** (Toleranz 0,01 mm). Gibt es keine solche Breite, gilt der Grund „Keine passende Materialbreite“.
- R7: Ist ein Teil länger als **jedes** Rohmaterial seiner Breite, gilt der Grund „Länger als jedes Rohmaterial“.
- R8: Packung je Breitengruppe nach Best-Fit-Decreasing auf der Länge: Teile absteigend nach Länge sortieren. Jedes Teil kommt auf das bereits angebrochene Rohteil mit dem kleinsten passenden Rest. Gibt es keins, wird ein neues Rohteil angebrochen.
- R9: Bei mehreren Rohlängen gleicher Breite wird für ein neues Rohteil das **kürzeste passende** gewählt. **[Annahme, siehe Frage F3]**
- R10: Verschnitt je Rohteil = Länge − Summe der Teile − Kerfs nach R4.
- R11: Ist alles Material dieser Breite verbraucht, gilt der Grund „Material reicht nicht“.

### 5.3 2D-Modus
- R12: **Guillotine-Schnitte:** Jeder Schnitt trennt ein Rechteck vollständig von Kante zu Kante.
- R13: Zwei Packverfahren, die die Optimierung kombiniert: **frei** (Best-Area-Fit, Teil in die passendste Lücke) und **streifenbasiert** (Platte in Streifen längs oder quer, Streifen in Stapel, Stapel in Teile; 3 Stufen, plus Besäumschnitt bei schmaleren Teilen). **[Entscheidung 2026-11-27]**
- R13a: Für jede Platte wird die Schnittfolge als Guillotine-Baum rekonstruiert. Daraus ergeben sich **Schnittstufen** (Wechsel der Schnittrichtung), **Anzahl Schnitte** und die **Reststücke**. Ein Reststück ist **verwertbar**, wenn seine schmale Seite mindestens die *Mindestrestbreite* erreicht (Standard 100 mm, einstellbar). Schmalere Reste gelten als Abfall.
- R14: Mit Rotation darf ein Teil um 90° gedreht werden. Gedrehte Teile sind im Schnittbild gekennzeichnet (↻). Ohne Rotation gilt Länge = Plattenlänge (x-Achse).
- R15: Kein Teil überlappt ein anderes oder einen Kerf-Streifen. Kein Teil ragt über die Platte hinaus.
- R16: Passt ein Teil in keiner erlaubten Ausrichtung auf irgendein Plattenformat, gilt der Grund „Größer als jede Platte“. Ist nur das Material aufgebraucht, gilt „Material reicht nicht“.
- R17: Bei mehreren Plattenformaten darf jedes Format verwendet werden. Die Auswahl ist nicht an die Reihenfolge der Eingabe gebunden. **[Annahme]**

### 5.4 Iterative Optimierung (2D)
- R18: Die erste heuristische Lösung wird sofort angezeigt.
- R18a: Die iterative Optimierung läuft immer und ist nicht abschaltbar. **[Entscheidung 2026-11-27]** Bei normalen Aufträgen ist sie in unter einer Sekunde fertig. Fortschritt und Stopp erscheinen nur, solange sie läuft.
- R19: Danach laufen weitere Durchläufe (genetischer Algorithmus oder Multi-Start mit verschiedenen Sortierstrategien). Eine neue Lösung ersetzt die angezeigte nur, wenn sie **besser** ist.
- R20: **Bewertung (lexikografisch, [Entscheidung 2026-11-27, ersetzt die frühere Annahme]):** Immer zuerst (1) weniger nicht zugeordnete Teile, (2) mehr platzierte Fläche, (3) weniger Plattenfläche, (4) weniger Platten. Danach entscheidet das in der UI gewählte **Optimierungsziel**:
  - *Ausgewogen* (Standard): bis 3 Schnittstufen gelten als gleich gut (Plattensäge), dann größtes verwertbares Reststück, dann weniger Schnitte.
  - *Einfach sägen*: weniger Schnittstufen, dann weniger Schnitte, dann größtes Reststück.
  - *Große Reste*: größtes verwertbares Reststück, dann mehr verwertbare Restfläche, dann weniger Stufen und Schnitte.
  Kein Ziel darf eine zusätzliche Platte oder ein nicht platziertes Teil kosten.
- R21: Die UI bleibt während der Optimierung bedienbar. „Stop“ beendet die Optimierung innerhalb von 1 s und behält die beste Lösung.
- R22: Fortschritt anzeigen: Durchlauf/Generation, aktuelle beste Ausnutzung.

### 5.5 Abgeleitete Kennzahlen
- Ausnutzung % = Fläche (bzw. Länge) aller platzierten Teile ÷ Fläche (bzw. Länge) aller **verwendeten** Rohteile × 100.
- Verschnitt % = 100 − Ausnutzung.
- Ausgabe je Rohteil und gesamt, plus Anzahl verwendeter Rohteile je Material.

## 6. Randfälle und Fehlerverhalten

| Fall | Erwartetes Verhalten |
|---|---|
| Keine gültigen Zeilen | Button „Calculate“ deaktiviert **[Code]**, Hinweis auf fehlende Eingaben |
| Länge/Breite 0, negativ, leer | Zeile ungültig markieren und nicht berechnen (R3) |
| Anzahl 0 oder leer | Zeile ungültig (Ist: wird stillschweigend als 1 behandelt **[Code]**) |
| Kerf negativ oder leer | Wird auf 0 gesetzt. Kerf > 50 mm: Warnung |
| Teil gleich groß wie Rohteil | Passt ohne Kerf (R4) |
| Viele identische Teile | Deterministisches Ergebnis, kein Teil verloren (R2) |
| Sehr große Mengen (> 1000 Exemplare) | Erste Lösung < 2 s, Optimierung abbrechbar, keine eingefrorene UI |
| Gleitkomma-Maße (z. B. 623,5) | Vergleich mit Toleranz 0,01 mm |
| Kerf größer als kleinstes Teil | Rechnen erlaubt, Ergebnis nach Regeln korrekt |
| Moduswechsel während der Optimierung | Optimierung stoppen, Ergebnis verwerfen **[Code]** |

## 7. Akzeptanzkriterien

Alle Maße in mm. Jedes Kriterium lässt sich automatisch gegen die Algorithmusfunktion testen. A15–A17 sind manuelle bzw. visuelle Prüfungen.

**1D**
- A1: Rohteil 2400×100 ×1, Teile 798×100 ×3, Kerf 3 → 1 Rohteil, 0 nicht zugeordnet, Verschnitt 0 (3·798 + 2·3 = 2400).
- A2: Rohteil 2400×100 ×1, Teile 800×100 ×3, Kerf 3 → 2 platziert, 1 nicht zugeordnet mit Grund „Material reicht nicht“.
- A3: Rohteil 2400×100 ×5, Teil 1200×120 ×1 → nicht zugeordnet mit Grund „Keine passende Materialbreite“.
- A4: Rohteile 1200×100 ×1 (zuerst gelistet) und 2400×100 ×1, Teil 2000×100 ×1 → auf dem 2400er platziert.
- A5: Rohteil 2400×100 ×3, Teile 800×100 ×4 und 450×100 ×6, Kerf 3 → 0 nicht zugeordnet, höchstens 3 Rohteile.
- A6: Teil 3000×100 bei Rohteilen nur bis 2400 → Grund „Länger als jedes Rohmaterial“.

**2D**
- A7: Platte 2500×1250 ×1, Teil 2500×1250 ×1, Kerf 3 → platziert bei (0,0).
- A8: Platte 2500×1250 ×1, Teil 1248,5×623,5 ×4, Kerf 3 → alle 4 auf 1 Platte.
- A9: Platte 1000×500, Teil 400×900, Rotation **aus** → nicht zugeordnet. Rotation **an** → platziert, `gedreht = true`.
- A10: Teil 3000×100 auf Platte 2500×1250 → Grund „Größer als jede Platte“.
- A11: Invarianten für zufällige Eingaben (≥ 200 Fälle): keine Überlappung inklusive Kerf-Abstand, alle Teile innerhalb der Platte, R2 erfüllt, Ausnutzung zwischen 0 und 100.
- A12: Die iterative Lösung ist nach R20 nie schlechter als die erste heuristische Lösung.
- A13: Platten 1000×1000 ×1 (zuerst) und 2500×1250 ×1, Teil 2000×1000 → auf der 2500er-Platte platziert.

**UI**
- A14: Ändern einer Eingabe und erneutes „Calculate“ liefern ein Ergebnis, das der neuen Eingabe entspricht.
- A15: Während der Optimierung reagieren Scrollen und der Stop-Button. Nach „Stop“ bleibt die beste Lösung sichtbar.
- A16: Die Seite lädt ohne JavaScript-Fehler in der Konsole.
- A17: Gedrehte Teile sind visuell markiert. Im Schnittbild werden Maße angezeigt.

## 8. Ist-Stand vs. Soll

Am Code verifiziert, Stand Commit `64e0596`. Alle Zeilenangaben beziehen sich auf `index.html`.

| # | Abweichung | Schwere |
|---|---|---|
| D1 | **`gemini-version.js` läuft nie.** Die Datei wird per `<script src>` geladen (Z. 41), nutzt aber ES-`import`/`export` und bricht mit einem Syntaxfehler ab. Ihr iterativer Multi-Strategie-Solver (10 Durchläufe, Score, Tabs je Durchlauf) ist toter Code. `app.js` wird gar nicht eingebunden. `archive/layout-gemini-version.png` zeigt die UI der Gemini-Variante (Lucide-Icons) und nicht die aktive Seite. **[Code]** | hoch (Verwirrung, tote Funktion) |
| D2 | **Stop wirkt nicht, die UI friert ein.** `advancedPacking2D` (100 Generationen × 20 Individuen) läuft synchron in einem einzigen `setTimeout`. Es gibt keinen Web Worker (`optimizationWorker` bleibt immer `null`). Fortschritt wird erst am Ende sichtbar, „Stop“ greift nicht. Dazu kommen viele `console.log` pro Generation. Verletzt R21/R22. **[Code]** | hoch |
| D3 | **Kerf an Außenkanten.** `canFit` verlangt `teil + kerf ≤ freier Platz`, auch wenn das Teil an die Plattenkante stößt. 1D: Prüfung `rest ≥ länge + kerf`. A1 scheitert dadurch: das dritte 798er-Teil wird nicht platziert. Nur das erste Teil einer neuen Platte ist ausgenommen, das ist inkonsistent. Verletzt R4. **[Code]** | mittel |
| D4 | **Rohmaterial wird stur in Eingabereihenfolge angebrochen.** 1D (Z. ~1151 ff.): Die Längenprüfung vergleicht nur mit dem *ersten* Rohteil passender Breite. 1D- und 2D-Packer nehmen für ein neues Rohteil immer `availableStock[stockUsed]`. Passt das Teil dort nicht, wird es als „exceeds“ verworfen, obwohl ein späteres Rohteil passen würde. Verletzt R7, R9, R17 und A4/A13. **[Code]** | hoch (falsche Ergebnisse) |
| D5 | **Bewertung der Optimierung.** Fitness = 100 − Verschnitt %. Jede Lösung mit einem nicht zugeordneten Teil bekommt Fitness 0. Reicht das Material nicht, ist die GA wirkungslos. Plattenanzahl und Reststückgröße zählen nicht. Bei Mutation wird die Reihenfolge getauscht, die Rotationsgene aber nicht, sie verrutschen gegenüber den Teilen. Eine Lösung wird nicht gegen die Startheuristik abgesichert (A12). **[Code]** | mittel |
| D6 | **Eingabevalidierung fehlt.** Negative Werte, Anzahl 0 (wird als 1 behandelt) und `NaN` werden nicht abgefangen. Eine Zeile wird nur gespeichert, wenn Länge und Breite gesetzt sind. **[Code]** | mittel |
| D7 | **Fehlende Spezifikationspunkte aus `instructions.md`:** Zoom/Pan, Klick-Hervorhebung Liste ↔ Grafik, Gesamtkennzahlen (Ausnutzung gesamt, Anzahl Rohteile), Kosten, Einheiten inch/cm, Import/Export, Faserrichtung, Prioritäten, Algorithmuswahl in 1D (FFD/BFD), Web Worker. **[Code]** | niedrig bis mittel |
| D8 | **1D-Visualisierung:** Kerf wird nur *zwischen* Teilen gezeichnet, der Verschnitt aber mit einem Kerf pro Teil berechnet. Grafik und Zahl passen nicht exakt zusammen. **[Code]** | niedrig |
| D9 | **Technik:** CDN-Versionen nicht gepinnt (`react@18`), Babel im Browser, keine Tests, kein Build. Zwei fast identische Packer-Implementierungen (`guillotinePacking2D` und `…WithOrder`). **[Code]** | niedrig |

## 9. Release-Plan

**R0 – Fundament stabilisieren** *(Zielnutzer: Entwickler, Nutzen: verlässliche Basis)*
- Enthalten: tote Dateien entfernen oder sinnvoll übernehmen, Algorithmen in ein testbares Modul auslagern, Tests für A1–A13, CDN-Versionen pinnen.
- Nicht enthalten: neue Features, UI-Redesign.
- Erfolg: `npm test` grün, Seite lädt fehlerfrei (A16), keine Verhaltensänderung außer Bugfixes.

**R1 – Korrekte Ergebnisse** *(Anwender: „Ich kann dem Plan trauen“)*
- Enthalten: D3 (Kerf-Regel R4), D4 (Rohmaterialwahl), D6 (Validierung), Gesamtkennzahlen (5.5).
- Nicht enthalten: Optimierungsverbesserungen.
- Erfolg: A1–A14 erfüllt.

**R2 – Reaktionsfähige Optimierung** *(Anwender: „Ich sehe, wie es besser wird, und kann stoppen“)*
- Enthalten: Optimierung in Web Worker oder Zeitscheiben (D2), Bewertung nach R20 (D5), echter Stop, Fortschritt; ggf. Multi-Start-Strategien aus der Gemini-Variante.
- Nicht enthalten: konfigurierbare Parameter.
- Erfolg: A12, A15; 500 Teile ohne eingefrorene UI.

**R3 – In der Werkstatt nutzbar** *(Anwender: „Ich nehme den Plan mit an die Säge“)*
- Enthalten: Projekt lokal speichern (localStorage), Druckansicht/PDF der Schnittliste, CSV-Import/-Export der Stückliste.
- Nicht enthalten: Cloud, Konten.
- Erfolg: Projekt überlebt Neuladen; Druckbild auf A4 lesbar.

**R4 – Fachliche Erweiterungen** (je ein eigenes Mini-Release): Faserrichtung pro Teil, Einheiten inch/cm, Kosten pro Rohteil, Reststücklager.

Jedes Release ist abwärtskompatibel, weil das Datenmodell (Abschnitt 3) nur um optionale Felder wächst.

## 10. Außerhalb des Umfangs / Zurückgestellt

- Benutzerkonten, Mehrbenutzer, Cloud-Speicherung
- Nesting freier Formen (nur Rechtecke)
- Nicht-Guillotine-Schnitte (CNC-Nesting)
- Maschinenansteuerung (CNC/Plattensäge-Export)
- Mehrere Materialstärken in einer Berechnung (zurückgestellt, siehe E6)

## 11. Offene Fragen an den Product Owner

| # | Frage | Vorgeschlagener Default |
|---|---|---|
| F1 | Fällt Kerf an der Rohteilkante an (z. B. weil Platten erst besäumt werden)? Soll es einen optionalen Randabzug geben? | Kein Kerf an der Kante. Optionaler Randabzug pro Rohmaterial ab R4. |
| F2 | 1D: Dürfen schmalere Teile aus breiterem Material entstehen (Längs-/Auftrennen)? `instructions.md` verbietet nur „breiter als“, gruppiert aber strikt nach gleicher Breite. | Nur gleiche Breite (wie Ist). |
| F3 | Welches Rohteil soll bei mehreren Längen/Formaten zuerst angebrochen werden: das kürzeste passende (Reste nutzen) oder das, das insgesamt am wenigsten Material verbraucht? | Gesamt-Materialverbrauch minimieren; bei Gleichstand Reststücke zuerst. |
| F4 | ~~Optimierungsziel: wenige Rohteile, wenig Verschnitt-% oder große wiederverwendbare Reste?~~ | **Entschieden 2026-11-27:** Material zuerst, danach wählbares Ziel (Ausgewogen / Einfach sägen / Große Reste), siehe R20. |
| F5 | Was wird im iterativen Modus übernommen: der genetische Algorithmus (Ist) oder die Multi-Start-Strategien der Gemini-Variante (mit Tabs je Durchlauf)? | Multi-Start als schnelle Basis plus GA als Feinschliff. Tabs entfallen, nur die beste Lösung wird angezeigt. |
| F6 | Soll die App bei „zero-build“ (eine HTML-Datei, CDN) bleiben oder auf ein Build-Setup (Vite) umziehen? | Zero-build beibehalten, solange keine Offline-Nutzung gefordert ist. |
| F7 | ~~Zielsprache der UI?~~ | **Entschieden 2026-11-27 (aktualisiert):** Deutsch und Englisch, umschaltbar im Header (DE/EN). Die Auswahl wird im Browser gespeichert; ohne gespeicherte Wahl entscheidet die Browsersprache. Eingegebene Bezeichnungen werden nicht übersetzt. |

## 12. Erweiterungsideen (priorisiert)

| Prio | Idee | Nutzen |
|---|---|---|
| hoch | E1 Projekt speichern/laden (localStorage, JSON-Export) | Keine Neueingabe nach Reload |
| hoch | E2 Druck/PDF der Schnittliste, Etiketten pro Teil | Arbeit an der Säge |
| hoch | E3 CSV-Import/-Export der Stückliste | Übernahme aus CAD/Excel |
| mittel | E4 Faserrichtung pro Teil (Rotation pro Teil sperren) | Holzoptik |
| mittel | E5 Kosten pro Rohteil, Gesamtkosten, Einkaufsliste | Budget |
| mittel | E6 Mehrere Materialien/Stärken (Material-Attribut, getrennte Berechnung) | Reale Projekte |
| mittel | E7 Reststücklager: brauchbare Reste speichern und als Rohmaterial wiederverwenden | Weniger Abfall |
| mittel | E8 Schnittreihenfolge (Säge-Anleitung Schritt für Schritt) | Fehlervermeidung |
| niedrig | E9 Einheiten inch/cm/mm | Internationale Nutzer |
| niedrig | E10 Kantenumleimer (Kanten markieren, Laufmeter berechnen) | Möbelbau |
| niedrig | E11 Maschinenrestriktionen (max. Schnittlänge, min. Reststück, Besäumen) | Plattensäge |
| niedrig | E12 Mobile-Ansicht für die Werkstatt, Zoom/Pan | Nutzung am Tablet |
| niedrig | E13 Teile-Prioritäten (muss/kann) | Knappes Material |

## 13. Chronik

**2026-11-15 – Spezifikation aus Prototyp erstellt**
- Kontext: Der Prototyp (`index.html`) entstand aus `instructions.md`. Daneben liegen zwei verwaiste Varianten (`app.js`, `gemini-version.js`).
- Änderung: Dieses Dokument wurde erstellt. Es leitet Regeln, Akzeptanzkriterien und den Release-Plan aus Spezifikation, Code (Commit `64e0596`) und `layout.png` (heute `archive/layout-gemini-version.png`) ab.
- Verifikation: Code gelesen. Keine Tests ausgeführt, kein Browser-Test.
- Folgepunkte: Fragen F1–F7 klären. Parallel laufen Code-Aufräumen und Tests (R0, separater Arbeitsstrang). Der Abschnitt Ist-Stand muss danach aktualisiert werden.

**2026-11-27 – Wählbares Optimierungsziel, Streifenpacker, Kantenmaße**
- Kontext: Der Product Owner bemängelte zerstückelte Reststücke im 2D-Plan (Treppenbeispiel: Deckel, 2 Stufen, 3 Doppel, Wange auf 2500 × 1250). Eine andere App zeigte eine Anordnung in Streifen mit wenigen durchgehenden Schnitten.
- Entscheidung: F4 ist beantwortet (R20). Das Ziel ist in der UI wählbar, ergänzt um die Mindestrestbreite (R13a).
- Änderung: Streifenpacker (Zeilen/Spalten) als zusätzliches Packverfahren für den genetischen Algorithmus. Schnittanalyse je Platte (Stufen, Schnitte, Reststücke). Das Schnittbild zeigt die Maße an den Kanten von Teilen und verwertbaren Resten, Abfall schraffiert, Gesamtmaße außen.
- Ergebnis Treppenbeispiel: 1 Platte, 2 Schnittstufen, 10 Schnitte, größtes Reststück 838 × 662 mm (vorher 3 Stufen, stärker verschachtelt).
- Verifikation: 32 automatische Tests grün (u. a. Streifenpacker-Invarianten, Zielvergleich, Treppenbeispiel). Browser-Check von 1D und 2D ohne Konsolenfehler.
- Folgepunkte: Vergleichs-Tabs mit der besten Lösung je Ziel (zurückgestellt). Bewertung von Resten, die über mehrere Platten verteilt sind.

**2026-11-27 – Oberfläche auf Deutsch, iterative Optimierung immer aktiv**
- Kontext: Der Product Owner wünscht eine deutsche Oberfläche. Die Checkbox „Iterative Optimization“ war überflüssig, weil die Suche bei üblichen Aufträgen sofort fertig ist.
- Entscheidung: F7 beantwortet (Deutsch). R18a: Optimierung läuft immer.
- Änderung: Alle Texte der Oberfläche, Beispieldaten, Gründe und Zielnamen auf Deutsch, Zahlen mit Dezimalkomma. Checkbox entfernt.
- Verifikation: 32 Tests grün, 1D und 2D im Browser ohne Konsolenfehler.

**2026-11-27 – Sprachumschaltung DE/EN, Screenshots**
- Änderung: Alle Texte der Oberfläche liegen in einem Wörterbuch (DE/EN), Umschaltung im Header, Zahlenformat je Sprache. Gründe für nicht zuordenbare Teile kommen als sprachneutraler Code aus dem Optimizer. URL-Parameter `lang`, `mode`, `run` für Demos. README zweisprachig mit Screenshots in `docs/`.
- Ersetzt: die vorherige Festlegung „nur Deutsch“ zu F7.
- Verifikation: 32 Tests grün, Umschaltung DE↔EN im Browser ohne Konsolenfehler, Screenshots per Headless-Chrome erzeugt.
