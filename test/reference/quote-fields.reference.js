'use strict';
/**
 * Reference field builders: approved quote record -> fill data for the tagged templates.
 * In the sales app the NUMBERS must come from the existing tested pricing engine and price
 * config table; these builders only format. Prices below mirror BII Standard v1.5 §7 and
 * Pricing Sheet Rev 20 so the samples are realistic.
 */
const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const dateLong = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------------- BII ----------------
const BII = { foundation: 3750, user: 75, mailbox: 130, device: 185, newDell: 260, included: 5 };
const BII_RATES = { 'RATE.Foundation': '$3,750', 'RATE.User': '$75 each', 'RATE.Mailbox': '$130 each', 'RATE.Device': '$185 each', 'RATE.NewDell': '$260 each' };

const BII_DEFAULTS = {
  hardwareText: 'Hardware is quoted separately at the approved project price and paid in full before the order is placed; returns, cancellation and warranty follow the manufacturer/distributor terms for the order.',
  regulatedText: c => `The environment is configured with HIPAA safeguards in mind, supports applicable HIPAA technical safeguards, and is designed to support secure handling of authorized protected health information. These technical controls do not replace ${c}'s own legal and compliance obligations. If The IT Guys' work requires access to protected health information, an appropriate Business Associate Agreement will be put in place before that access, where applicable.`,
};

function biiFields(q) {
  const extra = (n) => Math.max(0, n - BII.included);
  const xu = extra(q.users), xd = extra(q.devices), xm = extra(q.mailboxes);
  const costLine = (x, rate) => (x ? `${x} × ${money(rate)} = ${money(x * rate)}` : '$0');
  const lines = q.pricedLines || [];
  const total = BII.foundation + xu * BII.user + xd * BII.device + xm * BII.mailbox + (q.newDell || 0) * BII.newDell
    + lines.reduce((s, l) => s + l.price, 0) + (q.migration && q.migration.price ? q.migration.price : 0);
  const types = q.deviceTypes; // e.g. "2 Windows laptops, 1 Mac"
  const f = {
    'QSOW.ClientShortName': q.clientShortName,
    'QSOW.ClientLegalName': q.clientLegalName,
    'QSOW.QuoteId': q.quoteId,
    'QSOW.PreparedFor': q.preparedFor,
    'QSOW.IssueDate': dateLong(q.issueDate),
    'QSOW.BackupContact': q.backupContact || 'None named',
    'QSOW.Location': q.location,
    'QSOW.PrimaryDomain': q.primaryDomain,
    'QSOW.TargetTiming': q.targetTiming,
    'QSOW.Total': money(total),
    'QSOW.AddonsNote': total > BII.foundation ? '+ add-ons listed in §2' : '',
    'QSOW.SummaryText': q.summaryText,
    'QSOW.Users': String(q.users),
    'QSOW.Devices': String(q.devices),
    'QSOW.DeviceTypes': types,
    'QSOW.DevicesIncludedUsed': String(Math.min(q.devices, BII.included)),
    'QSOW.MigrationItem': q.migration ? `${q.migration.source} data migration (one standard source)` : '',
    'QSOW.LOBExclusion': q.lobExclusion || '',
    'QSOW.UsersCost': costLine(xu, BII.user),
    'QSOW.DevicesDesc': `${q.devices} — ${types}`,
    'QSOW.DevicesCost': costLine(xd, BII.device),
    'QSOW.Mailboxes': String(q.mailboxes),
    'QSOW.MailboxesCost': costLine(xm, BII.mailbox),
    'QSOW.MigrationRow': q.migration ? `${q.migration.source} — ${q.migration.price ? 'more complex (quoted)' : 'standard'}` : 'None',
    'QSOW.MigrationCost': q.migration && q.migration.price ? money(q.migration.price) : '$0',
    'QSOW.PrimaryLocationQty': '1',
    'QSOW.NewDellLabel': 'New Dell device deployment',
    'QSOW.NewDellQty': String(q.newDell || 0),
    'QSOW.NewDellCost': q.newDell ? `${q.newDell} × $260 = ${money(q.newDell * BII.newDell)} + hardware` : '$0',
    'QSOW.MigrationSource': q.migration ? q.migration.source : '',
    'QSOW.DeviceNote': q.deviceNote ? ' ' + q.deviceNote : '',
    'QSOW.Exceptions': q.exceptions || 'None identified at this time.',
    'LABEL.Hardware': 'Hardware.',
    'QSOW.HardwareText': BII_DEFAULTS.hardwareText,
    'LABEL.Locations': 'Additional locations.',
    'QSOW.LocationText': q.locationText,
    'LABEL.Regulated': 'Protected health information.',
    'QSOW.RegulatedText': BII_DEFAULTS.regulatedText(q.clientShortName),
    'QSOW.ExtraExclusions': q.extraExclusions ? '; ' + q.extraExclusions : '',
    'QSOW.ExtraAssumption': q.extraAssumption ? '; ' + q.extraAssumption : '',
    'QSOW.SignerNameTitle': q.signerNameTitle,
  };
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k]; // undefined = leave for Josh
  return {
    fields: f,
    flags: {
      'IF.NewDell': (q.newDell || 0) > 0, 'IF.DataMigration': !!q.migration, 'IF.Hardware': !!q.hardware,
      'IF.Locations': !!q.locationText, 'IF.Regulated': !!q.regulated,
    },
    repeats: {
      'REPEAT.Deliverable': (q.deliverables || []).map(t => ({ 'Deliverable.Text': t })),
      'REPEAT.Exclusion': (q.exclusions || []).map(t => ({ 'Exclusion.Text': t })),
      'REPEAT.PricedLine': lines.map(l => ({ 'PricedLine.Label': l.label, 'PricedLine.Desc': l.desc, 'PricedLine.Price': money(l.price) })),
    },
    rates: BII_RATES,
    total,
  };
}

