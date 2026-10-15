# PR7: gratis e-mailherinneringen voor boekimporttaken

## Afbakening

De bestaande import, in-app taken, mentorbeslissingen, centraal instelbare herinnerings-/escalatietermijnen en importverslagen blijven werken zonder mailconfiguratie. PR7 voegt alleen optionele e-mails en persoonlijke voorkeuren toe. Er is geen betaald platform of Koraal Workspace-beheerdersrol nodig.

## Afzender: apart gratis Gmail-account

Een beheerder van Boekenbaai maakt bijvoorbeeld `boekenbaai@gmail.com` aan (alleen als die naam beschikbaar is) en beheert dat account. De dienst draait via een eigen Google Apps Script-webapp, uitgevoerd als dat Gmail-account. Boekenbaai spreekt de webapp vanuit Sliplane aan. Firebase is hiervoor niet nodig.

De officiële Google-limiet voor particuliere Apps Script/MailApp-accounts is momenteel 100 ontvangers per 24 uur. Google kan quota aanpassen. Gmail-aflevering en spamfiltering zijn niet gegarandeerd.

## Eenmalige inrichting

1. Log in op het losse Boekenbaai-Gmail-account en open https://script.google.com/.
2. Maak een nieuw zelfstandig Apps Script-project. Vervang `Code.gs` door de inhoud van `google-apps-script/boekenbaai-mail.gs` uit deze repository.
3. Kies in Apps Script **Projectinstellingen > Script Properties** en voeg `BOEKENBAAI_SHARED_SECRET` toe. Gebruik een willekeurige, lange geheime waarde van minimaal 32 tekens, het liefst 64 tekens uit een wachtwoordgenerator. Deel deze niet in GitHub, screenshots of logs.
4. Autoriseer het script eenmalig onder dit Gmail-account om `MailApp.sendEmail` te mogen gebruiken. Publiceer via **Deploy > New deployment > Web app** met **Execute as: Me** en **Who has access: Anyone**. Bewaar de `https://script.google.com/macros/s/.../exec`-URL. De endpoint is publiek bereikbaar, maar accepteert uitsluitend berichten met een geldige server-HMAC. Geef docenten geen toegang tot het script of de geheime sleutel.
5. Voeg als **Sliplane-omgevingsvariabelen** toe:
   - `BOEKENBAAI_MAIL_ENABLED=true`
   - `BOEKENBAAI_MAIL_SCRIPT_URL=https://script.google.com/macros/s/.../exec`
   - `BOEKENBAAI_MAIL_SCRIPT_SECRET=<dezelfde geheime waarde>`
   - `BOEKENBAAI_PUBLIC_URL=https://<publieke Boekenbaai-host>` (zonder extra pad)
   - `BOEKENBAAI_GOOGLE_DOMAIN=koraaledu.nl` (meestal al aanwezig)
6. Herstart de applicatie. De server controleert bij de start en vervolgens ieder uur of er e-mailherinneringen nodig zijn. Na de start vindt de eerste controle na 30 seconden plaats. De server verstuurt niets totdat de configuratie compleet is.
7. Laat één medewerker een **alternatief** werkmailadres verifiëren met de achtcijferige code. Test verzending, ontvangst, het bevestigen van de code en uitzetten van meldingen. Doe dit liefst eerst in een testomgeving zonder echte leerlingdata.

## Persoonlijke instellingen

In het docentenportaal, onder **Mijn account: e-mailherinneringen**, kan de ingelogde medewerker kiezen:
- **Schoolaccount (standaard)**: het gekoppelde `@koraaledu.nl`-adres. Als er nog geen gekoppeld adres is, wordt geen mail verstuurd.
- **Bevestigd alternatief**: een ander zakelijk adres na verificatie met een code in die mailbox. Een nog niet bevestigd adres kan geen herinneringsmail ontvangen. De code verloopt na 24 uur, opnieuw aanvragen kan na vijf minuten en na vijf foute pogingen wordt de code geblokkeerd. De vijfminutentermijn geldt ook na een succesvolle verificatie of het veranderen/uitschakelen van de voorkeur; de wachttijd wordt apart van de pending code bewaard. Bij het verwijderen van een docentaccount verwijdert Boekenbaai ook de gekoppelde herinneringsvoorkeur, het bevestigde alternatieve adres, oude codes en tellergegevens.
- **Uit**: geen e-mail. De gedeelde taken en in-app herinneringen blijven beschikbaar.

De instelling wijzigt nooit het Google-inlogaccount. Een bericht bevat uitsluitend een aantal nog openstaande controles en een HTTPS-link naar het beveiligde docentenportaal. Geen leerlingnaam, klasnaam, boektitel, leenstatus of bron-Exceldata.

## Deduplicatie, foutafhandeling en opslag

- Eén melding per medewerker voor nieuwe herinnerbare taken in de controle. Meerdere klassen/taken worden samengevat. De e-mail noemt het **totale huidige aantal** openstaande herinnerbare taken van die docent, ook als sommige al in een eerdere mail genoemd zijn. Verzendreceipts registreren alleen de nieuw te melden taken.
- Voor iedere combinatie docent + taak + taakcyclus wordt vóór verzending een afzonderlijk claimbestand met exclusieve bestandcreatie (`wx`) opgeslagen in `<BOEKENBAAI_DATA_PATH>.import-mail-receipts/`. Dit pad **moet op hetzelfde blijvende volume als db.json** staan en in back-ups worden opgenomen.
- De server probeert diezelfde herinnering **niet automatisch opnieuw**, ook niet bij een time-out of onduidelijk leveringsresultaat. Dit is bewust *at-most-once*, om dubbele mails na netwerkfouten te voorkomen. Een mailfout heeft geen effect op een open taak of het importverslag.
- Apps Script controleert de SHA-256-HMAC, kloktijd (maximaal vijf minuten verschil), berichtgrootte, adres en uniek verzend-ID. Het gebruikt een lock en een tweede receipt in Script Properties vóór `MailApp.sendEmail`. Er zijn geen betaalde diensten vereist.
- Verificatiemails hebben een random code, opgeslagen als HMAC-hash in de database, en zijn apart van de herinnermailontvangers. Een wachtwoord, API-sleutel of verificatiecode mag niet in logging terechtkomen.
- Bij meerdere actieve Sliplane-instanties moet het receiptpad door alle instanties worden gedeeld en dezelfde exclusieve filecreatie ondersteunen. Zonder zo'n gedeeld volume is deze werkwijze voor meerdere instanties niet voldoende.

## Testbereik

`npm test` draait gerichte tests voor: herinneringsdag vs escalatiedag, leerlingenprivacy, klasrechten, gewijzigde of inactieve docenten, meerdere klassen, eigen alternatief adres, uit/aan, codebevestiging, herhaalde verzending, netwerkfouten, HMAC en GAS replaybeveiliging, plus echte API-integratietests. De bestaande PR6-import- en heruploadtests blijven onderdeel van dezelfde volledige testreeks.

De verzenddienst kan pas echt worden geactiveerd nadat de gebruiker het Gmail-account en Google Apps Script onder dat account heeft ingericht. Er worden door het toevoegen van deze code geen werkelijke e-mails verstuurd.
