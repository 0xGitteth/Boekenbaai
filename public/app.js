const metaApiBase = document.querySelector('meta[name="boekenbaai-api-base"]');
const apiBase = (
  (typeof window !== 'undefined' && window.BOEKENBAAI_API_BASE) ||
  metaApiBase?.content ||
  ''
).trim();
const pageType = document.body?.dataset.page || 'student';
let authToken = localStorage.getItem('boekenbaai_token') || null;
let authUser = null;
let updateAuthUi = () => {};

function setAuth(token) {
  authToken = token;
  localStorage.setItem('boekenbaai_token', token);
}

function clearAuth({ silent = false } = {}) {
  authToken = null;
  authUser = null;
  localStorage.removeItem('boekenbaai_token');
  closeBookDetail();
  if (!silent) {
    updateAuthUi();
  }
}

function isJsonLike(body) {
  return (
    body &&
    typeof body === 'object' &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer)
  );
}

function resolveApiUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (!apiBase) {
    return url;
  }
  const base = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${base}${path}`;
}

async function fetchJson(url, options = {}) {
  const config = { method: 'GET', ...options };
  config.headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (isJsonLike(config.body)) {
    if (!config.headers['Content-Type']) {
      config.headers['Content-Type'] = 'application/json';
    }
    config.body = JSON.stringify(config.body);
  }
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  const response = await fetch(resolveApiUrl(url), config);
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json().catch(() => ({})) : {};
  if (!response.ok) {
    if (response.status === 401) {
      clearAuth();
    }
    throw new Error(payload.message || 'Er ging iets mis');
  }
  return payload;
}

async function reloadCurrentUser(expectedRoles) {
  if (!authToken) return null;
  const me = await fetchJson('/api/me');
  if (expectedRoles && !expectedRoles.includes(me.role)) {
    clearAuth();
    throw new Error('Geen toegang tot dit onderdeel');
  }
  authUser = me;
  updateAuthUi();
  return me;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('nl-NL');
}

function findFolder(folders, id) {
  if (!Array.isArray(folders)) return null;
  return folders.find((folder) => folder.id === id) || null;
}

const THEME_COLOR_MAP = {
  avontuur: '#64b5f6',
  spanning: '#ff9aa2',
  romantiek: '#ffb3d9',
  fantasy: '#cdb4ff',
  informatief: '#8ddad5',
  humor: '#ffe29a',
  geschiedenis: '#f6b48f',
  wetenschap: '#9fd4a5',
  sport: '#9ad7d0',
  poëzie: '#e0b0ff',
};

function normalizeThemeKey(theme) {
  return typeof theme === 'string' ? theme.trim().toLowerCase() : '';
}

function hslToHex(h, s, l) {
  const saturation = s / 100;
  const lightness = l / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
  } else if (h >= 120 && h < 180) {
    g = c;
    b = x;
  } else if (h >= 180 && h < 240) {
    g = x;
    b = c;
  } else if (h >= 240 && h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (value) => {
    const hex = Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');
    return hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hashThemeColor(theme) {
  const value = normalizeThemeKey(theme) || 'thema';
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return hslToHex(hue, 55, 68);
}

function getThemeColor(theme) {
  const key = normalizeThemeKey(theme);
  if (key && THEME_COLOR_MAP[key]) {
    return THEME_COLOR_MAP[key];
  }
  return hashThemeColor(key);
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const parsed = value.length === 3 ? value.replace(/(.)/g, '$1$1') : value;
  const bigint = parseInt(parsed, 16);
  if (Number.isNaN(bigint)) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function rgbToHex(r, g, b) {
  const components = [r, g, b].map((value) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  );
  return `#${components.join('')}`;
}

function mixHexColors(colorA, colorB, weight = 0.5) {
  const ratio = Math.max(0, Math.min(1, weight));
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const r = a.r * (1 - ratio) + b.r * ratio;
  const g = a.g * (1 - ratio) + b.g * ratio;
  const bl = a.b * (1 - ratio) + b.b * ratio;
  return rgbToHex(r, g, bl);
}

function hexToRgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function resolveThemeColors(theme) {
  const base = getThemeColor(theme);
  const background = mixHexColors(base, '#ffffff', 0.82);
  const hoverBackground = mixHexColors(base, '#ffffff', 0.7);
  const activeBackground = mixHexColors(base, '#ffffff', 0.6);
  const border = mixHexColors(base, '#0b1f33', 0.12);
  const activeBorder = mixHexColors(base, '#0b1f33', 0.1);
  const ring = hexToRgba(base, 0.28);
  const text = '#0b1f33';
  return { background, hoverBackground, activeBackground, border, activeBorder, ring, text };
}

const bookDetailState = {
  root: null,
  backdrop: null,
  dialog: null,
  loading: null,
  content: null,
  message: null,
  title: null,
  author: null,
  status: null,
  tags: null,
  description: null,
  coverImage: null,
  coverFallback: null,
  metaPublisher: null,
  metaYear: null,
  metaPages: null,
  metaLanguage: null,
  metaFolder: null,
  metaBarcode: null,
  actions: null,
  editButton: null,
  closeButtons: [],
  previousFocus: null,
  currentBookId: null,
  folderMap: new Map(),
  metadataCache: new Map(),
  adminEditHandler: null,
  handleEscape: null,
  editBook: null,
};

function setBookDetailFolders(folders = []) {
  bookDetailState.folderMap.clear();
  if (!Array.isArray(folders)) return;
  for (const folder of folders) {
    if (folder && folder.id) {
      bookDetailState.folderMap.set(folder.id, folder.name || '');
    }
  }
}

function cacheIsbnMetadata(metadata) {
  if (!metadata || !metadata.barcode) return;
  bookDetailState.metadataCache.set(String(metadata.barcode), metadata);
}

function ensureBookDetailElements() {
  if (!bookDetailState.root) {
    bookDetailState.root = document.querySelector('#book-detail');
    if (!bookDetailState.root) {
      return bookDetailState;
    }
    bookDetailState.backdrop = bookDetailState.root.querySelector('[data-book-detail-dismiss]');
    bookDetailState.dialog = bookDetailState.root.querySelector('.book-detail__dialog');
    bookDetailState.loading = bookDetailState.root.querySelector('#book-detail-loading');
    bookDetailState.content = bookDetailState.root.querySelector('#book-detail-content');
    bookDetailState.message = bookDetailState.root.querySelector('#book-detail-message');
    bookDetailState.title = bookDetailState.root.querySelector('#book-detail-title');
    bookDetailState.author = bookDetailState.root.querySelector('#book-detail-author');
    bookDetailState.status = bookDetailState.root.querySelector('#book-detail-status');
    bookDetailState.tags = bookDetailState.root.querySelector('#book-detail-tags');
    bookDetailState.description = bookDetailState.root.querySelector('#book-detail-description');
    bookDetailState.coverImage = bookDetailState.root.querySelector('#book-detail-cover');
    bookDetailState.coverFallback = bookDetailState.root.querySelector('#book-detail-cover-fallback');
    bookDetailState.metaPublisher = bookDetailState.root.querySelector('#book-detail-publisher');
    bookDetailState.metaYear = bookDetailState.root.querySelector('#book-detail-year');
    bookDetailState.metaPages = bookDetailState.root.querySelector('#book-detail-pages');
    bookDetailState.metaLanguage = bookDetailState.root.querySelector('#book-detail-language');
    bookDetailState.metaFolder = bookDetailState.root.querySelector('#book-detail-folder');
    bookDetailState.metaBarcode = bookDetailState.root.querySelector('#book-detail-barcode');
    bookDetailState.actions = bookDetailState.root.querySelector('.book-detail__actions');
    bookDetailState.editButton = bookDetailState.root.querySelector('[data-book-detail-edit]');
    bookDetailState.closeButtons = Array.from(
      bookDetailState.root.querySelectorAll('[data-book-detail-close]')
    );
    if (bookDetailState.dialog && !bookDetailState.dialog.hasAttribute('tabindex')) {
      bookDetailState.dialog.setAttribute('tabindex', '-1');
    }
    bookDetailState.closeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        closeBookDetail();
      });
    });
    if (bookDetailState.backdrop) {
      bookDetailState.backdrop.addEventListener('click', (event) => {
        if (event.target === bookDetailState.backdrop) {
          closeBookDetail();
        }
      });
    }
    if (!bookDetailState.handleEscape) {
      bookDetailState.handleEscape = (event) => {
        if (event.key === 'Escape' && !bookDetailState.root.classList.contains('hidden')) {
          closeBookDetail();
        }
      };
      document.addEventListener('keydown', bookDetailState.handleEscape);
    }
    if (bookDetailState.editButton) {
      bookDetailState.editButton.addEventListener('click', () => {
        if (!bookDetailState.editBook) return;
        if (typeof bookDetailState.adminEditHandler === 'function') {
          bookDetailState.adminEditHandler(bookDetailState.editBook);
        }
      });
    }
  }
  return bookDetailState;
}

function setBookDetailAdminEditHandler(handler) {
  bookDetailState.adminEditHandler = typeof handler === 'function' ? handler : null;
}

function closeBookDetail() {
  const state = ensureBookDetailElements();
  if (!state.root) return;
  if (!state.root.classList.contains('hidden')) {
    state.root.classList.add('hidden');
    state.root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('book-detail-open');
    if (state.previousFocus && typeof state.previousFocus.focus === 'function') {
      state.previousFocus.focus();
    }
  }
  state.previousFocus = null;
  state.currentBookId = null;
  state.editBook = null;
}

function extractYear(value) {
  const match = String(value || '').match(/(\d{4})/);
  return match ? match[1] : '';
}

function resolvePageCount(metadata, book) {
  const candidates = [
    book?.pages,
    book?.pageCount,
    metadata?.pageCount,
    metadata?.pages,
    metadata?.number_of_pages,
    metadata?.numberOfPages,
  ];
  for (const entry of candidates) {
    if (entry === undefined || entry === null) continue;
    const number = Number(entry);
    if (Number.isFinite(number) && number > 0) {
      return Math.round(number);
    }
    const match = String(entry).match(/\d+/);
    if (match) {
      return Number(match[0]);
    }
  }
  return null;
}

async function resolveBookDetailFolderName(folderId) {
  if (!folderId) return '';
  if (bookDetailState.folderMap.has(folderId)) {
    return bookDetailState.folderMap.get(folderId) || '';
  }
  try {
    const folders = await fetchJson('/api/folders');
    setBookDetailFolders(folders);
    return bookDetailState.folderMap.get(folderId) || '';
  } catch (error) {
    return '';
  }
}

