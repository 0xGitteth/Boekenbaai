# Boekenbaai

Boekenbaai is een vrolijke webapplicatie voor de schoolbibliotheek van VSO Het Dok. Leerlingen loggen met hun eigen account in om met een barcodescanner of handmatig boeken in- en uit te checken, terwijl docenten vanuit een afgeschermd portaal zicht houden op de collectie.

## Functionaliteiten

- 📚 **Boekbeheer** – overzicht van alle boeken met map, status en tags.
- 🧑‍🎓 **Leerlingzone** – leerlingen loggen veilig in, zien hun eigen uitleenlijst en kunnen direct scannen.
- 👩‍🏫 **Docentenportaal** – log in om boeken te filteren, klassen te beheren en te zien wie welke titel heeft.
- 🗂️ **Mappenbeheer** – groepeer boeken in mappen (bijvoorbeeld leeslijst of vrije keuze).
- 🧾 **Activiteitenlog** – de laatste uitleningen en inleveringen blijven zichtbaar voor medewerkers.
- 🛠️ **Beheeromgeving** – beheerders voegen rechtstreeks nieuwe boeken toe.
- 📥 **Excel-import** – beheerder uploadt een Excelbestand om leerlingaccounts in bulk aan te maken of te updaten.

## Ontwikkelen

```bash
npm install
npm run build   # bouw de frontend met Vite
npm start       # laadt de auth/security-preloads en start daarna de Node-server
```

De server kiest automatisch de map `dist/` zodra je een build hebt gedraaid. Zonder build worden de bestanden direct uit `public/` geserveerd, zodat je lokaal snel kunt ontwikkelen.

## Deployen op Sliplane

1. Installeer de gelockte dependencies met `npm ci`.
2. Bouw de frontend met `npm run build`.
3. Laat Sliplane de app starten met **`npm start`**. Gebruik geen override naar `node server.js`: `npm start` laadt eerst de beveiligings- en Google-authpreloads die bij de productie-login horen.
4. Koppel een persistent volume aan de container en zet `BOEKENBAAI_DATA_PATH` bijvoorbeeld op `/data/db.json`.
5. Configureer de Google OAuth-variabelen en redirect zoals beschreven in [`GOOGLE_AUTH_SETUP.md`](./GOOGLE_AUTH_SETUP.md).
6. Gebruik `BOEKENBAAI_ALLOWED_ORIGINS` alleen als een aparte frontend-origin echt nodig is en zet dit niet breed op `*` voor productie.

### Boekomslagen en back-ups

Gevonden omslagen en door beheerders ingevoerde externe afbeeldingslinks worden, waar bereikbaar en toegestaan, als origineel bestand opgeslagen in de map `covers/` naast `BOEKENBAAI_DATA_PATH` (bijvoorbeeld `/data/covers/`). Neem **zowel `db.json` als de volledige map `covers/`** mee in back-ups en bij migraties. De oorspronkelijke externe URL blijft bewaard als terugvaloptie.

Een gecontroleerde Excelimport hoeft niet op alle downloads te wachten: de server bewaart de boekrecords eerst en slaat ontbrekende omslagen daarna met maximaal vier parallelle opzoekacties op. Na een herstart worden nog ontbrekende afbeeldingen opnieuw geprobeerd. Een losse beheerlink moet juist tijdens het opslaan bereikbaar en veilig zijn; bij een ongeldige of onbereikbare link wordt de boekwijziging geweigerd.

Tijdelijke downloadstoringen worden met oplopende wachttijden opnieuw geprobeerd. De server ruimt periodiek omslagen op die niet meer in gebruik zijn en minstens 24 uur niet zijn gewijzigd. Gedeelde bestanden blijven bestaan zolang minimaal één boek ernaar verwijst.

De 2:3-omslagweergave toont standaard de volledige afbeelding zonder bijsnijden. Beheerders kunnen optioneel verschuiven en zoomen; die uitsnede wordt als herroepbare weergave-instelling opgeslagen. Externe beeldrechten en eventuele bronvoorwaarden blijven van toepassing op lokaal opgeslagen afbeeldingen.

### Betrouwbare database- en Google-opslag

Boekenbaai bewaart `db.json` en de Google-authopslag als JSON-bestanden op het persistente volume. Mutaties gebruiken een gedeelde bestandslock en weigeren een verouderde momentopname (HTTP 409), zodat een gelijktijdige wijziging niet ongemerkt wordt overschreven. Beheerders kunnen het verzoek in dat geval opnieuw proberen **na controleren van de nieuwste gegevens**; herhaal nooit automatisch onzekere uitleen-, import- of mailacties.

