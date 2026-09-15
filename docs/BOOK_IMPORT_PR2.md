# Book import staged analysis (PR2)

PR2 adds a pure analysis layer for library inventory spreadsheets. It interprets source rows and returns a staged result for a later preview/apply flow. It does not mutate the database, create loans, change locations, or send notifications.

## Boundary

`book-import-workbook.js` reads the first Excel worksheet and maps known column aliases without evaluating accessors or unsafe prototype keys. `book-import-analysis.js` interprets those mapped rows and reuses the PR1 edition-identity core for ISBN equivalence and physical-copy grouping.

The analyzer accepts optional metadata resolvers and current student/class lists as read-only inputs. Metadata can fill genuinely missing fields, but a differing non-empty Excel value is retained and reported rather than silently overwritten.

## Current inventory columns

The current school inventory shape is recognized directly, including:

- `Achternaam schrijver`
- `Voornaam schrijver`
- `Titel`
- `ISBN-nummer`
- `Taal`
- `Makkelijk lezen?`
- `Examenmateriaal`
- `Klassen`
- `Geleend door klas`
- `naam leerling`
- `Aanwezig bieb`

Alternative established column names remain supported through explicit aliases. Unknown columns are reported in the analysis instead of being silently assigned a meaning.

## Important interpretations

- `ISBN-nummer` is edition identity. It is never silently copied to the physical barcode.
- A dedicated barcode column remains physical-copy data. A combined `Barcode / ISBN` column is deliberately marked ambiguous. A valid ISBN may be interpreted as edition identity; a value that still looks like a malformed ISBN remains an ISBN problem and is not silently reclassified as a physical barcode. A clearly non-ISBN identifier may remain a barcode with a warning.
- Valid ISBN formatting and official registration boundaries from PR1 remain authoritative. PR2 never removes invalid group/publisher separators merely to make an ISBN pass validation or to generate a checksum suggestion.
- `Voornaam schrijver` and `Achternaam schrijver` are combined when a direct author column is absent. Placeholder author values such as `nvt` do not block real split-name data. Direct author cells with explicit semicolon/newline or ` & ` separators are retained as structured multiple authors.
- Any non-empty `Makkelijk lezen?` value means easy-reading. Unusual values remain true but generate a warning for the preview.
- `Examenmateriaal = Ja` marks a book suitable for the state-exam reading list. `Strip` is not exam approval; it adds a strip/comic hint. `Engels` is not exam approval; it supplies an English-language hint when the language field is empty.
- `eigen boek`, `vast in de klas` and `Klassenboek` are semantic markers in their own right, independent of which Excel cell or column contains them. They are extracted as context and do not simultaneously become title/author/ISBN/other book metadata. `eigen boek` excludes that row from the school collection. `vast in de klas` and `Klassenboek` mean a school-library book with a fixed classroom location that still needs review.
- Real names in `naam leerling` are matched only when exactly one supplied student matches. Duplicate names are conflicts.
- `Geleend door klas` is normally loan context. Fixed physical location and class loan remain separate concepts and may coexist. The confirmed exception is a Makkelijk Lezen book with `Geleend door klas = StructuurBB` and no real student: that means fixed location `SK BB`, not a class loan.
- Ordinary `Klassen` values are deliberately not auto-interpreted. They are preserved as class context for beheer because the column does not reliably mean the same thing as `Geleend door klas`. The three semantic markers above are the explicit exception to that rule.
- A clear junk row whose only meaningful value is `hh` is silently skipped.
- Student, class, loan, and fixed-location context never enters edition identity or edition grouping.

## ISBN repair and metadata

Safe mechanical repairs, such as restoring a dropped leading zero in an unformatted valid ISBN-10, may be applied automatically. Other invalid/truncated/typo ISBN values are not guessed from arithmetic alone. Every populated ISBN field is validated independently, even when another ISBN field contains a valid fallback, so malformed source data remains visible in the preview.

A row is not considered ready merely because an invalid legacy/internal ISBN string exists. New school-import rows require a valid canonical edition ISBN. PR1's legacy identity fallback remains available for existing historical database records, but PR2 does not use title/author or an invalid internal identifier to manufacture edition groups for new unresolved Excel rows.

If title/author metadata lookup returns multiple distinct valid editions for the same work, the analyzer returns an `ambiguous_metadata_editions` conflict with the candidate ISBNs. It does not pick one automatically. When one strict title/author candidate carries a valid edition ISBN and another identifier-less candidate is merely richer, the ISBN-bearing candidate wins so metadata richness cannot displace edition identity. If the source contains a plausible ISBN repair suggestion but strict metadata points to a different edition, that disagreement is a conflict for human review rather than an automatic replacement.

Once an edition ISBN is known, PR2 does not fall back to a work-level title/author search. It uses the exact-ISBN resolver for further enrichment, preventing another edition of the same work from being pulled into an already identified row. If title/author lookup first resolves a missing ISBN, the analyzer may then run exact-ISBN enrichment for the newly identified edition.

Exact ISBN metadata lookups can fill missing bibliographic fields. Identifier-less exact-lookup results are accepted only when they do not contradict the row's known title/author evidence. A conflicting title returned for the same exact ISBN is a blocking conflict and that candidate's other metadata is not merged into the row.

## Output

The staged result contains:

- summary counts;
- recognized and unknown columns;
- every source row with status (`ready`, `warning`, `conflict`, `unresolved`, or `skipped`);
- original worksheet row numbers when SheetJS provides them, so blank spreadsheet rows do not shift later preview references;
- field provenance and exact raw identifier text where relevant, including the exact Excel field that supplied the chosen edition ISBN;
- warnings/conflicts and suggested repairs;
- class/student/fixed-location context for later review;
- edition groups and edition conflicts only for rows with a resolved canonical edition ISBN.

The result is JSON-safe and is intended to feed the PR3 preview/correction layer. PR2 itself performs no persistence. Workbook rows and requested physical-copy expansion are bounded so malformed or unexpectedly large input becomes an explicit analysis error/conflict instead of unbounded work.
