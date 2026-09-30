const form = document.querySelector("[data-quote-calculator]");
if (form) {
  const target = document.querySelector("#quote-calculation");
  const status = document.querySelector("#quote-preview-status");
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
  let timer = null;
  let controller = null;
  let revision = 0;

  async function recalculate() {
    const myRevision = ++revision;
    if (controller) controller.abort();
    controller = new AbortController();

    if (status) status.textContent = "Updating price…";

    try {
      const response = await fetch(form.dataset.calculateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          ...(csrf ? { "x-csrf-token": csrf } : {}),
        },
        body: new URLSearchParams(new FormData(form)),
        signal: controller.signal,
      });

      const html = await response.text();
      if (!response.ok) throw new Error("Price update failed. Check the entered values.");
      if (myRevision !== revision) return;

      target.innerHTML = html;
      if (status) status.textContent = "Price updated.";
    } catch (error) {
      if (error.name === "AbortError" || myRevision !== revision) return;
      if (status)
        status.textContent =
          error.message || "Price update failed. Check the entered values.";
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(recalculate, 150);
  }

  form.addEventListener("input", schedule);
  form.addEventListener("change", schedule);
}
