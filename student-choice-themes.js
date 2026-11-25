'use strict';
// Pupil aliases are separate from catalogue evidence.
const THEMES={
 crime:['criminaliteit en misdaad',['criminaliteit','misdaad','misdaden','criminelen','crimineel','maffia','drugsbende','overval','misdaadverhalen'],['criminaliteit','misdaad','crimineel','maffia','drugsbende','overval']],
 psychology:['psychologie',['psychologie','psychologisch','waarom mensen bepaalde dingen doen','waarom mensen dingen doen','gedrag van mensen','hoe mensen denken'],['psychologie','psychologisch','gedragspsychologie','menselijk gedrag']],
 manipulation:['manipulatie',['manipulatie','manipuleert','manipuleren','iemand voorliegt','gaslighting'],['manipulatie','manipuleren','gaslighting','manipulatief']],
 disappearance:['vermissingen',['vermissingen','vermissing','vermiste mensen','vermiste personen','spoorloos','mensen verdwijnen','iemand verdwijnt','mensen helemaal verdwijnen'],['vermissing','vermist','spoorloos','verdwijning','ontvoerd']],
 secrets:['geheimen',['geheimhouden','geheim houdt','geheimhoudt','dingen geheimhouden','iets verbergen','verzwijgen','familiegeheim','familiegeheimen'],['familiegeheim','geheim','verzwijgen','verborgen verleden']],
 family:['familie',['familie','gezin','ouders','broers','zussen','broer','zus'],['familie','gezin','ouders','familierelatie']],
 police:['politieonderzoek',['politie','recherche','rechercheur','politieonderzoek'],['politie','rechercheur','politieonderzoek','recherche']],
 criminalPerspective:['criminelen als hoofdpersonage',['criminelen zelf','vanuit de crimineel','vanuit criminelen','crimineel als hoofdpersoon'],['jonge crimineel','crimineel als hoofdpersoon','drugsdealer','bendelid','gangster']],
 justice:['onrecht',['onrecht','onrechtvaardig','discriminatie','racisme','onterecht beschuldigd','ongelijkheid'],['onrecht','discriminatie','racisme','ongelijkheid','onterecht beschuldigd']],
 outsider:['erbij horen',['pesten','gepest','buitenbeentje','erbij horen','eenzaamheid','eenzaam'],['pesten','buitenbeentje','eenzaam','erbij horen']],
 growth:['persoonlijke ontwikkeling',['opgroeien','zelfvertrouwen','doorzetten','persoonlijke ontwikkeling','doorzettingsvermogen'],['opgroeien','zelfvertrouwen','doorzetten','persoonlijke ontwikkeling','coming of age']],
 empathy:['gevoelens en verlies',['verdriet','rouw','verlies','gevoelens','emoties','mentale gezondheid'],['rouw','verlies','verdriet','emoties','mentale gezondheid']],
 animalLoss:['het overlijden van dieren',['dier doodgaat','hond doodgaat','kat doodgaat','overlijden van dieren','dood van een hond','dieren doodgaan'],['dood van een hond','overlijden van een hond','hond sterft','hond overlijdt','dier sterft','dier overlijdt','dier doodgaat']],
 magic:['magie en bijzondere krachten',['bijzondere krachten','magische krachten','bovennatuurlijk','toverkracht'],['magie','magische krachten','bovennatuurlijk','toverkracht']],
 gaming:['games',['games','videogames','game','gamet','gamen','gaming','gamewereld'],['videogame','gaming','gamewereld','computerspel']],
 future:['toekomst',['toekomst','toekomstig','sciencefiction','science fiction','sci fi','dystopie'],['toekomst','sciencefiction','science fiction','dystopie']],
 war:['oorlog',['oorlog','oorlogen','tweede wereldoorlog','verzet','soldaten'],['oorlog','wereldoorlog','verzet','soldaat']],
 music:['muziek',['muziek','zanger','zingen','rap','rapper','muzikant','band'],['muziek','muzikant','zanger','rapper']],
 art:['kunst en creativiteit',['kunst','tekenen','schilderen','fotografie','creatief'],['kunst','fotografie','schilderkunst','tekenen']],
 travel:['reizen',['reizen','reis','andere landen','vakantie','op reis'],['reizen','reisverhaal','wereldreis','expeditie']],
 survival:['overleven',['overleven','survival','rampen','ramp','gestrand'],['overleven','survival','ramp','gestrand']],
 environment:['milieu en klimaat',['klimaat','milieu','klimaatverandering','vervuiling'],['klimaat','milieu','klimaatverandering','vervuiling']],
 health:['gezondheid',['gezondheid','ziekenhuis','ziekte','ziek zijn','geneeskunde'],['gezondheid','ziekenhuis','ziekte','geneeskunde']],
 economics:['geld en ondernemen',['geld','ondernemen','bedrijf starten','rijk worden','economie'],['economie','ondernemen','geld','ondernemer']],
 society:['maatschappij',['maatschappij','politiek','maatschappelijke problemen','samenleving'],['maatschappij','politiek','samenleving']],
};
// Specific interests are independent signals; catalogue evidence stays literal.
Object.assign(THEMES,{
  "drawing": [
    "tekenen en schilderen",
    [
      "tekenen",
      "teken",
      "schilderen",
      "schetsen",
      "schets",
      "illustreren"
    ],
    [
      "tekenen",
      "schilderen",
      "illustratie",
      "schetsboek"
    ]
  ],
  "photography": [
    "fotografie",
    [
      "fotografie",
      "fotograferen",
      "foto maken",
      "fotos maken",
      "foto s maken",
      "fotograaf"
    ],
    [
      "fotografie",
      "fotograaf",
      "fotograferen"
    ]
  ],
  "design": [
    "ontwerpen",
    [
      "ontwerpen",
      "grafisch ontwerp",
      "design",
      "mode ontwerpen"
    ],
    [
      "ontwerpen",
      "design",
      "grafisch ontwerp"
    ]
  ],
  "filmmaking": [
    "films maken",
    [
      "filmen",
      "films maken",
      "film maken",
      "videomontage",
      "video editten"
    ],
    [
      "filmmaker",
      "film maken",
      "videomontage"
    ]
  ],
  "musicMaking": [
    "muziek maken",
    [
      "muziek maken",
      "zingen",
      "gitaar spelen",
      "piano spelen",
      "drummen",
      "rappen",
      "beats maken"
    ],
    [
      "muziek maken",
      "zingen",
      "instrument spelen",
      "muzikant"
    ]
  ],
  "musicListening": [
    "muziek luisteren",
    [
      "muziek luisteren",
      "luister muziek",
      "liedjes luisteren",
      "spotify"
    ],
    [
      "muziek luisteren",
      "liedjes",
      "songtekst"
    ]
  ],
  "sportPlaying": [
    "zelf sporten",
    [
      "zelf sporten",
      "ik sport",
      "voetballen",
      "basketballen",
      "fitness",
      "hardlopen",
      "zwemmen",
      "hockeyen",
      "tennissen",
      "turnen",
      "boksen",
      "wielrennen"
    ],
    [
      "trainen",
      "sporten",
      "training"
    ]
  ],
  "sportWatching": [
    "sport kijken",
    [
      "sport kijken",
      "voetbal kijken",
      "kijk voetbal",
      "wedstrijden kijken",
      "voetbal volgen",
      "sport volgen"
    ],
    [
      "sport kijken",
      "supporter",
      "voetbalfan"
    ]
  ],
  "teamSport": [
    "teamsport",
    [
      "teamsport",
      "voetbalteam",
      "sportteam",
      "teamgenoot"
    ],
    [
      "teamsport",
      "voetbalteam",
      "sportteam",
      "teamgenoten"
    ]
  ],
  "individualSport": [
    "individuele sport",
    [
      "individuele sport",
      "alleen sporten",
      "hardlopen",
      "zwemmen",
      "turnen",
      "tennis",
      "wielrennen"
    ],
    [
      "individuele sport",
      "hardlopen",
      "zwemmen",
      "turnen",
      "tennis",
      "wielrennen"
    ]
  ],
  "pets": [
    "huisdieren",
    [
      "huisdieren",
      "huisdier",
      "hond",
      "honden",
      "kat",
      "katten",
      "hamster",
      "konijn"
    ],
    [
      "huisdier",
      "huisdieren",
      "hond",
      "honden",
      "kat",
      "katten",
      "hamster",
      "konijn"
    ]
  ],
  "wildlife": [
    "wilde dieren",
    [
      "wilde dieren",
      "roofdieren",
      "safari",
      "leeuwen",
      "wolven"
    ],
    [
      "wilde dieren",
      "roofdieren",
      "safari",
      "leeuwen",
      "wolven"
    ]
  ],
  "animalCare": [
    "dieren verzorgen",
    [
      "dieren verzorgen",
      "dierenverzorging",
      "dierenarts",
      "dierenasiel",
      "met dieren werken"
    ],
    [
      "dierenverzorging",
      "dierenarts",
      "dierenasiel",
      "dieren verzorgen"
    ]
  ],
  "space": [
    "ruimte en heelal",
    [
      "ruimtevaart",
      "heelal",
      "planeten",
      "astronomie",
      "sterrenstelsel",
      "astronaut"
    ],
    [
      "ruimtevaart",
      "heelal",
      "planeten",
      "astronomie",
      "astronaut"
    ]
  ],
  "computing": [
    "computers en programmeren",
    [
      "computers",
      "computer",
      "programmeren",
      "coderen",
      "ict",
      "software"
    ],
    [
      "computer",
      "computers",
      "programmeren",
      "software"
    ]
  ],
  "inventions": [
    "uitvindingen",
    [
      "uitvinden",
      "uitvinders",
      "uitvinding",
      "uitvindingen"
    ],
    [
      "uitvinder",
      "uitvinding",
      "uitvindingen"
    ]
  ],
  "humanBody": [
    "menselijk lichaam",
    [
      "menselijk lichaam",
      "anatomie",
      "organen",
      "lichaam"
    ],
    [
      "menselijk lichaam",
      "anatomie",
      "organen"
    ]
  ],
  "robotics": [
    "robots",
    [
      "robots",
      "robot",
      "robotica",
      "kunstmatige intelligentie"
    ],
    [
      "robots",
      "robotica",
      "kunstmatige intelligentie"
    ]
  ],
  "gameBuilding": [
    "bouwen in games",
    [
      "bouwen in games",
      "bouwen in minecraft",
      "minecraft bouwen",
      "creatieve modus",
      "creative mode"
    ],
    [
      "bouwen in games",
      "minecraft bouwen",
      "creative mode"
    ]
  ],
  "gameCompetition": [
    "competitief gamen",
    [
      "competitief gamen",
      "esports",
      "e sports",
      "ranked spelen",
      "gamecompetitie"
    ],
    [
      "esports",
      "e sports",
      "gamecompetitie"
    ]
  ],
  "gameStory": [
    "verhalen in games",
    [
      "gameverhalen",
      "verhalen in games",
      "story games",
      "gamepersonages"
    ],
    [
      "gameverhalen",
      "gamepersonages",
      "verhalen in games"
    ]
  ],
  "gameDevelopment": [
    "games maken",
    [
      "games maken",
      "game maken",
      "gameontwikkeling",
      "game development",
      "games programmeren"
    ],
    [
      "gameontwikkeling",
      "game development",
      "games maken"
    ]
  ],
  "gameMultiplayer": [
    "samen gamen",
    [
      "samen gamen",
      "online samen spelen",
      "multiplayer",
      "gamen met vrienden"
    ],
    [
      "multiplayer",
      "samen gamen"
    ]
  ],
  "courtCases": [
    "rechtszaken",
    [
      "rechtszaak",
      "rechtszaken",
      "rechtbank",
      "rechtszitting"
    ],
    [
      "rechtszaak",
      "rechtszaken",
      "rechtbank"
    ]
  ],
  "crimeVictims": [
    "slachtoffers van misdaad",
    [
      "misdaadslachtoffers",
      "slachtoffers van misdaad"
    ],
    [
      "misdaadslachtoffer",
      "slachtoffer van misdaad"
    ]
  ],
  "gangs": [
    "bendes",
    [
      "bendes",
      "bende",
      "maffia",
      "drugsbende"
    ],
    [
      "bende",
      "maffia",
      "drugsbende"
    ]
  ]
});
module.exports={THEMES};
