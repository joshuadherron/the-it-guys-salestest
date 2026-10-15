import { DEFAULT_MANAGED_SUMMARY } from "../../src/docfill/managed-facts.js";
import { priceManagedServices, priceQuote } from "../../src/pricing.js";
import { prices } from "../../src/config.js";
import { buildManagedFill, buildBiiFill } from "../../src/docfill/quote-fields.js";

// Synthetic owner-approved examples only; no customer data or database access.
export function quoteDocumentSamples() {
  const prospect = { business_name: "Example Services LLC" };
  const common = { legalName: prospect.business_name, preparedFor: "Sample Owner", backupContact: "Sample Administrator", domain: "example.test", summary: "Provide the selected services for the quantities listed in this quote." };
  const approved = { status: "Approved", approved_at: "2026-10-15T12:00:00Z" };
  const managedInput = { pricingMode: "managed_v20", serviceTier: "managed", users: 3, computers: 3, assignedPhones: 1, assignedTablets: 1, extraDevices: 1, servers: 1, backupUsers: 2, onsiteHours: 1, onboarding: 350, workstationBackups: 0, serverBackups: 0, includeBii: false };
  const managed = priceManagedServices(managedInput);
  const managedQuote = { ...approved, id: 9001, inputs: managedInput, line_items: managed.lines, total: managed.total };
  const managedOwner = { ...common, preparedName: "Sample Owner", preparedTitle: "Director", preparedEmail: "owner@example.test", siteCount: 1, serviceStartMode: "date", serviceStartDate: "2026-12-01", summary: DEFAULT_MANAGED_SUMMARY, deviceKinds: ["computers", "phones", "tablets"], onboardingMode: "standard", onboardingFee: 350, onsiteMode: "block", onsiteHours: 1, clientTerms: "None.", sizingMode: "today", hipaa: true };
  const biiInput = { includeBii: true, users: 7, windows: 6, mac: 1, ios: 0, android: 0, unallocated: 0, mailboxes: 7, dell: 1, locations: 1 };
  const bii = priceQuote(biiInput, prices);
  const biiQuote = { ...approved, id: 9002, inputs: biiInput, line_items: bii.lines, total: bii.total };
  const biiOwner = { ...common, location: "One office", targetTiming: "Within the agreed implementation schedule", deviceTypes: "Six Windows computers and one Mac", exceptions: "No additional exceptions", signer: "Sample Owner, Managing Member", hardwareText: "Hardware is quoted separately.", deliverables: ["Configure the included business environment.", "Complete the agreed implementation handoff."], exclusions: ["Hardware purchases are quoted separately.", "No custom migration work is included."] };
  return [
    { key: "COM-PRP", name: "COM-PRP-v1.8.docx", quote: managedQuote, data: buildManagedFill({ quote: managedQuote, prospect, owner: managedOwner }) },
    { key: "BII-QSOW", name: "BII-QSOW-v1.6.docx", quote: biiQuote, data: buildBiiFill({ quote: biiQuote, prospect, owner: biiOwner, prices }) },
  ];
}
