'use strict';

const {
  canonicalizeBookIsbn13,
  normalizeBookIdentityText,
  normalizeAuthorList,
  createAuthorDisplay,
  getOwnDataValue,
} = require('./book-edition-core');
const {normalizeSource,sourceConsensus,equivalentSpelling,equivalentAuthorName}=require('./book-import-source-confidence');
const {nearlySameBookText,sameBookTitle}=require('./book-import-autonomy');
const {
  addIssue,
  comparableText,
  splitTagValue,
  normalizeYear,
  normalizePageCount,
  normalizeLanguage,
} = require('./book-import-analysis-values');

function ownObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function metadataPayloadFromResult(result) {
  const object = ownObject(result);
  if (!object || getOwnDataValue(object, 'found') === false) return null;
  const metadata = ownObject(getOwnDataValue(object, 'metadata'));
  const fields = ownObject(getOwnDataValue(object, 'fields'));
  if (metadata) {
    if (getOwnDataValue(metadata, 'found') !== false) return metadata;
    if (fields && getOwnDataValue(fields, 'found') === true) return fields;
    return null;
  }
  if (fields) {
    if (getOwnDataValue(fields, 'found') !== false) return fields;
    return null;
  }
  return object;
}

function metadataAuthors(payload) {
  const rawAuthors = getOwnDataValue(payload, 'authors');
  const rawAuthor = normalizeBookIdentityText(getOwnDataValue(payload, 'author'));
  if (Array.isArray(rawAuthors) && rawAuthors.length) return normalizeAuthorList(rawAuthors, rawAuthor);
  if (!rawAuthor) return [];
  const displayParts = rawAuthor
    .split(/[;\n\r]+|\s+&\s+/)
    .map((entry) => normalizeBookIdentityText(entry))
    .filter(Boolean);
  if (displayParts.length > 1) return normalizeAuthorList(displayParts, rawAuthor);
  return normalizeAuthorList(undefined, rawAuthor);
}

function metadataEditionEvidence(payload) {
  const evidence = [];
  for (const field of ['editionIsbn', 'isbn13', 'isbn', 'metadataIsbn', 'barcode']) {
    const canonical = canonicalizeBookIsbn13(getOwnDataValue(payload, field));
    if (canonical) evidence.push({ field, canonical });
  }
  const editionIsbns = Array.from(new Set(evidence.map((entry) => entry.canonical))).sort();
  return {
    editionIsbn: editionIsbns.length === 1 ? editionIsbns[0] : '',
    editionIsbns,
    evidence,
  };
}

function firstNormalized(payload, keys, normalizer) {
  for (const key of keys) {
    const value = getOwnDataValue(payload, key);
    if (value === null || value === undefined || value === '') continue;
    const normalized = normalizer(value);
    if (normalized !== null && normalized !== undefined && normalized !== '') return normalized;
  }
  return null;
}

function normalizeMetadataCandidate(result) {
  const wrapper = ownObject(result);
  const wrapperSource = normalizeBookIdentityText(getOwnDataValue(wrapper, 'source'));
  const payload = metadataPayloadFromResult(result);
  if (!payload) return null;
  const authors = metadataAuthors(payload);
  const title = normalizeBookIdentityText(getOwnDataValue(payload, 'title'));
  const publisher = normalizeBookIdentityText(getOwnDataValue(payload, 'publisher'));
  const publishedYear = firstNormalized(payload, ['publishedYear', 'year', 'publishedAt'], normalizeYear);
  const pageCount = firstNormalized(payload, ['pageCount', 'pages'], normalizePageCount);
  const language = normalizeLanguage(getOwnDataValue(payload, 'language'));
  const coverUrl = normalizeBookIdentityText(getOwnDataValue(payload, 'coverUrl'));
  const description = normalizeBookIdentityText(getOwnDataValue(payload, 'description'));
  const rawTags = getOwnDataValue(payload, 'tags');
  const rawThemes = getOwnDataValue(payload, 'themes');
  const tags = splitTagValue(Array.isArray(rawTags) ? rawTags.join(';') : rawTags);
  const themes = splitTagValue(Array.isArray(rawThemes) ? rawThemes.join(';') : rawThemes);
  const source = normalizeBookIdentityText(getOwnDataValue(payload, 'source')) || wrapperSource;
  const identifierEvidence = metadataEditionEvidence(payload);
  if (!title && !authors.length && !publisher && !publishedYear && !pageCount && !language && !coverUrl
    && !description && !tags.length && !themes.length && !identifierEvidence.editionIsbns.length) return null;
  return {
    title,
    author: createAuthorDisplay(authors),
    authors,
    editionIsbn: identifierEvidence.editionIsbn,
    identifierIsbns: identifierEvidence.editionIsbns,
    identifierEvidence: identifierEvidence.evidence,
    publisher,
    publishedYear,
    pageCount,
    language,
    coverUrl,
    description,
    tags,
    themes,
    source,
  };
}

