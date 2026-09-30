import { inferredState } from "./discovery-state.js";
const file = document.querySelector("#csv-file");
if (file)
  file.addEventListener("change", async () => {
    document.querySelector("#csv-content").value = await file.files[0].text();
  });

const discovery = document.querySelector("#discovery");
if (discovery) {
  let revision = Number(discovery.dataset.revision),
    pending = 0,
    failed = false,
    queue = Promise.resolve();
  const failures = new Set();
  const timers = new Map();
  let conflicted = false;
  const status = document.querySelector("#save-status");
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const read = (q, raw = false) => {
    const state = q.querySelector(".answer-state").value;
    if (!raw && state !== "answered") return { state, value: null };
    const type = q.dataset.type;
    const val = () => q.querySelector(".answer-value")?.value;
    let value;
    if (type === "multi")
      value = [...q.querySelectorAll(".answer-choice:checked")].map(
        (e) => e.value,
      );
    else if (type === "matrix")
      value = Object.fromEntries(
        [...q.querySelectorAll(".matrix-value")].map((e) => [
          e.dataset.row,
          ["not_sure", "not_discussed"].includes(e.value)
            ? { state: e.value, value: null }
            : { state: "answered", value: e.value },
        ]),
      );
    else if (type === "apps")
      value = {
        none: q.querySelector(".apps-none").checked,
        entries: [...q.querySelectorAll(".app-entry")].map((e) => ({
          name: e.querySelector(".app-name").value,
          use: e.querySelector(".app-use").value,
          hosting: e.querySelector(".app-hosting").value,
        })),
      };
    else if (type === "volume")
      value = {
        amount: q.querySelector(".volume-amount").value,
        unit: q.querySelector(".volume-unit").value,
      };
    else if (type === "billing")
      value = { same: q.querySelector(".billing-same").checked, answer: val() };
    else if (q.dataset.follow)
      value = { answer: val(), detail: q.querySelector(".follow-value").value };
    else value = val();
    return { state, value };
  };
  const update = (q) => {
    if (q.dataset.follow)
      q.querySelector(".follow-fields").hidden =
        q.querySelector(".answer-value").value !== q.dataset.follow;
    const apps = q.querySelector(".apps-none");
    if (apps) q.querySelector(".app-entries").hidden = apps.checked;
    if (q.dataset.question === "Q3.1") {
      const a = read(q);
      for (const id of ["Q3.2", "Q3.6"]) {
        const other = document.querySelector(`[data-question="${id}"]`);
        if (other)
          other.hidden =
            a.state !== "answered" ||
            !["A local IT company/MSP", "A break-fix provider"].includes(
              a.value,
            );
      }
    }
  };
  const save = (q) => {
    update(q);
    const cell = read(q);
    pending++;
    status.textContent = "Saving…";
    queue = queue
      .then(async () => {
        if (conflicted)
          throw new Error(
            "This discovery changed in another tab. Reload before continuing.",
          );
        const response = await fetch(
          `/prospects/${discovery.dataset.id}/discovery/save`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-csrf-token": csrf,
            },
            body: JSON.stringify({
              revision,
              question: q.dataset.question,
              answer: cell,
            }),
          },
        );
        const data = await response.json();
        if (response.status === 409) conflicted = true;
        if (!response.ok) throw new Error(data.error || "Save failed.");
        revision = data.revision;
        document.querySelector("#required-progress").textContent =
          `${data.progress.complete} of ${data.progress.total} required items complete`;
        const missing = document.querySelector("#missing-groups");
        missing.replaceChildren();
        for (const group of data.missing) {
          const li = document.createElement("li");
          li.textContent = group;
          missing.append(li);
        }
        const send = document.querySelector("#send-discovery");
        if (send)
          send.disabled =
            data.missing.length > 0 ||
            data.hold ||
            send.dataset.locked === "true";
        if (data.notification) {
          const notice = document.createElement("p");
          notice.className = "pill";
          notice.textContent = "URGENT SECURITY REVIEW: " + data.notification;
          document.querySelector("#urgent-guidance").append(notice);
        }
        q.querySelector(".question-status").textContent =
          cell.state === "answered"
            ? "Saved"
            : cell.state === "not_sure"
              ? "Not sure · Saved"
              : "Not discussed · Saved";
        q.querySelector(".question-status").className = "question-status saved";
        document.querySelector("#urgent-guidance").hidden = !data.hold;
        failures.delete(q.dataset.question);
        failed = failures.size > 0;
      })
      .catch((e) => {
        failures.add(q.dataset.question);
        failed = true;
        q.querySelector(".question-status").textContent = e.message;
        q.querySelector(".question-status").className = "question-status error";
      })
      .finally(() => {
        pending--;
        status.textContent = pending
          ? "Saving…"
          : failed
            ? "Some changes are not saved. Correct the highlighted answer before leaving."
            : "All changes saved.";
      });
  };
  const changed = (q, explicit = false) => {
    clearTimeout(timers.get(q));
    timers.delete(q);
    const state = q.querySelector(".answer-state");
    if (explicit) {
      q.dataset.explicitState =
        state.value === "answered" ? "not_discussed" : state.value;
      if (state.value !== "answered") {
        for (const field of q.querySelectorAll(
          ".answer-fields input, .answer-fields select",
        )) {
          if (field.type === "checkbox" || field.type === "radio")
            field.checked = false;
          else if (field.matches(".matrix-value, .app-hosting"))
            field.value = field.matches(".matrix-value")
              ? "not_discussed"
              : "Not discussed";
          else if (!field.matches(".volume-unit")) field.value = "";
        }
      }
    } else if (
      [...q.querySelectorAll("input")].some((field) => field.validity?.badInput)
    ) {
      failures.add(q.dataset.question);
      failed = true;
      q.querySelector(".question-status").textContent =
        "Enter a valid value before continuing.";
      status.textContent = "Some changes are not saved.";
      return;
    } else
      state.value = inferredState(
        q.dataset.type,
        read(q, true).value,
        q.dataset.explicitState || "not_discussed",
      );
    update(q);
    save(q);
  };
  const flush = () => {
    for (const q of [...timers.keys()]) changed(q);
  };
  for (const q of discovery.querySelectorAll(".question")) {
    update(q);
    const initialState = q.querySelector(".answer-state").value;
    q.dataset.explicitState =
      initialState === "answered" ? "not_discussed" : initialState;
    q.addEventListener("change", (e) =>
      changed(q, e.target.matches(".answer-state")),
    );
    q.addEventListener("input", (e) => {
      if (
        !e.target.matches(
          "input:not([type=checkbox]):not([type=radio]), textarea",
        )
      )
        return;
      clearTimeout(timers.get(q));
      timers.set(
        q,
        setTimeout(() => changed(q), 500),
      );
      status.textContent = "Unsaved changes…";
    });
    q.querySelector(".add-app")?.addEventListener("click", () => {
      const first = q.querySelector(".app-entry");
      const entry = first.cloneNode(true);
      entry.querySelectorAll("input").forEach((e) => (e.value = ""));
      entry.querySelector("select").value = "Not discussed";
      q.querySelector(".app-entries").append(entry);
    });
    q.addEventListener("click", (e) => {
      if (e.target.matches(".remove-app")) {
        if (q.querySelectorAll(".app-entry").length > 1) {
          e.target.closest(".app-entry").remove();
          changed(q);
        }
      }
    });
  }
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("a");
    if (a && (pending || failed || timers.size)) {
      e.preventDefault();
      flush();
      await queue;
      if (!failed) location.href = a.href;
    }
  });
  document.addEventListener("submit", async (e) => {
    if (pending || failed || timers.size) {
      e.preventDefault();
      flush();
      await queue;
      if (!failed) e.target.requestSubmit();
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (pending || failed || timers.size) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

document
  .querySelector(".print-button")
  ?.addEventListener("click", () => window.print());

const clientStatus = document.querySelector("[data-client-status]");
if (clientStatus) {
  const refresh = async () => {
    try {
      const response = await fetch(
        `/prospects/${clientStatus.dataset.clientStatus}/sharepoint-status`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      clientStatus.replaceChildren();
      if (data.client) {
        for (const [key, value] of Object.entries(data.client)) {
          const p = document.createElement("p");
          p.textContent = `${key}: ${value}`;
          clientStatus.append(p);
        }
      } else clientStatus.textContent = "No linked SharePoint client yet.";
      for (const request of data.requests) {
        const article = document.querySelector(
          `[data-request="${request.id}"]`,
        );
        if (article) {
          article.querySelector(".request-status").textContent = request.status;
          article.querySelector(".request-plain").textContent = request.plain;
          article.querySelector(".request-raw").textContent =
            request.result_message || "";
        }
      }
    } catch (e) {
      clientStatus.textContent = e.message;
    }
  };
  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 30000);
}

const workflowPanel = document.querySelector("[data-workflow-panel]");
if (workflowPanel) {
  let dirty = false;
  let refreshTimer;
  workflowPanel.addEventListener("input", () => {
    dirty = true;
  });
  workflowPanel.addEventListener("change", () => {
    dirty = true;
  });
  document.addEventListener("submit", (event) => {
    const message = event.target.dataset.confirm;
    if (message && !window.confirm(message)) event.preventDefault();
  });

  const refreshDelay = () =>
    Number(
      workflowPanel.querySelector("#next-step")?.dataset.pendingCount || 0,
    ) > 0
      ? 5000
      : 30000;

  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshWorkflow, refreshDelay());
  };

  const refreshWorkflow = async () => {
    if (
      document.hidden ||
      dirty ||
      workflowPanel.contains(document.activeElement)
    ) {
      scheduleRefresh();
      return;
    }
    try {
      const response = await fetch(
        `/prospects/${workflowPanel.dataset.workflowPanel}/workflow-panel`,
        { cache: "no-store" },
      );
      if (response.ok && !response.redirected)
        workflowPanel.innerHTML = await response.text();
    } catch {
      /* Keep the last visible state; POST revalidates every action. */
    } finally {
      scheduleRefresh();
    }
  };

  scheduleRefresh();
}
