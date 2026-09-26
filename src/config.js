export const prices = {
  foundation: 3750,
  included_users: 5,
  included_devices: 5,
  included_mailboxes: 5,
  included_domains: 1,
  included_locations: 1,
  included_workloads: 1,
  additional_user: 75,
  additional_device: 185,
  additional_mailbox: 130,
  dell_deployment: 260,
};
export const stages = [
  "Prospecting",
  "Qualified",
  "Discovery",
  "Proposal Sent",
  "Closed Won",
  "Closed Lost",
  "Technical Assessment",
];
export const stops = [
  "urgent security hold",
  "domain/admin access concern",
  "server reported",
  "regulatory data",
  "multiple locations",
  "data in personal accounts",
  "existing MSP with a transition concern",
  "non-Microsoft email platform",
];
export const frequencies = ["Often", "Sometimes", "Rarely", "Not sure"];
export const tiers = [
  "Monitoring & Maintenance",
  "Essentials",
  "Standard",
  "BII only",
  "Not sure",
];
export const lanes = ["Business IT Integration", "Managed IT"];
export const opportunity = (id) => `OPP-${String(id).padStart(4, "0")}`;