De gedeelde lock en hersteljournal worden naast `db.json` opgeslagen. Verwijder `.database-write.lock`, de `.guard`-bestanden of `.paired-store-journal.json` **niet handmatig**: na een onderbroken dubbele write gebruikt de server het journal voor herstel bij de volgende start. Maak vóór ingrijpende deployments een back-up van het complete persistente volume, inclusief het databestand, de authopslag, de eventuele hersteljournalen en de map `covers/`.

Deze bestandstransacties vereisen dat alle schrijvende serverprocessen **hetzelfde gedeelde, vergrendelbare volume** gebruiken. Meerdere services met gescheiden volumes zijn hiermee niet veilig als één gezamenlijke database in te zetten.

### Belangrijke omgevingsvariabelen

| Variabele | Voorbeeldwaarde | Omschrijving |
| --- | --- | --- |
| `BOEKENBAAI_DATA_PATH` | `/data/db.json` | Locatie van het JSON-databestand op het persistente volume. De repository bevat voorbeelddata; controleer dat productie niet afhankelijk is van publiek bekende demo-credentials. |
| `BOEKENBAAI_AUTH_DATA_PATH` | `/data/db.json.auth.json` | Optionele aparte locatie voor Google-koppelingen en persistente sessies. Zonder deze variabele gebruikt Boekenbaai automatisch `<BOEKENBAAI_DATA_PATH>.auth.json`. |
| `BOEKENBAAI_GOOGLE_CLIENT_ID` | `<Google OAuth client-id>` | OAuth-client voor de schoollogin. |
| `BOEKENBAAI_GOOGLE_CLIENT_SECRET` | `<Google OAuth client-secret>` | OAuth-secret; alleen in Sliplane/secret storage bewaren. |
| `BOEKENBAAI_GOOGLE_DOMAIN` | `koraaledu.nl` | Exact toegestane Google Workspace-domein. |
| `BOEKENBAAI_PUBLIC_URL` | `https://boekenbaai.sliplane.app` | Publieke same-origin productie-URL, gebruikt voor OAuth en securitychecks. |
| `BOEKENBAAI_STATIC_DIR` | `/app/dist` | Overschrijft de map van waaruit statische assets worden geserveerd. Standaard gebruikt de server `dist/` (na build) en anders `public/`. |
| `BOEKENBAAI_PUBLIC_API_BASE` | `https://boekenbaai.sliplane.app` | API-base voor een eventueel apart gehoste statische frontend. De huidige Google-login is ontworpen en getest voor de same-origin Sliplane-app. |
| `BOEKENBAAI_ALLOWED_ORIGINS` | `https://jouwnaam.github.io` | Komma-gescheiden expliciete origins voor toegestane cross-origin API-verzoeken. Gebruik geen wildcard voor productie. |
| `BOEKENBAAI_IMPORT_ENRICH_ISBN` | `true` | Zet op `true` om tijdens Excel-boekimport automatisch ontbrekende velden aan te vullen met ISBN-metadata. Kan per import worden overschreven met de payload-flag `enrichIsbn`. |
| `BOEKENBAAI_ENABLE_ISBNBARCODE` | `true` | Zet op `true` om naast Open Library ook de ISBNBarcode.org API te raadplegen voor boekmetadata. Standaard staat alleen Open Library aan. |
| `BOEKENBAAI_EASYCB_CONTACT` | `bibliotheek@example.org` | Optioneel contactadres dat EasyCB vereist voor automatisch herhaald gebruik. Zonder geldig adres geen EasyCB-verzoeken. Dit is geen betaalde API-sleutel en verstuurt geen e-mail. |
| `BOEKENBAAI_BRAVE_API_KEY` | `alleen op de server` | Optionele geheime Brave Search-API-sleutel. Zet deze uitsluitend als omgevingsvariabele op Sliplane. Zonder sleutel is Brave uit; toestemming en voortgang blijven zichtbaar. |
| `BOEKENBAAI_BRAVE_MONTHLY_CAP` | `600` | Optioneel lager maximum voor Brave-verzoeken vanuit Boekenbaai. Standaard 900, technisch nooit hoger dan 900 per UTC-kalendermaand. |
| `BOEKENBAAI_ISBN_CACHE_TTL_MS` | `300000` | Tijd (in milliseconden) dat ISBN-metadata in het in-memory cache blijft staan. Resultaten – ook "niet gevonden" – verlopen standaard na 5 minuten. |
| `DEPLOY_TARGET` | `gh-pages` | Gebruik deze tijdens het bouwen (`DEPLOY_TARGET=gh-pages npm run build`) om de Vite-base op `/Boekenbaai/` te zetten voor GitHub Pages. |

