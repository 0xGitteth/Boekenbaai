'use strict';
// Administrator-only exports. Export source and decisions separately so an
// unconfirmed import can never be mistaken for committed library records.
const {mapImportRow}=require('./book-import-workbook');
const FIELDS=[
  ['title','Titel'],['author','Auteur'],['isbn','ISBN-nummer'],
  ['barcode','Fysieke barcode'],['quantity','Aantal exemplaren'],
  ['description','Beschrijving'],['publisher','Uitgever'],
  ['publishedYear','Verschijningsjaar'],['pageCount',"Aantal pagina's"],
  ['language','Taal'],['coverUrl','Boekomslag'],
  ['easyReading','Makkelijk lezen?'],['examMaterial','Examenleeslijst'],
  ['tags','Trefwoorden'],['themes',"Thema's"],
  ['fixedClass','Vast in de klas van'],['classLoan','Geleend door klas'],
  ['studentLoan','Naam leerling'],
];
const value=v=>Array.isArray(v)?v.join('; '):
  v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):v;
const safeCell=v=>{
  const s=value(v);
  return typeof s==='string'&&/^[\s]*[=+@\-\t\r]/.test(s)
    ?"'" +s:s;
};
function buildWorkbook(XLSX,sheets){
  const wb=XLSX.utils.book_new();
  for(const [name,rows] of sheets){
    const safeRows=rows.map(row=>Object.fromEntries(
      Object.entries(row).map(([key,v])=>[key,safeCell(v)])));
    const sheet=XLSX.utils.json_to_sheet(safeRows);
    XLSX.utils.book_append_sheet(wb,sheet,name.slice(0,31));
  }
  return XLSX.write(wb,{bookType:'xlsx',type:'base64'});
}
const assignmentFields=book=>({
  'Vaste locatie':book.fixedLocation||'',
  'Uitleenstatus':book.status||'',
  'Uitgeleend aan leerling ID':book.borrowedBy||'',
  'Uitgeleend aan klas ID':book.borrowedByClassId||'',
  'Uitgeleend op':book.borrowedAt||'',
  'Inleverdatum':book.dueDate||'',
});
function librarySheets(db){
  const students=new Map((db.students||[]).map(x=>[x.id,x.name||'']));
  const classes=new Map((db.classes||[]).map(x=>[x.id,x.name||'']));
  const books=(db.books||[]).map(book=>({
    'Exemplaar-ID':book.id||'',
    'Titel':book.title||'','Auteur':book.author||'',
    'ISBN-nummer':book.editionIsbn||book.metadataIsbn||'',
    'Intern ISBN':book.metadataIsbn||'',
    'Fysieke barcode':book.barcode||'',
    'Aantal':1,
    'Beschrijving':book.description||'',
    'Uitgever':book.publisher||'',
    'Jaar':book.publishedYear??'',
    "Aantal pagina's":book.pageCount??'',
    'Taal':book.language||'',
    'Cover URL':book.coverUrl||'',
    'Lokale omslag':book.localCoverUrl||'',
    'Makkelijk lezen?':book.easyReading?'Ja':'Nee',
    'Examenmateriaal':book.suitableForExamList?'Ja':'Nee',
    'Trefwoorden':value(book.tags||[]),
    "Thema's":value(book.themes||[]),
    ...assignmentFields(book),
    'Uitgeleend aan leerling':students.get(book.borrowedBy)||'',
    'Uitgeleend aan klas':classes.get(book.borrowedByClassId)||'',
    'Naam leerling':students.get(book.borrowedBy)||'',
    'Geleend door klas':classes.get(book.borrowedByClassId)||'',
    'Vast in de klas van':book.fixedLocation||'',
    'Overige gegevens (JSON)':JSON.stringify(book),
  }));
  return [['Boeken',books]];
}
function stageSheets(stage,request){
  const rows=stage.analysis?.rows||[];
  const raw=stage.sourceRows||[];
  const persisted=stage.draft||{};
  const corrections=request?.corrections===undefined
    ?(persisted.corrections||stage.corrections||[]):request.corrections;
  const choices={
    inventoryResolutions:request?.inventoryResolutions
      ??persisted.inventoryResolutions??stage.inventoryResolutions??[],
    assignmentResolutions:request?.assignmentResolutions
      ??persisted.assignmentResolutions??stage.assignmentResolutions??[],
    metadataResolutions:request?.metadataResolutions
      ??persisted.metadataResolutions??stage.metadataResolutions??[],
  };
  const corrected=new Map((corrections||[]).map(c=>[c.index,c]));
  const bookRows=rows.map((row,index)=>{
    const fields=mapImportRow(raw[row.index]||{}).fields;
    const patch=corrected.get(row.index)||{};
    const updates=patch.fields||{};
    const field=(name,fallback='')=>Object.prototype.hasOwnProperty.call(updates,name)
      ?updates[name]:(fields[name]??fallback);
    const book=row.book||{},ctx=row.context||{};
    const data={
      'Excelrij':row.sourceRowNumber||index+2,
      'Importstatus':patch.skip?'Uitgesteld (niet importeren)':
        'Concept (nog niet geïmporteerd)',
      'Titel':field('title',book.title||''),
      'Auteur':field('author',book.author||''),
      'ISBN-nummer':field('editionIsbn',book.editionIsbn||''),
      'Fysieke barcode':field('barcode',book.barcode||''),
      'Aantal':field('quantity',book.quantity?.value??1),
      'Beschrijving':field('description',book.description||''),
      'Uitgever':field('publisher',book.publisher||''),
      'Jaar':field('publishedYear',book.publishedYear??''),
      "Aantal pagina's":field('pageCount',book.pageCount??''),
      'Taal':field('language',book.language||''),
      'Cover URL':field('coverUrl',book.coverUrl||''),
      'Makkelijk lezen?':field('easyReading',book.easyReading?'Ja':''),
      'Examenmateriaal':field('examMaterial',
        book.suitableForExamList?'Ja':''),
      'Trefwoorden':field('tags',value(book.tags||[])),
      "Thema's":field('themes',value(book.themes||[])),
      'Vast in de klas van':field('fixedClass',ctx.fixedLocation?.raw
        ||ctx.fixedLocation?.label||''),
      'Geleend door klas':field('classLoan',ctx.classLoan?.name
        ||ctx.studentClassHint?.label||''),
      'Naam leerling':field('studentLoan',ctx.studentLoan?.name||''),
      'Klassen':field('classes',(ctx.classContext||[]).join('; ')),
      'Aanwezig bieb':field('libraryPresence',
        ctx.libraryPresence?.value||''),
    };
    return data;
  });
  const original=raw.map((row,i)=>({
    Excelrij:rows[i]?.sourceRowNumber||i+2,
    ...Object.fromEntries(Object.entries(row).filter(([k,v])=>
      k!=='__proto__'&&k!=='constructor'&&k!=='prototype'
      &&(v===null||['string','number','boolean'].includes(typeof v)))),
  }));
  const decisionRows=Object.entries(choices).flatMap(([type,items])=>
    (items||[]).map(entry=>({Onderdeel:type,
      Sleutel:entry.id||entry.isbn||'',Keuze:entry.action||''})));
  return [['Boeken concept',bookRows],
    ['Originele Excel',original],
    ['Administratieve keuzes',decisionRows],
    ['Toelichting',[{
      'Status':'Dit is een concept-export. Er is nog niets definitief geïmporteerd.',
      'Bronbestand':stage.fileName||'',
      'Importversie':stage.revision,
      'Geëxporteerd op':new Date().toISOString(),
    }]]];
}
module.exports={buildWorkbook,librarySheets,stageSheets};
