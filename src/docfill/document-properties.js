import JSZip from 'jszip';
import { DOMParser,XMLSerializer } from '@xmldom/xmldom';
import { posix } from 'node:path';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DS='http://schemas.openxmlformats.org/officeDocument/2006/customXml';
const DC='http://purl.org/dc/elements/1.1/';
const parse=xml=>new DOMParser().parseFromString(xml.replace(/^\uFEFF/,''),'text/xml');
const serialize=doc=>new XMLSerializer().serializeToString(doc);
const relationships=doc=>Array.from(doc.documentElement.childNodes).filter(n=>n.nodeType===1&&n.localName==='Relationship');
const relPath=name=>posix.join(posix.dirname(name),'_rels',posix.basename(name)+'.rels');
const target=(source,rel)=>posix.normalize(rel.getAttribute('Target').startsWith('/')?rel.getAttribute('Target').slice(1):posix.join(posix.dirname(source),rel.getAttribute('Target')));
const storeId=value=>String(value).replace(/[{}]/g,'').toLowerCase();

// SharePoint promotes these embedded master properties back to list columns on PUT.
// Keep bound data stores intact, including their supporting properties/relationships.
export async function cleanDocumentProperties(buffer,title){
  const zip=await JSZip.loadAsync(buffer),docs=new Map(),bound=new Set();
  for(const name of Object.keys(zip.files).filter(n=>n.endsWith('.xml')&&!zip.files[n].dir)){
    const doc=parse(await zip.file(name).async('string'));docs.set(name,doc);
    for(const binding of Array.from(doc.getElementsByTagNameNS(W,'dataBinding')))bound.add(storeId(binding.getAttributeNS(W,'storeItemID')));
  }
  const candidates=[...docs].filter(([name,doc])=>name.startsWith('customXml/')&&(
    doc.documentElement.localName==='properties'&&doc.documentElement.namespaceURI==='http://schemas.microsoft.com/office/2006/metadata/properties'||
    doc.documentElement.localName==='contentTypeSchema'&&doc.documentElement.namespaceURI==='http://schemas.microsoft.com/office/2006/metadata/contentType'
  ));
  const removed=new Set(),skipped=[];
  const propsFor=async name=>{
    const file=zip.file(relPath(name));if(!file)return [];
    return relationships(parse(await file.async('string'))).filter(r=>r.getAttribute('Type').endsWith('/customXmlProps')&&r.getAttribute('TargetMode')!=='External').map(r=>target(name,r));
  };
  for(const [name] of candidates){
    const props=await propsFor(name);
    if(props.some(p=>bound.has(storeId(docs.get(p)?.documentElement.getAttributeNS(DS,'itemID'))))){skipped.push(name);continue;}
    removed.add(name);
  }
  const keptProps=new Set();
  for(const name of docs.keys())if(name.startsWith('customXml/')&&!removed.has(name))for(const p of await propsFor(name))keptProps.add(p);
  for(const name of [...removed])for(const p of await propsFor(name))if(!keptProps.has(p))removed.add(p);
  for(const name of [...removed])removed.add(relPath(name));
  for(const name of Object.keys(zip.files).filter(n=>n.endsWith('.rels')&&!removed.has(n))){
    const doc=parse(await zip.file(name).async('string'));
    const source=name==='_rels/.rels'?'':name.replace(/(^|\/)\_rels\//,'$1').replace(/\.rels$/,'');
    let changed=false;
    for(const rel of relationships(doc))if(rel.getAttribute('TargetMode')!=='External'&&removed.has(target(source,rel))){rel.parentNode.removeChild(rel);changed=true;}
    if(changed)zip.file(name,serialize(doc));
  }
  for(const name of removed)zip.remove(name);
  const types=docs.get('[Content_Types].xml');
  if(types){for(const node of Array.from(types.documentElement.childNodes))if(node.nodeType===1&&node.localName==='Override'&&removed.has(node.getAttribute('PartName').replace(/^\//,'')))node.parentNode.removeChild(node);zip.file('[Content_Types].xml',serialize(types));}
  let core=docs.get('docProps/core.xml');
  if(!core){
    core=parse('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>');
    if(!types)throw new Error('Quote DOCX is missing its content types.');
    const entry=types.createElementNS(types.documentElement.namespaceURI,'Override');entry.setAttribute('PartName','/docProps/core.xml');entry.setAttribute('ContentType','application/vnd.openxmlformats-package.core-properties+xml');types.documentElement.appendChild(entry);zip.file('[Content_Types].xml',serialize(types));
    const rels=zip.file('_rels/.rels')?parse(await zip.file('_rels/.rels').async('string')):parse('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    const rel=rels.createElementNS(rels.documentElement.namespaceURI,'Relationship');
    let id='tigCore';while(relationships(rels).some(r=>r.getAttribute('Id')===id))id+='1';
    rel.setAttribute('Id',id);rel.setAttribute('Type','http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties');rel.setAttribute('Target','docProps/core.xml');rels.documentElement.appendChild(rel);zip.file('_rels/.rels',serialize(rels));
  }
  const titles=Array.from(core.getElementsByTagNameNS(DC,'title'));
  const titleNode=titles[0]||core.createElementNS(DC,'dc:title');
  if(!titles.length)core.documentElement.appendChild(titleNode);
  titleNode.textContent=title??'';
  for(const extra of titles.slice(1))extra.parentNode.removeChild(extra);
  zip.file('docProps/core.xml',serialize(core));
  return {buffer:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),skipped};
}