> **Belangrijk:** zowel `/data/db.json` als het auth-bestand moeten op persistent storage staan. Test dit na configuratie met een redeploy: bibliotheekdata, Google-koppelingen en onthouden sessies mogen niet terugvallen op de repositoryseed.

> **Beheeraccount:** `Boekenbaai Beheer` blijft bewust lokaal en krijgt geen Google-account. Gebruik in productie een sterk uniek wachtwoord. Als de productie-database ooit uit de publieke voorbeelddata is ontstaan, controleer dan dat het oorspronkelijke demo-/seedwachtwoord niet meer actief is.

De server probeert boekinformatie standaard eerst op te halen bij Open Library. Wanneer `BOEKENBAAI_ENABLE_ISBNBARCODE=true` staat, wordt daarna als fallback een verzoek naar ISBNBarcode.org gedaan en blijft de bestaande barcode-parser actief. De resultaten worden tijdelijk in een in-memory cache opgeslagen (standaard 5 minuten). Parallelle verzoeken naar dezelfde ISBN worden gecoördineerd zodat er maximaal één upstream-lookup tegelijk actief is. Omdat de cache alleen in het serverproces leeft, wordt deze gewist bij een herstart.

### Gecontroleerde Excelimport: gewone import of administratie corrigeren

De beheerder kiest vóór het uploaden de importsoort. De **gewone boekimport** behoudt de bestaande werkwijze: nieuwe boeken of ontbrekende fysieke exemplaren toevoegen, met een aparte optie om de huidige voorraad op ISBN te vergelijken. Een ontbrekende titel, leerling of klas in Excel is **nooit** automatisch een verwijder- of inleveropdracht.

**Administratie corrigeren** is een afzonderlijke, expliciete handeling voor al bestaande exemplaren. Deze modus haalt geen nieuwe ISBN-metadata op en voegt geen boeken toe. Boekenbaai koppelt een Excelrij uitsluitend aan één herkenbaar fysiek exemplaar: bij meerdere exemplaren van dezelfde editie is een individuele exemplaarbarcode vereist. Per verschil zie je de huidige registratie en de Excelwaarde. Je kiest voor **corrigeren**, **behouden** of **later controleren**. Onzekere identificaties kunnen niet automatisch worden toegepast.

Een leeg leerling- of klasveld betekent *onbekend*, nooit *automatisch ingeleverd*. Alleen een afzonderlijk bevestigde administratieve correctie kan een onjuiste actieve registratie beëindigen. Dit is geen echte inlevering: leesantwoorden en de bestaande uitleengeschiedenis blijven intact. Als een uitlening naar een andere leerling wordt gecorrigeerd, worden oude uitleen- en vervaldata niet aan die nieuwe leerling toegeschreven. Alle uitgevoerde correcties worden apart vastgelegd. Vlak vóór het opslaan vergelijkt de server de keuzes opnieuw met de actuele database; wijzigingen sinds de preview blokkeren het opslaan.

### Excel-import: optionele ISBN-verrijking

- Via de adminpagina kun je een Excelbestand met boeken uploaden. Zet de optie **ISBN-verrijking** aan om lege velden automatisch aan te vullen met metadata uit Open Library of ISBNBarcode.org.
- De server gebruikt altijd de waarden uit het Excelbestand als bron; metadata vult alleen lege velden aan voor titel, auteur(s), beschrijving, uitgever, gepubliceerd jaar, aantal pagina’s, taal, cover-URL en tags.
- Verrijking kan centraal worden geactiveerd met `BOEKENBAAI_IMPORT_ENRICH_ISBN=true` en per import worden aan- of uitgezet met de payload-flag `enrichIsbn`.
- Heb je boekenseries met één gedeelde buitenste barcode, maar wil je wel unieke metadata ophalen? Voeg dan in Excel een kolom toe met de kop `metadata isbn`, `intern isbn` of `isbn inwendig`. Die waarde wordt opgeslagen als intern metadata-ISBN en voortaan als sleutel gebruikt voor verrijking.

### Gratis boekverrijking na import (zonder extra API-kosten)

