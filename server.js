const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const { normalizeCoverCrop } = require('./lib/cover-crop');
const { createCoverAssetStore } = require('./lib/cover-assets');
const { planCoverBackfill } = require('./lib/cover-backfill-plan');
const { readBookImportWorkbook } = require('./book-import-workbook');
const { analyzeReviewedImport, buildReviewDecisions } = require('./book-import-review');
const { metadataCandidatesFromResult } = require('./book-import-analysis-metadata');
const { createImportStageStore, importStageView, buildStageApplyPlan } = require('./book-import-stage');
const { buildInventorySyncPreview, normalizeInventoryResolutions } = require('./book-import-inventory-sync');
const { stageReviewedLoan, historicalExcelLoanReceipts,
  persistExcelLoanReceipts } = require('./book-import-loan-migration');
const { mayManageClass, mayManageStudent, studentClassIds, ownClassIds,
  normalizeDueDate, publicBook } = require('./book-loan-policy');
const { HOUR_MS: IMPORT_MAIL_HOUR_MS,
  configuration: importMailConfiguration, readSchoolLinks, prefsFor,
  schoolEmailFor, validEmail, beginVerification, confirmVerification,
  changePreference, bridgeSend, dispatchReminders } = require('./book-import-reminder-mail');
const { circulationRevision, noteLoanActivity,
  settingsFor, validateSettings, followupContext, contextMatchesTask, makeTask, taskStage,
  listTasks, updateReportCompletion, reportIsFullyReviewed,
  cancelTasksForDeletedBooks, cancelMissingBookTask, escalateTasksForDeletedClass,
  libraryOnlyTask, performDecision, assignTask } = require('./book-import-followups');

const bookImportStageStore = createImportStageStore();
let xlsxModule = null;

function loadXlsx() {
  if (xlsxModule) {
    return xlsxModule;
  }
  try {
    // Lazy-load to allow the server to run even when the optional dependency
    // is not installed (bijv. in offline-omgevingen voor demo's of tests).
    // De Excel-import endpoint controleert later of de module beschikbaar is.
    // eslint-disable-next-line global-require
    xlsxModule = require('xlsx');
  } catch (error) {
    xlsxModule = null;
  }
  return xlsxModule;
}

const PORT = process.env.PORT || 3000;
const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
// Keep original image files next to db.json on the configured persistent volume.
const coverAssets = createCoverAssetStore({ directory: path.join(path.dirname(DATA_PATH), 'covers') });

// Cover retrieval is deliberately separate from the reviewed import commit:
// hundreds of third-party image fetches must never delay its HTTP response.
// Missing local URLs in db.json are the durable retry queue after a restart.
let shuttingDown = false;
let coverBackfillRunning = false;
let coverBackfillScheduled = false;
let coverBackfillPending = false;
const coverBackfillFailures = new Map();
const coverRetryDelays = [30_000, 120_000, 600_000];
let coverBackfillRetryTimer = null;

function scheduleBackfillRetry() {
  if (shuttingDown || coverBackfillRetryTimer) return;
  const future = [...coverBackfillFailures.values()]
    .filter((entry) => entry.attempts <= coverRetryDelays.length
      && Number.isFinite(entry.nextRetryAt))
    .map((entry) => entry.nextRetryAt);
  if (!future.length) return;
  const delay = Math.max(1000, Math.min(...future) - Date.now());
  coverBackfillRetryTimer = setTimeout(() => {
    coverBackfillRetryTimer = null;
    scheduleCoverBackfill();
  }, delay);
  if (typeof coverBackfillRetryTimer.unref === 'function') coverBackfillRetryTimer.unref();
}

function scheduleCoverBackfill({ resetFailures = false } = {}) {
  if (shuttingDown) return;
  // An explicit import or edit is new work. Even a URL that previously
  // exhausted retries must be eligible for another attempt.
  if (resetFailures) coverBackfillFailures.clear();
  if (coverBackfillRetryTimer) {
    clearTimeout(coverBackfillRetryTimer);
    coverBackfillRetryTimer = null;
  }
  if (coverBackfillRunning || coverBackfillScheduled) {
    coverBackfillPending = true;
    return;
  }
  coverBackfillScheduled = true;
  setImmediate(async () => {
    coverBackfillScheduled = false;
    coverBackfillRunning = true;
    try {
      const snapshot = loadDb();
      const plan = planCoverBackfill(snapshot.books, {
        hasAsset: (url) => coverAssets.hasAsset(url),
        failures: coverBackfillFailures,
      });
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(plan.length, 4) }, async () => {
        while (next < plan.length && !shuttingDown) {
          const { source, localAsset } = plan[next++];
          let local;
          try {
            // Reuse a valid asset from another copy of the same source before
            // trying the upstream server. This also works when it is offline.
            local = localAsset && coverAssets.hasAsset(localAsset)
              ? localAsset : await coverAssets.saveSource(source);
          } catch (error) {
            const attempts = (coverBackfillFailures.get(source)?.attempts || 0) + 1;
            coverBackfillFailures.set(source, {
              attempts,
              phase: 'download',
              nextRetryAt: attempts <= coverRetryDelays.length
                ? Date.now() + coverRetryDelays[attempts - 1] : Infinity,
            });
            console.warn('Boekomslag tijdelijk niet beschikbaar:', error.message);
            continue;
          }
          // Never race against the one-active-import staging transaction.
          while (!shuttingDown && (bookImportStageStore.active()?.status === 'applying' || activeBookImportLease)) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          if (shuttingDown) break;
          try {
            const latest = loadDb();
            let changed = false;
            for (const book of latest.books || []) {
              if (book.coverUrl === source && !coverAssets.hasAsset(book.localCoverUrl)) {
                book.localCoverUrl = local;
                changed = true;
              }
            }
            if (changed) saveDb(latest);
            // Only a committed (or no-longer-needed) database link completes
            // the retry. Failed writes must retain their attempt count.
            coverBackfillFailures.delete(source);
          } catch (error) {
            // A persistent write error must not trigger an immediate retry
            // loop. Use the same bounded cooldown as network failures.
            const attempts = (coverBackfillFailures.get(source)?.attempts || 0) + 1;
            coverBackfillFailures.set(source, {
              attempts,
              phase: 'link',
              // Keep the downloaded file available across write retries,
              // even when no other book currently links to this asset.
              localAsset: coverAssets.hasAsset(local) ? local : '',
              nextRetryAt: attempts <= coverRetryDelays.length
                ? Date.now() + coverRetryDelays[attempts - 1] : Infinity,
            });
            console.warn('Boekomslag lokaal opgeslagen maar boekkoppeling nog niet bijgewerkt:', error.message);
          }
        }
      }));
    } catch (error) {
      console.warn('Omslagverwerking afgebroken:', error.message);
    } finally {
      coverBackfillRunning = false;
      if (coverBackfillPending && !shuttingDown) {
        coverBackfillPending = false;
        scheduleCoverBackfill();
      } else {
        scheduleBackfillRetry();
      }
    }
  });
}

function runCoverGarbageCollection() {
  if (shuttingDown) return;
  try {
    const result = coverAssets.cleanupUnreferenced(
      () => loadDb().books.map((book) => book.localCoverUrl).filter(Boolean));
    if (result.removed) console.info(`Ongebruikte boekomslagen opgeruimd: ${result.removed}`);
  } catch (error) {
    console.warn('Opruimen ongebruikte boekomslagen mislukt:', error.message);
  }
}
const DIST_DIR = path.join(__dirname, 'dist');
const PUBLIC_DIR = path.join(__dirname, 'public');

const configuredStaticDir = process.env.BOEKENBAAI_STATIC_DIR
  ? path.resolve(__dirname, process.env.BOEKENBAAI_STATIC_DIR)
  : null;

const PUBLIC_API_BASE = process.env.BOEKENBAAI_PUBLIC_API_BASE || '';
const ISBN_API_BASE = process.env.BOEKENBAAI_ISBN_API_BASE || 'https://isbnbarcode.org/api';
const ENABLE_ISBNBARCODE_LOOKUP =
  String(process.env.BOEKENBAAI_ENABLE_ISBNBARCODE || '').toLowerCase() === 'true';
const DEBUG_ISBN_LOOKUP =
  String(process.env.BOEKENBAAI_DEBUG_ISBN_LOOKUP || '').toLowerCase() === 'true';
const IMPORT_ISBN_ENRICHMENT_ENABLED =
  String(process.env.BOEKENBAAI_IMPORT_ENRICH_ISBN || '').toLowerCase() === 'true';
const DEFAULT_ISBN_CACHE_TTL_MS = 5 * 60 * 1000;
const ISBN_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.BOEKENBAAI_ISBN_CACHE_TTL_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_ISBN_CACHE_TTL_MS;
})();
const DEFAULT_TITLE_AUTHOR_FALLBACK_CACHE_TTL_MS = 90 * 1000;
const TITLE_AUTHOR_FALLBACK_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.BOEKENBAAI_TITLE_AUTHOR_CACHE_TTL_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_TITLE_AUTHOR_FALLBACK_CACHE_TTL_MS;
})();
const TITLE_AUTHOR_FALLBACK_MAX_RETRIES = 2;
const TITLE_AUTHOR_FALLBACK_RETRY_BASE_MS = 120;
const DEFAULT_TITLE_AUTHOR_FALLBACK_COOLDOWN_MS = 30 * 1000;
const TITLE_AUTHOR_FALLBACK_COOLDOWN_MS = (() => {
  const raw = Number(process.env.BOEKENBAAI_TITLE_AUTHOR_RATE_LIMIT_COOLDOWN_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_TITLE_AUTHOR_FALLBACK_COOLDOWN_MS;
})();
const DEBUG_IMPORT_FALLBACK_VERBOSE =
  String(process.env.BOEKENBAAI_DEBUG_IMPORT_FALLBACK_VERBOSE || '').toLowerCase() === 'true';

const STATIC_DIR = (() => {
  const candidates = [configuredStaticDir, DIST_DIR, PUBLIC_DIR].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const stats = fs.statSync(candidate);
      if (stats.isDirectory()) {
        return candidate;
      }
    } catch (error) {
      // Ignore missing directories, try the next candidate.
    }
  }
  return PUBLIC_DIR;
})();

const allowedOrigins = (process.env.BOEKENBAAI_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);


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

// Align the staged Excel preview with the theme derivation that runs when a
// book is actually saved. An explicit manual clear must still win.
function includeDerivedThemesInImportPreview(analysis) {
  if (!analysis?.ok) return;
  for (const row of analysis.rows || []) {
    if (row.status === 'skipped' || !row.book || !row.provenance) continue;
    if (row.provenance.themes?.source === 'manual' || row.book.themes?.length) continue;
    const themes = deriveThemesFromTags(row.book.tags).themes;
    if (themes.length) {
      row.book.themes = themes;
      row.provenance.themes = { source: 'derived', detail: 'tags' };
    }
  }
}

const EMPTY_DB = {
  books: [],
  students: [],
  folders: [],
  classes: [],
  users: [],
  history: [],
};

function ensureParentDirectory(filePath) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
}

function parseQuantityInput(value, { allowZero = false, defaultValue = 1 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return defaultValue;
  }
  const floored = Math.floor(number);
  if (floored < 0) {
    return allowZero ? 0 : defaultValue;
  }
  if (!allowZero && floored === 0) {
    return defaultValue;
  }
  return floored;
}

function ensureDbFile() {
  try {
    fs.accessSync(DATA_PATH, fs.constants.F_OK);
  } catch (error) {
    ensureParentDirectory(DATA_PATH);
    if (DATA_PATH !== DEFAULT_DATA_PATH && fs.existsSync(DEFAULT_DATA_PATH)) {
      fs.copyFileSync(DEFAULT_DATA_PATH, DATA_PATH);
    } else {
      fs.writeFileSync(DATA_PATH, JSON.stringify(EMPTY_DB, null, 2));
    }
  }
}

ensureDbFile();
console.log(`Boekenbaai gebruikt data-bestand: ${DATA_PATH}`);
console.log(`Boekenbaai serveert statische bestanden uit: ${STATIC_DIR}`);

const sessions = new Map();
const activeImportJobs = new Map();
const isbnMetadataCache = new Map();
const isbnLookupInflight = new Map();
const titleAuthorFallbackCache = new Map();
const IMPORT_PROVENANCE_SOURCE_TYPES = new Set([
  'excel',
  'existing',
  'metadata',
  'derived',
  'manual',
  'unknown',
]);
let googleBooksFallbackCooldownUntil = 0;
let googleBooksFallbackCooldownReason = '';
const globalFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;

function markInterruptedImportJobs() {
  const db = loadDb();
  let changed = false;
  for (const job of db.importJobs || []) {
    if (job && (job.status === 'queued' || job.status === 'running')) {
      const now = new Date().toISOString();
      job.status = 'interrupted';
      job.updatedAt = now;
      job.finishedAt = now;
      job.error = job.error || 'Import onderbroken door serverherstart';
      changed = true;
    }
  }
  if (changed) {
    saveDb(db);
  }
}

markInterruptedImportJobs();

function getIsbnCacheKey(isbn) {
  const sanitized = sanitizeIsbn(isbn);
  return sanitized || `invalid:${String(isbn ?? '').trim()}`;
}

function resolveLookupIsbnMetadata() {
  if (typeof globalThis.__BOEKENBAAI_MOCK_ISBN_LOOKUP === 'function') {
    return globalThis.__BOEKENBAAI_MOCK_ISBN_LOOKUP;
  }
  return lookupIsbnMetadata;
}

function resolveLookupTitleAuthorMetadata() {
  if (typeof globalThis.__BOEKENBAAI_MOCK_TITLE_AUTHOR_LOOKUP === 'function') {
    return globalThis.__BOEKENBAAI_MOCK_TITLE_AUTHOR_LOOKUP;
  }
  return lookupMetadataByTitleAuthor;
}

function isOriginAllowed(origin, requestUrl) {
  if (!origin) return false;
  if (allowedOrigins.includes('*')) {
    return true;
  }
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  if (allowedOrigins.length === 0) {
    const sameOrigin = `${requestUrl.protocol}//${requestUrl.host}`;
    return origin === sameOrigin;
  }
  return false;
}

function applyCors(req, res, requestUrl) {
  const origin = req.headers.origin;
  if (!origin || !isOriginAllowed(origin, requestUrl)) {
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
}

function ensureStudentShape(student) {
  const safeStudent = { ...student };
  if (!Array.isArray(safeStudent.borrowedBooks)) {
    safeStudent.borrowedBooks = [];
  }
  if (!Array.isArray(safeStudent.classIds)) {
    safeStudent.classIds = [];
  }
  safeStudent.username = safeStudent.username || '';
  safeStudent.passwordHash = safeStudent.passwordHash || '';
  safeStudent.mustChangePassword = Boolean(student.mustChangePassword);
  return safeStudent;
}

function ensureClassShape(klass) {
  const safeClass = { ...klass };
  safeClass.name = typeof safeClass.name === 'string' ? safeClass.name : '';
  safeClass.teacherIds = Array.isArray(safeClass.teacherIds)
    ? Array.from(new Set(safeClass.teacherIds.filter((id) => typeof id === 'string')))
    : [];
  safeClass.studentIds = Array.isArray(safeClass.studentIds)
    ? Array.from(new Set(safeClass.studentIds.filter((id) => typeof id === 'string')))
    : [];
  return safeClass;
}

function ensureTeacherShape(user) {
  if (!user) {
    return user;
  }
  const safeUser = { ...user };
  safeUser.username = typeof safeUser.username === 'string' ? safeUser.username : '';
  safeUser.passwordHash = typeof safeUser.passwordHash === 'string' ? safeUser.passwordHash : '';
  safeUser.mustChangePassword = Boolean(user.mustChangePassword);
  if (safeUser.role !== 'teacher') {
    return safeUser;
  }
  safeUser.classIds = Array.isArray(safeUser.classIds)
    ? Array.from(new Set(safeUser.classIds.filter((id) => typeof id === 'string')))
    : [];
  return safeUser;
}

function normalizeClassKey(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

function normalizePublisher(value) {
  if (value == null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim()))
      .filter(Boolean)
      .join(', ');
  }
  return String(value).trim();
}

function normalizePublishedYear(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const year = Math.trunc(value);
    return year >= 0 ? year : null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const match = text.match(/(\d{4})/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : null;
}

function normalizePageCountValue(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? Math.round(value) : null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const number = Number(text);
  if (Number.isFinite(number) && number > 0) {
    return Math.round(number);
  }
  const match = text.match(/\d+/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeLanguageCode(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeLanguageCode(entry);
      if (normalized) {
        return normalized;
      }
    }
    return '';
  }
  const text = String(value).trim();
  if (!text) {
    return '';
  }
  // School books can legitimately contain more than one language. Do not
  // silently discard a second language when saving reviewed Excel values.
  return text.length <= 3 ? text.toLowerCase() : text;
}

function normalizeCoverUrl(value) {
  if (value === undefined || value === null) {
    return '';
  }
  const text = String(value).trim();
  if (/^http:\/\/books\.google\.com(?=\/|$)/i.test(text)) {
    return `https://${text.slice('http://'.length)}`;
  }
  return text;
}

function resolveEffectiveCoverUrl(value) {
  return normalizeCoverUrl(value || '');
}

function normalizeBookImportProcess(process, fallbackResult = '') {
  if (!process || typeof process !== 'object') {
    return null;
  }
  const rawResult = typeof process.result === 'string' ? process.result.trim().toLowerCase() : '';
  const result = rawResult === 'created' || rawResult === 'updated' || rawResult === 'skipped' || rawResult === 'failed'
    ? rawResult
    : (fallbackResult || '');
  const lookupAttempted = Boolean(process.lookupAttempted);
  const lookupFound = Boolean(process.lookupFound);
  const lookupSource = typeof process.lookupSource === 'string' && process.lookupSource.trim()
    ? process.lookupSource.trim().toLowerCase()
    : null;
  const fallbackUsed = Boolean(process.fallbackUsed);
  const fallbackSource = typeof process.fallbackSource === 'string' && process.fallbackSource.trim()
    ? process.fallbackSource.trim().toLowerCase()
    : null;
  const wasDeferred = Boolean(process.wasDeferred);
  const deferCountRaw = Number(process.deferCount);
  const deferCount = Number.isFinite(deferCountRaw) && deferCountRaw > 0
    ? Math.floor(deferCountRaw)
    : 0;
  return {
    result,
    lookupAttempted,
    lookupFound,
    lookupSource,
    fallbackUsed,
    fallbackSource,
    wasDeferred,
    deferCount,
  };
}

function normalizeBookImportInfo(importInfo) {
  if (!importInfo || typeof importInfo !== 'object') {
    return null;
  }
  const importedAt = typeof importInfo.importedAt === 'string' && importInfo.importedAt.trim()
    ? importInfo.importedAt
    : '';
  const importedBy = typeof importInfo.importedBy === 'string' && importInfo.importedBy.trim()
    ? importInfo.importedBy
    : null;
  const importSource = typeof importInfo.importSource === 'string' && importInfo.importSource.trim()
    ? importInfo.importSource
    : '';
  const importJobId = typeof importInfo.importJobId === 'string' && importInfo.importJobId.trim()
    ? importInfo.importJobId
    : null;
  const rawStatus = typeof importInfo.importStatus === 'string' ? importInfo.importStatus.trim().toLowerCase() : '';
  const importStatus = rawStatus === 'created' || rawStatus === 'updated' ? rawStatus : '';
  const rawLookup = importInfo.metadataLookupSummary;
  const metadataLookupSummary = rawLookup && typeof rawLookup === 'object'
    ? {
      found: Boolean(rawLookup.found),
      source: typeof rawLookup.source === 'string' && rawLookup.source.trim()
        ? rawLookup.source.trim()
        : null,
    }
    : null;
  if (!importedAt || !importSource || !importStatus) {
    return null;
  }
  const process = normalizeBookImportProcess(importInfo.process, importStatus);
  return {
    importedAt,
    importedBy,
    importSource,
    importJobId,
    importStatus,
    metadataLookupSummary,
    process,
  };
}

function normalizeImportFieldSource(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const rawSourceType = typeof value.sourceType === 'string' ? value.sourceType.trim().toLowerCase() : '';
  const sourceType = IMPORT_PROVENANCE_SOURCE_TYPES.has(rawSourceType) ? rawSourceType : 'unknown';
  const sourceDetail = typeof value.sourceDetail === 'string' && value.sourceDetail.trim()
    ? value.sourceDetail.trim().toLowerCase()
    : null;
  return { sourceType, sourceDetail };
}

function normalizeBookImportProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object') {
    return null;
  }
  const rawFields = provenance.fieldSources;
  if (!rawFields || typeof rawFields !== 'object') {
    return null;
  }
  const normalizedFields = {};
  for (const [fieldName, fieldSource] of Object.entries(rawFields)) {
    const normalized = normalizeImportFieldSource(fieldSource);
    if (normalized) {
      normalizedFields[fieldName] = normalized;
    }
  }
  if (!Object.keys(normalizedFields).length) {
    return null;
  }
  return { fieldSources: normalizedFields };
}

function createFieldSource(sourceType, sourceDetail = null) {
  return normalizeImportFieldSource({ sourceType, sourceDetail }) || {
    sourceType: 'unknown',
    sourceDetail: null,
  };
}

function pickSourceDetailForMetadata(sourceType, metadataFields) {
  if (sourceType !== 'metadata') {
    return null;
  }
  if (typeof metadataFields?.source === 'string' && metadataFields.source.trim()) {
    return metadataFields.source.trim().toLowerCase();
  }
  return null;
}

function ensureBookShape(book) {
  const source = typeof book === 'object' && book ? book : {};
  const safeBook = { ...source };
  safeBook.title = typeof source.title === 'string' ? source.title : '';
  safeBook.author = typeof source.author === 'string' ? source.author : '';
  safeBook.barcode = typeof source.barcode === 'string' ? source.barcode : '';
  safeBook.metadataIsbn = sanitizeIsbn(source.metadataIsbn);
  safeBook.description = typeof source.description === 'string' ? source.description : '';
  if (typeof source.folderId === 'string' && source.folderId.trim()) {
    safeBook.folderId = source.folderId;
  } else {
    safeBook.folderId = null;
  }
  safeBook.suitableForExamList = Boolean(source.suitableForExamList);
  safeBook.easyReading = Boolean(source.easyReading);
  safeBook.status = typeof source.status === 'string' ? source.status : 'available';
  safeBook.borrowedBy = typeof source.borrowedBy === 'string' ? source.borrowedBy : null;
  safeBook.borrowedByClassId = typeof source.borrowedByClassId === 'string'
    && source.borrowedByClassId.trim() ? source.borrowedByClassId : null;
  safeBook.borrowedAt = typeof source.borrowedAt === 'string' ? source.borrowedAt : null;
  safeBook.dueDate = typeof source.dueDate === 'string' && source.dueDate.trim() ? source.dueDate : null;
  safeBook.tags = parseMultiValueField(source.tags);
  safeBook.manualThemes = normalizeManualThemes(source.manualThemes);
  safeBook.themesCleared = source.themesCleared === true;
  safeBook.importedThemes = parseMultiValueField(source.importedThemes)
    .filter((theme) => typeof theme === 'string' && theme.trim()).slice(0, 40);
  safeBook.coverColor = typeof source.coverColor === 'string' ? source.coverColor : '#f9f9f9';
  safeBook.publisher = normalizePublisher(source.publisher);
  safeBook.publishedYear = normalizePublishedYear(
    source.publishedYear ?? source.year ?? source.publishedAt
  );
  safeBook.pageCount = normalizePageCountValue(source.pageCount ?? source.pages);
  safeBook.language = normalizeLanguageCode(source.language);
  safeBook.coverUrl = normalizeCoverUrl(source.coverUrl || source.cover || '');
  safeBook.localCoverUrl = typeof source.localCoverUrl === 'string'
    && /^\/api\/covers\/[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/.test(source.localCoverUrl)
    ? source.localCoverUrl : '';
  safeBook.coverCrop = normalizeCoverCrop(source.coverCrop);
  safeBook.importInfo = normalizeBookImportInfo(source.importInfo);
  safeBook.importProvenance = normalizeBookImportProvenance(source.importProvenance);
  return attachDerivedThemeFields(safeBook);
}

function sanitizeBookForResponse(book) {
  return publicBook(book);
}

function createBookCopyFromTemplate(template) {
  const base = ensureBookShape(template);
  return {
    ...base,
    id: crypto.randomUUID(),
    status: 'available',
    borrowedBy: null,
    borrowedByClassId: null,
    borrowedAt: null,
    dueDate: null,
  };
}

function normalizeGroupKeyPart(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function getBookGroupKey(book) {
  const title = normalizeGroupKeyPart(book?.title).toLowerCase();
  const author = normalizeGroupKeyPart(book?.author).toLowerCase();
  const metadataIsbn = normalizeGroupKeyPart(book?.metadataIsbn).toLowerCase();
  return `${title}||${author}||${metadataIsbn}`;
}

function pickRepresentativeBook(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentCoverUrl = resolveEffectiveCoverUrl(current.coverUrl);
  const candidateCoverUrl = resolveEffectiveCoverUrl(candidate.coverUrl);
  const currentScore = (currentCoverUrl ? 2 : 0) + (current.description ? 1 : 0);
  const candidateScore = (candidateCoverUrl ? 2 : 0) + (candidate.description ? 1 : 0);
  if (candidateScore > currentScore) {
    return candidate;
  }
  if (candidateScore === currentScore && candidateCoverUrl && currentCoverUrl) {
    const currentNeedsRewrite = currentCoverUrl !== normalizeCoverUrl(current.coverUrl || '');
    const candidateNeedsRewrite = candidateCoverUrl !== normalizeCoverUrl(candidate.coverUrl || '');
    if (currentNeedsRewrite && !candidateNeedsRewrite) {
      return candidate;
    }
  }
  return current;
}

function groupBooksByTitleAuthor(books = []) {
  const groups = new Map();

  for (const book of books || []) {
    if (!book) continue;
    const key = getBookGroupKey(book);
    const entry = groups.get(key) || {
      id: key,
      title: normalizeGroupKeyPart(book.title) || book.title || '',
      author: normalizeGroupKeyPart(book.author) || book.author || '',
      metadataIsbn: normalizeGroupKeyPart(book.metadataIsbn) || null,
      copies: [],
      tags: new Set(),
      themes: new Set(),
      suggestedThemes: new Set(),
      unmappedTags: new Set(),
      folderIds: new Set(),
      representativeBook: null,
    };
    entry.copies.push(book);
    entry.representativeBook = pickRepresentativeBook(entry.representativeBook, book);
    if (Array.isArray(book.tags)) {
      for (const tag of book.tags) {
        if (typeof tag === 'string' && tag.trim()) {
          entry.tags.add(tag.trim());
        }
      }
    }
    if (Array.isArray(book.themes)) {
      for (const theme of book.themes) {
        if (typeof theme === 'string' && theme.trim()) {
          entry.themes.add(theme.trim());
        }
      }
    }
    if (Array.isArray(book.suggestedThemes)) {
      for (const theme of book.suggestedThemes) {
        if (typeof theme === 'string' && theme.trim()) {
          entry.suggestedThemes.add(theme.trim());
        }
      }
    }
    if (Array.isArray(book.unmappedTags)) {
      for (const tag of book.unmappedTags) {
        if (typeof tag === 'string' && tag.trim()) {
          entry.unmappedTags.add(tag.trim());
        }
      }
    }
    if (book.folderId) {
      entry.folderIds.add(book.folderId);
    }
    groups.set(key, entry);
  }

  const result = [];
  for (const value of groups.values()) {
    const totalCopies = value.copies.length;
    const borrowedCopies = value.copies.filter((copy) => copy.status === 'borrowed').length;
    const availableCopies = totalCopies - borrowedCopies;
    const representative = value.representativeBook || value.copies[0] || {};
    // A representative may have no local asset even when another physical
    // copy with the same source has a valid cached image.
    const representativeCoverSource = resolveEffectiveCoverUrl(representative.coverUrl);
    const cachedEditionCover = value.copies.find((copy) =>
      resolveEffectiveCoverUrl(copy.coverUrl) === representativeCoverSource
      && coverAssets.hasAsset(copy.localCoverUrl))?.localCoverUrl || representative.localCoverUrl || '';
    const folderIds = Array.from(value.folderIds);
    const tags = Array.from(value.tags);
    const themes = sortThemesByCanonicalOrder(Array.from(value.themes));
    const suggestedThemes = sortThemesByCanonicalOrder(Array.from(value.suggestedThemes).filter((theme) => !themes.includes(theme)));
    const unmappedTags = Array.from(value.unmappedTags);
    result.push({
      id: value.id,
      title: value.title || representative.title || '',
      author: value.author || representative.author || '',
      metadataIsbn: representative.metadataIsbn || value.metadataIsbn || null,
      description: representative.description || '',
      coverUrl: resolveEffectiveCoverUrl(representative.coverUrl),
      localCoverUrl: cachedEditionCover,
      coverCrop: normalizeCoverCrop(representative.coverCrop),
      coverColor: representative.coverColor || '#f9f9f9',
      tags,
      themes,
      suggestedThemes,
      unmappedTags,
      folderIds,
      folderId: folderIds.length === 1 ? folderIds[0] : null,
      suitableForExamList: value.copies.some((copy) => copy.suitableForExamList),
      easyReading: value.copies.some((copy) => copy.easyReading),
      borrowCount: value.copies.reduce((total, copy) => total + (copy.borrowCount || 0), 0),
      totalCopies,
      borrowedCopies,
      availableCopies,
      copies: value.copies,
    });
  }

  return result;
}

function ensureFolderShape(folder) {
  const source = typeof folder === 'object' && folder ? folder : {};
  const safeFolder = { ...source };
  safeFolder.name = typeof source.name === 'string' ? source.name : '';
  safeFolder.description = typeof source.description === 'string' ? source.description : '';
  safeFolder.color = typeof source.color === 'string' ? source.color : '#9f86c0';
  safeFolder.examList = Boolean(source.examList);
  return safeFolder;
}

function getBorrowCountsMap(historyEntries) {
  const counts = new Map();
  const entries = Array.isArray(historyEntries) ? historyEntries : [];
  for (const entry of entries) {
    if (!entry || !['check_out', 'check_out_class'].includes(entry.type)) {
      continue;
    }
    const rawId = entry.bookId;
    const bookId = typeof rawId === 'string' ? rawId : rawId != null ? String(rawId) : '';
    if (!bookId) {
      continue;
    }
    const current = counts.get(bookId) || 0;
    counts.set(bookId, current + 1);
  }
  return counts;
}

function withBorrowCount(book, borrowCounts) {
  if (!book) {
    return book;
  }
  const bookId = typeof book.id === 'string' ? book.id : book.id != null ? String(book.id) : '';
  const borrowCount = bookId && borrowCounts instanceof Map ? borrowCounts.get(bookId) || 0 : 0;
  return attachDerivedThemeFields({ ...book, borrowCount });
}


function findClassByName(db, name) {
  const key = normalizeClassKey(name);
  if (!key) return null;
  return db.classes.find((klass) => normalizeClassKey(klass.name) === key) || null;
}

function ensureClassRecord(db, name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    return null;
  }
  let klass = findClassByName(db, trimmed);
  if (!klass) {
    klass = {
      id: crypto.randomUUID(),
      name: trimmed,
      teacherIds: [],
      studentIds: [],
    };
    db.classes.push(klass);
  } else {
    if (!Array.isArray(klass.teacherIds)) {
      klass.teacherIds = [];
    }
    if (!Array.isArray(klass.studentIds)) {
      klass.studentIds = [];
    }
  }
  return klass;
}

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

function parseBooleanFlag(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === undefined || value === null) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ['true', '1', 'yes', 'y', 'ja', 'on'].includes(normalized);
}

function collectTeacherNames(db, classRecords) {
  if (!Array.isArray(classRecords) || !classRecords.length) {
    return [];
  }
  const names = new Set();
  for (const klass of classRecords) {
    const teacherIds = Array.isArray(klass.teacherIds) ? klass.teacherIds : [];
    for (const teacherId of teacherIds) {
      const teacher = db.users.find((account) => account.id === teacherId);
      if (teacher) {
        names.add(teacher.name || teacher.username || 'Onbekende docent');
      }
    }
  }
  return Array.from(names);
}

function normalizeRowKeys(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (!key) continue;
    const normalizedKey = normalizeImportHeaderName(key);
    if (!Object.prototype.hasOwnProperty.call(normalized, normalizedKey)) {
      normalized[normalizedKey] = value;
      continue;
    }
    const existingValue = normalized[normalizedKey];
    const hasExistingValue = String(existingValue ?? '').trim() !== '';
    const hasNextValue = String(value ?? '').trim() !== '';
    if (!hasExistingValue && hasNextValue) {
      normalized[normalizedKey] = value;
    }
  }
  return normalized;
}

function normalizeImportHeaderName(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ');
}

function hasImportColumn(normalizedRow, aliases) {
  return aliases.some((alias) =>
    Object.prototype.hasOwnProperty.call(normalizedRow, normalizeImportHeaderName(alias))
  );
}

function collectImportColumnValues(normalizedRow, aliases) {
  return aliases.flatMap((alias) => {
    const key = normalizeImportHeaderName(alias);
    if (!Object.prototype.hasOwnProperty.call(normalizedRow, key)) {
      return [];
    }
    return parseMultiValueField(normalizedRow[key]);
  });
}

function normalizeImportedCell(value) {
  return String(value || '').trim();
}

function deriveNameParts(fullName) {
  const cleanName = normalizeImportedCell(fullName);
  if (!cleanName) {
    return { firstName: '', middleName: '', lastName: '', fullName: '' };
  }
  const parts = cleanName.split(/\s+/);
  if (parts.length === 1) {
    return {
      firstName: parts[0],
      middleName: '',
      lastName: '',
      fullName: parts[0],
    };
  }
  return {
    firstName: parts[0],
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    lastName: parts[parts.length - 1],
    fullName: cleanName,
  };
}

function extractImportedName(normalized) {
  const directName = normalizeImportedCell(
    normalized.naam ||
      normalized.name ||
      normalized.leerling ||
      normalized.student ||
      normalized.docent ||
      normalized.teacher ||
      ''
  );
  const firstName = normalizeImportedCell(
    normalized.voornaam ||
      normalized.firstname ||
      normalized['first name'] ||
      normalized.roepnaam ||
      ''
  );
  const middleName = normalizeImportedCell(
    normalized.tussenvoegsel ||
      normalized.voorvoegsel ||
      normalized.infix ||
      normalized.middle ||
      normalized.middlename ||
      normalized['middle name'] ||
      ''
  );
  const lastName = normalizeImportedCell(
    normalized.achternaam ||
      normalized.lastname ||
      normalized['last name'] ||
      normalized.surname ||
      normalized.familienaam ||
      ''
  );

  if (directName) {
    const derived = deriveNameParts(directName);
    return {
      fullName: directName,
      firstName: firstName || derived.firstName,
      middleName: middleName || derived.middleName,
      lastName: lastName || derived.lastName,
    };
  }

  return {
    fullName: [firstName, middleName, lastName].filter(Boolean).join(' ').trim(),
    firstName,
    middleName,
    lastName,
  };
}

function getPreferredFirstName(account) {
  if (account && typeof account.firstName === 'string' && account.firstName.trim()) {
    return account.firstName.trim();
  }
  if (account && typeof account.name === 'string') {
    const parts = account.name.trim().split(/\s+/).filter(Boolean);
    return parts[0] || account.name.trim();
  }
  return '';
}

function createStudentDisplayName(account, letters = 1) {
  const firstName = getPreferredFirstName(account);
  const lastName = normalizeImportedCell(
    account && account.lastName ? account.lastName : deriveNameParts(account?.name || '').lastName
  );
  if (!lastName) {
    return firstName;
  }
  return `${firstName} ${lastName.substring(0, letters)}.`;
}

function readWorkbookRows(XLSX, base64) {
  let workbook;
  try {
    const buffer = Buffer.from(base64, 'base64');
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (error) {
    return { ok: false, error: 'Het Excelbestand kon niet gelezen worden' };
  }
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { ok: false, error: 'Het bestand bevat geen werkblad' };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) {
    return { ok: false, error: 'Het werkblad is leeg' };
  }
  return { ok: true, rows };
}