function metadataCandidatesFromResult(result) {
  if (Array.isArray(result)) return result.map(normalizeMetadataCandidate).filter(Boolean);
  const object = ownObject(result);
  if (!object || getOwnDataValue(object, 'found') === false) return [];
  const candidates = getOwnDataValue(object, 'candidates');
  if (Array.isArray(candidates)) {
    const wrapperSource = normalizeBookIdentityText(getOwnDataValue(object, 'source'));
    return candidates.map(normalizeMetadataCandidate).filter(Boolean).map((candidate) => (
      candidate.source || !wrapperSource ? candidate : { ...candidate, source: wrapperSource }
    ));
  }
  const normalized = normalizeMetadataCandidate(object);
  return normalized ? [normalized] : [];
}

function strictMetadataMatch(rowBook, candidate) {
  const rowTitle = comparableText(rowBook.title);
  const candidateTitle = comparableText(candidate.title);
  if (!rowTitle || !candidateTitle || rowTitle !== candidateTitle) return false;
  const rowAuthors = normalizeAuthorList(rowBook.authors, rowBook.author).map(comparableText).filter(Boolean);
  const candidateAuthors = normalizeAuthorList(candidate.authors, candidate.author).map(comparableText).filter(Boolean);
  if (!rowAuthors.length) return true;
  if (!candidateAuthors.length || rowAuthors.length !== candidateAuthors.length) return false;
  return rowAuthors.every((author) => candidateAuthors.includes(author))
    ||(rowAuthors.length===1&&candidateAuthors.length===1
      &&equivalentAuthorName(rowBook.author,candidate.author));
}

function metadataDoesNotContradict(rowBook, candidate, rowProvenance = null) {
  const rowTitle = comparableText(rowBook.title);
  const candidateTitle = comparableText(candidate.title);
  if (rowTitle && candidateTitle && rowTitle !== candidateTitle) return false;
  const rowAuthors = normalizeAuthorList(rowBook.authors, rowBook.author).map(comparableText).filter(Boolean);
  const candidateAuthors = normalizeAuthorList(candidate.authors, candidate.author).map(comparableText).filter(Boolean);
  if (rowAuthors.length && candidateAuthors.length
    && !rowAuthors.every((author) => candidateAuthors.includes(author))
    && !(rowAuthors.length===1&&candidateAuthors.length===1
      &&equivalentAuthorName(rowBook.author,candidate.author))) {
    const incompleteSplitAuthor = rowProvenance?.author?.source === 'excel'
      && rowProvenance.author.derived === 'combined_name_parts'
      && rowProvenance.author.incomplete === true;
    const rowTokens = comparableText(rowBook.author).split(/\s+/).filter(Boolean);
    const candidateTokens = new Set(comparableText(candidate.author).split(/\s+/).filter(Boolean));
    if (!incompleteSplitAuthor || !rowTokens.length || !rowTokens.every((token) => candidateTokens.has(token))) return false;
  }
  return true;
}

function titleDoesNotContradict(rowBook, candidate) {
  const rowTitle = normalizeBookIdentityText(rowBook?.title);
  const candidateTitle = normalizeBookIdentityText(candidate?.title);
  // Provider formatting is not edition identity evidence. Ignore accents,
  // case, punctuation and insignificant spaces in exact-ISBN title checks.
  return !(rowTitle && candidateTitle && !sameBookTitle(rowTitle,candidateTitle));
}

function candidateScore(candidate) {
  return [
    candidate.editionIsbn ? 1 : 0,
    candidate.coverUrl ? 1 : 0,
    candidate.publisher ? 1 : 0,
    candidate.description ? 1 : 0,
    candidate.publishedYear ? 1 : 0,
    candidate.pageCount ? 1 : 0,
    candidate.language ? 1 : 0,
    candidate.tags.length,
    candidate.themes.length,
  ].reduce((sum, value) => sum + value, 0);
}

function candidateSemanticSignature(candidate) {
  return JSON.stringify([
    comparableText(candidate.title),
    normalizeAuthorList(candidate.authors, candidate.author).map(comparableText).sort(),
    comparableText(candidate.publisher),
    candidate.publishedYear,
    candidate.pageCount,
    comparableText(candidate.language),
  ]);
}

function candidateIdentifierConflict(candidate) {
  const editionIsbns = Array.isArray(candidate?.identifierIsbns) ? candidate.identifierIsbns : [];
  if (editionIsbns.length < 2) return null;
  return {
    code: 'metadata_identifier_conflict',
    editionIsbns: [...editionIsbns],
    evidence: Array.isArray(candidate.identifierEvidence)
      ? candidate.identifierEvidence.map((entry) => ({ field: entry.field, canonical: entry.canonical }))
      : [],
  };
}

