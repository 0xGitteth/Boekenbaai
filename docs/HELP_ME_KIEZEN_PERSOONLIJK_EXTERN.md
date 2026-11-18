# Help me kiezen: persoonlijke boekgesprekken en externe boeken
Status: ontwerp voor open draft PR (18 november 2026). Niet implementeren of mergen voordat de volledige functie inclusief tests klaar is.

## Doel
De bestaande 49 adaptieve vragen blijven beschikbaar als aanvullende vragenbank. De keuzehulp begint bij voorkeur met relevante, bevestigde leeservaringen van de ingelogde leerling, en stelt natuurlijke vervolgvragen op basis van expliciet gegeven antwoorden. Suggesties komen **uitsluitend uit de bestaande schoolcollectie**.

## Inlog en toestemming
- Ingelogde leerlingen kunnen kiezen om eerdere eigen leesgegevens voor aanbevelingen te gebruiken. Een PIN-grant is tijdelijk en beperkt tot die leerling.
- Anonieme leerlingen mogen op basis van een ingevoerd extern boek aanbevelingen krijgen, zonder persoonlijke leesgegevens of profielen te bekijken.
- Een gelezen of uitgeleend boek is **niet automatisch leuk gevonden**.
- Vastgelegde waarderingen blijven gescheiden van de uitleenadministratie en de examenleeslijst.
- Per leerling opslaan, wijzigen en wissen van expliciete voorkeuren; geen namen, PIN, accountgegevens of leenhistorie naar externe boekdiensten sturen.

## Dynamische opening
1. Heeft de leerling een recent uitgelezen boek met betrouwbare titel/ISBN, vraag op natuurlijke wijze of het beviel en waarom.
2. Heeft de leerling al een expliciet positief beoordeeld boek, bied vervolgvragen aan op dat boek, of een nieuwe richting.
3. Heeft de leerling geen relevante bevestigde historie, vraag of er buiten Boekenbaai een boek is dat hij leuk vond; alternatieven zijn meteen drie suggesties of interesses ontdekken.
4. Stop met doorvragen zodra drie aantoonbaar passende boeken gevonden kunnen worden; overslaan, teruggaan, andere richting en meteen voorstellen blijven beschikbaar.

## Externe boeken
- Zoek eerst in de bestaande collectie op titel/auteur/ISBN.
- Zoek daarna desgewenst server-side via bestaande gratis boekmetadatabronnen (Google Books, Open Library), met gebruik van dezelfde throttling, limieten en caching die de verrijkingsarchitectuur hanteert.
- Laat bij ambiguïteit leerling een titel, auteur of editie bevestigen. Bij storing of geen match: handmatige titel/auteur en voorkeuren blijven mogelijk.
- Externe zoekresultaten toevoegen aan een apart persoonlijk referentieprofiel, **niet** als fysiek exemplaar of uitlening in de schoolcollectie.
- Scherm onbetrouwbare categorieën, beschrijvingen en ISBN-conflicten af; verzin nooit inhoud, seriebanden of leesstatus.
- Externe zoekvraag bevat uitsluitend boekinformatie, geen leerlingidentiteit.

## Voorkeuren en aanbevelingen
- Vraag wat de leerling waardeerde: bijvoorbeeld spanning, personages, keuzeconflicten, vriendschap, wereld, tempo of sfeer. Leg ook expliciete afkeuren vast; niet-uitgelezen ≠ afgekeurd.
- Geef aanbevelingen op basis van verifieerbare boekkenmerken, per antwoord en eventueel meer dan één referentieboek.
- Een positieve reactie op een fantasyboek is niet genoeg om alle fantasyboeken als passend te kwalificeren. Zoek naar de bedoelde inhoudelijke eigenschappen.
- Vergelijk desgewenst twee positieve voorbeelden of positieve en negatieve voorbeelden, met een korte vervolgvraag.
- Geef alleen daadwerkelijk aanwezige schooltitels, liefst direct beschikbare exemplaren; markeer niet-beschikbaarheid correct. Herhaal geen reeds bevestigde gelezen werken.
- Motiveer elke suggestie met kenmerken die in de catalogus of het antwoord van de leerling staan. Bij weinig metadata: neutrale, eerlijke uitleg.
- Feedback op voorgestelde boeken (interessant, al gelezen, niet passend, reden) beïnvloedt volgende suggesties binnen dezelfde sessie en, met instemming, latere sessies.

## Series
- Bewaar seriegegevens afzonderlijk van gewone titels, per werk/uitgave met betrouwbare bron en volgnummer.
- Controleer welke delen de leerling aantoonbaar heeft gelezen en welke delen mogelijk alleen uitgeleend zijn; vraag twijfelgevallen na.
- Stel geen reeds gelezen deel voor; bied het passende volgende deel alleen aan als dit daadwerkelijk in de schoolcollectie staat en de serievolgorde voldoende zeker is.
- Voorbeelden als Harry Potter of The Lord of the Rings zijn uitsluitend gespreksscenario's, geen garantiekoppelingen.

## Veiligheid en acceptatie
- Geen wijziging van uitleenstatus, leenhistorie, gelezen-antwoorden of examenstatus door de keuzehulp.
- Geen blootstelling van de leesgegevens van andere leerlingen via API, logging of zoekopdrachten.
- API's verifiëren de leerling opnieuw voor iedere persoonlijke leesprofielactie; voor anonieme gebruikers geen profielinzicht.
- Tests op: ontbrekende of verouderde historie; afwijzing en positieve feedback; external search fout/geen match; twee edities; seriedelen; persoonsgegevens; anti-herhaling; zonder internet; verschuivende beschikbaarheid; 49-vragen fallback; prestaties.
- Vóór merge: volledige tests en Codex-review. Vervolgens visuele controle met een echte leerling- en mentoraccount, zonder testmutaties in productie.

Deze draft registreert het afgesproken ontwerp; daadwerkelijke implementatie volgt in dezelfde PR.
