'use strict';
// Reviewed question wording, specific prerequisites and explicit reading preferences.
module.exports=[
 {
  "id": "extended-crime-1",
  "group": "crime",
  "stage": 2,
  "when": [
   "criminalPerspective"
  ],
  "prompt": "Wat wil je weten over iemand die in de misdaad belandt?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Over wie zou je het liefst lezen in een misdaadverhaal?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "De slachtoffers",
    "prefer": [
     "crimeVictims"
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
  "prompt": "Lees je liever echte misdaadzaken of verzonnen verhalen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "courtCases"
  ],
  "prompt": "Wat vind je interessant aan een rechtszaak?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "gangs"
  ],
  "prompt": "Wat maakt een verhaal over een bende interessant voor je?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat als iemand de wet breekt om een ander te helpen?",
  "examples": "Misschien zit hier iets tussen.",
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
  ],
  "requires": [
   "crime",
   "choices"
  ]
 },
 {
  "id": "extended-crime-7",
  "group": "crime",
  "stage": 2,
  "when": [
   "crime"
  ],
  "prompt": "Over welke echte misdaadzaken wil je lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
     "gangs",
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
  ],
  "requires": [
   "crime",
   "true"
  ]
 },
 {
  "id": "extended-crime-8",
  "group": "crime",
  "stage": 2,
  "when": [
   "criminalPerspective"
  ],
  "prompt": "Wat wil je weten over iemand die uit de misdaad probeert te komen?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat wil je weten over een misdaad uit het nieuws?",
  "examples": "Misschien zit hier iets tussen.",
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
  ],
  "requires": [
   "crime",
   "true"
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
  "prompt": "Wat voor raadsel zou je zelf willen oplossen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "unsolvedCases"
  ],
  "prompt": "Wat voor mysteries uit het echte leven vind je interessant?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat voor mysterie wil je lezen?",
  "examples": "Misschien zit hier iets tussen.",
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
     "familySecrets"
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
  "prompt": "Waarom zou iemand iets geheimhouden, denk je?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "discovery"
  ],
  "prompt": "Wat zou je in een verhaal willen ontdekken?",
  "examples": "Welke past het beste bij je?",
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
  ],
  "requires": [
   "discovery",
   "mystery"
  ]
 },
 {
  "id": "extended-mystery-6",
  "group": "mystery",
  "stage": 2,
  "when": [
   "unsolvedCases"
  ],
  "prompt": "Wat trekt je aan in een onopgeloste zaak?",
  "examples": "Misschien zit hier iets tussen.",
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
     "unsolvedCases",
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
   "missingPersons"
  ],
  "prompt": "Wat wil je weten als iemand spoorloos is verdwenen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "unusual"
  ],
  "prompt": "Wil je een verklaring voor iets vreemds, of mag het onverklaarbaar blijven?",
  "examples": "Welke past het beste bij je?",
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
   "secrets"
  ],
  "prompt": "Wat als iemand in een verhaal niet de waarheid vertelt?",
  "examples": "Misschien zit hier iets tussen.",
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
   "psychology"
  ],
  "prompt": "Over welk gedrag van mensen wil je meer weten?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
     "groupPressure"
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
   "growth"
  ],
  "prompt": "Waarover wil je lezen als iemand verandert?",
  "examples": "Welke past het beste bij je?",
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
   "psychology"
  ],
  "prompt": "Wat zou je graag begrijpen aan mensen?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "Gedachten en gevoelens",
    "prefer": [
     "empathy",
     "psychology"
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
   "psychology"
  ],
  "prompt": "Wat vind je interessant aan iemand die anders denkt?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "secrets"
  ],
  "prompt": "Wat vind je boeiend aan vertrouwen en bedrog?",
  "examples": "Welke past het beste bij je?",
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
  ],
  "requires": [
   "secrets",
   "psychology"
  ]
 },
 {
  "id": "extended-psychology-6",
  "group": "psychology",
  "stage": 2,
  "when": [
   "choices"
  ],
  "prompt": "Wat voor moeilijke keuzes vind je interessant?",
  "examples": "Misschien zit hier iets tussen.",
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
   "manipulation"
  ],
  "prompt": "Wat als iemand onder invloed staat van anderen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "brain"
  ],
  "prompt": "Wat zou je willen weten over je hersenen?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Geheugen",
    "prefer": [
     "brain",
     "facts"
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
   "identity"
  ],
  "prompt": "Waarover wil je lezen als iemand zichzelf beter leert kennen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "family"
  ],
  "prompt": "Wat voor verhalen over gezinnen vind je interessant?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
     "familyChanges"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een gedeeld verleden",
    "prefer": [
     "familyHistory"
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
   "siblings"
  ],
  "prompt": "Wat vind je leuk aan verhalen over broers en zussen?",
  "examples": "Welke past het beste bij je?",
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
   "familyChanges"
  ],
  "prompt": "Wat voor verandering thuis lijkt je interessant om over te lezen?",
  "examples": "Misschien zit hier iets tussen.",
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
     "familyChanges"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Iets uit het verleden",
    "prefer": [
     "familySecrets"
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
   "familyHistory"
  ],
  "prompt": "Wat wil je weten over verschillende generaties in een familie?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "family"
  ],
  "prompt": "Wat als een gezin iets moeilijks meemaakt?",
  "examples": "Welke past het beste bij je?",
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
   "parentChild"
  ],
  "prompt": "Wat vind je interessant aan de band tussen ouders en kinderen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "family"
  ],
  "prompt": "Wat voor gezin wil je in een verhaal tegenkomen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "familyHistory"
  ],
  "prompt": "Wat als iemand ontdekt waar die vandaan komt?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Familiegeschiedenis",
    "prefer": [
     "familyHistory"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Identiteit",
    "prefer": [
     "identity"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Verborgen informatie",
    "prefer": [
     "familySecrets"
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
   "family"
  ],
  "prompt": "Wat wil je lezen over opgroeien in een gezin?",
  "examples": "Misschien zit hier iets tussen.",
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
   "friendship"
  ],
  "prompt": "Wat vind je leuk aan verhalen over vrienden?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "friendshipNew"
  ],
  "prompt": "Hoe vind je het als mensen in een verhaal elkaar net leren kennen?",
  "examples": "Welke past het beste bij je?",
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
     "firstLove"
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
   "friendshipConflict"
  ],
  "prompt": "Wat als twee vrienden ruzie krijgen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "friendship"
  ],
  "prompt": "Wat vind je interessant aan een groep vrienden?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
     "groupPressure"
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
   "schoolLife"
  ],
  "prompt": "Wat vind je interessant aan een nieuwe school in een verhaal?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Nieuwe vrienden",
    "prefer": [
     "friendship",
     "schoolLife"
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
   "firstLove"
  ],
  "prompt": "Wat vind je leuk aan een verhaal over een eerste liefde?",
  "examples": "Misschien zit hier iets tussen.",
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
   "friendship"
  ],
  "prompt": "Wat als twee heel verschillende mensen vrienden worden?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "friendship"
  ],
  "prompt": "Wat maakt een verhaal over vrienden herkenbaar voor je?",
  "examples": "Welke past het beste bij je?",
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
   "outsider"
  ],
  "prompt": "Wat wil je lezen over iemand die zich alleen voelt?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Welke sport wil je in een boek terugzien?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Voetbal",
    "prefer": [
     "football"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Fitness",
    "prefer": [
     "fitness"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hardlopen",
    "prefer": [
     "running"
    ],
    "length": ""
   },
   {
    "id": "3",
    "label": "Vechtsport",
    "prefer": [
     "martialArts"
    ],
    "length": ""
   },
   {
    "id": "4",
    "label": "Een andere sport",
    "prefer": [
     "sport"
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
   "sportBiography"
  ],
  "prompt": "Wat zou je willen lezen over het leven van een sporter?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Training en doorzetten",
    "prefer": [
     "sportBiography",
     "sportTraining"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Wedstrijden",
    "prefer": [
     "sportBiography",
     "competition"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Het leven naast de sport",
    "prefer": [
     "sportBiography",
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
   "teamSport"
  ],
  "prompt": "Wat vind je interessant aan een sportteam?",
  "examples": "Misschien zit hier iets tussen.",
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
  ]
 },
 {
  "id": "extended-sport-4",
  "group": "sport",
  "stage": 2,
  "when": [
   "sportWatching"
  ],
  "prompt": "Wat vind je leuk aan het volgen van sport?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "De regels",
    "prefer": [
     "sportWatching",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "De tactiek",
    "prefer": [
     "sportWatching",
     "competition"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Clubs en supporters",
    "prefer": [
     "sportFans"
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
   "eliteSport"
  ],
  "prompt": "Wat als een sporter een groot doel heeft?",
  "examples": "Welke past het beste bij je?",
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
   "sportBiography"
  ],
  "prompt": "Over welke echte sporters zou je willen lezen?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "Bekende spelers",
    "prefer": [
     "sportBiography",
     "eliteSport"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Een team dat iets bereikt",
    "prefer": [
     "sportBiography",
     "teamSport"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Iemand die opnieuw begint",
    "prefer": [
     "sportBiography",
     "growth"
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
   "sportTraining"
  ],
  "prompt": "Wat zou je willen weten over trainen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "sportFans"
  ],
  "prompt": "Wat wil je weten over sport naast de wedstrijden?",
  "examples": "Welke past het beste bij je?",
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
     "sportWatching",
     "teamSport"
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
   "sportInjury"
  ],
  "prompt": "Wat als een sporter na een blessure terug probeert te komen?",
  "examples": "Misschien zit hier iets tussen.",
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
  ]
 },
 {
  "id": "extended-gaming-1",
  "group": "gaming",
  "stage": 2,
  "when": [
   "gaming"
  ],
  "prompt": "Wat voor games wil je in een boek terugzien?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Spellen met een verhaal",
    "prefer": [
     "gameStory"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Sportgames",
    "prefer": [
     "gameCompetition"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Spellen waarin je bouwt",
    "prefer": [
     "gameBuilding"
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
  "prompt": "Wat vind je leuk aan een gamewereld?",
  "examples": "Welke past het beste bij je?",
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
     "gameMultiplayer"
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
  "prompt": "Over welke onderwerpen uit games wil je ook lezen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "gameMultiplayer"
  ],
  "prompt": "Wat vind je leuk aan samen gamen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "gameBuilding"
  ],
  "prompt": "Wat zou je willen lezen over bouwen in games?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Gebouwen",
    "prefer": [
     "gameBuilding",
     "design"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Machines",
    "prefer": [
     "gameBuilding",
     "inventions"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Een eigen wereld",
    "prefer": [
     "gameBuilding",
     "fantasy"
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
   "gameStory"
  ],
  "prompt": "Wat vind je leuk aan gamepersonages?",
  "examples": "Misschien zit hier iets tussen.",
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
   "gameDevelopment"
  ],
  "prompt": "Wat wil je weten over hoe games gemaakt worden?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Programmeren",
    "prefer": [
     "gameDevelopment",
     "computing"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Ontwerp",
    "prefer": [
     "gameDevelopment",
     "design"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Verhalen maken",
    "prefer": [
     "gameDevelopment",
     "gameStory"
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
   "gameCompetition"
  ],
  "prompt": "Wat voor uitdaging in een game spreekt je aan?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat voor rustige gamewereld vind je leuk?",
  "examples": "Misschien zit hier iets tussen.",
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
     "gameBuilding"
    ],
    "length": ""
   }
  ],
  "requires": [
   "gaming",
   "calm"
  ]
 },
 {
  "id": "extended-fantasy-1",
  "group": "fantasy",
  "stage": 2,
  "when": [
   "fantasy"
  ],
  "prompt": "Wat vind je leuk aan verzonnen werelden?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
     "mythicalCreatures"
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
   "myths"
  ],
  "prompt": "Welke mythen of legendes vind je interessant?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Mythes",
    "prefer": [
     "myths"
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
  "prompt": "Wat als iemand ineens bijzondere krachten heeft?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat vind je leuk aan een verzonnen wereld met eigen regels?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "mythicalCreatures"
  ],
  "prompt": "Welke bijzondere wezens vind je leuk?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Draken",
    "prefer": [
     "mythicalCreatures"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Mythische dieren",
    "prefer": [
     "mythicalCreatures",
     "magic"
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
  "prompt": "Wat zou je willen ontdekken in een onbekende fantasiewereld?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat maakt een fantasieverhaal leuk voor je?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Wat vind je interessant aan magie?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat als iemand niet in de gewone wereld past?",
  "examples": "Misschien zit hier iets tussen.",
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
  ],
  "requires": [
   "fantasy",
   "outsider"
  ]
 },
 {
  "id": "extended-animals-1",
  "group": "animals",
  "stage": 2,
  "when": [
   "animals"
  ],
  "prompt": "Over welke dieren zou je willen lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Honden",
    "prefer": [
     "dogs"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Katten",
    "prefer": [
     "cats"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Paarden",
    "prefer": [
     "horses"
    ],
    "length": ""
   },
   {
    "id": "3",
    "label": "Wilde dieren",
    "prefer": [
     "wildlife"
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
   "pets"
  ],
  "prompt": "Wat vind je mooi aan de band tussen mens en dier?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Zorgen voor een dier",
    "prefer": [
     "animalCare"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Samen iets meemaken",
    "prefer": [
     "pets",
     "adventure"
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
   "animalBehavior"
  ],
  "prompt": "Wat zou je willen leren over dieren?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "Hoe dieren communiceren",
    "prefer": [
     "animalBehavior",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Hoe dieren leren",
    "prefer": [
     "animalBehavior"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Hoe dieren samenleven",
    "prefer": [
     "animalBehavior",
     "wildlife"
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
  "prompt": "Wat vind je leuk aan een verhaal dat zich buiten afspeelt?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "wildlife"
  ],
  "prompt": "Wat wil je weten over wilde dieren?",
  "examples": "Welke past het beste bij je?",
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
   "animalCare"
  ],
  "prompt": "Wat spreekt je aan aan werken met dieren?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "Een dierenverzorger",
    "prefer": [
     "animalCare",
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
  "prompt": "Wat zou je willen ontdekken in de natuur?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Wat vind je interessant aan buiten leven?",
  "examples": "Welke past het beste bij je?",
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
  ],
  "requires": [
   "nature",
   "survival"
  ]
 },
 {
  "id": "extended-animals-9",
  "group": "animals",
  "stage": 2,
  "when": [
   "nature"
  ],
  "prompt": "Wat zou je in een boek over natuur willen ontdekken?",
  "examples": "Misschien zit hier iets tussen.",
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
  ],
  "requires": [
   "nature",
   "facts"
  ]
 },
 {
  "id": "extended-history-1",
  "group": "history",
  "stage": 2,
  "when": [
   "history"
  ],
  "prompt": "Over welke tijd of gebeurtenis wil je lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Tweede Wereldoorlog",
    "prefer": [
     "worldWarTwo"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Middeleeuwen",
    "prefer": [
     "medievalHistory"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Oudheid",
    "prefer": [
     "ancientHistory"
    ],
    "length": ""
   },
   {
    "id": "3",
    "label": "Het dagelijks leven vroeger",
    "prefer": [
     "historicalDailyLife"
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
   "historicalDailyLife"
  ],
  "prompt": "Hoe denk je dat jongeren vroeger leefden?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat wil je weten over oorlog van vroeger?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat vind je interessant aan oude verhalen uit andere landen?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Cultuur",
    "prefer": [
     "cultures"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Mythes",
    "prefer": [
     "myths"
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
  ],
  "requires": [
   "history",
   "cultures"
  ]
 },
 {
  "id": "extended-history-5",
  "group": "history",
  "stage": 2,
  "when": [
   "history"
  ],
  "prompt": "Welk deel van de geschiedenis vind je interessant?",
  "examples": "Welke past het beste bij je?",
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
   "historicalDailyLife"
  ],
  "prompt": "Wat wil je weten over het leven van vroeger?",
  "examples": "Misschien zit hier iets tussen.",
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
   "historicalInventions"
  ],
  "prompt": "Welke oude uitvindingen vind je interessant?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Wat wil je weten over het ontstaan van een stad of land?",
  "examples": "Welke past het beste bij je?",
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
  ],
  "requires": [
   "history",
   "setting"
  ]
 },
 {
  "id": "extended-history-9",
  "group": "history",
  "stage": 2,
  "when": [
   "history"
  ],
  "prompt": "Wat voor echte verhalen uit het verleden wil je lezen?",
  "examples": "Misschien zit hier iets tussen.",
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
  ],
  "requires": [
   "history",
   "true"
  ]
 },
 {
  "id": "extended-science-1",
  "group": "science",
  "stage": 2,
  "when": [
   "science"
  ],
  "prompt": "Wat maakt je nieuwsgierig naar wetenschap?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "De ruimte",
    "prefer": [
     "space"
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
     "humanBody"
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
  "prompt": "Over welke techniek wil je meer weten?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Computers en robots",
    "prefer": [
     "computing",
     "robotics"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Ruimtevaart",
    "prefer": [
     "space"
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
  "prompt": "Hoe stel je je de toekomst voor?",
  "examples": "Misschien zit hier iets tussen.",
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
   "inventions"
  ],
  "prompt": "Wat vind je interessant aan uitvinders?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "space"
  ],
  "prompt": "Wat wil je weten over de ruimte?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Planeten en sterren",
    "prefer": [
     "astronomy"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Ruimtereizen",
    "prefer": [
     "astronauts"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Mogelijk leven elders",
    "prefer": [
     "space",
     "future"
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
   "humanBody"
  ],
  "prompt": "Wat wil je weten over het menselijk lichaam?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "Gezondheid",
    "prefer": [
     "health",
     "humanBody"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Het brein",
    "prefer": [
     "brain"
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
   "practicalTech"
  ],
  "prompt": "Wat vind je interessant aan bouwen of repareren?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Machines",
    "prefer": [
     "practicalTech"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Digitale dingen",
    "prefer": [
     "computing"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Creatieve dingen",
    "prefer": [
     "design"
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
  "prompt": "Wat vind je leuk aan verhalen waarin techniek belangrijk is?",
  "examples": "Welke past het beste bij je?",
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
  ],
  "requires": [
   "technology",
   "realistic"
  ]
 },
 {
  "id": "extended-science-9",
  "group": "science",
  "stage": 2,
  "when": [
   "robotics"
  ],
  "prompt": "Wat zou je willen weten over robots?",
  "examples": "Misschien zit hier iets tussen.",
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
   "adventure"
  ],
  "prompt": "Wat wil je ontdekken op een onbekende plek?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "early": true,
  "requires": [
   "adventure",
   "discovery"
  ]
 },
 {
  "id": "extended-adventure-2",
  "group": "adventure",
  "stage": 2,
  "when": [
   "adventure"
  ],
  "prompt": "Wat voor avontuur wil je lezen?",
  "examples": "Welke past het beste bij je?",
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
     "team",
     "adventure"
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
   "adventure"
  ],
  "prompt": "Wat als iemand iets nieuws probeert?",
  "examples": "Misschien zit hier iets tussen.",
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
  ],
  "requires": [
   "adventure",
   "challenge"
  ]
 },
 {
  "id": "extended-adventure-4",
  "group": "adventure",
  "stage": 2,
  "when": [
   "expeditions"
  ],
  "prompt": "Wat vind je interessant aan echte expedities?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "danger"
  ],
  "prompt": "Wat vind je spannend aan iemand die in gevaar komt?",
  "examples": "Welke past het beste bij je?",
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
  ],
  "requires": [
   "danger",
   "adventure"
  ]
 },
 {
  "id": "extended-adventure-6",
  "group": "adventure",
  "stage": 2,
  "when": [
   "adventure"
  ],
  "prompt": "Waar mag een avontuur zich afspelen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "travel"
  ],
  "prompt": "Wat spreekt je aan in een verhaal over een lange reis?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  ],
  "requires": [
   "travel",
   "adventure"
  ]
 },
 {
  "id": "extended-adventure-8",
  "group": "adventure",
  "stage": 2,
  "when": [
   "survival"
  ],
  "prompt": "Wat voor avontuur in de natuur lijkt je leuk?",
  "examples": "Welke past het beste bij je?",
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
  ],
  "requires": [
   "survival",
   "nature"
  ]
 },
 {
  "id": "extended-adventure-9",
  "group": "adventure",
  "stage": 2,
  "when": [
   "rescue"
  ],
  "prompt": "Wat vind je interessant aan een reddingsactie?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Van wat voor humor houd je?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
     "absurdHumor"
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
  "prompt": "Wat vind je grappig aan schoolverhalen?",
  "examples": "Welke past het beste bij je?",
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
  ],
  "requires": [
   "humor",
   "school"
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
  "examples": "Misschien zit hier iets tussen.",
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
  ],
  "requires": [
   "humor",
   "people"
  ]
 },
 {
  "id": "extended-humor-4",
  "group": "humor",
  "stage": 2,
  "when": [
   "humor"
  ],
  "prompt": "Wat voor humor wil je terugzien in een boek?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
     "absurdHumor"
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
  "prompt": "Wat als alles misgaat in een grappig verhaal?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Waar mag een grappig boek over gaan?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat vind je leuk aan grappige strips?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Tekeningen",
    "prefer": [
     "comics"
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
  ],
  "requires": [
   "humor",
   "comics"
  ]
 },
 {
  "id": "extended-humor-8",
  "group": "humor",
  "stage": 2,
  "when": [
   "humor"
  ],
  "prompt": "Wat voor herkenbare grappige verhalen vind je leuk?",
  "examples": "Welke past het beste bij je?",
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
  ],
  "requires": [
   "humor",
   "realistic"
  ]
 },
 {
  "id": "extended-humor-9",
  "group": "humor",
  "stage": 2,
  "when": [
   "humor"
  ],
  "prompt": "Waar mag humor mee gecombineerd worden?",
  "examples": "Misschien zit hier iets tussen.",
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
   "society"
  ],
  "prompt": "Over welk onderwerp uit het nieuws wil je lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "activism"
  ],
  "prompt": "Wat vind je interessant aan mensen die ergens voor opkomen?",
  "examples": "Welke past het beste bij je?",
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
   "discrimination"
  ],
  "prompt": "Wat wil je lezen over iemand die oneerlijk behandeld wordt?",
  "examples": "Misschien zit hier iets tussen.",
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
     "discrimination"
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
   "society"
  ],
  "prompt": "Wat vind je belangrijk in een verhaal over samenleven?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "outsider"
  ],
  "prompt": "Wat wil je lezen over iemand die moeilijk opgroeit?",
  "examples": "Welke past het beste bij je?",
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
   "activism"
  ],
  "prompt": "Wat als mensen iets willen veranderen in de maatschappij?",
  "examples": "Misschien zit hier iets tussen.",
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
   "society"
  ],
  "prompt": "Wat als mensen het ergens niet over eens zijn?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "bullying"
  ],
  "prompt": "Wat vind je belangrijk in verhalen over pesten?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Hoe iemand hulp krijgt",
    "prefer": [
     "bullying",
     "friendship"
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
   "society"
  ],
  "prompt": "Over welke andere ervaringen wil je meer weten?",
  "examples": "Misschien zit hier iets tussen.",
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
   "musicListening"
  ],
  "prompt": "Wat voor muziek vind je interessant om over te lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Rap",
    "prefer": [
     "rapMusic"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Songteksten",
    "prefer": [
     "songLyrics"
    ],
    "length": ""
   },
   {
    "id": "2",
    "label": "Andere muziek",
    "prefer": [
     "musicListening"
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
   "musicBiography"
  ],
  "prompt": "Wat zou je willen weten over een muzikant?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Hoe iemand muziek maakt",
    "prefer": [
     "musicMaking",
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
   "drawing",
   "design"
  ],
  "prompt": "Wat vind je leuk aan tekenen of ontwerpen?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Over welke vorm van kunst wil je lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Fotografie",
    "prefer": [
     "photography"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Tekenen",
    "prefer": [
     "drawing"
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
  "prompt": "Wat zou je over creativiteit willen lezen?",
  "examples": "Welke past het beste bij je?",
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
     "design"
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
  "prompt": "Wat zou je willen leren over zelf iets maken?",
  "examples": "Misschien zit hier iets tussen.",
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
   "songLyrics"
  ],
  "prompt": "Wat vind je interessant aan teksten van liedjes?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "filmmaking"
  ],
  "prompt": "Wat vind je leuk aan het maken van films of beelden?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Techniek",
    "prefer": [
     "filmmaking",
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
     "design"
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
  "prompt": "Wat voor verhaal over een creatief persoon wil je lezen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "growth"
  ],
  "prompt": "Waarover wil je lezen als het om opgroeien gaat?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "growth"
  ],
  "prompt": "Wat als iemand opnieuw begint?",
  "examples": "Welke past het beste bij je?",
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
   "empathy"
  ],
  "prompt": "Wat vind je belangrijk in een verhaal over moeilijke ervaringen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "health"
  ],
  "prompt": "Wat wil je weten over gezondheid?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Het lichaam",
    "prefer": [
     "humanBody"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Mentale gezondheid",
    "prefer": [
     "mentalHealth"
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
   "empathy"
  ],
  "prompt": "Over welke ervaringen van anderen wil je lezen?",
  "examples": "Welke past het beste bij je?",
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
   "identity"
  ],
  "prompt": "Wat vind je interessant aan jezelf leren kennen?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "Identiteit",
    "prefer": [
     "identity"
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
   "empathy"
  ],
  "prompt": "Wat als iemand in een verhaal hulp krijgt?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  ],
  "requires": [
   "empathy",
   "friendship"
  ]
 },
 {
  "id": "extended-life-8",
  "group": "life",
  "stage": 2,
  "when": [
   "empathy"
  ],
  "prompt": "Wat zou je willen begrijpen over gevoelens?",
  "examples": "Welke past het beste bij je?",
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
     "grief"
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
  ],
  "requires": [
   "empathy",
   "psychology"
  ]
 },
 {
  "id": "extended-life-9",
  "group": "life",
  "stage": 2,
  "when": [
   "growth",
   "empathy"
  ],
  "prompt": "Wat vind je interessant aan verhalen over tegenslagen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "facts"
  ],
  "prompt": "Over welk onderwerp wil je iets leren?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "facts"
  ],
  "prompt": "Waarover wil je meer weten?",
  "examples": "Welke past het beste bij je?",
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
   "biography"
  ],
  "prompt": "Wat wil je lezen over iemands leven?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "Hoe iemand opgroeit",
    "prefer": [
     "biography",
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
   "true"
  ],
  "prompt": "Over wat voor echte gebeurtenissen wil je lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  ],
  "requires": [
   "true",
   "facts"
  ]
 },
 {
  "id": "extended-facts-5",
  "group": "facts",
  "stage": 2,
  "when": [
   "facts"
  ],
  "prompt": "Wat voor ontdekkingen vind je interessant?",
  "examples": "Welke past het beste bij je?",
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
   "facts"
  ],
  "prompt": "Over welk echt onderwerp wil je lezen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "true"
  ],
  "prompt": "Wat vind je leuk aan waargebeurde verhalen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "facts"
  ],
  "prompt": "Over welk onderwerp zou je uit jezelf een boek pakken?",
  "examples": "Welke past het beste bij je?",
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
   "facts"
  ],
  "prompt": "Wat zou je graag beter begrijpen?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat wil je weten over geld verdienen?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Een bedrijf beginnen",
    "prefer": [
     "entrepreneurship"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Werk en kansen",
    "prefer": [
     "careers"
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
   "personalFinance"
  ],
  "prompt": "Wat zou je willen leren over sparen en uitgeven?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Hoe geld werkt",
    "prefer": [
     "personalFinance",
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
     "entrepreneurship"
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
   "entrepreneurship"
  ],
  "prompt": "Wat vind je interessant aan iemand die een bedrijf begint?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat wil je lezen over rijkdom of armoede?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  ],
  "requires": [
   "economics",
   "justice"
  ]
 },
 {
  "id": "extended-economics-5",
  "group": "economics",
  "stage": 2,
  "when": [
   "economics"
  ],
  "prompt": "Wat wil je weten over handel van vroeger?",
  "examples": "Welke past het beste bij je?",
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
  ],
  "requires": [
   "economics",
   "history"
  ]
 },
 {
  "id": "extended-economics-6",
  "group": "economics",
  "stage": 2,
  "when": [
   "careers"
  ],
  "prompt": "Over welke kant van werk wil je lezen?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "Een beroep leren",
    "prefer": [
     "careers",
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
     "entrepreneurship"
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
   "personalFinance"
  ],
  "prompt": "Wat als iemand veel geld verliest?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "entrepreneurship"
  ],
  "prompt": "Wat vind je interessant aan een verhaal over succes?",
  "examples": "Welke past het beste bij je?",
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
  ],
  "requires": [
   "entrepreneurship",
   "growth"
  ]
 },
 {
  "id": "extended-economics-9",
  "group": "economics",
  "stage": 2,
  "when": [
   "advertising"
  ],
  "prompt": "Wat zou je willen weten over reclame?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Over welk onderwerp van de aarde wil je lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Klimaat",
    "prefer": [
     "climate"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Dieren",
    "prefer": [
     "wildlife"
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
   "climate"
  ],
  "prompt": "Wat zou je willen weten over klimaatverandering?",
  "examples": "Welke past het beste bij je?",
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
   "conservation"
  ],
  "prompt": "Wat vind je interessant aan natuur beschermen?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "Dieren helpen",
    "prefer": [
     "conservation",
     "wildlife"
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
  "prompt": "Wat wil je weten over de toekomst van de aarde?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "disasters"
  ],
  "prompt": "Wat wil je lezen over natuurrampen?",
  "examples": "Welke past het beste bij je?",
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
   "energy"
  ],
  "prompt": "Wat wil je weten over energie?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "Hoe energie werkt",
    "prefer": [
     "energy",
     "facts"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Nieuwe uitvindingen",
    "prefer": [
     "inventions"
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
   "climate"
  ],
  "prompt": "Wat vind je interessant aan het leven in andere klimaten?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "ocean"
  ],
  "prompt": "Wat wil je ontdekken over oceanen?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Dieren",
    "prefer": [
     "ocean",
     "wildlife"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Onderzoek",
    "prefer": [
     "ocean",
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
  "prompt": "Wat voor oplossingen voor milieuproblemen vind je interessant?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat voor enge verhalen lees je graag?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Wat vind je spannend aan verhalen over angst?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat als er iets vreemds gebeurt?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat vind je eng aan een onbekende plek?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Wat maakt een griezelverhaal spannend?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat als je niemand in een spannend verhaal kunt vertrouwen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "ghostStories"
  ],
  "prompt": "Wat vind je interessant aan spookverhalen?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Oude verhalen",
    "prefer": [
     "myths",
     "ghostStories"
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
  "prompt": "Hoe eng mag een verhaal voor je worden?",
  "examples": "Welke past het beste bij je?",
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
   "danger"
  ],
  "prompt": "Wat voor spanning vind je leuk zonder griezels?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat vind je interessant aan verhalen over jongeren?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Wat voor herkenbare verhalen lees je graag?",
  "examples": "Welke past het beste bij je?",
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
   "schoolLife"
  ],
  "prompt": "Wat wil je lezen als een verhaal op school speelt?",
  "examples": "Misschien zit hier iets tussen.",
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
   "schoolLife"
  ],
  "prompt": "Wat als iemand in een nieuwe klas komt?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Wat vind je interessant aan onderwerpen op school?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Groepsdruk",
    "prefer": [
     "groupPressure"
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
     "careers",
     "choices"
    ],
    "length": ""
   }
  ],
  "requires": [
   "school",
   "psychology"
  ]
 },
 {
  "id": "extended-school-6",
  "group": "school",
  "stage": 2,
  "when": [
   "school"
  ],
  "prompt": "Wat als iemand zijn eigen keuzes probeert te maken?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat wil je lezen over jongeren die anders zijn?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Wat als leerlingen samen iets moeten doen?",
  "examples": "Welke past het beste bij je?",
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
  ],
  "requires": [
   "school",
   "team"
  ]
 },
 {
  "id": "extended-school-9",
  "group": "school",
  "stage": 2,
  "when": [
   "school"
  ],
  "prompt": "Wat voor grappige situaties herken je graag in een verhaal?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Over welke plekken zou je willen lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Andere culturen",
    "prefer": [
     "cultures"
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
  "prompt": "Wat vind je interessant aan iemand die naar een ander land gaat?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat vind je leuk aan verhalen over onderweg zijn?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat voor reisverhalen wil je lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "cultures"
  ],
  "prompt": "Wat wil je weten over andere culturen?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Cultuur",
    "prefer": [
     "cultures"
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
  "prompt": "Wat zou je willen ontdekken over oude steden?",
  "examples": "Misschien zit hier iets tussen.",
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
  ],
  "requires": [
   "travel",
   "history"
  ]
 },
 {
  "id": "extended-travel-7",
  "group": "travel",
  "stage": 2,
  "when": [
   "travel"
  ],
  "prompt": "Wat voor uitdagingen op reis vind je interessant?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "migration"
  ],
  "prompt": "Wat als iemand naar een ander land verhuist?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Over welke plekken wil je iets leren?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "De ruimte",
    "prefer": [
     "space"
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
   "choices"
  ],
  "prompt": "Wat voor keuzes van personages vind je interessant?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "challenge"
  ],
  "prompt": "Wat als iemand een groot doel heeft?",
  "examples": "Welke past het beste bij je?",
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
   "choices"
  ],
  "prompt": "Wat wil je weten als iemand een moeilijke keuze moet maken?",
  "examples": "Misschien zit hier iets tussen.",
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
   "challenge"
  ],
  "prompt": "Wat voor uitdaging zou je willen lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "choices"
  ],
  "prompt": "Wat als iemand in een verhaal een fout maakt?",
  "examples": "Welke past het beste bij je?",
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
   "challenge"
  ],
  "prompt": "Wat vind je interessant aan moedige mensen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "growth"
  ],
  "prompt": "Wat vind je leuk aan iemand die iets nieuws leert?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "choices"
  ],
  "prompt": "Wat wil je weten over de gevolgen van een keuze?",
  "examples": "Welke past het beste bij je?",
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
   "choices"
  ],
  "prompt": "Wat als mensen samen of alleen een keuze moeten maken?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat vind je leuk aan liefdesverhalen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Wat voor relaties vind je interessant in een verhaal?",
  "examples": "Welke past het beste bij je?",
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
   "firstLove"
  ],
  "prompt": "Wat als iemand voor het eerst verliefd wordt?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat maakt een liefdesverhaal herkenbaar voor je?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Wat mag er naast liefde in een verhaal zitten?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat als een relatie verandert?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat vind je interessant aan vriendschap en liefde samen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  ],
  "requires": [
   "relationships",
   "friendship"
  ]
 },
 {
  "id": "extended-romance-8",
  "group": "romance",
  "stage": 2,
  "when": [
   "relationships"
  ],
  "prompt": "Wat als twee mensen elkaar niet goed begrijpen?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat als twee mensen elkaar na lange tijd weer zien?",
  "examples": "Misschien zit hier iets tussen.",
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
   "facts"
  ],
  "prompt": "Hoe leer je het liefst iets nieuws uit een boek?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "true"
  ],
  "prompt": "Wat vind je belangrijk in een waargebeurd verhaal?",
  "examples": "Welke past het beste bij je?",
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
   "biography"
  ],
  "prompt": "Over wat voor echte persoon wil je lezen?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "Een levensverhaal",
    "prefer": [
     "biography"
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
   "realistic"
  ],
  "prompt": "Wat vind je leuk aan realistische verhalen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "facts"
  ],
  "prompt": "Hoe leer je het liefst uit een boek?",
  "examples": "Welke past het beste bij je?",
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
   "true"
  ],
  "prompt": "Wat wil je weten over een echte gebeurtenis?",
  "examples": "Misschien zit hier iets tussen.",
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
   "true"
  ],
  "prompt": "Mag een boek over een echt onderwerp ook verzonnen zijn?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "realistic"
  ],
  "prompt": "Wat vind je interessant aan een verhaal dat nu speelt?",
  "examples": "Welke past het beste bij je?",
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
   "facts"
  ],
  "prompt": "Wat voor boek pak je om iets nieuws te leren?",
  "examples": "Misschien zit hier iets tussen.",
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
     "biography"
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
   "fast",
   "slow",
   "danger"
  ],
  "prompt": "Wanneer wil je verder lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "calm"
  ],
  "prompt": "Wat lees je graag als je wilt ontspannen?",
  "examples": "Welke past het beste bij je?",
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
   "calm",
   "danger",
   "humor"
  ],
  "prompt": "Waar heb je vandaag zin in?",
  "examples": "Misschien zit hier iets tussen.",
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
   "slow",
   "calm"
  ],
  "prompt": "Wat vind je fijn aan een rustig begin?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "fast",
   "action"
  ],
  "prompt": "Wat vind je leuk aan een onverwacht begin?",
  "examples": "Welke past het beste bij je?",
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
   "slow"
  ],
  "prompt": "Wat helpt je om een verhaal te blijven volgen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "calm",
   "danger",
   "humor"
  ],
  "prompt": "Welke sfeer en welk onderwerp passen bij je?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "calm",
   "empathy"
  ],
  "prompt": "Wat wil je vooral uit een boek halen?",
  "examples": "Welke past het beste bij je?",
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
  "when": [],
  "prompt": "Wat lees je graag als je weinig tijd hebt?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Waar wil je uit jezelf meer over weten?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Over welk onderwerp zou je graag een boek lezen?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat voor onderwerpen uit filmpjes wil je ook in boeken?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat voor belevenis wil je in een boek volgen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Over welke onderwerpen wil je meer lezen?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat maakt je op dit moment nieuwsgierig?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Waarover zou je graag een verhaal horen of lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Wat wil je buiten school graag leren uit een boek?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Welk onderwerp zou je zelf in de bibliotheek kiezen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "society"
  ],
  "prompt": "Welke verandering in de wereld vind je interessant?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "society"
  ],
  "prompt": "Wat wil je weten over het leven in een buurt of stad?",
  "examples": "Welke past het beste bij je?",
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
     "cultures"
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
   "activism"
  ],
  "prompt": "Wat vind je interessant aan mensen die anderen helpen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "politics"
  ],
  "prompt": "Wat wil je weten over politiek of de maatschappij?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "society"
  ],
  "prompt": "Wat als mensen samen een groot probleem moeten oplossen?",
  "examples": "Welke past het beste bij je?",
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
   "activism"
  ],
  "prompt": "Wat vind je interessant aan jongeren die iets willen veranderen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "cultures"
  ],
  "prompt": "Wat wil je weten over verschillende culturen?",
  "examples": "Denk bijvoorbeeld hieraan.",
  "options": [
   {
    "id": "0",
    "label": "Talen en gewoonten",
    "prefer": [
     "cultures"
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
   "journalism"
  ],
  "prompt": "Wat vind je interessant aan het maken van nieuws?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Feiten controleren",
    "prefer": [
     "journalism",
     "puzzles"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Mensen achter nieuws",
    "prefer": [
     "journalism",
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
   "careers"
  ],
  "prompt": "Over welke beroepen wil je lezen?",
  "examples": "Misschien zit hier iets tussen.",
  "options": [
   {
    "id": "0",
    "label": "Een beroep ontdekken",
    "prefer": [
     "careers",
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
  "stage": 3,
  "when": [],
  "prompt": "Wat zou je graag terugzien in een boek na een leuke serie?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "stage": 3,
  "when": [],
  "prompt": "Wat vond je leuk aan een film dat je ook in een boek wilt?",
  "examples": "Welke past het beste bij je?",
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
  "stage": 3,
  "when": [],
  "prompt": "Over welke filmthema's wil je lezen?",
  "examples": "Misschien zit hier iets tussen.",
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
   "gaming"
  ],
  "prompt": "Wat vind je leuk aan een gamewereld dat je ook wilt lezen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "filmmaking"
  ],
  "prompt": "Wat wil je weten over het maken van films?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Hoe ze iets ontwerpen",
    "prefer": [
     "design"
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
  "stage": 3,
  "when": [],
  "prompt": "Wat zou je uit een filmpje ook in een boek willen terugzien?",
  "examples": "Misschien zit hier iets tussen.",
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
  "stage": 3,
  "when": [],
  "prompt": "Wat uit een film, serie of game wil je in een boek terugzien?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
   "filmmaking"
  ],
  "prompt": "Wat vind je interessant aan animatie maken?",
  "examples": "Welke past het beste bij je?",
  "options": [
   {
    "id": "0",
    "label": "Beeld en ontwerp",
    "prefer": [
     "design"
    ],
    "length": ""
   },
   {
    "id": "1",
    "label": "Techniek",
    "prefer": [
     "filmmaking",
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
  ],
  "requires": [
   "filmmaking",
   "design"
  ]
 },
 {
  "id": "extended-media-9",
  "group": "media",
  "stage": 3,
  "when": [],
  "prompt": "Wat zou je willen lezen als je een boekverfilming leuk vindt?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Zijn er onderwerpen waar je liever niets over leest?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Welke andere interesse wil je in een boek terugzien?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat maakt dat je stopt met lezen?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat vind je het belangrijkst bij het kiezen van een boek?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Wat wil je terugzien uit een boek dat je eerder leuk vond?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Waar heb je vandaag zin in tijdens het lezen?",
  "examples": "Misschien zit hier iets tussen.",
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
  "prompt": "Wat voor boek wil je eens proberen?",
  "examples": "Denk bijvoorbeeld hieraan.",
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
  "prompt": "Waar zou je na het lezen over willen praten?",
  "examples": "Welke past het beste bij je?",
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
  "prompt": "Wat maakt een boek voor jou de moeite waard?",
  "examples": "Misschien zit hier iets tussen.",
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
