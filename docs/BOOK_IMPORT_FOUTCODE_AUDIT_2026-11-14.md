# Audit foutcodes van Boekenbaai's boekimport

Controle uitgevoerd op de ontwikkelbranch van PR #384 op 14 november 2026. Deze inventaris omvat de bekende foutcodes en relevante validatiestappen van de Excelanalyse, ISBN-/metadata-verrijking, voorraadvergelijking, leerlingen en klassen, uitleenreconciliatie, correctie en definitieve bevestiging.

**Leeswijzer.** De code geeft aan welke fout is ontdekt. De afhandeling hieronder beschrijft de bedoelde veilige behandeling; een tabelrij betekent niet dat elke variant met een echte school-Excel is getest. De regressietests omvatten de beleidsregels en kerngevallen. Echte dekking wordt pas bevestigd met de nieuwe preview op hetzelfde schoolbestand en controle van alle resterende uitzonderingen.

**Algemene regels:** (1) Bronverschil uit één externe provider is geen blokkade. (2) Correct herstelde ISBN's, mislukte vrijblijvende online lookups en optionele kolommen zijn geen verplichte review voor andere geselecteerde onderdelen. (3) Bij ISBN-identiteit, dubbel gebruik van fysieke barcodes, meerdere leners, onzekere exemplaren of conflicterende Excel-identiteit blijft een gerichte menselijke beslissing nodig. (4) Lagere Excelvoorraad verwijdert nooit opgeslagen exemplaren. (5) Bestaande uitleengeschiedenis blijft behouden en oude Excel-snapshots mogen ingeleverde boeken niet opnieuw uitlenen.

## Bestand, upload en revisie (43 codes)

