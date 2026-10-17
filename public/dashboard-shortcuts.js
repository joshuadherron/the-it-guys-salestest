'use strict';

// Dashboard shortcut cards target collapsed <details> panels.
function openDashboardPanel(hash) {
  if (!['#needs-follow-up', '#no-follow-up'].includes(hash)) return;
  const panel = document.getElementById(hash.slice(1));
  if (!(panel instanceof HTMLDetailsElement)) return;
  panel.open = true;
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

if (location.hash) openDashboardPanel(location.hash);
window.addEventListener('hashchange', () => openDashboardPanel(location.hash));
