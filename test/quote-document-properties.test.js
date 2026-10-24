import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { cleanDocumentProperties } from '../src/docfill/document-properties.js';
import { listTags } from '../src/docfill/fill-docx.js';

const DS='http://schemas.openxmlformats.org/officeDocument/2006/customXml';
const REL='http://schemas.openxmlformats.org/package/2006/relationships';
const parse=xml=>new DOMParser().parseFromString(xml,'text/xml');
async function fixture(bound=false){
  const zip=await JSZip.loadAsync(await readFile('test/fixtures/COM-PRP-v1.8.docx'));
  zip.file('customXml/item91.xml','<p:properties xmlns:p="http://schemas.microsoft.com/office/2006/metadata/properties"><p:Title/><p:TIG_ClientID/><p:TIG_WorkflowID/><p:TIG_InstanceRef/></p:properties>');
  zip.file('customXml/item92.xml','<ct:contentTypeSchema xmlns:ct="http://schemas.microsoft.com/office/2006/metadata/contentType"/>');
  zip.file('customXml/item93.xml','<other xmlns="urn:unrelated">Keep me</other>');
  for(const n of [91,92]){
    zip.file(`customXml/itemProps${n}.xml`,`<ds:datastoreItem xmlns:ds="${DS}" ds:itemID="{STORE-${n}}"/>`);
    zip.file(`customXml/_rels/item${n}.xml.rels`,`<Relationships xmlns="${REL}"><Relationship Id="props" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps${n}.xml"/></Relationships>`);
  }
  let rels=await zip.file('word/_rels/document.xml.rels').async('string');
  rels=rels.replace('</Relationships>',[91,92,93].map(n=>`<Relationship Id="fixture${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item${n}.xml"/>`).join('')+'</Relationships>');
  zip.file('word/_rels/document.xml.rels',rels);
  let types=await zip.file('[Content_Types].xml').async('string');
  types=types.replace('</Types>',[91,92].map(n=>`<Override PartName="/customXml/itemProps${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/><Override PartName="/customXml/item${n}.xml" ContentType="application/xml"/>`).join('')+'</Types>');
  zip.file('[Content_Types].xml',types);
  if(bound)zip.file('word/header99.xml','<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:sdt><w:sdtPr><w:dataBinding w:storeItemID="{store-91}" w:xpath="/p:properties/p:Title"/></w:sdtPr></w:sdt></w:hdr>');
  return zip.generateAsync({type:'nodebuffer'});
}

test('SharePoint property fixture strips properties, schema, itemProps, relationships and overrides, sets working Title and preserves quote tags',async()=>{
  const input=await fixture(),title='Client & Partners <Q-27>',cleaned=await cleanDocumentProperties(input,title),zip=await JSZip.loadAsync(cleaned.buffer);
  assert.deepEqual(cleaned.skipped,[]);
  for(const n of [91,92])for(const name of [`customXml/item${n}.xml`,`customXml/itemProps${n}.xml`,`customXml/_rels/item${n}.xml.rels`])assert.equal(zip.file(name),null,name);
  assert.match(await zip.file('customXml/item93.xml').async('string'),/Keep me/);
  assert.doesNotMatch(await zip.file('word/_rels/document.xml.rels').async('string'),/item9[12]\.xml/);
  assert.doesNotMatch(await zip.file('[Content_Types].xml').async('string'),/item(?:Props)?9[12]\.xml/);
  const core=parse(await zip.file('docProps/core.xml').async('string'));
  assert.equal(core.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/','title')[0].textContent,title);
  assert.deepEqual(await listTags(cleaned.buffer),await listTags(input));
  assert.ok((await JSZip.loadAsync(input)).file('customXml/item91.xml'),'master remains unchanged');
});

test('a dataBinding protects its property part and supporting package parts, including bindings in headers',async()=>{
  const cleaned=await cleanDocumentProperties(await fixture(true),'Working title'),zip=await JSZip.loadAsync(cleaned.buffer);
  assert.deepEqual(cleaned.skipped,['customXml/item91.xml']);
  for(const name of ['customXml/item91.xml','customXml/itemProps91.xml','customXml/_rels/item91.xml.rels'])assert.ok(zip.file(name));
  assert.match(await zip.file('word/_rels/document.xml.rels').async('string'),/item91\.xml/);
  assert.match(await zip.file('[Content_Types].xml').async('string'),/itemProps91\.xml/);
  assert.equal(zip.file('customXml/item92.xml'),null);
});

test('approved masters report any bound property parts that must be retained',async t=>{
  for(const name of ['COM-PRP-v1.8.docx','BII-QSOW-v1.7.docx','ENG-PRJ-v1.0.docx']){
    const input=await readFile('test/fixtures/'+name),cleaned=await cleanDocumentProperties(input,'Working Quote');
    t.diagnostic(name+': retained bound property parts = '+JSON.stringify(cleaned.skipped));
    assert.deepEqual(await listTags(cleaned.buffer),await listTags(input));
  }
});
