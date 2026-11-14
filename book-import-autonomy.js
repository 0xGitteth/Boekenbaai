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
  const max=shortest>=10?2:1;
  return limitedEdits(a,b,max)<=max;
}
function sameBookTitle(left,right){
  if(nearlySameBookText(left,right))return true;
  // Publishers often omit a series prefix or parenthetical subtitle.
  // The shared substantive title segment must be long and specific.
  const a=String(left??''),b=String(right??'');
  if(!a.trim()||!b.trim())return false;
  const digits=s=>(normalized(s).match(/\d+/g)||[]).join('|');
  if(digits(a)!==digits(b))return false;
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
module.exports={normalized,nearlySameBookText,sameBookTitle,sameBookIdentity,smallPageDifference};
