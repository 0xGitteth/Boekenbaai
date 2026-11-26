'use strict';

// Explicit, read-only BoekenBase MCP adapter. No API key, paid fallback,
// background scan or database writes. The production pipeline can use this
// adapter after the live response shape has been verified.
const {normalizeIsbn,isValidIsbn,toIsbn13}=require('./isbn-lookup-core-impl');
const {safeCoverUrl}=require('./lib/cover-assets');
const ENDPOINT='https://boekenbase.nl/mcp';
const MAX_BYTES=512*1024;
const VERSIONS=new Set(['2025-03-26','2025-06-18','2025-11-25']);
function plain(value,max=2500){
  if(typeof value!=='string')return '';
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
    .replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,m=>
      ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[m])
    .replace(/\s+/g,' ').trim().slice(0,max);
}
function authorName(contributor){
  return plain(contributor.name,300)||plain([
    contributor.names_before_key,contributor.prefix_to_key,contributor.key_names
  ].filter(v=>typeof v==='string').join(' '),300)||plain(contributor.corporate_name,300);
}
function normalizeRecord(record,isbn){
  if(!record||typeof record!=='object'||Array.isArray(record)
    ||!isValidIsbn(normalizeIsbn(record.isbn13))
    ||toIsbn13(normalizeIsbn(record.isbn13))!==isbn)return null;
  const title=plain(record.title,300);
  if(!title)return null;
  const authors=[...new Set((Array.isArray(record.contributors)?record.contributors:[])
    .filter(c=>c&&typeof c==='object'&&(c.role==='A01'||/^(auteur|author)$/i.test(c.role_name||'')))
    .sort((a,b)=>(Number(a.seq)||0)-(Number(b.seq)||0))
    .map(authorName).filter(Boolean))].slice(0,12);
  // Prefer the observed 05 flaptekst; retain 03 and 02 as fallbacks.
  // Other standalone text types (reviews, contents, publisher notes) are not descriptions.
  const textPriority={'05':3,'03':2,'02':1};
  const descriptions=(Array.isArray(record.texts)?record.texts:[])
    .filter(t=>t&&Object.hasOwn(textPriority,String(t.text_type)))
    .sort((a,b)=>textPriority[String(b.text_type)]-textPriority[String(a.text_type)])
    .map(t=>plain(t.text)).filter(Boolean);
  // Use the current record's front cover only, not the rear, an excerpt, or
  // an asset from a related edition.
  let coverUrl='';
  for(const asset of Array.isArray(record.assets)?record.assets:[]){
    if(!asset||asset.kind!=='vrk'||typeof asset.url!=='string')continue;
    try{
      const url=safeCoverUrl(asset.url);
      if(url.protocol==='https:'){coverUrl=url.href;break;}
    }catch{}
  }
  // NUR classifications are not content keywords.
  const tags=[...new Set((Array.isArray(record.keywords)?record.keywords:[])
    .map(v=>plain(v,100)).filter(Boolean))].slice(0,30);
  const nurCode=plain(record.nur_main,20);
  const nurCategory=plain(record.nur_main_name,100);
  const date=typeof record.pub_date==='string'?record.pub_date:'';
  const year=/^(\d{4})-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(date);
  const publishedYear=year&&Number(year[1])>=1&&Number(year[1])<=2100
    &&Number.isFinite(Date.parse(date))?Number(year[1]):null;
  const pageCount=Number.isSafeInteger(record.page_count)&&record.page_count>0
    &&record.page_count<=20000?record.page_count:null;
  return {isbn,title,subtitle:plain(record.subtitle,300),author:authors.join('; '),authors,
    description:descriptions[0]||'',coverUrl,publisher:plain(record.publisher_name,200),
    imprint:plain(record.imprint_name,200),publishedYear,pageCount,language:plain(record.language_code,20),
    genre:nurCategory,nurCode,nurCategory,tags,seriesTitle:plain(record.series_title,200),
    seriesNumber:plain(record.series_number,40),format:plain(record.product_form_name,100),
    source:'boekenbase'};
}
function providerError(status){const error=new Error(status);error.status=status;return error;}
function decodeEnvelope(value,id){
  return value&&typeof value==='object'&&!Array.isArray(value)&&value.jsonrpc==='2.0'&&value.id===id?value:null;
}
async function readRpc(response,id){
  const length=Number(response.headers.get('content-length')||0);
  if(length>MAX_BYTES||!response.body?.getReader)throw providerError('invalid_response');
  const type=(response.headers.get('content-type')||'').toLowerCase();
  const sse=type.includes('text/event-stream');
  if(!sse&&!type.includes('application/json'))throw providerError('invalid_response');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let text='',total=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(value){total+=value.byteLength;if(total>MAX_BYTES)throw providerError('response_too_large');}
      text+=decoder.decode(value,{stream:!done});
      if(sse){
        let boundary;
        while((boundary=/\r?\n\r?\n/.exec(text))){
          const frame=text.slice(0,boundary.index);
          text=text.slice(boundary.index+boundary[0].length);
          const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');
          if(!data)continue;
          let payload;try{payload=JSON.parse(data);}catch{continue;}
          const envelope=decodeEnvelope(payload,id);
          if(envelope)return envelope;
        }
      }
      if(done)break;
    }
    if(!sse){
      const envelope=decodeEnvelope(JSON.parse(text),id);
      if(envelope)return envelope;
    }
    throw providerError('invalid_response');
  }finally{void reader.cancel().catch(()=>{});}
}
function structuredResult(result){
  if(!result||typeof result!=='object')throw providerError('invalid_response');
  const payloads=[];
  if(result.structuredContent&&typeof result.structuredContent==='object')payloads.push(result.structuredContent);
  for(const item of Array.isArray(result.content)?result.content:[]){
    if(item?.type!=='text'||typeof item.text!=='string')continue;
    try{payloads.push(JSON.parse(item.text));}catch{}
  }
  if(payloads.some(p=>p?.error?.code==='not_found'))return {status:'not_found',metadata:null};
  if(result.isError===true){
    // Live response on 2026-11-26: HTTP 200, text error for absent ISBN.
    if(Array.isArray(result.content)&&result.content.length===1
      &&result.content[0]?.type==='text'
      &&result.content[0]?.text?.trim()==='Dit ISBN staat niet in de boekenbase.')
      return {status:'not_found',metadata:null};
    throw providerError('tool_error');
  }
  for(const payload of payloads){
    const record=payload?.data??payload;
    if(record&&typeof record==='object'&&typeof record.isbn13==='string')return {status:'record',record};
  }
  throw providerError('invalid_response');
}
async function fetchBoekenBase(input,{fetchImpl=globalThis.fetch,timeoutMs=8000}={}){
  const normalized=normalizeIsbn(input);
  if(!isValidIsbn(normalized))return {status:'invalid_isbn',metadata:null};
  const isbn=toIsbn13(normalized);
  if(typeof fetchImpl!=='function')return {status:'network_error',metadata:null};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(500,Math.min(15000,timeoutMs)));
  let session='',version='2025-03-26';
  async function post(method,params,id){
    const headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'};
    if(method!=='initialize')headers['MCP-Protocol-Version']=version;
    if(session)headers['Mcp-Session-Id']=session;
    const body={jsonrpc:'2.0',method,params};
    if(id!==undefined)body.id=id;
    const response=await fetchImpl(ENDPOINT,{method:'POST',headers,body:JSON.stringify(body),
      signal:controller.signal,redirect:'error'});
    if(!response.ok){
      if(response.body)void response.body.cancel().catch(()=>{});
      throw providerError(response.status===429?'rate_limited':[401,403].includes(response.status)?'unauthorized':'provider_error');
    }
    if(method==='initialize'){
      const token=response.headers.get('mcp-session-id')||'';
      if(token&&!/^[\x21-\x7e]{1,512}$/.test(token))throw providerError('invalid_response');
      session=token;
    }
    if(id===undefined){if(response.body)void response.body.cancel().catch(()=>{});return null;}
    const envelope=await readRpc(response,id);
    if(envelope.error)throw providerError('rpc_error');
    return envelope.result;
  }
  try{
    const init=await post('initialize',{protocolVersion:version,capabilities:{},
      clientInfo:{name:'Boekenbaai',version:'1.0.0'}},1);
    if(!VERSIONS.has(init?.protocolVersion)||!init?.capabilities?.tools)throw providerError('unsupported_protocol');
    version=init.protocolVersion;
    await post('notifications/initialized',{},undefined);
    const result=structuredResult(await post('tools/call',{name:'get_book',arguments:{isbn13:isbn}},2));
    if(result.status==='not_found')return result;
    const metadata=normalizeRecord(result.record,isbn);
    return metadata?{status:'found',metadata}:{status:'identity_mismatch',metadata:null};
  }catch(err){
    return {status:controller.signal.aborted?'timeout':err?.status||'network_error',metadata:null};
  }finally{clearTimeout(timer);}
}
module.exports={fetchBoekenBase,normalizeRecord,structuredResult};
