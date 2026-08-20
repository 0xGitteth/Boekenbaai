(() => {
  'use strict';

  const initialGoogleState =
    new URLSearchParams(window.location.search).get('googleAuth') || '';

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

  async function requestJson(url, options = {}) {
    const response = await window.fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || 'Er ging iets mis.');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function fetchLoginMode(type, accountId) {
    const payload = await requestJson(
      `/api/auth/login-mode?type=${encodeURIComponent(type)}&accountId=${encodeURIComponent(accountId)}`
    );
    if (!['google', 'password'].includes(payload.authMode)) {
      throw new Error('Het gekozen account heeft geen geldige inlogmethode.');
    }
    return payload.authMode;
  }

  async function fetchGoogleStartToken(type, accountId) {
    const payload = await requestJson(
      `/api/auth/google/start-token?type=${encodeURIComponent(type)}&accountId=${encodeURIComponent(accountId)}`
    );
    if (!payload.token || typeof payload.token !== 'string') {
      throw new Error('De Google-inlog kon niet veilig worden gestart. Probeer opnieuw.');
    }
    return payload.token;
  }

  function buildGoogleStartUrl({ isStaff, accountId, remember, startToken }) {
    const params = new URLSearchParams({
      type: isStaff ? 'staff' : 'student',
      accountId,
      handoffToken: startToken,
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

  function enhancePendingLinkHandoff(attempt = 0) {
    const googleState = initialGoogleState;
    if (document.body?.dataset.page !== 'student' || googleState !== 'link-required') return;

    const panel = document.querySelector('.google-link-request');
    if (!panel) {
      if (attempt < 200) window.setTimeout(() => enhancePendingLinkHandoff(attempt + 1), 50);
      return;
    }
    if (panel.dataset.selectedStudentHandoff === '1') return;
    panel.dataset.selectedStudentHandoff = '1';

    const search = panel.querySelector('.google-link-request__search');
    const results = panel.querySelector('.google-link-request__results');
    const status = panel.querySelector('.google-link-request__status');
    const intro = Array.from(panel.querySelectorAll('p')).find(
      (entry) => !entry.classList.contains('google-link-request__status')
    );
    let pollTimer = null;
    let stopped = false;

    function hideManualSearch() {
      if (search) search.hidden = true;
      if (results) {
        results.hidden = true;
        results.replaceChildren();
      }
      if (intro) {
        intro.textContent =
          'Je Google-account wordt gekoppeld aan de leerlingnaam die je vóór het inloggen hebt gekozen.';
      }
    }

    function setStatus(text) {
      if (status) status.textContent = text || '';
    }

    function scheduleCheck() {
      if (stopped) return;
      window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(checkPending, 5000);
    }

    async function completePending() {
      stopped = true;
      window.clearTimeout(pollTimer);
      setStatus('Je docent heeft de koppeling goedgekeurd. Je wordt ingelogd…');
      try {
        const completed = await requestJson('/api/auth/google/pending/complete', {
          method: 'POST',
        });
        if (completed.loggedIn) {
          localStorage.setItem('boekenbaai_token', 'cookie');
          window.location.replace('/index.html?googleAuth=success');
        }
      } catch (error) {
        setStatus(error.message);
      }
    }

    async function checkPending() {
      if (stopped) return;
      try {
        const pending = await requestJson('/api/auth/google/pending');
        if (pending.studentId) hideManualSearch();
        if (pending.canComplete) {
          await completePending();
          return;
        }
        if (pending.requestStatus === 'pending' && pending.studentId) {
          setStatus('Je koppelverzoek wacht nog op goedkeuring van een docent van jouw klas.');
          scheduleCheck();
          return;
        }
        if (pending.requestStatus === 'denied' && pending.studentId) {
          stopped = true;
          setStatus('Je docent heeft het koppelverzoek afgewezen. Vraag je docent om hulp.');
        }
      } catch (error) {
        if (error.status !== 404 && error.status !== 401) {
          setStatus(error.message);
        }
      }
    }

    (async () => {
      try {
        const existing = await requestJson('/api/auth/google/pending');
        if (existing.automaticSelection) hideManualSearch();
        if (existing.studentId && existing.requestStatus !== 'not-requested') {
          hideManualSearch();
          if (existing.canComplete) {
            await completePending();
            return;
          }
          if (existing.requestStatus === 'pending') {
            setStatus('Je koppelverzoek wacht nog op goedkeuring van een docent van jouw klas.');
            scheduleCheck();
            return;
          }
          if (existing.requestStatus === 'denied') {
            stopped = true;
            setStatus('Je docent heeft het koppelverzoek afgewezen. Vraag je docent om hulp.');
            return;
          }
        }
      } catch (error) {
        // De bestaande handmatige zoekflow blijft beschikbaar als fallback.
      }

      try {
        const automatic = await requestJson('/api/auth/google/auto-link-request', {
          method: 'POST',
        });
        if (!automatic.automatic) return;
        hideManualSearch();
        setStatus('Koppelverzoek verstuurd. Een docent van jouw klas kan het nu goedkeuren.');
        scheduleCheck();
      } catch (error) {
        if (error.status === 404) {
          // Oude of directe flow zonder beveiligde leerlingselectie: laat zoeken toe.
          return;
        }
        hideManualSearch();
        stopped = true;
        setStatus(error.message);
      }
    })();
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
      async (event) => {
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

        submit.disabled = true;
        setMessage('Google-inlog wordt veilig gestart…');
        try {
          const type = isStaff ? 'staff' : 'student';
          const startToken = await fetchGoogleStartToken(type, accountId);
          if (
            nameInput.dataset.selectedAccountId !== accountId ||
            selectedModeAccountId !== accountId ||
            selectedMode !== 'google'
          ) {
            submit.disabled = false;
            setMessage('Je selectie is gewijzigd. Klik opnieuw op Inloggen.');
            return;
          }
          const remember = Boolean(isStaff && rememberCheckbox?.checked);
          window.location.assign(
            buildGoogleStartUrl({ isStaff, accountId, remember, startToken })
          );
        } catch (error) {
          submit.disabled = false;
          setMessage(error.message);
        }
      },
      true
    );

    showPassword(false);
    showRemember(false);
    submit.disabled = !nameInput.value.trim();

    const state = initialGoogleState;
    if (state === 'select-account') {
      setMessage('Kies je naam uit de lijst voordat je inlogt.');
    } else if (state === 'local-only') {
      setMessage('Dit beheeraccount logt lokaal in met een wachtwoord.');
    } else if (state === 'account-mismatch') {
      setMessage(
        'De gekozen naam hoort bij een ander Google-account. Kies opnieuw je eigen naam en schoolaccount.'
      );
    }

    if (isStaff && !stripAdminGoogleManageOptions()) {
      const manageObserver = new MutationObserver(() => {
        if (stripAdminGoogleManageOptions()) manageObserver.disconnect();
      });
      manageObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    enhanceLogin();
    enhancePendingLinkHandoff();
  });
})();
