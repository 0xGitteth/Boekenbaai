# Google-login instellen voor Boekenbaai

Boekenbaai gebruikt Google-login voor **leerlingen en docenten** met uitsluitend geverifieerde accounts op exact `@koraaledu.nl`.

Het generieke **Boekenbaai Beheer**-account is bewust een uitzondering: dat account blijft lokaal met naam + wachtwoord inloggen en kan niet aan Google worden gekoppeld. Daardoor blijft het beheeraccount overdraagbaar zonder aan een persoonlijk schoolaccount vast te zitten.

## Huidige loginflow

### Leerling

1. Kies de leerling echt uit de naamdropdown.
2. Klik op **Inloggen**.
3. Boekenbaai start Google-login voor precies het geselecteerde account.
4. Is het schoolmailadres al vooraf gekoppeld, dan wordt het als `login_hint` aan Google meegegeven.
5. Is er nog geen koppeling, dan onthoudt Boekenbaai de gekozen leerling veilig tijdens de Google-omweg en maakt na de eerste geldige Google-login automatisch het juiste koppelverzoek aan.
6. Na goedkeuring door een docent uit de eigen klas of een beheerder wordt de login automatisch afgerond.

Leerlingen hebben geen lokale wachtwoordfallback meer.

### Docent

1. Kies de docent echt uit de naamdropdown.
2. Vink desgewenst **Ingelogd blijven op dit apparaat** aan.
3. Klik op **Inloggen**.
4. Boekenbaai gaat naar Google.

Het schoolmailadres van een docent moet vooraf door een beheerder aan het bestaande docentaccount zijn gekoppeld. Docenten hebben geen lokale wachtwoordfallback meer.

### Boekenbaai Beheer

1. Kies **Boekenbaai Beheer** uit de naamdropdown.
2. Alleen voor dit lokale beheeraccount verschijnt het wachtwoordveld.
3. Log lokaal in met het beheerwachtwoord.

Adminaccounts zijn server-side `local-only`: een directe Google-start of Google-koppeling voor een admin wordt geweigerd, ook als iemand de UI probeert te omzeilen.

## Wat Boekenbaai server-side controleert

- Alleen een door Google geverifieerd e-mailadres op exact `koraaledu.nl` wordt geaccepteerd.
- De Google `sub` is de stabiele identiteit. Een later ander Google-account kan een bestaande geverifieerde koppeling niet claimen door hetzelfde e-mailadres te gebruiken.
- Google ID-tokens worden cryptografisch gecontroleerd met Google's publieke JWKS-sleutels en gecontroleerd op onder andere signature, issuer, audience, `azp`, vervaldatum, uitgiftetijd, nonce, `email_verified`, hosted domain en `sub`.
- OAuth state en OIDC nonce zijn aan de loginpoging gebonden.
- De OAuth-start is aan een kortlevend, browsergebonden starttoken gekoppeld zodat een andere website niet ongemerkt een accountselectie kan forceren.
- Docenten kunnen alleen leerlingen uit hun eigen klassen beheren.
- Een wijziging van een bestaande Google-koppeling trekt oude sessies van dat account direct in, ook als het token al in het servergeheugen stond.
- Openstaande leerling-koppelverzoeken verlopen na 30 dagen. Afgehandelde verzoeken worden maximaal 90 dagen bewaard als beperkte auditgeschiedenis.
- Persistente sessies hebben een vervaldatum en worden ook ongeldig na relevante account-/credentialwijzigingen.
- Google access tokens, refresh tokens en Google-wachtwoorden worden niet opgeslagen.
- Sessietokens worden in de auth-opslag uitsluitend gehasht opgeslagen.

## 1. Google Cloud OAuth-client

Ga in Google Cloud Console naar **APIs & Services > Credentials** en maak een **OAuth client ID** van het type **Web application**.

Gebruik voor de huidige Sliplane-installatie:

**Authorized JavaScript origin**

```text
https://boekenbaai.sliplane.app
```

**Authorized redirect URI**

```text
https://boekenbaai.sliplane.app/api/auth/google/callback
```

De redirect-URI moet exact overeenkomen met de publieke Boekenbaai-URL. De login vraagt alleen de scopes:

```text
openid email profile
```

Boekenbaai gebruikt geen Google Drive-, Gmail- of andere Workspace-data.

Een Google Workspace-beheerder kan externe OAuth-apps centraal blokkeren. Als een `@koraaledu.nl` account bij de echte test een melding zoals `admin_policy_enforced` of een organisatieblokkade krijgt, moet de Koraal Workspace-beheerder de app toestaan/trusten. Dat kan niet vanuit Boekenbaai worden omzeild.

## 2. Sliplane omgevingsvariabelen

Deze waarden moeten aanwezig zijn:

```text
BOEKENBAAI_GOOGLE_CLIENT_ID=<OAuth client-id>
BOEKENBAAI_GOOGLE_CLIENT_SECRET=<OAuth client-secret>
BOEKENBAAI_GOOGLE_DOMAIN=koraaledu.nl
BOEKENBAAI_PUBLIC_URL=https://boekenbaai.sliplane.app
```

Optioneel:

```text
BOEKENBAAI_GOOGLE_REDIRECT_URI=https://boekenbaai.sliplane.app/api/auth/google/callback
```

Dat is niet nodig als `BOEKENBAAI_PUBLIC_URL` correct staat.

