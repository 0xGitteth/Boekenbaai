# PR5-aanvulling: bestaande Excel-uitleningen gecontroleerd overnemen

Dit document hoort bij de aanvulling op de al gemergede [PR5](https://github.com/0xGitteth/Boekenbaai/pull/284). Het oorspronkelijke [zeven-PR-plan](BOOK_IMPORT_REBUILD.md) blijft leidend.

## Wanneer neemt de import een uitlening over?

De bestaande gecontroleerde Excel-import leest `naam leerling` en `Geleend door klas`. Een bestaande uitlening wordt uitsluitend opgeslagen wanneer:

- precies één van beide velden een echte uitleencontext bevat;
- precies één bestaand, actief leerlingaccount óf één bestaande klas ondubbelzinnig op naam matcht;
- het een valide boekeditie met **één uitgeleend fysiek exemplaar per Excelrij** betreft;
- de benodigde boek- en voorraadcontroles geen onopgeloste conflicten tonen;
- de beheerder de volledige importpreview, waarschuwingen en het aantal over te nemen leningen expliciet bevestigt.

**Nieuwe import:** een nieuw fysiek exemplaar kan in één databasebewerking met zijn leerling-/klasuitlening worden toegevoegd.

**Inventarissynchronisatie:** een bestaand exemplaar kan worden gekoppeld via een unieke fysieke barcode. Zonder fysieke barcode mag dat alleen wanneer er precies één bestaand exemplaar en één bijbehorende Excelrij is. Bij een volledig nieuwe editie kan de geplande nieuwe kopie per bronrij worden gebruikt. Een al correct geregistreerde uitlening blijft bij heruploads ongewijzigd.

Bij meerdere bestaande, niet individueel herkenbare exemplaren wordt **niet gegokt** welke kopie is uitgeleend. Ook een leerling met een al geregistreerde lening van dezelfde ISBN-editie, een afwijkende eigenaar, dubbele leerlingnamen, een inactief account of een tegenstrijdige leerling-/klasvermelding blokkeren de automatische overname.

## Wat wordt opgeslagen?

- Het fysieke boek krijgt `status: borrowed` en uitsluitend `borrowedBy` of `borrowedByClassId`.
- De leerling krijgt het fysieke boek-ID in `borrowedBooks`. Klasleningen krijgen geen fictieve leerlingregistratie.
- `borrowedAt` en `dueDate` blijven leeg omdat Excel niet betrouwbaar vertelt **wanneer** de lening begon of eindigt.
- Het gebeurtenislog bevat `loan_imported`, geen nieuwe `check_out`. Historische import wordt daardoor niet als nieuw leesmoment geteld.
- Het beheerdersverslag vermeldt of uitleningen zijn overgenomen of al geregistreerd stonden.
- Leerlingclients krijgen via openbare boeken- of barcoderesponses **nooit** de identiteit van de lener.

## Handmatige acceptatiecontrole

1. Upload een Excelbestand met één bekende leerlinguitlening en controleer in de preview het exacte leerlingaccount, het aantal en het uitleentype. Bevestig; het boek moet vervolgens bij die leerling als actief uitgeleend staan.
2. Herhaal met een klaslening. De vaste fysieke locatie, indien aanwezig, moet ongewijzigd blijven.
3. Herupload dezelfde voorraad via inventarissynchronisatie. Er mogen geen nieuwe kopieën of leenregistraties bijkomen.
4. Test een bestaande editie met twee exemplaren zonder unieke barcodes. De automatische leenkoppeling moet worden geblokkeerd.
5. Test dubbele leerlingen met dezelfde naam, een inactieve leerling, een conflicterende lener en twee exemplaren op één uitleenrij. Niets daarvan mag de database wijzigen.
6. Controleer dat een uitlening die een andere medewerker ná de preview registreert, niet alsnog door een oudere preview wordt overschreven.
7. Controleer bij een leerlinglogin dat de eigen actieve lening zichtbaar is en dat openbare boekenlijsten geen namen, IDs of oude leenidentificaties onthullen.

Onzekere klascontext uit `Klassen` blijft bewust buiten de automatische leenkoppeling. PR6 behandelt zulke gevallen via expliciete opvolgtaken voor docenten en beheerders.