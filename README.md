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
npm start       # start de Node-server op http://localhost:3000
```

De server kiest automatisch de map `dist/` zodra je een build hebt gedraaid. Zonder build worden de bestanden direct uit `public/` geserveerd, zodat je lokaal snel kunt ontwikkelen.

## Deployen op Sliplane

1. Zorg dat de dependancies aanwezig zijn: `npm install`.
2. Bouw de frontend: `npm run build`.
3. Laat Sliplane de app starten met `npm start` (dit voert `node server.js` uit).
4. Koppel een persistente opslag aan de container en laat deze wijzen naar het pad dat je via `BOEKENBAAI_DATA_PATH` configureert (bijv. `/data/db.json`).
5. Stel optioneel `BOEKENBAAI_ALLOWED_ORIGINS` in wanneer je vanaf een ander domein (zoals GitHub Pages) met de API wilt praten.

### Belangrijke omgevingsvariabelen

| Variabele | Voorbeeldwaarde | Omschrijving |
| --- | --- | --- |
| `BOEKENBAAI_DATA_PATH` | `/data/db.json` | Locatie van het JSON-databestand. Wanneer het bestand nog niet bestaat wordt het automatisch aangemaakt (of gevuld met de voorbeelddata uit `data/db.json`). |
| `BOEKENBAAI_STATIC_DIR` | `/app/dist` | Overschrijft de map van waaruit statische assets worden geserveerd. Standaard gebruikt de server `dist/` (na build) en anders `public/`. |
| `BOEKENBAAI_PUBLIC_API_BASE` | `https://boekenbaai.sliplane.app` | Hiermee wordt het API-adres in de HTML-injectie gezet. Handig wanneer de frontend elders draait, maar je toch naar de Sliplane-backend wilt verwijzen. |
| `BOEKENBAAI_ALLOWED_ORIGINS` | `https://jouwnaam.github.io` | Komma-gescheiden lijst met origins die cross-origin API-verkeer mogen doen. Zet op `*` om alles toe te staan. |
| `BOEKENBAAI_IMPORT_ENRICH_ISBN` | `true` | Zet op `true` om tijdens Excel-boekimport automatisch ontbrekende velden aan te vullen met ISBN-metadata. Kan per import worden overschreven met de payload-flag `enrichIsbn`. |
| `BOEKENBAAI_ENABLE_ISBNBARCODE` | `true` | Zet op `true` om naast Open Library ook de ISBNBarcode.org API te raadplegen voor boekmetadata. Standaard staat alleen Open Library aan. |
| `BOEKENBAAI_ISBN_CACHE_TTL_MS` | `300000` | Tijd (in milliseconden) dat ISBN-metadata in het in-memory cache blijft staan. Resultaten – ook "niet gevonden" – verlopen standaard na 5 minuten. |
| `DEPLOY_TARGET` | `gh-pages` | Gebruik deze tijdens het bouwen (`DEPLOY_TARGET=gh-pages npm run build`) om de Vite-base op `/Boekenbaai/` te zetten voor GitHub Pages. |

> 💡 **Tip:** Laat Sliplane tijdens de buildfase `npm run build` uitvoeren en tijdens de runtime alleen `npm start`. Dankzij `BOEKENBAAI_DATA_PATH` kun je het databestand op een volume laten schrijven zodat inloggegevens en uitleengeschiedenis bewaard blijven.

De server probeert boekinformatie standaard eerst op te halen bij Open Library. Wanneer `BOEKENBAAI_ENABLE_ISBNBARCODE=true` staat, wordt daarna als fallback een verzoek naar ISBNBarcode.org gedaan en blijft de bestaande barcode-parser actief. De resultaten worden tijdelijk in een in-memory cache opgeslagen (standaard 5 minuten). Parallelle verzoeken naar dezelfde ISBN worden gecoördineerd zodat er maximaal één upstream-lookup tegelijk actief is. Omdat de cache alleen in het serverproces leeft, wordt deze gewist bij een herstart.

### Excel-import: optionele ISBN-verrijking

- Via de adminpagina kun je een Excelbestand met boeken uploaden. Zet de optie **ISBN-verrijking** aan om lege velden automatisch aan te vullen met metadata uit Open Library of ISBNBarcode.org.
- De server gebruikt altijd de waarden uit het Excelbestand als bron; metadata vult alleen lege velden aan voor titel, auteur(s), beschrijving, uitgever, gepubliceerd jaar, aantal pagina’s, taal, cover-URL en tags.
- Verrijking kan centraal worden geactiveerd met `BOEKENBAAI_IMPORT_ENRICH_ISBN=true` en per import worden aan- of uitgezet met de payload-flag `enrichIsbn`.
- Heb je boekenseries met één gedeelde buitenste barcode, maar wil je wel unieke metadata ophalen? Voeg dan in Excel een kolom toe met de kop `metadata isbn`, `intern isbn` of `isbn inwendig`. Die waarde wordt opgeslagen als intern metadata-ISBN en voortaan als sleutel gebruikt voor verrijking.

### Intern ISBN voor metadata

- In het beheerdersformulier staat naast de barcode nu een veld **“Intern ISBN voor metadata”**. Vul dit alleen in wanneer meerdere boeken dezelfde fysieke barcode delen; het veld blijft optioneel voor reguliere titels.
- Wanneer het veld gevuld is, gebruiken Boekenbaai én de Excel-import dit metadata-ISBN om dubbelen op te sporen en metadata op te halen. Is het veld leeg, dan valt het systeem automatisch terug op de barcode zoals voorheen.

### Sliplane vastloper oplossen

Loopt een deploy vast op Sliplane? Maak dan een nieuwe commit (bijvoorbeeld met de boodschap _"Trigger redeploy"_) zodat er een frisse container wordt uitgerold. Controleer daarna in de Sliplane-logs of de stappen `npm install`, `npm run build` en `npm start` zonder fouten doorlopen. Wanneer de server blijft hangen, herstart je de Sliplane-service vanuit het dashboard of voer lokaal `npm run build && npm start` uit om eventuele buildfouten op te sporen.

## Fallback: hosten op GitHub Pages

Wil je de statische site toch nog als back-up op GitHub Pages houden? Bouw dan met:

```bash
DEPLOY_TARGET=gh-pages npm run build
```

Upload vervolgens de inhoud van de map `dist/` naar GitHub Pages. Laat `BOEKENBAAI_ALLOWED_ORIGINS` op je Sliplane-server wijzen naar de GitHub Pages-origin en stel `BOEKENBAAI_PUBLIC_API_BASE` (of `VITE_BOEKENBAAI_API_BASE` tijdens de build) in op de URL van de Sliplane-deploy. Daarmee wordt de API-base automatisch in `server.js` en de gebuilde frontend gezet, zodat de statische pagina tegen dezelfde host kan praten en `/api/login` een 200/401 van de backend teruggeeft in plaats van een 404.

## API-notitie: uitleenlog per leerling

- **Endpoint:** `GET /api/students/{id}/loans`
- **Toegang:**
  - Admins en docenten kunnen de uitleenlog van elke leerling opvragen.
  - Een leerling kan alleen zijn of haar eigen uitleenlog opvragen met het eigen `studentId`.
- **Respons:** lijst met uitleenactiviteiten voor de opgegeven leerling.
- Bij een ontbrekende of verkeerde leerling-id volgt een `401/403` (toegang geweigerd) of `404` (leerling niet gevonden).