function populateBookDetail(book, metadata, { folderName = '', metadataMessage = '' } = {}) {
  const state = ensureBookDetailElements();
  if (!state.root) return;
  state.editBook = book;
  if (state.loading) {
    state.loading.hidden = true;
  }
  if (state.content) {
    state.content.hidden = false;
  }
  const coverUrl = typeof book.coverUrl === 'string' ? book.coverUrl.trim() : '';
  const hasCover = Boolean(coverUrl);
  if (state.coverImage) {
    if (hasCover) {
      state.coverImage.src = coverUrl;
      state.coverImage.alt = book.title ? `Omslag van ${book.title}` : 'Boekomslag';
      state.coverImage.hidden = false;
    } else {
      state.coverImage.removeAttribute('src');
      state.coverImage.alt = '';
      state.coverImage.hidden = true;
    }
  }
  if (state.coverFallback) {
    const initial = (book.title || '').trim().charAt(0).toUpperCase();
    state.coverFallback.textContent = initial || '📚';
    state.coverFallback.hidden = hasCover;
  }
  if (state.title) {
    state.title.textContent = book.title || 'Onbekende titel';
  }
  if (state.author) {
    state.author.textContent = book.author || '';
  }
  if (state.status) {
    const statusValue = (book.status || 'available').toLowerCase();
    const statusText = statusValue === 'available' ? 'Beschikbaar' : 'Uitgeleend';
    state.status.textContent = statusText;
    state.status.classList.remove('book-detail__status--available', 'book-detail__status--borrowed');
    state.status.classList.add(
      statusValue === 'available' ? 'book-detail__status--available' : 'book-detail__status--borrowed'
    );
  }
  if (state.tags) {
    state.tags.innerHTML = '';
    for (const tag of book.tags || []) {
      const li = document.createElement('li');
      li.className = 'book-detail__tag';
      li.textContent = tag;
      const { background, text: textColor, border } = resolveThemeColors(tag);
      li.style.setProperty('--theme-pill-bg', background);
      li.style.setProperty('--theme-pill-text', textColor);
      li.style.setProperty('--theme-pill-border', border);
      state.tags.append(li);
    }
  }
  const descriptionText = (book.description || '').trim() || (metadata?.description || '').trim();
  if (state.description) {
    state.description.textContent = descriptionText || 'Geen beschrijving beschikbaar.';
  }
  if (state.metaPublisher) {
    state.metaPublisher.textContent = (metadata?.publisher || book.publisher || '').trim() || 'Onbekend';
  }
  if (state.metaYear) {
    const year = extractYear(metadata?.publishedAt || book.publishedAt || '');
    state.metaYear.textContent = year || 'Onbekend';
  }
  if (state.metaPages) {
    const pages = resolvePageCount(metadata, book);
    state.metaPages.textContent = pages ? `${pages}` : 'Onbekend';
  }
  if (state.metaLanguage) {
    state.metaLanguage.textContent = (metadata?.language || book.language || '').trim() || 'Onbekend';
  }
  if (state.metaFolder) {
    state.metaFolder.textContent = folderName || 'Geen map';
  }
  if (state.metaBarcode) {
    state.metaBarcode.textContent = book.barcode || metadata?.barcode || '';
  }
  if (state.message) {
    state.message.textContent = metadataMessage || '';
  }
  if (state.editButton) {
    const isAdmin = authUser?.role === 'admin';
    state.editButton.hidden = !isAdmin;
    state.editButton.disabled = !isAdmin;
  }
}

async function openBookDetail(book) {
  const state = ensureBookDetailElements();
  if (!state.root) return;
  const bookId = typeof book === 'string' ? book : book?.id;
  if (!bookId) return;
  state.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  state.root.classList.remove('hidden');
  state.root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('book-detail-open');
  state.currentBookId = bookId;
  if (state.content) {
    state.content.hidden = true;
  }
  if (state.loading) {
    state.loading.hidden = false;
    state.loading.textContent = 'Boekdetails laden…';
  }
  if (state.message) {
    state.message.textContent = '';
  }
  if (state.dialog) {
    state.dialog.focus({ preventScroll: true });
  }
  let detail = null;
  try {
    detail = await fetchJson(`/api/books/${encodeURIComponent(bookId)}`);
  } catch (error) {
    if (book && typeof book === 'object') {
      detail = book;
    } else {
      if (state.loading) {
        state.loading.textContent = error.message || 'Kon boekdetails niet laden.';
      }
      return;
    }
  }
  if (!detail || state.currentBookId !== bookId) {
    return;
  }
  const barcode = (detail.barcode || '').replace(/[^0-9X]/gi, '');
  const canLookupMetadata = authUser?.role === 'admin';
  let metadata = barcode ? bookDetailState.metadataCache.get(barcode) : null;
  let metadataMessage = '';
  if (!metadata && barcode && canLookupMetadata) {
    try {
      metadata = await fetchJson(`/api/isbn/${encodeURIComponent(barcode)}`);
      cacheIsbnMetadata(metadata);
    } catch (error) {
      metadataMessage = error.message || '';
    }
  }
  if (metadata && canLookupMetadata) {
    if (metadata.found) {
      const sourceLabel = metadata.source === 'openlibrary' ? 'Open Library' : metadata.source || 'de bron';
      metadataMessage = `Gegevens aangevuld via ${sourceLabel}.`;
    } else if (!metadataMessage) {
      metadataMessage = 'Geen aanvullende metadata gevonden.';
    }
  }
  const folderName = await resolveBookDetailFolderName(detail.folderId);
  if (state.currentBookId !== bookId) {
    return;
  }
  populateBookDetail(detail, metadata, { folderName, metadataMessage });
}

function collectUniqueThemes(books) {
  const map = new Map();
  for (const book of books || []) {
    for (const tag of book?.tags || []) {
      if (typeof tag !== 'string') continue;
      const label = tag.trim();
      if (!label) continue;
      const key = normalizeThemeKey(label);
      if (!key || map.has(key)) continue;
      map.set(key, { key, label });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.label.localeCompare(b.label, 'nl', { sensitivity: 'base' })
  );
}

function renderThemePills(container, config = {}) {
  if (!container) return;
  const {
    themes = [],
    selectedThemes = new Set(),
    onlyExamList = false,
    onToggleTheme,
    onToggleExam,
    onClear,
  } = config;

  const elements = [];

  const examButton = document.createElement('button');
  examButton.type = 'button';
  examButton.className = 'filters__pill filters__pill--exam';
  examButton.textContent = 'Leeslijst';
  const examActive = Boolean(onlyExamList);
  examButton.classList.toggle('filters__pill--active', examActive);
  examButton.setAttribute('aria-pressed', examActive ? 'true' : 'false');
  examButton.addEventListener('click', () => {
    if (typeof onToggleExam === 'function') {
      onToggleExam(!examActive);
    }
  });
  elements.push(examButton);

  const isThemeSelected = (key) => {
    if (!key) return false;
    if (selectedThemes instanceof Set) {
      return selectedThemes.has(key);
    }
    return Array.isArray(selectedThemes) ? selectedThemes.includes(key) : false;
  };

  if (!themes.length) {
    const placeholder = document.createElement('span');
    placeholder.className = 'filters__pill-placeholder';
    placeholder.textContent = 'Geen thema\'s beschikbaar';
    elements.push(placeholder);
  } else {
    for (const entry of themes) {
      const label = typeof entry === 'string' ? entry : entry.label;
      const key = typeof entry === 'string' ? normalizeThemeKey(entry) : entry.key;
      if (!key || !label) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'filters__pill';
      button.textContent = label;
      const {
        background,
        hoverBackground,
        activeBackground,
        border,
        activeBorder,
        ring,
        text,
      } = resolveThemeColors(label);
      button.style.setProperty('--theme-pill-bg', background);
      button.style.setProperty('--theme-pill-hover-bg', hoverBackground);
      button.style.setProperty('--theme-pill-active-bg', activeBackground);
      button.style.setProperty('--theme-pill-border', border);
      button.style.setProperty('--theme-pill-active-border', activeBorder);
      button.style.setProperty('--theme-pill-ring', ring);
      button.style.setProperty('--theme-pill-text', text);
      const isActive = isThemeSelected(key);
      button.classList.toggle('filters__pill--active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      button.dataset.filterValue = key;
      button.addEventListener('click', () => {
        if (typeof onToggleTheme === 'function') {
          onToggleTheme({ key, label, active: !isThemeSelected(key) });
        }
      });
      elements.push(button);
    }
  }

  const hasSelection = Boolean(
    (selectedThemes instanceof Set && selectedThemes.size > 0) ||
      (Array.isArray(selectedThemes) && selectedThemes.length > 0) ||
      onlyExamList
  );
  if (hasSelection) {
    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'filters__pill filters__pill--clear';
    clearButton.textContent = 'Wis selectie';
    clearButton.addEventListener('click', () => {
      if (typeof onClear === 'function') {
        onClear();
      }
    });
    elements.push(clearButton);
  }

  container.replaceChildren(...elements);
}

function createBookCard(template, book, folders, options = {}) {
  if (!template) return null;
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.book-card');
  if (!card) return null;

  const coverImage = fragment.querySelector('.book-card__cover');
  const coverFallback = fragment.querySelector('.book-card__cover-fallback');
  const statusBadge = fragment.querySelector('.book-card__status');
  const title = fragment.querySelector('.book-card__title');
  const author = fragment.querySelector('.book-card__author');
  const tagsList = fragment.querySelector('.book-card__tags');

  const coverColor = book.coverColor || '#dbe2f5';
  card.style.setProperty('--book-cover-color', coverColor);

  const coverUrl = typeof book.coverUrl === 'string' ? book.coverUrl.trim() : '';
  const hasCover = Boolean(coverUrl);

  if (coverFallback) {
    const fallbackInitial = (book.title || '').trim().charAt(0).toUpperCase();
    coverFallback.textContent = fallbackInitial || '📚';
    coverFallback.hidden = hasCover;
    if (hasCover) {
      coverFallback.removeAttribute('role');
      coverFallback.removeAttribute('aria-label');
    } else {
      coverFallback.setAttribute('role', 'img');
      coverFallback.setAttribute('aria-label', 'Geen omslag beschikbaar');
    }
  }

  if (coverImage) {
    if (hasCover) {
      coverImage.src = coverUrl;
      coverImage.alt = book.title ? `Omslag van ${book.title}` : 'Boekomslag';
      coverImage.loading = 'lazy';
      coverImage.decoding = 'async';
      coverImage.hidden = false;
      if (coverFallback) {
        coverFallback.hidden = true;
      }
    } else {
      coverImage.removeAttribute('src');
      coverImage.alt = '';
      coverImage.removeAttribute('loading');
      coverImage.removeAttribute('decoding');
      coverImage.hidden = true;
      if (coverFallback) {
        coverFallback.hidden = false;
      }
    }
  }

  if (statusBadge) {
    statusBadge.classList.remove('book-card__status--available', 'book-card__status--borrowed');
    statusBadge.textContent = book.status === 'available' ? 'Beschikbaar' : 'Uitgeleend';
    statusBadge.classList.add(
      book.status === 'available' ? 'book-card__status--available' : 'book-card__status--borrowed'
    );
  }

  title.textContent = book.title;
  author.textContent = book.author;
  if (tagsList) {
    tagsList.innerHTML = '';
    for (const tag of book.tags || []) {
      const li = document.createElement('li');
      li.className = 'book-card__tag';
      li.textContent = tag;
      const { background, text, border } = resolveThemeColors(tag);
      li.style.setProperty('--theme-pill-bg', background);
      li.style.setProperty('--theme-pill-text', text);
      li.style.setProperty('--theme-pill-border', border);
      tagsList.append(li);
    }
    tagsList.classList.toggle('hidden', tagsList.childElementCount === 0);
  }

  card.dataset.bookId = book.id || '';
  const isSelectable = Boolean(options.selectable);
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  if (isSelectable) {
    card.classList.add('book-card--selectable');
    if (options.selected) {
      card.classList.add('book-card--selected');
    }
    card.setAttribute('aria-pressed', options.selected ? 'true' : 'false');
  } else {
    card.classList.remove('book-card--selected');
    card.removeAttribute('aria-pressed');
  }
  const handleActivate = (event) => {
    if (event) {
      event.preventDefault();
    }
    openBookDetail(book);
    if (isSelectable && typeof options.onSelect === 'function') {
      options.onSelect(book, event);
    }
  };
  card.addEventListener('click', handleActivate);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleActivate(event);
    }
  });

  return card;
}

