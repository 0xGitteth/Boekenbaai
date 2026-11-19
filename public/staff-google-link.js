(() => {
  'use strict';

  const googleState = new URLSearchParams(window.location.search).get('googleAuth') || '';
  const TOKEN_KEY = 'boekenbaai_token';
  let adminRefreshTimer = null;

  async function api(url, options = {}) {
    const config = { method: 'GET', credentials: 'same-origin', ...options };
    config.headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (config.body && typeof config.body !== 'string') {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(config.body);
    }
    const response = await fetch(url, config);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `Actie mislukt (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function make(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.type) element.type = options.type;
    return element;
  }

  function installStaffPendingPanel() {
    if (document.body?.dataset.page !== 'staff' || googleState !== 'link-required') return;
    const host = document.querySelector('#staff-login-panel');
    if (!host || host.querySelector('.staff-google-pending')) return;

    const loginForm = document.querySelector('#login-form');
    if (loginForm) loginForm.hidden = true;
    host.querySelectorAll('.google-login').forEach((entry) => { entry.hidden = true; });

    const panel = make('section', { className: 'google-link-request staff-google-pending' });
    panel.append(
      make('h3', { text: 'Koppel je schoolaccount' }),
      make('p', {
        text: 'Je Google-account is nog niet gekoppeld aan jouw docentaccount. Boekenbaai Beheer hoeft dit alleen de eerste keer goed te keuren.',
      })
    );
    const identity = make('p', { className: 'hint staff-google-pending__identity' });
    const status = make('p', { className: 'hint google-link-request__status' });
    const retry = make('button', { className: 'btn btn--ghost', text: 'Opnieuw inloggen', type: 'button' });
    retry.hidden = true;
    retry.addEventListener('click', () => window.location.replace('/staff.html'));
    panel.append(identity, status, retry);
    host.prepend(panel);

    let stopped = false;
    let pollTimer = null;

    function schedule() {
      if (stopped) return;
      window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(check, 5000);
    }

    async function complete() {
      stopped = true;
      window.clearTimeout(pollTimer);
      status.textContent = 'Koppeling goedgekeurd. Je wordt ingelogd…';
      try {
        const result = await api('/api/auth/google/staff-pending/complete', { method: 'POST' });
        if (result.loggedIn) {
          localStorage.setItem(TOKEN_KEY, 'cookie');
          window.location.replace('/staff.html?googleAuth=success');
        }
      } catch (error) {
        status.textContent = error.message;
        retry.hidden = false;
      }
    }

    async function check() {
      if (stopped) return;
      try {
        const pending = await api('/api/auth/google/staff-pending');
        identity.textContent = [pending.googleName, pending.email].filter(Boolean).join(' · ');
        if (pending.canComplete) return complete();
        if (pending.requestStatus === 'pending') {
          status.textContent = 'Je koppelverzoek wacht op goedkeuring van Boekenbaai Beheer.';
          schedule();
          return;
        }
        if (pending.requestStatus === 'denied') {
          stopped = true;
          status.textContent = 'Boekenbaai Beheer heeft dit koppelverzoek afgewezen. Controleer of je de juiste naam hebt gekozen.';
          retry.hidden = false;
          return;
        }
      } catch (error) {
        if (error.status !== 404 && error.status !== 401) status.textContent = error.message;
      }

      try {
        const created = await api('/api/auth/google/staff-auto-link-request', { method: 'POST' });
        if (created.status === 'approved') return complete();
        status.textContent = 'Koppelverzoek verstuurd. Boekenbaai Beheer kan het nu goedkeuren.';
        schedule();
      } catch (error) {
        stopped = true;
        status.textContent = error.message;
        retry.hidden = false;
      }
    }

    check();
  }

  function requestCard(request) {
    const row = make('div', {
      className: `student-management__request staff-link-request${request.nameMatch === 'warning' ? ' student-management__request--warning' : ''}`,
    });
    const info = make('div', { className: 'student-management__request-info' });
    info.append(
      make('strong', { text: request.staffName }),
      make('span', { text: `Google: ${request.googleName || 'naam onbekend'} · ${request.email || ''}` })
    );
    if (request.nameMatch === 'match') {
      info.append(make('span', {
        className: 'student-management__match student-management__match--ok',
        text: '✓ Google-naam lijkt overeen te komen',
      }));
    } else if (request.nameMatch === 'warning') {
      info.append(make('span', {
        className: 'student-management__match student-management__match--warning',
        text: '⚠ Google-naam wijkt af van het gekozen docentaccount',
      }));
    }

    const actions = make('div', { className: 'student-management__row-actions' });
    const approve = make('button', { className: 'btn btn--secondary', text: 'Goedkeuren', type: 'button' });
    const deny = make('button', { className: 'btn btn--ghost', text: 'Weigeren', type: 'button' });
    async function act(action) {
      approve.disabled = true;
      deny.disabled = true;
      try {
        await api(`/api/auth/google/staff-link-requests/${encodeURIComponent(request.id)}/${action}`, { method: 'POST' });
        row.remove();
        // Keep the section and empty state visible after the last decision.
        await renderAdminRequests();
      } catch (error) {
        approve.disabled = false;
        deny.disabled = false;
        window.alert(error.message);
      }
    }
    approve.addEventListener('click', () => act('approve'));
    deny.addEventListener('click', () => act('deny'));
    actions.append(approve, deny);
    row.append(info, actions);
    return row;
  }

  async function renderAdminRequests() {
    const dashboard = document.querySelector('#admin-dashboard');
    const taskView=dashboard?.querySelector('[data-admin-modern-view="tasks"]');
    const host = document.querySelector('#admin-staff-link-requests-host')||taskView;
    if (!dashboard || dashboard.classList.contains('hidden') || !host) return;
    let payload;
    try {
      payload = await api('/api/auth/google/staff-link-requests');
    } catch (error) {
      return;
    }

    let section = document.querySelector('#admin-staff-link-requests');
    if (!section) {
      section = make('section', {
        className: 'panel student-management__section',
      });
      section.id = 'admin-staff-link-requests';
      host.prepend(section);
    }
    section.replaceChildren(
      make('h4', { text: `Docentaccounts goedkeuren (${payload.requests?.length||0})` }),
      make('p', {
        className: 'hint',
        text: 'Controleer nieuwe verzoeken om een Koraal Google-account aan een docentaccount te koppelen.',
      })
    );
    if (payload.requests?.length) {
      section.classList.add('student-management__attention');
      payload.requests.forEach((request) => section.append(requestCard(request)));
    } else {
      section.classList.remove('student-management__attention');
      section.append(make('p', {className:'hint',text:'Geen openstaande koppelverzoeken.'}));
    }
    window.dispatchEvent(new CustomEvent('boekenbaai:staff-link-requests-updated',{
      detail:{count:payload.requests?.length||0}
    }));
  }


  // Unlike the account-management Google panel, this task list initializes
  // when the administrator actually logs in. The old panel was fetched only
  // on DOMContentLoaded, often before an authorized session existed.
  let studentRequestsBusy=false;
  async function renderAdminStudentRequests(){
    const dashboard=document.querySelector('#admin-dashboard');
    const host=document.getElementById('admin-student-link-requests-host');
    if(!dashboard||dashboard.classList.contains('hidden')||!host
      ||studentRequestsBusy)return;
    studentRequestsBusy=true;
    try{
      const data=await api('/api/auth/google/manage');
      if(dashboard.classList.contains('hidden')||!host.isConnected)return;
      if(data.role!=='admin')return;
      const requests=Array.isArray(data.requests)?data.requests:[];
      const section=make('section',{
        className:'panel student-management__section',
      });
      section.id='admin-student-link-request-panel';
      section.append(make('h4',{text:'Leerlingaccounts goedkeuren ('+requests.length+')'}));
      section.append(make('p',{className:'hint',
        text:'Verzoeken om een Google-schoolaccount aan een leerlingaccount te koppelen.',
      }));
      if(requests.length)section.classList.add('student-management__attention');
      for(const request of requests){
        const row=make('article',{className:'student-management__request'});
        const info=make('div',{className:'student-management__request-info'});
        info.append(make('strong',{text:request.studentName||'Onbekende leerling'}));
        info.append(make('span',{text:(request.classNames||[]).join(', ')
          +' · Google: '+(request.googleName||'naam onbekend')
          +' · '+(request.email||'geen e-mailadres')}));
        const actions=make('div',{className:'student-management__row-actions'});
        const approve=make('button',{
          className:'btn btn--secondary',text:'Goedkeuren',type:'button'});
        const deny=make('button',{
          className:'btn btn--ghost',text:'Afwijzen',type:'button'});
        async function decide(action){
          if(action==='approve'&&!window.confirm(
            'Koppel het Google-account '+(request.email||'')
            +' aan leerling '+(request.studentName||'')+'? '
            +'Controleer identiteit en klas voordat je goedkeurt.'))return;
          approve.disabled=true;deny.disabled=true;
          try{
            await api('/api/auth/google/link-requests/'
              +encodeURIComponent(request.id)+'/'+action,{method:'POST'});
            row.remove();
            await renderAdminStudentRequests();
          }catch(error){
            approve.disabled=false;deny.disabled=false;
            window.alert(error.message);
          }
        }
        approve.addEventListener('click',()=>void decide('approve'));
        deny.addEventListener('click',()=>void decide('deny'));
        actions.append(approve,deny);
        row.append(info,actions);
        section.append(row);
      }
      if(!requests.length)section.append(make('p',{
        className:'hint',text:'Geen openstaande leerlingkoppelverzoeken.',
      }));
      host.replaceChildren(section);
    }catch(error){
      if(!dashboard.classList.contains('hidden')){
        const status=make('p',{
          className:'hint',text:'Leerlingkoppelverzoeken konden niet worden geladen: '
            +error.message,
        });
        host.replaceChildren(status);
      }
    }finally{studentRequestsBusy=false;}
  }
  function installAdminObserver() {
    const dashboard = document.querySelector('#admin-dashboard');
    if (!dashboard) return;
    const refresh = () => {
      if (dashboard.classList.contains('hidden')) {
        window.clearInterval(adminRefreshTimer);
        adminRefreshTimer = null;
        document.getElementById('admin-student-link-requests-host')?.replaceChildren();
        return;
      }
      void renderAdminRequests();
      void renderAdminStudentRequests();
      if (!adminRefreshTimer) adminRefreshTimer = window.setInterval(()=>{
        void renderAdminRequests();
        void renderAdminStudentRequests();
      },15000);
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(dashboard, { attributes: true, attributeFilter: ['class'] });
  }

  window.addEventListener('boekenbaai:staff-refresh',()=>{
    void renderAdminStudentRequests();
  });
  document.addEventListener('DOMContentLoaded', () => {
    installStaffPendingPanel();
    installAdminObserver();
  });
})();
