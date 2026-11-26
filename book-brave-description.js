'use strict';
// Search snippets and shop boilerplate are not book descriptions. Reject
// commerce-only sentences, including the observed De Slegte offer. Keep
// narrative sentences verbatim; do not invent a summary.
function narrativeDescription(value){
  if(typeof value!=='string')return '';
  const text=value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  const commercial=/\b(?:bestel(?:len|d|t)?|koop\s+(?:nu|online|dit)|in\s+(?:je|uw|de)\s+winkelwagen|winkelmand(?:je)?|gratis\s+verzend\w*|op\s+voorraad|levertijd|bezorgkosten|bezorging|vandaag\s+besteld|direct\s+leverbaar|uniek\s+aanbod|tweedehands\s+boeken|boekhandel\s+de\s+slegte|shop\s+now|add\s+to\s+cart|buy\s+now|free\s+shipping|in\s+stock|order\s+online|delivery\s+within|isbn\s*[:(]?\s*\d{9,13})\b/i;
  const sentences=text.split(/(?<=[.!?])\s+/);
  const clean=sentences.filter(s=>!commercial.test(s)).join(' ').trim();
  return clean.length>=90&&!commercial.test(clean)?clean.slice(0,2500):'';
}
module.exports={narrativeDescription};
