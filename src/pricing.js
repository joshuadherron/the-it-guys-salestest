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
