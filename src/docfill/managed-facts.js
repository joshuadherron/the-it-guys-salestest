import { fail } from "../security.js";
import { mitFields } from "./managed-reference.js";
export const DEFAULT_MANAGED_SUMMARY = mitFields({ users: 3, computers: 3, date: "2000-01-01", onboarding: 350 }).fields["MIT.SummaryText"];
const invalidText = /^(?:none\.?|null|undefined|idk|0)$/i;
export function factText(value, label, allowNone = false) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 4000) fail("Invalid document fact: " + label);
  const result = value.trim();
  if (!result) return undefined;
  if (invalidText.test(result) && !(allowNone && result === "None.")) fail("Enter a real value for " + label + " or leave it blank.");
  return result;
}
export function factNumber(value, label, minimum = 0, integer = false) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(String(value))) fail("Enter a valid " + label + ".");
  const n = Number(value);
  if (!Number.isFinite(n) || n < minimum || n > 10000000 || (integer && !Number.isSafeInteger(n))) fail("Enter a valid " + label + ".");
  return n;
}
export function managedOwnerFacts(body) {
  const facts = {};
  for (const key of ["legalName", "preparedName", "preparedTitle", "preparedEmail", "backupContact", "siteCities", "domain", "serviceStartMode", "serviceStartDate", "summary", "onboardingMode", "waiverNote", "onsiteMode", "clientTerms", "sizingMode", "sizingOther", "lobPrefix", "extraExclusions"])
    facts[key] = factText(body[key], key, key === "clientTerms");
  for (const [key, min, whole] of [["siteCount", 1, true], ["onboardingFee", 0, false], ["onsiteHours", 0, true]])
    facts[key] = factNumber(body[key], key, min, whole);
  const kinds = body.deviceKinds === undefined ? [] : Array.isArray(body.deviceKinds) ? body.deviceKinds : [body.deviceKinds];
  if (kinds.some(k => !["computers", "phones", "tablets"].includes(k))) fail("Choose valid device kinds.");
  facts.deviceKinds = [...new Set(kinds)];
  for (const key of ["hipaa", "waiveOnboarding", "noCompanyComputers"]) facts[key] = body[key] === "yes" || body[key] === true;
  return facts;
}
export function validateDomain(value) {
  if (value === undefined) return undefined;
  if (/\s|http|@|[/\\:]/i.test(value) || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value))
    fail("Enter an email / Microsoft 365 domain with a dot, without spaces, http, or @.");
  return value.toLowerCase();
}
export function longDate(value) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("Choose a valid service start date.");
  const date = new Date(value + "T12:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail("Choose a valid service start date.");
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
export function formattedQuoteNumber(quote) {
  if (quote.quote_number) {
    if (!/^Q-\d{4}-\d{3,}$/.test(quote.quote_number)) fail("Invalid stored quote number.");
    return quote.quote_number;
  }
  const year = String(quote.created_at || quote.approved_at || new Date().toISOString()).slice(0, 4);
  if (!/^\d{4}$/.test(year) || !/^[1-9][0-9]*$/.test(String(quote.id))) fail("Invalid quote identity.");
  return `Q-${year}-${String(quote.id).padStart(3, "0")}`;
}
export const deviceList = (computers, phones, tablets) => [[computers, "computer"], [phones, "phone"], [tablets, "tablet"]]
  .filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}${n === 1 ? "" : "s"}`).join(", ");
export function managedReferenceFacts(quote, prospect, raw) {
  const owner = managedOwnerFacts(raw), input = quote.inputs;
  if (owner.preparedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.preparedEmail)) fail("Enter a valid prepared-for email.");
  if (owner.summary && owner.summary.length < 40) fail("Service summary must contain at least 40 characters.");
  const computers = Number(input.computers || 0), phones = Number(input.assignedPhones || 0), tablets = Number(input.assignedTablets || 0);
  if (!computers && input.users > 0 && !owner.noCompanyComputers) fail("Confirm: No company computers - users on shared devices only.");
  if (computers + phones + tablets > 3 * input.users) fail("Assigned devices exceed three per user. Correct and reapprove the worksheet; shared devices are separate.");
  if (owner.onboardingFee === undefined) fail("Enter the approved onboarding fee, or explicitly waive onboarding with a note.");
  if (owner.onboardingFee !== Number(input.onboarding || 0)) fail("Onboarding fee must match the approved worksheet. Save and approve revised pricing first.");
  if (!owner.onboardingFee && (!owner.waiveOnboarding || !owner.waiverNote)) fail("A zero onboarding fee requires Waive onboarding and a waiver note.");
  if (owner.onboardingFee && owner.waiveOnboarding) fail("A waived onboarding fee must be zero in the approved worksheet.");
  const hours = Number(input.onsiteHours || 0);
  if (owner.onsiteMode && !["hourly", "block"].includes(owner.onsiteMode)) fail("Choose Hourly or Block on-site support.");
  if (owner.onsiteMode === "hourly" && hours) fail("Hourly on-site support conflicts with the approved block. Reapprove revised pricing first.");
  if (owner.onsiteMode === "block" && (!hours || owner.onsiteHours !== hours)) fail("Block hours must match the approved worksheet.");
  let serviceStart;
  if (owner.serviceStartMode === "after_contracts") serviceStart = "After contracts are signed";
  else if (owner.serviceStartMode === "date") serviceStart = longDate(owner.serviceStartDate);
  else if (owner.serviceStartMode) fail("Choose a service start date or After contracts are signed.");
  if (owner.onboardingMode && !["standard", "after_bii"].includes(owner.onboardingMode)) fail("Choose a valid onboarding scope.");
  if (owner.sizingMode && !["today", "opening", "other"].includes(owner.sizingMode)) fail("Choose a valid sizing assumption.");
  const contact = owner.preparedName && owner.preparedTitle && owner.preparedEmail ? [owner.preparedName, owner.preparedTitle].filter(Boolean).join(", ") + (owner.preparedEmail ? " \u2014 " + owner.preparedEmail : "") : undefined;
  const assigned = deviceList(computers, phones, tablets);
  const kinds = owner.deviceKinds;
  const deviceKinds = kinds.length < 2 ? kinds[0] : kinds.length === 2 ? kinds.join(" and ") : kinds.slice(0, -1).join(", ") + " and " + kinds.at(-1);
  // A single site is represented as "Single office"; its optional city field
  // does not enter the document and should not block the download.
  if(owner.siteCount > 1 && owner.siteCities && /[0-9\r\n]/.test(owner.siteCities))
    fail("For multiple sites, enter city names only (for example, Beaumont, Nederland), without street addresses.");
  const sites = owner.siteCount;
  return { owner, facts: {
    clientShortName: factText(prospect.business_name, "business name"), clientLegalName: owner.legalName,
    quoteId: formattedQuoteNumber(quote), date: String(quote.approved_at || quote.created_at || new Date().toISOString()).slice(0, 10),
    preparedFor: contact, backupContact: owner.backupContact,
    locations: sites === undefined ? undefined : sites === 1 ? "Single office" : `${sites} locations${owner.siteCities ? " (" + owner.siteCities + ")" : ""}`,
    domain: validateDomain(owner.domain), serviceStart, summaryText: owner.summary,
    users: input.users, computers, assignedDevicesText: assigned || undefined, deviceKinds,
    sharedDevices: input.extraDevices, servers: input.servers, m365BackupUsers: input.backupUsers,
    onSiteBlockHours: hours, onboarding: owner.onboardingFee, integrationFirst: owner.onboardingMode === "after_bii",
    hipaa: owner.hipaa, clientTerms: owner.clientTerms, sizedFor: owner.sizingMode === "other" ? owner.sizingOther : owner.sizingMode === "opening" ? "your business as it opens" : "your business as it is today",
    lobPrefix: owner.lobPrefix ? owner.lobPrefix + " " : "", extraExclusions: owner.extraExclusions,
  }, assigned };
}
