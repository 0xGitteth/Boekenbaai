'use strict';

// Brave discovery stays separate from reading the publisher's original page.
// Untrusted search results are never treated as verified bibliographic facts.
const https=require('node:https');
const dns=require('node:dns').promises;
const {safeCoverUrl,publicIPv4}=require('./lib/cover-assets');
const {normalizeIsbn,isValidIsbn,toIsbn13}=require('./isbn-lookup-core-impl');
const {narrativeDescription}=require('./book-brave-description');

function cleaned(value,max=600) {
  return String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
function normalize(value) {
  return cleaned(value,500).normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('nl-NL').replace(/[^a-z0-9]+/g,' ').trim();
}
function sameWorkTitle(targetTitle,candidateTitle,author='') {
  const expected=normalize(targetTitle);
  if(!expected)return false;
  // Publisher or shop names following a vertical bar are not part of
  // bibliographic titles. Do not treat an unseparated longer title (e.g.
  // "Dune Messiah") as an edition of "Dune".
  const title=normalize(cleaned(candidateTitle,500).split(/\s+\|\s+/)[0]);
  const fullAuthor=normalize(author);
  const candidates=[title];
  if(fullAuthor){
    if(title.endsWith(' '+fullAuthor))
      candidates.push(title.slice(0,-fullAuthor.length-1));
    if(title.startsWith(fullAuthor+' '))
      candidates.push(title.slice(fullAuthor.length+1));
    for(const label of ['cover','omslag','kaft','boek']){
      if(title.endsWith(' '+fullAuthor+' '+label))
        candidates.push(title.slice(0,-fullAuthor.length-label.length-2));
    }
  }
  return candidates.some(value=>value===expected);
}
function matchTitleAuthor(target,candidate,context='') {
  const author=normalize(target.author);
  if(author.length<2||!sameWorkTitle(target.title,candidate.title,target.author))return false;
  const surname=author.split(' ').filter(x=>x.length>=3).slice(-1)[0]||author;
  const headline=normalize(candidate.title);
  return headline.includes(surname)||normalize(candidate.author).includes(surname)
    ||normalize(String(context).slice(0,18000)).includes(surname);
}
function parseMonthlyRemaining(response) {
  const policy=response?.headers?.get?.('x-ratelimit-policy');
  const remaining=response?.headers?.get?.('x-ratelimit-remaining');
  // Missing or empty header fields must NEVER become a confirmed zero.
  // Number('') is 0; accepting it could freeze every approved search.
  if(typeof policy!=='string'||!policy.trim()
    ||typeof remaining!=='string'||!remaining.trim())return null;
  const windows=policy.split(',').map(p=>p.trim());
  const amounts=remaining.split(',').map(p=>p.trim());
  if(windows.length!==amounts.length)return null;
  const monthly=windows.map((window,index)=>
    /(?:^|;)\s*w\s*=\s*(?:2592000|2628000|2678400|2[5-7]\d{5})(?:\s*;|$)/.test(window)
      ?index:-1).filter(index=>index!==-1);
  // The only admissible evidence is ONE explicitly labelled monthly bucket
  // with a complete non-negative decimal integer at the SAME position.
  if(monthly.length!==1||!/^\d+$/.test(amounts[monthly[0]]))return null;
  // Brave documents a monthly limit of 0 as unlimited, not exhausted.
  // Require a positive, explicitly bounded quota before interpreting its balance.
  const limitText=windows[monthly[0]].match(/^\s*(\d+)\s*;/)?.[1];
  const limit=Number(limitText);
  if(!Number.isSafeInteger(limit)||limit<=0)return null;
  const value=Number(amounts[monthly[0]]);
  return Number.isSafeInteger(value)&&value<=limit?value:null;
}
function queryFor(step,target) {
  const title=cleaned(target.title,150).replace(/["\r\n]/g,'');
  const author=cleaned(target.author,130).replace(/["\r\n]/g,'');
  const isbn=String(target.isbn||'').replace(/[^0-9X]/gi,'');
  // ISBN is already a precise edition identifier. Do not force every
  // catalogue spelling, publisher name and subtitle into the same query.
  if(step===0)return isValidIsbn(isbn)?isbn:title+' '+author+' boek';
  if(step===1)return (isValidIsbn(isbn)?isbn:title+' '+author)+' kaft';
  return title+' '+author+' beschrijving';
}
async function fetchBrave(step,target,{apiKey,fetchImpl=globalThis.fetch,timeoutMs=25000}={}) {
  if(!apiKey||typeof apiKey!=='string')return {error:'not_configured'};
  const image=step===1;
  const endpoint=image?'https://api.search.brave.com/res/v1/images/search'
    :'https://api.search.brave.com/res/v1/web/search';
  const url=new URL(endpoint);
  url.searchParams.set('q',queryFor(step,target));
  url.searchParams.set('country','NL');
  url.searchParams.set('search_lang','nl');
  url.searchParams.set('safesearch','strict');
  url.searchParams.set('count',image?'8':'8');
  if(!image){
    url.searchParams.set('result_filter','web');
    url.searchParams.set('extra_snippets','true');
    url.searchParams.set('text_decorations','false');
  }
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),Math.max(1000,Math.min(timeoutMs,30000)));
  try{
    const response=await fetchImpl(url.toString(),{
      headers:{'X-Subscription-Token':apiKey,Accept:'application/json'},
      signal:ctl.signal,redirect:'error',
    });
    const providerRemaining=parseMonthlyRemaining(response);
    if(!response.ok) {
      const error=response.status===429?'rate_limited':response.status===402?'payment_required'
        :[401,403].includes(response.status)?'unauthorized'
        :response.status===408?'timeout':response.status>=500?'provider_temporary':'provider_error';
      return {error,providerRemaining,httpStatus:response.status};
    }
    if(Number(response.headers?.get?.('content-length')||0)>350000)
      return {error:'too_large',providerRemaining};
    const raw=await response.text();
    if(raw.length>350000)return {error:'too_large',providerRemaining};
    const data=JSON.parse(raw);
    if(image){
      return {providerRemaining,images:(Array.isArray(data.results)?data.results:[]).slice(0,8)
        .map(x=>({title:cleaned(x.title,240),pageUrl:String(x.url||'').slice(0,1500),
          imageUrl:String(x.properties?.url||'').slice(0,1500),
          width:Number(x.properties?.width||0),height:Number(x.properties?.height||0)}))};
    }
    return {providerRemaining,pages:(Array.isArray(data.web?.results)?data.web.results:[])
      .slice(0,8).map(x=>({title:cleaned(x.title,250),url:String(x.url||'').slice(0,1600),
        snippets:[...new Set([x.description,...(Array.isArray(x.extra_snippets)?x.extra_snippets.slice(0,5):[])]
          .filter(v=>typeof v==='string').map(v=>cleaned(decodeEntities(v),650)).filter(Boolean))]}))};
  }catch(err){
    return {error:ctl.signal.aborted||err?.name==='AbortError'?'timeout':'request_error',errorCode:err?.cause?.code||err?.code||''};
  }finally{clearTimeout(timer);}
}
function decodeEntities(raw){
  return String(raw||'').replace(/&(?:amp|quot|apos|lt|gt|nbsp|#(\d+)|#x([0-9a-f]+));/gi,
    (m,dec,hex)=>{
      if(dec||hex){const code=parseInt(dec||hex,hex?16:10);
        return code>0&&code<=0x10ffff?String.fromCodePoint(code):m;}
      return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[m.slice(1,-1).toLowerCase()]||m;
    });
}
function attributes(tag){
  const a={};
  for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    a[m[1].toLowerCase()]=decodeEntities(m[2]??m[3]);
  return a;
}
function metaFields(html){
  const out={};
  for(const m of html.matchAll(/<meta\s+[^>]*>/gi)){
    const a=attributes(m[0]),key=String(a.name||a.property||'').toLowerCase();
    if(key&&a.content&&!out[key])out[key]=a.content;
  }
  return out;
}
function asOne(value){
  if(Array.isArray(value))return asOne(value[0]);
  if(value&&typeof value==='object')return value.name||value['@id']||value.url||'';
  return value||'';
}
function graphNodes(x,depth=0){
  if(depth>4||!x||typeof x!=='object')return [];
  if(Array.isArray(x))return x.slice(0,40).flatMap(n=>graphNodes(n,depth+1));
  return [x,...graphNodes(x['@graph'],depth+1)];
}
function jsonldBook(html){
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    const a=attributes(m[1]);
    if(!/application\/ld\+json/i.test(a.type||'')||m[2].length>140000)continue;
    try{
      const decoded=JSON.parse(m[2].trim());
      for(const n of graphNodes(decoded)){
        const kinds=Array.isArray(n['@type'])?n['@type']:[n['@type']];
        if(kinds.some(k=>/^(?:https?:\/\/schema\.org\/)?(?:Book|Product)$/i.test(k||'')))
          return n;
      }
    }catch{/* Some sites emit invalid JSON-LD. Other tags may still work. */}
  }
  return {};
}
function parseBookPage(html,target,url) {
  if(typeof html!=='string'||html.length>700000)return null;
  let location;
  try{location=safeCoverUrl(url);if(location.protocol!=='https:')return null;}catch{return null;}
  const meta=metaFields(html),book=jsonldBook(html);
  const h1=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i);
  const primaryTitle=cleaned(asOne(book.name||book.headline)||meta['og:title']
    ||(h1?decodeEntities(h1[1]):''),350);
  const subtitles=[book.subtitle,book.subTitle,book.alternateName,meta['book:subtitle'],meta['og:subtitle']]
    .flatMap(value=>Array.isArray(value)?value:[value]).filter(value=>typeof value==='string')
    .map(value=>cleaned(decodeEntities(value),180)).filter(Boolean);
  // Some publisher pages place the subtitle in a nearby heading rather
  // than the structured Book object. Only use it if the main heading agrees
  // with the primary title and the concatenation is the full target title.
  if(h1&&normalize(decodeEntities(h1[1]))===normalize(primaryTitle)){
    const nearby=html.slice(h1.index+h1[0].length,h1.index+h1[0].length+1500);
    for(const h of nearby.matchAll(/<h[234]\b[^>]*>([\s\S]*?)<\/h[234]\s*>/gi))
      subtitles.push(cleaned(decodeEntities(h[1]),180));
  }
  const title=[primaryTitle,...subtitles.map(subtitle=>primaryTitle+' '+subtitle)]
    .find(value=>sameWorkTitle(target.title,value,target.author))||primaryTitle;
  const author=cleaned(asOne(book.author)||meta.author||'',220);
  const allText=decodeEntities(html.replace(/<script\b[\s\S]*?<\/script\s*>/gi,' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi,' ').replace(/<[^>]*>/g,' ')).slice(0,45000);
  const isbn=String(book.isbn||book.gtin13||book.gtin||'').replace(/[^0-9X]/gi,'');
  const wantedIsbn=String(target.isbn||'').replace(/[^0-9X]/gi,'');
  // Exact ISBN or title+author is mandatory; a similar title is insufficient.
  const exactIsbn=Boolean(isValidIsbn(isbn)&&isValidIsbn(wantedIsbn)&&toIsbn13(isbn)===toIsbn13(wantedIsbn));
  const sameTitle=sameWorkTitle(target.title,title,target.author);
  const sameWork=matchTitleAuthor(target,{title,author},allText.slice(0,15000));
  // A matching ISBN alone is insufficient when the structured title names
  // a different work. Exact title and work-level identity remain mandatory.
  if(!sameTitle||(!exactIsbn&&!sameWork))return null;
  const description=[asOne(book.description),meta.description,meta['og:description']]
    .map(value=>narrativeDescription(cleaned(decodeEntities(value),2500))).find(Boolean)||'';
  let coverUrl='';
  const rawImage=asOne(book.image)||meta['og:image']||meta['twitter:image']||'';
  if (typeof rawImage === 'string' && rawImage.trim()) {
    try {
      const resolved=new URL(rawImage.trim(),location).href;
      const u=safeCoverUrl(resolved);
      // new URL('', page) produces the HTML page itself; it is not a cover.
      if (u.href !== location.href
        && !/(?:logo|avatar|placeholder|social|banner|og-default|default-image)/i.test(u.pathname)
        && /^(?:https?):$/.test(u.protocol)) coverUrl=u.href;
    } catch {/* No valid image on this page. */}
  }
  const rawKeywords=book.keywords||meta.keywords||[];
  const tags=(Array.isArray(rawKeywords)?rawKeywords:String(rawKeywords).split(/[,;|]/))
    .map(x=>cleaned(asOne(x),70)).filter(x=>x.length>=3).slice(0,16);
  const pageCount=Number(book.numberOfPages);
  return {title,author,isbn,description,coverUrl,tags,
    publisher:cleaned(asOne(book.publisher),180),
    pageCount:Number.isInteger(pageCount)&&pageCount>0&&pageCount<20000?pageCount:null,
    confidence:exactIsbn?'isbn':'title_author',origin:location.hostname,sourceUrl:location.href};
}
// Race non-abortable DNS/policy promises against the same end-to-end deadline.
// Late resolutions/rejections are handled without opening another connection.
function beforeAbort(signal,operation){
  if(signal.aborted)return Promise.reject(new Error('source_timeout'));
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new Error('source_timeout'));
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{
      if(signal.aborted)throw new Error('source_timeout');
      return operation();
    }).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
// Safeguarded remote HTML retrieval: DNS pinning, public IPv4 only,
// HTTPS only, bounded payload, redirects and end-to-end timeout.
async function fetchHtml(url,{maxBytes=520000,timeoutMs=6500,
  dnsLookup=dns.lookup,httpsGet=https.get,allowRedirect=null}={}) {
  const ctl=new AbortController();
  let timeout,phase='url';
  try {
    timeout=setTimeout(()=>ctl.abort(),Math.min(Math.max(timeoutMs,500),10000));
    let current=url;
    for(let redirect=0;redirect<=2;redirect++){
      phase='url';
      const parsed=safeCoverUrl(current);
      if(parsed.protocol!=='https:')return {error:'unsafe_url'};
      phase='dns';
      const addrs=await beforeAbort(ctl.signal,()=>dnsLookup(parsed.hostname,{family:4,all:true}));
      if(!addrs.length||addrs.some(x=>!publicIPv4(x.address)))return {error:'unsafe_dns',phase};
      phase='http';
      const result=await beforeAbort(ctl.signal,()=>new Promise((resolve,reject)=>{
        let finished=false;
        const req=httpsGet(parsed,{
          headers:{Accept:'text/html,text/plain;q=0.3','User-Agent':'Boekenbaai/1.0 (school-library-metadata)'},
          lookup:(_h,_opt,cb)=>cb(null,addrs[0].address,4),
          family:4,signal:ctl.signal,
        },res=>{
          // A stream error can occur even after redirect/404 early returns.
          // The request error handler does not observe IncomingMessage errors.
          res.on('error',reject);
          const status=res.statusCode;
          if([301,302,303,307,308].includes(status)){
            res.resume();resolve({redirect:res.headers.location});return;
          }
          if([404,410].includes(status)){res.resume();resolve({status,body:''});return;}
          if(status===408||status===429||status>=500){res.resume();resolve({error:'source_unavailable',status});return;}
          const type=String(res.headers['content-type']||'').toLowerCase();
          if(status!==200||!/(?:text\/html|text\/plain|application\/xhtml\+xml)/.test(type)){
            res.resume();resolve({error:'not_html',status});return;
          }
          if(Number(res.headers['content-length'])>maxBytes){
            res.destroy();resolve({error:'too_large'});return;
          }
          const chunks=[];let length=0;
          res.on('data',b=>{length+=b.length;if(length>maxBytes){res.destroy();resolve({error:'too_large'});}else chunks.push(b);});
          res.on('end',()=>{if(!finished){finished=true;resolve({status,body:Buffer.concat(chunks).toString('utf8')});}});
        });
        req.on('error',reject);
      }));
      if(result.redirect){
        phase='redirect_policy';
        const next=new URL(result.redirect,parsed).href;
        // The destination can be a different path or host. Require a fresh
        // robots.txt decision before opening the redirected HTML page.
        if(typeof allowRedirect==='function' && !(await beforeAbort(ctl.signal,()=>allowRedirect(next))))
          return {error:'robots_disallowed',phase};
        current=next;
        continue;
      }
      return {...result,phase,finalUrl:parsed.href};
    }
    return {error:'too_many_redirects'};
  }catch(err){return {error:ctl.signal.aborted?'timeout':'request_error',phase,errorCode:err?.code||''};}
  finally{clearTimeout(timeout);ctl.abort();}
}
function robotsAllowed(content,path){
  if(!content||typeof content!=='string')return true;
  // Consecutive User-agent directives form one group until a rule starts.
  // A subsequent User-agent directive after rules begins a new group.
  const groups=[];
  let current={agents:[],rules:[]};
  function finishGroup(){
    if(current.agents.length)groups.push(current);
    current={agents:[],rules:[]};
  }
  for(const rawLine of content.split(/\r?\n/)){
    const clean=rawLine.split('#')[0].trim();
    if(!clean){finishGroup();continue;}
    const entry=clean.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
    if(!entry)continue;
    const type=entry[1].toLowerCase(),value=entry[2].trim();
    if(type==='user-agent'){
      if(current.rules.length)finishGroup();
      current.agents.push(value.toLowerCase());
    }else if(current.agents.length&&value){
      current.rules.push({type,value});
    }
  }
  finishGroup();
  let selected={length:-1,allow:true};
  for(const group of groups){
    if(!group.agents.some(agent=>agent==='*'||agent.includes('boekenbaai')))continue;
    for(const rule of group.rules){
      // Fail conservatively for wildcard Disallow; never let a wildcard
      // Allow match more URLs than it really does.
      if(rule.value.includes('*')&&rule.type==='allow')continue;
      const anchored=rule.value.endsWith('$');
      const withoutAnchor=anchored?rule.value.slice(0,-1):rule.value;
      const prefix=withoutAnchor.split('*')[0];
      if(!prefix||!path.startsWith(prefix))continue;
      if(anchored&&!rule.value.includes('*')&&path!==withoutAnchor)continue;
      const specificity=withoutAnchor.length;
      // A tied Disallow wins, avoiding accidental crawling when groups
      // disagree. A more specific Allow can still override it.
      if(specificity>selected.length
        ||(specificity===selected.length&&rule.type==='disallow')){
        selected={length:specificity,allow:rule.type==='allow'};
      }
    }
  }
  return selected.allow;
}
function snippetText(candidate){
  return (Array.isArray(candidate?.snippets)?candidate.snippets:[]).slice(0,6)
    .filter(v=>typeof v==='string').map(v=>v.slice(0,650)).join(' ');
}
function snippetIsbnMatch(target,candidate){
  const wanted=String(target.isbn||'').replace(/[^0-9X]/gi,'');
  if(!isValidIsbn(wanted))return false;
  const text=[candidate.title,candidate.url,snippetText(candidate)].join(' ');
  // Do not accept an ISBN embedded inside a longer number.
  const values=text.match(/(?<![0-9])(?:97[89][ -]?(?:[0-9][ -]?){9}[0-9]|(?:[0-9][ -]?){9}[0-9Xx])(?![0-9])/g)||[];
  return values.some(v=>{const digits=v.replace(/[^0-9X]/gi,'');return isValidIsbn(digits)&&toIsbn13(digits)===toIsbn13(wanted);});
}
function snippetWorkMatch(target,candidate){
  const full=normalize(target.title),surname=normalize(target.author).split(' ').filter(x=>x.length>=3).at(-1);
  const text=' '+normalize(snippetText(candidate))+' ';
  return full.length>=5&&surname&&text.includes(' '+full+' ')&&text.includes(' '+surname+' ');
}
function rankPublisherCandidates(candidates,target){
  // Prefer a plausible publisher hostname, not untrusted snippets as proof.
  // Exact ISBN and work identity checks still apply after opening the page.
  const publisher=normalize(target.publisher).split(' ').filter(x=>x.length>=3
    &&!['uitgeverij','uitgevers','media','boeken','publishing','groep','the','van','het','een','b v'].includes(x));
  const score=candidate=>{
    try{
      const host=new URL(candidate.url).hostname.toLowerCase().replace(/^www\./,'');
      const name=normalize(host.split('.').slice(0,-1).join(' ')).replace(/ /g,'');
      const publisherMatch=publisher.length&&publisher.every(token=>name.includes(token));
      // Snippets only help prioritize which original pages to inspect.
      // They never authenticate a book, edition, image or description.
      return (snippetIsbnMatch(target,candidate)?8:0)+(publisherMatch?4:0)
        +(snippetWorkMatch(target,candidate)?2:0)+(narrativeDescription(snippetText(candidate))?1:0);
    }catch{return 0;}
  };
  return [...candidates].sort((a,b)=>score(b)-score(a));
}
function candidateMayMatch(target,candidate){
  const title=normalize(candidate.title),full=normalize(target.title);
  if(full&&title.includes(full))return true;
  if(snippetIsbnMatch(target,candidate)||snippetWorkMatch(target,candidate))return true;
  // Permit lookup of a plausible split title, not acceptance of it.
  // The fetched page still has to prove the full title and identity.
  return String(target.title||'').split(/\s*[:.]\s+|\s+[–—-]\s+/)
    .map(normalize).filter(part=>part.length>=7&&part.split(' ').length>=2)
    .some(part=>(' '+title+' ').includes(' '+part+' '));
}
async function discoverPages(search,target,{fetchPage=fetchHtml,maxPages=3,onFailure=()=>{}}={}) {
  const candidates=rankPublisherCandidates((Array.isArray(search?.pages)?search.pages:[]).slice(0,8),target);
  const outputs=[];const visited=new Set();const robots=new Map();
  async function readPage(url,options){
    const started=Date.now();
    try{return {...(await fetchPage(url,options)||{error:'request_error'}),elapsedMs:Date.now()-started};}
    catch(err){return {error:'request_error',errorCode:err?.code||'',elapsedMs:Date.now()-started};}
  }
  const failureDetail=(url,stage,response)=>({url,stage,reason:response?.error||String(response?.status||'unknown'),
    phase:response?.phase||'',httpStatus:response?.status,errorCode:response?.errorCode||'',elapsedMs:response?.elapsedMs});
  async function allowedPage(url){
    let u;
    try{u=safeCoverUrl(url);if(u.protocol!=='https:')return false;}catch{return false;}
    const root=u.origin;
    if(!robots.has(root)){
      const response=await readPage(root+'/robots.txt',{maxBytes:64000,timeoutMs:3000});
      if(!response||response.error|| (response.status&&![200,404,410].includes(response.status)))onFailure('source_unavailable',failureDetail(root+'/robots.txt','robots',response));
      // A missing or unreachable robots.txt never authorizes extra crawling.
      robots.set(root,!response || response.error || (response.status && ![200,404,410].includes(response.status))
        ? null : (response?.body ?? ''));
    }
    return robots.get(root)!==null && robotsAllowed(robots.get(root),u.pathname+u.search);
  }
  for(const candidate of candidates){
    if(outputs.length>=maxPages)break;
    // Search metadata is only used for coarse preselection.
    if(!candidateMayMatch(target,candidate))continue;
    let u;try{u=safeCoverUrl(candidate.url);if(u.protocol!=='https:')continue;}catch{continue;}
    if(visited.has(u.href))continue;visited.add(u.href);
    if(!(await allowedPage(u.href)))continue;
    const page=await readPage(u.href,{allowRedirect:allowedPage});
    if(!page||page.error)onFailure('source_unavailable',failureDetail(u.href,'page',page));
    if(!page?.body)continue;
    const parsed=parseBookPage(page.body,target,page.finalUrl||u.href);
    if(parsed)outputs.push(parsed);
  }
  return outputs;
}
function selectImageResult(images,target) {
  for(const result of images||[]){
    if(!matchTitleAuthor(target,{title:result.title},''))continue;
    if(result.width&&result.height&&(result.height<200
      ||result.width/result.height<0.45||result.width/result.height>0.92))continue;
    try{const url=safeCoverUrl(result.imageUrl);if(url.protocol==='https:')return url.href;}catch{/* skip */}
  }
  return '';
}
module.exports={normalize,sameWorkTitle,matchTitleAuthor,parseMonthlyRemaining,queryFor,fetchBrave,
  parseBookPage,fetchHtml,robotsAllowed,discoverPages,selectImageResult,rankPublisherCandidates,candidateMayMatch};
