# Taakafhandeling: voorcontrole, fase 1

## Reikwijdte

Deze PR bevat uitsluitend de technische voorcontrole. Live aantallen,
operationele budgetinformatie en persoonsgegevens worden niet in de repository
opgeslagen. Voorbeelden in tests gebruiken fictieve registraties.

## Oorzaken in de code

- Fysieke uitstelrecords bevatten titel, auteur, ISBN, bestandsnaam en rij,
  maar geen betrouwbare relatie met het oorspronkelijke fysieke exemplaar.
  `possibleExistingEdition` is terecht alleen een aanwijzing.
- Deduplificatie gebruikte bestandsnaam/rij/titel/Excelnummer zonder import-ID.
  Een opnieuw gebruikte bestandsnaam kon daardoor een nieuwe melding verbergen.
- De opslag werd afgekapt met `slice(-1500)`, ook wanneer oude taken nog open waren.
- Administratieve taken bevatten soms alleen een algemene bronconflictreden.
  Een gelijk ISBN bewijst dan niet dat de oorspronkelijke oorzaak verdwenen is.
- De bestaande afhandelroutes vereisen een beheerder en revisie; ze worden door
  deze voorcontrole niet aangeroepen.

## Geleverde voorcontrole

`GET /api/admin/task-preflight` is alleen voor beheerders en uitsluitend lezend.
Elke beoordeling wordt opnieuw opgebouwd uit de huidige database. De interface
onder Taken > Overzicht ververst een eenmaal geopende voorcontrole elke 15 seconden
zolang zij zichtbaar is, en na de bestaande verversgebeurtenis.

Elke taak bevat brongegevens, beslisregel, bewijs, een actuele editieaanwijzing,
revisie, afhankelijkheden en eventuele voorgestelde actie. De uitvoercategorieën:

1. Veilig afsluitbare doublure of aantoonbaar eerder beoordeelde brongebeurtenis.
2. Voorstel dat nog beoordeling vereist, bijvoorbeeld een inmiddels aanwezige editie.
3. Aandacht of verder onderzoek nodig, waaronder ontbrekende exemplaren en latere uitleenactiviteit.

Er is geen correctieknop, schrijvende route, externe zoekactie, goedkeuringsbewijs
of automatische uitvoering. De fingerprint is een controlekenmerk, geen toestemming.
De pagina vermeldt expliciet dat nul wijzigingen zijn uitgevoerd en welke bronnen
buiten deze fase vallen. Gelijke ISBN's of rijnummers uit verschillende imports
zijn nooit voldoende voor automatische afsluiting.

Nieuwe fysieke taken behouden hun diagnostische codes. Dubbele emissie binnen
dezelfde import wordt voorkomen; verschillende imports en exemplaren blijven
behouden. Open en historische fysieke taken worden niet meer op aantal verwijderd.

## Nog te implementeren in afzonderlijke vervolg-PR's

- Aparte authenticatieopslag aansluiten voor overige accountverzoeken, zonder
  authenticatiegegevens naar de browser te sturen.
- Gerichte bronanalyse van oude generieke conflicten en het vergelijken van
  oorspronkelijke importverslagen met latere expliciete correcties.
- Onderzoek met betrouwbare metadata-aanbieders, met bronherkomst per veld,
  kostenbegrenzing en voorstellen bij tegenstrijdige bronnen.
- Serverzijdige toestemming per categorie en exacte taakselectie, met actuele
  herbeoordeling onder de schrijfvergrendeling, verval bij gewijzigde gegevens,
  volledige auditregistratie en idempotentie. Goedkeuring nooit afleiden uit een
  uitgevoerde preview of een eerdere algemene toestemming.
- Eerst uitsluitend taakstatuscorrecties. Wijzigingen aan uitleningen, personen,
  fysieke exemplaren en onomkeerbare gegevens vereisen afzonderlijke bevestiging.
- Uitgevoerd/ter goedkeuring/aandacht-overzicht gebaseerd op echte uitvoerlogs.

De brede visuele herontwikkeling maakt geen deel uit van deze PR.