- In de **nieuwe gecontroleerde Excelimport** staat het opzoeken van ontbrekende ISBN-gegevens tijdens de preview standaard **aan**, omdat volledigheid vooropstaat. De beheerder kan deze stap desgewenst uitschakelen. De aanvullende EasyCB- en Brave-stappen blijven van de directe importbevestiging gescheiden.
- Na het duurzaam opslaan start een **aparte, begrensde achtergrondverrijking**. De upload, review, uitleningen en importbevestiging wachten hier nooit op. Dezelfde routine werkt ook na de oude import en na het bijwerken van een boek. Bij een serverherstart worden nog ontbrekende gegevens hervat.
- De gratis dienst **EasyCB** wordt alleen aangeroepen wanneer `BOEKENBAAI_EASYCB_CONTACT` een echt geldig contactadres bevat. De dienst verlangt dit bij herhaald geautomatiseerd gebruik. Er worden maximaal één ISBN-zoekactie tegelijk en niet vaker dan circa eens per 1,8 seconde gestart. Antwoorden hebben een timeout en fouten leiden niet tot onbegrensde herhaallussen.
- Alleen boeken met een geldig ISBN én ontbrekende gegevens worden opgezocht. Wanneer een bestaande omslaglink na de gebruikelijke downloadpogingen aantoonbaar niet werkt, kan een nieuwe, gecontroleerde omslagbron worden geprobeerd. Handmatig of uit Excel gekozen omslaglinks blijven behouden. Fysieke exemplaren van dezelfde titel/uitgave delen de opzoekactie. Een exact ISBN en een overeenkomstige titel zijn verplicht voordat gegevens worden overgenomen.
- De aanvulling gebruikt voorrang van bestaande gegevens: ingevoerde beschrijvingen, covers en onderwerpen worden **niet overschreven**. Alleen ontbrekende beschrijving, uitgever, publicatiejaar, pagina's, onderwerpstags en een herkenbare **voorkantomslag** worden ingevuld. De bron en het laatste opzoekmoment blijven per boek vastgelegd. Een nieuwe coverlink wordt met de bestaande veilige omslagdownloader lokaal gecontroleerd en gecachet.
- Beheerders kunnen voortgang bekijken via `GET /api/admin/book-enrichment/status` (adminauthenticatie vereist). De uitslag bevat alleen aantallen, geen leerlinggegevens.
- Deze eerste fase gebruikt een specifieke gratis, Nederlandstalige boekbron en de reeds bestaande HTML-uitleesfunctionaliteit van Bureau ISBN bij optionele ISBN-preview. Het is **geen onbeperkte algemene webzoekmachine**. Willekeurige webwinkels automatisch doorzoeken zonder toestemming of juiste rechten is niet ingebouwd.
- De metadatahouder en de school moeten de voorwaarden en rechten voor overgenomen omslagbestanden en tekst controleren. Het kunnen opvragen van een bestand betekent niet automatisch dat herpublicatie is toegestaan. EasyCB is een gratis dienst van een derde partij die zonder garantie wordt aangeboden.

### Uitgebreide zoekopdrachten met uitgestelde Brave-toestemming

De gecontroleerde boekimport zoekt standaard ontbrekende informatie op via ISBN. Na het bevestigen worden de boeken **direct duurzaam opgeslagen**. EasyCB vult in de achtergrond aan (wanneer een geldig contactadres is ingesteld). Een afzonderlijke, eveneens duurzame `braveEnrichmentJobs`-taak blijft bewaard bij sluiten van de browser, opnieuw inloggen of serverherstart.

1. De beheerpagina toont de nog ontbrekende informatie, het maximum van **drie Brave-verzoeken per onderscheiden boek**, het beschikbare budget en het aantal boeken waarvoor deze maand een volledige reservering past.
2. De beheerder kan op een later moment toestemming geven. Er vinden **geen Brave-verzoeken vóór die expliciete goedkeuring** plaats. Je kunt de pagina meteen daarna verlaten. Een openstaande aanvraag verdwijnt niet.
3. De server bevestigt de maand, het maximaal aantal verzoeken en het actuele budget onder database-lock. Ieder verzoek wordt **vóór het netwerkverzoek** in de database gereserveerd. Als de server daarna uitvalt, wordt hetzelfde verzoek niet automatisch nog eens verzonden.
4. De zoekronde gebruikt eerst Brave Web Search en leest enkele relevante gevonden boekpagina's uit, controleert ISBN óf titel en auteur en haalt gestructureerde boekgegevens op (JSON-LD / HTML-meta). Bij gebrek aan een omslag volgt waar nodig Brave Image Search; bij onvoldoende verhaalgegevens kan nog één aanvullende zoekactie volgen.
5. Een omslag van een andere uitgave van hetzelfde werk is toegestaan wanneer de identiteit betrouwbaar is vastgesteld. De bestaande veilige omslagdownload controleert de uiteindelijke afbeelding. Handmatig ingevoerde of vanuit Excel vastgestelde gegevens blijven behouden.
6. Een quotum- of toegangsprobleem zet de taak veilig op pauze. De beheerder moet een nieuwe goedkeuring geven voor verdere verzoeken. De reeds verwerkte boeken en het verbruik blijven opgeslagen. Niet-volledig verwerkte boeken worden als zodanig geteld.

