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


## Implementatiefase 1 (25 november 2026)
- Expliciete toestemming vóór het ophalen van een eigen recente afgeronde leeservaring en maximaal vijf zichtbare bewaarde favorieten.
- Dezelfde beperkte PIN-grant en volledige leerlingauthenticatie worden gebruikt; leerlingen mogen uitsluitend eigen context zien.
- Een gelezen boek wordt eerst beoordeeld; een favoriet wordt als interesse behandeld, niet als gelezen of positief beoordeeld boek.
- Een gekozen inhoudelijke voorkeur beïnvloedt aanbevelingen. De gekozen referentie zelf wordt niet opnieuw voorgesteld.
- De 49-vragenroute en verrassingsroute blijven beschikbaar. Zonder toestemming gebruikt de nieuwe interface geen bevestigde leesgeschiedenis.
- Nog niet geïmplementeerd: externe boekzoekopdracht/handmatige referenties, opgeslagen positieve en negatieve waarderingen, betrouwbare series, meerdere referenties en uitgebreide gespreksevaluatie. Niet mergen voordat deze onderdelen en volledige acceptatiecontrole klaar zijn.

## Implementatiefase 2: advies en vrije antwoorden
- Leerlingen kunnen eigen tekst invoeren of de bestaande keuzeopties gebruiken; maximaal 500 tekens. De server herkent uitsluitend gecontroleerde Nederlandse woorden en woordgroepen, contrast en eenvoudige ontkenningen. De leerling bevestigt de samenvatting vóór deze wordt gebruikt. Onzekerheid leidt tot verduidelijking of de keuzeopties, niet tot verzonnen begrip.
- Direct adviseren na bevestigde voorkeuren, eventueel minder dan drie als de collectie onvoldoende aantoonbare overeenkomsten heeft. Bekende ongewenste onderwerpen worden uitgesloten; nooit claimen dat een onderwerp zeker afwezig is wanneer metadata onvolledig is.
- Vrije tekst wordt niet opgeslagen of naar externe diensten verzonden. Alleen begrensde gestructureerde voorkeuren blijven in de lopende dialoog; het persoonlijke geheugen vereist afzonderlijke toestemming.
- Nog te bouwen: circa 250–400 inhoudelijk verschillende vragen, meerdere gespreksstrategieën, gewogen vraagselectie met relevantie, onderscheidend vermogen en versheid, herhalingsgeheugen per leerling (anoniem uitsluitend per sessie), adaptieve beëindiging zonder minimum aantal vragen, expliciete feedback en minimaal 10.000 simulaties met gemeten gespreksherhaling. Externe titels en series blijven open. Geen merge vóór volledige acceptatie.

## Gedragsgrenzen (25 november 2026)
- Eerste duidelijke belediging of manipulatieve opdracht: waarschuwing. Tweede duidelijke overtreding: keuzehulp geblokkeerd op accountniveau. Bij losse meme eerst neutrale heroriëntatie, bij herhaling waarschuwing. Normale taal en mnu (maakt niet uit), typefouten en onbegrepen antwoorden zijn geen overtredingen. Een bekende catalogustitel wordt niet op taalgebruik bestraft.
- Trends apart onderhouden: VRT https://www.vrt.be/nl/ketnet-voor-ouders/nieuws-van-ketnet-en-ketnet-junior/dit-zijn-de-kanshebbers-voor-het-kinderwoord-van-het-jaar (23-11-2026); NOS https://nos.nl/artikel/2594841-67-uitgeroepen-tot-kinderwoord-van-het-jaar-2025 ; Onze Taal https://onzetaal.nl/tijdschrift/online-artikelen/artikel/elke-generatie-een-eigen-taal-boekenweekthema-uitgediept .
- Om blokkade niet via uitloggen te omzeilen is een geverifieerd schoolaccount of beperkte PIN-grant verplicht voor de gehele keuzehulp; geen anonieme route meer. Persoonlijke leesgeschiedenis blijft vrijwillig. Catalogus, uitlenen en andere functies blijven toegankelijk. Dit vervangt de eerdere ontwerpkeuze voor anonieme gesprekken.
- Alleen actieve docenten die aan de huidige klas van de leerling gekoppeld zijn kunnen in leerlingdetails waarschuwingsstatus zien en vrijgeven. Geen generieke adminvrijgave, PIN-reset of herlogin als omweg. Server controleert actuele rechten opnieuw in de opslagtransactie. Geen ruwe chattekst in de database; alleen categorie, status, tijdstip en vrijgever. Geen automatische afloop. Nieuwe tests voor waarschuwing, blokkade, directe endpoints, andere leerling en mentorrechten; visuele controle en Codex verplicht.

