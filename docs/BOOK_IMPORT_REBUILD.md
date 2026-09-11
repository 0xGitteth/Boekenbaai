# Boekenbaai boekimport: vaste afspraken en 7-PR-roadmap

Dit document is de blijvende projectbron voor de herbouw van de boekimport. Lees dit in een nieuwe Boekenbaai-sessie vóór vervolgwerk.

## Vaste ontwikkelwerkwijze

- Eén logisch afgebakende PR tegelijk. Geen werk uit latere PR's alvast half meenemen.
- Nooit rechtstreeks naar `main` schrijven.
- Bestaande data en flows backwards compatible houden, tenzij de PR bewust iets verandert.
- Eerst lokaal: implementatie, gerichte regressietests, beschikbare brede tests en een adversariële eigen review. Zoek ook naar tweede-orde fouten, verwante foutcategorieën, privacy, idempotency, retries, oude data en regressies buiten de happy path.
- Een push naar een open PR start automatisch Codex-review en kost reviewcapaciteit. GitHub is daarom geen iteratieve ontwikkelomgeving. Codex-review nooit handmatig aanvragen.
- Push pas wanneer de PR zelf als eindversie wordt beschouwd en Codex naar verwachting geen inhoudelijke finding meer heeft.
- Vóór push moeten de exact geteste lokale bestanden byte-identiek zijn aan de Git-blobs/commit die worden gepusht.
- Na de uiteindelijke push: volledige CI en automatische Codex-review. Codex is alleen de tweede-lijns eindoordeler.
- Bij een finding: oorzaak en hele foutcategorie onderzoeken, niet alleen één regel repareren. Daarna opnieuw lokaal testen/reviewen; pas daarna eventueel één nieuwe eindpush.
- Merge alleen bij groene CI en zonder relevante open reviewbevindingen.
- Geen ongerelateerde code, styling of gedrag meenemen.
- Bij onzekere brondata expliciet conflict/beheerderskeuze gebruiken in plaats van stil gokken.

## Vaste domeinregels

### Boekidentiteit

- De schoolcollectie hoort ISBN-boeken te bevatten. Een ongeldig ISBN is daarom in beginsel een bronfout, niet automatisch een interne barcode.
- ISBN-10 en het equivalente ISBN-13 zijn dezelfde editie. Alleen checksum-geldige ISBN-10 of ISBN-13 met 978/979-prefix is officiële editie-identiteit. Een willekeurige EAN-13 is geen ISBN.
- De fysieke barcode bepaalt nooit stil de editie. `metadataIsbn`/het echte editie-ISBN is nodig wanneer buitenbarcodes gedeeld worden.
- Zelfde editie-ISBN + hetzelfde werk = meerdere fysieke exemplaren. Zelfde ISBN + verschillende titels = conflict. Verschillende geldige ISBN's blijven aparte edities/cards.
- Tegenstrijdige geldige ISBN-velden op één record zijn een conflict, geen prioriteitskeuze.
- Oude records met historische/ongeldige identifiers blijven via een veilige legacy-identiteit bruikbaar. Te weinig identiteitsbewijs wordt unresolved, niet gegokt.
- Leenstatus, leerling, klas en fysieke locatie zijn nooit onderdeel van editie-identiteit of matchkeys.

### Auteurs en metadata

- `Voornaam schrijver` + `Achternaam schrijver` worden bij import samengevoegd. Een ontbrekende voornaam blokkeert niet; metadata mag aanvullen.
- Meerdere auteurs moeten gestructureerd bewaard kunnen worden; `author` blijft als backwards-compatible weergavenaam.
- Auteurgrenzen mogen in identity keys niet verloren gaan. Naamvoorvoegsels blijven normaal leesbaar.
- `nvt` wordt niet als echte auteur geaccepteerd als de werkelijke auteur gevonden kan worden.
- Een rij met ontbrekende titel/auteur/ISBN wordt niet vooraf weggegooid. Eerst betrouwbaar proberen te reconstrueren.
- Excel en externe metadata worden niet blind boven elkaar gesteld. Echte verschillen worden zichtbaar en zo nodig door beheer opgelost. Veldherkomst moet rapporteerbaar blijven.

### Excelbetekenissen

- `Makkelijk lezen?`: elke niet-lege waarde betekent ML; onverwachte tekst mag daarnaast waarschuwing geven.
- `Examenmateriaal = Ja`: geschikt voor staatsexamenleeslijst.
- `Strip`: niet examenmateriaal, wel naar passend strip/format-kenmerk.
- `Engels`: niet examenmateriaal; taal waar betrouwbaar mogelijk Engels.
- `eigen boek`: docent-eigendom, niet importeren in schoolcollectie.
- `vast in de klas` en `Klassenboek`: schoolbibliotheekboek met vaste fysieke klaslocatie, nog steeds uitleenbaar.
- Echte leerlingnaam: huidige leerlinglening. Match ook bestaande schoolaccounts die nog nooit ingelogd hebben; dubbele naam = keuze beheer.
- `Geleend door klas`: kan klassikale lening betekenen. Vaste locatie en klassikale lening zijn verschillende concepten.
- `Klassen` niet vooraf gokken; bij onduidelijkheid beheer/docent laten bepalen.
- Duidelijke rommelrijen zoals alleen `hh` mogen stil worden overgeslagen. Alternatieve kolomnamen slim herkennen.

