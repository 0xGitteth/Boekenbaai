(() => {
  'use strict';

  const FALLBACK_DOMAIN = 'koraaledu.nl';
  const BOUND_FLAG = 'schoolmailDomainHelperBound';
  const EDITING_FLAG = 'schoolmailDomainEditing';
  let configuredDomain = FALLBACK_DOMAIN;
  let domainReady = false;
  let domainPromise = null;

  function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase().replace(/^@/, '');
  }

  function apiUrl(pathname) {
    const base = String(
      document.querySelector('meta[name="boekenbaai-api-base"]')?.getAttribute('content') || ''
    ).trim().replace(/\/$/, '');
    return base ? `${base}${pathname}` : pathname;
  }

  async function loadConfiguredDomain() {
    if (domainPromise) return domainPromise;
    domainPromise = fetch(apiUrl('/api/auth/google/config'), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Google-config kon niet worden geladen (${response.status})`);
        return response.json();
      })
      .then((config) => {
        configuredDomain = normalizeDomain(config?.domain) || FALLBACK_DOMAIN;
      })
      .catch(() => {
        configuredDomain = FALLBACK_DOMAIN;
      })
      .finally(() => {
        domainReady = true;
      });
    return domainPromise;
  }

  function isSchoolmailInput(input) {
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.disabled || input.readOnly) return false;
    if (input.dataset[BOUND_FLAG] === 'true') return true;
    if (input.type !== 'email') return false;

    const metadata = [input.id, input.name, input.getAttribute('aria-label'), input.placeholder]
      .filter(Boolean)
      .join(' ');
    if (/schoolmail|google-email/i.test(metadata)) return true;

    const context = input.closest(
      '#teacher-groups-google-section, #admin-teacher-google-account, .student-detail__section'
    );
    return Boolean(context && /Google-schoolaccount|Schoolmail/i.test(context.textContent || ''));
  }

  function suffixFor() {
    return `@${configuredDomain}`;
  }

  function normalizePrefilledAddress(input) {
    const suffix = suffixFor();
    const value = String(input.value || '').trim();
    const lowerValue = value.toLowerCase();
    const lowerSuffix = suffix.toLowerCase();

    if (lowerValue.endsWith(lowerSuffix)) {
      const prefix = value.slice(0, -suffix.length);
      if (prefix.includes('@')) {
        input.value = prefix;
        return prefix;
      }
    }

    input.value = value;
    return value;
  }

  function startSuffixEditing(input) {
    if (!domainReady) return;
    const suffix = suffixFor();
    if (!input.value.trim()) input.value = suffix;
    if (input.value !== suffix) return;

    input.dataset[EDITING_FLAG] = 'true';
    input.type = 'text';
    input.inputMode = 'email';
    window.requestAnimationFrame(() => {
      if (input.value !== suffix || input.dataset[EDITING_FLAG] !== 'true') return;
      input.setSelectionRange(0, 0);
    });
  }

  function stopSuffixEditing(input) {
    normalizePrefilledAddress(input);
    if (input.dataset[EDITING_FLAG] === 'true') delete input.dataset[EDITING_FLAG];
    input.type = 'email';
    input.inputMode = 'email';
  }

  function validateSchoolmail(input) {
    stopSuffixEditing(input);
    input.setCustomValidity('');

    const value = String(input.value || '').trim();
    const suffix = suffixFor();
    if (!value || value === suffix) {
      input.setCustomValidity(`Vul het deel vóór @${configuredDomain} in.`);
      return false;
    }

    const parts = value.split('@');
    if (parts.length !== 2 || !parts[0] || normalizeDomain(parts[1]) !== configuredDomain) {
      input.setCustomValidity(`Gebruik een @${configuredDomain} schoolmailadres.`);
      return false;
    }

    return input.checkValidity();
  }

  function handlePaste(event, input) {
    if (input.dataset[EDITING_FLAG] !== 'true') return;
    const pasted = String(event.clipboardData?.getData('text') || '').trim();
    if (!pasted.includes('@')) return;

    event.preventDefault();
    input.value = pasted;
    stopSuffixEditing(input);
    input.setCustomValidity('');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function enhanceInput(input) {
    if (!isSchoolmailInput(input)) return;

    if (domainReady && !input.value.trim()) input.value = suffixFor();

    if (input.dataset[BOUND_FLAG] === 'true') return;
    input.dataset[BOUND_FLAG] = 'true';
    input.inputMode = 'email';
    input.addEventListener('focus', () => startSuffixEditing(input));
    input.addEventListener('blur', () => stopSuffixEditing(input));
    input.addEventListener('paste', (event) => handlePaste(event, input));
    input.addEventListener('input', () => input.setCustomValidity(''));
  }

  function enhanceAll(root = document) {
    if (root instanceof HTMLInputElement) enhanceInput(root);
    root.querySelectorAll?.('input[type="email"], input[data-schoolmail-domain-helper-bound="true"]')
      .forEach(enhanceInput);
  }

  function schoolmailInputsWithin(root) {
    const candidates = [];
    if (root instanceof HTMLInputElement && root.dataset[BOUND_FLAG] === 'true') candidates.push(root);
    root?.querySelectorAll?.('input[data-schoolmail-domain-helper-bound="true"]')
      .forEach((input) => candidates.push(input));
    return candidates;
  }

  function blockInvalidSave(event, root) {
    for (const input of schoolmailInputsWithin(root)) {
      if (validateSchoolmail(input)) continue;
      event.preventDefault();
      event.stopImmediatePropagation();
      input.reportValidity();
      input.focus();
      return true;
    }
    return false;
  }

  function installSaveGuards() {
    document.addEventListener('submit', (event) => {
      blockInvalidSave(event, event.target);
    }, true);

    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('button');
      if (!button || !/schoolmail opslaan/i.test(button.textContent || '')) return;
      const scope = button.closest('section') || button.closest('form') || document;
      blockInvalidSave(event, scope);
    }, true);
  }

  function installObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          enhanceInput(mutation.target);
          continue;
        }
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) enhanceAll(node);
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['placeholder', 'disabled', 'readonly'],
    });
  }

  function install() {
    enhanceAll(document);
    installSaveGuards();
    installObserver();
    loadConfiguredDomain().then(() => enhanceAll(document));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
