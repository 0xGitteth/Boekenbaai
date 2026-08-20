(() => {
  'use strict';

  function getPageState() {
    const isStaff = document.body?.dataset.page === 'staff';
    return {
      isStaff,
      nameInput: document.querySelector(isStaff ? '#login-name' : '#student-login-name'),
      passwordInput: document.querySelector(
        isStaff ? '#login-password' : '#student-login-password'
      ),
      suggestions: document.querySelector(
        isStaff ? '#login-suggestions' : '#student-login-suggestions'
      ),
    };
  }

  function buildGoogleStartUrl() {
    const { isStaff, nameInput } = getPageState();
    const enteredName = nameInput?.value?.trim() || '';
    const remember =
      isStaff && document.querySelector('#boekenbaai-remember-login')?.checked;

    const params = new URLSearchParams({ type: isStaff ? 'staff' : 'student' });
    if (remember) params.set('remember', '1');
    if (enteredName) params.set('name', enteredName);
    return `/api/auth/google/start?${params.toString()}`;
  }

  document.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest?.('.google-login__button');
      if (!button || button.disabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(buildGoogleStartUrl());
    },
    true
  );

  function enhanceLogin(attempt = 0) {
    const googleBlock = document.querySelector('.google-login');
    const googleButton = googleBlock?.querySelector('.google-login__button');
    if (!googleBlock || !googleButton) {
      if (attempt < 60) window.setTimeout(() => enhanceLogin(attempt + 1), 50);
      return;
    }
    if (googleBlock.dataset.nameFirstEnhanced === '1') return;
    googleBlock.dataset.nameFirstEnhanced = '1';

    const { nameInput, passwordInput, suggestions } = getPageState();
    if (!nameInput) return;

    const googleEnabled = !googleButton.disabled;
    if (!googleEnabled) return;

    const form = nameInput.closest('form');
    const passwordField = passwordInput?.closest('.form-field');
    const legacySubmit = form?.querySelector('button[type="submit"]');
    const divider = googleBlock.querySelector('.google-login__divider');
    const hint = googleBlock.querySelector('.google-login__hint');

    if (passwordField) passwordField.hidden = true;
    if (legacySubmit) legacySubmit.hidden = true;
    if (divider) divider.hidden = true;
    if (hint) hint.textContent = 'Kies je naam. Daarna ga je automatisch door naar Google.';
    googleButton.textContent = 'Verder met Google';

    const fallbackButton = document.createElement('button');
    fallbackButton.type = 'button';
    fallbackButton.className = 'btn btn--ghost google-login__fallback';
    fallbackButton.textContent = 'Inloggen met wachtwoord';
    googleBlock.append(fallbackButton);

    const syncGoogleButton = () => {
      googleButton.disabled = !nameInput.value.trim();
    };
    syncGoogleButton();
    nameInput.addEventListener('input', syncGoogleButton);

    fallbackButton.addEventListener('click', () => {
      const legacyVisible = !passwordField?.hidden;
      if (passwordField) passwordField.hidden = legacyVisible;
      if (legacySubmit) legacySubmit.hidden = legacyVisible;
      fallbackButton.textContent = legacyVisible
        ? 'Inloggen met wachtwoord'
        : 'Terug naar Google-inlog';
      if (!legacyVisible) passwordInput?.focus();
    });

    nameInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      syncGoogleButton();
      if (googleButton.disabled) return;
      event.preventDefault();
      googleButton.click();
    });

    suggestions?.addEventListener('click', () => {
      window.setTimeout(() => {
        syncGoogleButton();
        if (!googleButton.disabled && nameInput.value.trim()) {
          googleButton.click();
        }
      }, 0);
    });
  }

  document.addEventListener('DOMContentLoaded', () => enhanceLogin());
})();
