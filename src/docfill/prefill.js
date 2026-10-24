import { DEFAULT_MANAGED_SUMMARY, deviceList } from "./managed-facts.js";
import { regulatedDataText } from "../bii-options.js";
// Prefill contractual document inputs from saved, already-known facts only.
// Never infer legal entity names, signer authority, contractual exceptions, or scope.
const text = value => typeof value === "string" && !/^(none\.?|null|undefined|n\/a|unknown)$/i.test(value.trim()) ? value.trim() : "";
export function documentPrefill(prospect, input, laneKey) {
  const p = prospect || {}, q = input || {};
  const address = [p.street_address, [p.city,p.state,p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const email = text(p.email).toLowerCase();
  const domain = email.includes("@") ? email.split("@").pop() : "";
  const publicMail = new Set(["gmail.com","yahoo.com","outlook.com","hotmail.com","aol.com","icloud.com","live.com","msn.com","proton.me","protonmail.com"]);
  const knownDomain = domain && !publicMail.has(domain) ? domain : "";
  const common = {
    // Business name is not necessarily the legal name; owner must verify.
    preparedFor:text(p.contact_name),
    backupContact:text(p.backup_contact || p.secondary_contact || ""),
    domain:knownDomain,
    summary:"",
    legalName:text(p.business_name),
    // Business name is a suggestion, not proof of the registered legal entity.\n    legalName: text(p.business_name),
    exceptions:"",
    signer:""
  };
  if (laneKey === "COM-PRP") {
    return {...common,
      preparedName: text(p.contact_name), preparedTitle: text(p.contact_title), preparedEmail: text(p.email),
      siteCount: 1, siteCities: text(p.city), summary: DEFAULT_MANAGED_SUMMARY,
      deviceKinds: ["computers", "phones", "tablets"],
      assignedSummary: deviceList(Number(q.computers || 0), Number(q.assignedPhones || 0), Number(q.assignedTablets || 0)),
      quoteComputers: Number(q.computers || 0), quoteAssignedPhones: Number(q.assignedPhones || 0), quoteAssignedTablets: Number(q.assignedTablets || 0), quoteSharedDevices: Number(q.extraDevices || 0),
      serviceStartMode: "after_contracts", serviceStartDate: "", onboardingMode: "standard",
      clientTerms: "None.", sizingMode: "today", sizingOther: "", onboardingFee: Number(q.onboarding || 0),
      onsiteMode: Number(q.onsiteHours)>0 ? "block" : "hourly", onsiteHours: Number(q.onsiteHours || 0),
      waiveOnboarding: false, waiverNote: "", noCompanyComputers: false, lobPrefix: "", extraExclusions: "",
    };
  }
  const types = [["windows","Windows"],["mac","Mac"],["ios","iOS"],["android","Android"],["unallocated","Platform not yet assigned"]]
    .filter(([key])=>Number(q[key])>0).map(([key,label])=>`${q[key]} ${label}`).join("; ");
  return {...common,location:address,deviceTypes:types,targetTiming:"",deviceNote:"",hardwareText:"",locationText:"",regulatedText:q.regulatedPackage?regulatedDataText:"",lobExclusion:"",extraExclusions:"",extraAssumption:""};
}
