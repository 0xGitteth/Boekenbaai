'use strict';
// Approved source descriptions supplement the advisor's weak textual
// evidence; they never become teacher tags or authoritative story facts.
const {workKey}=require('./book-free-metadata');
const {createHash}=require('node:crypto');
const identity=book=>createHash('sha256').update(workKey(book)).digest('hex');
function approvedDescriptions(book){
  if(!book||book.themesCleared===true)return [];
  const key=identity(book);
  const entries=Array.isArray(book.enrichmentDescriptions)?book.enrichmentDescriptions:[];
  const seen=new Set();
  return entries.filter(entry=>entry&&entry.identity===key
    &&typeof entry.source==='string'&&typeof entry.text==='string'&&entry.text.trim().length>=90)
    .map(entry=>({source:entry.source.slice(0,80),text:entry.text.trim().slice(0,2500),identity:key}))
    .filter(entry=>{const k=entry.source+'\0'+entry.text;if(seen.has(k))return false;seen.add(k);return true;})
    .slice(0,6);
}
function descriptionCorpus(book){
  return [...new Set([typeof book?.description==='string'?book.description:'',
    ...approvedDescriptions(book).map(entry=>entry.text)].filter(Boolean))].join('\n');
}
module.exports={approvedDescriptions,descriptionCorpus,identity};
