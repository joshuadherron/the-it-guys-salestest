import test from "node:test";
import assert from "node:assert/strict";
import {TAGSETS,assertTagset} from "../src/docfill/tagsets.js";
test("approved BII master tag set contains required rate and repeat tags",()=>{
 assert.ok(TAGSETS["BII-QSOW"].includes("RATE.Foundation"));
 assert.ok(TAGSETS["BII-QSOW"].includes("REPEAT.PricedLine"));
 assertTagset("BII-QSOW",TAGSETS["BII-QSOW"]);
});
test("approved Managed IT master tag set contains required coverage and rates",()=>{
 assert.ok(TAGSETS["COM-PRP"].includes("MIT.MonthlyTotal"));
 assert.ok(TAGSETS["COM-PRP"].includes("RATE.User"));
 assertTagset("COM-PRP",TAGSETS["COM-PRP"]);
});
test("mismatched template tag set refuses",()=>{
 assert.throws(()=>assertTagset("COM-PRP",TAGSETS["COM-PRP"].filter(x=>x!=="RATE.User").concat("RATE.Unknown")),/missing.*RATE.User.*extra.*RATE.Unknown/);
});
