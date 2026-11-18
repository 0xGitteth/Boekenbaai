# Automatische taakafhandeling, fase 2

## Status
- Dit is de **conceptvervolg-PR #416** bovenop de voorcontrole in PR #415.
- **Geen productiecorrecties en geen merges** zolang de werkelijke beheerinterface niet is gecontroleerd.
- Geen automatische betaalde Brave-opdrachten, boekmutaties, uitleningscorrecties, leerling- of docentwijzigingen.
- CI kan vanuit GitHub worden uitgevoerd zonder een Codex-review; Codex slechts eenmaal op de afgeronde wijziging, na controle.

## Probleem en bewijs

De import bewaart voor een overgeslagen Excelrij doorgaans **één uitgestelde melding per bronrij**, met `batchId`, `worksheetRow`, titel, auteur, identifier, editie-ISBN en `sourceEvidence`. Een fysiek `bookId` bestaat daarbij vaak nog niet.

Een ISBN is een editie-identiteit en geen bewijs dat twee fysieke exemplaren gelijk zijn.
Ook twee dezelfde Excelrijen in verschillende imports mogen niet samenvallen.

De voorcontrole bouwt een volledige brongebeurtenissleutel uit:
`batchId`, Excelrij, titel, auteur, Excelidentifier, editie-ISBN, boek-ID indien aanwezig, barcode indien aanwezig en de originele diagnostische gegevens.

**Toegestaan voor taakstatusopschoning**:
- Twee openstaande meldingen hebben aantoonbaar dezelfde brongebeurtenissleutel **uit dezelfde import**: de originele melding blijft open, uitsluitend de tweede notificatie kan worden afgesloten.
- Dezelfde brongebeurtenis heeft een `manual_done`-afhandeling met een exact overeenkomende bestaande auditregistratie: de achterhaalde melding mag worden afgesloten.
- Wanneer er een `bookId` is vastgelegd, moet dat boek-ID uniek in de huidige collectie zijn. Als die koppeling ontbreekt, is dubbele bronmelding nog steeds vaststelbaar zonder een fysieke kopie gelijk te stellen, mits `batchId` en rijidentiteit volledig betrouwbaar zijn.

**Niet toegestaan**:
- Samenvoegen enkel op ISBN, auteur, titel, bestandsnaam, volgnummer of Excelrij over verschillende imports.
- Een bronconflict als opgelost behandelen omdat de editie inmiddels in de collectie staat.
- Uitleningen, leenhistorie, klaslocaties, personen, fysieke exemplaren of metadata wijzigen.
- Een origineel openstaand probleem afsluiten in plaats van alleen de overbodige notificatie.
- Afhandelen zonder actuele voorcontrole, expliciete bevestiging of adminrechten.
- Een ongewijzigde oude voorcontrole uitvoeren nadat brongegevens of taakrevisies veranderd zijn.

## Technische uitvoering

1. `GET /api/admin/task-preflight` blijft uitsluitend lezend.
2. De beheerder selecteert concrete veilig afsluitbare meldingen, maximaal 50 per bewerking.
3. De UI toont een afzonderlijke bevestigingsvraag. Het verzoek bevat exacte taak-ID's, revisies, `scope`, eenmalige bevestiging, voorcontrolehash en een operatie-UUID.
4. `POST /api/admin/task-preflight/execute` is alleen toegankelijk voor een actieve beheerder. De handler laadt de nieuwste database **binnen de bestaande gedeelde schrijfvergrendeling**.
5. De server maakt de voorcontrole opnieuw, controleert de hash, kandidaatregels, taakrevisies, originele meldingen en bronidentiteiten. **De volledige selectie moet vooraf slagen.**
6. Alleen taakstatus, revisie, resolutie en auditlog worden veranderd. De database wordt atomair vastgelegd. Een fout laat de selectie volledig ongewijzigd.
7. Elke uitvoering krijgt een operatie-ID. Dezelfde aanroep kan na netwerkuitval idempotent herhaald worden, zonder een tweede wijziging.
8. `GET /api/admin/task-preflight/history` toont een beperkte auditweergave. De bronregistratie en volledige audit blijven bewaard.
9. De bestaande taakmodules krijgen na een succesvolle afsluiting een verversbericht.

Een eerder gelezen fingerprint is **geen toestemming**. De server accepteert slechts de expliciet aangewezen categorie en concrete taakselectie.

## Regressietests

De verplichte `npm test` omvat:
- Dubbele brongebeurtenis in één import, met en zonder fysiek boek-ID.
- Dezelfde ISBN-editie met verschillende imports of verschillende exemplaren.
- Ontbrekende of dubbele interne boek-ID's.
- Eerdere handmatige afhandeling met en zonder auditbewijs.
- Ontbrekende of ongeldige bevestiging, verkeerd recht, wijziging van bron of revisie.
- Onjuiste selectie, meer dan 50 meldingen en verondersteld onveilig exemplaar.
- Een batch waarbij één item onveilig is: nul statusmutaties.
- Eenmalige uitvoering, foutafhandeling en herhaalde operatie-ID.
- HTTP-autorisatie, atomair opslaan en behoud van boek, leerling en uitleengegevens.

## Nog niet opgelost

- Administratieve conflicten en oude leenhistorie rechtstreeks corrigeren.
- Automatisch onderzoeken of een latere import de oorspronkelijke oorzaak heeft weggenomen, **zonder** een andere fysieke kopie of historische uitleenactie te verwarren.
- Klas- en accountcontroles met bronbewijs uit gescheiden authenticatieopslag.
- Externe metadata-verrijking en herkomst per veld.
- Door de beheerder configureerbare blijvende toestemming per veilige taakcategorie; **niet** stilzwijgend ingeschakeld door een eerdere voorcontrole.
- Werkelijke productiecontroles en visuele gebruikerstest in de Cloud Browser.

## Voor de volgende ronde

1. Controleer PR #415 en deze concept-PR #416. Laat #415 eerst mergen wanneer de beheerpagina is gevalideerd.
2. Richt #416 daarna op `main`, voer CI opnieuw uit en laat **één** Codex-eindreview uitvoeren, niet één review per commit.
3. Controleer de interface in Work en test met fictieve of alleen lezende voorbeelden vóór productiecorrecties.
4. Combineer het volgende onderzoek naar verouderde administratieve taken in een volgende afgebakende PR; voer geen reële wijziging uit zonder expliciete toestemming waar bewijs onvoldoende is.
