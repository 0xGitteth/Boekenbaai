# PR6: opvolging onduidelijke klasgegevens uit boekimports

## Doel en grenzen

Na een gecontroleerde Excel-import kan klas- of bibliotheekcontext nog onduidelijk zijn, ook wanneer titel, ISBN, auteur en fysieke exemplaren wél veilig zijn vastgesteld. PR6 bewaart deze informatie als een afzonderlijke, blijvende taak bij een werkelijk fysiek boek. De import wordt dan pas als **volledig gecontroleerd** gemarkeerd als de benodigde opvolgtaken zijn afgehandeld.

De bestaande eisen voor echte ISBN's, fysieke barcodes, veilige voorraadmutaties en volledige identificatie van leerling- of klasleningen blijven gelden. Een onduidelijke *actieve uitlening* wordt in deze PR niet alsnog als een vrije uitlening geïnterpreteerd: zulke bronconflicten blijven geblokkeerd en moeten door de beheerder bij de bronreview worden opgelost. Alleen niet-contradictoire klas-, bibliotheek- en vaste-locatiecontext kan worden uitgesteld. Bij een bestaande editie zonder uniek aanwijsbaar fysiek exemplaar blijft inventarissynchronisatie geblokkeerd.

## Taakmodel

`bookImportFollowups` is een blijvende databasecollectie, onafhankelijk van het activiteitenlog (laatste 200) en de importverslagen (laatste 30). Elke taak verwijst naar één fysiek `bookId`, een import-`reportId`, de bron-Excelrij en optionele `classId`. Geen taak wordt per docent gekopieerd: collega's van dezelfde klas lezen en wijzigen dezelfde taak.

Een letterlijk en uniek overeenkomende bestaande klas krijgt de taak automatisch. Bij ontbrekende, verschillende of onbekende klassen gaat de taak naar beheer voor toewijzing. Er wordt geen klas op basis van gedeeltelijke tekst aangenomen. Beheerders kunnen een taak expliciet aan een bestaande klas koppelen.

Docenten kunnen na controle aangeven:

- **Voor de klas geleend**: historische klaslening, zonder verzonnen uitleendatum.
- **Uitgeleend aan een leerling**: alleen een actieve leerling van de toegewezen klas; de docent moet de leerling expliciet kiezen.
- **Staat vast in onze klas**: vaste fysieke locatie, zonder nieuwe uitlening.
- **Hoort niet bij onze klas**: terug naar beheer voor een nieuwe klasindeling.

Actieve uitleningen mogen nooit worden overschreven. Historische leningen krijgen ook het blijvende PR5-verwerkingskenmerk zodat een oude Excel-upload een later ingeleverd boek niet opnieuw uitleent. Een taak bewaart de stand van de duurzame `bookImportLoanActivityCounters` op het moment van import. Iedere gewone uitleen- en innameactie (ook een geforceerde inname bij het verwijderen van een leerling) verhoogt die stand. Een historische klas- of leerlinglening mag alleen worden bevestigd als de teller sindsdien gelijk is gebleven. Dit voorkomt het opnieuw activeren van een oude Excel-lening na een echte uitleen- en innameactie, zelfs wanneer de gewone activiteitenhistorie al is afgekapt. Het bevestigen van een vaste klaslocatie blijft toegestaan zonder uitleenstatus te wijzigen.

## Autorisatie en gelijktijdige acties

Docentenzichtbaarheid en schrijfrechten worden bij iedere API-aanroep afgeleid uit de actuele `classes[].teacherIds`. Een docent mag nooit beslissen voor een andere klas, ook niet met een direct HTTP-verzoek. Beheer heeft schoolbreed overzicht. Studenten en niet-ingelogde gebruikers krijgen geen toegang tot de taken of de leerlingenlijst voor keuzes. De publieke boeken-API bevat geen taken, bronklassen of uitleners.

Elke taak gebruikt een oplopende revisie. Na een beslissing van docent A kan docent B met de oude revisie geen tweede beslissing bevestigen. Ook gewijzigde klasrechten worden onmiddellijk meegenomen.

## Herinnering en escalatie

`bookImportFollowupSettings` bevat de centraal instelbare `reminderDays` en `escalationDays` (standaard 7 en 14, altijd escalatie later dan herinnering). De taakketting wordt bij iedere API-opvraag tegen de serverklok beoordeeld:

- Voor herinneringsdag: open en zichtbaar voor de betreffende klas.
- Vanaf herinneringsdag: in-app herinnering en badge.
- Vanaf escalatiedag: beheerderscontrole; de docent kan de taak niet meer afronden.
- Na expliciete herverdeling door beheer beginnen de termijnen voor de nieuwe klassentaak opnieuw.

Hier is geen mailverzending. E-mailherinneringen, verzending met deduplicatie en externe foutafhandeling horen bij PR7.

## Importverslagen

Elk nieuw verslag bevat `followupTasksCreated` en `fullyReviewed`. De laatste status wordt bij het ophalen van een verslag tegen de actuele taakcollectie berekend, zodat afronding door een docent direct zichtbaar is. Heruploaden maakt geen identieke taak voor hetzelfde fysieke exemplaar en dezelfde broncontext aan. Het herhalen van een bronbestand verandert geen reeds genomen docentbeslissing.

## Handmatige regressiecontroles

Controleer met twee docenten van dezelfde klas, een docent uit een andere klas en beheer: gedeelde taken, onjuiste klasrechten, tegelijk opslaan met stale revisie, onbekende klasse, keuze met leerling buiten klas, boek inmiddels uitgeleend, herinnering, escalatie, herverdeling, importverslag na voltooiing en leerlingenweergave zonder persoonsgegevens. Test zowel nieuwe import als incrementele synchronisatie, inclusief reeds bestaande fysieke exemplaren en herhaalde uploads.
