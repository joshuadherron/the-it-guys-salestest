// Confirm destructive quote deletion twice before sending the existing CSRF-protected form.
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".quote-history-delete-form").forEach(form => {
    form.addEventListener("submit", event => {
      const label = form.dataset.quoteLabel || "this draft quote";
      if (!window.confirm("Delete " + label + "? This permanently removes the draft quote.")) {
        event.preventDefault();
        return;
      }
      if (!window.confirm("Final confirmation: permanently delete " + label + "? This cannot be undone.")) {
        event.preventDefault();
      }
    });
  });
});