| Foutcode | Betekenis | Afhandeling |
|---|---|---|
| `edition_grouping_failed` | De boekregels konden niet veilig op editie worden gegroepeerd. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `empty_correction` | Er is geen concrete correctie ingevuld. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `empty_file` | Er is geen bestand geselecteerd. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `empty_sheet` | Het werkblad bevat geen boekregels. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `encoded_input_overhead` | Het gecodeerde Excelbestand overschrijdt de maximale uploadgrootte. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `file_too_large` | Het bestand is te groot. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_assignment_choices` | De gekozen administratieve acties zijn niet geldig. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_correction_fields` | De gekozen correctievelden zijn ongeldig. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_correction_index` | De gecorrigeerde Excelrij bestaat niet meer. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_correction_value` | De opgegeven correctiewaarde is ongeldig. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_corrections` | De correcties hebben een ongeldig formaat. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_metadata_choices` | Er is een ongeldige keuze voor boekgegevens gemaakt. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_review` | De controlegegevens zijn niet geldig. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_sheet` | Dit werkblad kan niet worden gelezen. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_skip` | De keuze om een regel over te slaan is ongeldig. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_source_rows` | De bronregels kunnen niet worden verwerkt. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_sync_parts` | De geselecteerde importonderdelen zijn niet geldig. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_sync_resolution_reason` | Deze voorraadkeuze lost het onderliggende conflict niet veilig op. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_sync_resolutions` | De keuzes over de voorraad zijn ongeldig. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `invalid_workbook` | Dit bestand kan niet als Excelwerkboek worden gelezen. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `inventory_not_selected` | Voorraadsynchronisatie is niet geselecteerd. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `inventory_preview_stale` | De bibliotheek is veranderd sinds de laatste controle; bereken opnieuw. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `inventory_template_missing` | Het bestaande voorbeeldexemplaar is intussen veranderd. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `missing_sheet` | Het verwachte werkblad ontbreekt. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `no_sync_parts_selected` | Selecteer minimaal één onderdeel van de bibliotheek om te synchroniseren. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `nothing_to_import` | Er zijn geen wijzigingen om op te slaan. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `review_not_ready` | Er staan nog onopgeloste controlepunten. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `skipped_row_cannot_be_edited` | Een overgeslagen regel kan niet tegelijk gewijzigd worden. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `stage_busy` | Er loopt al een andere importcontrole. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `stage_busy_or_closed` | Deze importcontrole is niet meer actief. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `stale_assignment_choice` | Een oude administratieve keuze hoort niet meer bij de actuele vergelijking. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `stale_metadata_choice` | Een oude boekgegevenskeuze hoort niet meer bij de huidige Excelrij. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `stale_or_invalid_choice` | De uitgestelde keuze is verlopen of niet geldig. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `stale_review` | De controle is gewijzigd; bereken de voorgestelde veranderingen opnieuw. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `too_many_columns` | Het werkblad bevat te veel kolommen. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `too_many_rows` | Er staan meer boekregels in het bestand dan toegestaan. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `unknown_sync_resolution` | Deze voorraadkeuze hoort niet meer bij de actuele editie. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `unsafe_assignment_choice` | Deze keuze mag een onzekere uitleen- of locatiekoppeling niet forceren. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `unsafe_metadata_override` | Een onveilig boekgegevensconflict kan niet met één keuze worden overruled. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `unsafe_row` | Deze regel is nog niet veilig voor definitieve import. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `unsupported_correction_field` | Dit gegeven kan niet via dit correctiescherm worden aangepast. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `worksheet_range_too_large` | Het werkblad bevat een onrealistisch groot bereik. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |
| `xlsx_unavailable` | De Excelverwerking is tijdelijk niet beschikbaar. | Afwijzen of opnieuw controleren; geen gedeeltelijke opslag |

## ISBN en boekidentiteit (26 codes)

| Foutcode | Betekenis | Afhandeling |
|---|---|---|
| `source_row_requires_review` | Controleer de bronregel voordat deze wijziging mag doorgaan. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `ambiguous_existing_edition_isbn` | Een bestaand exemplaar bevat tegenstrijdige ISBN-velden. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `ambiguous_isbn_lookup_results` | Online bronnen leveren geen eenduidige ISBN-match op. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `ambiguous_metadata_editions` | Een titel en auteur verwijzen naar meerdere edities. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `ambiguous_metadata_results` | Online resultaten bij deze titel zijn niet eenduidig. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `author_sources_differ` | De auteurskolommen binnen Excel spreken elkaar tegen. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `conflicting_edition_isbns` | Twee ISBN-velden wijzen op verschillende edities. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `conflicting_isbn_repair_suggestions` | Er zijn verschillende mogelijke ISBN-correcties. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `conflicting_source_columns` | Twee Excelkolommen voor hetzelfde gegeven spreken elkaar tegen. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `edition_identity_conflict` | Verschillende Excelboeken hebben hetzelfde ISBN maar andere titels. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `edition_identity_mismatch` | De titel of auteur komt niet overeen met de bestaande ISBN-editie. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `invalid_or_unrecognized_isbn` | De ingevulde ISBN-waarde wordt niet herkend. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `junk_title` | De ingevulde titel is geen bruikbare boektitel. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `metadata_identifier_conflict` | Een externe boekbron geeft tegenstrijdige ISBN-gegevens. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `metadata_isbn_conflicts_with_repair_suggestion` | Het gevonden ISBN wijkt af van het herstelvoorstel. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `metadata_isbn_differs` | De online metadata noemt een ander ISBN. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `metadata_title_conflict` | Onafhankelijke ISBN-bronnen bevestigen een inhoudelijk andere titel. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `missing_author` | Er ontbreekt een auteur. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `missing_author_after_metadata` | Er ontbreekt nog steeds een auteur na de online controle. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `missing_title` | Er ontbreekt een boektitel. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `missing_title_after_metadata` | Er ontbreekt nog steeds een titel na de online controle. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `missing_title_or_author` | Een nieuw exemplaar moet een titel en auteur hebben. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `missing_valid_isbn` | Er ontbreekt een geldig ISBN. Controleer de boekeditie. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `possible_existing_book_without_isbn` | Er bestaat mogelijk al een exemplaar zonder opgeslagen ISBN. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `title_author_mismatch` | Het gevonden exemplaar heeft een andere titel of auteur. | Vergelijken met ISBN en bestaande gegevens; bij onveilig verschil behouden/controleren |
| `unsupported_identifier_type` | Een ISBN-veld bevat een ongeldig gegevenstype. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |

## Online bronnen en optionele boekvelden (17 codes)

| Foutcode | Betekenis | Afhandeling |
|---|---|---|
| `conflicting_excel_values` | Meerdere Excelrijen voor hetzelfde ISBN bevatten verschillende waarden. | Bestaande waarde behouden tot Excelrijen zijn gecorrigeerd |
| `ambiguous_identifier_interpreted_as_barcode` | Een gecombineerde kolom is als fysieke barcode herkend. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `ambiguous_identifier_interpreted_as_isbn` | Een gecombineerde kolom is als ISBN herkend. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `dangerous_headers_ignored` | Een onveilige of onbekende kolomnaam is genegeerd. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `invalid_page_count` | Het aantal pagina’s is ongeldig. | Alleen relevant wanneer deze kolom wordt gesynchroniseerd; anders ongemoeid |
| `invalid_published_year` | Het verschijningsjaar is ongeldig. | Alleen relevant wanneer deze kolom wordt gesynchroniseerd; anders ongemoeid |
| `isbn_repair_suggested` | Er is een ISBN-correctie mogelijk maar nog niet bevestigd. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `isbn_repaired` | Het ISBN is met een zekere, controleerbare reparatie hersteld. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `isbn_resolved_from_metadata` | Het ISBN is uit passende boekinformatie aangevuld. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `language_hint_conflict` | De ingevulde taal en de taal van het examenmateriaal spreken elkaar tegen. | Alleen relevant wanneer deze kolom wordt gesynchroniseerd; anders ongemoeid |
| `metadata_differs_from_excel` | De externe boekinformatie wijkt af van Excel. Dit is op zichzelf geen fout. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `metadata_lookup_failed` | Online boekinformatie kon niet worden opgehaald. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `metadata_not_strict_match` | De gevonden boekinformatie past niet precies bij de opgegeven titel en auteur. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `metadata_not_usable` | De gevonden boekinformatie is niet betrouwbaar genoeg om over te nemen. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `nonstandard_easy_reading_value` | De invoer voor Makkelijk lezen wijkt af; elke niet-lege waarde telt als ja. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `title_author_metadata_missing_edition_isbn` | De gevonden titel en auteur hebben geen controleerbaar ISBN. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `unexpected_exam_material_value` | De kolom Examenmateriaal bevat een onbekende waarde. | Alleen relevant wanneer deze kolom wordt gesynchroniseerd; anders ongemoeid |

## Voorraad en fysieke barcodes (22 codes)

| Foutcode | Betekenis | Afhandeling |
|---|---|---|
| `ambiguous_unlabelled_copy_metadata` | Meerdere niet-gelabelde exemplaren hebben verschillende boekgegevens. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `barcode_belongs_to_other_edition` | Deze fysieke barcode hoort bij een andere ISBN-editie. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `barcode_with_multiple_copies` | Eén individuele barcode kan niet meerdere fysieke exemplaren aanwijzen. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `barcodes_exceed_new_copies` | Er staan meer nieuwe fysieke barcodes dan extra exemplaren in Excel. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `conflicting_physical_barcodes` | Twee fysieke barcodekolommen spreken elkaar tegen. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `copy_limit_exceeded` | De totale hoeveelheid in het bestand overschrijdt de veilige importlimiet. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `duplicate_physical_barcode` | De fysieke barcode staat meerdere keren in het bestand. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `duplicate_printed_barcode` | Een individuele fysieke barcode staat bij meerdere exemplaren. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `existing_edition_requires_review` | Deze ISBN-editie staat al in Boekenbaai. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `existing_physical_barcode_requires_correction` | De barcode is al gekoppeld aan een ander boek. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `invalid_physical_barcode` | De individuele scanbarcode is ongeldig. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `invalid_quantity` | Het aantal exemplaren is ongeldig. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `isbn_barcode_belongs_to_other_edition` | Deze ISBN-scanbarcode wordt al voor een andere editie gebruikt. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `printed_barcode_requires_one_copy` | Bij een individuele barcode hoort precies één exemplaar. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `quantity_limit_exceeded` | Het aantal nieuwe exemplaren voor deze editie is te groot. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `reduction_requires_manual_review` | Excel vermeldt minder exemplaren dan de bibliotheek. Er wordt niets verwijderd. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `source_conflict_or_missing_identity` | Een boekregel bevat onopgeloste brongegevens of mist een betrouwbare identiteit. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `source_needs_review` | Een bronregel heeft een nog onopgelost invoer- of ISBN-probleem. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `too_many_copies` | Het aantal toe te voegen exemplaren overschrijdt de limiet. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `unmatched_physical_copies` | De nieuwe exemplaren zijn niet eenduidig aan Excelrijen te koppelen. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `warnings_need_confirmation` | Er zijn nog echte bronwaarschuwingen waarvoor bevestiging nodig is. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |
| `workbook_physical_barcode_conflict` | Nieuwe fysieke barcodes conflicteren met elkaar. | Geen exemplaren wissen; alleen veilig identificeerbare aantallen overnemen |

## Klassen, locaties en privéboeken (16 codes)

| Foutcode | Betekenis | Afhandeling |
|---|---|---|
| `class_context_needs_review` | De klasvermelding zegt niet of het om een vaste plek of een uitlening gaat. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |
| `class_context_requires_classification` | Geef aan of de klasvermelding een vaste plek of een uitlening betekent. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |
| `class_followup_book_borrowed` | Het boek is al uitgeleend, waardoor de klaslocatie niet vanzelf kan worden gewijzigd. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |
| `class_followup_requires_physical_copy_match` | De klasvermelding kan niet aan één fysiek exemplaar worden gekoppeld. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |
| `class_loan_ambiguous` | De genoemde uitleenklas kan meerdere klassen bedoelen. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |
| `class_loan_unmatched` | De genoemde uitleenklas is niet gevonden. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |
| `fixed_location_needs_manual_identification` | De vaste plek kan niet eenduidig worden bepaald. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |
| `fixed_location_needs_review` | De vaste klaslocatie is niet eenduidig. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |
| `library_presence_needs_review` | De vermelding over aanwezigheid in de bibliotheek is onduidelijk. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `location_context_requires_followup` | Het fysieke boek of de vaste klaslocatie kan niet veilig worden gekoppeld. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |
| `ml_structuurbb_fixed_location` | De Makkelijk Lezen-regel is als vaste locatie SK BB geïnterpreteerd. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `multiple_class_contexts` | Deze Excelrij noemt meerdere klassen zonder eenduidige betekenis. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |
| `own_book_context_conflict` | Dezelfde regel is tegelijk als privéboek en schoolboek aangeduid. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |
| `own_book_excluded` | Dit privéboek wordt niet aan de schoolcollectie toegevoegd. | Informatief of automatisch behouden; geen aparte akkoordvraag |
| `student_loan_ambiguous` | De leerlingnaam hoort mogelijk bij meerdere accounts. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |
| `student_loan_unmatched` | De genoemde leerling kan niet gevonden worden. | Alleen binnen geselecteerde context; onduidelijke bestemming laten beoordelen |

## Uitleningen en correcties (29 codes)

| Foutcode | Betekenis | Afhandeling |
|---|---|---|
| `loan_context_requires_followup` | De uitlening kan nog niet veilig aan een leerling of klas gekoppeld worden. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `ambiguous_existing_borrower` | Meerdere bestaande exemplaren staan op dezelfde lener. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `ambiguous_physical_copy` | Het juiste fysieke exemplaar kan niet veilig worden vastgesteld. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `borrowed_without_borrower` | Het boek staat uitgeleend zonder dat de lener bekend is. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `borrower_not_uniquely_matched` | De lener kan niet eenduidig aan een account worden gekoppeld. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `borrower_status_disagrees` | De uitleenstatus en geregistreerde lener spreken elkaar tegen. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `conflicting_current_borrowers` | Het bestaande exemplaar heeft tegelijk een leerling en een klas als lener. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `conflicting_excel_borrowers` | Excel noemt tegelijk een leerling en een klas als lener. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `conflicting_loan_context` | Excel geeft tegenstrijdige uitleencontext. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `copy_requires_single_excel_row` | Deze uitleen- of locatieregel moet één fysiek exemplaar betreffen. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `deferred_copy_mismatch` | Het later te controleren exemplaar is intussen gewijzigd. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `duplicate_corrected_student_edition` | Twee handmatig gekozen uitleningen geven dezelfde editie aan één leerling. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `duplicate_student_loan_in_workbook` | Excel vermeldt meerdere exemplaren van hetzelfde ISBN bij dezelfde leerling. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `inactive_student` | De genoemde leerling is niet meer actief. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `loan_book_student_records_disagree` | Het boek en de leerlingregistratie vermelden verschillende uitleningen. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `loan_borrower_changed` | De uitleenregistratie is sinds de controle gewijzigd. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `loan_borrower_inactive` | De lener is niet meer actief. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `loan_borrower_needs_review` | De leerling of klas is niet eenduidig herkend. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `loan_copy_borrowed_by_other` | Dit fysieke exemplaar is al aan een andere leerling of klas uitgeleend. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `loan_copy_missing` | Het gekozen fysieke boek voor de uitlening is niet meer beschikbaar. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `loan_requires_physical_copy_match` | Zonder unieke fysieke identificatie is de juiste uitgeleende kopie niet zeker. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `loan_requires_single_copy` | Een uitleenregistratie moet één fysiek exemplaar aanwijzen. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `missing_existing_class` | De bestaande uitleenklas is niet meer bekend. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `missing_existing_student` | De bestaande lener is niet meer als leerling bekend. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `no_unallocated_copy` | Alle overeenkomstige fysieke exemplaren zijn al gekoppeld. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `physical_barcode_not_found` | De individuele scanbarcode hoort bij geen bestaand exemplaar. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `physical_copy_not_found` | Er is nog geen fysiek exemplaar van dit ISBN geregistreerd. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |
| `student_already_borrowed_edition` | De leerling heeft deze ISBN-editie al. | Veilig blokkeren bij werkelijk conflict of ontbrekende identiteit; gericht corrigeren |
| `student_loan_records_disagree` | De boekenregistratie en de uitleenlijst van de leerling komen niet overeen. | Geen lener verzinnen of oude uitlening herhalen; kopie controleren |

## Beleid: zo min mogelijk handmatige stappen

De uitgangspunten van deze aanvullende audit zijn praktisch en ISBN-georiënteerd. De code verifieert niet of een boek perfect beschreven is, maar of de juiste editie wordt gekoppeld aan de juiste fysieke exemplaren.

- **Zekerheid over identiteit:** het ISBN blijft geldig en gelijk. Een ander boek, een ander deelnummer, een fysiek barcodeconflict of onzekere wissel van lener blijft een echt controlepunt.
- **Bibliografische schrijfvarianten:** kleine accent-, interpunctie- en typeverschillen in auteurs/titels en voldoende specifieke serie-/ondertitelvarianten tellen bij hetzelfde ISBN als dezelfde editie. Twee onafhankelijke ISBN-bronnen mogen kleine spellingfouten verbeteren. Inhoudelijk verschillende boeken mogen niet worden samengevoegd.
- **Onbelangrijke verschillen:** een kleine afwijking in pagina-aantal, een onzekere drukjaarvariant en een ongeldige optionele Excelkolom veroorzaken geen verplichte beslissing. De geldige bestaande gegevens blijven staan, tenzij de beheerder bewust een andere waarde kiest.
- **Automatische verrijking:** gratis ISBN-bronnen worden geraadpleegd na één opt-in in het importscherm; deze voorkeur wordt voor volgende imports onthouden zodat een groot bestand niet onverwacht honderden externe verzoeken start. Betrouwbare ontbrekende beschrijvingen, omslagen, uitgevers, jaren, pagina-aantallen, talen en trefwoorden kunnen worden aangevuld zonder bestaande schoolinformatie te overschrijven. Aanvullende gratis bronkeywords blijven afzonderlijk bewaard en worden via de bestaande gecontroleerde themaregels beschikbaar voor ‘Help me kiezen’. Betalende Brave-zoekopdrachten vereisen aparte toestemming.
- **Veilige administratieve standaard:** een onduidelijke klasnotitie wordt niet als nieuwe uitlening of nieuwe vaste locatie geïnterpreteerd. De bestaande registratie blijft behouden en de reden komt in het importverslag. Duidelijke, unieke uitleningen blijven automatisch voorgesteld; echte borrower-, ISBN- en kopieconflicten blijven controleerbaar.
- **Verantwoording en correctie:** de preview toont aantallen automatische wijzigingen, behoudkeuzes, informatieve meldingen en unieke handmatige dossiers. Het volledige verslag bewaart bronkeuzes en automatisch genegeerde klasnotities. Automatische keuzes zijn herzienbaar.

**Acceptatievoorwaarde:** de echte test moet aantonen dat de verplichte controles beperkt blijven tot inhoudelijke ISBN-, editie-, barcode-, voorraad- of uitleningsconflicten, en niet opnieuw oplopen door schrijfwijze-, pagina-, bron- of optionele veldverschillen.

## Wat de CI automatisch controleert

- De foutcodecatalogus wordt tegen de expliciet in productiemodules uitgegeven codes gecontroleerd; een nieuwe ongemapte foutcode laat de test mislukken.
- De importplanner test verschillende combinatiekeuzes voor voorraadsync, uitleenregistraties, vaste locaties en losse metadatavelden.
- ISBN-verrijking test afwijkende titels van één en meerdere bronnen, bronafstemming, schrijffouten, meerdere auteurs en expliciete correcties.
- Voorraad en fysieke barcodes worden getest op dubbele exemplaren, veilige bestandsherhaling, ontbrekende ISBN's, niet verwijderen en auteurs-/titelvarianten.
- HTTP-tests controleren preview, herberekenen, atomair bevestigen, bewaren van bestaande uitleningen en bronherkomst.

## Nog verplicht in de echte acceptatie

1. Annuleer de huidige oude preview zonder definitief te importeren.
2. Begin na goedgekeurde review en deployment met exact hetzelfde Excelbestand en dezelfde aangevinkte importonderdelen.
3. Controleer de aantallen na categorisering: hoeveel unieke ISBN's, hoeveel echte ISBN-identiteitsconflicten, hoeveel fysieke/barcodeconflicten, hoeveel onzekere uitleningen, hoeveel enkel informatieve meldingen.
4. Controleer steekproeven op bestaande exemplaren, reeds geleende boeken, vaste klaslocaties en multi-auteurboeken.
5. Bevestig pas wanneer er uitsluitend logisch verklaarbare, gerichte handmatige gevallen overblijven.

**Beperking:** Deze audit kan geen inhoudelijke fouten in het echte Excelbestand uitsluiten zonder dat bestand en de actuele schooldatabase tegelijk te vergelijken. Dit rapport mag daarom niet worden gelezen als een garantie van nul nieuwe meldingen.
