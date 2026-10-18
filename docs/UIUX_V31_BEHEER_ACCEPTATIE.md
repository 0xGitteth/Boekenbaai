# Boekenbaai Beheer v3.1: functiebehoud en acceptatie

Status: **concept**, hoort bij #291 en PR #293. Ontwerp v3.1 is definitief goedgekeurd op 18 oktober 2026. Geen extra ontwerpronde.

## Visuele referentie

ChatGPT-bibliotheek `/Boekenbaai/boekenbaai_ontwerp_v3_1.html`.
De oorspronkelijke ZIP bevat referentie-PNG's voor Beheer, Docenten en Leerlingen.
De HTML is een demo en **geen werkende backend**. Hieruit worden geen auth- of API-mogelijkheden gekopieerd.

Te toetsen viewports: desktop 1440 × 900, tablet 834 × 1112 en mobiel 390 × 844.
Maak per viewport van **dezelfde rol, toestand en fictieve data** screenshots van
het HTML-ontwerp en de gebouwde site; corrigeer afwijkingen.
Ook menu open/gesloten, formulieren, fout-, laad- en leegtoestanden zijn verplicht.
Niet testen met schrijfhandelingen in de productiegegevens.

## Beheer: functiebehoudmatrix

| Functie | Bestaande implementatie | Nieuwe plaats | Toetsing |
| --- | --- | --- | --- |
| Personeelsaanmelding en naamautocomplete | `public/app.js`, auth-backend | Ongewijzigde login, Beheer na rolcontrole | Test aanmelding, uitloggen, docenteffect, naam pas vanaf 3 letters |
| Kerncijfers en accounttaken | `/api/admin/google-first/summary` | Start | Werking, laad-, fout- en nulstand |
| Schoolstatistieken | `#admin-stats-button` | Start | Weergave/rollen, nulstand |
| Catalogus en boekdetails | `#book-grid`, `#book-detail` | Boeken | Zoeken, sorteren, themafilters, omslagfout, 2:3 |
| Boek toevoegen/bewerken/verwijderen | `#admin-book-form` en `public/app.js` | Boeken, los bewerkformulier | A01 zichtbaarheid, A02 annuleren, bevestigingen |
| ISBN/metadata/exemplaren/omslagcrop | Bestaande boekvelden en serverflow | Boeken | Bijwerken zonder verlies van herkomst, exemplaren, bron-URL/crop |
| Leerlingaccounts, klaswissels, leerlingnummer | `student-management.js`, `student-detail.js` | Personen en klassen → Leerlingen | Zoekfunctie, detail, klasgrenzen en bevestigingen |
| Docenten en Google-koppelingen | `admin-google-links.js`, oude docentformulieren | Personen en klassen → Docenten | Multi-klassen, detail, verzoeken en veilige rollen |
| Klassen en gekoppelde docenten | `#admin-card-classes-content` | Personen en klassen → Klassen | Aanmaken, zoeken, leerling- en docentkoppeling |
| Uitlenen/innemen fysiek exemplaar | `staff-loans.js`, `/api/staff/loans` | Uitlenen en innemen | Zoek, echte ID, gelijk barcode, inname, autorisatie |
| Importcontrole/boekreview/escalaties | `book-import-followups.js` | Taken | Gedeeld eigenaarschap, escalatie en revisies |
| Account- en klasverzoeken | `student-management.js` | Taken → links naar Personen en klassen | Openstaande verzoeken, goedkeuringen en escalaties |
| Boek-/ParnasSys-import | `admin-book-import-review.js`, importpanelen | Importeren | Oude en nieuwe importflow, preview, cancel, herstel, twee beheerders |
| Beheerdersmail/ontvangers | `admin-mail-notifications.js` | Instellingen | Toevoegen, verifiëren, voorkeuren, verwijderen, foutstatus |
| Laatste activiteit en log wissen | `#history-panel` | Start | Updates, wissen met bevestiging, rolcontrole |

De gedeelde HTML-elementen worden voor Beheer verplaatst, niet gekopieerd.
Bij rolwisseling of uitloggen gaan ze terug naar de oorspronkelijke plek.
Serverroutes, rechten, importleases en concurrentiegedrag mogen niet veranderen.

## Auditpunten #291

- A01 en A02: bewerkformulier bereikbaar vanuit boekdetail; afbreken reset volledige clientstaat zonder opslag.
- A03: unieke fysieke exemplaar-ID zichtbaar naast barcode; zoeken/scannen op titel/code. Bij gelijke barcodes expliciete waarschuwing: een systeem-ID is geen vervanging voor een fysieke markering.
- A04 en A05: één catalogusingang en vaste navigatie naar overige taken.
- A06 en A07: gewone toegankelijke navigatieknoppen; pijltjes in echte subtabs en focuslus in het boekdetail.
- A09, A10, A11, A14, A15: uniforme velden, onderscheidende knoppen, leerlingen zoeken, passende rolkop en e-mailformulier.
- A13: ontbrekende boekomslag krijgt een visuele fallback.
- A16: schoolstatistiek bereikbaar op Start. Individuele en klasstatistieken volledig herontsluiten voor docenten behoort ook tot de volgende Docenten-PR.

## Gate voor gereedmelding

1. Eigen code-/rol-/functionele review compleet, inclusief conditionele staat en oude scripts.
2. `npm ci`, `npm audit`, volledige `npm test` en `npm run build` groen.
3. Testomgeving: alle bovengenoemde workflows met geïsoleerde fictieve data uitgevoerd.
4. Visuele screenshots bij bovengenoemde viewports gemaakt en vergeleken met v3.1.
5. Toetsenbord, formuliervalidatie, lege en foutstatussen gecontroleerd.
6. Alle Codex-reviewpunten inclusief P1 en P2 afgehandeld, opnieuw CI groen.
7. **Pas na uitdrukkelijk akkoord van eigenaar mergen; nooit vanuit deze PR productiegegevens bewerken.**

Deze matrix bevat de **vereiste controles**, niet de verklaring dat alle controles al zijn geslaagd.
