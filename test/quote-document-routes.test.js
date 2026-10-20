import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join,dirname} from "node:path";

const here=dirname(fileURLToPath(import.meta.url));
const root=join(here,"..");
const route=readFileSync(join(root,"src/docfill/routes.js"),"utf8");
const view=readFileSync(join(root,"views/quote-document.ejs"),"utf8");
const quotesView=readFileSync(join(root,"views/quotes.ejs"),"utf8");

test("contract document route requires quote.send and requires approved quote",()=>{
 assert.match(route,/app\.get\("\/quotes\/:id\/document",quoteSend/);
 assert.match(route,/app\.post\("\/quotes\/:id\/document",quoteSend/);
 assert.match(route,/q\.status!=="Approved"/);
 assert.match(route,/if\(p\.hold\)/);
});
test("contract document download cannot mutate SharePoint",()=>{
 assert.doesNotMatch(route,/replaceQuoteWorkingCopy|graph\.put|fetch\(/);
 assert.match(route,/attachment; filename/);
 assert.match(route,/no-store/);
});
test("owner form uses CSRF and explicit template lane",()=>{
 assert.match(view,/name="_csrf"/);
 assert.match(view,/name="lane"/);
 assert.match(view,/Download draft Word document/);
});
test("Quote History retains printable internal worksheet and offers contractual quote",()=>{
 assert.match(quotesView,/Printable internal worksheet/);
 assert.match(quotesView,/Save proposal to SharePoint/);
});
