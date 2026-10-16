'use strict';

// Auto-filter the prospects directory without changing the Home dashboard.
const filterForm = document.querySelector('form.prospect-page-search');
if (filterForm) {
  const searchInput = filterForm.elements.namedItem('q');
  const statusSelect = filterForm.elements.namedItem('status');
  let debounceTimer;
  const focusKey = 'prospects-search-focus';

  // Restore the cursor after a debounced search navigates to filtered results.
  try {
    const saved = JSON.parse(sessionStorage.getItem(focusKey) || 'null');
    sessionStorage.removeItem(focusKey);
    if (saved && searchInput && document.activeElement === document.body) {
      searchInput.focus({ preventScroll: true });
      if (typeof saved.position === 'number') {
        const position = Math.min(saved.position, searchInput.value.length);
        searchInput.setSelectionRange(position, position);
      }
    }
  } catch (_) { /* Storage may be unavailable. */ }

  function applyFilters(keepSearchFocus) {
    clearTimeout(debounceTimer);
    try {
      if (keepSearchFocus && searchInput) {
        sessionStorage.setItem(focusKey, JSON.stringify({ position: searchInput.selectionStart }));
      } else {
        sessionStorage.removeItem(focusKey);
      }
    } catch (_) { /* Storage may be unavailable. */ }
    filterForm.requestSubmit();
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => applyFilters(true), 550);
    });
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyFilters(false);
      }
    });
  }
  if (statusSelect) {
    statusSelect.addEventListener('change', () => applyFilters(false));
  }
}