function filterBooks(allBooks, { folder, query, selectedThemes, onlyExamList } = {}) {
  let list = Array.isArray(allBooks) ? [...allBooks] : [];
  if (folder) {
    list = list.filter((book) => book.folderId === folder);
  }
  if (onlyExamList) {
    list = list.filter((book) => book.suitableForExamList);
  }
  const themes = selectedThemes ? Array.from(selectedThemes) : [];
  const normalizedThemes = themes.map(normalizeThemeKey).filter(Boolean);
  if (normalizedThemes.length) {
    list = list.filter((book) => {
      const tagKeys = (book.tags || []).map(normalizeThemeKey).filter(Boolean);
      if (!tagKeys.length) return false;
      return normalizedThemes.every((theme) => tagKeys.includes(theme));
    });
  }
  if (query) {
    const term = query.toLowerCase();
    list = list.filter((book) => {
      const haystack = [
        book.title,
        book.author,
        book.description,
        book.barcode,
        ...(book.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }
  return list;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const base64 = result.split(',')[1] || result;
        resolve(base64);
        return;
      }
      if (result instanceof ArrayBuffer) {
        const bytes = new Uint8Array(result);
        let binary = '';
        for (const byte of bytes) {
          binary += String.fromCharCode(byte);
        }
        resolve(btoa(binary));
        return;
      }
      reject(new Error('Kon bestand niet lezen'));
    };
    reader.onerror = () => reject(new Error('Kon bestand niet lezen'));
    reader.readAsDataURL(file);
  });
}

function initStudentPage() {
  const loginPanel = document.querySelector('#student-login-panel');
  const loginForm = document.querySelector('#student-login-form');
  const loginUsername = document.querySelector('#student-login-username');
  const loginPassword = document.querySelector('#student-login-password');
  const loginMessage = document.querySelector('#student-login-message');
  const dashboard = document.querySelector('#student-dashboard');
  const studentName = document.querySelector('#student-name');
  const studentGrade = document.querySelector('#student-grade');
  const borrowedList = document.querySelector('#student-borrowed-list');
  const borrowedEmpty = document.querySelector('#student-borrowed-empty');
  const logoutButton = document.querySelector('#student-logout');
  const searchInput = document.querySelector('#search-input');
  const summary = document.querySelector('#summary');
  const bookGrid = document.querySelector('#book-grid');
  const bookCardTemplate = document.querySelector('#book-card-template');
  const themeFilterPills = document.querySelector('#theme-filter-pills');
  const barcodeInput = document.querySelector('#barcode-input');
  const lookupButton = document.querySelector('#lookup-button');
  const bookResult = document.querySelector('#book-result');

  let folders = [];
  let allBooks = [];
  let currentBook = null;
  let availableThemes = [];
  const selectedThemeKeys = new Set();
  let onlyExamList = false;

  function renderBorrowedBooks() {
    if (!borrowedList || !borrowedEmpty) return;
    borrowedList.innerHTML = '';
    const loggedIn = authUser && authUser.role === 'student';
    if (!loggedIn) {
      borrowedEmpty.classList.remove('hidden');
      borrowedEmpty.textContent = 'Log in om jouw uitleenlijst te bekijken.';
      return;
    }
    const borrowed = authUser.borrowedBooks || [];
    if (!borrowed.length) {
      borrowedEmpty.classList.remove('hidden');
      borrowedEmpty.textContent = 'Je hebt nog geen boeken geleend.';
      return;
    }
    borrowedEmpty.classList.add('hidden');
    for (const item of borrowed) {
      const book = allBooks.find((entry) => entry.id === item.bookId);
      const li = document.createElement('li');
      li.className = 'borrowed-list__item';
      const parts = [
        `<strong>${book ? book.title : 'Onbekend boek'}</strong>`,
        book ? `<span>${book.author}</span>` : '',
        item.borrowedAt ? `<span>Sinds ${formatDate(item.borrowedAt)}</span>` : '',
      ].filter(Boolean);
      li.innerHTML = parts.join(' ');
      borrowedList.append(li);
    }
  }

  function enableScanArea() {
    const loggedIn = authUser && authUser.role === 'student';
    if (barcodeInput) {
      barcodeInput.disabled = !loggedIn;
      if (!loggedIn) {
        barcodeInput.value = '';
      }
    }
    if (lookupButton) {
      lookupButton.disabled = !loggedIn;
    }
  }

  function resetBookResult() {
    if (bookResult) {
      bookResult.innerHTML =
        '<p class="book-result__status">Log in en scan een boek om te starten.</p>';
    }
    currentBook = null;
  }

  function renderAuthState() {
    const loggedIn = authUser && authUser.role === 'student';
    loginPanel?.classList.toggle('hidden', loggedIn);
    dashboard?.classList.toggle('hidden', !loggedIn);
    logoutButton?.classList.toggle('hidden', !loggedIn);
    if (studentName) {
      studentName.textContent = loggedIn ? authUser.name : '';
    }
    if (studentGrade) {
      studentGrade.textContent = loggedIn && authUser.grade ? `Klas: ${authUser.grade}` : '';
    }
    enableScanArea();
    renderBorrowedBooks();
    if (!loggedIn) {
      resetBookResult();
    }
  }

  updateAuthUi = renderAuthState;

  function renderBooks() {
    if (!bookGrid) return;
    const filters = {
      folder: '',
      query: searchInput?.value || '',
      selectedThemes: selectedThemeKeys,
      onlyExamList,
    };
    const filtered = filterBooks(allBooks, filters);
    bookGrid.innerHTML = '';
    if (!filtered.length) {
      bookGrid.innerHTML = '<p>Geen boeken gevonden voor deze selectie.</p>';
      return;
    }
    for (const book of filtered) {
      const card = createBookCard(bookCardTemplate, book, folders);
      if (card) {
        bookGrid.append(card);
      }
    }
  }

  function renderThemeFilters() {
    renderThemePills(themeFilterPills, {
      themes: availableThemes,
      selectedThemes: selectedThemeKeys,
      onlyExamList,
      onToggleTheme: ({ key, active }) => {
        if (!key) return;
        if (active) {
          selectedThemeKeys.add(key);
        } else {
          selectedThemeKeys.delete(key);
        }
        renderThemeFilters();
        renderBooks();
      },
      onToggleExam: (nextValue) => {
        onlyExamList = Boolean(nextValue);
        renderThemeFilters();
        renderBooks();
      },
      onClear: () => {
        selectedThemeKeys.clear();
        onlyExamList = false;
        renderThemeFilters();
        renderBooks();
      },
    });
  }

  function updateAvailableThemes() {
    availableThemes = collectUniqueThemes(allBooks);
    const availableKeys = new Set(availableThemes.map((theme) => theme.key));
    for (const key of Array.from(selectedThemeKeys)) {
      if (!availableKeys.has(key)) {
        selectedThemeKeys.delete(key);
      }
    }
    renderThemeFilters();
  }

  async function loadFolders() {
    folders = await fetchJson('/api/folders');
    setBookDetailFolders(folders);
  }

  async function loadBooks() {
    allBooks = await fetchJson('/api/books');
    updateAvailableThemes();
    renderBooks();
  }

  async function loadSummary() {
    if (!summary) return;
    const data = await fetchJson('/api/status');
    summary.innerHTML = '';
    const items = [
      { label: 'Totaal', value: data.totalBooks },
      { label: 'Beschikbaar', value: data.availableBooks },
      { label: 'Uitgeleend', value: data.borrowedBooks },
      { label: 'Leeslijst', value: data.examListBooks },
    ];
    for (const item of items) {
      const div = document.createElement('div');
      div.className = 'summary__item';
      div.innerHTML = `${item.value}<span>${item.label}</span>`;
      summary.append(div);
    }
  }

  async function handleLookup() {
    if (!authUser || authUser.role !== 'student') {
      resetBookResult();
      return;
    }
    const barcode = barcodeInput?.value.trim();
    if (!barcode) return;
    try {
      currentBook = await fetchJson(`/api/books/barcode/${encodeURIComponent(barcode)}`);
      renderBookPrompt();
    } catch (error) {
      currentBook = null;
      if (bookResult) {
        bookResult.innerHTML = `<p class="book-result__status">${error.message}</p>`;
      }
    }
  }

  function renderBookPrompt() {
    if (!bookResult) return;
    if (!currentBook) {
      resetBookResult();
      return;
    }
    const loggedIn = authUser && authUser.role === 'student';
    const folder = findFolder(folders, currentBook.folderId);
    const borrowedByStudent = loggedIn && currentBook.borrowedBy === authUser.id;
    const borrowedByOther = currentBook.status === 'borrowed' && !borrowedByStudent;
    let statusText = 'Boek is beschikbaar';
    if (currentBook.status !== 'available') {
      statusText = borrowedByStudent
        ? 'Je hebt dit boek geleend'
        : 'Dit boek is momenteel uitgeleend';
    }
    const examBadge = currentBook.suitableForExamList
      ? '<p><strong>✔ Op de leeslijst</strong></p>'
      : '';
    bookResult.innerHTML = `
      <h3>${currentBook.title}</h3>
      <p>${currentBook.author}</p>
      <p class="book-result__status">${statusText}</p>
      <p>${currentBook.description || ''}</p>
      <p><strong>Map:</strong> ${folder ? folder.name : 'Geen map'}</p>
      <p><strong>Barcode:</strong> ${currentBook.barcode}</p>
      ${examBadge}
    `;
    const actions = document.createElement('div');
    actions.className = 'book-result__actions';
    if (currentBook.status === 'available' && loggedIn) {
      const borrowBtn = document.createElement('button');
      borrowBtn.type = 'button';
      borrowBtn.className = 'btn';
      borrowBtn.textContent = 'Ik leen dit boek';
      borrowBtn.addEventListener('click', () => handleBorrow(currentBook));
      actions.append(borrowBtn);
    }
    if (borrowedByStudent) {
      const returnBtn = document.createElement('button');
      returnBtn.type = 'button';
      returnBtn.className = 'btn btn--secondary';
      returnBtn.textContent = 'Ik breng het terug';
      returnBtn.addEventListener('click', () => handleReturn(currentBook));
      actions.append(returnBtn);
    }
    if (borrowedByOther) {
      const info = document.createElement('p');
      info.className = 'hint';
      info.textContent =
        'Het boek is nu uitgeleend. Vraag de mediatheek om hulp als je het nodig hebt.';
      actions.append(info);
    }
    bookResult.append(actions);
  }

  async function handleBorrow(book) {
    if (!book) return;
    try {
      const result = await fetchJson(`/api/books/${book.id}/check-out`, {
        method: 'POST',
        body: {},
      });
      currentBook = result.book;
      await refreshData();
      if (bookResult) {
        bookResult.innerHTML = `<p class="book-result__status">Veel leesplezier met <strong>${result.book.title}</strong>!</p>`;
      }
    } catch (error) {
      if (bookResult) {
        bookResult.innerHTML = `<p class="book-result__status">${error.message}</p>`;
      }
    }
  }

  async function handleReturn(book) {
    if (!book) return;
    try {
      const result = await fetchJson(`/api/books/${book.id}/check-in`, {
        method: 'POST',
        body: {},
      });
      currentBook = result.book;
      await refreshData();
      if (bookResult) {
        bookResult.innerHTML = `<p class="book-result__status">Bedankt! <strong>${result.book.title}</strong> is weer beschikbaar.</p>`;
      }
    } catch (error) {
      if (bookResult) {
        bookResult.innerHTML = `<p class="book-result__status">${error.message}</p>`;
      }
    }
  }

  async function refreshData() {
    if (!authUser || authUser.role !== 'student') return;
    await Promise.all([loadFolders(), loadBooks(), loadSummary(), reloadCurrentUser(['student'])]);
    if (currentBook) {
      const updated = allBooks.find((book) => book.id === currentBook.id);
      currentBook = updated || null;
    }
    renderBorrowedBooks();
    renderBookPrompt();
  }

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = loginUsername.value.trim();
    const password = loginPassword.value;
    if (!username || !password) {
      loginMessage.textContent = 'Vul je gebruikersnaam en wachtwoord in.';
      return;
    }
    try {
      const result = await fetchJson('/api/login', {
        method: 'POST',
        body: { username, password },
      });
      if (result.user.role !== 'student') {
        clearAuth({ silent: true });
        loginMessage.textContent = 'Gebruik voor medewerkers de docenteninlog.';
        return;
      }
      setAuth(result.token);
      await reloadCurrentUser(['student']);
      loginForm.reset();
      loginMessage.textContent = `Welkom ${authUser.name}!`;
      await refreshData();
      barcodeInput?.focus();
    } catch (error) {
      loginMessage.textContent = error.message;
    }
  });

  logoutButton?.addEventListener('click', async () => {
    if (!authToken) return;
    try {
      await fetchJson('/api/logout', { method: 'POST' });
    } catch (error) {
      // server kan al uitgelogd zijn, negeer fout
    }
    clearAuth();
    loginMessage.textContent = 'Je bent uitgelogd.';
    renderBorrowedBooks();
    resetBookResult();
  });

  lookupButton?.addEventListener('click', (event) => {
    event.preventDefault();
    handleLookup();
  });

  barcodeInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleLookup();
    }
  });

  searchInput?.addEventListener('input', renderBooks);

  renderThemeFilters();
  renderAuthState();
  Promise.all([loadFolders(), loadBooks(), loadSummary()]).catch(() => {});
  if (authToken) {
    reloadCurrentUser(['student'])
      .then(refreshData)
      .catch(() => {
        clearAuth();
      });
  }
}

