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

## Installatie en gebruik

1. **Broncode downloaden**  
   Download of clone deze repository naar de server of laptop waarop je Boekenbaai wilt draaien.

2. **Dependencies installeren**  
   Installeer Node.js (versie 18 of hoger wordt aanbevolen) en voer vervolgens in de projectmap uit:

   ```bash
   npm install
   ```

3. **Server starten**  
   Start de webapplicatie lokaal met:

   ```bash
   npm start
   ```

   De server start standaard op poort `3000`. Zie je al een andere dienst op die poort draaien, dan kun je `PORT=4000 npm start` gebruiken om Boekenbaai op een andere poort te starten.

4. **Website bezoeken**  
   Open een browser op dezelfde computer en navigeer naar [http://localhost:3000](http://localhost:3000) (of vervang `3000` door de gekozen poort).  
   Wil je vanaf een andere computer in hetzelfde netwerk verbinden, gebruik dan het IP-adres van de machine waarop Boekenbaai draait, bijvoorbeeld `http://192.168.1.25:3000`.

   - De homepage is de leerlingenomgeving.
   - Docenten en beheerders gebruiken het afgeschermde portaal op [http://localhost:3000/staff.html](http://localhost:3000/staff.html).

De app is geoptimaliseerd voor gebruik met een standaard barcodescanner (die als toetsenbord werkt). Na het selecteren van een leerling kan direct een barcode worden gescand.

## Werken in GitHub Codespaces

Wil je de code rechtstreeks in een GitHub Codespace gebruiken (zoals in `https://glorious-capybara-5gvg5xxv6vx4h49vw.github.dev/`), volg dan deze stappen:

1. **Repository openen op GitHub**  
   Navigeer naar je fork of de originele repository op `github.com`. Klik op de groene **Code**-knop en kies **Codespaces** → **Create codespace on main**. Je kunt ook op het toetsenbord `.` indrukken of direct naar de gedeelde `github.dev`-URL gaan; accepteer dan de prompt om een Codespace te starten.

2. **Afwachten tot de omgeving klaar is**  
   GitHub maakt een virtuele ontwikkelomgeving aan waarin deze repository automatisch wordt gekloond. Dit kan enkele minuten duren bij de eerste start.

3. **Dependencies installeren**  
   Open de terminal onderin de Codespace en voer uit:

   ```bash
   npm install
   ```

4. **Server starten**  
   Start daarna de applicatie met:

   ```bash
   npm start
   ```

   Codespaces vraagt om poort `3000` (of de gekozen poort) te publiceren. Klik op **Open in Browser** om de leerlingstartpagina te zien. Via het tabblad **Ports** kun je ook de URL kopiëren en delen met collega’s binnen hetzelfde netwerk.

5. **Wijzigingen opslaan en pushen**  
   Gebruik Git in de Codespace (links onderin of via de terminal) om eventuele aanpassingen te committen en terug naar GitHub te pushen. Alle bestanden staan automatisch in de workspace van je Codespace.

Je kunt meerdere Codespaces aanmaken (bijvoorbeeld voor testen en productie). Sluit een Codespace via **Codespaces** → **Delete** als je hem niet meer nodig hebt; zo voorkom je dat hij rekenuren blijft verbruiken.

## Boekenbaai hosten via GitHub Pages

GitHub Pages kan alleen statische bestanden tonen. De Node.js-server (`server.js`) moet daarom op een andere plek draaien (bijvoorbeeld op Render, Railway, een eigen VPS of tijdelijk op een computer op school). De GitHub Pages-site maakt vervolgens via HTTPS verbinding met die externe API.

1. **Publiceer de backend**
   - Maak een openbaar bereikbare URL aan voor de Node-server. Veel PaaS-platformen kunnen rechtstreeks met deze repository overweg; een eenvoudige optie is [Render](https://render.com) of [Railway](https://railway.app).
   - Stel in het hostingplatform de omgevingsvariabele `PORT` in (bijvoorbeeld `10000`) en maak een startcommando `node server.js` aan.
   - Upload eventueel een bijgewerkte `data/db.json` via Git, want GitHub Pages kan geen data schrijven.

2. **Vertel de frontend waar de API staat**
   - Open `public/index.html` en `public/staff.html`.
   - Vul in de head-sectie het meta-element aan met de publieke URL van de backend, bijvoorbeeld:

     ```html
     <meta name="boekenbaai-api-base" content="https://mijn-boekenbaai.onrender.com" />
     ```

   - Wanneer je lokaal ontwikkelt, kun je dit veld leeg laten; de app gebruikt dan automatisch dezelfde host/poort als het statische bestand.

3. **Publiceer de `public/`-map op GitHub Pages**
   - Zet de inhoud van de map `public/` in de hoofdbranch (bijvoorbeeld onder een map `docs/`) of maak een aparte `gh-pages`-branch aan die alleen deze bestanden bevat.
   - Activeer GitHub Pages via de repository-instellingen en kies de juiste branch/map (bijvoorbeeld `gh-pages` → `/` of `main` → `/docs`).
   - Wacht enkele minuten totdat GitHub de site heeft gebouwd. Je leerling-URL wordt iets als `https://<account>.github.io/<repo>/`.

4. **Test de koppeling**
   - Open de GitHub Pages-URL en log in met een testaccount.
   - Controleer in de browserconsole (F12) of requests naar `https://mijn-boekenbaai.onrender.com/api/...` succesvol zijn.

Let op: als je later een eigen domein toevoegt, kun je dat in GitHub Pages configureren bij **Custom domain**. Controleer wel of je hostingplatform CORS toestaat vanaf dat domein; de standaardserver staat alle hosts toe zolang ze over HTTPS communiceren.

## Inloggen

| Rol        | Gebruikersnaam | Wachtwoord |
| ---------- | -------------- | ---------- |
| Beheerder  | `admin`        | `boekenbaai` |
| Docent     | `vandijk`      | `klaslokaal` |
| Leerling   | `emma.j`       | `lezen123` |
| Leerling   | `noah.d`       | `boeken123` |
| Leerling   | `lina.b`       | `avontuur` |

Je kunt deze gegevens aanpassen in `data/db.json` door de gehashte wachtwoorden te vervangen of door een Excelimport uit te
voeren.

## Leerlingen importeren via Excel

1. Meld je aan als beheerder via [http://localhost:3000/staff.html](http://localhost:3000/staff.html).
2. Kies in het beheerblok het Excelbestand (`.xlsx`). De eerste rij moet kolomnamen bevatten:
   - **Naam** of **Name** – volledige naam van de leerling (verplicht).
   - **Gebruikersnaam** of **Username** – unieke inlognaam (verplicht).
   - **Wachtwoord** of **Password** – optioneel; laat leeg om automatisch een veilig wachtwoord te laten genereren.
   - **Klas** of **Leerjaar** – optioneel; wordt als `grade` opgeslagen.
3. Klik op **Importeren**. De resultaten tonen welke accounts zijn toegevoegd, welke zijn bijgewerkt en eventuele nieuwe
   wachtwoorden.

Geüploade bestanden worden niet op schijf bewaard; er wordt alleen gelezen wat nodig is om de accounts bij te werken.

## Data-opslag

Alle gegevens worden bewaard in `data/db.json`. Naast boeken, leerlingen en mappen vind je hier ook klassen en gebruikersaccounts (met SHA-256 gehashte wachtwoorden). Pas deze file met zorg aan wanneer je gebruikers toevoegt of rollen wijzigt.

## Projectstructuur

```
Boekenbaai/
├── data/
│   └── db.json
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── server.js
└── package.json
```

## Integratie met Google-accounts

Koppelen aan Google Workspace-accounts (bijvoorbeeld via OAuth 2.0 of SAML) is nog niet ingebouwd. Het is technisch mogelijk
door een identity-provider te configureren en de `/api/login`-route uit te breiden met verificatie van Google-tokens. Dit
vereist echter server-side verificatie, HTTPS en aanvullende configuratie in de Google-adminconsole. Tot die tijd blijft de
inlog gescheiden binnen Boekenbaai.

## Toekomstige ideeën

- Koppeling met Google Workspace (SSO) voor single sign-on.
- E-mailherinneringen voor leerlingen bij te late boeken.
- Uitgebreidere rechtenstructuur met meerdere admins.
