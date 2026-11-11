'use strict';

// Chat recommendations use only curated catalogue themes. No inference
// from an activity (gaming/sport) to a book genre without further answers.
const crypto = require('node:crypto');
const norm = v => String(v || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('nl-NL');
const keyOf = book => JSON.stringify([norm(book.title), norm(book.author)]);
const QUESTION_VALUES = Object.freeze({
  route: ['new','similar','surprise'],
  activity: ['gaming','film','sport','music','nature','other','unknown'],
  situation: ['secret','friends','chance','true','none'],
  mood: ['exciting','funny','realistic','fantasy','true','none'],
  length: ['short','any'],
  detail: ['action','puzzles','people','worlds','facts','none'],
});
const THEME_HINTS = Object.freeze({
  secret: ['mysterie','geheim','detective','spanning','thriller'],
  friends: ['vriendschap','vrienden','relaties','familie'],
  chance: ['avontuur','actie','ontdekken','fantasy'],
  true: ['waargebeurd','biografie','geschiedenis','non-fictie','non fictie'],
  exciting: ['spanning','thriller','mysterie','actie','avontuur','horror'],
  funny: ['humor','grappig','komedie'],
  realistic: ['realistisch','school','vriendschap','familie','maatschappij','relaties'],
  fantasy: ['fantasy','fantasie','magie','sciencefiction','science fiction','sci-fi'],
  action: ['actie','avontuur','spanning'],
  puzzles: ['mysterie','detective','geheim','puzzel'],
  people: ['vriendschap','relaties','familie','school'],
  worlds: ['fantasy','fantasie','sciencefiction','science fiction','avontuur'],
  facts: ['waargebeurd','biografie','geschiedenis','non-fictie','non fictie','wetenschap'],
});
function validateChoices(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [field, values] of Object.entries(QUESTION_VALUES)) {
    result[field] = values.includes(input[field]) ? input[field] : values[0];
  }
  result.allowRepeats = input.allowRepeats === true;
  result.seed = typeof input.seed === 'string' ? input.seed.slice(0, 50) : '';
  result.excludeKeys = Array.isArray(input.excludeKeys)
    ? input.excludeKeys.filter(x => typeof x === 'string' && x.length <= 400).slice(0, 200) : [];
  return result;
}
function available(book) {
  return book.status === 'available' && !book.borrowedBy && !book.borrowedByClassId;
}
function groupBooks(db) {
  const map = new Map();
  for (const book of db.books || []) {
    if (!book || !book.id || !norm(book.title)) continue;
    const key = keyOf(book);
    let work = map.get(key);
    if (!work) {
      work = { key, title: String(book.title).slice(0, 300),
        author: String(book.author || '').slice(0, 300),
        themes: [], pages: null, available: 0, total: 0,
        bookId: book.id, easyReading: false };
      map.set(key, work);
    }
    work.total++;
    if (available(book)) {
      work.available++;
      work.bookId = book.id;
    }
    work.easyReading ||= book.easyReading === true;
    const n = Number(book.pageCount || book.pages);
    if (Number.isInteger(n) && n > 0 && !work.pages) work.pages = n;
    for (const theme of Array.isArray(book.themes) ? book.themes : []) {
      if (typeof theme === 'string' && norm(theme) && !work.themes.some(t=>norm(t)===norm(theme))) {
        work.themes.push(theme.trim().slice(0, 90));
      }
    }
  }
  return [...map.values()];
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
    if (item?.studentId !== studentId || item.externalSource !== true || item.manualStatus !== 'gelezen') continue;
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
function rankBooks(db, input, { studentId = '', seenKeys = [], limit = 3 } = {}) {
  const choice = validateChoices(input);
  const works = groupBooks(db);
  const alreadySeen = new Set([...seenKeys,...choice.excludeKeys]);
  const read = studentId ? readKeysAndThemes(db, studentId, works) : {readKeys:new Set(),themes:new Set()};
  const hinted = [...new Set([...(THEME_HINTS[choice.situation]||[]),
    ...(THEME_HINTS[choice.mood]||[]),...(THEME_HINTS[choice.detail]||[])])].map(norm);
  const candidates = [];
  for (const work of works) {
    if (!choice.allowRepeats && alreadySeen.has(work.key)) continue;
    // Confirmed reads are not recommendations for a new book; only compare
    // their curated themes when the learner explicitly asks for similarities.
    if (read.readKeys.has(work.key)) continue;
    const matched = work.themes.filter(theme => hinted.some(h => norm(theme).includes(h)));
    const familiar = choice.route === 'similar'
      ? work.themes.filter(theme => read.themes.has(norm(theme))) : [];
    let score = matched.length * 12 + familiar.length * 5 + (work.available ? 3 : 0);
    if (choice.length === 'short' && work.pages) score += work.pages <= 180 ? 7 : -4;
    // Free-time activity is deliberately not mapped to a book's genre.
    if (choice.route === 'surprise') score += tie(work.key, choice.seed) * 5;
    candidates.push({ work, matched, familiar, score, tiebreak: tie(work.key, choice.seed) });
  }
  candidates.sort((a,b) => b.score-a.score || b.tiebreak-a.tiebreak ||
    a.work.title.localeCompare(b.work.title, 'nl'));
  const picked=candidates.slice(0,Math.max(1,Math.min(3,limit)));
  return {
    suggestions: picked.map(({work,matched,familiar})=>({
      key:work.key,bookId:work.bookId,title:work.title,author:work.author,
      available:work.available,total:work.total,
      reason:matched.length ? 'Thema: '+matched.slice(0,2).join(', ')
        : familiar.length ? 'Sluit aan bij een thema dat je eerder hebt gelezen: '+familiar[0]
          : choice.length==='short' && work.pages && work.pages<=180
            ? work.pages+' pagina’s' : 'Een ander boek uit de bibliotheek',
    })),
    exhausted: !picked.length && works.length > 0,
    emptyCatalog: works.length===0,
  };
}
module.exports={validateChoices,keyOf,groupBooks,readKeysAndThemes,rankBooks};
