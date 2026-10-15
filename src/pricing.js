export const platforms = ["windows", "mac", "ios", "android", "unallocated"];
export const oneOffItems = [
  "Complex migration",
  "Profile migration",
  "Specialized/shared/kiosk devices",
  "LOB apps",
  "Tenant-to-tenant",
  "Additional STANDARD workloads",
];
export function priceQuote(input, prices) {
  const get = (k) => {
    const n = Number(prices[k]);
    if (!Number.isFinite(n) || n < 0)
      throw new Error(`Missing or invalid price: ${k}`);
    return n;
  };
  const count = (k) => {
    const n = Number(input[k] ?? 0);
    if (!Number.isSafeInteger(n) || n < 0 || n > 100000)
      throw new Error(`Invalid count: ${k}`);
    return n;
  };
  const devices = platforms.reduce((n, k) => n + count(k), 0);
  const lines = [
    {
      label: "Foundation",
      quantity: 1,
      unit: get("foundation"),
      amount: get("foundation"),
    },
  ];
  for (const [key, label, included, rate] of [
    ["users", "Additional users", "included_users", "additional_user"],
    [
      "devices",
      "Additional managed business devices",
      "included_devices",
      "additional_device",
    ],
    [
      "mailboxes",
      "Additional straightforward mailbox migrations",
      "included_mailboxes",
      "additional_mailbox",
    ],
    ["dell", "New Dell device deployment labor", null, "dell_deployment"],
  ]) {
    const quantity = Math.max(
      0,
      (key === "devices" ? devices : count(key)) -
        (included ? get(included) : 0),
    );
    lines.push({
      label,
      quantity,
      unit: get(rate),
      amount: Math.round(quantity * get(rate) * 100) / 100,
    });
  }
  const pending = [];
  for (const label of oneOffItems) {
    const item = input.oneOff?.[label];
    if (item?.selected) {
      if (
        item?.amount === null ||
        item?.amount === undefined ||
        item?.amount === ""
      )
        pending.push(label);
      else {
        const amount = Number(item.amount);
        if (!Number.isFinite(amount) || amount < 0 || amount > 100000000)
          throw new Error("Invalid owner one-off amount.");
        lines.push({
          label: label + " — OWNER ONE-OFF — NOT STANDARD UNIT PRICE",
          quantity: 1,
          unit: amount,
          amount: Math.round(amount * 100) / 100,
        });
      }
    }
  }

  const additionalLocations = Math.max(
    0,
    count("locations") - get("included_locations"),
  );
  if (additionalLocations) {
    const base = input.locationLaborBase;
    if (base === null || base === undefined || base === "") {
      pending.push("Additional locations — repeatable implementation labor base");
    } else {
      const laborBase = Number(base);
      if (
        !Number.isFinite(laborBase) ||
        laborBase < 0 ||
        laborBase > 100000000
      )
        throw new Error("Invalid additional-location labor base.");
      const amount = Math.round(laborBase * 0.3 * 100) / 100;
      lines.push({
        label:
          "Additional mirrored location fee — 30% of owner-confirmed repeatable BII implementation labor base",
        quantity: 1,
        unit: amount,
        amount,
      });
    }
  }

  return {
    devices,
    lines,
    pending,
    total: lines.reduce((n, l) => n + Math.round(l.amount * 100), 0) / 100,
  };
}

/**
 * Managed service estimates from The IT Guys Pricing Sheet v20.
 * Legacy BII implementation quotes continue through priceQuote().
 */
export function priceManagedServices(input) {
  const qty = (key) => {
    const n = Number(input[key] ?? 0);
    if (!Number.isSafeInteger(n) || n < 0 || n > 100000) throw new Error("Invalid count: " + key);
    return n;
  };
  const money = (key) => {
    const n = Number(input[key] ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new Error("Invalid amount: " + key);
    return n;
  };
  const tier = input.serviceTier === "none" ? "none" : input.serviceTier === "monitoring" ? "monitoring" : "managed";
  const users = qty("users"), devices = qty("monitoringDevices"), servers = qty("servers");
  const extra = qty("extraDevices"), backupUsers = qty("backupUsers"), onsiteHours = qty("onsiteHours");
  const monthly = [], pending = [];
  const add = (label, quantity, unit) => monthly.push({label,quantity,unit,amount:Math.round(quantity*unit*100)/100});
  if (tier === "managed" && users > 0) {
    add("Managed IT users (minimum $375)", Math.max(3,users),125);
    if (extra) add("Shared/additional devices",extra,15);
    if (onsiteHours) add("Monthly on-site support block",onsiteHours,115);
    if (users && qty("computers") > 2*users) pending.push("Owner review required: more than 2 computers per user");
  } else if (tier === "monitoring" && devices > 0) {
    add("Monitoring-only managed devices",devices,45);
    if (extra || onsiteHours) pending.push("Additional devices / on-site blocks require Managed IT or separate owner approval");
  }
  if (tier !== "none" && servers) add("Managed servers",servers,75);
  if (tier !== "none" && backupUsers) add("Microsoft 365 backup users",backupUsers,5);
  if (qty("workstationBackups") || qty("serverBackups")) pending.push("Workstation/server backup: custom price required");
  let total = monthly.reduce((sum,l)=>sum+l.amount,0);
  if (tier==="monitoring" && (devices>0 || servers>0) && total<225) {
    add("Monitoring-only minimum adjustment",1,225-total);
    total=225;
  }
  const onboarding=tier==="none" ? 0 : money("onboarding");
  if (tier==="managed" && onboarding && (onboarding<300 || onboarding>750)) pending.push("Onboarding outside $300–$750: owner review");
  if (input.discountPercent && money("discountPercent")>0) pending.push("Volume discount requires discretionary owner approval and profitability review");
  return {lines:monthly,pending,total:Math.round(total*100)/100,onboarding,pricingMode:"managed_v20"};
}
