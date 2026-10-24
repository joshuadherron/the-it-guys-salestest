import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { quoteDocumentSamples } from "../scripts/lib/quote-document-samples.js";
import { assertTagset } from "../src/docfill/tagsets.js";
import { listTags, fillDocx } from "../src/docfill/fill-docx.js";

for (const sample of quoteDocumentSamples()) {
  test(`${sample.key} original master has the approved tag set and fills a valid DOCX`, async () => {
    const master = await readFile(new URL("./fixtures/" + sample.name, import.meta.url));
    const provenance = JSON.parse(await readFile(new URL("./fixtures/quote-masters.json", import.meta.url), "utf8"));
    assert.equal(createHash("sha256").update(master).digest("hex"), provenance.masters[sample.name].sha256, "Preserve the original approved binary master");
    const tags = await listTags(master);
    assert.equal(tags.length, sample.key === "COM-PRP" ? 62 : 74);
    assertTagset(sample.key, tags);
    const { buffer, report } = await fillDocx(master, sample.data);
    assert.deepEqual(report.unfilled, []);
    assert.deepEqual(await listTags(buffer), []);
    const original = await JSZip.loadAsync(master);
    const filled = await JSZip.loadAsync(buffer, { checkCRC32: true });
    for (const [name, part] of Object.entries(filled.files)) {
      if (part.dir) continue;
      const content = await part.async("nodebuffer");
      if (name.endsWith(".xml") || name.endsWith(".rels")) {
        const doc = new DOMParser().parseFromString(content.toString("utf8").replace(/^\uFEFF/, ""), "text/xml");
        assert.ok(doc.documentElement, name);
        assert.equal(doc.getElementsByTagName("parsererror").length, 0, name);
      }
      if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name))
        assert.deepEqual(content, await original.file(name).async("nodebuffer"), `Preserve non-content part ${name}`);
    }
    const doc = new DOMParser().parseFromString(await filled.file("word/document.xml").async("string"), "text/xml");
    const text = Array.from(doc.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "t")).map(n => n.textContent).join(" ");
    assert.ok(text.includes("Example Services LLC"));
    assert.ok(text.includes(sample.key === "COM-PRP" ? "$590" : "$4,790"));
    // Master bytes are never modified by the filler.
    assert.equal(createHash("sha256").update(master).digest("hex"), createHash("sha256").update(await readFile(new URL("./fixtures/" + sample.name, import.meta.url))).digest("hex"));
  });
  test(`${sample.key} rejects configuration that changes an approved master rate`, async () => {
    const master = await readFile(new URL("./fixtures/" + sample.name, import.meta.url));
    const data = structuredClone(sample.data);
    data.rates["RATE.User"] = "$1";
    await assert.rejects(() => fillDocx(master, data), /template rate RATE.User/);
  });
}
