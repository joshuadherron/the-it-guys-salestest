import { fail,text } from "./security.js";
export const projectModes=["project_v1","hourly_v1"];
function number(value,label,places=2,max=10000000) {
  const raw=String(value??"");
  if(!new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(raw)||!Number.isFinite(Number(raw))||Number(raw)>max)fail(`Enter a valid nonnegative ${label}.`);
  return Number(raw);
}
export function validateProjectQuote(body,type,config={}) {
  const mode=type==="hourly"?"hourly_v1":"project_v1";
  let inputLines=body.lines;
  if(inputLines===undefined) {
    const array=value=>value===undefined?[]:Array.isArray(value)?value:[value];
    const labels=array(body.line_label);
    inputLines=labels.map((label,i)=>({label,kind:array(body.line_kind)[i],quantity:array(body.line_quantity)[i],unitPrice:array(body.line_unitPrice)[i],billing:array(body.line_billing)[i]}));
  }
  if(typeof inputLines==="string")try{inputLines=JSON.parse(inputLines);}catch{fail("Quote lines must be valid JSON.");}
  if(!Array.isArray(inputLines)||inputLines.length>100)fail("Use no more than 100 itemized quote lines.");
  const lines=inputLines.filter(l=>l&&String(l.label||"").trim()).map(l=>({
    label:text(l.label,1000),kind:["labor","materials","equipment","deliverable","other"].includes(l.kind)?l.kind:"other",
    quantity:number(l.quantity,"quantity",3,1000000),unitPrice:number(l.unitPrice,"unit price"),
    billing:l.billing==="monthly"?"monthly":"one_time",
  }));
  if(lines.some(l=>l.quantity<=0))fail("Each line needs a quantity greater than zero.");
  const minimumHours=number(config.minimum_hours??0,"configured minimum hours",2,999999.99);
  const result={pricingMode:mode,basis:body.basis==="fixed"?"fixed":"estimate",scope:text(body.scope||"",10000),exclusions:text(body.exclusions||"",10000),assumptions:text(body.assumptions||"",10000),terms:text(body.terms||"",10000),lines,minimumHours};
  if(mode==="hourly_v1") {
    result.estimatedHours=number(body.estimatedHours,"estimated hours",2,1000000);
    result.hourlyRate=number(body.hourlyRate??config.hourly_rate,"hourly rate");
    if(!result.estimatedHours||!result.hourlyRate)fail("Hourly estimates need estimated hours and an hourly rate greater than zero.");
    result.basis="estimate";
  }
  if(!lines.length&&mode!=="hourly_v1")fail("Add labor, materials or at least one fixed-price deliverable.");
  if(lines.some(l=>l.billing==="monthly")&&body.confirm_recurring!=="yes")fail("Explicitly confirm the optional recurring charges.");
  return result;
}
export function priceProject(input) {
  if(!projectModes.includes(input?.pricingMode))fail("Unsupported project pricing mode.");
  if(!Array.isArray(input.lines)||input.lines.length>100)fail("Invalid saved quote lines.");
  const lines=input.lines.map(l=>{
    if(!l||!text(l.label||"",1000)||!["labor","materials","equipment","deliverable","other"].includes(l.kind)||!["one_time","monthly"].includes(l.billing))fail("Invalid saved quote line.");
    const quantity=number(l.quantity,"quantity",3,1000000),unitPrice=number(l.unitPrice,"unit price");
    if(!quantity)fail("Each quote line requires positive quantity.");
    return {...l,quantity,unitPrice,amount:Math.round(quantity*unitPrice*100)/100};
  });
  if(!lines.length&&input.pricingMode==="project_v1")fail("Add at least one project line.");
  if(input.pricingMode==="hourly_v1") {
    const hours=number(input.estimatedHours,"estimated hours",2,1000000),rate=number(input.hourlyRate,"hourly rate"),minimum=number(input.minimumHours||0,"minimum hours",2,999999.99);
    if(!hours||!rate)fail("Hourly estimates require positive hours and rates.");
    const quantity=Math.max(hours,minimum);
    lines.unshift({label:"Estimated labor (time and materials)",kind:"labor",quantity,unitPrice:input.hourlyRate,billing:"one_time",amount:Math.round(quantity*input.hourlyRate*100)/100});
  }
  const cents=lines.reduce((sum,l)=>sum+Math.round(l.amount*100),0);
  if(!Number.isSafeInteger(cents)||cents<0||cents>9999999999)fail("Quote total is outside the supported range.");
  return {lines,total:cents/100,oneTimeTotal:lines.filter(l=>l.billing!=="monthly").reduce((s,l)=>s+Math.round(l.amount*100),0)/100,monthlyTotal:lines.filter(l=>l.billing==="monthly").reduce((s,l)=>s+Math.round(l.amount*100),0)/100,pending:[...(!input.scope?["Define the work scope."]:[]),...(!input.terms?["Enter estimate / authorization terms for owner review."]:[])]};
}
