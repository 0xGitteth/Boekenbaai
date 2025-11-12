const metaApiBase = document.querySelector('meta[name="boekenbaai-api-base"]');
const apiBase = (
  (typeof window !== 'undefined' && window.BOEKENBAAI_API_BASE) ||
  metaApiBase?.content ||
  ''
).trim();
const pageType = document.body?.dataset.page || 'student';
const bookCardTemplate = document.querySelector('#book-card-template');
let authToken = localStorage.getItem('boekenbaai_token') || null;
let authUser = null;
let updateAuthUi = () => {};
let passwordChangeController = null;

function appendElement(parent, tag, options = {}) {
  const element = document.createElement(tag);
  if (options && typeof options === 'object') {
    const {
      className,
      classList,
      dataset,
      aria,
      text,
      textContent,
      html,
      innerHTML,
      attributes,
      attrs,
      style,
      ...rest
    } = options;

    if (className) {
      element.className = className;
    }
    if (Array.isArray(classList) && classList.length) {
      element.classList.add(...classList.filter(Boolean));
    }
    if (dataset && typeof dataset === 'object') {
      for (const [key, value] of Object.entries(dataset)) {
        if (value != null) {
          element.dataset[key] = value;
        }
      }
    }
    const ariaEntries =
      aria && typeof aria === 'object' ? Object.entries(aria) : [];
    for (const [key, value] of ariaEntries) {
      if (value != null) {
        element.setAttribute(`aria-${key}`, value);
      }
    }
    const attrEntries =
      attributes && typeof attributes === 'object'
        ? Object.entries(attributes)
        : attrs && typeof attrs === 'object'
        ? Object.entries(attrs)
        : [];
    for (const [key, value] of attrEntries) {
      if (value != null) {
        element.setAttribute(key, value);
      }
    }
    if (style && typeof style === 'object') {
      Object.assign(element.style, style);
    }
    if (text != null) {
      element.textContent = `${text}`;
    } else if (textContent != null) {
      element.textContent = `${textContent}`;
    }
    if (html != null) {
      element.innerHTML = html;
    } else if (innerHTML != null) {
      element.innerHTML = innerHTML;
    }
    for (const [key, value] of Object.entries(rest)) {
      if (value == null) {
        continue;
      }
      if (key === 'class' || key === 'className') {
        continue;
      }
      if (key in element) {
        try {
          element[key] = value;
        } catch (error) {
          element.setAttribute(key, value);
        }
      } else {
        const attributeName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        element.setAttribute(attributeName, value);
      }
    }
  }
  parent?.append(element);
  return element;
}

function appendTextElement(parent, tag, text, options = {}) {
  return appendElement(parent, tag, { ...options, text });
}

function replaceWithTextElement(container, tag, text, options = {}) {
  if (!container) {
    return null;
  }
  container.innerHTML = '';
  return appendTextElement(container, tag, text, options);
}

function setAuth(token) {
  authToken = token;
  localStorage.setItem('boekenbaai_token', token);
}

function clearAuth({ silent = false } = {}) {
  authToken = null;
  authUser = null;
  localStorage.removeItem('boekenbaai_token');
  closeBookDetail();
  passwordChangeController?.handleAuthChange(null);
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
  passwordChangeController?.handleAuthChange(authUser);
  return me;
}

