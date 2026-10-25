import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { quoteContentHash } from '../src/docfill/content-hash.js';

test('body hash uses sorted document, header and footer XML bytes, ignoring properties and ZIP packaging',async()=>{
  const parts={'word/header2.xml':'header 2','word/document.xml':'body','word/footer1.xml':'footer','word/header1.xml':'header 1','customXml/item1.xml':'properties','docProps/core.xml':'title'};
  const zip=new JSZip();for(const [name,value] of Object.entries(parts))zip.file(name,value);
  const baseline=await quoteContentHash(await zip.generateAsync({type:'nodebuffer'}));
  assert.equal(baseline,createHash('sha256').update('bodyfooterheader 1header 2').digest('hex'));
  const rewritten=new JSZip();for(const [name,value] of Object.entries(parts).reverse())rewritten.file(name,name.startsWith('word/')?value:'SharePoint rewrote this');
  assert.equal(await quoteContentHash(await rewritten.generateAsync({type:'nodebuffer',compression:'DEFLATE'})),baseline);
  for(const name of ['word/document.xml','word/header1.xml','word/footer1.xml']){
    const changed=await JSZip.loadAsync(await zip.generateAsync({type:'nodebuffer'}));changed.file(name,'owner edited this');
    assert.notEqual(await quoteContentHash(await changed.generateAsync({type:'nodebuffer'})),baseline,name);
  }
});

test('missing document XML cannot produce a usable content hash',async()=>{
  const zip=new JSZip();zip.file('docProps/core.xml','metadata');
  const buffer=await zip.generateAsync({type:'nodebuffer'});
  await assert.rejects(()=>quoteContentHash(buffer),/missing word\/document.xml/);
});