## Correctie toegang: anonieme gesprekken blijven beschikbaar
- De eerdere verplichte identificatie vervalt. De leerling kiest zelf of die met PIN/schoolaccount of zonder inloggen begint. Bij anoniem gebruik gelden dezelfde gedragsregels, maar een tweede overtreding stopt het gesprek en geeft vijf minuten pauze voor anoniem gebruik in dezelfde browsersessie. Intussen is inloggen met eigen account/PIN mogelijk, mits dat account niet geblokkeerd is.
- Anonieme moderatie gebruikt een kortlevende willekeurige HttpOnly-cookie en begrensde servergeheugenstatus; geen leerlingkoppeling, IP-opslag, device fingerprint of blijvende registratie. Nieuw apparaat, gewiste cookies of serverherstart kan de tijdelijke beperking omzeilen. Permanente mentorblokkade geldt uitsluitend bij geverifieerde identiteit; een uitgelogde leerling kan als gast niet betrouwbaar herkend worden.

## Verfijning taal en adviesgesprek
- Meme-only herkenning normaliseert bekende woordvarianten, lachen, losse tussenwerpsels, emoji en herhaling; inhoudelijke leesvragen waarin een meme of getal voorkomt blijven neutraal. Geen willekeurige onbegrepen tekst als overtreding behandelen. Citaten en verslagen van pesten blijven voorzichtig beoordeeld; aanhalingstekens alleen zijn geen vrijstelling.
- Nederlandse leeswoordenschat uitgebreid met expliciete veelvoorkomende spelfouten, Engelse varianten en chattaal. Geen automatische gok op onbekende woorden of ontkenningen. Positieve herkenning wordt kort teruggekoppeld; keuze om direct te zoeken of inhoudelijk door te vragen. Negatieve voorkeuren expliciet laten bevestigen. Gerichte open vervolgvragen op basis van reeds bevestigde voorkeuren, zonder dezelfde vraag in een gesprek te herhalen. Volledige vraagbank en simulaties blijven aparte open acceptatiepunten.

## Advies vóór zoeken
- Een enkel breed genre is geen voldoende adviesprofiel. Open antwoorden leiden automatisch tot een gerichte vervolgvraag; synoniemen en herhalingen tellen niet als nieuwe informatie. Bij meerdere onafhankelijke voorkeuren kan direct advies volgen. Maximaal drie automatische open vervolgvragen; leerling kan een vervolgvraag overslaan en met de reeds bekende voorkeuren boeken bekijken. Negatieve voorkeuren blijven expliciet bevestigd. Vragen worden binnen het gesprek niet herhaald en krijgen recent gebruikte prompts lagere prioriteit in hetzelfde tabblad. Dit is een eerste begrensde heuristiek, nog geen volledige collectiegestuurde adviesplanner.

## Open-first thematische gespreksplanner
De server kiest een open vervolgvraag op basis van expliciete thema's, eerdere vragen, mogelijke verbanden en onderscheidende beschikbare metadata. Meerkeuzevoorbeelden horen bij dezelfde vraag en hebben gevalideerde antwoordmappings; ze verschijnen pas bij onzekerheid of op verzoek. Media- en titelverwijzingen zijn hypotheses, geen automatisch bewezen voorkeuren. Bij onvoldoende herkenning wordt eerst verduidelijkt en daarna worden voorbeelden aangeboden. Positieve antwoorden hoeven niet iedere keer samengevat te worden; expliciete uitsluitingen worden bevestigd. De planner bewaart tijdelijk alleen genormaliseerde gesprekssignalen; bij toestemming voor persoonlijke tips worden maximaal 40 vraag-ID's bij de bestaande aanbevelingshistorie bewaard (90 dagen), geen vrije tekst. Anonieme leerlingen krijgen geen blijvend profiel. Dit is een eerste thematische bank, geen volledige externe titel- of seriezoekmachine.

De voorkeur voor een bepaalde leeslengte komt alleen uit een expliciet antwoord; een hobby of een mediaverwijzing levert niet automatisch een leesvoorkeur op. De nieuwe open route is standaard bij interesseonderzoek; de bestaande knop voor uitsluitend meerkeuze blijft bereikbaar. De thematische bank bevat afzonderlijke vragen naar onder meer misdaad, psychologie, geschiedenis, relaties, techniek, natuur, sport en maatschappij. Vervolgvragen en voorbeeldopties gebruiken dezelfde herkennings- en metadatataal.

### Geautomatiseerde acceptatiecontrole
`tests/student-choice-conversation.test.js` gebruikt de echte gespreksplanner, valideert alle antwoordopties, toetst expliciete uitsluitingen, mediaverwijzingen, open feedback en onzekerheid, en voert 10.000 reproduceerbare synthetische gesprekken uit. Dit meet afhandeling, begrenzing en variatie, niet de natuurlijke ervaring van echte leerlingen. Resultaten pas als geslaagd beschouwen nadat CI ze heeft uitgevoerd.