function combinedIdentifierConflict(candidates) {
  const conflicts = candidates.map(candidateIdentifierConflict).filter(Boolean);
  if (!conflicts.length) return null;
  return {
    code: 'metadata_identifier_conflict',
    editionIsbns: Array.from(new Set(conflicts.flatMap((conflict) => conflict.editionIsbns))).sort(),
    evidence: conflicts.flatMap((conflict) => conflict.evidence),
  };
}

function selectMetadataCandidate(rowBook, candidates) {
  const strict = candidates.filter((candidate) => strictMetadataMatch(rowBook, candidate));
  if (!strict.length) return { candidate: null, conflict: null };
  const identifierConflict = combinedIdentifierConflict(strict);
  if (identifierConflict) return { candidate: null, conflict: identifierConflict };
  const editionIsbns = Array.from(new Set(strict.map((candidate) => candidate.editionIsbn).filter(Boolean))).sort();
  if (editionIsbns.length > 1) return { candidate: null, conflict: { code: 'ambiguous_metadata_editions', editionIsbns } };
  if (strict.length > 1 && !editionIsbns.length) {
    const signatures = new Set(strict.map(candidateSemanticSignature));
    if (signatures.size > 1) return { candidate: null, conflict: { code: 'ambiguous_metadata_results' } };
  }
  const rankedPool = editionIsbns.length === 1
    ? strict.filter((candidate) => candidate.editionIsbn === editionIsbns[0])
    : strict;
  const ranked = rankedPool.slice().sort((left, right) => candidateScore(right) - candidateScore(left));
  return { candidate: ranked[0], conflict: null };
}

function distinctCandidateTitles(candidates) {
  const titles = new Map();
  for (const candidate of candidates) {
    const key = comparableText(candidate.title);
    if (key && ![...titles.values()].some(title=>sameBookTitle(title,candidate.title)))
      titles.set(key, candidate.title);
  }
  return Array.from(titles.values());
}

function selectIsbnMetadataCandidate(requestedIsbn, candidates, rowBook = null, rowProvenance = null) {
  const requested = canonicalizeBookIsbn13(requestedIsbn);
  if (!requested) return { candidate: null, conflict: null };
  const exact = [];
  const identifierless = [];
  const mismatched = [];
  const mismatchedIdentifierIsbns = new Set();
  const requestedIdentifierConflicts = [];
  for (const candidate of candidates) {
    const internalConflict = candidateIdentifierConflict(candidate);
    if (internalConflict) {
      if (internalConflict.editionIsbns.includes(requested)) requestedIdentifierConflicts.push(candidate);
      else for (const isbn of internalConflict.editionIsbns) mismatchedIdentifierIsbns.add(isbn);
      continue;
    }
    if (candidate.editionIsbn === requested) exact.push(candidate);
    else if (!candidate.editionIsbn) {
      if (!rowBook || metadataDoesNotContradict(rowBook, candidate, rowProvenance)) identifierless.push(candidate);
    } else mismatched.push(candidate);
  }
  if (requestedIdentifierConflicts.length) {
    return { candidate: null, conflict: combinedIdentifierConflict(requestedIdentifierConflicts) };
  }
  const exactTitles = distinctCandidateTitles(exact);
  const contradictoryExactTitles = rowBook
    ? distinctCandidateTitles(exact.filter((candidate) => !titleDoesNotContradict(rowBook, candidate)))
    : [];
  if (exactTitles.length > 1 || contradictoryExactTitles.length) {
    return {
      candidate: null,
      conflict: {
        code: 'metadata_title_conflict',
        editionIsbn: requested,
        titles: exactTitles,
      },
    };
  }
  const compatibleExact = rowBook ? exact.filter((candidate) => titleDoesNotContradict(rowBook, candidate)) : exact;
  const rankedExact = compatibleExact.slice().sort((left, right) => candidateScore(right) - candidateScore(left));
  if (rankedExact.length) return { candidate: rankedExact[0], conflict: null };
  if (mismatched.length || mismatchedIdentifierIsbns.size) {
    return {
      candidate: null,
      conflict: {
        code: 'ambiguous_isbn_lookup_results',
        requestedIsbn: requested,
        returnedIsbns: Array.from(new Set([
          ...mismatched.map((candidate) => candidate.editionIsbn),
          ...mismatchedIdentifierIsbns,
        ])).filter(Boolean).sort(),
      },
    };
  }
  if (identifierless.length > 1) {
    const signatures = new Set(identifierless.map(candidateSemanticSignature));
    if (signatures.size > 1) {
      return { candidate: null, conflict: { code: 'ambiguous_isbn_lookup_results', requestedIsbn: requested, returnedIsbns: [] } };
    }
  }
  const rankedIdentifierless = identifierless.slice().sort((left, right) => candidateScore(right) - candidateScore(left));
  return { candidate: rankedIdentifierless[0] || null, conflict: null };
}

