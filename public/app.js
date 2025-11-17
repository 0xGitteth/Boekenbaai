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
let statsModalController = null;

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

function createStatsModal() {
  const body = document.body;
  const overlay = appendElement(body, 'div', {
    className: 'stats-modal hidden',
    aria: { hidden: 'true' },
  });
  const dialog = appendElement(overlay, 'div', {
    className: 'stats-modal__dialog',
    role: 'dialog',
    aria: { modal: 'true' },
    tabIndex: -1,
  });
  const closeButton = appendElement(dialog, 'button', {
    className: 'stats-modal__close btn btn--ghost',
    type: 'button',
    aria: { label: 'Sluit statistieken' },
    textContent: 'Sluiten',
  });
  const title = appendElement(dialog, 'h3', {
    className: 'stats-modal__title',
    id: 'stats-modal-title',
  });
  dialog?.setAttribute('aria-labelledby', 'stats-modal-title');
  const content = appendElement(dialog, 'div', {
    className: 'stats-modal__content',
  });

  let active = false;
  let statusEl = null;
  let lastFocused = null;

  const focusableSelector =
    'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function setStatus(message) {
    if (!content) return;
    if (!statusEl) {
      statusEl = appendElement(content, 'p', {
        className: 'stats-modal__status',
      });
    }
    statusEl.textContent = message || '';
  }

  function clearStatus() {
    statusEl?.remove();
    statusEl = null;
  }

  function trapFocus(event) {
    if (!active || event.key !== 'Tab' || !dialog) return;
    const focusable = dialog.querySelectorAll(focusableSelector);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const goingBackwards = event.shiftKey;
    const activeElement = document.activeElement;
    if (!goingBackwards && activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (goingBackwards && activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  }

  function close() {
    if (!active) return;
    overlay?.classList.add('hidden');
    overlay?.setAttribute('aria-hidden', 'true');
    active = false;
    document.removeEventListener('keydown', trapFocus);
    document.removeEventListener('keydown', handleEscape);
    overlay?.removeEventListener('mousedown', handleOverlayClick);
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
    lastFocused = null;
  }

  function handleEscape(event) {
    if (event.key === 'Escape') {
      close();
    }
  }

  function handleOverlayClick(event) {
    if (event.target === overlay) {
      close();
    }
  }

  function open({ titleText, render }) {
    if (!dialog || !overlay) return;
    title.textContent = titleText || 'Statistieken';
    content.replaceChildren();
    clearStatus();
    setStatus('Gegevens worden opgehaald…');
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    active = true;
    lastFocused = document.activeElement;
    document.addEventListener('keydown', trapFocus);
    document.addEventListener('keydown', handleEscape);
    overlay.addEventListener('mousedown', handleOverlayClick);
    setTimeout(() => {
      const focusTarget = dialog.querySelector(focusableSelector) || dialog;
      focusTarget?.focus();
    }, 20);
    if (typeof render === 'function') {
      Promise.resolve()
        .then(() => render({ container: content, setStatus, clearStatus }))
        .catch((error) => {
          setStatus(error?.message || 'Het ophalen van statistieken is mislukt.');
        });
    }
  }

  closeButton?.addEventListener('click', () => close());

  return { open, close };
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

function updateSortControlAccessibility(select, sortValue, { baseLabel = 'Sorteer de boekenlijst', gridId } = {}) {
  if (!select) return;
  const descriptions = {
    title: 'op titel van A tot Z',
    author: 'op auteur van A tot Z',
    popular: 'op populariteit (meest uitgeleend eerst)',
  };
  const suffix = descriptions[sortValue] || descriptions.title;
  const label = `${baseLabel} ${suffix}`.trim();
  select.setAttribute('aria-label', label);
  select.setAttribute('title', label);
  if (gridId) {
    select.setAttribute('aria-controls', gridId);
  }
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

function generateTemporaryPassword(length = 10) {
  const targetLength = Number.isFinite(length) ? Math.max(4, Math.floor(length)) : 10;
  const byteLength = Math.ceil(targetLength / 2);
  let bytes = [];
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const array = new Uint8Array(byteLength);
    crypto.getRandomValues(array);
    bytes = Array.from(array);
  } else {
    bytes = Array.from({ length: byteLength }, () => Math.floor(Math.random() * 256));
  }
  let hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hex.length < targetLength) {
    hex += Math.random().toString(16).slice(2);
  }
  return hex.slice(0, targetLength);
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

const DEFAULT_THEMES = [
  'Avontuur',
  'Spanning',
  'Mysterie',
  'Romantiek',
  'Fantasy',
  'Humor',
  'Geschiedenis',
  'Wetenschap',
  'Sport',
  'Poëzie',
  'Familie',
  'Vriendschap',
  'Identiteit',
  'Diversiteit',
  'Maatschappij',
];

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

function setBookDetailFolders() {
  bookDetailState.folderMap.clear();
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

function extractMetadataCoverUrl(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return '';
  }
  const candidates = [];
  if (typeof metadata.coverUrl === 'string') {
    candidates.push(metadata.coverUrl);
  }
  if (typeof metadata.cover === 'string') {
    candidates.push(metadata.cover);
  }
  if (metadata.cover && typeof metadata.cover === 'object') {
    candidates.push(metadata.cover.large, metadata.cover.medium, metadata.cover.small, metadata.cover.url);
  }
  if (Array.isArray(metadata.covers)) {
    for (const entry of metadata.covers) {
      if (typeof entry === 'string') {
        candidates.push(entry);
      } else if (entry && typeof entry === 'object') {
        candidates.push(entry.large, entry.medium, entry.small, entry.url);
      }
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

async function resolveBookDetailFolderName(folderId) {
  if (!folderId) return '';
  if (bookDetailState.folderMap.has(folderId)) {
    return bookDetailState.folderMap.get(folderId) || '';
  }
  return '';
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
  const manualCoverUrl = typeof book.coverUrl === 'string' ? book.coverUrl.trim() : '';
  const metadataCoverUrl = extractMetadataCoverUrl(metadata);
  const coverUrl = manualCoverUrl || metadataCoverUrl;
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
    const manualPublisher = (book.publisher || '').trim();
    const metadataPublisher = (metadata?.publisher || '').trim();
    state.metaPublisher.textContent = manualPublisher || metadataPublisher || 'Onbekend';
  }
  if (state.metaYear) {
    const manualYear =
      book.publishedYear != null && String(book.publishedYear).trim()
        ? String(book.publishedYear)
        : extractYear(book.publishedAt || '');
    const metadataYear = extractYear(
      metadata?.publishedYear || metadata?.publishedAt || metadata?.publishDate || metadata?.publish_date || ''
    );
    state.metaYear.textContent = manualYear || metadataYear || 'Onbekend';
  }
  if (state.metaPages) {
    const pages = resolvePageCount(metadata, book);
    state.metaPages.textContent = pages ? `${pages}` : 'Onbekend';
  }
  if (state.metaLanguage) {
    const manualLanguage = (book.language || '').trim();
    const metadataLanguage = (metadata?.language || '').trim();
    state.metaLanguage.textContent = manualLanguage || metadataLanguage || 'Onbekend';
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

  const registerTheme = (label, { increment = 0 } = {}) => {
    if (typeof label !== 'string') return;
    const trimmed = label.trim();
    if (!trimmed) return;
    const key = normalizeThemeKey(trimmed);
    if (!key) return;
    const existing = map.get(key);
    if (existing) {
      existing.count += increment;
      if (!existing.label && trimmed) {
        existing.label = trimmed;
      }
      return;
    }
    map.set(key, {
      key,
      label: trimmed,
      count: increment,
    });
  };

  for (const label of DEFAULT_THEMES) {
    registerTheme(label);
  }

  for (const book of books || []) {
    for (const tag of book?.tags || []) {
      registerTheme(tag, { increment: 1 });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return a.label.localeCompare(b.label, 'nl', { sensitivity: 'base' });
  });
}

const THEME_PILL_COLLAPSED_LIMIT = 5;

function renderThemePills(container, config = {}) {
  if (!container) return;
  const {
    themes = [],
    selectedThemes = new Set(),
    onlyExamList = false,
    isExpanded = false,
    onToggleTheme,
    onToggleExam,
    onClear,
    onToggleExpanded,
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

  const normalizedThemes = [];
  for (const entry of themes) {
    const label = typeof entry === 'string' ? entry : entry?.label;
    const key =
      typeof entry === 'string'
        ? normalizeThemeKey(entry)
        : entry?.key || normalizeThemeKey(entry?.label);
    if (!key || !label) continue;
    normalizedThemes.push({ key, label });
  }

  const showAll = Boolean(isExpanded);
  const canToggle = normalizedThemes.length > THEME_PILL_COLLAPSED_LIMIT;
  const visibleThemes = showAll || !canToggle
    ? normalizedThemes
    : normalizedThemes.slice(0, THEME_PILL_COLLAPSED_LIMIT);

  if (!visibleThemes.length) {
    appendTextElement(fragment, 'span', "Geen thema's beschikbaar", {
      className: 'filters__pill-placeholder',
    });
  } else {
    for (const entry of visibleThemes) {
      const { key, label } = entry;
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

  if (canToggle) {
    const toggleButton = appendTextElement(
      fragment,
      'button',
      showAll ? 'Laat minder zien' : 'Laat meer zien',
      {
        className: 'filters__pill filters__pill--toggle',
        type: 'button',
      }
    );
    toggleButton.setAttribute('aria-expanded', showAll ? 'true' : 'false');
    toggleButton.addEventListener('click', () => {
      if (typeof onToggleExpanded === 'function') {
        onToggleExpanded(!showAll);
      }
    });
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

function sortBooks(books, sortBy) {
  if (!Array.isArray(books)) {
    return [];
  }
  const sorted = [...books];
  const locale = 'nl';
  const compareOptions = { sensitivity: 'base', numeric: true };
  const getTitle = (book) => (book?.title ? String(book.title) : '');
  const getAuthor = (book) => (book?.author ? String(book.author) : '');
  const getStatusRank = (book) =>
    String(book?.status || '').toLowerCase() === 'available' ? 0 : 1;
  const compareAvailability = (a, b) => getStatusRank(a) - getStatusRank(b);
  const normalizeCount = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  if (sortBy === 'author') {
    sorted.sort((a, b) => {
      const availabilityDiff = compareAvailability(a, b);
      if (availabilityDiff !== 0) {
        return availabilityDiff;
      }
      const authorCompare = getAuthor(a).localeCompare(getAuthor(b), locale, compareOptions);
      if (authorCompare !== 0) {
        return authorCompare;
      }
      return getTitle(a).localeCompare(getTitle(b), locale, compareOptions);
    });
    return sorted;
  }

  if (sortBy === 'popular' || sortBy === 'popularity') {
    sorted.sort((a, b) => {
      const availabilityDiff = compareAvailability(a, b);
      if (availabilityDiff !== 0) {
        return availabilityDiff;
      }
      const countDiff = normalizeCount(b?.borrowCount) - normalizeCount(a?.borrowCount);
      if (countDiff !== 0) {
        return countDiff;
      }
      const titleCompare = getTitle(a).localeCompare(getTitle(b), locale, compareOptions);
      if (titleCompare !== 0) {
        return titleCompare;
      }
      return getAuthor(a).localeCompare(getAuthor(b), locale, compareOptions);
    });
    return sorted;
  }

  sorted.sort((a, b) => {
    const availabilityDiff = compareAvailability(a, b);
    if (availabilityDiff !== 0) {
      return availabilityDiff;
    }
    const titleCompare = getTitle(a).localeCompare(getTitle(b), locale, compareOptions);
    if (titleCompare !== 0) {
      return titleCompare;
    }
    return getAuthor(a).localeCompare(getAuthor(b), locale, compareOptions);
  });
  return sorted;
}

function renderBookGrid({
  grid,
  books,
  template,
  folders,
  filters,
  cardOptions,
  emptyMessage = 'Geen boeken gevonden voor deze selectie.',
} = {}) {
  if (!grid) return;
  const allBooks = Array.isArray(books) ? [...books] : [];
  const filtered = filterBooks(allBooks, filters);
  const sorted = sortBooks(allBooks, filters?.sortBy);
  const visibleIds = new Set(filtered.map((book) => book.id || ''));
  const existingCards = new Map(
    Array.from(grid.children)
      .filter((child) => child.classList?.contains('book-card'))
      .map((card) => [card.dataset.bookId || '', card])
  );

  const updateCardSelectionState = (card, options = {}) => {
    const isSelectable = Boolean(options.selectable);
    card.classList.toggle('book-card--selectable', isSelectable);
    if (isSelectable) {
      card.classList.toggle('book-card--selected', Boolean(options.selected));
      card.setAttribute('aria-pressed', options.selected ? 'true' : 'false');
    } else {
      card.classList.remove('book-card--selected');
      card.removeAttribute('aria-pressed');
    }
  };

  let emptyState = grid.querySelector('.book-grid__empty');
  if (!emptyState) {
    emptyState = document.createElement('p');
    emptyState.className = 'book-grid__empty';
    emptyState.setAttribute('role', 'status');
    grid.append(emptyState);
  }
  emptyState.textContent = emptyMessage;

  const usedCardIds = new Set();

  for (const book of sorted) {
    const bookId = book.id || '';
    let card = existingCards.get(bookId);
    const options =
      typeof cardOptions === 'function' ? cardOptions(book) : cardOptions;
    if (!card) {
      card = createBookCard(template, book, folders, options || {});
    } else if (card) {
      updateCardSelectionState(card, options || {});
    }

    if (card) {
      card.classList.toggle('book-card--hidden', !visibleIds.has(bookId));
      usedCardIds.add(bookId);
      grid.append(card);
    }
  }

  for (const [bookId, card] of existingCards.entries()) {
    if (!usedCardIds.has(bookId)) {
      card.remove();
    }
  }

  const hasVisible = sorted.some((book) => visibleIds.has(book.id || ''));
  emptyState.classList.toggle('hidden', hasVisible);
  grid.classList.toggle('book-grid--empty', !hasVisible);
}

function createThemeFilterRenderer({
  pillsContainer,
  selectedThemeKeys,
  getThemes,
  getOnlyExamList,
  setOnlyExamList,
  onChange,
} = {}) {
  const notifyChange = () => {
    if (typeof onChange === 'function') {
      onChange();
    }
  };

  let isExpanded = false;

  const setExpanded = (value) => {
    const nextValue = Boolean(value);
    if (nextValue === isExpanded) return;
    isExpanded = nextValue;
    render();
  };

  const ensureExpandedState = (themes) => {
    if (!Array.isArray(themes)) {
      return;
    }
    if (themes.length <= THEME_PILL_COLLAPSED_LIMIT && isExpanded) {
      isExpanded = false;
    }
  };

  const render = () => {
    const themes = typeof getThemes === 'function' ? getThemes() : [];
    ensureExpandedState(themes);
    renderThemePills(pillsContainer, {
      themes,
      selectedThemes: selectedThemeKeys,
      onlyExamList: typeof getOnlyExamList === 'function' ? getOnlyExamList() : false,
      isExpanded,
      onToggleTheme: ({ key, active }) => {
        if (!key) return;
        if (active) {
          selectedThemeKeys?.add(key);
        } else {
          selectedThemeKeys?.delete(key);
        }
        render();
        notifyChange();
      },
      onToggleExam: (nextValue) => {
        if (typeof setOnlyExamList === 'function') {
          setOnlyExamList(Boolean(nextValue));
        }
        render();
        notifyChange();
      },
      onClear: () => {
        selectedThemeKeys?.clear();
        if (typeof setOnlyExamList === 'function') {
          setOnlyExamList(false);
        }
        render();
        notifyChange();
      },
      onToggleExpanded: (nextValue) => {
        setExpanded(nextValue);
      },
    });
  };

  return {
    render,
    expand: () => setExpanded(true),
    collapse: () => setExpanded(false),
    toggle: () => setExpanded(!isExpanded),
    isExpanded: () => isExpanded,
  };
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
  const sortSelect = document.querySelector('#book-sort-select');
  const summary = document.querySelector('#summary');
  const bookGrid = document.querySelector('#book-grid');
  const themeFilterPills = document.querySelector('#theme-filter-pills');
  const barcodeInput = document.querySelector('#barcode-input');
  const lookupButton = document.querySelector('#lookup-button');
  const bookResult = document.querySelector('#book-result');

  let folders = [];
  let allBooks = [];
  let currentBook = null;
  let availableThemes = collectUniqueThemes([]);
  const selectedThemeKeys = new Set();
  let onlyExamList = false;
  let sortBy = sortSelect?.value || 'title';

  updateSortControlAccessibility(sortSelect, sortBy, {
    baseLabel: 'Sorteer de boeken',
    gridId: 'book-grid',
  });

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
    renderBookGrid({
      grid: bookGrid,
      books: allBooks,
      template: bookCardTemplate,
      folders,
      filters: {
        folder: '',
        query: searchInput?.value || '',
        selectedThemes: selectedThemeKeys,
        onlyExamList,
        sortBy,
      },
    });
  }

  const themeFilterRenderer = createThemeFilterRenderer({
    pillsContainer: themeFilterPills,
    selectedThemeKeys,
    getThemes: () => availableThemes,
    getOnlyExamList: () => onlyExamList,
    setOnlyExamList: (value) => {
      onlyExamList = Boolean(value);
    },
    onChange: () => {
      renderBooks();
    },
  });

  function updateAvailableThemes() {
    availableThemes = collectUniqueThemes(allBooks);
    const availableKeys = new Set(availableThemes.map((theme) => theme.key));
    for (const key of Array.from(selectedThemeKeys)) {
      if (!availableKeys.has(key)) {
        selectedThemeKeys.delete(key);
      }
    }
    themeFilterRenderer.render();
    if (typeof renderAdminThemeOptions === 'function') {
      renderAdminThemeOptions();
    }
  }

  async function loadBooks() {
    try {
      allBooks = await fetchJson('/api/books');
      updateAvailableThemes();
      renderBooks();
    } catch (error) {
      if (bookGrid) {
        const message =
          error && error.message
            ? `Kan boeken niet laden: ${error.message}`
            : 'Kan boeken niet laden: onbekende fout.';
        replaceWithTextElement(bookGrid, 'p', message, {
          className: 'book-grid__status',
          role: 'status',
        });
      }
      throw error;
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
    await Promise.all([loadBooks(), loadSummary(), reloadCurrentUser(['student'])]);
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

  sortSelect?.addEventListener('change', () => {
    sortBy = sortSelect.value || 'title';
    updateSortControlAccessibility(sortSelect, sortBy, {
      baseLabel: 'Sorteer de boeken',
      gridId: 'book-grid',
    });
    renderBooks();
  });

  themeFilterRenderer.render();
  renderAuthState();
  Promise.all([loadBooks(), loadSummary()]).catch((error) => {
    console.error('Initiale gegevens laden is mislukt.', error);
  });
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
  const sortSelect = document.querySelector('#staff-book-sort-select');
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
  const adminBookExam = document.querySelector('#admin-book-exam');
  const adminBookDescription = document.querySelector('#admin-book-description');
  const adminBookPublisher = document.querySelector('#admin-book-publisher');
  const adminBookYear = document.querySelector('#admin-book-year');
  const adminBookPages = document.querySelector('#admin-book-pages');
  const adminBookLanguage = document.querySelector('#admin-book-language');
  const adminBookTagsContainer = document.querySelector('#admin-book-tags');
  const adminBookCover = document.querySelector('#admin-book-cover');
  const adminBookMessage = document.querySelector('#admin-book-message');
  const bookImportForm = document.querySelector('#book-import-form');
  const bookImportFile = document.querySelector('#book-import-file');
  const bookImportMessage = document.querySelector('#book-import-message');
  const bookImportResults = document.querySelector('#book-import-results');
  const adminBookSubmitButton = document.querySelector('#admin-book-submit');
  const adminBookCancelButton = document.querySelector('#admin-book-cancel');
  const adminBookDeleteButton = document.querySelector('#admin-book-delete');
  const adminTeacherList = document.querySelector('#admin-teacher-list');
  const adminTeacherResetInfo = document.querySelector('#admin-teacher-reset');
  const adminTeacherSearchInput = document.querySelector('#admin-teacher-search');
  const adminTeacherAddForm = document.querySelector('#admin-teacher-add-form');
  const adminTeacherAddName = document.querySelector('#admin-teacher-add-name');
  const adminTeacherAddUsername = document.querySelector('#admin-teacher-add-username');
  const adminTeacherAddPassword = document.querySelector('#admin-teacher-add-password');
  const adminTeacherAddPasswordGenerateButton = document.querySelector(
    '#admin-teacher-add-password-generate'
  );
  const adminTeacherAddClass = document.querySelector('#admin-teacher-add-class');
  const adminTeacherAddSubmit = document.querySelector('#admin-teacher-add-submit');
  const adminTeacherAddMessage = document.querySelector('#admin-teacher-add-message');
  const adminTeacherDetail = document.querySelector('#admin-teacher-detail');
  const adminTeacherDetailContent = document.querySelector('#admin-teacher-detail-content');
  const adminTeacherDetailPlaceholder = document.querySelector('#admin-teacher-detail-placeholder');
  const adminTeacherDetailName = document.querySelector('#admin-teacher-detail-name');
  const adminTeacherDetailUsername = document.querySelector('#admin-teacher-detail-username');
  const adminTeacherDetailMessage = document.querySelector('#admin-teacher-detail-message');
  const adminTeacherClassesForm = document.querySelector('#admin-teacher-classes-form');
  const adminTeacherClassList = document.querySelector('#admin-teacher-class-list');
  const adminTeacherPasswordForm = document.querySelector('#admin-teacher-password-form');
  const adminTeacherPasswordInput = document.querySelector('#admin-teacher-password');
  const adminTeacherDeleteButton = document.querySelector('#admin-teacher-delete');
  const adminClassForm = document.querySelector('#admin-class-form');
  const adminClassNameInput = document.querySelector('#admin-class-name');
  const adminClassTeacherSearchInput = document.querySelector('#admin-class-teacher-search');
  const adminClassTeacherResults = document.querySelector('#admin-class-teacher-results');
  const adminClassSelectedTeachers = document.querySelector('#admin-class-selected-teachers');
  const adminClassMessage = document.querySelector('#admin-class-message');
  const adminClassList = document.querySelector('#admin-class-list');
  const adminClassSelect = document.querySelector('#admin-class-select');
  const adminClassDetails = document.querySelector('#admin-class-details');
  const adminStudentForm = document.querySelector('#admin-student-form');
  const adminStudentNameInput = document.querySelector('#admin-student-name');
  const adminStudentUsernameInput = document.querySelector('#admin-student-username');
  const adminStudentPasswordInput = document.querySelector('#admin-student-password');
  const adminStudentPasswordGenerateButton = document.querySelector(
    '#admin-student-password-generate'
  );
  const adminStudentClassSelect = document.querySelector('#admin-student-class');
  const adminStudentMessage = document.querySelector('#admin-student-message');
  const adminStudentSearchInput = document.querySelector('#admin-student-search');
  const adminStudentList = document.querySelector('#admin-student-list');
  const adminStudentResetInfo = document.querySelector('#admin-student-reset');
  const adminStudentDetail = document.querySelector('#admin-student-detail');
  const adminStudentDetailPlaceholder = document.querySelector('#admin-student-detail-placeholder');
  const adminStudentDetailContent = document.querySelector('#admin-student-detail-content');
  const adminStudentDetailName = document.querySelector('#admin-student-detail-name');
  const adminStudentDetailUsername = document.querySelector('#admin-student-detail-username');
  const adminStudentDetailGrade = document.querySelector('#admin-student-detail-grade');
  const adminStudentDetailLoansMeta = document.querySelector('#admin-student-detail-loans');
  const adminStudentDetailMessage = document.querySelector('#admin-student-detail-message');
  const adminStudentDetailPasswordForm = document.querySelector('#admin-student-detail-password-form');
  const adminStudentDetailPasswordInput = document.querySelector('#admin-student-detail-password');
  const adminStudentDetailPasswordGenerateButton = document.querySelector(
    '#admin-student-detail-password-generate'
  );
  const adminStudentDetailClassForm = document.querySelector('#admin-student-detail-class-form');
  const adminStudentDetailClassSelect = document.querySelector('#admin-student-detail-class-select');
  const adminStudentDetailClasses = document.querySelector('#admin-student-detail-classes');
  const adminStudentDetailLoansList = document.querySelector('#admin-student-detail-loans-list');
  const adminStudentDetailRemoveButton = document.querySelector('#admin-student-detail-remove');
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
  const teacherStudentResetInfo = document.querySelector('#teacher-student-reset');

  const statsModal = createStatsModal();
  statsModalController = statsModal;

  let folders = [];
  let allBooks = [];
  let classes = [];
  let students = [];
  let teachers = [];
  let selectedBookId = null;
  let selectedAdminClassId = '';
  let adminClassTeacherSearchTerm = '';
  let adminClassSelectedTeacherIds = new Set();
  const classTeacherSelections = new Map();
  const classTeacherSearchTerms = new Map();
  let selectedAdminStudentId = '';
  let selectedAdminStudentLoanEntries = [];
  let selectedAdminStudentLoansError = '';
  let selectedAdminStudentLoanStudentId = '';
  let studentLoanRequestToken = 0;
  let adminStudentSearchTerm = '';
  let selectedAdminTeacherId = '';
  let barcodeLookupTimer = null;
  const filters = { query: '', sortBy: sortSelect?.value || 'title' };
  let availableThemes = collectUniqueThemes([]);
  const selectedThemeKeys = new Set();
  const adminCustomThemes = new Map();
  let adminSelectedThemeKeys = new Set();
  let onlyExamList = false;

  function updateAdminBookDeleteButtonVisibility() {
    if (!adminBookDeleteButton) return;
    const hasId = Boolean(adminBookIdInput?.value?.trim());
    const isAdmin = authUser?.role === 'admin';
    if (hasId && isAdmin) {
      adminBookDeleteButton.classList.remove('hidden');
      adminBookDeleteButton.disabled = false;
    } else {
      adminBookDeleteButton.classList.add('hidden');
      adminBookDeleteButton.disabled = true;
    }
  }

  updateSortControlAccessibility(sortSelect, filters.sortBy, {
    baseLabel: 'Sorteer de boeken',
    gridId: 'book-grid',
  });

  updateAdminBookDeleteButtonVisibility();

  function updateAdminBookBarcode(value) {
    if (!adminBookBarcode) return;
    adminBookBarcode.value = value ? normalizeBarcode(value) : '';
  }

  adminBookBarcode?.addEventListener('blur', () => {
    updateAdminBookBarcode(adminBookBarcode.value);
  });

  function getAdminThemeEntries() {
    const entries = new Map();
    const registerEntry = (entry) => {
      const label = typeof entry === 'string' ? entry : entry?.label;
      const key =
        typeof entry === 'string'
          ? normalizeThemeKey(entry)
          : entry?.key || normalizeThemeKey(entry?.label);
      if (!key || !label || entries.has(key)) return;
      entries.set(key, { key, label });
    };

    for (const theme of availableThemes) {
      registerEntry(theme);
    }
    for (const [, theme] of adminCustomThemes) {
      registerEntry(theme);
    }
    return Array.from(entries.values());
  }

  function getSelectedAdminThemes() {
    if (!adminBookTagsContainer) return [];
    const entries = getAdminThemeEntries();
    const labelByKey = new Map(entries.map((entry) => [entry.key, entry.label]));
    return Array.from(adminSelectedThemeKeys)
      .map((key) => labelByKey.get(key) || key)
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0);
  }

  function ensureAdminThemeEntries(labels = []) {
    for (const label of labels) {
      if (typeof label !== 'string') continue;
      const trimmed = label.trim();
      const key = normalizeThemeKey(trimmed);
      if (!trimmed || !key) continue;
      const existsInAvailable = availableThemes.some(
        (theme) => (theme.key || normalizeThemeKey(theme.label)) === key
      );
      if (!existsInAvailable) {
        const existing = adminCustomThemes.get(key) || {};
        adminCustomThemes.set(key, { key, label: existing.label || trimmed });
      }
    }
  }

  function setSelectedAdminThemes(values = []) {
    ensureAdminThemeEntries(values);
    adminSelectedThemeKeys = new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => (typeof value === 'string' ? normalizeThemeKey(value) : ''))
        .filter(Boolean)
    );
    renderAdminThemeOptions();
  }

  function renderAdminThemeOptions({ preserveSelection = true } = {}) {
    if (!adminBookTagsContainer) return;
    if (!preserveSelection) {
      adminSelectedThemeKeys = new Set();
    }

    const entries = getAdminThemeEntries();
    const fragment = document.createDocumentFragment();

    if (!entries.length) {
      appendTextElement(fragment, 'span', "Geen thema's beschikbaar", {
        className: 'filters__pill-placeholder',
      });
    }

    for (const entry of entries) {
      const button = appendTextElement(fragment, 'button', entry.label, {
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
      } = resolveThemeColors(entry.label);
      button.style.setProperty('--theme-pill-bg', background);
      button.style.setProperty('--theme-pill-hover-bg', hoverBackground);
      button.style.setProperty('--theme-pill-active-bg', activeBackground);
      button.style.setProperty('--theme-pill-border', border);
      button.style.setProperty('--theme-pill-active-border', activeBorder);
      button.style.setProperty('--theme-pill-ring', ring);
      button.style.setProperty('--theme-pill-text', text);
      const isActive = adminSelectedThemeKeys.has(entry.key);
      button.classList.toggle('filters__pill--active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      button.dataset.themeKey = entry.key;
      button.dataset.themeLabel = entry.label;
      button.addEventListener('click', () => {
        const nextSelection = new Set(adminSelectedThemeKeys);
        if (nextSelection.has(entry.key)) {
          nextSelection.delete(entry.key);
        } else {
          nextSelection.add(entry.key);
        }
        adminSelectedThemeKeys = nextSelection;
        renderAdminThemeOptions();
      });
    }

    adminBookTagsContainer.innerHTML = '';
    adminBookTagsContainer.append(fragment);
  }

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

  function setAdminTeacherStatus(message = '') {
    if (!adminTeacherDetailMessage) return;
    adminTeacherDetailMessage.textContent = message;
    if (!message) {
      delete adminTeacherDetailMessage.dataset.teacherId;
    }
  }

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
      setAdminTeacherStatus('');
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
      adminBookForm && adminBookForm.reset();
      adminBookIdInput && (adminBookIdInput.value = '');
      adminCustomThemes.clear();
      adminSelectedThemeKeys = new Set();
      renderAdminThemeOptions({ preserveSelection: false });
      studentImportMessage && (studentImportMessage.textContent = '');
      studentImportResults && (studentImportResults.innerHTML = '');
      adminClassMessage && (adminClassMessage.textContent = '');
      adminClassList && (adminClassList.innerHTML = '');
      adminClassTeachersSelect && (adminClassTeachersSelect.innerHTML = '');
      adminStudentMessage && (adminStudentMessage.textContent = '');
      adminStudentList && (adminStudentList.innerHTML = '');
      if (adminStudentSearchInput) {
        adminStudentSearchInput.value = '';
      }
      setAdminTeacherStatus('');
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
      teacherStudentForm && teacherStudentForm.reset();
      selectedBookId = null;
      selectedAdminClassId = '';
      selectedAdminStudentId = '';
      adminStudentSearchTerm = '';
      folders = [];
      allBooks = [];
      classes = [];
      students = [];
      teachers = [];
      availableThemes = [];
      selectedThemeKeys.clear();
      adminCustomThemes.clear();
      adminSelectedThemeKeys = new Set();
      onlyExamList = false;
      filters.query = '';
      filters.sortBy = sortSelect?.value || 'title';
      updateSortControlAccessibility(sortSelect, filters.sortBy, {
        baseLabel: 'Sorteer de boeken',
        gridId: 'book-grid',
      });
      themeFilterRenderer.render();
      renderAdminThemeOptions({ preserveSelection: false });
      renderBooks();
      renderSelectedAdminStudent();
    }
    updateAdminBookDeleteButtonVisibility();
  }

  updateAuthUi = renderStaffState;

  function renderBooks() {
    renderBookGrid({
      grid: bookGrid,
      books: allBooks,
      template: bookCardTemplate,
      folders,
      filters: {
        folder: '',
        query: filters.query,
        selectedThemes: selectedThemeKeys,
        onlyExamList,
        sortBy: filters.sortBy,
      },
      cardOptions: (book) => {
        if (authUser?.role !== 'admin') {
          return undefined;
        }
        return {
          selectable: true,
          selected: selectedBookId === book.id,
          onSelect: (selectedBook) => {
            handleAdminBookSelection(selectedBook);
          },
        };
      },
    });
  }

  const themeFilterRenderer = createThemeFilterRenderer({
    pillsContainer: themeFilterPills,
    selectedThemeKeys,
    getThemes: () => availableThemes,
    getOnlyExamList: () => onlyExamList,
    setOnlyExamList: (value) => {
      onlyExamList = Boolean(value);
    },
    onChange: () => {
      renderBooks();
    },
  });

  function updateAvailableThemes() {
    availableThemes = collectUniqueThemes(allBooks);
    const availableKeys = new Set(availableThemes.map((theme) => theme.key));
    for (const key of Array.from(selectedThemeKeys)) {
      if (!availableKeys.has(key)) {
        selectedThemeKeys.delete(key);
      }
    }
    themeFilterRenderer.render();
    renderAdminThemeOptions();
  }

  function handleAdminBookSelection(book, options = {}) {
    if (!book || authUser?.role !== 'admin') return;
    selectedBookId = book.id;
    renderBooks();
    populateAdminBookForm(book, { silent: true });
    updateAdminBookDeleteButtonVisibility();
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
    updateAdminBookDeleteButtonVisibility();
    if (adminBookLookupMessage) {
      adminBookLookupMessage.textContent = '';
    }
    if (adminBookPublisher) {
      adminBookPublisher.value = '';
    }
    if (adminBookYear) {
      adminBookYear.value = '';
    }
    if (adminBookPages) {
      adminBookPages.value = '';
    }
    if (adminBookLanguage) {
      adminBookLanguage.value = '';
    }
    setSelectedAdminThemes([]);
    if (adminBookCover) {
      adminBookCover.value = '';
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
    if (adminBookPublisher) {
      adminBookPublisher.value = book.publisher || '';
    }
    if (adminBookYear) {
      const manualYear =
        book.publishedYear != null && String(book.publishedYear).trim()
          ? String(book.publishedYear)
          : extractYear(book.publishedAt || '');
      adminBookYear.value = manualYear || '';
    }
    if (adminBookPages) {
      const pageCount =
        book.pageCount != null && String(book.pageCount).trim()
          ? String(book.pageCount)
          : book.pages != null && String(book.pages).trim()
          ? String(book.pages)
          : '';
      adminBookPages.value = pageCount;
    }
    if (adminBookLanguage) {
      adminBookLanguage.value = book.language || '';
    }
    setSelectedAdminThemes(book.tags || []);
    if (adminBookCover) {
      adminBookCover.value = book.coverUrl || '';
    }
    if (adminBookExam) {
      adminBookExam.checked = Boolean(book.suitableForExamList);
    }
    if (adminBookSubmitButton) {
      adminBookSubmitButton.textContent = 'Boek bijwerken';
    }
    if (adminBookCancelButton) {
      adminBookCancelButton.classList.remove('hidden');
    }
    updateAdminBookDeleteButtonVisibility();
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
    if (adminBookPublisher && !adminBookPublisher.value && metadata.publisher) {
      adminBookPublisher.value = metadata.publisher;
    }
    if (adminBookYear && !adminBookYear.value) {
      const metadataYear = extractYear(
        metadata.publishedYear || metadata.publishedAt || metadata.publishDate || metadata.publish_date || ''
      );
      if (metadataYear) {
        adminBookYear.value = metadataYear;
      }
    }
    if (adminBookPages && !adminBookPages.value) {
      const metadataPages = resolvePageCount(metadata, {});
      if (metadataPages) {
        adminBookPages.value = `${metadataPages}`;
      }
    }
    if (adminBookLanguage && !adminBookLanguage.value && metadata.language) {
      const languageCandidate = String(metadata.language)
        .split(/[,;/\s]+/)
        .map((entry) => entry.trim())
        .find(Boolean);
      if (languageCandidate) {
        adminBookLanguage.value = languageCandidate.toLowerCase();
      }
    }
    if (adminBookTagsContainer && adminSelectedThemeKeys.size === 0) {
      const metadataTags = [];
      if (Array.isArray(metadata.subjects)) {
        for (const subject of metadata.subjects) {
          if (typeof subject === 'string' && subject.trim()) {
            metadataTags.push(subject.trim());
          }
        }
      }
      if (Array.isArray(metadata.themes)) {
        for (const theme of metadata.themes) {
          if (typeof theme === 'string' && theme.trim()) {
            metadataTags.push(theme.trim());
          }
        }
      }
      if (typeof metadata.subject === 'string' && metadata.subject.trim()) {
        metadataTags.push(metadata.subject.trim());
      }
      if (metadataTags.length) {
        const seen = new Set();
        const displayTags = [];
        for (const tag of metadataTags) {
          const key = tag.toLowerCase();
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          displayTags.push(tag);
          if (displayTags.length >= 8) {
            break;
          }
        }
        if (displayTags.length) {
          setSelectedAdminThemes(displayTags);
        }
      }
    }
    if (adminBookCover && !adminBookCover.value) {
      const metadataCoverUrl = extractMetadataCoverUrl(metadata);
      if (metadataCoverUrl) {
        adminBookCover.value = metadataCoverUrl;
      }
    }
  }

  function getTeacherClassIds() {
    if (!authUser) return [];
    if (authUser.role === 'admin') {
      return classes.map((klass) => klass.id);
    }
    return classes.filter((klass) => (klass.teacherIds || []).includes(authUser.id)).map((klass) => klass.id);
  }

  function pruneTeacherSelection(selection = new Set()) {
    const validIds = new Set(teachers.map((teacher) => teacher.id));
    for (const value of selection) {
      if (!validIds.has(value)) {
        selection.delete(value);
      }
    }
    return selection;
  }

  function filterTeachersBySearch(searchTerm = '', excludedIds = new Set()) {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return teachers
      .filter((teacher) => !excludedIds.has(teacher.id))
      .filter((teacher) => {
        if (!normalizedSearch) return true;
        const nameMatch = teacher.name?.toLowerCase().includes(normalizedSearch);
        const usernameMatch = teacher.username?.toLowerCase().includes(normalizedSearch);
        return nameMatch || usernameMatch;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));
  }

  function renderTeacherChip(container, teacher, options = {}) {
    if (!container || !teacher) return;
    const chip = appendElement(container, 'span', { className: 'teacher-chip' });
    if (!chip) return;
    appendTextElement(chip, 'span', teacher.name);
    if (teacher.username) {
      appendTextElement(chip, 'small', `(${teacher.username})`);
    }
    if (options.removeAttribute) {
      const removeButton = appendElement(chip, 'button', {
        className: 'teacher-chip__remove',
      });
      if (removeButton) {
        removeButton.type = 'button';
        removeButton.dataset[options.removeAttribute] = teacher.id;
        removeButton.textContent = '×';
        removeButton.setAttribute('aria-label', `Verwijder ${teacher.name}`);
      }
    }
  }

  function renderAdminClassSelectedTeacherChips() {
    if (!adminClassSelectedTeachers) return;
    pruneTeacherSelection(adminClassSelectedTeacherIds);
    adminClassSelectedTeachers.replaceChildren();
    if (!teachers.length) {
      appendTextElement(adminClassSelectedTeachers, 'p', 'Maak eerst docentaccounts aan.');
      return;
    }
    if (!adminClassSelectedTeacherIds.size) {
      appendTextElement(adminClassSelectedTeachers, 'p', 'Nog geen docenten geselecteerd.');
      return;
    }
    for (const teacherId of adminClassSelectedTeacherIds) {
      const teacher = teachers.find((entry) => entry.id === teacherId);
      renderTeacherChip(adminClassSelectedTeachers, teacher, {
        removeAttribute: 'removeAdminClassTeacher',
      });
    }
  }

  function renderAdminClassTeacherResults() {
    if (!adminClassTeacherResults) return;
    adminClassTeacherResults.replaceChildren();
    if (!teachers.length) {
      appendTextElement(adminClassTeacherResults, 'p', 'Nog geen docenten beschikbaar.');
      return;
    }
    const matches = filterTeachersBySearch(adminClassTeacherSearchTerm, adminClassSelectedTeacherIds);
    if (!matches.length) {
      appendTextElement(adminClassTeacherResults, 'p', 'Geen docenten gevonden.');
      return;
    }
    for (const teacher of matches) {
      const button = appendElement(adminClassTeacherResults, 'button');
      if (button) {
        button.type = 'button';
        button.dataset.addAdminClassTeacher = teacher.id;
        button.textContent = `${teacher.name}${teacher.username ? ` – ${teacher.username}` : ''}`;
      }
    }
  }

  function renderAdminClassTeacherSearch() {
    renderAdminClassSelectedTeacherChips();
    renderAdminClassTeacherResults();
    if (adminClassTeacherSearchInput) {
      adminClassTeacherSearchInput.value = adminClassTeacherSearchTerm;
      adminClassTeacherSearchInput.disabled = !teachers.length;
    }
  }

  function getClassTeacherSelection(classId, initialIds = []) {
    const current = classTeacherSelections.get(classId) || new Set();
    for (const teacherId of initialIds) {
      current.add(teacherId);
    }
    pruneTeacherSelection(current);
    classTeacherSelections.set(classId, current);
    return current;
  }

  function renderClassTeacherSelected(container, classId) {
    if (!container) return;
    const selection = getClassTeacherSelection(classId);
    container.replaceChildren();
    if (!teachers.length) {
      appendTextElement(container, 'p', 'Maak eerst docentaccounts aan.');
      return;
    }
    if (!selection.size) {
      appendTextElement(container, 'p', 'Nog geen docenten geselecteerd.');
      return;
    }
    for (const teacherId of selection) {
      const teacher = teachers.find((entry) => entry.id === teacherId);
      renderTeacherChip(container, teacher, { removeAttribute: 'removeClassTeacher' });
    }
  }

  function renderClassTeacherResults(container, classId, searchTerm = '') {
    if (!container) return;
    const selection = getClassTeacherSelection(classId);
    container.replaceChildren();
    if (!teachers.length) {
      appendTextElement(container, 'p', 'Nog geen docenten beschikbaar.');
      return;
    }
    const matches = filterTeachersBySearch(searchTerm, selection);
    if (!matches.length) {
      appendTextElement(container, 'p', 'Geen docenten gevonden.');
      return;
    }
    for (const teacher of matches) {
      const button = appendElement(container, 'button');
      if (button) {
        button.type = 'button';
        button.dataset.addClassTeacher = teacher.id;
        button.dataset.classId = classId;
        button.textContent = `${teacher.name}${teacher.username ? ` – ${teacher.username}` : ''}`;
      }
    }
  }

  function renderAdminTeacherSelect() {
    renderAdminClassTeacherSearch();
    updateAdminClassDetails();
  }

  function renderAdminTeacherAddOptions() {
    if (!adminTeacherAddClass) return;
    const isAdmin = authUser?.role === 'admin';
    const previousValue = adminTeacherAddClass.value || '';
    adminTeacherAddClass.replaceChildren();
    const placeholder = appendTextElement(adminTeacherAddClass, 'option', 'Geen klas koppelen');
    if (placeholder) {
      placeholder.value = '';
    }
    if (isAdmin) {
      const sortedClasses = [...classes].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', 'nl', { sensitivity: 'base' })
      );
      for (const klass of sortedClasses) {
        appendTextElement(adminTeacherAddClass, 'option', klass.name, {
          value: klass.id,
        });
      }
      adminTeacherAddClass.disabled = false;
      if (previousValue) {
        adminTeacherAddClass.value = previousValue;
        if (adminTeacherAddClass.value !== previousValue) {
          adminTeacherAddClass.value = '';
        }
      }
    } else {
      adminTeacherAddClass.disabled = true;
    }
    if (adminTeacherAddForm) {
      const elements = adminTeacherAddForm.querySelectorAll('input, select, button');
      elements.forEach((element) => {
        element.disabled = !isAdmin;
      });
    }
    if (!isAdmin && adminTeacherAddMessage) {
      adminTeacherAddMessage.textContent = '';
    }
  }

  function renderAdminClasses() {
    if (!adminClassSelect || !adminClassDetails) return;
    const classIds = new Set(classes.map((klass) => klass.id));
    for (const classId of Array.from(classTeacherSelections.keys())) {
      if (!classIds.has(classId)) {
        classTeacherSelections.delete(classId);
        classTeacherSearchTerms.delete(classId);
      }
    }
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
    for (const klass of sortedClasses) {
      classTeacherSelections.set(klass.id, pruneTeacherSelection(new Set(klass.teacherIds || [])));
    }
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
        label.setAttribute('for', `admin-teachers-search-${klass.id}`);
        label.textContent = 'Docenten koppelen';
      }
      const teacherPicker = appendElement(teacherForm, 'div', { className: 'teacher-picker' });
      const selectedContainer = appendElement(teacherPicker, 'div', {
        className: 'teacher-picker__selected',
      });
      const searchInput = appendElement(teacherPicker, 'input', {
        type: 'search',
        id: `admin-teachers-search-${klass.id}`,
        placeholder: 'Zoek op naam of gebruikersnaam',
        autocomplete: 'off',
      });
      const resultsContainer = appendElement(teacherPicker, 'div', {
        className: 'teacher-picker__results',
      });
      if (searchInput) {
        searchInput.dataset.classTeacherSearch = klass.id;
        searchInput.value = classTeacherSearchTerms.get(klass.id) || '';
      }
      if (selectedContainer) {
        selectedContainer.dataset.classTeacherSelected = klass.id;
      }
      if (resultsContainer) {
        resultsContainer.dataset.classTeacherResults = klass.id;
      }
      renderClassTeacherSelected(selectedContainer, klass.id);
      renderClassTeacherResults(resultsContainer, klass.id, searchInput?.value || '');
      appendTextElement(
        teacherForm,
        'p',
        teachers.length
          ? 'Zoek en voeg docenten toe om ze aan de klas te koppelen.'
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

  function renderAdminTeachers() {
    if (!adminTeacherList) return;
    const isAdmin = authUser?.role === 'admin';
    if (adminTeacherSearchInput) {
      adminTeacherSearchInput.disabled = !isAdmin;
      if (!isAdmin) {
        adminTeacherSearchInput.value = '';
      }
    }
    if (!isAdmin) {
      adminTeacherList.replaceChildren();
      selectedAdminTeacherId = '';
      renderAdminTeacherDetail();
      return;
    }
    setAdminTeacherStatus('');
    const rawQuery = adminTeacherSearchInput?.value || '';
    const query = rawQuery.trim().toLowerCase();
    adminTeacherList.replaceChildren();
    if (!teachers.length) {
      appendTextElement(adminTeacherList, 'p', 'Er zijn nog geen docentenaccounts.', {
        className: 'hint',
      });
      selectedAdminTeacherId = '';
      adminTeacherResetNotice.hide();
      renderAdminTeacherDetail();
      return;
    }
    if (!query) {
      appendTextElement(adminTeacherList, 'p', 'Gebruik het zoekveld om een docent te vinden.', {
        className: 'hint',
      });
      selectedAdminTeacherId = '';
      adminTeacherResetNotice.hide();
      renderAdminTeacherDetail();
      return;
    }
    const sortedTeachers = [...teachers].sort((a, b) =>
      a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' })
    );
    const filteredTeachers = sortedTeachers.filter((teacher) => {
      const haystack = `${teacher.name || ''} ${(teacher.username || '').toLowerCase()}`.toLowerCase();
      return haystack.includes(query);
    });
    if (selectedAdminTeacherId) {
      const exists = filteredTeachers.some((teacher) => teacher.id === selectedAdminTeacherId);
      if (!exists) {
        selectedAdminTeacherId = '';
        adminTeacherResetNotice.hide();
      }
    }
    if (!filteredTeachers.length) {
      appendTextElement(adminTeacherList, 'p', 'Geen docenten gevonden voor deze zoekopdracht.', {
        className: 'hint',
      });
      renderAdminTeacherDetail();
      return;
    }
    for (const teacher of filteredTeachers) {
      const selected = teacher.id === selectedAdminTeacherId;
      const item = appendElement(adminTeacherList, 'button', {
        className: [
          'student-list__item',
          'student-list__item--selectable',
          selected ? 'student-list__item--active' : '',
        ]
          .join(' ')
          .trim(),
        dataset: {
          selectTeacher: 'true',
          teacherId: teacher.id,
        },
        attributes: {
          type: 'button',
        },
        aria: {
          pressed: selected ? 'true' : 'false',
        },
      });
      if (!item) continue;

      item.textContent = teacher.name || teacher.username || 'Naam onbekend';
    }
    renderAdminTeacherDetail();
  }

  function renderAdminTeacherDetail() {
    if (!adminTeacherDetailPlaceholder || !adminTeacherDetailContent) {
      return;
    }
    const isAdmin = authUser?.role === 'admin';
    if (!isAdmin) {
      adminTeacherDetailPlaceholder.classList.remove('hidden');
      adminTeacherDetailContent.classList.add('hidden');
      adminTeacherDetailContent.dataset.teacherId = '';
      if (adminTeacherDetailMessage) {
        adminTeacherDetailMessage.textContent = '';
        delete adminTeacherDetailMessage.dataset.teacherId;
      }
      if (adminTeacherPasswordInput) {
        adminTeacherPasswordInput.value = '';
      }
      if (adminTeacherClassesForm) {
        adminTeacherClassesForm.dataset.teacherId = '';
      }
      if (adminTeacherPasswordForm) {
        adminTeacherPasswordForm.dataset.teacherId = '';
      }
      if (adminTeacherDeleteButton) {
        adminTeacherDeleteButton.dataset.teacherId = '';
        adminTeacherDeleteButton.disabled = true;
      }
      adminTeacherResetNotice.hide();
      return;
    }
    const teacher = teachers.find((entry) => entry.id === selectedAdminTeacherId);
    if (!teacher) {
      adminTeacherDetailPlaceholder.classList.remove('hidden');
      adminTeacherDetailContent.classList.add('hidden');
      adminTeacherDetailContent.dataset.teacherId = '';
      if (adminTeacherDetailMessage) {
        if (adminTeacherDetailMessage.dataset.teacherId) {
          adminTeacherDetailMessage.textContent = '';
          delete adminTeacherDetailMessage.dataset.teacherId;
        }
      }
      if (adminTeacherPasswordInput) {
        adminTeacherPasswordInput.value = '';
      }
      if (adminTeacherClassesForm) {
        adminTeacherClassesForm.dataset.teacherId = '';
      }
      if (adminTeacherPasswordForm) {
        adminTeacherPasswordForm.dataset.teacherId = '';
      }
      if (adminTeacherDeleteButton) {
        adminTeacherDeleteButton.dataset.teacherId = '';
        adminTeacherDeleteButton.disabled = true;
      }
      adminTeacherResetNotice.hide();
      return;
    }
    const previousTeacherId = adminTeacherDetailContent.dataset.teacherId || '';
    adminTeacherDetailPlaceholder.classList.add('hidden');
    adminTeacherDetailContent.classList.remove('hidden');
    adminTeacherDetailContent.dataset.teacherId = teacher.id;
    if (adminTeacherDetailName) {
      adminTeacherDetailName.textContent = teacher.name || 'Docent';
    }
    if (adminTeacherDetailUsername) {
      adminTeacherDetailUsername.textContent = teacher.username || 'Onbekend';
    }
    if (adminTeacherDetailMessage) {
      if (adminTeacherDetailMessage.dataset.teacherId !== teacher.id) {
        adminTeacherDetailMessage.textContent = '';
      }
      adminTeacherDetailMessage.dataset.teacherId = teacher.id;
    }
    if (adminTeacherPasswordInput && previousTeacherId !== teacher.id) {
      adminTeacherPasswordInput.value = '';
    }
    if (adminTeacherClassesForm) {
      adminTeacherClassesForm.dataset.teacherId = teacher.id;
    }
    if (adminTeacherPasswordForm) {
      adminTeacherPasswordForm.dataset.teacherId = teacher.id;
    }
    if (adminTeacherDeleteButton) {
      adminTeacherDeleteButton.dataset.teacherId = teacher.id;
      adminTeacherDeleteButton.disabled = false;
    }
    if (adminTeacherClassList) {
      adminTeacherClassList.replaceChildren();
      const teacherClassIds = Array.isArray(teacher.classIds) ? teacher.classIds : [];
      const sortedClasses = [...classes].sort((a, b) =>
        a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' })
      );
      if (!sortedClasses.length) {
        appendTextElement(adminTeacherClassList, 'p', 'Nog geen klassen aangemaakt.', {
          className: 'hint',
        });
      } else {
        for (const klass of sortedClasses) {
          const label = appendElement(adminTeacherClassList, 'label', {
            className: 'admin-teacher-class-option',
          });
          if (!label) continue;
          const checkbox = appendElement(label, 'input', {
            attributes: { type: 'checkbox' },
          });
          if (checkbox) {
            checkbox.type = 'checkbox';
            checkbox.value = klass.id;
            checkbox.checked = teacherClassIds.includes(klass.id);
          }
          appendTextElement(label, 'span', klass.name);
        }
      }
      const submitButton = adminTeacherClassesForm?.querySelector('button[type="submit"]');
      if (submitButton) {
        submitButton.disabled = !sortedClasses.length;
      }
    }
  }

  function getStudentClasses(student) {
    if (!student) {
      return [];
    }
    return (student.classIds || [])
      .map((classId) => classes.find((klass) => klass.id === classId))
      .filter(Boolean);
  }

  function matchesAdminStudentSearch(student, normalizedTerm) {
    if (!normalizedTerm) {
      return false;
    }
    const haystack = [
      student.name,
      student.username,
      student.grade,
      ...getStudentClasses(student).map((klass) => klass.name),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedTerm);
  }

  function renderAdminStudents() {
    if (!adminStudentList) return;
    adminStudentList.replaceChildren();
    if (!authUser || authUser.role !== 'admin') {
      renderSelectedAdminStudent();
      return;
    }
    if (!students.length) {
      replaceWithTextElement(
        adminStudentList,
        'p',
        'Er zijn nog geen leerlingaccounts.'
      );
      renderSelectedAdminStudent();
      return;
    }
    const normalizedSearch = adminStudentSearchTerm.trim().toLowerCase();
    if (!normalizedSearch) {
      replaceWithTextElement(
        adminStudentList,
        'p',
        'Gebruik het zoekveld om een leerling te vinden.',
        { className: 'hint' }
      );
      selectedAdminStudentId = '';
      renderSelectedAdminStudent();
      return;
    }
    const filteredStudents = students.filter((student) =>
      matchesAdminStudentSearch(student, normalizedSearch)
    );
    if (selectedAdminStudentId && !filteredStudents.some((entry) => entry.id === selectedAdminStudentId)) {
      selectedAdminStudentId = '';
    }
    if (!filteredStudents.length) {
      replaceWithTextElement(adminStudentList, 'p', 'Geen leerlingen gevonden.');
      renderSelectedAdminStudent();
      return;
    }
    for (const student of filteredStudents) {
      const borrowed = student.borrowedBooks?.length || 0;
      const studentClasses = getStudentClasses(student);
      const item = appendElement(adminStudentList, 'article', {
        className: 'student-list__item student-list__item--selectable',
      });
      if (!item) continue;
      item.dataset.studentId = student.id;
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      if (student.id === selectedAdminStudentId) {
        item.classList.add('student-list__item--active');
      }
      appendTextElement(item, 'strong', student.name);
      const metaLine = appendElement(item, 'div', { className: 'student-list__meta' });
      if (metaLine) {
        appendTextElement(metaLine, 'span', `Gebruikersnaam: ${student.username}`);
        appendTextElement(metaLine, 'span', `Leerjaar: ${student.grade || 'Onbekend'}`);
        appendTextElement(metaLine, 'span', `${borrowed} uitgeleende boek(en)`);
      }
      const classesLine = appendElement(item, 'div', { className: 'student-list__meta' });
      if (classesLine) {
        const text = studentClasses.length
          ? `Gekoppeld aan: ${studentClasses.map((klass) => klass.name).join(', ')}`
          : 'Nog niet gekoppeld aan een klas';
        appendTextElement(classesLine, 'span', text);
      }
    }
    renderSelectedAdminStudent();
  }

  function renderStudentLoanHistory({ studentId, loading = false } = {}) {
    if (!adminStudentDetailLoansList) return;
    adminStudentDetailLoansList.replaceChildren();
    if (!studentId) return;
    if (loading) {
      appendTextElement(adminStudentDetailLoansList, 'p', 'Uitleenlog wordt geladen…', {
        className: 'hint',
      });
      return;
    }
    if (selectedAdminStudentLoansError) {
      appendTextElement(adminStudentDetailLoansList, 'p', selectedAdminStudentLoansError, {
        className: 'error',
      });
      return;
    }
    const loans = Array.isArray(selectedAdminStudentLoanEntries)
      ? selectedAdminStudentLoanEntries
      : [];
    if (!loans.length) {
      appendTextElement(adminStudentDetailLoansList, 'p', 'Geen uitleenactiviteiten gevonden.', {
        className: 'hint',
      });
      return;
    }
    const list = appendElement(adminStudentDetailLoansList, 'ul');
    for (const entry of loans) {
      const li = appendElement(list, 'li');
      if (!li) continue;
      const timestamp = entry?.timestamp ? new Date(entry.timestamp) : null;
      const formattedTime = timestamp && !Number.isNaN(timestamp.getTime())
        ? timestamp.toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })
        : '';
      const book = allBooks.find((item) => item.id === entry.bookId);
      const fallbackMessage = entry?.type === 'check_in' ? 'Boek ingeleverd' : 'Boek uitgeleend';
      const message = entry?.message || `${fallbackMessage}${book ? `: ${book.title}` : ''}`;
      if (formattedTime) {
        appendTextElement(li, 'span', formattedTime, { className: 'history-item__time' });
      }
      appendTextElement(li, 'span', message);
    }
  }

  async function loadStudentLoanHistory(studentId) {
    if (!adminStudentDetailLoansList || !studentId) return;
    selectedAdminStudentLoanEntries = [];
    selectedAdminStudentLoansError = '';
    const requestId = Date.now();
    studentLoanRequestToken = requestId;
    renderStudentLoanHistory({ studentId, loading: true });
    try {
      const result = await fetchJson(`/api/students/${studentId}/loans`);
      if (studentLoanRequestToken !== requestId) return;
      selectedAdminStudentLoanEntries = Array.isArray(result) ? result : [];
      renderStudentLoanHistory({ studentId });
    } catch (error) {
      if (studentLoanRequestToken !== requestId) return;
      selectedAdminStudentLoansError = error?.message || 'Kon uitleenlog niet laden.';
      renderStudentLoanHistory({ studentId });
    }
  }

  function renderSelectedAdminStudent() {
    if (!adminStudentDetailPlaceholder || !adminStudentDetailContent) {
      return;
    }
    const isAdmin = authUser?.role === 'admin';
    const student = isAdmin
      ? students.find((entry) => entry.id === selectedAdminStudentId)
      : null;
    const hasSelection = Boolean(student);
    if (adminStudentDetail) {
      adminStudentDetail.classList.toggle('hidden', !hasSelection);
    }
    adminStudentDetailContent.classList.toggle('hidden', !hasSelection);
    adminStudentDetailPlaceholder.classList.toggle('hidden', hasSelection);
    if (!hasSelection) {
      if (adminStudentDetailMessage) {
        adminStudentDetailMessage.textContent = '';
      }
      if (adminStudentDetailPasswordInput) {
        adminStudentDetailPasswordInput.value = '';
      }
      if (adminStudentDetailClasses) {
        adminStudentDetailClasses.replaceChildren();
      }
      if (adminStudentDetailLoansList) {
        adminStudentDetailLoansList.replaceChildren();
      }
      selectedAdminStudentLoanEntries = [];
      selectedAdminStudentLoansError = '';
      selectedAdminStudentLoanStudentId = '';
      if (adminStudentDetailGrade) {
        adminStudentDetailGrade.textContent = '';
      }
      if (adminStudentDetailLoansMeta) {
        adminStudentDetailLoansMeta.textContent = '';
      }
      if (adminStudentDetailClassSelect) {
        adminStudentDetailClassSelect.value = '';
        adminStudentDetailClassSelect.disabled = true;
      }
      const submitButton = adminStudentDetailClassForm?.querySelector('button[type="submit"]');
      if (submitButton) {
        submitButton.disabled = true;
      }
      if (adminStudentDetailRemoveButton) {
        adminStudentDetailRemoveButton.dataset.studentId = '';
        adminStudentDetailRemoveButton.disabled = true;
      }
      Array.from(adminStudentList?.querySelectorAll('.student-list__item--selectable') ?? []).forEach(
        (item) => {
          item.classList.toggle('student-list__item--active', false);
        }
      );
      return;
    }

    adminStudentDetailName && (adminStudentDetailName.textContent = student.name);
    adminStudentDetailUsername && (adminStudentDetailUsername.textContent = student.username || '');
    if (adminStudentDetailGrade) {
      adminStudentDetailGrade.textContent = student.grade
        ? `Leerjaar: ${student.grade}`
        : 'Leerjaar niet ingesteld';
    }
    const borrowedCount = Array.isArray(student.borrowedBooks) ? student.borrowedBooks.length : 0;
    if (adminStudentDetailLoansMeta) {
      adminStudentDetailLoansMeta.textContent = borrowedCount
        ? `${borrowedCount} uitgeleende boek(en)`
        : 'Geen uitleningen';
    }
    if (adminStudentDetailMessage) {
      adminStudentDetailMessage.textContent = '';
    }
    if (adminStudentDetailPasswordInput) {
      adminStudentDetailPasswordInput.value = '';
    }
    if (adminStudentDetailPasswordForm) {
      adminStudentDetailPasswordForm.dataset.studentId = student.id;
    }
    if (adminStudentDetailClassForm) {
      adminStudentDetailClassForm.dataset.studentId = student.id;
    }

    if (adminStudentDetailClasses) {
      adminStudentDetailClasses.replaceChildren();
      const studentClasses = getStudentClasses(student).sort((a, b) =>
        a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' })
      );
      if (!studentClasses.length) {
        appendTextElement(adminStudentDetailClasses, 'p', 'Nog niet gekoppeld aan een klas.', {
          className: 'hint',
        });
      } else {
        const list = appendElement(adminStudentDetailClasses, 'ul');
        for (const klass of studentClasses) {
          const item = appendElement(list, 'li');
          if (!item) continue;
          appendTextElement(item, 'span', klass.name);
          appendTextElement(item, 'button', `Uit ${klass.name} verwijderen`, {
            className: 'btn btn--ghost',
            type: 'button',
            dataset: {
              removeClassId: klass.id,
              studentId: student.id,
            },
          });
        }
      }
    }

    if (adminStudentDetailClassSelect) {
      const previousValue = adminStudentDetailClassSelect.value;
      adminStudentDetailClassSelect.replaceChildren();
      const placeholder = appendTextElement(adminStudentDetailClassSelect, 'option', 'Kies een klas…');
      if (placeholder) {
        placeholder.value = '';
      }
      const assignedIds = new Set(student.classIds || []);
      const availableClasses = classes
        .filter((klass) => !assignedIds.has(klass.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));
      for (const klass of availableClasses) {
        const option = appendTextElement(adminStudentDetailClassSelect, 'option', klass.name);
        if (option) {
          option.value = klass.id;
        }
      }
      const hasOptions = availableClasses.length > 0;
      adminStudentDetailClassSelect.disabled = !hasOptions;
      const submitButton = adminStudentDetailClassForm?.querySelector('button[type="submit"]');
      if (submitButton) {
        submitButton.disabled = !hasOptions;
      }
      if (hasOptions && previousValue && availableClasses.some((klass) => klass.id === previousValue)) {
        adminStudentDetailClassSelect.value = previousValue;
      } else {
        adminStudentDetailClassSelect.value = '';
      }
    }

    if (adminStudentDetailLoansList) {
      const isSameStudent = selectedAdminStudentLoanStudentId === student.id;
      if (!isSameStudent) {
        selectedAdminStudentLoanStudentId = student.id;
        selectedAdminStudentLoanEntries = [];
        selectedAdminStudentLoansError = '';
        loadStudentLoanHistory(student.id);
      } else {
        renderStudentLoanHistory({ studentId: student.id });
      }
    }

    if (adminStudentDetailRemoveButton) {
      adminStudentDetailRemoveButton.dataset.studentId = student.id;
      adminStudentDetailRemoveButton.disabled = false;
    }

    Array.from(adminStudentList?.querySelectorAll('.student-list__item--selectable') ?? []).forEach(
      (item) => {
        item.classList.toggle('student-list__item--active', item.dataset.studentId === student.id);
      }
    );
  }

  function applyUpdatedStudent(updatedStudent) {
    if (!updatedStudent?.id) {
      return;
    }
    const index = students.findIndex((entry) => entry.id === updatedStudent.id);
    if (index === -1) {
      students.push(updatedStudent);
    } else {
      students[index] = { ...students[index], ...updatedStudent };
    }
  }

  function setSelectedAdminStudent(studentId) {
    const normalized = studentId || '';
    if (selectedAdminStudentId === normalized) {
      renderSelectedAdminStudent();
      return;
    }
    selectedAdminStudentId = normalized;
    renderAdminStudents();
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
    const books = Array.isArray(result.books) ? result.books : [];
    const skipped = Array.isArray(result.skipped) ? result.skipped : [];

    if (books.length) {
      const list = appendElement(container, 'ul', {
        className: 'import-results__list',
      });
      for (const book of books) {
        const item = appendElement(list, 'li');
        appendTextElement(item, 'strong', book?.title || 'Onbekende titel');
        if (book?.status) {
          const statusLabel = book.status === 'updated' ? 'Bijgewerkt boek' : 'Nieuw boek';
          appendImportMeta(item, 'Status', statusLabel);
        }
        appendImportMeta(item, 'Auteur', book?.author);
        appendImportMeta(item, 'Barcode', book?.barcode);
        appendImportMeta(item, 'Uitgever', book?.publisher);
        appendImportMeta(item, 'Jaar', book?.publishedYear);
        appendImportMeta(item, 'Pagina’s', book?.pageCount);
        appendImportMeta(item, 'Taal', book?.language);
        if (Array.isArray(book?.tags) && book.tags.length) {
          appendImportMeta(item, 'Thema’s', book.tags);
        }
      }
    } else if (accounts.length) {
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
        const reason = entry?.reason || 'Onbekende reden';
        const name = entry?.title || entry?.name || '';
        const identifier =
          entry?.barcode || entry?.isbn || entry?.username || entry?.author || '';
        const labelParts = [];
        if (name) {
          labelParts.push(name);
        }
        if (identifier) {
          labelParts.push(identifier);
        }
        const summary = labelParts.length ? labelParts.join(' – ') : '(onbekend)';
        item.textContent = `${summary} – ${reason}`;
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

  async function loadBooks() {
    try {
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
    } catch (error) {
      if (bookGrid) {
        const message =
          error && error.message
            ? `Kan boeken niet laden: ${error.message}`
            : 'Kan boeken niet laden: onbekende fout.';
        replaceWithTextElement(bookGrid, 'p', message, {
          className: 'book-grid__status',
          role: 'status',
        });
      }
      throw error;
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
    const manageableClassIds = new Set(getTeacherClassIds());
    for (const klass of classes) {
      const article = appendElement(classList, 'article', { className: 'class-card' });
      if (!article) continue;

      const header = appendElement(article, 'header', {
        className: 'class-card__header',
        dataset: { classId: klass.id, className: klass.name },
      });
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
            const li = appendElement(memberList, 'li', {
              className: 'class-card__student',
              dataset: { studentId: member.id, studentName: member.name },
            });
            if (!li) continue;
            const info = appendElement(li, 'div', {
              className: 'class-card__student-info',
            });
            if (info) {
              appendTextElement(info, 'strong', member.name);
              if (member.borrowedBooks?.length) {
                info.append(' ');
                appendTextElement(
                  info,
                  'span',
                  `${member.borrowedBooks.length} boek(en) mee`
                );
              }
            }
            const actions = appendElement(li, 'div', {
              className: 'class-card__student-actions',
            });
            if (actions) {
              const sharedClassIds = (member.classIds || []).filter((classId) =>
                manageableClassIds.has(classId)
              );
              if (sharedClassIds.length) {
                appendElement(actions, 'button', {
                  className: 'btn btn--ghost btn--compact',
                  type: 'button',
                  textContent: 'Wachtwoord resetten',
                  dataset: {
                    resetPassword: 'true',
                    studentId: member.id,
                    studentName: member.name,
                  },
                });
                for (const classId of sharedClassIds) {
                  const className = classes.find((entry) => entry.id === classId)?.name;
                  appendElement(actions, 'button', {
                    className: 'btn btn--danger btn--compact',
                    type: 'button',
                    textContent: className
                      ? `Uit ${className} verwijderen`
                      : 'Uit klas verwijderen',
                    dataset: {
                      removeFromClass: 'true',
                      classId,
                      studentId: member.id,
                    },
                  });
                }
              } else {
                appendTextElement(actions, 'span', 'Geen beheerrechten voor deze leerling.', {
                  className: 'hint',
                });
              }
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

  function renderStudentStats(container, stats, studentName) {
    const list = appendElement(container, 'dl', { className: 'stats-modal__list' });
    const totalBorrowed =
      stats?.totalBorrowed ?? stats?.borrowCount ?? stats?.borrowedCount ?? stats?.borrowFrequency ?? 0;
    appendTextElement(list, 'dt', 'Uitleenfrequentie');
    appendTextElement(list, 'dd', `${totalBorrowed} uitleenmoment(en)`);

    const activeLoans = Array.isArray(stats?.activeLoans)
      ? stats.activeLoans
      : Array.isArray(stats?.currentLoans)
      ? stats.currentLoans
      : [];
    const loanSection = appendElement(container, 'div', { className: 'stats-modal__section' });
    appendTextElement(loanSection, 'h4', 'Huidige leningen');
    if (!activeLoans.length) {
      appendTextElement(loanSection, 'p', `${studentName} heeft momenteel geen leningen.`);
    } else {
      const ul = appendElement(loanSection, 'ul', { className: 'stats-modal__items' });
      for (const loan of activeLoans) {
        const label = loan?.title || loan?.name || 'Onbekend boek';
        appendTextElement(ul, 'li', label);
      }
    }

    const lastReadDate =
      stats?.lastReadAt || stats?.lastBorrowedAt || stats?.lastBorrowed || stats?.lastRead;
    const lastReadSection = appendElement(container, 'div', { className: 'stats-modal__section' });
    appendTextElement(lastReadSection, 'h4', 'Laatst gelezen');
    appendTextElement(
      lastReadSection,
      'p',
      lastReadDate ? formatDate(lastReadDate) : 'Nog geen leesactiviteiten geregistreerd.'
    );
  }

  function renderClassStats(container, stats, className) {
    const list = appendElement(container, 'dl', { className: 'stats-modal__list' });
    const totalBorrowed =
      stats?.totalBorrowedBooks ?? stats?.totalBorrowed ?? stats?.borrowCount ?? stats?.borrowedCount ?? 0;
    const activeLoans = stats?.activeLoans ?? stats?.currentLoans ?? stats?.activeLoanCount ?? 0;
    const activeStudents = stats?.activeStudents ?? stats?.activeReaders ?? stats?.readerCount;

    appendTextElement(list, 'dt', 'Totaal uitgeleend');
    appendTextElement(list, 'dd', `${totalBorrowed} uitleenmoment(en)`);

    appendTextElement(list, 'dt', 'Actieve leningen');
    appendTextElement(list, 'dd', `${activeLoans || 0}`);

    if (activeStudents != null) {
      appendTextElement(list, 'dt', 'Actieve lezers');
      appendTextElement(list, 'dd', `${activeStudents}`);
    }

    const topReaders = Array.isArray(stats?.topReaders) ? stats.topReaders : [];
    const readersSection = appendElement(container, 'div', { className: 'stats-modal__section' });
    appendTextElement(readersSection, 'h4', 'Actiefste lezers');
    if (!topReaders.length) {
      appendTextElement(readersSection, 'p', `Geen lezerstatistieken beschikbaar voor ${className}.`);
    } else {
      const listEl = appendElement(readersSection, 'ol', { className: 'stats-modal__items' });
      for (const reader of topReaders) {
        const name = reader?.name || 'Onbekende leerling';
        const count = reader?.borrowCount ?? reader?.totalBorrowed ?? reader?.borrowedCount ?? 0;
        appendTextElement(listEl, 'li', `${name} — ${count} uitleenmoment(en)`);
      }
    }
  }

  function openStudentStats(studentId, studentName) {
    if (!studentId) return;
    const displayName = studentName || 'leerling';
    statsModal.open({
      titleText: `Statistieken van ${displayName}`,
      async render({ container, clearStatus, setStatus }) {
        try {
          const stats = await fetchJson(`/api/students/${studentId}/stats`);
          container.replaceChildren();
          clearStatus();
          renderStudentStats(container, stats, displayName);
        } catch (error) {
          setStatus(error?.message || 'Kon leerlingstatistieken niet ophalen.');
        }
      },
    });
  }

  function openClassStats(classId, className) {
    if (!classId) return;
    const displayName = className || 'deze klas';
    statsModal.open({
      titleText: `Statistieken voor ${displayName}`,
      async render({ container, clearStatus, setStatus }) {
        try {
          const stats = await fetchJson(`/api/classes/${classId}/stats`);
          container.replaceChildren();
          clearStatus();
          renderClassStats(container, stats, displayName);
        } catch (error) {
          setStatus(error?.message || 'Kon klasstatistieken niet ophalen.');
        }
      },
    });
  }

  async function loadClasses() {
    classes = await fetchJson('/api/classes');
    renderClasses();
    renderTeacherStudentClassSelect();
    renderAdminTeacherAddOptions();
    renderAdminClasses();
    renderAdminTeachers();
    renderAdminStudents();
  }

  async function loadTeachers() {
    adminTeacherResetNotice.hide();
    if (!authUser || authUser.role !== 'admin') {
      teachers = [];
      renderAdminTeacherSelect();
      renderAdminTeachers();
      setAdminTeacherStatus('');
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
    await Promise.all([loadBooks(), loadSummary()]);
    await loadStudents();
    if (authUser.role === 'admin') {
      await loadTeachers();
    } else {
      teachers = [];
      renderAdminTeacherSelect();
      renderAdminTeachers();
      setAdminTeacherStatus('');
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

  adminStudentSearchInput?.addEventListener('input', () => {
    adminStudentSearchTerm = adminStudentSearchInput.value || '';
    renderAdminStudents();
  });

  adminTeacherSearchInput?.addEventListener('input', () => {
    renderAdminTeachers();
  });

  adminClassTeacherSearchInput?.addEventListener('input', () => {
    adminClassTeacherSearchTerm = adminClassTeacherSearchInput.value;
    renderAdminClassTeacherResults();
  });

  sortSelect?.addEventListener('change', () => {
    filters.sortBy = sortSelect.value || 'title';
    updateSortControlAccessibility(sortSelect, filters.sortBy, {
      baseLabel: 'Sorteer de boeken',
      gridId: 'book-grid',
    });
    renderBooks();
  });

  adminTeacherAddForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (adminTeacherAddMessage) {
      adminTeacherAddMessage.textContent = '';
    }
    if (!authUser || authUser.role !== 'admin') {
      if (adminTeacherAddMessage) {
        adminTeacherAddMessage.textContent = 'Alleen beheerders kunnen docenten toevoegen.';
      }
      return;
    }
    const name = adminTeacherAddName?.value?.trim() || '';
    const username = adminTeacherAddUsername?.value?.trim() || '';
    const temporaryPassword = adminTeacherAddPassword?.value?.trim() || '';
    const classId = adminTeacherAddClass?.value?.trim() || '';
    if (!name || !username) {
      if (adminTeacherAddMessage) {
        adminTeacherAddMessage.textContent = 'Vul naam en gebruikersnaam in.';
      }
      return;
    }
    if (adminTeacherAddSubmit) {
      adminTeacherAddSubmit.disabled = true;
    }
    if (adminTeacherAddMessage) {
      adminTeacherAddMessage.textContent = 'Docent wordt toegevoegd…';
    }
    try {
      const body = { name, username };
      if (temporaryPassword) {
        body.temporaryPassword = temporaryPassword;
      }
      if (classId) {
        body.classIds = [classId];
      }
      const result = await fetchJson('/api/teachers', {
        method: 'POST',
        body,
      });
      const teacherName = result?.teacher?.name || name;
      const passwordToShow = result?.temporaryPassword || temporaryPassword;
      if (adminTeacherAddMessage) {
        adminTeacherAddMessage.textContent = passwordToShow
          ? `${teacherName} is toegevoegd. Tijdelijk wachtwoord: ${passwordToShow}.`
          : `${teacherName} is toegevoegd.`;
      }
      adminTeacherAddForm.reset();
      renderAdminTeacherAddOptions();
      adminTeacherAddName?.focus();
      try {
        await refreshStaffData();
      } catch (refreshError) {
        if (adminTeacherAddMessage) {
          adminTeacherAddMessage.textContent = `${teacherName} is toegevoegd, maar verversen mislukt: ${refreshError.message}`;
        }
      }
    } catch (error) {
      if (adminTeacherAddMessage) {
        adminTeacherAddMessage.textContent = error.message;
      }
    } finally {
      if (adminTeacherAddSubmit) {
        adminTeacherAddSubmit.disabled = false;
      }
    }
  });

  adminTeacherAddPasswordGenerateButton?.addEventListener('click', () => {
    if (!adminTeacherAddPassword) {
      return;
    }
    const password = generateTemporaryPassword(10);
    adminTeacherAddPassword.value = password;
    adminTeacherAddPassword.focus();
    adminTeacherAddPassword.select();
    if (adminTeacherAddMessage) {
      adminTeacherAddMessage.textContent =
        'Tijdelijk wachtwoord ingevuld. Verstuur het formulier om de docent toe te voegen.';
    }
  });

  adminStudentPasswordGenerateButton?.addEventListener('click', () => {
    if (!adminStudentPasswordInput) {
      return;
    }
    const password = generateTemporaryPassword(10);
    adminStudentPasswordInput.value = password;
    adminStudentPasswordInput.focus();
    adminStudentPasswordInput.select();
    if (adminStudentMessage) {
      adminStudentMessage.textContent =
        'Tijdelijk wachtwoord ingevuld. Verstuur het formulier om het account aan te maken.';
    }
  });

  classList?.addEventListener('click', async (event) => {
    const studentItem = event.target.closest('.class-card__student');
    const classHeader = event.target.closest('.class-card__header');
    const interactiveTarget = event.target.closest('button, a, input, select, textarea');
    if (!interactiveTarget && studentItem && classList.contains(studentItem)) {
      openStudentStats(studentItem.dataset.studentId, studentItem.dataset.studentName);
      return;
    }
    if (!interactiveTarget && classHeader && classList.contains(classHeader)) {
      openClassStats(classHeader.dataset.classId, classHeader.dataset.className);
      return;
    }

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

    const removeButton = event.target.closest('[data-remove-from-class]');
    if (!removeButton) {
      return;
    }
    if (!authUser || !['teacher', 'admin'].includes(authUser.role)) {
      if (classMessage) {
        classMessage.textContent = 'Alleen medewerkers kunnen leerlingen beheren.';
      }
      return;
    }
    const classId = removeButton.dataset.classId;
    const studentId = removeButton.dataset.studentId;
    if (!classId || !studentId) return;
    teacherResetNotice.hide();
    if (!window.confirm('Leerling uit deze klas verwijderen?')) {
      return;
    }
    try {
      await fetchJson(`/api/classes/${classId}/students/${studentId}`, { method: 'DELETE' });
      const klass = classes.find((entry) => entry.id === classId);
      if (classMessage) {
        classMessage.textContent = klass
          ? `Leerling verwijderd uit ${klass.name}.`
          : 'Leerling verwijderd uit de klas.';
      }
      resetAdminBookForm();
      await refreshStaffData();
    } catch (error) {
      if (classMessage) {
        classMessage.textContent = error.message;
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

  adminClassTeacherResults?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-admin-class-teacher]');
    if (!button) return;
    adminClassSelectedTeacherIds.add(button.dataset.addAdminClassTeacher);
    adminClassTeacherSearchTerm = '';
    if (adminClassTeacherSearchInput) {
      adminClassTeacherSearchInput.value = '';
    }
    renderAdminClassTeacherSearch();
  });

  adminClassSelectedTeachers?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-admin-class-teacher]');
    if (!button) return;
    adminClassSelectedTeacherIds.delete(button.dataset.removeAdminClassTeacher);
    renderAdminClassTeacherSearch();
  });

  if (adminClassForm) {
    adminClassForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!authUser || authUser.role !== 'admin') {
        adminClassMessage.textContent = 'Alleen beheerders kunnen klassen beheren.';
        return;
      }
      const name = adminClassNameInput.value.trim();
      const teacherIds = Array.from(pruneTeacherSelection(adminClassSelectedTeacherIds));
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
        adminClassSelectedTeacherIds = new Set();
        adminClassTeacherSearchTerm = '';
        renderAdminClassTeacherSearch();
        adminClassMessage.textContent = 'Klas opgeslagen.';
        await refreshStaffData();
      } catch (error) {
        adminClassMessage.textContent = error.message;
      }
    });

    adminClassForm.addEventListener('reset', () => {
      adminClassSelectedTeacherIds = new Set();
      adminClassTeacherSearchTerm = '';
      renderAdminClassTeacherSearch();
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

  adminClassDetails?.addEventListener('input', (event) => {
    const searchInput = event.target.closest('[data-class-teacher-search]');
    if (!searchInput) return;
    const classId = searchInput.dataset.classTeacherSearch;
    classTeacherSearchTerms.set(classId, searchInput.value);
    const teacherForm = searchInput.closest('[data-class-teacher-form]');
    const resultsContainer = teacherForm?.querySelector('[data-class-teacher-results]');
    renderClassTeacherResults(resultsContainer, classId, searchInput.value);
  });

  adminClassDetails?.addEventListener('click', (event) => {
    const addButton = event.target.closest('[data-add-class-teacher]');
    if (addButton) {
      const classId = addButton.dataset.classId;
      const selection = getClassTeacherSelection(classId);
      selection.add(addButton.dataset.addClassTeacher);
      const teacherForm = addButton.closest('[data-class-teacher-form]');
      const selectedContainer = teacherForm?.querySelector('[data-class-teacher-selected]');
      const resultsContainer = teacherForm?.querySelector('[data-class-teacher-results]');
      renderClassTeacherSelected(selectedContainer, classId);
      renderClassTeacherResults(resultsContainer, classId, classTeacherSearchTerms.get(classId) || '');
      return;
    }
    const removeButton = event.target.closest('[data-remove-class-teacher]');
    if (removeButton) {
      const teacherForm = removeButton.closest('[data-class-teacher-form]');
      const classId = teacherForm?.dataset.classId;
      if (!classId) return;
      const selection = getClassTeacherSelection(classId);
      selection.delete(removeButton.dataset.removeClassTeacher);
      const selectedContainer = teacherForm?.querySelector('[data-class-teacher-selected]');
      const resultsContainer = teacherForm?.querySelector('[data-class-teacher-results]');
      renderClassTeacherSelected(selectedContainer, classId);
      renderClassTeacherResults(resultsContainer, classId, classTeacherSearchTerms.get(classId) || '');
    }
  });

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
        const selection = getClassTeacherSelection(classId);
        const teacherIds = Array.from(pruneTeacherSelection(selection));
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

  adminTeacherList?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-select-teacher]');
    if (!item) {
      return;
    }
    const teacherId = item.dataset.teacherId;
    if (!teacherId || selectedAdminTeacherId === teacherId) {
      return;
    }
    selectedAdminTeacherId = teacherId;
    adminTeacherResetNotice.hide();
    renderAdminTeachers();
  });

  adminTeacherList?.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) {
      return;
    }
    const item = event.target.closest('[data-select-teacher]');
    if (!item) {
      return;
    }
    event.preventDefault();
    const teacherId = item.dataset.teacherId;
    if (!teacherId || selectedAdminTeacherId === teacherId) {
      return;
    }
    selectedAdminTeacherId = teacherId;
    adminTeacherResetNotice.hide();
    renderAdminTeachers();
  });

  adminTeacherClassesForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser || authUser.role !== 'admin') {
      if (adminTeacherDetailMessage) {
        adminTeacherDetailMessage.textContent = 'Alleen beheerders kunnen klassen beheren.';
      }
      return;
    }
    const teacherId = adminTeacherClassesForm.dataset.teacherId;
    if (!teacherId) {
      if (adminTeacherDetailMessage) {
        adminTeacherDetailMessage.textContent = 'Selecteer eerst een docent.';
      }
      return;
    }
    const selected = Array.from(
      adminTeacherClassList?.querySelectorAll('input[type="checkbox"]:checked') || []
    ).map((input) => input.value);
    try {
      await fetchJson(`/api/teachers/${teacherId}`, {
        method: 'PATCH',
        body: { classIds: selected },
      });
      if (adminTeacherDetailMessage) {
        adminTeacherDetailMessage.textContent = 'Klassen bijgewerkt.';
      }
      await Promise.all([loadTeachers(), loadClasses()]);
      selectedAdminTeacherId = teacherId;
      renderAdminTeachers();
    } catch (error) {
      if (adminTeacherDetailMessage) {
        adminTeacherDetailMessage.textContent = error.message;
      }
    }
  });

  adminTeacherPasswordForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser || authUser.role !== 'admin') {
      if (adminTeacherDetailMessage) {
        adminTeacherDetailMessage.textContent = 'Alleen beheerders kunnen wachtwoorden instellen.';
      }
      return;
    }
    const teacherId = adminTeacherPasswordForm.dataset.teacherId;
    if (!teacherId) {
      if (adminTeacherDetailMessage) {
        adminTeacherDetailMessage.textContent = 'Selecteer eerst een docent.';
      }
      return;
    }
    const temporaryPassword = adminTeacherPasswordInput?.value?.trim() || '';
    if (!temporaryPassword) {
      if (adminTeacherDetailMessage) {
        adminTeacherDetailMessage.textContent = 'Vul eerst een tijdelijk wachtwoord in.';
      }
      return;
    }
    try {
      const result = await fetchJson(`/api/teachers/${teacherId}`, {
        method: 'PATCH',
        body: { temporaryPassword },
      });
      if (adminTeacherDetailMessage) {
        adminTeacherDetailMessage.textContent = 'Tijdelijk wachtwoord ingesteld.';
      }
      adminTeacherPasswordInput.value = '';
      adminTeacherResetNotice.show(`Tijdelijk wachtwoord: ${temporaryPassword}`);
      if (result?.teacher) {
        const index = teachers.findIndex((entry) => entry.id === result.teacher.id);
        if (index !== -1) {
          teachers[index] = result.teacher;
        }
        renderAdminTeachers();
      }
    } catch (error) {
      adminTeacherResetNotice.hide();
      if (adminTeacherDetailMessage) {
        adminTeacherDetailMessage.textContent = error.message;
      }
    }
  });

  adminTeacherDetail?.addEventListener('click', async (event) => {
    const resetButton = event.target.closest('button[data-reset-teacher]');
    if (resetButton) {
      if (!authUser || authUser.role !== 'admin') {
        if (adminTeacherDetailMessage) {
          adminTeacherDetailMessage.textContent = 'Alleen beheerders kunnen wachtwoorden resetten.';
        }
        return;
      }
      const teacherId = adminTeacherPasswordForm?.dataset.teacherId;
      if (!teacherId) {
        if (adminTeacherDetailMessage) {
          adminTeacherDetailMessage.textContent = 'Selecteer eerst een docent.';
        }
        return;
      }
      if (!window.confirm('Nieuw tijdelijk wachtwoord voor deze docent aanmaken?')) {
        return;
      }
      adminTeacherResetNotice.hide();
      resetButton.disabled = true;
      if (adminTeacherDetailMessage) {
        adminTeacherDetailMessage.textContent = 'Tijdelijk wachtwoord wordt aangemaakt…';
      }
      try {
        const result = await fetchJson(`/api/teachers/${teacherId}/reset-password`, { method: 'POST' });
        const teacherName = result?.teacher?.name || adminTeacherDetailName?.textContent || 'Docent';
        if (adminTeacherDetailMessage) {
          adminTeacherDetailMessage.textContent = `${teacherName} heeft een nieuw tijdelijk wachtwoord gekregen.`;
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
        if (adminTeacherDetailMessage) {
          adminTeacherDetailMessage.textContent = error.message;
        }
        adminTeacherResetNotice.hide();
      } finally {
        resetButton.disabled = false;
      }
      return;
    }

    const deleteButton = event.target.closest('button[data-delete-teacher]');
    if (deleteButton) {
      if (!authUser || authUser.role !== 'admin') {
        if (adminTeacherDetailMessage) {
          adminTeacherDetailMessage.textContent = 'Alleen beheerders kunnen docenten verwijderen.';
        }
        return;
      }
      const teacherId = deleteButton.dataset.teacherId;
      if (!teacherId) {
        if (adminTeacherDetailMessage) {
          adminTeacherDetailMessage.textContent = 'Selecteer eerst een docent.';
        }
        return;
      }
      if (!window.confirm('Weet je zeker dat je deze docent wilt verwijderen?')) {
        return;
      }
      deleteButton.disabled = true;
      try {
        await fetchJson(`/api/teachers/${teacherId}`, { method: 'DELETE' });
        selectedAdminTeacherId = '';
        setAdminTeacherStatus('Docent verwijderd.');
        await Promise.all([loadTeachers(), loadClasses()]);
        renderAdminTeachers();
      } catch (error) {
        if (adminTeacherDetailMessage) {
          adminTeacherDetailMessage.textContent = error.message;
        }
      } finally {
        deleteButton.disabled = false;
      }
    }
  });

  adminStudentList?.addEventListener('click', (event) => {
    const item = event.target.closest('.student-list__item--selectable');
    if (!item?.dataset.studentId) {
      return;
    }
    setSelectedAdminStudent(item.dataset.studentId);
  });

  adminStudentList?.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) {
      return;
    }
    const item = event.target.closest('.student-list__item--selectable');
    if (!item?.dataset.studentId) {
      return;
    }
    event.preventDefault();
    setSelectedAdminStudent(item.dataset.studentId);
  });

  adminStudentDetailRemoveButton?.addEventListener('click', async () => {
    if (!authUser || authUser.role !== 'admin') {
      if (adminStudentDetailMessage) {
        adminStudentDetailMessage.textContent = 'Alleen beheerders kunnen leerlingaccounts verwijderen.';
      }
      return;
    }
    const studentId = adminStudentDetailRemoveButton.dataset.studentId;
    if (!studentId) {
      if (adminStudentDetailMessage) {
        adminStudentDetailMessage.textContent = 'Selecteer eerst een leerling.';
      }
      return;
    }
    if (!window.confirm('Weet je zeker dat je dit leerlingaccount wilt verwijderen?')) {
      return;
    }
    adminResetNotice.hide();
    adminStudentDetailRemoveButton.disabled = true;
    if (adminStudentDetailMessage) {
      adminStudentDetailMessage.textContent = 'Leerlingaccount wordt verwijderd…';
    }
    try {
      await fetchJson(`/api/students/${studentId}`, { method: 'DELETE' });
      if (adminStudentMessage) {
        adminStudentMessage.textContent = 'Leerlingaccount verwijderd.';
      }
      selectedAdminStudentId = '';
      await loadStudents();
      await loadClasses();
      renderAdminStudents();
      if (adminStudentDetailMessage) {
        adminStudentDetailMessage.textContent = 'Leerlingaccount verwijderd.';
      }
    } catch (error) {
      if (adminStudentDetailMessage) {
        adminStudentDetailMessage.textContent = error.message;
      }
    } finally {
      adminStudentDetailRemoveButton.disabled = false;
    }
  });

  adminBookIdInput?.addEventListener('input', updateAdminBookDeleteButtonVisibility);

  adminBookDeleteButton?.addEventListener('click', async () => {
    if (!authUser || authUser.role !== 'admin') {
      if (adminBookMessage) {
        adminBookMessage.textContent = 'Alleen beheerders kunnen boeken verwijderen.';
      }
      return;
    }
    const bookId = adminBookIdInput?.value?.trim();
    if (!bookId) {
      if (adminBookMessage) {
        adminBookMessage.textContent = 'Selecteer eerst een boek om te verwijderen.';
      }
      updateAdminBookDeleteButtonVisibility();
      return;
    }
    if (!window.confirm('Weet je zeker dat je dit boek wilt verwijderen?')) {
      return;
    }
    if (adminBookDeleteButton) {
      adminBookDeleteButton.disabled = true;
    }
    if (adminBookMessage) {
      adminBookMessage.textContent = 'Boek wordt verwijderd…';
    }
    try {
      await fetchJson(`/api/books/${bookId}`, { method: 'DELETE' });
      if (adminBookMessage) {
        adminBookMessage.textContent = 'Boek verwijderd uit de bibliotheek.';
      }
      await refreshStaffData();
      resetAdminBookForm();
    } catch (error) {
      if (adminBookMessage) {
        adminBookMessage.textContent = error.message;
      }
      if (adminBookDeleteButton) {
        adminBookDeleteButton.disabled = false;
      }
      updateAdminBookDeleteButtonVisibility();
    }
  });

  adminBookForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser || authUser.role !== 'admin') {
      adminBookMessage.textContent = 'Alleen beheerders kunnen boeken toevoegen.';
      return;
    }
    const normalizedBarcode = normalizeBarcode(adminBookBarcode?.value);
    const publisherValue = adminBookPublisher?.value?.trim() || '';
    const publishedYearValue = adminBookYear?.value?.trim() || '';
    const pageCountValue = adminBookPages?.value?.trim() || '';
    const languageValue = adminBookLanguage?.value?.trim() || '';
    const coverUrlValue = adminBookCover?.value?.trim() || '';
    const tags = getSelectedAdminThemes();
    const payload = {
      title: adminBookTitle.value.trim(),
      author: adminBookAuthor.value.trim(),
      barcode: normalizedBarcode,
      suitableForExamList: Boolean(adminBookExam.checked),
      description: adminBookDescription.value.trim(),
      publisher: publisherValue,
      publishedYear: publishedYearValue || null,
      pageCount: pageCountValue || null,
      language: languageValue ? languageValue.toLowerCase() : '',
      coverUrl: coverUrlValue,
      tags,
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

  bookImportForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser || authUser.role !== 'admin') {
      if (bookImportMessage) {
        bookImportMessage.textContent = 'Alleen beheerders kunnen boeken importeren.';
      }
      return;
    }
    const file = bookImportFile?.files?.[0];
    if (!file) {
      if (bookImportMessage) {
        bookImportMessage.textContent = 'Kies eerst een Excelbestand.';
      }
      return;
    }
    try {
      if (bookImportMessage) {
        bookImportMessage.textContent = 'Bestand wordt verwerkt…';
      }
      const base64 = await readFileAsBase64(file);
      const result = await fetchJson('/api/books/import', {
        method: 'POST',
        body: { file: base64 },
      });
      if (bookImportFile) {
        bookImportFile.value = '';
      }
      const skippedCount = Array.isArray(result.skipped) ? result.skipped.length : 0;
      if (bookImportMessage) {
        bookImportMessage.textContent = `Import gereed: ${result.created} toegevoegd, ${result.updated} bijgewerkt${
          skippedCount ? `, ${skippedCount} overgeslagen` : ''
        }.`;
      }
      renderImportResults(bookImportResults, result);
      await refreshStaffData();
    } catch (error) {
      if (bookImportMessage) {
        bookImportMessage.textContent = error.message;
      }
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
    const classId = adminStudentClassSelect?.value || '';
    if (!name || !username) {
      adminStudentMessage.textContent = 'Naam en gebruikersnaam zijn verplicht.';
      return;
    }
    const payload = {
      name,
      username,
      password,
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

  themeFilterRenderer.render();
  renderAdminThemeOptions({ preserveSelection: false });
  renderStaffState();
  Promise.all([loadBooks(), loadSummary()]).catch((error) => {
    console.error('Initiale gegevens laden is mislukt.', error);
  });
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
