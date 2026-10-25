import { createHash } from 'node:crypto';
import JSZip from 'jszip';

// Hash the uploaded XML bytes in stable part-name order. SharePoint properties
// and ZIP packaging can change without changing these document contents.
export async function quoteContentHash(buffer){
  const zip=await JSZip.loadAsync(buffer);
  if(!zip.file('word/document.xml'))throw new Error('Quote DOCX is missing word/document.xml.');
  const hash=createHash('sha256');
  const names=Object.keys(zip.files).filter(name=>!zip.files[name].dir&&/^word\/(?:document|header[^/]*|footer[^/]*)\.xml$/.test(name)).sort();
  for(const name of names)hash.update(await zip.file(name).async('nodebuffer'));
  return hash.digest('hex');
}