// An exact ISBN can identify a completely different author even when the
// title in the spreadsheet is plausible. Two INDEPENDENT providers must
// unanimously agree on the author before it becomes an identity conflict.
// This is never an automatic author replacement: the physical copy must be
// checked. Cosmetic name differences remain covered by the spelling repair.
function flagIndependentAuthorConflict(row,options){
  const isbn=canonicalizeBookIsbn13(row.book?.editionIsbn);
  if(!isbn||!row.book?.author)return;
  const consensus=sourceConsensus(isbn,'author',row.sourceEvidence||[]);
  if(consensus.agreeing<2
    ||consensus.votes.length!==consensus.agreeing
    ||!consensus.value
    ||equivalentAuthorName(row.book.author,consensus.value)
    ||nearlySameBookText(row.book.author,consensus.value))return;
  const detail={
    field:'author',excelValue:row.book.author,
    confirmedAuthor:consensus.value,sources:consensus.sources,
    sourceCount:consensus.agreeing,editionIsbn:isbn,
  };
  if(options.correctedMetadataFields?.has('author')){
    // Explicit administrator corrections remain possible, but retain the
    // evidence in the audit for later inspection.
    addIssue(row,'metadata_differs_from_excel','warning',{
      ...detail,chosenByAdministrator:true,reviewLevel:'informational',
    });
  }else{
    addIssue(row,'metadata_author_conflict','conflict',detail);
  }
}

// A malformed worksheet ISBN must never be changed on one provider's
// recommendation. A different edition can be accepted only when at least
// two independent, named ISBN providers agree on the SAME exact edition
// and its title + authors match the worksheet.
function independentlyVerifiedTitleIsbn(rowBook,result){
  const sources=Array.isArray(result?.sourceCandidates)
    ?result.sourceCandidates.map(normalizeMetadataCandidate).filter(Boolean):[];
  const votes=new Map();
  for(const candidate of sources){
    const source=normalizeSource(candidate.source);
    if(!source||!candidate.editionIsbn||candidateIdentifierConflict(candidate)
      ||!strictMetadataMatch(rowBook,candidate))continue;
    if(!votes.has(candidate.editionIsbn))votes.set(candidate.editionIsbn,new Map());
    const byProvider=votes.get(candidate.editionIsbn);
    if(!byProvider.has(source))byProvider.set(source,candidate);
  }
  // A dissenting independent ISBN source means this title may have
  // multiple editions. A 2-to-1 majority is not proof of a physical edition.
  const confirmed=[...votes].filter(([,sources])=>sources.size>=2);
  if(confirmed.length!==1 || votes.size!==1)return null;
  const [isbn,providers]=confirmed[0];
  const ranked=[...providers.values()]
    .sort((left,right)=>candidateScore(right)-candidateScore(left));
  return {isbn,candidate:ranked[0],sources:[...providers.keys()].sort()};
}

function sourceSuggestedIsbns(row) {
  const analyses = row?.identifierAnalysis
    ? [row.identifierAnalysis.explicit, row.identifierAnalysis.legacy, row.identifierAnalysis.ambiguous]
    : [];
  return Array.from(new Set(analyses.map((analysis) => analysis?.suggestion?.canonical).filter(Boolean))).sort();
}

function invalidSuppliedScalar(row, field) {
  if (!['publishedYear', 'pageCount'].includes(field)) return null;
  if (row?.book?.[field] !== null) return null;
  const provenance = row?.provenance?.[field];
  if (!provenance || provenance.source !== 'excel') return null;
  return provenance;
}

