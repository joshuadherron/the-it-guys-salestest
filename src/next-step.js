import { mvd } from "./discovery-rules.js";
import { openItem, unsigned } from "./work-items.js";
export function nextStep(p, d, quotes, client, items, pendingRequests, role) {
  const root = `/prospects/${p.id}`,
    owner = role === "owner";
  const link = (label, href) => ({ label, href });
  const result = (title, detail = "", action = null, waitingOn = null) => ({
    title,
    detail,
    action,
    waitingOn,
  });
  if (p.hold || d?.status === "On Hold")
    return result(
      "On hold, waiting for Josh's review",
      "",
      owner ? link("Review discovery", root + "/discovery/summary") : null,
      "Josh",
    );
  if (!d || (d.status === "Draft" && mvd(d.answers).length))
    return result(
      d ? "Continue discovery" : "Start discovery",
      "Complete minimum viable discovery.",
      link(d ? "Continue discovery" : "Start discovery", root + "/discovery/1"),
      "Alanna",
    );
  if (d.status === "Draft")
    return result(
      "Send to Josh",
      "All eight required groups are complete.",
      link("Review & send to Josh", root + "/discovery/3"),
      "Alanna",
    );
  if (d.status === "Ready for Review" && !p.client_id)
    return owner
      ? result(
          "Review discovery",
          "Then create the client in SharePoint from SharePoint actions & history.",
          link("Review discovery", root + "/discovery/summary"),
          "Josh",
        )
      : result("With Josh for review", "", null, "Josh");
  const pending = pendingRequests.filter((r) =>
    ["Pending", "Processing"].includes(r.status),
  );
  if (pending.length)
    return result(
      `SharePoint is working (${pending.length} requests)`,
      "This page refreshes automatically.",
      null,
      "SharePoint",
    );
  if (!client)
    return result(
      "SharePoint status unavailable",
      "Check the connection before taking the next action.",
      owner ? link("Check SharePoint", "/admin") : null,
      "Josh",
    );
  const stage = client["Current Stage"];
  if (stage === "Sales Discovery") {
    if (p.service_lane === "Business IT Integration") {
      const quote = [...quotes].sort((a, b) => Number(b.id) - Number(a.id))[0];
      if (!quote)
        return result(
          "Build BII quote",
          "",
          link("Build BII quote", root + "/quotes"),
          "Alanna",
        );
      if (quote.status === "Draft")
        return result(
          "Approve quote",
          "",
          owner ? link("Approve quote", root + "/quotes") : null,
          "Josh",
        );
      if (quote.status === "Approved")
        return result(
          "Send to Quoting",
          "",
          owner ? link("Send to Quoting", root + "/handoff") : null,
          "Josh",
        );
    } else if (p.service_lane === "Managed IT")
      return result(
        "Start Technical Assessment",
        "",
        owner ? link("Start Technical Assessment", root + "/handoff") : null,
        "Josh",
      );
  }
  if (["Closed - Lost", "Closed - Former Client"].includes(stage))
    return result("Closed");
  if (!items)
    return result(
      "Work items unavailable",
      "Check the connection before advancing.",
      owner ? link("Check SharePoint", "/admin") : null,
      "Josh",
    );
  const item = items
    .filter((i) => i.stage === stage && i.blocking && openItem(i))
    .sort((a, b) =>
      (a.dueDate || "9999").localeCompare(b.dueDate || "9999"),
    )[0];
  if (item) {
    if (unsigned(item)) {
      if (item.signatureStatus === "Sent - awaiting signature")
        return result(
          `Out for signature${item.sentAt ? " since " + item.sentAt : ""}`,
          "",
          null,
          "Client",
        );
      return result(
        "Prepare for signature: set Internal Notes Removed and Ready to send",
        "Set Internal Notes Removed = Yes and Signature Status = Ready to send on the document in SharePoint.",
        owner && item.url ? link("Open document", item.url) : null,
        "Josh",
      );
    }
    return result(
      `Complete ${item.document}`,
      `Assigned to ${item.assignee}. Open the document, then mark complete below.`,
      link("Open document & mark complete", root + `#item-${item.id}`),
      item.assigneeEmail === "alanna@theitguys.us" ? "Alanna" : "Josh",
    );
  }
  if (["Blocked", "Exception pending"].includes(client["Stage Status"]))
    return result(
      client["Next Action"] || "Review blockers",
      "",
      owner ? link("Review blockers", root + "#work-items") : null,
      "Josh",
    );
  return owner
    ? result(
        "Advance stage",
        "",
        {
          label: "Advance stage",
          form: { action: "AdvanceStage", expectedStage: stage },
        },
        "Josh",
      )
    : result("Waiting for Josh", "", null, "Josh");
}
