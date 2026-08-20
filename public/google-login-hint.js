(() => {
  'use strict';

  function getPageState() {
    const isStaff = document.body?.dataset.page === 'staff';
    const form = document.querySelector(isStaff ? '#login-form' : '#student-login-form');
    return {
      isStaff,
      form,
      nameInput: document.querySelector(isStaff ? '#login-name' : '#student-login-name'),
      passwordInput: document.querySelector(
        isStaff ? '#login-password' : '#student-login-password'
      ),
      message: document.querySelector(isStaff ? '#login-message' : '#student-login-message'),
      submit: form?.querySelector('button[type="submit"]') || null,
    };
  }

  async function fetchLoginMode(type, accountId) {
    const response = await window.fetch(
      `/api/auth/login-mode?type=${encodeURIComponent(type)}&accountId=${encodeURIComponent(accountId)}`,
      { headers: { Accept: 'application/json' } }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Het gekozen account kon niet worden gecontroleerd.');
    }
    if (!['google', 'password'].includes(payload.authMode)) {
      throw new Error('Het gekozen account heeft geen geldige inlogmethode.');
    }
    return payload.authMode;
  }

  function buildGoogleStartUrl({ isStaff, accountId, remember }) {
    const params = new URLSearchParams({
      type: isStaff ? 'staff' : 'student',
      accountId,
    });
    if (isStaff && remember) params.set('remember', '1');
    return `/api/auth/google/start?${params.toString()}`;
  }

  function stripAdminGoogleManageOptions() {
    const panel = document.querySelector('.google-manage');
    if (!panel) return false;
    for (const option of panel.querySelectorAll('select option')) {
      if (/\(admin\)\s*$/i.test(option.textContent || '')) {
        option.remove();
      }
    }
    return true;
  }

  function enhanceLogin(attempt = 0) {
    const googleBlock = document.querySelector('.google-login');
    const googleButton = googleBlock?.querySelector('.google-login__button');
    if (!googleBlock || !googleButton) {
      if (attempt < 80) window.setTimeout(() => enhanceLogin(attempt + 1), 50);
      return;
    }
    if (document.body?.dataset.loginFlowEnhanced === '1') return;
    document.body.dataset.loginFlowEnhanced = '1';

    const { isStaff, form, nameInput, passwordInput, message, submit } = getPageState();
    if (!form || !nameInput || !submit) return;

    const googleEnabled = !googleButton.disabled;
    const passwordField = passwordInput?.closest('.form-field') || null;
    const rememberLabel = isStaff
      ? googleBlock.querySelector('.google-login__remember')
      : null;
    const rememberCheckbox = rememberLabel?.querySelector('#boekenbaai-remember-login') || null;

    googleBlock.querySelector('.google-login__divider')?.remove();
    googleBlock.querySelector('.google-login__hint')?.remove();
    googleButton.remove();

    if (rememberLabel) {
      rememberLabel.hidden = true;
      form.insertBefore(rememberLabel, submit);
    }
    googleBlock.remove();

    submit.textContent = 'Inloggen';
    let selectedMode = '';
    let selectedModeAccountId = '';
    let modeRequestId = 0;

    function setMessage(text) {
      if (message) message.textContent = text || '';
    }

    function showPassword(show) {
      const visible = Boolean(show && isStaff && passwordInput);
      document.body.classList.toggle('login-local-password', visible);
      if (passwordField) passwordField.hidden = !visible;
      if (passwordInput) {
        passwordInput.required = visible;
        if (!visible) passwordInput.value = '';
      }
    }

    function showRemember(show) {
      if (!rememberLabel) return;
      const visible = Boolean(show && isStaff);
      rememberLabel.hidden = !visible;
      if (!visible && rememberCheckbox) rememberCheckbox.checked = false;
    }

    function clearMode({ clearMessage = false } = {}) {
      modeRequestId += 1;
      selectedMode = '';
      selectedModeAccountId = '';
      showPassword(false);
      showRemember(false);
      submit.disabled = !nameInput.value.trim();
      if (clearMessage) setMessage('');
    }

    async function syncSelectedAccount() {
      const accountId = nameInput.dataset.selectedAccountId || '';
      if (!accountId) {
        clearMode();
        return;
      }

      const requestId = ++modeRequestId;
      selectedMode = '';
      selectedModeAccountId = '';
      showPassword(false);
      showRemember(false);
      submit.disabled = true;
      setMessage('Account wordt gecontroleerd…');

      try {
        const authMode = await fetchLoginMode(isStaff ? 'staff' : 'student', accountId);
        if (
          requestId !== modeRequestId ||
          nameInput.dataset.selectedAccountId !== accountId
        ) {
          return;
        }
        selectedMode = authMode;
        selectedModeAccountId = accountId;
        showPassword(authMode === 'password');
        showRemember(authMode === 'google');
        submit.disabled = false;
        if (authMode === 'password') {
          setMessage('');
          window.setTimeout(() => passwordInput?.focus(), 0);
        } else if (!googleEnabled) {
          setMessage('Google-inlog is nog niet ingesteld door de beheerder.');
        } else {
          setMessage('');
        }
      } catch (error) {
        if (requestId !== modeRequestId) return;
        clearMode();
        setMessage(error.message);
      }
    }

    // De bestaande autocomplete zet dit attribuut alleen wanneer iemand echt
    // een resultaat uit de lijst kiest. Typen alleen is dus niet voldoende.
    const selectionObserver = new MutationObserver(() => {
      syncSelectedAccount();
    });
    selectionObserver.observe(nameInput, {
      attributes: true,
      attributeFilter: ['data-selected-account-id'],
    });

    nameInput.addEventListener('input', () => {
      if (!nameInput.dataset.selectedAccountId) {
        clearMode({ clearMessage: true });
      }
    });

    form.addEventListener('reset', () => {
      window.setTimeout(() => {
        nameInput.removeAttribute('data-selected-account-id');
        clearMode({ clearMessage: true });
      }, 0);
    });

    form.addEventListener(
      'submit',
      (event) => {
        const accountId = nameInput.dataset.selectedAccountId || '';
        const hasCurrentMode = Boolean(
          accountId && selectedMode && selectedModeAccountId === accountId
        );

        if (!hasCurrentMode) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setMessage('Kies je naam uit de lijst voordat je inlogt.');
          return;
        }

        if (selectedMode === 'password') {
          // Alleen lokale beheeraccounts komen hier. De bestaande app.js
          // verwerkt de vertrouwde naam+wachtwoordlogin verder.
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        if (!googleEnabled) {
          setMessage('Google-inlog is nog niet ingesteld door de beheerder.');
          return;
        }
        const remember = Boolean(isStaff && rememberCheckbox?.checked);
        window.location.assign(
          buildGoogleStartUrl({ isStaff, accountId, remember })
        );
      },
      true
    );

    showPassword(false);
    showRemember(false);
    submit.disabled = !nameInput.value.trim();

    const state = new URLSearchParams(window.location.search).get('googleAuth') || '';
    if (state === 'select-account') {
      setMessage('Kies je naam uit de lijst voordat je inlogt.');
    } else if (state === 'local-only') {
      setMessage('Dit beheeraccount logt lokaal in met een wachtwoord.');
    }

    if (isStaff && !stripAdminGoogleManageOptions()) {
      const manageObserver = new MutationObserver(() => {
        if (stripAdminGoogleManageOptions()) manageObserver.disconnect();
      });
      manageObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  document.addEventListener('DOMContentLoaded', () => enhanceLogin());
})();