function setMetadataField(row, field, value, candidate, {
  skipThemeEnrichment = false, correctedMetadataFields = null,
} = {}) {
  if (correctedMetadataFields?.has(field) || (field === 'themes' && skipThemeEnrichment)) return;
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
  const current = row.book[field];
  const currentProvenance = row.provenance?.[field];
  const invalidSource = invalidSuppliedScalar(row, field);
  if (invalidSource) {
    addIssue(row, 'metadata_differs_from_excel', 'warning', {
      field,
      excelValue: Object.prototype.hasOwnProperty.call(invalidSource, 'raw') ? invalidSource.raw : null,
      metadataValue: value,
      sourceInvalid: true,
    });
    return;
  }
  const currentEmpty = current === null || current === undefined || current === '' || (Array.isArray(current) && !current.length);
  if (field === 'tags' && Array.isArray(value) && currentProvenance?.source !== 'excel') {
    const derivedValues = currentProvenance?.source === 'derived'
      ? (Array.isArray(current) ? [...current] : [])
      : (currentProvenance?.includesDerivedValues && Array.isArray(currentProvenance.derivedValues)
        ? [...currentProvenance.derivedValues]
        : []);
    const merged = currentProvenance?.source === 'metadata'
      ? [...derivedValues]
      : (Array.isArray(current) ? [...current] : []);
    for (const tag of value) {
      if (!merged.some((existing) => comparableText(existing) === comparableText(tag))) merged.push(tag);
    }
    row.book.tags = merged;
    row.provenance.tags = {
      source: 'metadata',
      detail: candidate.source || null,
      ...(derivedValues.length ? { includesDerivedValues: true, derivedValues } : {}),
    };
    return;
  }
  if (currentEmpty || currentProvenance?.source === 'metadata') {
    row.book[field] = Array.isArray(value) ? [...value] : value;
    row.provenance[field] = { source: 'metadata', detail: candidate.source || null };
    return;
  }
  const same = JSON.stringify(current) === JSON.stringify(value)
    || (typeof current === 'string' && typeof value === 'string' && comparableText(current) === comparableText(value));
  if (!same) addIssue(row, 'metadata_differs_from_excel', 'warning', { field, excelValue: current, metadataValue: value });
}

function metadataAuthorExtendsIncompleteExcelAuthor(row, candidate) {
  if (!candidate?.author) return false;
  const provenance = row?.provenance?.author;
  if (!provenance || provenance.source !== 'excel' || provenance.derived !== 'combined_name_parts' || provenance.incomplete !== true) return false;
  const currentTokens = comparableText(row?.book?.author).split(/\s+/).filter(Boolean);
  const candidateTokens = new Set(comparableText(candidate.author).split(/\s+/).filter(Boolean));
  return Boolean(currentTokens.length && currentTokens.every((token) => candidateTokens.has(token)));
}

function applyMetadataCandidate(row, candidate, {
  allowIsbnResolution = false, skipThemeEnrichment = false, correctedMetadataFields = null,
} = {}) {
  if (!candidate) return;
  const setField = (field, value) => setMetadataField(row, field, value, candidate, {
    skipThemeEnrichment, correctedMetadataFields,
  });
  if (allowIsbnResolution && !row.book.editionIsbn && candidate.editionIsbn) {
    row.book.editionIsbn = candidate.editionIsbn;
    row.provenance.editionIsbn = { source: 'metadata', detail: candidate.source || null };
    addIssue(row, 'isbn_resolved_from_metadata', 'warning', { editionIsbn: candidate.editionIsbn });
  } else if (row.book.editionIsbn && candidate.editionIsbn && row.book.editionIsbn !== candidate.editionIsbn) {
    addIssue(row, 'metadata_isbn_differs', 'conflict', { excelIsbn: row.book.editionIsbn, metadataIsbn: candidate.editionIsbn });
  }
  setField('title', candidate.title);
  if (correctedMetadataFields?.has('author')) {
    // Keep a deliberate author correction, including a clear, as entered.
  } else if (!row.book.author && candidate.author) {
    row.book.author = candidate.author;
    row.book.authors = [...candidate.authors];
    row.provenance.author = { source: 'metadata', detail: candidate.source || null };
  } else if (candidate.author && comparableText(row.book.author) !== comparableText(candidate.author)) {
    if (row.provenance.author?.source === 'metadata') {
      row.book.author = candidate.author;
      row.book.authors = [...candidate.authors];
      row.provenance.author = { source: 'metadata', detail: candidate.source || null };
    } else if (metadataAuthorExtendsIncompleteExcelAuthor(row, candidate)) {
      const supplementedFrom = row.provenance.author;
      row.book.author = candidate.author;
      row.book.authors = [...candidate.authors];
      row.provenance.author = {
        source: 'metadata',
        detail: candidate.source || null,
        supplementedFrom,
      };
    } else if (!equivalentAuthorName(row.book.author,candidate.author)
      && !nearlySameBookText(row.book.author,candidate.author)) {
      addIssue(row, 'metadata_differs_from_excel', 'warning', { field: 'author', excelValue: row.book.author, metadataValue: candidate.author });
    }
  }
  setField('publisher', candidate.publisher);
  setField('publishedYear', candidate.publishedYear);
  setField('pageCount', candidate.pageCount);
  setField('language', candidate.language);
  setField('coverUrl', candidate.coverUrl);
  setField('description', candidate.description);
  setField('tags', candidate.tags);
  setField('themes', candidate.themes);
}

