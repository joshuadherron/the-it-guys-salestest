// Internal Quoting Guide v16: advisory onboarding reference, never auto-price.
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("managed-pricing-form");
  const guidance = document.getElementById("onboarding-guidance");
  const complexity = document.getElementById("onboarding-complexity");
  const apply = document.getElementById("apply-onboarding-guidance");
  const fee = document.getElementById("managed-onboarding");
  const tier = document.getElementById("managed-tier-select");
  if (!form || !guidance || !complexity || !apply || !fee || !tier) return;
  const count = name => Math.max(0, Number(form.elements.namedItem(name)?.value || 0));
  let suggested = null;
  function update() {
    suggested = null;
    apply.hidden = true;
    const service = tier.value;
    const users = count("users"), devices = count("monitoringDevices"), servers = count("servers");
    const kind = complexity.value;
    let label = "";
    if (service === "none") {
      label = "No Managed Services selected; no managed onboarding recommendation.";
    } else if (service === "monitoring") {
      if (!devices) label = "Enter the Monitoring-Only device count to see onboarding guidance.";
      else if (devices <= 5) suggested = [250,300];
      else if (devices <= 15) suggested = [400,500];
      else if (devices <= 30) suggested = [600,750];
      else label = "31+ devices: custom onboarding quote required. Do not extrapolate.";
    } else if (!users) {
      label = "Enter managed user count and assess complexity.";
    } else if (kind === "unknown") {
      label = "Select onboarding complexity to compare against v16 reference profiles.";
    } else if (users <= 3 && servers === 0 && kind === "simple") {
      suggested = [300,400];
      label = "Small, simple remote-first office; confirm cloud/M365 scope.";
    } else if (users >= 5 && users <= 8 && servers === 1 && kind === "standard") {
      suggested = [450,600];
      label = "5–8 users, one server, standard network complexity.";
    } else if (users >= 9 && users <= 12 && servers >= 1 && kind === "complex") {
      suggested = [650,750];
      label = "9–12 users, server and significant complexity.";
    } else {
      label = "No exact v16 reference profile matches. Owner must assess scope and select the fee; Managed IT general guidance is $300–$750.";
    }
    if (suggested) {
      const [low,high] = suggested;
      const midpoint = Math.round((low+high)/20)*10;
      label = "Guided range: $"+low+"–$"+high+". "+label+" Suggested midpoint: $"+midpoint+".";
      apply.hidden = false;
      apply.textContent = "Use $"+midpoint+" midpoint";
      apply.dataset.amount = String(midpoint);
    }
    const current = Number(fee.value || 0);
    if (service === "managed" && current > 0 && (current < 300 || current > 750))
      label += " Warning: outside Managed IT $300–$750 guidance; owner review required.";
    if (service === "monitoring" && suggested && current > 0 && (current < suggested[0] || current > suggested[1]))
      label += " Selected fee differs from the reference range; document the reason.";
    guidance.textContent = label;
  }
  form.addEventListener("input",update);
  form.addEventListener("change",update);
  tier.addEventListener("change",update);
  complexity.addEventListener("change",update);
  apply.addEventListener("click",() => {
    if (!suggested) return;
    fee.value = apply.dataset.amount;
    fee.dispatchEvent(new Event("input",{bubbles:true}));
  });
  update();
});