Boekenbaai registreert uitsluitend het eigen gebruik en heeft een harde grens van **maximaal 900 verzoeken per UTC-kalendermaand** (of een lagere ingestelde grens). Deze veiligheidsmarge gaat uit van Brave Search met $5/1.000 verzoeken en $5 gratis tegoed per maand. De teller van Brave zelf kan afwijken, bijvoorbeeld als dezelfde API-sleutel elders gebruikt wordt of het krediet door een andere dienst wordt verbruikt. Om onbedoelde kosten echt uit te sluiten, moet in het Brave-account **betaald opwaarderen en automatisch opladen uitstaan**. Het providerquotum uit HTTP-headers is extra controle en bewijst niet hoeveel gratis geldtegoed resteert.

Het zoeken en automatisch uitlezen respecteert veiligheidscontroles op externe adressen, beperkte paginagrootte en eenvoudige robots.txt-uitsluitingen. Een webpagina wordt alleen als bron voor boekgegevens gebruikt wanneer ISBN of titel én auteur voldoende overeenkomen. Er worden geen volledige Brave-zoekresultaten opgeslagen. Voor het herpubliceren van gekopieerde omslagen en teksten blijven de bronvoorwaarden gelden.

Ook zonder recente Excelimport kan een beheerder vanuit de importpagina de **bestaande collectie controleren**. De leerling- en leenadministratie wordt daarbij niet verwijderd of opnieuw geïmporteerd. De Brave API-sleutel blijft buiten client-side code en HTTP-responses.

### Intern ISBN voor metadata

- In het beheerdersformulier staat naast de barcode nu een veld **“Intern ISBN voor metadata”**. Vul dit alleen in wanneer meerdere boeken dezelfde fysieke barcode delen; het veld blijft optioneel voor reguliere titels.
- Wanneer het veld gevuld is, gebruiken Boekenbaai én de Excel-import dit metadata-ISBN om dubbelen op te sporen en metadata op te halen. Is het veld leeg, dan valt het systeem automatisch terug op de barcode zoals voorheen.

### Sliplane vastloper oplossen

Loopt een deploy vast op Sliplane? Controleer eerst in de Sliplane-logs of `npm ci`, `npm run build` en vooral `npm start` zonder fouten doorlopen. Herstart daarna zo nodig de service vanuit het dashboard. Vervang het runtimecommando niet door `node server.js`, omdat daarmee de auth/security-preloads worden overgeslagen.

## Legacy Open Library-cover URL's opschonen

Boekenbaai normaliseert legacy Open Library `archive.org`-cover URL's tijdens lezen en schrijven automatisch naar `covers.openlibrary.org`. Wil je bestaande records permanent herschrijven in je databestand, gebruik dan:

```bash
node scripts/cleanup-legacy-openlibrary-covers.js --file=/pad/naar/db.json
```

Dit is standaard een **dry-run** en schrijft niets weg. Pas wijzigingen daadwerkelijk toe met:

```bash
node scripts/cleanup-legacy-openlibrary-covers.js --apply --file=/pad/naar/db.json
```

## Fallback: hosten op GitHub Pages

De statische site kan nog als aparte frontend worden gebouwd met:

```bash
DEPLOY_TARGET=gh-pages npm run build
```

Stel dan een expliciete `BOEKENBAAI_ALLOWED_ORIGINS` en `BOEKENBAAI_PUBLIC_API_BASE` in voor de Sliplane-backend. Let op: de huidige Google-login, browsergebonden OAuth-start en cookiebeveiliging zijn als productiepad **same-origin op Sliplane** ontworpen en getest. Beschouw GitHub Pages daarom niet als een gelijkwaardige fallback voor de complete Google-authflow zonder aanvullende cross-origin integratietests.

## API-notitie: uitleenlog per leerling

- **Endpoint:** `GET /api/students/{id}/loans`
- **Toegang:**
  - Admins en docenten kunnen de uitleenlog van elke leerling opvragen.
  - Een leerling kan alleen zijn of haar eigen uitleenlog opvragen met het eigen `studentId`.
- **Respons:** lijst met uitleenactiviteiten voor de opgegeven leerling.
- Bij een ontbrekende of verkeerde leerling-id volgt een `401/403` (toegang geweigerd) of `404` (leerling niet gevonden).
