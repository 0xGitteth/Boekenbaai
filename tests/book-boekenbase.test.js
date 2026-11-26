'use strict';
const assert=require('node:assert/strict');
const {fetchBoekenBase,normalizeRecord,structuredResult}=require('../book-boekenbase');
const isbn='9789086960088';
const fixture={isbn13:isbn,title:'Testtitel',subtitle:'Ondertitel',
  contributors:[{role:'B06',name:'Vertaler'},{role:'A01',name:'Test Auteur'}],
  publisher_name:'Testuitgever',pub_date:'2022-04-01',language_code:'dut',
  series_title:'Serie',series_number:'2',nur_main_name:'Jeugdboeken',
  keywords:['Paarden','Vriendschap'],
  texts:[{text_type:'02',text:'Korte tekst'},{text_type:'03',text:'<p>Een verhaal &amp; avontuur.</p>'},
    {text_type:'06',text:'Recensie mag niet als flaptekst'}],
  assets:[{kind:'atk',url:'https://example.org/rear.jpg'},
    {kind:'vrk',url:'https://example.org/front.jpg'}],
  editions:[{isbn13:'9789083316642',cover_url:'https://example.org/other-edition.jpg'}]};
const parsed=normalizeRecord(fixture,isbn);
assert.equal(parsed.author,'Test Auteur');
assert.equal(parsed.description,'Een verhaal & avontuur.');
assert.equal(parsed.coverUrl,'https://example.org/front.jpg');
assert.deepEqual(parsed.tags,['Paarden','Vriendschap']);
assert.equal(parsed.nurCategory,'Jeugdboeken');
assert.equal(parsed.publishedYear,2022);
assert.equal(parsed.pageCount,null);
assert.equal(parsed.seriesNumber,'2');
assert.equal(normalizeRecord(fixture,'9789083316642'),null);
assert.equal(normalizeRecord({...fixture,assets:[fixture.assets[0]]},isbn).coverUrl,'');
assert.equal(normalizeRecord({...fixture,texts:[fixture.texts[2]]},isbn).description,'');
assert.deepEqual(structuredResult({content:[{type:'text',text:'{"error":{"code":"not_found"}}'}]}),
  {status:'not_found',metadata:null});
assert.throws(()=>structuredResult({content:[{type:'text',text:'unexpected response'}]}));
// Response shapes observed in the live trial. Synthetic text avoids
// copying publisher descriptions into the public test repository.
const liveCases=[
  ['9789026133541','2012-10-02T00:00:00.000Z',128,'De Fontein Jeugd','282','Fictie 7-9 jaar'],
  ['9789462914308','2019-09-18T00:00:00.000Z',null,null,'284','Fictie 13-15 jaar'],
  ['9789086961382','2011-11-29T00:00:00.000Z',64,null,'286','Moeilijk lezen'],
  ['9789043531788','2019-06-18T00:00:00.000Z',352,'KokBoekencentrum Jeugd','285','Fictie 15+'],
];
for(const [isbn13,pub_date,page_count,imprint_name,nur_main,nur_main_name] of liveCases){
  const record={...fixture,isbn13,pub_date,page_count,imprint_name,nur_main,nur_main_name,keywords:null,
    texts:[{text_type:'02',text:'Kort'},{text_type:'03',text:'Andere beschrijving'},
      {text_type:'05',text:'Volledige flaptekst<br/>Tweede zin.'}]};
  const decoded=structuredResult({content:[{type:'text',text:JSON.stringify(record)}]});
  const data=normalizeRecord(decoded.record,isbn13);
  assert.equal(data.publishedYear,Number(pub_date.slice(0,4)));
  assert.equal(data.pageCount,page_count);
  assert.equal(data.imprint,imprint_name||'');
  assert.equal(data.nurCode,nur_main);
  assert.equal(data.nurCategory,nur_main_name);
  assert.deepEqual(data.tags,[]);
  assert.equal(data.description,'Volledige flaptekst Tweede zin.');
  assert.equal(normalizeRecord({...record,texts:[record.texts[2]]},isbn13).description,data.description);
}
assert.equal(normalizeRecord({...fixture,page_count:-1},isbn).pageCount,null);
assert.equal(normalizeRecord({...fixture,page_count:1.5},isbn).pageCount,null);
assert.equal(normalizeRecord({...fixture,pub_date:'invalid'},isbn).publishedYear,null);
const absentResult={content:[{type:'text',text:'Dit ISBN staat niet in de boekenbase.'}],isError:true};
assert.deepEqual(structuredResult(absentResult),{status:'not_found',metadata:null});
assert.throws(()=>structuredResult({content:[{type:'text',text:'Tijdelijke serverfout'}],isError:true}),
  e=>e.status==='tool_error');
function rpc(id,result,headers={},sse=false){
  const raw=JSON.stringify({jsonrpc:'2.0',id,result});
  return new Response(sse?'event: message\r\ndata: '+raw+'\r\n\r\n':raw,{
    headers:{'content-type':sse?'text/event-stream':'application/json',...headers}});
}
async function run(){
  let calls=0;
  const result=await fetchBoekenBase(isbn,{fetchImpl:async(url,opts)=>{
    assert.equal(url,'https://boekenbase.nl/mcp');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Authorization,undefined);
    const req=JSON.parse(opts.body);calls++;
    if(calls===1){assert.equal(req.method,'initialize');
      return rpc(req.id,{protocolVersion:'2025-03-26',capabilities:{tools:{}}},{'mcp-session-id':'session-1'});}
    assert.equal(opts.headers['Mcp-Session-Id'],'session-1');
    assert.equal(opts.headers['MCP-Protocol-Version'],'2025-03-26');
    if(calls===2){assert.equal(req.method,'notifications/initialized');
      assert.equal(req.id,undefined);return new Response(null,{status:202});}
    assert.equal(req.method,'tools/call');
    assert.deepEqual(req.params,{name:'get_book',arguments:{isbn13:isbn}});
    return rpc(req.id,{content:[{type:'text',text:JSON.stringify({data:fixture})}]},{},true);
  }});
  assert.equal(calls,3);
  assert.equal(result.status,'found');
  assert.deepEqual(result.metadata,parsed);
  let missingCalls=0;
  const missing=await fetchBoekenBase('9789001560553',{fetchImpl:async(_url,opts)=>{
    const req=JSON.parse(opts.body);missingCalls++;
    if(req.method==='initialize')return rpc(req.id,{protocolVersion:'2025-03-26',capabilities:{tools:{}}});
    if(req.method==='notifications/initialized')return new Response(null,{status:202});
    assert.equal(req.params.arguments.isbn13,'9789001560553');
    return rpc(req.id,absentResult);
  }});
  assert.equal(missingCalls,3);
  assert.deepEqual(missing,{status:'not_found',metadata:null});
  const unavailable=await fetchBoekenBase(isbn,{fetchImpl:async()=>new Response(null,{status:429})});
  assert.equal(unavailable.status,'rate_limited');
  const bad=await fetchBoekenBase('not an isbn',{fetchImpl:async()=>{throw Error('unexpected network call');}});
  assert.equal(bad.status,'invalid_isbn');
  console.log('BoekenBase MCP transport and ISBN-verified metadata normalization: OK');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
