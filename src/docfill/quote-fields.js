import {priceManagedServices,priceQuote,platforms} from "../pricing.js";
const money=n=>"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:Number(n)%1?2:0,maximumFractionDigits:2});
const count=(o,k)=>Number(o[k]||0);
const required=(obj,key)=>{const v=obj?.[key];if(v===undefined||v===null||v==="")throw new Error("Missing owner-entered document field: "+key);return String(v)};
const formatDate=d=>new Date(d).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"});
export function buildManagedFill({quote,prospect,owner={}}){
 const input=quote.inputs,calc=priceManagedServices(input);
 if(input.pricingMode!=="managed_v20"||input.serviceTier!=="managed")throw new Error("Managed IT document requires a Managed IT quote.");
 if(calc.pending.length)throw new Error("Pricing review required: "+calc.pending.join("; "));
 const lines=quote.line_items;
 if(!Array.isArray(lines))throw new Error("Approved quote line items are required.");
 const monthly=lines.filter(x=>x.billing!=="one_time").reduce((sum,l)=>sum+Number(l.amount),0);
 if(Math.abs(monthly-calc.total)>.005)throw new Error("Approved Managed IT monthly pricing does not match the current pricing engine.");
 const users=count(input,"users"),extra=count(input,"extraDevices"),servers=count(input,"servers"),backup=count(input,"backupUsers"),hours=count(input,"onsiteHours"),computers=count(input,"computers");
 if(count(input,"workstationBackups")||count(input,"serverBackups"))throw new Error("System backups require explicit per-system owner pricing before document generation.");
 const fee=Math.max(3,users)*125,sharedFee=extra*15,serverFee=servers*75,backupFee=backup*5,onsiteFee=hours*115;
 const rates={"RATE.User":"$125/month","RATE.OnSiteBlock":"$115/hour","RATE.Shared":"$15/device/month","RATE.Server":"$75/server/month","RATE.M365Backup":"$5/user/month","RATE.Hourly":"$125/hour","RATE.AfterHours":"$187.50/hour"};
 if(input.includeBii && !lines.some(x=>x.billing==="one_time" && String(x.label).includes("BII Integration"))) throw new Error("Combined quote is missing its separately approved BII foundation line.");
 const fields={
  "MIT.ClientShortName":prospect.business_name,"MIT.ClientLegalName":required(owner,"legalName"),"MIT.QuoteId":String(quote.id),
  "MIT.PreparedFor":required(owner,"preparedFor"),"MIT.Date":formatDate(quote.approved_at||new Date().toISOString()),"MIT.BackupContact":required(owner,"backupContact"),
  "MIT.Locations":required(owner,"locations"),"MIT.Domain":required(owner,"domain"),"MIT.ServiceStart":required(owner,"serviceStart"),
  "MIT.MonthlyTotal":money(calc.total),"MIT.Breakdown":lines.filter(x=>x.billing!=="one_time").map(x=>x.label+" "+money(x.amount)).join("; "),
  "MIT.Onboarding":money(calc.onboarding),"MIT.SummaryText":required(owner,"summary"),"MIT.Users":String(users),
  "MIT.DevicesSummary":computers+" computers"+(extra?", "+extra+" shared devices":""),
  "MIT.DeviceKinds":required(owner,"deviceKinds"),"MIT.M365BackupUsers":String(backup),"MIT.Servers":String(servers),"MIT.OnSiteHours":String(hours),
  "MIT.BackupExclusion":backup?"Backup of any system not listed in the pricing table":"Backup, unless added later",
  "MIT.OnSiteExclusion":hours?"On-site time beyond your monthly block (billed hourly)":"On-site visits (billed hourly)",
  "MIT.IntegrationNote":input.includeBii?" as set up in your Business IT Integration project":"",
  "MIT.UsersCalc":users+" × $125"+(users<3?" (3-user minimum applies)":""),
  "MIT.UsersFee":money(fee),"MIT.AssignedDevices":required(owner,"assignedDevices"),
  "MIT.SharedCalc":extra?extra+" shared devices × $15":"None","MIT.SharedFee":money(sharedFee),
  "MIT.ServersCalc":servers?servers+" × $75":"None","MIT.ServersFee":money(serverFee),
  "MIT.M365BackupCalc":backup?backup+" users × $5":"Not selected","MIT.M365BackupFee":backup?money(backupFee):"Not included",
  "MIT.OnSiteCalc":hours+" hours × $115","MIT.OnSiteFee":money(onsiteFee),
  "MIT.DevicesCoveredNote":computers?"; your "+computers+" computers are covered within that allowance":"",
  "MIT.SharedNote":extra?", so your "+extra+" shared devices are "+money(sharedFee)+"/month":"",
  "MIT.OnboardingText":required(owner,"onboardingText"),
  "MIT.OnSiteText":hours?"Your plan includes "+hours+" prepaid on-site hours each month at $115/hour. Unused hours do not roll over; additional time is $125/hour.":"On-site visits are billed at $125/hour.",
  "MIT.M365Pool":"("+backup+" TB at "+backup+" users)",
  "MIT.ComputerBackupNote":" Computers are not backed up separately; keep work files in OneDrive.",
  "MIT.BAANote":owner.hipaa&&input.includeBii?" Your existing Business Associate Agreement covers the integration project only.":"",
  "MIT.ClientTerms":required(owner,"clientTerms"),"MIT.SizedFor":required(owner,"sizedFor"),
  "MIT.LOBPrefix":owner.lobPrefix||"","MIT.ExtraExclusions":owner.extraExclusions?"; "+owner.extraExclusions:"",
  "MIT.BAAAccept":owner.hipaa?" and Business Associate Agreement":""
 };
 return {fields,flags:{"IF.M365Backup":!!backup,"IF.Servers":!!servers,"IF.SystemBackup":false,"IF.OnSiteBlock":!!hours,"IF.HIPAA":!!owner.hipaa},
 repeats:{"REPEAT.SystemBackup":[]},rates};
}
export function buildBiiFill({quote,prospect,owner={},prices}){
 const input=quote.inputs;
 if(!input.includeBii)throw new Error("Quote does not include BII.");
 if(input.pricingMode==="managed_v20")throw new Error("Combined Managed/BII quote requires a separately priced and approved BII scope before BII document fill.");
 const calc=priceQuote(input,prices);
 if(calc.pending.length)throw new Error("Pricing review required: "+calc.pending.join("; "));
 if(Math.abs(Number(quote.total)-calc.total)>.005)throw new Error("Approved BII total differs from current pricing.");
 if(calc.lines.some(l=>String(l.label).includes("OWNER ONE-OFF") || String(l.label).includes("Additional mirrored location")))throw new Error("BII quote has custom priced lines that require explicit owner line descriptions before document generation.");
 const devices=platforms.reduce((n,k)=>n+count(input,k),0);
 const cost=(qty,rate)=>qty?qty+" × "+money(rate)+" = "+money(qty*rate):"$0";
 const xusers=Math.max(0,count(input,"users")-Number(prices.included_users));
 const xdevices=Math.max(0,devices-Number(prices.included_devices));
 const xmail=Math.max(0,count(input,"mailboxes")-Number(prices.included_mailboxes));
 const dell=count(input,"dell");
 const fields={
 "QSOW.ClientShortName":prospect.business_name,"QSOW.ClientLegalName":required(owner,"legalName"),
 "QSOW.QuoteId":String(quote.id),"QSOW.PreparedFor":required(owner,"preparedFor"),
 "QSOW.IssueDate":formatDate(quote.approved_at||new Date().toISOString()),
 "QSOW.BackupContact":required(owner,"backupContact"),"QSOW.Location":required(owner,"location"),
 "QSOW.PrimaryDomain":required(owner,"domain"),"QSOW.TargetTiming":required(owner,"targetTiming"),
 "QSOW.Total":money(calc.total),"QSOW.AddonsNote":calc.total>Number(prices.foundation)?"+ add-ons listed in §2":"",
 "QSOW.SummaryText":required(owner,"summary"),"QSOW.Users":String(input.users),
 "QSOW.Devices":String(devices),"QSOW.DeviceTypes":required(owner,"deviceTypes"),
 "QSOW.DevicesIncludedUsed":String(Math.min(devices,Number(prices.included_devices))),
 "QSOW.MigrationItem":"","QSOW.LOBExclusion":owner.lobExclusion||"",
 "QSOW.UsersCost":cost(xusers,Number(prices.additional_user)),
 "QSOW.DevicesDesc":devices+" — "+required(owner,"deviceTypes"),
 "QSOW.DevicesCost":cost(xdevices,Number(prices.additional_device)),
 "QSOW.Mailboxes":String(input.mailboxes),"QSOW.MailboxesCost":cost(xmail,Number(prices.additional_mailbox)),
 "QSOW.MigrationRow":"None","QSOW.MigrationCost":"$0","QSOW.PrimaryLocationQty":"1",
 "QSOW.NewDellLabel":"New Dell device deployment","QSOW.NewDellQty":String(dell),
 "QSOW.NewDellCost":dell?cost(dell,Number(prices.dell_deployment))+" + hardware":"$0",
 "QSOW.MigrationSource":"","QSOW.DeviceNote":owner.deviceNote||"",
 "QSOW.Exceptions":required(owner,"exceptions"),"LABEL.Hardware":"Hardware.",
 "QSOW.HardwareText":owner.hardwareText||"","LABEL.Locations":"Additional locations.",
 "QSOW.LocationText":owner.locationText||"","LABEL.Regulated":"Protected health information.",
 "QSOW.RegulatedText":owner.regulatedText||"",
 "QSOW.ExtraExclusions":owner.extraExclusions?"; "+owner.extraExclusions:"",
 "QSOW.ExtraAssumption":owner.extraAssumption?"; "+owner.extraAssumption:"",
 "QSOW.SignerNameTitle":required(owner,"signer")
 };
 const rates={"RATE.Foundation":money(prices.foundation),"RATE.User":money(prices.additional_user)+" each",
 "RATE.Device":money(prices.additional_device)+" each","RATE.Mailbox":money(prices.additional_mailbox)+" each",
 "RATE.NewDell":money(prices.dell_deployment)+" each"};
 return {fields,flags:{"IF.NewDell":!!dell,"IF.DataMigration":false,"IF.Hardware":!!owner.hardwareText,
 "IF.Locations":!!owner.locationText,"IF.Regulated":!!owner.regulatedText},
 repeats:{"REPEAT.Deliverable":(owner.deliverables||[]).map(t=>({"Deliverable.Text":t})),
 "REPEAT.Exclusion":(owner.exclusions||[]).map(t=>({"Exclusion.Text":t})),
 "REPEAT.PricedLine":[]},rates};
}