function acceptSourceVerifiedSpelling(row, options) {
  if(!row.book?.editionIsbn || !Array.isArray(row.sourceEvidence))return;
  const title=sourceConsensus(row.book.editionIsbn,'title',row.sourceEvidence);
  if(title.agreeing<2||title.conflicting
    ||!sameBookTitle(row.book.title,title.value))return;
  for(const field of ['title','author']){
    if(options.correctedMetadataFields?.has(field))continue;
    const result=field==='title'?title:
      sourceConsensus(row.book.editionIsbn,'author',row.sourceEvidence);
    const existing=String(row.book[field]||'');
    if(result.agreeing<2||result.conflicting||!existing||!result.value
      ||existing===result.value
      ||!(field==='author'?equivalentAuthorName(existing,result.value)
        ||nearlySameBookText(existing,result.value)
        :nearlySameBookText(existing,result.value)))continue;
    if(field==='author'){
      const current=Array.isArray(row.book.authors)?row.book.authors:[existing];
      // Never silently drop a coauthor or overwrite a reviewed multi-author
      // list with one supplier's incomplete author entry.
      if(current.length>1 && (!Array.isArray(result.authors)
        ||result.authors.length!==current.length))continue;
      row.book.author=result.value;
      row.book.authors=Array.isArray(result.authors)&&result.authors.length
        ?[...result.authors]:[result.value];
    }else row.book.title=result.value;
    row.provenance[field]={
      source:'metadata',detail:'verified_isbn_spelling',
      correctedFrom:existing,sources:result.sources,
    };
  }
}

function oneStepIsbnTypo(raw,isbn){
  const value=String(raw??'').replace(/[^0-9]/g,'');
  if(!/^97[89]/.test(value) || !/^97[89][0-9]{10}$/.test(isbn))return false;
  if(value.length===13){
    let differing=0;
    for(let i=0;i<13;i++)if(value[i]!==isbn[i])differing++;
    return differing===1;
  }
  if(value.length===12){
    // A missing digit can be repaired only after an independent exact-ISBN
    // match. Do not treat any arbitrary 12-digit UPC as a partial ISBN.
    for(let i=0;i<13;i++){
      if(isbn.slice(0,i)+isbn.slice(i+1)===value)return true;
    }
  }
  return false;
}
function oneNearWorksheetIsbn(row,result){
  const analyses=row?.identifierAnalysis||{};
  const rawValues=[analyses.explicit?.raw,analyses.legacy?.raw,
    analyses.ambiguous?.raw].filter(Boolean);
  const candidates=[...new Set((Array.isArray(result?.isbnSearchCandidates)
    ?result.isbnSearchCandidates:[]).map(canonicalizeBookIsbn13)
    .filter(Boolean))];
  const near=candidates.filter(isbn=>rawValues.some(raw=>
    oneStepIsbnTypo(raw,isbn)));
  return near.length===1?near[0]:'';
}

// Collect only bounded public book catalogue facts for the review UI.
// This is discovery evidence, NEVER the authority that changes an ISBN.
function captureReviewMatchCandidates(row,result,{titleSearch=false}={}){
  const candidates=[
    ...metadataCandidatesFromResult(result),
    ...(Array.isArray(result?.sourceCandidates)
      ?result.sourceCandidates.map(normalizeMetadataCandidate).filter(Boolean):[]),
  ];
  const grouped=new Map();
  for(const candidate of candidates){
    if(!candidate.editionIsbn||candidate.identifierIsbns.length>1)continue;
    const key=candidate.editionIsbn+'|'+(candidate.title||'').toLocaleLowerCase('nl');
    const source=normalizeSource(candidate.source)
      ||(titleSearch?'Google Books':'ISBN-bron');
    if(!grouped.has(key))grouped.set(key,{
      editionIsbn:candidate.editionIsbn,title:candidate.title||'',
      author:candidate.author||'',coverUrl:candidate.coverUrl||'',
      publisher:candidate.publisher||'',language:candidate.language||'',
      publishedYear:candidate.publishedYear||'',pageCount:candidate.pageCount||'',
      sources:[],
    });
    const value=grouped.get(key);
    if(!value.sources.includes(source))value.sources.push(source);
    if(!value.coverUrl&&candidate.coverUrl)value.coverUrl=candidate.coverUrl;
    for(const field of ['publisher','publishedYear','pageCount','language'])
      if(!value[field]&&candidate[field])value[field]=candidate[field];
  }
  if(titleSearch&&Array.isArray(result?.isbnSearchCandidates)){
    const isbns=[...new Set(result.isbnSearchCandidates
      .map(canonicalizeBookIsbn13).filter(Boolean))];
    for(const isbn of isbns.slice(0,10)){
      if([...grouped.values()].some(candidate=>candidate.editionIsbn===isbn))continue;
      // A title lookup can return several different editions. The
      // worksheet title is NOT asserted as their authoritative title.
      grouped.set(isbn+'|unverified',{
        editionIsbn:isbn,title:row.book?.title||'',
        author:row.book?.author||'',coverUrl:'',publisher:'',
        language:'',sources:['Google Books'],
        unverifiedTitle:true,
      });
    }
  }
  const previous=Array.isArray(row.onlineMatchCandidates)
    ?row.onlineMatchCandidates:[];
  const unique=new Map();
  for(const candidate of [...previous,...grouped.values()]){
    const key=candidate.editionIsbn+'|'+(candidate.title||'').toLocaleLowerCase('nl');
    if(!unique.has(key))unique.set(key,candidate);
    else {
      const earlier=unique.get(key);
      earlier.sources=[...new Set([...(earlier.sources||[]),
        ...(candidate.sources||[])])].slice(0,4);
      if(!earlier.coverUrl&&candidate.coverUrl)earlier.coverUrl=candidate.coverUrl;
      for(const field of ['publisher','publishedYear','pageCount','language'])
        if(!earlier[field]&&candidate[field])earlier[field]=candidate[field];
    }
  }
  row.onlineMatchCandidates=[...unique.values()].slice(0,12);
}

