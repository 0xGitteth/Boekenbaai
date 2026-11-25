'use strict';
const {workKey}=require('./book-reservations');
const MAX_FAVORITES=300;
function activeStudent(db,id){
  return (db.students||[]).some(s=>s?.id===id&&s.active!==false&&s.status!=='inactive');
}
function list(db,id){
  const entries=Array.isArray(db.studentFavorites)?db.studentFavorites:[];
  return entries.filter(e=>e?.studentId===id).map(({key,title,author})=>({key,title,author}));
}
function change(db,id,body){
  if(!activeStudent(db,id))return {status:403,message:'Alleen voor je eigen profiel.'};
  if(typeof body?.key!=='string'||!body.key||body.key.length>2000||typeof body.favorite!=='boolean')
    return {status:400,message:'Ongeldige favoriet.'};
  const entries=Array.isArray(db.studentFavorites)?db.studentFavorites:[];
  const exists=entries.some(e=>e?.studentId===id&&e.key===body.key);
  if(!body.favorite){
    if(exists)db.studentFavorites=entries.filter(e=>!(e?.studentId===id&&e.key===body.key));
    return {status:200,changed:exists,favorites:list(db,id)};
  }
  if(exists)return {status:200,changed:false,favorites:list(db,id)};
  const book=(db.books||[]).find(b=>b?.id===body.bookId&&b.catalogHidden!==true&&b.personalLoanOnly!==true);
  if(!book||workKey(book)!==body.key)return {status:404,message:'Dit boek staat niet in de bibliotheek.'};
  if(list(db,id).length>=MAX_FAVORITES)return {status:409,message:'Je favorietenlijst is vol.'};
  db.studentFavorites=[...entries,{studentId:id,key:body.key,title:String(book.title||''),author:String(book.author||'')}];
  return {status:200,changed:true,favorites:list(db,id)};
}
module.exports={activeStudent,list,change};
