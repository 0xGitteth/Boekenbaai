'use strict';

// Chat recommendations use only curated catalogue themes. No inference
// from an activity (gaming/sport) to a book genre without further answers.
const crypto = require('node:crypto');
const dialogue=require('./student-choice-dialogue');
const {studentLoanIds,isUnavailable,isHidden}=require('./book-catalog-integrity');
const norm = v => String(v || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('nl-NL');
const {workKey}=require('./book-reservations');
const {validateSignals}=require('./student-choice-open-text');
const keyOf = book => workKey(book);
const QUESTION_VALUES = Object.freeze({
  route: ['new','similar','surprise'],
  activity: ['gaming','film','sport','music','nature','other','unknown'],
  situation: ['secret','friends','chance','true','funny','worlds','none'],
  mood: ['exciting','funny','realistic','fantasy','true','none'],
  length: ['short','any'],
  detail: ['action','puzzles','people','worlds','facts','tension',
    'relationships','choices','realistic','adventure','growth','lives',
    'history','schoolhumor','funny','absurd','magic','scifi','none'],
});
const THEME_HINTS = Object.freeze({
  // First answer: broad story direction. Second answer: more specific
  // interest, with a separate vocabulary. These are curated catalogue tags,
  // not guesses from the pupil's hobbies or reading ability.
  secret: ['mysterie','geheim','detective','spanning','thriller'],
  friends: ['vriendschap','relaties','familie','school','opgroeien'],
  chance: ['avontuur','actie','ontdekken','identiteit'],
  true: ['waargebeurd','biografie','geschiedenis','maatschappij','non-fictie','non fictie'],
  funny: ['humor','grappig','komedie'],
  worlds: ['fantasy','fantasie','magie','sciencefiction','science fiction','sci-fi'],

  puzzles: ['detective','mysterie','geheim','puzzel'],
  tension: ['spanning','thriller','horror','mysterie'],
  people: ['psychische gezondheid','relaties','familie','identiteit','vriendschap'],
  relationships: ['vriendschap','relaties','familie'],
  choices: ['identiteit','opgroeien','maatschappij','psychische gezondheid'],
  realistic: ['school','opgroeien','familie','maatschappij','vriendschap'],
  adventure: ['avontuur','actie','fantasy','ontdekken'],
  growth: ['identiteit','opgroeien','vriendschap','maatschappij'],
  lives: ['waargebeurd','biografie','maatschappij','psychische gezondheid'],
  history: ['geschiedenis','oorlog','waargebeurd'],
  facts: ['wetenschap','natuur','dieren','maatschappij','non-fictie','non fictie'],
  schoolhumor: ['humor','school','opgroeien'],
  absurd: ['humor','fantasy','fantasie'],
  magic: ['fantasy','fantasie','magie'],
  scifi: ['sciencefiction','science fiction','sci-fi','technologie','wetenschap'],

  // Backwards compatibility for recommendations requested by an older client.
  exciting: ['spanning','thriller','mysterie','actie','avontuur','horror'],
  realisticMood: ['school','familie','vriendschap','maatschappij'],
  fantasy: ['fantasy','fantasie','magie','sciencefiction','science fiction','sci-fi'],
  action: ['actie','avontuur','spanning'],
  worldsLegacy: ['fantasy','fantasie','sciencefiction','avontuur'],
});
// A third and fourth answer add concrete catalogue-theme evidence.
// Unknown answers are ignored. No free-form input becomes a ranking instruction.
const NUANCE_HINTS=Object.freeze({
  "crime": [
    "detective",
    "misdaad",
    "mysterie",
    "thriller"
  ],
  "hidden_history": [
    "geschiedenis",
    "geheim",
    "mysterie"
  ],
  "school_secret": [
    "school",
    "geheim",
    "mysterie"
  ],
  "tech_secret": [
    "technologie",
    "sciencefiction"
  ],
  "horror": [
    "horror",
    "griezel",
    "spanning"
  ],
  "chase": [
    "actie",
    "spanning",
    "achtervolging",
    "avontuur"
  ],
  "psychological": [
    "psychische gezondheid",
    "thriller",
    "mysterie",
    "identiteit"
  ],
  "survival": [
    "overleven",
    "avontuur",
    "waargebeurd",
    "spanning"
  ],
  "family": [
    "familie",
    "relaties",
    "thuis"
  ],
  "identity": [
    "identiteit",
    "opgroeien",
    "zelfvertrouwen"
  ],
  "friendship": [
    "vriendschap",
    "vrienden",
    "relaties"
  ],
  "bullying": [
    "pesten",
    "school",
    "vriendschap"
  ],
  "romance": [
    "liefde",
    "romantiek",
    "verliefd"
  ],
  "conflict": [
    "ruzie",
    "relaties",
    "vriendschap",
    "familie"
  ],
  "justice": [
    "maatschappij",
    "rechtvaardigheid",
    "discriminatie",
    "ongelijkheid"
  ],
  "future": [
    "toekomst",
    "sciencefiction",
    "opgroeien",
    "identiteit"
  ],
  "school": [
    "school",
    "opgroeien",
    "leerlingen"
  ],
  "society": [
    "maatschappij",
    "politiek",
    "samenleving"
  ],
  "sports": [
    "sport",
    "voetbal",
    "wedstrijd"
  ],
  "travel": [
    "reis",
    "avontuur",
    "ontdekken"
  ],
  "nature": [
    "natuur",
    "dieren",
    "buiten"
  ],
  "danger": [
    "spanning",
    "gevaar",
    "avontuur",
    "actie"
  ],
  "quest": [
    "avontuur",
    "zoektocht",
    "ontdekken"
  ],
  "competition": [
    "wedstrijd",
    "sport",
    "uitdaging"
  ],
  "rescue": [
    "actie",
    "redding",
    "avontuur"
  ],
  "confidence": [
    "zelfvertrouwen",
    "opgroeien",
    "identiteit"
  ],
  "biography": [
    "biografie",
    "waargebeurd",
    "levensverhaal"
  ],
  "inspiration": [
    "biografie",
    "opgroeien",
    "waargebeurd"
  ],
  "war": [
    "oorlog",
    "geschiedenis",
    "waargebeurd"
  ],
  "ancient": [
    "geschiedenis",
    "oudheid",
    "verleden"
  ],
  "true_crime": [
    "misdaad",
    "waargebeurd",
    "detective"
  ],
  "historical_life": [
    "geschiedenis",
    "biografie",
    "waargebeurd"
  ],
  "science": [
    "wetenschap",
    "onderzoek",
    "non-fictie",
    "non fictie"
  ],
  "animals": [
    "dieren",
    "natuur"
  ],
  "technology": [
    "technologie",
    "computer",
    "wetenschap",
    "sciencefiction"
  ],
  "earth": [
    "aarde",
    "natuur",
    "milieu",
    "wetenschap"
  ],
  "awkward_school": [
    "school",
    "humor",
    "opgroeien"
  ],
  "pranks": [
    "humor",
    "grappig",
    "school"
  ],
  "friends_humor": [
    "humor",
    "vriendschap"
  ],
  "strange_school": [
    "humor",
    "school",
    "fantasy"
  ],
  "awkward": [
    "humor",
    "opgroeien",
    "grappig"
  ],
  "absurd_humor": [
    "humor",
    "komedie",
    "fantasy"
  ],
  "magic_humor": [
    "humor",
    "magie",
    "fantasy"
  ],
  "sci_fi_humor": [
    "humor",
    "sciencefiction",
    "technologie"
  ],
  "strange": [
    "fantasy",
    "fantasie",
    "humor"
  ],
  "imagination": [
    "fantasie",
    "fantasy",
    "magie"
  ],
  "creatures": [
    "fantasy",
    "magische wezens",
    "dieren"
  ],
  "spells": [
    "magie",
    "tovenarij",
    "fantasy"
  ],
  "myth": [
    "mythologie",
    "legende",
    "fantasy"
  ],
  "magical_quest": [
    "avontuur",
    "magie",
    "fantasy"
  ],
  "robots": [
    "robots",
    "technologie",
    "sciencefiction"
  ],
  "space": [
    "ruimtevaart",
    "heelal",
    "sciencefiction"
  ],
  "dystopia": [
    "dystopie",
    "sciencefiction",
    "maatschappij"
  ],
  "invention": [
    "uitvinden",
    "technologie",
    "sciencefiction",
    "wetenschap"
  ],
  "fantasy_world": [
    "fantasy",
    "fantasie",
    "magie"
  ],
  "future_world": [
    "sciencefiction",
    "toekomst",
    "technologie"
  ],
  "lost_world": [
    "avontuur",
    "mysterie",
    "ontdekken"
  ],
  "nature_world": [
    "natuur",
    "avontuur",
    "dieren"
  ],
  "none": []
});
const LENS_HINTS=Object.freeze({
  "school": [
    "school",
    "opgroeien"
  ],
  "detective": [
    "detective",
    "mysterie"
  ],
  "family": [
    "familie",
    "relaties"
  ],
  "technology": [
    "technologie",
    "sciencefiction"
  ],
  "sports": [
    "sport",
    "wedstrijd"
  ],
  "adventure": [
    "avontuur",
    "ontdekken"
  ],
  "creative": [
    "muziek",
    "kunst",
    "creatief"
  ],
  "identity": [
    "identiteit",
    "opgroeien"
  ],
  "biography": [
    "biografie",
    "waargebeurd"
  ],
  "history": [
    "geschiedenis",
    "oorlog"
  ],
  "nature": [
    "natuur",
    "dieren"
  ],
  "science": [
    "wetenschap",
    "technologie"
  ],
  "magic": [
    "fantasy",
    "magie"
  ],
  "society": [
    "maatschappij",
    "dystopie"
  ],
  "tension": [
    "spanning",
    "thriller"
  ],
  "relationships": [
    "vriendschap",
    "relaties"
  ],
  "humor": [
    "humor",
    "grappig"
  ],
  "none": []
});

function validateChoices(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  const neutral = {route:'new',activity:'unknown',situation:'none',
    mood:'none',length:'any',detail:'none'};
  for (const [field, values] of Object.entries(QUESTION_VALUES)) {
    result[field] = values.includes(input[field]) ? input[field] : neutral[field];
  }
  result.answers=dialogue.validatedAnswers(input.answers);
  result.openSignals=result.route==='surprise'?{prefer:[],avoid:[]}:validateSignals(input.openSignals);
  result.useReadingHistory=input.useReadingHistory!==false;
  result.referencePreference=['spanning','personages','wereld','tempo','sfeer','informatie'].includes(input.referencePreference)
    ?input.referencePreference:'';
  result.referenceBookId=typeof input.referenceBookId==='string'&&input.route!=='surprise'
    ?input.referenceBookId.slice(0,128):'';
  result.nuance=Object.hasOwn(NUANCE_HINTS,input.nuance)?input.nuance:'none';
  result.lens=Object.hasOwn(LENS_HINTS,input.lens)?input.lens:'none';
  result.allowRepeats = input.allowRepeats === true;
  result.seed = typeof input.seed === 'string' ? input.seed.slice(0, 50) : '';
  result.excludeKeys = Array.isArray(input.excludeKeys)
    ? input.excludeKeys.filter(x => typeof x === 'string' && x.length <= 400).slice(0, 200) : [];
  return result;
}
function available(book,loanOwners) {
  return !isUnavailable(book,loanOwners) && !isHidden(book);
}
function groupBooks(db) {
  const map = new Map();
  const loanOwners=studentLoanIds(db);
  for (const book of db.books || []) {
    if (!book || !book.id || isHidden(book) || !norm(book.title)) continue;
    const key = keyOf(book);
    let work = map.get(key);
    if (!work) {
      work = { key, title: String(book.title).slice(0, 300),
        author: String(book.author || '').slice(0, 300),
        themes: [], tags: [], description:'', sourceDescriptions: [],
        pages: null, available: 0, total: 0,
        bookId: book.id, easyReading: false };
      map.set(key, work);
    }
    work.total++;
    if (available(book,loanOwners)) {
      work.available++;
      work.bookId = book.id;
    }
    work.easyReading ||= book.easyReading === true;
    if(typeof book.description==='string'&&book.description.trim()){
      const excerpt=book.description.trim().slice(0,2000);
      if(!work.sourceDescriptions.includes(excerpt))work.sourceDescriptions.push(excerpt);
    }
    for(const tag of [...(Array.isArray(book.tags)?book.tags:[]),
      ...(Array.isArray(book.enrichmentTags)?book.enrichmentTags:[])]){
      if(typeof tag==='string'&&tag.trim()&&!work.tags.includes(tag.trim()))
        work.tags.push(tag.trim().slice(0,100));
    }
    const n = Number(book.pageCount || book.pages);
    if (Number.isInteger(n) && n > 0 && !work.pages) work.pages = n;
    for (const theme of Array.isArray(book.themes) ? book.themes : []) {
      if (typeof theme === 'string' && norm(theme) && !work.themes.some(t=>norm(t)===norm(theme))) {
        work.themes.push(theme.trim().slice(0, 90));
      }
    }
  }
  const works=[...map.values()];
  for(const work of works){
    // Every physical edition can contain independent, verified descriptive
    // evidence. Ranking must see the same union as question selection.
    work.description=work.sourceDescriptions.join('\n');
    delete work.sourceDescriptions;
  }
  return works;
}
function readKeysAndThemes(db, studentId, works) {
  const byCopy = new Map((db.books || []).map(b=>[b.id,keyOf(b)]));
  const byKey = new Map(works.map(w=>[w.key,w]));
  const readKeys = new Set();
  for (const record of db.readingRecords || []) {
    if (record?.subjectType !== 'student' || record.subjectId !== studentId || record.finished !== true) continue;
    const key = byCopy.get(record.bookId) || keyOf(record);
    if (byKey.has(key)) readKeys.add(key);
  }
  for (const item of db.examReadingLists || []) {
    if (item?.studentId !== studentId || item.manualStatus !== 'gelezen') continue;
    const key = keyOf(item);
    if (byKey.has(key)) readKeys.add(key);
  }
  const themes = new Set();
  for (const key of readKeys) for (const theme of byKey.get(key).themes) themes.add(norm(theme));
  return { readKeys, themes };
}
function tie(key, seed) {
  return crypto.createHash('sha256').update(seed + '\0' + key).digest().readUInt32BE(0) / 0xffffffff;
}
function recordedBorrowCounts(db) {
  const byId = new Map((db.books || []).map(book => [String(book.id), keyOf(book)]));
  const counts = new Map();
  for (const entry of db.history || []) {
    if (!entry || !['check_out','check_out_class'].includes(entry.type)) continue;
    const key = byId.get(String(entry.bookId || ''));
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// Surprise skips the questionnaire entirely. When sufficient checkout
// history exists, offer one frequently borrowed title, one title with fewer
// recorded loans, and one random title. Without history, all three are
// random. The counts refer only to recorded Boekenbaai loans.
function surpriseBooks(db, candidates, limit) {
  const counts = recordedBorrowCounts(db);
  const remaining = candidates.slice().sort((a,b) =>
    a.tiebreak-b.tiebreak || a.work.title.localeCompare(b.work.title,'nl'));
  const available = remaining.filter(item => item.work.available > 0);
  // Prefer lendable books even when fewer than three are available.
  const pool = available.length ? available : remaining;
  const selected = [];
  const pick = (item,reason) => {
    if(!item || selected.some(x=>x.work.key===item.work.key))return;
    selected.push({...item, surpriseReason:reason});
  };
  const highest = Math.max(0,...pool.map(item=>counts.get(item.work.key)||0));
  if(highest>=2 && pool.length>=3) {
    const popular = pool.slice().sort((a,b) =>
      (counts.get(b.work.key)||0)-(counts.get(a.work.key)||0) || a.tiebreak-b.tiebreak);
    pick(popular[0], 'Vaak geleend in Boekenbaai');
    const uncommon = pool.filter(item=>item.work.key!==selected[0]?.work.key)
      .sort((a,b)=>(counts.get(a.work.key)||0)-(counts.get(b.work.key)||0)
        || a.tiebreak-b.tiebreak);
    if(uncommon.length && (counts.get(uncommon[0].work.key)||0)<highest) {
      pick(uncommon[0], 'Minder vaak geleend in Boekenbaai');
    }
  }
  for(const item of pool) {
    if(selected.length >= limit)break;
    pick(item,'Een willekeurige keuze uit de bibliotheek');
  }
  // Only the missing slots can be filled by currently unavailable titles.
  for(const item of remaining) {
    if(selected.length >= limit)break;
    pick(item,'Een willekeurige keuze uit de bibliotheek');
  }
  return selected.slice(0,limit);
}
function rankBooks(db, input, { studentId = '', seenKeys = [], limit = 3 } = {}) {
  const choice = validateChoices(input);
  const works = groupBooks(db);
  const alreadySeen = new Set([...seenKeys,...choice.excludeKeys]);
  const read = studentId && choice.useReadingHistory ? readKeysAndThemes(db, studentId, works) : {readKeys:new Set(),themes:new Set()};
  const directionHints=(THEME_HINTS[choice.situation]||[]).map(norm);
  const detailHints=(THEME_HINTS[choice.detail]||[]).map(norm);
  const nuanceHints=(NUANCE_HINTS[choice.nuance]||[]).map(norm);
  const lensHints=(LENS_HINTS[choice.lens]||[]).map(norm);
  const legacyMoodHints=(THEME_HINTS[choice.mood]||[]).map(norm);
  const matchesTags=(themes,hints)=>themes.filter(theme=>
    hints.some(h=>norm(theme).includes(h)));
  const weights=dialogue.preferenceWeights(choice.answers);
  const referencePreferences={
    spanning:['mystery','danger','action'],personages:['people','relationships','friendship','growth'],
    wereld:['setting','fantasy','discovery','adventure'],tempo:['fast','action'],
    sfeer:['calm','humor','unusual'],informatie:['facts','true','science','history'],
  };
  const explicitTraits=referencePreferences[choice.referencePreference]||[];
  for(const trait of explicitTraits)weights.set(trait,(weights.get(trait)||0)+2);
  for(const trait of choice.openSignals.prefer)weights.set(trait,(weights.get(trait)||0)+3);
  const reference=choice.referenceBookId
    ?(db.books||[]).find(book=>book.id===choice.referenceBookId&&!isHidden(book)):null;
  // Similarity MUST use the pooled work, not whichever physical copy had a
  // cover or was last available. Different editions can vary in enrichment.
  const anchor=reference?works.find(work=>work.key===keyOf(reference)):null;
  const workTraits=dialogue.profilesForWorks(works);
  const anchorTraits=anchor?workTraits.get(anchor.key)||new Map():new Map();
  const traitLabels={
    ...require('./student-choice-open-text').LABELS,
    mystery:'geheimen of raadsels',secrets:'een geheim',puzzles:'onderzoek en aanwijzingen',
    people:'de keuzes van mensen',relationships:'relaties',friendship:'vriendschap',
    family:'familie',empathy:'gevoelens',growth:'persoonlijke ontwikkeling',
    outsider:'erbij willen horen',team:'samenwerking',realistic:'herkenbare situaties',
    school:'school',urban:'het leven in de stad',nature:'natuur',
    animals:'dieren',adventure:'avontuur',discovery:'ontdekkingen',
    unusual:'ongewone gebeurtenissen',fantasy:'fantasie',magic:'magie',
    science:'wetenschap',technology:'techniek',history:'geschiedenis',
    true:'waargebeurde gebeurtenissen',facts:'echte informatie',action:'actie',
    danger:'spannende gebeurtenissen',survival:'overleven',competition:'wedstrijd',
    sport:'sport',challenge:'een uitdaging',justice:'rechtvaardigheid',humor:'humor',
    calm:'rustige gebeurtenissen',fast:'veel actie',dialogue:'gesprekken',
    setting:'de omgeving',twist:'onverwachte wendingen',slow:'langzaam opgebouwde spanning',murder:'misdaad met moord',horror:'griezelverhalen',
  };
  const candidates = [];
  for (const work of works) {
    if (!choice.allowRepeats && alreadySeen.has(work.key)) continue;
    // Confirmed reads are not recommendations for a new book; only compare
    // their curated themes when the learner explicitly asks for similarities.
    if (read.readKeys.has(work.key)||anchor?.key===work.key) continue;
    const directionMatches=matchesTags(work.themes,directionHints);
    const detailMatches=matchesTags(work.themes,detailHints);
    const moodMatches=matchesTags(work.themes,legacyMoodHints);
    const nuanceMatches=matchesTags(work.themes,nuanceHints);
    const lensMatches=matchesTags(work.themes,lensHints);
    const matched=[...new Set([...nuanceMatches,...detailMatches,
      ...lensMatches,...directionMatches,...moodMatches])];
    const familiar = choice.route === 'similar'
      ? work.themes.filter(theme => read.themes.has(norm(theme))) : [];
    // The branch-specific second answer should change the recommendations;
    // the first answer still sets the general direction.
    let score = nuanceMatches.length * 32 + detailMatches.length * 17
      + lensMatches.length * 11 + directionMatches.length * 9
      + moodMatches.length * 4 + familiar.length * 6 + (work.available ? 3 : 0);
    const traits=workTraits.get(work.key)||new Map();
    // Exclude known contraindications; absence of a metadata signal is
    // not evidence that a book is free of that subject.
    if(choice.openSignals.avoid.some(trait=>traits.has(trait)))continue;
    const openMatches=choice.openSignals.prefer.filter(trait=>traits.has(trait)).length;
    if(choice.openSignals.prefer.length&&!openMatches)continue;
    const explicitMatch=explicitTraits.reduce((sum,t)=>sum+(traits.get(t)||0),0);
    const matchedDialogue=dialogue.scoreTraits(traits,weights);
    score+=matchedDialogue.value*3;
    let matchedAnchor=0;
    if(anchorTraits.size&&choice.referenceBookId){
      for(const [trait,evidence] of anchorTraits){
        if(traits.has(trait)){
          matchedAnchor++;
          score+=Math.min(evidence,traits.get(trait))*2;
        }
      }
    }
    if (choice.length === 'short' && work.pages) score += work.pages <= 180 ? 14 : -12;
    // Free-time activity is deliberately not mapped to a book's genre.
    candidates.push({ work, matched, familiar, matchedDialogue, matchedAnchor,explicitMatch,openMatches,
      score, tiebreak: tie(work.key, choice.seed) });
  }
  candidates.sort((a,b) =>
    // When asking for books like a chosen reference, offer real matches
    // before unrelated fallback titles, even with reading-history consent.
    (choice.length==='short'&&a.work.pages&&b.work.pages?Number(b.work.pages<=180)-Number(a.work.pages<=180):0)
    || (b.openMatches-a.openMatches)
    || (explicitTraits.length?b.explicitMatch-a.explicitMatch:0)
    || (anchorTraits.size&&choice.referenceBookId
      ?Number(Boolean(b.matchedAnchor))-Number(Boolean(a.matchedAnchor)):0)
    ||b.score-a.score || b.tiebreak-a.tiebreak ||
    a.work.title.localeCompare(b.work.title, 'nl'));
  const count=Math.max(1,Math.min(3,limit));
  const picked=choice.route==='surprise'
    ? surpriseBooks(db,candidates,count)
    : candidates.slice(0,count);
  return {
    suggestions: picked.map(({work,matched,familiar,matchedDialogue,matchedAnchor,surpriseReason})=>({
      key:work.key,bookId:work.bookId,title:work.title,author:work.author,
      available:work.available,total:work.total,
      reason:surpriseReason || (matchedDialogue?.matched?.length
        ?'Dit boek sluit aan bij je interesse in '
          +matchedDialogue.matched.slice(0,2).map(t=>traitLabels[t]||t).join(' en ')
        : choice.referenceBookId&&matchedAnchor>0
          ?'Dit boek heeft kenmerken die aansluiten bij het door jou gekozen boek'
        : matched.length ? 'Thema: '+matched.slice(0,2).join(', ')
        : familiar.length ? 'Sluit aan bij een thema dat je eerder hebt gelezen: '+familiar[0]
          : choice.length==='short' && work.pages && work.pages<=180
            ? work.pages+' pagina’s' : 'Een ander boek uit de bibliotheek'),
    })),
    exhausted: !picked.length && works.length > 0,
    emptyCatalog: works.length===0,
  };
}
module.exports={validateChoices,keyOf,groupBooks,readKeysAndThemes,rankBooks};
