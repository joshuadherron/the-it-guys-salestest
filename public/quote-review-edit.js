// External script is required by the app's Content Security Policy.
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("quote-review-edit-toggle");
  const form = document.getElementById("quote-review-edit-form");
  const cancel = document.getElementById("quote-review-edit-cancel");
  const snapshot = document.getElementById("quote-review-snapshot");
  if (!toggle || !form || !cancel || !snapshot) return;

  function setEditing(active) {
    form.hidden = !active;
    snapshot.hidden = active;
    toggle.hidden = active;
    toggle.setAttribute("aria-expanded", String(active));
    if (active) {
      form.querySelector('input[type="number"],select')?.focus();
    } else {
      toggle.focus();
    }
  }

  toggle.addEventListener("click", () => setEditing(true));
  cancel.addEventListener("click", () => setEditing(false));
});
