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
  const status = document.querySelector("#save-status");
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const read = (q) => {
    const state = q.querySelector(".answer-state").value;
    if (state !== "answered") return { state, value: null };
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
    q.querySelector(".answer-fields").hidden =
      q.querySelector(".answer-state").value !== "answered";
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
        if (!response.ok) throw new Error(data.error || "Save failed.");
        revision = data.revision;
        if (data.notification) {
          const notice = document.createElement("p");
          notice.className = "pill";
          notice.textContent = "URGENT SECURITY REVIEW: " + data.notification;
          document.querySelector("#urgent-guidance").append(notice);
        }
        q.querySelector(".question-status").textContent = "Saved";
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
  for (const q of discovery.querySelectorAll(".question")) {
    update(q);
    q.addEventListener("change", () => save(q));
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
          save(q);
        }
      }
    });
  }
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("a");
    if (a && (pending || failed)) {
      e.preventDefault();
      await queue;
      if (!failed) location.href = a.href;
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (pending || failed) {
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
