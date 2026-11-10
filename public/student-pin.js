(function studentPinProfile() {
  'use strict';

  const details = document.getElementById('student-pin-details');
  const form = document.getElementById('student-pin-form');
  const status = document.getElementById('student-pin-status');
  const feedback = document.getElementById('student-pin-feedback');
  const newPin = document.getElementById('student-pin-new');
  const repeatPin = document.getElementById('student-pin-repeat');
  const save = document.getElementById('student-pin-save');
  const reset = document.getElementById('student-pin-reset');
  if (!details || !form || !status || !feedback || !newPin || !repeatPin || !save || !reset) return;

  let pending = false;

  function authHeaders() {
    const token = localStorage.getItem('boekenbaai_token');
    return token && token !== 'cookie'
      ? { Authorization: 'Bearer ' + token } : {};
  }

  async function api(url, method = 'GET', body) {
    const response = await fetch(url, {
      method, credentials: 'same-origin',
      headers: {
        Accept: 'application/json', ...authHeaders(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.message || 'De PIN-aanvraag is mislukt.');
    return data;
  }

  function setBusy(value) {
    pending = value;
    save.disabled = value;
    reset.disabled = value;
    newPin.disabled = value;
    repeatPin.disabled = value;
  }

  async function refresh() {
    if (!details.open || pending) return;
    status.textContent = 'PIN-status controleren…';
    feedback.textContent = '';
    form.hidden = true;
    try {
      const data = await api('/api/auth/student-pin/status');
      if (!data.configured) {
        status.textContent = 'PIN is nog niet beschikbaar. Vraag de beheerder om dit te activeren.';
      } else if (!data.canSet) {
        status.textContent = 'Log eerst in met je eigen Google-schoolaccount om je PIN te beheren.';
      } else {
        status.textContent = data.hasPin
          ? 'Je hebt al een uitleen-PIN. Je kunt hem hier wijzigen of resetten.'
          : 'Je hebt nog geen uitleen-PIN. Stel er hieronder één in.';
        form.hidden = false;
        reset.hidden = !data.hasPin;
        save.textContent = data.hasPin ? 'PIN wijzigen' : 'PIN opslaan';
      }
    } catch (error) {
      status.textContent = error.message;
    }
  }

  details.addEventListener('toggle', () => {
    if (details.open) refresh();
    else {
      form.reset();
      feedback.textContent = '';
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    const value = newPin.value;
    if (!/^[0-9]{6}$/.test(value)) {
      feedback.textContent = 'De PIN moet uit precies zes cijfers bestaan.';
      return;
    }
    if (value !== repeatPin.value) {
      feedback.textContent = 'De twee PIN-codes zijn niet hetzelfde.';
      return;
    }
    setBusy(true);
    feedback.textContent = '';
    try {
      await api('/api/auth/student-pin/set', 'POST', { pin: value });
      form.reset();
      feedback.textContent = 'Je nieuwe PIN is opgeslagen.';
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      setBusy(false);
    }
    // Preserve success/error feedback while refreshing controls.
    const message = feedback.textContent;
    await refresh();
    feedback.textContent = message;
  });

  reset.addEventListener('click', async () => {
    if (pending || !window.confirm('Je huidige uitleen-PIN resetten?')) return;
    setBusy(true);
    feedback.textContent = '';
    try {
      await api('/api/auth/student-pin/reset', 'POST', {});
      form.reset();
      feedback.textContent = 'Je PIN is gereset. Je kunt een nieuwe instellen.';
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      setBusy(false);
    }
    const message = feedback.textContent;
    await refresh();
    feedback.textContent = message;
  });
})();
