(() => {
  'use strict';

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

  function install() {
    removePassiveAccountActions();
    const observer = new MutationObserver(() => removePassiveAccountActions());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', install);
})();