`BOEKENBAAI_AUTH_SECRET` is eveneens optioneel. Zonder aparte waarde gebruikt Boekenbaai de Google Client Secret voor het ondertekenen van tijdelijke auth-state. Als je later een aparte sleutel wilt gebruiken:

```text
BOEKENBAAI_AUTH_SECRET=<lange willekeurige geheime waarde>
```

Secrets horen alleen in Sliplane/secret storage en nooit in GitHub.

## 3. Essentiële Sliplane deploymentchecks

### Startcommando

Sliplane moet de applicatie starten met:

```text
npm start
```

**Niet** met `node server.js`.

`npm start` laadt eerst de beveiligings-, lokale beheerlogin-, loginpolicy-, leerlinghandoff- en Google-runtimepreloads en start daarna `server.js`. Een handmatige override naar `node server.js` zou de nieuwe authenticatielaag omzeilen.

### Persistente opslag

Gebruik een persistent Sliplane-volume en zet bijvoorbeeld:

```text
BOEKENBAAI_DATA_PATH=/data/db.json
```

De Google-authopslag komt dan standaard naast de database te staan:

```text
/data/db.json.auth.json
```

Je kunt die locatie desgewenst apart instellen:

```text
BOEKENBAAI_AUTH_DATA_PATH=/data/google-auth.json
```

Controleer dat `/data` daadwerkelijk een **persistent volume** is. Zonder persistent volume verdwijnen accountkoppelingen en onthouden sessies bij een nieuwe container/deploy.

## 4. Beheeraccount

Het generieke beheeraccount hoort niet bij een persoon en krijgt geen Google-mailadres.

Gebruik voor productie een sterk, uniek beheerwachtwoord. De repository bevat voorbeeld-/seeddata voor ontwikkeling. Als een productie-installatie ooit vanuit die publieke seed is gestart, controleer dan vóór ingebruikname dat het beheerwachtwoord inmiddels is gewijzigd. Gebruik nooit een publiek bekend demo-/seedwachtwoord als productiecredential.

De lokale beheerlogin gebruikt scrypt voor nieuwe/migreerde wachtwoordhashes en heeft brute-force/rate limiting. Een oude legacy SHA-256 beheerhash wordt na de eerste succesvolle lokale login automatisch naar scrypt gemigreerd.

## 5. Eerste koppelingen

Log in als **Boekenbaai Beheer** en open in het docentenportaal **Google-accountkoppelingen**.

Daar kan de beheerder:

- het `@koraaledu.nl` e-mailadres van docenten vooraf koppelen;
- e-mailadressen van leerlingen vooraf koppelen;
- openstaande leerling-koppelverzoeken bekijken en, waar toegestaan, goedkeuren of afwijzen.

Een beheerder wordt zelf niet in de Google-koppellijst aangeboden.

Docenten kunnen vanuit hetzelfde onderdeel alleen leerlingen uit hun eigen klassen beheren en daar zelf het juiste schoolmailadres invullen of verzoeken beoordelen.

## 6. Eerste leerling-login zonder prelink

De leerling hoeft na Google niet opnieuw naar het eigen Boekenbaai-account te zoeken:

1. leerling kiest vóór Google de juiste naam uit de dropdown;
2. Boekenbaai bindt die keuze tijdelijk en ondertekend aan de loginpoging;
3. leerling logt in met het eigen `@koraaledu.nl` Google-account;
4. als er nog geen prelink is, maakt Boekenbaai automatisch voor precies die geselecteerde leerling een verzoek aan;
5. de pagina wacht op goedkeuring;
6. na goedkeuring wordt de login automatisch afgerond.

Een verkeerde Google-accountkeuze kan niet stil aan een ander Boekenbaai-account worden gekoppeld. Bij een mismatch wordt de sessie ingetrokken en een eventuele onbedoelde eerste `sub`-verificatie teruggedraaid.

## 7. Controle na deploy

Voer minimaal deze echte controles uit:

1. **Boekenbaai Beheer** toont na selectie een wachtwoordveld en logt lokaal in.
2. Een docent toont geen wachtwoordveld en gaat via **Inloggen** naar Google.
3. Een leerling toont geen wachtwoordveld en gaat via **Inloggen** naar Google.
4. Een vooraf gekoppelde leerling kan met het juiste Google-account direct inloggen.
5. Een niet-vooraf gekoppelde leerling krijgt automatisch een verzoek voor de vóór Google geselecteerde leerling.
6. Een docent ziet alleen leerlingen/verzoeken uit de eigen klas en kan een verzoek goedkeuren.
7. Een `gmail.com`, ander domein of niet-geverifieerd account wordt geweigerd.
8. Een verkeerde Google-accountkeuze geeft geen toegang tot het geselecteerde Boekenbaai-account.
9. Een docent met **Ingelogd blijven** blijft na een Sliplane restart/deploy ingelogd binnen de geldigheidsduur.
10. Het wijzigen van een bestaande Google-koppeling maakt een oude sessie van dat account ongeldig.
11. Na een redeploy zijn de Google-koppelingen nog aanwezig; zo bevestig je meteen dat het volume echt persistent is.

## Technische startvolgorde

De productie-start staat in `package.json` en is bewust:

```text
node --require ./google-auth-security-preload.js \
     --require ./local-password-auth-preload.js \
     --require ./login-flow-policy-preload.js \
     --require ./student-google-handoff-preload.js \
     --require ./google-auth-runtime-preload.js \
     server.js
```

Verander de volgorde of het Sliplane-startcommando niet zonder de volledige auth-integratietests opnieuw te draaien.
