'use strict';

// Dashboard shortcut cards target collapsed <details> panels.
function openDashboardPanel(hash) {
  if (!['#needs-follow-up', '#no-follow-up'].includes(hash)) return;
  const panel = document.getElementById(hash.slice(1));
  if (!(panel instanceof HTMLDetailsElement)) return;
  // Keep only the selected dashboard section expanded.
  document.querySelectorAll('details.dashboard-collapse').forEach((section) => {
    section.open = section === panel;
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.querySelectorAll('.dashboard-stats a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const hash = link.getAttribute('href');
    if (!hash || !['#needs-follow-up', '#no-follow-up'].includes(hash)) return;
    event.preventDefault();
    if (location.hash !== hash) history.pushState(null, '', hash);
    openDashboardPanel(hash);
  });
});

// A search already expands every matching section on the server. An old shortcut
// hash must not collapse those results again when the page loads.
const dashboardFilters = new URLSearchParams(location.search);
if (location.hash && !dashboardFilters.get('q')?.trim() && !dashboardFilters.get('status')) openDashboardPanel(location.hash);
window.addEventListener('hashchange', () => openDashboardPanel(location.hash));
