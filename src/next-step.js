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
          "Approve BII pricing",
          "Review the internal pricing worksheet and approve it before starting the SharePoint Quoting stage.",
          owner ? link("Approve pricing", root + "/quotes") : null,
          "Josh",
        );
      if (["Approved", "Sent"].includes(quote.status))
        return result(
          "Send to Quoting",
          "Start the controlled BII Quoting stage in SharePoint before any further stage advance.",
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
  if (stage === "Operations")
    return result(
      "Client is live",
      "No open blocking onboarding work remains.",
    );
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
          "The signed copy will complete this item automatically when it returns.",
          null,
          "Client",
        );
      if (item.signingPdf)
        return result(
          "Send agreement for signature",
          "Open the prepared signing PDF, send the Microsoft 365 eSignature request, then mark it sent below.",
          owner ? link("Open signing PDF", item.signingPdf) : null,
          "Josh",
        );
      return result(
        "Prepare agreement for signature",
        "Open and review the document. When internal notes are removed, return here and click Prepare for signature.",
        owner && item.url ? link("Open document", item.url) : null,
        "Josh",
      );
    }
    const proposal = item.workflowId === "MIT-05";
    return result(
      proposal ? "Get proposal accepted" : `Complete ${item.document}`,
      proposal
        ? `Assigned to ${item.assignee}. Open the proposal to review/send it. After the client accepts it, return here and mark it won below.`
        : `Assigned to ${item.assignee}. Open and save the document, then return here and mark complete below.`,
      item.url
        ? link("Open document", item.url)
        : link("Go to completion controls", root + `#item-${item.id}`),
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
