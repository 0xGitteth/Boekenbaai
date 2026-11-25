'use strict';
// These are possible meanings, not preferences. Each rule has a bounded ID and explicit choices.
const RULES=[
 [
  "fishing",
  "vissen",
  "Bedoel je vissen vangen of vind je vissen als dieren interessant? 🎣",
  [
   [
    "fishing",
    "Vissen vangen",
    [
     "vissen vangen",
     "vis vangen",
     "hengelsport",
     "hengel",
     "hengelen",
     "sportvissen",
     "karpervissen",
     "vangen"
    ]
   ],
   [
    "fishAnimals",
    "Vissen als dieren",
    [
     "vissen als dieren",
     "als dieren",
     "als dier",
     "vissoorten",
     "zoetwatervissen",
     "tropische vissen",
     "vissen in zee",
     "vissen in het water"
    ]
   ],
   [
    "aquarium",
    "Vissen houden in een aquarium",
    [
     "aquarium",
     "aquariumvissen",
     "vissen houden",
     "vissen verzorgen"
    ]
   ],
   [
    "fishFood",
    "Vis eten of klaarmaken",
    [
     "vis eten",
     "vis bereiden",
     "vis bakken",
     "vis koken"
    ]
   ],
   [
    "astrology",
    "Het sterrenbeeld Vissen",
    [
     "sterrenbeeld vissen",
     "horoscoop",
     "astrologie"
    ]
   ]
  ]
 ],
 [
  "racing",
  "racen|races",
  "Bedoel je zelf racen, races kijken of racen in games?",
  [
   [
    "karting",
    "Zelf racen of karten",
    [
     "zelf racen",
     "karten",
     "ik race",
     "kartbaan"
    ]
   ],
   [
    "motorsport",
    "Races kijken",
    [
     "races kijken",
     "formule 1",
     "f1",
     "motogp",
     "motorsport",
     "racewedstrijden kijken",
     "racewedstrijden volgen"
    ]
   ],
   [
    "racingGames",
    "Racen in games",
    [
     "racegames",
     "race games",
     "racen in games",
     "simracen",
     "simracing"
    ]
   ]
  ]
 ],
 [
  "building",
  "bouwen",
  "Wat bouw je graag? Denk je aan LEGO, games of dingen in het echt?",
  [
   [
    "lego",
    "LEGO",
    [
     "lego",
     "bouwstenen"
    ]
   ],
   [
    "gameBuilding",
    "Bouwen in games",
    [
     "minecraft",
     "bouwen in games",
     "game",
     "games"
    ]
   ],
   [
    "woodworking",
    "Met hout bouwen",
    [
     "hout",
     "timmeren",
     "houtbewerking",
     "meubels"
    ]
   ],
   [
    "construction",
    "Gebouwen maken",
    [
     "gebouwen",
     "huizen",
     "bouwkunde",
     "bouwplaats"
    ]
   ]
  ]
 ],
 [
  "shooting",
  "schieten",
  "Bedoel je fotograferen, schietsport of een game?",
  [
   [
    "photography",
    "Foto's maken",
    [
     "fotograferen",
     "fotografie",
     "foto",
     "fotos",
     "foto s",
     "camera"
    ]
   ],
   [
    "targetSport",
    "Schietsport",
    [
     "schietsport",
     "boogschieten",
     "schieten als sport",
     "sportief schieten"
    ]
   ],
   [
    "gameShooting",
    "Schieten in games",
    [
     "games",
     "game",
     "shooters",
     "shootergames"
    ]
   ]
  ]
 ],
 [
  "chess",
  "schaken",
  "Speel je zelf graag schaak, volg je wedstrijden of wil je vooral beter leren schaken?",
  [
   [
    "chessPlaying",
    "Zelf schaken",
    [
     "zelf schaken",
     "ik schaak",
     "schaak spelen",
     "schaakpartijen spelen"
    ]
   ],
   [
    "chessWatching",
    "Schaken volgen",
    [
     "schaken kijken",
     "schaken volgen",
     "schaakwedstrijden kijken",
     "schaaktoernooi volgen"
    ]
   ],
   [
    "chessStrategy",
    "Schaakstrategie leren",
    [
     "schaakstrategie",
     "schaakpuzzels",
     "schaakopeningen",
     "schaken leren",
     "beter leren schaken"
    ]
   ]
  ]
 ],
 [
  "baking",
  "bakken",
  "Wat voor bakken bedoel je? Taart en brood, of bijvoorbeeld keramiek?",
  [
   [
    "baking",
    "Taarten, brood of koekjes bakken",
    [
     "taarten",
     "taart",
     "brood",
     "koekjes",
     "cake",
     "gebak"
    ]
   ],
   [
    "ceramics",
    "Keramiek of klei bakken",
    [
     "klei",
     "keramiek",
     "potten"
    ]
   ],
   [
    "cooking",
    "Eten klaarmaken",
    [
     "eten",
     "maaltijd",
     "koken",
     "vis bakken"
    ]
   ]
  ]
 ],
 [
  "motors",
  "motoren",
  "Bedoel je motorfietsen of vind je vooral de techniek van motoren interessant?",
  [
   [
    "motorcycles",
    "Motorfietsen",
    [
     "motorfiets",
     "motorfietsen",
     "motorrijden",
     "motor rijden"
    ]
   ],
   [
    "engines",
    "Motortechniek",
    [
     "motorblok",
     "motorblokken",
     "motortechniek",
     "motoren repareren",
     "motoren bouwen"
    ]
   ],
   [
    "motorsport",
    "Motorsport kijken",
    [
     "motogp",
     "motorsport",
     "formule 1"
    ]
   ]
  ]
 ],
 [
  "horses",
  "paarden",
  "Wat vind je vooral leuk aan paarden? Rijden, verzorgen of de dieren zelf?",
  [
   [
    "horseRiding",
    "Paardrijden",
    [
     "paardrijden",
     "manege rijden",
     "rijden op een paard"
    ]
   ],
   [
    "horseCare",
    "Paarden verzorgen",
    [
     "paarden verzorgen",
     "paardenverzorging",
     "paard verzorgen",
     "borstelen"
    ]
   ],
   [
    "horses",
    "Paarden als dieren",
    [
     "paarden als dieren",
     "als dieren",
     "paardengedrag"
    ]
   ]
  ]
 ]
];
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const contains=(value,phrase)=>(' '+value+' ').includes(' '+normalize(phrase)+' ');
function findAmbiguity(text){
 for(const part of String(text||'').split(/[.!?;\n]|\b(?:maar|echter)\b/i)){
  const value=normalize(part);
  for(const rule of RULES){
   if(!rule[1].split('|').some(word=>contains(value,word)))continue;
   const qualified=rule[3].filter(([, ,aliases])=>aliases.some(a=>contains(value,a)));
   if(qualified.length===1)continue;
   return {rule,negative:/\b(?:niet|geen|zonder|hekel|vermijd)\b/.test(value),reading:/\b(?:lees|lezen|boek|boeken)\b/.test(value)};
  }
 }
 return null;
}
function resolveMeaning(rule,text){
 const value=normalize(text);
 const matches=rule[3].filter(([,label,aliases])=>normalize(label)===value||aliases.some(a=>contains(value,a)));
 return matches.length===1?matches[0][0]:'';
}
module.exports={RULES,findAmbiguity,resolveMeaning};