### Synchronisatie en privacy

- Herupload moet eerdere import herkennen en mag voorraad niet verdubbelen. Nieuwe upload vergelijken met vorige import én huidige database.
- Afwezige boeken of lagere aantallen nooit stil verwijderen; zichtbaar voorstel/conflict, uitgeleende exemplaren beschermen.
- Eerst preview met automatische reparaties, waarschuwingen, conflicten en per-rij correctie; daarna pas toepassen en rapporteren.
- Leerlingen zien bij andermans uitlening alleen beschikbaar/niet beschikbaar. Andere leerlingnamen, klassen en `borrowedBy`/`borrowedByClassId` worden server-side niet aan leerlingclients geleverd. Eigen leningen blijven zichtbaar.
- Docent ziet alleen relevante eigen klas(sen); beheer ziet alles.

## Roadmap: zeven PR's

### PR 1: editie-identiteit en model-fundering

Bouw centrale ISBN-equivalentie, conflictveilige editie-identiteit, backwards-compatible `author` + `authors`, veilige legacy-fallback, fysieke-exemplaargroepering en regressietests. Houd persoonsgegevens uit identity keys.

Waarom apart: alle latere import/sync/leenlogica moet exact dezelfde definitie van editie en exemplaar gebruiken. PR1 verandert nog geen dagelijkse import- of leenflow.

### PR 2: slimme importanalyse zonder databasewijziging

Lees Excel, herken/map kolommen, combineer auteurs, classificeer speciale waarden, valideer/herstel ISBN, zoek ontbrekende metadata, herken duplicaten/gedeelde codes/conflicten en interpreteer `Klassen`, `Geleend door klas` en `naam leerling` zo ver als betrouwbaar. Resultaat is staged analyse; nog niets opslaan.

Waarom apart: broninterpretatie is het grootste risico en moet volledig testbaar zijn zonder de bibliotheek te muteren.

### PR 3: preview, correcties en gecontroleerd toepassen

Beheerpreview met automatisch opgelost, waarschuwing, conflict, overslaan en veldherkomst. Beheer kan per rij corrigeren/kiezen. Pas na bevestiging boeken toevoegen/bijwerken en een per-rij importverslag bewaren.

Waarom apart: analyse en mutatie blijven twee veiligheidslagen; verkeerde aannames zijn vóór opslag corrigeerbaar.

### PR 4: incrementele inventarissynchronisatie

Importbatches/snapshots vergelijken met vorige upload en actuele database. Reeds geïmporteerde edities en aantallen herkennen; alleen echte wijzigingen voorstellen. Onderscheid `nieuwe boeken toevoegen` en `inventaris synchroniseren`. Geen stille verwijdering van ontbrekende/uitgeleende exemplaren.

Waarom apart: eerste import en herhaalde inventarissync zijn verschillende operaties; simpele rij-toevoeging veroorzaakt anders duplicaten.

### PR 5: docentleenflow, klaslening, vaste locatie en privacy

Bestaande leerlingleningen overnemen. Docent kan een boek scannen/openen en kiezen `Aan leerling` of `Voor klas`; leerling kan uit eigen klas worden gekozen zonder eerdere login. Klassikale lening krijgt eigen status/koppeling. `vast in de klas`/`Klassenboek` wordt vaste fysieke locatie, los van uitleenstatus. Docentportaal toont individuele en klassikale leningen van eigen klas(sen). Backend dwingt bovenstaande privacygrenzen af.

Waarom apart: circulatie raakt dagelijkse werking en persoonsgegevens en hoort pas op betrouwbare identiteit/sync te bouwen.

### PR 6: opvolgtaken na import

Ambigue klascontext wordt taak voor juiste mentor/docent. Per boek keuzes: `Voor de klas geleend`, `Uitgeleend aan een leerling`, `Staat vast in onze klas`, `Hoort niet bij onze klas`. Eén afhandeling geldt voor alle docenten van dezelfde klas. Toon als taakoverzicht/badge, niet als losse melding per boek. Na instelbare termijn in-app herinnering; daarna automatische escalatie terug naar beheer. Import/sync is pas `volledig gecontroleerd` als verplichte opvolging klaar is.

Waarom apart: context die mensen beter weten moet niet door steeds agressievere heuristiek worden gegokt; escalatie voorkomt half-afgeronde inventaris.

### PR 7: e-mailherinneringen en afronding

Herinneringsmail naar bekend schoolmailadres voor open docenttaken. Alleen noodzakelijke informatie, geen onnodige leerlinggegevens; link naar afgeschermd takenoverzicht. Termijnen centraal configureerbaar. Bescherm tegen dubbele mails bij retries/workers; mailfouten blokkeren de taak niet. End-to-end tests van import tot docentcontrole, herinnering, escalatie en afronding.

Waarom apart: mail is een externe actie met eigen privacy-, retry- en foutgedrag en hoort pas bovenop een stabiele taakflow.

## Buiten PR 1

PR1 verandert bewust nog niet de bestaande Excel-importendpoint, concrete Excelinterpretatie, database-mutatie bij upload, leen/inleveracties, docent/mentoropvolging, e-mailverzending of bestaande UI. Latere PR's sluiten de PR1-kern gecontroleerd aan.
