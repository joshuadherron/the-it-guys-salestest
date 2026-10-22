import { priceProject } from "../project-pricing.js";
const money=value=>"$"+Number(value||0).toFixed(2);
export function buildProjectFill({quote,prospect}) {
  const input=quote.inputs,calc=priceProject(input);
  if(calc.pending.length)throw new Error(calc.pending.join(" "));
  return {fields:{
    "ENG.BusinessName":prospect.business_name,"ENG.Contact":prospect.contact_name||prospect.email||"",
    "ENG.QuoteId":quote.quote_number||String(quote.id),"ENG.IssueDate":new Date(quote.approved_at).toISOString().slice(0,10),
    "ENG.EngagementType":input.pricingMode==="hourly_v1"?"Hourly / Break-Fix — time and materials estimate":"One-Time Project — "+input.basis,
    "ENG.Scope":input.scope,"ENG.Exclusions":input.exclusions||"","ENG.Assumptions":input.assumptions||"","ENG.Terms":input.terms,
    "ENG.OneTimeTotal":money(calc.oneTimeTotal),"ENG.MonthlyTotal":money(calc.monthlyTotal),"ENG.EstimatedHours":String(input.estimatedHours||0),"ENG.HourlyRate":money(input.hourlyRate),"ENG.MinimumHours":String(input.minimumHours||0),
  },repeats:{"REPEAT.Line":calc.lines.map(l=>({"Line.Description":l.label,"Line.Kind":l.kind,"Line.Quantity":String(l.quantity),"Line.UnitPrice":money(l.unitPrice),"Line.Amount":money(l.amount),"Line.Billing":l.billing==="monthly"?"Monthly (explicit scope only)":"One-time"}))},flags:{},rates:{}};
}
