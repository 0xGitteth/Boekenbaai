# Help me kiezen: afgesproken functioneel ontwerp

Stand: 16 november 2026. Dit document bewaart de eerder afgesproken eisen zodat
de keuzehulp niet opnieuw wordt vereenvoudigd tot een vaste vragenlijst of filter.

## Doelgroep en doel

Leerlingen in het VSO, ook leerlingen die zelden lezen of nog niet weten wat
ze leuk vinden. De hulp moet aanvoelen als een natuurlijk gesprek dat ze
telkens opnieuw kunnen voeren. Geen externe generatieve AI: het gesprek
wordt lokaal bepaald uit gevalideerde vragen, eerdere antwoorden en de
daadwerkelijke catalogus.

## Begin en identiteitskeuze

- Bij niet ingelogd gebruik eerst natuurlijk vragen of de leerling wil inloggen.
  Een PIN mag in het invoerveld worden genoemd maar niet voortdurend in de
  gespreksteksten; knop **Inloggen**.
- Al ingelogde leerlingen krijgen automatisch persoonlijke suggesties; een
  tijdelijke PIN-toestemming is geen algemene, onbeperkte leerlingensessie.
- Exacte startvraag: **Wil je zelf ontdekken wat je leuk vindt, of zal ik je 3 boeken voorstellen?**
- Knoppen: **Ontdek mijn interesses** en **Laat me drie boeken zien**.
- Die tweede route geeft meteen drie voorstellen; geen verplicht vragenrondje,
  geen formulier en geen 'Stel me vragen'.

## Ontdek mijn interesses

- Een vraag tegelijk met korte, begrijpelijke antwoorden in natuurlijk
  Nederlands; de volgende vraag volgt aantoonbaar uit de vorige antwoorden.
- Grote vragenbank en telkens wisselende paden. Geen vaste vragenvolgorde.
- Begin bij herkenbare of denkbeeldige situaties, nieuwsgierigheid,
  conflicten en voorkeuren voor hoe gebeurtenissen verlopen. Vraag geen
  kennis van genres, auteurs of specifieke titels.
- Een hobby (gamen, sport, muziek) is **niet automatisch** een voorkeur voor
  boeken over die hobby. Vraag naar de belangstelling achter de activiteit,
  of gebruik die activiteit helemaal niet als vooronderstelling.
- Geen spoilers, geen inhoud van een specifiek bibliotheekboek verklappen.
- Geen standaardvraag over makkelijk lezen: dat is voor de school een
  afzonderlijk advies bij o.a. dyslexie/TOS, geen algemene voorkeurvraag.
- **Weet ik niet**, **overslaan** en **vorige vraag** zijn mogelijk, zonder
  dat een onbekend antwoord als een voorkeur wordt behandeld.
- Richtlijn: circa 4–7 vragen, flexibel eerder stoppen als drie goed
  onderbouwde aanbevelingen mogelijk zijn; niet onnodig doorgaan.
- Relevante invalshoeken: nieuwsgierigheid, beslissingen, omgeving,
  personages, spanning, tempo, sfeer, realiteit/waargebeurd,
  interesses, vertelstijl en conflicten.
- Een voorbeeld van de bedoelde vraagsoort: wat zou je spannender vinden,
  ontdekken dat iemand tegen je liegt of iets vreemds meemaken op een
  plek die je goed kent? Verschillende antwoorden rechtvaardigen
  verschillende vervolgrichtingen.

## Aanbevelingen en vervolg

- Altijd drie **bestaande** catalogusboeken waar mogelijk; geen verzonnen
  titels, geen aanbevelingen op basis van niet aanwezige uitgaven.
- Houd rekening met actuele uitleenstatus, favorieten, gelezen boeken en
  eerder getoonde aanbevelingen waar de leerling daar rechtmatig toegang
  toe heeft. Eerder als gelezen vastgelegde boeken worden niet opnieuw
  aanbevolen als nieuw.
- Dezelfde antwoorden hoeven niet dezelfde drie boeken op te leveren:
  voorkom herhaling over sessies en bied alternatieven wanneer een leerling
  verder wil zoeken.
- Motiveer suggesties op basis van **aantoonbare catalogusgegevens**;
  claim geen overeenkomende kenmerken zonder brongegevens.
- Vervolgmogelijkheden zonder opnieuw beginnen: meer voorstellen,
  andere richting, **Meer zoals dit** bij een gekozen boek, of eerdere
  aanbevelingen terugzien.
- Verrassingsroute: drie afwisselende boekvoorstellen, bij voldoende
  uitleenhistorie met variatie tussen veel geleend, weinig geleend en
  willekeurig. Geen vragen stellen voordat deze voorstellen verschijnen.

## Data en online boekverrijking

- De huidige catalogus is de enige basis; geen verzonnen verhaalinhoud.
- Geverifieerde ISBN-gegevens, tags, afgeleide thema's en beschrijvingen
  kunnen helpen een voorkeur aan een boek te koppelen.
- Bij weinig metadata blijft de hulp bruikbaar maar onderbouwde matching
  beperkt. De huidige vragenarchitectuur kan **voor** de nieuwe Excelimport
  worden gebouwd; **na** de import en gratis/Brave-verrijking moet de kwaliteit
  van de aanbevelingen met echte schoolboeken worden geëvalueerd.
- Niet elke beschrijving bevat een controleerbaar genre of thema. Woorden
  binnen andere woorden mogen niet als trefwoord worden behandeld.
- Privacy: anonieme gesprekken gebruiken uitsluitend openbare
  catalogusinformatie. PIN en leesgeschiedenis blijven strikt gescheiden
  tussen leerlingen.

## Implementatie in PR 402

`student-choice-dialogue.js` bevat 49 vraagvarianten op 11 invalshoeken.
De server selecteert telkens de volgende vraag op basis van voorkeuren,
beschikbare boekkenmerken en onderscheidende antwoordmogelijkheden.
`student-choice-recommendations.js` weegt alleen ondersteunde signalen,
ook wanneer metadata later via Brave wordt aangevuld.
`public/student-book-choice-chat.js` biedt het gesprek en de vervolgstappen.
De bestaande PIN-beveiliging, verrassing, anti-herhaling en detailweergave
blijven in gebruik.

Na daadwerkelijke boekimport en online verrijking:
1. Test voorstellen op echte boeken, inclusief boeken met weinig metadata.
2. Controleer hoe breed thema's en trefwoorden zijn ingevuld.
3. Verfijn de inhoudelijke koppeling indien boekprofielen belangrijke
   verschillen nog niet kunnen onderbouwen.
4. Houd de conversatiearchitectuur en eerder goedgekeurde Nederlandse
   formuleringen in stand; pas ze niet aan zonder expliciete aanleiding.
