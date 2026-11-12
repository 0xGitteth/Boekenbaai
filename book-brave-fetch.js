'use strict';

// Brave discovery stays separate from reading the publisher's original page.
// Untrusted search results are never treated as verified bibliographic facts.
const https=require('node:https');
const dns=require('node:dns').promises;
const {safeCoverUrl,publicIPv4}=require('./lib/cover-assets');

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
  const policy=String(response?.headers?.get?.('x-ratelimit-policy')||'');
  const remaining=String(response?.headers?.get?.('x-ratelimit-remaining')||'');
  const windows=policy.split(',').map(p=>p.trim());
  const amounts=remaining.split(',').map(p=>Number(p.trim()));
  const monthly=windows.findIndex(x=>/w\s*=\s*(2592000|2628000|2678400|2[5-7]\d{5})/.test(x));
  const index=monthly>=0?monthly:(amounts.length>=2?amounts.length-1:-1);
  return index>=0&&Number.isSafeInteger(amounts[index])&&amounts[index]>=0?amounts[index]:null;
}
function queryFor(step,target) {
  const title=cleaned(target.title,150).replace(/["\r\n]/g,'');
  const author=cleaned(target.author,130).replace(/["\r\n]/g,'');
  const isbn=String(target.isbn||'').replace(/[^0-9X]/gi,'');
  if(step===0)return isbn?isbn+' '+title+' '+author+' boek':('"'+title+'" "'+author+'" boek');
  if(step===1)return '"'+title+'" "'+author+'" kaft omslag boek';
  return '"'+title+'" "'+author+'" samenvatting thema recensie uitgever';
}
async function fetchBrave(step,target,{apiKey,fetchImpl=globalThis.fetch,timeoutMs=7000}={}) {
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
  if(!image)url.searchParams.set('result_filter','web');
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),Math.max(1000,Math.min(timeoutMs,10000)));
  try{
    const response=await fetchImpl(url.toString(),{
      headers:{'X-Subscription-Token':apiKey,Accept:'application/json'},
      signal:ctl.signal,redirect:'error',
    });
    const providerRemaining=parseMonthlyRemaining(response);
    if(!response.ok) {
      const error=response.status===429?'rate_limited':response.status===402?'payment_required'
        :[401,403].includes(response.status)?'unauthorized':'provider_error';
      return {error,providerRemaining};
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
      .slice(0,8).map(x=>({title:cleaned(x.title,250),url:String(x.url||'').slice(0,1600)}))};
  }catch(err){
    return {error:err?.name==='AbortError'?'timeout':'request_error'};
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
  const title=cleaned(asOne(book.name||book.headline)||meta['og:title']
    ||(h1?decodeEntities(h1[1]):''),350);
  const author=cleaned(asOne(book.author)||meta.author||'',220);
  const allText=decodeEntities(html.replace(/<script\b[\s\S]*?<\/script\s*>/gi,' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi,' ').replace(/<[^>]*>/g,' ')).slice(0,45000);
  const isbn=String(book.isbn||'').replace(/[^0-9X]/gi,'');
  const wantedIsbn=String(target.isbn||'').replace(/[^0-9X]/gi,'');
  // Exact ISBN or title+author is mandatory; a similar title is insufficient.
  const exactIsbn=Boolean(isbn&&wantedIsbn&&isbn===wantedIsbn);
  const sameTitle=sameWorkTitle(target.title,title,target.author);
  const sameWork=matchTitleAuthor(target,{title,author},allText.slice(0,15000));
  // A matching ISBN alone is insufficient when the structured title names
  // a different work. Exact title and work-level identity remain mandatory.
  if(!sameTitle||(!exactIsbn&&!sameWork))return null;
  const rawDescription=asOne(book.description)||meta.description||meta['og:description']||'';
  const description=cleaned(decodeEntities(rawDescription),2500);
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
    confidence:exactIsbn?'isbn':'title_author',origin:location.hostname};
}
// Safeguarded remote HTML retrieval: DNS pinning, public IPv4 only,
// HTTPS only, bounded payload, redirects and end-to-end timeout.
async function fetchHtml(url,{maxBytes=520000,timeoutMs=6500,
  dnsLookup=dns.lookup,httpsGet=https.get,allowRedirect=null}={}) {
  const ctl=new AbortController();
  let timeout;
  try {
    timeout=setTimeout(()=>ctl.abort(),Math.min(Math.max(timeoutMs,500),10000));
    let current=url;
    for(let redirect=0;redirect<=2;redirect++){
      const parsed=safeCoverUrl(current);
      if(parsed.protocol!=='https:')return {error:'unsafe_url'};
      const addrs=await dnsLookup(parsed.hostname,{family:4,all:true});
      if(!addrs.length||addrs.some(x=>!publicIPv4(x.address)))return {error:'unsafe_dns'};
      const result=await new Promise((resolve,reject)=>{
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
          if(status===404){res.resume();resolve({status,body:''});return;}
          const type=String(res.headers['content-type']||'').toLowerCase();
          if(status!==200||!/(?:text\/html|text\/plain|application\/xhtml\+xml)/.test(type)){
            res.resume();resolve({error:'not_html'});return;
          }
          if(Number(res.headers['content-length'])>maxBytes){
            res.destroy();resolve({error:'too_large'});return;
          }
          const chunks=[];let length=0;
          res.on('data',b=>{length+=b.length;if(length>maxBytes){res.destroy();resolve({error:'too_large'});}else chunks.push(b);});
          res.on('end',()=>{if(!finished){finished=true;resolve({status,body:Buffer.concat(chunks).toString('utf8')});}});
        });
        req.on('error',reject);
      });
      if(result.redirect){
        const next=new URL(result.redirect,parsed).href;
        // The destination can be a different path or host. Require a fresh
        // robots.txt decision before opening the redirected HTML page.
        if(typeof allowRedirect==='function' && !(await allowRedirect(next)))
          return {error:'robots_disallowed'};
        current=next;
        continue;
      }
      return {...result,finalUrl:parsed.href};
    }
    return {error:'too_many_redirects'};
  }catch{return {error:'request_error'};}
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
async function discoverPages(search,target,{fetchPage=fetchHtml,maxPages=3}={}) {
  const candidates=Array.isArray(search?.pages)?search.pages:[];
  const outputs=[];const visited=new Set();const robots=new Map();
  async function allowedPage(url){
    let u;
    try{u=safeCoverUrl(url);if(u.protocol!=='https:')return false;}catch{return false;}
    const root=u.origin;
    if(!robots.has(root)){
      const response=await fetchPage(root+'/robots.txt',{maxBytes:64000,timeoutMs:3000});
      // A missing or unreachable robots.txt never authorizes extra crawling.
      robots.set(root,response?.error || (response?.status && ![200,404].includes(response.status))
        ? null : (response?.body ?? ''));
    }
    return robots.get(root)!==null && robotsAllowed(robots.get(root),u.pathname+u.search);
  }
  for(const candidate of candidates){
    if(outputs.length>=maxPages)break;
    // Search metadata is only used for coarse preselection.
    if(!normalize(candidate.title).includes(normalize(target.title)))continue;
    let u;try{u=safeCoverUrl(candidate.url);if(u.protocol!=='https:')continue;}catch{continue;}
    if(visited.has(u.href))continue;visited.add(u.href);
    if(!(await allowedPage(u.href)))continue;
    const page=await fetchPage(u.href,{allowRedirect:allowedPage});
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
  parseBookPage,fetchHtml,robotsAllowed,discoverPages,selectImageResult};
