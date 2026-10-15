const quoteEstimateState = {managed:null,bii:null};
const quoteMoney = (n) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
function updateBuildTotal() {
  const managed = quoteEstimateState.managed;
  const bii = quoteEstimateState.bii;
  const managedForm = document.querySelector('[data-preview-target="quote-calculation"]');
  const onboardingField = managedForm?.querySelector('[name="onboarding"]');
  const onboarding = document.getElementById('managed-tier-select')?.value === "none" ? 0 : Number(onboardingField?.value || 0);
  const validOnboarding = Number.isFinite(onboarding) && onboarding >= 0;
  const monthly = managed?.monthly ?? 0;
  const biiAmount = bii?.onetime ?? 0;
  const managedOneTime = managed?.onetime ?? 0;
  const oneTime = biiAmount + managedOneTime + (validOnboarding ? onboarding : 0);
  const put = (id,value) => { const el=document.getElementById(id); if(el) el.textContent=value; };
  put("build-monthly",quoteMoney(monthly)+" / month");
  put("build-bii",quoteMoney(biiAmount)+" one-time");
  put("build-onboarding",validOnboarding ? quoteMoney(onboarding)+" one-time" : "Check amount");
  put("build-onetime",quoteMoney(oneTime));
  const ready = Boolean(managed && bii && validOnboarding);
  put("build-first-month",ready ? "Estimated first month plus one-time charges: "+quoteMoney(monthly+oneTime) : "Estimated first month plus one-time charges: Waiting for valid estimates");
  const issues = [...(managed?.pending ? ["Managed Services requires pricing review"] : []),...(bii?.pending ? ["BII Services requires pricing review"] : [])];
  put("build-review",!ready ? "Estimate incomplete — check the service sections above." : issues.length ? issues.join("; ")+". Totals exclude unresolved custom pricing." : "Indicative estimate — subject to owner approval.");
}
document.querySelectorAll("[data-quote-calculator]").forEach((form) => {
  const target = document.getElementById(form.dataset.previewTarget || "quote-calculation");
  const status = document.getElementById(form.dataset.statusTarget || "quote-preview-status");
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
  let timer = null;
  let controller = null;
  let revision = 0;

  async function recalculate() {
    const myRevision = ++revision;
    if (controller) controller.abort();
    controller = new AbortController();

    if (status) status.textContent = "Updating price…";
    quoteEstimateState[form.dataset.previewTarget === "quote-calculation" ? "managed" : "bii"] = null;
    updateBuildTotal();

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
      const estimate = target.querySelector(".quote-preview-data");
      if (estimate) {
        quoteEstimateState[form.dataset.previewTarget === "quote-calculation" ? "managed" : "bii"] = {monthly:Number(estimate.dataset.estimateMonthly),onetime:Number(estimate.dataset.estimateOnetime),pending:Number(estimate.dataset.estimatePending)};
        updateBuildTotal();
      }
      if (form.dataset.previewTarget === "quote-calculation") {
        const summary = document.getElementById("managed-services-summary-total");
        const heading = [...target.querySelectorAll("h2")].find(el => el.textContent.includes("Total:"));
        if (summary && estimate) summary.textContent = "Monthly: " + quoteMoney(Number(estimate.dataset.estimateMonthly));
      }
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
  document.querySelectorAll(`[form="${form.id}"]`).forEach(control => {control.addEventListener("input",schedule);control.addEventListener("change",schedule);});
  if (form.dataset.previewTarget === "quote-calculation") form.querySelector('[name="onboarding"]')?.addEventListener("input",updateBuildTotal);
  if (!form.disabled && !form.querySelector("fieldset:disabled")) schedule();
});

updateBuildTotal();
