import { msalClient } from "./auth.js";
import { ConfidentialClientApplication } from "@azure/msal-node";
export class Graph {
  constructor({fetchImpl = globalThis.fetch, token} = {}) {
    this.fetch = fetchImpl;
    this.token = token || (async () => (await msalClient().acquireTokenByClientCredential({scopes:["https://graph.microsoft.com/.default"]})).accessToken);
  }
  async quoteBinary(path) {
    const token = await this.token();
    let response = await this.fetch("https://graph.microsoft.com/v1.0" + path, {headers:{Authorization:`Bearer ${token}`},redirect:"manual",signal:AbortSignal.timeout(30000)});
    if ([301,302,303,307,308].includes(response.status)) {
      const url = new URL(response.headers.get("location"));
      if(url.protocol!=="https:"||url.username||url.password)throw new Error("Invalid Graph download redirect.");
      response = await this.fetch(url.href,{signal:AbortSignal.timeout(30000)});
    }
    if(!response.ok)throw Object.assign(new Error(`Quote download failed (HTTP ${response.status}).`),{status:response.status});
    const buffer=Buffer.from(await response.arrayBuffer());
    if(!buffer.length||buffer.length>3*1000*1000)throw new Error("Quote file must be nonempty and no larger than 3 MB.");
    return buffer;
  }
  async quoteContent(driveId,itemId,pdf=false) {
    return this.quoteBinary(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content${pdf?"?format=pdf":""}`);
  }
  async createSentQuotePdf(driveId,folderId,name,buffer) {
    if(!name.endsWith(".pdf")||/[\\/:]/.test(name)||!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>3*1000*1000)throw new Error("Invalid sent quote PDF.");
    const session=await this.request(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}:/createUploadSession`,"POST",{item:{name,"@microsoft.graph.conflictBehavior":"fail"}});
    const url=new URL(session.uploadUrl);
    if(url.protocol!=="https:"||url.username||url.password)throw new Error("Invalid upload session URL.");
    const response=await this.fetch(url.href,{method:"PUT",headers:{"Content-Length":String(buffer.length),"Content-Range":`bytes 0-${buffer.length-1}/${buffer.length}`,"Content-Type":"application/pdf"},body:buffer,signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Object.assign(new Error(`Sent PDF creation failed (HTTP ${response.status}); nothing was emailed.`),{status:response.status});
    const item=await response.json();
    if(!item.id)throw new Error("PDF upload result is missing its item ID.");
    return item;
  }
  async sendQuoteMail(mailbox,message,correlationId) {
    const {senderMailbox}=await import("./docfill/send-policy.js");
    senderMailbox({QUOTE_SENDER_MAILBOX:mailbox});
    const token=await this.token();
    const response=await this.fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","client-request-id":correlationId,"return-client-request-id":"true"},body:JSON.stringify(message),signal:AbortSignal.timeout(30000)});
    if(response.status!==202)throw Object.assign(new Error(`Shared mailbox send refused (HTTP ${response.status}). Check Mail.Send and the Exchange application access policy. No further send was attempted.`),{status:response.status});
    return {messageId:null,requestId:response.headers.get("request-id"),correlationId};
  }

  async request(path, method = "GET", body, headers = {}) {
    const token = await msalClient().acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });
    const response = await fetch("https://graph.microsoft.com/v1.0" + path, {
      method,
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Object.assign(
        new Error(`Microsoft Graph returned HTTP ${response.status}.`),
        { status: response.status },
      );
    const content = await response.text();
    return content ? JSON.parse(content) : null;
  }
  async read(path, headers) {
    return this.request(path, "GET", undefined, headers);
  }
  async all(path, headers) {
    const rows = [];
    while (path) {
      const data = await this.read(path, headers);
      rows.push(...(data.value || []));
      const next = data["@odata.nextLink"];
      if (next && !next.startsWith("https://graph.microsoft.com/v1.0/"))
        throw new Error("Unexpected Graph pagination URL.");
      path = next
        ? next.slice("https://graph.microsoft.com/v1.0".length)
        : null;
    }
    return rows;
  }
  async createWorkflowRequest(siteId, listId, fields) {
    return this.request(
      `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/items`,
      "POST",
      { fields },
    );
  }
  async updateListItemFields(siteId, listId, itemId, fields) {
    return this.request(
      `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}/fields`,
      "PATCH",
      fields,
    );
  }
  // The only permitted direct SharePoint file write: replace an approved quote's
  // existing working-copy content. Caller must validate quote, master and item.
  async replaceQuoteWorkingCopy(driveId, itemId, etag, buffer) {
    if (!driveId || !itemId || !etag || !Buffer.isBuffer(buffer) || !buffer.length)
      throw new Error("Quote replacement requires a resolved drive, item, eTag and nonempty DOCX.");
    const accessToken = await this.token();
    const path = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`;
    const response = await this.fetch("https://graph.microsoft.com/v1.0" + path, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "If-Match": etag,
      },
      body: buffer,
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 412)
      throw Object.assign(new Error("The working quote changed in SharePoint. Reload before trying again."), { status: 409 });
    if (!response.ok)
      throw Object.assign(new Error(`Microsoft Graph returned HTTP ${response.status}.`), { status: response.status });
    return response.json();
  }
  async sendMail(message) {
    const { SALES_MAIL_TENANT_ID: tenantId, SALES_MAIL_CLIENT_ID: clientId, SALES_MAIL_CLIENT_SECRET: clientSecret } = process.env;
    if (!tenantId || !clientId || !clientSecret)
      throw new Error("Sales notification mail credentials are not configured.");
    const client = new ConfidentialClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        clientSecret,
      },
    });
    const token = await client.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });
    if (!token?.accessToken) throw new Error("Sales notification mail token unavailable.");
    const response = await this.fetch(
      "https://graph.microsoft.com/v1.0/users/website%40theitguys.us/sendMail",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (response.status !== 202)
      throw Object.assign(new Error(`Sales notification send failed (HTTP ${response.status}).`), { status: response.status });
  }
}
export const graph = new Graph();
export async function writeMail(adapter, mode, message) {
  if (mode !== "live") return { status: "would email" };
  await adapter.sendMail(message);
  return { status: "Sent" };
}
