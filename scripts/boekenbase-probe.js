'use strict';
// Read-only smoke probe, deliberately limited to five public ISBNs.
// Run: node scripts/boekenbase-probe.js ISBN [ISBN...]
const {fetchBoekenBase}=require('../book-boekenbase');
const isbns=[...new Set(process.argv.slice(2))];
if(!isbns.length||isbns.length>5){
  console.error('Geef één tot vijf ISBN-nummers op. Er worden geen boekgegevens opgeslagen.');
  process.exitCode=1;
}else{
  (async()=>{
    for(const isbn of isbns){
      const result=await fetchBoekenBase(isbn);
      console.log(JSON.stringify({requestedIsbn:isbn,...result},null,2));
      if(!['found','not_found'].includes(result.status))process.exitCode=1;
      if(result.status==='rate_limited')break;
    }
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
