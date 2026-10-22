import { text } from "./security.js";
// Reuse the existing discovery/revision tables. Legacy endpoints are guarded by
// opportunity type, so their detailed questionnaire and historical rows stay intact.
export const intakeSelect="SELECT d.*, (d.status='Ready for Review') AS complete, (SELECT v.actor FROM discovery_versions v WHERE v.prospect_id=d.prospect_id AND v.revision=d.revision LIMIT 1) AS updated_by FROM discoveries d WHERE d.prospect_id=?";
export const intakeFields=[
  ["contact","Contact / decision maker"],["issue","Problem or issue"],["scope","Work description / scope"],
  ["deliverables","Deliverables"],["dependencies","Dependencies / access / prerequisites"],
  ["schedule","Requested schedule"],["authorization","Who can authorize this work?"],
  ["access","Location / remote-access needs"],["rate_authorization","Rate / time-and-materials authorization requirements"],
];
export const riskFields=[["urgent_security","Urgent security concern"],["access_risk","Missing or disputed admin access"],["regulated_data","Regulated or sensitive data"],["backup_risk","Backup or data-loss concern"]];
export function validateIntake(body) {
  return {...Object.fromEntries(intakeFields.map(([key])=>[key,text(body[key]||"",4000)])),...Object.fromEntries(riskFields.map(([key])=>[key,body[key]===true||body[key]==="yes"]))};
}
export function missingIntake(type,answers={},p={}) {
  const keys=type==="hourly"?["contact","issue","scope","access","rate_authorization"]:["contact","issue","scope","deliverables","dependencies","schedule","authorization"];
  return [...(!p.business_name?[{key:"business_name",label:"Business name",href:`/prospects/${p.id}/edit`}]:[]),...keys.filter(k=>!String(answers[k]||"").trim()).map(key=>({key,label:intakeFields.find(([k])=>k===key)[1],href:`/prospects/${p.id}/intake#intake-${key}`}))];
}
export const intakeFlags = answers => riskFields.filter(([key])=>answers[key]===true).map(([key,label])=>({code:key,label,urgent:key==="urgent_security"}));
