import {msalClient} from './auth.js';
export class Graph {
 async request(path,method='GET',body){const token=await msalClient().acquireTokenByClientCredential({scopes:['https://graph.microsoft.com/.default']});const response=await fetch('https://graph.microsoft.com/v1.0'+path,{method,headers:{Authorization:`Bearer ${token.accessToken}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`Microsoft Graph returned HTTP ${response.status}.`);return response.status===204||response.headers.get('content-length')==='0'?null:response.json();}
 async read(path){return this.request(path);}
 async all(path){const rows=[];while(path){const data=await this.read(path);rows.push(...(data.value||[]));const next=data['@odata.nextLink'];if(next&&!next.startsWith('https://graph.microsoft.com/v1.0/'))throw new Error('Unexpected Graph pagination URL.');path=next?next.slice('https://graph.microsoft.com/v1.0'.length):null;}return rows;}
 async createWorkflowRequest(siteId,listId,fields){return this.request(`/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/items`,'POST',{fields});}
 async sendMail(message){return this.request('/users/josh%40theitguys.us/sendMail','POST',message);}
}
export const graph=new Graph();
export async function writeMail(adapter,mode,message){if(mode!=='live')return {status:'would email'};await adapter.sendMail(message);return {status:'Sent'};}