// A previously confirmed reviewed import is a durable commit boundary.
// Other legacy import jobs may legitimately update progress while processing;
// rejecting ALL stale snapshots would break those jobs. However, any writer
// whose snapshot predates the latest confirmed PR3 batch MUST fail instead of
// overwriting the new books and the permanent import report.
// A confirmed reviewed import is a separate commit boundary. When a normal
// request waits on body/image I/O we can rebase unrelated live changes, but
// must still reject a request that started before a reviewed import committed.
function assertReviewedImportBoundaryUnchanged(before, after) {
  const lastId = (db) => Array.isArray(db.bookImportReports)
    ? db.bookImportReports[db.bookImportReports.length - 1]?.id || null : null;
  if (lastId(before) !== lastId(after)) {
    const error = new Error('A reviewed import committed while a book edit was pending');
    error.code = 'DATABASE_WRITE_CONFLICT';
    throw error;
  }
}

function assertReviewedImportNotLost(db) {
  const current = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const latest = Array.isArray(current.bookImportReports)
    ? current.bookImportReports[current.bookImportReports.length - 1]?.id
    : null;
  // Historic loan receipts must survive writes from other routes and stale
  // request snapshots, even when their original reports have aged out.
  const previousReceipts = Array.isArray(current.bookImportLoanReceipts)
    ? current.bookImportLoanReceipts : [];
  const proposedReceipts = new Set(Array.isArray(db.bookImportLoanReceipts)
    ? db.bookImportLoanReceipts : []);
  if (previousReceipts.some((key) => !proposedReceipts.has(key))) {
    const error = new Error('A historical Excel loan receipt was lost by a stale database write');
    error.code = 'DATABASE_WRITE_CONFLICT';
    throw error;
  }
  // A stale request may not revert a completed or reassigned follow-up.
  // All task transitions are immutable except for the revisioned replacement.
  // Circulation counters must survive stale requests and rotation of the
  // short activity feed. Never permit an old Excel task to undo a real return.
  const oldActivity = current.bookImportLoanActivityCounters || {};
  const newActivity = db.bookImportLoanActivityCounters || {};
  for (const [bookId, revision] of Object.entries(oldActivity)) {
    const proposed = Object.prototype.hasOwnProperty.call(newActivity, bookId)
      ? newActivity[bookId] : 0;
    if (!Number.isSafeInteger(proposed) || proposed < revision) {
      const error = new Error('A historic circulation revision was lost by a stale database write');
      error.code = 'DATABASE_WRITE_CONFLICT';
      throw error;
    }
  }
  // Reminder preferences must survive delayed image downloads and other
  // writes using a previously loaded database snapshot.
  const storedMailPreferences = current.bookImportEmailPreferences || {};
  const nextMailPreferences = db.bookImportEmailPreferences || {};
  for (const [id, row] of Object.entries(storedMailPreferences)) {
    const proposed = nextMailPreferences[id];
    if (!proposed || !Number.isSafeInteger(proposed.revision)
      || proposed.revision < (row.revision || 0)
      || (proposed.revision === (row.revision || 0)
        && JSON.stringify(proposed) !== JSON.stringify(row))) {
      const error = new Error('An email preference was lost by a stale database write');
      error.code = 'DATABASE_WRITE_CONFLICT';
      throw error;
    }
  }
  const storedTasks = new Map((Array.isArray(current.bookImportFollowups)
    ? current.bookImportFollowups : []).map((task) => [task.id, task]));
  const oldSettingsRevision = Number.isSafeInteger(current.bookImportFollowupSettings?.revision)
    ? current.bookImportFollowupSettings.revision : 0;
  const newSettingsRevision = Number.isSafeInteger(db.bookImportFollowupSettings?.revision)
    ? db.bookImportFollowupSettings.revision : 0;
  if (newSettingsRevision < oldSettingsRevision
    || (newSettingsRevision === oldSettingsRevision
      && JSON.stringify(current.bookImportFollowupSettings || null)
        !== JSON.stringify(db.bookImportFollowupSettings || null))) {
    const error = new Error('Follow-up configuration changed after this request began');
    error.code = 'DATABASE_WRITE_CONFLICT';
    throw error;
  }
  const proposedTasks = new Map((Array.isArray(db.bookImportFollowups)
    ? db.bookImportFollowups : []).map((task) => [task.id, task]));
  for (const [id, task] of storedTasks) {
    const proposed = proposedTasks.get(id);
    if (!proposed || !Number.isSafeInteger(proposed.revision)
      || proposed.revision < task.revision
      || (proposed.revision === task.revision
        && JSON.stringify(proposed) !== JSON.stringify(task))) {
      const error = new Error('Historical book follow-up changed after this request began');
      error.code = 'DATABASE_WRITE_CONFLICT';
      throw error;
    }
  }
  if (!latest) return;
  const stillPresent = Array.isArray(db.bookImportReports)
    && db.bookImportReports.some((report) => report?.id === latest);
  if (!stillPresent) {
    const error = new Error('A confirmed book import was committed after this request began');
    error.code = 'DATABASE_WRITE_CONFLICT';
    throw error;
  }
}

function appendImportClassFollowups(db, report, entries, now) {
  if (!Array.isArray(db.bookImportFollowups)) db.bookImportFollowups = [];
  let created = 0;
  for (const { row, book } of entries) {
    if (!book?.id) throw Error('import_followup_book_missing');
    const context = followupContext(row, db.classes);
    if (!context) continue;
    const previous = db.bookImportFollowups.find((old) => old.bookId === book.id
      && contextMatchesTask(old, context));
    if (previous) {
      if (!Array.isArray(report.followupTaskIds)) report.followupTaskIds = [];
      if (!report.followupTaskIds.includes(previous.id)) report.followupTaskIds.push(previous.id);
      continue;
    }
    const task = makeTask({
      id: crypto.randomUUID(), reportId: report.id, book, row, context, createdAt: now,
      loanActivityRevision: circulationRevision(db, book.id),
    });
    db.bookImportFollowups.push(task);
    if (!Array.isArray(report.followupTaskIds)) report.followupTaskIds = [];
    report.followupTaskIds.push(task.id);
    created++;
  }
  report.followupTasksCreated = created;
  updateReportCompletion(db, report.id);
}

function loadDb() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.books)) data.books = [];
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.classes)) data.classes = [];
  if (!Array.isArray(data.students)) data.students = [];
  if (!Array.isArray(data.folders)) data.folders = [];
  if (!Array.isArray(data.history)) data.history = [];
  if (!Array.isArray(data.importJobs)) data.importJobs = [];
  if (!Array.isArray(data.bookImportFollowups)) data.bookImportFollowups = [];
  if (!data.bookImportEmailPreferences || typeof data.bookImportEmailPreferences !== 'object'
    || Array.isArray(data.bookImportEmailPreferences)) data.bookImportEmailPreferences = {};
  data.books = data.books.map(ensureBookShape);
  data.students = data.students.map(ensureStudentShape);
  data.classes = data.classes.map(ensureClassShape);
  data.folders = data.folders.map(ensureFolderShape);
  data.users = data.users.map(ensureTeacherShape);
  return data;
}

function saveDb(db) {
  assertReviewedImportNotLost(db);
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2));
}

// The reviewed book import is one confirmed transaction. Write its complete
// database snapshot to a sibling file first, then atomically replace the old
// snapshot so a failed or interrupted write cannot leave half a JSON document.
function saveReviewedBookImportDb(db) {
  assertReviewedImportNotLost(db);
  const raw = JSON.stringify(db, null, 2);
  const temporaryPath = DATA_PATH + '.reviewed-' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporaryPath, raw, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryPath, DATA_PATH);
  } finally {
    try { fs.unlinkSync(temporaryPath); } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Tijdelijke importdatabase opruimen mislukt:', error.message);
    }
  }
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function getTokenFromHeader(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.*)$/i);
  return match ? match[1] : null;
}

function getAuthenticatedUser(req, getDb) {
  const token = getTokenFromHeader(req);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  const db = getDb();
  if (session.type === 'staff') {
    const user = db.users.find((entry) => entry.id === session.userId);
    if (!user) {
      sessions.delete(token);
      return null;
    }
    return { ...user, token };
  }
  if (session.type === 'student') {
    const student = db.students.find((entry) => entry.id === session.userId);
    if (!student) {
      sessions.delete(token);
      return null;
    }
    return {
      id: student.id,
      name: student.name,
      role: 'student',
      grade: student.grade || '',
      borrowedBooks: student.borrowedBooks,
      classIds: student.classIds,
      username: student.username,
      token,
    };
  }
  sessions.delete(token);
  return null;
}

function ensureRole(user, roles) {
  if (!user) return false;
  if (!roles || roles.length === 0) return true;
  return roles.includes(user.role);
}

function updateImportJob(db, jobId, updates = {}) {
  if (!Array.isArray(db.importJobs)) {
    db.importJobs = [];
  }
  const index = db.importJobs.findIndex((entry) => entry?.id === jobId);
  if (index === -1) return null;
  const updatedAt = new Date().toISOString();
  db.importJobs[index] = {
    ...db.importJobs[index],
    ...updates,
    updatedAt,
  };
  return db.importJobs[index];
}

function sanitizeStudent(student, options = {}) {
  if (!student) return null;
  const base = {
    id: student.id,
    name: student.name,
    grade: student.grade || '',
    borrowedBooks: Array.isArray(student.borrowedBooks) ? student.borrowedBooks : [],
    classIds: Array.isArray(student.classIds) ? student.classIds : [],
    mustChangePassword: Boolean(student.mustChangePassword),
  };
  if (options.includeUsername) {
    base.username = student.username || '';
  }
  return base;
}

function sanitizeTeacher(teacher) {
  if (!teacher) return null;
  return {
    id: teacher.id,
    name: teacher.name,
    username: teacher.username || '',
    classIds: Array.isArray(teacher.classIds) ? teacher.classIds : [],
    mustChangePassword: Boolean(teacher.mustChangePassword),
  };
}

function findStudentByUsername(db, username) {
  const normalized = username.trim().toLowerCase();
  return db.students.find((entry) => (entry.username || '').toLowerCase() === normalized);
}

function generatePassword(length = 8) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function isUsernameTaken(db, username, { allowStudentId = null, allowUserId = null } = {}) {
  const normalized = String(username || '').trim().toLowerCase();
  if (
    db.users.some((user) => {
      if (!user || typeof user.username !== 'string') {
        return false;
      }
      if (allowUserId && user.id === allowUserId) {
        return false;
      }
      return user.username.toLowerCase() === normalized;
    })
  ) {
    return true;
  }
  return db.students.some((student) => {
    if (!student || typeof student.username !== 'string') {
      return false;
    }
    if (allowStudentId && student.id === allowStudentId) {
      return false;
    }
    return student.username.toLowerCase() === normalized;
  });
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toStringList(value) {
  return toArray(value)
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      if (typeof entry === 'object') {
        return entry.name || entry.full_name || entry.label || entry.value || entry.text || null;
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeIsbn(value) {
  if (!value) return '';
  return String(value).toUpperCase().replace(/[^0-9X]/g, '');
}

function sanitizeIsbn(value) {
  return normalizeIsbn(value);
}

function stripHtml(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractPublishedYear(publishedDate) {
  return normalizePublishedYear(publishedDate);
}

function formatAuthors(authors) {
  if (!Array.isArray(authors)) {
    return '';
  }
  return authors
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .join(', ');
}

function pickGoogleBooksCover(imageLinks) {
  if (!imageLinks || typeof imageLinks !== 'object') {
    return '';
  }
  const sizes = ['extraLarge', 'large', 'medium', 'small', 'thumbnail', 'smallThumbnail'];
  for (const size of sizes) {
    const candidate = normalizeCoverUrl(imageLinks[size]);
    if (candidate) {
      return candidate;
    }
  }
  return '';
}

function createMetadataFieldSummary(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  return {
    title: typeof metadata.title === 'string' ? metadata.title : '',
    author: typeof metadata.author === 'string' ? metadata.author : '',
    publisher: typeof metadata.publisher === 'string' ? metadata.publisher : '',
    hasDescription: Boolean(metadata.description),
    hasCoverUrl: Boolean(metadata.coverUrl),
    source: metadata.source || null,
    found: Boolean(metadata.found),
  };
}

function logIsbnLookupDebug(stage, details) {
  if (!DEBUG_ISBN_LOOKUP) {
    return;
  }
  if (details === undefined) {
    console.info(`[ISBN_LOOKUP_DEBUG] ${stage}`);
    return;
  }
  console.info(`[ISBN_LOOKUP_DEBUG] ${stage}`, details);
}

function logImportFallbackDebug(stage, details) {
  if (!DEBUG_ISBN_LOOKUP) {
    return;
  }
  if (details === undefined) {
    console.info(`[IMPORT_FALLBACK_DEBUG] ${stage}`);
    return;
  }
  console.info(`[IMPORT_FALLBACK_DEBUG] ${stage}`, details);
}

function logImportFallbackVerbose(stage, details) {
  if (!DEBUG_IMPORT_FALLBACK_VERBOSE) {
    return;
  }
  logImportFallbackDebug(stage, details);
}

function summarizeIndustryIdentifiers(item) {
  const identifiers = Array.isArray(item?.volumeInfo?.industryIdentifiers)
    ? item.volumeInfo.industryIdentifiers
    : [];
  return identifiers.map((identifier) => ({
    type: identifier?.type || '',
    identifier: identifier?.identifier || '',
    normalized: normalizeIsbn(identifier?.identifier),
  }));
}

function hasExactIsbnMatch(item, isbn, debugInfo = null) {
  const normalizedIsbn = normalizeIsbn(isbn);
  if (debugInfo && typeof debugInfo === 'object') {
    debugInfo.normalizedTarget = normalizedIsbn;
    debugInfo.identifiers = summarizeIndustryIdentifiers(item);
  }
  if (!normalizedIsbn || !item || typeof item !== 'object') {
    if (debugInfo && typeof debugInfo === 'object') {
      debugInfo.match = false;
      debugInfo.reason = !normalizedIsbn ? 'invalid_target_isbn' : 'invalid_item';
    }
    return false;
  }
  const identifiers = Array.isArray(item.volumeInfo?.industryIdentifiers)
    ? item.volumeInfo.industryIdentifiers
    : [];
  if (!identifiers.length) {
    if (debugInfo && typeof debugInfo === 'object') {
      debugInfo.match = false;
      debugInfo.reason = 'no_industry_identifiers';
    }
    return false;
  }
  const matchedIdentifier = identifiers.find(
    (identifier) => normalizeIsbn(identifier?.identifier) === normalizedIsbn
  );
  if (debugInfo && typeof debugInfo === 'object') {
    debugInfo.match = Boolean(matchedIdentifier);
    debugInfo.reason = matchedIdentifier ? 'exact_identifier_match' : 'identifier_mismatch';
    debugInfo.matchedIdentifier = matchedIdentifier
      ? {
        type: matchedIdentifier.type || '',
        identifier: matchedIdentifier.identifier || '',
      }
      : null;
  }
  return Boolean(matchedIdentifier);
}

function normalizeBarcode(value) {
  if (value == null) {
    return '';
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return '';
  }
  const hasTrailingX = /x$/i.test(trimmed);
  const digitsOnly = trimmed.replace(/[^0-9]/g, '');
  if (!digitsOnly && !hasTrailingX) {
    return '';
  }
  return hasTrailingX ? `${digitsOnly}X` : digitsOnly;
}

function normalizeGroupValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function getBookGroupComponents(book) {
  if (!book) {
    return null;
  }
  const barcode = normalizeBarcode(book.barcode);
  if (!barcode) {
    return null;
  }
  return {
    barcode,
    titleKey: normalizeGroupValue(book.title || ''),
    authorKey: normalizeGroupValue(book.author || ''),
    metadataIsbnKey: sanitizeIsbn(book.metadataIsbn),
  };
}

function createBarcodeGroupIdFromComponents(components) {
  if (!components?.barcode) {
    return '';
  }
  const base = [
    components.barcode,
    components.titleKey || '',
    components.authorKey || '',
    components.metadataIsbnKey || '',
  ].join('|');
  const hash = crypto.createHash('sha1').update(base).digest('hex');
  return `grp_${components.barcode}_${hash}`;
}

function getBookGroupId(book) {
  const components = getBookGroupComponents(book);
  if (!components) {
    return '';
  }
  return createBarcodeGroupIdFromComponents(components);
}

function isBarcodeGroupId(value) {
  if (typeof value !== 'string') {
    return false;
  }
  return /^grp_[0-9X]+_[0-9a-f]{40}$/i.test(value.trim());
}

function parseBarcodeGroupId(value) {
  if (!isBarcodeGroupId(value)) {
    return null;
  }
  const match = value.trim().match(/^grp_([0-9X]+)_([0-9a-f]{40})$/i);
  if (!match) {
    return null;
  }
  return { barcode: match[1], hash: match[2] };
}

function buildBarcodeGroups(db, normalizedBarcode) {
  const barcode = normalizeBarcode(normalizedBarcode);
  if (!barcode) {
    return { barcode: '', groups: [] };
  }
  const matches = db.books.filter((book) => normalizeBarcode(book.barcode) === barcode);
  const groupsMap = new Map();
  for (const book of matches) {
    const components = getBookGroupComponents(book);
    if (!components) {
      continue;
    }
    const key = JSON.stringify([
      components.titleKey || '',
      components.authorKey || '',
      components.metadataIsbnKey || '',
    ]);
    let group = groupsMap.get(key);
    if (!group) {
      group = {
        id: createBarcodeGroupIdFromComponents(components),
        barcode,
        title: book.title,
        author: book.author,
        metadataIsbn: sanitizeIsbn(book.metadataIsbn),
        books: [],
      };
      groupsMap.set(key, group);
    }
    group.books.push(book);
  }
  const groups = Array.from(groupsMap.values()).map((group) => {
    const availableCopies = group.books.filter((entry) => entry.status !== 'borrowed').length;
    const totalCopies = group.books.length;
    return {
      ...group,
      totalCopies,
      availableCopies,
      borrowed: totalCopies - availableCopies,
    };
  });
  groups.sort((a, b) => {
    const titleDiff = normalizeGroupValue(a.title).localeCompare(normalizeGroupValue(b.title));
    if (titleDiff !== 0) {
      return titleDiff;
    }
    return normalizeGroupValue(a.author).localeCompare(normalizeGroupValue(b.author));
  });
  return { barcode, groups };
}

function sanitizeBarcodeGroupsForResponse(grouping) {
  return {
    barcode: grouping.barcode,
    groups: grouping.groups.map(({ id, title, author, metadataIsbn, totalCopies, availableCopies, borrowed, books }) => ({
      id,
      title,
      author,
      metadataIsbn,
      totalCopies,
      availableCopies,
      borrowed,
      books: books.map((book) => sanitizeBookForResponse(book)),
    })),
  };
}

function findBarcodeGroupById(db, groupId) {
  const parsed = parseBarcodeGroupId(groupId);
  if (!parsed) {
    return null;
  }
  const grouping = buildBarcodeGroups(db, parsed.barcode);
  return grouping.groups.find((group) => group.id === groupId) || null;
}

function selectBookFromGroup(group, { requireAvailable = false, mustBeBorrowed = false,
  studentId = null, classId = null } = {}) {
  if (!group) {
    return null;
  }
  const books = Array.isArray(group.books) ? group.books : [];
  if (requireAvailable) {
    return books.find((book) => book.status !== 'borrowed') || null;
  }
  if (mustBeBorrowed) {
    if (classId) {
      return books.find((book) => book.status === 'borrowed'
        && book.borrowedByClassId === classId && !book.borrowedBy) || null;
    }
    if (studentId) {
      // Never fall back to a different person's borrowed book.
      return books.find((book) => book.status === 'borrowed'
        && book.borrowedBy === studentId && !book.borrowedByClassId) || null;
    }
    return books.find((book) => book.status === 'borrowed') || null;
  }
  if (studentId) {
    const owned = books.find((book) => book.borrowedBy === studentId);
    if (owned) {
      return owned;
    }
  }
  return books[0] || null;
}

function getGroupForBook(db, book) {
  if (!book) {
    return null;
  }
  const groupId = getBookGroupId(book);
  if (!groupId) {
    return null;
  }
  return findBarcodeGroupById(db, groupId);
}

function studentHasLoanInGroup(student, group) {
  if (!student || !group) {
    return false;
  }
  const borrowedIds = new Set((student.borrowedBooks || []).map((entry) => entry.bookId));
  return group.books.some((book) => borrowedIds.has(book.id));
}

function resolveBookSelection(db, identifier, options = {}) {
  const {
    body = {},
    requireAvailable = false,
    mustBeBorrowed = false,
    studentId = null,
    classId = null,
  } = options;

  const normalizedIdentifier = typeof identifier === 'string' ? identifier.trim() : '';
  const candidateIds = Array.from(new Set([normalizedIdentifier, body.bookId])).filter(Boolean);
  for (const candidate of candidateIds) {
    const book = findBookById(db, candidate);
    if (!book) {
      continue;
    }
    if (requireAvailable && book.status === 'borrowed') {
      return { error: 'Boek is al uitgeleend', statusCode: 400 };
    }
    if (mustBeBorrowed && book.status !== 'borrowed') {
      return { error: 'Dit exemplaar is al beschikbaar', statusCode: 400 };
    }
    const group = getGroupForBook(db, book);
    return { book, group };
  }

  const candidateGroupIds = Array.from(new Set([body.groupId, normalizedIdentifier])).filter((value) =>
    isBarcodeGroupId(value)
  );
  for (const groupId of candidateGroupIds) {
    const group = findBarcodeGroupById(db, groupId);
    if (!group) {
      continue;
    }
    const book = selectBookFromGroup(group, { requireAvailable, mustBeBorrowed, studentId, classId });
    if (!book) {
      const message = requireAvailable
        ? 'Geen beschikbare exemplaren voor deze titel'
        : 'Geen uitgeleende exemplaren gevonden voor deze titel';
      return { error: message, statusCode: requireAvailable ? 400 : 404 };
    }
    return { book, group };
  }

  const candidateBarcodes = Array.from(new Set([body.barcode, normalizedIdentifier]))
    .map((value) => normalizeBarcode(value))
    .filter(Boolean);
  for (const barcode of candidateBarcodes) {
    const grouping = buildBarcodeGroups(db, barcode);
    if (!grouping.groups.length) {
      continue;
    }
    let group = null;
    if (body.groupId) {
      group = grouping.groups.find((entry) => entry.id === body.groupId);
    }
    if (!group && body.metadataIsbn) {
      const metadataKey = sanitizeIsbn(body.metadataIsbn);
      group = grouping.groups.find((entry) => sanitizeIsbn(entry.metadataIsbn) === metadataKey);
    }
    if (!group && body.title) {
      const titleKey = normalizeGroupValue(body.title);
      const authorKey = normalizeGroupValue(body.author || '');
      group = grouping.groups.find((entry) => {
        const entryTitle = normalizeGroupValue(entry.title || '');
        const entryAuthor = normalizeGroupValue(entry.author || '');
        if (titleKey && entryTitle !== titleKey) {
          return false;
        }
        if (authorKey && entryAuthor !== authorKey) {
          return false;
        }
        return true;
      });
    }
    if (!group) {
      if (grouping.groups.length === 1) {
        group = grouping.groups[0];
      } else {
        return {
          error: 'Meerdere titels gevonden voor deze barcode. Geef een titel of groep-ID op.',
          statusCode: 400,
        };
      }
    }
    const book = selectBookFromGroup(group, { requireAvailable, mustBeBorrowed, studentId, classId });
    if (!book) {
      const message = requireAvailable
        ? 'Geen beschikbare exemplaren voor deze titel'
        : 'Geen uitgeleende exemplaren gevonden voor deze titel';
      return { error: message, statusCode: requireAvailable ? 400 : 404 };
    }
    return { book, group };
  }

  return { error: 'Boek niet gevonden', statusCode: 404 };
}

function parseIsbnBarcodeData(data, fallbackBarcode) {
  if (!data || typeof data !== 'object') return null;
  const title = data.title || data.book_title || data.item_name || data.name || '';
  const authorStrings = toStringList(data.author || data.author_name || data.authors || data.contributors);
  const author = typeof data.author === 'string'
    ? data.author
    : authorStrings[0] || '';
  const description = typeof data.description === 'string'
    ? data.description
    : data.description?.value || data.synopsis || data.summary || '';
  const publisher = toStringList(data.publisher || data.publisher_name || data.publishers).join(', ');
  const publishedAt = data.publish_date || data.publication_date || '';
  const language = toStringList(data.language || data.languages || data.language_name).join(', ');
  if (!title && !author && !description && !publisher) {
    return null;
  }
  return {
    barcode: sanitizeIsbn(data.isbn || data.ean || fallbackBarcode),
    title,
    author,
    authors: authorStrings,
    description,
    publisher,
    publishedAt,
    language,
    source: 'isbnbarcode.org',
    found: true,
  };
}

function normalizeLookupTagValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function normalizeWorkTitle(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bp\s*\.?\s*s\s*\.?\b/gu, 'ps')
    .replace(/^\s*[\p{L}\p{N}'’\- ]{2,50},\s*/u, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return '';
  }
  const editionTokens = new Set([
    'druk', 'editie', 'edition', 'paperback', 'hardcover', 'lijsters', 'pocketserie',
    'pocket', 'schooluitgave', 'school', 'herziene', 'uitgave', 'dr', 'ed',
  ]);
  const tokens = normalized.split(' ').filter(Boolean);
  return tokens
    .filter((token, index) => {
      if (!token || editionTokens.has(token)) {
        return false;
      }
      const prev = tokens[index - 1] || '';
      const next = tokens[index + 1] || '';
      const isEditionOrdinal = /^\d+(?:e|de|ste)?$/i.test(token) && (editionTokens.has(prev) || editionTokens.has(next));
      return !isEditionOrdinal;
    })
    .join(' ')
    .trim();
}

function normalizeAuthorName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  let normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = normalized.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const betweenTokens = new Set(['van', 'de', 'den', 'der', 'ten', 'ter', 'het', 'op', "'t"]);
    const headTokens = parts[0].split(' ').filter(Boolean);
    const tailTokens = parts.slice(1).join(' ').split(' ').filter(Boolean);
    if (tailTokens.length && tailTokens.every((token) => betweenTokens.has(token))) {
      if (headTokens.length >= 2) {
        normalized = `${headTokens.slice(0, -1).join(' ')} ${tailTokens.join(' ')} ${headTokens[headTokens.length - 1]}`;
      } else if (headTokens.length === 1) {
        normalized = `${tailTokens.join(' ')} ${headTokens[0]}`;
      }
    }
  }
  return normalized
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSeriesPart(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.toLowerCase();
  const match = normalized.match(/\b(?:deel|part|boek|book)\s*([0-9ivxlcdm]+)/i);
  return match ? match[1] : '';
}

function hasCollectionMarker(value) {
  if (typeof value !== 'string') {
    return false;
  }
  return /\b(omnibus|bundel|verzameld werk|anthology|collection)\b/i.test(value);
}

function isStrictWorkMatch(target, candidate) {
  if (!target || !candidate) {
    return false;
  }
  const targetTitle = normalizeWorkTitle(target.title);
  const candidateTitle = normalizeWorkTitle(candidate.title);
  const targetPrimaryTitle = normalizeWorkTitle((target.title || '').replace(/\([^)]*\)/g, ' '));
  const candidatePrimaryTitle = normalizeWorkTitle((candidate.title || '').replace(/\([^)]*\)/g, ' '));
  const titleMatches = !!targetTitle
    && !!candidateTitle
    && (
      targetTitle === candidateTitle
      || (targetPrimaryTitle && targetPrimaryTitle === candidatePrimaryTitle)
      || (targetPrimaryTitle && targetPrimaryTitle === candidateTitle)
      || (candidatePrimaryTitle && candidatePrimaryTitle === targetTitle)
    );
  if (!titleMatches) {
    return false;
  }

  const targetAuthor = normalizeAuthorName(target.author);
  const candidateAuthor = normalizeAuthorName(candidate.author);
  if (!targetAuthor || !candidateAuthor) {
    return false;
  }
  const exactAuthorMatch = targetAuthor === candidateAuthor;
  const targetTokens = targetAuthor.split(' ').filter(Boolean);
  const candidateTokens = candidateAuthor.split(' ').filter(Boolean);
  const sameSurname = targetTokens[targetTokens.length - 1] && targetTokens[targetTokens.length - 1] === candidateTokens[candidateTokens.length - 1];
  const firstInitialMatch = targetTokens[0]?.[0] && candidateTokens[0]?.[0] && targetTokens[0][0] === candidateTokens[0][0];
  if (!exactAuthorMatch && !(sameSurname && firstInitialMatch)) {
    return false;
  }

  if (target.language && candidate.language && normalizeLanguageCode(target.language) && normalizeLanguageCode(candidate.language)
    && normalizeLanguageCode(target.language) !== normalizeLanguageCode(candidate.language)) {
    return false;
  }

  const targetPart = extractSeriesPart(target.rawTitle || target.title);
  const candidatePart = extractSeriesPart(candidate.rawTitle || candidate.title);
  if (targetPart !== candidatePart) {
    return false;
  }

  if (hasCollectionMarker(target.rawTitle || target.title) !== hasCollectionMarker(candidate.rawTitle || candidate.title)) {
    return false;
  }

  return true;
}

function splitLookupTagParts(value) {
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(/\s*\/\s*|\s+[–-]\s+|\s+[–-]|[–-]\s+/)
    .map((part) => normalizeLookupTagValue(part))
    .filter(Boolean);
}

function appendUniqueLookupTags(target, values, { splitComposite = false } = {}) {
  if (!Array.isArray(target)) {
    return [];
  }

  const queue = Array.isArray(values) ? values : [values];
  for (const entry of queue) {
    if (typeof entry !== 'string') {
      continue;
    }
    const parts = splitComposite ? splitLookupTagParts(entry) : [normalizeLookupTagValue(entry)];
    for (const part of parts) {
      if (part && !target.includes(part)) {
        target.push(part);
      }
    }
  }
  return target;
}

function parseGoogleBooksData(data, fallbackBarcode, debugTarget = null) {
  const items = Array.isArray(data?.items) ? data.items : [];
  if (debugTarget && typeof debugTarget === 'object') {
    debugTarget.itemCount = items.length;
    debugTarget.exactMatchFound = false;
    debugTarget.candidates = [];
    debugTarget.extracted = null;
  }
  if (!items.length) {
    return null;
  }
  let matchedItem = null;
  for (const item of items) {
    const matchDebug = {};
    const exactMatch = hasExactIsbnMatch(item, fallbackBarcode, matchDebug);
    const volumeInfo = item?.volumeInfo || {};
    const candidate = {
      id: item?.id || '',
      title: typeof volumeInfo.title === 'string' ? volumeInfo.title : '',
      identifiers: matchDebug.identifiers || [],
      hasDescription: Boolean(volumeInfo.description),
      hasPublisher: Boolean(volumeInfo.publisher),
      hasImageLinks: Boolean(volumeInfo.imageLinks && typeof volumeInfo.imageLinks === 'object'),
      exactMatch,
      rejectReason: matchDebug.reason || null,
      chosen: false,
    };
    if (exactMatch && !matchedItem) {
      matchedItem = item;
      candidate.chosen = true;
      if (debugTarget && typeof debugTarget === 'object') {
        debugTarget.exactMatchFound = true;
      }
    }
    if (debugTarget && typeof debugTarget === 'object') {
      debugTarget.candidates.push(candidate);
    }
  }
  if (!matchedItem) {
    return null;
  }
  const volumeInfo = matchedItem.volumeInfo;
  if (!volumeInfo || typeof volumeInfo !== 'object') {
    return null;
  }
  const authors = Array.isArray(volumeInfo.authors)
    ? volumeInfo.authors.filter((entry) => typeof entry === 'string' && entry.trim())
    : [];
  const title = typeof volumeInfo.title === 'string' ? volumeInfo.title.trim() : '';
  const publisher = normalizePublisher(volumeInfo.publisher);
  const description = stripHtml(volumeInfo.description);
  const language = normalizeLanguageCode(volumeInfo.language);
  const publishedAt = typeof volumeInfo.publishedDate === 'string' ? volumeInfo.publishedDate.trim() : '';
  const publishedYear = extractPublishedYear(volumeInfo.publishedDate);
  const pageCount = normalizePageCountValue(volumeInfo.pageCount);
  const previewLink = typeof volumeInfo.previewLink === 'string'
    ? volumeInfo.previewLink.trim()
    : typeof matchedItem.previewLink === 'string'
      ? matchedItem.previewLink.trim()
      : '';
  const coverUrl = pickGoogleBooksCover(volumeInfo.imageLinks);
  const metadata = {
    barcode: fallbackBarcode,
    title,
    authors,
    author: formatAuthors(authors),
    publisher,
    publishedAt,
    publishedYear,
    description,
    pageCount,
    language,
    previewLink,
    coverUrl,
    source: 'googlebooks',
    found: true,
  };
  const tags = Array.isArray(metadata.tags) ? [...metadata.tags] : [];
  appendUniqueLookupTags(tags, volumeInfo.mainCategory);
  appendUniqueLookupTags(tags, Array.isArray(volumeInfo.categories) ? volumeInfo.categories : volumeInfo.categories ? [volumeInfo.categories] : [], { splitComposite: true });
  metadata.tags = Array.from(new Set(tags));
  if (!title && !authors.length && !publisher && !description && !coverUrl && !metadata.tags.length) {
    return null;
  }
  if (debugTarget && typeof debugTarget === 'object') {
    debugTarget.extracted = createMetadataFieldSummary(metadata);
  }
  return metadata;
}

function parseGoogleBooksTitleAuthorFallbackData(data, target, debugContext = null) {
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) {
    logImportFallbackDebug('fallback_result', {
      accepted: false,
      acceptedFields: [],
      rejectReason: 'no_candidates',
      source: 'googlebooks',
      ...(debugContext && typeof debugContext === 'object' ? { context: debugContext } : {}),
    });
    return null;
  }
  const strictMatches = [];
  for (const item of items) {
    const volumeInfo = item?.volumeInfo;
    if (!volumeInfo || typeof volumeInfo !== 'object') {
      logImportFallbackVerbose('fallback_candidate', {
        title: '',
        author: '',
        hasCoverUrl: false,
        hasPublisher: false,
        hasDescription: false,
        candidateRichnessScore: 0,
        selectedCandidate: false,
        strictMatch: false,
        rejectReason: 'invalid_volume_info',
      });
      continue;
    }
    const authors = Array.isArray(volumeInfo.authors)
      ? volumeInfo.authors.filter((entry) => typeof entry === 'string' && entry.trim())
      : [];
    const metadata = {
      title: typeof volumeInfo.title === 'string' ? volumeInfo.title.trim() : '',
      rawTitle: typeof volumeInfo.title === 'string' ? volumeInfo.title.trim() : '',
      author: formatAuthors(authors),
      language: normalizeLanguageCode(volumeInfo.language),
      publisher: normalizePublisher(volumeInfo.publisher),
      description: stripHtml(volumeInfo.description),
      coverUrl: pickGoogleBooksCover(volumeInfo.imageLinks),
      source: 'googlebooks-title-author',
      found: true,
    };
    const candidateRichnessScore = [
      Boolean(metadata.coverUrl),
      Boolean(metadata.publisher),
      Boolean(metadata.description),
      Boolean(metadata.author),
    ].filter(Boolean).length;
    const strictMatch = isStrictWorkMatch(target, metadata);
    logImportFallbackVerbose('fallback_candidate', {
      title: metadata.title,
      author: metadata.author,
      hasCoverUrl: Boolean(metadata.coverUrl),
      hasPublisher: Boolean(metadata.publisher),
      hasDescription: Boolean(metadata.description),
      candidateRichnessScore,
      selectedCandidate: false,
      strictMatch,
      rejectReason: strictMatch ? null : 'strict_work_mismatch',
    });
    if (strictMatch) {
      strictMatches.push({ metadata, candidateRichnessScore });
    }
  }
  if (strictMatches.length) {
    strictMatches.sort((left, right) => right.candidateRichnessScore - left.candidateRichnessScore);
    const selected = strictMatches[0];
    const selectedMetadata = selected.metadata;
    logImportFallbackVerbose('fallback_candidate_selected', {
      title: selectedMetadata.title,
      author: selectedMetadata.author,
      hasCoverUrl: Boolean(selectedMetadata.coverUrl),
      hasPublisher: Boolean(selectedMetadata.publisher),
      hasDescription: Boolean(selectedMetadata.description),
      candidateRichnessScore: selected.candidateRichnessScore,
      selectedCandidate: true,
      strictMatch: true,
      rejectReason: null,
    });
    const acceptedFields = [];
    if (selectedMetadata.coverUrl) acceptedFields.push('coverUrl');
    if (selectedMetadata.publisher) acceptedFields.push('publisher');
    if (selectedMetadata.description) acceptedFields.push('description');
    logImportFallbackDebug('fallback_result', {
      accepted: true,
      acceptedFields,
      source: selectedMetadata.source || 'googlebooks-title-author',
      ...(debugContext && typeof debugContext === 'object' ? { context: debugContext } : {}),
    });
    return selectedMetadata;
  }
  logImportFallbackDebug('fallback_result', {
    accepted: false,
    acceptedFields: [],
    rejectReason: 'no_strict_match',
    source: 'googlebooks',
    ...(debugContext && typeof debugContext === 'object' ? { context: debugContext } : {}),
  });
  return null;
}