function initPasswordChangeDialog() {
  const container = document.querySelector('#password-change-modal');
  if (!container) {
    return {
      handleAuthChange() {},
    };
  }
  const form = container.querySelector('#password-change-form');
  const currentInput = container.querySelector('#password-change-current');
  const newInput = container.querySelector('#password-change-new');
  const confirmInput = container.querySelector('#password-change-confirm');
  const messageEl = container.querySelector('#password-change-message');
  const submitButton = container.querySelector('#password-change-submit');
  const logoutButton = container.querySelector('#password-change-logout');
  const descriptionEl = container.querySelector('#password-change-description');

  let submitting = false;
  let visibleForUserId = null;
  let isVisible = false;

  function setMessage(message) {
    if (messageEl) {
      messageEl.textContent = message || '';
    }
  }

  function focusCurrent() {
    if (currentInput) {
      currentInput.focus();
    }
  }

  function openForUser(user) {
    if (!user) {
      return;
    }
    const sameUser = visibleForUserId === user.id;
    visibleForUserId = user.id;
    if (!sameUser) {
      form?.reset();
      setMessage('');
      submitting = false;
      submitButton?.removeAttribute('disabled');
    }
    if (descriptionEl) {
      const displayName = user.name ? ` ${user.name}` : '';
      descriptionEl.textContent = `Hallo${displayName}, voor jouw veiligheid moet je nu een nieuw wachtwoord instellen voordat je verder gaat.`;
    }
    container.classList.remove('hidden');
    container.setAttribute('aria-hidden', 'false');
    isVisible = true;
    if (!sameUser) {
      setTimeout(focusCurrent, 50);
    }
  }

  function closeDialog() {
    if (!isVisible && !visibleForUserId) {
      return;
    }
    container.classList.add('hidden');
    container.setAttribute('aria-hidden', 'true');
    isVisible = false;
    visibleForUserId = null;
    form?.reset();
    setMessage('');
    submitting = false;
    submitButton?.removeAttribute('disabled');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const currentPassword = currentInput?.value || '';
    const newPassword = newInput?.value || '';
    const confirmPassword = confirmInput?.value || '';
    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage('Vul alle velden in.');
      if (!currentPassword) {
        focusCurrent();
      }
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage('De nieuwe wachtwoorden komen niet overeen.');
      confirmInput?.focus();
      return;
    }
    if (newPassword.length < 6) {
      setMessage('Gebruik een nieuw wachtwoord van minimaal 6 tekens.');
      newInput?.focus();
      return;
    }

    submitting = true;
    submitButton?.setAttribute('disabled', 'true');
    setMessage('Wachtwoord wordt gewijzigd…');

    try {
      await fetchJson('/api/account/password', {
        method: 'PATCH',
        body: {
          currentPassword,
          newPassword,
          clearMustChange: true,
        },
      });
      setMessage('Wachtwoord gewijzigd.');
      const expectedRoles =
        authUser?.role === 'student'
          ? ['student']
          : authUser?.role === 'teacher' || authUser?.role === 'admin'
          ? ['teacher', 'admin']
          : null;
      await reloadCurrentUser(expectedRoles || undefined);
      if (!authUser?.mustChangePassword) {
        closeDialog();
      }
    } catch (error) {
      setMessage(error.message || 'Het wijzigen is mislukt.');
    } finally {
      if (isVisible) {
        submitting = false;
        submitButton?.removeAttribute('disabled');
      }
    }
  }

  form?.addEventListener('submit', handleSubmit);

  logoutButton?.addEventListener('click', async () => {
    if (submitting) {
      return;
    }
    try {
      await fetchJson('/api/logout', { method: 'POST' });
    } catch (error) {
      // negeer fout, sessie kan al verlopen zijn
    }
    clearAuth();
    closeDialog();
  });

  return {
    handleAuthChange(user) {
      if (!user || !user.mustChangePassword) {
        closeDialog();
        return;
      }
      openForUser(user);
    },
  };
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
      const li = appendTextElement(state.tags, 'li', tag, {
        className: 'book-detail__tag',
      });
      const { background, text: textColor, border } = resolveThemeColors(tag);
      li.style.setProperty('--theme-pill-bg', background);
      li.style.setProperty('--theme-pill-text', textColor);
      li.style.setProperty('--theme-pill-border', border);
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

  const fragment = document.createDocumentFragment();

  const examButton = appendTextElement(fragment, 'button', 'Leeslijst', {
    className: 'filters__pill filters__pill--exam',
    type: 'button',
  });
  const examActive = Boolean(onlyExamList);
  examButton.classList.toggle('filters__pill--active', examActive);
  examButton.setAttribute('aria-pressed', examActive ? 'true' : 'false');
  examButton.addEventListener('click', () => {
    if (typeof onToggleExam === 'function') {
      onToggleExam(!examActive);
    }
  });

  const isThemeSelected = (key) => {
    if (!key) return false;
    if (selectedThemes instanceof Set) {
      return selectedThemes.has(key);
    }
    return Array.isArray(selectedThemes) ? selectedThemes.includes(key) : false;
  };

  if (!themes.length) {
    appendTextElement(fragment, 'span', "Geen thema's beschikbaar", {
      className: 'filters__pill-placeholder',
    });
  } else {
    for (const entry of themes) {
      const label = typeof entry === 'string' ? entry : entry.label;
      const key = typeof entry === 'string' ? normalizeThemeKey(entry) : entry.key;
      if (!key || !label) continue;
      const button = appendTextElement(fragment, 'button', label, {
        className: 'filters__pill',
        type: 'button',
      });
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
    }
  }

  const hasSelection = Boolean(
    (selectedThemes instanceof Set && selectedThemes.size > 0) ||
      (Array.isArray(selectedThemes) && selectedThemes.length > 0) ||
      onlyExamList
  );
  if (hasSelection) {
    const clearButton = appendTextElement(fragment, 'button', 'Wis selectie', {
      className: 'filters__pill filters__pill--clear',
      type: 'button',
    });
    clearButton.addEventListener('click', () => {
      if (typeof onClear === 'function') {
        onClear();
      }
    });
  }

  container.innerHTML = '';
  container.append(fragment);
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
      const li = appendTextElement(tagsList, 'li', tag, {
        className: 'book-card__tag',
      });
      const { background, text, border } = resolveThemeColors(tag);
      li.style.setProperty('--theme-pill-bg', background);
      li.style.setProperty('--theme-pill-text', text);
      li.style.setProperty('--theme-pill-border', border);
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
    borrowedList.replaceChildren();
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
      const li = appendElement(borrowedList, 'li', {
        className: 'borrowed-list__item',
      });
      appendTextElement(li, 'strong', book ? book.title : 'Onbekend boek');
      if (book?.author) {
        li.append(' ');
        appendTextElement(li, 'span', book.author);
      }
      if (item.borrowedAt) {
        li.append(' ');
        appendTextElement(li, 'span', `Sinds ${formatDate(item.borrowedAt)}`);
      }
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
      replaceWithTextElement(
        bookResult,
        'p',
        'Log in en scan een boek om te starten.',
        { className: 'book-result__status' }
      );
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
      studentGrade.textContent = loggedIn && authUser.grade ? `Klas ${authUser.grade}` : '';
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
    bookGrid.replaceChildren();
    if (!filtered.length) {
      replaceWithTextElement(bookGrid, 'p', 'Geen boeken gevonden voor deze selectie.');
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
    summary.replaceChildren();
    const items = [
      { label: 'Totaal', value: data.totalBooks },
      { label: 'Beschikbaar', value: data.availableBooks },
      { label: 'Uitgeleend', value: data.borrowedBooks },
      { label: 'Leeslijst', value: data.examListBooks },
    ];
    for (const item of items) {
      const div = appendElement(summary, 'div', { className: 'summary__item' });
      if (!div) continue;
      div.append(document.createTextNode(String(item.value ?? '')));
      appendTextElement(div, 'span', item.label);
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
        replaceWithTextElement(bookResult, 'p', error.message, {
          className: 'book-result__status',
        });
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
    bookResult.replaceChildren();
    appendTextElement(bookResult, 'h3', currentBook.title);
    if (currentBook.author) {
      appendTextElement(bookResult, 'p', currentBook.author);
    }
    appendTextElement(bookResult, 'p', statusText, {
      className: 'book-result__status',
    });
    if (currentBook.description) {
      appendTextElement(bookResult, 'p', currentBook.description);
    }
    const folderParagraph = appendElement(bookResult, 'p');
    const folderLabel = appendTextElement(folderParagraph, 'strong', 'Map:');
    if (folderLabel) {
      folderParagraph.append(' ');
    }
    folderParagraph.append(document.createTextNode(folder ? folder.name : 'Geen map'));

    const barcodeParagraph = appendElement(bookResult, 'p');
    const barcodeLabel = appendTextElement(barcodeParagraph, 'strong', 'Barcode:');
    if (barcodeLabel) {
      barcodeParagraph.append(' ');
    }
    barcodeParagraph.append(document.createTextNode(currentBook.barcode || ''));

    if (currentBook.suitableForExamList) {
      const examParagraph = appendElement(bookResult, 'p');
      appendTextElement(examParagraph, 'strong', '✔ Op de leeslijst');
    }
    const actions = appendElement(bookResult, 'div', {
      className: 'book-result__actions',
    });
    if (currentBook.status === 'available' && loggedIn) {
      const borrowBtn = appendTextElement(actions, 'button', 'Ik leen dit boek', {
        className: 'btn',
        type: 'button',
      });
      borrowBtn.addEventListener('click', () => handleBorrow(currentBook));
    }
    if (borrowedByStudent) {
      const returnBtn = appendTextElement(actions, 'button', 'Ik breng het terug', {
        className: 'btn btn--secondary',
        type: 'button',
      });
      returnBtn.addEventListener('click', () => handleReturn(currentBook));
    }
    if (borrowedByOther) {
      appendTextElement(
        actions,
        'p',
        'Het boek is nu uitgeleend. Vraag de mediatheek om hulp als je het nodig hebt.',
        { className: 'hint' }
      );
    }
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
        bookResult.innerHTML = '';
        const message = appendElement(bookResult, 'p', {
          className: 'book-result__status',
        });
        message.append('Veel leesplezier met ');
        appendTextElement(message, 'strong', result.book.title);
        message.append('!');
      }
    } catch (error) {
      if (bookResult) {
        replaceWithTextElement(bookResult, 'p', error.message, {
          className: 'book-result__status',
        });
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
        bookResult.innerHTML = '';
        const message = appendElement(bookResult, 'p', {
          className: 'book-result__status',
        });
        message.append('Bedankt! ');
        appendTextElement(message, 'strong', result.book.title);
        message.append(' is weer beschikbaar.');
      }
    } catch (error) {
      if (bookResult) {
        replaceWithTextElement(bookResult, 'p', error.message, {
          className: 'book-result__status',
        });
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
  const adminTeacherMessage = document.querySelector('#admin-teacher-message');
  const adminTeacherList = document.querySelector('#admin-teacher-list');
  const adminTeacherResetInfo = document.querySelector('#admin-teacher-reset');
  const adminClassForm = document.querySelector('#admin-class-form');
  const adminClassNameInput = document.querySelector('#admin-class-name');
  const adminClassTeachersSelect = document.querySelector('#admin-class-teachers');
  const adminClassMessage = document.querySelector('#admin-class-message');
  const adminClassList = document.querySelector('#admin-class-list');
  const adminClassSelect = document.querySelector('#admin-class-select');
  const adminClassDetails = document.querySelector('#admin-class-details');
  const adminStudentForm = document.querySelector('#admin-student-form');
  const adminStudentNameInput = document.querySelector('#admin-student-name');
  const adminStudentUsernameInput = document.querySelector('#admin-student-username');
  const adminStudentPasswordInput = document.querySelector('#admin-student-password');
  const adminStudentGradeInput = document.querySelector('#admin-student-grade');
  const adminStudentClassSelect = document.querySelector('#admin-student-class');
  const adminStudentMessage = document.querySelector('#admin-student-message');
  const adminStudentList = document.querySelector('#admin-student-list');
  const adminStudentResetInfo = document.querySelector('#admin-student-reset');
  const studentImportForm = document.querySelector('#student-import-form');
  const studentImportFile = document.querySelector('#student-import-file');
  const studentImportMessage = document.querySelector('#student-import-message');
  const studentImportResults = document.querySelector('#student-import-results');
  const teacherImportForm = document.querySelector('#teacher-import-form');
  const teacherImportFile = document.querySelector('#teacher-import-file');
  const teacherImportMessage = document.querySelector('#teacher-import-message');
  const teacherImportResults = document.querySelector('#teacher-import-results');
  const teacherStudentForm = document.querySelector('#teacher-student-form');
  const teacherStudentUsernameInput = document.querySelector('#teacher-student-username');
  const teacherStudentClassSelect = document.querySelector('#teacher-student-class');
  const teacherStudentMessage = document.querySelector('#teacher-student-message');
  const teacherStudentList = document.querySelector('#teacher-student-list');
  const teacherStudentResetInfo = document.querySelector('#teacher-student-reset');

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

  function updateAdminBookBarcode(value) {
    if (!adminBookBarcode) return;
    adminBookBarcode.value = value ? normalizeBarcode(value) : '';
  }

  adminBookBarcode?.addEventListener('blur', () => {
    updateAdminBookBarcode(adminBookBarcode.value);
  });

  function createResetNoticeController(element) {
    let timerId = null;
    function clearTimer() {
      if (timerId) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    }
    return {
      show(text) {
        if (!element) return;
        clearTimer();
        element.textContent = text;
        element.classList.remove('hidden');
        timerId = window.setTimeout(() => {
          if (!element) return;
          element.textContent = '';
          element.classList.add('hidden');
          timerId = null;
        }, 60000);
      },
      hide() {
        if (!element) return;
        clearTimer();
        element.textContent = '';
        element.classList.add('hidden');
      },
    };
  }

  const teacherResetNotice = createResetNoticeController(teacherStudentResetInfo);
  const adminResetNotice = createResetNoticeController(adminStudentResetInfo);
  const adminTeacherResetNotice = createResetNoticeController(adminTeacherResetInfo);

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
    if (!authUser || authUser.role !== 'admin') {
      adminTeacherMessage && (adminTeacherMessage.textContent = '');
      adminTeacherResetNotice.hide();
    }
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
      teacherResetNotice.hide();
      adminResetNotice.hide();
      adminTeacherResetNotice.hide();
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
      adminTeacherMessage && (adminTeacherMessage.textContent = '');
      adminTeacherList && (adminTeacherList.innerHTML = '');
      if (adminStudentClassSelect) {
        adminStudentClassSelect.replaceChildren();
        const option = appendTextElement(adminStudentClassSelect, 'option', 'Geen klas koppelen');
        if (option) {
          option.value = '';
        }
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
    bookGrid.replaceChildren();
    if (!filtered.length) {
      replaceWithTextElement(bookGrid, 'p', 'Geen boeken gevonden voor deze selectie.');
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
    updateAdminBookBarcode(book.barcode || '');
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
      appendTextElement(adminClassTeachersSelect, 'option', teacher.name, {
        value: teacher.id,
      });
    }
    updateAdminClassDetails();
  }

  function renderAdminClasses() {
    if (!adminClassSelect || !adminClassDetails) return;
    if (authUser?.role !== 'admin') {
      adminClassSelect.replaceChildren();
      const option = appendTextElement(adminClassSelect, 'option', 'Kies een klas om te beheren');
      if (option) {
        option.value = '';
      }
      adminClassSelect.disabled = true;
      adminClassSelect.value = '';
      replaceWithTextElement(adminClassDetails, 'p', 'Alleen beheerders kunnen klassen beheren.');
      adminClassDetails.classList.add('admin-detail__body--empty');
      selectedAdminClassId = '';
      return;
    }
    const sortedClasses = [...classes].sort((a, b) =>
      a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' })
    );
    adminClassSelect.replaceChildren();
    const placeholder = appendTextElement(adminClassSelect, 'option', 'Kies een klas om te beheren');
    if (placeholder) {
      placeholder.value = '';
    }
    for (const klass of sortedClasses) {
      appendTextElement(adminClassSelect, 'option', klass.name, { value: klass.id });
    }
    adminClassSelect.disabled = !sortedClasses.length;
    if (!sortedClasses.length) {
      adminClassSelect.value = '';
      replaceWithTextElement(adminClassDetails, 'p', 'Nog geen klassen aangemaakt.');
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
    if (adminClassSelect) {
      adminClassSelect.value = selectedAdminClassId || '';
    }
    adminClassDetails.replaceChildren();
    adminClassDetails.classList.remove('admin-detail__body--empty');
    if (authUser?.role !== 'admin') {
      replaceWithTextElement(adminClassDetails, 'p', 'Alleen beheerders kunnen klassen beheren.');
      adminClassDetails.classList.add('admin-detail__body--empty');
      return;
    }
    if (!classes.length) {
      replaceWithTextElement(adminClassDetails, 'p', 'Nog geen klassen aangemaakt.');
      adminClassDetails.classList.add('admin-detail__body--empty');
      return;
    }
    if (!selectedAdminClassId) {
      replaceWithTextElement(adminClassDetails, 'p', 'Kies een klas om details te bekijken.');
      adminClassDetails.classList.add('admin-detail__body--empty');
      return;
    }
    const klass = classes.find((entry) => entry.id === selectedAdminClassId);
    if (!klass) {
      replaceWithTextElement(adminClassDetails, 'p', 'Deze klas bestaat niet meer. Kies een andere klas.');
      adminClassDetails.classList.add('admin-detail__body--empty');
      return;
    }
    const teacherNames = (klass.teacherIds || [])
      .map((teacherId) => teachers.find((teacher) => teacher.id === teacherId)?.name)
      .filter(Boolean);
    const summary = appendElement(adminClassDetails, 'div', {
      className: 'admin-class-details__summary',
    });
    if (summary) {
      appendTextElement(summary, 'strong', klass.name);
      appendTextElement(summary, 'span', `${klass.studentIds?.length || 0} leerlingen`);
    }
    appendTextElement(
      adminClassDetails,
      'p',
      teacherNames.length
        ? `Docenten: ${teacherNames.join(', ')}`
        : 'Nog geen docenten gekoppeld.',
      { className: 'hint' }
    );

    const teacherForm = appendElement(adminClassDetails, 'form', {
      className: 'admin-class-details__form',
    });
    if (teacherForm) {
      teacherForm.dataset.classTeacherForm = 'true';
      teacherForm.dataset.classId = klass.id;
      const label = appendElement(teacherForm, 'label');
      if (label) {
        label.setAttribute('for', `admin-teachers-${klass.id}`);
        label.textContent = 'Docenten koppelen';
      }
      const select = appendElement(teacherForm, 'select');
      if (select) {
        select.id = `admin-teachers-${klass.id}`;
        select.multiple = true;
        select.size = 4;
        if (!teachers.length) {
          select.disabled = true;
          const option = appendTextElement(select, 'option', 'Geen docenten beschikbaar');
          if (option) {
            option.value = '';
          }
        } else {
          for (const teacher of teachers) {
            const option = appendTextElement(select, 'option', teacher.name);
            if (option) {
              option.value = teacher.id;
              option.selected = (klass.teacherIds || []).includes(teacher.id);
            }
          }
        }
      }
      appendTextElement(
        teacherForm,
        'p',
        teachers.length
          ? 'Houd Ctrl of Cmd ingedrukt om meerdere docenten te selecteren.'
          : 'Maak eerst docentaccounts aan om ze te kunnen koppelen.',
        { className: 'hint' }
      );
      const actions = appendElement(teacherForm, 'div', {
        className: 'admin-class-details__actions',
      });
      if (actions) {
        const saveButton = appendElement(actions, 'button', {
          className: 'btn btn--secondary',
        });
        if (saveButton) {
          saveButton.type = 'submit';
          saveButton.textContent = 'Opslaan';
          if (!teachers.length) {
            saveButton.disabled = true;
          }
        }
        const deleteButton = appendElement(actions, 'button', {
          className: 'btn btn--ghost',
        });
        if (deleteButton) {
          deleteButton.type = 'button';
          deleteButton.dataset.deleteClass = 'true';
          deleteButton.dataset.classId = klass.id;
          deleteButton.textContent = 'Klas verwijderen';
        }
      }
    }

    const studentsSection = appendElement(adminClassDetails, 'div', {
      className: 'admin-class-details__students',
    });
    if (!studentsSection) {
      return;
    }
    appendTextElement(studentsSection, 'h5', 'Leerlingen in deze klas');

    const addForm = appendElement(studentsSection, 'form', {
      className: 'admin-class-details__add',
    });
    const availableStudents = students
      .filter((student) => !(klass.studentIds || []).includes(student.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));
    if (addForm) {
      addForm.dataset.addStudentToClass = 'true';
      addForm.dataset.classId = klass.id;
      const label = appendElement(addForm, 'label', { className: 'visually-hidden' });
      if (label) {
        label.setAttribute('for', `admin-class-add-${klass.id}`);
        label.textContent = `Leerling toevoegen aan ${klass.name}`;
      }
      const select = appendElement(addForm, 'select');
      if (select) {
        select.id = `admin-class-add-${klass.id}`;
        if (!availableStudents.length) {
          select.disabled = true;
          const option = appendTextElement(
            select,
            'option',
            'Geen vrije leerlingen beschikbaar'
          );
          if (option) {
            option.value = '';
          }
        } else {
          const placeholderOption = appendTextElement(select, 'option', 'Kies een leerling…');
          if (placeholderOption) {
            placeholderOption.value = '';
          }
          for (const student of availableStudents) {
            const optionText = student.grade
              ? `${student.name} (${student.grade})`
              : student.name;
            const option = appendTextElement(select, 'option', optionText);
            if (option) {
              option.value = student.id;
            }
          }
        }
      }
      const submitButton = appendElement(addForm, 'button', {
        className: 'btn btn--secondary',
      });
      if (submitButton) {
        submitButton.type = 'submit';
        submitButton.textContent = 'Toevoegen';
        if (!availableStudents.length) {
          submitButton.disabled = true;
        }
      }
    }

    if (!availableStudents.length) {
      appendTextElement(
        studentsSection,
        'p',
        'Alle leerlingen zijn al gekoppeld aan deze klas.',
        { className: 'hint' }
      );
    }

    const members = (klass.studentIds || [])
      .map((studentId) => students.find((student) => student.id === studentId))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));
    if (!members.length) {
      appendTextElement(
        studentsSection,
        'p',
        'Nog geen leerlingen gekoppeld aan deze klas.',
        { className: 'hint' }
      );
      return;
    }
    const memberList = appendElement(studentsSection, 'ul');
    if (!memberList) {
      return;
    }
    for (const member of members) {
      const li = appendElement(memberList, 'li');
      if (!li) continue;
      const nameSpan = appendTextElement(
        li,
        'span',
        member.grade ? `${member.name} (${member.grade})` : member.name
      );
      if (nameSpan) {
        nameSpan.className = nameSpan.className || '';
      }
      const removeButton = appendElement(li, 'button', {
        className: 'btn btn--ghost',
      });
      if (removeButton) {
        removeButton.type = 'button';
        removeButton.dataset.removeFromClass = 'true';
        removeButton.dataset.classId = klass.id;
        removeButton.dataset.studentId = member.id;
        removeButton.textContent = 'Verwijderen';
      }
    }
  }

  function renderTeacherStudentClassSelect() {
    if (teacherStudentClassSelect) {
      const teacherClasses = authUser?.role === 'admin'
        ? classes
        : classes.filter((klass) => (klass.teacherIds || []).includes(authUser?.id));
      teacherStudentClassSelect.replaceChildren();
      const placeholder = appendTextElement(teacherStudentClassSelect, 'option', 'Kies een klas');
      if (placeholder) {
        placeholder.value = '';
      }
      for (const klass of teacherClasses) {
        appendTextElement(teacherStudentClassSelect, 'option', klass.name, {
          value: klass.id,
        });
      }
      teacherStudentClassSelect.disabled = teacherClasses.length === 0;
    }
    if (adminStudentClassSelect) {
      const current = adminStudentClassSelect.value;
      adminStudentClassSelect.replaceChildren();
      const defaultOption = appendTextElement(adminStudentClassSelect, 'option', 'Geen klas koppelen');
      if (defaultOption) {
        defaultOption.value = '';
      }
      for (const klass of classes) {
        appendTextElement(adminStudentClassSelect, 'option', klass.name, {
          value: klass.id,
        });
      }
      adminStudentClassSelect.value = current;
    }
  }

  function renderTeacherStudents() {
    if (!teacherStudentList) return;
    const allowed = authUser && (authUser.role === 'teacher' || authUser.role === 'admin');
    teacherStudentList.replaceChildren();
    if (!allowed) {
      return;
    }
    const teacherClassIds = getTeacherClassIds();
    const relevantStudents = students.filter((student) =>
      (student.classIds || []).some((id) => teacherClassIds.includes(id))
    );
    if (!relevantStudents.length) {
      replaceWithTextElement(
        teacherStudentList,
        'p',
        'Nog geen leerlingen gekoppeld aan jouw klassen.'
      );
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

      const item = appendElement(teacherStudentList, 'article', {
        className: 'student-list__item',
      });
      if (!item) continue;

      appendTextElement(item, 'strong', student.name);

      const metaLine = appendElement(item, 'div', { className: 'student-list__meta' });
      if (metaLine) {
        appendTextElement(metaLine, 'span', `Gebruikersnaam: ${student.username}`);
        appendTextElement(metaLine, 'span', `Klas: ${student.grade || 'Onbekend'}`);
        appendTextElement(metaLine, 'span', `${borrowed} uitgeleende boek(en)`);
      }

      const classesLine = appendElement(item, 'div', { className: 'student-list__meta' });
      if (classesLine) {
        appendTextElement(
          classesLine,
          'span',
          studentClasses.length
            ? `Gekoppeld aan: ${studentClasses.map((klass) => klass.name).join(', ')}`
            : 'Nog niet gekoppeld aan een klas'
        );
      }

      const actions = appendElement(item, 'div', { className: 'student-list__actions' });
      if (actions) {
        if (!sharedClassIds.length) {
          appendTextElement(actions, 'span', 'Geen gedeelde klassen om te beheren.', {
            className: 'hint',
          });
        } else {
          appendTextElement(actions, 'button', 'Wachtwoord resetten', {
            className: 'btn btn--ghost',
            type: 'button',
            dataset: {
              resetPassword: 'true',
              studentId: student.id,
              studentName: student.name,
            },
          });
          for (const classId of sharedClassIds) {
            const klass = classes.find((entry) => entry.id === classId);
            appendTextElement(
              actions,
              'button',
              klass ? `Uit ${klass.name} verwijderen` : 'Verwijderen uit klas',
              {
                className: 'btn btn--ghost',
                type: 'button',
                dataset: {
                  removeFromClass: 'true',
                  classId,
                  studentId: student.id,
                },
              }
            );
          }
        }
      }
    }
  }

  function renderAdminTeachers() {
    if (!adminTeacherList) return;
    if (!authUser || authUser.role !== 'admin') {
      adminTeacherList.replaceChildren();
      return;
    }
    adminTeacherMessage && (adminTeacherMessage.textContent = '');
    adminTeacherList.replaceChildren();
    if (!teachers.length) {
      replaceWithTextElement(
        adminTeacherList,
        'p',
        'Er zijn nog geen docentenaccounts.'
      );
      return;
    }
    const sortedTeachers = [...teachers].sort((a, b) =>
      a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' })
    );
    for (const teacher of sortedTeachers) {
      const teacherClasses = classes
        .filter((klass) => Array.isArray(klass.teacherIds) && klass.teacherIds.includes(teacher.id))
        .map((klass) => klass.name)
        .filter(Boolean);

      const item = appendElement(adminTeacherList, 'article', {
        className: 'student-list__item',
      });
      if (!item) continue;

      appendTextElement(item, 'strong', teacher.name);

      const metaLine = appendElement(item, 'div', { className: 'student-list__meta' });
      if (metaLine) {
        appendTextElement(
          metaLine,
          'span',
          `Gebruikersnaam: ${teacher.username || 'Onbekend'}`
        );
      }

      appendTextElement(
        item,
        'div',
        teacherClasses.length
          ? `Gekoppeld aan: ${teacherClasses.join(', ')}`
          : 'Nog niet gekoppeld aan een klas',
        { className: 'student-list__meta' }
      );

      const actions = appendElement(item, 'div', { className: 'student-list__actions' });
      if (actions) {
        appendTextElement(actions, 'button', 'Wachtwoord resetten', {
          className: 'btn btn--ghost',
          type: 'button',
          dataset: {
            resetTeacher: 'true',
            teacherId: teacher.id,
            teacherName: teacher.name,
          },
        });
      }
    }
  }

  function renderAdminStudents() {
    if (!adminStudentList) return;
    if (!authUser || authUser.role !== 'admin') {
      adminStudentList.replaceChildren();
      return;
    }
    adminStudentList.replaceChildren();
    if (!students.length) {
      replaceWithTextElement(
        adminStudentList,
        'p',
        'Er zijn nog geen leerlingaccounts.'
      );
      return;
    }
    for (const student of students) {
      const borrowed = student.borrowedBooks?.length || 0;
      const studentClasses = (student.classIds || [])
        .map((classId) => classes.find((klass) => klass.id === classId))
        .filter(Boolean);

      const item = appendElement(adminStudentList, 'article', {
        className: 'student-list__item',
      });
      if (!item) continue;

      appendTextElement(item, 'strong', student.name);

      const metaLine = appendElement(item, 'div', { className: 'student-list__meta' });
      if (metaLine) {
        appendTextElement(metaLine, 'span', `Gebruikersnaam: ${student.username}`);
        appendTextElement(metaLine, 'span', `Klas: ${student.grade || 'Onbekend'}`);
        appendTextElement(metaLine, 'span', `${borrowed} uitgeleende boek(en)`);
      }

      const classesLine = appendElement(item, 'div', { className: 'student-list__meta' });
      if (classesLine) {
        appendTextElement(
          classesLine,
          'span',
          studentClasses.length
            ? `Gekoppeld aan: ${studentClasses.map((klass) => klass.name).join(', ')}`
            : 'Nog niet gekoppeld aan een klas'
        );
      }

      const actions = appendElement(item, 'div', { className: 'student-list__actions' });
      if (actions) {
        appendTextElement(actions, 'button', 'Wachtwoord resetten', {
          className: 'btn btn--ghost',
          type: 'button',
          dataset: {
            resetPassword: 'true',
            studentId: student.id,
            studentName: student.name,
          },
        });
        if (studentClasses.length) {
          for (const klass of studentClasses) {
            appendTextElement(actions, 'button', `Uit ${klass.name} verwijderen`, {
              className: 'btn btn--ghost',
              type: 'button',
              dataset: {
                removeFromClass: 'true',
                classId: klass.id,
                studentId: student.id,
              },
            });
          }
        }
        appendTextElement(actions, 'button', 'Account verwijderen', {
          className: 'btn btn--ghost',
          type: 'button',
          dataset: {
            removeStudentAccount: 'true',
            studentId: student.id,
          },
        });
      }
    }
  }

  function appendImportMeta(container, label, value) {
    if (!container) return;
    let resolved;
    if (Array.isArray(value)) {
      resolved = value
        .map((entry) => (entry == null ? '' : String(entry)))
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join(', ');
    } else if (value == null) {
      resolved = '';
    } else {
      resolved = String(value).trim();
    }
    if (!resolved) return;
    appendTextElement(container, 'span', `${label}: ${resolved}`);
  }

  function renderImportResults(container, result) {
    if (!container) return;
    container.replaceChildren();
    if (!result) return;

    const accounts = Array.isArray(result.accounts) ? result.accounts : [];
    const skipped = Array.isArray(result.skipped) ? result.skipped : [];

    if (accounts.length) {
      const list = appendElement(container, 'ul', {
        className: 'import-results__list',
      });
      for (const account of accounts) {
        const item = appendElement(list, 'li');
        appendTextElement(item, 'strong', account.name || account.username || 'Onbekende gebruiker');

        if (account.status) {
          const statusLabel = account.status === 'updated' ? 'Bijgewerkt account' : 'Nieuw account';
          appendImportMeta(item, 'Status', statusLabel);
        }
        appendImportMeta(item, 'Gebruikersnaam', account.username);
        appendImportMeta(item, 'Leerjaar/klas', account.grade);
        appendImportMeta(item, 'Klassen', account.classes);
        appendImportMeta(item, 'Docenten', account.teachers);
        if (account.password) {
          const passwordLabel = account.status === 'updated' ? 'Nieuw wachtwoord' : 'Tijdelijk wachtwoord';
          appendImportMeta(item, passwordLabel, account.password);
        }
      }
    }

    if (skipped.length) {
      appendTextElement(container, 'h4', 'Overgeslagen regels');
      const skippedList = appendElement(container, 'ul', {
        className: 'import-results__skipped',
      });
      for (const entry of skipped) {
        const item = appendElement(skippedList, 'li');
        const name = entry?.name || '(onbekend)';
        const username = entry?.username || '(leeg)';
        const reason = entry?.reason || 'Onbekende reden';
        item.textContent = `${name} (${username}) – ${reason}`;
      }
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
    const sanitized = normalizeBarcode(trimmed);
    if (!sanitized) {
      if (adminBookLookupMessage && !silent) {
        adminBookLookupMessage.textContent = 'Voer een geldige barcode in.';
      }
      return;
    }
    if (adminBookBarcode && normalizeBarcode(adminBookBarcode.value) !== sanitized) {
      updateAdminBookBarcode(sanitized);
    }

    let existingBook = null;
    try {
      existingBook = await fetchJson(`/api/books/barcode/${encodeURIComponent(sanitized)}`);
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
      if (metadata && metadata.barcode) {
        updateAdminBookBarcode(metadata.barcode);
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
      adminFolderSelect.replaceChildren();
      const defaultOption = appendTextElement(adminFolderSelect, 'option', 'Geen map');
      if (defaultOption) {
        defaultOption.value = '';
      }
      for (const folder of folders) {
        appendTextElement(adminFolderSelect, 'option', folder.name, {
          value: folder.id,
        });
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
    summary.replaceChildren();
    const items = [
      { label: 'Totaal', value: data.totalBooks },
      { label: 'Beschikbaar', value: data.availableBooks },
      { label: 'Uitgeleend', value: data.borrowedBooks },
      { label: 'Leeslijst', value: data.examListBooks },
    ];
    for (const item of items) {
      const div = appendElement(summary, 'div', { className: 'summary__item' });
      if (!div) continue;
      div.append(document.createTextNode(String(item.value ?? '')));
      appendTextElement(div, 'span', item.label);
    }
  }

  async function loadHistory() {
    if (!historyList) return;
    try {
      const entries = await fetchJson('/api/history?limit=10');
      historyList.replaceChildren();
      for (const entry of entries) {
        const li = appendElement(historyList, 'li', { className: 'history-item' });
        if (!li) continue;
        const time = new Date(entry.timestamp).toLocaleString('nl-NL', {
          dateStyle: 'short',
          timeStyle: 'short',
        });
        appendTextElement(li, 'span', time, { className: 'history-item__time' });
        appendTextElement(li, 'span', entry.message);
      }
    } catch (error) {
      historyList.replaceChildren();
      const li = appendElement(historyList, 'li', { className: 'history-item' });
      appendTextElement(li, 'span', error.message);
    }
  }

  async function loadStudents() {
    students = await fetchJson('/api/students');
    renderTeacherStudents();
    renderAdminStudents();
  }

  function renderClasses() {
    if (!classList) return;
    classList.replaceChildren();
    const loggedIn = authUser && (authUser.role === 'teacher' || authUser.role === 'admin');
    if (!loggedIn) return;
    if (!classes.length) {
      replaceWithTextElement(
        classList,
        'p',
        'Je hebt nog geen klassen. Maak er één aan om te starten.'
      );
      return;
    }
    for (const klass of classes) {
      const article = appendElement(classList, 'article', { className: 'class-card' });
      if (!article) continue;

      const header = appendElement(article, 'header', { className: 'class-card__header' });
      if (header) {
        appendTextElement(header, 'h4', klass.name);
        appendTextElement(header, 'span', `${klass.studentIds?.length || 0} leerlingen`);
      }

      const memberList = appendElement(article, 'ul', { className: 'class-card__students' });
      const members = (klass.studentIds || [])
        .map((id) => students.find((student) => student.id === id))
        .filter(Boolean);
      if (memberList) {
        if (!members.length) {
          appendTextElement(memberList, 'li', 'Nog geen leerlingen gekoppeld.');
        } else {
          for (const member of members) {
            const li = appendElement(memberList, 'li');
            if (!li) continue;
            const info = appendElement(li, 'div');
            if (info) {
              appendTextElement(info, 'strong', member.name);
              info.append(' ');
              appendTextElement(info, 'span', member.grade || 'klas onbekend');
              if (member.borrowedBooks?.length) {
                info.append(' ');
                appendTextElement(
                  info,
                  'span',
                  `${member.borrowedBooks.length} boek(en) mee`
                );
              }
            }
            const removeButton = appendElement(li, 'button', {
              className: 'btn btn--ghost',
            });
            if (removeButton) {
              removeButton.type = 'button';
              removeButton.dataset.removeStudent = 'true';
              removeButton.dataset.classId = klass.id;
              removeButton.dataset.studentId = member.id;
              removeButton.textContent = 'Verwijderen';
            }
          }
        }
      }

      if (authUser?.role === 'admin') {
        const form = appendElement(article, 'form', { className: 'class-card__form' });
        const availableStudents = students.filter(
          (student) => !(klass.studentIds || []).includes(student.id)
        );
        if (form) {
          const label = appendElement(form, 'label');
          if (label) {
            label.setAttribute('for', `add-${klass.id}`);
            label.textContent = 'Leerling toevoegen';
          }
          const select = appendElement(form, 'select');
          if (select) {
            select.id = `add-${klass.id}`;
            select.required = true;
            const placeholderOption = appendTextElement(select, 'option', 'Kies een leerling…');
            if (placeholderOption) {
              placeholderOption.value = '';
            }
            for (const student of availableStudents) {
              const optionText = `${student.name} (${student.grade || 'leerling'})`;
              const option = appendTextElement(select, 'option', optionText);
              if (option) {
                option.value = student.id;
              }
            }
          }
          const submitButton = appendElement(form, 'button', {
            className: 'btn btn--secondary',
          });
          if (submitButton) {
            submitButton.type = 'submit';
            submitButton.textContent = 'Toevoegen';
          }
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const selectEl = form.querySelector('select');
            if (!selectEl?.value) return;
            try {
              await fetchJson(`/api/classes/${klass.id}/students`, {
                method: 'POST',
                body: { studentId: selectEl.value },
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
        }
      }
    }
  }

  async function loadClasses() {
    classes = await fetchJson('/api/classes');
    renderClasses();
    renderTeacherStudentClassSelect();
    renderAdminClasses();
    renderTeacherStudents();
    renderAdminTeachers();
    renderAdminStudents();
  }

  async function loadTeachers() {
    adminTeacherResetNotice.hide();
    if (!authUser || authUser.role !== 'admin') {
      teachers = [];
      renderAdminTeacherSelect();
      renderAdminTeachers();
      adminTeacherMessage && (adminTeacherMessage.textContent = '');
      return;
    }
    teachers = await fetchJson('/api/teachers');
    renderAdminTeacherSelect();
    renderAdminClasses();
    renderAdminTeachers();
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
      renderAdminTeachers();
      adminTeacherMessage && (adminTeacherMessage.textContent = '');
      adminTeacherResetNotice.hide();
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

  if (adminClassForm) {
    adminClassForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!authUser || authUser.role !== 'admin') {
        adminClassMessage.textContent = 'Alleen beheerders kunnen klassen beheren.';
        return;
      }
      const name = adminClassNameInput.value.trim();
      const teacherSelect = adminClassTeachersSelect;
      const teacherIds = teacherSelect
        ? Array.from(teacherSelect.selectedOptions)
            .map((option) => option.value)
            .filter(Boolean)
        : [];
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
  }

  if (adminClassSelect) {
    adminClassSelect.addEventListener('change', () => {
      if (!authUser || authUser.role !== 'admin') {
        return;
      }
      selectedAdminClassId = adminClassSelect.value || '';
      updateAdminClassDetails();
    });
  }

  if (adminClassDetails) {
    adminClassDetails.addEventListener('submit', async (event) => {
      const teacherForm = event.target.closest('[data-class-teacher-form]');
      if (teacherForm) {
        event.preventDefault();
        if (!authUser || authUser.role !== 'admin') {
          adminClassMessage.textContent = 'Alleen beheerders kunnen docenten koppelen.';
          return;
        }
        const classId = teacherForm.dataset.classId;
        const select = teacherForm.querySelector('select');
        if (!select) {
          adminClassMessage.textContent = 'Kon de docentselectie niet vinden.';
          return;
        }
        const teacherIds = Array.from(select.selectedOptions)
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
        if (!select) {
          adminClassMessage.textContent = 'Kon de leerlingselectie niet vinden.';
          return;
        }
        const studentId = select.value;
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

    adminClassDetails.addEventListener('click', async (event) => {
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
  }

  teacherStudentForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    teacherResetNotice.hide();
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
    const resetButton = event.target.closest('[data-reset-password]');
    if (resetButton) {
      if (!authUser || !['teacher', 'admin'].includes(authUser.role)) {
        teacherStudentMessage.textContent = 'Alleen docenten of beheerders kunnen wachtwoorden resetten.';
        return;
      }
      const studentId = resetButton.dataset.studentId;
      if (!studentId) return;
      if (!window.confirm('Nieuw tijdelijk wachtwoord aanmaken voor deze leerling?')) {
        return;
      }
      teacherResetNotice.hide();
      resetButton.disabled = true;
      teacherStudentMessage.textContent = 'Tijdelijk wachtwoord wordt aangemaakt…';
      try {
        const result = await fetchJson(`/api/students/${studentId}/reset-password`, { method: 'POST' });
        const studentName = result?.student?.name || resetButton.dataset.studentName || 'Leerling';
        teacherStudentMessage.textContent = `${studentName} heeft een nieuw tijdelijk wachtwoord gekregen.`;
        teacherResetNotice.show(`Tijdelijk wachtwoord: ${result.temporaryPassword}`);
        if (result?.student) {
          const index = students.findIndex((entry) => entry.id === result.student.id);
          if (index !== -1) {
            students[index] = result.student;
          }
        }
      } catch (error) {
        teacherStudentMessage.textContent = error.message;
        teacherResetNotice.hide();
      } finally {
        resetButton.disabled = false;
      }
      return;
    }
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
    teacherResetNotice.hide();
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

  adminTeacherList?.addEventListener('click', async (event) => {
    const resetButton = event.target.closest('[data-reset-teacher]');
    if (!resetButton) {
      return;
    }
    if (!authUser || authUser.role !== 'admin') {
      adminTeacherMessage &&
        (adminTeacherMessage.textContent = 'Alleen beheerders kunnen wachtwoorden van docenten resetten.');
      return;
    }
    const teacherId = resetButton.dataset.teacherId;
    if (!teacherId) {
      return;
    }
    if (!window.confirm('Nieuw tijdelijk wachtwoord voor deze docent aanmaken?')) {
      return;
    }
    adminTeacherResetNotice.hide();
    resetButton.disabled = true;
    if (adminTeacherMessage) {
      adminTeacherMessage.textContent = 'Tijdelijk wachtwoord wordt aangemaakt…';
    }
    try {
      const result = await fetchJson(`/api/teachers/${teacherId}/reset-password`, { method: 'POST' });
      const teacherName = result?.teacher?.name || resetButton.dataset.teacherName || 'Docent';
      if (adminTeacherMessage) {
        adminTeacherMessage.textContent = `${teacherName} heeft een nieuw tijdelijk wachtwoord gekregen.`;
      }
      if (result?.temporaryPassword) {
        adminTeacherResetNotice.show(`Tijdelijk wachtwoord: ${result.temporaryPassword}`);
      }
      if (result?.teacher) {
        const index = teachers.findIndex((entry) => entry.id === result.teacher.id);
        if (index !== -1) {
          teachers[index] = result.teacher;
        }
        renderAdminTeachers();
      }
    } catch (error) {
      if (adminTeacherMessage) {
        adminTeacherMessage.textContent = error.message;
      }
      adminTeacherResetNotice.hide();
    } finally {
      resetButton.disabled = false;
    }
  });

  adminStudentList?.addEventListener('click', async (event) => {
    const resetButton = event.target.closest('[data-reset-password]');
    if (resetButton) {
      if (!authUser || authUser.role !== 'admin') {
        adminStudentMessage.textContent = 'Alleen beheerders kunnen wachtwoorden resetten.';
        return;
      }
      const studentId = resetButton.dataset.studentId;
      if (!studentId) return;
      if (!window.confirm('Nieuw tijdelijk wachtwoord voor deze leerling aanmaken?')) {
        return;
      }
      adminResetNotice.hide();
      resetButton.disabled = true;
      adminStudentMessage.textContent = 'Tijdelijk wachtwoord wordt aangemaakt…';
      try {
        const result = await fetchJson(`/api/students/${studentId}/reset-password`, { method: 'POST' });
        const studentName = result?.student?.name || resetButton.dataset.studentName || 'Leerling';
        adminStudentMessage.textContent = `${studentName} heeft een nieuw tijdelijk wachtwoord gekregen.`;
        adminResetNotice.show(`Tijdelijk wachtwoord: ${result.temporaryPassword}`);
        if (result?.student) {
          const index = students.findIndex((entry) => entry.id === result.student.id);
          if (index !== -1) {
            students[index] = result.student;
          }
        }
      } catch (error) {
        adminStudentMessage.textContent = error.message;
        adminResetNotice.hide();
      } finally {
        resetButton.disabled = false;
      }
      return;
    }
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
      adminResetNotice.hide();
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
    adminResetNotice.hide();
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
    const normalizedBarcode = normalizeBarcode(adminBookBarcode?.value);
    const payload = {
      title: adminBookTitle.value.trim(),
      author: adminBookAuthor.value.trim(),
      barcode: normalizedBarcode,
      folderId: adminFolderSelect.value || null,
      suitableForExamList: Boolean(adminBookExam.checked),
      description: adminBookDescription.value.trim(),
    };
    updateAdminBookBarcode(payload.barcode);
    if (!payload.title || !payload.author || !payload.barcode) {
      adminBookMessage.textContent = 'Titel, auteur en een geldige barcode zijn verplicht.';
      updateAdminBookBarcode(adminBookBarcode?.value);
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
    adminResetNotice.hide();
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
      adminStudentMessage.textContent = 'Leerling aangemaakt.';
      const temporaryPassword = result?.temporaryPassword || password;
      if (temporaryPassword) {
        const displayName = result?.name || name;
        adminResetNotice.show(`Tijdelijk wachtwoord voor ${displayName}: ${temporaryPassword}`);
      }
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
      studentImportMessage.textContent = 'Bestand wordt verwerkt…';
      const base64 = await readFileAsBase64(file);
      const result = await fetchJson('/api/students/import', {
        method: 'POST',
        body: { file: base64 },
      });
      studentImportFile.value = '';
      const skippedCount = Array.isArray(result.skipped) ? result.skipped.length : 0;
      studentImportMessage.textContent = `Import gereed: ${result.created} toegevoegd, ${result.updated} bijgewerkt${
        skippedCount ? `, ${skippedCount} overgeslagen` : ''
      }.`;
      renderImportResults(studentImportResults, result);
      await refreshStaffData();
    } catch (error) {
      studentImportMessage.textContent = error.message;
    }
  });

  teacherImportForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser || authUser.role !== 'admin') {
      teacherImportMessage.textContent = 'Alleen beheerders kunnen docenten importeren.';
      return;
    }
    const file = teacherImportFile?.files?.[0];
    if (!file) {
      teacherImportMessage.textContent = 'Kies eerst een Excelbestand.';
      return;
    }
    try {
      teacherImportMessage.textContent = 'Bestand wordt verwerkt…';
      const base64 = await readFileAsBase64(file);
      const result = await fetchJson('/api/teachers/import', {
        method: 'POST',
        body: { file: base64 },
      });
      teacherImportFile.value = '';
      const skippedCount = Array.isArray(result.skipped) ? result.skipped.length : 0;
      teacherImportMessage.textContent = `Import gereed: ${result.created} toegevoegd, ${result.updated} bijgewerkt${
        skippedCount ? `, ${skippedCount} overgeslagen` : ''
      }.`;
      renderImportResults(teacherImportResults, result);
      await refreshStaffData();
    } catch (error) {
      teacherImportMessage.textContent = error.message;
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

passwordChangeController = initPasswordChangeDialog();

if (pageType === 'student') {
  initStudentPage();
} else if (pageType === 'staff') {
  initStaffPage();
}
