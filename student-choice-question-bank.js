'use strict';
// Thematic, distinct authored question intents. Open wording first; examples only on request.
module.exports=[
 {
  "id": "extended-crime-1",
  "group": "crime",
  "stage": 2,
  "when": [
   "crime"
  ],
  "prompt": "Wat wil je weten over het leven van iemand die in de criminaliteit terechtkomt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Waarom iemand begint",
    "prefer": [
     "psychology",
     "crime"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De gevolgen voor thuis",
    "prefer": [
     "family",
     "crime"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe iemand eruit komt",
    "prefer": [
     "growth",
     "crime"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-crime-2",
  "group": "crime",
  "stage": 2,
  "when": [
   "crime"
  ],
  "prompt": "Welke kanten van misdaad komen volgens jou te weinig aan bod?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De slachtoffers",
    "prefer": [
     "empathy",
     "crime"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De daders",
    "prefer": [
     "criminalPerspective"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De samenleving",
    "prefer": [
     "society",
     "crime"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-crime-3",
  "group": "crime",
  "stage": 2,
  "when": [
   "crime"
  ],
  "prompt": "Wat maakt een misdaadverhaal voor jou geloofwaardig?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Echte gebeurtenissen",
    "prefer": [
     "true"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een herkenbare omgeving",
    "prefer": [
     "realistic"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Menselijke motieven",
    "prefer": [
     "psychology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-crime-4",
  "group": "crime",
  "stage": 2,
  "when": [
   "crime"
  ],
  "prompt": "Waar ben je nieuwsgierig naar bij een rechtszaak?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Bewijzen en onderzoek",
    "prefer": [
     "puzzles",
     "police"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een eerlijk oordeel",
    "prefer": [
     "justice"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Waarom iemand schuldig is",
    "prefer": [
     "psychology",
     "crime"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-crime-5",
  "group": "crime",
  "stage": 2,
  "when": [
   "crime"
  ],
  "prompt": "Wat vind je interessant aan verhalen over bendes?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Loyaliteit",
    "prefer": [
     "friendship",
     "crime"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Macht en beïnvloeding",
    "prefer": [
     "manipulation",
     "crime"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Keuzes en gevolgen",
    "prefer": [
     "choices",
     "crime"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-crime-6",
  "group": "crime",
  "stage": 2,
  "when": [
   "crime"
  ],
  "prompt": "Hoe kijk je aan tegen verhalen waarin iemand iets strafbaars doet om een ander te helpen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Moeilijke keuzes",
    "prefer": [
     "choices"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Onrecht",
    "prefer": [
     "justice"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-crime-7",
  "group": "crime",
  "stage": 2,
  "when": [
   "crime"
  ],
  "prompt": "Over welke misdaadonderwerpen kijk je weleens een documentaire?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Vermissingen",
    "prefer": [
     "disappearance",
     "true"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Georganiseerde misdaad",
    "prefer": [
     "crime",
     "true"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Onderzoek",
    "prefer": [
     "police",
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-crime-8",
  "group": "crime",
  "stage": 2,
  "when": [
   "crime"
  ],
  "prompt": "Wat zou je willen weten over iemand die na een misdaad opnieuw begint?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Veranderen",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Schuld en gevoelens",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Terugkeer in de samenleving",
    "prefer": [
     "society"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-crime-9",
  "group": "crime",
  "stage": 2,
  "when": [
   "crime"
  ],
  "prompt": "Wat trekt je aandacht als je nieuws over misdaad ziet?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De achtergrond",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De gevolgen",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De feiten",
    "prefer": [
     "crime",
     "facts"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-mystery-1",
  "group": "mystery",
  "stage": 2,
  "when": [
   "mystery",
   "puzzles"
  ],
  "prompt": "Wat zou je graag willen uitzoeken als je een raadsel tegenkomt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Waar iemand gebleven is",
    "prefer": [
     "disappearance"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wat iemand verborgen houdt",
    "prefer": [
     "secrets"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe iets gebeurd is",
    "prefer": [
     "puzzles"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-mystery-2",
  "group": "mystery",
  "stage": 2,
  "when": [
   "mystery"
  ],
  "prompt": "Welke onderwerpen maken je nieuwsgierig buiten boeken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Onopgeloste gebeurtenissen",
    "prefer": [
     "mystery",
     "true"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Gedrag van mensen",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Geschiedenis",
    "prefer": [
     "history"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-mystery-3",
  "group": "mystery",
  "stage": 2,
  "when": [
   "mystery"
  ],
  "prompt": "Wat voor mysteries kom je weleens tegen in wat je kijkt of speelt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Detectives",
    "prefer": [
     "puzzles",
     "police"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Onverklaarbare dingen",
    "prefer": [
     "unusual"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Familiegeheimen",
    "prefer": [
     "secrets",
     "family"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-mystery-4",
  "group": "mystery",
  "stage": 2,
  "when": [
   "secrets"
  ],
  "prompt": "Wat wil je meestal weten wanneer iemand iets niet vertelt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Waarom diegene zwijgt",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wat er vroeger gebeurd is",
    "prefer": [
     "history",
     "secrets"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat er met anderen gebeurt",
    "prefer": [
     "relationships"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-mystery-5",
  "group": "mystery",
  "stage": 2,
  "when": [
   "mystery"
  ],
  "prompt": "Waarover zou je zelf weleens meer willen ontdekken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De geschiedenis van een plek",
    "prefer": [
     "history",
     "travel"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een vreemd verschijnsel",
    "prefer": [
     "unusual",
     "science"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een verborgen verhaal",
    "prefer": [
     "secrets"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-mystery-6",
  "group": "mystery",
  "stage": 2,
  "when": [
   "mystery"
  ],
  "prompt": "Wat spreekt je aan in onopgeloste zaken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Zelf nadenken",
    "prefer": [
     "puzzles"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Echte verhalen",
    "prefer": [
     "true"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De mensen die betrokken zijn",
    "prefer": [
     "people"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-mystery-7",
  "group": "mystery",
  "stage": 2,
  "when": [
   "disappearance"
  ],
  "prompt": "Wat vind je interessant aan verhalen over verdwenen personen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De zoektocht",
    "prefer": [
     "disappearance",
     "puzzles"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De achterblijvers",
    "prefer": [
     "family",
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat eraan voorafging",
    "prefer": [
     "psychology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-mystery-8",
  "group": "mystery",
  "stage": 2,
  "when": [
   "mystery"
  ],
  "prompt": "Lees je graag over dingen die niemand goed kan verklaren?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Bovennatuurlijke dingen",
    "prefer": [
     "unusual",
     "magic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wetenschappelijke verklaringen",
    "prefer": [
     "science"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Raadsels uit het verleden",
    "prefer": [
     "history",
     "mystery"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-mystery-9",
  "group": "mystery",
  "stage": 2,
  "when": [
   "mystery"
  ],
  "prompt": "Wat vind je van verhalen waarin iemands versie niet klopt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De waarheid ontdekken",
    "prefer": [
     "puzzles"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vertrouwen en bedrog",
    "prefer": [
     "secrets",
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De beweegredenen",
    "prefer": [
     "psychology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-psychology-1",
  "group": "psychology",
  "stage": 2,
  "when": [
   "psychology",
   "manipulation",
   "people"
  ],
  "prompt": "Over welk gedrag van mensen vraag je je soms af waarom het gebeurt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Liegen",
    "prefer": [
     "secrets",
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Groepsdruk",
    "prefer": [
     "team",
     "outsider"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Risico's nemen",
    "prefer": [
     "choices",
     "psychology"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-psychology-2",
  "group": "psychology",
  "stage": 2,
  "when": [
   "psychology",
   "manipulation",
   "people"
  ],
  "prompt": "Wat vind je interessant aan hoe mensen veranderen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Zelfvertrouwen",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Omgaan met tegenslagen",
    "prefer": [
     "empathy",
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een andere kijk op het leven",
    "prefer": [
     "choices"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-psychology-3",
  "group": "psychology",
  "stage": 2,
  "when": [
   "psychology",
   "manipulation",
   "people"
  ],
  "prompt": "Welke onderwerpen uit de psychologie spreken je aan?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Gedachten en gevoelens",
    "prefer": [
     "psychology",
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Omgaan met anderen",
    "prefer": [
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Beïnvloeding",
    "prefer": [
     "manipulation"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-psychology-4",
  "group": "psychology",
  "stage": 2,
  "when": [
   "psychology",
   "manipulation",
   "people"
  ],
  "prompt": "Wat zou je willen begrijpen aan iemand die heel anders denkt dan jij?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe iemand is opgegroeid",
    "prefer": [
     "family"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wat iemand belangrijk vindt",
    "prefer": [
     "choices"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe iemand de wereld ervaart",
    "prefer": [
     "people",
     "psychology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-psychology-5",
  "group": "psychology",
  "stage": 2,
  "when": [
   "psychology",
   "manipulation",
   "people"
  ],
  "prompt": "Wat maakt verhalen over vertrouwen voor jou interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Bedrog",
    "prefer": [
     "secrets",
     "manipulation"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Liefde",
    "prefer": [
     "relationships"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-psychology-6",
  "group": "psychology",
  "stage": 2,
  "when": [
   "psychology",
   "manipulation",
   "people"
  ],
  "prompt": "Welke keuzes van mensen blijven jou soms bezighouden?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Keuzes onder druk",
    "prefer": [
     "choices",
     "danger"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Keuzes voor zichzelf",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Keuzes voor anderen",
    "prefer": [
     "relationships"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-psychology-7",
  "group": "psychology",
  "stage": 2,
  "when": [
   "psychology",
   "manipulation",
   "people"
  ],
  "prompt": "Wat zou je willen weten over iemand die door anderen wordt beïnvloed?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Waarom het gebeurt",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe diegene voor zichzelf opkomt",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De gevolgen",
    "prefer": [
     "empathy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-psychology-8",
  "group": "psychology",
  "stage": 2,
  "when": [
   "psychology",
   "manipulation",
   "people"
  ],
  "prompt": "Welke onderwerpen over het brein vind je interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Geheugen",
    "prefer": [
     "science",
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Emoties",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Gedrag",
    "prefer": [
     "psychology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-psychology-9",
  "group": "psychology",
  "stage": 2,
  "when": [
   "psychology",
   "manipulation",
   "people"
  ],
  "prompt": "Lees je graag over mensen die proberen zichzelf beter te begrijpen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Identiteit",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Relaties",
    "prefer": [
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Mentale gezondheid",
    "prefer": [
     "empathy",
     "health"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-family-1",
  "group": "family",
  "stage": 2,
  "when": [
   "family",
   "secrets",
   "relationships"
  ],
  "prompt": "Waarover vind je verhalen over gezinnen interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Relaties thuis",
    "prefer": [
     "family"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Veranderingen in een gezin",
    "prefer": [
     "growth",
     "family"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een gedeeld verleden",
    "prefer": [
     "history",
     "secrets"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-family-2",
  "group": "family",
  "stage": 2,
  "when": [
   "family",
   "secrets",
   "relationships"
  ],
  "prompt": "Wat spreekt je aan in verhalen over broers en zussen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Samen iets meemaken",
    "prefer": [
     "adventure",
     "family"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Ruzies en weer goedmaken",
    "prefer": [
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Voor elkaar opkomen",
    "prefer": [
     "friendship",
     "family"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-family-3",
  "group": "family",
  "stage": 2,
  "when": [
   "family",
   "secrets",
   "relationships"
  ],
  "prompt": "Welke veranderingen thuis zouden je nieuwsgierig maken in een verhaal?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Verhuizen",
    "prefer": [
     "travel",
     "family"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een nieuw gezin",
    "prefer": [
     "family",
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Iets uit het verleden",
    "prefer": [
     "history",
     "secrets"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-family-4",
  "group": "family",
  "stage": 2,
  "when": [
   "family",
   "secrets",
   "relationships"
  ],
  "prompt": "Wat vind je boeiend aan verschillende generaties in een familie?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe mensen vroeger leefden",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De band tussen generaties",
    "prefer": [
     "family"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Waargebeurde herinneringen",
    "prefer": [
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-family-5",
  "group": "family",
  "stage": 2,
  "when": [
   "family",
   "secrets",
   "relationships"
  ],
  "prompt": "Wat wil je weten wanneer een familie iets moeilijks meemaakt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe ze elkaar helpen",
    "prefer": [
     "family",
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe iemand zijn eigen keuzes maakt",
    "prefer": [
     "choices",
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat er verandert",
    "prefer": [
     "relationships"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-family-6",
  "group": "family",
  "stage": 2,
  "when": [
   "family",
   "secrets",
   "relationships"
  ],
  "prompt": "Welke verhalen over ouders vind je interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Verwachtingen en zelfstandigheid",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vertrouwen",
    "prefer": [
     "relationships",
     "secrets"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De ervaringen van ouders",
    "prefer": [
     "people",
     "history"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-family-7",
  "group": "family",
  "stage": 2,
  "when": [
   "family",
   "secrets",
   "relationships"
  ],
  "prompt": "Wat spreekt je aan in verhalen over een bijzondere thuissituatie?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een herkenbare situatie",
    "prefer": [
     "realistic",
     "family"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Andere manieren van leven",
    "prefer": [
     "society",
     "family"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een nieuwe start",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-family-8",
  "group": "family",
  "stage": 2,
  "when": [
   "family",
   "secrets",
   "relationships"
  ],
  "prompt": "Wat vind je interessant aan een verhaal over iemand die zijn afkomst ontdekt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Familiegeschiedenis",
    "prefer": [
     "family",
     "history"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Identiteit",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Verborgen informatie",
    "prefer": [
     "secrets"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-family-9",
  "group": "family",
  "stage": 2,
  "when": [
   "family",
   "secrets",
   "relationships"
  ],
  "prompt": "Welke familieonderwerpen lees je liever vanuit het perspectief van een jongere?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Opgroeien",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "School en thuis",
    "prefer": [
     "school",
     "family"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Omgaan met veranderingen",
    "prefer": [
     "empathy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-friendship-1",
  "group": "friendship",
  "stage": 2,
  "when": [
   "friendship",
   "relationships",
   "school",
   "team",
   "outsider"
  ],
  "prompt": "Wat vind je mooi aan verhalen over vrienden?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Samen plezier maken",
    "prefer": [
     "humor",
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Elkaar helpen",
    "prefer": [
     "friendship",
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Samen iets bereiken",
    "prefer": [
     "team",
     "challenge"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-friendship-2",
  "group": "friendship",
  "stage": 2,
  "when": [
   "friendship",
   "relationships",
   "school",
   "team",
   "outsider"
  ],
  "prompt": "Wat wil je lezen over mensen die elkaar nog niet goed kennen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Nieuwe vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Verliefd worden",
    "prefer": [
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Elkaar leren begrijpen",
    "prefer": [
     "psychology",
     "people"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-friendship-3",
  "group": "friendship",
  "stage": 2,
  "when": [
   "friendship",
   "relationships",
   "school",
   "team",
   "outsider"
  ],
  "prompt": "Wat maakt een ruzie tussen vrienden interessant om over te lezen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Wat eraan voorafging",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe ze het oplossen",
    "prefer": [
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Of ze elkaar blijven vertrouwen",
    "prefer": [
     "secrets"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-friendship-4",
  "group": "friendship",
  "stage": 2,
  "when": [
   "friendship",
   "relationships",
   "school",
   "team",
   "outsider"
  ],
  "prompt": "Welke onderwerpen over groepen mensen spreken je aan?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Erbij horen",
    "prefer": [
     "outsider"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Samenwerken",
    "prefer": [
     "team"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Groepsdruk",
    "prefer": [
     "choices",
     "psychology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-friendship-5",
  "group": "friendship",
  "stage": 2,
  "when": [
   "friendship",
   "relationships",
   "school",
   "team",
   "outsider"
  ],
  "prompt": "Wat vind je interessant aan iemand die een nieuwe school binnenkomt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Nieuwe vrienden",
    "prefer": [
     "friendship",
     "school"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Omgaan met onzekerheid",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een andere omgeving",
    "prefer": [
     "realistic"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-friendship-6",
  "group": "friendship",
  "stage": 2,
  "when": [
   "friendship",
   "relationships",
   "school",
   "team",
   "outsider"
  ],
  "prompt": "Welke verhalen over verliefdheid vind je leuk?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een eerste liefde",
    "prefer": [
     "relationships",
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vriendschap die verandert",
    "prefer": [
     "friendship",
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Grappige situaties",
    "prefer": [
     "humor"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-friendship-7",
  "group": "friendship",
  "stage": 2,
  "when": [
   "friendship",
   "relationships",
   "school",
   "team",
   "outsider"
  ],
  "prompt": "Lees je graag over jongeren die heel verschillend zijn?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Elkaar begrijpen",
    "prefer": [
     "people",
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vooroordelen",
    "prefer": [
     "justice"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Samen iets doen",
    "prefer": [
     "team",
     "adventure"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-friendship-8",
  "group": "friendship",
  "stage": 2,
  "when": [
   "friendship",
   "relationships",
   "school",
   "team",
   "outsider"
  ],
  "prompt": "Wat maakt een verhaal over een groep vrienden geloofwaardig voor jou?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Herkenbare problemen",
    "prefer": [
     "realistic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Humor",
    "prefer": [
     "humor"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Vertrouwen",
    "prefer": [
     "relationships"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-friendship-9",
  "group": "friendship",
  "stage": 2,
  "when": [
   "friendship",
   "relationships",
   "school",
   "team",
   "outsider"
  ],
  "prompt": "Wat zou je willen lezen over iemand die zich alleen voelt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Voor zichzelf opkomen",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Geaccepteerd worden",
    "prefer": [
     "outsider"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-sport-1",
  "group": "sport",
  "stage": 2,
  "when": [
   "sport"
  ],
  "prompt": "Welke sporten vind je zelf interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Voetbal",
    "prefer": [
     "sport"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Teamsporten",
    "prefer": [
     "sport",
     "team"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Individuele prestaties",
    "prefer": [
     "sport",
     "challenge"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-sport-2",
  "group": "sport",
  "stage": 2,
  "when": [
   "sport"
  ],
  "prompt": "Wat spreekt je aan in het leven van een topsporter?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Training en doorzetten",
    "prefer": [
     "growth",
     "sport"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wedstrijden",
    "prefer": [
     "competition"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het leven naast de sport",
    "prefer": [
     "people"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-sport-3",
  "group": "sport",
  "stage": 2,
  "when": [
   "sport"
  ],
  "prompt": "Wat vind je interessant aan een sportteam?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Samenwerken",
    "prefer": [
     "team"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Omgaan met verliezen",
    "prefer": [
     "competition",
     "empathy"
    ],
    "length": ""
   }
  ],
  "requires": [
   "team"
  ]
 },
 {
  "id": "extended-sport-4",
  "group": "sport",
  "stage": 2,
  "when": [
   "sport"
  ],
  "prompt": "Waar wil je meer over weten als je sport kijkt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De regels",
    "prefer": [
     "sport",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De tactiek",
    "prefer": [
     "puzzles",
     "sport"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De sporters",
    "prefer": [
     "people",
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-sport-5",
  "group": "sport",
  "stage": 2,
  "when": [
   "sport"
  ],
  "prompt": "Wat trekt je aan in verhalen over iemand met een groot sportdoel?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Beter worden",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een wedstrijd winnen",
    "prefer": [
     "competition"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Tegenslagen overwinnen",
    "prefer": [
     "challenge"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-sport-6",
  "group": "sport",
  "stage": 2,
  "when": [
   "sport"
  ],
  "prompt": "Welke sportverhalen lees je liefst over echte mensen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Bekende spelers",
    "prefer": [
     "sport",
     "true"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een team dat iets bereikt",
    "prefer": [
     "team",
     "true"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Iemand die opnieuw begint",
    "prefer": [
     "growth",
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-sport-7",
  "group": "sport",
  "stage": 2,
  "when": [
   "sport"
  ],
  "prompt": "Wat zou je willen leren over hoe sporters presteren?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Training",
    "prefer": [
     "health",
     "sport"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Motivatie",
    "prefer": [
     "psychology",
     "sport"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Samenwerking",
    "prefer": [
     "team",
     "sport"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-sport-8",
  "group": "sport",
  "stage": 2,
  "when": [
   "sport"
  ],
  "prompt": "Welke kanten van sport vind je buiten de wedstrijd interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Het leven van spelers",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De club en supporters",
    "prefer": [
     "team",
     "society"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Gezondheid",
    "prefer": [
     "health"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-sport-9",
  "group": "sport",
  "stage": 2,
  "when": [
   "sport"
  ],
  "prompt": "Wat vind je interessant aan een sporter die geblesseerd raakt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Herstel",
    "prefer": [
     "health",
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Omgaan met teleurstelling",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Terugkomen in het team",
    "prefer": [
     "team"
    ],
    "length": ""
   }
  ],
  "requires": [
   "sport",
   "health"
  ]
 },
 {
  "id": "extended-gaming-1",
  "group": "gaming",
  "stage": 2,
  "when": [
   "gaming"
  ],
  "prompt": "Wat speel je het liefst als je zelf kiest?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Spellen met een verhaal",
    "prefer": [
     "adventure"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Sportgames",
    "prefer": [
     "sport",
     "competition"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Spellen waarin je bouwt",
    "prefer": [
     "technology",
     "art"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-gaming-2",
  "group": "gaming",
  "stage": 2,
  "when": [
   "gaming"
  ],
  "prompt": "Wat maakt een game voor jou de moeite waard?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een wereld ontdekken",
    "prefer": [
     "discovery",
     "adventure"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Samen spelen",
    "prefer": [
     "team"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Zelf iets bedenken",
    "prefer": [
     "puzzles"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-gaming-3",
  "group": "gaming",
  "stage": 2,
  "when": [
   "gaming"
  ],
  "prompt": "Over welke onderwerpen uit games zou je ook willen lezen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Toekomstige techniek",
    "prefer": [
     "future",
     "technology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Misdaad",
    "prefer": [
     "crime"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Overleven",
    "prefer": [
     "survival"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-gaming-4",
  "group": "gaming",
  "stage": 2,
  "when": [
   "gaming"
  ],
  "prompt": "Wat vind je leuk aan online spelen met anderen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Samen een doel halen",
    "prefer": [
     "team",
     "challenge"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Nieuwe vrienden",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wedstrijden",
    "prefer": [
     "competition"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-gaming-5",
  "group": "gaming",
  "stage": 2,
  "when": [
   "gaming"
  ],
  "prompt": "Welke dingen ontwerp of bouw je graag in een game?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Gebouwen",
    "prefer": [
     "art",
     "technology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Machines",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een eigen wereld",
    "prefer": [
     "fantasy",
     "art"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-gaming-6",
  "group": "gaming",
  "stage": 2,
  "when": [
   "gaming"
  ],
  "prompt": "Wat maakt de verhalen achter gamepersonages interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hun keuzes",
    "prefer": [
     "choices"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hun ontwikkeling",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De mensen om hen heen",
    "prefer": [
     "relationships"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-gaming-7",
  "group": "gaming",
  "stage": 2,
  "when": [
   "gaming"
  ],
  "prompt": "Wat zou je willen weten over hoe games gemaakt worden?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Programmeren",
    "prefer": [
     "technology",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Ontwerp",
    "prefer": [
     "art"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Verhalen maken",
    "prefer": [
     "adventure",
     "people"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-gaming-8",
  "group": "gaming",
  "stage": 2,
  "when": [
   "gaming"
  ],
  "prompt": "Wat voor uitdaging zoek je meestal in een game?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een raadsel oplossen",
    "prefer": [
     "puzzles"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een doel bereiken",
    "prefer": [
     "challenge"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een avontuur overleven",
    "prefer": [
     "survival"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-gaming-9",
  "group": "gaming",
  "stage": 2,
  "when": [
   "gaming"
  ],
  "prompt": "Welke gamesfeer spreekt je aan wanneer je eens geen actie wilt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Rustig ontdekken",
    "prefer": [
     "calm",
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Iets grappigs",
    "prefer": [
     "humor"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een wereld maken",
    "prefer": [
     "art",
     "fantasy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-fantasy-1",
  "group": "fantasy",
  "stage": 2,
  "when": [
   "fantasy"
  ],
  "prompt": "Welke dingen uit verzonnen werelden spreken je aan?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Magie",
    "prefer": [
     "magic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Onbekende plaatsen",
    "prefer": [
     "adventure"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Bijzondere wezens",
    "prefer": [
     "fantasy",
     "animals"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-fantasy-2",
  "group": "fantasy",
  "stage": 2,
  "when": [
   "fantasy"
  ],
  "prompt": "Waar ben je nieuwsgierig naar bij oude legendes?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Mythes",
    "prefer": [
     "history",
     "fantasy"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Oorsprong van verhalen",
    "prefer": [
     "history",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Heldendaden",
    "prefer": [
     "adventure",
     "challenge"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-fantasy-3",
  "group": "fantasy",
  "stage": 2,
  "when": [
   "magic"
  ],
  "prompt": "Wat trekt je aan in verhalen over mensen met bijzondere mogelijkheden?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe ze ermee omgaan",
    "prefer": [
     "choices",
     "magic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe ze leren",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat ze ontdekken",
    "prefer": [
     "discovery"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-fantasy-4",
  "group": "fantasy",
  "stage": 2,
  "when": [
   "fantasy"
  ],
  "prompt": "Wat vind je interessant aan een wereld met andere regels?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe die wereld werkt",
    "prefer": [
     "setting",
     "fantasy"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe mensen samenleven",
    "prefer": [
     "society"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De gevaren",
    "prefer": [
     "danger"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-fantasy-5",
  "group": "fantasy",
  "stage": 2,
  "when": [
   "fantasy"
  ],
  "prompt": "Welke verhalen over bijzondere wezens vind je leuk?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Draken",
    "prefer": [
     "fantasy",
     "animals"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Mythische dieren",
    "prefer": [
     "magic",
     "animals"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Vreemde verschijnselen",
    "prefer": [
     "unusual"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-fantasy-6",
  "group": "fantasy",
  "stage": 2,
  "when": [
   "fantasy"
  ],
  "prompt": "Wat zou je willen ontdekken als je een onbekende wereld bezoekt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De bewoners",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De natuur",
    "prefer": [
     "nature"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De geschiedenis",
    "prefer": [
     "history"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-fantasy-7",
  "group": "fantasy",
  "stage": 2,
  "when": [
   "fantasy"
  ],
  "prompt": "Wat maakt een verzonnen wereld voor jou leuk om te volgen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een avontuur",
    "prefer": [
     "adventure"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Mysteries",
    "prefer": [
     "mystery"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-fantasy-8",
  "group": "fantasy",
  "stage": 2,
  "when": [
   "magic"
  ],
  "prompt": "Welke kanten van magie vind je interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Leren omgaan met krachten",
    "prefer": [
     "magic",
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Het onbekende",
    "prefer": [
     "unusual"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Keuzes en gevolgen",
    "prefer": [
     "choices"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-fantasy-9",
  "group": "fantasy",
  "stage": 2,
  "when": [
   "fantasy"
  ],
  "prompt": "Wat spreekt je aan in verhalen waarin iemand niet bij de gewone wereld hoort?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Identiteit",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Erbij horen",
    "prefer": [
     "outsider"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een andere wereld",
    "prefer": [
     "fantasy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-animals-1",
  "group": "animals",
  "stage": 2,
  "when": [
   "animals"
  ],
  "prompt": "Welke dieren vind je zelf interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Huisdieren",
    "prefer": [
     "animals"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wilde dieren",
    "prefer": [
     "animals",
     "nature"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Bijzondere soorten",
    "prefer": [
     "animals",
     "science"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-animals-2",
  "group": "animals",
  "stage": 2,
  "when": [
   "animals"
  ],
  "prompt": "Wat vind je leuk aan de band tussen mensen en dieren?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Zorgen voor een dier",
    "prefer": [
     "animals",
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Samen iets meemaken",
    "prefer": [
     "adventure",
     "animals"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Vertrouwen",
    "prefer": [
     "relationships"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-animals-3",
  "group": "animals",
  "stage": 2,
  "when": [
   "animals"
  ],
  "prompt": "Waar zou je meer over willen leren als het over dieren gaat?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Gedrag",
    "prefer": [
     "animals",
     "science"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Verzorging",
    "prefer": [
     "animals",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Leefomgeving",
    "prefer": [
     "nature",
     "animals"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-animals-4",
  "group": "animals",
  "stage": 2,
  "when": [
   "nature"
  ],
  "prompt": "Wat spreekt je aan in verhalen die zich in de natuur afspelen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Ontdekken",
    "prefer": [
     "discovery",
     "nature"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Overleven",
    "prefer": [
     "survival"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Rust en buiten zijn",
    "prefer": [
     "calm",
     "nature"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-animals-5",
  "group": "animals",
  "stage": 2,
  "when": [
   "animals"
  ],
  "prompt": "Welke onderwerpen over wilde dieren maken je nieuwsgierig?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Bescherming",
    "prefer": [
     "environment",
     "animals"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Leven in groepen",
    "prefer": [
     "animals",
     "team"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe dieren overleven",
    "prefer": [
     "survival",
     "animals"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-animals-6",
  "group": "animals",
  "stage": 2,
  "when": [
   "animals"
  ],
  "prompt": "Wat zou je lezen over iemand die met dieren werkt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een dierenverzorger",
    "prefer": [
     "animals",
     "true"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een onderzoeker",
    "prefer": [
     "science",
     "animals"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een avonturier",
    "prefer": [
     "nature",
     "adventure"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-animals-7",
  "group": "animals",
  "stage": 2,
  "when": [
   "nature"
  ],
  "prompt": "Wat vind je interessant aan de zee of het bos?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De dieren",
    "prefer": [
     "animals"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Het landschap",
    "prefer": [
     "nature",
     "setting"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Onbekende plekken",
    "prefer": [
     "discovery"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-animals-8",
  "group": "animals",
  "stage": 2,
  "when": [
   "nature"
  ],
  "prompt": "Wat spreekt je aan in verhalen over mensen die buiten leven?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Zelfredzaamheid",
    "prefer": [
     "survival"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Dieren en planten",
    "prefer": [
     "nature",
     "animals"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Echte ervaringen",
    "prefer": [
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-animals-9",
  "group": "animals",
  "stage": 2,
  "when": [
   "nature"
  ],
  "prompt": "Waar ben je nieuwsgierig naar als je een natuurdocumentaire kijkt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe dieren leven",
    "prefer": [
     "animals",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Klimaat",
    "prefer": [
     "environment"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Bijzondere landschappen",
    "prefer": [
     "travel",
     "nature"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-history-1",
  "group": "history",
  "stage": 2,
  "when": [
   "history"
  ],
  "prompt": "Welke gebeurtenissen uit het verleden interesseren je?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Oorlog",
    "prefer": [
     "war"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Uitvindingen",
    "prefer": [
     "science",
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het dagelijks leven",
    "prefer": [
     "people",
     "history"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-history-2",
  "group": "history",
  "stage": 2,
  "when": [
   "history"
  ],
  "prompt": "Wat zou je willen weten over jongeren die vroeger leefden?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "School",
    "prefer": [
     "school",
     "history"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Familie",
    "prefer": [
     "family",
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe ze keuzes maakten",
    "prefer": [
     "choices",
     "history"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-history-3",
  "group": "history",
  "stage": 2,
  "when": [
   "war"
  ],
  "prompt": "Welke kanten van oorlogsgeschiedenis vind je interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Verzet",
    "prefer": [
     "war",
     "justice"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Overleven",
    "prefer": [
     "survival",
     "war"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het leven van gewone mensen",
    "prefer": [
     "people",
     "war"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-history-4",
  "group": "history",
  "stage": 2,
  "when": [
   "history"
  ],
  "prompt": "Wat trekt je aan in oude verhalen uit andere landen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Cultuur",
    "prefer": [
     "travel",
     "society"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Mythes",
    "prefer": [
     "fantasy",
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Echte gebeurtenissen",
    "prefer": [
     "true",
     "history"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-history-5",
  "group": "history",
  "stage": 2,
  "when": [
   "history"
  ],
  "prompt": "Waar zou je meer over willen leren in een museum?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Geschiedenis van mensen",
    "prefer": [
     "people",
     "history"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Kunst",
    "prefer": [
     "art",
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Techniek",
    "prefer": [
     "technology",
     "history"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-history-6",
  "group": "history",
  "stage": 2,
  "when": [
   "history"
  ],
  "prompt": "Wat vind je interessant aan verhalen uit de tijd van je grootouders?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Het dagelijks leven",
    "prefer": [
     "history",
     "realistic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Herinneringen",
    "prefer": [
     "family",
     "true"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Veranderingen in de maatschappij",
    "prefer": [
     "society"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-history-7",
  "group": "history",
  "stage": 2,
  "when": [
   "history"
  ],
  "prompt": "Welke uitvindingen uit het verleden zou je willen begrijpen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Vervoer",
    "prefer": [
     "technology",
     "travel"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wetenschap",
    "prefer": [
     "science"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Communicatie",
    "prefer": [
     "technology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-history-8",
  "group": "history",
  "stage": 2,
  "when": [
   "history"
  ],
  "prompt": "Wat zou je graag ontdekken over het ontstaan van een stad of land?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe mensen leefden",
    "prefer": [
     "people",
     "history"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Macht en politiek",
    "prefer": [
     "society"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Reizen en handel",
    "prefer": [
     "travel",
     "economics"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-history-9",
  "group": "history",
  "stage": 2,
  "when": [
   "history"
  ],
  "prompt": "Wat vind je interessant aan waargebeurde verhalen over vroeger?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Iemands leven",
    "prefer": [
     "true",
     "people"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Bijzondere gebeurtenissen",
    "prefer": [
     "true",
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Moeilijke keuzes",
    "prefer": [
     "choices"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-science-1",
  "group": "science",
  "stage": 2,
  "when": [
   "science"
  ],
  "prompt": "Waar ben je nieuwsgierig naar als je aan wetenschap denkt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De ruimte",
    "prefer": [
     "science"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Dieren en natuur",
    "prefer": [
     "animals",
     "nature"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het menselijk lichaam",
    "prefer": [
     "health"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-science-2",
  "group": "science",
  "stage": 2,
  "when": [
   "technology"
  ],
  "prompt": "Welke technische ontwikkelingen volg je graag?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Computers en robots",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Ruimtevaart",
    "prefer": [
     "science"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Nieuwe vervoersmiddelen",
    "prefer": [
     "technology",
     "travel"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-science-3",
  "group": "science",
  "stage": 2,
  "when": [
   "future"
  ],
  "prompt": "Wat zou je willen weten over het leven in de toekomst?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe mensen samenleven",
    "prefer": [
     "society",
     "future"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Techniek",
    "prefer": [
     "technology",
     "future"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het milieu",
    "prefer": [
     "environment",
     "future"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-science-4",
  "group": "science",
  "stage": 2,
  "when": [
   "science"
  ],
  "prompt": "Wat vind je interessant aan uitvinders?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Nieuwe ideeën",
    "prefer": [
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe iets gemaakt wordt",
    "prefer": [
     "technology",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe iemand doorzet",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-science-5",
  "group": "science",
  "stage": 2,
  "when": [
   "science"
  ],
  "prompt": "Welke vragen over het heelal vind je interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Planeten",
    "prefer": [
     "science"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Ruimtereizen",
    "prefer": [
     "science",
     "adventure"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Mogelijk leven elders",
    "prefer": [
     "future",
     "science"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-science-6",
  "group": "science",
  "stage": 2,
  "when": [
   "science"
  ],
  "prompt": "Wat zou je graag begrijpen aan het menselijk lichaam?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Gezondheid",
    "prefer": [
     "health"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Het brein",
    "prefer": [
     "psychology",
     "science"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe mensen leren",
    "prefer": [
     "science",
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-science-7",
  "group": "science",
  "stage": 2,
  "when": [
   "technology"
  ],
  "prompt": "Welke dingen repareer of bouw je graag?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Machines",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Digitale dingen",
    "prefer": [
     "technology",
     "gaming"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Creatieve dingen",
    "prefer": [
     "art"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-science-8",
  "group": "science",
  "stage": 2,
  "when": [
   "technology"
  ],
  "prompt": "Wat trekt je aan in verhalen waarin techniek een grote rol speelt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Wat er mogelijk wordt",
    "prefer": [
     "future"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe mensen ermee omgaan",
    "prefer": [
     "psychology",
     "society"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Avonturen",
    "prefer": [
     "adventure"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-science-9",
  "group": "science",
  "stage": 2,
  "when": [
   "technology"
  ],
  "prompt": "Wat vind je interessant aan robots of kunstmatige intelligentie?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe ze werken",
    "prefer": [
     "technology",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wat er kan veranderen",
    "prefer": [
     "future",
     "society"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het verschil met mensen",
    "prefer": [
     "psychology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-adventure-1",
  "group": "adventure",
  "stage": 2,
  "when": [
   "adventure",
   "survival",
   "travel",
   "danger",
   "action"
  ],
  "prompt": "Wat vind je interessant aan het ontdekken van een onbekende plek?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De natuur",
    "prefer": [
     "nature"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De geschiedenis",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De mensen",
    "prefer": [
     "people",
     "travel"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-adventure-2",
  "group": "adventure",
  "stage": 2,
  "when": [
   "adventure",
   "survival",
   "travel",
   "danger",
   "action"
  ],
  "prompt": "Welke avonturen zou je graag volgen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een reis",
    "prefer": [
     "travel"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Overleven",
    "prefer": [
     "survival"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Samen iets bereiken",
    "prefer": [
     "team"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-adventure-3",
  "group": "adventure",
  "stage": 2,
  "when": [
   "adventure",
   "survival",
   "travel",
   "danger",
   "action"
  ],
  "prompt": "Wat trekt je aan in verhalen over mensen die iets nieuws proberen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een uitdaging",
    "prefer": [
     "challenge"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Nieuwe ervaringen",
    "prefer": [
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Veranderen",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-adventure-4",
  "group": "adventure",
  "stage": 2,
  "when": [
   "adventure",
   "survival",
   "travel",
   "danger",
   "action"
  ],
  "prompt": "Waar ben je nieuwsgierig naar bij echte expedities?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe mensen overleven",
    "prefer": [
     "survival",
     "true"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wat ze ontdekken",
    "prefer": [
     "discovery",
     "science"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De plekken",
    "prefer": [
     "travel",
     "nature"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-adventure-5",
  "group": "adventure",
  "stage": 2,
  "when": [
   "adventure",
   "survival",
   "travel",
   "danger",
   "action"
  ],
  "prompt": "Wat vind je interessant aan mensen die in gevaar komen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe ze beslissen",
    "prefer": [
     "choices",
     "danger"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe ze elkaar helpen",
    "prefer": [
     "team"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe ze overleven",
    "prefer": [
     "survival"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-adventure-6",
  "group": "adventure",
  "stage": 2,
  "when": [
   "adventure",
   "survival",
   "travel",
   "danger",
   "action"
  ],
  "prompt": "Welke plaatsen spreken je aan als omgeving voor een avontuur?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De wildernis",
    "prefer": [
     "nature"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een andere stad",
    "prefer": [
     "travel",
     "setting"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een verzonnen wereld",
    "prefer": [
     "fantasy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-adventure-7",
  "group": "adventure",
  "stage": 2,
  "when": [
   "adventure",
   "survival",
   "travel",
   "danger",
   "action"
  ],
  "prompt": "Wat zou je lezen over iemand die een lange reis maakt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Het leren kennen van mensen",
    "prefer": [
     "people",
     "travel"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De belevenissen",
    "prefer": [
     "adventure"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het persoonlijke doel",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-adventure-8",
  "group": "adventure",
  "stage": 2,
  "when": [
   "adventure",
   "survival",
   "travel",
   "danger",
   "action"
  ],
  "prompt": "Welke uitdagingen in de natuur vind je interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Verdwalen",
    "prefer": [
     "survival"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een reis maken",
    "prefer": [
     "travel"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Dieren tegenkomen",
    "prefer": [
     "animals",
     "nature"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-adventure-9",
  "group": "adventure",
  "stage": 2,
  "when": [
   "adventure",
   "survival",
   "travel",
   "danger",
   "action"
  ],
  "prompt": "Wat vind je interessant aan verhalen over een reddingsactie?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Samenwerken",
    "prefer": [
     "team",
     "danger"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Moeilijke keuzes",
    "prefer": [
     "choices"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Waargebeurde gebeurtenissen",
    "prefer": [
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-humor-1",
  "group": "humor",
  "stage": 2,
  "when": [
   "humor"
  ],
  "prompt": "Waar moet je zelf meestal om lachen als je iets kijkt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Grappige mensen",
    "prefer": [
     "humor",
     "people"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Onhandige situaties",
    "prefer": [
     "humor",
     "realistic"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Absurditeit",
    "prefer": [
     "humor",
     "unusual"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-humor-2",
  "group": "humor",
  "stage": 2,
  "when": [
   "humor"
  ],
  "prompt": "Welke grappige verhalen over school spreken je aan?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Vrienden",
    "prefer": [
     "school",
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Misverstanden",
    "prefer": [
     "humor",
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Alledaagse dingen",
    "prefer": [
     "realistic",
     "humor"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-humor-3",
  "group": "humor",
  "stage": 2,
  "when": [
   "humor"
  ],
  "prompt": "Wat vind je leuk aan grappige personages?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe ze reageren",
    "prefer": [
     "people",
     "humor"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hun vriendschappen",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hun fouten",
    "prefer": [
     "growth",
     "humor"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-humor-4",
  "group": "humor",
  "stage": 2,
  "when": [
   "humor"
  ],
  "prompt": "Wat voor comedy kijk je graag?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Herkenbare situaties",
    "prefer": [
     "realistic",
     "humor"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vreemde gebeurtenissen",
    "prefer": [
     "unusual",
     "humor"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Droge humor",
    "prefer": [
     "humor"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-humor-5",
  "group": "humor",
  "stage": 2,
  "when": [
   "humor"
  ],
  "prompt": "Wat spreekt je aan in verhalen waarin alles anders loopt dan gepland?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De grappige gevolgen",
    "prefer": [
     "humor"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De uitdaging",
    "prefer": [
     "challenge"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat mensen samen meemaken",
    "prefer": [
     "team"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-humor-6",
  "group": "humor",
  "stage": 2,
  "when": [
   "humor"
  ],
  "prompt": "Hoe belangrijk vind je het dat een grappig verhaal ergens over gaat?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Liefde en vrienden",
    "prefer": [
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Het leven op school",
    "prefer": [
     "school"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een avontuur",
    "prefer": [
     "adventure"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-humor-7",
  "group": "humor",
  "stage": 2,
  "when": [
   "humor"
  ],
  "prompt": "Wat vind je leuk aan grappige verhalen in stripvorm?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Tekeningen",
    "prefer": [
     "art"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Korte gebeurtenissen",
    "prefer": [
     "fast"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Herkenbare humor",
    "prefer": [
     "realistic",
     "humor"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-humor-8",
  "group": "humor",
  "stage": 2,
  "when": [
   "humor"
  ],
  "prompt": "Lees je graag iets luchtigs over mensen die je zou kunnen kennen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Vrienden",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Familie",
    "prefer": [
     "family"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "School",
    "prefer": [
     "school"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-humor-9",
  "group": "humor",
  "stage": 2,
  "when": [
   "humor"
  ],
  "prompt": "Welke combinatie met humor spreekt je aan?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Mysterie",
    "prefer": [
     "mystery",
     "humor"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Avontuur",
    "prefer": [
     "adventure",
     "humor"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Romantiek",
    "prefer": [
     "relationships",
     "humor"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-justice-1",
  "group": "justice",
  "stage": 2,
  "when": [
   "justice",
   "society",
   "outsider"
  ],
  "prompt": "Welke onderwerpen uit het nieuws blijven je bezighouden?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Onrecht",
    "prefer": [
     "justice"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Oorlog",
    "prefer": [
     "war"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Milieu",
    "prefer": [
     "environment"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-justice-2",
  "group": "justice",
  "stage": 2,
  "when": [
   "justice",
   "society",
   "outsider"
  ],
  "prompt": "Wat vind je interessant aan mensen die voor iets opkomen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Voor elkaar zorgen",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Rechtvaardigheid",
    "prefer": [
     "justice"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Moedige keuzes",
    "prefer": [
     "choices"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-justice-3",
  "group": "justice",
  "stage": 2,
  "when": [
   "justice",
   "society",
   "outsider"
  ],
  "prompt": "Waar zou je graag over lezen als iemand anders behandeld wordt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Erbij horen",
    "prefer": [
     "outsider"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vooroordelen",
    "prefer": [
     "justice"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Zelfvertrouwen",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-justice-4",
  "group": "justice",
  "stage": 2,
  "when": [
   "justice",
   "society",
   "outsider"
  ],
  "prompt": "Welke onderwerpen over samenleven vind je belangrijk?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Gelijkheid",
    "prefer": [
     "justice"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Verschillende culturen",
    "prefer": [
     "society",
     "travel"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Samenwerken",
    "prefer": [
     "team"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-justice-5",
  "group": "justice",
  "stage": 2,
  "when": [
   "justice",
   "society",
   "outsider"
  ],
  "prompt": "Wat wil je weten over iemand die in een moeilijke situatie opgroeit?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Het gezin",
    "prefer": [
     "family"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Kansen en keuzes",
    "prefer": [
     "choices",
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De omgeving",
    "prefer": [
     "society"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-justice-6",
  "group": "justice",
  "stage": 2,
  "when": [
   "justice",
   "society",
   "outsider"
  ],
  "prompt": "Wat spreekt je aan in verhalen over verandering in de samenleving?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Geschiedenis",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Mensen die iets veranderen",
    "prefer": [
     "justice",
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Waargebeurde verhalen",
    "prefer": [
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-justice-7",
  "group": "justice",
  "stage": 2,
  "when": [
   "justice",
   "society",
   "outsider"
  ],
  "prompt": "Waar ben je nieuwsgierig naar als mensen het niet met elkaar eens zijn?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe ze denken",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe ze een oplossing vinden",
    "prefer": [
     "choices"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat eerlijk is",
    "prefer": [
     "justice"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-justice-8",
  "group": "justice",
  "stage": 2,
  "when": [
   "justice",
   "society",
   "outsider"
  ],
  "prompt": "Wat vind je interessant aan verhalen over pesten?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe iemand hulp krijgt",
    "prefer": [
     "friendship",
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Erbij horen",
    "prefer": [
     "outsider"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Voor jezelf opkomen",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-justice-9",
  "group": "justice",
  "stage": 2,
  "when": [
   "justice",
   "society",
   "outsider"
  ],
  "prompt": "Welke onderwerpen lees je graag om beter te begrijpen hoe anderen leven?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Andere landen",
    "prefer": [
     "travel"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Andere gezinnen",
    "prefer": [
     "family"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Maatschappelijke problemen",
    "prefer": [
     "society"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-music-1",
  "group": "music",
  "stage": 2,
  "when": [
   "music"
  ],
  "prompt": "Welke muziek luister je graag?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Rap",
    "prefer": [
     "music"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Andere muziek",
    "prefer": [
     "music"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Muziek uit films",
    "prefer": [
     "music",
     "art"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-music-2",
  "group": "music",
  "stage": 2,
  "when": [
   "music"
  ],
  "prompt": "Wat zou je willen weten over een muzikant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe iemand muziek maakt",
    "prefer": [
     "music",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Het leven van die persoon",
    "prefer": [
     "people",
     "true"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe iemand bekend wordt",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-music-3",
  "group": "music",
  "stage": 2,
  "when": [
   "art"
  ],
  "prompt": "Wat trekt je aan in tekenen, ontwerpen of maken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Nieuwe ideeën",
    "prefer": [
     "art",
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Techniek",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Jezelf uitdrukken",
    "prefer": [
     "art",
     "growth"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-music-4",
  "group": "music",
  "stage": 2,
  "when": [
   "art"
  ],
  "prompt": "Welke vormen van kunst vind je interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Fotografie",
    "prefer": [
     "art"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Tekenen",
    "prefer": [
     "art"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Muziek",
    "prefer": [
     "music"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-music-5",
  "group": "music",
  "stage": 2,
  "when": [
   "art"
  ],
  "prompt": "Wat spreekt je aan in verhalen over iemand met een creatief talent?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Oefenen en ontwikkelen",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Zelf iets ontwerpen",
    "prefer": [
     "art"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een doel halen",
    "prefer": [
     "challenge"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-music-6",
  "group": "music",
  "stage": 2,
  "when": [
   "art"
  ],
  "prompt": "Waar zou je graag meer over leren als je zelf iets maakt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Materialen en techniek",
    "prefer": [
     "technology",
     "art"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Inspiratie",
    "prefer": [
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De geschiedenis van kunst",
    "prefer": [
     "history",
     "art"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-music-7",
  "group": "music",
  "stage": 2,
  "when": [
   "music"
  ],
  "prompt": "Wat vind je interessant aan de verhalen achter liedjes?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Gevoelens",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De ervaringen van mensen",
    "prefer": [
     "people",
     "true"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Maatschappelijke onderwerpen",
    "prefer": [
     "society"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-music-8",
  "group": "music",
  "stage": 2,
  "when": [
   "art"
  ],
  "prompt": "Wat vind je boeiend aan films maken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Techniek",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Personages",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Beeld en ontwerp",
    "prefer": [
     "art"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-music-9",
  "group": "music",
  "stage": 2,
  "when": [
   "art"
  ],
  "prompt": "Welke verhalen over creatieve mensen passen bij je?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Waargebeurde levensverhalen",
    "prefer": [
     "true",
     "art"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een nieuwe kans",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-life-1",
  "group": "life",
  "stage": 2,
  "when": [
   "empathy",
   "growth",
   "health"
  ],
  "prompt": "Welke onderwerpen over het opgroeien vind je interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Zelfvertrouwen",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Thuis",
    "prefer": [
     "family"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-life-2",
  "group": "life",
  "stage": 2,
  "when": [
   "empathy",
   "growth",
   "health"
  ],
  "prompt": "Wat spreekt je aan in verhalen waarin iemand een nieuwe start maakt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Veranderen",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een andere plek",
    "prefer": [
     "travel"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Nieuwe mensen",
    "prefer": [
     "people"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-life-3",
  "group": "life",
  "stage": 2,
  "when": [
   "empathy",
   "growth",
   "health"
  ],
  "prompt": "Wat vind je interessant aan mensen die iets moeilijks meemaken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hun gevoelens",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De mensen die helpen",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe ze verdergaan",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-life-4",
  "group": "life",
  "stage": 2,
  "when": [
   "empathy",
   "growth",
   "health"
  ],
  "prompt": "Wat zou je willen begrijpen over gezondheid?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Het lichaam",
    "prefer": [
     "health",
     "science"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Mentale gezondheid",
    "prefer": [
     "empathy",
     "health"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Waargebeurde ervaringen",
    "prefer": [
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-life-5",
  "group": "life",
  "stage": 2,
  "when": [
   "empathy",
   "growth",
   "health"
  ],
  "prompt": "Welke ervaringen van andere mensen zou je willen lezen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een bijzondere jeugd",
    "prefer": [
     "family",
     "true"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een moeilijke periode",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een persoonlijke overwinning",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-life-6",
  "group": "life",
  "stage": 2,
  "when": [
   "empathy",
   "growth",
   "health"
  ],
  "prompt": "Wat vind je belangrijk aan verhalen over jezelf leren kennen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Identiteit",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Omgaan met anderen",
    "prefer": [
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Eigen keuzes",
    "prefer": [
     "choices"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-life-7",
  "group": "life",
  "stage": 2,
  "when": [
   "empathy",
   "growth",
   "health"
  ],
  "prompt": "Wat trekt je aan in verhalen over iemand die hulp krijgt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Gezondheid",
    "prefer": [
     "health"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Vertrouwen",
    "prefer": [
     "relationships"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-life-8",
  "group": "life",
  "stage": 2,
  "when": [
   "empathy",
   "growth",
   "health"
  ],
  "prompt": "Waar wil je meer over weten als het gaat om gevoelens?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe ze ontstaan",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Omgaan met verdriet",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe je elkaar begrijpt",
    "prefer": [
     "relationships"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-life-9",
  "group": "life",
  "stage": 2,
  "when": [
   "empathy",
   "growth",
   "health"
  ],
  "prompt": "Welke verhalen over tegenslagen geven je nieuwsgierigheid?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Waargebeurde ervaringen",
    "prefer": [
     "true"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Opnieuw beginnen",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Iemand die doorzet",
    "prefer": [
     "challenge"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-facts-1",
  "group": "facts",
  "stage": 2,
  "when": [
   "facts",
   "true"
  ],
  "prompt": "Wat leer je graag buiten school?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Geschiedenis",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wetenschap",
    "prefer": [
     "science"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Sport",
    "prefer": [
     "sport"
    ],
    "length": ""
   },
   {
    "id": "3",
    "label": "Dieren",
    "prefer": [
     "animals"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-facts-2",
  "group": "facts",
  "stage": 2,
  "when": [
   "facts",
   "true"
  ],
  "prompt": "Waarover zoek je zelf soms informatie op?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Techniek",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Mensen en gedrag",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Misdaad",
    "prefer": [
     "crime"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-facts-3",
  "group": "facts",
  "stage": 2,
  "when": [
   "facts",
   "true"
  ],
  "prompt": "Wat vind je interessant aan iemands levensverhaal?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe iemand opgroeit",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wat iemand bereikt",
    "prefer": [
     "challenge"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat iemand meemaakt",
    "prefer": [
     "empathy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-facts-4",
  "group": "facts",
  "stage": 2,
  "when": [
   "facts",
   "true"
  ],
  "prompt": "Welke documentaires kijk je graag?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Natuur",
    "prefer": [
     "nature",
     "true"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Geschiedenis",
    "prefer": [
     "history",
     "true"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Misdaad",
    "prefer": [
     "crime",
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-facts-5",
  "group": "facts",
  "stage": 2,
  "when": [
   "facts",
   "true"
  ],
  "prompt": "Wat voor feiten verrassen je meestal?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Wetenschappelijke ontdekkingen",
    "prefer": [
     "science",
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Verleden",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Dieren",
    "prefer": [
     "animals"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-facts-6",
  "group": "facts",
  "stage": 2,
  "when": [
   "facts",
   "true"
  ],
  "prompt": "Welke onderwerpen uit de echte wereld lees je liefst in een boek?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Andere landen",
    "prefer": [
     "travel"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Maatschappij",
    "prefer": [
     "society"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Gezondheid",
    "prefer": [
     "health"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-facts-7",
  "group": "facts",
  "stage": 2,
  "when": [
   "facts",
   "true"
  ],
  "prompt": "Wat spreekt je aan in verhalen die echt gebeurd zijn?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De ervaringen",
    "prefer": [
     "true",
     "people"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De achtergrond",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De keuzes",
    "prefer": [
     "choices"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-facts-8",
  "group": "facts",
  "stage": 2,
  "when": [
   "facts",
   "true"
  ],
  "prompt": "Waarover zou je een spreekbeurt willen houden als je zelf mag kiezen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Techniek",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Dieren",
    "prefer": [
     "animals"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Sport",
    "prefer": [
     "sport"
    ],
    "length": ""
   },
   {
    "id": "3",
    "label": "Geschiedenis",
    "prefer": [
     "history"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-facts-9",
  "group": "facts",
  "stage": 2,
  "when": [
   "facts",
   "true"
  ],
  "prompt": "Wat wil je graag kunnen uitleggen aan iemand anders?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe iets werkt",
    "prefer": [
     "science",
     "technology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wat er gebeurd is",
    "prefer": [
     "history",
     "true"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Waarom mensen iets doen",
    "prefer": [
     "psychology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-economics-1",
  "group": "economics",
  "stage": 2,
  "when": [
   "economics"
  ],
  "prompt": "Wat vind je interessant aan hoe mensen geld verdienen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een bedrijf beginnen",
    "prefer": [
     "economics",
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Werk en kansen",
    "prefer": [
     "society"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De risico's",
    "prefer": [
     "choices",
     "economics"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-economics-2",
  "group": "economics",
  "stage": 2,
  "when": [
   "economics"
  ],
  "prompt": "Wat zou je willen weten over geld besparen of uitgeven?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe geld werkt",
    "prefer": [
     "economics",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Zelf keuzes maken",
    "prefer": [
     "choices"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Ondernemen",
    "prefer": [
     "economics"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-economics-3",
  "group": "economics",
  "stage": 2,
  "when": [
   "economics"
  ],
  "prompt": "Wat spreekt je aan in verhalen over iemand die een eigen plan uitvoert?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Doorzetten",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Iets bedenken",
    "prefer": [
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Samenwerken",
    "prefer": [
     "team"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-economics-4",
  "group": "economics",
  "stage": 2,
  "when": [
   "economics"
  ],
  "prompt": "Welke kanten van rijkdom en armoede interesseren je?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Gelijke kansen",
    "prefer": [
     "justice"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe mensen leven",
    "prefer": [
     "people",
     "society"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Financiële keuzes",
    "prefer": [
     "economics"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-economics-5",
  "group": "economics",
  "stage": 2,
  "when": [
   "economics"
  ],
  "prompt": "Wat vind je boeiend aan de geschiedenis van handel?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Andere landen",
    "prefer": [
     "travel"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De economie",
    "prefer": [
     "economics",
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Uitvindingen",
    "prefer": [
     "technology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-economics-6",
  "group": "economics",
  "stage": 2,
  "when": [
   "economics"
  ],
  "prompt": "Welke onderwerpen over werk maken je nieuwsgierig?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een beroep leren",
    "prefer": [
     "growth",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een team",
    "prefer": [
     "team"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een eigen bedrijf",
    "prefer": [
     "economics"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-economics-7",
  "group": "economics",
  "stage": 2,
  "when": [
   "economics"
  ],
  "prompt": "Wat zou je willen lezen over iemand die veel geld verliest?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Opnieuw beginnen",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De gevolgen thuis",
    "prefer": [
     "family"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe het gebeurde",
    "prefer": [
     "psychology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-economics-8",
  "group": "economics",
  "stage": 2,
  "when": [
   "economics"
  ],
  "prompt": "Wat spreekt je aan in verhalen over succes?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe iemand iets bereikt",
    "prefer": [
     "challenge",
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Creatieve ideeën",
    "prefer": [
     "art"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Samen iets opbouwen",
    "prefer": [
     "team"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-economics-9",
  "group": "economics",
  "stage": 2,
  "when": [
   "economics"
  ],
  "prompt": "Wat zou je meer willen begrijpen aan reclame en beïnvloeding?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe mensen denken",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Beïnvloeding",
    "prefer": [
     "manipulation"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe bedrijven werken",
    "prefer": [
     "economics"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-environment-1",
  "group": "environment",
  "stage": 2,
  "when": [
   "environment"
  ],
  "prompt": "Welke onderwerpen over de aarde interesseren je?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Klimaat",
    "prefer": [
     "environment"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Dieren",
    "prefer": [
     "animals"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Landschappen",
    "prefer": [
     "nature"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-environment-2",
  "group": "environment",
  "stage": 2,
  "when": [
   "environment"
  ],
  "prompt": "Wat zou je willen weten over een veranderend klimaat?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De oorzaken",
    "prefer": [
     "science"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De gevolgen",
    "prefer": [
     "nature",
     "environment"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Oplossingen",
    "prefer": [
     "technology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-environment-3",
  "group": "environment",
  "stage": 2,
  "when": [
   "environment"
  ],
  "prompt": "Wat vind je interessant aan mensen die de natuur beschermen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Dieren helpen",
    "prefer": [
     "animals"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Samen iets veranderen",
    "prefer": [
     "team",
     "justice"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wetenschappelijk onderzoek",
    "prefer": [
     "science"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-environment-4",
  "group": "environment",
  "stage": 2,
  "when": [
   "environment"
  ],
  "prompt": "Waar ben je nieuwsgierig naar als je over de toekomst van de aarde leest?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe mensen leven",
    "prefer": [
     "future",
     "society"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Nieuwe techniek",
    "prefer": [
     "technology",
     "future"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Natuur",
    "prefer": [
     "nature",
     "environment"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-environment-5",
  "group": "environment",
  "stage": 2,
  "when": [
   "environment"
  ],
  "prompt": "Wat spreekt je aan in verhalen over een natuurramp?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Overleven",
    "prefer": [
     "survival"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De mensen die helpen",
    "prefer": [
     "team",
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat er werkelijk gebeurd is",
    "prefer": [
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-environment-6",
  "group": "environment",
  "stage": 2,
  "when": [
   "environment"
  ],
  "prompt": "Welke onderwerpen over energie zou je willen begrijpen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe energie werkt",
    "prefer": [
     "science",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Nieuwe uitvindingen",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De gevolgen voor de omgeving",
    "prefer": [
     "environment"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-environment-7",
  "group": "environment",
  "stage": 2,
  "when": [
   "environment"
  ],
  "prompt": "Wat vind je interessant aan het leven in andere klimaten?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Dieren en planten",
    "prefer": [
     "nature",
     "animals"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Mensen en gewoonten",
    "prefer": [
     "travel",
     "people"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Overleven",
    "prefer": [
     "survival"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-environment-8",
  "group": "environment",
  "stage": 2,
  "when": [
   "environment"
  ],
  "prompt": "Wat zou je graag lezen over oceanen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Dieren",
    "prefer": [
     "animals",
     "nature"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Onderzoek",
    "prefer": [
     "science"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Reizen en ontdekken",
    "prefer": [
     "adventure",
     "travel"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-environment-9",
  "group": "environment",
  "stage": 2,
  "when": [
   "environment"
  ],
  "prompt": "Welke oplossingen voor problemen in de natuur vind je boeiend?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Techniek",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Gedrag van mensen",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Samenwerking",
    "prefer": [
     "society",
     "team"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-horror-1",
  "group": "horror",
  "stage": 2,
  "when": [
   "horror"
  ],
  "prompt": "Welke enge verhalen vind je leuk om te kijken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Bovennatuurlijke verhalen",
    "prefer": [
     "magic",
     "horror"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Realistische spanning",
    "prefer": [
     "realistic",
     "danger"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Onverklaarbare dingen",
    "prefer": [
     "unusual"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-horror-2",
  "group": "horror",
  "stage": 2,
  "when": [
   "horror"
  ],
  "prompt": "Wat vind je interessant aan verhalen over angst?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe mensen reageren",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wat er onbekend is",
    "prefer": [
     "unusual"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe iemand ermee omgaat",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-horror-3",
  "group": "horror",
  "stage": 2,
  "when": [
   "horror"
  ],
  "prompt": "Waar ben je nieuwsgierig naar als iets vreemds gebeurt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een verklaring",
    "prefer": [
     "puzzles"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De geschiedenis van een plek",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het bovennatuurlijke",
    "prefer": [
     "magic"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-horror-4",
  "group": "horror",
  "stage": 2,
  "when": [
   "horror"
  ],
  "prompt": "Wat spreekt je aan in griezelverhalen over een onbekende omgeving?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De plek",
    "prefer": [
     "setting"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Het mysterie",
    "prefer": [
     "mystery"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het overleven",
    "prefer": [
     "survival"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-horror-5",
  "group": "horror",
  "stage": 2,
  "when": [
   "horror"
  ],
  "prompt": "Welke onderwerpen passen volgens jou bij een spannend verhaal?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Geheimen",
    "prefer": [
     "secrets"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Gevaar",
    "prefer": [
     "danger"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Iets dat niemand begrijpt",
    "prefer": [
     "unusual"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-horror-6",
  "group": "horror",
  "stage": 2,
  "when": [
   "horror"
  ],
  "prompt": "Wat vind je interessant aan verhalen waarin niemand weet wie te vertrouwen is?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De motieven",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Verborgen informatie",
    "prefer": [
     "secrets"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Relaties",
    "prefer": [
     "relationships"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-horror-7",
  "group": "horror",
  "stage": 2,
  "when": [
   "horror"
  ],
  "prompt": "Wat maakt verhalen over geesten of legendes interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Oude verhalen",
    "prefer": [
     "history",
     "fantasy"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Magie",
    "prefer": [
     "magic"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het onbekende",
    "prefer": [
     "unusual"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-horror-8",
  "group": "horror",
  "stage": 2,
  "when": [
   "horror"
  ],
  "prompt": "Waar ligt voor jou de grens tussen spannend en eng?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Liever spanning zonder griezelen",
    "prefer": [
     "danger"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Griezelen mag",
    "prefer": [
     "horror"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Vooral mysterie",
    "prefer": [
     "mystery"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-horror-9",
  "group": "horror",
  "stage": 2,
  "when": [
   "horror"
  ],
  "prompt": "Wat lees je graag als je wel spanning wilt maar niet wilt schrikken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Detectives",
    "prefer": [
     "puzzles"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Realistische verhalen",
    "prefer": [
     "realistic"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Avontuur",
    "prefer": [
     "adventure"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-school-1",
  "group": "school",
  "stage": 2,
  "when": [
   "school"
  ],
  "prompt": "Welke dingen uit het dagelijks leven van jongeren vind je interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "School",
    "prefer": [
     "school"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Familie",
    "prefer": [
     "family"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-school-2",
  "group": "school",
  "stage": 2,
  "when": [
   "realistic"
  ],
  "prompt": "Wat spreekt je aan in herkenbare verhalen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Problemen die echt kunnen gebeuren",
    "prefer": [
     "realistic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Humor",
    "prefer": [
     "humor"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Relaties",
    "prefer": [
     "relationships"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-school-3",
  "group": "school",
  "stage": 2,
  "when": [
   "school"
  ],
  "prompt": "Waarover zou je lezen als het verhaal op een middelbare school speelt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Erbij horen",
    "prefer": [
     "outsider"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vrienden",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Geheimen",
    "prefer": [
     "secrets"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-school-4",
  "group": "school",
  "stage": 2,
  "when": [
   "school"
  ],
  "prompt": "Wat vind je interessant aan iemand die een nieuwe klas krijgt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Nieuwe mensen",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Zelfvertrouwen",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-school-5",
  "group": "school",
  "stage": 2,
  "when": [
   "school"
  ],
  "prompt": "Welke onderwerpen op school zou je beter willen begrijpen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Groepsdruk",
    "prefer": [
     "psychology",
     "team"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Onrecht",
    "prefer": [
     "justice"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Toekomstkeuzes",
    "prefer": [
     "choices",
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-school-6",
  "group": "school",
  "stage": 2,
  "when": [
   "school"
  ],
  "prompt": "Wat lees je graag over iemand die een eigen weg zoekt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Voor zichzelf opkomen",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Keuzes",
    "prefer": [
     "choices"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Andere mensen begrijpen",
    "prefer": [
     "psychology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-school-7",
  "group": "school",
  "stage": 2,
  "when": [
   "outsider"
  ],
  "prompt": "Welke verhalen over jongeren die anders zijn spreken je aan?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Acceptatie",
    "prefer": [
     "outsider"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Identiteit",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-school-8",
  "group": "school",
  "stage": 2,
  "when": [
   "school"
  ],
  "prompt": "Wat vind je interessant aan verhalen over een schoolproject?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Samenwerken",
    "prefer": [
     "team"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Iets leren",
    "prefer": [
     "facts"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een uitdaging",
    "prefer": [
     "challenge"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-school-9",
  "group": "school",
  "stage": 2,
  "when": [
   "school"
  ],
  "prompt": "Welke humor uit het dagelijks leven herken je graag in een verhaal?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Thuis",
    "prefer": [
     "family",
     "humor"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Op school",
    "prefer": [
     "school",
     "humor"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Met vrienden",
    "prefer": [
     "friendship",
     "humor"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-travel-1",
  "group": "travel",
  "stage": 2,
  "when": [
   "travel"
  ],
  "prompt": "Welke landen of plekken maken je nieuwsgierig?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Andere culturen",
    "prefer": [
     "travel",
     "society"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Natuurgebieden",
    "prefer": [
     "nature"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Oude steden",
    "prefer": [
     "history"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-travel-2",
  "group": "travel",
  "stage": 2,
  "when": [
   "travel"
  ],
  "prompt": "Wat zou je willen lezen over iemand die naar een ander land gaat?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Nieuwe vrienden",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een nieuwe cultuur",
    "prefer": [
     "travel"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een persoonlijke verandering",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-travel-3",
  "group": "travel",
  "stage": 2,
  "when": [
   "travel"
  ],
  "prompt": "Wat vind je interessant aan verhalen over onderweg zijn?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Onbekende plekken",
    "prefer": [
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De mensen die je ontmoet",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het avontuur",
    "prefer": [
     "adventure"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-travel-4",
  "group": "travel",
  "stage": 2,
  "when": [
   "travel"
  ],
  "prompt": "Welke reisverhalen kijk of lees je graag?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Waargebeurde reizen",
    "prefer": [
     "true",
     "travel"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Expedities",
    "prefer": [
     "survival",
     "travel"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Verzonnen avonturen",
    "prefer": [
     "adventure"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-travel-5",
  "group": "travel",
  "stage": 2,
  "when": [
   "travel"
  ],
  "prompt": "Wat wil je weten over het dagelijks leven in andere landen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Cultuur",
    "prefer": [
     "society",
     "travel"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Geschiedenis",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Natuur",
    "prefer": [
     "nature"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-travel-6",
  "group": "travel",
  "stage": 2,
  "when": [
   "travel"
  ],
  "prompt": "Waar ben je nieuwsgierig naar als je een oude stad bezoekt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De verhalen van vroeger",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De mensen",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Kunst en gebouwen",
    "prefer": [
     "art"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-travel-7",
  "group": "travel",
  "stage": 2,
  "when": [
   "travel"
  ],
  "prompt": "Welke uitdagingen tijdens een reis spreken je aan?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Zelf oplossingen bedenken",
    "prefer": [
     "puzzles"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Overleven",
    "prefer": [
     "survival"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Nieuwe dingen leren",
    "prefer": [
     "discovery"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-travel-8",
  "group": "travel",
  "stage": 2,
  "when": [
   "travel"
  ],
  "prompt": "Wat vind je interessant aan verhalen over verhuizen naar een ander land?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een nieuwe omgeving",
    "prefer": [
     "travel",
     "setting"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Erbij horen",
    "prefer": [
     "outsider"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het gezin",
    "prefer": [
     "family"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-travel-9",
  "group": "travel",
  "stage": 2,
  "when": [
   "travel"
  ],
  "prompt": "Over welke plekken zou je iets willen leren zonder er zelf heen te gaan?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De ruimte",
    "prefer": [
     "science"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Afgelegen natuur",
    "prefer": [
     "nature"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Historische plekken",
    "prefer": [
     "history",
     "travel"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-choices-1",
  "group": "choices",
  "stage": 2,
  "when": [
   "choices",
   "challenge",
   "growth"
  ],
  "prompt": "Welke keuzes van personages vind je interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Voor zichzelf kiezen",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Iemand helpen",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Eerlijk blijven",
    "prefer": [
     "justice"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-choices-2",
  "group": "choices",
  "stage": 2,
  "when": [
   "choices",
   "challenge",
   "growth"
  ],
  "prompt": "Wat spreekt je aan in verhalen over mensen met een doel?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Doorzetten",
    "prefer": [
     "challenge"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Samenwerken",
    "prefer": [
     "team"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Veranderen",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-choices-3",
  "group": "choices",
  "stage": 2,
  "when": [
   "choices",
   "challenge",
   "growth"
  ],
  "prompt": "Wat wil je weten wanneer iemand iets moeilijks moet beslissen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De redenen",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De gevolgen",
    "prefer": [
     "choices"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat anderen vinden",
    "prefer": [
     "relationships"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-choices-4",
  "group": "choices",
  "stage": 2,
  "when": [
   "choices",
   "challenge",
   "growth"
  ],
  "prompt": "Welke uitdagingen zou je graag volgen in een verhaal?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een sportdoel",
    "prefer": [
     "competition",
     "sport"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een ontdekking",
    "prefer": [
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een persoonlijke stap",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-choices-5",
  "group": "choices",
  "stage": 2,
  "when": [
   "choices",
   "challenge",
   "growth"
  ],
  "prompt": "Wat vind je interessant aan mensen die een fout maken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Waarom het gebeurde",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe ze het goedmaken",
    "prefer": [
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe ze ervan leren",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-choices-6",
  "group": "choices",
  "stage": 2,
  "when": [
   "choices",
   "challenge",
   "growth"
  ],
  "prompt": "Welke verhalen over moed spreken je aan?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Iemand helpen",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Opkomen tegen onrecht",
    "prefer": [
     "justice"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Gevaar overwinnen",
    "prefer": [
     "survival"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-choices-7",
  "group": "choices",
  "stage": 2,
  "when": [
   "choices",
   "challenge",
   "growth"
  ],
  "prompt": "Wat trekt je aan in een verhaal waarin iemand iets nieuws leert?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een vaardigheid",
    "prefer": [
     "technology",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Zelfvertrouwen",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een bijzondere ontdekking",
    "prefer": [
     "science",
     "discovery"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-choices-8",
  "group": "choices",
  "stage": 2,
  "when": [
   "choices",
   "challenge",
   "growth"
  ],
  "prompt": "Wat vind je interessant aan de gevolgen van een beslissing?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Wat er met anderen gebeurt",
    "prefer": [
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe iemand verandert",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat eerlijk is",
    "prefer": [
     "justice"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-choices-9",
  "group": "choices",
  "stage": 2,
  "when": [
   "choices",
   "challenge",
   "growth"
  ],
  "prompt": "Welke verhalen over samenwerken en eigen keuzes maken passen bij je?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een team",
    "prefer": [
     "team"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Iemand die zelfstandig wordt",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-romance-1",
  "group": "romance",
  "stage": 2,
  "when": [
   "relationships"
  ],
  "prompt": "Wat vind je interessant aan verhalen over liefde?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Iemand leren kennen",
    "prefer": [
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vertrouwen",
    "prefer": [
     "secrets",
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Samen opgroeien",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-romance-2",
  "group": "romance",
  "stage": 2,
  "when": [
   "relationships"
  ],
  "prompt": "Welke onderwerpen over relaties spreken je aan?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Vriendschap",
    "prefer": [
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Verliefdheid",
    "prefer": [
     "relationships"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Omgaan met verschillen",
    "prefer": [
     "psychology"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-romance-3",
  "group": "romance",
  "stage": 2,
  "when": [
   "relationships"
  ],
  "prompt": "Wat zou je willen lezen over iemand die voor het eerst verliefd wordt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Herkenbare situaties",
    "prefer": [
     "realistic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Grappige momenten",
    "prefer": [
     "humor"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Gevoelens",
    "prefer": [
     "empathy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-romance-4",
  "group": "romance",
  "stage": 2,
  "when": [
   "relationships"
  ],
  "prompt": "Wat maakt een liefdesverhaal voor jou geloofwaardig?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe mensen praten",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wat ze samen meemaken",
    "prefer": [
     "adventure"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Moeilijke keuzes",
    "prefer": [
     "choices"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-romance-5",
  "group": "romance",
  "stage": 2,
  "when": [
   "relationships"
  ],
  "prompt": "Welke combinatie met romantiek vind je leuk?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Mysterie",
    "prefer": [
     "relationships",
     "mystery"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Humor",
    "prefer": [
     "relationships",
     "humor"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Waargebeurde ervaringen",
    "prefer": [
     "relationships",
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-romance-6",
  "group": "romance",
  "stage": 2,
  "when": [
   "relationships"
  ],
  "prompt": "Wat vind je boeiend aan verhalen over relaties die veranderen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Opgroeien",
    "prefer": [
     "growth"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Vertrouwen",
    "prefer": [
     "secrets"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Omgaan met verlies",
    "prefer": [
     "empathy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-romance-7",
  "group": "romance",
  "stage": 2,
  "when": [
   "relationships"
  ],
  "prompt": "Welke situaties over vriendschap en liefde herken je graag in verhalen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "School",
    "prefer": [
     "school"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Familie",
    "prefer": [
     "family"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een groep vrienden",
    "prefer": [
     "friendship"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-romance-8",
  "group": "romance",
  "stage": 2,
  "when": [
   "relationships"
  ],
  "prompt": "Waarover lees je graag als twee mensen elkaar niet goed begrijpen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hun gedachten",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hun gesprekken",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe ze het oplossen",
    "prefer": [
     "choices"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-romance-9",
  "group": "romance",
  "stage": 2,
  "when": [
   "relationships"
  ],
  "prompt": "Wat spreekt je aan in verhalen over mensen die elkaar opnieuw ontmoeten?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hun gedeelde verleden",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Gevoelens",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Verandering",
    "prefer": [
     "growth"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-format-1",
  "group": "format",
  "stage": 3,
  "when": [
   "realistic",
   "true",
   "facts"
  ],
  "prompt": "Als je over een interessant onderwerp leest, hoe leer je het liefst iets nieuws?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Via een verhaal",
    "prefer": [
     "realistic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Via echte ervaringen",
    "prefer": [
     "true"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Via uitleg en feiten",
    "prefer": [
     "facts"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-format-2",
  "group": "format",
  "stage": 3,
  "when": [
   "realistic",
   "true",
   "facts"
  ],
  "prompt": "Wat vind je belangrijk als een verhaal echt gebeurd is?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De achtergrond",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De persoonlijke ervaring",
    "prefer": [
     "people",
     "true"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De uitleg",
    "prefer": [
     "facts"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-format-3",
  "group": "format",
  "stage": 3,
  "when": [
   "realistic",
   "true",
   "facts"
  ],
  "prompt": "Wat zou je lezen over een bestaande persoon?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een levensverhaal",
    "prefer": [
     "true",
     "people"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een bijzondere prestatie",
    "prefer": [
     "challenge",
     "true"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De tijd waarin die leefde",
    "prefer": [
     "history"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-format-4",
  "group": "format",
  "stage": 3,
  "when": [
   "realistic",
   "true",
   "facts"
  ],
  "prompt": "Wat spreekt je aan in verhalen die op echte gebeurtenissen lijken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Herkenbare mensen",
    "prefer": [
     "realistic",
     "people"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De maatschappelijke achtergrond",
    "prefer": [
     "society"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Spanning",
    "prefer": [
     "danger"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-format-5",
  "group": "format",
  "stage": 3,
  "when": [
   "realistic",
   "true",
   "facts"
  ],
  "prompt": "Welke manier om kennis op te doen vind je leuk?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Ontdekkingen",
    "prefer": [
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Praktische uitleg",
    "prefer": [
     "facts"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een verhaal uit het echte leven",
    "prefer": [
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-format-6",
  "group": "format",
  "stage": 3,
  "when": [
   "realistic",
   "true",
   "facts"
  ],
  "prompt": "Wat verwacht je van een boek over een waargebeurde gebeurtenis?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Wat er gebeurde",
    "prefer": [
     "true",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Waarom het gebeurde",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe mensen ermee omgingen",
    "prefer": [
     "empathy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-format-7",
  "group": "format",
  "stage": 3,
  "when": [
   "realistic",
   "true",
   "facts"
  ],
  "prompt": "Hoeveel fantasie mag er in een verhaal over een echt onderwerp zitten?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Zo realistisch mogelijk",
    "prefer": [
     "realistic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Ook verzonnen werelden",
    "prefer": [
     "fantasy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Maakt niet uit",
    "prefer": [],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-format-8",
  "group": "format",
  "stage": 3,
  "when": [
   "realistic",
   "true",
   "facts"
  ],
  "prompt": "Wat vind je interessant aan een verhaal dat zich nu afspeelt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Herkenbare situaties",
    "prefer": [
     "realistic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Actuele onderwerpen",
    "prefer": [
     "society"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Mensen van nu",
    "prefer": [
     "people"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-format-9",
  "group": "format",
  "stage": 3,
  "when": [
   "realistic",
   "true",
   "facts"
  ],
  "prompt": "Welke boeken pak je eerder als je iets nieuws wilt weten?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Informatieve boeken",
    "prefer": [
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Biografieën",
    "prefer": [
     "true",
     "people"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Verhalen met echte achtergronden",
    "prefer": [
     "history",
     "realistic"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reading-1",
  "group": "reading",
  "stage": 3,
  "when": [
   "danger",
   "action",
   "calm",
   "fast",
   "slow",
   "humor"
  ],
  "prompt": "Hoe merk je bij een boek dat je verder wilt lezen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Er gebeurt iets",
    "prefer": [
     "action",
     "fast"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Ik wil iets ontdekken",
    "prefer": [
     "mystery",
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Ik leef mee",
    "prefer": [
     "empathy"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-reading-2",
  "group": "reading",
  "stage": 3,
  "when": [
   "danger",
   "action",
   "calm",
   "fast",
   "slow",
   "humor"
  ],
  "prompt": "Wat vind je prettig als je na school een boek leest?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Iets luchtigs",
    "prefer": [
     "humor"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Rustig lezen",
    "prefer": [
     "calm"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een avontuur",
    "prefer": [
     "adventure"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reading-3",
  "group": "reading",
  "stage": 3,
  "when": [
   "danger",
   "action",
   "calm",
   "fast",
   "slow",
   "humor"
  ],
  "prompt": "Welke sfeer past bij waar je vandaag zin in hebt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Spanning",
    "prefer": [
     "danger"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Humor",
    "prefer": [
     "humor"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Rust",
    "prefer": [
     "calm"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reading-4",
  "group": "reading",
  "stage": 3,
  "when": [
   "danger",
   "action",
   "calm",
   "fast",
   "slow",
   "humor"
  ],
  "prompt": "Wat vind je fijn aan een verhaal dat rustig begint?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Mensen leren kennen",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De omgeving ontdekken",
    "prefer": [
     "setting"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Langzaam spanning voelen",
    "prefer": [
     "slow"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reading-5",
  "group": "reading",
  "stage": 3,
  "when": [
   "danger",
   "action",
   "calm",
   "fast",
   "slow",
   "humor"
  ],
  "prompt": "Wat spreekt je aan als een boek meteen begint met iets onverwachts?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Actie",
    "prefer": [
     "action",
     "fast"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Nieuwsgierigheid",
    "prefer": [
     "mystery"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een bijzondere gebeurtenis",
    "prefer": [
     "unusual"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reading-6",
  "group": "reading",
  "stage": 3,
  "when": [
   "danger",
   "action",
   "calm",
   "fast",
   "slow",
   "humor"
  ],
  "prompt": "Wat helpt jou om een moeilijk verhaal te blijven volgen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Herkenbare situaties",
    "prefer": [
     "realistic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een duidelijk avontuur",
    "prefer": [
     "adventure"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een interessant onderwerp",
    "prefer": [
     "facts"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reading-7",
  "group": "reading",
  "stage": 3,
  "when": [
   "danger",
   "action",
   "calm",
   "fast",
   "slow",
   "humor"
  ],
  "prompt": "Welke combinatie van sfeer en onderwerp lijkt je fijn?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Spanning en echte gebeurtenissen",
    "prefer": [
     "danger",
     "true"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Humor en vriendschap",
    "prefer": [
     "humor",
     "friendship"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Rust en natuur",
    "prefer": [
     "calm",
     "nature"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reading-8",
  "group": "reading",
  "stage": 3,
  "when": [
   "danger",
   "action",
   "calm",
   "fast",
   "slow",
   "humor"
  ],
  "prompt": "Wat wil je na het lezen vooral overhouden?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Iets nieuws geleerd",
    "prefer": [
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een mooi verhaal meegemaakt",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een leuke tijd gehad",
    "prefer": [
     "humor"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reading-9",
  "group": "reading",
  "stage": 3,
  "when": [
   "danger",
   "action",
   "calm",
   "fast",
   "slow",
   "humor"
  ],
  "prompt": "Wat vind je prettig als je weinig tijd hebt om te lezen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een kort boek",
    "prefer": [],
    "length": "short"
   },
   {
    "id": "1",
    "label": "Een boek met veel gebeurtenissen",
    "prefer": [
     "fast"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Maakt niet uit",
    "prefer": [],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-broader-1",
  "group": "broader",
  "stage": 0,
  "when": [],
  "prompt": "Wat zou je zelf eens willen uitzoeken als je helemaal vrij bent in je keuze?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een onderwerp uit de wetenschap",
    "prefer": [
     "science"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Iets over mensen",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Iets uit het verleden",
    "prefer": [
     "history"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-broader-2",
  "group": "broader",
  "stage": 0,
  "when": [],
  "prompt": "Waarover praat je met vrienden als jullie zelf een onderwerp mogen kiezen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Sport",
    "prefer": [
     "sport"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Games",
    "prefer": [
     "gaming"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Films en series",
    "prefer": [],
    "length": ""
   },
   {
    "id": "3",
    "label": "Het dagelijks leven",
    "prefer": [
     "realistic"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-broader-3",
  "group": "broader",
  "stage": 0,
  "when": [],
  "prompt": "Wat kijk je als je even niets hoeft te doen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Grappige filmpjes",
    "prefer": [
     "humor"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Sport",
    "prefer": [
     "sport"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Documentaires",
    "prefer": [
     "true",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "3",
    "label": "Verhalen en series",
    "prefer": [
     "people"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-broader-4",
  "group": "broader",
  "stage": 0,
  "when": [],
  "prompt": "Wat zou je graag eens meemaken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een avontuur",
    "prefer": [
     "adventure"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een reis",
    "prefer": [
     "travel"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Iets nieuws leren",
    "prefer": [
     "discovery"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-broader-5",
  "group": "broader",
  "stage": 0,
  "when": [],
  "prompt": "Welke onderwerpen kom je zelf graag tegen op internet?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Techniek",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Dieren",
    "prefer": [
     "animals"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Muziek",
    "prefer": [
     "music"
    ],
    "length": ""
   },
   {
    "id": "3",
    "label": "Geschiedenis",
    "prefer": [
     "history"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-broader-6",
  "group": "broader",
  "stage": 0,
  "when": [],
  "prompt": "Waar ben je vooral nieuwsgierig naar op dit moment?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe mensen denken",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe iets werkt",
    "prefer": [
     "science"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat er in de wereld gebeurt",
    "prefer": [
     "society"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-broader-7",
  "group": "broader",
  "stage": 0,
  "when": [],
  "prompt": "Als iemand jou iets mag vertellen, welk onderwerp kies je dan?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Waargebeurde gebeurtenissen",
    "prefer": [
     "true"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Sport",
    "prefer": [
     "sport"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Misdaad",
    "prefer": [
     "crime"
    ],
    "length": ""
   },
   {
    "id": "3",
    "label": "Een bijzonder levensverhaal",
    "prefer": [
     "people"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-broader-8",
  "group": "broader",
  "stage": 0,
  "when": [],
  "prompt": "Wat vind je interessant om te leren buiten een lesboek?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Praktische techniek",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Geschiedenis",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Gezondheid",
    "prefer": [
     "health"
    ],
    "length": ""
   },
   {
    "id": "3",
    "label": "Kunst",
    "prefer": [
     "art"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-broader-9",
  "group": "broader",
  "stage": 0,
  "when": [],
  "prompt": "Welk onderwerp zou je uit jezelf opzoeken in de bibliotheek?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Dieren",
    "prefer": [
     "animals"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Sport",
    "prefer": [
     "sport"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Spanning",
    "prefer": [
     "mystery",
     "danger"
    ],
    "length": ""
   },
   {
    "id": "3",
    "label": "Fantasie",
    "prefer": [
     "fantasy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-society-1",
  "group": "society",
  "stage": 2,
  "when": [
   "society",
   "justice",
   "history",
   "economics"
  ],
  "prompt": "Welke veranderingen in de wereld vind je interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Techniek",
    "prefer": [
     "future",
     "technology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Gelijkheid",
    "prefer": [
     "justice"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Klimaat",
    "prefer": [
     "environment"
    ],
    "length": ""
   }
  ],
  "early": true
 },
 {
  "id": "extended-society-2",
  "group": "society",
  "stage": 2,
  "when": [
   "society",
   "justice",
   "history",
   "economics"
  ],
  "prompt": "Wat wil je meer begrijpen aan het leven in een buurt of stad?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe mensen samenleven",
    "prefer": [
     "society"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Verschillende culturen",
    "prefer": [
     "travel",
     "society"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Geschiedenis",
    "prefer": [
     "history"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-society-3",
  "group": "society",
  "stage": 2,
  "when": [
   "society",
   "justice",
   "history",
   "economics"
  ],
  "prompt": "Wat vind je interessant aan mensen die een gemeenschap helpen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Samenwerken",
    "prefer": [
     "team"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Voor anderen zorgen",
    "prefer": [
     "empathy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Rechtvaardigheid",
    "prefer": [
     "justice"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-society-4",
  "group": "society",
  "stage": 2,
  "when": [
   "society",
   "justice",
   "history",
   "economics"
  ],
  "prompt": "Welke onderwerpen uit politiek of maatschappij spreken je aan?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Rechten",
    "prefer": [
     "justice"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Geld",
    "prefer": [
     "economics"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het verleden",
    "prefer": [
     "history"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-society-5",
  "group": "society",
  "stage": 2,
  "when": [
   "society",
   "justice",
   "history",
   "economics"
  ],
  "prompt": "Waar zou je over willen lezen als een samenleving voor een probleem staat?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe mensen keuzes maken",
    "prefer": [
     "choices"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe ze oplossingen bedenken",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe ze elkaar helpen",
    "prefer": [
     "team"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-society-6",
  "group": "society",
  "stage": 2,
  "when": [
   "society",
   "justice",
   "history",
   "economics"
  ],
  "prompt": "Wat spreekt je aan in verhalen over jongeren die iets willen veranderen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hun motivatie",
    "prefer": [
     "growth",
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hun samenwerking",
    "prefer": [
     "team"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hun ideeën",
    "prefer": [
     "society",
     "justice"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-society-7",
  "group": "society",
  "stage": 2,
  "when": [
   "society",
   "justice",
   "history",
   "economics"
  ],
  "prompt": "Welke onderwerpen over verschillende culturen vind je interessant?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Talen en gewoonten",
    "prefer": [
     "travel",
     "society"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Geschiedenis",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Gezinnen",
    "prefer": [
     "family"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-society-8",
  "group": "society",
  "stage": 2,
  "when": [
   "society",
   "justice",
   "history",
   "economics"
  ],
  "prompt": "Wat wil je graag weten over hoe nieuws ontstaat?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Feiten controleren",
    "prefer": [
     "facts",
     "puzzles"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Mensen achter nieuws",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Maatschappelijke gebeurtenissen",
    "prefer": [
     "society"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-society-9",
  "group": "society",
  "stage": 2,
  "when": [
   "society",
   "justice",
   "history",
   "economics"
  ],
  "prompt": "Wat vind je interessant aan verhalen over werk en opleiding?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een beroep ontdekken",
    "prefer": [
     "growth",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Samenwerken",
    "prefer": [
     "team"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De kansen van mensen",
    "prefer": [
     "justice"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-media-1",
  "group": "media",
  "stage": 2,
  "when": [
   "gaming",
   "art",
   "music",
   "fantasy",
   "adventure",
   "mystery"
  ],
  "prompt": "Wat vind je belangrijk als je een serie verder wilt kijken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De personages",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De vragen die openblijven",
    "prefer": [
     "mystery"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat er gebeurt",
    "prefer": [
     "action"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-media-2",
  "group": "media",
  "stage": 2,
  "when": [
   "gaming",
   "art",
   "music",
   "fantasy",
   "adventure",
   "mystery"
  ],
  "prompt": "Wat spreekt je aan in een film die je nog lang onthoudt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Het onderwerp",
    "prefer": [
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De mensen",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De emoties",
    "prefer": [
     "empathy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-media-3",
  "group": "media",
  "stage": 2,
  "when": [
   "gaming",
   "art",
   "music",
   "fantasy",
   "adventure",
   "mystery"
  ],
  "prompt": "Welke verhalen uit films zou je ook graag in boeken lezen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Realistische verhalen",
    "prefer": [
     "realistic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Avonturen",
    "prefer": [
     "adventure"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Misdaad",
    "prefer": [
     "crime"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-media-4",
  "group": "media",
  "stage": 2,
  "when": [
   "gaming",
   "art",
   "music",
   "fantasy",
   "adventure",
   "mystery"
  ],
  "prompt": "Waar let je meestal op als je een nieuw spel of een serie kiest?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Het onderwerp",
    "prefer": [],
    "length": ""
   },
   {
    "id": "1",
    "label": "De wereld",
    "prefer": [
     "setting"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De gebeurtenissen",
    "prefer": [
     "adventure"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-media-5",
  "group": "media",
  "stage": 2,
  "when": [
   "gaming",
   "art",
   "music",
   "fantasy",
   "adventure",
   "mystery"
  ],
  "prompt": "Wat zou je willen lezen over de makers van films of games?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Hoe ze iets ontwerpen",
    "prefer": [
     "art"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe de techniek werkt",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hun eigen verhaal",
    "prefer": [
     "true",
     "people"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-media-6",
  "group": "media",
  "stage": 2,
  "when": [
   "gaming",
   "art",
   "music",
   "fantasy",
   "adventure",
   "mystery"
  ],
  "prompt": "Welke dingen bespreek je graag nadat je iets hebt gekeken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Wat iemand deed",
    "prefer": [
     "choices"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe het afliep",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat er echt gebeurd is",
    "prefer": [
     "true"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-media-7",
  "group": "media",
  "stage": 2,
  "when": [
   "gaming",
   "art",
   "music",
   "fantasy",
   "adventure",
   "mystery"
  ],
  "prompt": "Wat spreekt je aan in verhalen die in verschillende media voorkomen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De wereld",
    "prefer": [
     "setting"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De personages",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "De gebeurtenissen",
    "prefer": [
     "adventure"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-media-8",
  "group": "media",
  "stage": 2,
  "when": [
   "gaming",
   "art",
   "music",
   "fantasy",
   "adventure",
   "mystery"
  ],
  "prompt": "Wat zou je willen ontdekken over het maken van animatie?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Beeld en ontwerp",
    "prefer": [
     "art"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Techniek",
    "prefer": [
     "technology"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het bedenken van een verhaal",
    "prefer": [
     "adventure"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-media-9",
  "group": "media",
  "stage": 2,
  "when": [
   "gaming",
   "art",
   "music",
   "fantasy",
   "adventure",
   "mystery"
  ],
  "prompt": "Wat vind je interessant aan films die zijn gebaseerd op een boek?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Het oorspronkelijke verhaal",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Waargebeurde achtergronden",
    "prefer": [
     "true"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een bijzondere wereld",
    "prefer": [
     "fantasy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reflection-1",
  "group": "reflection",
  "stage": 3,
  "when": [],
  "prompt": "Zijn er onderwerpen waar je liever juist niets over leest?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Ik wil zelf vertellen",
    "prefer": [],
    "length": ""
   },
   {
    "id": "1",
    "label": "Ik weet het niet",
    "prefer": [],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reflection-2",
  "group": "reflection",
  "stage": 3,
  "when": [],
  "prompt": "Welke andere interesse zou je in een boek willen terugzien?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Psychologie",
    "prefer": [
     "psychology"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Geschiedenis",
    "prefer": [
     "history"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Sport",
    "prefer": [
     "sport"
    ],
    "length": ""
   },
   {
    "id": "3",
    "label": "Dieren",
    "prefer": [
     "animals"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reflection-3",
  "group": "reflection",
  "stage": 3,
  "when": [],
  "prompt": "Wat maakt dat je een boek eerder weglegt?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Te weinig gebeurt",
    "prefer": [
     "fast"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Te veel pagina's",
    "prefer": [],
    "length": "short"
   },
   {
    "id": "2",
    "label": "Het onderwerp spreekt niet aan",
    "prefer": [],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reflection-4",
  "group": "reflection",
  "stage": 3,
  "when": [],
  "prompt": "Wat vind je belangrijker als je tussen boeken kiest?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Het onderwerp",
    "prefer": [],
    "length": ""
   },
   {
    "id": "1",
    "label": "De mensen",
    "prefer": [
     "people"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat ik ervan leer",
    "prefer": [
     "facts"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reflection-5",
  "group": "reflection",
  "stage": 3,
  "when": [],
  "prompt": "Wat zou je willen terugzien uit een verhaal dat je eerder leuk vond?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een vergelijkbaar onderwerp",
    "prefer": [],
    "length": ""
   },
   {
    "id": "1",
    "label": "De sfeer",
    "prefer": [],
    "length": ""
   },
   {
    "id": "2",
    "label": "De personages",
    "prefer": [
     "people"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reflection-6",
  "group": "reflection",
  "stage": 3,
  "when": [],
  "prompt": "Wat past het best bij hoe je vandaag wilt lezen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Ontspanning",
    "prefer": [
     "calm"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Nieuwsgierigheid",
    "prefer": [
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Iets leren",
    "prefer": [
     "facts"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reflection-7",
  "group": "reflection",
  "stage": 3,
  "when": [],
  "prompt": "Welke richting wil je juist eens proberen als je iets anders wilt lezen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Waargebeurd",
    "prefer": [
     "true"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Fantasie",
    "prefer": [
     "fantasy"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Humor",
    "prefer": [
     "humor"
    ],
    "length": ""
   },
   {
    "id": "3",
    "label": "Misdaad",
    "prefer": [
     "crime"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reflection-8",
  "group": "reflection",
  "stage": 3,
  "when": [],
  "prompt": "Waarover zou je het liefst met iemand napraten na het lezen?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "De keuzes van mensen",
    "prefer": [
     "choices"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wat ik heb geleerd",
    "prefer": [
     "facts"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Wat mij raakte",
    "prefer": [
     "empathy"
    ],
    "length": ""
   }
  ]
 },
 {
  "id": "extended-reflection-9",
  "group": "reflection",
  "stage": 3,
  "when": [],
  "prompt": "Wat zou een boek voor jou de moeite waard maken?",
  "examples": "Misschien helpen deze voorbeelden.",
  "options": [
   {
    "id": "0",
    "label": "Een onderwerp dat me boeit",
    "prefer": [],
    "length": ""
   },
   {
    "id": "1",
    "label": "Nieuwe inzichten",
    "prefer": [
     "discovery"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een herkenbaar verhaal",
    "prefer": [
     "realistic"
    ],
    "length": ""
   }
  ]
 }
];
