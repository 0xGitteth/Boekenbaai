# Google-login instellen voor Boekenbaai

De code ondersteunt Google-login voor leerlingen, docenten en beheerders met uitsluitend accounts op `@koraaledu.nl`.

De naamkeuze blijft de standaard ingang. Zodra Google-login is geconfigureerd kiest een leerling of medewerker eerst de naam en gaat daarna door naar Google. De bestaande naam- en wachtwoordlogin blijft beschikbaar als fallback.

## Wat al in Boekenbaai geregeld is

- Alleen een geverifieerd Google-account met exact het domein `koraaledu.nl` wordt geaccepteerd.
- De Google `sub` (stabiele account-id) wordt na de eerste geldige koppeling opgeslagen. Alleen het e-mailadres vergelijken is dus niet de uiteindelijke beveiliging.
- Een docent kan het Google-e-mailadres vooraf koppelen voor leerlingen uit de eigen klas.
- Een onbekende leerling kan na Google-login het eigen Boekenbaai-account koppelen via een verzoek aan de docent.
- Alleen een docent van een klas van die leerling of een beheerder kan dat verzoek goedkeuren.
- Een beheerder kan Google-e-mailadressen aan docent- en beheeraccounts koppelen.
- Bij een bekende naam en vooraf gekoppeld schoolmailadres gebruikt de login dat adres als Google `login_hint`, zodat Google zo min mogelijk extra invoer vraagt.
- Als nog geen gekoppeld schoolmailadres bekend is, laat Google de accountkeuze zien.
- Medewerkers kunnen `Ingelogd blijven op dit apparaat (30 dagen)` aanvinken. Dit werkt zowel bij de bestaande wachtwoordlogin als bij Google-login.
- Langdurige sessies overleven een serverrestart of nieuwe deploy.
- Google-koppelingen en persistente sessies staan in een apart auth-bestand naast `db.json`, zodat de bestaande bibliotheekdata niet wordt aangepast.
- De sessiecookie zelf is `HttpOnly`, `SameSite=Lax` en op HTTPS ook `Secure`.

## 1. OAuth-client maken bij Google

Ga in Google Cloud Console naar **APIs & Services > Credentials**.

Maak een **OAuth client ID** van het type **Web application**.

Voeg bij **Authorized redirect URIs** exact deze URI toe:

```text
https://JOUW-BOEKENBAAI-DOMEIN/api/auth/google/callback
```

Voorbeeld voor de huidige Sliplane-URL:

```text
https://boekenbaai.sliplane.app/api/auth/google/callback
```

De redirect-URI moet letter voor letter overeenkomen met de URL die in Sliplane bij `BOEKENBAAI_PUBLIC_URL` staat.

De login gebruikt alleen de standaard scopes `openid`, `email` en `profile`.

> Een Google Workspace-beheerder kan centraal beperkingen voor externe OAuth-apps hebben ingesteld. Als Google bij het schoolaccount meldt dat de app door de organisatie is geblokkeerd, kan dat niet vanuit Boekenbaai worden omzeild en is toestemming van de Workspace-beheerder nodig.

## 2. Omgevingsvariabelen in Sliplane

Open in Sliplane de service van Boekenbaai en stel deze vier waarden in:

```text
BOEKENBAAI_GOOGLE_CLIENT_ID=<client-id uit Google>
BOEKENBAAI_GOOGLE_CLIENT_SECRET=<client-secret uit Google>
BOEKENBAAI_GOOGLE_DOMAIN=koraaledu.nl
BOEKENBAAI_PUBLIC_URL=https://boekenbaai.sliplane.app
```

`BOEKENBAAI_AUTH_SECRET` is optioneel. Als deze variabele niet is ingesteld, gebruikt Boekenbaai de Google Client Secret als geheime sleutel voor het ondertekenen van de tijdelijke OAuth-state. Voor deze installatie is het dus niet nodig om een vijfde secret aan te maken.

Wil je later toch een aparte sleutel gebruiken, dan kan dat met:

```text
BOEKENBAAI_AUTH_SECRET=<lange willekeurige geheime waarde>
```

Deze waarde mag nooit in GitHub worden gezet.

Optioneel kun je de redirect-URI expliciet vastzetten:

```text
BOEKENBAAI_GOOGLE_REDIRECT_URI=https://boekenbaai.sliplane.app/api/auth/google/callback
```

