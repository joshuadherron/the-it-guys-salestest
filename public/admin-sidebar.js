// Progressive enhancement: admin section headings become a left navigation.
// Existing details and forms remain functional if JavaScript is unavailable.
(() => {
  const root = document.querySelector(".admin-sidebar-layout");
  if (!root) return;
  const panels = Array.from(root.children).filter(el => el.matches("details.admin-block"));
  if (!panels.length) return;
  const workspace = document.createElement("div");
  workspace.className = "admin-settings-workspace";
  const nav = document.createElement("nav");
  nav.className = "admin-section-nav";
  nav.setAttribute("aria-label", "Administration sections");
  const content = document.createElement("div");
  content.className = "admin-section-content";
  const buttons = [];
  panels.forEach((panel, index) => {
    const heading = Array.from(panel.children).find(el => el.tagName === "SUMMARY");
    if (!heading) return;
    const label = heading.textContent.trim();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-section-link";
    button.textContent = label;
    button.setAttribute("aria-controls", panel.id || "admin-section-" + index);
    panel.id ||= "admin-section-" + index;
    nav.appendChild(button);
    content.appendChild(panel);
    buttons.push({panel,button});
    button.addEventListener("click", () => select(panel));
  });
  function select(target) {
    for (const {panel,button} of buttons) {
      const active = panel === target;
      panel.open = active;
      panel.hidden = !active;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    }
  }
  workspace.append(nav,content);
  const intro = root.querySelector(":scope > p.muted");
  (intro || root.querySelector("h1")).after(workspace);
  root.classList.add("admin-sidebar-ready");
  const requested = window.location.hash === "#user-permissions"
    ? document.getElementById("user-permissions") : null;
  select(requested && panels.includes(requested) ? requested : panels[0]);
})();
