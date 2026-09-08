(() => {
  'use strict';

  let queued = false;

  function updateImportCopy() {
    const studentForm = document.querySelector('#student-import-form');
    const studentSection = studentForm?.closest('.admin-card__section--import');
    const studentHint = studentSection?.querySelector('.hint');
    if (studentHint) {
      studentHint.innerHTML =
        'Upload de <strong>onbewerkte schoolbrede ParnasSys-leerlingenlijst</strong>. Boekenbaai herkent onder andere <strong>Leerlingnummer</strong>, <strong>Huidige groep</strong>, <strong>Roepnaam</strong>, <strong>Voorvoegsel</strong> en <strong>Achternaam</strong>. Extra kolommen zoals Huidige status mogen gewoon blijven staan en worden genegeerd. Een leerlingmailadres is niet nodig.';
    }

    const teacherForm = document.querySelector('#teacher-import-form');
    const teacherSection = teacherForm?.closest('.admin-card__section--import');
    const teacherHint = teacherSection?.querySelector('.hint');
    if (teacherHint) {
      teacherHint.innerHTML =
        'Upload de <strong>onbewerkte ParnasSys-medewerkerslijst</strong>. Boekenbaai gebruikt naam en <strong>Gekoppelde groepen</strong>. Alleen medewerkers die aan minimaal één groep gekoppeld zijn krijgen een docentaccount; bovenschoolse medewerkers zonder gekoppelde klas worden overgeslagen.';
    }

    document.querySelectorAll('[data-admin-modern-tab="imports"]').forEach((button) => {
      if (button.textContent.trim() === 'Importeren') button.textContent = 'Schoolgegevens';
    });
  }

  function removeLegacyTeacherTools() {
    const teacherDashboard = document.querySelector('#teacher-dashboard');
    if (!teacherDashboard) return;
    const legacyClasses = teacherDashboard.querySelector('.teacher-layout__classes.teacher-actions');
    if (legacyClasses) legacyClasses.hidden = true;
    teacherDashboard.querySelectorAll('.google-manage').forEach((panel) => panel.remove());
  }

  function simplifyAdminGooglePanel() {
    const host = document.querySelector('#admin-modern-google-host');
    if (!host) return;
    host.querySelectorAll('.admin-modern-google-links__requests').forEach((section) => {
      section.hidden = true;
    });
    host.querySelectorAll('.google-manage__section').forEach((section) => {
      const heading = section.querySelector('h4')?.textContent?.trim().toLocaleLowerCase('nl-NL') || '';
      if (heading.includes('leerling koppelen') || heading.includes('schoolmailadres van een leerling')) {
        section.hidden = true;
      }
    });
  }

  function placeTeacherStudentManagement() {
    const adminDashboard = document.querySelector('#admin-dashboard');
    if (adminDashboard && !adminDashboard.classList.contains('hidden')) return;
    const teacherDashboard = document.querySelector('#teacher-dashboard');
    const panel = document.querySelector('#student-management-panel');
    const bookLayout = teacherDashboard?.querySelector('.teacher-layout');
    if (!teacherDashboard || !panel || !bookLayout) return;
    if (panel.parentElement !== teacherDashboard || panel.nextElementSibling !== bookLayout) {
      teacherDashboard.insertBefore(panel, bookLayout);
    }
  }

  function placeAdminStudentManagement() {
    const adminDashboard = document.querySelector('#admin-dashboard');
    if (!adminDashboard || adminDashboard.classList.contains('hidden')) return;
    const panel = document.querySelector('#student-management-panel');
    const host = document.querySelector('#admin-modern-google-host');
    if (panel && host && panel.parentElement !== host) host.append(panel);
  }

  function apply() {
    queued = false;
    updateImportCopy();
    removeLegacyTeacherTools();
    simplifyAdminGooglePanel();
    placeTeacherStudentManagement();
    placeAdminStudentManagement();
  }

  function queueApply() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(apply);
  }

  document.addEventListener('DOMContentLoaded', () => {
    apply();
    const observer = new MutationObserver(queueApply);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden'],
    });
  });
})();