Dat is normaal niet nodig wanneer `BOEKENBAAI_PUBLIC_URL` correct staat.

## 3. Persistente opslag

Als `BOEKENBAAI_DATA_PATH` bijvoorbeeld is:

```text
/data/db.json
```

slaat de Google-authenticatielaag standaard zijn gegevens op in:

```text
/data/db.json.auth.json
```

Daardoor gebruikt dit automatisch hetzelfde persistente Sliplane-volume als `db.json`.

Je kunt desgewenst een ander pad instellen met:

```text
BOEKENBAAI_AUTH_DATA_PATH=/data/google-auth.json
```

Het auth-bestand bevat geen Google-wachtwoorden of OAuth access tokens. Sessietokens worden alleen als SHA-256 hash opgeslagen.

## 4. Eerste koppelingen maken

Na de deploy logt de beheerder één keer in via **Inloggen met wachtwoord**.

In het docentenportaal verschijnt **Google-accountkoppelingen**.

Daar kan de beheerder:

1. het eigen `@koraaledu.nl` e-mailadres aan het beheeraccount koppelen;
2. e-mailadressen van andere medewerkers koppelen;
3. e-mailadressen van leerlingen koppelen.

Docenten zien alleen leerlingen uit hun eigen klassen en kunnen daar zelf het schoolmailadres voor invullen.

## 5. Snelle login na koppeling

Voor leerlingen en medewerkers is de normale route:

1. naam typen of uit de bestaande dropdown kiezen;
2. Boekenbaai zoekt intern of aan die naam al een schoolmailadres is gekoppeld;
3. als dat bekend is, wordt dit als `login_hint` aan Google meegegeven;
4. als Google dat account al in de browser kent, kan de login daardoor zeer snel worden afgerond;
5. als nog geen gekoppeld adres bekend is, toont Google de accountkeuze.

De server controleert na terugkomst altijd zelfstandig het geverifieerde e-mailadres, het Google-domein en de Google account-id. De `login_hint` is dus alleen voor snelheid en geeft nooit op zichzelf toegang.

## 6. Leerling zonder vooraf gekoppeld e-mailadres

1. De leerling kiest de eigen naam en gaat door naar Google.
2. Boekenbaai controleert dat Google het e-mailadres heeft geverifieerd en dat het exact op `@koraaledu.nl` eindigt.
3. Als het account nog onbekend is, kan de leerling het eigen Boekenbaai-account koppelen.
4. Er wordt een koppelverzoek aangemaakt.
5. Een docent van de klas ziet dit verzoek in het docentenportaal en kiest **Goedkeuren** of **Afwijzen**.
6. Na goedkeuring kan de leerling de koppeling afronden en inloggen.

Een docent kan dit verzoek voorkomen door vooraf het juiste schoolmailadres bij de leerling in te vullen.

## 7. Medewerkerslogin

Een medewerkeraccount wordt niet automatisch op alleen een Google-naam geclaimd. Een beheerder koppelt eerst het juiste `@koraaledu.nl` e-mailadres aan het bestaande medewerkeraccount. Bij de eerste geldige Google-login wordt daarna de stabiele Google `sub` aan die koppeling toegevoegd.

Dit voorkomt dat twee medewerkers met vergelijkbare namen per ongeluk het verkeerde account kunnen koppelen.

## 8. Controle na deploy

Controleer na het instellen minimaal:

1. de naamkeuze stuurt door naar Google;
2. een gekoppelde leerling kan met Google inloggen;
3. een niet-gekoppelde leerling kan een verzoek sturen;
4. een docent ziet alleen verzoeken en leerlingen uit de eigen klassen;
5. een docent kan zo'n verzoek goedkeuren;
6. een `gmail.com` of ander niet-schoolaccount wordt geweigerd;
7. een medewerker kan met Google inloggen nadat de beheerder het e-mailadres heeft gekoppeld;
8. `Ingelogd blijven` blijft werken na een Sliplane restart.

## Technische notitie

De Google-authenticatielaag wordt als preload vóór de bestaande `server.js` geladen. Een kleine aanvullende preload regelt de naam-gebaseerde `login_hint` en de snelle naam-eerst interface. Daardoor blijven de bestaande API, bibliotheekfuncties en autorisatielaag intact en is de verandering geïsoleerd van de rest van Boekenbaai.
