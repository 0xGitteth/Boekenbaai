(() => {
  'use strict';

  function installIdempotentTextContent() {
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    if (!descriptor?.get || !descriptor?.set || descriptor.set.__boekenbaaiIdempotent) return;
    const originalGet = descriptor.get;
    const originalSet = descriptor.set;
    function safeTextContent(value) {
      const next = value == null ? '' : String(value);
      if (originalGet.call(this) === next) return;
      originalSet.call(this, value);
    }
    safeTextContent.__boekenbaaiIdempotent = true;
    Object.defineProperty(Node.prototype, 'textContent', {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: originalGet,
      set: safeTextContent,
    });
  }

  function randomTechnicalPassword() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function installStudentPasswordShim() {
    const form = document.querySelector('#admin-student-form');
    if (!form || form.dataset.googleFirstPasswordShim === 'true') return;
    form.dataset.googleFirstPasswordShim = 'true';
    form.addEventListener('submit', () => {
      const input = document.querySelector('#admin-student-password');
      if (input && !input.value) input.value = randomTechnicalPassword();
    }, true);
  }

  function removePassiveAccountActions() {
    document.querySelectorAll('#admin-modern-actions .admin-modern__action-row').forEach((row) => {
      if (/\b(leerlingen|docenten) zonder schoolaccount\b/i.test(row.textContent || '')) row.remove();
    });
    const host = document.querySelector('#admin-modern-actions');
    if (host && !host.children.length) {
      const message = document.createElement('p');
      message.className = 'hint';
      message.textContent = 'Geen openstaande accountacties.';
      host.append(message);
    }
  }

  function applyDomHardening() {
    installStudentPasswordShim();
    removePassiveAccountActions();
  }

  installIdempotentTextContent();

  document.addEventListener('DOMContentLoaded', () => {
    applyDomHardening();
    const observer = new MutationObserver(() => applyDomHardening());
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