function escapeGoogleBooksQuotedTerm(value) {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function getTitleAuthorFallbackPrimaryTitle(title) {
  if (typeof title !== 'string') {
    return '';
  }
  return title.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildTitleAuthorLookupVariants(title, author) {
  const variants = [];
  const quotedTitle = escapeGoogleBooksQuotedTerm(title);
  const quotedAuthor = escapeGoogleBooksQuotedTerm(author);
  variants.push({
    variant: 'strict_quoted_title_author',
    query: `intitle:"${quotedTitle}" inauthor:"${quotedAuthor}"`,
  });
  const primaryTitle = getTitleAuthorFallbackPrimaryTitle(title);
  if (primaryTitle && primaryTitle !== title) {
    variants.push({
      variant: 'strict_primary_title_author',
      query: `intitle:"${escapeGoogleBooksQuotedTerm(primaryTitle)}" inauthor:"${quotedAuthor}"`,
    });
  }
  variants.push({
    variant: 'quoted_title_relaxed_author',
    query: `intitle:"${quotedTitle}" inauthor:${escapeGoogleBooksQuotedTerm(author)}`,
  });
  variants.push({
    variant: 'quoted_title_only',
    query: `intitle:"${quotedTitle}"`,
  });
  return variants;
}

function buildStrictWorkMatchConstraintFingerprint(target) {
  if (!target || typeof target !== 'object') {
    return '||||';
  }
  const normalizedTitle = normalizeWorkTitle(target.title);
  const normalizedAuthor = normalizeAuthorName(target.author);
  const normalizedLanguage = normalizeLanguageCode(target.language) || '';
  const rawTitleContext = target.rawTitle || target.title || '';
  const seriesPart = extractSeriesPart(rawTitleContext);
  const collectionMarker = hasCollectionMarker(rawTitleContext) ? '1' : '0';
  return [
    normalizedTitle,
    normalizedAuthor,
    normalizedLanguage,
    seriesPart,
    collectionMarker,
  ].join('|||');
}

function getTitleAuthorFallbackCacheKey(target, variant) {
  return `${buildStrictWorkMatchConstraintFingerprint(target)}|||${variant}`;
}

function getCachedTitleAuthorFallbackResult(cacheKey, now = Date.now()) {
  const cached = titleAuthorFallbackCache.get(cacheKey);
  if (!cached) {
    return { hit: false, value: null };
  }
  if (cached.expiresAt <= now) {
    titleAuthorFallbackCache.delete(cacheKey);
    return { hit: false, value: null };
  }
  return { hit: true, value: cached.value };
}

function setCachedTitleAuthorFallbackResult(cacheKey, value, now = Date.now()) {
  titleAuthorFallbackCache.set(cacheKey, {
    value,
    expiresAt: now + TITLE_AUTHOR_FALLBACK_CACHE_TTL_MS,
  });
}

function isTransientFallbackStatus(status) {
  return status === 429 || status === 503;
}

function getFallbackCooldownRemainingMs(now = Date.now()) {
  if (!Number.isFinite(googleBooksFallbackCooldownUntil) || googleBooksFallbackCooldownUntil <= now) {
    googleBooksFallbackCooldownUntil = 0;
    googleBooksFallbackCooldownReason = '';
    return 0;
  }
  return googleBooksFallbackCooldownUntil - now;
}

function activateFallbackCooldown(reason, retryAfterMs = null, now = Date.now()) {
  const durationMs = Math.max(
    TITLE_AUTHOR_FALLBACK_COOLDOWN_MS,
    Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0,
  );
  googleBooksFallbackCooldownUntil = now + durationMs;
  googleBooksFallbackCooldownReason = reason || 'rate_limited';
  return durationMs;
}

function isTransientFallbackNetworkError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code && ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) {
    return true;
  }
  return error instanceof TypeError;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRetryAfterMs(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const asSeconds = Number(text);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }
  const asDate = Date.parse(text);
  if (!Number.isFinite(asDate)) {
    return null;
  }
  const delta = asDate - Date.now();
  return delta > 0 ? delta : 0;
}

function getFallbackRetryDelayMs(attempt, response = null) {
  const jitterMs = Math.round(Math.random() * 60);
  const baseDelayMs = Math.round(TITLE_AUTHOR_FALLBACK_RETRY_BASE_MS * (2 ** attempt) + jitterMs);
  const retryAfterHeader = response?.headers?.get?.('retry-after');
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  if (retryAfterMs === null) {
    return { delayMs: baseDelayMs, usedRetryAfter: false };
  }
  return {
    delayMs: Math.max(baseDelayMs, retryAfterMs),
    usedRetryAfter: true,
  };
}

async function fetchGoogleBooksFallbackWithRetry(queryUrl, variant) {
  let attempt = 0;
  for (;;) {
    try {
      const response = await globalFetch(queryUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Boekenbaai/1.0 (+https://boekenbaai.example)',
          'x-goog-api-key': process.env.GOOGLE_BOOKS_API_KEY,
        },
      });
      const shouldRetryStatus = response.status === 503;
      if (!response.ok && shouldRetryStatus && attempt < TITLE_AUTHOR_FALLBACK_MAX_RETRIES) {
        const { delayMs, usedRetryAfter } = getFallbackRetryDelayMs(attempt, response);
        logImportFallbackDebug('fallback_lookup_retry', {
          variant,
          attempt: attempt + 1,
          reason: `http_${response.status}`,
          delayMs,
          usedRetryAfter,
        });
        attempt += 1;
        await wait(delayMs);
        continue;
      }
      if (attempt > 0 && response.ok) {
        logImportFallbackDebug('fallback_lookup_retry_success', {
          variant,
          attempt: attempt + 1,
        });
      }
      return response;
    } catch (error) {
      if (isTransientFallbackNetworkError(error) && attempt < TITLE_AUTHOR_FALLBACK_MAX_RETRIES) {
        const { delayMs } = getFallbackRetryDelayMs(attempt);
        logImportFallbackDebug('fallback_lookup_retry', {
          variant,
          attempt: attempt + 1,
          reason: 'network_error',
          delayMs,
        });
        attempt += 1;
        await wait(delayMs);
        continue;
      }
      throw error;
    }
  }
}

async function lookupMetadataByTitleAuthor(target, options = null) {
  const includeStatus = Boolean(options && options.includeStatus);
  const asResult = (metadata, extra = {}) => (includeStatus ? { metadata, ...extra } : metadata);
  if (!globalFetch || !process.env.GOOGLE_BOOKS_API_KEY) {
    return asResult(null, { transientReason: null, outcome: 'not_configured' });
  }
  const title = typeof target?.title === 'string' ? target.title.trim() : '';
  const author = typeof target?.author === 'string' ? target.author.trim() : '';
  if (!title || !author) {
    return asResult(null, { transientReason: null, outcome: 'invalid_target' });
  }
  const variants = buildTitleAuthorLookupVariants(title, author);
  logImportFallbackDebug('fallback_lookup_start', {
    normalizedTitle: normalizeWorkTitle(title),
    normalizedAuthor: normalizeAuthorName(author),
    variants: variants.map((entry) => entry.variant),
    source: 'googlebooks',
  });
  for (const entry of variants) {
    const cacheKey = getTitleAuthorFallbackCacheKey(target, entry.variant);
    const cached = getCachedTitleAuthorFallbackResult(cacheKey);
    if (cached.hit) {
      logImportFallbackDebug('fallback_lookup_cache_hit', {
        variant: entry.variant,
        cacheKey,
        hit: true,
      });
      if (cached.value && typeof cached.value === 'object') {
        logImportFallbackDebug('fallback_lookup_variant_selected', {
          variant: entry.variant,
          source: cached.value.source || 'googlebooks-title-author',
          fromCache: true,
        });
      }
      if (cached.value) {
        return cached.value;
      }
      continue;
    }
    const cooldownRemainingMs = getFallbackCooldownRemainingMs();
    if (cooldownRemainingMs > 0) {
      logImportFallbackDebug('fallback_lookup_skipped_cooldown', {
        variant: entry.variant,
        reason: googleBooksFallbackCooldownReason || 'rate_limited',
        cooldownRemainingMs,
      });
      return asResult(null, {
        transientReason: 'cooldown_active',
        outcome: 'cooldown_skip',
      });
    }

    const queryUrl = new URL('https://www.googleapis.com/books/v1/volumes');
    queryUrl.searchParams.set('q', entry.query);
    queryUrl.searchParams.set('printType', 'books');
    queryUrl.searchParams.set('projection', 'full');
    queryUrl.searchParams.set('maxResults', '10');
    logImportFallbackDebug('fallback_lookup_variant_start', {
      variant: entry.variant,
      query: entry.query,
    });

    let response;
    try {
      response = await fetchGoogleBooksFallbackWithRetry(queryUrl.toString(), entry.variant);
    } catch (error) {
      if (isTransientFallbackNetworkError(error)) {
        const cooldownMs = activateFallbackCooldown('network_error');
        logImportFallbackDebug('fallback_lookup_cooldown_start', {
          variant: entry.variant,
          reason: 'network_error',
          cooldownMs,
          usedRetryAfter: false,
        });
        return asResult(null, {
          transientReason: 'network_error',
          outcome: 'network_error',
        });
      }
      throw error;
    }
    if (!response.ok) {
      if (isTransientFallbackStatus(response.status)) {
        const retryAfterMs = parseRetryAfterMs(response?.headers?.get?.('retry-after'));
        const cooldownMs = activateFallbackCooldown(`http_${response.status}`, retryAfterMs);
        logImportFallbackDebug('fallback_lookup_cooldown_start', {
          variant: entry.variant,
          reason: `http_${response.status}`,
          cooldownMs,
          usedRetryAfter: Number.isFinite(retryAfterMs),
        });
      }
      logImportFallbackDebug('fallback_result', {
        accepted: false,
        acceptedFields: [],
        rejectReason: `http_${response.status}`,
        source: 'googlebooks',
        context: {
          variant: entry.variant,
        },
      });
      if (isTransientFallbackStatus(response.status)) {
        return asResult(null, {
          transientReason: `http_${response.status}`,
          outcome: 'transient_http',
        });
      }
      continue;
    }
    const payload = await response.json();
    const metadata = parseGoogleBooksTitleAuthorFallbackData(payload, target, {
      normalizedTitle: normalizeWorkTitle(title),
      normalizedAuthor: normalizeAuthorName(author),
      variant: entry.variant,
    });
    setCachedTitleAuthorFallbackResult(cacheKey, metadata || null);
    if (metadata) {
      logImportFallbackDebug('fallback_lookup_variant_selected', {
        variant: entry.variant,
        source: metadata.source || 'googlebooks-title-author',
        fromCache: false,
      });
      return asResult(metadata, { transientReason: null, outcome: 'success' });
    }
  }
  return asResult(null, { transientReason: null, outcome: 'no_match' });
}

function buildOpenLibraryCoverUrlFromCoverId(coverId, size = 'L') {
  const rawCoverId = String(coverId ?? '').trim();
  if (!/^\d+$/.test(rawCoverId)) {
    return '';
  }
  const normalizedCoverId = Number.parseInt(rawCoverId, 10);
  if (!Number.isInteger(normalizedCoverId) || normalizedCoverId <= 0) {
    return '';
  }
  const normalizedSize = typeof size === 'string' ? size.trim().toUpperCase() : 'L';
  const validSize = normalizedSize === 'S' || normalizedSize === 'M' || normalizedSize === 'L'
    ? normalizedSize
    : 'L';
  return `https://covers.openlibrary.org/b/id/${normalizedCoverId}-${validSize}.jpg`;
}

function mergeLookupMetadata(base, incoming) {
  if (!incoming || typeof incoming !== 'object') {
    return base;
  }
  if (!base || typeof base !== 'object') {
    return { ...incoming, found: Boolean(incoming.found) };
  }

  const merged = { ...base };
  const mergeableFields = [
    'title',
    'authors',
    'author',
    'description',
    'publisher',
    'publishedAt',
    'publishedYear',
    'pageCount',
    'language',
    'previewLink',
    'coverUrl',
  ];

  for (const field of mergeableFields) {
    const currentValue = merged[field];
    const incomingValue = incoming[field];

    if (Array.isArray(incomingValue)) {
      if (!Array.isArray(currentValue) || currentValue.length === 0) {
        merged[field] = incomingValue;
      }
      continue;
    }

    if (typeof incomingValue === 'string') {
      if (!currentValue) {
        merged[field] = incomingValue;
      }
      continue;
    }

    if (typeof incomingValue === 'number') {
      if (currentValue === null || currentValue === undefined) {
        merged[field] = incomingValue;
      }
    }
  }

  const tags = [];
  const seenTags = new Set();
  for (const tag of [...parseMultiValueField(base.tags), ...parseMultiValueField(incoming.tags)]) {
    const normalizedTag = normalizeLookupTagValue(tag);
    if (!normalizedTag || seenTags.has(normalizedTag)) {
      continue;
    }
    seenTags.add(normalizedTag);
    tags.push(normalizedTag);
  }
  if (tags.length) {
    merged.tags = tags;
  }

  merged.found = Boolean(base.found || incoming.found);
  merged.barcode = merged.barcode || incoming.barcode || '';
  merged.source = base.source || incoming.source || null;
  return merged;
}

function parseOpenLibraryData(data, fallbackBarcode) {
  if (!data || typeof data !== 'object') return null;
  const title = data.title || '';
  const authorStrings = toStringList(data.authors);
  if (!authorStrings.length && typeof data.by_statement === 'string') {
    authorStrings.push(data.by_statement);
  }
  const author = authorStrings[0] || '';
  const description = typeof data.description === 'string'
    ? data.description
    : data.description?.value || '';
  const publisher = toStringList(data.publishers).join(', ');
  const publishedAt = data.publish_date || '';
  const language = toArray(data.languages)
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof entry.key === 'string') {
        return entry.key.split('/').pop();
      }
      return null;
    })
    .filter(Boolean)
    .join(', ');
  const coverUrl = Array.isArray(data.covers)
    ? data.covers
      .map((entry) => buildOpenLibraryCoverUrlFromCoverId(entry))
      .find(Boolean) || ''
    : '';
  const metadata = {
    barcode: sanitizeIsbn((data.isbn_13 && data.isbn_13[0]) || (data.isbn_10 && data.isbn_10[0]) || fallbackBarcode),
    title,
    author,
    authors: authorStrings,
    description,
    publisher,
    publishedAt,
    language,
    coverUrl,
    source: 'openlibrary',
    found: true,
  };
  const tags = Array.isArray(metadata.tags) ? [...metadata.tags] : [];
  const subjects = Array.isArray(data.subjects)
    ? data.subjects.map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
        return entry.name;
      }
      return null;
    }).filter(Boolean)
    : [];
  appendUniqueLookupTags(tags, subjects);
  metadata.tags = Array.from(new Set(tags));
  if (!title && !author && !description && !publisher && !coverUrl && !metadata.tags.length) {
    return null;
  }
  return metadata;
}

function normalizeIsbnMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return { fields: null, source: null, found: false };
  }
  const metadataAuthor = metadata.author || (Array.isArray(metadata.authors) ? metadata.authors.find(Boolean) : '');
  const publisher = normalizePublisher(metadata.publisher);
  const publishedYear = normalizePublishedYear(metadata.publishedYear ?? metadata.publishedAt);
  const pageCount = normalizePageCountValue(metadata.pageCount);
  const language = normalizeLanguageCode(metadata.language);
  const coverUrl = resolveEffectiveCoverUrl(metadata.coverUrl);
  const tags = parseMultiValueField(metadata.tags);
  const fields = {
    title: typeof metadata.title === 'string' ? metadata.title.trim() : '',
    author: metadataAuthor ? String(metadataAuthor).trim() : '',
    description: typeof metadata.description === 'string' ? metadata.description.trim() : '',
    publisher,
    publishedYear,
    pageCount,
    language,
    coverUrl,
    tags,
  };
  return {
    fields,
    source: metadata.source || null,
    found: Boolean(metadata.found),
  };
}

function hasCompleteNormalizedIsbnMetadata(metadata) {
  const normalizedMetadata = normalizeIsbnMetadata(metadata);
  const fields = normalizedMetadata.fields;
  if (!normalizedMetadata.found || !fields) {
    return false;
  }

  return Boolean(fields.title && fields.author && fields.coverUrl);
}

function createIsbnLookupDebugPayload(sanitizedIsbn) {
  return {
    isbn: sanitizedIsbn,
    sourcesConfigured: [],
    sourcesTried: [],
    googleBooks: {
      enabled: Boolean(process.env.GOOGLE_BOOKS_API_KEY),
      requestUrl: null,
      responseStatus: null,
      responseOk: null,
      itemCount: 0,
      exactMatchFound: false,
      candidates: [],
      extracted: null,
      merged: false,
    },
    openLibrary: {
      enabled: true,
      requestUrl: null,
      responseStatus: null,
      responseOk: null,
      extracted: null,
      merged: false,
    },
    isbnbarcode: {
      enabled: ENABLE_ISBNBARCODE_LOOKUP,
      requestUrl: null,
      responseStatus: null,
      responseOk: null,
      extracted: null,
      merged: false,
    },
    mergedResult: null,
  };
}

function formatIsbnLookupResponse(lookupEntry, options = {}) {
  const includeDebug = Boolean(options && options.includeDebug);
  const cacheHit = Boolean(options && options.cacheHit);
  const fallbackIsbn = options && typeof options.sanitizedIsbn === 'string' ? options.sanitizedIsbn : '';
  if (!lookupEntry || typeof lookupEntry !== 'object') {
    return lookupEntry;
  }
  if (!includeDebug) {
    return lookupEntry.value;
  }
  if (!DEBUG_ISBN_LOOKUP) {
    return lookupEntry.value;
  }
  const baseDebug = lookupEntry.debug || createIsbnLookupDebugPayload(fallbackIsbn);
  return {
    ...lookupEntry.value,
    debug: {
      ...baseDebug,
      cacheHit,
    },
  };
}

async function lookupIsbnMetadata(isbn, options = {}) {
  const sanitized = sanitizeIsbn(isbn);
  const cacheKey = getIsbnCacheKey(isbn);
  const includeDebug = Boolean(options && options.includeDebug && DEBUG_ISBN_LOOKUP);
  const now = Date.now();
  const cached = isbnMetadataCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    logIsbnLookupDebug('cache_hit', { isbn: sanitized, cacheKey });
    return formatIsbnLookupResponse(cached, { includeDebug, cacheHit: true, sanitizedIsbn: sanitized });
  }
  if (cached) {
    isbnMetadataCache.delete(cacheKey);
  }

  const inflight = isbnLookupInflight.get(cacheKey);
  if (inflight) {
    const inflightEntry = await inflight;
    return formatIsbnLookupResponse(inflightEntry, { includeDebug, cacheHit: false, sanitizedIsbn: sanitized });
  }

  const lookupPromise = (async () => {
    let result;
    const debugPayload = DEBUG_ISBN_LOOKUP ? createIsbnLookupDebugPayload(sanitized) : null;
    logIsbnLookupDebug('lookup_start', {
      isbn: sanitized,
      googleBooksEnabled: Boolean(process.env.GOOGLE_BOOKS_API_KEY),
      openLibraryEnabled: true,
      isbnBarcodeEnabled: ENABLE_ISBNBARCODE_LOOKUP,
    });

    if (!sanitized) {
      result = {
        barcode: '',
        title: '',
        author: '',
        authors: [],
        description: '',
        publisher: '',
        publishedAt: '',
        publishedYear: null,
        pageCount: null,
        language: '',
        previewLink: '',
        coverUrl: '',
        source: 'unknown',
        found: false,
      };
    } else if (!globalFetch) {
      result = {
        barcode: sanitized,
        title: '',
        author: '',
        authors: [],
        description: '',
        publisher: '',
        publishedAt: '',
        publishedYear: null,
        pageCount: null,
        language: '',
        previewLink: '',
        coverUrl: '',
        source: 'offline',
        found: false,
      };
    } else {
      const defaultHeaders = {
        Accept: 'application/json',
        'User-Agent': 'Boekenbaai/1.0 (+https://boekenbaai.example)',
      };

      const sources = [];

      if (process.env.GOOGLE_BOOKS_API_KEY) {
        const googleBooksUrl = new URL('https://www.googleapis.com/books/v1/volumes');
        googleBooksUrl.searchParams.set('q', `isbn:${sanitized}`);
        googleBooksUrl.searchParams.set('printType', 'books');
        googleBooksUrl.searchParams.set('projection', 'full');
        googleBooksUrl.searchParams.set('maxResults', '5');
        sources.push({
          name: 'googlebooks',
          url: googleBooksUrl.toString(),
          headers: {
            ...defaultHeaders,
            'x-goog-api-key': process.env.GOOGLE_BOOKS_API_KEY,
          },
          parser: (data) => parseGoogleBooksData(data, sanitized, debugPayload?.googleBooks),
        });
      }

      sources.push({
        name: 'openlibrary',
        url: `https://openlibrary.org/isbn/${sanitized}.json`,
        headers: defaultHeaders,
        parser: (data) => parseOpenLibraryData(data, sanitized),
      });

      if (ENABLE_ISBNBARCODE_LOOKUP) {
        sources.push({
          name: 'isbnbarcode.org',
          url: `${ISBN_API_BASE.replace(/\/$/, '')}/${sanitized}`,
          headers: defaultHeaders,
          parser: (data) => parseIsbnBarcodeData(data, sanitized),
        });
      }
      if (debugPayload) {
        debugPayload.sourcesConfigured = sources.map((source) => source.name);
      }
      logIsbnLookupDebug('sources_configured', debugPayload?.sourcesConfigured || sources.map((source) => source.name));

      for (const [sourceIndex, source] of sources.entries()) {
        if (debugPayload) {
          debugPayload.sourcesTried.push(source.name);
          if (source.name === 'googlebooks') debugPayload.googleBooks.requestUrl = source.url;
          if (source.name === 'openlibrary') debugPayload.openLibrary.requestUrl = source.url;
          if (source.name === 'isbnbarcode.org') debugPayload.isbnbarcode.requestUrl = source.url;
        }
        try {
          logIsbnLookupDebug('source_request', { source: source.name, url: source.url });
          const response = await globalFetch(source.url, { headers: source.headers || defaultHeaders });
          if (debugPayload) {
            if (source.name === 'googlebooks') {
              debugPayload.googleBooks.responseStatus = response.status;
              debugPayload.googleBooks.responseOk = response.ok;
            }
            if (source.name === 'openlibrary') {
              debugPayload.openLibrary.responseStatus = response.status;
              debugPayload.openLibrary.responseOk = response.ok;
            }
            if (source.name === 'isbnbarcode.org') {
              debugPayload.isbnbarcode.responseStatus = response.status;
              debugPayload.isbnbarcode.responseOk = response.ok;
            }
          }
          logIsbnLookupDebug('source_response', {
            source: source.name,
            ok: response.ok,
            status: response.status,
          });
          if (!response.ok) {
            if (response.status === 404) {
              continue;
            }
            continue;
          }
          const contentType = response.headers.get('content-type') || '';
          let payload = null;
          if (contentType.includes('application/json')) {
            payload = await response.json();
          } else {
            const text = await response.text();
            try {
              payload = JSON.parse(text);
            } catch (error) {
              payload = null;
            }
          }
          const metadata = source.parser(payload);
          if (source.name === 'googlebooks') {
            logIsbnLookupDebug('googlebooks_parse', {
              itemCount: debugPayload?.googleBooks?.itemCount ?? 0,
              exactMatchFound: debugPayload?.googleBooks?.exactMatchFound ?? false,
              candidates: debugPayload?.googleBooks?.candidates ?? [],
            });
          }
          if (metadata) {
            result = result ? mergeLookupMetadata(result, metadata) : metadata;
            if (debugPayload) {
              const summary = createMetadataFieldSummary(metadata);
              if (source.name === 'googlebooks') {
                debugPayload.googleBooks.extracted = summary;
                debugPayload.googleBooks.merged = true;
              }
              if (source.name === 'openlibrary') {
                debugPayload.openLibrary.extracted = summary;
                debugPayload.openLibrary.merged = true;
              }
              if (source.name === 'isbnbarcode.org') {
                debugPayload.isbnbarcode.extracted = summary;
                debugPayload.isbnbarcode.merged = true;
              }
              debugPayload.mergedResult = createMetadataFieldSummary(result);
            }
            logIsbnLookupDebug('source_merged', {
              source: source.name,
              extracted: createMetadataFieldSummary(metadata),
              merged: createMetadataFieldSummary(result),
            });
            const normalizedResult = normalizeIsbnMetadata(result);
            const hasRemainingOpenLibrarySource = sources.slice(sourceIndex + 1).some((candidate) => candidate.name === 'openlibrary');
            if (hasCompleteNormalizedIsbnMetadata(result)
              && normalizedResult.fields?.tags?.length
              && !hasRemainingOpenLibrarySource) {
              break;
            }
          }
        } catch (error) {
          console.warn(`Kon geen gegevens ophalen via ${source.name}:`, error.message || error);
          logIsbnLookupDebug('source_error', {
            source: source.name,
            error: error?.message || String(error),
          });
        }
      }

      if (!result) {
        result = {
          barcode: sanitized,
          title: '',
          author: '',
          authors: [],
          description: '',
          publisher: '',
          publishedAt: '',
          publishedYear: null,
          pageCount: null,
          language: '',
          previewLink: '',
          coverUrl: '',
          source: 'none',
          found: false,
        };
      }
    }

    if (result && typeof result === 'object') {
      result.coverUrl = resolveEffectiveCoverUrl(result.coverUrl);
      if (debugPayload) {
        debugPayload.mergedResult = createMetadataFieldSummary(result);
      }
    }
    logIsbnLookupDebug('lookup_result', createMetadataFieldSummary(result));
    const lookupEntry = {
      value: result,
      debug: debugPayload,
      // Do not let a temporary failure suppress later ISBN retries for a
      // long success-cache TTL.
      expiresAt: Date.now() + (result?.found === true
        ? ISBN_CACHE_TTL_MS : Math.min(ISBN_CACHE_TTL_MS, 10 * 1000)),
    };
    isbnMetadataCache.set(cacheKey, lookupEntry);
    return lookupEntry;
  })();

  isbnLookupInflight.set(cacheKey, lookupPromise);
  try {
    const lookupEntry = await lookupPromise;
    return formatIsbnLookupResponse(lookupEntry, { includeDebug, cacheHit: false, sanitizedIsbn: sanitized });
  } finally {
    isbnLookupInflight.delete(cacheKey);
  }
}

