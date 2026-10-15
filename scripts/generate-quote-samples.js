import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { quoteDocumentSamples } from "./lib/quote-document-samples.js";
import { assertTagset } from "../src/docfill/tagsets.js";
import { listTags, fillDocx } from "../src/docfill/fill-docx.js";

// Standalone dryrun: no .env, database, Graph transport or live delivery imports.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] || join(root, ".tmp", "quote-docx-samples"));
await mkdir(output, { recursive: true });
for (const sample of quoteDocumentSamples()) {
  const master = await readFile(join(root, "test", "fixtures", sample.name));
  assertTagset(sample.key, await listTags(master));
  const { buffer, report } = await fillDocx(master, sample.data);
  if (report.unfilled.length || (await listTags(buffer)).length)
    throw new Error("Sample still contains unresolved content controls: " + sample.key);
  const name = `${sample.key}-SAMPLE-DRAFT.docx`;
  await writeFile(join(output, name), buffer);
  await writeFile(join(output, sample.key + "-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`${name}: ${buffer.length} bytes; zero unfilled controls; approved total $${sample.quote.total}`);
}
