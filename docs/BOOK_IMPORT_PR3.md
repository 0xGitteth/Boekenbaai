# PR3: beheerpreview, corrigeerbare analyse en veilig toepassen

Status: **in ontwikkeling**. Deze PR mag niet worden gemerged voordat de stappen hieronder volledig zijn aangesloten en getest.

## Gereed in de eerste bouwstap

- Correcties gebeuren op veilige kopieën van bronrijen. Originele Excelwaarden blijven beschikbaar.
- Correcties van titel, auteur, ISBN, barcode, hoeveelheid en bibliografische velden wissen de conflicterende aliaskolommen voor dat veld en lopen opnieuw door dezelfde PR2 analyse.
- Ongeldig ISBN, ongeldige hoeveelheid, dubbele of onbekende correcties worden afgewezen.
- Uitsluiten gebeurt per rij en behoudt het oorspronkelijke rijnummer.
- Een afzonderlijk beslisoverzicht maakt onderscheid tussen veilige rijen, overslaan, onopgeloste conflicten, waarschuwingen die bevestiging vragen en edities die mogelijk al bestaan.
- Bestaande edities, waaronder uitgeleende boeken, worden **niet** stil overschreven of gedupliceerd.

## Nog vereist voor een voltooide PR3

1. Beveiligde preview API voor beheerders, met server-side tijdelijk opgeslagen bronbestand/analyse en korte vervaltijd. Een client mag nooit zijn eigen staging-resultaat als autoriteit naar het opslageindpunt sturen.
2. Formulier in het beheerdersportaal voor upload, statusoverzicht, per-rij correctie, bronherkomst, conflicten en expliciet overslaan.
3. Reanalyse na correcties, plus bevestiging van waarschuwingen. Conflicten en onopgeloste rijen mogen niet stil doorglippen.
4. Bevestigings- en apply-endpoint met server-side autorisatie, batch/token binding, eenmalige uitvoering, actuele databasecontrole en begrensde aantallen.
5. Alleen expliciet bevestigde nieuwe fysieke exemplaren maken. Bestaande edities en de vraag wat er bij heruploads moet gebeuren veilig apart behandelen in PR4; geen stille overschrijvingen, synchronisatie of verwijderingen.
6. Per-rij verslag en veldherkomst duurzaam vastleggen, ook voor overgeslagen/geblokkeerde rijen, zonder leerlinggegevens publiek te maken.
7. API-integratietests: onbevoegd/ongeldig verzoek, replay, verlopen token, gelijktijdig toepassen, leenstatus, corrupt bestand, rollback/partiële schrijffout, aanwezige collectie en regressies op de bestaande import.

De bestaande directe Excelimport blijft tijdens deze ontwikkelstap ongemoeid. Pas wanneer de nieuwe flow compleet en veilig is, wordt bepaald hoe de beheerinterface de oude import vervangt.
