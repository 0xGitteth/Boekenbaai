# PR3: beheerpreview, correcties en gecontroleerd toepassen

Status: **concept / ontwikkelbranch**. Niet mergen vóór afrondende onafhankelijke review, brede tests en een laatste Codex-review.

## Wat nu gebouwd is

- Nieuwe, afzonderlijke beheerroute: `POST /api/admin/book-import-stages` voor een **read-only** Excelanalyse met PR2.
- Beheerpreview in het tabblad Importeren, met aantallen, herkomst, conflicten, waarschuwingen en Excelrijnummers. De oude directe import zit voorlopig achter een uitklapbare legacy-optie; de oude API blijft intact.
- Correcties per rij voor ISBN, titel, auteur, barcode, hoeveelheid, metadata en relevante klas-/leencontext; bronrijen blijven onveranderd. Vervolgens controleert PR2 de gecorrigeerde kopie opnieuw.
- Expliciet overslaan en bevestigen van waarschuwingen. Onopgeloste en tegenstrijdige rijen blokkeren het definitief toepassen.
- Staged data is alleen toegankelijk voor de ingelogde beheerder die de import startte. De server bewaart die tijdelijk in het geheugen, tot 30 minuten na de laatste heranalyse. Per eigenaar bestaan maximaal twee concepten; er is ook een globale capaciteitslimiet.
- Eén definitieve bevestiging met revisienummer: `POST /api/admin/book-import-stages/:id/apply`. De server controleert de actuele bibliotheek opnieuw op ISBN en fysieke barcodes, voordat er **nieuwe** exemplaren worden aangemaakt. De client kan nooit rechtstreeks boekenlijsten naar de apply-route sturen.
- Geactiveerde leerling-/klasleningen worden niet stil geïmporteerd als beschikbare boeken. Eerst corrigeren of overslaan; PR5 bouwt de eigenlijke uitleenovername.
- Veilige single-use uitvoering, met tijdelijk bestand en atomische vervanging van de database bij bevestigde import.
- Per-rij importverslag en veldherkomst blijven bewaard in `bookImportReports` (laatste dertig), en zijn alleen via een beheerroute opvraagbaar: `GET /api/admin/book-import-reports` en `GET /api/admin/book-import-reports/:id`. Na toepassen kan het verslag als JSON worden gedownload.
- Unit- en HTTP-integratietests voor correcties, onbevoegde toegang, dubbele ISBN/barcodes, ongeldige bron, verouderde revisies, tweede beheerder en herhaalde apply.

## Grenzen en bewuste veiligheidskeuzes

- In deze eerste versie: maximaal **1.500 rijen** en **5.000 fysieke exemplaren** per bestand. Workbook-limieten en ZIP-beveiliging uit PR2 blijven actief. UI-uploadgrens 25 MB.
- Ontbrekende metadata kan optioneel via ISBN worden opgezocht; standaard staat de externe lookup uit om onnodig lang wachten te voorkomen.
- **Bestaande edities worden nooit blind aangepast**. De beheerder kan zulke regels overslaan. Veilige inventarissynchronisatie en het bijwerken van bestaande edities horen bij PR4.
- Bij een serverherstart vervallen alle nog onbevestigde previewconcepten; er wordt niets uit die concepten opgeslagen. Bevestigde verslagen blijven in de database.
- PR3 legt klascontext in het importverslag vast; fysiek beheer en het overnemen van leningen komen in PR5/PR6.
- Verslaggegevens kunnen persoonsgegevens bevatten en worden daarom niet beschikbaar gesteld aan leerlingclients.
- De bestaande directe importroute blijft technisch bestaan voor backwards compatibility; die is duidelijk als legacy gemarkeerd.

## Nog af te ronden voordat PR3 samengevoegd mag worden

- De volledige UI en backend zelfstandig adversarieel nalopen, inclusief 401/403, grote bestanden, mislukkende schrijfacties, simultane bevestigingen, metadata, legacy-gedrag en privacy.
- Controleren of de precieze UI op mobiel en desktop bruikbaar is en de oude importer niet ongemerkt als standaard verschijnt.
- Succesvolle brede CI op het **uiteindelijke** PR3-commit, met server/build/UI regressies, en daarna de afgesproken Codex-eindcontrole.
