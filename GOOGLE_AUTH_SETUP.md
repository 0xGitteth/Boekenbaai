# Google-login instellen voor Boekenbaai

De code ondersteunt Google-login voor leerlingen, docenten en beheerders met uitsluitend accounts op `@koraaledu.nl`.

De bestaande naam- en wachtwoordlogin blijft beschikbaar als fallback.

## Wat al in Boekenbaai geregeld is

- Alleen een geverifieerd Google-account met exact het domein `koraaledu.nl` wordt geaccepteerd.
- De Google `sub` (stabiele account-id) wordt na de eerste geldige koppeling opgeslagen. Alleen het e-mailadres vergelijken is dus niet de uiteindelijke beveiliging.
- Een docent kan het Google-e-mailadres vooraf koppelen voor leerlingen uit de eigen klas.
- Een onbekende leerling kan na Google-login het eigen Boekenbaai-account kiezen en een koppelverzoek sturen.
- Alleen een docent van een klas van die leerling of een beheerder kan dat verzoek goedkeuren.
- Een beheerder kan Google-e-mailadressen aan docent- en beheeraccounts koppelen.
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

Voorbeeld als de Sliplane-URL `https://boekenbaai.sliplane.app` is:

```text
https://boekenbaai.sliplane.app/api/auth/google/callback
```

De redirect-URI moet letter voor letter overeenkomen met de URL die in Sliplane bij `BOEKENBAAI_PUBLIC_URL` staat.

De login gebruikt alleen de standaard scopes `openid`, `email` en `profile`.

> Een Google Workspace-beheerder kan centraal beperkingen voor externe OAuth-apps hebben ingesteld. Als Google bij het schoolaccount meldt dat de app door de organisatie is geblokkeerd, kan dat niet vanuit Boekenbaai worden omzeild en is toestemming van de Workspace-beheerder nodig.

## 2. Omgevingsvariabelen in Sliplane

Open in Sliplane de service van Boekenbaai en voeg bij de environment variables toe:

```text
BOEKENBAAI_GOOGLE_CLIENT_ID=<client-id uit Google>
BOEKENBAAI_GOOGLE_CLIENT_SECRET=<client-secret uit Google>
BOEKENBAAI_GOOGLE_DOMAIN=koraaledu.nl
BOEKENBAAI_PUBLIC_URL=https://JOUW-BOEKENBAAI-DOMEIN
BOEKENBAAI_AUTH_SECRET=<lange willekeurige geheime waarde>
```

Voor `BOEKENBAAI_AUTH_SECRET` kun je bijvoorbeeld lokaal een waarde genereren met:

```bash
openssl rand -hex 32
```

Deze waarde niet in GitHub zetten.

Optioneel kun je de redirect-URI expliciet vastzetten:

```text
BOEKENBAAI_GOOGLE_REDIRECT_URI=https://JOUW-BOEKENBAAI-DOMEIN/api/auth/google/callback
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

Na de deploy logt de beheerder één keer in met de bestaande naam- en wachtwoordlogin.

In het docentenportaal verschijnt **Google-accountkoppelingen**.

Daar kan de beheerder:

1. het eigen `@koraaledu.nl` e-mailadres aan het beheeraccount koppelen;
2. e-mailadressen van andere medewerkers koppelen;
3. e-mailadressen van leerlingen koppelen.

Docenten zien alleen leerlingen uit hun eigen klassen en kunnen daar zelf het schoolmailadres voor invullen.

## 5. Flow voor een leerling zonder vooraf gekoppeld e-mailadres

1. De leerling kiest **Inloggen met Google**.
2. Boekenbaai controleert dat Google het e-mailadres heeft geverifieerd en dat het exact op `@koraaledu.nl` eindigt.
3. Als het account nog onbekend is, zoekt de leerling het eigen Boekenbaai-account op naam.
4. Er wordt een koppelverzoek aangemaakt.
5. Een docent van de klas ziet dit verzoek in het docentenportaal en kiest **Goedkeuren** of **Afwijzen**.
6. Na goedkeuring kan de leerling de pagina verversen. Boekenbaai rondt de nog openstaande Google-koppeling dan af en logt de leerling in.

Een docent kan dit hele verzoek voorkomen door vooraf het juiste schoolmailadres bij de leerling in te vullen.

## 6. Medewerkerslogin

Een medewerkeraccount wordt niet automatisch op naam geclaimd. Een beheerder koppelt eerst het juiste `@koraaledu.nl` e-mailadres aan het bestaande medewerkeraccount. Bij de eerste Google-login wordt daarna de stabiele Google `sub` aan die koppeling toegevoegd.

Dit voorkomt dat twee medewerkers met vergelijkbare namen per ongeluk het verkeerde account kunnen koppelen.

## 7. Controle na deploy

Controleer na het instellen minimaal:

1. een gekoppelde leerling kan met Google inloggen;
2. een niet-gekoppelde leerling krijgt de accountkeuze en kan een verzoek sturen;
3. een docent ziet alleen verzoeken en leerlingen uit de eigen klassen;
4. een docent kan zo'n verzoek goedkeuren;
5. een `gmail.com` of ander niet-schoolaccount wordt geweigerd;
6. een medewerker kan met Google inloggen nadat de beheerder het e-mailadres heeft gekoppeld;
7. `Ingelogd blijven` blijft werken na een Sliplane restart.

## Technische notitie

De integratie wordt met Node's `--require ./google-auth-preload.js` vóór de bestaande `server.js` geladen. Daardoor blijft de huidige API en autorisatielaag intact. De preload-laag herstelt alleen persistente sessies in de bestaande sessie-Map en onderschept uitsluitend de nieuwe auth-routes, logout en HTML-injectie van de Google-interface.
