import { mitFields } from "./managed-reference.js";
import { managedReferenceFacts } from "./managed-facts.js";
import {priceManagedServices,priceQuote,platforms} from "../pricing.js";
const money=n=>"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:Number(n)%1?2:0,maximumFractionDigits:2});
const count=(o,k)=>Number(o[k]||0);
const required=(obj,key)=>{const v=obj?.[key];if(v===undefined||v===null||v==="")throw new Error("Missing owner-entered document field: "+key);return String(v)};
const formatDate=d=>new Date(d).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"});
export function buildManagedFill({quote,prospect,owner={}}){
 const input=quote.inputs,calc=priceManagedServices(input);
 if(input.pricingMode!=="managed_v20"||input.serviceTier!=="managed"||!input.users)throw new Error("Managed IT document requires a Managed IT quote with users.");
 if(calc.pending.length)throw new Error("Pricing review required: "+calc.pending.join("; "));
 if(!Array.isArray(quote.line_items))throw new Error("Approved quote line items are required.");
 const monthly=quote.line_items.filter(x=>x.billing!=="one_time").reduce((sum,l)=>sum+Number(l.amount),0);
 if(!Number.isFinite(monthly)||Math.abs(monthly-calc.total)>.005)throw new Error("Approved Managed IT monthly pricing does not match the current pricing engine.");
 if(input.includeBii && !quote.line_items.some(x=>x.billing==="one_time" && String(x.label).includes("BII Integration")))throw new Error("Combined quote is missing its separately approved BII foundation line.");
 if(count(input,"workstationBackups")||count(input,"serverBackups"))throw new Error("System backups require explicit per-system owner pricing before document generation.");
 const {facts,owner:clean,assigned}=managedReferenceFacts(quote,prospect,owner);
 const result=mitFields(facts);
 if(Math.abs(result.total-calc.total)>.005)throw new Error("Reference formatting disagrees with approved Managed IT pricing.");
 // Assigned and shared devices must never describe the same quantities.
 result.fields["MIT.DevicesSummary"]=assigned || (clean.noCompanyComputers ? "Users on shared devices only" : undefined);
 result.fields["MIT.AssignedDevices"]=assigned || (clean.noCompanyComputers ? "Users on shared devices only" : undefined);
 result.fields["MIT.DevicesCoveredNote"]=assigned ? "; your " + assigned + (Number(input.computers||0)+Number(input.assignedPhones||0)+Number(input.assignedTablets||0)===1?" is":" are") + " covered within that allowance" : "";
 if(clean.waiveOnboarding)result.fields["MIT.Onboarding"]="Waived";
 // Required facts stay unresolved when blank. The reference defaults must not hide missing facts.
 for(const [tag,value] of [["MIT.ClientShortName",facts.clientShortName],["MIT.ClientLegalName",facts.clientLegalName],["MIT.PreparedFor",facts.preparedFor],["MIT.BackupContact",facts.backupContact],["MIT.Locations",facts.locations],["MIT.Domain",facts.domain],["MIT.ServiceStart",facts.serviceStart],["MIT.SummaryText",facts.summaryText],["MIT.DeviceKinds",facts.deviceKinds]])
   if(value===undefined)delete result.fields[tag];
 if(!clean.onboardingMode)delete result.fields["MIT.OnboardingText"];
 if(clean.sizingMode==="other"&&!clean.sizingOther)delete result.fields["MIT.SizedFor"];
 return result;
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
