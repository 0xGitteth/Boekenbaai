(() => {
  'use strict';

  const FALLBACK_DOMAIN = 'koraaledu.nl';
  const BOUND_FLAG = 'schoolmailDomainHelperBound';

  function domainFor(input) {
    const placeholder = String(input?.placeholder || '');
    const match = placeholder.match(/@([a-z0-9.-]+\.[a-z]{2,})\b/i);
    return String(match?.[1] || FALLBACK_DOMAIN).trim().toLowerCase();
  }

  function isSchoolmailInput(input) {
    if (!(input instanceof HTMLInputElement) || input.type !== 'email') return false;
    if (input.disabled || input.readOnly) return false;

    const metadata = [input.id, input.name, input.getAttribute('aria-label'), input.placeholder]
      .filter(Boolean)
      .join(' ');
    if (/schoolmail|google-email|@koraaledu\.nl\b/i.test(metadata)) return true;

    const context = input.closest(
      '#teacher-groups-google-section, #admin-teacher-google-account, .student-detail__section'
    );
    return Boolean(context && /Google-schoolaccount|Schoolmail/i.test(context.textContent || ''));
  }

  function suffixFor(input) {
    return `@${domainFor(input)}`;
  }

  function moveCaretBeforeDomain(input) {
    const suffix = suffixFor(input);
    if (input.value !== suffix) return;
    window.requestAnimationFrame(() => {
      if (input.value !== suffix) return;
      try {
        input.setSelectionRange(0, 0);
      } catch (error) {
        // Sommige oudere browsers ondersteunen selectie op e-mailvelden beperkt.
      }
    });
  }

  function enhanceInput(input) {
    if (!isSchoolmailInput(input)) return;

    const suffix = suffixFor(input);
    if (!input.value.trim()) input.value = suffix;

    if (input.dataset[BOUND_FLAG] === 'true') return;
    input.dataset[BOUND_FLAG] = 'true';
    input.addEventListener('focus', () => moveCaretBeforeDomain(input));
  }

  function enhanceAll(root = document) {
    if (root instanceof HTMLInputElement) enhanceInput(root);
    root.querySelectorAll?.('input[type="email"]').forEach(enhanceInput);
  }

  function install() {
    enhanceAll(document);

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

  document.addEventListener('DOMContentLoaded', install);
})();