function sendJson(res, statusCode, payload) {
  const headers = { 'Content-Type': 'application/json' };
  const varyHeader = res.getHeader('Vary');
  if (varyHeader) headers.Vary = varyHeader;
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
  const allowHeaders = res.getHeader('Access-Control-Allow-Headers');
  if (allowHeaders) headers['Access-Control-Allow-Headers'] = allowHeaders;
  const allowMethods = res.getHeader('Access-Control-Allow-Methods');
  if (allowMethods) headers['Access-Control-Allow-Methods'] = allowMethods;
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, headers = {}) {
  const varyHeader = res.getHeader('Vary');
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  const allowHeaders = res.getHeader('Access-Control-Allow-Headers');
  const allowMethods = res.getHeader('Access-Control-Allow-Methods');
  const finalHeaders = {
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  };
  if (varyHeader) finalHeaders.Vary = varyHeader;
  if (allowOrigin) finalHeaders['Access-Control-Allow-Origin'] = allowOrigin;
  if (allowHeaders) finalHeaders['Access-Control-Allow-Headers'] = allowHeaders;
  if (allowMethods) finalHeaders['Access-Control-Allow-Methods'] = allowMethods;
  res.writeHead(statusCode, finalHeaders);
  res.end(text);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, 'Bestand niet gevonden');
      return;
    }
    if (ext === '.html') {
      let html = data.toString('utf-8');
      if (PUBLIC_API_BASE) {
        html = html.replace(
          /(<meta\s+name="boekenbaai-api-base"\s+content=")([^"]*)("[^>]*>)/i,
          `$1${PUBLIC_API_BASE}$3`
        );
        if (!html.includes('window.BOEKENBAAI_API_BASE')) {
          const script = `    <script>window.BOEKENBAAI_API_BASE = ${JSON.stringify(
            PUBLIC_API_BASE
          )};</script>`;
          html = html.replace(/<\/head>/i, `${script}\n  </head>`);
        }
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function parseBody(req, maxLength = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let settled = false;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('aborted', onAborted);
      req.off('error', onError);
      req.off('close', onClose);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onAborted = () => finish(new Error('Upload afgebroken'));
    const onError = (error) => finish(error);
    const onClose = () => {
      if (!req.complete) onAborted();
    };
    const onData = (chunk) => {
      length += chunk.length;
      if (length > maxLength) {
        finish(new Error('Payload te groot'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        finish(null, raw ? JSON.parse(raw) : {});
      } catch {
        finish(new Error('Kon JSON niet lezen'));
      }
    };
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('aborted', onAborted);
    req.once('error', onError);
    req.once('close', onClose);
    // If the client disconnected before handlers were registered, do not
    // leave a held import reservation waiting for events that already fired.
    if (req.aborted || req.destroyed && !req.complete) onAborted();
  });
}

/**
 * Voeg een uitleenlogregel toe aan `db.history`.
 * Wordt gebruikt voor check-ins/-outs en verwante gebeurtenissen.
 */
function appendHistory(db, entry) {
  db.history.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  db.history = db.history.slice(0, 200);
}

/**
 * Geef de uitleenlog van een leerling terug op basis van `db.history`.
 * Filtert uitsluitend check-ins/-outs en sorteert op tijdstip.
 */
function getStudentLoanHistory(db, studentId) {
  const entries = Array.isArray(db.history) ? db.history : [];
  const loans = entries
    .filter((entry) =>
      entry &&
      entry.studentId === studentId &&
      (entry.type === 'check_out' || entry.type === 'check_in') &&
      typeof entry.timestamp === 'string'
    )
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      bookId: entry.bookId,
      studentId: entry.studentId,
      message: entry.message,
      timestamp: entry.timestamp,
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return loans;
}

function getPublicLoanActivity(db, { limit = 12 } = {}) {
  const entries = Array.isArray(db.history) ? db.history : [];
  const sanitized = entries
    .filter((entry) =>
      entry &&
      (entry.type === 'check_out' || entry.type === 'check_in') &&
      typeof entry.timestamp === 'string'
    )
    .map((entry) => {
      const book = findBookById(db, entry.bookId);
      return {
        id: entry.id,
        type: entry.type,
        bookId: entry.bookId,
        title: book?.title || 'Onbekend boek',
        timestamp: entry.timestamp,
      };
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  if (Number.isFinite(limit) && limit > 0) {
    return sanitized.slice(0, limit);
  }
  return sanitized;
}

function getCurrentSchoolYearRange(now = new Date()) {
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const start = new Date(startYear, 7, 1, 0, 0, 0, 0);
  const end = new Date(startYear + 1, 6, 31, 23, 59, 59, 999);
  return { start, end };
}

function buildStudentStats(db, studentId) {
  const student = findStudentById(db, studentId);
  if (!student) {
    return null;
  }

  const loanHistory = getStudentLoanHistory(db, studentId);
  const checkoutHistory = loanHistory.filter((entry) => entry.type === 'check_out');
  const totalBorrowed = checkoutHistory.length;
  const lastBorrowedAt = checkoutHistory.length ? checkoutHistory[0].timestamp : null;
  const lastReadAt = loanHistory.length ? loanHistory[0].timestamp : lastBorrowedAt;

  const { start: schoolYearStart, end: schoolYearEnd } = getCurrentSchoolYearRange();
  const schoolYearBorrowCount = checkoutHistory.filter((entry) => {
    const timestamp = entry?.timestamp ? new Date(entry.timestamp) : null;
    return timestamp && timestamp >= schoolYearStart && timestamp <= schoolYearEnd;
  }).length;

  const activeBorrowedBooks = Array.isArray(student.borrowedBooks) ? student.borrowedBooks : [];
  const now = Date.now();
  const activeLoans = activeBorrowedBooks.map((loan) => {
    const book = findBookById(db, loan.bookId);
    const borrowedAt = loan.borrowedAt || loan.timestamp || loan.date || book?.borrowedAt || null;
    const borrowedMs = borrowedAt ? new Date(borrowedAt).getTime() : NaN;
    const daysBorrowed = Number.isFinite(borrowedMs)
      ? Math.max(0, Math.floor((now - borrowedMs) / (1000 * 60 * 60 * 24)))
      : 0;
    return {
      bookId: loan.bookId,
      title: book?.title || loan.title || 'Onbekend boek',
      borrowedAt,
      dueDate: loan.dueDate || book?.dueDate || null,
      daysBorrowed,
    };
  });

  const genreCounts = checkoutHistory.reduce((acc, entry) => {
    const book = findBookById(db, entry.bookId);
    const tags = Array.isArray(book?.tags) ? book.tags : [];
    if (!tags.length) {
      acc.set('Onbekend genre', (acc.get('Onbekend genre') || 0) + 1);
      return acc;
    }
    for (const tag of tags) {
      const key = String(tag || '').trim() || 'Onbekend genre';
      acc.set(key, (acc.get(key) || 0) + 1);
    }
    return acc;
  }, new Map());
  const topGenres = Array.from(genreCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const borrowedTitlesMap = checkoutHistory.reduce((acc, entry) => {
    const book = findBookById(db, entry.bookId);
    const title = book?.title || entry.title || 'Onbekend boek';
    const existing = acc.get(entry.bookId);
    if (!existing) {
      acc.set(entry.bookId, { bookId: entry.bookId, title, lastBorrowedAt: entry.timestamp, borrowCount: 1 });
    } else {
      existing.borrowCount += 1;
      if (entry.timestamp && new Date(entry.timestamp) > new Date(existing.lastBorrowedAt)) {
        existing.lastBorrowedAt = entry.timestamp;
      }
    }
    return acc;
  }, new Map());
  const borrowedTitles = Array.from(borrowedTitlesMap.values()).sort(
    (a, b) => new Date(b.lastBorrowedAt).getTime() - new Date(a.lastBorrowedAt).getTime()
  );

  return {
    studentId,
    totalBorrowed,
    totalBorrowedBooks: totalBorrowed,
    borrowCount: totalBorrowed,
    borrowedCount: totalBorrowed,
    schoolYearBorrowCount,
    activeLoans,
    activeLoanCount: activeLoans.length,
    lastReadAt,
    lastBorrowedAt,
    topGenres,
    borrowedTitles,
  };
}

function buildSchoolStats(db) {
  const history = Array.isArray(db.history) ? db.history : [];
  // Both student and class checkouts are physical school library loans.
  const checkouts = history.filter((entry) =>
    entry && (entry.type === 'check_out' || entry.type === 'check_out_class'));
  const totalBorrowed = checkouts.length;

  const borrowCountByBookId = new Map();
  for (const entry of checkouts) {
    if (!entry.bookId) continue;
    const current = borrowCountByBookId.get(entry.bookId) || 0;
    borrowCountByBookId.set(entry.bookId, current + 1);
  }

  const genreCounts = new Map();
  for (const entry of checkouts) {
    const book = findBookById(db, entry.bookId);
    const tags = Array.isArray(book?.tags) ? book.tags : [];
    for (const tag of tags) {
      const label = String(tag || '').trim();
      if (!label) continue;
      genreCounts.set(label, (genreCounts.get(label) || 0) + 1);
    }
  }

  const topGenres = Array.from(genreCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);

  const alwaysBorrowed = db.books
    .filter((book) => book.status === 'borrowed')
    .map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      borrowCount: borrowCountByBookId.get(book.id) || 0,
      borrowedBy: book.borrowedBy || null,
      dueDate: book.dueDate || null,
    }))
    .sort((a, b) => b.borrowCount - a.borrowCount || a.title.localeCompare(b.title))
    .slice(0, 5);

  return {
    totalBorrowed,
    totalBorrowedBooks: totalBorrowed,
    borrowCount: totalBorrowed,
    borrowedCount: totalBorrowed,
    topGenres,
    alwaysBorrowed,
  };
}

function findBookById(db, id) {
  return db.books.find((book) => book.id === id);
}

function findBookByMetadataIsbn(db, metadataIsbn, { excludeId = null } = {}) {
  const normalized = sanitizeIsbn(metadataIsbn);
  if (!normalized) {
    return null;
  }
  return (
    db.books.find((book) => {
      if (excludeId && book.id === excludeId) {
        return false;
      }
      return sanitizeIsbn(book.metadataIsbn) === normalized;
    }) || null
  );
}

function findBookByBarcode(db, barcode) {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) {
    return null;
  }
  return db.books.find((book) => normalizeBarcode(book.barcode) === normalized) || null;
}

function resolveMetadataLookupKey(metadataIsbn, barcode) {
  return sanitizeIsbn(metadataIsbn) || sanitizeIsbn(barcode) || normalizeBarcode(barcode);
}

function findStudentById(db, id) {
  return db.students.find((student) => student.id === id);
}

function getTeacherClassIds(db, teacherId) {
  if (!teacherId) {
    return [];
  }
  const ids = new Set();
  for (const klass of db.classes) {
    const teacherIds = Array.isArray(klass.teacherIds) ? klass.teacherIds : [];
    if (teacherIds.includes(teacherId)) {
      ids.add(klass.id);
    }
  }
  return Array.from(ids);
}

// One synchronous admission point for every book-import entry route.
// A legacy background job retains its lease until its internal direct import
// and job finalization both finish; the authenticated internal request may
// reuse ONLY its matching job id, login token and server-only handoff secret.
let activeBookImportLease = null;
function releaseBookImportLease(lease) {
  if (activeBookImportLease === lease) activeBookImportLease = null;
}

async function handleApi(req, res, requestUrl) {
  const originAllowed = isOriginAllowed(req.headers.origin, requestUrl);
  if (req.method === 'OPTIONS') {
    if (originAllowed) {
      applyCors(req, res, requestUrl);
      res.writeHead(204, { 'Content-Length': '0' });
    } else {
      res.writeHead(403, { 'Content-Length': '0' });
    }
    res.end();
    return;
  }

  if (originAllowed) {
    applyCors(req, res, requestUrl);
  }

  let requestImportAdmission = null;
  try {
    let db;
    const getDb = () => {
      if (!db) {
        db = loadDb();
      }
      return db;
    };
    if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/covers/')) {
      if (coverAssets.serve(req, res, requestUrl.pathname)) return;
      return sendJson(res, 404, { message: 'Omslag niet gevonden' });
    }
    const user = getAuthenticatedUser(req, getDb);
    // Acquire before parseBody() can yield, regardless of which UI initiated
    // the upload. This closes both directions of the legacy/staged race.
    const importKind = req.method !== 'POST' ? '' :
      requestUrl.pathname === '/api/admin/book-import-stages' ? 'reviewed' :
      requestUrl.pathname === '/api/books/import-jobs' ? 'legacy-job' :
      requestUrl.pathname === '/api/books/import' ? 'legacy-direct' : '';
    if (importKind && user?.role === 'admin') {
      const lease = activeBookImportLease;
      const internalJobRequest = importKind === 'legacy-direct'
        && lease?.kind === 'legacy-job' && lease.jobId
        && lease.jobId === String(req.headers['x-import-job-id'] || '').trim()
        && lease.loginToken === getTokenFromHeader(req)
        && !lease.internalBorrowed
        && typeof req.headers['x-import-internal-token'] === 'string'
        && lease.handoffSecret === req.headers['x-import-internal-token'];
      if (internalJobRequest) {
        lease.internalBorrowed = true;
        requestImportAdmission = { lease, borrowed: true };
      } else if (lease?.kind === 'legacy-job' && importKind === 'legacy-job'
        && lease.userId === user.id && lease.jobId) {
        // Preserve existing idempotent behavior for refreshing a running
        // legacy job from the same shared administrator account.
        return sendJson(res, 200, { jobId: lease.jobId, reused: true });
      } else if (lease || bookImportStageStore.active()) {
        const currentStage = bookImportStageStore.active();
        return sendJson(res, 409, {
          message: 'Er is al een boekimport bezig. Bekijk of rond die eerst af.',
          error: 'stage_busy',
          ...(importKind === 'reviewed' && currentStage
            ? { active: importStageView(currentStage) } : {}),
        });
      } else {
        const reserved = { kind: importKind, userId: user.id, jobId: null,
          loginToken: getTokenFromHeader(req), handedOff: false,
          handoffSecret: null, internalBorrowed: false };
        activeBookImportLease = reserved;
        requestImportAdmission = { lease: reserved, borrowed: false };
      }
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/login') {
      const body = await parseBody(req);
      if (!body.username || !body.password) {
        return sendJson(res, 400, { message: 'Gebruikersnaam en wachtwoord zijn verplicht' });
      }
      const database = getDb();
      const username = body.username.trim();
      const normalized = username.toLowerCase();
      const passwordHash = hashPassword(body.password);

      const staffAccount = database.users.find(
        (entry) => entry.username.toLowerCase() === normalized
      );
      if (staffAccount && staffAccount.passwordHash === passwordHash) {
        const token = crypto.randomUUID();
        sessions.set(token, { userId: staffAccount.id, type: 'staff', createdAt: Date.now() });
        return sendJson(res, 200, {
          token,
          user: {
            id: staffAccount.id,
            name: staffAccount.name,
            role: staffAccount.role,
            mustChangePassword: Boolean(staffAccount.mustChangePassword),
          },
        });
      }

      const studentAccount = findStudentByUsername(database, username);
      if (studentAccount && studentAccount.passwordHash === passwordHash) {
        const token = crypto.randomUUID();
        sessions.set(token, { userId: studentAccount.id, type: 'student', createdAt: Date.now() });
        return sendJson(res, 200, {
          token,
          user: {
            id: studentAccount.id,
            name: studentAccount.name,
            firstName: getPreferredFirstName(studentAccount),
            role: 'student',
            grade: studentAccount.grade || '',
            mustChangePassword: Boolean(studentAccount.mustChangePassword),
          },
        });
      }

      return sendJson(res, 401, { message: 'Onjuiste inloggegevens' });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/login-by-name') {
      const body = await parseBody(req);
      const inputName = typeof body.name === 'string' ? body.name.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const accountType = typeof body.type === 'string' ? body.type : 'student'; // 'student' of 'staff'

      if (!inputName || !password) {
        return sendJson(res, 400, { message: 'Naam en wachtwoord zijn verplicht' });
      }

      const database = getDb();
      const passwordHash = hashPassword(password);
      const normalizedInput = inputName.toLowerCase().trim();

      let matchingAccounts = [];

      if (accountType === 'staff') {
        // Zoek in users (docenten/admin)
        matchingAccounts = database.users.filter((entry) =>
          entry.name.toLowerCase().trim() === normalizedInput
        );
      } else {
        // Zoek in students
        matchingAccounts = database.students.filter((entry) =>
          entry.name.toLowerCase().trim() === normalizedInput
        );
      }

      if (!matchingAccounts.length) {
        return sendJson(res, 404, { message: `Geen account gevonden met de naam "${inputName}"` });
      }

      // Filter op correct wachtwoord
      const validAccounts = matchingAccounts.filter(
        (account) => account.passwordHash === passwordHash
      );

      if (!validAccounts.length) {
        return sendJson(res, 401, { message: 'Wachtwoord klopt niet' });
      }

      // Als meerdere valide accounts: geef ze terug voor keuze
      if (validAccounts.length > 1) {
        const options = validAccounts.map((account) => {
          if (accountType === 'student') {
            const classes = database.classes
              .filter((cls) => Array.isArray(cls.studentIds) && cls.studentIds.includes(account.id))
              .map((cls) => cls.name)
              .join(', ');
            return {
              id: account.id,
              name: account.name,
              class: classes || '',
              grade: account.grade || '',
            };
          }
          return {
            id: account.id,
            name: account.name,
          };
        });
        return sendJson(res, 200, { multiple: true, options, requireSelection: true });
      }

      // Één match: automatisch inloggen
      const account = validAccounts[0];
      const token = crypto.randomUUID();

      if (accountType === 'staff') {
        sessions.set(token, { userId: account.id, type: 'staff', createdAt: Date.now() });
        return sendJson(res, 200, {
          token,
          user: {
            id: account.id,
            name: account.name,
            role: account.role,
            mustChangePassword: Boolean(account.mustChangePassword),
          },
        });
      } else {
        sessions.set(token, { userId: account.id, type: 'student', createdAt: Date.now() });
        return sendJson(res, 200, {
          token,
          user: {
            id: account.id,
            name: account.name,
            firstName: getPreferredFirstName(account),
            role: 'student',
            grade: account.grade || '',
            mustChangePassword: Boolean(account.mustChangePassword),
          },
        });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/login-search') {
      const query = requestUrl.searchParams.get('q') || '';
      const type = requestUrl.searchParams.get('type') || 'student'; // 'student' of 'staff'

      if (!query || query.length < 2) {
        return sendJson(res, 200, { matches: [] });
      }

      const database = getDb();
      const normalizedQuery = query.toLowerCase().trim();
      let matches = [];

      if (type === 'staff') {
        matches = database.users
          .filter(
            (entry) =>
              entry.name.toLowerCase().includes(normalizedQuery) ||
              (entry.username && entry.username.toLowerCase().includes(normalizedQuery))
          )
          .slice(0, 10)
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            displayName: entry.name, // voor staff volledige naam
            type: 'staff',
          }));
      } else {
        // Voor students: verzamel eerst de matches
        const rawMatches = database.students
          .filter((entry) => entry.name.toLowerCase().includes(normalizedQuery))
          .slice(0, 10);

        // Voor elke student, bepaal het aantal letters voor unieke displayName binnen klas
        matches = rawMatches.map((entry) => {
          const classes = database.classes
            .filter((cls) => Array.isArray(cls.studentIds) && cls.studentIds.includes(entry.id))
            .map((cls) => cls.name)
            .join(', ');

          // Bepaal letters
          let letters = 1;
          const lastName = normalizeImportedCell(
            entry.lastName || deriveNameParts(entry.name).lastName
          );
          while (letters <= lastName.length) {
            const displayName = createStudentDisplayName(entry, letters);
            const hasConflict = rawMatches.some((other) => {
              if (other.id === entry.id) return false;
              const otherClasses = database.classes
                .filter((cls) => Array.isArray(cls.studentIds) && cls.studentIds.includes(other.id))
                .map((cls) => cls.name)
                .join(', ');
              const otherDisplayName = createStudentDisplayName(other, letters);
              return otherDisplayName === displayName && otherClasses === classes;
            });
            if (!hasConflict) break;
            letters++;
          }

          return {
            id: entry.id,
            name: entry.name,
            displayName: createStudentDisplayName(entry, letters),
            class: classes || '',
            grade: entry.grade || '',
            type: 'student',
          };
        });
      }

      return sendJson(res, 200, { matches });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/logout') {
      const token = getTokenFromHeader(req);
      if (token) {
        sessions.delete(token);
      }
      return sendJson(res, 200, { message: 'Afgemeld' });
    }

    if (req.method === 'PATCH' && requestUrl.pathname === '/api/account/password') {
      if (!user) {
        return sendJson(res, 401, { message: 'Niet ingelogd' });
      }
      const body = await parseBody(req);
      const currentPassword =
        typeof body.currentPassword === 'string' ? body.currentPassword : String(body.currentPassword || '');
      const newPassword =
        typeof body.newPassword === 'string' ? body.newPassword : String(body.newPassword || '');
      if (!currentPassword || !newPassword) {
        return sendJson(res, 400, { message: 'Vul je huidige en nieuwe wachtwoord in.' });
      }
      if (newPassword.length < 6) {
        return sendJson(res, 400, {
          message: 'Kies een nieuw wachtwoord van minimaal 6 tekens.',
        });
      }

      const db = getDb();
      let account = null;
      if (user.role === 'student') {
        account = db.students.find((entry) => entry.id === user.id) || null;
      } else if (user.role === 'teacher' || user.role === 'admin') {
        account = db.users.find((entry) => entry.id === user.id) || null;
      }
      if (!account) {
        return sendJson(res, 404, { message: 'Account niet gevonden' });
      }

      const currentHash = hashPassword(currentPassword);
      if (account.passwordHash !== currentHash) {
        return sendJson(res, 400, { message: 'Huidig wachtwoord klopt niet.' });
      }

      const newHash = hashPassword(newPassword);
      if (newHash === account.passwordHash) {
        return sendJson(res, 400, { message: 'Kies een ander nieuw wachtwoord.' });
      }
      account.passwordHash = newHash;
      if (body.clearMustChange !== false) {
        account.mustChangePassword = false;
      }
      saveDb(db);
      return sendJson(res, 200, {
        message: 'Wachtwoord gewijzigd',
        mustChangePassword: Boolean(account.mustChangePassword),
      });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/me') {
      if (!user) {
        return sendJson(res, 401, { message: 'Niet ingelogd' });
      }
      if (user.role === 'student') {
        const db = getDb();
        const student = findStudentById(db, user.id);
        return sendJson(res, 200, {
          id: student.id,
          name: student.name,
          firstName: getPreferredFirstName(student),
          role: 'student',
          grade: student.grade || '',
          borrowedBooks: student.borrowedBooks || [],
          classIds: student.classIds || [],
          username: student.username || '',
          mustChangePassword: Boolean(student.mustChangePassword),
        });
      }
      return sendJson(res, 200, {
        id: user.id,
        name: user.name,
        role: user.role,
        mustChangePassword: Boolean(user.mustChangePassword),
      });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/status') {
      const db = getDb();
      const groupedBooks = groupBooksByTitleAuthor(db.books);
      const totalBooks = groupedBooks.reduce((sum, group) => sum + group.totalCopies, 0);
      const borrowedBooks = groupedBooks.reduce((sum, group) => sum + group.borrowedCopies, 0);
      const availableBooks = groupedBooks.reduce((sum, group) => sum + group.availableCopies, 0);
      const examListBooks = db.books.filter((book) => book.suitableForExamList).length;
      return sendJson(res, 200, {
        totalBooks,
        borrowedBooks,
        availableBooks,
        examListBooks,
        groupCount: groupedBooks.length,
      });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/admin/themes/unmapped-tags') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen ongemapte tags bekijken' });
      }
      const db = getDb();
      const stats = new Map();
      for (const book of db.books.map((entry) => attachDerivedThemeFields(entry))) {
        for (const tag of book.unmappedTags || []) {
          const key = normalizeRawThemeTag(tag);
          if (!key) continue;
          const current = stats.get(key) || { tag: tag.trim(), count: 0, sampleTitles: [] };
          current.count += 1;
          if (book.title && current.sampleTitles.length < 3 && !current.sampleTitles.includes(book.title)) {
            current.sampleTitles.push(book.title);
          }
          stats.set(key, current);
        }
      }
      const unmappedTagStats = Array.from(stats.values())
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'nl', { sensitivity: 'base' }));
      return sendJson(res, 200, { unmappedTagStats });
    }

    // PR5: one staff-only directory for choosing a physical copy and its
    // borrower. Identity and loan details are filtered SERVER-SIDE using
    // live teacher/class membership, including class-owned loans.
    if (req.method === 'GET' && requestUrl.pathname === '/api/staff/loans') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, user ? 403 : 401, { message: 'Alleen medewerkers kunnen uitleningen beheren.' });
      }
      const db = getDb();
      const allowedIds = user.role === 'admin'
        ? (db.classes || []).map((klass) => klass.id) : ownClassIds(db, user);
      const allowedSet = new Set(allowedIds);
      const classes = (db.classes || []).filter((klass) => allowedSet.has(klass.id))
        .map((klass) => ({ id: klass.id, name: klass.name }));
      const students = (db.students || []).filter((student) =>
        user.role === 'admin' || studentClassIds(db, student).some((id) => allowedSet.has(id)))
        .map((student) => ({ id: student.id, name: student.name,
          classIds: studentClassIds(db, student).filter((id) => allowedSet.has(id)),
          active: student.active !== false && student.status !== 'inactive' }));
      const allowedStudents = new Map(students.map((student) => [student.id, student]));
      const books = db.books.map((book) => ({
        id: book.id, title: book.title, author: book.author, barcode: book.barcode,
        status: book.status, fixedLocation: book.fixedLocation || null,
      }));
      const loans = db.books.filter((book) => book.status === 'borrowed')
        .map((book) => {
          const borrower = book.borrowedByClassId
            ? classes.find((klass) => klass.id === book.borrowedByClassId)
            : allowedStudents.get(book.borrowedBy);
          if (!borrower) return null;
          return {
            bookId: book.id, title: book.title, author: book.author, barcode: book.barcode,
            borrowerType: book.borrowedByClassId ? 'class' : 'student',
            borrowerId: borrower.id, borrowerName: borrower.name,
            dueDate: book.dueDate || null, borrowedAt: book.borrowedAt || null,
            fixedLocation: book.fixedLocation || null,
          };
        }).filter(Boolean);
      return sendJson(res, 200, { classes, students, books, loans });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/books') {
      const db = getDb();
      const borrowCounts = getBorrowCountsMap(db.history);
      let books = db.books.map((book) => withBorrowCount(book, borrowCounts));
      const folder = requestUrl.searchParams.get('folder');
      const query = requestUrl.searchParams.get('query');
      if (folder) {
        books = books.filter((book) => book.folderId === folder);
      }
      if (query) {
        const term = query.toLowerCase();
        books = books.filter((book) => {
          return (
            book.title.toLowerCase().includes(term) ||
            book.author.toLowerCase().includes(term) ||
            (book.description && book.description.toLowerCase().includes(term)) ||
            (book.language && book.language.toLowerCase().includes(term)) ||
            (book.suitableForExamList && ['leeslijst', 'examenleeslijst', 'examen'].some((keyword) => keyword.includes(term) || term.includes(keyword))) ||
            (book.easyReading && ['makkelijk lezen', 'makkelijklezen', 'ml'].some((keyword) => keyword.includes(term) || term.includes(keyword))) ||
            (book.themes || []).some((theme) => theme.toLowerCase().includes(term)) ||
            (book.tags || []).some((tag) => tag.toLowerCase().includes(term))
          );
        });
      }
      return sendJson(res, 200, books.map((book) => sanitizeBookForResponse(book)));
    }

    if (requestUrl.pathname === '/api/books' && req.method === 'DELETE') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen boeken verwijderen' });
      }
      const db = getDb();
      const borrowedBooks = db.books.filter((book) => book.status === 'borrowed');
      if (borrowedBooks.length) {
        return sendJson(res, 400, {
          message: 'Lever eerst alle uitgeleende boeken in voordat je de bibliotheek leegt.',
          borrowedCount: borrowedBooks.length,
        });
      }
      const removedCount = db.books.length;
      const removedIds = db.books.map((book) => book.id);
      db.books = [];
      cancelTasksForDeletedBooks(db, removedIds, {
        actorId: user.id, reason: 'library_cleared',
      });
      for (const student of db.students) {
        if (!Array.isArray(student.borrowedBooks)) continue;
        student.borrowedBooks = [];
      }
      appendHistory(db, {
        type: 'books_deleted',
        message:
          removedCount > 0
            ? `${removedCount} boeken zijn verwijderd uit de bibliotheek`
            : 'De bibliotheek is leeggemaakt',
      });
      saveDb(db);
      return sendJson(res, 200, {
        message:
          removedCount > 0
            ? `${removedCount} boeken verwijderd uit de bibliotheek.`
            : 'Er waren geen boeken om te verwijderen.',
        removedCount,
      });
    }

    const bookIdMatch = requestUrl.pathname.match(/^\/api\/books\/([\w-]+)$/);
    if (bookIdMatch && req.method === 'GET') {
      const db = getDb();
      const book = findBookById(db, bookIdMatch[1]);
      if (!book) {
        return sendJson(res, 404, { message: 'Boek niet gevonden' });
      }
      const borrowCounts = getBorrowCountsMap(db.history);
      const payload = withBorrowCount(book, borrowCounts);
      return sendJson(res, 200, sanitizeBookForResponse(payload));
    }

    const bookImportInfoMatch = requestUrl.pathname.match(/^\/api\/books\/([\w-]+)\/import-info$/);
    if (bookImportInfoMatch && req.method === 'GET') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen importgegevens bekijken' });
      }
      const db = getDb();
      const book = findBookById(db, bookImportInfoMatch[1]);
      if (!book) {
        return sendJson(res, 404, { message: 'Boek niet gevonden' });
      }
      if (!book.importInfo) {
        return sendJson(res, 404, { message: 'Geen importgegevens bekend voor dit boek' });
      }
      return sendJson(res, 200, {
        ...book.importInfo,
        importProvenance: normalizeBookImportProvenance(book.importProvenance),
      });
    }

    if (requestUrl.pathname === '/api/books' && req.method === 'POST') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen boeken toevoegen' });
      }
      // Retain the initial request DB snapshot. The write-conflict guard must
      // reject an older writer if a staged import commits while it awaits.
      const originalDb = getDb();
      const body = await parseBody(req);
      if (!body.title || !body.author || !body.barcode) {
        return sendJson(res, 400, { message: 'Titel, auteur en barcode zijn verplicht' });
      }
      const normalizedBarcode = normalizeBarcode(body.barcode);
      if (!normalizedBarcode) {
        return sendJson(res, 400, { message: 'Voer een geldige barcode in' });
      }
      const metadataIsbn = sanitizeIsbn(body.metadataIsbn);
      const tags = parseMultiValueField(body.tags);
      const manualThemes = normalizeManualThemes(body.manualThemes);
      const publisher = normalizePublisher(body.publisher);
      const publishedYear = normalizePublishedYear(body.publishedYear ?? body.year ?? body.publishedAt);
      const pageCount = normalizePageCountValue(body.pageCount ?? body.pages);
      const language = normalizeLanguageCode(body.language);
      const coverUrl = resolveEffectiveCoverUrl(body.coverUrl);
      let localCoverUrl = '';
      if (coverUrl) {
        try { localCoverUrl = await coverAssets.saveSource(coverUrl); }
        catch { return sendJson(res, 422, { message: 'Omslag kon niet veilig worden opgeslagen. Controleer de afbeeldingslink.' }); }
      }
      // An old request must still fail if a confirmed reviewed import happened
      // while its body or cover image was being downloaded.
      // Other concurrent changes (loans, accounts, etc.) must be preserved.
      // No more awaits occur between this reload and saveDb().
      const db = loadDb();
      assertReviewedImportBoundaryUnchanged(originalDb, db);
      const coverColor = typeof body.coverColor === 'string' ? body.coverColor : '#f9f9f9';
      const baseBook = {
        title: body.title,
        author: body.author,
        barcode: normalizedBarcode,
        metadataIsbn,
        description: body.description || '',
        suitableForExamList: Boolean(body.suitableForExamList),
        easyReading: Boolean(body.easyReading),
        tags,
        manualThemes,
        coverColor,
        publisher,
        publishedYear,
        pageCount,
        language,
        coverUrl,
        localCoverUrl,
        coverCrop: normalizeCoverCrop(body.coverCrop),
      };
      const quantity = parseQuantityInput(body.quantity, { defaultValue: 1 });
      const createdBooks = [];
      for (let i = 0; i < quantity; i += 1) {
        const copy = createBookCopyFromTemplate(baseBook);
        createdBooks.push(copy);
      }
      db.books.push(...createdBooks);
      appendHistory(db, {
        type: 'book_created',
        bookId: createdBooks[0]?.id,
        message:
          createdBooks.length === 1
            ? `${createdBooks[0].title} is toegevoegd aan de bibliotheek`
            : `${createdBooks.length} exemplaren van ${createdBooks[0].title} toegevoegd aan de bibliotheek`,
      });
      saveDb(db);
      return sendJson(res, 201, {
        created: createdBooks.length,
        ids: createdBooks.map((entry) => entry.id),
        books: createdBooks,
        book: createdBooks[0] || null,
      });
    }

    if (bookIdMatch && req.method === 'PUT') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen boeken wijzigen' });
      }
      const originalDb = getDb();
      const originalBook = findBookById(originalDb, bookIdMatch[1]);
      if (!originalBook) return sendJson(res, 404, { message: 'Boek niet gevonden' });
      const body = await parseBody(req);
      const requestedCoverUrl = Object.prototype.hasOwnProperty.call(body, 'coverUrl')
        ? resolveEffectiveCoverUrl(body.coverUrl) : null;
      const previousBook = originalBook;
      let preparedLocalCoverUrl = null;
      if (requestedCoverUrl !== null) {
        if (!requestedCoverUrl) preparedLocalCoverUrl = '';
        else if (requestedCoverUrl === resolveEffectiveCoverUrl(previousBook.coverUrl)) {
          // Saving an unrelated field must work even when a legacy cover URL
          // has disappeared. Missing files are retried separately.
          preparedLocalCoverUrl = coverAssets.hasAsset(previousBook.localCoverUrl)
            ? previousBook.localCoverUrl : '';
        } else {
          try { preparedLocalCoverUrl = await coverAssets.saveSource(requestedCoverUrl); }
          catch { return sendJson(res, 422, { message: 'Omslag kon niet veilig worden opgeslagen. Controleer de afbeeldingslink.' }); }
        }
      }
      // If the same physical copy changed during the await, editing against
      // its old cover/loan state would overwrite the other operation.
      const db = loadDb();
      assertReviewedImportBoundaryUnchanged(originalDb, db);
      const book = findBookById(db, bookIdMatch[1]);
      if (!book) return sendJson(res, 409, {
        message: 'Dit boek is intussen verwijderd. Vernieuw de pagina.',
        error: 'DATABASE_WRITE_CONFLICT',
      });
      // Background cover caching may update only localCoverUrl while an
      // administrator is saving. That is not an editable-book conflict.
      // Any real change to loan state, cover source, crop or metadata still is.
      const currentComparable = { ...book, localCoverUrl: undefined };
      const initialComparable = { ...originalBook, localCoverUrl: undefined };
      if (JSON.stringify(currentComparable) !== JSON.stringify(initialComparable)) {
        return sendJson(res, 409, {
          message: 'Dit boek is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.',
          error: 'DATABASE_WRITE_CONFLICT',
        });
      }
      const hasNewBarcode = Object.prototype.hasOwnProperty.call(body, 'barcode');
      const normalizedNewBarcode = hasNewBarcode
        ? normalizeBarcode(body.barcode)
        : normalizeBarcode(book.barcode);
      if (hasNewBarcode && !normalizedNewBarcode) {
        return sendJson(res, 400, { message: 'Voer een geldige barcode in' });
      }
      const hasMetadataIsbn = Object.prototype.hasOwnProperty.call(body, 'metadataIsbn');
      const currentMetadataIsbn = sanitizeIsbn(book.metadataIsbn);
      const nextMetadataIsbn = hasMetadataIsbn ? sanitizeIsbn(body.metadataIsbn) : currentMetadataIsbn;
      const hasPublisher = Object.prototype.hasOwnProperty.call(body, 'publisher');
      const hasPublishedYear =
        Object.prototype.hasOwnProperty.call(body, 'publishedYear') ||
        Object.prototype.hasOwnProperty.call(body, 'year');
      const hasPageCount =
        Object.prototype.hasOwnProperty.call(body, 'pageCount') ||
        Object.prototype.hasOwnProperty.call(body, 'pages');
      const hasLanguage = Object.prototype.hasOwnProperty.call(body, 'language');
      const hasCoverUrl = Object.prototype.hasOwnProperty.call(body, 'coverUrl');
      const hasTags = Object.prototype.hasOwnProperty.call(body, 'tags');
      const hasManualThemes = Object.prototype.hasOwnProperty.call(body, 'manualThemes');
      const nextTags = hasTags ? parseMultiValueField(body.tags) : book.tags;
      // The theme editor submits the full selected set. Preserve any
      // noncanonical themes that the administrator intentionally left selected
      // after an earlier Excel import, without broadening the curated list.
      const selectedThemes = hasManualThemes ? parseMultiValueField(body.manualThemes)
        .filter((theme) => {
          const key = normalizeRawThemeTag(theme);
          return key && !EASY_READING_TAGS.has(key) && key !== 'makkelijklezen' && key !== 'ml';
        }).slice(0, 40) : [];
      const selectedHasFreeform = selectedThemes.some((theme) => !normalizeManualTheme(theme));
      const nextManualThemes = hasManualThemes
        ? selectedHasFreeform ? [] : normalizeManualThemes(selectedThemes)
        : book.manualThemes;
      const nextPublisher = hasPublisher ? normalizePublisher(body.publisher) : book.publisher;
      const nextPublishedYear = hasPublishedYear
        ? normalizePublishedYear(body.publishedYear ?? body.year ?? body.publishedAt)
        : book.publishedYear;
      const nextPageCount = hasPageCount
        ? normalizePageCountValue(body.pageCount ?? body.pages)
        : book.pageCount;
      const nextLanguage = hasLanguage ? normalizeLanguageCode(body.language) : book.language;
      const nextCoverUrl = hasCoverUrl ? resolveEffectiveCoverUrl(body.coverUrl) : resolveEffectiveCoverUrl(book.coverUrl);
      const nextCoverCrop = Object.prototype.hasOwnProperty.call(body, 'coverCrop')
        ? normalizeCoverCrop(body.coverCrop)
        : (hasCoverUrl && nextCoverUrl !== book.coverUrl ? null : normalizeCoverCrop(book.coverCrop));
      const addCopies = parseQuantityInput(body.addCopies, { allowZero: true, defaultValue: 0 });
      const removeCopies = parseQuantityInput(body.removeCopies, { allowZero: true, defaultValue: 0 });
      const quantityChangeInput = Number(body.quantityChange);
      const quantityChange = Number.isFinite(quantityChangeInput)
        ? Math.trunc(quantityChangeInput)
        : addCopies - removeCopies;
      const createdCopies = [];
      const removedCopies = [];
      // Catalog editions are grouped by title, author and metadata ISBN,
      // independently of scanned barcodes. Capture that exact membership
      // before editing the representative, so all copies stay consistent.
      const editionKey = getBookGroupKey(book);
      const previousCoverUrl = book.coverUrl;
      const editionCopies = db.books.filter((copy) => getBookGroupKey(copy) === editionKey
        && copy.coverUrl === previousCoverUrl);
      const cachedEditionCover = editionCopies.find((copy) => coverAssets.hasAsset(copy.localCoverUrl))?.localCoverUrl || '';
      // Reuse a still-valid sibling asset when this specific copy has no local
      // cache yet. Never carry an image across a changed source URL.
      const nextLocalCoverUrl = nextCoverUrl === resolveEffectiveCoverUrl(previousCoverUrl)
        ? cachedEditionCover
        : (hasCoverUrl ? preparedLocalCoverUrl : '');
      Object.assign(book, {
        title: body.title ?? book.title,
        author: body.author ?? book.author,
        barcode: normalizedNewBarcode || '',
        metadataIsbn: nextMetadataIsbn,
        description: body.description ?? book.description,
        suitableForExamList: body.suitableForExamList ?? book.suitableForExamList,
        easyReading: body.easyReading ?? book.easyReading,
        tags: nextTags,
        manualThemes: nextManualThemes,
        // An explicit theme edit supersedes metadata imported earlier.
        // An empty selection must not resurrect old metadata themes.
        importedThemes: hasManualThemes
          ? selectedHasFreeform ? selectedThemes : []
          : book.importedThemes,
        themesCleared: hasManualThemes ? selectedThemes.length === 0 : book.themesCleared === true,
        coverColor: body.coverColor ?? book.coverColor,
        publisher: nextPublisher,
        publishedYear: nextPublishedYear,
        pageCount: nextPageCount,
        language: nextLanguage,
        coverUrl: nextCoverUrl,
        localCoverUrl: nextLocalCoverUrl,
        coverCrop: nextCoverCrop,
      });
      // If title/author/ISBN changed, this copy moved to another catalog
      // edition. Do not overwrite artwork on the edition it just left.
      if ((hasCoverUrl || Object.prototype.hasOwnProperty.call(body, 'coverCrop'))
        && getBookGroupKey(book) === editionKey) {
        for (const copy of editionCopies) {
          if (copy.id === book.id) continue;
          // Do not change an edition with a different manually selected cover.
          copy.coverUrl = nextCoverUrl;
          copy.localCoverUrl = book.localCoverUrl;
          copy.coverCrop = nextCoverCrop;
        }
      }
      if (quantityChange !== 0) {
        const groupId = getBookGroupId(book);
        const groupCopies = groupId ? db.books.filter((entry) => getBookGroupId(entry) === groupId) : [book];
        if (quantityChange > 0) {
          const baseTemplate = { ...book };
          for (let i = 0; i < quantityChange; i += 1) {
            const copy = createBookCopyFromTemplate(baseTemplate);
            createdCopies.push(copy);
          }
          db.books.push(...createdCopies);
        } else {
          const removeCount = Math.abs(quantityChange);
          const preferredRemoveId = typeof body.removeCopyId === 'string' ? body.removeCopyId : book.id;
          const removableCopies = groupCopies.filter((entry) => entry.status !== 'borrowed');
          if (removableCopies.length < removeCount) {
            return sendJson(res, 400, {
              message: 'Er zijn niet genoeg beschikbare exemplaren om te verwijderen.',
            });
          }
          const sortedRemovals = [];
          const preferred = removableCopies.find((entry) => entry.id === preferredRemoveId);
          if (preferred) {
            sortedRemovals.push(preferred);
          }
          for (const entry of removableCopies) {
            if (sortedRemovals.includes(entry)) continue;
            sortedRemovals.push(entry);
            if (sortedRemovals.length >= removeCount) {
              break;
            }
          }
          while (sortedRemovals.length > removeCount) {
            sortedRemovals.pop();
          }
          for (const entry of sortedRemovals) {
            const index = db.books.findIndex((bookEntry) => bookEntry.id === entry.id);
            if (index !== -1) {
              const [removed] = db.books.splice(index, 1);
              removedCopies.push(removed);
            }
          }
        }
      }
      if (removedCopies.length) cancelTasksForDeletedBooks(db,
        removedCopies.map((entry) => entry.id), {
          actorId: user.id, reason: 'physical_copy_reduced',
        });
      Object.assign(book, attachDerivedThemeFields(book));
      const currentGroup = getGroupForBook(db, book);
      const totalCopies = currentGroup?.books?.length ?? null;
      const availableCopies = currentGroup?.books?.filter((entry) => entry.status !== 'borrowed').length ?? null;
      const historyParts = [`${book.title} is bijgewerkt`];
      if (createdCopies.length) {
        historyParts.push(`+${createdCopies.length} exemplaren`);
      }
      if (removedCopies.length) {
        historyParts.push(`-${removedCopies.length} exemplaren`);
      }
      appendHistory(db, {
        type: 'book_updated',
        bookId: book.id,
        message: historyParts.join(' | '),
      });
      saveDb(db);
      if (book.coverUrl && !book.localCoverUrl) scheduleCoverBackfill({ resetFailures: true });
      return sendJson(res, 200, {
        book,
        createdCopies: createdCopies.map((entry) => entry.id),
        removedCopies: removedCopies.map((entry) => entry.id),
        totalCopies,
        availableCopies,
      });
    }

    const bookImportReportMatch = requestUrl.pathname.match(/^\/api\/admin\/book-import-reports(?:\/([a-f0-9-]+))?$/);
    if (bookImportReportMatch) {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders mogen importverslagen bekijken.' });
      }
      if (req.method !== 'GET') return sendJson(res, 405, { message: 'Methode niet toegestaan.' });
      const reports = Array.isArray(getDb().bookImportReports) ? getDb().bookImportReports : [];
      if (bookImportReportMatch[1]) {
        const report = reports.find((item) => item?.id === bookImportReportMatch[1]);
        if (!report) return sendJson(res, 404, { message: 'Importverslag niet gevonden.' });
        return sendJson(res, 200, { ...report,
          fullyReviewed: reportIsFullyReviewed(getDb(), report.id) });
      }
      return sendJson(res, 200, { reports: reports.slice(-30).reverse().map((item) => ({
        id: item.id, fileName: item.fileName, importedAt: item.importedAt,
        createdBy: item.createdBy, count: item.count, sourceRows: item.sourceRows,
        fullyReviewed: reportIsFullyReviewed(getDb(), item.id),
      })) });
    }

    // PR7: personal reminder settings for the authenticated staff account.
    // These actions never change login identity or other staff accounts.
    const mailRoute = '/api/staff/book-import-mail-preferences';
    if (requestUrl.pathname === mailRoute) {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, user ? 403 : 401,
          { message: 'Log in als medewerker om e-mailmeldingen in te stellen.' });
      }
      const mailConfig = importMailConfiguration(process.env);
      const authPath = process.env.BOEKENBAAI_AUTH_DATA_PATH
        ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
        : DATA_PATH + '.auth.json';
      if (req.method === 'GET') {
        const own = prefsFor(getDb(), user.id);
        const links = readSchoolLinks(authPath);
        return sendJson(res, 200, {
          mode: own.mode, alternateEmail: own.alternateEmail,
          pendingEmail: own.pending && own.pending.expiresAt > Date.now()
            ? own.pending.email : '',
          schoolEmail: schoolEmailFor(links, user.id, mailConfig.schoolDomain),
          deliveryConfigured: mailConfig.ready,
        });
      }
      if (req.method !== 'POST') {
        return sendJson(res, 405, { message: 'Methode niet toegestaan.' });
      }
      const body = await parseBody(req);
      const database = loadDb();
      if (body?.action === 'use_school' || body?.action === 'disable'
        || body?.action === 'use_alternate') {
        const mode = body.action === 'use_school' ? 'school'
          : body.action === 'disable' ? 'off' : 'alternate';
        if (mode === 'alternate' && !prefsFor(database, user.id).alternateEmail) {
          return sendJson(res, 409, {
            message: 'Bevestig eerst je alternatieve e-mailadres.' });
        }
        changePreference(database, user.id, mode);
        saveDb(database);
        return sendJson(res, 200, { mode });
      }
      if (body?.action === 'request_alternative') {
        if (!mailConfig.ready) return sendJson(res, 503, {
          message: 'E-mailverzending is nog niet ingesteld door beheer.' });
        const wanted = validEmail(body.email);
        if (!wanted) return sendJson(res, 400, {
          message: 'Voer een geldig zakelijk e-mailadres in.' });
        const attempt = beginVerification(database, user.id,
          wanted, mailConfig.key);
        if (!attempt.ok) return sendJson(res,
          ['rate_limited', 'daily_limit'].includes(attempt.error) ? 429 : 400, {
            message: attempt.error === 'rate_limited'
              ? 'Vraag na vijf minuten opnieuw een verificatiecode aan.'
              : attempt.error === 'daily_limit'
                ? 'Maximaal drie verificatiemails per 24 uur. Probeer het morgen opnieuw.'
                : 'Het e-mailadres is ongeldig.' });
        saveDb(database);
        const mailId = crypto.createHash('sha256')
          .update(JSON.stringify(['boekenbaai-verify-v1', user.id,
            attempt.next.pending.hash])).digest('hex');
        const sent = await bridgeSend({
          config: mailConfig, id: mailId, to: wanted,
          subject: 'Boekenbaai: verifieer je herinneringsadres',
          body: 'Je hebt in Boekenbaai dit e-mailadres gekozen voor herinneringen.\n'
            + 'Voer de volgende code in bij je accountinstellingen:\n\n'
            + attempt.code + '\n\n'
            + 'De code blijft 24 uur geldig. Heb je dit niet aangevraagd? '
            + 'Dan hoef je niets te doen.\n\nBoekenbaai',
        });
        if (!sent) return sendJson(res, 502, {
          message: 'Het versturen van de verificatiemail is niet bevestigd. '
            + 'Probeer het later opnieuw.' });
        return sendJson(res, 200, { pendingEmail: wanted });
      }
      if (body?.action === 'confirm_alternative') {
        const attempt = confirmVerification(database, user.id,
          String(body.code || ''), mailConfig.key);
        if (!attempt.ok) {
          if (attempt.persist) saveDb(database);
          return sendJson(res, 400, { message: 'Ongeldige of verlopen verificatiecode.' });
        }
        saveDb(database);
        return sendJson(res, 200, {
          mode: 'alternate', alternateEmail: prefsFor(database, user.id).alternateEmail,
        });
      }
      return sendJson(res, 400, { message: 'Onbekende instelling.' });
    }

    // PR6: all classrooms share one persistent task per physical book. The
    // server scopes every task to current teacher assignments, never the
    // client's cached class or student list.
    const taskRoot = '/api/staff/book-import-followups';
    if (requestUrl.pathname === taskRoot
      || requestUrl.pathname.startsWith(taskRoot + '/')) {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, user ? 403 : 401, { message: 'Alleen medewerkers mogen importtaken bekijken.' });
      }
      if (req.method === 'GET' && requestUrl.pathname === taskRoot) {
        return sendJson(res, 200, listTasks(getDb(), user));
      }
      const decisionMatch = requestUrl.pathname.match(
        /^\/api\/staff\/book-import-followups\/([a-z0-9-]+)\/decision$/);
      if (req.method === 'POST' && decisionMatch) {
        const body = await parseBody(req);
        const database = loadDb();
        const task = database.bookImportFollowups.find((item) => item.id === decisionMatch[1]);
        if (!task) return sendJson(res, 404, { message: 'Importtaak niet gevonden.' });
        const adminLibraryDecision = user.role === 'admin' && libraryOnlyTask(task)
          && ['library_keep', 'library_remove'].includes(body?.choice);
        if (!adminLibraryDecision && (!task.classId
          || !mayManageClass(database, user, task.classId))) {
          return sendJson(res, 403, { message: 'Deze klas hoort niet bij jouw taken.' });
        }
        if (task.status === 'completed') {
          return sendJson(res, 409, { message: 'Deze taak is al door een collega afgehandeld.' });
        }
        const decision = performDecision(database, task, user, body);
        if (!decision.ok) {
          const errors = {
            book_circulation_changed_since_import:
              'Dit boek is sinds de import opnieuw uitgeleend of ingeleverd. '
                + 'Een oude Excel-uitlening kan niet opnieuw worden geactiveerd. '
                + 'Controleer de actuele situatie of leg de taak terug bij beheer.',
            existing_fixed_location_conflict:
              'Dit boek heeft al een andere vaste klaslocatie. Laat beheer dit verschil controleren.',
            book_already_borrowed:
              'Dit boek is op dit moment al uitgeleend. Een tweede uitleenactie is niet mogelijk.',
            student_already_borrowed_edition:
              'Deze leerling heeft al een exemplaar van dezelfde editie.',
          };
          return sendJson(res, 409, {
            message: errors[decision.error]
              || 'De taak of uitleenstatus is gewijzigd. Vernieuw het overzicht.',
            error: decision.error,
          });
        }
        appendHistory(database, { type: 'book_import_followup', performedBy: user.id,
          bookId: task.bookId, classId: task.classId,
          message: body.choice === 'library_remove'
            ? 'Boek uit schoolcollectie verwijderd na importcontrole'
            : 'Importtaak bijgewerkt' });
        saveDb(database);
        return sendJson(res, 200, { taskId: task.id, status: task.status, revision: task.revision });
      }
      return sendJson(res, 405, { message: 'Methode niet toegestaan.' });
    }

    const followupAdminRoot = '/api/admin/book-import-followups';
    if (requestUrl.pathname === followupAdminRoot
      || requestUrl.pathname.startsWith(followupAdminRoot + '/')) {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, user ? 403 : 401, { message: 'Alleen beheer kan opvolgtaken toewijzen.' });
      }
      if (requestUrl.pathname === followupAdminRoot + '/settings') {
        if (req.method === 'GET') return sendJson(res, 200, settingsFor(getDb()));
        if (req.method === 'PUT') {
          const body = await parseBody(req);
          const settings = validateSettings(body);
          if (!settings) return sendJson(res, 400, { message: 'Kies geldige herinnerings- en escalatiedagen.' });
          const database = loadDb();
          const oldRevision = Number.isSafeInteger(database.bookImportFollowupSettings?.revision)
            ? database.bookImportFollowupSettings.revision : 0;
          database.bookImportFollowupSettings = { ...settings, revision: oldRevision + 1 };
          saveDb(database);
          return sendJson(res, 200, settings);
        }
      }
      const cancelFollowupMatch = requestUrl.pathname.match(
        /^\/api\/admin\/book-import-followups\/([a-z0-9-]+)\/cancel$/);
      if (req.method === 'POST' && cancelFollowupMatch) {
        const body = await parseBody(req);
        const database = loadDb();
        const task = database.bookImportFollowups.find((entry) =>
          entry.id === cancelFollowupMatch[1]);
        if (!task) return sendJson(res, 404, { message: 'Importtaak niet gevonden.' });
        const cancelled = cancelMissingBookTask(database, task, user, body.revision);
        if (!cancelled.ok) return sendJson(res, 409, {
          message: 'Deze taak kan niet worden geannuleerd. Vernieuw het overzicht.' });
        appendHistory(database, { type: 'book_import_followup_cancelled',
          performedBy: user.id, bookId: task.bookId,
          message: 'Importtaak geannuleerd omdat het fysieke boek niet bestaat' });
        saveDb(database);
        return sendJson(res, 200, { taskId: task.id, status: task.status,
          revision: task.revision });
      }
      const assignMatch = requestUrl.pathname.match(
        /^\/api\/admin\/book-import-followups\/([a-z0-9-]+)\/assign$/);
      if (req.method === 'POST' && assignMatch) {
        const body = await parseBody(req);
        const database = loadDb();
        const task = database.bookImportFollowups.find((entry) => entry.id === assignMatch[1]);
        if (!task) return sendJson(res, 404, { message: 'Importtaak niet gevonden.' });
        const assigned = assignTask(database, task, body.classId, user, body.revision);
        if (!assigned.ok) return sendJson(res, 409, {
          message: 'De taak is gewijzigd of de klas bestaat niet. Vernieuw het overzicht.' });
        saveDb(database);
        return sendJson(res, 200, { taskId: task.id, classId: task.classId, revision: task.revision });
      }
      return sendJson(res, 405, { message: 'Methode niet toegestaan.' });
    }

    // PR3 staged book import is separate from the legacy direct upload route.
    // The only authority for applying data is the server-owned, single-use
    // staging record; clients may send corrections, never finished book rows.
    const stageRoot = '/api/admin/book-import-stages';
    const stagePath = requestUrl.pathname === stageRoot || requestUrl.pathname.startsWith(stageRoot + '/');
    if (stagePath) {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders mogen een boekimport voorbereiden.' });
      }
      if (req.method === 'GET' && requestUrl.pathname === stageRoot + '/active') {
        const activeStage = bookImportStageStore.active({ refresh: true });
        return sendJson(res, 200, {
          stage: activeStage ? {
            id: activeStage.id, status: activeStage.status,
            revision: activeStage.revision, fileName: activeStage.fileName,
          } : null,
        });
      }
      const stageMatch = requestUrl.pathname.match(/^\/api\/admin\/book-import-stages\/([a-f0-9-]+)(?:\/(review|apply|cancel))?$/);
      if (req.method === 'POST' && requestUrl.pathname === stageRoot) {
        if (activeImportJobs.size > 0) {
          return sendJson(res, 409, { message: 'De oude boekimport is nog bezig. Rond die eerst af.', error: 'legacy_import_busy' });
        }
        const XLSX = loadXlsx();
        if (!XLSX) return sendJson(res, 503, { message: 'Excelverwerking is niet beschikbaar.' });
        // The shared slot becomes visible even while the file body is still
        // uploading, not just when metadata lookup starts.
        const reservation = bookImportStageStore.reserve(user.id);
        if (!reservation.ok) {
          return sendJson(res, 409, {
            message: 'Er staat al een boekimport open. Bekijk of hervat die import.',
            error: reservation.error,
            active: importStageView(reservation.stage),
          });
        }
        let activated = false;
        try {
        const body = await parseBody(req, 35 * 1024 * 1024);
        if (body.mode !== undefined && !['create', 'inventory_sync'].includes(body.mode)) {
          return sendJson(res, 400, { message: 'Ongeldige importmodus.' });
        }
        const mode = body.mode === 'inventory_sync' ? 'inventory_sync' : 'create';
        if (typeof body.file !== 'string' || !body.file) {
          return sendJson(res, 400, { message: 'Kies eerst een Excelbestand.' });
        }
        // Inventory-sync rows describe desired TOTAL stock, not copies to
        // create. An existing school library may exceed the create cap.
        // The inventory planner independently caps NEW additions at 5,000.
        const maxAnalyzedCopies = mode === 'inventory_sync' ? 1_500_000 : 5000;
        const workbook = readBookImportWorkbook(XLSX, body.file, {
          maxRows: 1500, maxCopies: maxAnalyzedCopies,
        });
        if (!workbook.ok) {
          return sendJson(res, 400, { message: 'Dit Excelbestand kan niet veilig verwerkt worden.', error: workbook.error });
        }
        // Authentication can read an older DB before the workbook upload
        // finishes. Read the live collection for the initial preview.
        const database = loadDb();
        const enrichIsbn = body.enrichIsbn === true;
        const lookupIsbn = enrichIsbn ? resolveLookupIsbnMetadata() : null;
        const lookupTitleAuthor = enrichIsbn ? resolveLookupTitleAuthorMetadata() : null;
        // The cache lives only for this stage and avoids additional network
        // requests for identical ISBNs across corrections and reanalysis.
        const exactCache = new Map();
        const titleCache = new Map();
        const retryableExact = new Set();
        const retryableTitle = new Set();
        // Share requests within an analysis, even on failure, to avoid
        // thousands of repeated lookups in a large workbook. A subsequent
        // explicit review can retry unsuccessful results.
        const stageLookup = (cache, retryable, key, lookup) => {
          if (!cache.has(key)) {
            const pending = Promise.resolve().then(lookup);
            cache.set(key, pending);
            pending.then(
              (result) => {
                if (!metadataCandidatesFromResult(result).length) retryable.add(key);
              },
              () => retryable.add(key),
            );
          }
          return cache.get(key);
        };
        const options = {
          mode, maxRows: 1500, maxCopies: maxAnalyzedCopies,
          ...(lookupIsbn ? { lookupIsbn: (isbn) =>
            stageLookup(exactCache, retryableExact, isbn, () => lookupIsbn(isbn)) } : {}),
          ...(lookupTitleAuthor ? { lookupTitleAuthor: (input) => {
            const key = JSON.stringify([input.title, input.author, input.language]);
            return stageLookup(titleCache, retryableTitle, key, () => lookupTitleAuthor(input));
          } } : {}),
          releaseRetryableLookups: () => {
            for (const key of retryableExact) exactCache.delete(key);
            for (const key of retryableTitle) titleCache.delete(key);
            retryableExact.clear();
            retryableTitle.clear();
          },
        };
        const analysis = await analyzeReviewedImport(workbook.rows, [], {
          ...options, existingBooks: database.books,
          students: database.students, classes: database.classes,
          acceptWarnings: false,
        });
        if (!analysis.ok) return sendJson(res, 400, { message: 'Importanalyse mislukt.', error: analysis.error });
        includeDerivedThemesInImportPreview(analysis);
        // Metadata lookups may take time. Check for books added during that
        // analysis just before publishing the ready/blocked decisions.
        const latestDatabase = loadDb();
        analysis.decisions = mode === 'inventory_sync'
          ? buildInventorySyncPreview(analysis, latestDatabase.books, { acceptWarnings: false,
            students: latestDatabase.students, classes: latestDatabase.classes,
            loanReceipts: historicalExcelLoanReceipts(latestDatabase),
            existingFollowups: latestDatabase.bookImportFollowups })
          : buildReviewDecisions(analysis, latestDatabase.books, {
            students: latestDatabase.students, classes: latestDatabase.classes,
          });
        if (!analysis.decisions.ok && mode === 'inventory_sync') {
          return sendJson(res, 400, { message: 'Inventarisvergelijking kon niet worden uitgevoerd.',
            error: analysis.decisions.error });
        }
        bookImportStageStore.activate(reservation.stage, {
          sourceRows: workbook.rows, options,
          workbook: { sheetName: workbook.sheetName, headers: workbook.headers },
          fileName: typeof body.fileName === 'string' ? body.fileName.slice(0, 180) : '',
          analysis,
        });
        activated = true;
        return sendJson(res, 201, importStageView(reservation.stage));
        } finally {
          if (!activated) bookImportStageStore.abandon(reservation.stage);
        }
      }
      if (!stageMatch) return sendJson(res, 404, { message: 'Importcontrole niet gevonden.' });
      const stage = bookImportStageStore.get(stageMatch[1], user.id);
      if (!stage) return sendJson(res, 404, { message: 'Importcontrole ontbreekt of is verlopen.' });
      if (req.method === 'GET' && !stageMatch[2]) {
        return sendJson(res, 200, importStageView(stage));
      }
      if (req.method === 'POST' && stageMatch[2] === 'cancel') {
        const body = await parseBody(req, 10000);
        const cancelled = bookImportStageStore.cancel(stage, body.revision);
        if (!cancelled.ok) {
          return sendJson(res, 409, { message: 'Deze import is inmiddels gewijzigd of wordt verwerkt.', error: cancelled.error });
        }
        return sendJson(res, 200, importStageView(stage));
      }
      if (req.method === 'POST' && stageMatch[2] === 'review') {
        // Corrections for a large school spreadsheet can exceed 400 KB even
        // when every individual field is within the accepted value bounds.
        const body = await parseBody(req, 24 * 1024 * 1024);
        if (!Number.isSafeInteger(body.revision)) return sendJson(res, 400, { message: 'Versienummer ontbreekt.' });
        const started = bookImportStageStore.beginReview(stage, body.revision);
        if (!started.ok) return sendJson(res, 409, { message: 'Deze import is gewijzigd of wordt verwerkt.', error: started.error });
        try {
          if (typeof body.acceptWarnings !== 'boolean') {
            return sendJson(res, 400, { message: 'Geef expliciet aan of waarschuwingen geaccepteerd worden.' });
          }
          const choices = stage.options.mode === 'inventory_sync'
            ? normalizeInventoryResolutions(body.inventoryResolutions)
            : { ok: true, values: [] };
          if (!choices.ok || (stage.options.mode !== 'inventory_sync'
            && body.inventoryResolutions !== undefined)) {
            return sendJson(res, 400, { message: 'Ongeldige voorraadkeuzes.',
              error: choices.error || 'invalid_sync_resolutions' });
          }
          // A review is a fresh retry opportunity. Retain successful metadata.
          stage.options.releaseRetryableLookups?.();
          // Authentication may have loaded an older snapshot while a large
          // review request was uploading. Review against the latest library.
          const database = loadDb();
          const reviewed = await analyzeReviewedImport(stage.sourceRows, body.corrections, {
            ...stage.options, existingBooks: database.books,
            students: database.students, classes: database.classes,
            acceptWarnings: body.acceptWarnings,
          });
          if (!reviewed.ok) {
            return sendJson(res, 400, { message: 'Een correctie is ongeldig.', error: reviewed.error, field: reviewed.field, index: reviewed.index });
          }
          includeDerivedThemesInImportPreview(reviewed);
          // Recheck after any asynchronous lookups, not just after body upload.
          const latestDatabase = loadDb();
          reviewed.decisions = stage.options.mode === 'inventory_sync'
            ? buildInventorySyncPreview(reviewed, latestDatabase.books, {
              acceptWarnings: body.acceptWarnings, resolutions: choices.values,
              students: latestDatabase.students, classes: latestDatabase.classes,
              loanReceipts: historicalExcelLoanReceipts(latestDatabase),
              existingFollowups: latestDatabase.bookImportFollowups,
            })
            : buildReviewDecisions(reviewed, latestDatabase.books, {
              acceptWarnings: body.acceptWarnings,
              students: latestDatabase.students, classes: latestDatabase.classes,
            });
          if (!reviewed.decisions.ok && stage.options.mode === 'inventory_sync') {
            return sendJson(res, 400, { message: 'Inventarisvergelijking kon niet worden uitgevoerd.',
              error: reviewed.decisions.error });
          }
          bookImportStageStore.finishReview(stage, reviewed, body.corrections,
            body.acceptWarnings, choices.values);
          return sendJson(res, 200, importStageView(stage));
        } finally {
          bookImportStageStore.abortReview(stage);
        }
      }
      if (req.method === 'POST' && stageMatch[2] === 'apply') {
        const body = await parseBody(req, 10000);
        if (!Number.isSafeInteger(body.revision) || body.confirm !== true) {
          return sendJson(res, 400, { message: 'Bevestig de gecontroleerde import met het actuele versienummer.' });
        }
        const started = bookImportStageStore.beginApply(stage, body.revision);
        if (!started.ok) return sendJson(res, 409, { message: 'Deze import is al verwerkt of gewijzigd.', error: started.error });
        try {
          // Authentication may have loaded getDb() before the request body
          // finished arriving. Read a fresh snapshot at the synchronous
          // commit boundary: no awaits occur between this read and the
          // atomic save, so competing handlers in this process cannot
          // interleave their writes inside the checked transaction.
          const database = loadDb();
          if (stage.options.mode === 'inventory_sync') {
            // Re-evaluate the target using the live collection immediately
            // before the atomic write. A concurrent admin's barcode, edition,
            // count or active loan change invalidates the approved preview.
            const fresh = buildInventorySyncPreview(stage.analysis, database.books, {
              acceptWarnings: stage.acceptWarnings, resolutions: stage.inventoryResolutions,
              students: database.students, classes: database.classes,
              loanReceipts: historicalExcelLoanReceipts(database),
              existingFollowups: database.bookImportFollowups,
            });
            if (!fresh.ok || !fresh.summary.readyToApply
              || JSON.stringify(fresh.rows) !== JSON.stringify(stage.analysis.decisions?.rows)
              || JSON.stringify(fresh.proposedAdds) !== JSON.stringify(stage.analysis.decisions?.proposedAdds)
              || JSON.stringify(fresh.loanAssignments) !== JSON.stringify(stage.analysis.decisions?.loanAssignments)
              || JSON.stringify(fresh.classFollowups) !== JSON.stringify(stage.analysis.decisions?.classFollowups)
              || JSON.stringify(fresh.omittedEditions) !== JSON.stringify(stage.analysis.decisions?.omittedEditions)
              || fresh.summary.omittedExistingCopies
                !== stage.analysis.decisions?.summary?.omittedExistingCopies) {
              return sendJson(res, 409, {
                message: 'De voorraad is sinds de controle gewijzigd of er staan onopgeloste verschillen. Start een nieuwe vergelijking.',
                error: 'inventory_preview_stale',
              });
            }
            const now = new Date().toISOString();
            const batchId = crypto.randomUUID();
            const createdCopies = [];
            const createdByRow = new Map();
            const restoredLoanEvents = [];
            const reportsByRow = new Map();
            const clearedThemeRows = new Set((stage.corrections || [])
              .filter((correction) => typeof correction?.fields?.themes === 'string'
                && correction.fields.themes.trim() === '')
              .map((correction) => correction.index));
            for (const addition of fresh.proposedAdds) {
              const row = stage.analysis.rows[addition.index];
              // Existing edition fields and loan records are authoritative.
              // Only NEW physical copies are created; old copies are untouched.
              const existingTemplate = addition.templateBookId
                ? database.books.find((book) => book.id === addition.templateBookId) : null;
              if (addition.templateBookId && !existingTemplate) {
                return sendJson(res, 409, { message: 'De editie is intussen gewijzigd.',
                  error: 'inventory_template_missing' });
              }
              const curated = normalizeManualThemes(row.book.manualThemes);
              const preserveAsImported = row.provenance?.themes?.source === 'metadata'
                || curated.length !== row.book.manualThemes.length;
              const sourceFields = {};
              for (const [name, provenance] of Object.entries(row.provenance || {})) {
                const kind = ['excel', 'metadata', 'derived', 'existing', 'manual'].includes(provenance?.source)
                  ? provenance.source : 'unknown';
                sourceFields[name] = createFieldSource(kind, provenance?.detail || null);
              }
              sourceFields.metadataIsbn = sourceFields.editionIsbn || createFieldSource('unknown');
              const template = ensureBookShape({
                // New copies use exactly the data shown and approved in the
                // reviewed Excel preview. No live metadata is copied from an
                // existing edition after the administrator confirms.
                title: row.book.title, author: row.book.author, authors: row.book.authors,
                description: row.book.description, publisher: row.book.publisher,
                publishedYear: row.book.publishedYear, pageCount: row.book.pageCount,
                language: row.book.language, coverUrl: row.book.coverUrl,
                localCoverUrl: '',
                easyReading: row.book.easyReading,
                suitableForExamList: row.book.suitableForExamList,
                tags: row.book.tags,
                manualThemes: preserveAsImported ? [] : row.book.manualThemes,
                importedThemes: preserveAsImported ? row.book.themes : [],
                themesCleared: clearedThemeRows.has(addition.index),
                fixedLocation: row.context?.fixedLocation?.status === 'resolved'
                  ? row.context.fixedLocation.label : null,
                editionIsbn: addition.editionIsbn,
                metadataIsbn: addition.editionIsbn,
                barcode: addition.barcode,
                importInfo: normalizeBookImportInfo({
                  importedAt: now, importedBy: user.id,
                  importSource: 'excel_inventory_sync',
                  importJobId: batchId, importStatus: 'created',
                }),
                importProvenance: { fieldSources: sourceFields },
              });
              const ids = [];
              for (let count = 0; count < addition.quantity; count += 1) {
                const copy = createBookCopyFromTemplate(template);
                createdCopies.push(copy);
                ids.push(copy.id);
                if (!createdByRow.has(addition.index)) createdByRow.set(addition.index, []);
                createdByRow.get(addition.index).push(copy);
              }
              const reportEntry = reportsByRow.get(addition.index) || {
                index: addition.index, worksheetRow: row.sourceRowNumber,
                status: existingTemplate ? 'copies_added' : 'created',
                editionIsbn: addition.editionIsbn, title: template.title,
                copies: 0, bookIds: [],
                issues: row.issues.map((issue) => issue.code),
                provenance: row.provenance, context: row.context,
              };
              reportEntry.copies += addition.quantity;
              reportEntry.bookIds.push(...ids);
              reportsByRow.set(addition.index, reportEntry);
            }
            // Exactly one report entry per original worksheet row. A combined
            // row can also contain a physical barcode that created a copy.
            for (const decision of fresh.rows) {
              if (reportsByRow.has(decision.index)) continue;
              const row = stage.analysis.rows[decision.index];
              reportsByRow.set(decision.index, {
                index: decision.index, worksheetRow: row.sourceRowNumber,
                status: decision.action === 'add_copies' ? 'reconciled' : decision.action,
                copies: 0, bookIds: [],
                title: row.book?.title || '', editionIsbn: row.book?.editionIsbn || '',
                issues: (row.issues || []).map((issue) => issue.code),
              });
            }
            // Reconcile only explicitly identified physical loan owners.
            // A loan already recorded for the same borrower is idempotent.
            // No old book is deleted or assigned a fabricated loan date.
            for (const assignment of fresh.loanAssignments) {
              if (assignment.target === 'already_recorded'
                || assignment.target === 'previously_imported') continue;
              const copy = assignment.target === 'existing'
                ? database.books.find((book) => book.id === assignment.bookId)
                : (createdByRow.get(assignment.index) || [])[0];
              if (!copy) {
                return sendJson(res, 409, {
                  message: 'Het fysieke boek voor de uitlening is gewijzigd.',
                  error: 'loan_copy_missing',
                });
              }
              const event = stageReviewedLoan(copy, assignment.borrower, database);
              restoredLoanEvents.push({ ...event, performedBy: user.id,
                message: 'Bestaande Excel-uitlening overgenomen' });
              const existingReport = reportsByRow.get(assignment.index);
              if (existingReport) {
                existingReport.loanStatus = 'restored';
                if (!existingReport.copies) existingReport.status = 'loan_restored';
                existingReport.borrowerType = assignment.borrower.type;
              }
            }
            for (const assignment of fresh.loanAssignments.filter((item) =>
              item.target === 'already_recorded')) {
              const existingReport = reportsByRow.get(assignment.index);
              if (existingReport) existingReport.loanStatus = 'already_recorded';
            }
            for (const assignment of fresh.loanAssignments.filter((item) =>
              item.target === 'previously_imported')) {
              const existingReport = reportsByRow.get(assignment.index);
              if (existingReport) existingReport.loanStatus = 'previously_imported';
            }
            // Persist acknowledgements even when the Excel loan was already
            // active. A later check-in must not be reversed by the old Excel.
            persistExcelLoanReceipts(database, fresh.loanAssignments.map((assignment) => ({
              bookId: assignment.target === 'new'
                ? (createdByRow.get(assignment.index) || [])[0]?.id : assignment.bookId,
              borrower: assignment.borrower,
            })));
            const report = {
              id: batchId, createdBy: user.id, importedAt: now,
              mode: 'inventory_sync', fileName: stage.fileName,
              restoredLoans: restoredLoanEvents.length,
              loanChanges: restoredLoanEvents.map((event) => ({
                bookId: event.bookId, borrowerType: event.classId ? 'class' : 'student',
                borrowerId: event.classId || event.studentId,
              })),
              count: createdCopies.length,
              sourceRows: stage.analysis.summary.sourceRows,
              omittedExistingCopies: fresh.summary.omittedExistingCopies,
              omittedEditions: fresh.omittedEditions,
              inventoryResolutions: stage.inventoryResolutions,
              rows: [...reportsByRow.values()].sort((a, b) => a.index - b.index),
            };
            if (!Array.isArray(database.bookImportReports)) database.bookImportReports = [];
            database.bookImportReports.push(report);
            database.bookImportReports = database.bookImportReports.slice(-30);
            database.books.push(...createdCopies);
            const followupEntries = [];
            for (const assignment of fresh.classFollowups) {
              const row = stage.analysis.rows[assignment.index];
              const books = assignment.target === 'existing'
                ? database.books.filter((book) => book.id === assignment.bookId)
                : (createdByRow.get(assignment.index) || []);
              for (const book of books) followupEntries.push({ row, book });
            }
            appendImportClassFollowups(database, report, followupEntries, now);
            // A large historic loan migration must not consume the last 200
            // activity events one per book. Retain every individual borrower
            // and book ID in the admin-only durable import report instead.
            if (restoredLoanEvents.length) appendHistory(database, {
              type: 'loans_imported', performedBy: user.id, importBatchId: batchId,
              count: restoredLoanEvents.length,
              message: `${restoredLoanEvents.length} bestaande Excel-uitleningen overgenomen`,
            });
            appendHistory(database, {
              type: 'books_inventory_sync', performedBy: user.id,
              message: `Voorraad vergeleken: ${createdCopies.length} exemplaren toegevoegd, ${restoredLoanEvents.length} bestaande uitleningen overgenomen, geen bestaande exemplaren verwijderd`,
            });
            saveReviewedBookImportDb(database);
            scheduleCoverBackfill({ resetFailures: true });
            bookImportStageStore.finishApply(stage, {
              batchId, created: createdCopies.length,
              restoredLoans: restoredLoanEvents.length, removed: 0,
              retainedEditions: fresh.summary.acknowledgedEditions,
              report, omittedExistingCopies: fresh.summary.omittedExistingCopies,
            });
            return sendJson(res, 200, importStageView(stage));
          }
          const plan = buildStageApplyPlan(
            { ...stage.analysis, acceptWarnings: stage.acceptWarnings },
            database.books, { maxCopies: 5000,
              students: database.students, classes: database.classes },
          );
          if (!plan.ok) {
            // On conflict require a fresh staged review. This stage can never
            // accidentally be applied after another simultaneous upload.
            return sendJson(res, 409, {
              message: 'De import is niet meer veilig toepasbaar. Controleer de collectie en upload opnieuw.',
              error: plan.error, index: plan.index,
            });
          }
          const now = new Date().toISOString();
          const batchId = crypto.randomUUID();
          const newCopies = [];
          const sourceReports = [];
          const importedLoanHistory = [];
          const clearedThemeRows = new Set((stage.corrections || [])
            .filter((correction) => typeof correction?.fields?.themes === 'string'
              && correction.fields.themes.trim() === '')
            .map((correction) => correction.index));
          for (const entry of plan.created) {
            const row = entry.row;
            const sourceByField = Object.create(null);
            for (const [field, provenance] of Object.entries(row.provenance || {})) {
              const sourceType = ['excel', 'metadata', 'derived', 'existing', 'manual'].includes(provenance?.source)
                ? provenance.source : 'unknown';
              sourceByField[field] = createFieldSource(sourceType, provenance?.detail || null);
            }
            // The stored metadataIsbn is deliberately copied from the
            // reviewed editionIsbn. Its source must therefore be identical
            // to the reviewed ISBN source, not an unrelated "unknown".
            sourceByField.metadataIsbn = sourceByField.editionIsbn
              || createFieldSource('unknown', null);
            // The ordinary manual theme editor accepts only curated themes.
            // In the Excel review, administrators may explicitly approve a
            // freeform theme. Preserve the entire reviewed list via the
            // imported theme storage when even one value is not curated.
            const curatedThemes = normalizeManualThemes(row.book.manualThemes);
            const hasFreeformThemes = curatedThemes.length !== row.book.manualThemes.length;
            const preserveAsImported = row.provenance?.themes?.source === 'metadata' || hasFreeformThemes;
            const template = ensureBookShape({
              title: row.book.title, author: row.book.author,
              authors: row.book.authors, editionIsbn: entry.editionIsbn,
              metadataIsbn: entry.editionIsbn, barcode: entry.barcode,
              description: row.book.description, publisher: row.book.publisher,
              publishedYear: row.book.publishedYear, pageCount: row.book.pageCount,
              language: row.book.language, coverUrl: row.book.coverUrl,
                localCoverUrl: '',
              easyReading: row.book.easyReading,
              suitableForExamList: row.book.suitableForExamList,
              tags: row.book.tags,
              manualThemes: preserveAsImported ? [] : row.book.manualThemes,
              importedThemes: preserveAsImported ? row.book.themes : [],
              themesCleared: clearedThemeRows.has(entry.index),
              // Keep resolved classroom shelf information on every created
              // copy as well as in the report; the future lending workflow
              // can use it without recovering an old upload.
              fixedLocation: row.context?.fixedLocation?.status === 'resolved'
                ? row.context.fixedLocation.label : null,
              importInfo: normalizeBookImportInfo({
                importedAt: now, importedBy: user.id, importSource: 'excel_reviewed',
                importJobId: batchId, importStatus: 'created',
              }),
              importProvenance: { fieldSources: sourceByField },
            });
            const newIds = [];
            for (let i = 0; i < entry.quantity; i += 1) {
              const copy = createBookCopyFromTemplate(template);
              if (entry.loanBorrower) {
                // These are old Excel loans, not new checkouts. Do not
                // invent a historical checkout date or reading event.
                const event = stageReviewedLoan(copy, entry.loanBorrower, database);
                importedLoanHistory.push({ ...event, performedBy: user.id,
                  message: 'Bestaande Excel-uitlening overgenomen' });
              }
              newCopies.push(copy);
              newIds.push(copy.id);
            }
            sourceReports.push({
              index: entry.index, worksheetRow: row.sourceRowNumber,
              status: entry.loanBorrower ? 'created_borrowed' : 'created',
              copies: entry.quantity, bookIds: newIds,
              title: row.book.title, editionIsbn: entry.editionIsbn,
              issues: row.issues.map((issue) => issue.code),
              provenance: row.provenance, context: row.context,
            });
          }
          for (const row of stage.analysis.rows.filter((entry) => entry.status === 'skipped')) {
            const original = stage.initialAnalysis?.rows?.[row.index] || row;
            sourceReports.push({
              index: row.index, worksheetRow: row.sourceRowNumber, status: 'skipped', copies: 0,
              title: original.book?.title || '',
              editionIsbn: original.book?.editionIsbn || '',
              barcode: original.book?.barcode || '',
              originalIdentifiers: {
                isbn: original.identifierAnalysis?.explicit?.raw || '',
                legacyIsbn: original.identifierAnalysis?.legacy?.raw || '',
                combinedBarcodeIsbn: original.identifierAnalysis?.ambiguous?.raw || '',
              },
              issues: (original.issues || []).map((issue) => issue.code),
              provenance: original.provenance || {},
              context: original.context || {},
            });
          }
          persistExcelLoanReceipts(database, importedLoanHistory.map((event) => ({
            bookId: event.bookId,
            borrower: event.studentId
              ? { type: 'student', id: event.studentId }
              : { type: 'class', id: event.classId },
          })));
          const report = {
            id: batchId, createdBy: user.id, importedAt: now,
            fileName: stage.fileName, count: newCopies.length,
            restoredLoans: importedLoanHistory.length,
            loanChanges: importedLoanHistory.map((event) => ({
              bookId: event.bookId, borrowerType: event.classId ? 'class' : 'student',
              borrowerId: event.classId || event.studentId,
            })),
            sourceRows: stage.analysis.summary.sourceRows,
            rows: sourceReports.sort((a, b) => a.index - b.index),
          };
          if (!Array.isArray(database.bookImportReports)) database.bookImportReports = [];
          database.bookImportReports.push(report);
          database.bookImportReports = database.bookImportReports.slice(-30);
          database.books.push(...newCopies);
          const rowByIndex = new Map(stage.analysis.rows.map((row) => [row.index, row]));
          const classFollowupEntries = sourceReports
            .filter((entry) => entry.status === 'created' && entry.bookIds?.length
              && plan.decisions.rows[entry.index]?.needsClassFollowup)
            .flatMap((entry) => entry.bookIds.map((id) => ({
              row: rowByIndex.get(entry.index),
              book: database.books.find((book) => book.id === id),
            })));
          appendImportClassFollowups(database, report, classFollowupEntries, now);
          // Only one summary activity event. Per-book audit detail remains
          // in the durable administrator report, not the capped history feed.
          if (importedLoanHistory.length) appendHistory(database, {
            type: 'loans_imported', performedBy: user.id, importBatchId: batchId,
            count: importedLoanHistory.length,
            message: `${importedLoanHistory.length} bestaande Excel-uitleningen overgenomen`,
          });
          appendHistory(database, {
            type: 'books_import_reviewed', performedBy: user.id,
            message: `Gecontroleerde boekimport: ${newCopies.length} exemplaren toegevoegd, ${importedLoanHistory.length} bestaande leningen overgenomen`,
          });
          saveReviewedBookImportDb(database);
            scheduleCoverBackfill({ resetFailures: true });
          const result = { batchId, created: newCopies.length,
            restoredLoans: importedLoanHistory.length, importedRows: plan.created.length, report };
          bookImportStageStore.finishApply(stage, result);
          return sendJson(res, 200, importStageView(stage));
        } finally {
          bookImportStageStore.abortApply(stage);
        }
      }
      return sendJson(res, 405, { message: 'Methode niet toegestaan.' });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/books/import-jobs') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen lijsten importeren' });
      }
      if (bookImportStageStore.active()) {
        return sendJson(res, 409, { message: 'Er staat al een gecontroleerde boekimport open.', error: 'stage_busy' });
      }
      const XLSX = loadXlsx();
      if (!XLSX) {
        return sendJson(res, 503, {
          message: 'Excel-import is momenteel niet beschikbaar omdat de "xlsx" module ontbreekt op de server',
        });
      }
      if (!globalFetch) {
        return sendJson(res, 503, { message: 'Background import is momenteel niet beschikbaar op deze server' });
      }
      const existingJob = (getDb().importJobs || []).find((entry) =>
        entry
        && entry.type === 'books_import'
        && entry.createdBy === user.id
        && (entry.status === 'queued' || entry.status === 'running')
      );
      if (existingJob) {
        activeImportJobs.set(user.id, existingJob.id);
        return sendJson(res, 200, { jobId: existingJob.id, reused: true });
      }
      const body = await parseBody(req);
      if (!body.file) {
        return sendJson(res, 400, { message: 'Geen bestand ontvangen' });
      }
      const workbookResult = readWorkbookRows(XLSX, body.file);
      if (!workbookResult.ok) {
        return sendJson(res, 400, { message: workbookResult.error });
      }
      const db = getDb();
      const now = new Date().toISOString();
      const jobId = crypto.randomUUID();
      db.importJobs.push({
        id: jobId,
        type: 'books_import',
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        finishedAt: null,
        status: 'queued',
        currentStage: 'In wachtrij',
        lastProgressAt: now,
        cancelRequested: false,
        cancelledAt: null,
        fileName: typeof body.fileName === 'string' ? body.fileName : '',
        total: workbookResult.rows.length,
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        deferred: 0,
        failed: 0,
        summary: null,
        result: null,
        error: '',
      });
      saveDb(db);
      activeImportJobs.set(user.id, jobId);
      const token = getTokenFromHeader(req);
      // The response ends before the legacy worker does. Keep its admission
      // lease until the worker has also finalized the persistent job.
      requestImportAdmission.lease.jobId = jobId;
      // Private to this running server and never persisted or returned to a client.
      requestImportAdmission.lease.handoffSecret = crypto.randomBytes(32).toString('hex');
      requestImportAdmission.lease.handedOff = true;

      setImmediate(async () => {
        try {
          const runtimeDb = loadDb();
          const runtimeJob = (runtimeDb.importJobs || []).find((entry) => entry?.id === jobId);
          if (!runtimeJob) {
            return;
          }
          if (
            runtimeJob.status !== 'queued'
            || runtimeJob.status === 'cancelled'
            || runtimeJob.cancelRequested
          ) {
            return;
          }
          updateImportJob(runtimeDb, jobId, {
            status: 'running',
            startedAt: new Date().toISOString(),
            currentStage: 'Voorbereiden',
            lastProgressAt: new Date().toISOString(),
          });
          saveDb(runtimeDb);
          const response = await globalFetch(`http://127.0.0.1:${PORT}/api/books/import`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'X-Import-Job-Id': jobId,
              'X-Import-Internal-Token': requestImportAdmission.lease.handoffSecret,
            },
            body: JSON.stringify({ file: body.file, enrichIsbn: body.enrichIsbn }),
          });
          const payload = await response.json().catch(() => ({}));
          const jobDb = loadDb();
          if (!response.ok) {
            updateImportJob(jobDb, jobId, {
              status: 'failed',
              finishedAt: new Date().toISOString(),
              error: payload?.message || 'Importjob mislukt',
              failed: 1,
            });
          } else {
            const latestJob = (jobDb.importJobs || []).find((entry) => entry?.id === jobId);
            const shouldCancelAtFinalize = Boolean(
              payload?.cancelled
              || latestJob?.cancelRequested
              || latestJob?.status === 'cancelled'
            );
            if (shouldCancelAtFinalize) {
            updateImportJob(jobDb, jobId, {
              status: 'cancelled',
              finishedAt: new Date().toISOString(),
              cancelledAt: new Date().toISOString(),
              currentStage: 'Geannuleerd',
              summary: {
                created: Number(payload.created || 0),
                updated: Number(payload.updated || 0),
                skipped: Array.isArray(payload.skipped) ? payload.skipped.length : 0,
                failed: Number(payload.failed || 0),
              },
              result: payload,
              error: '',
            });
            } else {
              const skippedCount = Array.isArray(payload.skipped) ? payload.skipped.length : 0;
              updateImportJob(jobDb, jobId, {
                status: 'completed',
                finishedAt: new Date().toISOString(),
                processed: workbookResult.rows.length,
                created: Number(payload.created || 0),
                updated: Number(payload.updated || 0),
                skipped: skippedCount,
                summary: {
                  created: Number(payload.created || 0),
                  updated: Number(payload.updated || 0),
                  skipped: skippedCount,
                  failed: 0,
                },
                currentStage: 'Voltooid',
                result: payload,
                error: '',
              });
            }
          }
          saveDb(jobDb);
        } catch (error) {
          const failedDb = loadDb();
          updateImportJob(failedDb, jobId, {
            status: 'failed',
            finishedAt: new Date().toISOString(),
            error: error?.message || 'Importjob mislukt',
            failed: 1,
          });
          saveDb(failedDb);
        } finally {
          activeImportJobs.delete(user.id);
          releaseBookImportLease(requestImportAdmission.lease);
        }
      });
      return sendJson(res, 202, { jobId });
    }

    const booksImportJobMatch = requestUrl.pathname.match(/^\/api\/books\/import-jobs\/([\w-]+)$/);
    if (req.method === 'GET' && booksImportJobMatch) {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen lijsten importeren' });
      }
      const db = getDb();
      const job = (db.importJobs || []).find((entry) => entry?.id === booksImportJobMatch[1]);
      if (!job) {
        return sendJson(res, 404, { message: 'Importjob niet gevonden' });
      }
      if (job.createdBy !== user.id) {
        return sendJson(res, 403, { message: 'Geen toegang tot deze importjob' });
      }
      return sendJson(res, 200, job);
    }

    const booksImportJobCancelMatch = requestUrl.pathname.match(/^\/api\/books\/import-jobs\/([\w-]+)\/cancel$/);
    if (req.method === 'POST' && booksImportJobCancelMatch) {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen lijsten importeren' });
      }
      const db = getDb();
      const job = (db.importJobs || []).find((entry) => entry?.id === booksImportJobCancelMatch[1]);
      if (!job) {
        return sendJson(res, 404, { message: 'Importjob niet gevonden' });
      }
      if (job.createdBy !== user.id) {
        return sendJson(res, 403, { message: 'Geen toegang tot deze importjob' });
      }
      if (!['queued', 'running'].includes(job.status)) {
        return sendJson(res, 409, { message: 'Importjob kan niet meer geannuleerd worden' });
      }
      const now = new Date().toISOString();
      if (job.status === 'queued') {
        updateImportJob(db, job.id, {
          status: 'cancelled',
          cancelRequested: true,
          cancelledAt: now,
          finishedAt: now,
          currentStage: 'Geannuleerd',
          lastProgressAt: now,
        });
      } else {
        updateImportJob(db, job.id, {
          cancelRequested: true,
          currentStage: 'Annulering aangevraagd',
          lastProgressAt: now,
        });
      }
      saveDb(db);
      return sendJson(res, 200, (db.importJobs || []).find((entry) => entry?.id === job.id));
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/books/import') {
      if (bookImportStageStore.active()) {
        return sendJson(res, 409, { message: 'Er staat al een gecontroleerde boekimport open.', error: 'stage_busy' });
      }
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen lijsten importeren' });
      }
      const XLSX = loadXlsx();
      if (!XLSX) {
        return sendJson(res, 503, {
          message: 'Excel-import is momenteel niet beschikbaar omdat de "xlsx" module ontbreekt op de server',
        });
      }
      const body = await parseBody(req);
      if (!body.file) {
        return sendJson(res, 400, { message: 'Geen bestand ontvangen' });
      }
      const workbookResult = readWorkbookRows(XLSX, body.file);
      if (!workbookResult.ok) {
        return sendJson(res, 400, { message: workbookResult.error });
      }
      const db = getDb();
      const importJobId = String(req.headers['x-import-job-id'] || '').trim();
      const updateImportProgress = (updates) => {
        if (!importJobId) return;
        const jobDb = loadDb();
        const existingJob = (jobDb.importJobs || []).find((entry) => entry?.id === importJobId);
        if (!existingJob || existingJob.status === 'cancelled') return;
        updateImportJob(jobDb, importJobId, {
          ...updates,
          lastProgressAt: new Date().toISOString(),
        });
        saveDb(jobDb);
      };
      const isImportCancelRequested = () => {
        if (!importJobId) return false;
        const jobDb = loadDb();
        const existingJob = (jobDb.importJobs || []).find((entry) => entry?.id === importJobId);
        return Boolean(existingJob?.cancelRequested);
      };
      const createdBooks = [];
      const updatedBooks = [];
      const skipped = [];
      let changed = false;

      const markBooksDeferred = (bookIds = []) => {
        let didChange = false;
        for (const bookId of bookIds) {
          if (!bookId) continue;
          const book = db.books.find((entry) => entry.id === bookId);
          if (!book) continue;
          const importInfo = normalizeBookImportInfo(book.importInfo);
          if (!importInfo) continue;
          const process = normalizeBookImportProcess(importInfo.process, importInfo.importStatus) || {
            result: importInfo.importStatus,
            lookupAttempted: false,
            lookupFound: false,
            lookupSource: null,
            fallbackUsed: false,
            fallbackSource: null,
            wasDeferred: false,
            deferCount: 0,
          };
          process.wasDeferred = true;
          process.deferCount = (Number.isFinite(process.deferCount) ? process.deferCount : 0) + 1;
          book.importInfo = normalizeBookImportInfo({
            ...importInfo,
            process,
          });
          didChange = true;
        }
        return didChange;
      };
      let processedRows = 0;
      let cancelled = false;
      const lookup = resolveLookupIsbnMetadata();
      const titleAuthorLookup = resolveLookupTitleAuthorMetadata();
      const importEnrichmentEnabled =
        body.enrichIsbn === undefined
          ? true
          : parseBooleanFlag(body.enrichIsbn);
      const importFinalizeDelayMs = (() => {
        if (process.env.NODE_ENV !== 'test') {
          return 0;
        }
        const raw = Number(process.env.BOEKENBAAI_IMPORT_FINALIZE_DELAY_MS);
        if (Number.isFinite(raw) && raw > 0) {
          return Math.floor(raw);
        }
        return 0;
      })();
      const IMPORT_FALLBACK_DEFERRED_MAX_ATTEMPTS = 4;
      const IMPORT_FALLBACK_DEFERRED_MAX_CYCLES = 40;
      const IMPORT_FALLBACK_DEFERRED_MAX_DURATION_MS = 5000;
      const deferredFallbackRows = [];
      const deferredRetryStartedAt = Date.now();
      updateImportProgress({
        currentStage: 'Rijen verwerken',
        total: workbookResult.rows.length,
        processed: 0,
      });

      for (const row of workbookResult.rows) {
        if (isImportCancelRequested()) {
          cancelled = true;
          break;
        }
        const fallbackAttempt = Number.isInteger(row?.__fallbackAttempt) ? row.__fallbackAttempt : 1;
        const normalized = normalizeRowKeys(row);
        const title = String(normalized.titel || normalized.title || '').trim();
        const author = String(normalized.auteur || normalized.author || '').trim();
        const barcodeSource =
          normalized.barcode ||
          normalized['barcode / isbn'] ||
          normalized.isbn ||
          normalized['isbn13'] ||
          normalized['isbn-13'] ||
          normalized['isbn 13'] ||
          normalized['isbn'] ||
          normalized.ean ||
          normalized['ean13'] ||
          normalized['ean-13'] ||
          normalized['streepjescode'] ||
          normalized.code ||
          normalized['isbn-nummer'];
        const barcode = normalizeBarcode(barcodeSource);
        const metadataIsbnSource =
          normalized['metadata isbn'] ||
          normalized['metadataisbn'] ||
          normalized['intern isbn'] ||
          normalized['intern-isbn'] ||
          normalized['internisbn'] ||
          normalized['isbn inwendig'] ||
          normalized['isbn-inwendig'];
        const metadataIsbn = sanitizeIsbn(metadataIsbnSource);
        const quantityValue = parseQuantityInput(
          normalized.aantal ||
            normalized['aantal exemplaren'] ||
            normalized.quantity ||
            normalized.exemplaren ||
            normalized.copies ||
            normalized['number of copies'],
          { defaultValue: 1 }
        );
        const missingFields = [];
        if (!title) missingFields.push('titel');
        if (!author) missingFields.push('auteur');
        if (!barcode) missingFields.push('barcode/ISBN');
        if (missingFields.length) {
          skipped.push({
            title: title || '(onbekend)',
            author: author || '',
            barcode: barcodeSource ? String(barcodeSource).trim() : '',
            reason: `Ontbrekende ${missingFields.join(', ')}`,
          });
          processedRows += 1;
          updateImportProgress({
            processed: processedRows,
            created: createdBooks.length,
            updated: updatedBooks.length,
            skipped: skipped.length,
            deferred: deferredFallbackRows.length,
            failed: 0,
            currentStage: `Rij ${processedRows} van ${workbookResult.rows.length}`,
          });
          continue;
        }

        const description = String(
          normalized.beschrijving ||
            normalized.description ||
            normalized.samenvatting ||
            normalized.summary ||
            ''
        ).trim();
        const publisherSource =
          normalized.uitgever ||
          normalized.publisher ||
          normalized['uitgeverij'] ||
          normalized['publisher name'];
        const publisher = normalizePublisher(publisherSource);
        const publishedYearSource =
          normalized.jaar ||
          normalized['jaar van uitgave'] ||
          normalized.publicatiejaar ||
          normalized.publishedyear ||
          normalized.year ||
          normalized.jaaruitgave ||
          normalized.published ||
          normalized['publication year'];
        const publishedYear = normalizePublishedYear(publishedYearSource);
        const pageCountSource =
          normalized.paginas ||
          normalized['paginas'] ||
          normalized['aantal paginas'] ||
          normalized['aantal pagina\'s'] ||
          normalized.pages ||
          normalized.pagecount ||
          normalized['page count'];
        const pageCount = normalizePageCountValue(pageCountSource);
        const languageSource =
          normalized.taal ||
          normalized.language ||
          normalized.taalcode ||
          normalized['language code'];
        const language = normalizeLanguageCode(languageSource);
        const coverUrlSource =
          normalized.cover ||
          normalized['cover url'] ||
          normalized.coverurl ||
          normalized.afbeelding ||
          normalized.image ||
          normalized['image url'] ||
          normalized['afbeelding url'];
        const coverUrl = resolveEffectiveCoverUrl(coverUrlSource);
        const curatedThemeColumns = ["thema's", 'themas', 'thema'];
        const rawTagColumns = ['tags', 'trefwoorden', 'keywords', 'onderwerpen', 'onderwerp(en)'];
        const hasCuratedThemeColumns = hasImportColumn(normalized, curatedThemeColumns);
        const manualThemes = normalizeManualThemes(
          collectImportColumnValues(normalized, curatedThemeColumns)
        );
        const hasRawTagColumns = hasImportColumn(normalized, rawTagColumns);
        const tags = Array.from(
          new Set(
            collectImportColumnValues(normalized, rawTagColumns)
              .map((value) =>
                typeof value === 'string' ? value.trim() : String(value ?? '').trim()
              )
              .filter(Boolean)
          )
        );
        const hasExplicitRawTagValues = hasRawTagColumns && tags.length > 0;
        const examValue =
          normalized.leeslijst ||
          normalized['op de leeslijst'] ||
          normalized.examlist ||
          normalized['exam list'] ||
          normalized.examenmateriaal;
        const suitableForExamList = parseBooleanFlag(examValue);
        const easyReadingValue = normalized['makkelijk lezen'] || normalized['makkelijk lezen?'];
        const easyReading = parseBooleanFlag(easyReadingValue);

        const metadataLookupValue = resolveMetadataLookupKey(metadataIsbn, barcode);
        const cacheKey = getIsbnCacheKey(metadataLookupValue);
        const allowLookup = importEnrichmentEnabled && !isbnLookupInflight.has(cacheKey);
        let metadata = null;
        if (allowLookup) {
          try {
            metadata = await lookup(metadataLookupValue);
          } catch (error) {
            console.warn('ISBN-verrijking mislukt:', error?.message || error);
          }
        }
        const normalizedMetadata = normalizeIsbnMetadata(metadata);
        let metadataFields = normalizedMetadata.fields;
        const enrichment =
          importEnrichmentEnabled || metadata
            ? { source: normalizedMetadata.source, found: Boolean(normalizedMetadata.found) }
            : null;
        const importInfoBase = {
          importedAt: new Date().toISOString(),
          importedBy: user?.id || null,
          importSource: 'excel',
          importJobId: importJobId || null,
          metadataLookupSummary: enrichment
            ? {
              found: Boolean(enrichment.found),
              source: enrichment.source ? String(enrichment.source) : null,
            }
            : null,
        };

        const existingBook = metadataIsbn
          ? findBookByMetadataIsbn(db, metadataIsbn)
          : findBookByBarcode(db, barcode);
        const affectedBookIds = new Set();
        if (existingBook?.id) {
          affectedBookIds.add(existingBook.id);
        }
        const hasCoverInput = coverUrlSource !== undefined && String(coverUrlSource).trim();
        const hasPublisherInput = publisherSource !== undefined && String(publisherSource).trim();
        const hasDescriptionInput = description.length > 0;
        const rowTitle = title || existingBook?.title || '';
        const rowAuthor = author || existingBook?.author || '';
        const hadExistingCoverUrl = Boolean(existingBook?.coverUrl);
        const hadExistingPublisher = Boolean(existingBook?.publisher);
        const hadExistingDescription = Boolean(existingBook?.description);
        const missingFieldsBeforeFallback = [];
        if (!(hasCoverInput || hadExistingCoverUrl || metadataFields?.coverUrl)) missingFieldsBeforeFallback.push('coverUrl');
        if (!(hasPublisherInput || hadExistingPublisher || metadataFields?.publisher)) missingFieldsBeforeFallback.push('publisher');
        if (!(hasDescriptionInput || hadExistingDescription || metadataFields?.description)) missingFieldsBeforeFallback.push('description');
        const shouldTryTitleAuthorFallback = importEnrichmentEnabled
          && Boolean(titleAuthorLookup)
          && Boolean(rowTitle && rowAuthor)
          && missingFieldsBeforeFallback.length > 0;
        logImportFallbackVerbose('row_fallback_check', {
          title: rowTitle,
          author: rowAuthor,
          barcode,
          metadataIsbn,
          missingFieldsBeforeFallback,
          hadExistingCoverUrl: hadExistingCoverUrl ? 'yes' : 'no',
          hadExistingPublisher: hadExistingPublisher ? 'yes' : 'no',
          hadExistingDescription: hadExistingDescription ? 'yes' : 'no',
        });
        if (!shouldTryTitleAuthorFallback) {
          const skipReason = !importEnrichmentEnabled
            ? 'fallback_source_not_applicable'
            : !titleAuthorLookup
              ? 'fallback_source_not_applicable'
              : missingFieldsBeforeFallback.length === 0
                ? 'no_missing_fields'
                : !rowTitle
                  ? 'missing_title'
                  : !rowAuthor
                    ? 'missing_author'
                    : 'exact_result_already_sufficient';
          logImportFallbackDebug('row_fallback_skipped', {
            reason: skipReason,
            title: rowTitle,
            author: rowAuthor,
            barcode,
            metadataIsbn,
            missingFieldsBeforeFallback,
          });
        }
        let fallbackUsed = false;
        let fallbackSourceUsed = null;
        let fallbackTransientReason = null;
        let fallbackTarget = null;
        if (shouldTryTitleAuthorFallback) {
          fallbackTarget = {
            title: rowTitle,
            author: rowAuthor,
            rawTitle: rowTitle,
            language: language || existingBook?.language || metadataFields?.language || '',
          };
          try {
            const fallbackLookupResult = await titleAuthorLookup(fallbackTarget, { includeStatus: true });
            const strictFallbackMetadata =
              fallbackLookupResult
              && typeof fallbackLookupResult === 'object'
              && Object.prototype.hasOwnProperty.call(fallbackLookupResult, 'metadata')
                ? fallbackLookupResult.metadata
                : fallbackLookupResult;
            if (
              fallbackLookupResult
              && typeof fallbackLookupResult === 'object'
              && Object.prototype.hasOwnProperty.call(fallbackLookupResult, 'metadata')
            ) {
              fallbackTransientReason = fallbackLookupResult.transientReason || null;
            }
            if (strictFallbackMetadata && typeof strictFallbackMetadata === 'object'
              && isStrictWorkMatch(fallbackTarget, strictFallbackMetadata)) {
              fallbackSourceUsed = strictFallbackMetadata.source
                ? String(strictFallbackMetadata.source).toLowerCase()
                : 'googlebooks-title-author';
              metadataFields = mergeLookupMetadata(metadataFields || {}, strictFallbackMetadata);
              fallbackUsed = true;
            } else if (!fallbackTransientReason) {
              logImportFallbackDebug('fallback_result', {
                accepted: false,
                acceptedFields: [],
                rejectReason: 'strict_match_failed_or_empty',
                source: strictFallbackMetadata?.source || null,
              });
            }
          } catch (error) {
            console.warn('Titel/auteur fallback-verrijking mislukt:', error?.message || error);
            if (isTransientFallbackNetworkError(error)) {
              fallbackTransientReason = 'network_error';
            } else {
              logImportFallbackDebug('fallback_result', {
                accepted: false,
                acceptedFields: [],
                rejectReason: 'lookup_error',
                source: 'googlebooks',
              });
            }
          }
        }
        const importProcessBase = {
          result: existingBook ? 'updated' : 'created',
          lookupAttempted: Boolean(allowLookup),
          lookupFound: Boolean(enrichment?.found),
          lookupSource: enrichment?.source ? String(enrichment.source).toLowerCase() : null,
          fallbackUsed: Boolean(fallbackUsed),
          fallbackSource: fallbackUsed ? fallbackSourceUsed : null,
          wasDeferred: false,
          deferCount: 0,
        };
        const finalCoverUrlSource = hasCoverInput
          ? 'input'
          : existingBook?.coverUrl
            ? 'existing'
            : metadataFields?.coverUrl
              ? (fallbackUsed && metadataFields?.source === 'googlebooks-title-author' ? 'fallback' : (metadataFields?.source || 'isbn'))
              : '';
        const finalPublisherSource = hasPublisherInput
          ? 'input'
          : existingBook?.publisher
            ? 'existing'
            : metadataFields?.publisher
              ? (fallbackUsed && metadataFields?.source === 'googlebooks-title-author' ? 'fallback' : (metadataFields?.source || 'isbn'))
              : '';
        const finalDescriptionSource = hasDescriptionInput
          ? 'input'
          : existingBook?.description
            ? 'existing'
            : metadataFields?.description
              ? (fallbackUsed && metadataFields?.source === 'googlebooks-title-author' ? 'fallback' : (metadataFields?.source || 'isbn'))
              : '';
        const defaultMetadataSourceDetail = pickSourceDetailForMetadata('metadata', metadataFields);
        logImportFallbackDebug('row_final_metadata', {
          title: rowTitle || metadataFields?.title || '',
          author: rowAuthor || metadataFields?.author || '',
          coverUrlSource: finalCoverUrlSource,
          publisherSource: finalPublisherSource,
          descriptionSource: finalDescriptionSource,
          fallbackUsed,
        });
        let baseTemplate = null;
        if (existingBook) {
          const nextTitle = title || existingBook.title || metadataFields?.title || '';
          const nextAuthor = author || existingBook.author || metadataFields?.author || '';
          const nextDescription =
            description || existingBook.description || metadataFields?.description || '';
          const nextPublisher = hasPublisherInput
            ? publisher
            : existingBook.publisher || metadataFields?.publisher || '';
          const hasPublishedYearInput = publishedYearSource !== undefined && publishedYearSource !== '';
          const nextPublishedYear = hasPublishedYearInput
            ? publishedYear
            : existingBook.publishedYear ?? metadataFields?.publishedYear ?? null;
          const hasPageCountInput = pageCountSource !== undefined && pageCountSource !== '';
          const nextPageCount = hasPageCountInput
            ? pageCount
            : existingBook.pageCount ?? metadataFields?.pageCount ?? null;
          const hasLanguageInput = languageSource !== undefined && String(languageSource).trim();
          const nextLanguage = hasLanguageInput
            ? language
            : existingBook.language || metadataFields?.language || '';
          const nextCoverUrl = hasCoverInput
            ? coverUrl
            : existingBook.coverUrl || metadataFields?.coverUrl || '';
          const nextTags = (() => {
            if (hasExplicitRawTagValues) return tags;
            if (Array.isArray(existingBook.tags) && existingBook.tags.length) return existingBook.tags;
            return metadataFields?.tags || [];
          })();
          const nextManualThemes = hasCuratedThemeColumns
            ? manualThemes
            : normalizeManualThemes(existingBook.manualThemes);
          const hasMetadataInput = metadataIsbnSource !== undefined;
          const existingMetadataIsbn = sanitizeIsbn(existingBook.metadataIsbn);
          const nextMetadataIsbn = hasMetadataInput ? metadataIsbn : existingMetadataIsbn;
          const provenanceByField = {
            title: createFieldSource(
              title ? 'excel' : existingBook.title ? 'existing' : metadataFields?.title ? 'metadata' : 'unknown',
              title ? null : existingBook.title ? null : pickSourceDetailForMetadata('metadata', metadataFields)
            ),
            author: createFieldSource(
              author ? 'excel' : existingBook.author ? 'existing' : metadataFields?.author ? 'metadata' : 'unknown',
              author ? null : existingBook.author ? null : pickSourceDetailForMetadata('metadata', metadataFields)
            ),
            barcode: createFieldSource(existingBook.barcode ? 'existing' : barcode ? 'excel' : 'unknown'),
            metadataIsbn: createFieldSource(
              hasMetadataInput ? 'excel' : existingMetadataIsbn ? 'existing' : 'unknown'
            ),
            publisher: createFieldSource(
              hasPublisherInput ? 'excel' : existingBook.publisher ? 'existing' : metadataFields?.publisher ? 'metadata' : 'unknown',
              hasPublisherInput || existingBook.publisher ? null : defaultMetadataSourceDetail
            ),
            publishedYear: createFieldSource(
              hasPublishedYearInput ? 'excel' : existingBook.publishedYear != null ? 'existing' : metadataFields?.publishedYear != null ? 'metadata' : 'unknown',
              hasPublishedYearInput || existingBook.publishedYear != null ? null : defaultMetadataSourceDetail
            ),
            pageCount: createFieldSource(
              hasPageCountInput ? 'excel' : existingBook.pageCount != null ? 'existing' : metadataFields?.pageCount != null ? 'metadata' : 'unknown',
              hasPageCountInput || existingBook.pageCount != null ? null : defaultMetadataSourceDetail
            ),
            language: createFieldSource(
              hasLanguageInput ? 'excel' : existingBook.language ? 'existing' : metadataFields?.language ? 'metadata' : 'unknown',
              hasLanguageInput || existingBook.language ? null : defaultMetadataSourceDetail
            ),
            tags: createFieldSource(
              hasExplicitRawTagValues ? 'excel' : (Array.isArray(existingBook.tags) && existingBook.tags.length) ? 'existing' : (Array.isArray(metadataFields?.tags) && metadataFields.tags.length) ? 'metadata' : 'unknown',
              hasExplicitRawTagValues || (Array.isArray(existingBook.tags) && existingBook.tags.length)
                ? null
                : defaultMetadataSourceDetail
            ),
            themes: createFieldSource(
              hasCuratedThemeColumns ? 'excel' : 'derived',
              null
            ),
            description: createFieldSource(
              hasDescriptionInput ? 'excel' : existingBook.description ? 'existing' : metadataFields?.description ? 'metadata' : 'unknown',
              hasDescriptionInput || existingBook.description ? null : defaultMetadataSourceDetail
            ),
            coverUrl: createFieldSource(
              hasCoverInput ? 'excel' : existingBook.coverUrl ? 'existing' : metadataFields?.coverUrl ? 'metadata' : 'unknown',
              hasCoverInput || existingBook.coverUrl ? null : defaultMetadataSourceDetail
            ),
          };

          const updates = {};
          if (nextTitle !== existingBook.title) {
            updates.title = nextTitle;
          }
          if (nextAuthor !== existingBook.author) {
            updates.author = nextAuthor;
          }
          if (nextDescription !== existingBook.description) {
            updates.description = nextDescription;
          }
          if (nextPublisher !== existingBook.publisher) {
            updates.publisher = nextPublisher;
          }
          if (nextPublishedYear !== existingBook.publishedYear) {
            updates.publishedYear = nextPublishedYear;
          }
          if (nextPageCount !== existingBook.pageCount) {
            updates.pageCount = nextPageCount;
          }
          if (nextLanguage !== existingBook.language) {
            updates.language = nextLanguage;
          }
          if (nextCoverUrl !== existingBook.coverUrl) {
            // A single title can represent several physical copies. Keep
            // copies using the same original cover consistent with the import.
            const previousCoverUrl = existingBook.coverUrl;
            const previousEditionKey = getBookGroupKey(existingBook);
            const nextEditionKey = getBookGroupKey({
              ...existingBook, title: nextTitle, author: nextAuthor, metadataIsbn: nextMetadataIsbn,
            });
            if (nextEditionKey === previousEditionKey) {
              for (const copy of db.books) {
                if (copy.id === existingBook.id || copy.coverUrl !== previousCoverUrl
                  || getBookGroupKey(copy) !== previousEditionKey) continue;
                copy.coverUrl = nextCoverUrl;
                copy.localCoverUrl = '';
                copy.coverCrop = null;
              }
            }
            updates.coverUrl = nextCoverUrl;
            // Local files belong to a specific source. A new external URL
            // must be fetched instead of displaying the previous cached cover.
            updates.localCoverUrl = '';
            updates.coverCrop = null;
          }
          if (hasMetadataInput && nextMetadataIsbn !== existingMetadataIsbn) {
            updates.metadataIsbn = nextMetadataIsbn;
          }
          const currentTagKeys = new Set((existingBook.tags || []).map((tag) => tag.toLowerCase()));
          const newTagKeys = new Set(nextTags.map((tag) => tag.toLowerCase()));
          let tagsChanged = currentTagKeys.size !== newTagKeys.size;
          if (!tagsChanged) {
            for (const key of currentTagKeys) {
              if (!newTagKeys.has(key)) {
                tagsChanged = true;
                break;
              }
            }
          }
          if (tagsChanged) {
            updates.tags = nextTags;
          }
          const currentManualThemeKeys = new Set(
            normalizeManualThemes(existingBook.manualThemes).map((theme) => theme.toLowerCase())
          );
          const newManualThemeKeys = new Set(nextManualThemes.map((theme) => theme.toLowerCase()));
          let manualThemesChanged = currentManualThemeKeys.size !== newManualThemeKeys.size;
          if (!manualThemesChanged) {
            for (const key of currentManualThemeKeys) {
              if (!newManualThemeKeys.has(key)) {
                manualThemesChanged = true;
                break;
              }
            }
          }
          if (manualThemesChanged) {
            updates.manualThemes = nextManualThemes;
          }
          if (examValue !== undefined && examValue !== '' && suitableForExamList !== existingBook.suitableForExamList) {
            updates.suitableForExamList = suitableForExamList;
          }
          if (easyReadingValue !== undefined && easyReadingValue !== '' && easyReading !== existingBook.easyReading) {
            updates.easyReading = easyReading;
          }
          if (Object.keys(updates).length) {
            Object.assign(existingBook, updates);
            existingBook.importInfo = normalizeBookImportInfo({
              ...importInfoBase,
              importStatus: 'updated',
              process: {
                ...importProcessBase,
                result: 'updated',
              },
            });
            existingBook.importProvenance = normalizeBookImportProvenance({
              fieldSources: provenanceByField,
            });
            Object.assign(existingBook, attachDerivedThemeFields(existingBook));
            updatedBooks.push({
              title: existingBook.title,
              author: existingBook.author,
              barcode: existingBook.barcode,
              metadataIsbn: existingBook.metadataIsbn,
              publisher: existingBook.publisher,
              publishedYear: existingBook.publishedYear,
              pageCount: existingBook.pageCount,
              language: existingBook.language,
              tags: existingBook.tags,
              manualThemes: existingBook.manualThemes,
              themes: existingBook.themes,
              suitableForExamList: existingBook.suitableForExamList,
              easyReading: existingBook.easyReading,
              status: 'updated',
              enrichment: enrichment || undefined,
            });
            changed = true;
          }
          baseTemplate = { ...existingBook };
        }
        if (!baseTemplate) {
          const hasPublishedYearInput = publishedYearSource !== undefined && publishedYearSource !== '';
          const hasPageCountInput = pageCountSource !== undefined && pageCountSource !== '';
          const hasLanguageInput = languageSource !== undefined && String(languageSource).trim();
          const metadataSourceDetail = pickSourceDetailForMetadata('metadata', metadataFields);
          const createdProvenance = normalizeBookImportProvenance({
            fieldSources: {
              title: createFieldSource(title ? 'excel' : metadataFields?.title ? 'metadata' : 'unknown', title ? null : metadataSourceDetail),
              author: createFieldSource(author ? 'excel' : metadataFields?.author ? 'metadata' : 'unknown', author ? null : metadataSourceDetail),
              barcode: createFieldSource('excel'),
              metadataIsbn: createFieldSource(metadataIsbn ? 'excel' : 'unknown'),
              publisher: createFieldSource(publisherSource !== undefined ? 'excel' : metadataFields?.publisher ? 'metadata' : 'unknown', publisherSource !== undefined ? null : metadataSourceDetail),
              publishedYear: createFieldSource(hasPublishedYearInput ? 'excel' : metadataFields?.publishedYear != null ? 'metadata' : 'unknown', hasPublishedYearInput ? null : metadataSourceDetail),
              pageCount: createFieldSource(hasPageCountInput ? 'excel' : metadataFields?.pageCount != null ? 'metadata' : 'unknown', hasPageCountInput ? null : metadataSourceDetail),
              language: createFieldSource(hasLanguageInput ? 'excel' : metadataFields?.language ? 'metadata' : 'unknown', hasLanguageInput ? null : metadataSourceDetail),
              tags: createFieldSource(hasExplicitRawTagValues ? 'excel' : (Array.isArray(metadataFields?.tags) && metadataFields.tags.length) ? 'metadata' : 'unknown', hasExplicitRawTagValues ? null : metadataSourceDetail),
              themes: createFieldSource(hasCuratedThemeColumns ? 'excel' : 'derived'),
              description: createFieldSource(hasDescriptionInput ? 'excel' : metadataFields?.description ? 'metadata' : 'unknown', hasDescriptionInput ? null : metadataSourceDetail),
              coverUrl: createFieldSource(hasCoverInput ? 'excel' : metadataFields?.coverUrl ? 'metadata' : 'unknown', hasCoverInput ? null : metadataSourceDetail),
            },
          });
          baseTemplate = ensureBookShape({
            id: crypto.randomUUID(),
            title: title || metadataFields?.title || '',
            author: author || metadataFields?.author || '',
            barcode,
            metadataIsbn,
            description: description || metadataFields?.description || '',
            tags: hasExplicitRawTagValues ? tags : metadataFields?.tags || [],
            manualThemes,
            publisher: publisherSource !== undefined ? publisher : metadataFields?.publisher || '',
            publishedYear:
              publishedYearSource !== undefined && publishedYearSource !== ''
                ? publishedYear
                : metadataFields?.publishedYear ?? null,
            pageCount:
              pageCountSource !== undefined && pageCountSource !== ''
                ? pageCount
                : metadataFields?.pageCount ?? null,
            language:
              languageSource !== undefined && String(languageSource).trim()
                ? language
                : metadataFields?.language || '',
            coverUrl:
              coverUrlSource !== undefined && String(coverUrlSource).trim()
                ? coverUrl
                : metadataFields?.coverUrl || '',
            suitableForExamList,
            easyReading,
            importProvenance: createdProvenance,
          });
        }
        const copiesToCreate = parseQuantityInput(quantityValue, { defaultValue: 1, allowZero: true });
        for (let i = 0; i < copiesToCreate; i += 1) {
          const copy = createBookCopyFromTemplate(baseTemplate);
          copy.importInfo = normalizeBookImportInfo({
            ...importInfoBase,
            importStatus: 'created',
            process: {
              ...importProcessBase,
              result: 'created',
            },
          });
          copy.importProvenance = normalizeBookImportProvenance(baseTemplate.importProvenance);
          db.books.push(copy);
          affectedBookIds.add(copy.id);
          createdBooks.push({
            title: copy.title,
            author: copy.author,
            barcode: copy.barcode,
            metadataIsbn: copy.metadataIsbn,
            publisher: copy.publisher,
            publishedYear: copy.publishedYear,
            pageCount: copy.pageCount,
            language: copy.language,
            tags: copy.tags,
            suitableForExamList: copy.suitableForExamList,
            easyReading: copy.easyReading,
            status: 'created',
            enrichment: enrichment || undefined,
          });
        }
        if (copiesToCreate > 0) {
          changed = true;
        }
        if (fallbackTransientReason) {
          const retryAttempt = fallbackAttempt + 1;
          const retryDelayMs = Math.max(getFallbackCooldownRemainingMs(), 50);
          if (retryAttempt <= IMPORT_FALLBACK_DEFERRED_MAX_ATTEMPTS) {
            if (markBooksDeferred(Array.from(affectedBookIds))) {
              changed = true;
            }
            deferredFallbackRows.push({
              row,
              fallbackTarget,
              reason: fallbackTransientReason,
              attempt: retryAttempt,
              nextEligibleAt: Date.now() + retryDelayMs,
              affectedBookIds: Array.from(affectedBookIds),
            });
            logImportFallbackDebug('row_deferred_transient', {
              title: rowTitle,
              author: rowAuthor,
              barcode,
              reason: fallbackTransientReason,
              attempt: fallbackAttempt,
            });
            logImportFallbackDebug('row_retry_scheduled', {
              title: rowTitle,
              author: rowAuthor,
              barcode,
              reason: fallbackTransientReason,
              nextAttempt: retryAttempt,
              waitMs: retryDelayMs,
            });
          } else {
            logImportFallbackDebug('row_retry_exhausted', {
              title: rowTitle,
              author: rowAuthor,
              barcode,
              reason: fallbackTransientReason,
              attempt: fallbackAttempt,
            });
          }
        }
        processedRows += 1;
        updateImportProgress({
          processed: processedRows,
          created: createdBooks.length,
          updated: updatedBooks.length,
          skipped: skipped.length,
          deferred: deferredFallbackRows.length,
          failed: 0,
          currentStage: `Rij ${processedRows} van ${workbookResult.rows.length}`,
        });
      }

      let deferredCycles = 0;
      if (!cancelled && deferredFallbackRows.length) {
        updateImportProgress({
          currentStage: 'Uitgestelde metadata opnieuw proberen',
          deferred: deferredFallbackRows.length,
        });
      }
      while (deferredFallbackRows.length
        && deferredCycles < IMPORT_FALLBACK_DEFERRED_MAX_CYCLES
        && (Date.now() - deferredRetryStartedAt) < IMPORT_FALLBACK_DEFERRED_MAX_DURATION_MS) {
        if (isImportCancelRequested()) {
          cancelled = true;
          break;
        }
        deferredFallbackRows.sort((left, right) => left.nextEligibleAt - right.nextEligibleAt);
        const job = deferredFallbackRows.shift();
        const waitMs = Math.max(0, job.nextEligibleAt - Date.now());
        if (waitMs > 0) {
          await wait(Math.min(waitMs, 120));
        }
        deferredCycles += 1;
        const rowTitle = job.fallbackTarget?.title || '';
        const rowAuthor = job.fallbackTarget?.author || '';
        logImportFallbackDebug('row_retry_attempt', {
          title: rowTitle,
          author: rowAuthor,
          reason: job.reason,
          attempt: job.attempt,
        });
        let retryResult = null;
        try {
          retryResult = await titleAuthorLookup(job.fallbackTarget, { includeStatus: true });
        } catch (error) {
          if (isTransientFallbackNetworkError(error)) {
            retryResult = { metadata: null, transientReason: 'network_error', outcome: 'network_error' };
          } else {
            retryResult = { metadata: null, transientReason: null, outcome: 'lookup_error' };
          }
        }
        const retryMetadata = retryResult?.metadata || null;
        if (retryMetadata && isStrictWorkMatch(job.fallbackTarget, retryMetadata)) {
          let rowUpdated = false;
          for (const bookId of job.affectedBookIds) {
            const book = db.books.find((entry) => entry.id === bookId);
            if (!book) continue;
            let didUpdate = false;
            if (!book.coverUrl && retryMetadata.coverUrl) {
              book.coverUrl = retryMetadata.coverUrl;
              const existingProvenance = normalizeBookImportProvenance(book.importProvenance) || { fieldSources: {} };
              existingProvenance.fieldSources.coverUrl = createFieldSource(
                'metadata',
                retryMetadata.source || 'googlebooks-title-author'
              );
              book.importProvenance = existingProvenance;
              didUpdate = true;
            }
            if (!book.publisher && retryMetadata.publisher) {
              book.publisher = retryMetadata.publisher;
              const existingProvenance = normalizeBookImportProvenance(book.importProvenance) || { fieldSources: {} };
              existingProvenance.fieldSources.publisher = createFieldSource(
                'metadata',
                retryMetadata.source || 'googlebooks-title-author'
              );
              book.importProvenance = existingProvenance;
              didUpdate = true;
            }
            if (!book.description && retryMetadata.description) {
              book.description = retryMetadata.description;
              const existingProvenance = normalizeBookImportProvenance(book.importProvenance) || { fieldSources: {} };
              existingProvenance.fieldSources.description = createFieldSource(
                'metadata',
                retryMetadata.source || 'googlebooks-title-author'
              );
              book.importProvenance = existingProvenance;
              const importInfo = normalizeBookImportInfo(book.importInfo);
              if (importInfo) {
                const process = normalizeBookImportProcess(importInfo.process, importInfo.importStatus) || {
                  result: importInfo.importStatus,
                  lookupAttempted: false,
                  lookupFound: false,
                  lookupSource: null,
                  fallbackUsed: false,
                  fallbackSource: null,
                  wasDeferred: false,
                  deferCount: 0,
                };
                process.fallbackUsed = true;
                process.fallbackSource = retryMetadata.source
                  ? String(retryMetadata.source).toLowerCase()
                  : (process.fallbackSource || 'googlebooks-title-author');
                book.importInfo = normalizeBookImportInfo({
                  ...importInfo,
                  process,
                });
              }
              didUpdate = true;
            }
            const importInfo = normalizeBookImportInfo(book.importInfo);
            if (importInfo && retryMetadata.source) {
              const process = normalizeBookImportProcess(importInfo.process, importInfo.importStatus) || {
                result: importInfo.importStatus,
                lookupAttempted: false,
                lookupFound: false,
                lookupSource: null,
                fallbackUsed: false,
                fallbackSource: null,
                wasDeferred: false,
                deferCount: 0,
              };
              process.fallbackUsed = true;
              process.fallbackSource = String(retryMetadata.source).toLowerCase();
              book.importInfo = normalizeBookImportInfo({
                ...importInfo,
                process,
              });
            }
            if (didUpdate) {
              rowUpdated = true;
            }
          }
          if (rowUpdated) {
            changed = true;
          }
          logImportFallbackDebug('row_retry_completed', {
            title: rowTitle,
            author: rowAuthor,
            attempt: job.attempt,
            success: rowUpdated,
          });
          continue;
        }
        const transientReason = retryResult?.transientReason || null;
        if (transientReason && job.attempt < IMPORT_FALLBACK_DEFERRED_MAX_ATTEMPTS) {
          const nextAttempt = job.attempt + 1;
          const retryDelayMs = Math.max(getFallbackCooldownRemainingMs(), 50);
          if (markBooksDeferred(Array.from(job.affectedBookIds || []))) {
            changed = true;
          }
          deferredFallbackRows.push({
            ...job,
            reason: transientReason,
            attempt: nextAttempt,
            nextEligibleAt: Date.now() + retryDelayMs,
          });
          logImportFallbackDebug('row_retry_scheduled', {
            title: rowTitle,
            author: rowAuthor,
            reason: transientReason,
            nextAttempt,
            waitMs: retryDelayMs,
          });
          continue;
        }
        if (transientReason) {
          logImportFallbackDebug('row_retry_exhausted', {
            title: rowTitle,
            author: rowAuthor,
            reason: transientReason,
            attempt: job.attempt,
          });
        } else {
          logImportFallbackDebug('row_retry_completed', {
            title: rowTitle,
            author: rowAuthor,
            attempt: job.attempt,
            success: false,
          });
        }
      }
      if (deferredFallbackRows.length) {
        for (const job of deferredFallbackRows) {
          logImportFallbackDebug('row_retry_exhausted', {
            title: job.fallbackTarget?.title || '',
            author: job.fallbackTarget?.author || '',
            reason: job.reason || 'import_retry_limit_reached',
            attempt: job.attempt,
          });
        }
      }

      if (changed) {
        appendHistory(db, {
          type: 'books_imported',
          message: `${createdBooks.length} boeken toegevoegd, ${updatedBooks.length} bijgewerkt via Excel-import`,
        });
        saveDb(db);
        scheduleCoverBackfill({ resetFailures: true });
      }

      if (!cancelled && importFinalizeDelayMs > 0) {
        await wait(importFinalizeDelayMs);
      }

      if (!cancelled && isImportCancelRequested()) {
        cancelled = true;
      }

      if (cancelled) {
        updateImportProgress({
          status: 'cancelled',
          currentStage: 'Geannuleerd',
          cancelledAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          processed: processedRows,
          created: createdBooks.length,
          updated: updatedBooks.length,
          skipped: skipped.length,
          deferred: deferredFallbackRows.length,
          summary: {
            created: createdBooks.length,
            updated: updatedBooks.length,
            skipped: skipped.length,
            failed: 0,
          },
        });
        return sendJson(res, 200, {
          cancelled: true,
          created: createdBooks.length,
          updated: updatedBooks.length,
          skipped,
          books: createdBooks.concat(updatedBooks),
          failed: 0,
        });
      }

      const successPayload = {
        created: createdBooks.length,
        updated: updatedBooks.length,
        skipped,
        books: createdBooks.concat(updatedBooks),
      };

      updateImportProgress({
        status: 'completed',
        currentStage: 'Voltooid',
        finishedAt: new Date().toISOString(),
        processed: processedRows,
        created: createdBooks.length,
        updated: updatedBooks.length,
        skipped: skipped.length,
        deferred: deferredFallbackRows.length,
        failed: 0,
        summary: {
          created: createdBooks.length,
          updated: updatedBooks.length,
          skipped: skipped.length,
          failed: 0,
        },
        result: successPayload,
        error: '',
      });

      return sendJson(res, 200, successPayload);
    }

    if (bookIdMatch && req.method === 'DELETE') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen boeken verwijderen' });
      }
      const db = getDb();
      const index = db.books.findIndex((entry) => entry.id === bookIdMatch[1]);
      if (index === -1) {
        return sendJson(res, 404, { message: 'Boek niet gevonden' });
      }
      const target = db.books[index];
      if (target.status === 'borrowed') {
        return sendJson(res, 400, {
          message: 'Lever dit exemplaar eerst in voordat je het verwijdert.',
        });
      }
      const groupId = getBookGroupId(target);
      const [removed] = db.books.splice(index, 1);
      cancelTasksForDeletedBooks(db, [removed.id], { actorId: user.id });
      for (const student of db.students) {
        if (!Array.isArray(student.borrowedBooks)) continue;
        student.borrowedBooks = student.borrowedBooks.filter((item) => item.bookId !== removed.id);
      }
      const remainingCopies = groupId
        ? db.books.filter((entry) => getBookGroupId(entry) === groupId)
        : [];
      appendHistory(db, {
        type: 'book_deleted',
        bookId: removed.id,
        message: `${removed.title} is verwijderd uit de bibliotheek`,
      });
      saveDb(db);
      return sendJson(res, 200, {
        message:
          remainingCopies.length > 0
            ? 'Exemplaar verwijderd. De titel blijft beschikbaar via andere exemplaren.'
            : 'Titel en laatste exemplaar verwijderd.',
        remainingCopies: remainingCopies.length,
        availableCopies: remainingCopies.filter((entry) => entry.status !== 'borrowed').length,
      });
    }

    // PR5: explicit student or class borrower. Existing student self-checkout
    // remains supported. Class loans are staff-only and never create fake
    // student borrowedBooks or erase existing loan history.
    const checkoutMatch = requestUrl.pathname.match(/^\/api\/books\/([\w-]+)\/check-out$/);
    if (checkoutMatch && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { message: 'Log eerst in om boeken te lenen' });
      const body = await parseBody(req);
      const db = loadDb(); // After body upload: do not commit stale inventory.
      const classId = typeof body.classId === 'string' ? body.classId.trim() : '';
      if (body.classId !== undefined && (!classId || body.studentId)) {
        return sendJson(res, 400, { message: 'Kies precies één uitleentype: leerling of klas.' });
      }
      let student = null;
      let klass = null;
      if (classId) {
        if (!ensureRole(user, ['teacher', 'admin'])) {
          return sendJson(res, 403, { message: 'Alleen medewerkers lenen boeken uit aan klassen.' });
        }
        klass = db.classes.find((item) => item.id === classId);
        if (!klass) return sendJson(res, 404, { message: 'Klas niet gevonden.' });
        if (!mayManageClass(db, user, classId)) {
          return sendJson(res, 403, { message: 'Je mag alleen boeken voor jouw eigen klassen lenen.' });
        }
      } else if (user.role === 'student') {
        if (body.studentId && body.studentId !== user.id) {
          return sendJson(res, 403, { message: 'Je kunt alleen voor jezelf lenen.' });
        }
        student = findStudentById(db, user.id);
      } else if (ensureRole(user, ['teacher', 'admin'])) {
        student = findStudentById(db, body.studentId);
        if (student && !mayManageStudent(db, user, student)) {
          return sendJson(res, 403, { message: 'Je kunt alleen boeken aan leerlingen uit jouw klassen lenen.' });
        }
      }
      if (!klass && !student) return sendJson(res, 400, { message: 'Selecteer een bestaande leerling of klas.' });
      if (student && (student.active === false || student.status === 'inactive')) {
        return sendJson(res, 409, { message: 'Deze leerling is niet meer actief.' });
      }
      const dueDate = normalizeDueDate(body.dueDate);
      if (!dueDate.ok) return sendJson(res, 400, { message: 'Ongeldige inleverdatum.' });
      const selection = resolveBookSelection(db, checkoutMatch[1], {
        body, requireAvailable: true, studentId: student?.id || null,
      });
      if (selection.error) return sendJson(res, selection.statusCode || 400, { message: selection.error });
      const { book, group } = selection;
      if (book.status === 'borrowed' || book.borrowedBy || book.borrowedByClassId) {
        return sendJson(res, 409, { message: 'Dit exemplaar is al uitgeleend.' });
      }
      if (student) {
        if (!Array.isArray(student.borrowedBooks)) student.borrowedBooks = [];
        if (student.borrowedBooks.some((entry) => entry.bookId === book.id) || studentHasLoanInGroup(student, group)) {
          return sendJson(res, 400, { message: 'Deze leerling heeft al een exemplaar van deze titel.' });
        }
      }
      const now = new Date().toISOString();
      noteLoanActivity(db, book.id);
      book.status = 'borrowed';
      book.borrowedBy = student?.id || null;
      book.borrowedByClassId = klass?.id || null;
      book.borrowedAt = now;
      book.dueDate = dueDate.value;
      if (student) student.borrowedBooks.push({ bookId: book.id, borrowedAt: now, dueDate: dueDate.value });
      appendHistory(db, student ? {
        type: 'check_out', bookId: book.id, studentId: student.id, performedBy: user.id,
        message: `${student.name} heeft ${book.title} geleend`,
      } : {
        type: 'check_out_class', bookId: book.id, classId: klass.id, performedBy: user.id,
        message: `Voor klas ${klass.name}: ${book.title} uitgeleend`,
      });
      saveDb(db);
      return sendJson(res, 200, {
        // Only the authenticated staff actor who performed this operation
        // may receive a borrower ID. Anonymous/student catalogue GET routes
        // and student self-checkout never expose borrower identity.
        book: ensureRole(user, ['teacher', 'admin'])
          ? { ...sanitizeBookForResponse(book), borrowedBy: student?.id || null,
            borrowedByClassId: klass?.id || null }
          : sanitizeBookForResponse(book),
        borrowerType: klass ? 'class' : 'student',
        ...(ensureRole(user, ['teacher', 'admin']) ? { borrowerId: klass?.id || student?.id } : {}),
      });
    }

    const checkinMatch = requestUrl.pathname.match(/^\/api\/books\/([\w-]+)\/check-in$/);
    if (checkinMatch && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { message: 'Log eerst in om boeken terug te brengen' });
      const body = await parseBody(req);
      const db = loadDb();
      const classId = typeof body.classId === 'string' ? body.classId.trim() : '';
      if (body.classId !== undefined && (!classId || body.studentId)) {
        return sendJson(res, 400, { message: 'Kies precies één uitleentype: leerling of klas.' });
      }
      let student = null;
      let klass = null;
      if (classId) {
        if (!ensureRole(user, ['teacher', 'admin'])) {
          return sendJson(res, 403, { message: 'Alleen medewerkers kunnen klasuitleningen innemen.' });
        }
        klass = db.classes.find((entry) => entry.id === classId);
        if (!klass) return sendJson(res, 404, { message: 'Klas niet gevonden.' });
        if (!mayManageClass(db, user, classId)) {
          return sendJson(res, 403, { message: 'Je kunt alleen uitleningen voor jouw klassen innemen.' });
        }
      } else if (user.role === 'student') {
        if (body.studentId && body.studentId !== user.id) {
          return sendJson(res, 403, { message: 'Je kunt alleen jouw eigen boeken inleveren.' });
        }
        student = findStudentById(db, user.id);
      } else if (ensureRole(user, ['teacher', 'admin'])) {
        student = findStudentById(db, body.studentId);
        if (student && !mayManageStudent(db, user, student)) {
          return sendJson(res, 403, { message: 'Je kunt alleen uitleningen van jouw leerlingen innemen.' });
        }
      }
      if (!klass && !student) return sendJson(res, 400, { message: 'Selecteer een bestaande leerling of klas.' });
      const selection = resolveBookSelection(db, checkinMatch[1], {
        body, mustBeBorrowed: true, studentId: student?.id || null,
        classId: klass?.id || null,
      });
      if (selection.error) return sendJson(res, selection.statusCode || 400, { message: selection.error });
      const { book } = selection;
      if (klass) {
        if (book.borrowedByClassId !== klass.id || book.borrowedBy) {
          return sendJson(res, 409, { message: 'Dit boek is niet aan deze klas uitgeleend.' });
        }
      } else {
        if (book.borrowedBy !== student.id || book.borrowedByClassId ||
          !Array.isArray(student.borrowedBooks) ||
          !student.borrowedBooks.some((entry) => entry.bookId === book.id)) {
          return sendJson(res, 409, { message: 'Dit boek staat niet op de uitleenlijst van deze leerling.' });
        }
      }
      noteLoanActivity(db, book.id);
      book.status = 'available';
      book.borrowedBy = null;
      book.borrowedByClassId = null;
      book.borrowedAt = null;
      book.dueDate = null;
      if (student) student.borrowedBooks = student.borrowedBooks.filter((item) => item.bookId !== book.id);
      appendHistory(db, student ? {
        type: 'check_in', bookId: book.id, studentId: student.id, performedBy: user.id,
        message: `${student.name} heeft ${book.title} teruggebracht`,
      } : {
        type: 'check_in_class', bookId: book.id, classId: klass.id, performedBy: user.id,
        message: `Klas ${klass.name} heeft ${book.title} teruggebracht`,
      });
      saveDb(db);
      return sendJson(res, 200, { book: sanitizeBookForResponse(book) });
    }

    const barcodeMatch = requestUrl.pathname.match(/^\/api\/books\/barcode\/([\w-]+)$/);
    if (barcodeMatch && req.method === 'GET') {
      const db = getDb();
      const normalizedBarcode = normalizeBarcode(barcodeMatch[1]);
      if (!normalizedBarcode) {
        return sendJson(res, 400, { message: 'Ongeldige barcode opgegeven' });
      }
      const grouping = buildBarcodeGroups(db, normalizedBarcode);
      if (!grouping.groups.length) {
        return sendJson(res, 404, { message: 'Geen boek gevonden met deze barcode' });
      }
      return sendJson(res, 200, sanitizeBarcodeGroupsForResponse(grouping));
    }

    const isbnLookupMatch = requestUrl.pathname.match(/^\/api\/isbn\/([\w-]+)$/i);
    if (isbnLookupMatch && req.method === 'GET') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen boekinformatie opzoeken' });
      }
      const isbn = sanitizeIsbn(isbnLookupMatch[1]);
      if (!isbn) {
        return sendJson(res, 400, { message: 'Ongeldige barcode opgegeven' });
      }
      try {
        const lookup = resolveLookupIsbnMetadata();
        const metadata = await lookup(isbn, { includeDebug: true });
        return sendJson(res, 200, metadata);
      } catch (error) {
        console.error('ISBN-lookup mislukt:', error);
        return sendJson(res, 502, { message: 'Kon geen boekinformatie ophalen.' });
      }
    }

    const studentLoansMatch = requestUrl.pathname.match(/^\/api\/students\/([\w-]+)\/loans$/);
    if (studentLoansMatch && req.method === 'GET') {
      const studentId = studentLoansMatch[1];
      if (!studentId) {
        return sendJson(res, 400, { message: 'Leerling-id ontbreekt of is ongeldig' });
      }
      const isStudent = user?.role === 'student';
      const isOwnAccount = isStudent && user.id === studentId;
      const isStaff = ensureRole(user, ['teacher', 'admin']);
      if (!isOwnAccount && !isStaff) {
        const statusCode = user ? 403 : 401;
        const message = isStudent
          ? 'Je kunt alleen je eigen uitleenlog bekijken.'
          : 'Alleen medewerkers kunnen uitleenlogs bekijken';
        return sendJson(res, statusCode, { message });
      }
      const db = getDb();
      const student = findStudentById(db, studentId);
      if (!student) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      if (user.role === 'teacher' && !mayManageStudent(db, user, student)) {
        return sendJson(res, 403, { message: 'Je kunt alleen uitleengegevens van jouw leerlingen bekijken.' });
      }
      const loans = getStudentLoanHistory(db, studentId);
      return sendJson(res, 200, loans);
    }

    const studentStatsMatch = requestUrl.pathname.match(/^\/api\/students\/([\w-]+)\/stats$/);
    if (studentStatsMatch && req.method === 'GET') {
      const studentId = studentStatsMatch[1];
      if (!studentId) {
        return sendJson(res, 400, { message: 'Leerling-id ontbreekt of is ongeldig' });
      }
      const isOwnStats = user?.role === 'student' && user.id === studentId;
      if (!isOwnStats && !ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen leerlingstatistieken bekijken' });
      }
      const db = getDb();
      const student = findStudentById(db, studentId);
      if (user.role === 'teacher' && !mayManageStudent(db, user, student)) {
        return sendJson(res, 403, { message: 'Je kunt alleen statistieken van jouw leerlingen bekijken.' });
      }
      const stats = buildStudentStats(db, studentId);
      if (!stats) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      return sendJson(res, 200, stats);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/students') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen leerlingen bekijken' });
      }
      const db = getDb();
      let studentList = db.students;
      if (user.role === 'teacher') {
        const teacherClassIds = getTeacherClassIds(db, user.id);
        studentList = db.students.filter((student) =>
          (student.classIds || []).some((classId) => teacherClassIds.includes(classId))
        );
      }
      const students = studentList.map((student) => sanitizeStudent(student, { includeUsername: true }));
      return sendJson(res, 200, students);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/teachers') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen docenten bekijken' });
      }
      const db = getDb();
      const teachers = db.users
        .filter((account) => account.role === 'teacher')
        .map((account) => {
          const ownClassIds = Array.isArray(account.classIds) ? account.classIds : [];
          const relatedClassIds = getTeacherClassIds(db, account.id);
          const classIds = Array.from(new Set([...ownClassIds, ...relatedClassIds]));
          return sanitizeTeacher({ ...account, classIds });
        });
      return sendJson(res, 200, teachers);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/teachers') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen docenten toevoegen' });
      }
      const db = getDb();
      const body = await parseBody(req);
      const name = (body.name || '').trim();
      const username = (body.username || '').trim();
      let temporaryPassword = (body.password || body.temporaryPassword || '').trim();
      if (!name || !username) {
        return sendJson(res, 400, { message: 'Naam en gebruikersnaam zijn verplicht' });
      }
      if (isUsernameTaken(db, username)) {
        return sendJson(res, 409, { message: 'Deze gebruikersnaam is al in gebruik' });
      }
      const requestedClassIds = Array.isArray(body.classIds) ? body.classIds : [];
      const validClassIds = requestedClassIds
        .map((classId) => String(classId || '').trim())
        .filter((classId) => classId && db.classes.some((klass) => klass.id === classId));
      if (!temporaryPassword) {
        temporaryPassword = generatePassword(10);
      }
      const teacher = {
        id: crypto.randomUUID(),
        role: 'teacher',
        name,
        username,
        passwordHash: hashPassword(temporaryPassword),
        mustChangePassword: true,
        classIds: Array.from(new Set(validClassIds)),
      };
      db.users.push(teacher);
      for (const classId of teacher.classIds) {
        const klass = db.classes.find((entry) => entry.id === classId);
        if (!klass) continue;
        klass.teacherIds = Array.isArray(klass.teacherIds) ? klass.teacherIds : [];
        if (!klass.teacherIds.includes(teacher.id)) {
          klass.teacherIds.push(teacher.id);
        }
      }
      appendHistory(db, {
        type: 'teacher_created',
        teacherId: teacher.id,
        performedBy: user?.id || null,
        message: `Nieuw docentaccount aangemaakt voor ${teacher.name}`,
      });
      saveDb(db);
      return sendJson(res, 201, {
        teacher: sanitizeTeacher(teacher),
        temporaryPassword,
      });
    }

    const teacherMatch = requestUrl.pathname.match(/^\/api\/teachers\/([\w-]+)$/);
    if (teacherMatch && req.method === 'PATCH') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen docenten bijwerken' });
      }
      const db = getDb();
      const teacher = db.users.find((account) => account.id === teacherMatch[1]);
      if (!teacher || teacher.role !== 'teacher') {
        return sendJson(res, 404, { message: 'Docent niet gevonden' });
      }
      const body = await parseBody(req);
      let changed = false;
      let passwordChanged = false;
      let providedPassword = '';
      if (typeof body.name === 'string') {
        const trimmed = body.name.trim();
        if (trimmed) {
          teacher.name = trimmed;
          changed = true;
        }
      }
      if (typeof body.username === 'string') {
        const trimmed = body.username.trim();
        if (trimmed && trimmed !== teacher.username) {
          if (isUsernameTaken(db, trimmed, { allowUserId: teacher.id })) {
            return sendJson(res, 409, { message: 'Deze gebruikersnaam is al in gebruik' });
          }
          teacher.username = trimmed;
          changed = true;
        }
      }
      if (Array.isArray(body.classIds)) {
        const requestedClassIds = body.classIds
          .map((classId) => String(classId || '').trim())
          .filter(Boolean);
        const validClassIds = requestedClassIds.filter((classId) =>
          db.classes.some((klass) => klass.id === classId)
        );
        const previousClassIds = Array.isArray(teacher.classIds)
          ? [...teacher.classIds]
          : getTeacherClassIds(db, teacher.id);
        const newClassIds = Array.from(new Set(validClassIds));
        const previousSet = new Set(previousClassIds);
        const newSet = new Set(newClassIds);
        const removedIds = previousClassIds.filter((id) => !newSet.has(id));
        const addedIds = newClassIds.filter((id) => !previousSet.has(id));
        if (removedIds.length || addedIds.length || previousClassIds.length !== newClassIds.length) {
          changed = true;
        }
        teacher.classIds = newClassIds;
        for (const classId of removedIds) {
          const klass = db.classes.find((entry) => entry.id === classId);
          if (!klass) continue;
          klass.teacherIds = Array.isArray(klass.teacherIds) ? klass.teacherIds : [];
          klass.teacherIds = klass.teacherIds.filter((id) => id !== teacher.id);
        }
        for (const classId of newClassIds) {
          const klass = db.classes.find((entry) => entry.id === classId);
          if (!klass) continue;
          klass.teacherIds = Array.isArray(klass.teacherIds) ? klass.teacherIds : [];
          if (!klass.teacherIds.includes(teacher.id)) {
            klass.teacherIds.push(teacher.id);
          }
        }
        if (removedIds.length || addedIds.length) {
          appendHistory(db, {
            type: 'teacher_classes_updated',
            teacherId: teacher.id,
            performedBy: user?.id || null,
            message: `Klassen bijgewerkt voor docent ${teacher.name}`,
          });
        }
      }
      if (typeof body.temporaryPassword === 'string' && body.temporaryPassword.trim()) {
        providedPassword = body.temporaryPassword.trim();
        teacher.passwordHash = hashPassword(providedPassword);
        teacher.mustChangePassword = true;
        passwordChanged = true;
        changed = true;
        for (const [token, session] of sessions.entries()) {
          if (session.type === 'staff' && session.userId === teacher.id) {
            sessions.delete(token);
          }
        }
        appendHistory(db, {
          type: 'teacher_password_set',
          teacherId: teacher.id,
          performedBy: user?.id || null,
          message: `Handmatig wachtwoord ingesteld voor docent ${teacher.name}`,
        });
      }
      if (!changed) {
        return sendJson(res, 200, { teacher: sanitizeTeacher(teacher) });
      }
      saveDb(db);
      const response = { teacher: sanitizeTeacher(teacher) };
      if (passwordChanged && providedPassword) {
        response.temporaryPassword = providedPassword;
      }
      return sendJson(res, 200, response);
    }

    if (teacherMatch && req.method === 'DELETE') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen docenten verwijderen' });
      }
      const db = getDb();
      const index = db.users.findIndex(
        (account) => account.id === teacherMatch[1] && account.role === 'teacher'
      );
      if (index === -1) {
        return sendJson(res, 404, { message: 'Docent niet gevonden' });
      }
      const [removedTeacher] = db.users.splice(index, 1);
      for (const klass of db.classes) {
        if (!Array.isArray(klass.teacherIds)) {
          continue;
        }
        klass.teacherIds = klass.teacherIds.filter((id) => id !== removedTeacher.id);
      }
      for (const [token, session] of sessions.entries()) {
        if (session.type === 'staff' && session.userId === removedTeacher.id) {
          sessions.delete(token);
        }
      }
      appendHistory(db, {
        type: 'teacher_deleted',
        teacherId: removedTeacher.id,
        performedBy: user?.id || null,
        message: `Docent ${removedTeacher.name} is verwijderd`,
      });
      saveDb(db);
      return sendJson(res, 200, { teacher: sanitizeTeacher(removedTeacher) });
    }

    const teacherResetMatch = requestUrl.pathname.match(/^\/api\/teachers\/([\w-]+)\/reset-password$/);
    if (teacherResetMatch && req.method === 'POST') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen wachtwoorden resetten' });
      }
      const db = getDb();
      const teacher = db.users.find((account) => account.id === teacherResetMatch[1]);
      if (!teacher || teacher.role !== 'teacher') {
        return sendJson(res, 404, { message: 'Docent niet gevonden' });
      }
      const temporaryPassword = generatePassword(10);
      teacher.passwordHash = hashPassword(temporaryPassword);
      teacher.mustChangePassword = true;
      for (const [token, session] of sessions.entries()) {
        if (session.type === 'staff' && session.userId === teacher.id) {
          sessions.delete(token);
        }
      }
      appendHistory(db, {
        type: 'teacher_password_reset',
        teacherId: teacher.id,
        performedBy: user?.id || null,
        message: `Wachtwoord opnieuw ingesteld voor docent ${teacher.name}`,
      });
      saveDb(db);
      return sendJson(res, 200, {
        teacher: { id: teacher.id, name: teacher.name, username: teacher.username },
        temporaryPassword,
      });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/students') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen leerlingaccounts aanmaken' });
      }
      const db = getDb();
      const body = await parseBody(req);
      const name = (body.name || '').trim();
      const username = (body.username || '').trim();
      const password = body.password || '';
      if (!name || !username || !password) {
        return sendJson(res, 400, {
          message: 'Naam, gebruikersnaam en wachtwoord zijn verplicht',
        });
      }
      if (isUsernameTaken(db, username)) {
        return sendJson(res, 409, { message: 'Deze gebruikersnaam is al in gebruik' });
      }
      const requestedClassIds = Array.isArray(body.classIds)
        ? body.classIds.filter((value) => typeof value === 'string')
        : [];
      const validClassIds = requestedClassIds.filter((classId) =>
        db.classes.some((klass) => klass.id === classId)
      );

      const student = {
        id: crypto.randomUUID(),
        name,
        username,
        passwordHash: hashPassword(password),
        mustChangePassword: true,
        grade: (body.grade || '').trim(),
        borrowedBooks: [],
        classIds: validClassIds,
      };
      db.students.push(student);
      for (const classId of validClassIds) {
        const klass = db.classes.find((entry) => entry.id === classId);
        if (!klass) continue;
        klass.studentIds = Array.isArray(klass.studentIds) ? klass.studentIds : [];
        if (!klass.studentIds.includes(student.id)) {
          klass.studentIds.push(student.id);
        }
      }
      appendHistory(db, {
        type: 'student_created',
        studentId: student.id,
        message: `Nieuw leerlingaccount aangemaakt voor ${student.name}`,
      });
      saveDb(db);
      return sendJson(res, 201, {
        ...sanitizeStudent(student, { includeUsername: true }),
        temporaryPassword: password,
      });
    }

    const studentResetMatch = requestUrl.pathname.match(/^\/api\/students\/([\w-]+)\/reset-password$/);
    if (studentResetMatch && req.method === 'POST') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen wachtwoorden resetten' });
      }
      const db = getDb();
      const student = findStudentById(db, studentResetMatch[1]);
      if (!student) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      if (user.role === 'teacher') {
        const teacherClassIds = getTeacherClassIds(db, user.id);
        const allowed = (student.classIds || []).some((classId) => teacherClassIds.includes(classId));
        if (!allowed) {
          return sendJson(res, 403, {
            message: 'Je kunt alleen wachtwoorden resetten voor leerlingen uit jouw klassen',
          });
        }
      }
      const temporaryPassword = generatePassword(10);
      student.passwordHash = hashPassword(temporaryPassword);
      student.mustChangePassword = true;
      for (const [token, session] of sessions.entries()) {
        if (session.type === 'student' && session.userId === student.id) {
          sessions.delete(token);
        }
      }
      appendHistory(db, {
        type: 'student_password_reset',
        studentId: student.id,
        performedBy: user?.id || null,
        message: `Wachtwoord opnieuw ingesteld voor ${student.name}`,
      });
      saveDb(db);
      return sendJson(res, 200, {
        student: sanitizeStudent(student, { includeUsername: true }),
        temporaryPassword,
      });
    }

    const studentUpdateMatch = requestUrl.pathname.match(/^\/api\/students\/([\w-]+)$/);
    if (studentUpdateMatch && req.method === 'PATCH') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen leerlingaccounts bijwerken' });
      }
      const db = getDb();
      const student = findStudentById(db, studentUpdateMatch[1]);
      if (!student) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      const body = await parseBody(req);
      let temporaryPassword = null;
      let passwordChanged = false;
      let classesChanged = false;
      const previousClassIds = Array.isArray(student.classIds) ? [...student.classIds] : [];
      let nextClassIds = new Set(previousClassIds);

      if (body && typeof body.generateTemporaryPassword === 'boolean' && body.generateTemporaryPassword) {
        temporaryPassword = generatePassword(10);
      } else if (typeof body?.temporaryPassword === 'string') {
        const trimmed = body.temporaryPassword.trim();
        if (!trimmed) {
          return sendJson(res, 400, { message: 'Tijdelijk wachtwoord mag niet leeg zijn' });
        }
        temporaryPassword = trimmed;
      }

      if (Array.isArray(body?.classIds)) {
        nextClassIds = new Set(
          body.classIds
            .map((value) => String(value || '').trim())
            .filter((value) => value && db.classes.some((klass) => klass.id === value))
        );
      } else {
        const addClassId = typeof body?.addClassId === 'string' ? body.addClassId : body?.addClassId?.id;
        if (addClassId) {
          const normalizedAdd = String(addClassId).trim();
          if (normalizedAdd && db.classes.some((klass) => klass.id === normalizedAdd)) {
            nextClassIds.add(normalizedAdd);
          }
        }
        const removeClassId = typeof body?.removeClassId === 'string' ? body.removeClassId : body?.removeClassId?.id;
        if (removeClassId) {
          const normalizedRemove = String(removeClassId).trim();
          if (normalizedRemove) {
            nextClassIds.delete(normalizedRemove);
          }
        }
      }

      const validClassIds = Array.from(nextClassIds).filter((classId) =>
        db.classes.some((klass) => klass.id === classId)
      );
      const uniqueClassIds = Array.from(new Set(validClassIds));
      const addedClassIds = uniqueClassIds.filter((id) => !previousClassIds.includes(id));
      const removedClassIds = previousClassIds.filter((id) => !uniqueClassIds.includes(id));

      if (temporaryPassword) {
        student.passwordHash = hashPassword(temporaryPassword);
        student.mustChangePassword = true;
        passwordChanged = true;
        for (const [token, session] of sessions.entries()) {
          if (session.type === 'student' && session.userId === student.id) {
            sessions.delete(token);
          }
        }
      }

      if (addedClassIds.length || removedClassIds.length) {
        student.classIds = uniqueClassIds;
        for (const classId of removedClassIds) {
          const klass = db.classes.find((entry) => entry.id === classId);
          if (klass) {
            klass.studentIds = (klass.studentIds || []).filter((id) => id !== student.id);
          }
        }
        for (const classId of addedClassIds) {
          const klass = db.classes.find((entry) => entry.id === classId);
          if (klass) {
            klass.studentIds = Array.isArray(klass.studentIds) ? klass.studentIds : [];
            if (!klass.studentIds.includes(student.id)) {
              klass.studentIds.push(student.id);
            }
          }
        }
        classesChanged = true;
      }

      if (!passwordChanged && !classesChanged) {
        return sendJson(res, 400, { message: 'Geen geldige wijzigingen opgegeven' });
      }

      if (passwordChanged) {
        appendHistory(db, {
          type: 'student_password_reset',
          studentId: student.id,
          performedBy: user?.id || null,
          message: `Tijdelijk wachtwoord ingesteld voor ${student.name}`,
        });
      }

      if (classesChanged) {
        const addedNames = addedClassIds
          .map((classId) => db.classes.find((klass) => klass.id === classId)?.name)
          .filter(Boolean);
        const removedNames = removedClassIds
          .map((classId) => db.classes.find((klass) => klass.id === classId)?.name)
          .filter(Boolean);
        const classMessages = [];
        if (addedNames.length) {
          classMessages.push(`toegevoegd aan ${addedNames.join(', ')}`);
        }
        if (removedNames.length) {
          classMessages.push(`verwijderd uit ${removedNames.join(', ')}`);
        }
        const messageSuffix = classMessages.length ? ` ${classMessages.join(' en ')}` : '';
        appendHistory(db, {
          type: 'student_class_updated',
          studentId: student.id,
          performedBy: user?.id || null,
          message: `${student.name}${messageSuffix}`.trim(),
        });
      }

      saveDb(db);
      return sendJson(res, 200, {
        student: sanitizeStudent(student, { includeUsername: true }),
        ...(temporaryPassword ? { temporaryPassword } : {}),
        classChanges: classesChanged
          ? {
              added: addedClassIds,
              removed: removedClassIds,
            }
          : undefined,
      });
    }

    const studentDeleteMatch = requestUrl.pathname.match(/^\/api\/students\/([\w-]+)$/);
    if (studentDeleteMatch && req.method === 'DELETE') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen leerlingaccounts verwijderen' });
      }
      const db = getDb();
      const student = findStudentById(db, studentDeleteMatch[1]);
      if (!student) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      db.students = db.students.filter((entry) => entry.id !== student.id);
      for (const klass of db.classes) {
        klass.studentIds = (klass.studentIds || []).filter((id) => id !== student.id);
      }
      for (const book of db.books) {
        if (book.borrowedBy === student.id) {
          noteLoanActivity(db, book.id);
          book.borrowedBy = null;
          book.status = 'available';
          book.dueDate = null;
        }
      }
      for (const [token, session] of sessions.entries()) {
        if (session.type === 'student' && session.userId === student.id) {
          sessions.delete(token);
        }
      }
      appendHistory(db, {
        type: 'student_deleted',
        studentId: student.id,
        message: `Leerlingaccount van ${student.name} is verwijderd`,
      });
      saveDb(db);
      return sendJson(res, 200, { message: 'Leerlingaccount verwijderd' });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/students/import') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen lijsten importeren' });
      }
      const XLSX = loadXlsx();
      if (!XLSX) {
        return sendJson(res, 503, {
          message:
            'Excel-import is momenteel niet beschikbaar omdat de "xlsx" module ontbreekt op de server',
        });
      }
      const db = getDb();
      const body = await parseBody(req);
      if (!body.file) {
        return sendJson(res, 400, { message: 'Geen bestand ontvangen' });
      }

      const workbookResult = readWorkbookRows(XLSX, body.file);
      if (!workbookResult.ok) {
        return sendJson(res, 400, { message: workbookResult.error });
      }

      const createdAccounts = [];
      const updatedAccounts = [];
      const skipped = [];
      let changed = false;

      for (const row of workbookResult.rows) {
        const normalized = normalizeRowKeys(row);
        const importedName = extractImportedName(normalized);
        const name = importedName.fullName;
        const username = String(
          normalized.gebruikersnaam || normalized.username || ''
        ).trim();
        let password = String(normalized.wachtwoord || normalized.password || '').trim();
        const gradeSource = String(
          normalized.leerjaar ||
            normalized.grade ||
            normalized.graad ||
            normalized.year ||
            normalized.niveau ||
            normalized.opleiding ||
            ''
        ).trim();
        const classNames = [
          normalized.klassen,
          normalized['klas(sen)'],
          normalized.klas,
          normalized.klasnaam,
          normalized.groep,
          normalized.groepen,
          normalized.class,
          normalized.classes,
        ]
          .flatMap(parseMultiValueField)
          .map((value) => value.trim())
          .filter(Boolean);
        const uniqueClassNames = Array.from(new Set(classNames));

        if (!name || !username) {
          skipped.push({
            name: name || '(onbekend)',
            username: username || '(leeg)',
            reason: 'Ontbrekende naam of gebruikersnaam',
          });
          continue;
        }

        if (!uniqueClassNames.length) {
          skipped.push({
            name,
            username,
            reason: 'Geen klas opgegeven',
          });
          continue;
        }

        const classRecords = uniqueClassNames
          .map((className) => ensureClassRecord(db, className))
          .filter(Boolean);
        const classIds = classRecords.map((klass) => klass.id);

        let grade = gradeSource;
        if (!grade && classRecords.length) {
          grade = classRecords[0].name;
        }

        const existingStudent = findStudentByUsername(db, username);
        if (existingStudent) {
          const originalName = existingStudent.name;
          const originalGrade = existingStudent.grade || '';
          const originalClassIds = Array.isArray(existingStudent.classIds)
            ? [...existingStudent.classIds]
            : [];
          existingStudent.name = name;
          existingStudent.firstName = importedName.firstName;
          existingStudent.middleName = importedName.middleName;
          existingStudent.lastName = importedName.lastName;
          if (grade) {
            existingStudent.grade = grade;
          }
          if (!Array.isArray(existingStudent.borrowedBooks)) {
            existingStudent.borrowedBooks = [];
          }
          if (!Array.isArray(existingStudent.classIds)) {
            existingStudent.classIds = [];
          }
          let passwordChanged = false;
          if (password) {
            existingStudent.passwordHash = hashPassword(password);
            existingStudent.mustChangePassword = true;
            passwordChanged = true;
          }

          const newClassIdSet = new Set(classIds);
          const removedClassIds = originalClassIds.filter((classId) => !newClassIdSet.has(classId));
          const addedClassIds = classIds.filter((classId) => !originalClassIds.includes(classId));

          existingStudent.classIds = classIds;

          for (const classId of removedClassIds) {
            const klass = db.classes.find((entry) => entry.id === classId);
            if (klass) {
              klass.studentIds = (klass.studentIds || []).filter((id) => id !== existingStudent.id);
            }
          }
          for (const klass of classRecords) {
            if (!klass.studentIds.includes(existingStudent.id)) {
              klass.studentIds.push(existingStudent.id);
            }
          }

          const teacherNames = collectTeacherNames(db, classRecords);
          updatedAccounts.push({
            id: existingStudent.id,
            name: existingStudent.name,
            firstName: getPreferredFirstName(existingStudent),
            username: existingStudent.username,
            password: passwordChanged ? password : null,
            classes: classRecords.map((klass) => klass.name),
            teachers: teacherNames,
            grade: existingStudent.grade || '',
            status: 'updated',
          });

          if (
            passwordChanged ||
            originalName !== existingStudent.name ||
            originalGrade !== (existingStudent.grade || '') ||
            removedClassIds.length ||
            addedClassIds.length
          ) {
            changed = true;
          }
          continue;
        }

        if (isUsernameTaken(db, username)) {
          skipped.push({
            name,
            username,
            reason: 'Gebruikersnaam is al in gebruik',
          });
          continue;
        }

        if (!password) {
          password = generatePassword(10);
        }

        const student = {
          id: crypto.randomUUID(),
          name,
          firstName: importedName.firstName,
          middleName: importedName.middleName,
          lastName: importedName.lastName,
          username,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          grade,
          borrowedBooks: [],
          classIds,
        };
        db.students.push(student);
        for (const klass of classRecords) {
          if (!klass.studentIds.includes(student.id)) {
            klass.studentIds.push(student.id);
          }
        }
        const teacherNames = collectTeacherNames(db, classRecords);
        createdAccounts.push({
          id: student.id,
          name: student.name,
          firstName: getPreferredFirstName(student),
          username: student.username,
          password,
          classes: classRecords.map((klass) => klass.name),
          teachers: teacherNames,
          grade: student.grade || '',
          status: 'created',
        });
        changed = true;
      }

      if (changed) {
        appendHistory(db, {
          type: 'students_imported',
          message: `${createdAccounts.length} leerlingen toegevoegd, ${updatedAccounts.length} bijgewerkt via Excel-import`,
        });
        saveDb(db);
      }

      return sendJson(res, 200, {
        created: createdAccounts.length,
        updated: updatedAccounts.length,
        skipped,
        accounts: createdAccounts.concat(updatedAccounts),
      });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/teachers/import') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen lijsten importeren' });
      }
      const XLSX = loadXlsx();
      if (!XLSX) {
        return sendJson(res, 503, {
          message:
            'Excel-import is momenteel niet beschikbaar omdat de "xlsx" module ontbreekt op de server',
        });
      }
      const db = getDb();
      const body = await parseBody(req);
      if (!body.file) {
        return sendJson(res, 400, { message: 'Geen bestand ontvangen' });
      }

      const workbookResult = readWorkbookRows(XLSX, body.file);
      if (!workbookResult.ok) {
        return sendJson(res, 400, { message: workbookResult.error });
      }

      const createdAccounts = [];
      const updatedAccounts = [];
      const skipped = [];
      let changed = false;

      for (const row of workbookResult.rows) {
        const normalized = normalizeRowKeys(row);
        const importedName = extractImportedName(normalized);
        const name = importedName.fullName;
        const username = String(
          normalized.gebruikersnaam || normalized.username || ''
        ).trim();
        let password = String(normalized.wachtwoord || normalized.password || '').trim();
        const classNames = [
          normalized.klassen,
          normalized['klas(sen)'],
          normalized.klas,
          normalized.klasnaam,
          normalized.groep,
          normalized.groepen,
          normalized.class,
          normalized.classes,
        ]
          .flatMap(parseMultiValueField)
          .map((value) => value.trim())
          .filter(Boolean);
        const uniqueClassNames = Array.from(new Set(classNames));

        if (!name || !username) {
          skipped.push({
            name: name || '(onbekend)',
            username: username || '(leeg)',
            reason: 'Ontbrekende naam of gebruikersnaam',
          });
          continue;
        }

        if (!uniqueClassNames.length) {
          skipped.push({
            name,
            username,
            reason: 'Geen klas opgegeven',
          });
          continue;
        }

        const classRecords = uniqueClassNames
          .map((className) => ensureClassRecord(db, className))
          .filter(Boolean);
        const classIds = classRecords.map((klass) => klass.id);

        const normalizedUsername = username.toLowerCase();
        const existingTeacher = db.users.find(
          (account) => (account.username || '').toLowerCase() === normalizedUsername
        );
        const usernameTakenByStudent = db.students.some(
          (student) => (student.username || '').toLowerCase() === normalizedUsername
        );

        if (!existingTeacher && usernameTakenByStudent) {
          skipped.push({
            name,
            username,
            reason: 'Gebruikersnaam is al in gebruik door een leerling',
          });
          continue;
        }

        if (existingTeacher && existingTeacher.role !== 'teacher') {
          skipped.push({
            name,
            username,
            reason: 'Gebruikersnaam is al gekoppeld aan een medewerker',
          });
          continue;
        }

        if (existingTeacher) {
          const originalName = existingTeacher.name;
          const originalClassIds = Array.isArray(existingTeacher.classIds)
            ? [...existingTeacher.classIds]
            : [];
          let passwordChanged = false;
          if (password) {
            existingTeacher.passwordHash = hashPassword(password);
            existingTeacher.mustChangePassword = true;
            passwordChanged = true;
          }
          existingTeacher.name = name;
          existingTeacher.firstName = importedName.firstName;
          existingTeacher.middleName = importedName.middleName;
          existingTeacher.lastName = importedName.lastName;
          existingTeacher.username = username;
          existingTeacher.role = 'teacher';
          existingTeacher.classIds = classIds;

          const newClassIdSet = new Set(classIds);
          const removedClassIds = originalClassIds.filter((classId) => !newClassIdSet.has(classId));
          const addedClassIds = classIds.filter((classId) => !originalClassIds.includes(classId));

          for (const classId of removedClassIds) {
            const klass = db.classes.find((entry) => entry.id === classId);
            if (klass) {
              klass.teacherIds = (klass.teacherIds || []).filter((id) => id !== existingTeacher.id);
            }
          }

          for (const klass of classRecords) {
            if (!klass.teacherIds.includes(existingTeacher.id)) {
              klass.teacherIds.push(existingTeacher.id);
            }
          }

          updatedAccounts.push({
            id: existingTeacher.id,
            name: existingTeacher.name,
            username: existingTeacher.username,
            password: passwordChanged ? password : null,
            classes: classRecords.map((klass) => klass.name),
            status: 'updated',
          });

          if (passwordChanged || originalName !== existingTeacher.name || removedClassIds.length || addedClassIds.length) {
            changed = true;
          }
          continue;
        }

        if (!password) {
          password = generatePassword(10);
        }

        const teacher = {
          id: crypto.randomUUID(),
          role: 'teacher',
          name,
          firstName: importedName.firstName,
          middleName: importedName.middleName,
          lastName: importedName.lastName,
          username,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          classIds,
        };
        db.users.push(teacher);
        for (const klass of classRecords) {
          if (!klass.teacherIds.includes(teacher.id)) {
            klass.teacherIds.push(teacher.id);
          }
        }

        createdAccounts.push({
          id: teacher.id,
          name: teacher.name,
          username: teacher.username,
          password,
          classes: classRecords.map((klass) => klass.name),
          status: 'created',
        });
        changed = true;
      }

      if (changed) {
        appendHistory(db, {
          type: 'teachers_imported',
          message: `${createdAccounts.length} docenten toegevoegd, ${updatedAccounts.length} bijgewerkt via Excel-import`,
        });
        saveDb(db);
      }

      return sendJson(res, 200, {
        created: createdAccounts.length,
        updated: updatedAccounts.length,
        skipped,
        accounts: createdAccounts.concat(updatedAccounts),
      });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/activity/public') {
      const db = getDb();
      const limit = Number(requestUrl.searchParams.get('limit')) || 12;
      const activity = getPublicLoanActivity(db, { limit });
      return sendJson(res, 200, activity);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/history/clear') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen het logboek wissen' });
      }
      const db = getDb();
      const clearedCount = Array.isArray(db.history) ? db.history.length : 0;
      db.history = [];
      saveDb(db);
      return sendJson(res, 200, { clearedCount });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/history') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen de activiteit bekijken' });
      }
      const db = getDb();
      const limit = Number(requestUrl.searchParams.get('limit')) || 20;

      let historyEntries = Array.isArray(db.history) ? db.history : [];

      if (user.role === 'teacher') {
        // Current class ownership is authoritative. A stale login account's
        // classIds can outlive a teacher's removal from a class, so it must
        // NEVER grant access to its student or class loan history.
        const teacherClassIds = new Set(getTeacherClassIds(db, user.id));
        const classesForTeacher = (Array.isArray(db.classes) ? db.classes : [])
          .filter((klass) => klass && teacherClassIds.has(klass.id));

        const studentIds = new Set();
        for (const klass of classesForTeacher) {
          const studentsInClass = Array.isArray(klass.studentIds) ? klass.studentIds : [];
          for (const studentId of studentsInClass) {
            if (studentId) {
              studentIds.add(studentId);
            }
          }
        }

        for (const student of Array.isArray(db.students) ? db.students : []) {
          if (!student || !Array.isArray(student.classIds)) {
            continue;
          }
          const belongsToTeacher = student.classIds.some((classId) => teacherClassIds.has(classId));
          if (belongsToTeacher && student.id) {
            studentIds.add(student.id);
          }
        }

        historyEntries = historyEntries.filter(
          (entry) => entry && (
            (typeof entry.studentId === 'string' && studentIds.has(entry.studentId))
            || (typeof entry.classId === 'string' && teacherClassIds.has(entry.classId))
          )
        );
      }

      const sortedHistory = historyEntries
        .filter((entry) => entry && typeof entry.timestamp === 'string')
        .slice()
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      if (Number.isFinite(limit) && limit > 0) {
        return sendJson(res, 200, sortedHistory.slice(0, limit));
      }
      return sendJson(res, 200, sortedHistory);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/stats/school') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen schoolstatistieken bekijken' });
      }
      const db = getDb();
      const stats = buildSchoolStats(db);
      return sendJson(res, 200, stats);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/classes') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen klassen bekijken' });
      }
      const db = getDb();
      let classes = db.classes || [];
      if (user.role === 'teacher') {
        classes = classes.filter((cls) => (cls.teacherIds || []).includes(user.id));
      }
      return sendJson(res, 200, classes);
    }

    const classStatsMatch = requestUrl.pathname.match(/^\/api\/classes\/([\w-]+)\/stats$/);
    if (classStatsMatch && req.method === 'GET') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen klassen bekijken' });
      }
      const db = getDb();
      const klass = db.classes.find((cls) => cls.id === classStatsMatch[1]);
      if (!klass) {
        return sendJson(res, 404, { message: 'Klas niet gevonden' });
      }
      if (user.role === 'teacher' && !(klass.teacherIds || []).includes(user.id)) {
        return sendJson(res, 403, { message: 'Je mag alleen je eigen klassen bekijken' });
      }

      const studentIdsInClass = new Set([
        ...(Array.isArray(klass.studentIds) ? klass.studentIds : []),
        ...db.students
          .filter((student) => Array.isArray(student.classIds) && student.classIds.includes(klass.id))
          .map((student) => student.id),
      ].filter(Boolean));

      const classHistory = (Array.isArray(db.history) ? db.history : []).filter(
        (entry) => entry && entry.type === 'check_out' && studentIdsInClass.has(entry.studentId)
      );
      // A class checkout has no student borrower. Keep it separate from
      // reader rankings, and include it in the class-level aggregate.
      const classCheckoutHistory = (Array.isArray(db.history) ? db.history : []).filter(
        (entry) => entry && entry.type === 'check_out_class' && entry.classId === klass.id
      );
      const borrowCountPerStudent = new Map();
      for (const entry of classHistory) {
        const current = borrowCountPerStudent.get(entry.studentId) || 0;
        borrowCountPerStudent.set(entry.studentId, current + 1);
      }

      const activeLoanCount = db.books.filter(
        (book) => book.status === 'borrowed'
          && (studentIdsInClass.has(book.borrowedBy) || book.borrowedByClassId === klass.id)
      ).length;

      for (const student of db.students) {
        if (!studentIdsInClass.has(student.id)) {
          continue;
        }
        if (Array.isArray(student.borrowedBooks) && student.borrowedBooks.length > 0) {
          const current = borrowCountPerStudent.get(student.id) || 0;
          borrowCountPerStudent.set(student.id, current);
        }
      }

      const now = new Date();
      const schoolYearStart = (() => {
        const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
        return new Date(year, 7, 1);
      })();
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const combinedClassHistory = [...classHistory, ...classCheckoutHistory];
      const classHistoryThisSchoolYear = classHistory.filter((entry) => {
        const date = new Date(entry.timestamp);
        return !Number.isNaN(date.getTime()) && date >= schoolYearStart;
      });

      const classHistoryLastMonth = classHistory.filter((entry) => {
        const date = new Date(entry.timestamp);
        return !Number.isNaN(date.getTime()) && date >= monthAgo;
      });

      // Class-level totals include both student and direct class checkouts.
      // Reader rankings and non-reader stats continue using student loans only.
      const combinedThisSchoolYear = combinedClassHistory.filter((entry) => {
        const date = new Date(entry.timestamp);
        return !Number.isNaN(date.getTime()) && date >= schoolYearStart;
      });
      const combinedLastMonth = combinedClassHistory.filter((entry) => {
        const date = new Date(entry.timestamp);
        return !Number.isNaN(date.getTime()) && date >= monthAgo;
      });
      const borrowCountThisSchoolYear = new Map();
      for (const entry of classHistoryThisSchoolYear) {
        borrowCountThisSchoolYear.set(
          entry.studentId,
          (borrowCountThisSchoolYear.get(entry.studentId) || 0) + 1
        );
      }

      const studentsInClass = db.students.filter((student) => studentIdsInClass.has(student.id));

      const activeReaders = Array.from(borrowCountPerStudent.keys()).filter((studentId) => {
        const student = db.students.find((entry) => entry.id === studentId);
        return (
          (borrowCountPerStudent.get(studentId) || 0) > 0 ||
          (student && Array.isArray(student.borrowedBooks) && student.borrowedBooks.length > 0)
        );
      }).length;

      const topReaders = Array.from(borrowCountPerStudent.entries())
        .map(([studentId, count]) => {
          const student = db.students.find((entry) => entry.id === studentId);
          return {
            id: studentId,
            name: student ? student.name : 'Onbekende leerling',
            borrowCount: count,
            totalBorrowed: count,
            borrowedCount: count,
          };
        })
        .sort((a, b) => b.borrowCount - a.borrowCount || a.name.localeCompare(b.name))
        .slice(0, 3);

      const nonReaders = studentsInClass
        .filter((student) => {
          const borrowCount = borrowCountThisSchoolYear.get(student.id) || 0;
          const activeLoansForStudent = Array.isArray(student.borrowedBooks)
            ? student.borrowedBooks.length
            : 0;
          return borrowCount === 0 && activeLoansForStudent === 0;
        })
        .map((student) => ({ id: student.id, name: student.name || 'Onbekende leerling' }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const heavyReaders = Array.from(borrowCountThisSchoolYear.entries())
        .map(([studentId, count]) => {
          const student = db.students.find((entry) => entry.id === studentId);
          return {
            id: studentId,
            name: student ? student.name : 'Onbekende leerling',
            borrowCount: count,
          };
        })
        .sort((a, b) => b.borrowCount - a.borrowCount || a.name.localeCompare(b.name))
        .slice(0, 5);

      const genreCounts = new Map();
      const titleCounts = new Map();
      for (const entry of combinedThisSchoolYear) {
        const book = findBookById(db, entry.bookId);
        if (book) {
          if (Array.isArray(book.tags)) {
            for (const tag of book.tags) {
              const normalizedTag = typeof tag === 'string' ? tag.trim() : String(tag ?? '').trim();
              if (!normalizedTag) continue;
              genreCounts.set(normalizedTag, (genreCounts.get(normalizedTag) || 0) + 1);
            }
          }
          const key = book.title || 'Onbekende titel';
          titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
        }
      }

      const topGenres = Array.from(genreCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 5);

      const topTitles = Array.from(titleCounts.entries())
        .map(([title, count]) => ({ title, count }))
        .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
        .slice(0, 5);

      const stats = {
        totalBorrowedBooks: combinedClassHistory.length,
        totalBorrowed: combinedClassHistory.length,
        borrowCount: combinedClassHistory.length,
        borrowedCount: combinedClassHistory.length,
        activeLoans: activeLoanCount,
        currentLoans: activeLoanCount,
        activeLoanCount: activeLoanCount,
        classLoanCount: db.books.filter((book) =>
          book.status === 'borrowed' && book.borrowedByClassId === klass.id).length,
        classBorrowHistoryCount: classCheckoutHistory.length,
        activeStudents: activeReaders,
        activeReaders,
        readerCount: activeReaders,
        topReaders,
        borrowedThisSchoolYear: combinedThisSchoolYear.length,
        totalBorrowedThisSchoolYear: combinedThisSchoolYear.length,
        borrowedLastMonth: combinedLastMonth.length,
        nonReaders,
        heavyReaders,
        topGenres,
        topTitles,
      };

      return sendJson(res, 200, stats);
    }

    const classMatch = requestUrl.pathname.match(/^\/api\/classes\/([\w-]+)$/);
    if (classMatch && req.method === 'PATCH') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen klassen bijwerken' });
      }
      const db = getDb();
      const klass = db.classes.find((cls) => cls.id === classMatch[1]);
      if (!klass) {
        return sendJson(res, 404, { message: 'Klas niet gevonden' });
      }
      if (user.role === 'teacher' && !(klass.teacherIds || []).includes(user.id)) {
        return sendJson(res, 403, { message: 'Je mag alleen je eigen klassen bijwerken' });
      }
      const body = await parseBody(req);
      if (body.name) {
        const trimmed = body.name.trim();
        if (!trimmed) {
          return sendJson(res, 400, { message: 'Naam van de klas kan niet leeg zijn' });
        }
        klass.name = trimmed;
      }
      if (user.role === 'admin' && Array.isArray(body.teacherIds)) {
        const valid = body.teacherIds.filter((teacherId) =>
          db.users.some((account) => account.id === teacherId && account.role === 'teacher')
        );
        klass.teacherIds = valid;
        for (const account of db.users) {
          if (account.role !== 'teacher') {
            continue;
          }
          account.classIds = Array.isArray(account.classIds)
            ? account.classIds.filter((id) => db.classes.some((entry) => entry.id === id))
            : [];
          if (valid.includes(account.id)) {
            if (!account.classIds.includes(klass.id)) {
              account.classIds.push(klass.id);
            }
          } else {
            account.classIds = account.classIds.filter((id) => id !== klass.id);
          }
        }
      }
      saveDb(db);
      return sendJson(res, 200, klass);
    }

    if (classMatch && req.method === 'DELETE') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen klassen verwijderen' });
      }
      const db = getDb();
      const index = db.classes.findIndex((cls) => cls.id === classMatch[1]);
      if (index === -1) {
        return sendJson(res, 404, { message: 'Klas niet gevonden' });
      }
      // A live class checkout is owned by the class ID. Deleting that class
      // before the physical copy is returned would orphan the checkout and
      // make it impossible to resolve in the staff loan overview.
      const activeClassLoans = db.books.filter((book) =>
        book.borrowedByClassId === classMatch[1]);
      if (activeClassLoans.length) {
        return sendJson(res, 409, {
          message: 'Deze klas heeft nog uitgeleende boeken. Neem deze eerst in.',
          error: 'class_has_active_loans', borrowedCount: activeClassLoans.length,
        });
      }
      const [removedClass] = db.classes.splice(index, 1);
      escalateTasksForDeletedClass(db, removedClass.id);
      for (const student of db.students) {
        student.classIds = (student.classIds || []).filter((id) => id !== removedClass.id);
      }
      for (const account of db.users) {
        if (account.role !== 'teacher') {
          continue;
        }
        account.classIds = Array.isArray(account.classIds)
          ? account.classIds.filter((id) => id !== removedClass.id)
          : [];
      }
      appendHistory(db, {
        type: 'class_deleted',
        classId: removedClass.id,
        message: `Klas ${removedClass.name} is verwijderd`,
      });
      saveDb(db);
      return sendJson(res, 200, { message: 'Klas verwijderd' });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/classes') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen klassen toevoegen' });
      }
      const db = getDb();
      const body = await parseBody(req);
      if (!body.name || !body.name.trim()) {
        return sendJson(res, 400, { message: 'Naam van de klas is verplicht' });
      }
      const requestedTeacherIds = Array.isArray(body.teacherIds) ? body.teacherIds : [];
      const validTeacherIds = requestedTeacherIds.filter((teacherId) =>
        db.users.some((account) => account.id === teacherId && account.role === 'teacher')
      );
      const klass = {
        id: crypto.randomUUID(),
        name: body.name.trim(),
        teacherIds: validTeacherIds,
        studentIds: [],
      };
      db.classes.push(klass);
      appendHistory(db, {
        type: 'class_created',
        classId: klass.id,
        message: `Nieuwe klas ${klass.name} aangemaakt`,
      });
      saveDb(db);
      return sendJson(res, 201, klass);
    }

    const classStudentAddMatch = requestUrl.pathname.match(/^\/api\/classes\/([\w-]+)\/students$/);
    if (classStudentAddMatch && req.method === 'POST') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen leerlingen koppelen' });
      }
      const db = getDb();
      const klass = db.classes.find((cls) => cls.id === classStudentAddMatch[1]);
      if (!klass) {
        return sendJson(res, 404, { message: 'Klas niet gevonden' });
      }
      if (user.role === 'teacher' && !(klass.teacherIds || []).includes(user.id)) {
        return sendJson(res, 403, { message: 'Je mag alleen je eigen klassen beheren' });
      }
      const body = await parseBody(req);
      const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : '';
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      let student = null;
      if (studentId) {
        student = findStudentById(db, studentId);
      }
      if (!student && username) {
        student = findStudentByUsername(db, username);
      }
      if (!student) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      if (!(klass.studentIds || []).includes(student.id)) {
        klass.studentIds = klass.studentIds || [];
        klass.studentIds.push(student.id);
      }
      student.classIds = student.classIds || [];
      if (!student.classIds.includes(klass.id)) {
        student.classIds.push(klass.id);
      }
      appendHistory(db, {
        type: 'class_student_added',
        classId: klass.id,
        studentId: student.id,
        message: `${student.name} gekoppeld aan ${klass.name}`,
      });
      saveDb(db);
      return sendJson(res, 200, { class: klass, student: sanitizeStudent(student, { includeUsername: true }) });
    }

    const classStudentRemoveMatch = requestUrl.pathname.match(
      /^\/api\/classes\/([\w-]+)\/students\/([\w-]+)$/
    );
    if (classStudentRemoveMatch && req.method === 'DELETE') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen leerlingen ontkoppelen' });
      }
      const db = getDb();
      const klass = db.classes.find((cls) => cls.id === classStudentRemoveMatch[1]);
      if (!klass) {
        return sendJson(res, 404, { message: 'Klas niet gevonden' });
      }
      if (user.role === 'teacher' && !(klass.teacherIds || []).includes(user.id)) {
        return sendJson(res, 403, { message: 'Je mag alleen je eigen klassen beheren' });
      }
      const studentId = classStudentRemoveMatch[2];
      const student = findStudentById(db, studentId);
      if (!student) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      klass.studentIds = (klass.studentIds || []).filter((id) => id !== studentId);
      student.classIds = (student.classIds || []).filter((id) => id !== klass.id);
      appendHistory(db, {
        type: 'class_student_removed',
        classId: klass.id,
        studentId: student.id,
        message: `${student.name} losgekoppeld van ${klass.name}`,
      });
      saveDb(db);
      return sendJson(res, 200, { class: klass, student: sanitizeStudent(student, { includeUsername: true }) });
    }

    return sendJson(res, 404, { message: 'Niet gevonden' });
  } catch (error) {
    if (error?.code === 'DATABASE_WRITE_CONFLICT') {
      return sendJson(res, 409, { message: 'De gegevens zijn intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.', error: error.code });
    }
    console.error(error);
    return sendJson(res, 500, { message: 'Interne serverfout' });
  } finally {
    if (requestImportAdmission && !requestImportAdmission.borrowed
      && !requestImportAdmission.lease.handedOff) {
      releaseBookImportLease(requestImportAdmission.lease);
    }
  }
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname.startsWith('/api/')) {
    handleApi(req, res, requestUrl);
    return;
  }

  let filePath = path.join(STATIC_DIR, requestUrl.pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(STATIC_DIR)) {
    sendText(res, 403, 'Toegang geweigerd');
    return;
  }
  if (requestUrl.pathname === '/' || requestUrl.pathname === '') {
    filePath = path.join(STATIC_DIR, 'index.html');
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      sendText(res, 404, 'Pagina niet gevonden');
      return;
    }
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    serveFile(res, filePath);
  });
});

