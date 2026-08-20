(() => {
  'use strict';

  document.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest?.('.google-login__button');
      if (!button || button.disabled) return;

      const isStaff = document.body?.dataset.page === 'staff';
      const nameInput = document.querySelector(isStaff ? '#login-name' : '#student-login-name');
      const enteredName = nameInput?.value?.trim() || '';
      const remember =
        isStaff && document.querySelector('#boekenbaai-remember-login')?.checked;

      const params = new URLSearchParams({ type: isStaff ? 'staff' : 'student' });
      if (remember) params.set('remember', '1');
      if (enteredName) params.set('name', enteredName);

      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(`/api/auth/google/start?${params.toString()}`);
    },
    true
  );
})();
