'use strict';
const assert=require('node:assert/strict');
const {nearlySameBookText,sameBookTitle,sameBookIdentity,smallPageDifference}=
  require('../book-import-autonomy');

assert.equal(nearlySameBookText('P.S. ik hou van je','PS ik hou van je'),true);
assert.equal(sameBookTitle('De avonturen van Kuifje: De zonnetempel',
  'De zonnetempel'),true,'Subtitles or series prefixes are not new ISBN-editions');
assert.equal(sameBookTitle('Thomas en de tijdmantel (een farao in de klas)',
  'Thomas en de tijdmantel'),true);
assert.equal(sameBookTitle('De avonturen van Kuifje: De zonnetempel',
  'De avonturen van Kuifje: De zwarte rotsen'),false);
assert.equal(sameBookTitle('Harry Potter 1: De steen',
  'Harry Potter 2: De steen'),false);
assert.equal(nearlySameBookText('Bickerton Neveis','Bickerton Neves'),true);
assert.equal(sameBookTitle('Diary of a Wimpy Kid',
  'Diary of a Wimpy Kid (Book 1)'),true,
  'A catalogue Book 1 label does not invalidate an exact ISBN edition');
assert.equal(sameBookTitle('Dagen van gras',
  'Dagen van gras / druk 3'),true,
  'A printing suffix may be omitted from a school worksheet');
assert.equal(require('../book-import-autonomy').hasConflictingEditionQualifiers([
  'Diary of a Wimpy Kid','Diary of a Wimpy Kid (Book 1)',
  'Diary of a Wimpy Kid (Book 2)',
]),true,'An unqualified first row cannot hide conflicting later volumes');
assert.equal(sameBookTitle('Diary of a Wimpy Kid (Book 1)',
  'Diary of a Wimpy Kid (Book 2)'),false,
  'Two different numbered volumes must remain distinct');

// Patterns, not hand-written exceptions for individual ISBNs. The workbook
// title may include a series prefix or a graphic descriptor while a provider
// reports only the book's own title.
for(const [worksheet,provider] of [
  ['Het leven van een loser- Een hondenleven','Een hondenleven'],
  ['Magnus Chase de hamer van Thor','De hamer van Thor'],
  ['Magnus Chase het verdoemde zwaard','Het verdoemde zwaard'],
  ["Dagboek van een muts zoek 't lekker uit","Zoek 't lekker uit!"],
  ['H@CK het instituut','Het instituut'],
  ['Opstand','Iko. Opstand'],
  ['Het achterhuis Graphic','Het Achterhuis'],
  ['Fantasia 3','Fantasia III'],
])assert.equal(sameBookTitle(worksheet,provider),true,
  'Verified ISBN series/edition title variant: '+worksheet);

for(const [worksheet,provider] of [
  ['De Gorgels','De Gorgels en het geheim van de gletsjer'],
  ['Percy Jackson en de Olympiers','De bliksemdief'],
  ['Maus','The Complete MAUS'],
  ['Het leven van een allerbeste vriend','Logboek van Theo Thorbecke'],
  ['Fantasia 3','Fantasia IV'],
  ['Harry Potter 1 de steen der wijzen','Harry Potter 2 de steen der wijzen'],
])assert.equal(sameBookTitle(worksheet,provider),false,
  'Materially different work or unknown edition: '+worksheet);

assert.equal(nearlySameBookText('Carrý Slee','Carry Slee'),true);
assert.equal(nearlySameBookText('Jan Terlouw','Jan Terlouuw'),true);
assert.equal(nearlySameBookText('Up','Us'),false,
  'Very short book titles cannot use fuzzy identity');
assert.equal(nearlySameBookText('Harry Potter 1','Harry Potter 2'),false,
  'Edition numbers must be exact');
assert.equal(nearlySameBookText('Het geheim van het bos',
  'Het geheim van de zee'),false,
  'Materially different stories may not be silently combined');
assert.equal(sameBookIdentity({title:'Oorlogswinter',author:'Jan Terlouw'},
  {title:'Oorlogs-winter',author:'Jan Térlouw'}),true);
assert.equal(sameBookIdentity({title:'Oorlogswinter',author:'Jan Terlouw'},
  {title:'Oorlogswinter',author:'Jan Vermeer'}),false);
assert.equal(sameBookIdentity({title:'Haantjes',author:'nan Kluun'},
  {title:'Haantjes',author:'Kluun'}),true,
  'Legacy lowercase nan first-name must not create an ISBN-group conflict');
assert.equal(sameBookIdentity({title:'Haantjes',author:'Nan Kluun'},
  {title:'Haantjes',author:'Kluun'}),false,
  'A real capitalized Nan first name must be preserved');
assert.equal(sameBookIdentity({title:'Haantjes',author:'nan Other Author'},
  {title:'Haantjes',author:'Kluun'}),false,
  'This is not a general rule for ignoring first names');
assert.equal(sameBookIdentity({title:'Other title',author:'nan Kluun'},
  {title:'Haantjes',author:'Kluun'}),false,
  'Matching a placeholder surname never overrides the ISBN book title');
// Actual school collection: the stored copy can use a library-style
// surname-first author while the Excel uses the natural display order.
// Only an independently verified identical ISBN may use this identity match.
for(const [stored,source] of [
  ['Kinney, Jeff','Jeff Kinney'],
  ['Adriaan Dis, van','Adriaan van Dis'],
  ['Joann Herik, van den','Joann van den Herik'],
  ['Mieke Hooft, van','Mieke van Hooft'],
  ['Eddy Ley, van der','Eddy van der Ley'],
  ['Morris Groot, de','Morris de Groot'],
]){
  assert.equal(sameBookIdentity({title:'Same ISBN edition',author:stored},
    {title:'Same ISBN edition',author:source}),true,
    'One author must not become an ISBN stock conflict: '+stored);
}
for(const [stored,source] of [
  ['Kinney, Jane','Jeff Kinney'],
  ['Joann van den Herik','Joann van den Bakker'],
  ['Jan van der Meer & Piet Visser','Jan Visser & Piet van der Meer'],
  ['Wouter, Marijn Laumans, Schrijver','Wouter Laumans'],
]){
  assert.equal(sameBookIdentity({title:'Same ISBN edition',author:stored},
    {title:'Same ISBN edition',author:source}),false,
    'Different or multiply attributed authors must stay under review');
}
assert.equal(sameBookIdentity({title:'Zelfde titel',author:'-'},
  {title:'Zelfde titel',author:'?'}),false,
  'Punctuation-only placeholders must not become matching authors');
assert.equal(sameBookIdentity({title:'Other work',author:'Kinney, Jeff'},
  {title:'Same ISBN edition',author:'Jeff Kinney'}),false,
  'Exact author equivalence may not override a substantive title mismatch');

assert.equal(smallPageDifference(210,214),true);
assert.equal(smallPageDifference(210,240),false);
assert.equal(smallPageDifference(null,240),false);
console.log('Import autonomy: minor typos, identity and insignificant page variants OK');
