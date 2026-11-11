'use strict';
// Exact shared catalogue theme rules. Keep one source of truth for server and book advisor.
function parseMultiValueField(value) {
  if (!value && value !== 0) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')).trim())
      .filter(Boolean);
  }
  return String(value)
    .split(/[,;/\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}


const CANONICAL_THEMES = [
  'Avontuur',
  'Psychische gezondheid',
  'Verslaving',
  'Media & Invloed',
  'Ziekte & verlies',
  'Pesten',
  'Adoptie & afkomst',
  'Macht & hiërarchie',
  'Isolatie',
  'Overleven',
  'Diversiteit',
  'Familie',
  'Fantasy',
  'Geschiedenis',
  'Humor',
  'Identiteit',
  'Maatschappij',
  'Mythologie',
  'Mysterie',
  'Natuur',
  'Poëzie',
  'Romantiek',
  'School & Opgroeien',
  'Spanning',
  'Sport',
  'Vriendschap',
  'Wetenschap',
];

const SUPPRESSED_THEME_TAGS = new Set([
  'fiction',
  'juvenile fiction',
  'juvenile literature',
  'children',
  'child',
  'children’s stories',
  "children's stories",
  'stories',
  'dutch fiction',
  'dutch literature',
  'dutch language',
  'authors, dutch',
  'author, dutch',
  'popular literature',
  'boys',
  'girls',
  'breast',
  'english language',
  'nederlands',
  'english',
  'novels',
  'romans',
  'verhalen',
  'jeugdboeken',
  'jeugdboeken ; verhalen',
  'romans en novellen',
  'romans en novellen ; oorspr. nederlands',
  'fiction, general',
  'general',
  'youth',
  'young adult fiction',
  'easy reading',
  'easy readers',
  'makkelijk lezen',
]);

const SUPPRESSED_THEME_TAG_PATTERNS = [
  'language',
  'authors',
  'literature',
  'fiction',
  'stories',
  'novels',
  'oorspr.',
  'dutch',
  'english language',
];

const EASY_READING_TAGS = new Set(['easy reading', 'easy readers', 'makkelijk lezen']);

const EXACT_THEME_MAP = new Map([
  ['adventure', 'Avontuur'],
  ['avontuur', 'Avontuur'],
  ['adventure stories', 'Avontuur'],
  ['avonturen', 'Avontuur'],
  ['avonturenverhalen', 'Avontuur'],
  ['expedition', 'Avontuur'],
  ['expeditions', 'Avontuur'],
  ['quest', 'Avontuur'],
  ['quests', 'Avontuur'],
  ['treasure hunt', 'Avontuur'],
  ['camping', 'Avontuur'],
  ['camps', 'Avontuur'],
  ['reizen', 'Avontuur'],
  ['reisverhalen', 'Avontuur'],
  ['mental health', 'Psychische gezondheid'],
  ['anxiety', 'Psychische gezondheid'],
  ['depression', 'Psychische gezondheid'],
  ['psychosis', 'Psychische gezondheid'],
  ['self-harm', 'Psychische gezondheid'],
  ['panic', 'Psychische gezondheid'],
  ['panic attacks', 'Psychische gezondheid'],
  ['trauma', 'Psychische gezondheid'],
  ['suicidal thoughts', 'Psychische gezondheid'],
  ['psychiatric illness', 'Psychische gezondheid'],
  ['psychological problems', 'Psychische gezondheid'],
  ['eenzaamheid', 'Psychische gezondheid'],
  ['waan', 'Psychische gezondheid'],
  ['waanbeelden', 'Psychische gezondheid'],
  ['realiteit en waan', 'Psychische gezondheid'],
  ['addiction', 'Verslaving'],
  ['verslaving', 'Verslaving'],
  ['game addiction', 'Verslaving'],
  ['gaming addiction', 'Verslaving'],
  ['drugs', 'Verslaving'],
  ['alcohol abuse', 'Verslaving'],
  ['middelengebruik', 'Verslaving'],
  ['afhankelijkheid', 'Verslaving'],
  ['obsessief gamen', 'Verslaving'],
  ['reality tv', 'Media & Invloed'],
  ['media pressure', 'Media & Invloed'],
  ['television culture', 'Media & Invloed'],
  ['influence culture', 'Media & Invloed'],
  ['uiterlijkheidscultuur', 'Media & Invloed'],
  ['celebrity culture', 'Media & Invloed'],
  ['public image', 'Media & Invloed'],
  ['social media pressure', 'Media & Invloed'],
  ['fame pressure', 'Media & Invloed'],
  ['terminal illness', 'Ziekte & verlies'],
  ['severe illness', 'Ziekte & verlies'],
  ['cystic fibrosis', 'Ziekte & verlies'],
  ['taaislijmziekte', 'Ziekte & verlies'],
  ['dying', 'Ziekte & verlies'],
  ['grief', 'Ziekte & verlies'],
  ['mourning', 'Ziekte & verlies'],
  ['verlies', 'Ziekte & verlies'],
  ['rouw', 'Ziekte & verlies'],
  ['sterven', 'Ziekte & verlies'],
  ['ziekte', 'Ziekte & verlies'],
  ['bullying', 'Pesten'],
  ['pesten', 'Pesten'],
  ['treiteren', 'Pesten'],
  ['buitensluiten', 'Pesten'],
  ['social exclusion at school', 'Pesten'],
  ['school harassment', 'Pesten'],
  ['adoption', 'Adoptie & afkomst'],
  ['adopted', 'Adoptie & afkomst'],
  ['biologische ouders', 'Adoptie & afkomst'],
  ['afkomst zoeken', 'Adoptie & afkomst'],
  ['roots search', 'Adoptie & afkomst'],
  ['afstamming', 'Adoptie & afkomst'],
  ['vader onbekend', 'Adoptie & afkomst'],
  ['mother unknown', 'Adoptie & afkomst'],
  ['family origin search', 'Adoptie & afkomst'],
  ['hierarchy', 'Macht & hiërarchie'],
  ['dominance', 'Macht & hiërarchie'],
  ['machtsverhoudingen', 'Macht & hiërarchie'],
  ['status struggle', 'Macht & hiërarchie'],
  ['power structure', 'Macht & hiërarchie'],
  ['authority struggle', 'Macht & hiërarchie'],
  ['oppressieve verhoudingen', 'Macht & hiërarchie'],
  ['isolation', 'Isolatie'],
  ['isolated', 'Isolatie'],
  ['alone at sea', 'Isolatie'],
  ['afgesloten', 'Isolatie'],
  ['opgesloten', 'Isolatie'],
  ['afgezonderd', 'Isolatie'],
  ['remote setting', 'Isolatie'],
  ['sociaal isolement', 'Isolatie'],
  ['survival', 'Overleven'],
  ['survive', 'Overleven'],
  ['overleven', 'Overleven'],
  ['wilderness survival', 'Overleven'],
  ['vlucht', 'Overleven'],
  ['ontsnappen en overleven', 'Overleven'],
  ['extreme conditions', 'Overleven'],
  ['diversity', 'Diversiteit'],
  ['diversiteit', 'Diversiteit'],
  ['multiculturalism', 'Diversiteit'],
  ['multiculturaliteit', 'Diversiteit'],
  ['disability', 'Diversiteit'],
  ['disabilities', 'Diversiteit'],
  ['handicap', 'Diversiteit'],
  ['beperking', 'Diversiteit'],
  ['disabilities in children', 'Diversiteit'],
  ['inclusion', 'Diversiteit'],
  ['inclusie', 'Diversiteit'],
  ['lhbti', 'Diversiteit'],
  ['lgbt', 'Diversiteit'],
  ['lgbtq', 'Diversiteit'],
  ['queer representation', 'Diversiteit'],
  ['family', 'Familie'],
  ['familie', 'Familie'],
  ['fathers and sons', 'Familie'],
  ['mothers and daughters', 'Familie'],
  ['parent and child', 'Familie'],
  ['ouders en kinderen', 'Familie'],
  ['siblings', 'Familie'],
  ['broers en zussen', 'Familie'],
  ['gezin', 'Familie'],
  ['family life', 'Familie'],
  ['fantasy', 'Fantasy'],
  ['fantasy fiction', 'Fantasy'],
  ['magic', 'Fantasy'],
  ['magie', 'Fantasy'],
  ['wizards', 'Fantasy'],
  ['wizard', 'Fantasy'],
  ['heksen', 'Fantasy'],
  ['witches', 'Fantasy'],
  ['dragons', 'Fantasy'],
  ['dragon', 'Fantasy'],
  ['elves', 'Fantasy'],
  ['elf', 'Fantasy'],
  ['magicians', 'Fantasy'],
  ['tovenaars', 'Fantasy'],
  ['magic realism', 'Fantasy'],
  ['magic realism (literature)', 'Fantasy'],
  ['history', 'Geschiedenis'],
  ['geschiedenis', 'Geschiedenis'],
  ['historical fiction', 'Geschiedenis'],
  ['historical novels', 'Geschiedenis'],
  ['second world war', 'Geschiedenis'],
  ['world war, 1939-1945', 'Geschiedenis'],
  ['world war ii', 'Geschiedenis'],
  ['holocaust', 'Geschiedenis'],
  ['oorlog', 'Geschiedenis'],
  ['oorlogsverhalen', 'Geschiedenis'],
  ['verzet', 'Geschiedenis'],
  ['ancient history', 'Geschiedenis'],
  ['middeleeuwen', 'Geschiedenis'],
  ['humor', 'Humor'],
  ['funny stories', 'Humor'],
  ['comedy', 'Humor'],
  ['komedie', 'Humor'],
  ['grappig', 'Humor'],
  ['satire', 'Humor'],
  ['identity', 'Identiteit'],
  ['identiteit', 'Identiteit'],
  ['self-esteem', 'Identiteit'],
  ['zelfbeeld', 'Identiteit'],
  ['body image', 'Identiteit'],
  ['zelfacceptatie', 'Identiteit'],
  ['coming out', 'Identiteit'],
  ['sexuality', 'Identiteit'],
  ['sexual identity', 'Identiteit'],
  ['gender identity', 'Identiteit'],
  ['identiteit en zelfbeeld', 'Identiteit'],
  ['society', 'Maatschappij'],
  ['maatschappij', 'Maatschappij'],
  ['social issues', 'Maatschappij'],
  ['sociale problemen', 'Maatschappij'],
  ['exploitation', 'Maatschappij'],
  ['uitbuiting', 'Maatschappij'],
  ['prostitution', 'Maatschappij'],
  ['prostitutie', 'Maatschappij'],
  ['poverty', 'Maatschappij'],
  ['armoede', 'Maatschappij'],
  ['racism', 'Maatschappij'],
  ['racisme', 'Maatschappij'],
  ['discrimination', 'Maatschappij'],
  ['discriminatie', 'Maatschappij'],
  ['refugees', 'Maatschappij'],
  ['vluchtelingen', 'Maatschappij'],
  ['cults', 'Maatschappij'],
  ['sekten', 'Maatschappij'],
  ['social justice', 'Maatschappij'],
  ['mythology', 'Mythologie'],
  ['mythologie', 'Mythologie'],
  ['greek mythology', 'Mythologie'],
  ['griekse mythologie', 'Mythologie'],
  ['greek gods', 'Mythologie'],
  ['griekse goden', 'Mythologie'],
  ['hades', 'Mythologie'],
  ['zeus', 'Mythologie'],
  ['poseidon', 'Mythologie'],
  ['athena', 'Mythologie'],
  ['apollo', 'Mythologie'],
  ['mythological fiction', 'Mythologie'],
  ['mystery', 'Mysterie'],
  ['mysterie', 'Mysterie'],
  ['detective', 'Mysterie'],
  ['detectives', 'Mysterie'],
  ['detective stories', 'Mysterie'],
  ['investigation', 'Mysterie'],
  ['investigations', 'Mysterie'],
  ['whodunit', 'Mysterie'],
  ['disappearance', 'Mysterie'],
  ['verdwenen', 'Mysterie'],
  ['geheimen', 'Mysterie'],
  ['secrets', 'Mysterie'],
  ['puzzels', 'Mysterie'],
  ['raadsels', 'Mysterie'],
  ['nature', 'Natuur'],
  ['natuur', 'Natuur'],
  ['animals', 'Natuur'],
  ['dieren', 'Natuur'],
  ['wildlife', 'Natuur'],
  ['ecology', 'Natuur'],
  ['milieu', 'Natuur'],
  ['environment', 'Natuur'],
  ['natuurverhalen', 'Natuur'],
  ['plants', 'Natuur'],
  ['forests', 'Natuur'],
  ['ocean', 'Natuur'],
  ['poetry', 'Poëzie'],
  ['poëzie', 'Poëzie'],
  ['poems', 'Poëzie'],
  ['gedichten', 'Poëzie'],
  ['verse', 'Poëzie'],
  ['romance', 'Romantiek'],
  ['romantiek', 'Romantiek'],
  ['love', 'Romantiek'],
  ['liefde', 'Romantiek'],
  ['verliefdheid', 'Romantiek'],
  ['dating', 'Romantiek'],
  ['relationships', 'Romantiek'],
  ['liefdesverhalen', 'Romantiek'],
  ['adolescence', 'School & Opgroeien'],
  ['adolescentie', 'School & Opgroeien'],
  ['teenagers', 'School & Opgroeien'],
  ['tieners', 'School & Opgroeien'],
  ['puberty', 'School & Opgroeien'],
  ['puberteit', 'School & Opgroeien'],
  ['high schools', 'School & Opgroeien'],
  ['middelbare school', 'School & Opgroeien'],
  ['school life', 'School & Opgroeien'],
  ['coming of age', 'School & Opgroeien'],
  ['coming-of-age', 'School & Opgroeien'],
  ['opgroeien', 'School & Opgroeien'],
  ['youth problems', 'School & Opgroeien'],
  ['suspense', 'Spanning'],
  ['spanning', 'Spanning'],
  ['thriller', 'Spanning'],
  ['thrillers', 'Spanning'],
  ['horror', 'Spanning'],
  ['ghosts', 'Spanning'],
  ['spoken', 'Spanning'],
  ['haunted', 'Spanning'],
  ['vampires', 'Spanning'],
  ['vampire', 'Spanning'],
  ['dracula', 'Spanning'],
  ['monsters', 'Spanning'],
  ['danger', 'Spanning'],
  ['gevaar', 'Spanning'],
  ['murder', 'Spanning'],
  ['crime', 'Spanning'],
  ['sport', 'Sport'],
  ['sports', 'Sport'],
  ['sports & recreation', 'Sport'],
  ['recreation', 'Sport'],
  ['voetbal', 'Sport'],
  ['football', 'Sport'],
  ['soccer', 'Sport'],
  ['hockey', 'Sport'],
  ['tennis', 'Sport'],
  ['judo', 'Sport'],
  ['athletics', 'Sport'],
  ['friendship', 'Vriendschap'],
  ['vriendschap', 'Vriendschap'],
  ['friends', 'Vriendschap'],
  ['vrienden', 'Vriendschap'],
  ['companionship', 'Vriendschap'],
  ['interpersonal relations in adolescence', 'Vriendschap'],
  ['companionship in children', 'Vriendschap'],
  ['science', 'Wetenschap'],
  ['wetenschap', 'Wetenschap'],
  ['technology', 'Wetenschap'],
  ['technologie', 'Wetenschap'],
  ['robots', 'Wetenschap'],
  ['robot', 'Wetenschap'],
  ['invention', 'Wetenschap'],
  ['inventions', 'Wetenschap'],
  ['uitvindingen', 'Wetenschap'],
  ['space', 'Wetenschap'],
  ['ruimte', 'Wetenschap'],
  ['astronomy', 'Wetenschap'],
  ['sterrenkunde', 'Wetenschap'],
  ['biology', 'Wetenschap'],
  ['biologie', 'Wetenschap'],
  ['chemistry', 'Wetenschap'],
  ['scheikunde', 'Wetenschap'],
  ['physics', 'Wetenschap'],
  ['natuurkunde', 'Wetenschap'],
  ['climate change', 'Wetenschap'],
  ['klimaatverandering', 'Wetenschap'],
]);

const STRONG_CONTAINS_THEME_RULES = [
  { theme: 'Psychische gezondheid', patterns: ['mental health', 'anxiety', 'depression', 'psychosis', 'self-harm', /\bpanics?\b/, 'trauma', 'suicid', 'psychiatr', 'psycholog', 'eenzaam', 'waan', 'realiteit en waan'] },
  { theme: 'Verslaving', patterns: ['addiction', 'verslaving', 'alcohol abuse', 'middelengebruik', 'afhankelijk', 'obsessief gamen', 'drug', 'gaming addiction', 'game addiction'] },
  { theme: 'Media & Invloed', patterns: ['reality tv', 'media pressure', 'television culture', 'influence culture', 'uiterlijkheidscultuur', 'celebrity culture', 'public image', 'social media pressure', 'fame pressure'] },
  { theme: 'Ziekte & verlies', patterns: ['terminal illness', 'severe illness', 'cystic fibrosis', 'taaislijmziekte', 'dying', 'grief', 'mourning', 'verlies', 'rouw', 'sterven', 'ziekte'] },
  { theme: 'Pesten', patterns: ['bullying', 'pesten', 'treiteren', 'buitensluiten', 'social exclusion at school', 'school harassment'] },
  { theme: 'Adoptie & afkomst', patterns: ['adoption', 'adopted', 'biologische ouders', 'afkomst zoeken', 'roots search', 'afstamming', 'vader onbekend', 'mother unknown', 'family origin search'] },
  { theme: 'Macht & hiërarchie', patterns: ['hierarchy', 'dominance', 'machtsverhoud', 'status struggle', 'power structure', 'authority struggle', 'oppressieve verhoud', 'groepsdruk'] },
  { theme: 'Isolatie', patterns: ['isolation', 'isolated', 'alone at sea', 'afgesloten', 'opgesloten', 'afgezonderd', 'remote setting', 'sociaal isolement'] },
  { theme: 'Overleven', patterns: ['survival', 'survive', 'overleven', 'wilderness survival', 'vlucht', 'ontsnappen en overleven', 'extreme conditions'] },
  { theme: 'Mythologie', patterns: ['mytholog', 'greek god', 'greek deity', 'olympus', 'titan', 'zeus', 'hades', 'poseidon', 'athena', 'apollo'] },
  { theme: 'Mysterie', patterns: ['mystery', 'detective', 'investigation', 'secret', 'disappearance', 'missing', 'murder investigation'] },
  { theme: 'Spanning', patterns: ['thriller', 'horror', 'vampire', 'ghost', 'haunted', 'dracula', 'danger', 'killer', 'monster'] },
  { theme: 'Fantasy', patterns: ['fantasy', 'magic', 'wizard', 'dragon', 'magic realism'] },
  { theme: 'Geschiedenis', patterns: ['world war', 'historical', 'holocaust', 'verzet', 'oorlog', 'war child'] },
  { theme: 'Avontuur', patterns: ['adventure', 'quest', 'treasure hunt', 'expedition'] },
  { theme: 'Familie', patterns: ['family', 'father', 'mother', 'parent', 'siblings'] },
  { theme: 'Vriendschap', patterns: ['friendship', 'friend group', 'friend ', 'friends', 'companionship', 'social relations'] },
  { theme: 'Romantiek', patterns: ['romance', 'love', 'dating', 'relationship', 'verliefd', 'heartbreak', 'love triangle'] },
  { theme: 'Identiteit', patterns: ['identity', 'gender', 'sexuality', 'self-esteem', 'body image', 'coming out', 'self image', 'insecur'] },
  { theme: 'Maatschappij', patterns: ['society', 'social issue', 'discrimination', 'racism', 'poverty', 'prostitution', 'refugee', /\bcults?\b/, /\bsects?\b/, 'migration', 'homeless', 'abuse', 'violence'] },
  { theme: 'School & Opgroeien', patterns: ['school', 'high school', 'teen', 'adolesc', 'pubert', 'coming-of-age', 'coming of age'] },
  { theme: 'Poëzie', patterns: ['poetry', 'poem', 'gedicht'] },
  { theme: 'Sport', patterns: ['sport', 'football', 'soccer', 'hockey', 'tennis', 'judo'] },
  { theme: 'Wetenschap', patterns: ['science', 'technology', 'robot', 'space', 'astronomy', 'climate', 'biology', 'chemistry', 'physics', 'invention'] },
  { theme: 'Natuur', patterns: ['nature', 'animal', 'forest', 'ocean', 'ecology', 'environment'] },
];

const SUGGESTION_RULES = [
  { patterns: ['lonely', 'self image', 'insecur'], themes: ['Identiteit', 'School & Opgroeien'] },
  { patterns: ['refugee', 'migration', 'war child', 'poverty', 'homeless', 'abuse', 'violence'], themes: ['Maatschappij'] },
  { patterns: ['magic realism'], themes: ['Fantasy', 'Identiteit'] },
  { patterns: ['myth', 'olympus', 'titan', 'zeus', 'hades', 'poseidon', 'athena', 'apollo'], themes: ['Mythologie'] },
  { patterns: ['coming-of-age', 'coming of age', 'adolescence', 'high school', 'school life'], themes: ['School & Opgroeien'] },
  { patterns: ['murder', 'killer', 'crime', 'missing'], themes: ['Mysterie', 'Spanning'] },
  { patterns: ['ghost', 'vampire', 'monster', 'haunted'], themes: ['Spanning', 'Fantasy'] },
  { patterns: ['love triangle', 'heartbreak', 'relationship'], themes: ['Romantiek'] },
  { patterns: ['friend group', 'companionship', 'social relations'], themes: ['Vriendschap'] },
  { patterns: ['ecology', 'animals', 'climate', 'environment'], themes: ['Natuur', 'Wetenschap'] },
  { patterns: ['space', 'astronomy', 'robot', 'invention'], themes: ['Wetenschap'] },
];

function normalizeRawThemeTag(tag) {
  if (tag === undefined || tag === null) {
    return '';
  }
  return String(tag)
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ');
}

function isSuppressedThemeTag(tag) {
  const normalized = normalizeRawThemeTag(tag);
  if (!normalized) {
    return true;
  }
  if (EXACT_THEME_MAP.has(normalized)) {
    return false;
  }
  if (findThemesByContains(normalized).length) {
    return false;
  }
  if (SUPPRESSED_THEME_TAGS.has(normalized)) {
    return true;
  }
  return SUPPRESSED_THEME_TAG_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function mapExactTagToTheme(tag) {
  const normalized = normalizeRawThemeTag(tag);
  return EXACT_THEME_MAP.get(normalized) || null;
}

function findThemesByContains(tag, rules = STRONG_CONTAINS_THEME_RULES) {
  const normalized = normalizeRawThemeTag(tag);
  if (!normalized) {
    return [];
  }
  const matchesPattern = (pattern) => {
    if (pattern instanceof RegExp) {
      return pattern.test(normalized);
    }
    return normalized.includes(pattern);
  };
  return rules.flatMap((rule) => {
    if (!rule.patterns.some((pattern) => matchesPattern(pattern))) {
      return [];
    }
    if (Array.isArray(rule.themes)) {
      return rule.themes;
    }
    return rule.theme ? [rule.theme] : [];
  });
}

function suggestThemesFromTag(tag) {
  return findThemesByContains(tag, SUGGESTION_RULES);
}

function sortThemesByCanonicalOrder(values) {
  return Array.from(new Set(values)).sort((a, b) => {
    const indexA = CANONICAL_THEMES.indexOf(a);
    const indexB = CANONICAL_THEMES.indexOf(b);
    if (indexA === -1 && indexB === -1) {
      return a.localeCompare(b, 'nl', { sensitivity: 'base' });
    }
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
}


function normalizeManualTheme(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const lowered = normalizeRawThemeTag(trimmed);
  if (EASY_READING_TAGS.has(lowered) || lowered === 'makkelijklezen' || lowered === 'ml') {
    return '';
  }
  const canonical = CANONICAL_THEMES.find((theme) => normalizeRawThemeTag(theme) === lowered);
  return canonical || '';
}

function normalizeManualThemes(values) {
  const parsed = parseMultiValueField(values)
    .map(normalizeManualTheme)
    .filter(Boolean);
  return sortThemesByCanonicalOrder(parsed);
}

function deriveThemesFromTags(rawTags, options = {}) {
  const tags = Array.isArray(rawTags) ? rawTags : parseMultiValueField(rawTags);
  const normalizedTagEntries = [];
  const seen = new Set();
  for (const tag of tags) {
    const original = typeof tag === 'string' ? tag.trim() : String(tag ?? '').trim();
    const normalized = normalizeRawThemeTag(original);
    if (!original || !normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    normalizedTagEntries.push({ original, normalized });
  }

  const directThemes = new Set();
  const suggestionCounts = new Map();
  const suppressed = new Set();
  const handled = new Set();

  for (const entry of normalizedTagEntries) {
    if (isSuppressedThemeTag(entry.normalized)) {
      suppressed.add(entry.normalized);
      continue;
    }

    const exactTheme = mapExactTagToTheme(entry.normalized);
    if (exactTheme) {
      directThemes.add(exactTheme);
      handled.add(entry.normalized);
      continue;
    }

    const strongThemes = findThemesByContains(entry.normalized);
    if (strongThemes.length) {
      for (const theme of strongThemes) {
        directThemes.add(theme);
      }
      handled.add(entry.normalized);
      continue;
    }

    const suggestedThemes = suggestThemesFromTag(entry.normalized);
    if (suggestedThemes.length) {
      for (const theme of suggestedThemes) {
        suggestionCounts.set(theme, (suggestionCounts.get(theme) || 0) + 1);
      }
      handled.add(entry.normalized);
      continue;
    }
  }

  const promotedThemes = [];
  const remainingSuggestions = [];
  for (const [theme, count] of suggestionCounts.entries()) {
    if (directThemes.has(theme)) {
      continue;
    }
    if (count >= 2) {
      promotedThemes.push(theme);
    } else {
      remainingSuggestions.push(theme);
    }
  }

  const themes = sortThemesByCanonicalOrder([...directThemes, ...promotedThemes]);
  const suggestedThemes = sortThemesByCanonicalOrder(remainingSuggestions.filter((theme) => !themes.includes(theme)));
  const unmappedTags = normalizedTagEntries
    .filter((entry) => !suppressed.has(entry.normalized) && !handled.has(entry.normalized))
    .map((entry) => entry.original);

  const result = {
    themes,
    suggestedThemes,
    unmappedTags,
  };

  if (options.includeEasyReadingSignal) {
    result.easyReadingSignal = normalizedTagEntries.some((entry) => EASY_READING_TAGS.has(entry.normalized));
  }

  return result;
}

function attachDerivedThemeFields(book, options = {}) {
  const source = typeof book === 'object' && book ? book : {};
  const safeTags = parseMultiValueField(source.tags);
  const manualThemes = normalizeManualThemes(source.manualThemes);
  // Metadata-enriched themes shown in the confirmed review must survive
  // saving, loading and book-copy creation; unlike teacher-selected
  // manualThemes, they may include as-yet uncategorized freeform values.
  const importedThemes = parseMultiValueField(source.importedThemes)
    .filter((theme) => typeof theme === 'string' && theme.trim())
    .slice(0, 40);
  const derived = deriveThemesFromTags(safeTags, options);
  return {
    ...source,
    tags: safeTags,
    manualThemes,
    importedThemes,
    themes: manualThemes.length ? manualThemes
      : source.themesCleared === true ? []
        : importedThemes.length ? importedThemes : derived.themes,
    suggestedThemes: derived.suggestedThemes,
    unmappedTags: derived.unmappedTags,
  };
}


module.exports = {
  parseMultiValueField,
  CANONICAL_THEMES, SUPPRESSED_THEME_TAGS, SUPPRESSED_THEME_TAG_PATTERNS, EASY_READING_TAGS, EXACT_THEME_MAP, STRONG_CONTAINS_THEME_RULES, SUGGESTION_RULES, normalizeRawThemeTag, isSuppressedThemeTag, mapExactTagToTheme, findThemesByContains, suggestThemesFromTag, sortThemesByCanonicalOrder, normalizeManualTheme, normalizeManualThemes, deriveThemesFromTags, attachDerivedThemeFields
};
