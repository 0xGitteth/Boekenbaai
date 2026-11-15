'use strict';

// Conservative similarity only for a *confirmed identical edition ISBN*.
// It is never an ISBN lookup substitute, never used for class/person matching,
// and never used to decide which physical copy or borrower to change.
function normalized(value){
  return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/gu,'')
    .toLocaleLowerCase('nl').replace(/[^\p{L}\p{N}]/gu,'');
}
function limitedEdits(a,b,max){
  if(Math.abs(a.length-b.length)>max)return max+1;
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const current=[i],start=Math.max(1,i-max),stop=Math.min(b.length,i+max);
    for(let j=1;j<start;j++)current[j]=max+1;
    let minimum=current[0];
    for(let j=start;j<=stop;j++){
      const edit=Math.min(
        previous[j]+1,
        current[j-1]+1,
        previous[j-1]+(a[i-1]===b[j-1]?0:1),
      );
      current[j]=edit;minimum=Math.min(minimum,edit);
    }
    for(let j=stop+1;j<=b.length;j++)current[j]=max+1;
    if(minimum>max)return max+1;
    previous=current;
  }
  return previous[b.length];
}
function nearlySameBookText(left,right){
  const a=normalized(left),b=normalized(right);
  if(!a||!b)return false;
  if(a===b)return true;
  // Year, volume and part numbers carry edition significance. Never
  // silently turn 'part 1' into 'part 2' because of a tiny edit distance.
  const digits=s=>(s.match(/\d+/g)||[]).join('|');
  if(digits(a)!==digits(b))return false;
  const shortest=Math.min(a.length,b.length);
  if(shortest<8)return false;
  // Two short edits can represent a single misspelled given name,
  // such as Carrie/Carry. Never apply this without matching edition ISBN.
  const max=shortest>=9?2:1;
  return limitedEdits(a,b,max)<=max;
}
// An ISBN edition title can carry an extra printing / volume label in a
// catalogue. Omission of that label is not a different work, but two
// conflicting non-empty labels must never be treated as interchangeable.
function editionQualifier(value){
  const match=String(value??'').trim().match(
    /^(.*?)\s*(?:\(\s*(?:book|deel|volume|vol\.?|druk)\s*(\d+)\s*\)|\s*(?:\/|[-–—])\s*(?:book|deel|volume|vol\.?|druk)\s*(\d+))\s*$/iu
  );
  if(!match||!normalized(match[1]))return null;
  return {base:normalized(match[1]),part:Number(match[2]||match[3])};
}
function hasConflictingEditionQualifiers(titles){
  const qualifiedByBase=new Map();
  for(const title of titles||[]){
    const qualifier=editionQualifier(title);
    if(!qualifier)continue;
    const numbers=qualifiedByBase.get(qualifier.base)||new Set();
    numbers.add(qualifier.part);
    if(numbers.size>1)return true;
    qualifiedByBase.set(qualifier.base,numbers);
  }
  return false;
}
// These title variants only matter after an edition ISBN has already been
// independently established. They must not be used to discover ISBNs.
function words(value){
  return String(value??'').normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu,'').toLocaleLowerCase('nl')
    .match(/[\p{L}\p{N}]+/gu)||[];
}
function seriesTitleSuffix(longer,shorter){
  const a=words(longer),b=words(shorter);
  if(b.length<2||b.join('').length<12||a.length<=b.length)return false;
  const prefix=a.slice(0,-b.length).join('');
  return prefix.length>=3&&a.slice(-b.length).join('|')===b.join('|');
}
function explicitlySeparatedTitle(longer,shorter){
  if(normalized(shorter).length<6)return false;
  const segments=String(longer??'').split(/(?:\.\s+|:\s+|\s+[-–—]\s+)/u);
  return segments.length>1
    &&normalized(segments.at(-1))===normalized(shorter)
    &&normalized(segments.slice(0,-1).join('')).length>=3;
}
function graphicDescriptorEquivalent(left,right){
  const stripGraphic=value=>String(value??'')
    .replace(/(?:\s+|\s*[-–—]\s*)(?:graphic(?:\s+novel)?|stripbewerking|striproman)\s*$/iu,'')
    .trim();
  const a=stripGraphic(left),b=stripGraphic(right);
  return a!==String(left??'').trim()||b!==String(right??'').trim()
    ?normalized(a).length>=12&&normalized(a)===normalized(b):false;
}
function numberedTitle(value){
  const match=String(value??'').trim().match(
    /^(.*?)\s+(I|II|III|IV|V|VI|VII|VIII|IX|X|[0-9]+)$/iu
  );
  if(!match||normalized(match[1]).length<6)return null;
  const roman={I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9,X:10};
  const part=/^[0-9]+$/.test(match[2])
    ?Number(match[2]):roman[match[2].toUpperCase()];
  return Number.isInteger(part)?{base:normalized(match[1]),part}:null;
}
function equivalentRomanVolume(left,right){
  const a=numberedTitle(left),b=numberedTitle(right);
  return Boolean(a&&b&&a.base===b.base&&a.part===b.part);
}
function sameBookTitle(left,right){
  if(nearlySameBookText(left,right))return true;
  if(equivalentRomanVolume(left,right))return true;
  const aQualifier=editionQualifier(left),bQualifier=editionQualifier(right);
  if(aQualifier&&bQualifier
    &&aQualifier.base===bQualifier.base
    &&aQualifier.part!==bQualifier.part)return false;
  if(aQualifier && !bQualifier && aQualifier.base===normalized(right))return true;
  if(bQualifier && !aQualifier && bQualifier.base===normalized(left))return true;
  // Publishers often omit a series prefix or parenthetical subtitle.
  // The shared substantive title segment must be long and specific.
  const a=String(left??''),b=String(right??'');
  if(!a.trim()||!b.trim())return false;
  const digits=s=>(normalized(s).match(/\d+/g)||[]).join('|');
  if(digits(a)!==digits(b))return false;
  // A longer catalogue title can contain a series prefix with no punctuation:
  // "Magnus Chase de hamer van Thor" vs "De hamer van Thor".
  // NEVER accept an arbitrary shared prefix: "De Gorgels" is not
  // "De Gorgels en het geheim van de gletsjer".
  if(seriesTitleSuffix(a,b)||seriesTitleSuffix(b,a)
    ||explicitlySeparatedTitle(a,b)||explicitlySeparatedTitle(b,a)
    ||graphicDescriptorEquivalent(a,b))return true;
  const parts=s=>s.split(/\s+[-–—]\s+|[:()]/u).map(v=>v.trim())
    .filter(v=>normalized(v).length>=12);
  const aParts=parts(a),bParts=parts(b);
  if(aParts.length<1||bParts.length<1)return false;
  const shorter=a.length<=b.length?a:b;
  const longer=a.length>b.length?a:b;
  // A whole title can occur as the first or last part of an expanded
  // bibliographic title. Two expanded titles may share a long last part.
  const full=normalized(shorter);
  const longParts=parts(longer);
  if(longParts.some(part=>normalized(part)===full))return true;
  return aParts.length>1&&bParts.length>1
    &&nearlySameBookText(aParts.at(-1),bParts.at(-1));
}
function sameBookIdentity(a,b){
  return sameBookTitle(a?.title,b?.title)
    &&nearlySameBookText(a?.author,b?.author);
}
function smallPageDifference(left,right){
  const a=Number(left),b=Number(right);
  if(!Number.isInteger(a)||!Number.isInteger(b)||a<=0||b<=0)return false;
  return Math.abs(a-b)<=Math.max(10,Math.ceil(Math.max(a,b)*0.05));
}
module.exports={normalized,nearlySameBookText,sameBookTitle,
  hasConflictingEditionQualifiers,sameBookIdentity,smallPageDifference};