// ---------------- Managed IT ----------------
const MIT = { user: 125, minimum: 375, shared: 15, server: 75, m365: 5, block: 115, hourly: 125 };
const MIT_RATES = { 'RATE.User': '$125/month', 'RATE.OnSiteBlock': '$115/hour', 'RATE.Shared': '$15/device/month', 'RATE.Server': '$75/server/month',
  'RATE.M365Backup': '$5/user/month', 'RATE.Hourly': '$125/hour', 'RATE.AfterHours': '$187.50/hour' };

function mitFields(q) {
  const userFee = Math.max(q.users * MIT.user, MIT.minimum);
  const minApplied = q.users * MIT.user < MIT.minimum;
  const sharedFee = (q.sharedDevices || 0) * MIT.shared;
  const serverFee = (q.servers || 0) * MIT.server;
  const m365Fee = (q.m365BackupUsers || 0) * MIT.m365;
  const sys = q.systemBackups || [];          // [{label, detail, price}] owner-priced per system
  const sysFee = sys.reduce((s, b) => s + b.price, 0);
  const blockFee = (q.onSiteBlockHours || 0) * MIT.block;
  const total = userFee + sharedFee + serverFee + m365Fee + sysFee + blockFee;
  const parts = [`${plural(q.users, 'user', 'users')} × $125${minApplied ? ' (3-user minimum)' : ''}`];
  if (q.sharedDevices) parts.push(`${plural(q.sharedDevices, 'shared device', 'shared devices')} × $15`);
  if (q.servers) parts.push(`${plural(q.servers, 'server', 'servers')} × $75`);
  if (q.m365BackupUsers) parts.push(`Microsoft 365 backup ${q.m365BackupUsers} × $5`);
  if (sys.length) parts.push(`system backup ${money(sysFee)}`);
  if (q.onSiteBlockHours) parts.push(`on-site block ${q.onSiteBlockHours} h × $115`);
  const anyBackup = !!q.m365BackupUsers || sys.length > 0;
  const f = {
    'MIT.ClientShortName': q.clientShortName,
    'MIT.ClientLegalName': q.clientLegalName,
    'MIT.QuoteId': q.quoteId,
    'MIT.PreparedFor': q.preparedFor,
    'MIT.Date': dateLong(q.date),
    'MIT.BackupContact': q.backupContact || 'None named',
    'MIT.Locations': q.locations || 'Single office',
    'MIT.Domain': q.domain,
    'MIT.ServiceStart': q.serviceStart,
    'MIT.MonthlyTotal': money(total),
    'MIT.Breakdown': parts.join(', '),
    'MIT.Onboarding': money(q.onboarding),
    'MIT.SummaryText': q.summaryText || 'The IT Guys will support your staff, keep your computers and devices protected and up to date, and manage your Microsoft 365 accounts as the business grows.',
    'MIT.Users': String(q.users),
    'MIT.DevicesSummary': [plural(q.computers, 'computer', 'computers'), q.sharedDevices ? `${plural(q.sharedDevices, 'shared iPad/tablet', 'shared iPads/tablets')}` : null].filter(Boolean).join(' and '),
    'MIT.DeviceKinds': q.deviceKinds || 'computers, phones and tablets',
    'MIT.M365BackupUsers': String(q.m365BackupUsers || 0),
    'MIT.Servers': String(q.servers || 0),
    'MIT.OnSiteHours': String(q.onSiteBlockHours || 0),
    'MIT.BackupExclusion': anyBackup ? 'Backup of any system not listed in the pricing table' : 'Backup, unless added later',
    'MIT.OnSiteExclusion': q.onSiteBlockHours ? 'On-site time beyond your monthly block (billed hourly)' : 'On-site visits (billed hourly)',
    'MIT.IntegrationNote': q.integrationFirst ? ' as set up in your Business IT Integration project' : '',
    'MIT.UsersCalc': `${q.users} × $125${minApplied ? ' (3-user minimum applies)' : ''}`,
    'MIT.UsersFee': money(userFee),
    'MIT.AssignedDevices': q.assignedDevicesText || plural(q.computers, 'computer', 'computers'),
    'MIT.SharedCalc': q.sharedDevices ? `${plural(q.sharedDevices, 'shared device', 'shared devices')} × $15` : 'None',
    'MIT.SharedFee': money(sharedFee),
    'MIT.ServersCalc': q.servers ? `${q.servers} × $75` : 'None',
    'MIT.ServersFee': money(serverFee),
    'MIT.M365BackupCalc': q.m365BackupUsers ? `${q.m365BackupUsers} users × $5` : 'Not selected',
    'MIT.M365BackupFee': m365Fee ? money(m365Fee) : 'Not included',
    'MIT.OnSiteCalc': `${q.onSiteBlockHours || 0} hours × $115`,
    'MIT.OnSiteFee': money(blockFee),
    'MIT.DevicesCoveredNote': q.computers ? `; your ${plural(q.computers, 'computer is', 'computers are')} covered within that allowance` : '',
    'MIT.SharedNote': q.sharedDevices ? `, so your ${plural(q.sharedDevices, 'shared device is', 'shared devices are')} ${money(sharedFee)}/month` : '',
    'MIT.OnboardingText': q.integrationFirst
      ? "Because your environment is built and documented in your Business IT Integration project, onboarding covers installing The IT Guys' monitoring and support tools, setting up shared-credential password management, and connecting your staff to The IT Guys' support process."
      : "Onboarding covers installing The IT Guys' monitoring and support tools, reviewing and documenting your environment, setting up shared-credential password management, and connecting your staff to The IT Guys' support process.",
    'MIT.OnSiteText': q.onSiteBlockHours
      ? `Your plan includes a pre-purchased block of ${plural(q.onSiteBlockHours, 'on-site hour', 'on-site hours')} each month at $115/hour. Unused hours don't roll over; on-site time beyond the block is billed at $125/hour in 30-minute increments.`
      : 'On-site visits, when needed, are billed at $125/hour in 30-minute increments.',
    'MIT.M365Pool': `(${q.m365BackupUsers || 0} TB at ${q.m365BackupUsers || 0} users)`,
    'MIT.ComputerBackupNote': sys.some(s => /computer|workstation|pc/i.test(s.label)) ? '' : ' Computers are not backed up separately, so staff should keep work files in OneDrive.',
    'MIT.BAANote': q.hipaa && q.integrationFirst ? ' Your existing Business Associate Agreement covers the integration project only.' : '',
    'MIT.ClientTerms': q.clientTerms || 'None.',
    'MIT.SizedFor': q.sizedFor || 'your business as it is today',
    'MIT.LOBPrefix': q.lobPrefix || '',
    'MIT.ExtraExclusions': q.extraExclusions ? '; ' + q.extraExclusions : '',
    'MIT.BAAAccept': q.hipaa ? ', plus a Business Associate Agreement,' : '',
  };
  return {
    fields: f,
    flags: { 'IF.M365Backup': !!q.m365BackupUsers, 'IF.Servers': !!q.servers, 'IF.SystemBackup': sys.length > 0,
      'IF.OnSiteBlock': !!q.onSiteBlockHours, 'IF.HIPAA': !!q.hipaa },
    repeats: { 'REPEAT.SystemBackup': sys.map(b => ({ 'SystemBackup.Label': b.label, 'SystemBackup.Calc': b.detail, 'SystemBackup.Fee': money(b.price) })) },
    rates: MIT_RATES,
    total,
  };
}

module.exports = { biiFields, mitFields, BII_RATES, MIT_RATES };
