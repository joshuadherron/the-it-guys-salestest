// Save a single user's access without resetting the administration screen.
(() => {
  const container = document.getElementById("user-permissions");
  const toast = document.getElementById("admin-save-toast");
  if (!container || !toast) return;
  let hideToast;
  const notify = (message, error = false) => {
    toast.textContent = message;
    toast.classList.toggle("is-error", error);
    toast.hidden = false;
    clearTimeout(hideToast);
    hideToast = setTimeout(() => { toast.hidden = true; }, error ? 6500 : 3500);
  };
  container.addEventListener("submit", async event => {
    const form = event.target.closest("form[data-user-permissions-form]");
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const card = form.closest("details.admin-user-collapse");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new URLSearchParams(new FormData(form)),
        credentials: "same-origin"
      });
      const type = response.headers.get("content-type") || "";
      if (!type.includes("application/json")) throw new Error("Unexpected response. Please refresh and try again.");
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to save user permissions.");
      const title = card.querySelector(".admin-user-heading strong");
      const emailLabel = card.querySelector(".admin-user-email");
      const roleLabel = card.querySelector(".admin-user-role");
      if (title) title.textContent = data.displayName || data.email;
      if (emailLabel) emailLabel.textContent = data.email;
      if (roleLabel) roleLabel.textContent = data.role === "owner" ? "Owner" : "Sales";
      card.open = false;
      container.open = true;
      notify("User information has been saved.");
    } catch (error) {
      notify(error.message || "Unable to save user permissions.", true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
})();
