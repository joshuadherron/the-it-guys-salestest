export const PSA_KEY='BII-PSA';
export const PSA_MISSING=`Add the PSA row to Client Workflow Definitions (BII lane, Create Client Copy = Yes). Expected Document Key: ${PSA_KEY}; Project Services Agreement, Active = Yes.`;
export function psaDefinition(definitions){
  const matches=definitions.filter(d=>d.lane==='Business IT Integration'&&d.active&&d.createCopy&&(d.documentKey===PSA_KEY||/\bPSA\b|Project Services Agreement/i.test(d.document||'')));
  if(matches.length>1)throw new Error('Multiple active PSA definitions exist. Josh must reconcile the BII-PSA definition.');
  return matches[0];
}
export const psaItems=(items,definition)=>items.filter(i=>i.workflowId===definition?.id||i.documentKey===PSA_KEY);
export const signedPsa=items=>items.some(i=>i.signatureStatus==='Signed'||i.signedAt);
