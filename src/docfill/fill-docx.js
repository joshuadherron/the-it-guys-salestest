import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const {DOMParser,XMLSerializer}=require("@xmldom/xmldom");
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
// XML parts may carry a UTF-8 BOM. Normalize it only for parsing; never edit the master.
const parsePart = xml => new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ""), "text/xml");
const PARTS=/^word\/(document|header\d*|footer\d*)\.xml$/;
export class FillError extends Error {}
const kids=(el,local)=>Array.from(el?.childNodes||[]).filter(n=>n.nodeType===1&&n.namespaceURI===W&&(!local||n.localName===local));
const child=(el,local)=>kids(el,local)[0]||null;
const all=(el,local)=>Array.from(el.getElementsByTagNameNS(W,local));
const tagOf=s=>child(child(s,"sdtPr"),"tag")?.getAttributeNS(W,"val")||"";
const textOf=el=>all(el,"t").map(t=>t.textContent).join("");
const inline=s=>s.parentNode?.localName==="p";
function unwrap(s){const p=s.parentNode,c=child(s,"sdtContent");for(const n of Array.from(c.childNodes))p.insertBefore(n,s);p.removeChild(s)}
function drop(p){if(!p||p.localName!=="p"||!p.parentNode||textOf(p).trim())return;if(p.parentNode.localName==="tc"&&kids(p.parentNode,"p").length===1)return;if(p.parentNode.localName!=="sdtContent")p.parentNode.removeChild(p)}
function setInline(doc,s,value){const c=child(s,"sdtContent"),p=s.parentNode;if(value===""){p.removeChild(s);drop(p);return}const r=doc.createElementNS(W,"w:r"),rpr=child(child(c,"r"),"rPr");if(rpr)r.appendChild(rpr.cloneNode(true));const t=doc.createElementNS(W,"w:t");t.setAttribute("xml:space","preserve");t.appendChild(doc.createTextNode(String(value)));r.appendChild(t);p.insertBefore(r,s);p.removeChild(s)}
function processPart(doc,data,report){const sdts=()=>all(doc.documentElement,"sdt");
for(const s of sdts().filter(x=>tagOf(x).startsWith("REPEAT."))){if(!s.parentNode)continue;const tag=tagOf(s),items=data.repeats?.[tag]||[],c=child(s,"sdtContent");for(const item of items){for(const n of Array.from(c.childNodes)){const clone=n.cloneNode(true);if(clone.nodeType===1){for(const inner of all(clone,"sdt").filter(inline)){const key=tagOf(inner);if(Object.hasOwn(item,key)){setInline(doc,inner,item[key]);report.filled.push(tag+"[] "+key)}}}s.parentNode.insertBefore(clone,s)}}report[items.length?"repeated":"removed"].push(tag+" x"+items.length);s.parentNode.removeChild(s)}
for(const s of sdts().filter(x=>tagOf(x).startsWith("IF."))){if(!s.parentNode)continue;const tag=tagOf(s);if(!Object.hasOwn(data.flags||{},tag))throw new FillError("missing flag "+tag);if(data.flags[tag]){unwrap(s);report.kept.push(tag)}else{s.parentNode.removeChild(s);report.removed.push(tag)}}
for(const s of sdts().filter(inline)){if(!s.parentNode)continue;const tag=tagOf(s);if(tag==="NOTE"){const p=s.parentNode;p.removeChild(s);drop(p);continue}if(tag.startsWith("RATE.")){const want=data.rates?.[tag],have=textOf(s);if(want===undefined)throw new FillError("no expected value for "+tag);if(want!==have)throw new FillError("template rate "+tag+" is "+JSON.stringify(have)+" but config says "+JSON.stringify(want));unwrap(s);continue}const v=data.fields?.[tag];if(v===undefined){report.unfilled.push(tag);continue}setInline(doc,s,v);report.filled.push(tag)}}
// The COM-PRP master prints ClientShortName ("ClientLegalName") in one cell.
// When both names are identical, collapse the duplicate without altering the master.
function collapseDuplicateClientName(doc,data){
 const short=data.fields?.["MIT.ClientShortName"];
 const legal=data.fields?.["MIT.ClientLegalName"];
 if(!short||!legal||short.trim()!==legal.trim())return;
 const duplicated=short+' ("'+legal+'")';
 for(const cell of all(doc.documentElement,"tc")){
  if(textOf(cell)!==duplicated)continue;
  const nodes=all(cell,"t");
  if(!nodes.length)continue;
  nodes[0].textContent=legal;
  for(const node of nodes.slice(1))node.textContent="";
 }
}
export async function listTags(buffer){const zip=await JSZip.loadAsync(buffer),tags=new Set();for(const name of Object.keys(zip.files).filter(n=>PARTS.test(n))){const doc=parsePart(await zip.file(name).async("string"));for(const s of all(doc.documentElement,"sdt"))tags.add(tagOf(s))}return [...tags].sort()}
export async function fillDocx(buffer,data){const zip=await JSZip.loadAsync(buffer),report={filled:[],unfilled:[],kept:[],removed:[],repeated:[]};for(const name of Object.keys(zip.files).filter(n=>PARTS.test(n))){const doc=parsePart(await zip.file(name).async("string"));processPart(doc,data,report);if(name==="word/document.xml")collapseDuplicateClientName(doc,data);zip.file(name,new XMLSerializer().serializeToString(doc))}report.unfilled=[...new Set(report.unfilled)];return {buffer:await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"}),report}}