function initStaffPage() {
  const loginPanel = document.querySelector('#staff-login-panel');
  const loginForm = document.querySelector('#login-form');
  const loginUsername = document.querySelector('#login-username');
  const loginPassword = document.querySelector('#login-password');
  const loginMessage = document.querySelector('#login-message');
  const staffSections = document.querySelectorAll('[data-visible-for]');
  const roleSpecificSections = document.querySelectorAll('[data-role-only]');
  const staffName = document.querySelector('#staff-name');
  const staffRole = document.querySelector('#staff-role');
  const logoutButton = document.querySelector('#logout-button');
  const searchInput = document.querySelector('#search-input');
  const summary = document.querySelector('#summary');
  const bookGrid = document.querySelector('#book-grid');
  const bookCardTemplate = document.querySelector('#book-card-template');
  const themeFilterPills = document.querySelector('#theme-filter-pills');
  const historyList = document.querySelector('#history-list');
  const classList = document.querySelector('#class-list');
  const classMessage = document.querySelector('#class-message');
  const teacherLayout = document.querySelector('.teacher-layout');
  const teacherClassesPanel = document.querySelector('.teacher-layout__classes');
  const adminBookForm = document.querySelector('#admin-book-form');
  const adminBookIdInput = document.querySelector('#admin-book-id');
  const adminBookTitle = document.querySelector('#admin-book-title');
  const adminBookAuthor = document.querySelector('#admin-book-author');
  const adminBookBarcode = document.querySelector('#admin-book-barcode');
  const adminBookLookupButton = document.querySelector('#admin-book-lookup');
  const adminBookLookupMessage = document.querySelector('#admin-book-lookup-message');
  const adminFolderSelect = document.querySelector('#admin-folder-select');
  const adminBookExam = document.querySelector('#admin-book-exam');
  const adminBookDescription = document.querySelector('#admin-book-description');
  const adminBookMessage = document.querySelector('#admin-book-message');
  const adminBookSubmitButton = document.querySelector('#admin-book-submit');
  const adminBookCancelButton = document.querySelector('#admin-book-cancel');
  const adminBookDeleteButton = document.querySelector('#admin-book-delete');
  const adminClassForm = document.querySelector('#admin-class-form');
  const adminClassNameInput = document.querySelector('#admin-class-name');
  const adminClassTeachersSelect = document.querySelector('#admin-class-teachers');
  const adminClassMessage = document.querySelector('#admin-class-message');
  const adminClassList = document.querySelector('#admin-class-list');
  const adminStudentForm = document.querySelector('#admin-student-form');
  const adminStudentNameInput = document.querySelector('#admin-student-name');
  const adminStudentUsernameInput = document.querySelector('#admin-student-username');
  const adminStudentPasswordInput = document.querySelector('#admin-student-password');
  const adminStudentGradeInput = document.querySelector('#admin-student-grade');
  const adminStudentClassSelect = document.querySelector('#admin-student-class');
  const adminStudentMessage = document.querySelector('#admin-student-message');
  const adminStudentList = document.querySelector('#admin-student-list');
  const studentImportForm = document.querySelector('#student-import-form');
  const studentImportFile = document.querySelector('#student-import-file');
  const studentImportMessage = document.querySelector('#student-import-message');
  const studentImportResults = document.querySelector('#student-import-results');
  const teacherStudentForm = document.querySelector('#teacher-student-form');
  const teacherStudentUsernameInput = document.querySelector('#teacher-student-username');
  const teacherStudentClassSelect = document.querySelector('#teacher-student-class');
  const teacherStudentMessage = document.querySelector('#teacher-student-message');
  const teacherStudentList = document.querySelector('#teacher-student-list');

  let folders = [];
  let allBooks = [];
  let classes = [];
  let students = [];
  let teachers = [];
  let selectedBookId = null;
  let selectedAdminClassId = '';
  let selectedAdminStudentId = '';
  let barcodeLookupTimer = null;
  const filters = { query: '' };
  let availableThemes = [];
  const selectedThemeKeys = new Set();
  let onlyExamList = false;

  function renderStaffState() {
    const loggedIn = authUser && (authUser.role === 'teacher' || authUser.role === 'admin');
    loginPanel?.classList.toggle('hidden', loggedIn);
    staffSections.forEach((section) => {
      const roles = (section.dataset.visibleFor || '')
        .split(',')
        .map((role) => role.trim())
        .filter(Boolean);
      const show = loggedIn && roles.includes(authUser.role);
      section.classList.toggle('hidden', !show);
    });
    roleSpecificSections.forEach((section) => {
      const roles = (section.dataset.roleOnly || '')
        .split(',')
        .map((role) => role.trim())
        .filter(Boolean);
      const show = loggedIn && roles.includes(authUser.role);
      section.classList.toggle('hidden', !show);
    });
    if (staffName) {
      staffName.textContent = loggedIn ? authUser.name : '';
    }
    if (staffRole) {
      staffRole.textContent = loggedIn ? (authUser.role === 'admin' ? 'Beheerder' : 'Docent') : '';
    }
    if (logoutButton) {
      logoutButton.disabled = !loggedIn;
    }
    if (teacherLayout && teacherClassesPanel) {
      const classesHidden = teacherClassesPanel.classList.contains('hidden');
      teacherLayout.classList.toggle('teacher-layout--single', classesHidden);
    }
    if (!loggedIn) {
      historyList && (historyList.innerHTML = '');
      classList && (classList.innerHTML = '');
      adminBookMessage && (adminBookMessage.textContent = '');
      adminBookLookupMessage && (adminBookLookupMessage.textContent = '');
      adminBookCancelButton && adminBookCancelButton.classList.add('hidden');
      if (adminBookDeleteButton) {
        adminBookDeleteButton.classList.add('hidden');
        adminBookDeleteButton.disabled = true;
      }
      adminBookForm && adminBookForm.reset();
      adminBookIdInput && (adminBookIdInput.value = '');
      studentImportMessage && (studentImportMessage.textContent = '');
      studentImportResults && (studentImportResults.innerHTML = '');
      adminClassMessage && (adminClassMessage.textContent = '');
      adminClassList && (adminClassList.innerHTML = '');
      adminClassTeachersSelect && (adminClassTeachersSelect.innerHTML = '');
      adminStudentMessage && (adminStudentMessage.textContent = '');
      adminStudentList && (adminStudentList.innerHTML = '');
      if (adminStudentClassSelect) {
        adminStudentClassSelect.innerHTML = '<option value="">Geen klas koppelen</option>';
      }
      adminStudentForm && adminStudentForm.reset();
      teacherStudentMessage && (teacherStudentMessage.textContent = '');
      teacherStudentList && (teacherStudentList.innerHTML = '');
      teacherStudentForm && teacherStudentForm.reset();
      selectedBookId = null;
      selectedAdminClassId = '';
      selectedAdminStudentId = '';
      folders = [];
      allBooks = [];
      classes = [];
      students = [];
      teachers = [];
      availableThemes = [];
      selectedThemeKeys.clear();
      onlyExamList = false;
      renderThemeFilters();
      renderBooks();
    }
  }

  updateAuthUi = renderStaffState;

  function renderBooks() {
    if (!bookGrid) return;
    const filtered = filterBooks(allBooks, {
      folder: '',
      query: filters.query,
      selectedThemes: selectedThemeKeys,
      onlyExamList,
    });
    bookGrid.innerHTML = '';
    if (!filtered.length) {
      bookGrid.innerHTML = '<p>Geen boeken gevonden voor deze selectie.</p>';
      return;
    }
    const isAdmin = authUser?.role === 'admin';
    for (const book of filtered) {
      const card = createBookCard(bookCardTemplate, book, folders, {
        selectable: Boolean(isAdmin),
        selected: Boolean(isAdmin && selectedBookId === book.id),
        onSelect: (selectedBook) => {
          if (isAdmin) {
            handleAdminBookSelection(selectedBook);
          }
        },
      });
      if (card) {
        bookGrid.append(card);
      }
    }
  }

  function renderThemeFilters() {
    renderThemePills(themeFilterPills, {
      themes: availableThemes,
      selectedThemes: selectedThemeKeys,
      onlyExamList,
      onToggleTheme: ({ key, active }) => {
        if (!key) return;
        if (active) {
          selectedThemeKeys.add(key);
        } else {
          selectedThemeKeys.delete(key);
        }
        renderThemeFilters();
        renderBooks();
      },
      onToggleExam: (nextValue) => {
        onlyExamList = Boolean(nextValue);
        renderThemeFilters();
        renderBooks();
      },
      onClear: () => {
        selectedThemeKeys.clear();
        onlyExamList = false;
        renderThemeFilters();
        renderBooks();
      },
    });
  }

  function updateAvailableThemes() {
    availableThemes = collectUniqueThemes(allBooks);
    const availableKeys = new Set(availableThemes.map((theme) => theme.key));
    for (const key of Array.from(selectedThemeKeys)) {
      if (!availableKeys.has(key)) {
        selectedThemeKeys.delete(key);
      }
    }
    renderThemeFilters();
  }

  function handleAdminBookSelection(book, options = {}) {
    if (!book || authUser?.role !== 'admin') return;
    selectedBookId = book.id;
    renderBooks();
    populateAdminBookForm(book, { silent: true });
    if (adminBookDeleteButton) {
      adminBookDeleteButton.classList.remove('hidden');
      adminBookDeleteButton.disabled = false;
    }
    if (adminBookMessage && !options.silent) {
      adminBookMessage.textContent = 'Boek geladen voor bewerking.';
    }
    if (adminBookForm && options.scroll !== false) {
      adminBookForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (adminBookTitle && options.focus !== false) {
      adminBookTitle.focus();
    }
  }

  setBookDetailAdminEditHandler((selectedBook) => {
    if (!selectedBook) return;
    closeBookDetail();
    handleAdminBookSelection(selectedBook, { focus: true, scroll: true });
  });

  function resetAdminBookForm() {
    if (!adminBookForm) return;
    adminBookForm.reset();
    if (adminBookIdInput) {
      adminBookIdInput.value = '';
    }
    if (adminBookSubmitButton) {
      adminBookSubmitButton.textContent = 'Boek opslaan';
    }
    if (adminBookCancelButton) {
      adminBookCancelButton.classList.add('hidden');
    }
    if (adminBookDeleteButton) {
      adminBookDeleteButton.classList.add('hidden');
      adminBookDeleteButton.disabled = true;
    }
    if (adminBookLookupMessage) {
      adminBookLookupMessage.textContent = '';
    }
    selectedBookId = null;
    renderBooks();
  }

  function populateAdminBookForm(book, options = {}) {
    if (!adminBookForm || !book) return;
    if (adminBookIdInput) {
      adminBookIdInput.value = book.id || '';
    }
    if (adminBookTitle) {
      adminBookTitle.value = book.title || '';
    }
    if (adminBookAuthor) {
      adminBookAuthor.value = book.author || '';
    }
    if (adminBookBarcode) {
      adminBookBarcode.value = book.barcode || '';
    }
    if (adminBookDescription) {
      adminBookDescription.value = book.description || '';
    }
    if (adminBookExam) {
      adminBookExam.checked = Boolean(book.suitableForExamList);
    }
    if (adminFolderSelect) {
      adminFolderSelect.value = book.folderId || '';
    }
    if (adminBookSubmitButton) {
      adminBookSubmitButton.textContent = 'Boek bijwerken';
    }
    if (adminBookCancelButton) {
      adminBookCancelButton.classList.remove('hidden');
    }
    if (adminBookDeleteButton) {
      adminBookDeleteButton.classList.remove('hidden');
      adminBookDeleteButton.disabled = false;
    }
    if (adminBookMessage && !options.silent) {
      adminBookMessage.textContent = 'Je bewerkt nu een bestaand boek.';
    }
  }

  function applyBookMetadata(metadata) {
    if (!metadata) return;
    if (metadata.title && adminBookTitle && !adminBookTitle.value) {
      adminBookTitle.value = metadata.title;
    }
    const authorCandidates = [];
    if (metadata.author) {
      authorCandidates.push(metadata.author);
    }
    if (Array.isArray(metadata.authors) && metadata.authors.length) {
      authorCandidates.push(metadata.authors.join(', '));
    }
    if (!authorCandidates.length && metadata.contributors) {
      if (Array.isArray(metadata.contributors)) {
        authorCandidates.push(metadata.contributors.join(', '));
      } else if (typeof metadata.contributors === 'string') {
        authorCandidates.push(metadata.contributors);
      }
    }
    if (adminBookAuthor && !adminBookAuthor.value && authorCandidates.length) {
      adminBookAuthor.value = authorCandidates[0];
    }
    const description = (() => {
      if (!metadata.description) return '';
      if (typeof metadata.description === 'string') return metadata.description;
      if (metadata.description.value) return metadata.description.value;
      return '';
    })();
    if (description && adminBookDescription && !adminBookDescription.value) {
      adminBookDescription.value = description;
    }
  }

  function getTeacherClassIds() {
    if (!authUser) return [];
    if (authUser.role === 'admin') {
      return classes.map((klass) => klass.id);
    }
    return classes.filter((klass) => (klass.teacherIds || []).includes(authUser.id)).map((klass) => klass.id);
  }

  function renderAdminTeacherSelect() {
    if (!adminClassTeachersSelect) return;
    adminClassTeachersSelect.innerHTML = '';
    for (const teacher of teachers) {
      const option = document.createElement('option');
      option.value = teacher.id;
      option.textContent = teacher.name;
      adminClassTeachersSelect.append(option);
    }
    updateAdminClassDetails();
  }

  function renderAdminClasses() {
    if (!adminClassSelect || !adminClassDetails) return;
    if (authUser?.role !== 'admin') {
      adminClassSelect.innerHTML = '<option value="">Kies een klas om te beheren</option>';
      adminClassSelect.disabled = true;
      adminClassDetails.innerHTML = '<p>Alleen beheerders kunnen klassen beheren.</p>';
      adminClassDetails.classList.add('admin-detail__body--empty');
      selectedAdminClassId = '';
      return;
    }
    const sortedClasses = [...classes].sort((a, b) =>
      a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' })
    );
    adminClassSelect.innerHTML = '<option value="">Kies een klas om te beheren</option>';
    for (const klass of sortedClasses) {
      const option = document.createElement('option');
      option.value = klass.id;
      option.textContent = klass.name;
      adminClassSelect.append(option);
    }
    adminClassSelect.disabled = !sortedClasses.length;
    if (!sortedClasses.length) {
      adminClassDetails.innerHTML = '<p>Nog geen klassen aangemaakt.</p>';
      adminClassDetails.classList.add('admin-detail__body--empty');
      selectedAdminClassId = '';
      return;
    }
    if (!sortedClasses.some((klass) => klass.id === selectedAdminClassId)) {
      selectedAdminClassId = '';
    }
    if (selectedAdminClassId) {
      adminClassSelect.value = selectedAdminClassId;
    } else {
      adminClassSelect.value = '';
    }
    updateAdminClassDetails();
  }

  function updateAdminClassDetails() {
    if (!adminClassDetails) return;
    adminClassDetails.innerHTML = '';
    adminClassDetails.classList.remove('admin-detail__body--empty');
    if (authUser?.role !== 'admin') {
      adminClassDetails.innerHTML = '<p>Alleen beheerders kunnen klassen beheren.</p>';
      adminClassDetails.classList.add('admin-detail__body--empty');
      return;
    }
    if (!classes.length) {
      adminClassDetails.innerHTML = '<p>Nog geen klassen aangemaakt.</p>';
      adminClassDetails.classList.add('admin-detail__body--empty');
      return;
    }
    if (!selectedAdminClassId) {
      adminClassDetails.innerHTML = '<p>Kies een klas om details te bekijken.</p>';
      adminClassDetails.classList.add('admin-detail__body--empty');
      return;
    }
    const klass = classes.find((entry) => entry.id === selectedAdminClassId);
    if (!klass) {
      adminClassDetails.innerHTML = '<p>Deze klas bestaat niet meer. Kies een andere klas.</p>';
      adminClassDetails.classList.add('admin-detail__body--empty');
      return;
    }
    const teacherNames = (klass.teacherIds || [])
      .map((teacherId) => teachers.find((teacher) => teacher.id === teacherId)?.name)
      .filter(Boolean);
    const teacherSummary = teacherNames.length
      ? `Docenten: ${teacherNames.join(', ')}`
      : 'Nog geen docenten gekoppeld.';
    let teacherOptions = teachers
      .map((teacher) => {
        const selected = (klass.teacherIds || []).includes(teacher.id) ? 'selected' : '';
        return `<option value="${teacher.id}" ${selected}>${teacher.name}</option>`;
      })
      .join('');
    if (!teachers.length) {
      teacherOptions = '<option value="">Geen docenten beschikbaar</option>';
    }
    const teacherSelectDisabled = teachers.length ? '' : ' disabled';
    const teacherHelp = teachers.length
      ? '<p class="hint">Houd Ctrl of Cmd ingedrukt om meerdere docenten te selecteren.</p>'
      : '<p class="hint">Maak eerst docentaccounts aan om ze te kunnen koppelen.</p>';

    const members = (klass.studentIds || [])
      .map((studentId) => students.find((student) => student.id === studentId))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));
    const memberList = members.length
      ? `<ul>${members
          .map(
            (member) =>
              `<li><span>${member.name}${member.grade ? ` (${member.grade})` : ''}</span><button type="button" class="btn btn--ghost" data-remove-from-class="true" data-class-id="${klass.id}" data-student-id="${member.id}">Verwijderen</button></li>`
          )
          .join('')}</ul>`
      : '<p class="hint">Nog geen leerlingen gekoppeld aan deze klas.</p>';

    const availableStudents = students
      .filter((student) => !(klass.studentIds || []).includes(student.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));
    const addSelectDisabled = availableStudents.length ? '' : ' disabled';
    const addOptions = availableStudents.length
      ? ['<option value="">Kies een leerling…</option>', ...availableStudents.map(
          (student) => `<option value="${student.id}">${student.name}${student.grade ? ` (${student.grade})` : ''}</option>`
        )].join('')
      : '<option value="">Geen vrije leerlingen beschikbaar</option>';
    const availableHint = availableStudents.length
      ? ''
      : '<p class="hint">Alle leerlingen zijn al gekoppeld aan deze klas.</p>';

    adminClassDetails.innerHTML = `
      <div class="admin-class-details__summary">
        <strong>${klass.name}</strong>
        <span>${klass.studentIds?.length || 0} leerlingen</span>
      </div>
      <p class="hint">${teacherSummary}</p>
      <form class="admin-class-details__form" data-class-teacher-form data-class-id="${klass.id}">
        <label for="admin-teachers-${klass.id}">Docenten koppelen</label>
        <select id="admin-teachers-${klass.id}" multiple size="4"${teacherSelectDisabled}>${teacherOptions}</select>
        ${teacherHelp}
        <div class="admin-class-details__actions">
          <button type="submit" class="btn btn--secondary"${teacherSelectDisabled}>Opslaan</button>
          <button type="button" class="btn btn--ghost" data-delete-class data-class-id="${klass.id}">Klas verwijderen</button>
        </div>
      </form>
      <div class="admin-class-details__students">
        <h5>Leerlingen in deze klas</h5>
        <form class="admin-class-details__add" data-add-student-to-class data-class-id="${klass.id}">
          <label class="visually-hidden" for="admin-class-add-${klass.id}">Leerling toevoegen aan ${klass.name}</label>
          <select id="admin-class-add-${klass.id}"${addSelectDisabled}>${addOptions}</select>
          <button type="submit" class="btn btn--secondary"${addSelectDisabled}>Toevoegen</button>
        </form>
        ${availableHint}
        ${memberList}
      </div>
    `;
  }

  function renderTeacherStudentClassSelect() {
    if (teacherStudentClassSelect) {
      const teacherClasses = authUser?.role === 'admin'
        ? classes
        : classes.filter((klass) => (klass.teacherIds || []).includes(authUser?.id));
      teacherStudentClassSelect.innerHTML = '<option value="">Kies een klas</option>';
      for (const klass of teacherClasses) {
        const option = document.createElement('option');
        option.value = klass.id;
        option.textContent = klass.name;
        teacherStudentClassSelect.append(option);
      }
      teacherStudentClassSelect.disabled = teacherClasses.length === 0;
    }
    if (adminStudentClassSelect) {
      const current = adminStudentClassSelect.value;
      adminStudentClassSelect.innerHTML = '<option value="">Geen klas koppelen</option>';
      for (const klass of classes) {
        const option = document.createElement('option');
        option.value = klass.id;
        option.textContent = klass.name;
        adminStudentClassSelect.append(option);
      }
      adminStudentClassSelect.value = current;
    }
  }

  function renderTeacherStudents() {
    if (!teacherStudentList) return;
    const allowed = authUser && (authUser.role === 'teacher' || authUser.role === 'admin');
    teacherStudentList.innerHTML = '';
    if (!allowed) {
      return;
    }
    const teacherClassIds = getTeacherClassIds();
    const relevantStudents = students.filter((student) =>
      (student.classIds || []).some((id) => teacherClassIds.includes(id))
    );
    if (!relevantStudents.length) {
      teacherStudentList.innerHTML =
        '<p>Nog geen leerlingen gekoppeld aan jouw klassen.</p>';
      return;
    }
    for (const student of relevantStudents) {
      const borrowed = student.borrowedBooks?.length || 0;
      const studentClasses = (student.classIds || [])
        .map((classId) => classes.find((klass) => klass.id === classId))
        .filter(Boolean);
      const sharedClassIds = (student.classIds || []).filter((classId) =>
        teacherClassIds.includes(classId)
      );

      const item = document.createElement('article');
      item.className = 'student-list__item';

      const title = document.createElement('strong');
      title.textContent = student.name;
      item.append(title);

      const metaLine = document.createElement('div');
      metaLine.className = 'student-list__meta';
      const usernameSpan = document.createElement('span');
      usernameSpan.textContent = `Gebruikersnaam: ${student.username}`;
      const gradeSpan = document.createElement('span');
      gradeSpan.textContent = `Klas: ${student.grade || 'Onbekend'}`;
      const borrowedSpan = document.createElement('span');
      borrowedSpan.textContent = `${borrowed} uitgeleende boek(en)`;
      metaLine.append(usernameSpan, gradeSpan, borrowedSpan);
      item.append(metaLine);

      const classesLine = document.createElement('div');
      classesLine.className = 'student-list__meta';
      const classesInfo = document.createElement('span');
      classesInfo.textContent = studentClasses.length
        ? `Gekoppeld aan: ${studentClasses.map((klass) => klass.name).join(', ')}`
        : 'Nog niet gekoppeld aan een klas';
      classesLine.append(classesInfo);
      item.append(classesLine);

      const actions = document.createElement('div');
      actions.className = 'student-list__actions';
      if (!sharedClassIds.length) {
        const note = document.createElement('span');
        note.className = 'hint';
        note.textContent = 'Geen gedeelde klassen om te beheren.';
        actions.append(note);
      } else {
        for (const classId of sharedClassIds) {
          const klass = classes.find((entry) => entry.id === classId);
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn btn--ghost';
          button.dataset.removeFromClass = 'true';
          button.dataset.classId = classId;
          button.dataset.studentId = student.id;
          button.textContent = klass ? `Uit ${klass.name} verwijderen` : 'Verwijderen uit klas';
          actions.append(button);
        }
      }
      item.append(actions);

      teacherStudentList.append(item);
    }
  }

  function renderAdminStudents() {
    if (!adminStudentList) return;
    if (!authUser || authUser.role !== 'admin') {
      adminStudentList.innerHTML = '';
      return;
    }
    adminStudentList.innerHTML = '';
    if (!students.length) {
      adminStudentList.innerHTML = '<p>Er zijn nog geen leerlingaccounts.</p>';
      return;
    }
    for (const student of students) {
      const borrowed = student.borrowedBooks?.length || 0;
      const studentClasses = (student.classIds || [])
        .map((classId) => classes.find((klass) => klass.id === classId))
        .filter(Boolean);

      const item = document.createElement('article');
      item.className = 'student-list__item';

      const title = document.createElement('strong');
      title.textContent = student.name;
      item.append(title);

      const metaLine = document.createElement('div');
      metaLine.className = 'student-list__meta';
      const usernameSpan = document.createElement('span');
      usernameSpan.textContent = `Gebruikersnaam: ${student.username}`;
      const gradeSpan = document.createElement('span');
      gradeSpan.textContent = `Klas: ${student.grade || 'Onbekend'}`;
      const borrowedSpan = document.createElement('span');
      borrowedSpan.textContent = `${borrowed} uitgeleende boek(en)`;
      metaLine.append(usernameSpan, gradeSpan, borrowedSpan);
      item.append(metaLine);

      const classesLine = document.createElement('div');
      classesLine.className = 'student-list__meta';
      const classesInfo = document.createElement('span');
      classesInfo.textContent = studentClasses.length
        ? `Gekoppeld aan: ${studentClasses.map((klass) => klass.name).join(', ')}`
        : 'Nog niet gekoppeld aan een klas';
      classesLine.append(classesInfo);
      item.append(classesLine);

      const actions = document.createElement('div');
      actions.className = 'student-list__actions';
      if (studentClasses.length) {
        for (const klass of studentClasses) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn btn--ghost';
          button.dataset.removeFromClass = 'true';
          button.dataset.classId = klass.id;
          button.dataset.studentId = student.id;
          button.textContent = `Uit ${klass.name} verwijderen`;
          actions.append(button);
        }
      }
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn btn--ghost';
      deleteButton.dataset.removeStudentAccount = 'true';
      deleteButton.dataset.studentId = student.id;
      deleteButton.textContent = 'Account verwijderen';
      actions.append(deleteButton);
      item.append(actions);

      adminStudentList.append(item);
    }
  }

  async function lookupBarcode(barcode, { silent = false, auto = false } = {}) {
    if (!barcode) return;
    const trimmed = barcode.trim();
    if (!trimmed) return;
    if (auto && adminBookIdInput?.value) {
      return;
    }
    if (adminBookLookupMessage && !silent) {
      adminBookLookupMessage.textContent = 'Zoeken naar boekinformatie…';
    }
    let sanitized = trimmed;
    const digitsOnly = trimmed.replace(/[^0-9X]/gi, '');
    if (digitsOnly) {
      sanitized = digitsOnly;
    }
    if (adminBookBarcode && adminBookBarcode.value !== sanitized) {
      adminBookBarcode.value = sanitized;
    }

    let existingBook = null;
    try {
      existingBook = await fetchJson(`/api/books/barcode/${sanitized}`);
    } catch (error) {
      if (!/geen boek gevonden/i.test(error.message || '')) {
        if (adminBookLookupMessage && !silent) {
          adminBookLookupMessage.textContent = error.message;
        }
        return;
      }
    }

    if (existingBook) {
      handleAdminBookSelection(existingBook, { silent: true });
      if (adminBookLookupMessage && !silent) {
        adminBookLookupMessage.textContent = 'Dit boek staat al in de bibliotheek. Gegevens zijn geladen.';
      }
      return;
    }

    try {
      const metadata = await fetchJson(`/api/isbn/${sanitized}`);
      cacheIsbnMetadata(metadata);
      if (metadata && metadata.barcode && adminBookBarcode) {
        adminBookBarcode.value = metadata.barcode;
      }
      applyBookMetadata(metadata);
      if (adminBookLookupMessage && !silent) {
        adminBookLookupMessage.textContent = metadata?.found
          ? 'Boekinformatie is automatisch ingevuld. Controleer de gegevens en vul aan waar nodig.'
          : 'Geen boekinformatie gevonden. Vul de gegevens handmatig in.';
      }
    } catch (error) {
      if (adminBookLookupMessage && !silent) {
        adminBookLookupMessage.textContent = error.message;
      }
    }
  }

  async function loadFolders() {
    folders = await fetchJson('/api/folders');
    setBookDetailFolders(folders);
    if (adminFolderSelect) {
      const current = adminFolderSelect.value;
      adminFolderSelect.innerHTML = '<option value="">Geen map</option>';
      for (const folder of folders) {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        adminFolderSelect.append(option);
      }
      adminFolderSelect.value = current;
    }
  }

  async function loadBooks() {
    allBooks = await fetchJson('/api/books');
    updateAvailableThemes();
    renderBooks();
    if (selectedBookId) {
      const selectedBook = allBooks.find((entry) => entry.id === selectedBookId);
      if (selectedBook) {
        populateAdminBookForm(selectedBook, { silent: true });
      } else {
        resetAdminBookForm();
      }
    }
  }

  async function loadSummary() {
    if (!summary) return;
    const data = await fetchJson('/api/status');
    summary.innerHTML = '';
    const items = [
      { label: 'Totaal', value: data.totalBooks },
      { label: 'Beschikbaar', value: data.availableBooks },
      { label: 'Uitgeleend', value: data.borrowedBooks },
      { label: 'Leeslijst', value: data.examListBooks },
    ];
    for (const item of items) {
      const div = document.createElement('div');
      div.className = 'summary__item';
      div.innerHTML = `${item.value}<span>${item.label}</span>`;
      summary.append(div);
    }
  }

  async function loadHistory() {
    if (!historyList) return;
    try {
      const entries = await fetchJson('/api/history?limit=10');
      historyList.innerHTML = '';
      for (const entry of entries) {
        const li = document.createElement('li');
        li.className = 'history-item';
        const time = new Date(entry.timestamp).toLocaleString('nl-NL', {
          dateStyle: 'short',
          timeStyle: 'short',
        });
        li.innerHTML = `
          <span class="history-item__time">${time}</span>
          <span>${entry.message}</span>
        `;
        historyList.append(li);
      }
    } catch (error) {
      historyList.innerHTML = `<li class="history-item">${error.message}</li>`;
    }
  }

  async function loadStudents() {
    students = await fetchJson('/api/students');
    renderTeacherStudents();
    renderAdminStudents();
  }

  function renderClasses() {
    if (!classList) return;
    classList.innerHTML = '';
    const loggedIn = authUser && (authUser.role === 'teacher' || authUser.role === 'admin');
    if (!loggedIn) return;
    if (!classes.length) {
      classList.innerHTML = '<p>Je hebt nog geen klassen. Maak er één aan om te starten.</p>';
      return;
    }
    for (const klass of classes) {
      const article = document.createElement('article');
      article.className = 'class-card';

      const header = document.createElement('header');
      header.className = 'class-card__header';
      header.innerHTML = `<h4>${klass.name}</h4><span>${klass.studentIds?.length || 0} leerlingen</span>`;
      article.append(header);

      const memberList = document.createElement('ul');
      memberList.className = 'class-card__students';
      const members = (klass.studentIds || [])
        .map((id) => students.find((student) => student.id === id))
        .filter(Boolean);
      if (!members.length) {
        const li = document.createElement('li');
        li.textContent = 'Nog geen leerlingen gekoppeld.';
        memberList.append(li);
      } else {
        for (const member of members) {
          const li = document.createElement('li');
          li.innerHTML = `
            <div>
              <strong>${member.name}</strong>
              <span>${member.grade || 'klas onbekend'}</span>
              ${member.borrowedBooks?.length ? `<span>${member.borrowedBooks.length} boek(en) mee</span>` : ''}
            </div>
            <button
              class="btn btn--ghost"
              data-remove-student
              data-class-id="${klass.id}"
              data-student-id="${member.id}"
              type="button"
            >Verwijderen</button>
          `;
          memberList.append(li);
        }
      }
      article.append(memberList);

      if (authUser?.role === 'admin') {
        const form = document.createElement('form');
        form.className = 'class-card__form';
        const availableStudents = students.filter(
          (student) => !(klass.studentIds || []).includes(student.id)
        );
        const options = [
          '<option value="">Kies een leerling…</option>',
          ...availableStudents.map(
            (student) =>
              `<option value="${student.id}">${student.name} (${student.grade || 'leerling'})</option>`
          ),
        ].join('');
        form.innerHTML = `
          <label for="add-${klass.id}">Leerling toevoegen</label>
          <select id="add-${klass.id}" required>${options}</select>
          <button type="submit" class="btn btn--secondary">Toevoegen</button>
        `;
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const select = form.querySelector('select');
          if (!select?.value) return;
          try {
            await fetchJson(`/api/classes/${klass.id}/students`, {
              method: 'POST',
              body: { studentId: select.value },
            });
            if (classMessage) {
              classMessage.textContent = 'Leerling gekoppeld aan de klas.';
            }
            await refreshStaffData();
          } catch (error) {
            if (classMessage) {
              classMessage.textContent = error.message;
            }
          }
        });
        article.append(form);
      }

      classList.append(article);
    }
  }

  async function loadClasses() {
    classes = await fetchJson('/api/classes');
    renderClasses();
    renderTeacherStudentClassSelect();
    renderAdminClasses();
    renderTeacherStudents();
    renderAdminStudents();
  }

  async function loadTeachers() {
    if (!authUser || authUser.role !== 'admin') {
      teachers = [];
      renderAdminTeacherSelect();
      return;
    }
    teachers = await fetchJson('/api/teachers');
    renderAdminTeacherSelect();
    renderAdminClasses();
  }

  async function refreshStaffData() {
    const loggedIn = authUser && (authUser.role === 'teacher' || authUser.role === 'admin');
    if (!loggedIn) return;
    await Promise.all([loadFolders(), loadBooks(), loadSummary()]);
    await loadStudents();
    if (authUser.role === 'admin') {
      await loadTeachers();
    } else {
      teachers = [];
      renderAdminTeacherSelect();
    }
    await loadClasses();
    await loadHistory();
  }

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = loginUsername.value.trim();
    const password = loginPassword.value;
    if (!username || !password) {
      loginMessage.textContent = 'Vul je gebruikersnaam en wachtwoord in.';
      return;
    }
    try {
      const result = await fetchJson('/api/login', {
        method: 'POST',
        body: { username, password },
      });
      if (!['teacher', 'admin'].includes(result.user.role)) {
        clearAuth({ silent: true });
        loginMessage.textContent = 'Gebruik de leerlingenpagina om in te loggen.';
        return;
      }
      setAuth(result.token);
      await reloadCurrentUser(['teacher', 'admin']);
      loginForm.reset();
      loginMessage.textContent = `Welkom ${authUser.name}!`;
      await refreshStaffData();
    } catch (error) {
      loginMessage.textContent = error.message;
    }
  });

  logoutButton?.addEventListener('click', async () => {
    if (!authToken) return;
    try {
      await fetchJson('/api/logout', { method: 'POST' });
    } catch (error) {
      // negeer
    }
    clearAuth();
    loginMessage.textContent = 'Je bent uitgelogd.';
  });

  searchInput?.addEventListener('input', () => {
    filters.query = searchInput.value;
    renderBooks();
  });

  classList?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-student]');
    if (!button) return;
    const classId = button.dataset.classId;
    const studentId = button.dataset.studentId;
    if (!classId || !studentId) return;
    if (!authUser || !['teacher', 'admin'].includes(authUser.role)) {
      if (classMessage) {
        classMessage.textContent = 'Alleen medewerkers kunnen leerlingen beheren.';
      }
      return;
    }
    if (!window.confirm('Leerling uit deze klas verwijderen?')) {
      return;
    }
    try {
      await fetchJson(`/api/classes/${classId}/students/${studentId}`, { method: 'DELETE' });
      if (classMessage) {
        const klass = classes.find((entry) => entry.id === classId);
        classMessage.textContent = klass
          ? `Leerling verwijderd uit ${klass.name}.`
          : 'Leerling verwijderd uit de klas.';
      }
      resetAdminBookForm();
      await refreshStaffData();
    } catch (error) {
      if (adminBookMessage) {
        adminBookMessage.textContent = error.message;
      }
    }
  });

  adminBookLookupButton?.addEventListener('click', () => {
    const value = adminBookBarcode?.value?.trim();
    if (!value) {
      if (adminBookLookupMessage) {
        adminBookLookupMessage.textContent = 'Scan of typ eerst een barcode.';
      }
      return;
    }
    lookupBarcode(value);
  });

  adminBookBarcode?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const value = adminBookBarcode.value.trim();
      if (value) {
        lookupBarcode(value);
      }
    }
  });

  adminBookBarcode?.addEventListener('input', () => {
    if (barcodeLookupTimer) {
      clearTimeout(barcodeLookupTimer);
    }
    const value = adminBookBarcode.value.trim();
    if (!value || value.length < 8) {
      return;
    }
    barcodeLookupTimer = setTimeout(() => {
      lookupBarcode(value, { silent: true, auto: true });
    }, 400);
  });

  adminClassForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser || authUser.role !== 'admin') {
      adminClassMessage.textContent = 'Alleen beheerders kunnen klassen beheren.';
      return;
    }
    const name = adminClassNameInput.value.trim();
    const teacherIds = Array.from(adminClassTeachersSelect?.selectedOptions || [])
      .map((option) => option.value)
      .filter(Boolean);
    if (!name) {
      adminClassMessage.textContent = 'Geef een naam op voor de klas.';
      return;
    }
    try {
      await fetchJson('/api/classes', {
        method: 'POST',
        body: { name, teacherIds },
      });
      adminClassForm.reset();
      adminClassMessage.textContent = 'Klas opgeslagen.';
      await refreshStaffData();
    } catch (error) {
      adminClassMessage.textContent = error.message;
    }
  });

  adminClassSelect?.addEventListener('change', () => {
    if (!authUser || authUser.role !== 'admin') {
      return;
    }
    selectedAdminClassId = adminClassSelect.value || '';
    updateAdminClassDetails();
  });

  adminClassDetails?.addEventListener('submit', async (event) => {
    const teacherForm = event.target.closest('[data-class-teacher-form]');
    if (teacherForm) {
      event.preventDefault();
      if (!authUser || authUser.role !== 'admin') {
        adminClassMessage.textContent = 'Alleen beheerders kunnen docenten koppelen.';
        return;
      }
      const classId = teacherForm.dataset.classId;
      const select = teacherForm.querySelector('select');
      const teacherIds = Array.from(select?.selectedOptions || [])
        .map((option) => option.value)
        .filter(Boolean);
      try {
        await fetchJson(`/api/classes/${classId}`, {
          method: 'PATCH',
          body: { teacherIds },
        });
        adminClassMessage.textContent = 'Docenten bijgewerkt voor deze klas.';
        await refreshStaffData();
      } catch (error) {
        adminClassMessage.textContent = error.message;
      }
      return;
    }

    const addForm = event.target.closest('[data-add-student-to-class]');
    if (addForm) {
      event.preventDefault();
      if (!authUser || authUser.role !== 'admin') {
        adminClassMessage.textContent = 'Alleen beheerders kunnen leerlingen koppelen.';
        return;
      }
      const classId = addForm.dataset.classId;
      const select = addForm.querySelector('select');
      const studentId = select?.value;
      if (!classId || !studentId) {
        adminClassMessage.textContent = 'Kies eerst een leerling.';
        return;
      }
      const klass = classes.find((entry) => entry.id === classId);
      try {
        await fetchJson(`/api/classes/${classId}/students`, {
          method: 'POST',
          body: { studentId },
        });
        adminClassMessage.textContent = klass
          ? `Leerling toegevoegd aan ${klass.name}.`
          : 'Leerling gekoppeld aan de klas.';
        await refreshStaffData();
      } catch (error) {
        adminClassMessage.textContent = error.message;
      }
    }
  });

  adminClassDetails?.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('[data-delete-class]');
    if (deleteButton) {
      if (!authUser || authUser.role !== 'admin') {
        adminClassMessage.textContent = 'Alleen beheerders kunnen klassen verwijderen.';
        return;
      }
      const classId = deleteButton.dataset.classId;
      if (!classId) return;
      event.preventDefault();
      if (!window.confirm('Weet je zeker dat je deze klas wilt verwijderen?')) {
        return;
      }
      try {
        await fetchJson(`/api/classes/${classId}`, { method: 'DELETE' });
        adminClassMessage.textContent = 'Klas verwijderd.';
        await refreshStaffData();
      } catch (error) {
        adminClassMessage.textContent = error.message;
      }
      return;
    }

    const removeStudentButton = event.target.closest('[data-remove-from-class]');
    if (removeStudentButton) {
      if (!authUser || authUser.role !== 'admin') {
        adminClassMessage.textContent = 'Alleen beheerders kunnen leerlingen verwijderen.';
        return;
      }
      const classId = removeStudentButton.dataset.classId;
      const studentId = removeStudentButton.dataset.studentId;
      if (!classId || !studentId) return;
      const klass = classes.find((entry) => entry.id === classId);
      if (!window.confirm('Leerling uit deze klas verwijderen?')) {
        return;
      }
      try {
        await fetchJson(`/api/classes/${classId}/students/${studentId}`, { method: 'DELETE' });
        adminClassMessage.textContent = klass
          ? `Leerling verwijderd uit ${klass.name}.`
          : 'Leerling verwijderd uit de klas.';
        await refreshStaffData();
      } catch (error) {
        adminClassMessage.textContent = error.message;
      }
    }
  });

  teacherStudentForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser || !['teacher', 'admin'].includes(authUser.role)) {
      teacherStudentMessage.textContent = 'Alleen docenten of beheerders kunnen leerlingen koppelen.';
      return;
    }
    const classId = teacherStudentClassSelect?.value || '';
    const username = teacherStudentUsernameInput?.value?.trim() || '';
    if (!classId) {
      teacherStudentMessage.textContent = 'Kies eerst een klas.';
      return;
    }
    if (!username) {
      teacherStudentMessage.textContent = 'Vul een gebruikersnaam in.';
      return;
    }
    const teacherClassIds = getTeacherClassIds();
    if (authUser.role === 'teacher' && !teacherClassIds.includes(classId)) {
      teacherStudentMessage.textContent = 'Je kunt alleen leerlingen aan je eigen klassen koppelen.';
      return;
    }
    try {
      const result = await fetchJson(`/api/classes/${classId}/students`, {
        method: 'POST',
        body: { username },
      });
      if (teacherStudentUsernameInput) {
        teacherStudentUsernameInput.value = '';
        teacherStudentUsernameInput.focus();
      }
      const klass = classes.find((entry) => entry.id === classId);
      const studentName = result?.student?.name || username;
      teacherStudentMessage.textContent = klass
        ? `${studentName} is gekoppeld aan ${klass.name}.`
        : `${studentName} is gekoppeld.`;
      await refreshStaffData();
    } catch (error) {
      teacherStudentMessage.textContent = error.message;
    }
  });

  teacherStudentList?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-from-class]');
    if (!button) return;
    if (!authUser || !['teacher', 'admin'].includes(authUser.role)) {
      teacherStudentMessage.textContent = 'Alleen docenten of beheerders kunnen leerlingen beheren.';
      return;
    }
    const classId = button.dataset.classId;
    const studentId = button.dataset.studentId;
    if (!classId || !studentId) return;
    const klass = classes.find((entry) => entry.id === classId);
    if (!window.confirm('Leerling uit deze klas verwijderen?')) {
      return;
    }
    try {
      await fetchJson(`/api/classes/${classId}/students/${studentId}`, { method: 'DELETE' });
      teacherStudentMessage.textContent = klass
        ? `Leerling verwijderd uit ${klass.name}.`
        : 'Leerling verwijderd uit de klas.';
      await refreshStaffData();
    } catch (error) {
      teacherStudentMessage.textContent = error.message;
    }
  });

  adminStudentList?.addEventListener('click', async (event) => {
    const removeFromClassButton = event.target.closest('[data-remove-from-class]');
    if (removeFromClassButton) {
      if (!authUser || authUser.role !== 'admin') {
        adminStudentMessage.textContent = 'Alleen beheerders kunnen klas-koppelingen wijzigen.';
        return;
      }
      const classId = removeFromClassButton.dataset.classId;
      const studentId = removeFromClassButton.dataset.studentId;
      if (!classId || !studentId) return;
      const klass = classes.find((entry) => entry.id === classId);
      try {
        await fetchJson(`/api/classes/${classId}/students/${studentId}`, { method: 'DELETE' });
        adminStudentMessage.textContent = klass
          ? `Leerling verwijderd uit ${klass.name}.`
          : 'Leerling verwijderd uit de klas.';
        await refreshStaffData();
      } catch (error) {
        adminStudentMessage.textContent = error.message;
      }
      return;
    }

    const deleteButton = event.target.closest('[data-remove-student-account]');
    if (!deleteButton) return;
    if (!authUser || authUser.role !== 'admin') {
      adminStudentMessage.textContent = 'Alleen beheerders kunnen leerlingaccounts verwijderen.';
      return;
    }
    const studentId = deleteButton.dataset.studentId;
    if (!studentId) return;
    if (!window.confirm('Weet je zeker dat je dit leerlingaccount wilt verwijderen?')) {
      return;
    }
    try {
      await fetchJson(`/api/students/${studentId}`, { method: 'DELETE' });
      adminStudentMessage.textContent = 'Leerlingaccount verwijderd.';
      await refreshStaffData();
    } catch (error) {
      adminStudentMessage.textContent = error.message;
    }
  });

  adminBookForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser || authUser.role !== 'admin') {
      adminBookMessage.textContent = 'Alleen beheerders kunnen boeken toevoegen.';
      return;
    }
    const payload = {
      title: adminBookTitle.value.trim(),
      author: adminBookAuthor.value.trim(),
      barcode: adminBookBarcode.value.trim(),
      folderId: adminFolderSelect.value || null,
      suitableForExamList: Boolean(adminBookExam.checked),
      description: adminBookDescription.value.trim(),
    };
    if (!payload.title || !payload.author || !payload.barcode) {
      adminBookMessage.textContent = 'Titel, auteur en barcode zijn verplicht.';
      return;
    }
    try {
      const bookId = adminBookIdInput?.value?.trim();
      const url = bookId ? `/api/books/${bookId}` : '/api/books';
      const method = bookId ? 'PUT' : 'POST';
      await fetchJson(url, {
        method,
        body: payload,
      });
      adminBookMessage.textContent = bookId
        ? 'Boek bijgewerkt in de bibliotheek.'
        : 'Boek opgeslagen in de bibliotheek.';
      resetAdminBookForm();
      await refreshStaffData();
    } catch (error) {
      adminBookMessage.textContent = error.message;
    }
  });

  adminStudentForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser || authUser.role !== 'admin') {
      adminStudentMessage.textContent = 'Alleen beheerders kunnen leerlingaccounts aanmaken.';
      return;
    }
    const name = adminStudentNameInput?.value?.trim() || '';
    const username = adminStudentUsernameInput?.value?.trim() || '';
    const password = adminStudentPasswordInput?.value?.trim() || '';
    const grade = adminStudentGradeInput?.value?.trim() || '';
    const classId = adminStudentClassSelect?.value || '';
    if (!name || !username || !password) {
      adminStudentMessage.textContent = 'Naam, gebruikersnaam en wachtwoord zijn verplicht.';
      return;
    }
    const payload = {
      name,
      username,
      password,
      grade,
      classIds: classId ? [classId] : [],
    };
    try {
      const result = await fetchJson('/api/students', {
        method: 'POST',
        body: payload,
      });
      adminStudentForm.reset();
      adminStudentMessage.textContent = `Leerling aangemaakt. Tijdelijk wachtwoord: ${
        result?.temporaryPassword || password
      }.`;
      await refreshStaffData();
    } catch (error) {
      adminStudentMessage.textContent = error.message;
    }
  });

  studentImportForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser || authUser.role !== 'admin') {
      studentImportMessage.textContent = 'Alleen beheerders kunnen leerlingen importeren.';
      return;
    }
    const file = studentImportFile?.files?.[0];
    if (!file) {
      studentImportMessage.textContent = 'Kies eerst een Excelbestand.';
      return;
    }
    try {
      const base64 = await readFileAsBase64(file);
      const result = await fetchJson('/api/students/import', {
        method: 'POST',
        body: { file: base64 },
      });
      studentImportFile.value = '';
      studentImportMessage.textContent = `Import gereed: ${result.created} toegevoegd, ${result.updated} bijgewerkt.`;
      if (studentImportResults) {
        studentImportResults.innerHTML = '';
        if (result.accounts?.length) {
          const list = document.createElement('ul');
          list.className = 'import-results__list';
          for (const account of result.accounts) {
            const li = document.createElement('li');
            li.innerHTML = `
              <strong>${account.name}</strong> – ${account.username}
              ${account.password ? `<span>Nieuw wachtwoord: ${account.password}</span>` : ''}
            `;
            list.append(li);
          }
          studentImportResults.append(list);
        }
        if (result.skipped?.length) {
          const skippedList = document.createElement('ul');
          skippedList.className = 'import-results__skipped';
          for (const entry of result.skipped) {
            const li = document.createElement('li');
            li.textContent = `${entry.name} (${entry.username}) – ${entry.reason}`;
            skippedList.append(li);
          }
          const skippedTitle = document.createElement('h4');
          skippedTitle.textContent = 'Overgeslagen regels';
          studentImportResults.append(skippedTitle, skippedList);
        }
      }
      await refreshStaffData();
    } catch (error) {
      studentImportMessage.textContent = error.message;
    }
  });

  renderThemeFilters();
  renderStaffState();
  Promise.all([loadFolders(), loadBooks(), loadSummary()]).catch(() => {});
  if (authToken) {
    reloadCurrentUser(['teacher', 'admin'])
      .then(refreshStaffData)
      .catch(() => {
        clearAuth();
      });
  }
}

if (pageType === 'student') {
  initStudentPage();
} else if (pageType === 'staff') {
  initStaffPage();
}
