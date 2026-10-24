// Exact expected tag sets for pinned BII v1.7 and Managed IT v1.8 Word masters.
// Regenerate only after template promotion and corresponding tests.
import { projectTags } from "../project-contract.js";
export const TAGSETS = Object.freeze({
 "ENG-PRJ":projectTags,"ENG-HRLY":projectTags,
 "BII-QSOW": `Deliverable.Text Exclusion.Text IF.Assessed IF.DataMigration IF.Hardware IF.Locations IF.NewDell IF.Operating IF.Regulated IF.RegulatedPackage LABEL.Hardware LABEL.Locations LABEL.Operating LABEL.Regulated NOTE PricedLine.Desc PricedLine.Label PricedLine.Price QSOW.AddonsNote QSOW.AfterHoursWindows QSOW.AssessmentDate QSOW.BackupContact QSOW.ClientLegalName QSOW.ClientShortName QSOW.DeviceNote QSOW.DeviceTypes QSOW.Devices QSOW.DevicesCost QSOW.DevicesDesc QSOW.DevicesIncludedUsed QSOW.Exceptions QSOW.ExtraAssumption QSOW.ExtraExclusions QSOW.HardwareText QSOW.IssueDate QSOW.LOBExclusion QSOW.Location QSOW.LocationText QSOW.Mailboxes QSOW.MailboxesCost QSOW.MigrationCost QSOW.MigrationItem QSOW.MigrationRow QSOW.MigrationSource QSOW.NewDellCost QSOW.NewDellLabel QSOW.NewDellQty QSOW.PilotGroup QSOW.PreparedFor QSOW.PrimaryDomain QSOW.PrimaryLocationQty QSOW.QuoteId QSOW.RegulatedCost QSOW.RegulatedText QSOW.RegulatedUsers QSOW.SignerNameTitle QSOW.SummaryText QSOW.TargetTiming QSOW.Total QSOW.Users QSOW.UsersCost QSOW.WaveBasis QSOW.WaveCount QSOW.WaveDates RATE.Device RATE.Foundation RATE.Mailbox RATE.NewDell RATE.RegulatedBase RATE.RegulatedUser RATE.User REPEAT.Deliverable REPEAT.Exclusion REPEAT.PricedLine`.split(" ").sort(),
 "COM-PRP": `IF.HIPAA IF.M365Backup IF.OnSiteBlock IF.Servers IF.SystemBackup MIT.AssignedDevices MIT.BAAAccept MIT.BAANote MIT.BackupContact MIT.BackupExclusion MIT.Breakdown MIT.ClientLegalName MIT.ClientShortName MIT.ClientTerms MIT.ComputerBackupNote MIT.Date MIT.DeviceKinds MIT.DevicesCoveredNote MIT.DevicesSummary MIT.Domain MIT.ExtraExclusions MIT.IntegrationNote MIT.LOBPrefix MIT.Locations MIT.M365BackupCalc MIT.M365BackupFee MIT.M365BackupUsers MIT.M365Pool MIT.MonthlyTotal MIT.OnSiteCalc MIT.OnSiteExclusion MIT.OnSiteFee MIT.OnSiteHours MIT.OnSiteText MIT.Onboarding MIT.OnboardingText MIT.PreparedFor MIT.QuoteId MIT.Servers MIT.ServersCalc MIT.ServersFee MIT.ServiceStart MIT.SharedCalc MIT.SharedFee MIT.SharedNote MIT.SizedFor MIT.SummaryText MIT.Users MIT.UsersCalc MIT.UsersFee NOTE RATE.AfterHours RATE.Hourly RATE.M365Backup RATE.OnSiteBlock RATE.Server RATE.Shared RATE.User REPEAT.SystemBackup SystemBackup.Calc SystemBackup.Fee SystemBackup.Label`.split(" ").sort()
});
export function assertTagset(key, actual) {
 const expected=TAGSETS[key];
 if(!expected) throw new Error("Unknown quote template key");
 const have=new Set(actual);
 const want=new Set(expected);
 const missing=expected.filter(x=>!have.has(x));
 const extra=[...have].filter(x=>!want.has(x));
 if(missing.length||extra.length) throw new Error(`Quote template tags differ from approved ${key} master: missing [${missing.join(", ")}]; extra [${extra.join(", ")}]`);
}