async function resolveMetadata(row, options) {
  const lookupIsbn = typeof options.lookupIsbn === 'function' ? options.lookupIsbn : null;
  const lookupTitleAuthor = typeof options.lookupTitleAuthor === 'function' ? options.lookupTitleAuthor : null;
  // Lookup functions are provided only when the administrator opts in to
  // external metadata enrichment/comparison. Complete Excel rows still need
  // the same provider verification for source-confirmed spelling decisions.
  const enrichExactIsbn = async () => {
    if (!lookupIsbn || !row.book.editionIsbn) return;
    try {
      const result = await lookupIsbn(row.book.editionIsbn, { title: row.book.title, author: row.book.author });
      captureReviewMatchCandidates(row,result);
      // Only actual independent source replies, with an explicitly matching
      // edition ISBN, qualify as evidence for automatic source choices.
      if(Array.isArray(result?.sourceCandidates)){
        row.sourceEvidence=metadataCandidatesFromResult(result.sourceCandidates)
          .filter(candidate=>candidate.editionIsbn===row.book.editionIsbn
            &&Boolean(normalizeSource(candidate.source)))
          .map(candidate=>({
            source:normalizeSource(candidate.source),
            editionIsbn:candidate.editionIsbn,
            title:candidate.title,author:candidate.author,
            authors:candidate.authors,publisher:candidate.publisher,
          }));
      }
      const candidates = metadataCandidatesFromResult(result);
      const selection = selectIsbnMetadataCandidate(row.book.editionIsbn, candidates, row.book, row.provenance);
      if (selection.conflict?.code === 'metadata_title_conflict'
        && options.correctedMetadataFields?.has('title')) {
        // A teacher has explicitly chosen the Excel title during review.
        // Do not import ambiguous metadata, but allow the row to proceed
        // with its own validated ISBN/title/author after warning consent.
        addIssue(row, 'metadata_differs_from_excel', 'warning', {
          field: 'title', excelValue: row.book.title,
          metadataValue: selection.conflict.titles,
          chosenByAdministrator: true,
          reviewLevel: 'informational',
        });
      } else if (selection.conflict?.code === 'metadata_title_conflict') {
        // A third-party title mismatch alone is NOT sufficient evidence that
        // a teacher's ISBN-labelled worksheet row is wrong. Only two or more
        // independent, exact-edition providers agreeing on a materially
        // different title may block the import as a genuine identity conflict.
        const consensus=sourceConsensus(row.book.editionIsbn,'title',row.sourceEvidence||[]);
        const independentlyContradicted=consensus.agreeing>=2
          &&!consensus.conflicting &&consensus.value
          &&row.book.title&&!sameBookTitle(row.book.title,consensus.value);
        if(independentlyContradicted){
          addIssue(row,'metadata_title_conflict','conflict',{
            ...selection.conflict,
            confirmedTitle:consensus.value,
            sources:consensus.sources,
            sourceCount:consensus.agreeing,
          });
        }else{
          addIssue(row,'metadata_differs_from_excel','warning',{
            field:'title',excelValue:row.book.title,
            metadataValue:selection.conflict.titles||[],
            sources:consensus.sources,
            editionIsbn:row.book.editionIsbn,
            reviewLevel:'informational',
          });
        }
      } else if (selection.conflict
        &&['metadata_identifier_conflict','ambiguous_isbn_lookup_results',
          'ambiguous_metadata_results'].includes(selection.conflict.code)) {
        // The worksheet already supplies a structurally valid ISBN. A
        // third-party lookup returning another edition or internally
        // inconsistent identifiers is insufficient proof that Excel is
        // wrong; do not turn a provider error into an inventory blocker.
        addIssue(row,selection.conflict.code,'warning',{
          ...selection.conflict,reviewLevel:'informational',lookup:'isbn',
        });
      } else if (selection.conflict) addIssue(row, selection.conflict.code, 'conflict', selection.conflict);
      else if (selection.candidate) applyMetadataCandidate(row, selection.candidate, {
        skipThemeEnrichment: options.skipThemeEnrichment === true,
        correctedMetadataFields: options.correctedMetadataFields,
      });
      else if (candidates.length) addIssue(row, 'metadata_not_usable', 'warning');
      // Two independent providers with the same exact ISBN may clean up a
      // small typo. Materially different titles never qualify and remain
      // subject to the explicit identity conflict rule above.
      acceptSourceVerifiedSpelling(row,options);
      flagIndependentAuthorConflict(row,options);
    } catch {
      addIssue(row, 'metadata_lookup_failed', 'warning', { lookup: 'isbn' });
    }
  };

  if (row.book.editionIsbn) {
    await enrichExactIsbn();
    return;
  }

  if (!lookupTitleAuthor || !row.book.title || !row.book.author) return;
  try {
    const result = await lookupTitleAuthor({ title: row.book.title, author: row.book.author, language: row.book.language });
    captureReviewMatchCandidates(row,result,{titleSearch:true});
    const candidates = metadataCandidatesFromResult(result);
    let individualSources=Array.isArray(result?.sourceCandidates)
      ?[...result.sourceCandidates]:[];
    // Production Google Books title+author fallback returns no trustworthy
    // edition by itself. Verify its SINGLE candidate ISBN through the
    // existing exact-ISBN multi-provider path before using it to repair.
    const nearbyCandidate=oneNearWorksheetIsbn(row,result);
    const candidateIsbns=nearbyCandidate?[nearbyCandidate]
      :Array.isArray(result?.isbnCandidates)
        ?[...new Set(result.isbnCandidates.map(canonicalizeBookIsbn13)
          .filter(Boolean))]:[];
    if(lookupIsbn && candidateIsbns.length===1){
      try{
        const exact=await lookupIsbn(candidateIsbns[0],{
          title:row.book.title,author:row.book.author,
        });
        captureReviewMatchCandidates(row,exact);
        if(Array.isArray(exact?.sourceCandidates)){
          individualSources.push(...exact.sourceCandidates);
        }
      }catch{
        // A failed optional lookup does not authorize a guessed ISBN.
      }
    }
    const verified=independentlyVerifiedTitleIsbn(row.book,{
      sourceCandidates:individualSources,
    });
    let selection = selectMetadataCandidate(row.book, candidates);
    if(verified && selection.candidate && !selection.candidate.editionIsbn
      && !selection.conflict)
      selection={candidate:verified.candidate,conflict:null};
    // A merged result can include ambiguous editions. A unique independent
    // quorum safely identifies one edition, without guessing among others.
    if(verified && selection.conflict?.code==='ambiguous_metadata_editions')
      selection={candidate:verified.candidate,conflict:null};
    if (!selection.candidate && !selection.conflict && verified)
      selection={candidate:verified.candidate,conflict:null};
    if (selection.conflict) {
      addIssue(row, selection.conflict.code, 'conflict', selection.conflict);
      return;
    }
    if (!selection.candidate) {
      if (candidates.length) addIssue(row, 'metadata_not_strict_match', 'warning');
      return;
    }
    const suggestedIsbns = sourceSuggestedIsbns(row);
    if (selection.candidate.editionIsbn && suggestedIsbns.length
      && !suggestedIsbns.includes(selection.candidate.editionIsbn)) {
      if(!verified || verified.isbn!==selection.candidate.editionIsbn){
        addIssue(row, 'metadata_isbn_conflicts_with_repair_suggestion', 'conflict', {
          suggestedIsbns,metadataIsbn:selection.candidate.editionIsbn,
        });
        return;
      }
      // Keep both original and competing suggestions in the audit. The
      // superseded checksum guess is not a second authoritative edition.
      addIssue(row,'isbn_repair_override_by_sources','warning',{
        suggestedIsbns,metadataIsbn:verified.isbn,
        sources:verified.sources,reviewLevel:'informational',
      });
    }
    if (!selection.candidate.editionIsbn) {
      addIssue(row, 'title_author_metadata_missing_edition_isbn', 'warning', { source: selection.candidate.source || null });
    }
    applyMetadataCandidate(row, selection.candidate, {
      allowIsbnResolution: true, skipThemeEnrichment: options.skipThemeEnrichment === true,
      correctedMetadataFields: options.correctedMetadataFields,
    });
    if (row.book.editionIsbn) await enrichExactIsbn();
  } catch {
    addIssue(row, 'metadata_lookup_failed', 'warning', { lookup: 'title_author' });
  }
}

module.exports = {
  normalizeMetadataCandidate,
  metadataCandidatesFromResult,
  strictMetadataMatch,
  selectMetadataCandidate,
  selectIsbnMetadataCandidate,
  resolveMetadata,
};
