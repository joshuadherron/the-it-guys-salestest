'use strict';

const sortSelect = document.getElementById('prospect-sort-select');
if (sortSelect) {
  sortSelect.addEventListener('change', () => {
    const form = sortSelect.form;
    if (form) form.requestSubmit();
  });
}
