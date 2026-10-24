import { text,integer,choice,date,fail } from "./security.js";

export const waveBases=["department","location","department and location"];
export const optionalAssessmentHint="A free read-only assessment is available before quoting (BT-7.32).";
export const regulatedDataText="The Regulated Data Package adds secure (encrypted) email for outside recipients, an automatic screen lock after 15 minutes, a block on USB storage drives, retention and audit logging, and a HIPAA safeguards map in the Business Technology Record. A Business Associate Agreement is put in place before any access to patient information. These controls support the Client's HIPAA safeguards; they are not a compliance certification.";
const checked=value=>value===true||value==="yes";
export function biiOptions(body){
  const waveCount=body.waveCount===undefined||body.waveCount===null||body.waveCount===""?null:integer(body.waveCount,Number.MAX_SAFE_INTEGER-12);
  if(waveCount!==null&&waveCount<1)fail("Wave count must be a whole number of at least 1.");
  return {
    regulatedPackage:checked(body.regulatedPackage),operatingBusiness:checked(body.operatingBusiness),
    pilotGroup:text(body.pilotGroup||"",4000),waveCount,
    waveBasis:body.waveBasis?choice(body.waveBasis,waveBases):"",
    waveDates:text(body.waveDates||"",4000),
    afterHoursWindows:body.afterHoursWindows===undefined?"none":text(body.afterHoursWindows,4000),
    assessed:checked(body.assessed),assessmentDate:date(body.assessmentDate),
  };
}
export function biiPlanLength(input){
  return Number.isSafeInteger(input.waveCount)&&input.waveCount>=1&&input.waveCount<=Number.MAX_SAFE_INTEGER-12?12+input.waveCount:null;
}
export function biiApprovalMissing(input){
  const missing=[];
  if(input.operatingBusiness){
    for(const [key,label] of [["pilotGroup","Pilot group"],["waveDates","Wave dates"],["afterHoursWindows","After-hours windows (or none)"]])if(!String(input[key]||"").trim())missing.push(label);
    if(biiPlanLength(input)===null)missing.push("Wave count (at least 1)");
    if(!waveBases.includes(input.waveBasis))missing.push("Wave basis (department, location, or department and location)");
  }
  if(input.assessed&&!input.assessmentDate)missing.push("Assessment date");
  return missing;
}
export function assertBiiApprovalInputs(input){
  const missing=biiApprovalMissing(input);
  if(missing.length)fail("Complete these BII quote fields before approval: "+missing.join("; "));
}