// PR7: no email is sent unless the dedicated Gmail bridge is configured.
// Receipt claims are persisted beside db.json on the same Sliplane volume.
let importMailWorkerActive = false;
async function tickImportReminders() {
  const mailConfig = importMailConfiguration(process.env);
  if (shuttingDown || importMailWorkerActive || !mailConfig.ready) return;
  importMailWorkerActive = true;
  try {
    const authPath = process.env.BOEKENBAAI_AUTH_DATA_PATH
      ? path.resolve(__dirname, process.env.BOEKENBAAI_AUTH_DATA_PATH)
      : DATA_PATH + '.auth.json';
    const stats = await dispatchReminders({
      db: loadDb(), links: readSchoolLinks(authPath),
      folder: DATA_PATH + '.import-mail-receipts',
    });
    if (stats.claimed) console.log('Importherinneringen verwerkt:', {
      accepted: stats.accepted, failed: stats.failed,
    });
  } catch (error) {
    console.error('Importherinneringen controleren mislukt:',
      error.code || 'worker_error');
  } finally {
    importMailWorkerActive = false;
  }
}

server.listen(PORT, () => {
  console.log(`Boekenbaai server draait op http://localhost:${PORT}`);
  if (importMailConfiguration(process.env).ready) {
    // Avoid sending on test startup synchronously; the timer is nonblocking.
    const firstMailRun = setTimeout(() => { void tickImportReminders(); }, 30000);
    if (typeof firstMailRun.unref === 'function') firstMailRun.unref();
    const mailInterval = setInterval(() => { void tickImportReminders(); },
      IMPORT_MAIL_HOUR_MS);
    if (typeof mailInterval.unref === 'function') mailInterval.unref();
  }
  // Resume interrupted cover caching without delaying startup or test setup.
  if (typeof setImmediate === 'function') {
    const restartBackfill = setTimeout(scheduleCoverBackfill, 30000);
    if (typeof restartBackfill?.unref === 'function') restartBackfill.unref();
    const firstCleanup = setTimeout(runCoverGarbageCollection, 60_000);
    if (typeof firstCleanup?.unref === 'function') firstCleanup.unref();
    const periodicCleanup = setInterval(runCoverGarbageCollection, 6 * 60 * 60 * 1000);
    if (typeof periodicCleanup?.unref === 'function') periodicCleanup.unref();
  }
});

function gracefulShutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Ontvangen signaal ${signal}, server wordt afgesloten...`);
  server.close(() => {
    console.log('HTTP-server netjes afgesloten.');
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('Geforceerde afsluiting na timeout.');
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
