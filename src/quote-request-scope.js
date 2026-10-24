// Local request_json stores runtime-resolved SharePoint field names. Inspect only
// JSON payload values, never assume the Payload column's internal name.
export function requestMatchesQuote(raw,p,quoteId,itemId){
  try{
    const request=typeof raw==="string"?JSON.parse(raw):raw;
    return Object.values(request?.fields||{}).some(value=>{
      if(typeof value!=="string"||!value.trim().startsWith("{"))return false;
      try{const body=JSON.parse(value);return (itemId&&String(body.itemId)===String(itemId))||!!String(p.client_id||"").trim()&&body.clientId===p.client_id&&String(body.instanceRef)===String(quoteId);}catch{return false;}
    });
  }catch{return false;}
}
