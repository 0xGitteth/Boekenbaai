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
| `BOEKENBAAI_ISBN_CACHE_TTL_MS` | `300000` | Tijd (in milliseconden) dat ISBN-metadata in het in-memory cache blijft staan. Resultaten – ook "niet gevonden" – verlopen standaard na 5 minuten. |
| `DEPLOY_TARGET` | `gh-pages` | Gebruik deze tijdens het bouwen (`DEPLOY_TARGET=gh-pages npm run build`) om de Vite-base op `/Boekenbaai/` te zetten voor GitHub Pages. |

> **Belangrijk:** zowel `/data/db.json` als het auth-bestand moeten op persistent storage staan. Test dit na configuratie met een redeploy: bibliotheekdata, Google-koppelingen en onthouden sessies mogen niet terugvallen op de repositoryseed.

> **Beheeraccount:** `Boekenbaai Beheer` blijft bewust lokaal en krijgt geen Google-account. Gebruik in productie een sterk uniek wachtwoord. Als de productie-database ooit uit de publieke voorbeelddata is ontstaan, controleer dan dat het oorspronkelijke demo-/seedwachtwoord niet meer actief is.

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
