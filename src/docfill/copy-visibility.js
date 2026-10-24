export const COPY_TIMEOUT_MESSAGE='SharePoint created the copy but its Instance Reference is still empty after 10 minutes. Check the Create Working Copy flow writes TIG_InstanceRef.';
export const missingCopy=()=>Object.assign(new Error('Expected exactly one open quote working copy for this client.'),{code:'QUOTE_COPY_NOT_VISIBLE',status:409});
export function utcTime(value){
  if(value instanceof Date)return value.getTime();
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2} /.test(value))value=value.replace(' ','T')+'Z';
  return new Date(value).getTime();
}
