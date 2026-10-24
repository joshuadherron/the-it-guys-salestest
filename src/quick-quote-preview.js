export const money=value=>'$'+Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export function previewSections(input,lines){
  const visible=lines.filter(l=>Number(l.quantity)!==0&&Number(l.amount)!==0);
  if(input.pricingMode!=='managed_v20')return [{title:'Quote lines',lines:visible,total:visible.reduce((s,l)=>s+Number(l.amount),0)}];
  const monthly=visible.filter(l=>l.billing!=='one_time'),once=visible.filter(l=>l.billing==='one_time');
  if(Number(input.onboarding))once.unshift({label:'One-time onboarding',quantity:1,amount:Number(input.onboarding)});
  return [{title:'Monthly',lines:monthly,total:monthly.reduce((s,l)=>s+Number(l.amount),0)},{title:'One-time',lines:once,total:once.reduce((s,l)=>s+Number(l.amount),0)}];
}
export const biiFactFields=[['legalName','Client legal name'],['preparedFor','Prepared for'],['backupContact','Backup contact'],['location','Primary location'],['domain','Primary domain'],['targetTiming','Target timing'],['summary','Project summary'],['deviceTypes','Device types'],['exceptions','Exceptions'],['signer','Authorized signer name and title']];
export function missingProposalFacts(type,facts){
  const fields=type==='bii'?biiFactFields:type==='managed_it'?[['legalName','Client legal name'],['preparedName','Prepared for name'],['preparedTitle','Prepared for title'],['preparedEmail','Prepared for email'],['backupContact','Backup contact'],['domain','Email / Microsoft 365 domain'],['summary','Service summary']]:[];
  return fields.filter(([key])=>!String(facts?.[key]||'').trim()).map(([,label])=>label);
}
