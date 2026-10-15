// Prefill contractual document inputs from saved, already-known facts only.
// Never infer legal entity names, signer authority, contractual exceptions, or scope.
const text = value => typeof value === "string" ? value.trim() : "";
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
    backupContact:"",
    domain:knownDomain,
    summary:"",
    legalName:"",
    exceptions:"",
    signer:""
  };
  if (laneKey === "COM-PRP") {
    const kinds = [Number(q.computers)>0?`${q.computers} business computers`:"",Number(q.extraDevices)>0?`${q.extraDevices} additional/shared devices`:"",Number(q.servers)>0?`${q.servers} servers`:""].filter(Boolean).join("; ");
    return {...common,locations:address,deviceKinds:kinds,assignedDevices:kinds,serviceStart:"",onboardingText:"",clientTerms:"",sizedFor:""};
  }
  const types = [["windows","Windows"],["mac","Mac"],["ios","iOS"],["android","Android"],["unallocated","Platform not yet assigned"]]
    .filter(([key])=>Number(q[key])>0).map(([key,label])=>`${q[key]} ${label}`).join("; ");
  return {...common,location:address,deviceTypes:types,targetTiming:"",deviceNote:"",hardwareText:"",locationText:"",regulatedText:"",lobExclusion:"",extraExclusions:"",extraAssumption:""};
}
